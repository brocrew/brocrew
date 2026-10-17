import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeLaunchGate, FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolAnswer } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import {
  RuntimeHost,
  type CallerIdentity,
  type RuntimeEventSink,
} from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { agentCallerId, agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { DEFAULT_CAPABILITIES } from '../src/shared/capabilities'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/**
 * # 🔴 681 · a starting child is already in its project (PM ruling R30)
 *
 * ⛔ **`657` F-a:** a parent could not end its own child while that child was still starting —
 * `end_agent` answered a permanent project refusal, because the boundary read the TARGET's project
 * off its committed `agent_profile` row, and a reservation has none yet. ⚠️ **`650` F1, one door
 * over:** `message_agent` answered `that-conversation-has-not-started` ahead of the walls a running
 * target would be refused by, so a caller narrowed only on giving work was told to retry and then
 * met `may-not-assign-work`.
 *
 * ⚑ **R30a · the reservation carries the project its spawn will run in**, and every wall reads a
 * starting child as it will read it running. **R30b · the walls answer before the shared word** —
 * entitlement, then boundary, then *not started*. **R30c · `459`'s same-tick narrowing is
 * re-derived**: one identity into two projects in one tick is admitted; into one project twice is
 * still refused.
 *
 * ⛔ **Every arm starts from the parent's RULED grants**, and nothing here widens one; the one arm
 * that narrows a grant (§3's `can_assign_work: none`) is a person's narrowing, set in the test.
 *
 * ⚑ **D-017 — `end_agent` and `resume_agent` are gone** (nothing ends a conversation; a message
 * starts a stopped one), so `657` F-a's own section (§1, ending a starting child) went with the
 * first, and §3b's wake arm with the second. ⚑ The walls they measured are still measured at the
 * doors left: `interrupt_agent` (§2) and `message_agent` (§3, §3b).
 *
 * ⚑ **D-016 — projects are gone**, and with them R30a's subject: a reservation carries no project
 * because nothing places a conversation in one, `spawn_agent` takes no `project`, the card names
 * none and the `same-project` narrowings are gone. ⛔ So every arm that put a child in ANOTHER
 * project (§2's, §3's and §3b's), §4's two-projects-in-one-tick and its unplaced parent, and §5–§7
 * (the card's project, a reopen placed by its row, a row that failed to write) went. ⚑ **R30b
 * stays, whole**: every wall a starting child meets is the wall its running self meets, and it
 * answers before the shared *not started* — §2, §2b and §3. ⚑ **D-016 · `spawn_agent` is gone**:
 * work is GIVEN, by profile, to the giver's own conversation with that agent — so §3 gives with
 * `give_work`, §3b's relationship wall is now the give's construction, and §4's same-identity
 * refusal is now the give's lookup, which finds the first start in the same tick.
 *
 * ⚑ Real host, real SQLite ledger, real migrations; the only double is the provider, and
 * {@link FakeLaunchGate} holds one launch inside `start` so the child stays `starting` for as long
 * as a test needs it to.
 */
describe('681 · a starting child is already in its project', () => {
  class PersonSink implements RuntimeEventSink {
    // ⚑ A window IS a person — the sink a person's own conversations are opened through.
    readonly aPersonIsBehindIt = true
    readonly messages: RuntimeEventMessage[] = []
    alive = true
    constructor(readonly ownerId: string) {}
    send(message: RuntimeEventMessage): void {
      this.messages.push(message)
    }
    sendLiveness(): void {}
  }

  let userData: string
  let work: string
  let db: AppDatabase
  let host: RuntimeHost
  let store: SessionStore
  let window: PersonSink
  let counter: number
  let clock: number
  /** ⚑ Holds a launch inside `start` — installed for ONE launch, because it holds from creation. */
  let gate: FakeLaunchGate | null
  /** ⚑ ONE provider registry for every launch, so a reopen finds the session its first life made. */
  let sessions: FakeProviderSessions
  const gatesMade: FakeLaunchGate[] = []
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-681-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-681-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 6_810_000
    store = createSessionStore(db, tick)
    counter = 0
    gate = null
    sessions = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) =>
        new FakeRuntime(provider, { sessions, ...(gate === null ? {} : { gate }) }),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    window = new PersonSink('webContents:1')
  })

  afterEach(async () => {
    for (const made of gatesMade.splice(0)) made.release()
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  const personOpens = async (
    profileId: string,
    approvalMode: 'ask' | 'auto' = 'ask',
  ): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, cwd: work, approvalMode },
      window,
    )
    return sessionId
  }

  const grant = (profileId: string, edit: Parameters<SessionStore['setCapabilities']>[1]): void => {
    expect(store.setCapabilities(profileId, edit), profileId).toBe(true)
  }

  const speakingAs = (sessionId: string): CallerIdentity => ({ ownerId: agentCallerId(sessionId) })

  const toolsOf = (sessionId: string) => {
    const set = agentToolsFor(host, sessionId)
    return async (name: ToolName, args: Record<string, unknown>): Promise<AgentToolAnswer> => {
      const tool = set.tools.find((one) => one.name === name)
      if (tool === undefined) throw new Error(`no such tool: ${name}`)
      return tool.call(args)
    }
  }
  const payload = (answer: AgentToolAnswer): Record<string, unknown> =>
    answer.structured as Record<string, unknown>

  /** ⛔ Bounded, and it waits on the THING. */
  const until = async (check: () => boolean, what: string): Promise<void> => {
    for (let n = 0; n < 400; n += 1) {
      if (check()) return
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  /**
   * 🔴 **A parent on the RULED grants**, with the two identities its children start as. ⛔ Nothing is
   * widened; the first test says so by reading the grants back. (D-016: it stood in project
   * `alpha`, which went with projects.)
   */
  const aParent = async (): Promise<string> => {
    // ⚑ An identity exists only once a conversation has run as it — criterion 12. ⚠️ **Two
    // identities**, because one parent holds ONE live conversation of an identity (`428`'s key):
    // the running child of an arm is a `worker` and the starting one a `helper`.
    await host.close(await personOpens('worker'), window)
    await host.close(await personOpens('helper'), window)
    return personOpens('lead')
  }

  const holdTheNextLaunch = (): FakeLaunchGate => {
    const made = new FakeLaunchGate()
    gatesMade.push(made)
    gate = made
    return made
  }

  interface Child {
    readonly id: string
    /**
     * ⚠️ **Settles, never rejects** — `giveWork` THROWS for a launch that fails after admission
     * (its own docblock), and a child ended at its gate is exactly that.
     */
    readonly spawning: Promise<{ readonly threw: boolean }>
    readonly held: FakeLaunchGate
  }

  /**
   * ⚑ **A child held at its gate**, found the way the parent finds it — `list_agents` names it — so
   * the id every arm below uses is one the product handed the parent. ⚑ **D-017 · R11 — one state**:
   * `starting` is gone, and a start on its way in reads `active`; the new id is the one `list_agents`
   * did not name before the give. ⚑ **D-016** — a child is started by a give that found none, and
   * the give's brief is its first turn.
   */
  const aStartingChild = async (parent: string): Promise<Child> => {
    const held = holdTheNextLaunch()
    const before = new Set(
      host.agentsVisibleTo(speakingAs(parent), parent).agents.map((one) => one.agent),
    )
    const spawning = host
      .giveWork(
        {
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: 'helper',
          title: 'held at its gate',
          brief: 'held at its gate',
        },
        speakingAs(parent),
      )
      .then(
        (outcome) => {
          if (!outcome.ok) throw new Error(`the give was refused: ${outcome.refusal.rail}`)
          return { threw: false }
        },
        () => ({ threw: true }),
      )
    await until(() => held.held > 0, 'the launch to reach its gate')
    gate = null
    const cards = payload(await toolsOf(parent)('list_agents', {})) as {
      agents: { agent: string; state: string }[]
    }
    const starting = cards.agents.filter((one) => !before.has(one.agent))
    expect(starting).toHaveLength(1)
    expect(starting[0]?.state).toBe('active')
    // ⛔ **The premise, asserted**: it is still held at its gate — no provider behind it yet.
    expect(held.held).toBeGreaterThan(0)
    const id = starting[0]?.agent
    if (id === undefined) throw new Error('no starting child')
    return { id, spawning, held }
  }

  const aRunningChild = async (parent: string): Promise<string> => {
    const given = await host.giveWork(
      {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'running',
        brief: 'running',
      },
      speakingAs(parent),
    )
    if (!given.ok) throw new Error(`the give was refused: ${given.refusal.rail}`)
    return given.owner
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §0 · the premise, read back rather than assumed
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  it('§0 the parent measured below holds the RULED reach — nothing in this file widens it', async () => {
    const parent = await aParent()
    const mine = store.identityOf(parent)
    expect(mine).toMatchObject({ profileSlug: 'lead' })
    expect(store.capabilitiesOf('lead')).toEqual(DEFAULT_CAPABILITIES)
    expect(store.capabilitiesOf('lead')).toMatchObject({ canMessage: 'any', canAssignWork: 'any' })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §1 · end_agent — `657` F-a. ⚑ **D-017 — gone with `end_agent`**: nothing ends a conversation,
  // so *a parent ends its own starting child* has no act left to measure. The same boundary, one act
  // down the hierarchy, is §2's.
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §2 · interrupt_agent — the same boundary, one act down the hierarchy
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 interrupt_agent on a child that is still starting', () => {
    it('🔴 a starting child is answered NOT STARTED — a retry — never a boundary', async () => {
      const parent = await aParent()
      const child = await aStartingChild(parent)
      const said = payload(
        await toolsOf(parent)('interrupt_agent', { agent: child.id, reason: 'x' }),
      )
      // 🔴 **RED on `main`**: a permanent project refusal.
      expect(said).toMatchObject({
        outcome: 'refused',
        rail: 'that-conversation-has-not-started',
        retryable: true,
      })
    })
  })

  describe('§2b interrupt_agent from a GRANDPARENT, on a grandchild still starting', () => {
    /**
     * ⚑ **`629`'s chain walk, one wall earlier than the boundary** — the ENTITLEMENT. ⛔ It read the
     * provenance rows, which a starting grandchild does not have yet, so a grandparent was told
     * `no-such-agent` — permanent — about a grandchild its running self would let it stop.
     */
    it('🔴 the grandparent is answered NOT STARTED, and the same grandparent reaches the running one', async () => {
      const lead = await aParent()
      const child = await aRunningChild(lead)
      const grandchild = await aStartingChild(child)
      const call = toolsOf(lead)
      // 🔴 **RED on `main`**: `no-such-agent`.
      const toStarting = payload(
        await call('interrupt_agent', { agent: grandchild.id, reason: 'x' }),
      )
      expect({ rail: toStarting.rail, retryable: toStarting.retryable }).toEqual({
        rail: 'that-conversation-has-not-started',
        retryable: true,
      })
      // ⚑ **The control, one fact over — the same grandchild once it runs** is reached.
      grandchild.held.release()
      await grandchild.spawning
      const toRunning = payload(
        await call('interrupt_agent', { agent: grandchild.id, reason: 'x' }),
      )
      expect(toRunning.rail).not.toBe('no-such-agent')
      expect(toRunning.rail).not.toBe('that-conversation-has-not-started')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §3 · giving work — `650` F1: the walls answer before the shared word. ⚑ D-016: work is given
  // with `give_work`, by profile, and reaches the giver's own conversation with that agent
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 give_work to a child that is still starting', () => {
    const giveTo = (call: ReturnType<typeof toolsOf>, profile: string) =>
      call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile,
        title: 'do the thing',
        brief: 'do the thing',
      })

    it('🔴 a caller narrowed only on giving work meets `may-not-assign-work` at once — starting or running', async () => {
      const parent = await aParent()
      const running = await aRunningChild(parent)
      const child = await aStartingChild(parent)
      // ⚑ **Narrowed once both children exist** — a person's narrowing, and D-016's give asks it
      // of the caller alone, before it looks up the conversation the work would reach.
      grant('lead', { canAssignWork: 'none' })
      const call = toolsOf(parent)
      const toRunning = payload(await giveTo(call, 'worker'))
      const toStarting = payload(await giveTo(call, 'helper'))
      // ⚑ **And the retry the first answer could have promised**, once the launch has landed.
      child.held.release()
      await child.spawning
      const retried = payload(await giveTo(call, 'helper'))
      // ⚠️ **One comparison over all three, so a red names every rail it met.** 🔴 **RED on `main`
      // @ `5c8dffab`**: the starting child answered `that-conversation-has-not-started`, retryable —
      // and the retry it promised met `may-not-assign-work`.
      expect(running).not.toBe(child.id)
      expect({
        running: toRunning.rail,
        starting: toStarting.rail,
        startingRetryable: toStarting.retryable,
        retried: retried.rail,
      }).toEqual({
        running: 'may-not-assign-work',
        starting: 'may-not-assign-work',
        startingRetryable: false,
        retried: 'may-not-assign-work',
      })
    })

    it('⚑ control · the RULED reach: the give waits for the start — and is delivered once it runs', async () => {
      const parent = await aParent()
      const child = await aStartingChild(parent)
      const call = toolsOf(parent)
      // ⚑ **D-017 · R1 — a caller the start serves is not refused at all**: *still starting* is
      // never a refusal, so the work waits for the launch (raced against a short timer, because the
      // launch is held at its gate) — R30b's other half, one ruling on. ⚑ D-016: the give's lookup
      // finds the reservation in flight, so it reaches the starting child rather than a second one.
      const waiting = giveTo(call, 'helper')
      const stillPending = new Promise<string>((resolve) => {
        setTimeout(() => resolve('still pending'), 100)
      })
      expect(await Promise.race([waiting.then(payload), stillPending])).toBe('still pending')
      child.held.release()
      await child.spawning
      expect(payload(await waiting)).toMatchObject({ outcome: 'ok', agent: child.id })
    })
  })

  describe('§3b the other walls a starting receiver meets as its running self does', () => {
    it('⛔ a giver that started neither receiver never reaches either — starting or running', async () => {
      // ⚑ **Work goes only to a conversation the giver started** — D-016 made that the give's
      // construction rather than a wall (`assign-work-to-one-you-did-not-start` went with it): a give
      // names an agent, never a conversation, and reaches the GIVER's own conversation with it.
      const parent = await aParent()
      const running = await aRunningChild(parent)
      const child = await aStartingChild(parent)
      // ⚑ **A caller with no relationship to either**: a conversation a person opened, on the ruled
      // grants — it started neither child.
      const outsider = await personOpens('outsider')
      const give = (profile: string) =>
        host.giveWork(
          {
            definition_of_done: 'The requested result and its checks are recorded.',
            profile,
            title: 'please take this',
            brief: 'please take this',
          },
          speakingAs(outsider),
        )
      const toWorker = await give('worker')
      const toHelper = await give('helper')
      child.held.release()
      await child.spawning
      if (!toWorker.ok || !toHelper.ok) throw new Error('expected both gives admitted')
      // ⚑ **D-042 moved where a start is said** — `started` (null for a conversation that existed)
      // became `runsOn.how`, `'started'` only for one this give started.
      expect({
        worker: toWorker.owner === running,
        helper: toHelper.owner === child.id,
        workerStarted: toWorker.runsOn.how === 'started',
        helperStarted: toHelper.runsOn.how === 'started',
      }).toEqual({ worker: false, helper: false, workerStarted: true, helperStarted: true })
      expect(store.parentOf(toWorker.owner)).toBe(outsider)
      expect(store.parentOf(toHelper.owner)).toBe(outsider)
    })

    // ⚑ **D-017 — `resume_agent`'s arm is gone with that tool**: a message starts a stopped
    // conversation. ⚑ **D-016 — and the message boundary this section also measured, for a starting
    // child in ANOTHER project, went with projects** (`message-outside-your-project`).
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §4 · R30c — one identity, one parent, one tick. ⚑ D-016: the two-projects arm went with projects
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 one identity, one parent, one tick', () => {
    it('⛔ twice in one tick — ONE conversation: the second give finds the first one’s start', async () => {
      // ⚑ **D-016 · R2 step 5** — `428`'s one-live-conversation rail became the give's LOOKUP: the
      // second give in the same tick finds the first one's reservation and goes there, so one parent
      // still holds ONE conversation of an identity, and nothing is refused.
      const parent = await aParent()
      const both = await Promise.all([
        host.giveWork(
          {
            definition_of_done: 'The requested result and its checks are recorded.',
            profile: 'worker',
            title: 'one',
            brief: 'one',
          },
          speakingAs(parent),
        ),
        host.giveWork(
          {
            definition_of_done: 'The requested result and its checks are recorded.',
            profile: 'worker',
            title: 'two',
            brief: 'two',
          },
          speakingAs(parent),
        ),
      ])
      const [first, second] = both
      if (first === undefined || !first.ok || second === undefined || !second.ok) {
        throw new Error('expected both gives admitted')
      }
      // ⚑ **D-042 moved where a start is said** — `started` became `runsOn.how`: the first give
      // started the conversation, and the second, finding its reservation and naming no model,
      // left it `unchanged` — never a second `started`.
      expect(first.runsOn.how).toBe('started')
      expect(second.runsOn.how).toBe('unchanged')
      expect(second.found).toBe(first.owner)
      expect(second.owner).toBe(first.owner)
      expect(second.label).not.toBe(first.label)
    })
  })
})
