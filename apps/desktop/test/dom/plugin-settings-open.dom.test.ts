import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import PluginsSection from '../../src/renderer/src/components/PluginsSection.vue'
import type { PluginHostClient, PluginHostSnapshot } from '../../src/shared/plugin-host'
import type { PluginSettingsReply, PluginSettingsRequest } from '../../src/shared/plugin-settings'
import { fictionalPlugins } from '../../look/fixtures/plugins'
import { mount, unmountAll } from './harness'

afterEach(() => {
  unmountAll()
  Reflect.deleteProperty(window, 'api')
})

function fixture(holdFirst = false) {
  const f = fictionalPlugins()
  f.set([
    { id: 'fictional-fir', name: 'Fictional Fir', installed: true, state: 'Running' },
    { id: 'fictional-birch', name: 'Fictional Birch', installed: true, state: 'Running' },
  ])
  const listeners = new Set<() => void>()
  const snapshot: PluginHostSnapshot = { contributions: [], notifications: [], settingsViews: [] }
  const host: PluginHostClient = {
    async request(input) {
      structuredClone(input)
      return { value: structuredClone(snapshot) }
    },
    onChanged(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  Object.defineProperty(window, 'api', { configurable: true, value: { pluginHost: host } })
  function publish(pluginId: string) {
    const view = { pluginId, viewId: `view-${pluginId}`, handle: `page-${pluginId}` }
    if (!snapshot.settingsViews!.some((one) => one.viewId === view.viewId))
      snapshot.settingsViews!.push(view)
    for (const listener of listeners) listener()
  }
  let finishFirst: ((reply: PluginSettingsReply) => void) | undefined
  const original = f.client.request
  const request = vi.fn(async (input: PluginSettingsRequest): Promise<PluginSettingsReply> => {
    const reply = await original(structuredClone(input))
    if (input.kind !== 'configure') return structuredClone(reply)
    publish(input.id)
    if (holdFirst && input.id === 'fictional-fir')
      return new Promise((resolve) => {
        finishFirst = resolve
      })
    return { ok: true, viewId: input.viewId ?? `view-${input.id}` }
  })
  f.client.request = request
  const opened = () =>
    request.mock.calls.map(([input]) => input).filter((input) => input.kind === 'configure')
  return {
    ...f,
    request,
    publish,
    opened,
    release: () => {
      if (!finishFirst) throw new Error('The fictional first page was not requested.')
      finishFirst({ ok: true, viewId: 'view-fictional-fir' })
    },
  }
}

it('opens a requested host view while another plugin configuration is selected, without reopening its own view', async () => {
  const f = fixture()
  const m = mount(PluginsSection, { client: f.client }, { width: 1180, height: 900 })
  await vi.waitFor(() => expect(m.all('plugin-configure')).toHaveLength(2))
  m.q('plugin-configure').click()
  await vi.waitFor(() => expect(f.opened()).toHaveLength(1))
  await vi.waitFor(() => expect(m.all('plugin-loading')).toHaveLength(0))
  expect(m.q('plugin-configuration').textContent).toContain('Fictional Fir')
  f.publish('fictional-birch')
  await vi.waitFor(() => expect(f.opened()).toHaveLength(2))
  expect(f.opened()[1]).toMatchObject({
    kind: 'configure',
    id: 'fictional-birch',
    viewId: 'view-fictional-birch',
  })
  await vi.waitFor(() =>
    expect(m.q('plugin-configuration').textContent).toContain('Fictional Birch'),
  )
  f.publish('fictional-birch')
  await vi.waitFor(() => expect(m.all('plugin-loading')).toHaveLength(0))
  expect(f.opened()).toHaveLength(2)
})

it('replays a requested host view once a loading plugin page finishes', async () => {
  const f = fixture(true)
  const m = mount(PluginsSection, { client: f.client }, { width: 1180, height: 900 })
  await vi.waitFor(() => expect(m.all('plugin-configure')).toHaveLength(2))
  m.q('plugin-configure').click()
  await vi.waitFor(() => expect(f.opened()).toHaveLength(1))
  f.publish('fictional-birch')
  await nextTick()
  expect(f.opened()).toHaveLength(1)
  expect(m.q('plugin-loading').textContent?.trim()).toBe('Loading…')
  f.release()
  await vi.waitFor(() => expect(f.opened()).toHaveLength(2))
  expect(f.opened()[1]).toMatchObject({ id: 'fictional-birch', viewId: 'view-fictional-birch' })
  await vi.waitFor(() => expect(m.all('plugin-loading')).toHaveLength(0))
  expect(m.q('plugin-configuration').textContent).toContain('Fictional Birch')
})
