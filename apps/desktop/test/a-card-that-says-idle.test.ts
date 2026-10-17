import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import type { RuntimeEvent, SessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, THE_APP_ITSELF } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * 🔴 **656 · a card that says `idle` while the door says *still closing*** (`643` F4).
 *
 * ⛔ **Two ways into teardown, and the card only watched one of them.** `close()` marks the SLOT
 * (`slot.phase = 'closing'`) before it does anything else, and {@link AgentCard.state} has always
 * read that. ⚠️ **A provider stream that stops by itself never goes through `close()`**: the pump's
 * `finally` calls `finalize()`, which assigns `session.finalizing` and leaves `slot.phase` exactly
 * where it was. `assertAcceptsMessages` refuses on `session.closing !== null ||
 * session.finalizing !== null`, so for the whole of that teardown the door said *"still closing"*
 * while the card — reading the provider's own status — said something else.
 *
 * ## ⚑ Which stop, measured rather than assumed
 *
 * ⛔ **A stream that ENDS reads `errored`, not `idle`**: both real adapters terminalize their own
 * machine (`finishUnexpected` → `fatalError`) before they close their queue, so the card said
 * `errored` beside a door saying *still closing*. 🔴 **A stream that FAILS is the `idle` case**: the
 * failure is the HOST's — an `AsyncQueue` overflow, or a throw inside its own `for await` — so the
 * adapter is never told, and its handle keeps its last status (`idle`, `working` or
 * `waiting_permission`) through every `await` in its `close()` until `closeSession` publishes
 * `ended`. ⚑ **So the lever below makes the stream FAIL**, and it holds `close()` open to stand in
 * for those awaits — an unmodified Fake closes synchronously inside `runFinalize`'s own prefix and
 * would read `ended` before `finalizing` was even assigned.
 *
 * ⚑ **Deterministic rather than timed** (`assert-in-the-gap-not-after-the-repair`): the test ends
 * the provider's stream itself and holds the provider's `close()` open, which is `runFinalize`'s
 * first `await` — so the gap between *finalizing* and *the slot is gone* stays open exactly as long
 * as the test needs to read the card inside it. ⛔ **A later step that rewrites the same field hides
 * the gap**: once `runFinalize` reaches `slots.delete` the card no longer says `ending`, and an
 * assertion taken there would pass over either reading.
 *
 * ⚑ **Real host, real SQLite ledger, real migrations.** The only double is the provider, wrapped in
 * a Proxy rather than a subclass for `process-ownership.test.ts`' `gateClose` reason: the Fake's
 * state lives in own fields its own methods mutate, and anything that re-homes `this` stops being
 * the session under test.
 *
 * ## ⚑ D-017 · R11 — a stop is not a state
 *
 * ⛔ **`ending` is gone, and so is the disagreement.** The card is the ONE state now
 * (`shared/agent-state.ts`), and whether a process runs is never one of its inputs (`05` rule 5): a
 * conversation on its way out is not *active* — it is stopping — and nothing is owed it, so it reads
 * `idle` in the gap exactly as it did before the stream failed and as it does once the slot is gone.
 * ⚠️ The door no longer answers *still closing* either (R1): a message waits out the teardown and
 * starts it again. So the gap is still held open, and what is asserted in it is that the card says
 * the SAME word on both sides of it.
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

/** ⛔ The two levers, per launch: fail the stream, and hold `close()`. */
interface Levers {
  readonly failTheStream: () => void
  readonly letCloseFinish: () => void
  readonly handle: SessionHandle
}

/**
 * ⚑ **A handle whose stream a test FAILS and whose `close()` a test HOLDS.**
 *
 * ⛔ `events()` is re-served as the original iterator raced against a promise the test REJECTS —
 * so the `for await` in the host's pump throws, which is the `stream-failed` path, and nothing
 * tells the adapter: its machine is exactly as it was. ⚠️ `close()` waits on the second promise
 * before delegating, which holds `runFinalize` at its first `await` (`stopProvider`) the way a real
 * adapter's own interrupt-and-detach awaits do.
 */
function withLevers(handle: SessionHandle): Levers {
  let failTheStream!: () => void
  let letCloseFinish!: () => void
  const failed = new Promise<IteratorResult<RuntimeEvent>>((_resolve, reject) => {
    failTheStream = () => reject(new Error('the stream failed under the host'))
  })
  // ⚠️ Observed once so a stream that is never failed does not surface as an unhandled rejection.
  failed.catch(() => undefined)
  const closeMayFinish = new Promise<void>((resolve) => {
    letCloseFinish = resolve
  })
  const proxied = new Proxy(handle, {
    get(target, property) {
      if (property === 'events') {
        return (): AsyncIterable<RuntimeEvent> => ({
          [Symbol.asyncIterator]() {
            const inner = target.events()[Symbol.asyncIterator]()
            return {
              next: () => Promise.race([inner.next(), failed]),
              return: async (): Promise<IteratorResult<RuntimeEvent>> => {
                await inner.return?.()
                return { done: true, value: undefined }
              },
            }
          },
        })
      }
      if (property === 'close') {
        return async (): Promise<void> => {
          await closeMayFinish
          await target.close()
        }
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })
  return { failTheStream, letCloseFinish, handle: proxied }
}

class LeveredRuntime extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly issued: Levers[],
  ) {
    super(provider)
  }
  override async start(options: Parameters<FakeRuntime['start']>[0]) {
    const levers = withLevers(await super.start(options))
    this.issued.push(levers)
    return levers.handle as Awaited<ReturnType<FakeRuntime['start']>>
  }
}

describe('656 · a card that says idle while the door says closing', () => {
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let userData: string
  let root: string
  let counter: number
  let clock: number
  let window: RecordingSink
  let issued: Levers[]
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-656-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-656-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 5_000_000
    store = createSessionStore(db, tick)
    counter = 0
    issued = []
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new LeveredRuntime(provider, issued),
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
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    for (const levers of issued) levers.letCloseFinish()
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  const personOpens = async (): Promise<{ id: string; levers: Levers }> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', approvalMode: 'auto', cwd: root },
      window,
    )
    const levers = issued.at(-1)
    if (levers === undefined) throw new Error('no handle was issued')
    return { id: sessionId, levers }
  }

  /** ⚑ Asked through the clause no grant narrows — a conversation is told about itself. */
  const cardOf = (id: string) => host.agentCard(id, THE_APP_ITSELF, id)

  /**
   * ⛔ **Is the finalize window open?** — the one fact the test waits on, read off the LIST a window
   * reads rather than off host internals or the card under test: the host still holds the
   * conversation (`sessionIds`) and the list says nothing runs it (`running: 'not-running'`) —
   * `runningStateOf`'s answer for a slot on its way out, `close()`'s phase or `session.finalizing` —
   * and false once the slot is gone.
   *
   * ⚠️ **D-017 · R1 — it was the DOOR until then**, `queueMessage` refusing *"still closing"* in that
   * window. ⛔ *Still closing* is never a refusal now: a message to a conversation on its way out
   * waits out the teardown and starts it again, so the door no longer answers inside the gap.
   * ⚑ **D-017b — and the list's own `closing` is gone** (a process fact, `05` rule 5), so the fact is
   * read as the two it was made of.
   */
  const theListSaysClosing = (id: string): boolean =>
    host.sessionIds.includes(id) &&
    host.resumableSessions().find((one) => one.sessionId === id)?.running === 'not-running'

  /** ⚑ §2's control: a running conversation's door admits a message. */
  const theDoorSays = async (id: string): Promise<string> => {
    try {
      await host.queueMessage(id, 'are you there', window)
      return 'admitted'
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }

  it('🔴 §1 a stream that FAILS under the host reads `idle` on the card for the whole of its teardown — never a word of its own', async () => {
    const { id, levers } = await personOpens()

    levers.failTheStream()
    // ⚑ **Waiting on the THING** (`wait-on-the-thing-not-on-its-text`): the list says *closing* the
    // moment `finalize()` has assigned `session.finalizing`, which is synchronous inside the pump's
    // `finally` — and the held `close()` keeps it there.
    await waitFor(() => theListSaysClosing(id), 'the pump to reach finalize()')

    // 🔴 **Asserted IN the gap.** ⛔ Before D-017 this read `ending` (656's repair); ⚑ R11: a stop
    // is not a state, and a conversation on its way out is not *active* — so the card says `idle`,
    // the word §2 reads before the stream failed.
    expect(cardOf(id)).toMatchObject({ state: { is: 'idle' } })
    expect(theListSaysClosing(id)).toBe(true)

    // ⚑ **The premise, planted beside the claim** (rule 12): the PROVIDER says `idle` at this very
    // moment — the gap really is the one 656 measured, with nothing running in it.
    expect(levers.handle.status()).toBe('idle')

    // ⚠️ **And the window is bounded**: once the provider is let go, `runFinalize` reaches
    // `slots.delete`. ⚑ **D-017 · R2 — it still HAS a card**, and the same one: a stopped
    // conversation is reachable, and a message starts it again.
    levers.letCloseFinish()
    await waitFor(() => !host.sessionIds.includes(id), 'the slot to be released')
    expect(theListSaysClosing(id)).toBe(false)
    expect(cardOf(id)?.state).toEqual({ is: 'idle' })
  })

  it('⚑ §2 THE CONTROL, one fact over — the same conversation BEFORE its stream ends reads `idle`, and the door admits', async () => {
    // 🔴 **Rule 3: the same call one fact over, allowed.** ⛔ Without this, §1 would pass over a
    // card that had simply started saying `ending` about every conversation.
    const { id } = await personOpens()
    expect(cardOf(id)).toMatchObject({ state: { is: 'idle' } })
    expect(await theDoorSays(id)).toBe('admitted')
  })

  it('⛔ §3 `close()` reads `idle` too — the other way into teardown says no word of its own either', async () => {
    // ⚠️ **The other way into teardown**, held at the same `await` by the same lever: `close()`
    // marks `slot.phase` first. ⚑ D-017 · R11 — that made it `ending` before; a stop is not a state.
    const { id, levers } = await personOpens()
    const closing = host.close(id, window)
    await waitFor(() => theListSaysClosing(id), 'close() to mark the slot')
    expect(cardOf(id)).toMatchObject({ state: { is: 'idle' } })
    levers.letCloseFinish()
    await closing
    // ⚑ **D-017 · R2** — stopped, not gone: it still has a card, and it says the same.
    expect(host.sessionIds).not.toContain(id)
    expect(cardOf(id)?.state).toEqual({ is: 'idle' })
  })
})
