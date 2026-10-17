import {
  MAX_BACKGROUND_ID,
  MAX_BACKGROUND_TEXT,
  MAX_BACKGROUND_WORK,
  type BackgroundWork,
  type BackgroundWorkEnding,
} from '../background-work'
import type { RuntimeEvent } from '../events'
import { truncate } from './normalize'

/**
 * **Codex's live PTY processes, as `background_work`** (275) — the half `247` §2 ruled out and
 * `275` was dispatched to close.
 *
 * ## ⛔ What the live wire says, because none of it was guessable
 *
 * `smoke/codex-background-probe.smoke.ts` measured all of this against the bundled `codex-cli
 * 0.146.0`, three threads, `pnpm run probe:codex-background`. Every number below is from that run.
 *
 * | question | the answer, measured |
 * |---|---|
 * | can a model reach the state unaided? | ⛔ **it cannot avoid it.** *"Run `sleep 402.93655`"* on a plain turn: the process starts, and it is in `thread/backgroundTerminals/list` **at t = 0 ms** |
 * | does the turn wait for it? | **no** — `turn/completed` at **4 009 ms**, over a process with 400 s left to run, with the model saying *"Started `sleep 402.93655`."* |
 * | does a receipt ever arrive? | ⛔ **no `item/completed`, ever.** The `tool_result` never lands — not while it runs, not after it is stopped, not after the turn ends |
 * | does the STREAM name it? | ⛔ **no.** 12–16 wire methods across the runs and **not one** names `backgroundTerminals`; the pin declares no such notification either |
 * | is `interrupt` a control for it? | ⛔ **no.** `turn/interrupt` ended the turn and the command was **still in the process table 20 s later** |
 * | does `terminate` work? | ⚑ **yes** — `{terminated:true}`, and `pgrep -f` went from `[81937]` to `[]` |
 * | a second `terminate` on the same id? | `{terminated:false}` — an ordinary answer, **not** an error |
 * | a `processId` that cannot be an integer? | JSON-RPC **-32600** *"invalid background terminal process id"* |
 * | is the card's `backgroundId` the stop key? | ⚑ **yes.** `tool_call backgroundId 42852` / `list processId "42852"`, same run |
 * | is `itemId` the card's own id? | ⚑ **yes.** `exec-62bc2acf-…` on both, so a row joins its card |
 *
 * ## ⚠️ So the stream is NOT sufficient, and `275` §1 asked to be told which way it fell
 *
 * The dispatch's instruction was *"if the stream is sufficient, say so and do not call `list`"*. It
 * is not, and the reason is the third row above rather than the fourth: BroBot could build the SET
 * from the edges it already parses — `item/started` carries the `processId` — but **the closing edge
 * never comes**. A level maintained from edges alone would gain a row that could never leave, which
 * is precisely the wedged stale indicator `222` cost a dispatch and the one failure `247`'s REPLACE
 * rule exists to make impossible.
 *
 * ⛔ **`list` is therefore the level, and when it is asked for is the whole of `275` §1's second
 * bullet.** *"An unnecessary request to a provider is a new failure mode."* So:
 *
 *  - **One EDGE — a turn ended** ({@link BackgroundTerminals.note}), which is both the moment the
 *    app is about to say `idle` and the honest definition of the subject: work that OUTLIVES ITS
 *    TURN. ⛔ Asking on `item/started` instead would name ordinary foreground commands — Codex lists
 *    one from t = 0 ms — and the note on `note()` records the card that would have broken.
 *  - **A poll WHILE something is running** ({@link WHILE_RUNNING_MS}), because the edge cannot report
 *    an ending: the closing edge never comes, so nothing else could ever take a row away.
 *  - **And once after a stop**, so what a person sees is the process gone rather than an opinion.
 *
 * ⚑ **A session with nothing running sends nothing at all**, for ever — the poll is armed by a
 * non-empty answer and disarmed by the first empty one. The request is local IPC to a child process
 * on this machine: no tokens and no network.
 *
 * ⚠️ **A RESUME asks once and a fresh START never does, and the asymmetry is the point.** A resumed
 * thread runs against a freshly spawned app-server whose process group `240` proved this app reaps,
 * so a list has nothing from a previous launch to FIND — but the LEDGER does. `background_work` is
 * persisted and re-folded on reopen, so without that one frame a conversation comes back showing
 * rows for processes that died with the last app-server, each with a Stop beside it. ⛔ A fresh start
 * has no ledger to have replayed one, and asking there would buy a guaranteed empty answer on every
 * session this app opens — which is `275` §1's own hazard.
 */

/** What `source` says on every level this file publishes — the provider's own method name. */
export const BACKGROUND_TERMINALS_SOURCE = 'thread/backgroundTerminals/list'

/**
 * How many pages of `thread/backgroundTerminals/list` one refresh will read.
 *
 * ⚠️ **A bound rather than a `while (cursor)`, and it is not defensive.** The response carries an
 * opaque `nextCursor` the server controls; a loop that trusted it to end is a loop a provider bug can
 * keep this session in for ever. Eight pages is far past anything reachable — the measured live case
 * is one row — and reaching it is reported out loud rather than silently truncated (092).
 */
export const MAX_TERMINAL_PAGES = 8

/**
 * ⛔ **How often the level is re-read WHILE something is running, and why there is a timer at all.**
 *
 * ⚠️ **The edges cannot report an ending, and that is measured rather than feared.** A detached Codex
 * command emits **no `item/completed`, ever** — the probe watched for one 30 seconds after the
 * process had been killed and it never came. The turn ends long before the work does. So every edge
 * {@link BackgroundTerminals.note} knows about has already happened by the time the command
 * finishes, and a level maintained from edges alone would keep a row for a process that died minutes
 * ago. ⛔ That is `222`'s wedged stale indicator exactly, and `247`'s rule for this whole family is
 * that it must fail toward forgetting instead.
 *
 * ⚑ **Self-limiting, which is what keeps it from being the "unnecessary request" `275` §1 warns
 * about.** The timer is armed only after publishing a level with something in it, and the first
 * empty answer disarms it — so a session with nothing running sends nothing, for ever. What it costs
 * while something IS running is one local request to a child process on this machine every two
 * seconds: no tokens, no network, and the same order of cost as the app already pays to watch a turn.
 */
export const WHILE_RUNNING_MS = 2_000

/**
 * ⛔ **The longest this will wait before asking again after a read FAILED** (287 §1, finding 3).
 *
 * ⚠️ **The poll is the only thing that can ever take a row away, so losing it is not a lost read —
 * it is a permanent false claim.** The timer clears its own handle before the read; a rejection was
 * swallowed by {@link BackgroundTerminals.refresh} and only a SUCCESSFUL read re-armed. So one
 * transient failure left no timer at all, and Codex emits no closing edge — measured, not feared —
 * which means the registry, the activity pill, the rail row and the Stop control went on claiming
 * live work indefinitely after the process was dead. `222`'s wedged stale indicator, reached through
 * a rejected request instead of a missed bookend.
 *
 * ⚑ **Bounded backoff, doubling from {@link WHILE_RUNNING_MS}.** A transport that is failing is
 * usually failing for a reason that outlasts two seconds, and hammering it at the poll interval
 * would turn one bad read into a request storm against a child process that is already unwell. The
 * ceiling is what keeps the wait from growing past the point where a person would call the answer
 * stale.
 *
 * ⚠️ **What stops it is not a retry COUNT**, and that is deliberate. The retry is armed only while
 * the last authoritative level is non-empty and the session is still open — so it ends when a read
 * succeeds and says nothing is running, or when the session closes, and both of those are facts
 * rather than a budget. Giving up after N attempts would put the screen back in exactly the state
 * this exists to prevent, with the added lie that we had stopped looking.
 */
export const MAX_RETRY_MS = 30_000

/** How long to wait before the `n`-th consecutive retry — 2 s, 4 s, 8 s … capped at 30 s. */
export function retryDelay(failures: number): number {
  return Math.min(WHILE_RUNNING_MS * 2 ** Math.max(0, failures - 1), MAX_RETRY_MS)
}

/** One page's worth of rows, plus what that page could not carry and where the next one starts. */
interface Page {
  rows: BackgroundWork[]
  /** Rows the page carried that this app cannot name — no `processId`, or an unusable one. */
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
 * One `ThreadBackgroundTerminal` → one {@link BackgroundWork}, or nothing.
 *
 * ⛔ **`kind` is deliberately absent and that is `074`'s rule, not an oversight.** Claude's rows carry
 * a `task_type` the provider states (`local_bash` in every capture); Codex states no such field, and
 * the honest answer to *"what kind of work is this"* is silence rather than a word this app made up.
 * The registry already renders a row with no kind.
 *
 * ⚠️ **`toolCallId` is `itemId`, and that is measured rather than inferred.** The probe printed the
 * list row's `itemId` beside the transcript's own `tool_call.id` for the same command and they are
 * the same string — which is what lets `withCommand` show the COMMAND on the row and lets an ending
 * find the card it belongs to. A row whose `itemId` is empty simply carries none, which the neutral
 * type already documents as a real state.
 *
 * ⛔ **A row with no usable `processId` is dropped and COUNTED, never shown.** The id is what the
 * stop sends; a row that cannot be stopped and cannot be named is worse than a number saying one is
 * missing — `247` §3's rule, and the same reason `backgroundWorkEvents` folds Claude's id-less tasks
 * into `dropped`.
 */
function toWork(row: unknown): BackgroundWork | undefined {
  const id = readString(row, 'processId')
  if (id === '' || id.length > MAX_BACKGROUND_ID) return undefined
  const itemId = readString(row, 'itemId')
  const command = truncate(readString(row, 'command').trim(), MAX_BACKGROUND_TEXT - 1)
  return {
    id,
    ...(itemId !== '' && itemId.length <= MAX_BACKGROUND_ID ? { toolCallId: itemId } : {}),
    ...(command !== '' ? { description: command } : {}),
  }
}

/** One `ThreadBackgroundTerminalsListResponse`, read defensively — it is provider data. */
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
 * ⛔ **What LEFT the level, and how each one is said to have ended.**
 *
 * ⚠️ **`stopped` is claimed only where the server said `terminated: true`, and `unknown` everywhere
 * else.** The distinction is the whole of `074`'s rule applied to a measured fact: a `terminate` that
 * answers `{terminated:false}` did not stop anything — the process was already gone — so calling the
 * row `stopped` would be this app reporting an outcome nobody observed. *"ended, outcome not
 * reported"* is exactly what happened, and it is a word the vocabulary already has.
 *
 * ⚑ Codex never reports `completed` or `failed` for one of these, and that is not a gap this file
 * papers over: `item/completed` measurably never arrives for a detached command, so the provider
 * genuinely does not say. The two words stay reachable through Claude, where they are stated.
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
    })
  }
  return endings
}

/** Every hook this watch needs from the session that owns it — nothing else of the handle leaks in. */
/** Injectable timers, so a test drives the poll deterministically instead of by sleeping (074's shape). */
export interface TerminalTimers {
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
}

const realTimers: TerminalTimers = {
  setTimeout: (fn, ms) => {
    const handle = setTimeout(fn, ms)
    // A registry watch must never be the reason a process stays alive — `StallWatchdog`'s rule.
    ;(handle as { unref?: () => void }).unref?.()
    return handle
  },
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

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
  /** An edge that arrived while a refresh was running — collapsed into ONE follow-up, never a queue. */
  private pending = false

  /** The armed follow-up read, or null when nothing is running and nothing is owed. */
  private watching: unknown = null
  /** The last level actually PUT ON THE STREAM, or null before the first one — see the skip below. */
  private published: { ids: string; dropped: number } | null = null
  /**
   * ⛔ **Reads that have failed in a row, and the input to {@link retryDelay}.** Zeroed by the next
   * successful read rather than by time, so a session that fails once an hour never accumulates a
   * backoff it did not earn.
   */
  private failures = 0
  /**
   * 🔴 **This watch is over for good** (287 §1, finding 6).
   *
   * ⛔ **{@link BackgroundTerminals.close} used to clear only the timer it was HOLDING**, which is a
   * statement about one handle rather than about this object. A list request already in flight
   * resolved afterwards, passed its second open check — `open()` excludes only terminal states, not
   * a session that is closing — emitted a level, and armed the timer again, sending another request
   * into a transport that teardown was in the middle of closing. Codex's own teardown can spend two
   * seconds draining handlers plus two interrupting, and this poll is two seconds, so the window is
   * not theoretical.
   *
   * ⚠️ **A latch rather than a wider `open()`, because they answer different questions.** `open()`
   * is the session's, asked by everything; this is *"has the thing that owns this watch told it to
   * stop"*, and only teardown can say it. Once true it never goes back — which is what the old
   * `close()` could not promise and its own doc claimed.
   */
  private closed = false

  constructor(
    private readonly deps: BackgroundTerminalsDeps,
    private readonly timers: TerminalTimers = realTimers,
  ) {}

  /**
   * ⛔ **Stop watching for good** — called from the session's own teardown.
   *
   * ⚠️ The timer is `unref`d, so this is not about holding the process open; it is about not sending
   * a list request into a transport that is being closed. `273` is the dispatch that established
   * what a request arriving after teardown costs, and this is the same door on a different channel.
   *
   * ⛔ **"For good" is now a LATCH and not a hope** (287 finding 6) — see {@link closed}. Clearing
   * the handle this happened to be holding left an in-flight read free to publish and re-arm after
   * teardown had already claimed to have stopped.
   */
  close(): void {
    this.closed = true
    if (this.watching !== null) this.timers.clearTimeout(this.watching)
    this.watching = null
  }

  /**
   * ⛔ **May this watch touch the wire at all** — the session's own door, plus {@link closed}.
   *
   * ⚠️ **Asked in five places rather than inlined once**, because every one of them is a moment at
   * which the answer can have changed since the last: a request in flight outlives the frame that
   * asked for it, and teardown is exactly what happens in between.
   */
  private usable(): boolean {
    return !this.closed && this.deps.open()
  }

  /**
   * ⛔ **Stop one live process — `thread/backgroundTerminals/terminate`.**
   *
   * ⚠️ **A rejection is passed straight through, and that is `275` §1's third bullet.** The server
   * answers a `processId` it cannot parse with JSON-RPC `-32600` (*"invalid background terminal
   * process id"*, measured), and a caller that swallowed it would leave the row saying *"still
   * running"* over a request that never landed — *"a worse lie than no button"*.
   *
   * ⚑ **`{terminated:false}` is NOT a failure and must not be raised as one.** It means the id named
   * nothing running: the work had already finished. The neutral contract's own words for the same
   * situation on Claude are *"there is no background work of yours to stop"*, and the visible
   * consequence a caller needs is not an exception — it is the row going away, which the refresh
   * below produces either way.
   *
   * ⛔ **Resolving is still not proof of death** — {@link SessionHandle.stopBackgroundWork}'s rule,
   * kept even though this provider answers more than Claude's does. What makes the answer usable is
   * that the level is re-read afterwards, so what a person sees is the process being gone rather than
   * this app's opinion about a request it sent.
   */
  async terminate(
    id: string,
    /** ⚑ **F084** — told whether Codex said it ended the process, for a caller that names it. */
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
    // ⛔ **`true` is "the request WENT OUT", and `{terminated:false}` is still a `true`** (287
    // finding 5). That answer means the id named nothing running — the work had already finished —
    // which is a fact the provider stated about the work, not a fact about whether we asked. The
    // caller's boolean answers only the second question, because the first one already travels the
    // event channel as the row leaving. The two early returns above are the false: nothing was sent.
    return true
  }

  /**
   * ⛔ **F084 · end the commands a stopped turn started** — `turn/interrupt` ends the turn and leaves
   * its command running (the table above), so the stop terminates them itself.
   *
   * ⚑ **Read fresh, and only what `theTurns` names.** The level is read at turn ends and while
   * something is listed, so the command a stopped turn is running is usually not in it. A row is
   * ended when `theTurns` answers yes for its `itemId` — the id of the command item that started it.
   * ⚠️ Asked AFTER the list answers, so what a stop ends can still be widened while the list is on
   * its way (`CodexSessionHandle.endEverythingTheTurnStarted`).
   *
   * ⚠️ Every page is read before anything is terminated: a set that shrinks under a cursor could skip
   * a row. ⚑ One stop Codex refuses does not keep the others from going out, and the level read
   * after them still says what runs. Resolves once that level is published, so a reader after a stop
   * sees the level without what it ended.
   *
   * @returns the rows Codex said it ended, each with the tool call that started it. ⚑ Not one it
   *   answered `{terminated:false}` for: that command had already finished, and the stop ended
   *   nothing.
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
        // ⚑ A refusal ends nothing; the level read below still lists it as running.
      }
    }
    while (this.inFlight !== null) await this.inFlight
    // ⛔ **A stop key that left no level behind is forgotten** — the command a stopped turn was
    // running is usually not in the level, so no ending ever spends its mark in `confirmedStopped`.
    // Kept, it would call `stopped` a later process Codex gave the same key, which ended on its own.
    // ⚑ One still listed keeps its mark, for the ending a later read publishes.
    for (const { id } of ended) {
      if (!this.level.some((row) => row.id === id)) this.confirmedStopped.delete(id)
    }
    return ended
  }

  /**
   * ⛔ **ONE edge: a turn ended.** Everything else is the poll.
   *
   * ⚑ **It is the instant the app is about to say `idle`** over a process the probe measured still
   * running four seconds into a 400-second command, and `250`'s finding is exactly what a wrong
   * answer there costs.
   *
   * ## ⛔ Why `item/started` is NOT an edge — found by reviewing this dispatch's own diff
   *
   * ⚠️ **The first version refreshed on every `commandExecution` item, and it would have broken every
   * ordinary Codex command in the app.** Codex lists a command as a background terminal from the
   * instant its process exists — measured at **t = 0 ms** — so a plain `git status` that outlives one
   * IPC round trip would have entered the level, left it a moment later, and been published as a
   * `background_work.ended`. `ToolEntry`'s rule since `248` is that a detachment OUTRANKS the
   * receipt, so that card would have rendered *"ended, outcome not reported"* in place of the `done`
   * its `tool_result` had already earned. ⛔ A registry that names foreground work is the mirror of
   * the defect `247` fixed, and it would have shipped inside the fix for it.
   *
   * ⚑ **A turn boundary is the honest discriminator, and it is `247`'s own definition of the
   * subject**: work that OUTLIVES THE TURN. A command still running when its turn ends is exactly
   * that; one that starts and finishes inside a turn is not background work by any reading, and this
   * never asks about it. ⚠️ It also all but removes `275` §1's *"unnecessary request"* hazard: one
   * list per turn end on a Codex conversation, and none at all on a quiet one.
   */
  note(method: string): void {
    if (method === 'turn/completed') this.refresh()
  }

  /**
   * Ask for the level, publish what changed. Fire-and-forget: a caller never waits on a provider.
   *
   * ⚠️ **Single-flight with ONE coalesced follow-up.** A turn that runs six quick commands raises
   * twelve edges; without this it would raise twelve overlapping list requests whose answers could
   * land out of order and publish an older level last. With it, the worst case is two requests in
   * flight over the whole burst and the last one published is the last one asked for.
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
        // ⛔ **A failed read RE-ARMS** (287 finding 3) — see {@link MAX_RETRY_MS}. After the
        // coalesced follow-up, because a read that is about to happen anyway is a better answer
        // than one scheduled for two seconds' time.
        if (failed) this.retryLater()
      })
    void this.inFlight
  }

  /**
   * 🔴 **Ask again after a read failed, while there is still something to be wrong about** (287
   * finding 3).
   *
   * ⛔ **The condition is the last authoritative LEVEL, not the last request.** An empty level means
   * the screen is already claiming nothing, so a failed read costs nothing and there is nothing to
   * correct; a non-empty one means every surface in the app is saying *"still running"* on our
   * authority, and the poll is the only thing that can ever withdraw it. `247`'s rule for this whole
   * family is that it must fail toward forgetting — and a watch that has stopped watching fails the
   * other way.
   *
   * ⚠️ **It replaces whatever was armed rather than adding to it.** `readAndPublish` throws before
   * it can reach {@link watchWhile}, so in practice nothing is armed here; clearing anyway is what
   * keeps that from being a fact about today's call order.
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

  /**
   * Arm the follow-up read while something is running; disarm the moment nothing is.
   *
   * ⚠️ **Re-armed rather than left running**, so the interval is measured from the last ANSWER
   * rather than from the last request — a slow provider cannot make these overlap.
   */
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
   * ⛔ **Read every page, then publish once.**
   *
   * ⚠️ **A failed read publishes NOTHING**, and that is the direction `247` chose for this whole
   * family: *"the failure available to this surface is a row that disappears slightly early, not one
   * that says 'still running' for ever."* Publishing `running: []` because a request failed would be
   * the opposite — an empty registry asserted from an answer nobody gave, which is the stale
   * indicator's mirror image and just as wrong.
   *
   * ⛔ **Publishing nothing is only half an answer, and 287 finding 3 is the other half.** Saying
   * nothing is right; saying nothing AND never asking again is the stale indicator by a slower road,
   * because this poll is the only thing that can take a row away. {@link retryLater} is what keeps
   * the silence temporary.
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
    // Every page arrived, so whatever was wrong is over — the backoff starts again from the top.
    this.failures = 0
    if (!this.usable()) return
    // ⛔ **A cap is never silent** (092), and an unfinished pagination is a cap. Reported as a
    // non-fatal error rather than folded into `dropped`, because `dropped` is a COUNT and the number
    // of rows behind an unread cursor is precisely what this app does not know — a number here would
    // be the understatement `247` §3 calls worse than no registry at all.
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
    // ⛔ **Only when it CHANGED**, and this is not an optimisation. Every turn on every Codex
    // conversation ends with a read, and most of them answer *"nothing is running"* — publishing that
    // would put one `background_work` frame per turn into the wire, the renderer's fold and the
    // durable ledger, for ever, saying exactly what the previous one said. ⚠️ **`247`'s REPLACE rule
    // is not weakened by it**: a level that has not changed replaces the registry with itself, so a
    // consumer sees the same set either way, and the one thing a skipped frame could hide — a set
    // that DID change — is precisely what this compares.
    if (this.sameAsPublished(running, dropped) && gone.length === 0) return
    this.published = { ids: running.map((row) => row.id).join('\u0000'), dropped }
    this.deps.emit({
      type: 'background_work',
      running,
      ...(dropped > 0 ? { dropped } : {}),
      source: BACKGROUND_TERMINALS_SOURCE,
    })
  }

  /** Is this the level we last put on the stream — the ids, in order, and the shortfall beside them. */
  private sameAsPublished(running: readonly BackgroundWork[], dropped: number): boolean {
    return (
      this.published !== null &&
      this.published.dropped === dropped &&
      this.published.ids === running.map((row) => row.id).join('\u0000')
    )
  }
}
