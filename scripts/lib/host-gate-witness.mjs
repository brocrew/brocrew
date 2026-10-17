import { existsSync } from 'node:fs'
import { connect } from 'node:net'
import { join } from 'node:path'

import { GATE_SOCKET, SUN_PATH_MAX } from './smoke-run.mjs'

/**
 * Default bounds for finding the socket, waiting for one response and pausing between checks.
 * Worst-case cost is their sum because the last question can start one pause beyond the
 * search deadline. `step-budgets.test.mjs` derives each isolated launch's charge from these.
 */
export const GATE_SOCKET_WAIT_MS = 10_000
export const GATE_ANSWER_MS = 5_000
export const GATE_POLL_MS = 100

/**
 * ⛔ **Proof that `236` §3's gate RAN AND ANSWERED, not that the app started** (242 §1).
 *
 * ## Why "the app started" was never evidence of this
 *
 * 🔴 **The gate fails open by design**, and its fail-open branch is indistinguishable from its
 * working branch to anything watching the app from outside: the window opens either way, the
 * database opens either way, every step of every smoke passes either way. ⚠️ **241 §3 measured the
 * consequence** — `os.tmpdir()` made the socket 120 bytes against a 104-byte `sun_path`, so `bind`
 * failed `EINVAL`, `claimSoleHost` returned `unknown` at ~4 ms, and three live instruments spent a
 * hundred dispatches reporting green over a feature that could not execute. ⛔ **Nothing in the
 * product can report this**, because from the app's side "nobody else is here" and "I could not
 * ask" are both reasons to run.
 *
 * ⚑ **So the witness is on the OUTSIDE and it is positive.** A shortened path (242 §1) is what makes
 * the gate able to work; this is what makes a run in which it did not work fail loudly.
 *
 * ## What it actually establishes
 *
 * Two facts, in the order a doubter would want them:
 *
 *  1. **The name exists** — so `listen` bound and `link` claimed. ⚠️ On POSIX a socket path outlives
 *     the process that made it, so this alone would also be satisfied by an artefact of a run that
 *     is over. It is necessary and it is not sufficient.
 *  2. **Something behind it answers with a token** — the UUID `one-host-gate.ts` writes with
 *     `socket.end(token)` on every connection. ⛔ **This is the half a stale path cannot fake**: the
 *     kernel refuses a connect to a name whose listener is gone (`ECONNREFUSED`), which is the whole
 *     reason a listening socket was chosen over a lock file in the first place.
 *
 * ⚠️ **It does NOT establish that this particular launch's verdict was `sole`.** Nothing reports the
 * verdict, and the app that answers may be an earlier one on a `reuse: true` launch — which is the
 * correct answer to *"is a gate engaged on this userData"* and the honest limit of what an outside
 * observer can see. The step that proves a second launch stands down is where the verdict is tested.
 *
 * @param {string} userData the `--user-data-dir` the app under test was given
 * @param {{ waitMs?: number, answerMs?: number }} [options]
 * @returns {Promise<{ socket: string, token: string }>}
 */
export async function witnessGate(userData, options = {}) {
  const waitMs = options.waitMs ?? GATE_SOCKET_WAIT_MS
  const answerMs = options.answerMs ?? GATE_ANSWER_MS
  const socket = join(userData, GATE_SOCKET)

  // ⚑ **Reported before anything is attempted**, because a path over the limit produces exactly the
  // same `ENOENT` as an app that never ran, and 242 exists because those two were confused for a
  // hundred dispatches.
  if (socket.length >= SUN_PATH_MAX) {
    throw new Error(
      `the gate cannot be witnessed here: ${socket} is ${String(socket.length)} bytes and ` +
        `sun_path holds ${String(SUN_PATH_MAX - 1)}. The gate did not fail — it was never able ` +
        `to run (241 §3, 242 §1).`,
    )
  }

  /**
   * ⛔ **The ANSWER is what is retried, not merely the socket's appearance** (242, found by an
   * adversarial pass over this diff).
   *
   * 🔴 **The first version waited for `existsSync` and then asked exactly once, and that is the
   * wrong half.** `one-host-gate.ts` has no `release` — *"the kernel is the release … what survives
   * on POSIX is the path"* — so on every relaunch onto a reused `userData` the previous app's
   * socket path is **already there**, the wait is satisfied instantly, and the single connect can
   * land inside the new app's `claimed()` loop: the interval between `tidy(path)` unlinking the
   * stale name and `link` putting the live one back. ⚠️ **Three call sites relaunch onto a reused
   * `userData`** (`resume-live-smoke`'s second app, `packaged-smoke`'s step 5, `ui-live-smoke`'s
   * `reuse: true` launches), so this is the ordinary path, not a corner.
   *
   * ⛔ **And the cost of getting it wrong is the worst kind**: a transient becomes a hard red, the
   * step reaps the app it launched, and the run blames the product for the instrument's own race.
   * ⚑ An instrument built to catch a silent failure must not invent a loud one.
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
 * ⚠️ **Mirrors `one-host-gate.ts`'s own `ask`**, including the part that matters: a connection that
 * opens and says NOTHING is not a BroBot, and is reported as no answer rather than as an empty one.
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
