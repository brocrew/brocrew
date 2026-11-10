import { describe, expect, it } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import {
  ENDS_EVERY_CONVERSATION,
  MUST_STILL_WORK,
  appMenuTemplate,
  rolesIn,
} from '../src/main/app-menu'

const template = (devTools: boolean): MenuItemConstructorOptions[] =>
  appMenuTemplate({ appName: 'BroBot2', devTools })

describe('203 · the application menu this app owns (195 H2)', () => {
  it('⛔ offers no reload, in either build', () => {
    for (const devTools of [true, false]) {
      const roles = rolesIn(template(devTools))
      for (const banned of ENDS_EVERY_CONVERSATION) {
        expect(roles, `devTools=${devTools} still offers ${banned}`).not.toContain(banned)
      }
    }
    // The banned set is not empty — a list that emptied itself would satisfy the loop above while
    // saying nothing.
    expect([...ENDS_EVERY_CONVERSATION]).toEqual(['reload', 'forceReload'])
  })

  it('⚑ …and is still a menu — the paired positive that stops "no reload" meaning "no items"', () => {
    // The cheapest way to pass the test above is to ship an empty template. On darwin the standard
    // accelerators ARE menu items, so an app with no menu is an app you cannot ⌘C, ⌘Q or ⌘M in.
    const roles = rolesIn(template(false))
    for (const needed of MUST_STILL_WORK) {
      expect(roles, `a shipped app with no ${needed}`).toContain(needed)
    }
  })

  it('offers DevTools only outside a packaged build, and nothing else moves with it', () => {
    // ⛔ **The residual this file cannot close, pinned as a decision.** DevTools drives the inspected
    // page's own `webContents.reload()` from a different WebContents, so no template can take that
    // ⌘R away. Withholding the ITEM is what keeps a shipped build free of a route to it; a
    // development build keeps it, and a developer is who that is for.
    const dev = rolesIn(template(true))
    const packaged = rolesIn(template(false))
    expect(dev).toContain('toggleDevTools')
    expect(packaged).not.toContain('toggleDevTools')
    expect(dev.filter((role) => role !== 'toggleDevTools')).toEqual(packaged)
  })

  it('names the app in the first submenu, because macOS shows that one whatever it holds', () => {
    const first = template(false)[0]
    expect(first?.label).toBe('BroBot2')
    expect(rolesIn([first as MenuItemConstructorOptions])).toContain('quit')
  })
})
