import { WORK_STATE_WORD } from '../src/shared/work-state-words'
import type { TaskState } from '../src/shared/tasks'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset, ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import type { ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { TASK_IS_OPEN } from '../src/shared/tasks'
import { aPersonOwesAnAnswerIn } from '../src/shared/questions'
import { MAX_FOREST_CONVERSATIONS } from '../src/shared/the-whole-forest'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * 🔴 **664 · one task, one reading, in every place it is drawn** (`D32`, found by `654`).
 *
 * ⛔ **One task, three places, and until `664` two of them read the RAW fold.** The giver's drawer
 * walks {@link SessionStore.workThisOneGaveOut}, which composes; the receiver's line walks
 * {@link SessionStore.workThisOneWasGiven} and the Team forest folds each conversation's own
 * ledger, and neither did — so a task whose holder is parked on a card a person owes read
 * `waiting-on-a-person` in one place and `working` in the other two.
 *
 * ⚑ **Every reading is taken through the host's own reader** — `whoCalledWhom` for both ends of
 * the band, `theWholeForest` for the forest — over real SQLite and real migrations, and the agent's
 * `list_tasks` and the person's Work tab are read beside them as the two that already agreed.
 *
 * ⚑ **D-016 · a task is a PIECE now** — given with `give_work`, folded by `derivePieces` and
 * composed by `composeWhatEachPieceIsWaitingOn` — and every reading below is keyed by its id.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const STORE_SOURCE = join(here, '../src/main/db/session-store.ts')
const HOST_SOURCE = join(here, '../src/main/runtime/runtime-host.ts')

/**
 * ⛔ **The census's own readers, extracted so §3's control can hand them a planted source.**
 * Comments are stripped first — a docblock quoting the call it retired is not a call
 * (`a-source-census-must-strip-prose-before-it-asserts`).
 */
const codeOnly = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
/**
 * ⚑ **Where a reader OPENS**, in both files' shapes: a module function at none, a class member or
 * a local function or binding at two spaces of indent, and one of the store's returned methods —
 * `name(args) {` alone on its line — at four. ⚠️ A keyword at either depth (`  if (`, `    for (`)
 * opens nothing. ⛔ The module arm was missing until this control planted a call inside one.
 */
const OPENER =
  /^(?:(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*[<(]| {2}(?:(?:private|public|protected|static|async|override|readonly|get|set)\s+)*(?:function\s+|const\s+)?(?!(?:if|for|while|switch|return|catch|await|throw|new|typeof|void|const|let|function)\b)([A-Za-z_$][\w$]*)\s*(?:[<(]|=)| {4}(?!(?:if|for|while|switch|return|catch)\b)([A-Za-z_$][\w$]*)\([^()\n]*\)\s*(?::[^{\n]*)?\{\s*$)/gm
/** ⛔ The `)` that closes the `(` at `open`, counted — so a nested call's own parentheses are the bound. */
const closeOf = (code: string, open: number): number => {
  let depth = 0
  for (let at = open; at < code.length; at++) {
    if (code[at] === '(') depth++
    else if (code[at] === ')' && --depth === 0) return at
  }
  return code.length
}
/**
 * 🔴 **Every CALL of `callee`, with the reader it sits in and whether it is an argument of the
 * composition** — asked of the call and never of an import
 * (`a-census-that-asks-for-the-import-must-ask-for-the-call`).
 */
const callsOf = (source: string, callee: RegExp): { reader: string; composed: boolean }[] => {
  const code = codeOnly(source)
  const opened = [...code.matchAll(OPENER)].map((m) => ({
    at: m.index,
    name: (m[1] ?? m[2] ?? m[3]) as string,
  }))
  const compositions = [...code.matchAll(/\bcomposeWhatEachPieceIsWaitingOn\(/g)].map((m) => {
    const open = m.index + m[0].length - 1
    return { from: open, to: closeOf(code, open) }
  })
  return [...code.matchAll(callee)].map((m) => ({
    reader: opened.filter((one) => one.at < m.index).at(-1)?.name ?? '(module scope)',
    composed: compositions.some((one) => one.from < m.index && m.index < one.to),
  }))
}

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

describe('664 · one task, one reading, in every place it is drawn', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handed: AgentToolset[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-664-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-664-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    handed = []
    issued = new FakeProviderSessions()
    host = new RuntimeHost({
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
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
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
   * ⚑ **One piece, given by a PM to a worker** — `609`'s own shape, through `give_work` (D-016),
   * which starts the worker. ⚠️ Its brief is the worker's first turn, and it parks on the card the
   * Fake raises every turn, which is what makes a PERSON owe it an answer.
   */
  const aTaskGivenOut = async (): Promise<{
    giver: string
    holder: string
    piece: string
    surface: RecordingSink
  }> => {
    const seeded = await personOpens('worker')
    await host.close(seeded, window)
    const giver = await personOpens('pm')
    const giverTools = theToolsetJustHandedOut()
    const given = await callOn(giverTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'the work one task is about',
      brief: 'do the thing',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const holder = given.agent as string
    const piece = store.piecesOwnedBy(holder).find((one) => TASK_IS_OPEN[one.state])
    if (piece === undefined) throw new Error('the give never opened a piece')
    const surface = new RecordingSink('webContents:9')
    host.claimSession(holder, surface)
    await waitFor(
      () => aPersonOwesAnAnswerIn(store.routedRequestsOf(holder)),
      'the holder to park on a card a person owes',
    )
    return { giver, holder, piece: piece.piece, surface }
  }

  /**
   * 🔴 **Every place one task's state is reported, each read through its own reader.** ⚑ The
   * first three are the ones a PERSON sees; the last two are the ones that already composed and are
   * read here as the reference, not as the subject.
   */
  const readingsOf = (
    giver: string,
    holder: string,
    piece: string,
  ): Record<string, string | undefined> => ({
    'the giver’s drawer': host
      .whoCalledWhom(giver)
      .workGivenOut.rows.find((one) => one.piece === piece)?.state,
    'the receiver’s line': host
      .whoCalledWhom(holder)
      .workTakenIn.rows.find((one) => one.piece === piece)?.state,
    'the Team forest': host
      .theWholeForest()
      .nodes.rows.flatMap((one) => (one.node === 'a-task' ? [one.work] : []))
      .find((one) => one.piece === piece)?.state,
    'the agent’s list_tasks': host.pieceBoard(giver).gave.find((one) => one.piece === piece)?.state,
    'the person’s Work tab': store.workGivenOutBy(giver).rows.find((one) => one.piece === piece)
      ?.state,
    'the agent turn block': (
      host as unknown as {
        factsForTheTurnBlock(
          session: { id: string },
          piece: null,
        ): { helpers: { piece: string; state: string }[] | null }
      }
    )
      .factsForTheTurnBlock({ id: giver }, null)
      .helpers?.find((row) => row.piece === piece)?.state,
  })

  const everywhere = (state: TaskState): Record<string, string> => ({
    'the giver’s drawer': state,
    'the receiver’s line': state,
    'the Team forest': state,
    'the agent’s list_tasks': state,
    'the person’s Work tab': state,
    'the agent turn block': WORK_STATE_WORD[state],
  })

  describe('§1 · one task waiting on a person, and the same task once nothing is outstanding', () => {
    it('🔴 a task whose holder a PERSON owes an answer reads `waiting-on-a-person` in every place', async () => {
      const { giver, holder, piece } = await aTaskGivenOut()
      // ⛔ **The premise, measured rather than assumed**: the raw fold says the work is being done.
      // ⚑ If it said anything else, every place agreeing below would not be the composition's doing.
      expect(store.piecesOwnedBy(holder).find((one) => one.piece === piece)?.state).toBe('working')
      const before = (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n
      expect(readingsOf(giver, holder, piece)).toEqual(everywhere('waiting-on-a-person'))
      expect((db.prepare('SELECT total_changes() AS n').get() as { n: number }).n).toBe(before)
    })

    it('⚑ THE CONTROL — the same task, card answered and turn over, reads its raw state in every place', async () => {
      const { giver, holder, piece, surface } = await aTaskGivenOut()
      const card = ledger(holder)
        .filter(
          (event): event is TranscriptEvent & { type: 'permission_request'; id: string } =>
            event.type === 'permission_request',
        )
        .at(-1)
      if (card === undefined) throw new Error('the holder is not parked on anything')
      await host.respondPermission(holder, card.id, { outcome: 'allow' }, surface)
      await waitFor(
        () => store.piecesOwnedBy(holder).find((one) => one.piece === piece)?.state === 'stalled',
        'the holder’s turn to end',
      )
      // ⛔ **Nothing is outstanding, so the composition passes the raw row through** — a fold that
      // tinted every open row would read `waiting-on-a-person` here and fail.
      expect(aPersonOwesAnAnswerIn(store.routedRequestsOf(holder))).toBe(false)
      expect(readingsOf(giver, holder, piece)).toEqual(everywhere('stalled'))
    })
  })

  describe('§3 · the census — every reader that REPORTS a task’s state composes it, by name', () => {
    it('🔴 every `workEdge` is built inside a reader that composes, and there are exactly three', () => {
      const store = readFileSync(STORE_SOURCE, 'utf8')
      const builds = callsOf(store, /\bworkEdge\(/g).map((one) => one.reader)
      expect(builds.sort()).toEqual([
        'everyPlacedConversation',
        'workThisOneGaveOut',
        'workThisOneWasGiven',
      ])
      // ⚑ **`workThisOneGaveOut` composes through the walk it shares with the Work tab** — so the
      // walk's own fold is asked the same question below, and the reader is held to calling it.
      const walked = codeOnly(store).slice(codeOnly(store).indexOf('    workThisOneGaveOut('))
      expect(walked.slice(0, walked.indexOf('\n    },'))).toContain('walkWorkGivenBy(')
    })

    it('⛔ every fold of a ledger into tasks is COMPOSED or named — the store', () => {
      // ⚑ **D-016** — the fold is `piecesOfSession` (`derivePieces`), where it was `tasksOfSession`.
      const calls = callsOf(
        readFileSync(STORE_SOURCE, 'utf8'),
        /(?<!function )\b(?:piecesOfSession|turnBlockPiecesOfSession)\(/g,
      )
      expect(
        calls
          .filter((one) => one.composed)
          .map((one) => one.reader)
          .sort(),
      ).toEqual(
        [
          'walkWorkGivenBy', // the Work tab and the giver's drawer
          'stalledWorkNobodyWasToldAbout', // the person's half of the stall notice
          'stalledWorkItsGiverWasToldAbout', // F131 · work whose holder stopped, its giver told
          'stalledWorkAPersonGave', // work a person gave that stopped, for the person
          'everyPlacedConversation', // 664 · the Team forest's task rows
          'workThisOneWasGiven', // 664 · the receiver's line
          'piecesWithTheirWaits',
        ].sort(),
      )
      // ⚠️ **The readers that ask something ELSE, named rather than converted** — `659` §0's shape.
      expect(
        calls
          .filter((one) => !one.composed)
          .map((one) => one.reader)
          .sort(),
      ).toEqual(
        [
          // ⛔ the composition's own SOURCE (`childrenOpen`) — composing it would compose inside itself
          'piecesGivenBySession',
          // ⛔ a ledger repair asking whether the work was being DRIVEN, which is the raw fact
          'settleRestartedWorkTx',
          // The raw stall ordinal is compared to the upgrade cut, never reported as a state.
          'legacyOrdinaryStallWasReported',
          // ⚑ the open pieces whose status line marks a wait that names nothing — an openness and
          // the line's own mark, never a state reported
          'waitsThatNeedClassifying',
          // ⚑ the raw accessors — every caller of them is classified in the host census below
          // (⚑ D-016: `tasksIn` and `conversationsInProject` went with projects, and `tasksOf` is
          // `piecesOwnedBy` and `openPiecesOf`)
          'piecesOwnedBy',
          'turnBlockPiecesOwnedBy',
          'openPiecesOf',
          // ⚑ D-016 · commit 7 · R2 — the work that names a conversation holding no root — ⚑ F033 ·
          // folded once for its name now and for a sentence about one of its pieces, ⚑ and F009 · for
          // an agent's record of its newest pieces: an openness, a name, and how a piece ENDED,
          // never an open state (a composition tints open rows only) — and the newest open piece
          // when the fold reads it as waiting on purpose, which the listing composes before it
          // says so
          'heldForAName',
          // ⚑ F097 · the pieces a conversation's fold left waiting on the person who wrote to it,
          // kept until its ledger grows — raw on purpose: each reader composes them (the person's
          // list here, who owes it the next move in the host), so a more specific wait is said
          'waitingOnWhoWrote',
        ].sort(),
      )
    })

    it('⛔ every host read of a conversation’s tasks is COMPOSED or named — the host', () => {
      // ⚑ **D-016** — `tasksOf` is `piecesOwnedBy` (and `openPiecesOf`), `tasksAssignedBy` is
      // `piecesGivenBy`.
      const calls = callsOf(
        readFileSync(HOST_SOURCE, 'utf8'),
        /\.(?:piecesOwnedBy|turnBlockPiecesOwnedBy|openPiecesOf|piecesGivenBy|piecesOwnedBefore)\(/g,
      )
      expect(
        calls
          .filter((one) => one.composed)
          .map((one) => one.reader)
          .sort(),
      ).toEqual(
        [
          // ⚑ D-016 · `reportOn` (`list_projects`) went with projects, and `tasksVisibleTo` is the
          // board and the record
          'pieceBoard', // list_tasks, the pieces it holds
          'pieceBoard', // list_tasks, the pieces it gave
          'pieceRecord', // list_tasks, one piece's record
          'childrenOnTheRecord', // …and the pieces given under it
          // ⚑ D-016 · an agent card's pieces, in the card's own wait read — a state a model reads
          'piecesOnTheCard',
          // ⚑ D-033 · `tellWhoeverGaveTheWork`'s read, which since D-033 is also what every window
          // hears a turn's move by — at its rows, at a background level and as it starts
          'whatItHolds',
          'reconciliationReading',
          'tellAboutWorkItGaveOut',
          'settleTheNoticesFor',
          // ⛔ `703`'s `theNoticesALaterFactMadeFalse` and `711`'s `putWhatIsTrueInPlaceOfTheWait`
          // are GONE with their subject: both asked whether the work still waited, for the held
          // *"It is waiting"* correction a reopen once sent — and since D-016c a reopen tells nobody
          // ⚑ `D-006` · F018 — where the work a RUNNING conversation holds stands, for the rail's
          // plates: a state a person reads, so composed, as `list_tasks` composes the same rows
          'whatEachConversationIsWaitingOn',
          // ⚑ When the piece a service is on stalled, said to the callers queued behind it: a
          // state, so composed — a piece waiting on its own question or child is not stalled
          'whenItsActivePieceStalled',
          // ⚑ The stalled pieces a give's answer names to the giver, where the stall rule's read
          // was (no give is refused over a stall now): a state it reads, so composed — a piece
          // waiting on an answer, a person or a child of its own is not stalled
          'stallsIn',
        ].sort(),
      )
      // The launch list names conversations; it no longer reports their pieces' states.
      expect(
        callsOf(readFileSync(HOST_SOURCE, 'utf8'), /\.workThatNames\(/g).filter(
          (one) => one.reader === 'otherConversationsOf',
        ),
      ).toEqual([{ reader: 'otherConversationsOf', composed: false }])
      expect(
        calls
          .filter((one) => !one.composed)
          .map((one) => one.reader)
          .sort(),
      ).toEqual(
        [
          // ⛔ RAILS — `609` §7: no rail gates on a composed word (⚑ D-016: `withdrawTask` is
          // `takeBackPiece`; `raiseAQuestion` asks `heldBy` and the one-open-task rail
          // `workAlreadyOpenIn` is gone)
          'takeBackPiece',
          'replyToParent',
          // ⚑ D-016 · who may title a piece or set its status line — an owner and a giver
          'updateWork',
          // ⚑ whether the piece a wait names is still open — an openness, never a state
          'reconciliationWaitProblem', // Target openness, without publishing its state.
          'whatAWaitIsOn',
          // ⚑ D-016 · the pieces a conversation holds, by label and giver — the root and the OPEN
          // pieces, an openness, never a state
          'heldBy',
          // Personal work selects its owned parent by openness and name, without reporting a state.
          'takeOnWork',
          // F131 · whether a person may hand a piece back: its one raw row, handed to
          // `theWorkThatStopped`, which composes it before it decides
          'itsHolderStoppedWith',
          // ⛔ `663`'s `theWakesFoldAdmits` (`resume_agent`'s fold) is GONE with its subject: D-017
          // commit 3 removed `resume_agent` — nothing ends a conversation, so nothing wakes one
          // ⚑ feeds `openWorkOf` and `workNamed` only — an openness and a name, never a state
          'onePieceReadPerAnswer',
          // ⚑ `673` · the `work` announcement — whether the conversation holds ANY open work, an
          // openness asked once per transition, never a state reported to anyone. ⚑ **`689` moved
          // the read, question unchanged, into one helper** — the ending and the replacement share
          // it since D-016c (a reopen moves no piece, so it announces none).
          'announceTheWorkItHolds',
          // ⚑ **W4.189** — the folders a conversation's open pieces grant it: an openness, the
          // folder its give recorded and whether its brief went out, never a state reported.
          'grantsOf',
          // ⛔ `699`'s `takeBackWhatItsOwnEndMadeFalse` is GONE with its subject: it took back what
          // a parent's `end_agent` made false, and D-017 commit 3 removed `end_agent`
          // ⚑ `703` · the task a giver's question names, found by id and giver and asked only whether
          // it is OPEN — an openness, never a state. ⛔ `703`'s `takeBackWhatAnAnswerMadeFalse` is
          // GONE with its subject: it took back the WAIT corrections a reopen once sent a giver, and
          // since D-016c a reopen tells nobody
          'takeBackWhatItsQuestionMadeFalse',
          // ⛔ the composition's own SOURCE (`childrenOpen`), and the work the one state says it
          // waits on (D-036) — an openness and a holder, never a state. ⚑ **D-036 moved the read**
          // out of `oneWaitReadPerAnswer`, which now takes this one's reader and asks none of these
          'oneWorkOutReadPerAnswer',
          // A bounded raw memo feeds the turn block's compositions; the live controls above cover both states.
          'factsForTheTurnBlock',
          // ⛔ `735`'s `aRunningGiverHoldsWorkIn` is GONE with its subject: the undo kept a start
          // whose reopen had told a running giver it started again, and since D-016c a reopen tells
          // nobody
          // ⚑ `D-011` · the sender tag — which work a sender GAVE this receiver and whether it is
          // OPEN, said as its name: a giver, an openness and a name, never a state word
          'whereTheSenderStands',
          // ⚑ F088 · the piece a note or a follow-up names, said beside that tag: its title, and how
          // it ENDED, never an open state (a composition tints open rows only)
          'onePieceAsItStandsNow',
          // ⚑ F089 · a take-back's refusal of a piece the caller holds: whether it is OPEN, and how
          // it ENDED — an openness and an ending, never an open state
          'thePieceItHolds',
          // ⚑ The work a launch left `working` for a job whose wake-up was then dropped — the
          // fold's own `working` and background hold, as the launch's sweep reads them, to write
          // that sweep's row late: a fact about the fold, never a state reported to anyone
          'stallWhatItsJobWouldHaveDriven',
          // ⚑ The same row, written late for the work a cut turn's continuation would have driven
          // when the continuation does not go: a fact about the fold, never a state reported
          'stallWhatACutLeft',
          // ⛔ `D-017` · R3's `rebuiltFromItsRow` no longer reads a conversation's tasks: since
          // D-016 commit 5 a held message rebuilt from its row reads the piece it carries off that
          // row (`WaitingMessage.piece`), never through the pieces its holder owns
          // ⚑ `D-017` · R3 — whether a message that waited for this start is still true: the work it
          // carries is OPEN (R20: a withdrawal already ended the message it took back, so no
          // `withdrawn` branch), and the holder's work a notice is about is `answered`
          // or `withdrawn` — `703`'s take-back, asked at the start. ⛔ Two reads, both of CLOSED
          // states or an openness, which the composition passes through untouched (it tints only
          // open work a person owes an answer in), so a composed read would say the same
          'whyItNoLongerGoes',
          'whyItNoLongerGoes',
          // ⚑ `D-022` · R2 — whether a piece a new brief is on its way to has ENDED (answered, taken
          // back or closed): an openness, never a state reported to anyone
          'itHasEnded',
          // ⚑ `D-022` · R1 — where the give a new brief rides stands as the words reach its holder:
          // whether its piece ended, and the stall's recorded cause when its give was never sent —
          // a fact the ledger wrote about the give, asked to answer the giver, never a state
          // reported to anyone
          'whereTheGiveItRidesStands',
          // ⚑ `D-022` · R1 — the piece a held message carries, read at the handover for its newest
          // brief and title: the words that go out, never a state
          'runFlush',
          // ⚑ A service's queue — how many OPEN pieces are ahead of one, in the order they were
          // given: an openness and an order, never a state reported
          'queuedAhead',
          // ⚑ Whether a piece is still OPEN before its ending waits for a start: an openness,
          // never a state reported
          'theStartsAnEndingWaitsFor',
          // ⚑ A give's wait-cycle check — the OPEN pieces a conversation gave, and who holds them:
          // an openness and a holder, never a state reported
          'itWaitsOn',
          // ⚑ A service's queue — which open piece holds it (handed over, or ended unsent) and which
          // wait their turn, in the order given: an openness and an order. ⚑ A queued piece is said
          // as it waits there: what its service waits on is its active piece's, not its own
          'theQueueOf',
          // ⚑ Whether a held message is a service's brief: the id its give was recorded with, never
          // a state
          'freeForNormalWork', // An open piece prevents reuse; no task state is published.
          'freeForNormalWork', // Work given out also prevents reuse; no task state is published.
          'aServiceBrief',
          // ⚑ Whether a piece a message names waits, queued, at the service it was given: whether
          // its brief has been handed over, never a state reported
          'itWaitsQueuedThere',
          // ⚑ Which piece of a service's a question it carries up was asked under: the pieces its
          // asker held when it was routed, and what they hang under — never a state reported
          'thePieceItWasAskedUnder',
          // ⚑ `D-026` · `madeByItsProfile` left this list: the title of the piece each file was
          // kept on is read with the file (`SessionStore.madeBy`), no fold
        ].sort(),
      )
    })

    it('⚑ THE CONTROL — the census attributes TWO planted calls, one composed and one not', () => {
      const planted = [
        'export function createSessionStore(db) {',
        '  function walkSomething(id) {',
        '    if (id === null) {',
        '      return []',
        '    }',
        '    return composeWhatEachPieceIsWaitingOn(',
        '      [...piecesOfSession(id)].filter((piece) => piece.open),',
        '      lookup,',
        '    ).map((piece) => workEdge(piece, null))',
        '  }',
        '  return {',
        // ⛔ **A DOCBLOCK quoting the call** — unstripped, it would be a third call in `walkSomething`.
        '    /**',
        '     * rawSomething once called piecesOfSession(id) before a composition',
        '     */',
        '    rawSomething(id) {',
        '      // piecesOfSession(id) in a comment is not a call',
        '      return piecesOfSession(id).map((piece) => workEdge(piece, null))',
        '    },',
        '  }',
        '}',
        // ⚠️ **A module function's body sits at TWO spaces**, so `  if (` there is exactly where a
        // missing keyword lookahead would open a reader named `if` between the real one and its call.
        'function moduleReader(id) {',
        '  if (id === null) return []',
        '  return piecesOfSession(id)',
        '}',
      ].join('\n')
      expect(callsOf(planted, /(?<!function )\bpiecesOfSession\(/g)).toEqual([
        { reader: 'walkSomething', composed: true },
        { reader: 'rawSomething', composed: false },
        { reader: 'moduleReader', composed: false },
      ])
      expect(callsOf(planted, /\bworkEdge\(/g).map((one) => one.reader)).toEqual([
        'walkSomething',
        'rawSomething',
      ])
    })
  })
})

/**
 * ⚠️ **§2 · the price, COUNTED rather than argued** (`664` §3) — a store over a database that
 * records which conversation each questions read was taken for. ⚑ On these walks the questions
 * statement is read only by {@link SessionStore} `whatThisConversationIsWaitingOn` (through
 * `oneWaitReadPerHolder`), so a questions read IS a wait read, and one taken per HOLDER is the bound
 * `walkWorkGivenBy`'s memo already holds. ⚑ **D-016 · re-aimed**: this counted the PROPOSAL read,
 * which went with proposals; the questions read is one of the three that are left, taken once per
 * wait read as that one was.
 */
describe('664 §2 · one wait read per HOLDER, whatever it holds', () => {
  let userData: string
  let raw: AppDatabase
  let store: SessionStore
  let clock: number
  let armed: number
  const reads: string[] = []
  const tick = (): number => clock++
  const ordinals = new Map<string, number>()

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-664-price-'))
    raw = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(raw, migrationsFolder)
    clock = 7_000_000
    armed = 0
    reads.length = 0
    ordinals.clear()
    // ⛔ **The one statement counted is found by its SQL**, and `armed` says it was found — a probe
    // whose pattern matched nothing would count zero reads and pass every bound (rule 34).
    const counted = new Proxy(raw, {
      get(target, property) {
        if (property === 'prepare') {
          return (sql: string) => {
            const statement = target.prepare(sql)
            // The read that asks whether a question was written since a kept fold reads none.
            if (
              !sql.includes("AND type IN ('user_input_request', 'question_asked')") ||
              sql.includes('ordinal > @after')
            )
              return statement
            armed += 1
            return new Proxy(statement, {
              get(inner, name) {
                if (name === 'all') {
                  return (...args: unknown[]) => {
                    reads.push(args[0] as string)
                    return inner.all(...args)
                  }
                }
                const value: unknown = Reflect.get(inner, name, inner)
                return typeof value === 'function' ? value.bind(inner) : value
              },
            })
          }
        }
        const value: unknown = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    store = createSessionStore(counted, tick)
  })

  afterEach(() => {
    raw.close()
    rmSync(userData, { recursive: true, force: true })
  })

  /** ⚑ **D-016** — a conversation its `parent` started, or a person's (which owns a root). */
  const conversation = (id: string, profileId: string, parentSessionId?: string): string => {
    store.create({
      id,
      provider: 'codex',
      cwd: userData,
      approvalMode: 'ask',
      profileId,
      ...(parentSessionId === undefined ? {} : { parentSessionId }),
    })
    return id
  }
  const nextOrdinal = (id: string): number => {
    const next = ordinals.get(id) ?? 0
    ordinals.set(id, next + 1)
    return next
  }
  const append = (id: string, event: TranscriptEvent): void => {
    store.append(id, nextOrdinal(id), event, tick())
  }
  /**
   * ⚑ **D-016 · a piece given the way the host gives one** — its number under the giver's root,
   * then its `work` row and its `work_given` row in the holder's ledger, together.
   */
  const given = (holder: string, giver: string, piece: string): void => {
    const root = store.rootOf(giver)
    if (root === null) throw new Error(`${giver} owns no root`)
    const number = store.numberUnder(root.piece)
    const label = `${root.label}.${String(number)}`
    const title = `the work labelled ${label}`
    store.recordGive(
      {
        piece,
        parent: root.piece,
        number,
        owner: holder,
        givenBy: giver,
        title,
        brief: title,
        folder: null,
        inputs: [],
      },
      nextOrdinal(holder),
      { type: 'work_given', piece, label, parent: root.piece, givenBy: giver, title, brief: title },
      tick(),
    )
  }

  it('⛔ the forest and the receiver’s line read a holder of TWO open rows ONCE, and a conversation holding nothing never', () => {
    // ⚑ **D-016** — two pieces from its one giver: only a conversation's parent gives it work.
    const one = conversation('sess_giver_one', 'pm')
    const holder = conversation('sess_holder', 'worker', one)
    given(holder, one, 'work_1')
    given(holder, one, 'work_2')
    // An unreadable question in the holder's ledger, so its questions are never kept between
    // reads: each answer must read them, and read them once.
    raw
      .prepare(
        `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
         VALUES (?, ?, 0, ?, 'user_input_request', ?, ?)`,
      )
      .run('evt_unkept', holder, nextOrdinal(holder), '{not json', tick())
    expect(armed, 'the questions read was never prepared through the probe').toBe(1)

    const forest = store.everyPlacedConversation(MAX_FOREST_CONVERSATIONS)
    // ⚑ **The premise that makes the bound a measurement**: TWO open rows, so a lookup asked per
    // ROW would read twice — and the composition asks per open row.
    expect(
      forest.rows
        .flatMap((node) => (node.node === 'a-task' ? [node.work] : []))
        .filter((work) => TASK_IS_OPEN[work.state])
        .map((work) => work.piece)
        .sort(),
    ).toEqual(['work_1', 'work_2'])
    // 🔴 **One read for the holder, none for the giver, which holds nothing** — its root is never
    // a row (D-016 · R1).
    expect(reads).toEqual([holder])

    reads.length = 0
    expect(store.workThisOneWasGiven(holder).rows).toHaveLength(2)
    expect(reads).toEqual([holder])

    reads.length = 0
    expect(store.workThisOneWasGiven(one).rows).toEqual([])
    expect(reads).toEqual([])
  })

  /**
   * 🔴 **671 · R18 — RE-AIMED: what composing costs the forest is now a COUNT, not a blank page.**
   *
   * ⛔ **These two tests pinned `664` F1** — one torn row made the whole forest raise, and the Team
   * page drew *"Nothing has been read about this workspace yet."* ⚑ **The PM took the ruling
   * (`671` §5): skipped, counted, SAID.** Stripped AND re-aimed (rule 26): each keeps its torn row
   * and its open work, and asserts the forest ANSWERS and carries the count, where it asserted a
   * throw. ⚠️ The finished-work controls they carried are gone because the thing they controlled
   * for — *the forest only raises while work is open* — is no longer a behaviour.
   */
  it('🔴 one unparseable assignment elsewhere: the forest ANSWERS while work is open, and counts the row ONCE', () => {
    const giver = conversation('sess_giver', 'pm')
    const holder = conversation('sess_holder', 'worker', giver)
    const elsewhere = conversation('sess_elsewhere', 'worker', giver)
    given(holder, giver, 'work_1')
    // ⚑ **THE CONTROL, on the same database before anything is torn**: a clean read counts 0.
    expect(store.everyPlacedConversation(MAX_FOREST_CONVERSATIONS).rowsUnread).toBe(0)
    raw
      .prepare(
        `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
         VALUES (?, ?, 0, ?, 'work_given', ?, ?)`,
      )
      .run('evt_torn', elsewhere, 900, '{not json', tick())
    const forest = store.everyPlacedConversation(MAX_FOREST_CONVERSATIONS)
    // ⛔ **ONE** — the forest folds `elsewhere`'s own ledger and meets it there. ⚑ One row, one
    // count — `RowsUnread`'s whole reason, and D-016's wait reads take their candidates off the
    // `work` table, which holds no row for a torn one.
    expect(forest.rowsUnread).toBe(1)
    // ⚑ **…and the work is still drawn, still composed** — a person's surface is not blank.
    expect(
      forest.rows.flatMap((node) => (node.node === 'a-task' ? [node.work.piece] : [])),
    ).toEqual(['work_1'])
    expect(forest.rows.filter((node) => node.node === 'a-conversation')).toHaveLength(3)
  })

  it('🔴 …and one unparseable QUESTION row in a holder’s own ledger: both reads answer, and count it', () => {
    const giver = conversation('sess_giver', 'pm')
    const holder = conversation('sess_holder', 'worker', giver)
    given(holder, giver, 'work_1')
    expect(store.workThisOneWasGiven(holder).rowsUnread).toBe(0)
    // ⛔ **Only the WAIT READ opens this row** — `selectPieceEvents` does not select
    // `user_input_request` — so a count here is the composition's count and nothing else's.
    raw
      .prepare(
        `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
         VALUES (?, ?, 0, ?, 'user_input_request', ?, ?)`,
      )
      .run('evt_torn_question', holder, nextOrdinal(holder), '{not json', tick())
    const forest = store.everyPlacedConversation(MAX_FOREST_CONVERSATIONS)
    expect(forest.rowsUnread).toBe(1)
    expect(forest.rows.some((node) => node.node === 'a-task')).toBe(true)
    const taken = store.workThisOneWasGiven(holder)
    expect(taken.rowsUnread).toBe(1)
    expect(taken.rows).toHaveLength(1)
    // ⚑ **THE CONTROL that the count is the wait read's**: once the work has finished, nothing asks
    // the holder's questions, and the same torn row is met by nobody.
    append(holder, {
      type: 'work_replied',
      piece: 'work_1',
      outcome: 'done',
      summary: 'done',
      resources: [],
    })
    expect(store.workThisOneWasGiven(holder).rowsUnread).toBe(0)
  })
})
