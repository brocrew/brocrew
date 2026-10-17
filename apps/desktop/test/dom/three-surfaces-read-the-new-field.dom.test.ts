import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import SessionHeader from '../../src/renderer/src/components/SessionHeader.vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import { createSessionRecord } from '../../src/renderer/src/lib/session-record'
import { applyEvent } from '../../src/renderer/src/lib/transcript'
import { STANDING_LABEL } from '../../src/renderer/src/lib/agent-state'
import type { CreatedSession } from '../../src/shared/runtime-ipc'
import type { ConversationWait, WhatEachConversationIsWaitingOn } from '../../src/shared/tasks'
import { mount, unmountAll, visible, type Mounted } from './harness'

/**
 * 🔴 **636 · the word a person actually reads on the two surfaces `HO-095` §5.1 names** — the rail
 * row and the header pill.
 *
 * ## ⛔ Why the DOM project and not SSR
 *
 * ⚠️ **The claim is about a word in a 208px column**, and `531` measured exactly what a
 * `textContent` assertion cannot see there: *Dashboard across active projects* was green in four
 * suites while a person read *Dashboard across active pro…*. ⛔ **The new word is LONGER than the
 * one it replaces** — `waiting on a worker` against `idle` — so whether it fits is a real
 * question and not a formality (`brobot2-ssr-tests-pass-vacuously`, and
 * `the-dom-runner-draws-overlay-scrollbars` next door).
 *
 * ## ⚑ What is arranged here
 *
 * §1 **the rail row at `--rail-w`** — the word moves, the other row on the same mount does not,
 * and the ink is inside its own box. ·
 * §2 **the header pill** — *Waiting on another agent*, drawn whole, and not the amber that means
 * *a person must act*. ·
 * §3 **the PLATE** (645) — the accessible name, on two call sites and two producers.
 *
 * ## 🔴 645 · why this file was called *three* surfaces and arranged two
 *
 * ⛔ **The third surface is the plate's accessible name, and `636` could not reach it from here.**
 * ⚠️ Its unit twin asserts all three — `three-surfaces-read-the-new-field.test.ts:113` composes
 * `read: accessibleName({ ...facets, label: 'brobot' })` and pins the sentence at :143, :208 and
 * :450 — but `AgentState.vue` never declared the prop, so in the APP the facet fell through to the
 * root element as a stray attribute and the sentence was one no call site could produce.
 * 🔴 **The function was tested and the WIRING was not**, which is `250`'s defect exactly and is
 * why a pure-function pin is not a surface. ⚑ §3 is that wiring, measured where it actually lives.
 *
 * ⚠️ **The derivation is `three-surfaces-read-the-new-field.test.ts`**; nothing here re-decides
 * which word a state takes, and both files read the same two exported tables.
 */

const NOW = 1_700_000_000_000

/** ⚑ A conversation the rail can draw: live, idle, and the host has said so. */
function conversation(sessionId: string): unknown {
  const record = createSessionRecord(sessionId)
  record.meta = {
    sessionId,
    provider: 'claude',
    cwd: '/Users/alex/dev/brobot',
    profileId: 'default',
    liveness: { state: 'live', since: NOW },
  } as CreatedSession
  record.phase = 'open'
  applyEvent(record.control, { type: 'status', state: 'idle' }, NOW)
  return record
}

/** ⛔ **`621`'s reading**, built the way the host builds it — every running conversation, `null`
 *  included, which is the completeness `WhatEachConversationIsWaitingOn` promises. */
const readingOf = (
  rows: Record<string, ConversationWait | null>,
): WhatEachConversationIsWaitingOn => ({
  readAt: NOW,
  conversations: Object.entries(rows).map(([conversation, waiting]) => ({
    conversation,
    identity: 'default',
    waiting,
    work: null,
  })),
  rowsUnread: 0,
})

/**
 * The rail at `--rail-w`'s own value, with the closed list stubbed out.
 *
 * ⛔ **251.68 and not a number of this suite's own** — `531`'s standing rule for this component: a
 * suite that measures the rail at a width the app never draws is a new defect, and
 * `every-assertion-that-reads-clipped-text.test.ts` §3 is what says so.
 */
async function rail(
  open: unknown[],
  waiting: WhatEachConversationIsWaitingOn | null,
): Promise<Mounted> {
  const stub = window as unknown as { api?: unknown }
  stub.api = {
    runtime: {
      listResumable: () => Promise.resolve([]),
      listUnresumable: () => Promise.resolve([]),
    },
  }
  const m = mount(
    SideRail,
    { open, activeId: null, place: null, waiting },
    { width: 251.68, height: 900 },
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
  return m
}

/** Everything a person can read in the row, whitespace-collapsed the way they would read it. */
const rowText = (m: Mounted, sessionId: string): string =>
  (m.q(`open-session-${sessionId}`).textContent ?? '').replace(/\s+/g, ' ').trim()

/** ⛔ Is every line of this element's ink inside its own box? — `531`'s question, narrowed. */
const clipped = (el: HTMLElement): boolean =>
  el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1

afterEach(() => unmountAll())

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · the rail row
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('636 §1 · the rail row stops saying `idle` about a conversation whose worker is working', () => {
  it('🔴 the word a person reads changes, and the row beside it does not', async () => {
    // ⚑ **TWO conversations on ONE mount**, which is what makes the first assertion a measurement
    // rather than a claim about a component that rewrites every row
    // (`a-comparison-tested-where-both-sides-agree-measures-nothing`).
    const m = await rail(
      [conversation('sess_brobot'), conversation('sess_quiet')],
      readingOf({ sess_brobot: 'waiting-on-a-worker', sess_quiet: null }),
    )

    expect(rowText(m, 'sess_brobot')).toContain('waiting on a worker')
    expect(rowText(m, 'sess_brobot')).not.toContain('idle')
    // ⛔ **THE PAIR** — the conversation the same reading says nothing is outstanding about keeps
    // the word it had, so the line above is about `waiting` and not about the mount.
    expect(rowText(m, 'sess_quiet')).toContain('idle')
    expect(rowText(m, 'sess_quiet')).not.toContain('waiting on')
  })

  it('⛔ the longer word is drawn WHOLE in the 208px column, which `idle` never tested', async () => {
    const m = await rail(
      [conversation('sess_brobot')],
      readingOf({ sess_brobot: 'waiting-on-a-worker' }),
    )
    const row = m.q('open-session-sess_brobot') as HTMLElement
    expect(visible(row)).toBe(true)
    // 🔴 **`531`'s question, asked of the word this dispatch made longer.** ⚠️ The row is the box
    // the rail gives it; a word that overflowed here would be the defect `531` measured on this
    // very column's subtitles, arriving through a state nobody had drawn before.
    expect(clipped(row), 'the rail row is cut').toBe(false)
  })

  it('⚑ a reading that has not landed leaves every row exactly as it was', async () => {
    // ⛔ **`null` is *nobody has looked*** — the state of every real window's first frame — and
    // the rail may not draw a wait it was not told about, nor stop drawing the word it has.
    const m = await rail([conversation('sess_brobot')], null)
    expect(rowText(m, 'sess_brobot')).toContain('idle')
    expect(rowText(m, 'sess_brobot')).not.toContain('waiting on')
  })

  it('⚠️ a conversation the reading does not COVER is not given a wait either', async () => {
    // ⛔ The second absence, on the surface: the reading landed and names somebody else, which is
    // the population `whatEachConversationIsWaitingOn` promises and no more.
    const m = await rail(
      [conversation('sess_brobot')],
      readingOf({ sess_someone_else: 'waiting-on-a-worker' }),
    )
    expect(rowText(m, 'sess_brobot')).toContain('idle')
    expect(rowText(m, 'sess_brobot')).not.toContain('waiting on a worker')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · the header pill
// ─────────────────────────────────────────────────────────────────────────────────────────────

const SESSION: CreatedSession = {
  sessionId: 'sess_brobot',
  provider: 'claude',
  cwd: '/Users/alex/dev/brobot',
  providerHome: '/homes/claude',
  profileId: 'default',
  instructions: {
    injected: [],
    agentMemory: [],
    provider: [],
    refused: [],
    note: '',
    recallsReported: false,
    writesReported: false,
    composed: null,
  },
  ref: null,
  config: {
    home: '/homes/claude',
    homeEnv: 'CLAUDE_CONFIG_DIR',
    model: 'claude-sonnet-5',
    authNote: null,
    files: [],
  },
  approvalMode: 'ask',
  pendingApprovalMode: null,
  approvalNote: 'approvals: ask',
  blanketGrants: [],
  planNeedsGoAhead: false,
  queued: [],
  settings: {
    model: null,
    pendingModel: null,
    reasoningEffort: null,
    pendingReasoningEffort: null,
    planMode: false,
    pendingPlanMode: null,
  },
  liveness: { state: 'live', since: NOW, signInSuperseded: false },
  hasACommander: false,
  startedWithoutAWindow: true,
  mayHandItBack: true,
}

const bar = (waiting: ConversationWait | undefined): Mounted =>
  mount(
    SessionHeader,
    {
      session: SESSION,
      status: 'idle',
      ended: false,
      debug: false,
      facets: {
        doing: 'idle' as const,
        being: 'live' as const,
        ...(waiting ? { waiting } : {}),
      },
      onHandBack: () => {},
      onClose: () => {},
    },
    { width: 1200, height: 400 },
  )

describe('636 §2 · the header pill, which is the surface the person photographed', () => {
  it('🔴 it says another agent owes the next move, and it is drawn whole', async () => {
    const m = bar('waiting-on-a-worker')
    await nextTick()
    const word = m.q('agent-standing').querySelector('.standing-word') as HTMLElement

    expect(visible(word)).toBe(true)
    expect(word.textContent?.trim()).toBe(STANDING_LABEL.elsewhere)
    // The replaced sentence is absent from the bar.
    expect(word.textContent).not.toContain('Idle')
    expect(clipped(word), 'the standing word is cut').toBe(false)
    // ⚑ **The key a stylesheet and a smoke select on** — a word with a space in it is a key
    // nobody can select on, which is why the enum stayed one token.
    expect(word.getAttribute('data-standing')).toBe('elsewhere')
  })

  it('⛔ it is NOT the amber that means a person must act', async () => {
    const m = bar('waiting-on-a-worker')
    await nextTick()
    const word = m.q('agent-standing').querySelector('.standing-word') as HTMLElement
    // 🔴 **`621` §5.2, on the pixel**: amber is *waiting on you*, and nobody at this machine can
    // move this conversation along.
    expect(word.classList.contains('waiting')).toBe(false)
    expect(word.classList.contains('live')).toBe(false)

    // ⚑ **THE PAIR** — the one wait that IS a person's takes the amber, on the same component.
    const mine = bar('waiting-on-a-person')
    await nextTick()
    const amber = mine.q('agent-standing').querySelector('.standing-word') as HTMLElement
    expect(amber.textContent?.trim()).toBe(STANDING_LABEL.waiting)
    expect(amber.classList.contains('waiting')).toBe(true)
  })

  it('⚑ and with no wait read at all the bar says exactly what it said before', async () => {
    const m = bar(undefined)
    await nextTick()
    const word = m.q('agent-standing').querySelector('.standing-word') as HTMLElement
    expect(word.textContent?.trim()).toBe(STANDING_LABEL.idle)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · the plate — 645
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('645 §3 · the PLATE is the third surface, on two call sites and two producers', () => {
  /** ⚑ The rail draws many plates, so its row is narrowed first; the header draws exactly one. */
  const plateIn = (el: HTMLElement): HTMLElement =>
    el.querySelector<HTMLElement>('[data-cy="agent-state"]')!

  it('🔴 the HEADER plate says the wait, in the sentence’s own order', async () => {
    const m = bar('waiting-on-a-worker')
    await nextTick()
    const plate = m.q('agent-state')
    // ⛔ **Anchored at the END**, which pins the ORDER and not just the presence: `accessibleName`
    // puts the wait after BEING and before NEEDING, and a clause that drifted to the front would
    // pass a `toContain`.
    expect(plate.getAttribute('aria-label')).toMatch(/ — idle, live, waiting on a worker$/)
    // ⚑ **THE DOM FACT this dispatch exists for** — the facet is a declared prop now, so it is
    // absorbed instead of landing on the root element. ⚠️ A real DOM, not a string: `hasAttribute`
    // cannot be satisfied by a substring.
    expect(plate.hasAttribute('waiting')).toBe(false)
    // …and the paired positive, so the negative is not passing over a plate that never rendered.
    expect(plate.getAttribute('data-doing')).toBe('idle')
  })

  it('⛔ …and so does the RAIL row — a different call site, a different producer', async () => {
    // ⚑ `SessionHeader` gets its facets from `ConversationPane`'s `sessionFacets({…, waiting})`;
    // the rail builds its own with `recordFacets(record, theWaitIn(…))`. ⛔ **A test at one plate
    // does not measure a change to every plate**, which is why both are here.
    const m = await rail([conversation('sess_a')], readingOf({ sess_a: 'waiting-on-a-worker' }))
    const plate = plateIn(m.q('open-session-sess_a'))
    expect(plate.getAttribute('aria-label')).toMatch(/waiting on a worker$/)
    expect(plate.hasAttribute('waiting')).toBe(false)
    expect(plate.getAttribute('data-doing')).toBe('idle')
  })

  it('⚠️ the CONTROL — with no wait read, neither plate invents one', async () => {
    const header = bar(undefined)
    await nextTick()
    const headerPlate = header.q('agent-state')
    expect(headerPlate.getAttribute('aria-label')).not.toContain('waiting on')
    expect(headerPlate.hasAttribute('waiting')).toBe(false)

    const m = await rail([conversation('sess_b')], readingOf({ sess_b: null }))
    const railPlate = plateIn(m.q('open-session-sess_b'))
    expect(railPlate.getAttribute('aria-label')).not.toContain('waiting on')
    expect(railPlate.hasAttribute('waiting')).toBe(false)
  })

  it('🔴 the one wait a CARD already names is said once — the skip, on a real plate', async () => {
    // ⛔ `accessibleName` suppresses *waiting on a person* when a summoning NEEDING is also set,
    // because the needing names the same fact more specifically. ⚑ Asserted here rather than only
    // on the pure function, because the skip is what a screen reader actually hears.
    const m = mount(
      SessionHeader,
      {
        session: SESSION,
        status: 'idle',
        ended: false,
        debug: false,
        facets: {
          doing: 'idle' as const,
          being: 'live' as const,
          needing: 'permission' as const,
          waiting: 'waiting-on-a-person' as const,
        },
        onHandBack: () => {},
        onClose: () => {},
      },
      { width: 1200, height: 400 },
    )
    await nextTick()
    const plate = m.q('agent-state')
    const label = plate.getAttribute('aria-label') ?? ''
    // ⚑ **UI-008** — both are said in the one state's *needs you* now (F051), so the skip is the
    // word said ONCE: the needing's, naming the card.
    expect(label).toMatch(/needs you \(permission\)$/)
    expect(label.match(/needs you/g)).toHaveLength(1)
    expect(plate.hasAttribute('waiting')).toBe(false)
  })
})
