import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { AsyncQueue } from '../internal/async-queue'
import {
  endTree,
  fileTimeOf,
  isRunning,
  readTable,
  startEnder,
  treeOf,
  type KnownRow,
  type TableReading,
  type TableRow,
} from './windows-tree'

/**
 * 🔴 **706 · the app-server ANSWERED a request, and the answer was a JSON-RPC error** — told apart,
 * by its type, from a transport that could not ask at all (a child that exited, a pipe that broke).
 *
 * ⚑ **What it carries is what the app-server sent**: the request it refused and the error object
 * exactly as it arrived (`{ code, message, data? }`). ⛔ **The message is the one `main` built** —
 * `JSON.stringify` of that object, byte for byte — so every sentence and log line that quotes a
 * refusal reads the same; what is new is that a caller can ask WHICH request was refused and HOW
 * without parsing a string.
 *
 * ⚠️ **Why it exists** (`705` F-3): Codex answers a resume of a thread it no longer has with
 * `-32600` and words (`probe:codex-lost-thread`, `0.146.0`), and the adapter must read that answer
 * as the app-server's — never confuse it with an app-server that died before answering, which is a
 * failure of the attempt and is the plain `Error` it always was.
 */
export class CodexRequestRefused extends Error {
  constructor(
    /** The client→server request the app-server refused, e.g. `thread/resume`. */
    readonly method: string,
    /** The JSON-RPC `error` member, as received — never reshaped. */
    readonly refusal: unknown,
  ) {
    super(JSON.stringify(refusal))
    // ⛔ **No `name` of its own**: `String(error)` of a refused `account/rateLimits/read` is written to
    // the ledger (`readRateLimitBaseline`), and it must keep reading `Error: …` as it always has.
  }
}

/**
 * 🔴 **D-039 · R2 — the app-server's process ENDED**: the transport's terminal error when the child
 * exits ({@link SpawnCodexTransport}'s `onExit`), whatever request was waiting on it.
 *
 * ⚑ **Told apart by its TYPE** from the two other ends a request can meet: a spawn that failed
 * (its errno is the cause) and this app's own close (`codex transport closed` — a cancel, a
 * deadline, a teardown). ⚑ A launch that meets it is `StartFailed` (`codex-runtime.ts`).
 * ⛔ **No `name` of its own**, {@link CodexRequestRefused}'s rule.
 */
export class CodexExited extends Error {}

/** A message the app-server initiates (notification) or asks us to answer (request). */
export type CodexIncoming =
  | { kind: 'notification'; method: string; params: unknown }
  | { kind: 'request'; id: string | number; method: string; params: unknown }

/**
 * The `codex app-server` transport (JSON-RPC-ish over newline-delimited JSON on
 * stdio). Kept behind this interface so a fake transport unit-tests the handle
 * with no live process (mirrors 005's query-factory seam).
 *
 * `close()` may return a promise (the real transport awaits a bounded child exit,
 * 012); callers `await` it. Test fakes may return `void`.
 */
export interface CodexTransport {
  /** Send a client→server request and await its response (matched by id). */
  request(method: string, params: unknown): Promise<unknown>
  /** The size in bytes of the last answer to `method`, when this transport counts it. */
  responseBytes?(method: string): number | undefined
  /** Send a client→server notification (no response). */
  notify(method: string, params: unknown): void
  /** Answer a server→client request. */
  respond(id: string | number, result: unknown): void
  /** Answer a server→client request with a JSON-RPC error (protocol-safe reject). */
  respondError(id: string | number, code: number, message: string): void
  /** Notifications + server-initiated requests, in order. Single consumer. */
  incoming(): AsyncIterable<CodexIncoming>
  /** Shut the transport (kills the child process tree for the spawn transport). */
  close(): void | Promise<void>
  /**
   * The provider process this transport owns, or `undefined` when there is none (076).
   *
   * A sanctioned accessor rather than a reach into the private child: the PID we show the user must
   * be one we can PROVE belongs to this session. A `pgrep` would be a guess — several app-servers
   * can be running — and reading a private field would couple the host to the transport's internals.
   * Optional on the interface, so a test fake or a future non-spawning transport simply has none.
   */
  readonly pid?: number | undefined
  /**
   * ⛔ **The leader has exited — the FACT, published at last** (233, from 229 H1).
   *
   * ⚠️ **Nothing here is new except that a caller can read it.** {@link SpawnCodexTransport} has
   * collected this since 031: `child.on('exit')` → `onExit()` → `markExited()`. What it never did
   * was let go of it. `awaitExit(ms)` computes precisely the right boolean — *"true if the child
   * exits within `ms`, false on timeout"* — and **all three call sites in `doReapGroup` discard
   * it**, so the fact was computed and thrown away three times per teardown while `close()` went on
   * resolving at `exitGrace + killGrace + killGrace` (6 s by default) whether or not anything had
   * died. That is the same *"a bound became the receipt"* shape 229 H1 found in the Claude adapter,
   * and the remedy here is one line rather than a mechanism because the fact already existed.
   *
   * ⚠️ **It is the LEADER's exit, and the difference is worth stating rather than rounding off.**
   * The child is spawned `detached`, so teardown signals the whole group by negative pid — but
   * {@link SpawnCodexTransport.killGroup}'s fallback path, taken when `process.kill(-pid, …)`
   * throws for a reason other than a dead group, signals only `this.child`. A descendant the
   * app-server left running is therefore not covered by this promise. It says the leader is gone,
   * which is the process this transport spawned and the only one it can prove anything about.
   *
   * ## ⛔ What that limit is worth, MEASURED (240, from 233's own caveat and 191 M2)
   *
   * `pnpm run probe:orphan-descendant` builds the tree 202 named and did not build — a real leader
   * that spawns a real descendant and then exits cooperatively on stdin EOF — and drives it through
   * this class. Both columns are one run of one fixture, the second with this dispatch reverted:
   *
   * | descendant | `close()` before → after | signals it saw | alive when `close()` resolved | group still had a member |
   * |---|---|---|---|---|
   * | none — ⚑ **the healthy path** | **3 ms → 2 ms** | — | no → no | no → no |
   * | in the group, cooperative | 3 ms → 26 ms | ⛔ none → `SIGTERM` | ⛔ **yes** → no | ⛔ **yes** → no |
   * | in the group, 300 ms cleanup | 3 ms → 322 ms | ⛔ none → `SIGTERM` | ⛔ **yes** → no | ⛔ **yes** → no |
   * | in the group, stubborn | 2 ms → 2 042 ms | ⛔ none → `SIGTERM` | ⛔ **yes** → no | ⛔ **yes** → no |
   * | ⛔ **escaped (`setsid`)** | 3 ms → 3 ms | none → none | ⛔ yes → **yes** | no → no |
   *
   * ⚠️ **`exited` settled in 1–4 ms in every row of both columns**, including the one where a
   * descendant runs for ever. That is the fact 233 published, doing exactly what it promises.
   *
   * ⚑ **Three findings, and only two of them are fixable here.**
   *
   *  1. ⛔ **`close()` resolved while a descendant was still running, 3 rows out of 3** — and the
   *     process GROUP still had a running member at that instant in all three. Every grace in
   *     `doReapGroup` was an {@link SpawnCodexTransport.awaitExit}, which races {@link exited} —
   *     already settled the moment the leader died. So SIGTERM and SIGKILL went out ~1 ms apart and
   *     the teardown returned without ever asking about the group. That is what
   *     {@link SpawnCodexTransport.awaitGroupQuiet} changes, and it is why `close()` resolving now
   *     means *"nothing in the group we spawned is still running"* rather than *"the leader died"*.
   *  2. ⛔ **No descendant ever ran its own SIGTERM handler** — `signals` was empty even for the
   *     COOPERATIVE one, which would have exited on it. A sandboxed command has therefore never had
   *     an instant in which to shut down; it has only ever been SIGKILLed. The probe's `slow-clean`
   *     row pins the repair with a marker file a SIGKILLed process could not have written.
   *  3. ⛔ **A descendant that calls `setsid` is in nobody's group but its own, and NOTHING here can
   *     reach it or see it.** `kill(-pid, …)` misses it by definition, and so does the quiet check.
   *     ⚠️ **This promise, and `close()`, therefore say "the group we spawned is empty" and never
   *     "no descendant survives".** 074's ruling is why that sentence is written down instead of
   *     rounded up: a confident wrong answer is worse than an honest absence, and 191 M2's orphan
   *     is real — it just leaves by a door we do not hold.
   *
   * ⚑ **Resolved when no process ever ran, too** — `onSpawnError` marks it, because a spawn that
   * failed leaves nothing running and "nothing to wait for" is the honest answer, not a hang.
   *
   * Optional for {@link CodexTransport.pid}'s reason: a fake or a non-spawning transport has none,
   * and its absence must be read as *"this transport cannot say"* and never as an exit.
   */
  readonly exited?: Promise<void>
  /** Positive cleanup fact for the owned group/tree; never a teardown deadline. */
  readonly quiesced?: Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** What {@link SpawnCodexTransport} needs to spawn; the tuning fields keep tests fast. */
export interface SpawnCodexOptions {
  /**
   * 🔒 **The child's environment — REQUIRED, and it REPLACES the inherited one** (063, from 061
   * finding 4).
   *
   * It used to be optional, and omitting it handed the `app-server` the desktop app's whole ambient
   * environment: every API key, token and desktop-only secret in `process.env`, inherited in turn by
   * every tool Codex launches. The supported path never did that — {@link
   * createSpawnTransportFactory} passes a sanitized copy with `CODEX_HOME`/`CODEX_SQLITE_HOME`
   * pinned to the app-owned profile home and auth vars stripped (021, from 015) — but the safe
   * boundary lived only in the factory, and the constructor below it was public and forgiving. A
   * consumer who reasonably reached for the class got the unsafe spawn by writing nothing at all.
   *
   * Required makes the unsafe choice a visible one: inheritance is still available, but it has to be
   * spelled `env: process.env` **at the call site**, where a reader and a reviewer can see it. There
   * is no default to be wrong about, because the failure mode of the old default was silent.
   */
  env: NodeJS.ProcessEnv
  cwd?: string
  /** Max stderr kept as a diagnostic tail (ring buffer). */
  stderrTailBytes?: number
  /** How long to await a graceful exit after ending stdin, before SIGTERM. */
  exitGraceMs?: number
  /** How long to await exit after SIGTERM, before SIGKILL. */
  killGraceMs?: number
  /**
   * On Windows, how long the whole stop may take, process-table readings included: inside the host's
   * own wait for a closing conversation (5 s), so every ending is done before it lets go.
   */
  stopBudgetMs?: number
  /** On Windows, one reading of the process table within `ms`; Windows' own by default. */
  processTable?: (ms: number) => Promise<TableReading | null>
}

const DEFAULTS = {
  stderrTailBytes: 16 * 1024,
  exitGraceMs: 2000,
  killGraceMs: 2000,
  stopBudgetMs: 4500,
}

/** How long a reading taken while the app-server runs may take: nothing waits on it. */
const SAMPLE_TIMEOUT_MS = 15_000

/** Persistent table failures may release only after all remembered process numbers are gone. */
const WINDOWS_TABLE_FAILURE_RELEASE_MS = 120_000

/** How many processes of its tree a transport remembers. */
const KNOWN_MOST = 4096

/**
 * How long the app-server is given to stop on its own after its stdin ends, before anything is
 * ended for it. ⚑ **On Windows, both graces**: there is no signal a console program can be asked to
 * stop with, so the end of stdin is the whole graceful stop there, and it is given as long as POSIX
 * gives between the end of stdin and SIGKILL. Elsewhere, the first grace, and then SIGTERM.
 */
export function gracefulStopMs(
  platform: NodeJS.Platform,
  graces: { readonly exitGraceMs: number; readonly killGraceMs: number },
): number {
  return platform === 'win32' ? graces.exitGraceMs + graces.killGraceMs : graces.exitGraceMs
}

/**
 * How often to ask the kernel whether the process group has emptied (240).
 *
 * There is no event for "the last member of a group exited" — `SIGCHLD` is about our own children —
 * so the only instrument is a poll. 20 ms is well under the smallest grace this class ships with
 * (2 000 ms) and costs one `kill(-pid, 0)` per tick, which is a permission check and no more.
 */
const GROUP_POLL_MS = 20

/**
 * The real transport: spawns `codex app-server` and frames JSON lines over stdio.
 * Hardened (012, fixing 007 P1-5):
 *  - **stderr is continuously drained** into a bounded ring so a chatty child
 *    can never fill the OS pipe and backpressure the response path (deadlock).
 *  - **one terminal transition** ({@link terminate}) — spawn-error, child-exit,
 *    or `close()` — rejects every pending request, makes future `request`/`write`
 *    fail, and closes the incoming stream so `incoming()` completes. Nothing is
 *    ever left un-settled.
 *  - **`write()` throws once terminal** (never a silent never-settle).
 *  - **`close()` awaits a bounded exit**: end stdin → await → SIGTERM → await →
 *    SIGKILL, all on the child's **process group** (spawned `detached`) so
 *    descendants can't outlive teardown.
 */
export class SpawnCodexTransport implements CodexTransport {
  private readonly child: ChildProcessWithoutNullStreams

  /**
   * The spawned app-server's PID (076) — real, ours, and `undefined` once the child is gone.
   *
   * ⚠️ **This used to say Node clears `pid` after exit. Node does not** (074, from 069 §2.2). That
   * sentence was written as established fact, twice — here and in `runtime-host.ts` — and it is
   * false on every version this app can run on. Measured, spawning a child that exits immediately
   * and reading `child.pid` after its `exit` event:
   *
   * | Node | while alive | after exit |
   * |---|---|---|
   * | v20.19.3 / v22.15.1 / v22.22.0 / v24.0.2 (the repo's `.nvmrc` major) | `46159` | **`46159`**, still a `number` |
   * | v24.18.0 — **the one Electron 43 actually runs the main process on** | `24659` | **`24659`** |
   *
   * So `describeProviderProcess` kept rendering `codex pid <n>` for a process that had exited, which
   * its own comment three lines up already called the worse failure: *"a confident wrong PID is
   * worse than an honest absence."*
   *
   * ⚠️ `child.killed` is not the test either — it means "a signal was delivered", and the measured
   * child above exited normally with `killed === false`. Deadness is tracked explicitly instead, off
   * the two transitions that mean there is no process: `exit`, and a spawn that never produced one.
   */
  get pid(): number | undefined {
    return this.dead ? undefined : this.child.pid
  }
  /** Set on the terminal transitions below; read only by {@link pid}. */
  private dead = false
  /** When the app-server was started and when it exited, as FILETIMEs: its tree on Windows. */
  private readonly startedAt = fileTimeOf(Date.now())
  private endedAt: bigint | null = null
  /**
   * On Windows, every process a reading found in the app-server's tree, by number and creation time,
   * whether it still runs or not: what a process started is found under it after it exits.
   */
  private readonly known = new Map<string, KnownRow>()
  /** The reading taken while the app-server runs, and whether another is owed when it is done. */
  private sampling: Promise<void> | null = null
  private sampleOwed = false
  private readonly queue = new AsyncQueue<CodexIncoming>()
  private readonly pending = new Map<
    number,
    { method: string; resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  private nextId = 1
  /** The size of the last answer to each method, counted as its line arrived. */
  private readonly answerBytes = new Map<string, number>()
  private buffer = ''
  private stderrTail = ''
  /** Non-null once the transport is terminal; the reason every pending/future op is rejected with. */
  private terminalError: Error | null = null
  /** Single-flight guard so repeated/concurrent close() share one teardown. */
  private closing: Promise<void> | null = null
  /** Single-flight bounded process-group teardown; runs on EVERY terminal transition (031). */
  private reaping: Promise<void> | null = null
  private windowsStopReading: Promise<void> | null = null
  private knownHistoryComplete = true
  /**
   * ⚑ **`readonly` and now PUBLIC** (233) — see {@link CodexTransport.exited}. Private, this was a
   * fact three lines of `doReapGroup` computed and dropped on the floor.
   */
  readonly exited: Promise<void>
  readonly quiesced: Promise<void>
  private markQuiesced!: () => void
  private markExited!: () => void
  private readonly opts: Required<Omit<SpawnCodexOptions, 'cwd' | 'env'>>
  /**
   * The sqlite home THIS spawn pinned (180), kept so a startup failure can name it.
   *
   * ⛔ **Read from our own env rather than parsed out of the child's stderr, and that is not a
   * preference.** The provider prints the path inside a sentence; on macOS the real home lives under
   * `~/Library/Application Support/…`, so a whitespace-delimited capture hands the user
   * `/Users/x/Library/Application` and stops. The app knows this path — it is the one it just spawned
   * with — so it says that one.
   */
  private readonly sqliteHome: string

  /**
   * ⚠️ **No parameter has a default any more** (063). `command` defaulted to the bare string
   * `'codex'` and `args` to `['app-server']`, so the most convenient way to construct this class was
   * also the one that did a PATH lookup and inherited the ambient environment. Every call site in
   * this repo already passed all three; the defaults only served a call nobody should make.
   */
  constructor(command: string, args: string[], options: SpawnCodexOptions) {
    this.opts = {
      stderrTailBytes: options.stderrTailBytes ?? DEFAULTS.stderrTailBytes,
      exitGraceMs: options.exitGraceMs ?? DEFAULTS.exitGraceMs,
      killGraceMs: options.killGraceMs ?? DEFAULTS.killGraceMs,
      stopBudgetMs: options.stopBudgetMs ?? DEFAULTS.stopBudgetMs,
      processTable: options.processTable ?? readTable,
    }
    this.sqliteHome = options.env['CODEX_SQLITE_HOME'] ?? options.env['CODEX_HOME'] ?? ''
    const groupQuiet = new Promise<void>((resolve) => {
      this.markQuiesced = resolve
    })
    this.exited = new Promise<void>((resolve) => {
      this.markExited = resolve
    })
    this.quiesced = Promise.all([this.exited, groupQuiet]).then(() => undefined)
    // `detached` → the child leads its own process group; teardown kills the
    // whole group (negative pid) so descendants don't survive. `env` REPLACES the
    // inherited environment with the caller's copy — always, since it is now
    // required (063): there is no branch left that could fall back to ambient.
    //
    // ## ⚑ What a HARD death of this process leaves behind, measured (202, ruling on 191 M2)
    //
    // `191` M2 reads *"a SIGKILL leaves detached Codex process groups reparented to init"*, and the
    // reasoning is sound — `detached` is exactly what stops the group being signalled with us.
    // Measured against the pinned binary, spawning it exactly as this line does and SIGKILLing the
    // parent:
    //
    // | child | alive 3 s after the parent was SIGKILLed |
    // |---|---|
    // | `codex app-server` | **0 / 3** |
    // | the Claude CLI, spawned by the SDK's own transport | **0 / 3** |
    // | a control child that ignores stdin (`sleep 40`) | ⛔ **2 / 2**, reparented to pid 1 |
    //
    // ⛔ **`stdio: ['pipe', …]` is why.** Our end of stdin dies with us, the app-server reads EOF and
    // exits on its own — the same cooperative shutdown `doReapGroup` starts with. The control row is
    // what makes that a measurement rather than a hope: the instrument CAN see an orphan, and this
    // spawn does not produce one.
    //
    // ⚠️ **What it does not cover**, and an orphan reaper would have to: a descendant the app-server
    // itself spawned and left running (a sandboxed command), and an app-server wedged badly enough
    // not to be reading stdin at all. Neither has been observed; both are why the honest answer to
    // 191 M2 is "the premise does not hold for the process we spawn", not "orphans are impossible".
    this.child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd,
      // ⚑ **F072 — not on Windows**, which has no process group to lead: there a detached child
      // gets no console at all, and the app-server and the commands it runs are stopped as a tree
      // instead ({@link reapWindowsTree}). A hidden console is what a console program needs there.
      detached: process.platform !== 'win32',
      env: options.env,
      windowsHide: true,
    })
    // 🔴 **705 · R39 — LISTEN FIRST, before a single stream is touched.** ⛔ Node reports a spawn that
    // ran out of descriptors (`EMFILE`/`ENFILE`) a tick after `spawn` returns — and returns WITHOUT
    // assigning `stdin`/`stdout`/`stderr`. This constructor used to reach for `stdout.setEncoding`
    // first: a `TypeError` about `undefined` was all a resume could report, and the listener below
    // was never attached, so the `EMFILE` itself was then emitted to nobody — an uncaught exception
    // in the process that spawned it (measured: `the-errno-a-resume-carries.test.ts` §2).
    this.child.on('exit', () => this.onExit())
    this.child.on('error', (error) => this.onSpawnError(error))
    // ⚑ **No streams means the spawn failed and says so next tick** ({@link onSpawnError}); until then
    // {@link write} holds its words, and the terminal transition rejects what was pending. ⚠️ Read
    // through a widened type: `ChildProcessWithoutNullStreams` promises streams Node did not assign.
    this.streamless = (this.child as { stdout?: unknown }).stdout === undefined
    if (this.streamless) return
    this.child.stdout.setEncoding('utf8')
    this.child.stderr.setEncoding('utf8')
    this.child.stdout.on('data', (chunk: string) => this.onStdout(chunk))
    this.child.stderr.on('data', (chunk: string) => this.onStderr(chunk))
    // Swallow EPIPE etc. on stdin so a broken pipe can't crash the process; the
    // terminal transition + `write` guard are the real failure signal.
    this.child.stdin.on('error', () => {})
  }

  /**
   * ⚑ **705 · a spawn Node returned from without streams** — `EMFILE`/`ENFILE`. Nothing can be written
   * and nothing will be read; the `'error'` that says why is already queued.
   */
  private readonly streamless: boolean

  // --- stdout framing (split / partial / multiple-per-chunk, non-JSON ignored) ---

  private onStdout(chunk: string): void {
    this.buffer += chunk
    let newline: number
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (line) this.handleLine(line)
    }
  }

  private handleLine(line: string): void {
    let message: unknown
    try {
      message = JSON.parse(line)
    } catch {
      return // non-JSON log line on stdout — ignore
    }
    if (!isRecord(message)) return
    const hasId = 'id' in message && message['id'] != null
    const hasMethod = typeof message['method'] === 'string'

    if (hasId && hasMethod) {
      this.queue.push({
        kind: 'request',
        id: message['id'] as string | number,
        method: message['method'] as string,
        params: message['params'],
      })
    } else if (hasMethod) {
      if (message['method'] === 'item/started') this.lookAtTheTree()
      this.queue.push({
        kind: 'notification',
        method: message['method'] as string,
        params: message['params'],
      })
    } else if (hasId) {
      const id = message['id']
      const waiter = typeof id === 'number' ? this.pending.get(id) : undefined
      if (waiter && typeof id === 'number') {
        this.pending.delete(id)
        this.answerBytes.set(waiter.method, Buffer.byteLength(line, 'utf8'))
        if (message['error'] != null) {
          waiter.reject(new CodexRequestRefused(waiter.method, message['error']))
        } else waiter.resolve(message['result'])
      }
    }
  }

  /**
   * On Windows, reads the process table when the app-server starts an item, a command among them,
   * and keeps what it started, with when it was last seen running: a launcher that starts a program
   * and exits is then still known when the program it left running is looked for. One reading at a
   * time; items started meanwhile owe one more.
   *
   * ⚠️ **A known limit, which readings cannot close**: a launcher that starts a program and exits
   * before any reading sees it leaves that program unfound, and so does one that starts it after the
   * last reading that saw it running. Such a program can outlive `close()`. A job object that ends
   * every process in it when closed would contain them.
   */
  private lookAtTheTree(): void {
    if (process.platform !== 'win32' || this.dead || this.child.pid === undefined) return
    if (this.sampling !== null) {
      this.sampleOwed = true
      return
    }
    const pid = this.child.pid
    this.sampling = (async () => {
      do {
        this.sampleOwed = false
        const reading = await this.opts.processTable(SAMPLE_TIMEOUT_MS)
        if (reading !== null) {
          const leader = { pid, startedAt: this.startedAt, endedAt: this.endedAt }
          this.remember(treeOf(reading.rows, leader, [...this.known.values()]), reading.at)
        }
      } while (this.sampleOwed && !this.dead)
    })()
      .catch(() => {})
      .finally(() => {
        this.sampling = null
      })
  }

  /** Keeps `rows`, which a reading taken `at` found running in the tree. */
  private remember(rows: readonly TableRow[], at: bigint): void {
    for (const row of rows) {
      const key = `${String(row.pid)}:${String(row.created)}`
      if (!this.known.has(key) && this.known.size >= KNOWN_MOST) {
        const oldest = this.known.keys().next().value
        if (oldest !== undefined) {
          this.knownHistoryComplete = false
          this.known.delete(oldest)
        }
      }
      this.known.set(key, { ...row, seenAt: at })
    }
  }

  private onStderr(chunk: string): void {
    // Bounded ring: keep only the most recent tail for diagnostics.
    const combined = this.stderrTail + chunk
    this.stderrTail =
      combined.length > this.opts.stderrTailBytes
        ? combined.slice(-this.opts.stderrTailBytes)
        : combined
  }

  // --- the single terminal transition ---

  private onSpawnError(error: Error): void {
    this.dead = true // there is no process to name (074)
    this.markExited() // no process ever ran
    // 🔴 **705 · R39 — the errno is the CAUSE, not a word in the message.** ⛔ It was `new Error(text)`:
    // the code survived only as text, and a wake — which classifies by type, never by text — could
    // not tell a machine that ran short for a moment from a binary that is not there.
    this.terminate(
      new Error(`codex app-server failed to spawn: ${error.message}${this.stderrSuffix()}`, {
        cause: error,
      }),
    )
  }

  private onExit(): void {
    // ⚠️ **Before `markExited`, and before `terminate`** (074). Both of those can run listeners, and
    // a disclosure republished from inside one of them would read `pid` while this still said the
    // child was alive. Set first, so there is no instant in which the getter can name a dead process.
    this.dead = true
    this.endedAt = fileTimeOf(Date.now())
    this.markExited()
    this.terminate(new CodexExited(this.exitMessage()))
  }

  /**
   * What the user is told when the child dies (180).
   *
   * ⛔ **`failed to initialize sqlite state runtime` is not a sentence anyone should meet**, and
   * until 180 it was forwarded verbatim — through `codex app-server exited (stderr tail: …)`, onto
   * the launcher, as the whole of what a first message got you. It is the one startup failure this
   * app can recognise, so it is the one it says in its own words.
   *
   * ⚠️ **"usually", not "because"**: an unwritable home or a half-copied profile reach the same Rust
   * line, and naming a cause we did not observe would be the fabrication the honest-reason rule
   * (151/162) exists to stop. The home is named because it is the actionable specific — from
   * {@link sqliteHome}, never scraped out of the sentence below it — and the retry is named because
   * 180 measured that it works: the collision window is ~20 ms wide.
   *
   * Everything else is forwarded as it always was: a tail we cannot read is still better than
   * silence, and inventing a sentence per unknown failure is how a product starts lying.
   *
   * ⚠️ **D-039 · R2 — at a start it is the log's now**: a launch that meets this exit is
   * `StartFailed`, which a person and a giver are told in one fixed sentence that keeps the retry
   * (`its-provider-could-not-be-started`, `agent-did-not-start`) — a stderr tail can carry 500
   * bytes of the child's own output, and a giver reads no path. ⚑ Mid-life, it is still what the
   * fatal `error` says.
   */
  private exitMessage(): string {
    if (!/failed to initialize sqlite state runtime/i.test(this.stderrTail)) {
      return `codex app-server exited${this.stderrSuffix()}`
    }
    const where = this.sqliteHome ? ` in ${this.sqliteHome}` : ''
    return (
      `Codex could not open its own database${where}, so it stopped before it started. ` +
      `Something else was most likely using it at that moment — try again.`
    )
  }

  /**
   * The one terminal transition (idempotent): reject every pending request, make
   * future `request`/`write` fail, close the incoming stream so `incoming()`
   * completes, and **reap the process group** (031, fixing 023 P1-E). Called by
   * spawn-error, unexpected child-exit, and `close()` — so a descendant spawned in
   * the group is reaped on ANY termination, not only the explicit `close()` path.
   */
  private terminate(error: Error): void {
    if (this.terminalError) return
    this.terminalError = error
    for (const waiter of this.pending.values()) waiter.reject(error)
    this.pending.clear()
    this.queue.close()
    // Bounded group teardown on every terminal transition (single-flight, best-effort).
    // `close()` awaits it; the crash/spawn-error paths let it run in the background.
    void this.reapGroup()
  }

  private stderrSuffix(): string {
    const tail = this.stderrTail.trim()
    return tail ? ` (stderr tail: ${tail.slice(-500)})` : ''
  }

  // --- client → server ---

  request(method: string, params: unknown): Promise<unknown> {
    if (this.terminalError) return Promise.reject(this.terminalError)
    const id = this.nextId++
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject })
      try {
        this.write({ id, method, params })
      } catch (error) {
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  responseBytes(method: string): number | undefined {
    return this.answerBytes.get(method)
  }

  notify(method: string, params: unknown): void {
    this.write({ method, params })
  }

  respond(id: string | number, result: unknown): void {
    this.write({ id, result })
  }

  respondError(id: string | number, code: number, message: string): void {
    this.write({ id, error: { code, message } })
  }

  private write(object: Record<string, unknown>): void {
    if (this.terminalError) throw this.terminalError // never a silent never-settle (007 P1-5)
    // ⚑ **705 · no stream to write to: the spawn failed and its `'error'` is queued.** A request made
    // now stays pending, and {@link onSpawnError}'s terminal transition rejects it WITH the errno —
    // never a silent never-settle, because Node always delivers that `'error'`.
    if (this.streamless) return
    this.child.stdin.write(`${JSON.stringify(object)}\n`)
  }

  incoming(): AsyncIterable<CodexIncoming> {
    return this.queue
  }

  // --- teardown ---

  close(): Promise<void> {
    // Single-flight: repeated/concurrent close() share one bounded teardown.
    return (this.closing ??= this.doClose())
  }

  private async doClose(): Promise<void> {
    // Terminal first: reject pending + close incoming + fail future writes, so no
    // caller hangs regardless of how the child exit races. `terminate` also fires the
    // (single-flight) bounded group teardown; awaiting it here is the explicit path.
    this.terminate(new Error('codex transport closed'))
    await this.reapGroup()
  }

  /** The bounded process-group teardown, single-flight — runs at most once per transport (031). */
  private reapGroup(): Promise<void> {
    return (this.reaping ??= this.doReapGroup().then((quiet) => {
      if (quiet) this.markQuiesced()
      else if (process.platform === 'win32') void this.observeWindowsTreeExit()
      else void this.observeGroupExit()
    }))
  }

  /** Observe late cleanup without extending close or sending any more termination requests. */
  private async observeWindowsTreeExit(): Promise<void> {
    const pid = this.child.pid
    if (pid === undefined) return
    let pauseMs = 1000
    let failedSince: number | null = null
    for (;;) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, pauseMs)
        timer.unref?.()
      })
      let unavailable = true
      try {
        // A live sampling read may still be finishing; never overlap it with another table read.
        await this.sampling
        await this.windowsStopReading
        const endedAt = this.endedAt
        if (endedAt !== null) {
          const reading = await this.opts.processTable(SAMPLE_TIMEOUT_MS)
          if (reading !== null && reading.at >= endedAt) {
            unavailable = false
            const known = [...this.known.values()]
            const identities = new Set([pid, ...known.map((row) => row.pid)])
            const unknown = reading.rows.some(
              (row) => row.created <= 0n && (identities.has(row.pid) || identities.has(row.ppid)),
            )
            const tree = treeOf(reading.rows, { pid, startedAt: this.startedAt, endedAt }, known)
            this.remember(tree, reading.at)
            if (!unknown && tree.length === 0) {
              this.markQuiesced()
              return
            }
          }
        }
      } catch {
        // Retry failed queries; they do not establish which descendants remain.
      }
      if (!unavailable) failedSince = null
      else if (this.endedAt !== null) {
        failedSince ??= Date.now()
        if (
          Date.now() - failedSince >= WINDOWS_TABLE_FAILURE_RELEASE_MS &&
          this.rememberedWindowsPidsAreGone(pid)
        ) {
          console.warn(
            `codex app-server ${String(pid)}: releasing the transcript after persistent process-table ` +
              'failures; the leader exited and all remembered PIDs are gone, but unobserved ' +
              'descendants may still be running and writing the transcript',
          )
          this.markQuiesced()
          return
        }
      }
      pauseMs = Math.min(pauseMs * 2, 30_000)
    }
  }

  /** Number-only probes can hold a reused PID, but never signal or adopt it. */
  private rememberedWindowsPidsAreGone(leader: number): boolean {
    if (!this.knownHistoryComplete) return false
    for (const pid of new Set([leader, ...[...this.known.values()].map((row) => row.pid)])) {
      try {
        process.kill(pid, 0)
        return false
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return false
      }
    }
    return true
  }

  /**
   * ⛔ **The grace between SIGTERM and SIGKILL waits for the GROUP, not for the leader** (240).
   *
   * ⚠️ **The sentence above this function used to be self-refuting**: *"a descendant can OUTLIVE the
   * leader, so we never skip the group kill just because the leader exited … each `awaitExit`
   * resolves instantly once the leader is gone, so this stays bounded on every path."* Both halves
   * are true and together they mean the group kill was skipped in all but name — the signals were
   * sent, and then every grace that was supposed to let them work returned in the same millisecond,
   * because {@link awaitExit} races {@link exited} and {@link exited} was already settled. Measured
   * on the tree in {@link CodexTransport.exited}'s table: SIGTERM and SIGKILL ~1 ms apart, no
   * descendant ever reaching its own handler, and `close()` resolving over a live process every
   * time.
   *
   * ⚑ **The first grace is still the LEADER's**, and deliberately: it follows `stdin.end()`, which
   * is addressed to the leader and to nothing else, and making it wait for the group would delay
   * the group's SIGTERM by the full `exitGraceMs` in exactly the case that needs it soonest.
   *
   * ⚑ **The healthy path is unchanged and that is checked rather than asserted.** With no
   * descendant, the group is empty the instant the leader exits, {@link groupIsQuiet} answers
   * synchronously on the first iteration, and no timer is ever armed. The probe's `none` row is the
   * control: **3 ms before, 2 ms after** — 233 measured 0 ms added on the healthy path and this adds
   * 0 ms to it. ⚠️ **The wedged path is where the time goes, deliberately and bounded**: up to
   * `killGraceMs` for a descendant that ignores SIGTERM, which is inside the host's own 5 s
   * `closeDrainTimeoutMs` and is in fact SHORTER than the 6 s this function could take before,
   * because two of its three graces now end as soon as the group is empty rather than always
   * expiring.
   */
  private async doReapGroup(): Promise<boolean> {
    // End stdin so a cooperative leader can exit; ignore if it's already gone.
    try {
      this.child.stdin.end()
    } catch {
      // stdin may already be gone
    }
    if (process.platform === 'win32') return this.reapWindowsTree()
    // A descendant can OUTLIVE the leader, so we never skip the group kill just because the leader
    // exited (that was the 023 P1-E bug): SIGTERM the whole group, wait a bounded grace, then
    // SIGKILL whatever is still there.
    await this.awaitExit(gracefulStopMs(process.platform, this.opts))
    this.killGroup('SIGTERM')
    if (await this.awaitGroupQuiet(this.opts.killGraceMs)) return true
    // ⚑ **Only if something is still there.** Signalling a group we have just proven empty would be
    // a `kill(-pid, …)` at a pid that no longer belongs to us — see {@link killGroup} on reuse.
    this.killGroup('SIGKILL')
    // Bounded even here: an unreapable child (D-state / blocked reaping) must not hang teardown
    // forever — return once the final grace elapses regardless, and SAY so, because a teardown that
    // gave up and a teardown that finished are two different facts.
    if (await this.awaitGroupQuiet(this.opts.killGraceMs)) return true
    console.warn(
      `codex app-server group ${this.child.pid ?? '(no pid)'} still had a member ` +
        `${this.opts.killGraceMs}ms after SIGKILL — a descendant it spawned may still be running`,
    )
    return false
  }

  private async observeGroupExit(): Promise<void> {
    while (!this.groupIsQuiet()) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1000)
        timer.unref?.()
      })
    }
    this.markQuiesced()
  }

  /**
   * The teardown on Windows, where there is no group to signal ({@link endTree}): within
   * `stopBudgetMs`, the app-server is given its graceful stop ({@link gracefulStopMs}) and what
   * outlives it the second grace to end on its own; then the app-server is ended through the handle
   * its spawn holds, and every other process of its tree by number and creation time, never by
   * number alone. The tree is what the table shows then, with every process an earlier reading found
   * ({@link lookAtTheTree}); `close()` resolves once they are gone, or says which may not be.
   */
  private async reapWindowsTree(): Promise<boolean> {
    const pid = this.child.pid
    if (pid === undefined) return true // nothing was ever spawned, so nothing is running
    return endTree({
      leader: { pid, startedAt: this.startedAt },
      leaderEndedAt: () => this.endedAt,
      awaitLeader: (ms) => this.awaitExit(ms),
      endLeader: () => {
        this.child.kill()
      },
      known: () => [...this.known.values()],
      remember: (rows, at) => this.remember(rows, at),
      read: (ms) => {
        const reading = this.opts.processTable(ms)
        this.windowsStopReading = reading.then(
          () => undefined,
          () => undefined,
        )
        return reading
      },
      startEnder,
      isRunning,
      now: () => Date.now(),
      sleep: (ms) =>
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, ms)
          if (typeof timer.unref === 'function') timer.unref()
        }),
      graceMs: gracefulStopMs('win32', this.opts),
      killGraceMs: this.opts.killGraceMs,
      budgetMs: this.opts.stopBudgetMs,
      warn: (line) => console.warn(line),
    })
  }

  /**
   * Is every member of the group we spawned gone?
   *
   * ⛔ **`kill(-pid, 0)` — the kernel, not a promise.** ESRCH means the group has no signalable
   * member left, which is the only evidence available that a descendant is down. The instrument is
   * controlled in `probe:orphan-descendant`: with the leader exited and a descendant alive it reads
   * `true`, and it goes false when that last member dies. ⚠️ **Its first version took the reading
   * while the leader was still alive and could not fail** — the leader is a member of its own group
   * — which is a positive control that proves nothing.
   *
   * ⚠️ **EPERM is NOT quiet.** It means something with that group id exists and is not ours to
   * signal, which after a pid has been recycled is somebody else's group entirely. Reading it as
   * "still running" costs a bounded wait and a warning; reading it as "gone" would be a confident
   * wrong answer about a tree we can no longer see.
   *
   * ⛔ **What it cannot see, and neither can anything else here**: a descendant that called
   * `setsid`. It left the group, so it is not a member, so this says `true` while it runs. See
   * {@link CodexTransport.exited} — that is the honest limit of the whole mechanism.
   */
  private groupIsQuiet(): boolean {
    const pid = this.child.pid
    if (pid === undefined) return true // nothing was ever spawned, so nothing is in a group
    try {
      process.kill(-pid, 0)
      return false
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ESRCH'
    }
  }

  /**
   * True once the group is empty; false if `ms` elapses first. Polls — there is no event for it.
   *
   * ⚠️ **The poll timer is `unref`'d, which has a cost worth naming** (240, own review). It follows
   * {@link awaitExit}'s convention — a teardown must not be the thing that keeps a process alive —
   * but unlike `awaitExit` there is no second racer here, so in a process whose event loop is
   * otherwise empty this promise can simply stop being resolved and `close()` never returns. That
   * cannot happen where this runs (Electron's main loop is never empty, and a test runner holds
   * its own), and the alternative is worse: a background reap from a crash path would then hold a
   * quit open for the full grace over a child nobody is waiting for.
   */
  private async awaitGroupQuiet(ms: number): Promise<boolean> {
    const deadline = Date.now() + ms
    for (;;) {
      // ⚑ **Checked BEFORE any timer is armed**, so an already-empty group costs zero milliseconds
      // and the healthy path's latency is unchanged (§5).
      if (this.groupIsQuiet()) return true
      if (Date.now() >= deadline) return false
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, GROUP_POLL_MS)
        if (typeof timer.unref === 'function') timer.unref()
      })
    }
  }

  /** Resolve true if the child exits within `ms`, false on timeout. */
  private awaitExit(ms: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout>
    const timed = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), ms)
      if (typeof timer.unref === 'function') timer.unref()
    })
    return Promise.race([this.exited.then(() => true), timed]).finally(() => clearTimeout(timer))
  }

  /**
   * Signal the child's whole process group (negative pid, POSIX process-group
   * semantics from the `detached` spawn); fall back to the child alone.
   *
   * ⚠️ **The fallback reaches the LEADER and nothing else**, which is why
   * {@link CodexTransport.exited} says what it says: on the path where the group signal fails for
   * any reason other than an empty group, a descendant is not covered. It is kept because the
   * leader's last chance is worth more than nothing, not because it stands in for the group.
   *
   * ⚠️ **`this.child.pid` outlives the child** — Node does not clear it (074's table). After the
   * leader has been reaped that number can eventually be recycled, and `-pid` would then name a
   * group that is not ours. {@link doReapGroup} is what keeps that narrow: it asks
   * {@link groupIsQuiet} first and does not send SIGKILL to a group it has just proven empty.
   */
  private killGroup(signal: NodeJS.Signals): void {
    const pid = this.child.pid
    if (pid === undefined) return
    try {
      process.kill(-pid, signal)
    } catch {
      try {
        this.child.kill(signal)
      } catch {
        // already dead
      }
    }
  }
}
