import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
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
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import {
  RuntimeHost,
  THE_APP_ITSELF,
  mayAnswerAsAHuman,
  type CallerIdentity,
  type RuntimeEventSink,
} from '../src/main/runtime/runtime-host'
import { describeUnavailable } from '../src/main/runtime/session-unavailable'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

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

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

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

    it('⛔ a person behind ANOTHER window is still refused — 062 was not spent buying this', async () => {
      const sessionId = await spawn()
      host.claimSession(sessionId, aWindow)
      const requestId = await parkOnAQuestion(sessionId, PLANNER)
      // ⚠️ `anotherWindow` declares a person and is one; what it is not is THIS conversation's —
      // so the refusal below is `not-yours` and not `a-person-must-answer`, and the two really are
      // different sentences.
      expect(NOT_YOURS).not.toBe(A_PERSON)
      expect(
        await refusalOf(() =>
          host.respondPermission(sessionId, requestId, { outcome: 'allow' }, anotherWindow),
        ),
      ).toBe(NOT_YOURS)
      // …and the window that has it can answer, so the refusal is about which window.
      await host.respondPermission(sessionId, requestId, { outcome: 'allow' }, aWindow)
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
      // …and a stranger is still refused all of it, so the passes above are about ownership.
      expect(await refusalOf(() => host.send(sessionId, 'mine', anotherWindow))).toBe(NOT_YOURS)

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
    /**
     * ⛔ **Prose stripped, and that is the instrument rather than a nicety.** Both files that
     * implement the sink argue about this field at length, so a census over raw text counts the
     * paragraph explaining the rule as an instance of breaking it — and a comment added under
     * `src/main` saying *"never write `aPersonIsBehindIt: true` on a non-window sink"* would turn
     * this red for a change that declares nothing.
     */
    const strippedOfProse = (code: string): string =>
      code
        .split('\n')
        .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
        .join('\n')

    const mainSources = (): { path: string; code: string }[] =>
      readdirSync(join(here, '../src/main'), { recursive: true, encoding: 'utf8' })
        .filter((entry) => entry.endsWith('.ts'))
        .map((entry) => join(here, '../src/main', entry))
        .map((path) => ({ path, code: strippedOfProse(readFileSync(path, 'utf8')) }))

    /**
     * ⛔ **BOTH spellings, and the second one is the whole point.** A sink written as an object
     * literal says `aPersonIsBehindIt: true`; a sink written as a class — which is how all 47 of
     * this repository's own doubles are written — says `readonly aPersonIsBehindIt = true`. A
     * census that saw only the first would let a class-shaped production sink walk past it, which
     * is exactly the surface this is watching for.
     */
    const DECLARES_A_PERSON = /aPersonIsBehindIt\s*[:=]\s*true/g

    it('🔴 exactly one thing in the app says a person is behind it, and it is the window sink', () => {
      // ⛔ **The census 340 wrote, asked of the new field.** 340's version counts the callers of the
      // claim door; this one counts the sinks that claim to be a person, because that is what the
      // door now reads. ⚠️ A new non-window transport cannot compile without answering — the field
      // is required — so what this catches is the OTHER mistake: answering `true`.
      const sources = mainSources()
      // Non-vacuity: the sweep really reached the two files that implement the interface.
      expect(
        sources
          .map((file) => file.path)
          .filter((path) => path.replaceAll('\\', '/').endsWith('runtime/ipc.ts')),
      ).toHaveLength(1)
      expect(
        sources
          .map((file) => file.path)
          .filter((path) => path.replaceAll('\\', '/').endsWith('runtime/runtime-host.ts')),
      ).toHaveLength(1)

      // ⚑ **Non-vacuity for the PATTERN as well as for the sweep**: it really does match both
      // spellings, so its silence over `src/main` means something about classes too.
      expect('  aPersonIsBehindIt: true,'.match(DECLARES_A_PERSON)).toHaveLength(1)
      expect('  readonly aPersonIsBehindIt = true'.match(DECLARES_A_PERSON)).toHaveLength(1)
      expect('  readonly aPersonIsBehindIt = false'.match(DECLARES_A_PERSON)).toBeNull()

      const declaring = sources.flatMap((file) =>
        (file.code.match(DECLARES_A_PERSON) ?? []).map(() => file.path),
      )
      expect(declaring).toHaveLength(1)
      expect(declaring[0]).toMatch(/runtime[\\/]ipc\.ts$/)

      // ⚑ …and it is the sink built from a real `WebContents`, not some other literal in that file.
      const ipc = strippedOfProse(readFileSync(join(here, '../src/main/runtime/ipc.ts'), 'utf8'))
      expect(ipc).toContain(
        "export function webContentsSink(\n  contents: WebContents,\n  timing?: Pick<MainThreadWork, 'start'>,\n): RuntimeEventSink {",
      )
      expect(ipc.slice(ipc.indexOf('export function webContentsSink'))).toContain(
        'aPersonIsBehindIt: true',
      )
      // …and the one place a sink is minted for the running app is still the one place.
      const index = readFileSync(join(here, '../src/main/index.ts'), 'utf8')
      expect(index).toContain('sinkFor: (event) => webContentsSink(event.sender, mainThreadWork)')
      expect((index.match(/sinkFor:/g) ?? []).length).toBe(1)
    })

    it('⛔ the answer door reads the declaration, and the predicate is the only thing that does', () => {
      // ⚠️ **A census over the RULE rather than over a file list.** `ownerIsAPerson` exists to be
      // read by one predicate; a second reader would be a second place deciding what a person is,
      // which is 169 §1. The slot's own three writes are not readers and are counted apart.
      // ⛔ Prose stripped first: this file argues about the field at length, and a docblock quoting
      // it would count as a reader.
      const code = strippedOfProse(
        readFileSync(join(here, '../src/main/runtime/runtime-host.ts'), 'utf8'),
      )
      // ⛔ **Every mention, then the writes subtracted — NOT a pattern for the one read shape.**
      // A search for `slot.ownerIsAPerson &&` can only see a read written as the left conjunct of
      // an `&&` on a variable literally called `slot`; `if (slot.ownerIsAPerson)`,
      // `held.ownerIsAPerson ? …` and `const person = slot.ownerIsAPerson` would every one of them
      // be a second decider that left this green. ⚑ A negative is only as strong as the shape it
      // could have found, so the shape here is *any mention at all*.
      const mentions = code.match(/\bownerIsAPerson\b/g) ?? []
      // Seven of the ten name the field with a colon or an `=`: the predicate's parameter type,
      // `SessionSlot`'s field, `reserve`'s `held` type, the two reserve call sites, the claim and
      // the release. Every one of them declares or writes; none decides anything.
      const declaredOrWritten = code.match(/\bownerIsAPerson\s*[?]?\s*[:=][^=]/g) ?? []
      // ⚑ **TWELVE since `439`, and the two it added are READERS that REPORT rather than decide**
      // — which is the distinction this whole assertion is built to keep visible.
      //
      // ⛔ **Neither gates anything.** `originOf` puts the fact on a `TurnOrigin` so
      // `messageNamingItsSender` can say *a person is at that conversation*; `noteTheSending` puts
      // it on the sender's own `message_sent` row. ⚠️ **A reader that DECIDED would be the defect**
      // `349` closed — an agent that could reach a person's answer door — and the predicate below
      // is still the only thing in this file on the left of an `&&`.
      //
      // 🔴 **And the direction matters**: both new sites read the SLOT and neither reads anything a
      // caller said, so the value they render is the one a sink declared at the moment it took
      // ownership. A model cannot spell either of them.
      // ⚑ **THIRTEEN since `441`, and the one it added is a RAIL rather than a reader** — the first
      // site in this file on the left of an `&&`… and it is not one: `if (!slot.ownerIsAPerson)`
      // refuses a proposal in a conversation nobody is watching, which is the field DECIDING for the
      // first time since `349`.
      //
      // ⛔ **That is a widening and it is named here rather than absorbed.** `349`'s defect was an
      // agent reaching a PERSON's answer door; this refuses an agent's own verb for the absence of a
      // person, so it narrows in the same direction the predicate does. ⚠️ **It reads the SLOT of
      // the conversation the card would land in**, never anything a caller said — a model cannot
      // spell it, and `a-person-flag-is-about-the-owner` is the rule it follows.
      // ⚑ **FOURTEEN since D-017 · R3, and the one it added is `439`'s reader again** — a message a
      // quit left held is rebuilt from its row at the next start (`rebuiltFromItsRow`), and its
      // `TurnOrigin` says whether a person is at the SENDING conversation, off that conversation's
      // SLOT exactly as `originOf` does. ⛔ It REPORTS and gates nothing, and reads nothing a caller
      // said: the relaying conversation's id comes off the row's own authorship.
      // ⚑ **THIRTEEN again since D-016**: `441`'s rail went with `proposeProject`, so the field
      // DECIDES nowhere but in the predicate once more.
      // ⚑ **FOURTEEN with a service's first launch** (`startTheRecordedService`): its reservation
      // writes what the window that starts it declared, as `createSession`'s and a reopen's do. It
      // declares and decides nothing.
      expect(mentions).toHaveLength(14)
      expect(declaredOrWritten).toHaveLength(8)
      // ⛔ **And the six that are left are named individually**, so this can only stay green while
      // each of them is still exactly what it is. A seventh would push `mentions` past thirteen and
      // turn the first assertion red whatever shape it was written in — which is the point: the
      // search is *any mention*, not one read's spelling.
      // ⚑ **661 · the destructure grew `anAgentAskedForIt`** (`656` F2) — a birth fact, and not a
      // read of `ownerIsAPerson`, so the six reads this counts are the same six. ⚑ **681 · and
      // `projectSlug`** (R30a), another birth fact, which D-016 took back out — so the destructure
      // fits one line again, and the pin is that line whole.
      expect(code).toContain(
        'const { ownerId, ownerIsAPerson, commandedBy, spawnedBy, profileId, anAgentAskedForIt } = held',
      )
      // ⚠️ **681 · counted, not merely found** (found by `681`'s review): while the destructure was
      // multi-line at the same indent, a bare `toContain` here was satisfied by it alone. ⚑ One
      // since D-016: the slot literal, the destructure being one line again.
      expect(code.split('\n      ownerIsAPerson,\n')).toHaveLength(2)
      expect(code).toContain('slot.ownerIsAPerson && slot.ownerId === by.ownerId')
      // …and 439's two, which report the value and gate nothing.
      expect(code).toContain('aPersonIsBehindIt: this.slots.get(conversation)?.ownerIsAPerson')
      expect(code).toContain('onBehalfOfAPerson: slot.ownerIsAPerson,')
      // …and D-017's one, `originOf`'s reading for a message rebuilt from its row.
      expect(code).toContain('(caller) => this.slots.get(caller)?.ownerIsAPerson ?? false,')
      // …and the two writes, spelled out, because a mutation puts each of them back.
      expect(code).toContain('slot.ownerIsAPerson = sink.aPersonIsBehindIt')
      expect(code).toContain('slot.ownerIsAPerson = false')
      // ⛔ **§3.3's rule, which nothing else can see.** *"Declaring must be explicit, never a
      // default"* — a `?` here would let the next sink omit the answer and be safe by accident
      // rather than by decision, and every existing site would go on compiling. ⚠️ Asserted over
      // the prose-stripped source, because the paragraph above that line argues about the word
      // `required` at length and a docblock is not a declaration.
      expect(code).toContain('  readonly aPersonIsBehindIt: boolean\n')
      expect(code).not.toContain('aPersonIsBehindIt?:')
    })

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
