import { describe, expect, it } from 'vitest'
import { appMenuTemplate, rolesIn } from '../src/main/app-menu'

describe('the Window menu', () => {
  it('keeps native close, minimize and zoom roles', () => {
    const roles = new Set(rolesIn(appMenuTemplate({ appName: 'BroCrew', devTools: false })))
    for (const role of ['close', 'minimize', 'zoom']) {
      expect(roles.has(role), `the Window menu has no ${role} role`).toBe(true)
    }
  })
})
