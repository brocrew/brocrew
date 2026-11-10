import { waitFor } from './lib/f093-host'
import { fixtureProviderConfig, neutralHostDeps } from './lib/host-fixture'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FakeProviderSessions,
  FakeRuntime,
  type RuntimeEvent,
  type SessionHandle,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { describeUnavailable } from '../src/main/runtime/session-unavailable'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * # 🔴 509 · the word the poll cannot say
 *
 * ## ⛔ What `505` measured, and why no cadence could have fixed it
 *
 * ⚠️ **`RuntimeHost.runningStateOf` answers *who is LOOKING*, never *what is happening*.** It ends
 * `slot.ownerId === null ? 'unwatched' : 'in-a-window'`, and the project room drew the first as
 * *"nobody is watching it"* — so an agent that is working and one wedged for forty minutes are the
 * same row, and asking the same question more often gets the same wrong answer. ⚑ The fact that was
 * actually wanted was **already being computed for exactly the conversations nobody can see**:
 * `deliver` calls `session.liveness.observe(event)` 76 lines above its `if (session.sink.alive)`
 * gate, so `live | silent | ended | errored` is maintained for every unowned child and dropped at
 * one `if`.
 *
 * ## ⛔ D-016 · the word went with the room
 *
 * 🔴 **The project room was the one reader that published the word**, through
 * `RuntimeHost.livenessStateOf`, and D-016 deleted the room — so `livenessStateOf` went with its
 * only caller, and with it §1 (*the two rows one sample has to tell apart*) and §2 (*`null` is there
 * is nobody to ask*), whose every assertion read that row.
 *
 * ## ⚑ What this file is still arranged around
 *
 * §3 **`running` did not move**, on the reopen halves that carry it · §4 **where the word is
 * published — nowhere now — and every call of `runningStateOf`, named** · §5 **the claim door is
 * exactly as claimable as it was**.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/**
 * ⚠️ **The silence window, as the host's injected knob** (518) — short, so a `quiet` stream's tracker
 * reaches `silent` inside a test. ⛔ Since D-016 no assertion here reads the word it decides: the
 * room that published it is gone (see this file's header).
 */
const SILENCE_WINDOW_MS = 400

/**
 * ⛔ **What the provider DID.**
 *
 * ⚠️ `plain` never says it is working, so its tracker never arms a timer at all — `LivenessTracker`
 * only watches a turn that announced itself. `quiet` says it is working and then stops, which is
 * the wedge.
 */
type Stream = 'plain' | 'quiet'

/** A handle whose event stream is replaced — every other member is the Fake's, untouched. */
function streaming(
  handle: SessionHandle,
  events: () => AsyncIterable<RuntimeEvent>,
): SessionHandle {
  return new Proxy(handle, {
    get(target, property) {
      if (property === 'events') return events
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })
}

const WORKING = { type: 'status', state: 'working' } as RuntimeEvent

class WindowSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

describe('509 · the word the poll cannot say', () => {
  let userData: string
  let db: AppDatabase
  let ledger: SessionStore
  let host: RuntimeHost
  let sessions: FakeProviderSessions
  let counter: number
  let nextStream: Stream
  let window1: WindowSink

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-509-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    ledger = createSessionStore(db)
    sessions = new FakeProviderSessions()
    counter = 0
    nextStream = 'plain'
    window1 = new WindowSink('webContents:1')
    host = new RuntimeHost({
      store: ledger,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => {
        const runtime = new FakeRuntime(provider, { sessions })
        const start = runtime.start.bind(runtime)
        const stream = nextStream
        runtime.start = async (opts) => {
          const plain = await start(opts)
          if (stream === 'plain') return plain as never
          return streaming(plain, () => ({
            async *[Symbol.asyncIterator]() {
              yield WORKING
              // …and then nothing, ever. The window elapses and the tracker says so.
              await new Promise(() => {})
            },
          })) as never
        }
        return runtime
      },
      prepareProviderHome: (provider: Provider) => {
        const home = join(userData, 'provider-homes', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      liveness: { windowMs: SILENCE_WINDOW_MS },
      // ⚠️ A provider that never ends its stream must not charge this suite the default drain.
      //
      // ⛔ **And it emits `runtime session <id> did not drain within 40ms` on every run of this
      // file, green or red — once per `quiet` session** (518). That stream parks on a
      // promise nobody resolves, so its pump can never settle and the wait can only ever expire —
      // which is exactly what this number is here to make cheap: 40 ms rather than
      // `DEFAULT_CLOSE_DRAIN_TIMEOUT_MS`'s 5 s. ⚠️ **`514` F9 read that line as a failed
      // assertion**, because
      // the default reporter prints it only when a test in the file fails and it then sits
      // directly above the `AssertionError`. There is no assertion on the drain here.
      closeDrainTimeoutMs: 40,
      readProviderConfig: fixtureProviderConfig,
    })
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  /** One conversation, with the stream its provider is going to run. */
  const open = async (stream: Stream, sink: RuntimeEventSink | null): Promise<string> => {
    nextStream = stream
    const { sessionId } = await host.createSession(
      { provider: 'claude', cwd: userData, approvalMode: 'ask' },
      sink,
    )
    nextStream = 'plain'
    return sessionId
  }

  /**
   * ⚑ **The wedge, waited on the PRODUCER** — its one `working` is in the ledger and nothing follows
   * it. ⛔ Since D-016 no reader publishes the word the tracker then says, so this is the premise
   * the cases below can still meet.
   */
  const wedgedBy = async (sessionId: string): Promise<void> =>
    waitFor(
      () => ledger.events(sessionId).some((one) => one.event.type === 'status'),
      `${sessionId} to announce the turn it then never produces in`,
    )

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §3 · `running` did not move
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · every arm `running` already had, on every reader that carries it', () => {
    // ⛔ **D-016 · the roster's case went with the room**: it read the three arms off the project
    // room's row, beside the word. The reopen halves below still carry all three.
    it('⚑ the two reopen halves still answer all three, and carry no such field', async () => {
      const held = await open('plain', window1)
      const wedged = await open('quiet', null)
      ledger.create({
        id: 'sess_from_a_dead_process',
        provider: 'claude',
        cwd: userData,
        approvalMode: 'ask',
        profileId: 'default',
      })
      await wedgedBy(wedged)
      // ⚑ **Taken in the same sample, for the control below** — the one shape here that DOES carry
      // a key by that name.
      const created = await host.createSession(
        { provider: 'claude', cwd: userData, approvalMode: 'ask' },
        null,
      )

      const reopen = [...host.resumableSessions(), ...host.unresumableSessions()]
      const runningOf = (id: string): string | undefined =>
        reopen.find((row) => row.sessionId === id)?.running
      expect(runningOf(held)).toBe('in-a-window')
      expect(runningOf(wedged)).toBe('unwatched')
      expect(runningOf('sess_from_a_dead_process')).toBe('not-running')

      // 🔴 **The decision of §4, asserted rather than described** — the same wedged conversation is
      // on these two lists with no liveness on it at all, which was `RuntimeHost.livenessStateOf`'s
      // stated rule: a word that moves on a TIMER may only be published by a reader that re-reads
      // faster than the timer, and `SideRail.refreshClosed` does not poll at all.
      for (const row of reopen) {
        expect(Object.keys(row)).not.toContain('liveness')
      }
      // ⚑ **The control that plants two** (standing rule 12): a shape that DOES carry the key, read
      // the same way, in the same sample — so *"no key called liveness"* is a fact about these two
      // shapes and not about a check that could never fire. ⚠️ D-016 · it was the room's row; the
      // created session's is the wide projection under the same key (§4's own control).
      expect(Object.keys(created)).toContain('liveness')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §5 · the claim door
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · exactly as claimable as it was', () => {
    it('🔴 a wedged unowned child can still be taken over', async () => {
      const wedged = await open('quiet', null)
      await wedgedBy(wedged)
      // ⚑ **Read off the reopen half**, the reader of `running` that is left (D-016: the room's row
      // went) — and read BEFORE the claim too, so the flip below is the claim's doing.
      const runningOf = (id: string): string | undefined =>
        [...host.resumableSessions(), ...host.unresumableSessions()].find(
          (row) => row.sessionId === id,
        )?.running
      expect(runningOf(wedged)).toBe('unwatched')

      // ⛔ **The door `336` built, on the row this dispatch is about.** An observe word that had
      // gone anywhere near `slot.ownerId` would show up here: `mayClaim` is `slot.ownerId === null`
      // and nothing in this dispatch writes that field.
      expect(() => host.claimSession(wedged, window1)).not.toThrow()
      expect(runningOf(wedged)).toBe('in-a-window')
      // ⛔ **D-016 · *and the word survives the claim* went with the room**, the one reader that
      // published the word before a claim as well as after it.
    })

    it('⚠️ …and the two refusals are exactly the two that were there before', async () => {
      const held = await open('plain', window1)
      ledger.create({
        id: 'sess_from_a_dead_process',
        provider: 'claude',
        cwd: userData,
        approvalMode: 'ask',
        profileId: 'default',
      })
      const other = new WindowSink('webContents:2')

      // ⛔ **A conversation another window holds is refused**, by the owner check and not by
      // anything this dispatch added.
      expect(() => host.claimSession(held, other)).toThrow(
        describeUnavailable('already-open-elsewhere'),
      )
      // ⚑ **And a row nothing is running is refused by NAME** — the reopen is that row's gesture.
      expect(() => host.claimSession('sess_from_a_dead_process', other)).toThrow()
    })
  })
})
