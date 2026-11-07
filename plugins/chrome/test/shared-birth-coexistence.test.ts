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

it.each(['old-holds', 'new-holds'])(
  'old and new readers preserve the live contender while %s',
  (direction) => {
    vi.stubGlobal('process', Object.create(process, { platform: { value: 'win32' } }))
    const contenderBirth = '638980000000000001'
    run.mockImplementation((_program, args) =>
      args[0] === String(process.pid) || args[3] === `(Get-Process -Id ${process.pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`
        ? nativeBirth + '\n'
        : contenderBirth + '\n',
    )
    const owner = identity()
    expect(owner).toEqual(oldIdentity())
    const other = { pid: process.pid + 1, birth: contenderBirth }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-birth-coexist-'))
    roots.push(root)
    const hold = direction === 'old-holds' ? oldLock : withSharedLock
    const contend = direction === 'old-holds' ? withSharedLock : oldLock
    hold(root, owner, () => {
      const locks = path.join(root, 'registry.lock')
      const before = fs.readdirSync(locks)
      const work = vi.fn()
      run.mockClear()
      expect(() => contend(root, other, work, 15)).toThrow('Shared Chrome registry busy; try again.')
      expect(work).not.toHaveBeenCalled()
      expect(fs.readdirSync(locks)).toEqual(before)
      if (direction === 'old-holds')
        expect(run).toHaveBeenCalledWith(expect.stringMatching(/chrome-process-birth\.exe$/), [String(owner.pid)], expect.any(Object))
      else
        expect(run).toHaveBeenCalledWith('powershell', [
          '-NoProfile', '-NonInteractive', '-Command',
          `(Get-Process -Id ${owner.pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`,
        ], expect.any(Object))
    })
    expect(fs.readdirSync(path.join(root, 'registry.lock'))).toEqual([])
  },
)
