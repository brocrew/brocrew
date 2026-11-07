import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  execFileSync: run,
}))
import { identity, withSharedLock } from '../src/profiles/sharedLock.js'
// Frozen published e50b9f25 reader; only its privateFolder import path is relocated.
import { identity as oldIdentity, withSharedLock as oldLock } from './fixtures/shared-lock-018.js'
const roots: string[] = []
const nativeBirth = '638980000000000000'

afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

it('keeps native birth identity when cold Windows PowerShell needs more than two seconds', () => {
  vi.stubGlobal('process', Object.create(process, { platform: { value: 'win32' } }))
  run.mockImplementation((_program, _args, options) => {
    if (options.timeout < 30000)
      throw Object.assign(new Error('spawnSync powershell ETIMEDOUT'), { code: 'ETIMEDOUT' })
    return nativeBirth + '\n'
  })

  expect(identity()).toEqual({ pid: process.pid, birth: nativeBirth })
  expect(run).toHaveBeenCalledOnce()
  expect(run.mock.calls[0][0]).toBe('powershell')
  expect(run.mock.calls[0][1]).toEqual([
    '-NoProfile', '-NonInteractive', '-Command',
    `(Get-Process -Id ${process.pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`,
  ])
})

it.each(['old-holds', 'new-holds'])(
  'old and new readers preserve the live contender while %s',
  (direction) => {
    vi.stubGlobal('process', Object.create(process, { platform: { value: 'win32' } }))
    run.mockReturnValue(nativeBirth + '\n')
    const owner = identity()
    expect(owner).toEqual(oldIdentity())
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-birth-coexist-'))
    roots.push(root)
    const hold = direction === 'old-holds' ? oldLock : withSharedLock
    const contend = direction === 'old-holds' ? withSharedLock : oldLock
    hold(root, owner, () => {
      const locks = path.join(root, 'registry.lock')
      const before = fs.readdirSync(locks)
      const work = vi.fn()
      expect(() => contend(root, owner, work, 15)).toThrow('Shared Chrome registry busy; try again.')
      expect(work).not.toHaveBeenCalled()
      expect(fs.readdirSync(locks)).toEqual(before)
    })
    expect(fs.readdirSync(path.join(root, 'registry.lock'))).toEqual([])
  },
)
