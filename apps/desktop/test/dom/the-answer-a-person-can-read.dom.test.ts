import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { page } from 'vitest/browser'
import ToolAnswerViewer from '../../src/renderer/src/components/ToolAnswerViewer.vue'
import SubAgentEntry from '../../src/renderer/src/components/SubAgentEntry.vue'
import ToolEntry from '../../src/renderer/src/components/ToolEntry.vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { META, mount, paneProps, record, unmountAll, visible, type Mounted } from './harness'
import type { ToolAnswer, TranscriptEvent } from '../../src/shared/runtime-ipc'

/**
 * 🔴 **462 · what a person can actually READ, measured in a real Chromium.**
 *
 * ## ⛔ Why these claims cannot live in the render suite
 *
 * `457`'s finding is about **3 691 characters** arriving where 200 fit. Every interesting property
 * of the answer is therefore geometric — does it wrap or run off the side, is there one scroller or
 * two, does a long value push the only control on a child's row out of reach — and the `desktop`
 * project has no layout at all, so those assertions would pass over a component that rendered
 * nothing (`brobot2-ssr-tests-pass-vacuously`).
 *
 * ⚠️ **Overlay scrollbars.** This runner draws them at 0 px where the real window draws 11
 * (`the-dom-runner-draws-overlay-scrollbars`), so nothing here may pin a width against a scrollbar's
 * own thickness. The claims below are about overflow and reachability, which the difference does not
 * touch.
 */

/**
 * ⛔ **The runner's own viewport, set and RESTORED** (`dom-project-viewport-is-shared`). It starts
 * at 320 px wide, and this panel's width is `min(900px, 92vw)` — so every width measured
 * without this line would be a measurement of a 294 px panel, which is not a size this app is ever
 * drawn at. ⚠️ `1200 × 808` is the size this project photographs and the one `a-front-door-that-asks-
 * nothing.dom.test.ts` measures at, reused rather than re-chosen.
 */
const REAL = { width: 1200, height: 808 }
const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

beforeEach(async () => {
  await page.viewport(REAL.width, REAL.height)
})

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

/**
 * ⛔ **The SHAPE `agent-tools.ts` builds, at a size `457`'s measurement is checked against.**
 *
 * ⚠️ **Not `457`'s bytes** — nothing here calls the real tool, and a fixture that claimed to be one
 * would be `a-fixture-built-with-the-helper-under-test` in the other direction. What it IS is every
 * field `list_projects` puts on a report, six times, and {@link MEASURED_AT} is the assertion that
 * keeps it at least as big as the thing this dispatch exists for.
 */
const PAYLOAD = {
  outcome: 'ok',
  count: 6,
  reach: 'any',
  count_covers: 'every project this app has',
  projects: Array.from({ length: 6 }, (_, i) => ({
    project: `project-${i + 1}`,
    display_name: `Project number ${i + 1}`,
    description: 'What this project is for, in the words a person wrote when they made it.',
    running: [{ session: `sess_${i}`, agent: 'project-manager', state: 'idle' }],
    open_work: [
      {
        task: `t_${i}`,
        asked: 'ship the thing that was asked for',
        since: '2026-09-14T10:00:00.000Z',
      },
      {
        task: `t_${i}_b`,
        asked: 'and then say whether it worked, in words a person can act on',
        since: '2026-09-14T11:00:00.000Z',
      },
    ],
    finished_work: [{ task: `t_${i}_done`, asked: 'the one before this', reported_outcome: 'ok' }],
    counts: { running: 1, open: 2, finished: 1 },
    not_recorded: [
      'what each conversation is actually doing right now',
      'whether the outcome an agent reported is the outcome that happened',
    ],
  })),
}

const ANSWER: ToolAnswer = {
  parts: [
    { text: 'Six projects, and you may send work into all of them.', dropped: 0 },
    { text: JSON.stringify(PAYLOAD), dropped: 0 },
  ],
  partsDropped: 0,
}

/**
 * ⛔ **`457`'s number, asserted rather than printed in a title** — *"`list_projects`, six projects:
 * 353 chars of prose against 3 691 of structured payload"*. ⚑ A title that names a count the
 * assertion never checks is a sentence that goes quietly wrong; this is the check.
 */
const MEASURED_AT = 3_691

const panel = (answer: ToolAnswer | null = ANSWER, canAsk = true, width = 1200): Mounted =>
  mount(
    ToolAnswerViewer,
    { name: 'mcp__brobot__list_projects', answer, canAsk },
    { width, height: 900 },
  )

/** Every element inside the panel that is actually scrolling something. */
function scrollers(m: Mounted): HTMLElement[] {
  return [...m.host.querySelectorAll<HTMLElement>('*')].filter(
    (el) => el.scrollHeight - el.clientHeight > 2 || el.scrollWidth - el.clientWidth > 2,
  )
}

describe('§1 · the payload is READ, not scrolled sideways', () => {
  it('🔴 3 691 characters of JSON wrap inside the paper and nothing runs off the side', () => {
    // ⛔ **The title's number, checked.** Without this the fixture could shrink under a later edit
    // and every geometric claim below would be about a payload nobody has a problem with.
    expect(
      ANSWER.parts[1]!.text.length,
      'the fixture is smaller than what 457 measured',
    ).toBeGreaterThanOrEqual(MEASURED_AT)
    const m = panel()
    const body = m.q('tool-answer-body-1')
    // ⛔ **The measurement that says it is readable at all**: the same bytes that are one line on a
    // row are dozens of lines here. Two spaces of indent over six projects is what makes *pick a row
    // out of it* a thing a person can do.
    expect(body.getBoundingClientRect().height).toBeGreaterThan(400)
    // ⚠️ **No horizontal overflow anywhere in the panel** — `overflow-wrap: anywhere` doing the work
    // a second scroller would otherwise have to.
    for (const el of [...m.host.querySelectorAll<HTMLElement>('*')]) {
      expect(el.scrollWidth - el.clientWidth, `${el.className} scrolls sideways`).toBeLessThan(3)
    }
  })

  it('⛔ a value with NO break opportunity in it still does not widen the panel', () => {
    // ⚑ **The hazard planted on the path the code walks**: a 600-character slug with no space, no
    // hyphen and no punctuation is the one thing `overflow-wrap: break-word` would NOT break.
    const m = panel({
      parts: [
        { text: 'one project', dropped: 0 },
        { text: JSON.stringify({ project: 'x'.repeat(600) }), dropped: 0 },
      ],
      partsDropped: 0,
    })
    const paper = m.q('tool-answer-paper')
    expect(paper.scrollWidth - paper.clientWidth).toBeLessThan(3)
    // 🔴 The control: the long value really is in the document, so this is not a measurement of an
    // empty paper.
    expect(m.q('tool-answer-body-1').textContent ?? '').toContain('x'.repeat(600))
  })

  it('⚠️ there is ONE scroller, and it is the stage', () => {
    const m = panel()
    const scrolling = scrollers(m)
    // ⛔ Two nested scrollers make the wheel land on whichever one the pointer is over, which is a
    // cost `255` already pays one level up and must not be paid twice.
    expect(scrolling).toHaveLength(1)
    expect(scrolling[0]?.className).toContain('stage')
  })
})

describe('§2 · both halves are drawn, and the raw one is one press away', () => {
  it('🔴 the prose is in the reading face and the payload is in the monospace one', () => {
    const m = panel()
    const words = getComputedStyle(m.q('tool-answer-body-0')).fontFamily
    const json = getComputedStyle(m.q('tool-answer-body-1')).fontFamily
    // ⚠️ Compared to each OTHER rather than to a named family: the two tokens are the app's, and a
    // test that pinned `ui-sans-serif` would be pinning the token's value rather than the split.
    expect(words).not.toBe(json)
    expect(json.toLowerCase()).toContain('mono')
  })

  it('⛔ pressing Raw swaps the body for the bytes as they arrived', async () => {
    const m = panel()
    expect(m.all('tool-answer-raw')).toHaveLength(0)
    m.q('tool-answer-view-raw').click()
    await nextTick()
    const raw = m.q('tool-answer-raw')
    expect(visible(raw)).toBe(true)
    // ⚑ The parts, newline-joined, in the order the receipt carried them.
    expect(raw.textContent).toBe(`${ANSWER.parts[0]!.text}\n${ANSWER.parts[1]!.text}`)
    // 🔴 The pair: the readable bodies are GONE, so the two views are a toggle rather than a stack.
    expect(m.all('tool-answer-body-1')).toHaveLength(0)
  })

  it('⚠️ the panel stays inside the window at the two sizes anybody photographs', async () => {
    for (const width of [1200, 1440]) {
      unmountAll()
      await page.viewport(width, 900)
      const m = panel(ANSWER, true, width)
      const box = m.host.firstElementChild!.getBoundingClientRect()
      expect(box.width, `${width} wide`).toBeLessThanOrEqual(width)
      expect(box.height, `${width} tall`).toBeLessThanOrEqual(900)
      // ⚑ **And it really USES the room**, which is the half a `<=` cannot say on its own: a panel
      // collapsed to 294 px would pass every bound above and be the thing this dispatch is fixing.
      expect(box.width, `${width} is not a real panel`).toBeGreaterThan(700)
    }
  })
})

describe('§3 · the gap, on screen', () => {
  it('🔴 a replayed conversation shows the sentence and no paper', () => {
    const m = panel(ANSWER, false)
    expect(visible(m.q('tool-answer-absence'))).toBe(true)
    expect(m.all('tool-answer-paper')).toHaveLength(0)
    // ⛔ The control on the same mount shape: with the conversation live, the paper is there.
    unmountAll()
    expect(visible(panel(ANSWER, true).q('tool-answer-paper'))).toBe(true)
  })
})

describe('§4 · a child’s row says what its tool answered, and the door stays reachable', () => {
  const child = (summary: string, result: string): Mounted =>
    mount(
      SubAgentEntry,
      {
        card: {
          agentId: 'agent-1',
          running: false,
          outcome: 'completed',
          body: [
            {
              kind: 'tool',
              callId: 'toolu_child',
              name: 'Bash',
              summary,
              result: { summary: result, ok: true },
            },
          ],
        },
        placement: 'transcript',
        canReadAnswer: true,
      },
      { width: 760, height: 600 },
    )

  it('🔴 the child’s RESULT is drawn — 457’s "never drawn at all", closed', async () => {
    const m = child('ls -la', 'total 48 · drwxr-xr-x 12 someone staff 384 Sep 14 20:00 .')
    m.q('subagent-head').click()
    await nextTick()
    expect(m.q('subagent-tool-result-toolu_child').textContent).toContain('total 48')
  })

  it('⛔ a very long call summary does not push the only control on the line out of the row', async () => {
    // ⚑ The hazard on the path: `.tool code` and `.row-said` both shrink, and a control that
    // shrank with them would be `106`'s control that cannot act.
    const m = child('echo '.repeat(120), 'x'.repeat(4000))
    m.q('subagent-head').click()
    await nextTick()
    const ask = m.q('subagent-tool-answer-toolu_child')
    const line = ask.parentElement!.getBoundingClientRect()
    const box = ask.getBoundingClientRect()
    expect(box.width, 'the door was squeezed to nothing').toBeGreaterThan(40)
    expect(box.right).toBeLessThanOrEqual(line.right + 1)
    // 🔴 The control: the row really is over-full, so this is a measurement of the squeeze rather
    // than of a comfortable line.
    const said = m.q('subagent-tool-result-toolu_child')
    expect(said.scrollWidth).toBeGreaterThan(said.clientWidth)
  })
})

const byPrefix = (m: Mounted, prefix: string): HTMLElement[] => [
  ...m.host.querySelectorAll<HTMLElement>(`[data-cy^="${prefix}"]`),
]
/**
 * ⚑ **`587` moved the door, and this file reaches it by PREFIX in both places.**
 *
 * ⛔ **A settled ORDINARY tool call is no longer a card** — a run of them is one quiet line, and the
 * door to the whole answer sits inside that run's open panel (`tool-run-answer-open-…`) instead of
 * inside the card's fold (`tool-answer-open-…`).
 *
 * ⚠️ **Both prefixes are read, and the first draft of this note gave the wrong reason.** It said
 * *"`ToolEntry` still draws every LIVE call"* — true, and irrelevant: the card's door is
 * `v-if="item.result"`, so a live call has no door at all. ⛔ **The card's door is drawn for a
 * settled call that `joinsARun` excludes** — one with sub-agents (`029`) or a workflow (`108`) —
 * **and for detached work that has reported back while still running.** ⚑ Those are reachable
 * states, so a helper that stopped looking for the card's door would stop covering them.
 */
const byEither = (m: Mounted, tail: string): HTMLElement[] => [
  ...byPrefix(m, `tool-answer-${tail}-`),
  ...byPrefix(m, `tool-run-answer-${tail}-`),
]
const doors = (m: Mounted): HTMLElement[] => byEither(m, 'open')
const gaps = (m: Mounted): HTMLElement[] => byEither(m, 'gone')

/**
 * ⛔ **Which drawing this mount produced, asserted rather than assumed.** ⚠️ A union helper says
 * *a door is somewhere*; it does not say WHICH surface drew it, and a fixture that quietly changed
 * shape would keep every count green while measuring the other component. ⚑ So each mount states
 * what it expects to find before it opens anything.
 */
const drawnAs = (m: Mounted, expected: 'card' | 'run'): void => {
  expect(m.all('tool-entry').length > 0 ? 'card' : 'run', 'the pane drew the other shape').toBe(
    expected,
  )
}
const open = (m: Mounted): void => {
  const card = byPrefix(m, 'tool-toggle-')[0]
  if (card) card.click()
  else m.all('tool-run-toggle')[0]!.click()
}

describe('§5 · the fold owns the door, and the liveness owns the fold’s contents', () => {
  const ROW = {
    kind: 'tool' as const,
    id: 'i1',
    callId: 'toolu_462',
    name: 'mcp__brobot__list_projects',
    summary: '{}',
    at: 1,
    result: { summary: 'Six projects, and you may…', ok: true },
  }

  it('⛔ a FOLDED row does not offer the door — opening the row is the gesture that asks', async () => {
    const m = mount(ToolEntry, { item: ROW, canReadAnswer: true }, { width: 760, height: 400 })
    // ⚠️ **In the DOM and NOT drawn**, which is the distinction `.tool-body`'s own fold makes: the
    // element exists, so a render test cannot tell the two states apart and this one can.
    expect(m.q('tool-answer-open-i1')).toBeTruthy()
    expect(visible(m.q('tool-answer-open-i1')), 'a folded row offered the door').toBe(false)
    m.q('tool-toggle-i1').click()
    await nextTick()
    // 🔴 The pair: opening it draws the door, so the negative above is about the fold and not about
    // a button that is never drawn at all.
    expect(visible(m.q('tool-answer-open-i1'))).toBe(true)
  })

  it('🔴 the PANE carries liveness to the row — the hop nothing else in this repo mounts', async () => {
    const events: TranscriptEvent[] = [
      {
        type: 'tool_call',
        id: 'toolu_462',
        name: 'mcp__brobot__list_projects',
        summary: '{}',
      } as never,
      {
        type: 'tool_result',
        id: 'toolu_462',
        summary: 'Six projects, and you may…',
        ok: true,
      } as never,
    ]
    /**
     * ⛔ **The liveness flag the HOST publishes** — `SessionLiveness.canReadToolAnswer`, absent
     * unless the adapter behind this conversation holds answers. ⚠️ It is set here rather than in
     * the shared `META` because absent is the fixture's honest default: a record with no adapter
     * behind it cannot be asked anything.
     */
    const asking = (can: boolean) => {
      const r = record(events)
      r.meta = can
        ? { ...META, liveness: { ...META.liveness, canReadToolAnswer: true } }
        : { ...META }
      return r
    }

    // ⛔ **A live conversation that can be asked** — both halves of the pane's gate, together.
    const live = mount(
      ConversationPane,
      paneProps({
        record: asking(true),
        onReadToolAnswer: async () => null,
      }),
      { width: REAL.width, height: REAL.height },
    )
    await nextTick()
    // ⚠️ **By PREFIX, because the row's `data-cy` carries the transcript item's id and not the
    // call's** — the fold is keyed on `item.id`, which the fold itself mints. Asserting on the
    // shape rather than on a string this test invented is what keeps it about the app.
    drawnAs(live, 'run')
    open(live)
    await nextTick()
    expect(doors(live)).toHaveLength(1)
    expect(gaps(live)).toHaveLength(0)

    // ⚠️ **The same conversation with NO reader supplied** — a window that cannot ask draws the gap,
    // which is the second half of the gate and the one a liveness flag alone would not catch.
    unmountAll()
    await page.viewport(REAL.width, REAL.height)
    const replay = mount(ConversationPane, paneProps({ record: asking(true) }), {
      width: REAL.width,
      height: REAL.height,
    })
    await nextTick()
    drawnAs(replay, 'run')
    open(replay)
    await nextTick()
    expect(doors(replay)).toHaveLength(0)
    expect(gaps(replay)[0]?.textContent).toContain('short form')

    // ⛔ **And the OTHER half of the gate, alone**: a reader is supplied and the conversation's own
    // handle holds nothing — which is every replayed conversation, and is the state `462` §2.2 is
    // about. ⚠️ Both halves are asserted separately because a gate that read only one of them would
    // pass the case above and fail a person here.
    unmountAll()
    await page.viewport(REAL.width, REAL.height)
    const closed = mount(
      ConversationPane,
      paneProps({ record: asking(false), onReadToolAnswer: async () => null }),
      { width: REAL.width, height: REAL.height },
    )
    await nextTick()
    drawnAs(closed, 'run')
    open(closed)
    await nextTick()
    expect(doors(closed)).toHaveLength(0)
    expect(gaps(closed)[0]?.textContent).toContain('short form')
  })
})
