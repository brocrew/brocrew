import { execFile } from 'node:child_process'

/**
 * Share the hidden-launch switch with every launcher. `launch-presentation.ts` keeps these
 * windows unseen, titled `BroBot2 — test`, unthrottled and without dialogs.
 * The source census requires the imported switch in argv, or an explicit `695-visible:`
 * exemption explaining why the product window must be seen. Keep that scanner token intact.
 * Pass the switch after `--` in `electron-vite dev`, whose earlier arguments belong to Vite.
 */
export const HIDDEN_LAUNCH_ARG = '--brobot-hidden'

/** ⚑ The title a hidden launch's own bar draws — `launch-presentation.ts`'s `HIDDEN_TITLE`. */
export const HIDDEN_TITLE = 'BroCrew — test'

function run(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 16 * 1024 * 1024, timeout: 10_000 }, (error, stdout) =>
      error ? reject(error) : resolve(String(stdout)),
    )
  })
}

/**
 * Identify this launch's processes by its unique --user-data-dir, not by executable name. Matching
 * Electron by name could include the person's running app.
 */
export async function pidsLaunchedOn(userDataDir) {
  const table = await run('ps', ['-axo', 'pid=,command='])
  const flag = `--user-data-dir=${userDataDir}`
  return table.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line)
    if (match === null || !match[2].includes(flag)) return []
    // ⚠️ Not a following character that would make it a LONGER path — `…/user-data-2`.
    const after = match[2].slice(match[2].indexOf(flag) + flag.length)[0]
    return after === undefined || after === ' ' ? [Number(match[1])] : []
  })
}

/**
 * ⛔ **What the window server says is ON SCREEN for these processes, right now** — `null` when this
 * is not a Mac or the read failed, never `[]`: *could not look* is not *looked and saw nothing*
 * (standing rule 34).
 *
 * ⚑ `CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly)` through JXA, which ships with
 * macOS — no module to install, about 0.1 s a read. It reads the window server's list; it touches no
 * app, no port and no user data.
 */
export async function onScreenWindowsOf(pids) {
  if (process.platform !== 'darwin' || pids.length === 0) return null
  const script =
    'ObjC.import("CoreGraphics");' +
    'JSON.stringify(ObjC.deepUnwrap(ObjC.castRefToObject(' +
    '$.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, 0))).map(' +
    '(w) => ({ pid: w.kCGWindowOwnerPID, name: w.kCGWindowName || "", layer: w.kCGWindowLayer,' +
    ' width: (w.kCGWindowBounds || {}).Width, height: (w.kCGWindowBounds || {}).Height })))'
  let listed
  try {
    listed = JSON.parse(await run('osascript', ['-l', 'JavaScript', '-e', script]))
  } catch {
    return null
  }
  const ours = new Set(pids)
  return listed.filter((one) => ours.has(one.pid))
}

/**
 * ⚑ **A run-long watch: every launch's windows, sampled until `stop()`** — so *"no window on the
 * screen"* is a measurement of the whole run rather than of one moment (695 §4.1).
 *
 * `dirs()` is asked on every tick, so a launch made halfway through the run is watched from then
 * on. A tick that could not look counts as `blind`, never as clean.
 */
export function watchOffScreen(dirs, everyMs = 2_000) {
  const sightings = []
  /** ⚑ Looks PER launch directory — a directory never looked at is not a directory that was clean. */
  const perDir = new Map()
  let samples = 0
  let blind = 0
  let busy = false
  const timer = setInterval(async () => {
    if (busy) return
    busy = true
    try {
      for (const dir of dirs()) {
        const pids = await pidsLaunchedOn(dir)
        if (pids.length === 0) continue
        const windows = await onScreenWindowsOf(pids)
        if (windows === null) {
          blind += 1
          continue
        }
        samples += 1
        perDir.set(dir, (perDir.get(dir) ?? 0) + 1)
        if (windows.length > 0) sightings.push({ at: new Date().toISOString(), dir, windows })
      }
    } catch {
      blind += 1
    } finally {
      busy = false
    }
  }, everyMs)
  timer.unref?.()
  return {
    stop() {
      clearInterval(timer)
      return { samples, blind, sightings, perDir: new Map(perDir), everyMs }
    },
  }
}
