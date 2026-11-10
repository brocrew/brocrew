import { describe, expect, it } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import { appMenuTemplate } from '../src/main/app-menu'

const firstSubmenu = (appName: string): MenuItemConstructorOptions[] => {
  const first = appMenuTemplate({ appName, devTools: false })[0]
  const submenu = first?.submenu
  expect(Array.isArray(submenu), 'the first menu has no submenu').toBe(true)
  return submenu as MenuItemConstructorOptions[]
}

describe('the app menu says the name it is given, and its items still do their jobs', () => {
  it('About, Hide and Quit carry the name a person reads, each with its own role', () => {
    const items = firstSubmenu('BroCrew')
    const byRole = (role: MenuItemConstructorOptions['role']) =>
      items.find((item) => item.role === role)
    expect(byRole('about')?.label).toBe('About BroCrew')
    expect(byRole('hide')?.label).toBe('Hide BroCrew')
    expect(byRole('quit')?.label).toBe('Quit BroCrew')
  })

  it('the labels follow the name handed in — none is spelled in the template', () => {
    const items = firstSubmenu('Somebody Else')
    expect(items.find((item) => item.role === 'quit')?.label).toBe('Quit Somebody Else')
    expect(JSON.stringify(items)).not.toMatch(/BroBot|BroCrew/)
  })

  it('only those three are relabelled: the others keep the label macOS gives their role', () => {
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
