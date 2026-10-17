import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentRuntime, RuntimeEvent, SessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { DEFAULT_PROFILE_ID, type RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * # ⚑ D-017 · R1 — a Close counts as a stop from the instant it begins, not from its finalize
 *
 * ⛔ **`RuntimeHost.itStoppedUnder` answers ONE question**: did the conversation a delivery went
 * straight into stop under it — on its way out (`session.closing`), or already finalized
 * (`session.finalizing`), or its provider's own status, or its slot moved on. A person's Close sets
 * `closing` SYNCHRONOUSLY, the moment `close()` is called; `finalizing` is set later, only once the
 * teardown's own drain wait gives up or the provider's stream is noticed to have ended. Between
 * those two moments a conversation is unmistakably on its way out — `assertAcceptsMessages` already
 * refuses `closing !== null` on its own — and a delivery that meets it there must be waited out and
 * started again (`aDeliveryAStopCaught`), never told *"session is not active"* as a plain refusal.
 *
 * ⚠️ **The window is not exotic.** `close()`'s own comment says the PUMP usually reaches finalize
 * first, on a microtask, racing whatever a concurrent send was doing — so a naive test can find
 * `closing` and `finalizing` both already set and never touch the gap at all (as `hold-the-second-
 * message.test.ts`'s §4 does, on the QUEUED door). This file holds the pump open on purpose — its
 * `events()` never ends — so `finalizing` cannot be set except by `tearDown`'s own bounded fallback,
 * which trips only after `closeDrainTimeoutMs`. The gap is then wide open for as long as the test
 * needs it.
 *
 * ⚑ **Real host, real SQLite ledger, real migrations, the Fake provider** — `a-childs-state.test.ts`'s
 * shape. The only double is the provider, and it is doubled exactly where this dispatch needs
 * control: its FIRST launch's event stream hangs; its resume, once teardown finally completes, runs
 * for real, so the redelivery this file measures is actually observed end to end rather than assumed.
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

/**
 * ⚑ **The real events, until the real stream would END — and then never.** The FIRST events a Fake
 * launch produces carry its own `ref` ({@link SessionHandle.ref}), which `resume` needs to reopen
 * it; swallowing every event from the start (as an unconditionally-hanging iterator would) leaves a
 * handle with no ref and nothing later to resume. So this forwards everything real, and only
 * intercepts the ONE moment the underlying iterator reports `done` — the close's own `queue.close()`
 * — and hangs THERE instead of letting it through. The host's pump reads `events()` in a `for
 * await`, so a stream that never ends never reaches the pump's `finally`, the one other door onto
 * `finalize()` besides `tearDown`'s own bounded fallback — which is what keeps `session.finalizing`
 * null for as long as the test needs the gap.
 */
const holdTheStreamOpenPastItsEnd = (real: SessionHandle): (() => AsyncIterable<RuntimeEvent>) => {
  return (): AsyncIterable<RuntimeEvent> => ({
    [Symbol.asyncIterator]() {
      const inner = real.events()[Symbol.asyncIterator]()
      return {
        next: async (): Promise<IteratorResult<RuntimeEvent>> => {
          const result = await inner.next()
          if (result.done) return new Promise<IteratorResult<RuntimeEvent>>(() => {})
          return result
        },
      }
    },
  })
}

describe('M55 · a Close counts as a stop before its own finalize', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let sessions: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  /** ⚑ Which launch of this test's ONE conversation is under way — `start`, then, once the close's
   *  drain finally gives up and the reopen runs, `resume`. Only launch 1's stream hangs. */
  let launches: number

  const buildHost = (closeDrainTimeoutMs: number): RuntimeHost =>
    new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => {
        const inner = new FakeRuntime(provider, { sessions })
        const thisLaunch = ++launches
        const bind = <T extends object>(target: T, prop: string | symbol): unknown => {
          const value = Reflect.get(target, prop) as unknown
          return typeof value === 'function' ? value.bind(target) : value
        }
        const wrap = <H extends object>(handle: H): H =>
          thisLaunch !== 1
            ? handle
            : new Proxy(handle, {
                get(h, p) {
                  if (p === 'events')
                    return holdTheStreamOpenPastItsEnd(h as unknown as SessionHandle)
                  return bind(h, p)
                },
              })
        return new Proxy(inner, {
          get(target, prop) {
            if (prop === 'start') {
              return async (opts: Parameters<AgentRuntime['start']>[0]) =>
                wrap(await target.start(opts))
            }
            if (prop === 'resume') {
              return async (...args: Parameters<AgentRuntime['resume']>) =>
                wrap(await target.resume(...args))
            }
            return bind(target, prop)
          },
        }) as AgentRuntime
      },
      prepareProviderHome: async (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: () => clock++,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
      closeDrainTimeoutMs,
    })

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-m55-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-m55-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, () => clock++)
    counter = 0
    sessions = new FakeProviderSessions()
    launches = 0
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  const until = async (check: () => boolean | Promise<boolean>, what: string): Promise<void> => {
    for (let n = 0; n < 400; n += 1) {
      if (await check()) return
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  const eventsOf = (sessionId: string): { type: string; [key: string]: unknown }[] =>
    store.events(sessionId).map((one) => one.event as { type: string; [key: string]: unknown })
  const turnTexts = (sessionId: string): string[] =>
    eventsOf(sessionId)
      .filter((event) => event.type === 'user_turn')
      .map((event) => String(event.text))

  /** ⛔ A private read, in the shape `hold-the-second-message.test.ts` §5.2 uses for the mailbox:
   *  the two fields {@link itStoppedUnder} actually compares, read off the live slot. */
  const closingAndFinalizing = (
    sessionId: string,
  ): { closing: boolean; finalizing: boolean } | null => {
    const slot = (
      host as unknown as {
        slots: Map<string, { session: { closing: unknown; finalizing: unknown } | null }>
      }
    ).slots.get(sessionId)
    if (!slot || slot.session === null) return null
    return { closing: slot.session.closing !== null, finalizing: slot.session.finalizing !== null }
  }

  it('a message whose handover lands the instant a Close begins — before finalize — waits out the stop and is delivered again, never told the conversation "is not active"', async () => {
    host = buildHost(40)
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId: DEFAULT_PROFILE_ID, approvalMode: 'auto', cwd: work },
      window,
    )

    // ⚑ **The race, with no gate needed.** `send`'s only await before the handover
    // (`assertSignInCurrent`'s `checkSignIn`, undefined on the Fake) resolves on the very next
    // microtask — long before `close()`'s synchronous prefix below has even had a chance to run —
    // so calling `close()` immediately after, in the same tick, always lands while that microtask is
    // still pending. `close()` itself has no await before it flips the provider's own machine to
    // `'closing'` (`tearDown` → `stopProvider` → `doStopProvider`'s IIFE → `handle.close()` →
    // `doClose()`'s `machine.beginClose()`, none of it awaited) — so by the time this statement
    // returns, the handle a moment from now will refuse a send as *"not active"*, not as *"a turn is
    // already held"*.
    const answering = host.send(sessionId, 'are you there', window)
    const closing = host.close(sessionId, window)

    // ⛔ **The premise, measured rather than assumed**: right where `itStoppedUnder` will read it,
    // this conversation is closing and NOT yet finalized — the exact gap M55 plants across.
    expect(closingAndFinalizing(sessionId)).toEqual({ closing: true, finalizing: false })

    // 🔴 **RED under M55, GREEN on today's code.** `itStoppedUnder`'s `||` (M55 plants `&&`) is what
    // makes this resolve instead of rejecting with the FakeRuntime's own `TURN_REFUSED` text.
    await expect(answering).resolves.toBeUndefined()

    await closing
    await until(
      () => eventsOf(sessionId).some((event) => event.type === 'reopened'),
      'the conversation to be started again',
    )
    const reopenedAt = eventsOf(sessionId).findIndex((event) => event.type === 'reopened')
    const turnAt = eventsOf(sessionId).findIndex(
      (event) => event.type === 'user_turn' && event.text === 'are you there',
    )
    // 🔴 **Delivered as the NEW start's own turn**, never as a message the dead conversation took.
    expect(turnAt).toBeGreaterThan(reopenedAt)
    expect(turnTexts(sessionId)).toEqual(['are you there'])
    // ⚑ A second launch really ran — the redelivery is observed, not merely inferred from the
    // absence of a thrown error.
    expect(launches).toBe(2)
  })

  it('control: the same words, sent with nothing closing, go straight out with no reopen at all', async () => {
    host = buildHost(40)
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId: DEFAULT_PROFILE_ID, approvalMode: 'auto', cwd: work },
      window,
    )

    await expect(host.send(sessionId, 'are you there', window)).resolves.toBeUndefined()

    expect(turnTexts(sessionId)).toEqual(['are you there'])
    expect(eventsOf(sessionId).some((event) => event.type === 'reopened')).toBe(false)
    // ⚑ One launch only: nothing stopped under this delivery, so nothing had to be started again.
    expect(launches).toBe(1)
  })
})
