import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import PluginsSection from '../../src/renderer/src/components/PluginsSection.vue'
import {
  PLUGIN_CONFIGURATION_TIMEOUT,
  type PluginSettingsReply,
} from '../../src/shared/plugin-settings'
import { fictionalPlugins } from '../../look/fixtures/plugins'
import { mount, unmountAll } from './harness'

afterEach(() => {
  unmountAll()
  vi.useRealTimers()
})
function slowPage() {
  const f = fictionalPlugins()
  f.set([{ id: 'fictional-fir', name: 'Fictional Fir', installed: true, state: 'Running' }])
  const original = f.client.request
  const openings: { id: string; finish(reply: PluginSettingsReply): void }[] = []
  f.client.request = async (input) => {
    if (input.kind === 'configure') {
      await original(input)
      return new Promise((resolve) => {
        openings.push({ id: input.screenId, finish: resolve })
      })
    }
    return original(input)
  }
  return { ...f, openings }
}
it('shows Loading while any plugin page starts, then removes it when the page is ready', async () => {
  const f = slowPage()
  const m = mount(PluginsSection, { client: f.client }, { width: 1180, height: 900 })
  await vi.waitFor(() => expect(m.all('plugin-configure')).toHaveLength(1))
  m.q('plugin-configure').click()
  await vi.waitFor(() => expect(f.openings).toHaveLength(1))
  expect(m.q('plugin-loading').textContent?.trim()).toBe('Loading…')
  expect(m.q('plugin-stage').getAttribute('aria-busy')).toBe('true')
  f.openings[0]!.finish({ ok: true })
  await vi.waitFor(() => expect(m.all('plugin-loading')).toHaveLength(0))
  expect(m.q('plugin-stage').getAttribute('aria-busy')).toBe('false')
})
it('keeps the page visible with a plain failure and Try again, then retries with a fresh screen', async () => {
  const f = slowPage()
  const m = mount(PluginsSection, { client: f.client }, { width: 1180, height: 900 })
  await vi.waitFor(() => expect(m.all('plugin-configure')).toHaveLength(1))
  m.q('plugin-configure').click()
  await vi.waitFor(() => expect(f.openings).toHaveLength(1))
  f.openings[0]!.finish({ ok: false, error: 'Plugin unavailable. Try again.' })
  await vi.waitFor(() => expect(m.all('plugin-configuration-retry')).toHaveLength(1))
  expect(m.q('plugins-error').textContent).toBe('Plugin unavailable. Try again.')
  expect(m.q('plugin-stage').textContent).toContain('Try again')
  m.q('plugin-configuration-retry').click()
  await vi.waitFor(() => expect(f.openings).toHaveLength(2))
  expect(f.openings[1]!.id).not.toBe(f.openings[0]!.id)
  expect(m.q('plugin-loading').textContent?.trim()).toBe('Loading…')
  for (const closed of f.closed) closed(f.openings[0]!.id)
  await nextTick()
  expect(m.all('plugin-loading')).toHaveLength(1)
  f.openings[1]!.finish({ ok: true })
  await vi.waitFor(() => expect(m.all('plugin-loading')).toHaveLength(0))
  expect(m.all('plugins-error')).toHaveLength(0)
})
it('shows an error and closes a timed-out page, with late success unable to restore it', async () => {
  const f = slowPage()
  const m = mount(PluginsSection, { client: f.client }, { width: 1180, height: 900 })
  await vi.waitFor(() => expect(m.all('plugin-configure')).toHaveLength(1))
  vi.useFakeTimers()
  m.q('plugin-configure').click()
  await nextTick()
  await vi.advanceTimersByTimeAsync(0)
  expect(f.openings).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(PLUGIN_CONFIGURATION_TIMEOUT)
  await nextTick()
  expect(m.q('plugins-error').textContent).toBe('Plugin unavailable. Try again.')
  expect(m.q('plugin-configuration-retry').textContent?.trim()).toBe('Try again')
  expect(f.calls.some((call) => call.kind === 'close')).toBe(true)
  f.openings[0]!.finish({ ok: true })
  await vi.advanceTimersByTimeAsync(0)
  expect(m.all('plugin-configuration-retry')).toHaveLength(1)
  expect(m.all('plugin-loading')).toHaveLength(0)
})
it('Cancel removes a loading page and ignores its late answer', async () => {
  const f = slowPage()
  const m = mount(PluginsSection, { client: f.client }, { width: 1180, height: 900 })
  await vi.waitFor(() => expect(m.all('plugin-configure')).toHaveLength(1))
  m.q('plugin-configure').click()
  await vi.waitFor(() => expect(f.openings).toHaveLength(1))
  m.q('plugin-close').click()
  await nextTick()
  f.openings[0]!.finish({ ok: true })
  await nextTick()
  expect(m.all('plugin-stage')).toHaveLength(0)
  expect(m.all('plugins-error')).toHaveLength(0)
})
