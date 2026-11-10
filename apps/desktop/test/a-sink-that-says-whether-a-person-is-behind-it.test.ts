import { waitFor } from './lib/f093-host'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FakeLaunchGate,
  FakeRuntime,
  type FakeSessionHandle,
  type StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import {
  RuntimeHost,
  THE_APP_ITSELF,
  mayAnswerAsAHuman,
  type CallerIdentity,
  type RuntimeEventSink,
} from '../src/main/runtime/runtime-host'
import { describeUnavailable } from '../src/main/runtime/session-unavailable'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { neutralHostDeps } from './lib/host-fixture'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/**
 * 🔴 **349 · a sink that says whether a person is behind it.**
 *
 * ## ⛔ The defect, in 340's own words
 *
 * > `mayAnswerAsAHuman` asks whether the caller **owns** the session. Ownership is taken by
 * > `claimSession`, which takes a **`RuntimeEventSink`** — a type an MCP caller could implement.
 * > **An agent that presents a sink could claim its own child and then answer its permission prompt
 * > legally.**
 *
 * ⚑ **What stopped that was a FACT, not a check**: nothing but the IPC boundary calls the claim
 * door, and the only sink reaching it is `webContentsSink(event.sender)`. 340 wrote the fact down as
 * a source census and 347 widened it; §3 of this dispatch is what turns it into a rail.
 *
 * ## ⚑ The shape, in three sentences
 *
 * **A sink declares whether a person is behind it** (`RuntimeEventSink.aPersonIsBehindIt`, required
 * and never defaulted). **A claim copies that declaration onto the slot** beside the owner it is
 * taking, in the same synchronous block. **`mayAnswerAsAHuman` reads the declaration** rather than
 * inferring a person from the fact that somebody owns the conversation.
 *
 * ⛔ **Ownership is untouched, and §2 below is what says so.** A caller with no person behind it may
 * still claim, still receive the whole stream, still drive the conversation and still take its own
 * claim back. 340 settled the watching axis; this dispatch does not reopen it.
 *
 * ## 🔴 Why the fixtures in this repository default to "not a person"
 *
 * ⚠️ **48 files build a `RuntimeEventSink` double and 15 of them stand at the answer door.** The
 * field was swept in as `false` everywhere and the suite was then run: the 15 that went red are
 * exactly the files whose double stands in for a window, and each of them says `true` because a
 * test in it answers for a person. ⛔ **Sweeping the other way — `true` everywhere — would have
 * been green immediately and would have made every existing test the permissive case**, which is
 * the shape this whole rail exists to refuse. The compiler and the suite enumerated the roster;
 * nothing here was decided by reading a fixture's name.
 */

/** A `FakeRuntime` that keeps the handles it issues, so a test can be the provider. */
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

/**
 * ⛔ **One double, and the declaration is a constructor argument with no default.** The whole
 * subject of this file is a pair of sinks that differ in one field, so a default would let the
 * question be answered by whichever value it happened to be.
 */
class Surface implements RuntimeEventSink {
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(
    readonly ownerId: string,
    readonly aPersonIsBehindIt: boolean,
  ) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
  events(): TranscriptEvent[] {
    return this.messages.map((message) => message.event)
  }
}

/** The commanding caller, which has no sink at all — 340's, unchanged. */
const PLANNER: CallerIdentity = { ownerId: 'mcp:planner' }

const NOT_YOURS = describeUnavailable('not-yours')
/** 🔴 **421 · what a window reads about a conversation no window holds** — see the block at §1. */
const HELD_BY_NOBODY = describeUnavailable('held-by-nobody')
const A_PERSON = describeUnavailable('a-person-must-answer')
const ELSEWHERE = describeUnavailable('already-open-elsewhere')

describe('349 · a sink that says whether a person is behind it', () => {
  let userData: string
  let db: AppDatabase
  let host: RuntimeHost
  let store: SessionStore
  let runtimes: Map<Provider, CapturingRuntime>
  /** A window. The only shape in this app that `aPersonIsBehindIt` is `true` of. */
  let aWindow: Surface
  /** A second window, so 062's rule can be measured beside the new one. */
  let anotherWindow: Surface
  /**
   * ⛔ **A sink an agent could present, and it is a `RuntimeEventSink` in full.** It receives, it
   * reports itself alive, it carries a stable id it did not choose — everything the claim door
   * demands. The single thing it does not do is claim to have a person behind it.
   */
  let anAgentsSink: Surface
  let counter: number

  const buildHost = (): RuntimeHost =>
    new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
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

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-person-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    runtimes = new Map()
    store = createSessionStore(db)
    counter = 0
    host = buildHost()
    aWindow = new Surface('webContents:1', true)
    anotherWindow = new Surface('webContents:2', true)
    anAgentsSink = new Surface('mcp:planner', false)
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  /** A session nobody owns, that one caller may drive — 336's door and 340's field. */
  const spawn = async (approvalMode: 'ask' | 'auto' = 'ask'): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', cwd: userData, approvalMode },
      null,
      PLANNER,
    )
    return sessionId
  }

  const refusalOf = async (act: () => unknown): Promise<string> => {
    try {
      await act()
    } catch (error) {
      return (error as Error).message
    }
    throw new Error('the gesture was allowed')
  }

  /** Every card this conversation has ever raised, in ledger order. */
  const cardsIn = (sessionId: string): string[] =>
    ledger(sessionId).flatMap((event) => (event.type === 'permission_request' ? [event.id] : []))

  function requestIn(events: readonly TranscriptEvent[]): string {
    for (const event of events) {
      if (event.type === 'permission_request') return event.id
    }
    throw new Error('no permission request among these events')
  }

  /**
   * Drive a session up to the card it stops on, with whoever is entitled to drive it.
   *
   * ⛔ **It waits for a NEW card and returns the LAST one, and both halves are 340's own trap.**
   * The ledger keeps every card a conversation ever raised, so a helper that waited for *"some
   * permission_request"* and returned the FIRST would be satisfied the instant it was called on a
   * session that had already answered one — and the refusal a caller then measured would be about a
   * request id that had already been decided, which proves nothing about the state under test.
   */
  async function parkOnAQuestion(sessionId: string, by: CallerIdentity): Promise<string> {
    const before = cardsIn(sessionId).length
    await host.send(sessionId, 'touch a file', by)
    await waitFor(
      () => cardsIn(sessionId).length > before,
      `a NEW card (this conversation already had ${before})`,
    )
    const asked = cardsIn(sessionId).at(-1)
    if (asked === undefined) throw new Error('no permission request on the ledger')
    return asked
  }

  // ── §1 · the refusal, on a non-window sink that OWNS the session ────────────────────────────
  describe('§1 · owning a conversation is not being a person', () => {
    it('🔴 a sink with no person behind it claims, receives, commands — and cannot answer', async () => {
      const sessionId = await spawn()

      // ── 1 · it takes ownership through the front door ───────────────────────────────────────
      //
      // ⛔ **The claim SUCCEEDS, and that is the design rather than an oversight.** §3 of this
      // dispatch leaves ownership exactly where 340 put it: a caller with no surface may still be
      // handed a conversation's stream. What it may not do is inherit an answer with it.
      const handed = host.claimSession(sessionId, anAgentsSink)
      expect(handed.sessionId).toBe(sessionId)

      // …and it really is the owner, measured two ways rather than asserted.
      expect(host.unclaimedSessions()).toEqual([])
      expect(await refusalOf(() => host.claimSession(sessionId, aWindow))).toBe(ELSEWHERE)

      // ── 2 · it receives the whole stream, which is what owning MEANS ────────────────────────
      const requestId = await parkOnAQuestion(sessionId, PLANNER)
      await waitFor(
        () => anAgentsSink.events().some((event) => event.type === 'permission_request'),
        'the card to reach the sink that claimed the conversation',
      )
      // ⚠️ **The paired reading that makes the refusal below mean something**: it is not being
      // refused because it was cut off. It was told everything, including the question.
      expect(anAgentsSink.events().filter((event) => event.type === 'permission_request')).toEqual([
        expect.objectContaining({ id: requestId }),
      ])

      // ── 3 · …and it cannot answer the question it was shown ─────────────────────────────────
      //
      // 🔴 **This is the defect 340 named, closed.** Before this dispatch the caller below owned the
      // session, `slot.ownerId === by.ownerId` was the whole of `mayAnswerAsAHuman`, and this call
      // returned an ack.
      expect(
        await refusalOf(() =>
          host.respondPermission(sessionId, requestId, { outcome: 'allow' }, anAgentsSink),
        ),
      ).toBe(A_PERSON)
      // …and it is refused as a caller that MAY drive this conversation, not as a stranger.
      expect(A_PERSON).not.toBe(NOT_YOURS)
      // …and the card is still open, so nothing was answered on the way to the refusal. ⚠️ Read
      // from the LEDGER rather than by sending again: the turn is parked on this card, so a second
      // send would be refused for a reason that has nothing to do with this dispatch.
      expect(requestIn(ledger(sessionId))).toBe(requestId)

      // ── 4 · the paired positive, on the SAME session and the SAME card ──────────────────────
      //
      // ⛔ **One field apart.** The sink below differs from the one above in `aPersonIsBehindIt` and
      // in nothing else that either door reads — same class, same alive, same everything — so what
      // is measured here is the declaration and not the fixture.
      await host.closeSessionsForOwner(anAgentsSink.ownerId)
      expect(host.unclaimedSessions().map((entry) => entry.sessionId)).toEqual([sessionId])
      const asAPerson = new Surface(anAgentsSink.ownerId, true)
      host.claimSession(sessionId, asAPerson)
      // ⚠️ **The ack, which is the host's own word for "this was taken"** — not a later effect, so
      // the assertion cannot pass on a timing accident.
      expect(
        await host.respondPermission(sessionId, requestId, { outcome: 'allow' }, asAPerson),
      ).toEqual({ outcome: 'taken' })
    })

    it('⚠️ the app itself is still turned away, and it is the only door that turns it away', async () => {
      // ⛔ 340 §2's second direction, and §3.2 of this dispatch says keep it. `THE_APP_ITSELF` means
      // *"nobody is asking"*, and nobody is precisely who may not answer for a person — so it is
      // refused even now that the slot carries a person of its own.
      const sessionId = await spawn()
      host.claimSession(sessionId, aWindow)
      const requestId = await parkOnAQuestion(sessionId, PLANNER)
      expect(
        await refusalOf(() =>
          host.respondPermission(sessionId, requestId, { outcome: 'allow' }, THE_APP_ITSELF),
        ),
      ).toBe(A_PERSON)
      // ⚑ …and the paired positive that keeps it the ONLY door: the same superuser may still close
      // this conversation, which is what makes the refusal above about the gesture and not the
      // caller.
      await host.close(sessionId, THE_APP_ITSELF)
    })

    it('a session nobody ever claimed: a window answers it from the queue, its commander is refused', async () => {
      const sessionId = await spawn()
      const requestId = await parkOnAQuestion(sessionId, PLANNER)
      // The commander, which can drive it, is told it is a person's to answer.
      expect(
        await refusalOf(() =>
          host.respondPermission(sessionId, requestId, { outcome: 'allow' }, PLANNER),
        ),
      ).toBe(A_PERSON)
      // A sink that only says a person is behind it, and is no window, is a stranger here.
      expect(
        await refusalOf(() =>
          host.respondPermission(
            sessionId,
            requestId,
            { outcome: 'allow' },
            new Surface('mcp:somebody', true),
          ),
        ),
      ).toBe(HELD_BY_NOBODY)
      expect(HELD_BY_NOBODY).not.toBe(NOT_YOURS)
      await expect(
        host.respondPermission(sessionId, requestId, { outcome: 'allow' }, aWindow),
      ).resolves.toMatchObject({ outcome: 'taken' })
    })
  })

  // ── §2 · ownership is exactly where 340 left it ─────────────────────────────────────────────
  describe('§2 · what a claim still buys a caller with no person behind it', () => {
    it('⛔ it owns the conversation in every other sense — and a release gives both halves back', async () => {
      const sessionId = await spawn('auto')
      host.claimSession(sessionId, anAgentsSink)

      // Everything `mayControl` gates, from an owner a person is not behind.
      await host.send(sessionId, 'work', anAgentsSink)
      host.refreshConfig(sessionId, anAgentsSink)
      await host.stopBackgroundWork(sessionId, 'x', anAgentsSink)

      // 🔴 **A release puts BOTH halves back**, so the next claimer decides personhood again rather
      // than inheriting the last one's. Measured through the door rather than by reading the slot:
      // after the release the conversation is claimable, and a person who takes it can answer.
      await host.closeSessionsForOwner(anAgentsSink.ownerId)
      expect(host.unclaimedSessions().map((entry) => entry.sessionId)).toEqual([sessionId])
      await host.setApprovalMode(sessionId, 'ask', THE_APP_ITSELF)
      host.claimSession(sessionId, aWindow)
      const requestId = await parkOnAQuestion(sessionId, PLANNER)
      await host.respondPermission(sessionId, requestId, { outcome: 'allow' }, aWindow)

      // ⚠️ …and back the other way, which is the half a stale `true` would have hidden: the same
      // conversation, released by the person and claimed by the agent's sink, refuses again.
      await host.closeSessionsForOwner(aWindow.ownerId)
      host.claimSession(sessionId, anAgentsSink)
      const second = await parkOnAQuestion(sessionId, PLANNER)
      // ⛔ **A DIFFERENT card, and 340 wrote this trap down.** Re-refusing the card a person has
      // already answered would be a refusal about a request id that no longer means anything, and
      // it would pass on a session whose re-claim had changed nothing.
      expect(second).not.toBe(requestId)
      expect(cardsIn(sessionId)).toEqual([requestId, second])
      expect(
        await refusalOf(() =>
          host.respondPermission(sessionId, second, { outcome: 'allow' }, anAgentsSink),
        ),
      ).toBe(A_PERSON)
    })

    it('🔴 the door 349 leaves open, pinned so the next dispatch can find it', async () => {
      // ⛔ **`setApprovalMode` asks `mayControl` — ownership — and 349 did not move it.** A caller
      // that owns this conversation without a person behind it therefore cannot answer a card and
      // CAN stop the cards being raised, which is 340's own sentence about the same verb: *"a
      // commander that could set a session to `auto` would have answered every permission prompt it
      // will ever raise, in advance"*.
      //
      // ⚠️ **It is not a regression and this test is not a complaint.** The same caller could
      // ANSWER before this dispatch, through the front door, silently. What 349 costs it is that
      // the only route left is a recorded, disclosed state change: `approvalMode` goes to `auto`,
      // the header says so, and the ledger has it. ⛔ **Closing it is a ruling about what an OWNER
      // may do, which §3.1 put out of scope** — see the response doc for the three answers priced.
      // ⚑ **Two conversations, because the two facts cannot be measured on one.** Turning approvals
      // off is exactly what stops a card being raised, so a session that has been switched has
      // nothing left to refuse an answer about — measuring both here would measure neither.
      const parked = await spawn()
      host.claimSession(parked, anAgentsSink)
      const requestId = await parkOnAQuestion(parked, PLANNER)
      // The rail, holding — this is the whole of what 349 bought.
      expect(
        await refusalOf(() =>
          host.respondPermission(parked, requestId, { outcome: 'allow' }, anAgentsSink),
        ),
      ).toBe(A_PERSON)

      // ⛔ …and the door, open. The SAME caller, on a conversation it owns the same way.
      const switched = await spawn()
      host.claimSession(switched, anAgentsSink)
      const disclosure = await host.setApprovalMode(switched, 'auto', anAgentsSink)
      expect(disclosure.pendingApprovalMode ?? disclosure.approvalMode).toBe('auto')
      // ⚠️ **And it is loud rather than silent, which is the part 349 did change.** The state a
      // caller has to reach for is recorded and disclosed — the header draws it — where answering
      // a card would have left nothing on any screen. ⛔ Read back from the SESSION rather than
      // from the call's own return value, and paired with the conversation that was not switched,
      // so neither line can be satisfied by a default.
      const disclosed = new Map(
        host
          .attachOpenSessions(anAgentsSink)
          .map((one) => [one.sessionId, one.pendingApprovalMode] as const),
      )
      // ⚑ **`pending`, because neither provider can change the mode of a turn already running**
      // (034) — the caller got exactly what it asked for, from the next turn on.
      expect(disclosed.get(switched)).toBe('auto')
      expect(disclosed.get(parked)).toBe(null)
    })

    it('⚠️ a window that creates its own session may answer it without claiming anything', async () => {
      // ⛔ The reservation path, which is the other place the declaration is written. A session
      // created WITH a sink takes its owner and its person from that sink in one bag.
      const { sessionId } = await host.createSession(
        { provider: 'claude', cwd: userData, approvalMode: 'ask' },
        aWindow,
      )
      const requestId = await parkOnAQuestion(sessionId, aWindow)
      await host.respondPermission(sessionId, requestId, { outcome: 'allow' }, aWindow)

      // ⚑ …and the same door, one field over: a session created by a sink that says nothing has no
      // person, so its own creator cannot answer it.
      const headless = new Surface('mcp:headless', false)
      const made = await host.createSession(
        { provider: 'claude', cwd: userData, approvalMode: 'ask' },
        headless,
      )
      const asked = await parkOnAQuestion(made.sessionId, headless)
      expect(
        await refusalOf(() =>
          host.respondPermission(made.sessionId, asked, { outcome: 'allow' }, headless),
        ),
      ).toBe(A_PERSON)
    })
  })

  // ── §3 · the disclosure HO-006 §4.5 asked for ───────────────────────────────────────────────
  describe('§3 · a person taking a conversation over is told an agent can still drive it', () => {
    it('🔴 the claim carries it, and a session nobody commands says so too', async () => {
      const commanded = await spawn('auto')
      const handed = host.claimSession(commanded, aWindow)
      expect(handed.hasACommander).toBe(true)

      // ⛔ **The paired negative, or `true` above is satisfied by a constant.** A window's own
      // conversation is commanded by nobody and says so. ⚠️ **It is a DIFFERENT builder** — this one
      // is `startSessionInProfile`'s literal, the `true` above is `discloseReopened`'s — which is
      // why both are needed: one hard-coded `true` would leave the other half green. The demo test
      // pairs the claim path against itself.
      const mine = await host.createSession(
        { provider: 'claude', cwd: userData, approvalMode: 'auto' },
        anotherWindow,
      )
      expect(mine.hasACommander).toBe(false)
    })

    it('⛔ the host-side list names the commander, in both of its two states', async () => {
      // ⚑ 340's own gap: *"`commandedBy` is not on `UnclaimedSession`"*. Unowned is not the same as
      // unattended, and a caller choosing what to offer a person could not tell them apart.
      const sessionId = await spawn('auto')
      expect(host.unclaimedSessions()).toEqual([
        expect.objectContaining({ sessionId, running: true, commandedBy: PLANNER.ownerId }),
      ])
      // ⛔ **The paired negative, or the line above is satisfied by a constant.** A session nobody
      // was given command of carries `null` — the third state 074 exists for — through the same
      // field, on the same arm.
      const nobodys = await host.createSession(
        { provider: 'claude', cwd: userData, approvalMode: 'auto' },
        null,
      )
      expect(
        host
          .unclaimedSessions()
          .map((entry) => [entry.sessionId, entry.commandedBy] as const)
          .sort(),
      ).toEqual([
        [sessionId, PLANNER.ownerId],
        [nobodys.sessionId, null],
      ])
    })

    it('⚠️ a reservation already knows who may drive it, before its provider arrives', async () => {
      // ⛔ **The other arm of the union, and it needs its own reading** (074). `commandedBy` is
      // fixed at reservation, so a slot whose provider has not arrived can already answer *"who may
      // drive this"* — and a list that only carried it on the running arm would make *"nobody
      // commands it"* and *"we have not got that far"* one value again.
      const gate = new FakeLaunchGate()
      runtimes.set('codex', new CapturingRuntime('codex', { gate }))
      const opening = host.createSession({ provider: 'codex', cwd: userData }, null, PLANNER)
      // Test hygiene, not product behaviour: a red assertion below would otherwise leave this
      // launch pending and its rejection would land on whichever test ran next.
      opening.catch(() => {})
      await waitFor(() => host.unclaimedSessions().length === 1, 'the reservation')
      expect(host.unclaimedSessions()).toEqual([
        {
          sessionId: 'sess_1',
          since: expect.any(Number) as number,
          commandedBy: PLANNER.ownerId,
          running: false,
        },
      ])
      gate.release()
      await opening
    })

    it('⚠️ a restart hands the conversation back commanded by nobody, and the disclosure agrees', async () => {
      // ⛔ Nothing persists a commanding relationship (340 §0), so a reopened conversation is a
      // person's. The disclosure must not remember what the slot deliberately forgot.
      const sessionId = await spawn('auto')
      await host.send(sessionId, 'before the restart', PLANNER)
      await waitFor(
        () => ledger(sessionId).some((event) => event.type === 'turn'),
        'the commanded turn to land in the ledger',
      )
      await host.closeAll()
      host = buildHost()
      const resumed = await host.resumeSession(sessionId, aWindow)
      expect(resumed.hasACommander).toBe(false)
      // ⚑ …and it is a person's conversation in the other sense too, which is what makes the line
      // above a fact rather than a default: the window that reopened it owns it and can answer for
      // it. ⚠️ The mode is switched back first — the conversation was created `auto` so nothing
      // would stop to ask — and that switch is itself a gesture only its owner may make.
      await host.setApprovalMode(sessionId, 'ask', aWindow)
      const requestId = await parkOnAQuestion(sessionId, aWindow)
      await host.respondPermission(sessionId, requestId, { outcome: 'allow' }, aWindow)
      // ⛔ …and the agent that commanded it before the restart is a stranger now.
      expect(await refusalOf(() => host.send(sessionId, 'still mine?', PLANNER))).toBe(NOT_YOURS)
    })
  })

  // ── §4 · the census, kept as the belt to this dispatch's braces (§3.5) ──────────────────────
  describe('§4 · what the source still has to say for itself', () => {
    it('⚠️ the predicate refuses by declaration, not by the shape of an id', () => {
      // ⛔ **A `webContents:` prefix is not a person and must never become one.** The ids are two
      // namespaces minted at two boundaries, and a rail that read the prefix would be a convention
      // wearing a check's clothes — the exact thing §3.3 forbids.
      const looksLikeAWindow = { ownerId: 'webContents:9', ownerIsAPerson: false }
      expect(mayAnswerAsAHuman(looksLikeAWindow, { ownerId: 'webContents:9' })).toBe(false)
      const looksLikeAnAgent = { ownerId: 'mcp:planner', ownerIsAPerson: true }
      expect(mayAnswerAsAHuman(looksLikeAnAgent, PLANNER)).toBe(true)
    })
  })
})
