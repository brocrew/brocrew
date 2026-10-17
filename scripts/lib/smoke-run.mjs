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
 *
 * ⚠️ **The private name it binds first — `.oh-<8 hex>` — is deliberately SHORTER than this one**, so
 * budgeting the public name budgets both. That is stated in `one-host-gate.ts` and is why one
 * constant is enough here.
 */
export const GATE_SOCKET = 'one-host.sock'

/**
 * 🔴 **WHAT A LIVE SMOKE CANNOT REACH — the audit 242 §1 asked for, kept where the environment is
 * decided.**
 *
 * ⛔ **The finding this list exists for is not the socket; it is that nobody had a list.** A shipped
 * feature was switched off in every instrument for a hundred dispatches because the smoke's
 * environment differs from a person's in ways nothing enumerates. ⚠️ **Each line below is a
 * behaviour the product HAS that no live run can execute** — and, where the smoke has a step whose
 * name implies otherwise, what that step actually proves.
 *
 * | # | axis | what cannot happen | what the smoke claims |
 * |---|---|---|---|
 * | 1 | **path length** | ~~the one-host gate~~ — **closed by 242 §1** | now witnessed on every launch |
 * | 2 | **a populated upgrade** | 16 migrations exist and every run starts on an EMPTY database, so `0001…0015` have never been applied to real rows | *"1b2 a fresh install is empty"* — which is exactly, and only, what it tests |
 * | 3 | **the real silence window** | `BROBOT_SILENCE_WINDOW_MS=2000` against a shipped **two minutes** | *"6b provider liveness goes silent"* proves the mechanism, never the value |
 * | 4 | **the user's own home** | `~/.claude` and `~/.codex` adoption (`adopt/user-homes.ts`) is what `personal-home-guard.mjs` exists to forbid | nothing claims it; the guard's assertion is the opposite claim |
 * | 5 | **packaged/dev split** | `electron-vite dev` means `app.isPackaged === false`: dev DevTools in the menu, `isDevDocument` instead of `isPackagedDocument` in the navigation guard, an `http://localhost` origin where production is `file://` — so `localStorage`, CSP and the whole file-URL branch of `window-navigation.ts` are a different code path | `smoke:packaged` covers the binary resolution (`codex-binary.ts`) and the bundle; it drives 7 steps, not 98 |
 * | 6 | **first launch as an app** | ⚠️ measured, because the guess was wrong: the bundle IS signed — `Apple Development: …`, timestamped, no provisioning profile — but it is not a Developer ID and not notarized, and it is started from a terminal. So Gatekeeper's assessment, the quarantine bit and every TCC prompt are skipped, and the app inherits the terminal's grants instead of asking for its own | nothing claims it |
 * | 7 | **a case-sensitive volume** | APFS here folds case (238 measured more than ASCII); every path comparison that would differ is untested | nothing claims it |
 * | 8 | **a real OS drag** | 11f/218 drives `Input.dispatchDragEvent` — Chromium's own drag, not the window server's — and its own step says a *"synthesised DataTransfer is read-only"* | *"a file DRAGGED onto the composer"*, which is a Chromium drag |
 * | 9 | **a window nobody is looking at** | a hidden document runs no animation frames and throttles timers ~9× (175 §1); ⚑ since 695 a window the run LAUNCHES is never shown and runs unthrottled, so its page reads `visible` — only an attached, covered one is still hidden | step 29 SKIPS itself when the page is hidden and says so, which is the honest version |
 * | 10 | **env-gated maintenance** | a rebuild named by `BROBOT_REDERIVE` | it is a tool, not a user path |
 * | 11 | **a reopen INSIDE one window** | 🔴 `smoke:resume` quits and relaunches, so its reopen always lands in a brand-new renderer that holds no record for the session; the ONE in-window reopen any instrument performs (`smoke:ui` 11b) is a Claude conversation, and Claude emits nothing between `register` and the answer | *"the session is offered back"* / *"reopen it and find the prior transcript there"* — both true, and neither is the gesture 239's defect needs |
 *
 * ⚑ **Only #1 was silent.** Every other line here is either declared by the step that meets it or
 * outside what any step claims — which is the state this list is meant to keep them in.
 *
 * ⛔ **#11 is the one that was found the hard way, and it is the pattern worth keeping.** An
 * assertion for 242 §3 was written into `smoke:resume` step 5 and then **A/B'd against the defect**
 * — the fix reverted, the smoke re-run live — and it **passed**, 10/10. The ledger showed six events
 * inside the hand-over window, so the events were there; what was missing was a record for them to
 * be mis-routed into. ⚠️ **A check nobody proves can fail is the same class of thing as a gate
 * nobody proves can bind**, so it was removed rather than shipped, and the shape the instrument
 * would need is written here instead: a **Codex** conversation closed and reopened **without
 * quitting the app**.
 */

/**
 * ⛔ **A base short enough that the gate can exist**, and private enough to hold provider homes.
 *
 * `os.tmpdir()` is `/var/folders/<2>/<28>/T` on macOS — **48 bytes**, and per-user, which is why it
 * was the obvious choice and why it cost the gate. `/tmp` is **4**, and — measured with a probe
 * Electron — Chromium **resolves `--user-data-dir` before it uses it**: `/tmp/x` came back from
 * `app.getPath('userData')` as `/private/tmp/x`. ⚑ **So the root is resolved HERE**, and the string
 * this module budgets is the string the kernel will see. Budgeting the unresolved one would have
 * been 8 bytes of headroom that does not exist.
 *
 * ⚠️ **`/tmp` is world-writable (mode 1777) and `os.tmpdir()` is not**, and a smoke's evidence tree
 * holds copied provider auth. So the root is created `0700`, re-`chmod`'d if it was already there,
 * and a root this user does not own — or that is a symlink pointing somewhere else — is refused
 * rather than written into.
 *
 * ⛔ **Windows keeps `os.tmpdir()`.** There is no `/tmp`, and a named pipe has no length limit to
 * respect (`hostGatePath`'s win32 branch is not a path at all).
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
    // No `/tmp` is not a machine we know, and a longer base is better than no root at all — the
    // budget check below is what turns that into a loud failure rather than a silent one.
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
  // `mkdir` does not change the mode of a directory that already exists, and the roots that exist
  // today were made before this rule.
  chmodSync(root, 0o700)
  return root
}

/**
 * ⛔ **The per-call half of the budget, so it cannot drift** (242 §1).
 *
 * {@link beginSmokeRun} checks the longest name a smoke SAYS it will use; this checks the one it is
 * actually about to use. ⚑ **The two together are the rule**: a declaration can go stale when
 * somebody adds a launch, and this cannot — the overflow is reported at the line that caused it,
 * with both numbers, instead of arriving as a gate that quietly does nothing for the rest of the
 * run.
 *
 * Not on Windows, where the gate is a named pipe and no path at all ({@link smokeTmpRoot} says the
 * same): there is no `sun_path` to fit, and a GitHub runner's `%TEMP%`
 * (`C:\Users\RUNNER~1\AppData\Local\Temp`) would put every run's socket path past 104 bytes.
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
 * ⛔ **One directory per RUN, and a lock so there is only ever one run** (188 §2, from 182 M7).
 *
 * Every live smoke used to write into a FIXED root that it wiped at start — `/tmp/brobot2-ui-smoke`,
 * `/tmp/brobot2-resume-smoke` — and that cost two different things.
 *
 * **Provenance.** The log, the screenshots, the stall dumps, the user-data database and WAL, the
 * provider homes, the auth copies, the transcripts, the raw frames and the usage rows of a run were
 * deleted by the next run. So the evidence for a failure existed exactly until someone tried to
 * reproduce it, and the bill a dispatch reported could never be re-read.
 *
 * **Isolation.** Two concurrent runs had no run id and no lock. B's wipe deleted A's live tree, both
 * then wrote into a recreated root, and the result is a failure that reads like a product bug. ⚑ 183
 * and 185 both found foreign processes and a foreign `~/.codex` write on this machine, so *"nobody
 * would run two at once"* is not an assumption these scripts get to make — and 187's own mutation
 * harness lost a table to exactly this, one directory over.
 *
 * ## What replaces it
 *
 * A run id (UTC timestamp + pid, so it sorts chronologically and never collides), a directory of its
 * own under each root, and an atomic lock. ⚠️ **`mkdir` IS the lock**: it either creates the
 * directory or fails, with no window between checking and claiming. A leftover lock from a killed
 * run is reported with its owner rather than stolen — an automatic steal puts two runs back in one
 * tree, which is the defect this exists for.
 *
 * ⚠️ **`latest` stays a stable path.** It is a symlink to the newest run, so the
 * `/tmp/brobot2-ui-smoke/latest/smoke.log` in someone's notes still opens something — which is the
 * one thing the fixed root was genuinely good for. ⚑ **That sentence has been in this file since
 * 188 and was false until 242**: the root was `os.tmpdir()`, so the path a person was told to open
 * was `/var/folders/2k/0fng…/T/brobot2-ui-smoke/latest/smoke.log` and `/tmp/brobot2-ui-smoke` did
 * not exist. {@link smokeTmpRoot} moved the roots for the gate's sake and made the documentation
 * true as a side effect.
 *
 * ⚑ **Old runs are pruned, not kept forever.** Provenance for the last few runs beats provenance
 * until the disk fills; `keep` is the caller's, because a resume smoke and a 60-step UI smoke do not
 * cost the same.
 *
 * 🔴 **708 · except a run somebody is still reading** (`704` H-7) — see {@link KEPT_MARK}.
 *
 * ⛔ **`longestUserData` is the budget declaration, and it is checked BEFORE the lock** (242 §1).
 * The caller names the longest directory it will ever hand an app as `--user-data-dir` inside this
 * run, and a run whose gate socket would not fit {@link SUN_PATH_MAX} does not start — instead of
 * starting, passing, and having proved nothing about a feature that could not execute. ⚠️ **Before
 * the lock and before any `mkdir`**, so a refused run leaves no tree and steals no other run's turn.
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

  // ⛔ 242 §1. `smokeUserDataDir` throws with both numbers; nothing has been created yet.
  smokeUserDataDir(evidence, options.longestUserData ?? 'user-data')

  mkdirSync(evidenceRoot, { recursive: true })
  try {
    mkdirSync(lock)
  } catch {
    let owner = 'unknown'
    try {
      owner = readFileSync(join(lock, 'owner'), 'utf8').trim()
    } catch {
      // An owner file that is not there tells us nothing — and is not a reason to take the lock.
    }
    throw new Error(
      `another smoke run owns ${evidenceRoot} (owner: ${owner}). Wait for it to finish, or remove ` +
        `${lock} if you are sure that run is gone.`,
    )
  }
  writeFileSync(join(lock, 'owner'), `pid ${pid} · run ${runId}\n`)

  let released = false
  // ⚠️ **The teardown detaches its own listeners**, so a process that begins several runs (the unit
  // suite does) does not accumulate a handler per run. A leaked listener here would be a warning
  // today and a real leak in anything long-lived that ever calls this twice.
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
 * 🔴 **708 · the file that keeps a run from the prune** (`704` H-7).
 *
 * ⛔ **Why it exists.** `704` traced four runs' ledgers to name two reds, and its own isolated
 * re-runs of single steps pruned all four — the default keeps the newest five, and a dispatch that
 * reruns while it reads is exactly the caller that makes five new ones. The ledgers survived only
 * because they had been copied out first, by hand.
 *
 * ⚑ **So a run is kept by a FILE inside it, not by a flag on the next run.** The dispatch that is
 * reading run `R` writes `R/.kept` once, in the EVIDENCE root — `touch <evidence root>/<run>/.kept`
 * (a mark in the scratch root is not read) — and every later prune, by any smoke, spares BOTH halves
 * of that run until the file is removed. ⚠️ **A kept run does not count against `keep`**: the newest
 * `keep` UNKEPT runs are kept as well, so reading an old run never costs a new one its evidence.
 * ⛔ It is never removed by this module — a run somebody marked is a run somebody has to unmark —
 * so every prune SAYS how many it spared, and a forgotten mark is visible rather than silent.
 * ⚠️ **Not a way past a reboot**: the evidence root is under `/tmp`, which the OS clears; evidence
 * needed after one is copied out (`preserved-evidence-in-tmpdir-dies-at-the-next-reboot`).
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
 * Keep the newest `keep` runs under both roots — and every run marked {@link KEPT_MARK} (708).
 *
 * ⚠️ **Sorted by NAME, which is why the run id starts with an ISO timestamp**: a directory listing is
 * not ordered, and an mtime is a fact about the last write rather than about when the run began.
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
  // ⛔ **708 · a kept run is not a candidate at all**, so it neither goes nor counts against `keep`.
  const runs = every.filter((name) => !existsSync(join(evidenceRoot, name, KEPT_MARK)))
  const kept = every.length - runs.length
  if (kept > 0) console.log(`smoke-run: sparing ${String(kept)} kept run(s) in ${evidenceRoot}`)
  for (const name of runs.slice(0, Math.max(0, runs.length - keep))) {
    rmSync(join(evidenceRoot, name), { recursive: true, force: true })
    rmSync(join(scratchRoot, name), { recursive: true, force: true })
  }
}
