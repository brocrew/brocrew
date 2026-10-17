import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * **Nothing unwired may imply a working state** — HO-002 §5 acceptance #7, as a gate (301).
 *
 * ## ⛔ Why this exists: the criterion had no instrument, and it showed
 *
 * ⚠️ `00-slice2-acceptance-mapping.md` marks #7 **PARTIAL**: *"No sweep has confirmed the property
 * holds everywhere, and two defects found late in the slice were surfaces claiming things that were
 * not true — a cap that was never reached, and a launcher saying it would ask for nothing while
 * asking for `medium`. Both are fixed; neither was found by checking this criterion."*
 *
 * ⛔ **301's own sweep found a third the same way — by reading, not by checking.** `DocumentDrawer`
 * carried `data-wired="false"` and showed a person NOTHING: no chip, no banner, no mark, while
 * rendering a fixture document's number, agent, TL;DR, runtime and warning as if the app had
 * produced it. ⚑ **And its test asserted `data-wired="false"` with the comment *"seed-backed, and
 * says so"*** — the instrument agreeing with the claim by checking the half a reader cannot see.
 *
 * ## ⚑ So the rule is about what a READER sees, and the attribute is not it
 *
 * `data-wired` is machine-readable. This file holds the two rules that make it mean something:
 *
 *  1. **A surface that declares itself unwired must SHOW it** — a {@link DISCLOSURES} mark inside
 *     its own subtree, so the declaration and the disclosure cannot come apart.
 *  2. **A control that can never act must say why, next to itself** — an unconditionally `disabled`
 *     button with no explanation is `106`'s dead control, and `118`'s rule is that an absent
 *     capability is stated rather than greyed.
 *
 * ## ⚠️ What this does NOT cover, said out loud so a green is not read as more than it is
 *
 * ⛔ **It cannot find a surface that is unwired and does not SAY it is** — the thing acceptance #7
 * is really about. Nothing in the source distinguishes *"this button does nothing"* from *"this
 * button emits an event a parent handles"*, so the census below starts from the app's own
 * declaration. ⚑ What it does is stop the declaration from drifting away from the disclosure, which
 * is exactly how `DocumentDrawer` got where it was: the attribute was written once and the mark
 * was never added.
 *
 * ⚠️ **Proximity, not the DOM tree, for rule 2** — {@link NEAR_LINES}. A disclosure thirty lines
 * from its button is not a disclosure to a reader either, so the bound is a feature; but a
 * legitimately-explained control written unusually far from its explanation would fail here and
 * should move rather than be allowlisted.
 *
 * ⛔ **And it reads templates, so anything assembled at runtime is invisible to it** — the same
 * limit `provider-neutrality.test.ts` states about its own census, for the same reason.
 *
 * ## ⚑ D-016 · the renderer declares nothing unwired any more, and rule 1 still has a subject
 *
 * ⛔ **The last `data-wired="false"` went with Home** (the rail's Home row, and with it the demo
 * seed's cards, `SoonChip` and `PlaceholderBanner`). ⚑ **What the product says now is that every
 * surface it declares is wired** — `data-wired="true"`, on the rail's rows and the two pages that
 * replaced Home. ⚠️ So rule 1's census reads the declaration it always read, over BOTH values: the
 * wired ones are what makes *no unwired surface* a measurement rather than an empty read, and a
 * planted unwired surface proves the scan still sees one — and still refuses one that shows nothing.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const COMPONENTS = join(HERE, '../src/renderer/src/components')

/**
 * The marks a person can actually see.
 *
 * ⚠️ **`data-wired` is deliberately NOT one of them.** It is the declaration this file checks, not
 * a disclosure: an attribute discloses nothing to somebody looking at the screen.
 *
 * ⚑ **D-016 deleted `<SoonChip` and `<PlaceholderBanner`**, the two components this list named
 * first; a mark that nothing can draw is not a mark a person can see, so `not-wired` is what is left.
 */
const DISCLOSURES = ['not-wired'] as const

/**
 * How far from a dead control its explanation may be, in lines after the control's closing tag.
 *
 * Twelve, and the number is chosen from the widest honest case in the tree rather than picked:
 * `ProjectWorkspace`'s Deny sat three lines from its chip behind a comment that explains which
 * button the chip belongs to (the room is deleted since D-016; the bound is kept). See the module
 * note on why proximity is the right test at all.
 */
const NEAR_LINES = 12
/** …and how far before it, for the surfaces that explain first and then draw the control. */
const NEAR_LINES_BEFORE = 6

interface Site {
  readonly file: string
  readonly line: number
  readonly what: string
}

const files = readdirSync(COMPONENTS)
  .filter((name) => name.endsWith('.vue'))
  .sort()

/**
 * The template only, with everything else BLANKED rather than removed.
 *
 * ⚠️ **Blanked, so an offset is still the file's own offset** and a failure prints the line a
 * person can open. Two things go: the `<script>`/`<style>` around the template — `.folder-ctl
 * button` in a stylesheet is not a control — and the HTML comments, which matter in both
 * directions: a `<button disabled>` quoted in prose must not become a finding, and a comment
 * explaining a dead control must not count as its disclosure, because nobody on the screen can
 * read it.
 */
function templateOf(source: string): string {
  const open = source.indexOf('<template>')
  if (open === -1) return ''
  const close = source.lastIndexOf('</template>')
  const end = close === -1 ? source.length : close
  const blanked = source
    .slice(0, end)
    .replace(/<!--[\s\S]*?-->/g, (match) => match.replace(/[^\n]/g, ' '))
  return blanked.slice(0, open).replace(/[^\n]/g, ' ') + blanked.slice(open)
}

/** Where the tag that starts at `from` ends — quote-aware, because `:title="a > b"` is real here. */
function endOfOpenTag(text: string, from: number): number {
  let quote: string | null = null
  for (let at = from; at < text.length; at += 1) {
    const char = text[at]
    if (quote !== null) {
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '>') return at
  }
  return text.length
}

/**
 * The subtree of the element opening at `from`, as text — an honest depth walk rather than a
 * "read to the end of the file", which would let any mark anywhere satisfy any surface.
 */
function subtreeOf(text: string, from: number): string {
  const name = /^<([A-Za-z][\w-]*)/.exec(text.slice(from))?.[1]
  if (name === undefined) return ''
  const openEnd = endOfOpenTag(text, from)
  if (text[openEnd - 1] === '/') return text.slice(from, openEnd + 1) // self-closing: no subtree
  let depth = 1
  let at = openEnd + 1
  const open = new RegExp(`<${name}(?=[\\s/>])`, 'g')
  const close = new RegExp(`</${name}\\s*>`, 'g')
  while (depth > 0 && at < text.length) {
    open.lastIndex = at
    close.lastIndex = at
    const nextOpen = open.exec(text)
    const nextClose = close.exec(text)
    if (nextClose === null) return text.slice(from)
    if (nextOpen !== null && nextOpen.index < nextClose.index) {
      depth += 1
      at = endOfOpenTag(text, nextOpen.index)
      if (text[at - 1] === '/') depth -= 1
      at += 1
      continue
    }
    depth -= 1
    at = nextClose.index + nextClose[0].length
  }
  return text.slice(from, at)
}

const lineOf = (text: string, index: number): number => text.slice(0, index).split('\n').length

/**
 * ⚑ **One template's declarations, both values** — the unwired ones with whether each shows a mark,
 * and the wired ones, which are what the census reads when nothing is unwired (D-016).
 */
function declarationsIn(
  file: string,
  template: string,
): { readonly unwired: Site[]; readonly silent: Site[]; readonly wired: Site[] } {
  const unwired: Site[] = []
  const silent: Site[] = []
  const wired: Site[] = []
  for (const match of template.matchAll(/data-wired="(true|false)"/g)) {
    const site = { file, line: lineOf(template, match.index), what: match[0] }
    if (match[1] === 'true') {
      wired.push(site)
      continue
    }
    unwired.push(site)
    const subtree = subtreeOf(template, template.lastIndexOf('<', match.index))
    if (!DISCLOSURES.some((mark) => subtree.includes(mark))) silent.push(site)
  }
  return { unwired, silent, wired }
}

describe('a surface that says it is not wired shows it (HO-002 §5 #7)', () => {
  const declared: Site[] = []
  const silent: Site[] = []
  const wired: Site[] = []

  for (const file of files) {
    const found = declarationsIn(file, templateOf(readFileSync(join(COMPONENTS, file), 'utf8')))
    declared.push(...found.unwired)
    silent.push(...found.silent)
    wired.push(...found.wired)
  }

  it('every unwired surface carries a mark a person can see', () => {
    expect(
      silent.map((site) => `${site.file}:${String(site.line)}`),
      `these surfaces declare themselves unwired and show nothing: a reader meets fixture state ` +
        `presented as the app's own. Add a <SoonChip> or a <PlaceholderBanner> inside the element ` +
        `— not a comment, which nobody on the screen can read.`,
    ).toEqual([])
  })

  it('⚑ and the census is not empty, so the rule above is about something', () => {
    // 193: a scan over nothing passes every assertion it makes. This is the positive half.
    // ⚑ **D-016 · the tree declares nothing unwired, and that is now what it SAYS** — so the half
    // that proves this file looked is the declarations it did find: every surface the renderer
    // marks is marked wired, on more than one file.
    expect(
      declared.map((site) => `${site.file}:${String(site.line)}`),
      'a surface declares itself unwired again — the rule above is about it; this line moves',
    ).toEqual([])
    expect(
      wired.length,
      'the renderer declares nothing at all — check the pattern',
    ).toBeGreaterThan(4)
    expect(new Set(wired.map((site) => site.file)).size).toBeGreaterThan(2)
    // ⛔ **And the scan still sees an unwired surface, and still refuses one that shows nothing** —
    // planted, both ways, through the same function the tree was read with (standing rule 12).
    const planted = (body: string) =>
      declarationsIn('Planted.vue', templateOf(`<template>\n${body}\n</template>\n`))
    const shows = planted(
      '<section data-wired="false"><span class="not-wired">soon</span></section>',
    )
    expect(shows.unwired).toHaveLength(1)
    expect(shows.silent).toEqual([])
    const hides = planted('<section data-wired="false"><p>fixture state</p></section>')
    expect(hides.unwired).toHaveLength(1)
    expect(hides.silent).toHaveLength(1)
    // ⚠️ …and a comment explaining it is not a mark: nobody on the screen can read it.
    const told = planted('<section data-wired="false"><!-- not-wired --><p>x</p></section>')
    expect(told.silent).toHaveLength(1)
  })
})

describe('a control that can never act says why, beside itself (106, 118)', () => {
  const dead: Site[] = []
  const undisclosed: Site[] = []

  for (const file of files) {
    const template = templateOf(readFileSync(join(COMPONENTS, file), 'utf8'))
    const lines = template.split('\n')
    for (const match of template.matchAll(/<button(?![\w-])/g)) {
      const openEnd = endOfOpenTag(template, match.index)
      const tag = template.slice(match.index, openEnd + 1)
      // ⚠️ **`:disabled="expr"` is not this rule's business.** A control disabled by state is a
      // control that works — it is off right now and the state says why. Only a literal, permanent
      // `disabled` is the dead control 106 is about.
      if (!/\sdisabled(?=[\s/>])/.test(tag)) continue
      const line = lineOf(template, match.index)
      const site = { file, line, what: tag.replace(/\s+/g, ' ').slice(0, 90) }
      dead.push(site)
      const subtree = subtreeOf(template, match.index)
      const endLine = line + subtree.split('\n').length - 1
      const near = lines
        .slice(Math.max(0, line - 1 - NEAR_LINES_BEFORE), endLine + NEAR_LINES)
        .join('\n')
      // A `title` on the control itself is a disclosure the pointer finds; a chip or a `…-why`
      // note beside it is one the eye finds. Either answers "why can I not press this".
      const explained =
        /\stitle="|\s:title="/.test(tag) ||
        DISCLOSURES.some((mark) => near.includes(mark)) ||
        /data-cy="[\w-]+-why"/.test(near)
      if (!explained) undisclosed.push(site)
    }
  }

  it('every permanently disabled button has its reason within reach', () => {
    expect(
      undisclosed.map((site) => `${site.file}:${String(site.line)}  ${site.what}`),
      `a button that can never be pressed and never says why is 106's dead control. Put a ` +
        `<SoonChip>, a "not-wired" mark, a title, or a data-cy="…-why" note within ` +
        `${String(NEAR_LINES)} lines of it.`,
    ).toEqual([])
  })

  it('⚑ and there really are permanently disabled buttons to have found', () => {
    expect(
      dead.length,
      'the scan found no disabled buttons at all — check the pattern',
    ).toBeGreaterThan(2)
  })
})
