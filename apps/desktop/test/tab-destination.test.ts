import { describe, expect, it } from 'vitest'
import { tabDestination } from '../src/renderer/src/lib/tab-destination'

describe('tab destination calculation', () => {
  it.each([
    ['ArrowRight', 0, 3, 1],
    ['ArrowRight', 2, 3, 0],
    ['ArrowLeft', 2, 3, 1],
    ['ArrowLeft', 0, 3, 2],
    ['Home', 2, 3, 0],
    ['End', 0, 3, 2],
    ['ArrowRight', 0, 1, 0],
    ['ArrowLeft', 0, 1, 0],
  ] as const)('%s from %i among %i goes to %i', (key, at, count, expected) => {
    expect(tabDestination(key, at, count)).toBe(expected)
    expect(tabDestination(key, at, count, 'edge')).toBe(expected)
  })

  it.each(['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'])(
    'leaves %s eligibility to the caller',
    (key) => {
      expect(tabDestination(key, 1, 3)).toBeNull()
      expect(tabDestination(key, 1, 3, 'edge')).toBeNull()
    },
  )

  it('retains each wrap formula for an absent active index', () => {
    expect(tabDestination('ArrowRight', -1, 3)).toBe(0)
    expect(tabDestination('ArrowLeft', -1, 3)).toBe(1)
    expect(tabDestination('ArrowRight', -1, 3, 'edge')).toBe(0)
    expect(tabDestination('ArrowLeft', -1, 3, 'edge')).toBe(-2)
    expect(tabDestination('ArrowRight', 4, 3)).toBe(2)
    expect(tabDestination('ArrowRight', 4, 3, 'edge')).toBe(5)
  })

  it('does not invent an empty-strip fallback or change event prevention', () => {
    expect(tabDestination('ArrowRight', 0, 0)).toBeNaN()
    expect(tabDestination('ArrowLeft', 0, 0)).toBeNaN()
    expect(tabDestination('Home', 0, 0)).toBe(0)
    expect(tabDestination('End', 0, 0)).toBe(-1)
    expect(tabDestination('ArrowRight', 0, 0, 'edge')).toBe(1)
    expect(tabDestination('ArrowLeft', 0, 0, 'edge')).toBe(-1)
  })
})
