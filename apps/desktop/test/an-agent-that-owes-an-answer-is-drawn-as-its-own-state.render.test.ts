import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import AgentCard from '../src/renderer/src/components/AgentCard.vue'
import ConversationPane from '../src/renderer/src/components/ConversationPane.vue'
import {
  accessibleName,
  facetsOfState,
  plateWord,
  priorityDotToken,
  recordFacets,
  standingOf,
  standingWord,
  stateHere,
  STANDING_LABEL,
  STANDING_TONE,
  type AgentFacets,
} from '../src/renderer/src/lib/agent-state'
import { whoItOwesIn } from '../src/renderer/src/lib/conversation-waits'
import { sessionPanel } from '../src/renderer/src/lib/session-panel'
import { createSessionRecord } from '../src/renderer/src/lib/session-record'
import { applyEvent } from '../src/renderer/src/lib/transcript'
import { agentStateWords, type AgentState } from '../src/shared/agent-state'
import type { CreatedSession, SessionLiveness, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * # F036 · the window half — an agent that owes another an answer is drawn as its own state (`09ca7541`)
 *
 * ## What this file pins, and why it is its own file
 *
 * `09ca7541` gave the window an EIGHTH facet, `owes`, read off the one state the host pushes of a
 * conversation (`whoItOwesIn`), and a tenth standing, `owes`, worded *"Owes another agent an
 * answer"*, toned blank. The commit moved the facet sweeps and the standings census by cause —
 * every one of them asks that a standing EXISTS for every facet combination, and none asks WHICH:
 *
 *  - no test reads `whoItOwesIn`, the one place the askers enter the window (§1);
 *  - no test asks where `owes` RANKS among the other facets — above the background, the schedule,
 *    a worker wait and an idle plate's work; below a running turn, its own unanswered question and
 *    a person's card (§2);
 *  - no test asks what a plate or a row SAYS under it — the asker's name, `+N` for more — off the
 *    state, and off the facet alone where a caller holds no state (§3);
 *  - no test asks what a screen reader hears — the short clause, said once, never the asker
 *    twice — nor that it adds no amber (§4);
 *  - no test draws the pane or the agent card under it (§5, §6), the two places the report names:
 *    the header's family word, and a schedule that still shows because `owes` ranks above it.
 *
 * ⚠️ The names are literals for the D-036 file's reason: a rename of the naming function cannot
 * move the expectation with it.
 */

const ADA = 'Ada (the owner of W1.2 · Build the pages)'
const ALI = 'Ali (the owner of W1.3 · Wire the routes)'
const BROBOT = 'BroBot (the owner of W1)'
const OWES_ADA = `owes an answer to ${ADA}`

const OWES_ONE: AgentState = { is: 'owes-an-answer', to: [ADA] }
const OWES_TWO: AgentState = { is: 'owes-an-answer', to: [ADA, ALI] }

// ─── §1 · where the askers enter the window ──────────────────────────────────────────────────────

describe('§1 · whoItOwesIn reads the askers off the host’s state, and only off that arm', () => {
  it('🔴 the askers of an owes-an-answer state, in the host’s order, and nothing for any other state', () => {
    expect(whoItOwesIn(OWES_ONE)).toEqual([ADA])
    expect(whoItOwesIn(OWES_TWO)).toEqual([ADA, ALI])
    // ⛔ THE PAIRS — no state, and the states beside it that also name somebody: absent, so the
    // facet adds nothing (`theWaitIn`'s rule), and a name another arm carries is never taken for one.
    expect(whoItOwesIn(null)).toBeUndefined()
    expect(whoItOwesIn(undefined)).toBeUndefined()
    expect(whoItOwesIn({ is: 'idle' })).toBeUndefined()
    expect(whoItOwesIn({ is: 'waiting-on-an-answer', from: ADA })).toBeUndefined()
    expect(whoItOwesIn({ is: 'waiting-on-a-worker', on: [ADA] })).toBeUndefined()
  })

  it('⚑ facetsOfState draws another window’s owing conversation as an idle plate that carries its askers', () => {
    expect(facetsOfState(OWES_TWO)).toEqual({ doing: 'idle', owes: [ADA, ALI] })
    // ⛔ THE CONTROL — an idle state carries no askers.
    expect(facetsOfState({ is: 'idle' })).not.toHaveProperty('owes')
  })
})

// ─── §2 · where the standing ranks ───────────────────────────────────────────────────────────────

describe('§2 · `owes` ranks where the one order ranks it', () => {
  const owing: AgentFacets = { doing: 'idle', owes: [ADA] }

  it('🔴 above the background, the schedule, a worker wait and an idle plate’s work', () => {
    expect(standingOf(owing)).toBe('owes')
    for (const over of [
      { detached: true },
      { scheduled: true },
      { waiting: 'waiting-on-a-worker' },
      { work: { state: 'stalled' } },
      { work: { state: 'answered', outcome: 'done' } },
    ] as const satisfies readonly Partial<AgentFacets>[]) {
      expect(standingOf({ ...owing, ...over }), JSON.stringify(over)).toBe('owes')
      // ⛔ THE PAIR — the same facets, nobody waiting on its answer: the fact below it shows.
      expect(standingOf({ doing: 'idle', ...over }), JSON.stringify(over)).not.toBe('owes')
    }
  })

  it('⛔ below a running turn, its own unanswered question and a person’s card', () => {
    expect(standingOf({ ...owing, doing: 'working' })).toBe('working')
    expect(standingOf({ ...owing, waiting: 'waiting-on-an-answer' })).toBe('elsewhere')
    expect(standingOf({ ...owing, waiting: 'waiting-on-a-person' })).toBe('waiting')
    expect(standingOf({ ...owing, needing: 'permission' })).toBe('waiting')
  })

  it('🔴 stateHere carries the askers into the one state, and the order decides as it does', () => {
    const record = createSessionRecord('sess_owes')
    expect(stateHere(record, owing, null, [])).toEqual(OWES_ONE)
    expect(stateHere(record, { doing: 'idle', owes: [ADA, ALI] }, null, [])).toEqual(OWES_TWO)
    // ⚑ Above the worker wait: the holders are not what it says.
    expect(stateHere(record, { ...owing, waiting: 'waiting-on-a-worker' }, null, [ALI])).toEqual(
      OWES_ONE,
    )
    // ⛔ Below its own question, and below a turn.
    expect(stateHere(record, { ...owing, waiting: 'waiting-on-an-answer' }, BROBOT, [])).toEqual({
      is: 'waiting-on-an-answer',
      from: BROBOT,
    })
    expect(stateHere(record, { ...owing, doing: 'working' }, null, [])).toEqual({ is: 'active' })
    // ⛔ THE CONTROL — no askers, no arm.
    expect(stateHere(record, { doing: 'idle' }, null, [])).toEqual({ is: 'idle' })
  })
})

// ─── §3 · what a plate and a row say ─────────────────────────────────────────────────────────────

describe('§3 · the plate and the row name the asker, off the state or off the facet alone', () => {
  it('🔴 the one state’s words, with " +N" for more askers, whether the caller holds the state or not', () => {
    const one = facetsOfState(OWES_ONE)
    const two = facetsOfState(OWES_TWO)
    expect(standingWord(one, OWES_ONE)).toBe(OWES_ADA)
    expect(standingWord(two, OWES_TWO)).toBe(`${OWES_ADA} +1`)
    // ⚑ No state handed in: the facet carries the same names, so the word is the same.
    expect(standingWord(one)).toBe(OWES_ADA)
    expect(standingWord(two)).toBe(`${OWES_ADA} +1`)
    expect(agentStateWords(OWES_TWO)).toBe(`${OWES_ADA} +1`)
  })

  it('🔴 the plate says the asker, not *idle*, and an idle plate without one says idle', () => {
    expect(plateWord(facetsOfState(OWES_ONE), OWES_ONE)).toBe(OWES_ADA)
    expect(plateWord({ doing: 'idle', owes: [ADA] })).toBe(OWES_ADA)
    // ⛔ THE PAIR — the same plate, nobody waiting on it.
    const idle = plateWord({ doing: 'idle' }, { is: 'idle' })
    expect(idle).toBe('idle')
    expect(idle).not.toContain('owes')
  })

  it('⚑ recordFacets carries the askers it is handed onto a fed record, and adds nothing without them', () => {
    const record = openRecord()
    expect(recordFacets(record, undefined, undefined, [ADA]).owes).toEqual([ADA])
    expect(recordFacets(record, undefined, undefined, undefined)).not.toHaveProperty('owes')
    expect(recordFacets(record)).not.toHaveProperty('owes')
  })
})

// ─── §4 · what a screen reader hears, and the tone ───────────────────────────────────────────────

describe('§4 · a screen reader hears the short clause once, and nothing turns amber', () => {
  const CLAUSE = 'owes another agent an answer'

  it('🔴 the clause is said once, and the asker is not said by the plate (the row beside it names who)', () => {
    const one = accessibleName({ doing: 'idle', owes: [ADA], label: 'claude' })
    expect(one).toContain(CLAUSE)
    expect(one).not.toContain('Ada')
    const two = accessibleName({ doing: 'idle', owes: [ADA, ALI], label: 'claude' })
    expect(two.split(CLAUSE)).toHaveLength(2)
    expect(two).not.toContain('Ali')
    // ⛔ THE PAIR — the same plate with nobody waiting: no clause.
    expect(accessibleName({ doing: 'idle', label: 'claude' })).not.toContain(CLAUSE)
  })

  it('⛔ the family word is its own, toned blank, and the priority dot is an idle plate’s', () => {
    expect(STANDING_LABEL.owes).toBe('Owes another agent an answer')
    // ⚑ A word of its own, not *Waiting on another agent*: here THIS one owes the next move.
    expect(STANDING_LABEL.owes).not.toBe(STANDING_LABEL.elsewhere)
    expect(STANDING_TONE.owes).toBe('')
    // ⛔ THE PAIR — a person's card is toned: blank is a choice, not a default.
    expect(STANDING_TONE.waiting).not.toBe('')
    expect(priorityDotToken({ doing: 'idle', owes: [ADA] })).toBe(
      priorityDotToken({ doing: 'idle' }),
    )
    expect(priorityDotToken({ doing: 'idle', owes: [ADA], needing: 'permission' })).not.toBe(
      priorityDotToken({ doing: 'idle', owes: [ADA] }),
    )
  })
})

// ─── §5 and §6 · the window's surfaces ───────────────────────────────────────────────────────────

const liveness: SessionLiveness = { state: 'live', since: 1_700_000_000_000 }

/** The meta the D-036 file's surfaces are drawn over (`a-giver-says-who-holds-the-work-it-gave-out`). */
const META: CreatedSession = {
  sessionId: 'sess_brobot',
  provider: 'claude',
  cwd: '/work/brobot',
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
  ref: { provider: 'claude', sessionId: 'th_1', cwd: '/work/brobot', rotation: 0 },
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
  liveness,
  hasACommander: false,
  startedWithoutAWindow: false,
  mayHandItBack: false,
}

/** An open conversation this window is fed, idle, whose events are the ones given. */
function openRecord(...events: TranscriptEvent[]) {
  const record = createSessionRecord('sess_brobot')
  record.meta = META
  record.phase = 'open'
  applyEvent(record.transcript, { type: 'status', state: 'idle' })
  for (const event of events) applyEvent(record.transcript, event)
  return record
}

const markup = (component: unknown, props: Record<string, unknown>): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(component as never, props) }))

/** What a person reads: this repo's templates carry their reasoning inline, as comments. */
const visible = (html: string): string => html.replace(/<!--[\s\S]*?-->/g, '')

describe('§5 · the pane of a conversation this window holds says it owes, off the host’s state of it', () => {
  const pane = (listedState: AgentState): Promise<string> =>
    markup(ConversationPane, {
      record: openRecord(),
      mode: 'chat' as const,
      debug: false,
      drawerOpen: true,
      drawerTab: 'open' as const,
      models: null,
      draft: '',
      listedState,
    })

  it('🔴 the header’s family word, its standing, and the asker’s name — and none of them under an idle state', async () => {
    const told = visible(await pane(OWES_ONE))
    expect(told).toContain(STANDING_LABEL.owes)
    expect(told).toContain('data-standing="owes"')
    expect(told).toContain(OWES_ADA)

    // ⛔ THE PAIR — the same held record, the host saying idle: a pane that really is drawn, saying
    // idle, with none of the words above.
    const idle = visible(await pane({ is: 'idle' }))
    expect(idle).toContain('data-standing="idle"')
    expect(idle).not.toContain(STANDING_LABEL.owes)
    expect(idle).not.toContain('owes an answer')
  })
})

describe('§6 · the agent card names the asker, and a schedule still shows under *owes*', () => {
  const JOB: TranscriptEvent = {
    type: 'scheduled_work',
    jobs: [{ id: 'j1', schedule: '*/5 * * * *', recurring: true, prompt: 'check the build' }],
    source: 'hook/Stop',
  }
  const cardOf = (facets: AgentFacets, agentState: AgentState): Promise<string> => {
    const record = createSessionRecord('sess_card')
    applyEvent(record.control, JOB)
    return markup(AgentCard, {
      facets,
      canOpen: false,
      panel: sessionPanel(record.control),
      state: record.control,
      mode: 'normal',
      agentState,
    })
  }
  const subtitleOf = (html: string): string | null =>
    /<span [^>]*data-cy="session-bot-word"[^>]*>([\s\S]*?)<\/span>/.exec(html)?.[1]?.trim() ?? null

  it('🔴 the card’s word names the asker, and the schedule bar is drawn: `owes` ranks above the schedule', async () => {
    const owing = visible(await cardOf({ doing: 'idle', owes: [ADA], scheduled: true }, OWES_ONE))
    expect(subtitleOf(owing)).toBe(OWES_ADA)
    expect(owing).toContain('data-cy="schedule-bar"')
    expect(owing).toContain('data-cy="schedule-row-j1"')

    // ⛔ THE PAIR — the same record and job under a state ranked below the schedule: no bar, so the
    // bar above is the ranking's and not an unconditional one.
    const idle = visible(await cardOf({ doing: 'idle', scheduled: true }, { is: 'idle' }))
    expect(idle).not.toContain('data-cy="schedule-bar"')
    expect(subtitleOf(idle) ?? '').not.toContain('owes')
  })
})
