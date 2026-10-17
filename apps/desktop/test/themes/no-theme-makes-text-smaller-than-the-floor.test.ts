import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TYPE_DEFAULTS, TYPE_FLOOR, TYPE_STEPS, typeSizes } from '../../src/shared/themes/derive'
import { validateTheme } from '../../src/shared/themes/validate'
import { contextFor } from './fixtures'

/**
 * A theme sets the body text size and how fast sizes grow; the caption and small sizes are worked
 * out below the body. No theme may push them under the app's 12px floor: the check refuses such a
 * theme with a sentence, and the window holds every size at the floor in any case.
 */

const mine = (shared: Record<string, unknown>) => ({
  format: 1,
  id: 'mine',
  name: 'Mine',
  extends: 'defined',
  shared,
})
const check = (shared: Record<string, unknown>) => validateTheme(mine(shared), contextFor())

describe('the type scale a theme’s size and ratio make', () => {
  it('the default 14px × 1.26 is the app’s scale, unchanged', () => {
    expect(typeSizes(TYPE_DEFAULTS.base, TYPE_DEFAULTS.ratio)).toEqual({
      caption: 12,
      small: 13,
      body: 14,
      reading: 15,
      heading: 18,
      title: 22,
      display: 28,
    })
    expect(check({}).ok).toBe(true)
  })

  it('12px × 1.35, the smallest size and the largest ratio the schema admits, is refused', () => {
    expect(typeSizes(12, 1.35).caption).toBe(10)
    const r = check({ textBase: 12, typeRatio: 1.35 })
    expect(r.ok).toBe(false)
    expect(r.ok ? [] : r.problems).toEqual([
      {
        at: 'shared.textBase',
        says: 'The smallest text would be 10 px, and text can’t be smaller than 12 px. Raise `shared.textBase` or lower `shared.typeRatio`.',
      },
    ])
  })

  it('a caption that works out at 11.2px is refused', () => {
    // 13 ÷ √1.35 = 11.19, which the window rounds to 11px.
    expect(typeSizes(13, 1.35).caption).toBe(11)
    const r = check({ textBase: 13, typeRatio: 1.35 })
    expect(r.ok ? [] : r.problems.map((p) => p.at)).toEqual(['shared.textBase'])
    // The ratio alone, over the default 14px: 14 ÷ √1.35 = 12.05 → 12px, so it passes…
    expect(check({ typeRatio: 1.35 }).ok).toBe(true)
  })

  it('…while 11.6px rounds to 12px, so 13px × 1.26 passes, as the window draws it', () => {
    expect(typeSizes(13, 1.26).caption).toBe(12)
    expect(check({ textBase: 13, typeRatio: 1.26 }).ok).toBe(true)
  })

  it('a theme that inherits a small size and sets only a large ratio is told at the ratio', () => {
    const builtIns = new Map([
      ['small', { format: 1, id: 'small', name: 'Small', shared: { textBase: 12 } }],
    ]) as never
    const r = validateTheme(
      { format: 1, id: 'mine', name: 'Mine', extends: 'small', shared: { typeRatio: 1.3 } },
      { ...contextFor(), builtIns },
    )
    expect(r.ok ? [] : r.problems.map((p) => p.at)).toEqual(['shared.typeRatio'])
  })
})

describe('the window works the scale out as the check does', () => {
  const css = readFileSync(join(__dirname, '../../src/renderer/src/assets/tokens.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')

  it.each(Object.entries(TYPE_STEPS))('--type-%s', (role, power) => {
    const growth =
      power === 1
        ? '* var(--type-ratio)'
        : power > 0
          ? `* pow(var(--type-ratio), ${power})`
          : `/ pow(var(--type-ratio), ${-power})`
    const formula =
      power === 0 ? 'var(--type-base)' : `round(calc(var(--type-base) ${growth}), 1px)`
    expect(css).toContain(`--type-${role}: max(${TYPE_FLOOR}px, ${formula});`)
  })

  it('the default size and ratio are the check’s', () => {
    expect(css).toContain(`--type-base: ${TYPE_DEFAULTS.base}px;`)
    expect(css).toContain(`--type-ratio: ${TYPE_DEFAULTS.ratio};`)
  })
})
