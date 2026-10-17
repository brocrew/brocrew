import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { readSmallJson } from './dock-label'
import { writeWorkspaceFile } from './themes/state'
import {
  DEFAULT_TRANSCRIPT_RETENTION,
  TRANSCRIPT_RETENTION_FILE,
  isTranscriptRetention,
  type TranscriptRetention,
  type TranscriptsCleared,
} from '../shared/transcript-retention'
import { clearTranscripts, whatToClear } from './transcript-retention-files'
import type { SessionStore } from './db/session-store'

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
  cleared: TranscriptsCleared[]
}

export class TranscriptRetentionHost {
  private state: Saved | undefined
  private loading: Promise<Saved> | null = null
  private changes: Promise<void> = Promise.resolve()
  private running: Promise<void> | null = null
  private deleting: Promise<unknown> | null = null
  private attempted = false
  private stopped = false
  private version = 0
  constructor(
    private readonly userData: string,
    private readonly inUse: () => boolean,
    private readonly now: () => number = Date.now,
    private readonly interrupted = false,
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
      return { period: DEFAULT_TRANSCRIPT_RETENTION, checkedAt: 0, cleared: [] }
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
              line.conversations > 0,
          )
          .slice(-100)
      : []
    return {
      period: said.period,
      checkedAt:
        typeof said.checkedAt === 'number' && Number.isFinite(said.checkedAt) ? said.checkedAt : 0,
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
    await this.change((state) => ({ ...state, period }))
    return period
  }
  async recent(from: number, to: number): Promise<readonly TranscriptsCleared[]> {
    return (await this.load()).cleared.filter((line) => line.at >= from && line.at <= to).reverse()
  }
  /** New provider processes wait for the whole clearing pass, including its scan. */
  async beforeLaunch(): Promise<void> {
    this.attempted = true
    await this.running?.catch(() => {})
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
    this.running = this.pass().finally(() => {
      this.running = null
    })
    return this.running
  }
  private async pass(): Promise<void> {
    const state = await this.load()
    const at = this.now()
    if (state.period === 'forever') return
    const version = this.version
    const current = () =>
      !this.stopped &&
      !this.inUse() &&
      this.version === version &&
      this.state?.period === state.period
    // Only before this session's first launch: an old CLI with its parent gone and stdin closed
    // is treated as inert; the person's other processes retain same-user access to these paths.
    if (!current()) return
    const selected = await whatToClear(this.userData, state.period, at, this.inUse)
    let conversations = 0
    let bytes = 0
    let stopped = false
    for (const entry of selected.entries) {
      if (!current()) break
      // A newly reserved launch waits for the pass and stops any remaining clearing.
      this.deleting = clearTranscripts(
        { root: selected.root, rootIdentity: selected.rootIdentity, entries: [entry] },
        this.inUse,
        current,
      )
      try {
        const cleared = (await this.deleting) as {
          conversations: number
          bytes: number
          stopped?: true
        }
        conversations += cleared.conversations
        bytes += cleared.bytes
        if (cleared.stopped) {
          stopped = true
          break
        }
      } finally {
        this.deleting = null
      }
    }
    if (!current() && conversations === 0) return
    await this.change((latest) => ({
      ...latest,
      checkedAt: current() && !stopped ? at : latest.checkedAt,
      cleared:
        conversations > 0
          ? [...latest.cleared, { at, days: state.period as number, conversations, bytes }].slice(
              -100,
            )
          : latest.cleared,
    }))
  }
  async stop(): Promise<void> {
    this.stopped = true
    await this.running
    await this.changes
  }
}
