import { afterEach, expect, it, vi } from 'vitest'
import type {
  PluginCard,
  PluginsClient,
  PluginSettingsRequest,
  PluginSettingsReply,
  PluginWindowReview,
} from '../../src/shared/plugin-settings'
import { nextTick } from 'vue'
import PluginsSection from '../../src/renderer/src/components/PluginsSection.vue'
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
  expect(m.q('plugins-error').textContent).toBe(
    "Couldn't keep Chrome Settings open. The plugin Settings page closed unexpectedly. Try again.",
  )
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
  expect(m.q('plugins-error').textContent).toBe(
    "Couldn't keep Chrome Settings open. The plugin Settings page closed unexpectedly. Try again.",
  )
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
it.each([
  ['owner-window-open', 'If another BroCrew window is open, close it, then try again.'],
  ['restart-required', 'Restart your computer, then reopen BroCrew.'],
  [
    'previous-service-stopping',
    "The previous plugin service didn't finish stopping. Restart your computer, then open BroCrew again.",
  ],
] as const)(
  'shows the specific %s remedy without an app-restart contradiction',
  async (reason, text) => {
    const f = fictionalPlugins()
    f.set([
      {
        id: 'fictional-fir',
        name: 'Fictional Fir',
        installed: true,
        state: 'Unavailable',
        unavailableReason: reason,
      },
    ])
    const m = mount(settingsWindow('plugins', 'classic', f.client), {}, { width: 760, height: 900 })
    await vi.waitFor(() => expect(m.all('plugin-retry')).toHaveLength(1))
    if (import.meta.env.VITE_LIVE_OWNER_CAPTURE)
      await page.screenshot({
        element: m.q('plugin-card'),
        path: `__screenshots__/live-owner-${import.meta.env.VITE_LIVE_OWNER_CAPTURE}-${reason}.png`,
      })
    expect(m.q('plugin-start-error').textContent).toContain(text)
    m.q('plugin-retry').click()
    await vi.waitFor(() => expect(f.calls.some((call) => call.kind === 'retry')).toBe(true))
    await nextTick()
    expect(m.q('plugin-start-error').textContent).toContain(text)
    expect(m.all('plugin-restart-hint')).toHaveLength(0)
    expect(m.all('plugin-install')).toHaveLength(0)
  },
)
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
    await vi.waitFor(() => expect(m.all('plugin-retry')).toHaveLength(1))
    expect(m.all('plugin-install')).toHaveLength(0)
    expect(m.q('plugin-start-error').textContent).toContain('did not report why')
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

it.each([
  { detail: undefined, expected: "Couldn't update Fictional Fir. Plugin unavailable. Try again." },
  {
    detail: 'The package files do not match the selected bytes.',
    expected:
      "Couldn't update Fictional Fir. The package files do not match the selected bytes. Try again.",
  },
])(
  'a refused update keeps the installed card, offers retry and shows its error ($detail)',
  async ({ detail, expected }) => {
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
        ? {
            ok: false,
            error: 'Plugin unavailable. Try again.',
            detail,
          }
        : request(input)
    const m = mount(
      settingsWindow('plugins', 'classic', f.client),
      {},
      { width: 1180, height: 900 },
    )
    await vi.waitFor(() => expect(m.all('plugin-update')).toHaveLength(1))
    m.q('plugin-update').click()
    await vi.waitFor(() => expect(m.q('plugins-error').textContent).toBe(expected))
    expect((m.q('plugin-update') as HTMLButtonElement).disabled).toBe(false)
    expect(m.q('plugin-state').textContent).toBe('Running')
    expect(f.calls.some((call) => call.kind === 'uninstall')).toBe(false)
  },
)

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

it('explains an uninstalled unavailable offer and retries without installing it', async () => {
  const f = fictionalPlugins(false)
  f.set([
    {
      id: 'fictional-cedar',
      name: 'Fictional Cedar',
      installed: false,
      state: 'Unavailable',
      unavailableReason: 'runtime',
      startupDiagnostic: {
        exitCode: 17,
        signal: null,
        stderr: 'Error: fictional <bridge> could not bind',
      },
    },
  ])
  const original = f.client.request
  f.client.request = async (input) => {
    if (input.kind === 'retry')
      f.set([
        { id: 'fictional-cedar', name: 'Fictional Cedar', installed: false, state: 'Available' },
      ])
    return original(input)
  }
  const m = mount(settingsWindow('plugins', 'classic', f.client), {}, { width: 760, height: 900 })
  await vi.waitFor(() => expect(m.all('plugin-card')).toHaveLength(1))
  expect(m.q('plugin-start-error').textContent).toContain(
    "BroCrew couldn't prepare its bundled plugin runtime.",
  )
  expect(m.q('plugin-start-diagnostic').textContent).toContain(
    'Exit code 17. Error: fictional <bridge> could not bind',
  )
  expect(m.q('plugin-start-diagnostic').querySelector('bridge')).toBeNull()
  expect(m.all('plugin-install')).toHaveLength(0)
  m.q('plugin-retry').click()
  await vi.waitFor(() => expect(m.q('plugin-state').textContent).toBe('Available'))
  expect(m.all('plugin-start-error')).toHaveLength(0)
  expect((m.q('plugin-install') as HTMLButtonElement).disabled).toBe(false)
  expect(f.calls.some((call) => call.kind === 'install')).toBe(false)
})
it('explains an unsupported offer without a futile Retry', async () => {
  const f = fictionalPlugins(false)
  f.set([
    {
      id: 'fictional-cedar',
      name: 'Fictional Cedar',
      installed: false,
      state: 'Unavailable',
      unavailableReason: 'unsupported',
    },
  ])
  const m = mount(settingsWindow('plugins', 'classic', f.client), {}, { width: 760, height: 900 })
  await vi.waitFor(() => expect(m.all('plugin-card')).toHaveLength(1))
  expect(m.q('plugin-start-error').textContent).toContain(
    'No compatible release is available for this computer',
  )
  expect(m.all('plugin-retry')).toHaveLength(0)
  expect(f.calls.some((call) => call.kind === 'install')).toBe(false)
})

it.each([
  { label: 'the list', cards: fictionalPlugins().client, shownCards: 2, message: null },
  {
    label: 'no plugins',
    cards: null,
    shownCards: 0,
    message: 'No plugins are available for this version yet.',
  },
])(
  'says plugins are loading until $label really arrives, and never says there are none before',
  async ({ cards, shownCards, message }) => {
    let answer: (reply: PluginSettingsReply) => void = () => {}
    const held = new Promise<PluginSettingsReply>((resolve) => {
      answer = resolve
    })
    const f = fictionalPlugins()
    const original = f.client.request
    f.client.request = (input) => (input.kind === 'list' ? held : original(input))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const m = mount(
        settingsWindow('plugins', 'classic', f.client),
        {},
        { width: 1180, height: 900 },
      )
      const seen: string[] = []
      const watch = new MutationObserver(() => {
        if (m.all('plugins-list-status').length) seen.push('list status')
        if (m.host.textContent?.includes('No plugins')) seen.push('no plugins')
        if (m.all('plugin-card').length && m.all('plugins-list-loading').length)
          seen.push('cards beside loading')
      })
      watch.observe(m.host, { subtree: true, childList: true, characterData: true })
      await nextTick()
      const loading = m.q('plugins-list-loading')
      expect(loading.getAttribute('role')).toBe('status')
      expect(loading.textContent?.trim()).toBe('Loading plugins…')
      expect(m.q('plugins-section').getAttribute('aria-busy')).toBe('true')
      expect(m.all('plugin-card')).toHaveLength(0)
      await vi.advanceTimersByTimeAsync(9_999)
      expect(m.all('plugins-list-slow')).toHaveLength(0)
      await vi.advanceTimersByTimeAsync(1)
      expect(m.all('plugins-list-slow')).toHaveLength(0)
      expect(loading.textContent?.trim()).toBe('Loading plugins…')
      expect(seen).toEqual([])
      answer(cards ? await cards.request({ kind: 'list' }) : { ok: true, cards: [] })
      await vi.advanceTimersByTimeAsync(0)
      await nextTick()
      watch.disconnect()
      expect(m.all('plugins-list-loading')).toHaveLength(0)
      expect(m.all('plugins-list-slow')).toHaveLength(0)
      expect(m.q('plugins-section').getAttribute('aria-busy')).toBe('false')
      expect(m.all('plugin-card')).toHaveLength(shownCards)
      if (message) expect(m.q('plugins-list-status').textContent?.trim()).toBe(message)
      else expect(m.all('plugins-list-status')).toHaveLength(0)
      expect(seen).not.toContain('cards beside loading')
    } finally {
      vi.useRealTimers()
    }
  },
)

it('keeps Running and shows the approved agent health line for a live Chrome with dead tools', async () => {
  const f = fictionalPlugins()
  f.set([
    { id: 'chrome', name: 'Chrome', installed: true, state: 'Running', toolsUnavailable: true },
  ])
  const m = mount(settingsWindow('plugins', 'classic', f.client), {}, { width: 1180, height: 900 })
  await vi.waitFor(() => expect(m.all('plugin-card')).toHaveLength(1))
  expect(m.q('plugin-state').textContent).toBe('Running')
  expect(m.q('plugin-tools-unavailable').textContent?.trim()).toBe(
    "Agents can't use Chrome right now.",
  )
  expect(m.all('plugin-start-error')).toHaveLength(0)
  expect(m.all('plugin-retry')).toHaveLength(0)
})

it('refreshes tool health on an already open card without another catalogue fetch', async () => {
  const f = fictionalPlugins()
  f.set([{ id: 'chrome', name: 'Chrome', installed: true, state: 'Running' }])
  const original = f.client.request
  const kinds: string[] = []
  let unavailable = false
  f.client.request = async (input) => {
    kinds.push(input.kind)
    if (input.kind === 'status')
      return {
        ok: true,
        cards: [
          {
            id: 'chrome',
            name: 'Chrome',
            installed: true,
            state: 'Running',
            ...(unavailable ? { toolsUnavailable: true as const } : {}),
          },
        ],
      }
    return original(input)
  }
  const m = mount(settingsWindow('plugins', 'classic', f.client), {}, { width: 1180, height: 900 })
  await vi.waitFor(() => expect(m.all('plugin-card')).toHaveLength(1))
  expect(m.all('plugin-tools-unavailable')).toHaveLength(0)
  unavailable = true
  await vi.waitFor(
    () =>
      expect(m.q('plugin-tools-unavailable').textContent?.trim()).toBe(
        "Agents can't use Chrome right now.",
      ),
    { timeout: 7000 },
  )
  expect(m.q('plugin-state').textContent).toBe('Running')
  expect(kinds.filter((kind) => kind === 'list')).toHaveLength(1)
})

it('offers the approved one-click Chrome restart only on the supported degraded card', async () => {
  const f = fictionalPlugins(),
    calls: string[] = []
  f.set([
    Object.assign(
      {
        id: 'chrome',
        name: 'Chrome',
        installed: true,
        state: 'Running' as const,
        toolsUnavailable: true as const,
      },
      { canRestart: true as const },
    ),
  ])
  const original = f.client.request
  f.client.request = async (input) => {
    calls.push(input.kind)
    if (String(input.kind) === 'restart')
      return {
        ok: true,
        cards: [{ id: 'chrome', name: 'Chrome', installed: true, state: 'Running' }],
      }
    return original(input)
  }
  const m = mount(settingsWindow('plugins', 'classic', f.client), {}, { width: 1180, height: 900 })
  await vi.waitFor(() => expect(m.all('plugin-card')).toHaveLength(1))
  expect(m.q('plugin-restart').textContent?.trim()).toBe('Restart Chrome')
  expect(m.q('plugin-restart-note').textContent?.trim()).toBe(
    'Closes the Chrome windows BroCrew opened.',
  )
  m.q('plugin-restart').click()
  await vi.waitFor(() => expect(calls.filter((kind) => kind === 'restart')).toHaveLength(1))
  await vi.waitFor(() => expect(m.all('plugin-tools-unavailable')).toHaveLength(0))
  expect(m.all('plugin-restart')).toHaveLength(0)
  expect(calls).not.toContain('install')
  expect(calls).not.toContain('uninstall')
})

it('finishes Loading plugins before displaying the truthful Running Chrome warning', async () => {
  const f = fictionalPlugins()
  const original = f.client.request
  let answer!: (reply: PluginSettingsReply) => void
  const held = new Promise<PluginSettingsReply>((resolve) => {
    answer = resolve
  })
  f.client.request = (input) => (input.kind === 'list' ? held : original(input))
  const m = mount(settingsWindow('plugins', 'classic', f.client), {}, { width: 1180, height: 900 })
  await nextTick()
  expect(m.q('plugins-list-loading').textContent).toContain('Loading plugins…')
  expect(m.all('plugin-tools-unavailable')).toHaveLength(0)
  answer({
    ok: true,
    cards: [
      { id: 'chrome', name: 'Chrome', installed: true, state: 'Running', toolsUnavailable: true },
    ],
  })
  await vi.waitFor(() => expect(m.all('plugin-card')).toHaveLength(1))
  expect(m.all('plugins-list-loading')).toHaveLength(0)
  expect(m.q('plugins-section').getAttribute('aria-busy')).toBe('false')
  expect(m.q('plugin-state').textContent).toBe('Running')
  expect(m.q('plugin-tools-unavailable').textContent?.trim()).toBe(
    "Agents can't use Chrome right now.",
  )
})

function actionFailures(card: Partial<PluginCard> = {}) {
  const cards: PluginCard[] = [
    {
      id: 'chrome',
      name: 'Chrome',
      installed: true,
      state: card.installed === false ? 'Available' : 'Running',
      ...(card.installed === false ? {} : { installedVersion: '1.0.1', updateVersion: '1.0.2' }),
      ...card,
    },
  ]
  const calls: PluginSettingsRequest[] = []
  const faults = new Map<
    PluginSettingsRequest['kind'],
    (input: PluginSettingsRequest) => PluginSettingsReply | Promise<PluginSettingsReply>
  >()
  const invalidations = new Set<() => void>()
  const closed = new Set<(id: string) => void>()
  const review: PluginWindowReview = {
    id: 'chrome',
    action: cards[0]!.installed ? 'update' : 'install',
    catalogueDigest: 'd'.repeat(64),
    consent: { reviewId: crypto.randomUUID(), displayedDetailsHash: 'b'.repeat(64) },
    details: {
      version: '1.0.2',
      digest: 'a'.repeat(64),
      manifestSha256: 'c'.repeat(64),
      authors: ['fern-makers'],
      permissions: { description: 'Fictional recipes', resources: [] },
    },
    installed: null,
    changes: { authors: true, permissions: true },
  }
  const client: PluginsClient = {
    async request(input) {
      calls.push(input)
      const fault = faults.get(input.kind)
      if (fault) return fault(input)
      return input.kind === 'prepare'
        ? { ok: true, review }
        : { ok: true, cards: cards.map((c) => ({ ...c })) }
    },
    onClosed(listener) {
      closed.add(listener)
      return () => closed.delete(listener)
    },
    onReviewInvalidated(listener) {
      invalidations.add(listener)
      return () => invalidations.delete(listener)
    },
  }
  return { cards, calls, faults, review, client, invalidations, closed }
}
const actionRefused: PluginSettingsReply = {
  ok: false,
  error: 'Plugin unavailable. Try again.',
  detail: 'The fictional owner refused this action.',
  mutationFailure: 'unavailable',
  stack: 'fictional-private-stack',
}

it.each([
  'review-install',
  'review-update',
  'install',
  'update',
  'uninstall',
  'configure',
  'retry',
  'restart',
  'guarded-install',
  'guarded-update',
])(
  'shows the active %s action and public cause instead of silently re-enabling it',
  async (action) => {
    const install =
        action === 'install' || action === 'review-install' || action === 'guarded-install',
      guarded = action.startsWith('guarded'),
      review = action.startsWith('review') || guarded
    const f = actionFailures({
      installed: !install,
      ...(review ? { preparationRequired: true } : {}),
      ...(action === 'retry' ? { state: 'Unavailable' } : {}),
      ...(action === 'restart' ? { toolsUnavailable: true, canRestart: true } : {}),
    })
    const kind = action.startsWith('review')
      ? 'prepare'
      : guarded
        ? install
          ? 'install'
          : 'update'
        : action
    if (
      !['prepare', 'install', 'update', 'uninstall', 'configure', 'retry', 'restart'].includes(kind)
    )
      throw new Error('unexpected action')
    const inputKind = kind as PluginSettingsRequest['kind']
    const m = mount(PluginsSection, { client: f.client })
    await vi.waitFor(() => expect(m.all('plugin-card')).toHaveLength(1))
    if (guarded) {
      m.q(install ? 'plugin-review-install' : 'plugin-review-update').click()
      await vi.waitFor(() => expect(m.all('plugin-review-details')).toHaveLength(1))
    }
    f.faults.set(inputKind, () => actionRefused)
    m.q(guarded ? 'plugin-review-confirm' : `plugin-${action}`).click()
    if (action === 'uninstall') {
      await nextTick()
      m.q('plugin-uninstall-confirm').click()
    }
    await vi.waitFor(() => expect(m.all('plugins-error')).toHaveLength(1))
    const text = m.q('plugins-error').textContent!
    expect(text).toContain("Couldn't")
    expect(text).toContain('Chrome')
    expect(text).toContain('The fictional owner refused this action.')
    expect(text).toContain('Try again')
    expect(text).not.toContain("This change couldn't be confirmed")
    expect(m.host.textContent).not.toContain('fictional-private-stack')
  },
)

it('reports a rejected bridge without exposing the private rejection or replacing it with a consent warning', async () => {
  const f = actionFailures({ state: 'Unavailable' }),
    m = mount(PluginsSection, { client: f.client })
  f.faults.set('retry', () => {
    throw new Error('fictional-private-view-path')
  })
  await vi.waitFor(() => expect(m.all('plugin-retry')).toHaveLength(1))
  m.q('plugin-retry').click()
  await vi.waitFor(() => expect(m.all('plugins-error')).toHaveLength(1))
  expect(m.q('plugins-error').textContent).toContain('Settings request failed')
  expect(m.q('plugins-error').textContent).toContain('Try again')
  expect(m.host.textContent).not.toContain('fictional-private-view-path')
})

it.each(['retry', 'restart'] as const)(
  'reports an unchanged degraded status after %s',
  async (action) => {
    const f = actionFailures(
        action === 'retry'
          ? { state: 'Unavailable' }
          : { toolsUnavailable: true, canRestart: true },
      ),
      m = mount(PluginsSection, { client: f.client })
    await vi.waitFor(() => expect(m.all(`plugin-${action}`)).toHaveLength(1))
    m.q(`plugin-${action}`).click()
    await vi.waitFor(() => expect(m.all('plugins-error')).toHaveLength(1))
    expect(m.q('plugins-error').textContent).toContain(
      action === 'retry' ? 'start Chrome again' : 'after the restart request',
    )
    expect(m.all('plugin-install')).toHaveLength(0)
  },
)

it('does not install after a failed prerequisite close', async () => {
  const f = actionFailures({ installed: false }),
    m = mount(PluginsSection, { client: f.client })
  f.faults.set('close', () => actionRefused)
  await vi.waitFor(() => expect(m.all('plugin-install')).toHaveLength(1))
  m.q('plugin-install').click()
  await vi.waitFor(() => expect(m.all('plugins-error')).toHaveLength(1))
  expect(m.q('plugins-error').textContent).toContain('close')
  expect(m.q('plugins-error').textContent).toContain('The fictional owner refused this action.')
  expect(f.calls.filter((c) => c.kind === 'install')).toHaveLength(0)
  expect(m.q('plugin-install').hasAttribute('disabled')).toBe(false)
  f.faults.delete('close')
})

it.each(['configuration', 'review'])(
  'reports an active failed %s close, but ignores the same failure after replacement',
  async (view) => {
    const f = actionFailures({ preparationRequired: true }),
      m = mount(PluginsSection, { client: f.client })
    await vi.waitFor(() => expect(m.all('plugin-card')).toHaveLength(1))
    const open = async () => {
      m.q(view === 'configuration' ? 'plugin-configure' : 'plugin-review-update').click()
      await vi.waitFor(() =>
        expect(
          m.all(view === 'configuration' ? 'plugin-stage' : 'plugin-review-details'),
        ).toHaveLength(1),
      )
    }
    await open()
    f.faults.set('close', () => actionRefused)
    m.q(view === 'configuration' ? 'plugin-close' : 'plugin-review-cancel').click()
    await vi.waitFor(() => expect(m.all('plugins-error')).toHaveLength(1))
    expect(m.q('plugins-error').textContent).toContain('close')
    let finish!: (reply: PluginSettingsReply) => void
    f.faults.delete('close')
    await open()
    f.faults.set(
      'close',
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    m.q(view === 'configuration' ? 'plugin-close' : 'plugin-review-cancel').click()
    await nextTick()
    await open()
    finish(actionRefused)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    expect(m.all('plugins-error')).toHaveLength(0)
    expect(m.all(view === 'configuration' ? 'plugin-stage' : 'plugin-review-details')).toHaveLength(
      1,
    )
    f.faults.delete('close')
  },
)

it('preserves the active bounds failure and a failed cleanup close without losing either cause', async () => {
  const f = actionFailures(),
    m = mount(PluginsSection, { client: f.client })
  await vi.waitFor(() => expect(m.all('plugin-configure')).toHaveLength(1))
  m.q('plugin-configure').click()
  await vi.waitFor(() => expect(f.calls.some((c) => c.kind === 'configure')).toBe(true))
  await vi.waitFor(() => expect(m.q('plugin-stage').getAttribute('aria-busy')).toBe('false'))
  f.faults.set('bounds', () => actionRefused)
  f.faults.set('close', () => ({
    ok: false,
    error: 'Plugin unavailable. Try again.',
    detail: 'The fictional page could not close.',
  }))
  window.dispatchEvent(new Event('resize'))
  await vi.waitFor(() => expect(m.all('plugins-error')).toHaveLength(1))
  await vi.waitFor(() =>
    expect(m.q('plugins-error').textContent).toContain('The fictional page could not close.'),
  )
  expect(m.q('plugins-error').textContent).toContain('The fictional owner refused this action.')
  expect(m.q('plugins-error').textContent).toContain('resize')
  f.faults.delete('close')
})

it('reports an externally invalidated review without restoring late consent or failures', async () => {
  const f = actionFailures({ preparationRequired: true }),
    m = mount(PluginsSection, { client: f.client })
  let finish!: (reply: PluginSettingsReply) => void
  f.faults.set(
    'prepare',
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  await vi.waitFor(() => expect(m.all('plugin-review-update')).toHaveLength(1))
  m.q('plugin-review-update').click()
  await vi.waitFor(() => expect(f.calls.some((c) => c.kind === 'prepare')).toBe(true))
  for (const invalidate of f.invalidations) invalidate()
  finish({ ok: true, review: f.review })
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  expect(m.all('plugin-review-details')).toHaveLength(0)
  expect(m.q('plugins-error').textContent).toContain('review is no longer current')
  expect(m.q('plugins-error').textContent).toContain('Review it again')
  expect(m.q('plugin-review-update').hasAttribute('disabled')).toBe(false)
  m.q('plugin-review-update').click()
  await nextTick()
  m.unmount()
  finish(actionRefused)
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  expect(m.host.textContent).toBe('')
  expect(f.invalidations.size).toBe(0)
  expect(f.closed.size).toBe(0)
})

it.each([
  ['network', "Couldn't download this plugin. Check your connection and try again."],
  ['download-stalled', 'The plugin download stalled. Try again.'],
  [
    'package-invalid',
    "Couldn't verify this plugin package. Download it again or contact its publisher.",
  ],
] as const)(
  'shows the public %s cause once when the producer supplies that same detail',
  async (mutationFailure, detail) => {
    const f = actionFailures({ preparationRequired: true }),
      m = mount(PluginsSection, { client: f.client })
    f.faults.set('prepare', () => ({
      ok: false,
      error: 'Plugin unavailable. Try again.',
      detail,
      mutationFailure,
    }))
    await vi.waitFor(() => expect(m.all('plugin-review-update')).toHaveLength(1))
    m.q('plugin-review-update').click()
    await vi.waitFor(() => expect(m.all('plugins-error')).toHaveLength(1))
    const text = m.q('plugins-error').textContent!
    expect(text).toContain('review update of Chrome')
    expect(text.split(detail)).toHaveLength(2)
  },
)

it('reports a missing reply for the current clicked action', async () => {
  const f = actionFailures({ state: 'Unavailable' }),
    m = mount(PluginsSection, { client: f.client })
  f.faults.set('retry', () => undefined as unknown as PluginSettingsReply)
  await vi.waitFor(() => expect(m.all('plugin-retry')).toHaveLength(1))
  m.q('plugin-retry').click()
  await vi.waitFor(() => expect(m.all('plugins-error')).toHaveLength(1))
  expect(m.q('plugins-error').textContent).toContain('did not return a reply')
  expect(m.q('plugins-error').textContent).toContain('start Chrome again')
  expect(m.q('plugin-retry').hasAttribute('disabled')).toBe(false)
})

it('keeps an old pre-close failure from installing or showing an error after unmount', async () => {
  const f = actionFailures({ installed: false }),
    m = mount(PluginsSection, { client: f.client })
  const finishes: ((reply: PluginSettingsReply) => void)[] = []
  f.faults.set('close', () => new Promise((resolve) => finishes.push(resolve)))
  await vi.waitFor(() => expect(m.all('plugin-install')).toHaveLength(1))
  m.q('plugin-install').click()
  await vi.waitFor(() => expect(finishes).toHaveLength(1))
  m.unmount()
  finishes[0]!(actionRefused)
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  expect(f.calls.filter((c) => c.kind === 'install')).toHaveLength(0)
  expect(m.host.textContent).toBe('')
  f.faults.delete('close')
})

it('keeps the mutation cause visible when its follow-up catalogue refresh also fails', async () => {
  const f = actionFailures({ preparationRequired: true }),
    m = mount(PluginsSection, { client: f.client })
  await vi.waitFor(() => expect(m.all('plugin-review-update')).toHaveLength(1))
  m.q('plugin-review-update').click()
  await vi.waitFor(() => expect(m.all('plugin-review-details')).toHaveLength(1))
  f.faults.set('update', () => actionRefused)
  f.faults.set('list', () => ({ ok: false, listState: 'fetch-error' }))
  m.q('plugin-review-confirm').click()
  await vi.waitFor(() =>
    expect(m.q('plugins-error').textContent).toContain('The fictional owner refused this action.'),
  )
  await vi.waitFor(() =>
    expect(m.q('plugins-error').textContent).toContain('plugin list could not be refreshed'),
  )
  expect(m.all('plugin-review-details')).toHaveLength(0)
  expect(f.calls.filter((c) => c.kind === 'update')).toHaveLength(1)
})
