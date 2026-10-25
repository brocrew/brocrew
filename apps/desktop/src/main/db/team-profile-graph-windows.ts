import { randomUUID } from 'node:crypto'
import {
  TEAM_PROFILE_GRAPH_BOUNDS as B,
  graphUnavailable,
  type TeamProfileGraphReader,
  type TeamProfileGraphRequest,
  type TeamProfileGraphResult,
} from '../../shared/team-profile-graph'
type Window = {
  serial: number
  reader: TeamProfileGraphReader
  nonce: string
  closing?: Promise<void>
  expiry?: ReturnType<typeof setTimeout>
}
type Pending = {
  owner: string
  run: () => void
  resolve: (r: TeamProfileGraphResult) => void
  timer: ReturnType<typeof setTimeout>
}
/** Workspace admission and native permits remain owned until actual worker exit. */
export class TeamProfileGraphWindows {
  private readonly workspaceNonce = randomUUID()
  private readonly windows = new Map<string, Window>()
  private readonly admissions = new Map<string, number>()
  private readonly queue: Pending[] = []
  private readonly failures: number[] = []
  private ticket = 0
  private closed = false
  constructor(
    private readonly start: (
      admission: () => number,
      failure: () => void,
    ) => TeamProfileGraphReader,
    private readonly timezone: string,
    private readonly now: () => number = () => performance.now(),
  ) {}
  admit(owner: string): number {
    const ticket = ++this.ticket
    this.admissions.set(owner, ticket)
    return ticket
  }
  isCurrent(owner: string, ticket: number): boolean {
    return !this.closed && this.admissions.get(owner) === ticket
  }
  private retry = (): number => {
    const now = this.now()
    while (this.failures.length && now - this.failures[0]! >= B.restartWindowMs)
      this.failures.shift()
    return this.failures.length >= B.restarts
      ? Math.max(1, B.restartWindowMs - (now - this.failures[0]!))
      : 0
  }
  private failure = (): void => {
    this.failures.push(this.now())
  }
  async read(
    owner: string,
    request: TeamProfileGraphRequest,
    revision: string,
    admittedAt = this.now(),
  ): Promise<TeamProfileGraphResult> {
    if (this.closed) return graphUnavailable('closed')
    if (request.operation === 'release') {
      await this.closeWindow(owner)
      return { type: 'released' }
    }
    const remainingMs = B.parentDeadlineMs - (this.now() - admittedAt)
    if (remainingMs <= 0) return graphUnavailable('busy', 'roster', 0, 0, B.parentDeadlineMs)
    let window = this.windows.get(owner)
    if (window?.closing) {
      await window.closing
      return graphUnavailable('cancelled')
    }
    if (!window) {
      if (request.operation !== 'snapshot') return graphUnavailable('expired', 'page')
      const retry = this.retry()
      if (retry) return graphUnavailable('busy', 'roster', 0, 0, retry)
      if (this.windows.size >= B.workers) {
        const prior = this.queue.find((p) => p.owner === owner)
        if (prior) {
          this.queue.splice(this.queue.indexOf(prior), 1)
          clearTimeout(prior.timer)
          prior.resolve(graphUnavailable('cancelled'))
        }
        if (this.queue.length >= B.queuedWindows)
          return graphUnavailable('busy', 'roster', 0, 0, B.parentDeadlineMs)
        return new Promise((resolve) => {
          const pending: Pending = {
            owner,
            resolve,
            run: () => {
              void this.read(owner, request, revision, admittedAt).then(resolve)
            },
            timer: setTimeout(() => {
              const index = this.queue.indexOf(pending)
              if (index >= 0) this.queue.splice(index, 1)
              resolve(graphUnavailable('busy', 'roster', 0, 0, B.parentDeadlineMs))
            }, remainingMs),
          }
          this.queue.push(pending)
        })
      }
      window = { serial: 0, reader: this.start(this.retry, this.failure), nonce: randomUUID() }
      this.windows.set(owner, window)
    }
    const owned = window
    const serial = ++owned.serial
    let timedOut = false
    const watchdog = setTimeout(
      () => {
        if (this.windows.get(owner) === owned && owned.serial === serial) {
          timedOut = true
          void this.closeWindow(owner)
        }
      },
      Math.max(1, B.parentDeadlineMs - (this.now() - admittedAt)),
    )
    let result: TeamProfileGraphResult
    try {
      result = await owned.reader.read(request, {
        workspaceNonce: this.workspaceNonce,
        ownerNonce: owned.nonce,
        hostRevision: revision,
        timezone: this.timezone,
      })
    } catch {
      this.failure()
      await this.closeWindow(owner)
      return graphUnavailable('worker')
    } finally {
      clearTimeout(watchdog)
    }
    if (timedOut) {
      await owned.closing
      return graphUnavailable('worker')
    }
    if (this.closed || this.windows.get(owner) !== window || window.closing)
      return graphUnavailable('cancelled')
    if (serial !== window.serial) return graphUnavailable('cancelled')
    if (result.type === 'unavailable' && request.operation === 'snapshot') {
      await this.closeWindow(owner)
      return result
    }
    if (result.type === 'snapshot') {
      if (window.expiry) clearTimeout(window.expiry)
      window.expiry = setTimeout(() => {
        void this.closeWindow(owner)
      }, B.ttlMs)
    }
    return result
  }
  async closeWindow(owner: string): Promise<void> {
    this.admit(owner)
    for (const queued of this.queue.filter((p) => p.owner === owner)) {
      clearTimeout(queued.timer)
      this.queue.splice(this.queue.indexOf(queued), 1)
      queued.resolve(graphUnavailable('cancelled'))
    }
    const window = this.windows.get(owner)
    if (!window) {
      this.admissions.delete(owner)
      return
    }
    if (window.expiry) clearTimeout(window.expiry)
    window.closing ??= window.reader.close().finally(() => {
      if (this.windows.get(owner) === window) this.windows.delete(owner)
      this.admissions.delete(owner)
      this.drain()
    })
    await window.closing
  }
  private drain(): void {
    if (this.closed) return
    while (this.windows.size < B.workers && this.queue.length) {
      const pending = this.queue.shift()!
      clearTimeout(pending.timer)
      pending.run()
    }
  }
  async close(): Promise<void> {
    this.closed = true
    for (const queued of this.queue.splice(0)) {
      clearTimeout(queued.timer)
      queued.resolve(graphUnavailable('closed'))
    }
    await Promise.all([...this.windows.keys()].map((owner) => this.closeWindow(owner)))
  }
}
