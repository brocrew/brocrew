import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

const query = vi.hoisted(() => ({ run: vi.fn(), asyncRun: vi.fn() }))
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  execFileSync: query.run,
  execFile: query.asyncRun,
}))
import { inspectChrome } from '../src/profiles/sharedStore.js'
import { commandOfPid, processList } from '../src/browser/processes.js'

const folders: string[] = []
afterEach(() => {
  query.run.mockReset()
  query.asyncRun.mockReset()
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true })
})
it('waits for a slow asynchronous process listing to complete', async () => {
  vi.useFakeTimers()
  try {
    const completionMs = 10_001
    query.asyncRun.mockImplementation((_file, _args, options, callback) => {
      if (options.timeout && options.timeout < completionMs)
        setTimeout(() => callback(new Error('fictional process listing killed')), options.timeout)
      else setTimeout(() => callback(null, '123 /sbin/init\n'), completionMs)
    })
    const listing = processList('linux')
    await vi.advanceTimersByTimeAsync(completionMs)
    expect(await listing).toBe('123 /sbin/init\n')
  } finally {
    vi.useRealTimers()
  }
})
function home() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-cim-query-'))
  folders.push(folder)
  return folder
}
it('bounds the synchronous hidden Windows query that holds the plugin thread', () => {
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
it('cancels a pending lock-owner command without treating the lock as free', async () => {
  const request = new AbortController()
  query.asyncRun.mockImplementation((_file, _args, options, callback) => {
    options.signal.addEventListener('abort', () => callback(options.signal.reason), { once: true })
  })
  const owner = commandOfPid(123, undefined, request.signal)
  request.abort(new Error('cancelled'))
  await expect(owner).rejects.toThrow('cancelled')
})
