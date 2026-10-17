import { describe, expect, it, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import AgentCard from '../src/renderer/src/components/AgentCard.vue'
import {
  plateWord,
  standingWord,
  stateHere,
  type AgentFacets,
} from '../src/renderer/src/lib/agent-state'
import { createSessionRecord } from '../src/renderer/src/lib/session-record'
import { sessionPanel } from '../src/renderer/src/lib/session-panel'
import {
  applyEvent,
  type BackgroundRegistry,
  type ScheduleRegistry,
} from '../src/renderer/src/lib/transcript'
// ⚑ **D-017 · R11 — the one state, its details and its words are `shared/agent-state.ts`'s**, which
// `main` says in `list_agents`; the window feeds it through `stateHere` and words it the same way.
import {
  agentStateOf,
  inTheBackground,
  nextWake,
  NOTHING_IN_THE_BACKGROUND,
  scheduleHeld,
  type AgentStateFacts,
} from '../src/shared/agent-state'
import { clockTime } from '../src/shared/clock'

/**
 * # 🔴 F023 · the detail that loses is dropped whole, never appended after the one that wins
 *
 * ⚑ `one-state-everywhere.test.ts` pins the two winning sentences and the two controls where only
 * ONE of `scheduled`/`detached` is true; none of its fixtures hand `standingWord`/`plateWord` BOTH
 * at once, so nothing in that suite proves the losing detail is actually thrown away rather than
 * merely never asked for. This file is that case, plus three branches the existing fixtures never
 * happen to reach: cron's OR when BOTH day fields are restricted, a registry that is `dropped`-only
 * (something to report, nothing nameable), and `AgentCard`'s plate fed the one state `stateHere`
 * derives from a REAL record rather than a hand-built state (⚑ D-017 · R11: the card no longer
 * derives it; its callers hand it `stateHere`'s).
 *
 * | § | subject |
 * |---|---|
 * | 1 | cron's day rule — either field matching is enough, when both are restricted |
 * | 2 | a `dropped`-only registry: something to report, nothing nameable |
 * | 3 | background outranks a schedule, and the schedule's own detail is dropped whole |
 * | 4 | the agent card's plate, fed `stateHere` over a real record rather than a built state |
 */

/** A fixed local moment: 28 Sept 2026, 04:40 — the same instant `one-state-everywhere.test.ts` uses. */
const AT = new Date(2026, 8, 28, 4, 40).getTime()
const local = (month: number, day: number, hour: number, minute: number): number =>
  new Date(2026, month - 1, day, hour, minute).getTime()

describe('§2 · a registry can have something to report and nothing to name', () => {
  it('🔴 dropped-only: the bar has something to show, and nextWake has no expression to read', () => {
    const dropped: ScheduleRegistry = { jobs: [], dropped: 2, left: [] }
    // ⚑ THE POSITIVE — the bar's own condition already agrees something is scheduled. ⚑ **D-029** —
    // `scheduleHeld`, which every word surface asks now too: the window's narrower
    // `somethingScheduled` went with 258 §2's `sleeping` flag.
    expect(scheduleHeld(dropped)).toBe(true)
    // Rows sent with no id carry no expression this file can read, so the word a person sees for
    // such a conversation is the bare 'scheduled', never a guessed or missing time.
    expect(nextWake(dropped.jobs, AT)).toBeNull()
  })

  it('🔴 dropped-only: the +N counts rows this app cannot list, not just extra named ones', () => {
    const registry: BackgroundRegistry = {
      running: [{ id: 'b1', description: 'npm test' }],
      dropped: 2,
    }
    // ⚑ THE POSITIVE — `one-state-everywhere.test.ts` §2 already covers +1 from one extra NAMED
    // row with `dropped: 0`; this is the dropped-only half of the same arithmetic.
    expect(inTheBackground(registry)).toBe('npm test +2')
  })
})

describe('§3 · background outranks a schedule, and the loser says nothing', () => {
  it('🔴 standingWord and plateWord both drop the schedule whole when background also holds', () => {
    const wakesAt = local(9, 28, 4, 53)
    // ⚑ D-017 · R11 — both facts fed to the ONE derivation: something running AND a job due 04:53.
    const facts: AgentStateFacts = {
      needsYou: false,
      active: false,
      waitingOnTheAnswerOf: null,
      // ⚑ F036 · owing nobody an answer.
      owesAnAnswerTo: [],
      background: { running: [{ id: 'b1', description: 'npm test' }], dropped: 0 },
      scheduled: {
        jobs: [{ id: 'j1', schedule: '53 4 * * *', recurring: true, nominalAt: wakesAt }],
        dropped: 0,
      },
      // ⚑ D-036 · no work out: the one state's seventh fact, left empty so the two above are the
      // whole contest.
      waitingOnTheWorkOf: [],
    }
    const bothHold: AgentFacets = { doing: 'idle', detached: true, scheduled: true }

    const state = agentStateOf(facts, AT)
    const standing = standingWord(bothHold, state)
    expect(standing).toBe('running in the background · npm test')
    expect(plateWord(bothHold, state)).toBe(standing)
    // The losing detail is not merely unread — it is nowhere in the sentence at all.
    expect(standing).not.toContain('scheduled')
    expect(standing).not.toContain(clockTime(wakesAt))

    // ⚑ THE POSITIVE — the very same facts, with only the background now empty, produce the
    // schedule's own sentence: the detail that IS shown really tracks the state, not "whichever
    // one happens to be first" in the facts.
    const scheduledOnly: AgentFacets = { doing: 'idle', scheduled: true }
    const wakes = agentStateOf({ ...facts, background: NOTHING_IN_THE_BACKGROUND }, AT)
    expect(standingWord(scheduledOnly, wakes)).toBe(`scheduled · ${clockTime(wakesAt)}`)
  })
})

describe('§4 · the agent card plate, wired to a real transcript', () => {
  const cardHtml = (props: Record<string, unknown>): Promise<string> =>
    renderToString(createSSRApp({ render: () => h(AgentCard as never, props) }))

  /**
   * ⚑ D-017 · R11 — what the card's callers hand it: the transcript, and `stateHere`'s one state
   * over the SAME record (`ConversationPane`, `SessionPanel`, `SessionDrawer`). ⚑ D-036 · no one
   * named as holding work it gave out (`stateHere`'s fourth argument): these facets carry no wait.
   */
  const cardOf = (facets: AgentFacets, ...events: Parameters<typeof applyEvent>[1][]) => {
    const record = createSessionRecord('sess_card')
    for (const event of events) applyEvent(record.control, event)
    return cardHtml({
      facets,
      canOpen: false,
      panel: sessionPanel(record.control),
      state: record.control,
      mode: 'normal',
      agentState: stateHere(record, facets, null, []),
    })
  }

  // `SessionBot` draws the state word under the name beside the plate, rather than
  // `AgentState` drawing it below the plate.
  const subtitleOf = (html: string): string | null =>
    /<span [^>]*data-cy="session-bot-word"[^>]*>([\s\S]*?)<\/span>/.exec(html)?.[1]?.trim() ?? null

  it('🔴 a scheduled_work event reaches the plate as the wake-up time, not the bare word', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(AT)
    try {
      // ⚑ A level this app wrote, which carries the job's next minute; a provider's own level
      // names none, and then the word is the bare one.
      const html = await cardOf(
        { doing: 'idle', scheduled: true },
        {
          type: 'scheduled_work',
          jobs: [
            { id: 'j1', schedule: '0 3 5 * 2', recurring: true, nominalAt: local(9, 29, 3, 0) },
          ],
          source: 'app/receipts',
        },
      )
      const subtitle = subtitleOf(html)
      // Present before its text is asked for — a `null` here would pass the `.toBe` below vacuously.
      expect(subtitle).not.toBeNull()
      expect(subtitle).toBe(`scheduled · ${clockTime(local(9, 29, 3, 0))}`)
      const bare = subtitleOf(
        await cardOf(
          { doing: 'idle', scheduled: true },
          {
            type: 'scheduled_work',
            jobs: [{ id: 'j1', schedule: '0 3 5 * 2', recurring: true }],
            source: 'hook/Stop',
          },
        ),
      )
      expect(bare).toBe('scheduled')
    } finally {
      vi.useRealTimers()
    }
  })

  it('🔴 a background_work event reaches the plate as the command, not the bare word', async () => {
    const html = await cardOf(
      { doing: 'idle', detached: true },
      {
        type: 'background_work',
        running: [{ id: 'b1', description: 'npm test' }],
        source: 'background_tasks_changed',
      },
    )
    const subtitle = subtitleOf(html)
    expect(subtitle).not.toBeNull()
    expect(subtitle).toBe('running in the background · npm test')
  })

  it('⚑ THE CONTROL — a real but unfed transcript never leaks a stray detail onto a plain idle plate', async () => {
    const html = await cardOf({ doing: 'idle' })
    const subtitle = subtitleOf(html)
    expect(subtitle).not.toBeNull()
    expect(subtitle).toBe('idle')
    expect(subtitle).not.toContain('·')
  })
})
