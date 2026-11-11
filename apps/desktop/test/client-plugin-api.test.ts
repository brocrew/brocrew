import { expect, it, vi } from 'vitest'
import type { PluginsClient, PluginSettingsReply } from '../src/shared/plugin-settings'
import { createDesktopProviderApi } from '../src/renderer/src/client-provider/desktop'

it('exposes plugin requests lazily with their receiver, promise, native error and disposers intact', async () => {
  const failure = new Error('Fictional plugin host is busy')
  const pending = Promise.reject<PluginSettingsReply>(failure)
  const stop = vi.fn()
  const listener = vi.fn()
  const transport: PluginsClient & { pending: typeof pending } = {
    pending,
    request() {
      return this.pending
    },
    onClosed: vi.fn(() => stop),
    onReviewInvalidated: vi.fn(() => stop),
    onReviewProgress: vi.fn(() => stop),
  }
  const plugins = vi.fn(() => transport)
  const provider = vi.fn((): never => {
    throw new Error('No provider read expected')
  })
  const api = createDesktopProviderApi(
    provider,
    () => undefined,
    () => undefined,
    () => undefined,
    () => undefined,
    plugins,
  )
  expect(plugins).not.toHaveBeenCalled()
  expect(api.plugins).toBe(transport)
  const answer = api.plugins?.request({ kind: 'list' })
  expect(answer).toBe(pending)
  await expect(answer).rejects.toBe(failure)
  expect(api.plugins?.onClosed(listener)).toBe(stop)
  expect(api.plugins?.onReviewInvalidated?.(listener)).toBe(stop)
  expect(api.plugins?.onReviewProgress?.(listener)).toBe(stop)
  stop()
  expect(stop).toHaveBeenCalledOnce()
  expect(provider).not.toHaveBeenCalled()
})

it('keeps an absent plugin capability absent without resolving another transport', () => {
  const plugins = vi.fn(() => undefined)
  const api = createDesktopProviderApi(
    (): never => {
      throw new Error('No provider read expected')
    },
    () => undefined,
    () => undefined,
    () => undefined,
    () => undefined,
    plugins,
  )
  expect(plugins).not.toHaveBeenCalled()
  expect(api.plugins).toBeUndefined()
  expect(plugins).toHaveBeenCalledOnce()
})
