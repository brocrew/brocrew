import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { expect, it, vi } from 'vitest'
import { ownClaudeProcessGroup } from '../src/claude/process-group'

it('keeps an unsignalable group unknown and observes its later proven exit', async () => {
  vi.useFakeTimers()
  let gone = false
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const kill = vi.spyOn(process, 'kill').mockImplementation((pid) => {
    expect(pid).toBe(-490001)
    throw Object.assign(new Error(gone ? 'group gone' : 'permission denied'), {
      code: gone ? 'ESRCH' : 'EPERM',
    })
  })
  const child = Object.assign(new EventEmitter(), { pid: 490001 })
  const group = ownClaudeProcessGroup(child as unknown as ChildProcess)
  group.identify('fictional-provider-session')
  let quiet = false
  void group.quiesced.then(() => {
    quiet = true
  })
  try {
    child.emit('exit', 0, null)
    await vi.advanceTimersByTimeAsync(3000)
    expect(quiet).toBe(false)
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]?.[1]).toMatchObject({
      pgid: 490001,
      providerSessionId: 'fictional-provider-session',
      errno: 'EPERM',
    })
    gone = true
    await vi.advanceTimersByTimeAsync(1000)
    await group.quiesced
    expect(quiet).toBe(true)
  } finally {
    gone = true
    await vi.advanceTimersByTimeAsync(1000)
    kill.mockRestore()
    warn.mockRestore()
    vi.useRealTimers()
  }
})
