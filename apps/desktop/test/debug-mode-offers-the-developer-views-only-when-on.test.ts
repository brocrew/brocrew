import { describe, expect, it } from 'vitest'
import { DEFAULT_TAB, DRAWER_TABS, type DrawerTab } from '../src/renderer/src/lib/drawer'
import {
  DEVELOPER_TABS,
  hiddenDrawerTabs,
  offeredTab,
} from '../src/renderer/src/lib/developer-views'

/**
 * Debug mode: the side panel's developer views, offered only while it is on.
 *
 * Off by default: the Events tab is not drawn, and a panel on it (now, or kept from a run with it
 * on) moves to the panel's default tab. On: the tab is back. The rule is `lib/developer-views.ts`.
 * The switch itself, its storage and the drawer's strip are driven in
 * `dom/the-providers-screen-samples-only-while-looked-at.dom.test.ts`.
 */

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
  it('⚑ every tab the drawer has: hidden ones go to the default, the rest stay', () => {
    const off = hiddenDrawerTabs(false)
    for (const { id } of DRAWER_TABS) {
      expect(offeredTab(id, off), id).toBe(off.includes(id) ? DEFAULT_TAB : id)
      expect(offeredTab(id, []), id).toBe(id)
    }
  })
})
