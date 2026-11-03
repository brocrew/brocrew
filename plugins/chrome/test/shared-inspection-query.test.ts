import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

const query = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  execFileSync: query.run,
}))
import { inspectChrome } from '../src/profiles/sharedStore.js'

const folders: string[] = []
afterEach(() => {
  query.run.mockReset()
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true })
})
function home() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-cim-query-'))
  folders.push(folder)
  return folder
}
it('queries Windows process identity with a finite hidden ten-second deadline', () => {
  query.run.mockReturnValue('"ProcessId","CommandLine","Name"\r\n"0",,"System Idle Process"\r\n')
  expect(inspectChrome(home(), { platform: 'win32' })).toBe('ended')
  expect(query.run).toHaveBeenCalledOnce()
  const [program, args, options] = query.run.mock.calls[0]
  expect(program).toBe('powershell')
  expect(args).toEqual([
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    expect.stringContaining('Select-Object ProcessId,CommandLine,Name'),
  ])
  expect(options).toEqual({
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  })
})
it('a failed or timed-out process query never proves Chrome ended', () => {
  query.run.mockImplementation(() => {
    throw Object.assign(new Error('fictional query deadline'), { code: 'ETIMEDOUT' })
  })
  expect(inspectChrome(home(), { platform: 'win32' })).toBe('unknown')
})
