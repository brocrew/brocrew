import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import AgentState from '../../src/renderer/src/components/AgentState.vue'
import { acceptEvent, createSessionRecord } from '../../src/renderer/src/lib/session-record'
import { NEEDINGS, SIZES } from '../../src/renderer/src/lib/agent-state'
import type { RuntimeEventMessage, TranscriptEvent } from '../../src/shared/runtime-ipc'
import { mount, unmountAll, visible, type Mounted } from './harness'

/**
 * ⛔ **Attention existed in the state and not on the screen** (203, from 195 H3).
 *
 * The PM measured his own running app days ago and found `data-dot="false"`, an avatar swap and an
 * `aria-label`. 195 found why, and it was three separate things:
 *
 *  - **no live count anywhere.** The only number on the rail was the Home badge, derived from the
 *    demo seed's projects — the placeholder dashboard's own figure, on a `data-wired="false"`
 *    button — so nothing counted the conversations actually waiting;
 *  - **`permission` and `question` both drew the word `waiting`**, and the sentences that tell them
 *    apart (`NEEDING_WORD`) existed only in the plate's accessible name. One of the two freezes the
 *    composer and the other does not;
 *  - **the coverage was at a size the app never draws.** The only DOM assertion about a painted
 *    plate passed `size: 44`; `SIZES` has no 44, and every `AgentState` in this app is `compact`
 *    (24) except one at 77. At 24 the badge is at its `min-width` floor, which is exactly the case
 *    a percentage-sized element gets wrong — and nothing looked (176 §12).
 *
 * ⚠️ **In the DOM project, and it has to be.** Every claim here is about a painted box or a
 * measured colour at a real width; SSR has neither, and the standing
 * `brobot2-ssr-tests-pass-vacuously` rule is that a negative asserted against a string proves
 * nothing.
 */

const NOW = Date.now()

/**
 * An open conversation the rail can draw, built by feeding it the events the app feeds it.
 *
 * ⚑ **It names no profile**, so the rail draws it under the other agents (2026-10-01) — which is
 * the section whose badge and count this file reads.
 */
function conversation(
  sessionId: string,
  events: TranscriptEvent[] = [],
  planNeedsGoAhead = false,
): unknown {
  const record = createSessionRecord(sessionId)
  record.meta = {
    sessionId,
    provider: 'codex',
    cwd: `/Users/alex/dev/${sessionId}`,
    ref: {
      provider: 'codex',
      sessionId: 'live',
      cwd: `/Users/alex/dev/${sessionId}`,
      rotation: 0,
    },
    approvalMode: 'ask',
    planNeedsGoAhead,
    liveness: { state: 'live', since: NOW },
  } as never
  events.forEach((event, index) => {
    acceptEvent(record, { sessionId, ordinal: index, event } as RuntimeEventMessage)
  })
  return record
}

const SCOPE = {
  cwd: '/Users/alex/dev/x',
  paths: ['write /Users/alex/dev/x/out.txt'],
  networkHosts: [],
  persistence: 'once' as const,
  amendments: [],
  availableDecisions: ['allow' as const, 'deny' as const],
  underDisclosed: false,
}

const PERMISSION: TranscriptEvent = {
  type: 'permission_request',
  id: 'perm-1',
  kind: 'command',
  action: 'Bash',
  detail: 'run: ls',
  scope: SCOPE,
}

const QUESTION: TranscriptEvent = {
  type: 'user_input_request',
  id: 'q-1',
  prompt: 'which one?',
  questions: [
    {
      id: 'q0',
      header: 'Pick',
      prompt: 'which one?',
      multiSelect: false,
      options: [{ label: 'this one' }, { label: 'the other' }],
    },
  ],
}

/** The rail, at the 200px column it really is, with the closed list stubbed out. */
async function rail(open: unknown[]): Promise<Mounted> {
  const stub = window as unknown as { api?: unknown }
  stub.api = {
    runtime: {
      listResumable: () => Promise.resolve([]),
      listUnresumable: () => Promise.resolve([]),
    },
  }
  const m = mount(
    SideRail,
    { open, activeId: null, place: null },
    // ⛔ 200px — the width the rail is, and the width its 24px plates are drawn at.
    { width: 200, height: 900 },
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
  return m
}

/**
 * The row's STATUS line — selected by `data-standing` rather than by being the first `small`.
 *
 * ⚠️ **Tightened in 211 §3**, which put the conversation's opening line above it as a second
 * `small`. `querySelector('small')` used to be unambiguous and stopped being so; a positional
 * selector that silently starts pointing at a different line is how a row's word gets asserted
 * against the wrong sentence.
 */
const smallOf = (m: Mounted, sessionId: string): HTMLElement =>
  m.q(`open-session-${sessionId}`).querySelector('small[data-standing]') as HTMLElement

afterEach(() => {
  unmountAll()
  delete (window as unknown as { api?: unknown }).api
})

describe('203 · the rail says how many are waiting, and what for (195 H3)', () => {
  it('⛔ counts the conversations waiting on you — live, from the rows themselves', async () => {
    const m = await rail([
      conversation('sess_perm', [PERMISSION]),
      conversation('sess_q', [QUESTION]),
      // ⛔ **A plan go-ahead is a `needing` and is NOT waiting** — `standingOf` says so, because a
      // go-ahead blocks nothing and can be pressed whenever. It is in this fixture so that a count
      // written over `facets.needing` rather than over the standing fails here rather than shipping
      // a number the rows under it disagree with.
      conversation('sess_plan', [], true),
      conversation('sess_quiet'),
    ])

    const count = m.q('rail-needs-you-agents')
    expect(visible(count), 'the count is not on screen').toBe(true)
    expect(count.textContent?.trim()).toBe('2')
    // ⚠️ It agrees with the rows under it, which is what "live, not fixture" has to mean: the
    // number and the rows are one derivation, so a count that disagreed would be a second opinion.
    expect(smallOf(m, 'sess_perm').dataset.standing).toBe('waiting')
    expect(smallOf(m, 'sess_q').dataset.standing).toBe('waiting')
    expect(smallOf(m, 'sess_plan').dataset.standing).not.toBe('waiting')
    expect(smallOf(m, 'sess_plan').dataset.needing, 'the plan badge went missing too').toBe('plan')
    expect(smallOf(m, 'sess_quiet').dataset.standing).not.toBe('waiting')
    expect(smallOf(m, 'sess_quiet').dataset.needing).toBeUndefined()
  })

  it('⚑ …and shows no count at all when nothing is waiting — not a zero', async () => {
    // The paired positive for the badge's absence. `012`'s rule: a fresh, quiet surface shows no
    // number rather than a confident 0, and the Home badge beside it follows the same one.
    const m = await rail([conversation('sess_quiet')])
    expect(m.all('rail-needs-you-agents')).toHaveLength(0)
    expect(m.q('rail-count-agents').textContent, 'the rail drew no rows at all').toBe('1')
  })

  it('⛔ the ROW says which kind — permission and question stop reading the same', async () => {
    const m = await rail([
      conversation('sess_perm', [PERMISSION]),
      conversation('sess_q', [QUESTION]),
      conversation('sess_quiet'),
    ])

    // On screen, in the row's own text — not only in the plate's accessible name. ⚑ **UI-008** — in
    // the one state's word, *needs you* (F051).
    expect(smallOf(m, 'sess_perm').textContent).toContain('needs you: permission')
    expect(smallOf(m, 'sess_q').textContent).toContain('needs you: question')
    // ⚑ The pairing: a conversation needing nothing says neither word, and still says what it is.
    const quiet = smallOf(m, 'sess_quiet').textContent ?? ''
    expect(quiet).not.toContain('needs you')
    expect(quiet).toContain('codex')
  })

  it('⛔ the attention badge is really painted at 24px — the size the rail draws (176 §12)', async () => {
    // ⛔ **The coverage gap 195 names.** The only painted-plate assertion in the DOM project used
    // `size: 44`, which `SIZES` does not contain and no surface passes. At `compact` the badge is
    // `calc(24 * 0.34)` = 8.16px, under its own `min-width: 11px` floor — so the floor is what is
    // actually on screen, and a percentage that silently rounded to nothing would have looked
    // identical to a string.
    const m = await rail([conversation('sess_perm', [PERMISSION])])
    const row = m.q('open-session-sess_perm')
    const badge = row.querySelector('[data-cy=agent-needing]') as HTMLElement
    const plate = row.querySelector('[data-cy=agent-plate]') as HTMLElement

    expect(row.querySelector('[data-cy=agent-state]')?.getAttribute('data-size')).toBe(
      String(SIZES.compact),
    )
    expect(row.querySelector('[data-cy=agent-state]')?.getAttribute('data-dot')).toBe('false')
    expect(visible(badge), 'the attention badge is not visible at the size the rail draws').toBe(
      true,
    )
    const box = badge.getBoundingClientRect()
    expect(box.width).toBeGreaterThanOrEqual(11)
    expect(box.height).toBeGreaterThanOrEqual(11)
    // …and it is ON the plate, not floating beside it.
    const plateBox = plate.getBoundingClientRect()
    expect(box.left).toBeGreaterThanOrEqual(plateBox.left - box.width)
    expect(box.top).toBeGreaterThanOrEqual(plateBox.top - box.height)
    // The glyph inside it really rendered — a disc with no mark says "something", not "what".
    expect(badge.querySelector('svg use')?.getAttribute('href')).toBe('#i-lock')
  })

  it('⛔ every NEEDING paints a distinct badge at 24px, and none of them paints nothing', async () => {
    // Driven through the component at the app's own size, over the whole vocabulary — so a needing
    // added later without a token or a glyph fails here rather than drawing an invisible disc.
    const painted = new Map<string, string>()
    for (const needing of NEEDINGS) {
      const m = mount(
        AgentState,
        { doing: 'working', being: 'live', needing, size: 'compact' },
        { width: 200 },
      )
      const badge = m.q('agent-needing')
      const style = getComputedStyle(badge)
      expect(badge.getBoundingClientRect().width, needing).toBeGreaterThanOrEqual(11)
      expect(style.backgroundColor, needing).not.toBe('rgba(0, 0, 0, 0)')
      painted.set(needing, `${style.backgroundColor}|${m.q('agent-needing').innerHTML}`)
    }
    // Three needings, three different marks: a map that returned one token for everything would
    // satisfy every assertion above by agreeing with itself.
    expect(new Set(painted.values()).size).toBe(NEEDINGS.length)
  })
})
