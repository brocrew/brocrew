import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
  UserInputResponse,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, THE_APP_ITSELF } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import { TOOL_NAMES, agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { mailboxOf } from '../src/shared/mailbox'
import { REQUEST_IS_OPEN, REQUEST_STATES, deriveRoutedRequests } from '../src/shared/questions'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * 🔴 **396 · nothing waits on somebody looking** — Slice 4 S6, and the last build dispatch before X.
 *
 * ## ⛔ One principle, and three findings that turned out to be it
 *
 * > **Whether work happens must never depend on whether anybody is looking at it.**
 *
 *  - **`395` §6** — `RuntimeHost.deliver` called `flushQueued` BELOW `if (!session.sink.alive)
 *    return`, and a spawned session's sink is `NO_SURFACE`, whose `alive` is `false`. **A message
 *    queued to a busy child nobody was watching was never sent.**
 *  - **`394` §6.1** — after a crash a routed request read `open` while the provider that raised it
 *    was gone. **Nothing anywhere was waiting**, and the ledger could not tell a live wait from a
 *    dead one.
 *  - **`394` §6.2** — a question routed to a parent that was not live was never delivered. The
 *    parent, once resumed, had no message and therefore no id, so **it could never answer**.
 *
 * ⚑ **They are one subject, and the repair is made once**: a gate about ATTENTION decides nothing
 * about WORK; a launch WRITES the ending a crash could not; and a reader exists for the question a
 * message could not carry.
 *
 * ## ⚠️ Where the reasoning slipped, quoted because it is the trap
 *
 * `NO_SURFACE`'s own docblock said *"every `if (!sink.alive) return` in this class takes the branch
 * it already takes for a window that has gone, so no existing line had to learn about a new state."*
 * ⛔ **That is true of every line that DELIVERS TO A SURFACE.** The flush is not one — it hands work
 * to a PROVIDER, and it was sitting under a gate about whether anyone was looking. ⚑ §1 puts the
 * hazard on the path the code walks; §6 keeps it there.
 *
 * ## ⛔ The assertions this dispatch DELETED, and it says so out loud
 *
 * ⚠️ **`395` recorded the mailbox defect as a MEASUREMENT rather than a comment** — the same held
 * message going out at once with a window attached and still held with none — precisely so that the
 * day it was repaired the assertion would turn red. ⚑ It did. ⛔ **It was replaced by the opposite
 * claim, never adjusted until it passed**: `the-interruption-that-looks-like-a-fault.test.ts` §5.
 *
 * ⚠️ **`394` did the same for the crash**, under *"after a CRASH the row still reads open"*. ⛔ Also
 * replaced, in `a-question-finds-a-person.test.ts` §5 — and the rail it was the only demonstration
 * of (`the-conversation-that-asked-has-gone`) is kept reachable HERE, in §2, through the one case
 * this sweep must not walk over.
 *
 * ⚑ **Real host, real SQLite, real migrations, real tools, real filesystem.** The only double is the
 * provider.
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

describe('396 · nothing waits on somebody looking', () => {
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

  /**
   * ⛔ **`over` exists for the crash tests and nothing else** (`354`'s paragraph, `394`'s reuse).
   * `live-hosts.ts` identifies a ledger by OBJECT, so a second host sharing this one's store finds
   * every session in `workRunningElsewhere` and excludes it from the startup repair — which is an
   * exclusion, not a crash. ⚑ §2 uses BOTH, because the difference between them is the thing the
   * `running` half of the sweep is for.
   */
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-looking-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-looking-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
    claimed = new Set<string>()
    pairs = 0
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (
    profileId: string,
    on: RuntimeHost = host,
    approvalMode: 'ask' | 'auto' = 'ask',
  ): Promise<string> => {
    const { sessionId } = await on.createSession(
      { provider: 'claude', profileId, approvalMode, cwd: root },
      window,
    )
    claimed.add(sessionId)
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

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const latestHandle = (): FakeSessionHandle => {
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('no provider handle has been issued')
    return handle
  }

  /** ⚑ The caller a PM's own tools present — `agent-tools.ts`'s `agentCallerId`, spelled once. */
  const asPm = (pm: string): { ownerId: string } => ({ ownerId: `agent:${pm}` })

  /** One capability, changed and nothing else. */
  const reach = (profileId: string, edit: { canMessage?: string }): void => {
    expect(store.setCapabilities(profileId, edit as never)).toBe(true)
  }

  /** The latest provider status stays idle when later app receipts are written. */
  const quiet = (sessionId: string): boolean => {
    const last = ledger(sessionId)
      .reverse()
      .find((event) => event.type === 'status')
    return last?.type === 'status' && last.state === 'idle'
  }

  /**
   * `393`'s helper: a PM in a window with one child of its own, started through the real door.
   *
   * ⚑ **D-016 · the door is `give_work`, and its brief is the child's first turn** — where
   * `spawn_agent` started a child that had been sent nothing. ⛔ So that the pair stands where a
   * spawn left it — both idle, the child holding no open work and no card routed from it — the brief
   * runs unattended (`auto`, which a child takes from its giver), the child answers it, and only
   * then does each conversation go back to `ask`, from its next turn. ⚠️ Nobody claims the child on
   * the way: its sink is the one a give leaves, which is what §1 is about.
   */
  const aPmAndItsWorker = async (): Promise<{
    pm: string
    pmProfile: string
    worker: string
    pmTools: AgentToolset
    workerHandle: FakeSessionHandle
  }> => {
    const nth = ++pairs
    const pmProfile = `pm-${String(nth)}`
    const workerProfile = `worker-${String(nth)}`
    await bringIdentityIntoBeing(workerProfile)
    const pm = await personOpens(pmProfile, host, 'auto')
    const pmTools = agentToolsFor(host, pm)
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: workerProfile,
      title: 'the work this dispatch is about',
      brief: 'the work this dispatch is about',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    const workerHandle = latestHandle()
    await waitFor(() => quiet(worker), 'the brief’s turn to end')
    const replied = await callOn(agentToolsFor(host, worker), 'reply_to_parent', {
      piece: given.label,
      outcome: 'done',
      summary: 'the work is done',
    })
    expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
    await waitFor(
      () =>
        ledger(pm).some(
          (event) => event.type === 'user_turn' && event.text.includes('the work is done'),
        ) && quiet(pm),
      'the answer to reach the pm, and its turn to end',
    )
    await host.setApprovalMode(pm, 'ask', window)
    await host.setApprovalMode(worker, 'ask', THE_APP_ITSELF)
    // ⚑ **The premise, asserted**: nothing open, nothing routed, and nobody has claimed the child.
    expect(store.openPiecesOf(worker)).toEqual([])
    expect(store.routedRequestsOf(worker)).toEqual([])
    expect(claimed.has(worker)).toBe(false)
    return { pm, pmProfile, worker, pmTools, workerHandle }
  }

  /**
   * ⚑ **Raise a question on the child exactly as its provider would**, and wait for the app to have
   * DECIDED where it goes — `394`'s helper, and its two waits for its reason: without the first, a
   * routing that never happened and a request that never reached the ledger fail identically.
   */
  const childAsks = async (
    child: string,
    handle: FakeSessionHandle,
    prompt = 'which branch?',
    options: readonly string[] = ['main', 'dev'],
    extra: { secret?: boolean } = {},
  ): Promise<{ id: string; answered: Promise<UserInputResponse> }> => {
    const raised = handle.simulateUserInput(prompt, options, false, extra)
    await waitFor(
      () => ledger(child).some((event) => event.type === 'user_input_request'),
      `the request ${raised.id} to reach ${child}'s ledger`,
    )
    await waitFor(
      () =>
        ledger(child).some(
          (event) => event.type === 'request_routed' && event.requestId === raised.id,
        ),
      `the routing of ${raised.id}`,
    )
    return raised
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

  /** Answer the open card so the turn runs to its own terminal (`379`'s helper). */
  const letTheTurnFinish = async (sessionId: string): Promise<void> => {
    const before = ledger(sessionId).filter((event) => event.type === 'turn').length
    const id = await cardOn(sessionId)
    if (!claimed.has(sessionId)) {
      host.claimSession(sessionId, window)
      claimed.add(sessionId)
    }
    await host.respondPermission(sessionId, id, { outcome: 'allow' }, window)
    await waitFor(
      () => ledger(sessionId).filter((event) => event.type === 'turn').length > before,
      'the turn to reach its own terminal',
    )
  }

  const sourceOf = (dir: string, file: string): string => readFileSync(join(dir, file), 'utf8')
  const codeOnly = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  /**
   * ⛔ **The body of one method, code only** — `394`'s idiom, so a docblock quoting the line a
   * dispatch retired cannot satisfy an assertion about the code.
   */
  const bodyOf = (source: string, opens: string): string => {
    const code = codeOnly(source)
    const at = code.indexOf(opens)
    expect(at, `${opens} was renamed or removed`).toBeGreaterThan(0)
    return code.slice(at, code.indexOf('\n  }', at))
  }

  /**
   * 🔴 **The span a brace-delimited `if` covers**, from its opening line to its matching `}`.
   *
   * ⛔ **Walked rather than matched.** A regexp cannot find the end of a block, and a census that
   * sliced to the next `}` would answer about the first nested one — which is the shape that reports
   * *"the flush is outside the gate"* about a flush one line inside it.
   */
  const blockAfter = (body: string, opens: string): string => {
    const at = body.indexOf(opens)
    expect(at, `${opens} is not in this body`).toBeGreaterThan(-1)
    let depth = 0
    for (let index = at + opens.length - 1; index < body.length; index++) {
      if (body[index] === '{') depth += 1
      if (body[index] === '}') {
        depth -= 1
        if (depth === 0) return body.slice(at, index + 1)
      }
    }
    throw new Error(`${opens} has no matching close`)
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · THE DELIVERABLE — a gate about attention decides nothing about work
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · the flush is not under an attention gate', () => {
    it('🔴 a message held for a child NOBODY is watching goes out when its turn ends', async () => {
      // ⛔ **The hazard on the path the code walks** (396 §5): no window, a busy child, a held
      // message — and the turn ends through the PROVIDER rather than through a person, so no sink is
      // ever attached. ⚠️ A test that let a window claim the child would pass either way, which is
      // the shape `395` named when it wrote the defect down.
      const { pm, pmProfile, worker, pmTools, workerHandle } = await aPmAndItsWorker()
      reach(pmProfile, { canMessage: 'any' })
      // ⚑ **D-016 · two NOTES** — the first starts a turn and parks it, so the second is held. A
      // note opens nothing, and a follow-up would have to name a piece the child holds.
      expect(
        (
          await callOn(pmTools, 'message_agent', {
            agent: worker,
            text: 'first',
            kind: 'note',
          })
        ).outcome,
      ).toBe('ok')
      await waitFor(() => workerHandle.status() === 'waiting_permission', 'the child to be working')
      const held = await callOn(pmTools, 'message_agent', {
        agent: worker,
        text: 'second',
        kind: 'note',
      })
      expect(held.delivery, JSON.stringify(held)).toBe('queued')

      // ⚑ **Nobody has ever looked at this conversation**, asserted rather than assumed: the sink a
      // spawned session carries is `NO_SURFACE`, and no window has claimed it.
      expect(claimed.has(worker)).toBe(false)
      expect(window.messages.some((one) => one.sessionId === worker)).toBe(false)

      // ⛔ **The turn ends through the PARENT and not through a person**, which is the only ending a
      // child nobody has claimed can have: `mayAnswerAsAHuman` refuses a commander and refuses the
      // app, so answering the card would mean attaching a window — the very thing this test must
      // not do. ⚑ What the flush keys on is `status: 'idle'`, whatever produced it.
      await host.interrupt(worker, asPm(pm))
      await waitFor(
        () => mailboxOf(store.events(worker)).some((one) => one.ending === 'sent'),
        'the held message to go out to a child nobody is watching',
      )
      expect(mailboxOf(store.events(worker)).map((one) => one.ending)).toContain('sent')
      // ⛔ **And still nobody looked** — the premise held for the whole test, so what sent the
      // message was not a window arriving part-way through it.
      expect(window.messages.some((one) => one.sessionId === worker)).toBe(false)
    })

    it('🔴 …and when the window that WAS watching has gone — the other half of the same gate', async () => {
      // ⛔ **`sink.alive` is `false` for two different reasons and the repair has to cover both**: a
      // spawned child that never had a surface, and a conversation whose window closed. ⚠️ The
      // second is the one `NO_SURFACE`'s docblock reasoned from — *"the branch it already takes for
      // a window that has gone"* — so it is the arm that shows the defect was never only about
      // spawned sessions.
      const { pmProfile, worker, pmTools, workerHandle } = await aPmAndItsWorker()
      reach(pmProfile, { canMessage: 'any' })
      const ghost = new RecordingSink('webContents:9')
      host.claimSession(worker, ghost)
      claimed.add(worker)
      // ⚑ **D-016 · two NOTES** — the first starts a turn and parks it, so the second is held. A
      // note opens nothing, and a follow-up would have to name a piece the child holds.
      await callOn(pmTools, 'message_agent', { agent: worker, text: 'first', kind: 'note' })
      await waitFor(() => workerHandle.status() === 'waiting_permission', 'the child to be working')
      expect(
        (
          await callOn(pmTools, 'message_agent', {
            agent: worker,
            text: 'second',
            kind: 'note',
          })
        ).delivery,
      ).toBe('queued')
      const card = await cardOn(worker)
      // ⚑ **The window goes BEFORE the turn ends**, which is deterministic rather than raced: the
      // answer is still permitted — `mayAnswerAsAHuman` compares owners and never aliveness — and
      // every `deliver` after this line takes the dead-sink branch.
      ghost.alive = false
      await host.respondPermission(worker, card, { outcome: 'allow' }, ghost)
      await waitFor(
        () => mailboxOf(store.events(worker)).some((one) => one.ending === 'sent'),
        'the held message to go out after the window went',
      )
      const seen = ghost.messages.length
      expect(mailboxOf(store.events(worker)).map((one) => one.ending)).toContain('sent')
      // ⛔ **Nothing reached the departed window**, which is what the gate is still for.
      expect(ghost.messages.length).toBe(seen)
    })

    it('⛔ …and it still goes out when somebody IS — the control, so this is not a one-sided test', async () => {
      // ⚑ **The paired positive.** A repair that broke the watched case would pass the test above and
      // be a worse app than the one it replaced.
      const { pmProfile, worker, pmTools, workerHandle } = await aPmAndItsWorker()
      reach(pmProfile, { canMessage: 'any' })
      // ⚑ **D-016 · two NOTES** — the first starts a turn and parks it, so the second is held. A
      // note opens nothing, and a follow-up would have to name a piece the child holds.
      await callOn(pmTools, 'message_agent', { agent: worker, text: 'first', kind: 'note' })
      await waitFor(() => workerHandle.status() === 'waiting_permission', 'the child to be working')
      expect(
        (
          await callOn(pmTools, 'message_agent', {
            agent: worker,
            text: 'second',
            kind: 'note',
          })
        ).delivery,
      ).toBe('queued')
      await letTheTurnFinish(worker)
      await waitFor(
        () => mailboxOf(store.events(worker)).some((one) => one.ending === 'sent'),
        'the held message to go out to a child somebody is watching',
      )
    })

    it('🔴 the flush does not overtake the status that triggered it — `320`’s ordering, kept', async () => {
      // ⛔ **`395` named this as the hazard of moving the call**: the flush publishes a `user_turn`,
      // and a `user_turn` published from inside another event's window puts ordinal `N+1` on the
      // wire before `N` — which is the disorder `320` measured, and which `RuntimeHost.emit` reports
      // to the console rather than silently repairing.
      //
      // ⚑ **Measured on the WIRE and not on the ledger**, because the ledger cannot show it: the
      // ordinals are taken in order whatever the send order was. This reads the sink.
      const { pmProfile, worker, pmTools, workerHandle } = await aPmAndItsWorker()
      reach(pmProfile, { canMessage: 'any' })
      host.claimSession(worker, window)
      claimed.add(worker)
      // ⚑ **D-016 · two NOTES** — the first starts a turn and parks it, so the second is held. A
      // note opens nothing, and a follow-up would have to name a piece the child holds.
      await callOn(pmTools, 'message_agent', { agent: worker, text: 'first', kind: 'note' })
      await waitFor(() => workerHandle.status() === 'waiting_permission', 'the child to be working')
      await callOn(pmTools, 'message_agent', { agent: worker, text: 'second', kind: 'note' })
      await letTheTurnFinish(worker)
      await waitFor(
        () => mailboxOf(store.events(worker)).some((one) => one.ending === 'sent'),
        'the held message to go out',
      )
      const sent = window.messages
        .filter((one) => one.sessionId === worker)
        .map((one) => one.ordinal)
      // ⚑ **The premise, asserted rather than assumed**: the flush really did publish onto this wire.
      expect(sent.length).toBeGreaterThan(4)
      expect([...sent].sort((left, right) => left - right)).toEqual(sent)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · a launch writes the ending nothing else can
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the request a crash left open', () => {
    it('🔴 a launch settles it, and the refusal NAMES the ending rather than the id', async () => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const asked = await childAsks(worker, workerHandle)
      // ⚑ **The premise**: nothing has ended it, so the ledger reads `open` — which is exactly what
      // a live wait reads, and is why no fold can be the repair.
      expect(store.routedRequestsOf(worker).map((one) => one.state)).toEqual(['open'])

      // ⛔ **A SECOND store object is what makes this a crash**: `live-hosts.ts` compares ledgers by
      // object identity, so this host believes nothing is running — which is what a fresh process
      // believes, and the reason the sweep is safe there.
      const next = buildHost(createSessionStore(db, tick))
      await next.resumeSession(pm, window)
      expect(next.questionsVisibleTo(pm).map((one) => one.state)).toEqual(['stranded'])

      const refused = await callOn(agentToolsFor(next, pm), 'answer_question', {
        question: asked.id,
        answers: [{ part: 'q0', answer: ['main'] }],
      })
      expect(refused).toMatchObject({
        outcome: 'refused',
        rail: 'question-has-already-ended',
        permanence: 'permanent',
        retryable: false,
        detail: { state: 'stranded' },
      })
      // ⛔ **Nothing was sent.** The repair records a fact; it does not answer on anybody's behalf.
      expect(ledger(worker).some((event) => event.type === 'user_decision')).toBe(false)
    })

    it('⛔ `running` is honoured — and that is what keeps `394`’s rail REACHABLE', async () => {
      // 🔴 **Two claims in one test because they are one mechanism.**
      //
      //  1. A second host over the SAME ledger object finds the conversation in
      //     `workRunningElsewhere` and must NOT strand a request the first host is still holding —
      //     `settleOrphanRuns`' rule, third venue.
      //  2. ⚠️ **And that case is now the only demonstration of
      //     `the-conversation-that-asked-has-gone`**, which `394` reached through the crash this
      //     dispatch repaired. ⛔ A rail nothing reaches passes vacuously; this is what makes it
      //     reachable, and it is stated here so nobody deletes the rail as dead.
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const asked = await childAsks(worker, workerHandle)

      // ⚠️ **Constructed and NOT resumed into.** `reserve` refuses a session another live host is
      // running — which is `265`'s rail doing its job — and the sweep is a constructor act, so the
      // construction is the whole of what this test needs.
      const beside = buildHost()
      // ⛔ **Still `open`** — the first host is running it, so this launch left it exactly as it was.
      expect(beside.questionsVisibleTo(pm).map((one) => one.state)).toEqual(['open'])
      expect(ledger(worker).some((event) => event.type === 'request_stranded')).toBe(false)

      const refused = await callOn(agentToolsFor(beside, pm), 'answer_question', {
        question: asked.id,
        answers: [{ part: 'q0', answer: ['main'] }],
      })
      expect(refused).toMatchObject({
        outcome: 'refused',
        rail: 'the-conversation-that-asked-has-gone',
        permanence: 'permanent',
        retryable: false,
      })
    })

    it('⚠️ a second launch writes nothing more — the sweep is idempotent', async () => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      await childAsks(worker, workerHandle)
      const first = buildHost(createSessionStore(db, tick))
      await first.resumeSession(pm, window)
      const afterOne = ledger(worker).filter((event) => event.type === 'request_stranded').length
      expect(afterOne).toBe(1)
      // ⚑ **The fold is what makes it idempotent**: the second launch folds the row the first wrote
      // and finds the request closed, so there is nothing open to settle.
      buildHost(createSessionStore(db, tick))
      expect(ledger(worker).filter((event) => event.type === 'request_stranded').length).toBe(1)
    })

    it('⛔ a request that already ENDED is left alone — a launch settles what is open and nothing else', async () => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const asked = await childAsks(worker, workerHandle)
      // ⚑ Answered through the real door, so the ending is the one the fold reads.
      expect(
        await callOn(agentToolsFor(host, pm), 'answer_question', {
          question: asked.id,
          answers: [{ part: 'q0', answer: ['main'] }],
        }),
      ).toMatchObject({ outcome: 'ok' })
      expect(store.routedRequestsOf(worker).map((one) => one.state)).toEqual(['answered'])

      buildHost(createSessionStore(db, tick))
      expect(ledger(worker).some((event) => event.type === 'request_stranded')).toBe(false)
      expect(store.routedRequestsOf(worker).map((one) => one.state)).toEqual(['answered'])
    })

    it('⛔ TWO open requests in one conversation are both settled — the control that plants two', async () => {
      // ⚠️ **Standing rule 12: a census needs a control that plants TWO, not one.** ⛔ The hazard is
      // exact and it is not about counting: the sweep takes `max(ordinal) + 1` per row, and a
      // reading hoisted out of the loop would write two rows at ONE ordinal — which
      // `unique(session_id, generation, ordinal)` refuses, taking the whole transaction down and
      // leaving a launch that repairs nothing and throws on the way past.
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const first = await childAsks(worker, workerHandle, 'which branch?', ['main', 'dev'])
      const second = await childAsks(worker, workerHandle, 'which region?', ['eu', 'us'])
      expect(store.routedRequestsOf(worker).map((one) => one.state)).toEqual(['open', 'open'])

      const next = buildHost(createSessionStore(db, tick))
      await next.resumeSession(pm, window)
      expect(next.questionsVisibleTo(pm).map((one) => one.requestId)).toEqual([first.id, second.id])
      expect(next.questionsVisibleTo(pm).map((one) => one.state)).toEqual(['stranded', 'stranded'])
      // ⚑ **Two rows at two ordinals**, said as the fact the collision would have broken rather
      // than left to the state assertion above.
      const written = store
        .events(worker)
        .filter((entry) => entry.event.type === 'request_stranded')
        .map((entry) => entry.ordinal)
      expect(written).toHaveLength(2)
      expect(new Set(written).size).toBe(2)
    })

    it('⚑ a conversation that never routed anything is not read at all', async () => {
      // ⚠️ **A negative with a search shape**: the sweep's candidate query asks for
      // `type = 'request_routed'`, so a person's own conversation — which has no parent and
      // therefore no channel — is never a candidate. ⛔ The control is that the sweep DID run in
      // this test, which the second half asserts.
      const alone = await personOpens('nobody-spawned-me')
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      await childAsks(worker, workerHandle)

      const next = buildHost(createSessionStore(db, tick))
      expect(ledger(alone).some((event) => event.type === 'request_stranded')).toBe(false)
      expect(ledger(worker).filter((event) => event.type === 'request_stranded').length).toBe(1)
      expect(next.questionsVisibleTo(pm).map((one) => one.state)).toEqual(['stranded'])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the question a parent was never told about
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · list_questions', () => {
    /**
     * ⛔ **A child that asks while its parent is NOT LIVE** — the whole of `394` §6.2.
     *
     * The routing row is written whatever the parent's state, deliberately, because a durable row
     * that waited on somebody being there to read it would be lost exactly when the parent went
     * first. ⚑ **D-017 · R1 — and `deliverQuestion` no longer returns silently when the parent has
     * no slot**: the question STARTS the parent that has stopped, and it is told.
     */
    const askedWithNobodyHome = async (): Promise<{
      pm: string
      worker: string
      asked: { id: string; answered: Promise<UserInputResponse> }
    }> => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      await host.close(pm, window)
      claimed.delete(pm)
      expect(host.sessionIds).not.toContain(pm)
      const asked = await childAsks(worker, workerHandle)
      // ⚑ **The premise, asserted**: the question travelled, and the parent that had stopped was
      // started for it and TOLD it.
      expect(store.routedRequestsOf(worker)[0]).toMatchObject({
        went: { is: 'the-parent', to: 'the-parent' },
      })
      await waitFor(
        () =>
          ledger(pm).some(
            (event) => event.type === 'user_turn' && event.text.includes('which branch?'),
          ),
        'the question to start the parent and reach it as words',
      )
      return { pm, worker, asked }
    }

    it('🔴 a parent that was not running when its child asked can find the question AND answer it', async () => {
      const { pm, worker, asked } = await askedWithNobodyHome()
      await host.resumeSession(pm, window)
      claimed.add(pm)
      const tools = agentToolsFor(host, pm)

      const listed = await callOn(tools, 'list_questions')
      expect(listed.outcome).toBe('ok')
      const rows = listed.questions as Record<string, unknown>[]
      expect(rows.map((one) => one.question)).toEqual([asked.id])
      expect(rows[0]).toMatchObject({ asked_by: worker, state: 'open', answerable_by_you: true })
      // 🔴 **The words, and they are what makes this a door rather than a list.** An id alone names a
      // thing the caller still cannot act on: `answer_question` takes one entry per PART.
      expect(String(rows[0]?.words)).toContain('part q0')
      expect(String(rows[0]?.words)).toContain('main')

      expect(
        await callOn(tools, 'answer_question', {
          question: asked.id,
          answers: [{ part: 'q0', answer: ['dev'] }],
        }),
      ).toMatchObject({ outcome: 'ok' })
      await expect(asked.answered).resolves.toMatchObject({ answers: { q0: ['dev'] } })
    })

    it('⛔ the words are the SAME words a live parent is sent — two paths, one string', async () => {
      // ⚠️ **Not compared against `questionText` called a second time**, which would be a fixture
      // built with the helper under test. ⛔ The control is the OTHER path: a parent that WAS live
      // receives the question as an ordinary turn, and what it received is what the reader hands
      // back.
      const live = await aPmAndItsWorker()
      const liveAsked = await childAsks(live.worker, live.workerHandle)
      // ⚑ **D-016 · the turn that carries the QUESTION** — the parent's ledger also holds the turns
      // its piece's answer came back in.
      const theQuestion = (event: TranscriptEvent): boolean =>
        event.type === 'user_turn' && event.text.includes('which branch?')
      await waitFor(
        () => ledger(live.pm).some(theQuestion),
        'the question to reach the live parent as words',
      )
      const delivered = ledger(live.pm).find(theQuestion)
      if (delivered === undefined || delivered.type !== 'user_turn') throw new Error('no turn')
      const rows = (await callOn(agentToolsFor(host, live.pm), 'list_questions'))
        .questions as Record<string, unknown>[]
      expect(rows.find((one) => one.question === liveAsked.id)?.words).toBe(delivered.text)
    })

    it('🔴 a PERMISSION lists and carries NO words — and the `because` narrowing is what does it', async () => {
      // 🔴 **ONE thing stands between a parent and a permission's text, and this is it.**
      //
      // ⛔ **A secret is a `user_input_request` WITH a prompt and parts** that the channel refuses —
      // the same shape a Codex `item/permissions/requestApproval` arrives in, told apart by a field
      // rather than by a type. ⚑ `questionsRaisedIn` hands its words back happily, which the second
      // assertion below states rather than leaves implied; the `because` gate is what does not.
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const secret = await childAsks(worker, workerHandle, 'the token?', [], { secret: true })
      const rows = (await callOn(agentToolsFor(host, pm), 'list_questions')).questions as Record<
        string,
        unknown
      >[]
      const row = rows.find((one) => one.question === secret.id)
      // ⛔ **It LISTS**, which is `394` §2 unchanged: a reader that dropped it would make the
      // refusal below unreachable and the census permanently blind.
      expect(row).toMatchObject({
        state: 'open',
        answerable_by_you: false,
        because: 'a-secret-only-a-person-can-type',
        words: null,
      })
      // ⛔ **And the store DID have the words** — the premise that makes `words: null` a gate rather
      // than an absence. ⚠️ Without this line the assertion above would pass just as well if the
      // reader had simply failed to find the request.
      expect(store.questionsRaisedIn(worker).get(secret.id)?.prompt).toBe('the token?')
      // ⚑ **And it is still refused BY NAME**, so the caller is told what it named rather than that
      // there is nothing there.
      expect(
        await callOn(agentToolsFor(host, pm), 'answer_question', {
          question: secret.id,
          answers: [{ part: 'q0', answer: ['hunter2'] }],
        }),
      ).toMatchObject({ outcome: 'refused', rail: 'a-person-answers-this-one' })
    })

    it('⛔ …and a permission CARD has no words to leak — the shape, which is NOT a second gate', async () => {
      // ⚠️ **This test used to claim it was the other half of a pair, and it is not.** `396` wrote a
      // mutation row widening `selectQuestionsRaised` to admit `permission_request` and the row
      // SURVIVED: that event carries `kind`, `action` and `detail` and has neither `prompt` nor
      // `questions`, so the widened query returns SQL `NULL`s and the reader skips a row it cannot
      // read. ⛔ The `type` filter is `053`'s narrow read, not a gate — the row was removed and both
      // docblocks were corrected.
      //
      // ⚑ **What this still measures is worth keeping**: a permission card LISTS, so the refusal
      // stays reachable and `permissionShaped` stays informative, and it carries no words.
      const { pm, worker } = await aPmAndItsWorker()
      await host.send(worker, 'a long piece of work', asPm(pm))
      await cardOn(worker)
      await waitFor(
        () => store.routedRequestsOf(worker).length > 0,
        'the permission card to be routed',
      )
      const rows = (await callOn(agentToolsFor(host, pm), 'list_questions')).questions as Record<
        string,
        unknown
      >[]
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ because: 'a-permission-decision', words: null })
      expect(store.questionsRaisedIn(worker).size).toBe(0)
    })

    it('⚠️ a stranded question lists with its ending, and the line SPELLS OUT what that means', async () => {
      // ⛔ **A word cannot carry `stranded`**: a reader told only that would as likely conclude its
      // child had gone away, which is the wrong thing to do about a conversation it can ask again.
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      await childAsks(worker, workerHandle)
      const next = buildHost(createSessionStore(db, tick))
      await next.resumeSession(pm, window)
      const tool = agentToolsFor(next, pm).tools.find((one) => one.name === 'list_questions')
      const answered = await tool!.call({ state: 'all' })
      const listed = (answered.structured ?? {}) as Record<string, unknown>
      expect((listed.questions as Record<string, unknown>[])[0]?.state).toBe('stranded')
      expect(answered.text).toContain('the app restarted while it was waiting')
      expect(answered.text).toContain('nothing is waiting on you')
    })

    it('⛔ a caller sees only its OWN family — the entitlement is the lookup, and it takes no argument', async () => {
      // ⚑ **Structural rather than checked** (`394`'s rule): `me` is minted by the toolset from the
      // session it was built for, and `list_questions` advertises no argument that names a
      // conversation — so there is no id a caller could spell to reach somebody else's family.
      const mine = await aPmAndItsWorker()
      const theirs = await aPmAndItsWorker()
      const asked = await childAsks(theirs.worker, theirs.workerHandle)
      const rows = (await callOn(agentToolsFor(host, mine.pm), 'list_questions'))
        .questions as Record<string, unknown>[]
      expect(rows).toEqual([])
      // ⚑ **The paired positive**: the row exists and the OTHER parent can see it, so the empty
      // answer above is an entitlement rather than a reader that finds nothing.
      const theirRows = (await callOn(agentToolsFor(host, theirs.pm), 'list_questions'))
        .questions as Record<string, unknown>[]
      expect(theirRows.map((one) => one.question)).toEqual([asked.id])
      const definition = agentToolsFor(host, mine.pm).tools.find(
        (one) => one.name === 'list_questions',
      )
      // ⚑ What it takes chooses how much of its own family's questions is listed, never whose.
      expect(Object.keys(definition?.input ?? {})).toEqual(['state', 'limit'])
    })

    it('⚠️ a request id REPEATED across a resume reads the LIVE question’s words', async () => {
      // ⛔ **`394` §5's finding, met at a second door.** A request id is unique per PROVIDER SESSION
      // and a resumed conversation is a new one, so one ledger holds `ui_1` twice — and a reader
      // keyed by id has to say which. ⚑ Ordinal order, last wins, which is the same rule
      // `answerQuestion` takes: the live request is the only one anybody can answer.
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const before = await childAsks(worker, workerHandle, 'which branch?', ['main', 'dev'])
      await host.closeAll()
      host = buildHost()
      await host.resumeSession(pm, window)
      await host.resumeSession(worker, window)
      const after = await childAsks(worker, latestHandle(), 'which region?', ['eu', 'us'])
      // ⚑ **The premise, asserted rather than assumed**: they really do share an id.
      expect(after.id).toBe(before.id)

      // ⚑ Every question, the ended ones too: an ended duplicate is what this guards against.
      const rows = (await callOn(agentToolsFor(host, pm), 'list_questions', { state: 'all' }))
        .questions as Record<string, unknown>[]
      // 🔴 **675 · ONE entry for the id, the live one** (`661` F2). ⛔ This listed
      // `['abandoned', 'open']` until `675`, and the abandoned entry carried the LIVE question's words
      // (the last row wins in `questionsRaisedIn`) — an entry no call can reach, since the answer
      // door takes the last row for an id, wearing words that were never its own.
      expect(rows.map((one) => one.state)).toEqual(['open'])
      // 🔴 **The live row's words are the live question's**, which is what the caller acts on.
      expect(String(rows[0]?.words)).toContain('which region?')
      expect(String(rows[0]?.words)).not.toContain('which branch?')
      expect(
        await callOn(agentToolsFor(host, pm), 'answer_question', {
          question: after.id,
          answers: [{ part: 'q0', answer: ['eu'] }],
        }),
      ).toMatchObject({ outcome: 'ok' })
    })

    it('⚑ a conversation nobody has asked anything gets a sentence, not an empty list to interpret', async () => {
      const { pm } = await aPmAndItsWorker()
      const tool = agentToolsFor(host, pm).tools.find((one) => one.name === 'list_questions')
      const answered = await tool!.call({})
      expect(answered.structured).toMatchObject({ outcome: 'ok', questions: [] })
      expect(answered.text).toBe('no conversation you started has asked you anything')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the restart, for all three
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · after the app comes back', () => {
    it('🔴 the stranding survives a relaunch, because it is a ROW rather than a decision', async () => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      await childAsks(worker, workerHandle)
      const next = buildHost(createSessionStore(db, tick))
      await next.resumeSession(pm, window)
      const atTheStranding = next.questionsVisibleTo(pm)
      expect(atTheStranding.map((one) => one.state)).toEqual(['stranded'])

      // ⚑ **Derived again from the ledger alone, by a third host** — criterion 14's shape.
      const third = buildHost(createSessionStore(db, tick))
      await third.resumeSession(pm, window)
      expect(third.questionsVisibleTo(pm)).toEqual(atTheStranding)
      // ⛔ **And the fold agrees when it is handed the raw ledger**, which is the replayed path.
      expect(deriveRoutedRequests(worker, store.events(worker)).map((one) => one.state)).toEqual([
        'stranded',
      ])
    })

    it('⛔ a message flushed to an unwatched child is in the ledger the next launch reads', async () => {
      const { pm, pmProfile, worker, pmTools, workerHandle } = await aPmAndItsWorker()
      reach(pmProfile, { canMessage: 'any' })
      // ⚑ **D-016 · two NOTES** — the first starts a turn and parks it, so the second is held. A
      // note opens nothing, and a follow-up would have to name a piece the child holds.
      await callOn(pmTools, 'message_agent', { agent: worker, text: 'first', kind: 'note' })
      await waitFor(() => workerHandle.status() === 'waiting_permission', 'the child to be working')
      await callOn(pmTools, 'message_agent', { agent: worker, text: 'second', kind: 'note' })
      await host.interrupt(worker, asPm(pm))
      await waitFor(
        () => mailboxOf(store.events(worker)).some((one) => one.ending === 'sent'),
        'the held message to go out',
      )
      await host.closeAll()

      // ⚑ **The CONSTRUCTOR is the act** — `settleStrandedMessages` runs there and finds nothing to
      // repair, which is the point: the message has an ending already, and the one it has is `sent`
      // rather than the `abandoned` a crash writes.
      buildHost(createSessionStore(db, tick))
      expect(mailboxOf(store.events(worker)).map((one) => one.ending)).toEqual(['sent'])
    })

    it('⚠️ a question answered through `list_questions` reads `answered` to the next launch', async () => {
      const { pm, worker } = await askedThenAnswered()
      const next = buildHost(createSessionStore(db, tick))
      await next.resumeSession(pm, window)
      expect(next.questionsVisibleTo(pm).map((one) => one.state)).toEqual(['answered'])
      // ⛔ **And the launch did NOT strand it**, which is the interaction between §2 and §3: a
      // request that was answered is not open, so the sweep passes over it.
      expect(ledger(worker).some((event) => event.type === 'request_stranded')).toBe(false)
    })

    const askedThenAnswered = async (): Promise<{
      pm: string
      worker: string
      asked: { id: string; answered: Promise<UserInputResponse> }
    }> => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      await host.close(pm, window)
      claimed.delete(pm)
      const asked = await childAsks(worker, workerHandle)
      await host.resumeSession(pm, window)
      claimed.add(pm)
      const tools = agentToolsFor(host, pm)
      const rows = (await callOn(tools, 'list_questions')).questions as Record<string, unknown>[]
      expect(rows[0]?.question).toBe(asked.id)
      expect(
        await callOn(tools, 'answer_question', {
          question: asked.id,
          answers: [{ part: 'q0', answer: ['main'] }],
        }),
      ).toMatchObject({ outcome: 'ok' })
      return { pm, worker, asked }
    }
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · the censuses
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · the censuses', () => {
    it('🔴 the flush is OUTSIDE `deliver`’s attention gate — the test that fails if it moves back', () => {
      // ⛔ **396 §5's *"a test that fails if the flush moves back under an attention gate"*.** ⚠️ Not
      // a test that the flush WORKS — §1's first test is that, and this is the one that goes red for
      // a refactor that quietly restores the old shape while every behavioural assertion still
      // passes because a window happened to be attached.
      const body = bodyOf(
        sourceOf(join(mainRoot, 'runtime'), 'runtime-host.ts'),
        'private deliver(',
      )
      const gate = blockAfter(body, 'if (session.sink.alive) {')
      // ⚑ **The control, so the census cannot pass over an empty span**: the gate really does guard
      // the sends, and the walk really did find the block rather than the first nested brace.
      expect(gate).toContain(
        'this.emit(session, { sessionId: session.id, ordinal, at, event: wire })',
      )
      expect(gate).toContain('if (routed !== null) this.emit(session, routed)')
      // 🔴 **And the flush is not in it.**
      expect(gate).not.toContain('flushQueued')
      expect(body).toContain('this.flushQueued(session)')
      // ⛔ **`if (!session.sink.alive) return` is gone from this method**, which is the shape that
      // made position rather than decision the thing a new line inherits.
      expect(body).not.toContain('if (!session.sink.alive) return')
    })

    it('⛔ every `sink.alive` reader in the host is a DELIVERY — the family, enumerated', () => {
      // ⚠️ **A negative needs a search shape** (standing rule 4). The claim is *"nothing else in this
      // class gates WORK on whether anybody is looking"*, and the shape it is measured against is
      // every line of `runtime-host.ts` that reads `sink.alive` — named, classified, and asserted
      // equal, so a new reader arrives here as a red list rather than as a line nobody read.
      const code = codeOnly(sourceOf(join(mainRoot, 'runtime'), 'runtime-host.ts'))
      const readers = code
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.includes('sink.alive'))
        .sort()
      expect(readers).toEqual(
        [
          // ⚑ `deliver` — the one this dispatch changed, now a BLOCK around the sends.
          'if (session.sink.alive) {',
          // ⚑ Four `reportRecordingFailure` guards (`setApprovalMode`, `setSessionSetting`,
          // `endPlanMode`, `recordPlanPhase`) and the liveness callback. Every one publishes a NOTICE
          // to a surface, which is the only thing a dead sink can be right about. ⚑ `740`:
          // `recordPlanPhase`'s also waits on `reportNow` — `deliver` reports after its own send.
          'if (reportNow && session.sink.alive) this.reportRecordingFailure(session)',
          'if (session.sink.alive) this.reportRecordingFailure(session)',
          'if (session.sink.alive) this.reportRecordingFailure(session)',
          'if (session.sink.alive) this.reportRecordingFailure(session)',
          'if (session.sink.alive) {',
          // ⚑ `emitOurs`, `publishAgentInfoIfChanged`, `publishStateIfChanged` — a message and two
          // liveness republishes. All three DELIVER and none of them does anything else.
          'if (!session.sink.alive) return',
          'if (!session.sink.alive) return',
          'if (!session.sink.alive) return',
          // ⚑ **D-004 · R101 — `reopenOnARenewedSignIn` choosing WHERE the reopen is delivered**:
          // onto the window that watched the conversation die, or no window. ⛔ The reopen itself runs
          // either way — the control below holds that.
          'const watching = session.sink.alive && session.sink.aPersonIsBehindIt ? session.sink : null',
          // ⚑ **D-017 · R3 — `startForWhatItHeld` choosing WHERE the restart is delivered**: onto
          // the window that owned the conversation, or no window. ⛔ The start itself runs either way
          // — held below, the way the D-004 member is held by its own test.
          'const watching = session.sink.alive && session.sink.aPersonIsBehindIt ? session.sink : null',
          // ⚑ `keepWhatItsProgramCut` choosing WHERE a stopped program's restart is delivered: onto
          // the window that watched it stop, or no window. ⛔ The restart is planned either way.
          'const watching = session.sink.alive && session.sink.aPersonIsBehindIt ? session.sink : null',
          // ⚑ `placeTheWakeUpsAgain` sending a running conversation's level read again in a moved
          // zone: the row is written either way, and only its send waits on a window.
          'if (said !== null && session.sink.alive) this.emit(session, said)',
          // A row written into a ledger nothing runs, shown to a window that has it open.
          'if (!sink.alive) {',
        ].sort(),
      )
      // ⚑ **The member is a DELIVERY only if `watching` chooses the sink and nothing else** — no
      // branch reads it, so a stop's held messages restart it whether or not anybody is looking.
      const heldAtAStop = bodyOf(
        sourceOf(join(mainRoot, 'runtime'), 'runtime-host.ts'),
        'private async startForWhatItHeld(',
      )
      // ⚑ **D-042 took `ensureRunning`'s third argument away** — `waker`, the agent whose message
      // caused a start, which made that start read the identity's model (R25, 677). Every start now
      // replays its own row's pair, whoever causes it, so the call names the conversation and its
      // window and nothing else.
      expect(heldAtAStop).toMatch(/await this\.startToSendWhatItHeld\(session\.id, watching\)/)
      expect(heldAtAStop.match(/\bwatching\b/g)).toHaveLength(2)
      // ⚑ …and the start by id, which a restore or a kept delete also asks, passes it on untouched.
      const byId = bodyOf(
        sourceOf(join(mainRoot, 'runtime'), 'runtime-host.ts'),
        'private async startToSendWhatItHeld(',
      )
      expect(byId).toMatch(/await this\.ensureRunning\(sessionId, watching\)/)
      expect(byId.match(/\bwatching\b/g)).toHaveLength(2)
    })

    it('⛔ D-004 · the reopen on a renewed sign-in does not wait on somebody looking', () => {
      // ⚑ **The member above is a DELIVERY only if `watching` chooses the sink and nothing else.** A
      // reopen that returned when nobody was watching would pass the line census — its `sink.alive`
      // line would not change — so the body is asked directly.
      const body = bodyOf(
        sourceOf(join(mainRoot, 'runtime'), 'runtime-host.ts'),
        'private async doReopenOnARenewedSignIn(',
      )
      // ⚑ The control: the walk found the method, and `watching` is the sink argument.
      expect(body).toMatch(
        /await this\.timedReopen\('runtime sign-in renewed resume', \(\) =>\s*this\.resumeSession\(/,
      )
      expect(body).toMatch(/resumeSession\(\s*session\.id,\s*watching,/)
      // 🔴 And no branch reads it.
      expect(body.match(/\bwatching\b/g)).toHaveLength(2)
    })

    it('🔴 exactly ONE place writes `request_stranded`, and it is a launch', () => {
      // ⚠️ **The search shape is every `.ts` under `src/main`**, not a grep of the file I expect it
      // in — a second writer is exactly the defect this claim would otherwise hide.
      const files = ['db/session-store.ts', 'runtime/runtime-host.ts']
      const writers = files.filter((file) =>
        codeOnly(sourceOf(mainRoot, file)).includes("type: 'request_stranded'"),
      )
      expect(writers).toEqual(['db/session-store.ts'])
      // ⛔ **And it is reached from the CONSTRUCTOR**, which is the whole warrant for the write: at
      // construction nothing is running, so an open request belongs to a run that ended without
      // saying so.
      const host_ = codeOnly(sourceOf(join(mainRoot, 'runtime'), 'runtime-host.ts'))
      const ctor = host_.slice(
        host_.indexOf('constructor(private readonly deps: RuntimeHostDeps)'),
        host_.indexOf('workInFlight()'),
      )
      // ⚑ **D-009** — past a conversation a quit left OPEN too: its questions survive the quit.
      expect(ctor).toContain('settleStrandedRequests(this.now(), stillOpen, askedSkipped)')
    })

    it('⛔ no timer decides any of this — every ending is derived or written by a launch', () => {
      // ⚑ **396 §4: *a timeout decides that silence means failure after N seconds — a guess dressed
      // as a fact*.** ⚠️ The search shape is the three repairs' own code: the store's sweep and the
      // fold. ⛔ A `setTimeout` in either would be a deadline wearing a derivation's clothes.
      const sweep = bodyOf(
        sourceOf(join(mainRoot, 'db'), 'session-store.ts'),
        'const settleStrandedRequestsTx = db.transaction(',
      )
      for (const clockish of ['setTimeout', 'setInterval', 'Date.now', 'performance.now']) {
        expect(sweep, `${clockish} is in the sweep`).not.toContain(clockish)
      }
      const fold = codeOnly(sourceOf(join(here, '../src/shared'), 'questions.ts'))
      for (const clockish of ['setTimeout', 'setInterval', 'Date.now', 'import(']) {
        expect(fold, `${clockish} is in the fold`).not.toContain(clockish)
      }
      // ⛔ **And the sweep honours `running`** — the half a second host in one process makes true.
      expect(sweep).toContain('if (running.has(asker.id)) continue')
    })

    it('⚠️ the published inventory gained exactly one name, and it is the eleventh', () => {
      // ⛔ **A FIXED index, not `TOOL_NAMES.length - 1`** — *an anchor on a list's last member dies
      // when anything appends*, which `394` learned from `395` and `395` then did again. ⚑ The claim
      // is the position, so the position is what is asserted.
      // ⚑ **D-017 commit 3 · 10 → 9 (the tenth now)**: `end_agent`, published before it, is gone
      // (nothing ends a conversation); `list_questions` still follows `interrupt_agent`.
      expect(TOOL_NAMES.indexOf('list_questions')).toBe(9)
      expect(agentToolsFor(host, 'sess_x').tools.map((one) => one.name)).toEqual([...TOOL_NAMES])
    })

    it('⛔ every request state is reachable or accounted for, and only `open` is answerable', () => {
      // ⚑ **`stranded` is not a member nothing writes** — §2 reaches it — and this pins the table
      // the door refuses through, so a rail with its own idea of which states are endings cannot
      // appear.
      expect(REQUEST_STATES.filter((state) => REQUEST_IS_OPEN[state])).toEqual(['open'])
      expect(REQUEST_STATES).toContain('stranded')
      expect(REQUEST_IS_OPEN.stranded).toBe(false)
    })
  })
})
