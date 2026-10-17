import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h, nextTick, ref } from 'vue'
import SessionDrawer from '../../src/renderer/src/components/SessionDrawer.vue'
import SessionHeader from '../../src/renderer/src/components/SessionHeader.vue'
import { DRAWER_TABS, type DrawerTab } from '../../src/renderer/src/lib/drawer'
import type { WorkGivenOutReading } from '../../src/renderer/src/lib/work-given-out'
import { applyEvent, createTranscript } from '../../src/renderer/src/lib/transcript'
import type { WorkGivenOut } from '../../src/shared/tasks'
import { META, drawerProps, mount, unmountAll } from './harness'

/**
 * The panel toggle and the drawer's tab strip, as a person using a screen reader or only a
 * keyboard meets them: what each is called, how many Tab stops the strip has, which keys move
 * through it, and which panel a tab belongs to.
 */

afterEach(unmountAll)

const Harness = defineComponent({
  props: {
    start: { type: String, default: 'open' },
    extra: { type: Object, default: () => ({}) },
  },
  setup(p) {
    const tab = ref<DrawerTab>(p.start as DrawerTab)
    return () =>
      h(SessionDrawer as never, {
        ...drawerProps({ tab: tab.value, ...p.extra }),
        'onUpdate:tab': (next: DrawerTab) => {
          tab.value = next
        },
      })
  },
})

const header = (over: Record<string, unknown>) =>
  mount(SessionHeader, {
    session: META,
    status: 'idle',
    debug: false,
    facets: { doing: 'idle' as const, being: 'live' as const },
    ...over,
  })

const tabs = (host: HTMLElement): HTMLElement[] => [
  ...host.querySelectorAll<HTMLElement>('[role="tab"]'),
]

const press = (el: HTMLElement, key: string): void => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}

const workRow = (): WorkGivenOut => ({
  piece: 'work_one',
  label: 'W1.4',
  title: 'read the brief',
  state: 'working',
  givenToProfile: 'worker',
  givenAt: 8_000_000,
})

const reading = (rows: readonly WorkGivenOut[]): WorkGivenOutReading => ({
  conversation: META.sessionId,
  walk: {
    rows,
    walk: 'every-conversation-this-one-gave-work-to',
    ledgers: rows.length,
    rowsUnread: 0,
  },
  answered: true,
  at: 9_000_000,
})

const twoFilesChanged = () => {
  const state = createTranscript()
  applyEvent(state, {
    type: 'file_change',
    source: 'turn/diff/updated',
    changes: [
      { path: 'a.ts', status: 'modified', added: 1, removed: 0 },
      { path: 'b.ts', status: 'modified', added: 2, removed: 1 },
    ],
  } as never)
  return state
}

describe('the panel toggle is named by what it does and how many are waiting', () => {
  it('says its action and the count, and the drawn count is not read a second time', () => {
    const m = header({ waiting: 3, drawerOpen: false })
    const toggle = m.q('toggle-session-panel')
    expect(toggle.getAttribute('aria-label')).toBe('Show or hide the panel, 3 waiting on you')
    expect(m.q('session-panel-badge').getAttribute('aria-hidden')).toBe('true')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    // The name it is announced with is the label, not the badge digit.
    const named = page.getByRole('button', { name: 'Show or hide the panel, 3 waiting on you' })
    expect(named.elements()).toEqual([toggle])
  })

  it('has the plain action name when nothing is waiting, and no badge', () => {
    const m = header({ waiting: 0, drawerOpen: true })
    expect(m.q('toggle-session-panel').getAttribute('aria-label')).toBe('Show or hide the panel')
    expect(m.all('session-panel-badge')).toHaveLength(0)
  })
})

describe('the drawer tab strip follows the tabs pattern', () => {
  it('names each tab, with the count it draws, and hides the drawn counts and dot', async () => {
    const m = mount(
      Harness,
      {
        start: 'info',
        extra: { waiting: 2, state: twoFilesChanged(), work: reading([workRow()]) },
      },
      { width: 380, height: 700 },
    )
    const name = (id: string): string | null => m.q(`drawer-tab-${id}`).getAttribute('aria-label')
    expect(name('open')).toBe('Open, waiting on you')
    expect(name('info')).toBe('Info')
    expect(name('changes')).toBe('Changes, 2 files')
    expect(name('work')).toBe('Work, 1 open')
    for (const hook of ['drawer-tab-attention', 'drawer-tab-count', 'drawer-tab-work-count']) {
      expect(m.q(hook).getAttribute('aria-hidden'), hook).toBe('true')
    }
    // Control: with nothing drawn on them the names are the bare words.
    const quiet = mount(Harness, { start: 'info' }, { width: 380, height: 700 })
    expect(quiet.q('drawer-tab-open').getAttribute('aria-label')).toBe('Open')
    expect(quiet.q('drawer-tab-changes').getAttribute('aria-label')).toBe('Changes')
    expect(quiet.q('drawer-tab-work').getAttribute('aria-label')).toBe('Work')
  })

  it('has one Tab stop, on the selected tab, and it moves with the selection', async () => {
    const m = mount(Harness, { start: 'info' }, { width: 380, height: 700 })
    const stops = (): string[] =>
      tabs(m.host)
        .filter((el) => el.tabIndex === 0)
        .map((el) => el.dataset.cy ?? '')
    expect(stops()).toEqual(['drawer-tab-info'])
    expect(tabs(m.host).length).toBeGreaterThan(1)
    m.q('drawer-tab-events').click()
    await nextTick()
    expect(stops()).toEqual(['drawer-tab-events'])
  })

  it('Arrow, Home and End move focus and selection, wrapping at the ends', async () => {
    const m = mount(Harness, { start: 'open' }, { width: 380, height: 700 })
    const ids = DRAWER_TABS.map((entry) => entry.id)
    const selected = (): string | undefined =>
      m.host.querySelector<HTMLElement>('[data-active="true"]')?.dataset.cy
    const focused = (): string | undefined =>
      (document.activeElement as HTMLElement | null)?.dataset?.cy

    m.q('drawer-tab-open').focus()
    press(m.q('drawer-tab-open'), 'ArrowRight')
    await nextTick()
    expect(selected()).toBe(`drawer-tab-${ids[1]}`)
    expect(focused()).toBe(`drawer-tab-${ids[1]}`)

    press(m.q(`drawer-tab-${ids[1]}`), 'ArrowLeft')
    await nextTick()
    expect(selected()).toBe(`drawer-tab-${ids[0]}`)

    press(m.q(`drawer-tab-${ids[0]}`), 'ArrowLeft')
    await nextTick()
    expect(selected()).toBe(`drawer-tab-${ids[ids.length - 1]}`)

    press(m.q(`drawer-tab-${ids[ids.length - 1]}`), 'ArrowRight')
    await nextTick()
    expect(selected()).toBe(`drawer-tab-${ids[0]}`)

    press(m.q(`drawer-tab-${ids[0]}`), 'End')
    await nextTick()
    expect(selected()).toBe(`drawer-tab-${ids[ids.length - 1]}`)
    expect(focused()).toBe(`drawer-tab-${ids[ids.length - 1]}`)

    press(m.q(`drawer-tab-${ids[ids.length - 1]}`), 'Home')
    await nextTick()
    expect(selected()).toBe(`drawer-tab-${ids[0]}`)

    // Control: a key the pattern does not use leaves the selection and is not swallowed.
    const other = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true })
    m.q(`drawer-tab-${ids[0]}`).dispatchEvent(other)
    await nextTick()
    expect(other.defaultPrevented).toBe(false)
    expect(selected()).toBe(`drawer-tab-${ids[0]}`)
  })

  it('a real Tab from the strip leaves it rather than stepping through every tab', async () => {
    const m = mount(Harness, { start: 'info' }, { width: 380, height: 700 })
    m.q('drawer-tab-info').focus()
    await userEvent.tab()
    expect(m.q('drawer-tabs').contains(document.activeElement)).toBe(false)
  })

  it('links each tab to the one panel, and the panel back to the selected tab', async () => {
    const m = mount(Harness, { start: 'open' }, { width: 380, height: 700 })
    const panel = m.host.querySelector<HTMLElement>('[role="tabpanel"]')!
    expect(panel).not.toBeNull()
    expect(panel.id).not.toBe('')
    for (const tab of tabs(m.host)) {
      expect(tab.id).not.toBe('')
      expect(tab.getAttribute('aria-controls')).toBe(panel.id)
    }
    const labelledBy = (): string | null => panel.getAttribute('aria-labelledby')
    expect(labelledBy()).toBe(m.q('drawer-tab-open').id)
    m.q('drawer-tab-info').click()
    await nextTick()
    expect(labelledBy()).toBe(m.q('drawer-tab-info').id)
    expect(document.getElementById(labelledBy()!)?.dataset.cy).toBe('drawer-tab-info')
  })

  it('a hidden selected tab leaves the first tab as the stop and the label', () => {
    const m = mount(
      Harness,
      { start: 'events', extra: { hiddenTabs: ['events'] } },
      { width: 380, height: 700 },
    )
    const first = tabs(m.host)[0]!
    expect(first.tabIndex).toBe(0)
    expect(tabs(m.host).filter((el) => el.tabIndex === 0)).toHaveLength(1)
    expect(m.host.querySelector('[role="tabpanel"]')!.getAttribute('aria-labelledby')).toBe(
      first.id,
    )
  })
})
