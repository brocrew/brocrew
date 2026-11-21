import { newConversationGive } from './lib/give-fixture'
import { agentToolSourcePaths } from './helpers/agent-tool-source'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import { waitFor } from './lib/f093-host'
import { REQUEST_STATES } from '../src/shared/question-contracts'
import type { RequestState } from '../src/shared/question-contracts'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgentToolset, FakeSessionHandle, UserInputResponse } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { REQUEST_IS_OPEN, deriveRoutedRequests } from '../src/shared/questions'
import {
  fixtureProviderConfig,
  RecordingSink,
  syntheticProviderHome,
  neutralHostDeps,
} from './lib/host-fixture'
import { ProviderDouble } from './lib/provider-double'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const mainRoot = join(here, '../src/main')

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
      ...neutralHostDeps(() => userData),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued),
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
    const given = await callOn(
      pmTools,
      'give_work',
      newConversationGive(workerProfile, 'The work', 'the work this dispatch is about'),
    )
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

    it('an interrupted native question ends on its own ledger and never enters the agent list', async () => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const pmTools = agentToolsFor(host, pm)
      const asked = await childAsks(worker, workerHandle)
      expect(rowFor(worker, asked.id).state).toBe('open')
      expect((await callOn(pmTools, 'list_questions')).questions).toEqual([])
      host.claimSession(worker, window)
      claimed.add(worker)
      await host.interrupt(worker, window)
      expect(rowFor(worker, asked.id).state).toBe('interrupted')
      expect((await callOn(pmTools, 'list_questions', { state: 'all' })).questions).toEqual([])
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

      // — answered by the person on the native card
      {
        const { pm, worker, workerHandle } = await aPmAndItsWorker()
        const asked = await childAsks(worker, workerHandle)
        host.claimSession(worker, window)
        claimed.add(worker)
        const said = await host.respondUserInput(
          worker,
          asked.id,
          { kind: 'answer', answers: { q0: ['main'] } },
          window,
        )
        expect(said.outcome, JSON.stringify(said)).toBe('taken')
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
      const { pm, worker, pmTools, workerHandle } = await aPmAndItsWorker()
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
      expect(listed).not.toContain(asked.id)
      expect(listed).toBe('no conversation you started has asked you anything')
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
    it('an agent cannot answer an interrupted native question', async () => {
      // ⛔ **`394` shipped this refusal WITHOUT a state on this path, and said why**: the adapter
      // bounced the answer as `not-pending`, the fold still said `open`, and *"reporting that word
      // would be this app stating the wrong half."* ⚑ There is a right word now, so the rail fires
      // ABOVE the adapter and the refusal names the ending — which is what `393`'s
      // `task-already-ended` established the shape for.
      const { pm, worker, pmTools, workerHandle } = await aPmAndItsWorker()
      const asked = await childAsks(worker, workerHandle)
      host.claimSession(worker, window)
      claimed.add(worker)
      await host.interrupt(worker, window)
      const said = await callOn(pmTools, 'answer_question', {
        question: asked.id,
        answers: [{ part: 'q0', answer: ['main'] }],
      })
      expect(said.rail).toBe('no-question-by-that-name')
      expect(said.permanence).toBe('permanent')
      expect(rowFor(worker, asked.id).state).toBe('interrupted')
      expect(pm).toBeTruthy()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §7 · the censuses
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§7 · the censuses', () => {
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

    it('⚑ the state table stayed exhaustive, and only `open` is still somebody’s to answer', () => {
      expect(REQUEST_STATES).toContain('interrupted')
      expect(REQUEST_IS_OPEN.interrupted).toBe(false)
      expect(REQUEST_STATES.filter((state) => REQUEST_IS_OPEN[state])).toEqual(['open'])
      // ⛔ **The fold is the only thing that writes this state**, so a second reading of *"is it
      // still open"* cannot appear beside it. `agent-tools.ts` filters through the table by name.
      const tools = codeOnly(sourceOf(join(mainRoot, 'runtime/tool-families'), 'questions.ts'))
      expect(tools).toContain('REQUEST_IS_OPEN[one.request.state]')
      for (const file of agentToolSourcePaths(join(mainRoot, 'runtime'))) {
        const tools = codeOnly(readFileSync(file, 'utf8'))
        expect(tools).not.toMatch(/state === 'open'/)
      }
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
