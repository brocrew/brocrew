import { describe, expect, it, vi } from 'vitest'
import { startRecordedMessage } from '../src/main/runtime/start-recorded-message'

describe('a recorded Message whose delivery facts cannot be read', () => {
  it('reports unknown after the flush fails without reading or guessing sender attribution', async () => {
    const fault = new Error('fictional flush failure after recording')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const start = vi.fn().mockResolvedValue(undefined)
    const state = vi.fn(() => ({ kind: 'started' as const }))
    const failedStart = vi.fn(() => ({
      kind: 'cannot-run' as const,
      cause: { code: 'could-not-start' as const, reason: 'could not start' },
    }))
    const noteSending = vi.fn()
    try {
      const result = await startRecordedMessage(
        { id: 'kept-message', to: 'worker', noteSending },
        {
          start,
          waitForFlush: () => Promise.reject(fault),
          state,
          failedStart,
        },
      )
      expect(result).toEqual({
        id: 'kept-message',
        to: 'worker',
        state: { kind: 'delivery-unknown' },
      })
      expect(start).toHaveBeenCalledTimes(1)
      expect(state).not.toHaveBeenCalled()
      expect(failedStart).not.toHaveBeenCalled()
      expect(noteSending).not.toHaveBeenCalled()
      expect(warning.mock.calls.flat().join(' ')).toContain(fault.message)
    } finally {
      warning.mockRestore()
    }
  })
})
