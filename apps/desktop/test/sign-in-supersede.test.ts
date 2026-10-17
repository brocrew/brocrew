import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime, type SessionHandle } from '@brobot2/runtime'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { NULL_SESSION_STORE, createSessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import type {
  RuntimeEventMessage,
  SessionLiveness,
  SessionLivenessMessage,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * 147 · A session that follows the machine account — the host half.
 *
 * **The ruling these tests pin, so a later reader does not have to reconstruct it.** The machine
 * credential moving means this child is holding one the machine has moved on from. The only route to
 * a new one is a new child, and the app does NOT take that route on a person's behalf when they are
 * the one asking: a resume settles every open card, forgets this session's `sessionGrants`, and
 * cannot carry `ultracode` at all. So the person's turn is refused, the state is published, and they
 * press the button. ⚑ What is already held for the conversation is not thrown away: this app
 * reopens it on the current sign-in once nothing would be lost. What is asserted here is that the
 * refusal lands at the turn boundary and *only* at the turn boundary — nothing is interrupted,
 * nothing is closed, and nothing is thrown away.
 */

class RecordingSink implements RuntimeEventSink {
  // 349 · this double stands in for a WINDOW — the tests below answer for a person through it.
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  readonly liveness: SessionLiveness[] = []
  alive = true

  constructor(readonly ownerId = 'owner:1') {}

  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }

  sendLiveness(message: SessionLivenessMessage): void {
    this.liveness.push(message.liveness)
  }

  events(): TranscriptEvent[] {
    return this.messages.map((message) => message.event)
  }

  types(): string[] {
    return this.events().map((event) => event.type)
  }
}

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/**
 * A stand-in for the adapter's own credential watch, with the same two properties that matter: it
 * LATCHES, and looking costs something (so the count tells us where the host looks).
 *
 * ⚠️ **`check` is asynchronous, like the thing it stands in for** (149). The real one shells out to
 * `security`, and 148 H4 is that it used to do so on the calling thread; a synchronous double could
 * not catch a host that awaited it in the wrong place — or failed to await it at all.
 */
class Watch {
  moved = false
  latched = false
  looks = 0
  /** Set to have the credential move DURING an interrupt — the 148 M1 window, on demand. */
  movesOnInterrupt = false
  /** Set to have a reopen read the current sign-in, as a reopen after one change does. */
  reopenReadsCurrent = false

  async check(): Promise<boolean> {
    this.looks++
    if (this.moved) this.latched = true
    return this.latched
  }
}

/** `FakeRuntime`, with every handle it hands out wired to `watch` (Codex-shaped handles have none). */
class WatchedRuntime extends FakeRuntime {
  constructor(
    provider: Parameters<typeof FakeRuntime.prototype.start> extends never
      ? never
      : ConstructorParameters<typeof FakeRuntime>[0],
    private readonly watch: Watch,
    /** ⚑ What the provider issued, shared by every runtime of a test, so a reopen can resume. */
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }

  private wire<T extends SessionHandle>(handle: T): T {
    Object.defineProperty(handle, 'signInSuperseded', {
      get: () => this.watch.latched,
      configurable: true,
    })
    Object.defineProperty(handle, 'checkSignIn', {
      value: async () => this.watch.check(),
      configurable: true,
    })
    // The 148 M1 fixture: `sendInterrupting` checks, then awaits an interrupt — for at most the
    // host's interrupt wait since 709 — and up to five seconds of `waitForIdle` before it sends. This is what puts a credential move inside that window.
    const interrupt = handle.interrupt.bind(handle)
    Object.defineProperty(handle, 'interrupt', {
      value: async () => {
        if (this.watch.movesOnInterrupt) this.watch.moved = true
        return interrupt()
      },
      configurable: true,
    })
    return handle
  }

  override async start(
    ...args: Parameters<FakeRuntime['start']>
  ): ReturnType<FakeRuntime['start']> {
    return this.wire(await super.start(...args))
  }

  override async resume(
    ...args: Parameters<FakeRuntime['resume']>
  ): ReturnType<FakeRuntime['resume']> {
    if (this.watch.reopenReadsCurrent) {
      this.watch.moved = false
      this.watch.latched = false
    }
    return this.wire(await super.resume(...args))
  }
}

describe('147 — a turn is not taken on a sign-in that has been replaced', () => {
  let userData: string
  let db: AppDatabase
  let host: RuntimeHost
  let sink: RecordingSink
  let watch: Watch

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-signin-'))
    watch = new Watch()
    const sessions = new FakeProviderSessions()
    let counter = 0
    // ⚠️ **A real (temp-file) ledger, because the reconnect tests need one** (149).
    // `attachHeldSession` refuses to hand back a session whose ROW it cannot find — a live session
    // with no row should be impossible, so it declines rather than inventing one — and the null store
    // finds nothing. With it, the 148 H5 tests would have passed over an attach that never happened.
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    host = new RuntimeHost({
      store: createSessionStore(db),
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider) => new WatchedRuntime(provider, watch, sessions),
      prepareProviderHome: (provider) => join(userData, 'provider-homes', provider),
      providerHomePath: (provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    sink = new RecordingSink()
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  async function session(): Promise<string> {
    const created = await host.createSession({ provider: 'claude' }, sink)
    return created.sessionId
  }

  /**
   * What a renderer that has lost its list is handed back (100) — the reload path, by its own name.
   *
   * The same call `SessionStore.attachOpen` makes when a window is built, including the one Vite's
   * HMR builds after disposing the last. Used here both to reconnect and to ask what a session
   * currently discloses, because that is exactly what a surface reads.
   */
  function handedBack(sessionId: string, into: RecordingSink) {
    return host.attachOpenSessions(into).find((handed) => handed.sessionId === sessionId) ?? null
  }

  /** The turn `FakeRuntime` parks on a permission card — a session with a card genuinely open. */
  async function sessionOnACard(): Promise<string> {
    const id = await session()
    await host.send(id, 'the first thing', sink)
    await waitFor(() => sink.types().includes('permission_request'), 'the card the turn parks on')
    return id
  }

  const userTurns = (): number => sink.events().filter((event) => event.type === 'user_turn').length

  /**
   * The words went in once, on the life this app reopened, and never on the one before: the reopen
   * happened, and no turn was taken on the old life after the `turnsBefore` it already had.
   */
  const wentInOnlyAfterTheReopen = (turnsBefore: number): void => {
    const types = sink.types()
    const reopenedAt = types.indexOf('reopened')
    expect(reopenedAt, 'this app reopened it').toBeGreaterThanOrEqual(0)
    expect(
      types.slice(0, reopenedAt).filter((type) => type === 'user_turn'),
      'no turn on the old life',
    ).toHaveLength(turnsBefore)
    expect(types.slice(reopenedAt).filter((type) => type === 'user_turn')).toHaveLength(1)
  }

  /**
   * A conversation this app reopened for what it held, whose reopened life holds a moved sign-in too
   * (every handle's watch stays latched): the loop guard, where a person's words are refused.
   */
  async function aReopenThatDidNotHelp(): Promise<string> {
    const id = await sessionOnACard()
    expect((await host.queueMessage(id, 'and then this', sink)).outcome).toBe('queued')
    const looked = watch.looks
    watch.moved = true
    const card = sink.events().find((event) => event.type === 'permission_request')
    await host.respondPermission(id, (card as { id: string }).id, { outcome: 'deny' }, sink)
    await waitFor(() => sink.types().includes('reopened'), 'this app to reopen it')
    await waitFor(() => watch.looks >= looked + 2, 'the reopened life to look at the sign-in')
    await new Promise((resolve) => setTimeout(resolve, 20))
    return id
  }

  it('an UNCHANGED sign-in refuses nothing — the paired negative', async () => {
    const id = await session()
    await host.send(id, 'carry on', sink)
    expect(watch.looks).toBeGreaterThan(0) // it did look…
    expect(sink.events().filter((event) => event.type === 'user_turn')).toHaveLength(1) // …and let it go
  })

  it('a person’s message on a replaced sign-in is held, and goes in when this app reopens the conversation on the current one', async () => {
    const id = await session()
    watch.moved = true
    watch.reopenReadsCurrent = true

    await host.send(id, 'carry on', sink)

    await waitFor(() => userTurns() === 1, 'the message to go in on the reopened life')
    wentInOnlyAfterTheReopen(0)
    expect(sink.events().filter((event) => event.type === 'reopened')).toEqual([
      { type: 'reopened', because: 'the-sign-in-moved-on' },
    ])
    expect(sink.events().filter((event) => event.type === 'message_unqueued')).toMatchObject([
      { reason: 'sent', text: 'carry on' },
    ])
  })

  it('…and where this app’s reopen did not help, a person’s message is refused, and says what to do', async () => {
    const id = await aReopenThatDidNotHelp()
    const turns = userTurns()
    const held = sink.types().filter((type) => type === 'message_queued').length

    await expect(host.send(id, 'carry on', sink)).rejects.toThrow(
      /holding the Claude sign-in it started with/,
    )

    // ⚠️ **Nothing was started and nothing was recorded.** A refused turn must not leave a `user_turn`
    // in the ledger: 045 opens a turn row from that event, and a turn nobody could take would sit
    // open forever. ⚑ Nor is it held: no reopen of this app's would carry it.
    expect(userTurns()).toBe(turns)
    expect(sink.types().filter((type) => type === 'message_queued')).toHaveLength(held)
  })

  it('the refusal answers for the gesture, and carries no id and no credential', async () => {
    const id = await aReopenThatDidNotHelp()
    const error = await host.send(id, 'x', sink).catch((cause: unknown) => cause)
    const message = error instanceof Error ? error.message : String(error)

    // ⚠️ **It answers for the GESTURE and leaves the standing state to the bar** — the two used to
    // say the same words, which is 085's "one refusal rendered twice". What only this can say is
    // that the message did not go anywhere; the bar carries the remedy and the button.
    expect(message).toContain('Nothing has been sent')
    expect(message).toContain('has moved on to a different one')
    // ⛔ **And it is true of a RENEWAL** (149 §6). "Replaced" reads as an accusation that somebody
    // logged in, and the first thing this feature met in the field was an ordinary 8-hourly token
    // refresh from another Claude client on the same machine. We cannot tell the two apart — the
    // blob carries no account identity — so the words have to be true of both.
    expect(message).toContain('a renewal counts')
    expect(message).not.toMatch(/replaced|switched account/i)
    // …and it does NOT repeat the bar's sentence.
    expect(message).not.toContain('Reopen')
    expect(message).not.toContain(id) // …and never a request key or a session id (100)
    expect(message).not.toMatch(/sk-ant|oat01|[0-9a-f]{32}/) // nor a token, nor its digest
  })

  it('publishes the state BEFORE it throws, so the button is on screen when the refusal lands', async () => {
    const id = await session()
    watch.moved = true
    const before = sink.liveness.length

    await host.send(id, 'carry on', sink).catch(() => undefined)

    const published = sink.liveness.slice(before)
    expect(published.length).toBeGreaterThan(0)
    expect(published.at(-1)?.signInSuperseded).toBe(true)
  })

  it('says so on the liveness channel only once it is true — the paired negative for the disclosure', async () => {
    const id = await session()
    await host.send(id, 'carry on', sink)
    // Every message published while the credential was current says the sign-in is fine. A field that
    // was absent rather than `false` would be indistinguishable from "nobody has looked".
    expect(sink.liveness.every((liveness) => liveness.signInSuperseded !== true)).toBe(true)
  })

  it('an ordinary liveness publish reads the LATCH and never looks — M16 found this gap', async () => {
    // ⛔ **The first mutation run came back GREEN for a disclosure that called `checkSignIn()`.** The
    // in-flight test below asserts nothing looks while a turn runs, and that was true for the wrong
    // reason: the parked fake turn publishes nothing, so there was no publish to catch it. This is
    // the missing half — a publish that is NOT a turn boundary, with the credential already moved.
    const id = await session()
    watch.moved = true
    const looked = watch.looks
    const before = sink.liveness.length

    await host.setApprovalMode(id, 'auto', sink) // publishes a disclosure; starts no turn

    expect(sink.liveness.length).toBeGreaterThan(before) // the publish really happened…
    expect(watch.looks).toBe(looked) // …and it cost no Keychain read
    // …and it must not have latched off the back of one either: the user has not tried to take a
    // turn, so there is nothing yet to tell them about.
    expect(sink.liveness.at(-1)?.signInSuperseded).not.toBe(true)
  })

  it('does NOT interrupt a turn already in flight — the requirement is the NEXT turn', async () => {
    const id = await sessionOnACard()
    const sent = sink.types().length
    const looked = watch.looks
    watch.moved = true

    // Nothing at all happens to the running turn: no interrupt, no close, no event.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(sink.types().length).toBe(sent)
    // ⚑ **And nothing even LOOKED.** The check costs a `security` subprocess, so it belongs at the
    // turn boundary and nowhere else — not on a timer, not on every liveness publish, not while a
    // turn is running. A disclosure that asked the handle instead of reading its latch would put one
    // of these behind every agent-info change, and this is the line that would notice.
    expect(watch.looks).toBe(looked)
    // …and certainly not an ending. `session` alone would match the `started` event every session
    // emits, which is how this assertion first passed over nothing.
    expect(sink.events().some((event) => event.type === 'session' && event.state === 'ended')).toBe(
      false,
    )

    // The card is still there, still open, still answerable — 146 §1 by the other road, refused.
    const card = sink.events().find((event) => event.type === 'permission_request')
    expect(card).toBeDefined()
    await expect(
      host.respondPermission(id, (card as { id: string }).id, { outcome: 'allow' }, sink),
    ).resolves.not.toThrow()
  })

  /**
   * ⚑ **A queued message is not delivered on the old sign-in** — the half this test has always
   * asserted — **and it is not ENDED either** (`648` ended it, and a parent's answer was lost so).
   * ⚑ It stays held, and once the conversation is free this app reopens it on the current sign-in,
   * where it goes first. ⚠️ Here every handle's watch stays latched, so the life the reopen makes
   * holds a moved sign-in too: the loop guard leaves it for a person — one reopen, still held.
   */
  it('a QUEUED message is not delivered on the old sign-in — it stays held, this app reopens the conversation for it once, and a person’s Reopen delivers it', async () => {
    const id = await sessionOnACard()
    expect((await host.queueMessage(id, 'and then this', sink)).outcome).toBe('queued')
    const looked = watch.looks

    // The machine login moves while the message waits — the one turn that would otherwise start with
    // nobody pressing anything.
    watch.moved = true
    const card = sink.events().find((event) => event.type === 'permission_request')
    await host.respondPermission(id, (card as { id: string }).id, { outcome: 'deny' }, sink)

    await waitFor(
      () => sink.events().some((event) => event.type === 'reopened'),
      'this app to reopen it on the current sign-in',
    )
    // ⚑ Two looks: the flush that met the moved sign-in, then the reopened life's own.
    await waitFor(() => watch.looks >= looked + 2, 'the reopened life to look at the sign-in')
    await new Promise((resolve) => setTimeout(resolve, 20))
    // It was NOT sent: no second `user_turn`.
    expect(sink.events().filter((event) => event.type === 'user_turn')).toHaveLength(1)
    // ⚑ …and never ended unsent, and reopened once.
    expect(sink.events().filter((event) => event.type === 'message_unqueued')).toEqual([])
    expect(sink.events().filter((event) => event.type === 'reopened')).toEqual([
      { type: 'reopened', because: 'the-sign-in-moved-on' },
    ])

    // 🔴 **Held across the renewal, then delivered by a person's Reopen** — the start reads its
    // ledger, finds the message still open, and sends it first. ⚑ The machine login reads as current
    // to the new life now; a person's Reopen is the window's close, then its reopen.
    watch.moved = false
    watch.latched = false
    await host.close(id, sink)
    await host.reopenForAPerson(id, sink, null)
    await waitFor(
      () => sink.events().filter((event) => event.type === 'user_turn').length === 2,
      'the held message to go after the person’s Reopen',
    )
    expect(
      sink
        .events()
        .filter((event) => event.type === 'user_turn')
        .at(-1),
    ).toMatchObject({
      text: 'and then this',
    })
    expect(sink.events().filter((event) => event.type === 'message_unqueued')).toMatchObject([
      { reason: 'sent', text: 'and then this' },
    ])
  })

  it('a person’s QUEUED message on a replaced sign-in is held for the reopen', async () => {
    const id = await sessionOnACard()
    watch.moved = true
    expect((await host.queueMessage(id, 'later', sink)).outcome).toBe('queued')
    expect(sink.types()).toContain('message_queued')
  })

  it('…and where this app’s reopen did not help, it refuses to QUEUE', async () => {
    const id = await aReopenThatDidNotHelp()
    const held = sink.types().filter((type) => type === 'message_queued').length
    await expect(host.queueMessage(id, 'later', sink)).rejects.toThrow(/sign-in it started with/)
    expect(sink.types().filter((type) => type === 'message_queued')).toHaveLength(held)
  })

  it('every liveness a surface receives is the SAME projection — including the tracker’s own', async () => {
    // ⛔ **Found while fixing 148 H5, same shape.** The `LivenessTracker` callback built its
    // disclosures from `{provider, handle}` — no session — and `queued` is an optional parameter of
    // that function, so every liveness it published said `queued: null`. `acceptLiveness` folds a
    // non-undefined `queued` straight onto `meta`, so the composer's "a message is waiting" banner
    // and its Cancel were taken away by a publication that knew nothing about the queue.
    const id = await sessionOnACard()
    expect((await host.queueMessage(id, 'and then this', sink)).outcome).toBe('queued')

    const before = sink.liveness.length
    await host.close(id, sink) // the tracker publishes a terminal liveness of its own

    const fromTracker = sink.liveness.slice(before)
    expect(fromTracker.length).toBeGreaterThan(0)
    // Every one of them carries the queue as it stood — the disclosure is either the message or an
    // explicit EMPTY LIST once teardown has abandoned it (394; it was `null` until the mailbox), and
    // never an emptiness invented by the projection.
    const said = fromTracker.map((liveness) => liveness.queued?.[0]?.text ?? null)
    expect(said).toContain('and then this')
  })

  it('the plan go-ahead passes the gate too — 148 H2, the fourth send path', async () => {
    const created = await host.createSession({ provider: 'claude', planMode: true }, sink)
    const id = created.sessionId
    expect(created.planNeedsGoAhead).toBe(true)
    watch.moved = true

    await expect(host.endPlanMode(id, sink, 'go on then')).rejects.toThrow(
      /holding the Claude sign-in it started with/,
    )

    // ⛔ **And the plan is still there.** This is why the gate goes ABOVE `setPlanMode(false)`: the
    // release is persisted and published before the send, so a refusal below it would leave a
    // conversation that had durably stopped planning, lost its bar, and said nothing. Asked the way
    // a renderer asks — the hand-over is what draws the bar.
    expect(handedBack(id, sink)?.planNeedsGoAhead).toBe(true)
    expect(sink.types()).not.toContain('user_turn')
  })

  it('…and LEAVING planning is not refused — it sends nothing (085 asymmetry, kept)', async () => {
    const created = await host.createSession({ provider: 'claude', planMode: true }, sink)
    watch.moved = true

    // No message, no turn, no credential needed. A superseded sign-in is not a reason you may not
    // stop steering — that would be this gate deciding something it has no business deciding.
    await expect(host.endPlanMode(created.sessionId, sink)).resolves.not.toThrow()
    expect(handedBack(created.sessionId, sink)?.planNeedsGoAhead).toBe(false)
  })

  it('the interrupt re-checks immediately before the replacement send — 148 M1', async () => {
    const id = await sessionOnACard()
    const turns = userTurns()
    // Current at the entry check; moved by the time the interrupt has settled. Up to five seconds of
    // `waitForIdle` live in that window, and this is the only send path with an await that long
    // between deciding and doing.
    watch.movesOnInterrupt = true
    watch.reopenReadsCurrent = true

    await host.sendInterrupting(id, 'do this instead', sink)

    // The replacement never went out on the old child: it was held, and goes in on the reopened one…
    await waitFor(() => userTurns() === turns + 1, 'the replacement to go in on the reopened life')
    wentInOnlyAfterTheReopen(turns)
    // …and the entry check DID pass, so this is the second one doing the work rather than the first.
    expect(watch.looks).toBeGreaterThan(1)
  })

  it('a reconnecting surface is handed the latch — 148 H5, the hand-over half', async () => {
    const id = await session()
    watch.moved = true
    await host.send(id, 'carry on', sink).catch(() => undefined)
    expect(watch.latched).toBe(true)

    // The window reloads: same owner, a brand-new sink that has been told nothing.
    const reloaded = new RecordingSink()
    const handed = handedBack(id, reloaded)

    // ⛔ It used to be handed `session.liveness.current` — the tracker's own state, with no
    // disclosures folded in — so the fresh renderer read the absent field as false and lost the amber
    // bar, while every message stayed refused by a latch that had not changed. `cmd+R` is exactly
    // what a stuck user presses.
    expect(handed?.liveness.signInSuperseded).toBe(true)
  })

  it('…and the next publish is not suppressed as "unchanged" against the window that left', async () => {
    const id = await session()
    watch.moved = true
    await host.send(id, 'carry on', sink).catch(() => undefined)

    const reloaded = new RecordingSink()
    handedBack(id, reloaded)
    const before = reloaded.liveness.length

    // The user tries again in the new window. The disclosures have not changed since the last
    // publication — to a sink that no longer exists — so a key that outlived its sink would return
    // early here and say nothing at all, forever.
    await host.send(id, 'carry on', sink).catch(() => undefined)

    expect(reloaded.liveness.length).toBeGreaterThan(before)
    expect(reloaded.liveness.at(-1)?.signInSuperseded).toBe(true)
  })

  it('an adapter with no credential watch at all is unaffected (Codex, scoped out)', async () => {
    // Codex's profile `auth.json` is a copy made once and follows nothing, so it reports nothing —
    // and a host that treated "no answer" as "superseded" would refuse every Codex turn.
    const plain = new RuntimeHost({
      store: NULL_SESSION_STORE,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider) => join(userData, 'homes', provider),
      providerHomePath: (provider) => join(userData, 'homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => 'sess_codex',
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    const other = new RecordingSink('owner:2')
    try {
      const created = await plain.createSession({ provider: 'codex' }, other)
      await expect(plain.send(created.sessionId, 'hello', other)).resolves.not.toThrow()
      expect(other.liveness.every((liveness) => liveness.signInSuperseded !== true)).toBe(true)

      // ⛔ **ABSENT, not `false`** (150, 148 L3). `signInSuperseded === true` published an explicit
      // `false` for every provider that reports nothing — a positive claim that this session's
      // sign-in is current, which for Codex is not a fact anything looked at. The field's own
      // contract is *"an adapter with nothing true to say leaves this absent"*, and the host was the
      // one place filling the silence in.
      expect(other.liveness.length, 'there is liveness to inspect at all').toBeGreaterThan(0)
      for (const liveness of other.liveness) {
        expect(Object.hasOwn(liveness, 'signInSuperseded'), 'Codex says nothing').toBe(false)
      }
    } finally {
      await plain.closeAll()
    }
  })

  it('a person’s interrupt-and-send on a replaced sign-in stops the turn, and its words go in on the reopened life', async () => {
    const id = await sessionOnACard()
    const turns = userTurns()
    watch.moved = true
    watch.reopenReadsCurrent = true

    await host.sendInterrupting(id, 'do this instead', sink)

    // ⚑ The stop is the person's, and it happened: the breadcrumb says so.
    expect(
      sink
        .events()
        .filter((event) => event.type === 'user_command')
        .map((event) => (event as { command: string }).command),
    ).toContain('interrupted_to_send')
    await waitFor(() => userTurns() === turns + 1, 'the words to go in on the reopened life')
    wentInOnlyAfterTheReopen(turns)
  })

  it('⛔ an interrupt-and-send on a replaced sign-in whose attachment is gone is refused before the stop', async () => {
    const id = await sessionOnACard()
    watch.moved = true
    const before = sink.events().filter((event) => event.type === 'user_command').length
    const endings = sink.types().filter((type) => type === 'turn').length
    const gone = { path: join(userData, 'gone.md'), kind: 'file' as const, outsideCwd: true }

    await expect(host.sendInterrupting(id, 'with this file', sink, [gone])).rejects.toThrow()

    // Nothing was stopped and nothing was held: the turn still waits on its card.
    expect(sink.events().filter((event) => event.type === 'user_command')).toHaveLength(before)
    expect(sink.types()).not.toContain('message_queued')
    expect(sink.types().filter((type) => type === 'turn')).toHaveLength(endings)
  })

  it('a REFUSED interrupt-and-send leaves no breadcrumb claiming it happened — 148 L2', async () => {
    // ⛔ **039.** `interrupted_to_send` was written by the IPC dispatcher before the gate ran, so a
    // turn the gate refused left the ledger saying the user had interrupted one. Nothing was
    // interrupted and nothing was sent; the only trace was of a gesture that did not occur.
    // ⚑ Refused where this app's reopen did not help.
    const id = await aReopenThatDidNotHelp()
    const before = sink.events().filter((event) => event.type === 'user_command').length

    await expect(host.sendInterrupting(id, 'do this instead', sink)).rejects.toThrow(
      /holding the Claude sign-in it started with/,
    )
    expect(sink.events().filter((event) => event.type === 'user_command')).toHaveLength(before)
  })

  it('…and an interrupt that DOES go still records it — the paired positive', async () => {
    // Without this the fix above would be satisfied by never recording the gesture at all, which is
    // the failure 085 reported in the first place: a Stop the ledger had nothing to say about.
    const id = await sessionOnACard()
    await host.sendInterrupting(id, 'do this instead', sink)
    expect(
      sink
        .events()
        .filter((event) => event.type === 'user_command')
        .map((event) => (event as { command: string }).command),
    ).toContain('interrupted_to_send')
  })
})
