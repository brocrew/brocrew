import { waitFor } from './lib/f093-host'
import { fixtureProviderConfig, neutralHostDeps } from './lib/host-fixture'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
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
import { RUNNING_STATES } from '../src/shared/runtime-ipc'
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
  // §4 · one call site, and it is a ruling
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · where the word is published, and where it deliberately is not', () => {
    /** ⛔ A census that reads prose reads code wrong — a docblock naming a call is not a call. */
    const withoutProse = (code: string): string =>
      code
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .join('\n')

    it('⛔ a fourth ARM would have moved three questions — the readers, by import and not by mention', () => {
      const src = join(here, '../src')
      const read = (name: string): string => withoutProse(readFileSync(join(src, name), 'utf8'))
      const named = readdirSync(src, { recursive: true, encoding: 'utf8' })
        .filter((name) => /\.(ts|vue)$/.test(name))
        .filter((name) => read(name).includes('RunningState'))
        .map((name) => name.replace(/\\/g, '/'))
        .sort()
      // ⛔ **Four files name the TYPE, and four surfaces read the FIELD.** `505` said a field
      // beside `running` rather than a fourth arm, and this is the measurement behind it: one word
      // answers four questions, so an arm would have moved all four at once —
      // `widening-a-predicate-widens-every-question-its-field-answers`.
      //
      // ⚠️ **543 · a FOURTH file names the type and the claim above is corrected rather than the
      // roster loosened.** `shared/who-called-whom.ts` carries {@link SpawnEdge.running}, which is
      // the same word left UNFOLDED on purpose: `hereIsOf(running, held)` needs the window's own
      // `held` to reach `open-in-another-window`, and no host knows which window is asking. ⛔ **No
      // fourth ARM and no fifth reading SURFACE** — the panel is `540`'s slice 2 — so what this
      // census measures is unchanged and only the list of namers moved.
      // ⚠️ **637 · a FIFTH file names the type, and the claim is corrected rather than the roster
      // loosened.** `shared/the-whole-forest.ts` carries `ForestConversation.running`, which is
      // the same word left UNFOLDED for `SpawnEdge`'s reason exactly. ⛔ **No fourth ARM and no
      // new reading SURFACE** — the Team graph that will draw it is the frontend seat's and is not
      // in this tree — so what this census measures is unchanged and only the list of namers moved.
      // ⚑ **D-017b · the renderer names the type NOWHERE now** — `closed-threads.ts`, its one
      // renderer namer, went with the open/closed split (one Conversations list), and no reader
      // below imports it. ⛔ So every renderer reader of the field is one of the silent kind.
      // ⚠️ **D-016 · a renderer file names it again, and the list is corrected rather than
      // loosened.** `openElsewhere` moved out of the deleted room's `project-roster.ts` into
      // `taking-over.ts`, and its parameter is typed `RunningState` there (it was the room's row's
      // `running`). ⛔ Its body is still a comparison against one arm, so a fourth member would
      // still land on the complement's side of it in silence — naming the type does not change that.
      expect(named).toEqual([
        'main/runtime/runtime-host.ts',
        'main/runtime/work-reads.ts',
        'renderer/src/lib/taking-over.ts',
        'shared/runtime-ipc.ts',
        'shared/the-whole-forest.ts',
        'shared/who-called-whom.ts',
      ])
      // ⚑ **The control for `derive-a-roster-from-the-import-not-the-mention`** — ⚠️ D-017b took the
      // codebase's own planted case away (`where-the-work-is.ts` no longer names the type in prose),
      // so it is planted here: a roster taken off the mention would count a NAMER that reads
      // nothing, while missing every surface below that reads the field and names nothing.
      const planted =
        '/** a {@link RunningState} in a docblock */\n// and RunningState in a line\nconst x = 1\n'
      expect(planted).toContain('RunningState')
      expect(withoutProse(planted)).not.toContain('RunningState')

      expect(RUNNING_STATES).toHaveLength(3)
      // ⚑ **D-017b · re-aimed, not stripped** (rule 26): *may I claim it* and *is it over* left with
      // the Take-it-over and Reopen presses (one press everywhere: *Open the conversation*), and the
      // rail's open/closed split left with the split. ⛔ The word still answers FOUR questions, and
      // each reader asks it by a comparison against one arm, in a file that does not name the type —
      // so a fourth member would land on the complement's side of every one of them in silence.
      // ⚠️ Some instruments catching it and some not is worse than either, and it is the whole
      // argument for a sibling field.
      // ⚑ **D-016 · THREE questions** — the room, which asked the second (*may the record's refusal
      // be drawn*, only for a row nothing runs), went, and its fold of the first moved to
      // `taking-over.ts`, where every reader of it now reads it.
      // 1 · *is it open in ANOTHER window* — the one fold of it, and the forest's call of it …
      expect(read('renderer/src/lib/taking-over.ts')).toContain(
        "return running === 'in-a-window' && !held",
      )
      expect(read('renderer/src/lib/the-forest.ts')).toContain('openElsewhere(node.running,')
      // … and the one Conversations list's (rail and ⌘K), which is the same question asked inline
      expect(read('renderer/src/lib/conversation-list.ts')).toContain(
        "inAnotherWindow: row.running === 'in-a-window',",
      )
      // 2 · *may the forest draw the recorded status* — only for a node nothing runs
      expect(read('renderer/src/lib/the-forest.ts')).toContain(
        "(node.running === 'not-running' ? node.status : null)",
      )
      // 3 · *did the hand-back take* — the host's word after the write, read by its one arm
      expect(read('renderer/src/lib/handing-it-back.ts')).toContain(
        "if (released.running !== 'unwatched') {",
      )
      for (const reader of [
        'renderer/src/lib/the-forest.ts',
        'renderer/src/lib/conversation-list.ts',
        'renderer/src/lib/handing-it-back.ts',
      ]) {
        expect(read(reader), reader).not.toContain('RunningState')
      }
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
