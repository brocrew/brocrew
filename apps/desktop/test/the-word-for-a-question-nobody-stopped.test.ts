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
  UserInputResponse,
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
import { REQUEST_IS_OPEN, REQUEST_STATES, deriveRoutedRequests } from '../src/shared/questions'
import type { RequestState } from '../src/shared/questions'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * 🔴 **397 · the word for a question nobody stopped** — Slice 4 S6, the last build dispatch of the
 * slice, and the residue `396` §7 reported and refused to fix in passing.
 *
 * ## ⛔ The defect, in one sentence
 *
 * **Both adapters call `settleRequests()` inside `interrupt()`, and it writes nothing.**
 * `RequestBroker.settleAll` safe-rejects every pending card — a permission as `{outcome:'deny'}`, a
 * question as `{kind:'reject'}` — so the provider is told *no* on somebody's behalf and no row
 * anywhere says so. ⚠️ The derived request went on reading `open`: *nobody has ended this*, about a
 * thing this app had just ended.
 *
 * ## 🔴 Where the brief was wrong, and it is the reason the word matters
 *
 * ⛔ **`397` §1 says *"until the next launch, `list_questions` lists it as `open`"*, which reads as
 * though the launch repairs it.** It does not. `396`'s sweep closes anything still open at a launch
 * as `stranded` — ***the app had stopped*** — and the app had not stopped: somebody pressed Stop and
 * it kept running. ⚑ So the residue was not a stale row that ages out; it was a row that ages into
 * the WRONG WORD, written by the newest thing in the tree. §5 measures both halves.
 *
 * ## ⚠️ Why the word is not one of the six that already existed
 *
 *  - **not `rejected`** — nobody DECIDED. `settleAll` answers the socket because the socket needs an
 *    answer, and recording that as a decision is HO-005 Q2 written into the ledger.
 *  - **not `withdrawn`** — that is the PROVIDER clearing a request (`051`), and this is the app.
 *  - **not `abandoned`** — the conversation did not end. §3 is the case that proves the two must
 *    stay different: `endAgent` stops the turn AND ends the conversation, and its questions are
 *    `abandoned`, because *ask it again* is the wrong advice about a conversation that is gone.
 *    ⚑ **D-017** — `endAgent` is gone; a person's Close stops the turn and the conversation, and
 *    its questions are `abandoned` too (the census of every word, below).
 *  - **not `stranded`** — the app did not stop.
 *
 * ## ⛔ And the word says WHAT, never WHO — which is `395`'s ruling, not an omission
 *
 * `how-work-stopped.ts`: *"`HowWorkStopped` is about the WORK; `WhoAskedItToStop` is about a
 * GESTURE… folding them into one vocabulary is how 'it was stopped' comes to imply 'a person did
 * it'"* — the false sentence `395` spent a dispatch removing. ⚑ **So the actor is a NEIGHBOURING
 * ROW**: `askTheWorkToStop` writes `work_interrupted` and then one `request_interrupted` per open
 * request, in one synchronous stretch, at adjacent ordinals. §6 pins the adjacency.
 *
 * ## ⚑ The fourth door nobody had noticed
 *
 * ⛔ **`395` claimed one function recorded every stop and there were four doors, not three.**
 * `runSendInterrupting` — *type while it is working* — interrupted a turn and wrote only
 * `noteUserCommand`'s breadcrumb, which is gated on `mayControl` and silent for every commanded
 * caller. ⚑ `396` §2.1's lesson one shape over: an early `return` made gate membership a property of
 * POSITION; a write repeated at N call sites makes it a property of MEMORY. **`askTheWorkToStop` is
 * now the only path to `SessionHandle.interrupt()`**, and §7 asserts that rather than trusting it.
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

describe('397 · the word for a question nobody stopped', () => {
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

  /** `396`'s builder — `over` is what makes a CRASH and an exclusion two different tests (§5). */
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-word-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-word-root-'))
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
    provider: Provider = 'claude',
    approvalMode: 'ask' | 'auto' = 'ask',
  ): Promise<string> => {
    const { sessionId } = await on.createSession(
      { provider, profileId, approvalMode, cwd: root },
      window,
    )
    claimed.add(sessionId)
    return sessionId
  }

  // ⚑ On the provider its conversations will run on: an agent keeps the one it first ran on.
  const bringIdentityIntoBeing = async (
    profileId: string,
    provider: Provider = 'claude',
  ): Promise<void> => {
    const id = await personOpens(profileId, host, provider)
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

  const textOf = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<string> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).text
  }

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const latestHandle = (): FakeSessionHandle => {
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('no provider handle has been issued')
    return handle
  }

  const reach = (profileId: string, edit: { canMessage?: string; canInterrupt?: string }): void => {
    expect(store.setCapabilities(profileId, edit as never)).toBe(true)
  }

  /**
   * `393`'s helper: a PM in a window with one child of its own, started through the real door.
   * ⚑ **D-016** — `give_work` starts it, and the brief is its first turn, run in the giver's mode.
   * ⚠️ So the PM is in `auto`, where the brief's turn ends at once and the worker is idle, as a
   * spawned child was; {@link busy} puts the worker back in `ask` for the cases that need a card.
   */
  const aPmAndItsWorker = async (
    provider: Provider = 'claude',
  ): Promise<{
    pm: string
    pmProfile: string
    worker: string
    pmTools: AgentToolset
    workerHandle: FakeSessionHandle
  }> => {
    const nth = ++pairs
    const pmProfile = `pm-${String(nth)}`
    const workerProfile = `worker-${String(nth)}`
    const siblings = [workerProfile, `${workerProfile}-b`]
    for (const one of siblings) await bringIdentityIntoBeing(one, provider)
    const pm = await personOpens(pmProfile, host, provider, 'auto')
    const pmTools = agentToolsFor(host, pm)
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: workerProfile,
      title: 'The work',
      brief: 'the work this dispatch is about',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    await waitFor(
      () => ledger(worker).some((event) => event.type === 'turn'),
      'the brief’s turn to end',
    )
    return { pm, pmProfile, worker, pmTools, workerHandle: latestHandle() }
  }

  /** `394`'s helper — raise a question on the child and wait for the app to have ROUTED it. */
  const childAsks = async (
    child: string,
    handle: FakeSessionHandle,
    prompt = 'which branch?',
    options: readonly string[] = ['main', 'dev'],
  ): Promise<{ id: string; answered: Promise<UserInputResponse> }> => {
    const raised = handle.simulateUserInput(prompt, options, false)
    await waitFor(
      () =>
        ledger(child).some(
          (event) => event.type === 'request_routed' && event.requestId === raised.id,
        ),
      `the routing of ${raised.id}`,
    )
    return raised
  }

  /** The one derived row for a request, by id, off the store's own narrow read. */
  const rowFor = (child: string, id: string): { state: RequestState; endedAt: number | null } => {
    const found = store.routedRequestsOf(child).find((one) => one.requestId === id)
    if (found === undefined) throw new Error(`no routed request ${id} on ${child}`)
    return { state: found.state, endedAt: found.endedAt }
  }

  const busy = async (
    sessionId: string,
    handle: FakeSessionHandle,
    by: { ownerId: string } = window,
  ): Promise<void> => {
    // ⚑ **D-016** — a given worker runs in its giver's `auto`; only `ask` parks a turn on a card.
    await host.setApprovalMode(sessionId, 'ask', window)
    await host.send(sessionId, 'a long piece of work', by)
    await waitFor(
      () => handle.status() === 'waiting_permission',
      'the turn to park on its permission card',
    )
    // ⚠️ **The handle's status moves before the ROW lands** — the card reaches the ledger through
    // the event pump — so a caller that reads the card's id needs the second wait, not the first.
    await waitFor(
      () => ledger(sessionId).some((event) => event.type === 'permission_request'),
      'the card to reach the ledger',
    )
  }

  /** The open card's id, off the ledger the app actually wrote. */
  const cardOn = (sessionId: string): string => {
    const asked = ledger(sessionId).find((event) => event.type === 'permission_request')
    if (asked === undefined || asked.type !== 'permission_request') {
      throw new Error(`no permission request on ${sessionId}`)
    }
    return asked.id
  }

  const sourceOf = (dir: string, file: string): string => readFileSync(join(dir, file), 'utf8')
  const codeOnly = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the residue, and the word it now gets
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · a question a person stopped', () => {
    it('🔴 the headline: an interrupted turn ENDS the questions it was holding', async () => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const asked = await childAsks(worker, workerHandle)
      // ⛔ **Open before the stop, so the assertion below is a CHANGE and not a starting state.**
      expect(rowFor(worker, asked.id).state).toBe('open')
      expect(REQUEST_IS_OPEN[rowFor(worker, asked.id).state]).toBe(true)

      host.claimSession(worker, window)
      claimed.add(worker)
      await host.interrupt(worker, window)

      const after = rowFor(worker, asked.id)
      expect(after.state).toBe('interrupted')
      expect(after.endedAt).not.toBeNull()
      expect(REQUEST_IS_OPEN[after.state]).toBe(false)
      // ⚑ **And the provider really was answered on somebody's behalf**, which is the act the row
      // is recording. `settleAll` safe-rejects, so the child's own await resolves as a rejection.
      await expect(asked.answered).resolves.toEqual({ kind: 'reject' })
      expect(pm).toBeTruthy()
    })

    it('⛔ `list_questions` stops calling it open, and the line says what happened', async () => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const pmTools = agentToolsFor(host, pm)
      const asked = await childAsks(worker, workerHandle)
      // ⚠️ **The reader is measured BEFORE as well**, because *"it no longer says open"* is only a
      // repair if it said `open` a moment ago — `396` shipped this reader, and a reader that reports
      // `open` for something nobody can answer is *nothing unwired implies a working state*.
      const before = await callOn(pmTools, 'list_questions')
      expect(JSON.stringify(before.questions)).toContain('"state":"open"')
      expect(await textOf(pmTools, 'list_questions')).toContain('1 waiting on you')

      host.claimSession(worker, window)
      claimed.add(worker)
      await host.interrupt(worker, window)

      // ⚑ A question that is over is listed when asked for.
      const after = await callOn(pmTools, 'list_questions', { state: 'all' })
      const rows = after.questions as { question: string; state: string }[]
      expect(rows.find((one) => one.question === asked.id)?.state).toBe('interrupted')
      const said = await textOf(pmTools, 'list_questions', { state: 'all' })
      expect(said).toContain('nothing is waiting on you')
      // ⛔ **Scoped to THIS request's line, not to the whole answer** — *a file-level `contains`
      // cannot tell sibling declarations apart*, and this reader prints one line per question.
      const line = said.split('\n').find((one) => one.includes(asked.id)) ?? ''
      expect(line).toContain('interrupted')
      // ⛔ **The sentence, by name** (standing rule 5): a word a model has never seen needs the fact
      // it stands for, and the fact is that the conversation is still there.
      // 🔴 **709 · R43 — `interrupted` is written at the ASK**, before the provider answers, so the
      // sentence says the ask: the turn it was raised in may yet have completed.
      expect(line).toContain(
        '(the work it was raised in was asked to stop, so it was never answered — that conversation is still there, ask it again)',
      )
      // ⚠️ **And it never names an actor.** `WHO_ASKED_IT_TO_STOP` is about a gesture and belongs to
      // `work_interrupted`; *"a person stopped it"* here would be `222`'s false sentence in a tool
      // payload — it is as often the reading agent's own `interrupt_agent`.
      expect(line).not.toContain('a person')
      expect(line).not.toContain('an agent')
    })

    it('⚑ TWO open questions, one interruption, and both get the ending', async () => {
      // ⛔ **Standing rule 12: a census needs a control that plants TWO.** `settleAll` kills every
      // pending card, so a writer that recorded the first — `[0]`, `.find`, a `break` — would leave
      // a request reading `open` that had just been safe-rejected.
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const first = await childAsks(worker, workerHandle, 'which branch?')
      const second = await childAsks(worker, workerHandle, 'which remote?', ['origin', 'upstream'])
      expect(first.id).not.toBe(second.id)
      host.claimSession(worker, window)
      claimed.add(worker)
      await host.interrupt(worker, window)
      expect(rowFor(worker, first.id).state).toBe('interrupted')
      expect(rowFor(worker, second.id).state).toBe('interrupted')
      // ⚑ Two rows, not one summary: the ledger can enumerate what the act destroyed.
      const written = ledger(worker).filter((event) => event.type === 'request_interrupted')
      expect(written.map((event) => (event as { requestId: string }).requestId).sort()).toEqual(
        [first.id, second.id].sort(),
      )
      expect(pm).toBeTruthy()
    })

    it('⚠️ a SECOND interruption over a repaired ledger changes nothing', async () => {
      // ⛔ **Idempotence, `request_stranded`'s property one ending over** — and the reason it holds
      // is the FOLD: `settle` is a no-op for a row that is already closed, so a stop that finds
      // nothing open writes nothing and a stop that races one cannot reopen it.
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const asked = await childAsks(worker, workerHandle)
      host.claimSession(worker, window)
      claimed.add(worker)
      await host.interrupt(worker, window)
      const first = rowFor(worker, asked.id)
      await host.interrupt(worker, window)
      expect(rowFor(worker, asked.id)).toEqual(first)
      expect(ledger(worker).filter((event) => event.type === 'request_interrupted')).toHaveLength(1)
      expect(pm).toBeTruthy()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · every OTHER ending still gets its own word
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the paired negatives — plant all the endings, not just this one', () => {
    it('⛔ answered, rejected, decided, withdrawn and abandoned are untouched', async () => {
      // ⚑ **Put the hazard on the path the code walks**: every other way a request can end, in one
      // ledger, so *"an interruption gives `interrupted`"* is a claim about one transition rather
      // than a state that swallowed the vocabulary.
      const seen = new Map<string, RequestState>()

      // — answered, by the parent through the real door
      {
        const { pm, pmProfile, worker, pmTools, workerHandle } = await aPmAndItsWorker()
        reach(pmProfile, { canMessage: 'any' })
        const asked = await childAsks(worker, workerHandle)
        const said = await callOn(pmTools, 'answer_question', {
          question: asked.id,
          answers: [{ part: 'q0', answer: ['main'] }],
        })
        expect(said.outcome, JSON.stringify(said)).toBe('ok')
        seen.set('answered', rowFor(worker, asked.id).state)
        expect(pm).toBeTruthy()
      }
      // — rejected, by a person on the child's own card
      {
        const { worker, workerHandle } = await aPmAndItsWorker()
        const asked = await childAsks(worker, workerHandle)
        host.claimSession(worker, window)
        claimed.add(worker)
        await host.respondUserInput(worker, asked.id, { kind: 'reject' }, window)
        seen.set('rejected', rowFor(worker, asked.id).state)
      }
      // — decided, a PERMISSION a person allowed
      {
        const { worker, workerHandle } = await aPmAndItsWorker()
        host.claimSession(worker, window)
        claimed.add(worker)
        await busy(worker, workerHandle, window)
        const id = cardOn(worker)
        await host.respondPermission(worker, id, { outcome: 'allow' }, window)
        seen.set('decided', rowFor(worker, id).state)
      }
      // — withdrawn, by the PROVIDER clearing it (051)
      {
        const { worker, workerHandle } = await aPmAndItsWorker()
        const asked = await childAsks(worker, workerHandle)
        workerHandle.simulateRequestResolved(asked.id)
        await waitFor(
          () => rowFor(worker, asked.id).state === 'withdrawn',
          'the provider withdrawal to land',
        )
        seen.set('withdrawn', rowFor(worker, asked.id).state)
      }
      // — abandoned, the conversation ending underneath it
      {
        const { worker, workerHandle } = await aPmAndItsWorker()
        const asked = await childAsks(worker, workerHandle)
        host.claimSession(worker, window)
        claimed.add(worker)
        await host.close(worker, window)
        seen.set('abandoned', rowFor(worker, asked.id).state)
      }

      expect(Object.fromEntries(seen)).toEqual({
        answered: 'answered',
        rejected: 'rejected',
        decided: 'decided',
        withdrawn: 'withdrawn',
        abandoned: 'abandoned',
      })
    })

    // ⚑ **D-017 · commit 3** — *`end_agent` gives `abandoned`, NOT `interrupted`* went with
    // `end_agent`: it was the one door that recorded an ask AND then ended the conversation, and no
    // door does both now. ⚑ The word itself is still measured above — a person's Close, which stops
    // the turn and the conversation, leaves its questions `abandoned`.
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · every door that stops a turn, including the one that recorded nothing
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · the doors', () => {
    it('🔴 the FOURTH door — `sendInterrupting` — records the ask and ends the questions', async () => {
      // ⛔ **`395` shipped *"exactly ONE place records the ask, so no door can write it a second
      // way"* and its own census counted THREE call sites.** There were four doors. This one — a
      // person typing while a child is working — wrote only `noteUserCommand`'s breadcrumb, which is
      // gated on `mayControl` and silent for every commanded caller, so `howWorkStopped` answered
      // `who: null` for a gesture this app knew the author of.
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const asked = await childAsks(worker, workerHandle)
      host.claimSession(worker, window)
      claimed.add(worker)
      await busy(worker, workerHandle, window)
      await host.sendInterrupting(worker, 'no, do this instead', window)
      expect(rowFor(worker, asked.id).state).toBe('interrupted')
      // ⚑ **And the ask itself**, which is the half `395` believed it already had.
      expect(ledger(worker).some((event) => event.type === 'work_interrupted')).toBe(true)
      // ⛔ **Read through the SURFACE's own reader, not by re-folding here.** `lastEndedTurn` narrows
      // to one turn by `events.turn_id` — which is the whole reason the ask is written before the
      // terminal — and it is what the Sessions row and the transcript both read. ⚑ Before `397`
      // this answered `who: null` for this gesture: *it was stopped, and this ledger does not say by
      // whom*, about a stop the app itself performed.
      const stop = store.lastEndedTurn(worker)
      expect(stop?.how).toBe('it-was-stopped')
      expect(stop?.who).toBe('a-person')
      expect(pm).toBeTruthy()
    })

    it('⚠️ an IDLE session interrupted-and-sent records nothing, because nothing was stopped', async () => {
      // ⛔ **`039`: the ledger may not claim a gesture happened.** `runSendInterrupting` only touches
      // the provider when the session is not idle, and the ask is written INSIDE that branch — so
      // the condition the row inherits is the one condition that genuinely belongs to it.
      const worker = await personOpens('lonely')
      await host.sendInterrupting(worker, 'just a message', window)
      expect(ledger(worker).some((event) => event.type === 'work_interrupted')).toBe(false)
      expect(ledger(worker).some((event) => event.type === 'request_interrupted')).toBe(false)
    })

    it("⛔ the AGENT's door never reaches a card — `a-person-is-being-asked` is in front of it", async () => {
      // ⚑ **The rail `395` built, measured as the reason this ending has no agent producer in
      // practice.** A session with an open card reads `waiting_permission`, and `admitInterrupt`
      // refuses there — *cutting in would throw that question away and answer it as a refusal*.
      // ⛔ So the row exists for the person's doors, and an agent cannot destroy somebody's card
      // through this verb.
      const { pm, pmProfile, worker, pmTools, workerHandle } = await aPmAndItsWorker()
      reach(pmProfile, { canInterrupt: 'same-project' })
      host.claimSession(worker, window)
      claimed.add(worker)
      await busy(worker, workerHandle, window)
      const said = await callOn(pmTools, 'interrupt_agent', { agent: worker, reason: 'stop' })
      expect(said.rail).toBe('a-person-is-being-asked')
      expect(ledger(worker).some((event) => event.type === 'request_interrupted')).toBe(false)
      // ⚑ **The control one fact over** (standing rule 3): the identical call on the identical child
      // with nothing open SUCCEEDS, so the refusal above is the card's doing and not the verb's.
      await host.respondPermission(worker, cardOn(worker), { outcome: 'allow' }, window)
      await waitFor(() => workerHandle.status() === 'idle', 'the child to come back to idle')
      const again = await callOn(pmTools, 'interrupt_agent', { agent: worker, reason: 'stop' })
      expect(again.outcome, JSON.stringify(again)).toBe('ok')
      expect(pm).toBeTruthy()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · both providers, and the one that never answers
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · both providers', () => {
    for (const provider of ['claude', 'codex'] as const) {
      it(`⛔ ${provider}: the ending is written above the adapter, so nothing carries over from it`, async () => {
        // ⚠️ **`394` and `395` each measured that the two adapters differ in KIND on the channel they
        // touched.** ⛔ This repair does not touch either of them: the rows are written by the HOST,
        // before `SessionHandle.interrupt()` is called at all — so what a provider does with the
        // interruption cannot change whether the questions got an ending. §7 asserts the runtime
        // package never names the event.
        const { pm, worker, workerHandle } = await aPmAndItsWorker(provider)
        // ⚑ **Non-vacuity**: a child an agent with no provider of its own is given work in runs on
        // its giver's (`spawn-rails.ts`, `… ?? itsProvider ?? giving.provider`), so this loop really
        // does run twice over two adapters rather than twice over one.
        expect(store.recordedOne(worker)?.provider).toBe(provider)
        const asked = await childAsks(worker, workerHandle)
        host.claimSession(worker, window)
        claimed.add(worker)
        await host.interrupt(worker, window)
        expect(rowFor(worker, asked.id).state).toBe('interrupted')
        expect(pm).toBeTruthy()
      })
    }

    it('🔴 a provider whose `interrupt()` NEVER returns still gets its questions ended', async () => {
      // ⛔ **This is Codex's real shape and it is why the ordering is load-bearing.** With a turn
      // live, `CodexSessionHandle.interrupt()` fires `turn/interrupt` and awaits its ANSWER,
      // UNBOUNDED — so an app-server that never answers leaves that promise pending for ever (709
      // corrected *"accepts the RPC and never completes"*, which releases it). ⚑ A row written after the await would not exist on
      // exactly the session somebody is trying to explain.
      const { pm, worker, workerHandle } = await aPmAndItsWorker('codex')
      const asked = await childAsks(worker, workerHandle)
      host.claimSession(worker, window)
      claimed.add(worker)
      let reached = false
      workerHandle.interrupt = async (): Promise<void> => {
        reached = true
        await new Promise<void>(() => {
          /* the wedged app-server */
        })
      }
      // ⚠️ **Deliberately not awaited** — the door waits on the provider (up to its bound since
      // `720`), and the provider never answers. The claim is about what is in the ledger by then.
      void host.interrupt(worker, window)
      await waitFor(() => reached, 'the provider to be asked')
      expect(rowFor(worker, asked.id).state).toBe('interrupted')
      expect(pm).toBeTruthy()
    })

    it('⚠️ a provider that THROWS on interrupt has still had its questions ended', async () => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const asked = await childAsks(worker, workerHandle)
      host.claimSession(worker, window)
      claimed.add(worker)
      workerHandle.interrupt = async (): Promise<void> => {
        throw new Error('the provider refused the interrupt')
      }
      await expect(host.interrupt(worker, window)).rejects.toThrow('refused the interrupt')
      expect(rowFor(worker, asked.id).state).toBe('interrupted')
      expect(pm).toBeTruthy()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · the restart — and the wrong word 396 would otherwise have given it
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · across a real restart', () => {
    it('🔴 the ending survives, and the launch does NOT re-label it `stranded`', async () => {
      // ⛔ **The half `397` §1 got wrong.** The brief reads as though the next launch repairs the
      // stale row. It does not: `settleStrandedRequests` closes anything still open as `stranded`,
      // which claims *the app had stopped* about a session somebody pressed Stop in. ⚑ With the
      // ending written where the act happened, the sweep finds nothing open and says nothing.
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const asked = await childAsks(worker, workerHandle)
      host.claimSession(worker, window)
      claimed.add(worker)
      await host.interrupt(worker, window)
      await host.closeAll()

      const afterQuit = rowFor(worker, asked.id)
      const next = buildHost()
      const rebuilt = rowFor(worker, asked.id)
      expect(rebuilt).toEqual(afterQuit)
      expect(rebuilt.state).toBe('interrupted')
      expect(ledger(worker).some((event) => event.type === 'request_stranded')).toBe(false)
      // ⚑ **And the reader a parent uses reads the same word after the restart**, which is the only
      // place the word has consequences.
      const resumed = await next.resumeSession(pm, window)
      expect(resumed.sessionId).toBe(pm)
      const listed = await textOf(agentToolsFor(next, pm), 'list_questions')
      expect(listed).toContain('interrupted')
      expect(listed).toContain('nothing is waiting on you')
    })

    it('⚑ `stranded` is still REACHABLE — a request nobody stopped, left open by a crash', async () => {
      // ⛔ **`396`'s ending must not be made unreachable by `397`'s.** A rail nothing reaches passes
      // vacuously, and an ending nothing writes is the same defect one vocabulary over. ⚠️ The crash
      // is a SECOND host over a NEW store object, which is what `live-hosts.ts` reads as *nothing is
      // running* — `396`'s own paragraph.
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const asked = await childAsks(worker, workerHandle)
      expect(rowFor(worker, asked.id).state).toBe('open')
      const fresh = createSessionStore(db, tick)
      buildHost(fresh)
      expect(fresh.routedRequestsOf(worker).find((one) => one.requestId === asked.id)?.state).toBe(
        'stranded',
      )
      expect(pm).toBeTruthy()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §6 · the answer door can name the ending now
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§6 · what a parent is told when it answers too late', () => {
    it('🔴 `question-has-already-ended` now carries `detail.state: interrupted`', async () => {
      // ⛔ **`394` shipped this refusal WITHOUT a state on this path, and said why**: the adapter
      // bounced the answer as `not-pending`, the fold still said `open`, and *"reporting that word
      // would be this app stating the wrong half."* ⚑ There is a right word now, so the rail fires
      // ABOVE the adapter and the refusal names the ending — which is what `393`'s
      // `task-already-ended` established the shape for.
      const { pm, pmProfile, worker, pmTools, workerHandle } = await aPmAndItsWorker()
      reach(pmProfile, { canMessage: 'any' })
      const asked = await childAsks(worker, workerHandle)
      host.claimSession(worker, window)
      claimed.add(worker)
      await host.interrupt(worker, window)
      const said = await callOn(pmTools, 'answer_question', {
        question: asked.id,
        answers: [{ part: 'q0', answer: ['main'] }],
      })
      expect(said.rail).toBe('question-has-already-ended')
      expect(said.permanence).toBe('permanent')
      expect((said.detail as { state?: string }).state).toBe('interrupted')
      expect(pm).toBeTruthy()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §7 · the censuses
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§7 · the censuses', () => {
    it('⛔ exactly ONE writer of the ending, and exactly ONE line reaches the provider', async () => {
      // ⚠️ **A negative needs a search shape.** The claim is *"no door can stop a turn without
      // writing these rows"* — so the enumeration is every `.ts` under `src/main`, comments
      // stripped, looking for the event type and for the provider call rather than for a word.
      const sources = readdirSync(mainRoot, { recursive: true, encoding: 'utf8' })
        .filter((entry) => typeof entry === 'string' && entry.endsWith('.ts'))
        .map((entry) => ({
          path: entry.replaceAll('\\', '/'),
          text: codeOnly(readFileSync(join(mainRoot, entry), 'utf8')),
        }))
      expect(
        sources
          .filter(({ text }) => text.includes("type: 'request_interrupted'"))
          .map((o) => o.path),
      ).toEqual(['runtime/runtime-host.ts'])
      const host_ = sources.find((one) => one.path === 'runtime/runtime-host.ts')?.text ?? ''
      expect(host_.split("type: 'request_interrupted'")).toHaveLength(2)
      // 🔴 **The structural claim**: one line in the whole app calls the provider's interrupt, and it
      // is inside the method that writes the rows. A fifth door cannot be added without going
      // through it. ⚑ This is the assertion `395`'s three-call-site count could not make.
      expect(host_.split('session.handle.interrupt()')).toHaveLength(2)
      // ⚑ **The control** (standing rule 12): the same counting shape finds SEVERAL callers of the
      // method, so *"exactly one line"* above is a count and not a reader that stopped at the first
      // match in a 10,000-line file. ⚑ Four since a held message may ask the turn it waits behind to stop.
      expect(host_.split('this.askTheWorkToStop(')).toHaveLength(5)
      expect(sources.length).toBeGreaterThan(20)
    })

    it('⛔ the ROWS are neighbours — the ask, then the endings, then the provider', async () => {
      // 🔴 **The word says WHAT and the neighbouring row says WHO**, and this is what makes that a
      // property of the ledger rather than of a paragraph. ⚠️ Asserted on the real ledger and not
      // only in the source: two rows written in one synchronous stretch take consecutive ordinals.
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const first = await childAsks(worker, workerHandle, 'which branch?')
      const second = await childAsks(worker, workerHandle, 'which remote?', ['origin', 'upstream'])
      host.claimSession(worker, window)
      claimed.add(worker)
      await host.interrupt(worker, window)
      const entries = store.events(worker)
      const ask = entries.find((entry) => entry.event.type === 'work_interrupted')
      const endings = entries.filter((entry) => entry.event.type === 'request_interrupted')
      expect(ask).toBeDefined()
      expect(endings).toHaveLength(2)
      expect(endings.map((entry) => entry.ordinal)).toEqual([
        (ask?.ordinal ?? -1) + 1,
        (ask?.ordinal ?? -1) + 2,
      ])
      expect(first.id).not.toBe(second.id)
      expect(pm).toBeTruthy()
    })

    it('⚠️ the ADAPTERS were not touched — the repair is entirely above them', async () => {
      // ⛔ **`396` §2.1's correction, generalised: the fix belongs where the fact is known.** The
      // adapters know a card was settled; only the app knows the card was a routed request. ⚑ So the
      // runtime package never names this event, and `settleRequests` on both adapters is still what
      // it was — which is also what makes the claim *"both providers"* structural rather than
      // measured twice.
      const runtimeRoot = join(here, '../../../packages/runtime/src')
      const runtimeSources = readdirSync(runtimeRoot, { recursive: true, encoding: 'utf8' })
        .filter((entry) => typeof entry === 'string' && entry.endsWith('.ts'))
        .map((entry) => readFileSync(join(runtimeRoot, entry), 'utf8'))
      expect(runtimeSources.length).toBeGreaterThan(10)
      expect(runtimeSources.filter((text) => text.includes('request_interrupted'))).toHaveLength(0)
      // ⚑ **The control**: the same sweep DOES find the call this dispatch is about, so an empty
      // answer above means *the runtime does not name it* rather than *the sweep read nothing*.
      expect(
        runtimeSources.filter((text) => text.includes('this.settleRequests()')).length,
      ).toBeGreaterThan(1)
    })

    it('⛔ no timer decides this, in the app or in the fold', () => {
      // ⚠️ **`396` §4, standing**: *a timeout decides that silence means failure after N seconds — a
      // guess dressed as a fact*. This ending is written by an ACT, and the fold is pure.
      const fold = sourceOf(join(here, '../src/shared'), 'questions.ts')
      for (const machinery of ['setTimeout', 'setInterval', 'Date.now']) {
        expect(fold, machinery).not.toContain(machinery)
      }
      const imports = [...fold.matchAll(/^import .*$/gm)].map((one) => one[0])
      expect(imports.every((line) => line.startsWith('import type'))).toBe(true)
      const stopper = codeOnly(sourceOf(join(mainRoot, 'runtime'), 'runtime-host.ts'))
      const at = stopper.indexOf('private askTheWorkToStop(')
      expect(at).toBeGreaterThan(0)
      const body = stopper.slice(at, stopper.indexOf('\n  }', at))
      for (const machinery of ['setTimeout', 'setInterval', 'withTimeout']) {
        expect(body, machinery).not.toContain(machinery)
      }
    })

    it('⚑ the state table stayed exhaustive, and only `open` is still somebody’s to answer', () => {
      expect(REQUEST_STATES).toContain('interrupted')
      expect(REQUEST_IS_OPEN.interrupted).toBe(false)
      expect(REQUEST_STATES.filter((state) => REQUEST_IS_OPEN[state])).toEqual(['open'])
      // ⛔ **The fold is the only thing that writes this state**, so a second reading of *"is it
      // still open"* cannot appear beside it. `agent-tools.ts` filters through the table by name.
      const tools = codeOnly(sourceOf(join(mainRoot, 'runtime'), 'agent-tools.ts'))
      expect(tools).toContain('REQUEST_IS_OPEN[one.request.state]')
      expect(tools).not.toMatch(/state === 'open'/)
    })

    it('🔴 the fold derives it, and a ledger with no ending derives nothing', () => {
      // ⛔ **The pure half, on hand-built entries** — so *"the row is a function of the ledger"* is
      // measured rather than inferred from a host that also does eleven other things. ⚑ The pair is
      // the point: identical ledgers but for one row, and the row is what moves the state.
      const routed = {
        ordinal: 0,
        at: 10,
        event: {
          type: 'request_routed' as const,
          requestId: 'req_1',
          to: 'the-parent' as const,
          parent: 'sess_p',
        },
      }
      const without = deriveRoutedRequests('sess_c', [routed])
      expect(without[0]?.state).toBe('open')
      const withIt = deriveRoutedRequests('sess_c', [
        routed,
        { ordinal: 1, at: 11, event: { type: 'request_interrupted' as const, requestId: 'req_1' } },
      ])
      expect(withIt[0]?.state).toBe('interrupted')
      expect(withIt[0]?.endedAt).toBe(11)
      // ⚠️ **An ending for an id this ledger never routed moves nothing** — the fold closes rows it
      // opened, so a stray row cannot manufacture a request.
      const stray = deriveRoutedRequests('sess_c', [
        routed,
        { ordinal: 1, at: 11, event: { type: 'request_interrupted' as const, requestId: 'other' } },
      ])
      expect(stray).toHaveLength(1)
      expect(stray[0]?.state).toBe('open')
    })
  })
})
