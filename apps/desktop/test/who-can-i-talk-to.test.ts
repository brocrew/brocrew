import { waitFor } from './lib/f093-host'
import {
  fixtureProviderConfig,
  RecordingSink,
  syntheticProviderHome,
  neutralHostDeps,
} from './lib/host-fixture'
import { forestOf } from './lib/forest-of-host'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost, THE_APP_ITSELF } from './helpers/giver-notice-host'
import type { AgentCard, CallerIdentity } from './helpers/giver-notice-host'
import { CONVERSATIONS_LISTED, agentCallerId } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
import { theOwnerOf } from '../src/shared/piece-called'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

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
    // ⚑ **D-007** — every handle a start issued, so a test can make its provider fail.
    STARTED.push(handle)
    return handle
  }
}

/** ⚑ **D-007** — the handles {@link ToolWatchingRuntime} issued, emptied before each test. */
const STARTED: Awaited<ReturnType<FakeRuntime['start']>>[] = []

/**
 * The roster says whom the caller can talk to and whether talking wakes them.
 *
 * ⛔ **His words, 2026-09-22:** *"when a conversation turn is ended, the list_agents does not
 * return that agent. can the list agent returns all agents including stopped ones?"*
 *
 * ⚠️ **The word `turn` is the one thing that is not it**, and §1.1 is that measurement: a turn
 * that ended leaves the slot exactly where it was and the card reads `idle`. ⚑ **D-017 · R2 — and
 * since then NOTHING that stops a conversation drops its row**: a Close (§1.2), a crash (§1.3) and a
 * graceful quit (§1.3b) leave it listed — ⚑ **R11: `idle`, the one state, which says nothing about
 * a process** — to every caller whose reach admits it, because a message starts it again. ⛔ What still drops a row is a reach that never admitted it
 * (`a-reach-you-can-see.test.ts` §1, where that half already lives and is not repeated here).
 *
 * 🔴 **§3.1 was the finding `642` did not repair, and D-017 did.** `list_tasks` reads the LEDGER and
 * names `given_to` for work whose holder has since stopped; every door that takes an agent id
 * answered `no-such-agent` about that same id. ⚑ Now the holder is a card, and the doors take it.
 *
 * ⚑ **Real host, real SQLite ledger, real migrations, real toolsets.** The only double is the
 * provider, and `approvalMode: 'auto'` is what lets a turn run to its terminal without parking on
 * a card — `FakeRuntime` publishes none in that mode since `186`.
 */
describe('642 · who can I talk to', () => {
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
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => new ToolWatchingRuntime(provider, handed, issued),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-talk-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-talk-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = Date.UTC(2030, 0, 1)
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handed = []
    issued = new FakeProviderSessions()
    STARTED.length = 0
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (
    profileId: string,
    approvalMode: 'ask' | 'auto' = 'auto',
  ): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode, cwd: root },
      window,
    )
    return sessionId
  }

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  const callOn = async (
    toolset: AgentToolset,
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const idsListedBy = async (toolset: AgentToolset): Promise<string[]> => {
    const listed = (await callOn(toolset, 'list_agents', {})) as { agents: { agent: string }[] }
    return listed.agents.map((one) => one.agent).sort()
  }

  const ledgerOf = (sessionId: string): { type: string }[] =>
    store.events(sessionId).map((entry) => entry.event)

  const letTheTurnEnd = async (sessionId: string, text: string): Promise<void> => {
    const before = ledgerOf(sessionId).filter((event) => event.type === 'turn').length
    await host.send(sessionId, text, window, [])
    await waitFor(
      () => ledgerOf(sessionId).filter((event) => event.type === 'turn').length > before,
      'the turn to reach its own terminal',
    )
  }

  const speakingAs = (sessionId: string): CallerIdentity => ({ ownerId: agentCallerId(sessionId) })

  // ───────────────────────────────────────────────────────────────────────────────
  // §1 · what list_agents drops, and exactly when
  // ───────────────────────────────────────────────────────────────────────────────

  it('§1.1 a conversation whose TURN has ended is still listed', async () => {
    const brobot = await personOpens(DEFAULT_PROFILE_ID)
    const tools = theToolsetJustHandedOut()
    const worker = await personOpens('worker')

    expect(await idsListedBy(tools)).toEqual([brobot, worker].sort())

    await letTheTurnEnd(worker, 'do a thing')
    await waitFor(
      () => host.agentCard(worker, window, null)?.state.is === 'idle',
      'the worker to go idle',
    )

    expect(await idsListedBy(tools)).toEqual([brobot, worker].sort())
    expect(host.agentCard(worker, speakingAs(brobot), brobot)?.state).toEqual({ is: 'idle' })
  })

  /**
   * ⚑ **D-017 · R2 — re-aimed: a Close is a STOP, and a stopped conversation stays listed.** ⛔ This
   * said *"a conversation that has ENDED is dropped, and every door that takes an id refuses it"*.
   * ⚑ Now it is listed to a caller whose reach admits it — ⚑ **R11: `idle`** — its card answers,
   * the one verb that reaches only the chain below the caller refuses it in its own word (R12:
   * `no-such-agent` is only for an id no conversation has), and a message starts it again.
   */
  it('§1.2 a conversation a person CLOSED stays listed, and the doors that take an id answer it as a stopped one', async () => {
    const brobot = await personOpens(DEFAULT_PROFILE_ID)
    const tools = theToolsetJustHandedOut()
    const worker = await personOpens('worker')
    expect(await idsListedBy(tools)).toContain(worker)

    await host.close(worker, window)

    expect(await idsListedBy(tools)).toEqual([brobot, worker].sort())
    expect(await callOn(tools, 'get_agent_status', { agent: worker })).toMatchObject({
      outcome: 'ok',
      agent: { state: 'idle' },
    })
    // ⛔ **Not BroBot's to interrupt** — it did not start it and it is not below it — so the door
    // refuses it in its own word (D-017 · R12), exactly as for the running one. Asked before the
    // message starts it.
    const interrupted = await callOn(tools, 'interrupt_agent', { agent: worker, reason: 'stop' })
    expect([interrupted.outcome, interrupted.rail]).toEqual(['refused', 'not-below-you'])
    // ⚑ …and the message starts it again (R1). ⚑ **D-016** — a note: BroBot gave it no piece, and a
    // follow-up must name one.
    const sent = await callOn(tools, 'message_agent', {
      agent: worker,
      text: 'are you there',
      kind: 'note',
    })
    expect(sent, JSON.stringify(sent)).toMatchObject({ outcome: 'ok', agent: worker })
    expect(host.sessionIds).toContain(worker)
  })

  /**
   * 🔴 **692 · a restart empties it only when the restart was a CRASH** (PM ruling R34).
   *
   * ⛔ **This said *"a RESTART empties it"* and measured a graceful quit**, which was true until R34
   * ruled that *"a conversation the app closed ONLY because the app quit comes back OPEN"*. ⚑ So the
   * pin was split: a crash emptied it (R34c), and a graceful quit left the child a caller COMMANDS
   * listed (§1.3b). ⚑ **D-017 · R2 — neither empties it now**: a message starts any stopped
   * conversation however it stopped, so the crash leaves every one the caller may reach listed.
   */
  it('§1.3 a CRASH no longer empties it — what it stopped is listed, and the ledger still holds it', async () => {
    const brobot = await personOpens(DEFAULT_PROFILE_ID)
    const worker = await personOpens('worker')
    expect(await idsListedBy(theToolsetJustHandedOut())).toContain(worker)

    // ⛔ No `closeAll`: the quit never ran, so nothing was recorded. ⚠️ **Its own store object** —
    // `a-next-launch-test-needs-its-own-store-object`: a launch sharing the live host's store
    // measures that host's exclusion from the startup repairs, which a crash never leaves behind.
    store = createSessionStore(db, tick)
    const next = buildHost()
    host = next
    const brobotAgain = await personOpens(DEFAULT_PROFILE_ID)
    const tools = theToolsetJustHandedOut()

    expect(await idsListedBy(tools)).toEqual([brobot, worker, brobotAgain].sort())
    for (const stopped of [brobot, worker]) {
      expect(host.agentCard(stopped, speakingAs(brobotAgain), brobotAgain)?.state, stopped).toEqual(
        { is: 'idle' },
      )
    }
    expect(store.identityOf(worker)?.profileSlug).toBe('worker')
    expect(store.identityOf(brobot)?.profileSlug).toBe(DEFAULT_PROFILE_ID)
  })

  /**
   * ⚑ **D-017 · R2 — re-aimed: the commander-only clause is gone.** ⛔ This said *"…and nothing else
   * it did not start"*: only a parent's message started a conversation the quit left open. ⚑ Now any
   * caller's message does, so the grant decides who is shown it, as for a running one — and BroBot's
   * reach is `any`.
   */
  it('§1.3b ⚑ 692 · a graceful QUIT keeps every conversation a caller may reach listed — its own child and the rest', async () => {
    const seeded = await personOpens('worker')
    await host.close(seeded, window)
    const brobot = await personOpens(DEFAULT_PROFILE_ID)
    const brobotTools = theToolsetJustHandedOut()
    const other = await personOpens('other')
    // ⚑ **D-014** — any agent may start a conversation as any existing identity, so no grant is set.
    // ⚑ **D-016** — the give starts the conversation BroBot does not have with `worker` yet.
    const spawned = await callOn(brobotTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The half it hands off',
      brief: 'the half it hands off',
    })
    expect(spawned.outcome, JSON.stringify(spawned)).toBe('ok')
    const child = spawned.agent as string
    // The premise: BroBot's reach is `any`, so before the quit it sees all three running — and the
    // one a person closed, stopped (D-017 · R2).
    expect(await idsListedBy(brobotTools)).toEqual([seeded, brobot, child, other].sort())

    await host.closeAll()
    host = buildHost()
    await host.resumeSession(brobot, window)

    // ⚑ **Its own child, open and running nothing** — its message starts it. ⚑ **And `other`**, a
    // person's conversation the quit also left open, and `seeded`, which a person closed before it:
    // BroBot's message starts them too, and its grant reaches them (a caller may see exactly what it
    // may send to). ⚠️ Asked of `agentsVisibleTo` — the reader `list_agents` IS — because this file's
    // provider double keeps the toolsets of starts only, and the reopened BroBot's is a resume's.
    const visible = host
      .agentsVisibleTo(speakingAs(brobot), brobot)
      .agents.map((card) => card.agent)
      .sort()
    expect(visible).toEqual([seeded, brobot, child, other].sort())
    for (const stopped of [child, other, seeded]) {
      expect(host.agentCard(stopped, speakingAs(brobot), brobot)?.state, stopped).toEqual({
        is: 'idle',
      })
    }
    // ⛔ **The grant still decides**: narrowed to none, BroBot is shown only what it commands.
    expect(store.setCapabilities(DEFAULT_PROFILE_ID, { canMessage: 'none' })).toBe(true)
    expect(host.agentCard(other, speakingAs(brobot), brobot)).toBeNull()
    expect(host.agentCard(child, speakingAs(brobot), brobot)?.state).toEqual({ is: 'idle' })
  })

  // ───────────────────────────────────────────────────────────────────────────────
  // §2 · what the roster answers that the listing does not
  // ───────────────────────────────────────────────────────────────────────────────

  it('§2.1 list_profiles still names an identity whose only conversation has ended', async () => {
    const brobot = await personOpens(DEFAULT_PROFILE_ID)
    const tools = theToolsetJustHandedOut()
    const worker = await personOpens('worker')
    // ⚑ **D-014** — `list_profiles` lists every identity this app holds, so no grant puts `worker`
    // in it: the ended conversation is the only thing this case turns on.
    await host.close(worker, window)

    const listed = (await callOn(tools, 'list_profiles', {})) as {
      profiles: { profile: string }[]
      count_covers: string
    }
    expect(listed.profiles.map((one) => one.profile)).toContain('worker')
    // ⚑ **D-017 · R2** — and the closed conversation itself is still listed, stopped: a message
    // starts it again, so it is no longer only the roster that names what it was.
    expect(await idsListedBy(tools)).toEqual([brobot, worker].sort())
  })

  // ───────────────────────────────────────────────────────────────────────────────
  // §3 · the asymmetry D-017 repairs
  // ───────────────────────────────────────────────────────────────────────────────

  /**
   * ⚑ **D-017 · R2 — re-aimed: the asymmetry is repaired.** ⛔ This measured `list_tasks` naming a
   * `given_to` every door refused, with `given_to_is: null`. ⚑ A Close is a stop now, so the holder
   * is a card (⚑ **R11: `idle`**), the listing names it, and the door that takes the piece takes the
   * work back. ⚑ **D-016** — the holder is named `owner` on the row, and `withdraw_task` takes the
   * piece alone: the piece names its owner, and the owner is TOLD (the `a-piece-taken-back` notice,
   * which starts a stopped owner to hear it).
   */
  it('§3.1 list_tasks names an agent id every door takes', async () => {
    // 🔴 **D-014 · re-aimed** — work goes only to a conversation the giver STARTED, so the holder is
    // BroBot's own child rather than a conversation a person opened; a person then ends it.
    // ⚑ **D-016** — the give IS the work: it starts that child, and its brief is the child's turn.
    await host.close(await personOpens('worker'), window)
    await personOpens(DEFAULT_PROFILE_ID)
    const tools = theToolsetJustHandedOut()
    const gave = await callOn(tools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The work it hands off',
      brief: 'please do this',
    })
    expect(gave.outcome, JSON.stringify(gave)).toBe('ok')
    const worker = gave.agent as string

    host.claimSession(worker, window)
    await host.close(worker, window)

    const tasks = (await callOn(tools, 'list_tasks', {})) as {
      you_gave: { piece: string; owner: string; given_to_is: string | null }[]
    }
    expect(tasks.you_gave.map((row) => row.owner)).toContain(worker)
    expect(tasks.you_gave.find((row) => row.owner === worker)?.given_to_is).toBe('idle')
    expect(await idsListedBy(tools)).toContain(worker)

    // ⚑ **The door that takes the piece takes it** — written into the stopped holder's ledger.
    const piece = tasks.you_gave.find((row) => row.owner === worker)?.piece
    const taken = await callOn(tools, 'withdraw_task', { piece })
    expect(taken.outcome, JSON.stringify(taken)).toBe('ok')
    expect(ledgerOf(worker).some((event) => event.type === 'work_taken_back')).toBe(true)
  })

  // ───────────────────────────────────────────────────────────────────────────────
  // §4 · the sentence this dispatch changed, pinned by name
  // ───────────────────────────────────────────────────────────────────────────────

  // What an id the listing leaves out still is: one the two doors that take any id may reach.
  const SAYS_WHAT_IT_DROPS =
    'message_agent and get_agent_status take any of them by the label of a piece it owns (W1.2) or by its id'

  it('§4.1 the description says what the listing drops, and names the surface that holds the rest', async () => {
    await personOpens(DEFAULT_PROFILE_ID)
    const tools = theToolsetJustHandedOut()
    const listing = tools.tools.find((one) => one.name === 'list_agents')
    expect(listing).toBeDefined()

    expect(listing?.description).toContain(SAYS_WHAT_IT_DROPS)
    expect(listing?.description).toContain('list_profiles')
    // One list: nothing is listed apart.
    expect(listing?.description).not.toContain('Listed apart')
    expect(listing?.description).toContain(
      'Each is named by the piece of work it owns (the owner of W1.2 · its title), or by its id when it holds none, then who it is — the name a person gave that agent, and the profile slug give_work takes — its state, the conversation that started it, named the same way, and the work it holds',
    )
  })

  // ───────────────────────────────────────────────────────────────────────────────
  // §5 · a child that stopped stays listed to its parent
  // ───────────────────────────────────────────────────────────────────────────────

  /**
   * A child that stopped, by a Close, the app's own stop, a provider failure or a crash, stays on
   * the one list as an `idle` agent, because a message starts it again.
   */
  describe('§5 · D-007 · the children that left', () => {
    const aParentAndItsChild = async (): Promise<{
      parent: string
      tools: AgentToolset
      child: string
    }> => {
      await host.close(await personOpens('worker'), window)
      const parent = await personOpens(DEFAULT_PROFILE_ID)
      const tools = theToolsetJustHandedOut()
      // ⚑ **D-016** — the give starts the child; its brief is the child's first turn.
      const spawned = await callOn(tools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'The notes',
        brief: 'the notes',
      })
      expect(spawned.outcome, JSON.stringify(spawned)).toBe('ok')
      return { parent, tools, child: spawned.agent as string }
    }
    const listed = async (
      tools: AgentToolset,
    ): Promise<{ agents: string[]; text: string; notListed: number; keys: string[] }> => {
      const tool = tools.tools.find((one) => one.name === 'list_agents')
      if (tool === undefined) throw new Error('no list_agents')
      const result = await tool.call({})
      const structured = result.structured as { agents: { agent: string }[]; notListed: number }
      return {
        agents: structured.agents.map((card) => card.agent),
        text: result.text,
        notListed: structured.notListed,
        keys: Object.keys(structured).sort(),
      }
    }
    /** The answer carries no second list beside the agents. */
    const ONE_LIST = ['agents', 'count', 'notListed', 'outcome']

    it('🔴 a child a person closes stays among the agents, stopped — never listed apart — and every door answers it', async () => {
      const { tools, child } = await aParentAndItsChild()
      // ⛔ **THE BEFORE**: running, it is an agent, and nothing is listed apart.
      const before = await listed(tools)
      expect(before.agents).toContain(child)
      expect(before.keys).toEqual(ONE_LIST)
      expect(before.text).not.toContain('cannot start again')

      host.claimSession(child, window)
      await host.close(child, window)

      const after = await listed(tools)
      expect(after.agents).toContain(child)
      expect(after.keys).toEqual(ONE_LIST)
      expect(after.text).not.toContain('cannot start again')
      // ⚑ **Its card says it is idle, and a door answers it** — the message starts it again.
      expect(await callOn(tools, 'get_agent_status', { agent: child })).toMatchObject({
        outcome: 'ok',
        agent: { state: 'idle' },
      })
      // ⚑ **D-016** — a note: it is talk, and a follow-up must name a piece.
      const sent = await callOn(tools, 'message_agent', {
        agent: child,
        text: 'are you there',
        kind: 'note',
      })
      expect(sent, JSON.stringify(sent)).toMatchObject({ outcome: 'ok', agent: child })
    })

    it('⚑ a child the app stopped is an agent still once its teardown is over — not listed apart', async () => {
      // ⚑ **D-017 — nothing ends a conversation** (`end_agent` is gone): this arm was a child its
      // parent ended, and the one stop left beside a person's Close is the app's own.
      const { parent, tools, child } = await aParentAndItsChild()
      await host.close(child, THE_APP_ITSELF)
      await waitFor(() => !host.sessionIds.includes(child), 'the child’s teardown to finish')
      const after = await listed(tools)
      // ⚑ **D-017 · R2** — `startable` is the row's rule, so a message starts it, and it is a card,
      // not a line about how it left.
      expect(after.agents).toContain(child)
      expect(after.keys).toEqual(ONE_LIST)
      expect(host.agentCard(child, speakingAs(parent), parent)?.state).toEqual({ is: 'idle' })
    })

    it('⚑ a child whose provider failed is a stopped agent — a failure is a stop, not an ending', async () => {
      const { tools, child } = await aParentAndItsChild()
      const handle = STARTED.at(-1)
      if (handle === undefined) throw new Error('no provider handle was issued')
      handle.simulateError('the provider fell over', true)
      await waitFor(() => !host.sessionIds.includes(child), 'the failed child’s teardown to finish')
      const after = await listed(tools)
      expect(after.agents).toContain(child)
      expect(after.keys).toEqual(ONE_LIST)
      // ⚑ **D-017 · R11** — its line says the one state, never how it stopped. ⚑ **D-016 · commit 7
      // · R3 — the line leads with the piece the child owns** (the one it was given), not its id.
      const named = store.workThatNames(child)
      if (named === null) throw new Error('the child holds no piece')
      const head = `${theOwnerOf(named)} · `
      expect(after.text).toContain(head)
      expect(after.text.split('\n').find((line) => line.startsWith(head))).toMatch(/ · idle( · |$)/)
    })

    it('🔴 after a CRASH, the child the app was running is a stopped agent — and the forest draws it as any other conversation', async () => {
      // ⚑ A first child, closed by a person before the crash: the control for the crash's words.
      const { parent, tools, child: closed } = await aParentAndItsChild()
      host.claimSession(closed, window)
      await host.close(closed, window)
      // ⚑ **D-016 — a second give to the SAME identity reaches the SAME conversation** (one per
      // helper per giver), so the second half is another identity's, and starts a second child.
      await host.close(await personOpens('helper'), window)
      const second = await callOn(tools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'helper',
        title: 'The other half',
        brief: 'the other half',
      })
      expect(second.outcome, JSON.stringify(second)).toBe('ok')
      const child = second.agent as string

      // ⛔ No `closeAll`: the quit never ran. ⚠️ Its own store object, for §1.3's reason.
      store = createSessionStore(db, tick)
      host = buildHost()
      await host.resumeSession(parent, window)

      // ⚑ **D-017 · R2 — neither is a child that left**: a message starts both, so both are cards
      // on the one list (R12), `idle` (R11).
      expect(
        host
          .agentsVisibleTo(speakingAs(parent), parent)
          .agents.map((card) => card.agent)
          .filter((id) => id === child || id === closed)
          .sort(),
      ).toEqual([child, closed].sort())
      for (const stopped of [child, closed]) {
        expect(host.agentCard(stopped, speakingAs(parent), parent)?.state, stopped).toEqual({
          is: 'idle',
        })
      }
      // 🔴 **The person's side** — ⚑ **D-017b · re-aimed, not stripped** (rule 26): the forest's node
      // no longer says the crash closed it (`closedBecauseTheAppDidNotFinishQuitting` went: how a
      // conversation stopped is a process fact a person no longer reads, `05` rule 5). ⛔ So the
      // crash's child and the person's closed one are drawn ALIKE — both nodes there, neither
      // running, and neither carrying a word about how it stopped.
      const nodes = (await forestOf(host)).nodes.rows
      const nodeOf = (id: string) =>
        nodes.find((one) => one.node === 'a-conversation' && one.conversation === id)
      for (const stopped of [child, closed]) {
        const node = nodeOf(stopped)
        expect(node, stopped).toMatchObject({ running: 'not-running' })
        expect(Object.keys(node ?? {}), stopped).not.toContain(
          'closedBecauseTheAppDidNotFinishQuitting',
        )
        expect(Object.keys(node ?? {}), stopped).not.toContain('keptOpenAcrossAQuit')
      }
      // ⚑ …and the two nodes carry the same keys, so nothing one fact over tells them apart either.
      expect(Object.keys(nodeOf(child) ?? {}).sort()).toEqual(
        Object.keys(nodeOf(closed) ?? {}).sort(),
      )
    })

    it('⛔ its PARENT and another conversation with a reach see it alike once it stops — as a card, the grant deciding', async () => {
      const { tools, child } = await aParentAndItsChild()
      await personOpens(DEFAULT_PROFILE_ID)
      const other = theToolsetJustHandedOut()
      // ⚑ The premise: the other one can see the child while it runs.
      expect((await listed(other)).agents).toContain(child)
      host.claimSession(child, window)
      await host.close(child, window)
      // ⚑ **D-017 · R2** — the commander-only clause is gone: a stopped conversation is shown to
      // every caller whose reach admits it, as the running one was, and to nobody as one that left.
      for (const one of [tools, other]) {
        const seen = await listed(one)
        expect(seen.agents).toContain(child)
        expect(seen.keys).toEqual(ONE_LIST)
      }
    })

    it('⚑ a page, not a filter: the most recently active, and how many more there are', async () => {
      // ⚑ **D-017 · R12 — the one list's cut** ({@link CONVERSATIONS_LISTED}), planted at the host's
      // answer as the list apart's page was: the tool says how many more, and which doors take them.
      const { parent, tools } = await aParentAndItsChild()
      const real = host.agentCard(parent, speakingAs(parent), parent)
      if (real === null) throw new Error('no card for the parent')
      const many: AgentCard[] = Array.from({ length: CONVERSATIONS_LISTED }, (_, i) => ({
        ...real,
        agent: `sess_old_${String(i)}`,
      }))
      host.agentsVisibleTo = () => ({ agents: many, notListed: 5 })
      const page = await listed(tools)
      expect(page.agents).toHaveLength(CONVERSATIONS_LISTED)
      expect(page.notListed).toBe(5)
      // ⚑ **D-016 · commit 7 · R1 — by the label of a piece it owns, or its id.**
      expect(page.text).toContain(
        '…and 5 more you can reach, not listed here; get_agent_status and message_agent take the label of a piece it owns (W1.2), or its id.',
      )
    })
  })
})
