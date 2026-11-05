import { execFile } from 'node:child_process'
import { expect, it, vi } from 'vitest'
import { windowsAccessLists } from '../src/main/recovery/windows-privacy'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))

it.each([
  { code: 1, signal: null, killed: false, stderr: 'fictional ACL read refused' },
  { code: null, signal: 'SIGTERM', killed: true, stderr: '' },
])('owner reads surface subprocess status and stderr (%j)', async (failure) => {
  const error = Object.assign(new Error('Command failed: fictional owner read'), failure)
  vi.mocked(execFile).mockImplementationOnce((...args: unknown[]) => {
    const done = args.at(-1) as (error: Error, stdout: string, stderr: string) => void
    done(error, '', failure.stderr)
    return {} as ReturnType<typeof execFile>
  })
  await expect(windowsAccessLists.ownerSid('C:\\fictional\\plugins')).rejects.toBe(error)
  expect(error.message).toContain(`exit=${failure.code ?? 'unknown'}`)
  expect(error.message).toContain(`signal=${failure.signal ?? 'none'}`)
  expect(error.message).toContain(`killed=${failure.killed}`)
  expect(error.message).toContain(failure.stderr || 'Command failed: fictional owner read')
  const command = vi.mocked(execFile).mock.calls.at(-1)![1] as string[]
  expect(command.at(-1)).toContain('[IO.Directory]::GetAccessControl($path)')
})
