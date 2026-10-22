import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import { appMenuTemplate } from '../src/main/app-menu'

/**
 * # W4.80 · BroCrew is the name a person reads, and the app's own name stays (`ae53076e`)
 *
 * ⚑ The app menu's About, Hide and Quit items say *BroCrew* — given labels while KEEPING their roles,
 * so macOS still does what each one does — and the About panel names BroCrew. ⛔ `app.getName()` is
 * not the name handed to the menu, and nobody's data may move: the data folder is pinned at launch
 * apart from any name (`data-folder.ts`).
 *
 * ⚠️ `index.ts` imports `electron` as a value and no test can load it, so its half is read as source
 * (comments stripped), as `app-menu.test.ts` does for `setApplicationMenu`.
 */

const HERE = dirname(fileURLToPath(import.meta.url))

const firstSubmenu = (appName: string): MenuItemConstructorOptions[] => {
  const first = appMenuTemplate({ appName, devTools: false })[0]
  const submenu = first?.submenu
  expect(Array.isArray(submenu), 'the first menu has no submenu').toBe(true)
  return submenu as MenuItemConstructorOptions[]
}

describe('ae53076e · the app menu says the name it is given, and its items still do their jobs', () => {
  it('🔴 About, Hide and Quit carry the name a person reads, each with its own role', () => {
    const items = firstSubmenu('BroCrew')
    const byRole = (role: MenuItemConstructorOptions['role']) =>
      items.find((item) => item.role === role)
    expect(byRole('about')?.label).toBe('About BroCrew')
    expect(byRole('hide')?.label).toBe('Hide BroCrew')
    expect(byRole('quit')?.label).toBe('Quit BroCrew')
  })

  it('⚑ the labels follow the name handed in — none is spelled in the template', () => {
    const items = firstSubmenu('Somebody Else')
    expect(items.find((item) => item.role === 'quit')?.label).toBe('Quit Somebody Else')
    expect(JSON.stringify(items)).not.toMatch(/BroBot|BroCrew/)
  })

  it('⛔ only those three are relabelled: the others keep the label macOS gives their role', () => {
    const items = firstSubmenu('BroCrew')
    for (const role of ['services', 'hideOthers', 'unhide'] as const) {
      const item = items.find((one) => one.role === role)
      expect(item, role).toBeDefined()
      expect(item?.label, role).toBeUndefined()
    }
  })
})

describe('the menu retains the default-look callback', () => {
  it('puts exactly the supplied callback on the Default look item', () => {
    const defaultLook = (): void => undefined
    const view = appMenuTemplate({ appName: 'BroCrew', devTools: false, defaultLook }).find(
      (item) => item.label === 'View',
    )
    expect(Array.isArray(view?.submenu)).toBe(true)
    expect((view?.submenu as MenuItemConstructorOptions[])[0]).toEqual({
      label: 'Default look',
      click: defaultLook,
    })
    const without = appMenuTemplate({ appName: 'BroCrew', devTools: false }).find(
      (item) => item.label === 'View',
    )
    expect(
      (without?.submenu as MenuItemConstructorOptions[]).map((item) => item.label),
    ).not.toContain('Default look')
  })
})

describe('ae53076e · main hands the menu and the About panel the person’s name, not the app’s', () => {
  const source = readFileSync(join(HERE, '..', 'src', 'main', 'index.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  it('🔴 the menu and the About panel are given PERSONS_TITLE', () => {
    expect(source).toContain(`appMenuTemplate({
            appName: PERSONS_TITLE,
            devTools: !app.isPackaged,
            defaultLook: () => {
              void themes?.showDefault().catch(() => undefined)
            },
          })`)
    expect(source).toMatch(
      /app\.setAboutPanelOptions\(\{\s*applicationName: PERSONS_TITLE,\s*applicationVersion: shownVersion\(app\.getVersion\(\), app\.isPackaged\),\s*\}\)/,
    )
    // ⛔ The paired negative: the technical name is no longer the menu's.
    expect(source).not.toMatch(/appMenuTemplate\(\{ appName: app\.getName\(\)/)
  })

  it('⛔ the data folder is pinned apart from any name, so nothing moves', () => {
    // ⚑ Pinned at launch to `@brobot2/desktop` under the OS's app-data folder, whatever the app is
    // called — `the-data-folder-is-pinned.test.ts` pins the folder itself.
    expect(source).toMatch(/pinTheDataFolder\(app\)/)
    expect(source).toMatch(/defaultDataFolder\(app\.getPath\('appData'\)\)/)
    expect(source).not.toMatch(/app\.setName\(/)
  })
})
