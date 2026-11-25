import type { Provider } from '@brobot2/shared'
import { type SessionSlot, onItsWayOut } from './session-slot'
import { SessionUnavailable } from '../session-unavailable'
import { ownerName } from './whose-words'
import type { SessionHandle, StartPhaseSink, StartPhase } from '@brobot2/runtime'
import { errorMessage, type SessionEnding } from '../session-disclosures'
import type { StartAttemptOutcome, StartAttemptLine } from '../../start-attempt-line'
import { randomUUID } from 'node:crypto'
import { THE_APP_ITSELF, type Caller } from '../conversation-caller'
import type { LaunchRegistry, Launch } from '../launch-registry'
import type { HostedSession } from './hosted-session'
import type { OwedQuestion } from './deliveries'
import type { ItsLedger } from '../work-records'
import type { PieceRow } from '../../../shared/task-contracts'
import type { RuntimeChangeMessage } from '../../../shared/runtime-ipc'
import type { SessionStore } from '../../db/session-store'

/** What Launching reaches in RuntimeHost, each read only when called. */
interface LaunchingHost {
  homeLaunches(): Map<Launch, { provider: Provider; profileId: string; uncertain?: boolean }>
  launches(): LaunchRegistry
  slots(): Map<string, SessionSlot>
  owedAsLastRead(): Map<string, readonly OwedQuestion[]>
  waitAsLastRead(): Map<string, ItsLedger>
  workOutAsLastRead(): Map<string, readonly PieceRow[]>
  startingForADeliveryWithNoWindow(): Set<string>
  reservingAStartFrom(): string | null
  closeDrainTimeoutMs(): number
  launchTimeouts(): Readonly<Record<Provider, { readonly fresh: number; readonly resume: number }>>
  recordStartAttempt(): ((line: StartAttemptLine) => void) | undefined
  close(sessionId: string, by: Caller): Promise<void>
  finalize(session: HostedSession, ending: SessionEnding): Promise<void>
  monotonicNow(): number
  now(): number
  rejectedConnectionTermination(error: unknown, launch: Launch): Promise<void> | undefined
  rememberHomeLaunch(provider: Provider, profileId: string, launch: Launch): void
  startedAfterARefusedCopy(
    provider: Provider,
    profileId: string | null,
    launch: () => Promise<SessionHandle>,
    stillWanted: () => boolean,
  ): Promise<SessionHandle>
  stateMayHaveMoved(conversation: string): void
  terminationOf(handle: SessionHandle, teardown: Promise<void>, launch?: Launch): Promise<void>
  theWorldMoved(what: RuntimeChangeMessage['what']): void
  settledWithin(promise: Promise<unknown>, ms: number): Promise<boolean>
  workRunningElsewhere(): ReadonlySet<string>
}

type LaunchingDeps = { readonly store: Pick<SessionStore, 'recordedOne'> }

/** A conversation's start reserved, timed, awaited, given up on or cancelled, and a start that fails cleaned up. */
export class Launching {
  constructor(
    private readonly readDeps: () => LaunchingDeps,
    private readonly host: LaunchingHost,
  ) {}

  /** RuntimeHost's wrapped deps, read when used: the leaf is built before RuntimeHost wraps them. */
  private get deps(): LaunchingDeps {
    return this.readDeps()
  }

  /**
   * **Take the id before asking the provider for anything** (062, from 061 finding 2).
   *
   * Synchronous, and that is the whole mechanism: two resumes of the same record cannot both get
   * past this line, because nothing runs between the `has` and the `set`.
   */
  reserve(
    id: string,
    /**
     * ⛔ **One argument, because two adjacent `string | null`s are a swap waiting to happen** (340).
     * They are also the two halves of one decision — who this session is FOR and who may drive it —
     * and every caller answers both or neither.
     */
    held: {
      readonly ownerId: string | null
      /**
       * 🔴 **Whether the owner above is a surface with a person behind it** (349).
       *
       * ⛔ **In this bag and not a fourth positional argument, for the reason the bag exists**: it
       * is the second half of one answer, and a caller that could give the id without the fact
       * would be a caller that had never decided. See {@link SessionSlot.ownerIsAPerson}.
       */
      readonly ownerIsAPerson: boolean
      readonly commandedBy: string | null
      readonly spawnedBy: string | null
      readonly provider?: Provider
      /**
       * 🔴 **Which identity this slot is going to BE, known before the provider arrives** (347).
       *
       * ⛔ **This is what closes 341's named race.** `give_work`'s lookup —
       * {@link GiveFacts.helperAs} (D-016) — reads it, so a launch in flight into an identity is
       * found, and two gives issued in the same tick find one conversation rather than starting two.
       *
       * ⚠️ **`null` is reachable and means "not known here"**, not "no profile": a resumed row that
       * was adopted from a provider home carries no profile id, and inventing one would be worse
       * than admitting the gap. Such a slot simply does not answer the lookup.
       */
      readonly profileId: string | null
      /**
       * 🔴 **Did an AGENT ask for this conversation?** (661, from `656` F2) — the half of
       * {@link SessionSlot.bornWithoutASurface} a reservation cannot see in its own `ownerId`.
       *
       * ⛔ **A durable fact, answered the same on every life.** A create answers it from the spawn
       * token it was handed; a resume answers it from the provenance row `341` writes in the same
       * transaction as the conversation — so a window that reopens an agent's child after a quit
       * gets the same answer the spawn did, and the child is still one a departing window RELEASES.
       */
      readonly anAgentAskedForIt: boolean
    },
    launchKey: string | null,
  ): SessionSlot {
    const { ownerId, ownerIsAPerson, commandedBy, spawnedBy, profileId, anAgentAskedForIt } = held
    if (this.host.launches().closed) {
      throw new SessionUnavailable(
        'shutting-down',
        `BroCrew is shutting down, so session ${id} was not started`,
      )
    }
    // The same sentence `resumeSession` has always raised for an already-open session — it is now
    // raised for one that is merely on its way, which is the case that used to spawn twice.
    //
    // ⚠️ **Except when it is CLOSING, where that sentence was a lie** (075, from 072 §5.3). The
    // renderer drops a conversation from the open list on the terminal event and offers it under
    // Reopen from that moment — and the terminal event is emitted by `stopProvider`, which is the
    // FIRST thing `runFinalize` does. Everything after it (the drain, `store.terminate`, the
    // archive) still holds this slot, so for the whole of that window the app offered a button it
    // then refused, naming a state it had already told the user was over. `resumeSession` waits
    // that out now; this sentence is what is left when the wait expires, and it says which.
    //
    // Attach a live session already owned by this window through {@link attachHeldSession} before reaching these checks. Remaining refusals have distinct reasons from {@link describeUnavailable}; keep the id in diagnostics rather than the sentence shown to the person.
    const existing = this.host.slots().get(id)
    if (existing !== undefined) {
      // Torn down through EITHER door — `close()` marks the phase, a stream that ended on its own
      // only sets `finalizing`. See {@link settleTeardown}, which waits on the same two.
      if (onItsWayOut(existing)) {
        throw new SessionUnavailable(
          'still-closing',
          `session ${id} is still closing — it could not be reopened yet`,
        )
      }
      // Reserved, and the provider has not arrived. Bounded since 102 — the launch gives up on
      // itself at {@link DEFAULT_LAUNCH_TIMEOUT_MS} — so this is now a state that ENDS rather than
      // one nothing transitions out of; what it still cannot say is when, so the elapsed time
      // remains the fact worth reporting about it.
      if (existing.session === null) {
        const openingForMs = this.host.now() - existing.since
        throw new SessionUnavailable(
          'still-opening',
          `session ${id} is still opening — reserved ${openingForMs}ms ago by ` +
            `${ownerName(existing.ownerId)}, and its provider has not arrived`,
          { openingForMs },
        )
      }
      // Live. Whether this is the caller's own or somebody else's is the difference between "you
      // are already looking at this" and 062's deliberate refusal to join a second window onto a
      // session whose events go to another sink — and they must not share a sentence again.
      throw new SessionUnavailable(
        // ⚠️ **A null owner is not 'already-open'** (336): `null === null` would be true for a
        // second surfaceless create of the same id and would tell the caller *"you are already
        // looking at this"* about a conversation nobody is looking at. ⛔ **336 sent it to
        // `already-open-elsewhere` instead, and that is the half 421 undid.**
        //
        // 🔴 **So it is neither of them now.** *"Switch to that window to carry on with
        // it"* was the sentence a person got for pressing Reopen on a conversation an agent had
        // started — and there is no window to switch to, because `ownerId === null` is 336's
        // session nobody owns. ⛔ The refusal was right and every word of the reason was a lie,
        // which is the test three docblocks in `session-unavailable.ts` apply to a shared code.
        // The way out is `claimSession`, one method over, and the sentence now names it.
        existing.ownerId === null
          ? 'held-by-nobody'
          : existing.ownerId === ownerId
            ? 'already-open'
            : 'already-open-elsewhere',
        `session is already open: ${id} (held for ${ownerName(existing.ownerId)}, asked for by ` +
          `${ownerName(ownerId)})`,
      )
    }
    // ⛔ **And this is the case NO slot of ours can see, because it is in another slot map** (198,
    // from 191 H7 and 194 H2). Reservation above is synchronous and that is what makes it a lock —
    // but only over this host's own map. Two hosts over one database both find the id free, both
    // read the same `nextOrdinal`, and both resume the same provider reference; the one that loses
    // the `(session_id, generation, ordinal)` race records a failure and then refuses every later
    // durable write while its provider goes on producing output nobody is writing down.
    //
    // ⚠️ **Asked BEFORE the reservation is written, and answered from living objects.** The
    // single-instance lock removes the second APP; it does not remove the second host, which is
    // what every test builds and what a window-per-project would build. See `live-hosts.ts`.
    if (this.host.workRunningElsewhere().has(id)) {
      throw new SessionUnavailable(
        'run-by-another-host',
        `session ${id} is being run by another RuntimeHost in this process (asked for by ` +
          `${ownerName(ownerId)})`,
      )
    }
    // ⚠️ **And this is the case the slot alone could never see** (070, from 068 finding 2): a
    // session whose slot is GONE — finalized, or handed back — but whose provider we could not
    // confirm stopped. The slot is released by the session ending; the launch is released by the
    // process ending, and those are different moments whenever a stop times out. Resuming into that
    // gap is what put two providers on one transcript.
    const unconfirmed = this.host.launches().refuse(id)
    if (unconfirmed !== null) {
      throw new SessionUnavailable(
        'not-confirmed-stopped',
        `session ${id} cannot be reopened: ${unconfirmed}`,
      )
    }
    let settle: () => void = () => {}
    const arrived = new Promise<void>((resolve) => {
      settle = resolve
    })
    const slot: SessionSlot = {
      id,
      provider: held.provider ?? this.deps.store.recordedOne(id)?.provider ?? null,
      ownerId,
      // ⛔ **Beside the id it qualifies, and taken from the same argument** (349). Both halves of
      // *"who is watching this"* are written here and move together from here on — see
      // {@link SessionSlot.ownerIsAPerson}.
      ownerIsAPerson,
      // ⛔ Read from the reservation's own argument, not from the slot field, because the field is
      // the one thing about this slot that moves (336). See {@link SessionSlot.ownerId}.
      bornWithoutASurface: ownerId === null || anAgentAskedForIt,
      // ⚑ **D-017 · R5** — see {@link SessionSlot.aDeliveryStartedItWithNoWindow}.
      aDeliveryStartedItWithNoWindow:
        ownerId === null && this.host.startingForADeliveryWithNoWindow().has(id),
      // ⚑ **W4.175** — see {@link SessionSlot.startedFrom}.
      startedFrom: this.host.reservingAStartFrom(),
      // ⛔ Straight from the argument and never assigned again — see {@link SessionSlot.commandedBy}.
      commandedBy,
      // …and the same rule, for the same reason — see {@link SessionSlot.spawnedBy}.
      spawnedBy,
      // ⛔ **Fixed at reservation and never assigned again, which is the entire point of it being
      // here rather than read off the registered session** (347). See {@link SessionSlot.profileId}.
      profileId,
      since: this.host.now(),
      launchKey,
      phase: 'starting',
      launch: this.host.launches().open(`session ${id}`, id),
      session: null,
      arrived,
      settle,
    }
    this.host.slots().set(id, slot)
    if (slot.provider !== null && profileId !== null)
      this.host.rememberHomeLaunch(slot.provider, profileId, slot.launch)
    // ⚑ **D-019 · a reservation whose provider has not come up is *active*.**
    this.host.stateMayHaveMoved(id)
    return slot
  }

  /** Give up a reservation that never became a session. Identity-checked, so it is safe to repeat. */
  private abandon(slot: SessionSlot): void {
    if (slot.session !== null || this.host.slots().get(slot.id) !== slot) return
    this.host.slots().delete(slot.id)
    // ⚑ **D-019 · no longer starting** — and with no slot, only its ledger speaks for it.
    this.host.waitAsLastRead().delete(slot.id)
    this.host.workOutAsLastRead().delete(slot.id)
    this.host.owedAsLastRead().delete(slot.id)
    this.host.stateMayHaveMoved(slot.id)
  }

  async cleanUpAFailedStart(slot: SessionSlot): Promise<void> {
    if (slot.session !== null) await this.host.finalize(slot.session, 'stream-failed')
    else {
      this.abandon(slot)
      this.host.launches().finish(slot.launch)
    }
  }

  /**
   * Why a provider that has just arrived cannot be registered, or null when it can.
   *
   * ⚠️ **Synchronous, and it must stay that way.** Its two callers ask it and then call
   * {@link register} with nothing awaited in between — see {@link SessionSlot}. An `await` here
   * would re-open the race the reservation exists to close: a `close()` landing in the gap would
   * mark the slot and then wait on `arrived` for a session that had already registered behind it.
   */
  whyNotOurs(slot: SessionSlot): string | null {
    // A reservation that is no longer the one in the map is not ours to complete, whoever took it.
    // Unreachable today — only `abandon` and `handBack` remove a starting slot, and both are the
    // reserver's own — but "unreachable" is not a reason to leak a provider if it ever is.
    if (this.host.slots().get(slot.id) !== slot)
      return 'lost its reservation while its provider was starting'
    if (onItsWayOut(slot)) return 'was closed while its provider was still starting'
    return null
  }

  /**
   * The provider arrived for a slot somebody has since closed: stop it and let it go.
   *
   * This is the orphan 061 named. Registering here would put a live session into a host that is on
   * its way down — its first ledger row would land on a closed database and its events on a dead
   * sink — and NOT registering without closing would leave a provider child running with nothing
   * holding its handle. Bounded like every other stop we wait on, so one adapter that will not
   * settle cannot hang the quit.
   */
  async handBack(slot: SessionSlot, handle: SessionHandle): Promise<void> {
    // Identity-checked through {@link abandon}: a plain `delete` by id would unregister somebody
    // ELSE's session if the id had been re-taken, while we were only trying to let go of ours.
    this.abandon(slot)
    const closing = (async () => handle.close())().catch((error: unknown) => {
      const home = this.host.homeLaunches().get(slot.launch)
      if (home !== undefined) home.uncertain = true
      console.warn(
        `runtime session ${slot.id} failed to close while starting: ${errorMessage(error)}`,
      )
    })
    // ⚠️ **The reservation goes now; the OWNERSHIP goes when the provider does** (070, from 068
    // finding 2). `abandon` above frees the slot immediately, which is right — there is no session
    // here and nothing to close from the UI — but it used to free the id as well, and the id is what
    // a resume takes. So a Close during a start, followed by a Reopen, could put a second provider
    // on the same transcript while the first was still closing. The launch is handed back to the
    // termination itself, so the id stays refused for exactly as long as we do not know.
    //
    // ⛔ **And until 233 that last sentence was false here for Claude** (229 H1): `closing` is a
    // bounded teardown, not a receipt, so this path released the id while the CLI child was alive —
    // on the very gesture the comment above describes. {@link terminationOf} is the rule.
    this.host.launches().finish(slot.launch, this.host.terminationOf(handle, closing, slot.launch))
    if (!(await this.host.settledWithin(closing, this.host.closeDrainTimeoutMs()))) {
      console.warn(
        `runtime session ${slot.id}: the provider arrived after the session was closed and did not ` +
          `stop within ${this.host.closeDrainTimeoutMs()}ms — a provider process may still be running`,
      )
    }
  }

  /**
   * **Wait for a launch — but not forever, and never at the cost of forgetting it** (102).
   *
   * The one unbounded await this host made. Every other wait it takes is bounded and says so —
   * {@link awaitArrival}, {@link settleTeardown}, `doStopProvider`, `closeAll`, the sign-in and its
   * cancel — and the sibling probe has been bounded at fifteen seconds since 058, for a reason that
   * reads across word for word: *"a hang is strictly worse than a failure, because a failure is a
   * state the layer above already knows how to handle."* Here the layer above is a person, the
   * state was a launcher that never settled, and 100 measured what it cost: quitting the app.
   *
   * ⚠️ **Stopping the wait is the easy half and it is NOT the contract** — that is 070's whole
   * sentence, and `withDeadline` says it out loud: *"rejecting only releases the AWAITER; it does
   * not release the work."* So expiring does three things in order, and the third is the one that
   * would be missed:
   *
   *  1. **abort**, which is what reaches a provider whose handle we never got. Codex spawns its
   *     detached child before the handshake it is now failing to answer.
   *  2. **keep owning it**, by handing the launch its own aftermath. The reservation goes so the
   *     user can try again; the LAUNCH stays, so `reserve` keeps refusing that id until the process
   *     is confirmed gone — the same split {@link handBack} makes for the same reason.
   *  3. **close whatever still arrives.** A handshake that answers one millisecond after we gave up
   *     hands back a live provider that nobody is awaiting any more. Without this line that child
   *     runs on, unowned, and the retry that follows puts a SECOND provider on the same transcript —
   *     which is the exact failure 070 exists to prevent.
   *
   * `launch` is a thunk rather than a promise so an adapter that throws synchronously is a rejection
   * here rather than an exception that escapes the bound entirely.
   */
  async awaitLaunch(
    slot: SessionSlot,
    opening: { readonly provider: Provider; readonly kind: 'fresh' | 'resume' },
    launch: (startPhases: StartPhaseSink) => Promise<SessionHandle>,
  ): Promise<SessionHandle> {
    const timeoutMs = this.host.launchTimeouts()[opening.provider][opening.kind]
    const timing = this.timeTheLaunch(slot.id, opening, timeoutMs)
    // These are stages of this launch, not activity elsewhere in the provider. Replayed stages
    // cannot keep a stuck launch alive; only forward stages or a growing thread answer can.
    const phases: readonly StartPhase[] = [
      'transcript-found',
      'credentials-read',
      'rules-read',
      'boot-gate-entered',
      'boot-gate-passed',
      'spawned',
      'initialize-sent',
      'initialized',
      'boot-gate-released',
      'skills-registered',
      'thread-sent',
      'thread-answered',
      'validated',
    ]
    let furthestPhase = -1
    let mostBytes = 0
    let waiting = true
    let resetClock = (): void => {}
    let stopClock = (): void => {}
    const expiry = new Promise<'expired'>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      resetClock = () => {
        clearTimeout(timer)
        timer = setTimeout(() => {
          waiting = false
          resolve('expired')
        }, timeoutMs)
        // An unobserved launch must not keep the app alive just to reach its idle limit.
        if (typeof timer.unref === 'function') timer.unref()
      }
      stopClock = () => {
        waiting = false
        clearTimeout(timer)
      }
      resetClock()
    })
    const progress: StartPhaseSink = (phase, detail) => {
      if (!waiting) return
      timing.phase(phase, detail)
      const at = phases.indexOf(phase)
      const bytes = detail?.bytes
      const grew =
        phase === 'thread-answered' &&
        at >= furthestPhase &&
        bytes !== undefined &&
        Number.isSafeInteger(bytes) &&
        bytes > mostBytes
      if (at > furthestPhase || grew) {
        furthestPhase = Math.max(furthestPhase, at)
        if (grew) mostBytes = bytes
        resetClock()
      }
    }
    const started = (async () =>
      this.host.startedAfterARefusedCopy(
        opening.provider,
        slot.profileId,
        () => launch(progress),
        () =>
          !this.host.launches().closed &&
          this.host.slots().get(slot.id) === slot &&
          !onItsWayOut(slot),
      ))()
    // Settled EITHER WAY, deliberately: this race asks only whether the launch is over. What it
    // answered with is `await started` below, which is the one place a rejection is reported from —
    // reporting it from here would swallow the adapter's own error.
    const over = started.then(
      () => 'over' as const,
      () => 'over' as const,
    )
    let expired: boolean
    try {
      expired = (await Promise.race([over, expiry])) === 'expired'
    } finally {
      stopClock()
    }
    if (expired) {
      timing.end('timed-out')
      this.giveUpOnLaunch(slot, started)
      const openingForMs = this.host.now() - slot.since
      throw new SessionUnavailable(
        'took-too-long',
        `session ${slot.id} was given up on: its provider made no launch progress for ` +
          `${timeoutMs}ms (reserved ${openingForMs}ms ago by ${ownerName(slot.ownerId)})`,
        { waitedForMs: timeoutMs, openingForMs },
      )
    }
    try {
      const handle = await started
      timing.end('ready')
      return handle
    } catch (error) {
      const terminated = this.host.rejectedConnectionTermination(error, slot.launch)
      if (terminated !== undefined) this.host.launches().finish(slot.launch, terminated)
      timing.end(slot.launch.signal.aborted ? 'cancelled' : 'failed')
      // An aborted launch rejects with whatever the ADAPTER chose to say — `codex start was
      // cancelled`, a `ResumeError` wrapping it — and that is a raw provider string one press of
      // Cancel away from a person's screen. Typed from the SIGNAL rather than from the text, which
      // is 100's rule: matching a message would make the wording of a log line load-bearing.
      if (!slot.launch.signal.aborted) throw error
      throw new SessionUnavailable(
        this.host.launches().closed ? 'shutting-down' : 'cancelled',
        `session ${slot.id} was stopped while its provider was starting: ${errorMessage(error)}`,
      )
    }
  }

  /**
   * One launch's timing: a line as it begins, and one as it ends, with each phase it reached, by
   * name and number only. Each line is made at its moment and handed to a writer that writes it
   * later, so a launch and its abort never wait for the disk. The end is made once, so a phase
   * reached after it is not in it.
   */
  private timeTheLaunch(
    session: string,
    opening: { readonly provider: Provider; readonly kind: 'fresh' | 'resume' },
    timeoutMs: number,
  ): { readonly phase: StartPhaseSink; readonly end: (outcome: StartAttemptOutcome) => void } {
    const write = this.host.recordStartAttempt()
    const of = {
      v: 1 as const,
      attempt: `att_${randomUUID()}`,
      session,
      provider: opening.provider,
      opening: opening.kind,
      timeoutMs,
    }
    const began = this.host.monotonicNow()
    const phases: Partial<Record<StartPhase, number>> = {}
    let lastPhase: StartPhase | null = null
    let responseBytes: number | null = null
    let ended = false
    const written = (line: StartAttemptLine): void => {
      if (write === undefined) return
      try {
        write(line)
      } catch (error) {
        console.warn(`runtime host could not write a launch's timing: ${errorMessage(error)}`)
      }
    }
    written({ ...of, stage: 'began', at: new Date(this.host.now()).toISOString() })
    return {
      phase: (phase, detail) => {
        phases[phase] = Math.round(this.host.monotonicNow() - began)
        lastPhase = phase
        if (detail?.bytes !== undefined) responseBytes = detail.bytes
      },
      end: (outcome) => {
        if (ended) return
        ended = true
        written({
          ...of,
          stage: 'ended',
          at: new Date(this.host.now()).toISOString(),
          outcome,
          elapsedMs: Math.round(this.host.monotonicNow() - began),
          phases: { ...phases },
          lastPhase,
          responseBytes,
        })
      },
    }
  }

  /**
   * Stop waiting for a launch, and keep owning it until it is really gone (102).
   *
   * Split out of {@link awaitLaunch} because it is the half that has nothing to do with waiting:
   * whatever made us give up, from here the rules are 070's and they do not vary.
   */
  private giveUpOnLaunch(slot: SessionSlot, started: Promise<SessionHandle>): void {
    // Reaches the process, not the promise. See {@link ProviderRuntimeContext.signal}.
    this.host.launches().cancel(slot.launch)
    this.host.launches().finish(
      slot.launch,
      started.then(
        async (handle) => {
          // It answered after we stopped listening. Nobody else holds this handle — the caller has
          // already been told the launch failed — so it is stopped here or it is never stopped.
          console.warn(
            `runtime session ${slot.id}: its provider arrived after the launch was given up on — ` +
              'stopping it rather than registering it',
          )
          // ⛔ **…and owned until the process is proven gone, not until `close()` answers** (233).
          // This is the third of the three hand-back sites; see {@link terminationOf}. The close's
          // own failure is swallowed here rather than propagated, because on this path a rejection
          // used to be the registry's release signal — and "the teardown threw" is not evidence that
          // the child died. Holding is the conservative half of the same trade `runFinalize` makes.
          const closing = (async () => handle.close())().catch((error: unknown) => {
            const home = this.host.homeLaunches().get(slot.launch)
            if (home !== undefined) home.uncertain = true
            console.warn(
              `runtime session ${slot.id} failed to close after being given up on: ${errorMessage(error)}`,
            )
          })
          await this.host.terminationOf(handle, closing, slot.launch)
        },
        (error: unknown) => this.host.rejectedConnectionTermination(error, slot.launch),
      ),
    )
  }

  /**
   * Cancel only the pending launch named by this gesture and its window owner.
   * Use the existing close path to abort and await arrival; live sessions have their
   * own close action and must not be ended by a late launch cancellation.
   */
  async cancelLaunch(launchKey: string, ownerId: string): Promise<boolean> {
    const slot = [...this.host.slots().values()].find(
      (candidate) =>
        candidate.launchKey === launchKey &&
        // A surfaceless launch has no window owner to match.
        candidate.ownerId === ownerId &&
        candidate.session === null &&
        !onItsWayOut(candidate),
    )
    if (slot === undefined) return false
    // Await confirmed termination; beyond the wait bound the slot and launch stay owned.
    // The owner was already matched above, so close uses the app's caller identity.
    await this.host.close(slot.id, THE_APP_ITSELF)
    return true
  }
}
