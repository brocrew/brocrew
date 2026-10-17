import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type { Writable } from 'node:stream'
import type { SpawnedProcess, SpawnOptions } from '@anthropic-ai/claude-agent-sdk'
import { API_KEY_DESCRIPTOR } from './api-key-handover'

/**
 * **The Claude CLI child, owned by this app rather than borrowed from the SDK** (233, from 229 H1).
 *
 * ## The finding
 *
 * `HostedSession.terminated` is documented as *"the provider stop, UNBOUNDED — the fact, as opposed
 * to `stopping`, which is how long we were prepared to wait for it"*, and for Claude the promise
 * assigned to it was the adapter's own impatience: {@link ClaudeSessionHandle.close} awaits
 * `detachQueryAwaitingExit()`, which is `withTimeout(query.return(), 5 s)` over a
 * `performCleanup()` that itself races `transport.waitForExit()` against 2 000 ms. Every layer of
 * that stack always resolves, so the fact and the bound were one promise — and a bound cannot be a
 * receipt.
 *
 * The cost is not theoretical. `ProcessTransport.close()` schedules `SIGTERM` 2 000 ms out and
 * `SIGKILL` 5 000 ms after that, **both `unref`'d**, while cleanup reports done at 2 000 ms. So the
 * SDK can certify a clean stop with the child still between TERM and KILL — and if the app exits in
 * that window the timers never fire at all. Downstream, `runFinalize` read timely settlement as
 * `stopped = true`, archived `writerStopped: true`, wrote the turn's ending as `ended`, and
 * `launch-registry` freed the session id. A reopen inside that gap starts a SECOND writer against a
 * live process.
 *
 * ## What the signal IS, and why it is not a pid we found
 *
 * ⛔ **The pinned SDK exposes no child and no pid, and that is deliberate on its side.**
 * `ProcessTransport.spawnLocalProcess` does not return the `ChildProcess`; it returns an object
 * literal — `{stdin, stdout, get killed, get exitCode, get signalCode, kill, on, once, off}` —
 * which withholds it. `Query` (`sdk.d.ts:2705`) declares control requests only and does not carry
 * its transport, so there is nothing to reach through either. `Transport.waitForExit?()`
 * (`sdk.d.ts:9433`) is real but is consumed under the SDK's own 2 000 ms race.
 *
 * ⚑ **What the SDK does offer is the other direction: it will take OURS.**
 * `Options.spawnClaudeCodeProcess?: (options: SpawnOptions) => SpawnedProcess` (`sdk.d.ts:2377`) is
 * called *instead of* the local spawn, and `SpawnedProcess`'s own doc says *"ChildProcess already
 * satisfies this interface"* (`sdk.d.ts:9072-9075`). So the fix is not to find a handle — it is to
 * own one. `child.once('exit')` is then a kernel-delivered event about a process this module
 * spawned, which is the only thing in this stack that is a fact rather than a deadline.
 *
 * ⚠️ **186 said this repository owns no pid for a Claude CLI and was right when it was written.**
 * This is what changes that, and {@link SessionHandle.providerPid} stops being absent for Claude
 * as a direct consequence.
 *
 * ## What owning the spawn obliges us to do
 *
 * 🔴 **stderr becomes ours to drain, and forgetting would wedge the child.** `SpawnedProcess` has no
 * `stderr` member, so the SDK never reads stderr from a custom child — it reads it only from the
 * one it spawns itself. A `['pipe','pipe','pipe']` child whose stderr nobody consumes blocks
 * forever once the pipe buffer fills. {@link watchClaudeChild} therefore consumes every chunk.
 *
 * ⚠️ **And draining it moves a diagnostic, which has to be said rather than glossed.** The SDK
 * appends `formatStderrTail()` to the error `getProcessExitError` builds, reading a `stderrTail`
 * that only `spawnLocalProcess` fills — so owning the spawn empties it, and the `. stderr: …`
 * suffix leaves the message the adapter turns into a fatal session error. The tail is not lost: the
 * `'exit'` handler below logs it on any non-zero exit, which is where 085 says a provider's raw
 * text belongs. ⛔ **The user-facing error text is nevertheless one clause poorer than before**,
 * and that is a real cost of this change rather than a neutral refactor. This repository has
 * already paid once for a Claude CLI writing something important to a stderr nobody read — see
 * `ClaudeRuntime.childEnvAdditions` on `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`, where a permission-mode
 * override arrived exactly that way.
 *
 * Everything else is deliberate parity with `spawnLocalProcess`: the same stdio, the same
 * `windowsHide`, and the SDK's **forwarded** `signal` passed straight through — per `SpawnOptions`'
 * own doc it fires only after the stdin-EOF + ~2 s grace, so honouring it preserves the graceful
 * path rather than racing ahead of it. The SDK registers our child in its own `process.on('exit')`
 * SIGTERM sweep either way (`gxe(this.process)` runs on both spawn paths).
 */
export interface ClaudeChildWitness {
  /**
   * Hand to `Options.spawnClaudeCodeProcess`. Spawns the child the SDK asked for and keeps it.
   *
   * Called at most once per query in practice — the transport spawns once — but a second call is
   * not refused: it simply becomes the child this witness watches, because a witness that threw
   * inside the SDK's `initialize()` would turn a diagnostic into a failed launch.
   */
  readonly spawn: (options: SpawnOptions) => SpawnedProcess
  /**
   * The pid of the child we spawned — **and `undefined` the instant it is gone** (233, applying
   * 074's rule to the adapter that finally has a pid to get it wrong).
   *
   * ⛔ **Node does NOT clear `ChildProcess.pid` after exit**, and this repository has already
   * measured that across v20/v22/v24 and Electron 43 — see the table above
   * {@link SpawnCodexTransport.pid}, whose conclusion is *"a confident wrong PID is worse than an
   * honest absence"*. Returning the raw field would republish a number that now belongs to nothing,
   * or, after enough churn, to somebody else's process. The deadness flag is set in the `'exit'`
   * handler BEFORE the fact is settled, for Codex's reason: settling runs listeners, and a
   * disclosure republished from inside one of them must not be able to read a live pid for a dead
   * child.
   */
  readonly pid: number | undefined
  /**
   * ⛔ **The exit FACT: settles only when the child is proven gone, or not at all.**
   *
   * Read at teardown, not at construction, which is what lets the two honest answers be one
   * property:
   *
   *  - **no child was ever spawned** — there is nothing running, so it is already settled. This is
   *    not an assumption: `ProcessTransport` spawns synchronously inside `query()` for every option
   *    shape this adapter uses (`deferSpawn` is set only on the SDK's `sessionStore` resume path,
   *    which this adapter does not use), so "no child by teardown" means no child, not "not yet".
   *  - **a child was spawned** — its own `'exit'`, and nothing else. No timer, no bound, no
   *    fallback. A CLI that never dies never settles this, which is the entire point: the bound
   *    belongs to whoever is WAITING, and {@link ClaudeSessionHandle.close} keeps it.
   *
   * ⚠️ **`'error'` settles it only when the spawn itself failed** (`pid === undefined`), because a
   * process that never started is a process that is not running. An `'error'` on a child that DID
   * start — a failed `kill`, an EPIPE — is not an exit and is not treated as one; Node still
   * delivers `'exit'` for that child, and that is what this waits for.
   */
  readonly exited: Promise<void>
  /** The last {@link STDERR_TAIL_BYTES} of the child's stderr, for a diagnostic that needs it. */
  readonly stderrTail: string
  /**
   * 🔴 **705 · R39 — the errno a spawn that produced NO process reported, or `null`.**
   *
   * ⛔ **Why this exists: a descriptor shortage reaches this adapter as somebody else's
   * `TypeError`.** Node reports a spawn `EMFILE`/`ENFILE` a tick AFTER `spawn` returns, and returns
   * without assigning `stdin`/`stdout`/`stderr` — so the SDK, reaching for `this.process.stdin.on`
   * inside the same `query()` call, throws *"Cannot read properties of undefined (reading 'on')"*,
   * and that was the whole of what a resume could say (measured: `the-errno-a-resume-carries.test.ts`
   * §1). ⚠️ **And a spawn refused AFTER its pipes were made (`EACCES`, `EAGAIN`, `ENOENT`) reached
   * it as nothing at all** — `query()` returned, and so did the resume, with a handle whose child had
   * never started (705's review). ⚑ The errno itself arrives at this witness's own `'error'`
   * listener, which kept it for nothing but the exit fact; it is kept here now, for the caller that
   * has to say WHICH failure it was — a resume since `705`, and a start since `707` (R39, extended:
   * the same two shapes made `start()` throw the SDK's `TypeError`, and hand back a dead handle).
   *
   * ⚠️ **Bounded by construction, one macrotask**: Node delivers the spawn's `'error'` from
   * `process.nextTick`, and every tick queued before a `setImmediate` has run by the time it fires —
   * so a spawn that failed has said so by then, and a spawn that started never will (`null`). ⛔ Not
   * a wait on the child's life: a child that DID start is never waited for here.
   */
  readonly spawnFailure: () => Promise<Error | null>
}

/**
 * How much stderr to keep: enough to carry the sentence that explains an exit, not enough for an
 * unbounded child to grow the heap.
 */
const STDERR_TAIL_BYTES = 4096

/**
 * What actually starts the process — injectable so a test can watch one that never exits.
 * `apiKey`, when given, is the person's API key, for the CLI to read from {@link API_KEY_DESCRIPTOR}
 * — given only where the key travels that way (`handOverApiKey`); a spawn that ignores it launches a
 * CLI told to read a descriptor nobody opened, which fails to authenticate rather than leaking
 * anything.
 */
export type SpawnChild = (options: SpawnOptions, apiKey?: string) => ChildProcess

/**
 * The default: `child_process.spawn`, with `spawnLocalProcess`'s own arguments, on the program the
 * launch named.
 *
 * 🔒 **With an `apiKey`, a fourth pipe carries it, and is closed at once.** The key is written with a
 * newline and the pipe ended, so the CLI's read ends there; nothing else is ever written to it, and
 * the key is in no argument and no environment of this spawn. A child that dies before reading makes
 * the write fail with `EPIPE`, which is its exit's to report, not this pipe's.
 */
export function spawnClaudeChild(options: SpawnOptions, apiKey?: string): ChildProcess {
  const { command, args, cwd, env, signal } = options
  const child = spawn(command, args, {
    cwd,
    env,
    signal,
    stdio: apiKey === undefined ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  if (apiKey !== undefined) {
    // ⚠️ `stdio?.`: a spawn that ran out of descriptors returns before Node assigns `stdio` at all
    // (see {@link ClaudeChildWitness.spawnFailure}); the witness must still get to hear its errno.
    const descriptor = child.stdio?.[API_KEY_DESCRIPTOR] as Writable | null | undefined
    descriptor?.on('error', () => {})
    descriptor?.end(`${apiKey}\n`)
  }
  return child
}

/**
 * Watch one Claude CLI child for the whole life of one query. See {@link ClaudeChildWitness}.
 *
 * ⚠️ **The WITNESS adds no throw of its own** — it runs inside the SDK's
 * `ProcessTransport.initialize()`, where a throw is a failed launch, and a diagnostic must not be
 * able to cost a session.
 *
 * ⛔ **What this comment used to claim, and 261 measured false:** *"Never throws out of
 * `ClaudeChildWitness.spawn`. A spawn that fails still produces a `ChildProcess` that emits
 * `'error'`."* Only for five errnos. Node's `child_process.spawn` defers to `'error'` for
 * `EACCES`, `EAGAIN`, `EMFILE`, `ENFILE` and `ENOENT` (⚑ `705` measured `EACCES` deferred too, on
 * Node 24.0.2 and on Electron 43.2.0's 24.18.0 — this sentence named four until then), and
 * **throws synchronously for everything else** —
 * including the `ENOTDIR` this app produced on every launch of the packaged build, measured inside
 * Electron 43.2.0 as `THREW SYNC ENOTDIR` rather than as an error event.
 *
 * ⚑ **Which costs nothing, and that is the honest version of the old sentence.** A `spawn` that
 * throws produced no process, so there is no child to lose and no receipt to get wrong; the throw
 * surfaces through `query()` as the failed launch it is, and the user reads the errno instead of
 * waiting on a session that was never going to start. The witness cannot make a failing spawn
 * succeed and does not pretend to — it only refrains from adding a second way to fail.
 */
export function watchClaudeChild(
  spawnChild: SpawnChild = spawnClaudeChild,
  apiKey?: string,
): ClaudeChildWitness {
  let child: ChildProcess | null = null
  let dead = false
  let settled = false
  let markExited!: () => void
  const childExited = new Promise<void>((resolve) => {
    markExited = () => {
      if (settled) return
      settled = true
      resolve()
    }
  })
  /**
   * ⚑ **One object, built once, for the no-child answer** (233 review).
   *
   * {@link SessionHandle.awaitProcessExit} promises *"every call returns the same promise"*, and a
   * bare `Promise.resolve()` in the getter would mint a new one per call — so the contract would
   * hold for a session that spawned and quietly break for one that did not. The host asks once, but
   * a fact whose identity depends on who is asking is not a fact.
   */
  const nothingRunning = Promise.resolve()
  let stderrTail = ''
  /** ⚑ 705 · the errno of a spawn that produced no process — see {@link ClaudeChildWitness.spawnFailure}. */
  let spawnFailure: Error | null = null

  return {
    spawn(options: SpawnOptions): SpawnedProcess {
      const spawned = apiKey === undefined ? spawnChild(options) : spawnChild(options, apiKey)
      child = spawned
      // 🔴 **The drain, and it is load bearing** — see the note on {@link ClaudeChildWitness}. The
      // SDK cannot read a custom child's stderr, so if this listener is not attached the child
      // stops the first time it writes more than a pipe buffer's worth.
      spawned.stderr?.setEncoding('utf8')
      spawned.stderr?.on('data', (chunk: string) => {
        const combined = stderrTail + chunk
        stderrTail =
          combined.length > STDERR_TAIL_BYTES ? combined.slice(-STDERR_TAIL_BYTES) : combined
      })
      // A stderr pipe that fails to read must not become an unhandled `error` on the stream. The
      // exit below is the signal that matters; a tail we cannot collect is a lost diagnostic, not a
      // lost process.
      spawned.stderr?.on('error', () => {})
      spawned.once('exit', (code, signal) => {
        // ⚠️ **Before `markExited`, exactly as `SpawnCodexTransport.onExit` does it** (074): settling
        // runs listeners, and `pid` must already be honest by the time any of them can read it.
        dead = true
        // ⛔ **The stderr tail the SDK can no longer add to its own exit error** — see the note on
        // {@link ClaudeChildWitness}. `getProcessExitError` builds `…exited with code N` and appends
        // `formatStderrTail()`, which reads a `stderrTail` only `spawnLocalProcess` fills; owning
        // the spawn empties it. Put where 085 says a provider's raw text goes — the log gets theirs
        // — so a CLI that explains itself on the way out is not silently unexplained.
        const tail = stderrTail.trim()
        if (tail !== '' && (code === null ? signal !== null : code !== 0)) {
          console.warn(
            `claude CLI child ${spawned.pid ?? '(no pid)'} exited ` +
              `${code === null ? `on ${String(signal)}` : `with code ${String(code)}`}. stderr: ${tail}`,
          )
        }
        markExited()
      })
      spawned.on('error', (error: Error) => {
        // ⛔ **Only a spawn that never produced a process.** `pid` is undefined exactly then; a
        // child that started and later errored still delivers `'exit'`, and settling here would be
        // this dispatch's own defect in miniature — concluding termination from something that is
        // not one.
        if (spawned.pid !== undefined) return
        spawnFailure = error
        dead = true
        markExited()
      })
      // ⚠️ **The double cast is the `stdin`/`stdout` nullability and nothing else.** `SpawnedProcess`
      // requires both streams; `ChildProcess` types them `| null` because they are absent under
      // other stdio modes. {@link spawnClaudeChild} always asks for the three standard pipes (and a
      // fourth for an API key), so they are present — the SDK's *"ChildProcess already satisfies
      // this interface"* holds for this spawn.
      // ⛔ **Except when the spawn ran out of descriptors** (`EMFILE`/`ENFILE`, 705): Node returns
      // before assigning any of the three. The `?.` on every access above (233, written for the
      // `| null` typing) is what keeps the witness from throwing then — ⚠️ it is load-bearing, not a
      // typing leftover — and the SDK's own `stdin.on`, which has no `?.`, is what throws
      // ({@link ClaudeChildWitness.spawnFailure}).
      return spawned as unknown as SpawnedProcess
    },
    get pid(): number | undefined {
      // 074's rule: a pid for a process that has exited is a confident wrong answer.
      return dead ? undefined : child?.pid
    },
    get exited(): Promise<void> {
      // Nothing was spawned ⇒ nothing is running. Read at teardown, so this is an observation and
      // not a prediction — see {@link ClaudeChildWitness.exited}. One shared object, so the
      // contract's idempotence holds on this branch too.
      return child === null ? nothingRunning : childExited
    },
    get stderrTail(): string {
      return stderrTail
    },
    spawnFailure: async (): Promise<Error | null> => {
      if (child === null) return null
      await new Promise<void>((resolve) => setImmediate(resolve))
      return spawnFailure
    },
  }
}
