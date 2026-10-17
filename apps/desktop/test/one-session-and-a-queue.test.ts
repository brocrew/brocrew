import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset, ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import type { ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { DEFAULT_CAPABILITIES } from '../src/shared/capabilities'
import { mailboxOf, stillHeld } from '../src/shared/mailbox'
import {
  theMessagesOf,
  type PersistedEventInfo,
  type RuntimeEventMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * 🔴 **440 · an identity that owns something, and the callers who wait** — HO-024 §4 criteria 26
 * and 27.
 *
 * ## ⛔ The two criteria, and why only one of them needed anything built
 *
 * | # | property |
 * |---|---|
 * | **26** | *An identity that owns an exclusive resource has one session, and callers QUEUE rather than being refused. Two callers get two answers, in order, with neither told no.* |
 * | **27** | *An agent needing a shared resource must ask the identity that holds it, because it has no other route to it.* |
 *
 * ⚑ **D-014 · 27 is no longer a rail.** Every agent may start a conversation as any agent, so a
 * second conversation of the holder's identity is admitted, and only the same parent starting it
 * twice is refused (`profile-already-live`). **§4 measures both.**
 *
 * 🔴 **D-014 · work goes only to a conversation the giver started** (tree §5: *shared services take
 * questions and notes, not work*). ⛔ So a second caller never gives the holder work: it asks, or
 * leaves a note, and the mailbox holds that in arrival order. **§2 measures the refusal and the
 * order with a note.**
 *
 * ⚠️ **D-016 took the one word 26 had built** — `takesWorkFrom`, *how many callers this identity
 * may hold work from at once* — end to end. ⛔ So the sections about the mark (§1) and its sentences
 * (§5) went with it.
 *
 * ⚑ **D-016 (commit 3, the tree) took the rest of what this file named**: `spawn_agent`, the
 * relationship rail (`assign-work-to-one-you-did-not-start`) and the one-open-task rail. Work is
 * given with `give_work`, which reaches the ONE conversation its giver has with that agent and starts
 * it the first time — so *work goes only to a conversation the giver started* is the shape of the
 * act now rather than a rail, and a second caller's give starts a conversation of its own (§2, §4).
 * ⚑ The forgetting is refused by the STALL RULE (`its-work-has-stalled`), which replaced the
 * one-open-task rail: a giver whose earlier piece stalled is told to follow it up or take it back
 * (§3).
 *
 * ## ⚠️ What *two callers get two answers, in order, with neither told no* is NOT satisfied by
 *
 * 🔴 **Today's single slot plus a retry fails both clauses of that sentence.** ⛔ *Neither told no* —
 * `agent-already-has-a-message-waiting` is the app saying no, and HO-025 §1 separated retryability
 * from remedy precisely so *you may try again* stops reading as *you were not refused*. ⛔ *In
 * order* — with a retry the order is whichever model happens to retry first, which the app neither
 * promises nor records, so the order is not merely unguaranteed but **underivable**.
 *
 * ⚑ **And the queue that satisfies both already existed.** `394` made the mailbox an ARRAY in
 * arrival order, `mailboxOf` derives that order from the ledger, and `event.kind ?? 'work'` reads a
 * row written before that dispatch. **§6 asserts both of §3's rules against the mechanism as it
 * stands rather than against anything this dispatch wrote.**
 *
 * ## 🔴 What must go on being refused, which is the half §1.1 of the brief is about
 *
 * ⛔ **The same caller giving twice is still refused** once its first piece stalled — by the stall
 * rule since D-016, by the open-work rail before it. That is
 * HO-023 §4's *forgetting*, and `428` keyed the spawn rail to the parent for exactly this reason:
 * *"a parent spawning an identity it already has live is refused — that is the forgetting. Two
 * different parents … is demand."* ⚑ **This dispatch says the same sentence about work**, and §3
 * pairs every admission with the refusal that survives it — including `428`'s own bound, asserted
 * here as a control rather than assumed.
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

/** `373`'s double; its registry is shared so every launch's toolset can be reached. */
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
    return handle
  }
  override async resume(
    ref: SessionRef,
    options: ResumeOptions,
  ): ReturnType<FakeRuntime['resume']> {
    const handle = await super.resume(ref, options)
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
}

describe('440 · one session, and the callers who wait', () => {
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
  let claimed: Set<string>
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ToolWatchingRuntime(provider, handed, issued),
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-440-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-440-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 8_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handed = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
    claimed = new Set<string>()
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
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const saidToProvider = (sessionId: string): string[] =>
    ledger(sessionId)
      .filter((event) => event.type === 'assistant_message')
      .map((event) => (event as { text: string }).text)
      .filter((text) => text.startsWith('echo: '))
      .map((text) => text.slice('echo: '.length))

  const openPiecesOf = (sessionId: string) => store.openPiecesOf(sessionId)

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

  const letTheTurnFinish = async (sessionId: string): Promise<void> => {
    const id = await cardOn(sessionId)
    if (!claimed.has(sessionId)) {
      host.claimSession(sessionId, window)
      claimed.add(sessionId)
    }
    await host.respondPermission(sessionId, id, { outcome: 'allow' }, window)
    await waitFor(
      () => ledger(sessionId).some((event) => event.type === 'turn'),
      'the turn to reach its own terminal',
    )
  }

  /**
   * 🔴 **The fixture: ONE worker, and TWO different conversations that can reach it.**
   *
   * ⚑ **The first caller gave the worker its first piece, and that give started it; the second did
   * not.** Both run on the one default set (D-014), so the second holds the widest giving word,
   * `canAssignWork: 'any'`, and still has no relationship to the worker. ⛔ **That is what every
   * answer below is about**: a give reaches the one conversation its GIVER has with that agent
   * (D-016), so the second caller can never hand this worker a piece — and that is the relationship,
   * never the grant.
   *
   * ⚑ **The brief is the worker's first turn**, and in the giver's `ask` it parks on its card: the
   * worker is BUSY on the first caller's piece from here on, which is what makes a queue observable.
   *
   * ⚠️ **The premise is asserted, not assumed** — who started the worker, the piece it holds, and
   * what the second caller holds.
   */
  const oneWorkerAndTwoCallers = async (): Promise<{
    worker: string
    first: string
    second: string
    firstPiece: string
    firstTools: AgentToolset
    secondTools: AgentToolset
    workerTools: AgentToolset
  }> => {
    await bringIdentityIntoBeing('worker')
    const first = await personOpens('pm')
    const firstTools = theToolsetJustHandedOut()
    const given = await callOn(firstTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'the work this dispatch is about',
      brief: 'the work this dispatch is about',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    expect(given.started).toBe(true)
    const worker = given.agent as string
    const workerTools = theToolsetJustHandedOut()
    await cardOn(worker)
    const second = await personOpens('archivist')
    const secondTools = theToolsetJustHandedOut()
    expect(store.parentOf(worker)).toBe(first)
    expect(openPiecesOf(worker).map((one) => [one.label, one.giver])).toEqual([
      [given.label, first],
    ])
    expect(store.capabilitiesOf('archivist')).toEqual(DEFAULT_CAPABILITIES)
    expect(store.capabilitiesOf('archivist')?.canAssignWork).toBe('any')
    return {
      worker,
      first,
      second,
      firstPiece: given.label as string,
      firstTools,
      secondTools,
      workerTools,
    }
  }

  /** ⚑ The worker's open pieces, by title — the brief's piece and whatever was given after it. */
  const titlesOpenOn = (worker: string): string[] => openPiecesOf(worker).map((one) => one.title)

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · criterion 26 — a second caller asks or leaves a note, and the queue keeps the order
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the second caller', () => {
    it('🔴 a second caller that did not start the worker is TOLD NO, by name', async () => {
      const { worker, firstPiece, secondTools } = await oneWorkerAndTwoCallers()

      // ⛔ **D-016 · a follow-up names a piece its sender gave THAT agent**, and the second caller
      // gave it none: naming the first caller's piece is refused by name.
      const refused = await callOn(secondTools, 'message_agent', {
        kind: 'follow-up',
        agent: worker,
        piece: firstPiece,
        text: 'and mine',
      })
      expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
      expect(refused.rail).toBe('not-a-piece-you-gave')
      expect(refused.retryable).toBe(false)

      // ⚑ **And its own give never reaches this worker**: it starts a conversation of its own.
      const its = await callOn(secondTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'and mine',
        brief: 'and mine',
      })
      expect(its.outcome, JSON.stringify(its)).toBe('ok')
      expect(its.agent).not.toBe(worker)
      expect(its.started).toBe(true)
      expect(titlesOpenOn(worker)).toEqual(['the work this dispatch is about'])
    })

    it('🔴 a second caller’s note waits its turn, and the ORDER is the ledger’s rather than a memory', async () => {
      const { worker, first, firstTools, secondTools, workerTools } = await oneWorkerAndTwoCallers()
      // ⛔ **Busy FIRST, so both are HELD rather than sent** — a queue that is never occupied is not
      // a queue, and `394`'s order claim is only observable when two entries are in the mailbox at
      // once. ⚑ The fixture's brief is parked on its card, so the worker is busy already.

      // ⚑ **The first caller's second piece**: a give to a busy worker is admitted, and held.
      const held1 = await callOn(firstTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'do mine',
        brief: 'do mine',
      })
      expect(held1.delivery, JSON.stringify(held1)).toBe('held')
      expect(held1.agent).toBe(worker)
      // ⚑ **The second caller's route**: a note, which opens nothing and is not refused.
      const held2 = await callOn(secondTools, 'message_agent', {
        kind: 'note',
        agent: worker,
        text: 'then mine',
      })
      expect(held2.delivery, JSON.stringify(held2)).toBe('queued')

      // ⚑ **Derived, not remembered** — `mailboxOf` walks the receiver's own ledger and the app's
      // live slot is not consulted. HO-024 §5.4's rule for digests, applied to a queue.
      expect(stillHeld(store.events(worker)).map((one) => one.text)).toEqual([
        'do mine',
        'then mine',
      ])

      // 🔴 **And the derived order IS the delivery order.** ⚑ **D-027 · one turn boundary, one
      // flush** — this read *"two turn boundaries, two flushes"*: the brief's turn ending now sends
      // everything held as ONE turn, and the provider is handed both in the order the ledger says
      // they arrived.
      await letTheTurnFinish(worker)
      await waitFor(
        () => saidToProvider(worker).some((said) => said.includes('then mine')),
        'the held messages to flush',
      )
      // ⚑ **The two held texts, in the order the PROVIDER was handed them** — everything else the
      // adapter echoed (the brief that made it busy, the app's own framing) is filtered out by
      // name rather than by position. ⚑ D-027 · both in ONE turn, so the order is read inside it.
      const carrying = saidToProvider(worker).filter(
        (said) => said.includes('do mine') || said.includes('then mine'),
      )
      expect(carrying).toHaveLength(1)
      const [both = ''] = carrying
      expect(both.indexOf('do mine')).toBeGreaterThan(-1)
      expect(both.indexOf('do mine')).toBeLessThan(both.indexOf('then mine'))
      // ⚑ …and the ledger's one row for it says the same, a part per message.
      const theTurn = ledger(worker)
        .filter((event) => event.type === 'user_turn')
        .at(-1)
      expect(
        theTurn?.type === 'user_turn' ? theMessagesOf(theTurn).map((one) => one.text) : [],
      ).toEqual(['do mine', 'then mine'])
      // ⛔ **Nothing is left held behind it**, so neither waits a turn more for its answer.
      expect(stillHeld(store.events(worker))).toEqual([])

      // ⛔ **The held piece's answer reaches the caller that gave it.** `reply_to_parent` derives its
      // destination from the piece, so this is the app routing rather than the test — and the
      // note beside it opened nothing.
      expect(titlesOpenOn(worker)).toEqual(['the work this dispatch is about', 'do mine'])
      const piece = openPiecesOf(worker).find((one) => one.title === 'do mine')
      if (piece === undefined) throw new Error('the held give opened no piece')
      expect(piece.giver).toBe(first)
      const replied = await callOn(workerTools, 'reply_to_parent', {
        piece: piece.label,
        outcome: 'done',
        summary: `answered for ${first}`,
      })
      expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
      expect(titlesOpenOn(worker)).toEqual(['the work this dispatch is about'])
      await waitFor(
        () =>
          ledger(first).some(
            (event) =>
              (event.type === 'user_turn' || event.type === 'message_queued') &&
              (event as { text: string }).text.includes(`answered for ${first}`),
          ),
        `the answer to reach ${first}`,
      )
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · what still refuses — the forgetting, kept
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · the same caller, twice', () => {
    it('🔴 the SAME caller is told of the piece its own stalled work holds, and its give goes through', async () => {
      const { worker, firstPiece, firstTools } = await oneWorkerAndTwoCallers()
      // ⛔ **The brief's turn ends with its piece still open** — the stall the give names.
      // ⚠️ Nothing is held behind it: a held message would run next and drive the piece again.
      await letTheTurnFinish(worker)
      await waitFor(
        () => openPiecesOf(worker).some((one) => one.state === 'stalled'),
        'the brief’s piece to stall when its turn ended',
      )

      const again = await callOn(firstTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'and also',
        brief: 'and also',
      })
      // ⚑ A stall refuses nothing; the answer names it.
      expect(again.outcome, JSON.stringify(again)).toBe('ok')
      // ⛔ **Its OWN piece, by label** — the one the brief opened.
      expect(again.stalled).toEqual([firstPiece])
      expect(titlesOpenOn(worker)).toEqual(['the work this dispatch is about', 'and also'])
    })

    it('⚑ `428`’s same-parent bound still holds: the same giver reaches the SAME conversation', async () => {
      // 🔴 **The control the brief asked for by name.** ⛔ HO-023 §4's forgetting was a SPAWN rail
      // (`profile-already-live`) and `426` calls it the no-deletion control. ⚑ **D-016 · it is the
      // shape of the give now**: a giver has ONE conversation with an agent, so giving that agent
      // work again reaches it and never starts a second one.
      const { worker, firstTools } = await oneWorkerAndTwoCallers()
      const again = await callOn(firstTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'the same identity, from the same giver',
        brief: 'the same identity, from the same giver',
      })
      expect(again.outcome, JSON.stringify(again)).toBe('ok')
      expect(again.agent).toBe(worker)
      expect(again.started).toBe(false)
    })

    it('⛔ a PERSON is refused by no rail', async () => {
      const { worker } = await oneWorkerAndTwoCallers()
      host.claimSession(worker, window)
      claimed.add(worker)
      // ⚑ **A person typing into a child is not giving it work**: the composer reaches the same
      // `queueMessage`, and it is held behind the brief's parked turn, opening nothing.
      await host.queueMessage(worker, 'what are you doing?', window)
      await waitFor(
        () =>
          ledger(worker).some(
            (event) => event.type === 'message_queued' && event.text === 'what are you doing?',
          ),
        'the person’s message to be held',
      )
      expect(openPiecesOf(worker)).toHaveLength(1)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · criterion 27 — D-014 opened the route, and the message door stays
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · the routes to the holder', () => {
    it('🔴 D-014 · with no grant at all, a SECOND session of the holder’s identity is admitted, and the message door admits it too', async () => {
      // ⛔ *"Has one session"* is not a rail in this app and must not become one: `428` removed the
      // app-wide scan BY RULING (HO-023 §4), because two parents wanting one fungible identity is
      // demand. ⚑ **D-014 · and nothing grants the start any more**: every agent may start a
      // conversation as any agent, so the second caller starts its own with no grant.
      // ⚑ **D-016** — the second caller's give starts that conversation, since it has none with
      // this agent.
      const { worker, secondTools } = await oneWorkerAndTwoCallers()
      const given = await callOn(secondTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'a second conversation of one identity',
        brief: 'a second conversation of one identity',
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      expect(given.agent).not.toBeUndefined()
      expect(given.agent).not.toBe(worker)
      // ⚑ **And asking the one that already holds it still works** — a note, since the second
      // caller gave it nothing to follow up (D-016).
      const asked = await callOn(secondTools, 'message_agent', {
        agent: worker,
        text: 'please do the thing you hold',
        kind: 'note',
      })
      expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §6 · the queue's own two rules — derived, and readable back through an older build
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§6 · derived, never remembered', () => {
    it('🔴 the fold is PURE and total, and a row written before `394` reads as work', () => {
      // ⛔ **§3 rule 1 of the brief, and the mechanism already honoured it.** `394` made `kind`
      // optional on the event because every row written before it held work — work was the only
      // thing that could be held — and `mailboxOf` reads the absence as `work` rather than as
      // unknown. ⚑ **This dispatch added no member to `MAILBOX_KINDS` and changed no reading**, so
      // there is nothing an older row can be misread as.
      const older: PersistedEventInfo[] = [
        {
          ordinal: 1,
          at: 10,
          event: { type: 'message_queued', messageId: 'msg_old', text: 'from an older build' },
        },
        {
          ordinal: 2,
          at: 11,
          event: {
            type: 'message_queued',
            messageId: 'msg_new',
            kind: 'question',
            text: 'from this one',
          },
        },
      ]
      const box = mailboxOf(older)
      expect(box.map((one) => one.kind)).toEqual(['work', 'question'])
      // ⚑ **Order is the fold's and not the caller's** — it walks once and appends.
      expect(box.map((one) => one.messageId)).toEqual(['msg_old', 'msg_new'])
    })

    it('🔴 the queue survives a quit: the held rows stay open, and the next start sends them first, in order', async () => {
      // ⚑ **D-017 · R3 — a quit is a STOP, and a stop ends nothing it held.** This said the
      // opposite, as a bound: *"`077` ruled that a resumed conversation comes back holding
      // nothing"*, and the teardown wrote `abandoned` for each held message. ⛔ That bound is gone.
      // The ledger is the queue now: each held message's `message_queued` row stays open across the
      // quit, and the next start rebuilds them — so criterion 26's ORDER is no longer bounded by
      // the life of the app.
      const { worker, firstTools, secondTools } = await oneWorkerAndTwoCallers()
      // ⚑ The fixture's brief is parked on its card, so both are held behind it.
      await callOn(firstTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'do mine',
        brief: 'do mine',
      })
      await callOn(secondTools, 'message_agent', { kind: 'note', agent: worker, text: 'then mine' })
      expect(stillHeld(store.events(worker))).toHaveLength(2)

      for (const built of hosts) await built.closeAll()
      hosts.length = 0
      // ⛔ **No ending was written for either** — they wait, in the order they arrived.
      expect(stillHeld(store.events(worker)).map((one) => one.text)).toEqual([
        'do mine',
        'then mine',
      ])
      expect(mailboxOf(store.events(worker)).map((one) => one.ending)).toEqual([null, null])

      // ⚑ **The next launch, and the next start** — a person's Reopen here; any delivery would do.
      host = buildHost()
      claimed.clear()
      const before = saidToProvider(worker).length
      await host.resumeSession(worker, window)
      claimed.add(worker)
      // ⚑ **Both go as the first turn of the new start**, in order, with neither told no. ⚑ D-027 ·
      // as ONE turn — this read *"the first goes as the first turn … and the second after that turn
      // ends"*: everything held now goes together, oldest first.
      await waitFor(() => saidToProvider(worker).length > before, 'the held messages to go')
      const [first = ''] = saidToProvider(worker).slice(before)
      expect(first.indexOf('do mine')).toBeGreaterThan(-1)
      expect(first.indexOf('do mine')).toBeLessThan(first.indexOf('then mine'))
      // ⛔ …so nothing is left waiting for a second turn, and each has its own ending.
      expect(stillHeld(store.events(worker))).toEqual([])
      expect(mailboxOf(store.events(worker)).map((one) => one.ending)).toEqual(['sent', 'sent'])
    })
  })
})
