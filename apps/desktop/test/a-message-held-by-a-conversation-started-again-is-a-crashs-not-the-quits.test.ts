import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * # 692 · R34c — a conversation the quit closed, started again, and then caught by a crash
 *
 * ## The rule, and the one place it is observable
 *
 * The quit writes a stamp on every conversation it closed (`closed_by_the_quit_at`), and the next
 * launch reads it to tell a quit's stop from a crash's: a message a stamped conversation was
 * holding is KEPT for its next start, and a message a crash stranded is SETTLED (`abandoned`, *"the
 * app stopped while this message was still waiting to be sent"*). ⚑ **Every reopen clears the
 * stamp** — a conversation started again is no longer one the quit is holding open — and that is
 * what makes a crash after the start a crash's: no quit ran to write another stamp.
 *
 * ⛔ **Without the clearing** the stamp outlives the start it described. A conversation that was
 * quit, pressed, given a NEW message that had to wait, and then killed comes back still stamped, so
 * the launch reads its held message as a quit's and leaves it waiting for ever — for a start that
 * will now send it, long after the words were written for a life that is over.
 *
 * ## Shape: a real `RuntimeHost` over a real SQLite ledger, the fake provider, three arms
 *
 *  - ⚑ **the kill** — quit, relaunch, a person presses the row (the reopen), the second life holds a
 *    message (its turn is stopped on a permission card), the app is killed, the next launch settles it;
 *  - ⚑ **control one** — the same quit and the same held message, and NO reopen before the kill: the
 *    stamp is the last thing that is true of the conversation, so the message is kept;
 *  - ⚑ **control two** — no quit at all: a crash alone settles the message, so the settling the
 *    kill arm expects is the launch's own and not a property of the fixture.
 *
 * ⚠️ **A crash here is what `a-restart-keeps-what-was-open.test.ts` makes it**: a new store over the
 * same database and a new host, with no `closeAll` in between.
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

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

const THE_CRASHS_WORDS = 'the app stopped while this message was still waiting to be sent'

describe('692 · R34c · a conversation started again after a quit is a crash’s, not the quit’s', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let sessions: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: () => new FakeRuntime('claude', { sessions }),
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-692-crash-'))
    root = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-692-crash-root-')))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    sessions = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  /** ⚑ The graceful quit a person’s ⌘Q is, then the next launch — its own store object. */
  const quitAndRelaunch = async (): Promise<void> => {
    await host.closeAll()
    store = createSessionStore(db, tick)
    host = buildHost()
  }

  /** ⛔ A crash or a kill: the next launch happens and the quit never ran. */
  const crashAndRelaunch = (): void => {
    store = createSessionStore(db, tick)
    host = buildHost()
  }

  const parkedOnACard = (sessionId: string): number =>
    ledger(sessionId).filter((event) => event.type === 'permission_request').length

  /** ⚑ Every `message_unqueued` whose words are `text`, as the reason and detail it recorded. */
  const endingsOf = (sessionId: string, text: string): { reason?: string; detail?: string }[] =>
    ledger(sessionId).flatMap((event) =>
      event.type === 'message_unqueued' && event.text === text
        ? [{ reason: event.reason, detail: event.detail }]
        : [],
    )

  /** ⚑ Does the ledger still hold `text` as a message nothing has ended? */
  const stillWaiting = (sessionId: string, text: string): boolean =>
    ledger(sessionId).some((event) => event.type === 'message_queued' && event.text === text) &&
    endingsOf(sessionId, text).length === 0

  /**
   * ⚑ **A conversation holding one message** — its first turn is stopped on a permission card and a
   * second message is queued behind it. `ask` is what stops the double's turn on a card.
   */
  const holdingOne = async (profileId: string, held: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    await host.send(sessionId, 'first', window)
    await waitFor(() => parkedOnACard(sessionId) > 0, 'the first turn to stop on a card')
    expect((await host.queueMessage(sessionId, held, window)).outcome).toBe('queued')
    expect(stillWaiting(sessionId, held), 'the premise: the message is waiting').toBe(true)
    return sessionId
  }

  it('🔴 quit, pressed, holding a new message, then a CRASH — the launch settles it as a crash’s, not as a quit’s', async () => {
    const sessionId = await holdingOne('holder', 'second, held')
    await quitAndRelaunch()
    // ⚑ **The reopen** — a person presses the row. The quit's held message is the start's to send.
    const cardsBefore = parkedOnACard(sessionId)
    await host.resumeSession(sessionId, window)
    await waitFor(
      () =>
        ledger(sessionId).some(
          (e) => e.type === 'assistant_message' && e.text.includes('second, held'),
        ),
      'the quit’s held words to be sent by the reopen',
    )
    // ⚑ **The second life holds a message of its own**: its turn stops on a card, a message queues.
    await waitFor(
      () => parkedOnACard(sessionId) > cardsBefore,
      'the second life’s turn to stop on a card of its own',
    )
    expect((await host.queueMessage(sessionId, 'third, held', window)).outcome).toBe('queued')
    expect(stillWaiting(sessionId, 'third, held'), 'the premise: the second life holds it').toBe(
      true,
    )

    crashAndRelaunch()

    // ⚑ **Settled by the launch, in a crash's words** — nothing wrote a stamp for this life.
    expect(endingsOf(sessionId, 'third, held')).toEqual([
      expect.objectContaining({ reason: 'abandoned', detail: THE_CRASHS_WORDS }),
    ])
    expect(stillWaiting(sessionId, 'third, held')).toBe(false)
  })

  it('⚑ control · the same quit and NO reopen before the kill — a quit’s held message is kept for its next start', async () => {
    const sessionId = await holdingOne('holder-two', 'second, held')
    await quitAndRelaunch()
    // ⚑ Nothing pressed the row. The stamp is the last true thing about it, so a kill leaves it.
    crashAndRelaunch()
    expect(
      endingsOf(sessionId, 'second, held'),
      'a crash ended a message the quit was keeping',
    ).toEqual([])
    expect(stillWaiting(sessionId, 'second, held')).toBe(true)
  })

  it('⚑ control · no quit at all — a crash alone settles a held message, so the settling above is the launch’s own', async () => {
    const sessionId = await holdingOne('holder-three', 'second, held')
    crashAndRelaunch()
    expect(endingsOf(sessionId, 'second, held')).toEqual([
      expect.objectContaining({ reason: 'abandoned', detail: THE_CRASHS_WORDS }),
    ])
  })
})
