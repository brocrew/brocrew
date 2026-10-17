import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime, type FakeSessionHandle, type StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import {
  type AgentCard,
  mayHandBack,
  RuntimeHost,
  THE_APP_ITSELF,
  type RuntimeEventSink,
  type UnclaimedSession,
} from '../src/main/runtime/runtime-host'
import { describeUnavailable } from '../src/main/runtime/session-unavailable'
import { agentStateWords } from '../src/shared/agent-state'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

/**
 * 🔴 **523 · a look he can take back** — `519` item 3, ruled in HO-045 §1.
 *
 * ## ⛔ The property, and it is three clauses rather than one
 *
 * > ⚑ *He can see what a conversation is doing; doing so is REVERSIBLE; and stopping leaves the
 * > conversation exactly as he found it.*
 *
 * ⚠️ **The third clause is the one nothing measured.** `336` asserts that a window's DEPARTURE
 * releases what it claimed; `340` that the commander survives it; `349` that both halves of the
 * owner go back. ⛔ **Not one of them snapshots the world before the claim and compares it to the
 * world after the release** — they each check the two or three fields their own dispatch was about,
 * which is a rule measured one field at a time and a property nobody has stated.
 *
 * ## 🔴 What §1 does instead, and why it is a deep equality
 *
 * ⚑ **{@link worldOf} is read through PUBLIC, NON-MUTATING doors only**, and that is a constraint
 * worth naming: `attachOpenSessions` looks like the obvious way to ask *who owns this*, and it
 * cannot be used — it ATTACHES, swapping `session.sink` and clearing `lastDisclosures` on every slot
 * it admits. ⛔ A snapshot that changed the thing it measured would make the equality below prove
 * itself. So ownership is probed with {@link RuntimeHost.agentCard}, which answers `null` for a
 * caller with no reach and mutates nothing on either arm.
 *
 * ⚠️ **`toEqual` over the whole object rather than a list of fields** — `a-derivation-cannot-answer-
 * what-its-ledger-does-not-contain`'s direction: the assertion has to cover the fields nobody has
 * added yet, because *exactly as he found it* is a claim about all of them. ⛔ Three of the four
 * facts `523`'s brief names would each have passed a narrower test on their own; what makes this one
 * an instrument is that the ledger, the provider child and the owner are asserted in one value.
 *
 * ## ⛔ §2 is the CONTROL, and it is in the same sample on purpose
 *
 * 🔴 **`519` F2: *window close and pane Close are opposite operations for a claimed agent-born
 * child.*** A release measured alone shows that nothing was lost; it says nothing about whether the
 * app can still lose anything. ⚑ So the same helper drives claim → END, against the same world
 * snapshot, and the two are read side by side: one returns the conversation to where it was, and the
 * other stops the provider, empties the slot map and writes a terminal row.
 *
 * ## ⚠️ What this file does NOT do
 *
 * ⛔ **No renderer, no component and no copy.** The words are `handing-it-back.ts`'s and they are
 * asserted in `a-look-he-can-take-back.render.test.ts`; this file is about the door.
 */

/** A `FakeRuntime` that keeps the handles it issues, so a test can reach the provider end. */
class CapturingRuntime extends FakeRuntime {
  readonly issued: FakeSessionHandle[] = []
  override async start(opts: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(opts)
    this.issued.push(handle)
    return handle
  }
  latest(): FakeSessionHandle {
    const handle = this.issued.at(-1)
    if (handle === undefined) throw new Error('no session has been started on this runtime')
    return handle
  }
}

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
  events(): TranscriptEvent[] {
    return this.messages.map((message) => message.event)
  }
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

const HELD_BY_NOBODY = describeUnavailable('held-by-nobody')
const NOT_YOURS = describeUnavailable('not-yours')
const STARTED_HERE = describeUnavailable('started-here')
const NOT_RUNNING = describeUnavailable('not-running')
const STILL_CLOSING = describeUnavailable('still-closing')

/** Everything one conversation is, read through doors that change none of it. */
interface World {
  readonly unclaimed: UnclaimedSession | null
  readonly registered: boolean
  readonly provider: string
  readonly reachableFromOne: boolean
  readonly reachableFromTwo: boolean
  readonly ledger: readonly TranscriptEvent[]
}

describe('523 · a look he can take back', () => {
  let userData: string
  let db: AppDatabase
  let host: RuntimeHost
  let store: SessionStore
  let runtimes: Map<Provider, CapturingRuntime>
  let one: RecordingSink
  let two: RecordingSink
  /** The caller an agent-born conversation is spawned FOR — it owns nothing and watches nothing. */
  // ⚑ **`mcp:`, which is `340`'s own fixture id.** An `agent:` caller is additionally subject to
  // `431`'s messaging reach, and this file is about ownership — borrowing that rail here would
  // make the commander's send fail for a reason this dispatch did not build.
  const PLANNER = { ownerId: 'mcp:planner' }
  const handles = new Map<string, FakeSessionHandle>()

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-take-back-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    runtimes = new Map()
    handles.clear()
    store = createSessionStore(db)
    let counter = 0
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => {
        const held = runtimes.get(provider) ?? new CapturingRuntime(provider)
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
    })
    one = new RecordingSink('webContents:1')
    two = new RecordingSink('webContents:2')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  const provider = (): CapturingRuntime => {
    const held = runtimes.get('claude')
    if (held === undefined) throw new Error('no claude runtime was built')
    return held
  }

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  /**
   * ⚑ **A conversation nobody asked for, that one agent may drive** — `spawnSession`'s shape, built
   * through `createSession` because that is the only route to `bornWithoutASurface: true`.
   */
  const openAgentBorn = async (commandedBy: { ownerId: string } | null = PLANNER) => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', cwd: userData },
      null,
      commandedBy,
    )
    handles.set(sessionId, provider().latest())
    return sessionId
  }

  /** ⛔ **The control one fact over**: the same launch, asked for by a window. */
  const openFor = async (sink: RecordingSink) => {
    const { sessionId } = await host.createSession({ provider: 'claude', cwd: userData }, sink)
    handles.set(sessionId, provider().latest())
    return sessionId
  }

  async function agentSays(sessionId: string, text: string): Promise<void> {
    const handle = handles.get(sessionId)
    if (handle === undefined) throw new Error(`no provider handle held for ${sessionId}`)
    handle.simulateActivity('thinking', text)
    await waitFor(
      () => ledger(sessionId).some((e) => e.type === 'activity' && e.detail === text),
      `the ledger to hold ${text}`,
    )
  }

  const refusalOf = async (act: () => unknown): Promise<string> => {
    try {
      await act()
    } catch (error) {
      return (error as Error).message
    }
    throw new Error('the gesture was allowed')
  }

  /** ⚑ D-017 · R11 — the card's state in its words, so two readings compare by value. */
  const stateOf = (card: AgentCard | null): string =>
    card === null ? 'no card' : agentStateWords(card.state)

  /**
   * 🔴 **The world, through doors that change none of it.**
   *
   * ⛔ **`agentCard` and not `attachOpenSessions`** — see this file's header. It asks
   * `withinMessagingReach` and returns `null` rather than throwing, so both arms are a read.
   * ⚠️ **Neither window is the commander**, so for these two sinks reach IS ownership.
   */
  const worldOf = (sessionId: string): World => ({
    unclaimed: host.unclaimedSessions().find((row) => row.sessionId === sessionId) ?? null,
    registered: host.sessionIds.includes(sessionId),
    provider: stateOf(host.agentCard(sessionId, THE_APP_ITSELF, null)),
    reachableFromOne: host.agentCard(sessionId, one, null) !== null,
    reachableFromTwo: host.agentCard(sessionId, two, null) !== null,
    ledger: ledger(sessionId),
  })

  describe('§1 · claim → watch → release leaves the conversation exactly as it was', () => {
    it('🔴 the whole world round-trips, and the claim in the middle really did change it', async () => {
      const sessionId = await openAgentBorn()
      await agentSays(sessionId, 'before anybody looked')
      const before = worldOf(sessionId)

      // ⚑ The claim, and the proof the sample is about something: if nothing moved here, the
      // equality at the end would be satisfied by a release that did nothing.
      const handed = host.claimSession(sessionId, one)
      const watched = worldOf(sessionId)
      expect(watched).not.toEqual(before)
      expect(watched.unclaimed, 'a claimed conversation is nobody’s no longer').toBeNull()
      expect(watched.reachableFromOne).toBe(true)
      expect(watched.reachableFromTwo).toBe(false)
      // ⛔ **The two fields `519` item 3 asked to be exposed**, on the hand-over itself.
      expect(handed.startedWithoutAWindow).toBe(true)
      expect(handed.mayHandItBack).toBe(true)

      await agentSays(sessionId, 'while he was watching')

      const released = host.releaseSession(sessionId, one)
      expect(released).toEqual({
        sessionId,
        running: 'unwatched',
        waitingForAHuman: false,
      })

      // 🔴 **The property, in one assertion.** The owner, the provider child, the commander, the
      // registration and the ledger are all in this value — including the two events, so *unchanged*
      // is not satisfied by a conversation that stopped producing.
      expect(worldOf(sessionId)).toEqual({
        ...before,
        ledger: [...before.ledger, expect.objectContaining({ detail: 'while he was watching' })],
      })
    })

    it('⚑ the provider child is untouched, and the conversation goes on speaking', async () => {
      const sessionId = await openAgentBorn()
      host.claimSession(sessionId, one)
      host.releaseSession(sessionId, one)

      // ⛔ **`handle.status()`, not a close counter.** `519` §2 named `closeCalls`; no such field
      // exists on this repository's double, and the status is what `close` actually moves.
      expect(handles.get(sessionId)?.status()).not.toBe('ended')
      await agentSays(sessionId, 'still going')
      expect(
        ledger(sessionId).some((e) => e.type === 'activity' && e.detail === 'still going'),
      ).toBe(true)
    })

    it('⛔ the window that let it go stops being told, and stops being told IMMEDIATELY', async () => {
      const sessionId = await openAgentBorn()
      host.claimSession(sessionId, one)
      host.releaseSession(sessionId, one)
      const afterRelease = one.events().length

      await agentSays(sessionId, 'said to nobody')
      // ⚠️ `336`'s per-row killer check, as a positive: releasing the OWNER without releasing the
      // SINK would leave this window receiving a conversation it no longer holds.
      expect(one.events()).toHaveLength(afterRelease)
    })

    it('⚑ the commander is untouched and can still send afterwards', async () => {
      const sessionId = await openAgentBorn()
      host.claimSession(sessionId, one)
      host.releaseSession(sessionId, one)

      // ⛔ `commandedBy` is `readonly`, so this is structural — and a test that presses it is the
      // point of saying so (340 §3).
      expect(host.unclaimedSessions()[0]?.commandedBy).toBe(PLANNER.ownerId)
      await host.send(sessionId, 'carry on', PLANNER)
      expect(ledger(sessionId).map((event) => event.type)).toContain('user_turn')
    })

    it('🔴 taking it over again delivers the next change — the dedupe key went with the sink', async () => {
      // ⚑ **`336` §7 named this defect and could not drive it**: *"dropping `lastDisclosures` from
      // `release` — a real defect nothing in this suite drives"*. It could not be driven because the
      // only release was a window dying, and a dead window cannot claim again. ⛔ A deliberate
      // hand-back can, so the line is now measured.
      const sessionId = await openAgentBorn()
      host.claimSession(sessionId, one)
      await agentSays(sessionId, 'first')
      host.releaseSession(sessionId, one)

      host.claimSession(sessionId, two)
      const before = two.messages.length
      await agentSays(sessionId, 'after the second claim')
      expect(
        two.events().some((e) => e.type === 'activity' && e.detail === 'after the second claim'),
      ).toBe(true)
      expect(two.messages.length).toBeGreaterThan(before)
    })

    it('⚠️ the approval mode is where it was, and a change made while watching survives', async () => {
      const sessionId = await openAgentBorn()
      const first = host.claimSession(sessionId, one)
      expect(first.approvalMode).toBe('ask')
      host.releaseSession(sessionId, one)
      expect(host.claimSession(sessionId, two).approvalMode).toBe('ask')

      // ⛔ **`519` F5: the mode belongs to the SESSION, not to its owner.** A release clears no mode
      // field and performs no store write, so what the last owner asked for is still what the next
      // one is handed.
      await host.setApprovalMode(sessionId, 'auto', two)
      host.releaseSession(sessionId, two)
      const third = host.claimSession(sessionId, one)
      expect(third.pendingApprovalMode ?? third.approvalMode).toBe('auto')
    })
  })

  describe('§2 · the control: claim → END is the opposite operation', () => {
    it('🔴 ending it empties the slot, stops the child and writes a terminal row', async () => {
      const sessionId = await openAgentBorn()
      await agentSays(sessionId, 'before anybody looked')
      const before = worldOf(sessionId)

      host.claimSession(sessionId, one)
      await host.close(sessionId, one)

      const after = worldOf(sessionId)
      // ⛔ **Every one of these is a field §1's release left alone**, which is the whole of why the
      // two are in one file: *nothing was lost* means nothing next to a sample where something can be.
      expect(after.registered).toBe(false)
      expect(after.unclaimed).toBeNull()
      // ⚑ **D-017 · R11: the one field a stop does NOT move is the card's state** — whether a
      // process runs is never one of its inputs, so a conversation the Close stopped reads what it
      // read while it ran (`idle`), and a message starts it again. The stop is in the fields above
      // and below: the slot, the provider child and the ledger.
      expect(after.provider).toBe(before.provider)
      expect(handles.get(sessionId)?.status()).toBe('ended')
      expect(after.ledger.length).toBeGreaterThan(before.ledger.length)
      expect(after).not.toEqual(before)
    })

    it('⚑ …and the SAME conversation, handed back instead, is still there to end later', async () => {
      // ⚠️ The pair that makes §2 a control rather than a second test: one sequence, branching at
      // the one press this dispatch added.
      const sessionId = await openAgentBorn()
      host.claimSession(sessionId, one)
      host.releaseSession(sessionId, one)
      expect(host.sessionIds).toContain(sessionId)

      host.claimSession(sessionId, two)
      await host.close(sessionId, two)
      expect(host.sessionIds).not.toContain(sessionId)
    })
  })

  describe('§3 · what it refuses, each paired with the same call one fact over', () => {
    it('⛔ a conversation this window STARTED is refused — and the same window’s claimed one is not', async () => {
      // 🔴 **Q3, measured where the two readings DIVERGE.** Both slots are owned by `one`; the only
      // difference between them is the birth fact, which is what `mayHandBack` reads beside the owner.
      const mine = await openFor(one)
      expect(await refusalOf(() => host.releaseSession(mine, one))).toBe(STARTED_HERE)
      expect(host.sessionIds).toContain(mine)

      const theirs = await openAgentBorn()
      host.claimSession(theirs, one)
      expect(host.releaseSession(theirs, one).running).toBe('unwatched')
    })

    it('⛔ a stranger is refused `not-yours` — and the owner is not', async () => {
      const sessionId = await openAgentBorn()
      host.claimSession(sessionId, one)
      expect(await refusalOf(() => host.releaseSession(sessionId, two))).toBe(NOT_YOURS)
      // ⚠️ **Entitlement before existence**: `two` is told nothing about how this conversation came
      // to exist, even though the birth fact would have admitted a hand-back by its owner.
      expect(host.releaseSession(sessionId, one).running).toBe('unwatched')
    })

    it('⛔ a conversation nobody holds is refused `held-by-nobody` — including the second press', async () => {
      const sessionId = await openAgentBorn()
      expect(await refusalOf(() => host.releaseSession(sessionId, one))).toBe(HELD_BY_NOBODY)

      host.claimSession(sessionId, one)
      host.releaseSession(sessionId, one)
      // ⚑ **The same sentence for pressing twice**, which is the true thing to say about it.
      expect(await refusalOf(() => host.releaseSession(sessionId, one))).toBe(HELD_BY_NOBODY)
    })

    it('⛔ an id this host is not running is refused `not-running`', async () => {
      expect(await refusalOf(() => host.releaseSession('sess_nothing', one))).toBe(NOT_RUNNING)
      // ⚠️ The pairing: the same window, the same call, on an id this host does hold.
      const sessionId = await openAgentBorn()
      host.claimSession(sessionId, one)
      expect(host.releaseSession(sessionId, one).running).toBe('unwatched')
    })

    it('🔴 a stranger is told `not-yours` even when the BIRTH fact would have refused too', async () => {
      // ⛔ **The order, measured where the two readings DIVERGE** — and it is the only row that can
      // see it. Every other refusal pairing above uses a conversation whose birth fact ADMITS a
      // hand-back, so entitlement-first and birth-first give the same sentence. ⚠️ Here both guards
      // would refuse: `one` started this conversation, and `two` does not own it. ⛔ Asking the birth
      // fact first would answer *"you started this conversation"* to a window that started nothing —
      // telling a stranger how somebody else's conversation came to exist, on an id it only has to
      // guess (`refuse-on-entitlement-before-refusing-on-existence`).
      const mine = await openFor(one)
      expect(await refusalOf(() => host.releaseSession(mine, two))).toBe(NOT_YOURS)
      // …and the pairing: the OWNER of that same conversation is the one told about its birth.
      expect(await refusalOf(() => host.releaseSession(mine, one))).toBe(STARTED_HERE)
    })

    it('⛔ a conversation on its way out is refused `still-closing`', async () => {
      const sessionId = await openAgentBorn()
      host.claimSession(sessionId, one)
      // ⚑ `close` marks the slot `closing` SYNCHRONOUSLY and then returns the teardown, so this is
      // the real interval rather than a flag set by the test.
      const closing = host.close(sessionId, one)
      expect(await refusalOf(() => host.releaseSession(sessionId, one))).toBe(STILL_CLOSING)
      await closing
      // ⚠️ The pairing is §2's: the same call, on the same conversation, one press earlier.
      expect(host.sessionIds).not.toContain(sessionId)
    })

    it('⚑ the predicate itself, at the four corners of its two clauses', () => {
      const me = { ownerId: 'webContents:1' }
      expect(mayHandBack({ ownerId: 'webContents:1', bornWithoutASurface: true }, me)).toBe(true)
      expect(mayHandBack({ ownerId: 'webContents:1', bornWithoutASurface: false }, me)).toBe(false)
      expect(mayHandBack({ ownerId: 'webContents:2', bornWithoutASurface: true }, me)).toBe(false)
      expect(mayHandBack({ ownerId: null, bornWithoutASurface: true }, me)).toBe(false)
    })
  })

  describe('§4 · the room, and the question nobody can answer', () => {
    it('🔴 a released conversation reads as alive and unwatched, never as gone', async () => {
      const sessionId = await openAgentBorn()
      host.claimSession(sessionId, one)
      const released = host.releaseSession(sessionId, one)

      // ⛔ **`unwatched`, which is the room's own word** — `421`'s three-armed `RunningState`, and the
      // row the design draws as *running — nobody is watching it*. ⚠️ Not `not-running`: that is what
      // §2's control produces, and it is what a person would read as *gone*.
      expect(released.running).toBe('unwatched')
      expect(host.unclaimedSessions().find((row) => row.sessionId === sessionId)).toMatchObject({
        running: true,
        provider: 'claude',
      })
      // ⚑ And it is offerable again: the row a person meets it on leads back in.
      expect(host.claimSession(sessionId, two).sessionId).toBe(sessionId)
    })

    it('⚠️ a question still standing is REPORTED, and it survives the hand-back unanswerable', async () => {
      const sessionId = await openAgentBorn()
      host.claimSession(sessionId, one)
      await host.send(sessionId, 'touch a file', one)
      await waitFor(
        () => one.events().some((event) => event.type === 'permission_request'),
        'the card',
      )

      // 🔴 **HO-037 §1 — tell, don't clamp.** The press is allowed while a person is being waited
      // on, and what it costs is on the answer rather than in a refusal.
      const released = host.releaseSession(sessionId, one)
      expect(released.waitingForAHuman).toBe(true)

      // The card is durable, and a person answers it from the queue without taking it back.
      expect(ledger(sessionId).map((event) => event.type)).toContain('permission_request')
      const requestId = requestIn(ledger(sessionId))
      await expect(
        host.respondPermission(sessionId, requestId, { outcome: 'allow' }, two),
      ).resolves.toMatchObject({ outcome: 'taken' })
      expect(host.unclaimedSessions().map((row) => row.sessionId)).toEqual([sessionId])
    })

    it('⚑ the report is FALSE when nothing is waiting, so the field is not a constant', async () => {
      const sessionId = await openAgentBorn()
      host.claimSession(sessionId, one)
      expect(host.releaseSession(sessionId, one).waitingForAHuman).toBe(false)
    })
  })

  describe('§5 · the wire, driven — the door a renderer actually reaches', () => {
    /**
     * ⛔ **`executeRuntimeCommand` and not `host.releaseSession` directly**, because three of the
     * five things a new verb needs are between them: the zod row that admits the payload, the quit
     * ruling that may refuse it, and the arm that decides WHICH sink the host is told about.
     *
     * ⚠️ **And this interface is the one with no census over it** — `runtime-ipc.ts` says so in as
     * many words: *"the three exhaustive tables are keyed by `RuntimeCommandKind`"*, and
     * `RuntimeBridge` is not. `401` shipped a verb that was built everywhere but there and stopped
     * dead at the preload with nothing red. ⚑ Driving the dispatcher is what makes the wire a
     * measured path rather than five edits that each compiled.
     */
    const overTheWire = (sink: RecordingSink, sessionId: string): Promise<unknown> =>
      executeRuntimeCommand(host, sink, { kind: 'release', sessionId })

    it('🔴 the payload the preload builds is admitted, dispatched, and answered', async () => {
      const sessionId = await openAgentBorn()
      host.claimSession(sessionId, one)
      expect(await overTheWire(one, sessionId)).toEqual({
        sessionId,
        running: 'unwatched',
        waitingForAHuman: false,
      })
      expect(host.unclaimedSessions().map((row) => row.sessionId)).toContain(sessionId)
    })

    it('⛔ the OWNER is the channel the ask arrived on, never a field in the payload', async () => {
      const sessionId = await openAgentBorn()
      host.claimSession(sessionId, one)
      // ⚑ The same bytes, sent down the other window's channel: the id names the conversation and
      // the channel names the caller, so this is a stranger however the payload is spelled.
      await expect(overTheWire(two, sessionId)).rejects.toThrow(NOT_YOURS)
      expect(await overTheWire(one, sessionId)).toMatchObject({ running: 'unwatched' })
    })

    it('⚠️ a quit refuses it, and the conversation is left held', async () => {
      const sessionId = await openAgentBorn()
      host.claimSession(sessionId, one)
      const quitting = host.closeAll()
      // ⛔ **`refused` during a quit** — `closeAll` is already ending every session this host holds,
      // so the only thing a hand-back could do is take a window's name off a conversation that is
      // going away, and report `unwatched` for a slot one step from `not-running`.
      await expect(overTheWire(one, sessionId)).rejects.toThrow(/shutting down|quit/i)
      await quitting
    })
  })

  /** The id of the one open card, from a list of events. */
  function requestIn(events: readonly TranscriptEvent[]): string {
    for (const event of events) {
      if (event.type === 'permission_request') return event.id
    }
    throw new Error('no permission request among these events')
  }
})
