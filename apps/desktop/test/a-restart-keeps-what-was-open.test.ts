import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ClaudeRuntime,
  CODEX_PROTOCOL_VERSION,
  CodexRuntime,
  FakeLaunchGate,
  FakeProviderSessions,
  FakeRuntime,
  ResumeError,
  claudeProjectDirName,
  createSpawnTransportFactory,
} from '@brobot2/runtime'
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
import { RuntimeHost, THE_APP_ITSELF } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentCallerId, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type {
  RuntimeChangeMessage,
  RuntimeEventMessage,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'
import { stalledWorkSaid } from '../src/shared/stalled-work'
import { undrivenSentence } from '../src/shared/tasks'
import {
  A_CODEX_THREAD,
  aCodexThatRefuses,
} from '../../../packages/runtime/test/fixtures/a-codex-that-refuses'

/**
 * ⚑ **What a giver is told about work a quit caught MID-TURN** (D-016c) — the turn the quit
 * interrupted, rendered, so a sentence that moves moves here with it. ⛔ Never a stop's own words:
 * a stop is no cause, and nothing says a conversation is open or has ended.
 */
const ITS_TURN_WAS_STOPPED = undrivenSentence('turn_interrupted')

/**
 * 🔴 **692 · a restart keeps what was open** (PM ruling R34).
 *
 * A graceful quit can stop idle conversations without erasing them from the next launch.
 * Relaunch must retain the root conversation and its helpers in the conversation list.
 *
 * ⛔ **R34a** — only what the QUIT closed comes back: a conversation a person closed, one that ended
 * on its own, one whose provider failed and one an agent ended stay closed. **R34b** — it comes back
 * OPEN and nothing runs that nobody asked for: its provider starts when something is sent to it,
 * never at the launch. **R34c** — a quit that could not record (a crash, a kill) falls back to
 * closed.
 *
 * ⚑ **Real host, real SQLite ledger, real migrations, real rails.** The only double is the provider,
 * subclassed to count every launch and keep the toolsets the host handed out — so "no provider
 * started" is a count of `start`/`resume` calls the HOST made, not an absence of events.
 *
 * ⚠️ **Each relaunch builds its own `SessionStore` over the same database** — the next launch's
 * repairs exclude what another live host in this process holds, and a restart that shared the
 * store would measure that exclusion instead (`a-next-launch-test-needs-its-own-store-object`).
 *
 * ⚑ **D-017 — what moved under this file.** R1: every delivery starts its recipient, asking every
 * rail a MESSAGE meets first and no launch rail. R2: a conversation is reachable and listed within
 * the caller's grant however it stopped (`startable`), so the parent-only clause is gone. R3: a
 * stop ends nothing, and a message held at a quit waits for the next start. ⚠️ `keptOpenAcrossAQuit`
 * — the window's fact — stays on the quit's own stamp, so the rail rows below are unchanged.
 *
 * The rail lists conversations uniformly, showing `running` beside their state rather than an
 * open/closed distinction. Relaunch lists stopped conversations and starts none. A stop moves
 * no piece: only the interrupted turn determines what the giver is told and the person’s band
 * says. §2 and §6–§8 cover messages held at quit.
 */

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

/** ⛔ Every provider launch the host asks for, in order — `start` or `resume`, and for which ref. */
interface Launched {
  readonly kind: 'start' | 'resume'
  readonly handle: FakeSessionHandle
}

class CountingRuntime extends FakeRuntime {
  /** ⚑ See {@link CountingRuntime.resume} — `null` except inside the one test that sets it. */
  static failTheNextResume: Error | null = null
  /**
   * ⚑ **706 · an error a REAL adapter made, thrown as it is** — see {@link CountingRuntime.resume}.
   * `null` except inside the test that sets it.
   */
  static theNextResumeThrows: unknown = null

  constructor(
    provider: Provider,
    private readonly launched: Launched[],
    private readonly handed: AgentToolset[],
    sessions: FakeProviderSessions,
    gate: FakeLaunchGate | undefined,
  ) {
    super(provider, { sessions, ...(gate === undefined ? {} : { gate }) })
  }
  override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
    const handle = await super.start(options)
    this.launched.push({ kind: 'start', handle })
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
  override async resume(
    ref: SessionRef,
    options: ResumeOptions,
  ): ReturnType<FakeRuntime['resume']> {
    // ⚑ **A setup failure, as a real adapter reports one** — a `ResumeError` WITH its cause (an
    // app-server that died in the handshake). One shot, set by the test that needs it.
    const failure = CountingRuntime.failTheNextResume
    if (failure !== null) {
      CountingRuntime.failTheNextResume = null
      throw new ResumeError(ref, `resume failed: ${failure.message}`, { cause: failure })
    }
    // ⚑ **706 · …or the error a real adapter raised, verbatim** — so what the host reads is the
    // adapter's own object, not a stand-in shaped like it. One shot.
    const thrown = CountingRuntime.theNextResumeThrows
    if (thrown !== null) {
      CountingRuntime.theNextResumeThrows = null
      throw thrown
    }
    const handle = await super.resume(ref, options)
    this.launched.push({ kind: 'resume', handle })
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

describe('692 · a restart keeps what was open', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let launched: Launched[]
  let handed: AgentToolset[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  /** ⚑ Set by a test that needs to be INSIDE a launch when the quit lands; unset otherwise. */
  let gate: FakeLaunchGate | undefined
  /** ⚑ **699** · every change the host announced to the windows — what makes a Work tab re-read. */
  let announced: RuntimeChangeMessage[]
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) =>
        new CountingRuntime(provider, launched, handed, issued, gate),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      announce: (change) => {
        announced.push(change)
      },
      readProviderConfig: (_provider, home) => ({
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-692-'))
    // ⚑ Real path: macOS hands out `/var/…`, which is `/private/var/…`, and a handed attachment is
    // refused when the path it names and the path it resolves to differ.
    root = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-692-root-')))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    launched = []
    handed = []
    issued = new FakeProviderSessions()
    gate = undefined
    announced = []
    CountingRuntime.failTheNextResume = null
    CountingRuntime.theNextResumeThrows = null
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  /**
   * ⚑ **Let every timer the launch armed fire** before counting what it started — a start deferred
   * one tick would otherwise pass a count taken in the same synchronous run (found by review).
   */
  const letItSettle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 60))

  /** ⚑ The graceful quit a person's ⌘Q is, then the next launch — its own store object. */
  const quitAndRelaunch = async (): Promise<void> => {
    await host.closeAll()
    store = createSessionStore(db, tick)
    host = buildHost()
  }

  /** ⛔ A crash or a kill: the next launch happens and the quit never ran. */
  const crashAndRelaunch = (): void => {
    store = createSessionStore(db, tick)
    host = buildHost()
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

  /** ⚑ The TEXT a model reads, beside the payload `callOn` returns. */
  const textOf = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<{ structured: Record<string, unknown>; text: string }> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    const said = await tool.call(args)
    return { structured: said.structured as Record<string, unknown>, text: said.text }
  }

  const lastToolset = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed out')
    return last
  }

  /**
   * What the rail says about one conversation — the row the renderer folds. ⚑ **D-017b** — its
   * `running`, and no word for how it stopped: the row carries no kept-open fact and no crash reason
   * (asserted on every read, so a split that came back would redden every arm here).
   */
  const listed = (sessionId: string): { running: string } | undefined => {
    const row = host.resumableSessions().find((one) => one.sessionId === sessionId)
    if (row === undefined) return undefined
    expect(row, sessionId).not.toHaveProperty('keptOpenAcrossAQuit')
    expect(row, sessionId).not.toHaveProperty('closedBecauseTheAppDidNotFinishQuitting')
    return { running: row.running }
  }

  /** An identity exists only once a person has run a conversation as it (341 criterion 12). */
  const bringIntoBeing = async (profileId: string): Promise<void> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    await host.close(sessionId, window)
  }

  /** ⚑ **D-016 · the agent each of the lead's children is** — a give names a profile, not an id. */
  const profileOfChild = new Map<string, string>()
  const profileOf = (child: string): string => {
    const profile = profileOfChild.get(child)
    if (profile === undefined) throw new Error(`${child} is none of the lead's children`)
    return profile
  }

  /** ⚑ **One conversation in the one state** — the rail row's own `state`. */
  const isIdle = (sessionId: string): boolean =>
    host.resumableSessions().find((one) => one.sessionId === sessionId)?.state.is === 'idle'

  /**
   * ⚑ **The incident's shape**: a person's lead in a window, and three agents it gave work to and
   * that handed it back — four open, idle conversations at the moment of the quit.
   *
   * ⚑ **D-016 · a give starts each child, and its brief is the child's first turn**, so the three
   * are made in `auto` — each brief runs and ends — and each hands its piece back with
   * `reply_to_parent`, so none holds open work and each is idle, as a spawned child was. ⚑ **699's
   * one variation**: `approvalMode` is then the lead's and its children's, set on all four
   * (`a-mode-a-child-inherits` is why they share it). ⚠️ `auto` is how a child's turn ENDS in the
   * double — in `ask` it parks on a permission card.
   */
  const theFourOpen = async (
    approvalMode: 'ask' | 'auto' = 'ask',
  ): Promise<{
    lead: string
    children: [string, string, string]
    leadTools: AgentToolset
  }> => {
    const kids = ['mock-dev', 'mock-dev-2', 'platform-runtime-pm']
    for (const kid of kids) await bringIntoBeing(kid)
    const { sessionId: lead } = await host.createSession(
      { provider: 'claude', profileId: 'lead', approvalMode: 'auto', cwd: root },
      window,
    )
    const leadTools = lastToolset()
    // ⚑ **D-016** — the lead holds the ruled `any`: the `same-project` narrowing it took went with
    // projects, and `none` would refuse every message to its own children.
    const children: string[] = []
    for (const kid of kids) {
      const given = await callOn(leadTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: kid,
        title: `the ${kid} half of the work`,
        brief: `the ${kid} half of the work`,
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      const child = given.agent as string
      const childTools = lastToolset()
      await waitFor(
        () => ledger(child).some((event) => event.type === 'turn'),
        'the brief’s turn to end',
      )
      const replied = await callOn(childTools, 'reply_to_parent', {
        piece: given.piece,
        outcome: 'done',
        summary: 'done',
      })
      expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
      profileOfChild.set(child, kid)
      children.push(child)
    }
    const [a, b, c] = children
    if (a === undefined || b === undefined || c === undefined) throw new Error('three gives')
    await waitFor(() => [lead, ...children].every(isIdle), 'the four to be idle, every reply read')
    if (approvalMode === 'ask') {
      for (const id of [lead, ...children]) await host.setApprovalMode(id, 'ask', THE_APP_ITSELF)
    }
    return { lead, children: [a, b, c], leadTools }
  }

  /**
   * ⚑ **D-016 · work for one of the lead's children is a give to its agent**, which reaches that
   * very child — the lead's one conversation with it. ⚑ Returns the piece it opened.
   */
  const giveTo = async (tools: AgentToolset, child: string, text: string): Promise<string> => {
    const given = await callOn(tools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: profileOf(child),
      title: text,
      brief: text,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    expect(given.agent).toBe(child)
    return given.piece as string
  }

  /** A person presses a row the rail drew — the one gesture a person's row offers. */
  const personPresses = async (sessionId: string): Promise<AgentToolset> => {
    await host.resumeSession(sessionId, window)
    return lastToolset()
  }

  /**
   * ⚑ **The provider's answer to one message.** The double echoes the whole turn it was handed,
   * and the app wraps a turn — who sent it before, any handed paths after — so the words are INSIDE
   * the echo.
   */
  const answered = (sessionId: string, text: string): boolean =>
    ledger(sessionId).some(
      (event) =>
        event.type === 'assistant_message' &&
        event.text.startsWith('echo: ') &&
        event.text.includes(text),
    )

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the incident
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · four open conversations, a graceful quit, a relaunch', () => {
    it('🔴 all four come back — listed, nothing running them — and the relaunch starts no provider for any of them', async () => {
      const { lead, children } = await theFourOpen()
      // The premise: the lead is the person's, in a window; its three children are nobody's.
      expect(listed(lead)?.running).toBe('in-a-window')
      for (const id of children) expect(listed(id)?.running, id).toBe('unwatched')
      const before = launched.length
      await quitAndRelaunch()
      await letItSettle()

      for (const id of [lead, ...children]) {
        // ⛔ **Not running** — nothing was started. ⚑ **D-017b** — and no *kept open* beside it: the
        // row is a conversation like any other, and a message from its view continues it.
        expect(listed(id), id).toEqual({ running: 'not-running' })
      }
      expect(launched.length, 'a launch spent a provider on a conversation nobody spoke to').toBe(
        before,
      )
    })

    it('⚑ the person presses the lead, and its first message is answered', async () => {
      const { lead, children } = await theFourOpen()
      await quitAndRelaunch()
      const before = launched.length

      await personPresses(lead)
      expect(launched.length - before).toBe(1)
      await host.send(lead, 'where were we', window)
      await waitFor(() => answered(lead, 'where were we'), 'the lead to answer')
      // ⚑ **Open, and in a window now** — the pressed conversation is the person's again.
      expect(listed(lead)).toEqual({ running: 'in-a-window' })
      // ⛔ **…and ONLY it**: nobody spoke to its three children, so nothing started them.
      await letItSettle()
      expect(launched.length - before).toBe(1)
      for (const child of children) {
        expect(listed(child), child).toEqual({ running: 'not-running' })
      }
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · what a parent reads, and what its message does
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the parent and its children that came back open', () => {
    it('🔴 the lead’s message_agent to a child reaches it — the child is started by that send, and answers', async () => {
      const { lead, children } = await theFourOpen()
      await quitAndRelaunch()
      const leadTools = await personPresses(lead)
      const [child] = children
      const before = launched.length

      // ⚑ **D-016 · a `note`** — the lead holds no open piece of this child's to follow up.
      const { structured: said, text } = await textOf(leadTools, 'message_agent', {
        agent: child,
        kind: 'note',
        text: 'are you still there',
      })
      expect(said, JSON.stringify(said)).toMatchObject({ outcome: 'ok', agent: child })
      // ⛔ **Not *"was idle"***: nothing was running in it. ⚑ **D-017 · R1** — any stopped
      // conversation is started for a message, so the receipt says what reached it and never
      // whether it ran.
      // ⚑ **D-016 · commit 7 · R3** — the child named by the piece it owns, where it printed its id.
      // The receipt does not echo the kind the call declared.
      expect(text).toContain(`${host.nameByItsWork(child)} has been sent it straight away.`)
      expect(text).not.toContain('as note')
      expect(text).not.toContain('was idle')
      // ⛔ **Exactly one launch, and it is THAT child's** — the other two were not spoken to.
      expect(launched.length - before).toBe(1)
      expect(launched.at(-1)?.kind).toBe('resume')
      await waitFor(() => answered(child, 'are you still there'), 'the child to answer')
      expect(listed(child)).toEqual({ running: 'unwatched' })
      for (const other of children.slice(1)) {
        expect(listed(other), other).toEqual({ running: 'not-running' })
      }
    })

    it('⚑ while its start is IN FLIGHT it is one starting conversation — not also one still waiting', async () => {
      const { lead, children } = await theFourOpen()
      await quitAndRelaunch()
      const tools = await personPresses(lead)
      // ⛔ **Held inside the launch** — the reservation exists and the stamp has not been cleared yet,
      // because only a reopen that ARRIVES writes `reopened`. ⚑ The gate is read per launch, so
      // the lead's own press above was not held.
      gate = new FakeLaunchGate()
      const sending = callOn(tools, 'message_agent', {
        agent: children[0],
        kind: 'note',
        text: 'are you there',
      })
      await waitFor(() => (gate?.held ?? 0) > 0, 'the child’s start to be inside its launch')
      // ⚑ **D-017b — the rail's row carries the ONE state** (`ResumableSessionInfo.state`), so it
      // says what `list_agents` says below, and never a second, process-shaped word beside it.
      expect(host.resumableSessions().find((one) => one.sessionId === children[0])?.state).toEqual({
        is: 'active',
      })
      const all = await callOn(tools, 'list_agents', {})
      const named = (all.agents as { agent: string; state: string }[]).filter(
        (card) => card.agent === children[0],
      )
      // ⚑ **D-017 · R11 — *starting* reads `active`**: something is on its way into it.
      expect(named).toEqual([expect.objectContaining({ state: 'active' })])
      gate.release()
      expect((await sending).outcome).toBe('ok')
    })

    it('⚑ list_agents names the three, and get_agent_status answers for one — without starting it', async () => {
      const { lead, children } = await theFourOpen()
      await quitAndRelaunch()
      const leadTools = await personPresses(lead)
      const before = launched.length

      const all = await callOn(leadTools, 'list_agents', {})
      const cards = all.agents as { agent: string; state: string; parent: string | null }[]
      for (const child of children) {
        // ⚑ **Every field a card carries, from the ledger** — the parent its row names (and
        // `spawnedBy` is that parent: the start its next message makes writes the same). ⚠️ D-016
        // took the card's `project`, and the spawn reason with `spawn_agent`.
        expect(
          cards.find((card) => card.agent === child),
          child,
        ).toMatchObject({
          // ⚑ **D-017 · R11 — the one state**: a conversation this app is not running, owed
          // nothing, is `idle` — whether a process runs is not a state.
          state: 'idle',
          parent: lead,
          spawnedBy: lead,
          provider: 'claude',
        })
      }
      const one = await callOn(leadTools, 'get_agent_status', { agent: children[0] })
      expect(one).toMatchObject({ outcome: 'ok', agent: { state: 'idle' } })
      expect(launched.length - before, 'reading a card started a provider').toBe(0)
    })

    // ⛔ **`end_agent closes a child that came back open` retired with `end_agent` (D-017, commit
    // 3)** — nothing ends a conversation now.

    it('⚑ interrupt_agent on a child that came back open interrupts nothing and starts nothing', async () => {
      const { lead, children } = await theFourOpen()
      await quitAndRelaunch()
      const leadTools = await personPresses(lead)
      const before = launched.length

      const interrupted = await callOn(leadTools, 'interrupt_agent', {
        agent: children[0],
        reason: 'check',
      })
      // ⛔ **`asked: false`** — nothing is running in it, so nothing was asked; `asked: true` would
      // be the claim `interrupt_agent`'s own note exists to keep honest.
      expect(interrupted, JSON.stringify(interrupted)).toMatchObject({
        outcome: 'ok',
        asked: false,
        state: 'idle',
      })
      expect(launched.length - before).toBe(0)
      expect(listed(children[0])).toEqual({ running: 'not-running' })
    })

    /**
     * ⚑ **D-016 · re-aimed: taking a piece back TELLS its owner, and that starts it** (ruling 8 —
     * `withdraw_task` wakes a stopped owner to hear the notice). ⛔ This measured the take-back
     * starting nothing, which was true while nothing was said to the owner.
     */
    it('⚑ withdraw_task takes work back from a child that came back open — and the telling starts exactly that child', async () => {
      const { lead, children, leadTools } = await theFourOpen()
      const piece = await giveTo(leadTools, children[0], 'the work to take back')
      await quitAndRelaunch()
      const tools = await personPresses(lead)
      const before = launched.length

      const withdrawn = await callOn(tools, 'withdraw_task', { piece })
      // ⚑ **D-022 · R3 — `sent`**: the child runs nothing after the relaunch, so it is woken and the
      // notice goes out as its turn now — told, not held.
      expect(withdrawn, JSON.stringify(withdrawn)).toMatchObject({
        outcome: 'ok',
        delivery: 'sent',
      })
      expect(store.piecesOwnedBy(children[0]).find((one) => one.piece === piece)?.state).toBe(
        'withdrawn',
      )
      await letItSettle()
      expect(launched.length - before).toBe(1)
      expect(launched.at(-1)?.kind).toBe('resume')
      expect(listed(children[0])).toEqual({ running: 'unwatched' })
      for (const other of children.slice(1)) {
        expect(listed(other), other).toEqual({ running: 'not-running' })
      }
    })

    it('🔴 its parent is told the turn the quit interrupted, never that its conversation has ended — pushed and listed', async () => {
      const { lead, children, leadTools } = await theFourOpen()
      // ⚑ **D-016 · only what it is told from here on** — the four were made by gives whose briefs
      // ended in `auto`, and the lead was told about each before its child handed the piece back.
      const toldBefore = ledger(lead).length
      await giveTo(leadTools, children[0], 'the work the quit interrupted')
      await quitAndRelaunch()
      const tools = await personPresses(lead)

      const toldTheLead = (): string[] =>
        ledger(lead)
          .slice(toldBefore)
          .flatMap((event) =>
            (event.type === 'user_turn' || event.type === 'message_queued') &&
            event.text.includes('is not being worked on')
              ? [event.text]
              : [],
          )
      await waitFor(() => toldTheLead().length > 0, 'the lead to be told about its work')
      // ⛔ **Measured before `692`: *"the conversation it was given to has ended"*** — about a child
      // the rail and its own card call open. ⚑ **D-016c — the TURN's cause**: the quit interrupted
      // the turn the child was parked in, and no cause or sentence names the stop itself (`692`'s
      // kept-open words, and its negative against *"has ended"*, went with the stop cause).
      expect(toldTheLead().join('\n')).toContain(ITS_TURN_WAS_STOPPED)
      // ⚑ **D-017 · R11 — `list_tasks` says the history, and `given_to_is` what the child is doing
      // now**: the same cause, and no second, process-shaped reading of its own.
      const { text } = await textOf(tools, 'list_tasks', {})
      expect(text).toContain(ITS_TURN_WAS_STOPPED)
    })

    it('🔴 735 · a person’s first message to that child, refused after its start, while its lead RUNS: the start is undone, and the lead’s last word is still true', async () => {
      // ⚑ **Measured in `735`'s review**: the reopen told the running lead *"that conversation was
      // started again"* (`661`), and a stop would then have pushed *"has ended"* — so the door kept
      // the start for a running giver. ⚑ **D-016c — a start and a stop tell nobody anything**, so
      // the door undoes the start as it does for a giver that is not running (below), and what the
      // lead read — the turn the quit interrupted — is still true of its child.
      const { lead, children, leadTools } = await theFourOpen()
      const [child] = children
      const piece = await giveTo(leadTools, child, 'the work the quit interrupted')
      await quitAndRelaunch()
      await personPresses(lead)
      const toldTheLead = (): string[] =>
        ledger(lead).flatMap((event) =>
          event.type === 'user_turn' || event.type === 'message_queued' ? [event.text] : [],
        )
      await waitFor(
        () => toldTheLead().some((text) => text.includes(ITS_TURN_WAS_STOPPED)),
        'the lead to be told the turn the quit interrupted',
      )
      await letItSettle()
      const toldBefore = toldTheLead().length
      const notes = join(root, 'notes.md')
      writeFileSync(notes, 'the notes\n')

      const answer = await host.startAndSend(child, '/usage', window, [
        { path: notes, kind: 'file', outsideCwd: false },
      ])

      if (!('notSent' in answer)) throw new Error(JSON.stringify(answer))
      expect(answer.notSent.refusedBy).toBe('after-the-start')
      // ⚑ **Undone, as for a lead that is not running** — nothing runs it, and nothing is handed over.
      expect(answer.notSent.running).toBeNull()
      await letItSettle()
      expect(listed(child)).toEqual({ running: 'not-running' })
      // ⛔ **Nothing more for the lead to read** — the start and its undo told nobody anything, and
      // its last word, the turn the quit interrupted, is still what the piece says.
      expect(toldTheLead().slice(toldBefore)).toEqual([])
      expect(store.piecesOwnedBy(child).find((one) => one.piece === piece)?.stalledBecause).toBe(
        'turn_interrupted',
      )
    })

    it('🔴 735 · …and while its lead is NOT running: the start is undone, and the lead, started later, reads the true word', async () => {
      const { lead, children, leadTools } = await theFourOpen()
      const [child] = children
      await giveTo(leadTools, child, 'the work the quit interrupted')
      await quitAndRelaunch()
      const notes = join(root, 'notes.md')
      writeFileSync(notes, 'the notes\n')

      const answer = await host.startAndSend(child, '/usage', window, [
        { path: notes, kind: 'file', outsideCwd: false },
      ])

      if (!('notSent' in answer)) throw new Error(JSON.stringify(answer))
      expect(answer.notSent.refusedBy).toBe('after-the-start')
      // ⚑ **D-017b** — no `stillWaiting`: undone, nothing runs it, and nothing is handed over.
      expect(answer.notSent.running).toBeNull()
      expect(listed(child)).toEqual({ running: 'not-running' })
      await personPresses(lead)
      const toldTheLead = (): string =>
        ledger(lead)
          .flatMap((event) =>
            event.type === 'user_turn' || event.type === 'message_queued' ? [event.text] : [],
          )
          .join('\n')
      // ⚑ **D-016c — the true word is the turn the quit interrupted**: neither the start nor its
      // undo moved the piece.
      await waitFor(
        () => toldTheLead().includes(ITS_TURN_WAS_STOPPED),
        'the lead to be told the turn the quit interrupted',
      )
    })

    it('🔴 the PERSON is told the same — the band of work nobody was told about says the turn the quit interrupted', async () => {
      const { children, leadTools } = await theFourOpen()
      await giveTo(leadTools, children[0], 'the work the quit interrupted')
      await quitAndRelaunch()

      // ⚑ **The premise: the person IS shown this work** — its giver, closed by the same quit, has
      // not been told — so the sentence below is one a person reads on the first screen after a
      // relaunch, beside a rail that draws the child open.
      const band = host.stalledWorkForAPerson().rows.filter((row) => row.owner === children[0])
      expect(band).toHaveLength(1)
      const said = stalledWorkSaid(band[0]!)
      // ⛔ **Measured before `692`: *"The conversation it was given to has ended."*** ⚑ **D-016c** —
      // the turn's cause, as its giver is told (the negative against *"has ended"* went with the stop
      // cause: no sentence says it now).
      expect(band[0]?.because).toBe('turn_interrupted')
      expect(said.toLowerCase()).toContain(ITS_TURN_WAS_STOPPED)
    })

    it('⚑ …and after a CRASH the band says what the crash did, which is then true (R34c)', async () => {
      const { children, leadTools } = await theFourOpen()
      await giveTo(leadTools, children[0], 'the work the crash interrupted')
      await crashAndRelaunch()

      const band = host.stalledWorkForAPerson().rows.filter((row) => row.owner === children[0])
      expect(band).toHaveLength(1)
      // ⚑ No quit recorded anything, so the launch settled the work as restarted — and the child is
      // closed, reopenable, as it was before 692.
      expect(stalledWorkSaid(band[0]!)).toBe('The app restarted while it was open.')
      expect(listed(children[0]!)).toEqual({ running: 'not-running' })
    })

    it('⚑ a parent still gives work to its OWN child — as it could the running one', async () => {
      const { lead, children, leadTools } = await theFourOpen()
      // ⚑ **`any` is the grant** (D-016: `same-project` went with projects) — ⚑ **and a give finds
      // the giver's OWN conversation with that agent** by the parent its row names, so this is the
      // state where a start that forgot its parent would reach a NEW conversation and the running
      // child is not.
      expect(store.setCapabilities('lead', { canAssignWork: 'any' })).toBe(true)
      // The control: the running child takes the parent's work under the same grant.
      await giveTo(leadTools, children[0], 'the running one')
      await quitAndRelaunch()
      const tools = await personPresses(lead)

      // ⚑ **…and the give reaches the very child the quit left open** (`giveTo` checks the agent).
      await giveTo(tools, children[1], 'the one the quit stopped')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · R34a — only what the QUIT closed
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · R34a, D-017b — however it stopped, a conversation is listed as its neighbours are', () => {
    it('⚑ a conversation a person closed before the quit is listed as its neighbours are — nothing runs any', async () => {
      const { lead, children } = await theFourOpen()
      const { sessionId: closedByAPerson } = await host.createSession(
        { provider: 'claude', profileId: 'lead-2', approvalMode: 'ask', cwd: root },
        window,
      )
      await host.close(closedByAPerson, window)
      await quitAndRelaunch()

      expect(listed(closedByAPerson)).toEqual({ running: 'not-running' })
      expect(listed(lead)).toEqual({ running: 'not-running' })
      expect(listed(children[0])).toEqual({ running: 'not-running' })
    })

    // ⛔ **`a child its parent ended before the quit stays closed` retired with `end_agent` (D-017,
    // commit 3)** — nothing ends a conversation now.

    it('⚑ a conversation whose provider failed before the quit is listed as the ones the quit stopped', async () => {
      const { children } = await theFourOpen()
      const failing = launched.at(-1)?.handle
      if (failing === undefined) throw new Error('no child handle')
      failing.simulateError('the provider fell over', true)
      const failed = children.at(-1) as string
      await waitFor(() => listed(failed)?.running === 'not-running', 'the failed child to end')
      await quitAndRelaunch()

      expect(listed(failed)).toEqual({ running: 'not-running' })
      expect(listed(children[0])).toEqual({ running: 'not-running' })
    })

    it('⚑ a conversation a person was CLOSING when the quit began is listed as the ones the quit stopped', async () => {
      const { lead, children } = await theFourOpen()
      // ⛔ **Not awaited** — the quit lands while the person's Close is still tearing it down.
      const closing = host.close(lead, window)
      await quitAndRelaunch()
      await closing
      expect(listed(lead)).toEqual({ running: 'not-running' })
      expect(listed(children[0])).toEqual({ running: 'not-running' })
    })

    it('⚑ a conversation whose provider failed IN PLACE — errored, not yet torn down — is listed as the ones the quit stopped', async () => {
      const { lead, children } = await theFourOpen()
      const failing = launched.at(-1)?.handle
      if (failing === undefined) throw new Error('no child handle')
      failing.simulateError('the provider fell over', true)
      // ⛔ **The quit in the same tick**, before the stream's end reaches the finalizer — so the slot
      // is still registered, its status is `errored`, and nothing is tearing it down yet.
      await quitAndRelaunch()
      expect(listed(children[2])).toEqual({ running: 'not-running' })
      expect(listed(lead)).toEqual({ running: 'not-running' })
    })

    it('⚑ a stopped conversation being REOPENED when the quit began is left with nothing running — it never started', async () => {
      const { sessionId } = await host.createSession(
        { provider: 'claude', profileId: 'reopened-late', approvalMode: 'ask', cwd: root },
        window,
      )
      await host.close(sessionId, window)
      await quitAndRelaunch()
      expect(listed(sessionId)).toEqual({ running: 'not-running' })
      // ⛔ **Held inside the launch**, so the quit finds a reservation with no provider behind it.
      gate = new FakeLaunchGate()
      host = buildHost()
      const reopening = host.resumeSession(sessionId, window).catch(() => 'refused')
      await waitFor(() => (gate?.held ?? 0) > 0, 'the reopen to be inside its launch')
      await quitAndRelaunch()
      await reopening
      expect(listed(sessionId)).toEqual({ running: 'not-running' })
    })

    it('⚑ a conversation whose provider ENDED on its own, not yet torn down, is listed as the ones the quit stopped', async () => {
      const { lead, children } = await theFourOpen()
      const ending = launched.at(-1)?.handle
      if (ending === undefined) throw new Error('no child handle')
      // ⛔ **The provider stops itself and the quit lands in the same tick** — before the stream's
      // end reaches the finalizer, so the slot is registered and its handle already says `ended`.
      void ending.close()
      await quitAndRelaunch()
      expect(listed(children[2])).toEqual({ running: 'not-running' })
      expect(listed(lead)).toEqual({ running: 'not-running' })
    })

    it('⚑ a person’s Close of one the quit stopped starts nothing — and it is listed the same after another quit', async () => {
      const { lead, children } = await theFourOpen()
      await quitAndRelaunch()
      const before = launched.length
      await host.close(children[0], window)
      expect(listed(children[0])).toEqual({ running: 'not-running' })
      expect(listed(lead)).toEqual({ running: 'not-running' })
      await quitAndRelaunch()
      expect(listed(children[0])).toEqual({ running: 'not-running' })
      expect(launched.length - before).toBe(0)
    })

    /**
     * ⚑ **D-017 · R10 — re-aimed: the start that finds out REPLACES it.** ⛔ This measured the
     * message refused *could not be resumed* and the child closed. ⚑ A conversation its provider no
     * longer has is replaced by a new one of the same agent, and the message goes there
     * (`went_to`); the old one is not left open, for *open* is a promise nothing could keep for it.
     */
    it('⚑ one its provider can no longer resume is replaced by the start that finds out', async () => {
      const { lead, children } = await theFourOpen()
      await quitAndRelaunch()
      const tools = await personPresses(lead)
      // ⛔ **The provider forgets what it issued** — a conversation its files no longer hold.
      issued.forgetAll()
      const said = await callOn(tools, 'message_agent', {
        agent: children[0],
        kind: 'note',
        text: 'are you there',
      })
      expect(said, JSON.stringify(said)).toMatchObject({ outcome: 'ok', agent: children[0] })
      const replacement = said.went_to as string
      expect(replacement).toBeTruthy()
      expect(replacement).not.toBe(children[0])
      expect(ledger(children[0])).toContainEqual({ type: 'replaced_by', sessionId: replacement })
      // ⚑ **…and nothing runs it**: the message went to the one in its place.
      expect(listed(children[0])?.running ?? 'not-running').toBe('not-running')
      expect(listed(children[1])).toEqual({ running: 'not-running' })
    })

    it('⛔ …but a start that failed for a reason of THIS attempt leaves it as it was, to be tried again', async () => {
      const { lead, children } = await theFourOpen()
      await quitAndRelaunch()
      const tools = await personPresses(lead)
      CountingRuntime.failTheNextResume = new Error('the app-server closed its pipe')
      const said = await callOn(tools, 'message_agent', {
        agent: children[0],
        kind: 'note',
        text: 'are you there',
      })
      expect(said, JSON.stringify(said)).toMatchObject({ outcome: 'refused' })
      // ⚑ **Still open**: nothing about the conversation was learned — only that this start failed.
      expect(listed(children[0])).toEqual({ running: 'not-running' })
    })

    /**
     * 🔴 **706 · …and a CODEX thread its app-server no longer has is let go too** (`705` F-3).
     *
     * ⚑ **The error is the real adapter's**: `CodexRuntime.resume` over the product's own
     * `createSpawnTransportFactory`, against a `codex` that refuses `thread/resume` with the bytes
     * `probe:codex-lost-thread` measured on the bundled `0.146.0`. ⛔ **Measured on `main`: kept
     * open** — the refusal rides as `cause`, and the host let go only of a causeless `ResumeError`,
     * so every press failed again, forever. ⚠️ The row it is handed to is a Claude one: the host's
     * reading of a refused resume is the same for every provider, and what differs is the error.
     */
    const aCodexResumeRefused = async (scenario: 'no-rollout' | 'died'): Promise<unknown> => {
      const home = join(userData, `codex-706-${scenario}`, 'home')
      const cwd = join(userData, `codex-706-${scenario}`, 'cwd')
      mkdirSync(home, { recursive: true })
      mkdirSync(cwd, { recursive: true })
      const codex = aCodexThatRefuses(
        join(userData, `codex-706-${scenario}`, 'bin'),
        scenario,
        CODEX_PROTOCOL_VERSION,
      )
      const refused = await new CodexRuntime(createSpawnTransportFactory(codex))
        .resume(
          { provider: 'codex', sessionId: A_CODEX_THREAD, cwd, rotation: 0 },
          { providerHome: home },
        )
        .then(
          () => null,
          (error: unknown) => error,
        )
      expect(refused).toBeInstanceOf(ResumeError)
      // ⚑ The premise both arms stand on: each carries its cause, so *"has a cause"* cannot tell them apart.
      expect((refused as Error).cause).toBeInstanceOf(Error)
      return refused
    }

    /** ⚑ **D-017 · R10 — re-aimed as above**: the start that finds out replaces it. */
    it('🔴 706 · a Codex thread its app-server says it no longer has — the ADAPTER’s own refusal — is replaced by the start that finds out', async () => {
      const lost = await aCodexResumeRefused('no-rollout')
      const { lead, children } = await theFourOpen()
      await quitAndRelaunch()
      const tools = await personPresses(lead)
      CountingRuntime.theNextResumeThrows = lost
      const said = await callOn(tools, 'message_agent', {
        agent: children[0],
        kind: 'note',
        text: 'are you there',
      })
      expect(said, JSON.stringify(said)).toMatchObject({ outcome: 'ok', agent: children[0] })
      expect(said.went_to).toBeTruthy()
      expect(said.went_to).not.toBe(children[0])
      expect(listed(children[0])?.running ?? 'not-running').toBe('not-running')
      expect(listed(children[1])).toEqual({ running: 'not-running' })
    })

    it('🔴 706 · …and a PERSON’s press finds it out the same way', async () => {
      const lost = await aCodexResumeRefused('no-rollout')
      const { children } = await theFourOpen()
      await quitAndRelaunch()
      CountingRuntime.theNextResumeThrows = lost
      await expect(host.resumeSession(children[0], window)).rejects.toBeInstanceOf(ResumeError)
      expect(listed(children[0])).toEqual({ running: 'not-running' })
    })

    it('⛔ 706 · …but a Codex app-server that DIED in the resume — the adapter’s own error — leaves it as it was, to be tried again', async () => {
      const died = await aCodexResumeRefused('died')
      const { lead, children } = await theFourOpen()
      await quitAndRelaunch()
      const tools = await personPresses(lead)
      CountingRuntime.theNextResumeThrows = died
      const said = await callOn(tools, 'message_agent', {
        agent: children[0],
        kind: 'note',
        text: 'are you there',
      })
      expect(said, JSON.stringify(said)).toMatchObject({ outcome: 'refused' })
      // ⚑ **Still open**: an app-server that died says nothing about the conversation.
      expect(listed(children[0])).toEqual({ running: 'not-running' })
    })

    it('⛔ 706 · …and a CLAUDE home its own probe could not READ — the adapter’s own error — leaves it as it was', async () => {
      // ⚠️ **`706` review** — Claude's probe was `existsSync`, which answers *"not there"* for a file
      // it could not read; on `main` that was *"session not found"* and the conversation was let go.
      // ⚑ **The folder the working folder names is the one it cannot read**, and `projects/` itself
      // is listable — so the probe's own doubt is all that stands between it and a never (the `706`
      // review, round four: an unreadable `projects/` is ALSO refused by its listing).
      const home = join(userData, 'claude-706-unreadable')
      const projects = join(home, 'projects', claudeProjectDirName(root))
      mkdirSync(projects, { recursive: true })
      chmodSync(projects, 0o000)
      let unreadable: unknown
      try {
        unreadable = await new ClaudeRuntime()
          .resume(
            { provider: 'claude', sessionId: 'sess_706', cwd: root, rotation: 0 },
            { providerHome: home },
          )
          .then(
            () => null,
            (error: unknown) => error,
          )
      } finally {
        chmodSync(projects, 0o755)
      }
      expect(unreadable).toBeInstanceOf(ResumeError)
      const { lead, children } = await theFourOpen()
      await quitAndRelaunch()
      const tools = await personPresses(lead)
      CountingRuntime.theNextResumeThrows = unreadable
      const said = await callOn(tools, 'message_agent', {
        agent: children[0],
        kind: 'note',
        text: 'are you there',
      })
      expect(said, JSON.stringify(said)).toMatchObject({ outcome: 'refused' })
      expect(listed(children[0])).toEqual({ running: 'not-running' })
    })

    it('⚑ a person’s Close while it is STARTING — pressed, then closed before it arrived — leaves nothing running', async () => {
      const { lead, children } = await theFourOpen()
      await quitAndRelaunch()
      gate = new FakeLaunchGate()
      const pressing = host.resumeSession(lead, window).catch(() => 'cancelled')
      await waitFor(() => (gate?.held ?? 0) > 0, 'the press to be inside its launch')
      await host.close(lead, window)
      await pressing
      expect(listed(lead)).toEqual({ running: 'not-running' })
      await quitAndRelaunch()
      expect(listed(lead)).toEqual({ running: 'not-running' })
      expect(listed(children[0])).toEqual({ running: 'not-running' })
    })

    // ⛔ **`its parent’s end while its start is in flight leaves it closed` retired with `end_agent`
    // (D-017, commit 3)** — nothing ends a conversation now.

    it('⚑ the quit writes its record only once everything it closed is down — a crash before then records nothing', async () => {
      const { lead, children } = await theFourOpen()
      const quitting = store
      const seenWhenWritten: string[][] = []
      const write = quitting.closedByTheQuit.bind(quitting)
      quitting.closedByTheQuit = (ids, at) => {
        // ⚑ **What the host is still running at the moment of the write** — nothing, or the write
        // came before the teardown and a crash in between would have brought them back open.
        // ⚠️ **By the RECORDED status, not by `running`** — a slot being torn down already reads
        // `not-running`, so only the row the finalizer writes says the teardown is over (found by
        // review, round two: a record written between the close and its end passed the old check).
        seenWhenWritten.push(
          [lead, ...children].filter(
            (id) => quitting.resumable().find((row) => row.sessionId === id)?.status !== 'ended',
          ),
        )
        write(ids, at)
      }
      await quitAndRelaunch()
      expect(seenWhenWritten).toEqual([[]])
      expect(listed(lead)).toEqual({ running: 'not-running' })
    })

    // ⚑ **D-017b** — R34c's *closed* is gone with the split: a crash and a quit both leave nothing
    // running, and the rail says the same of each.
    it('⚑ R34c · a crash records nothing, and the next launch lists all four with nothing running them', async () => {
      const { lead, children } = await theFourOpen()
      crashAndRelaunch()
      for (const id of [lead, ...children]) {
        expect(listed(id), id).toEqual({ running: 'not-running' })
      }
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · across more than one restart
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · a second quit, and a crash after a start', () => {
    it('⚑ a second quit while they are still unspoken-to lists them the same, and starts nothing', async () => {
      const { lead, children } = await theFourOpen()
      await quitAndRelaunch()
      const before = launched.length
      await quitAndRelaunch()
      for (const id of [lead, ...children]) {
        expect(listed(id), id).toEqual({ running: 'not-running' })
      }
      expect(launched.length - before).toBe(0)
    })

    it('⚑ one that was started and then crashed is listed as the ones nobody spoke to — nothing runs any', async () => {
      const { lead, children } = await theFourOpen()
      await quitAndRelaunch()
      await personPresses(lead)
      crashAndRelaunch()
      expect(listed(lead)).toEqual({ running: 'not-running' })
      for (const id of children) {
        expect(listed(id), id).toEqual({ running: 'not-running' })
      }
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · the walls a message meets before it starts anything
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · the walls come before the start', () => {
    /**
     * ⚑ **D-017 · R2 — re-aimed: the parent-only clause is gone.** ⛔ This measured a non-parent with
     * a reach to every conversation being shown NOTHING after the quit, because only the parent's
     * message started a conversation the quit left open. ⚑ Now any caller's message does, so the
     * grant decides, as for the running child: it is shown it and its message starts it. ⚠️ The
     * verb that reaches only the chain below the caller refuses it `not-below-you` (D-017 · R12).
     */
    it('🔴 a caller that is NOT its parent, with a reach to every conversation, is shown it and starts it — the grant decides, as for the running one', async () => {
      const { children } = await theFourOpen()
      const { sessionId: neighbour } = await host.createSession(
        { provider: 'claude', profileId: 'neighbour', approvalMode: 'ask', cwd: root },
        window,
      )
      const neighbourTools = lastToolset()
      expect(store.setCapabilities('neighbour', { canMessage: 'any' })).toBe(true)
      const listedBy = async (tools: AgentToolset): Promise<string[]> =>
        ((await callOn(tools, 'list_agents', {})).agents as { agent: string }[]).map(
          (card) => card.agent,
        )
      expect(await listedBy(neighbourTools)).toEqual(expect.arrayContaining(children))
      await quitAndRelaunch()
      const tools = await personPresses(neighbour)
      const before = launched.length

      expect(await listedBy(tools)).toEqual(expect.arrayContaining([neighbour, ...children]))
      expect(await callOn(tools, 'get_agent_status', { agent: children[0] })).toMatchObject({
        outcome: 'ok',
        agent: { state: 'idle' },
      })
      // ⚑ **D-017 · R12 — an id that exists and is not below the caller is `not-below-you`**, never
      // `no-such-agent`; ⛔ `end_agent`, the other verb of the chain, went with commit 3.
      const interrupted = await callOn(tools, 'interrupt_agent', {
        agent: children[0],
        reason: 'not mine',
      })
      expect([interrupted.outcome, interrupted.rail]).toEqual(['refused', 'not-below-you'])
      await letItSettle()
      expect(launched.length - before).toBe(0)
      // ⛔ **…and it is still open**: a caller that may not stop it did not.
      expect(listed(children[0])).toEqual({ running: 'not-running' })

      // ⚑ **Its message starts exactly that child** — the grant admits it, as it did while it ran.
      const said = await callOn(tools, 'message_agent', {
        agent: children[0],
        kind: 'note',
        text: 'hello',
      })
      expect(said, JSON.stringify(said)).toMatchObject({ outcome: 'ok', agent: children[0] })
      expect(launched.length - before).toBe(1)
    })

    /**
     * ⚑ **D-017 · R2 — re-aimed: the wall at the host's door is the GRANT.** ⛔ This granted every
     * rail but the parent-only one and measured that the door started nothing — the parent-only rail
     * is gone, and the arm above starts it with that grant. ⚑ So the door is asked by a caller whose
     * grant does NOT admit the child, past every tool, and the same call one grant over is the
     * control.
     */
    it('⛔ the host door itself starts nothing for a caller its grant does not admit — asked directly, past every tool', async () => {
      const { children } = await theFourOpen()
      const { sessionId: neighbour } = await host.createSession(
        { provider: 'claude', profileId: 'neighbour', approvalMode: 'ask', cwd: root },
        window,
      )
      expect(store.setCapabilities('neighbour', { canMessage: 'none' })).toBe(true)
      await quitAndRelaunch()
      await personPresses(neighbour)
      const before = launched.length
      const asTheNeighbour = (): ReturnType<RuntimeHost['queueMessage']> =>
        host.queueMessage(
          children[0],
          'hello',
          { ownerId: agentCallerId(neighbour) },
          [],
          'work',
          {},
          'follow-up',
        )

      await expect(asTheNeighbour()).rejects.toThrow()
      await letItSettle()
      expect(launched.length - before, 'a caller its grant does not admit started it').toBe(0)
      expect(listed(children[0])).toEqual({ running: 'not-running' })

      // ⚑ **The control, one grant over**: the same call, the same caller, and it starts it.
      expect(store.setCapabilities('neighbour', { canMessage: 'any' })).toBe(true)
      await expect(asTheNeighbour()).resolves.toMatchObject({ outcome: 'sent' })
      expect(launched.length - before).toBe(1)
    })

    it('⛔ its parent, narrowed to give no work, is refused THAT wall — as by the running child — and starts nothing', async () => {
      const { lead, children, leadTools } = await theFourOpen()
      expect(store.setCapabilities('lead', { canAssignWork: 'none' })).toBe(true)
      // The control: the RUNNING child refuses its own parent's work by this wall.
      const running = await callOn(leadTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: profileOf(children[0]),
        title: 'do this',
        brief: 'do this',
      })
      expect(running, JSON.stringify(running)).toMatchObject({
        outcome: 'refused',
        rail: 'may-not-assign-work',
      })
      await quitAndRelaunch()
      const tools = await personPresses(lead)
      const before = launched.length

      const said = await callOn(tools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: profileOf(children[1]),
        title: 'do this',
        brief: 'do this',
      })
      expect(said, JSON.stringify(said)).toMatchObject({ outcome: 'refused', rail: running.rail })
      expect(launched.length - before, 'a start was spent on work the wall refuses').toBe(0)
    })

    // ⛔ **`its parent re-sending work the child still holds is refused before any start` is gone
    // with its subject** (D-016): `agent-already-has-work-open` — the one-open-task rail — left the
    // product, and a give to a child the quit stopped is admitted and starts it.

    /**
     * ⚑ **D-017 · R1 — re-aimed: a message asks the rails a MESSAGE meets, and no launch rail.** ⛔
     * This measured the spawning switch refusing the parent's message, because the start it made was
     * asked the launch rails. ⚑ The one start door (`ensureRunning`) asks none: switching spawning
     * off stops NEW conversations, and a message to one that exists starts it.
     */
    it('⚑ with spawning switched off, the parent’s message still starts its child — a message is not a spawn', async () => {
      const { lead, children } = await theFourOpen()
      await quitAndRelaunch()
      const leadTools = await personPresses(lead)
      store.setSpawningEnabled(false)
      const before = launched.length

      const said = await callOn(leadTools, 'message_agent', {
        agent: children[0],
        kind: 'note',
        text: 'are you there',
      })
      expect(said, JSON.stringify(said)).toMatchObject({ outcome: 'ok', agent: children[0] })
      expect(launched.length - before).toBe(1)
      expect(listed(children[0])).toEqual({ running: 'unwatched' })
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §6 · what crosses the quit with it, and what does not (R34's fourth bullet)
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§6 · plan mode, a held message, a question', () => {
    it('🔴 741 · plan mode is LEFT — a reopen after the quit does not resume planning (R99, corrected)', async () => {
      // ⛔ `692` wrote *"plan mode is KEPT — the row carries it, and the start replays it"*: its brief
      // asked what each thing does across the quit and to make it true, and the reopen replayed it
      // then. ⚑ R99 (corrected, `741`): *"a reopened conversation does NOT resume planning, whoever
      // started the plan"* — as the interactive CLI's own resume does not (measured, `740` K7).
      const { sessionId } = await host.createSession(
        {
          provider: 'claude',
          profileId: 'planner',
          approvalMode: 'ask',
          cwd: root,
          planMode: true,
        },
        window,
      )
      await quitAndRelaunch()
      expect(listed(sessionId)).toEqual({ running: 'not-running' })
      const resumed = await host.resumeSession(sessionId, window)
      expect(resumed.settings.planMode).toBe(false)
    })

    /**
     * ⚑ **D-017 · R3 — re-aimed: a HELD message survives the quit.** ⛔ This measured it given back
     * as text (`message_unqueued` · `abandoned`) by the quit's teardown. ⚑ A stop ends nothing now:
     * the quit writes nothing for it, its `message_queued` row stays open, and the conversation's
     * next start sends it.
     */
    it('⚑ a HELD message survives the quit — nothing ends it, the conversation comes back open, and its next start sends it', async () => {
      const { sessionId } = await host.createSession(
        { provider: 'claude', profileId: 'holder', approvalMode: 'ask', cwd: root },
        window,
      )
      await host.send(sessionId, 'first', window)
      await waitFor(
        () => ledger(sessionId).some((event) => event.type === 'permission_request'),
        'the first turn to stop on a card',
      )
      const held = await host.queueMessage(sessionId, 'second, held', window)
      expect(held.outcome).toBe('queued')
      await quitAndRelaunch()

      expect(
        ledger(sessionId).some(
          (event) => event.type === 'message_unqueued' && event.text === 'second, held',
        ),
        'the quit ended the held words',
      ).toBe(false)
      // ⚑ …and a conversation the quit found mid-turn is one the quit closed.
      expect(listed(sessionId)).toEqual({ running: 'not-running' })

      // ⚑ **…and its next start sends them.**
      await personPresses(sessionId)
      await waitFor(() => answered(sessionId, 'second, held'), 'the held words to be sent')
    })

    // ⚑ `726` · R92 — *"an ATTACHMENT it was handed is handed again when it starts"* was here: it
    // pinned that a reopen re-granted `ResumeOptions.handedPaths`, the carve-out out of
    // `protectedRoots`. R92 removed the protected roots, so a reopen has no grant to carry.

    it('🔴 D-009 · a QUESTION held for a person comes back after the quit — and so does the conversation that asked', async () => {
      const { children, leadTools } = await theFourOpen()
      const asker = children[2]
      const askerTools = lastToolset()
      const piece = await giveTo(leadTools, asker, 'pick one of the two')
      const asked = await callOn(askerTools, 'ask_question', {
        who_answers: 'a-person',
        piece,
        question: 'which of the two?',
      })
      expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
      const theQuestion = (): number =>
        host.questionsForAPerson().rows.filter(
          (row) =>
            // ⛔ **The one the asker ADDRESSED to a person** — the Fake also parks each turn on a
            // permission card, and that card is a person's to answer too.
            row.request.askedBy === asker && row.request.went.is === 'the-person-the-asker-named',
        ).length
      expect(theQuestion(), 'the premise: a person is holding its question').toBe(1)
      await quitAndRelaunch()

      // 🔴 **D-009 · re-aimed: decision 4, *an open question survives a quit, as work does*.** ⛔ This
      // said *"Lost, and `661` says why: the words … live in memory, and an ending abandons it"* —
      // true until the words were read from the asker's own `question_asked` row and the launch
      // routed again what the quit's ending had abandoned (`reopenTheQuestionsAQuitLeftOpen`).
      // ⚑ **D-016 · ruling 14 took that launch sweep**, and the question still stands after the
      // quit: a stop ends nothing (D-017 · R3), so there is nothing for a launch to route again.
      expect(theQuestion()).toBe(1)
      expect(listed(asker)).toEqual({ running: 'not-running' })
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §7 · 699 — what a quit left open, everywhere
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§7 · 699 · what a quit left open, everywhere', () => {
    /** ⚑ Every `work_interrupted` row in one ledger, as the payload the fold and the card read. */
    const asksIn = (sessionId: string): TranscriptEvent[] =>
      ledger(sessionId).filter((event) => event.type === 'work_interrupted')

    /** ⚑ The open piece each child was given below, by the child — the Work tab's row is its. */
    const theOpenPiece = new Map<string, string>()

    /** ⚑ Give a child work and wait for its turn to END with the work still open (`turn_ended`). */
    const giveAndLetItStall = async (
      tools: AgentToolset,
      child: string,
      text: string,
    ): Promise<void> => {
      const piece = await giveTo(tools, child, text)
      theOpenPiece.set(child, piece)
      await waitFor(
        () =>
          store
            .piecesOwnedBy(child)
            .some((one) => one.piece === piece && one.stalledBecause === 'turn_ended'),
        'the child’s turn to end with the work open',
      )
    }

    /** ⚑ The Work tab's row for the open piece a parent gave one child — `workGivenBy`. */
    const workTabRow = (parent: string, child: string): Record<string, unknown> | undefined => {
      const piece = theOpenPiece.get(child)
      return host.workGivenBy(parent).rows.find((row) => row.piece === piece) as
        Record<string, unknown> | undefined
    }

    // ⛔ **F-c · `end_agent on a child the quit left open writes the ask a running child’s end
    // writes` retired with `end_agent` (D-017, commit 3).** Its control below stays: a person's
    // Close writes no ask.

    it('⚑ F-c control · a PERSON’s Close writes no ask — of a running conversation, or of one the quit left open', async () => {
      const { lead, children } = await theFourOpen('auto')
      const { sessionId: own } = await host.createSession(
        { provider: 'claude', profileId: 'lead-2', approvalMode: 'auto', cwd: root },
        window,
      )
      await host.close(own, window)
      await quitAndRelaunch()
      await host.close(children[0], window)

      expect(asksIn(own)).toEqual([])
      expect(asksIn(children[0])).toEqual([])
      expect(listed(children[0])).toEqual({ running: 'not-running' })
      expect(listed(lead)).toEqual({ running: 'not-running' })
    })

    it('🔴 F-d · the Work tab reads the durable word and no process fact — through a quit and a person’s Close, and a window is told to re-read', async () => {
      const { lead, children, leadTools } = await theFourOpen('auto')
      await giveAndLetItStall(leadTools, children[0], 'the work the quit interrupted')
      await giveAndLetItStall(leadTools, children[1], 'the work its parent will end')
      await quitAndRelaunch()

      // ⚑ **The durable word is the turn's, and the quit did not move it** (D-016c — a stop moves no
      // piece). ⛔ `699` read the quit's ending here with a live *kept open* fact beside it, so the
      // tab would not say *has ended*; neither is on the row now: a process fact is never shown.
      expect(workTabRow(lead, children[0])).toMatchObject({ stalledBecause: 'turn_ended' })
      expect(workTabRow(lead, children[0])).not.toHaveProperty('holderKeptOpen')

      // ⚑ **Live**: a person closes the other one. ⛔ Until commit 3 this was its parent's
      // `end_agent`, which went with that tool. ⚑ **D-017b** — a Close of a conversation nothing
      // runs is nothing to do (the quit's stamp it took is gone), so the person opens it first, and
      // the Close is a stop of what runs.
      await personPresses(lead)
      await personPresses(children[1])
      expect(listed(children[1])).toEqual({ running: 'in-a-window' })
      announced.length = 0
      await host.close(children[1], window)
      expect(listed(children[1])).toEqual({ running: 'not-running' })
      expect(workTabRow(lead, children[1])).toMatchObject({ stalledBecause: 'turn_ended' })
      expect(workTabRow(lead, children[1])).not.toHaveProperty('holderKeptOpen')
      // 🔴 **…and a window is TOLD to re-read it** — the Work tab re-reads on `work` alone, and the
      // ending of a conversation holding open work announces it (`689`).
      expect(announced.map((change) => change.what)).toContain('work')
    })

    it('⚑ F-d control · a person’s Close of one holding NO open work announces no work', async () => {
      const { children } = await theFourOpen('auto')
      await quitAndRelaunch()
      // ⚑ **D-017b** — as above: a Close is a stop of what runs, so it is running first.
      await personPresses(children[0])
      announced.length = 0
      await host.close(children[0], window)
      expect(listed(children[0])).toEqual({ running: 'not-running' })
      // ⚑ The conversations moved and nothing a Work tab reads did.
      expect(announced.map((change) => change.what)).toContain('conversations')
      expect(announced.map((change) => change.what)).not.toContain('work')
    })

    it('⚑ F-d controls · a RUNNING holder and a CRASH-closed one read the same — the turn’s word, and no process fact', async () => {
      const { lead, children, leadTools } = await theFourOpen('auto')
      await giveAndLetItStall(leadTools, children[0], 'the work of a running child')
      expect(workTabRow(lead, children[0])).toMatchObject({ stalledBecause: 'turn_ended' })
      expect(workTabRow(lead, children[0])).not.toHaveProperty('holderKeptOpen')

      // ⚑ **The stall predates the crash, so the launch leaves its word alone** — `work_restarted`
      // passes over a task already `stalled` — and the rail lists the holder with nothing running
      // it. ⚑ **D-016c** — `699`'s live fact, which a crash-closed holder carried, went with the
      // kept-open family: whether a process runs is never part of the row.
      crashAndRelaunch()
      expect(workTabRow(lead, children[0])).toMatchObject({ stalledBecause: 'turn_ended' })
      expect(listed(children[0])).toEqual({ running: 'not-running' })
      expect(workTabRow(lead, children[0])).not.toHaveProperty('holderKeptOpen')
    })

    it('🔴 F-d · the notice’s OWN report says what its words say — the turn the quit interrupted, and nothing about a process', async () => {
      const { lead, children, leadTools } = await theFourOpen()
      await giveTo(leadTools, children[0], 'the work the quit interrupted')
      await quitAndRelaunch()
      await personPresses(lead)

      const notices = (): { text: string; work: unknown }[] =>
        ledger(lead).flatMap((event) =>
          (event.type === 'user_turn' || event.type === 'message_queued') &&
          event.text.includes('is not being worked on')
            ? [{ text: event.text, work: event.work }]
            : [],
        )
      // ⚠️ **Found by its words, never by its position** — `699` observed an earlier notice from the
      // quit's own teardown taking `notices()[0]` under load.
      const saysTheTurnWasStopped = (): { text: string; work: unknown } | undefined =>
        notices().find((one) => one.text.includes(ITS_TURN_WAS_STOPPED))
      await waitFor(
        () => saysTheTurnWasStopped() !== undefined,
        'the lead to be told the turn the quit interrupted',
      )
      const notice = saysTheTurnWasStopped()
      // ⚑ The premise: the WORDS say the turn the quit interrupted (D-016c).
      expect(notice?.text).toContain(ITS_TURN_WAS_STOPPED)
      // ⛔ **`699` measured the report saying `conversation_ended` under a body that said the child
      // was open.** ⚑ Now the row's word is the body's — one account of one row — and the report
      // carries no fact about a process.
      expect(notice?.work).toMatchObject({
        state: 'stalled',
        stalledBecause: 'turn_interrupted',
      })
      expect(notice?.work).not.toHaveProperty('holderKeptOpen')
      // ⚑ **Two measurements, not one read twice** (`699`'s review). ⚑ The assertion above read the
      // row through `store.events`, which is the store's field-by-field bound (`518`) — so a bound
      // that dropped the field fails THERE. ⚑ This one reads the BYTES on disk, so a report that
      // was never written with the field fails here as well, and the two are told apart.
      const raw = (
        db
          .prepare(
            `SELECT payload FROM events WHERE session_id = ? AND type IN ('user_turn', 'message_queued')`,
          )
          .all(lead) as { payload: string }[]
      )
        .map((row) => JSON.parse(row.payload) as { text?: string; work?: unknown })
        .find((payload) => payload.text?.includes(ITS_TURN_WAS_STOPPED) === true)
      expect(raw?.work).toMatchObject({ stalledBecause: 'turn_interrupted' })
      expect(raw?.work).not.toHaveProperty('holderKeptOpen')
    })

    /**
     * ⚑ **D-017b retired F-l's reading** — `closedBecauseTheAppDidNotFinishQuitting` on both halves,
     * and the quit's *began closing* record it was read off (`theQuitIsClosing`): *closed because
     * BroBot did not finish quitting* is a sentence about a process, and no row says one now. ⚑ What
     * stays is its negative, on every shape F-l measured: after a crash, and after a quit that began
     * and did not finish, each row is listed — nothing runs it — and says nothing about why.
     */
    it('🔴 F-l, D-017b · after a CRASH or a quit that did not finish, every row is listed as any other — no word says why', async () => {
      const { lead, children } = await theFourOpen()
      crashAndRelaunch()
      for (const id of [lead, ...children]) {
        expect(listed(id), id).toEqual({ running: 'not-running' })
      }
      // ⚑ **…and the UNRESUMABLE half** — a conversation a crash caught before its first turn named it.
      db.prepare('UPDATE provider_session SET external_ref = NULL WHERE id = ?').run(children[0])
      const unresumable = host.unresumableSessions().find((one) => one.sessionId === children[0])
      expect(unresumable, 'the premise: it is on the unresumable half').toBeDefined()
      expect(unresumable).not.toHaveProperty('closedBecauseTheAppDidNotFinishQuitting')

      // ⚑ **A quit whose record never lands** — every teardown wrote `ended`, nothing says it finished.
      await personPresses(lead)
      const quitting = store
      quitting.closedByTheQuit = () => {
        throw new Error('the app stopped before the quit recorded what it closed')
      }
      await quitAndRelaunch()
      expect(host.resumableSessions().find((one) => one.sessionId === lead)?.status).toBe('ended')
      expect(listed(lead)).toEqual({ running: 'not-running' })
    })

    // ⛔ **F-c · `…and a HELD notice is taken back when its parent ends a child whose START is in
    // flight` retired with `end_agent` (D-017, commit 3).** ⚑ Its control (*a held notice whose
    // words are still TRUE is not taken back*) had already gone with D-017 · R3: a quit hands a held
    // message on to the next start now.
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §8 · 702 · the conversation the quit stopped, told everywhere
  // ───────────────────────────────────────────────────────────────────────────────────────────

  /**
   * ⚑ **D-017 · R2/R3 and D-016c — what a person's Close does to what the commander was told.**
   * ⛔ `702` F-1 measured a Close making *"it is still open"* false, so the held notice was taken
   * back and the commander told *"has ended"*. ⚑ A Close is a STOP now, and a stop moves no piece,
   * so the words it was told — the turn the quit interrupted — stay true: the F-1 arms below measure
   * that nothing is taken back and nothing more is said.
   */
  describe('§8 · 702 · the conversation the quit stopped, told everywhere', () => {
    type Notice = TranscriptEvent & {
      readonly text: string
      readonly messageId?: string
      readonly work?: { readonly piece?: string }
    }

    /** ⚑ Every notice a conversation was handed or holds about ONE piece, in ledger order. */
    const noticesAbout = (sessionId: string, taskId: string): Notice[] =>
      ledger(sessionId).filter(
        (event) =>
          (event.type === 'user_turn' || event.type === 'message_queued') &&
          (event as Notice).work?.piece === taskId,
      ) as Notice[]

    const saying = (notices: readonly Notice[], words: string): Notice[] =>
      notices.filter((one) => one.text.includes(words))

    const endingOf = (
      sessionId: string,
      messageId: string | undefined,
    ): (TranscriptEvent & { reason?: string; detail?: string }) | undefined =>
      ledger(sessionId).find(
        (event) => event.type === 'message_unqueued' && event.messageId === messageId,
      ) as (TranscriptEvent & { reason?: string; detail?: string }) | undefined

    const retracted = (sessionId: string): TranscriptEvent[] =>
      ledger(sessionId).filter(
        (event) => event.type === 'message_unqueued' && event.reason === 'retracted',
      )

    const give = giveTo

    /** ⚑ The notice that OPENED the lead's turn — sent, so read — saying the turn the quit stopped. */
    const readTheStoppedTurn = async (lead: string, taskId: string): Promise<Notice> => {
      await waitFor(
        () =>
          saying(noticesAbout(lead, taskId), ITS_TURN_WAS_STOPPED).some(
            (one) => one.type === 'user_turn',
          ),
        'the lead to read the turn the quit interrupted',
      )
      const read = saying(noticesAbout(lead, taskId), ITS_TURN_WAS_STOPPED)[0]
      if (read === undefined) throw new Error('unreachable')
      return read
    }

    /** ⚑ What the person's band says about one task — `stalledWorkForAPerson`, the complement. */
    const inThePersonsBand = (taskId: string): number =>
      host.stalledWorkForAPerson().rows.filter((row) => row.piece === taskId).length

    const bandRow = (taskId: string) =>
      host.stalledWorkForAPerson().rows.find((row) => row.piece === taskId)

    it('🔴 F-1 · a person’s Close of a child the quit left open leaves the HELD notice standing — its words are still true, and nothing more is said', async () => {
      const { lead, children, leadTools } = await theFourOpen()
      const tasks = [
        await give(leadTools, children[0], 'the work of the first'),
        await give(leadTools, children[1], 'the work of the second'),
      ]
      await quitAndRelaunch()
      await personPresses(lead)
      // ⚑ **One notice per child's work, one behind the other** — the first opens the lead's turn
      // (which parks on the double's card), the second is HELD behind it.
      const heldNotices = (): Notice[] =>
        tasks.flatMap((taskId) =>
          saying(noticesAbout(lead, taskId), ITS_TURN_WAS_STOPPED).filter(
            (one) => one.type === 'message_queued',
          ),
        )
      await waitFor(() => heldNotices().length > 0, 'a notice about the stopped turn to be held')
      const held = heldNotices()[0]
      const taskId = held?.work?.piece ?? ''
      const holder = taskId === tasks[0] ? children[0] : children[1]
      const other = holder === children[0] ? children[1] : children[0]
      const otherTask = (taskId === tasks[0] ? tasks[1] : tasks[0]) ?? ''

      // ⚑ **A PERSON's Close** — the rail's gesture (the commander's own `end_agent` went with
      // D-017's commit 3).
      await host.close(holder, window)
      expect(listed(holder)).toEqual({ running: 'not-running' })
      await letItSettle()

      // ⚑ **D-017 and D-016c — the Close is a stop, and a stop moves no piece**: the held words are
      // true, so nothing takes them back, and the commander is told nothing more.
      expect(endingOf(lead, held?.messageId)).toBeUndefined()
      expect(retracted(lead)).toEqual([])
      expect(noticesAbout(lead, taskId)).toEqual([held])
      // ⚑ **What it was told is still what is true** — the durable record a later launch reads.
      expect(store.workReportedTo(lead).has(taskId)).toBe(true)

      // ⚑ **THE CONTROL, one child over**: not closed, and nothing about it moves either.
      expect(listed(other)).toEqual({ running: 'not-running' })
      expect(saying(noticesAbout(lead, otherTask), ITS_TURN_WAS_STOPPED)).toHaveLength(1)
      // ⚑ **…and the person's band agrees** — the complement: both commanders' work was told, so
      // neither is a person's to see (`workReportedTo`, read by both recipients).
      expect(inThePersonsBand(otherTask)).toBe(0)
      expect(inThePersonsBand(taskId)).toBe(0)
    })

    it('🔴 F-1 · …and a commander that already READ its notice is told nothing more when a person closes the child', async () => {
      const { lead, children, leadTools } = await theFourOpen()
      const taskId = await give(leadTools, children[0], 'the work the quit interrupted')
      await quitAndRelaunch()
      await personPresses(lead)
      // ⚑ The premise: the notice opened its turn, so it is on the wire — read, and not retractable.
      await readTheStoppedTurn(lead, taskId)

      await host.close(children[0], window)
      await letItSettle()

      // ⚑ **D-017 and D-016c** — what it read is still true of a conversation a person closed: a
      // stop moves no piece. Nothing is taken back, and nothing more is pushed.
      expect(noticesAbout(lead, taskId)).toHaveLength(1)
      expect(retracted(lead)).toEqual([])
      expect(store.workReportedTo(lead).has(taskId)).toBe(true)
    })

    it('🔴 F-1 · a commander NOT running when its child is closed is told nothing when it next comes up — and the person is shown nothing', async () => {
      const { lead, children, leadTools } = await theFourOpen()
      const taskId = await give(leadTools, children[0], 'the work the quit interrupted')
      await quitAndRelaunch()
      await personPresses(lead)
      await readTheStoppedTurn(lead, taskId)
      // ⚑ The person closes the commander, and then the child.
      await host.close(lead, window)
      await host.close(children[0], window)
      // ⚑ **D-017 — the complement** (`workReportedTo`, one answer for both recipients): what the
      // commander was told is still true, so nothing is owed, and the PERSON is shown nothing.
      expect(inThePersonsBand(taskId)).toBe(0)

      await personPresses(lead)
      await letItSettle()
      expect(saying(noticesAbout(lead, taskId), ITS_TURN_WAS_STOPPED)).toHaveLength(1)
      expect(noticesAbout(lead, taskId)).toHaveLength(1)
      expect(inThePersonsBand(taskId)).toBe(0)
    })

    it('⚑ F-1 control · a band row whose giver was told NOTHING is a person’s to see — on the turn the quit interrupted', async () => {
      const { children, leadTools } = await theFourOpen()
      const taskId = await give(leadTools, children[0], 'the work the quit interrupted')
      await quitAndRelaunch()
      // ⚑ The lead is never pressed, so nothing is ever pushed to it: the band's ordinary row.
      // ⚑ **D-016c** — the row carries no fact about what its giver was told (the R54 leads went
      // with the kept-open family): being on the band is what says nobody was told.
      await host.close(children[0], window)
      expect(inThePersonsBand(taskId)).toBe(1)
      expect(bandRow(taskId)?.because).toBe('turn_interrupted')
    })

    /**
     * ⛔ **F-1 · *a notice taken back before it was read is not a telling* retired with its subject
     * (D-016c).** It pinned `702`'s rule that a held *still open* notice the closing took back was
     * no receipt, which existed for the kept-open take-back. ⚑ A receipt stands now unless its
     * message was abandoned — a notice this app took back stands as told (R69).
     */

    it('⚑ F-1 control · …while the child is NOT closed, what it read is still true — it is told nothing again, and the person is shown nothing', async () => {
      const { lead, children, leadTools } = await theFourOpen()
      const taskId = await give(leadTools, children[0], 'the work the quit interrupted')
      await quitAndRelaunch()
      await personPresses(lead)
      await readTheStoppedTurn(lead, taskId)
      await host.close(lead, window)
      // ⚑ **One fact over from the arm above**: the child is NOT closed.
      expect(listed(children[0])).toEqual({ running: 'not-running' })
      expect(inThePersonsBand(taskId)).toBe(0)

      await personPresses(lead)
      await letItSettle()
      expect(saying(noticesAbout(lead, taskId), ITS_TURN_WAS_STOPPED)).toHaveLength(1)
      expect(noticesAbout(lead, taskId)).toHaveLength(1)
      expect(inThePersonsBand(taskId)).toBe(0)
    })

    /**
     * ⚑ **D-017 · R1 — a start that fails ends nothing.** ⛔ This measured the failed start CLOSING the
     * child, so its commander was told *"has ended"*. ⚑ The row is still one a message is sent to —
     * that message's own start answers why it cannot run it — so the commander is told nothing more.
     */
    it('🔴 F-1 · …the same when a start finds the child’s provider no longer has it — nothing more is said', async () => {
      const { lead, children, leadTools } = await theFourOpen()
      const taskId = await give(leadTools, children[0], 'the work the quit interrupted')
      await quitAndRelaunch()
      await personPresses(lead)
      await readTheStoppedTurn(lead, taskId)
      // ⛔ **The provider forgets what it issued**, and a PERSON presses the child.
      issued.forgetAll()
      await host.resumeSession(children[0], window).catch(() => 'refused')
      expect(listed(children[0])).toEqual({ running: 'not-running' })
      await letItSettle()

      expect(noticesAbout(lead, taskId)).toHaveLength(1)
      expect(store.workReportedTo(lead).has(taskId)).toBe(true)
    })

    // ⛔ **F-1 control · `its commander’s OWN end is its telling` retired with `end_agent` (D-017,
    // commit 3)** — nothing ends a conversation now.

    /**
     * ⚑ **D-017 · R18 — `list_tasks` reads a child the quit left open in the one state.** ⛔ This
     * measured the work row carrying the quit's *kept open* fact beside the stall, so that door did
     * not read *ended* about an open child. ⚑ The row says the history (`stalled_because`) and what
     * the holder is doing now (`given_to_is`) — `idle` — and no kept-open fact beside them.
     * ⚠️ **D-016** took the `list_projects` half (its work row and its card) with projects.
     */
    it('🔴 F-2 · list_tasks reads a child the quit left open in the one state, idle — before and after a person’s Close', async () => {
      const { lead, children, leadTools } = await theFourOpen()
      const taskId = await give(leadTools, children[0], 'the work the quit interrupted')
      await quitAndRelaunch()
      const tools = await personPresses(lead)

      const gaveOut = async (): Promise<Record<string, unknown> | undefined> =>
        ((await callOn(tools, 'list_tasks', {})).you_gave as Record<string, unknown>[]).find(
          (row) => row.piece === taskId,
        )
      // ⚑ **The durable word stays** — the turn the quit interrupted really did stop the work
      // (D-016c: the TURN's cause, never the quit's) — and `given_to_is` reads the holder in the ONE
      // state.
      expect(await gaveOut()).toMatchObject({
        stalled_because: 'turn_interrupted',
        given_to_is: 'idle',
      })
      expect(await gaveOut()).not.toHaveProperty('holder_kept_open')

      // ⚑ **D-017 · R2** — a person's Close is a stop and a message still starts the child, and
      // (D-016c) a stop moves no piece, so the row reads the same.
      await host.close(children[0], window)
      expect(await gaveOut()).toMatchObject({
        stalled_because: 'turn_interrupted',
        given_to_is: 'idle',
      })
    })
  })
})
