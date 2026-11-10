import { afterEach, expect, it, vi } from 'vitest'
import { mount, unmountAll } from './harness'
import { settingsWindow } from '../../look/fixtures/settings-window'
import { fictionalPlugins } from '../../look/fixtures/plugins'

afterEach(() => unmountAll())

it('shows the reported stage and cause on an unavailable card without an unavailable reason', async () => {
  const f = fictionalPlugins()
  f.set([
    {
      id: 'fictional-fir',
      name: 'Fictional Fir',
      installed: true,
      state: 'Unavailable',
      toolsCause: 'binding-connect: timeout',
    },
  ])
  const m = mount(settingsWindow('plugins', 'classic', f.client), {}, { width: 760, height: 900 })
  await vi.waitFor(() =>
    expect(m.q('plugin-start-error').textContent).toContain('binding-connect: timeout'),
  )
  expect(m.q('plugin-start-error').textContent).not.toContain('did not report why')
})

it('shows the reported stage and cause when a running plugin has unavailable tools', async () => {
  const f = fictionalPlugins()
  f.set([
    {
      id: 'fictional-fir',
      name: 'Fictional Fir',
      installed: true,
      state: 'Running',
      toolsUnavailable: true,
      toolsCause: 'binding-connect: timeout',
    },
  ])
  const m = mount(settingsWindow('plugins', 'classic', f.client), {}, { width: 760, height: 900 })
  await vi.waitFor(() =>
    expect(m.q('plugin-tools-unavailable').textContent).toContain('binding-connect: timeout'),
  )
})

it('updates the restart banner when a later health read reports the cause', async () => {
  const f = fictionalPlugins()
  const degraded = {
    id: 'chrome',
    name: 'Chrome',
    installed: true,
    state: 'Running' as const,
    toolsUnavailable: true as const,
    action: {
      id: 'fixture-restart',
      kind: 'restart' as const,
      label: 'Restart Chrome',
      note: 'Closes the Chrome windows BroCrew opened.',
      failureAction: 'restart Chrome',
    },
  }
  f.set([degraded])
  const original = f.client.request
  f.client.request = async (input) =>
    input.kind === 'action' ? { ok: true, cards: [degraded] } : original(input)
  const m = mount(settingsWindow('plugins', 'classic', f.client), {}, { width: 760, height: 900 })
  await vi.waitFor(() => expect(m.all('plugin-restart')).toHaveLength(1))
  m.q('plugin-restart').click()
  await vi.waitFor(() =>
    expect(m.q('plugins-error').textContent).toContain('after the restart request'),
  )
  f.set([{ ...degraded, toolsCause: 'binding-inventory: timeout' }])
  await vi.waitFor(
    () => expect(m.q('plugins-error').textContent).toContain('binding-inventory: timeout'),
    { timeout: 7000 },
  )
  expect(m.q('plugins-error').textContent).not.toContain('did not report why')
  f.set([{ id: 'chrome', name: 'Chrome', installed: true, state: 'Running' }])
  await vi.waitFor(() => expect(m.all('plugins-error')).toHaveLength(0), { timeout: 7000 })
})
