import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { readSmallJson } from './dock-label'
import { writeWorkspaceFile } from './themes/state'
import {
  DEFAULT_TRANSCRIPT_RETENTION,
  TRANSCRIPT_CLEARING_DEADLINE_MS,
  TRANSCRIPT_RETENTION_FILE,
  isTranscriptRetention,
  type TranscriptRetention,
  type TranscriptsCleared,
} from '../shared/transcript-retention'
import { batchesToClear, clearTranscripts } from './transcript-retention-files'
import type { SessionStore } from './db/session-store'

interface PassProgress {
  version: number
  at: number
  days: number
  conversations: number
  bytes: number
  cursor: string
}

/** Read before startup repair removes the runs left unfinished by a crash. */
export function transcriptStartupWasInterrupted(
  store: Pick<SessionStore, 'whatACrashLeftRunning'>,
): boolean {
  try {
    return store.whatACrashLeftRunning(new Set()).length > 0
  } catch (error) {
    console.warn('Transcript cleanup could not check the previous run.', error)
    return true
  }
}

interface Saved {
  period: TranscriptRetention
  checkedAt: number
  scanAfter: string
  cleared: TranscriptsCleared[]
}

export class TranscriptRetentionHost {
  private state: Saved | undefined
  private loading: Promise<Saved> | null = null
  private changes: Promise<void> = Promise.resolve()
  private running: Promise<void> | null = null
  private launchGate: Promise<void> | null = null
  private deleting: Promise<unknown> | null = null
  private attempted = false
  private stopped = false
  private version = 0
  constructor(
    private readonly userData: string,
    private readonly inUse: () => boolean,
    private readonly now: () => number = Date.now,
    private readonly interrupted = false,
    private readonly deadlineMs = TRANSCRIPT_CLEARING_DEADLINE_MS,
  ) {}

  private load(): Promise<Saved> {
    if (this.state) return Promise.resolve(this.state)
    this.loading ??= this.readSaved()
      .then((state) => {
        this.state = state
        return state
      })
      .finally(() => {
        this.loading = null
      })
    return this.loading
  }
  private async readSaved(): Promise<Saved> {
    try {
      await lstat(join(this.userData, TRANSCRIPT_RETENTION_FILE))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return { period: DEFAULT_TRANSCRIPT_RETENTION, checkedAt: 0, scanAfter: '', cleared: [] }
    }
    const read = await readSmallJson(this.userData, TRANSCRIPT_RETENTION_FILE, 65536)
    if (read === null || typeof read !== 'object' || Array.isArray(read))
      throw new Error('Transcript retention could not be read.')
    const said = read as Partial<Saved>
    if (!isTranscriptRetention(said.period))
      throw new Error('Transcript retention could not be read.')
    const cleared = Array.isArray(said.cleared)
      ? said.cleared
          .filter(
            (line) =>
              typeof line === 'object' &&
              line !== null &&
              [line.at, line.days, line.conversations, line.bytes].every(
                (n) => Number.isSafeInteger(n) && n >= 0,
              ) &&
              (line.conversations > 0 || line.stoppedEarly === true),
          )
          .slice(-100)
      : []
    return {
      period: said.period,
      checkedAt:
        typeof said.checkedAt === 'number' && Number.isFinite(said.checkedAt) ? said.checkedAt : 0,
      scanAfter:
        typeof said.scanAfter === 'string' &&
        said.scanAfter.length <= 4096 &&
        !said.scanAfter.startsWith('/') &&
        !said.scanAfter.includes('\\') &&
        said.scanAfter.split('/').every((part) => part !== '..' && part !== '.')
          ? said.scanAfter
          : '',
      cleared,
    }
  }
  private change(edit: (state: Saved) => Saved): Promise<void> {
    const next = this.changes.then(async () => {
      const state = edit(await this.load())
      await writeWorkspaceFile(
        this.userData,
        TRANSCRIPT_RETENTION_FILE,
        JSON.stringify(state) + '\n',
      )
      this.state = state
    })
    this.changes = next.catch(() => {})
    return next
  }
  async read(): Promise<TranscriptRetention> {
    return (await this.load()).period
  }
  async set(period: TranscriptRetention): Promise<TranscriptRetention> {
    if (!isTranscriptRetention(period)) throw new Error('Invalid transcript retention.')
    this.version++
    await this.deleting
    await this.change((state) => ({ ...state, period, scanAfter: '' }))
    return period
  }
  async recent(from: number, to: number): Promise<readonly TranscriptsCleared[]> {
    return (await this.load()).cleared.filter((line) => line.at >= from && line.at <= to).reverse()
  }
  /** New provider processes wait until the pass ends or its startup deadline passes. */
  async beforeLaunch(): Promise<void> {
    this.attempted = true
    await this.launchGate
  }
  start(): void {
    void this.run().catch((error: unknown) =>
      console.warn('Transcript cleanup could not finish.', error),
    )
  }
  run(): Promise<void> {
    if (this.running) return this.running
    if (this.attempted || this.stopped) return Promise.resolve()
    this.attempted = true
    if (this.interrupted || this.inUse()) return Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    this.launchGate = gate
    let expired = false
    let progress: PassProgress | null = null
    let noticeStarted = false
    const recordDeadline = (): void => {
      if (progress === null || noticeStarted) return
      noticeStarted = true
      void this.save(progress, false, true).catch((error: unknown) =>
        console.warn('Transcript cleanup could not record its deadline.', error),
      )
    }
    const releaseLaunches = (): void => {
      if (this.launchGate !== gate) return
      this.launchGate = null
      release()
    }
    const expire = (): void => {
      if (expired) return
      expired = true
      releaseLaunches()
      recordDeadline()
    }
    const deadlineAt = performance.now() + this.deadlineMs
    const pastDeadline = (): boolean => {
      if (!expired && performance.now() >= deadlineAt) expire()
      return expired
    }
    const timer = setTimeout(expire, this.deadlineMs)
    timer.unref()
    this.running = this.pass((one) => {
      progress = one
      if (expired) recordDeadline()
    }, pastDeadline).finally(() => {
      clearTimeout(timer)
      releaseLaunches()
      this.running = null
    })
    return this.running
  }
  private save(progress: PassProgress, complete: boolean, stoppedEarly: boolean): Promise<void> {
    const { at, days, conversations, bytes, cursor } = progress
    return this.change((latest) => {
      const ownsCursor = progress.version === this.version && latest.period === days
      const cleared = latest.cleared.filter((line) => !(line.at === at && line.stoppedEarly))
      if (conversations > 0 || stoppedEarly)
        cleared.push({
          at,
          days,
          conversations,
          bytes,
          ...(stoppedEarly ? { stoppedEarly: true } : {}),
        })
      return {
        ...latest,
        checkedAt: ownsCursor && complete ? at : latest.checkedAt,
        scanAfter: ownsCursor ? (complete ? '' : cursor) : latest.scanAfter,
        cleared: cleared.slice(-100),
      }
    })
  }
  private async pass(
    started: (progress: PassProgress) => void,
    pastDeadline: () => boolean,
  ): Promise<void> {
    const state = await this.load()
    const at = this.now()
    if (state.period === 'forever') return
    const version = this.version
    const progress: PassProgress = {
      version,
      at,
      days: state.period,
      conversations: 0,
      bytes: 0,
      cursor: state.scanAfter,
    }
    started(progress)
    const current = () =>
      !pastDeadline() &&
      !this.stopped &&
      !this.inUse() &&
      this.version === version &&
      this.state?.period === state.period
    // Only before this session's first launch: an old CLI with its parent gone and stdin closed
    // is treated as inert; the person's other processes retain same-user access to these paths.
    if (!current()) return
    let stopped = false
    const scan = async (after: string, before: string): Promise<void> => {
      for await (const batch of batchesToClear(
        this.userData,
        state.period,
        at,
        this.inUse,
        after,
        before,
        Math.min(1_000, Math.max(1, this.deadlineMs / 4)),
      )) {
        if (!current()) return
        for (const entry of batch.entries) {
          if (!current()) return
          // One staged deletion settles even when the deadline releases a waiting launch.
          this.deleting = clearTranscripts(
            { root: batch.root, rootIdentity: batch.rootIdentity, entries: [entry] },
            this.inUse,
            current,
          )
          try {
            const cleared = (await this.deleting) as Awaited<ReturnType<typeof clearTranscripts>>
            progress.conversations += cleared.conversations
            progress.bytes += cleared.bytes
            if (cleared.stopped) {
              stopped = true
              return
            }
          } finally {
            this.deleting = null
          }
        }
        progress.cursor = batch.through
      }
    }
    await scan(state.scanAfter, '')
    if (current() && !stopped && state.scanAfter !== '') await scan('', state.scanAfter)
    const complete = current() && !stopped
    if (
      complete ||
      stopped ||
      progress.conversations > 0 ||
      progress.cursor !== '' ||
      pastDeadline()
    )
      await this.save(progress, complete, pastDeadline())
  }
  async stop(): Promise<void> {
    this.stopped = true
    await this.running
    await this.changes
  }
}
