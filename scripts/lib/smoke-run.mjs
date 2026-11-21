import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Budget POSIX socket paths against macOS's 104-byte `sun_path`, including the NUL byte.
 * Linux permits 108, but using the smaller limit keeps run paths portable. The filesystem
 * can accept a directory whose eventual socket name `bind` refuses.
 * Keep isolated userData paths short enough for the host gate to run; an overlong path
 * makes that gate fail open and can mask startup behaviour in an instrument.
 */
export const SUN_PATH_MAX = 104

/**
 * The gate's public name inside a `userData`, from `one-host-gate.ts`'s POSIX branch.
 * The private name it binds first (`.oh-<8 hex>`) is shorter, so budgeting this one budgets both.
 */
export const GATE_SOCKET = 'one-host.sock'

/** Keep the probes' existing socket bound and remove the unused directory on failure. */
export function checkProbeGatePath(userDataDir) {
  if (join(userDataDir, GATE_SOCKET).length > SUN_PATH_MAX) {
    rmSync(userDataDir, { recursive: true, force: true })
    throw new Error(`the one-host gate socket path would exceed ${String(SUN_PATH_MAX)} bytes.`)
  }
}

/**
 * What a live smoke cannot reach: behaviour the product has that no live run executes, and what
 * the nearest step actually proves.
 *
 * | # | axis | what cannot happen | what the smoke claims |
 * |---|---|---|---|
 * | 1 | path length | the one-host gate | witnessed on every launch (see `checkProbeGatePath`) |
 * | 2 | a populated upgrade | every run starts on an EMPTY database, so migrations `0001…0015` have never been applied to real rows | "a fresh install is empty", and only that |
 * | 3 | the real silence window | `BROBOT_SILENCE_WINDOW_MS=2000` against a shipped two minutes | "provider liveness goes silent" proves the mechanism, never the value |
 * | 4 | the user's own home | `~/.claude` and `~/.codex` adoption (`adopt/user-homes.ts`), which `personal-home-guard.mjs` forbids | nothing claims it |
 * | 5 | packaged/dev split | `electron-vite dev` means `app.isPackaged === false`: dev DevTools, `isDevDocument` in the navigation guard, an `http://localhost` origin instead of `file://`, so `localStorage`, CSP and the file-URL branch of `window-navigation.ts` differ | `smoke:packaged` covers binary resolution (`codex-binary.ts`) and the bundle with 7 steps |
 * | 6 | first launch as an app | the bundle is signed (`Apple Development`, no provisioning profile) but not Developer ID or notarized, and starts from a terminal, so Gatekeeper, the quarantine bit and TCC prompts are skipped and the app inherits the terminal's grants | nothing claims it |
 * | 7 | a case-sensitive volume | APFS here folds case; path comparisons that would differ are untested | nothing claims it |
 * | 8 | a real OS drag | the drag step drives `Input.dispatchDragEvent` (Chromium's drag, not the window server's) and a synthesised DataTransfer is read-only | "a file DRAGGED onto the composer" is a Chromium drag |
 * | 9 | a window nobody is looking at | a hidden document runs no animation frames and throttles timers ~9x; a window the run launches is never shown and runs unthrottled, so only an attached, covered one is hidden | the hidden-page step skips itself when the page is hidden and says so |
 * | 10 | env-gated maintenance | a rebuild named by `BROBOT_REDERIVE` | it is a tool, not a user path |
 * | 11 | a reopen inside one window | `smoke:resume` quits and relaunches, so its reopen lands in a new renderer holding no record for the session; the one in-window reopen (`smoke:ui` 11b) is a Claude conversation, and Claude emits nothing between `register` and the answer | "the session is offered back" and "reopen it and find the prior transcript" are true but are not an in-window reopen |
 *
 * #11 needs a Codex conversation closed and reopened without quitting the app. An assertion
 * written for it in `smoke:resume` still passed with the fix reverted, so it was removed: a
 * check nobody proves can fail proves nothing.
 */

/**
 * A base short enough that the gate can exist, and private enough to hold provider homes.
 *
 * `os.tmpdir()` is `/var/folders/<2>/<28>/T` on macOS (48 bytes); `/tmp` is 4. Chromium resolves
 * `--user-data-dir` before using it (`/tmp/x` comes back from `app.getPath('userData')` as
 * `/private/tmp/x`), so the root is resolved here and the string this module budgets is the one
 * the kernel sees.
 *
 * `/tmp` is world-writable (mode 1777) and the evidence tree holds copied provider auth, so the
 * root is created `0700`, re-`chmod`'d if it already existed, and a root this user does not own,
 * or that is a symlink elsewhere, is refused.
 *
 * Windows keeps `os.tmpdir()`: there is no `/tmp`, and a named pipe has no length limit.
 */
export function smokeTmpRoot(name) {
  if (process.platform === 'win32') {
    const root = join(tmpdir(), name)
    mkdirSync(root, { recursive: true })
    return root
  }
  let base
  try {
    base = realpathSync('/tmp')
  } catch {
    // A machine without `/tmp` is not one we know; a longer base beats no root, and the budget check
    // below turns that into a loud failure.
    base = tmpdir()
  }
  const root = join(base, name)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const seen = lstatSync(root)
  if (seen.isSymbolicLink() || seen.uid !== process.getuid()) {
    throw new Error(
      `${root} is not ours (uid ${String(seen.uid)}, symlink ${String(seen.isSymbolicLink())}) — ` +
        `refusing to write a smoke's evidence, which includes copied provider auth, into it`,
    )
  }
  // `mkdir` does not change the mode of a directory that already exists.
  chmodSync(root, 0o700)
  return root
}

/**
 * The per-call half of the budget, so it cannot drift.
 *
 * {@link beginSmokeRun} checks the longest name a smoke says it will use; this checks the one it
 * is about to use. A declaration can go stale when someone adds a launch; this reports the
 * overflow at the line that caused it, with both numbers.
 *
 * Not on Windows, where the gate is a named pipe and there is no `sun_path` to fit (a GitHub
 * runner's `%TEMP%` would put every socket path past 104 bytes).
 */
export function smokeUserDataDir(evidence, name, platform = process.platform) {
  const dir = join(evidence, name)
  if (platform === 'win32') return dir
  const socket = join(dir, GATE_SOCKET)
  if (socket.length >= SUN_PATH_MAX) {
    throw new Error(
      `${socket} is ${String(socket.length)} bytes and sun_path holds ${String(SUN_PATH_MAX - 1)} ` +
        `— the one-host gate would fail open and do nothing for this whole run (242 §1). Shorten ` +
        `the userData name "${name}" or the evidence root.`,
    )
  }
  return dir
}

/**
 * One directory per run, and a lock so only one run is active.
 *
 * Each run gets a run id (UTC timestamp + pid, so it sorts chronologically and never collides),
 * a directory under each root, and an atomic lock: `mkdir` is the lock, creating the directory
 * or failing with no gap between check and claim. A leftover lock from a killed run is reported
 * with its owner, not stolen, since stealing puts two runs back in one tree.
 *
 * `latest` is a symlink to the newest run, so a stable path like
 * `/tmp/brobot2-ui-smoke/latest/smoke.log` still opens something.
 *
 * Old runs are pruned; `keep` is the caller's, because a resume smoke and a 60-step UI smoke do
 * not cost the same. A run marked with {@link KEPT_MARK} is spared.
 *
 * `longestUserData` is the budget declaration: the longest directory the caller will hand an app
 * as `--user-data-dir`. It is checked before the lock and before any `mkdir`, so a run whose gate
 * socket would not fit {@link SUN_PATH_MAX} does not start and leaves no tree.
 *
 * @param {{ evidenceRoot: string, scratchRoot: string, keep?: number, now?: () => Date, pid?: number, longestUserData?: string }} options
 * @returns {{ runId: string, evidence: string, scratch: string, release: () => void }}
 */
export function beginSmokeRun(options) {
  const { evidenceRoot, scratchRoot } = options
  const keep = options.keep ?? 5
  const at = (options.now ?? (() => new Date()))()
  const pid = options.pid ?? process.pid
  const runId = `${at.toISOString().replace(/[:.]/g, '-')}-${pid}`
  const evidence = join(evidenceRoot, runId)
  const scratch = join(scratchRoot, runId)
  const lock = join(evidenceRoot, '.lock')

  // `smokeUserDataDir` throws with both numbers; nothing has been created yet.
  smokeUserDataDir(evidence, options.longestUserData ?? 'user-data')

  mkdirSync(evidenceRoot, { recursive: true })
  try {
    mkdirSync(lock)
  } catch {
    let owner = 'unknown'
    try {
      owner = readFileSync(join(lock, 'owner'), 'utf8').trim()
    } catch {
      // A missing owner file tells us nothing and is not a reason to take the lock.
    }
    throw new Error(
      `another smoke run owns ${evidenceRoot} (owner: ${owner}). Wait for it to finish, or remove ` +
        `${lock} if you are sure that run is gone.`,
    )
  }
  writeFileSync(join(lock, 'owner'), `pid ${pid} · run ${runId}\n`)

  let released = false
  // The teardown detaches its own listeners, so a process that begins several runs (the unit
  // suite does) does not accumulate a handler per run.
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP']
  const onSignal = () => {
    release()
    process.exit(1)
  }
  const release = () => {
    process.off('exit', release)
    for (const signal of signals) process.off(signal, onSignal)
    if (released) return
    released = true
    rmSync(lock, { recursive: true, force: true })
  }
  process.on('exit', release)
  for (const signal of signals) process.on(signal, onSignal)

  mkdirSync(evidence, { recursive: true })
  mkdirSync(scratch, { recursive: true })
  markLatest(evidenceRoot, evidence)
  prune(evidenceRoot, scratchRoot, keep)
  return { runId, evidence, scratch, release }
}

/**
 * The file that keeps a run from the prune.
 *
 * A dispatch reading run `R` writes `R/.kept` in the evidence root
 * (`touch <evidence root>/<run>/.kept`; a mark in the scratch root is not read), and every later
 * prune, by any smoke, spares both halves of that run until the file is removed. A kept run does
 * not count against `keep`: the newest `keep` unkept runs are retained as well. This module never
 * removes the mark, so every prune says how many it spared.
 *
 * It does not survive a reboot: the evidence root is under `/tmp`, which the OS clears.
 */
export const KEPT_MARK = '.kept'

/** `<root>/latest` → this run. A filesystem that will not take a symlink costs a convenience only. */
function markLatest(root, evidence) {
  const latest = join(root, 'latest')
  try {
    rmSync(latest, { recursive: true, force: true })
    symlinkSync(evidence, latest)
  } catch {
    // Not worth failing a live run over.
  }
}

/**
 * Keep the newest `keep` runs under both roots, and every run marked {@link KEPT_MARK}.
 *
 * Sorted by name, which is why the run id starts with an ISO timestamp: a directory listing is
 * not ordered, and an mtime reflects the last write rather than when the run began.
 */
function prune(evidenceRoot, scratchRoot, keep) {
  let entries
  try {
    entries = readdirSync(evidenceRoot, { withFileTypes: true })
  } catch {
    return
  }
  const every = entries
    .filter(
      (entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'latest',
    )
    .map((entry) => entry.name)
    .sort()
  // A kept run is not a candidate at all, so it neither goes nor counts against `keep`.
  const runs = every.filter((name) => !existsSync(join(evidenceRoot, name, KEPT_MARK)))
  const kept = every.length - runs.length
  if (kept > 0) console.log(`smoke-run: sparing ${String(kept)} kept run(s) in ${evidenceRoot}`)
  for (const name of runs.slice(0, Math.max(0, runs.length - keep))) {
    rmSync(join(evidenceRoot, name), { recursive: true, force: true })
    rmSync(join(scratchRoot, name), { recursive: true, force: true })
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function waitFor(what, predicate, timeoutMs = 60_000, pollMs = 250) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await predicate()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await sleep(pollMs)
  }
}
