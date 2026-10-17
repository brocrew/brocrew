import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import ConversationPane from '../src/renderer/src/components/ConversationPane.vue'
import SideRail from '../src/renderer/src/components/SideRail.vue'
import {
  STANDING_LABEL,
  STANDING_TONE,
  accessibleName,
  plateWord,
  recordFacets,
  standingOf,
  standingWord,
  type AgentFacets,
} from '../src/renderer/src/lib/agent-state'
import { theWaitIn, theWorkIn } from '../src/renderer/src/lib/conversation-waits'
import { createSessionRecord, type SessionRecord } from '../src/renderer/src/lib/session-record'
import { forestView } from '../src/renderer/src/lib/the-forest'
import { applyEvent } from '../src/renderer/src/lib/transcript'
import { WORK_STATE_WORD } from '../src/renderer/src/lib/work-report'
import type { CreatedSession } from '../src/shared/runtime-ipc'
import type { ForestNode, TheWholeForest } from '../src/shared/the-whole-forest'
import type {
  ConversationWait,
  HeldWork,
  WhatEachConversationIsWaitingOn,
} from '../src/shared/tasks'
import type { WhatIsBeingDone } from '../src/shared/what-is-being-done'

/**
 * 🔴 **D-006 · F018 — a finished agent and a stuck one both read "idle".**
 *
 * An agent whose piece is answered and done can still read “idle”. Its visible work state
 * must distinguish completion from being stuck, including helpers that finish while the giver
 * is idle.
 *
 * ⚑ The host's reading carries it beside each conversation's wait (`the-conversation-that-is-waiting`
 * §7); this file holds what the rail, the header and the forest draw from it.
 */

const NOW = 1_800_000_000_000
const here = dirname(fileURLToPath(import.meta.url))

const meta = (sessionId: string): CreatedSession =>
  ({
    sessionId,
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
    ref: { provider: 'claude', sessionId: `th_${sessionId}`, cwd: '/work/brobot', rotation: 0 },
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
    liveness: { state: 'live', since: NOW },
    hasACommander: false,
    startedWithoutAWindow: false,
    mayHandItBack: false,
  }) as CreatedSession

/** ⚑ A live conversation whose turn is over: the state F018's three agents were all in. */
function idleConversation(sessionId: string): SessionRecord {
  const record = createSessionRecord(sessionId)
  record.meta = meta(sessionId)
  record.phase = 'open'
  applyEvent(record.control, { type: 'status', state: 'idle' }, NOW)
  return record
}

/** ⚑ The reading the host builds — every running conversation, its wait and its work. */
const readingOf = (
  rows: Record<string, { waiting?: ConversationWait; work?: HeldWork }>,
): WhatEachConversationIsWaitingOn => ({
  readAt: NOW,
  conversations: Object.entries(rows).map(([conversation, row]) => ({
    conversation,
    identity: 'worker',
    waiting: row.waiting ?? null,
    work: row.work ?? null,
  })),
  rowsUnread: 0,
})

const DONE: HeldWork = { state: 'answered', outcome: 'done' }
const STUCK: HeldWork = { state: 'stalled' }

/** ⚑ F018's three: Ayo's work answered, Bo's stalled, Camille given nothing. */
const F018 = readingOf({ sess_ayo: { work: DONE }, sess_bo: { work: STUCK }, sess_cam: {} })

function surfaces(record: SessionRecord, reading: WhatEachConversationIsWaitingOn | null) {
  const facets = recordFacets(
    record,
    theWaitIn(reading, record.sessionId),
    theWorkIn(reading, record.sessionId),
  )
  return {
    standing: standingOf(facets),
    railWord: standingWord(facets),
    pill: STANDING_LABEL[standingOf(facets)],
    tone: STANDING_TONE[standingOf(facets)],
    plate: plateWord(facets),
    read: accessibleName({ ...facets, label: 'agent' }),
  }
}

describe('D-006 §1 · the three surfaces say which, off the one reading', () => {
  it('🔴 F018 · the finished agent says answered and the stuck one says so — and without the read both said idle', () => {
    // The control uses the same records with no work state in the reading.
    for (const id of ['sess_ayo', 'sess_bo']) {
      const before = surfaces(idleConversation(id), readingOf({ [id]: {} }))
      expect(before.standing).toBe('idle')
      expect(before.railWord).toBe('idle')
      expect(before.pill).toBe('Idle')
    }

    const ayo = surfaces(idleConversation('sess_ayo'), F018)
    expect(ayo.standing).toBe('answered')
    expect(ayo.railWord).toBe('answered (done)')
    expect(ayo.pill).toBe('Answered')
    expect(ayo.plate).toBe('answered (done)')
    // ⚑ **D-017b · no `live` in the sentence**: whether a process runs is not the plate's to say.
    expect(ayo.read).toBe('agent — idle, answered (done)')

    const bo = surfaces(idleConversation('sess_bo'), F018)
    expect(bo.standing).toBe('stalled')
    expect(bo.railWord).toBe('not being worked on')
    expect(bo.pill).toBe('Not being worked on')
    expect(bo.plate).toBe('not being worked on')
    expect(bo.read).toBe('agent — idle, not being worked on')

    // ⚑ **Camille, given nothing**: plain idle, which is now a statement that nothing is held.
    const cam = surfaces(idleConversation('sess_cam'), F018)
    expect(cam.standing).toBe('idle')
    expect(cam.read).toBe('agent — idle')
  })

  it('⚑ the words are the Work tab’s own, with the outcome its owner reported', () => {
    // ⛔ `222` §4 — one phrase for one fact: the Work tab calls a stalled task *not being worked
    // on*, so the agent holding it may not be called anything else.
    const facets = (work: HeldWork): AgentFacets => ({ doing: 'idle', being: 'live', work })
    expect(standingWord(facets(STUCK))).toBe(WORK_STATE_WORD.stalled)
    expect(standingWord(facets({ state: 'answered', outcome: null }))).toBe(
      WORK_STATE_WORD.answered,
    )
    for (const outcome of ['done', 'blocked', 'failed'] as const) {
      expect(standingWord(facets({ state: 'answered', outcome }))).toBe(
        `${WORK_STATE_WORD.answered} (${outcome})`,
      )
    }
    // Use blank tones for `elsewhere`: an agent’s stall must not add amber attention for the
    // person.
    expect(STANDING_TONE.stalled).toBe('')
    expect(STANDING_TONE.answered).toBe('')
  })
})

describe('D-006 §2 · which of two true things the one slot says', () => {
  const idle = (over: AgentFacets): AgentFacets => ({ doing: 'idle', being: 'live', ...over })

  it('⛔ an agent running a turn says working, whatever its work’s last ending was', () => {
    for (const work of [DONE, STUCK]) {
      expect(standingOf({ doing: 'working', being: 'live', work })).toBe('working')
      expect(accessibleName({ doing: 'working', being: 'live', work })).toBe(
        'agent — working, live',
      )
    }
  })

  it('⛔ something that will move the work outranks it: running work, another agent, a wake-up', () => {
    expect(standingOf(idle({ work: STUCK, detached: true }))).toBe('background')
    expect(standingOf(idle({ work: STUCK, waiting: 'waiting-on-a-worker' }))).toBe('elsewhere')
    expect(standingOf(idle({ work: STUCK, scheduled: true }))).toBe('scheduled')
    // ⚑ …and a person's wait outranks everything idle, as it always has.
    expect(standingOf(idle({ work: STUCK, waiting: 'waiting-on-a-person' }))).toBe('waiting')
  })

  it('⛔ a conversation that has stopped says where its work stands, and one nobody has heard about reads unknown', () => {
    // ⚑ **D-017b · no standing says whether it stopped** (`05` rule 5): a conversation drawn from
    // its ledger, or one whose provider failed, reads by the one state like any idle one — so the
    // work it holds is what its word says.
    const recorded = idleConversation('sess_bo')
    recorded.phase = 'recorded'
    expect(surfaces(recorded, F018).standing).toBe('stalled')
    const failed = idleConversation('sess_ayo')
    applyEvent(failed.control, { type: 'status', state: 'errored' }, NOW)
    expect(surfaces(failed, F018).standing).toBe('answered')
    // ⛔ …and with no word from the host, the work is never said over a faceless ring.
    expect(standingOf({ work: STUCK })).toBe('unknown')
  })

  it('⚑ an absent reading adds nothing: the work is never guessed', () => {
    const record = idleConversation('sess_ayo')
    expect(theWorkIn(null, 'sess_ayo')).toBeUndefined()
    expect(theWorkIn(F018, 'sess_nobody')).toBeUndefined()
    expect(theWorkIn(F018, 'sess_cam')).toBeUndefined()
    expect(recordFacets(record, undefined, undefined)).not.toHaveProperty('work')
  })
})

describe('D-006 §3 · the rail and the header draw it', () => {
  const rail = (reading: WhatEachConversationIsWaitingOn | null): Promise<string> =>
    renderToString(
      createSSRApp({
        render: () =>
          h(SideRail as never, {
            open: ['sess_ayo', 'sess_bo', 'sess_cam'].map(idleConversation),
            activeId: 'sess_ayo',
            place: null,
            waiting: reading,
          }),
      }),
    )

  it('🔴 the rail rows tell the finished agent from the stuck one — and without the work, they did not', async () => {
    const told = await rail(F018)
    expect(told).toContain('claude · answered (done)')
    expect(told).toContain('claude · not being worked on')
    expect(told).toContain('data-standing="answered"')
    expect(told).toContain('data-standing="stalled"')
    expect(told).toContain('data-standing="idle"')
    // ⛔ **THE PAIR**: the same rows with no work read — three identical `idle` rows.
    const untold = await rail(readingOf({ sess_ayo: {}, sess_bo: {}, sess_cam: {} }))
    expect(untold).not.toContain('answered (done)')
    expect(untold).not.toContain('not being worked on')
    expect(untold.split('data-standing="idle"').length - 1).toBe(3)
    expect(untold).toContain('claude · idle')
  })

  const pane = (heldWork?: HeldWork): Promise<string> =>
    renderToString(
      createSSRApp({
        render: () =>
          h(ConversationPane as never, {
            record: idleConversation('sess_bo'),
            mode: 'chat' as const,
            debug: false,
            drawerOpen: false,
            drawerTab: 'open' as const,
            draft: '',
            ...(heldWork ? { heldWork } : {}),
          }),
      }),
    )

  it('🔴 the header pill says it, and without the prop it says Idle', async () => {
    const stuck = await pane(STUCK)
    expect(stuck).toContain(STANDING_LABEL.stalled)
    expect(stuck).toContain('data-standing="stalled"')
    const done = await pane(DONE)
    expect(done).toContain('data-standing="answered"')
    const untold = await pane()
    expect(untold).toContain('data-standing="idle"')
    expect(untold).not.toContain(STANDING_LABEL.stalled)
  })

  it('⚑ the screen hands it to the pane and to the forest’s live plates, off the same reading', () => {
    // ⚠️ `RuntimeScreen` is not mounted by any test, so its two lines are read as code.
    const screen = readFileSync(
      join(here, '../src/renderer/src/components/RuntimeScreen.vue'),
      'utf8',
    )
    // ⚑ **The positive control**: the wait's own line, which the work's sits beside.
    expect(screen).toContain(':waiting="theWaitIn(conversationWaits, active.sessionId)"')
    expect(screen).toContain(':held-work="theWorkIn(conversationWaits, active.sessionId)"')
    expect(screen).toContain('theWorkIn(conversationWaits.value, record.sessionId)')
  })
})

describe('D-006 §4 · the forest draws it on the conversation’s own card', () => {
  const node = (conversation: string): ForestNode =>
    ({
      node: 'a-conversation',
      conversation,
      under: { is: 'the-person' },
      identity: 'worker',
      provider: 'claude',
      status: 'idle',
      running: 'unwatched',
      standsInFor: [],
      inItsPlace: null,
      startedAt: NOW - 60_000,
      updatedAt: NOW - 1_000,
      spawnedAt: null,
      spawnReason: null,
    }) as ForestNode

  const forest: TheWholeForest = {
    readAt: NOW,
    nodes: {
      rows: [node('sess_ayo'), node('sess_bo')],
      walk: 'every-conversation-this-app-placed',
      ledgers: 2,
      rowsUnread: 0,
    },
    conversations: 2,
    heldByNoAgent: 0,
  } as TheWholeForest

  const idleNow = {
    readAt: NOW,
    conversations: ['sess_ayo', 'sess_bo'].map((conversation) => ({
      conversation,
      identity: 'worker',
      told: { said: 'nothing', because: 'no-activity-right-now' },
      status: 'idle',
      streaming: false,
      since: NOW - 5_000,
    })),
  } as unknown as WhatIsBeingDone

  it('🔴 each card says which, and the plate is handed the work itself', () => {
    const view = forestView({
      forest,
      atWork: idleNow,
      waits: F018,
      identities: null,
      held: new Set<string>(),
    })
    const says = (id: string) => view!.rows.find((row) => row.conversation === id)
    expect(says('sess_ayo')?.says).toBe('Answered')
    expect(says('sess_ayo')?.facets.work).toEqual(DONE)
    expect(says('sess_bo')?.says).toBe('Not being worked on')
    // ⛔ **THE PAIR**: no reading, no claim.
    const none = forestView({
      forest,
      atWork: idleNow,
      waits: null,
      identities: null,
      held: new Set<string>(),
    })
    expect(none!.rows.find((row) => row.conversation === 'sess_ayo')?.says).toBe('Idle')
    expect(none!.rows[0]!.facets).not.toHaveProperty('work')
  })
})
