import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import {
  ENDS_EVERY_CONVERSATION,
  MUST_STILL_WORK,
  appMenuTemplate,
  rolesIn,
} from '../src/main/app-menu'

/**
 * ⛔ **View → Reload ended every conversation in the window, from a menu this app never wrote**
 * (203, from 195 H2).
 *
 * Electron installs a default application menu when nothing replaces it, and until 203 nothing did:
 * `setApplicationMenu` had zero hits in this repository, `Menu` was not imported in `src/main`, and
 * no accelerator was registered anywhere. So ⌘R was live, it committed a navigation, `did-navigate`
 * fired, and `closeSessionsForOwner` closed every slot for that window — the exact row 094 measured
 * and pinned (*"`webContents.reload()` (⌘R, devtools, menu)"*), reachable by one keystroke with no
 * confirmation.
 *
 * ⚑ **The choice was REMOVE, and `app-menu.ts` argues it**: the renderer's own `location.reload()`
 * has been refused silently since 074, so a confirm on ⌘R would be a second answer to one question
 * one door apart. The tests below pin both halves of the removal — the item is gone, and the menu it
 * left behind is still a menu.
 */

const HERE = dirname(fileURLToPath(import.meta.url))

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

  it('⛔ the app really installs it — src/main sets the application menu exactly once', () => {
    // The structural half, on `window-navigation.test.ts`'s pattern: `index.ts` imports `electron`
    // as a value and no test can load it, so what a test CAN do is read it. A template nothing
    // hands to Electron is a policy the app does not have.
    const sources: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const child = join(dir, entry.name)
        if (entry.isDirectory()) walk(child)
        else if (entry.name.endsWith('.ts')) sources.push(child)
      }
    }
    walk(join(HERE, '../src/main'))

    let installs = 0
    const offenders: string[] = []
    for (const file of sources) {
      // Comments stripped first: `app-menu.ts` and this file both DISCUSS `setApplicationMenu`, and
      // the discussion is the point — it is the code that must do it exactly once.
      const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      installs += (source.match(/setApplicationMenu\(/g) ?? []).length
      // ⚠️ `setApplicationMenu(null)` would pass every assertion above by removing the menu
      // entirely, and on darwin that takes Copy, Paste and Quit with it.
      if (/setApplicationMenu\(\s*null\s*\)/.test(source))
        offenders.push(`${file} removes the menu`)
    }
    expect(installs, 'nothing installs a menu — the default one is back').toBe(1)
    expect(offenders).toEqual([])
  })
})
