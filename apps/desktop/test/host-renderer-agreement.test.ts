import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore as createLedger, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { messageNamingItsSender, THE_PERSON_AT_A_WINDOW } from '../src/main/runtime/turn-origin'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { createSessionStore } from '../src/renderer/src/lib/session-store'
// ⚑ **623 · the clause, imported** — this negative is about a session handed from one window's store
// to another's, which is `HO-095` §2's own hypothesis, and it was aimed at a word the app no longer
// uses. See `session-record.ts`.
import { NOT_REACHED_THIS_WINDOW } from '../src/renderer/src/lib/session-record'
import { NOTHING_TO_SEND } from '../src/shared/runtime-ipc'
import type {
  RuntimeBridge,
  RuntimeCommand,
  RuntimeEventMessage,
  SessionLivenessMessage,
} from '../src/shared/runtime-ipc'
import { everythingOverTheWire } from './lib/the-wire'
import { withoutWhatThisAppAdds } from './lib/what-this-app-adds'

/**
 * # The host and the renderer may not disagree about what is running (100 §3)
 *
 * ⛔ The report: *"I wanted to resume the previous conversation. I got: session is already open:
 * sess_53d78fdf-…"* — while the rail beside it said *"Nothing running. Start one above, or reopen
 * one below."* **The renderer said closed and the host said open.**
 *
 * `099` made four RENDERER surfaces agree by mounting them side by side and failing if any two
 * answered differently. This is that idea one layer down, across the process boundary: the real
 * `RuntimeHost`, the real renderer store, and the real `executeRuntimeCommand` between them — the
 * same function `ipcMain.handle` calls — with nothing faked but the provider and the clock.
 *
 * ## What was measured, and why the test is shaped like this
 *
 * The renderer's list of open conversations is memory of what THIS store started. Vite's HMR
 * disposes that store and builds another whenever a module it depends on is edited — clearing the
 * map, and telling the main process nothing, because a module dispose raises none of
 * `SESSION_RELEASE_EVENTS`. On the reporting instance: 373 modules carrying hot-update timestamps,
 * the last six minutes before the button was pressed, and a document that had never navigated.
 *
 * So the loss is modelled the way it happens — **dispose the store and build a new one** — rather
 * than by reaching in and emptying a map. A test that emptied the map would pass against a fix that
 * only repaired maps.
 */

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

/** One renderer surface: the sink the host writes to, and the bridge the store reads through. */
class Surface {
  readonly sink: RuntimeEventSink
  private readonly events: ((message: RuntimeEventMessage) => void)[] = []
  private readonly liveness: ((message: SessionLivenessMessage) => void)[] = []
  /** Every command this surface sent, so a test can assert which ones a store actually makes. */
  readonly commands: string[] = []

  constructor(
    private readonly host: RuntimeHost,
    readonly ownerId = 'webContents:1',
  ) {
    const events = this.events
    const liveness = this.liveness
    this.sink = {
      ownerId,
      aPersonIsBehindIt: false,
      get alive() {
        return true
      },
      send: (message) => events.forEach((listener) => listener(message)),
      sendLiveness: (message) => liveness.forEach((listener) => listener(message)),
    }
  }

  /**
   * The bridge, over the REAL command dispatcher.
   *
   * Everything goes through `executeRuntimeCommand`, so the zod schema, the command union and the
   * host method are all exercised — a store method calling a host method the wire would have
   * rejected is exactly the kind of disagreement this file is about.
   */
  bridge(): RuntimeBridge {
    const run = async <T>(command: RuntimeCommand): Promise<T> => {
      this.commands.push(command.kind)
      return (await executeRuntimeCommand(this.host, this.sink, command)) as T
    }
    // `Partial` so the members are contextually typed by the real interface — an `as unknown as`
    // over a bare literal would type every parameter `any` and let a command drift from its schema
    // silently, which is the one thing a test wired through the real dispatcher exists to catch.
    // The methods these tests do not reach are simply absent; reaching one is a TypeError at the
    // call site rather than a plausible empty answer.
    const bridge: Partial<RuntimeBridge> = {
      createSession: (input) => run({ kind: 'createSession', ...input }),
      resume: (input) => run({ kind: 'resume', ...input }),
      // ⚑ **D-017b** — a record whose fold ends, or that this window lets go, is looked at again.
      look: (input) => run({ kind: 'look', ...input }),
      attachOpen: () => run({ kind: 'attachOpen' }),
      send: (input) => run({ kind: 'send', ...input }),
      // ⛔ **All three send verbs, because they share one schema and only one of them was ever
      // driven through it** (221 §1). `220` reached `send` and reported the wire refusing an
      // attachment-only message; `sendInterrupting` and `queueMessage` carry the identical `text`
      // rule and nothing had ever crossed this boundary with either.
      sendInterrupting: (input) => run({ kind: 'sendInterrupting', ...input }),
      queueMessage: (input) => run({ kind: 'queueMessage', ...input }),
      close: (input) => run({ kind: 'close', ...input }),
      onEvent: (fn) => {
        this.events.push(fn)
        return () => void this.events.splice(this.events.indexOf(fn), 1)
      },
      onLiveness: (fn) => {
        this.liveness.push(fn)
        return () => void this.liveness.splice(this.liveness.indexOf(fn), 1)
      },
    }
    // 🔴 **Through the wire as well as through the dispatcher** (361 §2). This double already runs
    // the real `executeRuntimeCommand`, so the schema and the host method are exercised — but a
    // direct call hands the payload over by reference, and `ipcRenderer.invoke` does not.
    return everythingOverTheWire(bridge) as RuntimeBridge
  }
}

describe('the host and the renderer cannot disagree about what is running (100)', () => {
  let dir: string
  let db: AppDatabase
  let ledger: SessionStore
  let host: RuntimeHost

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-agreement-')))
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrations)
    ledger = createLedger(db)
    let counter = 0
    host = new RuntimeHost({
      store: ledger,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(dir, 'exports'),
      createRuntime: (provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider) => join(dir, 'homes', provider),
      providerHomePath: (provider) => join(dir, 'homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
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
    await host.closeAll()
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  /** What the host is running, and what the renderer says is running — the two answers, compared. */
  const hostSays = (): string[] => [...host.sessionIds].sort()
  // ⚑ **D-017b · `live`** — the conversations this window is fed the events of (it was `open`).
  const rendererSays = (store: { live: { value: { sessionId: string }[] } }): string[] =>
    store.live.value.map((record) => record.sessionId).sort()

  it('reproduces the disagreement, so the assertion below is over something real', async () => {
    // ⚠️ **The non-vacuity pair.** Without this, the agreement test that follows would pass just as
    // well against a build where nothing was ever open — 23 vacuous tests have been found in this
    // slice, and a "these two lists match" assertion over two empty lists is the classic one.
    const surface = new Surface(host)
    const first = createSessionStore(surface.bridge())
    await first.create({ provider: 'claude', cwd: join(dir, 'work') })

    expect(hostSays()).toHaveLength(1)
    expect(rendererSays(first)).toEqual(hostSays())

    // The loss, modelled the way HMR causes it: this store is disposed and another is built.
    first.dispose()
    const second = createSessionStore(surface.bridge())

    // Plant a host-running conversation unknown to the renderer before pressing Reopen.
    expect(hostSays()).toHaveLength(1)
    expect(rendererSays(second)).toEqual([])
    second.dispose()
  })

  it('a store built after the old one was disposed agrees with the host again', async () => {
    const surface = new Surface(host)
    const first = createSessionStore(surface.bridge())
    const sessionId = await first.create({ provider: 'claude', cwd: join(dir, 'work') })
    await first.create({ provider: 'codex', cwd: join(dir, 'work') })
    first.dispose()

    const second = createSessionStore(surface.bridge())
    const taken = await second.attachOpen()

    // The property: one answer about what is running, on both sides of the boundary.
    expect(rendererSays(second)).toEqual(hostSays())
    // …over two conversations, not zero, and it named them rather than merely counting.
    expect(hostSays()).toHaveLength(2)
    expect(taken.sort()).toEqual(hostSays())
    expect(taken).toContain(sessionId)
    second.dispose()
  })

  it('gives the reopen button something to do instead of a sentence to show', async () => {
    // Press Reopen on that row to recover without restarting.
    const surface = new Surface(host)
    const first = createSessionStore(surface.bridge())
    const sessionId = await first.create({ provider: 'claude', cwd: join(dir, 'work') })
    if (sessionId === null) throw new Error('the session did not start')
    first.dispose()

    const second = createSessionStore(surface.bridge())
    const opened = await second.resume(sessionId)

    expect(opened).toBe(sessionId)
    // ⚠️ The negative is the report: this is where `session is already open: sess_…` used to land.
    expect(second.resumeError.value).toBeNull()
    expect(second.launchError.value).toBeNull()
    expect(rendererSays(second)).toEqual(hostSays())
    second.dispose()
  })

  it('pressing Reopen on a live conversation does not declare everything in it finished', async () => {
    // ⚠️ **Found in review, and it is the worst bug this change could have shipped.** The Reopen
    // button calls `store.resume`, which applied `markReopened` unconditionally — settling every
    // pending card, clearing the activity, stopping the sub-agents and closing the open tool calls,
    // on the stated ground that *"the only true one on reopen is that nothing is running"*. True of
    // a recording; false of a session the host just handed back, which never stopped. So the exact
    // gesture 100 exists to enable would have attached a running conversation and then drawn it as
    // finished — with the agent still sitting there waiting for a click that no longer worked.
    //
    // The renderer cannot tell the two apart by looking, so the host says which: `handover`.
    const surface = new Surface(host)
    const first = createSessionStore(surface.bridge())
    const sessionId = await first.create({ provider: 'claude', cwd: join(dir, 'work') })
    if (sessionId === null) throw new Error('the session did not start')
    await first.send(sessionId, 'ask me something')
    const pendingIn = (store: ReturnType<typeof createSessionStore>) =>
      (store.get(sessionId)?.transcript.items ?? []).find((item) => item.kind === 'permission')
    // Non-vacuity: there has to BE a question waiting for "it is still answerable" to mean anything.
    await vi.waitFor(() => {
      expect(pendingIn(first)).toBeDefined()
    })
    expect(pendingIn(first)).toMatchObject({ outcome: null })
    first.dispose()

    const second = createSessionStore(surface.bridge())
    expect(await second.resume(sessionId)).toBe(sessionId)

    const card = pendingIn(second)
    expect(card).toBeDefined()
    // Still unanswered and still answerable — no settled note, no outcome written by the reopen.
    expect(card).toMatchObject({ outcome: null })
    expect(card && 'note' in card && card.note).toBeFalsy()
    // …and the epoch that would settle it on the next re-fold was not written either.
    expect(second.get(sessionId)?.liveFrom).toBeNull()
    second.dispose()
  })

  it('carries the conversation with it, not just the row', async () => {
    // An attach that produced an empty transcript would satisfy every list comparison above and be
    // useless: the whole point is to get the conversation back.
    const surface = new Surface(host)
    const first = createSessionStore(surface.bridge())
    const sessionId = await first.create({ provider: 'claude', cwd: join(dir, 'work') })
    if (sessionId === null) throw new Error('the session did not start')
    await first.send(sessionId, 'the message that must survive')
    await vi.waitFor(() => {
      expect(ledger.nextOrdinal(sessionId)).toBeGreaterThan(1)
    })
    first.dispose()

    const second = createSessionStore(surface.bridge())
    await second.attachOpen()

    const record = second.get(sessionId)
    expect(record).not.toBeNull()
    expect(JSON.stringify(record?.transcript.items)).toContain('the message that must survive')
    second.dispose()
  })

  it('sends the events that arrive AFTER the attach to the store that took it over', async () => {
    // The seam. The history is read and the sink is swapped in one synchronous block, so an event
    // is either in the page or delivered live — never both, and never neither.
    const surface = new Surface(host)
    const first = createSessionStore(surface.bridge())
    const sessionId = await first.create({ provider: 'claude', cwd: join(dir, 'work') })
    if (sessionId === null) throw new Error('the session did not start')
    first.dispose()

    const second = createSessionStore(surface.bridge())
    await second.attachOpen()
    await second.send(sessionId, 'after the hand-over')

    await vi.waitFor(() => {
      expect(JSON.stringify(second.get(sessionId)?.transcript.items)).toContain(
        'after the hand-over',
      )
    })
    // ⚠️ **ONCE.** The session's pump is started at registration and an attach must not start a
    // second one — every event would then be forwarded twice, which the ordinal check would report
    // as a gap rather than as a duplicate, sending a reader after the wrong bug entirely.
    // Counted on the USER item specifically: the fake agent echoes what it was sent, so a naive
    // text match finds two legitimately and would have hidden a genuine duplicate.
    const said = (second.get(sessionId)?.transcript.items ?? []).filter(
      (item) => item.kind === 'user' && String(item.text).includes('after the hand-over'),
    )
    expect(said).toHaveLength(1)
    expect(
      (second.get(sessionId)?.transcript.items ?? []).some(
        (item) => item.kind === 'notice' && item.text.includes(NOT_REACHED_THIS_WINDOW),
      ),
    ).toBe(false)
    second.dispose()
  })

  it('does not resurrect the sessions a real reload just released', async () => {
    // ⚠️ **The one way this change could have made things worse.** A window that genuinely goes
    // away — reloaded, navigated, crashed — has its sessions closed by `installSessionRelease`, and
    // the document that loads next now asks the host what it is running. If those two raced, a
    // reload would hand back the conversations it had just ended.
    //
    // They cannot: `close()` sets `phase = 'closing'` synchronously, and `closeSessionsForOwner`
    // maps over the slots before its first `await`, so every phase is marked in the same tick the
    // release handler runs — which is before the new document's scripts execute at all. This pins
    // that ordering rather than trusting it, because it is an argument about two files.
    const surface = new Surface(host)
    const before = createSessionStore(surface.bridge())
    await before.create({ provider: 'claude', cwd: join(dir, 'work') })
    before.dispose()

    const released = host.closeSessionsForOwner(surface.ownerId) // not awaited: the renderer is not
    const after = createSessionStore(surface.bridge())

    expect(await after.attachOpen()).toEqual([])
    expect(rendererSays(after)).toEqual([])
    after.dispose()
    await released
  })

  it('does not take a session that belongs to a different window', async () => {
    // 062's rule, at the boundary: attaching is for the surface that already owns the session.
    const owner = new Surface(host, 'webContents:1')
    const other = new Surface(host, 'webContents:2')
    const mine = createSessionStore(owner.bridge())
    await mine.create({ provider: 'claude', cwd: join(dir, 'work') })

    const theirs = createSessionStore(other.bridge())
    expect(await theirs.attachOpen()).toEqual([])
    expect(rendererSays(theirs)).toEqual([])
    // …and the host still holds it for the window that started it.
    expect(hostSays()).toHaveLength(1)
    mine.dispose()
    theirs.dispose()
  })

  it('takes a session that was already streaming into the new store before it asked', async () => {
    // ⚠️ **This case was found by a test, in the first version of this change, and it was silent.**
    // A record exists from the moment an event arrives — the bridge listener calls `slot()` to hold
    // events that beat the host's answer — and the skip guard asked `isOpen` (`isLive` since
    // D-017b), which was true of that
    // half-built record. So a conversation busy enough to emit anything while the store was being
    // built was skipped as "already ours" and stayed invisible: the exact symptom, reached by the
    // exact mechanism, through the fix meant to prevent it.
    const surface = new Surface(host)
    const first = createSessionStore(surface.bridge())
    const sessionId = await first.create({ provider: 'claude', cwd: join(dir, 'work') })
    if (sessionId === null) throw new Error('the session did not start')
    first.dispose()

    const second = createSessionStore(surface.bridge())
    // An event lands BEFORE the reconciliation — the ordinary case for a session mid-turn.
    //
    // ⚠️ **This ordinal is deliberately far outside the real ledger, and so this test does NOT
    // cover the overlap** (review sweep). What it pins is the SKIP GUARD: that a half-record built
    // from a buffered event does not make `attachOpen` walk past the session. The other half — an
    // event that is in the buffer *and* in the replayed page, which is what really happens when a
    // busy session is handed over — is pinned in `session-store.test.ts`, *"does not fold an event
    // twice when it is both buffered and in the replayed page"*, where the ordinals can be made to
    // overlap on purpose.
    surface.sink.send({
      sessionId,
      ordinal: 9_000,
      at: 1,
      event: { type: 'assistant_delta', text: 'still going' },
    })
    expect(second.get(sessionId)).not.toBeNull() // the half-record `isOpen` once said yes to
    expect(rendererSays(second)).toEqual([]) // …and which the rail correctly does not show

    // ⚠️ **172 changed WHAT DOES THE ASKING here, and the property this test is about is
    // unchanged.** The buffered event is now itself the trigger — a record with no `meta` is a
    // conversation this window is receiving and cannot draw — so by the time anything asks
    // explicitly, the session has already been taken. The skip guard is still what is under test:
    // if it regressed to `isLive`, the automatic pass would walk past this half-record for exactly
    // the reason the explicit one did, and the rail below would stay empty.
    await vi.waitFor(() => {
      expect(rendererSays(second)).toEqual(hostSays())
    })
    // …and an explicit call after it is a no-op rather than a second fold.
    expect(await second.attachOpen()).toEqual([])
    second.dispose()
  })

  it('does not fold the same session twice when the store already has it', async () => {
    // The ordinary case on every load after the first: `attachOpen` answers about a session this
    // store started itself. Re-folding it would double every event in the transcript.
    const surface = new Surface(host)
    const store = createSessionStore(surface.bridge())
    const sessionId = await store.create({ provider: 'claude', cwd: join(dir, 'work') })
    if (sessionId === null) throw new Error('the session did not start')
    const before = store.get(sessionId)?.transcript.items.length ?? -1

    expect(await store.attachOpen()).toEqual([])

    expect(store.get(sessionId)?.transcript.items).toHaveLength(before)
    expect(rendererSays(store)).toEqual(hostSays())
    store.dispose()
  })

  /**
   * 172 · **a session the host acquired AFTER this store was built.**
   *
   * A conversation started through IPC after store construction cannot be discovered by a
   * one-time `attachOpen()` reconciliation. A measured case had two host conversations but
   * one rail row: the second, on `developer`, began nine and a half minutes after navigation.
   * Replaying both hand-overs adopts both, so the missing update occurs before the rail’s
   * projection.
   *
   * ⚠️ **The profile was a coincidence, and saying so is half the finding.** The bridge is the only
   * door that skips the store, and the PM used it because `167`'s profile selector did not exist
   * when they made that session. Measured on my own instance: a `devx` session started through the
   * LAUNCHER reaches the rail, twice — once creating the profile, once picking it.
   */
  describe('a conversation started behind this store (172)', () => {
    /** The PM's gesture: `window.api.runtime.createSession`, which never touches the store. */
    const onTheBridge = async (
      surface: Surface,
      input: { profileId?: string } = {},
    ): Promise<string> => {
      const created = await surface.bridge().createSession({
        provider: 'claude',
        cwd: join(dir, 'work'),
        ...input,
      })
      return created.sessionId
    }

    it('⛔ reaches the rail without a reload — and carries its profile with it', async () => {
      const surface = new Surface(host)
      const store = createSessionStore(surface.bridge())
      // The store’s initial reconciliation is correctly empty because the conversation starts
      // nine and a half minutes later.
      expect(await store.attachOpen()).toEqual([])
      expect(rendererSays(store)).toEqual([])

      // …and now the conversation is started behind it, and takes a turn. Every event lands in THIS
      // window's sink, because this window is what asked for the session.
      const sessionId = await onTheBridge(surface, { profileId: 'developer' })
      await surface.bridge().send({ sessionId, text: 'the turn the rail never saw' })

      await vi.waitFor(() => {
        expect(rendererSays(store)).toEqual(hostSays())
      })
      expect(rendererSays(store)).toEqual([sessionId])
      // ⚠️ Not an empty shell with the right id: the conversation came with it.
      expect(JSON.stringify(store.get(sessionId)?.transcript.items)).toContain(
        'the turn the rail never saw',
      )
      // ⛔ **`developer`, not `default`.** The drawer, the rail's label and the resume path all read
      // this, and 167 §0 already found one place that coalesced a null profile to `default`.
      expect(store.get(sessionId)?.meta?.profileId).toBe('developer')
      // ⛔ **One extra round trip for the whole conversation.** The trigger is an event for a
      // session with no record, and those arrive at streaming rate — a question per event would be
      // a request storm, each answer carrying every open conversation's history window with it.
      // The `1` counted here is the reconciliation this session caused; the `attachOpen()` above is
      // the store's own, which is why the comparison is against the count taken after it.
      expect(surface.commands.filter((kind) => kind === 'attachOpen')).toHaveLength(2)
      store.dispose()
    })

    it('⚠️ asks once for a session it turns out NOT to own, and then stops asking', async () => {
      // The other end of the bound. A window can be handed an event for a session the host will not
      // give it — 062's refusal is one way, an ended session is another — and the reconciliation
      // must not become a retry loop over a question already answered.
      const owner = new Surface(host, 'webContents:1')
      const other = new Surface(host, 'webContents:2')
      const mine = createSessionStore(owner.bridge())
      const sessionId = await mine.create({ provider: 'claude', cwd: join(dir, 'work') })
      if (sessionId === null) throw new Error('the session did not start')

      const theirs = createSessionStore(other.bridge())
      for (let ordinal = 9_000; ordinal < 9_010; ordinal++) {
        other.sink.send({
          sessionId,
          ordinal,
          at: 1,
          event: { type: 'assistant_delta', text: 'not yours' },
        })
      }
      await vi.waitFor(() => {
        expect(other.commands.filter((kind) => kind === 'attachOpen')).toHaveLength(1)
      })
      // …and the refusal held: the window that does not own it still does not show it.
      expect(rendererSays(theirs)).toEqual([])
      expect(rendererSays(mine)).toEqual([sessionId])
      mine.dispose()
      theirs.dispose()
    })

    it('🔴 hands back a live session the PROVIDER has not named yet — 172’s second layer', async () => {
      // ⛔ **Measured live, and it is why the renderer fix alone did nothing.** With the store
      // asking, the answer was still `[]`: `attachHeldSession` looked its session up with
      // `store.find`, whose first line drops any row whose `external_ref` is null — and a Claude
      // session has no ref until its first turn's init. So the host refused to hand back a
      // conversation it was at that moment streaming events for, and every window that lost its
      // list during a first turn — including the HMR case 100 was built for — could not get it back.
      //
      // ⚠️ **The arrangement is a `UPDATE`, and it has to be.** `store.create` writes no ref at all;
      // the ref lands when the provider's `session` event does. `FakeRuntime` names its conversation
      // in the same tick it starts one, so the state every real Claude session spends its first turn
      // in is not reachable through the double. This is that row, exactly as `create` leaves it.
      const surface = new Surface(host)
      const first = createSessionStore(surface.bridge())
      const sessionId = await first.create({
        provider: 'claude',
        cwd: join(dir, 'work'),
        profileId: 'developer',
      })
      if (sessionId === null) throw new Error('the session did not start')
      first.dispose()
      db.prepare('update provider_session set external_ref = null where id = ?').run(sessionId)

      // The conflation, named: one row, two questions, and only one of them is about resuming.
      expect(ledger.find(sessionId)).toBeNull()
      expect(ledger.findLive(sessionId)).toMatchObject({
        profileId: 'developer',
        approvalMode: 'ask',
        ref: null,
      })

      const second = createSessionStore(surface.bridge())
      expect(await second.attachOpen()).toEqual([sessionId])
      expect(rendererSays(second)).toEqual(hostSays())
      // …and it came back as itself: the profile is the recorded one, and the ref is the LIVE
      // handle's — `session.handle.ref ?? row.ref`, which is the reason the row's ref was never the
      // thing this path needed, and the reason a null one must not cost it the profile beside it.
      expect(second.get(sessionId)?.meta?.profileId).toBe('developer')
      expect(second.get(sessionId)?.meta?.ref?.sessionId).toBe('fake_claude_1')
      // …and the mode it was created with came back as a RECORDED fact rather than as today's
      // default. `discloseReopened` says *"chosen now; how this session originally ran was never
      // recorded"* when the row does not know, and a lookup that dropped the column would put that
      // sentence on a session whose mode is written down two fields away.
      // The approved 0.1.3 disclosure uses the same Ask/Auto names as the panel and header.
      expect(second.get(sessionId)?.meta?.approvalNote).toBe('approvals: Ask')
      second.dispose()

      // ⚠️ **And a ref this build cannot READ costs the row nothing either.** `toResumable` drops
      // the whole row when the ref will not parse — right for resume, which has nothing to reattach
      // from — and the same rule here would take the profile and the mode of a RUNNING session with
      // it, for a column the hand-over does not read.
      db.prepare('update provider_session set external_ref = ? where id = ?').run(
        'not-a-ref',
        sessionId,
      )
      expect(ledger.find(sessionId)).toBeNull()
      expect(ledger.findLive(sessionId)).toMatchObject({ profileId: 'developer', ref: null })
    })

    it('⛔ a store built after the old one was disposed lists a NON-DEFAULT profile session', async () => {
      // ⚠️ **This is what "survives a reload" can honestly mean, and the ticket's premise needs
      // correcting** (measured, on my own instance): a real reload raises `did-navigate`, which
      // RELEASES this window's sessions — the rail is empty afterwards because the conversations
      // are closed, not because they were dropped. The path that survives a lost list is the one
      // 100 built for HMR and the one every reconnect takes: the store goes, the host does not, and
      // the next store asks. The profile has to come back through it intact.
      const surface = new Surface(host)
      const first = createSessionStore(surface.bridge())
      const sessionId = await first.create({
        provider: 'claude',
        cwd: join(dir, 'work'),
        profileId: 'developer',
      })
      if (sessionId === null) throw new Error('the session did not start')
      first.dispose()

      const second = createSessionStore(surface.bridge())
      expect(await second.attachOpen()).toEqual([sessionId])
      expect(rendererSays(second)).toEqual(hostSays())
      expect(second.get(sessionId)?.meta?.profileId).toBe('developer')
      second.dispose()
    })
  })

  /**
   * # ⛔ A message with no words and something attached (221 §1)
   *
   * `220` — the Exploration Agent — dropped a file on the launcher, typed nothing, pressed the
   * bright enabled Send button and got **`invalid runtime command: text: Too small: expected string
   * to have >=1 characters`**. No turn, raw schema language on screen, and an empty conversation row
   * left behind. It called that one gesture the reason it would not adopt the app.
   *
   * ⚠️ **Every layer but one agreed the send was legal.** `canSend` allows it (216 — *"an
   * attachment is content too"*), the renderer store lets it through, `RuntimeHost.send` composes
   * it, and `messageWithHandedPaths` has a branch written for exactly the no-words case. One line
   * between them — `ipc.ts`'s `text: z.string().min(1)`, written in `077` when a message could only
   * BE words — refused what both ends accept.
   *
   * ⛔ **Nothing caught it because nothing had ever driven the gesture across this boundary.**
   * `session-store.test.ts`'s `fakeBridge` records every send verbatim and validates nothing, so the
   * red-flagged *"an ATTACHMENT-ONLY message is sent, not swallowed"* test asserted the exact
   * behaviour that was broken in production, and passed. This file is the instrument that could have
   * caught it — the real store, the real `executeRuntimeCommand`, the real host — and it had never
   * been pointed at a message with no words. It is now, on all three send verbs: `220` reached only
   * `send`, and the other two carry the identical rule.
   */
  describe('the wire accepts what both ends accept (221 §1)', () => {
    /** A real file, because `recheckHandedPaths` stats it again at the send (216 §3). */
    function attach(name = 'notes.md'): { path: string; kind: 'file'; outsideCwd: false }[] {
      const work = join(dir, 'work')
      mkdirSync(work, { recursive: true })
      const path = join(work, name)
      writeFileSync(path, 'the token is PAPERCLIP-221\n')
      return [{ path, kind: 'file', outsideCwd: false }]
    }

    /** What the PROVIDER was handed, read off the ledger — the composed string, not the caption. */
    function saidToProvider(sessionId: string): string[] {
      return db
        .prepare('select payload from events where session_id = ? and type = ? order by ordinal')
        .all(sessionId, 'assistant_message')
        .map((row) =>
          // The message, without the block this app adds at its end.
          withoutWhatThisAppAdds(
            JSON.parse(String((row as { payload: string }).payload)).text as string,
          ),
        )
    }

    /** What the LEDGER kept as the person's own turn — deliberately a different string (216). */
    function typedByHand(
      sessionId: string,
    ): { text: string; attachments?: unknown[]; sent?: string }[] {
      return db
        .prepare('select payload from events where session_id = ? and type = ? order by ordinal')
        .all(sessionId, 'user_turn')
        .map((row) => JSON.parse(String((row as { payload: string }).payload)))
    }

    it('🔴 sends a message with no words at all, and the provider gets the path', async () => {
      const surface = new Surface(host)
      const store = createSessionStore(surface.bridge())
      const sessionId = await store.create({ provider: 'claude', cwd: join(dir, 'work') })
      if (sessionId === null) throw new Error('the session did not start')
      const attachments = attach()

      // ⛔ **The gesture, exactly as `220` made it**: empty box, one thing staged, Send.
      expect(await store.send(sessionId, '', 'now', attachments)).toBe(true)
      // …and it is `ok`, not a swallowed no-op: the error the wire used to raise landed here.
      expect(store.get(sessionId)?.error).toBeNull()

      // The provider was spoken to, and what it was handed is the sender's line and the labelled
      // block — no leading blank line, and nothing pretending a person typed WORDS they did not.
      //
      // 🔴 **607 · the first line is new and the assertion was re-aimed, not relaxed.** ⛔ A window
      // is a person (`HO-088` §4), so an attachment-only turn now says who sent it before it says
      // what they attached. ⚠️ **And this is the one composed string in the tree where BroBot uses
      // TWO words for one human** — *a person* here and *the user* two lines down — which 607
      // reported rather than repaired, because `handed-path.ts` is nobody's file in that dispatch.
      const echoed = saidToProvider(sessionId)
      expect(echoed).toHaveLength(1)
      // ⚠️ The path is QUOTED since 232 §2 — a filename cannot end the record it is written in.
      expect(echoed[0]).toBe(
        // ⚑ **611 · the frame is composed THROUGH the product** (HO-088 §4.1) — it gained the
        // direction line beside the sender line, and a literal here would pass while the product
        // said something else.
        `echo: ${messageNamingItsSender(
          `Attached by the user, for you to read with your own tools:\n- file: ${JSON.stringify(
            attachments[0]!.path,
          )}`,
          THE_PERSON_AT_A_WINDOW,
        )}`,
      )

      // ⚑ **And the LEDGER kept the person's turn as what they actually did** (216): no words, one
      // path. The two strings differ on purpose, and a fix that composed the block into `text`
      // would pass the assertion above and fail this one.
      // ⚑ **F093 · R2 — and the block lives in `sent`**, the whole text the provider was handed.
      const typed = typedByHand(sessionId)
      expect(typed.map(({ sent, ...row }) => (void sent, row))).toEqual([
        { type: 'user_turn', text: '', attachments, humanInitiated: true },
      ])
      expect(typed[0]?.sent).toContain('Attached by the user')
      store.dispose()
    })

    it('🔴 …and so do the other two send verbs, which nobody had ever measured', async () => {
      // ⛔ `220` reached `send`. `sendInterrupting` and `queueMessage` carry the IDENTICAL text rule
      // in the same schema, and no test on either side of the boundary had ever sent one with an
      // empty message. Both were broken in exactly the same way and for the same reason.
      const surface = new Surface(host)
      const store = createSessionStore(surface.bridge())
      // ⚠️ **`auto`, and only because the QUEUED half needs the first turn to actually end.**
      // `FakeRuntime`'s representative turn raises a permission card and waits on the broker, so
      // under `ask` the session never returns to idle and a queued message is correctly held
      // forever — which would make this a test of the card rather than of the schema.
      const sessionId = await store.create({
        provider: 'claude',
        cwd: join(dir, 'work'),
        approvalMode: 'auto',
      })
      if (sessionId === null) throw new Error('the session did not start')

      expect(await store.send(sessionId, '', 'interrupt', attach('one.md'))).toBe(true)
      expect(await store.send(sessionId, '', 'queue', attach('two.md'))).toBe(true)
      expect(store.get(sessionId)?.error).toBeNull()

      expect(surface.commands).toContain('sendInterrupting')
      expect(surface.commands).toContain('queueMessage')
      // ⚠️ **Waited for, because the second one is genuinely LATER.** The interrupting send starts
      // a turn, so the queue request arrives at a working session and is held (077) until the idle
      // that ends it. Asserting straight through would be asserting that queueing is not queueing.
      await vi.waitFor(() => expect(typedByHand(sessionId)).toHaveLength(2))
      // Both landed as turns of their own, with the path each carried and no words on either.
      expect(typedByHand(sessionId).map((turn) => turn.text)).toEqual(['', ''])
      expect(saidToProvider(sessionId).map((said) => said.split('- file: ')[1])).toEqual([
        JSON.stringify(join(dir, 'work', 'one.md')),
        JSON.stringify(join(dir, 'work', 'two.md')),
      ])
      store.dispose()
    })

    it('⚑ …and a message with NOTHING in it is still refused, on all three', async () => {
      // ⚠️ **THE PAIRED NEGATIVE, and it is what keeps `077`'s rule alive.** *"An empty message is
      // no more sendable for having waited"* was right; what made it wrong was only that an
      // attachment can now BE the content. Nothing plus nothing is still nothing, and the wire —
      // not the composer — is what has to say so, because the composer is not the only caller.
      const surface = new Surface(host)
      const store = createSessionStore(surface.bridge())
      const sessionId = await store.create({ provider: 'claude', cwd: join(dir, 'work') })
      if (sessionId === null) throw new Error('the session did not start')

      for (const kind of ['send', 'sendInterrupting', 'queueMessage'] as const) {
        await expect(
          executeRuntimeCommand(host, surface.sink, { kind, sessionId, text: '   ' }),
        ).rejects.toThrow(NOTHING_TO_SEND)
        // …and with an EMPTY attachment list, which is the shape the store would build if its own
        // early-out were removed — the refusal may not depend on the key being absent.
        await expect(
          executeRuntimeCommand(host, surface.sink, { kind, sessionId, text: '', attachments: [] }),
        ).rejects.toThrow(NOTHING_TO_SEND)
      }
      // Nothing reached the provider, and nothing was written down as a turn.
      expect(saidToProvider(sessionId)).toEqual([])
      expect(typedByHand(sessionId)).toEqual([])
      store.dispose()
    })
  })
})

// ⚑ **D-017b · the Read press (`readRecorded`, 119) is gone** — with its door, `libraryEntry`: a
// recorded row opens in its one full view (`RuntimeScreen.openConversation` → `store.look`), which
// reads one conversation's ledger and never the library.
