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

/**
 * A stylesheet or a component with its PROSE removed (105).
 *
 * The same shape `reading-pane.render.test.ts` uses for its provider scan, and here for the same
 * reason: a rule about what the code names must not be able to fire on a comment that names it in
 * order to explain it. `[^:]` before `//` so a `https://` in a comment or a URL is not mistaken for
 * the start of one.
 */
const withoutComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

/**
 * Everything INSIDE a light scope.
 *
 * ⚠️ **It was "everything the conversation pane renders" until 091, and that was too narrow rather
 * than merely imprecise.** ⛔ **NINE components carry `data-chat-theme` now, not one** — the pane,
 * the launcher, the reading pane and the session library (091), Home and the project workspace
 * (344), and `OverlayHost`, `CommandPalette` and `ToastStack` (346). The count has been wrong in
 * this comment after every one of those tasks, which is its own argument for reading the carriers
 * off the source rather than writing them down — which the two censuses at the foot of this file do.
 *
 * The launcher was already listed — at the bottom, and described there as an exception rather than
 * as one of several roots — so the description was already at odds with the list. The other two were simply absent, and it cost a real defect:
 * `--panel-3` had no light value because its only in-scope consumer is the library's row actions,
 * and the library was not on this list. These are scopes in their own right, not pane children.
 *
 * The drawer’s four tab bodies inherit the light scope from `.conversation-pane`.
 * `--drawer-bg` and `--mono-text-dim` need light values because they are painted on paper.
 *
 * Both directions are checked off this one list: nothing light overrides may go unpainted, and
 * nothing painted may be left at a dark value. Keeping two copies of it is how the two tests would
 * eventually disagree about which surface they are describing.
 */
const READING_SURFACE = [
  // The two boundaries outside the pane that were missing (091). `NewConversation` is the third and
  // was already here — see the bottom of this list, where it has been since 022.
  'ReadingPane',
  'SessionLibrary',
  'ConversationPane',
  'SessionHeader',
  'TranscriptView',
  'UserMessage',
  'AssistantMessage',
  'ToolEntry',
  'PermissionCard',
  'UserInputCard',
  // ⚑ **441's decision card sat here, beside the two it was a sibling of**, until D-016 deleted it
  // with proposals.
  'NoticeEntry',
  'UnknownEntry',
  'QueuedMessage',
  'PromptComposer',
  // ⚠️ **These five were inside the pane all along and were not on this list** — found by 082, when
  // removing the header's waiting dot left `--waiting-glow` looking dead. It was not: the activity
  // pill paints it, and the pill was simply missing from here, so a whole component's worth of
  // tokens had never been checked in either direction. A list of this kind is worth exactly what
  // its completeness is worth.
  //
  // ⚠️ `StateBadge` and `SoonChip` were added with them and then taken back off: neither is
  // rendered anywhere inside `ConversationPane` (they belong to Home, the project surfaces and the
  // document sheets). Listing a component that is NOT in the scope is the mirror of the bug above —
  // it would demand light values for tokens that are only ever painted on dark chrome. Caught in
  // review, having been claimed in a comment that said "inside the pane all along".
  'ActivityPill',
  'ThinkingEntry',
  'PlanEntry',
  'SubAgentEntry',
  // Mounted twice — inside the pane for the image viewer, and at the app root for the sheets. It is
  // listed for the first, which is the strictly safer of the two readings.
  'OverlayHost',
  // The one tabbed drawer (080) and everything it holds. It is a column INSIDE the pane, so the
  // light tokens reach it by inheritance — which means a token it paints and light forgot is a
  // dark island on white paper, exactly the shape --brand-mark-bg was.
  'SessionDrawer',
  'SessionPanel',
  // The pinned bot (090). Its own scoped block paints only `--line` and the spacing tokens, so it
  // adds nothing to the token set today — it is listed because the list is worth exactly its
  // completeness, and a component inside the pane that is missing from it is the shape of the bug
  // this file's comment above describes.
  'SessionBot',
  // The approval mode beside the plate, and the panel it opens over the pane.
  'CardApproval',
  'SessionInfo',
  'EventStream',
  // The Dropped tab and its transcript half (087). Both are inside the pane, and this file caught
  // them: `--success-text`/`--success-border` had no light value at all — the same shape as
  // `--wash-4`, which 086 caught by reading, and which nobody had hit because every other consumer
  // of the green tokens lives on Home or in a sheet. The meter's "reclaimed" note is the first one
  // in the scope, so this list is what turned a pale-mint-on-paper banner into a build failure.
  'SessionContext',
  'CompactionEntry',
  // ⚠️ **Three components are deliberately NOT here**, and all three for one reason: what they
  // paint is the APPROVED LIGHT SURFACE, which neither mode re-themes.
  //   · `ImageViewer` and `ImageEntry` — their mat is `--paper-bg`, the document paper the test at
  //     the bottom of this file pins as invariant.
  //   · `AgentState` (082) — its plate is `--badge-ink` over `--paper-line`, and "always white
  //     background" means white on dark chrome, in the drawer and on paper alike. A light override
  //     for it would be the same white, which the "did not actually change" test above rejects.
  //   · ⚠️ **`ChildWorkViewer`, `WorkflowOutputViewer`, `CanonicalDocumentViewer` and
  //     `DocumentBody` (126, 510)** — and these four are a HOLE rather than a clean exclusion,
  //     which is why they are written down. They paint
  //     the invariant paper palette AND ambient tokens, so neither answer is right: measured, adding
  //     them turns this file red demanding light values for eleven `--paper-*` names plus
  //     `--badge-ink`, and leaving them off is what let `ChildWorkViewer`'s `--badge-ink` chip ship
  //     at 2.01:1 until `126` measured it by hand. Closing it needs a per-token distinction this
  //     list cannot express — named for the PM, not swept.
  //     🔴 **510 joined the fourth deliberately, and it is NOT a new hole**: its frame is
  //     `WorkflowOutputViewer`'s to the declaration — `--drawer-solid`, `--line`, `--text-soft`,
  //     `--faint`, `--muted` — and its paper is `DocumentBody`'s, so listing it would demand light
  //     values for exactly the tokens the two beside it are excluded for. ⚠️ **Nothing here went
  //     red when it shipped**, which is the property this comment records rather than fixes: the
  //     roster is derived from nothing, and `overlays-on-paper.dom.test.ts` and
  //     `dom/paper-ink.dom.test.ts` are where its paper IS measured.
  // Listing any of them would demand a light value for exactly the tokens that must not have one.
  // The state colours `AgentState` draws are NOT unprotected by the omission: it names them in
  // `lib/agent-state.ts` rather than in its template, so no component list could have seen them —
  // `agent-state.test.ts` checks every one of them against both themes at its source instead.
  // The empty new-conversation surface is themed too — and is what a fresh install opens on.
  'NewConversation',
  // Home and the project workspace carry data-chat-theme="light". Check their named tokens
  // and the components below them within that light scope.
  //
  // ⚠️ **They are eleven components, not two.** `AttentionQueue` and `SinceYouWereLastHere` are CHILDREN of
  // a body surface rather than siblings of one, and the eight below them were never named
  // anywhere: the scope reaches whatever the surface renders, so a component list that stops at
  // the roots measures the roots and nothing else. That is 083's point about `READING_SURFACE`
  // made against `READING_SURFACE` for the third time.
  //
  // 🔴 **606 · and WHICH root is no longer `HomeSurface` for either of them.** ⛔ `EXT-008` §3
  // split Home in two: `AttentionQueue` and `SinceYouWereLastHere` are `WaitingOnYou`'s children.
  // ⚑ **The list below did not have to move**, and that is the property
  // being relied on: it names what owes a light value, not who happens to mount it — which is
  // rule `27.1`'s *a census is scoped by what it is ABOUT, not by where the things it is about
  // currently live.*
  //
  // ⚑ **D-016 · Home and the project workspace are deleted**, and with them the Home and project
  // children below (`AttentionRow`, `ProjectCard`, `ProjectEmpty`, `PlaceholderBanner`,
  // `DocumentRow`, `AgentRow`, `SoonChip`) and the seed-only sheets further down. ⛔ **`HomeSurface`
  // was the one member that painted `--attention-bg` and `--attention-footer-bg`**, so with it gone
  // the census below found both overridden and painted by nothing on this list — while
  // `WaitingOnYou`, the root `606` split them into, paints both on paper. Its two roots take
  // `HomeSurface`'s place, which is 27.1's rule again: the list names what owes a light value.
  // The page's footer is gone, and its token with it, so it paints `--attention-bg` alone.
  'WaitingOnYou',
  'RecentActivity',
  'SinceYouWereLastHere',
  'AttentionQueue',
  // ⚑ **401's escalated group, and it is on this list TWICE OVER**: it is a child of `HomeSurface`
  // like the two around it, and it is also drawn by `OverlayHost`, which has carried
  // `data-chat-theme="light"` since `346`. ⚠️ Both of its mounts are inside a light scope, so
  // every token it names owes a light value — which is what made it take the pill trio rather
  // than `--waiting`, a near-black there.
  'PersonsQueue',
  // ⚠️ **`SpawnStopLane` was never on this list and has been in a light scope since `390`** —
  // found while adding the neighbour above it, and free: measured, every token it names already
  // has a light value, so this closes a hole rather than opening work. ⛔ The hole was real: it
  // paints `--danger-border`, `--danger` and `--success` on paper and nothing checked any of
  // them against a light value.
  'SpawnStopLane',
  // ⚠️ **`SoonChip` and `StateBadge` were taken OFF this list in 082**, with the note that they
  // "belong to Home, the project surfaces and the document sheets". That was true and is now the
  // reason they come back: Home and the project surfaces are the light scopes.
  //
  // ⛔ **The sentence after it said they were "still rendered on dark chrome too (the sheets)", and
  // 346 makes that false in every one of its parts.** Enumerated: their consumers are `AgentRow`,
  // `AttentionRow`, `DocumentRow`, `ProjectCard`, `PlaceholderBanner`, `HomeSurface`,
  // `ProjectWorkspace`, the three sheets, and `AgentState` — and there is no longer a dark one
  // among them. What was an argument for two values is now simply the history of one.
  // ⚑ **D-016 deleted `SoonChip` and every consumer named above but `AgentState`**; `StateBadge`
  // stays, drawn by `WorkFacts`.
  'StateBadge',
  // ⛔ **`AgentState` is in the closure and stays OFF, for the reason already written above it**:
  // its plate is `data-on-white`, a white island in either theme, so a light override for it would
  // be the same white the "did not actually change" test rejects. 344 adds a caller — the
  // attention queue — and changes nothing about that: the plate is the same white on paper as it
  // was on near-black, and what surrounds it is the surface's tokens, which ARE on this list.
  //
  // `OverlayHost` carries the light scope itself, placing all five panels below inside it.
  // Inheriting only from the conversation pane would cover the image viewer but leave other
  // overlays outside the scope.
  //
  // ⚠️ **Five of the app's six overlay mount sites needed nothing at all**, and counting them
  // rather than recalling them is what kept this list honest: `ConversationPane` raises three and
  // `ReadingPane` two, all INSIDE a `data-chat-theme="light"` surface, so the image viewer, the
  // workflow output and the child-work reader have been opening on paper since 344. Only
  // `RuntimeScreen`'s host was outside — and the app was dimming itself two different ways
  // depending on which component raised the overlay.
  // ⚑ **D-016 deleted those five panels** (`DispatchModal`, `DocumentDrawer`, `AllDocumentsSheet`,
  // `RecruitSheet`, `ProjectSheet`); the sheets below are the ones the host still raises.
  // 355 · the second wired sheet. Hosted like its five neighbours, so it declares no scope of its
  // own and is here only so its own tokens are checked against the light block.
  'CapabilitiesSheet',
  // ⚑ **358 · the tools sheet.** It is hosted by `ConversationPane`'s own `OverlayHost` rather than
  // by `RuntimeScreen`'s, so the `HOSTED` roster below does not see it — and THIS list is derived
  // from nothing, so a surface left off it is silently unchecked rather than red. Added by the
  // dispatch that ships it, which is the only mechanism this list has.
  'SessionTools',
  // ⛔ **Teleported to `body`, so it inherits nothing and carries its own attribute.** It is on this
  // list for the same reason as the rest: its `--accent-border-weak` hover was a pale-blue-on-
  // near-black edge with no paper value, and only this scan could say so.
  'CommandPalette',
  // The toasts. ⚠️ **`RuntimeScreen` is the second one and is deliberately NOT on this list** — it
  // paints the titlebar and the app frame, which are the chrome, so listing it would demand light
  // values for exactly the tokens that must not have one. Its `.toast` rule is checked on its own,
  // by name, in the test at the bottom of this file: a scope inside a file this list cannot admit
  // is a hole, and naming it beats sweeping it.
  'ToastStack',
  // The recovery window is its own light scope, and its banner paints the waiting-card tokens.
  'RecoveryApp',
]

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

  /**
   * 🔴 **391 · the notice ladder, which was a comment for as long as it has been a rule.**
   *
   * `NoticeEntry.vue` draws a `warn` notice in `--waiting` (line 54) and a routine one in `--faint`
   * (line 25), on the same page, in the same component. The amber has to read as the heavier of the
   * two or the two kinds of notice stop being two kinds. ⛔ **`--waiting`'s own docblock has said so
   * since 022 and named the number that breaks it** — *"within 9% of the same weight… the notice
   * ladder stopped being a ladder"* — and nothing measured it.
   *
   * ⚠️ **391 is why it is here.** Taking v2.5.1's `--amber` verbatim moved the light pair from
   * **1.536×** to **1.107×** — inside the failing band the docblock names — and the whole suite
   * stayed green. The value was corrected to the mock's HUE at the old weight; this is what stops
   * the next palette from doing it silently.
   *
   * ⚑ **Both themes, because the chrome draws this pair too** (`AppTitleBar.vue:240`, and every
   * agent row). The dark side has far more room — 2.26× — and the bound is not there to be tight,
   * it is there to be crossed audibly.
   */
  it.each([
    ['light', LIGHT],
    ['dark', DARK],
  ] as const)('%s: a warn notice is visibly heavier than a routine one', (_name, tokens) => {
    const warn = contrast(tokens, '--waiting', '--chat-bg')
    const routine = contrast(tokens, '--faint', '--chat-bg')
    expect(
      warn / routine,
      `--waiting reads ${warn.toFixed(2)}:1 and --faint ${routine.toFixed(2)}:1 — 391 measured ` +
        "1.107 with the mock's amber taken verbatim, and 022 called 1.09 the point where the " +
        'ladder stops being one',
    ).toBeGreaterThanOrEqual(1.3)
  })

  it('every state in the grammar stays a DISTINCT hue in light — colour still carries meaning', () => {
    const hues = ['--accent', '--waiting', '--success', '--danger', '--accent-2', '--auto'].map(
      (t) => resolve(LIGHT, LIGHT[t]).toLowerCase(),
    )
    expect(new Set(hues).size).toBe(hues.length)
  })
})

describe('dark is untouched', () => {
  it('the light values are scoped to the pane, never declared on :root', () => {
    // The whole safety property: a light value on :root would repaint the rail, the titlebar and
    // Home — the exact thing 022 exists NOT to do.
    expect(DARK['--text']).toBe('#f1f2ff')
    expect(DARK['--accent']).toBe('#ff8a5c')
    expect(DARK['--waiting']).toBe('#ffc857')
    expect(DARK['--danger']).toBe('#ff6b81')
    expect(DARK['--panel-2']).toBe('#272a4a')
  })

  it('EVERY token light overrides still has its own dark value, and they differ', () => {
    // Pinning a handful of tokens by hand leaves most of the stated safety property untested, and
    // the untested ones are the likely accidents. This covers the whole block: a light value that
    // slipped into :root shows up as the two being identical, and a light override for a token
    // :root never declared shows up as a missing dark value.
    const overridden = Object.keys(rule("[data-chat-theme='light']")).filter((t) =>
      t.startsWith('--'),
    )
    expect(overridden.length).toBeGreaterThan(50)
    for (const token of overridden) {
      expect(DARK[token], `${token} is invented by light, not re-themed`).toBeDefined()
      expect(resolve(LIGHT, LIGHT[token]), `${token} did not actually change`).not.toBe(
        resolve(DARK, DARK[token]),
      )
    }
  })

  it('light re-themes ONLY tokens the conversation actually paints', () => {
    // An override for something no component in a LIGHT SCOPE consumes is dead code that reads as
    // if this block re-themes more of the app than it does. "In a light scope" rather than "in the
    // pane" since 091 — `--panel-3` is painted by the session library, which is a scope of its own,
    // and under the narrower reading a legitimate token looked dead.
    // ⚑ **The app-wide look: plus the viewers that draw PAPER inside a light scope** — a document, a
    // diff, a tool's answer and a child's work, in the pane or on the light overlay layer (346).
    // ⛔ Only here: their `--paper-*` colours are invariant by design, so the mirror test below
    // must not ask light to re-tune them; what they paint around the paper (its shadow) is light's.
    const components = [
      ...READING_SURFACE,
      'DocumentBody',
      'DiffBody',
      'ToolAnswerViewer',
      'ChildWorkViewer',
    ]
    const used = new Set<string>()
    for (const name of components) {
      const src = readFileSync(
        fileURLToPath(new URL(`../src/renderer/src/components/${name}.vue`, import.meta.url)),
        'utf8',
      )
      for (const m of src.matchAll(/var\((--[a-z0-9-]+)/g)) used.add(m[1]!)
    }
    // base.css paints the pane's inherited defaults, so what it consumes is in-scope too.
    const base = readFileSync(
      fileURLToPath(new URL('../src/renderer/src/assets/base.css', import.meta.url)),
      'utf8',
    )
    for (const m of base.matchAll(/var\((--[a-z0-9-]+)/g)) used.add(m[1]!)
    // ⚑ **The app-wide look: the shared classes, and the aliases each light scope re-binds.**
    // `classes.css` draws inside every light scope, and an alias declared in the shared alias block
    // (`--state-auto: var(--auto)`) resolves in the light scope, so what it reads is painted there.
    const classes = readFileSync(
      fileURLToPath(new URL('../src/renderer/src/assets/classes.css', import.meta.url)),
      'utf8',
    )
    for (const m of classes.matchAll(/var\((--[a-z0-9-]+)/g)) used.add(m[1]!)
    const aliasAt = CODE.indexOf(":root,\n[data-chat-theme='light'],\n[data-on-white] {")
    if (aliasAt !== -1) {
      for (const m of CODE.slice(aliasAt, CODE.indexOf('}', aliasAt)).matchAll(
        /var\((--[a-z0-9-]+)/g,
      ))
        used.add(m[1]!)
    }

    const light = rule("[data-chat-theme='light']")
    // `--chat-bg` is the pane's own background and is consumed by the pane's scoped style block.
    const dead = Object.keys(light).filter((t) => t.startsWith('--') && !used.has(t))
    expect(dead, `overridden but never painted inside any light scope: ${dead.join(', ')}`).toEqual(
      [],
    )
  })

  it('nothing the conversation paints is left at a dark value in light', () => {
    // The mirror of the test above, and the one that catches a stranded dark island at its
    // source: a colour token the pane paints but light forgot to re-tune. --brand-mark-bg was
    // exactly this — the bot tile on the empty surface kept a wash tuned for near-black.
    const components = READING_SURFACE
    const used = new Set<string>()
    for (const name of components) {
      const src = readFileSync(
        fileURLToPath(new URL(`../src/renderer/src/components/${name}.vue`, import.meta.url)),
        'utf8',
      )
      for (const m of src.matchAll(/var\((--[a-z0-9-]+)/g)) used.add(m[1]!)
    }
    const light = rule("[data-chat-theme='light']")
    /**
     * ⚠️ **CONTAINS a colour, not STARTS with one** (344). It anchored at `^` until this task, and
     * that skipped every token whose value is a box-shadow: `--queued-glow` is
     * `0 0 0 3px rgba(167, 139, 250, 0.08)` — a violet tuned for near-black, painted by `AgentRow`,
     * and invisible to a check that reads the leading `0`. Same shape as the `--warning` hole the
     * test below this one exists to close: a filter that is nearly right is a filter that reports
     * a clean sweep over the cases it cannot see.
     */
    const isColour = (v: string | undefined): boolean =>
      /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|linear-gradient/i.test(v ?? '')
    // Tokens chosen to read on both grounds, so one value serves both themes: a control's edge
    // clears 3:1 on the navy frame and on paper alike. The jump-to-latest button's shadow has
    // always been one black shadow on both grounds; it is a token now, with that same value.
    const SAME_IN_BOTH = new Set(['--control-border', '--shadow-float'])
    const stranded = [...used]
      .filter((t) => !(t in light) && !SAME_IN_BOTH.has(t) && isColour(DARK[t]))
      .sort()
    expect(stranded, `painted in the pane but still dark in light: ${stranded.join(', ')}`).toEqual(
      [],
    )
  })

  it('nothing the conversation paints is a token NO stylesheet defines', () => {
    /**
     * ⚠️ **The hole the test above leaves, and `--warning` sat in it across three surfaces** (105).
     *
     * `stranded` filters on `isColour(DARK[t])`, so a token `:root` never declared at all is not
     * "still dark in light" — it is nothing, and it was skipped. `SessionLibrary` wrote
     * `var(--warning, var(--text-soft))` at two sites and `ReadingPane` a third, `--warning` is
     * declared in no stylesheet in this repo, and so every caution on both surfaces shipped in its
     * FALLBACK colour from 065 until 105 — while three comments beside them said "warning-coloured".
     *
     * A fallback makes that silent; it does not make it right. The rule is simply: name a token
     * that exists. A deliberate fallback is still allowed — it just has to fall back *from*
     * something, so `var(--x, …)` where `--x` is real keeps working and `var(--typo, …)` does not.
     */
    const read = (path: string): string =>
      readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
    const declarations = (src: string): string[] =>
      // A DECLARATION is `--x:`; a reference is `var(--x`. Only the first shape can define one.
      //
      // ⚠️ **The optional quote is not cosmetic** (344). A component may declare a custom property
      // on its own root through an inline `:style` binding, where the key is a JS object key and
      // therefore quoted — `StateBadge` does exactly that, mapping a state to `--badge` and
      // `--badge-tint`. Without the quote this scan read those two as references with no
      // declaration anywhere, and the first surface to render a badge on paper would have failed
      // the check for a reason that had nothing to do with the theme.
      [...src.matchAll(/(--[a-z0-9-]+)['"]?\s*:/g)].map((m) => m[1]!)

    /**
     * ⚠️ **Global declarations are global; a component's own are its own** (105 review).
     * The first version of this unioned every source into one `declared` set, so a
     * `--card-gap: 8px` declared inside ONE component's `<style scoped>` block — a live pattern in
     * this repo, `PromptComposer` does it — would have satisfied a `var(--card-gap)` typed into a
     * completely unrelated component that can never inherit it. Scoped means scoped: a component
     * may name what the stylesheets declare, plus whatever it declares itself.
     */
    const global = new Set([
      ...declarations(withoutComments(CSS)),
      ...declarations(withoutComments(read('../src/renderer/src/assets/base.css'))),
    ])

    /**
     * 🔴 **529 · a component may also declare through a MODULE it binds to its root's `:style`.**
     *
     * ⛔ **`526` put four `--role-*` properties on `EventStream`'s root as an inline object and
     * the quote clause above is what let this scan see them.** `529` lifted that object into
     * `lib/text-roles.ts` so three tabs could share one bridge — at which point the keys left
     * every `.vue` file and five real declarations became five undeclared references.
     *
     * ⚠️ **Widened by OPT-IN AT THE CALL SITE, never by name.** The gate is the binding actually
     * appearing in the template (`:style="ROLE_PROPERTIES"`), not the import — a module a
     * component merely imports declares nothing on its root, and
     * `an-entitlement-widening-must-be-opt-in-at-the-call-site` is the shape this follows. ⛔ A
     * token declared in any other `lib/` module is still undeclared here, which is what the
     * control below proves.
     */
    const BOUND_STYLE_MODULES = [
      { binding: 'ROLE_PROPERTIES', from: '../src/renderer/src/lib/text-roles.ts' },
    ] as const

    const bridged = (src: string): string[] =>
      BOUND_STYLE_MODULES.filter((mod) => src.includes(`:style="${mod.binding}"`)).flatMap((mod) =>
        declarations(withoutComments(read(mod.from))),
      )

    // ⛔ The widening is not vacuous: the module really does declare, and really does declare
    // these. A typo in the path would otherwise make `bridged` an empty list that widens nothing
    // and the failure would land on the components instead.
    expect(bridged('<div :style="ROLE_PROPERTIES">').sort()).toEqual([
      '--role-field',
      '--role-label',
      '--role-meta',
      '--role-prose',
      '--role-value',
    ])
    // …and it is the BINDING that opens it, not the import.
    expect(bridged("import { ROLE_PROPERTIES } from '../lib/text-roles'")).toEqual([])

    let seen = 0
    let widened = 0
    const undeclared = new Set<string>()
    for (const name of READING_SURFACE) {
      const src = withoutComments(read(`../src/renderer/src/components/${name}.vue`))
      const carried = bridged(src)
      if (carried.length > 0) widened++
      const own = new Set([...global, ...declarations(src), ...carried])
      for (const m of src.matchAll(/var\((--[a-z0-9-]+)/g)) {
        seen++
        if (!own.has(m[1]!)) undeclared.add(`${name}: ${m[1]!}`)
      }
    }
    // ⚑ …and at least one surface on the roster actually took the widening, or the block above is
    // a rule nothing exercises.
    expect(
      widened,
      'no reading surface binds a style module — the widening is dead',
    ).toBeGreaterThan(0)

    // Non-vacuity: this scan has to be reading the real vocabulary, not an empty set.
    expect(
      seen,
      'the scan found almost no token uses — it is looking at the wrong text',
    ).toBeGreaterThan(200)
    expect(global.size, 'the stylesheets declared almost nothing').toBeGreaterThan(150)
    expect(
      global.has('--warning'),
      '--warning is still undefined; do not define it to pass this',
    ).toBe(false)

    const missing = [...undeclared].sort()
    expect(missing, `named but defined nowhere it can reach: ${missing.join(', ')}`).toEqual([])
  })

  it('…and that scan catches a token that does not exist, but not one only a comment names', () => {
    // The mirror, in-process rather than by editing a file and remembering to put it back: a
    // reference with no declaration must be reportable, or the test above passes by seeing nothing.
    //
    // ⚠️ And the second half is not hypothetical: the FIRST version of the test above scanned the
    // raw text, so writing the comment that explains `--warning` re-created the failure it was
    // explaining. A rule that cannot be documented without breaking is a rule nobody will document.
    expect(withoutComments('/* it wrote var(--warning, x) here */').includes('--warning')).toBe(
      false,
    )
    expect(withoutComments('<!-- var(--warning) -->').includes('--warning')).toBe(false)
    // …and stripping does not eat the code beside it.
    expect(withoutComments('/* a */ color: var(--text);')).toContain('var(--text)')

    const source = '.x { color: var(--nope-not-a-token, var(--text)); }\n:root { --text: #fff; }'
    const declared = new Set([...source.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]!))
    const referenced = [...source.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]!)
    expect(referenced.filter((t) => !declared.has(t))).toEqual(['--nope-not-a-token'])
  })

  it('the pane paints NOTHING of its own in dark, so the app glow still shows through', () => {
    expect(DARK['--chat-bg']).toBe('transparent')
  })

  /**
   * ⚑ **Every surface the app renders as a BODY declares the light scope, and the list is read off
   * `RuntimeScreen` rather than kept beside it** (344).
   *
   * The light scheme applies to the body zone, including conversation and project views;
   * headers and left menus remain dark. Each surface root carries `data-chat-theme`. A census
   * is needed because another surface can be mounted in `<main>` without a scope, putting
   * paper ink on the dark app frame.
   *
   * ⛔ **So the enumeration is taken from the branch list itself.** Whatever `RuntimeScreen` mounts
   * inside `<main>` is a body and must declare the attribute in its own template.
   *
   * ⚠️ **The sentence here read "the rail, the titlebar and every overlay are outside `<main>`, are
   * dark chrome by 080's carrier rule, and are deliberately not asked" — and 346 retired two thirds
   * of it.** The overlays are outside `<main>` and are asked, by the test below this one; only the
   * rail and the titlebar are not.
   */
  it('every surface RuntimeScreen renders as a BODY declares the light scope (344)', () => {
    const read = (path: string): string =>
      readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
    const screen = read('../src/renderer/src/components/RuntimeScreen.vue')
    const open = screen.indexOf('<main class="main">')
    const close = screen.indexOf('</main>', open)
    expect(open, 'RuntimeScreen has no <main> — this census is reading nothing').toBeGreaterThan(0)
    expect(close).toBeGreaterThan(open)

    const bodies = [
      ...new Set([...screen.slice(open, close).matchAll(/<([A-Z]\w+)[\s/>]/g)].map((m) => m[1]!)),
    ]
    // Non-vacuity: `<main>` really holds every surface below, so an empty match set cannot pass.
    // ⚠️ **Stated without a COUNT** (`396`, and `458`'s rule): this sentence read *"the nine
    // surfaces"* and `606` made it eleven — a sentence that counts a list it does not own goes
    // quietly wrong the first time the list grows.
    // ⚑ **566 added `ToolsRegister` and this line is what made it carry the attribute.** The
    // census fired on the branch before the scope existed, which is the whole design above: the
    // enumeration is taken from `RuntimeScreen`'s own branch list, so an eighth body cannot be
    // mounted without this literal moving in the same commit.
    // 🔴 **570 is the second time it did exactly that, and the harder case.** `TeamWorkspace` had
    // been on `develop` since `568` with no `data-chat-theme` and no scope of its own — and
    // nothing was wrong, because nothing mounted it. ⛔ The attribute became load-bearing at the
    // moment the branch was written, which is the one moment this census reads.
    // ⚑ **572 is the third, and it is the one that shows the census is not about NEW files.**
    // `ProjectsBoard` was written with the attribute on it, so this literal is the only line
    // that had to move — which is what a census earns when it is derived rather than listed.
    // 🔴 **606 is the fourth and it added TWO at once** — `WaitingOnYou` and `WhileYouWereAway`,
    // `EXT-008` §3's split of Home into what he owes and what changed. ⛔ Both were written with
    // the attribute on, so again this literal is the only line that had to move.
    // ⚑ **701 was the fifth** — `KeptOpenPane`, a conversation the quit left open before anything
    // had started it. ⚑ **D-017b took it away again**: every conversation opens in the one full
    // view (`ConversationPane`), so this literal is again the only line that moved.
    // ⚑ **D-016 took three away** — `HomeSurface`, `ProjectWorkspace` and `ProjectsBoard`, with
    // Home and projects — so this literal is again the only line that moved.
    // An archived conversation's read-only history is a page here now, not a sheet, so it is one.
    expect(bodies.sort()).toEqual([
      'ConversationPane',
      'LinkedHistory',
      'NewConversation',
      'ReadingPane',
      'RecentActivity',
      'SessionLibrary',
      'SettingsScreen',
      'TeamWorkspace',
      'WaitingOnYou',
    ])

    const unscoped = bodies.filter(
      (name) =>
        !read(`../src/renderer/src/components/${name}.vue`).includes('data-chat-theme="light"'),
    )
    expect(
      unscoped,
      `rendered in <main> but declaring no light scope: ${unscoped.join(', ')}`,
    ).toEqual([])
  })

  /**
   * ⚑ **346 · the same census, for the layer that is NOT inside `<main>`.**
   *
   * Overlays also use the light scheme. Because an overlay is not reached through a `<main>`
   * branch, pair the body census with an overlay census so both populations follow the app’s
   * mounting structure.
   *
   * ⛔ **Three carriers rather than one per surface, and that is the design being asserted rather
   * than the outcome.** ⚠️ **This read *"rather than nine"* until `606` made the body list
   * eleven** — `458`'s rule, on a sentence rather than on a number. `OverlayHost` carries the scope for everything it hosts, so a sheet added tomorrow
   * is light because it was hosted; the palette carries its own because Vue teleports it to `body`
   * where it inherits nothing; the toast stack carries its own because it is fixed to the app frame
   * and nothing hosts it. Asserting the three carriers is what makes the five panels' silence safe
   * — and the fourth part of this test is the paired positive that the panels really are silent, so
   * a panel that started declaring its own scope would be a finding rather than a shrug.
   */
  it('every overlay is a light scope, and three carriers is how (346)', () => {
    const read = (name: string): string =>
      readFileSync(
        fileURLToPath(new URL(`../src/renderer/src/components/${name}.vue`, import.meta.url)),
        'utf8',
      )
    const CARRIERS = [
      { name: 'OverlayHost', rule: '.overlay-host {' },
      { name: 'CommandPalette', rule: '.palette-scrim {' },
      { name: 'ToastStack', rule: '.toast-stack {' },
    ]
    for (const { name, rule: selector } of CARRIERS) {
      const source = read(name)
      expect(source, `${name} is a scope carrier and declares no light scope`).toContain(
        'data-chat-theme="light"',
      )

      /**
       * 🔴 **A scope has to re-ask for the INK as well as declare itself** (346), and this is the
       * half no screenshot could have caught. `color` inherits as a resolved COLOUR rather than as
       * the `var()` that produced it: `body` resolves `var(--text)` outside every scope and hands
       * `#e7ecf3` down into everything under it, a light scope included. Measured on the live build
       * before this line existed — all five sheets and the palette computed `rgb(231, 236, 243)` on
       * their own roots.
       *
       * ⛔ **Read out of the carrier's OWN rule, not out of the file.** `CommandPalette` writes
       * `color: var(--text)` in three other rules, so a `toContain` on the whole source is
       * satisfied by a neighbour and stays green with the carrier's own declaration deleted.
       */
      const at = source.indexOf(selector)
      expect(
        at,
        `${name} has no ${selector} rule — this census is reading nothing`,
      ).toBeGreaterThan(0)
      const rule = source.slice(at, source.indexOf('}', at))
      expect(rule, `${selector} re-declares no ink, so it inherits the chrome's`).toContain(
        'color: var(--text)',
      )
    }

    // ⛔ The panels are hosted, so they must NOT carry one of their own: a second declaration is a
    // second place the ruling can be changed, and 091 is the dispatch that paid for exactly that.
    // ⚑ **D-016 deleted six of these** — `DispatchModal`, `DocumentDrawer`, `AllDocumentsSheet`,
    // `RecruitSheet`, `ProjectSheet` and `NewProject` — so the roster below is what the host still
    // raises, read off the two templates at the foot of this test.
    const HOSTED = [
      'CapabilitiesSheet',
      // 423. ⚑ Hosted exactly as `NewProject` was, and it copies that component's declarations and
      // none of its scope — so the light scope stays the `OverlayHost`'s, in one place.
      'NewAgent',
      // 423 relay 1. ⚑ The app's SECOND launch door, hosted like the rest and carrying no scope
      // of its own — the `PromptComposer` inside it inherits the overlay's light scope, which is
      // the one place that ruling lives.
      'StartAsAgent',
      // 516. ⚑ The registry block, hosted exactly as `NewAgent` is: it copies that component's
      // declarations and none of its scope, so the light scope stays the `OverlayHost`'s — in one
      // place, which is the whole of what this roster defends.
      'ExternalMcpRegistry',
      // 626 · `EXT-015` §1. ⚑ **What shapes one agent, read from two doors** — hosted exactly as
      // `CapabilitiesSheet` is, and it carries no `data-chat-theme` of its own for that component's
      // reason: the light scope is the `OverlayHost`'s, and a second declaration here would be a
      // second place the `346` ruling could be changed. ⛔ **It was missing from this roster and
      // the roster is what said so** — the sheet shipped with `626` and nothing named it until the
      // census ran ([[an-alpha-fill-in-a-light-scope-is-not-a-light-surface]]).
      'AgentSectionsSheet',
      // The confirmation before a conversation is deleted: hosted, so it inherits the light scope.
      'DeleteConversation',
      // 401. ⚑ **Hosted by `OverlayHost`'s OWN template rather than through the slot**, which is
      // a shape this roster could not see: the derivation below read `RuntimeScreen`'s slice
      // alone, so the two components the overlay layer draws for EVERY panel were enumerated
      // nowhere and a `data-chat-theme` of their own would have gone unnoticed. Both templates
      // are read now.
      'PersonsQueue',
      'SpawnStopLane',
    ]
    for (const name of HOSTED) {
      expect(
        // ⛔ **Comments stripped, and it is not precautionary**: all three of the newest entries
        // NAME the attribute in the docblock that argues for inheriting it, so a raw read would
        // fail them for explaining the rule they obey.
        withoutComments(read(name)),
        `${name} is hosted and should inherit the scope, not declare it`,
      ).not.toContain('data-chat-theme')
    }

    // …and the host really does host all seven, read off `RuntimeScreen` rather than trusted.
    // ⚠️ **Five until `355` added `CapabilitiesSheet` to `HOSTED` and left this sentence behind**
    // (365, found while checking the integration's roster resolution). The equality below is what
    // enforces the count; this line is the half a reader trusts, and it was wrong.
    const screen = readFileSync(
      fileURLToPath(new URL('../src/renderer/src/components/RuntimeScreen.vue', import.meta.url)),
      'utf8',
    )
    expect(
      screen.indexOf('<OverlayHost'),
      'RuntimeScreen raises no OverlayHost — this census is reading nothing',
    ).toBeGreaterThan(0)
    // The slice starts at the opener, so the host matches itself — dropped by name rather than by
    // slicing past `>`, because the opening tag spans lines and the `>` that ends it is not the
    // first one in the slice.
    // ⚑ **Both templates, since `401`.** The slot's occupants come from `RuntimeScreen`; the two
    // the host draws for every one of them come from `OverlayHost`'s own template, and reading
    // only the first is how a component could be hosted here and enumerated nowhere. ⚠️ Sliced
    // from `<template>` so the `<HTMLElement` generics in its script are not read as tags, and
    // stripped of comments so the `<OverlayHost` its docblock mentions is not read as one either.
    // ⚠️ **The indices are taken on the STRIPPED text**, not on the raw one they were found in —
    // slicing one string with the other's offsets is how this census came back holding two names
    // and losing five.
    const slotted = withoutComments(screen)
    const overlay = withoutComments(read('OverlayHost'))
    const tags = (text: string): string[] =>
      [...text.matchAll(/<([A-Z]\w+)[\s/>]/g)].map((m) => m[1]!)
    const hosted = [
      ...new Set([
        ...tags(slotted.slice(slotted.indexOf('<OverlayHost'), slotted.indexOf('</OverlayHost>'))),
        ...tags(overlay.slice(overlay.indexOf('<template>'))),
      ]),
    ]
      // Vue's own Teleport draws the host into the screen's layer; it hosts nothing of its own.
      .filter((name) => name !== 'OverlayHost' && name !== 'Teleport')
      .sort()
    expect(hosted).toEqual([...HOSTED].sort())
  })

  /**
   * ⛔ **The one light scope this file's component list cannot admit** — `RuntimeScreen` paints the
   * titlebar and the app frame, so putting it on `READING_SURFACE` would demand light values for
   * exactly the tokens that must not have one. Its `.toast` is a body all the same (346), so the
   * rule is read by name and every token it paints is checked on its own.
   *
   * ⚠️ Without this, those four tokens are covered only by ACCIDENT — each happens to have another
   * consumer that is on the list — and an accident is not a guard.
   */
  it('the app frame’s own notice toast paints nothing that is dark-only (346)', () => {
    const screen = readFileSync(
      fileURLToPath(new URL('../src/renderer/src/components/RuntimeScreen.vue', import.meta.url)),
      'utf8',
    )
    expect(screen, 'the notice toast lost its light scope').toContain(
      '<div v-if="notice" class="toast" data-cy="toast" data-chat-theme="light">',
    )
    const at = screen.indexOf('\n.toast {')
    expect(at, 'RuntimeScreen has no .toast rule — this census is reading nothing').toBeGreaterThan(
      0,
    )
    const body = screen.slice(at, screen.indexOf('}', at))
    const painted = [...body.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]!)
    expect(painted.length, 'the .toast rule paints no token at all').toBeGreaterThan(3)
    const light = rule("[data-chat-theme='light']")
    const isColour = (v: string | undefined): boolean =>
      /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|linear-gradient/i.test(v ?? '')
    const stranded = painted.filter((t) => !(t in light) && isColour(DARK[t]))
    expect(stranded, `the notice toast still paints in the dark: ${stranded.join(', ')}`).toEqual(
      [],
    )
  })

  /**
   * 🔴 **391 · the rule at the head of `tokens.css`, asserted on the three components that ARE the
   * dark zone.**
   *
   * That file's second paragraph is a rule, not a preference: *"components consume ONLY these
   * tokens — never hand-copy a hex/px value into a component. If a value is missing here, add it
   * here first."* ⛔ **A palette change cannot reach a value that is not in the palette**, and
   * `ClosingShade.vue` was carrying `rgba(7, 9, 13, 0.86)` as a raw literal for as long as it has
   * existed. 391 would have shipped a near-black quit shade over a navy app — visible only while
   * the app is closing, which is the moment nobody photographs and no test opens.
   *
   * ⚑ **These three and not every component**, because these three are what `:root` is FOR: the
   * title bar, the rail and the shade that covers both. Everything else is inside a light scope
   * and `agent-state.test.ts` already makes this assertion for the plate.
   *
   * ⚠️ **The positive half is what stops it being vacuous**: each file is asserted to paint at
   * least one token, and the detector is shown to fire on a planted hex.
   */
  it('the three components that ARE the dark chrome carry no colour of their own', () => {
    const chrome = ['AppTitleBar', 'SideRail', 'ClosingShade'] as const
    for (const name of chrome) {
      const src = readFileSync(
        fileURLToPath(new URL(`../src/renderer/src/components/${name}.vue`, import.meta.url)),
        'utf8',
      )
      expect(src, `${name}.vue carries a hex`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
      expect(src, `${name}.vue carries an rgb()`).not.toMatch(/\brgba?\(/)
      expect(src, `${name}.vue carries an hsl()`).not.toMatch(/\bhsla?\(/)
      expect(
        src.match(/var\(--/g)?.length ?? 0,
        `${name}.vue paints no token at all`,
      ).toBeGreaterThan(3)
    }
    // ⚠️ **And the detector fires.** A census that cannot see the thing it forbids is a census that
    // passes for the wrong reason — the defect `312` filed against three of this file's own scans.
    expect('  background: rgba(7, 9, 13, 0.86);').toMatch(/\brgba?\(/)
    expect('  color: #07090d;').toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  it('the document viewer keeps its own paper in both themes', () => {
    // --paper-* is the approved light palette light MODE anchors on; re-theming it would change
    // the document drawer, which is explicitly out of scope.
    expect(rule("[data-chat-theme='light']")['--paper-bg']).toBeUndefined()
    // ⚑ The app-wide look's approved paper: BroCrew's warm white (was `#fdfdff`, before that `#f8faff`).
    expect(DARK['--paper-bg']).toBe('#fbfaf7')
    // ⚑ **391 · the INK too, and it was not pinned by anything at all.** The background had this
    // line and the ink had none, so a mutation putting the paper back to its neutral near-black
    // (`#1b1f24`) survived every floor in the repository — floors only look DOWN, and a darker ink
    // passes them all. What makes the paper the paper is the pair, and both halves are invariant.
    expect(rule("[data-chat-theme='light']")['--paper-ink']).toBeUndefined()
    // ⚑ The app-wide look's paper ink: BroCrew's indigo (was `#2d3753`, before that `#28334e`).
    expect(DARK['--paper-ink']).toBe('#171a3a')
  })

  /**
   * ⚑ **391 · `--rail` and `--rail-bg` are two declarations and one surface.**
   *
   * `SideRail.vue:1006` paints `--rail-bg` — a radial over a three-stop linear — and `:1431` paints
   * `linear-gradient(0deg, var(--rail), transparent)` under the anchored footer, so that the list
   * scrolling behind it fades into the rail rather than under a band. ⛔ **The fade only reads as a
   * fade if the two agree**, and nothing measured that: 391 moved `--rail-bg` onto v2.5.1's own
   * sidebar gradient and a row putting `--rail` back to `#090c12` survived every suite — the rail
   * has no colour test of any kind, which is the gap this closes rather than a defect it caught.
   */
  it('the rail fades into its own colour — --rail is where --rail-bg starts', () => {
    const rail = DARK['--rail']
    const bg = DARK['--rail-bg']
    expect(rail, '--rail is not a hex').toMatch(/^#[0-9a-f]{6}$/)
    // The linear layer is the rail's body; the radial in front of it is the mock's own corner lift.
    const linear = /linear-gradient\([^)]*?,\s*(#[0-9a-f]{6})/i.exec(bg ?? '')
    expect(linear, `--rail-bg has no linear stop to read: ${bg}`).not.toBeNull()
    expect(
      linear![1]!.toLowerCase(),
      'the footer fade lands on a colour the rail does not paint',
    ).toBe(rail!.toLowerCase())
  })
})
