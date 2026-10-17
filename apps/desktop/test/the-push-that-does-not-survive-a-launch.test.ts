import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { TASK_IS_OPEN, TASK_STATES, undrivenSentence } from '../src/shared/tasks'
import type { PieceRow, TaskState } from '../src/shared/tasks'

/**
 * 🔴 **648 · `message_never_sent`'s sentence, RENDERED rather than restated.**
 *
 * ⛔ **Three assertions in this file name it and two of them are NEGATIVES** — *this parent is
 * never told this* — which is exactly the shape that goes vacuous when a literal drifts past the
 * string it was copied from. ⚑ `undrivenSentence` is the function both surfaces call, period and
 * all, so a sentence that moves moves here with it and the negatives keep measuring.
 *
 * ⚠️ **The sentence itself moved in 648**: it said *the app stopped before the message carrying it
 * was sent* and named one of its four producers. See `TaskStallCause.message_never_sent`.
 */
const THE_MESSAGE_NEVER_WENT = undrivenSentence('message_never_sent')
import { REQUEST_STATES } from '../src/shared/questions'
import { MAILBOX_KINDS } from '../src/shared/runtime-ipc'
import type {
  PersistedEventInfo,
  RuntimeEventMessage,
  TranscriptEvent,
  WorkStallTold,
} from '../src/shared/runtime-ipc'

/**
 * 🔴 **404 · the push that does not survive a launch** — `402`'s F6, and the seam `400` left.
 *
 * ## ⛔ The finding, measured before this dispatch existed
 *
 * **HO-018 §2.1:** *"the change is that the condition is PUSHED, not merely visible to a poll."*
 * ⚑ It held for `turn_ended`. ⛔ It did not hold for {@link TaskStallCause.app_restarted}, which is
 * criterion 14's own cause — `402` row 15, from a live run: *"1 inbound row on the pm; 'is not being
 * worked on' ABSENT"*, beside a row 14 that PASSED with `1 work_restarted` and the task `stalled`
 * `because: app_restarted`.
 *
 * ## 🔴 Why, and it was two things rather than one
 *
 * ⛔ **The TRIGGER.** `400`'s push hangs off a provider's own `turn` and `status` events. **A
 * conversation that is not running pumps nothing, and a launch is exactly the moment nothing is
 * running**, so a row `settleRestartedWork` writes at construction could never reach anybody.
 *
 * ⛔ **And the DE-DUPLICATOR, which would have kept it silent even after the trigger was fixed.**
 * `400` seeded `HostedSession.toldAboutStall` from the CHILD's task rows, reading *carried into this
 * slot* as *already told*: *"the parent was told then or it was not."* ⚠️ **For `app_restarted` it
 * provably was not** — the row is written when nothing is running — so the seed marked as told the
 * one cause nobody can have been told about.
 *
 * ## ⚑ What replaced them
 *
 *  - **A second trigger**: `RuntimeHost.tellAboutWorkItGaveOut`, from `register`. Not a clock, not a
 *    surface, not a reader — the moment a parent becomes able to be told anything.
 *  - **A durable receipt**: {@link WorkStallTold} (`work_reported` until D-016), in the PARENT's
 *    own ledger, so *has this conversation been told?* survives the restart that made the question
 *    worth asking.
 *  - **One exception, written down as a row rather than as an absence of a trigger**: an agent that
 *    ends a conversation itself is not pushed about its work — `how: 'its-own-ending'`.
 *
 * ⚠️ **Every push in this file is asserted as a row in the PARENT's own ledger, with the window
 * unplugged**, which is what makes it evidence of a push rather than of a poll that happened to run.
 *
 * ⚑ **Real host, real SQLite, real migrations, real tools, real filesystem.** The only double is the
 * provider.
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

describe('404 · the push that does not survive a launch', () => {
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-pushed-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-pushed-root-'))
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

  /**
   * `393`'s helper: a PM in a window with one child of its own, started through the real door.
   *
   * ⚑ **D-016 · the door is a give, and it hands the work over in the same act**: its brief is the
   * child's first turn, which parks on the Fake's card (`ask`), where a spawn started the child idle
   * and a `work` message opened the task. The piece it wrote comes back as `task`.
   */
  const aPmAndItsWorker = async (
    brief = 'the work',
  ): Promise<{
    pm: string
    worker: string
    pmTools: AgentToolset
    /** ⚑ **D-016** · the piece the give wrote, by its id. */
    task: string
    /** ⚑ The agent the worker runs as — a second give to it reaches this same conversation. */
    workerProfile: string
    /** ⚑ **415 · the second identity this helper always made**, named so a test can use it. */
    otherProfile: string
  }> => {
    const nth = ++pairs
    const pmProfile = `pm-${String(nth)}`
    const workerProfile = `worker-${String(nth)}`
    for (const one of [workerProfile, `${workerProfile}-b`]) await bringIdentityIntoBeing(one)
    const pm = await personOpens(pmProfile)
    const pmTools = agentToolsFor(host, pm)
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: workerProfile,
      title: brief,
      brief,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return {
      pm,
      worker: given.agent as string,
      pmTools,
      task: given.piece as string,
      workerProfile,
      otherProfile: `${workerProfile}-b`,
    }
  }

  /** ⚑ **D-016 · a second give from the same PM**, which reaches the conversation it already has. */
  const aSecondGive = async (
    pmTools: AgentToolset,
    profile: string,
    brief: string,
  ): Promise<Record<string, unknown>> => {
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile,
      title: brief,
      brief,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return given
  }

  const cardsOn = (sessionId: string): number =>
    events(sessionId).filter((event) => event.type === 'permission_request').length

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

  // These two held-notice controls use cancellation; quiet turns enter the holder ladder.
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
    await on.respondPermission(sessionId, id, { outcome: 'cancel' }, window)
    await waitFor(
      () => events(sessionId).filter((event) => event.type === 'turn').length > turnsBefore,
      'the turn to reach its own terminal',
    )
  }

  const taskOf = (sessionId: string, piece: string): PieceRow | undefined =>
    store.piecesOwnedBy(sessionId).find((one) => one.piece === piece)

  const stateOf = (sessionId: string, piece: string): TaskState | undefined =>
    taskOf(sessionId, piece)?.state

  /** ⚑ **D-016 · a notice names its piece by its LABEL**, which is read off the piece's own row. */
  const labelOf = (piece: string): string => store.workById(piece)?.label ?? `(no piece ${piece})`

  /**
   * ⛔ **What the PARENT was actually told**, off its own ledger — never off a sink, and never off
   * the return value of the call that told it.
   */
  const wordsSentTo = (parent: string): string[] =>
    events(parent)
      .filter((event) => event.type === 'user_turn')
      .map((event) => (event.type === 'user_turn' ? event.text : ''))

  /**
   * 🔴 **614 · matched on the notice's FIRST LINE and no longer on the whole of it.**
   *
   * ⛔ **The notice now QUOTES the child's last turn**, and a child's own words can name anything
   * — including another task's id, which is not hypothetical here: this suite's worker echoes the
   * message it was handed, and `messageNamingTheTask` puts a task id in every one. ⚠️ A whole-text
   * `includes` then reported the notice about the UNFINISHED task as a notice about the FINISHED
   * one, and §1's control — *no notice for the task that was answered* — went red for a notice
   * that does not exist (`an-assertion-can-be-satisfied-by-a-neighbouring-element`).
   *
   * ⚑ **`undrivenWorkText`'s first line is what names the subject** — *Task #N (id) with … is not
   * being worked on* — so both halves of the old predicate move onto it together. ⛔ Narrowing only
   * the id would leave the sentence free to match a quotation, which is the same defect with one
   * fewer way to notice it.
   */
  const noticeAbout = (text: string, piece: string): boolean => {
    // 🔴 **624 · the id left the FIRST line and the closing imperative kept it** (`HO-095`
    // §5.3). ⛔ That line read *Task #N (task_…) with sess_…* and now reads *Task #N with Ada*,
    // so the pair above matched nothing at all and every push in this file read as never sent.
    // ⚑ **Split rather than loosened**: the subject is still pinned to the notice's own opening
    // line, and the id is matched where it still is — the `list_tasks` imperative that closes
    // it — so the quoted child's words in between are excluded from both halves and the
    // neighbouring-element defect above stays closed.
    // ⚑ **D-016 · the closing imperative names the piece by its LABEL** (*"…naming W2.1."*), so the
    // id is matched as that label, whole, up to the full stop.
    const lines = text.split('\n')
    const first = lines[0] ?? ''
    const last = lines.at(-1) ?? ''
    return first.includes('not being worked on') && last.endsWith(`naming ${labelOf(piece)}.`)
  }

  const noticesTo = (parent: string, piece: string): string[] =>
    wordsSentTo(parent).filter((text) => noticeAbout(text, piece))

  /**
   * ⚑ **Everything the app put into a parent about one task, on WHICHEVER row carried it.**
   *
   * ⛔ **A notice `queueMessage` held is a `message_queued` row and not a `user_turn`**, and it is
   * still the parent having been told: the words are durably in its ledger and the flush is the
   * mailbox's ordinary business. ⚠️ {@link noticesTo} is the narrower reader and is what §1 and §2
   * assert through; this one is for the tests where TWO notices arrive at once and the second is
   * held behind the first one's turn.
   */
  const anythingSaidTo = (parent: string, piece: string): string[] =>
    events(parent)
      .filter((event) => event.type === 'user_turn' || event.type === 'message_queued')
      .map((event) =>
        event.type === 'user_turn' || event.type === 'message_queued' ? event.text : '',
      )
      // ⚑ **614 · the same first-line narrowing as {@link noticesTo}**, and for its reason.
      .filter((text) => noticeAbout(text, piece))

  /** The durable receipts in a conversation's own ledger — {@link WorkStallTold} (D-016). */
  const receiptsTo = (parent: string): WorkStallTold[] =>
    events(parent).filter((event): event is WorkStallTold => event.type === 'work_stall_told')

  /** ⛔ **Nobody is watching**, which is the state this app spends most of its life in. */
  const unplugTheWindow = (): void => {
    window.alive = false
  }

  /**
   * 🔴 **A conversation that was given work and whose app then DIED** — no clean quit, no ending
   * written, which is the ledger shape HO-018 §2.3 is about.
   *
   * ⚠️ **A second `SessionStore` OBJECT is what makes the next launch see it** (`400`'s helper,
   * unchanged): `live-hosts.ts` identifies a ledger by object, so a host built on the same store
   * would find the session held elsewhere and leave it exactly as it is.
   */
  const relaunchAfterACrash = (): RuntimeHost => buildHost(createSessionStore(db, tick))

  /**
   * 🔴 **The shape every test in §1 to §3 is about**: a PM that gave work out, a worker that was
   * mid-turn, and an app that went away without writing an ending for either.
   *
   * ⛔ **The PM's own conversation is CLOSED before the crash, and that is the harness rather than
   * the case.** A test process keeps the first host alive, so leaving the PM registered on it and
   * resuming it on the next host would put two ordinal counters on one ledger — a
   * `UNIQUE constraint failed: events.ordinal` that the real app cannot have, because a real crash
   * takes the whole process. ⚑ **What is measured is unchanged**: the work is still open, the
   * worker is still mid-turn, and nothing has told the PM anything.
   */
  const theAppDiesHoldingTheWork = async (): Promise<{
    pm: string
    worker: string
    task: string
    next: RuntimeHost
    /**
     * ⚠️ **How many messages the sink had seen when the window went** (439) — the watermark the
     * *"the sink saw nothing"* assertions are actually about. ⛔ They were written as *nothing in
     * this sink's whole history mentions the task*, which held only while no earlier message to
     * this window happened to carry the id; `439`'s sender-side receipt carries it and is delivered
     * while the window is still plugged in. ⚑ **The property is unchanged**: what moved is where it
     * is measured, from the whole history to the part that is after the moment it is about.
     */
    sawBefore: number
  }> => {
    const { pm, worker, task } = await aPmAndItsWorker()
    await cardOn(worker)
    expect(stateOf(worker, task)).toBe('working')
    await host.close(pm, window)
    const sawBefore = window.messages.length
    unplugTheWindow()
    return { pm, worker, task, next: relaunchAfterACrash(), sawBefore }
  }

  const sourceOf = (dir: string, file: string): string => readFileSync(join(dir, file), 'utf8')
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
  const codeOnly = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the finding — a row written at a launch reaches the conversation that gave the work
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · the launch writes it and the parent is TOLD', () => {
    it('🔴 the headline: the app is killed mid-turn, and the parent hears about it WITH NO WINDOW', async () => {
      const { pm, worker, task, next, sawBefore } = await theAppDiesHoldingTheWork()

      // ⛔ **The row `400` built, unchanged** — this is the half that already worked.
      expect(taskOf(worker, task)).toMatchObject({
        state: 'stalled',
        stalledBecause: 'app_restarted',
        endedAt: null,
      })
      // ⚠️ **And nobody has been told yet, which is the state `402` measured and stopped at.**
      expect(noticesTo(pm, task)).toEqual([])

      // 🔴 **The parent comes back, and THAT is the trigger.** Nothing is running: the worker is not
      // resumed, no provider event has been delivered for it, and the sink is dead.
      const startedBefore = handles.length
      await next.resumeSession(pm, window)
      await waitFor(() => noticesTo(pm, task).length === 1, 'the parent to be told')

      const told = noticesTo(pm, task)[0] ?? ''
      expect(told).toContain('the app restarted while it was open')
      expect(told).toContain('the work')
      expect(told).toContain('list_tasks')
      // ⛔ **One conversation was started by this launch and it is the PARENT.** The child that
      // stopped being driven is still not running, so nothing here is a poll on a live provider.
      expect(handles.length - startedBefore).toBe(1)
      // ⚠️ **D-017 · R2 — read off what RUNS, not off the list**: `list_agents` now names every
      // conversation within reach, stopped ones included, so the child is listed and not running.
      expect(next.sessionIds).toEqual([pm])
      expect(
        next.agentsVisibleTo({ ownerId: `agent:${pm}` }, pm).agents.map((one) => one.agent),
      ).toContain(worker)
      // ⛔ **The sink saw nothing AFTER the window went**, which is what makes the line above
      // evidence of a push rather than of a window that happened to be open.
      // ⚑ D-016 · by its id or by its label, the one a notice names it by.
      expect(
        window.messages.slice(sawBefore).filter((one) => {
          const said = JSON.stringify(one)
          return said.includes(task) || said.includes(`naming ${labelOf(task)}.`)
        }),
      ).toEqual([])
      // ⚑ **Non-vacuity for the slice** (439): the watermark must have cut something off, or this
      // would be asserting over the same array and the correction would be decoration.
      expect(sawBefore).toBeGreaterThan(0)
    })

    it('⛔ the paired negative: work that was ANSWERED before the crash is not reported, beside work that was not', async () => {
      // 🔴 **The subject and its control in ONE gesture**, so the silence is a decision rather than a
      // channel that was shut: two tasks in one conversation, one answered before the app died and
      // one not, and the same launch and the same resume look at both.
      // ⚑ D-016 · two gives from one PM, which reach its one conversation with that agent.
      const {
        pm,
        worker,
        pmTools,
        task: finished,
        workerProfile,
      } = await aPmAndItsWorker('the finished one')
      await cardOn(worker)
      const answered = await callOn(agentToolsFor(host, worker), 'reply_to_parent', {
        piece: finished,
        outcome: 'done',
        summary: 'it is done',
      })
      expect(answered.outcome, JSON.stringify(answered)).toBe('ok')
      const second = await aSecondGive(pmTools, workerProfile, 'the unfinished one')
      expect(second.agent).toBe(worker)
      const unfinished = second.piece as string
      await host.close(pm, window)
      unplugTheWindow()

      const next = relaunchAfterACrash()
      await next.resumeSession(pm, window)
      await waitFor(() => noticesTo(pm, unfinished).length === 1, 'the control notice')

      expect(stateOf(worker, finished)).toBe('answered')
      expect(noticesTo(pm, finished)).toEqual([])
      expect(receiptsTo(pm).map((one) => one.piece)).toEqual([unfinished])
    })

    it('⛔ the paired negative: a parent is told about its OWN work and not about somebody else’s', async () => {
      // ⚠️ **Two PMs, one launch.** The push reads `piecesGivenBy` (D-016), and the row's own
      // `giver` is what decides — not the ledger the candidate query happened to find.
      const first = await aPmAndItsWorker('the first work')
      const second = await aPmAndItsWorker('the second work')
      const mine = first.task
      const theirs = second.task
      await cardOn(first.worker)
      await cardOn(second.worker)
      await host.close(first.pm, window)
      await host.close(second.pm, window)
      unplugTheWindow()

      const next = relaunchAfterACrash()
      await next.resumeSession(first.pm, window)
      await waitFor(() => noticesTo(first.pm, mine).length === 1, 'the first PM to be told')

      expect(stateOf(second.worker, theirs)).toBe('stalled')
      expect(noticesTo(first.pm, theirs)).toEqual([])
      expect(receiptsTo(first.pm).map((one) => one.piece)).toEqual([mine])
      // ⚑ **And the other PM is owed its notice still**, which is the difference between *not this
      // parent's* and *nobody's*.
      expect(receiptsTo(second.pm)).toEqual([])
    })

    it('⛔ a conversation that never gave work out reads nothing and says nothing', async () => {
      // ⚑ **The ordinary case, and it is the one this line runs on every registration.**
      const alone = await personOpens('nobody-delegates')
      expect(store.piecesGivenBy(alone)).toEqual([])
      expect(receiptsTo(alone)).toEqual([])
      expect(wordsSentTo(alone)).toEqual([])
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §2 · once — and the receipt is what makes it once across a restart
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · told once, and the record of it outlives the process', () => {
    it('ordinary ending pairs with the interrupted receipt: the giver step is durable across a restart', async () => {
      const { pm, worker, task } = await aPmAndItsWorker()
      const card = await cardOn(worker)
      await host.send(pm, 'Watch the fictional work.', window)
      await cardOn(pm)
      const admission = host as unknown as { reconciliationMayWake(target: string): boolean }
      const original = admission.reconciliationMayWake.bind(host)
      vi.spyOn(admission, 'reconciliationMayWake').mockImplementation(
        (target) => target !== worker && original(target),
      )
      host.claimSession(worker, window)
      await host.respondPermission(worker, card, { outcome: 'allow' }, window)
      await waitFor(
        () =>
          store
            .reconciliationReceipts(worker, task)
            .some((row) => row.step === 'giver' && row.outcome === 'delivered'),
        'the held ladder receipt',
      )
      const receipt = store
        .reconciliationReceipts(worker, task)
        .find((row) => row.step === 'giver' && row.outcome === 'delivered')!
      expect(store.reconciliationDelivery(pm, receipt.messageId!)).toBe('pending')
      expect(receiptsTo(pm)).toEqual([])
      expect(host.stalledWorkForAPerson().rows.map((row) => row.piece)).not.toContain(task)
      expect(taskOf(worker, task)).toMatchObject({ state: 'stalled', stalledBecause: 'turn_ended' })
      await host.closeAll()
      const next = buildHost(createSessionStore(db, tick))
      await next.resumeSession(pm, window)
      await waitFor(
        () => store.reconciliationReceipts(worker, task).at(-1)?.step === 'person',
        'the failed held handover to reach the person',
      )
      expect(next.workIncidentsForAPerson().rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ piece: task, kind: 'stopped', cause: 'turn_ended' }),
        ]),
      )
      expect(
        events(pm).filter(
          (row) => row.type === 'message_queued' && row.appNotice === 'a-work-wait-needs-attention',
        ),
      ).toHaveLength(1)
      expect(
        store
          .reconciliationReceipts(worker, task)
          .filter((row) => row.step === 'giver' && row.outcome === 'delivered'),
      ).toHaveLength(1)
      expect(receiptsTo(pm)).toEqual([])
    })

    it('🔴 two launches, one notice — and the receipt in the parent’s own ledger is why', async () => {
      const { pm, task, next } = await theAppDiesHoldingTheWork()
      await next.resumeSession(pm, window)
      await waitFor(() => noticesTo(pm, task).length === 1, 'the first notice')

      // ⛔ **The receipt says what was said**, so the row is a record rather than a flag.
      expect(receiptsTo(pm)).toEqual([
        { type: 'work_stall_told', piece: task, cause: 'app_restarted', how: 'pushed' },
      ])

      // ⚠️ **A second launch over the same database**, with a slot that has never heard of this task.
      await next.closeAll()
      const third = buildHost(createSessionStore(db, tick))
      await third.resumeSession(pm, window)
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(noticesTo(pm, task)).toHaveLength(1)
      expect(receiptsTo(pm)).toHaveLength(1)
    })

    it('⛔ a receipt whose HELD notice was abandoned does not stand, and the parent is told again', async () => {
      // 🔴 **`queueMessage` either sends or holds, and a held message can still be abandoned.** ⛔ A
      // receipt that stood on one would silence the push for ever about a notice nobody read — which
      // is `an-unenumerated-state-counts-as-success` with a row behind it.
      const { pm, worker, task } = await aPmAndItsWorker()
      await cardOn(worker)

      // ⚠️ **The parent is made BUSY**, which is the whole of what decides send-or-hold.
      await host.send(pm, 'think about something', window)
      await cardOn(pm)
      unplugTheWindow()
      await letTheTurnFinish(worker)
      await waitFor(() => receiptsTo(pm).length === 1, 'the receipt for the held notice')

      // ⛔ **Held, and the receipt NAMES the message that is holding it.**
      const receipt = receiptsTo(pm)[0]
      expect(receipt?.messageId, JSON.stringify(receipt)).toBeTypeOf('string')
      expect(noticesTo(pm, task)).toEqual([])
      expect(store.workReportedTo(pm).has(task)).toBe(true)

      // ⚠️ **And then the app goes away holding it**, which ends that message `abandoned`.
      // ⚑ **D-017 · R3 — by a CRASH**: a quit ends nothing now (the held notice waits for the
      // parent's next start and goes first, so its receipt stands — the paired positive's shape),
      // and the next launch's sweep is what still settles a message nothing is holding.
      // ⚠️ `relaunchAfterACrash`'s second store object is what makes the sweep see it.
      const next = relaunchAfterACrash()
      expect(
        events(pm).some(
          (event) =>
            event.type === 'message_unqueued' &&
            event.reason === 'abandoned' &&
            event.messageId === receipt?.messageId,
        ),
      ).toBe(true)
      // ⛔ **The receipt is WITHDRAWN by that ending**, read through the store's own answer.
      expect(store.workReportedTo(pm).has(task)).toBe(false)

      await next.resumeSession(pm, window)
      await waitFor(() => noticesTo(pm, task).length === 1, 'the notice, said again')
      expect(receiptsTo(pm)).toHaveLength(2)
    })

    it('⛔ the paired positive: a receipt for a notice that WENT names no message and stands', async () => {
      // ⚑ **The same relaunch and the same abandonment sweep, one fact over** — the notice was sent
      // rather than held, so there is nothing for a quit to abandon and the parent is not told twice.
      const { pm, task, next } = await theAppDiesHoldingTheWork()
      await next.resumeSession(pm, window)
      await waitFor(() => noticesTo(pm, task).length === 1, 'the notice')
      expect(receiptsTo(pm)[0]?.messageId).toBeUndefined()

      await next.closeAll()
      expect(store.workReportedTo(pm).has(task)).toBe(true)
      const third = buildHost(createSessionStore(db, tick))
      await third.resumeSession(pm, window)
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(noticesTo(pm, task)).toHaveLength(1)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the family — `400` named three causes with no audience; which of them have one now
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · every cause a live push could not reach, and the one that is still silent', () => {
    it('🔴 `message_never_sent` written by a LAUNCH reaches the parent', async () => {
      // ⛔ **`settleStrandedMessages`' row, and it is written at construction like the restart's.**
      // ⚑ The work was never handed over at all, so *send it again* is the obvious move and the
      // parent is the one who gets to make it.
      // ⚑ **D-016 · the turn is started by the first give's brief**, and the piece this test needs
      // HELD is a SECOND give from the same PM, which reaches the same busy conversation — a child
      // may hold more than one open piece now, and the held one is the one this reads.
      const { pm, worker, pmTools, workerProfile } = await aPmAndItsWorker('are you free?')
      await cardOn(worker)
      const held = await aSecondGive(pmTools, workerProfile, 'the held one')
      expect(held.delivery, JSON.stringify(held)).toBe('held')
      const waiting = held.piece as string
      expect(stateOf(worker, waiting)).toBe('waiting')
      await host.close(pm, window)
      unplugTheWindow()

      const next = relaunchAfterACrash()
      expect(taskOf(worker, waiting)).toMatchObject({
        state: 'stalled',
        stalledBecause: 'message_never_sent',
      })
      await next.resumeSession(pm, window)
      // ⚠️ **`anythingSaidTo` reads the held row as well as the sent one**, which is what a notice
      // arriving behind another one needs — ⚑ D-016: the first piece's notice is the other one, and
      // this reads the held piece's alone.
      await waitFor(() => anythingSaidTo(pm, waiting).length === 1, 'the parent to be told')
      expect(anythingSaidTo(pm, waiting)[0]).toContain(THE_MESSAGE_NEVER_WENT)
    })

    it('🔴 the turn a clean quit interrupted reaches it too — a clean quit is not an answer either', async () => {
      // ⚠️ **HO-018 §2.3: *"nothing about a quit tells us the work failed."*** ⛔ It does not tell us
      // it succeeded either, and the parent is the one who decides — so it is told, at the first
      // moment it can be.
      const { pm, worker, task } = await aPmAndItsWorker()
      await cardOn(worker)
      unplugTheWindow()

      await host.closeAll()
      // ⚑ **D-016c · the TURN's cause, never the quit's**: the quit interrupted the turn the work
      // was parked in, and a stop moves no piece by being a stop.
      expect(taskOf(worker, task)?.stalledBecause).toBe('turn_interrupted')
      // ⛔ **Nothing was said during the quit itself**, which is a decision: every conversation is
      // closing, and a message queued into one is a message the same teardown abandons.
      expect(noticesTo(pm, task)).toEqual([])

      const next = buildHost(createSessionStore(db, tick))
      await next.resumeSession(pm, window)
      await waitFor(() => noticesTo(pm, task).length === 1, 'the parent to be told')
      // 🔴 **Told — and told the turn's cause, the one sentence a stalled piece has for it.** ⚑ The
      // subject of this pin is unchanged — a clean quit is not an answer, and the parent is told at
      // the first moment it can be. (`692`'s kept-open sentence, and its negative against *"has
      // ended"*, went with the stop cause they were about, D-016c: no cause and no sentence names a
      // stop now.)
      expect(noticesTo(pm, task)[0]).toContain(undrivenSentence('turn_interrupted'))
    })

    // ⚑ **D-017 · commit 3** — *the one that stays silent: an agent that ended the conversation ITSELF
    // is not told about it* went with `end_agent`: no agent's act ends (or stops) a conversation any
    // more, so nothing writes `its-own-ending`, and the silence it measured has no gesture left.

    it('⛔ the control, one fact over: a PERSON ending a child leaves the parent owed its notice — for the work nothing drives', async () => {
      // 🔴 **The identical gesture with a different asker**, which is what made the silence above a
      // decision about the ASKER rather than about the cause. ⚑ `sessionSpeakingAs` answers `null`
      // for a window, so nothing stands in for the message and the parent is told.
      // ⚑ **D-016 · the turn is started by the first give's brief, and the piece this test needs HELD
      // is a second give** from the same PM, reaching the same busy conversation. ⛔ **496 · busy
      // without a card** is gone with it: it was built because `end_agent` refused a child a person
      // was being asked something in, and the person's Close below asks no such rail.
      const { pm, worker, pmTools, task, workerProfile, otherProfile } =
        await aPmAndItsWorker('the first one')
      await cardOn(worker)
      const theHeldGive = await aSecondGive(pmTools, workerProfile, 'the held one')
      expect(theHeldGive.delivery, JSON.stringify(theHeldGive)).toBe('held')
      const waiting = theHeldGive.piece as string
      unplugTheWindow()

      // ⚠️ **The person's stop.** ⛔ It was `end_agent`'s host door with a window as the asker — the
      // same verb the test above measured from the PM — and both went with `end_agent` (D-017).
      // ⚑ A person's Close is the stop a person's press reaches. The person takes the conversation
      // over first, which is the app's own rule for a spawned child: it is nobody's until somebody
      // claims it.
      host.claimSession(worker, window)
      await host.close(worker, window)
      // ⚑ **D-017 · R3 — the Close is a stop that starts the child again for the brief it held**,
      // and that start sends it. ⚑ **D-016c — a stop moves no piece**, and **D-016 · commit 6 · R4
      // — a brief drives the piece it names and no other**: the held brief's turn drives its own
      // piece, which never stalls, and the parent is owed nothing about it.
      await waitFor(
        () =>
          events(worker).some(
            (event) => event.type === 'message_unqueued' && event.reason === 'sent',
          ) && stateOf(worker, waiting) === 'working',
        'the held brief to go at the next start and drive its piece',
      )
      // 🔴 **The first piece is the work nothing drives**: the brief held for the Close's start
      // names the other piece, so the turn the Close interrupted is the last word on this one — it
      // stalls on that turn, and the parent is told that.
      expect(taskOf(worker, task)).toMatchObject({
        state: 'stalled',
        stalledBecause: 'turn_interrupted',
      })
      await waitFor(
        () => anythingSaidTo(pm, task).length === 1,
        'the parent to be told about the work nothing drives',
      )
      expect(anythingSaidTo(pm, task)[0]).toContain(undrivenSentence('turn_interrupted'))
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(anythingSaidTo(pm, waiting)).toEqual([])
      expect(receiptsTo(pm).map((one) => one.piece)).toEqual([task])
      // ⚑ (D-017 — nothing writes `its-own-ending` any more, and D-016 took the word out of the
      // receipt's type, so no receipt of that kind can stand in for the notice below.)
      expect(receiptsTo(pm).map((one) => one.how)).not.toContain('its-own-ending')

      // 🔴 **The half that is owed: a child whose only piece is being driven when a person closes
      // it.** ⛔ `close()` interrupts the running turn and nothing is held to drive the piece again,
      // so it stalls on the turn the Close interrupted, and the parent is told that.
      // ⚑ D-016 · a give starts the second child and hands it the piece being driven, in one act.
      const second = await aSecondGive(pmTools, otherProfile, 'the running one')
      const driven = second.agent as string
      const running = second.piece as string
      await cardOn(driven)
      expect(stateOf(driven, running)).toBe('working')
      host.claimSession(driven, window)
      // ⛔ **496 · `host.close`**, the verb a person's press actually reaches. ⚑ (`host.endAgent`,
      // which a window could reach only from a test, went with `end_agent` in D-017.)
      await host.close(driven, window)
      await waitFor(() => stateOf(driven, running) === 'stalled', 'the driven work to stall')
      // 🔴 **The parent is told, and told the TURN's cause.** ⛔ At the moment `close()` writes the
      // `turn` row, the child is still parked on its permission card — an OPEN routing only a
      // person can settle — so the composition reads `waiting-on-a-person` and
      // {@link stalledWithACause} refuses the notice (`609`). ⚑ The teardown then strands that
      // request, the composition lets go, and the cause that reaches the stalled row is the turn
      // the Close interrupted: **D-016c** — the conversation's own ending is no cause, so
      // `turn_interrupted` stands, where `609` measured `conversation_ended` overwriting it.
      // ⚑ **661 · a set-right receipt (a row written before D-016c) carries no cause**, so the
      // member is read before the field. ⚠️ **Read about the DRIVEN child's piece alone**: the first
      // child's undriven piece has a `turn_interrupted` receipt of its own (above), which would
      // answer for this one.
      const toldAboutTheDriven = (): number =>
        receiptsTo(pm).filter((one) => one.piece === running).length
      expect(
        receiptsTo(pm)
          .filter((one) => one.piece === running)
          .map((one) => ('cause' in one ? one.cause : one.how)),
      ).toContain('turn_interrupted')
      const beforeTheLaunch = toldAboutTheDriven()
      expect(beforeTheLaunch).toBeGreaterThan(0)
      await host.closeAll()
      const next = buildHost(createSessionStore(db, tick))
      await next.resumeSession(pm, window)
      // ⚑ **And the launch says nothing MORE**, which is the receipt doing its job from the other
      // direction: the parent has been told once and a second launch does not tell it again.
      // ⚠️ **Read about the DRIVEN child, and by its receipts.** The quit interrupts the first
      // child's turn, which its Close had started again (R3), so the launch owes the parent notices
      // about THAT child's work — the turn the quit stopped. ⛔ Counted by receipts rather than by
      // `anythingSaidTo`: a notice the quit left held is sent at this start, and that reader counts
      // its `message_queued` and its `user_turn` as two.
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(toldAboutTheDriven()).toBe(beforeTheLaunch)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §4 · not a poll, not a clock, not a surface — the three things the brief forbids
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · where the push may NOT hang, asserted rather than promised', () => {
    it('⛔ the triggers are named call sites, and each one is a thing that HAPPENED', () => {
      // 🔴 **`400`'s own ruling about this hook: *"its PLACEMENT is the rule"*.** ⚑ A placement that
      // is the rule has to be readable, so it is enumerated here — and the enumeration is what would
      // go red if another site appeared without somebody deciding about it (`702` decided the fifth).
      const source = codeOnly(sourceOf(mainRoot, 'runtime/runtime-host.ts'))
      const callers = (name: string): string[] =>
        source
          .split('\n')
          .filter((line) => line.includes(`this.${name}(`))
          .map((line) => line.trim())

      // ⛔ **One decision function, and every trigger goes through it**, so *is this owed and has it
      // been said* cannot come to two answers.
      expect(callers('tellIfNobodyHasYet')).toHaveLength(3)
      // ⚑ **The pump** (400), a provider's own `turn` and `status`. ⛔ A thing that happened; not a
      // poll. ⚑ **D-016c · the reopen's trigger (661) went with the corrections it asked for**: a
      // reopen moves no piece and a start tells nobody anything, so there is nothing for it to ask.
      // ⚑ **702's trigger — the CLOSING of a conversation the quit left open (`699` F-1), its stamp
      // going in `forgetTheQuitOf` — went with its subject at D-017b.** A conversation a quit left is
      // a conversation like any other now: no press closes it (the End conversation button is gone)
      // and the store keeps no quit stamp for a start to take away (`forgetTheQuit` went with it),
      // so there is no such moment left to tell a giver about. ⛔ Removed from the roster rather
      // than left to go quietly unmatched.
      // 🔴 **D-005a · and a held message ending UNSENT** (F019's fix check) — `publishOurs` asks
      // `askOnceTheQueueLeftItUndriven`: the fold holds a turn's stall while a message waits to drive
      // the work, and writes it when the last one leaves unsent, a moment no provider row follows.
      // ⛔ A thing that happened; not a poll.
      // ⚑ **D-017 · R1 · and the deliveries waiting on a conversation's start having all landed or
      // failed** (`afterWhatArrivedFirst`) — asked only when a notice was put off for them
      // (`aDeliveryIsAboutToDriveIt`), so work a delivery did not drive is still told. ⛔ A thing
      // that happened; not a poll.
      // ⚑ **D-017 · R10 · and a conversation that could never be reopened being REPLACED**
      // (`replaceWhatCanNeverBeReopened`) — its open work stalls `could_not_be_reopened`, and its
      // giver is owed that. ⛔ A thing that happened; not a poll.
      // ⚑ **And a launch's start of a conversation whose background work the restart stopped,
      // ENDING** (`wakeForStoppedWork`) — its givers were told nothing while that start was coming,
      // and are asked once it has driven their work or failed to. ⛔ A thing that happened; not a poll.
      // ⚑ **And a launch's wake-up for a job, DROPPED** (`stallWhatItsJobWouldHaveDriven`) — its
      // conversation can never be reopened, so the work the launch left `working` for that job is
      // stalled after all, and its givers are owed that. ⛔ A thing that happened; not a poll.
      // ⚑ **F075 · and a person's stop-and-send letting go of its hold** (`sendInterrupting`) — while
      // it stood, their words were about to drive the work it cut, so nothing was said; a send
      // refused leaves that work undriven. ⛔ A thing that happened; not a poll.
      // ⚑ **F076 · and a conversation a refused login stopped having its reopen DECIDED**
      // (`aReopenIsDecided`, from `reopenOnARenewedSignIn`, and from `endOnAMovedSignIn` when a
      // Codex conversation is not ended after all) — its givers were told nothing while it was
      // decided, and are asked once it is. ⛔ A thing that happened; not a poll.
      // ⚑ **And a launch's start to continue a turn the app cut, ENDING** (`wakeForACutTurn`), and
      // **that continuation not going** (`notContinued`) — its givers were told nothing while it was
      // coming, and are asked once it has driven their work or will not. ⛔ A thing that happened;
      // not a poll.
      // ⚑ **And a service's start for its next piece FAILING** (`startTheServiceFor`) — that
      // piece's brief ends unsent, so it stalls, and its caller is owed that. ⛔ A thing that
      // happened; not a poll.
      // ⚑ **And a cut turn not continued whose own ending stalled its work** (`whatTheCutLeftStalls`,
      // a program's or a limit's cut) — its givers were told nothing while it might go on, or were
      // told at the limit, and are asked once it will not. ⛔ A thing that happened; not a poll.
      // ⚑ **And a limit's continuation ENDING** (`wakeForALimitsCut`) — asked once it has driven
      // the work or will not. ⛔ A thing that happened; not a poll.
      expect(callers('tellWhoeverGaveTheWork')).toEqual([
        'this.tellWhoeverGaveTheWork(conversation)',
        'this.tellWhoeverGaveTheWork(conversation)',
        'this.tellWhoeverGaveTheWork(conversation)',
        '} else this.tellWhoeverGaveTheWork(conversation)',
        'this.tellWhoeverGaveTheWork(conversation)',
        'this.tellWhoeverGaveTheWork(conversation)',
        'this.tellWhoeverGaveTheWork(conversation)',
        'this.tellWhoeverGaveTheWork(session.id)',
        'if (session.holdingQueue === 0) this.tellWhoeverGaveTheWork(session.id)',
        'if (this.askAgainOnceItArrived.delete(sessionId)) this.tellWhoeverGaveTheWork(sessionId)',
        'this.tellWhoeverGaveTheWork(old)',
        'this.tellWhoeverGaveTheWork(sessionId)',
        'this.tellWhoeverGaveTheWork(session.id)',
      ])
      expect(source).toMatch(
        /if \(event.type === 'turn' \|\| event.type === 'status'\) \{\s*this.tellWhoeverGaveTheWork\(session.id\)/,
      )
      // ⚑ **The finalizer** (404) — where the app writes the two causes a provider never sends.
      expect(callers('settleTheNoticesFor')).toEqual(['this.settleTheNoticesFor(session)'])
      // ⚑ **The registration** (404) — the moment a parent becomes able to be told anything.
      expect(callers('tellAboutWorkItGaveOut')).toEqual(['this.tellAboutWorkItGaveOut(session)'])
    })

    it('⛔ no clock: HO-018 §2.2 withdrew criterion 5 and nothing here brings a timer back', () => {
      // ⚠️ **The whole delivery path, read as code with its prose stripped** — `400` deleted 26
      // assertions to honour the retraction, and a push driven by an interval would put the retracted
      // mechanism back under a different name.
      const source = codeOnly(sourceOf(mainRoot, 'runtime/runtime-host.ts'))
      const slice = (from: string, to: string): string => {
        const start = source.indexOf(from)
        const end = source.indexOf(to, start)
        expect(start, `${from} is gone`).toBeGreaterThan(-1)
        expect(end, `${to} is gone`).toBeGreaterThan(start)
        return source.slice(start, end)
      }
      const push = [
        slice('private tellWhoeverGaveTheWork(', 'private tellAboutWorkItGaveOut('),
        slice('private tellAboutWorkItGaveOut(', 'private tellIfNobodyHasYet('),
        slice('private tellIfNobodyHasYet(', 'private async tellOneParent('),
        // ⚠️ **612 · the slice used to end at `private armEscalationLook(`** and that method went
        // with the deadline (HO-088 §3.1). ⛔ **The BOUND moved and the slice did not**: the next
        // declaration after `tellOneParent` is the person's-queue reader, which is where this walk
        // has always stopped — `an-anchor-on-a-lists-last-member-dies-when-anything-appends`, met
        // by naming the neighbour rather than the gap.
        // ⚑ It stops where the window's reads begin: those answer the window, push nothing, and
        // log at most once a minute by the clock.
        slice('private async tellOneParent(', 'async readForWindow<T>('),
        // ⚑ **The finalizer's half is in the census too**, because it is the site a reader would be
        // least likely to look at and the one that runs while the app is going away. ⚑ **D-017 —
        // bounded by its NEXT declaration**: it ran to `private cardFor(`, and the one state
        // derivation (`cardReads`, `stateOf` — which reads the clock for when a schedule next fires,
        // and pushes nothing) now sits between them.
        slice('private settleTheNoticesFor(', 'private cardReads('),
        // ⚑ **D-016c · `702`'s closing half went** — `takeBackWhatTheClosingMadeFalse`, the step
        // `tellIfNobodyHasYet` chained ahead of the ending, took back a kept-open notice, and the
        // kept-open family is gone with the stop cause it served.
      ].join('\n')
      for (const forbidden of ['setTimeout', 'setInterval', 'Date.now', 'this.now(']) {
        expect(push, `the push reaches ${forbidden}`).not.toContain(forbidden)
      }
      // ⛔ **And no sink either** — `396` §2.1: a gate answering *is anybody looking?* decides
      // nothing about whether work happens.
      for (const forbidden of ['sink', 'alive', 'NO_SURFACE']) {
        expect(push, `the push reaches ${forbidden}`).not.toContain(forbidden)
      }
    })

    it('⛔ the fold never learns the word: a receipt cannot move a task', () => {
      // 🔴 **{@link WorkStallTold} lives in the PARENT's ledger and is folded by nothing.** ⚠️ A
      // task's state is derived from the ledger the work landed in; a row in another conversation
      // saying somebody was TOLD about it must not be able to change what it says.
      // ⚠️ **`codeOnly`, added at `406`, and the census was weaker than it read without it.** This
      // line asserted over the WHOLE file including its prose, so a docblock explaining why the
      // receipt is not folded here would have reddened it — and `406` wrote exactly that docblock.
      // ⛔ `a-source-census-must-strip-prose-before-it-asserts`: the claim is about what the code
      // reaches, and a comment naming the thing it refuses to reach is the strongest form of the
      // rule being kept. ⚑ Non-vacuous: the string is still in the file, one line below.
      // ⚑ **D-016 · the receipt's word is `work_stall_told`** (it was `work_reported`).
      const fold = codeOnly(sourceOf(sharedRoot, 'tasks.ts'))
      expect(sourceOf(sharedRoot, 'tasks.ts')).toContain('work_stall_told')
      expect(fold).not.toContain('work_stall_told')
      // ⛔ **The store's narrow task read does not select it either**, which is the other half: a
      // type the fold ignores but the reader fetches is a row somebody will eventually fold.
      const storeSource = sourceOf(mainRoot, 'db/session-store.ts')
      // ⚠️ **Sliced to the statement's OWN close, and both ends asserted present.** ⛔ The slice
      // ended at the next declaration, `selectTaskedSessionsInProject`, until D-016 deleted it —
      // and an absent end token is `-1`, which sliced to the file's last character and read the
      // whole store as this one statement (`a-position-census-passes-on-an-absent-anchor`).
      // ⚑ **D-016 · the fold's read is `selectPieceEvents`**, and its first word is `work_given`.
      const opens = storeSource.indexOf('const selectPieceEvents = db.prepare(')
      expect(opens, 'selectPieceEvents was renamed or removed').toBeGreaterThan(0)
      const closes = storeSource.indexOf('\n  )\n', opens)
      expect(closes, 'selectPieceEvents no longer closes where a statement does').toBeGreaterThan(
        opens,
      )
      const taskSelect = storeSource.slice(opens, closes)
      expect(taskSelect).toContain("'work_given'")
      // ⚑ **The slice is the one statement and not a neighbour**: it ends at its own ORDER BY.
      expect(taskSelect.trimEnd().endsWith('ORDER BY ordinal`,')).toBe(true)
      expect(taskSelect).not.toContain('work_stall_told')
    })

    it('⛔ exactly one place writes the receipt, and exactly one reads it back', () => {
      // ⚑ **`400`'s census shape, one row over.** Two writers of one fact is how a parent comes to
      // hold two accounts of whether it was told.
      const writers = filesUnder(mainRoot)
        .filter((file) => file.text.includes("type: 'work_stall_told'"))
        .map((file) => file.path)
      expect(writers).toEqual(['runtime/runtime-host.ts'])
      const readers = filesUnder(mainRoot)
        .filter((file) => codeOnly(file.text).includes('workReportedTo('))
        .map((file) => file.path)
        .sort()
      expect(readers).toEqual(['db/session-store.ts', 'runtime/runtime-host.ts'])
    })

    it('⛔ the notice itself is unchanged: one table of sentences, and it is still `400`’s', () => {
      // ⚠️ **This dispatch moved WHEN a parent is told and never WHAT it is told.** ⛔ A second
      // spelling of *the app restarted while it was open* is how a parent comes to read two accounts
      // of one event — `undrivenSentence` and `undrivenWorkText` share the one table.
      //
      // 🔴 **The table MOVED at `406` and this assertion moved with it.** It lives in
      // `shared/tasks.ts` now, because the row a PERSON reads is a third caller and the renderer
      // cannot import `main/`. ⛔ The count is asserted where the table IS rather than where it
      // was: a census re-pointed at the new home keeps the rule, and one left behind would have
      // gone green over five sentences copied into the renderer — which is the defect it exists
      // for. ⚠️ `reply-rails.ts` is asserted to hold no table of its own, which is the half that
      // could not have been said before the move.
      const sentences = codeOnly(sourceOf(sharedRoot, 'tasks.ts'))
      expect(sentences.match(/UNDRIVEN_SENTENCES/g) ?? []).toHaveLength(2)
      expect(sentences).toContain('the app restarted while it was open.')
      const rails = codeOnly(sourceOf(mainRoot, 'runtime/reply-rails.ts'))
      expect(rails).not.toContain('the app restarted while it was open.')
      // ⚑ **484 · it reaches the table through `undrivenSentence` now, and that is the same rule
      // tightened rather than a different one.** ⛔ That function's own docblock says *"one table
      // and THREE callers, never three tables"*; the notice used to index the record directly and
      // append its own full stop, which is a second composition of one sentence. ⚠️ **The half this
      // census exists for is unchanged and is asserted both ways**: no table here, and it really
      // does read the shared one.
      expect(rails.match(/UNDRIVEN_SENTENCES/g) ?? []).toHaveLength(0)
      expect(rails.match(/undrivenSentence/g) ?? []).toHaveLength(2)
      const host = codeOnly(sourceOf(mainRoot, 'runtime/runtime-host.ts'))
      expect(host.match(/undrivenWorkText\(/g) ?? []).toHaveLength(1)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §5 · what a second trigger must not quietly stop being true
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · the rails around it, asked again in the state this dispatch creates', () => {
    it('⛔ criterion 13 intact: the notice takes its own slot and a second WORK message is refused', async () => {
      // 🔴 **`400` added the third {@link MAILBOX_KINDS} member so its push could not be refused, and
      // this dispatch adds a trigger that fires while a parent is at its busiest** — a launch, with
      // the parent holding whatever a person left in it.
      const { pm, worker, task } = await aPmAndItsWorker()
      await cardOn(worker)

      // ⚠️ **The parent is BUSY**, which is the only state in which the kind of a notice can be
      // observed at all: a notice into an idle parent goes straight out as a turn and takes no slot.
      await host.send(pm, 'think about something', window)
      await cardOn(pm)
      unplugTheWindow()
      await letTheTurnFinish(worker)
      await waitFor(() => receiptsTo(pm).length === 1, 'the receipt for the held notice')

      // ⛔ **It is in the mailbox as a `notice` and not as work.**
      const queued = events(pm).filter((event) => event.type === 'message_queued')
      expect(queued.map((event) => (event.type === 'message_queued' ? event.kind : ''))).toEqual([
        'notice',
      ])
      expect([...MAILBOX_KINDS]).toEqual(['work', 'question', 'notice'])
      // ⛔ **So a person's words are held beside it** — and, since D-010, so is a second message:
      // nothing is refused a slot, and each goes in order.
      const held = await host.queueMessage(pm, 'a person’s words, held', window)
      expect(held.outcome).toBe('queued')
      const second = await host.queueMessage(pm, 'a second message', window)
      expect(second.outcome).toBe('queued')
      expect(stateOf(worker, task)).toBe('stalled')
    })

    it('⛔ `stalled` is still a CONDITION on an open task, and nothing terminal came back', async () => {
      const { pm, worker, task, next } = await theAppDiesHoldingTheWork()
      await next.resumeSession(pm, window)
      await waitFor(() => noticesTo(pm, task).length === 1, 'the notice')

      // ⚑ **Being told changes nothing about the work**, which is HO-018's principle: the engine
      // records what it observed and the PARENT decides.
      expect(taskOf(worker, task)).toMatchObject({
        state: 'stalled',
        stalledBecause: 'app_restarted',
        endedAt: null,
        outcome: null,
      })
      expect(TASK_IS_OPEN.stalled).toBe(true)
      expect([...TASK_STATES]).not.toContain('abandoned')
    })

    it('⛔ the two vocabularies stay two — the REQUEST one is untouched', () => {
      // ⚠️ **`398` §3 measured that one word lived in both and meant different things**; `400`
      // asserted the request vocabulary unchanged, and a dispatch that adds an event to the task
      // family must leave that assertion true.
      expect([...REQUEST_STATES]).toEqual([
        'open',
        'answered',
        'rejected',
        'decided',
        'withdrawn',
        'abandoned',
        'stranded',
        'interrupted',
        // ⚑ **591's, and what this test asserts is untouched.** ⛔ `400`'s claim is that a dispatch
        // adding to the TASK family leaves the REQUEST family alone; `591` is the other direction
        // — it adds to the REQUEST family and leaves the task one alone, which the line above this
        // block still measures.
        'work-withdrawn',
        // ⚑ **D-016, commit 5 · a close ends a question as a take-back does**, in its own word — the
        // REQUEST family's own addition, beside `591`'s, with every older member where it was.
        'work-closed',
        // The work it was about was handed back.
        'work-replied',
        // ⚑ **D-009** — the conversation it was addressed to ended without answering it.
        'recipient-ended',
      ])
    })
  })
})
