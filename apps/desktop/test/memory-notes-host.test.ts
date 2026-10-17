import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { codexAdHocNotesDir, FakeRuntime, type FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, NULL_SESSION_STORE } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import {
  MEMORY_NOTES_PER_EVENT,
  MEMORY_NOTE_TEXT_CAP,
  type MemoryNoteEvent,
  type RuntimeEventMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../src/main/db/migrations')
const rendererSource = (path: string): string =>
  readFileSync(join(here, '../src/renderer/src', path), 'utf8')

/**
 * 🔴 **318 · the turn boundary itself — and this file exists because a mutation row found it
 * missing.**
 *
 * ⛔ **`memory-notes.test.ts` proves the OBSERVER and proves nothing about the WIRING.** `318 M1` is
 * the defect verbatim — the `publishMemoryNotes` call deleted from the `idle` arm, which is exactly
 * the state `main` was in before this dispatch — and with only that file in the suite the row
 * **SURVIVED**: every unit assertion still passed while the conversation showed nothing again. ⚑ A
 * table that finds a hole in the tests written beside it is the table doing its job, and this is the
 * test that closes it.
 *
 * ⚠️ **So every assertion here goes through the real host**: a real `RuntimeHost`, a real turn, a
 * real sink, and a note written into the real store directory while the turn is genuinely in flight.
 */

class RecordingSink implements RuntimeEventSink {
  // 349 · this double stands in for a WINDOW — the tests below answer for a person through it.
  readonly aPersonIsBehindIt = true
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
  notes(): MemoryNoteEvent[] {
    return this.events().filter((event): event is MemoryNoteEvent => event.type === 'memory_note')
  }

  /**
   * 🔴 **The first pair that ARRIVED in the wrong order, or `null`** (320).
   *
   * ⚠️ **This reads `messages`, not the ledger, and that is the whole point.** 320's defect left the
   * ledger perfectly contiguous — the PM checked ordinals 175-182 against his real database before
   * blaming anything — and every assertion in this file read either the events or the recorded rows,
   * so all of them stayed green while the renderer printed *"event stream gap"* twice. The order
   * messages reach a sink is a different fact from the order they were written in, and until this
   * method existed nothing here could see it.
   *
   * ⚠️ **Per SESSION, and that correction came from this guard's own first run.** Ordinals are a
   * session's counter, not a sink's; one window holds many conversations, so a second session
   * starting at `0` behind a first at `15` is the ordinary shape of a shared sink and not a defect.
   * Compared flat, it read as one — `{ after: 15, then: 0 }` — which would have been a false claim
   * about the very thing this method exists to be believed about.
   */
  outOfOrderArrival(): { session: string; after: number; then: number } | null {
    const highest = new Map<string, number>()
    for (const message of this.messages) {
      const previous = highest.get(message.sessionId)
      if (previous !== undefined && message.ordinal < previous) {
        return { session: message.sessionId, after: previous, then: message.ordinal }
      }
      highest.set(message.sessionId, message.ordinal)
    }
    return null
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

describe('318 · the host says what appeared while the turn ran', () => {
  let userData: string
  let host: RuntimeHost
  let sink: RecordingSink
  /** What `store.append` was actually handed — the durable half, independent of the sink. */
  let recorded: { ordinal: number; event: TranscriptEvent }[]
  /** Which row the ledger refuses, or null for a healthy one — a predicate, so it can be TIMED. */
  let breakRecordingOn: ((event: TranscriptEvent) => boolean) | null
  let fakes: Map<string, FakeSessionHandle>

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-memory-host-'))
    recorded = []
    breakRecordingOn = null
    fakes = new Map()
    let counter = 0
    // ⚑ The handle is what a test needs (it carries the simulate* controls) and nothing hands it
    // back, so it is captured on its way out of `start`.
    let pending: FakeSessionHandle | null = null
    host = new RuntimeHost({
      // ⚑ **A recording store rather than the null one**, because the most serious finding this
      // file covers is a row that reached the SINK and not the LEDGER. A test that only reads the
      // sink cannot tell those apart.
      store: {
        ...NULL_SESSION_STORE,
        create: (row: Parameters<typeof NULL_SESSION_STORE.create>[0]) => {
          if (pending !== null) fakes.set(row.id, pending)
          pending = null
          return NULL_SESSION_STORE.create(row)
        },
        append: (_sessionId: string, ordinal: number, event: TranscriptEvent) => {
          // ⚑ **A database that breaks on a NAMED row** (320). `record` catches this, latches
          // `recordingFailure` and publishes a notice that takes an ordinal at SEND time, from
          // wherever it is called — so which row breaks decides which window the notice fires in,
          // and a count would have been too blunt to put it in the one that matters.
          if (breakRecordingOn?.(event)) throw new Error('the disk went away')
          recorded.push({ ordinal, event })
        },
      },
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => {
        const runtime = new FakeRuntime(provider)
        const start = runtime.start.bind(runtime)
        runtime.start = async (...args: Parameters<typeof start>) => {
          const handle = (await start(...args)) as FakeSessionHandle
          pending = handle
          return handle
        }
        return runtime
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
        homeEnv: provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME',
        model: `${provider} config model`,
        authNote: null,
        files: [],
      }),
    })
    sink = new RecordingSink()
  })

  afterEach(async () => {
    // ⛔ **Cleanup FIRST, and in a `finally`** (found reviewing this diff). The guard below is an
    // assertion in a hook, and vitest abandons the rest of a hook at the first throw — so with it
    // written above these two lines a single tripped guard left the `RuntimeHost` registered with a
    // live pump and leaked the temp directory, on exactly the runs where the suite is already
    // failing. Measured, by reverting the fix: **22 leaked `brobot2-memory-host-*` directories and
    // twenty un-torn-down hosts** across two runs.
    try {
      await host.closeAll()
    } finally {
      rmSync(userData, { recursive: true, force: true })
    }
    // ⛔ **Every test in this file is a 320 regression test, for the price of one line.** The
    // ordering rule is not about memory notes — it is about the sink — so it belongs to all of them
    // rather than to one, and a future row that publishes from inside another event's window goes
    // red wherever it happens to be reachable rather than only where somebody thought to look.
    //
    // ⚑ **After the teardown, which is what makes the claim true of the whole file.** `closeAll`
    // ends every session, and a `status: 'ended'` is a turn ending — so a note written after the
    // last `idle` is observed, recorded and delivered during teardown, through the very code this
    // dispatch changed. Read before `closeAll`, this guard could not see a single one of those, and
    // `runFinalize`'s pre-`await` publish — the door {@link RuntimeHost.emit}'s docblock names as
    // the residual hazard — is reached only from there.
    expect(sink.outOfOrderArrival(), 'a message arrived before the one it follows').toBeNull()
  })

  const notesDir = (): string => codexAdHocNotesDir(join(userData, 'provider-homes', 'codex'))

  function writeNote(name: string, text: string): string {
    const dir = notesDir()
    mkdirSync(dir, { recursive: true })
    const path = join(dir, name)
    writeFileSync(path, text)
    return path
  }

  /**
   * Run one turn with a window in the middle of it.
   *
   * ⚑ **`ask` mode on purpose.** The Fake pauses on a permission card, which is a real point inside
   * a real in-flight turn — so the note is written where a note is actually written, rather than
   * before the turn opens or after it has closed. Answering the card lets the machine terminalize
   * and emit the `status: 'idle'` the observation is keyed on.
   */
  /** Every event the ledger really holds, whether or not a window was there to receive it. */
  const appended = (): TranscriptEvent[] => recorded.map((row) => row.event)

  /** The handle driving this session, so a test can end its turn the way a dying child does. */
  const fakeFor = (sessionId: string): FakeSessionHandle => {
    const found = fakes.get(sessionId)
    expect(found, 'no fake handle was captured for ' + sessionId).toBeDefined()
    return found!
  }

  const countOf = (type: string): number =>
    sink.events().filter((event) => event.type === type).length
  const idleCount = (): number =>
    sink.events().filter((event) => event.type === 'status' && event.state === 'idle').length

  async function turnWith(sessionId: string, during: () => void): Promise<void> {
    // ⚠️ **Counted, never "some(...)"** — every wait here is for a NEW event, because this helper
    // runs several turns against one sink and a predicate satisfied by the PREVIOUS turn's card
    // would let the next turn race ahead of its own.
    const cardsBefore = countOf('permission_request')
    const idleBefore = idleCount()
    await host.send(sessionId, 'remember my name', sink)
    await waitFor(
      () => countOf('permission_request') > cardsBefore,
      'the turn to reach its permission card',
    )
    during()
    const card = sink
      .events()
      .filter((event) => event.type === 'permission_request')
      .at(-1)
    await host.respondPermission(sessionId, (card as { id: string }).id, { outcome: 'allow' }, sink)
    await waitFor(() => idleCount() > idleBefore, 'the turn to go idle')
  }

  it('publishes the note that appeared, once, at the end of the turn it appeared in', async () => {
    const created = await host.createSession({ provider: 'codex' }, sink)
    await turnWith(created.sessionId, () => {
      writeNote('2026-09-04T00-00-00-user-name.md', "The user's name is Bob.")
    })

    await waitFor(() => sink.notes().length > 0, 'the memory note to be published')
    const notes = sink.notes()
    expect(notes).toHaveLength(1)
    expect(notes[0]!.notes[0]!.text).toBe("The user's name is Bob.")

    // ⛔ **After the turn that produced it, never before.** A row published ahead of the turn's own
    // ending would sit under the wrong question.
    const types = sink.events().map((event) => event.type)
    expect(types.indexOf('memory_note')).toBeGreaterThan(types.indexOf('assistant_message'))
  })

  it('says it once and not again on the turns that follow', async () => {
    const created = await host.createSession({ provider: 'codex' }, sink)
    await turnWith(created.sessionId, () => {
      writeNote('2026-09-04T00-00-00-user-name.md', "The user's name is Bob.")
    })
    await waitFor(() => sink.notes().length > 0, 'the first note')

    await turnWith(created.sessionId, () => {})
    // ⚠️ The second turn wrote nothing, so the ledger must carry exactly the one row.
    expect(sink.notes()).toHaveLength(1)

    await turnWith(created.sessionId, () => {
      writeNote('2026-09-04T00-01-00-user-full-name.md', "The user's full name is Bob Alicio.")
    })
    await waitFor(() => sink.notes().length > 1, 'the second note')
    const second = sink.notes()[1]!
    expect(second.notes).toHaveLength(1)
    expect(second.notes[0]!.text).toContain('Bob Alicio')
  })

  /**
   * 🔴 **The row is a LEDGER WRITE, and a ledger write does not wait for a window** (found reviewing
   * this dispatch's own diff, and the most serious thing in it).
   *
   * `deliver`'s own rule: *"the ordinal is taken and the row written whether or not anyone is
   * listening… if it only happened while a window was open, closing one would punch holes in the
   * ledger."* ⛔ The observation sat BELOW that gate, so closing the window on a turn that had just
   * written a memory lost the row — and lost it **permanently**, because the next turn retakes the
   * snapshot it would have been measured against.
   */
  it('writes the row even when no window is listening', async () => {
    const created = await host.createSession({ provider: 'codex' }, sink)
    await host.send(created.sessionId, 'remember my name', sink)
    await waitFor(() => countOf('permission_request') > 0, 'the turn to reach its permission card')
    writeNote('2026-09-04T00-00-00-user-name.md', "The user's name is Bob.")
    const card = sink
      .events()
      .filter((event) => event.type === 'permission_request')
      .at(-1)
    // ⚠️ **The window goes away mid-turn**, exactly as closing one does — and every wait from here
    // is on the LEDGER, because the sink is the thing that has stopped existing.
    sink.alive = false
    await host.respondPermission(
      created.sessionId,
      (card as { id: string }).id,
      { outcome: 'allow' },
      sink,
    )
    await waitFor(
      () => appended().some((event) => event.type === 'status' && event.state === 'idle'),
      'the turn to go idle',
    )
    await waitFor(
      () => appended().some((event) => event.type === 'memory_note'),
      'the note to reach the ledger with no window attached',
    )
    // ⛔ Nothing reached the sink — it is dead — so the ledger is the only place that holds it.
    expect(sink.notes(), 'a dead sink still received events').toHaveLength(0)
    const rows = appended().filter(
      (event): event is MemoryNoteEvent => event.type === 'memory_note',
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.notes[0]!.text).toBe("The user's name is Bob.")
  })

  /**
   * ⛔ **A turn can end without ever going idle** (found reviewing this diff). A child that dies
   * mid-turn ends `errored`, and `session-store.ts` already closes the turn row on that status — an
   * observation keyed on `idle` alone is one that is lost exactly when something went wrong.
   */
  it('says what appeared even when the turn ends in an error', async () => {
    const created = await host.createSession({ provider: 'codex' }, sink)
    await host.send(created.sessionId, 'remember my name', sink)
    await waitFor(() => countOf('permission_request') > 0, 'the turn to reach its permission card')
    writeNote('2026-09-04T00-00-00-user-name.md', "The user's name is Bob.")
    fakeFor(created.sessionId).simulateError('the app-server went away', true)
    await waitFor(
      () => sink.events().some((e) => e.type === 'status' && e.state === 'errored'),
      'the turn to end in an error',
    )
    await waitFor(() => sink.notes().length > 0, 'the memory note on the error path')
    expect(sink.notes()[0]!.notes[0]!.text).toBe("The user's name is Bob.")
  })

  /**
   * ⛔ **No turn of ours, no claim about a turn** (found reviewing this diff). Every ending publishes
   * the observation, and an ending can arrive with nothing sent — so the row's sentence, *"between
   * the start and the end of this turn"*, would be measuring from the session's registration.
   * ⚑ The listing is still taken, which is what stops those notes arriving later as a burst.
   */
  it('claims nothing for an ending that no turn of ours opened', async () => {
    const created = await host.createSession({ provider: 'codex' }, sink)
    writeNote('2026-09-04T00-00-00-someone-else.md', 'written by another session')
    fakeFor(created.sessionId).simulateError('nothing to do with a turn', true)
    await waitFor(
      () => sink.events().some((e) => e.type === 'status' && e.state === 'errored'),
      'the session to end',
    )
    expect(sink.notes(), 'a row claimed a turn that never ran').toHaveLength(0)
  })

  /**
   * ⛔ **A note written BETWEEN turns is not this conversation's news** (`318 M2`).
   *
   * A profile is the shared-memory boundary (085), so another session in the same profile writes
   * this very directory. The snapshot retaken at the start of each turn is what confines what this
   * conversation will claim to what happened inside its own turn — and without it the note lands on
   * whatever turn happens to end next, in a chat that had nothing to do with it.
   */
  it('does not claim a note that appeared while no turn of this conversation was running', async () => {
    const created = await host.createSession({ provider: 'codex' }, sink)
    await turnWith(created.sessionId, () => {})
    // Between turns: some other session in this profile remembers something.
    writeNote('2026-09-04T00-00-00-someone-else.md', 'written by another session')
    await turnWith(created.sessionId, () => {})
    expect(sink.notes(), 'a note from between turns was claimed by this one').toHaveLength(0)

    // 193's rule: the same conversation, the same store, one turn later — and a note written
    // INSIDE the turn does produce a row, so the silence above is the rule and not a dead host.
    await turnWith(created.sessionId, () => {
      writeNote('2026-09-04T00-01-00-this-turn.md', 'written during the turn')
    })
    await waitFor(() => sink.notes().length > 0, 'the in-turn note')
    expect(sink.notes()[0]!.notes.map((each) => each.path)).toEqual([
      join(notesDir(), '2026-09-04T00-01-00-this-turn.md'),
    ])
  })

  /**
   * ⛔ **The snapshot advances on every boundary, including the quiet ones** (`318 M3`).
   *
   * A store the agent DELETED from is the case that separates the two: if the name is only forgotten
   * on the turns that published something, a note removed and later written again is never announced
   * a second time — the app would be silently certain it had already said so.
   */
  it('announces a note again after it has been deleted and rewritten', async () => {
    const created = await host.createSession({ provider: 'codex' }, sink)
    const name = '2026-09-04T00-00-00-user-name.md'
    await turnWith(created.sessionId, () => {
      writeNote(name, "The user's name is Bob.")
    })
    await waitFor(() => sink.notes().length > 0, 'the first note')

    // A quiet turn that nevertheless changes the store — the boundary this row is about.
    await turnWith(created.sessionId, () => {
      rmSync(join(notesDir(), name))
    })
    expect(sink.notes()).toHaveLength(1)

    await turnWith(created.sessionId, () => {
      writeNote(name, "The user's name is Bob, again.")
    })
    await waitFor(() => sink.notes().length > 1, 'the rewritten note')
    expect(sink.notes()[1]!.notes[0]!.text).toContain('again')
  })

  /**
   * 🔴 **A store that cannot be listed at the start of a turn does not turn a profile's existing
   * memory into this turn's news** — the interaction the adversarial pass over this diff pointed at.
   *
   * ⛔ `noteNamesIn` answers `null` for a store it could not list, and the reseed then keeps the
   * snapshot it already had. Read as an EMPTY store instead, one unreadable moment at a boundary
   * would publish a year of notes into whatever conversation happened to be open.
   *
   * ⚠️ **What this does NOT prove is which earlier snapshot the fallback came from.** Three writers
   * set it — the registration seed, the `user_turn` reseed, and the quiet resync at every ending —
   * and this test cannot tell them apart, because on a readable store they all agree. That
   * redundancy is measured rather than argued: `318 M3` and `M4` remove two of the three and every
   * test in this repository stays green. See the table for what that means.
   */
  it('falls back to the seed when the store cannot be listed at the start of a turn', async () => {
    writeNote('2026-01-01T00-00-00-old.md', 'written long before this conversation')
    const created = await host.createSession({ provider: 'codex' }, sink)

    const dir = notesDir()
    // Unreadable exactly across the turn's opening listing, readable again inside the turn.
    chmodSync(dir, 0o000)
    const cardsBefore = countOf('permission_request')
    const idleBefore = idleCount()
    await host.send(created.sessionId, 'remember my name', sink)
    await waitFor(() => countOf('permission_request') > cardsBefore, 'the card')
    chmodSync(dir, 0o700)
    writeNote('2026-09-04T00-00-00-new.md', 'written just now')
    const card = sink
      .events()
      .filter((event) => event.type === 'permission_request')
      .at(-1)
    await host.respondPermission(
      created.sessionId,
      (card as { id: string }).id,
      { outcome: 'allow' },
      sink,
    )
    await waitFor(() => idleCount() > idleBefore, 'the turn to go idle')
    await waitFor(() => sink.notes().length > 0, 'the new note')

    const announced = sink.notes()[0]!.notes.map((each) => each.path)
    expect(announced, 'the pre-existing store was announced as this turn’s news').toEqual([
      join(dir, '2026-09-04T00-00-00-new.md'),
    ])
  })

  /**
   * ⛔ **The store a profile already has is not this conversation's news.** Every note here was
   * written before the session existed, and reporting them would put a year of memory into the first
   * turn of a new chat.
   */
  it('never announces what was already in the store when the session opened', async () => {
    writeNote('2026-01-01T00-00-00-old.md', 'written long ago')
    const created = await host.createSession({ provider: 'codex' }, sink)
    await turnWith(created.sessionId, () => {})
    expect(sink.notes()).toHaveLength(0)
    // 193's rule: the negative above passes over a broken host unless the positive does too.
    await turnWith(created.sessionId, () => {
      writeNote('2026-09-04T00-00-00-new.md', 'written just now')
    })
    await waitFor(() => sink.notes().length > 0, 'the new note')
    expect(sink.notes()[0]!.notes.map((each) => each.path)).toEqual([
      join(notesDir(), '2026-09-04T00-00-00-new.md'),
    ])
  })

  /**
   * ⛔ **The gate, at the host rather than at the module.** The other provider's memory writes are
   * already `tool_call` rows naming the file path, so a disk observation beside one would be a
   * second claim about a single act.
   */
  it('watches nothing for a provider whose writes are already reported', async () => {
    const created = await host.createSession({ provider: 'claude' }, sink)
    const claudeNotes = codexAdHocNotesDir(join(userData, 'provider-homes', 'claude'))
    await turnWith(created.sessionId, () => {
      mkdirSync(claudeNotes, { recursive: true })
      writeFileSync(join(claudeNotes, '2026-09-04T00-00-00-x.md'), 'nope')
    })
    expect(sink.notes()).toHaveLength(0)
    // The paired positive: the very same gesture on the watched provider does produce a row, so the
    // silence above is the gate and not a dead turn.
    const codex = await host.createSession({ provider: 'codex' }, sink)
    await turnWith(codex.sessionId, () => {
      writeNote('2026-09-04T00-00-00-x.md', 'yes')
    })
    await waitFor(() => sink.notes().length > 0, 'the codex note')
    expect(sink.notes()).toHaveLength(1)
  })

  /**
   * 🔴 **320 · the row must not overtake the turn that produced it** (friction log F6).
   *
   * ⛔ **This is the test that had to observe ARRIVAL and not the ledger.** `publishMemoryNotes`
   * took the next ordinal and SENT it, from inside `deliver`'s own publish window, so `182` reached
   * the renderer before `181` and the conversation grew two red *"event stream gap"* notices around
   * the card. Everything durable was correct throughout — which is exactly why nothing here caught
   * it, and why the assertion is on `sink.messages` rather than on `recorded`.
   */
  describe('320 · and it arrives after the turn, not before it', () => {
    it('sends the note behind the status that produced it, one ordinal later', async () => {
      const created = await host.createSession({ provider: 'codex' }, sink)
      await turnWith(created.sessionId, () => {
        writeNote('2026-09-04T00-00-00-user-name.md', "The user's name is Bob.")
      })
      await waitFor(() => sink.notes().length > 0, 'the memory note to be published')

      const index = sink.messages.findIndex((message) => message.event.type === 'memory_note')
      const note = sink.messages[index]!
      const before = sink.messages[index - 1]!
      // ⚑ **The event immediately BEFORE it on the wire is the turn ending it belongs to** — not
      // some later event that got there first, which is what "expected 183, got 181" was.
      expect(before.event.type).toBe('status')
      expect(before.event).toMatchObject({ state: 'idle' })
      expect(note.ordinal).toBe(before.ordinal + 1)
    })

    /**
     * 🔴 **The second disorder GENERALISED past memory notes — and this test exists because a
     * mutation row was a phantom survivor without it.**
     *
     * ⛔ `320 M5` swaps the two statements in `emitOurs`, so the recording-failure notice is
     * published BEFORE the row it was recording. It survived the whole desktop suite: the only
     * always-throwing append double in the repository never reaches a `publishOurs` path, and the
     * one test that does reach it filters its sink by event type, so a reversed wire order was
     * invisible. ⚑ A row that survives is a row that protects nothing, and the honest repair is a
     * test rather than a paragraph excusing it.
     *
     * ⚠️ **A `user_decision`, not a memory note.** The note path goes through `deliver` and is
     * already covered below; this is the app-authored path every turn, every button and every queued
     * message goes through, and it is where the disorder stops being about memory at all.
     */
    it('reports a broken ledger after the app-authored row it was recording, not before it', async () => {
      const created = await host.createSession({ provider: 'codex' }, sink)
      const cardsBefore = countOf('permission_request')
      await host.send(created.sessionId, 'remember my name', sink)
      await waitFor(
        () => countOf('permission_request') > cardsBefore,
        'the turn to reach its permission card',
      )
      // The disk goes away on the row `respondPermission` itself publishes.
      breakRecordingOn = (event) => event.type === 'user_decision'
      const card = sink
        .events()
        .filter((event) => event.type === 'permission_request')
        .at(-1)
      await host.respondPermission(
        created.sessionId,
        (card as { id: string }).id,
        { outcome: 'allow' },
        sink,
      )
      await waitFor(
        () => sink.events().some((event) => event.type === 'error'),
        'the recording-failure notice',
      )

      expect(sink.outOfOrderArrival()).toBeNull()
      // ⚑ **The positive half** (193): the decision really went out, and the notice really came
      // after it. A run where nothing broke satisfies the negative above on its own.
      const kinds = sink.events().map((event) => event.type)
      expect(kinds).toContain('user_decision')
      expect(kinds.indexOf('error')).toBeGreaterThan(kinds.indexOf('user_decision'))
    })

    /**
     * 🔴 **The SECOND disorder, which no screenshot showed and nobody had looked for.**
     *
     * ⚠️ **Found by doing what §4.1 asked** — enumerating every caller that can publish from inside
     * another event's window — rather than by reproducing what was reported. `reportRecordingFailure`
     * takes its ordinal at SEND time, and it used to fire from inside `publishOurs` while `deliver`
     * still held the status unsent. On a turn-ending status where the database has just broken, the
     * wire therefore went **182, 183, 181**: a three-event disorder on the one path where the app is
     * already telling you it has stopped recording, which is the worst possible moment to also be
     * telling you it lost your stream.
     *
     * ⛔ The `afterEach` guard would catch this on its own; it is spelled out here because a shape
     * nobody was looking for deserves a test that says what it is.
     */
    it('reports a broken ledger AFTER the events it was recording, not between them', async () => {
      const created = await host.createSession({ provider: 'codex' }, sink)
      const cardsBefore = countOf('permission_request')
      await host.send(created.sessionId, 'remember my name', sink)
      await waitFor(
        () => countOf('permission_request') > cardsBefore,
        'the turn to reach its permission card',
      )
      writeNote('2026-09-04T00-00-00-user-name.md', "The user's name is Bob.")
      // ⛔ **The disk goes away on the turn's own ending**, which is what puts the failure notice
      // inside `deliver`'s publish window rather than in some earlier one. Timed on the event, not
      // on a row count: `respondPermission` appends first, and breaking there would latch the
      // notice before the boundary and never reach the shape this test is about.
      breakRecordingOn = (event) => event.type === 'status' && event.state === 'idle'
      const card = sink
        .events()
        .filter((event) => event.type === 'permission_request')
        .at(-1)
      await host.respondPermission(
        created.sessionId,
        (card as { id: string }).id,
        { outcome: 'allow' },
        sink,
      )
      await waitFor(
        () => sink.events().some((event) => event.type === 'error'),
        'the recording-failure notice',
      )

      expect(sink.outOfOrderArrival()).toBeNull()
      // ⚑ **The positive half, and it is what makes the negative mean anything** (193): a run where
      // nothing broke and nothing was remembered satisfies `outOfOrderArrival` on its own. All three
      // events of the compound have to be present, in this order, for it to have been measured.
      const tail = sink.messages.slice(-3)
      expect(tail.map((message) => message.event.type)).toEqual(['status', 'memory_note', 'error'])
      expect(tail.map((message) => message.ordinal)).toEqual([
        tail[0]!.ordinal,
        tail[0]!.ordinal + 1,
        tail[0]!.ordinal + 2,
      ])
      expect(tail[2]!.event).toMatchObject({
        message: expect.stringContaining('no longer being recorded'),
      })
    })
  })
})

/**
 * ⛔ **What a REPLAYED row may hand the renderer** (`318 M10`, and `216` §2's rule).
 *
 * ⚑ This is the first app-authored event that carries file CONTENT, so it is the first one where an
 * edited ledger row — or one written by a later build — could put a megabyte on screen. The bound
 * runs on the way out of the database, and this is the only place that can see it.
 */
describe('318 · a memory note is bounded on the way back out of the ledger', () => {
  it('keeps the row, cuts what is oversized, and lets no undeclared key ride along', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-memory-replay-')))
    const db = openDatabase(join(dir, 'db.sqlite'))
    applyMigrations(db, migrationsDir)
    const store = createSessionStore(db)
    store.create({ id: 'sess_m', provider: 'codex', cwd: dir, approvalMode: 'ask', profileId: 'd' })

    // ⛔ **The malformed entries lead the payload**, which is `216`'s own lesson: behind forty valid
    // ones, a `slice` with the filter deleted still produced a clean list and satisfied everything.
    const malformed = [
      { path: 'x'.repeat(9000), bytes: 1, text: 'too long a path' },
      { path: 42, bytes: 1, text: 'not a path at all' },
      { path: '', bytes: 1, text: 'no path' },
    ]
    const valid = Array.from({ length: MEMORY_NOTES_PER_EVENT + 20 }, (_, index) => ({
      path: `/homes/codex/memories/extensions/ad_hoc/notes/n${index}.md`,
      bytes: 3,
      text: 'ok',
    }))
    store.append('sess_m', 0, { type: 'memory_note', notes: [...malformed, ...valid] } as never, 1)
    store.append(
      'sess_m',
      1,
      {
        type: 'memory_note',
        notes: [
          {
            path: '/homes/codex/memories/extensions/ad_hoc/notes/big.md',
            bytes: -5,
            text: 'y'.repeat(MEMORY_NOTE_TEXT_CAP + 4000),
            blob: 'z'.repeat(5000),
          },
        ],
      } as never,
      2,
    )

    const replayed = store.events('sess_m').map(({ event }) => event as MemoryNoteEvent)
    // Exactly the cap, not merely under it, and the survivors are the VALID ones in order — which
    // is false for every bound that slices before it filters.
    expect(replayed[0]!.notes).toHaveLength(MEMORY_NOTES_PER_EVENT)
    expect(replayed[0]!.notes.map((each) => each.path)).toEqual(
      valid.slice(0, MEMORY_NOTES_PER_EVENT).map((each) => each.path),
    )

    const big = replayed[1]!.notes[0]!
    expect(big.text!.length).toBe(MEMORY_NOTE_TEXT_CAP)
    // ⛔ Re-derived rather than trusted: the stored row claimed nothing about truncation, and this
    // side cut it, so the row must say so or it presents a cut file as a whole one.
    expect(big.truncated).toBe(true)
    // ⛔ **A nonsense size is DROPPED, never read as zero** — `0 B` on a row is a measurement, and
    // the field is optional exactly so a size nobody took is absent rather than invented (074).
    expect(big.bytes).toBeUndefined()
    // ⛔ CONSTRUCTED, never spread: an undeclared key cannot ride the payload into the renderer.
    expect(Object.keys(big).sort()).toEqual(['path', 'text', 'truncated'])
    // ⛔ **And the cap does not go silent on the way OUT.** The stored row claimed 21 notes and this
    // side kept 20; a bound that cut one without saying so is 092 §4's defect on the replay path.
    expect(replayed[0]!.dropped, 'the replay cap went silent').toBe(
      malformed.length + valid.length - MEMORY_NOTES_PER_EVENT,
    )

    // ⚑ The paired positive: a well-formed row is replayed untouched, or "bounded" would be
    // indistinguishable from "always discards".
    store.append(
      'sess_m',
      2,
      {
        type: 'memory_note',
        notes: [
          { path: '/homes/codex/memories/extensions/ad_hoc/notes/ok.md', bytes: 3, text: 'hi' },
        ],
      } as never,
      3,
    )
    expect((store.events('sess_m')[2]!.event as MemoryNoteEvent).notes).toEqual([
      { path: '/homes/codex/memories/extensions/ad_hoc/notes/ok.md', bytes: 3, text: 'hi' },
    ])
    db.close()
  })
})

/**
 * ⚑ **318 §2.3's two halves, read off the source** — the idiom `conversation-chrome.test.ts` uses
 * for exactly this component, for the reason it gives: chrome is the part of a UI that gets verified
 * by eye, so every rule that CAN be a checked string is one.
 *
 * ⛔ **What this can and cannot see, stated rather than implied — and the first draft of this
 * sentence overstated it.** It can see that the handler body assigns `true`, chooses the `info` tab
 * and never toggles, and that the Info hint names memory.
 *
 * ⚠️ **It cannot see that the handler is REACHED.** The dom test proves the first two hops —
 * `MemoryNoteEntry` → `TranscriptView` → `ConversationPane` raises `showInstructions` on a real
 * click — and stops there: nothing in this repository mounts `RuntimeScreen`, so the last hop,
 * `ConversationPane`'s event arriving at this handler, is checked by an unanchored string search and
 * by nothing else. ⛔ Saying *"the dom test covers the wiring"* was the kind of claim `074` is
 * about, and it was written here before it was true. It is the honest gap of this pair of
 * instruments, and it is left open rather than papered over.
 */
describe('318 §2.3 · the gesture SETS the drawer and the tab hint names memory', () => {
  it('the show-instructions handler opens the drawer rather than flipping it', () => {
    const screen = rendererSource('components/RuntimeScreen.vue')
    const at = screen.indexOf('@show-instructions=')
    expect(at, 'RuntimeScreen no longer handles the request').toBeGreaterThan(-1)
    // The handler body, up to the closing quote of the attribute value.
    const body = screen.slice(at, screen.indexOf('"', screen.indexOf('"', at) + 1) + 1)
    expect(body).toContain('drawerOpen = true')
    expect(body).toContain("drawerTab = 'info'")
    // ⛔ The defect this replaces: a flip shuts the drawer for anyone who already had it open.
    expect(body).not.toContain('!drawerOpen')
    // ⛔ **The slice is checked STRUCTURALLY, never against a magic length** (`313`'s lesson: a
    // derived guard that truncates early fails OPEN, and a number tuned to today's comment would
    // fail CLOSED the next time somebody explains themselves). It must start at the attribute and
    // end at the attribute's own closing quote — and be a small fraction of the file, so a slice
    // that ran to the end of `RuntimeScreen.vue` cannot satisfy the `toContain`s above by accident.
    expect(body.startsWith('@show-instructions="')).toBe(true)
    expect(body.endsWith('"')).toBe(true)
    expect(body.length).toBeLessThan(screen.length / 10)
  })

  it('the Info tab says it holds what the profile remembers', () => {
    const drawer = rendererSource('lib/drawer.ts')
    const info = drawer.slice(drawer.indexOf("id: 'info'"), drawer.indexOf("id: 'changes'"))
    expect(info).toContain('remembers')
    // Paired: the slice really is the Info entry and really does carry a hint.
    expect(info).toContain('hint:')
    expect(info).toContain('Paths, the profile')
  })
})
