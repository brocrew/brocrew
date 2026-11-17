import { describe, expect, it, vi } from 'vitest'
import { loggingClient, type LoggingState } from '../src/shared/logging'

const state: LoggingState = {
  debug: false,
  path: '/fictional/logs/desktop.log',
  servicePath: null,
}

describe('the logging client over IPC', () => {
  it('reads the state through the get channel without adding arguments', async () => {
    const invoke = vi.fn(async () => state)
    const client = loggingClient(invoke)
    expect(invoke).not.toHaveBeenCalled()
    expect(await client.getLogging()).toBe(state)
    expect(invoke.mock.calls).toEqual([['app:logging:get']])
  })

  it.each([true, false])(
    'passes debug=%s to the setter and returns the saved state',
    async (debug) => {
      const saved: LoggingState = { ...state, debug, servicePath: '/fictional/logs/service.log' }
      const invoke = vi.fn(async () => saved)
      expect(await loggingClient(invoke).setLoggingDebug(debug)).toBe(saved)
      expect(invoke.mock.calls).toEqual([['app:logging:set-debug', debug]])
    },
  )

  it('propagates read and write failures so the caller can report them', async () => {
    const readFailure = new Error('read failed')
    const writeFailure = new Error('write failed')
    const invoke = vi.fn().mockRejectedValueOnce(readFailure).mockRejectedValueOnce(writeFailure)
    const client = loggingClient(invoke)
    await expect(client.getLogging()).rejects.toBe(readFailure)
    await expect(client.setLoggingDebug(true)).rejects.toBe(writeFailure)
    expect(invoke.mock.calls).toEqual([['app:logging:get'], ['app:logging:set-debug', true]])
  })

  it('keeps each window client bound to its own transport', async () => {
    const otherState: LoggingState = { ...state, path: '/fictional/other.log' }
    const firstInvoke = vi.fn(async () => state)
    const otherInvoke = vi.fn(async () => otherState)
    const first = loggingClient(firstInvoke)
    const other = loggingClient(otherInvoke)
    expect(await first.getLogging()).toBe(state)
    expect(await other.setLoggingDebug(false)).toBe(otherState)
    expect(firstInvoke.mock.calls).toEqual([['app:logging:get']])
    expect(otherInvoke.mock.calls).toEqual([['app:logging:set-debug', false]])
  })
})
