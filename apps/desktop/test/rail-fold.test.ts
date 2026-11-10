import { describe, expect, it } from 'vitest'
import { railCollapsed } from '../src/renderer/src/lib/rail-fold'

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
})
