import {
  limitsReadInput,
  LimitsReadUnavailable,
  type LimitsReadInput,
  type LimitsReadResult,
} from './limits-read-protocol'

type Subscriber = {
  readonly resolve: (result: LimitsReadResult) => void
  readonly reject: (error: unknown) => void
  readonly clean: () => void
}
type Demand = {
  input: LimitsReadInput
  readonly epoch: number
  readonly subscribers: Set<Subscriber>
}

/** Holds one native job and one latest queued demand, without keeping results. */
export class LimitsReadDemand {
  private running: Demand | undefined
  private queued: Demand | undefined
  private closed = false
  private scheduled = false
  private epoch = 0

  constructor(
    private readonly execute: (input: LimitsReadInput) => Promise<LimitsReadResult>,
    private readonly subscribers = 64,
    private readonly defer: (work: () => void) => void = setImmediate,
  ) {
    if (!Number.isSafeInteger(subscribers) || subscribers <= 0)
      throw new RangeError('Invalid subscriber bound')
  }

  get nativeBusy(): boolean {
    return this.running !== undefined
  }

  get hasLiveSubscribers(): boolean {
    return (this.running?.subscribers.size ?? 0) > 0
  }

  read(
    input: LimitsReadInput,
    signal?: AbortSignal,
    deadlineMs = 30_000,
  ): Promise<LimitsReadResult> {
    if (this.closed) return Promise.reject(new LimitsReadUnavailable('closed'))
    if (signal?.aborted) return Promise.reject(new LimitsReadUnavailable('cancelled'))
    if (!Number.isFinite(deadlineMs) || deadlineMs <= 0)
      return Promise.reject(new RangeError('Invalid read deadline'))
    if (
      (this.running?.subscribers.size ?? 0) + (this.queued?.subscribers.size ?? 0) >=
      this.subscribers
    )
      return Promise.reject(new LimitsReadUnavailable('busy'))
    const wanted = limitsReadInput.parse(input)
    this.queued ??= { input: wanted, epoch: this.epoch, subscribers: new Set() }
    const demand = this.queued
    demand.input = wanted
    const answer = new Promise<LimitsReadResult>((resolve, reject) => {
      const remove = (why: 'cancelled' | 'deadline') => {
        subscriber.clean()
        demand.subscribers.delete(subscriber)
        reject(new LimitsReadUnavailable(why))
        if (this.queued === demand && demand.subscribers.size === 0) this.queued = undefined
      }
      const cancelled = () => remove('cancelled')
      const timer = setTimeout(() => remove('deadline'), deadlineMs)
      const subscriber: Subscriber = {
        resolve,
        reject,
        clean: () => {
          clearTimeout(timer)
          signal?.removeEventListener('abort', cancelled)
        },
      }
      demand.subscribers.add(subscriber)
      signal?.addEventListener('abort', cancelled, { once: true })
    })
    this.schedule()
    return answer
  }

  changeScope(): void {
    this.epoch++
    if (this.queued !== undefined) this.reject(this.queued, new LimitsReadUnavailable('changed'))
    if (this.running !== undefined) this.reject(this.running, new LimitsReadUnavailable('changed'))
    this.queued = undefined
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.changeScope()
  }

  private schedule(): void {
    if (this.closed || this.scheduled || this.running !== undefined || this.queued === undefined)
      return
    this.scheduled = true
    this.defer(() => {
      this.scheduled = false
      void this.run()
    })
  }

  private async run(): Promise<void> {
    if (this.closed || this.running !== undefined) return
    const demand = this.queued
    if (demand === undefined) return
    this.queued = undefined
    this.running = demand
    try {
      const result = await this.execute(demand.input)
      if (this.closed || this.epoch !== demand.epoch) throw new LimitsReadUnavailable('changed')
      for (const subscriber of demand.subscribers) {
        subscriber.clean()
        subscriber.resolve(result)
      }
      demand.subscribers.clear()
    } catch (error) {
      this.reject(
        demand,
        error instanceof LimitsReadUnavailable ? error : new LimitsReadUnavailable('failed'),
      )
    } finally {
      this.running = undefined
      this.schedule()
    }
  }

  private reject(demand: Demand, error: unknown): void {
    for (const subscriber of demand.subscribers) {
      subscriber.clean()
      subscriber.reject(error)
    }
    demand.subscribers.clear()
  }
}
