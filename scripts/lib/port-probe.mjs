/**
 * Report ports as free, held or unknown. An `lsof` empty result differs from a failed or
 * timed-out observation; never collapse the latter to free.
 *
 * `whoHoldsPort` names holders and costs a subprocess. `couldBindPort` asks the kernel's
 * allocator whether the next process can bind, suitable for polling; it has no pid list.
 * Subprocess latency under load must not be charged as the app's shutdown time.
 *
 * Callers handle unknown explicitly. A timeout is safe only while it retains that state;
 * `app-closes-check.mjs` refuses it without setting a successful release timestamp.
 */
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:net'

/**
 * How long `lsof` may run before its answer is `unknown` rather than late.
 *
 * ⚠️ **Generous on purpose.** Nothing times anything across this call any more — 326 moved the
 * deciding to {@link couldBindPort} — so this bound exists only so that a wedged `lsof` becomes an
 * answer instead of a hang. The observed legitimate maximum under load is 622 ms.
 */
const LSOF_TIMEOUT_MS = 30_000

const FREE = Object.freeze({ state: 'free' })
const held = (pids) => Object.freeze({ state: 'held', pids: Object.freeze(pids) })
const unknown = (why) => Object.freeze({ state: 'unknown', why })

/**
 * **Which pids are listening on `port`** — `free`, `held` with their numbers, or `unknown`.
 *
 * @param {number} port
 * @param {{ run?: (port: number) => { found: string } | { empty: true } | { failed: string } }} [options]
 */
export function whoHoldsPort(port, { run = runLsof } = {}) {
  const result = run(port)
  if (result.failed !== undefined) return unknown(result.failed)
  if (result.empty === true) return FREE
  const pids = String(result.found)
    .split('\n')
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0)
  // ⛔ A zero exit means `lsof` MATCHED. A match whose pids this cannot read is not an empty port —
  // reporting it as `free` here would rebuild the fail-open one layer in from where it was removed.
  if (pids.length === 0) {
    return unknown(
      `lsof matched something on port ${String(port)} that this check could not read: ` +
        `${JSON.stringify(String(result.found))}`,
    )
  }
  return held(pids)
}

/**
 * Run `lsof` and separate its three outcomes, which the exit code alone does not.
 *
 * ⚑ Exported for `port-probe.test.mjs`: the classification below is the whole of this module's
 * claim, and testing it through the real binary alone would leave the four failure shapes — none of
 * which a healthy machine produces — asserted by nothing.
 *
 * ⚠️ **`stderr` is the discriminator and it used to be thrown away** (`stdio: […, 'ignore']`).
 * Measured on this machine, `lsof 4.91`:
 *
 * | | status | signal | code | stderr |
 * |---|---|---|---|---|
 * | nothing listening | `1` | `null` | — | `''` |
 * | something listening | `0` | — | — | — |
 * | bad arguments | `1` | `null` | — | `lsof: unknown service …` |
 * | not installed | `null` | `null` | `ENOENT` | `undefined` |
 * | over {@link LSOF_TIMEOUT_MS} | `null` | `SIGTERM` | `ETIMEDOUT` | `''` |
 */
export function runLsof(port, { exec = execFileSync } = {}) {
  try {
    return {
      found: exec('lsof', ['-nP', `-iTCP:${String(port)}`, '-sTCP:LISTEN', '-t'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: LSOF_TIMEOUT_MS,
      }),
    }
  } catch (error) {
    // ⚠️ `undefined` on a spawn failure, a string once the process actually ran.
    const complaint = typeof error.stderr === 'string' ? error.stderr.trim() : ''
    // ⛔ **The ordinary answer, and the only one that may become `free`**: it ran, it exited 1, it
    // was not stopped, and it did not complain. Anything else is a failure wearing the same code.
    if (
      error.status === 1 &&
      error.signal === null &&
      error.code === undefined &&
      complaint === ''
    ) {
      return { empty: true }
    }
    const how =
      error.code === undefined ? `exited ${String(error.status)}` : `failed with ${error.code}`
    return {
      failed:
        `lsof ${how}${error.signal === null || error.signal === undefined ? '' : ` on ${error.signal}`}` +
        `${complaint === '' ? '' : `: ${complaint.split('\n')[0]}`}`,
    }
  }
}

/**
 * **Could the next process have this port?** — asked of the kernel's allocator, in ~0 ms.
 *
 * ⚠️ A `held` here carries no pids by design; {@link whoHoldsPort} is what names them, and keeping
 * the two apart is what stops a fast decision from pretending to be an identification.
 *
 * @param {number} port
 * @param {{ bind?: (port: number) => Promise<object> }} [options]
 */
export function couldBindPort(port, { bind = bindOnce } = {}) {
  return bind(port)
}

/** ⚑ Exported for the test, which drives the `unknown` branch by injecting a refusing server. */
export function bindOnce(port, { openServer = createServer } = {}) {
  return new Promise((resolve) => {
    const server = openServer()
    server.once('error', (error) => {
      // ⛔ **`EADDRINUSE` is the only error that means `held`.** `EACCES` on a privileged port,
      // `EMFILE` on a machine out of descriptors and `EADDRNOTAVAIL` are all this check being
      // unable to ask — which is a third thing, and reporting any of them as an answer about the
      // app is the mistake this module exists to make impossible.
      resolve(
        error.code === 'EADDRINUSE'
          ? Object.freeze({ state: 'held' })
          : unknown(`binding 127.0.0.1:${String(port)} failed with ${error.code ?? error.message}`),
      )
    })
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(FREE)))
  })
}
