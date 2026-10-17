import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import type {
  MemoryLoadedEvent,
  RuntimeEventMessage,
  SessionInstructions,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

/**
 * 🔴 **332 · the launch row reaches the conversation, once, at the top of it.**
 *
 * ⛔ **`instructions.test.ts` proves the READER and proves nothing about the wiring**, which is
 * exactly the hole 318's own mutation table found one dispatch over: with only the unit file in the
 * suite, deleting the host's publish left every assertion green while the conversation showed
 * nothing. ⚠️ So every assertion here goes through a real `RuntimeHost`, a real sink and a real
 * ledger.
 *
 * ## ⛔ The three facts this file exists to hold
 *
 *  1. **Ordinal 0.** It is published inside `onRegistered`, the last synchronous line before the
 *     pump — so it is the first row of the conversation and cannot read as something that happened
 *     for an answer, which is the reading 319 §3 forbids.
 *  2. **Once.** A resume publishes none: the ledger already holds it from the life that opened the
 *     conversation.
 *  3. **Never invented.** A host whose reader says `null` — or has no reader at all — publishes
 *     nothing, and there is no default anywhere that would fill one in.
 *  4. 🔴 **604 · and the row's TWO clocks stay apart.** `MemoryLoadedEvent.lookedAt` is when the
 *     reader looked at the store; `RuntimeEventMessage.at` is when this host appended the row. ⛔
 *     Between them sits `awaitLaunch`, so `601` measured them as up to fifteen seconds apart — and
 *     the only reason that gap is safe to render is that nothing here collapses one into the other.
 *     ⚠️ The reader's own half is in `when-we-looked-is-not-when-it-was-loaded.test.ts`.
 */

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = false
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId = 'owner:1') {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
  events(): TranscriptEvent[] {
    return this.messages.map((message) => message.event)
  }
  loaded(): RuntimeEventMessage[] {
    return this.messages.filter((message) => message.event.type === 'memory_loaded')
  }
}

const NO_MEMORY: SessionInstructions = {
  injected: [],
  agentMemory: [],
  provider: [],
  refused: [],
  note: '',
  recallsReported: false,
  writesReported: true,
  composed: null,
}

const LAUNCH: MemoryLoadedEvent = {
  type: 'memory_loaded',
  index: '/homes/claude/memory/MEMORY.md',
  beside: 3,
}

/**
 * ⚑ **604 · a look, and a publish a whole launch timeout later.** The two numbers are far apart and
 * neither is *now*, so a row that reported either one in the other's place is visible as a value
 * rather than as a plausible timestamp.
 */
const LOOKED_AT = Date.parse('2026-09-20T14:02:00.000Z')
const PUBLISHED_AT = LOOKED_AT + 15_000

describe('332 · the row that says how the conversation opened', () => {
  let userData: string
  let db: AppDatabase
  let host: RuntimeHost
  let sink: RecordingSink
  /** What the ledger really holds, independent of any window (318's rule). */
  let recorded: { ordinal: number; event: TranscriptEvent }[]
  /** ⚑ **604** — when the LEDGER says each of those rows was written. */
  let stamps: { ordinal: number; at: number }[]
  /** What the composition root's reader would have answered — swapped per test. */
  let launchFact: MemoryLoadedEvent | null
  /** Held across `build()` calls, so a session survives a host that is torn down and rebuilt. */
  let runtimes: Map<Provider, FakeRuntime>

  function build(over: { readInstructions?: false; now?: () => number } = {}): RuntimeHost {
    let counter = 0
    const store = createSessionStore(db)
    return new RuntimeHost({
      ...(over.now === undefined ? {} : { now: over.now }),
      store: {
        ...store,
        append: (sessionId, ordinal, event, at) => {
          recorded.push({ ordinal, event })
          // ⚑ **604 · kept beside `recorded` rather than inside it**, so the equality assertions
          // above keep comparing whole events and this file gains the ledger's own stamp.
          stamps.push({ ordinal, at })
          return store.append(sessionId, ordinal, event, at)
        },
      },
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      // ⚠️ **One runtime per provider, HELD** — a fresh `FakeRuntime` per call cannot resume a
      // session it never issued, and the resume tests below are the point of the file.
      createRuntime: (provider: Provider) => {
        const held = runtimes.get(provider) ?? new FakeRuntime(provider)
        runtimes.set(provider, held)
        return held
      },
      prepareProviderHome: (provider) => {
        const home = join(userData, 'provider-homes', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
      // ⚠️ **Absent entirely for one test**, because "this host has no reader" and "this host's
      // reader had nothing to say" are two different silences and only one of them is a default.
      ...(over.readInstructions === false
        ? {}
        : {
            readInstructions: () => ({
              instructions: NO_MEMORY,
              systemHint: undefined,
              memoryLoaded: launchFact,
            }),
          }),
    })
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-memory-loaded-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    recorded = []
    stamps = []
    runtimes = new Map()
    launchFact = LAUNCH
    host = build()
    sink = new RecordingSink()
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  it('🔴 is the FIRST row of the conversation — ordinal 0, before anything the provider says', async () => {
    const created = await host.createSession({ provider: 'claude' }, sink)

    const first = sink.messages.filter((message) => message.sessionId === created.sessionId)[0]
    expect(first?.event).toEqual(LAUNCH)
    expect(first?.ordinal).toBe(0)
    // …and it is in the LEDGER at 0 too, which is the half a sink cannot see (318).
    expect(recorded[0]).toEqual({ ordinal: 0, event: LAUNCH })
  })

  it('⛔ a reader with nothing to say publishes NOTHING — there is no default that invents one', async () => {
    launchFact = null

    const created = await host.createSession({ provider: 'claude' }, sink)

    expect(sink.loaded()).toHaveLength(0)
    expect(recorded.some((row) => row.event.type === 'memory_loaded')).toBe(false)
    // ⚑ The paired positive: this host DID open a session and DID publish other rows, so the
    // absence above is a decision rather than a session that never started.
    expect(created.sessionId).toBeTruthy()
    expect(sink.messages.length).toBeGreaterThan(0)
  })

  it('⚠️ …and a host with no reader at all publishes nothing either', async () => {
    await host.closeAll()
    host = build({ readInstructions: false })

    await host.createSession({ provider: 'claude' }, sink)

    expect(sink.loaded()).toHaveLength(0)
  })

  it('⛔ a RESUME does not say it again — one statement per conversation (332 §2.1)', async () => {
    const created = await host.createSession({ provider: 'claude' }, sink)
    expect(sink.loaded(), 'the create did not publish one, so this proves nothing').toHaveLength(1)
    await host.close(created.sessionId, sink)

    const resumed = await host.resumeSession(created.sessionId, sink)

    expect(resumed.handover).toBe('resumed')
    // ⚠️ **Counted on the SINK across both lives**, not "the resume published none": the reader
    // still answers on a resume — 158's live-profile semantic re-reads the store — so what is being
    // asserted is that the host declines it, not that there was nothing to decline.
    expect(sink.loaded()).toHaveLength(1)
    // …and the ledger holds exactly the one row the first life wrote.
    expect(recorded.filter((row) => row.event.type === 'memory_loaded')).toHaveLength(1)
  })

  /**
   * 🔴 **604 §4.3 · the two clocks, held apart over a real host.**
   *
   * ⛔ **This is the test the brief asked for by name**: it fails if somebody later points
   * {@link MemoryLoadedEvent.lookedAt} at the ledger's stamp, because the reader's number is
   * injected here and the host's clock is a different, fixed one. ⚑ **Neither number is *now***,
   * so a row reporting either in the other's place shows up as a value rather than as a plausible
   * timestamp.
   */
  it("🔴 604 · `lookedAt` is the READER's clock and `at` is the LEDGER's — never the same number", async () => {
    await host.closeAll()
    host = build({ now: () => PUBLISHED_AT })
    launchFact = { ...LAUNCH, lookedAt: LOOKED_AT }

    const created = await host.createSession({ provider: 'claude' }, sink)

    const row = sink.loaded()[0]
    expect(row, 'no launch row was published, so nothing below is being measured').toBeDefined()
    expect(row?.sessionId).toBe(created.sessionId)
    const event = row?.event as MemoryLoadedEvent
    // ⚑ Carried through untouched — the reader's number reaches the wire as the reader took it.
    expect(event.lookedAt).toBe(LOOKED_AT)
    // ⛔ …and the row's own stamp is the HOST's clock, on the wire and in the ledger alike.
    expect(row?.at).toBe(PUBLISHED_AT)
    expect(stamps.find((written) => written.ordinal === 0)?.at).toBe(PUBLISHED_AT)
    // ⚠️ **The fixture's gap is `DEFAULT_LAUNCH_TIMEOUT_MS` because that is the real one** — `601`
    // measured `awaitLaunch` sitting between the look and the publish. ⛔ **That constant is private
    // to `runtime-host.ts`, so this line is a COPY of it and pins nothing about the host**; what the
    // two assertions above pin is that the numbers pass through independently, at any distance.
    expect(row!.at - event.lookedAt!).toBe(15_000)
  })

  it('⚠️ …and nothing downstream INVENTS one when the reader took none', async () => {
    await host.closeAll()
    host = build({ now: () => PUBLISHED_AT })
    launchFact = LAUNCH

    await host.createSession({ provider: 'claude' }, sink)

    const row = sink.loaded()[0]
    // ⚑ The paired positive: a row WAS published and it does carry the host's stamp, so the
    // absence below is a decision rather than a session that never opened.
    expect(row?.at).toBe(PUBLISHED_AT)
    expect((row?.event as MemoryLoadedEvent).lookedAt).toBeUndefined()
    expect(Object.keys(row?.event ?? {})).not.toContain('lookedAt')
  })

  it('⚑ …and the resumed conversation still REPLAYS the one it has', async () => {
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.close(created.sessionId, sink)

    const resumed = await host.resumeSession(created.sessionId, sink)

    const replayed = resumed.history.entries.map((row) => row.event.type)
    expect(replayed).toContain('memory_loaded')
    // ⚠️ The paired positive that stops this passing over an empty window: the row is at the FRONT
    // of the replay, which is where the conversation opened.
    expect(replayed[0]).toBe('memory_loaded')
  })
})
