import fs from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  execFileSync: run,
}))
import { birthOf, identity, ownerState } from '../src/profiles/sharedLock.js'
import { birthOf as oldBirth } from './fixtures/shared-lock-018.js'

const ticks = '638980000000000001'
const platform = (value: string) =>
  vi.stubGlobal('process', Object.create(process, { platform: { value } }))

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

it('queries the supplied Windows PID using the packaged native reader and exact ticks', () => {
  platform('win32')
  run.mockReturnValue(ticks + '\n')
  expect(identity()).toEqual({ pid: process.pid, birth: ticks })
  expect(run).toHaveBeenCalledOnce()
  const [program, args, options] = run.mock.calls[0]
  expect(program).toMatch(/[/\\]bin[/\\]chrome-process-birth\.exe$/)
  expect(args).toEqual([String(process.pid)])
  expect(options.windowsHide).toBe(true)
  expect(options.timeout).toBeUndefined()
})

it('queries a distinct foreign PID rather than substituting our own identity', () => {
  platform('win32')
  const other = process.pid + 321
  const otherTicks = '638980000000000099'
  run.mockImplementation((_program, args) =>
    args[0] === String(other) ? otherTicks + '\n' : ticks + '\n',
  )
  expect(birthOf(other)).toBe(otherTicks)
  expect(run).toHaveBeenCalledWith(
    expect.stringMatching(/chrome-process-birth\.exe$/),
    [String(other)],
    expect.any(Object),
  )
  expect(identity().birth).toBe(ticks)
})

it('retains the concrete native failure for self without granting foreign ownership', () => {
  platform('win32')
  run.mockImplementation(() => {
    throw Object.assign(new Error('spawnSync chrome-process-birth.exe ENOENT'), { code: 'ENOENT' })
  })
  expect(identity).toThrow('ENOENT')
  expect(birthOf(process.pid)).toBeUndefined()
  expect(ownerState({ pid: process.pid, birth: ticks })).toBe('unknown')
})

it('shows the native OS diagnostic instead of only the child exit status', () => {
  platform('win32')
  run.mockImplementation(() => {
    throw Object.assign(new Error('Command failed'), {
      stderr: Buffer.from('OpenProcess: Access is denied.\n'),
    })
  })
  expect(identity).toThrow('OpenProcess: Access is denied.')
  expect(ownerState({ pid: process.pid, birth: ticks })).toBe('unknown')
})

it.each(['The parameter is incorrect.', 'Access is denied.'])(
  'captures a failed birth query after the liveness check and retains %s for self',
  async (detail) => {
    platform('win32')
    const native = await vi.importActual<typeof import('node:child_process')>('node:child_process')
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const alive = vi.spyOn(process, 'kill').mockReturnValue(true)
    const other = process.pid + 321
    run.mockImplementation((_program, args, options) =>
      native.execFileSync(
        process.execPath,
        [
          '-e',
          `process.stderr.write(${JSON.stringify(`OpenProcess(${args[0]}): ${detail}\n`)}); process.exit(1)`,
        ],
        options,
      ),
    )

    expect(ownerState({ pid: other, birth: ticks })).toBe('unknown')
    expect(alive).toHaveBeenCalledWith(other, 0)
    expect(run.mock.calls[0][1]).toEqual([String(other)])
    expect(identity).toThrow(
      `Cannot read Windows process birth: OpenProcess(${process.pid}): ${detail}`,
    )
    expect(write).not.toHaveBeenCalled()
    const failure = run.mock.results[1].value
    expect(failure.status).toBe(1)
    expect(failure.stderr).toBe(`OpenProcess(${process.pid}): ${detail}\n`)
  },
)

it.each(['', 'unknown\n', '638980000000000001\n638980000000000002\n', '3155378976000000000\n'])(
  'refuses invalid native output %j before self enrollment',
  (output) => {
    platform('win32')
    run.mockReturnValue(output)
    expect(identity).toThrow(/birth/i)
    expect(ownerState({ pid: process.pid, birth: ticks })).toBe('unknown')
  },
)

it('keeps the macOS command, canonical environment and bound identical to 0.1.8', () => {
  platform('darwin')
  run.mockReturnValue('Fri Nov  6 12:34:56 2026\n')
  const old = oldBirth(process.pid)
  const oldCall = run.mock.calls[0]
  run.mockClear()
  expect(birthOf(process.pid)).toBe(old)
  expect(run.mock.calls[0]).toEqual(oldCall)
})

it('keeps Linux proc start ticks identical to 0.1.8 without invoking a process', () => {
  platform('linux')
  const fields = Array.from({ length: 20 }, (_, i) => (i === 19 ? '1234567890123' : '0'))
  vi.spyOn(fs, 'readFileSync').mockReturnValue('42 (name with ) parenthesis) ' + fields.join(' '))
  expect(birthOf(42)).toBe(oldBirth(42))
  expect(birthOf(42)).toBe('1234567890123')
  expect(run).not.toHaveBeenCalled()
})
