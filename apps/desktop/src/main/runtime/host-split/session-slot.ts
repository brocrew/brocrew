import type { MoveOffer } from '../../../shared/move-contracts'
import { type Provider } from '@brobot2/shared'
import { type Launch } from '../launch-registry'
import type { ActionAsked } from '../../../shared/question-contracts'
import type { UserInputQuestion } from '@brobot2/runtime'
import { type HostedSession } from './hosted-session'

interface SessionSlot {
  readonly id: string
  /** Fixed before the launch awaits, so provider-specific gives share only their own reservation. */
  readonly provider: Provider | null
  /**
   * The surface that asked for this session, carried on the RESERVATION rather than read from the
   * registered sink — because for the whole starting interval there is no registered sink to read
   * it from, and that interval is precisely when a window can go away.
   *
   * 🔴 **`null` means nobody owns this session** (336). It was created without a surface — or,
   * since `652`, REOPENED without one, which {@link RuntimeHost.resumeSession} reserves under the
   * same `null` for the same reason — so no window may control it, {@link closeSessionsForOwner} names no owner it belongs to, and the only
   * {@link Caller} that gets past {@link mayControl} is {@link THE_APP_ITSELF} — which is right:
   * the quit must still end it and the finalizer must still finalize it.
   *
   * ⚠️ **No longer `readonly`, and it changes at exactly two moments, both synchronous:**
   *
   *  - a surface CLAIMS it — {@link attachHeldSession} with `how: 'claim'`, in the same block that
   *    swaps the sink, so an event cannot land between gaining the owner and gaining the stream;
   *  - it goes back to nobody — {@link release}, which puts it to `null` rather than closing it.
   *
   * ⚑ **Two moments, and since `523` the second of them has TWO triggers.** The write is still one
   * line in one method; what changed is who asks for it. `closeSessionsForOwner` asks when the owner
   * is gone and the session was {@link bornWithoutASurface}, as it has since `336`;
   * {@link RuntimeHost.releaseSession} asks when the owner says so while still there, on the same
   * population, which is `519` item 3 and HO-045 §1's *doing so is REVERSIBLE*. ⛔ **This bullet read
   * *"that surface goes away"* until `523`** — a description of the only caller there was, which
   * hardened into the rule (standing rule 19).
   *
   * ⛔ **Nothing else may write it.** In particular a claim never REPLACES an owner: `mayClaim` is
   * false for every non-null value, so the transition is `null → id → null` and never `id → id`.
   */
  ownerId: string | null
  /**
   * 🔴 **Is the owner above a surface with a PERSON behind it?** (349, HO-005 Q2.)
   *
   * ⛔ **The second half of what {@link ownerId} used to be asked alone, and the whole of this
   * dispatch.** *"Who may answer for a person"* was `slot.ownerId === by.ownerId` — which reads
   * personhood off a string that never said anything about persons. Any caller able to present a
   * {@link RuntimeEventSink} could take that string for itself through
   * {@link RuntimeHost.claimSession} and inherit the answer. This field is
   * {@link RuntimeEventSink.aPersonIsBehindIt}, copied from the sink that took ownership, and
   * {@link mayAnswerAsAHuman} reads it instead of inferring it.
   *
   * ⚠️ **It moves with {@link ownerId} and only with it**, in the same three places and the same
   * synchronous blocks: {@link RuntimeHost.reserve} takes both from one `held` bag,
   * {@link RuntimeHost.attachHeldSession}'s claim writes both on adjacent lines with no `await`
   * between them, and {@link RuntimeHost.release} clears both. ⚡ **A stale `true` cannot admit
   * anybody on its own** — the predicate is a conjunction with `slot.ownerId === by.ownerId`, and a
   * released slot's `null` owner already refuses every caller — so the reset in `release` is
   * hygiene rather than the guard. The guard is that a claim always writes it.
   *
   * ⛔ **NOT `readonly`, unlike {@link commandedBy}, and the asymmetry is 340's.** Command is fixed
   * at reservation because a claim must not take it away; the watching half moves, and this is a
   * fact about whoever is watching NOW.
   *
   * ⚠️ **`false` for a session nobody owns**, which is the same value it holds for a session owned
   * by something with no person behind it. The two ARE different states, and {@link ownerId} is
   * what tells them apart — this field answers one question and is not asked to answer that one.
   */
  ownerIsAPerson: boolean
  /**
   * 🔴 **Was this conversation born without a surface — as far as THIS reservation can say?** —
   * the birth fact, and it is what decides what a departing owner's gesture means (336 §2.3).
   *
   * ⛔ **Two ways to be true, and since `661` they are one field** (`656` F2):
   *
   *  - ⚑ **no surface asked for this life** — a create with no sink (every spawn), or a reopen with
   *    none (`652`), even for a conversation a person started in a window;
   *  - ⚑ **an AGENT asked for the conversation** — the spawn token at a create, the provenance row
   *    at a resume — **whoever reopened it**. ⛔ Until `661` a window's reopen reserved an agent's
   *    child as that window's own (`false` since `523`), so after a quit — when reopening is the only
   *    way back — closing the window ENDED a conversation its parent still commands. `418` §2.3
   *    named it (*"reopening a spawned child silently moves it into the blast radius"*) and deferred
   *    it to a persisted fact; `341`'s provenance row is that fact.
   *
   * ⚠️ **What stays `false`**: a conversation a PERSON created, reopened by a window — its window's
   * departure ends it, which is `523` Q3's *"its slot was born owned"*.
   *
   * ⛔ **A window going away closes the sessions it STARTED and releases the ones it CLAIMED**, and
   * without this field those two are the same slot with the same `ownerId` and nothing to tell them
   * apart. Closing a claimed one would mean that peeking at a session nobody asked for — the whole
   * point of the door — kills it when you close the window; releasing a started one would leave a
   * provider running for a surface that no longer exists, which is 062's defect exactly.
   *
   * ⚠️ **Fixed at reservation and never written again**, so it survives every claim and release: a
   * session that was born with no surface is still one after it has been claimed twice.
   *
   * 🔴 **And since `523` it decides what the OWNER may do as well as what its departure means.**
   * {@link mayHandBack} reads it beside `ownerId`, so *"a claim can be given back"* is true of
   * exactly the population *"a departure releases rather than closes"* is true of — one field, one
   * answer, at both moments. ⛔ Two fields would be two populations that agree until they do not.
   * ⚑ **It reaches a person now**, as `ResumedSession.startedWithoutAWindow`: `519`'s item 3 asked
   * for the ORIGIN to be exposed, and this is the only certain answer to it this app holds for the
   * LIFE being handed over — `CreatedSession.hasACommander` is false after a restart by its own
   * contract, and `SessionSlot.spawnedBy` dies with the process.
   */
  readonly bornWithoutASurface: boolean
  /**
   * ⚑ **D-017 · R5 — did a DELIVERY start this life with no window?** ({@link
   * RuntimeHost.ensureRunning}, for a message, an answer, a notice or what a stop left held) — the one
   * life a person's window may take by writing, answering or reopening
   * ({@link RuntimeHost.aPersonsWindowMayTakeIt}).
   *
   * ⛔ **Not every life born with no owner.** A conversation a door deliberately holds for no window
   * (`336`'s create with no sink, a spawn, `652`'s reopen with none) is still taken
   * only by a person's own gesture ({@link RuntimeHost.claimSession}) — R5 widens the delivery's
   * start, nothing else. ⚠️ Fixed at reservation, like {@link bornWithoutASurface} above it.
   */
  readonly aDeliveryStartedItWithNoWindow: boolean
  /**
   * ⚑ **W4.175 — on a first launch from a give, the piece its starter starts it from**: the
   * giver's own piece the given one sits under ({@link Giving.parent}), or `null`. ⛔ That launch
   * composes before the give is written down (`recordTheGive`, after the brief), so this is how it
   * names its starter by that piece ({@link RuntimeHost.theStarterCalled}). ⚠️ Fixed at
   * reservation, like the one above it.
   */
  readonly startedFrom: string | null
  /**
   * 🔴 **The identity this slot is going to be, known from the moment it is taken** (347).
   *
   * ⛔ **Without it, a lookup could only see identities that had already ARRIVED**, and a launch in
   * flight was invisible to the next one. ⚑ **`428` keyed the question to the parent, and D-016
   * made it `give_work`'s lookup** — {@link GiveFacts.helperAs}: the one conversation a giver has
   * with an agent, over its reservations in flight and its rows — **and this field is half of the
   * key**; what follows is why it is a birth fact.
   *
   * ⚠️ **Why it is a birth fact and not a lookup.** {@link admitGive} is synchronous and
   * {@link RuntimeHost.createSession} reserves before its first `await`, so ONE give's
   * admit-and-reserve is already atomic. What was missing was for the reservation to leave a
   * TRACE the next admission could read — and a field written after the launch (on the registered
   * session) is written on the far side of exactly the gap that matters.
   *
   * ⛔ **`null` means "this slot cannot name its identity", never "it has none."** A resumed row
   * that was adopted out of a provider home carries no `profile_id`, and the honest answer for such
   * a slot is to stay out of the question rather than to guess a default and refuse a stranger.
   *
   * ⚠️ **Fixed at reservation and never written again**, like {@link bornWithoutASurface} and
   * {@link spawnedBy} above and below it — a session does not change identity, and a field that
   * cannot move is a rule nobody has to keep.
   */
  readonly profileId: string | null
  /**
   * 🔴 **Who may give this session work, when that is not who owns it** (340).
   *
   * ⛔ **A second axis, not a second owner.** {@link ownerId} answers three questions at once — who
   * may command, who is receiving, whose departure ends it. A caller with no surface answers YES to
   * the first and NO to the other two, and there is no value of `ownerId` that says that: putting
   * the spawner there would hand it the stream and take the session down with it. So the first
   * question moved to its own field and {@link mayCommand} is the only thing that reads it.
   *
   * ⚠️ **`readonly`, and that is what makes 340 §3's orthogonality structural rather than a rule
   * somebody has to keep.** `ownerId` moves — `null → id → null`, on a claim and on a release —
   * and this field is fixed at reservation and never written again, so *"a window claiming a
   * session must not take away the spawner's ability to command it"* is not a clause anywhere. It is
   * true because no line exists that could make it false. The same reasoning
   * {@link bornWithoutASurface} is written under, for the same kind of birth fact.
   *
   * ⛔ **Runtime-only, and `db/` is still deliberately untouched.** No owner of any kind is
   * persisted — `ownerId` appears nowhere in a migration — and this field dies with the process
   * exactly as it always has.
   *
   * 🔴 **What 373 changed is that a RESUME re-derives it instead of leaving it null**, for a
   * conversation another conversation asked for. See {@link RuntimeHost.resumeSession}: the
   * provenance triple 341 writes names the parent, {@link agentCallerId} turns that name into the
   * identity the parent's own toolset presents, and the field is written once at reservation as it
   * always was. ⚑ **340 §3's `readonly` rule is untouched** — its property is *never written again
   * after reservation*, and this is a reservation.
   *
   * ⚠️ **A commander that was NOT the parent still comes back as nobody.** `mcp:…` and
   * `webContents:…` are written down nowhere, and a window id could not be trusted across a restart
   * even if they were: `webContents:3` names whatever window is third THIS time. ⚑ So 340 §0's
   * sentence survives the change verbatim — *"a restart can never hand command of a session to an
   * agent that did not ask for it"* — because the parent is precisely the one that asked.
   */
  readonly commandedBy: string | null
  /**
   * 🔴 **The conversation that asked for this one** (341) — its session id, or null for one nobody
   * spawned.
   *
   * ⛔ **A THIRD field rather than a third meaning for one of the two above, for the reason 340
   * split `ownerId` in the first place.** `commandedBy` answers *who may drive this*, and a spawn's
   * parent is usually that caller — but not always, and never necessarily: `THE_APP_ITSELF` may ask
   * on a conversation's behalf, and the child is then commanded by nobody while still having a
   * parent. One field cannot hold both without one of the two questions being answered by accident.
   *
   * ⚠️ **That divergence is a LIVE-only answer since 373, and saying so is the price of the
   * derivation.** A row records the PARENT and nothing about who commanded the child, so a reopened
   * conversation is commanded by its parent whatever the live answer was: an app-spawn's child
   * gains a commander it did not have, and a `mcp:…` caller's child loses one it did. ⛔ **The rule
   * is uniform and is stated once** — *the commander a resume derives is the parent, always* — and
   * both directions of that are stood up in `a-parent-that-survives-a-restart.test.ts` §2.
   *
   * ⚑ **What reads it is `give_work`'s lookup and the chain**: {@link GiveFacts.helperAs} asks
   * which of one giver's children, in flight or running, is a given identity (D-016 · R2), and a
   * conversation still starting walks its chain through it ({@link RuntimeHost.ancestorsAsItWillRun}).
   * ⛔ **It is deliberately NOT what the ledger reads.** The durable answer to *"who started this"*
   * is `provider_session.parent_session_id`, written in the transaction that writes the row; this
   * field is the LIVE half, and dies with the process exactly as `commandedBy` does.
   *
   * 🔴 **A resume RE-DERIVES it from the ledger, like `commandedBy` and on the line beside it**
   * (373). ⛔ The parent may drive that conversation again the moment it is reopened, so a reopened
   * child is found by its parent's lookup as its child, as it was before the restart.
   */
  readonly spawnedBy: string | null
  /**
   * When this slot was reserved, epoch ms — so a refusal can say HOW LONG (100).
   *
   * Only `starting` exposes this timestamp. A second gesture can report how long the launch has been pending, helping the person decide whether to keep waiting.
   *
   * ⚠️ It is no longer the phase with **no way out** (102): {@link DEFAULT_LAUNCH_TIMEOUT_MS} ends
   * a launch that cannot complete, and {@link RuntimeHost.cancelLaunch} lets the user end it first.
   */
  readonly since: number
  /**
   * What the WINDOW calls this launch, or null when it did not say (102).
   *
   * ⚠️ **It exists because a create has no session id to cancel by.** The host mints the id inside
   * `createSession`, and the renderer only ever learns it from the promise that resolves when the
   * launch is over — which is precisely the promise that never resolves in the case a Cancel is for.
   * So the key travels the other way: the surface names its own gesture, and
   * {@link RuntimeHost.cancelLaunch} looks the slot up by that name and the owner together.
   *
   * ⚠️ **Never rendered.** It is a correlation token on the wire, not something a person reads —
   * 085's rule is about what reaches a screen, and nothing puts this there.
   */
  readonly launchKey: string | null
  phase: SlotPhase
  /**
   * **The provider this slot asked for, owned from before it exists** (070, from 068 finding 2).
   *
   * The slot owns the ID; the launch owns the PROCESS. 062 gave the interval a name but nothing to
   * act with: a close during it could mark the slot and wait, and that was all — there was no way to
   * TERMINATE a spawn whose handshake never answered, and Codex creates its detached child before
   * that handshake. {@link Launch.signal} is what reaches it.
   */
  readonly launch: Launch
  /** The registered session; null for the whole `starting` phase. */
  session: HostedSession | null
  /**
   * Settles when the start or resume that reserved this slot has FINISHED — registered, refused, or
   * handed back. It is what shutdown waits on to know there is no provider still on its way.
   */
  readonly arrived: Promise<void>
  /** Called by the reserver on every exit path, in a `finally`. */
  readonly settle: () => void
}

type SlotPhase = 'starting' | 'live' | 'closing'

/**
 * 🔴 **659 · is this conversation on its way out? — one question, asked in one place.**
 *
 * ⛔ **There are two doors into teardown and only one of them touches the phase.** `close()` marks
 * `slot.phase = 'closing'` before it does anything else; a provider stream that stops by itself
 * reaches `finalize()` from the pump's `finally`, which assigns `session.finalizing` and leaves the
 * phase exactly where it was. ⚠️ **So *"is `slot.phase === 'closing'`"* answers for one door**, and
 * until `659` four readers asked only that: `end_agent` and `interruptAgent` handed their rails the
 * provider's own status for a conversation already finalizing, the spawn door's `liveParent` let a
 * finalizing conversation spawn — its own comment said it excluded *"a slot mid-teardown"* — and
 * `cardFor` (`656`) had asked about the session before the phase (`650` F3), so a reservation being
 * closed read `'starting'`.
 *
 * ⚑ **`reserve` already knew** — *"Torn down through EITHER door"* — and so did `runningStateOf`,
 * `attachHeldSession`, `whyNotClaimed` and `releaseSession`, each spelling the three facts inline.
 * 🔴 **One question spelled six times drifts in the copies that were written before the second
 * door was found**, which is exactly where it drifted. `the-question-every-teardown-asks.test.ts`
 * holds every phase comparison in this file to this function.
 *
 * ## ⚠️ What it does NOT answer, stated
 *
 *  - ⛔ **`phase === 'live'`** — *is there a registered session to record into* — is a different
 *    question, and a finalizing session still is one: `runFinalize` writes `message_never_sent`
 *    into it. The readers that ask it are named in that test rather than routed here.
 *  - ⛔ **`assertAcceptsMessages` asks only the session's two facts**, and does not need the phase:
 *    `close()` sets the phase on the line before it assigns `session.closing`, so the one moment the
 *    phase is set and `closing` is not is `close()`'s own synchronous prefix, where no send can run.
 *  - ⚠️ **A session-less slot answers by its phase alone**, which is the reservation readers' whole
 *    question — `whyNotOurs`, `cancelLaunch`, `settleTeardown`, `sessionFor` and `takeBackPiece`'s
 *    launch-in-flight arm (`657`, routed here by `666`) — so they ask it here too rather than
 *    keeping a second spelling for the one case the other clauses are false in.
 */
/**
 * ⚑ **D-009 · the words of a question this app asked**, read off its asker's `question_asked` row —
 * {@link RuntimeHost.theWordsOf}.
 */
interface TheWordsOfAQuestion {
  readonly move?: MoveOffer
  /** It asked a person to do something, with these files (`request_action`). */
  readonly action?: ActionAsked
  readonly asked: string
  /** ⚑ **D-016** — the piece the question was about, as `question_asked` named it, or `null`. */
  readonly piece: string | null
  readonly parts: readonly string[]
  readonly prompt: string
  readonly questions: readonly UserInputQuestion[]
}

function onItsWayOut(slot: SessionSlot): boolean {
  if (slot.phase === 'closing') return true
  const session = slot.session
  return (
    session !== null &&
    (session.closing !== null ||
      session.finalizing !== null ||
      session.handle.isRetiring?.() === true)
  )
}

/**
 * 🔴 **724 · `714` F-4 — a reservation whose provider has not arrived, and that is not on its way
 * out** — {@link AgentCard.state}'s `'starting'`, the same two facts {@link RuntimeHost.cardFor}
 * reads for it.
 *
 * ⚠️ **Spelled off the session and not off `phase`**: registration sets the session and `'live'`
 * together, so the two spellings agree — and `the-question-every-teardown-asks.test.ts` §5 allows no
 * phase comparison outside {@link onItsWayOut} but `'live'`, read by name.
 */
function stillStarting(slot: SessionSlot): boolean {
  return slot.session === null && !onItsWayOut(slot)
}

export { onItsWayOut, type SessionSlot, stillStarting, type TheWordsOfAQuestion }
