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
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { THE_APP_ITSELF } from '../src/main/runtime/runtime-host'
import type { Caller, CallerIdentity, RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentCallerId, type ToolName } from '../src/main/runtime/agent-tools'
import { TASK_IS_OPEN } from '../src/shared/tasks'
import { CAPABILITY_FIELDS, type ProfileCapabilities } from '../src/shared/capabilities'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * 🔴 **373 · a parent that survives a restart.**
 *
 * ⛔ **The question this file answers is 340's own, deferred by 340 in as many words.** Its §0
 * measured that a process restart ends a commanding relationship and then declined to rule: *"That
 * is a fact to state, not a thing I fixed… What it costs is that an in-flight delegation has to be
 * made again — which is the tools dispatch's problem if it turns out to be one, and is a **schema
 * question**, not a predicate question."* ⚑ `341` wrote the schema half in the very next dispatch —
 * `parent_session_id`, `spawned_at`, `spawn_reason`, one transaction — and nobody came back.
 *
 * ⚑ **What lands here is a DERIVATION and not a restoration.** Nothing about a commanding
 * relationship is persisted, and `commandedBy` still dies with the process. What survives is the
 * provenance row, the only commander a row can NAME is the conversation that asked for this one, and
 * a resume computes the identity that conversation's own toolset presents. ⛔ So 340's safety
 * sentence holds verbatim through the change: *"a restart can never hand command of a session to an
 * agent that did not ask for it."*
 *
 * ⚠️ **§1 is written at the state where the two readings DISAGREE** — a COLD RESUME with a live
 * parent. A test that restarts nothing passes under both readings and measures neither, which is
 * what `341` paid for three times over; so §1.3 stands the same pair up before the restart, where
 * both readings agree, precisely to show the restart is the only variable.
 *
 * ⚑ **Real host, real SQLite ledger, real migrations, real rails.** The only double is the provider,
 * and it is subclassed to keep the toolsets the HOST handed each session — so §1 drives the parent
 * through the toolset this app built for it rather than through an identity the test invented.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const mainRoot = join(here, '../src/main')

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

/**
 * ⛔ **The provider double, keeping the toolset the host handed each launch and each reopen.**
 *
 * ⚑ **Why it matters here and did not in 371.** The entitlement this dispatch derives is spelled
 * `agent:<parent>`, and a test that mints that string itself proves only that the predicate compares
 * two equal strings. What has to be true is that the toolset THIS APP builds for a reopened parent
 * presents it — so §1 calls the object `reopenSession` passed to `resume`, and nothing else.
 */
class ToolWatchingRuntime extends FakeRuntime {
  constructor(
    private readonly runningProvider: Provider,
    private readonly handed: AgentToolset[],
    /** The option keys each launch and each reopen received, in order (§8). */
    private readonly launches: Array<{ kind: 'start' | 'resume'; keys: readonly string[] }>,
    /**
     * ⛔ **The PROVIDER's record of what it issued, shared across every runtime this suite builds.**
     * `createRuntime` is called once per launch, so a runtime holding its own registry would forget
     * every ref the moment the next launch asked for one — and a restart would then fail as *"never
     * issued by this provider"*, which is a state of the double rather than of this app.
     */
    sessions: FakeProviderSessions,
    /** A fake machine credential generation, shared by every runtime in this test process (450). */
    private readonly credentialGeneration: () => number,
  ) {
    super(runningProvider, { sessions })
  }

  /**
   * 🔴 **450 · the one provider state `FakeRuntime` cannot otherwise inhabit.**
   *
   * ⛔ The real Claude handle remembers the credential it opened with and latches when a later
   * turn sees a different machine credential. The slot remains live and `status()` remains idle;
   * only the turn gate refuses it. Codex has no such check, so the double keeps the member absent
   * there too.
   */
  private watchCredential(handle: FakeSessionHandle): FakeSessionHandle {
    if (this.runningProvider !== 'claude') return handle
    const openedWith = this.credentialGeneration()
    let superseded = false
    Object.defineProperties(handle, {
      signInSuperseded: { get: () => superseded, configurable: true },
      checkSignIn: {
        value: async () => {
          if (this.credentialGeneration() !== openedWith) superseded = true
          return superseded
        },
        configurable: true,
      },
    })
    return handle
  }
  override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
    const handle = this.watchCredential(await super.start(options))
    this.launches.push({ kind: 'start', keys: Object.keys(options) })
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
  override async resume(
    ref: SessionRef,
    options: ResumeOptions,
  ): ReturnType<FakeRuntime['resume']> {
    const handle = this.watchCredential(await super.resume(ref, options))
    this.launches.push({ kind: 'resume', keys: Object.keys(options) })
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
}

describe('373 · a parent that survives a restart', () => {
  let userData: string
  /** The folder the tree hangs off — the one a person opened their PM in. */
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  /** Every host built in one test, so a restart cannot leak a provider. */
  let hosts: RuntimeHost[]
  /** The toolsets this app handed out, in the order it handed them out. */
  let handed: AgentToolset[]
  /** The option keys the host handed each launch and each reopen, in order. */
  let launches: Array<{ kind: 'start' | 'resume'; keys: readonly string[] }>
  /** What the provider itself remembers having issued — see {@link ToolWatchingRuntime}. */
  let issued: FakeProviderSessions
  /** Moving this number is the fake equivalent of replacing or renewing the Claude credential. */
  let credentialGeneration: number
  let counter: number
  let clock: number
  let window: RecordingSink
  let secondWindow: RecordingSink
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) =>
        new ToolWatchingRuntime(provider, handed, launches, issued, () => credentialGeneration),
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-restart-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-restart-root-'))
    mkdirSync(join(root, 'pkg', 'sub'), { recursive: true })
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 5_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handed = []
    launches = []
    issued = new FakeProviderSessions()
    credentialGeneration = 0
    host = buildHost()
    window = new RecordingSink('webContents:1')
    secondWindow = new RecordingSink('webContents:2')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  /** A conversation a PERSON opened, in a window. */
  const personOpens = async (profileId: string, cwd = root): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd },
      window,
    )
    return sessionId
  }

  /** An identity exists only once a person has run a conversation as it — 341 criterion 12. */
  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens(profileId)
    await host.close(id, window)
  }

  /** The toolset one session is offered, called the way a provider would call it. */
  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  /** ⛔ The toolset the HOST handed the launch or reopen that just happened. */
  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  /** What a restart is, from this host's point of view: the ledger survives and the slots do not. */
  const restart = async (): Promise<void> => {
    await host.closeAll()
    host = buildHost()
  }

  /** A person reopens a recorded conversation, and this is what the app hands it. */
  const reopen = async (
    sessionId: string,
    sink: RecordingSink = window,
  ): Promise<{ hasACommander: boolean; toolset: AgentToolset }> => {
    const resumed = await host.resumeSession(sessionId, sink)
    return { hasACommander: resumed.hasACommander, toolset: theToolsetJustHandedOut() }
  }

  /**
   * ⛔ **A PM in a window with one child of its own**, and the child is spawned with no folder
   * named — so it starts in the PM's, which is `371`'s ordinary case and the one every section but
   * §5 wants. §5 names a folder explicitly, because its question is what a RESTART does to a
   * conversation placed in one (`726` · R92: a named folder is a place now, never a bound).
   */
  const aPmAndItsWorker = async (
    pmProfile = 'pm',
    workerProfile = 'worker',
    at = root,
  ): Promise<{ pm: string; worker: string; pmTools: AgentToolset; piece: string }> => {
    await bringIdentityIntoBeing(workerProfile)
    const pm = await personOpens(pmProfile, at)
    const pmTools = theToolsetJustHandedOut()
    // 🔴 **D-016 · the grant is left at its ruled `any`** (HO-058 §1). ⛔ This file's whole subject
    // is whether a parent commands its OWN child across a restart, and every negative in it — *the
    // other PM's child, no* — is a `mayCommand` question. ⚑ **So the negatives FOLLOW UP work**,
    // which goes only to the agent the caller gave that piece to, however wide its grant
    // (`not-a-piece-you-gave`). ⚠️ The narrowing this used to take (`same-project`) went with
    // projects, and `none` would refuse the positives before any relationship was asked.
    //
    // ⚑ **D-016 · the child is started by a GIVE** — `spawn_agent` is gone — and the brief is its
    // first turn: in `ask` mode that turn parks on the card it raises, and the piece it hands the
    // child is the one every follow-up below names.
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: workerProfile,
      title: 'the work this dispatch is about',
      brief: 'the work this dispatch is about',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    expect(given.started, JSON.stringify(given)).toBe(true)
    return { pm, worker: given.agent as string, pmTools, piece: given.label as string }
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the divergence — a cold resume with a live parent
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · a parent commands its child across a restart', () => {
    it('🔴 the reopened parent commands its reopened child — the state the two readings disagree about', async () => {
      const { pm, worker, piece } = await aPmAndItsWorker()
      await restart()

      // ⛔ Both are recordings now. A person reopens them, which is the only door there is.
      await reopen(worker, secondWindow)
      const { toolset } = await reopen(pm, window)

      // 🔴 **The whole dispatch, in one call.** Under 340's reading this is `no-such-agent`: the
      // slot came back commanded by nobody and `agentCard` refuses before it answers. Under the
      // derivation it is the same conversation, driven by the same parent, after a restart.
      // ⚑ **D-016** — a follow-up on the piece this parent gave it.
      const said = await callOn(toolset, 'message_agent', {
        kind: 'follow-up',
        piece,
        agent: worker,
        text: 'carry on where you left off',
      })
      expect(said.outcome, JSON.stringify(said)).toBe('ok')
      expect(said.agent).toBe(worker)
    })

    it('⚑ 450 · a healthy reopened idle helper accepts the follow-up its give’s answer names', async () => {
      const { pm, worker, piece } = await aPmAndItsWorker()
      await restart()

      await reopen(worker, secondWindow)
      const { toolset } = await reopen(pm, window)

      // ⛔ **The missing intersection in `428`'s proof.** Its source census carries no child state,
      // and its adjacent provider-blind fixture uses a fresh Codex fake and never messages the id.
      // Here the durable provenance has reconstructed `spawnedBy` across a cold host, the provider
      // says idle, and the published door names what to do about the piece left open.
      // ⚑ **D-016** — `profile-already-live` became the give's LOOKUP: the give finds this reopened
      // child, whose turn was stopped with the parent's piece open. ⚑ The give goes
      // through, and its answer names that piece.
      const status = await callOn(toolset, 'get_agent_status', { agent: worker })
      expect((status.agent as { state: string }).state).toBe('idle')
      const blocked = await callOn(toolset, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'the parent forgot the reopened child',
        brief: 'the parent forgot the reopened child',
      })
      expect(blocked).toMatchObject({ outcome: 'ok', agent: worker, stalled: [piece] })

      // ⚑ **The give's brief is the child's turn now**, so the follow-up its answer names is held
      // behind it, accepted, until that turn ends.
      const named = (blocked.stalled as string[])[0]
      expect(
        await callOn(toolset, 'message_agent', {
          kind: 'follow-up',
          piece: named,
          agent: worker,
          text: 'carry on',
        }),
      ).toMatchObject({ outcome: 'ok', delivery: 'queued', agent: worker, kind: 'follow-up' })
    })

    it('🔴 450 · an idle helper with a superseded Claude sign-in is named, then holds that exact follow-up until this app has reopened it on the current one', async () => {
      const { pm, worker, piece } = await aPmAndItsWorker()
      await restart()

      await reopen(worker, secondWindow)
      const { toolset } = await reopen(pm, window)
      // The child opened on generation 0. A renewal or account switch is indistinguishable to the
      // real adapter and both move the machine to another generation before the next turn.
      credentialGeneration++

      // 🔴 **Idle and sign-in-current are independent facts.** `liveChildAs` asks neither one; the
      // card asks only `handle.status()`, while `message_agent` later asks `checkSignIn()`.
      const status = await callOn(toolset, 'get_agent_status', { agent: worker })
      expect((status.agent as { state: string }).state).toBe('idle')
      // ⚑ The give finds the reopened child, and its answer names the piece.
      const blocked = await callOn(toolset, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'the parent forgot the reopened child',
        brief: 'the parent forgot the reopened child',
      })
      expect(blocked).toMatchObject({ outcome: 'ok', agent: worker, stalled: [piece] })

      // ⛔ **No piece is substituted between the two doors.**
      const named = (blocked.stalled as string[])[0]
      const held = await callOn(toolset, 'message_agent', {
        kind: 'follow-up',
        piece: named,
        agent: worker,
        text: 'carry on',
      })
      // ⚑ **Held, not refused** — an agent's words: this app reopens the idle child on the current
      // sign-in, and they go in as it starts.
      expect(held).toMatchObject({
        outcome: 'ok',
        delivery: 'queued',
        agent: worker,
        kind: 'follow-up',
      })
      // ⚑ **Held with the give's brief**, so the two go in together, as one turn, oldest first.
      await waitFor(
        () =>
          ledger(worker).some(
            (event) => event.type === 'user_turn' && event.text.includes('carry on'),
          ),
        'the follow-up to reach the reopened child',
      )
      expect(ledger(worker)).toContainEqual({ type: 'reopened', because: 'the-sign-in-moved-on' })
    })

    /**
     * 🔴 **675 · the per-caller sentence asks what `resume_agent` would ask, and a RUNNING child is
     * the arm that proves it** (`663` F3). ⚑ This parent started the worker and holds work in it, and
     * the conversation is running, reopened and idle. ⛔ Telling this caller *resume_agent can wake
     * it* would name a door that refuses it (`402`), so it is told the table's sentence.
     *
     * ⚑ **D-017 — `resume_agent` is gone** (a message starts a stopped conversation), so the second
     * half — the wake refusing it with the message door's own answer (`690`) — went with it; the
     * sentence naming no wake is what is left.
     */
    it('🔴 675 · a parent holding work in its own RUNNING child is not told to wake it', async () => {
      // ⚑ **D-016** — the work it holds is the piece the give that started it handed over.
      const { pm, worker, piece } = await aPmAndItsWorker()
      await restart()
      await reopen(worker, secondWindow)
      const { toolset } = await reopen(pm, window)
      credentialGeneration++
      // ⚑ **The premise, both halves**: the fold would admit this caller…
      expect(
        store
          .piecesGivenBy(pm)
          .some((given) => given.owner === worker && TASK_IS_OPEN[given.state]),
      ).toBe(true)

      // ⚑ An agent's words to a child whose sign-in moved on are held for its reopen, and the
      // answer this caller reads says so — and names no wake.
      const tool = toolset.tools.find((one) => one.name === 'message_agent')
      if (tool === undefined) throw new Error('no message_agent')
      const held = await tool.call({
        kind: 'follow-up',
        piece,
        agent: worker,
        text: 'how far along are you?',
      })
      expect(held.structured).toMatchObject({ outcome: 'ok', delivery: 'queued' })
      expect(held.text).toContain('Its Claude sign-in changed after it started.')
      expect(held.text).not.toContain('resume_agent')
      await waitFor(
        () =>
          ledger(worker).some(
            (event) => event.type === 'user_turn' && event.text === 'how far along are you?',
          ),
        'the follow-up to reach the reopened child',
      )
    })

    it('⚑ …and the paired negative, in the same breath: a conversation it did not spawn is refused', async () => {
      const first = await aPmAndItsWorker('pm', 'worker')
      // A second PM with a child of its own — the sharpest negative available, because it is the
      // same shape reached the same way, and the only thing that differs is which conversation
      // asked for it.
      const second = await aPmAndItsWorker('pm2', 'worker2')
      await restart()

      await reopen(first.worker, secondWindow)
      await reopen(second.worker, secondWindow)
      const { toolset } = await reopen(first.pm, window)

      expect(
        (
          await callOn(toolset, 'message_agent', {
            kind: 'follow-up',
            piece: first.piece,
            agent: first.worker,
            text: 'mine',
          })
        ).outcome,
      ).toBe('ok')
      // ⛔ **Its own child, yes. The other PM's child, no.** ⚑ **D-016** — work is followed up only
      // by its giver: the piece the other child holds is not one this caller gave, so the same
      // call, aimed one conversation over, is refused by that relationship.
      const refused = await callOn(toolset, 'message_agent', {
        kind: 'follow-up',
        piece: second.piece,
        agent: second.worker,
        text: 'not mine',
      })
      expect(refused.outcome).toBe('refused')
      expect(refused.rail).toBe('not-a-piece-you-gave')
    })

    it('⚠️ the same pair BEFORE the restart gives the same two answers — so the restart is the only variable', async () => {
      // ⛔ **The control this dispatch exists because of.** Both readings agree here: nothing has
      // been reopened, so `commandedBy` is the value the spawn wrote either way. If this pair were
      // the whole test, a derivation that never ran would still pass it.
      const first = await aPmAndItsWorker('pm', 'worker')
      const second = await aPmAndItsWorker('pm2', 'worker2')
      expect(
        (
          await callOn(first.pmTools, 'message_agent', {
            kind: 'follow-up',
            piece: first.piece,
            agent: first.worker,
            text: 'mine',
          })
        ).outcome,
      ).toBe('ok')
      expect(
        (
          await callOn(first.pmTools, 'message_agent', {
            kind: 'follow-up',
            piece: second.piece,
            agent: second.worker,
            text: 'not mine',
          })
        ).rail,
      ).toBe('not-a-piece-you-gave')
    })

    /**
     * 🔴 **692 · this bound held only after a CRASH** (PM ruling R34), and ⚑ **D-017 · R1/R2 lifted
     * it there too**: a message starts a stopped conversation however it stopped, so a parent's
     * message to the child a crash closed STARTS it — with the commander the start re-derives from
     * the provenance row, which is the derivation this file is about. ⛔ It was *"a command needs a
     * slot, and only a person can make one"*; now the message makes it.
     */
    it('⛔ a child NOBODY reopened is started by its parent’s message AFTER A CRASH — the bound R34c kept is gone', async () => {
      const { pm, worker, piece } = await aPmAndItsWorker()
      // ⛔ **A crash: the next launch happens and the quit never ran**, so nothing was recorded.
      // ⚠️ Its own store object — `a-next-launch-test-needs-its-own-store-object`: one shared with a
      // host this process still holds would be refused as *run by another host*, which a crash
      // never leaves behind.
      store = createSessionStore(db, tick)
      host = buildHost()
      const { toolset } = await reopen(pm, window)
      expect(host.sessionIds).not.toContain(worker)

      const started = await callOn(toolset, 'message_agent', {
        kind: 'follow-up',
        piece,
        agent: worker,
        text: 'are you there',
      })
      expect(started.outcome, JSON.stringify(started)).toBe('ok')
      // ⚑ **Started by that message** — running now, and its card answers the parent that sent it.
      expect(host.sessionIds).toContain(worker)
      const card = await callOn(toolset, 'get_agent_status', { agent: worker })
      expect(card.outcome, JSON.stringify(card)).toBe('ok')
      // ⚑ **D-017 · R11 — one state**: `open-nothing-running` is gone, and the turn the message
      // started is what the card reads, not `idle`.
      expect((card.agent as { state: string }).state).not.toBe('idle')
    })

    it('⚑ every verb `commandedBy` gates comes back together — it is one entitlement, not five', async () => {
      const { pm, worker, piece } = await aPmAndItsWorker()
      await restart()
      await reopen(worker, secondWindow)
      const { toolset } = await reopen(pm, window)

      // The listing, the card, the message and the interrupt — the four the tools reach.
      // ⚑ **D-017 — the fourth was the ending**, and `end_agent` is gone: `interrupt_agent` asks the
      // same `mayCommand` first.
      const listed = await callOn(toolset, 'list_agents', {})
      expect((listed.agents as { agent: string }[]).map((one) => one.agent)).toContain(worker)
      expect((await callOn(toolset, 'get_agent_status', { agent: worker })).outcome).toBe('ok')
      // ⛔ **496 · the card that message raises is answered before the fourth verb** (HO-034 §1).
      // ⚠️ The words below hand the child a turn and every turn the Fake drives parks on a person's
      // permission card — the one state an interrupt is refused for (`a-person-is-being-asked`).
      // ⚑ **The claim is unchanged and still about the fourth verb**: what is asserted is that
      // `commandedBy` came back for it too, and a rail about the child's state is not `commandedBy`.
      // ⚠️ **Counted BEFORE the send**, or the wait races the card it is waiting for.
      const before = ledger(worker).filter((event) => event.type === 'permission_request').length
      expect(
        (
          await callOn(toolset, 'message_agent', {
            kind: 'follow-up',
            piece,
            agent: worker,
            text: 'go on',
          })
        ).outcome,
      ).toBe('ok')
      await waitFor(
        () => ledger(worker).filter((event) => event.type === 'permission_request').length > before,
        'the card the turn parks on',
      )
      const card = [...ledger(worker)]
        .reverse()
        .find((event) => event.type === 'permission_request')
      if (card === undefined || card.type !== 'permission_request') throw new Error('no card')
      await host.respondPermission(worker, card.id, { outcome: 'allow' }, secondWindow)
      expect(
        (await callOn(toolset, 'interrupt_agent', { agent: worker, reason: 'the work is done' }))
          .outcome,
      ).toBe('ok')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · what is persisted about a spawn, and what a row can name
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · three fields, and only one kind of commander a row can name', () => {
    it('⛔ no owner of any kind is in a migration — the search shape, with a control that fires', () => {
      // ⚠️ **What this search could have found**: a column. So it reads every migration this app
      // ships and looks for the three words a column carrying an owner would have to contain.
      // ⚑ **D-016 · one migration now** (`0000_the_tree.sql`): the schema as it is, whole.
      // ⚑ **D-042 · two**: `0001_the_model_list.sql` adds the provider's model settings and a
      // conversation's reported pair — no owner word among them, so the search below still reads
      // every migration and finds none.
      // ⚑ **D-050 · three**: `0002_no_agent_limit.sql` drops two of the provider's model settings'
      // columns, creates nothing and carries no owner word.
      // ⚑ **Four**: `0003_the_api_keys.sql` creates the table of a person's sealed API keys and
      // carries no owner word.
      // ⚑ **Five**: `0004_no_stream_fragments.sql` removes rows and creates no column.
      // ⚑ **Six**: `0005_the_fold_index.sql` creates an index and no column.
      // ⚑ **Seven**: `0006_the_inventory_index.sql` creates an index and no column.
      // ⚑ **Eight**: `0007_the_mcp_request_index.sql` creates an index and no column.
      // The ninth migration adds only event indexes for work reconciliation.
      // ⚑ **Ten**: `0009_the_fold_index_ends_passed_up_questions.sql` recreates an index and adds
      // no column.
      // The next migration captures ledger ordinals, not conversation commanders.
      const migrations = readdirSync(migrationsFolder)
        .filter((name) => name.endsWith('.sql'))
        .map((name) => readFileSync(join(migrationsFolder, name), 'utf8'))
      expect(migrations).toHaveLength(12)
      const everything = migrations.join('\n')
      // ⚠️ **Not flanked by a letter or a digit**: D-016's `work` table has an index named
      // `work_owner_idx` — the owner of a PIECE, not a commander of a conversation — and a bare
      // substring search reads `owner_id` in it. ⛔ Not `\b` either: `_` is a word character, so
      // `\bowner_id\b` would let `piece_owner_id` through.
      const aColumnSpelled = (word: string): RegExp =>
        new RegExp(`(?<![A-Za-z0-9])${word}(?![A-Za-z0-9])`)
      for (const word of ['owner_id', 'commanded_by', 'commander']) {
        expect(everything).not.toMatch(aColumnSpelled(word))
      }
      // ⚑ …and that search finds an owner column inside a longer snake_case name, and passes over
      // exactly the index name.
      expect('`piece_owner_id` text').toMatch(aColumnSpelled('owner_id'))
      expect('`work_owner_idx`').not.toMatch(aColumnSpelled('owner_id'))
      // ⚑ **The control.** The same reader, on the same text, finds the column the derivation
      // actually reads — so "not there" above is a fact about the schema and not about the search.
      expect(everything).toContain('parent_session_id')
    })

    it('⚑ the derived commander is `agent:<parent>` exactly — one caller admitted, two refused', async () => {
      const { pm, worker } = await aPmAndItsWorker()
      await restart()
      await reopen(worker, secondWindow)

      const admitted: CallerIdentity = { ownerId: agentCallerId(pm) }
      expect(host.agentCard(worker, admitted, null)).not.toBeNull()
      // ⛔ The child speaking as itself is not its own commander…
      expect(host.agentCard(worker, { ownerId: agentCallerId(worker) }, null)).toBeNull()
      // …and the bare session id is not an identity at all: the namespace is load-bearing (347).
      expect(host.agentCard(worker, { ownerId: pm }, null)).toBeNull()
    })

    it('⚠️ a commander that was NOT the parent cannot be stood up — only a conversation gives', async () => {
      // ⛔ **The case where live and derived DIFFERED, and D-016 closed it at the door.** A caller
      // with no window could hold a conversation and spawn from it, and the child was then
      // commanded by that caller while it ran — `mcp:planner`, written down nowhere, so a resume
      // could not name it. ⚑ **A child is started only by a GIVE, and a give is answered only for a
      // conversation this host holds, speaking as itself** — so the commander a start writes is
      // always the giver's own identity, which is the parent the row names: live and derived agree.
      // ⚑ The same holds for THE APP ITSELF (the case that stood beside this one, *what the app
      // opened on a parent's behalf*, went with it). ⚑ **D-016c · ruling (b)** — each is told it
      // holds no piece to give from, which is true of a caller that speaks as no conversation.
      const planner: CallerIdentity = { ownerId: 'mcp:planner' }
      await bringIdentityIntoBeing('worker')
      await host.createSession(
        { provider: 'claude', profileId: 'pm', approvalMode: 'ask', cwd: root },
        null,
        planner,
      )
      const request = {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'while the app is up',
        brief: 'go',
      }
      const noConversations: readonly Caller[] = [planner, THE_APP_ITSELF]
      for (const by of noConversations) {
        const refused = await host.giveWork(request, by)
        if (refused.ok) throw new Error(`a give was admitted for a caller that is no conversation`)
        expect(refused.refusal.rail).toBe('no-piece-to-give-from')
      }
      // ⚑ **The paired positive**: the parent speaking as itself starts the child, and commands it.
      const parent = host.sessionIds.find((id) => store.identityOf(id)?.profileSlug === 'pm')
      if (parent === undefined) throw new Error('the parent is not running')
      const given = await host.giveWork(request, { ownerId: agentCallerId(parent) })
      if (!given.ok) throw new Error(`the give was refused: ${given.refusal.rail}`)
      expect(host.agentCard(given.owner, { ownerId: agentCallerId(parent) }, null)).not.toBeNull()
      expect(host.agentCard(given.owner, planner, null)).toBeNull()
    })

    it('⛔ a conversation nobody spawned comes back commanded by nobody, and discloses it', async () => {
      const pm = await personOpens('pm')
      await restart()
      const reopened = await reopen(pm, window)
      expect(reopened.hasACommander).toBe(false)
      // ⚠️ **A row with no parent is not a spawn** (341), so there is nothing to derive and the
      // derivation must not invent a parent for a person's own work. ⚑ D-016: the parent is the one
      // provenance fact left (`parentOf`).
      expect(store.parentOf(pm)).toBeNull()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · what the derivation does NOT re-open
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · knowledge escalates, authority does not — 340 §2 across a restart', () => {
    it('🔴 the reopened parent may NOT answer its child`s permission card; the window may', async () => {
      const { pm, worker } = await aPmAndItsWorker()
      await restart()
      await reopen(worker, secondWindow)
      await reopen(pm, window)

      const parent: CallerIdentity = { ownerId: agentCallerId(pm) }
      const before = ledger(worker).filter((event) => event.type === 'permission_request').length
      await host.send(worker, 'touch a file', parent)
      await waitFor(
        () => ledger(worker).filter((event) => event.type === 'permission_request').length > before,
        'the card the child stopped to ask for',
      )
      const asked = ledger(worker)
        .filter((event) => event.type === 'permission_request')
        .at(-1)
      if (asked === undefined || asked.type !== 'permission_request') {
        throw new Error('no permission request on the ledger')
      }

      // ⛔ **HO-005 Q2, and it is the whole reason this file had to check.** The parent may give the
      // conversation work — it just did — and may not decide what that work is allowed to do.
      await expect(
        host.respondPermission(worker, asked.id, { outcome: 'allow' }, parent),
      ).rejects.toThrow(/person/i)
      // ⚑ **The paired positive**: the window that reopened it can, so the refusal above is about
      // WHO asked rather than about the card being unanswerable.
      await host.respondPermission(worker, asked.id, { outcome: 'allow' }, secondWindow)
    })

    it('⛔ …and may not close it, nor change what it is allowed to do', async () => {
      const { pm, worker } = await aPmAndItsWorker()
      await restart()
      await reopen(worker, secondWindow)
      await reopen(pm, window)
      const parent: CallerIdentity = { ownerId: agentCallerId(pm) }

      // ⚠️ `setApprovalMode` is the one worth naming: a commander that could set a session to
      // `auto` would have answered every card it will ever raise, in advance.
      await expect(host.setApprovalMode(worker, 'auto', parent)).rejects.toThrow(/another window/i)
      // ⚠️ **Refused in a different SHAPE, and asserted in that shape.** `close` is not `async` —
      // it looks the slot up and asks {@link mayControl} synchronously, so its refusal THROWS where
      // `setApprovalMode`'s rejects. One entitlement, two failure shapes; a `.rejects` here would
      // fail with the very error it was written to expect.
      expect(() => host.close(worker, parent)).toThrow(/another window/i)
      expect(host.sessionIds).toContain(worker)
      // ⚑ …and the window that owns it may do both, which is what makes the two lines above about
      // the caller rather than about the session.
      await host.setApprovalMode(worker, 'auto', secondWindow)
      await host.close(worker, secondWindow)
    })

    it('⛔ `readonly` still means what 340 §3 said it means — nothing writes the field twice', () => {
      // 🔴 **The clause this dispatch's whole argument rests on, asserted rather than asserted-in-a
      // -comment** (HO-013 §5). 340 §3's property is *fixed at reservation and never written
      // again*, which is what makes *"a window claiming a session must not take away the spawner's
      // ability to command it"* true because no line exists that could make it false. ⚠️ A resume
      // that DERIVES the field writes it at a reservation, so the property is untouched — and this
      // is what would go red if a later dispatch reached for an assignment instead.
      const strip = (text: string): string =>
        text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
      const everything = readdirSync(mainRoot, { recursive: true, encoding: 'utf8' })
        .filter((entry) => entry.endsWith('.ts'))
        .map((entry) => strip(readFileSync(join(mainRoot, entry), 'utf8')))
        .join('\n')
      expect(everything).not.toMatch(/commandedBy\s*=[^=]/)
      expect(everything).not.toMatch(/spawnedBy\s*=[^=]/)
      // ⚑ **The control that makes those two lines a fact about these fields.** The same reader over
      // the same text finds the assignment to the field that DOES move — `ownerId`, `null → id →
      // null`, on a claim and on a release — so "nothing assigns it" is not "nothing was read".
      expect(everything).toMatch(/slot\.ownerId = /)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · a commander whose parent may never come back
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · what clears a derived commander', () => {
    it('⛔ nothing clears it, and the bound is who can SPELL it — the call sites, enumerated', () => {
      // ⚠️ **`mayCommand` compares strings and asks nothing about liveness**, so the honest answer
      // to *"what clears a commander whose parent is gone"* is: nothing, and nothing needs to,
      // because the identity can be minted in exactly two places — the toolset builder, from the
      // session a toolset was built FOR, and the resume, from the parent a row NAMES. ⛔ This is
      // that enumeration, derived from the directory rather than typed out, so a third file that
      // learns to spell one turns it red.
      const sources = readdirSync(mainRoot, { recursive: true, encoding: 'utf8' })
        .filter((entry) => entry.endsWith('.ts'))
        .map((entry) => ({
          path: entry.replaceAll('\\', '/'),
          text: readFileSync(join(mainRoot, entry), 'utf8'),
        }))
      const strip = (text: string): string =>
        text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
      // ⚠️ **The FILES, not the lines.** What this asks is *where can this identity be minted*, and
      // pinning each call's argument here would make every row of `373`'s mutation table red through
      // this test rather than through the behaviour it claims to protect. What the argument IS is
      // §2's question, asked of three callers at the door instead of of the source.
      const callers = sources.flatMap(({ path, text }) =>
        strip(text)
          .split('\n')
          .some(
            (line) =>
              line.includes('agentCallerId(') && !line.includes('export const agentCallerId'),
          )
          ? [path]
          : [],
      )
      expect(callers.sort()).toEqual(['runtime/agent-tools.ts', 'runtime/runtime-host.ts'])
      // ⚑ **And the toolset builder is only ever handed a session`s OWN id**, which is what makes
      // the first line above a mint rather than a forge.
      const host = sources.find((one) => one.path.endsWith('runtime/runtime-host.ts'))
      if (host === undefined) throw new Error('runtime-host.ts is not where this test looked')
      const built = strip(host.text)
        .split('\n')
        .filter((line) => line.includes('agentToolsFor('))
        .map((line) => line.trim())
      // ⚑ **F093 · two more, each handed the conversation's own id too**: the record composed for a
      // read of a launch that kept none (`whatALaunchGave`) and the agent-input popup's read
      // (`whatThisAgentWasGiven`). A launch's own record is handed the toolset its launch built.
      expect(built).toEqual([
        'const agentTools = agentToolsFor(this, id, this.theListsAsLastRead())',
        'agentToolsFor(this, sessionId, this.theListsAsLastRead()),',
        'toolset: agentToolsFor(this, sessionId, this.theListsAsLastRead()),',
        'const agentTools = agentToolsFor(this, sessionId, this.theListsAsLastRead())',
      ])
    })

    it('⚠️ the entitlement names an identity, not a live session — and that is the honest reading', async () => {
      const { pm, worker } = await aPmAndItsWorker()
      await restart()
      // ⛔ **Only the CHILD is reopened.** The parent is a recording nobody has touched.
      await reopen(worker, secondWindow)
      expect(host.sessionIds).not.toContain(pm)
      // ⚑ The predicate still admits `agent:<pm>`, because it is a comparison of identities and
      // asks nothing about who is running. What stops anything from using it is the enumeration
      // above — not a liveness check that does not exist and would be a second answer if it did.
      expect(host.agentCard(worker, { ownerId: agentCallerId(pm) }, null)).not.toBeNull()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · the folder comes back with the conversation — and, since `726` · R92, bounds nothing
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · a reopened conversation keeps the folder it ran in, and no folder bound', () => {
    it('🔴 726 · R92 — the reopened child at `<root>/pkg` may start a child back at `<root>`', async () => {
      await bringIdentityIntoBeing('mid')
      await bringIdentityIntoBeing('deep')
      const pm = await personOpens('pm', root)
      // ⚑ **D-016** — a child is started by a give, and `folder` is where it starts.
      const spawned = await callOn(theToolsetJustHandedOut(), 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'mid',
        title: 'work in one package',
        brief: 'work in one package',
        folder: join(root, 'pkg'),
      })
      expect(spawned.outcome, JSON.stringify(spawned)).toBe('ok')
      const mid = spawned.agent as string
      expect(store.find(mid)?.cwd).toBe(join(root, 'pkg'))
      void pm

      await restart()
      const { toolset } = await reopen(mid, window)

      // ⚑ **The CONTROL first, while `deep` is not yet live:** a folder that is not there is still
      // refused, in `checkSessionCwd`'s own words — the one question a folder is asked. ⚠️ Named
      // INSIDE `<root>/pkg` so it answers the same on `main`, and the call below is the only variable.
      const missing = join(root, 'pkg', 'not-there')
      const unusable = await callOn(toolset, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'deep',
        title: 'work in a folder that does not exist',
        brief: 'work in a folder that does not exist',
        folder: missing,
      })
      expect(unusable.outcome, JSON.stringify(unusable)).toBe('refused')
      expect(unusable.rail).toBe('folder-unusable')
      expect((unusable.detail as { folderReason?: string }).folderReason).toBe(
        `cwd does not exist: ${missing}`,
      )

      // ⛔ On `main` this was refused (`cwd-outside-parent`, `permanent` — 371's twelfth rail: the
      // recorded folder was a bound no reopened conversation could stand wider than). R92: no folder
      // bound on where an agent may start a child.
      const allowed = await callOn(toolset, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'deep',
        title: 'work at the root',
        brief: 'work at the root',
        folder: root,
      })
      expect(allowed.outcome, JSON.stringify(allowed)).toBe('ok')
      expect(store.find(allowed.agent as string)?.cwd).toBe(root)
    })

    it('⚑ …and a folder inside its own is admitted too — the other direction, after the same restart', async () => {
      await bringIdentityIntoBeing('mid')
      await bringIdentityIntoBeing('deep')
      await personOpens('pm', root)
      const spawned = await callOn(theToolsetJustHandedOut(), 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'mid',
        title: 'work in one package',
        brief: 'work in one package',
        folder: join(root, 'pkg'),
      })
      const mid = (spawned as { agent: string }).agent
      await restart()
      const { toolset } = await reopen(mid, window)
      const allowed = await callOn(toolset, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'deep',
        title: 'work in a subfolder',
        brief: 'work in a subfolder',
        folder: join(root, 'pkg', 'sub'),
      })
      expect(allowed.outcome, JSON.stringify(allowed)).toBe('ok')
      expect(store.find(allowed.agent as string)?.cwd).toBe(join(root, 'pkg', 'sub'))
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §6 · 077 is untouched, and the rule that keeps it that way
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§6 · a resume restores who MAY act; it never re-performs an act', () => {
    it('⛔ the held message is still not re-armed, while the commander is back', async () => {
      const { pm, worker } = await aPmAndItsWorker()
      // Park the child on a question so it is not idle, then hand it something to do next.
      // ⚑ **D-016** — the give's brief is the child's first turn, and in `ask` mode it parks on the
      // card it raises: that card is the question.
      const parent: CallerIdentity = { ownerId: agentCallerId(pm) }
      await waitFor(
        () => ledger(worker).some((event) => event.type === 'permission_request'),
        'the card that makes it busy',
      )
      // ⚑ **Queued BY THE PARENT**, which is the only caller whose entitlement this dispatch
      // touches — so the message being dropped and the entitlement coming back are two facts about
      // the same relationship rather than two unrelated ones.
      const queued = await host.queueMessage(worker, 'and then tidy up', parent)
      expect(queued.outcome).toBe('queued')

      await restart()
      const reopened = await host.resumeSession(worker, secondWindow)
      // ⛔ **077's ruling, unchanged**: a resume must not send what a person wrote days ago.
      // ⚑ **`[]` since `394` made the disclosure a mailbox** — the same ruling, in the shape a list
      // says it in, and `toEqual` rather than a length check so `undefined` cannot satisfy it.
      expect(reopened.queued).toEqual([])
      // ⚑ **…and the entitlement is back in the same breath.** The two are different questions —
      // one is an ACT nobody asked for again, the other is who MAY act — and this is the one line
      // where both answers are visible at once.
      expect(reopened.hasACommander).toBe(true)
      expect(JSON.stringify(ledger(worker))).toContain('and then tidy up')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §7 · what a person is told when they reopen a spawned conversation
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§7 · the disclosure a person reads', () => {
    it('⚑ `hasACommander` is true again for a reopened child, and false for a person`s own work', async () => {
      const { pm, worker } = await aPmAndItsWorker()
      await restart()
      // ⛔ **The one screen-facing consequence of this dispatch.** A person taking over a spawned
      // conversation is told somebody else can send here — which is true of it again.
      expect((await reopen(worker, secondWindow)).hasACommander).toBe(true)
      expect((await reopen(pm, window)).hasACommander).toBe(false)
    })

    it('⚠️ the card still answers "who created this, and why" from the ledger', async () => {
      const { pm, worker, piece } = await aPmAndItsWorker()
      await restart()
      await reopen(worker, secondWindow)
      const card = host.agentCard(worker, { ownerId: agentCallerId(pm) }, null)
      // ⚑ **D-016 · the "why" is the piece it holds** — the spawn reason went with `spawn_agent`,
      // and the card names the work by its label, read off the ledger.
      expect(card).toMatchObject({
        agent: worker,
        parent: pm,
        // ⚑ The LIVE half agrees with the durable one after a reopen, which is what 373 changed.
        spawnedBy: pm,
      })
      expect(card?.pieces.map((one) => one.label)).toContain(piece)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §8 · every launch keeps the provider's own sub-agents (D-014)
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§8 · no launch and no reopen switches off the provider`s own sub-agents', () => {
    /**
     * 🔴 **D-014 · the CLIs' own sub-agents stay on for every agent** (plan §4.2, R93, R99). Until
     * D-014 a start grant, or a row not yet written, sent the provider a switch that withheld them.
     * ⚑ The same five launches `408` measured — a person's first two, the spawned worker's, and a
     * reopen of each after a restart — and none of them carries it now.
     */
    const DELEGATION_SWITCH = /delegation/i

    it('🔴 a first launch, a spawned child and both reopens carry no delegation switch', async () => {
      // ⛔ **The pattern really names the switch that was removed**, so the absences below are
      // about that key and not about a pattern that could match nothing.
      expect('disableNativeMultiAgentDelegation').toMatch(DELEGATION_SWITCH)
      // ⚠️ **The first two starts are the FIRST launch of their identities**: `ensureIdentityRow`
      // runs after the provider has started, so these are the launches with no row behind them.
      const { pm, worker } = await aPmAndItsWorker()
      await restart()
      await reopen(worker, secondWindow)
      await reopen(pm, window)
      expect(launches.map((launch) => launch.kind)).toEqual([
        'start',
        'start',
        'start',
        'resume',
        'resume',
      ])
      for (const launch of launches) {
        // ⚑ **The control**: the recorder read the options this host built, which always hand
        // the conversation this app's own tools.
        expect(launch.keys).toContain('agentTools')
        expect(launch.keys.filter((key) => DELEGATION_SWITCH.test(key))).toEqual([])
      }
    })

    it('⚑ …and a row a person narrowed to its narrowest reaches no launch either', async () => {
      // ⛔ **One fact over, on one identity**: every grant this row holds is the narrowest a
      // person can set, and nothing about the launch changes.
      const { pm } = await aPmAndItsWorker()
      // ⚑ **D-016** — each field's own `narrowest`, read off the schema now that the set it made
      // is no longer exported.
      const narrowest = Object.fromEntries(
        CAPABILITY_FIELDS.map((field) => [field.key, field.narrowest]),
      ) as unknown as ProfileCapabilities
      expect(store.setCapabilities('pm', { ...narrowest })).toBe(true)
      expect(store.capabilitiesOf('pm')).toEqual(narrowest)
      await restart()
      await reopen(pm, window)
      const last = launches.at(-1)
      expect(last?.kind).toBe('resume')
      expect(last?.keys).toContain('agentTools')
      expect(last?.keys.filter((key) => DELEGATION_SWITCH.test(key))).toEqual([])
    })
  })
})
