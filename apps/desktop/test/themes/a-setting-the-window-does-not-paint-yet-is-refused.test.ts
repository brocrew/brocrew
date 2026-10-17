import { describe, expect, it } from 'vitest'
import { HELD_SETTINGS } from '../../src/shared/themes/schema'
import { validateTheme, type ThemeContext } from '../../src/shared/themes/validate'
import { DEFINED } from './fixtures'

/**
 * A setting the window doesn't paint yet is held: a theme the app reads is refused for it, in the
 * sentence an unknown setting gets, so no theme is accepted for a look the window would not show.
 * Every setting that was held and is now painted is accepted.
 */

/** What the app's own host hands the validator. */
const APP: ThemeContext = { assets: new Map(), builtIns: new Map([['defined', DEFINED]]) }

/** A value each per-component setting would take, valid by that setting's own rules. */
const VALUES: Readonly<Record<string, unknown>> = {
  'shared.shadow.style': 'glow',
  'shared.accentStyle': 'solid',
  window: { background: '#182135' },
  rail: { background: '#182135' },
  'rail.glass': { blur: 8 },
  titlebar: { background: '#182135' },
  brand: { mark: '#182135', markInk: '#ffffff' },
  type: { display: { weight: 700 } },
  conversation: { background: '#ffffff' },
  'conversation.glass': { blur: 8 },
  'conversation.textBacking': { ink: '#1b2238' },
  composer: { surround: '#ffffff' },
  drawer: { card: { fill: '#ffffff' } },
  controls: { style: 'bevel' },
  scrollbar: { style: 'thin' },
  pictures: { tone: 'grey' },
  motion: { transitions: 'none' },
  'motion.underReduceMotion': 'stepped',
  effects: [],
}

/** A theme that sets `path` to `value` and nothing else of its own. */
function setting(path: string, value: unknown): Record<string, unknown> {
  const theme: Record<string, unknown> = { format: 1, id: 'held', name: 'Held', extends: 'defined' }
  const keys = path.split('.')
  let at = theme
  for (const key of keys.slice(0, -1)) at = (at[key] = {}) as Record<string, unknown>
  at[keys.at(-1)!] = value
  return theme
}

describe('a setting the window doesn’t paint yet', () => {
  it('every held setting has a value here', () => {
    for (const held of HELD_SETTINGS) expect(VALUES, held).toHaveProperty([held])
  })

  it.each(HELD_SETTINGS)('⛔ `%s` is refused as an unknown setting', (path) => {
    const read = validateTheme(setting(path, VALUES[path]), APP)
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.problems).toHaveLength(1)
    expect(read.problems[0]!.at).toBe(path)
    expect(read.problems[0]!.says).toMatch(
      new RegExp(`^\`${path.replace(/\./g, '\\.')}\` isn’t a theme setting\\.`),
    )
  })

  it.each(HELD_SETTINGS)(
    '…and `%s` is valid by its own rules, so the hold is what refuses it',
    (path) => {
      expect(validateTheme(setting(path, VALUES[path]), { ...APP, readsHeld: true })).toMatchObject(
        {
          ok: true,
        },
      )
    },
  )
})

/** The settings that were held and that the window paints now. */
const RELEASED = Object.keys(VALUES).filter(
  (path) => !HELD_SETTINGS.some((held) => path === held || path.startsWith(`${held}.`)),
)

describe('a setting the window paints', () => {
  it.each(RELEASED)('`%s` is accepted by the app’s own reading', (path) => {
    expect(validateTheme(setting(path, VALUES[path]), APP)).toMatchObject({ ok: true })
  })
})
