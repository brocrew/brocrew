/**
 * 🔴 **The one deadline this app keeps from outside itself** (294, from `270` finding 1).
 *
 * ## ⛔ Why a whole process, for a `setTimeout`'s job
 *
 * `270` refused to adopt BroBot over an idle ⌘Q that left the window black and the process and its
 * port alive for **60.489 s**. `271` answered it with {@link ELECTRON_EXIT_GRACE_MS} — *"asked
 * Electron to exit 2000ms ago and is still running; everything of ours is closed, so leaving now"* —
 * and `273` and `272` built the gate that watches it. ⚑ **None of them ever saw it fire, and 294
 * found out why: it cannot.**
 *
 * Measured on this machine, on `main`, with the app's own report as the clock:
 *
 * | what was armed, and when | ticks during a 25–45 s hang |
 * |---|---|
 * | `setTimeout(…, 2000).unref()` after `app.quit()` — 271's hatch | **0** (armed every run) |
 * | the same timer **ref**'d | **0** |
 * | a `setInterval(…, 250)` armed on the line **before** `app.quit()` | **0** |
 * | a `worker_thread` timer, `unref`'d — 6 hangs | **0** |
 * | a `worker_thread` timer, `ref`'d — 4 quits, 2 hung | **0** |
 * | a **detached child process** — 6 loaded quits | **6/6, at +2.15–2.23 s** |
 *
 * ⛔ **Once Electron begins its quit, main-process JavaScript stops running.** The four ordered steps
 * finish and report at **+1 ms**, Electron emits `will-quit` and `quit` at **+106 ms**, the window
 * goes at **+350 ms** — and then the process sits in `mach_msg2_trap` with zero child processes,
 * doing nothing, indefinitely. Every bound expressed inside that process is a promise it has already
 * lost the ability to keep.
 *
 * ⚠️ **And it is not ours to fix.** Twenty lines of bare Electron 43.2.0 — one window, no BroBot code
 * at all — hang in **5 of 6** loaded quits with the same `will-quit`/`quit`-then-nothing signature.
 * The disease is the engine's; the only thing this repository can own is the bound.
 *
 * ## ⚑ Why the parent pid is the identity, and no other check is needed
 *
 * A deadline that outlives its subject is a deadline that can kill the wrong thing: pids are reused,
 * and *"kill 4242 in two seconds"* is a promise about a NUMBER rather than about a process. This one
 * is not, because the closer is the app's **child** — so `process.ppid` IS the app, checked by the
 * kernel, and the instant the app exits the answer stops being its pid. ⛔ **There is no window in
 * which this can name something else**, which is the same argument `provider-home.ts` makes for
 * holding a descriptor rather than re-reading a path.
 *
 * ⚠️ **W4.128 · except on Windows**, which never rewrites a child's parent id: there `process.ppid`
 * stays the app's pid after the app is gone, so the closer always waited its budget out and then
 * killed whatever process the app's old pid had been handed to — measured on GitHub's Windows
 * runner, on every quit; after an update that can be the installer. ⚑ So on Windows, at the
 * deadline, the closer first asks whether that pid is still a process of the app's own executable
 * (`tasklist`, by pid and image name), and stops nothing and says nothing when it is not. ⛔ Not a
 * stdin pipe that closes with the app: Electron frees Node — and every pipe it holds — before the
 * engine's own hang, so the closer would leave exactly when it is needed (second review).
 *
 * ⚠️ **It also has no cancel, and does not need one.** Nothing can cancel it — there is no line
 * after the quit on which a cancel could run. It stands down by noticing its parent is gone, which
 * is the only signal that still exists once we are, and it polls for that rather than sleeping so a
 * healthy quit is not shadowed by a process that outlives it by two seconds.
 */

import { win32 } from 'node:path'

/** How often the closer asks whether the app it is watching is still there. */
const WATCH_INTERVAL_MS = 100

/**
 * The closer, as a program rather than a file.
 *
 * ⚠️ **`-e` and not a script on disk, deliberately.** A packaged BroBot is an `asar` archive and a
 * path inside one is a path that has been wrong before (214). A program passed on the command line
 * cannot be missing from a build, cannot be shadowed by a stale copy, and needs no packaging rule of
 * its own.
 *
 * ⚠️ **Everything it needs is baked in as a literal**, so it reads no argv and no environment: the
 * two numbers are the whole of its state.
 *
 * 🔴 **The deadline is ABSOLUTE, and that is a correction rather than a detail** (294). Written as
 * `Date.now()+2000` it is evaluated when the closer has finished STARTING, so the app's two-second
 * promise silently becomes two seconds plus however long it took a detached Node to boot — about
 * 200 ms idle, and **~3 s on a machine at load 252**, where it produced the one failure in twenty
 * that this correction removes (`quit:check` measured the app gone at 5,132 ms against its 5,000 ms
 * budget). Baked in from the app's own clock, a slow start EATS the budget instead of extending it:
 * the promise is what the person waits, not what the mechanism costs. ⚠️ A closer that starts after
 * its deadline kills at once, which is correct — the app has already had its two seconds — and the
 * parent check above still runs first, so an app that left on time is never touched.
 */
export function closerProgram(
  targetPid: number,
  deadlineAt: number,
  withinMs: number,
  /**
   * Windows only: the app's executable's file name — what the pid must still run to be the app —
   * and `tasklist`'s full path, which asks.
   */
  onWindows: { readonly image: string; readonly tasklist: string },
): string {
  return (
    `const target=${String(targetPid)},due=${String(deadlineAt)};` +
    `const tick=setInterval(()=>{` +
    // The app left on its own — the ordinary case, and the reason this polls instead of sleeping.
    `if(process.ppid!==target){clearInterval(tick);process.exit(0)}` +
    // Windows retains the original parent id after exit; a missing pid ends the watch early.
    `if(process.platform==="win32"){try{process.kill(target,0)}catch(e){if(e&&e.code==="ESRCH"){clearInterval(tick);process.exit(0)}}}` +
    `if(Date.now()<due)return;` +
    `clearInterval(tick);` +
    // ⚑ W4.128 · Windows: the pid is still the app's only while it is a process of the app's image.
    // ⛔ A pid it cannot vouch for — `tasklist` itself failing included — is not killed.
    `if(process.platform==="win32"){let mine=false;try{mine=String(require("child_process").execFileSync(${JSON.stringify(onWindows.tasklist)},["/FI","PID eq "+target,"/FI",${JSON.stringify(`IMAGENAME eq ${onWindows.image}`)},"/NH","/FO","CSV"],{encoding:"utf8",windowsHide:true,timeout:5000,stdio:["ignore","pipe","ignore"]})).toLowerCase().includes(${JSON.stringify(`"${onWindows.image.toLowerCase()}"`)})}catch(e){}if(!mine)process.exit(0)}` +
    `console.error("BroCrew asked Electron to exit ${String(withinMs)}ms ago and is still running; ` +
    `everything of ours is closed, so it is being stopped now");` +
    `try{process.kill(target,"SIGKILL")}catch(e){}` +
    `process.exit(0)},${String(WATCH_INTERVAL_MS)});`
  )
}

export interface CloserSpawnOptions {
  detached: boolean
  stdio: ['ignore', 'inherit', 'inherit']
  env: NodeJS.ProcessEnv
}

/**
 * The one thing this module does to the world, injected so a test can watch it being asked for.
 *
 * ⚠️ **Shaped so that `node:child_process`'s own `spawn` satisfies it** — the production wiring
 * passes that function directly, so a signature only a fake could meet would be a seam that proves
 * nothing about the real call.
 */
export type CloserSpawn = (
  command: string,
  args: string[],
  options: CloserSpawnOptions,
) => { unref: () => void }

export interface LastResortDeps {
  spawn: CloserSpawn
  /** Epoch milliseconds, injected so a test can name the deadline it expects to be baked in. */
  now: () => number
  /** The Electron binary. Run as plain Node by the environment below — see {@link armLastResortExit}. */
  execPath: string
  pid: number
  env: NodeJS.ProcessEnv
}

/**
 * Arm the closer. Returns nothing and awaits nothing: the caller is about to stop being able to.
 *
 * ⚠️ **`ELECTRON_RUN_AS_NODE` is set rather than assumed absent** — `process.execPath` in the main
 * process is the Electron binary, and without this the closer would boot a second copy of the whole
 * application, which is the accident `window-opens-check.mjs` and `app-closes-check.mjs` both had to
 * write down in the other direction.
 *
 * ⚠️ **`stdio` keeps stderr**, because a bound that fires silently is a bound nobody can tell from a
 * clean exit — and the sentence it prints is the one `270` needed and did not get. It takes no stdin
 * so nothing can block it.
 */
export function armLastResortExit(deps: LastResortDeps, withinMs: number): void {
  const deadlineAt = deps.now() + withinMs
  const program = closerProgram(deps.pid, deadlineAt, withinMs, {
    image: win32.basename(deps.execPath),
    tasklist: win32.join(deps.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tasklist.exe'),
  })
  const closer = deps.spawn(deps.execPath, ['-e', program], {
    detached: true,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...deps.env, ELECTRON_RUN_AS_NODE: '1' },
  })
  // ⚠️ **Unreferenced, so the closer can never be the reason the app is still here.** It is the
  // opposite of the timer it replaces: that one could not keep the app alive and could not fire
  // either; this one fires from its own process and must not hold ours open for its budget.
  closer.unref()
}
