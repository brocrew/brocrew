import { execFileSync, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { constants, tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

/**
 * 🔴 **705 · R39 — a spawn that failed, in the two shapes Node gives it, and the measurement that
 * says the doubles ARE those shapes.**
 *
 * ⚑ **Node reports five spawn failures LATER, as an `'error'` event** — `EACCES`, `EAGAIN`,
 * `EMFILE`, `ENFILE` and `ENOENT` — and throws every other one synchronously. ⛔ **And it reports
 * them in two different shapes**, which is the whole of why this file exists:
 *
 * | errno | `pid` | `stdin` / `stdout` / `stderr` | when the parent hears |
 * |---|---|---|---|
 * | `EMFILE`, `ENFILE` | `undefined` | ⛔ **`undefined`** — Node returns before it assigns them | as `'error'`, before a macrotask queued when `spawn` returned |
 * | `EACCES`, `EAGAIN`, `ENOENT` | `undefined` | three pipes | as `'error'`, before a macrotask queued when `spawn` returned |
 *
 * ⚠️ **Measured for `EMFILE` and `EACCES`** (one per row; `ENFILE` and `EAGAIN` cannot be provoked on
 * demand, and `ENOENT` is `EACCES`' shape one errno over).
 *
 * ⚠️ **The first row is the one a transient shortage lands on, and it is the one both adapters
 * broke on**: an adapter that touches `stdout` the moment `spawn` returns throws a `TypeError`
 * about `undefined` — and the errno, which only arrives a tick later, is lost from every cause
 * chain. {@link measureARealSpawnFailure} is the measurement behind both rows, taken in a child
 * process whose descriptor limit is lowered (no app, no port, no user data), and each double here
 * is asserted equal to it in `the-errno-a-resume-carries.test.ts` §0 — so a test driving an
 * adapter with a double is driving it with the shape Node produces, not the shape a test assumed.
 */

/** ⚑ The errno CODE, which is what classifies — its number differs by platform and nothing reads it. */
export type DeferredSpawnCode = 'EMFILE' | 'ENFILE' | 'EAGAIN' | 'EACCES' | 'ENOENT'

/** ⚑ What the parent can see of a spawn that failed, in the terms the adapters read it. */
export interface SpawnFailureShape {
  readonly pid: 'undefined' | 'a number'
  readonly stdio: 'undefined' | 'three streams'
  /**
   * ⚑ **When the parent hears, against a `setImmediate` queued the moment `spawn` returned** —
   * the bound `ClaudeChildWitness.spawnFailure` waits (705 review: the table said *the next tick*
   * and nothing measured it).
   */
  readonly heard: 'before a macrotask' | 'after a macrotask'
  readonly error: {
    readonly message: string
    readonly code: string
    readonly syscall: string
    readonly path: string
  }
}

/**
 * ⚑ **A child the double made, and whether anybody was listening when it failed.**
 *
 * ⛔ `listening` is the adapter's half of the measurement: Node emits the `'error'` whether or not
 * a listener exists, and an `'error'` with none is an uncaught exception — in Electron's main
 * process, an error box on a person's screen.
 */
export interface FailedSpawn {
  readonly child: ChildProcess
  readonly failed: Promise<{ readonly listening: boolean; readonly error: Error }>
}

function errnoError(code: DeferredSpawnCode, file: string): Error {
  // ⚠️ Built the way Node's `ErrnoException` is for a spawn: the message names the file and the
  // code, `syscall` is `spawn <file>`, and `path` is the file (measured in §0).
  return Object.assign(new Error(`spawn ${file} ${code}`), {
    errno: -constants.errno[code],
    code,
    syscall: `spawn ${file}`,
    path: file,
    spawnargs: [] as string[],
  })
}

function failingChild(
  code: DeferredSpawnCode,
  file: string,
  streams: 'undefined' | 'three streams',
): FailedSpawn {
  const child = new EventEmitter() as EventEmitter & Record<string, unknown>
  Object.assign(child, {
    pid: undefined,
    stdin: streams === 'undefined' ? undefined : new PassThrough(),
    stdout: streams === 'undefined' ? undefined : new PassThrough(),
    stderr: streams === 'undefined' ? undefined : new PassThrough(),
    killed: false,
    exitCode: null,
    signalCode: null,
    spawnfile: file,
    spawnargs: [file],
    kill: () => false,
  })
  const failed = new Promise<{ listening: boolean; error: Error }>((resolve) => {
    // ⚑ **The next tick, as Node does it** (`process.nextTick(onErrorNT, …)`), so an adapter meets
    // the error exactly when it would meet the real one — after `spawn` has returned.
    process.nextTick(() => {
      const error = errnoError(code, file)
      const listening = child.listenerCount('error') > 0
      resolve({ listening, error })
      // ⛔ Emitted with no listener too, because Node emits it: that is an uncaught exception, and
      // it is the defect the Codex half of `705` measured.
      child.emit('error', error)
    })
  })
  return { child: child as unknown as ChildProcess, failed }
}

/**
 * ⚑ **A spawn the MACHINE refused for want of descriptors** — `EMFILE` (this process's limit) or
 * `ENFILE` (the system's). No process, and NO streams: Node returns before assigning them.
 */
export function aSpawnThatRanOutOf(code: 'EMFILE' | 'ENFILE', file: string): FailedSpawn {
  return failingChild(code, file, 'undefined')
}

/**
 * ⚑ **A spawn refused after its pipes were made** — `EAGAIN` (no process could be made just now),
 * `EACCES` (not executable) or `ENOENT` (not there). No process; three streams nobody is behind.
 */
export function aSpawnRefusedAfterItsPipes(
  code: 'EAGAIN' | 'EACCES' | 'ENOENT',
  file: string,
): FailedSpawn {
  return failingChild(code, file, 'three streams')
}

/** ⚑ The double's shape, in {@link SpawnFailureShape}'s terms — what §0 compares to the measurement. */
export async function shapeOf(made: FailedSpawn): Promise<SpawnFailureShape> {
  const child = made.child as unknown as Record<string, unknown>
  // ⚠️ Read BEFORE the error, as the adapters read it — `spawn` has just returned.
  const pid = child['pid'] === undefined ? 'undefined' : 'a number'
  const stdio = child['stdout'] === undefined ? 'undefined' : 'three streams'
  let aMacrotaskRan = false
  setImmediate(() => {
    aMacrotaskRan = true
  })
  let heard: SpawnFailureShape['heard'] = 'after a macrotask'
  made.child.on('error', () => {
    heard = aMacrotaskRan ? 'after a macrotask' : 'before a macrotask'
  })
  const { error } = await made.failed
  const said = error as Error & { code: string; syscall: string; path: string }
  return {
    pid,
    stdio,
    heard,
    error: { message: said.message, code: said.code, syscall: said.syscall, path: said.path },
  }
}

/**
 * 🔴 **The real thing, measured** — a Node child that makes one spawn fail the way the machine
 * would, and reports what its parent saw, in {@link SpawnFailureShape}'s terms.
 *
 * - **`EMFILE`**: the child's descriptor limit is lowered (`ulimit -n 64`), it opens `/dev/null`
 *   until it is refused, and then spawns `/usr/bin/true` with three pipes.
 * - **`EACCES`**: it spawns a file that exists and is not executable — the measured stand-in for
 *   the pipes-made row, since `EAGAIN` cannot be provoked on demand.
 *
 * ⚠️ **Bounded** (rule 13): the child is killed after 15 s, and a child that never answers is a
 * thrown error here — a measurement NOT PERFORMED, never a shape.
 */
export function measureARealSpawnFailure(kind: 'EMFILE' | 'EACCES'): SpawnFailureShape {
  const dir = mkdtempSync(join(tmpdir(), 'brobot2-705-spawn-'))
  try {
    const target = kind === 'EMFILE' ? '/usr/bin/true' : join(dir, 'not-executable')
    if (kind === 'EACCES') {
      writeFileSync(target, 'nothing to run\n')
      chmodSync(target, 0o644)
    }
    const script = join(dir, 'measure.mjs')
    writeFileSync(
      script,
      [
        "import { spawn } from 'node:child_process'",
        "import { closeSync, openSync } from 'node:fs'",
        // ⚠️ `process.stdout` opens its descriptor LAZILY — take it before the limit is reached, or
        // the report below is the thing that fails `EMFILE` (measured, on the first version).
        'const out = process.stdout',
        'const held = []',
        kind === 'EMFILE'
          ? "try { for (;;) held.push(openSync('/dev/null', 'r')) } catch (e) { if (e.code !== 'EMFILE') throw e }"
          : '',
        `const child = spawn(${JSON.stringify(target)}, [], { stdio: ['pipe', 'pipe', 'pipe'] })`,
        "const pid = child.pid === undefined ? 'undefined' : 'a number'",
        "const stdio = child.stdout === undefined ? 'undefined' : 'three streams'",
        'let aMacrotaskRan = false',
        'setImmediate(() => { aMacrotaskRan = true })',
        "child.on('error', (e) => {",
        "  const heard = aMacrotaskRan ? 'after a macrotask' : 'before a macrotask'",
        '  for (const fd of held) closeSync(fd)',
        '  const said = { pid, stdio, heard, error: { message: e.message, code: e.code, syscall: e.syscall, path: e.path } }',
        '  out.write(JSON.stringify(said))',
        '  process.exitCode = 0',
        '})',
        "child.on('spawn', () => { out.write('SPAWNED'); process.exitCode = 2 })",
      ].join('\n'),
    )
    const output =
      kind === 'EMFILE'
        ? execFileSync(
            '/bin/sh',
            ['-c', 'ulimit -n 64 && exec "$0" "$1"', process.execPath, script],
            {
              timeout: 15_000,
              encoding: 'utf8',
            },
          )
        : execFileSync(process.execPath, [script], { timeout: 15_000, encoding: 'utf8' })
    return JSON.parse(output) as SpawnFailureShape
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
