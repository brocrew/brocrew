import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, type FakeSessionHandle, type StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { classifyHandedPath } from '../src/main/runtime/handed-path'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { sinkOwnerId } from '../src/main/runtime/window-caller'
import type { HandedPath, RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'

/**
 * # 🔴 D-027 · a command left behind by a flush that started no turn goes at once
 *
 * ⚑ **The repeat `670` gave the flush** (`657` F-d): a flush that ENDED what it took without starting
 * a turn — a vanished attachment, a sign-in that moved on — leaves the conversation idle with no
 * `idle` event coming, so whatever the take left behind must be flushed again at once, or it waits for
 * a turn boundary that is never coming.
 *
 * ⛔ **D-027 took the one test that reached it.** A flush now takes everything held up to a person's
 * command, so a message held behind a head that ended goes in the head's own take and the repeat is
 * never asked. What a take still LEAVES BEHIND is a person's command (it goes alone, so everything
 * before it goes together, then the command, then the rest), anything past the 64th, and a message
 * that arrived mid-flush. ⚑ **The command is the one a test can hold honestly**: it is queued through
 * the person's own door, and `theTurnItTakes` cuts the take in front of it.
 *
 * ## ⚑ What each section holds to
 *
 *  - §1 · the head's file is gone: the head is ended, no turn starts, and the command held behind it
 *    is sent at once on the idle conversation — beside the control, a head whose file is there, which
 *    starts a turn and so leaves the command waiting for that turn's end.
 *  - §2 · a take of SEVERAL whose every file is gone ends each of them and starts nothing, so the
 *    command goes at once — beside the control, a take of the same two with one file left, which
 *    starts the turn of the one that survived and leaves the command waiting.
 *  - §3 · the sign-in moved on: the message the take ended AND the command it left behind are both
 *    ended now, each with the sentence, not left for the teardown — beside the control, the same hold
 *    with the sign-in current, where the head is sent and nothing is ended for it.
 *
 * ⚠️ **What this cannot say**: what a hosted model does with what it is handed. It measures what the
 * provider was handed and what the ledger holds, never a model's obedience to the words.
 *
 * ⛔ A negative is read beside a positive from the same reader, and a presence is asserted before an
 * order or a text.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** ⚑ A window: the one surface a person's words come through. */
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

/** ⚑ What a test chooses about the provider double. */
interface TheShape {
  /** ⚑ When set, every handle reports its machine sign-in as moved on — `648`'s latch. */
  signInMovedOn: boolean
}

class TheProvider extends ProviderDouble {
  constructor(
    provider: Provider,
    handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
    gate: ResumeGate,
    private readonly shape: TheShape,
  ) {
    super(provider, handles, sessions, gate)
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(options)
    // ⚠️ **The two reads a Claude handle answers a sign-in with**: the check the turn gate awaits, and
    // the LATCHED flag the window's bar reads once the gate has refused. The double has neither, and
    // an adapter with nothing to say leaves both absent — so they are given here, and read off the
    // shape, which a test turns on only AFTER it has held what it holds. ⚑ A handle a resume makes
    // has neither: the reopen reads the current sign-in.
    Object.defineProperty(handle, 'checkSignIn', {
      value: async (): Promise<boolean> => this.shape.signInMovedOn,
      configurable: true,
    })
    Object.defineProperty(handle, 'signInSuperseded', {
      get: (): boolean => this.shape.signInMovedOn,
      configurable: true,
    })
    return handle
  }
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** ⚑ A real macrotask pause, so a negative is measured after whatever was queued has run. */
const letItSettle = async (ticks = 20): Promise<void> => {
  for (let i = 0; i < ticks; i += 1) await new Promise((resolve) => setTimeout(resolve, 5))
}

class TheApp {
  readonly userData = mkdtempSync(join(tmpdir(), 'brobot2-leftbehind-'))
  readonly root = mkdtempSync(join(tmpdir(), 'brobot2-leftbehind-root-'))
  readonly db: AppDatabase
  readonly store: SessionStore
  readonly handles: FakeSessionHandle[] = []
  readonly shape: TheShape = { signInMovedOn: false }
  readonly window = new RecordingSink(sinkOwnerId({ id: 1 }))
  readonly host: RuntimeHost
  private readonly issued = new FakeProviderSessions()
  private counter = 0

  constructor() {
    this.db = openDatabase(join(this.userData, 'brobot2.sqlite'))
    applyMigrations(this.db, migrationsFolder)
    this.store = createSessionStore(this.db)
    this.host = new RuntimeHost({
      store: this.store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(this.userData, 'exports'),
      resourcesRoot: () => resourcesRoot(this.userData),
      createRuntime: (provider: Provider) =>
        new TheProvider(provider, this.handles, this.issued, anOpenGate(), this.shape),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(this.userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(this.userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(this.userData, sessionId, requested),
      newSessionId: () => `sess_${String(++this.counter)}`,
      commandListWaitMs: 200,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
  }

  async dispose(): Promise<void> {
    await this.host.closeAll()
    this.db.close()
    for (const dir of [this.userData, this.root]) rmSync(dir, { recursive: true, force: true })
  }

  // ── what the ledger holds ───────────────────────────────────────────────────────────────────

  ledger(sessionId: string): TranscriptEvent[] {
    return this.store.events(sessionId).map((entry) => entry.event)
  }
  rows<T extends TranscriptEvent['type']>(
    sessionId: string,
    type: T,
  ): Extract<TranscriptEvent, { type: T }>[] {
    return this.ledger(sessionId).filter(
      (event): event is Extract<TranscriptEvent, { type: T }> => event.type === type,
    )
  }
  /** ⚑ The words of every turn the ledger opened, in order. */
  turns(sessionId: string): string[] {
    return this.rows(sessionId, 'user_turn').map((turn) => turn.text)
  }
  /** ⚑ What a conversation's provider was handed, as the double echoes it. */
  echoes(sessionId: string): string[] {
    return this.rows(sessionId, 'assistant_message')
      .map((event) => event.text)
      .filter((text) => text.startsWith('echo: '))
  }
  cards(sessionId: string): string[] {
    return this.rows(sessionId, 'permission_request').map((event) => event.id)
  }
  /** ⚑ `message_unqueued` as `[words, reason]`, in the order they were written. */
  endings(sessionId: string): [string, string][] {
    return this.rows(sessionId, 'message_unqueued').map((event) => [event.text, event.reason])
  }

  // ── what a person does ──────────────────────────────────────────────────────────────────────

  /** ⚑ A conversation whose first turn is parked on its card: something running to wait behind. */
  async busySession(first = 'the first thing'): Promise<string> {
    const { sessionId } = await this.host.createSession(
      { provider: 'claude', approvalMode: 'ask', cwd: this.root },
      this.window,
    )
    await this.host.send(sessionId, first, this.window)
    await waitFor(() => this.cards(sessionId).length === 1, 'the first turn to park on its card')
    return sessionId
  }

  /** ⚑ Hold a message the person typed, with files if it has any; it throws when it went straight out. */
  async hold(sessionId: string, text: string, files: HandedPath[] = []): Promise<void> {
    const outcome = await this.host.queueMessage(sessionId, text, this.window, files)
    if (outcome.outcome !== 'queued') {
      throw new Error(`expected "${text}" to be held; it was ${outcome.outcome}`)
    }
  }

  /** ⚑ A file in this app's folder, as the composer would stage it. */
  async anAttachment(name: string): Promise<HandedPath> {
    const path = join(this.root, name)
    writeFileSync(path, 'notes\n')
    const chosen = await classifyHandedPath(path, this.root)
    if (!('handed' in chosen)) throw new Error(chosen.refusal)
    return chosen.handed
  }

  /** ⚑ The person answers the newest card: the turn parked on it ends. */
  async answerTheNewestCard(sessionId: string): Promise<void> {
    const card = this.cards(sessionId).at(-1)
    if (card === undefined) throw new Error(`${sessionId} is not parked on a card`)
    await this.host.respondPermission(sessionId, card, { outcome: 'allow' }, this.window)
  }
}

describe('D-027 · what a take leaves behind is flushed again when the take started no turn', () => {
  let app: TheApp

  beforeEach(() => {
    app = new TheApp()
  })

  afterEach(async () => {
    await app.dispose()
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · a head whose file is gone
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · a head whose file is gone', () => {
    it('🔴 the head is ended and starts no turn, and the person’s command held behind it is SENT at once on the idle conversation', async () => {
      const id = await app.busySession()
      const file = await app.anAttachment('gone.md')
      await app.hold(id, 'the head', [file])
      await app.hold(id, '/compact')

      // ⚑ Premise: both are held, nothing has ended, and the only turn is the running one.
      expect(app.turns(id)).toEqual(['the first thing'])
      expect(app.endings(id)).toEqual([])

      unlinkSync(file.path)
      await app.answerTheNewestCard(id)
      // ⚑ ONE card answered, and the command goes: no second turn ended, no second `idle` came. The
      // head ended without a turn, so the repeat is the only thing that could have sent it.
      await waitFor(() => app.turns(id).includes('/compact'), 'the command to be sent')
      await waitFor(() => app.echoes(id).length === 2, 'the provider to be handed it')

      // ⚑ The command went alone and bare, as typed, and the head's words never reached the provider.
      expect(app.turns(id)).toEqual(['the first thing', '/compact'])
      // ⚠️ The first turn carries the lead a conversation's first words always do, so it is read by
      // what it contains; the command's is exact.
      const [first, command] = app.echoes(id)
      expect(first).toContain('the first thing')
      expect(command).toBe('echo: /compact')
      expect(app.echoes(id).join('\n')).not.toContain('the head')
      // ⚑ The head ended first, with its words and its files on the row to be offered back, and the
      // command's `sent` came after it.
      expect(app.endings(id)).toEqual([
        ['the head', 'abandoned'],
        ['/compact', 'sent'],
      ])
      const abandoned = app
        .rows(id, 'message_unqueued')
        .find((event) => event.reason === 'abandoned')
      expect(abandoned?.attachments).toEqual([file])
    })

    it('⚑ control: the head’s file is there, so the head starts a turn — and the command waits for THAT turn’s end', async () => {
      const id = await app.busySession()
      const file = await app.anAttachment('here.md')
      await app.hold(id, 'the head', [file])
      await app.hold(id, '/compact')

      await app.answerTheNewestCard(id)
      await waitFor(() => app.turns(id).includes('the head'), 'the head to be sent')
      await waitFor(() => app.cards(id).length === 2, 'the head’s turn to park on its card')
      await letItSettle()

      // ⚑ The head is in a turn of its own, and the command — behind it — is still held: nothing ended
      // it and nothing sent it, for no `idle` has come since.
      expect(app.turns(id)).toEqual(['the first thing', 'the head'])
      expect(app.endings(id)).toEqual([['the head', 'sent']])

      // ⚑ …and the end of the head's turn is the boundary that sends it.
      await app.answerTheNewestCard(id)
      await waitFor(() => app.turns(id).includes('/compact'), 'the command to go at the boundary')
      expect(app.turns(id)).toEqual(['the first thing', 'the head', '/compact'])
      expect(app.endings(id)).toEqual([
        ['the head', 'sent'],
        ['/compact', 'sent'],
      ])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · a take of several whose files are gone
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · a take of several whose files are gone', () => {
    it('🔴 every message of the take is ended and no turn starts, so the command goes at once — and with one file left the take starts a turn and the command waits', async () => {
      // ⚑ One conversation holds two messages whose files are BOTH gone, and a command behind them.
      const allGone = await app.busySession()
      const one = await app.anAttachment('one.md')
      const two = await app.anAttachment('two.md')
      await app.hold(allGone, 'first of two', [one])
      await app.hold(allGone, 'second of two', [two])
      await app.hold(allGone, '/compact')
      // ⚑ The control holds the same three, and one of the two files stays.
      const oneLeft = await app.busySession()
      const three = await app.anAttachment('three.md')
      const four = await app.anAttachment('four.md')
      await app.hold(oneLeft, 'first of two', [three])
      await app.hold(oneLeft, 'second of two', [four])
      await app.hold(oneLeft, '/compact')

      // ⚑ Premise: nothing of either has gone or ended.
      for (const id of [allGone, oneLeft]) {
        expect(app.turns(id)).toEqual(['the first thing'])
        expect(app.endings(id)).toEqual([])
      }

      unlinkSync(one.path)
      unlinkSync(two.path)
      unlinkSync(three.path)
      await app.answerTheNewestCard(allGone)
      await app.answerTheNewestCard(oneLeft)

      // ⛔ Both of the take were ended by the one flush, nothing was sent for them, and the command
      // went from the repeat.
      await waitFor(() => app.turns(allGone).includes('/compact'), 'the command to be sent')
      expect(app.turns(allGone)).toEqual(['the first thing', '/compact'])
      // ⚠️ The one flush ends both of the take; which ending is written first is not promised (a
      // full suite under load wrote them the other way round), so they are read as a pair.
      const ended = app.endings(allGone)
      expect(ended).toHaveLength(3)
      expect(
        ended
          .slice(0, 2)
          .map((one) => one.join(' · '))
          .sort(),
      ).toEqual(['first of two · abandoned', 'second of two · abandoned'])
      expect(ended[2]).toEqual(['/compact', 'sent'])

      // ⚑ The control: the one whose file is there starts a turn — of one, for the other ended — and
      // the command behind it waits for that turn's end.
      await waitFor(() => app.turns(oneLeft).includes('second of two'), 'the survivor to be sent')
      await letItSettle()
      expect(app.turns(oneLeft)).toEqual(['the first thing', 'second of two'])
      expect(app.endings(oneLeft)).toEqual([
        ['first of two', 'abandoned'],
        ['second of two', 'sent'],
      ])
      await app.answerTheNewestCard(oneLeft)
      await waitFor(() => app.turns(oneLeft).includes('/compact'), 'the command at the boundary')
      expect(app.endings(oneLeft)).toEqual([
        ['first of two', 'abandoned'],
        ['second of two', 'sent'],
        ['/compact', 'sent'],
      ])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the sign-in moved on
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · the sign-in moved on', () => {
    it('🔴 neither the head nor the command behind it is ended — a person’s own, they are the press its reopen asks for, and go there: the head, then the command alone at that turn’s end', async () => {
      const id = await app.busySession()
      await app.hold(id, 'the head')
      await app.hold(id, '/compact')
      expect(app.endings(id)).toEqual([])

      // ⚠️ The sign-in moves AFTER both were held: the flush meets it, and leaves both held. ⚑ They
      // are a person's own words, so this app reopens the conversation on the current sign-in for
      // them, and sends what waited first.
      app.shape.signInMovedOn = true
      await app.answerTheNewestCard(id)
      await waitFor(() => app.turns(id).includes('the head'), 'the head to go after the reopen')
      expect(app.rows(id, 'reopened')).toEqual([
        { type: 'reopened', because: 'the-sign-in-moved-on' },
      ])
      expect(app.endings(id)).toEqual([['the head', 'sent']])

      // ⚑ …and the command, which goes alone, at the end of the head's turn — as with the sign-in current.
      await waitFor(() => app.cards(id).length === 2, 'the head’s turn to park on its card')
      await app.answerTheNewestCard(id)
      await waitFor(() => app.turns(id).includes('/compact'), 'the command at the boundary')
      expect(app.endings(id)).toEqual([
        ['the head', 'sent'],
        ['/compact', 'sent'],
      ])
      expect(app.rows(id, 'message_unqueued').map((event) => event.detail)).toEqual([
        undefined,
        undefined,
      ])
    })

    it('⚑ control: the same hold with the sign-in current — the head is SENT, the command waits for that turn’s end, and nothing is ended with the sentence', async () => {
      const id = await app.busySession()
      await app.hold(id, 'the head')
      await app.hold(id, '/compact')
      expect(app.shape.signInMovedOn).toBe(false)

      await app.answerTheNewestCard(id)
      await waitFor(() => app.turns(id).includes('the head'), 'the head to be sent')
      await waitFor(() => app.cards(id).length === 2, 'the head’s turn to park on its card')
      await letItSettle()
      expect(app.turns(id)).toEqual(['the first thing', 'the head'])
      expect(app.endings(id)).toEqual([['the head', 'sent']])

      await app.answerTheNewestCard(id)
      await waitFor(() => app.turns(id).includes('/compact'), 'the command at the boundary')
      expect(app.endings(id)).toEqual([
        ['the head', 'sent'],
        ['/compact', 'sent'],
      ])
      // ⚑ The reader that carries the sentence on the other side finds none of it here.
      expect(app.rows(id, 'message_unqueued').map((event) => event.detail)).toEqual([
        undefined,
        undefined,
      ])
    })
  })
})
