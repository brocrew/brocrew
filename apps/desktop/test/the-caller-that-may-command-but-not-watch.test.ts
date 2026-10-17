import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
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
  RuntimeHost,
  THE_APP_ITSELF,
  mayAnswerAsAHuman,
  mayCommand,
  mayControl,
  type CallerIdentity,
  type RuntimeEventSink,
} from '../src/main/runtime/runtime-host'
import { describeUnavailable } from '../src/main/runtime/session-unavailable'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/**
 * 🔴 **340 · the caller that may command but not watch.**
 *
 * ⛔ **336 opened a door and then measured what was behind it**: *"the door lets a session EXIST
 * without a renderer. It does not let anything DRIVE one."* Every control verb asks `mayControl`,
 * which for an owner of `null` admits only {@link THE_APP_ITSELF} — so a spawned agent sat idle
 * until a person took it over, which is the opposite of what spawning one is for.
 *
 * ## ⚑ The shape, in three sentences
 *
 * **`ownerId` answers three questions at once** — who may command, who is receiving, whose departure
 * ends it — **and a caller with no surface answers YES to the first and NO to the other two.** So
 * the first question moved to its own field, `commandedBy`, read by its own predicate,
 * {@link mayCommand}. ⛔ **And a third predicate is NARROWER than both**: a commanding caller may
 * hand this session work and may not decide what that work is allowed to do.
 *
 * ## 🔴 Why this file exists rather than a widened `mayControl`
 *
 * HO-005 Q2, ruled 2026-09-05: *"Permissions: always the human. Never a parent agent. An agent
 * answering another agent's permission prompt is the kill switch with extra steps. Build it so no
 * path exists."* ⚑ **A gate nobody has watched fail is a claim** — so every refusal below is
 * performed, each against the same call one identity over, and the paired positive is always in the
 * same test.
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

class RecordingSink implements RuntimeEventSink {
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  /**
   * ⛔ **Both parameters are required, and in THIS file that is the subject rather than caution**
   * (349). Every other suite's double is a window or is not; this one holds one of each on purpose —
   * `one` and `two` are windows, `pretender` is a caller with the commander's own id — and a
   * default would let the file's whole question be answered by whichever value happened to be it.
   */
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
  ordinals(): number[] {
    return this.messages.map((message) => message.ordinal)
  }
}

/**
 * ⛔ **The commanding caller, and it is deliberately NOT a sink.** A {@link CallerIdentity} is the
 * whole of what a caller with no surface is: a stable id it did not choose for itself. Nothing here
 * can receive an event, which is not a limitation of the double — it is the second of the three
 * questions, answered `no`.
 */
const PLANNER: CallerIdentity = { ownerId: 'mcp:planner' }
/** A second agent, which was given nothing. Every refusal below is measured against this one too. */
const STRANGER: CallerIdentity = { ownerId: 'mcp:other' }

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

function markerIn(event: TranscriptEvent): string[] {
  return event.type === 'activity' && event.detail !== undefined ? [event.detail] : []
}

/**
 * 🔴 **421 split the sentence this file was written against, and every session in it is unowned.**
 *
 * ⛔ A session an agent spawned has `ownerId === null`, and until 421 a refused control verb on one
 * answered *"This conversation belongs to another window… switch to that window"* — which named a
 * window that does not exist. ⚑ The refusals below are the same refusals; what changed is which of
 * the two sentences they read, and {@link NOT_YOURS} is kept because the case it IS true of is
 * asserted beside them.
 */
const HELD_BY_NOBODY = describeUnavailable('held-by-nobody')
const NOT_YOURS = describeUnavailable('not-yours')
const A_PERSON = describeUnavailable('a-person-must-answer')

describe('340 · a session an agent may drive and may not decide for', () => {
  let userData: string
  let db: AppDatabase
  let host: RuntimeHost
  let store: SessionStore
  let runtimes: Map<Provider, CapturingRuntime>
  let one: RecordingSink
  let two: RecordingSink
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-commanded-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    runtimes = new Map()
    handles.clear()
    store = createSessionStore(db)
    counter = 0
    host = buildHost()
    one = new RecordingSink('webContents:1', true)
    two = new RecordingSink('webContents:2', true)
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  const handles = new Map<string, FakeSessionHandle>()

  const provider = (): CapturingRuntime => {
    const held = runtimes.get('claude')
    if (held === undefined) throw new Error('no claude runtime was built')
    return held
  }

  /**
   * ⛔ **`approvalMode` is a PARAMETER of this helper and never a default**, because the two halves
   * of this dispatch need opposite ones: a turn that has to finish with nobody watching needs
   * `auto`, and a turn that has to stop and ask a person needs `ask`. Getting that wrong is how a
   * permission test passes by never raising a card.
   */
  const spawn = async (
    options: {
      commandedBy?: CallerIdentity | null
      sink?: RecordingSink | null
      approvalMode?: 'ask' | 'auto'
    } = {},
  ): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', cwd: userData, approvalMode: options.approvalMode ?? 'ask' },
      options.sink ?? null,
      options.commandedBy ?? null,
    )
    handles.set(sessionId, provider().latest())
    return sessionId
  }

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  /**
   * ⛔ **What the provider ECHOED, matched on the words and not on a prefix** (re-pointed at 414).
   *
   * ⚠️ **These waits used to read `JSON.stringify(ledger(id)).includes('echo: DO IT')`**, which
   * assumed the app puts NOTHING in front of a caller's words. `414` composes an origin line for
   * every turn an AGENT sends — and every send in this file is a commander's — so the echo now
   * reads ``echo: Sent by `sess_…`.\n\nDO IT``. ⚑ The claim is unchanged and the instrument had
   * to stop depending on the words being first.
   */
  const providerEchoed = (sessionId: string, words: string): boolean =>
    ledger(sessionId).some(
      (event) =>
        event.type === 'assistant_message' &&
        event.text.startsWith('echo: ') &&
        event.text.includes(words),
    )

  async function agentSays(sessionId: string, text: string): Promise<void> {
    const handle = handles.get(sessionId)
    if (handle === undefined) throw new Error(`no provider handle held for ${sessionId}`)
    handle.simulateActivity('thinking', text)
    await waitFor(
      () => ledger(sessionId).flatMap(markerIn).includes(text),
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

  /** The id of the one open card, from the ledger. */
  function requestIn(events: readonly TranscriptEvent[]): string {
    for (const event of events) {
      if (event.type === 'permission_request') return event.id
    }
    throw new Error('no permission request among these events')
  }

  /** Drive a session up to the card it stops on, with whoever is entitled to drive it. */
  async function parkOnAQuestion(sessionId: string, by: CallerIdentity): Promise<string> {
    await host.send(sessionId, 'touch a file', by)
    await waitFor(
      () => ledger(sessionId).some((event) => event.type === 'permission_request'),
      'the card',
    )
    return requestIn(ledger(sessionId))
  }

  // ── §1 · the three questions ownerId used to answer at once ─────────────────────────────────
  describe('§1 · a second axis, not a second owner', () => {
    it('🔴 the commander can drive it — and the SAME call one identity over cannot', async () => {
      const sessionId = await spawn({ commandedBy: PLANNER, approvalMode: 'auto' })

      // ⛔ The refusal FIRST, so the success below is a statement about the identity and not about
      // the session happening to be drivable — 340 §4's rule, and this is the one row it is about.
      expect(await refusalOf(() => host.send(sessionId, 'DO IT', STRANGER))).toBe(HELD_BY_NOBODY)

      await host.send(sessionId, 'DO IT', PLANNER)
      await waitFor(() => providerEchoed(sessionId, 'DO IT'), 'the commanded turn to finish')
    })

    it('⛔ …and the same session spawned with NO commander refuses that identical caller', async () => {
      // ⚠️ The control for the row above, differing in exactly one argument: what makes the send
      // legal is the spawn naming this caller, not the caller being an agent.
      const sessionId = await spawn({ approvalMode: 'auto' })
      expect(await refusalOf(() => host.send(sessionId, 'DO IT', PLANNER))).toBe(HELD_BY_NOBODY)
      // ⚠️ Asked of the TURN and not of the whole ledger: a session that opened has a `session` and
      // a `status` event in it either way, and asserting an empty ledger would have been a test
      // about the launch rather than about the refusal.
      expect(ledger(sessionId).map((event) => event.type)).not.toContain('user_turn')
    })

    it('🔴 all five spellings of “give it work”, and only those five', async () => {
      // ⛔ **One gesture with five spellings, and splitting them would make *"may this agent drive
      // this session"* depend on whether it happened to be busy when it was asked.** Every verb is
      // pressed by the commander and by a stranger in the same breath, so each line is a statement
      // about the identity rather than about the verb working at all.
      // ⚠️ **`ask`, so the first turn STAYS running** — it stops on a card nobody will answer. Two
      // of the five verbs are only reachable against a busy session, and against an idle one
      // `queueMessage` sends instead of queueing, so `cancelQueuedMessage` would then have nothing
      // to cancel and the row would be about the wrong thing.
      const sessionId = await spawn({ commandedBy: PLANNER, approvalMode: 'ask' })
      await parkOnAQuestion(sessionId, PLANNER)
      expect(await refusalOf(() => host.send(sessionId, 'one', STRANGER))).toBe(HELD_BY_NOBODY)

      const held = await host.queueMessage(sessionId, 'three', PLANNER)
      expect(held.outcome).toBe('queued')
      expect(await refusalOf(() => host.queueMessage(sessionId, 'three', STRANGER))).toBe(
        HELD_BY_NOBODY,
      )
      const messageId = held.outcome === 'queued' ? held.messageId : ''

      await host.cancelQueuedMessage(sessionId, messageId, PLANNER)
      // 🔴 **ENTITLEMENT BEFORE EXISTENCE, and 354 gave this row a second way to go wrong** (341).
      // The commander has just taken the message, so by the time the stranger asks there is nothing
      // held and the id it names is stale — two other true sentences this call could answer with.
      // ⛔ It must still answer *"not yours"*: a stranger that could tell *"no such message"* from
      // *"already gone"* would be reading the state of a conversation it may not touch.
      expect(await refusalOf(() => host.cancelQueuedMessage(sessionId, messageId, STRANGER))).toBe(
        HELD_BY_NOBODY,
      )

      await host.sendInterrupting(sessionId, 'two', PLANNER)
      expect(await refusalOf(() => host.sendInterrupting(sessionId, 'two', STRANGER))).toBe(
        HELD_BY_NOBODY,
      )

      await host.interrupt(sessionId, PLANNER)
      expect(await refusalOf(() => host.interrupt(sessionId, STRANGER))).toBe(HELD_BY_NOBODY)
    })

    it('⛔ …and every OTHER verb is still the owner’s alone', async () => {
      // ⚑ The other half of the same claim: the widening is a list, not a direction. A commander
      // cannot end this conversation, cannot change what it may do, cannot reconfigure it, and
      // cannot speak to its children.
      const sessionId = await spawn({ commandedBy: PLANNER, approvalMode: 'auto' })

      expect(await refusalOf(() => host.close(sessionId, PLANNER))).toBe(HELD_BY_NOBODY)
      expect(await refusalOf(() => host.setApprovalMode(sessionId, 'auto', PLANNER))).toBe(
        HELD_BY_NOBODY,
      )
      expect(
        await refusalOf(() =>
          host.setSessionSetting(sessionId, { kind: 'planMode', on: true }, PLANNER),
        ),
      ).toBe(HELD_BY_NOBODY)
      expect(await refusalOf(() => host.refreshConfig(sessionId, PLANNER))).toBe(HELD_BY_NOBODY)
      expect(await refusalOf(() => host.stopBackgroundWork(sessionId, 'x', PLANNER))).toBe(
        HELD_BY_NOBODY,
      )
      expect(await refusalOf(() => host.readChildState(sessionId, 'agent', PLANNER))).toBe(
        HELD_BY_NOBODY,
      )

      // ⚑ …and the owner of a session really can do all of that, so the six refusals above are
      // about the caller and not about six verbs that refuse everybody.
      const owned = await spawn({ sink: one, approvalMode: 'auto' })
      await host.setApprovalMode(owned, 'auto', one)
      await host.setSessionSetting(owned, { kind: 'planMode', on: true }, one)
      host.refreshConfig(owned, one)
      await host.stopBackgroundWork(owned, 'x', one)
      await host.close(owned, one)
    })

    it('⛔ it is still nobody’s: the commander does not own it and cannot be handed it', async () => {
      const sessionId = await spawn({ commandedBy: PLANNER })

      // Owning is a different question, and it is still answered `null`.
      expect(host.unclaimedSessions().map((entry) => entry.sessionId)).toEqual([sessionId])
      // ⛔ **The second of the three questions, answered no.** A sink presenting the commander's own
      // id — which is more than a real commander has, since it has no sink at all — is handed
      // nothing, because `attachOpenSessions` asks `mayControl` and 340 did not widen that.
      // ⚠️ **`false`, and 349 is what makes that word available** (349). The sentence above —
      // *"more than a real commander has, since it has no sink at all"* — is exactly the shape 340
      // could only assert about the callers that existed. A sink now SAYS whether a person is
      // behind it, and a commander's does not.
      const pretender = new RecordingSink(PLANNER.ownerId, false)
      expect(host.attachOpenSessions(pretender)).toEqual([])
      await agentSays(sessionId, 'nobody is listening')
      expect(pretender.messages).toEqual([])
      expect(one.messages).toEqual([])
      // …and it was all recorded anyway, which is 320's split and what makes a later claim lossless.
      expect(ledger(sessionId).flatMap(markerIn)).toContain('nobody is listening')
    })

    it('⛔ the commander’s departure ends nothing — the third question, answered no', async () => {
      const sessionId = await spawn({ commandedBy: PLANNER, approvalMode: 'auto' })
      await host.send(sessionId, 'STILL RUNNING', PLANNER)

      // ⛔ *"Give this agent a task"* must not mean *"and kill it when you stop asking"*.
      await host.closeSessionsForOwner(PLANNER.ownerId)
      expect(host.sessionIds).toEqual([sessionId])
      expect(host.unclaimedSessions().map((entry) => entry.sessionId)).toEqual([sessionId])
      // …and it is still drivable, so nothing was half-torn-down either.
      await host.send(sessionId, 'AND AGAIN', PLANNER)

      // ⚑ The paired positive: the same call for the OWNER of a session does end it, so the
      // assertion above is about who was asked for and not about the method doing nothing.
      const owned = await spawn({ sink: one, approvalMode: 'auto' })
      await host.closeSessionsForOwner(one.ownerId)
      expect(host.sessionIds).not.toContain(owned)
    })

    it('⛔ …nor may it close one on purpose', async () => {
      const sessionId = await spawn({ commandedBy: PLANNER })
      expect(await refusalOf(() => host.close(sessionId, PLANNER))).toBe(HELD_BY_NOBODY)
      expect(host.sessionIds).toEqual([sessionId])
    })
  })

  // ── §2 · knowledge escalates, authority does not ────────────────────────────────────────────
  describe('§2 · the caller that may command may not answer', () => {
    it('🔴 the commander drives it onto a card and then cannot answer the card', async () => {
      const sessionId = await spawn({ commandedBy: PLANNER })
      const requestId = await parkOnAQuestion(sessionId, PLANNER)

      // ⛔ **The whole dispatch, in one assertion.** The same caller that just gave this session
      // work is refused the decision about what that work may do.
      expect(
        await refusalOf(() =>
          host.respondPermission(sessionId, requestId, { outcome: 'allow' }, PLANNER),
        ),
      ).toBe(A_PERSON)
      // …and it really is still asking, so nothing was answered on the way to the refusal.
      expect(host.unclaimedSessions()[0]).toMatchObject({ waitingForAHuman: true })
      expect(ledger(sessionId).some((event) => event.type === 'user_decision')).toBe(false)
    })

    it('⚑ …and a person who takes it over answers it — the positive the refusal is measured against', async () => {
      const sessionId = await spawn({ commandedBy: PLANNER })
      const requestId = await parkOnAQuestion(sessionId, PLANNER)

      host.claimSession(sessionId, one)
      expect(await host.respondPermission(sessionId, requestId, { outcome: 'allow' }, one)).toEqual(
        {
          outcome: 'taken',
        },
      )
      expect(host.unclaimedSessions()).toEqual([])
    })

    it('⛔ nor the model’s own card, which is the plan approval on Claude', async () => {
      const sessionId = await spawn({ commandedBy: PLANNER })
      // ⚠️ The gate runs before the handle is touched, so this is refused whether or not a card is
      // open — which is the point: the entitlement is decided before the request id is looked at.
      expect(
        await refusalOf(() =>
          host.respondUserInput(sessionId, 'anything', { kind: 'reject' }, PLANNER),
        ),
      ).toBe(A_PERSON)
    })

    it('🔴 nor set the approval mode, which would answer every future card in advance', async () => {
      const sessionId = await spawn({ commandedBy: PLANNER })
      // ⛔ The defect one move earlier: a commander that could switch this session to `auto` would
      // never see another card, and would have decided every one of them.
      expect(await refusalOf(() => host.setApprovalMode(sessionId, 'auto', PLANNER))).toBe(
        HELD_BY_NOBODY,
      )
      // …and the mode really did not move: the next turn still stops and asks.
      await parkOnAQuestion(sessionId, PLANNER)
    })

    it('⚠️ the app itself may not answer either — the one door the superuser is turned away from', async () => {
      const sessionId = await spawn({ commandedBy: PLANNER })
      const requestId = await parkOnAQuestion(sessionId, PLANNER)

      expect(
        await refusalOf(() =>
          host.respondPermission(sessionId, requestId, { outcome: 'allow' }, THE_APP_ITSELF),
        ),
      ).toBe(A_PERSON)
      // ⚑ **And it is still the superuser everywhere else**, which is what makes the line above a
      // rule about answering rather than a broken sentinel: the quit still ends this session.
      await host.close(sessionId, THE_APP_ITSELF)
      expect(host.sessionIds).toEqual([])
    })

    it('⛔ a stranger and a commander are refused DIFFERENTLY, and each sentence is true of its caller', async () => {
      const sessionId = await spawn({ commandedBy: PLANNER })
      const requestId = await parkOnAQuestion(sessionId, PLANNER)

      // 🔴 **A stranger is told that nobody is holding this conversation, and what to do about
      // it** (421). ⛔ It used to be told *"it belongs to another window, switch to that window"* —
      // a session an agent spawned belongs to no window, so the refusal was right and the sentence
      // sent a person nowhere.
      expect(
        await refusalOf(() =>
          host.respondPermission(sessionId, requestId, { outcome: 'allow' }, STRANGER),
        ),
      ).toBe(HELD_BY_NOBODY)
      // A commander is told the thing that is actually true: this one is a person's to answer.
      expect(
        await refusalOf(() =>
          host.respondPermission(sessionId, requestId, { outcome: 'allow' }, PLANNER),
        ),
      ).toBe(A_PERSON)

      // ⚑ **The THIRD sentence, and it is what makes the first one a discriminant** (421). The
      // same stranger, on a conversation a WINDOW really does hold, reads the sentence that names
      // that window — so *"belongs to another window"* did not go away, it stopped being said
      // about conversations no window has.
      const held = await spawn({ sink: one, commandedBy: PLANNER })
      const heldRequest = await parkOnAQuestion(held, PLANNER)
      expect(
        await refusalOf(() =>
          host.respondPermission(held, heldRequest, { outcome: 'allow' }, STRANGER),
        ),
      ).toBe(NOT_YOURS)

      // ⛔ …and the three really are three sentences, or the assertions above are satisfied by one
      // string. A distinctness check, because a set whose members must differ needs one.
      expect(new Set([A_PERSON, HELD_BY_NOBODY, NOT_YOURS]).size).toBe(3)
    })

    it('⛔ the predicates say the same thing as the host does', async () => {
      // ⚠️ A unit check on the three answers the two new predicates give, so a later reader can see
      // the shape without reconstructing it from six host calls. The slot literal is the only thing
      // in this file that is not a real slot, and it is a literal for exactly that reason.
      const slot = { ownerId: 'webContents:1', ownerIsAPerson: true, commandedBy: PLANNER.ownerId }
      expect(mayCommand(slot, PLANNER)).toBe(true)
      expect(mayAnswerAsAHuman(slot, PLANNER)).toBe(false)
      expect(mayCommand(slot, { ownerId: 'webContents:1' })).toBe(true)
      expect(mayAnswerAsAHuman(slot, { ownerId: 'webContents:1' })).toBe(true)
      expect(mayCommand(slot, THE_APP_ITSELF)).toBe(true)
      expect(mayAnswerAsAHuman(slot, THE_APP_ITSELF)).toBe(false)
      // ⛔ A session nobody was given command of is unreachable through the new clause, and it is
      // `null` that makes it so rather than a guard.
      expect(mayCommand({ ownerId: null, commandedBy: null }, PLANNER)).toBe(false)

      // 🔴 **349 · the state where the two readings of `mayAnswerAsAHuman` DIVERGE**, which every
      // line above is not: each of them holds an owner a person IS behind, so *"is this yours"* and
      // *"is a person here, and is it theirs"* give the same answer and nothing is measured.
      //
      // ⛔ **This slot is the defect, expressed as a value.** An owner that is not a window —
      // `mcp:planner` is the id 340 used for a caller with no surface — reached by the front door:
      // it presented a `RuntimeEventSink`, `claimSession` accepted it, and `slot.ownerId` became
      // its id. Every predicate that asks *"is this yours"* still says yes, and must.
      const ownedByNoPerson = { ownerId: PLANNER.ownerId, ownerIsAPerson: false, commandedBy: null }
      expect(mayControl(ownedByNoPerson, PLANNER)).toBe(true)
      expect(mayCommand(ownedByNoPerson, PLANNER)).toBe(true)
      // …and BEFORE 349 that third `true` was this one. `slot.ownerId === by.ownerId` was the whole
      // predicate, and this caller satisfies it.
      expect(mayAnswerAsAHuman(ownedByNoPerson, PLANNER)).toBe(false)
      // ⛔ **One field apart, and it is the field rather than the caller that decides.** The same
      // owner, the same caller, the same id on both sides of the `===` — and the answer flips.
      expect(mayAnswerAsAHuman({ ...ownedByNoPerson, ownerIsAPerson: true }, PLANNER)).toBe(true)
      // ⚠️ …and the third conjunct is still doing its own work: a person behind a DIFFERENT surface
      // is refused, or 062's rule would have been spent buying this one.
      expect(mayAnswerAsAHuman(slot, { ownerId: 'webContents:2' })).toBe(false)
    })
  })

  // ── §3 · the two axes are orthogonal ────────────────────────────────────────────────────────
  describe('§3 · what a claim does to a commanding relationship', () => {
    it('🔴 a window claims it and the commander can still drive it', async () => {
      const sessionId = await spawn({ commandedBy: PLANNER, approvalMode: 'auto' })
      host.claimSession(sessionId, one)

      // ⛔ **The clause that would have been easiest to get wrong.** Looking in on a spawned agent
      // must not take the work away from whoever gave it.
      await host.send(sessionId, 'AFTER THE CLAIM', PLANNER)
      await waitFor(
        () =>
          one
            .events()
            .some(
              (event) =>
                event.type === 'assistant_message' &&
                event.text.startsWith('echo: ') &&
                event.text.includes('AFTER THE CLAIM'),
            ),
        'the commanded turn to reach the window watching it',
      )
    })

    it('🔴 a turn recorded before the claim and one published after it are one conversation, in ordinal order', async () => {
      // ⛔ **336 §3, F6, asked of a COMMANDED turn**: the seam is the claim, and the events either
      // side of it were produced by the same caller that could never see them.
      const sessionId = await spawn({ commandedBy: PLANNER, approvalMode: 'auto' })
      for (const line of ['a', 'b']) await agentSays(sessionId, line)
      await host.send(sessionId, 'UNWATCHED', PLANNER)
      await waitFor(() => providerEchoed(sessionId, 'UNWATCHED'), 'the unwatched turn to finish')

      const handed = host.claimSession(sessionId, one)
      await host.send(sessionId, 'WATCHED', PLANNER)
      await waitFor(
        () =>
          one
            .events()
            .some(
              (event) =>
                event.type === 'assistant_message' &&
                event.text.startsWith('echo: ') &&
                event.text.includes('WATCHED'),
            ),
        'the watched turn',
      )

      const replayed = handed.history.entries.map((entry) => entry.ordinal)
      const live = one.ordinals()
      expect(JSON.stringify(handed.history.entries)).toContain('UNWATCHED')
      expect(live).toEqual([...live].sort((first, second) => first - second))
      expect(Math.min(...live)).toBeGreaterThan(Math.max(...replayed))
      const all = [...replayed, ...live]
      expect(new Set(all).size).toBe(all.length)
      expect(all).toEqual(
        Array.from({ length: all.length }, (_unused, index) => Math.min(...replayed) + index),
      )
    })

    it('⛔ the watcher goes away, the session is released, and the commander is untouched', async () => {
      const sessionId = await spawn({ commandedBy: PLANNER, approvalMode: 'auto' })
      host.claimSession(sessionId, one)
      one.alive = false
      await host.closeSessionsForOwner(one.ownerId)

      // Released, not closed — 336's rule, and it did not learn about commanders.
      expect(host.unclaimedSessions().map((entry) => entry.sessionId)).toEqual([sessionId])
      // ⚑ …and the commanding half survived a full cycle of the watching half.
      await host.send(sessionId, 'AFTER THE RELEASE', PLANNER)
      await waitFor(
        () => providerEchoed(sessionId, 'AFTER THE RELEASE'),
        'the turn after the release',
      )
      // ⛔ …while the window that let go is a stranger again, which is the axis that DOES move.
      expect(await refusalOf(() => host.send(sessionId, 'not yours', one))).toBe(HELD_BY_NOBODY)
    })

    it('⛔ a second window may take it over, and that still does not make anyone else a commander', async () => {
      const sessionId = await spawn({ commandedBy: PLANNER, approvalMode: 'auto' })
      host.claimSession(sessionId, one)
      one.alive = false
      await host.closeSessionsForOwner(one.ownerId)
      host.claimSession(sessionId, two)

      await host.send(sessionId, 'ONE COMMANDER', PLANNER)
      // ⛔ Two claims later, the other agent is exactly as refused as it was at the start.
      // ⚠️ **With the OTHER sentence, and that is 421 rather than a change here**: a window holds
      // this conversation now, so *"it belongs to another window"* is true of it — which is the
      // whole reason the unowned case got a code of its own.
      expect(await refusalOf(() => host.send(sessionId, 'no', STRANGER))).toBe(NOT_YOURS)
    })
  })

  // ── §0 · what a process restart does to a commanding relationship ───────────────────────────
  describe('§0 · nothing persists a commanding relationship', () => {
    it('⚠️ a second host over the same ledger holds no slots, so the relationship is gone', async () => {
      const sessionId = await spawn({ commandedBy: PLANNER, approvalMode: 'auto' })
      await host.send(sessionId, 'BEFORE THE RESTART', PLANNER)
      await waitFor(
        () => providerEchoed(sessionId, 'BEFORE THE RESTART'),
        'the turn before the restart',
      )

      // ⛔ **What a restart is, from this host's point of view**: the ledger survives and the slots
      // do not. `commandedBy` lives on a slot and `db/` has never held an owner of any kind.
      const afterRestart = buildHost()
      try {
        expect(afterRestart.sessionIds).toEqual([])
        expect(afterRestart.unclaimedSessions()).toEqual([])
        // ⚑ **It fails CLOSED**, which is the direction to fail in: the agent that was driving this
        // conversation is now a caller naming a session this host is not running, and no restart can
        // hand command of a conversation to an agent that did not ask for it.
        expect(await refusalOf(() => afterRestart.send(sessionId, 'still mine?', PLANNER))).toBe(
          `unknown session: ${sessionId}`,
        )
        // …and the conversation itself is not lost — it is a recording a person reopens.
        expect(providerEchoed(sessionId, 'BEFORE THE RESTART')).toBe(true)
      } finally {
        await afterRestart.closeAll()
      }
    })
  })

  // ── the door this rule can still be walked around, pinned so it cannot be walked around ─────
  describe('§2 · “no path exists” is a gate here, not a paragraph', () => {
    it('⛔ the claim door has exactly one caller in the app, and its sink is always a window', () => {
      // 🔴 **The one way left to answer another agent's permission prompt, and it is closed by a
      // fact rather than by a check.** `mayAnswerAsAHuman` asks whether the caller OWNS the session,
      // and ownership is taken by `claimSession`, which takes a `RuntimeEventSink` — a type an MCP
      // caller could implement. What stops it is that nothing but the IPC boundary calls it, and
      // every sink reaching that boundary is `webContentsSink(event.sender)`: a real window.
      //
      // ⚠️ **So this is a source census and it is aimed at the dispatch after this one.** The tools
      // dispatch adds the MCP surface; the moment it gives a non-window caller a sink that can
      // claim, an agent can become an owner and this rule is bypassed without a line of it changing.
      // This turns red on that edit, which is the whole point of writing it as a test.
      //
      // ⛔ **347 arrived, ANSWERED this rather than silencing it, and widened what it reads** (347
      // §2.1). 340 priced two answers: teach a sink to say whether a person is behind it — 42 files
      // implement that interface — or *"these tools never hand a claiming sink to anything"*, which
      // keeps the census green and is a defensible answer. The tools take a `Caller`, which is
      // `{ ownerId }` and nothing else, so the second is what happened.
      //
      // ⚠️ **And the census had a blind spot that answer alone would not have closed**: it read
      // exactly three files, so a NEW file calling `host.claimSession(...)` left it green while
      // doing the very thing it exists to forbid. The file list is now derived from the directory
      // rather than typed out, so the next surface is counted whether or not anyone remembers to
      // add it here.
      const mainRoot = join(here, '../src/main')
      const sources = readdirSync(mainRoot, { recursive: true, encoding: 'utf8' })
        .filter((entry) => entry.endsWith('.ts'))
        .map((entry) => join(mainRoot, entry))
      const everything = sources.map((path) => readFileSync(path, 'utf8')).join('\n')
      const host = readFileSync(join(here, '../src/main/runtime/runtime-host.ts'), 'utf8')
      const ipc = readFileSync(join(here, '../src/main/runtime/ipc.ts'), 'utf8')
      const index = readFileSync(join(here, '../src/main/index.ts'), 'utf8')

      // Non-vacuity first: the strings this counts are really in these files.
      expect(host).toContain('claimSession(sessionId: string, sink: RuntimeEventSink)')
      expect(ipc).toContain('host.claimSession(')
      // ⚑ …and the sweep really reached the tool layer, so its silence below means something.
      expect(sources.some((path) => path.endsWith('runtime/agent-tools.ts'))).toBe(true)
      // Exactly one caller, ANYWHERE under `src/main`, and it is the IPC dispatcher.
      const callers = everything.match(/host\.claimSession\(/g) ?? []
      expect(callers).toHaveLength(1)
      // …and the only sink the dispatcher is ever handed is a window's.
      expect(index).toContain('sinkFor: (event) => webContentsSink(event.sender, mainThreadWork)')
      expect((index.match(/sinkFor:/g) ?? []).length).toBe(1)
    })

    it('⛔ nothing crossing the wire can name a commander', async () => {
      // ⚠️ `createSession` over the real parse, with the field a caller would have to smuggle. A
      // window's session is owned by that window and commanded by nobody, so the other agent is
      // refused exactly as it is for a session it was never named on.
      const created = (await executeRuntimeCommand(host, one, {
        kind: 'createSession',
        provider: 'claude',
        cwd: userData,
        approvalMode: 'auto',
        commandedBy: PLANNER.ownerId,
      } as Parameters<typeof executeRuntimeCommand>[2])) as { sessionId: string }

      // ⚠️ **`not-yours`, because a WINDOW owns this one** (421) — the sentence that names the
      // window is true here, and this is the control for every `held-by-nobody` above it.
      expect(await refusalOf(() => host.send(created.sessionId, 'mine now', PLANNER))).toBe(
        NOT_YOURS,
      )
      // ⚑ …and the window that asked for it can drive it, so the refusal is about the smuggled
      // field and not about the session being unusable.
      await host.send(created.sessionId, 'ours', one)
    })
  })
})
