import { afterEach, expect, it, vi } from 'vitest'
import { loadPluginConfiguration } from '../src/renderer/src/lib/plugin-configuration-load'
import {
  PLUGIN_CONFIGURATION_TIMEOUT,
  type PluginSettingsReply,
} from '../src/shared/plugin-settings'

afterEach(() => vi.useRealTimers())
it('waits for a slow page within the full Configure deadline', async () => {
  vi.useFakeTimers()
  let finish!: (reply: PluginSettingsReply) => void
  const open = vi.fn(
    () =>
      new Promise<PluginSettingsReply>((resolve) => {
        finish = resolve
      }),
  )
  const settled = vi.fn()
  const loading = loadPluginConfiguration(open, new AbortController().signal).then(settled)
  await vi.advanceTimersByTimeAsync(PLUGIN_CONFIGURATION_TIMEOUT - 1)
  expect(settled).not.toHaveBeenCalled()
  finish({ ok: true })
  await loading
  expect(settled).toHaveBeenCalledWith({ ok: true })
  expect(vi.getTimerCount()).toBe(0)
})
it('turns a failed page into the plain error without exposing its cause', async () => {
  const result = await loadPluginConfiguration(async () => {
    throw new Error('fictional-private-view-path')
  }, new AbortController().signal)
  expect(result).toEqual({ ok: false, error: 'Plugin unavailable. Try again.' })
})
it('times out a stuck Configure and ignores its late success', async () => {
  vi.useFakeTimers()
  let finish!: (reply: PluginSettingsReply) => void
  const settled = vi.fn()
  const loading = loadPluginConfiguration(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
    new AbortController().signal,
  ).then(settled)
  await vi.advanceTimersByTimeAsync(PLUGIN_CONFIGURATION_TIMEOUT)
  await loading
  expect(settled).toHaveBeenCalledExactlyOnceWith({
    ok: false,
    error: 'Plugin unavailable. Try again.',
  })
  finish({ ok: true })
  await Promise.resolve()
  expect(settled).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})
it('cancels an opening page and removes its deadline', async () => {
  vi.useFakeTimers()
  const abort = new AbortController()
  const open = vi.fn(() => new Promise<PluginSettingsReply>(() => {}))
  const loading = loadPluginConfiguration(open, abort.signal)
  abort.abort()
  expect(await loading).toMatchObject({ ok: false })
  expect(open).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})
