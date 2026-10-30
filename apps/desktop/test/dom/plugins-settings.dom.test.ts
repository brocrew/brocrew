import { afterEach, expect, it, vi } from 'vitest'
import type { PluginSettingsReply } from '../../src/shared/plugin-settings'
import { nextTick } from 'vue'
import { visibleProviderDescriptors } from '@brobot2/shared'
import { page } from 'vitest/browser'
import { mount, unmountAll } from './harness'
import { settingsWindow } from '../../look/fixtures/settings-window'
import { fictionalPlugins } from '../../look/fixtures/plugins'
import { READABILITY_THEMES } from '../../look/fixtures/readability-themes'
import { paintedReadings } from './what-is-painted-under'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
afterEach(() => {
  unmountAll()
  applyTheme(null)
  Reflect.deleteProperty(window, 'api')
})
it('uses explicitly fake install/uninstall seams, searches, configures its measured screen and closes on leaving', async () => {
  const f = fictionalPlugins(false),
    m = mount(settingsWindow('plugins', 'classic', f.client), {}, { width: 1180, height: 900 })
  await vi.waitFor(() => expect(m.all('plugin-card')).toHaveLength(2))
  m.q('plugin-install').click()
  await vi.waitFor(() => expect(m.q('plugin-state').textContent).toBe('Installed'))
  expect(f.calls.some((c) => c.kind === 'install' && c.id === 'chrome')).toBe(true)
  const search = m.q('plugins-search') as HTMLInputElement
  search.value = 'chrome'
  search.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  expect(m.all('plugin-card')).toHaveLength(1)
  m.q('plugin-configure').click()
  await vi.waitFor(() =>
    expect(f.calls.some((c) => c.kind === 'configure' && c.id === 'chrome')).toBe(true),
  )
  const request = f.calls.find((c) => c.kind === 'configure')
  expect(request).toMatchObject({
    kind: 'configure',
    id: 'chrome',
    bounds: { width: expect.any(Number) },
  })
  m.q('plugin-close').click()
  await nextTick()
  m.q('plugin-uninstall').click()
  await nextTick()
  expect(m.q('plugin-confirmation').textContent).toContain('Its data will be kept.')
  expect(m.q('plugin-confirmation').textContent?.toLowerCase()).not.toContain('phone')
  expect(m.q('plugin-confirmation').textContent?.toLowerCase()).not.toContain('linked device')
  expect(f.calls.filter((c) => c.kind === 'uninstall')).toHaveLength(0)
  m.q('plugin-uninstall-confirm').click()
  await vi.waitFor(() => expect(m.q('plugin-state').textContent).toBe('Available'))
  m.q('settings-tab-general').click()
  await nextTick()
  expect(f.calls.at(-1)?.kind).toBe('close')
})
it('says an install is starting while it waits, and not as an error', async () => {
  const f = fictionalPlugins(false),
    m = mount(settingsWindow('plugins', 'classic', f.client), {}, { width: 1180, height: 900 })
  await vi.waitFor(() => expect(m.all('plugin-card')).toHaveLength(2))
  const release = f.holdInstall()
  m.q('plugin-install').click()
  await vi.waitFor(() =>
    expect(m.q('plugin-starting').textContent).toContain(
      'Installing and starting Chrome. The first start can take a minute.',
    ),
  )
  expect(m.all('plugins-error')).toHaveLength(0)
  expect(m.all('plugin-start-error')).toHaveLength(0)
  release()
  await vi.waitFor(() => expect(m.q('plugin-state').textContent).toBe('Installed'))
  expect(m.all('plugin-starting')).toHaveLength(0)
})
it('hides Plugins without an injected or available real controller', async () => {
  const m = mount(settingsWindow('plugins', 'classic'), {}, { width: 1180, height: 900 })
  await nextTick()
  expect(m.all('settings-tab-plugins')).toHaveLength(0)
  expect(m.all('plugins-section')).toHaveLength(0)
  expect(m.all('provider-row').map((row) => row.dataset['provider'])).toEqual(
    visibleProviderDescriptors(false).map((provider) => provider.id),
  )
  expect(m.all('provider-card')).toHaveLength(0)
  expect(m.all('provider-drawer')).toHaveLength(0)
})
it('shows the approved failure and tears down a revoked configuration', async () => {
  const f = fictionalPlugins(),
    m = mount(settingsWindow('plugins', 'classic', f.client), {}, { width: 1180, height: 900 })
  await vi.waitFor(() => expect(m.all('plugin-card')).toHaveLength(2))
  m.q('plugin-configure').click()
  await vi.waitFor(() => expect(m.all('plugin-stage')).toHaveLength(1))
  const opened = f.calls.find((call) => call.kind === 'configure')!
  if (opened.kind !== 'configure') throw new Error('expected configure')
  for (const stop of f.closed) stop(opened.screenId)
  await nextTick()
  expect(m.q('plugins-error').textContent).toBe('Plugin unavailable. Try again.')
  expect(m.all('plugin-stage')).toHaveLength(1)
  expect(m.q('plugin-configuration-retry').textContent?.trim()).toBe('Try again')
})
it.each(READABILITY_THEMES.flatMap((theme) => [1180, 760].map((width) => ({ theme, width }))))(
  'reads Plugins in $theme at $width',
  async ({ theme, width }) => {
    await page.viewport(width, 900)
    const f = fictionalPlugins()
    f.set([
      {
        id: 'chrome',
        name: 'Chrome',
        installed: true,
        state: 'Running',
        installedVersion: '0.1.0',
        updateVersion: '0.1.3',
      },
      { id: 'fictional-fir', name: 'Fictional Fir', installed: true, state: 'Unavailable' },
    ])
    const m = mount(settingsWindow('plugins', theme, f.client), {}, { width, height: 900 })
    await vi.waitFor(() => expect(m.all('plugin-card')).toHaveLength(2))
    const readings = await paintedReadings(m.q('plugins-section'))
    expect(readings.filter((r) => r.reading.is === 'read').length).toBeGreaterThan(8)
    expect(
      readings
        .filter(
          ({ node }) =>
            !node.parentElement?.closest(
              ':disabled,[aria-disabled="true"],svg,option,script,style,[hidden]',
            ),
        )
        .filter(
          ({ reading }) =>
            reading.is === 'unread' || (reading.is === 'read' && reading.ratio < 4.5),
        )
        .map(({ node, reading }) => ({ text: node.textContent?.trim(), reading })),
    ).toEqual([])
    m.q('plugin-configure').click()
    await vi.waitFor(() => expect(m.all('plugin-stage')).toHaveLength(1))
    const configReadings = await paintedReadings(m.q('plugin-configuration'))
    expect(configReadings.filter((r) => r.reading.is === 'read').length).toBeGreaterThanOrEqual(3)
    expect(
      configReadings
        .filter(({ node }) => !node.parentElement?.closest(':disabled,svg,script,style'))
        .filter(
          ({ reading }) =>
            reading.is === 'unread' || (reading.is === 'read' && reading.ratio < 4.5),
        ),
    ).toEqual([])
    expect(m.q('plugin-stage').getBoundingClientRect().bottom).toBeLessThanOrEqual(900)
    expect(m.host.scrollWidth).toBeLessThanOrEqual(width)
    const box = m.q('plugin-close').getBoundingClientRect()
    expect(box.right).toBeLessThanOrEqual(width)
    expect(box.bottom).toBeLessThanOrEqual(900)
  },
)

it('keeps B visible when A finishes closing after Cancel and Configure again', async () => {
  const f = fictionalPlugins()
  const originalRequest = f.client.request
  let finishClose = () => {}
  let holdClose = false
  f.client.request = async (input) => {
    if (input.kind === 'close' && holdClose)
      return new Promise((resolve) => {
        finishClose = () => resolve({ ok: true })
      })
    return originalRequest(input)
  }
  const m = mount(settingsWindow('plugins', 'classic', f.client), {}, { width: 1180, height: 900 })
  await vi.waitFor(() => expect(m.all('plugin-card')).toHaveLength(2))
  m.q('plugin-configure').click()
  await vi.waitFor(() => expect(f.calls.filter((c) => c.kind === 'configure')).toHaveLength(1))
  const a = f.calls.find((c) => c.kind === 'configure')!
  if (a.kind !== 'configure') throw new Error('expected A')
  holdClose = true
  m.q('plugin-close').click()
  await nextTick()
  m.q('plugin-configure').click()
  await vi.waitFor(() => expect(f.calls.filter((c) => c.kind === 'configure')).toHaveLength(2))
  const b = f.calls.filter((c) => c.kind === 'configure')[1]!
  if (b.kind !== 'configure') throw new Error('expected B')
  expect(b.screenId).not.toBe(a.screenId)
  for (const stop of f.closed) stop(a.screenId)
  finishClose()
  await nextTick()
  expect(m.all('plugin-stage')).toHaveLength(1)
  expect(m.all('plugins-error')).toHaveLength(0)
  // Actual B revocation must still clear B.
  for (const stop of f.closed) stop(b.screenId)
  await nextTick()
  expect(m.all('plugin-stage')).toHaveLength(1)
  expect(m.q('plugin-configuration-retry').textContent?.trim()).toBe('Try again')
  expect(m.q('plugins-error').textContent).toBe('Plugin unavailable. Try again.')
})

it('an installed blocked plugin explains recovery, retry becomes Running, and never installs', async () => {
  const f = fictionalPlugins()
  f.set([{ id: 'fictional-fir', name: 'Fictional Fir', installed: true, state: 'Unavailable' }])
  const original = f.client.request
  f.client.request = async (input) => {
    if (input.kind === 'retry')
      f.set([{ id: 'fictional-fir', name: 'Fictional Fir', installed: true, state: 'Running' }])
    return original(input)
  }
  const m = mount(settingsWindow('plugins', 'classic', f.client), {}, { width: 1180, height: 900 })
  await vi.waitFor(() => expect(m.all('plugin-card')).toHaveLength(1))
  expect(m.q('plugin-start-error').textContent).toContain("Fictional Fir can't start right now.")
  expect(m.q('plugin-retry').textContent?.trim()).toBe('Try again')
  expect(m.all('plugin-install')).toHaveLength(0)
  expect(m.all('plugin-uninstall')).toHaveLength(0)
  expect(m.all('plugin-restart-hint')).toHaveLength(0)
  m.q('plugin-retry').click()
  await vi.waitFor(() => expect(m.q('plugin-state').textContent).toBe('Running'))
  expect(m.all('plugin-start-error')).toHaveLength(0)
  expect(m.all('plugin-configure')).toHaveLength(1)
  expect(f.calls.some((call) => call.kind === 'install' || call.kind === 'uninstall')).toBe(false)
})
it('a failed retry keeps the approved line and restart hint without raw errors', async () => {
  const f = fictionalPlugins()
  f.set([{ id: 'fictional-fir', name: 'Fictional Fir', installed: null, state: 'Unavailable' }])
  const original = f.client.request
  f.client.request = async (input) => {
    if (input.kind === 'retry') throw new Error('fictional-private-owner-stack')
    return original(input)
  }
  const m = mount(settingsWindow('plugins', 'classic', f.client), {}, { width: 760, height: 900 })
  await vi.waitFor(() => expect(m.all('plugin-retry')).toHaveLength(1))
  expect(m.all('plugin-install')).toHaveLength(0)
  m.q('plugin-retry').click()
  await vi.waitFor(() =>
    expect(m.q('plugin-restart-hint').textContent).toBe('Restart BroCrew if this keeps happening.'),
  )
  expect(m.q('plugin-start-error').textContent).toContain("Fictional Fir can't start right now.")
  expect(m.host.textContent).not.toContain('fictional-private-owner-stack')
  expect(m.all('plugin-install')).toHaveLength(0)
})
it.each([true, null] as const)(
  'an installed row stays in recovery after Running and failed detach with presence %s',
  async (presence) => {
    const f = fictionalPlugins()
    f.set([{ id: 'fictional-fir', name: 'Fictional Fir', installed: false, state: 'Available' }])
    const original = f.client.request
    f.client.request = async (input) => {
      if (input.kind === 'retry')
        f.set([
          { id: 'fictional-fir', name: 'Fictional Fir', installed: presence, state: 'Unavailable' },
        ])
      const reply = await original(input)
      if (input.kind === 'install') {
        const cards = [
          {
            id: 'fictional-fir',
            name: 'Fictional Fir',
            installed: true,
            state: 'Running' as const,
          },
        ]
        f.set(cards)
        return { ok: true, cards }
      }
      return reply
    }
    let m = mount(settingsWindow('plugins', 'classic', f.client), {}, { width: 760, height: 900 })
    await vi.waitFor(() => expect(m.all('plugin-install')).toHaveLength(1))
    m.q('plugin-install').click()
    await vi.waitFor(() => expect(m.q('plugin-state').textContent).toBe('Running'))
    m.unmount()
    // A newly listed unavailable owner must keep the previously installed row out of Install.
    f.set([{ id: 'fictional-fir', name: 'Fictional Fir', installed: true, state: 'Unavailable' }])
    m = mount(settingsWindow('plugins', 'classic', f.client), {}, { width: 760, height: 900 })
    await vi.waitFor(() => expect(m.all('plugin-retry')).toHaveLength(1))
    m.q('plugin-retry').click()
    await vi.waitFor(() =>
      expect(m.q('plugin-restart-hint').textContent).toBe(
        'Restart BroCrew if this keeps happening.',
      ),
    )
    expect(m.q('plugin-start-error').textContent).toContain("Fictional Fir can't start right now.")
    expect(m.all('plugin-install')).toHaveLength(0)
    expect(f.calls.filter((call) => call.kind === 'install')).toHaveLength(1)
    expect(f.calls.some((call) => call.kind === 'uninstall')).toBe(false)
  },
)
it('a completed retry with uncertain cleanup keeps the restart hint and never offers Install', async () => {
  const f = fictionalPlugins()
  f.set([{ id: 'fictional-fir', name: 'Fictional Fir', installed: null, state: 'Unavailable' }])
  const m = mount(settingsWindow('plugins', 'classic', f.client), {}, { width: 760, height: 900 })
  await vi.waitFor(() => expect(m.all('plugin-retry')).toHaveLength(1))
  m.q('plugin-retry').click()
  await vi.waitFor(() =>
    expect(m.q('plugin-restart-hint').textContent).toBe('Restart BroCrew if this keeps happening.'),
  )
  m.q('plugin-retry').click()
  await vi.waitFor(() => expect(f.calls.filter((call) => call.kind === 'retry')).toHaveLength(2))
  expect(m.q('plugin-start-error').textContent).toContain("Fictional Fir can't start right now.")
  expect(m.all('plugin-install')).toHaveLength(0)
  expect(f.calls.some((call) => call.kind === 'install' || call.kind === 'uninstall')).toBe(false)
})
it.each([1180, 760])(
  'captures the old fallback and installed recovery row at %s',
  async (width) => {
    await page.viewport(width, 900)
    const f = fictionalPlugins()
    f.set([{ id: 'fictional-fir', name: 'Fictional Fir', installed: false, state: 'Unavailable' }])
    let m = mount(settingsWindow('plugins', 'classic', f.client), {}, { width, height: 900 })
    await vi.waitFor(() => expect(m.all('plugin-install')).toHaveLength(1))
    expect((m.q('plugin-install') as HTMLButtonElement).disabled).toBe(true)
    if (import.meta.env.VITE_W41144_CAPTURE)
      await page.screenshot({
        element: m.q('plugin-card'),
        path: `__screenshots__/fictional-w41144-before-${width}.png`,
      })
    m.unmount()
    f.set([{ id: 'fictional-fir', name: 'Fictional Fir', installed: true, state: 'Unavailable' }])
    m = mount(settingsWindow('plugins', 'classic', f.client), {}, { width, height: 900 })
    await vi.waitFor(() => expect(m.all('plugin-retry')).toHaveLength(1))
    expect(m.all('plugin-install')).toHaveLength(0)
    if (import.meta.env.VITE_W41144_CAPTURE)
      await page.screenshot({
        element: m.q('plugin-card'),
        path: `__screenshots__/fictional-w41144-after-${width}.png`,
      })
  },
)

it.each([
  { width: 1440, height: 1100 },
  { width: 760, height: 900 },
])(
  'fills the Configure content at $width by $height and sends its measured bounds',
  async ({ width, height }) => {
    await page.viewport(width, height)
    const f = fictionalPlugins()
    const m = mount(settingsWindow('plugins', 'classic', f.client), {}, { width, height })
    await vi.waitFor(() => expect(m.all('plugin-card')).toHaveLength(2))
    m.q('plugin-configure').click()
    await vi.waitFor(() => expect(f.calls.some((call) => call.kind === 'configure')).toBe(true))
    const stage = m.q('plugin-stage')
    const box = stage.getBoundingClientRect()
    const panel = document.getElementById('settings-panel-plugins')!
    const content = panel.getBoundingClientRect()
    const css = getComputedStyle(panel)
    expect(box.width).toBeGreaterThan(600)
    expect(Math.abs(box.left - content.left - parseFloat(css.paddingLeft))).toBeLessThanOrEqual(1)
    expect(Math.abs(box.right - content.right + parseFloat(css.paddingRight))).toBeLessThanOrEqual(
      1,
    )
    expect(
      Math.abs(box.bottom - content.bottom + parseFloat(css.paddingBottom)),
    ).toBeLessThanOrEqual(1)
    expect(box.height).toBeGreaterThan(480)
    const opened = f.calls.find((call) => call.kind === 'configure')!
    expect(opened).toMatchObject({
      bounds: {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.floor(box.width),
        height: Math.floor(box.height),
      },
    })
    m.host.style.width = `${width - 100}px`
    m.host.style.height = `${height - 100}px`
    await vi.waitFor(() => {
      const resized = stage.getBoundingClientRect()
      expect(f.calls.filter((call) => call.kind === 'bounds').at(-1)).toMatchObject({
        bounds: { width: Math.floor(resized.width), height: Math.floor(resized.height) },
      })
      expect(resized.width).toBeLessThan(box.width)
      expect(resized.height).toBeLessThan(box.height)
    })
  },
)

it('offers the current update on every page opening and tells the truth about data removal', async () => {
  await page.viewport(1180, 900)
  const f = fictionalPlugins()
  f.set([
    {
      id: 'whatsapp',
      name: 'WhatsApp',
      installed: true,
      state: 'Running',
      installedVersion: '0.1.0',
      updateVersion: '0.1.3',
      uninstallDeletesData: true,
    },
  ])
  const request = f.client.request.bind(f.client)
  f.client.request = async (input) => {
    if (input.kind === 'update')
      f.set([
        {
          id: 'whatsapp',
          name: 'WhatsApp',
          installed: true,
          state: 'Running',
          installedVersion: '0.1.3',
          uninstallDeletesData: true,
        },
      ])
    return request(input)
  }
  const m = mount(settingsWindow('plugins', 'classic', f.client), {}, { width: 1180, height: 900 })
  await vi.waitFor(() => expect(m.all('plugin-update')).toHaveLength(1))
  expect(m.q('plugin-update').textContent?.trim()).toBe('Update to 0.1.3')
  if (import.meta.env.VITE_PLUGIN_UPDATE_CAPTURE)
    await page.screenshot({
      element: m.q('plugin-card'),
      path: '__screenshots__/plugin-before-update.png',
    })
  m.q('plugin-update').click()
  await vi.waitFor(() => expect(m.all('plugin-update')).toHaveLength(0))
  expect(f.calls.some((call) => call.kind === 'update' && call.id === 'whatsapp')).toBe(true)
  expect(f.calls.some((call) => call.kind === 'uninstall')).toBe(false)
  if (import.meta.env.VITE_PLUGIN_UPDATE_CAPTURE)
    await page.screenshot({
      element: m.q('plugin-card'),
      path: '__screenshots__/plugin-after-update.png',
    })
  m.q('plugin-uninstall').click()
  await nextTick()
  if (import.meta.env.VITE_PLUGIN_UPDATE_CAPTURE)
    await page.screenshot({
      element: m.q('plugin-card'),
      path: '__screenshots__/plugin-uninstall-truth.png',
    })
  expect(m.q('plugin-confirmation').textContent).toContain(
    'Uninstall WhatsApp from all workspaces and delete its local data.',
  )
  m.q('settings-tab-general').click()
  await nextTick()
  m.q('settings-tab-plugins').click()
  await vi.waitFor(() => expect(f.calls.filter((call) => call.kind === 'list')).toHaveLength(2))
})

it('keeps the installed card and offers retry after an update failure, without uninstalling', async () => {
  const f = fictionalPlugins()
  f.set([
    {
      id: 'fictional-fir',
      name: 'Fictional Fir',
      installed: true,
      state: 'Running',
      installedVersion: '0.1.0',
      updateVersion: '0.1.3',
    },
  ])
  const request = f.client.request.bind(f.client)
  f.client.request = async (input) =>
    input.kind === 'update'
      ? { ok: false, error: 'Plugin unavailable. Try again.' }
      : request(input)
  const m = mount(settingsWindow('plugins', 'classic', f.client), {}, { width: 1180, height: 900 })
  await vi.waitFor(() => expect(m.all('plugin-update')).toHaveLength(1))
  m.q('plugin-update').click()
  await vi.waitFor(() =>
    expect(m.q('plugins-error').textContent).toBe('Plugin unavailable. Try again.'),
  )
  expect((m.q('plugin-update') as HTMLButtonElement).disabled).toBe(false)
  expect(m.q('plugin-state').textContent).toBe('Running')
  expect(f.calls.some((call) => call.kind === 'uninstall')).toBe(false)
})

it('shows the Configure screen over only the seen part of its stage in a window narrower than the app', async () => {
  // A 1024 by 728 window, the app's frame at its 1180 floor, as on a small display.
  await page.viewport(1024, 728)
  const f = fictionalPlugins()
  const m = mount(settingsWindow('plugins', 'classic', f.client), {}, { width: 1180, height: 728 })
  await vi.waitFor(() => expect(m.all('plugin-card')).toHaveLength(2))
  m.q('plugin-configure').click()
  await vi.waitFor(() => expect(f.calls.some((call) => call.kind === 'configure')).toBe(true))
  const stage = m.q('plugin-stage').getBoundingClientRect()
  expect(stage.right).toBeGreaterThan(1024)
  const opened = f.calls.find((call) => call.kind === 'configure')!
  expect(opened).toMatchObject({
    bounds: {
      x: Math.round(stage.x),
      y: Math.round(stage.y),
      width: 1024 - Math.round(stage.x),
      height: Math.min(Math.round(stage.y) + Math.floor(stage.height), 728) - Math.round(stage.y),
    },
  })
  // The frame scrolled sideways: the stage now starts left of the window.
  m.host.style.marginLeft = '-156px'
  window.dispatchEvent(new Event('scroll'))
  await vi.waitFor(() => {
    const moved = m.q('plugin-stage').getBoundingClientRect()
    expect(moved.x).toBeLessThan(0)
    expect(f.calls.filter((call) => call.kind === 'bounds').at(-1)).toMatchObject({
      bounds: { x: 0, width: Math.min(Math.round(moved.x) + Math.floor(moved.width), 1024) },
    })
  })
  expect(m.all('plugins-error')).toHaveLength(0)
})
it.each([
  {
    reply: { ok: false, listState: 'not-published' },
    message: 'Plugins will be available with the public release.',
  },
  {
    reply: { ok: true, cards: [], listState: 'empty' },
    message: 'No plugins are available for this version yet.',
  },
  {
    reply: { ok: false, listState: 'fetch-error' },
    message: "Couldn't load the plugin catalogue. Try again.",
  },
  {
    reply: { ok: false, listState: 'fetch-error', reason: 'supervisor-unavailable' },
    message: "Couldn't start the plugin service. Try again.",
  },
])('shows the approved list status: $message', async ({ reply, message }) => {
  const f = fictionalPlugins()
  const original = f.client.request
  f.client.request = async (input) =>
    input.kind === 'list' ? (reply as PluginSettingsReply) : original(input)
  const m = mount(settingsWindow('plugins', 'classic', f.client), {}, { width: 1180, height: 900 })
  await vi.waitFor(() => expect(m.q('plugins-list-status').textContent).toBe(message))
  expect(m.all('plugin-card')).toHaveLength(0)
  expect(m.all('plugins-error')).toHaveLength(0)
  expect(m.host.textContent).not.toContain('Plugin unavailable. Try again.')
})
it('shows the list fetch error when the bridge rejects', async () => {
  const f = fictionalPlugins()
  const original = f.client.request
  f.client.request = async (input) => {
    if (input.kind === 'list') throw new Error('fictional private transport detail')
    return original(input)
  }
  const m = mount(settingsWindow('plugins', 'classic', f.client), {}, { width: 1180, height: 900 })
  await vi.waitFor(() =>
    expect(m.q('plugins-list-status').textContent).toBe(
      "Couldn't load the plugin catalogue. Try again.",
    ),
  )
  expect(m.all('plugins-error')).toHaveLength(0)
  expect(m.host.textContent).not.toContain('fictional private transport detail')
})

it('keeps Running and Configure beside a quiet failed-refresh notice', async () => {
  const f = fictionalPlugins()
  const request = f.client.request
  f.client.request = async (input) => {
    const answer = await request(input)
    return input.kind === 'list' && answer.ok ? { ...answer, refreshFailed: true } : answer
  }
  const m = mount(settingsWindow('plugins', 'classic', f.client), {}, { width: 1180, height: 900 })
  await vi.waitFor(() => expect(m.all('plugin-card')).toHaveLength(2))
  expect(m.q('plugin-state').textContent).toBe('Running')
  expect(m.q('plugins-refresh-notice').textContent?.trim()).toBe(
    "Couldn't check for plugin updates. Check your connection and try again.",
  )
  expect(m.all('plugins-list-status')).toHaveLength(0)
  expect(m.all('plugins-error')).toHaveLength(0)
  expect((m.q('plugin-configure') as HTMLButtonElement).disabled).toBe(false)
  m.q('plugin-configure').click()
  await vi.waitFor(() => expect(m.all('plugin-stage')).toHaveLength(1))
  expect(f.calls.some((call) => call.kind === 'configure')).toBe(true)
})

it('keeps phone-removal guidance after uninstall removes the configuration page', async () => {
  const f = fictionalPlugins()
  f.set([
    {
      id: 'whatsapp',
      name: 'WhatsApp',
      installed: true,
      state: 'Running',
      uninstallDeletesData: true,
      hasRemoteLogout: true,
    },
  ])
  const request = f.client.request.bind(f.client)
  f.client.request = async (input) => {
    const answer = await request(input)
    return input.kind === 'uninstall' && answer.ok
      ? { ...answer, removal: { data: 'deleted' as const, logout: 'unconfirmed' as const } }
      : answer
  }
  const m = mount(settingsWindow('plugins', 'classic', f.client), {}, { width: 1180, height: 900 })
  await vi.waitFor(() => expect(m.all('plugin-uninstall')).toHaveLength(1))
  m.q('plugin-uninstall').click()
  await nextTick()
  expect(m.q('plugin-confirmation').textContent).not.toContain('This logs it out')
  expect(m.q('plugin-confirmation').textContent).toContain('If logout cannot be confirmed')
  m.q('plugin-uninstall-confirm').click()
  await vi.waitFor(() => expect(m.all('plugin-uninstall')).toHaveLength(0))
  expect(m.q('plugins-removal-notice').textContent).toContain('local data was deleted')
  expect(m.q('plugins-removal-notice').textContent).toContain('WhatsApp')
  expect(m.q('plugins-removal-notice').textContent).toContain('Linked devices')
  expect(m.all('plugin-configuration')).toHaveLength(0)
})

it('explains unavailable updates while retaining Configure and Uninstall for an installed plugin', async () => {
  const f = fictionalPlugins()
  f.set([
    {
      id: 'fictional-cedar',
      name: 'Fictional Cedar',
      installed: true,
      state: 'Running',
      updatesUnavailable: true,
    },
  ])
  const m = mount(settingsWindow('plugins', 'classic', f.client), {}, { width: 1180, height: 900 })
  await vi.waitFor(() => expect(m.all('plugin-card')).toHaveLength(1))
  expect(m.q('plugin-updates-unavailable').textContent?.trim()).toBe(
    'Updates aren’t available for this version of BroCrew.',
  )
  expect(m.all('plugin-install')).toHaveLength(0)
  expect(m.all('plugin-update')).toHaveLength(0)
  expect(m.all('plugin-configure')).toHaveLength(1)
  expect(m.all('plugin-uninstall')).toHaveLength(1)
})
