import { nativeRun, commandInput } from '../native-run'
import {
  MAX_BACKGROUND_ID,
  MAX_BACKGROUND_TEXT,
  MAX_BACKGROUND_WORK,
  type BackgroundWork,
  type BackgroundWorkEnding,
} from '../background-work'
import type { RuntimeEvent } from '../events'
import { unrefTimers, type UnrefTimers } from '../internal/stall-watchdog'
import { truncate } from './normalize'

/**
 * Codex's live PTY processes as `background_work`. Codex never sends `item/completed` for a detached
 * command and no notification names background terminals, so the stream cannot say when one ends;
 * `thread/backgroundTerminals/list` is the source of the level.
 *
 * It is asked for only:
 *  - when a turn ends ({@link BackgroundTerminals.note}), which is when work outliving its turn can
 *    exist;
 *  - on a poll while something is listed ({@link WHILE_RUNNING_MS}), because nothing else reports an
 *    ending;
 *  - once after a stop.
 *
 * A session with nothing running sends nothing: the poll is armed by a non-empty answer and disarmed
 * by the first empty one. A resume asks once because the persisted ledger can replay rows for
 * processes that died with the previous app-server; a fresh start has no ledger and does not ask.
 */

/** The `source` of every level this file publishes. */
export const BACKGROUND_TERMINALS_SOURCE = 'thread/backgroundTerminals/list'

/**
 * Pages of `thread/backgroundTerminals/list` one refresh reads. Bounded because `nextCursor` is
 * server-controlled; reaching the bound is reported rather than silently truncated.
 */
export const MAX_TERMINAL_PAGES = 8

/**
 * How often the level is re-read while something is running. Codex sends no closing edge for a
 * detached command, so without the poll a finished process would stay listed. It is self-limiting
 * and costs one local request per interval.
 */
export const WHILE_RUNNING_MS = 2_000

/**
 * Longest wait before re-reading after a failed read. The poll is the only thing that removes a row,
 * so a failure must not stop it. Backoff doubles from {@link WHILE_RUNNING_MS}; retries continue
 * while the last level is non-empty and the session is open, with no attempt count.
 */
export const MAX_RETRY_MS = 30_000

/** Delay before the `n`-th consecutive retry: 2 s, 4 s, 8 s, capped at 30 s. */
export function retryDelay(failures: number): number {
  return Math.min(WHILE_RUNNING_MS * 2 ** Math.max(0, failures - 1), MAX_RETRY_MS)
}

/** One page of rows, the count it could not name, and the next cursor. */
interface Page {
  rows: BackgroundWork[]
  /** Rows without a usable `processId`. */
  skipped: number
  cursor: string | undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(source: unknown, key: string): string {
  if (!isRecord(source)) return ''
  const value = source[key]
  return typeof value === 'string' ? value : ''
}

/**
 * One `ThreadBackgroundTerminal` as a {@link BackgroundWork}, or undefined when it has no usable
 * `processId` (the stop key; such rows are counted as dropped). `kind` is omitted because Codex
 * states none. `itemId` is the owning tool call's id.
 * The neutral run carries the full command and directory.
 */
function toWork(row: unknown): BackgroundWork | undefined {
  const id = readString(row, 'processId')
  if (id === '' || id.length > MAX_BACKGROUND_ID) return undefined
  const itemId = readString(row, 'itemId')
  const command = truncate(readString(row, 'command').trim(), MAX_BACKGROUND_TEXT - 1)
  return {
    id,
    run: nativeRun('command', {
      input: commandInput(readString(row, 'command'), readString(row, 'cwd')),
    }),
    ...(itemId !== '' && itemId.length <= MAX_BACKGROUND_ID ? { toolCallId: itemId } : {}),
    ...(command !== '' ? { description: command } : {}),
  }
}

/** One `ThreadBackgroundTerminalsListResponse`, read defensively as provider data. */
export function readTerminalPage(result: unknown): Page {
  const data = isRecord(result) ? result['data'] : undefined
  const cursorValue = isRecord(result) ? result['nextCursor'] : undefined
  const cursor = typeof cursorValue === 'string' && cursorValue !== '' ? cursorValue : undefined
  if (!Array.isArray(data)) return { rows: [], skipped: 0, cursor }
  const rows: BackgroundWork[] = []
  let skipped = 0
  for (const entry of data) {
    const item = toWork(entry)
    if (item === undefined) skipped += 1
    else rows.push(item)
  }
  return { rows, skipped, cursor }
}

/**
 * The rows that left the level, with how each ended. `stopped` only where Codex answered
 * `terminated: true`; otherwise `unknown`, since Codex never reports completion or failure for these.
 */
export function endingsBetween(
  before: readonly BackgroundWork[],
  after: readonly BackgroundWork[],
  weStopped: ReadonlySet<string>,
): BackgroundWorkEnding[] {
  const still = new Set(after.map((row) => row.id))
  const endings: BackgroundWorkEnding[] = []
  for (const row of before) {
    if (still.has(row.id)) continue
    endings.push({
      id: row.id,
      ...(row.toolCallId !== undefined ? { toolCallId: row.toolCallId } : {}),
      outcome: weStopped.has(row.id) ? 'stopped' : 'unknown',
      run: nativeRun('command', {
        input: row.run?.input,
        result: weStopped.has(row.id) ? 'Stopped' : undefined,
      }),
    })
  }
  return endings
}

/** Every hook this watch needs from the session that owns it — nothing else of the handle leaks in. */
export interface BackgroundTerminalsDeps {
  /** Send one request on this session's transport. Rejects exactly as the transport does. */
  request(method: string, params: unknown): Promise<unknown>
  /** Publish one event on this session's stream, through the handle's own `emit`. */
  emit(event: RuntimeEvent): void
  /** This session's thread id, or `undefined` before the handshake has bound one. */
  threadId(): string | undefined
  /** Is this session still usable — false the moment it terminalizes (007 P1-1's rule). */
  open(): boolean
}

/**
 * **The level, the endings, and the one control** — see the file docblock for the measurements.
 *
 * ⚠️ **Stateful on purpose, and two of the fields are the whole subject.** The array is the last
 * level published, which is what an ending is computed against; the set is *"ids WE asked the
 * provider to kill and the provider said yes to"*, which is what makes an ending say `stopped`
 * rather than `unknown`. Neither is ever derived from the other. The rest is bookkeeping about the
 * WATCH — what is in flight, what is armed, how many reads have failed in a row, and whether this
 * has been closed for good ({@link BackgroundTerminals.closed}).
 */
export class BackgroundTerminals {
  private level: BackgroundWork[] = []
  private readonly confirmedStopped = new Set<string>()
  /** The refresh in flight, so two edges in the same millisecond cost one request rather than two. */
  private inFlight: Promise<void> | null = null
  /** An edge that arrived during a refresh; collapsed into one follow-up. */
  private pending = false

  /** The armed follow-up read, or null when nothing is running and nothing is owed. */
  private watching: unknown = null
  /** The last level put on the stream, or null before the first. */
  private published: { ids: string; dropped: number } | null = null
  /** Consecutive failed reads, input to {@link retryDelay}; reset by the next successful read. */
  private failures = 0
  /**
   * Latch set by {@link BackgroundTerminals.close}. `open()` excludes only terminal states, so an
   * in-flight read could otherwise publish and re-arm the timer during teardown.
   */
  private closed = false

  constructor(
    private readonly deps: BackgroundTerminalsDeps,
    private readonly timers: UnrefTimers = unrefTimers,
  ) {}

  /** Stop watching for good, from the session's teardown, so no list request reaches a closing transport. */
  close(): void {
    this.closed = true
    if (this.watching !== null) this.timers.clearTimeout(this.watching)
    this.watching = null
  }

  /** Whether this watch may touch the wire; rechecked after each await because teardown can intervene. */
  private usable(): boolean {
    return !this.closed && this.deps.open()
  }

  /**
   * Stop one live process with `thread/backgroundTerminals/terminate`. A rejection (e.g. -32600 for
   * a malformed id) is passed through so the row does not claim a stop that never landed.
   * `{terminated:false}` means nothing was running and is not an error. The level is re-read
   * afterwards, because resolving is not proof of death.
   */
  async terminate(
    id: string,
    /** Told whether Codex said it ended the process. */
    said?: (terminated: boolean) => void,
  ): Promise<boolean> {
    const threadId = this.deps.threadId()
    if (threadId === undefined || !this.usable()) return false
    const answer = await this.deps.request('thread/backgroundTerminals/terminate', {
      threadId,
      processId: id,
    })
    if (isRecord(answer) && answer['terminated'] === true) this.confirmedStopped.add(id)
    this.refresh()
    said?.(isRecord(answer) && answer['terminated'] === true)
    // True means the request went out, even for `{terminated:false}`; the row leaving is reported
    // through the event channel. The early returns above are the only false.
    return true
  }

  /**
   * End the commands a stopped turn started: `turn/interrupt` ends the turn but leaves its command
   * running. The level is read fresh (every page, before anything is terminated) and only rows whose
   * `itemId` `theTurns` accepts are terminated; a refusal does not stop the others. Resolves once the
   * level is published.
   *
   * @returns the rows Codex said it ended, with their tool call ids; `{terminated:false}` rows are
   *   excluded.
   */
  async endTheseCommands(
    theTurns: (toolCallId: string) => boolean,
  ): Promise<{ readonly id: string; readonly toolCallId: string }[]> {
    const threadId = this.deps.threadId()
    if (threadId === undefined || !this.usable()) return []
    const rows: BackgroundWork[] = []
    let cursor: string | undefined
    let pages = 0
    do {
      const page = readTerminalPage(
        await this.deps.request('thread/backgroundTerminals/list', {
          threadId,
          ...(cursor === undefined ? {} : { cursor }),
        }),
      )
      rows.push(...page.rows)
      cursor = page.cursor
      pages += 1
    } while (cursor !== undefined && pages < MAX_TERMINAL_PAGES)
    const ended: { readonly id: string; readonly toolCallId: string }[] = []
    for (const row of rows) {
      const toolCallId = row.toolCallId
      if (toolCallId === undefined || !theTurns(toolCallId)) continue
      try {
        let terminated = false
        await this.terminate(row.id, (yes) => {
          terminated = yes
        })
        if (terminated) ended.push({ id: row.id, toolCallId })
      } catch {
        // A refusal ends nothing; the level read below still lists it.
      }
    }
    while (this.inFlight !== null) await this.inFlight
    // Forget stop marks for ids absent from the level, so a later process Codex gives the same key
    // is not reported as `stopped`. Ids still listed keep their mark for the ending a later read publishes.
    for (const { id } of ended) {
      if (!this.level.some((row) => row.id === id)) this.confirmedStopped.delete(id)
    }
    return ended
  }

  /**
   * A turn ended: the one edge that refreshes. `item/started` is deliberately not an edge, since
   * Codex lists a command as a background terminal from t = 0 and foreground commands would be
   * published as ended background work.
   */
  note(method: string): void {
    if (method === 'turn/completed') this.refresh()
  }

  /**
   * Ask for the level and publish what changed. Fire-and-forget; single-flight with one coalesced
   * follow-up so overlapping answers cannot publish an older level last.
   */
  refresh(): void {
    if (this.closed) return
    if (this.inFlight !== null) {
      this.pending = true
      return
    }
    let failed = false
    this.inFlight = this.readAndPublish()
      .catch(() => {
        failed = true
      })
      .finally(() => {
        this.inFlight = null
        if (this.pending) {
          this.pending = false
          this.refresh()
          return
        }
        // A failed read re-arms (see {@link MAX_RETRY_MS}), after the coalesced follow-up.
        if (failed) this.retryLater()
      })
    void this.inFlight
  }

  /**
   * Ask again after a failed read while the last level is non-empty, since surfaces are claiming
   * "running" and only the poll can withdraw it. Replaces any armed timer.
   */
  private retryLater(): void {
    this.failures += 1
    if (this.level.length === 0 || !this.usable()) return
    if (this.watching !== null) this.timers.clearTimeout(this.watching)
    this.watching = this.timers.setTimeout(() => {
      this.watching = null
      this.refresh()
    }, retryDelay(this.failures))
  }

  /** Arm the follow-up read while something is running and disarm when nothing is; measured from the last answer so reads cannot overlap. */
  private watchWhile(running: boolean): void {
    if (this.watching !== null) {
      this.timers.clearTimeout(this.watching)
      this.watching = null
    }
    if (!running || !this.usable()) return
    this.watching = this.timers.setTimeout(() => {
      this.watching = null
      this.refresh()
    }, WHILE_RUNNING_MS)
  }

  /**
   * Read every page, then publish once. A failed read publishes nothing, since an empty registry
   * asserted from no answer would be wrong; {@link retryLater} keeps the silence temporary.
   */
  private async readAndPublish(): Promise<void> {
    const threadId = this.deps.threadId()
    if (threadId === undefined || !this.usable()) return
    const rows: BackgroundWork[] = []
    let dropped = 0
    let cursor: string | undefined
    let pages = 0
    do {
      const page = readTerminalPage(
        await this.deps.request('thread/backgroundTerminals/list', {
          threadId,
          ...(cursor === undefined ? {} : { cursor }),
        }),
      )
      rows.push(...page.rows)
      dropped += page.skipped
      cursor = page.cursor
      pages += 1
    } while (
      cursor !== undefined &&
      pages < MAX_TERMINAL_PAGES &&
      rows.length <= MAX_BACKGROUND_WORK
    )
    // Every page arrived, so the backoff restarts.
    this.failures = 0
    if (!this.usable()) return
    // An unfinished pagination is reported as a non-fatal error, not folded into `dropped`, because
    // the number of rows behind an unread cursor is unknown.
    if (cursor !== undefined && rows.length <= MAX_BACKGROUND_WORK) {
      this.deps.emit({
        type: 'error',
        fatal: false,
        message: `this conversation has more background commands running than ${MAX_TERMINAL_PAGES} pages of the provider's list can name; the list below is incomplete`,
      })
    }
    const running = rows.slice(0, MAX_BACKGROUND_WORK)
    dropped += rows.length - running.length
    this.watchWhile(running.length > 0)
    const before = this.level
    this.level = running
    const gone = endingsBetween(before, running, this.confirmedStopped)
    for (const ending of gone) {
      this.confirmedStopped.delete(ending.id)
      this.deps.emit({
        type: 'background_work',
        ended: ending,
        source: BACKGROUND_TERMINALS_SOURCE,
      })
    }
    // Publish only on change; most turn-end reads answer "nothing running" and would otherwise add
    // a frame per turn to the wire and ledger.
    if (this.sameAsPublished(running, dropped) && gone.length === 0) return
    this.published = { ids: running.map((row) => row.id).join('\u0000'), dropped }
    this.deps.emit({
      type: 'background_work',
      running,
      ...(dropped > 0 ? { dropped } : {}),
      source: BACKGROUND_TERMINALS_SOURCE,
    })
  }

  /** Whether this is the level last put on the stream. */
  private sameAsPublished(running: readonly BackgroundWork[], dropped: number): boolean {
    return (
      this.published !== null &&
      this.published.dropped === dropped &&
      this.published.ids === running.map((row) => row.id).join('\u0000')
    )
  }
}
