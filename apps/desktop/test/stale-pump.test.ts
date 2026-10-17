import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FakeRuntime,
  type AgentRuntime,
  type RuntimeEvent,
  type SessionHandle,
} from '@brobot2/runtime'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * # 🔴 293 §3 · a timed-out event pump can write into the next life of the same session
 *
 * (289 rank 2 — Reviewer-26, round 5 lens E.)
 *
 * `tearDown` stops waiting for `session.pump` after `closeDrainTimeoutMs` and finalizes anyway —
 * deliberately, since 051, because a provider that will not drain must not hang the quit. Finalizing
 * deletes the slot. ⛔ **But `pumpEvents` is still inside its un-fenced `for await`, and `deliver`
 * checked neither the life nor the finalization.**
 *
 * > *An old handle's iterator is held past the drain timeout with one buffered event. Finalization
 * > removes the old slot, the user reopens the recorded id, and the new handle begins at ordinal N —
 * > `resumeSession` snapshots `store.nextOrdinal`. The old iterator then yields at ordinal N too.*
 *
 * ⛔ **Both outcomes are wrong, in different directions.** If the stale append wins, the new life's
 * first event violates `unique(session_id, generation, ordinal)`, `record` marks the session as no
 * longer being recorded, and every later durable event of a conversation the user is actively having
 * is dropped. If the new append wins, **closed-provider content is delivered into a reopened
 * conversation**.
 *
 * ## ⚠️ Why the iterator is a hand-written one and not the Fake's
 *
 * The finding is about an iterator that outlives the drain, which is a thing no adapter does on
 * purpose and therefore nothing in the suite produces by accident. `events()` is replaced by a
 * generator this test holds the gate to, so the interleaving is **placed rather than raced** — the
 * technique `provider-home-race.test.ts` §1 uses for the same reason. Everything else is the real
 * host: the real store, the real teardown bound, the real resume.
 */

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = false
  readonly messages: RuntimeEventMessage[] = []
  readonly alive = true
  constructor(readonly ownerId = 'owner:1') {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** The one event the stale iterator yields, recognisable wherever it might turn up. */
const STALE_EVENT = {
  type: 'assistant_message',
  text: 'a message from the conversation that ended',
} as const satisfies RuntimeEvent

describe('293 §3 · a pump that outlived its life writes into nothing', () => {
  let dir: string
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  /** Opened by the test, long after the drain bound has passed and the id has been reopened. */
  let gate: { promise: Promise<void>; resolve: () => void }
  /** Proof the stale yield really happened — without it every assertion below is vacuous. */
  let staleYielded: boolean
  /** Only the FIRST handle gets the held iterator; the reopened life needs a working one. */
  let handedOut: number

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-stale-pump-'))
    userData = join(dir, 'userData')
    mkdirSync(userData, { recursive: true })
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    gate = deferred()
    staleYielded = false
    handedOut = 0

    /**
     * The first handle's stream: **the real one**, and then one event still buffered behind a gate
     * this test holds — an iterator that does not end when the provider does.
     *
     * ⚠️ **The real events first, and not as decoration.** They are what records the provider ref,
     * and without a ref there is no recording to reopen — measured: the first draft of this file
     * suppressed them and `resumeSession` refused with *"There is no recording of this conversation
     * to reopen"*, which is a true sentence about a test that had not set up its own premise.
     *
     * ⚠️ **`close()` still resolves.** The finding needs a provider that stops cleanly and an
     * iterator that does not — a stop that also hung would be refused by `stopProvider`'s own bound
     * and never reach finalization with the pump still live.
     */
    const holdTheStream = (handle: SessionHandle): SessionHandle =>
      new Proxy(handle, {
        get(target, property) {
          if (property === 'events') {
            return (): AsyncIterable<RuntimeEvent> => ({
              async *[Symbol.asyncIterator]() {
                for await (const event of handle.events()) yield event
                await gate.promise
                staleYielded = true
                yield STALE_EVENT
              },
            })
          }
          const value = Reflect.get(target, property, target) as unknown
          return typeof value === 'function' ? (value as () => unknown).bind(target) : value
        },
      })

    const runtimes = new Map<string, FakeRuntime>()
    let counter = 0
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      exportDirectory: () => join(dir, 'exports'),
      nativeTranscriptPath: () => null,
      createRuntime: (provider): AgentRuntime => {
        const real = runtimes.get(provider) ?? new FakeRuntime(provider)
        runtimes.set(provider, real)
        return {
          provider,
          listModels: (context) => real.listModels(context),
          start: async (options) => {
            const handle = await real.start(options)
            return ++handedOut === 1 ? holdTheStream(handle) : handle
          },
          resume: async (ref, options) => await real.resume(ref, options),
        }
      },
      prepareProviderHome: (provider, profileId) =>
        join(userData, 'provider-homes', 'default', profileId, provider),
      providerHomePath: (provider, profileId) =>
        join(userData, 'provider-homes', 'default', profileId, provider),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      // Short, because this test's whole subject is what happens PAST it.
      closeDrainTimeoutMs: 60,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'programmatic',
        authNote: null,
        files: [],
      }),
    })
  })

  afterEach(async () => {
    gate.resolve() // never leave a pump parked: `closeAll` would wait out its own bound
    await host.closeAll()
    if (db.open) db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('🔴 drops an event yielded after finalization instead of writing it into the reopened life', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // ⛔ **ONE sink for both lives, because that is what a reopen is.** The user closes a
    // conversation and clicks Reopen in the same window; the renderer keys everything on the session
    // id. Two sinks would have hidden the delivery half of this finding behind a sink nobody is
    // looking at — measured: with two, the stale event lands on the closed window's sink and the
    // assertion below passes over nothing.
    const window = new RecordingSink('owner:1')
    const { sessionId } = await host.createSession(
      { provider: 'claude', cwd: join(dir, 'work') },
      window,
    )

    // The close gives up on the drain after 60 ms and finalizes anyway — 051's deliberate trade.
    await host.close(sessionId, window)
    // ⚑ **Non-vacuity #1: the slot really is gone**, which is the state that lets a reopen through.
    expect(host.sessionIds, 'the teardown never released the id').not.toContain(sessionId)

    // The reopen. `resumeSession` snapshots `store.nextOrdinal`, so the new life starts at exactly
    // the ordinal the old pump would take next.
    await host.resumeSession(sessionId, window)
    const reopenedAt = store.nextOrdinal(sessionId)
    const beforeTheGhost = window.messages.length

    // …and now the ghost speaks.
    gate.resolve()
    await waitFor(() => staleYielded, 'the held iterator to yield its buffered event')
    // ⚠️ **Wait for the host to have ACTED, not for a fixed number of milliseconds.** Either it
    // dropped the event and said so, or it sent it on — both are decisions, and waiting for
    // "whichever happened" is what lets the assertions below be the failure message in the broken
    // column instead of this line being it.
    const droppedItAndSaidSo = (): boolean =>
      warn.mock.calls.some((call) => String(call[0]).includes('after this life was finalized'))
    await waitFor(
      () => droppedItAndSaidSo() || window.messages.length > beforeTheGhost,
      'the host to do something with the stale event',
    )

    // 🔴 The finding, first half: closed-provider content in a conversation that is open again.
    // ⚠️ **Matched on the words, not by deep equality with {@link STALE_EVENT}** — what reaches a
    // sink is the WIRE event, which carries fields the runtime event does not. A `toContainEqual`
    // against the runtime shape passes whatever happens, which is how the first draft of this line
    // went green in the broken column.
    expect(
      window.messages.slice(beforeTheGhost).map((message) => JSON.stringify(message.event)),
      'closed-provider content was delivered into the reopened conversation',
    ).not.toContainEqual(expect.stringContaining(STALE_EVENT.text))
    // 🔴 …and the second: the ledger. `unique(session_id, generation, ordinal)` is the only thing
    // standing between the two lives, and a collision is not a caught error — it is `record`
    // deciding this conversation is no longer durable.
    expect(
      host.latestHistory(sessionId).entries.map((entry) => JSON.stringify(entry.event)),
      'the stale event was written into the reopened conversation’s ledger',
    ).not.toContainEqual(expect.stringContaining(STALE_EVENT.text))
    expect(
      window.messages.map((message) =>
        message.event.type === 'error' ? message.event.message : '',
      ),
      'the reopened conversation was told it is no longer being recorded',
    ).not.toContainEqual(expect.stringContaining('no longer being recorded'))

    // ⛔ …and it goes on recording, which is the half a fence that simply stopped everything would
    // also satisfy.
    await host.send(sessionId, 'the conversation continues', window)
    await waitFor(
      () => store.nextOrdinal(sessionId) > reopenedAt,
      'the reopened conversation to record its own events',
    )

    // ⚑ **Non-vacuity #2, last because it is the instrument and not the finding.** The drop is a
    // decision this run made rather than an event that never arrived: with the fence removed the
    // append lands instead and SQLite says `UNIQUE constraint failed: events.session_id,
    // events.generation, events.ordinal` — measured, and it is the reviewer's predicted outcome
    // word for word.
    expect(droppedItAndSaidSo(), 'nothing was dropped, so nothing above was tested').toBe(true)
    warn.mockRestore()
  })
})
