import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import {
  appLogFile,
  debugIsOn,
  logDebug,
  logError,
  logInfo,
  openLog,
  readDebugChoice,
  saveDebugChoice,
  setDebug,
} from '../src/main/logging/log'
import { buildPluginSupervisor } from '../../../scripts/build-plugin-supervisor.mjs'
import { wrapUnknown } from '@brobot2/runtime'

const folders: string[] = []
const folder = async () => {
  const made = await mkdtemp(join(tmpdir(), 'brocrew-log-'))
  folders.push(made)
  return made
}
afterEach(async () => {
  await Promise.all(folders.splice(0).map((one) => rm(one, { recursive: true, force: true })))
})
const text = (file: string) => readFile(file, 'utf8').catch(() => '')

const loggerSource = fileURLToPath(new URL('../src/main/logging/log.ts', import.meta.url))

it.each([false, true])('logs unknown events from either provider with Debug mode %s', async (debug) => {
  const file = appLogFile(await folder())
  openLog(file, { debug, console: false })
  for (const provider of ['claude', 'codex']) {
    wrapUnknown(
      provider,
      { detail: `${provider} fictional unknown payload` },
      'unrecognized',
      'future_event',
    )
  }
  await vi.waitFor(async () => {
    const written = await text(file)
    expect(written).toContain('claude fictional unknown payload')
    expect(written).toContain('codex fictional unknown payload')
  })
})
const run = (script: string, ...args: string[]) =>
  spawnSync(process.execPath, ['--experimental-strip-types', '-e', script, loggerSource, ...args], {
    encoding: 'utf8',
    timeout: 5000,
  })

it.each([true, false])(
  'copies console warnings/errors to the file without changing console output (transport %s)',
  async (enabled) => {
    const file = appLogFile(await folder())
    const child = run(
      `
    const events = ['uncaughtException', 'unhandledRejection', 'uncaughtExceptionMonitor']
    const counts = () => events.map(event => process.listenerCount(event))
    const before = counts()
    const logger = require(process.argv[1])
    console.warn('fictional before file')
    const options = { console: process.argv[3] === 'true' }
    logger.openLog(process.argv[2], options)
    logger.openLog(process.argv[2], options)
    console.warn('fictional warning %s', 'value')
    console.error('fictional error')
    logger.logWarn('test', 'fictional structured warning')
    process.stdout.write(JSON.stringify({ before, after: counts() }))
  `,
      file,
      String(enabled),
    )
    expect(child.status, child.stderr).toBe(0)
    const counts = JSON.parse(child.stdout)
    expect(counts.after).toEqual([counts.before[0], counts.before[1], counts.before[2] + 1])
    expect(child.stderr.match(/fictional before file/g)).toHaveLength(1)
    expect(child.stderr.match(/fictional warning value/g)).toHaveLength(1)
    expect(child.stderr.match(/fictional error/g)).toHaveLength(1)
    expect(child.stderr.includes('fictional structured warning')).toBe(enabled)
    const written = await text(file)
    expect(written).not.toContain('fictional before file')
    expect(written.match(/fictional warning/g)).toHaveLength(1)
    expect(written.match(/fictional error/g)).toHaveLength(1)
    expect(written.match(/fictional structured warning/g)).toHaveLength(1)
  },
)

it.each(['throw', 'reject', 'existing handler', 'existing rejection handler'] as const)(
  'observes an uncaught %s without changing its handling',
  async (mode) => {
    const file = appLogFile(await folder())
    const rejection = mode === 'reject' || mode === 'existing rejection handler'
    const action = rejection
      ? "Promise.reject(new Error('fictional rejection'))"
      : "setImmediate(() => { throw new Error('fictional uncaught') })"
    const handler = mode.startsWith('existing')
      ? `process.on('${rejection ? 'unhandledRejection' : 'uncaughtException'}', error => {
        console.error(error.message)
        process.exitCode = 23
        process.stdout.write('handled')
      })`
      : ''
    const baseline = run(`${handler}; ${action}`)
    const child = run(
      `
    ${handler}
    const logger = require(process.argv[1])
    logger.openLog(process.argv[2], { sync: !process.argv[3].startsWith('existing'), console: false })
    ${action}
  `,
      file,
      mode,
    )
    expect(child.status).toBe(baseline.status)
    expect(child.stdout).toBe(baseline.stdout)
    const written = await text(file)
    expect(written).toContain(rejection ? 'fictional rejection' : 'fictional uncaught')
    expect(written).toContain(
      mode === 'existing rejection handler'
        ? '(console)'
        : rejection
          ? '(unhandledRejection)'
          : '(uncaughtException)',
    )
    expect(written.match(/\[error\]/g)).toHaveLength(mode === 'existing handler' ? 2 : 1)
  },
)

it('keeps console output when the file cannot be opened, without recursive reporting', async () => {
  const parent = join(await folder(), 'ordinary-file')
  await writeFile(parent, 'fictional file')
  const child = run(
    `
    const logger = require(process.argv[1])
    logger.openLog(process.argv[2], { sync: true })
    console.error('fictional write failure')
  `,
    join(parent, 'brocrew.log'),
  )
  expect(child.status, child.stderr).toBe(0)
  expect(child.stderr.match(/fictional write failure/g)).toHaveLength(1)
  expect(child.stderr).not.toContain('Maximum call stack')
})

it('writes nothing, and makes no file, until a process opens its log', async () => {
  const root = await folder()
  const child = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '-e',
      "require(process.argv[1]).logError('test', 'before any file is chosen')",
      loggerSource,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        HOME: root,
        USERPROFILE: root,
        APPDATA: root,
        LOCALAPPDATA: root,
        XDG_CONFIG_HOME: root,
        XDG_STATE_HOME: root,
      },
      encoding: 'utf8',
      timeout: 5000,
    },
  )
  expect(child.status, child.stderr).toBe(0)
  expect(await readdir(root, { recursive: true })).toEqual([])
})

it('always keeps errors and info, keeps debug detail only in Debug mode, and shows the line plainly', async () => {
  const file = appLogFile(await folder())
  openLog(file, { console: false })
  expect(debugIsOn()).toBe(false)
  logDebug('test', 'detail while off')
  logInfo('test', 'an info line', { call: 7 })
  logError('test', 'an error line', { error: 'it broke' })
  await vi.waitFor(async () => expect(await text(file)).toContain('it broke'))
  let written = await text(file)
  expect(written).toContain('an info line')
  expect(written).toContain('call: 7')
  expect(written).toMatch(/\[error\] \(test\) an error line/)
  expect(written).not.toContain('detail while off')
  setDebug(true)
  expect(debugIsOn()).toBe(true)
  logDebug('test', 'detail while on')
  await vi.waitFor(async () => expect(await text(file)).toContain('detail while on'))
  written = await text(file)
  expect(written).toContain('detail while on')
})

it('rotates a full file to one older copy, so the two never pass twice the cap', async () => {
  const root = await folder()
  const file = join(root, 'logs', 'brocrew.log')
  openLog(file, { console: false, maxBytes: 2000 })
  // Rotation is checked as lines land, so write them in waves rather than one burst.
  for (let wave = 0; wave < 12; wave++) {
    for (let index = 0; index < 10; index++)
      logInfo('fill', `line ${wave * 10 + index} ${'x'.repeat(60)}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  await vi.waitFor(async () => expect(await text(file)).toContain('line 119'))
  const names = (await readdir(join(root, 'logs'))).sort()
  expect(names).toEqual(['brocrew.log', 'brocrew.old.log'])
  for (const name of names) expect((await stat(join(root, 'logs', name))).size).toBeLessThan(2400)
})

it('keeps the Debug mode choice in the data folder, and reads a missing or broken one as off', async () => {
  const root = await folder()
  expect(await readDebugChoice(root)).toBe(false)
  await saveDebugChoice(root, true)
  expect(await readDebugChoice(root)).toBe(true)
  await saveDebugChoice(root, false)
  expect(await readDebugChoice(root)).toBe(false)
  await rm(join(root, 'logging.json'))
  expect(await readDebugChoice(root)).toBe(false)
})

it('the standalone plugin service, with the logger bundled in, loads with Node alone', async () => {
  const out = join(await folder(), 'standalone.cjs')
  await buildPluginSupervisor(out)
  const loaded = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(out)})`], {
    encoding: 'utf8',
  })
  expect(loaded.status, loaded.stderr).toBe(0)
}, 60_000)
