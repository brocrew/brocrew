import { LimitsReadDemand } from './limits-read-demand'
import {
  LimitsReadUnavailable,
  type LimitsReadInput,
  type LimitsReadResult,
} from './limits-read-protocol'

export interface LimitsReader {
  execute(input: LimitsReadInput): Promise<LimitsReadResult>
  stop(): Promise<void>
  readonly whenExited: Promise<void>
}

type Context = Pick<LimitsReadInput, 'capturedAt' | 'signInChangedAt' | 'usage'>
type OwnedReader = { readonly reader: LimitsReader; expectedExit: boolean }
type Change = {
  readonly why: 'scope' | 'unavailable' | 'closed'
  readonly databaseEpoch: number
  readonly signInEpoch: number
}

export interface LimitsReadObserver {
  before(input: LimitsReadInput): unknown
  completed(input: LimitsReadInput, result: LimitsReadResult, token: unknown): void
  scopeChanged?(change: Change): void
}

/** Replaces a reader only after its previous connection has exited. */
export class LimitsReaderLifetime {
  private readonly demand: LimitsReadDemand
  private owned: OwnedReader | undefined
  private retiring: Promise<void> = Promise.resolve()
  private closed = false
  private created = 0
  private operation = 0
  private databaseEpoch = 1
  private signInEpoch = 1
  private observer: LimitsReadObserver | undefined

  constructor(
    private file: string,
    private readonly start: (file: string) => LimitsReader,
    private readonly changed: (change: Change) => void = () => {},
  ) {
    this.demand = new LimitsReadDemand((input) => this.execute(input))
  }

  get scope() {
    return { databaseEpoch: this.databaseEpoch, signInEpoch: this.signInEpoch }
  }

  observeReads(observer: LimitsReadObserver): void {
    if (this.observer !== undefined || this.operation !== 0 || this.closed)
      throw new Error('Limits reader observation must be installed before its first demand')
    this.observer = observer
  }

  read(context: Context, signal?: AbortSignal, deadlineMs?: number): Promise<LimitsReadResult> {
    if (this.closed) return Promise.reject(new LimitsReadUnavailable('closed'))
    if (!Number.isSafeInteger(this.operation + 1))
      return Promise.reject(new LimitsReadUnavailable('failed'))
    return this.demand.read(
      { ...context, ...this.scope, operation: ++this.operation },
      signal,
      deadlineMs,
    )
  }

  signInChanged(): void {
    if (this.closed) return
    this.signInEpoch++
    this.demand.changeScope()
    this.notify('scope')
  }

  restore(file: string, replace: () => Promise<void> = async () => {}): Promise<void> {
    if (this.closed) return Promise.reject(new LimitsReadUnavailable('closed'))
    this.databaseEpoch++
    this.file = file
    this.created = 0
    this.demand.changeScope()
    this.notify('scope')
    this.retiring = this.retire().then(replace)
    return this.retiring
  }

  close(): Promise<void> {
    if (!this.closed) {
      this.closed = true
      this.demand.close()
      this.notify('closed')
    }
    return this.retire()
  }

  private matches(input: LimitsReadInput): boolean {
    return (
      !this.closed &&
      input.databaseEpoch === this.databaseEpoch &&
      input.signInEpoch === this.signInEpoch
    )
  }

  private async execute(input: LimitsReadInput): Promise<LimitsReadResult> {
    await this.retiring
    if (!this.matches(input)) throw new LimitsReadUnavailable('changed')
    if (this.owned === undefined) {
      // One initial reader and one replacement are allowed in each database lifetime.
      if (this.created >= 2) throw new LimitsReadUnavailable('failed')
      this.created++
      let reader: LimitsReader
      try {
        reader = this.start(this.file)
      } catch {
        this.notify('unavailable')
        throw new LimitsReadUnavailable('failed')
      }
      const owned: OwnedReader = { reader, expectedExit: false }
      this.owned = owned
      void reader.whenExited.then(() => {
        if (this.owned === owned) this.owned = undefined
        if (!owned.expectedExit && !this.closed) this.notify('unavailable')
      })
    }
    let token: unknown
    try {
      token = this.observer?.before(input)
    } catch {
      token = undefined
    }
    const result = await this.owned.reader.execute(input)
    if (!this.matches(input)) throw new LimitsReadUnavailable('changed')
    try {
      if (this.demand.hasLiveSubscribers) this.observer?.completed(input, result, token)
    } catch {
      // A refused authority preparation cannot turn a completed display read into a failure.
    }
    return result
  }

  private retire(): Promise<void> {
    const owned = this.owned
    if (owned !== undefined) {
      owned.expectedExit = true
      this.owned = undefined
      // Even a failed stop request cannot authorize another native connection.
      void Promise.resolve()
        .then(() => owned.reader.stop())
        .catch(() => {})
      this.retiring = Promise.all([this.retiring, owned.reader.whenExited]).then(() => {})
    }
    return this.retiring
  }

  private notify(why: Change['why']): void {
    try {
      if (why !== 'unavailable') this.observer?.scopeChanged?.({ why, ...this.scope })
    } catch {
      // Display scope notification still follows a failed optional authority observer.
    }
    this.changed({ why, ...this.scope })
  }
}
