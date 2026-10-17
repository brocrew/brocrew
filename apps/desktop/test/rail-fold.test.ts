import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { RAIL_W_COLLAPSED, railCollapsed } from '../src/renderer/src/lib/rail-fold'

const TOKENS = readFileSync(
  fileURLToPath(new URL('../src/renderer/src/assets/tokens.css', import.meta.url)),
  'utf8',
)

describe('when the left menu is collapsed', () => {
  it('narrow: collapsed unless a press opened it; wide: the remembered choice', () => {
    for (const chosenCollapsed of [true, false]) {
      expect(railCollapsed({ narrow: true, chosenCollapsed, openedWhileNarrow: false })).toBe(true)
      expect(railCollapsed({ narrow: true, chosenCollapsed, openedWhileNarrow: true })).toBe(false)
      for (const openedWhileNarrow of [true, false]) {
        expect(railCollapsed({ narrow: false, chosenCollapsed, openedWhileNarrow })).toBe(
          chosenCollapsed,
        )
      }
    }
  })

  it('the collapsed width is the token', () => {
    expect(TOKENS).toContain(`--rail-w-collapsed: ${String(RAIL_W_COLLAPSED)}px`)
  })
})
