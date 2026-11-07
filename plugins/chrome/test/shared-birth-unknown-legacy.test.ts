import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  execFileSync: run,
}))
// This commit retains the exact published 0.1.8 implementation, not a proposed new reader.
import { identity, ownerState, withSharedLock } from './fixtures/shared-lock-018.js'
const roots: string[] = []

afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function legacyWindows() {
  vi.stubGlobal('process', Object.create(process, { platform: { value: 'win32' } }))
  run.mockReturnValue('638980000000000000\n')
}

it.each([undefined, null, '', 'unknown', 'node:1794080000000.123', '0'])(
  'the published reader treats non-native birth %s as gone despite a live PID',
  (birth) => {
    legacyWindows()
    expect(() => process.kill(process.pid, 0)).not.toThrow()
    expect(ownerState({ pid: process.pid, birth: birth as string })).toBe('gone')
  },
)

it('the published bakery deletes a live contender carrying an unknown marker', () => {
  legacyWindows()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-legacy-birth-'))
  roots.push(root)
  const locks = path.join(root, 'registry.lock')
  const live = path.join(locks, `${process.pid}.${Buffer.from('unknown').toString('base64url')}.00000000-0000-4000-8000-000000000001`)
  fs.mkdirSync(live, { recursive: true })
  fs.writeFileSync(path.join(live, 'ticket'), '1')

  const work = vi.fn()
  withSharedLock(root, { pid: process.pid + 1, birth: '638980000000000000' }, work)

  expect(work).toHaveBeenCalledOnce()
  expect(fs.existsSync(live)).toBe(false)
  expect(() => process.kill(process.pid, 0)).not.toThrow()
})

it('empty birth refuses the old bakery but does not make a persisted lease unknown', () => {
  legacyWindows()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-empty-birth-'))
  roots.push(root)
  const live = path.join(root, 'registry.lock', `${process.pid}..00000000-0000-4000-8000-000000000001`)
  fs.mkdirSync(live, { recursive: true })
  fs.writeFileSync(path.join(live, 'ticket'), '1')
  const work = vi.fn()

  expect(() => withSharedLock(root, { pid: process.pid + 1, birth: '638980000000000000' }, work)).toThrow('Shared Chrome registry lock needs attention.')
  expect(work).not.toHaveBeenCalled()
  expect(fs.existsSync(live)).toBe(true)
  expect(ownerState({ pid: process.pid, birth: '' })).toBe('gone')
})

it('an owner not enrolled yet provides no exclusion to the old reader', () => {
  legacyWindows()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-pending-birth-'))
  roots.push(root)
  const mutation = vi.fn()
  withSharedLock(root, { pid: process.pid, birth: '638980000000000000' }, mutation)
  expect(mutation).toHaveBeenCalledOnce()
  expect(ownerState({ pid: process.pid } as { pid: number; birth: string })).toBe('gone')
})

it('the published startup identity throws when the native query times out', () => {
  legacyWindows()
  run.mockImplementation(() => { throw Object.assign(new Error('powershell ETIMEDOUT'), { code: 'ETIMEDOUT' }) })
  expect(identity).toThrow('Cannot confirm plugin process identity; try again.')
})
