/**
 * Require every renderer CSS `var(--x)` use to have a declaration in the same tree or an
 * explicit fallback. Undefined properties without fallbacks invalidate declarations,
 * which can leave panels transparent. Report fallback-only tokens separately.
 *
 * Scan `.css` files and Vue `<style>` blocks; script comments and template prose cannot
 * declare tokens or create uses. Also recognise Vue object-shaped `:style` declarations.
 *
 * Limits: computed names cannot be resolved; plain HTML style attributes and template-literal
 * bindings are not recognised; TypeScript contributes only supported binding declarations,
 * not generated stylesheets. The comment stripper is not a tokenizer and may mistake an
 * opener inside a CSS string for a comment. Runtime-generated token tables need separate checks.
 */

/** The opening tag and body of every `<style>` block. */
const STYLE_BLOCK = /(<style\b[^>]*>)([\s\S]*?)<\/style>/gi

/**
 * The CSS regions of one file, as `{ text, offset }` — `offset` being where the region starts in
 * the whole file, so a match inside it can still be reported at its real line.
 */
export function cssRegions(text, file = 'x.css') {
  if (file.endsWith('.vue')) {
    return [...text.matchAll(STYLE_BLOCK)].map((m) => ({
      text: m[2],
      offset: m.index + m[1].length,
    }))
  }
  if (file.endsWith('.css')) return [{ text, offset: 0 }]
  // Anything else (`.ts`) has no CSS region. Its `:style` bindings are still read below.
  return []
}

/** `/* … *\/`, replaced by its own newlines so every reported line number stays true. */
export function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
}

/** Where each line starts, so an offset can become a line number without rescanning the file. */
function lineStarts(text) {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1)
  return starts
}

/** 1-based line of an absolute offset, by binary search over {@link lineStarts}. */
function lineOf(starts, offset) {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return lo + 1
}

/**
 * Every token DECLARED in one file — from its CSS regions, and from a Vue `:style` binding.
 *
 * The CSS form requires a delimiter before the `--`, so a fallback (`var(--a, --b)`) and a name
 * inside a longer identifier cannot be mistaken for a declaration.
 */
export function tokenDeclarationsIn(text, file = 'x.css') {
  const names = new Set()
  for (const region of cssRegions(text, file)) {
    for (const m of stripComments(region.text).matchAll(/(?:^|[;{}\s])(--[A-Za-z0-9_-]+)\s*:/g)) {
      names.add(m[1])
    }
  }
  // `:style="{ '--sz': … }"` — a real declaration, written in the template rather than the
  // stylesheet. Quoted on BOTH sides of the name, which is narrow enough that prose cannot trip it.
  for (const m of text.matchAll(/['"](--[A-Za-z0-9_-]+)['"]\s*:/g)) names.add(m[1])
  return names
}

/**
 * Every literal `var(--x)` in one file's CSS, with its line and whether it carries a fallback.
 *
 * ⚠️ **Scanned over the whole region rather than line by line**, because prettier can and does
 * break inside `var(` when the call is long — `var(\n  --x\n)` is legal CSS and a line-based
 * scanner reads it as zero uses. `\s` spans the newline, so the shape is seen either way, and the
 * line reported is the one the `var(` starts on.
 *
 * A fallback is *any* second argument, which is what CSS means by one: `var(--a,)` is a fallback of
 * the empty token stream and is still a defined result. The comma is therefore the whole test.
 */
export function tokenUsesIn(text, file = 'x.css') {
  const starts = lineStarts(text)
  const uses = []
  for (const region of cssRegions(text, file)) {
    for (const m of stripComments(region.text).matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*(,)?/g)) {
      uses.push({
        name: m[1],
        line: lineOf(starts, region.offset + m.index),
        fallback: m[2] === ',',
      })
    }
  }
  return uses.sort((a, b) => a.line - b.line)
}

/** Every token the tree as a whole declares, anywhere in it. */
function declaredAcross(sources) {
  const declared = new Set()
  for (const [file, text] of sources) {
    for (const name of tokenDeclarationsIn(text, file)) declared.add(name)
  }
  return declared
}

/**
 * The findings, over a whole tree given as `Map<path, source>`.
 *
 * ⚠️ **Declarations pool across every file and uses do not.** A token declared in `tokens.css` and
 * used in a component is correct — that is the design system working — so the question is only
 * whether the tree as a whole declares what the tree as a whole uses.
 *
 * Returns one entry per (token, file, line) that is **undeclared and has no fallback**, sorted so
 * the list is stable enough to pin in a test.
 */
export function undeclaredTokenUses(sources) {
  const declared = declaredAcross(sources)
  const findings = []
  for (const [file, text] of sources) {
    for (const use of tokenUsesIn(text, file)) {
      if (use.fallback || declared.has(use.name)) continue
      findings.push({ token: use.name, file, line: use.line })
    }
  }
  return findings.sort(
    (a, b) => a.token.localeCompare(b.token) || a.file.localeCompare(b.file) || a.line - b.line,
  )
}

/**
 * The other list, reported and not enforced: tokens that are undeclared everywhere and only ever
 * reached through a fallback. Legal by the rule above — and the shape `105` actually found, so the
 * guard would be claiming something it does not do if this were not visible.
 *
 * A token with even one bare use is excluded, because {@link undeclaredTokenUses} already fails the
 * build on it and listing it here as "legal" would contradict that.
 */
export function fallbackOnlyTokens(sources) {
  const declared = declaredAcross(sources)
  const seen = new Map()
  for (const [file, text] of sources) {
    for (const use of tokenUsesIn(text, file)) {
      if (declared.has(use.name)) continue
      if (!seen.has(use.name)) seen.set(use.name, [])
      seen.get(use.name).push({ file, line: use.line, fallback: use.fallback })
    }
  }
  return [...seen]
    .filter(([, sites]) => sites.every((s) => s.fallback))
    .map(([token, sites]) => ({ token, sites }))
    .sort((a, b) => a.token.localeCompare(b.token))
}

/* ------------------------------------------------------------------ raw values */

/**
 * **Components read tokens, not values.** A theme can only restyle what reads a token, so a literal
 * style value in a component is a place a theme cannot reach. This scan names every such literal,
 * by family:
 *
 *  - `border`: a px width in a `border*` or `outline*` declaration;
 *  - `radius`: a px or % radius other than `0` and `50%` (a circle is geometry, not a style);
 *  - `colour`: a hex colour or a colour function (`rgb()`, `hsl()`, `oklch()`, `color-mix()`…);
 *  - `shadow`: a `box-shadow` or `text-shadow` with a non-zero px length or a literal colour;
 *  - `type`: a px/em/rem `font-size`, a numeric `font-weight`, a `font-family` that is not a token.
 *
 * The token file is where values belong, so it is not scanned. Everything else in the renderer is.
 *
 * ⚑ **An intended literal says so where it is written**: a declaration whose line carries a
 * `/* raw: <why> *\/` comment is not a finding (a spinner's stroke, a ring that knocks a dot out of
 * the art under it). The reason travels with the value, and a search for `raw:` lists them all.
 *
 * Same boundary as the token guard above: only CSS regions, comments blanked; `:style` bindings
 * and `style=""` attributes are not read. SVG `stroke-width` is icon geometry and no family here.
 */
export const RAW_FAMILIES = ['border', 'radius', 'colour', 'shadow', 'type']

/** The stylesheet where literal values are declared, and so the one file this scan skips. */
export const TOKEN_FILE = 'assets/tokens.css'

const PX = /(?<![\w.-])(?:\d*\.)?\d+px\b/
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix|color)\(/
const SIDE = '(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?'
const BORDER = new RegExp(`^(?:border|outline)${SIDE}(?:-width)?$`)
const RADIUS = /^border(?:-[a-z]+)*-radius$/

/** The families one declaration falls foul of, if any. */
function familiesOf(property, value) {
  const found = []
  if (BORDER.test(property) && PX.test(value)) found.push('border')
  if (RADIUS.test(property)) {
    const lengths = value.match(/(?<![\w.-])(?:\d*\.)?\d+(?:px|%)/g) ?? []
    if (lengths.some((l) => !/^0(?:px|%)$/.test(l) && l !== '50%')) found.push('radius')
  }
  if (COLOUR.test(value)) found.push('colour')
  if (/^(?:box|text)-shadow$/.test(property)) {
    const lengths = value.match(/(?<![\w.-])(?:\d*\.)?\d+px\b/g) ?? []
    if (lengths.some((l) => parseFloat(l) !== 0) || COLOUR.test(value)) found.push('shadow')
  }
  if (property === 'font-size' && /(?<![\w.-])(?:\d*\.)?\d+(?:px|r?em)\b/.test(value))
    found.push('type')
  if (property === 'font-weight' && /^\s*\d+\s*$/.test(value)) found.push('type')
  if (property === 'font-family' && !/^\s*(?:var\(|inherit\b|initial\b|unset\b)/.test(value))
    found.push('type')
  return found
}

/** Every literal style value in one file's CSS, as `{ family, line, declaration }`. */
export function rawValuesIn(text, file = 'x.css') {
  const starts = lineStarts(text)
  const found = []
  for (const region of cssRegions(text, file)) {
    const css = stripComments(region.text)
    const declaration = /(?<=^|[\s;{])(-{0,2}[a-zA-Z][\w-]*)\s*:\s*([^;{}]*?)\s*(?=[;}])/g
    for (const m of css.matchAll(declaration)) {
      const families = familiesOf(m[1].toLowerCase(), m[2])
      if (families.length === 0) continue
      const end = region.text.indexOf('\n', m.index + m[0].length)
      const tail = region.text.slice(m.index, end === -1 ? undefined : end)
      if (/\/\*\s*raw:/.test(tail)) continue
      const line = lineOf(starts, region.offset + m.index)
      for (const family of families) found.push({ family, line, declaration: `${m[1]}: ${m[2]}` })
    }
  }
  return found
}

/**
 * Every literal style value across a tree given as `Map<path, source>`, the token file excepted,
 * sorted by family, file and line.
 */
export function rawValueFindings(sources) {
  const findings = []
  for (const [file, text] of sources) {
    if (file === TOKEN_FILE) continue
    for (const f of rawValuesIn(text, file)) findings.push({ ...f, file })
  }
  return findings.sort(
    (a, b) => a.family.localeCompare(b.family) || a.file.localeCompare(b.file) || a.line - b.line,
  )
}

/** The findings counted per family and file — the shape a test pins while a family is paid down. */
export function rawValueCounts(findings) {
  const counts = Object.fromEntries(RAW_FAMILIES.map((family) => [family, {}]))
  for (const f of findings) counts[f.family][f.file] = (counts[f.family][f.file] ?? 0) + 1
  return counts
}
