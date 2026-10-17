import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
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
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { REQUEST_IS_OPEN } from '../src/shared/questions'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import { permanenceInWords } from '../src/main/runtime/agent-tool-answer-words'
import type { RailPermanence } from '../src/shared/refusals'

/**
 * 🔴 **496 · the card a third party was holding** — Slice 5, HO-034 §1.
 *
 * ## ⛔ The ruling
 *
 * > ⚑ **An agent may not end a conversation while a person is being asked something in it. A person
 * > may.**
 *
 * ⛔ ***The person whose card evaporates is a different person from the one who clicked.*** ⚠️ A
 * permission answers *did anybody mean this*; an end means *end this agent*, and **it does not mean
 * *void the pending decision that agent is waiting on*, because the caller was never shown that
 * decision.** 🔴 **One consequence, two confirmations needed, one obtained** — and no amount of
 * labelling the verb destructive closes that gap.
 *
 * ## ⚠️ What `493` measured, which is the starting point rather than the brief
 *
 * ⛔ **`interruptAgent` computes the target's state and asks `admitInterrupt` before touching the
 * provider; `endAgent` did not.** It asked `mayCommand`, then `assertMayReach('end', …)`, recorded
 * the ask and called `close` — and both adapters settle every pending request during close, so a
 * parent whose reach admitted could settle a person's card with a gesture that person never saw.
 *
 * ## ⛔ What is NOT the defect, and this file asserts that it stayed right
 *
 * ⚑ **`questions.ts` on `settleAll`** — *"not `rejected` — a rejection is somebody DECIDING. Nobody
 * decided"* — **is correct and is why the current behaviour was never a LIE.** ⛔ The ledger honestly
 * recorded that nobody decided. The defect is the ACT, so the repair is a refusal rather than a
 * better row, and §4.2 pins the word an ending still gives a question it was allowed to take.
 *
 * ⚑ **Real host, real SQLite ledger, real migrations, real tools, real rails.** The only double is
 * the provider.
 *
 * ## ⚑ D-017 · the agent half's verb is gone
 *
 * ⚠️ **`end_agent` no longer exists** (commit 3): nothing ends a conversation, so the ruling's first
 * sentence now holds with no door to guard. ⚑ What stays is the card: the person's arm (§3), the card
 * surviving an agent's refused act (§4 — asked of `interrupt_agent`, the one verb left that cuts into
 * a turn) and `withdraw_task` on a parked child (§5).
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

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

/** `394`'s double, with the handles kept — a test has to BE the provider to park like one. */
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

describe('496 · the card a third party was holding', () => {
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
  let pairs: number
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-card-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-card-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 11_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
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

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
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
   *
   * ⚑ **D-016 · the door is `give_work`**, and the piece it gives is the child's first turn — the
   * brief — which runs in the giver's `ask`. ⚑ So the child is at work on its parent's piece from
   * here on, and the card it parks on is that work's.
   */
  const aPmAndItsWorker = async (): Promise<{
    pm: string
    pmProfile: string
    worker: string
    piece: string
    pmTools: AgentToolset
    workerHandle: FakeSessionHandle
  }> => {
    const nth = ++pairs
    const pmProfile = `pm-${String(nth)}`
    const workerProfile = `worker-${String(nth)}`
    await bringIdentityIntoBeing(workerProfile)
    const pm = await personOpens(pmProfile)
    const pmTools = agentToolsFor(host, pm)
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: workerProfile,
      title: 'the work this dispatch is about',
      brief: 'a long piece of work',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return {
      pm,
      pmProfile,
      worker: given.agent as string,
      piece: given.label as string,
      pmTools,
      workerHandle: latestHandle(),
    }
  }

  /**
   * ⚑ **A child parked on a person's card, waited for on BOTH halves** — `397`'s helper.
   *
   * ⚠️ The handle's status moves before the ROW lands, so a caller that needs the card's id waits
   * for the ledger too. ⚑ **D-016** — the turn that parks is the brief's, the parent's own act: the
   * give sent it, so nothing is sent here.
   */
  const parkedOnACard = async (sessionId: string, handle: FakeSessionHandle): Promise<void> => {
    await waitFor(
      () => handle.status() === 'waiting_permission',
      'the turn to park on its permission card',
    )
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

  /** The one derived row for the card, off the store's own narrow read. */
  const cardRow = (sessionId: string): { state: string; endedAt: number | null } => {
    const id = cardOn(sessionId)
    const found = store.routedRequestsOf(sessionId).find((one) => one.requestId === id)
    if (found === undefined) throw new Error(`no routed request ${id} on ${sessionId}`)
    return { state: found.state, endedAt: found.endedAt }
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · §2 · `end_agent`'s rail and its table — gone with the verb (D-017)
  // ───────────────────────────────────────────────────────────────────────────────────────────
  //
  // ⚑ **D-017 · commit 3 removed `end_agent`, `RuntimeHost.endAgent` and `end-rails.ts`**: nothing
  // ends a conversation any more, so an agent has no verb left that could settle a person's card by
  // tearing its conversation down. ⛔ §1 (the rail at the end door, its control, the stranger's
  // `no-such-agent`) and §2 (`END_RAILS` beside `INTERRUPT_RAILS`) measured that verb and went with
  // it. ⚑ The same rail at the interrupt door is `the-interruption-that-looks-like-a-fault.test.ts`'
  // — and §3–§5 below ask it where they asked the end door, because what they measure is the CARD.

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · a person may — in the same state, one card, one instant
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · the person’s arm, which held with no work', () => {
    it('🔴 one card, one instant: the agent is refused and the person’s close goes through', async () => {
      const { worker, pmTools, workerHandle } = await aPmAndItsWorker()
      // ⚑ **The person takes the child's stream**, which is how a window comes to own a conversation
      // an agent spawned — `mayClaim` is true only while `ownerId` is null, and `mayCommand` still
      // admits the parent afterwards. ⛔ **So this is ONE session both callers can reach**, which is
      // what makes the two answers below a comparison rather than two situations.
      host.claimSession(worker, window)
      await parkedOnACard(worker, workerHandle)
      const card = cardOn(worker)

      // ⚑ **D-017 — the agent's act is `interrupt_agent`**, the one verb left that cuts into a
      // conversation's turn; `end_agent` is gone.
      const refused = await callOn(pmTools, 'interrupt_agent', { agent: worker, reason: 'x' })
      expect(refused.rail).toBe('a-person-is-being-asked')
      // ⚠️ **The same state, unmoved** — the person's close below is measured against the card the
      // agent was just refused over, not against a fresh one.
      expect(cardOn(worker)).toBe(card)
      expect(workerHandle.status()).toBe('waiting_permission')

      // 🔴 **And the person may.** ⛔ `RuntimeHost.close` asks `mayControl` and never reaches
      // `interrupt-rails.ts`.
      await host.close(worker, window)
      // ⛔ **It really stopped** — the slot is gone, which is what every other reader in this app asks.
      expect(host.sessionIds).not.toContain(worker)
      expect(workerHandle.status()).toBe('ended')
    })
    // ⚑ **D-017** — §3.2 (*`admitEnd` has one caller and no person-facing path reaches it*) went
    // with `admitEnd`: there is no end door left for a person's path to reach.
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the card SURVIVES the refusal — shown, not asserted about
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · the card the refusal was protecting', () => {
    it('🔴 still open, still answerable, and the person answers it afterwards', async () => {
      const { worker, pmTools, workerHandle } = await aPmAndItsWorker()
      host.claimSession(worker, window)
      await parkedOnACard(worker, workerHandle)
      const card = cardOn(worker)
      expect(REQUEST_IS_OPEN[cardRow(worker).state as never]).toBe(true)

      // ⚑ **D-017** — the agent's act is `interrupt_agent` (§1's note).
      expect((await callOn(pmTools, 'interrupt_agent', { agent: worker, reason: 'x' })).rail).toBe(
        'a-person-is-being-asked',
      )

      // ⛔ **Not just *the call was refused*.** ⚠️ A refusal that tore the card down on its way out
      // would pass a refusal assertion — so the row is read again, by id, off the store's own narrow
      // read, and it is the SAME card in the SAME state.
      expect(cardOn(worker)).toBe(card)
      expect(REQUEST_IS_OPEN[cardRow(worker).state as never]).toBe(true)
      expect(cardRow(worker).endedAt).toBeNull()

      // 🔴 **And it is still ANSWERABLE**, which is the half a row cannot show: the person answers
      // it, the turn resumes, and the conversation comes back to idle.
      await host.respondPermission(worker, card, { outcome: 'allow' }, window)
      await waitFor(() => workerHandle.status() === 'idle', 'the child to finish its turn')
      expect(cardRow(worker).state).toBe('decided')
      expect(ledger(worker).some((event) => event.type === 'user_decision')).toBe(true)
    })

    it('⚠️ …and when an ending IS allowed to take a card, the word is still `abandoned`', async () => {
      // ⛔ **`questions.ts` on `settleAll` stays right and this pins it** (§1.1 of the brief):
      // *"not `rejected` — a rejection is somebody DECIDING. Nobody decided."* ⚑ The person's end is
      // the path that still reaches a live card, and the ledger records it as the conversation going
      // away rather than as anybody's decision.
      const { worker, workerHandle } = await aPmAndItsWorker()
      host.claimSession(worker, window)
      await parkedOnACard(worker, workerHandle)
      await host.close(worker, window)
      await waitFor(() => cardRow(worker).state !== 'open', 'the card to settle with the ending')
      expect(cardRow(worker).state).toBe('abandoned')
      expect(cardRow(worker).state).not.toBe('rejected')
      expect(ledger(worker).some((event) => event.type === 'user_decision')).toBe(false)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · `withdraw_task` on a parked child — what `end_agent`'s sentence named, walked end to end
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · `withdraw_task`, and what it does and does not clear', () => {
    it('🔴 withdrawing is admitted while the child is parked — and the card STILL refuses the agent', async () => {
      const { worker, piece, pmTools, workerHandle } = await aPmAndItsWorker()
      host.claimSession(worker, window)
      // ⚑ **D-016** — the give was the work: its piece is open, and its brief is the parked turn.
      const [open] = store.openPiecesOf(worker)
      if (open === undefined) throw new Error('no piece was given')
      expect(open.label).toBe(piece)
      await waitFor(
        () => workerHandle.status() === 'waiting_permission',
        'the work to park on its card',
      )
      await waitFor(
        () => ledger(worker).some((event) => event.type === 'permission_request'),
        'the card to reach the ledger',
      )

      // ⚑ **D-017** — the agent's act is `interrupt_agent` (§1's note); `end_agent`'s sentence named
      // `withdraw_task`, and the act is still walked here: the work goes back while the person's
      // question stays exactly where it is.
      const refused = await callOn(pmTools, 'interrupt_agent', { agent: worker, reason: 'x' })
      expect(refused.rail).toBe('a-person-is-being-asked')
      const back = await callOn(pmTools, 'withdraw_task', { piece: open.label })
      expect(back.outcome, JSON.stringify(back)).toBe('ok')
      expect(back.state).toBe('withdrawn')

      // ⛔ **And the rail is UNMOVED, which is why no sentence promises otherwise.**
      // `withdrawTask`'s own docblock: *"A child mid-turn on withdrawn work keeps running; what it
      // may no longer do is ANSWER."* ⚠️ A sentence reading *withdraw, then end* would have asked for
      // the loop `424` deleted from the other door's, with an extra step in front of it.
      expect(workerHandle.status()).toBe('waiting_permission')
      expect(REQUEST_IS_OPEN[cardRow(worker).state as never]).toBe(true)
      expect((await callOn(pmTools, 'interrupt_agent', { agent: worker, reason: 'x' })).rail).toBe(
        'a-person-is-being-asked',
      )

      // 🔴 **The PO's sequence, finished**: withdraw, the person answers, the child comes back idle.
      // ⚑ D-017 — there is no end to call after it: nothing ends a conversation.
      await host.respondPermission(worker, cardOn(worker), { outcome: 'allow' }, window)
      await waitFor(() => workerHandle.status() === 'idle', 'the child to come back to idle')
    })

    it('⚑ the text half and the structured half are one composition (492, criterion 20)', async () => {
      const { worker, pmTools, workerHandle } = await aPmAndItsWorker()
      await parkedOnACard(worker, workerHandle)
      // ⚑ **D-017** — asked of the interrupt door, the one that still meets this card.
      const said = await textOf(pmTools, 'interrupt_agent', { agent: worker, reason: 'x' })
      const structured = await callOn(pmTools, 'interrupt_agent', { agent: worker, reason: 'x' })
      // ⛔ **A person reading the transcript and a model reading the answer are told the same
      // thing**, because the text is composed from the same bytes rather than written beside them.
      expect(structured.rail).toBe('a-person-is-being-asked')
      expect(String(structured.reason)).toMatch(/[.!?]$/)
      const permanence = permanenceInWords(
        String(structured.rail),
        structured.permanence as RailPermanence,
      )
      expect(said).toBe(
        `refused (${String(structured.rail)}): ${String(structured.reason)} ${permanence}`,
      )
    })
  })
})
