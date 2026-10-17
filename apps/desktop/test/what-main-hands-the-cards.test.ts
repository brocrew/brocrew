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
import { REPLY_SUMMARY_LIMIT } from '../src/main/runtime/reply-rails'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_LABEL,
  agentName,
  type AgentIdentity,
  type LibraryEntry,
  type MessageSentEvent,
  type RuntimeEventMessage,
  type TranscriptEvent,
  type UserTurnEvent,
} from '../src/shared/runtime-ipc'

/**
 * # 671 — what main hands the cards
 *
 * Main must send every fact required by the new cards. Exercise each host door over real
 * SQLite and migrations, paired with the already-correct shape, so a renderer card cannot
 * conceal a missing upstream field.
 *
 * | § | gap | what this file pins |
 * |---|---|---|
 * | 1 | **G1** | `message_sent` carries the words, cut at `REPLY_SUMMARY_LIMIT` and MARKED when cut |
 * | 2 | **G2** | the brief's turn names the piece it opened, on BOTH branches, and never a message's |
 * | 3 | **G4a** | a library entry this app RAN names its identity; one it did not, names none |
 * | 4 | **G5a** | `agentName` folds its own fallback, so a recording and a live pane read one spelling |
 * | 5 | **R18** | one torn row blanks nothing: five surfaces ANSWER and each carries the count |
 *
 * ⛔ **What this file does NOT claim**: that any renderer DRAWS these facts. The cards are the
 * frontend's (`671` §7); this is what main hands them.
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

describe('671 · what main hands the cards', () => {
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-671-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-671-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_000_000
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

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  const call = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<{ structured: Record<string, unknown>; text: string }> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    const answered = await tool.call(args)
    return {
      structured: (answered.structured ?? {}) as Record<string, unknown>,
      text: answered.text,
    }
  }

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  /** Every row of one type, with the ordinal it was written at — the ORDER is a claim in §2. */
  const rowsOf = <Type extends TranscriptEvent['type']>(
    sessionId: string,
    type: Type,
  ): { ordinal: number; event: Extract<TranscriptEvent, { type: Type }> }[] =>
    store
      .events(sessionId)
      .filter((entry) => entry.event.type === type)
      .map((entry) => ({
        ordinal: entry.ordinal,
        event: entry.event as Extract<TranscriptEvent, { type: Type }>,
      }))

  const receipts = (sessionId: string): MessageSentEvent[] =>
    rowsOf(sessionId, 'message_sent').map((row) => row.event)

  /**
   * A PM in a window with one child of its own, started through the real door.
   *
   * ⚑ **D-016 · the give IS the work** — `give_work` starts the child, and its brief (`build it`) is
   * the child's first turn, which parks on its card; the piece is the one a follow-up names.
   */
  const aPmAndItsWorker = async (): Promise<{
    pm: string
    worker: string
    pmTools: AgentToolset
    workerTools: AgentToolset
    piece: string
    label: string
  }> => {
    const seeded = await personOpens('worker')
    await host.close(seeded, window)
    const pm = await personOpens('pm')
    const pmTools = theToolsetJustHandedOut()
    const given = await call(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The work this dispatch is about',
      brief: 'build it',
    })
    expect(given.structured.outcome, JSON.stringify(given.structured)).toBe('ok')
    return {
      pm,
      worker: given.structured.agent as string,
      pmTools,
      workerTools: theToolsetJustHandedOut(),
      piece: given.structured.piece as string,
      label: given.structured.label as string,
    }
  }

  /** The fake provider parks every turn on a card; a person allowing it lets the turn end. */
  const letTheTurnFinish = async (sessionId: string): Promise<void> => {
    const before = rowsOf(sessionId, 'turn').length
    await waitFor(
      () => ledger(sessionId).some((event) => event.type === 'permission_request'),
      'the card the turn parks on',
    )
    const asked = rowsOf(sessionId, 'permission_request').at(-1)?.event
    if (asked === undefined) throw new Error('no permission request on the ledger')
    if (!claimed.has(sessionId)) {
      host.claimSession(sessionId, window)
      claimed.add(sessionId)
    }
    await host.respondPermission(sessionId, asked.id, { outcome: 'allow' }, window)
    await waitFor(() => rowsOf(sessionId, 'turn').length > before, 'the turn to end')
  }

  /**
   * ⚑ **D-016** — {@link aPmAndItsWorker} with the brief's turn over, so the worker is free and a
   * message to it goes straight out.
   */
  const aPmAndItsIdleWorker = async (): ReturnType<typeof aPmAndItsWorker> => {
    const both = await aPmAndItsWorker()
    await letTheTurnFinish(both.worker)
    return both
  }

  /* ═══════════════════════════════ §1 · G1 — the words travel with the receipt ═════════════════ */

  describe('durable receiver facts', () => {
    it('keeps the receipt identity app-owned when a caller supplies one', async () => {
      const { pm, worker, pmTools } = await aPmAndItsIdleWorker()
      const supplied = 'message_act_00000000-0000-4000-8000-000000000001'
      const tool = pmTools.tools.find((one) => one.name === 'message_agent')
      expect(tool).toBeDefined()
      if (tool === undefined) throw new Error('message_agent was not registered')
      expect(tool.input).not.toHaveProperty('messageAct')
      const sent = await call(pmTools, 'message_agent', {
        agent: worker,
        text: 'a note',
        kind: 'note',
        messageAct: supplied,
      })
      expect(sent.structured.outcome).toBe('ok')
      expect(sent.structured.messageAct).toMatch(
        /^message_act_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      )
      expect(sent.structured.messageAct).not.toBe(supplied)
      expect(receipts(pm)).toHaveLength(1)
      expect(receipts(pm)[0]).toMatchObject({ messageAct: sent.structured.messageAct })
    })

    it('keeps the original work-label address separate from the receiver and the message piece', async () => {
      const { pm, worker, pmTools, label } = await aPmAndItsIdleWorker()
      const named = host.nameByItsWork(worker)
      const sent = await call(pmTools, 'message_agent', {
        agent: label,
        text: 'an informational note',
        kind: 'note',
      })
      expect(receipts(pm)).toHaveLength(1)
      expect(receipts(pm)[0]).toMatchObject({
        messageAct: sent.structured.messageAct,
        addressedAs: label,
        to: worker,
        toLabel: named,
        delivery: 'sent',
      })
      expect(receipts(pm)[0]).not.toHaveProperty('label')
      expect(receipts(pm)[0]).not.toHaveProperty('piece')
      expect(sent.structured.messageAct).toMatch(/^message_act_[0-9a-f-]{36}$/)
    })

    it('keeps exact id addressing on a held message and on an interrupting message', async () => {
      const { pm, worker, pmTools } = await aPmAndItsWorker()
      const named = host.nameByItsWork(worker)
      await waitFor(() => rowsOf(worker, 'permission_request').length > 0, 'the busy receiver')
      await call(pmTools, 'message_agent', { agent: worker, text: 'a held note', kind: 'note' })
      expect(receipts(pm)[0]).toMatchObject({
        addressedAs: worker,
        to: worker,
        toLabel: named,
        delivery: 'queued',
      })
      const sent = await call(pmTools, 'message_agent', {
        agent: worker,
        text: 'read this now',
        kind: 'note',
        interrupt: true,
      })
      expect(sent.structured.outcome).toBe('ok')
      expect(receipts(pm)).toHaveLength(2)
      expect(receipts(pm)[1]).toMatchObject({ addressedAs: worker, to: worker, toLabel: named })
    })
  })

  describe('§1 · G1 — `message_sent` carries the words, bounded and SAID when cut', () => {
    it('🔴 a message inside the bound is carried WHOLE, and carries no cut mark', async () => {
      // ⚑ **D-016** — a follow-up on the piece the give opened (the `work` kind went: the give is
      // the work, and a give writes no `message_sent`, so this is the first receipt).
      const { pm, worker, pmTools, piece, label } = await aPmAndItsIdleWorker()
      const sent = await call(pmTools, 'message_agent', {
        agent: worker,
        text: 'do the thing, and say when it is done',
        kind: 'follow-up',
        piece: label,
      })
      expect(sent.structured.outcome, JSON.stringify(sent.structured)).toBe('ok')
      const [receipt] = receipts(pm)
      expect(receipt?.text).toBe('do the thing, and say when it is done')
      // ⛔ **Absent, not `false`** — the event vocabulary's rule for a flag that is only ever true.
      expect(receipt).not.toHaveProperty('clipped')
      // ⚑ **The facts that were already right are still there** (the control): who, what, how —
      // and the piece it is about.
      expect(receipt).toMatchObject({
        to: worker,
        kind: 'follow-up',
        delivery: 'sent',
        piece,
        label,
      })
    })

    it('🔴 past the bound it is carried CUT at 1280 units and MARKED — the recipient holds it whole', async () => {
      const { pm, worker, pmTools } = await aPmAndItsIdleWorker()
      // ⛔ **Literals, not `REPLY_SUMMARY_LIMIT + 1`** — `380`'s lesson, which `reply-rails.ts`
      // states beside the constant: a bound written as the constant cannot pin it.
      expect(REPLY_SUMMARY_LIMIT).toBe(1280)
      const words = `${'a'.repeat(1270)}0123456789TAIL${'b'.repeat(100)}`
      expect(words.length).toBe(1384)
      await call(pmTools, 'message_agent', { agent: worker, text: words, kind: 'note' })
      const [receipt] = receipts(pm)
      expect(receipt?.text).toHaveLength(1280)
      expect(receipt?.text).toBe(words.slice(0, 1280))
      expect(receipt?.text?.endsWith('0123456789')).toBe(true)
      expect(receipt?.clipped).toBe(true)
      // ⚑ **The door behind the cut**: the recipient's own turn holds every unit.
      const turn = rowsOf(worker, 'user_turn').at(-1)?.event
      expect(turn?.text).toBe(words)
    })

    it('⚑ the edge of the bound: 1280 units is whole, 1281 is cut — and a HELD message is carried too', async () => {
      const { pm, worker, pmTools } = await aPmAndItsIdleWorker()
      const exactly = 'x'.repeat(1280)
      const oneOver = 'y'.repeat(1281)
      const cardsBefore = rowsOf(worker, 'permission_request').length
      // ⚠️ The first note starts a turn that parks on its card, so the second is HELD.
      await call(pmTools, 'message_agent', { agent: worker, text: exactly, kind: 'note' })
      await waitFor(
        () => rowsOf(worker, 'permission_request').length > cardsBefore,
        'the worker to be busy',
      )
      const held = await call(pmTools, 'message_agent', {
        agent: worker,
        text: oneOver,
        kind: 'note',
      })
      expect(held.structured.delivery).toBe('queued')
      const [first, second] = receipts(pm)
      expect(first).toMatchObject({ delivery: 'sent', text: exactly })
      expect(first).not.toHaveProperty('clipped')
      expect(second).toMatchObject({ delivery: 'queued', text: 'y'.repeat(1280), clipped: true })
    })
    it('⚠️ the cut never lands between the two halves of one character (`671` review)', async () => {
      const { pm, worker, pmTools } = await aPmAndItsIdleWorker()
      // ⛔ **An astral character straddling unit 1,280** — its high half at unit 1,279, its low half
      // at 1,280. A plain `slice` would store the high half alone, which no later read can repair.
      const words = `${'x'.repeat(1279)}😀${'y'.repeat(20)}`
      expect(words.charCodeAt(1279)).toBe(0xd83d)
      await call(pmTools, 'message_agent', { agent: worker, text: words, kind: 'note' })
      const [receipt] = receipts(pm)
      expect(receipt?.text).toBe('x'.repeat(1279))
      // ⚑ No half of any pair is left in what was stored.
      expect(/[\uD800-\uDFFF]/.test(receipt?.text ?? '')).toBe(false)
      expect(receipt?.clipped).toBe(true)
      // ⚑ **THE CONTROL**: the same character ENDING at unit 1,280 is whole, and kept.
      const fits = `${'x'.repeat(1278)}😀${'y'.repeat(20)}`
      await call(pmTools, 'message_agent', { agent: worker, text: fits, kind: 'note' })
      expect(receipts(pm)[1]?.text).toBe(`${'x'.repeat(1278)}😀`)
    })
  })

  /* ══════════════════ §2 · G2 — a piece and a question are told apart on arrival ════════════════ */

  /**
   * ⚑ **D-016 · the brief names the piece it OPENED** — `user_turn.piece`/`label` replace
   * `taskId`/`taskNumber`, and only a give's brief carries them (`work_given` replaces
   * `task_assigned`). ⛔ A give writes no `message_sent`, so the giver's copy of the id is the
   * give's own answer.
   */
  describe('§2 · G2 — the relayed turn names the piece it OPENED', () => {
    it('🔴 IDLE branch: the brief names its piece FIRST, then the piece row labels it, and the giver’s answer names the same id', async () => {
      const { worker, piece, label } = await aPmAndItsWorker()
      const turn = rowsOf(worker, 'user_turn').at(-1)
      const given = rowsOf(worker, 'work_given').at(-1)
      expect(turn?.event.text).toBe('build it')
      expect(given?.event.messageId).toBeUndefined()
      expect(turn?.event.piece).toBe(given?.event.piece)
      expect(turn?.event.label).toBe(given?.event.label)
      expect([piece, label]).toEqual([given?.event.piece, given?.event.label])
      // ⚠️ **The ORDER on this branch** — `UserTurnEvent.piece`'s own note: the turn is published
      // when the provider accepts it, and the piece row after it. A reader that joined in one
      // direction only would miss exactly this branch.
      expect(turn!.ordinal).toBeLessThan(given!.ordinal)
    })

    it('🔴 HELD branch: the piece row comes FIRST, and the turn the brief flushes into names it', async () => {
      const { worker, pmTools } = await aPmAndItsWorker()
      // ⚑ The first brief's turn parks on its card, so the worker is busy — and a second give from
      // the same giver reaches the SAME conversation (D-016), where it is held.
      await waitFor(
        () => ledger(worker).some((event) => event.type === 'permission_request'),
        'the worker to be busy',
      )
      const given = await call(pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'Now build it',
        brief: 'now build it',
      })
      expect(given.structured.agent).toBe(worker)
      expect(given.structured.delivery).toBe('held')
      const row = rowsOf(worker, 'work_given').at(-1)
      expect(row?.event.piece).toBe(given.structured.piece)
      expect(row?.event.messageId).toMatch(/^msg_/)
      await letTheTurnFinish(worker)
      await waitFor(
        () => rowsOf(worker, 'user_turn').some((one) => one.event.text === 'now build it'),
        'the held brief to flush',
      )
      const turn = rowsOf(worker, 'user_turn').find((one) => one.event.text === 'now build it')
      expect(turn?.event.piece).toBe(row?.event.piece)
      expect(row!.ordinal).toBeLessThan(turn!.ordinal)
    })

    it('⚑ THE CONTROL: a follow-up’s turn and a person’s turn name no piece', async () => {
      // ⚑ **D-016** — even a follow-up NAMING the piece opens none: the piece rides on the sender's
      // receipt only, and the receiver's turn carries nothing.
      const { pm, worker, pmTools, label } = await aPmAndItsIdleWorker()
      await call(pmTools, 'message_agent', {
        agent: worker,
        text: 'a question',
        kind: 'follow-up',
        piece: label,
      })
      await waitFor(
        () => rowsOf(worker, 'user_turn').some((one) => one.event.text === 'a question'),
        'the follow-up’s turn',
      )
      const asked = rowsOf(worker, 'user_turn').at(-1)?.event
      expect(asked?.text).toBe('a question')
      // ⚑ …and it IS relayed, so the absence below is the piece's and not the relay's.
      expect(asked?.relayedFrom).toBe(pm)
      expect(asked).not.toHaveProperty('piece')
      expect(asked).not.toHaveProperty('label')
      // ⚠️ **Typed into a conversation of its own**: the PM is busy now, told that its piece stalled
      // when the brief's turn ended, so a person's words to it would be held.
      const typedInto = await personOpens('reviewer')
      await host.send(typedInto, 'a person typing', window)
      const typed = rowsOf(typedInto, 'user_turn').at(-1)?.event
      expect(typed?.text).toBe('a person typing')
      expect(typed).not.toHaveProperty('piece')
    })

    it('⛔ replay keeps a piece id this app could have minted and drops one it could not — and the relay survives', async () => {
      const worker = await personOpens('worker')
      const plant = (ordinal: number, piece: unknown): void => {
        db.prepare(
          `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
           VALUES (?, ?, 0, ?, 'user_turn', ?, ?)`,
        ).run(
          `evt_${String(ordinal)}`,
          worker,
          ordinal,
          JSON.stringify({
            type: 'user_turn',
            text: 'relayed',
            attribution: 'app_authored',
            relayedFrom: 'sess_giver',
            piece,
          }),
          tick(),
        )
      }
      // ⛔ **Literals, at the edge** — `MAX_STORED_ID_CHARS` is 200 and a test that wrote it as
      // the constant plus one would move with it.
      plant(80_001, 't'.repeat(200))
      plant(80_002, 't'.repeat(201))
      plant(80_003, 42)
      const replayed = (ordinal: number): UserTurnEvent | undefined =>
        store.events(worker).find((entry) => entry.ordinal === ordinal)?.event as
          UserTurnEvent | undefined
      expect(replayed(80_001)?.piece).toBe('t'.repeat(200))
      for (const ordinal of [80_002, 80_003]) {
        expect(replayed(ordinal)).not.toHaveProperty('piece')
        expect(replayed(ordinal)?.relayedFrom).toBe('sess_giver')
      }
    })
  })

  /* ═════════════════════════════ §3 · G4a — a recording names its agent ═════════════════════════ */

  describe('§3 · G4a — `LibraryEntry.profileId`, on the entries this app RAN and no other', () => {
    it('🔴 ours names the identity it ran as; a pre-profile row names the default; user-home and restored name none', async () => {
      const ran = await personOpens('Dev')
      const preProfile = await personOpens('worker')
      const fromHome = await personOpens('pm')
      const restored = await personOpens('reviewer')
      for (const id of [ran, preProfile, fromHome, restored]) await host.close(id, window)
      // ⚑ **Each provenance planted on the row the library reads** — the three predicates
      // `session-store.ts` owns: `adopted_at` + no `profile_id` is the person's own home, a
      // `restored_at` is a bundle, and no `profile_id` without `adopted_at` is a pre-profile row.
      db.prepare(`UPDATE provider_session SET profile_id = NULL WHERE id = ?`).run(preProfile)
      db.prepare(`UPDATE provider_session SET profile_id = NULL, adopted_at = ? WHERE id = ?`).run(
        tick(),
        fromHome,
      )
      db.prepare(`UPDATE provider_session SET restored_at = ? WHERE id = ?`).run(tick(), restored)
      const page = await host.listLibrary()
      const entry = (id: string): LibraryEntry | undefined =>
        page.entries.find((one) => one.recordId === id)
      expect(entry(ran)).toMatchObject({ origin: 'ours', profileId: 'Dev' })
      expect(entry(preProfile)).toMatchObject({ origin: 'ours', profileId: DEFAULT_PROFILE_ID })
      expect(entry(fromHome)?.origin).toBe('user-home')
      expect(entry(fromHome)).not.toHaveProperty('profileId')
      expect(entry(restored)?.origin).toBe('restored')
      expect(entry(restored)).not.toHaveProperty('profileId')
    })
  })

  /* ══════════════════════════ §4 · G5a — `agentName` folds its own fallback ═════════════════════ */

  describe('§4 · G5a — one spelling, whoever asks', () => {
    it('🔴 a recording and a live pane hand `agentName` the same value, and an unnamed identity reads its folded slug', async () => {
      const ran = await personOpens('Dev')
      await host.close(ran, window)
      const entry = (await host.listLibrary()).entries.find((one) => one.recordId === ran)
      const live = host.resumableSessions().find((one) => one.sessionId === ran)
      expect(live, 'the live pane reads this conversation off the resumable list').toBeDefined()
      // ⚑ **One value on both surfaces** — the DIRECTORY spelling, which is what G4a promised.
      expect(entry?.profileId).toBe(live?.profileId)
      // 🔴 **Unnamed: the folded slug, not the spelling the conversation ran under.**
      expect(agentName(entry?.profileId ?? null, [])).toBe('dev')
      // ⚑ **THE CONTROLS**: a name a person chose is returned as typed, and the default identity
      // is still named by its label.
      const named: AgentIdentity = {
        ...host.agentIdentities().identities[0]!,
        slug: 'dev',
        displayName: 'Ada',
      }
      expect(agentName(entry?.profileId ?? null, [named])).toBe('Ada')
      expect(agentName(DEFAULT_PROFILE_ID, [])).toBe(DEFAULT_PROFILE_LABEL)
      expect(agentName(null, [])).toBe(DEFAULT_PROFILE_LABEL)
    })
  })

  /* ═══════════════════════ §5 · R18 — a malformed row: skipped, counted, SAID ═══════════════════ */

  describe('§5 · R18 — one torn row blanks no surface and vanishes from none', () => {
    /** Five readers, one number each — the brief's list, read through the host's own doors. */
    const fiveCounts = async (
      pm: string,
      worker: string,
      pmTools: AgentToolset,
    ): Promise<Record<string, number>> => {
      const listed = await call(pmTools, 'list_tasks', {})
      return {
        forest: host.theWholeForest().nodes.rowsUnread,
        line: host.whoCalledWhom(worker).workTakenIn.rowsUnread,
        drawer: host.whoCalledWhom(pm).workGivenOut.rowsUnread,
        listTasks: listed.structured.rows_unread as number,
        stalled: host.stalledWorkForAPerson().rowsUnread,
      }
    }

    it('⚑ THE CONTROL: on a clean database every one of the five carries 0, and list_tasks says nothing about it', async () => {
      // ⚑ **D-016** — the give in {@link aPmAndItsWorker} is the work: nothing more is sent.
      const { pm, worker, pmTools } = await aPmAndItsWorker()
      expect(await fiveCounts(pm, worker, pmTools)).toEqual({
        forest: 0,
        line: 0,
        drawer: 0,
        listTasks: 0,
        stalled: 0,
      })
      expect((await call(pmTools, 'list_tasks', {})).text).not.toContain('could not be read')
    })

    /**
     * ⚑ **D-016 · re-aimed: the torn row is in the HOLDER's ledger.** ⛔ It was planted in a ledger
     * none of them is about, because the scan behind them read every `task_assigned` row in the
     * database. ⚑ Now the four walks start from the `work` table's owners and fold only THEIR
     * ledgers (measured: a torn `work_given` elsewhere reaches the forest alone, which reads every
     * ledger), so the one ledger all five read is the holder's.
     */
    it('🔴 one torn given row in the holder’s ledger: all five ANSWER, and each carries 1', async () => {
      const { pm, worker, pmTools } = await aPmAndItsWorker()
      db.prepare(
        `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
         VALUES ('evt_torn', ?, 0, 90000, 'work_given', '{not json', ?)`,
      ).run(worker, tick())
      // ⛔ **Until `671` every one of these RAISED** (`664` F1, `543`'s pinned LOUD direction).
      expect(await fiveCounts(pm, worker, pmTools)).toEqual({
        forest: 1,
        line: 1,
        drawer: 1,
        listTasks: 1,
        stalled: 1,
      })
      // ⚑ **…and a person's surface is not blank**: the forest still draws the work.
      const forest = host.theWholeForest()
      expect(forest.nodes.rows.filter((node) => node.node === 'a-task')).toHaveLength(1)
      expect(host.whoCalledWhom(pm).workGivenOut.rows).toHaveLength(1)
      // 🔴 **list_tasks SAYS it, to the model, in its words** — not only in a log.
      const listed = await call(pmTools, 'list_tasks', {})
      expect(listed.text).toContain("1 row of this app's record could not be read")
      expect((listed.structured.you_gave as unknown[]).length).toBe(1)
    })

    it('🔴 one torn QUESTION row in the holder’s own ledger: only the WAIT READS meet it, and all five count it', async () => {
      const { pm, worker, pmTools, workerTools } = await aPmAndItsWorker()
      expect(await fiveCounts(pm, worker, pmTools)).toEqual({
        forest: 0,
        line: 0,
        drawer: 0,
        listTasks: 0,
        stalled: 0,
      })
      db.prepare(
        `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
         VALUES ('evt_torn_q', ?, 0, 90000, 'user_input_request', '{not json', ?)`,
      ).run(worker, tick())
      // ⛔ **No fold on any of these walks selects this type** — `selectTaskEvents` does not — so the
      // only reads that meet the row are the wait reads composing the worker's OPEN task. ⚑ A count
      // of 1 on each surface is therefore that surface's WAIT READ counting into its own walk: the
      // forest's, the line's, the drawer's (it composes the worker's task too), `list_tasks`' memo,
      // and the stalled-work queue's — which is what `671` M15, M17, M18 and M19 each break.
      expect(await fiveCounts(pm, worker, pmTools)).toEqual({
        forest: 1,
        line: 1,
        drawer: 1,
        listTasks: 1,
        stalled: 1,
      })
      // ⚑ …and the worker's own `list_tasks`, whose GIVEN half composes through the same read.
      const listed = await call(workerTools, 'list_tasks', {})
      expect(listed.structured.rows_unread).toBe(1)
      // ⚑ **D-016** — what it holds: the piece it was given, and no root (a helper owns none).
      expect((listed.structured.you_hold as unknown[]).length).toBe(1)
    })

    it('🔴 list_tasks answers when the HOLDER’s own card read meets a torn row (`671` review)', async () => {
      const { worker, pmTools, workerTools } = await aPmAndItsWorker()
      // ⛔ **`list_tasks` asks each holder's live CARD**, and the card reads the last ask to stop —
      // a statement that RAISED on a torn `user_decision` and handed a torn `work_interrupted` to an
      // unguarded `JSON.parse`. Both are planted; neither may fail the tool.
      const plant = (ordinal: number, type: string): void => {
        db.prepare(
          `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
           VALUES (?, ?, 0, ?, ?, '{not json', ?)`,
        ).run(`evt_card_${String(ordinal)}`, worker, ordinal, type, tick())
      }
      plant(90_001, 'user_decision')
      plant(90_002, 'work_interrupted')
      for (const tools of [pmTools, workerTools]) {
        const listed = await call(tools, 'list_tasks', {})
        expect(listed.structured.outcome).toBe('ok')
      }
      expect((await call(pmTools, 'list_tasks', {})).structured.you_gave).toHaveLength(1)
    })

    it('⛔ a torn NEWEST ask to stop does not hide the readable one before it', async () => {
      const worker = await personOpens('worker')
      const plant = (ordinal: number, payload: string): void => {
        db.prepare(
          `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
           VALUES (?, ?, 0, ?, 'work_interrupted', ?, ?)`,
        ).run(`evt_ask_${String(ordinal)}`, worker, ordinal, payload, tick())
      }
      plant(90_001, JSON.stringify({ type: 'work_interrupted', by: 'a-person' }))
      expect(store.lastAskToStop(worker)?.by).toBe('a-person')
      plant(90_002, '{not json')
      // ⚑ **The newest READABLE ask answers** — a torn row is not a candidate, so it can neither
      // raise nor stand in front of an ask the ledger can still read.
      expect(store.lastAskToStop(worker)?.by).toBe('a-person')
    })

    it('🔴 the stalled-work queue COUNTS a torn receipt in the giver’s ledger (`671` review)', async () => {
      const { pm, worker } = await aPmAndItsWorker()
      // An interrupted turn retains the existing giver receipt read by this band.
      host.claimSession(worker, window)
      await host.interrupt(worker, window)
      await waitFor(
        () => rowsOf(pm, 'work_stall_told').length > 0,
        'the giver to be told its work is not being driven',
      )
      const told = host.stalledWorkForAPerson()
      expect(told.rows).toHaveLength(0)
      expect(told.rowsUnread).toBe(0)
      // ⛔ **The receipt torn**: nothing else this walk reads selects `work_stall_told` (D-016's name
      // for `work_reported`), so before this fix the queue listed the work as never told AND claimed
      // to have read every row.
      db.prepare(
        `UPDATE events SET payload = '{not json' WHERE session_id = ? AND type = 'work_stall_told'`,
      ).run(pm)
      // Read by a host started on that record, as a launch reads it: a row rewritten in place is
      // not a ledger growing, so a running store keeps the fold it read before.
      store = createSessionStore(db, tick)
      const torn = buildHost().stalledWorkForAPerson()
      expect(torn.rows).toHaveLength(1)
      expect(torn.rowsUnread).toBe(1)
    })
  })
})
