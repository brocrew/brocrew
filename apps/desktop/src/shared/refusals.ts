/**
 * 🔴 **405 · the shared policy facts a refusal carries beyond its own name, where a SURFACE can
 * read them.**
 *
 * ## ⛔ Why this moved out of `spawn-rails.ts`
 *
 * `341` fixed the refusal payload's common base as
 * `{rail, permanence, retryable, reason, detail}` at the session-creation door; `425` later added
 * `remedy` beside those policy facts. The rail doors carry that common grammar —
 * {@link SPAWN_RAILS}, `TOOL_REFUSALS`, `MESSAGE_RAILS`, `REPLY_RAILS`, `QUESTION_RAILS`,
 * `INTERRUPT_RAILS` and the document reader's. ⚑ **Every one of them imports `RailPermanence`
 * rather than restating it**, and `message-rails.ts` says why on the import line: *"`RailPermanence`
 * is IMPORTED and not restated, which is what makes the shared closed words a fact rather than a
 * coincidence."*
 *
 * ## ⛔ `DOCUMENT_RAILS` was the exception for three dispatches, and `424` closed it
 *
 * ⚠️ **It restated a NARROWED pair inline** — `Readonly<Record<DocumentRail, 'permanent' |
 * 'while-this-holds'>>` — **because *"no document refusal waits on a person"*.** ⛔ **That premise
 * was false and HO-023 §2.1 is what made it visible**: `document-registry-unavailable` is a full
 * disk, a permission, a missing root or an occupied canonical path, and every one of those is a
 * person's to clear. `422` row 21 measured it; `424` widened the table to this type and gave the
 * rail the word it needed.
 *
 * ⚑ **The sentence above said *"every one of them"* before `412`, when it was false, and says it
 * again now that the code has been changed to make it true.** ⚠️ **What must not happen is the
 * third thing** — the claim drifting back without the code moving — which is why the census that
 * checks it derives the list from the WORDS rather than from importers of this type. See
 * `what-an-agent-is-told-about-its-work.test.ts` §3.
 *
 * ⛔ **HO-019 §4 gave that vocabulary a reader outside `main/`.** A refusal is now a row in the
 * ledger — {@link ToolRefusedEvent} — because *"a person reading a transcript should be able to see
 * that an agent tried something and was told no"*, and the renderer draws the word. ⚠️ **A second
 * spelling of these members in `src/renderer` would be exactly the second vocabulary `405` §2
 * forbids**, so the definition moved to the one place both halves of the app already import from,
 * and `spawn-rails.ts` re-exports it so no reader it already had needed to change a line.
 *
 * ⚑ **Nothing else moved.** Each door keeps its own table from its own rails to these words, and
 * its own `…PermanenceOf`. ⛔ **The tables are the policy and they stay where the rails are** —
 * `extracting a shared guard exports its policy`, and what is shared here is a vocabulary, not a
 * decision.
 */

/**
 * **How long the refusal is expected to be true for** — the fact HO-005 criterion 4 asks the payload
 * to carry, and the one a model has to reason about.
 *
 * ⚠️ **A list first, so it can be WALKED.** `353`'s idiom: a negative is worth what the enumeration
 * behind it is worth, and a renderer that claims to draw every permanence has to be measured against
 * the set rather than against cases somebody remembered to write.
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
 * ⛔ **The three permanences, as the clause a person reads** (405) — beside the vocabulary rather
 * than in one of its readers, since 466.
 *
 * ## ⚑ Why it moved out of the renderer
 *
 * ⚠️ **It was `transcript.ts`'s and it said so**: *"this is the only place in the renderer that
 * says anything about it."* ⛔ `466` gave the DIGEST a second reader — the fold names how long
 * each refusal it counted is expected to hold — and the fold is `main/`, which cannot import a
 * renderer module. ⚑ **One table and two callers, never two tables**, which is
 * {@link UNDRIVEN_SENTENCES}' own rule in `shared/tasks.ts` and the reason `406` moved that one
 * here for exactly this shape of second reader.
 *
 * ⚠️ **Not the sentence the MODEL got.** Each door owns its own `reason` — one per rail, seven
 * tables of them — and those sentences live in `main/` and are about the specific rule. This clause
 * is about the WORD, so it is derivable from the row alone and a ledger replayed by a build whose
 * tables have moved cannot make it wrong.
 *
 * ## 🔴 627 · *"while this holds"* was the KEY spelled out, not the clause (`HO-096` §2.4)
 *
 * ⛔ **The PO read his own ledger and could not read one of the three words:** *"while this holds"*
 * **is internal vocabulary a person reading the transcript has to decode.** ⚠️ It was the enum
 * member `while-this-holds` with its hyphens taken out — which is a SPELLING of the key and not a
 * clause about duration, and the only one of the three that did not say what it meant.
 *
 * ⚑ **The other two were already right BY THIS TEST**: *this call can never succeed* names an
 * outcome, *until somebody changes it* names a duration and who ends it. 🔴 The replacement names a
 * duration and what ends it, which is the same shape one member over.
 *
 * > ⚠️ **628 · and *untouched* stopped being true of one of them within the day** (`HO-095` §3.4).
 * > ⛔ `627`'s test is whether a clause is internal vocabulary a person has to decode, and
 * > `permanent` passed it — it is plain English. ⚑ **`HO-095` §3.4 is a different complaint about
 * > the same string**: the PO read it *"seconds before a call succeeded"*, because plain English
 * > about *this call* reads as a claim about the ACT. 🔴 **Two readings, one string, and the second
 * > needed one word** — see the member's own note below. ⛔ The sentence above is corrected rather
 * > than deleted, because a claim that two members were untouched is exactly the kind a later
 * > reader builds on (standing rule 19's corollary).
 *
 * ⚠️ **It has to read in TWO places and that is what rules out the shorter forms.** The transcript
 * draws it beside the rail — *`summary-too-long · only while the reason lasts · retrying may work`*
 * — and the digest draws it with no rail in sight: *"How long each is expected to hold: 1 · this
 * call can never succeed; 1 · until somebody changes it; 1 · only while the reason lasts."* ⛔ So
 * *"only while that is true"* was rejected: `that` has a referent on the first surface and none on
 * the second.
 *
 * ⚑ **The WORDS are the PO's to overrule and the SHAPE is the finding** — `627` reports both.
 */
export const PERMANENCE_SAID: Readonly<Record<RailPermanence, string>> = {
  // 🔴 **628 · it said *"this call can never succeed"* and a person read that seconds before a
  // call succeeded** (`HO-095` §3.4). ⛔ **The word that was missing is the one the vocabulary
  // itself has carried since `405`** — {@link RAIL_PERMANENCES}' own entry is *"This EXACT call can
  // never succeed. Change the call, not the world."* — ⚠️ **so the rendered clause was a LOSSY
  // copy of the definition three lines up, and it lost precisely the scoping word.**
  //
  // ⚑ **The PO's diagnosis is the vocabulary's own**: *"it was true of those ARGUMENTS, not of the
  // ACT."* ⛔ One word, and it is the whole repair: a caller that changes an argument is making a
  // DIFFERENT call, and a reader is no longer told that a succeeding call contradicted the app.
  //
  // ## ⚠️ The SECOND half of the definition is deliberately NOT here
  //
  // ⛔ **`Change the call, not the world` is a REMEDY, and this table is documented as the clause
  // about the WORD** — *"about the WORD, so it is derivable from the row alone"*. ⚑ It has two
  // readers and the second is a TALLY: `466` gave the digest a fold that counts refusals by
  // permanence, and it composes *"How long each is expected to hold: 1 · <clause>; 1 · <clause>"*.
  // 🔴 **A remedy inside a count is a sentence telling a person to change a call they are reading
  // a summary of** — `two-questions-about-one-address`, measured by putting it there and reading
  // what the digest said. ⚠️ **The remedy already has a home**: each rail's own `reason`, which is
  // per-call and says WHAT to change.
  //
  // ⚠️ **Only this member moved.** `while this holds` is `HO-096` §2.4's and `627` owns it; a
  // dispatch rewording a neighbour it was not sent for is how two seats produce two vocabularies.
  permanent: 'this exact call can never succeed',
  'until-a-person-changes-it': 'until somebody changes it',
  // 🔴 **627 · `HO-096` §2.4** — see this table's own note. ⛔ It read `'while this holds'`.
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
 * 🔴 **425 · what the caller may do instead, as a word rather than a sentence** (HO-023 §2.2).
 *
 * ## ⛔ The defect this exists to delete
 *
 * ⚠️ **The rail had already composed one and `405`'s rule threw it away.** The PO read his own
 * ledger and found *"refused: spawn_agent · profile-already-live · while this holds · retrying may
 * work"* — only the refusal's then-recorded policy facts — while the model, one layer up, had been
 * handed *"send a message to that one instead."* ⛔ **`405` §2 — record the refusal, not the request
 * — was right in general and wrong here**: what it discarded was not the request, it was **what this
 * app itself knew you could do next**.
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
 * 🔴 **`422` measured that `profile-already-live` COULD name a session the caller may not reach**,
 * whose own remedy would have answered `no-such-agent`. ⚑ **`428` closed that particular hole** —
 * the rail is keyed on the parent now, so the id it names is always a conversation this caller
 * asked for — **and the shape below is what keeps every OTHER rail honest without anybody having to
 * re-key it.** ⚠️ **A remedy that names an OBJECT is a remedy that can be a lie**, and the shape
 * below makes that impossible rather than unlikely: a
 * {@link RefusalRemedy} is a **string literal from a fixed list and carries no data at all**. There
 * is nowhere to put a session id, a path, a task or a profile — not an optional field somebody might
 * fill in, not a formatting slot, **no field**. ⛔ Every reader below renders it by lookup, never by
 * interpolation, so `405` §2 survives intact: the durable row still records the refusal and **the
 * app's own static next act**, and still never the request.
 *
 * ## ⚠️ It is NOT one code per rail, and that is the test of whether it is a remedy
 *
 * ⛔ **More rails carry one than there are words**, because a remedy is *what you may do* and two
 * rails can leave a caller with the same thing to do. ⚑ **A vocabulary with one member per rail would
 * be a second spelling of the rail** — a rail alias wearing a remedy's name — and it would answer
 * *what was refused*, which the row already says, instead of *what is left*.
 *
 * ⚠️ **This paragraph named the two counts until `429` moved both of them** (`396`'s rule: a sentence
 * that counts itself goes quietly wrong the next time the list moves). ⛔ The numbers are asserted in
 * `a-refusal-carries-its-remedy.test.ts` §1, by name and in both directions, which is the only place
 * they can be checked.
 *
 * ⚠️ **The folds are the proof, and one of them was found by reviewing this dispatch's own diff.**
 * `agent-already-has-a-message-waiting` was first given *the same call, once this settles* — and the
 * host's own note says why that is a lie: *"every held WORK message already has an open task of its
 * own"*, so the identical call after the mailbox drains meets `agent-already-has-work-open` instead
 * of succeeding. ⛔ **It shares that rail's word instead**, which is the truthful act on both.
 * 🔴 **`703` found the other half** (`698` F-B): `withdraw_task` reaches only work the caller gave
 * to a conversation it commands. Everything else held — a person's words, a reply, the caller's own
 * question, another caller's work — has a word of its own, `a-message-you-cannot-withdraw-is-waiting`,
 * whose act is the same call once something has SETTLED, and its sentence names what: the held
 * message, or — for a WORK call into open work the next rail would meet, as another caller's held
 * work is — that work finishing (`703`'s review). ⛔ **D-010 retired both mailbox words**: a
 * conversation now holds as many messages as are sent — and since D-027 they go together, as one
 * turn, oldest first, a person's command alone — so neither is said any more. ⚑ **And D-016
 * retired `agent-already-has-work-open`**: a busy conversation takes a piece of work, and
 * one holding a piece of the giver's that stalled does too, its answer naming that piece.
 *
 * ⚠️ **Twelve rails were written `null` while they still said `while-this-holds`**, because `422`
 * §5.1 measured their existing clauses to be false (the three spawn rails), destructive
 * (`end_agent`), person-only (`a-person-is-being-asked`), corrections for a DIFFERENT call rather
 * than remedies for this one (the four opaque-handle folds), or absent because the rail needed
 * splitting first. ⛔ **Inventing words for those would have preserved the defect in a new field.**
 *
 * ## 🔴 And then `424` repriced exactly those twelve, so the count became a BICONDITIONAL
 *
 * ⚑ **`424` asked *could the identical call ever succeed on its own?* and `425` asked *is there an
 * act the caller may perform?*, and the two questions partitioned the whole roster the same way.**
 * ⛔ **The shipped property is therefore stronger than either dispatch was briefed to deliver:**
 *
 * > ⚑ **A rail carries an act if and only if this app can retry it** — and every other rail promises
 * > nothing, because nothing is promised.
 *
 * ⚠️ **`a-refusal-carries-its-remedy.test.ts` §1 asserts it in both directions over the whole
 * roster**, so a rail added tomorrow that answers only one of the two questions fails there as well
 * as failing to compile here.
 *
 * 🔴 **`429` is the first dispatch to add a rail since that became true, and it is what the
 * guarantee was for.** ⛔ Four rails arrived at one door; the exhaustive `Record` refused to compile
 * until each had an answer, and the biconditional then decided three of the four before anybody
 * wrote the table — `permanent` and therefore silent. ⚑ The fourth, `that-work-is-being-sent`, is
 * `while-this-holds` and therefore had to carry one, which is the guarantee firing in the direction
 * `425` §1.1 reached by accident.
 */
export const REFUSAL_REMEDIES = [
  /**
   * ⚑ **Nothing to change: something is in flight, and the act is the same call once it has landed.**
   * ⚑ **705 · or the machine ran short of something it gets back by itself** (R39) — nothing is in
   * flight there, and nothing is the caller's to change either: the same call, once that has passed.
   *
   * ⛔ **It says what to DO and never that it will succeed**, and the wording is careful about that
   * on purpose. `that-conversation-has-not-started` is a launch that will either attach its provider
   * session **or fail and abandon the reservation** — and on that arm the retry at `message_agent`
   * and `interrupt_agent` meets `no-such-agent`, which is permanent: `abandon` deletes the
   * reservation, so the retry finds no slot at all. ⚠️ At `withdraw_task` (since `657`) the same arm
   * meets `not-a-piece-you-gave`, the ended-child fold that door already answers. ⛔ **This
   * said `that-conversation-has-already-ended` until `650`, and it was false**
   * (`a-refusal-that-clears-on-its-own.test.ts` §2). ⚠️ **Whether a retry can work is
   * `retryable`'s answer and the row already carries it**; a remedy that also promised the outcome
   * would be two fields saying one thing, and the weaker of the two would be the one that was wrong.
   *
   * ⚑ **The owner-scoped rows are `that-conversation-has-not-started` in `INTERRUPT_RAILS` and in
   * `TOOL_REFUSALS` (one word shared on purpose since `650`), and `that-work-is-being-sent`,
   * `agent-took-too-long-to-start` (since `657`), `that-conversation-is-still-stopping` (since
   * `663`), `that-conversation-could-not-be-woken-just-now` (since `705`),
   * `agent-could-not-start-just-now` (since `707`) and `the-start-it-waited-on-did-not-happen`
   * (since D-016) in `TOOL_REFUSALS`.** `429` added the
   * `that-work-is-being-sent` row, and `650` two it split out of `agent-cannot-take-a-message` —
   * one of which, `agent-started-a-turn-first`, `657` retired, because a lost race is held now.
   * ⛔ `a-message-you-cannot-withdraw-is-waiting` was one of these from `703` until D-010, which
   * stopped refusing a message because another is already waiting.
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
   * ⚠️ **It does NOT say *from the choices offered*, and the first draft of this dispatch did.**
   * `answerToForward` reaches `unanswered` for a question with **no options at all** — the free-form
   * case, which its own comment names — so a remedy naming choices would instruct an act that is
   * impossible on exactly the arm where the caller has the most freedom. ⛔ **A remedy true on two
   * arms of three is the shape `422` used to condemn the spawn rails.**
   */
  'answer-every-part-the-request-asks-for',
  /**
   * ⚑ **The resource-shape rails share one act** — unreadable, too large, empty, not UTF-8.
   *
   * ⛔ **The differences are facts about the file that was REFUSED**, which the rail and its `detail`
   * already say; what is left to do is the same in every named case, and `422` §3 bounds it: **a valid
   * artifact, never a provider-native verb or a grant.** (`422` said *workspace* artifact; `726` ·
   * R92 dropped the WHERE, and the word below keeps *workspace* only because it is a stored code.
   * 🔴 `733` · and *markdown* for the same reason: the store holds more types than Markdown, and
   * neither the model's sentence nor the person's clause says either condition.)
   * ⚠️ **And never the same path** —
   * nothing here asks the app to have changed the file it just refused.
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
 * does not recognise is printed AS ITSELF, because the row always has one and the word is the honest
 * thing to show. ⛔ **A remedy is different in kind: it is a PROMISE about an act.** A build that does
 * not know the word cannot vouch that the act still exists, and an app that advertises a gesture it
 * may no longer support is the defect `421` shipped a whole dispatch to delete. 🔴 **So an
 * unrecognised remedy renders as NOTHING**, in both readers — never as the raw code, and never as
 * `undefined` in a sentence about a refusal.
 *
 * ⚑ **The boundary is the ledger, not the wire.** A `tool_refused` row written by an older build is
 * replayed by a newer one, and {@link ToolRefusedEvent} is parsed from JSON with no schema between
 * the database and the fold. ⚠️ **The PO's own database has `tool_refused` rows with no remedy field
 * at all**, and they are the ordinary case this guard answers first.
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
