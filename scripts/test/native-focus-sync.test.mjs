// Exercise the actual isolated harness sync function without importing or running its GUI entrypoint.
import fs from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
const source = fs.readFileSync(new URL('../native/focus-check.ts', import.meta.url), 'utf8')
const start = source.indexOf('  async function syncClock()')
const end = source.indexOf('  await syncClock()', start)
const javascript = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText
const createSync = new Function(
  'performance',
  'randomUUID',
  'bounded',
  'syncs',
  'watcher',
  'calibrations',
  'console',
  'assertRunning',
  javascript + '\nreturn syncClock',
)
async function scenario(stop, succeeds = false) {
  const calibrations = [],
    syncs = new Map()
  let dispatched = 0,
    active = false
  const terminal = new Error(stop ?? 'ordinary calibration unavailable')
  const sync = createSync(
    { now: () => 10 },
    () => 'fictional-token',
    async () => {
      active = !!stop
      if (!succeeds) throw terminal
    },
    syncs,
    { stdin: { write() {} } },
    calibrations,
    { warn() {} },
    () => {
      if (active) throw terminal
    },
  )
  let error
  try {
    await sync()
    dispatched++
  } catch (caught) {
    error = caught
  }
  return { error, dispatched, calibrations, pending: syncs.size, terminal }
}
const guardStart = source.indexOf('function assertRunning(): void {')
const guardEnd = source.indexOf('async function bounded<', guardStart)
const guardJavascript = ts.transpileModule(source.slice(guardStart, guardEnd), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText
const createGuard = new Function(
  'locked',
  'stopping',
  'performance',
  'runStartedAt',
  guardJavascript + '\nreturn assertRunning',
)
describe('native sync diagnostics preserve terminal controls', () => {
  it.each([
    [true, false, 10, 'screen locked'],
    [false, true, 10, 'cancelled'],
    [false, false, 75000, 'budget'],
  ])(
    'the actual guard propagates locked=%s stopping=%s elapsed=%s',
    (locked, stopping, elapsed, reason) => {
      expect(createGuard(locked, stopping, { now: () => elapsed }, 0)).toThrow(reason)
    },
  )
  it('the actual guard permits live work below the unchanged run deadline', () => {
    expect(createGuard(false, false, { now: () => 74999 }, 0)).not.toThrow()
  })
  it.each(['lock', 'budget', 'cancel'])('prevents caller dispatch after %s', async (stop) => {
    const result = await scenario(stop)
    expect(result.error).toBe(result.terminal)
    expect(result.dispatched).toBe(0)
    expect(result.pending).toBe(0)
  })
  it('does not swallow terminal control after a successful sync response', async () => {
    const result = await scenario('lock', true)
    expect(result.error).toBe(result.terminal)
    expect(result.dispatched).toBe(0)
    expect(result.pending).toBe(0)
  })
  it('keeps ordinary synchronization errors diagnostic and clears the token', async () => {
    const result = await scenario(undefined)
    expect(result.error).toBeUndefined()
    expect(result.dispatched).toBe(1)
    expect(result.calibrations).toHaveLength(1)
    expect(result.pending).toBe(0)
  })
})
