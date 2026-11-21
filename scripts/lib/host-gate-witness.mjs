import { existsSync } from 'node:fs'
import { connect } from 'node:net'
import { join } from 'node:path'

import { GATE_SOCKET, SUN_PATH_MAX } from './smoke-run.mjs'

/**
 * Default bounds for finding the socket, waiting for one response and pausing between checks.
 * Worst-case cost is their sum because the last question can start one pause beyond the
 * search deadline. `step-budgets.test.mjs` derives each isolated launch's charge from these.
 */
const GATE_SOCKET_WAIT_MS = 10_000
const GATE_ANSWER_MS = 5_000
const GATE_POLL_MS = 100

/**
 * Proof that the one-host gate ran and answered, not merely that the app started.
 *
 * The gate fails open by design, and its fail-open branch looks the same from outside as its working
 * branch: the window and database open either way and every smoke step passes. A socket path over
 * the 104-byte `sun_path` limit makes `bind` fail `EINVAL` and the gate return `unknown`, and nothing
 * in the product reports that, since "nobody else is here" and "I could not ask" are both reasons to
 * run. So the witness is on the outside and positive.
 *
 * It establishes two facts, in order:
 *
 *  1. The name exists, so `listen` bound and `link` claimed. On POSIX a socket path outlives the
 *     process that made it, so this alone could be an artefact of a run that is over.
 *  2. Something behind it answers with a token, the UUID `one-host-gate.ts` writes with
 *     `socket.end(token)` on every connection. A stale path cannot fake this: the kernel refuses a
 *     connect to a name whose listener is gone (`ECONNREFUSED`), which is why a listening socket
 *     was chosen over a lock file.
 *
 * It does not establish that this launch's verdict was `sole`: nothing reports the verdict, and on a
 * `reuse: true` launch the app that answers may be an earlier one. The step that proves a second
 * launch stands down is where the verdict is tested.
 *
 * @param {string} userData the `--user-data-dir` the app under test was given
 * @param {{ waitMs?: number, answerMs?: number }} [options]
 * @returns {Promise<{ socket: string, token: string }>}
 */
export async function witnessGate(userData, options = {}) {
  const waitMs = options.waitMs ?? GATE_SOCKET_WAIT_MS
  const answerMs = options.answerMs ?? GATE_ANSWER_MS
  const socket = join(userData, GATE_SOCKET)

  // Reported before anything is attempted: a path over the limit gives the same `ENOENT` as an app
  // that never ran, and those two must not be confused.
  if (socket.length >= SUN_PATH_MAX) {
    throw new Error(
      `the gate cannot be witnessed here: ${socket} is ${String(socket.length)} bytes and ` +
        `sun_path holds ${String(SUN_PATH_MAX - 1)}. The gate did not fail — it was never able ` +
        `to run (241 §3, 242 §1).`,
    )
  }

  /**
   * The answer is what is retried, not merely the socket's appearance.
   *
   * `one-host-gate.ts` has no `release` (the kernel is the release; what survives on POSIX is the
   * path), so on a relaunch onto a reused `userData` the previous app's socket path is already there,
   * the wait is satisfied instantly, and a single connect can land inside the new app's `claimed()`
   * loop, between `tidy(path)` unlinking the stale name and `link` putting the live one back. Several
   * smokes relaunch onto a reused `userData` (the resume smoke's second app, the packaged smoke's
   * relaunch, the ui smoke's `reuse: true` launches), so this is the ordinary path.
   *
   * Getting it wrong turns a transient into a hard red, and the run blames the product for the
   * instrument's own race. An instrument built to catch a silent failure must not invent a loud one.
   */
  const until = Date.now() + waitMs
  let sawSocket = false
  let said = null
  for (;;) {
    if (existsSync(socket)) {
      sawSocket = true
      said = await ask(socket, answerMs)
      if (said !== null) break
    }
    if (Date.now() >= until) break
    await new Promise((resolve) => setTimeout(resolve, GATE_POLL_MS))
  }

  if (!sawSocket) {
    throw new Error(
      `no gate socket at ${socket} after ${String(waitMs)} ms — 236 §3's one-host gate did not ` +
        `bind, so this app ran with the double-launch backstop switched off (242 §1)`,
    )
  }
  if (said === null) {
    throw new Error(
      `${socket} exists but nothing answers on it after ${String(waitMs)} ms — on POSIX that is ` +
        `the artefact a finished process leaves behind, not a live gate (242 §1)`,
    )
  }
  if (!/^[0-9a-f-]{36}$/.test(said)) {
    throw new Error(
      `${socket} answered ${JSON.stringify(said)}, which is not the UUID one-host-gate.ts ends ` +
        `every connection with — something else owns this name`,
    )
  }
  return { socket, token: said }
}

/**
 * Connect, read whatever is said, and close.
 *
 * Mirrors `one-host-gate.ts`'s own `ask`, including that a connection that opens and says nothing
 * is not a BroBot, and is reported as no answer rather than as an empty one.
 */
function ask(path, answerMs) {
  return new Promise((resolve) => {
    let said = ''
    const socket = connect(path)
    const settle = (answer) => {
      clearTimeout(timer)
      socket.destroy()
      resolve(answer)
    }
    const timer = setTimeout(() => settle(null), answerMs)
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => (said += chunk))
    socket.on('end', () => settle(said === '' ? null : said))
    socket.on('error', () => settle(null))
  })
}
