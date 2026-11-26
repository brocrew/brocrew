/**
 * 🔴 **The shared policy facts a refusal carries beyond its own name, where a SURFACE can read
 * them.**
 *
 * ## ⛔ One grammar at every door
 *
 * The refusal payload's common base is `{rail, permanence, retryable, reason, detail}`, with
 * `remedy` beside those policy facts. The rail doors carry that common grammar —
 * {@link SPAWN_RAILS}, `TOOL_REFUSALS`, `REPLY_RAILS`, `QUESTION_RAILS`, `INTERRUPT_RAILS` and the
 * document reader's. ⚑ **Every one of them imports `RailPermanence` rather than restating it**,
 * which is what makes the shared closed words a fact rather than a coincidence. That includes
 * `DOCUMENT_RAILS`: `document-registry-unavailable` is a full disk, a permission, a missing root or
 * an occupied canonical path, and every one of those is a person's to clear (HO-023 §2.1).
 *
 * ⚠️ **The claim must not drift from the code**, which is why the census that checks it derives the
 * list from the WORDS rather than from importers of this type. See
 * `what-an-agent-is-told-about-its-work.test.ts` §3.
 *
 * ⛔ **HO-019 §4 gave that vocabulary a reader outside `main/`.** A refusal is a row in the ledger —
 * {@link ToolRefusedEvent} — because *"a person reading a transcript should be able to see that an
 * agent tried something and was told no"*, and the renderer draws the word. ⚠️ **A second spelling
 * of these members in `src/renderer` would be a second vocabulary**, so the definition lives in the
 * one place both halves of the app already import from, and `spawn-rails.ts` re-exports it.
 *
 * ⚑ **Each door keeps its own table** from its own rails to these words, and its own
 * `…PermanenceOf`. ⛔ **The tables are the policy and they stay where the rails are** — `extracting
 * a shared guard exports its policy`, and what is shared here is a vocabulary, not a decision.
 */

/**
 * **How long the refusal is expected to be true for** — the fact HO-005 criterion 4 asks the payload
 * to carry, and the one a model has to reason about.
 *
 * ⚠️ **A list first, so it can be WALKED.** A negative is worth what the enumeration behind it is
 * worth, and a renderer that claims to draw every permanence has to be measured against the set
 * rather than against cases somebody remembered to write.
 */
export const RAIL_PERMANENCES = [
  /** This exact call can never succeed. Change the call, not the world. */
  'permanent',
  /** Somebody has to decide something: a switch, a grant, a directory that must exist. */
  'until-a-person-changes-it',
  /** The world is simply busy right now, and will stop being. This is the only retryable kind. */
  'while-this-holds',
] as const

export type RailPermanence = (typeof RAIL_PERMANENCES)[number]

/**
 * ⛔ **Is this a member of the closed permanence vocabulary, asked of a value that has crossed a
 * boundary?**
 *
 * ⚠️ **The boundary is real and it is not the wire.** A ledger row written by an older build is
 * replayed by a newer one, and `TranscriptEvent` is parsed from JSON with no schema between the
 * database and the fold. ⚑ A renderer that switched on an unrecognised word would print `undefined`
 * into a sentence about a refusal, which is the one row where a reader most needs the app to be
 * honest about what it does not know.
 */
export function isRailPermanence(said: unknown): said is RailPermanence {
  return typeof said === 'string' && (RAIL_PERMANENCES as readonly string[]).includes(said)
}

/**
 * ⛔ **The three permanences, as the clause a person reads** — beside the vocabulary rather than in
 * one of its readers.
 *
 * ## ⚑ Why it lives in `shared/`
 *
 * ⛔ It has two readers: the transcript, and the DIGEST — the fold names how long each refusal it
 * counted is expected to hold — and the fold is `main/`, which cannot import a renderer module. ⚑
 * **One table and two callers, never two tables**, which is {@link UNDRIVEN_SENTENCES}' own rule in
 * `shared/tasks.ts`.
 *
 * ⚠️ **Not the sentence the MODEL got.** Each door owns its own `reason` — one per rail, seven
 * tables of them — and those sentences live in `main/` and are about the specific rule. This clause
 * is about the WORD, so it is derivable from the row alone and a ledger replayed by a build whose
 * tables have moved cannot make it wrong.
 *
 * ## 🔴 Each clause says what it means in plain words (`HO-096` §2.4)
 *
 * ⛔ **A clause that spells out the enum key is internal vocabulary a person has to decode** —
 * `while-this-holds` with its hyphens taken out is a SPELLING of the key, not a clause about
 * duration. ⚑ *This exact call can never succeed* names an outcome, *until somebody changes it*
 * names a duration and who ends it, and *only while the reason lasts* names a duration and what
 * ends it.
 *
 * ⚠️ **It has to read in TWO places and that is what rules out the shorter forms.** The transcript
 * draws it beside the rail — *`summary-too-long · only while the reason lasts · retrying may work`*
 * — and the digest draws it with no rail in sight: *"How long each is expected to hold: 1 · this
 * call can never succeed; 1 · until somebody changes it; 1 · only while the reason lasts."* ⛔ So
 * *"only while that is true"* was rejected: `that` has a referent on the first surface and none on
 * the second.
 *
 * ⚑ **The WORDS are the PO's to overrule and the SHAPE is the rule.**
 */
export const PERMANENCE_SAID: Readonly<Record<RailPermanence, string>> = {
  // 🔴 **The word *exact* is what keeps this true** (`HO-095` §3.4). ⛔ Without it a person reads
  // *"this call can never succeed"* as a claim about the ACT, even seconds before a call succeeds.
  // ⚑ {@link RAIL_PERMANENCES}' own entry is *"This EXACT call can never succeed"*: it is true of
  // those ARGUMENTS, not of the act, and a caller that changes an argument is making a DIFFERENT
  // call.
  //
  // ## ⚠️ The SECOND half of the definition is deliberately NOT here
  //
  // ⛔ **`Change the call, not the world` is a REMEDY, and this table is documented as the clause
  // about the WORD** — *"about the WORD, so it is derivable from the row alone"*. ⚑ It has two
  // readers and the second is a TALLY: the digest counts refusals by permanence and composes *"How
  // long each is expected to hold: 1 · <clause>; 1 · <clause>"*. 🔴 **A remedy inside a count is a
  // sentence telling a person to change a call they are reading a summary of** —
  // `two-questions-about-one-address`. ⚠️ **The remedy already has a home**: each rail's own
  // `reason`, which is per-call and says WHAT to change.
  permanent: 'this exact call can never succeed',
  'until-a-person-changes-it': 'until somebody changes it',
  // 🔴 **`HO-096` §2.4** — see this table's own note.
  'while-this-holds': 'only while the reason lasts',
}

/**
 * ⚠️ **Takes a `string`, and that is the point** — see {@link isRailPermanence}. A ledger row is
 * replayed by a build that is not the one that wrote it, and a word this build does not know is
 * printed as itself rather than as `undefined` in a sentence about a refusal.
 */
export function permanenceSaid(permanence: string): string {
  return isRailPermanence(permanence) ? PERMANENCE_SAID[permanence] : permanence
}

/**
 * 🔴 **What the caller may do instead, as a word rather than a sentence** (HO-023 §2.2).
 *
 * ## ⛔ Why it exists
 *
 * ⚠️ **The rail knows what the caller may do next, and recording only the refusal would throw that
 * away.** A person reading *"refused: spawn_agent · profile-already-live · while this holds ·
 * retrying may work"* would not see what the model, one layer up, was handed: *"send a message to
 * that one instead."* ⛔ **`405` §2 — record the refusal, not the request — still holds**: what this
 * keeps is not the request, it is **what this app itself knows you could do next**.
 *
 * ⚑ **The property, and both halves of it matter:** where the app knows what a caller may do
 * instead, **both readers are told** — the model in its tool answer and the person in the transcript
 * — and where it does not know, **neither is told anything invented**.
 *
 * ## 🔴 Why a closed vocabulary and not a sentence
 *
 * ⛔ **A free-text remedy is a sentence nobody can test** (standing rule 5), and it would be a second
 * spelling of the rail's own `reason` free to drift from it. ⚠️ **A code cannot drift**: the rail
 * modules map to it exhaustively, the renderer reads it exhaustively, and a rail added tomorrow
 * fails to compile until somebody has decided what its holder may do.
 *
 * ## ⛔ Why it cannot be a lie about entitlement, BY CONSTRUCTION
 *
 * ⚠️ **A remedy that names an OBJECT is a remedy that can be a lie** — it could name a session the
 * caller may not reach, whose own remedy would answer `no-such-agent` — and the shape below makes
 * that impossible rather than unlikely: a {@link RefusalRemedy} is a **string literal from a fixed
 * list and carries no data at all**. There is nowhere to put a session id, a path, a task or a
 * profile — not an optional field somebody might fill in, not a formatting slot, **no field**. ⛔
 * Every reader below renders it by lookup, never by interpolation, so `405` §2 survives intact: the
 * durable row records the refusal and **the app's own static next act**, and never the request.
 *
 * ## ⚠️ It is NOT one code per rail, and that is the test of whether it is a remedy
 *
 * ⛔ **More rails carry one than there are words**, because a remedy is *what you may do* and two
 * rails can leave a caller with the same thing to do. ⚑ **A vocabulary with one member per rail would
 * be a second spelling of the rail** — a rail alias wearing a remedy's name — and it would answer
 * *what was refused*, which the row already says, instead of *what is left*.
 *
 * ⚠️ **This paragraph does not name the counts**: a sentence that counts itself goes quietly wrong
 * the next time the list moves. ⛔ The numbers are asserted in
 * `a-refusal-carries-its-remedy.test.ts` §1, by name and in both directions, which is the only
 * place they can be checked.
 *
 * ⚠️ **Two rails share a word only when the truthful act is the same on both.** *The same call, once
 * this settles* is a lie for a rail whose identical call, once settled, would meet a different
 * rail.
 *
 * ## 🔴 A rail carries an act if and only if this app can retry it
 *
 * ⚑ *Could the identical call ever succeed on its own?* and *is there an act the caller may
 * perform?* partition the whole roster the same way:
 *
 * > ⚑ **A rail carries an act if and only if this app can retry it** — and every other rail promises
 * > nothing, because nothing is promised.
 *
 * ⛔ **Inventing words for a rail with no truthful act would put a false sentence in a new field.**
 * ⚠️ **`a-refusal-carries-its-remedy.test.ts` §1 asserts it in both directions over the whole
 * roster**, so a rail added tomorrow that answers only one of the two questions fails there as well
 * as failing to compile here.
 */
export const REFUSAL_REMEDIES = [
  /**
   * ⚑ **Nothing to change: something is in flight, and the act is the same call once it has
   * landed.** ⚑ **Or the machine ran short of something it gets back by itself** (R39) — nothing is
   * in flight there, and nothing is the caller's to change either: the same call, once that has
   * passed.
   *
   * ⛔ **It says what to DO and never that it will succeed**, and the wording is careful about that
   * on purpose. `that-conversation-has-not-started` is a launch that will either attach its
   * provider session **or fail and abandon the reservation** — and on that arm the retry at
   * `message_agent` and `interrupt_agent` meets `no-such-agent`, which is permanent: `abandon`
   * deletes the reservation, so the retry finds no slot at all
   * (`a-refusal-that-clears-on-its-own.test.ts` §2). ⚠️ At `withdraw_task` the same arm meets
   * `no-piece-by-that-name`, the lookup that door already answers. ⚠️ **Whether a retry can work is
   * `retryable`'s answer and the row already carries it**; a remedy that also promised the outcome
   * would be two fields saying one thing, and the weaker of the two would be the one that was
   * wrong.
   *
   * ⚑ **The owner-scoped rows are `that-conversation-has-not-started` in `INTERRUPT_RAILS` and in
   * `TOOL_REFUSALS` (one word shared on purpose), and `that-work-is-being-sent`,
   * `agent-took-too-long-to-start`, `that-conversation-is-still-stopping`,
   * `that-conversation-could-not-be-woken-just-now`, `agent-could-not-start-just-now` and
   * `the-start-it-waited-on-did-not-happen` in `TOOL_REFUSALS`.**
   */
  'make-the-same-call-when-this-settles',
  /**
   * ⚑ **The words were too long for the field; the field is not the only place words may go.**
   *
   * ⚠️ **It promises no provider verb.** Writing a file is a thing every provider we run can do,
   * and the remedy requires the ARTIFACT rather than a way of making it — `422` §3's rule, and the
   * reason this is not *"use the Write tool"*.
   */
  'shorten-the-summary-and-attach-the-long-form',
  /**
   * ⚑ **The answer was too long for one answer; the question is still open.** The same act as the
   * summary's, said of an answer: it carries no file of its own, so the long form's path goes in its
   * words.
   */
  'shorten-the-answer-or-put-the-long-form-in-a-file',
  /**
   * ⚑ **The request is still open; the answer was the thing that would not go.**
   *
   * ⛔ **The folded invalid-answer causes share one act**: a part left out, a value the request cannot
   * use (empty, or several where it takes one), and an option nobody offered. The act that clears
   * every case is to answer it
   * again, completely, in the shape it asks for.
   *
   * ⚠️ **It does NOT say *from the choices offered*.** `answerToForward` reaches `unanswered` for a
   * question with **no options at all** — the free-form case, which its own comment names — so a
   * remedy naming choices would instruct an act that is impossible on exactly the arm where the
   * caller has the most freedom. ⛔ **A remedy true on two arms of three is not a remedy.**
   */
  'answer-every-part-the-request-asks-for',
  /**
   * ⚑ **The resource-shape rails share one act** — unreadable, too large, empty, not UTF-8.
   *
   * ⛔ **The differences are facts about the file that was REFUSED**, which the rail and its
   * `detail` already say; what is left to do is the same in every named case, and `422` §3 bounds
   * it: **a valid artifact, never a provider-native verb or a grant.** (The word below keeps
   * *workspace* and *markdown* only because it is a stored code: R92 dropped the WHERE, the store
   * holds more types than Markdown, and neither the model's sentence nor the person's clause says
   * either condition.) ⚠️ **And never the same path** — nothing here asks the app to have changed
   * the file it just refused.
   */
  'offer-a-workspace-markdown-file-that-reads',
  'change-what-you-sent-and-call-again',
] as const

export type RefusalRemedy = (typeof REFUSAL_REMEDIES)[number]

/**
 * ⛔ **Is this a member of the closed remedy vocabulary, asked of a value that has crossed a
 * boundary?**
 *
 * ⚠️ **Stricter than {@link isRailPermanence}'s caller, and deliberately so.** A permanence a build
 * does not recognise is printed AS ITSELF, because the row always has one and the word is the
 * honest thing to show. ⛔ **A remedy is different in kind: it is a PROMISE about an act.** A build
 * that does not know the word cannot vouch that the act still exists, and an app that advertises a
 * gesture it may no longer support is making a false promise. 🔴 **So an unrecognised remedy renders
 * as NOTHING**, in both readers — never as the raw code, and never as `undefined` in a sentence
 * about a refusal.
 *
 * ⚑ **The boundary is the ledger, not the wire.** A `tool_refused` row written by an older build is
 * replayed by a newer one, and {@link ToolRefusedEvent} is parsed from JSON with no schema between
 * the database and the fold. ⚠️ **Older `tool_refused` rows carry no remedy field at all**, and they
 * are the ordinary case this guard answers first.
 */
export function isRefusalRemedy(said: unknown): said is RefusalRemedy {
  return typeof said === 'string' && (REFUSAL_REMEDIES as readonly string[]).includes(said)
}

/**
 * How much of a refusal's sentence its row keeps, in code points.
 *
 * ⚑ The sentences the doors compose run to a few hundred characters; one that lists models or
 * piece labels can run longer. Past this the row says how much was cut.
 */
/** Refusal constructors keep the raw reason unchanged and free of boundary whitespace. */
export function refusalReason(reason: string): string {
  if (reason === '' || reason.trim() !== reason)
    throw new Error('A refusal reason must be nonempty and have no boundary whitespace.')
  return reason
}

export const MAX_REFUSAL_TOLD = 4_000

/** A refusal's sentence as its row keeps it — see `ToolRefusedEvent.told`. */
export interface RefusalTold {
  /** The first {@link MAX_REFUSAL_TOLD} code points of the sentence the caller was handed. */
  readonly text: string
  /** Code points cut off the end. `0` normally. ⛔ A count, never an ellipsis in {@link text}. */
  readonly dropped: number
}

/**
 * A sentence as a row keeps it: cut at {@link MAX_REFUSAL_TOLD}, with the count of what was cut.
 * ⚠️ Cut by code point, so no half of a character is left at the end.
 */
export function refusalToldOf(sentence: string): RefusalTold {
  // A string this short in UTF-16 units cannot be over the bound in code points.
  if (sentence.length <= MAX_REFUSAL_TOLD) return { text: sentence, dropped: 0 }
  const points = [...sentence]
  const over = points.length - MAX_REFUSAL_TOLD
  return over <= 0
    ? { text: sentence, dropped: 0 }
    : { text: points.slice(0, MAX_REFUSAL_TOLD).join(''), dropped: over }
}

/**
 * What a stored row's `told` is read as: its shape checked and the bound met again, or `undefined`.
 *
 * ⚑ A row is read back by a build that did not write it, and from a file a person imported, with
 * no schema between the database and the fold — so nothing here trusts what it is handed.
 */
export function storedRefusalTold(stored: unknown): RefusalTold | undefined {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return undefined
  const { text, dropped } = stored as { text?: unknown; dropped?: unknown }
  if (typeof text !== 'string' || text === '') return undefined
  if (typeof dropped !== 'number' || !Number.isSafeInteger(dropped) || dropped < 0) return undefined
  const kept = refusalToldOf(text)
  const counted = kept.dropped + dropped
  // ⚑ A count no row this app writes could hold is no count at all.
  if (!Number.isSafeInteger(counted)) return undefined
  return { text: kept.text, dropped: counted }
}

/**
 * Tool refusals stay separate from spawn rails and share their payload grammar.
 * Historical ledger rows retain their original refusal strings.
 */
export const TOOL_REFUSALS = [
  'theme-invalid',
  'theme-is-built-in',
  'theme-exists',
  'theme-unknown',
  'theme-too-large',
  // Unknown conversations and conversations outside the call’s reach share this answer.
  'no-such-agent',
  // The profile names several reachable conversations; the call must name one.
  'that-agent-has-several-conversations',
  'malformed-request',
  'agent-cannot-take-a-message',
  // A reservation’s launch is still in flight, excluding a reservation already closing.
  // The same launch state uses this word at each door that can meet it.
  'that-conversation-has-not-started',
  // The message targets its sender. Retrying or changing grants cannot make that call valid.
  'that-agent-is-you',
  // An admitted launch failed for a classified reason; admission itself did not refuse it.
  // Timeout, temporary shortages and an unusable program have separate words. Unknown errors propagate.
  'agent-did-not-start',
  // An admitted provider launch timed out. Its launch is stopped and reservation abandoned
  // so another call can attempt a new launch, without a promise that it succeeds.
  'agent-took-too-long-to-start',
  // A give waited for another launch and that launch failed. A new give may start a conversation.
  'the-start-it-waited-on-did-not-happen',
  // A temporary descriptor, process-slot or memory shortage prevented a start.
  // Classification uses errno, not provider text; retry may succeed when resources return.
  'agent-could-not-start-just-now',
  // The program or folder cannot be used, or the provider refuses the start.
  // The detail names the cause; temporary shortages and timeouts use separate words.
  'agent-could-not-be-started',
  // The folded name already exists. Creation refuses rather than adopting that identity;
  // the caller needs a different name.
  'agent-name-taken',
  // The piece has a completed reply and cannot be withdrawn. New work requires a new give.
  'that-piece-was-already-answered',
  // The piece was already withdrawn; a repeated withdrawal cannot report a new success.
  'that-piece-was-already-taken-back',
  // The brief or its update is in flight. It cannot be cancelled while the send owns it;
  // retry after handover settles, so the ledger cannot say both cancelled and sent.
  'that-work-is-being-sent',
  // Ending the piece must also end passed-up question copies, but a copy’s holder is starting.
  // Nothing commits; retry after that bounded start lands or fails.
  'a-conversation-with-its-questions-is-starting',
  // The questions or passed-up copies could not all be read, so the piece is not ended alone.
  // A later read may succeed; ask a person if it keeps failing.
  'its-questions-could-not-all-be-read',
  // Only the person and the profile that created the agent write its standing rules directly.
  'may-not-write-rules',
  // A follow-up named open work the caller holds. Use a tracked question or hand the work back;
  // ended work falls back to the giver lookup’s refusal.
  'that-is-work-you-hold',
  // The call names the caller’s own root for a follow-up, brief or close. Ask the person
  // and answer in the conversation; keeping files on that root remains allowed.
  'that-is-your-own-work',
  // An admitted wake still awaits confirmation that the previous run stopped or finalized.
  // Another attempt cannot succeed while that lifetime remains held.
  'that-conversation-is-still-stopping',
  // A wake failed on a resume, provider, program or folder problem needing attention.
  // Temporary setup shortages have their own word; the detail names the observed cause.
  'that-conversation-could-not-be-resumed',
  // A wake met a temporary descriptor, process-slot or memory shortage in the error cause chain.
  // Classification uses errno, not provider text; retry may succeed when resources return.
  'that-conversation-could-not-be-woken-just-now',
  // No piece available to the call matches this name.
  'no-piece-by-that-name',
  // The giver names an agent-given piece; the holder can name work a person gave it.
  'the-giver-names-a-piece',
  // The piece ended, so status, brief, close and kept-file changes are refused. Its title may change.
  'that-piece-has-ended',
  // The caller did not give the piece it is trying to rebrief or give a new done condition.
  'the-giver-briefs-a-piece',
  // The piece already closed. Another ending has nothing to do.
  'that-piece-was-already-closed',
  // The caller has no person-given root under which to take on work.
  'no-work-of-your-own',
  'work-record-unavailable',
  // The profile name is not held by the app; this differs from a conversation id or piece label.
  'no-agent-by-that-name',
  // The requested name or address is registered. A request adds a server and never edits one.
  'server-already-registered',
  // Another request already asks for this server name; it clears when that request is decided.
  'server-already-asked-for',
  // This conversation or the app has reached its waiting-request limit; decisions release capacity.
  'too-many-server-requests',
  // The brief is still queued at a service and has reached nobody. Change it with update_work
  // without losing its queue position; a follow-up can be sent after handover.
  'that-piece-is-still-queued',
] as const

export type ToolRefusal = (typeof TOOL_REFUSALS)[number]

/** Policy facts recorded for a refusal, without the request's detail, ids or folders.
 * The row records that it was refused; keep the caller's sentence rather than deriving it again.
 */
export interface RefusalFacts {
  readonly rail: string
  readonly permanence: RailPermanence
  readonly retryable: boolean
  /** Static next act from the closed remedy vocabulary; it carries no request data. */
  readonly remedy: RefusalRemedy | null
  /** The payload's actual caller-facing sentence when present, never provider text. */
  readonly told?: RefusalTold
}
