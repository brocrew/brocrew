import { nextTick } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import TranscriptView from '../../src/renderer/src/components/TranscriptView.vue'
import AgentState from '../../src/renderer/src/components/AgentState.vue'
import { applyEvent, createTranscript } from '../../src/renderer/src/lib/transcript'
import type { TranscriptState } from '../../src/renderer/src/lib/transcript'
import { NEEDING_TOKEN } from '../../src/renderer/src/lib/agent-state'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import { contrast, mount, paintedInk, parseColor, show, unmountAll } from './harness'

/**
 * 128 · **The child speaks inside its card** — measured in the engine, not in a string.
 *
 * `127` ruled that forwarded child prose is *"admitted into the conversation view — but owned by the
 * child's card, never a loose top-level turn"*, and the fold half of that is pinned in
 * `transcript.test.ts`. Three of this dispatch's claims are about GEOMETRY and COLOUR, which no SSR
 * assertion can reach:
 *
 *  - the head glimpse is capped, and **the parent's layout does not move** when a child starts
 *    talking — the card's founding rule (029: *"it must not shove the conversation around while it
 *    runs"*), now tested against speech rather than against heartbeats;
 *  - the body has **its own bounded scroll**, so a six-paragraph child never pushes the parent's
 *    next sentence off the screen;
 *  - a talking child is **never amber** — with the paired positive that the amber channel is real
 *    and reachable, or the negative is a green tick over a badge that no longer exists.
 *
 * ⚠️ **Readability is measured with `paintedInk`, never `paintedBackground`** (126 §5). That was
 * 126's own biggest finding: a walk blind to `opacity` reported 12.49:1 for ink Chromium painted at
 * 2.86:1 while its bad-list came back empty. Sub-agent cards live inside `TranscriptView`, whose
 * `.entry.summarised-out` fades whole rows — the exact ancestor that made the blind sensor lie.
 */

afterEach(unmountAll)

/** WCAG AA for body text. The child's words are prose a person reads, so they get the prose bar. */
const PROSE = 4.5

const DISPATCH = 'toolu_bg'

/** One paragraph of the child talking, long enough that one line cannot hold it. */
const ESSAY = [
  'Audit complete, and the shape of it matters more than the count.',
  'The workspace holds fourteen real entries; two of them are claimed by nothing in the report,',
  'and the PNG is exactly twice the SVG in both dimensions with the same mtime to the second,',
  'which is a render rather than a second drawing. My last check corrected me on the row count:',
  '`wc -l` says 110 because the file has no trailing newline, not because a row went missing.',
].join(' ')

/**
 * ⛔ **`after` exists because without it this file could not produce the order it claimed to test**
 * (131, from 130's §5). Every sentence went in before the single tool, and the expected DOM said the
 * same, while the comment beside it read *"the run, then what it said after"*. A renderer that
 * grouped every prose row ahead of every tool row left the whole file green — the screen-level half
 * of 058 was never covered, only the fold half in `transcript.test.ts`.
 */
function ledger(prose: string[], after: string[] = [], ended = false): TranscriptEvent[] {
  return [
    { type: 'user_turn', text: 'can you run a sub agent?' },
    { type: 'assistant_message', text: '[MAIN] Yes — running one now.' },
    { type: 'tool_call', id: DISPATCH, name: 'Agent', summary: 'Find files missed by scouts' },
    {
      type: 'sub_agent',
      agentId: 'a95dbf5b26468080b',
      idKind: 'task',
      phase: 'started',
      parentToolCallId: DISPATCH,
      kind: 'general-purpose',
      title: 'Find files missed by scouts',
    },
    ...prose.map((text) => ({ type: 'assistant_message', text, parentToolCallId: DISPATCH })),
    {
      type: 'tool_call',
      id: 'child_1',
      name: 'Bash',
      summary: 'ls -la',
      parentToolCallId: DISPATCH,
    },
    {
      type: 'tool_result',
      id: 'child_1',
      summary: 'total 424',
      ok: true,
      parentToolCallId: DISPATCH,
    },
    ...after.map((text) => ({ type: 'assistant_message', text, parentToolCallId: DISPATCH })),
    ...(ended
      ? [
          {
            type: 'sub_agent',
            agentId: 'a95dbf5b26468080b',
            phase: 'ended',
            outcome: 'completed',
            parentToolCallId: DISPATCH,
          },
        ]
      : []),
    // ⛔ **The parent's own next turn, and it is the thing being protected.** Every layout number
    // below is about where THIS lands.
    { type: 'assistant_message', text: '[MAIN] Both back — here is what they found.' },
  ] as unknown as TranscriptEvent[]
}

function feed(events: TranscriptEvent[]): TranscriptState {
  const state = createTranscript()
  for (const event of events) applyEvent(state, event)
  return state
}

/** The transcript, drawn in a real engine at a real width. */
function draw(prose: string[], after: string[] = [], ended = false): ReturnType<typeof mount> {
  return mount(
    TranscriptView,
    { items: feed(ledger(prose, after, ended)).items, mode: 'normal' },
    { width: 900, height: 2000 },
  )
}

/** Every non-empty text node under `root`, with the ratio Chromium actually paints it at. */
function inkUnder(root: Element): { what: string; ratio: number; says: string }[] {
  const out: { what: string; ratio: number; says: string }[] = []
  for (const el of [root, ...root.querySelectorAll('*')]) {
    const direct = [...el.childNodes].some(
      (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
    )
    if (!direct) continue
    const declared = getComputedStyle(el).color
    const colour = parseColor(declared)
    // ⛔ Loud rather than skipped: an unparseable colour is the model falling behind the engine, and
    // silently dropping the element would shrink the walk to whatever the model still understands.
    if (!colour)
      throw new Error(`unparseable color "${declared}" on ${el.tagName} — update the model`)
    if (colour[3] === 0) continue
    const { fg, bg } = paintedInk(el, colour)
    out.push({
      what: `${el.tagName.toLowerCase()}.${(el.className || '(none)').toString().split(' ')[0]}`,
      ratio: contrast(fg, bg),
      says: `${show(fg)} on ${show(bg)}`,
    })
  }
  return out
}

describe("the child's own words, inside the child's card (128)", () => {
  it('lands in the card and nowhere else — and the card is one row taller than it was', async () => {
    const quiet = draw([])
    await nextTick()
    const silent = quiet.q('subagent-head').getBoundingClientRect()
    // The paired positive for every negative below: with nothing forwarded, the card has no voice
    // at all. If this were non-empty the "capped" measurements would be comparing two of the same.
    expect(quiet.all('subagent-saying')).toHaveLength(0)
    quiet.unmount()

    const talking = draw([ESSAY])
    await nextTick()
    const glimpse = talking.q('subagent-saying')
    expect(glimpse.textContent?.trim().startsWith('Audit complete')).toBe(true)

    // ⛔ **The cap, measured rather than declared.** The glimpse holds the WHOLE sentence in the DOM
    // — nothing is sliced in JavaScript, because a silent cut is a bound nobody chose — so the only
    // thing keeping the head one line tall is the CSS. A regression there shows up here as a head
    // that grew.
    const head = talking.q('subagent-head').getBoundingClientRect()
    expect(head.height, 'the head grew when the child spoke').toBeCloseTo(silent.height, 1)
    expect(
      glimpse.scrollWidth,
      'the glimpse is not actually clipping — the test is measuring nothing',
    ).toBeGreaterThan(glimpse.clientWidth)

    // ⛔ **The JavaScript cut must never be the VISIBLE one.** `GLIMPSE_CHARS` exists so a megabyte
    // message is not held twice in the DOM; the moment it drops far enough to be what the reader
    // actually hits, the ellipsis stops meaning "there is more" and starts hiding a silent slice.
    // Both halves are asserted: the text is bounded, AND the box still overflows what is left.
    const text = glimpse.textContent ?? ''
    expect(
      text.length,
      'the glimpse is unbounded — a huge message is held twice',
    ).toBeLessThanOrEqual(240)
    expect(
      text.length,
      'the cut got small enough to be the visible truncation — it is silent, unlike the ellipsis',
    ).toBeGreaterThan(Math.ceil(glimpse.clientWidth / 8))
  })

  it('stops saying "now" the moment the child is over — with its words still in the body', async () => {
    // ⛔ **This test exists because the mutation check found it MISSING.** Taking the `running`
    // guard off `saying` changed nothing any assertion could see, so a card that finished half an
    // hour ago could keep a live-tense glimpse of its last sentence and every test stayed green —
    // the same false present tense `074` swept out of the tool rows and `stopRunningSubAgents` out
    // of the plate.
    const running = draw([ESSAY])
    await nextTick()
    expect(
      running.all('subagent-saying'),
      'the positive half: it speaks while it runs',
    ).toHaveLength(1)
    running.unmount()

    const over = draw([ESSAY], [], true)
    await nextTick()
    expect(over.q('subagent-status').textContent?.trim()).toBe('completed')
    expect(over.all('subagent-saying'), 'a finished agent is still "now saying…"').toHaveLength(0)
    // …and the words did not go anywhere: they are in the body, where a reader can still open them.
    over.q('subagent-head').click()
    await nextTick()
    expect(over.all('subagent-says')).toHaveLength(1)
  })

  it('does not move the parent’s next turn, however much the child says', async () => {
    // 029's founding rule, applied to speech. The comparison is the same conversation with and
    // without six forwarded paragraphs: the parent's following sentence must be at the same y.
    const quiet = draw([])
    await nextTick()
    const before = quiet.host.querySelectorAll('[data-cy=assistant-message]')
    const quietY = before[before.length - 1]!.getBoundingClientRect().top
    expect(before.length, 'both of the parent’s turns are on screen').toBe(2)
    quiet.unmount()

    const loud = draw(Array.from({ length: 6 }, (_, i) => `${i + 1}. ${ESSAY}`))
    await nextTick()
    const after = loud.host.querySelectorAll('[data-cy=assistant-message]')
    // ⛔ Still TWO — six forwarded paragraphs are not six turns. This is 078's rule at the DOM.
    expect(after.length, 'a talking child became a turn in the conversation').toBe(2)
    expect(after[after.length - 1]!.getBoundingClientRect().top).toBeCloseTo(quietY, 1)
  })

  it('opens onto a bounded scroll, with the words and the work in source order', async () => {
    // Six paragraphs, because the bound is 340px and a fixture that never reaches it would let
    // `max-height` be deleted with every assertion still green.
    const view = draw(['first thing', ...Array.from({ length: 6 }, () => ESSAY)], ['last thing'])
    await nextTick()
    // Chromium can do the one thing SSR never could: click it.
    view.q('subagent-head').click()
    await nextTick()

    const rows = [...view.q('subagent-rows').children].map((li) =>
      li.classList.contains('says')
        ? `says:${(li.textContent ?? '').trim().slice(0, 11)}`
        : `tool:${(li.querySelector('strong')?.textContent ?? '').trim()}`,
    )
    // ⛔ **058, on screen, and the tool is in the MIDDLE — which is the whole change (131).** Seven
    // sentences before the run, the run, and one sentence after it. A renderer that grouped rows by
    // kind used to leave this list untouched because every sentence was already ahead of the only
    // tool; now it moves `says:last thing` and the expectation fails, which is what "screen-level
    // source-order coverage" was supposed to mean all along.
    expect(rows).toEqual([
      'says:first thing',
      ...Array.from({ length: 6 }, () => 'says:Audit compl'),
      'tool:Bash',
      'says:last thing',
    ])
    // …and the premise of that claim, stated rather than assumed: there is prose on BOTH sides of
    // the tool, so a grouping mutation has something to move.
    const kinds = rows.map((row) => row.split(':')[0])
    const tool = kinds.indexOf('tool')
    expect(tool, 'no tool row — the ordering claim has nothing to hold').toBeGreaterThan(0)
    expect(kinds.slice(tool + 1), 'nothing after the tool — 130 §5 again').toContain('says')

    const body = view.host.querySelector<HTMLElement>('.body')!
    expect(body.scrollHeight, 'the fixture is too short to reach the bound').toBeGreaterThan(
      body.clientHeight,
    )
    expect(getComputedStyle(body).overflowY).toBe('auto')
    expect(body.clientHeight, 'the body is not bounded').toBeLessThanOrEqual(340)
  })

  it('is READABLE where it landed — measured through the opacity chain (126 §5)', async () => {
    const view = draw([ESSAY])
    await nextTick()
    view.q('subagent-head').click()
    await nextTick()

    const said = view.q('subagent-says')
    const ink = inkUnder(said)
    expect(ink.length, 'the walk found no words to measure').toBeGreaterThan(0)
    const worst = ink.reduce((a, b) => (a.ratio <= b.ratio ? a : b))
    expect(
      worst.ratio,
      `the child's own words are unreadable: ${worst.what} at ${worst.ratio.toFixed(2)}:1 — ${worst.says}`,
    ).toBeGreaterThanOrEqual(PROSE)

    // ⚠️ **The sensor is doing its job, asserted.** `paintedInk` folds every ancestor's `opacity`;
    // fading the row the way `.entry.summarised-out` does must MOVE the number. Without this the
    // measurement above could be coming from a walk that sees no ancestors at all.
    const row = said.closest<HTMLElement>('.entry')!
    const solid = inkUnder(said)[0]!.ratio
    row.style.opacity = '0.5'
    expect(inkUnder(said)[0]!.ratio, 'the walk is blind to a fade again').toBeLessThan(solid)
  })

  it('is never amber — and the amber it refuses is real', async () => {
    const view = draw([ESSAY])
    await nextTick()
    const plate = view.q('subagent-entry').querySelector('[data-cy=agent-state]')!
    // `subAgentFacets` returns no `needing` at all, so the attention corner is not drawn. Prose
    // never promotes (127/108): speech is not a request, and amber is the channel a request spends.
    expect(plate.getAttribute('data-needing')).toBeNull()
    expect(view.q('subagent-entry').querySelector('[data-cy=agent-needing]')).toBeNull()

    // ⛔ **The paired positive, on the same component the session plate uses.** Without it the
    // negative above passes just as happily against a badge that was deleted — and the point is
    // that the channel exists, is amber, and this card declines to spend it.
    const asking = mount(AgentState, {
      doing: 'working',
      being: 'live',
      needing: 'permission',
      size: 44,
    })
    await nextTick()
    const badge = asking.q('agent-needing')
    const painted = parseColor(getComputedStyle(badge).backgroundColor)
    // ⚠️ **Resolved BY the engine, WHERE THE BADGE SITS — and the second half is not pedantry.**
    // `--waiting` is one hex on the app's dark surface and another inside the plate, because the
    // plate is `data-on-white` (126's island). A probe on `document.body` answers `#f2b865` and the
    // badge paints `#92400e`; comparing those two would fail a correct badge. So the probe is a
    // child of the plate, which is the only place the question means anything.
    const probe = document.createElement('span')
    probe.style.color = `var(${NEEDING_TOKEN.permission})`
    badge.parentElement!.append(probe)
    const waiting = parseColor(getComputedStyle(probe).color)
    // …and the island is doing something, or the line above would be asserting against the root's
    // value by accident (126's `data-on-white`, pinned from the one surface that reads it).
    const onDark = document.createElement('span')
    onDark.style.color = `var(${NEEDING_TOKEN.permission})`
    document.body.append(onDark)
    expect(
      parseColor(getComputedStyle(onDark).color),
      'the plate is no longer an island — this test would pass against the root',
    ).not.toEqual(waiting)
    probe.remove()
    onDark.remove()
    expect(waiting, `${NEEDING_TOKEN.permission} resolves to nothing`).not.toBeNull()
    expect(painted, 'the permission badge paints no fill').not.toBeNull()
    expect(painted!.slice(0, 3), `permission is not --waiting: ${show(painted!)}`).toEqual(
      waiting!.slice(0, 3),
    )
  })
})
