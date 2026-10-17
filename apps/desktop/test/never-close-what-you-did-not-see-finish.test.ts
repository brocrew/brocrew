import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type {
  AgentToolset,
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
import { isGiverStallNotice, RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  TASK_IS_OPEN,
  AN_ASK_RIDES_ON,
  TASK_STALL_CAUSES,
  TASK_STATES,
  UNDRIVEN_SENTENCES,
  derivePieces,
} from '../src/shared/tasks'
import { pieceLine } from '../src/shared/piece-called'
import type { PieceRow, TaskState } from '../src/shared/tasks'
import { REQUEST_IS_OPEN, REQUEST_STATES } from '../src/shared/questions'
import { MAILBOX_KINDS } from '../src/shared/runtime-ipc'
import type {
  PersistedEventInfo,
  RuntimeEventMessage,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * 🔴 **400 · never close what you did not see finish** — HO-018's three amendments, under one
 * principle.
 *
 * ## ⛔ The principle, in the PO's own words
 *
 * > **The engine never terminally closes work it did not observe finishing. It records what it
 * > observed, surfaces it, and the parent decides.**
 *
 * ⚠️ **HO-018 §3 says why all three criteria had to move together:** *"three of my fifteen criteria
 * specified a MECHANISM where they should have specified a PROPERTY."* ⛔ 4 asked for *"fails the
 * task and tells the parent"*, 5 asked for an idle timeout, 14 asked for a pending question
 * *"rebuilt from the ledger"*; what the PO wanted was *nobody waits forever in silence* and *nothing
 * in flight is silently lost across a restart*.
 *
 * ## 🔴 §1 · the vocabulary decision, which had to be made before anything could be built
 *
 * ⛔ **`393`'s `silent` and `398`'s `stalled` were one observation wearing two names**, and the
 * retraction of criterion 5 is what made them one: with the idle window gone, the only surviving
 * producer of *nothing is driving this work* is a turn ending, which is exactly what `silent` was.
 * ⚑ **`stalled` survives**, because it is a claim about the WORK rather than about the child's
 * manners — and two of the three things that now produce it are cases where the child was not silent
 * at all: it was stopped, or its app was killed. ⚠️ Which of them happened is
 * {@link PieceRow.stalledBecause}, a field beside the word — `397`'s ruling about an actor, pointed at
 * a cause.
 *
 * ## ⛔ §2 · the push, with the hazard on the path
 *
 * **HO-018 §2.1:** *"the change is that the condition is PUSHED, not merely visible to a poll."*
 * ⚠️ **A test that passes because a poll would have found it is not evidence**, so every push here is
 * measured with **no window attached** — the sink is dead before the turn ends, and what is asserted
 * is a row in the PARENT's own ledger.
 *
 * ## 🔴 §3 and §4 · criterion 14, which had never written anything at all
 *
 * ⛔ **`settleOrphanRuns` closes the turn row and appends NO event**, so a task whose child was
 * mid-turn when the app died derived `working` for the rest of its life and nobody was ever told.
 * ⚑ {@link WorkRestartedEvent} is the row that says so, and §3 kills an app mid-turn and reads it
 * back. ⚠️ §4 is HO-018 §2.4's amendment: the question is not REBUILT — `396`'s sweep closes it, and
 * that is right — it is not silently LOST, and the task carries the fact.
 *
 * ## ⚠️ What this dispatch overturned, listed rather than left to be found in a diff
 *
 *  - **`393` §6 · a task RUNNING when the app quit could not be answered afterwards.** It was filed
 *    as a finding against criterion 14 by the dispatch that measured it; HO-018 §2.3 ruled it, and
 *    `a-reply-and-its-absence.test.ts` now asserts the opposite.
 *  - **`379` · a conversation ending ABANDONED its open tasks, terminally.** Same ruling: *"nothing
 *    about a quit tells us the work failed."*
 *  - **`393`/`398` · an interrupted turn was excluded from the fold.** Their reason was the word
 *    `silent`, which is gone.
 *  - **`398` · the whole quiet clock.** 26 assertions were run RED and removed; what survived is in
 *    `the-two-clocks.test.ts`.
 *
 * ⚑ **Real host, real SQLite, real migrations, real tools, real filesystem.** The only double is the
 * provider.
 *
 * ⚑ **D-016 · a task is a PIECE**, given with `give_work` — which starts the worker's conversation
 * the first time and makes its brief that conversation's first turn — and every row below is read
 * by the piece's id, and every notice by its label.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const mainRoot = join(here, '../src/main')
const sharedRoot = join(here, '../src/shared')

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
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

/** `394`'s double, with the handles kept — a test has to BE the provider to ask like one. */
class ProviderDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
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

describe('400 · never close what you did not see finish', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  let claimed: Set<string>
  let pairs: number
  const tick = (): number => clock++

  const buildHost = (over: SessionStore = store): RuntimeHost => {
    const built = new RuntimeHost({
      store: over,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued),
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-undriven-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-undriven-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
    claimed = new Set()
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
    pairs = 0
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const ledger = (sessionId: string): readonly PersistedEventInfo[] => store.events(sessionId)
  const events = (sessionId: string): TranscriptEvent[] =>
    ledger(sessionId).map((entry) => entry.event)

  const personOpens = async (
    profileId: string,
    on: RuntimeHost = host,
    provider: Provider = 'claude',
  ): Promise<string> => {
    const { sessionId } = await on.createSession(
      { provider, profileId, approvalMode: 'ask', cwd: root },
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
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const latestHandle = (): FakeSessionHandle => {
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('no provider handle has been issued')
    return handle
  }

  /** ⚑ **D-016 · one piece, by its id and by the label its notices name it by.** */
  interface Given {
    readonly piece: string
    readonly label: string
  }

  /** ⚑ **D-016 · a give, answered `ok`**, as the host wrote it down. */
  const aGive = async (
    tools: AgentToolset,
    profile: string,
    brief: string,
  ): Promise<Given & { worker: string; delivery: unknown }> => {
    const given = await callOn(tools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile,
      title: brief,
      brief,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return {
      worker: given.agent as string,
      piece: given.piece as string,
      label: given.label as string,
      delivery: given.delivery,
    }
  }

  /**
   * `393`'s helper: a PM in a window with one child of its own, started through the real door.
   *
   * ⚑ **D-016 · the door is `give_work`, and the brief IS the work** — where `spawn_agent` started
   * a child that was then sent its work as a message, the give starts the child with the work as its
   * first turn. ⚠️ That turn parks on the card the Fake raises every turn, as the message's did.
   */
  const aPmAndItsWorker = async (
    provider: Provider = 'claude',
    on: RuntimeHost = host,
    brief = 'the work',
  ): Promise<
    Given & {
      pm: string
      worker: string
      /** The worker's profile — what a second give to the same agent names. */
      profile: string
      pmTools: AgentToolset
      workerHandle: FakeSessionHandle
      /**
       * ⚑ **A piece for a SECOND child, for the rows that need a second piece beside the first.**
       * ⚠️ The first child's piece may have stalled, and D-016's stall rule refuses a stalled
       * holder a new give until that piece is followed up or taken back — so the control goes to
       * a second agent. Any agent may give work to either profile, so no grant is set for it.
       */
      giveAnother: (
        brief: string,
      ) => Promise<Given & { worker: string; workerHandle: FakeSessionHandle }>
    }
  > => {
    const nth = ++pairs
    const pmProfile = `pm-${String(nth)}`
    const workerProfile = `worker-${String(nth)}`
    for (const one of [workerProfile, `${workerProfile}-b`]) await bringIdentityIntoBeing(one)
    const pm = await personOpens(pmProfile, on, provider)
    const pmTools = agentToolsFor(on, pm)
    const first = await aGive(pmTools, workerProfile, brief)
    return {
      pm,
      worker: first.worker,
      profile: workerProfile,
      piece: first.piece,
      label: first.label,
      pmTools,
      workerHandle: latestHandle(),
      giveAnother: async (another) => {
        const second = await aGive(pmTools, `${workerProfile}-b`, another)
        return {
          worker: second.worker,
          piece: second.piece,
          label: second.label,
          workerHandle: latestHandle(),
        }
      },
    }
  }

  const cardsOn = (sessionId: string): number =>
    events(sessionId).filter((event) => event.type === 'permission_request').length

  /**
   * ⚠️ **`after` is how many cards this conversation had already raised**, and it is not a
   * convenience: a test that runs two turns would otherwise be satisfied by the FIRST turn's card and
   * would answer an id that has already been decided, leaving the second turn parked for ever.
   */
  const cardOn = async (sessionId: string, after = 0): Promise<string> => {
    await waitFor(() => cardsOn(sessionId) > after, 'the card the turn parks on')
    const asked = events(sessionId)
      .filter((event) => event.type === 'permission_request')
      .at(-1)
    if (asked === undefined || asked.type !== 'permission_request') {
      throw new Error('no permission request on the ledger')
    }
    return asked.id
  }

  /**
   * Answer the open card so the turn runs to its own terminal.
   *
   * ⚠️ **A person has to take the conversation over first, and that is the app's rule rather than
   * the test's convenience** (HO-005 Q2): a spawned child has no owner, and a permission is always a
   * person's — the parent that commands it may not answer for one.
   */
  const letTheTurnFinish = async (
    sessionId: string,
    on: RuntimeHost = host,
    after = 0,
  ): Promise<void> => {
    const turnsBefore = events(sessionId).filter((event) => event.type === 'turn').length
    const id = await cardOn(sessionId, after)
    if (!claimed.has(sessionId)) {
      on.claimSession(sessionId, window)
      claimed.add(sessionId)
    }
    await on.respondPermission(sessionId, id, { outcome: 'allow' }, window)
    await waitFor(
      () => events(sessionId).filter((event) => event.type === 'turn').length > turnsBefore,
      'the turn to reach its own terminal',
    )
  }

  const taskOf = (sessionId: string, piece: string): PieceRow | undefined =>
    store.piecesOwnedBy(sessionId).find((one) => one.piece === piece)

  const stateOf = (sessionId: string, piece: string): TaskState | undefined =>
    taskOf(sessionId, piece)?.state

  /**
   * ⛔ **What the PARENT was actually told**, off its own ledger — never off a sink. ⚑ Every push in
   * this file is asserted through this, with {@link RecordingSink.alive} false, which is the *no
   * window attached* HO-018 §6 asks for.
   */
  const wordsSentTo = (parent: string): string[] =>
    events(parent)
      .filter((event) => event.type === 'user_turn')
      .map((event) => (event.type === 'user_turn' ? event.text : ''))

  /**
   * ⚑ **D-016** — a notice names its piece by its line (`W1.2 · title`, `pieceLine`), never by its
   * id; the title is the one the give wrote down.
   */
  const noticesTo = (parent: string, label: string): string[] => {
    const given = store.workByLabel(label)
    if (given === null) throw new Error(`no piece is labelled ${label}`)
    const line = pieceLine(label, given.title)
    return wordsSentTo(parent).filter(
      (text) =>
        (text.includes(line) || text.startsWith(`${label} still needs attention:`)) &&
        isGiverStallNotice(text),
    )
  }

  /** ⛔ **Nobody is watching**, which is the state this app spends most of its life in. */
  const unplugTheWindow = (): void => {
    window.alive = false
  }

  /**
   * 🔴 **A conversation that was given work and whose app then DIED** — no clean quit, no ending
   * written, which is the ledger shape HO-018 §2.3 is about.
   *
   * ⚠️ **A second `SessionStore` OBJECT is what makes the next launch see it.** `live-hosts.ts`
   * identifies a ledger by object, so a host built on the same store would find the session held
   * elsewhere and leave it exactly as it is — which is the paired negative, not the case.
   */
  const relaunchAfterACrash = (): RuntimeHost => buildHost(createSessionStore(db, tick))

  const sourceOf = (dir: string, file: string): string => readFileSync(join(dir, file), 'utf8')
  const codeOnly = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  const filesUnder = (dir: string): { path: string; text: string }[] => {
    const out: { path: string; text: string }[] = []
    const walk = (at: string, prefix: string): void => {
      for (const entry of readdirSync(at, { withFileTypes: true })) {
        const full = join(at, entry.name)
        if (entry.isDirectory()) walk(full, `${prefix}${entry.name}/`)
        else if (entry.name.endsWith('.ts')) {
          out.push({ path: `${prefix}${entry.name}`, text: readFileSync(full, 'utf8') })
        }
      }
    }
    walk(dir, '')
    return out
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the vocabulary decision — one word, and a field beside it
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · one word for “nothing is driving this”, and the two vocabularies stay two', () => {
    it('🔴 `silent` is gone, `stalled` survives, and nothing in the app still spells the old one', () => {
      // ⚑ **603/609 · three waits joined the list and `stalled` did not move**, which is the
      // distinction this test is actually about: `400` RETIRED a word into `stalled`, and `603`
      // and `609` ADDED members beside it — as D-016 · commit 6 added a fourth wait. ⛔ A member
      // added is not a member renamed — the census below still ranges over `silent`, which is the
      // retirement, and is untouched by an addition.
      // ⚠️ **`609` also RENAMED one** (`asking` → `waiting-on-an-answer`), and that is a rename
      // this census is deliberately blind to: `asking` was never written to a ledger, so there is
      // no old spelling for the app to still be carrying.
      expect([...TASK_STATES]).toEqual([
        'waiting',
        'working',
        'waiting-on-an-answer',
        'waiting-on-a-person',
        'waiting-on-a-worker',
        // ⚑ **D-016 · commit 6 · a member ADDED, in the waits' family** — a piece a person gave,
        // whose owner's turn ended with it open: it waits on them, and is not `stalled`.
        'waiting-on-the-person-who-asked',
        // ⚑ **F097 · a member ADDED beside it** — a piece a conversation gave, whose owner's turn a
        // person's words opened and ended with it open: it waits on the person who wrote.
        'waiting-on-the-person-who-wrote',
        // ⚑ **A member ADDED beside them** — a piece marked as waiting on purpose.
        'waiting-on-purpose',
        'stalled',
        'answered',
        'withdrawn',
        // ⚑ **D-016, commit 5 · a member ADDED, beside the other two endings** — the giver closed it.
        'closed',
      ])
      expect([...TASK_STATES]).not.toContain('silent')
      // ⛔ **The census that makes the retirement real rather than local.** A `silent` left behind in
      // a rail, a payload or a sentence would be a second vocabulary for a state nothing produces.
      const spellings = filesUnder(join(here, '../src'))
        .filter(({ text }) => /['"]silent['"]/.test(codeOnly(text)))
        .map(({ path }) => path)
        .sort()
      // ⚑ **The two that remain are the LIVENESS vocabulary and they are a different subject** —
      // `SessionLiveness.state`, which is what the header shows about a provider producing nothing.
      // ⚠️ Named rather than counted, so a third file appearing has to be argued about.
      // ⚑ **What remains is TWO other vocabularies, named rather than counted** so a third file
      // appearing has to be argued about: `SessionLiveness.state`, which is what the header shows
      // about a provider producing nothing, and `one-host-gate.ts`'s own answer for a socket that
      // did not speak.
      expect(spellings).toEqual([
        'main/one-host-gate.ts',
        'main/runtime/liveness.ts',
        'renderer/src/lib/agent-state.ts',
        'shared/runtime-ipc.ts',
      ])
    })

    it('⛔ the TASK vocabulary lost `abandoned` and the REQUEST vocabulary kept it', () => {
      // 🔴 **`398` §3 measured that one word lives in two closed vocabularies and means different
      // things in each**, and HO-018 §4 said which one this dispatch may touch: *"this changes the
      // TASK one. Do not touch the request one, and assert that you did not."*
      expect([...TASK_STATES]).not.toContain('abandoned')
      expect([...REQUEST_STATES]).toContain('abandoned')
      // ⚠️ **And it is still an ENDING over there**, which is the half a rename would have left
      // looking right: a request whose conversation ended really cannot be answered, because the
      // provider holding it is gone.
      expect(REQUEST_IS_OPEN.abandoned).toBe(false)
      expect([...REQUEST_STATES]).toEqual([
        'open',
        'answered',
        'rejected',
        'decided',
        'withdrawn',
        'abandoned',
        'stranded',
        'interrupted',
        // ⚑ **591's, and the assertion this test exists for still holds**: HO-018 §4's *"do not
        // touch the request one"* was about `abandoned` staying an ending over here, and it does.
        // ⛔ A member ADDED is not a member moved — see `a-question-finds-a-person.test.ts` §4 for
        // why this one is none of the three above it.
        'work-withdrawn',
        // ⚑ **D-016, commit 5** — the work it was about was closed by the one that gave it; added
        // beside `work-withdrawn`, and `abandoned` untouched.
        'work-closed',
        // The work it was about was handed back.
        'work-replied',
        // ⚑ **D-009** — the conversation it was addressed to ended without answering it.
        'recipient-ended',
      ])
    })

    it('🔴 exactly three states close a task, and all of them are somebody DECIDING', () => {
      expect(Object.keys(TASK_IS_OPEN).sort()).toEqual([...TASK_STATES].sort())
      expect(TASK_STATES.filter((state) => !TASK_IS_OPEN[state])).toEqual([
        'answered',
        'withdrawn',
        'closed',
      ])
      // ⚑ **HO-018 §2's principle as a table**: the agent saying how it went, the parent taking
      // the work back, and (D-016, commit 5) the parent closing it without a reply. Everything else
      // the engine observes is a condition on an open task.
      expect(TASK_IS_OPEN.stalled).toBe(true)
    })

    it('⛔ five causes, five producers — each one is the projection of a single event type', () => {
      expect([...TASK_STALL_CAUSES]).toEqual([
        'turn_ended',
        'turn_interrupted',
        'app_restarted',
        'message_never_sent',
        // ⚑ **D-017 · R10 — and the census below holds it to one producer too**: the holder could
        // never be reopened and a new conversation took its place. ⛔ **D-016c removed the stop's
        // own cause**: a stop moves no piece, and a drive it cut ends as an interrupted turn.
        'could_not_be_reopened',
        // ⚑ Its conversation's end took the background work it waited on — a `status: ended` over
        // a running level.
        'background_stopped',
        // ⚑ **F074** — a `turn` row that carries its provider's usage limit: the turn branch's
        // third word, chosen on the same line as the other two.
        'provider_limited',
        // ⚑ **F076** — a `turn` row, or a session's terminal `status`, that says its provider refused
        // a refused login: chosen once, in the turn branch's helper, over the other three.
        'login_refused',
        // A `turn` row that says its provider would not bill the account it ran on: the turn
        // branch's fourth word, chosen on the same line as the first three.
        'billing_refused',
      ])
      // 🔴 **The census: every cause is written at exactly one place in the fold.** ⚠️ A cause with
      // two producers is the defect `395` spent a dispatch undoing — one word standing for two
      // different observations — and a cause with none is a word nothing can say.
      // ⚠️ **Scoped to the FOLD's body and not to the file**, which is `394`'s lesson one subject
      // over: the vocabulary declares every cause as a string too, so a file-level count would be
      // satisfied by the declaration and could not see a producer that had grown a second caller.
      const source = codeOnly(sourceOf(sharedRoot, 'tasks.ts'))
      const body = source.slice(source.indexOf('export function derivePieces'))
      expect(body.length).toBeGreaterThan(1_000)
      // 🔴 **484 · the census is over the PRODUCERS, and `stall`'s own body is cut out of it.** ⛔
      // The helper now READS a cause as well as writing one — {@link PieceRow.stalledBy} travels for
      // `turn_interrupted` and for nothing else — and a reader is a different thing from a second
      // producer. ⚠️ **Cut rather than allowed for**, so the one-producer property is still asserted
      // absolutely over the rest of the fold instead of being softened into a count somebody chose.
      //
      // 🔴 **T-002 · D-005's `drivenAgain` has a cut of its own**, pinned to naming no cause and
      // reading its closed record, so a cause literal cannot MOVE into it with the count unchanged.
      // ⚑ The helpers between `stall` and it (`endedWithItOpen` since D-016 · commit 6, and the
      // held-work ones, `nothingWillDriveIt` and `backgroundMoved`) write or put back a cause they
      // were HANDED, so they sit in `stall`'s slice and must name none of their own. ⛔ **D-016c
      // deleted the second reader `648` cut out here** (`unwindTheEnding`, which named the
      // conversation's ending) with the ending's cause.
      const opensStall = body.indexOf('const stall = (')
      const opensDriven = body.indexOf('const drivenAgain = (')
      const closesStall = body.indexOf('const noteTheLostQuestion')
      expect(opensStall, '`stall` was renamed').toBeGreaterThan(0)
      expect(opensDriven, '`drivenAgain` was renamed or moved').toBeGreaterThan(opensStall)
      expect(closesStall, 'the helper after `drivenAgain` was renamed').toBeGreaterThan(opensDriven)
      const stallBody = body.slice(opensStall, opensDriven)
      const drivenBody = body.slice(opensDriven, closesStall)
      const producers = body.slice(0, opensStall) + body.slice(closesStall)
      for (const cause of TASK_STALL_CAUSES) {
        expect(producers.split(`'${cause}'`), cause).toHaveLength(2)
      }
      // ⛔ **And inside the helper, NO cause is named since `720`** — it reads which causes an ask
      // can ride beside off one closed record, {@link AN_ASK_RIDES_ON}. ⚠️ Until `720` it named
      // exactly one (`turn_interrupted`); R72 widened the ask to both TURN causes, and a second
      // literal here would have been the fold deciding an author per cause in two places. ⚑ **Re-aimed
      // rather than stripped** (standing rule 26): what this pins now is that the helper still
      // chooses nothing itself — it reads the record — and that the record's own answer is the two
      // turn causes, so a sixth cause cannot be given an author here unseen.
      // ⚑ **D-017 · R10 — one cause IS named in the helper now, and only as a READ**: the one final
      // stall (`could_not_be_reopened`) is never re-worded by a later row, so the helper asks
      // whether the row already stands on it — a reader, and never a choice of which cause to
      // write.
      expect(TASK_STALL_CAUSES.filter((cause) => stallBody.includes(`'${cause}'`))).toEqual([
        'could_not_be_reopened',
      ])
      expect(stallBody.split(`'could_not_be_reopened'`)).toHaveLength(2)
      expect(stallBody).toContain("held.row.stalledBecause === 'could_not_be_reopened'")
      expect(stallBody).toContain('AN_ASK_RIDES_ON[cause]')
      expect(TASK_STALL_CAUSES.filter((cause) => AN_ASK_RIDES_ON[cause])).toEqual([
        'turn_ended',
        'turn_interrupted',
        'provider_limited',
        'login_refused',
        'billing_refused',
      ])
      // ⛔ **T-002 · and inside `drivenAgain`, NONE**: which causes an owner's turn drives is read off
      // one closed record, {@link ITS_OWNER_RUNNING_AGAIN_DRIVES_IT}, never chosen here.
      expect(TASK_STALL_CAUSES.filter((cause) => drivenBody.includes(`'${cause}'`))).toEqual([])
      expect(drivenBody).toContain('ITS_OWNER_RUNNING_AGAIN_DRIVES_IT[cause]')
      // ⚑ **The control that plants TWO** (standing rule 12): the split really can see more than one
      // occurrence. ⚠️ **THREE calls for five causes, and the arithmetic is the point**: the turn
      // branch chooses between two of them on one line, which is why the census above is over the
      // CAUSES rather than over the call sites. ⚑ **D-017** gave `could_not_be_reopened` a call of
      // its own, and ⛔ **D-016c** took the stop's away: a stop that cut a drive ends it through the
      // turn branch's own helper, so it adds no call.
      //
      // 🔴 **D-016 · commit 6 · and the turn branch no longer calls `stall` itself**: it hands the
      // cause it chose to `endedWithItOpen`, in `stall`'s slice, which stalls a piece a
      // conversation gave on that cause and leaves a piece a person gave waiting on them. ⚑ So each
      // cause still has its one producer: the three non-turn causes each call `stall` with their
      // own literal, and the turn branch's two reach it through that helper alone.
      expect(producers.split('stall(')).toHaveLength(1 + 3)
      // ⚑ **F074** — the turn branch hands on the usage limit its turn ended on, beside its cause.
      // ⚑ **F076** — the cause it chose, and the login rider when the login was the cause.
      expect(producers).toContain('endedWithItOpen(piece, because, at, asked, [], limit, login)')
      // ⚑ …handing on what the stop took from the background, when the cause is the stop's own —
      // and the limit, when the cause is the limit's.
      // ⚑ **F076** — and the login rider, when the cause is the login's.
      expect(stallBody).toContain('stall(piece, cause, at, by, stopped, limit, login)')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §2 · criterion 4 — the observation, and the push
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · a turn that ends with the work open, and the parent is TOLD', () => {
    it('🔴 the headline: the turn ends, the task stalls, and the parent is pushed WITH NO WINDOW', async () => {
      const {
        pm,
        worker,
        piece: task,
        label,
      } = await aPmAndItsWorker('claude', host, 'do the thing')
      expect(stateOf(worker, task)).toBe('working')

      // ⛔ **The hazard on the path** (HO-018 §6). Nothing is attached from here on, so a notice that
      // only happened while somebody was looking would not happen at all.
      await cardOn(worker)
      // ⚠️ **A WATERMARK, taken before the window goes** (439). ⛔ The assertion at the foot of
      // this test means *nothing reached the sink after it was unplugged*, and it was written as
      // *nothing in the sink's whole history mentions this task* — which held only while no
      // earlier message to this window happened to carry the id. ⚑ `439`'s sender-side receipt
      // carries it, delivered while the window was still plugged in, so the old spelling failed
      // on a message that arrived BEFORE the moment it is about. **The property is unchanged and
      // is now measured where it lives.**
      const sawBefore = window.messages.length
      unplugTheWindow()
      await letTheTurnFinish(worker)

      expect(taskOf(worker, task)).toMatchObject({
        state: 'stalled',
        stalledBecause: 'turn_ended',
        // ⚠️ **OPEN and unstamped**, which is HO-018's *"a condition on an open task, never a
        // terminal state"* read off the row rather than off a docblock.
        endedAt: null,
        outcome: null,
      })
      expect(TASK_IS_OPEN.stalled).toBe(true)

      // 🔴 **And it was PUSHED.** Asserted in the PARENT's own ledger, which is the only place a
      // message that was really delivered can be — `wordsSentTo` reads no sink.
      await waitFor(() => noticesTo(pm, label).length === 1, 'the parent to be told')
      const told = noticesTo(pm, label)[0] ?? ''
      // 🔴 **624 · re-aimed onto the decomposition** (`HO-095` §5.2). ⛔ The clause it used to
      // pin — *and it replied nothing* — was false beside `614`'s quotation of what the child
      // actually said, three lines further down this same notice.
      expect(told).toContain('its turn ended with this work still open')
      expect(told).not.toContain('replied nothing')
      expect(told).toContain(label)
      expect(told).toContain('after a reminder')
      expect(told).toContain('Follow it up with them, or close it and give it again.')
      // ⛔ **The sink saw nothing AFTER it was unplugged**, which is what makes the line above
      // evidence of a push rather than of a poll that happened to be running.
      expect(
        window.messages
          .slice(sawBefore)
          .filter(
            (one) => JSON.stringify(one).includes(task) || JSON.stringify(one).includes(label),
          ),
      ).toEqual([])
      // ⚑ **Non-vacuity for the slice** (439): the watermark must have cut something off, or this
      // would be asserting over the same array and the correction would be decoration.
      expect(sawBefore).toBeGreaterThan(0)
    })

    it('⛔ the paired negative: a child that REPLIES is not stalled and its parent gets no notice', async () => {
      const {
        pm,
        worker,
        piece: task,
        label,
      } = await aPmAndItsWorker('claude', host, 'do the thing')
      await cardOn(worker)
      unplugTheWindow()

      const answered = await callOn(agentToolsFor(host, worker), 'reply_to_parent', {
        piece: label,
        outcome: 'done',
        summary: 'it is done',
      })
      expect(answered.outcome, JSON.stringify(answered)).toBe('ok')
      await letTheTurnFinish(worker)

      // ⚑ **The reply closes the task before its turn ends**, so the turn branch passes over it —
      // which is what makes a stall mean *no reply* rather than *no reply yet*.
      expect(taskOf(worker, task)).toMatchObject({ state: 'answered', outcome: 'done' })
      expect(noticesTo(pm, label)).toEqual([])
      // ⚑ **The control**: the parent DID receive something, so the assertion above is about the
      // notice rather than about a channel that was not working.
      expect(wordsSentTo(pm).some((text) => text.includes('it is done'))).toBe(true)
    })

    it('🔴 an INTERRUPTED turn stalls it too, and `393` and `398` both ruled the other way', async () => {
      // ⛔ **Their reason was the WORD.** *"Folding it here would report work as `said nothing` the
      // instant somebody pressed Stop"* — true of `silent`, and no longer true of anything. ⚑ An
      // interrupted turn is nothing driving the work, said plainly, and it is exactly criterion 4.
      const {
        pm,
        worker,
        piece: task,
        label,
      } = await aPmAndItsWorker('claude', host, 'the long job')
      await cardOn(worker)
      unplugTheWindow()
      host.claimSession(worker, window)
      claimed.add(worker)
      await host.interrupt(worker, window)
      await waitFor(() => stateOf(worker, task) === 'stalled', 'the interrupted task')

      expect(taskOf(worker, task)).toMatchObject({
        state: 'stalled',
        stalledBecause: 'turn_interrupted',
        endedAt: null,
      })
      // ⚑ **A different sentence from the one a turn's own ending gets**, which is the whole reason
      // the cause is a field rather than folded into the word.
      await waitFor(() => noticesTo(pm, label).length === 1, 'the parent to be told')
      expect(noticesTo(pm, label)[0]).toContain('the turn it was running in was stopped')
      // ⚑ **624 · the negative still names the other cause's words**, and they moved — so it now
      // refuses the sentence `turn_ended` actually produces rather than a clause nothing writes.
      // ⛔ Both are kept: the retired clause must not come back either.
      expect(noticesTo(pm, label)[0]).not.toContain('with this work still open')
      expect(noticesTo(pm, label)[0]).not.toContain('replied nothing')
    })

    it('⛔ the notice is NOT refused when the parent is already holding work — criterion 13 intact', async () => {
      // 🔴 **The rail this could have broken, measured rather than reasoned about.** `queueMessage`
      // refuses a second WORK message by name; a notice that took the `work` slot would be refused
      // exactly when the parent is busiest, which is criterion 4 failing silently.
      const { pm, worker } = await aPmAndItsWorker()
      await cardOn(worker)

      // ⚠️ **The parent is busy AND holding a work message**, which is the state the singleton is
      // about. A person's words go in through the window, as they always do.
      await host.send(pm, 'think about something', window)
      await cardOn(pm)
      const held = await host.queueMessage(pm, 'a person’s words, held', window)
      expect(held.outcome).toBe('queued')
      unplugTheWindow()

      await letTheTurnFinish(worker)
      await waitFor(
        () =>
          events(pm).some((event) => event.type === 'message_queued' && event.kind === 'notice'),
        'the notice to take a slot beside the held work',
      )
      const kinds = events(pm)
        .filter((event) => event.type === 'message_queued')
        .map((event) => (event.type === 'message_queued' ? event.kind : undefined))
      expect(kinds).toEqual(['work', 'notice'])
      expect([...MAILBOX_KINDS]).toContain('notice')
      // ⛔ **And a person's next message is held behind both** (D-010) — criterion 13 refused it
      // until then; every message waits its turn now.
      const next = await host.queueMessage(pm, 'a person’s next words', window)
      expect(next.outcome).toBe('queued')
    })

    it('⛔ told once per episode: a second look says nothing, and a second stall says it again', async () => {
      const {
        pm,
        worker,
        workerHandle,
        piece: task,
        label,
      } = await aPmAndItsWorker('claude', host, 'round one')
      await cardOn(worker)
      unplugTheWindow()
      await letTheTurnFinish(worker)
      await waitFor(() => noticesTo(pm, label).length === 1, 'the first notice')

      // ⚑ **A second turn ending on the same conversation.** The task is already `stalled`, so
      // nothing new was observed and nothing new is said.
      await waitFor(() => workerHandle.status() === 'idle', 'the first turn to settle')
      const roundOne = cardsOn(worker)
      await host.send(worker, 'a person prods it', window)
      await letTheTurnFinish(worker, host, roundOne)
      expect(noticesTo(pm, label)).toHaveLength(1)

      // 🔴 **And an INTERRUPT on a third turn does not tell it again either, which is the honest
      // bound.** ⚠️ **A push per turn ending would be a notice whose frequency is a property of how
      // chatty the child is**, which is not a fact about the work — so the parent is told once.
      // ⚑ **D-005 (F019): each turn DRIVES the work again**, so the ROW says the latest ending —
      // here the interrupted one — while the notice stays at one.
      await waitFor(() => workerHandle.status() === 'idle', 'the second turn to settle')
      const roundTwo = cardsOn(worker)
      await host.send(worker, 'try again', window)
      await cardOn(worker, roundTwo)
      await host.interrupt(worker, window)
      await waitFor(() => workerHandle.status() === 'idle', 'the interrupted turn to settle')
      expect(taskOf(worker, task)).toMatchObject({
        state: 'stalled',
        stalledBecause: 'turn_interrupted',
      })
      expect(noticesTo(pm, label)).toHaveLength(1)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §3 · criterion 14 — the app is killed mid-turn
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · the app is killed while the work is running', () => {
    it('🔴 the headline: a task that was RUNNING comes back OPEN, with the app’s own row saying why', async () => {
      const { worker, piece: task } = await aPmAndItsWorker(
        'claude',
        host,
        'work that outlives a kill',
      )
      await cardOn(worker)
      expect(stateOf(worker, task)).toBe('working')
      // ⛔ **Nothing is written by the death itself**, which is the whole reason this row exists:
      // `settleOrphanRuns` closes the turn ROW and appends no event at all.
      expect(events(worker).some((event) => event.type === 'work_restarted')).toBe(false)

      const next = relaunchAfterACrash()
      try {
        expect(events(worker).filter((event) => event.type === 'work_restarted')).toHaveLength(1)
        expect(taskOf(worker, task)).toMatchObject({
          state: 'stalled',
          stalledBecause: 'app_restarted',
          endedAt: null,
        })
        // ⚑ **And it is answerable**, which is the property HO-018 §2.3 was protecting: a task
        // closed here could never be replied to, because a second reply is a permanent refusal.
        expect(TASK_IS_OPEN[taskOf(worker, task)?.state ?? 'answered']).toBe(true)
      } finally {
        await next.closeAll()
      }
    })

    it('⛔ the paired negative: a launch that finds the ledger LIVE writes nothing', async () => {
      // 🔴 **The repair is only correct because nothing is running.** A second host over the SAME
      // store finds the session held elsewhere and must leave it alone — and a store-side append into
      // a live ledger is not merely rude, it collides on the ordinal and stops the conversation being
      // recorded at all.
      const { worker, piece: task } = await aPmAndItsWorker(
        'claude',
        host,
        'work somebody is doing',
      )
      await cardOn(worker)

      const alongside = buildHost()
      try {
        expect(events(worker).filter((event) => event.type === 'work_restarted')).toEqual([])
        expect(stateOf(worker, task)).toBe('working')
        // ⚑ **The control one fact over**: the same ledger, seen by a launch that CANNOT see the
        // live host, is written about. Without this the negative would pass on a sweep that had
        // been disabled.
        const blind = relaunchAfterACrash()
        try {
          expect(events(worker).filter((event) => event.type === 'work_restarted')).toHaveLength(1)
        } finally {
          await blind.closeAll()
        }
      } finally {
        await alongside.closeAll()
      }
    })

    it('⛔ a second launch writes no second row, and the latch is the derived state itself', async () => {
      const { worker } = await aPmAndItsWorker()
      await cardOn(worker)

      const first = relaunchAfterACrash()
      await first.closeAll()
      expect(events(worker).filter((event) => event.type === 'work_restarted')).toHaveLength(1)
      // ⚠️ **The piece stays stalled** — a stop moves no piece (D-016c) — and the point of a second
      // launch is that it finds nothing in `waiting` or `working` and therefore says nothing.
      const second = relaunchAfterACrash()
      try {
        expect(events(worker).filter((event) => event.type === 'work_restarted')).toHaveLength(1)
      } finally {
        await second.closeAll()
      }
    })

    it('⛔ a RESTART does not re-tell: a stall a previous life already reported is not news', async () => {
      // 🔴 **The bound on what a push can promise, and it is a decision rather than a limitation.**
      // ⛔ A slot seeded empty would report every open stall the first time its conversation came
      // back — so how often a parent hears about ONE piece of work would be a function of how often
      // somebody reopened the app. ⚑ The durable row is unchanged and `list_tasks` still shows it;
      // what does not happen is a second message about the same observation.
      const { pm, worker, piece: task, label } = await aPmAndItsWorker()
      await cardOn(worker)
      unplugTheWindow()
      await letTheTurnFinish(worker)
      await waitFor(() => noticesTo(pm, label).length === 1, 'the first notice')

      await host.closeAll()
      host = buildHost()
      await host.resumeSession(pm, window)
      await host.resumeSession(worker, window)
      // ⚠️ **The task is still open and still stalled**, so the fold has something to report and the
      // parent is live to receive it — which is what makes the count below a decision.
      expect(taskOf(worker, task)).toMatchObject({ state: 'stalled', endedAt: null })

      // ⛔ **And the conversation is DRIVEN again, which is when the look happens.** A resume by
      // itself pumps nothing, so a count taken there would be measured where both readings agree
      // — the second turn is what puts the seed on the path.
      const before = cardsOn(worker)
      await host.send(worker, 'a person prods it', window)
      await letTheTurnFinish(worker, host, before)
      expect(noticesTo(pm, label)).toHaveLength(1)
    })

    it('⛔ a cause with no audience is recorded and NOT pushed, beside one that is', async () => {
      // 🔴 **HO-018 asks for a push and a push needs somebody to push at.** ⛔ The two rows a LAUNCH
      // writes have no parent to deliver into at all. ⚑ Those causes are recorded, are durable and
      // are read through `list_tasks`; what they are not is a message. (A third was a parent told
      // that the conversation IT had just ended had ended: D-017 took the parent's ending, and
      // D-016c the cause.)
      //
      // ⚠️ **The subject and its control were in ONE gesture, and `415` cost that.** ⛔ They were two
      // tasks on one conversation — one running, one waiting behind it — and HO-021 §1 property 3
      // made a child hold at most one open piece of work. ⚑ **The pairing is what carried the
      // argument and the pairing is intact**: one conversation ends under work that was never handed
      // over and its parent hears nothing, the other ends under work that WAS being driven and its
      // parent is told, and the two endings are the same verb a line apart.
      const { pm, worker, profile, pmTools, giveAnother } = await aPmAndItsWorker(
        'claude',
        host,
        'the first one',
      )
      const other = await giveAnother('the running one')
      const running = other.piece
      await cardOn(other.worker)
      // ⚑ **D-016 · the child is BUSY on its first piece** — the give's brief, parked on its card —
      // so a second give to it is admitted and HELD, which is the piece of work this test needs
      // waiting in its mailbox.
      await cardOn(worker)
      const held = await aGive(pmTools, profile, 'the held one')
      expect(held.worker).toBe(worker)
      expect(held.delivery, JSON.stringify(held)).toBe('held')
      const waiting = held.piece
      expect(stateOf(worker, waiting)).toBe('waiting')
      // ⚑ **Claimed BEFORE the window is unplugged**, because the control below is ended by the
      // person and a spawned child is nobody's until somebody claims it.
      host.claimSession(other.worker, window)
      unplugTheWindow()

      // ⛔ **The CONTROL is ended first, and the order is the measurement.** ⚠️ The push has two
      // triggers — the child's own pump and the parent's — and the parent pumps when it receives
      // this notice. ⚑ Ending the conversation that was being DRIVEN first means the parent's pump
      // runs while the held piece of work is still merely `waiting`, which is the state the original
      // one-gesture shape produced and the one the claim below is about.
      //
      // ⛔ **496 · the control is ended by the PERSON, and it has to be.** ⚠️ *Work that WAS being
      // driven* is a turn in flight, and in this app a turn in flight is parked on somebody's card —
      // the ending an agent may no longer perform. ⚑ (`endAgent`, which escalated to
      // `THE_APP_ITSELF` and called exactly this, went with `end_agent` in D-017.)
      await host.close(other.worker, window)
      await waitFor(() => noticesTo(pm, other.label).length === 1, 'the control notice')

      // ⚑ **D-017 · R3 — the subject's gesture is a CRASH now.** ⛔ It was the parent's
      // `end_agent`, which is gone, and a stop no longer abandons what it held: the held work is
      // handed to the next start and delivered there. ⚑ What still strands a held message is the
      // app dying with it — and the LAUNCH after that writes the row, with no parent to deliver into
      // (this note's *"the two rows a LAUNCH writes"*).
      const next = relaunchAfterACrash()
      try {
        await waitFor(() => stateOf(worker, waiting) === 'stalled', 'the held work to stall')

        // ⛔ **The one that was never handed over ends on a cause nobody is told about.**
        expect(taskOf(worker, waiting)?.stalledBecause).toBe('message_never_sent')
        expect(noticesTo(pm, held.label)).toEqual([])
      } finally {
        await next.closeAll()
      }
      // ⚑ **The control, one fact over**: work that WAS being driven ended on a cause with an
      // audience, and the parent was told. ⛔ **That is the property, and it is intact** — the
      // pairing this test rests on is *told* against *not told*, and only the SENTENCE moved.
      //
      // 🔴 **D-016c · `turn_interrupted`, the turn's own cause** (`609` had made it the
      // conversation's ending). ⛔ At the moment `close()` writes the `turn` row, the child is still
      // parked on its permission card — an OPEN routing only a person can settle — so the
      // composition reads `waiting-on-a-person` and {@link stalledWithACause} refuses the notice. ⚑
      // The teardown then strands that request and writes the session's ending, the composition
      // lets go, and the cause on the stalled row is the interrupted turn's: a person's Close is a
      // STOP, and a stop moves no piece (`05`: an agent is never dead).
      //
      // ⚠️ **The parent is still told, exactly once**, and the sentence it is pushed is that cause's
      // own. ⛔ Still told, and told once: the pairing (*told* against *not told*) is what this test
      // rests on.
      expect(taskOf(other.worker, running)?.stalledBecause).toBe('turn_interrupted')
      expect(noticesTo(pm, other.label)[0]).toContain(
        UNDRIVEN_SENTENCES.turn_interrupted.replace(/\.$/, ''),
      )
    })

    it('⛔ a conversation with no open task is never written about', async () => {
      const { worker, piece: task, label } = await aPmAndItsWorker()
      await cardOn(worker)
      const answered = await callOn(agentToolsFor(host, worker), 'reply_to_parent', {
        piece: label,
        outcome: 'done',
        summary: 'finished before the crash',
      })
      expect(answered.outcome, JSON.stringify(answered)).toBe('ok')

      const next = relaunchAfterACrash()
      try {
        expect(events(worker).filter((event) => event.type === 'work_restarted')).toEqual([])
        expect(stateOf(worker, task)).toBe('answered')
      } finally {
        await next.closeAll()
      }
    })

    it('🔴 the CLEAN quit reaches the same place by a different row, and neither closes the work', async () => {
      const { worker, piece: task } = await aPmAndItsWorker()
      await cardOn(worker)

      // ⚑ **A clean quit stops every conversation**, so the ledger holds an ending that a crash does
      // not — and `379` closed the task on exactly this row until HO-018 §2.3 struck it out. ⚑
      // **D-016c · the ending moves no piece**: `close()` interrupts the open turn first, and that
      // `turn` row — which a crash does not write either — is what stalls it.
      await host.closeAll()
      expect(events(worker).some((event) => event.type === 'status')).toBe(true)
      expect(taskOf(worker, task)).toMatchObject({
        state: 'stalled',
        stalledBecause: 'turn_interrupted',
        endedAt: null,
      })
      // ⛔ **And the launch afterwards adds nothing**: the task is already stalled, so there is
      // nothing left for it to observe.
      const next = relaunchAfterACrash()
      try {
        expect(events(worker).filter((event) => event.type === 'work_restarted')).toEqual([])
      } finally {
        await next.closeAll()
      }
    })

    it('⛔ work still HELD when the app died gets its own cause, and the MESSAGE is still abandoned', async () => {
      // ⚑ **D-016 · the turn is the first piece's brief**, parked on its card, so a second give is
      // admitted and HELD behind it (busy is not a stall). ⚑ The subject is unchanged: a
      // `message_queued` the app died holding.
      const { worker, profile, pmTools } = await aPmAndItsWorker('claude', host, 'are you free?')
      await cardOn(worker)
      const held = await aGive(pmTools, profile, 'the held one')
      expect(held.worker).toBe(worker)
      expect(held.delivery, JSON.stringify(held)).toBe('held')
      const waiting = held.piece
      expect(stateOf(worker, waiting)).toBe('waiting')

      const next = relaunchAfterACrash()
      try {
        // ⚑ **`379`'s repair is untouched** — the message ending is the same row with the same
        // reason — and only what a TASK does with it moved.
        const ending = events(worker).filter((event) => event.type === 'message_unqueued')
        expect(ending).toHaveLength(1)
        expect(ending[0]).toMatchObject({ reason: 'abandoned' })
        expect(taskOf(worker, waiting)).toMatchObject({
          state: 'stalled',
          stalledBecause: 'message_never_sent',
          endedAt: null,
        })
      } finally {
        await next.closeAll()
      }
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §4 · criterion 14's pending question — not rebuilt, and not silently lost
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · a question that was pending when the app stopped', () => {
    const aChildHoldingWorkAndAQuestion = async (): Promise<{
      pm: string
      worker: string
      task: string
      request: string
    }> => {
      const { pm, worker, workerHandle, piece: task } = await aPmAndItsWorker()
      const raised = workerHandle.simulateUserInput('which region?', ['eu', 'us'], false)
      await waitFor(
        () =>
          events(worker).some(
            (event) => event.type === 'request_routed' && event.requestId === raised.id,
          ),
        'the routing',
      )
      return { pm, worker, task, request: raised.id }
    }

    it('🔴 the request CLOSES and the task says a question was lost — two vocabularies, one restart', async () => {
      const { worker, task, request } = await aChildHoldingWorkAndAQuestion()
      expect(taskOf(worker, task)?.questionLostAtRestart).toBe(false)

      const next = relaunchAfterACrash()
      try {
        // ⛔ **HO-018 §2.4: the criterion asked for the question to be REBUILT and that specified a
        // mechanism `396` deliberately prevents.** The provider holding it is gone, so an answer
        // would reach nothing — the request closes, and it closes as `stranded`.
        const row = store.routedRequestsOf(worker).find((one) => one.requestId === request)
        expect(row?.state).toBe('stranded')
        expect(REQUEST_IS_OPEN.stranded).toBe(false)
        // ⚑ **And the property the PO actually wanted**: it is not silently lost. The work that was
        // in flight carries the fact, on the row the parent is already reading.
        expect(taskOf(worker, task)).toMatchObject({
          questionLostAtRestart: true,
          state: 'stalled',
        })
      } finally {
        await next.closeAll()
      }
    })

    it('⛔ the paired negative: a question ANSWERED before the crash leaves the flag false', async () => {
      const { pm, worker, task, request } = await aChildHoldingWorkAndAQuestion()
      const answered = await callOn(agentToolsFor(host, pm), 'answer_question', {
        question: request,
        answers: [{ part: 'q0', answer: ['eu'] }],
      })
      expect(answered.outcome, JSON.stringify(answered)).toBe('ok')

      const next = relaunchAfterACrash()
      try {
        expect(store.routedRequestsOf(worker).find((one) => one.requestId === request)?.state).toBe(
          'answered',
        )
        expect(taskOf(worker, task)?.questionLostAtRestart).toBe(false)
        // ⚑ **The control**: the same launch DID observe the work, so the `false` above is about the
        // question rather than about a sweep that never ran.
        expect(taskOf(worker, task)?.stalledBecause).toBe('app_restarted')
      } finally {
        await next.closeAll()
      }
    })

    it('⛔ it is a LATCH: the answer outlives the ending, unlike the cause', async () => {
      const { worker, task } = await aChildHoldingWorkAndAQuestion()
      const next = relaunchAfterACrash()
      try {
        expect(taskOf(worker, task)?.questionLostAtRestart).toBe(true)
        await next.resumeSession(worker, window)
        const landed = await callOn(agentToolsFor(next, worker), 'reply_to_parent', {
          piece: task,
          outcome: 'blocked',
          summary: 'I never got my answer',
        })
        expect(landed.outcome, JSON.stringify(landed)).toBe('ok')
        // 🔴 **The pair says the useful thing**: the work is closed, and a question had been lost
        // underneath it. ⚠️ `stalledBecause` clears because it describes the PRESENT; this does not,
        // because it describes what happened.
        expect(taskOf(worker, task)).toMatchObject({
          state: 'answered',
          stalledBecause: null,
          questionLostAtRestart: true,
        })
      } finally {
        await next.closeAll()
      }
    })

    it('⛔ a model reads both, and the words are the ones the push uses', async () => {
      const { pm, task } = await aChildHoldingWorkAndAQuestion()
      const next = relaunchAfterACrash()
      try {
        await next.resumeSession(pm, window)
        const seen = (await callOn(agentToolsFor(next, pm), 'list_tasks', {})).you_gave as {
          piece: string
          state: string
          stalled_because: string | null
          question_lost_at_restart: boolean
        }[]
        const row = seen.find((one) => one.piece === task)
        expect(row).toMatchObject({
          state: 'stalled',
          stalled_because: 'app_restarted',
          question_lost_at_restart: true,
        })
        expect((await callOn(agentToolsFor(next, pm), 'list_tasks', {})).outcome).toBe('ok')
      } finally {
        await next.closeAll()
      }
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §5 · both providers, and the order the launch does things in
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · both providers, and the order', () => {
    for (const provider of ['claude', 'codex'] as const) {
      it(`🔴 ${provider}: a turn ends and the parent is told; the app dies and the work stays open`, async () => {
        const {
          pm,
          worker,
          giveAnother,
          piece: first,
          label,
        } = await aPmAndItsWorker(provider, host, `work on ${provider}`)
        await cardOn(worker)
        unplugTheWindow()
        await letTheTurnFinish(worker)
        await waitFor(() => noticesTo(pm, label).length === 1, `${provider}'s notice`)
        expect(taskOf(worker, first)?.stalledBecause).toBe('turn_ended')

        // ⚑ **A second piece of work, and then the app dies with it running.** ⛔ **It goes to a
        // SECOND child** — the first is holding a stalled piece, and D-016's stall rule refuses that
        // child a new give until the stalled one is followed up or taken back. ⚠️ The guard below
        // is unchanged and now spans two ledgers, which is the shape the launch sweep actually runs
        // in: it must stall the one that was being driven and leave the one that already stalled.
        const other = await giveAnother('the second thing')
        const second = other.piece
        await cardOn(other.worker)
        expect(stateOf(other.worker, second)).toBe('working')

        const next = relaunchAfterACrash()
        try {
          expect(taskOf(other.worker, second)).toMatchObject({
            state: 'stalled',
            stalledBecause: 'app_restarted',
            endedAt: null,
          })
          // ⛔ **And the one that was already stalled is untouched**, which is the guard that keeps
          // the sweep idempotent without remembering anything.
          expect(taskOf(worker, first)?.stalledBecause).toBe('turn_ended')
        } finally {
          await next.closeAll()
        }
      })
    }

    it('🔴 the restart sweep runs LAST, and that ordering is load-bearing', () => {
      // ⛔ **It writes only for a conversation still holding work in `waiting` or `working`, and the
      // two repairs above it change exactly that.** A stranded message lands
      // `message_unqueued: 'abandoned'`, which already stalls the task it names — so running this
      // first would put a second row in the ledger about one restart.
      const host_ = codeOnly(sourceOf(join(mainRoot, 'runtime'), 'runtime-host.ts'))
      const undriven = host_.indexOf('store.settleRestartedWork(')
      const messages = host_.indexOf('store.settleStrandedMessages(')
      const requests = host_.indexOf('store.settleStrandedRequests(')
      const runs = host_.indexOf('store.settleOrphanRuns(')
      for (const at of [undriven, messages, requests, runs]) expect(at).toBeGreaterThan(0)
      expect(undriven).toBeGreaterThan(messages)
      expect(undriven).toBeGreaterThan(requests)
      expect(undriven).toBeGreaterThan(runs)
    })

    it('⛔ exactly ONE place writes the row, and it is the store', () => {
      const writers = filesUnder(join(here, '../src/main'))
        .filter(({ text }) => codeOnly(text).includes("type: 'work_restarted'"))
        .map(({ path }) => path)
        .sort()
      expect(writers).toEqual(['db/session-store.ts'])
      // ⚠️ **Sorted and named**, because the walk below crosses three top-level directories and the
      // paths it returns are prefixed by them.
      // ⚑ **The control that plants TWO** (standing rule 12): the census can see more than the first
      // file it matches, and the fold really does read the type somewhere else entirely.
      const readers = filesUnder(join(here, '../src'))
        .filter(({ text }) => codeOnly(text).includes('work_restarted'))
        .map(({ path }) => path)
        .sort()
      expect(readers).toEqual([
        // ⚑ **The fold index's types name it** — the piece fold reads it through that index.
        'main/db/fold-index.ts',
        'main/db/session-store.ts',
        // ⚑ **438's digest reads it too** — the fold turns a restart into an `observed` line, and
        // the shared vocabulary names the type in the list its SQL selects.
        'main/runtime/digest.ts',
        'renderer/src/lib/describe-event.ts',
        'renderer/src/lib/transcript.ts',
        'shared/digest.ts',
        'shared/runtime-ipc.ts',
        'shared/tasks.ts',
      ])
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §6 · what nothing here may quietly stop being true
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§6 · the censuses', () => {
    it('⛔ the fold still reaches nothing — no clock, no store, no timer', () => {
      const text = sourceOf(sharedRoot, 'tasks.ts')
      const imports = [...text.matchAll(/^import .*$/gm)].map((match) => match[0])
      // 🔴 **494 · one value import, and the claim is asserted TRANSITIVELY rather than by the
      // spelling of a line.** ⛔ `whoCancelledIt` is the derivation that reads a cancel's actor —
      // shared so the three readers of it cannot come to three opinions — and the module it lives
      // in reaches a ledger TYPE and a vocabulary that reaches nothing. ⚠️ *No clock, no store, no
      // timer* is what this test is for, and it is still true; *every line says `import type`* was
      // a proxy for it.
      const values = imports.filter((line) => !line.startsWith('import type '))
      // ⚑ **F097 · a second value import** — whose words a turn carries, read once for the host and
      // the fold; its module reaches a ledger TYPE and nothing else (below).
      expect(values).toEqual([
        "import { whoCancelledIt, type AskToStop } from './how-work-stopped'",
        "import { aPersonsOwnWords } from './a-persons-own-words'",
      ])
      for (const line of [
        ...sourceOf(sharedRoot, 'a-persons-own-words.ts').matchAll(/^import .*$/gm),
      ]) {
        expect(line[0].startsWith('import type '), line[0]).toBe(true)
      }
      const reached = sourceOf(sharedRoot, 'how-work-stopped.ts')
      for (const line of [...reached.matchAll(/^import .*$/gm)].map((match) => match[0])) {
        expect(line.startsWith('import type ') || line.includes('./who-did-it'), line).toBe(true)
      }
      expect([...sourceOf(sharedRoot, 'who-did-it.ts').matchAll(/^import .*$/gm)]).toHaveLength(0)
      for (const near of ['how-work-stopped.ts', 'who-did-it.ts', 'a-persons-own-words.ts']) {
        expect(codeOnly(sourceOf(sharedRoot, near)), near).not.toContain('Date.now')
        expect(codeOnly(sourceOf(sharedRoot, near)), near).not.toContain('setTimeout')
      }
      const code = codeOnly(text)
      expect(code).not.toContain('Date.now')
      expect(code).not.toContain('setTimeout')
      // 🔴 **And it is PURE**, which is what makes *"no timer decides anything"* a property rather
      // than a promise: the same entries in, the same rows out, twice.
      const entries: PersistedEventInfo[] = [
        {
          ordinal: 0,
          at: 10,
          event: {
            type: 'work_given',
            piece: 'work_1',
            label: 'W1.1',
            parent: 'work_root',
            givenBy: 'sess_pm',
            title: 'a thing',
            brief: 'a thing',
          },
        },
        {
          ordinal: 1,
          at: 15,
          event: { type: 'request_routed', requestId: 'ui_1', to: 'the-parent', parent: 'sess_pm' },
        },
        { ordinal: 2, at: 20, event: { type: 'turn', state: 'completed' } },
        { ordinal: 3, at: 30, event: { type: 'work_restarted', pieces: ['work_1'] } },
        { ordinal: 4, at: 40, event: { type: 'request_stranded', requestId: 'ui_1' } },
      ]
      expect(derivePieces('sess_w', entries)).toEqual(derivePieces('sess_w', entries))
      expect(derivePieces('sess_w', entries)[0]).toMatchObject({
        state: 'stalled',
        // ⛔ **`turn_ended` and not `app_restarted`, which is the sweep's idempotence read off the
        // PURE fold**: `work_restarted` passes over a task that is already stalled, so a relaunch
        // over a ledger a previous relaunch already spoke about changes nothing at all.
        stalledBecause: 'turn_ended',
        questionLostAtRestart: true,
      })
      // ⚑ **The control one fact over**: with the routing removed the stranding says nothing, which
      // is what makes the flag *a question the PARENT could have answered* rather than *anything
      // was open*.
      expect(
        derivePieces(
          'sess_w',
          entries.filter((entry) => entry.event.type !== 'request_routed'),
        )[0]?.questionLostAtRestart,
      ).toBe(false)
    })

    it('⛔ nothing anywhere in the app infers a task state from an ABSENCE of events', () => {
      // 🔴 **`396` §4's ruling, and HO-018 §2.2 removed the one thing that had come close to it.**
      // ⚠️ The escalation deadline is a question's AGE — a fact about a row nobody closed — and it
      // is asserted by `the-two-clocks.test.ts`; what must not exist is a second one over silence.
      const main = filesUnder(join(here, '../src/main'))
      expect(main.filter(({ text }) => text.includes('work_quiet'))).toEqual([])
      expect(main.filter(({ text }) => text.includes('quietWorkDue'))).toEqual([])
      expect(main.filter(({ text }) => text.includes('settleQuietWork'))).toEqual([])
      // ⚑ **The control**: the sweep really did read those files, and one of them really does hold
      // the deadline that survived.
      expect(
        main
          .filter(({ text }) => text.includes('escalationsDue'))
          .map(({ path }) => path)
          .sort(),
      ).toEqual(['db/session-store.ts', 'runtime/runtime-host.ts'])
    })

    it('⛔ the runtime package never learns either of this dispatch’s words', () => {
      const runtime = filesUnder(join(here, '../../../packages/runtime/src')).map(
        ({ text }) => text,
      )
      expect(runtime.filter((text) => text.includes('work_restarted'))).toHaveLength(0)
      expect(runtime.filter((text) => text.includes('stalledBecause'))).toHaveLength(0)
      // ⚑ **The control**: the sweep really did read that package, and it is not empty.
      expect(runtime.filter((text) => text.includes('completeTurn')).length).toBeGreaterThan(1)
    })
  })
})
