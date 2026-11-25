import { defineComponent, h, nextTick, provide, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import UpdatesMenu from '../../src/renderer/src/components/UpdatesMenu.vue'
import { provideOverlayLayer } from '../../src/renderer/src/components/OverlayHost.vue'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import { forgetUpdates } from '../../src/renderer/src/composables/useUpdates'
import type { UpdateState, UpdatesSnapshot } from '../../src/shared/updates'
import { mount, unmountAll } from './harness'

const snapshotOf = (state: UpdateState, over: Partial<UpdatesSnapshot> = {}): UpdatesSnapshot => ({
  version: '0.1.0',
  checkAutomatically: true,
  state,
  ...over,
})

const api = (): { api?: Record<string, unknown> } =>
  window as unknown as { api?: Record<string, unknown> }

function fakeUpdates(first: UpdatesSnapshot) {
  let listener: ((next: UpdatesSnapshot) => void) | null = null
  const stopped = vi.fn()
  const answer = (next: UpdatesSnapshot) => vi.fn(async () => next)
  const fake = {
    read: answer(first),
    checkNow: answer(snapshotOf({ kind: 'checking' })),
    set: vi.fn(async (change: Partial<UpdatesSnapshot>) => ({ ...first, ...change })),
    download: answer(snapshotOf({ kind: 'downloading', version: '0.2.0', percent: 0 })),
    restartPlan: vi.fn(async () => [
      { path: '/default', name: 'Default' },
      { path: '/bakery', name: 'Bakery' },
      { path: '/planning', name: 'Planning' },
    ]),
    restartNow: answer(first),
    restartWhenQuiet: answer(first),
    cancelRestart: answer(
      snapshotOf({ kind: 'ready', version: '0.2.0', how: 'restart', path: null }),
    ),
    onChanged: vi.fn((next: (snapshot: UpdatesSnapshot) => void) => {
      listener = next
      return stopped
    }),
    stopped,
    tell: (next: UpdatesSnapshot) => listener?.(next),
  }
  api().api = {
    updates: fake,
    runtime: { listResumable: async () => [], listUnresumable: async () => [] },
  }
  return fake
}

afterEach(() => {
  unmountAll()
  forgetUpdates()
  delete api().api
})

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

const text = (element: Element | null): string =>
  element?.textContent?.replace(/\s+/g, ' ').trim() ?? ''

async function menuIn(state: UpdateState, over: Partial<UpdatesSnapshot> = {}) {
  const fake = fakeUpdates(snapshotOf(state, over))
  const m = mount(UpdatesMenu, {}, { width: 300, height: 400 })
  await settle()
  return { m, fake }
}

it('uses each injected desktop client’s updates and preserves the method receiver', async () => {
  const idle = { kind: 'idle', checkedAt: null, upToDate: false } as const
  const first = fakeUpdates(snapshotOf(idle, { version: '0.1.1' }))
  const second = fakeUpdates(snapshotOf(idle, { version: '0.1.2' }))
  const noProvider = (): never => {
    throw new Error('Unexpected provider read')
  }
  function menuWith(updates: ReturnType<typeof fakeUpdates>) {
    const client = {
      ...createDesktopProviderApi(noProvider, () => undefined),
      desktop: { updates, chooseCwd: noProvider, chooseBundle: noProvider, getAppInfo: noProvider },
    }
    return mount(
      defineComponent({
        setup() {
          provide(CLIENT_PROVIDERS, client)
          return () => h(UpdatesMenu)
        },
      }),
      {},
      { width: 300, height: 400 },
    )
  }

  const one = menuWith(first)
  const two = menuWith(second)
  await settle()
  expect(text(one.q('updates-version'))).toBe('BroCrew 0.1.1')
  expect(text(two.q('updates-version'))).toBe('BroCrew 0.1.2')
  two.q('updates-check').click()
  await settle()
  expect(first.checkNow).not.toHaveBeenCalled()
  expect(second.checkNow).toHaveBeenCalledOnce()
  expect(second.checkNow.mock.contexts[0]).toBe(second)
})

describe('B2 · the menu, state by state', () => {
  it('⚑ the version, always', async () => {
    const { m } = await menuIn({ kind: 'idle', checkedAt: null, upToDate: false })
    expect(text(m.q('updates-version'))).toBe('BroCrew 0.1.0')
  })

  it('🔴 not-here · a development build says so in one quiet line, with no buttons and no switches', async () => {
    const { m } = await menuIn({ kind: 'not-here', why: 'a-development-build' })
    expect(text(m.q('updates-not-here'))).toBe('Updates aren’t available in this build.')
    expect(m.host.querySelectorAll('button, input')).toHaveLength(0)
  })

  it('⚑ not-here · a build with no place to check says that', async () => {
    const { m } = await menuIn({ kind: 'not-here', why: 'no-release-feed' })
    expect(text(m.q('updates-not-here'))).toContain('built without a place to check for updates')
    expect(m.host.querySelectorAll('button, input')).toHaveLength(0)
  })

  it('🔴 idle · up to date, when it last looked, and Check for updates reaches the bridge', async () => {
    const at = new Date(2026, 9, 3, 14, 5).getTime()
    const { m, fake } = await menuIn({ kind: 'idle', checkedAt: at, upToDate: true })
    expect(text(m.q('updates-said'))).toMatch(/^Up to date · checked at /)
    ;(m.q('updates-check') as HTMLButtonElement).click()
    await settle()
    expect(fake.checkNow).toHaveBeenCalledTimes(1)
    expect(text(m.q('updates-said'))).toBe('Checking…')
  })

  it('⚑ idle · never checked says so', async () => {
    const { m } = await menuIn({ kind: 'idle', checkedAt: null, upToDate: false })
    expect(text(m.q('updates-said'))).toBe('Not checked yet.')
  })

  it('🔴 available · the version offered, and Download reaches the bridge', async () => {
    const { m, fake } = await menuIn({ kind: 'available', version: '0.2.0' })
    expect(text(m.q('updates-said'))).toBe('BroCrew 0.2.0 is available.')
    ;(m.q('updates-download') as HTMLButtonElement).click()
    await settle()
    expect(fake.download).toHaveBeenCalledTimes(1)
    expect(text(m.q('updates-said'))).toBe('Downloading BroCrew 0.2.0 · 0%')
  })

  it('⚑ downloading · its progress, moved by what the app tells', async () => {
    const { m, fake } = await menuIn({ kind: 'downloading', version: '0.2.0', percent: 12 })
    expect(text(m.q('updates-said'))).toBe('Downloading BroCrew 0.2.0 · 12%')
    fake.tell(snapshotOf({ kind: 'downloading', version: '0.2.0', percent: 57 }))
    await settle()
    expect(text(m.q('updates-said'))).toBe('Downloading BroCrew 0.2.0 · 57%')
    expect((m.q('updates-progress') as HTMLProgressElement).value).toBe(57)
  })

  it('🔴 ready on Windows · Restart to update reaches the bridge', async () => {
    const { m, fake } = await menuIn({
      kind: 'ready',
      version: '0.2.0',
      how: 'restart',
      path: null,
    })
    expect(text(m.q('updates-said'))).toBe('BroCrew 0.2.0 is ready.')
    ;(m.q('updates-restart') as HTMLButtonElement).click()
    await settle()
    expect(fake.restartWhenQuiet).toHaveBeenCalledTimes(1)
  })

  it('confirms every affected workspace before updating, and Cancel leaves agents running', async () => {
    const { m, fake } = await menuIn(
      { kind: 'ready', version: '0.2.0', how: 'restart', path: null },
      { updateNow: true },
    )
    const click = (cy: string) => {
      const button = document.querySelector<HTMLButtonElement>(`[data-cy="${cy}"]`)
      expect(button).not.toBeNull()
      button!.click()
    }
    expect(text(m.q('updates-restart'))).toBe('Update now')
    click('updates-restart')
    await settle()
    expect(fake.restartPlan).toHaveBeenCalledTimes(1)
    expect(fake.restartNow).not.toHaveBeenCalled()
    expect(
      [...document.querySelectorAll('[data-cy="updates-confirm-workspaces"] li')].map(text),
    ).toEqual(['Default', 'Bakery', 'Planning'])
    click('updates-confirm-cancel')
    await settle()
    expect(document.querySelector('[data-cy="updates-confirm-now"]')).toBeNull()
    expect(fake.restartNow).not.toHaveBeenCalled()
    click('updates-restart')
    await settle()
    click('updates-confirm-now')
    await settle()
    expect(fake.restartNow).toHaveBeenCalledTimes(1)
    expect(fake.restartWhenQuiet).not.toHaveBeenCalled()
  })

  it('🔴 waiting to restart · what still runs, in words, other BroBots, and Cancel', async () => {
    const { m, fake } = await menuIn({
      kind: 'waiting-to-restart',
      version: '0.2.0',
      stops: {
        conversations: [
          {
            conversation: 's1',
            name: 'Ada',
            turnRunning: true,
            waitingOnAPerson: false,
            heldMessages: 2,
            inTheBackground: 1,
          },
          {
            conversation: 's2',
            name: 'Ali',
            turnRunning: false,
            waitingOnAPerson: true,
            heldMessages: 0,
            inTheBackground: 0,
          },
        ],
        otherWorkspaces: 1,
      },
    })
    expect(text(m.q('updates-said'))).toBe(
      'BroCrew restarts to update to 0.2.0 once nothing is running.',
    )
    expect([...m.q('updates-stops').querySelectorAll('li')].map(text)).toEqual([
      'Ada: a turn is running, 2 held messages, 1 running in the background',
      'Ali: waiting on a person',
    ])
    expect(text(m.q('updates-others'))).toContain('Another BroCrew is open')
    ;(m.q('updates-cancel') as HTMLButtonElement).click()
    await settle()
    expect(fake.cancelRestart).toHaveBeenCalledTimes(1)
  })

  it('⚑ waiting to restart · other BroBots not known yet says when they are looked for', async () => {
    const { m } = await menuIn({
      kind: 'waiting-to-restart',
      version: '0.2.0',
      stops: { conversations: [], otherWorkspaces: null },
    })
    expect(text(m.q('updates-others'))).toContain('Waits until nothing is running')
  })

  it('🔴 error · its message, plainly, and Check again', async () => {
    const { m, fake } = await menuIn({
      kind: 'error',
      message: 'The update could not be read from GitHub.',
      at: 0,
    })
    expect(text(m.q('updates-said'))).toBe('The update could not be read from GitHub.')
    expect(text(m.q('updates-check'))).toBe('Check again')
    ;(m.q('updates-check') as HTMLButtonElement).click()
    await settle()
    expect(fake.checkNow).toHaveBeenCalledTimes(1)
  })

  it('🔴 the switch: check automatically (on), reaching the bridge', async () => {
    const { m, fake } = await menuIn({ kind: 'idle', checkedAt: null, upToDate: false })
    const automatically = m.q('updates-automatically') as HTMLInputElement
    expect(automatically.checked).toBe(true)
    automatically.click()
    await settle()
    expect(fake.set).toHaveBeenLastCalledWith({ checkAutomatically: false })
  })
})

describe('B2 · the footer opens it', () => {
  const rail = async (state: UpdateState) => {
    fakeUpdates(snapshotOf(state))
    const r = mount(
      SideRail,
      {
        open: [],
        activeId: null,
        place: null,
        workspaceFolder: { name: 'Default', path: '/somewhere', isDefault: true },
      },
      { width: 251.68 },
    )
    await settle()
    return r
  }

  it('🔴 a press opens the menu, Esc closes it and gives focus back to the footer', async () => {
    const r = await rail({ kind: 'not-here', why: 'a-development-build' })
    const footer = r.q('rail-version') as HTMLButtonElement
    expect(r.all('updates-menu')).toHaveLength(0)
    footer.click()
    await settle()
    expect(footer.getAttribute('aria-expanded')).toBe('true')
    expect(text(r.q('updates-version'))).toBe('BroCrew 0.1.0')
    expect(getComputedStyle(r.q('updates-menu')).position).toBe('absolute')
    // ⚑ A development build's menu has no control: the menu itself takes focus, so Esc reaches it.
    expect(document.activeElement).toBe(r.q('updates-menu'))
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )
    await settle()
    expect(r.all('updates-menu')).toHaveLength(0)
    expect(document.activeElement).toBe(footer)
  })

  it('keeps the footer menu open while a portaled confirmation owns Escape and pointer presses', async () => {
    const fake = fakeUpdates(
      snapshotOf(
        { kind: 'ready', version: '0.2.0', how: 'restart', path: null },
        { updateNow: true },
      ),
    )
    const fixture = defineComponent({
      setup() {
        const overlay = ref<HTMLElement | null>(null)
        provideOverlayLayer(overlay)
        return () =>
          h('div', [
            h(SideRail, {
              open: [],
              activeId: null,
              place: null,
              workspaceFolder: { name: 'Default', path: '/somewhere', isDefault: true },
            }),
            h('div', { ref: overlay }),
          ])
      },
    })
    const r = mount(fixture, {}, { width: 300 })
    await settle()
    ;(r.q('rail-version') as HTMLButtonElement).click()
    await settle()
    ;(r.q('updates-restart') as HTMLButtonElement).click()
    await settle()
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )
    await settle()
    expect(r.all('updates-menu')).toHaveLength(1)
    expect(document.querySelector('[data-cy="updates-confirm-now"]')).toBeNull()
    ;(r.q('updates-restart') as HTMLButtonElement).click()
    await settle()
    const button = document.querySelector<HTMLButtonElement>('[data-cy="updates-confirm-now"]')!
    expect(button).not.toBeNull()
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await nextTick()
    expect(document.querySelector('[data-cy="updates-confirm-now"]')).toBe(button)
    button.click()
    await settle()
    expect(fake.restartNow).toHaveBeenCalledTimes(1)
  })

  it('⚑ Esc closes it from wherever focus went after a press', async () => {
    const r = await rail({ kind: 'available', version: '0.2.0' })
    ;(r.q('rail-version') as HTMLButtonElement).click()
    await settle()
    ;(r.q('updates-download') as HTMLButtonElement).click()
    await settle()
    ;(document.activeElement as HTMLElement | null)?.blur()
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    expect(r.all('updates-menu')).toHaveLength(0)
  })

  it('an offered update puts a dot on the version control; none does not', async () => {
    expect(
      (await rail({ kind: 'available', version: '0.2.0' })).all('rail-update-dot'),
    ).toHaveLength(1)
    unmountAll()
    forgetUpdates()
    expect(
      (await rail({ kind: 'idle', checkedAt: null, upToDate: true })).all('rail-update-dot'),
    ).toHaveLength(0)
  })
})

describe('the window’s one updates listener', () => {
  it('outlives the menus that read it, and is let go when the window’s holder is', async () => {
    const { m, fake } = await menuIn({ kind: 'idle', checkedAt: null, upToDate: false })
    m.unmount()
    const again = mount(UpdatesMenu, {}, { width: 300, height: 400 })
    await settle()
    fake.tell(snapshotOf({ kind: 'available', version: '0.2.0' }))
    await settle()
    expect(text(again.q('updates-said'))).toBe('BroCrew 0.2.0 is available.')
    expect(fake.onChanged).toHaveBeenCalledTimes(1)
    expect(fake.stopped).not.toHaveBeenCalled()

    forgetUpdates()
    expect(fake.stopped).toHaveBeenCalledTimes(1)
  })
})
