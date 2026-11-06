import { execFile } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { windowsAccessLists } from '../src/main/recovery/windows-privacy'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))

afterEach(() => vi.resetAllMocks())

function reply(error: Error | null, stdout = '', stderr = '') {
  vi.mocked(execFile).mockImplementationOnce((...args: unknown[]) => {
    const done = args.at(-1) as (error: Error | null, stdout: string, stderr: string) => void
    done(error, stdout, stderr)
    return {} as ReturnType<typeof execFile>
  })
}

const timeout = () =>
  Object.assign(new Error('Command failed: owner read timed out'), {
    code: null,
    signal: 'SIGTERM',
    killed: true,
  })

it.each([
  { code: 1, signal: null, killed: false, stderr: 'fictional ACL read refused' },
  { code: null, signal: 'SIGTERM', killed: false, stderr: '' },
  { code: null, signal: 'SIGKILL', killed: true, stderr: '' },
  { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', signal: 'SIGTERM', killed: true, stderr: '' },
])('owner reads surface subprocess status and stderr (%j)', async (failure) => {
  const error = Object.assign(new Error('Command failed: fictional owner read'), failure)
  reply(error, '', failure.stderr)
  await expect(windowsAccessLists.ownerSid('C:\\fictional\\plugins')).rejects.toBe(error)
  expect(error.message).toContain(`exit=${failure.code ?? 'unknown'}`)
  expect(error.message).toContain(`signal=${failure.signal ?? 'none'}`)
  expect(error.message).toContain(`killed=${failure.killed}`)
  expect(error.message).toContain(failure.stderr || 'Command failed: fictional owner read')
  expect(execFile).toHaveBeenCalledTimes(1)
  const command = vi.mocked(execFile).mock.calls.at(-1)![1] as string[]
  expect(command.at(-1)).toContain('[IO.Directory]::GetAccessControl($path)')
})

it('retries a timed-out owner read once with the same command and 15s bound', async () => {
  reply(timeout())
  reply(null, 'S-1-5-32-545\r\n')
  await expect(windowsAccessLists.ownerSid('C:\\fictional\\plugins')).resolves.toBe('S-1-5-32-545')
  const calls = vi.mocked(execFile).mock.calls
  expect(calls).toHaveLength(2)
  expect(calls[0]!.slice(0, 3)).toEqual(calls[1]!.slice(0, 3))
  expect(calls[0]![2]).toEqual({ timeout: 15_000, windowsHide: true, encoding: 'utf8' })
})

it('fails with the final diagnostic when both bounded owner reads time out', async () => {
  reply(timeout())
  const exhausted = timeout()
  reply(exhausted)
  await expect(windowsAccessLists.ownerSid('C:\\fictional\\plugins')).rejects.toBe(exhausted)
  expect(exhausted.message).toContain('exit=unknown signal=SIGTERM killed=true')
  expect(execFile).toHaveBeenCalledTimes(2)
})

it('surfaces an ACL denial on the retry without making a third attempt', async () => {
  reply(timeout())
  const denied = Object.assign(new Error('owner ACL denied'), {
    code: 1,
    signal: null,
    killed: false,
  })
  reply(denied, '', 'access denied')
  await expect(windowsAccessLists.ownerSid('C:\\fictional\\plugins')).rejects.toBe(denied)
  expect(denied.message).toContain('access denied')
  expect(execFile).toHaveBeenCalledTimes(2)
})

it('does not retry a malformed owner SID', async () => {
  reply(null, 'not a SID')
  await expect(windowsAccessLists.ownerSid('C:\\fictional\\plugins')).rejects.toThrow(
    'unreadable folder owner',
  )
  expect(execFile).toHaveBeenCalledTimes(1)
})

it('never retries a timed-out ACL mutation', async () => {
  const error = timeout()
  reply(error)
  await expect(
    windowsAccessLists.restrict('C:\\fictional\\plugins', 'S-1-5-21-1', []),
  ).rejects.toBe(error)
  expect(execFile).toHaveBeenCalledTimes(1)
})
