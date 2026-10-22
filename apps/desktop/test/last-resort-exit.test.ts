import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  armLastResortExit,
  closerProgram,
  type CloserSpawnOptions,
} from '../src/main/last-resort-exit'

/**
 * 🔴 **The bound that is not a timer, proved against real processes** (294).
 *
 * ⛔ **A fake clock cannot test this and that is the whole point of the file.** `271` wrote the same
 * promise as `setTimeout(…, 2000)`, and `app-lifetime.test.ts` proved it by advancing a fake timer
 * and reading the exit — green for three dispatches over a mechanism that has never once fired in a
 * real application, because after `app.quit()` no timer in that process ever comes due again. ⚑ The
 * only instrument that can tell those apart is a real process that really will not leave.
 *
 * ⚠️ **The subject really is the shipped module**: the stubborn "app" below is a TypeScript file run
 * by Node 24's own type stripping, and it imports `armLastResortExit` from `src/main`. Nothing here
 * re-implements the closer, which is the mistake that would make all of this pass over a copy.
 */

const MODULE = join(
  dirname(fileURLToPath(import.meta.url)),
  '../src/main/last-resort-exit.ts',
).replace(/\\/g, '/')

let workspace: string | null = null
const scratch = (): string => (workspace ??= mkdtempSync(join(tmpdir(), 'b2-closer-')))

afterEach(() => {
  if (workspace !== null) rmSync(workspace, { recursive: true, force: true })
  workspace = null
})

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
async function goneWithin(pid: number, ms: number): Promise<number | null> {
  const began = Date.now()
  while (Date.now() - began < ms) {
    if (!alive(pid)) return Date.now() - began
    await sleep(25)
  }
  return null
}

/**
 * An app that arms the closer against itself and then refuses every polite request to leave —
 * `SIGTERM` and `SIGINT` handled and ignored, and an interval holding the loop open.
 *
 * ⚠️ **Stubborn by ignoring signals rather than by being wedged**, because a genuinely wedged
 * process cannot be built portably. The distinction does not matter to the closer: `SIGKILL` is not
 * deliverable to a handler either way, so what is measured is the same kill.
 */
function stubbornApp(budgetMs: number, exitAfterMs: number | null): string {
  const file = join(scratch(), 'stubborn.ts')
  writeFileSync(
    file,
    [
      `import { spawn } from 'node:child_process'`,
      `import { armLastResortExit } from ${JSON.stringify(pathToFileURL(MODULE).href)}`,
      `armLastResortExit(`,
      `  { spawn, now: () => Date.now(), execPath: process.execPath, pid: process.pid, env: process.env },`,
      `  ${String(budgetMs)},`,
      `)`,
      `process.on('SIGTERM', () => {})`,
      `process.on('SIGINT', () => {})`,
      `console.error('stubborn ' + String(process.pid))`,
      exitAfterMs === null
        ? `setInterval(() => {}, 1_000)`
        : `setTimeout(() => process.exit(0), ${String(exitAfterMs)})`,
    ].join('\n'),
  )
  return file
}

/** Start it and hand back its pid and a live view of what it and its closer have printed. */
async function launch(file: string) {
  const child = spawn(process.execPath, [file], { stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))
  let closed: number | null = null
  const began = Date.now()
  child.on('close', () => (closed = Date.now() - began))
  const until = Date.now() + 15_000
  while (Date.now() < until && !/stubborn \d+/.test(output)) await sleep(25)
  const pid = Number(/stubborn (\d+)/.exec(output)?.[1])
  return {
    pid,
    said: (): string => output,
    // ⚑ The pipe is shared with the closer, so this ALSO answers "has the closer let go" — which is
    // the only externally visible thing a detached process that kills nobody ever does.
    closedAt: (): number | null => closed,
    kill: (): void => {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // already gone, which is what most of these tests are about
      }
    },
  }
}

describe('the last-resort exit (294)', () => {
  /**
   * ⛔ **`270`'s finding, as a test.** An app that has been asked to go and does not is gone anyway,
   * inside the budget — and the budget is what did it, not luck: the app is still there just before
   * it expires.
   */
  it('kills an app that will not leave, at the budget and not before', async () => {
    const app = await launch(stubbornApp(1_500, null))
    expect(Number.isInteger(app.pid)).toBe(true)
    try {
      // Windows forcefully terminates SIGTERM targets even when they installed a handler.
      if (process.platform !== 'win32') process.kill(app.pid, 'SIGTERM')
      await sleep(700)
      expect(alive(app.pid), 'it left on a signal it was written to ignore').toBe(true)

      const took = await goneWithin(app.pid, 8_000)
      expect(took, 'the app that would not leave is still here').not.toBeNull()
      expect(app.said()).toContain('is being stopped now')
    } finally {
      app.kill()
    }
  })

  /**
   * 🔴 **The identity guard, and it is the half that can do damage.** A deadline that outlives its
   * subject is a promise about a NUMBER: if the app leaves on its own and the kernel hands its pid
   * to something else, an unguarded closer kills a stranger.
   *
   * ⚠️ **Asked in the direction that can be wrong**: the closer is armed by THIS process against a
   * pid that is not its own child, so the guard must refuse. Without the `process.ppid` check the
   * innocent process below dies and this test goes red — which is the only way to know the guard is
   * load-bearing rather than decorative.
   */
  it('kills nothing when the pid it was given is not its own parent', async () => {
    const innocent = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20_000)'], {
      stdio: 'ignore',
    })
    try {
      const pid = innocent.pid
      expect(pid).toBeDefined()
      armLastResortExit(
        {
          spawn,
          now: () => Date.now(),
          execPath: process.execPath,
          pid: pid as number,
          env: process.env,
        },
        400,
      )
      await sleep(2_500)
      expect(alive(pid as number), 'the closer killed a process it did not own').toBe(true)
    } finally {
      innocent.kill('SIGKILL')
    }
  })

  /**
   * ⚠️ **It stands down when the app leaves by itself, and quickly.** The ordinary quit is the
   * common case: nothing should be killed, nothing should be said, and no process should outlive the
   * app by its whole budget — which is why the closer polls for its parent instead of sleeping.
   *
   * ⚑ **Observed through the shared pipe**, because a detached process that kills nobody has no
   * other visible effect. A closer that slept its budget out would hold stderr open for ten seconds.
   */
  it('stands down, silently and promptly, when the app leaves on its own', async () => {
    const app = await launch(stubbornApp(10_000, 300))
    try {
      const until = Date.now() + 8_000
      while (Date.now() < until && app.closedAt() === null) await sleep(25)
      const closed = app.closedAt()
      expect(closed, 'the closer held the app open for its whole budget').not.toBeNull()
      expect(closed as number).toBeLessThan(5_000)
      expect(app.said()).not.toContain('is being stopped now')
    } finally {
      app.kill()
    }
  })

  it('stands down before the deadline when Windows retains a departed parent id', () => {
    const exited = new Error('the closer exited')
    const kill = vi.fn(() => {
      throw Object.assign(new Error('no process'), { code: 'ESRCH' })
    })
    const exit = vi.fn(() => {
      throw exited
    })
    const require = vi.fn()
    const error = vi.fn()
    const clearInterval = vi.fn()
    let tick = (): void => {}
    runInNewContext(
      closerProgram(4242, 10_000, 10_000, {
        image: 'BroCrew.exe',
        tasklist: 'C:\\Windows\\System32\\tasklist.exe',
      }),
      {
        process: { platform: 'win32', ppid: 4242, kill, exit },
        Date: { now: () => 300 },
        setInterval: (callback: () => void) => {
          tick = callback
          return 1
        },
        clearInterval,
        console: { error },
        require,
      },
    )
    expect(() => tick()).toThrow(exited)
    expect(kill.mock.calls).toEqual([[4242, 0]])
    expect(exit).toHaveBeenCalledWith(0)
    expect(clearInterval).toHaveBeenCalledWith(1)
    expect(require).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  /**
   * The wiring, in the two details that make the program runnable at all: it is Node that must run,
   * not a second copy of the application, and the closer must not hold the app open.
   */
  it('runs the closer as NODE, detached, and does not hold the app open', () => {
    const asked: { command: string; args: string[]; options: CloserSpawnOptions }[] = []
    let unreffed = 0
    armLastResortExit(
      {
        spawn: (command, args, options) => {
          asked.push({ command, args, options })
          return { unref: () => (unreffed += 1) }
        },
        now: () => 1_700_000_000_000,
        execPath: '/Applications/BroBot2.app/Contents/MacOS/BroBot2',
        pid: 4242,
        env: { PATH: '/usr/bin' },
      },
      2_000,
    )

    expect(asked).toHaveLength(1)
    const call = asked.at(0)
    if (call === undefined) throw new Error('the closer was never spawned')
    expect(call.command).toBe('/Applications/BroBot2.app/Contents/MacOS/BroBot2')
    // ⛔ Without this the closer boots the whole application a second time, against the userData the
    // app is in the middle of releasing.
    expect(call.options.env.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(call.options.env.PATH).toBe('/usr/bin')
    expect(call.options.detached).toBe(true)
    expect(unreffed).toBe(1)
    expect(call.args[0]).toBe('-e')
    // ⚑ The executable's own file name, for Windows' check that the pid is still the app's.
    expect(call.args[1]).toBe(
      closerProgram(4242, 1_700_000_002_000, 2_000, {
        image: 'BroBot2',
        tasklist: 'C:\\Windows\\System32\\tasklist.exe',
      }),
    )
  })

  /**
   * The program is the contract; the numbers have to reach it, and the guard has to be in it.
   *
   * ⛔ **The deadline is an ABSOLUTE instant, not an offset**, and that is the assertion rather than
   * a spelling: `Date.now()+1500` inside the program starts the budget when a detached Node has
   * finished booting, which at load 252 measured ~3 s of extra grace and put the app 132 ms past
   * `quit:check`'s budget. See {@link closerProgram}.
   */
  it('bakes the target and an ABSOLUTE deadline into the program, with the parent check', () => {
    const program = closerProgram(9_876, 1_700_000_001_500, 1_500, {
      image: 'BroBot.exe',
      tasklist: 'C:\\Windows\\System32\\tasklist.exe',
    })
    expect(program).toContain('const target=9876')
    expect(program).toContain('due=1700000001500')
    expect(program, 'the budget restarts when the closer boots').not.toContain('Date.now()+')
    expect(program).toContain('process.ppid!==target')
    // 🔴 W4.128 · Windows keeps a child's parent id after the parent is gone, so there the pid must
    // still be a process of the app's own executable — or nothing is stopped.
    expect(program).toContain(
      'execFileSync("C:\\\\Windows\\\\System32\\\\tasklist.exe",["/FI","PID eq "+target,"/FI","IMAGENAME eq BroBot.exe","/NH","/FO","CSV"]',
    )
    // ⚑ Bounded, quiet, and by name in any case.
    expect(program).toContain('timeout:5000,stdio:["ignore","pipe","ignore"]')
    expect(program).toContain(
      '.toLowerCase().includes("\\"brobot.exe\\"")}catch(e){}if(!mine)process.exit(0)}',
    )
    // ⚑ …asked before the sentence and the kill, so a pid that is not the app's hears neither.
    expect(program.indexOf('tasklist')).toBeLessThan(program.indexOf('is being stopped now'))
    expect(program).toContain(`process.kill(target,"SIGKILL")`)
    // ⚠️ It reads no argv and no environment — see the module note. A program that did could be
    // handed a different target by whatever launched it.
    expect(program).not.toContain('process.argv')
    expect(program).not.toContain('process.env')
  })
})
