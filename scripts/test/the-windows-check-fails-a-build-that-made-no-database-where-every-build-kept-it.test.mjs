import { readFileSync } from 'node:fs'
import { dirname, join, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { HIDDEN_LAUNCH_ARG } from '../lib/hidden-launch.mjs'

/**
 * # ⛔ W4.90 · check 5 of `windows-packaged-check.mjs` — the data folder — run WITHOUT the app
 *
 * The check launches `BroBot.exe` on its DEFAULT data folder, so it can only ever run on a
 * GitHub-hosted Windows runner — and so its branches were never run anywhere else. ⚑ This file
 * reads `theDataStaysWhereItWas` out of the script as TEXT and runs it against stand-ins: a clock, a
 * file system that is a set of paths, a `spawn` that starts nothing and a `spawnSync` that kills
 * nothing. ⛔ Nothing here starts a process, touches a real folder or imports the script (importing
 * it would run all five checks).
 *
 *  - §1 · where it refuses to launch anything: off a hosted runner, off Windows, and on a runner
 *    that already has a data folder.
 *  - §2 · what it concludes from a launch: the database in the pinned folder passes; an app that ran
 *    the whole wait and made none FAILS (the review's ask — it was a warning); an app that ended
 *    first is a warning, and is not killed; a folder named after the app fails even beside a database.
 */

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'windows-packaged-check.mjs')
const SOURCE = readFileSync(SCRIPT, 'utf8')

/** The check's own text: its wait, and the function, up to where the script awaits it. */
function checkFiveText() {
  const start = SOURCE.indexOf('\nconst DATA_WAIT_MS = ')
  const end = SOURCE.indexOf('\nawait theDataStaysWhereItWas()\n')
  expect(start, 'check 5 no longer declares DATA_WAIT_MS — the reading is broken').toBeGreaterThan(
    -1,
  )
  expect(end, 'the script no longer awaits theDataStaysWhereItWas').toBeGreaterThan(start)
  return SOURCE.slice(start, end)
}

const APPDATA = 'C:\\Users\\runneradmin\\AppData\\Roaming'
const FOLDER = win32.join(APPDATA, '@brobot2', 'desktop')
const DATABASE = win32.join(FOLDER, 'brobot2.sqlite')
const EXE = 'D:\\a\\brobot\\apps\\desktop\\dist\\win-unpacked\\BroBot.exe'
const HOSTED = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', APPDATA }

/**
 * Run check 5 once against stand-ins.
 *
 * @param {object} world
 * @param {Record<string, string>} [world.env]
 * @param {string} [world.platform]
 * @param {string[]} [world.before] paths that exist before the launch
 * @param {number | null} [world.databaseAt] ms after the launch the app makes its database, or never
 * @param {number | null} [world.exitsAt] ms after the launch the app ends by itself, or never
 * @param {string[]} [world.makes] paths the app makes as soon as it starts
 */
async function checkFive({
  env = HOSTED,
  platform = 'win32',
  before = [],
  databaseAt = null,
  exitsAt = null,
  makes = [],
} = {}) {
  let clock = 1_000_000
  let launchedAt = null
  const files = new Set(before)
  const lines = { said: [], warned: [], failed: [] }
  const spawned = []
  const killed = []
  const since = () => (launchedAt === null ? -1 : clock - launchedAt)
  const child = {
    pid: 4242,
    get exitCode() {
      return exitsAt !== null && launchedAt !== null && since() >= exitsAt ? 3 : null
    },
    signalCode: null,
  }
  const stand = {
    process: { env, platform },
    Date: { now: () => clock },
    setTimeout: (done, ms) => {
      clock += ms
      done()
    },
    existsSync: (path) =>
      path === DATABASE
        ? databaseAt !== null && launchedAt !== null && since() >= databaseAt
        : files.has(path),
    join: win32.join,
    spawn: (command, args, options) => {
      spawned.push({ command, args, options })
      launchedAt = clock
      for (const path of makes) files.add(path)
      return child
    },
    spawnSync: (command, args) => {
      killed.push([command, ...args])
      return { status: 0 }
    },
    say: (line) => lines.said.push(line),
    warn: (line) => lines.warned.push(line),
    fail: (line) => lines.failed.push(line),
    exe: EXE,
    HIDDEN_LAUNCH_ARG,
  }
  const names = Object.keys(stand)
  const run = new Function(...names, `${checkFiveText()}\nreturn theDataStaysWhereItWas()`)
  await run(...names.map((name) => stand[name]))
  return { ...lines, spawned, killed, waited: launchedAt === null ? 0 : clock - launchedAt }
}

describe('§1 · it launches nothing where a person’s data could be', () => {
  it('⛔ off a GitHub-hosted runner — a self-hosted one, or no CI at all — it says so and starts nothing', async () => {
    for (const env of [
      { APPDATA },
      { GITHUB_ACTIONS: 'true', APPDATA },
      { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'self-hosted', APPDATA },
    ]) {
      const run = await checkFive({ env, databaseAt: 0 })
      expect(run.spawned, JSON.stringify(env)).toEqual([])
      expect(run.said.join('\n')).toContain('not checked here')
      expect(run.failed).toEqual([])
    }
    // ⚑ One fact over: the hosted runner is where it launches.
    expect((await checkFive({ databaseAt: 0 })).spawned).toHaveLength(1)
  })

  it('⛔ off Windows, or with no APPDATA, it starts nothing', async () => {
    expect((await checkFive({ platform: 'darwin', databaseAt: 0 })).spawned).toEqual([])
    expect((await checkFive({ env: { ...HOSTED, APPDATA: '' }, databaseAt: 0 })).spawned).toEqual(
      [],
    )
  })

  it('⛔ a runner that already holds a data folder — the pinned one or one named after the app — is not measured', async () => {
    for (const already of [FOLDER, win32.join(APPDATA, 'BroBot'), win32.join(APPDATA, 'BroBot2')]) {
      const run = await checkFive({ before: [already], databaseAt: 0 })
      expect(run.spawned, already).toEqual([])
      expect(run.warned.join('\n')).toContain('not measured: a data folder was already here')
      expect(run.failed).toEqual([])
    }
  })
})

describe('§2 · what it concludes from the launch', () => {
  it('🔴 the database in <APPDATA>\\@brobot2\\desktop passes — and the app it started, still running, is stopped by its own pid', async () => {
    const run = await checkFive({ databaseAt: 4_000 })
    expect(run.spawned).toEqual([
      { command: EXE, args: [HIDDEN_LAUNCH_ARG], options: { stdio: 'ignore', windowsHide: true } },
    ])
    expect(run.failed).toEqual([])
    expect(run.warned).toEqual([])
    expect(run.said).toContain(`✓ the data folder is where every build kept it: ${FOLDER}`)
    expect(run.killed).toEqual([['taskkill', '/PID', '4242', '/T', '/F']])
    expect(run.waited, 'it stops looking once the database is there').toBe(4_000)
  })

  it('🔴 an app that ran the whole wait and made no database FAILS the build — it is no longer a warning', async () => {
    const run = await checkFive({ databaseAt: null })
    expect(run.failed).toEqual([`the app ran 90 s and made no database in ${FOLDER}`])
    expect(run.said.join('\n')).not.toContain('✓ the data folder')
    expect(run.killed).toEqual([['taskkill', '/PID', '4242', '/T', '/F']])
    expect(run.waited).toBeGreaterThanOrEqual(90_000)
    // ⚑ One fact over: a database a moment before the deadline passes.
    expect((await checkFive({ databaseAt: 89_500 })).failed).toEqual([])
  })

  it('⚑ an app that ended before it made a database is a warning, not a failure — and nothing is killed', async () => {
    const run = await checkFive({ exitsAt: 2_000 })
    expect(run.failed).toEqual([])
    expect(run.warned).toEqual(['not measured: the app ended (exit 3) before it made a database'])
    expect(run.killed, 'its pid may already be another process’s').toEqual([])
    expect(run.waited).toBe(2_000)
  })

  it('⛔ a data folder named after the app fails the build, even beside a database where it belongs', async () => {
    const stray = win32.join(APPDATA, 'BroBot')
    const run = await checkFive({ databaseAt: 1_000, makes: [stray] })
    expect(run.failed).toEqual([`the app made a data folder named after itself: ${stray}`])
    // ⚑ One fact over: the same launch without it passes.
    expect((await checkFive({ databaseAt: 1_000 })).failed).toEqual([])
  })
})
