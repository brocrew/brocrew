import { expect, it, vi } from 'vitest'
import type { ClientSessionApi } from '../src/shared/client-session-api'
import { createDesktopProviderApi } from '../src/renderer/src/client-provider/desktop'

it('exposes the session capability lazily with its receiver, promise, rejection and disposer intact', async () => {
  const failure = new Error('Fictional session is owned elsewhere')
  const reading = Promise.resolve([])
  const rejected = Promise.reject(failure)
  const off = vi.fn()
  const transport = {
    reading,
    attachOpen() {
      return this.reading
    },
    release: vi.fn(() => rejected),
    onEvent: vi.fn(() => off),
  }
  const sessions = vi.fn(() => transport as unknown as ClientSessionApi)
  const provider = vi.fn((): never => {
    throw new Error('No provider read expected')
  })
  const api = createDesktopProviderApi(
    provider,
    () => undefined,
    () => undefined,
    sessions,
  )
  expect(sessions).not.toHaveBeenCalled()
  expect(api.sessions).toBe(transport)
  expect(api.sessions?.attachOpen()).toBe(reading)
  const pending = api.sessions?.release({ sessionId: 'fern' })
  expect(pending).toBe(rejected)
  await expect(pending).rejects.toBe(failure)
  expect(transport.release).toHaveBeenCalledExactlyOnceWith({ sessionId: 'fern' })
  const listener = vi.fn()
  expect(api.sessions?.onEvent(listener)).toBe(off)
  expect(transport.onEvent).toHaveBeenCalledExactlyOnceWith(listener)
  off()
  expect(off).toHaveBeenCalledTimes(1)
  expect(provider).not.toHaveBeenCalled()
})
