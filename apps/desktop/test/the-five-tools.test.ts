import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FakeLaunchGate,
  FakeProviderSessions,
  FakeRuntime,
  type ResumeOptions,
  type StartOptions,
  whatTheChildWouldLack,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { CAPABILITY_FIELDS } from '../src/shared/capabilities'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, THE_APP_ITSELF } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  SPAWN_RAILS,
  describeRail,
  permanenceOf,
  retryableOf,
} from '../src/main/runtime/spawn-rails'
import { sinkOwnerId } from '../src/main/runtime/window-caller'
import {
  REPLY_ADDRESSING_KEYS,
  TOOL_NAMES,
  TOOL_REFUSALS,
  agentCallerId,
  agentToolsFor,
  refuseTool,
  sessionSpeakingAs,
  type ToolName,
} from '../src/main/runtime/agent-tools'
import {
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_LABEL,
  type RuntimeEventMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const srcRoot = join(here, '../src')

/**
 * 🔴 **347 · the five tools.**
 *
 * ⛔ **The tools add no rail, and most of this file exists to prove that negatively.** `341` landed
 * every rail in `SPAWN_RAILS` at the chokepoint; what is new here is a way to REACH them. So every refusal below
 * that names a rail is asserted to be the rail's own answer, carried unchanged — not a second copy
 * of the rule living one layer out.
 *
 * ⚑ **Real host, real SQLite ledger, real migrations, real `resolveSessionCwd`.** The only double is
 * the provider itself.
 *
 * ⚑ **D-016 · the door that starts a conversation is `give_work`** — `spawn_agent` went — so every
 * section asks it, and a second give of one identity by one giver REACHES the conversation that
 * giver has rather than being refused (§3, §3.1).
 */

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = false
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
  events(): TranscriptEvent[] {
    return this.messages.map((message) => message.event)
  }
}

/**
 * ⚑ **A `FakeRuntime` that keeps what it was launched WITH.** `158` added `systemHint` to
 * `FakeSessionHandle` for exactly this reason; the toolset needs the same treatment and gets it
 * here rather than in shared test infrastructure 44 files depend on.
 */
function watchingRuntime(
  starts: StartOptions[],
  resumes: ResumeOptions[],
  options: ConstructorParameters<typeof FakeRuntime>[1],
): FakeRuntime {
  const runtime = new FakeRuntime('claude', options)
  const start = runtime.start.bind(runtime)
  const resume = runtime.resume.bind(runtime)
  runtime.start = async (opts) => {
    starts.push(opts)
    return start(opts)
  }
  runtime.resume = async (ref, opts) => {
    resumes.push(opts)
    return resume(ref, opts)
  }
  return runtime
}

describe('347 · the five tools', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let host: RuntimeHost
  let store: SessionStore
  let starts: StartOptions[]
  let resumes: ResumeOptions[]
  let sessions: FakeProviderSessions
  /**
   * ⛔ **Holds a launch inside `start`, so a RESERVATION can be observed before it registers.**
   *
   * ⚠️ **`null` unless a test asks for one, because a `FakeLaunchGate` holds from the moment it is
   * constructed** — installed for the whole suite it would park the first launch of every test.
   */
  let gate: FakeLaunchGate | null
  let counter: number
  let window: RecordingSink
  let clock: number
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-tools-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-tools-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 2_000_000
    store = createSessionStore(db, tick)
    counter = 0
    starts = []
    resumes = []
    sessions = new FakeProviderSessions()
    gate = null
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      // ⚑ A fresh adapter per launch sharing ONE session ledger — the shape a resume needs, and
      // what lets a gate be installed for one launch rather than for the whole suite.
      createRuntime: () =>
        watchingRuntime(starts, resumes, { sessions, ...(gate === null ? {} : { gate }) }),
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
    rmSync(userData, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  const personOpens = async (
    profileId: string,
    options: { approvalMode?: 'ask' | 'auto' } = {},
  ): Promise<string> => {
    const { sessionId } = await host.createSession(
      {
        provider: 'claude',
        profileId,
        cwd: work,
        approvalMode: options.approvalMode ?? 'ask',
      },
      window,
    )
    return sessionId
  }

  /** An identity exists only once a person has run a conversation as it — 341 criterion 12. */
  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens(profileId)
    await host.close(id, window)
  }

  /**
   * 🔴 **549 · a stranger has to be MADE one now** (HO-058 §1).
   *
   * ⛔ **`can_message` ruled to `same-project` from `341` until `549`**, so an identity that had
   * been granted nothing reached only what it had started — which is what every *"a stranger sees
   * neither"* assertion in this file was measuring. ⚑ **The ruled default is `any` now**, and the
   * narrowed word is a thing a PERSON sets.
   *
   * ⚠️ **So the sections below narrow the stranger explicitly rather than being deleted** (standing
   * rule 26: strip AND re-aim). ⛔ **Each one still measures the same rail**; what moved is who
   * holds the value that reaches it. 🔴 **That the DEFAULT no longer reaches it is measured in
   * `two-withdrawals-open-what-was-scoped.test.ts`, which is where the widening belongs.**
   *
   * ⚑ **D-016 · narrowed to `none`**, because `same-project` went with projects. ⛔ At `none` what a
   * caller may SEE is exactly what it commands — `withinMessagingReach` asks `mayCommand` before the
   * grant — so a card or a list read here is a `mayCommand` probe; ⚠️ but `message_agent` at `none`
   * is refused by its standing wall (`486`) for every target, its own children included.
   */
  const narrowedToNone = (profileId: string): void => {
    expect(store.setCapabilities(profileId, { canMessage: 'none' })).toBe(true)
  }

  /**
   * The ledger's event kinds for one session.
   *
   * ⚠️ **A named helper because the first version of this file read `.type` off the ROW** — a
   * `PersistedEvent` is `{ordinal, at, event}`, so every element was `undefined` and the negative
   * assertion below (*"the child was sent nothing"*) passed over a list of nothing. It is now paired
   * with a positive that would fail the same way.
   */
  const eventKinds = (sessionId: string): string[] =>
    store.events(sessionId).map((one) => one.event.type)

  /** Spin until a condition holds, bounded — used only to reach a held launch. */
  const until = async (check: () => boolean): Promise<void> => {
    for (let n = 0; n < 200; n += 1) {
      if (check()) return
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error('the launch never reached the gate')
  }

  /**
   * 🔴 **Ask a door while a launch is HELD, and never await the answer before releasing the gate**
   * (`426`'s most actionable finding, landed by `428` §1).
   *
   * ⛔ **The tests below used to `await` the spawn and release the gate on the line after.**
   * That shape only terminates while the rail REFUSES: a give the rail admits goes on to launch,
   * parks at the very gate this test is holding, and the await never returns — so the test hangs
   * rather than failing. ⚠️ **A hang is not a failure**, and it tells a reader nothing about what
   * the rail answered.
   *
   * ⚑ **So the call is started and not awaited, the wait ends on EITHER outcome** — an answer, or a
   * second launch arriving at the gate — **and the release is in a `finally`**, so an assertion that
   * fails still unwinds the launch it was holding.
   */
  const whileALaunchIsHeld = async (
    inFlight: Promise<unknown>,
    ask: () => Promise<Record<string, unknown>>,
    check: (answer: Record<string, unknown> | null) => void,
  ): Promise<Record<string, unknown>> => {
    const heldBefore = gate?.held ?? 0
    let answered: Record<string, unknown> | null = null
    const asked = ask().then((answer) => {
      answered = answer
      return answer
    })
    try {
      await until(() => answered !== null || (gate?.held ?? 0) > heldBefore)
      check(answered)
    } finally {
      gate?.release()
      gate = null
      await Promise.allSettled([inFlight, asked])
    }
    // ⚑ **Settled by the line above**, so this is the answer the release produced — which is what a
    // test of an ADMITTED call needs and a test of a refusal ignores.
    return asked
  }

  /** The toolset one session is offered, called the way a provider would call it. */
  const toolsOf = (sessionId: string) => {
    const set = agentToolsFor(host, sessionId)
    const call = async (name: ToolName, args: Record<string, unknown>) => {
      const tool = set.tools.find((one) => one.name === name)
      if (tool === undefined) throw new Error(`no such tool: ${name}`)
      const answered = await tool.call(args)
      return answered.structured as Record<string, unknown>
    }
    return { set, call }
  }

  /**
   * ⚑ **D-016 · the door that starts a conversation is `give_work`** — a piece, by the agent's
   * profile, with a title and a brief the new conversation takes as its first turn.
   */
  const give = (
    from: string,
    profile: string,
    title = 'A piece',
    more: Record<string, unknown> = {},
  ) =>
    toolsOf(from).call('give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile,
      title,
      brief: `${title}.`,
      ...more,
    })

  /** ⚑ A real macrotask pause, so a negative is measured after whatever was queued has run. */
  const letItSettle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50))

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the five tools, performed
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · an agent creates another agent and talks to it', () => {
    it('⚑ give_work starts a real session, its brief is the first turn, and message_agent reaches it', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')
      const { call } = toolsOf(parent)

      const given = await give(parent, 'worker', 'Do the thing')
      expect(given.outcome).toBe('ok')
      expect(given.started).toBe(true)
      const child = given.agent as string
      // ⛔ **A real session, in the real host** — not a token the tool made up.
      expect(host.sessionIds).toContain(child)

      // ⚑ **D-016 · the brief is the new conversation's FIRST turn** — it was *create-only, sent
      // nothing* until `give_work` replaced `spawn_agent` — and it carries the piece and its label.
      // ⚑ **Paired with a positive over the same list**, so the reader is not broken.
      const briefs = store
        .events(child)
        .flatMap((row) => (row.event.type === 'user_turn' ? [row.event] : []))
      expect(briefs).toHaveLength(1)
      expect(briefs[0]).toMatchObject({ piece: given.piece, label: given.label })

      // ⚠️ The child runs in `ask` and its brief turn waits on a card, so a follow-up is HELD.
      const said = await call('message_agent', {
        agent: child,
        text: 'please begin',
        kind: 'follow-up',
        piece: given.label,
      })
      expect(said.outcome).toBe('ok')
      expect(said.delivery).toBe('queued')
      expect(eventKinds(child)).toContain('message_queued')
    })

    it('🔴 the give is recorded: the conversation’s parent, and the piece it holds', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')
      const given = await give(parent, 'worker', 'The recorded title')
      const child = given.agent as string

      // ⚑ **D-016 · the parent is the conversation's row, and the WHY is the piece** — the spawn
      // reason and its admission stamp went with `spawn_agent`.
      expect(store.parentOf(child)).toBe(parent)
      const root = store.rootOf(parent)
      expect(given.label).toBe(`${String(root?.label)}.1`)
      expect(store.workById(given.piece as string)).toMatchObject({
        parent: root?.piece,
        label: given.label,
        owner: child,
        givenBy: parent,
        title: 'The recorded title',
        brief: 'The recorded title.',
      })
      // ⚑ **Written once the brief arrived** (R4) — after the conversation's own row.
      expect(store.workById(given.piece as string)!.createdAt).toBeGreaterThan(
        store.find(child)!.createdAt,
      )
    })

    it('⛔ list_agents shows the caller and its children, and a stranger sees neither', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')
      const child = (await give(parent, 'worker')).agent as string

      const mine = (await toolsOf(parent).call('list_agents', {})).agents as { agent: string }[]
      const ids = mine.map((one) => one.agent)
      expect(ids).toContain(parent)
      expect(ids).toContain(child)

      // ⛔ **The positive above differs from the default**: a second agent, entitled to nothing,
      // asks the very same reader and sees only itself — so "contains parent and child" is a fact
      // about entitlement rather than about the reader returning everything it can find.
      const stranger = await personOpens('nosy')
      // ⚑ **549 · narrowed, because the ruled default is `any`** — see {@link narrowedToNone}.
      narrowedToNone('nosy')
      const theirs = (await toolsOf(stranger).call('list_agents', {})).agents as { agent: string }[]
      expect(theirs.map((one) => one.agent)).toEqual([stranger])
    })

    it('⚠️ get_agent_status reports the child, and refuses a session the caller may not reach', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')
      const child = (await give(parent, 'worker')).agent as string

      const status = await toolsOf(parent).call('get_agent_status', { agent: child })
      expect(status.outcome).toBe('ok')
      const card = status.agent as Record<string, unknown>
      expect(card.agent).toBe(child)
      // 🔴 **610 · the identity by NAME and by slug** — see `AgentCard.whose`.
      //
      // ⛔ **`Ada` is not a fixture this test planted.** ⚑ A launch MINTS a display name for a new
      // identity — `session-store.ts`'s `nameForANewIdentity`, `584` — and `Ada` is the first free
      // handle in `HUMAN_NAMES`. ⚠️ **So this row is the whole of `HO-092` §1**: the app has known
      // this agent's name since its first launch, and until `610` the card said `worker`.
      expect(card.whose).toEqual({
        is: 'an-identity-this-app-holds',
        profile: 'worker',
        name: 'Ada',
      })
      expect(card.parent).toBe(parent)
      // ⚑ **D-016 · its brief is its first turn**, and in `ask` that turn waits on a card — so the
      // card says the person is needed, where a child spawned idle said `idle`.
      expect(card.state).toBe('needs you')

      const stranger = await personOpens('nosy')
      // ⚑ **549 · narrowed, because the ruled default is `any`** — see {@link narrowedToNone}.
      narrowedToNone('nosy')
      const refused = await toolsOf(stranger).call('get_agent_status', { agent: child })
      expect(refused.outcome).toBe('refused')
      // ⚑ **D-017 · R12 — an id that EXISTS and is out of reach gets the reach rail `message_agent`
      // meets**, at every door that takes an id; `no-such-agent` is said only about an id no
      // conversation has (`05` rule 6).
      expect(refused.rail).toBe('may-not-message')
      const toldByTheMessageDoor = await toolsOf(stranger).call('message_agent', {
        kind: 'note',
        agent: child,
        text: 'hello',
      })
      expect(toldByTheMessageDoor.rail).toBe(refused.rail)

      // ⛔ **An id that was never a session answers `no-such-agent`**, and the reader returns rather
      // than throwing. ⚑ D-017 · R12 — the two shapes differ now, by ruling: `341`'s *answer them
      // identically* went with the rule that hid which ids exist.
      const ghost = await toolsOf(stranger).call('get_agent_status', { agent: 'sess_never' })
      expect(ghost.outcome).toBe('refused')
      expect(ghost.rail).toBe('no-such-agent')
      expect(ghost.reason).not.toBe(refused.reason)
    })

    // ⚑ **D-017 · commit 3** — `end_agent` is gone (nothing ends a conversation), and with it the two
    // tests of it that stood here: *it ends a child, and answers a stranger and a ghost the same
    // way* and *it does not report `ended` for a session this host never held*.
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the rails refuse, and the tools carry the refusal unchanged
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the tools add no rail', () => {
    it('🔴 a give deeper than a person allowed is refused by the RAIL, with the rail`s own words', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')
      // ⛔ **D-014 · any agent may give work to any other**, so the wall here is one a person built:
      // `max_depth` 0 on the caller, whose piece would sit at depth 1 under its root.
      expect(store.setCapabilities('pm', { maxDepth: 0 })).toBe(true)
      const refused = await give(parent, 'worker')
      expect(refused.outcome).toBe('refused')
      expect(refused.rail).toBe('too-deep')
      // ⚑ Carried unchanged: permanence and retryability are the rail's, re-derived from its name.
      expect(refused.permanence).toBe(permanenceOf('too-deep'))
      expect(refused.retryable).toBe(retryableOf('too-deep'))
      // ⛔ …and nothing was created.
      expect(host.sessionIds).toHaveLength(1)
    })

    it('⚠️ an unknown profile is refused, and a caller too deep to give is told its depth first', async () => {
      const parent = await personOpens('pm')
      const refused = await give(parent, 'ghost')
      // ⚑ **341's entitlement-before-existence, seen from the tool.** Nothing stands between this
      // caller and a name, and the identity does not exist, so this is `no-such-profile` (R3) — but
      // a caller a person held at `max_depth` 0 asking about the same absent name gets `too-deep`
      // instead: the rail about the CALLER answers before the one about the name.
      expect(refused.rail).toBe('no-such-profile')
      const blind = await personOpens('other')
      expect(store.setCapabilities('other', { maxDepth: 0 })).toBe(true)
      const blindly = await give(blind, 'ghost')
      expect(blindly.rail).toBe('too-deep')
    })

    it('🔴 a caller cannot name somebody else`s session or piece as the parent of its give', async () => {
      // ⛔ **The argument that must not exist.** The giver is the conversation the tool was built
      // for, and there is no way to say otherwise — so an attempt to supply a parent is an
      // undocumented key and dies on the first rail.
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')
      const victim = await personOpens('victim')
      const refused = await give(parent, 'worker', 'x', {
        parent: victim,
        parentSessionId: victim,
      })
      expect(refused.outcome).toBe('refused')
      expect(refused.rail).toBe('malformed-request')

      // ⛔ **And the SECOND defence, measured rather than assumed.** ⚑ **D-016** — the one parent a
      // give CAN name is a piece, and naming the victim's root is refused as a piece this caller
      // does not hold: not yours and not found are one answer.
      const redirected = await give(parent, 'worker', 'x', { piece: store.rootOf(victim)?.label })
      expect(redirected).toMatchObject({
        outcome: 'refused',
        rail: 'no-piece-you-hold-by-that-name',
      })

      // ⚑ **And the positive that makes both mean something**: the same give WITHOUT the smuggled
      // key succeeds, and the row it writes names the caller — never the session it named.
      const ok = await give(parent, 'worker', 'x')
      expect(ok.outcome).toBe('ok')
      expect(store.parentOf(ok.agent as string)).toBe(parent)
      expect(store.workById(ok.piece as string)?.parent).toBe(store.rootOf(parent)?.piece)
    })

    it('⛔ an undocumented key is REFUSED rather than stripped (303 B)', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')
      const refused = await give(parent, 'worker', 'x', {
        // A key neither the tool nor the door knows about. It must reach the door and be named.
        priority: 'urgent',
      })
      expect(refused.outcome).toBe('refused')
      expect(refused.rail).toBe('malformed-request')
      expect(host.sessionIds).toHaveLength(1)
    })

    it('🔴 a give may never start a conversation WIDER than its giver, and an `auto` giver hands it down (499)', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm', { approvalMode: 'ask' })
      // ⛔ **D-016 · a give carries no approval mode** — the conversation it starts runs in its
      // giver's — so asking for one is an undocumented key, refused by name.
      const refused = await give(parent, 'worker', 'x', { approval_mode: 'auto' })
      expect(refused.rail).toBe('malformed-request')

      // An `auto` giver passes `auto` to its helper. Testing only an `ask` giver cannot
      // establish mode inheritance for yolo work.
      const boss = await personOpens('boss', { approvalMode: 'auto' })
      await bringIdentityIntoBeing('worker2')
      const inherited = await give(boss, 'worker2')
      expect(inherited.outcome).toBe('ok')
      expect(store.find(inherited.agent as string)?.approvalMode).toBe('auto')

      // ⛔ **…and never WIDER, which the rail weighs on the agent's own provider**
      // (`wider-than-its-parent`). 🔴 **D-038 moved this fact (F050)**: the rail compares REACH —
      // what each side keeps between a write or a command past its folder and that act running
      // unasked — and Codex `auto` keeps nothing there, as Claude `auto` keeps nothing. It was
      // refused here for the sandbox Codex's `auto` takes off; ⚑ it is GIVEN now, and runs in `auto`.
      await bringIdentityIntoBeing('worker3')
      expect(store.setAgentProvider('worker3', 'codex')).toBe(true)
      const startsBefore = starts.length
      const onCodex = await give(boss, 'worker3')
      expect(onCodex).toMatchObject({ outcome: 'ok', started: true, delivery: 'sent' })
      expect(host.sessionIds).toContain(onCodex.agent)
      expect(store.find(onCodex.agent as string)).toMatchObject({
        approvalMode: 'auto',
        provider: 'codex',
      })
      // ⚑ …and the launch itself was asked for in `auto` — the mode the provider runs, not a row.
      expect(starts.slice(startsBefore).map((one) => one.approvalMode)).toEqual(['auto'])
      // ⚑ **The paired positive, one fact over**: the same identity from an `ask` giver is admitted,
      // and runs in `ask`.
      const allowed = await give(parent, 'worker3')
      expect(allowed.outcome).toBe('ok')
      expect(store.find(allowed.agent as string)?.approvalMode).toBe('ask')
      // 🔴 **…and WIDER is still refused, where it can be: an `ask` giver's `auto` child.** ⚠️ No give
      // reaches it — a give carries no mode (the `approval_mode` refused above), so a same-mode pair
      // is never wider (D-038 F-B) — so the rail's own comparison is asked, the one the door calls.
      expect(
        whatTheChildWouldLack(
          { provider: 'codex', approvalMode: 'auto' },
          { provider: 'claude', approvalMode: 'ask' },
        ),
      ).toEqual(['the-card-before-an-act'])
    })

    it('⚠️ a permanent refusal answers the same way however many times it is retried', async () => {
      const parent = await personOpens('pm')
      const rails: unknown[] = []
      for (let attempt = 0; attempt < 5; attempt += 1) {
        rails.push((await give(parent, 'ghost')).rail)
      }
      // ⚑ **D-016 · a name nobody holds** — the give rail that is `permanent`, so the premise of
      // the title is asserted rather than assumed.
      expect(permanenceOf('no-such-profile')).toBe('permanent')
      expect(rails).toEqual(Array.from({ length: 5 }, () => 'no-such-profile'))
      // ⛔ **What must never happen is a retry that SUCCEEDS.** Only the parent exists.
      expect(host.sessionIds).toHaveLength(1)
    })

    it('⛔ a refusal is a SUCCESSFUL call: no tool throws, on any path', async () => {
      const parent = await personOpens('pm')
      const { set } = toolsOf(parent)
      // Every tool, called with arguments guaranteed to be wrong for it.
      for (const tool of set.tools) {
        await expect(tool.call({ nonsense: true })).resolves.toBeDefined()
        await expect(tool.call({})).resolves.toBeDefined()
      }
    })

    it('🔴 message_agent to a stranger refuses instead of throwing the host`s sentence', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')
      const child = (await give(parent, 'worker')).agent as string
      const stranger = await personOpens('nosy')
      // ⚑ **549 · narrowed, because the ruled default is `any`** — see {@link narrowedToNone}.
      narrowedToNone('nosy')
      const refused = await toolsOf(stranger).call('message_agent', {
        kind: 'note',
        agent: child,
        text: 'hello',
      })
      expect(refused.outcome).toBe('refused')
      // ⚑ **D-017 · R12** — the child exists, so the stranger meets the reach rail, not `no-such-agent`.
      expect(refused.rail).toBe('may-not-message')
      // ⚑ …and the child was told nothing: its one turn is the brief it was given.
      expect(eventKinds(child).filter((kind) => kind === 'user_turn')).toHaveLength(1)
      expect(eventKinds(child)).not.toContain('message_queued')
    })

    it('⛔ 424 · a self-message is refused BY NAME and is not retryable — `422`’s finding, closed', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')
      const { call } = toolsOf(parent)

      // ⛔ **A real id the tool itself advertises.** `list_agents` deliberately includes the caller,
      // and `message_agent`'s precheck deliberately admits `me`, so this is not a malformed call or
      // an invented identifier. The later host gate is the one that refuses it.
      //
      // ⚠️ **That precheck is `withinMessagingReach` since `431` and was `agentCard`** — the reader
      // changed and the `me` clause did not, which is what keeps this refusal reachable. ⛔ The
      // host's own gate has no `me` and refuses a conversation queueing words into itself, so the
      // clause is a disclosure allowance at the door rather than an entitlement.
      const listed = (await call('list_agents', {})).agents as { agent: string }[]
      expect(listed.map((one) => one.agent)).toContain(parent)
      const sameCall = { agent: parent, text: 'keep this for me', kind: 'note' }
      const refused = await call('message_agent', sameCall)
      // 🔴 **`422` measured this arriving as `agent-cannot-take-a-message · while-this-holds ·
      // retryable: true`** — a real, advertised id, refused for ever, with *"come back later"*
      // written on it. ⛔ `424` split the arm out: the rail names what is actually wrong, and the
      // permanence says that no later moment is different.
      expect(refused).toMatchObject({
        outcome: 'refused',
        rail: 'that-agent-is-you',
        permanence: 'permanent',
        retryable: false,
      })
      // ⚠️ **And it does not say the receiver is busy**, which is the sentence the old fold gave a
      // caller about itself — a reason answering with another reason's sentence (340's finding).
      expect(String(refused.reason)).not.toContain('not in a state')

      // 🔴 **The identical call, again.** Nothing about the world moved, and the answer is the same
      // one — which is now what the payload SAYS will happen rather than the opposite of it.
      expect(await call('message_agent', sameCall)).toMatchObject({
        outcome: 'refused',
        rail: 'that-agent-is-you',
        permanence: 'permanent',
        retryable: false,
      })

      // ⚑ **One entitlement fact over, the same gesture lands.** A child this caller commands is the
      // ordinary positive; a blanket implementation that refused every message would fail here.
      const child = (await give(parent, 'worker', 'Receive the same words')).agent as string
      expect(await call('message_agent', { ...sameCall, agent: child })).toMatchObject({
        outcome: 'ok',
        agent: child,
      })
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the race 341 named, closed
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · two gives in one tick', () => {
    /** ⚑ Every brief a conversation was handed — sent as a turn, or held behind one — by its piece. */
    const briefsIn = (sessionId: string): string[] =>
      store
        .events(sessionId)
        .flatMap((row) =>
          (row.event.type === 'user_turn' || row.event.type === 'message_queued') &&
          typeof row.event.piece === 'string'
            ? [row.event.piece]
            : [],
        )

    it('🔴 ONE giver giving one identity twice in the same tick: ONE conversation, and both pieces reach it', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')
      const before = host.sessionIds.length

      // ⛔ **Issued together, with nothing awaited between them** — Codex makes parallel tool calls.
      // ⚑ **D-016 · R2 — the lookup and the start are one synchronous stretch**: the first give
      // reserves its conversation before its first `await`, so the second FINDS that reservation
      // and joins its line rather than starting a second conversation. It was `profile-already-live`
      // for the loser until `give_work` replaced `spawn_agent`.
      const [first, second] = await Promise.all([
        give(parent, 'worker', 'Piece a'),
        give(parent, 'worker', 'Piece b'),
      ])
      expect([first.outcome, second.outcome]).toEqual(['ok', 'ok'])
      expect(second.agent).toBe(first.agent)
      // ⚑ **Exactly one of them started it**, and one conversation was added.
      expect([first.started, second.started].sort()).toEqual([false, true])
      expect(host.sessionIds).toHaveLength(before + 1)
      // ⚑ **Two pieces, two numbers** — their order is not promised; their numbers are (R4).
      expect(first.label).not.toBe(second.label)
      const child = first.agent as string
      expect(
        store
          .piecesOwnedBy(child)
          .map((one) => one.piece)
          .sort(),
      ).toEqual([first.piece, second.piece].sort())
      // ⛔ **…and both BRIEFS arrived**, the one it started with and the one held behind it.
      expect(briefsIn(child).sort()).toEqual([first.piece, second.piece].sort())
    })

    it('⚑ 428 · …and TWO givers giving one identity in the same tick each get their OWN conversation', async () => {
      // 🔴 **HO-023 §4 in one call** — *"Two different parents, in the same project or different
      // ones, is demand."* ⚑ D-016: one conversation per helper per GIVER.
      await bringIdentityIntoBeing('worker')
      const a = await personOpens('pm-a')
      const b = await personOpens('pm-b')

      const [first, second] = await Promise.all([
        give(a, 'worker', 'For a'),
        give(b, 'worker', 'For b'),
      ])
      expect([first.outcome, second.outcome]).toEqual(['ok', 'ok'])
      // ⚑ **Both LIVE, at the same moment, as the same identity** — and both started.
      expect(first.agent).not.toBe(second.agent)
      expect([first.started, second.started]).toEqual([true, true])
      expect(host.sessionIds).toContain(first.agent)
      expect(host.sessionIds).toContain(second.agent)
      // ⛔ **…and the lookup is keyed on the giver.** `a`'s next give reaches `a`'s conversation —
      // busy on its first brief, so it is held there — never `b`'s and never a third.
      const again = await give(a, 'worker', 'A second for a')
      expect(again).toMatchObject({ outcome: 'ok', agent: first.agent, started: false })
      expect(again.delivery).toBe('held')
    })

    it('🔴 a launch still IN FLIGHT is found by the lookup, before it has registered', async () => {
      // ⛔ **The reservation window itself, held open.** The first give's launch is parked inside
      // `start`: reserved, not registered, no row — the state where the reservation's own
      // `profileId` is the ONLY thing that can answer.
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')

      gate = new FakeLaunchGate()
      const inFlight = give(parent, 'worker', 'The first, parked inside start')
      await until(() => (gate?.held ?? 0) > 0)

      let answered: Record<string, unknown> | null = null
      const racing = give(parent, 'worker', 'Racing a launch that has not landed').then(
        (answer) => {
          answered = answer
          return answer
        },
      )
      try {
        await letItSettle()
        // ⚑ **No second launch, and no answer yet**: the second give found the reservation and
        // waits in its line for the start it is riding on.
        expect(gate?.held).toBe(1)
        expect(answered).toBeNull()
      } finally {
        gate?.release()
        gate = null
      }
      const [first, second] = await Promise.all([inFlight, racing])
      expect(second).toMatchObject({ outcome: 'ok', agent: first.agent, started: false })
      expect(first.started).toBe(true)
    })

    it('⛔ …and an unnamed launch in flight already names the seeded profile, and is not the giver’s', async () => {
      // ⚠️ **The default is applied at the RESERVATION or it is applied too late.** A person opening
      // a conversation without naming a profile gets `default`, and until it registers the only
      // record of that is the reservation's own resolved value.
      //
      // 🔴 **A person's launch has no giver**, so the lookup never finds it — and the resolution it
      // is here to measure is read where it actually lives, on the card, which takes the same pair
      // in the same order the lookup does (`slot.profileId ?? slot.session?.profileId`).
      await bringIdentityIntoBeing(DEFAULT_PROFILE_ID)
      const parent = await personOpens('pm')

      gate = new FakeLaunchGate()
      const byAPerson = host.createSession({ provider: 'claude', cwd: work }, window)
      await until(() => (gate?.held ?? 0) > 0)

      // ⚑ **Reserved, not registered — and already named.** ⚑ **D-017 · R11** — a launch in
      // flight is `active`, and it is the only one here (the parent has no turn, and the closed
      // `default` conversation is idle).
      const starting = host
        .agentsVisibleTo({ ownerId: window.ownerId }, null)
        .agents.filter((one) => one.state.is === 'active')
      expect(starting).toHaveLength(1)
      expect(starting[0]?.whose).toEqual({
        is: 'an-identity-this-app-holds',
        profile: DEFAULT_PROFILE_ID,
        name: DEFAULT_PROFILE_LABEL,
      })

      // ⛔ **…and the give STARTS its own** (HO-023 §4). It never answers while the gate is held,
      // because it went to the same gate — the shape `whileALaunchIsHeld` makes legible.
      const admitted = await whileALaunchIsHeld(
        byAPerson,
        () => give(parent, DEFAULT_PROFILE_ID, 'Racing an unnamed launch'),
        (answer) => {
          expect(answer).toBeNull()
        },
      )
      expect(admitted).toMatchObject({ outcome: 'ok', started: true })
      const theirs = (await byAPerson).sessionId
      expect(admitted.agent).not.toBe(theirs)

      // ⚑ **The paired positive, one fact over: the giver's next give reaches ITS conversation** —
      // and the person's `default` conversation is still live beside it.
      const again = await give(parent, DEFAULT_PROFILE_ID, 'A second of my own')
      expect(again).toMatchObject({ outcome: 'ok', agent: admitted.agent, started: false })
      expect(host.sessionIds).toContain(theirs)
    })

    it('⚠️ a REOPEN in flight is found by the lookup as well — and it remembers whose child it was', async () => {
      // 🔴 **Two facts in one fixture.** The reopened conversation is one this giver started,
      // stopped, and a WINDOW is putting back — so the lookup finds the reservation only because
      // `373` re-derives `spawnedBy` from the ledger at the resume's own reservation.
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')
      const given = await give(parent, 'worker', 'One to stop and reopen')
      expect(given.outcome).toBe('ok')
      const recorded = given.agent as string
      // ⚠️ **D-016c · it answers its piece before it is stopped.** A stop moves no piece, so a piece
      // the Close's interrupted turn left open stalls, and a give to its holder is refused
      // `its-work-has-stalled` — while it is stopped, reopening or running — until it is answered,
      // closed or taken back. ⚑ Answered by the holder itself, so nothing is held for its next
      // start.
      expect(
        await toolsOf(recorded).call('reply_to_parent', {
          piece: given.piece,
          outcome: 'done',
          summary: 'Done.',
        }),
      ).toMatchObject({ outcome: 'ok' })
      // ⛔ **Stopped by the app, not through the window.** A conversation a give started is owned by
      // nobody (336), so `host.close` from this window would be refused.
      await host.close(recorded, THE_APP_ITSELF)
      expect(host.sessionIds).not.toContain(recorded)

      gate = new FakeLaunchGate()
      const reopening = host.resumeSession(recorded, new RecordingSink('webContents:3'))
      await until(() => (gate?.held ?? 0) > 0)

      let answered: Record<string, unknown> | null = null
      const racing = give(parent, 'worker', 'Racing a reopen').then((answer) => {
        answered = answer
        return answer
      })
      try {
        await letItSettle()
        // ⚑ **No second launch**: the give found the reopening conversation and waits for it.
        expect(gate?.held).toBe(1)
      } finally {
        gate?.release()
        gate = null
      }
      await reopening
      const second = await racing
      expect(answered).not.toBeNull()
      // ⚑ **It reached the conversation the giver has**, once the reopen landed — never a second.
      expect(second).toMatchObject({ outcome: 'ok', agent: recorded, started: false })
      expect(host.sessionIds.filter((id) => id !== parent)).toEqual([recorded])
    })

    it('⚠️ …and the same pair for two DIFFERENT identities are both started', async () => {
      // ⛔ The control. Without it, a give that simply refused every concurrent pair would pass
      // the tests above.
      await bringIdentityIntoBeing('one')
      await bringIdentityIntoBeing('two')
      const a = await personOpens('pm-a')
      const b = await personOpens('pm-b')
      const [first, second] = await Promise.all([give(a, 'one', 'a'), give(b, 'two', 'b')])
      expect([first.outcome, second.outcome]).toEqual(['ok', 'ok'])
      expect([first.started, second.started]).toEqual([true, true])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3.1 · 428 · the key, landed on the four cases 426 pinned
  // ───────────────────────────────────────────────────────────────────────────────────────────

  /**
   * 🔴 **`426` wrote these four as executed assertions of the WRONG answer**, so that the re-key
   * would turn them red rather than have to be remembered; `428` brought each to HO-023 §4's answer
   * with its paired control.
   *
   * ⚑ **D-016 · the rail they measured is gone, and the KEY is what stands**: a giver's second give
   * of one identity is not refused — it REACHES the conversation that giver already has, which is
   * one conversation per helper per giver. So each case now asks where the give went.
   */
  describe('§3.1 · 428 · the four cases 426 pinned, brought to the key', () => {
    const recordedSessions = (): number =>
      (db.prepare('SELECT count(*) AS n FROM provider_session').get() as { n: number }).n

    it('⚑ 428 · two givers each get their own conversation of one identity', async () => {
      await bringIdentityIntoBeing('worker')
      await bringIdentityIntoBeing('other-worker')
      const here = await personOpens('pm-a')
      const there = await personOpens('pm-b')

      const first = await give(here, 'worker', 'Work for the first giver')
      expect(first.outcome).toBe('ok')
      const child = first.agent as string

      // 🔴 **`426` pinned this as a REFUSAL and HO-023 §4 is why it is not one** — *"Two different
      // parents, in the same project or different ones, is demand."*
      const alsoThere = await give(there, 'worker', 'Same identity for the second giver')
      expect(alsoThere).toMatchObject({ outcome: 'ok', started: true })
      const sibling = alsoThere.agent as string
      // ⚑ **Two live conversations of one identity, at the same moment.**
      expect(host.sessionIds).toContain(child)
      expect(host.sessionIds).toContain(sibling)

      // ⛔ **`422`'s entitlement fact is UNCHANGED.** The other giver's child is not this caller's
      // to follow up: a follow-up must name a piece the sender gave THAT agent, and the piece
      // `there` gave went to its own conversation.
      expect(
        await toolsOf(there).call('message_agent', {
          agent: child,
          text: 'can we coordinate?',
          kind: 'follow-up',
          piece: alsoThere.label,
        }),
      ).toMatchObject({ outcome: 'refused', rail: 'not-a-piece-you-gave' })

      // ⚑ **The key stands on the giver** — `there`'s next give reaches `there`'s conversation.
      const again = await give(there, 'worker', 'A second one over there')
      expect(again).toMatchObject({ outcome: 'ok', agent: sibling, started: false })
      expect(
        await toolsOf(there).call('message_agent', {
          agent: sibling,
          text: 'carry on',
          kind: 'follow-up',
          piece: alsoThere.label,
        }),
      ).toMatchObject({ outcome: 'ok' })

      const oneFactOver = await give(there, 'other-worker', 'Different identity, same two givers')
      expect(oneFactOver).toMatchObject({ outcome: 'ok', started: true })
      expect(host.sessionIds).toContain(child)
    })

    it('⚑ one giver’s second give of one identity reaches the conversation it has — not a different identity, and not a person’s', async () => {
      await bringIdentityIntoBeing('worker')
      await bringIdentityIntoBeing('other-worker')
      const parent = await personOpens('pm')
      const call = toolsOf(parent).call

      const first = await give(parent, 'worker', 'First')
      expect(first.outcome).toBe('ok')
      const child = first.agent as string
      const second = await give(parent, 'worker', 'Second')
      expect(second).toMatchObject({ outcome: 'ok', agent: child, started: false })
      expect(await call('get_agent_status', { agent: child })).toMatchObject({ outcome: 'ok' })
      expect(
        await call('message_agent', {
          agent: child,
          text: 'continue the first piece',
          kind: 'follow-up',
          piece: first.label,
        }),
      ).toMatchObject({ outcome: 'ok' })

      const oneFactOver = await give(parent, 'other-worker', 'Different identity')
      expect(oneFactOver).toMatchObject({ outcome: 'ok', started: true })
      expect(oneFactOver.agent).not.toBe(child)

      // The lookup binds an agent's give, not the person's New-conversation door.
      const human = await personOpens('worker')
      expect(human).not.toBe(child)
      expect(host.sessionIds).toContain(child)
      expect(host.sessionIds).toContain(human)
    })

    it('🔴 a same-giver reservation is FOUND; two givers’ reservations are each their own', async () => {
      await bringIdentityIntoBeing('worker')
      const here = await personOpens('pm-a')
      const there = await personOpens('pm-b')
      const third = await personOpens('pm-c')

      const heldPair = async (a: string, b: string, expected: 'one start' | 'two starts') => {
        gate = new FakeLaunchGate()
        const before = recordedSessions()
        let secondAnswer: Record<string, unknown> | null = null
        // No await between calls: the first reserves its slot before the second asks the lookup.
        const first = give(a, 'worker', 'First')
        const second = give(b, 'worker', 'Second').then((answer) => {
          secondAnswer = answer
          return answer
        })
        try {
          await until(() => (gate?.held ?? 0) > 0)
          await letItSettle()
          // Neither child has a committed ledger row while its provider launch is held.
          expect(recordedSessions()).toBe(before)
          // ⛔ **Neither answered**: a give answers once its brief has gone.
          expect(secondAnswer).toBeNull()
          // ⚑ The same giver's second give found the reservation and launched nothing; two givers'
          // gives are two launches, held at the same instant.
          expect(gate?.held).toBe(expected === 'one start' ? 1 : 2)
        } finally {
          gate?.release()
          gate = null
          await Promise.allSettled([first, second])
        }
        return Promise.all([first, second])
      }

      // The control: a reservation alone, without a provider_session row, is found by the same
      // giver's lookup. A ledger-only lookup that treats no row as nothing would start a second.
      const sameGiver = await heldPair(here, here, 'one start')
      expect(sameGiver.map((one) => one.outcome)).toEqual(['ok', 'ok'])
      expect(sameGiver[1]?.agent).toBe(sameGiver[0]?.agent)

      // 🔴 **`426` pinned this pair as a collision and `428` is what un-collides it.** Two givers,
      // two reservations of one identity held at the same instant — and each is its own.
      const twoGivers = await heldPair(there, third, 'two starts')
      expect(twoGivers.map((one) => one.outcome)).toEqual(['ok', 'ok'])
      expect(twoGivers[1]?.agent).not.toBe(twoGivers[0]?.agent)
    })

    it('🔴 428 · a person’s conversation of that identity is never the one a give reaches', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')
      const call = toolsOf(parent).call
      const personHeld = await personOpens('worker')

      // ⛔ **`428` §2's fourth row.** A person talking to `worker` is not this giver's child, so the
      // lookup does not find it: the give starts the giver's own.
      const given = await give(parent, 'worker', 'While a person is talking to this identity')
      expect(given).toMatchObject({ outcome: 'ok', started: true })
      const child = given.agent as string
      // ⚑ **Both live at once**, and the person's is not one this giver may follow up.
      expect(host.sessionIds).toContain(personHeld)
      expect(host.sessionIds).toContain(child)
      expect(
        await call('message_agent', {
          agent: personHeld,
          text: 'take this',
          kind: 'follow-up',
          piece: given.label,
        }),
      ).toMatchObject({ outcome: 'refused', rail: 'not-a-piece-you-gave' })

      // 🔴 **The paired positive, one fact over: the next give reaches the child this giver has**,
      // and never the person's.
      const again = await give(parent, 'worker', 'Again')
      expect(again).toMatchObject({ outcome: 'ok', agent: child, started: false })
      expect(again.agent).not.toBe(personHeld)
      expect(await call('get_agent_status', { agent: child })).toMatchObject({ outcome: 'ok' })
      expect(
        await call('message_agent', {
          agent: child,
          text: 'carry on',
          kind: 'follow-up',
          piece: given.label,
        }),
      ).toMatchObject({ outcome: 'ok' })
    })

    // ⚑ **D-016 · `the one blocker that is NOT reachable is the app's own` is deleted**: this app
    // gives no work of its own (`giveWork` answers {@link THE_APP_ITSELF} as no giver), so there is
    // no conversation it starts on a giver's behalf for that giver's lookup to find.
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the seam: the tools reach the provider, on start AND on resume
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · a resumed agent does not silently lose its tools', () => {
    it('🔴 the toolset is handed to the adapter on start and again on resume (307)', async () => {
      const id = await personOpens('pm')
      const started = starts.at(-1)
      expect(started?.agentTools?.server).toBe('brobot')
      expect(started?.agentTools?.tools.map((one) => one.name)).toEqual([...TOOL_NAMES])

      await host.close(id, window)
      resumes.length = 0
      await host.resumeSession(id, new RecordingSink('webContents:2'))
      // ⛔ **This is the assertion §3 of the brief exists for.** Codex re-reads a file; Claude must
      // be handed the option again. A resume that dropped it would be invisible in every transcript.
      const resumed = resumes.at(-1)
      expect(resumed?.agentTools?.tools.map((one) => one.name)).toEqual([...TOOL_NAMES])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · the vocabulary, and criterion 6's negative
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · what is published, and what is not', () => {
    it('⛔ the inventory is exactly the published list, and criterion 6 is measured against it', () => {
      const parent = 'sess_x'
      const offered = agentToolsFor(host, parent).tools.map((one) => one.name)
      // ⚑ **The search SHAPE**: the claim is not "we found no dispatch tool" but "the published
      // inventory is exactly this list", which a tool called `assign_work`, `delegate`, `hand_off`
      // or `enqueue_task` would break just as loudly as one called `dispatch`.
      expect(offered).toEqual([...TOOL_NAMES])
      // ⚠️ **THIRTEEN since `429` added `withdraw_task`, and this file keeps its name.** The count is
      // the only line here that has ever had to move — every other assertion is derived from
      // `TOOL_NAMES`, which is what `347` built the constant for. ⛔ Renaming the file would cost
      // five dispatches' citations and the mutation tables' anchors to restate an arithmetic fact
      // the line above already states better than a title can. ⚑ **It is not decoration**: without
      // it, `toEqual([...TOOL_NAMES])` would pass against an empty inventory.
      // ⚑ **Fourteen since `437` published `ask_parent`** — and the module docblock's *"the five
      // tools"* and this file's own name are both stale, which is a finding rather than a rename:
      // the names are how every census in the repo addresses this suite. ⛔ **No arithmetic here**,
      // because the assertion on the next line is the only number worth stating.
      // ⚑ **Fifteen since `439` published `list_projects`.** ⚠️ **And it is the first member whose
      // subject is not a conversation, a document, a task or a question** — see `SUBJECT` below,
      // which gained a seventh value rather than stretching one of the six.
      // ⚑ **`488` published a member whose subject is an IDENTITY** — the first that is not a
      // conversation, a document, a task, a question or a project. See `SUBJECT` below, where it was
      // `'nothing at all'` because it took no argument at all; ⚑ since F009 it names an agent, by
      // its profile, whose record to read.
      //
      // ⛔ **The number below is the ONLY place this file states one, and it is an assertion rather
      // than prose** (`488 relay 1`, `458`'s standing rule). ⚑ It owns exactly one rule, stated four
      // comments up: without it, `toEqual([...TOOL_NAMES])` would pass against an empty inventory.
      // ⚠️ **So it moves with the roster and no sentence beside it names a count.**
      // ⚑ **Twenty since `611` published `pass_question_up`** (HO-088 §3.2) — and `ask_parent`
      // was RENAMED rather than added, so this number moved by one rather than two.
      // ⚑ **Twenty-one since `663` published `resume_agent`** (`HO-018` §2.3's *ask the child to
      // continue*).
      // ⚑ **Twenty-two since D-009 published `withdraw_question`** (F012 ruling 5).
      // ⚑ **Twenty-three since D-012 published `read_transcript`** (proposal §6.5).
      // ⚑ **Twenty-one since D-017 withdrew `end_agent` and `resume_agent`** — nothing ends a
      // conversation, and a message starts a stopped one.
      // ⚑ **Nineteen since D-016 withdrew `list_projects` and `create_project`** — projects went.
      // ⚑ **Twenty since D-016 · commit 6 published `take_on_work`** — a request the person makes,
      // taken on as a piece under the caller's own root.
      // ⚑ **Twenty-one since D-037 published `find_files`** — the files kept on the caller's tree
      // or everywhere.
      // ⚑ `request_mcp_server` asks the person to register an outside MCP server.
      // ⚑ `request_action` asks the person to do something, as a to-do.
      expect(offered).toHaveLength(31)
    })

    it('⚠️ no published tool queues work for an agent to pick up later', () => {
      // ⛔ **A dispatch tool is one that hands work to somebody who is not named yet, or that takes
      // work without naming a recipient.** ⚑ `393` is the first dispatch where *"name an agent"*
      // stopped being the whole test, so the rule is written out as WHAT EACH TOOL NAMES rather than
      // as a chain of exemptions — a `Record` over `ToolName`, so a further tool cannot be added
      // without somebody deciding which of these it is. ⚠️ **Stated without a count**, `396`'s
      // correction: it said *"a ninth"* while ten were published, which reads as though something
      // checked it.
      const SUBJECT: Record<
        ToolName,
        | 'the agent'
        // ⚑ **D-016 · `give_work` names its agent by PROFILE** — the one conversation per helper per
        // giver is found by the app, so the caller names who, never which conversation.
        | 'an agent, by its profile'
        // ⚑ **D-016 · a file kept for a piece** — `read_document` reads a resource by its id.
        | 'a resource'
        | 'a piece it was given'
        // ⚑ **D-016** — `withdraw_task` names the piece it takes back, and no agent.
        | 'a piece it gave'
        // ⚑ **D-016** — `update_work` and `list_tasks` name a piece the caller holds or gave.
        | 'a piece it holds or gave'
        // ⚑ **D-024 · R2 — `list_tasks` reads further than `update_work` changes**: a piece another
        // conversation of the caller's own profile holds or gave is named too. ⛔ Its own word rather
        // than the one above stretched, because `update_work` still reaches only the caller's own.
        | 'a piece it or its profile holds or gave'
        | 'a question it was sent'
        | 'a question it was asked'
        // 🔴 **611 · a question this app ROUTED TO this caller** (HO-088 §3.2) — the subject
        // `pass_question_up` names. ⛔ Not `'a question it was sent'`, which is
        // `answer_question`'s: that one SETTLES the request and this one carries it further, and a
        // table whose job is to say what a verb names may not fold two acts into one word.
        // ⚑ **D-009 · a question the caller ITSELF asked** — the subject `withdraw_question` names.
        | 'a question it asked'
        | 'an agent that does not exist yet'
        | 'nothing at all'
        | 'a theme'
        // A server to register: `request_mcp_server` names the server and who would get it, and
        // hands nobody work.
        | 'a server to register'
      > = {
        list_themes: 'a theme',
        save_theme: 'a theme',
        set_theme: 'a theme',
        list_agents: 'nothing at all',
        get_agent_status: 'the agent',
        // 🔴 **D-016 · it hands work over, and it NAMES who** — by profile, which is why it is not a
        // dispatch tool under the rule above. ⚠️ `new: true` brings that named agent into existence in
        // the same call; the name is still the caller's to give.
        give_work: 'an agent, by its profile',
        message_agent: 'the agent',
        read_document: 'a resource',
        // 🔴 **`reply_to_parent` names NO recipient, and that is the ruling rather than a gap**
        // (HO-015 §1.3). ⛔ It is also why it is not a dispatch tool under the rule above: it does
        // not hand work to anybody, and the conversation it reaches is one that already reached
        // THIS one. A caller cannot compose a call that touches a conversation that has not given
        // it work.
        reply_to_parent: 'a piece it was given',
        // ⚑ **D-016 · a reader of one piece's record, or of the caller's board** — it hands nobody
        // anything to do. ⚑ **D-024 · R2 — or of a piece its profile's other conversations hold or
        // gave**, and (R3) of the files that profile made; still a reader.
        list_tasks: 'a piece it or its profile holds or gave',
        // 🔴 **`answer_question` names a QUESTION, and that is a fifth subject rather than one of the
        // four widened** (394). ⛔ It is not a dispatch tool under the rule above for
        // `reply_to_parent`'s reason, arrived at from the other end: the only ids it accepts are ones
        // the app SENT to this caller, so a caller cannot compose a call that touches a conversation
        // which has not already asked it something.
        answer_question: 'a question it was sent',
        // 🔴 **`interrupt_agent` names THE AGENT, and it is not a dispatch tool under the rule
        // above** (395). ⛔ It hands nobody anything to do — it takes away what was being done — so
        // the *"work for somebody to pick up later"* it could queue is none. ⚠️ It reaches only a
        // conversation below this caller, as `end_agent` did until D-017.
        interrupt_agent: 'the agent',
        // 🔴 **`list_questions` names NOTHING AT ALL** (396), which was `list_tasks`' answer until
        // D-016 gave it a piece to read, and for its reason: a conversation is told about its own family, `me` is minted by the toolset,
        // and there is no argument for whose questions to look at. ⛔ It is a READER — it hands
        // nobody anything to do — so the *"work for somebody to pick up later"* it could queue is
        // none.
        list_questions: 'nothing at all',
        // 🔴 **`create_agent` names AN AGENT THAT DOES NOT EXIST YET, and that is a sixth subject
        // rather than one of the five stretched** (419). ⛔ Every other value on this list names
        // something the caller can already reach — a conversation, a document, a task it holds, a
        // question it was sent — and the point of this verb is that its subject is none of those.
        // ⚑ **It is not a dispatch tool under the rule above, for the strongest reason on the
        // list**: it cannot hand work to somebody who is not named yet, because there is nobody at
        // all. It writes one row, starts nothing and sends nothing.
        create_agent: 'an agent that does not exist yet',
        // 🔴 **`withdraw_task` is not a dispatch tool under the rule above** (429). ⛔ It hands nobody
        // anything to do — it takes back something already handed over — so the *"work for somebody
        // to pick up later"* it could queue is none. ⚠️ It reaches only a piece this caller gave,
        // which is the strongest entitlement on this list.
        //
        // ⚑ **D-016 · it names the PIECE, and no agent**: the piece's owner is the conversation it is
        // taken back from. ⛔ `reply_to_parent` names a piece too, from the other end of one edge: a
        // child names the piece it was given, a giver the piece it gave.
        withdraw_task: 'a piece it gave',
        // 🔴 **437, and it names A TASK IT WAS GIVEN — `reply_to_parent`'s subject exactly** (437).
        // ⛔ **It does not name an agent and it cannot**: the conversation it reaches is derived
        // from the task edge, and every spelling of an addressee is refused by the same list
        // `reply_to_parent` refuses. ⚑ That is what keeps it off this table's dispatch side — a tool
        // that hands work to somebody not yet named is the shape this census is about, and naming
        // the work you already hold is the opposite of it.
        ask_question: 'a piece it was given',
        // 🔴 **611 · it names a QUESTION, which is a subject this table already has** (HO-088
        // §3.2). ⛔ It does not name an agent and cannot: the next hop is one of two ends, and
        // every spelling of an addressee is refused by the same list `reply_to_parent` refuses.
        // ⚑ And the question it names is one this app ROUTED TO IT, which is the opposite of
        // handing work to somebody not yet named.
        pass_question_up: 'a question it was asked',
        // 🔴 **488 · it was `'nothing at all'`, the strongest form of that word on this list**
        // (HO-020's `list_profiles`): it advertised NO argument. ⚑ **F009 · it names an agent, by its
        // profile, now** — whose record to read: what that agent has done, before a caller chooses
        // whom to give work to. ⛔ It hands nobody anything to do, so it is still no dispatch tool
        // under the rule above — a READER, of a row in this app's own table and the conversations
        // the caller may already reach. See `who-exists-and-what-they-were-told.test.ts` for why the
        // argument opens a record rather than narrowing the list.
        list_profiles: 'an agent, by its profile',
        // ⚑ **D-016** — `list_documents` went with the document registry.
        // 🔴 **582 · it names THE AGENT the rules are for**, which is `message_agent`'s answer and
        // for its reason: a caller has to spell an identity that already exists, so it cannot hand
        // work to somebody who is not named yet. ⛔ And it queues no WORK at all — the proposal arm
        // parks a decision on a PERSON, and the relay arm writes a row.
        propose_agent_rules: 'the agent',
        read_agent_rules: 'the agent',
        write_agent_rules: 'the agent',
        // ⚑ **D-017** — `end_agent` and `663`'s `resume_agent` (both *the agent*) are gone.
        // ⚑ **D-009 · it names a question the caller asked**, and queues nothing at all.
        withdraw_question: 'a question it asked',
        // ⚑ **D-012 · it names the conversation it reads**, and queues nothing at all.
        read_transcript: 'the agent',
        // ⚑ **D-016 · it names a piece, and sends nothing to anyone** — a title or a status line.
        update_work: 'a piece it holds or gave',
        // 🔴 **D-016 · commit 6 · `take_on_work` names NOTHING AT ALL** — no agent, no piece, no
        // question and no resource: its `title` and `brief` are the caller's own words about work it
        // takes on itself. ⛔ **It is not a dispatch tool under the rule above**: it carries a brief,
        // but names no recipient because the piece it opens is the caller's own, under its own
        // conversation's work — nothing is handed to anybody and nothing is queued.
        take_on_work: 'nothing at all',
        // 🔴 **D-037 · `find_files` names NOTHING AT ALL** — no agent, no piece and no question:
        // `where` is a scope, `words` are search words, and `older_than` is only where an earlier
        // answer stopped. ⛔ **It is not a dispatch tool under the rule above**: it is a READER, and
        // hands nobody anything to do.
        find_files: 'nothing at all',
        search_work: 'nothing at all',
        search_past_work: 'nothing at all',
        // `restore_agent` names the archived conversation to bring back. ⛔ It is not a dispatch
        // tool under the rule above: it sends nothing and hands nobody anything to do.
        restore_agent: 'the agent',
        request_mcp_server: 'a server to register',
        // `request_action` names the piece the to-do is about, as `ask_question` does, and hands
        // nobody work: only the person's answer reaches the caller.
        request_action: 'a piece it was given',
      }
      const offered = agentToolsFor(host, 'sess_x')
      for (const tool of offered.tools) {
        const shape = Object.keys(tool.input)
        const names = SUBJECT[tool.name as ToolName]
        if (names === 'a theme') {
          expect(shape, tool.name).toContain(tool.name === 'save_theme' ? 'theme' : 'id')
          for (const aimed of REPLY_ADDRESSING_KEYS)
            expect(shape, `${tool.name} advertises ${aimed}`).not.toContain(aimed)
        }
        if (names === 'the agent') expect(shape, tool.name).toContain('agent')
        if (names === 'an agent, by its profile') {
          expect(shape, tool.name).toContain('profile')
          expect(shape, tool.name).not.toContain('agent')
        }
        if (names === 'a resource') expect(shape, tool.name).toEqual(['resource'])
        if (names === 'a server to register') {
          expect(shape, tool.name).toContain('url')
          expect(shape, tool.name).not.toContain('agent')
        }
        if (names === 'a piece it gave') expect(shape, tool.name).toEqual(['piece'])
        if (names === 'a piece it holds or gave') expect(shape, tool.name).toContain('piece')
        if (names === 'a piece it or its profile holds or gave') {
          expect(shape, tool.name).toContain('piece')
        }
        // ⛔ **611 · the subject is named, and the addressee list is refused here too** (HO-088
        // §3.2). ⚑ `who_answers` is NOT one of `REPLY_ADDRESSING_KEYS` — it is a two-member
        // vocabulary rather than a destination — which is exactly what the loop below measures.
        if (names === 'a question it was asked') {
          expect(shape, tool.name).toContain('question')
          for (const aimed of REPLY_ADDRESSING_KEYS) {
            expect(shape, `${tool.name} advertises ${aimed}`).not.toContain(aimed)
          }
        }
        if (names === 'a piece it was given') {
          expect(shape, tool.name).toContain('piece')
          // ⛔ **And it advertises no spelling of a destination** — §2's ruling, asserted against the
          // list the tool itself refuses by, so the two cannot drift apart.
          for (const aimed of REPLY_ADDRESSING_KEYS) {
            // 🔴 **D-009 · F012 ruling 1 — the ONE exception, by name**: `ask_question`'s third end is
            // an agent the asker names, so it takes `agent` — and refuses it for the other two ends.
            if (tool.name === 'ask_question' && aimed === 'agent') {
              expect(shape, 'ask_question names the agent for an-agent').toContain('agent')
              continue
            }
            expect(shape, `${tool.name} advertises ${aimed}`).not.toContain(aimed)
          }
        }
        // ⛔ **A subject that does not exist yet cannot be addressed**, and this is where that is
        // measured rather than claimed (419). ⚠️ It advertises `profile_slug` — `give_work` spells
        // the same name `profile` since D-016 — and it advertises no `agent`, because there is no
        // agent to name.
        //
        // 🔴 **584 · `display_name` LEFT this shape, and the list is shorter because the app got
        // more opinionated rather than less** (`HO-078` §5). ⛔ **Standing rule 26: the FACT moved
        // and not a spelling** — *the app ASSIGNS a human name to every identity it mints, and the
        // agent never chooses and never asks* — so a key that let a caller choose one is a key this
        // door may not carry at all. ⚠️ **`CREATE_DISPLAY_NAME_ARGUMENT` is gone from
        // `agent-tools.ts`**, the door always builds `displayName: null`, and the success answer
        // tells the caller the name this app chose instead of taking one from it.
        //
        // ⚑ **Pinned as a NEGATIVE beside the `toEqual` as well**, exactly the way `agent` already
        // is: the equality says what the list holds TODAY, and the negative says which key a ruling
        // closed. ⛔ A fourth argument arriving for some other reason moves the equality with it,
        // and these two names stay refused by a line that says whose ruling refused them.
        if (names === 'an agent that does not exist yet') {
          // ⚑ **618 · `rules` is the fourth, and it arrived for `HO-078` §4** — the equality moved
          // with it exactly as the paragraph above says a fourth argument would, and the two
          // negatives below are untouched: a caller still may not name the agent or choose its
          // display name.
          // ⚑ **D-014 · `role` left it** — there are no roles, so the key a ruling closed joins the
          // negatives below.
          // 🔴 **D-042 · R2 · `model` and `effort` joined it as its last two (the fourth and fifth,
          // since `role` left), and they arrived for the agent's DEFAULT** — what its new
          // conversations start on, judged by `model-rails.ts`' one seam. ⚑ The equality moved
          // with them as the paragraph above says it would; the three negatives below are
          // untouched — they still name no agent, display name or role.
          // ⚑ `kind` is the sixth: a normal agent or a service, fixed when it is made.
          expect(shape, tool.name).toEqual([
            'profile_slug',
            'provider',
            'rules',
            'model',
            'effort',
            'kind',
          ])
          expect(shape, tool.name).not.toContain('agent')
          expect(shape, tool.name).not.toContain('display_name')
          expect(shape, tool.name).not.toContain('role')
        }
        if (names === 'a question it was sent') {
          // ⛔ **The question, the answers — and since `679` the asker, as a SELECTOR** (394). The
          // design is unchanged: the caller names the request and the app derives the conversation
          // from the routing it wrote itself. ⚑ **679 · `asked_by` picks one of those routings**
          // when two of the caller's children asked under one session-local id (`675` F-b); a value
          // naming any conversation no routing to this caller names finds nothing, so it is still
          // no way to reach a conversation — and it is not one of `REPLY_ADDRESSING_KEYS` below.
          // ⚑ **D-009** — and the reason it cannot answer, which names nobody either.
          // ⚑ And whether the asker's turn is to be stopped for it, which names nobody either.
          expect(shape, tool.name).toEqual([
            'question',
            'asked_by',
            'answers',
            'cannot_answer',
            'interrupt',
          ])
          for (const aimed of REPLY_ADDRESSING_KEYS) {
            expect(shape, `${tool.name} advertises ${aimed}`).not.toContain(aimed)
          }
        }
      }
      // ⚑ **The readers name no WHO**, and that is the property rather than an exemption: a tool with
      // no way to say who, and no way to say what, cannot queue work for anybody. ⚑ **D-016** —
      // `list_tasks` takes one argument, the piece whose record it reads. ⚑ **D-024 · R3 — and
      // `made`, a yes-or-no that turns the reader to the files its profile made**: it names nobody
      // and carries no words, which the `CARRIES_THE_WORK` loop below measures of it by name.
      // ⚑ **And `state` and `limit`**: which of its own board it lists, and how much — they name
      // nobody either.
      expect(
        Object.keys(offered.tools.find((one) => one.name === 'list_tasks')?.input ?? {}),
      ).toEqual(['piece', 'made', 'state', 'limit'])
      const words = ['dispatch', 'assign', 'delegate', 'hand_off', 'handoff', 'enqueue', 'task']
      // 🔴 **Every spelling of *here are the words of the work*, as the thing a dispatch tool cannot
      // do without** (429). ⛔ A verb that hands work over has to carry the work: `message_agent`
      // takes `text`, `give_work` takes `brief`, `reply_to_parent` takes `summary`. ⚑ **A name
      // with no way to say WHAT cannot hand anybody anything**, whatever it names as a subject.
      const CARRIES_THE_WORK = [
        'text',
        'work',
        'prompt',
        'instructions',
        'message',
        'summary',
        'purpose',
        'body',
        'brief',
      ]
      for (const word of words) {
        // ⚠️ **`list_tasks` contains `task` and it was the first name that ever did; `withdraw_task`
        // (429) is the second, and it broke the PROXY rather than the property.** ⛔ Neither the
        // word nor the tool is exempted — both would be weakening a census to fit a change, and a
        // future `create_task` would walk through the hole.
        //
        // 🔴 **What moved is what is asserted OF such a name.** *Takes no arguments* was a proxy for
        // *cannot hand anybody anything*, and it held only while the one `task`-named tool was a
        // READER. ⚑ `withdraw_task` names a subject on purpose: naming who and which task is how it
        // is narrow rather than wide, and it is the inverse of dispatching — it takes work back.
        //
        // ⛔ **The property that survives is the load-bearing one, and it is strictly stronger than
        // the old proxy on every future name**: a tool carrying a dispatch word advertises no
        // argument that could carry the work itself. ⚠️ The old rule constrained only argumentless
        // names; this one constrains `create_task(agent, text)` too.
        const carrying = TOOL_NAMES.filter((name) => name.includes(word))
        for (const name of carrying) {
          const shape = Object.keys(
            offered.tools.find((one) => one.name === name)?.input ?? { text: 1 },
          )
          for (const carrier of CARRIES_THE_WORK) {
            expect(shape, `${name} advertises ${carrier}, which is how work travels`).not.toContain(
              carrier,
            )
          }
        }
      }
      // ⛔ **Non-vacuity: the loop above must actually have met a name**, or it asserts nothing at
      // all — the shape `316` got wrong. ⚠️ **Two names today**, and `withdraw_task` is the one that
      // makes the loop non-trivial: `list_tasks` has an empty shape, so before `429` the inner
      // assertion could not have failed for any reason other than the tool vanishing.
      expect(TOOL_NAMES.filter((name) => words.some((word) => name.includes(word)))).toEqual([
        'list_tasks',
        'withdraw_task',
      ])
      // ⚑ **And the control that keeps `CARRIES_THE_WORK` honest**: the three verbs that DO hand
      // work each advertise one of these words, so a list that had drifted into naming nothing real
      // would fail here rather than passing every absence above.
      for (const [name, carrier] of [
        ['message_agent', 'text'],
        ['give_work', 'brief'],
        ['reply_to_parent', 'summary'],
      ] as const) {
        expect(
          Object.keys(offered.tools.find((one) => one.name === name)?.input ?? {}),
          name,
        ).toContain(carrier)
        expect(CARRIES_THE_WORK).toContain(carrier)
      }
    })

    it('🔴 no two refusals answer with the same sentence', () => {
      const sentences = TOOL_REFUSALS.map((rail) => refuseTool(rail).reason)
      expect(new Set(sentences).size).toBe(TOOL_REFUSALS.length)
      // ⛔ …and none of them collides with a spawn RAIL's sentence either: a model meets both
      // vocabularies through one door and must not see one sentence mean two things.
      // ⚠️ **This read `SPAWN_RAILS.map((rail) => refuseTool.name && rail)` when it was written** —
      // which is the rail NAMES, not their sentences, and names could never collide with sentences.
      // The assertion was green and measured nothing. Found reviewing this diff.
      const railSentences = SPAWN_RAILS.map((rail) => describeRail(rail))
      expect(new Set([...sentences, ...railSentences]).size).toBe(
        sentences.length + railSentences.length,
      )
      // ⚑ Non-vacuity: these really are prose, not slugs.
      expect(railSentences.every((one) => one.includes(' '))).toBe(true)
    })

    it('⚠️ every refusal is a real sentence, and retryable is DERIVED from permanence', () => {
      for (const rail of TOOL_REFUSALS) {
        const payload = refuseTool(rail)
        expect(payload.reason.length).toBeGreaterThan(40)
        expect(payload.reason.endsWith('.')).toBe(true)
        // ⛔ The one table, and no second source of truth.
        expect(payload.retryable).toBe(payload.permanence === 'while-this-holds')
      }
      // ⚑ **A positive that differs from the default**: not every refusal is retryable, so the
      // derivation above is measured where the two answers differ.
      //
      // ⚠️ **The retryable half read `no-such-agent` until `424`**, which is `permanent` now: an id
      // that names nothing, or names something this caller may not reach, does not start naming
      // something reachable while it waits (`422` row 4). ⛔ The one below is genuinely transient —
      // the same call is a fresh launch nobody has to act before. ⚑ **D-016** — it was the
      // one-open-task rail until the stall rule replaced it (the mailbox rail before D-010).
      expect(refuseTool('malformed-request').retryable).toBe(false)
      expect(refuseTool('no-such-agent').retryable).toBe(false)
      expect(refuseTool('agent-took-too-long-to-start').retryable).toBe(true)
    })

    it('🔴 an agent may name its own session as a PARENT, and may not command it', async () => {
      // ⚑ **The two halves of 347's one entitlement decision, measured apart.**
      //
      // ⛔ The give door says yes — an agent giving from its own conversation is the only thing
      // `give_work` can ever mean (`spawn_agent`'s before D-016; before 347 it was refused
      // `not-your-parent` by a rule aimed at somebody else). That half is exercised by every give in
      // §1.
      //
      // ⛔ **`mayCommand` itself still says no**, and this is the half that would silently go if the
      // clause had been added to the shared predicate instead of at the call site: a session that
      // commanded itself could give ITSELF a turn, which is a capability nobody asked for and a
      // loop nobody bounded.
      const alone = await personOpens('solo')
      const itself = { ownerId: agentCallerId(alone) }
      await expect(host.send(alone, 'talking to myself', itself)).rejects.toThrow()
      await expect(host.queueMessage(alone, 'and again', itself)).rejects.toThrow()
      // ⚑ **The positive that makes those two mean something**: the very same verbs, from the
      // window that owns it, are allowed — so the refusals above are about the CALLER and not
      // about the session being unable to take a turn.
      await expect(host.send(alone, 'from the window', window)).resolves.toBeUndefined()
    })

    it('⛔ an agent caller can never present itself as a window', () => {
      // `mayControl` compares owner ids by equality, so the two namespaces must not be able to meet.
      // ⛔ **The two namespaces are asserted against the REAL minter, not against a literal.** If
      // `sinkOwnerId` ever changed shape, a hand-written `'webContents:1'` here would go on passing
      // while the thing it stands for moved.
      const windowIds = [0, 1, 2, 99].map((id) => sinkOwnerId({ id }))
      const agentIds = ['sess_1', 'webContents:1', 'agent:sess_2', ''].map(agentCallerId)
      for (const agent of agentIds) expect(windowIds).not.toContain(agent)
      // ⚑ …and the decoder is the exact inverse, so nothing can be encoded that cannot be read back.
      expect(sessionSpeakingAs({ ownerId: agentCallerId('sess_9') })).toBe('sess_9')
      // ⛔ A window is not an agent, and must not decode as one.
      expect(sessionSpeakingAs({ ownerId: sinkOwnerId({ id: 1 }) })).toBeNull()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §6 · source censuses
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§6 · the tool layer holds no policy', () => {
    /** Source with block and line comments removed, so prose cannot answer for code. */
    const codeOf = (relative: string): string =>
      readFileSync(join(srcRoot, relative), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .join('\n')

    it('🔴 `agent-tools.ts` names no capability, no bound and no depth', () => {
      const code = codeOf('main/runtime/agent-tools.ts')
      // ⛔ 169 §1: one rule in two places drifts. These are the words the RAILS own.
      //
      // ⚑ **The capability half is DERIVED from the schema now (355), and deriving it closed a
      // hole.** The hand-written list held `canSpawn`, `can_spawn`, `maxDepth` and `maxConcurrent`
      // and had never held `canMessage` or `can_message` — so a tool naming the one capability
      // nothing enforces yet would have passed this census, which is the field most likely to be
      // reached for first when P3 gives it a rail. ⚠️ It also means P3's own field is banned here
      // the moment it exists, rather than the next time somebody remembers this list.
      for (const forbidden of [
        ...CAPABILITY_FIELDS.map((field) => field.key),
        ...CAPABILITY_FIELDS.map((field) => field.column),
        'spawningEnabled',
        'depthOf',
        'capabilitiesOf',
        'mayControl',
        'mayClaim',
        // ⚑ **D-016** — the rails' door is `admitGive` (`admitSpawn` went with `spawn_agent`).
        'admitGive',
        // 355 · the person's configuration door. It is on the wire now, and it must not be on this
        // one: a tool that could write a capability is the thing this whole slice exists to make
        // impossible.
        //
        // 🔴 **488 · the second clause of this note used to read *"a tool that could read what
        // identities exist is `list_agents` and answers about CONVERSATIONS"*, and `list_profiles`
        // made it false.** ⛔ **What did NOT change is the ban**: that door reads no identity here
        // — it calls `host.profilesVisibleTo`, and the identities are read in the host with every
        // other row this app holds. ⚑ The sentence is corrected rather than deleted,
        // because `a-number-can-survive-the-death-of-its-derivation` is about exactly this: the
        // assertion stayed right while the prose beside it went false.
        'agentIdentities',
        'setCapabilities',
      ]) {
        expect(code).not.toContain(forbidden)
      }
      // ⛔ **Non-vacuity for the derived half**: an empty or renamed schema would make the loop
      // above sweep four names instead of ten and pass over the capabilities entirely.
      expect(CAPABILITY_FIELDS.length).toBeGreaterThanOrEqual(4)
      expect(CAPABILITY_FIELDS.map((field) => field.key)).toContain('canMessage')
      // ⚑ **And the mirror**, so the sweep above is not passing over an empty file: the words it
      // DOES contain are the ones that make it a translator.
      expect(code).toContain('host.giveWork')
      expect(code).toContain('host.queueMessage')
      // ⚑ **D-017** — `host.endAgent` went with `end_agent`; `interrupt_agent`'s door stands in.
      expect(code).toContain('host.interruptAgent')
    })

    it('🔴 the live rig re-reads the parent transcript rather than caching it', () => {
      // ⛔ **A guard only a live run can trip is dark by default** (310 broke a live step and CI
      // could not see it). `an-agent-spawns-an-agent.smoke.ts` costs money and needs a login, so it
      // does not run in `ci` — and the defect it once had was in the INSTRUMENT: it captured the
      // parent's tool calls when the child appeared, then asked about `message_agent` seconds later
      // against that snapshot, reporting a run that had worked as a product failure.
      //
      // ⚑ So the shape is pinned from here, where every gate can see it.
      const rig = readFileSync(join(here, '../smoke/an-agent-spawns-an-agent.smoke.ts'), 'utf8')
      expect(rig).toContain('const parentToolCalls = (): string[] =>')
      // ⛔ …and it is asked through a WAIT, not read once.
      expect(rig).toContain("await until('message_agent in the parent transcript'")
      // ⚠️ Non-vacuity: the file really is the rig, and really is live.
      expect(rig).toContain('claudeKeychainTokenProvider')
    })

    it('🔴 348 · the Codex rigs still ask the questions they were written to ask', () => {
      // ⛔ **Same rule as the row above, on the two instruments `348` added.** Neither runs in `ci` —
      // one needs a login, one spawns the bundled binary — so the assertions that make them
      // measurements rather than smoke are pinned from here.
      const rig = readFileSync(
        join(here, '../smoke/a-codex-agent-spawns-an-agent.smoke.ts'),
        'utf8',
      )
      // ⚑ **Exact equality, not `includes`.** `toolItemName` mapped `dynamicToolCall` to the
      // constant `'tool'` until 348, and a row that merely CONTAINS `give_work` would have gone
      // green on the qualified name while saying nothing about the prefix that names the server.
      // ⚑ **D-016** — the verb the rig drives is `give_work`.
      expect(rig).toContain(
        "expect(parentToolCalls().some((name) => name === 'brobot__give_work')).toBe(true)",
      )
      expect(rig).toContain("await until('message_agent in the parent transcript'")
      // ⚠️ Non-vacuity: the file really is the live Codex rig.
      expect(rig).toContain('provisionCodexAuth')

      const probe = readFileSync(
        join(here, '../../../packages/runtime/smoke/codex-dynamic-tools-probe.smoke.ts'),
        'utf8',
      )
      // ⛔ **The control arm is the half that makes the other three measurements.** `thread/start`
      // ignores unknown params silently, so an arm that finds the five names proves nothing until
      // the arm that sent none finds none.
      expect(probe).toContain("expect(namesIn(control.bodies[0]), 'C · no dynamicTools sent")
      // 🔴 …and the resume arm, which is what the whole design rests on.
      expect(probe).toContain("'D · after a cold resume by another process'")
    })

    it('⛔ the tools never hand a claiming sink to anything (340`s census, answered)', () => {
      const code = codeOf('main/runtime/agent-tools.ts')
      // ⚑ **340 priced two answers and this is the one 347 chose.** A caller that presents a
      // `RuntimeEventSink` could claim its own child and then answer its permission prompts; what
      // stops it is that these tools have no sink to present. Every host method they reach takes a
      // `Caller`, which is `{ ownerId }` and nothing else.
      expect(code).not.toContain('RuntimeEventSink')
      expect(code).not.toContain('claimSession')
      expect(code).not.toContain('sendLiveness')
    })

    it('⛔ the tool layer still holds no policy about the name it hands back', () => {
      const code = codeOf('main/runtime/agent-tools.ts')
      // ⚠️ **The id is MINTED in the host and only read here.** A tool layer that could name a
      // message could name one nothing is holding, and the refusal it produced would be about a
      // rule written twice — 169 §1, in the file whose whole point is that it is written once.
      // The sending act has its own correlation token; mailbox IDs still come from the host.
      const importing = "import { randomUUID } from 'node:crypto'"
      const minting = 'const messageAct = `message_act_${randomUUID()}`'
      expect(code).toContain(importing)
      expect(code).toContain(minting)
      const withoutAct = (one: string): string => one.replace(importing, '').replace(minting, '')
      expect(withoutAct(code)).not.toContain('randomUUID')
      expect(withoutAct(`${code}\nconst another = randomUUID()`)).toContain('randomUUID')
      expect(withoutAct(code.replace(minting, `${minting}\n${minting}`))).toContain('randomUUID')
      expect(code).not.toContain('msg_')
      // ⚑ Non-vacuous: it really does carry a name, it just does not make one — ⚑ **D-016 · the
      // piece `give_work` hands back**, minted in the host (the held task's until the tree).
      expect(code).toContain('piece: given.piece')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §7 · 354 — the message a tool holds has a name
  // ───────────────────────────────────────────────────────────────────────────────────────────

  /**
   * 🔴 **354's held message still has a durable id — and since D-010 a second has one of its own**
   * rather than being refused by the first's (criterion 13 retired).
   *
   * ⛔ **490 keeps that id inside the surface that can use it.** A person can cancel the live
   * mailbox entry; no agent tool accepts a message id. The refusal still names the blocker as a
   * diagnostic fact, while the successful `message_agent` answer no longer pretends it handed the
   * model an actionable receipt.
   */
  describe('§7 · 354 · the message has a name, and a second has its own', () => {
    /** The piece the busy child holds — the one a follow-up names. */
    let itsPiece = ''

    /** Give a child a piece and leave it parked on a card, so a message to it is HELD. */
    const aBusyChild = async (parent: string): Promise<string> => {
      // ⚑ **D-016 · the brief opens the turn** — it is the new conversation's first turn, and in
      // `ask` that turn parks on a card.
      const first = await give(parent, 'worker', 'Be busy')
      const child = first.agent as string
      itsPiece = String(first.label)
      // ⛔ **The idle branch carries NO name**, which is the half of {@link QueueOutcome} that makes
      // the other half mean something: nothing is being held, so there is nothing to cancel.
      expect(first.delivery).toBe('sent')
      expect(first.message).toBeUndefined()
      await until(() => eventKinds(child).includes('permission_request'))
      return child
    }

    it('🔴 D-010 · a held message is named, and a second is HELD under a name of its own', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')
      const { call } = toolsOf(parent)
      const child = await aBusyChild(parent)
      const heldIds = (): string[] =>
        store
          .events(child)
          .flatMap((row) =>
            row.event.type === 'message_queued' && row.event.messageId !== undefined
              ? [row.event.messageId]
              : [],
          )

      const held = await call('message_agent', {
        agent: child,
        text: 'and then this',
        kind: 'follow-up',
        piece: itsPiece,
      })
      expect(held.outcome).toBe('ok')
      expect(held.delivery).toBe('queued')
      expect(held).not.toHaveProperty('message')

      // ⛔ **Criterion 13 refused this until D-010**, naming the first; now it waits its own turn.
      const second = await call('message_agent', {
        agent: child,
        text: 'and a third',
        kind: 'note',
      })
      expect(second.outcome, JSON.stringify(second)).toBe('ok')
      expect(second.delivery).toBe('queued')
      expect(second).not.toHaveProperty('message')
      const [first, next] = heldIds()
      expect(heldIds()).toHaveLength(2)
      expect(first).toMatch(/^msg_/)
      expect(next).toMatch(/^msg_/)
      expect(next).not.toBe(first)
    })
  })
})
