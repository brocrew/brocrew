import { expect, it, vi } from 'vitest'
import type { ExportedSession } from '../src/shared/runtime-ipc'
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

it('keeps the original export promise and receiver for native and bundle payloads', async () => {
  const answer: ExportedSession = {
    kind: 'bundle',
    path: '/fictional/copy',
    frames: 1,
    ledgerEntries: 2,
    resumable: false,
    note: 'Supplied copy meaning.',
  }
  const pending = Promise.resolve(answer)
  const transport = {
    exportSession: vi.fn<ClientSessionApi['exportSession']>(function (this: unknown) {
      expect(this).toBe(transport)
      return pending
    }),
  }
  const api = createDesktopProviderApi(
    (): never => {
      throw new Error('No provider read expected')
    },
    () => undefined,
    () => undefined,
    () => transport as unknown as ClientSessionApi,
  )
  for (const exportKind of ['native', 'bundle'] as const) {
    const input = { sessionId: 'fern', exportKind }
    expect(api.sessions?.exportSession(input)).toBe(pending)
    await expect(pending).resolves.toBe(answer)
    expect(transport.exportSession).toHaveBeenLastCalledWith(input)
  }
  const failure = new Error('Supplied export refusal')
  const rejected = Promise.reject<ExportedSession>(failure)
  transport.exportSession.mockReturnValueOnce(rejected)
  expect(api.sessions?.exportSession({ sessionId: 'fern', exportKind: 'bundle' })).toBe(rejected)
  await expect(rejected).rejects.toBe(failure)
})
