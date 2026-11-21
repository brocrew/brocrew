import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type { SpawnedProcess, SpawnOptions } from '@anthropic-ai/claude-agent-sdk'
import { withTimeout } from '../internal/bounded'
import {
  claudeProcessGroups,
  ownClaudeProcessGroup,
  type ClaudeProcessGroup,
} from './process-group'

/** Await the SDK's bounded receipt, then reap the child even if that receipt throws. */
export async function finishClaudeChild(
  query: { return?: () => unknown } | null,
  child: ClaudeChildWitness | undefined,
  withinMs: number,
): Promise<void> {
  try {
    if (query?.return) await withTimeout(Promise.resolve(query.return()), withinMs)
  } catch {
    // A broken SDK receipt must not skip process cleanup.
  } finally {
    await child?.close()
  }
}

/**
 * The Claude CLI child, owned by this app rather than borrowed from the SDK, so a real exit event is
 * available.
 *
 * The SDK's own stop is bounded (`query.return()` resolves after a timeout even if the child lives; it
 * schedules SIGTERM/SIGKILL on `unref`'d timers that never fire if the app exits first), so it cannot
 * certify that the process is gone. The SDK exposes no child or pid, but `Options.spawnClaudeCodeProcess`
 * lets the caller supply the spawn, and a `ChildProcess` satisfies `SpawnedProcess`. `child.once('exit')`
 * is then a kernel-delivered fact about a process this module spawned, and
 * {@link SessionHandle.providerPid} is available for Claude.
 *
 * Owning the spawn obliges us to:
 *  - Drain stderr. `SpawnedProcess` has no `stderr` member, so the SDK never reads it from a custom
 *    child, and an unread pipe blocks the child once its buffer fills. {@link watchClaudeChild}
 *    consumes every chunk.
 *  - Log the stderr tail on a non-zero exit. The SDK appends its own tail to the exit error only for
 *    a child it spawned itself, so the user-facing error text lacks that clause.
 *  - Keep spawn parity with the SDK's local spawn: the same stdio and `windowsHide`, and the SDK's
 *    `signal` passed through (it fires only after the stdin-EOF grace, so the graceful path is kept).
 *    The CLI leads a private POSIX process group, reaped on exit and explicit close.
 */
export interface ClaudeChildWitness {
  /**
   * Hand to `Options.spawnClaudeCodeProcess`. Spawns the child the SDK asked for and keeps it.
   *
   * Called once per query in practice; a second call is not refused but becomes the watched child,
   * because throwing inside the SDK's `initialize()` would turn a diagnostic into a failed launch.
   */
  readonly spawn: (options: SpawnOptions) => SpawnedProcess
  /**
   * The pid of the child we spawned, or `undefined` once it has exited. Node does not clear
   * `ChildProcess.pid` after exit, and a stale pid may belong to another process (see
   * {@link SpawnCodexTransport.pid}). The deadness flag is set before the exit is settled, so a
   * listener run by settling cannot read a live pid for a dead child.
   */
  readonly pid: number | undefined
  /**
   * The exit fact: settles only when the child is proven gone, never on a timer. The bound belongs to
   * the waiter ({@link ClaudeSessionHandle.close}). Read at teardown:
   *
   *  - no child was spawned: already settled. The SDK spawns synchronously inside `query()` for every
   *    option shape this adapter uses, so no child by teardown means none.
   *  - a child was spawned: its own `'exit'` only.
   *
   * `'error'` settles it only when the spawn itself failed (`pid === undefined`). An `'error'` on a
   * started child (a failed `kill`, an EPIPE) is not an exit; Node still delivers `'exit'`.
   */
  readonly exited: Promise<void>
  /** The CLI and its private process group have both stopped. */
  readonly quiesced: Promise<void>
  /** End the private process group after asking the SDK to close the CLI. */
  close(): Promise<void>
  /** The last {@link STDERR_TAIL_BYTES} of the child's stderr, for a diagnostic that needs it. */
  readonly stderrTail: string
  /**
   * The errno of a spawn that produced no process, or `null`. On `EMFILE`/`ENFILE` Node returns from
   * `spawn` without assigning stdio, so the SDK throws a `TypeError` reaching for `stdin.on`; after
   * pipes were made (`EACCES`, `EAGAIN`, `ENOENT`) `query()` returns with a child that never started.
   * The errno arrives at this witness's `'error'` listener and is kept so start and resume can report
   * the real failure.
   *
   * Bounded to one macrotask: Node delivers the spawn `'error'` from `process.nextTick`, so a failed
   * spawn has reported by the next `setImmediate`. It never waits on a child that did start.
   */
  readonly spawnFailure: () => Promise<Error | null>
}

/**
 * How much stderr to keep: enough to carry the sentence that explains an exit, not enough for an
 * unbounded child to grow the heap.
 */
const STDERR_TAIL_BYTES = 4096

/** What actually starts the process — injectable so a test can watch one that never exits. */
export type SpawnChild = (options: SpawnOptions) => ChildProcess

/** The default: `child_process.spawn` with `spawnLocalProcess`'s own arguments. */
export function spawnClaudeChild(options: SpawnOptions): ChildProcess {
  const { command, args, cwd, env, signal } = options
  const child = spawn(command, args, {
    cwd,
    env,
    signal,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  })
  if (process.platform !== 'win32') ownClaudeProcessGroup(child)
  return child
}

/**
 * Watch one Claude CLI child for the whole life of one query. See {@link ClaudeChildWitness}.
 *
 * The witness adds no throw of its own: it runs inside the SDK's `ProcessTransport.initialize()`,
 * where a throw is a failed launch. Node's `spawn` defers only `EACCES`, `EAGAIN`, `EMFILE`, `ENFILE`
 * and `ENOENT` to an `'error'` event and throws everything else synchronously (for example `ENOTDIR`).
 * That costs nothing: a throwing spawn produced no process, and the throw surfaces through `query()`
 * as the failed launch with its errno.
 */
export function watchClaudeChild(
  spawnChild: SpawnChild = spawnClaudeChild,
  sessionId?: string,
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
   * Built once for the no-child answer: {@link SessionHandle.awaitProcessExit} promises every call
   * returns the same promise, so the getter must not mint a new one per call.
   */
  const nothingRunning = Promise.resolve()
  let stderrTail = ''
  /** The errno of a spawn that produced no process; see {@link ClaudeChildWitness.spawnFailure}. */
  let spawnFailure: Error | null = null
  let group: ClaudeProcessGroup | undefined

  return {
    spawn(options: SpawnOptions): SpawnedProcess {
      const spawned = spawnChild(options)
      child = spawned
      group = claudeProcessGroups.get(spawned)
      group?.identify(sessionId)
      // The stderr drain is load-bearing: the SDK cannot read a custom child's stderr, so without
      // this the child stops once it writes more than a pipe buffer.
      spawned.stderr?.setEncoding('utf8')
      spawned.stderr?.on('data', (chunk: string) => {
        const combined = stderrTail + chunk
        stderrTail =
          combined.length > STDERR_TAIL_BYTES ? combined.slice(-STDERR_TAIL_BYTES) : combined
      })
      // A failing stderr read must not become an unhandled stream `error`; it only loses a diagnostic.
      spawned.stderr?.on('error', () => {})
      spawned.once('exit', (code, signal) => {
        // Before `markExited`: settling runs listeners, and `pid` must already read as gone.
        dead = true
        // The SDK cannot add its stderr tail to its exit error for a child it did not spawn, so log it.
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
        // Only a spawn that never produced a process; a started child still delivers `'exit'`.
        if (spawned.pid !== undefined) return
        spawnFailure = error
        dead = true
        markExited()
      })
      // The cast bridges `stdin`/`stdout` being `| null` on `ChildProcess`; {@link spawnClaudeChild}
      // always asks for the three pipes. On `EMFILE`/`ENFILE` Node assigns none of them, so the `?.`
      // accesses above are load-bearing, and the SDK's own `stdin.on` is what throws (see
      // {@link ClaudeChildWitness.spawnFailure}).
      return spawned as unknown as SpawnedProcess
    },
    get pid(): number | undefined {
      // A pid for a process that has exited is a confident wrong answer.
      return dead ? undefined : child?.pid
    },
    get exited(): Promise<void> {
      // Nothing spawned means nothing running. One shared object keeps repeated reads identical.
      return child === null ? nothingRunning : childExited
    },
    get stderrTail(): string {
      return stderrTail
    },
    get quiesced(): Promise<void> {
      return group?.quiesced ?? (child === null ? nothingRunning : childExited)
    },
    close: async (): Promise<void> => {
      await group?.close()
    },
    spawnFailure: async (): Promise<Error | null> => {
      if (child === null) return null
      await new Promise<void>((resolve) => setImmediate(resolve))
      return spawnFailure
    },
  }
}
