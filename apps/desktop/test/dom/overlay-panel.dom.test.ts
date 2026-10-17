import { afterEach, describe, expect, it } from 'vitest'
import AgentState from '../../src/renderer/src/components/AgentState.vue'
import ChildWorkViewer from '../../src/renderer/src/components/ChildWorkViewer.vue'
import WorkflowOutputViewer from '../../src/renderer/src/components/WorkflowOutputViewer.vue'
import type {
  ChildWorkResult,
  TranscriptEvent,
  WorkflowOutputResult,
} from '../../src/shared/runtime-ipc'
import {
  channelGap,
  contrast,
  luminance,
  mount,
  paintedBackground,
  paintedInk,
  parseColor,
  show,
  unmountAll,
  type Mounted,
  type Rgba,
} from './harness'

/**
 * **125 · A document overlay has a panel, and you cannot read the conversation through it.**
 *
 * The open-transcript popup paints an opaque surface instead of showing the page through its
 * panel.
 *
 * Both document overlays said `background: var(--surface-1)`, and `--surface-1` is declared in no
 * stylesheet in this repo — used twice, declared nowhere. An undeclared custom property makes the
 * whole declaration **invalid at computed-value time**, so `background` fell back to its initial
 * value, `transparent`. The only thing between either panel and the running conversation was
 * `OverlayHost`'s backdrop: 32% alpha on light, 58% on dark.
 *
 * ⚠️ **This file is in the DOM project and not the SSR one for the reason that IS the bug.** A test
 * that read the SFC would have seen `background: var(--surface-1)` and called it styled — the
 * declaration was there the whole time and looked perfectly ordinary. Only a real cascade knows
 * that the token resolves to nothing. That is 083's whole thesis, and this is the third defect to
 * land on the right side of it.
 *
 * ⛔ **The primary assertion is ALPHA, not colour, and deliberately.** Measured: in dark the broken
 * panel read `rgb(5, 7, 10)` (L 0.0020) and the fixed one reads `rgb(14, 19, 28)` (L 0.0064) — both
 * comfortably inside this file's own `< 0.1` dark threshold, so **a luminance test would have passed
 * on the broken build** in the theme that was the default at the time (`RuntimeScreen` started
 * `chatLight` false until 344 retired the toggle; the dark ramp is now the chrome's).
 * The alpha of the element's own `background-color` is 1 or it is not, in either theme, and it is
 * exactly what "you can see through it" means.
 */

afterEach(unmountAll)

/** The child's file, in the events the importer really produces — enough to render a panel. */
const CHILD: ChildWorkResult = {
  ok: true,
  part: 'transcript',
  name: 'agent-a4d82f4376e9dd5c5.jsonl',
  runId: 'wf_7658bea5-b25',
  taskId: 'waw6gpzzj',
  text: '{"type":"assistant_message","text":"Done."}',
  truncated: false,
  bytes: 43,
  // ⚠️ No `as ChildWorkResult`. The annotation alone type-checks this literal, and the cast would
  // additionally suppress a MISSING required field — so a fixture that had drifted from the type
  // would keep compiling. Found in review.
  entries: [{ type: 'assistant_message', text: 'Done.' }],
}

const OUTPUT: WorkflowOutputResult = {
  ok: true,
  name: 'journal.jsonl',
  text: '{"agent":1,"result":"ok"}',
  truncated: false,
  bytes: 25,
}

/**
 * The two overlays, each with the `data-cy` of its own panel — which IS the element carrying the
 * background, so the assertion reads the thing the fix changed rather than a wrapper near it.
 */
const OVERLAYS = [
  {
    what: 'the sub-agent transcript popup',
    component: ChildWorkViewer,
    props: { result: CHILD, label: 'fixture:overflow' },
    cy: 'child-work-viewer',
  },
  {
    what: 'the workflow output document',
    component: WorkflowOutputViewer,
    props: { result: OUTPUT, workflow: 'find-flaky-tests' },
    cy: 'workflow-output-viewer',
  },
] as const

/**
 * Mount an overlay where it really sits: inside a column that declares the chat theme, which is
 * what `ConversationPane` and `ReadingPane` both do at their roots. `OverlayHost` does not teleport,
 * so the overlay is a descendant of that scope and every token in it re-resolves through the theme —
 * verified, and the reason `--drawer-solid` is the right token rather than a dark-only one.
 */
function inColumn(
  overlay: (typeof OVERLAYS)[number],
  theme: 'light' | 'dark',
  behind?: string,
): Mounted {
  const view = mount(overlay.component, { ...overlay.props }, { width: 900 })
  view.host.setAttribute('data-chat-theme', theme)
  if (behind) view.host.style.background = behind
  return view
}

/**
 * The element's OWN paint, before any compositing — this is where `transparent` shows up.
 *
 * ⛔ **It throws rather than defaulting**, which is the same call `harness.ts` makes for the same
 * reason. A `?? [0, 0, 0, 0]` fallback here was a false GREEN on the `toBe(0)` assertion below: any
 * colour the parser could not read — the day a token moves to `oklch()` — would have satisfied
 * "the panel is transparent" while the panel was perfectly opaque. Found in review.
 */
function ownBackground(el: Element): Rgba {
  const declared = getComputedStyle(el).backgroundColor
  const parsed = parseColor(declared)
  if (!parsed)
    throw new Error(`unparseable background-color "${declared}" — update the colour model`)
  return parsed
}

describe('a document overlay is a panel, not a pane of glass (125)', () => {
  /**
   * ⛔ **The assertion the ticket is.** `transparent` computes to `rgba(0, 0, 0, 0)`, so this is 0
   * on the shipped-broken build and 1 on the fixed one — in both themes, which matters because the
   * dark one hid it.
   */
  it.each(
    OVERLAYS.flatMap((o) =>
      (['light', 'dark'] as const).map((theme) => ({ ...o, theme, name: `${o.what} · ${theme}` })),
    ),
  )('$name: the panel is OPAQUE', (overlay) => {
    const view = inColumn(overlay, overlay.theme)
    const own = ownBackground(view.q(overlay.cy))
    expect(
      own[3],
      `${overlay.what} paints ${show(own)} at alpha ${own[3]} in ${overlay.theme} — an undeclared token computes to transparent`,
    ).toBe(1)
  })

  /**
   * ⚠️ **The second half, and it is what rules out the two wrong fixes.** An opaque panel is not
   * enough: it has to be opaque in the theme the conversation is wearing, because it sits INSIDE
   * that scope.
   *
   *  - `--panel` — the house fill for `DispatchModal` and `RecruitSheet` — is declared only on
   *    `:root`, so it would paint #0d1118 on a light page. That is 091's `--panel-3` trap exactly:
   *    an opaque near-black chip on paper.
   *  - `--paper-bg` has no dark value, so the panel would be #f7f8fa in both — and this header's
   *    own `--text-soft` is #c2cad6 on dark, which is 1.55:1 on paper. The same trap, inverted.
   *
   * `--drawer-solid` is #0e131c / #ffffff and moves with the scope, so this passes; either wrong
   * token fails one of the two rows.
   *
   * ⚠️ **Two limits, because review measured them and the comment above would otherwise overclaim.**
   * (1) `--panel-2` and `--panel-3` also pass both rows — this separates "theme-following" from
   * "not", never "the right theme-following token", and the palette has an empty luminance band
   * from 0.012 to 0.877 so no threshold inside it would behave differently. (2) There is no
   * `[data-chat-theme='dark']` rule anywhere — `tokens.css` declares light only — so the dark row
   * reads `:root` and would pass with the chat-theme scoping deleted outright. **The light row
   * carries all of this test's discriminating power**; the dark row is a regression pin.
   */
  it.each(OVERLAYS)('$what follows the conversation it is opened over', (overlay) => {
    const light = luminance(paintedBackground(inColumn(overlay, 'light').q(overlay.cy)))
    const dark = luminance(paintedBackground(inColumn(overlay, 'dark').q(overlay.cy)))
    expect(
      light,
      `${overlay.what} is not light on a light conversation (L=${light})`,
    ).toBeGreaterThan(0.7)
    expect(dark, `${overlay.what} is not dark on a dark conversation (L=${dark})`).toBeLessThan(0.1)
  })

  /**
   * ⛔ **The escape, reproduced** — 083's criterion, and the one that makes the two tests above
   * mean something: *"a harness that cannot reproduce a known escape has not been shown to work."*
   *
   * Restore the shipped `var(--surface-1)` declaration and place a sentinel color, belonging
   * to neither theme, behind the panel. A correct panel paints its own fill with no sentinel;
   * the broken panel paints the sentinel because its own fill is absent.
   *
   * ⚠️ Same mount, one line apart, so this says *this CHANGED* rather than *this was always so*.
   */
  it.each(
    OVERLAYS.flatMap((o) =>
      (['light', 'dark'] as const).map((theme) => ({ ...o, theme, name: `${o.what} · ${theme}` })),
    ),
  )('⚠️ $name: put --surface-1 back and the conversation shows through', (overlay) => {
    const BEHIND = 'rgb(255, 0, 255)'
    const SENTINEL: Rgba = [255, 0, 255, 1]
    const view = inColumn(overlay, overlay.theme, BEHIND)
    const panel = view.q(overlay.cy)

    const shipped = paintedBackground(panel)
    expect(
      channelGap(shipped, SENTINEL),
      `the shipped panel already paints what is behind it — ${show(shipped)}`,
    ).toBeGreaterThan(100)
    // ⚠️ No second opacity assertion here — the `it.each` above already makes it on these exact
    // four rows, and `host.style.background` cannot change a descendant's own `background-color`.
    // Review found the duplicate; keeping it would have been coverage that was only more lines.

    // The declaration that was there until this task, restored verbatim.
    panel.style.background = 'var(--surface-1)'

    const broken = paintedBackground(panel)
    expect(
      channelGap(broken, SENTINEL),
      `--surface-1 is back and the panel still paints ${show(broken)} — the guard below is measuring nothing`,
    ).toBe(0)
    expect(ownBackground(panel)[3], 'an undeclared token did not compute to transparent').toBe(0)
  })
})

/* =========================================================================================
   126 · The other half of the same complaint: the panel is opaque, and you still cannot read it
   ========================================================================================= */

/**
 * **126 · Ink on paper.**
 *
 * `125` made the popup opaque and that is what made this visible. `ChildWorkViewer`'s `.paper` is
 * `--paper-bg` in both themes by design — but the CONVERSATION on it comes through `TranscriptView`
 * on the AMBIENT ink ramp, and in dark that ramp is near-whites meant for a near-black page. The
 * sub-agent's own message text measured **1.55:1**.
 *
 * ⛔ **The fix is a SCOPE and it is `data-on-white`** (tokens.css §14), not a per-class override and
 * not a second `data-chat-theme` carrier. The attribute already means "a white island whatever the
 * theme", which is exactly what this paper is; `data-chat-theme="light"` would claim the reader had
 * switched a toggle they had not, and would make this a second carrier inside a surface `091`
 * asserts has exactly one. `091`'s assertion is therefore untouched.
 *
 * ## The thresholds, and what they REJECT
 *
 * Both are measured bounds on THIS surface, not numbers the palette happens to clear.
 *
 *  - **{@link READABLE} = 3:1**, over every text element on the document body. It is WCAG AA for
 *    large text and for non-text contrast, and it is the standard line that FITS: the correct
 *    palette's measured FLOOR on this paper is **4.06:1** (`--faint` on the child card's wash), and
 *    the broken build's measured CEILING is **2.96:1** (`--muted` on paper). The separating band is
 *    (2.96, 4.06], so 4.5 — AA for body text — is not available here without re-tuning `--faint` in
 *    the light theme, which is a different ticket and is named in the response.
 *    ⚠️ **The tightest rejection is 0.04**, and that is stated rather than hidden: 3:1 is the bottom
 *    of the band, not a comfortable middle.
 *    **What it rejects, measured on the shipped build**: **25 of the paper's 34** text elements —
 *    `--code-text-dim` 1.06, `--danger` 1.28, `--mono-text` 1.44, `--accent-text-soft` 1.52,
 *    `--text-soft` 1.55–1.56 (eight elements), `--waiting` 1.67, `--success` 1.70, `--muted` 2.96
 *    (nine) — i.e. every rung of the dark ink ramp and every dark state colour, placed on paper.
 *  - **{@link PROSE} = 4.5:1**, on the message bodies — WCAG AA for body text, and the ticket's own
 *    subject: *"that is the sub-agent's own message text, the entire point of the viewer."* It
 *    rejects the shipped 1.55:1 with 2.95 of margin; the fixed build reads 12.49:1.
 *
 * ⚠️ **Every number above is from the OPACITY-AWARE sensor** ({@link paintedInk}), and the first
 * version of this file was not. Review measured what that cost: on a fixture containing a
 * `compaction`, 31 of 40 elements were painted below the bar this file claims to enforce while
 * `bad` came back empty. Numbers taken with a blind sensor are worse than no numbers, so these were
 * all re-taken.
 */

/** Every text element on a document body clears this. WCAG AA large-text / non-text. */
const READABLE = 3

/** A message body — prose — clears this. WCAG AA body text. */
const PROSE = 4.5

/**
 * A child's transcript holding one of everything that draws text on the paper.
 *
 * ⚠️ **Deliberately much richer than {@link CHILD} above**, because "cover the whole document body"
 * is the ruling and a two-event fixture would have walked four elements. A message, a tool call and
 * a failing tool result, a thought, a plan with its own document, a child card, a permission and an
 * error notice — nine renderers, and what makes the walk a walk.
 *
 * ⛔ **NO CAST, and review is why.** Every event here type-checks against `TranscriptEvent` on its
 * own, so a fixture that drifts from the schema is a build failure rather than a silent
 * mis-render. The first version wore `as unknown as TranscriptEvent[]` and hid four invalid
 * events: a `thinking` with an `id` and no `phase`, a plan step at `in_progress` (not a status —
 * the middle step never got `.step.active`), an `error` with a `scope` and no `fatal` (so it drew
 * as a WARN notice, not the error notice this comment claimed to cover), and a `compaction`
 * missing `source`. Found in review, by deleting the cast and reading the four type errors.
 *
 * ⛔ **`compaction` is deliberately ABSENT, and it is the sharpest thing this fixture says.** It
 * renders fine — but `TranscriptView` fades every row ABOVE the newest one to `opacity: 0.5`
 * (`.entry.summarised-out`), and on paper that collapses near-black ink to **2.86:1** where on the
 * near-black page it stays at 3.63:1. That is a real number on a real affordance, and it is NOT
 * this viewer's: `import-claude.ts` emits seven event types and `compaction` is not among them, so
 * no child file this door opens can contain one. Asserting the popup against a state it cannot
 * enter would be a red for someone else's surface. The measurement is in the response, for the PM.
 */
const RICH: TranscriptEvent[] = [
  { type: 'user_turn', text: 'Return a fixture that breaks a one-line row.' },
  { type: 'tool_call', id: 'toolu_1', name: 'StructuredOutput', summary: '[fixture-overflow]' },
  { type: 'tool_result', id: 'toolu_1', ok: true, summary: '{"prefix":"[fixture-overflow]"}' },
  { type: 'assistant_message', text: 'Done — the fixture is in the structured output.' },
  { type: 'thinking', phase: 'complete', text: 'Weighing two shapes for the fixture.' },
  {
    type: 'plan_update',
    steps: [
      { text: 'Read the file', status: 'done' },
      { text: 'Write the fixture', status: 'active' },
      { text: 'Run the suite', status: 'pending' },
    ],
    note: 'Two shapes considered.',
    body: '# Plan\n\nDo the small thing first.',
  },
  {
    type: 'sub_agent',
    agentId: 'a1111111111111111',
    phase: 'ended',
    kind: 'Explore',
    title: 'Count the lines',
    outcome: 'completed',
    summary: 'Eleven.',
    usage: { tokens: 4210, toolCalls: 3, ms: 8400 },
  },
  {
    type: 'permission_request',
    id: 'req_1',
    kind: 'command',
    action: 'Bash',
    detail: 'run: ls',
    scope: {
      cwd: '/work',
      paths: ['write /work/out.txt'],
      networkHosts: [],
      persistence: 'once',
      amendments: [],
      availableDecisions: ['allow', 'deny'],
      underDisclosed: false,
    },
  },
  { type: 'error', fatal: false, message: 'The provider dropped the connection.' },
  { type: 'tool_call', id: 'toolu_2', name: 'Bash', summary: 'rm -rf /tmp/x' },
  { type: 'tool_result', id: 'toolu_2', ok: false, summary: 'Permission denied' },
]

const RICH_CHILD: ChildWorkResult = {
  ...CHILD,
  text: RICH.map((event) => JSON.stringify(event)).join('\n'),
  thinkingBlocks: 3,
  entries: RICH,
}

const RICH_OUTPUT: WorkflowOutputResult = {
  ok: true,
  name: 'answer.md',
  text: '# Heading\n\nSome **bold** prose and `code`.\n\n- one\n- two\n\n[a link](https://x)\n',
  truncated: true,
  bytes: 250_000,
}

/**
 * The two DOCUMENT BODIES — the surface the ruling is about, which is not the whole panel.
 *
 * ⚠️ **The panel chrome around them is out of the walk, and on purpose.** The header's filename sits
 * at 3.35:1 in dark (`--faint` on `--drawer-solid`) — that is the app's ordinary dark chrome,
 * identical to every timestamp in the transcript behind it, and a threshold that failed it would be
 * re-styling the app rather than fixing this ticket. What the ticket is about is ink on PAPER.
 */
const BODIES = [
  {
    what: "the sub-agent's transcript",
    component: ChildWorkViewer,
    props: { result: RICH_CHILD, label: 'fixture:overflow' },
    /** The paper itself, which is the element carrying the scope. */
    body: 'child-work-paper',
    /** Below this the walk saw too little to be a walk. Measured: 34, both themes. */
    floor: 30,
  },
  {
    what: "the workflow run's output",
    component: WorkflowOutputViewer,
    props: { result: RICH_OUTPUT, workflow: 'find-flaky-tests' },
    body: 'document-body',
    /** Measured: 10, both themes. */
    floor: 8,
  },
] as const

const THEMES = ['light', 'dark'] as const

/** A short, human name so a failure says WHICH element rather than "an element". */
function label(el: Element): string {
  const cy = el.getAttribute('data-cy')
  const cls =
    typeof el.className === 'string' && el.className ? `.${el.className.split(' ')[0]}` : ''
  return `${el.tagName.toLowerCase()}${cls}${cy ? `[${cy}]` : ''}`
}

interface Ink {
  what: string
  ratio: number
  fg: Rgba
  bg: Rgba
  /** The first few words identify a failure on the visible screen. */
  says: string
}

/**
 * Every element under `root` that paints TEXT OF ITS OWN, with what that text reads at.
 *
 * ⚠️ **"Of its own" means a direct non-empty text node**, and the alternative is worse in both
 * directions: every ancestor of a paragraph would otherwise be reported with the paragraph's words
 * and its own (inherited, identical) colour, which triples the list without adding a claim — and an
 * element whose `color` differs from its parent's but which only wraps other elements paints no ink
 * at all, so calling it unreadable would be a finding about nothing.
 *
 * ⛔ **The ratio comes from {@link paintedInk}, not from `paintedBackground`, and that is a review
 * finding rather than a preference.** The first version read `color` against `paintedBackground` —
 * neither of which knows about `opacity` — and on a fixture containing a `compaction` it reported
 * `12.49:1` for ink Chromium was painting at `2.86:1`, over 31 of its own 40 elements. Both
 * acceptance walks were green over numbers wrong by up to 4×. The sensor now folds the opacity
 * chain; the fixture no longer contains the event; and the pairing below reproduces the escape.
 */
function inkUnder(root: Element): Ink[] {
  const out: Ink[] = []
  for (const el of [root, ...root.querySelectorAll('*')]) {
    const own = [...el.childNodes].some(
      (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim().length > 0,
    )
    if (!own) continue
    const declared = getComputedStyle(el).color
    const colour = parseColor(declared)
    // ⛔ Loud, not silent — `125`'s own lesson twice over. A `?? [0,0,0,0]` here would make every
    // unreadable colour model read as pure black, which clears 3:1 on paper: the day a token moves
    // to `oklch()` this file would go green over text nobody could see.
    if (!colour)
      throw new Error(`unparseable color "${declared}" on ${label(el)} — update the model`)
    if (colour[3] === 0) continue // genuinely invisible by design; there is no ratio to ask about
    const { fg, bg } = paintedInk(el, colour)
    out.push({
      what: label(el),
      ratio: contrast(fg, bg),
      fg,
      bg,
      says: (el.textContent ?? '').trim().slice(0, 40),
    })
  }
  return out.sort((a, b) => a.ratio - b.ratio)
}

const failing = (ink: Ink[], bar: number): string[] =>
  ink
    .filter((i) => i.ratio < bar)
    .map((i) => `${i.ratio.toFixed(2)}:1  ${i.what}  ${show(i.fg)} on ${show(i.bg)}  "${i.says}"`)

function openBody(overlay: (typeof BODIES)[number], theme: 'light' | 'dark'): Mounted {
  const view = mount(overlay.component, { ...overlay.props }, { width: 900 })
  view.host.setAttribute('data-chat-theme', theme)
  return view
}

describe('ink on paper: a document you can actually read (126)', () => {
  /**
   * ⛔ **The ticket, as a number, over the WHOLE body rather than `.msg-body` alone** — which is
   * §1's ruling: *"whichever you pick, it must cover the whole document body."*
   */
  it.each(
    BODIES.flatMap((o) => THEMES.map((theme) => ({ ...o, theme, name: `${o.what} · ${theme}` }))),
  )('$name: every word on the paper clears 3:1', (overlay) => {
    const view = openBody(overlay, overlay.theme)
    const ink = inkUnder(view.q(overlay.body))
    // The walk is a walk. Without this the report below is `expect([]).toEqual([])`.
    expect(ink.length, `${overlay.what}: the walk covered ${ink.length} elements`).toBeGreaterThan(
      overlay.floor,
    )
    const bad = failing(ink, READABLE)
    expect(
      bad,
      `unreadable on ${overlay.what} in ${overlay.theme}:\n  ${bad.join('\n  ')}`,
    ).toEqual([])
  })

  /**
   * Apply the stricter body-text bar to both `.msg-body` and the assistant’s `<p>`. Find both
   * by walking the rendered content, so a renamed selector cannot silently evade the check.
   */
  it.each(THEMES)("the sub-agent's own words clear 4.5:1 · %s", (theme) => {
    const view = openBody(BODIES[0], theme)
    const paper = view.q('child-work-paper')
    const prose = inkUnder(paper).filter((i) =>
      /Return a fixture that breaks|Done — the fixture is/.test(i.says),
    )
    // ⚠️ Both of them, or a fixture that stopped rendering one would pass on the other.
    expect(prose.map((p) => p.what).sort(), 'the two message bodies are not on the paper').toEqual([
      'div.msg-body[user-message]',
      'p',
    ])
    const bad = failing(prose, PROSE)
    expect(bad, `the sub-agent's prose is unreadable in ${theme}:\n  ${bad.join('\n  ')}`).toEqual(
      [],
    )
  })

  /**
   * ⛔ **The escape, reproduced** — and this is what makes the two tests above mean something. The
   * scope is removed from the paper and nothing else is touched, so the panel keeps `125`'s opaque
   * background and the paper keeps `--paper-bg`: the ONLY thing that changes is which ramp the ink
   * comes from. The same walk, one line apart, must go from silent to naming the ticket.
   *
   * ⚠️ **Dark only, and the asymmetry is the finding.** In light the ambient ramp already IS the
   * paper ramp, so removing the scope changes nothing there — which is precisely why this shipped:
   * the theme it was broken in was the app's DEFAULT at the time (`RuntimeScreen` started
   * `chatLight` false until 344 retired the toggle), and the one it was fine in is the one nobody
   * had to look at.
   */
  it('⚠️ take the scope off the paper and the sub-agent’s words go back to 1.55:1', () => {
    const view = openBody(BODIES[0], 'dark')
    const paper = view.q('child-work-paper')

    expect(failing(inkUnder(paper), READABLE), 'the fixed build is not clean').toEqual([])

    paper.removeAttribute('data-on-white')

    const broken = inkUnder(paper)
    const bad = failing(broken, READABLE)
    // ⛔ Not "at least one" — the difference between a scope and a per-class override. The bar is
    // under the measurement so a fixture that grows stays honest.
    //
    // ⚑ **Re-measured at `587`: 20 of 33, where it was 25 of 34.** ⚠️ **The fixture did not shrink
    // — the tool rows changed shape.** Each settled call was a bordered card carrying a `strong`
    // tool name, a monospace `code` argument and a status dot; it is now one quiet line, and the
    // walk finds `span.chevron` + `span.label[tool-run-head]` (+ one `span.amiss`) in their place.
    // 🔴 **Five of those elements clear the bar unscoped where the card's ink did not**, which is a
    // fact about the new ink and not about this ticket — the ticket's own number is asserted below
    // and did not move.
    expect(bad.length, 'removing the scope changed almost nothing').toBeGreaterThan(18)
    // …and the specific number the ticket is: the sub-agent's own message text.
    const msg = broken.find((i) => i.says.startsWith('Done — the fixture'))
    expect(msg, 'the assistant message vanished from the walk').toBeDefined()
    expect(msg!.ratio, `the shipped ink measured ${msg!.ratio.toFixed(2)}:1`).toBeLessThan(1.6)
    // ⚑ The paper itself did NOT move: this is about the ink, not about `125`'s panel coming back.
    // ⚑ BroCrew's warm paper, `--paper-bg` #fbfaf7 (was #fdfdff).
    expect(channelGap(paintedBackground(paper), [251, 250, 247, 1])).toBe(0)
  })

  /**
   * ⛔ **The sensor's own escape** — because the sensor was the bug once already.
   *
   * `TranscriptView` fades every row above a compaction boundary to `opacity: 0.5`
   * (`.entry.summarised-out`). A walk built on `color` and `paintedBackground` reads NONE of that:
   * on a fixture containing a compaction it reported 12.49:1 for ink Chromium painted at 2.86:1,
   * over 31 of 40 elements, and both acceptance walks above were green through it.
   *
   * So the fade is applied here directly, to the element the ticket is about, and the walk has to
   * see it. The 0.5 is `TranscriptView`'s own number rather than an invented one.
   *
   * ⚠️ **The pairing is `paintedBackground` staying blind**, not just `paintedInk` seeing: without
   * it this passes on a sensor that fades everything it is shown, including the surfaces 080's
   * assertions read.
   */
  it('⚠️ a faded row is measured faded — the sensor that was green over 31 elements', () => {
    const view = openBody(BODIES[0], 'dark')
    const paper = view.q('child-work-paper')
    const before = inkUnder(paper).find((i) => i.says.startsWith('Done — the fixture'))
    expect(before, 'the assistant message is not on the paper').toBeDefined()
    expect(before!.ratio).toBeGreaterThan(PROSE)

    // `TranscriptView`'s own `.entry.summarised-out` value, applied to the row that carries it.
    const row = paper.querySelector<HTMLElement>('.entry')
    expect(row, 'no transcript row to fade').not.toBeNull()
    const msg = [...paper.querySelectorAll<HTMLElement>('.entry')].find((e) =>
      (e.textContent ?? '').includes('Done — the fixture'),
    )
    expect(msg, 'no row holds the assistant message').toBeDefined()
    msg!.style.opacity = '0.5'

    const after = inkUnder(paper).find((i) => i.says.startsWith('Done — the fixture'))
    expect(
      after!.ratio,
      `a 50% fade on paper still reads ${after!.ratio.toFixed(2)}:1`,
    ).toBeLessThan(READABLE)
    // ⚑ And the blind sensor is still blind, which is what makes the line above a MEASUREMENT of
    // the fade rather than of some change `paintedInk` makes to everything it touches.
    const blind = contrast(
      parseColor(getComputedStyle(msg!.querySelector('p')!).color)!,
      paintedBackground(msg!.querySelector('p')!),
    )
    expect(blind, 'paintedBackground started seeing opacity — 080/083 read it too').toBeGreaterThan(
      PROSE,
    )
  })

  /**
   * ⚑ **The paper is white in BOTH themes, so its ink must be the same in both** — the mechanism
   * under the two thresholds, stated directly.
   *
   * ⚠️ This is strictly stronger than "both themes pass a bar" and strictly weaker than correctness:
   * a token that is dark-only would resolve identically in both scopes and pass here while failing
   * the walk above. The two together are the claim.
   */
  it('the same 34 words, the same colours, whichever theme the app is wearing', () => {
    const read = (theme: 'light' | 'dark'): string[] =>
      inkUnder(openBody(BODIES[0], theme).q('child-work-paper')).map(
        (i) => `${i.what} ${show(i.fg)} on ${show(i.bg)}`,
      )
    const light = read('light')
    expect(light.length).toBeGreaterThan(BODIES[0].floor)
    expect(read('dark')).toEqual(light)
  })
})

describe('the toggle that is a chip, not a smear (126 §1)', () => {
  /**
   * ⛔ **Acceptance 4: `.seg.on` uses the same token `DocumentBody` uses**, asserted through the
   * engine rather than by grepping for `--accent-ink`.
   *
   * The two controls are the same segmented control drawn twice — `ChildWorkViewer`'s Transcript/Raw
   * and `DocumentBody`'s Markdown/Raw. The child's said `--badge-ink`, the plate's own `#ffffff` in
   * both themes, which on dark's pale `--accent` (`#7dbbff`) is white on pale blue at **2.01:1**.
   *
   * ⚠️ **This was `ours.ink === theirs.ink` until 129, and that equality stopped being the claim.**
   * 129 put `.doc-paper` inside `[data-on-white]`, and `DocumentBody`'s toolbar is inside the paper
   * — so in dark its chip now resolves the PAPER's accent pair (`#2563eb` on white ink) while the
   * child's, which sits in the panel chrome outside any island, keeps the app's (`#7dbbff` with
   * near-black ink). Both are right; asserting they are identical would now be asserting that the
   * island does not work. What survives, and is strictly stronger than the equality was, is that
   * each names the same PAIR OF TOKENS and resolves it WHERE IT SITS — read off the engine with a
   * probe at the element's own position rather than by grepping the stylesheet.
   */
  const resolvedAt = (el: Element, token: string): string => {
    const probe = document.createElement('span')
    probe.style.color = `var(${token})`
    el.appendChild(probe)
    const value = getComputedStyle(probe).color
    probe.remove()
    return value
  }

  const chip = (
    view: Mounted,
    cy: string,
  ): { ink: string; fill: string; accent: string; accentInk: string; ratio: number } => {
    const el = view.q(cy)
    const style = getComputedStyle(el)
    const fg = parseColor(style.color)
    expect(fg, `unparseable colour on ${cy}`).not.toBeNull()
    return {
      ink: style.color,
      fill: style.backgroundColor,
      accent: resolvedAt(el, '--accent'),
      accentInk: resolvedAt(el, '--accent-ink'),
      ratio: contrast(fg!, paintedBackground(el)),
    }
  }

  it.each(THEMES)('%s: both selected chips are the accent pair OF THEIR OWN SURFACE', (theme) => {
    const child = openBody(BODIES[0], theme)
    const output = openBody(BODIES[1], theme)
    for (const [what, seen] of [
      ["the child's Transcript chip", chip(child, 'child-view-transcript')],
      ["DocumentBody's Markdown chip", chip(output, 'doc-view-markdown')],
    ] as const) {
      expect(seen.fill, `${what} is not painted --accent`).toBe(seen.accent)
      expect(seen.ink, `${what} paints ${seen.ink} where --accent-ink is ${seen.accentInk}`).toBe(
        seen.accentInk,
      )
      // …and the number, so "it names the right token" cannot be satisfied by the token being wrong.
      expect(seen.ratio, `${what} reads ${seen.ratio.toFixed(2)}:1`).toBeGreaterThan(PROSE)
    }
  })

  /**
   * ⚑ **The asymmetry, asserted as the finding rather than left as a coincidence.** In light the
   * ambient ramp already IS the paper ramp, so the two chips agree; in dark they must differ, and
   * a build where they agreed in dark would be one where 129's island had stopped resolving. This
   * is what makes the `it.each` above a claim about position rather than about a constant.
   */
  it('⚠️ in dark the two chips DIFFER — that is the island, not a drift', () => {
    const ours = chip(openBody(BODIES[0], 'dark'), 'child-view-transcript')
    const theirs = chip(openBody(BODIES[1], 'dark'), 'doc-view-markdown')
    expect(
      ours.fill,
      'the paper chip resolved the app’s accent — the island is not applying',
    ).not.toBe(theirs.fill)
    const light = [
      chip(openBody(BODIES[0], 'light'), 'child-view-transcript'),
      chip(openBody(BODIES[1], 'light'), 'doc-view-markdown'),
    ]
    expect(light[0]!.fill, 'in light the two surfaces are one ramp and must agree').toBe(
      light[1]!.fill,
    )
    expect(light[0]!.ink).toBe(light[1]!.ink)
  })
})

describe('what giving the island the whole palette cost (126 · tokens.css §14)', () => {
  /**
   * ⚑ **`[data-on-white]` stopped being five tokens and became `§13`'s other selector**, so the
   * agent plate — the island's first carrier — now sees ~80 declarations where it saw five. That is
   * the blast radius of 126's change, and it is measured here rather than argued in a comment.
   *
   * ⚠️ **It lives in this file and not in `agent-state`'s** because it is 126's cost, not 082's
   * behaviour: what is being pinned is that the merge moved nothing, and the day it does move
   * something the failure should point at the task that caused it. `agent-state.test.ts` keeps the
   * plate's own claims.
   *
   * Measured by diffing every painted property of the plate and its whole subtree across the change:
   * **one property moved, `color-scheme`, from `dark` to `light`** — and to the truthful value, on a
   * `#ffffff` disc that had been declaring a dark scheme. Every colour, border, shadow, stroke and
   * size is identical.
   */
  it('the plate paints exactly what it painted, and stops lying about its colour scheme', () => {
    // ⚠️ `working`, not `running`. The first version passed `doing: 'running'` — a WorkflowAgent
    // state, NOT a member of `DOINGS` — so `AVATAR[doing]` was undefined, the `v-else` faceless
    // ring rendered, and a test named "the plate paints exactly what it painted" exercised none of
    // the six illustrations. `mount()` types props as `Record<string, unknown>`, so nothing caught
    // it. Found in review; the avatar assertion below is the pairing that makes it stay caught.
    const view = mount(
      AgentState,
      // ⚠️ **`compact`, and it was `44` until 203** (195 H3). `SIZES` has no 44 and no surface in
      // this app passes one: every `AgentState` is `compact` (24) except `SessionBot`'s 77. A
      // painting test at a size the app never draws is `176 §12` — it cannot be wrong about
      // anything a person sees. None of the colours below depend on the size; the badge's own
      // geometry at 24, where it sits on its `min-width` floor, is asserted in
      // `attention-rail.dom.test.ts`.
      { doing: 'working', being: 'live', needing: 'permission', size: 'compact' },
      { width: 400 },
    )
    view.host.setAttribute('data-chat-theme', 'dark')
    const plate = view.q('agent-plate')
    view.q('agent-avatar')
    expect(
      view.all('agent-unknown'),
      'the faceless fallback rendered — `doing` is not a Doing',
    ).toHaveLength(0)
    const style = getComputedStyle(plate)

    // The three the plate's own CSS names, none of which §13 declares — so the merge cannot reach
    // them, and this is the positive statement of that.
    expect(style.backgroundColor).toBe('rgb(255, 255, 255)') // --badge-ink
    expect(style.borderTopColor).toBe('rgb(208, 204, 194)') // --paper-line, #d0ccc2 (was #dde1eb)
    // Assert the avatar’s shadow is `none`; its hairline supplies the edge. Keeping the
    // absence asserted ensures the shared-style merge cannot later introduce a plate shadow
    // without failing ([[invert-a-defect-assertion-never-delete-it]]).
    expect(style.boxShadow, 'a shadow came back to the avatar').toBe('none')
    // The amber lock at its PAPER value, which is what the island exists for (082).
    expect(getComputedStyle(view.q('agent-needing')).backgroundColor).toBe('rgb(120, 79, 16)')

    // ⚑ The one thing 126 changed, asserted as the change rather than discovered as a surprise.
    expect(style.colorScheme, 'the white disc is declaring a dark colour scheme').toBe('light')
    // …and the paired negative: the app AROUND it is still dark, so this is an island and not a
    // scope that has leaked upward.
    expect(getComputedStyle(view.q('agent-state')).colorScheme).toBe('dark')
  })
})
