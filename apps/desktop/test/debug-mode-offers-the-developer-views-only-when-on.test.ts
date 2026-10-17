import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFAULT_TAB, DRAWER_TABS, type DrawerTab } from '../src/renderer/src/lib/drawer'
import {
  DEVELOPER_TABS,
  hiddenDrawerTabs,
  offeredTab,
} from '../src/renderer/src/lib/developer-views'

/**
 * # W4.13 · Debug mode — the side panel's developer views, offered only while it is on (`714955ca`)
 *
 * ⚑ Off by default: the Events tab is not drawn, and a panel on it (now, or kept from a run with it
 * on) moves to the panel's default tab. On: the tab is back. The rule is `lib/developer-views.ts`;
 * `RuntimeScreen.vue` (the whole app, mounted by no test) applies it in two places, pinned below.
 * The switch itself, its storage and the drawer's strip are driven in
 * `dom/the-providers-screen-samples-only-while-looked-at.dom.test.ts`.
 */

const HERE = dirname(fileURLToPath(import.meta.url))

describe('714955ca · which side-panel tabs debug mode hides', () => {
  it('🔴 off hides every developer tab, on hides none', () => {
    expect(hiddenDrawerTabs(false)).toEqual(['events'])
    expect(hiddenDrawerTabs(true)).toEqual([])
  })

  it('⛔ a developer tab is a real tab, and never the default the panel falls back to', () => {
    const ids = DRAWER_TABS.map((tab) => tab.id) as DrawerTab[]
    for (const tab of DEVELOPER_TABS) expect(ids).toContain(tab)
    // ⚠️ A hidden default would send the panel from one hidden tab to another.
    expect(DEVELOPER_TABS).not.toContain(DEFAULT_TAB)
    expect(hiddenDrawerTabs(false)).not.toContain(DEFAULT_TAB)
  })
})

describe('714955ca · the tab the panel is on', () => {
  it('🔴 a hidden tab asked for lands on the default; an offered one is kept', () => {
    const off = hiddenDrawerTabs(false)
    expect(offeredTab('events', off)).toBe(DEFAULT_TAB)
    // ⚑ The control on the same hidden list: any other tab is left where it is.
    expect(offeredTab('info', off)).toBe('info')
    expect(offeredTab(DEFAULT_TAB, off)).toBe(DEFAULT_TAB)
  })

  it('⚑ with debug mode on, Events is a tab like any other', () => {
    expect(offeredTab('events', hiddenDrawerTabs(true))).toBe('events')
  })

  it('⚑ every tab the drawer has: hidden ones go to the default, the rest stay', () => {
    const off = hiddenDrawerTabs(false)
    for (const { id } of DRAWER_TABS) {
      expect(offeredTab(id, off), id).toBe(off.includes(id) ? DEFAULT_TAB : id)
      expect(offeredTab(id, []), id).toBe(id)
    }
  })
})

/**
 * ⚑ **The two places the rule is applied, as source** — `RuntimeScreen` is the whole app and no test
 * mounts it (`build-identity.test.ts`' reason for its own pins). A stored tab from a run with debug
 * mode on, and a panel's own request for a tab, both go through `offeredTab`.
 */
describe('714955ca · RuntimeScreen applies it to the stored tab and to the panel’s request', () => {
  const screen = readFileSync(
    join(HERE, '..', 'src', 'renderer', 'src', 'components', 'RuntimeScreen.vue'),
    'utf8',
  )

  it('🔴 the stored tab is moved off a hidden one at once, and whenever debug mode changes', () => {
    expect(screen).toMatch(
      /const hiddenTabs = computed\(\(\) => hiddenDrawerTabs\(debugMode\.value\)\)/,
    )
    expect(screen).toMatch(
      /watch\(\s*\[drawerTab, hiddenTabs\],[\s\S]{0,120}?drawerTab\.value = offeredTab\(tab, hidden\)[\s\S]{0,40}?\{ immediate: true \}/,
    )
  })

  it('🔴 the panel’s request for a tab is refused for a hidden one, and the panel is told which are hidden', () => {
    expect(screen).toMatch(
      /@update:drawer-tab="\(tab\) => \(drawerTab = offeredTab\(tab, hiddenTabs\)\)"/,
    )
    expect(screen).toMatch(/:hidden-drawer-tabs="hiddenTabs"/)
    // ⛔ The old, unguarded hand-over is gone.
    expect(screen).not.toMatch(/@update:drawer-tab="\(tab\) => \(drawerTab = tab\)"/)
  })
})
