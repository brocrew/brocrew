import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
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
import { sinkOwnerId } from '../src/main/runtime/window-caller'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/**
 * # 🔴 670 M2 · a second send racing the conversation's OWN start is HELD, not rejected
 *
 * ⛔ **`RuntimeHost.send` on a conversation that is not running yet** (closed, or never opened)
 * does not call {@link RuntimeHost['sendAs']} straight away — it goes through
 * `deliverWhenItRuns`, which serialises every delivery for one session id behind an `arrivals`
 * chain, starting the conversation first. ⚑ **Two `send()` calls fired at a conversation before it
 * is running both enter that same chain.** The first one starts it and hands its words to the
 * provider; the second is delivered right after, against a session that is now running — but the
 * FIRST turn is still open, so the second's own handover meets it and loses, exactly the race
 * `657`/`670` made every other door (`queueMessage`, the plan go-ahead, interrupt-and-send) HOLD
 * rather than reject.
 *
 * ⚑ **`RuntimeHost.send`'s own deferred branch is where that hold is written**: the closure it
 * hands to `deliverWhenItRuns` calls `sendAs(..., { facts, ifItLosesTheRace: 'hold-it' })`, the one
 * line every person's send goes through once the conversation itself needs to start. This pins
 * that the hold is actually reached there, not merely written.
 */

const RESUMED_HOME = 'the-second-send-races-the-first-start'

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

describe("670 M2 · a second send is held behind the conversation's own start", () => {
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let window: RecordingSink
  let sessions: FakeProviderSessions

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-670-m2-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db, Date.now)
    sessions = new FakeProviderSessions()
    let counter = 0
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new FakeRuntime(provider, { sessions }),
      prepareProviderHome: (provider: Provider) => {
        const home = join(userData, 'provider-homes', RESUMED_HOME, provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) =>
        join(userData, 'provider-homes', RESUMED_HOME, provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${String(++counter)}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    window = new RecordingSink(sinkOwnerId({ id: 1 }))
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  const eventsOf = (): TranscriptEvent[] => window.messages.map((message) => message.event)
  const cardIds = (): string[] =>
    eventsOf()
      .filter((event) => event.type === 'permission_request')
      .map((event) => (event.type === 'permission_request' ? event.id : ''))
  const answerCard = async (sessionId: string, id: string): Promise<void> => {
    await host.respondPermission(sessionId, id, { outcome: 'allow' }, window)
  }

  it('🔴 the second send loses the race to the first start, is HELD (not rejected), and flushes once the first turn ends', async () => {
    const { sessionId } = await host.createSession(
      { provider: 'codex', approvalMode: 'ask' },
      window,
    )
    await host.close(sessionId, window)
    expect(cardIds()).toHaveLength(0)

    // ⛔ **Neither is awaited before the other fires** — both must enter `send`'s deferred branch
    // while the conversation is still closed, exactly as two doors racing a conversation's own
    // start would.
    const first = host.send(sessionId, 'the first words', window)
    const second = host.send(sessionId, 'the second words', window)

    // 🔴 **The first reaches the provider and opens a turn** — its card is up.
    await expect(first).resolves.toBeUndefined()
    expect(cardIds()).toHaveLength(1)
    expect(
      eventsOf().some((event) => event.type === 'user_turn' && event.text === 'the first words'),
    ).toBe(true)

    // 🔴 **The second LOST that race — the first turn was still open when its own handover
    // reached the provider — and this must resolve as `held`, never reject with the adapter's
    // sentence.** A person composing while their own first message is still starting the
    // conversation must see a queued message, not an error.
    await expect(second).resolves.toBeUndefined()
    expect(
      eventsOf().filter(
        (event) => event.type === 'message_queued' && event.text === 'the second words',
      ),
    ).toHaveLength(1)
    expect(
      eventsOf().some((event) => event.type === 'user_turn' && event.text === 'the second words'),
    ).toBe(false)

    // Release the first turn; the held second one flushes as its own turn, unqueued as `sent`.
    await answerCard(sessionId, cardIds()[0]!)
    await waitFor(() => cardIds().length === 2, 'the held message to flush as its own turn')
    await answerCard(sessionId, cardIds()[1]!)
    await waitFor(
      () =>
        eventsOf().some((event) => event.type === 'user_turn' && event.text === 'the second words'),
      'the held message to be recorded as a turn',
    )
    expect(
      eventsOf().filter((event) => event.type === 'message_unqueued' && event.reason === 'sent'),
    ).toHaveLength(1)
  })

  it('⚑ control: alone, a send that must start the conversation is sent directly, with no hold at all', async () => {
    const { sessionId } = await host.createSession(
      { provider: 'codex', approvalMode: 'ask' },
      window,
    )
    await host.close(sessionId, window)

    // ⛔ **Nothing races it** — the same "conversation must start" shape as above, but only one
    // sender, so there is no lost race and nothing should ever be held.
    await expect(host.send(sessionId, 'nothing in the way', window)).resolves.toBeUndefined()

    expect(cardIds()).toHaveLength(1)
    expect(
      eventsOf().some((event) => event.type === 'user_turn' && event.text === 'nothing in the way'),
    ).toBe(true)
    expect(eventsOf().filter((event) => event.type === 'message_queued')).toHaveLength(0)
  })
})
