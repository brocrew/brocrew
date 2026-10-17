import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset, ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  REQUEST_IS_OPEN,
  REQUEST_STATES,
  openQuestionsByWork,
  type RaisedQuestion,
  type RoutedRequest,
} from '../src/shared/questions'
import {
  TASK_IS_OPEN,
  TASK_STALL_CAUSES,
  TASK_STATES,
  TASK_WAITS,
  UNDRIVEN_SENTENCES,
  WAITING_STANDS_FOR,
  composeWhatEachPieceIsWaitingOn,
  derivePieces,
  stalledWithACause,
  type PieceRow,
  type WhatAConversationIsWaitingOn,
} from '../src/shared/tasks'
import { WORK_STATE_WORD, workReading } from '../src/renderer/src/lib/work-report'
import type {
  PersistedEventInfo,
  RuntimeEventMessage,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * 🔴 **603 · waiting on an answer is not stalled** — `HO-018` §2.1, `HO-085`, `HO-091` §1.
 *
 * ## ⚑ The property
 *
 * > **A worker whose question nobody has answered reads as ASKING, on every surface that reports a
 * > task's state — and a worker nothing is driving still reads as STALLED.**
 *
 * ## ⛔ Why the vocabulary had to gain a member rather than a surface gaining a filter
 *
 * ⚠️ **`437` wrote the argument down rather than omitting a state**, and `591` re-derived it rather
 * than assuming it: *"A verb that returned immediately would end the turn, and the fold would then
 * say `stalled` with `turn_ended`: 'its turn ended and it replied nothing', which is FALSE of a
 * worker that asked."* ⛔ So `ask_parent` HELD the turn, and the hold was the only thing standing
 * between a parent and that sentence.
 *
 * 🔴 **608 · the hold is GONE and this composition is what stands in its place** (`HO-084` §4,
 * unblocked by this dispatch). ⛔ **A worker that asks now ends its turn**, `derivePieces` writes
 * `stalled`/`turn_ended` exactly as `437` predicted, and every surface reads `asking` over it.
 * ⚑ §3's sequence is unchanged and its premise is: it used to need the five-minute bound to expire
 * before a turn could end under an open question, and now that is simply what happens.
 *
 * ## ⚠️ Where the readings diverge, which is where every section is written
 *
 *  - **§1** the FOLD, untouched — `400`'s rule is kept rather than relaxed, and the assertion
 *    `437` wrote against a fourth state is re-aimed rather than deleted.
 *  - **§2** the composition, pure — both arms, with a planted control that differs in ONE fact.
 *  - **§3** the live sequence — a real ask, a real turn ending, and the two workers read in ONE
 *    call so the control is trapped the way the subject is.
 *  - **§4** the surfaces AGREE — the same task, read three ways, says the same word.
 *  - **§5** one derivation — the door that ENDS a question and the read that reports it resolve the
 *    same set, measured by ending one and watching the word move.
 *  - **§6** the censuses — the vocabulary, the words, and every surface that reports a state.
 *
 * ⚑ **Real host, real SQLite, real migrations, real tools.**
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const hostSource = join(here, '../src/main/runtime/runtime-host.ts')
const storeSource = join(here, '../src/main/db/session-store.ts')

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  readonly alive = true
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
    return handle
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

/**
 * ⚠️ **Prose quotes code all over this repository, so a census that COUNTS has to read the code
 * only** — `a-source-census-must-strip-prose-before-it-asserts`.
 */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')

describe('603 · waiting on an answer is not stalled', () => {
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
  let claimed: Set<string>
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

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-603-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-603-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handed = []
    issued = new FakeProviderSessions()
    // ⚑ **608 · this suite used to shorten `deps.askBoundMs` to 120 ms so the ask would give up
    // inside a test** (HO-084 §4). ⛔ **There is no bound to shorten**: `ask_parent` returns as
    // soon as its rows are written, so §3's sequence is now the ordinary one rather than one this
    // file had to provoke — which is the whole of what `608` did to `603`'s subject.
    host = buildHost()
    window = new RecordingSink('webContents:1')
    claimed = new Set<string>()
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      {
        provider: 'claude',
        profileId,
        approvalMode: 'ask',
        cwd: root,
      },
      window,
    )
    return sessionId
  }

  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens(profileId)
    await host.close(id, window)
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

  const toolsOf = (sessionId: string): AgentToolset => agentToolsFor(host, sessionId)

  /** ⚑ **The TEXT a model reads**, which is a different half of the answer from `structured`. */
  const textOf = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<string> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return String((await tool.call(args)).text ?? '')
  }

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    const until = Date.now() + 4_000
    while (Date.now() < until) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  const cardOn = async (sessionId: string): Promise<string> => {
    await waitFor(
      () => ledger(sessionId).some((event) => event.type === 'permission_request'),
      'the card the turn parks on',
    )
    const asked = ledger(sessionId)
      .filter((event) => event.type === 'permission_request')
      .at(-1)
    if (asked === undefined || asked.type !== 'permission_request') {
      throw new Error('no permission request on the ledger')
    }
    return asked.id
  }

  /** Answer the open card so the turn runs to its own terminal (`379`'s helper, unchanged). */
  // Cancelled turns isolate question composition from the ordinary turn-end reminder.
  const letTheTurnFinish = async (sessionId: string): Promise<void> => {
    const before = ledger(sessionId).filter((event) => event.type === 'turn').length
    const id = await cardOn(sessionId)
    if (!claimed.has(sessionId)) {
      host.claimSession(sessionId, window)
      claimed.add(sessionId)
    }
    await host.respondPermission(sessionId, id, { outcome: 'cancel' }, window)
    await waitFor(
      () => ledger(sessionId).filter((event) => event.type === 'turn').length > before,
      'the turn to reach its own terminal',
    )
  }

  const pieceGivenTo = (worker: string): PieceRow => {
    const row = store.piecesOwnedBy(worker).at(-1)
    if (row === undefined) throw new Error(`no piece in ${worker}`)
    return row
  }

  /**
   * ⚑ **A PM with TWO children, each holding one piece of work** — the control is planted with the
   * subject and is read in the SAME call, which is `a-control-must-be-trapped-the-way-the-subject-
   * is`. ⛔ Two workers rather than two pieces on one worker, because a second give to a busy child
   * is HELD and the held row would derive `waiting`, which is a different state and a different
   * measurement.
   *
   * ⚑ **D-016 · each is started by a give**, and the brief is its first turn — which parks on the
   * Fake's card (the PM's `ask`), as the `work` message it replaces did.
   */
  const aPmAndTwoWorkers = async (): Promise<{
    pm: string
    asks: string
    quiet: string
    asksTask: string
    quietTask: string
    asksLabel: string
    quietLabel: string
  }> => {
    // ⛔ **TWO identities, because a second give to one identity from one parent reaches the
    // conversation the first one started** — the control has to be a different agent.
    for (const slug of ['worker-a', 'worker-b']) await bringIdentityIntoBeing(slug)
    const pm = await personOpens('pm')
    const pmTools = theToolsetJustHandedOut()
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
    const asks = await give('worker-a', 'the work a question will be raised about')
    const quiet = await give('worker-b', 'the work nobody asks about')
    await waitFor(
      () => store.piecesOwnedBy(asks).length === 1 && store.piecesOwnedBy(quiet).length === 1,
      'both pieces of work to reach their workers',
    )
    return {
      pm,
      asks,
      quiet,
      asksTask: pieceGivenTo(asks).piece,
      quietTask: pieceGivenTo(quiet).piece,
      asksLabel: pieceGivenTo(asks).label,
      quietLabel: pieceGivenTo(quiet).label,
    }
  }

  /**
   * 🔴 **The sequence the whole dispatch is about, performed once and read by every section**:
   * one worker asks, BOTH turns end, and neither question is answered.
   *
   * ⚑ **608 · the middle step is gone and the sequence did not change** (HO-084 §4). ⛔ It used to
   * read *one worker asks, the bound expires, both turns end* — the expiry being the only way a
   * worker that asked could reach the end of its turn while `437`'s hold stood. ⚠️ **Now the call
   * returns and the turn simply ends**, which is what `603` was built for: the fold says `stalled`
   * over exactly this ledger and every surface says `asking`.
   */
  const oneAsksAndBothTurnsEnd = async (): Promise<{
    pm: string
    asks: string
    quiet: string
    asksTask: string
    quietTask: string
    asksLabel: string
    quietLabel: string
  }> => {
    const made = await aPmAndTwoWorkers()
    const said = await callOn(toolsOf(made.asks), 'ask_question', {
      who_answers: 'the-parent',
      piece: made.asksLabel,
      question: 'which of the two?',
    })
    expect(said.outcome, JSON.stringify(said)).toBe('ok')
    // ⛔ **608 · the call reports the ASK and says nothing about an answer** (HO-084 §4). ⚠️ It
    // used to carry `answered: false` and `question_is: 'open'`, which were `437`'s and `591`'s
    // answers to *what did the wait meet* — and a wait that does not happen meets nothing.
    expect(said.answered).toBeUndefined()
    expect(said.question_is).toBeUndefined()
    expect(said.question).toEqual(expect.any(String))
    for (const worker of [made.asks, made.quiet]) await letTheTurnFinish(worker)
    return made
  }

  const at = (ordinal: number, event: TranscriptEvent): PersistedEventInfo => ({
    ordinal,
    at: 1_000 + ordinal,
    event,
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * 🔴 **§1 · the FOLD is untouched, and that is `400`'s rule kept rather than relaxed.**
   *
   * ⛔ **`400`, at the fold's own `travelled` set:** *"Ids only: what became of each one is
   * `deriveRoutedRequests`' answer and this fold must not grow a second opinion about it."*
   * ⚑ Whether a question is still open IS that answer, so the fold may not learn it — and the
   * proof is that `derivePieces` still says `stalled` over exactly the ledger §3 composes to
   * `asking`.
   */
  describe('§1 · derivePieces cannot produce the new state and must not learn to', () => {
    it('⛔ a question outstanding moves nothing in the fold, and the turn ending still stalls it', () => {
      const assigned = at(1, {
        type: 'work_given',
        piece: 'work_1',
        label: 'W1.1',
        parent: 'work_root',
        givenBy: 'sess_pm',
        title: 'the thing',
        brief: 'do the thing',
      })
      const asked = at(2, {
        type: 'question_asked',
        requestId: 'req_1',
        piece: 'work_1',
        label: 'W1.1',
        prompt: 'which?',
        questions: [{ id: 'answer', prompt: 'which?', options: [] }],
      })
      const routed = at(3, {
        type: 'request_routed',
        requestId: 'req_1',
        to: 'the-parent',
        parent: 'sess_pm',
      })
      const ended = at(4, { type: 'turn', state: 'completed' })
      // ⚑ **`437`'s own pair, unchanged**: with the question and without it, the fold agrees.
      expect(derivePieces('sess_w', [assigned, asked, routed])[0]?.state).toBe('working')
      const both = derivePieces('sess_w', [assigned, asked, routed, ended])[0]
      expect(both?.state).toBe('stalled')
      expect(both?.stalledBecause).toBe('turn_ended')
      // ⛔ **And no prefix of that ledger folds to the new member.** A fold taught to suppress the
      // stall while a question is open is the second opinion `400` forbids, and it would pass every
      // assertion in §2 while breaking this one.
      const prefixes = [assigned, asked, routed, ended].map((_, index) =>
        derivePieces('sess_w', [assigned, asked, routed, ended].slice(0, index + 1)),
      )
      expect(prefixes.flat().map((row) => row.state)).not.toContain('waiting-on-an-answer')
      // ⚑ **And the prefixes really did reach the states this claims to have looked at** — a
      // negative over a list of empty folds would pass for the wrong reason.
      expect(new Set(prefixes.flat().map((row) => row.state))).toEqual(
        new Set(['working', 'stalled']),
      )
    })

    it('🔴 437 · `no member was added to TASK_STATES` is RE-AIMED, not deleted — the fold still reaches neither', () => {
      // ⛔ **`437` §1 asserted the vocabulary had gained nothing, and `HO-018` §2.1 · `HO-085` §6 ·
      // `HO-091` §1 are the rulings that reverse it** — standing rule 19: find the ruling, open it,
      // and say what the sentence was a claim ABOUT. ⚑ What `437` was protecting is the clause
      // below it, which is untouched: the ASK reaches neither table, because nothing in
      // `raiseAQuestion` writes a task state and `derivePieces` has no branch that could.
      // ⚠️ **609 · re-aimed for the rename and its two new neighbours.** `asking` became
      // `waiting-on-an-answer` so the family reads as a set; what `437` was protecting is below.
      expect([...TASK_STATES]).toContain('waiting-on-an-answer')
      expect(TASK_IS_OPEN['waiting-on-an-answer']).toBe(true)
      const host = readFileSync(hostSource, 'utf8')
      const asking = code(host).slice(
        code(host).indexOf('async raiseAQuestion('),
        code(host).indexOf('\n  }\n', code(host).indexOf('async raiseAQuestion(')),
      )
      expect(asking.length, 'the slice found no raiseAQuestion body').toBeGreaterThan(400)
      // ⛔ **The verb writes no state and reads no task fold to decide one.**
      for (const state of TASK_STATES) expect(asking).not.toContain(`'${state}'`)
      expect(asking).not.toContain('composeWhatEachPieceIsWaitingOn')
      // ⚑ **And the fold cannot reach the request derivation at all** — `400`'s rule as an IMPORT
      // census rather than as a word count.
      //
      // ⛔ **A word census was written here first and it was the wrong instrument.** `answered` and
      // `withdrawn` are members of BOTH vocabularies and `interrupted` is a TURN state, so
      // `not.toContain("'interrupted'")` was asserting something false about code that is right —
      // `a-file-level-contains-cannot-tell-sibling-declarations-apart`, and
      // `derive-a-roster-from-the-import-not-the-mention` is the shape that answers it.
      const fold = readFileSync(join(here, '../src/shared/tasks.ts'), 'utf8')
      const imported = [...code(fold).matchAll(/import[\s\S]*?from '([^']+)'/g)]
      expect(imported.length, 'the import census found no imports').toBeGreaterThan(2)
      const fromQuestions = imported.filter((one) => one[1] === './questions')
      // ⚠️ **One import and it is a TYPE**, which carries no derivation into this module: a value
      // import of `REQUEST_IS_OPEN` or `deriveRoutedRequests` is exactly the second opinion `400`
      // forbids, and it would appear here.
      expect(fromQuestions).toHaveLength(1)
      expect(fromQuestions[0]?.[0]).toBe("import type { WorkInHand } from './questions'")
    })
  })

  /**
   * 🔴 **§2 · the composition, as a pure function, with BOTH arms and a planted control.**
   *
   * ⛔ **`a-comparison-tested-where-both-sides-agree` is the failure mode the brief named**, so
   * every case below is a pair that differs in ONE fact.
   */
  describe('§2 · a waiting worker is not stalled, and a stalled one still is', () => {
    // ⚑ **609 · the source shape the composition now takes**, with the two new facts held at
    // `false` so this section goes on measuring the ANSWER arm alone — `609`'s own suite is where
    // the other two are exercised, and a helper that set them would make these tests pass for a
    // reason they are not about.
    const askedAbout = (ids: readonly string[]) => (): WhatAConversationIsWaitingOn => ({
      answers: new Set(ids),
      aPerson: false,
      // ⚑ **D-016** — the worker arm is per piece now, held empty for the same reason.
      childrenOpen: new Set<string>(),
    })

    const rowsFor = (states: readonly PieceRow['state'][]): readonly PieceRow[] =>
      states.map((state, index) => ({
        piece: `work_${String(index + 1)}`,
        label: `W1.${String(index + 1)}`,
        parent: 'work_root',
        title: 'work',
        brief: 'work',
        giver: 'sess_pm',
        owner: 'sess_w',
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
      }))

    it('⛔ the same two rows, one asked about and one not — and ONE fact is the difference', () => {
      const rows = rowsFor(['stalled', 'stalled'])
      const composed = composeWhatEachPieceIsWaitingOn(rows, askedAbout(['work_1']))
      expect(composed[0]?.state).toBe('waiting-on-an-answer')
      expect(composed[1]?.state).toBe('stalled')
      // ⚑ **The control is not merely unchanged, it still carries its cause** — a composition that
      // cleared the fields for everybody would pass the first assertion and lose the second.
      expect(composed[1]?.stalledBecause).toBe('turn_ended')
      expect(stalledWithACause(composed[1] as PieceRow)).toBe(true)
      // ⛔ **And with NOTHING asked about, both stay stalled** — the positive assertion differs
      // from the default, which `a-positive-assertion-must-differ-from-the-default` asks for.
      expect(composeWhatEachPieceIsWaitingOn(rows, askedAbout([])).map((one) => one.state)).toEqual(
        ['stalled', 'stalled'],
      )
    })

    it('🔴 the stall fields are CLEARED, because `stalledBecause` is non-null if and only if the state is `stalled`', () => {
      const composed = composeWhatEachPieceIsWaitingOn(rowsFor(['stalled']), askedAbout(['work_1']))
      const one = composed[0] as PieceRow
      expect(one.state).toBe('waiting-on-an-answer')
      expect(one.stalledBecause).toBeNull()
      expect(one.stalledAt).toBeNull()
      expect(one.stalledBy).toBeNull()
      // 🔴 **Which is what carries the rule into every reader of the shared predicate for free** —
      // see `stalledWithACause`, whose two arms are a stall notice to an AGENT and one to a PERSON.
      expect(stalledWithACause(one)).toBe(false)
    })

    it('⚑ EVERY open state composes and no closed one does — driven over the vocabulary, never a literal list', () => {
      // ⛔ **`a-loop-over-a-literal-variant-list-is-not-exhaustive`**: a sixth state gains a case
      // here with the constant, and the table below is the rule rather than five examples.
      for (const state of TASK_STATES) {
        if (state === 'waiting-on-an-answer') continue
        const composed = composeWhatEachPieceIsWaitingOn(rowsFor([state]), askedAbout(['work_1']))
        expect(composed[0]?.state, `${state} composed wrongly`).toBe(
          TASK_IS_OPEN[state] ? 'waiting-on-an-answer' : state,
        )
      }
      // ⚠️ **A closed piece is never touched** — a question outlives the work it was about
      // (`workNamed`'s own rule), and a row that said *waiting on an answer* about answered work
      // would be this app claiming the work is unfinished.
      expect(
        composeWhatEachPieceIsWaitingOn(rowsFor(['answered']), askedAbout(['work_1']))[0]?.outcome,
      ).toBe('done')
    })

    it('⛔ the lookup is asked of the conversation HOLDING the work, and never of the one that gave it', () => {
      const asked: string[] = []
      composeWhatEachPieceIsWaitingOn(rowsFor(['working']), (id) => {
        asked.push(id)
        return {
          answers: new Set<string>(),
          aPerson: false,
          childrenOpen: new Set<string>(),
        }
      })
      expect(asked).toEqual(['sess_w'])
      // ⛔ **`ask_parent` writes its question into the WORKER's own ledger**, so asking the giver
      // would walk the edge the wrong way and answer about the parent's own questions.
      expect(asked).not.toContain('sess_pm')
    })

    it('⚠️ a closed row costs NO read at all, which is the cost sentence rather than a claim about it', () => {
      const asked: string[] = []
      // ⚑ **D-016, commit 5 · every closed state**, the giver's close among them.
      composeWhatEachPieceIsWaitingOn(rowsFor(['answered', 'withdrawn', 'closed']), (id) => {
        asked.push(id)
        return {
          answers: new Set<string>(),
          aPerson: false,
          childrenOpen: new Set<string>(),
        }
      })
      expect(asked).toEqual([])
    })
  })

  /**
   * 🔴 **§3 · the live sequence — a real ask, a real bound, a real turn ending.**
   *
   * ⛔ **This is the half that is a defect TODAY and not only B1's prerequisite.**
   */
  describe('§3 · the bound ends the call, the turn ends, and the question is still open', () => {
    it('🔴 the fold says `stalled`/`turn_interrupted` and every surface says `asking` — same ledger, same moment', async () => {
      const { asks, asksTask, quiet, quietTask } = await oneAsksAndBothTurnsEnd()
      // ⚑ **The premise, asserted rather than assumed**: without the composition this parent is
      // told *its turn ended and it replied nothing* about a worker that asked it a question.
      const raw = store.piecesOwnedBy(asks).find((one) => one.piece === asksTask)
      expect(raw?.state).toBe('stalled')
      expect(raw?.stalledBecause).toBe('turn_interrupted')
      // ⚑ **And the question really is still answerable** — `591`'s ruling, which is what makes the
      // composed word true rather than optimistic.
      const open = store.routedRequestsOf(asks).filter((one) => one.went.is === 'the-parent')
      expect(open).toHaveLength(1)
      expect(REQUEST_IS_OPEN[open[0]?.state ?? 'answered']).toBe(true)

      // ⚑ **D-016 · the worker's own board** — `pieceBoard`'s `hold` (it was `tasksVisibleTo`'s
      // `given`).
      const held = host.pieceBoard(asks).hold
      expect(held.find((one) => one.piece === asksTask)?.state).toBe('waiting-on-an-answer')
      // ⛔ **The CONTROL, trapped the same way**: the other worker's turn ended in the same loop,
      // it was never asked about, and it still reads `stalled`.
      const control = store.piecesOwnedBy(quiet).find((one) => one.piece === quietTask)
      expect(control?.state).toBe('stalled')
      expect(host.pieceBoard(quiet).hold.find((one) => one.piece === quietTask)?.state).toBe(
        'stalled',
      )
    })

    it('⚑ the PARENT reads both rows in ONE call, and they differ only by the question', async () => {
      const { pm, asksTask, quietTask } = await oneAsksAndBothTurnsEnd()
      const assigned = host.pieceBoard(pm).gave
      const byId = new Map(assigned.map((one) => [one.piece, one]))
      expect(byId.get(asksTask)?.state).toBe('waiting-on-an-answer')
      expect(byId.get(quietTask)?.state).toBe('stalled')
      expect(byId.get(quietTask)?.stalledBecause).toBe('turn_interrupted')
      // ⚠️ **Both are still OPEN**, so neither has been closed by any of it — HO-018 §2's
      // principle, which the new member is inside rather than beside.
      expect(assigned.every((one) => TASK_IS_OPEN[one.state])).toBe(true)
    })

    it('⛔ while the worker is still WORKING the word is already `asking`, not `working`', async () => {
      // 🔴 **The half of the defect a hold could never have fixed**: a parent reading `working`
      // about a worker waiting on the PARENT is being told a child is busy when it is the parent's
      // move. ⚑ Measured with the turn still OPEN, which is the arm of §3 where the fold and the
      // composition disagree in the other direction — `stalled` vs `asking` is the one below.
      //
      // ⚠️ **608 · the title said *still INSIDE the call*, and that state no longer exists**
      // (HO-084 §4, standing rule 8.1). ⛔ The ask returns at once, so what keeps the turn open
      // here is the worker carrying on — which is what a worker does after asking now, and is why
      // this arm is the ORDINARY one rather than the held one.
      const made = await aPmAndTwoWorkers()
      const said = await callOn(toolsOf(made.asks), 'ask_question', {
        who_answers: 'the-parent',
        piece: made.asksLabel,
        question: 'which of the two?',
      })
      expect(said.outcome, JSON.stringify(said)).toBe('ok')
      // ⚑ **The routing row is already there when the call comes back** — there is no window in
      // which a worker has asked and the ledger does not say so, which is what `394`'s three
      // writes buy now that nothing waits behind them.
      expect(store.routedRequestsOf(made.asks).some((one) => one.went.is === 'the-parent')).toBe(
        true,
      )
      expect(store.piecesOwnedBy(made.asks).find((one) => one.piece === made.asksTask)?.state).toBe(
        'working',
      )
      expect(
        host.pieceBoard(made.asks).hold.find((one) => one.piece === made.asksTask)?.state,
      ).toBe('waiting-on-an-answer')
    })
  })

  /**
   * 🔴 **§4 · the two surfaces AGREE — `HO-091` §2's whole argument, made impossible to regress.**
   *
   * ⛔ **`HO-091` §2:** *"Do not ship the disagreement… One surface composes and one does not, so
   * they differ by construction."* ⚑ And `ProjectWorkRow`'s own docblock names the shape: *an
   * exception made at one depth of a walk, with the project read the likelier of the two to be the
   * one a supervisor actually calls.*
   */
  describe('§4 · the same task, read every way a surface reports a state, says the same word', () => {
    it('🔴 `list_tasks` and the Work tab agree — on the subject AND on the control', async () => {
      // ⚠️ **D-016 · `list_projects` was the third surface here, and it went with projects.**
      const { pm, asksTask, quietTask } = await oneAsksAndBothTurnsEnd()
      const fromTasks = new Map(host.pieceBoard(pm).gave.map((one) => [one.piece, one.state]))
      const fromTheWorkTab = new Map(
        store.workGivenOutBy(pm).rows.map((one) => [one.piece, one.state]),
      )
      for (const [piece, word] of [
        [asksTask, 'waiting-on-an-answer'],
        [quietTask, 'stalled'],
      ] as const) {
        expect(fromTasks.get(piece), `list_tasks disagrees about ${piece}`).toBe(word)
        expect(fromTheWorkTab.get(piece), `the Work tab disagrees about ${piece}`).toBe(word)
      }
      // ⛔ **Every task in the database, not only the two this test planted** — a fourth surface
      // that forgets the composition is caught by the loop rather than by somebody remembering.
      expect([...fromTheWorkTab.keys()].sort()).toEqual([...fromTasks.keys()].sort())
      for (const [piece, word] of fromTasks) {
        expect(fromTheWorkTab.get(piece)).toBe(word)
      }
    })

    it("🔴 the line a MODEL reads carries the FACT and not only the word — `pieceText`'s own rule", async () => {
      const { pm, asks, asksLabel, quietLabel } = await oneAsksAndBothTurnsEnd()
      const said = await textOf(toolsOf(pm), 'list_tasks', {})
      // ⚑ **D-016 · a piece's line opens on its label** (`W1.2 · title`), not on an id.
      const lineFor = (label: string): string => {
        const found = said.split('\n').find((line) => line.includes(`${label} · `))
        if (found === undefined) throw new Error(`no line for ${label} in:\n${said}`)
        return found
      }
      // ⛔ **The state name AND the fact it stands for** — *"a reader deciding what to do next needs
      // the fact"*, which is why the five stall causes have sentences and why this member owes one.
      expect(lineFor(asksLabel)).toContain('· waiting-on-an-answer')
      expect(lineFor(asksLabel)).toContain(WAITING_STANDS_FOR['waiting-on-an-answer'])
      // ⚑ **The CONTROL still reads its own cause**, so the arm that fired is the state's and not
      // a blanket rewrite of the parenthetical.
      expect(lineFor(quietLabel)).toContain('· stalled')
      expect(lineFor(quietLabel)).toContain(UNDRIVEN_SENTENCES.turn_interrupted.replace(/\.$/, ''))
      expect(lineFor(quietLabel)).not.toContain(WAITING_STANDS_FOR['waiting-on-an-answer'])
      // ⚠️ **And the WORKER's own list says it too** — the same composition, the other direction,
      // which is what a resumed worker reads to find out what it is still waiting on.
      const mine = await textOf(toolsOf(asks), 'list_tasks', {})
      expect(mine).toContain(WAITING_STANDS_FOR['waiting-on-an-answer'])
    })

    it('⚑ the word a PERSON reads on the Work tab comes from the same table the state does', async () => {
      const { pm, asksTask, quietTask } = await oneAsksAndBothTurnsEnd()
      const rows = new Map(store.workGivenOutBy(pm).rows.map((one) => [one.piece, one]))
      const asking = rows.get(asksTask)
      const stalled = rows.get(quietTask)
      expect(asking).toBeDefined()
      expect(workReading(asking as never).word).toBe(WORK_STATE_WORD['waiting-on-an-answer'])
      // ⛔ **And the stalled row still draws its CAUSE rather than its state word** — `WorkReading`'s
      // own rule, which the clearing in §2 is what keeps true.
      expect(workReading(stalled as never).word).not.toBe(WORK_STATE_WORD.stalled)
      expect(workReading(stalled as never).word).toContain('was stopped')
    })
  })

  /**
   * 🔴 **§4.5 · the two NOTICE readers — the half that WRITES rather than reads.**
   *
   * ⛔ **`stalledWithACause`'s own docblock requires the two to be complements of each other and
   * never overlap** — one decides whether an AGENT is owed a notice, the other whether a PERSON is
   * — so composing one and not the other would break the property it names. ⚑ Neither needed a new
   * condition: the composition clears the cause with the state, so an `asking` row falls out of the
   * shared predicate on its own.
   */
  describe('§4.5 · a worker waiting on an answer is not PUSHED as having said nothing', () => {
    it('ordinary ending pairs with the interrupted composition: only the quiet child reaches the giver', async () => {
      const made = await aPmAndTwoWorkers()
      const asked = await callOn(toolsOf(made.asks), 'ask_question', {
        who_answers: 'the-parent',
        piece: made.asksLabel,
        question: 'Which fictional option?',
      })
      expect(asked.outcome).toBe('ok')
      const admission = host as unknown as { reconciliationMayWake(target: string): boolean }
      const original = admission.reconciliationMayWake.bind(host)
      vi.spyOn(admission, 'reconciliationMayWake').mockImplementation(
        (target) => ![made.asks, made.quiet].includes(target) && original(target),
      )
      for (const worker of [made.asks, made.quiet]) {
        const id = await cardOn(worker)
        host.claimSession(worker, window)
        await host.respondPermission(worker, id, { outcome: 'allow' }, window)
      }
      await waitFor(
        () =>
          store
            .reconciliationReceipts(made.quiet, made.quietTask)
            .some((row) => row.step === 'giver' && row.outcome === 'delivered'),
        'the quiet child giver notice',
      )
      for (const [worker, piece] of [
        [made.asks, made.asksTask],
        [made.quiet, made.quietTask],
      ] as const)
        expect(store.piecesOwnedBy(worker).find((row) => row.piece === piece)).toMatchObject({
          state: 'stalled',
          stalledBecause: 'turn_ended',
        })
      const board = new Map(host.pieceBoard(made.pm).gave.map((row) => [row.piece, row.state]))
      const tab = new Map(store.workGivenOutBy(made.pm).rows.map((row) => [row.piece, row.state]))
      expect(board.get(made.asksTask)).toBe('waiting-on-an-answer')
      expect(board.get(made.quietTask)).toBe('stalled')
      expect(tab).toEqual(board)
      expect(store.reconciliationReceipts(made.asks, made.asksTask)).toEqual([])
      expect(store.reconciliationReceipts(made.quiet, made.quietTask)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ step: 'holder', outcome: 'failed' }),
          expect.objectContaining({ step: 'giver', outcome: 'delivered' }),
        ]),
      )
      expect(ledger(made.pm).filter((row) => row.type === 'work_stall_told')).toEqual([])
      expect(
        ledger(made.pm).filter(
          (row) => row.type === 'message_queued' && row.appNotice === 'a-work-wait-needs-attention',
        ),
      ).toHaveLength(1)
      expect(host.stalledWorkForAPerson().rows.map((row) => row.piece)).not.toContain(made.asksTask)
    })

    it('🔴 the parent is told about the quiet worker and NOT about the one waiting on it', async () => {
      const { pm, asksTask, quietTask } = await oneAsksAndBothTurnsEnd()
      const said = ledger(pm)
        .filter((event) => event.type === 'message_queued' || event.type === 'user_turn')
        .map((event) => JSON.stringify(event))
        .join('\n')
      // ⚑ **The CONTROL fired**, which is what makes the negative below a measurement — a push that
      // reached nobody at all would satisfy the second assertion for the wrong reason.
      expect(said, 'the stall notice never reached the parent at all').toContain(quietTask)
      // ⛔ **And the worker that asked is not in it.** Before `603` this said *its turn ended and it
      // replied nothing* about a child waiting on an answer THIS parent can still give — `HO-019`
      // §1's product defect, written into a parent's own transcript.
      expect(said).not.toContain(asksTask)
      expect(said).not.toContain(UNDRIVEN_SENTENCES.turn_interrupted.replace(/\.$/, '') + ' ')
    })

    it("⚑ the PERSON's queue does not list the one waiting on an answer", async () => {
      const { pm, asksTask, quietTask } = await oneAsksAndBothTurnsEnd()
      // ⚠️ **Asked of the STORE**, which is the reader `persons-queue` draws from and the one whose
      // own docblock says it runs every five seconds for the life of a window.
      const waiting = store.stalledWorkNobodyWasToldAbout().rows.map((one) => one.piece)
      expect(waiting).not.toContain(asksTask)
      // ⛔ **The control has to be SOMEWHERE**, and both places are a true answer about the quiet
      // task: a person still owes it, or the parent was told and its receipt took the row out.
      // ⚑ Neither is true of the asking one, which is what this pair measures — a queue that was
      // simply empty would satisfy the line above for the wrong reason.
      const told = ledger(pm)
        .map((event) => JSON.stringify(event))
        .join('\n')
      expect(
        waiting.includes(quietTask) || told.includes(quietTask),
        'the control is in neither the queue nor the parent’s ledger',
      ).toBe(true)
    })
  })

  /**
   * 🔴 **§5 · ONE derivation, and the measurement is that ending a question moves the word.**
   *
   * ⛔ **The questions fold that a take-back ends and the composition both resolve
   * {@link openQuestionsByWork}.** ⚑ A second copy of that pair is how a piece would go on reading
   * `waiting-on-an-answer` about a question the take-back door had already ended. ⚑ **D-016** — it
   * was `RuntimeHost.endTheQuestionsAbout`; `work_taken_back` ends them in `deriveRoutedRequests`.
   */
  describe('§5 · the door that ends a question and the read that reports it are one derivation', () => {
    it('⛔ taking the work back ends the question AND the task stops waiting on an answer, in one act', async () => {
      const { pm, asks, asksTask, asksLabel } = await oneAsksAndBothTurnsEnd()
      expect(host.pieceBoard(asks).hold.find((one) => one.piece === asksTask)?.state).toBe(
        'waiting-on-an-answer',
      )
      const took = await callOn(toolsOf(pm), 'withdraw_task', { piece: asksLabel })
      expect(took.outcome, JSON.stringify(took)).toBe('ok')
      // ⚑ **`591`'s ending, written by the door** — and the composition can no longer see it.
      // ⚠️ **D-016 · the take-back TELLS the owner** (`a-piece-taken-back`), which is a turn of its
      // own and parks on the Fake's card — so the read is narrowed to the QUESTION it asked.
      expect(
        store
          .routedRequestsOf(asks)
          .filter((one) => one.went.is === 'the-parent' && REQUEST_IS_OPEN[one.state]),
      ).toHaveLength(0)
      expect(store.routedRequestsOf(asks).some((one) => one.went.is === 'the-parent')).toBe(true)
      // ⚑ **D-016** — a piece taken back is no longer one its owner holds, so it is read off the
      // owner's own fold.
      expect(store.piecesOwnedBy(asks).find((one) => one.piece === asksTask)?.state).toBe(
        'withdrawn',
      )
    })

    it('⚑ an ANSWER ends it too, and the word goes back to what the fold says', async () => {
      const { pm, asks, asksTask } = await oneAsksAndBothTurnsEnd()
      const waiting = host
        .questionsWaitingOn(pm)
        .filter((one) => one.request.went.is === 'the-parent')
      expect(waiting).toHaveLength(1)
      const cards = (): number =>
        ledger(asks).filter((event) => event.type === 'permission_request').length
      const cardsBefore = cards()
      const answered = await host.answerQuestion(
        {
          questionId: waiting[0]?.request.requestId ?? '',
          answers: [{ part: 'answer', answer: ['this one'] }],
        },
        { ownerId: `agent:${pm}` },
      )
      expect(answered.ok, JSON.stringify(answered)).toBe(true)
      // ⚑ **D-017 · R1 — the answer is DELIVERED before the door returns**, so the asker is already
      // at work on it: the word is the fold's own, and the fold says `working`.
      const row = host.pieceBoard(asks).hold.find((one) => one.piece === asksTask)
      expect(row?.state).toBe(pieceGivenTo(asks).state)
      expect(row?.state).toBe('working')
      // 🔴 **Back to `stalled`, with its cause intact, once that turn ends** — the composition is a
      // READ and latches nothing, which is what lets the answer be the thing that moves the word.
      // ⚠️ `letTheTurnFinish` answers the LAST card, and the answered one is already there — so the
      // answer's own turn is waited on to park first.
      await waitFor(() => cards() > cardsBefore, 'the card the answer’s turn parks on')
      await letTheTurnFinish(asks)
      const after = host.pieceBoard(asks).hold.find((one) => one.piece === asksTask)
      expect(after?.state).toBe('stalled')
      expect(after?.stalledBecause).toBe('turn_interrupted')
    })

    it('🔴 a PERMISSION card can never make work read as `asking`, and that is the wire rather than a filter', () => {
      const requests: readonly RoutedRequest[] = [
        {
          requestId: 'ui_1',
          askedBy: 'sess_w',
          parent: 'sess_pm',
          went: {
            is: 'the-person-the-channel-left-it-with',
            to: 'a-person',
            because: 'a-permission-decision',
          },
          at: 1,
          state: 'open',
          endedAt: null,
          escalatedAt: null,
        },
        {
          requestId: 'req_1',
          askedBy: 'sess_w',
          parent: 'sess_pm',
          went: { is: 'the-parent', to: 'the-parent' },
          at: 2,
          state: 'open',
          endedAt: null,
          escalatedAt: null,
        },
      ]
      const raised = new Map<string, RaisedQuestion>([
        // ⛔ **`430` measured that a provider-raised question names no piece**, so this is the wire's
        // own `null` and never a filter written here.
        // ⚑ **602 · `raisedBy` is the row's own type**, and the two fixtures differ on it exactly
        // as the wire does: a provider's card and this app's own question.
        // ⚑ **611 · `passedUpFrom` and `context` are null**, which is what every question an
        // agent raised ITSELF carries — see `RaisedQuestion.passedUpFrom`.
        [
          'ui_1',
          {
            prompt: 'may I?',
            questions: [],
            piece: null,
            passedUpFrom: null,
            context: null,
            raisedBy: 'the-provider',
          },
        ],
        [
          'req_1',
          {
            prompt: 'which?',
            questions: [],
            piece: 'work_1',
            passedUpFrom: null,
            context: null,
            raisedBy: 'this-app',
          },
        ],
      ])
      const byWork = openQuestionsByWork(requests, raised)
      expect([...byWork.keys()]).toEqual(['work_1'])
      // ⛔ **And a CLOSED question names nothing either** — `REQUEST_IS_OPEN` and never a list
      // written here, so a tenth ending cannot make this read disagree with the answer door.
      for (const state of REQUEST_STATES) {
        const one = { ...(requests[1] as RoutedRequest), state }
        expect(openQuestionsByWork([one], raised).size, `${state} was read wrongly`).toBe(
          REQUEST_IS_OPEN[state] ? 1 : 0,
        )
      }
    })
  })

  /**
   * 🔴 **§6 · the censuses — the vocabulary, the words, and every surface that reports a state.**
   */
  describe('§6 · the vocabulary gained a member and every exhaustive reader gained a sentence', () => {
    it('⛔ the member is in both tables, is OPEN, and the two tables are keyed by one another', () => {
      expect(Object.keys(TASK_IS_OPEN).sort()).toEqual([...TASK_STATES].sort())
      // ⚠️ **609 · re-aimed and WIDENED** — two members joined the family, and the list is the
      // rule rather than four examples.
      expect(TASK_STATES.filter((state) => TASK_IS_OPEN[state])).toEqual([
        'waiting',
        'working',
        'waiting-on-an-answer',
        'waiting-on-a-person',
        'waiting-on-a-worker',
        // ⚑ **D-016 · commit 6 · a fourth wait, OPEN like its family** — a piece a person gave,
        // whose owner's turn ended with it open.
        'waiting-on-the-person-who-asked',
        // ⚑ **F097 · a fifth, OPEN the same way** — a piece a conversation gave, whose owner's turn
        // a person's words opened and ended with it open.
        'waiting-on-the-person-who-wrote',
        // ⚑ **A sixth, OPEN the same way** — a piece marked as waiting on purpose.
        'waiting-on-purpose',
        'stalled',
      ])
      // ⚑ **D-016, commit 5 · a third ending joined the closed side** — the giver closed the work —
      // and commit 5 left the open list above as it was.
      expect(TASK_STATES.filter((state) => !TASK_IS_OPEN[state])).toEqual([
        'answered',
        'withdrawn',
        'closed',
      ])
      // ⛔ **And it did NOT become a stall cause** — a cause says what the ENGINE observed stopping
      // the work, and here nothing stopped; `HO-085` §2's table is the measurement this reverses.
      for (const wait of TASK_WAITS) expect([...TASK_STALL_CAUSES]).not.toContain(wait)
      // ⚑ **D-017 · R10 · 5 → 6** — `could_not_be_reopened`, which IS something stopping the work
      // (the conversation holding it was replaced), and is no wait. ⚑ **D-016c · 6 → 5** —
      // `conversation_ended` went: a process stopping changes nothing about a piece. ⚑ **5 → 6** —
      // `background_stopped`: the background work a piece waited on stopped with its conversation,
      // which IS something stopping the work, and is no wait. ⚑ **F074 · 6 → 7** —
      // `provider_limited`: the provider refused the turn for its usage limit, which IS something
      // stopping the work, and is no wait. ⚑ **F076 · 7 → 8** — `login_refused`: the provider
      // refused the turn on a login this Mac had moved on from, which IS something stopping the
      // work, and is no wait. 8 → 9 with `billing_refused`: the provider would not bill the account
      // the turn ran on, which stops the work, and is no wait.
      expect([...TASK_STALL_CAUSES]).toHaveLength(9)
      expect([...TASK_STALL_CAUSES].at(-1)).toBe('billing_refused')
    })

    it('⚑ every member has its OWN word, driven over the constant rather than over a list here', () => {
      const words = TASK_STATES.map((state) => WORK_STATE_WORD[state])
      expect(words.filter((word) => word.length > 0)).toHaveLength(TASK_STATES.length)
      expect(new Set(words).size).toBe(TASK_STATES.length)
      // ⚠️ **A real sentence and not a placeholder** — `a-closed-vocabulary-guards-what-a-member-
      // says`. The word is about the WORK and names nobody, because the state does not: an
      // escalation moves who owes the answer without moving anything about the task.
      expect(WORK_STATE_WORD['waiting-on-an-answer']).toBe('waiting on an answer')
      for (const forbidden of ['parent', 'person', 'BroBot']) {
        expect(WORK_STATE_WORD['waiting-on-an-answer']).not.toContain(forbidden)
      }
      // 🔴 **609 · the rule above is about THIS member and does not range over its neighbours**,
      // and saying so is standing rule 19's *find what the sentence was a claim about*.
      // ⛔ *Waiting on an answer* must name nobody because WHO owes the answer MOVES: a question
      // routed to the parent becomes a person's at an escalation with nothing about the work
      // changing. ⚑ *Waiting on a person* may name one because who owes it CANNOT move — the
      // routing is `RequestOnlyAPersonCanSettle` and a proposal is a person's by construction —
      // so the word is a property of the state rather than a guess about a reader.
      expect(WORK_STATE_WORD['waiting-on-a-person']).toContain('person')
      // ⚠️ **And still never *you***: any person at this machine may answer, and the window
      // drawing the row may not be the one that will. ⚑ **D-016 · commit 6 · the one wait that
      // does say *you* is named, with its reason**: a piece a person gave waits on the person who
      // asked for it, and is said on the piece only, in the conversation they asked in — its reader
      // is only ever the one whose request it is. ⛔ Asserted as the whole set, so every other wait
      // is still held to the rule and a second exception is a red verdict.
      // 🔴 **F083 · and since then, none does**: the one exception now reads *replied*.
      // ⚑ **F097 · one again, with its reason**: a piece waiting on the person who wrote is counted
      // under *Waiting on you*, so its word may say so (`three-waits-one-family.test.ts`).
      expect(
        TASK_WAITS.filter((wait) => /\byou\b/.test(WORK_STATE_WORD[wait])),
        'the waits whose word addresses the reader',
      ).toEqual(['waiting-on-the-person-who-wrote'])
    })

    it('🔴 every surface that reports a task state reads the composition, derived from the call sites', () => {
      // ⛔ **Derived from what the code IMPORTS rather than from a list of paths**, which is
      // `a-guard-scoped-by-where-things-live-today-expires-silently`. ⚑ Two modules read the raw
      // fold for a surface, and both of them compose.
      const host = code(readFileSync(hostSource, 'utf8'))
      const store = code(readFileSync(storeSource, 'utf8'))
      expect(host).toContain('composeWhatEachPieceIsWaitingOn')
      expect(store).toContain('composeWhatEachPieceIsWaitingOn')
      // ⚠️ **Each raw read that feeds a surface is wrapped, asserted by the EXPRESSION** — a call
      // site that dropped the wrapper would leave the bare read here and this line would go red.
      // ⛔ **D-016 · `list_projects`' read (`tasksIn(slug, unread)`, wrapped) went with the tool**,
      // so `list_tasks`' two halves below are the surfaces the host reports a task state through.
      // ⚠️ **671 · `list_tasks`' two halves now pass the answer's `RowsUnread`** (R18), which put
      // each call past prettier's width — so they are matched across the line break rather than
      // as one line, and still as the WRAPPED expression: a bare read would not match.
      // ⚑ **D-016 · `pieceBoard`'s halves** — what it holds, and what the ids it stands for gave.
      for (const raw of [
        /composeWhatEachPieceIsWaitingOn\(\s*this\.deps\.store\.piecesOwnedBy\(sessionId, unread\),\s*waiting,?\s*\)/,
        /composeWhatEachPieceIsWaitingOn\(\s*this\.deps\.store\.piecesGivenBy\(giver, unread\),\s*waiting,?\s*\)/,
      ]) {
        expect(host, `a surface stopped reading the composition: ${String(raw)}`).toMatch(raw)
      }
      // ⛔ **And the ONE derivation is shared rather than spelled at each reader.**
      expect(host).toContain('openQuestionsByWork')
      expect(store).toContain('openQuestionsByWork')
    })

    it('⛔ the composed word never GATES — every rail reads the RAW fold', () => {
      // 🔴 **Standing rule 10's shape, one vocabulary over.** ⚠️ `asking` is derived from what
      // became of a QUESTION, so a rail keyed on it would make an entitlement answer depend on
      // whether somebody had replied — and `HO-016` §3's failure mode is exactly that: a word that
      // selects text quietly becoming a word that decides.
      //
      // ⚑ **Derived from the doors that read a piece at all**, each asserted to be found.
      // ⚑ **D-016** — `workAlreadyOpenIn` went with the one-open-task rail, and `withdrawTask` is
      // `takeBackPiece`.
      const host = code(readFileSync(hostSource, 'utf8'))
      const doors = ['async replyToParent(', 'async raiseAQuestion(', 'async takeBackPiece(']
      for (const door of doors) {
        const opens = host.indexOf(door)
        expect(opens, `no body found for ${door}`).toBeGreaterThan(0)
        const body = host.slice(opens, host.indexOf('\n  }\n', opens))
        expect(body.length, `the slice for ${door} is empty`).toBeGreaterThan(80)
        // ⛔ **It reads a piece**, which is what makes the negative below about this door.
        // ⚠️ Matched as a CALL and not as the whole chain: prettier breaks
        // `this.deps.store\n  .piecesOwnedBy(id)` across lines the moment the expression grows,
        // and a census that pinned the chain would go quietly red on a reformat.
        expect(body, `${door} reads no piece at all`).toMatch(
          /\.(piecesOwnedBy|piecesGivenBy|pieceNamed|heldBy)\(/,
        )
        expect(body, `${door} gates on the composed word`).not.toContain(
          'composeWhatEachPieceIsWaitingOn',
        )
      }
      // ⚠️ **And the person's queue reports no state either**, so its raw read is not a surface
      // this rule ranges over: `WorkInHand` carries a label and nothing else (since D-016).
      const questions = code(readFileSync(join(here, '../src/shared/questions.ts'), 'utf8'))
      const shape = questions.slice(
        questions.indexOf('export interface WorkInHand {'),
        questions.indexOf('}', questions.indexOf('export interface WorkInHand {')),
      )
      expect(shape).toContain('label')
      expect(shape).not.toContain('state')
    })

    it('⚠️ the composition lives ABOVE the fold and the fold cannot call it', () => {
      const tasks = code(readFileSync(join(here, '../src/shared/tasks.ts'), 'utf8'))
      const composes = tasks.indexOf('export function composeWhatEachPieceIsWaitingOn(')
      const folds = tasks.indexOf('export function derivePieces(')
      expect(composes).toBeGreaterThan(0)
      expect(folds).toBeGreaterThan(composes)
      const fold = tasks.slice(folds)
      expect(fold).not.toContain('composeWhatEachPieceIsWaitingOn')
    })
  })
})
