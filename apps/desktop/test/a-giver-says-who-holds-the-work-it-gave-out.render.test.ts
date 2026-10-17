import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type {
  AgentToolset,
  ApprovalMode,
  FakeSessionHandle,
  ResumeOptions,
  SessionRef,
  StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, THE_APP_ITSELF } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import AgentCard from '../src/renderer/src/components/AgentCard.vue'
import ConversationPane from '../src/renderer/src/components/ConversationPane.vue'
import SideRail from '../src/renderer/src/components/SideRail.vue'
import {
  facetsOfState,
  plateWord,
  standingOf,
  standingWord,
  stateHere,
  STANDING_LABEL,
  type AgentFacets,
} from '../src/renderer/src/lib/agent-state'
import { theWaitIn, whoseWorkIn } from '../src/renderer/src/lib/conversation-waits'
import { sessionPanel } from '../src/renderer/src/lib/session-panel'
import { createSessionRecord } from '../src/renderer/src/lib/session-record'
import { applyEvent } from '../src/renderer/src/lib/transcript'
import {
  agentStateOf,
  agentStateWords,
  NOTHING_IN_THE_BACKGROUND,
  NOTHING_SCHEDULED,
  type AgentState,
  type AgentStateFacts,
} from '../src/shared/agent-state'
import {
  DEFAULT_PROFILE_ID,
  type CreatedSession,
  type ResumableSessionInfo,
  type RuntimeEventMessage,
  type RuntimeStatesMessage,
  type SessionLiveness,
  type TranscriptEvent,
  type UnresumableSessionInfo,
} from '../src/shared/runtime-ipc'
import type {
  ConversationWaiting,
  PieceRow,
  WhatEachConversationIsWaitingOn,
} from '../src/shared/tasks'
import { proseSpans } from './lib/prose-spans'

/**
 * # D-036 · a giver says who holds the work it gave out
 *
 * ## What this file pins, and why it is its own file
 *
 * D-036 gave the one state a seventh arm, `waiting-on-a-worker`: a conversation that is otherwise
 * idle while a piece it gave is still open reads *"waiting on Ali (the owner of W1.1.1 · Wire the
 * routes)"*, each holder named once, and ` +N` for N other agents. The commit re-aimed seven files
 * by cause and added no test that names a holder, so this file measures the arm in four stretches,
 * each from the reader that says it:
 *
 *  - **the pure derivation** (§1 to §4): the one state's ladder and its words, the window's
 *    `stateHere` and `facetsOfState` over it, and the host's verdict deciding which wait a window
 *    draws (`theWaitIn`, `whoseWorkIn`). Nothing is mounted and nothing runs;
 *  - **the window's surfaces** (§5, §6): the rail row, the pane's header and plate and the agent
 *    card, in server-rendered markup, each fed the host's names;
 *  - **the screen's wiring** (§7): `RuntimeScreen.vue` hands the pane and the palette those names.
 *    This is a SOURCE read, with every comment blanked first;
 *  - **the host** (§8 to §15): a real `RuntimeHost` over a real SQLite ledger and a provider double,
 *    reading who holds the work at every door, naming each holder once, moving the pushed word when
 *    the fact moves (a give, a reply, a take-back, a close, a retitle, a rename, a replacement),
 *    keeping a torn row of a helper's ledger off the giver's own record, and stopping a giver that
 *    only waits.
 *
 * ## ⚠️ How the host half asserts a pushed word
 *
 * A card is derived fresh at every read, so it says the right word even when the kept read the
 * flush works from went stale. Every assertion on a PUSHED word therefore reads `pushed` and nothing
 * else: no card and no list read stands between a mark and the word it is checked for (a list read
 * also resets what each window was last told). The pushed word is compared with a card only after
 * it has been collected.
 *
 * ## ⚠️ Why the expected words are literals
 *
 * `ADA`, `ALI` and `AMARA` are spelled out here and never computed by the code under test, so a
 * rename of the naming function cannot move the expectation with it. Each absence below sits beside
 * a presence read from the same reader one fact over, because SSR renders text and no layout and a
 * `not.toContain` also passes against a component that drew nothing.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const SRC = join(here, '../src')

/** The sentences the cases below expect BroBot's child, its grandchild and a third agent to be called by. */
const ADA = 'Ada (the owner of W1.1 · Build the pages)'
const ALI = 'Ali (the owner of W1.1.1 · Wire the routes)'
const AMARA = 'Amara (the owner of W1.2 · Review it)'

/** The words the one state says of a holder: one name, then each further agent as ` +N`. */
const WAITING_ON_ADA = `waiting on ${ADA}`
const WAITING_ON_ALI = `waiting on ${ALI}`

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/**
 * A stretch of the event loop long enough for everything a provider row starts to have run: five
 * turns of `setImmediate` (each pump, and the flush a mark arms, run there) and a short timer.
 */
async function settle(): Promise<void> {
  for (let round = 0; round < 2; round++) {
    for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
}

// ─── §1 · the one state's ladder and words ───────────────────────────────────────────────────────

/** Facts that say nothing: every arm is false, and the holders are the only thing a case sets. */
const NO_FACTS: Omit<AgentStateFacts, 'waitingOnTheWorkOf'> = {
  needsYou: false,
  active: false,
  waitingOnTheAnswerOf: null,
  // ⚑ F036 · owing nobody an answer.
  owesAnAnswerTo: [],
  background: NOTHING_IN_THE_BACKGROUND,
  scheduled: NOTHING_SCHEDULED,
}

const factsWith = (
  holders: readonly string[],
  over: Partial<AgentStateFacts> = {},
): AgentStateFacts => ({ ...NO_FACTS, waitingOnTheWorkOf: holders, ...over })

describe('§1 · the one state names who holds the work, and ranks it below every other wait', () => {
  it('🔴 one holder, several in the order given with " +N", and none reads idle', () => {
    const one = agentStateOf(factsWith([ADA]), 0)
    expect(one).toEqual({ is: 'waiting-on-a-worker', on: [ADA] })
    expect(agentStateWords(one)).toBe(WAITING_ON_ADA)

    // ⚑ Two holders: both are carried, in the order the host gave them, and the words name the
    // first and count the other.
    const two = agentStateOf(factsWith([ADA, ALI]), 0)
    expect(two).toEqual({ is: 'waiting-on-a-worker', on: [ADA, ALI] })
    expect(agentStateWords(two)).toBe(`${WAITING_ON_ADA} +1`)

    const three = agentStateOf(factsWith([ADA, ALI, AMARA]), 0)
    expect(three).toEqual({ is: 'waiting-on-a-worker', on: [ADA, ALI, AMARA] })
    expect(agentStateWords(three)).toBe(`${WAITING_ON_ADA} +2`)

    // ⛔ THE CONTROL — the same facts with nobody holding work are idle, plainly: the arm is not
    // reached by elimination alone.
    expect(agentStateOf(factsWith([]), 0)).toEqual({ is: 'idle' })
    expect(agentStateWords(agentStateOf(factsWith([]), 0))).toBe('idle')
  })

  it('⚑ the arm is reached only when everything above it is false', () => {
    const holding = [ADA]
    // The positive, on the very facts the three cases below start from.
    expect(agentStateOf(factsWith(holding), 0).is).toBe('waiting-on-a-worker')

    // A held schedule outranks it: the wake-up is what will move this conversation next.
    const scheduled = factsWith(holding, {
      scheduled: {
        jobs: [{ id: 'j1', schedule: '*/5 * * * *', recurring: true }],
        dropped: 0,
      },
    })
    expect(agentStateOf(scheduled, 0).is).toBe('scheduled')
    // A person owing it an answer outranks it.
    expect(agentStateOf(factsWith(holding, { needsYou: true }), 0)).toEqual({ is: 'needs-you' })
    // …and so does a turn running.
    expect(agentStateOf(factsWith(holding, { active: true }), 0)).toEqual({ is: 'active' })
  })
})

// ─── §2 · the window derives no worker wait of its own ───────────────────────────────────────────

describe('§2 · the window derives no worker wait of its own: stateHere takes the host’s names only on the worker wait', () => {
  const record = createSessionRecord('sess_g')
  const waitingOnAWorker: AgentFacets = { doing: 'idle', waiting: 'waiting-on-a-worker' }

  it('🔴 the names reach the state only under the worker wait, and no name is no arm', () => {
    // The positive, which the negatives below are one fact over from.
    const named = stateHere(record, waitingOnAWorker, null, [ADA])
    expect(named).toEqual({ is: 'waiting-on-a-worker', on: [ADA] })
    expect(agentStateWords(named)).toBe(WAITING_ON_ADA)

    // ⛔ The wait with no names says nothing it can name: an arm is never reached with no holder.
    expect(stateHere(record, waitingOnAWorker, null, [])).toEqual({ is: 'idle' })

    // ⛔ Names alone derive nothing: a conversation whose facets hold no wait is idle whoever the
    // host happens to have named.
    expect(stateHere(record, { doing: 'idle' }, null, [ADA])).toEqual({ is: 'idle' })
  })

  it('⚑ an answer owed outranks work out, and the state carries the answerer and not the holders', () => {
    const answered = stateHere(record, { doing: 'idle', waiting: 'waiting-on-an-answer' }, ADA, [
      ALI,
    ])
    expect(answered).toEqual({ is: 'waiting-on-an-answer', from: ADA })
    expect(agentStateWords(answered)).toBe(`waiting on an answer from ${ADA}`)
  })
})

// ─── §3 · a conversation this window is not fed ──────────────────────────────────────────────────

describe('§3 · a conversation this window is not fed is drawn as another agent’s wait, in the one state’s words', () => {
  const state: AgentState = { is: 'waiting-on-a-worker', on: [ADA] }

  it('🔴 facetsOfState, standingOf, standingWord and plateWord all say who holds the work', () => {
    const facets = facetsOfState(state)
    expect(facets).toEqual({ doing: 'idle', waiting: 'waiting-on-a-worker' })
    // Not idle and not the amber *waiting*: another agent owes the next move.
    expect(standingOf(facets)).toBe('elsewhere')
    expect(standingWord(facets, state)).toBe(WAITING_ON_ADA)
    expect(plateWord(facets, state)).toBe(WAITING_ON_ADA)

    // Without the state the word falls back to the family's own, which names nobody.
    expect(standingWord(facets)).toBe('waiting on a worker')
    expect(STANDING_LABEL.elsewhere).toBe('Waiting on another agent')

    // ⛔ THE CONTROL — the two states beside it, through the same four functions.
    const idle = facetsOfState({ is: 'idle' })
    expect(standingOf(idle)).toBe('idle')
    expect(standingWord(idle, { is: 'idle' })).toBe('idle')
    expect(standingOf(facetsOfState({ is: 'scheduled', dueAt: null }))).toBe('scheduled')
  })
})

// ─── §4 · the host's verdict decides the wait the window draws ───────────────────────────────────

describe('§4 · the host’s verdict decides the wait the window draws', () => {
  const row = (over: Partial<ConversationWaiting>): ConversationWaiting => ({
    conversation: 'sess_a',
    identity: 'default',
    waiting: null,
    work: null,
    ...over,
  })
  const reading = (...conversations: ConversationWaiting[]): WhatEachConversationIsWaitingOn => ({
    readAt: 1,
    conversations,
    rowsUnread: 0,
  })
  const verdict = {
    needsYou: false,
    waitingOnTheAnswerOf: null,
    waitingOnTheWorkOf: [ALI],
  } as const

  it('🔴 the names decide the worker wait, whatever the composition’s own wait says', () => {
    // (A) The host names a holder and the composition says nothing: a worker wait, and the name.
    const named = reading(row({ ...verdict, waiting: null }))
    expect(theWaitIn(named, 'sess_a')).toBe('waiting-on-a-worker')
    expect(whoseWorkIn(named, 'sess_a')).toEqual([ALI])

    // (B) An open question the host does not count as owed makes the composition say *an answer*:
    // the verdict hides no work.
    const questioned = reading(row({ ...verdict, waiting: 'waiting-on-an-answer' }))
    expect(theWaitIn(questioned, 'sess_a')).toBe('waiting-on-a-worker')

    // (C) No holder named: no worker wait, although the composition says one. The verdict decides,
    // and it is not read off `waiting`.
    const nobody = reading(
      row({ ...verdict, waitingOnTheWorkOf: [], waiting: 'waiting-on-a-worker' }),
    )
    expect(theWaitIn(nobody, 'sess_a')).toBeUndefined()
    expect(whoseWorkIn(nobody, 'sess_a')).toEqual([])

    // (D) The two waits above it in the verdict's order win over the same names.
    const answerOwed = reading(row({ ...verdict, waitingOnTheAnswerOf: ADA }))
    expect(theWaitIn(answerOwed, 'sess_a')).toBe('waiting-on-an-answer')
    const personOwed = reading(row({ ...verdict, needsYou: true }))
    expect(theWaitIn(personOwed, 'sess_a')).toBe('waiting-on-a-person')
    // …and the names are still the host's, whichever wait wins.
    expect(whoseWorkIn(personOwed, 'sess_a')).toEqual([ALI])
  })

  it('⚑ a reading that covers nobody, or a row without the field, names nobody', () => {
    // The positive: the reader does name holders where it can.
    expect(whoseWorkIn(reading(row({ ...verdict })), 'sess_a')).toEqual([ALI])
    // (E) No reading at all, a conversation the reading does not cover, and a hand-made row that
    // carries no verdict: three absences, each an empty list.
    expect(whoseWorkIn(null, 'sess_a')).toEqual([])
    expect(whoseWorkIn(reading(row({ ...verdict })), 'sess_other')).toEqual([])
    expect(whoseWorkIn(reading(row({ waiting: 'waiting-on-a-worker' })), 'sess_a')).toEqual([])
  })

  it('⚑ a hand-made row with no verdict is read as its own wait, and a verdict row with no names reads none', () => {
    // Absent is *not read*: the composition's wait stands where the host gave no verdict.
    const handMade = reading(row({ waiting: 'waiting-on-a-worker' }))
    expect(theWaitIn(handMade, 'sess_a')).toBe('waiting-on-a-worker')
    // The same function, a verdict that names nobody: no wait at all.
    const decided = reading(
      row({ needsYou: false, waitingOnTheAnswerOf: null, waitingOnTheWorkOf: [], waiting: null }),
    )
    expect(theWaitIn(decided, 'sess_a')).toBeUndefined()
  })
})

// ─── §5 and §6 · the window's surfaces ───────────────────────────────────────────────────────────

const liveness: SessionLiveness = { state: 'live', since: 1_700_000_000_000 }

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

/** The row the host builds for a running conversation: the verdict fields beside the composition's. */
const hostRow = (waitingOnTheWorkOf: readonly string[]): ConversationWaiting => ({
  conversation: 'sess_brobot',
  identity: 'default',
  waiting: waitingOnTheWorkOf.length > 0 ? 'waiting-on-a-worker' : null,
  work: null,
  needsYou: false,
  waitingOnTheAnswerOf: null,
  waitingOnTheWorkOf,
})

const aReading = (...rows: ConversationWaiting[]): WhatEachConversationIsWaitingOn => ({
  readAt: 1,
  conversations: rows,
  rowsUnread: 0,
})

const markup = (component: unknown, props: Record<string, unknown>): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(component as never, props) }))

/** What a person reads: this repo's templates carry their reasoning inline, as comments. */
const visible = (html: string): string => html.replace(/<!--[\s\S]*?-->/g, '')

describe('§5 · the rail row of a conversation this window is fed says who holds the work', () => {
  const rail = (waiting?: WhatEachConversationIsWaitingOn | null): Promise<string> =>
    markup(SideRail, {
      open: [openRecord()],
      activeId: 'sess_brobot',
      place: null,
      ...(waiting === undefined ? {} : { waiting }),
    })

  /** The words on the row: the small line under the name, which carries the standing it is drawn in. */
  const rowWord = (html: string): string => {
    const found = /<small\b[^>]*\bdata-standing="[a-z]+"[^>]*>([\s\S]*?)<\/small>/.exec(html)?.[1]
    expect(found, 'the row drew its word').not.toBeUndefined()
    return found?.replace(/<[^>]*>/g, '').trim() ?? ''
  }

  it('🔴 names the holder, draws it as another agent’s wait, and says idle when the verdict names nobody', async () => {
    const told = visible(await rail(aReading(hostRow([ADA]))))
    const word = rowWord(told)
    expect(word).toContain(WAITING_ON_ADA)
    expect(told).toContain('data-standing="elsewhere"')
    // The family's own word, which names nobody, is not what the row said. ⚠️ The row's word only:
    // the plate beside it keeps the family's phrase in its accessible name, by design.
    expect(word).not.toContain('waiting on a worker')

    // ⛔ THE PAIR — the same record and the same component, the host naming nobody: a row that
    // really is drawn, saying idle, with none of the words above.
    const nobody = visible(await rail(aReading(hostRow([]))))
    expect(rowWord(nobody)).toContain('claude · idle')
    expect(nobody).toContain('data-standing="idle"')
    expect(nobody).not.toContain('waiting on')

    // …and with no reading at all, which is what the first frame draws.
    const unread = visible(await rail())
    expect(rowWord(unread)).toContain('claude · idle')
    expect(unread).not.toContain('waiting on')
  })
})

describe('§6 · the pane’s header and plate say who holds the work, and the card draws no schedule bar under that word', () => {
  const pane = (over: Record<string, unknown> = {}): Promise<string> =>
    markup(ConversationPane, {
      record: openRecord(),
      mode: 'chat' as const,
      debug: false,
      drawerOpen: true,
      drawerTab: 'open' as const,
      models: null,
      draft: '',
      waiting: 'waiting-on-a-worker',
      ...over,
    })

  it('🔴 the header and the plate name the holder the screen handed it', async () => {
    const told = visible(await pane({ workWith: [ADA] }))
    expect(told).toContain(WAITING_ON_ADA)
    expect(told).toContain(STANDING_LABEL.elsewhere)
    expect(told).toContain('data-standing="elsewhere"')

    // ⛔ THE PAIR — the same wait with no holder handed in: the pane says the family's word, which
    // names nobody, over the same header.
    const unnamed = visible(await pane())
    expect(unnamed).toContain('waiting on a worker')
    expect(unnamed).toContain('data-standing="elsewhere"')
    expect(unnamed).not.toContain('Ada')
    expect(unnamed).not.toContain(WAITING_ON_ADA)
  })

  describe('the agent card', () => {
    const JOB: TranscriptEvent = {
      type: 'scheduled_work',
      jobs: [{ id: 'j1', schedule: '*/5 * * * *', recurring: true, prompt: 'check the build' }],
      source: 'hook/Stop',
    }
    const cardOf = (facets: AgentFacets, agentState?: AgentState): Promise<string> => {
      const record = createSessionRecord('sess_card')
      applyEvent(record.control, JOB)
      return markup(AgentCard, {
        facets,
        canOpen: false,
        panel: sessionPanel(record.control),
        state: record.control,
        mode: 'normal',
        ...(agentState === undefined ? {} : { agentState }),
      })
    }
    const subtitleOf = (html: string): string | null =>
      /<span [^>]*data-cy="session-bot-word"[^>]*>([\s\S]*?)<\/span>/.exec(html)?.[1]?.trim() ??
      null

    it('🔴 under *waiting on <name>* the card’s plate names the holder and no schedule bar is drawn', async () => {
      const waiting = visible(
        await cardOf(
          { doing: 'idle', waiting: 'waiting-on-a-worker' },
          { is: 'waiting-on-a-worker', on: [ADA] },
        ),
      )
      // The card drew, and said who holds the work, before anything is said about the bar.
      expect(subtitleOf(waiting)).toBe(WAITING_ON_ADA)
      expect(waiting).not.toContain('data-cy="schedule-bar"')

      // ⛔ THE PAIR — the same record, the same job, under the schedule's own word and with no state
      // handed in: the bar and its row are drawn, so the absence above is not an empty registry.
      for (const agentState of [{ is: 'scheduled', dueAt: null } as const, undefined]) {
        const shown = visible(await cardOf({ doing: 'idle', scheduled: true }, agentState))
        expect(shown).toContain('data-cy="schedule-bar"')
        expect(shown).toContain('data-cy="schedule-row-j1"')
      }
    })
  })
})

// ─── §7 · the screen's wiring ────────────────────────────────────────────────────────────────────

/**
 * Every comment blanked, newlines kept, so a docblock quoting the code cannot stand in for it.
 * ⚠️ Blanked line by line, where each span says it starts: a run of `//` lines is one span joined
 * WITHOUT the indentation between them.
 */
function code(file: string, source: string): string {
  const lines = source.split('\n')
  for (const span of proseSpans(file, source)) {
    span.text.split('\n').forEach((said, offset) => {
      const at = span.line - 1 + offset
      const line = lines[at] ?? ''
      const from = line.indexOf(said)
      if (from < 0) throw new Error(`${file}:${String(at + 1)} does not hold the comment ${said}`)
      lines[at] = line.slice(0, from) + ' '.repeat(said.length) + line.slice(from + said.length)
    })
  }
  return lines.join('\n')
}

/** How many times a pattern matches, so a census can say it found exactly the call it reads. */
const countOf = (pattern: RegExp, source: string): number =>
  [...source.matchAll(new RegExp(pattern.source, 'g'))].length

describe('§7 · the screen hands the names to the pane and to the palette’s word', () => {
  const FILE = join(SRC, 'renderer/src/components/RuntimeScreen.vue')
  const source = code(FILE, readFileSync(FILE, 'utf8'))

  /** The pane's own tag, from its opening to the first `/>`. */
  const paneTag = (text: string): string => {
    expect(countOf(/<ConversationPane\b/, text), 'one pane is mounted').toBe(1)
    const at = text.indexOf('<ConversationPane')
    const end = text.indexOf('/>', at)
    expect(end).toBeGreaterThan(at)
    return text.slice(at, end)
  }
  /** The palette's call, as four arguments: the record, its facets, the answerer and the holders. */
  const PALETTE_CALL =
    /stateHere\(\s*record,\s*facets,\s*whoseAnswerIn\(conversationWaits\.value, record\.sessionId\),\s*whoseWorkIn\(conversationWaits\.value, record\.sessionId\),\s*\{\},\s*stoppedWorkIn\(conversationWaits\.value, record\.sessionId\),?\s*\)/
  const THE_PANE_GETS_THE_HOLDERS = ':work-with="whoseWorkIn(conversationWaits, active.sessionId)"'
  const THE_PANE_GETS_THE_ANSWERER =
    ':answer-from="whoseAnswerIn(conversationWaits, active.sessionId)"'

  it('🔴 the pane is handed the holders and the palette’s stateHere gets them as its fourth argument', () => {
    // ⚑ The pairs first: the same slices carry the answerer, the third argument of the same call,
    // so each slice is known to find real text before the holders are asked of it.
    expect(paneTag(source)).toContain(THE_PANE_GETS_THE_ANSWERER)
    expect(countOf(/stateHere\(/, source), 'one palette call').toBe(1)
    expect(countOf(/whoseAnswerIn\(conversationWaits\.value, record\.sessionId\)/, source)).toBe(1)

    expect(paneTag(source)).toContain(THE_PANE_GETS_THE_HOLDERS)
    expect(source).toMatch(PALETTE_CALL)
  })

  it('⚑ the predicates can fail: a copy without the holders, in either place, is not accepted', () => {
    const withoutThePaneProp = source.replace(THE_PANE_GETS_THE_HOLDERS, '')
    expect(withoutThePaneProp).not.toBe(source)
    expect(paneTag(withoutThePaneProp)).not.toContain(THE_PANE_GETS_THE_HOLDERS)
    expect(paneTag(withoutThePaneProp)).toContain(THE_PANE_GETS_THE_ANSWERER)

    const withoutTheFourthArgument = source.replace(
      /,\s*whoseWorkIn\(conversationWaits\.value, record\.sessionId\)/,
      '',
    )
    expect(withoutTheFourthArgument).not.toBe(source)
    expect(withoutTheFourthArgument).not.toMatch(PALETTE_CALL)
  })
})

// ─── §8 to §14 · the host ────────────────────────────────────────────────────────────────────────

/**
 * A start the test can hold at the provider: `hold` is awaited by every `start`, and `release`
 * lets the held ones go — which the teardown calls too, so a case that failed with a start still
 * held cannot leave the host waiting for it.
 */
interface StartGate {
  hold: Promise<void> | null
  release: () => void
  entered: number
}

class ProviderDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
    private readonly startGate: StartGate,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    this.startGate.entered += 1
    if (this.startGate.hold !== null) await this.startGate.hold
    const handle = await super.start(options)
    this.handles.push(handle)
    return handle
  }
  override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
    const handle = await super.resume(ref, options)
    this.handles.push(handle)
    return handle
  }
}

/** The conversation a person is behind: the sink a window hands the host. */
class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

/** What a tool answered: the payload a model parses and the sentence it reads. */
interface Answer {
  readonly structured: Record<string, unknown>
  readonly text: string
}

describe('D-036 · the host says who holds the work a conversation gave out', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let startGate: StartGate
  let counter: number
  let clock: number
  let window: RecordingSink
  /** Every message the host pushed on `runtime:states`, in order. */
  let pushed: RuntimeStatesMessage[]
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) =>
        new ProviderDouble(provider, handles, issued, startGate),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      interruptWaitMs: 40,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
      // ⚑ **The dep that makes the host derive and push at all** — what main hands every window.
      statesMoved: (message) => {
        pushed.push(message)
      },
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-holders-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-holders-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
    pushed = []
    startGate = { hold: null, release: () => undefined, entered: 0 }
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    startGate.release()
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (
    profileId: string,
    approvalMode: ApprovalMode = 'auto',
  ): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode, cwd: root },
      window,
    )
    return sessionId
  }

  const fullCall = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Answer> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    const answer = await tool.call(args)
    return { structured: answer.structured as Record<string, unknown>, text: answer.text }
  }
  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => (await fullCall(toolset, name, args)).structured

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)
  const turnsIn = (sessionId: string): number =>
    ledger(sessionId).filter((event) => event.type === 'turn').length

  /** Every entry pushed for one conversation, in order. */
  const saidOf = (id: string): { conversation: string; state: AgentState }[] =>
    pushed.flatMap((message) => message.moved).filter((one) => one.conversation === id)
  const lastSaid = (id: string): AgentState | undefined => saidOf(id).at(-1)?.state

  /** The card the app itself reads, through the clause no grant narrows. */
  const cardOf = (id: string) => host.agentCard(id, THE_APP_ITSELF, id)
  const stateOf = (id: string): AgentState | undefined => cardOf(id)?.state

  /** A list read, as the window makes it — it resets what was last said of every row it names. */
  const listed = (id: string): ResumableSessionInfo | UnresumableSessionInfo | undefined =>
    [...host.resumableSessions(), ...host.unresumableSessions()].find((row) => row.sessionId === id)

  /** The holder of the one piece a conversation was given, named by the app. */
  const givenW11 = (title = 'Build the pages'): Record<string, unknown> => ({
    definition_of_done: 'The requested result and its checks are recorded.',
    profile: 'worker',
    new: true,
    title,
    brief: title.toLowerCase(),
  })

  /**
   * ⚑ **One family, nothing parked**: BroBot (a person's, the root `W1`) gives `W1.1` to Ada, and
   * Ada gives `W1.1.1` to Ali. Both children run in `auto` mode, so each brief is a turn that ends,
   * and each giver is then handed a stall notice for the piece that ended its turn with work open.
   * The reading waits for that to settle, so nothing is mid-turn when a case asks.
   */
  const aFamily = async (): Promise<{
    brobot: string
    brobotTools: AgentToolset
    ada: string
    adaTools: AgentToolset
    ali: string
  }> => {
    const brobot = await personOpens(DEFAULT_PROFILE_ID)
    const brobotTools = agentToolsFor(host, brobot)
    const givenAda = await callOn(brobotTools, 'give_work', givenW11())
    expect(givenAda, JSON.stringify(givenAda)).toMatchObject({ outcome: 'ok', label: 'W1.1' })
    const ada = givenAda.agent as string
    await waitFor(() => turnsIn(ada) >= 1, 'Ada’s first turn')
    const adaTools = agentToolsFor(host, ada)
    const givenAli = await callOn(adaTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'tester',
      new: true,
      title: 'Wire the routes',
      brief: 'wire the routes',
    })
    expect(givenAli, JSON.stringify(givenAli)).toMatchObject({ outcome: 'ok', label: 'W1.1.1' })
    const ali = givenAli.agent as string
    await waitFor(() => turnsIn(ali) >= 1, 'Ali’s first turn')
    // ⚠️ The premises, read off the store and not off the subject.
    expect(store.parentOf(ada)).toBe(brobot)
    expect(store.parentOf(ali)).toBe(ada)
    return { brobot, brobotTools, ada, adaTools, ali }
  }

  /** Ali holds the one piece he was given and gave nobody any: the control for every door below. */
  const aliHoldsOneAndGaveNothing = (ali: string): void => {
    expect(store.piecesOwnedBy(ali).map((one) => one.label)).toEqual(['W1.1.1'])
    expect(store.piecesGivenBy(ali)).toEqual([])
  }

  it('🔴 §8 · every door says who holds the work, at any depth: card, get_agent_status, list_agents, list_tasks, interrupt_agent and the window’s reading', async () => {
    const { brobot, brobotTools, ada, adaTools, ali } = await aFamily()
    // ⚑ The stall notices give each giver a turn: wait until all three have said their last word.
    await waitFor(
      () =>
        stateOf(brobot)?.is === 'waiting-on-a-worker' &&
        stateOf(ada)?.is === 'waiting-on-a-worker' &&
        stateOf(ali)?.is === 'idle',
      'the three conversations to settle',
    )
    await settle()

    // The card, a giver at the root and a giver at depth two.
    expect(stateOf(brobot)).toEqual({
      is: 'waiting-on-a-worker',
      on: [ADA],
      since: expect.any(Number),
    })
    expect(stateOf(ada)).toEqual({
      is: 'waiting-on-a-worker',
      on: [ALI],
      since: expect.any(Number),
    })
    // ⛔ THE PAIR — Ali holds a piece and gave nothing: idle, so the doors above are not saying
    // *waiting* of everyone.
    aliHoldsOneAndGaveNothing(ali)
    expect(stateOf(ali)).toEqual({ is: 'idle' })

    // A caller that is neither giver nor holder, for the doors that name another conversation.
    const observer = await personOpens('reviewer')
    const observerTools = agentToolsFor(host, observer)

    const status = await fullCall(observerTools, 'get_agent_status', { agent: brobot })
    expect(status.structured, status.text).toMatchObject({ outcome: 'ok' })
    expect((status.structured.agent as { state: string }).state).toBe(WAITING_ON_ADA)
    expect(status.text).toContain(WAITING_ON_ADA)

    const agents = await callOn(observerTools, 'list_agents', {})
    const rows = agents.agents as { agent: string; state: string }[]
    expect(rows.find((one) => one.agent === ada)?.state).toBe(WAITING_ON_ALI)
    expect(rows.find((one) => one.agent === ali)?.state).toBe('idle')

    // list_tasks says what each piece's holder is doing, in the same words.
    const brobotsTasks = await callOn(brobotTools, 'list_tasks', {})
    const brobotGave = brobotsTasks.you_gave as { label: string; given_to_is: string }[]
    expect(brobotGave.find((one) => one.label === 'W1.1')?.given_to_is).toBe(WAITING_ON_ALI)
    const adasTasks = await callOn(adaTools, 'list_tasks', {})
    const adaGave = adasTasks.you_gave as { label: string; given_to_is: string }[]
    expect(adaGave.find((one) => one.label === 'W1.1.1')?.given_to_is).toBe('idle')

    // interrupt_agent, with no turn running in Ada, answers the state it is in.
    const interrupted = await callOn(brobotTools, 'interrupt_agent', {
      agent: 'W1.1',
      reason: 'nothing to stop',
    })
    expect(interrupted, JSON.stringify(interrupted)).toMatchObject({
      outcome: 'ok',
      agent: ada,
      asked: false,
      state: WAITING_ON_ALI,
    })

    // The reading the window draws its plates from carries the names, and the verdict.
    const reading = host.whatEachConversationIsWaitingOn()
    const brobotsRow = reading.conversations.find((one) => one.conversation === brobot)
    const adasRow = reading.conversations.find((one) => one.conversation === ada)
    const alisRow = reading.conversations.find((one) => one.conversation === ali)
    expect(brobotsRow).toMatchObject({
      waiting: 'waiting-on-a-worker',
      needsYou: false,
      waitingOnTheWorkOf: [ADA],
    })
    // ⚑ F131 · Ali's turn ended with W1.1.1 open and nothing is on its way to it, so the window's
    // reading says that piece stopped, and Ada waits on nobody for it; the agents' doors above
    // still name Ali.
    expect(adasRow).toMatchObject({
      waitingOnTheWorkOf: [],
      stoppedWork: [{ label: 'W1.1.1', holderConversation: ali }],
    })
    expect(alisRow?.waitingOnTheWorkOf).toEqual([])
  })

  it('🔴 §9 · each holder is named once, the oldest give first, and " +N" counts the other agents', async () => {
    // ⚑ A parent in `ask` mode, so the first helper stays parked on its card and a second give to
    // it is admitted held, as `a-label-names-the-conversation-that-owns-the-piece-and-no-more` does.
    const parent = await personOpens(DEFAULT_PROFILE_ID, 'ask')
    const parentTools = agentToolsFor(host, parent)
    const first = await callOn(parentTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      new: true,
      title: 'Build the world clock page',
      brief: 'build the world clock page',
    })
    expect(first, JSON.stringify(first)).toMatchObject({ outcome: 'ok', label: 'W1.1' })
    const ada = first.agent as string
    await waitFor(
      () => ledger(ada).some((event) => event.type === 'permission_request'),
      'the card Ada’s brief raised',
    )
    const second = await callOn(parentTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'Test the clock page',
      brief: 'test the clock page',
    })
    expect(second, JSON.stringify(second)).toMatchObject({
      outcome: 'ok',
      agent: ada,
      label: 'W1.2',
    })
    const wordsOfParent = async (): Promise<string> => {
      const said = await fullCall(parentTools, 'get_agent_status', { agent: parent })
      expect(said.structured, said.text).toMatchObject({ outcome: 'ok' })
      return (said.structured.agent as { state: string }).state
    }

    // Ada alone, holding two open pieces: one name, no suffix — ⚑ F033 · named by the oldest open
    // piece she holds from this parent, the work it waits on, and with no count of the other.
    expect(store.openPiecesOf(ada).map((one) => one.label)).toEqual(['W1.1', 'W1.2'])
    const ADA_BY_HER_OLDEST = 'Ada (the owner of W1.1 · Build the world clock page)'
    expect(stateOf(parent)).toEqual({
      is: 'waiting-on-a-worker',
      on: [ADA_BY_HER_OLDEST],
      since: expect.any(Number),
    })
    expect(await wordsOfParent()).toBe(`waiting on ${ADA_BY_HER_OLDEST}`)

    // A third give, to a second agent: now two holders, Ada first (the oldest give), once.
    const third = await callOn(parentTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'tester',
      new: true,
      title: 'Review the clock page',
      brief: 'review the clock page',
    })
    expect(third, JSON.stringify(third)).toMatchObject({ outcome: 'ok', label: 'W1.3' })
    const ALI_BY_HIS_PIECE = 'Ali (the owner of W1.3 · Review the clock page)'
    expect(stateOf(parent)).toEqual({
      is: 'waiting-on-a-worker',
      on: [ADA_BY_HER_OLDEST, ALI_BY_HIS_PIECE],
      since: expect.any(Number),
    })
    expect(await wordsOfParent()).toBe(`waiting on ${ADA_BY_HER_OLDEST} +1`)
    const row = host
      .whatEachConversationIsWaitingOn()
      .conversations.find((one) => one.conversation === parent)
    expect(row?.waitingOnTheWorkOf).toEqual([ADA_BY_HER_OLDEST, ALI_BY_HIS_PIECE])
  })

  /** BroBot gives `W1.1` to Ada; the stall notice is handed back and BroBot's word has settled. */
  const aGiverWaitingOnAHelper = async (): Promise<{
    brobot: string
    brobotTools: AgentToolset
    ada: string
    adaTools: AgentToolset
  }> => {
    const brobot = await personOpens(DEFAULT_PROFILE_ID)
    await settle()
    const brobotTools = agentToolsFor(host, brobot)
    const given = await callOn(brobotTools, 'give_work', givenW11())
    expect(given, JSON.stringify(given)).toMatchObject({ outcome: 'ok', label: 'W1.1' })
    const ada = given.agent as string
    // Ada's turn ends with her piece open, which hands BroBot a stall notice: one turn of its own.
    await waitFor(() => turnsIn(ada) >= 1 && turnsIn(brobot) >= 1, 'the stall notice’s turn')
    await waitFor(
      () => lastSaid(brobot)?.is === 'waiting-on-a-worker',
      'the giver to be pushed as waiting on its helper',
    )
    await settle()
    expect(lastSaid(brobot)).toEqual({
      is: 'waiting-on-a-worker',
      on: [ADA],
      since: expect.any(Number),
    })
    return { brobot, brobotTools, ada, adaTools: agentToolsFor(host, ada) }
  }

  it('🔴 §10 · a give moves the giver’s pushed word to waiting on its helper, and the helper’s reply moves it back', async () => {
    const brobot = await personOpens(DEFAULT_PROFILE_ID)
    await settle()
    // ⛔ THE FIRST PUSH — before the give, the same conversation was said idle: the word moves both
    // ways, so a flush that never ran is not what passed below.
    expect(lastSaid(brobot)).toEqual({ is: 'idle' })

    const brobotTools = agentToolsFor(host, brobot)
    const given = await callOn(brobotTools, 'give_work', givenW11())
    expect(given, JSON.stringify(given)).toMatchObject({ outcome: 'ok', label: 'W1.1' })
    const ada = given.agent as string
    await waitFor(
      () => lastSaid(brobot)?.is === 'waiting-on-a-worker' && turnsIn(brobot) >= 1,
      'the give to be pushed as waiting on the helper',
    )
    await settle()
    expect(lastSaid(brobot)).toEqual({
      is: 'waiting-on-a-worker',
      on: [ADA],
      since: expect.any(Number),
    })
    // One derivation: the card, read only now that the pushed word is collected, says the same.
    expect(stateOf(brobot)).toEqual(lastSaid(brobot))

    // The reply: the helper's own tool, and the word goes back.
    const before = saidOf(brobot).length
    const replied = await callOn(agentToolsFor(host, ada), 'reply_to_parent', {
      piece: 'W1.1',
      outcome: 'done',
      summary: 'the pages are built',
    })
    expect(replied, JSON.stringify(replied)).toMatchObject({ outcome: 'ok' })
    await waitFor(
      () =>
        saidOf(brobot)
          .slice(before)
          .some((one) => one.state.is === 'idle'),
      'the reply to be pushed as idle',
    )
    await settle()
    expect(lastSaid(brobot)).toEqual({ is: 'idle' })
  })

  it.each([
    ['a take-back', 'withdraw_task', { piece: 'W1.1' }],
    ['a close', 'update_work', { piece: 'W1.1', close: true }],
  ] as const)(
    '🔴 §11 · the wait ends when the work does, however it ends: %s pushes the giver back to idle',
    async (_how, tool, args) => {
      const { brobot, brobotTools } = await aGiverWaitingOnAHelper()
      // The premise, read before the call: the same conversation, one fact over.
      expect(lastSaid(brobot)?.is).toBe('waiting-on-a-worker')
      const before = saidOf(brobot).length

      const ended = await callOn(brobotTools, tool, args)
      expect(ended, JSON.stringify(ended)).toMatchObject({ outcome: 'ok' })
      await waitFor(
        () =>
          saidOf(brobot)
            .slice(before)
            .some((one) => one.state.is === 'idle'),
        'the end of the work to be pushed as idle',
      )
      await settle()
      expect(lastSaid(brobot)).toEqual({ is: 'idle' })
    },
  )

  it('🔴 §12 · a helper’s new title, and a rename of its agent, push the giver’s word with the new name', async () => {
    const { brobot, brobotTools } = await aGiverWaitingOnAHelper()
    // ⚑ The old name was said, so the change below is a change.
    expect(lastSaid(brobot)).toEqual({
      is: 'waiting-on-a-worker',
      on: [ADA],
      since: expect.any(Number),
    })

    // (a) The giver's own title for the piece.
    const retitled = await callOn(brobotTools, 'update_work', {
      piece: 'W1.1',
      title: 'Build the whole site',
    })
    expect(retitled, JSON.stringify(retitled)).toMatchObject({ outcome: 'ok' })
    await waitFor(
      () =>
        JSON.stringify({ ...lastSaid(brobot), since: undefined }) ===
        JSON.stringify({
          is: 'waiting-on-a-worker',
          on: ['Ada (the owner of W1.1 · Build the whole site)'],
        }),
      'the new title to be pushed',
    )

    // (b) A person renames the agent.
    expect(host.setAgentDisplayName('worker', 'Hedda')).not.toBeNull()
    await waitFor(
      () =>
        JSON.stringify({ ...lastSaid(brobot), since: undefined }) ===
        JSON.stringify({
          is: 'waiting-on-a-worker',
          on: ['Hedda (the owner of W1.1 · Build the whole site)'],
        }),
      'the new name to be pushed',
    )
  })

  it('🔴 §13 · a stand-in counts what the conversation it replaced gave, and the replaced one counts nothing', async () => {
    // ⚑ A parent in `ask` mode, its helper parked on a card, so the piece stays open throughout.
    const parent = await personOpens(DEFAULT_PROFILE_ID, 'ask')
    const given = await callOn(agentToolsFor(host, parent), 'give_work', givenW11())
    expect(given, JSON.stringify(given)).toMatchObject({ outcome: 'ok', label: 'W1.1' })
    const ada = given.agent as string
    await waitFor(
      () => ledger(ada).some((event) => event.type === 'permission_request'),
      'the card Ada’s brief raised',
    )
    // The premises: before the replacement the parent said it waited on Ada, and her piece is open,
    // so neither word below is idle for want of work.
    expect(stateOf(parent)).toEqual({
      is: 'waiting-on-a-worker',
      on: [ADA],
      since: expect.any(Number),
    })
    expect(store.piecesGivenBy(parent).map((one) => one.label)).toEqual(['W1.1'])
    // ⚑ …since the give itself.
    expect(stateOf(parent)).toMatchObject({ since: store.piecesGivenBy(parent)[0]?.givenAt })
    expect(store.piecesGivenBy(parent)[0]?.state).not.toBe('answered')

    // The parent is stopped and its provider forgets it, so a message to it is a replacement. The
    // start is held at the provider while the stand-in is derived for the first time.
    await host.close(parent, window)
    issued.forgetAll()
    startGate.hold = new Promise<void>((resolve) => {
      startGate.release = resolve
    })
    const entered = startGate.entered
    // The next id this host hands out is the stand-in's: read it before the act that mints it.
    const standIn = `sess_${String(counter + 1)}`
    const sending = host.startAndSend(parent, 'are you there', window)
    await waitFor(() => startGate.entered === entered + 1, 'the replacement to reach the provider')
    // ⚑ The flush runs while the stand-in is still starting: it derives its first word now, from
    // the work it has not yet been given to count, and keeps what it read.
    await settle()
    expect(saidOf(standIn).map((one) => one.state.is)).toEqual(['active'])
    startGate.release()
    const answer = await sending
    if (!('sent' in answer)) throw new Error(`nothing was sent: ${JSON.stringify(answer)}`)
    const next = answer.sent.sessionId
    startGate.hold = null
    // The premise: a new conversation stands in the parent's place.
    expect(next).toBe(standIn)
    expect(next).not.toBe(parent)
    expect(ledger(parent).some((event) => event.type === 'replaced_by')).toBe(true)

    // Its own turn parks on a card in `ask` mode; the card is cleared so the turn ends.
    await waitFor(
      () => ledger(next).some((event) => event.type === 'permission_request'),
      'the stand-in’s card',
    )
    const card = ledger(next).find((event) => event.type === 'permission_request')
    if (card?.type !== 'permission_request') throw new Error('the stand-in raised no card')
    await host.respondPermission(next, card.id, { outcome: 'allow' }, window)
    await waitFor(() => turnsIn(next) >= 1, 'the stand-in’s turn to end')

    // The stand-in counts what the conversation it replaced gave.
    await waitFor(
      () => lastSaid(next)?.is === 'waiting-on-a-worker',
      'the stand-in to be pushed as waiting on the helper',
    )
    await settle()
    expect(lastSaid(next)).toEqual({
      is: 'waiting-on-a-worker',
      on: [ADA],
      since: expect.any(Number),
    })

    // The replaced one counts nothing: it is listed, and it is idle.
    const old = listed(parent)
    expect(old, 'the replaced conversation is listed').not.toBeUndefined()
    expect(old?.state).toEqual({ is: 'idle' })
  })

  it('🔴 §14 · a torn row in a helper’s ledger is the helper’s own record’s: the giver’s card says the work and counts nothing', async () => {
    const parent = await personOpens(DEFAULT_PROFILE_ID, 'ask')
    const given = await callOn(agentToolsFor(host, parent), 'give_work', givenW11())
    expect(given, JSON.stringify(given)).toMatchObject({ outcome: 'ok', label: 'W1.1' })
    const ada = given.agent as string
    await waitFor(
      () => ledger(ada).some((event) => event.type === 'permission_request'),
      'the card Ada’s brief raised',
    )

    // ⛔ The hazard is put where the fold walks: a row of a type the piece reads, whose payload is
    // not the shape it says it is. Its ordinal is far above Ada's own, so her next rows do not meet it.
    const top = (
      db.prepare('SELECT max(ordinal) AS top FROM events WHERE session_id = ?').get(ada) as {
        top: number
      }
    ).top
    db.prepare(
      `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
       VALUES (?, ?, (SELECT coalesce(max(generation), 0) FROM events WHERE session_id = ?), ?, 'user_turn', ?, ?)`,
    ).run('evt_unreadable', ada, ada, top + 1000, '{not json at all', clock)

    // The store warns of every torn row it skips; the warnings are read, not printed.
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      // ⚑ THE PAIR — the torn row is counted where it lives, on the helper's own record.
      expect(cardOf(ada)?.rowsUnread).toBeGreaterThan(0)
      expect(warned.mock.calls.some(([said]) => String(said).includes('could not be read'))).toBe(
        true,
      )

      // The giver's card still says who holds the work, and counts nothing against its own record.
      const card = cardOf(parent)
      expect(card?.state).toEqual({
        is: 'waiting-on-a-worker',
        on: [ADA],
        since: expect.any(Number),
      })
      expect(card?.rowsUnread).toBe(0)
      expect(card?.ledgersSkipped ?? 0).toBe(0)
    } finally {
      warned.mockRestore()
    }
  })
})

// ─── §15 · a giver that only waits is counted and stopped like an idle one ───────────────────────

/** A delay no other timer in the host uses, and no test waits out. */
const IDLE = 7_654_321

/** One countdown the host armed: the timer it got back and the callback it armed it with. */
interface Countdown {
  readonly timer: ReturnType<typeof setTimeout>
  readonly fn: () => void
}

describe('D-018 · D-036 · a giver waiting on its helpers is counted and stopped like an idle one, and still says so', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handles: FakeSessionHandle[]
  let handed: AgentToolset[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  let pushed: RuntimeStatesMessage[]
  let fired: Set<ReturnType<typeof setTimeout>>
  let setTimeoutSpy: MockInstance<typeof setTimeout>
  let clearTimeoutSpy: MockInstance<typeof clearTimeout>
  const tick = (): number => clock++

  /** The provider double: collects every handle it issues and the toolset each launch was handed. */
  class HandingDouble extends FakeRuntime {
    constructor(provider: Provider, sessions: FakeProviderSessions) {
      super(provider, { sessions })
    }
    override async start(options: StartOptions): Promise<FakeSessionHandle> {
      const handle = await super.start(options)
      handles.push(handle)
      if (options.agentTools) handed.push(options.agentTools)
      return handle
    }
    override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
      const handle = await super.resume(ref, options)
      handles.push(handle)
      if (options.agentTools) handed.push(options.agentTools)
      return handle
    }
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-holders-stop-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-holders-stop-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
    handed = []
    pushed = []
    fired = new Set()
    issued = new FakeProviderSessions()
    // Call-through: the host still gets real timers, the test gets to read what it armed.
    setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new HandingDouble(provider, issued),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      interruptWaitMs: 40,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
      statesMoved: (message) => {
        pushed.push(message)
      },
      idleStopAfterMs: IDLE,
    })
    hosts.push(host)
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    for (const { timer } of armedAt(IDLE)) clearTimeout(timer)
    vi.restoreAllMocks()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  /** Every `setTimeout` the host (or anything else) armed with exactly this delay, in order. */
  const armedAt = (ms: number): Countdown[] =>
    setTimeoutSpy.mock.calls.flatMap((call, index) =>
      call[1] === ms
        ? [
            {
              timer: setTimeoutSpy.mock.results[index]?.value as ReturnType<typeof setTimeout>,
              fn: call[0] as () => void,
            },
          ]
        : [],
    )
  const cleared = (): Set<unknown> => new Set(clearTimeoutSpy.mock.calls.map(([timer]) => timer))
  /** The countdowns the host really holds: neither cleared by a mark nor run out. */
  const live = (): Countdown[] =>
    armedAt(IDLE).filter(({ timer }) => !cleared().has(timer) && !fired.has(timer))
  const theOneLive = (): Countdown => {
    const now = live()
    expect(now, 'exactly one countdown is live').toHaveLength(1)
    const [only] = now
    if (only === undefined) throw new Error('unreachable')
    return only
  }
  /** Run a countdown out by hand, as the timer would after its delay. */
  const fire = async (countdown: Countdown): Promise<void> => {
    fired.add(countdown.timer)
    countdown.fn()
    await settle()
  }

  const saidOf = (id: string): AgentState[] =>
    pushed
      .flatMap((message) => message.moved)
      .filter((one) => one.conversation === id)
      .map((one) => one.state)
  const lastSaid = (id: string): AgentState | undefined => saidOf(id).at(-1)

  const listed = (id: string): ResumableSessionInfo | UnresumableSessionInfo | undefined =>
    [...host.resumableSessions(), ...host.unresumableSessions()].find((row) => row.sessionId === id)
  const runningOf = (id: string): string | undefined => listed(id)?.running

  /** The provider double of a conversation, found by the ref its row carries. */
  const doubleOf = (id: string): FakeSessionHandle => {
    const row = listed(id)
    if (row === undefined || !('ref' in row)) throw new Error(`${id} is not a listed resumable row`)
    const found = handles.find((handle) => handle.ref.sessionId === row.ref.sessionId)
    if (found === undefined) throw new Error(`no provider double carries ${id}'s ref`)
    return found
  }

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const opens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    return sessionId
  }

  it('🔴 §15 · the pm that gave its work to two parked workers holds the one countdown, is stopped by it, and still says it waits', async () => {
    for (const slug of ['worker-a', 'worker-b']) {
      const id = await opens(slug)
      await host.close(id, window)
    }
    const pm = await opens('pm')
    const pmTools = handed.at(-1)
    if (pmTools === undefined) throw new Error('no toolset was handed to the pm')
    const give = async (slug: string, brief: string): Promise<string> => {
      const made = await callOn(pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: slug,
        title: brief,
        brief,
      })
      expect(made.outcome, JSON.stringify(made)).toBe('ok')
      return made.agent as string
    }
    const workerA = await give('worker-a', 'the first piece')
    const workerB = await give('worker-b', 'the second piece')

    // Each worker's brief parks on its card in `ask` mode: a person owes a decision, so the worker
    // is *needs you*, and parked on its card it is not counted. The pm only waits on them.
    for (const worker of [workerA, workerB]) {
      await waitFor(
        () => lastSaid(worker)?.is === 'needs-you',
        `${worker} to be pushed as needs-you`,
      )
    }
    await waitFor(() => lastSaid(pm)?.is === 'waiting-on-a-worker', 'the pm to say it waits')
    await settle()
    expect(lastSaid(pm)?.is).toBe('waiting-on-a-worker')

    // ⚑ THE PAIR — exactly one countdown is live and it is the pm's: the workers hold none. Both
    // pieces are open, and the pm and both workers run, so the stop below is a stop of the pm alone.
    const countdown = theOneLive()
    expect(store.piecesGivenBy(pm).filter((one) => one.state === 'working')).toHaveLength(2)
    expect(runningOf(pm)).toBe('in-a-window')
    for (const worker of [workerA, workerB]) expect(runningOf(worker)).toBe('unwatched')

    await fire(countdown)
    await waitFor(() => runningOf(pm) === 'not-running', 'the pm to be stopped')

    // A stop changes nothing about a piece, and the stopped pm still says what it waits on.
    expect(listed(pm)?.state.is).toBe('waiting-on-a-worker')
    const stillOpen = store.piecesGivenBy(pm)
    expect(stillOpen).toHaveLength(2)
    expect(stillOpen.every((one: PieceRow) => one.state !== 'answered')).toBe(true)
    // The workers it waits on were not ended by its stop.
    for (const worker of [workerA, workerB]) {
      expect(runningOf(worker)).toBe('unwatched')
      expect(doubleOf(worker).status()).not.toBe('ended')
    }
  })
})
