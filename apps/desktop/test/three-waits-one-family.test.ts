import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type {
  AgentToolset,
  ResumeOptions,
  SessionHandle,
  SessionRef,
  StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { isGiverStallNotice, RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import type { ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  TASK_IS_OPEN,
  TASK_STATES,
  TASK_WAITS,
  WAITING_STANDS_FOR,
  composeWhatEachPieceIsWaitingOn,
  stalledWithACause,
  theWaitIn,
  type PieceRow,
  type WhatAConversationIsWaitingOn,
} from '../src/shared/tasks'
import { WORK_STATE_WORD } from '../src/renderer/src/lib/work-report'
import { aPersonOwesAnAnswerIn, type RoutedRequest } from '../src/shared/questions'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * 🔴 **609 · three waits, one family** — `HO-088` §5, straight after B1 (`608`).
 *
 * ## ⛔ The ruling
 *
 * > ⚑ **An agent whose turn ended with something OUTSTANDING is WAITING. An agent whose turn ended
 * > with nothing outstanding is IDLE.**
 *
 * ⛔ **Three waits, each from a fact the ledger already holds**, and `603` shipped the first:
 *
 * | the wait | the recorded fact |
 * |---|---|
 * | `waiting-on-an-answer` | a question it asked is still open |
 * | `waiting-on-a-person` | a permission it raised is unanswered (a proposal too, until D-016) |
 * | `waiting-on-a-worker` | a piece it GAVE OUT under this one is still open (per piece, D-016) |
 *
 * ⚑ **D-016 · commit 6 · the family has a fourth member, and it is not composed**:
 * `waiting-on-the-person-who-asked` is what `derivePieces` writes over a piece a person gave when
 * its owner's turn ends with it open. ⛔ It is the fold's own observation, never a conversation's
 * wait, and the composition still says any of the three above over it. §1 and §7 hold it.
 *
 * ## ⚠️ One mechanism, three sources — which is what this suite measures
 *
 * ⛔ **`HO-088` §5.1 in its own words: *one mechanism, three sources — NOT three mechanisms*.**
 * ⚑ `603` built `composeWaitingOnAnAnswer(tasks, askedAbout)`; `609` generalised its SOURCE into
 * {@link WhatAConversationIsWaitingOn} and left one composition. 🔴 **§2 is where that is pinned**,
 * because a second `compose…` beside the first is how two surfaces come to two answers.
 *
 * ## 🔴 What this suite does NOT re-measure
 *
 * ⛔ **`603`'s whole composition property is `waiting-on-an-answer-is-not-stalled.test.ts`**, and
 * it is re-aimed rather than copied here. ⚑ What is new is the two other sources, the precedence
 * between them, and the consequences for the stall notice.
 */
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const srcRoot = join(here, '../src')

/**
 * ⛔ **CODE only** — `a-source-census-must-strip-prose-before-it-asserts`. ⚠️ Every negative in §7
 * is about what the app DOES, and this file's own history sections quote the words they replaced.
 */
const codeOf = (file: string): string =>
  readFileSync(join(srcRoot, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')

describe('609 · three waits, one family', () => {
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

  class ToolWatchingRuntime extends FakeRuntime {
    constructor(
      provider: Provider,
      private readonly handed: AgentToolset[],
      sessions: FakeProviderSessions,
    ) {
      super(provider, { sessions })
    }
    override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
      const handle = await super.start(options)
      if (options.agentTools) this.handed.push(options.agentTools)
      // ⚑ **D-005a · one launch may be handed a sign-in the test can move on** — see
      // {@link aSignInThatCanMoveOn}.
      const latch = latchNext
      latchNext = null
      return (latch === null ? handle : aSignInThatCanMoveOn(handle, latch)) as never
    }
    override async resume(
      ref: SessionRef,
      options: ResumeOptions,
    ): ReturnType<FakeRuntime['resume']> {
      const handle = await super.resume(ref, options)
      if (options.agentTools) this.handed.push(options.agentTools)
      return handle
    }
  }

  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handed: AgentToolset[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ToolWatchingRuntime(provider, handed, issued),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    hosts.push(built)
    return built
  }

  /**
   * ⚑ **D-005a · the next launch's handle, with a sign-in that moves on when the test says** —
   * `checkSignIn()` answering `true` is *superseded* (`assertSignInCurrent`), and
   * `signInSuperseded` is what makes a refused flush an ENDING of the held message.
   */
  let latchNext: { moved: boolean } | null = null
  const aSignInThatCanMoveOn = (handle: SessionHandle, latch: { moved: boolean }): SessionHandle =>
    new Proxy(handle, {
      get(target, key) {
        if (key === 'signInSuperseded') return latch.moved
        if (key === 'checkSignIn') return async () => latch.moved
        const value = Reflect.get(target, key, target) as unknown
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value
      },
    })

  beforeEach(() => {
    latchNext = null
    userData = mkdtempSync(join(tmpdir(), 'brobot2-609-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-609-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handed = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    return sessionId
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

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  /**
   * ⛔ **Answer the card the Fake parks every turn on**, which is how a conversation is made idle
   * AND how its `waiting-on-a-person` arm is cleared. ⚠️ Both matter: without this, every test
   * below would measure the PERSON arm because it wins the precedence.
   */
  const clearTheCard = async (sessionId: string, surface: RecordingSink): Promise<void> => {
    const card = ledger(sessionId)
      .filter(
        (event): event is TranscriptEvent & { type: 'permission_request'; id: string } =>
          event.type === 'permission_request',
      )
      .at(-1)
    if (card === undefined) throw new Error(`${sessionId} is not parked on anything`)
    await host.respondPermission(sessionId, card.id, { outcome: 'allow' }, surface)
  }

  /** ⚑ What the giver's `list_tasks` board says of one piece it gave (D-016: `pieceBoard`). */
  const stateSeenBy = (giver: string, piece: string): string | undefined =>
    host.pieceBoard(giver).gave.find((one) => one.piece === piece)?.state

  /** ⚑ The one open piece a conversation holds — a give's — or a throw naming what never opened. */
  const theOpenPieceOf = (owner: string, what: string): PieceRow => {
    const found = store.piecesOwnedBy(owner).find((one) => TASK_IS_OPEN[one.state])
    if (found === undefined) throw new Error(`${what} never opened a piece`)
    return found
  }

  /** ⚑ A row the composition can be handed, with every field spelled so nothing is inherited. */
  const rowFor = (state: PieceRow['state'], holder = 'sess_w', piece = 'work_1'): PieceRow => ({
    piece,
    label: 'W1.1',
    parent: 'work_root',
    title: 'work',
    brief: 'work',
    giver: 'sess_pm',
    owner: holder,
    givenAt: 10,
    messageId: null,
    state,
    endedAt: TASK_IS_OPEN[state] ? null : 20,
    endedBy: null,
    outcome: state === 'answered' ? 'done' : null,
    stalledBecause: state === 'stalled' ? 'turn_ended' : null,
    stalledAt: state === 'stalled' ? 15 : null,
    stalledBy: null,
    questionLostAtRestart: false,
    resources: [],
    summary: null,
    answerReachedNobody: false,
    needsUserAction: false,
    statusLine: null,
  })

  const outstanding = (
    over: Partial<WhatAConversationIsWaitingOn> = {},
  ): (() => WhatAConversationIsWaitingOn) => {
    const built: WhatAConversationIsWaitingOn = {
      answers: new Set<string>(),
      aPerson: false,
      childrenOpen: new Set<string>(),
      ...over,
    }
    return () => built
  }

  const routing = (over: Partial<RoutedRequest> = {}): RoutedRequest => ({
    requestId: 'req_1',
    askedBy: 'sess_w',
    parent: 'sess_pm',
    went: { is: 'the-parent', to: 'the-parent' },
    at: 10,
    state: 'open',
    endedAt: null,
    escalatedAt: null,
    ...over,
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────

  /**
   * 🔴 **§1 · the vocabulary — members that read as a set, and a family that cannot drift.**
   */
  describe('§1 · the family, derived rather than listed twice', () => {
    it('⛔ TASK_WAITS is FILTERED out of TASK_STATES, so a new wait cannot join one and not the other', () => {
      // ⚑ **The roster is derived from the vocabulary** — `derive-a-roster-from-the-import-not-the-
      // mention`, and `a-hook-family-must-be-built-from-a-template-literal` for why the prefix is
      // the carrier rather than a second array somebody has to remember.
      expect([...TASK_WAITS]).toEqual([
        'waiting-on-an-answer',
        'waiting-on-a-person',
        'waiting-on-a-worker',
        // ⚑ **D-016 · commit 6 · the fourth, and it joined both by its prefix alone** — the folded
        // wait on the person who asked (this file's header).
        'waiting-on-the-person-who-asked',
        // ⚑ **F097 · the fifth, the same way** — the folded wait on the person who wrote.
        'waiting-on-the-person-who-wrote',
        // ⚑ **The sixth, the same way** — a piece marked as waiting on purpose.
        'waiting-on-purpose',
      ])
      for (const wait of TASK_WAITS) expect([...TASK_STATES]).toContain(wait)
      // ⛔ **THE CONTROL, and it is the one that matters**: the bare `waiting` member — a task whose
      // MESSAGE is still in a mailbox — is NOT in this family. ⚠️ It is the near-miss `603`'s own
      // docblock warned about (*"two different nothings"*), and the `-on-` is what separates them.
      expect([...TASK_STATES]).toContain('waiting')
      expect([...TASK_WAITS]).not.toContain('waiting')
      expect(theWaitIn('waiting')).toBeNull()
      // ⚑ **And the guard and the roster are ONE spelling of the prefix test**, so a state cannot
      // be in the family for one reader and out of it for the other.
      for (const state of TASK_STATES) {
        expect(theWaitIn(state) === null, `${state} disagrees with TASK_WAITS`).toBe(
          !TASK_WAITS.includes(state as never),
        )
      }
    })

    it('🔴 every wait is OPEN, and every wait owes the fact behind its word', () => {
      // ⛔ **Open for `stalled`'s reason and not a new one** — the work is still somebody's to
      // finish, and a CLOSED wait could never be answered (`393`'s second-reply rule).
      for (const wait of TASK_WAITS) expect(TASK_IS_OPEN[wait], `${wait} is not open`).toBe(true)
      // ⚑ **A state name is this app's vocabulary; the sentence is the fact it stands for.**
      // `a-closed-vocabulary-guards-what-a-member-says` — a bare word on a line a model reads is a
      // word with nothing behind it.
      expect(Object.keys(WAITING_STANDS_FOR).sort()).toEqual([...TASK_WAITS].sort())
      for (const wait of TASK_WAITS) {
        expect(WAITING_STANDS_FOR[wait].length, `${wait} has no fact`).toBeGreaterThan(20)
        // ⚠️ **No full stop and no speaker** — `A_PERSON_MUST_ACT`'s shape, kept.
        expect(WAITING_STANDS_FOR[wait].endsWith('.'), `${wait} ends a sentence`).toBe(false)
      }
      // ⛔ **A distinct fact each and not one sentence repeated** —
      // `an-enumeration-whose-members-must-differ-needs-a-distinctness-check`.
      expect(new Set(Object.values(WAITING_STANDS_FOR)).size).toBe(TASK_WAITS.length)
      // ⚑ **And a PERSON's word for each**, keyed by the same vocabulary.
      expect(new Set(TASK_WAITS.map((wait) => WORK_STATE_WORD[wait])).size).toBe(TASK_WAITS.length)
    })
  })

  /**
   * 🔴 **§2 · the composition — ONE mechanism, three sources, and the precedence held in one place.**
   */
  describe('§2 · one composition, three sources', () => {
    it('⛔ each source fires ALONE, and the control is the same row with nothing outstanding', () => {
      const cases = [
        ['waiting-on-an-answer', outstanding({ answers: new Set(['work_1']) })],
        ['waiting-on-a-person', outstanding({ aPerson: true })],
        ['waiting-on-a-worker', outstanding({ childrenOpen: new Set(['work_1']) })],
      ] as const
      for (const [word, source] of cases) {
        const composed = composeWhatEachPieceIsWaitingOn([rowFor('stalled')], source)
        expect(composed[0]?.state, `${word} did not compose`).toBe(word)
        // 🔴 **The stall fields are CLEARED** — `stalledBecause` is non-null if and only if the
        // state is `stalled`, which four readers rest on.
        expect(composed[0]?.stalledBecause).toBeNull()
        expect(composed[0]?.stalledAt).toBeNull()
        expect(stalledWithACause(composed[0] as PieceRow)).toBe(false)
      }
      // ⛔ **THE CONTROL** — the identical row with nothing outstanding keeps its state AND its
      // cause, so the positive assertions above differ from the default
      // (`a-positive-assertion-must-differ-from-the-default`).
      const untouched = composeWhatEachPieceIsWaitingOn([rowFor('stalled')], outstanding())
      expect(untouched[0]?.state).toBe('stalled')
      expect(untouched[0]?.stalledBecause).toBe('turn_ended')
      expect(stalledWithACause(untouched[0] as PieceRow)).toBe(true)
    })

    it('🔴 the PRECEDENCE is answer → person → worker, and it is held HERE so no caller holds it', () => {
      // ⛔ **All three true at once**, which is an ordinary state for a project manager: it asked
      // its own parent something, it is parked on a card, and it has work out.
      const out = new Set(['work_1'])
      const all = outstanding({ answers: new Set(['work_1']), aPerson: true, childrenOpen: out })
      expect(composeWhatEachPieceIsWaitingOn([rowFor('stalled')], all)[0]?.state).toBe(
        'waiting-on-an-answer',
      )
      // ⚠️ **Drop the most specific and the next one takes it**, which is what makes the line above
      // an ORDER and not one arm that happens to be first.
      expect(
        composeWhatEachPieceIsWaitingOn(
          [rowFor('stalled')],
          outstanding({ aPerson: true, childrenOpen: out }),
        )[0]?.state,
      ).toBe('waiting-on-a-person')
      expect(
        composeWhatEachPieceIsWaitingOn([rowFor('stalled')], outstanding({ childrenOpen: out }))[0]
          ?.state,
      ).toBe('waiting-on-a-worker')
    })

    it('⚠️ the ANSWER and WORKER arms are keyed to THIS piece and the person arm is the conversation’s', () => {
      // ⛔ **Two open pieces on ONE holder, and only one of them is asked about.**
      const rows = [rowFor('stalled', 'sess_w', 'work_1'), rowFor('stalled', 'sess_w', 'work_2')]
      const asked = composeWhatEachPieceIsWaitingOn(
        rows,
        outstanding({ answers: new Set(['work_1']) }),
      )
      expect(asked.map((one) => one.state)).toEqual(['waiting-on-an-answer', 'stalled'])
      // 🔴 **D-016 · and only the piece a child hangs under waits on a worker** — the tree joins
      // handed-out work to the piece it was given under, so one piece's open child no longer
      // silences its sibling's stall.
      expect(
        composeWhatEachPieceIsWaitingOn(
          rows,
          outstanding({ childrenOpen: new Set(['work_2']) }),
        ).map((one) => one.state),
      ).toEqual(['stalled', 'waiting-on-a-worker'])
      // ⚑ **And the conversation-wide arm reaches BOTH, deliberately.** ⚠️ A permission carries no
      // piece (`430`), so narrowing it to one row would be a join the ledger does not contain.
      // ⛔ Asserted so the breadth is a decision somebody can find rather than a surprise.
      expect(
        composeWhatEachPieceIsWaitingOn(rows, outstanding({ aPerson: true })).map(
          (one) => one.state,
        ),
      ).toEqual(['waiting-on-a-person', 'waiting-on-a-person'])
    })

    it('⛔ EVERY open state composes and no closed one does — driven over the vocabulary', () => {
      // ⚑ **`a-loop-over-a-literal-variant-list-is-not-exhaustive`** — a ninth state gains a case
      // here with the constant.
      for (const state of TASK_STATES) {
        const composed = composeWhatEachPieceIsWaitingOn(
          [rowFor(state)],
          outstanding({ childrenOpen: new Set(['work_1']) }),
        )
        expect(composed[0]?.state, `${state} composed wrongly`).toBe(
          TASK_IS_OPEN[state] ? 'waiting-on-a-worker' : state,
        )
      }
    })

    it('⚑ a closed row costs NO read at all, and an open one is asked about its HOLDER', () => {
      const asked: string[] = []
      const record = (id: string): WhatAConversationIsWaitingOn => {
        asked.push(id)
        return {
          answers: new Set<string>(),
          aPerson: false,
          childrenOpen: new Set<string>(),
        }
      }
      composeWhatEachPieceIsWaitingOn([rowFor('answered'), rowFor('withdrawn')], record)
      expect(asked).toEqual([])
      composeWhatEachPieceIsWaitingOn([rowFor('stalled')], record)
      // ⛔ **The HOLDER and never the giver** — all three facts are about the conversation that has
      // to move next.
      expect(asked).toEqual(['sess_w'])
      expect(asked).not.toContain('sess_pm')
    })
  })

  /**
   * 🔴 **§3 · the two new sources, each with the control that makes it a measurement.**
   */
  describe('§3 · what makes a person owed something', () => {
    it('⛔ a permission-shaped routing counts while it is OPEN, and both halves are necessary', () => {
      const card = routing({
        went: {
          is: 'the-person-the-channel-left-it-with',
          to: 'a-person',
          because: 'a-permission-decision',
        },
      })
      expect(aPersonOwesAnAnswerIn([card])).toBe(true)
      // ⚠️ **CONTROL 1 — answered.** The shape is still a person's for ever; what changed is that
      // it can no longer be settled, and `REQUEST_IS_OPEN` is the half that says so.
      expect(aPersonOwesAnAnswerIn([{ ...card, state: 'answered', endedAt: 20 }])).toBe(false)
      // ⚠️ **CONTROL 2 — open, but the PARENT's.** `ask_parent`'s routing travels, so `because` is
      // null; admitting it here would answer `waiting-on-a-person` about a question whose answer is
      // the reader's own to give, and the ANSWER arm already has it.
      expect(aPersonOwesAnAnswerIn([routing()])).toBe(false)
      // 🔴 **CONTROL 3 — ESCALATED, and this one is a ruling rather than an edge.** A question that
      // became a person's *"without anything about the work changing"* must not move the task's
      // state, which is `603`'s own argument for not naming the state after who owes the answer.
      expect(aPersonOwesAnAnswerIn([routing({ escalatedAt: 50 })])).toBe(false)
      // ⚑ **Every member of `ChannelRefusal` and not the one the briefs talk about** — `403` §1.
      expect(
        aPersonOwesAnAnswerIn([
          routing({
            went: {
              is: 'the-person-the-channel-left-it-with',
              to: 'a-person',
              because: 'a-secret-only-a-person-can-type',
            },
          }),
        ]),
      ).toBe(true)
    })
  })

  /**
   * 🔴 **§4 · *waiting on a worker* is READ from the hand-over row — `HO-088` §5.1's whole point.**
   *
   * ⛔ **The PO refused deriving it from whether the child looks idle**, and gave two failure
   * directions. ⚑ This section puts both on the path the code walks.
   */
  describe('§4 · the hand-over row, and never a child’s state', () => {
    it('🔴 the giver reads `waiting-on-a-worker` whatever the child is doing — the PO’s first direction', async () => {
      // ⛔ **A child idle because it FINISHED, because it CRASHED, and because it is waiting on a
      // person are three different situations** — and the giver's state must not differ between
      // them, because the hand-over row is the same in all three.
      const rows = [rowFor('stalled', 'sess_giver')]
      const fromTheRow = outstanding({ childrenOpen: new Set(['work_1']) })
      expect(composeWhatEachPieceIsWaitingOn(rows, fromTheRow)[0]?.state).toBe(
        'waiting-on-a-worker',
      )
      // ⚑ **The source is a FUNCTION of the conversation id and of nothing else** — it is handed in
      // rather than reached for, so this module cannot consult a slot map even if somebody wanted
      // it to. 🔴 That is the structural half of the ruling.
      const tasks = codeOf('shared/tasks.ts')
      for (const forbidden of ['slots', 'status()', 'handle', 'runningStateOf', 'AgentCard']) {
        expect(tasks, `the composition module reached for ${forbidden}`).not.toContain(forbidden)
      }
    })

    it('⛔ the app READS the hand-over fold, and the census names what it must not read', () => {
      // ⚑ **Both layers build the source from the same three reads**, which is the property that
      // keeps a piece from reading one word in a window and another in a tool. ⚠️ D-016 took the
      // fourth, `aPersonOwesADecisionIn`, with proposals, and made the third `childrenOpen` — the
      // open pieces given, keyed by the piece each was given under.
      const host = codeOf('main/runtime/runtime-host.ts')
      const store = codeOf('main/db/session-store.ts')
      for (const source of ['openQuestionsByWork', 'aPersonOwesAnAnswerIn', 'childrenOpen']) {
        expect(host, `the host stopped reading ${source}`).toContain(source)
        expect(store, `the store stopped reading ${source}`).toContain(source)
      }
      // 🔴 **The hand-over fold by name, at both builders.** ⛔ `piecesGivenBy` IS *the work this
      // conversation gave out*; a source that asked a child's session for its state would be this
      // product's first inference, which `HO-088` §5.1 rules against.
      // ⚠️ **671 · each now passes the answer's `RowsUnread`** (R18), so the fold is asked with the
      // counter that makes a torn row COUNTED — re-aimed to the call as it is written now.
      // ⚑ **D-036 moved the host's call** out of `oneWaitReadPerAnswer` into
      // `oneWorkOutReadPerAnswer`, the one read of the open work a conversation gave (and the ones
      // it stands for gave) that `childrenOpen` and the one state's *waiting on <name>* both take —
      // the same fold, the same counter, asked per id it stands for.
      expect(host).toContain('.piecesGivenBy(one, unread)')
      expect(store).toContain('piecesGivenBySession(sessionId, unread)')
      // ⚠️ **THE POSITIVE CONTROL for the two negatives above** (standing rule 34.2): the strings
      // this census hunts for are real strings that this same corpus contains, so a grep that had
      // stopped matching anything would be visible here rather than passing as a clean sweep.
      expect(host).toContain('runningStateOf')
      expect(codeOf('shared/tasks.ts')).toContain('TASK_IS_OPEN')
    })

    it('⚑ END TO END: the giver’s turn ends, it has work out, and it is NOT reported as stalled', async () => {
      // ⛔ **A three-deep chain, because that is the only shape in which a giver holds a GIVEN piece
      // of its own**: a root is never a folded piece (D-016 · R1), so the middle needs a giver.
      // ⚑ **D-016** — the give starts the middle, and its brief is the middle's first turn, which
      // parks on the Fake's card (the top's `ask`).
      const seeded = await personOpens('worker')
      await host.close(seeded, window)
      const top = await personOpens('pm')
      const topTools = theToolsetJustHandedOut()
      const given = await callOn(topTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'The middle of the chain',
        brief: 'do the thing',
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      const middle = given.agent as string
      const middleTools = theToolsetJustHandedOut()
      const mine = theOpenPieceOf(middle, 'the give')

      const surface = new RecordingSink('webContents:9')
      host.claimSession(middle, surface)
      await waitFor(
        () => ledger(middle).some((event) => event.type === 'permission_request'),
        'the middle conversation to park on its card',
      )
      // ⚠️ **The card is cleared FIRST**, or the PERSON arm wins the precedence and this test would
      // pass for the wrong reason — which is exactly what `a-comparison-tested-where-both-sides-
      // agree-measures-nothing` is about.
      await clearTheCard(middle, surface)
      const itsRow = (): PieceRow | undefined =>
        store.piecesOwnedBy(middle).find((one) => one.piece === mine.piece)
      await waitFor(() => itsRow()?.state === 'stalled', 'the middle conversation’s turn to end')
      // ⛔ **THE BEFORE**: with nothing handed out, the raw fold and every surface agree that
      // nothing is driving it. ⚑ This is the state `609` is about to change, measured first.
      expect(itsRow()?.stalledBecause).toBe('turn_ended')
      expect(stateSeenBy(top, mine.piece)).toBe('stalled')

      // ⚑ **D-016 · the middle hands a piece on under the one it holds** — a give, which starts the
      // sub with the brief as its first turn.
      const handedOn = await callOn(middleTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'The work the middle hands on',
        brief: 'the piece I am handing on',
      })
      expect(handedOn.outcome, JSON.stringify(handedOn)).toBe('ok')
      const sub = handedOn.agent as string

      // 🔴 **THE AFTER, and it is the whole ruling**: the middle conversation's turn is still
      // ended and the fold still says so, and the word every surface reports is now the truth —
      // it is waiting on a worker.
      expect(itsRow()?.state).toBe('stalled')
      expect(stateSeenBy(top, mine.piece)).toBe('waiting-on-a-worker')
      // ⚑ **And the work tab, which is the store's own walk rather than the host's read** —
      // `HO-091` §1's *every surface reads that one composition*.
      expect(store.workGivenOutBy(top).rows.find((one) => one.piece === mine.piece)?.state).toBe(
        'waiting-on-a-worker',
      )

      // 🔴 **THE CONTROL THAT MAKES IT A MEASUREMENT: the work comes back, and the wait ENDS.**
      // ⛔ Without this the state would be *this conversation once handed work out*, which is a
      // row nobody can ever clear — `TASK_IS_OPEN` over the hand-over fold is what makes the fact
      // about NOW. ⚑ `a-positive-assertion-must-differ-from-the-default`, at the source.
      const subTools = handed.at(-1)
      if (subTools === undefined) throw new Error('no toolset for the sub')
      const subPiece = theOpenPieceOf(sub, 'the handed-on work')
      const replied = await callOn(subTools, 'reply_to_parent', {
        piece: subPiece.label,
        outcome: 'done',
        summary: 'the piece is finished',
      })
      expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
      // ⚠️ **The reply is DELIVERED as a turn, which parks the middle on a fresh card** — `608`'s
      // whole property, arriving here as a fixture obligation. ⛔ Clearing it is what isolates the
      // WORKER arm from the PERSON arm; without it this control would pass for the wrong reason.
      await waitFor(
        () => aPersonOwesAnAnswerIn(store.routedRequestsOf(middle)),
        'the middle conversation to park on the fresh card',
      )
      await clearTheCard(middle, surface)
      await waitFor(
        () => !aPersonOwesAnAnswerIn(store.routedRequestsOf(middle)),
        'the card to clear',
      )
      expect(stateSeenBy(top, mine.piece)).toBe('stalled')
    })
  })

  /**
   * 🔴 **D-005 · F019 — the last helper's reply starts its owner's turn, and nobody is told it
   * stalled.** ⚑ Measured by BroBot (F019): the helper's task closed before its reply reached the
   * owner, so the owner's work read `stalled` at the moment that reply started its next turn — and
   * its giver was pushed *"not being worked on"* then. ⚑ `609`'s chain, in F019's order: the middle
   * hands work on while its own turn is still running, and only then does that turn end.
   */
  describe('D-005 · F019 — an owner woken by its last helper', () => {
    it('🔴 no stall notice reaches the giver, and the owner’s work reads working in its wake turn', async () => {
      const seeded = await personOpens('worker')
      await host.close(seeded, window)
      const top = await personOpens('pm')
      const topTools = theToolsetJustHandedOut()
      // ⚑ **D-016** — the give starts the owner, and its brief is the owner's first turn.
      const given = await callOn(topTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'The report',
        brief: 'write the report',
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      const middle = given.agent as string
      const middleTools = theToolsetJustHandedOut()
      const report = theOpenPieceOf(middle, 'the give')
      const surface = new RecordingSink('webContents:9')
      host.claimSession(middle, surface)
      await waitFor(
        () => ledger(middle).some((event) => event.type === 'permission_request'),
        'the owner to park on its card',
      )

      // ⚑ **F019's order: the owner hands a piece on INSIDE its turn**, then its turn ends.
      const handedOn = await callOn(middleTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'The notes for the report',
        brief: 'write the notes',
      })
      expect(handedOn.outcome, JSON.stringify(handedOn)).toBe('ok')
      const helper = handedOn.agent as string
      const helperTools = theToolsetJustHandedOut()
      await clearTheCard(middle, surface)
      await waitFor(
        () =>
          store.piecesOwnedBy(middle).find((one) => one.piece === report.piece)?.state ===
          'stalled',
        'the owner’s turn to end',
      )
      // ⚑ **609 holds**: its turn ended with a helper out, so it reads waiting, and nobody is told.
      expect(stateSeenBy(top, report.piece)).toBe('waiting-on-a-worker')
      const noticesToTheGiver = (): string[] =>
        ledger(top).flatMap((event) =>
          (event.type === 'user_turn' || event.type === 'message_queued') &&
          event.text.includes(report.label) &&
          isGiverStallNotice(event.text)
            ? [event.text]
            : [],
        )
      expect(noticesToTheGiver()).toEqual([])

      // 🔴 **The helper answers — its piece closes, and its reply starts the owner's next turn.**
      const notes = theOpenPieceOf(helper, 'the handed-on work')
      const turnsBefore = ledger(middle).filter((event) => event.type === 'user_turn').length
      const replied = await callOn(helperTools, 'reply_to_parent', {
        piece: notes.label,
        outcome: 'done',
        summary: 'the notes are written',
      })
      expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
      await waitFor(
        () => ledger(middle).filter((event) => event.type === 'user_turn').length > turnsBefore,
        'the reply to start the owner’s turn',
      )
      await waitFor(
        () => aPersonOwesAnAnswerIn(store.routedRequestsOf(middle)),
        'the owner to park on its wake turn’s card',
      )
      // ⛔ **No notice**: its work was being driven the whole time.
      expect(noticesToTheGiver()).toEqual([])
      // ⚑ **And the fold reads it working in the wake turn** — the composition says the card
      // it is parked on, which outranks it (`609`'s precedence).
      expect(store.piecesOwnedBy(middle).find((one) => one.piece === report.piece)).toMatchObject({
        state: 'working',
        stalledBecause: null,
      })
      expect(stateSeenBy(top, report.piece)).toBe('waiting-on-a-person')
    })
  })

  /**
   * 🔴 **D-005a · F019's fix check — the helpers answer while their owner is mid-turn.** ⚑ Measured
   * by BroBot (2026-09-27, task #25): the answers waited in the owner's queue, its turn ended with no
   * helper work open, and its giver was told *"not being worked on"* about 10 s before those answers
   * started the owner's next turn.
   */
  describe('D-005a · F019 — answers waiting in the owner’s queue', () => {
    /** ⚑ The chain up to the helper's answer, queued behind the owner's running turn. */
    const answeredMidTurn = async (
      latch: { moved: boolean } | null = null,
    ): Promise<{
      top: string
      middle: string
      surface: RecordingSink
      report: PieceRow
      notices: () => string[]
    }> => {
      const seeded = await personOpens('worker')
      await host.close(seeded, window)
      const top = await personOpens('pm')
      const topTools = theToolsetJustHandedOut()
      latchNext = latch
      // ⚑ **D-016** — the give starts the owner (on the latched launch), and its brief is the
      // owner's first turn.
      const given = await callOn(topTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'The report',
        brief: 'write the report',
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      const middle = given.agent as string
      const middleTools = theToolsetJustHandedOut()
      const report = theOpenPieceOf(middle, 'the give')
      const surface = new RecordingSink('webContents:9')
      host.claimSession(middle, surface)
      await waitFor(
        () => ledger(middle).some((event) => event.type === 'permission_request'),
        'the owner to park on its card',
      )
      const handedOn = await callOn(middleTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'The notes for the report',
        brief: 'write the notes',
      })
      expect(handedOn.outcome, JSON.stringify(handedOn)).toBe('ok')
      const helper = handedOn.agent as string
      const helperTools = theToolsetJustHandedOut()
      const notes = theOpenPieceOf(helper, 'the handed-on work')
      // 🔴 **The helper answers while its owner's turn is still running.**
      const replied = await callOn(helperTools, 'reply_to_parent', {
        piece: notes.label,
        outcome: 'done',
        summary: 'the notes are written',
      })
      expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
      // ⚑ **The premise, read off the owner's ledger**: its helper's work is closed, and the answer
      // is WAITING in its queue rather than delivered.
      expect(store.piecesOwnedBy(helper)[0]?.state).toBe('answered')
      expect(ledger(middle).some((event) => event.type === 'message_queued')).toBe(true)
      const notices = (): string[] =>
        ledger(top).flatMap((event) =>
          (event.type === 'user_turn' || event.type === 'message_queued') &&
          event.text.includes(report.label) &&
          isGiverStallNotice(event.text)
            ? [event.text]
            : [],
        )
      return { top, middle, surface, report, notices }
    }

    it('🔴 its turn ends with the answer waiting: no notice, and the work reads working until the answer starts the next turn', async () => {
      const { top, middle, surface, report, notices } = await answeredMidTurn()
      const turnsBefore = ledger(middle).filter((event) => event.type === 'user_turn').length
      await clearTheCard(middle, surface)
      await waitFor(
        () => ledger(middle).filter((event) => event.type === 'user_turn').length > turnsBefore,
        'the waiting answer to start the owner’s next turn',
      )
      await waitFor(
        () => aPersonOwesAnAnswerIn(store.routedRequestsOf(middle)),
        'the owner to park on its wake turn’s card',
      )
      // ⛔ **No notice at the turn's end, nor since**: the answer was waiting to drive the work.
      expect(notices()).toEqual([])
      // ⚑ …and the turn's end never stalled it: no row of the fold ever read stalled.
      expect(store.piecesOwnedBy(middle).find((one) => one.piece === report.piece)).toMatchObject({
        state: 'working',
        stalledBecause: null,
      })
      expect(stateSeenBy(top, report.piece)).toBe('waiting-on-a-person')
    })

    it('🔴 its sign-in moved on while the answer waited: still held, it drives the turn of the life this app reopens on the current one — no notice', async () => {
      // ⚑ The sign-in moved on while the owner held the answer: the flush leaves it held, and once
      // the owner is free this app reopens it on the current sign-in, where the answer goes first.
      const latch = { moved: false }
      const { middle, surface, report, notices } = await answeredMidTurn(latch)
      latch.moved = true
      await clearTheCard(middle, surface)
      await waitFor(
        () =>
          ledger(middle).some(
            (event) => event.type === 'reopened' && event.because === 'the-sign-in-moved-on',
          ),
        'this app to reopen the owner on the current sign-in',
      )
      const reopenedAt = ledger(middle).findIndex((event) => event.type === 'reopened')
      await waitFor(
        () =>
          ledger(middle)
            .slice(reopenedAt)
            .some((event) => event.type === 'user_turn'),
        'the waiting answer to start the reopened owner’s first turn',
      )
      expect(
        ledger(middle).some(
          (event) => event.type === 'message_unqueued' && event.reason === 'abandoned',
        ),
      ).toBe(false)
      // ⛔ **No notice**: the answer was waiting to drive the work, and it did.
      expect(notices()).toEqual([])
      expect(store.piecesOwnedBy(middle).find((one) => one.piece === report.piece)?.state).not.toBe(
        'stalled',
      )
    })
  })

  /**
   * 🔴 **§5 · what it costs the stall notice, stated as a property rather than discovered later.**
   */
  describe('§5 · the notice moves to where the work actually stopped', () => {
    it('⛔ a giver waiting on a worker is owed NO undriven notice, and the control still is', () => {
      // ⚑ **`stalledWithACause` is the ONE predicate both recipients are admitted by** — an agent's
      // notice and a person's queue row — so one assertion measures both.
      const waiting = composeWhatEachPieceIsWaitingOn(
        [rowFor('stalled')],
        outstanding({ childrenOpen: new Set(['work_1']) }),
      )[0] as PieceRow
      expect(stalledWithACause(waiting)).toBe(false)
      // ⛔ **THE CONTROL, trapped the same way** — the same row, the same composition, and the one
      // fact that differs is whether anything is outstanding.
      const told = composeWhatEachPieceIsWaitingOn(
        [rowFor('stalled')],
        outstanding(),
      )[0] as PieceRow
      expect(stalledWithACause(told)).toBe(true)
    })

    it('🔴 the notice is not LOST — it is owed at the link that actually stopped', () => {
      // ⛔ **The child's own row is untouched by its giver's wait.** ⚑ `waiting-on-a-worker` is a
      // fact about the GIVER, and the row the notice is owed about belongs to the conversation
      // that went quiet — which is why a chain that stops reports at its broken link and not at
      // every link above it.
      const childsRow = rowFor('stalled', 'sess_sub', 'work_child')
      const composed = composeWhatEachPieceIsWaitingOn([childsRow], outstanding())[0] as PieceRow
      expect(composed.state).toBe('stalled')
      expect(stalledWithACause(composed)).toBe(true)
      expect(composed.giver).toBe('sess_pm')
    })
  })

  /**
   * 🔴 **§6 · `PROPOSAL_BOUND_MS` — ANSWERED by `609`, REPAIRED by `615`, REMOVED by `616`.**
   *
   * ⛔ **`608` asked: does it still bound something a person's silence should not?** ⚑ About the
   * PROPOSAL, no — `441`'s criterion 21 keeps the card answerable for ever. 🔴 **About the
   * PROPOSER, yes**, and this section was the measurement rather than the argument.
   *
   * ## ⚠️ 615 · what this section asserted, and why the assertion had to be INVERTED
   *
   * ⛔ **`609` wrote the defect down as the ABSENCE of every carrier** — a loop asserting that
   * `decideProposal` reaches a model through none of `queueMessage`, `deliverAnswer` or
   * `handToProvider` — ⚑ **so that it could not be silently fixed or silently forgotten.** 🔴 It
   * went red the moment `615` built one, which is exactly what it was for.
   *
   * ⚑ **It was not deleted.** ⚠️ The absence is now a UNIQUENESS control — those three doors are
   * still the wrong ones — and beside it stands the positive assertion that the one right door is
   * called.
   *
   * ## 🔴 616 · the GUARD in front of that call has gone, and this section says so by name
   *
   * ⛔ **`615` pinned `if (!parked) void this.deliverDecision(`** — the half a delivery breaks by
   * being unconditional, because a decision that settled a still-waiting call AND sent it a turn
   * is `591 M6` re-created. ⚠️ **`616` removed the other carrier**, so the guard has nothing left
   * to exclude and an unconditional delivery is now the correct shape. ⚑ **What the section
   * measures is unchanged**: exactly one carrier, named, and three doors that are still the wrong
   * ones.
   *
   * 🔴 **And the title went with the bound** (standing rule 19's corollary; `603`, `608` and
   * `615` each did this to their own predecessor).
   *
   * ⚑ **D-016 took proposals, and with them the carrier this section measured** — the decision
   * and `deliverDecision` are gone, so its first test went with its subject. ⛔ What is left is the
   * half that was never about a proposal: no clock decides that a person failed to answer.
   */
  describe('§6 · nothing releases the call any more, and no clock decides a person failed', () => {
    it('⚠️ the number is GONE, and neither spelling of a wait on a person is left in the app', () => {
      // ⛔ **616 · this asserted the literal was here** — `expect(PROPOSAL_BOUND_MS).toBe(300_000)`
      // and `expect(proposals).toContain('export const PROPOSAL_BOUND_MS = 300_000')`. ⚑ `608`
      // re-homed it, `609` answered what it was for, and `HO-093` §2 ruled it away; **re-aimed
      // rather than deleted**, so a number cannot come back without a person noticing. ⚑ D-016
      // deleted `shared/proposals.ts` with proposals, so the host is where `proposalBoundMs` is
      // still refused.
      expect(codeOf('shared/questions.ts')).not.toContain('ASK_BOUND_MS')
      expect(codeOf('main/runtime/runtime-host.ts')).not.toContain('proposalBoundMs')
      // 🔴 **616 relay 1 · the control was `ESCALATION_WINDOW_MS` and `612` REMOVED IT** in the
      // same integration (HO-088 §3.1). ⛔ **All three waits on somebody answering are gone**, so
      // the family this file is named for is empty — which is the finding, and which means the
      // control cannot be another member of it.
      expect(codeOf('shared/questions.ts')).not.toContain('ESCALATION_WINDOW_MS')
      expect(codeOf('main/runtime/runtime-host.ts')).not.toContain('escalationWindowMs')
      // ⚑ **THE POSITIVE CONTROL for four negatives, and it carries the DISTINCTION** (standing
      // rule 34.2): the vocabulary these numbers belonged to is still here and still readable,
      // and this class still resolves numbers — they bound this app's own teardown rather than
      // how long anybody has to answer.
      expect(codeOf('shared/questions.ts')).toContain('export function aPersonsSince(')
      expect(codeOf('main/runtime/runtime-host.ts')).toContain(
        'deps.closeDrainTimeoutMs ?? DEFAULT_CLOSE_DRAIN_TIMEOUT_MS',
      )
    })
  })

  /**
   * 🔴 **§7 · the sweep — BOTH audiences, each with the control that makes its zero a measurement.**
   */
  describe('§7 · the sentences the ruling moved', () => {
    it('⛔ the MODEL reads the fact behind every wait, from the TABLE and not from a comparison', () => {
      const tools = codeOf('main/runtime/agent-tools.ts')
      // ⚑ **A `Record` keyed by the family**, so a new wait reaches a model with its fact rather
      // than as a bare word — the old shape was `state === 'asking' ? …`, which a new member joins
      // silently (`a-loop-over-a-literal-variant-list-is-not-exhaustive`).
      expect(tools).toContain('WAITING_STANDS_FOR[wait]')
      expect(tools).toContain('theWaitIn(piece.state)')
      expect(tools).not.toContain("task.state === 'asking'")
      expect(tools).not.toContain('WAITING_ON_AN_ANSWER')
    })

    it('🔴 the PERSON’s words: every wait has one, and only the wait on the reader’s own request addresses the reader', () => {
      // ⛔ **The rendered table and not a docblock** — `WORK_STATE_WORD` is what a person reads on
      // the Work tab and in the transcript's work row.
      // ⚑ **F083 · `replied` is the one wait that is not a *waiting on* phrase**, because it names
      // nobody who must move; every wait still has a word.
      for (const wait of TASK_WAITS) {
        expect(WORK_STATE_WORD[wait].length, `${wait} has no word`).toBeGreaterThan(
          wait === 'waiting-on-the-person-who-asked' ? 4 : 8,
        )
      }
      // ⚑ **D-016 · commit 6 · ONE exception, named with its reason.** A piece a person gave waits
      // on the person who asked for it, and it is said on the piece only, in the conversation they
      // asked in: its word is only ever the reader's own request, so it is *waiting on you* — the
      // word the card gives it. ⛔ **Every other wait still addresses no reader**: the window
      // drawing its row may not be the one that will move it. ⚠️ Asserted as the whole set, so a
      // second wait that addresses the reader is a red verdict, and the exception is measured (the
      // pattern finds a real word) rather than skipped.
      // 🔴 **F083 · no wait addresses the reader now.** The exception read *waiting on you*, and
      // beside a rail saying *Nothing needs you* that was a demand nobody made: the state names
      // nobody who must move. It reads *replied*.
      // ⚑ **F097 · ONE exception, named with its reason**: a piece whose owner's turn the person's own
      // words opened and ended open waits on that person, and the app counts it under *Waiting on
      // you* — so *waiting on you* is a demand that IS made, F083's reason turned round.
      expect(
        TASK_WAITS.filter((wait) => /\byou\b/.test(WORK_STATE_WORD[wait])),
        'the waits whose word addresses the reader',
      ).toEqual(['waiting-on-the-person-who-wrote'])
      expect(WORK_STATE_WORD['waiting-on-the-person-who-wrote']).toBe('waiting on you')
      expect(WORK_STATE_WORD['waiting-on-the-person-who-asked']).toBe('replied')
      // ⚑ **`603`'s word did not move**, which is what makes the rename a KEY change rather than a
      // change a person can see.
      expect(WORK_STATE_WORD['waiting-on-an-answer']).toBe('waiting on an answer')
      // ⚠️ **And the sweep's own count, reported as the zero it is**: no rendered string a person
      // reads described the OLD behaviour, because the old behaviour was a word this app DID NOT
      // HAVE — `stalled` and `working` are both still true of the rows they still apply to.
      const stalledWord = WORK_STATE_WORD.stalled
      expect(stalledWord).toBe('not being worked on')
      // ⛔ **THE POSITIVE CONTROL** — the pattern the sweep used finds a real person-facing string
      // in this same corpus, so *none found* is a measurement (standing rule 34.2).
      expect(codeOf('renderer/src/lib/work-report.ts')).toContain(
        "import { WORK_STATE_WORD } from '../../../shared/work-state-words'",
      )
      expect(codeOf('shared/work-state-words.ts')).toContain("stalled: 'not being worked on'")
    })

    it('⚑ no rail gates on a composed word — standing rule 10’s shape, one vocabulary over', () => {
      // 🔴 **A wait is derived from what became of a QUESTION, a CARD or a CHILD's work**, so a
      // rail keyed on one would make an entitlement answer depend on whether somebody had replied.
      const whole = codeOf('main/runtime/runtime-host.ts')
      // ⚑ **D-016c · no reader is cut out any more.** `703`'s `theNoticesALaterFactMadeFalse` and
      // R49's `putWhatIsTrueInPlaceOfTheWait` and `theWaitsThatSetRightAStop` compared against
      // `waiting-on-an-answer` — none a rail — for the *"It is waiting"* correction a reopen once
      // sent a giver. ⛔ They are GONE with their subject (a reopen tells nobody now).
      // ⚑ **F097 · one reader is cut out by name, and it is no rail either**:
      // `aPieceItHoldsWaitsOnWhoWrote` asks whether a piece waits on the person who wrote — the
      // FOLD's own wait, never a composed word — for who owes the conversation the next move, which
      // gates nothing. ⛔ Cut out whole and measured, so the negative holds over the rest.
      const reader = 'private aPieceItHoldsWaitsOnWhoWrote('
      const from = whole.indexOf(reader)
      expect(from, 'the reader cut out below moved or went').toBeGreaterThan(-1)
      const to = whole.indexOf('\n  }\n', from)
      expect(whole.slice(from, to)).toContain("=== 'waiting-on-the-person-who-wrote'")
      const withoutFirstReader = whole.slice(0, from) + whole.slice(to)
      const factsFrom = withoutFirstReader.indexOf('private factsForTheTurnBlock(')
      expect(factsFrom).toBeGreaterThan(-1)
      const factsTo = withoutFirstReader.indexOf('\n  }\n', factsFrom)
      const facts = withoutFirstReader.slice(factsFrom, factsTo)
      expect(facts).toContain('composeWhatEachPieceIsWaitingOn(raw, waits)')
      expect(facts).not.toContain('publishOurs(')
      expect(facts).not.toContain('session.handle.')
      const withoutFacts =
        withoutFirstReader.slice(0, factsFrom) + withoutFirstReader.slice(factsTo)
      const classifyFrom = withoutFacts.indexOf('private reconciliationReading(')
      expect(classifyFrom).toBeGreaterThan(-1)
      const classifyTo = withoutFacts.indexOf('\n  }\n', classifyFrom)
      const classifier = withoutFacts.slice(classifyFrom, classifyTo)
      expect(classifier).toContain("folded.state !== 'waiting-on-purpose'")
      expect(classifier).toContain("disposition: 'waiting', validWait: true")
      expect(classifier).not.toContain('publishOurs(')
      expect(classifier).not.toContain('session.handle.')
      const host = withoutFacts.slice(0, classifyFrom) + withoutFacts.slice(classifyTo)
      for (const wait of TASK_WAITS) {
        expect(host, `a door compares against '${wait}'`).not.toContain(`=== '${wait}'`)
        expect(host, `a door refuses on '${wait}'`).not.toContain(`!== '${wait}'`)
      }
      // ⚠️ **THE POSITIVE CONTROL**: the host really does compare states against string literals
      // elsewhere, so the negatives above are about these words and not about a shape this file
      // never uses.
      expect(host).toMatch(/=== 'live'|=== 'working'|=== 'idle'/)
    })
  })
})
