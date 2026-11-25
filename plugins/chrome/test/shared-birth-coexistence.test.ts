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
  vi.restoreAllMocks()
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
      args[0] === String(process.pid) ||
      args[3] ===
        `(Get-Process -Id ${process.pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`
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
      expect(() => contend(root, other, work, 15)).toThrow(
        'Shared Chrome registry busy; try again.',
      )
      expect(work).not.toHaveBeenCalled()
      expect(fs.readdirSync(locks)).toEqual(before)
      if (direction === 'old-holds')
        expect(run).toHaveBeenCalledWith(
          expect.stringMatching(/chrome-process-birth\.exe$/),
          [String(owner.pid)],
          expect.any(Object),
        )
      else
        expect(run).toHaveBeenCalledWith(
          'powershell',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `(Get-Process -Id ${owner.pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`,
          ],
          expect.any(Object),
        )
    })
    expect(fs.readdirSync(path.join(root, 'registry.lock'))).toEqual([])
  },
)

const liveBirth = '638980000000000001'
const reusedBirth = '638980000000000002'
// The test runner's parent stands in for a live contender; only its birth answers are fictional.
function contend(answer: (elapsed: number, call: number) => string) {
  vi.stubGlobal('process', Object.create(process, { platform: { value: 'win32' } }))
  const started = Date.now()
  let calls = 0
  run.mockImplementation((_program, args) =>
    args[0] === String(process.pid)
      ? nativeBirth + '\n'
      : answer(Date.now() - started, calls++) + '\n',
  )
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-birth-coexist-'))
  roots.push(root)
  const other = path.join(
    root,
    'registry.lock',
    `${process.ppid}.${Buffer.from(liveBirth).toString('base64url')}.11111111-1111-4111-8111-111111111111`,
  )
  fs.mkdirSync(other, { recursive: true })
  fs.writeFileSync(path.join(other, 'ticket'), '1')
  return { root, other, owner: identity(), started }
}

it('waits on an identified live contender past two seconds and enters once it is gone', () => {
  const c = contend((elapsed) => (elapsed < 2500 ? liveBirth : reusedBirth))
  expect(withSharedLock(c.root, c.owner, () => 'entered')).toBe('entered')
  expect(Date.now() - c.started).toBeGreaterThanOrEqual(2500)
  expect(fs.existsSync(c.other)).toBe(false)
})

it('keeps a continuously unidentified contender and waits on it only two seconds', () => {
  const c = contend(() => {
    throw new Error('fictional birth read failure')
  })
  const work = vi.fn()
  expect(() => withSharedLock(c.root, c.owner, work)).toThrow(
    'Shared Chrome registry busy; try again.',
  )
  expect(work).not.toHaveBeenCalled()
  expect(fs.existsSync(c.other)).toBe(true)
})

it('clears the unknown wait each time the current process birth is confirmed', () => {
  let now = Date.now()
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  vi.spyOn(Atomics, 'wait').mockImplementation((_view, _index, _value, ms) => {
    now += ms ?? 0
    return 'timed-out'
  })
  const c = contend((elapsed, call) => {
    if (elapsed >= 3000) return reusedBirth
    if (call % 2 === 0) throw new Error('fictional birth read failure')
    return liveBirth
  })
  expect(withSharedLock(c.root, c.owner, () => 'entered')).toBe('entered')
  expect(now - c.started).toBeGreaterThanOrEqual(3000)
  expect(fs.existsSync(c.other)).toBe(false)
})
