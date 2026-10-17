import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { FakeSessionHandle, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, THE_APP_ITSELF } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import {
  IN_THE_BACKGROUND,
  NOTHING_IN_THE_BACKGROUND,
  NOTHING_SCHEDULED,
  SCHEDULED,
  agentStateArm,
  agentStateOf,
  agentStateWords,
  type AgentStateArmFacts,
  type AgentStateFacts,
} from '../src/shared/agent-state'
import { workLeftBehind } from '../src/renderer/src/lib/agent-state'

/**
 * # D-017 · R11 — the one state, and the one order it ranks its facts in
 *
 * ⚑ **What `5206d835` built and nothing pins directly**: `shared/agent-state.ts`'s `agentStateArm`,
 * the ladder needs you > active > waiting on an answer from \<name\> > running in the background >
 * scheduled > idle, is exercised elsewhere only PAIRWISE, through the renderer's `standingOf`
 * (`three-surfaces-read-the-new-field.test.ts` §4) and only for the bottom two rungs
 * (`the-losing-detail-says-nothing.render.test.ts` §3). No test asks the function itself for the
 * WHOLE ladder, top to bottom, in one place — and no test drives a REAL `main`-side session
 * (`RuntimeHost`'s own `HostedSession.background` / `.scheduled`, fed by `takeTheLevels`, new in
 * this commit) through to the word `list_agents` and `get_agent_status` actually answer.
 * `work-in-the-background.test.ts` §4 gets a live worker to run something in the background, but
 * only ever reads `list_tasks`' `in_the_background` (the TASK's own list, from D-013) — never
 * `given_to_is` / `get_agent_status`'s `state` (the AGENT's one word, from this commit).
 *
 * §1 is the ladder, as a pure function. §2 is the same ranking reached from a live host, over the
 * two levels only a running provider can state.
 *
 * ⚑ **D-036 · the ladder has SEVEN rungs now** — *waiting on \<name\>* (`waiting-on-a-worker`: work
 * it gave out is still open) sits between *scheduled* and *idle*, so the facts gained
 * `waitingOnAWorker` (the arm's) and `waitingOnTheWorkOf` (the state's). ⚠️ This file's name still
 * says six: it is table 1017's killer label, so renaming it is the landing's.
 *
 * ⚑ **F036 · and EIGHT** — *owes an answer to \<name\>* (`owes-an-answer`: another conversation
 * waits on an answer from this one) sits right after *waiting on an answer*, so the facts gained
 * `owesAnAnswer` (the arm's) and `owesAnAnswerTo` (the state's).
 */

const running = (id: string, description: string) => ({
  running: [{ id, description }],
  dropped: 0,
})

const NOTHING_LEVELS = { background: NOTHING_IN_THE_BACKGROUND, scheduled: NOTHING_SCHEDULED }

describe('§1 · agentStateArm ranks all eight, and agentStateOf carries each arm’s own detail', () => {
  it('🔴 the whole ladder: each rung wins once everything above it is false, and only then', () => {
    const all: AgentStateArmFacts = {
      needsYou: true,
      active: true,
      waitingOnAnAnswer: true,
      // ⚑ F036 · another conversation waits on an answer from this one — true too.
      owesAnAnswer: true,
      inTheBackground: true,
      scheduled: true,
      // ⚑ D-036 · the sixth question — work it gave out is still open — true too, so every rung
      // above it is asked while it holds.
      waitingOnAWorker: true,
    }
    expect(agentStateArm(all)).toBe('needs-you')
    expect(agentStateArm({ ...all, needsYou: false })).toBe('active')
    expect(agentStateArm({ ...all, needsYou: false, active: false })).toBe('waiting-on-an-answer')
    // ⚑ **F036 · the rung right after its own question** — owing an answer, once nothing above it
    // holds, and ahead of the background, the schedule and work out.
    expect(
      agentStateArm({ ...all, needsYou: false, active: false, waitingOnAnAnswer: false }),
    ).toBe('owes-an-answer')
    expect(
      agentStateArm({
        ...all,
        needsYou: false,
        active: false,
        waitingOnAnAnswer: false,
        owesAnAnswer: false,
      }),
    ).toBe('in-the-background')
    expect(
      agentStateArm({
        ...all,
        needsYou: false,
        active: false,
        waitingOnAnAnswer: false,
        owesAnAnswer: false,
        inTheBackground: false,
      }),
    ).toBe('scheduled')
    // ⚑ **D-036 · the rung below the schedule** — work it gave out, still open, is *waiting on
    // <name>*, and only once the schedule is false too.
    expect(
      agentStateArm({
        ...all,
        needsYou: false,
        active: false,
        waitingOnAnAnswer: false,
        owesAnAnswer: false,
        inTheBackground: false,
        scheduled: false,
      }),
    ).toBe('waiting-on-a-worker')
    // ⛔ THE CONTROL — nothing true at all is idle, not a fifth rung reached by elimination alone.
    expect(
      agentStateArm({
        needsYou: false,
        active: false,
        waitingOnAnAnswer: false,
        inTheBackground: false,
        scheduled: false,
        waitingOnAWorker: false,
      }),
    ).toBe('idle')
  })

  it('🔴 needs-you and active carry no detail; waiting-on-an-answer carries the name it was given', () => {
    const base: AgentStateFacts = {
      needsYou: false,
      active: false,
      waitingOnTheAnswerOf: 'BroBot',
      owesAnAnswerTo: [],
      background: NOTHING_IN_THE_BACKGROUND,
      scheduled: NOTHING_SCHEDULED,
      // ⚑ D-036 · no work out, so this case stays about the answer.
      waitingOnTheWorkOf: [],
    }
    expect(agentStateOf(base, 0)).toEqual({ is: 'waiting-on-an-answer', from: 'BroBot' })
    // ⚑ **D-016 · commit 7 · R3 — *from <name>*, not *<name>'s answer***: the name a host gives can
    // end in the bracket of the piece it owns (`theConversationCalled`), and no possessive can
    // follow a bracket.
    expect(agentStateWords(agentStateOf(base, 0))).toBe('waiting on an answer from BroBot')

    const activeToo = { ...base, active: true }
    expect(agentStateOf(activeToo, 0)).toEqual({ is: 'active' })
    expect(agentStateWords(agentStateOf(activeToo, 0))).toBe('active')

    const needsYouToo = { ...base, needsYou: true }
    expect(agentStateOf(needsYouToo, 0)).toEqual({ is: 'needs-you' })
    expect(agentStateWords(agentStateOf(needsYouToo, 0))).toBe('needs you')

    // ⚑ **F036 · owes-an-answer carries who waits on it** — the first, and how many more — and its
    // own question still outranks it.
    const owes = { ...base, waitingOnTheAnswerOf: null, owesAnAnswerTo: ['Ada', 'Ali'] }
    expect(agentStateOf(owes, 0)).toEqual({ is: 'owes-an-answer', to: ['Ada', 'Ali'] })
    expect(agentStateWords(agentStateOf(owes, 0))).toBe('owes an answer to Ada +1')
    expect(agentStateWords(agentStateOf({ ...owes, owesAnAnswerTo: ['Ada'] }, 0))).toBe(
      'owes an answer to Ada',
    )
    expect(agentStateOf({ ...owes, waitingOnTheAnswerOf: 'BroBot' }, 0)).toEqual({
      is: 'waiting-on-an-answer',
      from: 'BroBot',
    })
  })

  it('⚠️ a NULL answerer never reaches the waiting-on-an-answer arm, whatever else is false', () => {
    // ⛔ `agentStateOf` derives the arm from `waitingOnTheAnswerOf !== null` — there is no separate
    // boolean a caller could set true while leaving the name out. With the name absent, background
    // and the schedule are what is left to rank, exactly as if nothing had ever been asked.
    const noName: AgentStateFacts = {
      needsYou: false,
      active: false,
      waitingOnTheAnswerOf: null,
      owesAnAnswerTo: [],
      background: running('b1', 'npm test'),
      scheduled: NOTHING_SCHEDULED,
      waitingOnTheWorkOf: [],
    }
    expect(agentStateOf(noName, 0)).toEqual({ is: 'in-the-background', what: 'npm test' })
  })

  it('⚑ the background and the schedule carry the words those two vocabularies already own', () => {
    const backgroundOnly: AgentStateFacts = {
      needsYou: false,
      active: false,
      waitingOnTheAnswerOf: null,
      owesAnAnswerTo: [],
      background: running('b1', 'npm test'),
      scheduled: NOTHING_SCHEDULED,
      waitingOnTheWorkOf: [],
    }
    expect(agentStateWords(agentStateOf(backgroundOnly, 0))).toBe(`${IN_THE_BACKGROUND} · npm test`)

    // A registry with nothing NAMEABLE (dropped-only) still holds the arm, and `nextWake` over an
    // empty job list promises no time — the bare word, never a guessed one.
    const droppedSchedule: AgentStateFacts = {
      needsYou: false,
      active: false,
      waitingOnTheAnswerOf: null,
      owesAnAnswerTo: [],
      background: NOTHING_IN_THE_BACKGROUND,
      scheduled: { jobs: [], dropped: 1 },
      waitingOnTheWorkOf: [],
    }
    const scheduledState = agentStateOf(droppedSchedule, 0)
    expect(scheduledState).toEqual({ is: 'scheduled', dueAt: null })
    expect(agentStateWords(scheduledState)).toBe(SCHEDULED)

    // ⛔ THE CONTROL — nothing in either registry, no answer owed, and (D-036) no work out: idle,
    // plainly.
    expect(
      agentStateOf(
        {
          needsYou: false,
          active: false,
          waitingOnTheAnswerOf: null,
          owesAnAnswerTo: [],
          ...NOTHING_LEVELS,
          waitingOnTheWorkOf: [],
        },
        0,
      ),
    ).toEqual({ is: 'idle' })
  })
})

describe('§1b · workLeftBehind — the plate’s own mark, ranked the same way as the one state', () => {
  it('🔴 the background wins when both are true, each alone gives its own word, and neither gives none', () => {
    // ⚑ `workLeftBehind` (`agent-state.ts`, replacing the old `theDetails`/`StandingDetails`) has no
    // test of its own anywhere in the suite; `AgentState.vue` is its only caller. It asks
    // `agentStateArm` the same question `stateHere` does, over the two facets alone.
    expect(workLeftBehind({ detached: true, scheduled: true })).toBe('background')
    expect(workLeftBehind({ detached: true, scheduled: false })).toBe('background')
    expect(workLeftBehind({ detached: false, scheduled: true })).toBe('scheduled')
    expect(workLeftBehind({ detached: false, scheduled: false })).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · the same ranking, reached from a live host — `HostedSession.background` / `.scheduled`
// ─────────────────────────────────────────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

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

/** ⚑ Captures the real `FakeSessionHandle` behind every session this host starts, so a test can
 *  push a `background_work` / `scheduled_work` frame at it — the only way either level is stated. */
class Watching extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
    const handle = await super.start(options)
    this.handles.push(handle as FakeSessionHandle)
    return handle
  }
}

describe('§2 · a live session’s levels reach the wire as the ONE state', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handles: FakeSessionHandle[]
  let window: RecordingSink

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-1017-state-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-1017-state-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    handles = []
    let counter = 0
    const issued = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new Watching(provider, handles, issued),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error(`timed out waiting for ${what}`)
  }
  /** ⚑ Asked through the clause no grant narrows, as `a-card-that-says-idle.test.ts` does. */
  const cardOf = (id: string) => host.agentCard(id, THE_APP_ITSELF, id)

  it('🔴 what a live session says it is still running reaches the wire as `running in the background · <it>`', async () => {
    const { sessionId } = await host.createSession({ provider: 'claude', cwd: work }, window)
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('no handle was issued')
    // THE CONTROL — before anything is said, this is an ordinary idle conversation.
    expect(cardOf(sessionId)).toMatchObject({ state: { is: 'idle' } })

    handle.simulateBackgroundWork({ running: [{ id: 'bg_1', description: 'sleep 40' }] })
    await waitFor(
      () => cardOf(sessionId)?.state.is === 'in-the-background',
      'the background level to reach the card',
    )

    const state = cardOf(sessionId)?.state
    expect(state).toEqual({ is: 'in-the-background', what: 'sleep 40' })
    expect(agentStateWords(state!)).toBe('running in the background · sleep 40')
  })

  it('⚑ …and a job it says it will wake on reaches the wire as `scheduled` — below the background, on the SAME session', async () => {
    const { sessionId } = await host.createSession({ provider: 'claude', cwd: work }, window)
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('no handle was issued')

    handle.simulateScheduledWork({
      jobs: [{ id: 'c1', schedule: '*/5 * * * *', recurring: true, prompt: 'check the build' }],
    })
    await waitFor(
      () => cardOf(sessionId)?.state.is === 'scheduled',
      'the schedule to reach the card',
    )
    expect(cardOf(sessionId)?.state).not.toEqual({ is: 'idle' })

    // ⚑ THE PAIR — the ONE order (R11), on the very same session: something now running outranks
    // the wake-up that has not happened yet, exactly as §1's pure ladder says it must.
    handle.simulateBackgroundWork({ running: [{ id: 'bg_2', description: 'npm run build' }] })
    await waitFor(
      () => cardOf(sessionId)?.state.is === 'in-the-background',
      'the background level to outrank the schedule',
    )
    expect(cardOf(sessionId)?.state).toEqual({ is: 'in-the-background', what: 'npm run build' })
  })
})
