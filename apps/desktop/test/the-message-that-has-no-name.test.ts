import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { runtimeCommandSchema } from '../src/main/runtime/ipc'
import {
  theMessagesOf,
  type RuntimeEventMessage,
  type SessionLiveness,
  type SessionLivenessMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * 🔴 **354 · the held message has a name, and the name is what a cancel says.**
 *
 * ⚑ **What the name buys is the sentence a session could not say before it**: *"that is not the
 * message I am holding"*. ⛔ It bought a second one too — *"I am already holding **this** one"* —
 * until D-010 retired the one-held-message rule: a conversation now holds as many as are sent, each
 * with its own name. 🔴 **D-027 moved how they go**: no longer each as its own turn, but everything
 * held, oldest first, as ONE turn — one `user_turn` whose `parts` are the messages, and each message
 * still ended by its OWN name (`message_unqueued` · `sent`), which is what this file keeps.
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

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

describe('354 · the message that has no name', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let sink: RecordingSink
  /**
   * ⚠️ **Shared across every host this file builds.** A local starting at zero would have two hosts
   * mint `sess_1`, and the launch reservation is keyed on the id and does not care which host asked
   * — the same trap `queued-message.test.ts` records at the top of its own counter.
   */
  let sessions = 0
  /**
   * ⚑ **One provider-side session ledger shared by every adapter this host builds**, because a
   * resume asks the provider for a conversation it issued. A fresh `FakeRuntime` per launch with
   * its own ledger refuses the reopen — which is the fake being right about a thing this file is
   * not testing.
   */
  let providerSessions: FakeProviderSessions

  /**
   * ⛔ **A REAL store, not `NULL_SESSION_STORE`.** Half of this file is about what a ledger holds
   * after the process that wrote it is gone, and a store whose `find` returns null would let every
   * one of those assertions pass over a write that never happened (149).
   */
  const buildHost = (over: SessionStore = store): RuntimeHost =>
    new RuntimeHost({
      store: over,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(dir, 'exports'),
      createRuntime: (provider) => new FakeRuntime(provider, { sessions: providerSessions }),
      prepareProviderHome: (provider) => join(dir, 'provider-homes', provider),
      providerHomePath: (provider) => join(dir, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => `sess_${++sessions}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-354-'))
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrations)
    store = createSessionStore(db)
    providerSessions = new FakeProviderSessions()
    host = buildHost()
    sink = new RecordingSink()
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  /** Start a session and get it into a running turn parked on its permission card. */
  async function busySession(runtime: RuntimeHost = host): Promise<string> {
    const created = await runtime.createSession({ provider: 'claude' }, sink)
    await runtime.send(created.sessionId, 'the first thing', sink)
    await waitFor(() => sink.types().includes('permission_request'), 'the card the turn parks on')
    return created.sessionId
  }

  /**
   * Queue a message and hand back **the name it was given**.
   *
   * ⛔ **It throws when the message went straight out** rather than answering `''`: every caller
   * below is about a message that is being HELD, and a helper that quietly returned an empty string
   * for a `sent` outcome would turn *"this test queued nothing"* into *"this test cancelled
   * nothing"*, which passes.
   */
  async function queueNamed(sessionId: string, text: string): Promise<string> {
    const outcome = await host.queueMessage(sessionId, text, sink)
    if (outcome.outcome !== 'queued') {
      throw new Error(`expected "${text}" to be held; it was ${outcome.outcome}`)
    }
    return outcome.messageId
  }

  /** What the LEDGER holds for one session, as `type` or `type:reason`. */
  const ledger = (sessionId: string): string[] =>
    store.events(sessionId).map((row) => {
      const event = row.event
      return event.type === 'message_unqueued' ? `${event.type}:${event.reason}` : event.type
    })

  const ledgerEvents = <T extends TranscriptEvent['type']>(
    sessionId: string,
    type: T,
  ): Extract<TranscriptEvent, { type: T }>[] =>
    store
      .events(sessionId)
      .map((row) => row.event)
      .filter((event): event is Extract<TranscriptEvent, { type: T }> => event.type === type)

  // ⚑ **The HEAD of the mailbox** (394). This suite is about the one message `354` named, and the
  // head is the one that is going next; the whole list is asserted where the mailbox itself is under
  // test (`a-question-finds-a-person.test.ts`).
  const queuedDisclosure = (): { id: string; text: string } | undefined =>
    sink.liveness.at(-1)?.queued?.[0]

  /**
   * # 🔴 §3 · Is the id durable? Measured, not preferred.
   *
   * ⛔ **The answer is TWO answers, because the question has two halves.** The HOLD is runtime state
   * on the slot and does not survive anything — `336`'s `ownerId` and `340`'s `commandedBy` are the
   * same shape, and `077` decided deliberately that *"a resumed conversation comes back with an
   * EMPTY queue"*. ⚑ **The NAME is in the ledger**, on both halves of the pair, because criterion 14
   * rebuilds from the ledger and S1's task rows are derived from it: a task needs something to be
   * called, and the pair of events is the only durable record that a message was ever held.
   *
   * ⚠️ **So a task id may be this string — and a task derived from it may never assume something is
   * still holding it.** After any restart there is nothing to cancel, by design.
   *
   * ⚑ **D-017 · R3 moved the first half.** A stop ends nothing it held: a Close hands the held
   * messages to the next start, and a quit leaves their rows open for the next launch's start to
   * rebuild — so the hold now outlives the slot, and the NAME is what it is rebuilt under. ⚠️ Only
   * a CRASH's are still settled at the next launch, as below.
   *
   * 🔴 **`379` answered the question this section left open, and not the way it expected.** A task
   * id is NOT this string: `queueMessage` mints a `task_<uuid>` above the held/sent branch, so work
   * that went straight out to an idle child is a task too — the branch `354` deliberately left
   * nameless. What `379` did take from here is the PAIR: the ending carries the same
   * `messageId` as the beginning, which is how the fold knows a held task was handed over.
   */
  describe('§3 · what a restart does to a held message', () => {
    it('🔴 the name is on the slot AND in the ledger, and it is the same string', async () => {
      const id = await busySession()
      const held = await queueNamed(id, 'and afterwards, do this')

      expect(held).toMatch(/^msg_/)
      // ⚑ On the slot: this is what the composer is told, and what a cancel must name.
      expect(queuedDisclosure()).toMatchObject({ id: held, text: 'and afterwards, do this' })
      // ⚑ And in the ledger, which is the half that outlives the process.
      expect(ledgerEvents(id, 'message_queued').map((event) => event.messageId)).toEqual([held])
    })

    /**
     * ⚑ **D-017 · R3 — a Close is a STOP, and a stop ends nothing it held.** This read *"a clean
     * quit gives it an ending"* — `abandoned`, at the Close. ⛔ Now the message is handed on, the
     * conversation is started again for it, and it goes first: the ending it gets is `sent`, and it
     * still carries the SAME name the beginning did.
     */
    it('⚑ a Close hands it on, and the ending it gets when it goes carries the SAME name', async () => {
      const id = await busySession()
      const held = await queueNamed(id, 'this goes when it starts again')
      // ⛔ Non-vacuous: it really was held, and really had no ending yet.
      expect(ledger(id)).toContain('message_queued')
      expect(ledger(id).filter((one) => one.startsWith('message_unqueued'))).toEqual([])

      await host.close(id, sink)
      await waitFor(
        () => ledgerEvents(id, 'message_unqueued').length > 0,
        'the held message to go at the next start',
      )

      // ⚑ Exactly one ending, and it is the one it is sent with — never `abandoned`.
      const endings = ledgerEvents(id, 'message_unqueued')
      expect(endings).toHaveLength(1)
      expect(endings[0]).toMatchObject({ reason: 'sent', messageId: held })
      // ⛔ **Scoped to the field that carries it** — `text` is in this payload too, and an assertion
      // over the whole event could be satisfied by a neighbouring string.
      expect(endings[0]?.messageId).toBe(held)
      // ⚑ …and it went in the NEW start, after the reopen.
      const rows = ledger(id)
      expect(rows.lastIndexOf('message_unqueued:sent')).toBeGreaterThan(rows.indexOf('reopened'))
      expect(rows.indexOf('reopened')).toBeGreaterThan(-1)
    })

    it('🔴 a CRASH leaves the beginning with no ending — and 379 made the next launch settle it', async () => {
      const id = await busySession()
      const held = await queueNamed(id, 'nobody will ever answer this')
      const atTheCrash = ledger(id)

      // ⚠️ **The crash is simulated the only way it can be** (074, `orphan-runs.test.ts`): the rows
      // are left exactly as a killed process leaves them and the store is opened again. Nothing is
      // finalized, so `abandonQueued` never runs.
      expect(atTheCrash).toContain('message_queued')
      expect(atTheCrash.filter((one) => one.startsWith('message_unqueued'))).toEqual([])

      // 🔴 **A second host is what makes this a measurement rather than an observation.** The claim
      // is not "a killed process writes no ending" — that is obvious — it is that **the NEXT LAUNCH
      // does not write one either**. `settleOrphanRuns` reconciles a stranded RUN at construction
      // and there is no equivalent for a stranded MESSAGE.
      // ⛔ **Over a SECOND store object, and that is what makes the repair see this session.**
      // `live-hosts.ts` identifies a ledger by OBJECT — *"two `SessionStore`s opened over ONE
      // database file are two ledgers as far as this directory is concerned"* — so a host built on
      // the same store would find this session in `workRunningElsewhere` and exclude it from
      // `settleOrphanRuns` as work another live host holds. ⚠️ That is not what a crash looks like:
      // after one, nothing is alive, and the session IS in scope for the repair. Handing the new
      // host its own store reproduces that, which is the difference between measuring the repair
      // and measuring an exclusion.
      const next = buildHost(createSessionStore(db))
      try {
        // 🔴 **THIS ASSERTION WAS FLIPPED BY `379`, and the text it replaced is kept here verbatim
        // so the change is visible rather than merely absent:**
        //
        //     expect(ledger(id)).toEqual(atTheCrash)
        //     expect(ledgerEvents(id, 'message_unqueued')).toEqual([])
        //
        // ⚑ **`354` reported the gap and did not close it**; this file's own paragraph called it
        // *"the finding S1 needs before it is written."* `379` is S1, and it needed the repair
        // rather than the finding: a ledger holding `message_queued` with no ending is
        // byte-identical whether the app is alive and holding the message or died holding it, so no
        // derivation over the ledger can tell them apart. ⛔ **The difference has to be WRITTEN by
        // the one party that knows it** — the launch that finds a held message nothing is holding —
        // which is what `SessionStore.settleStrandedMessages` does, beside `settleOrphanRuns`.
        expect(ledger(id)).not.toEqual(atTheCrash)
        const [settled] = ledgerEvents(id, 'message_unqueued')
        expect(settled).toMatchObject({
          reason: 'abandoned',
          messageId: held,
          detail: 'the app stopped while this message was still waiting to be sent',
        })
        // ⛔ **`abandoned` and never `cancelled`**: nobody chose this. And the `detail` is required,
        // because `abandoned`'s own sentence is *"the conversation ended underneath it"* — which is
        // not what happened. ⚠️ Scoped to the field that carries it: `text` is in this payload too.
        expect(settled?.messageId).toBe(held)
      } finally {
        await next.closeAll()
      }

      // ⚑ **The name is what made the repair possible at all**: the beginning can be identified, so
      // the ending can be paired with it rather than guessed at by position.
      expect(ledgerEvents(id, 'message_queued')[0]?.messageId).toBe(held)
    })

    /**
     * ⚑ **D-017 · R3 — a quit stops it, and its next start takes the message back under its NAME.**
     * This was *"a reopened conversation comes back holding nothing"* — `077`'s ruling that re-arming
     * a message would send words written in a conversation that had since ended. ⛔ A quit ends
     * nothing now: the `message_queued` row stays open, and the next start rebuilds it from that row
     * — the same id, the same words — and sends it first. ⚑ So the name DOES survive the process:
     * the ledger's half is what the slot is rebuilt from.
     */
    it('⚠️ a quit leaves it waiting, and the next launch’s start takes it back under the SAME name and sends it', async () => {
      const id = await busySession()
      const held = await queueNamed(id, 'queued before the app closed')
      await host.closeAll()
      // ⛔ **No ending at the quit** — the row waits, named.
      expect(ledgerEvents(id, 'message_queued').map((event) => event.messageId)).toEqual([held])
      expect(ledgerEvents(id, 'message_unqueued')).toEqual([])

      host = buildHost()
      const reopened = new RecordingSink('owner:2')
      await host.resumeSession(id, reopened)
      await waitFor(
        () => ledgerEvents(id, 'message_unqueued').length > 0,
        'the message the quit left to go',
      )

      // ⚑ **The same name, on the ending the rebuilt message was sent with.**
      expect(ledgerEvents(id, 'message_unqueued')).toEqual([
        expect.objectContaining({ reason: 'sent', messageId: held }),
      ])
      // ⚑ **The paired positive**: the words the new start was handed are the words that were held.
      expect(
        ledgerEvents(id, 'user_turn').some((turn) => turn.text === 'queued before the app closed'),
      ).toBe(true)
    })
  })

  /**
   * ⛔ **A host whose FLUSH can be held open with the provider holding the message** (the shape
   * `queued-message.test.ts` built for `234` §1, narrowed to what this file needs).
   *
   * ⚠️ **Parked INSIDE `handle.send`, which is the only place the three facts are true at once**:
   * `session.flushing` is set, `session.queued` still names the held message, and the provider
   * already has it. That is the window the cancel rails' ORDER is about, and it cannot be reached
   * from outside the host any other way.
   *
   * ⚑ **Armed explicitly**, because the session's FIRST turn goes through `handle.send` too — a gate
   * installed for the whole life of the host would park the setup instead of the flush.
   */
  function gatedFlushHost(): {
    runtime: RuntimeHost
    arm: () => void
    release: () => void
    reachedSend: Promise<void>
  } {
    const latch = (): { promise: Promise<void>; open: () => void } => {
      let open = (): void => {}
      const promise = new Promise<void>((resolve) => {
        open = resolve
      })
      return { promise, open }
    }
    const gate = latch()
    const reached = latch()
    let armed = false
    const bind = <T extends object>(target: T, prop: string | symbol): unknown => {
      const value = Reflect.get(target, prop) as unknown
      return typeof value === 'function' ? value.bind(target) : value
    }
    const runtime = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(dir, 'exports'),
      createRuntime: (provider) => {
        const inner = new FakeRuntime(provider, { sessions: providerSessions })
        return new Proxy(inner, {
          get(target, prop) {
            if (prop !== 'start') return bind(target, prop)
            return async (opts: Parameters<(typeof inner)['start']>[0]) => {
              const handle = await target.start(opts)
              return new Proxy(handle, {
                get(held, key) {
                  if (key !== 'send') return bind(held, key)
                  return async (text: string) => {
                    const sent = (bind(held, 'send') as (one: string) => Promise<void>)(text)
                    if (!armed) return sent
                    reached.open()
                    await gate.promise
                    return sent
                  }
                },
              })
            }
          },
        })
      },
      prepareProviderHome: (provider) => join(dir, 'provider-homes', provider),
      providerHomePath: (provider) => join(dir, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => `sess_${++sessions}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    return {
      runtime,
      arm: () => {
        armed = true
      },
      release: gate.open,
      reachedSend: reached.promise,
    }
  }

  /**
   * # 🔴 Cancellation names the message
   *
   * ⛔ **The window a name closes.** A queued banner renders, and before its Cancel is pressed the
   * running turn can end, the held message can go, and another can be queued behind the turn it
   * started. A cancel that named only the session took back the second one — a message nobody had
   * been offered a cancel for.
   */
  describe('cancellation names the message', () => {
    it('🔴 refuses an id this session is not holding — and the held message is still held', async () => {
      const id = await busySession()
      const held = await queueNamed(id, 'the one that is really waiting')

      // ⚠️ **The wording moved with `394`'s mailbox — *a* message rather than *the* message** — and
      // the sentence had to: a conversation can hold a routed question beside its work, so naming
      // "the" one would be false in exactly the state the mailbox was built for.
      await expect(host.cancelQueuedMessage(id, 'msg_somebody_elses', sink)).rejects.toThrow(
        'not a message this conversation is holding',
      )
      // ⛔ **The refusal NAMES what is held**, scoped to that and not to the sentence as a whole.
      await expect(host.cancelQueuedMessage(id, 'msg_somebody_elses', sink)).rejects.toThrow(held)
      // ⚑ **Paired positive over the same state**: nothing was taken back, and the message is still
      // there to be cancelled — without this the refusal above would also pass against a cancel
      // that threw *after* dropping the message.
      expect(ledgerEvents(id, 'message_unqueued')).toEqual([])
      expect(queuedDisclosure()).toMatchObject({ id: held })

      // ⚑ **The same call, one fact over: the right name.** This is the pairing Slice 3 holds every
      // rail to — a test that stopped reaching the rule would go red rather than green.
      await expect(host.cancelQueuedMessage(id, held, sink)).resolves.toBeUndefined()
      expect(ledgerEvents(id, 'message_unqueued')[0]).toMatchObject({
        reason: 'cancelled',
        messageId: held,
      })
    })

    it('⚠️ the three refusals are three different ANSWERS, not three different strings', async () => {
      // ⛔ **This assertion was `expect(nothing).not.toBe(wrong)` and a mutation walked through it.**
      // The wrong-id sentence interpolates the held id, so *any* second sentence differs from it by
      // that id alone — including one that made "nothing is held" claim the session was holding
      // something. Two strings differing is not two answers differing; what a caller has to be able
      // to do is TELL THEM APART, and each of the three has to be true of the state it names.
      //
      // ⚑ **All three are collected in one place**, which needs the gated host: the too-late answer
      // exists only while a flush is in flight, and a vocabulary walk missing a member is how `340`
      // let one reason answer with another reason's sentence.
      const gated = gatedFlushHost()
      const said = async (run: () => Promise<void>): Promise<string> => {
        try {
          await run()
          return ''
        } catch (error) {
          return error instanceof Error ? error.message : String(error)
        }
      }
      try {
        const created = await gated.runtime.createSession({ provider: 'claude' }, sink)
        const id = created.sessionId

        // 1 · nothing is held at all.
        const nothing = await said(() => gated.runtime.cancelQueuedMessage(id, 'msg_nothing', sink))

        await gated.runtime.send(id, 'the first thing', sink)
        await waitFor(() => sink.types().includes('permission_request'), 'the card')
        const outcome = await gated.runtime.queueMessage(id, 'the held one', sink)
        const held = outcome.outcome === 'queued' ? outcome.messageId : ''

        // 2 · something is held, and it is not the one being named.
        const wrong = await said(() => gated.runtime.cancelQueuedMessage(id, 'msg_wrong', sink))

        // 3 · the right one, while its flush is in flight.
        gated.arm()
        await gated.runtime.respondPermission(id, 'turn_1_perm', { outcome: 'allow' }, sink)
        await gated.reachedSend
        const tooLate = await said(() => gated.runtime.cancelQueuedMessage(id, held, sink))

        // ⛔ Non-vacuity: all three really refused. A branch that returned quietly would answer `''`
        // and would otherwise slip through the distinctness check as a fourth distinct "answer".
        for (const answer of [nothing, wrong, tooLate]) expect(answer.length).toBeGreaterThan(10)
        expect(new Set([nothing, wrong, tooLate]).size).toBe(3)

        // 🔴 …and each says the thing that is true of ITS state, rather than merely differing.
        expect(wrong).toContain(held)
        expect(nothing).not.toContain(held)
        expect(tooLate).toContain('already being sent')
        // ⛔ The two that are NOT about a send must not claim one — the false sentence is the one
        // worth pinning, and it is the one `M23` puts back.
        expect(nothing).not.toContain('already being sent')
        expect(wrong).not.toContain('already being sent')

        gated.release()
      } finally {
        await gated.runtime.closeAll()
      }
    })

    it('⛔ mid-flush, a WRONG name is refused as wrong and the right one as too late', async () => {
      // 🔴 **The one state in which the two rails give different answers**, and therefore the only
      // state that measures their ORDER. Everywhere else `session.flushing` is null and the identity
      // check is the only one that can speak; here both can, and the identity check has to go first
      // or a cancel naming a message this session never held is answered *"that message is already
      // being sent"* — `340`'s finding (a reason answering with another reason's sentence).
      const gated = gatedFlushHost()
      try {
        const created = await gated.runtime.createSession({ provider: 'claude' }, sink)
        const id = created.sessionId
        await gated.runtime.send(id, 'the first thing', sink)
        await waitFor(() => sink.types().includes('permission_request'), 'the card')
        const outcome = await gated.runtime.queueMessage(id, 'racing the flush', sink)
        const held = outcome.outcome === 'queued' ? outcome.messageId : ''

        // Answering the card ends the turn, which is the boundary the flush hangs off.
        gated.arm()
        await gated.runtime.respondPermission(id, 'turn_1_perm', { outcome: 'allow' }, sink)
        await gated.reachedSend

        await expect(gated.runtime.cancelQueuedMessage(id, 'msg_wrong', sink)).rejects.toThrow(
          'not a message this conversation is holding',
        )
        // ⚑ **The paired positive over the same instant**: the RIGHT name is refused too, and for
        // the other reason — `077`'s guard, unmoved. Recording this one as cancelled would put both
        // `cancelled` and `sent` in the ledger for a message the provider already has.
        await expect(gated.runtime.cancelQueuedMessage(id, held, sink)).rejects.toThrow('too late')

        gated.release()
        await waitFor(
          () =>
            store
              .events(id)
              .some(
                (row) => row.event.type === 'user_turn' && row.event.text === 'racing the flush',
              ),
          'the gated flush completing',
        )
      } finally {
        await gated.runtime.closeAll()
      }
    })

    it('⛔ the WIRE refuses a cancel that names no message rather than stripping the field', () => {
      // ⚠️ `303` B, from the other side: this schema drops unknown keys, so a field that is not
      // DECLARED travels no distance at all. Declared and required, an older shape is refused with
      // a sentence rather than cancelling whatever happens to be held.
      const withoutIt = runtimeCommandSchema.safeParse({
        kind: 'cancelQueuedMessage',
        sessionId: 'sess_1',
      })
      expect(withoutIt.success).toBe(false)

      // ⚑ **The positive that differs from the default**: the same command WITH the field parses,
      // and the field survives the parse rather than being stripped on the way through.
      const withIt = runtimeCommandSchema.safeParse({
        kind: 'cancelQueuedMessage',
        sessionId: 'sess_1',
        messageId: 'msg_1',
      })
      expect(withIt.success).toBe(true)
      expect(withIt.success && withIt.data).toMatchObject({ messageId: 'msg_1' })
    })
  })

  /**
   * # 🔴 D-010 · a second message is held beside the first, each by its own name
   *
   * ⛔ **Criterion 13's refusal is gone**: it refused a reply to a busy parent, which was then lost,
   * and it protected nothing the mailbox (a list since `394`) does not already keep.
   */
  describe('D-010 · several held messages, each named', () => {
    it('🔴 a second queue is HELD under a name of its own, and the first is untouched', async () => {
      const id = await busySession()
      const first = await queueNamed(id, 'the first waiting one')
      const second = await queueNamed(id, 'the second waiting one')

      expect(second).not.toBe(first)
      expect(ledgerEvents(id, 'message_queued').map((event) => event.messageId)).toEqual([
        first,
        second,
      ])
      // ⚑ **Both disclosed, in the order they were held** — the head is the one going next.
      expect(sink.liveness.at(-1)?.queued?.map((one) => one.id)).toEqual([first, second])
    })
  })

  /**
   * # ⚑ §2.5 · An interruption does not contend with the singleton
   *
   * ⚠️ **Asserted now so S5 does not discover it late.** `340` put `interrupt` on the commanding
   * list and `sendInterrupting` already exists; neither consults `session.queued`, and the queue is
   * held back rather than dropped — but *"nothing reads the field"* is a fact about today's code,
   * and this is the fact about the behaviour.
   *
   * 🔴 **D-027 · R2 moved the order, and nothing else this pins.** A person's Stop and send used to
   * go at once, as the replacement, with the held message following at the replacement's end
   * (`077`'s order). ⚑ Now, when nothing that goes alone stands in the way, its words JOIN what
   * waits: held last, and sent with it as one turn, oldest first. ⛔ Still true: the interrupt is
   * neither blocked nor refused by what is held, and the held message keeps the name it was given.
   */
  describe('§2.5 · an interruption does not contend', () => {
    it('🔴 a held message neither blocks the interrupt nor loses its name to it', async () => {
      const id = await busySession()
      const held = await queueNamed(id, 'the one that was waiting')

      const cards = (): string[] =>
        sink
          .events()
          .filter(
            (event): event is Extract<TranscriptEvent, { type: 'permission_request' }> =>
              event.type === 'permission_request',
          )
          .map((event) => event.id)
      const cardsBefore = cards().length

      // ⛔ **The interruption is not refused by what is held, and does not wait behind it** — the
      // verb resolves with the turn stopped. ⚑ D-027 · its words are then held last (F5: it resolves
      // once they are), and the flush its press lets go of sends them with what waited.
      await host.sendInterrupting(id, 'no, do THIS', sink)

      const userTurns = (): Extract<TranscriptEvent, { type: 'user_turn' }>[] =>
        ledgerEvents(id, 'user_turn')
      await waitFor(() => userTurns().length > 1, 'the one turn the stop let go')

      // 🔴 **D-027 · ONE turn after the stopped one, never two** — the held message and the words
      // that stopped the turn, each its own part, the held one first: oldest first.
      expect(userTurns()).toHaveLength(2)
      const [, joined] = userTurns()
      expect(joined?.parts).toBeDefined()
      expect(joined === undefined ? [] : theMessagesOf(joined).map((one) => one.text)).toEqual([
        'the one that was waiting',
        'no, do THIS',
      ])

      // ⚑ **And the provider is RUNNING it** — the one turn parks on a card of its own.
      // ⛔ **Waited for a NEW card, never for "a card"** — the first one is still in this sink, so
      // `at(-1) !== undefined` was satisfied by the card the interrupt had just destroyed.
      await waitFor(() => cards().length > cardsBefore, 'the joined turn`s own card')

      // 🔴 **Its ending carries the name it was given before the interrupt** — the id is not
      // re-minted by anything the interruption did. ⚑ D-027 · the words that joined it were held
      // under a name of their own, and each is ended by its own name, in the order they were held.
      const names = ledgerEvents(id, 'message_queued').map((event) => event.messageId)
      expect(names).toHaveLength(2)
      expect(names[0]).toBe(held)
      expect(names[1]).not.toBe(held)
      expect(
        ledgerEvents(id, 'message_unqueued').map((event) => [event.messageId, event.reason]),
      ).toEqual([
        [held, 'sent'],
        [names[1], 'sent'],
      ])
      // ⚑ …and nothing is left held for a turn that is not coming.
      expect(sink.liveness.at(-1)?.queued ?? []).toEqual([])
    })
  })

  /**
   * # ⛔ The one caller a test cannot press
   *
   * ⚠️ **`RuntimeScreen.cancelQueued` is a click handler in a `.vue` file**, and the wiring that
   * matters is which id it hands the store. Every other layer of this change is measured by
   * behaviour; this one is a source census, and it is here rather than nowhere because a line no
   * test can make red is a line nobody is checking.
   *
   * ⚑ **688 · re-aimed, not stripped** (standing rule 26). The handler now takes the NAME of the row
   * that was pressed — R33's take-back of a held go-ahead must take back the go-ahead and not
   * whatever sits at the head of the mailbox — and reads the disclosure not at all: a row with no
   * name (a ledger before `354`) offers no *Cancel it* (`QueuedMessage`'s `cancel`, measured in
   * `who-wrote-it-and-which-task.dom.test.ts` §1), because main's mailbox never holds a nameless
   * message and the head was always a DIFFERENT one. ⚠️ **Still a source census, and only that**:
   * no test mounts `RuntimeScreen`; the press is measured by behaviour up to the pane's own
   * `cancelQueued` emit (the DOM test above), and from here on by these lines.
   */
  describe('the composer names the message it was shown', () => {
    it('⛔ the cancel handler hands the store the PRESSED row’s name, and never the head of the mailbox', () => {
      const screen = join(
        dirname(fileURLToPath(import.meta.url)),
        '../src/renderer/src/components/RuntimeScreen.vue',
      )
      // ⚠️ **Comment-free, so prose cannot answer for code** — the handler carries a paragraph
      // explaining exactly the rule this asserts, and a census that read it would pass over a
      // handler that did the opposite.
      const code = readFileSync(screen, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .join('\n')
      const handler = code.slice(
        code.indexOf('function cancelQueued('),
        code.indexOf('function decide('),
      )
      // ⛔ Non-vacuity: an empty slice would agree with every assertion below.
      expect(handler.length).toBeGreaterThan(60)
      // 🔴 **688 · the pressed row's own name**, straight to the store.
      expect(handler).toContain('function cancelQueued(messageId: string)')
      expect(handler).toContain('store.cancelQueuedMessage(id, messageId)')
      expect(handler).not.toMatch(/messageId\s*=[^=]/)
      // ⛔ …never the disclosure's head, which is a different message whenever a row is pressed.
      expect(handler).not.toContain('meta?.queued')
      // ⛔ …and there is no session-shaped call left to fall back on.
      expect(handler).not.toMatch(/cancelQueuedMessage\(\s*activeId\.value\s*\)/)
      // ⚑ **The binding hands the pane's argument through** — a method reference receives it.
      expect(code).toContain('@cancel-queued="cancelQueued"')
    })
  })

  /**
   * # 🔴 D-027 · everything held goes as ONE turn, in the order it was held
   *
   * ⚑ **This read *"D-010 · each goes as its own turn"*, and pinned three turns for three held
   * messages.** D-027 inverted that rule (everything waiting goes together, as one turn, oldest
   * first): one turn's end now sends all three as one `user_turn` whose `parts` are
   * the three messages. ⛔ What it still pins: none dropped, none reordered, and each ended by its
   * own name.
   */
  describe('D-027 · everything held goes as ONE turn, in the order it was held', () => {
    it('🔴 three held messages become ONE turn of three parts, first held first — none dropped', async () => {
      const id = await busySession()
      const held = [
        await queueNamed(id, 'second'),
        await queueNamed(id, 'third'),
        await queueNamed(id, 'fourth'),
      ]
      const userTurns = (): Extract<TranscriptEvent, { type: 'user_turn' }>[] =>
        ledgerEvents(id, 'user_turn')
      const parked = (): string[] =>
        sink
          .events()
          .filter(
            (event): event is Extract<TranscriptEvent, { type: 'permission_request' }> =>
              event.type === 'permission_request',
          )
          .map((event) => event.id)

      // ⚑ **One turn boundary lets all three go** — answering the first turn's card ends it.
      const before = parked().length
      await host.respondPermission(id, parked().at(-1) as string, { outcome: 'allow' }, sink)
      await waitFor(() => userTurns().length > 1, 'the held messages going')
      // ⚑ …and the one turn they went in is running: it parks on a card of its own.
      await waitFor(() => parked().length > before, 'the one turn`s card')

      // 🔴 **Two turns in all, never four** — the first, then one carrying the three.
      expect(userTurns().map((event) => event.text)).toEqual([
        'the first thing',
        'second\n\nthird\n\nfourth',
      ])
      const [, together] = userTurns()
      // ⛔ **Each its own part, first held first** — read through the one reader of a turn's
      // messages, never off the joined `text`.
      expect(together === undefined ? [] : theMessagesOf(together).map((one) => one.text)).toEqual([
        'second',
        'third',
        'fourth',
      ])
      // ⛔ **Each ended by its own name**, in the order it was held — and every ending is `sent`.
      expect(
        ledgerEvents(id, 'message_unqueued').map((event) => [event.messageId, event.reason]),
      ).toEqual(held.map((name) => [name, 'sent']))
      // ⚑ **Written just before the one turn**, so no reader finds a message both sent and waiting.
      const rows = ledger(id)
      const theTurn = rows.lastIndexOf('user_turn')
      expect(theTurn).toBeGreaterThan(3)
      expect(rows.slice(theTurn - 3, theTurn + 1)).toEqual([
        'message_unqueued:sent',
        'message_unqueued:sent',
        'message_unqueued:sent',
        'user_turn',
      ])
      // ⚑ …and nothing is left held for a turn after it.
      expect(sink.liveness.at(-1)?.queued ?? []).toEqual([])
    })
  })
})
