import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SEEDS } from '../../src/shared/themes/contrast'
import { DERIVATION, FRAME_STATUS, type Derivation } from '../../src/shared/themes/derive'

/**
 * The theme check measures colours worked out by `DERIVATION`; the window paints colours worked
 * out by tokens.css. These tests keep the two the same formulas, so a theme the check passes is a
 * theme the window draws as measured.
 */

const CSS = readFileSync(
  join(__dirname, '../../src/renderer/src/assets/tokens.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '')

/** Every rule as its selector and its declarations, in source order. */
const RULES = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selector: m[1]!.trim().replace(/\s+/g, ' '),
  decls: new Map(
    [...m[2]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((d) => [
      d[1]!,
      d[2]!.trim().replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')'),
    ]),
  ),
}))

const DERIVED = RULES.filter((r) => r.selector.includes(":not([data-theme='classic'])"))
const SEEDS = RULES.find((r) => r.selector === ':root' && r.decls.has('--frame-ink'))

/** A token's value in the derived rules: the first rule that declares it. */
function derived(name: string): string {
  const rule = DERIVED.find((r) => r.decls.has(name))
  expect(rule, `${name} is not worked out in the derived rules`).toBeDefined()
  return rule!.decls.get(name)!
}

/** The `color-mix()` calls in a value, in order. */
function mixes(value: string): string[] {
  const out: string[] = []
  let at = value.indexOf('color-mix(')
  while (at !== -1) {
    let depth = 0
    let end = at
    for (; end < value.length; end++) {
      if (value[end] === '(') depth++
      if (value[end] === ')' && --depth === 0) break
    }
    out.push(value.slice(at, end + 1))
    at = value.indexOf('color-mix(', end)
  }
  return out
}

const SOURCE: Record<string, Derivation['a']> = {
  '--z-ink': 'ink',
  '--content-ink': 'ink',
  '--z-paper': 'paper',
  '--content-paper': 'paper',
  '--z-accent': 'accent',
  '--content-accent': 'accent',
  '--z-shadow': 'shadow',
}
const PROPORTION: Record<string, string> = {
  '--page-depth': 'page',
  '--line-strength': 'line',
  '--tint-strength': 'tint',
  '--shadow-strength': 'shadow',
}

const source = (side: string): Derivation['a'] => {
  if (side === 'transparent') return 'transparent'
  const name = /^var\((--[\w-]+)\)$/.exec(side)?.[1] ?? ''
  expect(SOURCE[name], `${side} is not a zone colour`).toBeDefined()
  return SOURCE[name]!
}

/** A `color-mix()` call, or a bare zone colour, read back as a derivation. */
function parse(value: string): Derivation {
  const bare = /^var\((--[\w-]+)\)$/.exec(value)
  if (bare) {
    // A colour on its own is 100% of itself; `panel` is written as the paper, 0% ink.
    const s = source(value)
    return s === 'paper'
      ? { a: 'ink', amount: { fixed: 0 }, b: 'paper', space: 'oklab' }
      : { a: s, amount: { fixed: 100 }, b: 'paper', space: 'oklab' }
  }
  const m =
    /^color-mix\(in (oklab|srgb), (var\(--[\w-]+\)) (.+), (var\(--[\w-]+\)|transparent)\)$/.exec(
      value,
    )
  expect(m, `${value} is not a mix of two zone colours`).not.toBeNull()
  const [, space, a, amountText, b] = m!
  let amount: Derivation['amount']
  const fixed = /^(\d+(?:\.\d+)?)%$/.exec(amountText!)
  const plain = /^var\((--[\w-]+)\)$/.exec(amountText!)
  const times = /^calc\(var\((--[\w-]+)\) \* (\d+(?:\.\d+)?)\)$/.exec(amountText!)
  const plus = /^calc\(var\((--[\w-]+)\) \+ (\d+(?:\.\d+)?)%\)$/.exec(amountText!)
  if (fixed) amount = { fixed: Number(fixed[1]) }
  else if (plain) amount = { of: PROPORTION[plain[1]!] as never, times: 1, plus: 0 }
  else if (times) amount = { of: PROPORTION[times[1]!] as never, times: Number(times[2]), plus: 0 }
  else if (plus) amount = { of: PROPORTION[plus[1]!] as never, times: 1, plus: Number(plus[2]) }
  else throw new Error(`${amountText} is not an amount the check can compute`)
  return { a: source(a!), amount, b: source(b!), space: space as Derivation['space'] }
}

/** Where each derived colour is written: its own token, or a part of a shadow. */
const WRITTEN: Record<string, [token: string, part: number]> = {
  'shadow-card-near': ['--shadow-card', 0],
  'shadow-card-far': ['--shadow-card', 1],
  'shadow-menu': ['--shadow-menu', 0],
  'shadow-dialog': ['--shadow-dialog', 0],
  'accent-glow': ['--accent-glow', 0],
  'accent-glow-weak': ['--accent-glow-weak', 0],
}

const normal = (d: Derivation): Derivation => ({
  ...d,
  amount: 'fixed' in d.amount ? d.amount : { plus: 0, ...d.amount },
})

describe('the window works colours out as the theme check does', () => {
  it.each(Object.keys(DERIVATION))('--%s', (name) => {
    const [token, part] = WRITTEN[name] ?? [`--${name}`, -1]
    const value = derived(token)
    const written = part === -1 ? value : mixes(value)[part]!
    expect(written, `${token} has no colour at part ${part}`).toBeDefined()
    expect(parse(written)).toEqual(normal(DERIVATION[name as keyof typeof DERIVATION]))
  })

  it('a frame status colour is the formula FRAME_STATUS names', () => {
    for (const status of ['waiting', 'success', 'danger', 'auto']) {
      expect(derived(`--${status}`)).toBe(
        `oklch(from color-mix(in oklab, var(--status-${status}) ${FRAME_STATUS.mix}%, var(--frame-ink)) l calc(c * ${FRAME_STATUS.chroma}) h)`,
      )
    }
  })

  it('a setting a theme leaves unset has the value the check assumes', () => {
    expect(SEEDS, 'no :root rule declares the theme settings').toBeDefined()
    const seed = (name: string): string => SEEDS!.decls.get(name) ?? ''
    for (const zone of ['frame', 'content'] as const) {
      for (const part of ['ink', 'paper', 'accent'] as const) {
        expect(seed(`--${zone}-${part}`).toLowerCase(), `--${zone}-${part}`).toBe(
          DEFAULT_SEEDS[zone][part].toLowerCase(),
        )
      }
    }
    expect(seed('--page-depth')).toBe(`${DEFAULT_SEEDS.page}%`)
    expect(seed('--line-strength')).toBe(`${DEFAULT_SEEDS.line}%`)
    expect(seed('--tint-strength')).toBe(`${DEFAULT_SEEDS.tint}%`)
    expect(seed('--shadow-strength')).toBe(`${DEFAULT_SEEDS.shadow}%`)
  })

  it('⛔ no rule for the light scope declares a setting, so a theme’s root block reaches it', () => {
    const settings = [...SEEDS!.decls.keys()]
    const light = RULES.filter((r) => /data-chat-theme|data-on-white/.test(r.selector))
    expect(light.length).toBeGreaterThan(1)
    for (const rule of light) {
      expect(
        settings.filter((s) => rule.decls.has(s)),
        rule.selector,
      ).toEqual([])
    }
  })

  it('⛔ a changed number is caught: muted at 70% in the window and 76% in the check', () => {
    const muted = derived('--muted').replace('76%', '70%')
    expect(parse(muted)).not.toEqual(normal(DERIVATION.muted))
  })
})
