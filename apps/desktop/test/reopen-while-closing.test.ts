import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime, type AgentRuntime, type SessionHandle } from '@brobot2/runtime'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * **Reopening a conversation the app has just called closed** (075, from 072 §5.3).
 *
 * Live smoke step 18 failed 2/2 in batch #3 and again on re-run here, with the app's own sentence:
 *
 * ```
 * timed out waiting for the resumed session — the screen says status= sessions=0 events=0
 * error="session is already open: sess_16c09777-…"
 * ```
 *
 * ⚠️ **It is not a race between two users.** It is one user doing the only thing the app offers
 * them, and it looks like a race only because the two halves disagree about when a conversation is
 * over:
 *
 *  - `runFinalize`'s FIRST step is `stopProvider`, and closing the handle is what emits
 *    `session:'ended'` + `status:'ended'`. The renderer moves the record to `ended` on that event,
 *    which drops it from the open list and offers it under Reopen — `session-store.ts` says exactly
 *    that: *"the terminal event comes back on the stream and moves the record to `ended`, which
 *    drops it from the open list — the reopen list is where it shows up next"*.
 *  - the slot is released by `runFinalize`'s LAST step, after the drain, `store.terminate` and the
 *    **archive** — the slow one, and the one that grows with the conversation.
 *
 * Between those two moments the app offered a button it would refuse, naming a state it had already
 * told the user was over. The smoke waited for the row to leave the open list — the wait 066 added
 * for precisely this — and that wait is satisfied at the FIRST of the two moments.
 *
 * 📌 **It is not 070's**, and the wording proves it rather than an argument: 070's refusal reads
 * `cannot be reopened: its provider has not confirmed it stopped`, and comes from the launch
 * registry *after* the slot is gone. What the batch and this file observe is `session is already
 * open` — `reserve`'s own slot check, 062-era, guarding a window `runFinalize` has had since 051.
 * 070 narrowed the neighbouring hole; it did not open this one.
 *
 * ⚠️ **Why the teardown is GATED here rather than made slow.** The real window is held open by the
 * archive, whose duration is a property of the machine and the conversation. A test that raced it
 * would pass or fail on how fast this disk is, and — as the first draft of this file proved by
 * doing it — would go green by the window closing before the assertion, having measured nothing.
 * The gate makes the same window explicit and exact: the terminal event is out, the teardown is
 * demonstrably still running, and the test decides when it finishes.
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

/** The renderer's rule, in one line: `ended` on the stream is what drops it from the open list. */
function saidClosed(sink: RecordingSink): boolean {
  return sink.messages.some(
    (message) => message.event.type === 'status' && message.event.state === 'ended',
  )
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  throw new Error(`timed out waiting for ${what}`)
}

describe('a conversation the app has said is closed can be reopened (075, from 072 §5.3)', () => {
  let dir: string
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  /** Held shut until a test opens it, so the teardown outlives the terminal event on purpose. */
  let gate: { promise: Promise<void>; resolve: () => void }
  /** Every handle the host was given, so a test can end a stream from the PROVIDER's side. */
  let handles: SessionHandle[]
  /**
   * Every RESUME the host actually asked a provider for (265 §1).
   *
   * ⚠️ Counted at the adapter, not off `handles`: what 265 §1 is about is a provider being STARTED
   * for a document that has gone, and the only honest place to observe that is the call itself.
   */
  let resumed: string[]

  /**
   * A handle that announces the ending and then keeps tearing down — the real order, where the
   * provider says the thread is over well before this app has finished putting it away. A Proxy,
   * for `process-ownership.test.ts`'s reason: the Fake's state lives in own fields its own methods
   * mutate, so anything that re-homes `this` quietly stops being the session under test.
   */
  function gateClose(handle: SessionHandle): SessionHandle {
    const proxied: SessionHandle = new Proxy(handle, {
      get(target, property) {
        if (property === 'close') {
          return async (): Promise<void> => {
            await target.close() // emits session:'ended' + status:'ended'
            await gate.promise
          }
        }
        const value = Reflect.get(target, property, target) as unknown
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value
      },
    })
    handles.push(proxied)
    return proxied
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-reopen-'))
    userData = join(dir, 'userData')
    mkdirSync(userData, { recursive: true })
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    gate = deferred()
    handles = []
    resumed = []
    const runtimes = new Map<string, FakeRuntime>()
    let counter = 0
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      exportDirectory: () => join(dir, 'exports'),
      nativeTranscriptPath: () => null,
      // One runtime per provider, remembered: the Fake only resumes a ref it ISSUED, so a fresh
      // instance per call would fail every reopen for a reason that has nothing to do with the
      // window under test.
      createRuntime: (provider): AgentRuntime => {
        const real = runtimes.get(provider) ?? new FakeRuntime(provider)
        runtimes.set(provider, real)
        return {
          provider,
          listModels: (context) => real.listModels(context),
          start: async (options) => gateClose(await real.start(options)),
          resume: async (ref, options) => {
            resumed.push(ref.sessionId)
            return gateClose(await real.resume(ref, options))
          },
        }
      },
      prepareProviderHome: (provider, profileId) =>
        join(userData, 'provider-homes', 'default', profileId, provider),
      providerHomePath: (provider, profileId) =>
        join(userData, 'provider-homes', 'default', profileId, provider),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      closeDrainTimeoutMs: 5_000,
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
    gate.resolve() // never leave a teardown wedged, or the quit below waits out its own bound
    await host.closeAll()
    if (db.open) db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  async function openOne(sink: RecordingSink): Promise<string> {
    const { sessionId } = await host.createSession(
      { provider: 'claude', cwd: join(dir, 'work') },
      sink,
    )
    return sessionId
  }

  it('reopens a conversation whose teardown is still running, instead of refusing it', async () => {
    const first = new RecordingSink('owner:1')
    const sessionId = await openOne(first)

    // Close it, and do NOT await the teardown — the renderer does not either. It reacts to the
    // terminal event, which is what this waits for: the instant the app has said this conversation
    // is over, and the instant the Reopen button appears for it.
    const closing = host.close(sessionId, first)
    await waitFor(() => saidClosed(first), 'the app to say the conversation ended')

    // ⚠️ **Non-vacuity, and it is the whole reason the assertion below means anything.** The window
    // is genuinely open right here: the app has told the user it is closed, and the slot that will
    // refuse the reopen is still held. Without this line the test would pass just as well against a
    // window that had already shut, which is exactly how the first draft of it went green.
    expect(host.sessionIds).toContain(sessionId)

    // The click. Before 075 this threw `session is already open` — about a conversation the same
    // app had just moved into the Reopen list. It now waits for the teardown it named.
    const reopening = host.resumeSession(sessionId, new RecordingSink('owner:2'))
    gate.resolve()

    await expect(reopening).resolves.toMatchObject({ sessionId })
    await closing
  })

  it('waits the same way for a session that ended on its OWN, which never sets the phase', async () => {
    // ⚠️ **The second door onto the same defect**, and it is the one a dying provider uses.
    // `slot.phase` becomes `closing` only inside `close()`; a stream that ends by itself reaches
    // `finalize()` from the pump's `finally` and never touches the phase. The renderer cannot tell
    // the two apart — same terminal event, same drop from the open list, same Reopen offered — so a
    // guard keyed on the phase would have waited for the conversations a user closed and refused
    // the ones that died. This is why `settleTeardown` asks whether a TEARDOWN is running.
    const first = new RecordingSink('owner:1')
    const sessionId = await openOne(first)
    const slots = (host as unknown as { slots: Map<string, { phase: string }> }).slots
    expect(slots.get(sessionId)?.phase).toBe('live')

    // End the stream from the PROVIDER's side rather than calling `host.close()`.
    const handle = handles.at(-1)
    if (!handle) throw new Error('no handle to end the stream on')
    const ending = handle.close().catch(() => {})
    await waitFor(() => saidClosed(first), 'the app to say the conversation ended')

    // The phase is untouched — which is precisely why the old guard would have missed it.
    expect(slots.get(sessionId)?.phase).toBe('live')

    const reopening = host.resumeSession(sessionId, new RecordingSink('owner:2'))
    gate.resolve()
    await expect(reopening).resolves.toMatchObject({ sessionId })
    await ending
  })

  /**
   * 🔴 **265 §1 · a reopen suspended on a teardown outlives the document that asked for it**
   * (259 lens B finding 1 — the reviewer's own *"if I get exactly one fix, I fix this"*).
   *
   * ⛔ **The wait 075 added is placed before the reservation 100 relies on.** `resumeSession` awaits
   * `settleTeardown` first, and for the whole of that wait the host holds nothing bound to the
   * asking window. `closeSessionsForOwner` — the release handler for a reload, a renderer crash or a
   * destroyed window — snapshots `slots` ONCE and closes what it saw; a reopen that has not reserved
   * yet is not in that snapshot and there is nothing to rescan for. The teardown then settles, the
   * stale IPC continuation reserves the id and starts a provider **for a document that no longer
   * exists**: a real agent running with no surface that initiated it or can reliably control it.
   *
   * ⚠️ **The owner id is the SAME across the reload, deliberately.** Sink identity is
   * `webContents:<id>` and `alive` asks only whether the `WebContents` was destroyed — a reload
   * replaces the document while keeping both. So a fix that re-checked `sink.alive` after the wait
   * would pass this test's setup and still ship the defect; what is checked is the release event.
   */
  it('🔴 265 §1 · a reopen whose window is released mid-wait starts no provider', async () => {
    const first = new RecordingSink('webContents:7')
    const sessionId = await openOne(first)
    const resumesBefore = resumed.length

    // 1 · the terminal event is out, so the old document offers Reopen — while the teardown runs on.
    const closing = host.close(sessionId, first)
    await waitFor(() => saidClosed(first), 'the app to say the conversation ended')
    expect(host.sessionIds).toContain(sessionId) // non-vacuity: the window really is open

    // 2 · the old document presses Reopen. Main suspends inside `settleTeardown`, holding no slot
    //     for this invocation.
    const reopening = host.resumeSession(sessionId, new RecordingSink('webContents:7'))
    reopening.catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(resumed.length, 'still suspended — the provider has not been asked').toBe(resumesBefore)

    // 3 · the document reloads. `did-navigate` releases the slots this owner had; the replacement
    //     document performs its one-time attach and correctly receives nothing.
    const released = host.closeSessionsForOwner(first.ownerId)
    const replacement = new RecordingSink('webContents:7')
    expect(host.attachOpenSessions(replacement)).toEqual([])

    // 4 · the old teardown settles. Before 265 the suspended continuation reserved the id here and
    //     resumed a provider into the replaced document's generation.
    gate.resolve()
    await expect(reopening).rejects.toThrow(/window that asked for this conversation went away/)
    await released
    await closing
    expect(resumed.length, 'no provider was resumed for a document that no longer exists').toBe(
      resumesBefore,
    )
    expect(host.sessionIds).toEqual([])
  })

  it('⚑ …and the same reopen succeeds when the window does NOT go away', async () => {
    // ⛔ **The pairing, and without it the test above passes for a build that simply refuses every
    // reopen that had to wait** — which is the behaviour 075 exists to have removed. Same gesture,
    // same suspended wait, no release: it reopens.
    const first = new RecordingSink('webContents:7')
    const sessionId = await openOne(first)
    const closing = host.close(sessionId, first)
    await waitFor(() => saidClosed(first), 'the app to say the conversation ended')

    const reopening = host.resumeSession(sessionId, new RecordingSink('webContents:7'))
    gate.resolve()
    await expect(reopening).resolves.toMatchObject({ sessionId })
    await closing
  })

  it('⚑ 652 · …and a reopen with NO surface is not refused by that release — it had nobody to lose', async () => {
    // ⛔ **The 265 §1 gesture above, with one fact changed: the reopen names no sink.** Same close,
    // same suspended wait, the SAME window released mid-wait. 🔴 **The two must diverge**: a
    // window's reopen is refused because the document that asked for it is gone; a reopen with no
    // surface registered no owned wait, so the departure of a window it never belonged to cannot
    // reach it. ⚠️ Without the window case above, this would pass over a fence that refuses
    // nothing at all — the pair is what makes each half mean something.
    const first = new RecordingSink('webContents:7')
    const sessionId = await openOne(first)
    const resumesBefore = resumed.length
    const closing = host.close(sessionId, first)
    await waitFor(() => saidClosed(first), 'the app to say the conversation ended')

    const reopening = host.resumeSession(sessionId, null)
    reopening.catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(resumed.length, 'still suspended — the provider has not been asked').toBe(resumesBefore)
    const released = host.closeSessionsForOwner(first.ownerId)

    gate.resolve()
    await expect(reopening).resolves.toMatchObject({ sessionId, startedWithoutAWindow: true })
    await released
    await closing
    expect(resumed.length, 'the provider WAS resumed, for nobody in particular').toBe(
      resumesBefore + 1,
    )
    // ⚑ And it is reserved under NOBODY — unwatched, as a spawn is. ⚠️ Not *because* of the release:
    // that ran while the reopen held no slot at all, so it could not have taken it either way.
    expect(host.unclaimedSessions().map((entry) => entry.sessionId)).toEqual([sessionId])
  })

  it('⚑ …and a release for a DIFFERENT window does not touch it', async () => {
    // The mark is per owner. A second window closing must not refuse the first window's reopen —
    // that would be the fix over-reaching into 062's territory, where two surfaces are two owners.
    const first = new RecordingSink('webContents:7')
    const sessionId = await openOne(first)
    const closing = host.close(sessionId, first)
    await waitFor(() => saidClosed(first), 'the app to say the conversation ended')

    const reopening = host.resumeSession(sessionId, new RecordingSink('webContents:7'))
    reopening.catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 10))
    await host.closeSessionsForOwner('webContents:99')

    gate.resolve()
    await expect(reopening).resolves.toMatchObject({ sessionId })
    await closing
  })

  it('does not hand back a conversation that is on its way out', async () => {
    // ⚠️ **The reconciliation must not undo a teardown** (100). `attachOpenSessions` walks the same
    // slots `reserve` refuses from, and a session whose provider is stopping would be handed to a
    // window that then holds a handle already refusing messages — and, worse, would reappear in the
    // rail moments after the app said it had ended. The two doors are watched, not just `phase`:
    // this one goes through `close()`, and the companion below through a stream ending on its own.
    const owner = new RecordingSink('owner:1')
    const sessionId = await openOne(owner)
    // ⚠️ **Attached with the session's OWN sink, and that matters** — a successful attach rebinds
    // `session.sink` to whoever asked, so probing with a throwaway sink here would quietly divert
    // this session's stream to an object nobody reads and the wait below would never see the
    // terminal event. Handing the surface its own session back is the real gesture anyway.
    expect(host.attachOpenSessions(owner)).toHaveLength(1) // non-vacuity

    const closing = host.close(sessionId, owner)
    await waitFor(() => saidClosed(owner), 'the app to say the conversation ended')

    // The slot is still held right here — that is the whole window 075 is about — and it is still
    // not something to hand over. A refused attach also leaves the sink alone: the guards all run
    // before the swap.
    expect(host.sessionIds).toContain(sessionId)
    expect(host.attachOpenSessions(owner)).toEqual([])

    gate.resolve()
    await closing
  })

  it('still refuses a second window a conversation that is genuinely OPEN', async () => {
    // `settleTeardown` must not have loosened the reservation: nothing is closing here, so the
    // answer is the refusal 062 wrote, in the same words the rest of the app matches on.
    const sessionId = await openOne(new RecordingSink('owner:1'))

    // ⚠️ **The id is gone from the sentence, and that is the assertion** (100). The raw diagnostic
    // — which still names the id, the holder and the asker — goes to the log; what reaches a caller
    // is a sentence with nothing internal in it. Both halves are checked: the id must not be there,
    // and the sentence must say which window to go to, or it is a refusal with no way forward.
    const refused = await host
      .resumeSession(sessionId, new RecordingSink('owner:2'))
      .then(() => null)
      .catch((error: unknown) => (error as Error).message)

    expect(refused).toBe(
      'This conversation is already open in another window. Switch to that window to carry on with it.',
    )
    expect(refused).not.toContain(sessionId)
  })

  it('hands a conversation back to the surface that already owns it, instead of refusing it', async () => {
    // ⛔ The report 100 exists for: *"I wanted to resume the previous conversation. I got: session
    // is already open."* Measured on the reporter's own instance — the host held a live, registered
    // session with its provider child still running, while the renderer showed "Nothing running"
    // and offered the conversation under Reopen. Same owner, so this is that window asking for its
    // own session back.
    const owner = new RecordingSink('owner:1')
    const sessionId = await openOne(owner)
    const before = handles.length

    const attached = await host.resumeSession(sessionId, new RecordingSink('owner:1'))

    expect(attached.sessionId).toBe(sessionId)
    // ⚠️ **Nothing was resumed.** No provider was asked for, which is the line 070 draws — the whole
    // subject of that dispatch is never putting two providers on one transcript, and an attach that
    // spawned would be exactly that with a friendlier name.
    expect(handles).toHaveLength(before)
    expect(host.sessionIds).toEqual([sessionId])
  })

  it('says "still closing" rather than "already open" when the teardown outlives the wait', async () => {
    // The refusal has to survive, because going around a live teardown is what puts two providers
    // on one transcript. What changes is the sentence: it now names the state the app is in.
    //
    // ⚠️ **Reached the way a person reaches it**, not by writing the state in: Close pressed while
    // the provider was still starting, against a handshake that never answers. The slot stays
    // `closing` with no session — `whyNotOurs` is what keeps it that way, deliberately — so the
    // bounded wait expires with the reservation still held. This also covers `settleTeardown`'s
    // other branch, the one that routes to `awaitArrival`.
    let asked = false
    const never = new Promise<never>(() => {})
    const stuck = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      exportDirectory: () => join(dir, 'exports'),
      nativeTranscriptPath: () => null,
      createRuntime: (provider): AgentRuntime => ({
        provider,
        listModels: () => Promise.resolve([]),
        start: () => {
          asked = true
          return never
        },
        resume: () => never,
      }),
      prepareProviderHome: (provider, profileId) =>
        join(userData, 'provider-homes', 'default', profileId, provider),
      providerHomePath: (provider, profileId) =>
        join(userData, 'provider-homes', 'default', profileId, provider),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => 'sess_stuck',
      closeDrainTimeoutMs: 20,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'programmatic',
        authNote: null,
        files: [],
      }),
    })
    const sink = new RecordingSink()
    void stuck.createSession({ provider: 'claude', cwd: join(dir, 'work') }, sink).catch(() => {})
    await waitFor(() => asked, 'the provider to be asked for')
    const reserved = 'sess_stuck'
    await stuck.close(reserved, sink)

    // 🔴 **716 · `710` F-5 — and a REOPEN is told it waited, and how to wait longer** (rule 8.4):
    // the sentence said *"Try again in a moment"* until `716`.
    // ⚑ **D-017b · in the words of the one gesture that carries a conversation on** — a message
    // sent from its view — and with no process fact (`05` rule 5): *"still closing … its agent to
    // stop"* became what BroBot has not finished putting away.
    await expect(stuck.resumeSession(reserved, new RecordingSink('owner:2'))).rejects.toThrow(
      "BroCrew was still putting away this conversation's last session and waited as long as it will, so your message did not go in. To wait longer, send it your message again.",
    )
    // …and NOT the sentence it used to give, which sent the reader looking for a session to close.
    await expect(stuck.resumeSession(reserved, new RecordingSink('owner:2'))).rejects.not.toThrow(
      'already open',
    )
    // …nor the id, which is 100's half of this: the diagnostic keeps it, the sentence does not.
    await expect(stuck.resumeSession(reserved, new RecordingSink('owner:2'))).rejects.not.toThrow(
      reserved,
    )
  })
})
