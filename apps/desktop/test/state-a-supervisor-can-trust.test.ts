import { expectIdsOnlyInLinkTargets } from './helpers/navigation-reply'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime, SessionMachine } from '@brobot2/runtime'
import type {
  AgentToolset,
  FakeSessionHandle,
  ResumeOptions,
  RuntimeEvent,
  SessionRef,
  StartOptions,
} from '@brobot2/runtime'
import { AsyncQueue } from '../../../packages/runtime/src/internal/async-queue'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { isGiverStallNotice, RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import { TOOL_NAMES, agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  WHERE_AN_ASK_LANDED,
  WHO_STOPPED_IT,
  type AskToStop,
  type LastEndedTurn,
} from '../src/shared/how-work-stopped'
import {
  AN_ASK_RIDES_ON,
  TASK_STALL_CAUSES,
  derivePieces,
  type TaskStallCause,
} from '../src/shared/tasks'
import { exchangePreviewLines } from '../src/shared/last-exchange'
import { pieceLine, theConversationCalled } from '../src/shared/piece-called'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * 🔴 **484 · state a supervisor can trust** — HO-031 §2.1 and §2.2, and three of §3's defects.
 *
 * ## ⛔ The measurement, in the words of the agent that made it
 *
 * ⚠️ **A person interrupted an agent through the UI. The app recorded it. The tool lied about it.**
 * BroBot's `SESSION-REPORT.md` §7.4: *"The app knew the answer was `"a-person"`. The field named
 * `who` is null. Absent the user saying so, this report would have recorded that the agent
 * spontaneously recovered."*
 *
 * 🔴 **HO-031 §2.1 is the ruling that generalises it:** *"An answer a tool gives an AGENT is
 * subject to criterion 18 exactly as a sentence the digest gives a PERSON… the actor is recorded by
 * whoever performs it, and any surface that reports the act reports the actor it has."*
 *
 * ## ⚑ Three things this suite establishes, and one it refuses
 *
 *  - **§1** — the ask is reported, because it is a fact about the CONVERSATION and the field that
 *    was null is a fact about a TURN. The negative is derived from the ledger, so it fails whenever
 *    a `work_interrupted` row exists and the answer names nobody.
 *  - **§2** — `lastEndedTurn` says which turn it is about, in the type. HO-031 §2.2: *"an ambiguity
 *    a reader must resolve is the defect, not the staleness."*
 *  - **§3** — every published tool answer is classified as describing an act or not, and the actor
 *    each one reports is named. ⛔ The residue is named too rather than left out.
 *  - **§4** — `stalled_because` across its WHOLE state set, plus the case that reaches none of it:
 *    an agent frozen on a permission, which HO-031 §3 calls *"the most actively misleading thing in
 *    the report"*.
 *  - **§5** — what `interrupt_agent.reason` actually is, measured rather than inferred.
 *
 * ⚑ **Real host, real SQLite, real migrations, real tools.** The only double is the provider.
 *
 * ⚑ **D-016 · a task is a PIECE, given with `give_work`** — which starts the worker's conversation
 * with the brief as its first turn, where `spawn_agent` started one that was then sent its work.
 * Every row below is read by the piece.
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

class ProviderDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
    private readonly decorate: (handle: FakeSessionHandle) => FakeSessionHandle,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = this.decorate(await super.start(options))
    this.handles.push(handle)
    return handle
  }
  override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
    const handle = await super.resume(ref, options)
    this.handles.push(handle)
    return handle
  }
}

/**
 * A provider-faithful turn that stays `working` until its interrupt reaches a terminal.
 *
 * The ordinary Fake turn parks on a permission, and the product correctly refuses an agent trying
 * to answer that person's decision by interrupting it. This instrument changes only that timing:
 * lifecycle still comes from the shared production {@link SessionMachine}, while every task and
 * actor event comes from the real host/tool path under test.
 */
function holdingAWorkingTurn(
  handle: FakeSessionHandle,
  // ⚑ **720 · R72 — the provider's own word for the turn it was asked to stop.** `interrupted` is
  // the stop honoured; `completed` is the turn a provider finished anyway, which Codex does
  // (`probe:codex-early-interrupt`, `709`).
  itsWord: 'interrupted' | 'completed' = 'interrupted',
): FakeSessionHandle {
  const queue = new AsyncQueue<RuntimeEvent>()
  let status = handle.status()
  const machine = new SessionMachine((event) => {
    if (event.type === 'status') status = event.state
    queue.push(event)
  })
  machine.markStarting()
  machine.sessionStarted(handle.ref, 'started')
  let closing: Promise<void> | null = null

  return new Proxy(handle, {
    get(target, property) {
      if (property === 'events') return (): AsyncIterable<RuntimeEvent> => queue
      if (property === 'status') return () => status
      if (property === 'waitForAPerson') {
        return (): (() => void) => {
          machine.beginWait()
          let held = true
          return () => {
            if (!held) return
            held = false
            machine.endWait()
          }
        }
      }
      if (property === 'send') {
        return async (): Promise<void> => {
          if (machine.beginTurn() === null) {
            throw new Error('cannot send: session is not active or a turn is in progress')
          }
        }
      }
      if (property === 'interrupt') {
        return async (): Promise<void> => {
          machine.requestInterrupt()
          // The held provider acknowledges the interrupt with its own terminal, in its own word —
          // `interrupted`, as both real providers end a turn they honour a stop on (709, R43: the
          // shared machine records that word; it no longer renames a `completed`) — or, where a
          // test says so, `completed`: a turn the provider finished anyway (720, R72).
          machine.completeTurn(itsWord)
        }
      }
      if (property === 'close') {
        return (): Promise<void> =>
          (closing ??= (async () => {
            if (machine.beginClose()) {
              if (machine.hasProviderWork) machine.forceEnd(false)
              machine.closeSession(handle.ref)
              queue.close()
            }
            await target.close()
          })())
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })
}

describe('484 · state a supervisor can trust', () => {
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
  let decorateNextHandle: ((handle: FakeSessionHandle) => FakeSessionHandle) | null
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) =>
        new ProviderDouble(provider, handles, issued, (handle) => {
          const decorate = decorateNextHandle
          decorateNextHandle = null
          return decorate?.(handle) ?? handle
        }),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      interruptWaitMs: 40,
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-trust-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-trust-root-'))
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
    decorateNextHandle = null
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const sourceOf = (...parts: string[]): string => readFileSync(join(mainRoot, ...parts), 'utf8')

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
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
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const textOf = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
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

  const asPm = (pm: string): { ownerId: string } => ({ ownerId: `agent:${pm}` })

  /**
   * ⚑ **D-016 · a give through the real door, answered `ok`** — the decoration, when there is one,
   * goes on the conversation the give STARTS, before its brief is its first turn.
   */
  const aGive = async (
    tools: AgentToolset,
    profile: string,
    brief: string,
    decorate?: (handle: FakeSessionHandle) => FakeSessionHandle,
  ): Promise<{ agent: string; piece: string; label: string }> => {
    decorateNextHandle = decorate ?? null
    let given: Record<string, unknown>
    try {
      given = await callOn(tools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile,
        title: brief,
        brief,
      })
    } finally {
      decorateNextHandle = null
    }
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return {
      agent: given.agent as string,
      piece: given.piece as string,
      label: given.label as string,
    }
  }

  /** ⚑ A PM in a window, and a worker agent that exists but that nobody has given anything yet. */
  const aPm = async (): Promise<{
    pm: string
    pmProfile: string
    workerProfile: string
    pmTools: AgentToolset
  }> => {
    const nth = ++pairs
    const pmProfile = `pm-${String(nth)}`
    const workerProfile = `worker-${String(nth)}`
    await bringIdentityIntoBeing(workerProfile)
    const pm = await personOpens(pmProfile)
    return { pm, pmProfile, workerProfile, pmTools: agentToolsFor(host, pm) }
  }

  /**
   * ⚑ **D-016 · the PM gives its worker a piece, and the give starts the worker** — its brief is
   * the worker's first turn: parked on the card the double raises every turn, or, decorated with
   * {@link holdingAWorkingTurn}, held WORKING with no card until it is asked to stop.
   */
  const aPmAndItsWorker = async (
    decorateWorker?: (handle: FakeSessionHandle) => FakeSessionHandle,
    brief = 'the work',
  ): Promise<{
    pm: string
    pmProfile: string
    worker: string
    /** The worker's profile — what a second give to the same agent names. */
    workerProfile: string
    pmTools: AgentToolset
    workerHandle: FakeSessionHandle
    piece: string
    label: string
  }> => {
    const { pm, pmProfile, workerProfile, pmTools } = await aPm()
    const given = await aGive(pmTools, workerProfile, brief, decorateWorker)
    return {
      pm,
      pmProfile,
      worker: given.agent,
      workerProfile,
      pmTools,
      workerHandle: latestHandle(),
      piece: given.piece,
      label: given.label,
    }
  }

  /** ⚑ A piece the worker holds, raw off the fold. */
  const pieceOf = (worker: string, piece: string) =>
    store.piecesOwnedBy(worker).find((row) => row.piece === piece)

  /** Park a conversation on its permission card — where a stop and a fault both land. */
  const busy = async (
    sessionId: string,
    handle: FakeSessionHandle,
    by: { ownerId: string } = window,
  ): Promise<void> => {
    await host.send(sessionId, 'a long piece of work', by)
    await waitFor(
      () => handle.status() === 'waiting_permission',
      'the turn to park on its permission card',
    )
  }

  const turnsEnded = async (sessionId: string, atLeast = 1): Promise<void> => {
    await waitFor(
      () => ledger(sessionId).filter((event) => event.type === 'turn').length >= atLeast,
      'the turn to reach a terminal',
    )
  }

  /** ⚑ A person taking a spawned child over, exactly as the UI does before it can press Stop. */
  const aPersonTakesOver = (sessionId: string): void => {
    if (claimed.has(sessionId)) return
    host.claimSession(sessionId, window)
    claimed.add(sessionId)
  }

  /** ⚑ Wait for the child's turn to park on its permission card — the double's representative turn. */
  const cardOn = async (sessionId: string, atLeast = 1): Promise<void> => {
    await waitFor(
      () =>
        ledger(sessionId).filter((event) => event.type === 'permission_request').length >= atLeast,
      'the card the turn parked on to reach the ledger',
    )
  }

  const letTheTurnFinish = async (sessionId: string): Promise<void> => {
    const before = ledger(sessionId).filter((event) => event.type === 'turn').length
    await waitFor(
      () => ledger(sessionId).some((event) => event.type === 'permission_request'),
      'the card the turn parked on to reach the ledger',
    )
    const card = [...ledger(sessionId)]
      .reverse()
      .find((event) => event.type === 'permission_request')
    if (card === undefined || card.type !== 'permission_request') throw new Error('no card')
    aPersonTakesOver(sessionId)
    await host.respondPermission(sessionId, card.id, { outcome: 'allow' }, window)
    await waitFor(
      () => ledger(sessionId).filter((event) => event.type === 'turn').length > before,
      'the turn to reach its own terminal',
    )
  }

  /**
   * 🔴 **The negative, derived from the ledger rather than written out** — HO-031 §2.1's own
   * sentence as a predicate.
   *
   * ⛔ **It fails whenever this app has recorded an author and the answer names nobody**, whichever
   * conversation and whichever gesture, so a future path that writes `work_interrupted` somewhere
   * the reader cannot reach arrives here red. ⚠️ `a-negative-is-only-as-strong-as-the-search-shape`:
   * the shape is *every `work_interrupted` row in this conversation's ledger*, which is every row
   * this app writes about an ask — there is one writer, `RuntimeHost.recordTheAsk`.
   */
  const theAskIsReported = (sessionId: string): void => {
    const asks = ledger(sessionId).filter((event) => event.type === 'work_interrupted')
    const answered = store.lastAskToStop(sessionId)
    if (asks.length === 0) {
      expect(answered, `${sessionId}: nothing asked, so nothing may be named`).toBeNull()
      return
    }
    const last = asks.at(-1)
    expect(
      answered,
      `${sessionId}: the ledger records an ask and the answer names nobody`,
    ).not.toBeNull()
    expect(answered?.by).toBe(last?.type === 'work_interrupted' ? last.by : 'unreachable')
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §1 · THE DELIVERABLE — a person intervened, and the tool says so
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · the ask is a fact about the conversation, and it is reported', () => {
    it('🔴 a person stops a conversation with NO turn running — the row the old reader could not reach', async () => {
      const { pm, worker } = await aPmAndItsWorker()
      // ⚑ **One turn, finished cleanly**, so the conversation has an ending on record that nobody
      // asked for. ⛔ **The WORD on that ending is not the subject** — what the reader is blind to
      // is the JOIN, and a turn that finished makes that visible without a second failure mode in
      // the fixture. ⚑ D-016 — the turn is the give's brief.
      await cardOn(worker)
      await letTheTurnFinish(worker)
      expect(store.lastEndedTurn(worker)).toMatchObject({ how: 'it-finished', who: null })

      // 🔴 **Now a person presses Stop with nothing running** — BroBot's §7.4 exactly: the child was
      // not mid-turn, and the gesture still records an author.
      await host.interrupt(worker, window)
      const asks = ledger(worker).filter((event) => event.type === 'work_interrupted')
      expect(asks, 'the app recorded the ask').toHaveLength(1)
      expect(asks[0]).toMatchObject({ by: 'a-person' })

      // ⛔ **The turn-shaped reading is UNCHANGED and still says nobody, truthfully.** ⚠️ That is
      // the half this dispatch must not "fix": no turn was running, so no turn was stopped, and a
      // `who` here would put a person's name on an ending they had nothing to do with.
      expect(store.lastEndedTurn(worker)).toMatchObject({ how: 'it-finished', who: null })

      // 🔴 **And the conversation-shaped one names them.** This is the field whose absence made
      // BroBot's report say the agent recovered on its own.
      expect(store.lastAskToStop(worker)).toMatchObject({
        by: 'a-person',
        asker: null,
        turn: 'no-turn-was-running',
      })
      theAskIsReported(worker)
      void pm
    })

    it('⛔ BroBot’s exact pair — an ending that names nobody, and an intervention only the second field sees', async () => {
      const { worker, workerHandle } = await aPmAndItsWorker()
      await cardOn(worker)
      await letTheTurnFinish(worker)
      await host.interrupt(worker, window)

      // 🔴 **And now the provider faults on a LATER turn**, which is what puts BroBot's two fields
      // side by side. ⛔ **Fatal, deliberately**: a fault that leaves the conversation `errored` is
      // the state a supervisor cannot rescue and is exactly the one whose history it would narrate.
      await host.send(worker, 'one more thing', window)
      await cardOn(worker, 2)
      workerHandle.simulateError('the provider stream ended unexpectedly', true)
      await turnsEnded(worker, 2)

      // ⚠️ **The exact reading BroBot was handed** — `{"how":"the-provider-faulted","who":null}`.
      expect(store.lastEndedTurn(worker)).toMatchObject({ how: 'the-provider-faulted', who: null })
      // 🔴 **…and the fact it could not see.** Without this, the report says the agent recovered.
      expect(store.lastAskToStop(worker)).toMatchObject({
        by: 'a-person',
        turn: 'no-turn-was-running',
      })
      theAskIsReported(worker)
    })

    it('⛔ the tool answer carries it — `get_agent_status` is the payload it was read from', async () => {
      const { pmTools, worker } = await aPmAndItsWorker()
      await cardOn(worker)
      await letTheTurnFinish(worker)
      await host.interrupt(worker, window)

      const said = await callOn(pmTools, 'get_agent_status', { agent: worker })
      expect(said.outcome, JSON.stringify(said)).toBe('ok')
      const card = said.agent as Record<string, unknown>
      expect(card.lastEndedTurn).toMatchObject({ how: 'it-finished', who: null })
      expect(card.lastAskToStop).toMatchObject({ by: 'a-person', turn: 'no-turn-was-running' })
      theAskIsReported(worker)
    })

    it('⚑ an AGENT’s stop names the conversation, and a person’s does not — the same row, two arms', async () => {
      // ⛔ **A held working turn rather than a carded one, and the reason is a RAIL rather than
      // convenience.** `INTERRUPT_RAILS`' `a-person-is-being-asked` refuses an agent that would cut
      // into a child parked on somebody's permission — HO-005 Q2 — so the state an agent may
      // actually stop is a child working with nobody being asked. ⚑ **D-016** — the give's brief is
      // the child's first turn, so it is that turn, held working ({@link holdingAWorkingTurn}),
      // where `123`'s out-of-turn burst stood in for it on a child nothing had been sent.
      const { pm, worker, workerHandle } = await aPmAndItsWorker(holdingAWorkingTurn)
      await waitFor(() => workerHandle.status() === 'working', 'the child to be working')
      const stopped = await host.interruptAgent(worker, asPm(pm))
      expect(stopped.ok, JSON.stringify(stopped)).toBe(true)

      // ⛔ **`asker` exists on the agent arm and nowhere else** — `WorkInterruptedEvent`'s rule,
      // carried through rather than re-decided.
      expect(store.lastAskToStop(worker)).toMatchObject({ by: 'an-agent', asker: pm })
      theAskIsReported(worker)
    })

    it('⛔ the LAST ask wins, and a person after an agent does not inherit the agent’s name', async () => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker(holdingAWorkingTurn)
      await waitFor(() => workerHandle.status() === 'working', 'the child to be working')
      await host.interruptAgent(worker, asPm(pm))
      expect(store.lastAskToStop(worker)).toMatchObject({ by: 'an-agent', asker: pm })
      // ⚑ **A person takes it over first**, which is what the UI does before it can press anything.
      aPersonTakesOver(worker)
      await host.interrupt(worker, window)
      // 🔴 **`asker` is CLEARED on the second ask.** ⚠️ A `by` that moved while `asker` stayed would
      // report *a person stopped it* and name a conversation, which is the pair `397` wrote the
      // clearing line for.
      expect(store.lastAskToStop(worker)).toMatchObject({ by: 'a-person', asker: null })
      theAskIsReported(worker)
    })

    it('⚠️ a conversation nobody ever stopped names nobody — the control for every case above', async () => {
      const quiet = await personOpens('quiet')
      const handle = latestHandle()
      await busy(quiet, handle)
      await letTheTurnFinish(quiet)
      expect(ledger(quiet).some((event) => event.type === 'work_interrupted')).toBe(false)
      expect(store.lastAskToStop(quiet)).toBeNull()
      theAskIsReported(quiet)
      // ⛔ **And the absence is not a fourth actor**: every word this field can say is a member of
      // the vocabulary the row is typed with, and `null` is outside it on purpose.
      //
      // ⚑ **501 · three words, and it was two.** `WHO_ASKED_IT_TO_STOP` was a hand-written pair
      // for this one producer; `recordTheAsk` now asks `whoDidIt` and refuses the app, so what the
      // row can hold IS {@link WHO_STOPPED_IT} — the derived list, and nothing beside it.
      expect([...WHO_STOPPED_IT]).toEqual(['a-person', 'an-agent', 'a-caller-this-app-cannot-name'])
    })

    it('🔴 501 · an ask by a caller this app cannot name reaches the READER with its own word', async () => {
      // ⛔ **The half of `501` that is not the writer.** `SessionStore.lastAskToStop` decided
      // membership with a hand-written `asked.by !== 'a-person' && asked.by !== 'an-agent'` — the
      // event's OLD two-member vocabulary, restated as literals in a second file.
      //
      // ⚠️ **It would not have gone red; it would have gone QUIET.** The row is written and the
      // reader drops it, so `AgentCard.lastAskToStop` answers `null` — *nobody asked* — about an
      // ask this app recorded, which is the one absence {@link theAskIsReported} exists to refuse.
      // ⚑ That predicate is a negative over *every* `work_interrupted` row in the ledger, so it
      // catches this without being told which word to look for.
      const unnameable = new RecordingSink('mcp:planner')
      const { sessionId } = await host.createSession(
        { provider: 'claude', profileId: 'planner', approvalMode: 'ask', cwd: root },
        unnameable,
      )
      const handle = latestHandle()
      await busy(sessionId, handle, unnameable)
      await host.interrupt(sessionId, unnameable)
      expect(
        ledger(sessionId)
          .filter((one) => one.type === 'work_interrupted')
          .map((one) => (one.type === 'work_interrupted' ? one.by : '')),
      ).toEqual(['a-caller-this-app-cannot-name'])
      // ⚑ **Through the DATABASE and not off the live ledger**, because the literal pair lived on
      // the read side: this is the same value after a `JSON.parse` and a cast.
      expect(store.lastAskToStop(sessionId)).toMatchObject({
        by: 'a-caller-this-app-cannot-name',
        asker: null,
      })
      theAskIsReported(sessionId)
    })

    it('🔴 the row is written where the old reader looked and where it did NOT — both, from one writer', () => {
      // ⛔ **The structural claim, on the source**: there is ONE writer of the ask, and the column
      // that hid it from the turn-narrowed reader is `turnFor`'s null.
      const store_ = sourceOf('db', 'session-store.ts')
      const hostSource = sourceOf('runtime', 'runtime-host.ts')
      expect(hostSource.split("type: 'work_interrupted'")).toHaveLength(2)
      // ⚑ **The null that made the gap**, quoted from the function that produces it.
      expect(store_).toContain('if (!CONTENT_EVENTS.has(event.type)) return null')
      // ⚠️ **And the new read is NOT narrowed by turn**, which is the whole difference between the
      // two questions. ⛔ A `turn_id =` clause appearing in this statement would silently restore
      // the blindness, so the statement's own text is asserted.
      const opens = store_.indexOf('const selectLastAskToStop = db.prepare(')
      expect(opens, 'selectLastAskToStop was renamed or removed').toBeGreaterThan(0)
      const statement = store_.slice(opens, store_.indexOf('  )', opens))
      expect(statement).toContain("type = 'work_interrupted'")
      expect(statement).not.toContain('turn_id =')
      // ⚑ **The control that plants TWO** (standing rule 12): the slice really can see a `turn_id =`
      // clause, so the negative above is a measurement rather than a matcher that never fires.
      const neighbour = store_.slice(
        store_.indexOf('const selectLastTurnEndingEvents = db.prepare('),
        store_.indexOf('const selectLastAskToStop = db.prepare('),
      )
      expect(neighbour).toContain('turn_id =')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §2 · which turn is this about — the ruling, in the type
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · `lastEndedTurn` says which turn, and the other reading is unrepresentable', () => {
    it('🔴 a turn running NOW does not overwrite the reading — it is named beside it', async () => {
      const quiet = await personOpens('two-turns')
      const handle = latestHandle()
      await busy(quiet, handle)
      await letTheTurnFinish(quiet)
      const settled = store.lastEndedTurn(quiet)
      expect(settled).toMatchObject({ how: 'it-finished', since: 'nothing-has-started-since' })

      // 🔴 **Now the conversation is working again** — BroBot's §7.3 oddity, built rather than
      // inferred: *"`lastTurn.how` still reads `the-provider-faulted` after the agent went on to
      // complete… either stale, or describing an older turn. Unclear which."*
      await busy(quiet, handle)
      const during = store.lastEndedTurn(quiet)
      // ⛔ **The reading is the SAME**, because the last ENDED turn has not changed — and that was
      // never the defect. ⚑ What changed is that the value now says so.
      expect(during?.how).toBe(settled?.how)
      expect(during?.endedAt).toBe(settled?.endedAt)
      expect(during?.since).toBe('a-turn-is-running-now')
      // ⚠️ **And the card's live state is the other half of the pair**, so the two together answer
      // *what is it doing* and *what happened last* without either claiming the other's subject.
      // ⚑ **D-017 · R11** — the one derivation's state: parked on a person's card is *needs you*.
      expect(host.agentCard(quiet, window, quiet)?.state).toEqual({ is: 'needs-you' })
    })

    it('🔴 F080 · a turn its provider started by itself is a turn on the table, and the reading says so', async () => {
      const { pmTools, worker, workerHandle } = await aPmAndItsWorker()
      await cardOn(worker)
      await letTheTurnFinish(worker)
      // ⚑ The control: a turn a message opened says nothing about who started it.
      expect(store.lastEndedTurn(worker)).not.toHaveProperty('startedByItsProvider')
      const turnsBefore = store.turns(worker).length

      // ⚑ **The provider starts work by itself** — a wake after its background work ended.
      workerHandle.simulateThinking()
      await waitFor(
        () => ledger(worker).some((event) => event.type === 'provider_turn'),
        'the provider’s own turn to open',
      )
      expect(store.turns(worker)).toHaveLength(turnsBefore + 1)
      expect(store.turns(worker).at(-1)).toMatchObject({ prompt: '', closedAt: null })

      // ⚑ **…and a Stop ends it as a turn**, `interrupted`, like any other.
      await host.interrupt(worker, window)
      await waitFor(
        () => store.turns(worker).at(-1)?.closedAt !== null,
        'the provider’s own turn to close',
      )
      expect(store.turns(worker).at(-1)).toMatchObject({ prompt: '', endReason: 'interrupted' })
      expect(store.lastEndedTurn(worker)).toMatchObject({
        startedByItsProvider: true,
        since: 'nothing-has-started-since',
      })
      expect(await textOf(pmTools, 'get_agent_status', { agent: worker })).toContain(
        'Its last turn, which its provider started by itself, ran from ',
      )
      // ⚑ **…and the last exchange says its last turn answered no message** — the stall notice's
      // preview, and `read_transcript`'s, read it.
      expect(store.lastExchange(worker)).toMatchObject({ sinceThenItsProviderStartedATurn: true })
      expect(
        exchangePreviewLines('the worker', store.lastExchange(worker), () => 'the PM')[0],
      ).toMatch(
        /^Its last turn was one its provider started by itself\. The last message it received came from /,
      )
      const transcript = await textOf(pmTools, 'read_transcript', { agent: worker })
      expect(transcript).toContain('Since then, ')
      // ⚑ **…and its turns list it as its own**, never under the message before it.
      expect(transcript).toMatch(
        /Turn \d+, which its provider started by itself; no message opened it\./,
      )
    })

    it('⛔ the moment comes off the TURN TABLE, so it cannot disagree with the row the query picked', async () => {
      const quiet = await personOpens('timed')
      const handle = latestHandle()
      await busy(quiet, handle)
      await letTheTurnFinish(quiet)
      const reading = store.lastEndedTurn(quiet)
      const closed = db
        .prepare(
          `SELECT closed_at AS at FROM turn WHERE session_id = ? AND closed_at IS NOT NULL
            ORDER BY ordinal DESC LIMIT 1`,
        )
        .get(quiet) as { at: number } | undefined
      expect(reading?.endedAt).toBe(closed?.at)
      // 🔴 **A running turn has no closing time**, which is what makes *"this is the turn happening
      // now"* unrepresentable rather than merely discouraged.
      await busy(quiet, handle)
      const open = db
        .prepare(`SELECT closed_at AS at FROM turn WHERE session_id = ? AND closed_at IS NULL`)
        .get(quiet) as { at: number | null } | undefined
      expect(open?.at ?? null).toBeNull()
      expect(store.lastEndedTurn(quiet)?.endedAt).toBe(closed?.at)
    })

    it('⚑ `since` has two members and there is no third — a later ENDED turn would BE this turn', async () => {
      const quiet = await personOpens('exhaustive')
      const handle = latestHandle()
      await busy(quiet, handle)
      await letTheTurnFinish(quiet)
      const first = store.lastEndedTurn(quiet)
      await busy(quiet, handle)
      // ⚠️ **Waited for the SECOND card**, because `letTheTurnFinish` answers the newest one and a
      // helper that took the previous turn's card would answer nothing and time out.
      await cardOn(quiet, 2)
      await letTheTurnFinish(quiet)
      const second = store.lastEndedTurn(quiet)
      // ⛔ **The reading MOVED**, so *"nothing has started since"* is a claim about the world rather
      // than a constant.
      expect(second?.endedAt).toBeGreaterThan(first?.endedAt ?? 0)
      expect(second?.since).toBe('nothing-has-started-since')
      // ⚠️ **The type carries both words and the values below are the two the app produces**, so a
      // third member added without a producer is visible here.
      const words: readonly LastEndedTurn['since'][] = [
        'nothing-has-started-since',
        'a-turn-is-running-now',
      ]
      expect(words).toHaveLength(2)
    })

    it('⛔ every member of `WHERE_AN_ASK_LANDED` is reached by something — a member nothing writes guards nothing', async () => {
      const reached = new Set<AskToStop['turn']>()

      // ⚑ **`the-turn-that-ended-last`** — the ordinary Stop, pressed while a turn was running.
      const a = await personOpens('landed-a')
      const aHandle = latestHandle()
      await busy(a, aHandle)
      await host.interrupt(a, window)
      await turnsEnded(a)
      reached.add(store.lastAskToStop(a)?.turn ?? 'no-turn-was-running')

      // ⚑ **`a-turn-that-is-running-now`** — asked, and the terminal has not landed. ⛔ **Read
      // SYNCHRONOUSLY, which is the whole construction**: `askTheWorkToStop` writes the row and only
      // then awaits the provider, so the state exists in the gap between the two — `395`'s ordering,
      // written that way because Codex's `interrupt()` awaits, unbounded, an answer the app-server
      // may never send (709). ⚠️ A test that awaited here would be measuring the double's speed.
      const b = await personOpens('landed-b')
      const bHandle = latestHandle()
      await busy(b, bHandle)
      const inFlight = host.interrupt(b, window)
      reached.add(store.lastAskToStop(b)?.turn ?? 'no-turn-was-running')
      await inFlight
      await turnsEnded(b)

      // ⚑ **`no-turn-was-running`** — §1's case, and the one the whole dispatch is about.
      const c = await personOpens('landed-c')
      const cHandle = latestHandle()
      await busy(c, cHandle)
      await letTheTurnFinish(c)
      await host.interrupt(c, window)
      reached.add(store.lastAskToStop(c)?.turn ?? 'the-turn-that-ended-last')

      // ⚑ **`a-turn-that-ended-earlier`** — a Stop of a running turn, and then a turn after it: what
      // a message or an answer that asked for the stop does, going in as soon as the turn ends.
      const d = await personOpens('landed-d')
      const dHandle = latestHandle()
      await busy(d, dHandle)
      await host.interrupt(d, window)
      await turnsEnded(d)
      await busy(d, dHandle)
      await waitFor(
        () => ledger(d).filter((event) => event.type === 'permission_request').length >= 2,
        'the second turn’s card to reach the ledger',
      )
      await letTheTurnFinish(d)
      reached.add(store.lastAskToStop(d)?.turn ?? 'no-turn-was-running')

      expect([...reached].sort()).toEqual([...WHERE_AN_ASK_LANDED].sort())
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the audit — every tool answer, and the actor it reports
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · every act-describing tool answer, classified', () => {
    /**
     * 🔴 **HO-031 §2.1's scope, as data.** ⛔ *"Derive every tool answer that describes an ACT and
     * check whether it reports the actor the ledger holds."*
     *
     * ⚠️ **Keyed by {@link ToolName}, so a FURTHER tool is a compile error here** — `477`'s
     * `ACTOR_CENSUS` device one layer out. ⛔ A published answer nobody classified is exactly what
     * this ruling exists to stop.
     *
     * ⚑ **`describes` means *the answer reports an act performed by somebody other than the
     * caller***. A verb's own outcome is not in scope: the caller IS the actor, it has just called
     * the tool, and a `by` echoing the caller back would be a field with one possible value.
     */
    const ACT_CENSUS: Readonly<
      Record<ToolName, { describes: boolean; actor: string; because: string }>
    > = {
      list_themes: {
        describes: false,
        actor: 'none',
        because: 'It reads theme settings and the active choice, not another actor’s act.',
      },
      save_theme: {
        describes: false,
        actor: 'the caller',
        because: 'It reports the caller’s own save and optional workspace selection.',
      },
      set_theme: {
        describes: false,
        actor: 'the caller',
        because: 'It reports the caller’s own workspace selection and previous choice.',
      },
      list_agents: {
        describes: true,
        actor: 'lastEndedTurn.who + lastAskToStop.by',
        because: '484 · a turn was stopped, and who asked — the card carries both readings',
      },
      get_agent_status: {
        describes: true,
        actor: 'lastEndedTurn.who + lastAskToStop.by',
        because: '484 · the surface HO-031 §2.1 was measured on; one card, one derivation',
      },
      list_tasks: {
        describes: true,
        actor: 'asked_to_stop_by',
        because:
          '484 · `turn_interrupted` says the turn was stopped, and the asker is on the neighbouring row of the same ledger',
      },
      // ⚑ **D-016** — `list_projects` (*the same act on the project read*) is gone with projects.
      write_agent_rules: {
        describes: false,
        actor: 'the caller',
        because: 'It reports this caller’s own attributed rules write, with a metadata receipt.',
      },
      read_own_notes: {
        describes: false,
        actor: 'n/a',
        because: 'Reads a profile page and its stored author; it describes no stopping act.',
      },
      write_own_notes: {
        describes: false,
        actor: 'the caller',
        because: 'Reports this caller’s own attributed note version; it describes no stopping act.',
      },
      read_agent_rules: {
        describes: false,
        actor: 'n/a',
        because: 'Reads current standing rules and their provenance; it describes no stopping act.',
      },
      propose_agent_rules: {
        describes: false,
        actor: 'n/a',
        because:
          '582 · the answer reports what THIS call did — a version written, or a request put in front of a person. No other act, no other actor, and nothing that was stopped',
      },
      // ⚑ **D-016** — `549`'s `list_documents` row is gone with the document registry.
      list_questions: {
        describes: true,
        actor: 'NOT REPORTED — named as a finding',
        because:
          '484 F1 · `state: interrupted` reports an act; the asker is in the CHILD ledger and `deriveRoutedRequests` does not read `work_interrupted`, so naming one from the conversation’s last ask could attribute an older gesture to this ending',
      },
      // ⚑ **D-016** — `create_project` (*its own act*, since `616`) is gone with projects and
      // proposals.
      // ⚑ **D-016 · `give_work` took `spawn_agent`'s row, and its reason.**
      give_work: {
        describes: false,
        actor: 'the caller',
        because: 'it reports its own act, and a `by` echoing the caller back has one value',
      },
      // ⚑ **D-016** — a title or a status line the caller set on a piece it holds or gave.
      update_work: {
        describes: false,
        actor: 'the caller',
        because: 'D-016 · its own act — a title or a status line the caller itself set on a piece',
      },
      // ⚑ **D-016 · commit 6** — a piece the caller took on for a person; the answer names that piece.
      take_on_work: {
        describes: false,
        actor: 'the caller',
        because:
          'D-016 · commit 6 · its own act — a piece the caller took on under its own conversation’s work, and nobody else acted',
      },
      message_agent: {
        describes: false,
        actor: 'the caller',
        because: 'its own act — and 413 already ruled the authorship a message carries',
      },
      // ⚑ **D-017** — `end_agent` (*its own act*) is gone.
      interrupt_agent: {
        describes: false,
        actor: 'the caller',
        because:
          'its own act, and it answers `asked` rather than `stopped` because the two providers differ in kind',
      },
      withdraw_task: {
        describes: false,
        actor: 'the caller',
        because:
          'its own act — the parent taking back work it gave, and it is the parent that called',
      },
      reply_to_parent: {
        describes: false,
        actor: 'the caller',
        because: 'its own act — and 393 ruled the actor is WHICH LEDGER the reply is in',
      },
      answer_question: {
        describes: false,
        actor: 'the caller',
        because:
          'its own act — and 477 put the answerer on `user_decision`, which is the durable row',
      },
      ask_question: {
        describes: false,
        actor: 'the caller',
        because: 'its own act — the actor is WHICH LEDGER the question was raised in',
      },
      // 🔴 **611 · the same answer for the same reason** (HO-088 §3.2). ⛔ A pass-up writes the
      // passer's OWN `question_asked` row, in the passer's own ledger — so the actor is which
      // ledger it is in, exactly as it is one row up. ⚠️ The WORDS are somebody else's and the ACT
      // is the caller's, and `passedUpFrom` is what keeps those two facts apart.
      pass_question_up: {
        describes: false,
        actor: 'the caller',
        because: 'its own act — the words are the original asker’s and the raising is the caller’s',
      },
      create_agent: {
        describes: false,
        actor: 'the caller',
        because: 'its own act — one row written, nothing started, and the caller is the author',
      },
      read_document: {
        describes: false,
        actor: 'none',
        because: 'it returns bytes and reports no act at all',
      },
      search_work: {
        describes: false,
        actor: 'none',
        because: 'It reads recorded work facts without claiming who changed them.',
      },
      search_past_work: {
        describes: false,
        actor: 'none',
        because: 'It reads past records without claiming who changed them.',
      },
      find_files: {
        describes: true,
        actor: 'added_by',
        because:
          'D-037 · each file found was kept by somebody, and the answer names who from the row that kept it: the conversation’s agent, or a person',
      },
      restore_agent: {
        describes: false,
        actor: 'the caller',
        because:
          'its own act — the conversations it brought back to the lists, and how each carries on; the caller is the one who restored them',
      },
      request_mcp_server: {
        describes: false,
        actor: 'the caller',
        because:
          'its own act — the request it put in front of the person; the caller is the one who asked',
      },
      request_action: {
        describes: false,
        actor: 'the caller',
        because:
          'its own act — the to-do it put in front of the person; the caller is the one who asked',
      },
      // 🔴 **488 · a listing of IDENTITIES, and it is the row this census had to think hardest
      // about.**
      // ⛔ **Bringing an identity into existence IS an act**, and a person or an agent performed it —
      // but no field on this row reports it. ⚑ The row says which identities exist and what each one
      // is, and existence and configuration are STATES: nothing on it says anything happened, so
      // there is no act whose actor is being withheld. ⚠️ **And the actor is not merely omitted, it
      // is unrecorded** — `writeIdentityRow` writes no author — so a row claiming one would be a
      // derivation answering what its ledger does not contain.
      list_profiles: {
        describes: false,
        actor: 'none',
        because:
          '488 · it reports which identities exist and what each one is; existence and configuration are states, and nothing this app stores says who minted a name',
      },
      // ⚑ **D-017** — `663`'s `resume_agent` (*its own act*) is gone.
      // ⚑ **D-009 · `give_work`'s reason** (`spawn_agent`'s until D-016) — the answer is the
      // caller's own withdrawal of a question it asked; nobody else's act is on it.
      withdraw_question: {
        describes: false,
        actor: 'the caller',
        because: 'D-009 · it reports its own act, withdrawing a question the caller itself asked',
      },
      // ⚑ **D-012 · each message it reports says who sent it**, read off the row's own fields.
      read_transcript: {
        describes: true,
        actor: 'last_exchange.received.from + turns[].received.from',
        because: 'D-012 · it reports messages others sent, and each carries its sender',
      },
    }

    it('⛔ every published tool is classified, and every row owes a reason', () => {
      expect(Object.keys(ACT_CENSUS).sort()).toEqual([...TOOL_NAMES].sort())
      // ⚠️ **A verdict with no sentence is an omission nobody decided about** — `477`'s rule, and
      // this ruling is written against exactly that shape.
      for (const [name, one] of Object.entries(ACT_CENSUS)) {
        expect(one.because.length, name).toBeGreaterThan(20)
      }
      // 🔴 **The residue is NAMED and counted**, so it cannot quietly grow. ⛔ Standing rule 14: a
      // deferred question in a response is a finding, and this is the line it is lifted from.
      const missing = Object.entries(ACT_CENSUS).filter(
        ([, one]) => one.describes && one.actor.startsWith('NOT REPORTED'),
      )
      expect(missing.map(([name]) => name)).toEqual(['list_questions'])
    })

    // ⚑ **Four until D-016 took `list_projects`**, the other surface that reported the same act.
    it('🔴 the three that DO report it really do, on a live ledger — not on the census’s opinion', async () => {
      const { pmTools, worker, piece } = await aPmAndItsWorker()
      await waitFor(
        () => pieceOf(worker, piece)?.state === 'working',
        'the work to reach the child',
      )
      await cardOn(worker)
      // ⛔ **A PERSON's Stop, which is BroBot's own case** — and the only stop a child parked on
      // somebody's permission admits: `a-person-is-being-asked` refuses an agent by name.
      aPersonTakesOver(worker)
      await host.interrupt(worker, window)
      await waitFor(
        () => pieceOf(worker, piece)?.stalledBecause === 'turn_interrupted',
        'the task to stall on the interruption',
      )

      // ⚑ **`list_tasks`, read by the PM about work it gave out.**
      const tasks = await callOn(pmTools, 'list_tasks', {})
      const gaveOut = (tasks.you_gave as Record<string, unknown>[])[0] ?? {}
      expect(gaveOut.stalled_because).toBe('turn_interrupted')
      expect(gaveOut.asked_to_stop_by).toEqual({ by: 'a-person', asker: null })
      expect(gaveOut.stalled_at).toBeGreaterThan(0)

      // ⚑ **…and the TEXT half names them too**, because a provider that renders text instead of the
      // payload must not lose the actor. ⛔ One phrasing: `stoppedBy`, imported rather than spelled.
      const line = await textOf(pmTools, 'list_tasks', {})
      expect(line).toContain('the turn it was running in was stopped, by a person')

      // ⚑ **`get_agent_status` and `list_agents`, one derivation read two ways.**
      const status = await callOn(pmTools, 'get_agent_status', { agent: worker })
      const roster = await callOn(pmTools, 'list_agents', {})
      const mine = (roster.agents as Record<string, unknown>[]).find((one) => one.agent === worker)
      expect((status.agent as Record<string, unknown>).lastAskToStop).toEqual(mine?.lastAskToStop)
      expect(mine?.lastAskToStop).toMatchObject({ by: 'a-person', asker: null })
    })

    it('⛔ the NOTICE a parent is pushed names them too — the answer HO-018 said must not wait for a poll', async () => {
      const { pm, worker } = await aPmAndItsWorker()
      await cardOn(worker)
      aPersonTakesOver(worker)
      await host.interrupt(worker, window)
      await waitFor(
        () =>
          ledger(pm).some((event) => event.type === 'user_turn' && isGiverStallNotice(event.text)),
        'the parent to be pushed the notice',
      )
      const told = ledger(pm)
        .filter((event) => event.type === 'user_turn')
        .map((event) => (event.type === 'user_turn' ? event.text : ''))
        .find((text) => isGiverStallNotice(text))
      // 🔴 **The pushed line is the one a parent acts on**, and until this dispatch it reported the
      // act and named nobody. ⚑ Same composition as the row read back, so the two cannot disagree.
      expect(told).toContain('the turn it was running in was stopped, by a person')
    })

    it('⚠️ and a turn that ended with NOBODY asking names nobody — the paired negative', async () => {
      const { pm, pmTools, worker, piece } = await aPmAndItsWorker()
      await cardOn(worker)
      // ⛔ **A person answers the card and the turn runs to its own terminal** — `turn_ended`, with
      // no ask anywhere before it. ⚑ Since `720` (R72) an ask DOES ride on `turn_ended` when there
      // was one (the finished-anyway test in §7); this is the one where there was none.
      await letTheTurnFinish(worker)
      await waitFor(
        () => pieceOf(worker, piece)?.stalledBecause === 'turn_ended',
        'the task to stall on the turn ending',
      )
      const terminal = store
        .events(worker)
        .find((entry) => entry.event.type === 'turn' && entry.event.state === 'completed')
      const listed = await callOn(pmTools, 'list_tasks', {})
      const row = (listed.you_gave as Record<string, unknown>[]).find((one) => one.piece === piece)
      expect(row?.stalled_because).toBe('turn_ended')
      // 🔴 **Null, and it is the whole of *a positive assertion must differ from the default***: the
      // case above plants an actor on the same field and this one proves it does not leak.
      expect(row?.asked_to_stop_by).toBeNull()
      expect(row?.stalled_at).toBe(terminal?.at)
      void pm
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §4 · `stalled_because` across its WHOLE state set, and the case that reaches none of it
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · waiting on a permission is not a task stall, and the row names the conversation', () => {
    it('🔴 the headline: a child parked on a permission reads `working` with no cause — and the row reports its conversation state', async () => {
      const { pmTools, worker, workerHandle, piece } = await aPmAndItsWorker()
      await waitFor(
        () => workerHandle.status() === 'waiting_permission',
        'the child to park on its card',
      )

      const tasks = await callOn(pmTools, 'list_tasks', {})
      const row = (tasks.you_gave as Record<string, unknown>[])[0] ?? {}
      // ⛔ **BroBot's §2.5, unchanged and CORRECT** — the fold records observations of the work, and
      // nothing has been observed to stop driving it. ⚑ The defect was never that this was wrong.
      // ⚑ **The RAW fold still says exactly what it always said**, which is `400`'s rule kept: the
      // composition is above `derivePieces` and nothing `609` added reaches it.
      expect(pieceOf(worker, piece)?.state).toBe('working')
      // 🔴 **609 · this now reads `waiting-on-a-person`, and that is THIS test's own defect
      // closed at the STATE rather than beside it.** ⛔ `484`'s headline was *"a child parked on a
      // permission reads `working` with no cause"*, and BroBot's own words above are why it
      // mattered: *"I would have told the user work was progressing normally while it was frozen
      // waiting on them."* ⚑ `484`'s remedy was a neighbouring FIELD (`given_to_is`); `609`'s is
      // the word itself, and both stand — the field is a LIVE join to the holder's conversation
      // and the state is a LEDGER fact about an open permission, so they answer different
      // questions and are asserted together here on purpose.
      //
      // ⚠️ **And `484` was right that a sixth STALL CAUSE would have been wrong** — nothing
      // stopped, so there is no observation for a cause to carry. ⛔ A WAIT is not a stall, which
      // is why it carries no cause at all.
      expect(row.state).toBe('waiting-on-a-person')
      expect(row.stalled_because).toBeNull()
      // 🔴 **…and this is the field whose absence made it misleading.** *"If I had only called
      // `list_tasks` I would have told the user work was progressing normally while it was frozen
      // waiting on them."*
      // ⚑ **D-017 · R11** — in the one derivation's words: *needs you*.
      expect(row.given_to_is).toBe('needs you')

      const line = await textOf(pmTools, 'list_tasks', {})
      // ⚑ **D-016** — the clause names the conversation HOLDING the piece.
      expect(line).toContain('the conversation holding it is waiting on a person')
    })

    it('⛔ it CLEARS when the person answers — which is why a sixth stall cause would have been wrong', async () => {
      const { pmTools, worker, workerHandle } = await aPmAndItsWorker()
      await waitFor(
        () => workerHandle.status() === 'waiting_permission',
        'the child to park on its card',
      )
      expect(
        ((await callOn(pmTools, 'list_tasks', {})).you_gave as Record<string, unknown>[])[0]
          ?.given_to_is,
      ).toBe('needs you')

      await letTheTurnFinish(worker)
      const after = (
        (await callOn(pmTools, 'list_tasks', {})).you_gave as Record<string, unknown>[]
      )[0]
      // 🔴 **Two edges.** ⛔ `stalled` has ONE — `shared/tasks.ts`: *"There is no way back to
      // `working`, and that is a decision rather than an omission"* — so a stall cause for a
      // permission would have left the task reading *frozen* after a person had cleared it.
      expect(after?.given_to_is).not.toBe('needs you')
      expect(after?.stalled_because).toBe('turn_ended')
      const line = await textOf(pmTools, 'list_tasks', {})
      expect(line).not.toContain('the conversation holding it is waiting on a person')
    })

    it('⚠️ every cause in the vocabulary carries a moment, and only the TURN causes can carry who asked (720, R72; F074)', () => {
      // ⛔ **The enumeration, not the two BroBot met** (`one-failure-is-not-the-failure-shape`).
      expect([...TASK_STALL_CAUSES]).toEqual([
        'turn_ended',
        'turn_interrupted',
        'app_restarted',
        'message_never_sent',
        // ⚑ **D-017 · R10** — the holder could never be reopened and a new one took its place.
        'could_not_be_reopened',
        // ⚑ Its conversation ended while it waited on background work, which stopped with it.
        'background_stopped',
        // ⚑ **F074** — its turn ended on its provider's usage limit.
        'provider_limited',
        // ⚑ **F076** — its turn failed on a login this Mac had moved on from.
        'login_refused',
        // Its turn failed because its provider would not bill the account it ran on.
        'billing_refused',
      ])
      // 🔴 **Which of them an ask to stop can ride beside, as a closed record** — so a sixth cause
      // cannot be added without somebody deciding. ⛔ **`484` said ONE** (`turn_interrupted`, the
      // one naming an act); **`720` (R72) moved it on purpose**: a turn asked to stop that the
      // provider completed anyway stalls `turn_ended` WITH who asked — *"R43's two facts"*. ⚑ The
      // table is the fold's own ({@link AN_ASK_RIDES_ON}), and this is this test's reading of it.
      const AN_ASK_CAN_RIDE: Readonly<Record<TaskStallCause, boolean>> = {
        turn_ended: true,
        turn_interrupted: true,
        app_restarted: false,
        message_never_sent: false,
        could_not_be_reopened: false,
        background_stopped: false,
        // ⚑ **F074** — a turn's ending too: its provider refused it for the usage limit.
        provider_limited: true,
        // ⚑ **F076** — a turn's ending too: its provider refused it on a login this Mac moved on from.
        login_refused: true,
        // A turn's ending too: its provider would not bill the account it ran on.
        billing_refused: true,
      }
      expect(AN_ASK_RIDES_ON).toEqual(AN_ASK_CAN_RIDE)
      expect(TASK_STALL_CAUSES.filter((cause) => AN_ASK_RIDES_ON[cause])).toEqual([
        'turn_ended',
        'turn_interrupted',
        'provider_limited',
        'login_refused',
        'billing_refused',
      ])
      // ⚑ **And the fold reads the table**, off the source rather than off this test's opinion.
      const fold = readFileSync(join(here, '../src/shared/tasks.ts'), 'utf8')
      expect(fold).toContain('stalledBy: AN_ASK_RIDES_ON[cause] ? by : null')
      // ⚑ **D-005a** · `by` is the turn's own ask — `asked`, unless a stall the turn held for its
      // queue is written later, when it is the ask that turn carried.
      expect(fold).toContain("by: PieceRow['stalledBy'] = asked,")
    })

    it('🔴 an ask belongs to the turn it precedes and to NOTHING after it — the fold, on its own', () => {
      // ⛔ **The hazard put on the path the code walks** (standing). ⚠️ `SessionMachine` writes
      // `turn: 'interrupted'` for a permission answered `cancel` and records NO ask — `395`'s own
      // note names it as the fifth producer of that state — so a second task stalling on a later
      // interrupted turn must name nobody, even though an earlier one really was stopped by a
      // person. 🔴 **This is a fold test because the ledger is the subject**: the two turns and the
      // one ask are the shape, and driving a double to produce it would be measuring the double.
      const at = (ordinal: number, event: TranscriptEvent) => ({
        ordinal,
        event,
        at: 1_000 + ordinal,
      })
      // ⚑ **D-016** — a piece is opened by `work_given`.
      const assigned = (piece: string, number: number): TranscriptEvent => ({
        type: 'work_given',
        piece,
        label: `W1.${String(number)}`,
        parent: 'work_root',
        givenBy: 'sess_pm',
        title: 'the work',
        brief: 'the work',
      })
      const rows = derivePieces('sess_worker', [
        at(1, assigned('work_a', 1)),
        at(2, { type: 'work_interrupted', by: 'a-person' }),
        at(3, { type: 'turn', state: 'interrupted' }),
        at(4, assigned('work_b', 2)),
        // ⚑ **No ask before this one**, which is the whole construction.
        at(5, { type: 'turn', state: 'interrupted' }),
      ])
      expect(rows.map((row) => row.stalledBecause)).toEqual([
        'turn_interrupted',
        'turn_interrupted',
      ])
      // 🔴 **The first names the person, and the second names nobody.**
      expect(rows[0]?.stalledBy).toEqual({ by: 'a-person', asker: null })
      expect(rows[1]?.stalledBy).toBeNull()
    })

    it('⛔ a conversation ENDING is not attributed to whoever stopped the turn before it', async () => {
      const { worker, workerHandle, piece } = await aPmAndItsWorker()
      await waitFor(
        () => workerHandle.status() === 'waiting_permission',
        'the child to park on its card',
      )
      // ⛔ **The card is answered first**, by the person whose card it is — every turn the Fake
      // drives parks on one. ⚑ **D-017 — `end_agent` is gone**, so the ask one row above the ending
      // is a person's Stop with no turn running, and the ending is that person's Close. ⚑ **D-016c ·
      // a stop moves no piece**: the piece keeps the cause its turn's own ending gave it
      // (`turn_ended`). ⚑ **What this test measures is unchanged**: an ask is recorded just before
      // the ending, and the task's cause still names nobody.
      await letTheTurnFinish(worker)
      await waitFor(
        () => pieceOf(worker, piece)?.stalledBecause === 'turn_ended',
        'the turn ending to reach the task',
      )
      expect(pieceOf(worker, piece)?.stalledBy).toBeNull()
      await host.interrupt(worker, window)
      expect(store.lastAskToStop(worker)).toMatchObject({ by: 'a-person', asker: null })
      await host.close(worker, window)
      await waitFor(
        () => ledger(worker).some((event) => event.type === 'status' && event.state === 'ended'),
        'the ending to reach the ledger',
      )
      const row = pieceOf(worker, piece)
      // 🔴 **An ask stands one row above the ending, and the task's cause still names nobody.**
      // ⛔ That is the clearing line doing its job: an ask belongs to the turn it precedes and to
      // nothing after it, because `SessionMachine` writes `turn: 'interrupted'` for a permission
      // answered `cancel` with no ask at all, and a name left standing would land on a gesture nobody
      // performed. ⚑ And the ending itself re-words nothing: the cause is still the turn's.
      expect(row?.stalledBecause).toBe('turn_ended')
      expect(row?.stalledBy).toBeNull()
      // ⚠️ **And the ask is still readable where it belongs** — on the conversation.
      expect(store.lastAskToStop(worker)).toMatchObject({ by: 'a-person', asker: null })
      theAskIsReported(worker)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §6 · the two nulls on `list_questions.words`
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§6 · a null that says which null it is', () => {
    it('🔴 `words: null` for a question that IS the caller’s says so, instead of reading as *there are none*', async () => {
      const { pm, pmTools, worker } = await aPmAndItsWorker()
      // ⚠️ **D-016 · the brief's turn has parked**, so the ledger is still before the row is added.
      await cardOn(worker)
      // ⛔ **A routing whose raising row this build cannot read** — which is a `.brobot` bundle
      // written by a build whose payloads have moved, or a row `toPersistedEvents` skipped. ⚑ It is
      // appended rather than simulated because the state is a property of the LEDGER: the routing
      // survived and the question's words did not.
      const last = store.events(worker).at(-1)
      store.append(
        worker,
        (last?.ordinal ?? 0) + 1,
        { type: 'request_routed', requestId: 'ui_lost_1', to: 'the-parent', parent: pm },
        (last?.at ?? 0) + 1,
      )
      const said = await callOn(pmTools, 'list_questions', {})
      const rows = said.questions as Record<string, unknown>[]
      const lost = rows.find((one) => one.question === 'ui_lost_1')
      // ⚠️ **It IS this caller's to answer** — `answerable_by_you` is true and `because` is null —
      // and the words are missing anyway, which is the case a bare `null` said nothing about.
      expect(lost?.answerable_by_you).toBe(true)
      expect(lost?.words).toBeNull()

      const line = await textOf(pmTools, 'list_questions', {})
      expect(line).toContain('this app does not hold the words for this one')
    })

    it('⚠️ …and a PERMISSION’s null is left to its own sentence — the paired negative', async () => {
      const { pmTools, worker } = await aPmAndItsWorker()
      await cardOn(worker)
      const said = await callOn(pmTools, 'list_questions', {})
      const rows = said.questions as Record<string, unknown>[]
      const permission = rows.find((one) => one.answerable_by_you === false)
      expect(permission, JSON.stringify(rows)).toBeDefined()
      expect(permission?.words).toBeNull()
      // ⛔ **Two nulls, two meanings, and only one of them needed a sentence.** ⚑ This one's
      // neighbour already says it: `394` §2's gate is what makes the words absent, and `because`
      // carries the reason on the same row. ⚠️ Saying both would be one fact spelled twice.
      const line = await textOf(pmTools, 'list_questions', {})
      expect(line).toContain('a person answers this one')
      expect(line).not.toContain('this app does not hold the words for this one')
    })

    it('⛔ and the words are NOT widened to carry a permission’s command — a refusal with its reason', () => {
      // 🔴 **HO-031 §3 lists this as a defect and the repair is NOT mine to make** (standing rule 1:
      // derive from the code). ⚠️ BroBot wanted the command — *"It is in `events.permission_request`:
      // `Bash: ls -la <the project folder>`"* — and `433`'s bound is what stands in the way: a parent
      // reads *"the project, profile, provider, state, parent, spawn reason and last-turn ending"* of
      // a conversation, which are facts about its EXISTENCE, and a permission's command is the
      // content of somebody else's work.
      //
      // ⛔ **So the gate stays and is asserted BY NAME**, rather than quietly widened by a dispatch
      // whose brief is the status readers. ⚑ What a supervisor gets instead is §4's `given_to_is`:
      // the conversation is waiting on a person's decision, which is the question it was actually
      // asking.
      const source = readFileSync(join(mainRoot, 'runtime', 'runtime-host.ts'), 'utf8')
      // ⚠️ **611 · the gate is the same gate and it is spelled by the ARM now** (HO-088 §2.3). ⛔ It
      // was `if (request.because !== null) return { request, words: null }`, which withheld the
      // words from BOTH `a-person` arms the day a second one existed — and `HO-088` §2.3 rules the
      // other way for the new one: *"Ada still SEES that Ali asked and sees the answer."* ⚑ What
      // is still withheld is a PERMISSION's text, which is what `433`'s bound is about.
      expect(source).toContain("if (request.went.is === 'the-person-the-channel-left-it-with') {")
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §5 · what `interrupt_agent.reason` actually is
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · `reason` reaches no agent and no row, and the description says so', () => {
    it('🔴 a distinctive reason reaches NEITHER the ledger NOR the child’s next turn', async () => {
      // ⛔ **A held working turn, for `INTERRUPT_RAILS`' reason** — see §1's agent arm.
      const { pm, pmTools, worker, workerHandle } = await aPmAndItsWorker(holdingAWorkingTurn)
      await waitFor(() => workerHandle.status() === 'working', 'the child to be working')
      const distinctive = 'zzq-the-reason-nobody-keeps-9137'
      const said = await callOn(pmTools, 'interrupt_agent', {
        agent: worker,
        reason: distinctive,
      })
      expect(said.outcome, JSON.stringify(said)).toBe('ok')

      // ⛔ **The search shape is BOTH ledgers and every event type**, which is what makes this a
      // negative rather than a guess: the words could only reach the child through its own ledger
      // (a `user_turn`, a `message_queued`) or be kept in the asker's.
      for (const session of [worker, pm]) {
        expect(JSON.stringify(ledger(session)), `${session} kept the reason`).not.toContain(
          distinctive,
        )
      }
      // ⚑ **The control that plants TWO** (standing rule 12): the same search finds words that ARE
      // written, so a matcher that could never fire is not what produced the negative above.
      await host.send(worker, `${distinctive}-but-spoken`, asPm(pm))
      await waitFor(
        () => JSON.stringify(ledger(worker)).includes(`${distinctive}-but-spoken`),
        'the spoken words to reach the ledger',
      )
      expect(JSON.stringify(ledger(worker))).toContain(`${distinctive}-but-spoken`)
      expect(JSON.stringify(ledger(worker))).not.toContain(`"${distinctive}"`)
    })

    it('⛔ the host door cannot receive it — the strongest proof is that there is nowhere to put it', () => {
      // 🔴 **`477`'s standard, quoted by the brief: *a model must not be able to CLAIM it, and the
      // strongest proof is a build failure.*** ⚠️ Here the equivalent is the SIGNATURE: neither
      // door takes a reason, so a tool that wanted to deliver one has nothing to call.
      const hostSource = sourceOf('runtime', 'runtime-host.ts')
      // ⚑ **D-017** — the one door left; `endAgent`, its twin, went with `end_agent`.
      expect(hostSource).toContain('async interruptAgent(id: string, by: Caller)')
    })

    it('⚑ and the description says both halves, on the bytes each provider is sent', async () => {
      const { pmTools } = await aPmAndItsWorker()
      const definition = pmTools.tools.find((one) => one.name === 'interrupt_agent')
      expect(definition, 'interrupt_agent is published').toBeDefined()
      const described = `${definition?.description ?? ''} ${JSON.stringify(definition?.input ?? {})}`
      void described
      const source = sourceOf('runtime', 'agent-tools.ts')
      // ⛔ **The sentence a model reads**, pinned so it cannot drift back to implying a channel.
      // ⚑ F084 — what the agent IS told: which of its commands the stop ended, never who or why.
      expect(source).toContain(
        'The agent is not told who stopped it or why — only, the next time it is sent words, which of its commands the stop ended: to stop its turn and tell it why in one act, use message_agent with interrupt.',
      )
      // ⚠️ **Both halves on the ARGUMENT too** — not delivered, and not kept.
      expect(source).toContain(
        'the agent never sees these words and this app does not keep them. Required so that destroying work in flight is a stated decision.',
      )
      // ⚑ **D-017** — `end_agent`, which carried the identical argument and sentence, is gone.
    })

    it('⚠️ the UI half of the evidence, measured — interrupting and speaking really are two acts', async () => {
      const quiet = await personOpens('two-acts')
      const handle = latestHandle()
      await busy(quiet, handle)
      await host.interrupt(quiet, window)
      await turnsEnded(quiet)
      const asks = ledger(quiet).filter((event) => event.type === 'work_interrupted')
      expect(asks).toHaveLength(1)
      // ⛔ **The row carries `by` and `agent` and NOTHING ELSE that could be words.** ⚑ BroBot
      // inferred this from *"of 31 event types observed… no interrupt-shaped event"* and called the
      // inference weak; it is a measurement now.
      expect(Object.keys(asks[0] ?? {}).sort()).toEqual(['by', 'type'])
      await host.send(quiet, 'continue', window)
      await waitFor(
        () => ledger(quiet).some((event) => event.type === 'user_turn'),
        'the separate act of speaking',
      )
    })
  })

  // ──────────────────────────────────────────────────────────────────────────────────────────────
  // §7 · 491 · the three fields, through the product path that can make each non-default
  // ────────────────────────────────────────────────────────────────────────────────────────────

  describe('§7 · 491 · three fields nobody had seen carry a value', () => {
    it('🔴 a fresh task carries all three honestly, and a later turn that drives it again is its stall now', async () => {
      const { pmTools, workerProfile } = await aPm()
      const before = await callOn(pmTools, 'list_tasks', {})
      expect(before.you_gave).toEqual([])

      // ⛔ **This run's own boundary.** `beforeEach` made a fresh database; the slice and the
      // distinctive words additionally bind every event below to the act this case just performed.
      // ⚑ **D-016** — the give STARTS the worker, so its whole ledger is this run's.
      const eventFloor = 0
      const timeFloor = clock
      const words = '491-own-run-permission-task'
      const worker = (await aGive(pmTools, workerProfile, words)).agent
      await cardOn(worker)

      const newEntries = store.events(worker).slice(eventFloor)
      const assigned = newEntries.find(
        (entry) => entry.event.type === 'work_given' && entry.event.brief === words,
      )
      if (assigned?.event.type !== 'work_given') throw new Error('this run gave no piece')
      const taskId = assigned.event.piece
      expect(newEntries.some((entry) => entry.event.type === 'permission_request')).toBe(true)
      expect(newEntries.every((entry) => entry.at >= timeFloor)).toBe(true)

      // ⚑ **Control 1: the same read BEFORE a stall.** These nulls mean no ending has been
      // observed; `given_to_is` is non-null because it is a live join to the holder conversation.
      const blocked = await callOn(pmTools, 'list_tasks', {})
      const working = (blocked.you_gave as Record<string, unknown>[]).find(
        (row) => row.piece === taskId,
      )
      // ⚠️ **609 · `waiting-on-a-person` rather than `working`** — the child is parked on its
      // card, which is the whole subject of this control. ⛔ The three stall fields are still null,
      // which is the property this control is actually about: no ending has been observed.
      expect(working).toMatchObject({
        state: 'waiting-on-a-person',
        stalled_because: null,
        stalled_at: null,
        asked_to_stop_by: null,
        given_to_is: 'needs you',
      })
      const status = await callOn(pmTools, 'get_agent_status', { agent: worker })
      expect(working?.given_to_is).toBe((status.agent as Record<string, unknown>).state)

      // ⛔ **The product writes both inputs.** A real FakeRuntime permission is already pending;
      // the person presses the host's Stop door, which records the ask and interrupts that turn.
      aPersonTakesOver(worker)
      await host.interrupt(worker, window)
      await waitFor(() => pieceOf(worker, taskId)?.state === 'stalled', "this run's task to stall")
      const firstTerminal = store
        .events(worker)
        .slice(eventFloor)
        .find((entry) => entry.event.type === 'turn' && entry.event.state === 'interrupted')
      expect(firstTerminal, "the product wrote this run's interrupted terminal").toBeDefined()

      const stopped = await callOn(pmTools, 'list_tasks', {})
      const firstReading = (stopped.you_gave as Record<string, unknown>[]).find(
        (row) => row.piece === taskId,
      )
      expect(firstReading).toMatchObject({
        stalled_because: 'turn_interrupted',
        stalled_at: firstTerminal?.at,
        asked_to_stop_by: { by: 'a-person', asker: null },
      })

      // ⚠️ **Control 3: the same task's turn ends TWICE.** A follow-up names that piece without
      // opening another one. 🔴 **D-005 (F019): the second turn DRIVES the task again**, so its
      // ending is the stall now — the first observation is not latched across a turn that worked
      // on the task — and the ask that rode the first ending does not ride the second.
      await callOn(pmTools, 'message_agent', {
        agent: worker,
        text: '491-second-turn-about-the-same-task',
        kind: 'follow-up',
        piece: taskId,
      })
      await cardOn(worker, 2)
      await letTheTurnFinish(worker)
      const terminals = store
        .events(worker)
        .slice(eventFloor)
        .filter((entry) => entry.event.type === 'turn')
      expect(terminals).toHaveLength(2)
      const laterTerminal = terminals[1]
      expect(laterTerminal?.at).toBeGreaterThan(firstTerminal?.at ?? Number.MAX_SAFE_INTEGER)
      expect(store.lastEndedTurn(worker)?.endedAt).toBe(laterTerminal?.at)

      const afterSecond = await callOn(pmTools, 'list_tasks', {})
      const latched = (afterSecond.you_gave as Record<string, unknown>[]).find(
        (row) => row.piece === taskId,
      )
      expect(latched?.stalled_at).toBe(laterTerminal?.at)
      expect(latched?.stalled_because).toBe('turn_ended')
      expect(latched?.asked_to_stop_by).toBeNull()
      expect(
        store
          .events(worker)
          .slice(eventFloor)
          .every((entry) => entry.at >= timeFloor),
      ).toBe(true)
    })

    it('⚠️ `given_to_is` names the conversation, while the sentence never calls closed history frozen', async () => {
      const { pmTools, worker, workerProfile, piece, label } = await aPmAndItsWorker(
        undefined,
        '491-closed-history',
      )
      await cardOn(worker)
      await letTheTurnFinish(worker)
      const withdrawn = await callOn(pmTools, 'withdraw_task', { piece: label })
      expect(withdrawn.outcome, JSON.stringify(withdrawn)).toBe('ok')

      // ⚑ **D-016 · the holder is told it was taken back** — a turn of its own, parked on its card —
      // so the next give is held behind it.
      const next = await aGive(pmTools, workerProfile, '491-open-history')
      expect(next.agent).toBe(worker)
      await cardOn(worker, 2)
      const oldTask = { piece, label }
      const openTask = next

      const listed = await callOn(pmTools, 'list_tasks', {})
      const rows = listed.you_gave as Record<string, unknown>[]
      // ⚑ A piece that is over is not on the board unless asked for, and then in a line: its
      // record carries what its holder's conversation is doing now.
      expect(rows.find((row) => row.piece === oldTask.piece)).toBeUndefined()
      const oldRow = await callOn(pmTools, 'list_tasks', { piece: oldTask.label })
      const openRow = rows.find((row) => row.piece === openTask.piece)
      // ⛔ The structured values are BOTH true: they answer what their shared assignee
      // conversation is doing now. The state is not a claim that either task caused its card.
      // ⚑ **609 · the CLOSED row is untouched and the OPEN one composes** — which is the sharpest
      // available control for *a closed task is never touched*: both rows belong to the same
      // holder, so the only thing separating them is `TASK_IS_OPEN`.
      // ⚑ **D-017 · R11** — `given_to_is` is the one derivation's words: *needs you*.
      expect(oldRow).toMatchObject({ state: 'withdrawn', given_to_is: 'needs you' })
      expect(openRow).toMatchObject({
        state: 'waiting-on-a-person',
        given_to_is: 'needs you',
      })

      // ⚑ **D-016** — a line names its piece by the label.
      const text = await textOf(pmTools, 'list_tasks', { state: 'all' })
      // ⚑ By the piece each line is ABOUT: an open piece's line can name another piece in passing.
      const oldLine = text
        .split('\n')
        .find((line) => line.trimStart().startsWith(pieceLine(oldTask.label, '491-closed-history')))
      const openLine = text
        .split('\n')
        .find((line) => line.trimStart().startsWith(pieceLine(openTask.label, '491-open-history')))
      expect(oldLine).toBeDefined()
      expect(oldLine).not.toContain('the conversation holding it is waiting on a person')
      // ⚑ …and its whole line, which its record draws, does not say it either.
      expect(await textOf(pmTools, 'list_tasks', { piece: oldTask.label })).not.toContain(
        'the conversation holding it is waiting on a person',
      )
      expect(openLine).toContain('the conversation holding it is waiting on a person')
      expect(text).not.toContain('frozen:')
    })

    /**
     * 🔴 **491's boundary and 494's join, measured where the two readings DIVERGE** (standing rule
     * 3).
     *
     * ## ⛔ Why the idle ask is an AGENT's now
     *
     * ⚠️ **`491` wrote this with a person's Stop and a person's Cancel**, and asserted `null`. ⛔
     * Since `494` the cancel names an actor of its own, and with both gestures made by a person the
     * two readings — *the old ask leaked* and *the cancel was read* — give the SAME answer. ⚑ *A
     * comparison tested where both sides agree measures nothing*, so the idle ask is the PM's and
     * the cancel is the person's: `an-agent` is what a leak would say and `a-person` is what the
     * join says.
     *
     * ⚠️ **T-002 measured the first half of the title blind.** The Cancel writes its own author over
     * the fold's ask whatever stood before it (`whoCancelledIt`), so a leak can never win here. This
     * test pins `494`'s join, and `491`'s boundary is invisible to it (`491 M5` survives this file
     * alone). The boundary is killed by 720's controls in `the-act-this-app-knows-the-author-of.test.ts`.
     *
     * ## ⚠️ It is `§3.2`'s fixture as well — both producers, in one ledger
     *
     * ⛔ **Neither field is a constant here.** A `work_interrupted{by:'an-agent'}` and a
     * `user_decision{outcome:'cancel', by:{who:'a-person'}}` are both written, by their real
     * producers, and the row names the second.
     *
     * ## ⚑ D-017 · the idle ask is not written any more
     *
     * ⚠️ `interrupt_agent` on a conversation with no turn running answers `asked: false` and records
     * nothing, so the agent half of the comparison is gone from the ledger. ⚑ What is left is still
     * `494`'s join — the Cancel's author, off `user_decision` — and the PM's idle call is kept to
     * show it leaves no author behind.
     */
    it('🔴 an idle agent ask cannot author a later task whose permission a PERSON cancelled', async () => {
      const { pm, pmTools, worker, workerProfile, label } = await aPmAndItsWorker(
        undefined,
        '491-before-the-idle-stop',
      )

      // A first piece puts all later rows inside `selectPieceEvents`' durable lower bound. Finish
      // and withdraw it so the worker can accept the distinct piece whose attribution is under test.
      await cardOn(worker)
      await letTheTurnFinish(worker)
      const withdrawn = await callOn(pmTools, 'withdraw_task', { piece: label })
      expect(withdrawn.outcome, JSON.stringify(withdrawn)).toBe('ok')
      // ⚑ **D-016 · the holder is told it was taken back**, in a turn of its own that parks on its
      // card; a person answers it, so the conversation is idle again before the PM's call below.
      await cardOn(worker, 2)
      await letTheTurnFinish(worker)

      // ⛔ The PM calls `interrupt_agent` on this conversation, and no turn is running.
      // ⚑ **D-017 — an idle conversation has no turn to interrupt, so nothing is asked and no ask is
      // recorded** (`asked: false`): the agent's idle ask this test was built on no longer exists,
      // and the Cancel below is the only author on this ledger.
      const idle = await callOn(pmTools, 'interrupt_agent', {
        agent: worker,
        reason: '491 · an ask with no turn under it',
      })
      expect(idle.outcome, JSON.stringify(idle)).toBe('ok')
      expect(idle.asked).toBe(false)
      expect(store.lastAskToStop(worker)).toBeNull()
      void pm

      const second = await aGive(pmTools, workerProfile, '491-after-the-idle-stop')
      expect(second.agent).toBe(worker)
      await cardOn(worker, 3)
      const card = [...store.events(worker)]
        .reverse()
        .find((entry) => entry.event.type === 'permission_request')?.event
      if (card?.type !== 'permission_request') throw new Error('second task raised no permission')
      const turnsBeforeCancel = ledger(worker).filter((event) => event.type === 'turn').length
      await host.respondPermission(worker, card.id, { outcome: 'cancel' }, window)
      await waitFor(
        () => ledger(worker).filter((event) => event.type === 'turn').length > turnsBeforeCancel,
        'the cancelled permission to end its turn',
      )

      const listed = await callOn(pmTools, 'list_tasks', {})
      const row = (listed.you_gave as Record<string, unknown>[]).find(
        (one) => one.piece === second.piece,
      )
      expect(row?.stalled_because).toBe('turn_interrupted')
      expect(row?.stalled_at).toBeGreaterThan(0)
      // 🔴 **494 · the PERSON who pressed Cancel, and never the agent that asked before the turn
      // opened.** ⚠️ T-002 measured this passing WITHOUT `491`'s `user_turn` clear too: the Cancel
      // writes its own author over the idle ask. That boundary is killed by 720's controls in
      // `the-act-this-app-knows-the-author-of.test.ts` (an ask from another turn, turn finished).
      // ⚑ The cancellation still writes no ask of its own — asserted below — so this name comes off
      // {@link UserDecisionEvent.by} and from nowhere else.
      expect(row?.asked_to_stop_by).toEqual({ by: 'a-person', asker: null })
      // ⚑ **D-017** — no `work_interrupted` at all: the idle call recorded none (above).
      expect(ledger(worker).filter((event) => event.type === 'work_interrupted')).toHaveLength(0)
      // ⚠️ **And the conversation-level field names it** — the cancel is the LAST (and only) ask.
      expect(store.lastAskToStop(worker)).toMatchObject({
        by: 'a-person',
        asker: null,
        turn: 'the-turn-that-ended-last',
      })
    })

    it('⛔ `asked_to_stop_by` carries the OTHER actor too — through message, interrupt and the same public read', async () => {
      const words = '491-agent-actor-product-path'
      const { pm, pmTools, worker, piece } = await aPmAndItsWorker(holdingAWorkingTurn, words)
      await waitFor(
        () => host.agentCard(worker, asPm(pm), pm)?.state.is === 'active',
        'the deliberately held provider turn to be working',
      )
      const task = pieceOf(worker, piece)
      if (task === undefined) throw new Error('the product path gave no piece')

      const stopped = await callOn(pmTools, 'interrupt_agent', {
        agent: worker,
        reason: 'prove the agent-valued actor through its real producer',
      })
      expect(stopped.outcome, JSON.stringify(stopped)).toBe('ok')
      await waitFor(
        () => pieceOf(worker, task.piece)?.state === 'stalled',
        'the agent-interrupted task to stall',
      )

      // 🔴 No event is planted: these are the real producer rows from `give_work` and
      // `interrupt_agent`, followed by the provider terminal from the shared SessionMachine.
      expect(ledger(worker)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'work_given', piece: task.piece }),
          expect.objectContaining({ type: 'work_interrupted', by: 'an-agent', agent: pm }),
          expect.objectContaining({ type: 'turn', state: 'interrupted' }),
        ]),
      )

      const listed = await callOn(pmTools, 'list_tasks', {})
      const row = (listed.you_gave as Record<string, unknown>[]).find(
        (one) => one.piece === task.piece,
      )
      expect(row).toMatchObject({
        stalled_because: 'turn_interrupted',
        asked_to_stop_by: { by: 'an-agent', asker: pm },
      })
    })

    it('🔴 720 · R72 — a provider that FINISHES the turn anyway: the stall is its word, and who asked rides beside it', async () => {
      // ⚑ The same rig and the same producers as the test above, one fact over: the provider's own
      // word for the turn it was asked to stop is `completed` (Codex does this,
      // `probe:codex-early-interrupt`). ⛔ **On `main`: `stalled_by: null`, and neither text named
      // the ask** — `709` F-2.
      const words = '720-a-finished-turn-that-was-asked-to-stop'
      const { pm, pmProfile, pmTools, worker, workerProfile, piece } = await aPmAndItsWorker(
        (handle) => holdingAWorkingTurn(handle, 'completed'),
        words,
      )
      // ⚑ **724 · the asker has a NAME a person gave it**, so the sentences below can be read for it.
      expect(host.setAgentDisplayName(pmProfile, 'Ada')).not.toBeNull()
      await waitFor(
        () => host.agentCard(worker, asPm(pm), pm)?.state.is === 'active',
        'the deliberately held provider turn to be working',
      )
      const task = pieceOf(worker, piece)
      if (task === undefined) throw new Error('the product path gave no piece')
      const stopped = await callOn(pmTools, 'interrupt_agent', {
        agent: worker,
        reason: 'the provider will finish the turn anyway',
      })
      expect(stopped.outcome, JSON.stringify(stopped)).toBe('ok')
      await waitFor(
        () => pieceOf(worker, task.piece)?.state === 'stalled',
        'the task to stall on the turn the provider finished',
      )
      expect(ledger(worker)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'work_interrupted', by: 'an-agent', agent: pm }),
          expect.objectContaining({ type: 'turn', state: 'completed' }),
        ]),
      )

      // ⚑ The text read back, and the notice pushed — one composition, and the ask said AS an ask.
      const line = await textOf(pmTools, 'list_tasks', {})
      // 🔴 **724 · `720` F-C — who asked is NAMED** (re-aimed): this pinned only that an ask was
      // PRESENT, because an agent asker printed as its raw conversation id (`stoppedBy`, since `484`)
      // — a handle where `HO-095` §5.3 wants a name, which `720` reported rather than pinned as right.
      // 🔴 **729 · PM ruling R90 (re-aimed again)**: the asker here IS the reader — Ada stopped her own
      // worker — so it is said as her own act, never *"…, by Ada"* to Ada (`724` F-2). ⛔ RED on
      // `main`: *"…; it had been asked to stop, by Ada"*. ⚑ The id stays on the row, below.
      expect(line).toContain('its turn ended with this work still open; you asked it to stop')
      // The line also names who holds the piece: the worker, whose own name is Ada here too. That
      // one clause is checked and set aside; no other "by Ada" may appear.
      const holder = host.whatToCallTheConversation(worker)
      expect(holder).toBe(
        store.agentIdentities().find((one) => one.slug === workerProfile)?.displayName,
      )
      const heldBy = ` · held by ${holder} · `
      expect(line.split(heldBy)).toHaveLength(2)
      expect(line.replace(heldBy, ' · ')).not.toContain('by Ada')
      expectIdsOnlyInLinkTargets(line, [pm])
      await waitFor(
        () =>
          ledger(pm).some((event) => event.type === 'user_turn' && isGiverStallNotice(event.text)),
        'the parent to be pushed the notice',
      )
      const told = ledger(pm)
        .flatMap((event) => (event.type === 'user_turn' ? [event.text] : []))
        .find((text) => isGiverStallNotice(text))
      expect(told).toContain('its turn ended with this work still open; you asked it to stop)')
      expect(told).not.toContain('by Ada')
      expect(told).not.toContain(pm)
      // ⛔ **Never the asker as the one who ENDED it** — the sentence a cause-blind clause would write.
      for (const text of [line, told ?? '']) expect(text).not.toContain('still open, by')
      // ⚑ The payload: the PROVIDER's word as the cause, and who asked beside it — the id, which a
      // model can press on (asserted after the sentences, so a red above is theirs).
      const listed = await callOn(pmTools, 'list_tasks', {})
      const row = (listed.you_gave as Record<string, unknown>[]).find(
        (one) => one.piece === task.piece,
      )
      expect(row).toMatchObject({
        stalled_because: 'turn_ended',
        asked_to_stop_by: { by: 'an-agent', asker: pm },
      })
    })

    it('🔴 724 · 729 R90 — a turn the giver STOPPED itself: the line and the notice say its own ask as its own act, and never print the handle', async () => {
      // ⚑ The first test above, one fact over: the provider's own word is `interrupted`, so the
      // clause follows the stall as it always has. ⚑ `724` (`720` F-C) named the asker here, never
      // its handle — and the asker is the giver reading it, so since `729` (R90) its own ask is said
      // as its own act. ⚑ The ancestor tests below are where another asker is still NAMED.
      const words = '724-a-turn-the-giver-stopped-itself'
      const { pm, pmProfile, pmTools, worker, workerProfile, piece } = await aPmAndItsWorker(
        holdingAWorkingTurn,
        words,
      )
      expect(host.setAgentDisplayName(pmProfile, 'Ada')).not.toBeNull()
      await waitFor(
        () => host.agentCard(worker, asPm(pm), pm)?.state.is === 'active',
        'the deliberately held provider turn to be working',
      )
      const task = pieceOf(worker, piece)
      if (task === undefined) throw new Error('the product path gave no piece')
      const stopped = await callOn(pmTools, 'interrupt_agent', {
        agent: worker,
        reason: 'its own ask, said as its own act',
      })
      expect(stopped.outcome, JSON.stringify(stopped)).toBe('ok')
      await waitFor(
        () => pieceOf(worker, task.piece)?.state === 'stalled',
        'the agent-interrupted task to stall',
      )
      // 🔴 The subject: neither sentence prints the handle — and, 🔴 **729 · PM ruling R90
      // (re-aimed)**, Ada is the one reading them and the one who asked, so both say it as her own
      // act rather than naming her to herself (`724` F-2). ⛔ RED on `main`: *"…stopped, by Ada"*.
      const line = await textOf(pmTools, 'list_tasks', {})
      expect(line).toContain('the turn it was running in was stopped; you asked it to stop')
      // The line also names who holds the piece: the worker, whose own name is Ada here too. That
      // one clause is checked and set aside; no other "by Ada" may appear.
      const holder = host.whatToCallTheConversation(worker)
      expect(holder).toBe(
        store.agentIdentities().find((one) => one.slug === workerProfile)?.displayName,
      )
      const heldBy = ` · held by ${holder} · `
      expect(line.split(heldBy)).toHaveLength(2)
      expect(line.replace(heldBy, ' · ')).not.toContain('by Ada')
      expectIdsOnlyInLinkTargets(line, [pm])
      await waitFor(
        () =>
          ledger(pm).some((event) => event.type === 'user_turn' && isGiverStallNotice(event.text)),
        'the parent to be pushed the notice',
      )
      const told = ledger(pm)
        .flatMap((event) => (event.type === 'user_turn' ? [event.text] : []))
        .find((text) => isGiverStallNotice(text))
      expect(told).toContain('the turn it was running in was stopped; you asked it to stop.')
      expect(told).not.toContain('by Ada')
      expect(told).not.toContain(pm)
      // ⚑ The control: the ROW keeps the id a model can press on (after the sentences, so a red
      // above is theirs).
      const listed = await callOn(pmTools, 'list_tasks', {})
      const row = (listed.you_gave as Record<string, unknown>[]).find(
        (one) => one.piece === task.piece,
      )
      expect(row).toMatchObject({
        stalled_because: 'turn_interrupted',
        asked_to_stop_by: { by: 'an-agent', asker: pm },
      })
    })

    it('🔴 724 · `720` F-C — an ANCESTOR that is not the giver asks: the giver is told the ancestor’s name', async () => {
      // ⚑ **Found by `724`'s review**: in the two tests above the asker IS the giver, so a sentence
      // that named the giver, or the reader, instead of whoever asked would pass them. ⚠️ **Since
      // `729` (R90) they assert the reader's OWN act**, so what would pass them now is saying *"you
      // asked it to stop"* of every agent's ask — which this test, and its `turn_ended` twin below,
      // refuse. ⚑ Any
      // ancestor may ask (`mayInterruptDownTheChain`): Grace, two levels up, stops Bob, the worker Ada
      // gave the work to — three names, and only the asker's is right.
      await bringIdentityIntoBeing('pm-g')
      await bringIdentityIntoBeing('worker-g')
      const boss = await personOpens('boss-g')
      for (const [slug, name] of [
        ['boss-g', 'Grace'],
        ['pm-g', 'Ada'],
        ['worker-g', 'Bob'],
      ] as const) {
        expect(host.setAgentDisplayName(slug, name), slug).not.toBeNull()
      }
      const bossTools = agentToolsFor(host, boss)
      // ⚑ **D-016 · each give starts the conversation below it**, its brief the first turn.
      const pm = (await aGive(bossTools, 'pm-g', 'the plan')).agent
      const pmTools = agentToolsFor(host, pm)
      const words = '724-an-ancestor-asks'
      const given = await aGive(pmTools, 'worker-g', words, holdingAWorkingTurn)
      const worker = given.agent
      await waitFor(
        () => host.agentCard(worker, asPm(pm), pm)?.state.is === 'active',
        'the deliberately held provider turn to be working',
      )
      const task = pieceOf(worker, given.piece)
      if (task === undefined) throw new Error('the product path gave no piece')
      const stopped = await callOn(bossTools, 'interrupt_agent', {
        agent: worker,
        reason: 'the plan changed',
      })
      expect(stopped.outcome, JSON.stringify(stopped)).toBe('ok')
      await waitFor(
        () => pieceOf(worker, task.piece)?.state === 'stalled',
        'the work to stall on the turn Grace stopped',
      )
      await waitFor(
        () =>
          ledger(pm).some(
            (event) =>
              (event.type === 'user_turn' || event.type === 'message_queued') &&
              isGiverStallNotice(event.text),
          ),
        'the giver to be told',
      )
      const told = ledger(pm)
        .flatMap((event) =>
          event.type === 'user_turn' || event.type === 'message_queued' ? [event.text] : [],
        )
        .find((text) => isGiverStallNotice(text))
      // 🔴 The push names the ASKER — not the giver reading it, not the holder it is about. ⚑ **D-016
      // · commit 7 · R3 — by the piece it owns**, beside its name: nothing else in the sentence names
      // that conversation.
      const grace = theConversationCalled('Grace', store.workThatNames(boss))
      expect(store.workThatNames(boss)).not.toBeNull()
      expect(told).toContain(`the turn it was running in was stopped, by ${grace}.`)
      expect(told).not.toMatch(/stopped, by (Ada|Bob|sess_)/)
      // 🔴 …and so does the line `list_tasks` hands the giver.
      const line = await textOf(pmTools, 'list_tasks', {})
      expect(line).toContain(`the turn it was running in was stopped, by ${grace}`)
      expect(line).not.toMatch(/stopped, by (Ada|Bob|sess_)/)
      // ⚑ The control: the row keeps the ASKER's id, which a model can press on.
      const listed = await callOn(pmTools, 'list_tasks', {})
      const row = (listed.you_gave as Record<string, unknown>[]).find(
        (one) => one.piece === task.piece,
      )
      expect(row).toMatchObject({
        stalled_because: 'turn_interrupted',
        asked_to_stop_by: { by: 'an-agent', asker: boss },
      })
    })

    /**
     * ⚑ **729 · the ancestor rig, for the tests below** — the test above's, with the provider's own
     * word for the turn chosen: Grace (two levels up) may stop Bob, the worker Ada gave the work to.
     */
    const graceAdaAndBob = async (
      itsWord: 'interrupted' | 'completed',
      words: string,
    ): Promise<{
      boss: string
      bossTools: AgentToolset
      pm: string
      pmTools: AgentToolset
      worker: string
      piece: string
    }> => {
      await bringIdentityIntoBeing('pm-g')
      await bringIdentityIntoBeing('worker-g')
      const boss = await personOpens('boss-g')
      for (const [slug, name] of [
        ['boss-g', 'Grace'],
        ['pm-g', 'Ada'],
        ['worker-g', 'Bob'],
      ] as const) {
        expect(host.setAgentDisplayName(slug, name), slug).not.toBeNull()
      }
      const bossTools = agentToolsFor(host, boss)
      // ⚑ **D-016 · each give starts the conversation below it**, its brief the first turn.
      const pm = (await aGive(bossTools, 'pm-g', 'the plan')).agent
      const pmTools = agentToolsFor(host, pm)
      const given = await aGive(pmTools, 'worker-g', words, (handle) =>
        holdingAWorkingTurn(handle, itsWord),
      )
      const worker = given.agent
      await waitFor(
        () => host.agentCard(worker, asPm(pm), pm)?.state.is === 'active',
        'the deliberately held provider turn to be working',
      )
      return { boss, bossTools, pm, pmTools, worker, piece: given.piece }
    }

    it('🔴 729 · R90 — the control on the other shape: an ANCESTOR asks and the provider FINISHES the turn — the giver is told Grace’s name, as an ask', async () => {
      // ⚑ **The R90 control on `turn_ended`**: the test above is the control on `turn_interrupted`,
      // and the two arms of `theStallAndItsAsk` are two branches — so each shape has another asker
      // that must still be NAMED, while the reader's own ask (the two `720`/`724` tests above) is
      // said as its own act.
      const { bossTools, pm, pmTools, worker, piece } = await graceAdaAndBob(
        'completed',
        '729-an-ancestor-asks-and-the-turn-finishes',
      )
      const stopped = await callOn(bossTools, 'interrupt_agent', {
        agent: worker,
        reason: 'the plan changed',
      })
      expect(stopped.outcome, JSON.stringify(stopped)).toBe('ok')
      await waitFor(
        () => pieceOf(worker, piece)?.state === 'stalled',
        'the work to stall on the turn the provider finished',
      )
      await waitFor(
        () =>
          ledger(pm).some(
            (event) =>
              (event.type === 'user_turn' || event.type === 'message_queued') &&
              isGiverStallNotice(event.text),
          ),
        'the giver to be told',
      )
      const told = ledger(pm)
        .flatMap((event) =>
          event.type === 'user_turn' || event.type === 'message_queued' ? [event.text] : [],
        )
        .find((text) => isGiverStallNotice(text))
      const line = await textOf(pmTools, 'list_tasks', {})
      for (const text of [told ?? '', line]) {
        expect(text).toContain(
          'its turn ended with this work still open; it had been asked to stop, by Grace',
        )
        expect(text).not.toContain('you asked it to stop')
      }
    })

    it('🔴 729 · `725` draw 9 — a person’s band says who ASKED: Grace stops Bob while Ada, who gave the work, is closed', async () => {
      // ⚑ **`725` GAP-M3**: `stalledWorkForAPerson` copied ten fields off a row that carried the ask
      // and dropped that one, so the band could not say it. ⛔ RED on `main`: no `askedToStop`. ⚑ The
      // giver is CLOSED before the ask, so nobody can be told and the work is the person's (`557`).
      const { boss, bossTools, pm, worker, piece } = await graceAdaAndBob(
        'interrupted',
        '729-the-band-says-who-asked',
      )
      host.claimSession(pm, window)
      await host.close(pm, window)
      const stopped = await callOn(bossTools, 'interrupt_agent', {
        agent: worker,
        reason: 'the plan changed',
      })
      expect(stopped.outcome, JSON.stringify(stopped)).toBe('ok')
      await waitFor(
        () => pieceOf(worker, piece)?.state === 'stalled',
        'the work to stall on the turn Grace stopped',
      )
      const row = host.stalledWorkForAPerson().rows.find((one) => one.piece === piece)
      // ⚑ **D-016** — the giver is `giver`, where it was `assignedBy`.
      expect(row).toMatchObject({ giver: pm, because: 'turn_interrupted' })
      // 🔴 The subject: who asked, and the NAME a person reads — never the handle. ⚑ **D-016 ·
      // commit 7 · R3 — beside the piece it owns**: nothing on the row names the asker.
      const itsWork = store.workThatNames(boss)
      expect(itsWork).not.toBeNull()
      expect(row?.askedToStop).toEqual({
        by: 'an-agent',
        asker: boss,
        askerName: theConversationCalled('Grace', itsWork),
      })
      // ⚑ **The name is read per answer** (`729`'s review): renamed, the next look says the new name —
      // a memo that outlived one answer would say *Grace* for the life of the app.
      expect(host.setAgentDisplayName('boss-g', 'Gina')).not.toBeNull()
      const renamed = host.stalledWorkForAPerson().rows.find((one) => one.piece === piece)
      expect(renamed?.askedToStop?.askerName).toBe(theConversationCalled('Gina', itsWork))
    })
  })
})
