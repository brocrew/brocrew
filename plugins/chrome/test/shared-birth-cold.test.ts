import { afterEach, expect, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  execFileSync: run,
}))
import { identity } from '../src/profiles/sharedLock.js'

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

it('enrolls a cold Windows plugin without starting PowerShell', () => {
  vi.stubGlobal('process', Object.create(process, { platform: { value: 'win32' } }))
  run.mockImplementation(() => {
    throw Object.assign(new Error('spawnSync powershell ETIMEDOUT'), {
      code: 'ETIMEDOUT',
      signal: 'SIGTERM',
    })
  })

  let owner: ReturnType<typeof identity> | undefined
  expect(() => { owner = identity() }).not.toThrow()
  expect(owner?.pid).toBe(process.pid)
  expect(owner?.birth).toBeTruthy()
  expect(run).not.toHaveBeenCalled()
})
