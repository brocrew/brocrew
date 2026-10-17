import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import type { FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, THE_APP_ITSELF } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'

/**
 * # 🔴 724 · small true words, for the model and the lists
 *
 *  - **§1 · R84** (`719` F-5, amending R70) — *"An answered task's row carries the answer's summary
 *    only when that answer was NOT delivered (`reply_undelivered` in the child's ledger). Every other
 *    answered row stays as it was before R70."* ⛔ On `main` every row carried a `summary` key, and
 *    every answered one its words — up to 1,280 units a row (`719` F-5): an answer that was delivered
 *    (§1.1) and a row nothing answered (§1.2) carry no `summary` key now — ⚑ nor, since D-030, an
 *    answer whose delivery threw, which is held for its parent (§1.3, and `719` §2.1). ⚑ The control,
 *    a row whose answer reached nobody carrying its words whole, is pinned where an answer is still
 *    lost: `the-words-that-were-lost-and-who-asked.test.ts` §1 (R89).
 *  - **§2 · R82** (`720` F-D) — *"`stalled_by` … is renamed `asked_to_stop_by` everywhere the model
 *    reads it"*: both doors, and no row spells the old key (§2.1).
 *  - **`720` F-C** — who asked a turn to stop is NAMED, never printed as `sess_…`. The push and
 *    `list_tasks`' line are measured on the product path, in `state-a-supervisor-can-trust.test.ts` —
 *    ⚠️ since `729` (R90) by its ANCESTOR tests, where the asker is not the reader: `720`'s R72 test
 *    and its `turn_interrupted` twin pin the reader's OWN ask, said as its own act. No correction
 *    carries a stall any more (D-016c), so nothing else composes that clause.
 *
 * ⚑ **One provider shape**: nothing here resumes a conversation, so the Claude shape's
 * silent-until-its-first-turn resume would run the same run twice (`719`'s header states the same).
 */
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

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

describe('724 · small true words, for the model and the lists', () => {
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
  let gate: ResumeGate
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued, gate),
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-724-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-724-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_240_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
    issued = new FakeProviderSessions()
    gate = anOpenGate()
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const events = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  /** ⚑ A real macrotask pause, so a negative is measured after whatever was queued has run. */
  const letItSettle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50))

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    return sessionId
  }

  const callOn = async (
    caller: string,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const tool = agentToolsFor(host, caller).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const cardsOn = (id: string): number =>
    events(id).filter((event) => event.type === 'permission_request').length

  /** ⚑ What is HELD for a conversation, in the order it was queued. */
  const held = (id: string): string[] =>
    events(id).flatMap((event) => (event.type === 'message_queued' ? [event.text] : []))

  /** ⚑ The rows `list_tasks` hands the conversation that gave the work out. */
  const youGaveOut = async (pm: string): Promise<Record<string, unknown>[]> =>
    ((await callOn(pm, 'list_tasks', { state: 'all' })) as { you_gave: Record<string, unknown>[] })
      .you_gave

  /**
   * ⚑ **In ONE app run, a worker parked mid-turn on the work its parent gave it**, with a person's
   * window on it — `711`'s and `719`'s rig. ⚑ **D-016** — the give starts the worker's conversation,
   * and its brief is that conversation's first turn, which parks on its card (the giver's `ask`).
   */
  const aPmAndItsParkedWorker = async (): Promise<{
    pm: string
    worker: string
    piece: string
  }> => {
    await host.close(await personOpens('worker'), window)
    const pm = await personOpens('pm')
    const given = await callOn(pm, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'the work',
      brief: 'migrate',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    host.claimSession(worker, window)
    await waitFor(() => cardsOn(worker) > 0, 'the worker to park mid-turn')
    const piece = store.piecesOwnedBy(worker)[0]?.piece
    if (piece === undefined) throw new Error('no piece')
    expect(piece).toBe(given.piece)
    return { pm, worker, piece }
  }

  const theWords = 'the migration is finished; the indexes are rebuilt'

  // ─────────────────────────────────────────────────────────────────────────────
  // §1 · R84 — the words ride where they were lost
  // ─────────────────────────────────────────────────────────────────────────────

  describe('§1 · R84 — the words ride only where they were lost', () => {
    /**
     * 🔴 **The subject — RED on `main`.** ⚑ The parent is idle, so the answer is SENT to it — its
     * words are in the parent's own conversation. ⛔ On `main` the row carried them again, on every
     * `list_tasks` call for as long as the row lives.
     */
    it('§1.1 an answer that was delivered: the row carries no summary', async () => {
      const { pm, worker, piece } = await aPmAndItsParkedWorker()
      expect(
        await callOn(worker, 'reply_to_parent', {
          piece,
          outcome: 'done',
          summary: theWords,
        }),
      ).toMatchObject({ outcome: 'ok', delivered: 'sent' })
      await letItSettle()
      // ⚑ The premise: the words reached the parent, and nothing says they did not.
      expect(
        events(pm).some((event) => event.type === 'user_turn' && event.text.includes(theWords)),
      ).toBe(true)
      expect(events(worker).some((event) => event.type === 'reply_undelivered')).toBe(false)

      const [row] = await youGaveOut(pm)
      expect(row).toMatchObject({ piece, state: 'answered', outcome: 'done' })
      expect(row).not.toHaveProperty('summary')
      // ⚑ A piece that is over is a line on the board: none of its answer's words ride there.
      expect(JSON.stringify(row)).not.toContain(theWords)
      // ⚑ **D-016 · a reply's summary IS the piece's status line** (the newest line stands), so on
      // its record the words ride there, and never a second time under `summary`.
      const record = (await callOn(pm, 'list_tasks', { piece })) as Record<string, unknown>
      expect(record['status_line']).toMatchObject({ text: theWords })
      expect(record).not.toHaveProperty('summary')
    })

    /**
     * 🔴 **The subject — RED on `main`**, as the row was before R70: nothing answered it, and the
     * key is not there at all (`main` spelled `summary: null` on every open row).
     */
    it('§1.2 a row nothing answered carries no summary key', async () => {
      const { pm, piece } = await aPmAndItsParkedWorker()

      const [row] = await youGaveOut(pm)
      expect(row).toMatchObject({ piece })
      expect(row?.state).not.toBe('answered')
      expect(row).not.toHaveProperty('summary')
    })

    /**
     * ⚑ **D-030 · this file's control, turned round.** An answer whose delivery failed (a parent
     * holding a person's message refused it until D-010; `not-delivered` until D-030) is now held for
     * that parent, in its mailbox — so it reaches the parent, nothing records it lost, and the row
     * carries no words (R84). ⚑ A row whose answer reached nobody still carries them, whole — R70,
     * where R84 keeps it — and that is pinned where an answer is still lost
     * (`the-words-that-were-lost-and-who-asked.test.ts` §1, R89).
     */
    it('§1.3 an answer whose delivery threw is held for the parent: the row carries no summary', async () => {
      const { pm, worker, piece } = await aPmAndItsParkedWorker()
      await host.send(pm, 'keep an eye on the migration', window)
      await waitFor(() => cardsOn(pm) > 0, 'the parent to park mid-turn')
      expect((await host.queueMessage(pm, 'and the backups', window)).outcome).toBe('queued')
      // ⚑ **D-010** — a busy parent HOLDS an answer now, so the one that failed is an answer whose
      // delivery THREW on the way in: its own delivery fails, once — ⚑ and since D-030 it is held.
      const deliver = host.queueMessage.bind(host)
      host.queueMessage = (async (...args: Parameters<RuntimeHost['queueMessage']>) => {
        if (args[2] === THE_APP_ITSELF && args[1].includes(theWords)) {
          host.queueMessage = deliver
          throw new Error('the way in failed')
        }
        return deliver(...args)
      }) as RuntimeHost['queueMessage']
      expect(
        await callOn(worker, 'reply_to_parent', {
          piece,
          outcome: 'done',
          summary: theWords,
        }),
      ).toMatchObject({ outcome: 'ok', delivered: 'held' })
      await letItSettle()
      // ⚑ The premise: the parent holds the words, once, and nothing says they reached nobody.
      expect(held(pm).filter((text) => text.includes(theWords))).toHaveLength(1)
      expect(events(worker).some((event) => event.type === 'reply_undelivered')).toBe(false)

      const [row] = await youGaveOut(pm)
      expect(row).toMatchObject({ piece, state: 'answered', outcome: 'done' })
      expect(row).not.toHaveProperty('summary')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // §2 · R82 — a wire key says what it holds
  // ─────────────────────────────────────────────────────────────────────────────

  describe('§2 · R82 — `asked_to_stop_by`, never `stalled_by`', () => {
    /**
     * 🔴 **The subject — RED on `main`**: the row spelled `stalled_by`, which beside
     * `stalled_because: 'turn_ended'` read as who stalled it (`720` F-D). ⚑ `null` here — nobody
     * asked — so the key's PRESENCE is what is measured; who it names is `720`'s R72 tests, re-aimed.
     */
    it('§2.1 list_tasks spells who asked `asked_to_stop_by`, and never `stalled_by`', async () => {
      const { pm, piece } = await aPmAndItsParkedWorker()

      const [row] = await youGaveOut(pm)
      expect(row).toMatchObject({ piece, asked_to_stop_by: null })
      expect(row).not.toHaveProperty('stalled_by')
    })
  })
})
