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
