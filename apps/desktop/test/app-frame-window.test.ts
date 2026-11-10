import { describe, expect, it } from 'vitest'
import { appMenuTemplate, rolesIn } from '../src/main/app-menu'

describe('why the reach is not a window minimum', () => {
  it('is that the app offers a gesture a window minimum cannot see', () => {
    // 🔴 One ⌘+ at the shipped 1200 × 840 puts the CSS viewport at 1095.45 — measured with
    // `setMinimumSize(1180, 700)` in force, because a zoom does not change the window. If this
    // item ever leaves the menu, 338's rejection of `minWidth` is worth re-reading rather than
    // simply still true.
    const roles = rolesIn(appMenuTemplate({ appName: 'BroBot2', devTools: false }))
    expect(roles).toContain('zoomIn')
    expect(roles).toContain('resetZoom')
  })
})
