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
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import {
  RuntimeHost,
  THE_APP_ITSELF,
  type RuntimeEventSink,
} from '../src/main/runtime/runtime-host'
import { describeUnavailable } from '../src/main/runtime/session-unavailable'
import type {
  ResumedSession,
  RuntimeEventMessage,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

/**
 * 🔴 **336 · a session that exists because nothing asked for it, and a window that takes it over.**
 *
 * ⛔ **The blocker this closes is `182` H5, and `303` measured it on a real Claude session**:
 * `createSession` reserved under `sink.ownerId`, so a caller with no window could only fabricate a
 * sink — and then `attachOpenSessions` answered `[]`, resume refused with *"already open in another
 * window"*, and the renderer received **0 of that session's first 33 events**. The ledger held the
 * conversation and no surface could ever reach it.
 *
 * ## ⚠️ What this file asks, and what it deliberately does not
 *
 * ⚑ **Every assertion goes through a real {@link RuntimeHost}, a real SQLite ledger and real
 * sinks.** The interesting half of this dispatch is a rule about ownership, and a rule about
 * ownership asserted against a stub of the thing that owns is a rule asserting itself.
 *
 * ⛔ **Nothing here drives an unclaimed session with a message, because nothing CAN** — and that is
 * a finding rather than a gap. `303` B measured that `createSession` carries no first message on
 * either provider, and every verb that could give one to a session goes through `assertMayControl`,
 * which for an owner of `null` admits only {@link THE_APP_ITSELF}. So a session nobody asked for
 * does nothing until somebody claims it, and the one place below that needs a running turn gets one
 * the only way the product can: it is claimed, driven, and then released when the window goes away.
 */

/** A `FakeRuntime` that keeps the handles it issues, so a test can push events with no caller. */
class CapturingRuntime extends FakeRuntime {
  readonly issued: FakeSessionHandle[] = []
  override async start(opts: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(opts)
    this.issued.push(handle)
    return handle
  }
  /** The provider end of the session started most recently. */
  latest(): FakeSessionHandle {
    const handle = this.issued.at(-1)
    if (handle === undefined) throw new Error('no session has been started on this runtime')
    return handle
  }
}

class RecordingSink implements RuntimeEventSink {
  // 349 · this double stands in for a WINDOW — the tests below answer for a person through it.
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
  ordinals(): number[] {
    return this.messages.map((message) => message.ordinal)
  }
  /** Every marker this window was told, so one can be looked for by its words. */
  said(): string[] {
    return this.events().flatMap(markerIn)
  }
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/**
 * The marker one provider event carries, if it is one of ours.
 *
 * ⚠️ **An `activity` detail rather than an `assistant_message`**, for one reason: `simulateActivity`
 * is a public helper on the double and `push` is not. What the tests need of it is only that it is a
 * real provider event, ordinal-stamped and recorded by the same path every other one takes.
 */
function markerIn(event: TranscriptEvent): string[] {
  return event.type === 'activity' && event.detail !== undefined ? [event.detail] : []
}

/** The markers in a replayed page, in the same shape {@link RecordingSink.said} reads. */
function saidIn(handed: ResumedSession): string[] {
  return handed.history.entries.flatMap((entry) => markerIn(entry.event))
}

/**
 * 🔴 **421 · the sentence a window reads when it reaches for a session NOBODY owns.**
 *
 * ⛔ **It was `not-yours` until 421** — *"This conversation belongs to another window… switch to
 * that window"* — which is the one thing that cannot be true of a session whose whole subject is
 * that no window has it. ⚑ 336 built the door; this is the refusal on the other side of it finally
 * saying which door to use. {@link NOT_YOURS} is kept and asserted below, over the case it is
 * true of, so the split is a discriminant rather than a rename.
 */
const HELD_BY_NOBODY = describeUnavailable('held-by-nobody')
const NOT_YOURS = describeUnavailable('not-yours')

describe('336 · a session created through a door no renderer opened', () => {
  let userData: string
  let db: AppDatabase
  let host: RuntimeHost
  let store: SessionStore
  let runtimes: Map<Provider, CapturingRuntime>
  /** The two windows every test has available; neither has asked for anything until it does. */
  let one: RecordingSink
  let two: RecordingSink

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-the-door-'))
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
      // ⚠️ **One runtime per provider, HELD**, so a test can reach the provider end of a session it
      // started — the only way to make an unclaimed session produce events, since no caller can.
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

  /**
   * ⛔ **The provider end of each session, kept by id.** `latest()` alone is wrong here: several of
   * these tests open a second session as a CONTROL, and an event pushed at "the newest handle"
   * would then land in the control's conversation — which reads as the ledger never receiving it.
   */
  const handles = new Map<string, FakeSessionHandle>()

  const open = async (sink: RecordingSink | null): Promise<string> => {
    const { sessionId } = await host.createSession({ provider: 'claude', cwd: userData }, sink)
    handles.set(sessionId, provider().latest())
    return sessionId
  }

  /** A session nobody asked for. */
  const openUnclaimed = (): Promise<string> => open(null)

  /** …and the control it is measured against: the same launch, asked for by a window. */
  const openFor = (sink: RecordingSink): Promise<string> => open(sink)

  const provider = (): CapturingRuntime => {
    const held = runtimes.get('claude')
    if (held === undefined) throw new Error('no claude runtime was built')
    return held
  }

  /**
   * ⛔ **What the LEDGER holds, read from the store rather than from the host** (318's rule): the
   * question every test below asks of an unclaimed session is *"was this written down even though
   * nobody was listening"*, and asking the host would ask the same object that did the writing.
   */
  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  /** Emit one marked event from the PROVIDER end and wait for the ledger to hold it. */
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

  describe('§2.1 · it exists, and nobody owns it', () => {
    it('⚑ opens a real session with no sink at all, and says so when asked', async () => {
      const sessionId = await openUnclaimed()
      expect(host.sessionIds).toEqual([sessionId])
      expect(host.unclaimedSessions()).toEqual([
        {
          sessionId,
          since: expect.any(Number) as number,
          // 349 · nobody was given command of this one either, and `null` is the answer rather
          // than the field's absence — see `UnclaimedSession.commandedBy`.
          commandedBy: null,
          running: true,
          provider: 'claude',
          cwd: userData,
          waitingForAHuman: false,
        },
      ])
    })

    it('⛔ …and a session a window asked for is not one of them', async () => {
      // ⚠️ The pairing that makes the assertion above about something. Without it, an
      // `unclaimedSessions` that listed every session would satisfy it exactly as well.
      const owned = await openFor(one)
      expect(host.unclaimedSessions()).toEqual([])
      expect(host.sessionIds).toEqual([owned])
    })

    it('🔴 everything it does is recorded, and none of it is delivered anywhere', async () => {
      const sessionId = await openUnclaimed()
      await agentSays(sessionId, 'nobody heard this')
      // The ledger has it…
      expect(ledger(sessionId).flatMap(markerIn)).toContain('nobody heard this')
      // …and neither window was told anything at all, because neither is its surface.
      expect(one.messages).toEqual([])
      expect(two.messages).toEqual([])
    })

    it('⚑ …and the SAME event on a window-owned session does reach that window', async () => {
      // ⛔ **320's split, driven rather than asserted about.** The test above passes over a host
      // that has stopped delivering to everybody; this is what makes it a statement about the
      // owner being `null` rather than about the sink path being broken.
      const sessionId = await openFor(one)
      await agentSays(sessionId, 'this one was heard')
      await waitFor(() => one.said().includes('this one was heard'), 'the window to be told')
      expect(two.messages).toEqual([])
    })

    it('⛔ no window may control it — every verb is refused', async () => {
      const sessionId = await openUnclaimed()
      expect(await refusalOf(() => host.send(sessionId, 'do it', one))).toBe(HELD_BY_NOBODY)
      expect(await refusalOf(() => host.interrupt(sessionId, one))).toBe(HELD_BY_NOBODY)
      expect(await refusalOf(() => host.setApprovalMode(sessionId, 'auto', two))).toBe(
        HELD_BY_NOBODY,
      )
      // …and nothing happened to it: no turn was opened by a refusal.
      expect(ledger(sessionId).some((event) => event.type === 'user_turn')).toBe(false)
    })

    it('🔴 421 · and the sentence it is refused with does not name a window', async () => {
      const sessionId = await openUnclaimed()

      // ⛔ **`418` measured what a person read here** — *"This conversation belongs to another
      // window, so nothing was sent to it. Switch to that window…"* — about a conversation no
      // window has. The refusal was right and every clause of the reason was false.
      const nobodys = await refusalOf(() => host.close(sessionId, one))
      expect(nobodys).toBe(HELD_BY_NOBODY)
      expect(nobodys).not.toContain('another window')
      // ⚑ …and it names the gesture that DOES work, which is one method over on this same host.
      expect(nobodys).toContain('Take it over')
      host.claimSession(sessionId, one)
      await host.close(sessionId, one)

      // ⚑ **The control, and it is the whole point of splitting the code rather than rewording
      // one**: a conversation another WINDOW holds still reads the sentence that names that
      // window, because for that conversation it is true.
      const owned = await openFor(one)
      const theirs = await refusalOf(() => host.close(owned, two))
      expect(theirs).toBe(NOT_YOURS)
      expect(theirs).toContain('another window')
      expect(theirs).not.toBe(nobodys)
    })

    it('⛔ attachOpen never hands one over, to either window', async () => {
      const unclaimed = await openUnclaimed()
      const owned = await openFor(one)
      // ⚠️ **The positive is in the same call**: `attachOpenSessions` really is answering, and what
      // it names is the session this window asked for and nothing else.
      expect(host.attachOpenSessions(one).map((handed) => handed.sessionId)).toEqual([owned])
      expect(host.attachOpenSessions(two)).toEqual([])
      expect(host.unclaimedSessions().map((entry) => entry.sessionId)).toEqual([unclaimed])
    })

    it('⚠️ the app itself still reaches it, which is what a quit needs', async () => {
      // ⛔ `mayControl`'s first clause is unconditional, so a `null` owner does not put a session
      // beyond the app's own lifecycle. Without this, "nobody owns it" would mean "nothing can end
      // it" — a provider nothing could ever stop.
      const sessionId = await openUnclaimed()
      await host.close(sessionId, THE_APP_ITSELF)
      expect(host.sessionIds).toEqual([])
    })

    it('⚠️ …and so does the quit itself', async () => {
      await openUnclaimed()
      await host.closeAll()
      expect(host.sessionIds).toEqual([])
      expect(host.unclaimedSessions()).toEqual([])
    })
  })

  describe('§2.2 · a window takes one over', () => {
    it('🔴 the claim makes this window the owner and hands the conversation back', async () => {
      const sessionId = await openUnclaimed()
      const handed = host.claimSession(sessionId, one)

      expect(handed.sessionId).toBe(sessionId)
      // ⛔ `attached`, never `reopened`: nothing stopped, so the corrections a reopen applies would
      // every one of them be false about a conversation that has been running the whole time.
      expect(handed.handover).toBe('attached')
      expect(handed.provider).toBe('claude')
      expect(handed.cwd).toBe(userData)

      // The ownership really moved, read from the two questions that are about ownership.
      expect(host.unclaimedSessions()).toEqual([])
      expect(host.attachOpenSessions(one).map((entry) => entry.sessionId)).toEqual([sessionId])
    })

    it('🔴 the replay carries what happened before the claim; the live stream carries what follows', async () => {
      const sessionId = await openUnclaimed()
      await agentSays(sessionId, 'before the claim')

      const handed = host.claimSession(sessionId, one)
      // Everything up to the claim is in the page…
      expect(saidIn(handed)).toContain('before the claim')
      // …and none of it was ALSO pushed at the sink, which is the difference between a replay and
      // a re-send. A window that got both would fold the same event twice.
      expect(one.said()).not.toContain('before the claim')

      await agentSays(sessionId, 'after the claim')
      await waitFor(() => one.said().includes('after the claim'), 'the live event')
      // …and the live half is not in the page it was handed, either.
      expect(saidIn(handed)).not.toContain('after the claim')
    })

    it('🔴 replay and live together are one contiguous conversation, in ordinal order', async () => {
      // ⛔ **336 §3, F6**: *"an event recorded before the claim and published after it must still
      // arrive in ordinal order"*. The claim is the seam, so this asserts across it.
      const sessionId = await openUnclaimed()
      for (const line of ['a', 'b', 'c']) await agentSays(sessionId, line)

      const handed = host.claimSession(sessionId, one)
      for (const line of ['d', 'e']) await agentSays(sessionId, line)
      await waitFor(() => one.said().includes('e'), 'the last live event')

      const replayed = handed.history.entries.map((entry) => entry.ordinal)
      const live = one.ordinals()
      // Live events are strictly increasing, and every one is above the page's last.
      expect(live).toEqual([...live].sort((first, second) => first - second))
      expect(Math.min(...live)).toBeGreaterThan(Math.max(...replayed))
      // …and the two halves together are the whole conversation, with no hole and no repeat.
      const all = [...replayed, ...live]
      expect(new Set(all).size).toBe(all.length)
      expect(all).toEqual(
        Array.from({ length: all.length }, (_unused, index) => Math.min(...replayed) + index),
      )
    })

    it('⚑ and from that moment the window can drive it', async () => {
      const sessionId = await openUnclaimed()
      expect(await refusalOf(() => host.send(sessionId, 'do it', one))).toBe(HELD_BY_NOBODY)
      host.claimSession(sessionId, one)
      await host.send(sessionId, 'do it', one)
      await waitFor(
        () => one.events().some((event) => event.type === 'user_turn'),
        'the turn this window opened',
      )
    })
  })

  describe('§2.3 · when a claim is legal', () => {
    it('⛔ a second window cannot take one the first has claimed', async () => {
      const sessionId = await openUnclaimed()
      host.claimSession(sessionId, one)

      expect(await refusalOf(() => host.claimSession(sessionId, two))).toBe(
        describeUnavailable('already-open-elsewhere'),
      )
      // ⚠️ **And the refusal changed nothing**: the first window is still the one being told.
      await agentSays(sessionId, 'still window one')
      await waitFor(() => one.said().includes('still window one'), 'the owner to be told')
      expect(two.messages).toEqual([])
    })

    it('⛔ nor one another window CREATED — 062, restated for this door', async () => {
      const sessionId = await openFor(one)
      expect(await refusalOf(() => host.claimSession(sessionId, two))).toBe(
        describeUnavailable('already-open-elsewhere'),
      )
    })

    it('⛔ the claimer asking again is told it already has it, not that somebody else does', async () => {
      // ⚠️ Two states, told apart. `already-open-elsewhere` here would send a person looking for a
      // window that does not exist — 100's defect, in the new door.
      const sessionId = await openUnclaimed()
      host.claimSession(sessionId, one)
      expect(await refusalOf(() => host.claimSession(sessionId, one))).toBe(
        describeUnavailable('already-open'),
      )
    })

    it('⛔ a RESUME does not quietly become a claim', async () => {
      // ⚠️ **The other door onto a live session, and it must not have been widened.** `resume`
      // reaches `attachHeldSession` before `reserve` — with `attach`, deliberately — so a window
      // that reopens an id it happens to know is refused rather than handed a conversation nobody
      // asked for. ⛔ A claim is a gesture somebody makes on purpose, by its own verb.
      const sessionId = await openUnclaimed()
      // 🔴 **And it is refused with the sentence 421 gave it.** ⛔ It read *"already open in
      // another window — switch to that window to carry on with it"*, which `418` measured a
      // person reading off their own rail about an agent's conversation: the reopen was refused
      // because the id is live, and the reason sent them to a window that does not exist. ⚑ The
      // refusal is unchanged; the sentence now names the gesture on the next line.
      const refusal = await refusalOf(() => host.resumeSession(sessionId, one))
      expect(refusal).toBe(describeUnavailable('held-by-nobody'))
      expect(refusal).not.toContain('another window')
      // …and it is still nobody's, so the deliberate gesture still works.
      expect(host.unclaimedSessions().map((entry) => entry.sessionId)).toEqual([sessionId])
      expect(host.claimSession(sessionId, one).sessionId).toBe(sessionId)

      // ⚑ **The control: a session another WINDOW is running still says *"already open in another
      // window"***, because that window exists. Two sessions, one call, two sentences.
      const owned = await openFor(two)
      const elsewhere = await refusalOf(() => host.resumeSession(owned, one))
      expect(elsewhere).toBe(describeUnavailable('already-open-elsewhere'))
      expect(elsewhere).toContain('another window')
    })

    it('⛔ an id this host is not running is its own refusal', async () => {
      expect(await refusalOf(() => host.claimSession('sess_nobody', one))).toBe(
        describeUnavailable('not-running'),
      )
    })

    it('⚠️ a session still opening cannot be claimed, and says how long it has been opening', async () => {
      // ⛔ The provider has not arrived, so there is nothing to hand over — the same state `reserve`
      // reports for a reopen, reported here rather than flattened into "you cannot have it".
      const gate = new FakeLaunchGate()
      runtimes.set('codex', new CapturingRuntime('codex', { gate }))
      const opening = host.createSession({ provider: 'codex', cwd: userData }, null)
      // Test hygiene, not product behaviour: an assertion below that goes red leaves this launch
      // pending, `closeAll` in the teardown then cancels it, and the rejection would arrive as an
      // unhandled error attributed to whichever test ran next.
      opening.catch(() => {})
      await waitFor(() => host.unclaimedSessions().length === 1, 'the reservation')

      expect(host.unclaimedSessions()).toEqual([
        {
          sessionId: 'sess_1',
          since: expect.any(Number) as number,
          commandedBy: null,
          running: false,
        },
      ])
      // ⚠️ **Asserted with its measurement, not against the bare sentence.** `whyNotClaimed` carries
      // `openingForMs` on the refusal, and `describeUnavailable` only says *"it has been opening
      // for N"* when it is given one — so the second line is what proves the context rode along
      // rather than being dropped on the way through a new door.
      const refusal = await refusalOf(() => host.claimSession('sess_1', one))
      expect(refusal).toContain('This conversation is still opening')
      expect(refusal).toMatch(/It has been opening for \d+s\./)

      gate.release()
      await opening
      // …and once its provider is there, the same window's claim is taken.
      expect(host.claimSession('sess_1', one).sessionId).toBe('sess_1')
    })
  })

  describe('§2.3 · a claim can be reversed', () => {
    it('🔴 the claimer’s window goes away and the session is RELEASED, not closed', async () => {
      const claimed = await openUnclaimed()
      host.claimSession(claimed, one)
      // ⛔ **The control runs in the same host, at the same moment**: a session this window
      // STARTED must still be closed by its departure, or this test would be satisfied by a
      // `closeSessionsForOwner` that had simply stopped closing anything.
      const started = await openFor(one)

      await host.closeSessionsForOwner(one.ownerId)

      // The claimed one survived and is nobody's again…
      expect(host.sessionIds).toContain(claimed)
      expect(host.unclaimedSessions().map((entry) => entry.sessionId)).toEqual([claimed])
      // …and the one this window started is gone, by the same call, in the same pass.
      expect(host.sessionIds).not.toContain(started)

      // 🔴 **And it stops being TOLD, in the gap before anybody else claims it** (found by the
      // per-row killer check). ⛔ Releasing the ownership without releasing the sink leaves the
      // departed window receiving a conversation it no longer owns — and the next claimer's replay
      // then covers events that were already sent to somebody else. ⚠️ The assertion has to be made
      // HERE, in the gap: a claim swaps the sink itself, so anything asserted after one would pass
      // over the defect.
      const heardBefore = one.messages.length
      await agentSays(claimed, 'after the window went away')
      expect(one.said()).not.toContain('after the window went away')
      expect(one.messages).toHaveLength(heardBefore)
    })

    it('⚑ …and a released session can be claimed again, by a different window', async () => {
      const sessionId = await openUnclaimed()
      host.claimSession(sessionId, one)
      await agentSays(sessionId, 'while window one watched')
      await host.closeSessionsForOwner(one.ownerId)

      const handed = host.claimSession(sessionId, two)
      // The whole conversation, including the part the previous claimer saw live.
      expect(saidIn(handed)).toContain('while window one watched')
      await agentSays(sessionId, 'and now window two')
      await waitFor(() => two.said().includes('and now window two'), 'the new owner')
      // ⚠️ The window that let it go is told nothing more.
      expect(one.said()).not.toContain('and now window two')
    })

    it('⛔ a session that was BORN with a window still dies with it, even after a re-attach', async () => {
      // ⚠️ **The birth fact, not the current owner, is what decides.** A window that lost sight of
      // its own session and got it back through `attachOpen` has not turned it into a session
      // nobody asked for, and a release here would leave a provider running for nobody.
      const sessionId = await openFor(one)
      one.alive = false
      expect(host.attachOpenSessions(one).map((entry) => entry.sessionId)).toEqual([sessionId])
      await host.closeSessionsForOwner(one.ownerId)
      expect(host.sessionIds).toEqual([])
    })
  })

  describe('§2.4 · when it needs a human and there is nobody', () => {
    /**
     * ⛔ **The one arc the product can actually reach today**, and it is the case §2.4 names: a
     * conversation that is running, that has stopped to ask a question, and that has nobody to
     * answer it. It gets there the only way it can — claimed, driven, then released when the window
     * goes away — because nothing can give an unclaimed session work.
     */
    async function parkOnAQuestion(): Promise<string> {
      const sessionId = await openUnclaimed()
      host.claimSession(sessionId, one)
      await host.send(sessionId, 'touch a file', one)
      await waitFor(
        () => one.events().some((event) => event.type === 'permission_request'),
        'the card',
      )
      await host.closeSessionsForOwner(one.ownerId)
      return sessionId
    }

    it('🔴 it parks rather than hanging: the state is real, and it is reportable', async () => {
      const sessionId = await parkOnAQuestion()
      expect(host.unclaimedSessions()).toEqual([
        {
          sessionId,
          since: expect.any(Number) as number,
          commandedBy: null,
          running: true,
          provider: 'claude',
          cwd: userData,
          waitingForAHuman: true,
        },
      ])
      // ⛔ **And the question is durable, not a message that went nowhere.** The card is in the
      // ledger with its ordinal, so the person who eventually takes this over is handed it.
      expect(ledger(sessionId).map((event) => event.type)).toContain('permission_request')
    })

    it('a person answers it without taking it over; an agent cannot', async () => {
      const sessionId = await parkOnAQuestion()
      const requestId = requestIn(ledger(sessionId))
      expect(
        await refusalOf(() =>
          host.respondPermission(
            sessionId,
            requestId,
            { outcome: 'allow' },
            { ownerId: 'agent:sess_somebody' },
          ),
        ),
      ).toBe(HELD_BY_NOBODY)
      await expect(
        host.respondPermission(sessionId, requestId, { outcome: 'allow' }, two),
      ).resolves.toMatchObject({ outcome: 'taken' })
      // Answered, and still nobody's.
      expect(host.unclaimedSessions().map((row) => row.sessionId)).toEqual([sessionId])
    })

    it('⚑ claiming it hands over the open card, and the claimer answers it', async () => {
      const sessionId = await parkOnAQuestion()
      const handed = host.claimSession(sessionId, two)
      expect(handed.history.entries.map((entry) => entry.event.type)).toContain(
        'permission_request',
      )

      await host.respondPermission(
        sessionId,
        requestIn(handed.history.entries.map((entry) => entry.event)),
        { outcome: 'allow' },
        two,
      )
      await waitFor(
        () => two.events().some((event) => event.type === 'user_decision'),
        'the answer this window gave',
      )
      // ⚠️ **The positive that makes the whole section about something**: it is no longer waiting,
      // and it is no longer nobody's.
      expect(host.unclaimedSessions()).toEqual([])
    })
  })

  /** The id of the one open card, from a list of events — the ledger's or a replayed page's. */
  function requestIn(events: readonly TranscriptEvent[]): string {
    for (const event of events) {
      if (event.type === 'permission_request') return event.id
    }
    throw new Error('no permission request among these events')
  }
})
