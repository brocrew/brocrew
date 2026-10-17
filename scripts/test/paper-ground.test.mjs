import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  PAPER_FLOOR,
  chromeInkVerdict,
  inkFields,
  luminance,
  paperFields,
  paperVerdict,
  parseColour,
} from '../lib/paper-ground.mjs'

/**
 * ⛔ **402 §2 · the red that was an assertion and not a defect.**
 *
 * Three live steps asserted *"on paper"* by matching one hex value. `391` moved `--paper-bg` from
 * `#f7f8fa` to `#f8faff` in a palette dispatch and all three went red on a build where the reopen
 * they exist to prove worked. ⚑ **The first test below is that exact substitution**, and it is the
 * one thing the old check could not survive and this one must.
 *
 * ⚠️ **Every negative here is paired with the positive on the SAME reading**, because a check with
 * three claims can be made to pass by two of them and this is where that is decidable — a live step
 * cannot construct a surface that lost its scope.
 */
describe('paperVerdict (402 §2)', () => {
  /** What the app really produces today: light scope on the pane, `transparent` at `:root`. */
  const onPaper = {
    paperBg: 'rgb(248, 250, 255)',
    paperScoped: 'var(--paper-bg)',
    paperRoot: 'transparent',
  }
  // ⚠️ `getComputedStyle` substitutes a custom property's `var()`, so what comes back from a real
  // page is the colour. Both spellings are exercised: the fixture above is what the AUTHORED stream
  // looks like, and this is what Chromium returns.
  const resolved = { ...onPaper, paperScoped: '#f8faff' }

  it('⛔ survives the palette move that made the hex literal red — both palettes pass', () => {
    expect(paperVerdict(resolved, 'the reopened conversation')).toMatch(/on paper/)
    // `391`'s predecessor, unchanged in every way that matters to this claim.
    const before = {
      paperBg: 'rgb(247, 248, 250)',
      paperScoped: '#f7f8fa',
      paperRoot: 'transparent',
    }
    expect(paperVerdict(before, 'the reopened conversation')).toMatch(/on paper/)
    // And the literal the three steps used to pin does NOT appear in this module, so it cannot
    // drift again — the value arrives from the page or it is not used.
    const here = dirname(fileURLToPath(import.meta.url))
    expect(readFileSync(join(here, '../lib/paper-ground.mjs'), 'utf8')).not.toMatch(/rgb\(\s*247/)
  })

  it('⛔ claim 2 · a surface that lost its light scope cannot pass by agreeing with itself', () => {
    // The failure this is here for: `[data-chat-theme="light"]` stops applying, so the pane paints
    // the app's own ground AND resolves `--chat-bg` to it. Claim 1 holds; the check must not.
    const unscoped = {
      paperBg: 'rgb(13, 17, 24)',
      paperScoped: 'rgb(13, 17, 24)',
      paperRoot: 'rgb(13, 17, 24)',
    }
    expect(() => paperVerdict(unscoped, 'the reopened conversation')).toThrow(
      /the light scope is not applying/,
    )
    // ⚑ The paired positive on the same shape — one field different, and it passes.
    expect(paperVerdict({ ...unscoped, paperBg: '#f8faff', paperScoped: '#f8faff' }, 'x')).toMatch(
      /on paper/,
    )
  })

  it('⛔ claim 1 · a surface that stopped painting its own token fails, and says both values', () => {
    const lostTheRule = { ...resolved, paperBg: 'rgb(13, 17, 24)' }
    expect(() => paperVerdict(lostTheRule, 'the reopened conversation')).toThrow(
      /the ground is not coming from the token/,
    )
    expect(() => paperVerdict(lostTheRule, 'the reopened conversation')).toThrow(/#f8faff/)
  })

  it('⛔ claim 3 · a palette that made the ground dark passes claims 1 and 2 and fails this one', () => {
    // ⚠️ **This is what the hex literal was standing in for**, and the reason a token comparison
    // alone would be a tautology: the scope is applying, the paint is the token, and the
    // conversation has stopped being paper.
    const darkPaper = {
      paperBg: 'rgb(20, 24, 30)',
      paperScoped: '#14181e',
      paperRoot: 'transparent',
    }
    expect(() => paperVerdict(darkPaper, 'the reopened conversation')).toThrow(
      new RegExp(`below the ${PAPER_FLOOR}`),
    )
    expect(luminance([20, 24, 30])).toBeLessThan(PAPER_FLOOR)
    expect(luminance([248, 250, 255])).toBeGreaterThan(PAPER_FLOOR)
  })

  it('⛔ a translucent ground is not a ground — what is behind it shows through', () => {
    expect(() =>
      paperVerdict({ ...resolved, paperBg: 'rgba(248, 250, 255, 0.5)' }, 'the launcher'),
    ).toThrow(/translucent/)
  })

  it('⛔ an unreadable colour FAILS rather than passing quietly', () => {
    // The day a token is written as `oklch(…)` this check must say so, not go blank. Both sides.
    expect(() => paperVerdict({ ...resolved, paperBg: 'oklch(0.98 0.01 250)' }, 'x')).toThrow(
      /cannot read a ground colour/,
    )
    expect(() =>
      paperVerdict({ ...resolved, paperScoped: 'color-mix(in srgb, #fff, #000)' }, 'x'),
    ).toThrow(/not a colour this check can compare against/)
    expect(parseColour('transparent')).toBeNull()
    expect(parseColour(undefined)).toBeNull()
  })

  it('the three spellings this app writes colours in all parse to the same channels', () => {
    expect(parseColour('#f8faff')).toEqual([248, 250, 255, 1])
    expect(parseColour('#fff')).toEqual([255, 255, 255, 1])
    expect(parseColour('rgb(248, 250, 255)')).toEqual([248, 250, 255, 1])
    expect(parseColour('rgba(0, 0, 0, 0)')).toEqual([0, 0, 0, 0])
  })

  it('⛔ the scoped read is taken on the ELEMENT and the control on the document', () => {
    // ⚠️ The whole of claim 2 is which element each read is taken on, and that is decided here
    // rather than at three call sites. A reader that took both from `documentElement` would make
    // claim 2 compare a value with itself and pass for every build.
    const fields = paperFields('pane')
    expect(fields).toContain("getComputedStyle(pane).getPropertyValue('--chat-bg')")
    expect(fields).toContain(
      "getComputedStyle(document.documentElement).getPropertyValue('--chat-bg')",
    )
    expect(fields).toContain('getComputedStyle(pane).backgroundColor')
  })
})

/**
 * ⛔ **The same palette move, one row later** (402 §2). `391` took `--text` from `#e7ecf3` to
 * `#e3e8f4`, and the resume smoke's chrome CONTROL — the row that exists to catch a light scope
 * leaking into the app — fired at a rail that had not moved. ⚠️ **A control that goes off for the
 * wrong reason is worse than no control**, because the next reader learns to discount it.
 */
describe('chromeInkVerdict (402 §2)', () => {
  const rail = { ink: '#e3e8f4', rootInk: '#e3e8f4', sceneInk: '#28334e' }

  it('⛔ survives the palette move, on both palettes', () => {
    expect(chromeInkVerdict(rail, 'the rail')).toMatch(/chrome kept :root ink/)
    // `391`'s predecessor: every value different, the RELATIONSHIPS identical.
    expect(
      chromeInkVerdict({ ink: '#e7ecf3', rootInk: '#e7ecf3', sceneInk: '#1b1f24' }, 'the rail'),
    ).toMatch(/chrome kept :root ink/)
  })

  it('⛔ the failure it exists for: a scope reaching the chrome', () => {
    expect(() => chromeInkVerdict({ ...rail, ink: '#28334e' }, 'the rail')).toThrow(
      /a scope reached the chrome/,
    )
  })

  it('⛔ …and the control, which is the half a constant cannot carry', () => {
    // An app that stopped scoping ink ANYWHERE: every element resolves `:root`, so the chrome check
    // holds and means nothing. Without `sceneInk` this would be a green row over a lost feature.
    expect(() =>
      chromeInkVerdict({ ink: '#e3e8f4', rootInk: '#e3e8f4', sceneInk: '#e3e8f4' }, 'the rail'),
    ).toThrow(/nothing is scoped and this check could not have failed/)
  })

  it('⛔ an element that resolves no ink at all FAILS rather than comparing two blanks', () => {
    expect(() =>
      chromeInkVerdict({ ink: '', rootInk: '', sceneInk: '#28334e' }, 'the rail'),
    ).toThrow(/nothing resolved --text here/)
    expect(() => chromeInkVerdict(undefined, 'the rail')).toThrow(/nothing resolved --text here/)
  })

  it('⛔ both fragments splice into an object literal that PARSES', () => {
    // ⚠️ **The one thing a live step cannot report cheaply.** These fragments are spliced into a
    // page-side template literal that only Chromium ever evaluates, so a stray comma or a missing
    // one is a runtime failure inside a $1.45 smoke — and `node --check` on the smoke file cannot
    // see inside its own string. ⚑ Parsing the composed body here is the same check, at gate time.
    for (const body of [
      `const pane = document.body; return { theme: 1, ${paperFields('pane')} }`,
      `const rail = document.body; return { chat: 1, ${inkFields('rail')} sceneInk: 1 }`,
      `const s = document.body; return { ${paperFields('s')} ${inkFields('s')} last: 1 }`,
    ]) {
      expect(() => new Function(body), body.slice(0, 60)).not.toThrow()
    }
    // ⛔ …and no BACKTICK in either, because a backtick inside a page-side template ends it.
    expect(paperFields('x') + inkFields('x')).not.toContain('`')
  })

  it('the element read and the document read are taken on different elements', () => {
    const fields = inkFields('rail')
    expect(fields).toContain("getComputedStyle(rail).getPropertyValue('--text')")
    expect(fields).toContain(
      "getComputedStyle(document.documentElement).getPropertyValue('--text')",
    )
  })
})
