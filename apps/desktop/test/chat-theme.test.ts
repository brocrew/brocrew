import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The scoped light conversation (Slice 2 · 022).
 *
 * Two things are worth pinning mechanically, because both fail SILENTLY — the app still renders,
 * it just becomes unreadable or quietly re-themes something it must not touch:
 *
 *  1. **Dark is unchanged.** The whole promise is that a fresh install looks exactly as it did.
 *     A stray light value landing on `:root` would repaint the entire app, and no other test
 *     would notice.
 *  2. **Light is legible.** 021's light was rejected for washed-out text and dark cards stranded
 *     on a light page. Contrast is arithmetic, so it is checked as arithmetic rather than by
 *     looking at a screenshot and hoping.
 *
 * The bar is the DESIGN's own: every conversation pair must clear 4.5:1, except where the
 * approved dark theme itself runs fainter (timestamps, placeholders) — there light must simply be
 * no worse than dark, because matching the shipped design is the point, not out-styling it.
 */

const CSS = readFileSync(
  fileURLToPath(new URL('../src/renderer/src/assets/tokens.css', import.meta.url)),
  'utf8',
)

/** The declarations of one rule, found by its SELECTOR at the start of a line — not by the first
 *  time the text appears, which also matches the prose in the file's own comments.
 *
 *  ⚠️ **`[,{]`, because a rule may have a SELECTOR LIST** (126). `[data-chat-theme='light']` and
 *  `[data-on-white]` are now two selectors on one block — the paper palette, entered conditionally
 *  by the toggle and unconditionally by a white island — and a pattern that demanded `{` on the
 *  same line found neither of them. The `{` is still located by scanning forward, which is correct
 *  either way: nothing between the selectors can contain a brace. */
/**
 * ⛔ **Comments are stripped before a single declaration is read** (344), and this is not tidiness.
 *
 * `rule()` matched `(--x)\s*:\s*([^;]+);` against the RAW stylesheet, so a comment that quoted a
 * declaration in order to explain it — *"light already sets `--accent-ink: #fff`"* — was parsed as
 * that declaration, with a value running to the next semicolon in the file and swallowing whatever
 * real declarations sat between. Measured when it happened: one such sentence made `--accent-ink`
 * non-colour AND made the token declared after it invisible, so this file reported two failures
 * neither of which existed in the CSS. ⚑ **A test that reads prose as code cannot be trusted about
 * either.** The line structure survives the strip, which is what the `^selector` search needs.
 */
const CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, ' ')

function rule(selector: string): Record<string, string> {
  const at = CODE.search(
    new RegExp(`^${selector.replace(/[[\]().*+?^$|\\]/g, '\\$&')}\\s*[,{]`, 'm'),
  )
  expect(at, `no rule for ${selector}`).toBeGreaterThanOrEqual(0)
  const open = CODE.indexOf('{', at)
  let depth = 0
  let end = open
  for (; end < CODE.length; end++) {
    if (CODE[end] === '{') depth++
    if (CODE[end] === '}' && --depth === 0) break
  }
  const out: Record<string, string> = {}
  for (const m of CODE.slice(open + 1, end).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out[m[1]!] = m[2]!.trim()
  }
  return out
}

const DARK = rule(':root')
const LIGHT = { ...DARK, ...rule("[data-chat-theme='light']") }

type Rgba = [number, number, number, number]

function resolve(tokens: Record<string, string>, value: string | undefined, depth = 0): string {
  const m = value === undefined ? null : /^var\((--[a-z0-9-]+)\)$/.exec(value.trim())
  return m && depth < 8 ? resolve(tokens, tokens[m[1]!], depth + 1) : (value ?? '')
}

function parse(color: string): Rgba | null {
  let c = color.trim()
  // A card's surface is a gradient, and its FIRST stop is the worst case for text at the top of
  // the card. Without this every gradient parsed as null, so the permission card — the one
  // surface 021's light got most wrong — could not be tested against its own background at all.
  const gradient = /^linear-gradient\([^,]+,\s*(.+)\)$/i.exec(c)
  if (gradient)
    c = gradient[1]!
      .split(/,(?![^(]*\))/)[0]!
      .trim()
      .replace(/\s+[\d.]+%$/, '')
  const hex6 = /^#([0-9a-f]{6})$/i.exec(c)
  if (hex6) return [0, 2, 4].map((i) => parseInt(hex6[1]!.slice(i, i + 2), 16)).concat(1) as Rgba
  const hex3 = /^#([0-9a-f]{3})$/i.exec(c)
  if (hex3) return [...hex3[1]!].map((h) => parseInt(h + h, 16)).concat(1) as Rgba
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(c)
  if (rgb) {
    const parts = rgb[1]!.split(',').map(Number)
    return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1]
  }
  return null
}

/** Composite a (possibly translucent) colour over what is behind it. */
function over(fg: Rgba, bg: Rgba): Rgba {
  if (fg[3] >= 1) return fg
  return [0, 1, 2].map((i) => fg[i]! * fg[3] + bg[i]! * (1 - fg[3])).concat(1) as Rgba
}

function luminance(c: Rgba): number {
  const [r, g, b] = [0, 1, 2].map((i) => {
    const s = c[i]! / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(tokens: Record<string, string>, fgToken: string, bgToken: string): number {
  const page = parse(resolve(tokens, tokens['--chat-bg'] ?? 'transparent'))
  const pageBg = page ?? parse(resolve(tokens, tokens['--bg']))!
  const rawBg = tokens[bgToken] === 'transparent' ? tokens['--bg'] : tokens[bgToken]
  const fg = parse(resolve(tokens, tokens[fgToken]))
  const bgRaw = parse(resolve(tokens, rawBg))
  expect(fg, `${fgToken} is not a colour`).not.toBeNull()
  expect(bgRaw, `${bgToken} is not a colour`).not.toBeNull()
  const bg = over(bgRaw!, pageBg)
  const [hi, lo] = [luminance(over(fg!, bg)), luminance(bg)].sort((a, b) => b - a) as [
    number,
    number,
  ]
  return (hi + 0.05) / (lo + 0.05)
}

/** Foreground → the surface it is actually painted on, across the conversation. */
const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['--text', '--chat-bg'],
  ['--text-soft', '--chat-bg'],
  ['--muted', '--chat-bg'],
  ['--text', '--panel-2'],
  ['--text-soft', '--panel-2'],
  // code — the block, its output, and raw JSON in the unknown entry
  ['--code-text', '--code-bg'],
  ['--code-text-dim', '--code-bg'],
  ['--code-text-quiet', '--code-bg-weak'],
  ['--mono-text', '--chat-bg'],
  ['--mono-text-dim', '--chat-bg'],
  // blue: links, the streaming tag, ink on the send button
  ['--accent-text-soft', '--chat-bg'],
  ['--accent-text-pale', '--info-bg'],
  ['--accent-ink', '--accent'],
  // amber: the permission card, and ink on its solid Approve button. The card's body copy is
  // measured against the CARD, which is what it is painted on — not against the page behind it.
  ['--waiting-text', '--waiting-card-bg'],
  ['--waiting-text-label', '--waiting-card-bg'],
  ['--waiting-text-soft', '--waiting-card-bg'],
  ['--waiting-text-weak', '--waiting-card-bg'],
  ['--waiting-text', '--waiting-bg'],
  ['--waiting-text-label', '--waiting-bg'],
  // ⚠️ **On `--panel-2`, not only on the amber it was tuned against** (105). Since 105 the amber
  // label is also the library's warning `.outcome` line and the reading pane's "behind" banner, and
  // both of those sit on a PANEL, not on a wash. Nothing checked that pairing anywhere in the repo,
  // so retuning the token for its amber background could have quietly made it illegible on its
  // other two surfaces.
  ['--waiting-text-label', '--panel-2'],
  ['--waiting-text-hint', '--composer-frozen-bg'],
  ['--waiting-ink', '--waiting'],
  ['--waiting', '--chat-bg'],
  // red: denied, errored, the interrupt glyph
  ['--danger-text', '--danger-bg'],
  ['--danger-text-soft', '--danger-bg'],
  ['--danger-text-pale', '--danger-bg'],
  ['--danger-text-notice', '--chat-bg'],
  ['--danger', '--chat-bg'],
  // the rest of the state grammar, as dots and glyphs
  ['--success', '--chat-bg'],
  ['--ready', '--chat-bg'],
  ['--neutral-glyph', '--chat-bg'],
  ['--accent-2', '--chat-bg'],
  /**
   * ⚑ **344 · the two body surfaces that had never been on paper**, and this half of the list is
   * what stops a light value being merely *present*.
   *
   * ⛔ **Measured, not reasoned**: three mutation rows that put a dark surface value BACK —
   * `--card-bg`, `--attention-bg`, `--side-footer-bg` — survived both of the guards that were
   * supposed to catch them. The stranded-token scan cannot see them (the token HAS a light value,
   * it is just the wrong one) and `strandedUnder` in `surface-boundaries.dom.test.ts` cannot
   * either: its criterion is *the same colour in both ramps*, and a dark translucent fill
   * composites to two different darks over two different pages. ⚠️ **A near-black card on paper is
   * not a scoping failure — it is a legibility failure**, and this is the file that measures those.
   *
   * Each pair is the ink the surface actually carries, on the surface it actually sits on.
   *
   * ⚑ **D-016 · the pairs whose surface was deleted went with it** — the attention row's prose and
   * action buttons, the project card, the workspace's footer, toolbar and status strip, the
   * auto-approve pill, the queued agent row and Home's solid *Start work* button. Their tokens are
   * deleted from `tokens.css`, so a pair naming them measures nothing.
   */
  ['--text', '--panel'], // the attention column, now *Waiting on you*
  /**
   * ⚑ **346 · the overlay layer.** Every sheet in this app is `background: var(--panel)`, which
   * light already had — so what these pairs measure is not a missing token but the thing 346 §1
   * predicted: *"the risk is not a dark island, it is a white document dissolving into light
   * chrome."*
   *
   * ⛔ **The toast pair is the one that could not have been read off a screenshot.** A toast is
   * 0.97-alpha over whatever is behind it, so its ink is measured against the COMPOSITE, and this
   * file composites `--toast-bg` over the page the way the engine does.
   *
   * ⚠️ **`--text` on `--toast-bg` was here and is gone**, because nothing paints it: both toasts in
   * this app declare `color: var(--text-soft)`, so the pair was green over a rendering that does
   * not exist. A pair that names an ink its surface does not carry is measuring nothing, which is
   * the defect 344 found in three of its own additions.
   */
  ['--text-soft', '--toast-bg'], // a toast's own sentence, in the ink both toasts declare
  // ⚠️ `--muted` and not `--faint`: the dispatch, recruit and project sheets all declared `--muted`
  // on their header's second line (all three deleted at D-016; the sheets that remain on `--panel`
  // paint `--muted` too). The all-documents sheet declared `--faint` there, which is in
  // DESIGN_RUNS_FAINT and is measured against dark rather than against 4.5.
  ['--muted', '--panel'],
  ['--faint', '--panel'],
]

/** Where the APPROVED dark design itself runs faint. Light only has to match it, not beat it. */
const DESIGN_RUNS_FAINT = new Set(['--faint', '--placeholder'])

describe('the light conversation is legible', () => {
  it.each(PAIRS.filter(([fg]) => !DESIGN_RUNS_FAINT.has(fg)))('%s on %s clears 4.5:1', (fg, bg) => {
    expect(contrast(LIGHT, fg, bg)).toBeGreaterThanOrEqual(4.5)
  })

  /**
   * ⚑ **The app-wide look: one floor for both themes.** This asked light to be no worse than
   * dark, because the approved dark design ran faint. Both themes now clear AA on their own (the
   * navy faint was strengthened to 6.4:1), so the relative exemption is replaced by the absolute
   * floor every other pair already meets.
   */
  it('the faint ramp clears 4.5:1 in both themes', () => {
    for (const [fg, bg] of [
      ['--faint', '--chat-bg'],
      ['--placeholder', '--panel-2'],
    ] as const) {
      expect(contrast(LIGHT, fg, bg), `light ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(DARK, fg, bg), `dark ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('every state in the grammar stays a DISTINCT hue in light — colour still carries meaning', () => {
    const hues = ['--accent', '--waiting', '--success', '--danger', '--accent-2', '--auto'].map(
      (t) => resolve(LIGHT, LIGHT[t]).toLowerCase(),
    )
    expect(new Set(hues).size).toBe(hues.length)
  })
})
