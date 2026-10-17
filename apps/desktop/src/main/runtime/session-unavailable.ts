import { dirname } from 'node:path'
import type { Provider } from '@brobot2/shared'
import { A_PROVIDER_FOLDER, PROVIDER_NAME } from '../../shared/runtime-ipc'

/**
 * Why a conversation could not be opened — the DISCRIMINANT, held apart from the diagnostic.
 *
 * Use a typed refusal reason while retaining raw diagnostics on `.message`. Translate it at the UI boundary, as with `AnswerRefused`, so open/reopen errors explain the condition without exposing a session id to the person.
 *
 * The split is the point. The `message` keeps the id, the owner and the timings, because that is
 * what a log is for and what a test pins. The reason is what {@link describeUnavailable} turns into
 * a sentence — so the sentence cannot accidentally carry an id, and adding a refusal without a
 * sentence is a type error rather than a leak.
 */
export const UNAVAILABLE_REASONS = [
  /** The host holds it, live, for the surface that is asking. */
  'already-open',
  /** The host holds it, live, for a DIFFERENT surface — 062's rule, and it survives (100). */
  'already-open-elsewhere',
  /**
   * **The host holds it for a different surface, and this one asked to DRIVE it** (203, from 195 H1).
   *
   * ⛔ **Its own code, and not `already-open-elsewhere`.** That one answers *"open this"* and its
   * sentence tells you where the conversation already is, which is the useful thing to say to
   * somebody who wanted to read it. This one answers *"send into this / approve this / close this"*
   * from a surface that was never given the conversation — the gesture 062's refusal was supposed to
   * have made unreachable and never checked for. Sharing a code would have told a user their
   * permission answer failed because the conversation *"is already open in another window"*, which
   * reads as an accident of timing rather than the boundary it is.
   */
  'not-yours',
  /**
   * 🔴 **The app is running it and NOBODY holds it** (421, HO-023 §2.3).
   *
   * ⛔ **Its own code, and not `already-open-elsewhere` or `not-yours`, and this one was measured
   * as a lie rather than argued as a risk.** `418` reproduced both of them on a conversation an
   * agent had started — *"This conversation is already open in another window. Switch to that
   * window to carry on with it"* for the reopen, *"This conversation belongs to another window …
   * switch to that window"* for the close — and `ownerId === null` means there is no other window.
   * There is no window at all. A person following either sentence has nowhere to go, and 100's
   * whole subject is a refusal that leaves quitting the app as the only move.
   *
   * ⚑ **One code for two doors, and that is a decision.** `203` split `not-yours` off
   * `already-open-elsewhere` because *"open this"* and *"send into this"* needed different
   * sentences — the first tells you where the conversation is, which is useful; the second names a
   * boundary. Here the FACT is the same at both doors and so is the way out: nobody holds this
   * conversation, and {@link RuntimeHost.claimSession} is the one gesture that changes that. A
   * second code would be two spellings of one sentence, which is what the distinctness assertion in
   * `session-unavailable.test.ts` exists to catch.
   *
   * ⚠️ **It says nothing about which identity is in the conversation**, and `418` §7.6 noted that
   * the word *profile* does not appear in this file. It still does not: this is about who is
   * holding a conversation, not about which agent is in it.
   */
  'held-by-nobody',
  /**
   * 🔴 **The caller may drive this conversation, and answering is not driving** (340 §2, HO-005 Q2).
   *
   * ⛔ **Its own code, and NOT `not-yours`, and this one is the clearest case in the file.** That
   * sentence says the conversation *"belongs to another window… switch to that window"*, and both
   * halves are false here. The caller refused is one that may send to this session, interrupt it and
   * queue for it — it is not a stranger holding an id — and it may have no window at all, so there
   * is no window to switch to and there may be no window holding the conversation either. The
   * refusal would have been right and every word of the reason a lie.
   *
   * ⚑ **What it is refusing is authority, not access.** *"Permissions: always the human. Never a
   * parent agent"* — an agent answering another agent's permission prompt is the kill switch with
   * extra steps. Knowledge escalates; authority does not.
   */
  'a-person-must-answer',
  /**
   * **A DIFFERENT host in this process is running it** (198, from 191 H7 and 194 H2).
   *
   * ⛔ **Its own code, and not `already-open-elsewhere`.** That one is 062's rule about two surfaces
   * asking one host, and the host can say exactly which surface holds it. This is the case the slot
   * map cannot see at all: reservation is host-local, so two hosts over one database both read the
   * same next ordinal, both resume the same provider reference, and the one that loses the unique
   * index stops recording for the rest of that session's life while its provider keeps running.
   */
  'run-by-another-host',
  /** Reserved, but its provider has not arrived. */
  'still-opening',
  /** 102: its provider never answered, so the launch gave up and shut it down. */
  'took-too-long',
  /** 102: stopped on purpose — the Cancel beside the launcher, or a window that went away. */
  'cancelled',
  /** A teardown is running and outlived the wait 075 makes. */
  'still-closing',
  /** 070: the slot is gone but the process was never confirmed dead. */
  'not-confirmed-stopped',
  /** Admission is closed — the app is quitting. */
  'shutting-down',
  /** Closed while it was opening, so the arriving provider was handed straight back. */
  'lost-its-place',
  /**
   * 🔴 **710 · R52 — the MACHINE ran short as this conversation was starting** (`707` F-3): of
   * descriptors (`EMFILE`, `ENFILE`), a process slot (`EAGAIN`) or memory (`ENOMEM`) — read by the
   * errno's code (`transientSetupFailureOf`), wherever the launch met it: the provider home, the
   * sign-in read, or the provider's own spawn.
   *
   * ⛔ **Until `710` a person read the errno itself** — *"spawn /…/claude EMFILE"*, or
   * *"EMFILE: too many open files, open '…/claude.lock'"* — because a raw errno is not a refusal and
   * went through untranslated; before `707`, the SDK's `TypeError`. ⚑ **The errno rides along as the
   * refusal's `cause`**, so `give_work`, which shares this door, still reads its code and still
   * answers its own retryable word.
   */
  'machine-ran-short',
  /**
   * 🔴 **716 · R66 — a FOLDER this conversation needs could not be made or written**, and a person
   * has to fix it: the disk refused BroBot2 (`EACCES`/`EPERM`), is read-only (`EROFS`), is full
   * (`ENOSPC`/`EDQUOT`), or a file stands where a folder must be (`ENOTDIR`, `EEXIST` from `mkdir`) —
   * read by the errno's code (`folderAPersonMustFixOf`), wherever the launch met it: the provider
   * home, its lock, the workspace, or a file BroBot2 writes into either.
   *
   * ⛔ **Until `716` a person read the errno itself** — *"EACCES: permission denied, mkdir '…'"* —
   * and the tool that started a conversation answered it as a broken tool. ⚑ **The errno rides
   * along as the refusal's `cause`**, as `machine-ran-short`'s does, so `give_work` and the wake
   * still read its code, and
   * answer their own permanent words.
   */
  'its-folder-could-not-be-made',
  /**
   * 🔴 **724 · `717` F-2 — the folder this conversation ran in is no longer there**, so a reopen's
   * provider could not be started in it: the spawn's own `ENOENT`, with the row's folder gone
   * (`RuntimeHost.aFolderThatIsGoneAsARefusal`, asked only once the launch failed).
   *
   * ⛔ **Until `724` a person read Node's errno** — *"resume setup failed: spawn …/claude ENOENT"* —
   * which names the PROGRAM for a missing folder. ⚑ **Its own code, and not
   * `its-folder-could-not-be-made`**: that sentence says BroBot2 could not make or write a folder,
   * and nothing was made here — the folder was simply gone. Only a reopen reaches it.
   */
  'its-folder-is-gone',
  /**
   * 🔴 **D-039 · R2 — its provider ANSWERED the start with a refusal** (`StartRefused`, read by type
   * with `startRefusalOf`; `RuntimeHost.aFailedStartAsARefusal`): Codex refusing a request its
   * launch awaits — `initialize`, `thread/start` or `thread/resume` — with its reason in
   * {@link UnavailableContext.providerSaid}.
   *
   * ⛔ **Until D-039 a person read the protocol's envelope** — *"{"code":-32600,"message":"dynamic
   * tool namespace description must be at most 1024 characters"}"* on a start, *"resume failed: {…}"*
   * on a reopen (F055). ⚠️ Not a thread its provider no longer has: that one is replaced (D-017 R10).
   */
  'its-provider-refused-it',
  /**
   * 🔴 **D-039 · R2 — its provider never answered the start in a way this app will run**
   * (`StartFailed`, read by type with `startFailureOf`; `RuntimeHost.aFailedStartAsARefusal`): the
   * Codex app-server's process ended before it answered, or its answer failed a check the adapter
   * makes — the protocol it speaks, the home it adopted, the thread it named, the approval profile
   * it applied.
   *
   * ⛔ **Until D-039 a person read the diagnostic** — *"codex app-server exited (stderr tail: …)"*,
   * up to 500 bytes of the child's own output, or *"resume failed: …"* on a reopen. ⚑ One fixed
   * sentence now, and the diagnostic goes to the log: nothing in it is a person's to read, and it
   * may be what clears by itself (`180`'s database the child could not open) or what never does.
   */
  'its-provider-could-not-be-started',
  /**
   * 🔴 **D-042 · R1 — nothing names a model for it, and its provider's list names no default**: no
   * model named for the conversation, no default for its agent, nothing a person picked on that
   * provider, and the provider's own default is a row of a list it could not give, or gave with no
   * row marked (Codex's `isDefault`) or a marked row that offers efforts and nothing names one of
   * them (its own default, or an effort named alone that it offers).
   * ⚑ **Or a model is named and its EFFORT cannot be**: named without one, its row offers efforts
   * and neither it nor the provider's default row names one of them; or it is not a row of the
   * provider's own, and the list that would give it one could not be read (or names no default
   * effort).
   * ⛔ **Refused rather than run on an unnamed default** — every call names its model and effort
   * (D-042 F2). ⚑ Which provider, why, and which model are {@link UnavailableContext.listUnread}.
   */
  'nothing-names-a-model',
  /**
   * 🔴 **The surface that asked for it was released while the reopen was still waiting** (265 §1,
   * from 259 lens B finding 1).
   *
   * ⛔ **Its own code, and not `cancelled`.** That one is a gesture a person made — the Cancel beside
   * the launcher — and its sentence says so. This is the document underneath the gesture going away:
   * a reload, a renderer crash, a destroyed window. Nobody asked for it and nobody is left to read
   * the reply, which is exactly why the refusal must exist as a state rather than as a silence: what
   * it prevents is a provider starting for a document that no longer exists.
   */
  'surface-gone',
  /**
   * **No row to reopen from** — and `504` narrowed what that means to the one thing it can prove.
   *
   * ⛔ **It used to be said about every conversation `SessionStore.find` declined**, and `find`
   * *"drops a row with no provider ref"* by its own docblock. So a conversation this app placed and
   * lost before its provider answered the handshake — `external_ref IS NULL`, a ledger full of
   * turns, a transcript the Sessions page opens — was refused with *"There is no recording of this
   * conversation to reopen"*, which is false of it in the one word that matters. ⚠️ Same for a row
   * whose ref stopped parsing (`172`), about which the store's own sentence says *"we can no longer
   * read where this conversation lives"*.
   *
   * ⚑ **This code now means what it says: `recordedOne` found nothing.** Everything else goes to
   * `cannot-be-reopened` below, carrying the row's own reason.
   */
  'not-recorded',
  /**
   * 🔴 **BroBot2 HAS this conversation and a reopen has nothing to attach to** (504, closing the
   * defect `472` F1 named under its own finding).
   *
   * ⛔ **Its own code, and NOT `not-recorded`, for the reason this file states three times
   * already** — the sentence is keyed by the code alone, so a shared code is a shared sentence, and
   * *"there is no recording of this conversation"* is a lie about a row whose every word this app
   * is holding. ⚑ `118` paid for it with `no-input-end`, `214` §1 with `restored-elsewhere`, and
   * `336` refused it in advance for `not-running` in as many words: *"the refusal would have been
   * right and the reason a lie."*
   *
   * ⚠️ **The sentence is the ROW's, carried as {@link UnavailableContext.refusal}**, because
   * `whyNotResumable` already owns one for each way this happens and `151` negotiated their
   * register word by word. One written here would be this boundary explaining a conversation
   * differently from the list that refuses to offer it — the exact promise `recordedOf` makes.
   */
  'cannot-be-reopened',
  /**
   * ⚑ **D-017 · R10 — its provider never named this conversation, so there is nothing to resume**:
   * a row with no provider id, the CLI gone before its first turn was recorded (D-015).
   *
   * ⛔ **Its own code, and NOT `cannot-be-reopened`**, because the two are decided differently: a
   * delivery to this one starts a new conversation of the same agent in its place, and a bundle, a
   * person's own conversation or a ref that stopped parsing — the rest of `cannot-be-reopened` —
   * must never be replaced. ⚠️ **The sentence is the ROW's**, as `cannot-be-reopened`'s is
   * ({@link UnavailableContext.refusal}), so a person's Reopen explains it as the list does.
   */
  'never-started',
  /**
   * 🔴 **This host is not running that conversation, so there was nothing to take over** (336).
   *
   * ⛔ **Its own code, and NOT `not-recorded`, for the reason two entries below states twice.** The
   * sentence is keyed by the code alone, and `not-recorded`'s says *"there is no recording of this
   * conversation"* — which may be flatly false here: a claim can name a session that ran, was
   * recorded in full, and has since ended. The refusal would have been right and the reason a lie.
   *
   * ⚠️ **It is a refusal only the two CLAIM-SHAPED doors can reach** — and it said *"only a CLAIM"*
   * from `336` until `523` put the second one beside it. Every other door onto a session that is not
   * running goes through resume, which reads the ledger and has better answers than this one; a
   * claim is about a live thing this host holds, and *"it holds no such thing"* is the whole of it.
   * ⚑ {@link RuntimeHost.releaseSession} is the inverse gesture on the same population and gets the
   * same answer for the same reason, which is why the sentence below names neither act.
   */
  'not-running',
  /**
   * 🔴 **The caller owns this conversation and STARTED it, so there is nobody to hand it back to**
   * (523, from `519` item 3 and HO-045 §1).
   *
   * ⛔ **Its own code, and NOT `not-yours`.** That one is 062's stranger — *"this conversation
   * belongs to another window"* — and every word of it is false here: the caller does hold this
   * conversation, and there is no other window to be sent to. The refusal would have been right and
   * the reason a lie, which is the mistake this file already records `118`, `214` and `504` making.
   *
   * ⚑ **Only the OWNER can reach it, and that is the order rather than a rule.**
   * {@link RuntimeHost.releaseSession} asks entitlement before it asks the birth fact, so a stranger
   * is refused `not-yours` and never learns how this conversation came to exist. ⚠️ And the owner of
   * a session born WITH a surface is always the surface it was born to: `mayClaim` admits only a
   * `null` owner, and a surface-born slot's owner is never cleared — `closeSessionsForOwner` closes
   * it instead of releasing it — so `null → id → null` has no first step for one of these.
   *
   * ⚠️ **`519` F2's distinction, which nobody could see**: for THIS conversation closing the window
   * stops it rather than handing it back, which is exactly what makes it the one conversation that
   * cannot be handed back.
   */
  'started-here',
  /** Adopted out of the user's own provider home, which this app only reads (046). */
  'read-only',
  /**
   * A sub-agent conversation: another agent drove it, so there is no input end to reopen (118).
   *
   * ⛔ **Its own code, and NOT `read-only`.** The sentence a user sees is keyed by the code alone —
   * the detail on the error is for the log — so reusing `read-only` would have told someone their
   * app-owned adopted child was *"found in your own provider home"*, which is false of it. The
   * refusal was right and the reason would have been a lie; the test that asserts the boundary is
   * what caught it.
   */
  'no-input-end',
  /**
   * 🔴 **Restored from a bundle: this app holds the conversation and no provider here ever ran it**
   * (214 §1).
   *
   * ⛔ **Its own code, and NOT `read-only`, for the reason written one entry above.** The sentence is
   * keyed by the code alone, and `read-only`'s says *"found in Claude's or Codex's own folder"* —
   * which is false of a file somebody sent by email. The refusal would have been right and the
   * reason a lie, which is the same mistake `118` made with `no-input-end` and the same test that
   * caught it: the boundary assertion, not the list.
   */
  'restored-elsewhere',
] as const

/**
 * Derived from the list rather than declared beside it, so a reason cannot be added to the type
 * without appearing in the list a test walks — the same rule 099's `STANDINGS` follows. The
 * exhaustive `switch` in {@link describeUnavailable} then makes a reason without a sentence a
 * compile error, and the walk makes a sentence that leaks an id a failing test.
 */
export type Unavailable = (typeof UNAVAILABLE_REASONS)[number]

/**
 * A refusal that knows which refusal it is.
 *
 * `message` is the diagnostic — ids, owners, elapsed milliseconds — and goes to the log. Nothing
 * that reads this class ever puts `message` on screen.
 */
export class SessionUnavailable extends Error {
  constructor(
    readonly unavailable: Unavailable,
    message: string,
    /**
     * The measurements the SENTENCE needs, carried as data.
     *
     * Kept apart from `message` on purpose: recovering a number by matching it out of the
     * diagnostic would make the wording of a log line load-bearing, and a reworded log would then
     * silently drop a fact from the UI.
     */
    readonly context: UnavailableContext = {},
    /**
     * ⚑ **710 · the failure this refusal was made of, where it was made of one** — a machine that ran
     * short keeps its errno here, so a caller that classifies by TYPE (`give_work`) still can. ⛔ It
     * is never read for the sentence: {@link describeUnavailable} is handed the reason and its
     * {@link UnavailableContext}, and what it needs of this errno — its CODE — is copied into
     * `context.shortage` when the refusal is made (`RuntimeHost.aShortageAsARefusal`).
     */
    options?: { readonly cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'SessionUnavailable'
  }
}

/**
 * 🔴 **`sessionFor`'s reservation refusal, as a type** (650).
 *
 * ⛔ **It is NOT a {@link SessionUnavailable}, and `session-unavailable.test.ts` exempts it by
 * name.** A reservation is not a session that went wrong: it is a launch in flight, and it ends
 * without anybody acting — the provider registers and the same call is admitted, or the launch
 * fails and the reservation is abandoned. ⚑ Until `650` it was a plain `Error`, so an agent's
 * `message_agent` could only fold it into `agent-cannot-take-a-message` and tell the caller *"a
 * person has to put that conversation right"* about a conversation that was seconds from ready.
 *
 * ⚠️ **{@link closing} is the one fact the refusal needs that the message does not carry.** A
 * reservation a person CLOSED before its provider arrived has `session === null` too, and it is
 * not starting: whatever arrives is handed back (`RuntimeHost.whyNotOurs`). ⛔ Read at the throw,
 * from the slot the refusal was decided on, so nothing downstream re-reads a state that has moved.
 *
 * ## ⛔ Why the message and the name are the bytes they were
 *
 * The text stays `session is still starting: <id>`, because three readers match it:
 * `renderer/src/lib/send-refusals.ts`' `hostSays`, `window-authority.test.ts`, and the exemption
 * in `session-unavailable.test.ts`. ⚑ **And there is no `name`**: a window's send can reach this
 * throw across IPC, Electron serialises `${name}: ${message}`, and `readableError` strips only a
 * `\w*Error:` prefix — so a named class would put its name on a person's screen.
 */
export class SessionStillStarting extends Error {
  constructor(
    message: string,
    /** The reservation is being closed, so it will never start. See the class note. */
    readonly closing: boolean,
  ) {
    super(message)
  }
}

/**
 * 🔴 **692 · a start an agent's MESSAGE asked for, that did not happen** — ⚑ **D-017 · R1**: see
 * `RuntimeHost.deliverWhenItRuns`, which starts any conversation this app is not running.
 *
 * ⚑ **Its own type, so `message_agent` classifies the START and nothing else.** The wake's words
 * (`aWakeThatDidNotHappen`) answer a failed reopen; asked of every error `queueMessage` throws they
 * would re-word refusals that have nothing to do with a start. ⚑ `cause` is what the reopen threw:
 * its true reason.
 *
 * ⚠️ **Here and not in `runtime-host.ts`** for {@link SessionStillStarting}'s reason one class up:
 * `agent-tools.ts` tests it with `instanceof`, and a value import from the host would close the
 * import cycle the host already opens the other way. ⛔ **And no `name`**, for that class's reason
 * too — though only an agent's message is wrapped in it, so no window's IPC carries this one.
 */
export class AStartThatDidNotHappen extends Error {
  constructor(override readonly cause: unknown) {
    super(
      `a conversation this app was not running was not started: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
}

/**
 * 🔴 **D-016 · a give's brief that did not reach the conversation it went to** — see
 * `RuntimeHost.giveWork`. ⚑ `cause` is what the delivery threw, and `to` the conversation the give
 * sent it to.
 *
 * ⚑ **Its own type, so `give_work` tells a failed DELIVERY from a failed START**: the launch of a
 * conversation a give starts is classified as a launch (`aLaunchThatDidNotStart`), and the delivery
 * of the brief exactly as `message_agent` classifies a delivery — its `cause`. ⚠️ Here for
 * {@link AStartThatDidNotHappen}'s reason: `agent-tools.ts` tests it with `instanceof`.
 */
export class ABriefThatDidNotArrive extends Error {
  constructor(
    readonly to: string,
    override readonly cause: unknown,
  ) {
    super(
      `a piece of work was not delivered to ${to}: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
}

/**
 * ⚑ **A give that took its label and gave nothing** — its start or its brief failed, and no piece
 * was written under the label. ⚑ `cause` is what failed, answered as it would be alone; `label` is
 * the number the give took, which is not handed out again (`work_sequence`), so `give_work` says it
 * is not used.
 */
export class AGiveThatGaveNothing extends Error {
  constructor(
    readonly label: string,
    override readonly cause: unknown,
  ) {
    super(`${label} was not given: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

/** What {@link describeUnavailable} may state beyond the reason itself. */
export interface UnavailableContext {
  /** How long a reservation has been waiting for its provider, ms. */
  openingForMs?: number
  /** The bound a launch was given before it was given up on, ms (102). */
  waitedForMs?: number
  /**
   * 🔴 **The ROW's own reason a reopen will not work** (504) — `SessionStore.reopenRefusalOf`,
   * verbatim, for `cannot-be-reopened`.
   *
   * ⛔ **A sentence and not a measurement, which is a first for this interface and is the point.**
   * The two numbers above are facts this boundary measured; this is a fact the STORE measured, and
   * carrying it is what stops the refusal being one more spelling of a sentence `whyNotResumable`
   * already writes. ⚠️ It is person-facing by construction — `151` rewrote every one of those out
   * of jargon, and two surfaces already draw them bare — so it honours this function's *no id, no
   * owner, no internal state name* rule.
   */
  refusal?: string
  /**
   * 🔴 **710 · R52 — WHAT ran short, for `machine-ran-short`** — the errno's code
   * (`transientSetupFailureOf`). ⚑ It decides what a person can do: `EMFILE` is BroBot2's OWN
   * descriptor table, which closing another app does not touch; `ENFILE`, `EAGAIN` and `ENOMEM` are
   * the machine's, which it does (review of `710`).
   */
  shortage?: string
  /**
   * 🔴 **716 · R66 — WHICH folder, and what the disk said**, for `its-folder-could-not-be-made`: the
   * errno's code (`folderAPersonMustFixOf`) and the path Node named, when it named one — and since
   * `724` for `its-folder-is-gone`, the row's own folder, with `ENOENT` and no call. ⚑ The code
   * decides what a person can do about it; the path is WHERE, and only a person can fix it, so it is
   * said — the one path this sentence states, because without it there is nothing to act on.
   */
  folder?: { readonly code: string; readonly path: string | null; readonly syscall?: string | null }
  /**
   * ⚑ **710 · the gesture was a REOPEN** — the conversation exists and did not come back, so the way
   * forward is to reopen it, never to *start it again* (a new conversation). ⚑ Read by
   * `machine-ran-short`, and since `716` by `took-too-long` and `still-closing`; set at the reopen's
   * doors by {@link saidOfAReopen}.
   */
  reopening?: true
  /**
   * 🔴 **D-039 · R2 — what its provider said when it refused the start**, for
   * `its-provider-refused-it`: the first line of its own words, bounded and without the protocol's
   * envelope (`StartRefused.said`). ⚑ Quoted to a person, because what was refused is in it and
   * nowhere else. Absent when the provider gave no reason.
   */
  providerSaid?: string
  /**
   * 🔴 **D-042 · for `nothing-names-a-model` — the provider whose list named no default, and why it
   * could not be read** (the probe's own word or its provider's diagnostic sentence, never a
   * credential) — `null` when it was read and names none. ⚑ `model` is the model that WAS named
   * when it is its effort that could not be — `null` when no model was named at all.
   */
  listUnread?: {
    readonly provider: Provider
    readonly why: string | null
    readonly model: string | null
  }
}

/**
 * 🔴 **716 · the same refusal, said of a REOPEN** — `RuntimeHost.resumeSession`'s two doors, its
 * reservation and its launch, pass every refusal through this, so a sentence that depends on the
 * gesture ({@link UnavailableContext.reopening}) can say *reopen* rather than *start*.
 *
 * ⚑ **A new refusal with the same reason, message and cause** — the context is the only thing that
 * differs, so a caller that classifies by TYPE or reads `cause` (`give_work`, the wake) sees what
 * it saw. ⛔ Anything that is not a {@link SessionUnavailable} is returned as it came.
 */
export function saidOfAReopen(error: unknown): unknown {
  if (!(error instanceof SessionUnavailable) || error.context.reopening === true) return error
  return new SessionUnavailable(
    error.unavailable,
    error.message,
    { ...error.context, reopening: true },
    error.cause === undefined ? undefined : { cause: error.cause },
  )
}

/** Narrow a caught value to just its discriminant, or null if it is some other failure. */
export function unavailableOf(error: unknown): Unavailable | null {
  return error instanceof SessionUnavailable ? error.unavailable : null
}

/** The measurements a caught refusal carries, or none for anything else. */
export function unavailableContextOf(error: unknown): UnavailableContext {
  return error instanceof SessionUnavailable ? error.context : {}
}

/** The calls whose `EACCES`/`EPERM` is about the folder that would HOLD the new entry. */
const CREATES_AN_ENTRY: readonly string[] = [
  'copyfile',
  'link',
  'mkdir',
  'open',
  'rename',
  'symlink',
]

/**
 * 🔴 **716 · R66 — what a folder the disk refused says: what failed, why, and the fix** — one reading
 * for every door that says it: the refusal's sentence (`its-folder-could-not-be-made`) and the clause
 * the launcher's model field, a Library row's Import and the catch-up sweep put after their own lead
 * (`RuntimeHost.howAFailureReads`, review of `716`).
 *
 * ⚑ **By the CODE**: each names its own fix. ⚠️ **A refused write names the folder that HOLDS the
 * path** (review of `716`): Node names the entry the call was making — a folder that was never made,
 * a staging file, a lock — and the permission a person can change is its parent's. ⚑ `fix` is
 * `null` for a code with no fix to name.
 */
export function whatAFolderRefused(folder: UnavailableContext['folder']): {
  readonly failed: string
  readonly fix: string | null
} {
  const code = folder?.code
  const path = folder?.path ?? null
  const syscall = folder?.syscall ?? null
  const what =
    path === null
      ? 'make or write a folder it needs'
      : syscall === 'mkdir'
        ? `make the folder ${path}`
        : syscall === 'chmod'
          ? `set the permissions of ${path}`
          : `write ${path}`
  const could = `could not ${what}`
  if (code === 'EACCES' || code === 'EPERM') {
    // ⚠️ **Only a call that CREATES an entry is refused by its parent** (round two of `716`'s
    // review): a `chmod` of the provider home that exists is refused by the home itself.
    if (path === null) {
      return {
        failed: `${could}, because it may not write where it needs to`,
        fix: 'Give BroCrew permission to write there',
      }
    }
    return syscall !== null && CREATES_AN_ENTRY.includes(syscall)
      ? {
          failed: `${could}, because it may not write in ${dirname(path)}`,
          fix: 'Give BroCrew permission to write to that folder',
        }
      : {
          failed: `${could}, because it may not change it`,
          fix: 'Give BroCrew permission to change it',
        }
  }
  if (code === 'EROFS')
    return { failed: `${could}, because that disk is read-only`, fix: 'Make it writable' }
  if (code === 'ENOSPC' || code === 'EDQUOT') {
    return {
      failed: `${could}, because the disk or its quota is full`,
      fix: 'Free some space on it',
    }
  }
  if (code === 'ENOTDIR' || code === 'EEXIST') {
    return {
      failed: `${could}, because a file stands where a folder must be`,
      fix: 'Move that file',
    }
  }
  return { failed: could, fix: null }
}

/**
 * The sentence the user reads. **No session id, no owner id, no internal state name.**
 *
 * Each one says what is holding the conversation and what to do about it, because a refusal that
 * names neither leaves quitting the app as the only move — which is the report this exists for.
 *
 * ⚠️ **Two of them say "and how long"**, and they are the two where a duration is information
 * rather than noise. `still-opening` is what another gesture is told while a launch is in flight,
 * so the number is what a person decides on; `took-too-long` is the launch's own ending, and the
 * bound is the whole of what it has to report. 100 said this class had no in-app release and that
 * the wedge was a Codex handshake with no deadline — 102 gave it one (measured: a healthy handshake
 * answers in 80ms warm and 530-916ms cold) and put a Cancel beside the launcher.
 */
export function describeUnavailable(reason: Unavailable, context: UnavailableContext = {}): string {
  /** Whole seconds, because a person choosing whether to wait is not choosing in milliseconds. */
  const seconds = (ms: number): string => `${Math.round(ms / 1000)}s`
  /**
   * ⚑ **716 · the gesture that brings back a conversation that EXISTS** — ⚑ D-017b: a message sent
   * from its view, which continues it whether or not anything runs it. ⛔ Never *start it again*:
   * that is a new conversation.
   */
  const reopenIt = 'send it your message again'
  switch (reason) {
    case 'already-open':
      return 'This conversation is already open.'
    case 'already-open-elsewhere':
      return 'This conversation is already open in another window. Switch to that window to carry on with it.'
    case 'not-yours':
      // Says what happened and where the gesture belongs, and claims nothing about why this window
      // has the id — it may have read the conversation in the library a moment ago, which is
      // allowed and is not what was refused.
      return 'This conversation belongs to another window, so nothing was sent to it. Switch to that window to answer it or send to it.'
    case 'held-by-nobody':
      // ⛔ **Names the state and the gesture, and no window** (421). The two sentences it was split
      // out of both sent a person to a window that does not exist; this one sends them to the door
      // that opens — and the rail now offers that door on the row itself, so the words here and the
      // words on the row are the same gesture said twice.
      // ⚑ **D-017 · F024** — it said *"BroBot2 is running this conversation and nobody is watching
      // it"*, a process fact (`05` rule 5) — and false of a person looking at its pane in a window
      // that does not hold it.
      // ⚑ **D-017b** — a press on its row takes it over for this window, and that is the gesture
      // named: *open it here* was false of a person already looking at it in a window that does not
      // hold it.
      return 'No window holds this conversation, so nothing was done to it. Take it over by pressing its row, then send to it or answer it.'
    case 'a-person-must-answer':
      // ⚠️ **Written for two readers and it has to be true for both.** One is an agent that was
      // given this conversation to drive and has just been told it may not decide what the work is
      // allowed to do; the other is whoever reads that refusal afterwards. So it says which
      // gesture is a person's and what a person does — and it names no window, because the
      // conversation may be nobody's until somebody takes it over.
      return 'Answering this is a person’s decision. An agent can give this conversation work, but not decide what that work is allowed to do. Open the conversation in a window and answer it there.'
    case 'run-by-another-host':
      // Says the same thing as the line above in the one respect a person can act on — something
      // else in this app is running it — without claiming to know which window, because the refusal
      // genuinely does not.
      //
      // 🔴 **716 · `710` F-5 — what a person can do, never *"try again in a moment"*** (standing rule
      // 8.4): nothing here lets the other part go, so a person told to wait would press at a row
      // that cannot change. ⚑ What frees it is that part closing it; then a reopen here works.
      // ⚠️ Unreachable in the app as built — one host runs every conversation (`main/index.ts`) —
      // so the sentence claims nothing about which part, or when.
      return 'This conversation is already being run by another part of BroCrew, and only one part can drive it at a time, so it was not opened here. It can continue here once that part has let it go.'
    case 'still-opening': {
      // 🔴 **716 · `710` F-5 — what the app does by itself, instead of *"try again in a moment"***
      // (rule 8.4). ⚑ A start in flight ENDS on its own: it registers, or it is given up at the launch
      // bound (`RuntimeHost.awaitLaunch`) — so a person has nothing to do, and pressing again only
      // meets this again. ⚠️ It does not promise the person refused here is TOLD when it ends: the one
      // told is whoever started it (round two of `716`'s review). ⚠️ Reached only while the start is still in flight: a
      // reservation somebody CLOSED is `still-closing`, at both doors (`716` moved the claim door's
      // order to match {@link RuntimeHost.reserve}'s).
      //
      // ⛔ **Two things it does NOT say, both found by `716`'s review.** No bound: the elapsed time
      // counts from the reservation and the launch bound from `awaitLaunch`, after the cwd and the
      // home, so *"opening for 20s"* beside *"within 15s"* would read as a contradiction. And no
      // *"it can be reopened"*: a START in flight leaves no row behind to reopen.
      const forMs = context.openingForMs
      const waited = forMs === undefined ? '' : ` It has been opening for ${seconds(forMs)}.`
      return `This conversation is still opening — it is waiting for its agent to answer.${waited} It opens by itself when its agent answers; if its agent does not answer in time, BroCrew stops it.`
    }
    case 'took-too-long': {
      // ⚠️ **What it waited for AND how long** (102 acceptance 3). "It did not open" would be the
      // same non-answer 100 was reported for: the only fact a person has to decide on is that the
      // agent itself never spoke, and for how long we let it not speak.
      //
      // 🔴 **716 · `710` F-5 — and what a person can do, which a bare *"Try again."* did not say**
      // (rule 8.4). ⚑ The gesture differs by door, as `machine-ran-short`'s does: a start left
      // nothing behind (the row is written at registration), so it is started again; a reopen left
      // the conversation where it was, so it is reopened. ⚑ And what it means if it keeps
      // happening, which is the one fact a second failure adds: the provider is not answering.
      const boundMs = context.waitedForMs
      const forHowLong = boundMs === undefined ? 'in time' : `within ${seconds(boundMs)}`
      const stopped = `This conversation's agent did not answer ${forHowLong}, so BroCrew stopped waiting and shut it down.`
      const keeps = 'If it keeps not answering, its provider is not responding on this machine.'
      return context.reopening === true
        ? `${stopped} The conversation is kept: ${reopenIt}. ${keeps}`
        : `${stopped} No conversation was made: start it again. ${keeps}`
    }
    case 'cancelled':
      // The one refusal a person ASKED for. It says what happened and gets out of the way — no
      // apology, and nothing implying something went wrong, because nothing did.
      return 'This conversation was stopped before it opened. Start it again whenever you are ready.'
    case 'still-closing':
      // 🔴 **716 · `710` F-5 — what is happening and the gesture that works** (rule 8.4), never
      // *"try again in a moment"*. ⚑ PM ruling R62: *"the reopen is the gesture that works (the host
      // waits up to 10 s for the close, then reopens)"* — so a claim or a hand-back refused here is
      // pointed at the reopen, and a REOPEN refused here is one that already waited that long and
      // found the teardown still running (`RuntimeHost.settleTeardown`): pressing it again waits
      // again. ⚠️ Its finalizer's archive has no bound of its own, so neither says when.
      //
      // ⛔ **The claim's and the hand-back's sentence promises no reopen** (review of `716`): a start a
      // person closed before its provider arrived is on its way out too, and left no row to reopen.
      // ⚑ **D-017b · no process fact** (`05` rule 5), and no change the person never made: what is
      // settling is BroBot2 putting away the conversation's last session — a stop, from a window
      // closing or a provider failing — and a message waits for it.
      return context.reopening === true
        ? `BroCrew was still putting away this conversation's last session and waited as long as it will, so your message did not go in. To wait longer, ${reopenIt}.`
        : "BroCrew is still putting away this conversation's last session, so nothing was done to it. A message sent to it waits until that is done."
    case 'not-confirmed-stopped':
      // Deliberately says WHY the refusal is the safe answer: 070 exists because reopening into
      // this gap is what put two providers on one transcript, and a user told only "no" would
      // reasonably keep pressing.
      return 'This conversation cannot continue yet: BroCrew has not finished putting away its last session. Continuing now could put two agents on one transcript.'
    case 'shutting-down':
      return 'BroCrew is shutting down, so this conversation was not opened.'
    case 'lost-its-place':
      return 'This conversation was closed while it was opening, so it did not open.'
    case 'machine-ran-short': {
      // 🔴 **710 · R52 — what happened, and what a person can do about it** (`707` F-3). ⛔ **Never
      // *"try again in a moment"*** (standing rule 8.4): a machine that stays short keeps refusing,
      // and a person told to wait would wait at a row they cannot clear. ⚑ What frees what ran short
      // is something closing, and WHICH depends on what ran short: `EMFILE` is BroBot2's own table of
      // open files, so only BroBot2 gives one back — another app holds none of it (review of `710`),
      // and ⚑ since D-017b nothing in the window closes one conversation, so the gesture that exists
      // is a quit and a reopen; a process slot, the machine's files or its memory are shared, so
      // another app closing frees them too. ⚑ Without a code — the reason alone — it names both.
      const didNot = context.reopening === true ? 'did not continue' : 'did not open'
      const then = context.reopening === true ? `then ${reopenIt}` : 'then start it again'
      return context.shortage === 'EMFILE'
        ? `This conversation ${didNot}: BroCrew had too many files open to start its agent. Quit and reopen BroCrew, ${then}.`
        : `This conversation ${didNot}: this machine ran short of open files, processes or memory as its agent was starting. Close an app you are not using, or quit and reopen BroCrew, ${then}.`
    }
    case 'its-folder-could-not-be-made': {
      // 🔴 **716 · R66 — what failed, why, and what a person can do**, and never *"try again"*: the
      // disk will say the same thing until a person changes it. ⚑ By the CODE, as `machine-ran-short`
      // is: each names its own fix. ⚠️ Without a code — the reason alone — it says only what failed.
      const didNot = context.reopening === true ? 'did not continue' : 'did not open'
      const then = context.reopening === true ? `then ${reopenIt}` : 'then start it again'
      const { failed, fix } = whatAFolderRefused(context.folder)
      const lead = `This conversation ${didNot}: BroCrew ${failed}`
      return fix === null
        ? `${lead}. A person has to fix that folder before it can open.`
        : `${lead}. ${fix}, ${then}.`
    }
    case 'its-folder-is-gone': {
      // 🔴 **724 · `717` F-2 — that the folder is gone, WHICH one, and what a person can do** (R66's
      // shape), never Node's errno and never *"try again"*: the folder is not coming back by itself.
      const path = context.folder?.path ?? null
      const where = path === null ? 'the folder it ran in' : `the folder it ran in, ${path},`
      return `This conversation did not continue: ${where} is no longer there. Put that folder back, then ${reopenIt}.`
    }
    case 'its-provider-refused-it': {
      // 🔴 **D-039 · R2 — what failed, in its provider's own words, what was not done, and what will
      // not help** — never the protocol's envelope, and never *"try again"*: the provider refuses the
      // same start the same way until what it refused is changed. ⚑ The gesture differs by door, as
      // `took-too-long`'s does: a start left nothing behind, a reopen left the conversation kept.
      // ⛔ **A reopen names no message**: the grant sheet's close-and-reopen reopens with none.
      const said = context.providerSaid
      const saying = said === undefined ? ' and gave no reason' : `, saying “${said}”`
      return context.reopening === true
        ? `This conversation did not continue: its provider refused to start it again${saying}. The conversation is kept, and its provider will refuse it the same way until what it refused is changed.`
        : `This conversation did not open: its provider refused to start it${saying}. No conversation was made, and starting it again will be refused the same way until what its provider refused is changed.`
    }
    case 'nothing-names-a-model': {
      // 🔴 **D-042 · F2 — what failed, what was not done, and what to do**: name a model, or start it
      // again once its provider answers. ⛔ Never run on an unnamed default. ⚑ Two causes, each said
      // as it is: the list could not be read, or it was read and names no default — a model and
      // effort, or the effort of the model named.
      const on =
        context.listUnread === undefined
          ? 'its provider'
          : PROVIDER_NAME[context.listUnread.provider]
      const why = context.listUnread?.why ?? null
      const model = context.listUnread?.model ?? null
      // ⚑ Which half could not be named: the model, or — a model named alone — its effort.
      const half = model === null ? 'model' : 'effort'
      const cause =
        model === null
          ? why === null
            ? `${on} names no default model and effort, and nothing names a model for it`
            : `${on} could not be asked which models it offers (${why}), and nothing names a model for it`
          : why === null
            ? `${on} names no default effort to run “${model}” at, and nothing names one for it`
            : `${on} could not be asked which models it offers (${why}), and nothing names the effort “${model}” runs at`
      return context.reopening === true
        ? `This conversation did not continue: ${cause}. The conversation is kept: choose its ${half} in its settings, or ${reopenIt} once ${on} answers.`
        : `This conversation did not open: ${cause}, so no conversation was made. Name ${model === null ? 'a model' : 'its effort'}, or start it again once ${on} answers.`
    }
    case 'its-provider-could-not-be-started':
      // 🔴 **D-039 · R2 — what failed, what was not done, and what to do** — in one sentence per door
      // that is true whichever way it failed: a start again may work (`180`'s database clears in
      // milliseconds), and one that fails the same way needs a person, who finds why in the log.
      // ⛔ **A reopen names no message**, `its-provider-refused-it`'s reason.
      return context.reopening === true
        ? 'This conversation did not continue: its provider could not be started again. The conversation is kept; if its provider fails the same way next time, a person has to look — BroCrew records why in its log.'
        : 'This conversation did not open: its provider could not be started, so no conversation was made. Start it again; if its provider fails the same way, a person has to look — BroCrew records why in its log.'

    case 'surface-gone':
      // ⚠️ **Written for a reader who will usually not exist**, and it says nothing went wrong,
      // because nothing did: the window that asked was reloaded or went away, so BroBot declined to
      // start an agent nothing would have been holding. A window that IS there reads it after a
      // reload it triggered itself, and "open it again" is the whole of what it needs.
      return 'The window that asked for this conversation went away before it opened, so no agent was started. Open it again.'
    case 'not-recorded':
      // ⛔ **504 · true now, because it is only reached when `recordedOne` found nothing.** The
      // population it used to cover as well — a row this app holds that resume has no address for —
      // is `cannot-be-reopened` below, and it says the row's own reason instead.
      return 'There is no record of this conversation here.'
    case 'cannot-be-reopened':
    case 'never-started': {
      // ⚑ **The store's sentence, whole, after a lead that supplies the subject it was written to
      // follow.** ⚠️ Six of them exist and they are a MIX — *"no turn was ever taken in this one…"*
      // is a clause, *"one of your own Claude conversations, found in…"* is a noun phrase — so the
      // lead ends in a colon, which both read after.
      const said = context.refusal
      return said === undefined
        ? // ⛔ **Claims nothing the absence cannot support.** It does not say the conversation can
          // be read: `hasTranscript` is a separate fact and a row with no ledger reaches here too.
          'BroCrew could not continue this conversation. It is recorded here, but there is nothing to carry on from.'
        : `BroCrew could not continue this conversation: ${said}.`
    }
    case 'not-running':
      // ⚠️ Says which of the two things it is NOT claiming: it does not say the conversation never
      // existed, and it does not say it cannot be reopened — only that nothing is running it now,
      // which is the one fact both gestures were refused on.
      //
      // ⛔ **It said *"so there was nothing to take over"* until `523`, and the clause was the half
      // that named an act.** The same code now answers the hand-back as well, and a person who
      // pressed *Hand it back* being told there was nothing to take over is this file's own
      // recurring defect — a shared code is a shared sentence. ⚑ The fact is verb-neutral, so the
      // sentence is too.
      // ⚑ **D-017b · no process fact** (`05` rule 5): the act found nothing to act on, and a message
      // is what carries the conversation on.
      return 'There was nothing in this conversation to act on just now. Send it a message to carry on with it.'
    case 'started-here':
      // ⚑ **Names what it IS rather than what it is not** — `519` F2: a conversation this window
      // started has no one before this window to be given back to.
      //
      // ⚑ **D-017 — *stops*, never *ends*** (`05` rule 2: nothing ends a conversation). ⛔ It said
      // *"End it … and closing the window ends it too"*; ⚑ D-017b · the End press is gone, so the
      // sentence names no act, and a message carries the conversation on whatever stopped it.
      return 'You started this conversation, so there is nobody to hand it back to.'
    case 'read-only':
      // 169 §2 · this function is handed a reason and nothing else, so it cannot say WHICH of the
      // two it was — naming both is the honest form of 151's register, and beats a word only a
      // maintainer knows. The row-level sentences (`whyNotResumable`) do know, and say so.
      return `This conversation was found in ${A_PROVIDER_FOLDER}, which this app only reads. It can be read and exported, but not continued here.`
    case 'no-input-end':
      return 'This is a sub-agent conversation: another agent drove it, so it takes no message of its own. It can be read and exported.'
    case 'restored-elsewhere':
      // ⚠️ Says what BroBot has as well as what it cannot do: the whole point of a restored bundle
      // is that the conversation is here to read, and a refusal that only refused would read as
      // loss (`151`'s register, and `086`).
      return 'This conversation was restored from a bundle. BroCrew holds it and can show it, but no provider on this machine ever ran it, so there is nothing to carry on from.'
  }
}
