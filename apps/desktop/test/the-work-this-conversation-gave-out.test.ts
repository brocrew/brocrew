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
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import type { ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { LEDGER_WALK_KINDS, WALK_COVERS } from '../src/shared/questions'
import {
  TASK_IS_OPEN,
  TASK_STATES,
  UNDRIVEN_SENTENCES,
  workGivenOut,
  type PieceRow,
  type TaskState,
  type WorkGivenOut,
} from '../src/shared/tasks'
import { DEFAULT_PROFILE_LABEL } from '../src/shared/runtime-ipc'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { PANEL_EMPTY_WORDS, panelEmptyWords } from '../src/renderer/src/lib/session-panel'
import { WORK_STATE_WORD, workReading } from '../src/renderer/src/lib/work-report'
import {
  NOTHING_GIVEN_OUT,
  WORK_DOUBT_WORDS,
  workGivenOutView,
  type WorkGivenOutReading,
} from '../src/renderer/src/lib/work-given-out'
import { createSessionStore as createRendererStore } from '../src/renderer/src/lib/session-store'
import type { RuntimeBridge } from '../src/shared/runtime-ipc'
import { everythingOverTheWire } from './lib/the-wire'
import { visibleCopy } from './lib/visible-copy'

/**
 * ⚑ **A bridge that answers exactly one verb**, with the two subscriptions `createSessionStore`
 * wires at construction. ⛔ Nothing else is stubbed: a call this double does not have is a
 * `TypeError`, which is the honest answer for a test that is about ONE door.
 *
 * 🔴 **And it goes OVER THE WIRE** — `361` §2's rail, and this file is in the derived roster
 * `the-bridge-that-clones-nothing.test.ts` §6 pins. ⛔ *"Every one of them injects an in-process
 * bridge that clones nothing"* is how a payload that would throw at `ipcRenderer.invoke` stayed
 * invisible three times; `everythingOverTheWire` performs the structured clone the shipped app
 * performs, so `{ sessionId }` is measured rather than assumed cloneable.
 */
const bridgeThat = (over: Record<string, unknown>): RuntimeBridge =>
  everythingOverTheWire({
    onEvent: () => () => {},
    onLiveness: () => () => {},
    ...over,
  }) as unknown as RuntimeBridge

/**
 * The reading includes work this conversation gave out.
 *
 * > ⚑ *"in the right panel where we have the robot avatar, can we see the list of tasks opened by
 * > the agent and see their live status…?"*
 *
 * > ⚑ *"I don't see the list of tasks in the right panel where brobot avatar is, showing the tasks
 * > it assigned so far and their status etc.?"*
 *
 * ## ⚠️ Where the readings diverge, which is where every section is written
 *
 *  - **§1** the store — a REAL ledger, and the two facts `piecesGivenBy` cannot state: how many
 *    ledgers were opened, and how many of their rows could not be read. ⛔ A test that never plants
 *    an unreadable row passes under both readings.
 *  - **§2** the wire — the host carries the walk rather than recomputing it, and the renderer's
 *    store turns a refusal into `null` and never into an empty list.
 *  - **§3** the fold — the words are `work-report.ts`'s, proved by a census that reads the code
 *    with its prose stripped, and by driving every {@link TASK_STATES} member through both.
 *  - **§4** the panel — the fifth sentence, and the precedence that decides which one it gets.
 *  - **§5** the derivations — the cadence, the age threshold, and the walk word.
 *
 * ⚑ **Real host, real SQLite, real migrations, real tools** — the work has to be given through the
 * door that gives work, because the fold reads a ledger and nothing else.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const rendererLib = join(here, '../src/renderer/src/lib')

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
 * only** — `a-source-census-must-strip-prose-before-it-asserts`. Block comments and line comments
 * go; string literals stay, because the words a surface draws are string literals.
 */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')

const libSource = (name: string): string => readFileSync(join(rendererLib, name), 'utf8')

describe('508 · the work this conversation gave out', () => {
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

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-508-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-508-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 8_000_000
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

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  /**
   * ⚑ **D-016 · a give, through the real door** — it starts the conversation the first time and its
   * brief is that conversation's first turn, which parks on the Fake's card (the giver's `ask`).
   * The title is the words a row draws, so it is the brief too.
   */
  const givesWork = async (
    pmTools: AgentToolset,
    profile: string,
    title: string,
  ): Promise<string> => {
    const said = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile,
      title,
      brief: title,
    })
    expect(said.outcome, JSON.stringify(said)).toBe('ok')
    return said.agent as string
  }

  /**
   * A PM in a window, and the one worker it gave a piece to. ⚑ **D-014** — any agent may give work
   * to any existing identity, so no grant is set.
   */
  const aPmAndItsWorker = async (
    title: string,
    options: { workerProfile?: string } = {},
  ): Promise<{ pm: string; worker: string; pmTools: AgentToolset }> => {
    const workerProfile = options.workerProfile ?? 'worker'
    await bringIdentityIntoBeing(workerProfile)
    const pm = await personOpens('pm')
    const pmTools = theToolsetJustHandedOut()
    const worker = await givesWork(pmTools, workerProfile, title)
    return { pm, worker, pmTools }
  }

  /** ⚑ The label the Nth piece a conversation gave out under its root takes. */
  const labelUnderTheRootOf = (giver: string, nth: number): string =>
    `${store.rootOf(giver)?.label ?? 'no root'}.${String(nth)}`

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the store — a real ledger, and the two facts the older reader cannot state
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · the store walks the ledgers it opened, and says how many of each', () => {
    it('🔴 a parent reads back the work it gave, with the holder’s identity resolved', async () => {
      const { pm, worker } = await aPmAndItsWorker('read the brief and report')

      const walked = store.workGivenOutBy(pm)
      expect(walked.walk).toBe('every-conversation-this-one-gave-work-to')
      // ⛔ **One LEDGER was opened, and it is counted off the candidate query rather than off the
      // rows** — `ledgers: 1, rows: 0` and `ledgers: 0, rows: 0` are different facts.
      expect(walked.ledgers).toBe(1)
      expect(walked.rowsUnread).toBe(0)
      expect(walked.rows).toHaveLength(1)

      const [row] = walked.rows
      expect(row?.label).toBe(labelUnderTheRootOf(pm, 1))
      expect(row?.title).toBe('read the brief and report')
      // ⚠️ **609 · the walked row is COMPOSED** (`603` made it so, `609` widened it): this worker
      // is parked on the card the Fake raises for every turn, so a person owes a decision and the
      // row says so. ⛔ The raw fold beside it still says `working`.
      expect(row?.state).toBe('waiting-on-a-person')
      expect(store.piecesOwnedBy(worker)[0]?.state).toBe('working')
      // 🔴 **The identity, resolved where the BINDING lives.** This is the field `agentName` joins
      // on, and resolving it in main is what stops a conversation created since the window mounted
      // from reading as nothing — `472` F3.
      expect(row?.givenToProfile).toBe('worker')
      // ⛔ **Absences, not nulls** — the wire's own spelling, and what lets `workReading` word it.
      expect(row).not.toHaveProperty('outcome')
      expect(row).not.toHaveProperty('stalledBecause')
      expect(row).not.toHaveProperty('needsUserAction')
    })

    it('⛔ …and a conversation that gave nobody work opens NO ledger, which is not the same as none', async () => {
      const quiet = await personOpens('pm')
      const walked = store.workGivenOutBy(quiet)
      expect(walked.rows).toEqual([])
      // ⚑ **`ledgers: 0` under the giver's own word**, which is *this conversation handed nobody
      // work* — and is a different sentence from `no-ledger`, which is *this app has no database*.
      expect(walked.ledgers).toBe(0)
      expect(walked.walk).toBe('every-conversation-this-one-gave-work-to')
    })

    it('🔴 an unreadable ledger row is COUNTED here and is silently dropped by `piecesGivenBy`', async () => {
      const { pm, worker } = await aPmAndItsWorker('the piece that survives')

      // ⛔ **The hazard is put on the path the code walks.** `toPersistedEvents` parses each row and
      // skips what it cannot read; the only way to reach that arm is a row whose payload is not the
      // shape it says it is. ⚑ `user_turn` is in `selectPieceEvents`' type list, so this row IS read
      // by the fold rather than filtered out before it.
      const ordinal =
        (
          db.prepare('SELECT max(ordinal) AS top FROM events WHERE session_id = ?').get(worker) as {
            top: number
          }
        ).top + 1
      db.prepare(
        `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
         VALUES (?, ?, (SELECT coalesce(max(generation), 0) FROM events WHERE session_id = ?), ?, 'user_turn', ?, ?)`,
      ).run('evt_unreadable', worker, worker, ordinal, '{not json at all', clock)

      const walked = store.workGivenOutBy(pm)
      expect(walked.rowsUnread).toBe(1)
      // ⚑ **The rows are still there** — an unread ledger row usually folds into no row at all, so
      // this number and the rows do not add up to anything, which is exactly why it is its own field.
      expect(walked.rows).toHaveLength(1)

      // 🔴 **The defect this reader closes, measured on the reader that still has it.** The older
      // door answers the same rows and has nowhere to put the count.
      const older: readonly PieceRow[] = store.piecesGivenBy(pm)
      expect(older).toHaveLength(1)
      expect(older[0]?.piece).toBe(walked.rows[0]?.piece)
    })

    it('⛔ two ledgers, and the walk is ordered by WHEN rather than by number', async () => {
      const { pm, pmTools } = await aPmAndItsWorker('first, to the first worker')

      await bringIdentityIntoBeing('other')
      await givesWork(pmTools, 'other', 'second, to the second worker')

      const walked = store.workGivenOutBy(pm)
      // ⛔ **Two ledgers opened, counted off the candidate query** — the work lives in the CHILDREN's
      // ledgers, one each, and neither of them is this conversation's own.
      expect(walked.ledgers).toBe(2)
      expect(walked.rows.map((row) => row.givenToProfile)).toEqual(['worker', 'other'])

      // 🔴 **Ordered by when the work was handed out, and the order is TOTAL.** ⛔ `walkLedgers`
      // concatenates in candidate order and `SELECT DISTINCT` states no ordering, so without this
      // the list would reshuffle itself under a reader on every poll.
      const at = walked.rows.map((row) => row.givenAt)
      expect(at[0]).toBeLessThan(at[1] ?? 0)
      expect(walked.rows.map((row) => row.label)).toEqual([
        labelUnderTheRootOf(pm, 1),
        labelUnderTheRootOf(pm, 2),
      ])
      // ⚠️ **D-016 numbers every piece under the one it was given from, so the labels agree with
      // the order here.** ⛔ Labels under different parents do not sort by number, and this reader
      // orders by `givenAt` and never by label.
    })

    it('🔴 one holder, two parents — the FOLD decides, and `ledgers` counts what was opened', async () => {
      // ⛔ **The divergence this rail is for.** One conversation can hold work from two parents, so
      // a candidate ledger is not an answer: every row it produces is checked against the caller.
      // ⚠️ A test where each parent has its own holder measures nothing — the predicate alone gives
      // the right answer there, which is `a-rule-measured-only-where-both-readings-agree`.
      const { pm, worker, pmTools } = await aPmAndItsWorker('from the first parent')

      // A second PM, and a SECOND holder of its own, so that the first PM's candidate set contains
      // a ledger that produces nothing for it.
      await bringIdentityIntoBeing('second')
      const rival = await personOpens('pm2')
      const rivalTools = theToolsetJustHandedOut()
      await givesWork(rivalTools, 'second', 'from the second parent')

      // ⛔ **And now the shared holder**: the first PM's worker holds a second piece of work from
      // the SECOND parent, so one ledger carries both parents' rows.
      //
      // ⚑ **The first piece is taken back first** — the door that closes work without ending
      // anything, and it leaves the row in the ledger, so the first parent's row reads an ending
      // the fold wrote rather than one it was handed.
      const takenBack = await callOn(pmTools, 'withdraw_task', {
        piece: store.piecesGivenBy(pm)[0]!.label,
      })
      expect(takenBack.outcome, JSON.stringify(takenBack)).toBe('ok')
      // ⚑ **No door writes that row** (D-016): a give reaches only a conversation its giver
      // started — the control is at the end — so a ledger holding it is PLANTED, in the shape the
      // give writes (its `work` row and its `work_given`, in one transaction), and the fold, not
      // the door, is what this test measures.
      const theirRoot = store.rootOf(rival)!
      const number = store.numberUnder(theirRoot.piece)
      const across = 'from the second parent, into the first parent’s worker'
      store.recordGive(
        {
          piece: 'work_from_another_giver',
          parent: theirRoot.piece,
          number,
          owner: worker,
          givenBy: rival,
          title: across,
          brief: across,
          folder: null,
          inputs: [],
        },
        store.nextOrdinal(worker),
        {
          type: 'work_given',
          piece: 'work_from_another_giver',
          label: `${theirRoot.label}.${String(number)}`,
          parent: theirRoot.piece,
          givenBy: rival,
          title: across,
          brief: across,
        },
        tick(),
      )

      const mine = store.workGivenOutBy(pm)
      const theirsWalked = store.workGivenOutBy(rival)
      // 🔴 **Each parent reads ONLY its own**, out of a ledger that holds both.
      expect(mine.rows.map((row) => row.title)).toEqual(['from the first parent'])
      expect(mine.rows.map((row) => row.state)).toEqual(['withdrawn'])
      expect(theirsWalked.rows.map((row) => row.title)).toEqual(['from the second parent', across])
      expect([mine.ledgers, mine.rows.length]).toEqual([1, 1])
      expect([theirsWalked.ledgers, theirsWalked.rows.length]).toEqual([2, 2])

      // ⚑ **The control — no door writes that row**: the second parent's give to the same agent
      // reaches a conversation of its OWN, and never the first parent's worker.
      const own = await callOn(rivalTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: across,
        brief: across,
      })
      expect(own.outcome, JSON.stringify(own)).toBe('ok')
      expect(own.agent).not.toBe(worker)
    })

    it('🔴 a ledger that folds to NOTHING is still a ledger this walk opened', async () => {
      // ⛔ **The one place `ledgers` and `rows.length` genuinely diverge, and the divergence is
      // built into the two reads.** The candidate set is read off `work` and carries NO generation
      // filter — *"the work I gave out does not stop being true because a projection was rebuilt"*
      // — while `piecesOfSession` reads the ACTIVE generation only. ⚑ So a conversation whose piece
      // rows live in a projection this app has replaced is a candidate ledger that produces no row.
      //
      // 🔴 **Without this case the two numbers agree everywhere** — a candidate is found because a
      // `work` row names this parent as its giver, so the fold normally produces at least one row
      // for it. ⚠️ `a-rule-measured-only-where-both-readings-agree`: the first version of this test
      // asserted `[1, 1]` and `[2, 2]`, and a mutation deriving `ledgers` from `rows.length`
      // survived it.
      const { pm, worker } = await aPmAndItsWorker('work that a rebuild left behind')
      expect(store.workGivenOutBy(pm).rows).toHaveLength(1)

      // ⚠️ **INSERT, not UPDATE — the row is written lazily.** `activeGeneration` answers `0` for a
      // conversation with no `derived_generation` row at all, so an `UPDATE` matches nothing and the
      // test passes over an unbumped generation. ⛔ Found by this assertion failing at `[1, 1]`.
      db.prepare(
        `INSERT INTO derived_generation
           (session_id, active, normalizer_version, derived_through, highest, updated_at)
         VALUES (?, 1, 1, 0, 1, ?)
         ON CONFLICT(session_id) DO UPDATE SET active = active + 1`,
      ).run(worker, clock)

      const walked = store.workGivenOutBy(pm)
      // ⛔ **One ledger opened, no rows read** — and `rows.length` is `0` for this, for a parent that
      // gave nobody work, and for a store with no database at all. ⚑ Only `ledgers` and the walk
      // word tell the three apart, which is `LEDGER_WALK_KINDS`' whole reason for existing.
      expect([walked.ledgers, walked.rows.length]).toEqual([1, 0])
      expect(walked.walk).toBe('every-conversation-this-one-gave-work-to')
      // ⚠️ **And the fold draws no *gave nobody work* sentence over it by accident** — the doubt is
      // null here, so the empty IS claimed, and what makes that honest is the walk sentence beside
      // it saying only the live projection was read.
      expect(WALK_COVERS[walked.walk]).toContain('live projection')
    })

    it('⛔ a holder this app never placed still appears, named by nothing', async () => {
      // 🔴 **Both joins are LEFT, and an INNER one would have been a silent filter.** A conversation
      // with `agent_identity_id IS NULL` is `438`'s `never-placed` population — it was still given
      // work, and a list whose whole subject is *what did I hand out* may not drop it.
      const { pm, worker } = await aPmAndItsWorker('given to a conversation nothing placed')
      db.prepare('UPDATE provider_session SET agent_identity_id = NULL WHERE id = ?').run(worker)

      const walked = store.workGivenOutBy(pm)
      expect(walked.rows).toHaveLength(1)
      expect(walked.rows[0]?.givenToProfile).toBeNull()
      // ⚠️ The paired positive, in the same shape: with the identity back, the slug is back.
      db.prepare(
        `UPDATE provider_session SET agent_identity_id = (SELECT id FROM agent_identity WHERE slug = 'worker') WHERE id = ?`,
      ).run(worker)
      expect(store.workGivenOutBy(pm).rows[0]?.givenToProfile).toBe('worker')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the wire
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the wire carries the walk and never recomputes it', () => {
    it('🔴 the host answers the store’s walk, field for field', async () => {
      const { pm } = await aPmAndItsWorker('something to do')

      const fromHost = host.workGivenBy(pm)
      const fromStore = store.workGivenOutBy(pm)
      // ⛔ **Equality against the store, not a re-derivation** — `453`'s rule: the party that WALKED
      // is the only one that can say what it walked, and a second derivation one layer up could
      // answer a number the walk never used.
      expect(fromHost).toEqual(fromStore)
    })

    it('🔴 …including the count only the walk can state', async () => {
      const { pm, worker } = await aPmAndItsWorker('something to do')
      const ordinal =
        (
          db.prepare('SELECT max(ordinal) AS top FROM events WHERE session_id = ?').get(worker) as {
            top: number
          }
        ).top + 1
      db.prepare(
        `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
         VALUES (?, ?, (SELECT coalesce(max(generation), 0) FROM events WHERE session_id = ?), ?, 'user_turn', ?, ?)`,
      ).run('evt_unreadable', worker, worker, ordinal, '{not json at all', clock)

      // ⛔ **The host carries it.** A host that answered `rowsUnread: 0` would be telling a window
      // the list is whole over a walk that said it is short — `453`'s rule with the sign flipped.
      expect(host.workGivenBy(pm).rowsUnread).toBe(1)
      expect(host.workGivenBy(pm)).toEqual(store.workGivenOutBy(pm))
    })

    it('⛔ …and it is the same data `list_tasks` reads, through a different door', async () => {
      const { pm } = await aPmAndItsWorker('something to do')

      // ⚑ **The honest census for this verb is *two doors, one derivation*** — a test asserting
      // that no toolset publishes `workGivenBy` would be false, and saying so is the point.
      const gave = host.pieceBoard(pm).gave
      expect(gave.map((piece) => piece.piece)).toEqual(
        host.workGivenBy(pm).rows.map((row) => row.piece),
      )
    })

    it('🔴 the renderer’s store turns a refusal into `null`, and never into an empty walk', async () => {
      // ⛔ **The fifth read in that store with this shape.** Every empty this reader can answer is a
      // STATEMENT — this conversation gave nobody work, this app has no ledger — and each is drawn
      // as its own sentence. A failed call is none of those and must not borrow one of their words.
      const asked: string[] = []
      const refusing = createRendererStore(
        bridgeThat({
          workGivenBy: async (input: { sessionId: string }) => {
            asked.push(input.sessionId)
            throw new Error('the bridge is gone')
          },
        }),
      )
      await expect(refusing.workGivenBy('sess_pm')).resolves.toBeNull()
      // ⚠️ Non-vacuity: the door really was knocked on, so `null` is the catch and not a stub.
      expect(asked).toEqual(['sess_pm'])

      // ⚑ **The paired positive**: an answering bridge's walk reaches the caller, so the `null`
      // above is a refusal rather than this reader's only answer.
      const walk = {
        rows: [],
        walk: 'every-conversation-this-one-gave-work-to' as const,
        ledgers: 0,
        rowsUnread: 0,
      }
      const answering = createRendererStore(bridgeThat({ workGivenBy: async () => walk }))
      // ⛔ **`toEqual` and never `toBe`, and the difference is the wire.** `ipcRenderer.invoke`
      // structured-clones the ANSWER as well as the arguments, so the object the shipped renderer
      // holds is never the one main built. ⚠️ An identity assertion here would pass against this
      // double and describe something the app never does.
      await expect(answering.workGivenBy('sess_pm')).resolves.toEqual(walk)
    })

    it('⚠️ every field of the narrowed row is one a surface reads, and no field of `PieceRow` leaks', async () => {
      const { pm } = await aPmAndItsWorker('something to do')
      const [row] = host.workGivenBy(pm).rows
      expect(row).toBeDefined()
      // ⛔ **`WorkReport`'s rule, applied**: *"A dead field on a DURABLE wire contract is worse than
      // dead code."* Every key here is drawn or folded by `work-given-out.ts`; the `PieceRow`
      // fields that are not are absent by construction rather than by omission.
      expect(row?.definitionOfDone).toBe('The requested result and its checks are recorded.')
      expect(Object.keys(row as WorkGivenOut).sort()).toEqual([
        'definitionOfDone',
        'givenAt',
        'givenToProfile',
        'label',
        'piece',
        'state',
        'title',
      ])
      for (const gone of [
        'messageId',
        'endedAt',
        'brief',
        'parent',
        'giver',
        'owner',
        'stalledAt',
        'stalledBy',
        'questionLostAtRestart',
        'resources',
        'statusLine',
      ]) {
        expect(row).not.toHaveProperty(gone)
      }
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the fold and its words
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · the fold words nothing of its own', () => {
    const AT = 5_000_000
    const rowOf = (over: Partial<WorkGivenOut> = {}): WorkGivenOut => ({
      piece: 'work_a',
      label: 'W1.3',
      title: 'the piece’s title',
      state: 'working',
      givenToProfile: 'worker',
      givenAt: AT - 60_000,
      ...over,
    })
    const readingOf = (
      rows: readonly WorkGivenOut[],
      over: Partial<WorkGivenOutReading> = {},
    ): WorkGivenOutReading => ({
      conversation: 'sess_pm',
      walk: {
        rows,
        walk: 'every-conversation-this-one-gave-work-to',
        ledgers: rows.length,
        rowsUnread: 0,
      },
      answered: true,
      at: AT,
      ...over,
    })
    const view = (
      rows: readonly WorkGivenOut[],
      over: Partial<WorkGivenOutReading> = {},
      now = AT,
    ) =>
      workGivenOutView({
        reading: readingOf(rows, over),
        forConversation: 'sess_pm',
        identities: null,
        now,
      })

    it('🔴 every TaskState reads exactly what `work-report.ts` says it reads', () => {
      // ⛔ **Driven over `TASK_STATES` rather than over a list in this file** —
      // `a-loop-over-a-literal-variant-list-is-not-exhaustive`, which is what §2.1 of the dispatch
      // asked for. A sixth state gains a word in one table and this assertion picks it up.
      for (const state of TASK_STATES) {
        const drawn = view([rowOf({ state })])?.rows[0]
        expect(drawn?.word, state).toBe(WORK_STATE_WORD[state])
        expect(drawn?.open, state).toBe(TASK_IS_OPEN[state])
      }
      // ⚑ The control: the vocabulary is not all one string, so the loop above compared something.
      expect(new Set(Object.values(WORK_STATE_WORD)).size).toBe(TASK_STATES.length)
    })

    it('⛔ …and a stalled row reads the CAUSE, which is `shared/tasks.ts`’ table and not this one', () => {
      const drawn = view([rowOf({ state: 'stalled', stalledBecause: 'app_restarted' })])?.rows[0]
      expect(drawn?.word).toBe(UNDRIVEN_SENTENCES.app_restarted.replace(/\.$/, ''))
      // ⚠️ The paired negative: the state word is what a row WITHOUT a cause gets, so the line above
      // is a choice rather than the only thing the fold can say.
      expect(view([rowOf({ state: 'stalled' })])?.rows[0]?.word).toBe(WORK_STATE_WORD.stalled)
    })

    it('⛔ the fold spells none of the ten sentences it draws — the census, with two controls', () => {
      // 🔴 **`222` §4's one-vocabulary rule, enforced rather than promised.** If this file ever
      // writes one of these strings, two surfaces have begun describing one fold differently.
      //
      // ⛔ **It reads STRING LITERALS and not the raw text, and the difference is the whole
      // instrument.** `WORK_STATE_WORD.answered` is the single word *answered*, which is also a
      // FIELD name on the reading this file folds — a `toContain` over the source fails on
      // `reading.answered` and says nothing about the vocabulary. ⚑ What the rule is actually
      // about is a surface WRITING one of these sentences, and a written sentence is a literal.
      //
      // ⛔ **542 · read off the AST rather than a quote regex** (`536` F3). The extractor here used
      // to be `/'…'|`…`/`, which cannot see a string prettier double-quoted because it contains a
      // straight `'` — and `WORK_STATE_WORD` is a vocabulary of SENTENCES, which is where
      // apostrophes live. ⚠️ **Latent rather than live at `542`**: `work-given-out.ts` carries no
      // double-quoted literal today, so nothing was passing that should have failed. ⚑ It is
      // repaired anyway, because the day one of these sentences gains an apostrophe is the day the
      // census would go quiet without saying so (standing rule 27).
      const path = join(rendererLib, 'work-given-out.ts')
      const source = libSource('work-given-out.ts')
      const literals = new Set(visibleCopy(path, source).map((one) => one.text))
      const owned = [...Object.values(WORK_STATE_WORD), ...Object.values(UNDRIVEN_SENTENCES)]
      expect(owned.length).toBe(TASK_STATES.length + Object.keys(UNDRIVEN_SENTENCES).length)
      for (const sentence of owned) {
        expect([...literals], `work-given-out.ts spells ${sentence}`).not.toContain(sentence)
      }
      // ⚠️ **Control 1, in two halves, because the rewrite at `542` split them.** The first line
      // controls the READ — `libSource` really opened a file with the constant in it — and the
      // second controls the READER, which is the only one of the two that used to be a regex. ⛔ A
      // `visibleCopy` that returned nothing passes every line above and fails the second of these.
      expect(source).toContain('export const NOTHING_GIVEN_OUT')
      expect(literals).toContain(NOTHING_GIVEN_OUT)
      // ⚠️ **Control 2, on the EXTRACTOR, now once PER SPELLING** (542, standing rule 12): the same
      // owned sentence is planted single-quoted and double-quoted, and found both times. ⛔ The
      // second of these is the one the old extractor could not see.
      for (const quoted of [
        `const x = '${WORK_STATE_WORD.stalled}'`,
        `const x = "${WORK_STATE_WORD.stalled}"`,
      ]) {
        expect(visibleCopy('planted.ts', quoted).map((one) => one.text)).toContain(
          WORK_STATE_WORD.stalled,
        )
      }
    })

    it('🔴 the empty sentence is withheld whenever the reading is in doubt', () => {
      expect(view([])?.empty).toBe(NOTHING_GIVEN_OUT)
      // ⛔ *This conversation has given nobody work* and *this list did not answer just now* are two
      // sentences that deny each other, and both are reachable at once.
      const refused = view([], { answered: false })
      expect(refused?.empty).toBeNull()
      expect(refused?.doubt).toBe('the-read-did-not-answer')
      expect(WORK_DOUBT_WORDS[refused!.doubt!]).toContain('did not answer just now')
    })

    it('⚠️ a refusal outranks an unspellable word, because it is a fact about THIS read', () => {
      const bothWrong = view([], {
        answered: false,
        walk: {
          rows: [],
          walk: 'a-word-from-a-later-build' as never,
          ledgers: 0,
          rowsUnread: 0,
        },
      })
      expect(bothWrong?.doubt).toBe('the-read-did-not-answer')
      // ⚑ …and the other arm is reachable on its own, so the order above is a choice.
      const onlyTheWord = view([], {
        walk: {
          rows: [],
          walk: 'a-word-from-a-later-build' as never,
          ledgers: 0,
          rowsUnread: 0,
        },
      })
      expect(onlyTheWord?.doubt).toBe('a-word-this-app-cannot-spell')
      expect(onlyTheWord?.says).toBeNull()
    })

    it('⛔ the tally is absent at zero and counts only OPEN work', () => {
      expect(view([])?.openCount).toBeNull()
      expect(view([rowOf({ state: 'answered' })])?.openCount).toBeNull()
      expect(
        view([rowOf({ state: 'answered' }), rowOf({ piece: 'work_b', state: 'stalled' })])
          ?.openCount,
      ).toBe(1)
    })

    it('🔴 a state naming a prototype member counts as CLOSED, and `??` would have counted it open', () => {
      // ⛔ `TASK_IS_OPEN['constructor']` is a FUNCTION — truthy, and neither null nor undefined.
      // Reachable rather than defensive: `toPersistedEvents` casts and a `.brobot` bundle is written
      // through `.passthrough()`.
      const drawn = view([rowOf({ state: 'constructor' as TaskState })])?.rows[0]
      expect(drawn?.open).toBe(false)
      // ⚠️ The measurement that says the guard is doing work: the naive read is truthy.
      expect(Boolean((TASK_IS_OPEN as Record<string, unknown>)['constructor'])).toBe(true)
      // ⚑ …and the word falls through to `work-report.ts`' own fallback rather than printing
      // `undefined`, which is the same guard one file over.
      expect(drawn?.word).toBe('in a state this app has not been taught')
    })

    it('⚑ the name is `agentName`’s, and a roster that has never heard of the identity says its slug', () => {
      expect(view([rowOf({ givenToProfile: 'ops' })])?.rows[0]?.who).toBe('ops')
      // ⛔ **`null` is *this app has no binding for that conversation*** and folds into the same
      // label `agentName` already gives a null profile.
      expect(view([rowOf({ givenToProfile: null })])?.rows[0]?.who).toBe(DEFAULT_PROFILE_LABEL)
    })

    it('⚠️ W4.74 · an answered list says no age, however old; rows kept after a refusal do', () => {
      // ⚑ D-033 · the list is read again on every move of its work, so an answered reading is the
      // current one; only a kept one may be behind.
      expect(view([rowOf()], {}, AT + 3_600_000)?.asOf).toBeNull()
      expect(view([rowOf()], { answered: false }, AT + 120_000)?.asOf).not.toBeNull()
    })

    it('⛔ a reading about ANOTHER conversation draws nothing at all', () => {
      // 🔴 A person can open conversation A and then B inside one round trip; without this guard the
      // kept-last-good list would draw A's work under B's drawer.
      expect(
        workGivenOutView({
          reading: readingOf([rowOf()]),
          forConversation: 'sess_someone_else',
          identities: null,
          now: AT,
        }),
      ).toBeNull()
    })

    it('⚑ an omitted reading is the same as none — the shape seventeen render files pass', () => {
      // ⛔ `SessionDrawer` declares `work` as `… | null`, so a mount that OMITS it type-checks and
      // passes `undefined`. Before this guard the computed THREW and took every such mount down.
      expect(
        workGivenOutView({
          reading: undefined as never,
          forConversation: 'sess_pm',
          identities: null,
          now: AT,
        }),
      ).toBeNull()
    })

    it('🔴 the row is worded by the SAME function the transcript’s work-report row is', () => {
      // ⛔ Not a claim about two tables agreeing — the same call, over the same fields.
      const row = rowOf({ state: 'answered', outcome: 'done', needsUserAction: true })
      const drawn = view([row])?.rows[0]
      const { heading, word, outcome, mark } = workReading(row)
      expect({
        heading: drawn?.heading,
        word: drawn?.word,
        outcome: drawn?.outcome,
        mark: drawn?.mark,
      }).toEqual({ heading, word, outcome, mark })
      expect(mark).toBe('a person has to act')
    })

    it('⚠️ the piece’s TITLE is drawn whole, and an empty title draws nothing', () => {
      // ⚑ **D-016 · a piece has a title**, one line bounded where it is given, so the row draws it
      // verbatim — where it once cut a work message down to its first line.
      expect(view([rowOf()])?.rows[0]?.said).toBe('the piece’s title')
      expect(view([rowOf({ title: '' })])?.rows[0]?.said).toBe('')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the panel's fifth sentence
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · the Open tab names where the list is, and never lists it', () => {
    const quiet = { stillRunning: false, runningNamed: false, scheduled: false }

    it('🔴 a conversation that gave out work gets the fifth sentence', () => {
      expect(panelEmptyWords(quiet, true)).toEqual(PANEL_EMPTY_WORDS.gaveWork)
      expect(PANEL_EMPTY_WORDS.gaveWork.body).toContain('Work tab')
      // ⛔ **It names WHERE** — `239`: a refusal states its own workaround.
      expect(panelEmptyWords(quiet, false)).toEqual(PANEL_EMPTY_WORDS.quiet)
    })

    it('⛔ …and it ranks below both of the sentences about THIS conversation', () => {
      // ⚠️ Running work is in flight here and has a Stop behind it; a schedule is a promise this
      // conversation will keep itself; work handed out is somewhere else and nothing here can act
      // on it. A conversation that is all three gets the running paragraph.
      expect(panelEmptyWords({ ...quiet, scheduled: true }, true)).toEqual(
        PANEL_EMPTY_WORDS.scheduled,
      )
      expect(
        panelEmptyWords({ stillRunning: true, runningNamed: true, scheduled: true }, true),
      ).toEqual(PANEL_EMPTY_WORDS.running)
    })

    it('⚠️ the heading is the same in all five, which is `250`’s ruling and not inertia', () => {
      // ⚑ **577 changed the WORDS and left the ruling standing.** The arms differ in what else is
      // going on — detached work, a schedule, work handed out — never in what is OPEN, and what is
      // open is all the heading claims. ⛔ Derived from the constant rather than listed, so a sixth
      // arm is covered by this block on the day it is written.
      const heads = new Set(Object.values(PANEL_EMPTY_WORDS).map((words) => words.head))
      expect([...heads]).toEqual(['No permissions or questions are on a card here'])
    })

    it('⛔ the Open tab’s words spell no piece of work and no task state', () => {
      // 🔴 The boolean is all it is given, so there is nothing for it to describe — see
      // `SessionPanel.vue`'s `gaveWork` prop. A census, because the temptation is a count.
      const body = PANEL_EMPTY_WORDS.gaveWork.body
      for (const word of Object.values(WORK_STATE_WORD)) expect(body).not.toContain(word)
      expect(body).not.toMatch(/\d/)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · the derivations
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · every number here is derived from one somebody already argued for', () => {
    it('⛔ no cadence of its own (W4.74, D-033), and no literal milliseconds in the module', () => {
      const source = code(libSource('work-given-out.ts'))
      expect(source).not.toContain('EVERY_MS')
      // ⚠️ **No literal milliseconds anywhere in the module's code** — a number chosen here is
      // the thing `LOOK_EVERY_MS`'s docblock refuses.
      expect(source).not.toMatch(/\b\d{2,3}_\d{3}\b/)
    })

    it('⛔ the walk word is in the register, with a sentence of its own', () => {
      expect(LEDGER_WALK_KINDS).toContain('every-conversation-this-one-gave-work-to')
      const says = WALK_COVERS['every-conversation-this-one-gave-work-to']
      // 🔴 It promises no narrowing at all, and it carries the generation clause. ⚑ D-016 took the
      // project out of both the sentence and the walk, so the no-narrowing half is what is left.
      expect(says).toContain('no window, no page and no limit narrowed it')
      expect(says).toContain('live projection')
    })

    it('⚑ the store’s narrowing and the shared builder agree, field for field', async () => {
      const { pm } = await aPmAndItsWorker('a piece of work')
      const [piece] = store.piecesGivenBy(pm)
      expect(piece).toBeDefined()
      // ⛔ **One builder, two readers** — the store maps through `workGivenOut`, so a field added to
      // the narrowed shape cannot reach one of them and not the other.
      //
      // ⚠️ **609 · the walk COMPOSES before it maps, so the raw row is fed through the same
      // composition here rather than the assertion being loosened.** ⛔ Stripping `state` from the
      // comparison would have left this passing over a shape that had stopped agreeing —
      // `a-mutation-on-a-census-is-invisible-to-that-census`. ⚑ What it pins is unchanged: ONE
      // builder words both readers, field for field.
      expect(store.workGivenOutBy(pm).rows[0]).toEqual(
        workGivenOut({ ...piece!, state: 'waiting-on-a-person' }, 'worker'),
      )
    })
  })
})
