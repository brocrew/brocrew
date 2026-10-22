import { providerValue } from '@brobot2/shared'
import { refusalReason } from '../../shared/refusals'
import {
  aPieceNotEndedItsQuestionsUnread,
  aPieceNotEndedWhileAQuestionStarts,
} from '../../shared/questions'
import {
  A_PERSON_MUST_ACT_SENTENCE,
  TASK_IS_OPEN,
  undrivenSentence,
  type PieceRow,
  type StoppedOnALogin,
  type TaskOutcome,
  type TaskStallCause,
  type TaskState,
  type WorkReport,
} from '../../shared/tasks'
import type { ResourceRefusal } from '../resources/resources'
import type { RailPermanence } from './spawn-rails'
// ⚑ **425 · from `shared/refusals.ts` and not through `spawn-rails.ts`'s re-export.** That
// re-export exists so `405` could move `RailPermanence` without touching seven readers; a word
// added today has no such history and names its own home.
import { HELD_FORMS_SAID } from '../../shared/documents'
import type { RefusalRemedy } from '../../shared/refusals'
// ⚑ **484 · one composition for the actor's clause**, shared with `list_tasks`' own line.
import {
  ASKED_TO_STOP,
  askedByClause,
  // ⚑ **729 · R90 — the reader's own ask**, in the words the ruling gives.
  YOU_ASKED_IT_TO_STOP,
  type WhoStoppedIt,
} from '../../shared/how-work-stopped'
// ⚑ **D-012 · the preview of the last exchange**, in place of the 4 KB quote.
import { exchangePreviewLines, type AConversation, type Exchange } from '../../shared/last-exchange'
// ⚑ **D-016 · the one spelling of a piece beside its title** (`shared/piece-called`).
import { pieceLine } from '../../shared/piece-called'
// ⚑ **D-025 · the one clock time every surface says *when* in** (`shared/clock`).
import { clockTime, clockTimeFrom } from '../../shared/clock'
import type { RequestState } from '../../shared/questions'
import { PROVIDER_NAME } from '../../shared/runtime-ipc'

/**
 * 🔴 **The door a reply passes, and the vocabulary it is refused in** (393, HO-007 S2; pieces since
 * D-016).
 *
 * ## ⛔ The addressing rail is not in this list, because it is not a check
 *
 * **HO-015 §1.3:** *"`reply_to_parent` quotes the task id ONLY. The runtime derives and validates
 * the destination from the durable task edge."* ⚑ **So the destination is not an argument, and the
 * lookup that finds the piece is scoped to the CALLER'S OWN LEDGER before this file is reached.**
 * There is no name a caller can spell that reaches another conversation's work: `derivePieces`
 * folds one conversation's rows and can read nothing else, so *"a piece that is not this
 * conversation's"* and *"a name that names nothing"* arrive here as the same absence and leave as the
 * same sentence.
 *
 * ⛔ **That is `refuse-on-entitlement-before-refusing-on-existence` made structural rather than
 * ordered.** A rail asked in the right order can still be reordered; a question that was never
 * asked of the whole database cannot. ⚠️ It is also why {@link ReplyRail} has no `not-your-piece`:
 * two answers would let a caller walk labels and learn which work exists, the defect
 * `no-such-agent` folds away.
 *
 * ## ⚠️ A vocabulary of its own, sharing the grammar and only deliberately shared names
 *
 * `374`'s rule survives as separate properties: **sentences are unique across every rail
 * vocabulary**, while names may be shared only by the explicit census allowlist. ⚑ **D-016 ·
 * `no-piece-by-that-name` is shared with `TOOL_REFUSALS` on purpose**: one fact — the name names no
 * piece this door acts on for you — with one permanence and no act, at `reply_to_parent`,
 * `update_work`, `list_tasks` and a note. All vocabularies share the PAYLOAD — `347`'s rule that a
 * model meets one grammar everywhere.
 */
export const REPLY_RAILS = [
  /**
   * ⛔ **This conversation holds no piece by that name that it could reply about.** Four causes reach
   * it and they are deliberately one answer:
   *
   *  - the name names nothing anywhere;
   *  - it names a piece in somebody else's ledger;
   *  - this conversation has never been given work at all — ⚑ **the ordinary answer for a
   *    conversation a person started**, which, until it takes work on, holds only its root (see the
   *    next word);
   *  - it is a string this app never minted.
   *
   * ⚑ **`permanent`** (424): a label and an id are minted by this app, never supplied by a caller, so
   * the name in THIS call names nothing here and will not start naming something. *Change the call,
   * not the world* — and the change is `list_tasks`, which the sentence names.
   */
  'no-piece-by-that-name',
  /**
   * 🔴 **D-016 · the caller named its own ROOT** — the work a person gave this conversation.
   *
   * ⛔ **A root never ends**: it is its conversation's (R1), so there is nothing to answer about it
   * but in the conversation itself — the person's words are already on its screen. ⚑ A piece it
   * took on for a person is another matter: its reply ends it (D-016 · commit 6 · R5). ⚑ Its own
   * word rather than `no-piece-by-that-name`, because the name is right and the call is the wrong
   * one. ⚠️ `permanent`: a root is its conversation's for as long as the conversation is.
   */
  'a-person-gave-that-piece',
  /**
   * 🔴 **That piece has already ended, and a piece is answered once** (393 §4.3, as a task).
   *
   * ⛔ **A refusal rather than an append, and it is PERMANENT.** ⚑ A second reply cannot be an
   * append because the first one is what a giver has already read and acted on; an outcome that
   * could change after it was read is a fact with no moment at which it is true.
   *
   * ⚠️ **It fires for `withdrawn` and `closed` too, not only for `answered`** — `detail.state` says
   * which, and those are the only states it can name. All three are ENDINGS: the owner already
   * replied, or the piece was taken back — by its giver, or by whoever cancelled its held brief —
   * or its giver closed it. ⚑ **D-025 · and when (`detail.at`), and who by name (`detail.called`)
   * where the row that ended it names somebody other than the caller.** ⛔ **It does NOT fire for
   * `stalled`**, which is open: an owner that let a turn end without replying may still reply on
   * the next one, and that is the difference between *said nothing yet* and *finished*.
   */
  'piece-already-ended',
  /**
   * ⛔ **The summary is longer than a reply may be** (HO-006 §4.4, `353` §6.2).
   *
   * ⚑ **A structural refusal, and the remedy is in the sentence**: write the body to a file of a
   * kind this app holds (`HELD_FORMS_SAID`, since `736`, `733` F-4) and hand it in as a resource.
   * HO-007 S2: *"no silent truncation or erasure anywhere on this path"* — so nothing here shortens
   * anything, and the agent decides what the header says.
   *
   * ⚠️ **`while-this-holds`**: the identical intent succeeds the moment the argument is shorter,
   * which is *"change the call, not the world"*. ⛔ `permanent` would tell a model that its reply can
   * never land.
   */
  'summary-too-long',
  'result-document-not-returned',
  /**
   * The piece could not be handed back because a conversation holding a copy passed up of a question
   * about it is starting: that copy could not end in the same transaction, so nothing was recorded.
   * `while-this-holds`: the start lands or fails within a launch's bound.
   */
  'a-conversation-with-its-questions-is-starting',
  /**
   * The piece could not be handed back because the questions about it, or the copies passed up of
   * them, could not all be read: a copy might have stayed open, so nothing was recorded.
   * `while-this-holds`: a read that failed once may pass the next time.
   */
  'its-questions-could-not-all-be-read',
] as const

export type ReplyRail = (typeof REPLY_RAILS)[number]

/**
 * ⛔ **One table, so `permanence` and `retryable` cannot disagree** — `341`'s rule at this venue.
 */
const PERMANENCE: Readonly<Record<ReplyRail, RailPermanence>> = {
  // 🔴 **`permanent` since `424`** — see the rail's own note, and HO-023 §2.1.
  'no-piece-by-that-name': 'permanent',
  'a-person-gave-that-piece': 'permanent',
  'piece-already-ended': 'permanent',
  'summary-too-long': 'while-this-holds',
  'result-document-not-returned': 'permanent',
  'a-conversation-with-its-questions-is-starting': 'while-this-holds',
  'its-questions-could-not-all-be-read': 'while-this-holds',
}

export function replyPermanenceOf(rail: ReplyRail): RailPermanence {
  return PERMANENCE[rail]
}

/**
 * **Would the identical call ever succeed on its own?**
 *
 * ⛔ **Derived, never written twice.** ⚠️ **`summary-too-long` is retryable here since `424`**, and
 * the note used to carry a population count instead. The clause that survives is the reason: a
 * reply is refused for things the CALLER can fix — and for every other row, fixing it means a
 * different call rather than a later one.
 */
export function replyRetryableOf(rail: ReplyRail): boolean {
  return replyPermanenceOf(rail) === 'while-this-holds'
}

/**
 * 🔴 **425 · what the caller may do instead — `summary-too-long` has the answer** (HO-023 §2.2).
 *
 * ⛔ **`summary-too-long` is the clean case for the whole dispatch**: the refusal is about the
 * CALLER's own words, the caller can change them, and the act needs nothing from anybody else. ⚑ The
 * remedy names the artifact and not a way of making one — `422` §3 — so it stays true on a provider
 * whose file-writing tool is called something else.
 *
 * ⚠️ **`no-piece-by-that-name` gets NOTHING, and that is the hard line in this table.** `422` §1
 * row 8 measured the fold (as a task id): a name that names nothing, one in somebody else's ledger,
 * a conversation never given work, and a string this app never minted are ONE answer.
 * ⛔ `list_tasks` can help the caller compose a DIFFERENT call, and that is not the same claim as
 * *this call will work* — **finding another name is not making this name succeed**, and a remedy
 * field that said otherwise would be `405`'s defect rebuilt in the field meant to fix it. 🔴 The
 * rail's own sentence already points at `list_tasks`, where advice belongs; a promise does not.
 *
 * ⚑ **`a-person-gave-that-piece` and `piece-already-ended` are `permanent` and need no argument.**
 */
const REMEDY: Readonly<Record<ReplyRail, RefusalRemedy | null>> = {
  'no-piece-by-that-name': null,
  'a-person-gave-that-piece': null,
  'piece-already-ended': null,
  'summary-too-long': 'shorten-the-summary-and-attach-the-long-form',
  'result-document-not-returned': null,
  'a-conversation-with-its-questions-is-starting': 'make-the-same-call-when-this-settles',
  'its-questions-could-not-all-be-read': 'make-the-same-call-when-this-settles',
}

/** ⛔ **What a caller may do instead, or `null` because this app knows of nothing** (425). */
export function replyRemedyOf(rail: ReplyRail): RefusalRemedy | null {
  return REMEDY[rail]
}

/**
 * 🔴 **How long a summary may be, in UTF-16 code units — 1,280** (`353` §6.2, HO-007 §6.2).
 *
 * ⚑ **Measured before it was chosen.** `353` ran the required shape on both providers and saw a
 * maximum of **740** units; 1,280 leaves **540 units / 73% headroom**. ⛔ HO-006 §4.4: *"the agent
 * never guesses a byte threshold; bound `summary`, refuse structurally"* — so the number lives here
 * and is named in the refusal rather than being a thing a model has to have been told.
 *
 * ⚠️ **UTF-16 code units, which is `String.prototype.length` and NOT bytes or characters.** An
 * emoji is two; a byte bound would refuse different strings on different days depending on how much
 * of the reply was ASCII. ⛔ **The bound is measured on `summary` alone**, never on the whole
 * payload: a caller must be able to compute for itself whether a string will fit, and a bound over
 * a JSON encoding it never sees is one it cannot.
 *
 * 🔴 **A test that writes `REPLY_SUMMARY_LIMIT + 1` pins nothing** — `380` learned this on
 * `MAX_DOCUMENT_BYTES` and wrote `1048576` and `1048577` as literals. The suite for this one writes
 * `1280` and `1281`.
 *
 * ⚠️ **The confidence, stated rather than implied:** `353` called it high for the required shape and
 * MEDIUM for prompt drift — a bound tuned on today's instruction that tomorrow's routinely exceeds
 * turns a structural refusal into a permanent block. It is retryable and it names itself, which is
 * what makes that recoverable rather than silent.
 */
export const REPLY_SUMMARY_LIMIT = 1_280

/**
 * The facts a reply refusal may state beyond the rail itself, carried as DATA (`341`, 100).
 *
 * ## ⛔ The fields that are deliberately NOT here
 *
 * ⚠️ **No id names the GIVER, nor anybody else.** A caller that could read its giver's session id
 * off a refusal would have been handed the addressing primitive HO-015 §1.3 refuses to accept as an
 * argument — from the other direction, which is the same fact arriving through the return value.
 *
 * ⚑ **D-025 · a display NAME is carried, and only on `piece-already-ended`** ({@link called}): who
 * ended the caller's own piece, named as this app's notice of that ending names it
 * (`RuntimeHost.tellItsOwnerItWasClosed`). ⛔ **It reaches no conversation but the caller's own.**
 * `give_work`, the one door that takes an agent's name and reaches a conversation with it, looks
 * only among the conversations the caller, or one it stands for, started (`RuntimeHost.helperAs`),
 * and the one that ended the caller's piece — its giver, or the conversation in its giver's place —
 * is not among them; every other door that reaches a conversation takes its id or a piece's label.
 * ⚠️ Nor is it the address {@link messageNamingThePiece} leaves out *in any spelling*: that rule
 * keeps a brief from naming whom its reply goes to, and this names who ended a piece no reply is
 * owed for.
 *
 * ⛔ **And nothing names another conversation's piece**, for `MessageRefusalDetail`'s reason: the
 * one gate that says *"there is no such piece"* must not be the reader that says whose it is.
 */
export interface ReplyRefusalDetail {
  /** The rejected main-document spelling, for the caller's answer only. */
  path?: string
  /** Whether the main document was absent from the list or had another resolved form. */
  resultDocumentProblem?: 'not-listed' | 'not-document'
  /** The piece this call named, as it named it — echoed back so a model can match refusal to request. */
  piece?: string
  /** The piece's label, present only where the caller holds the piece it named. */
  label?: string
  /**
   * ⛔ **The state that made it an ending — present only on `piece-already-ended`.**
   *
   * ⚑ It is a fact about the caller's OWN piece, which it may already read with `list_tasks`, so
   * volunteering it tells nobody anything they could not ask for. ⚠️ And the three values this rail
   * can carry mean different things to a model deciding what to do next: `answered` is *you already
   * did this*, `withdrawn` is *somebody took it back*, `closed` is *the one that gave it ended it*.
   */
  state?: PieceRow['state']
  /**
   * 🔴 **D-025 · when it ended** — epoch ms, {@link PieceRow.endedAt}: present only on
   * `piece-already-ended`. ⚑ The moment itself, for a model to compare; the sentence says it as a
   * clock time.
   */
  at?: number
  /**
   * 🔴 **D-025 · who ended it, by NAME** — `RuntimeHost.whatToCallTheConversation` over
   * {@link PieceRow.endedBy}: present only on `piece-already-ended`, and only when the row that
   * ended the piece names somebody other than the caller. ⚠️ Absent for `answered` — the caller's
   * own reply, and a reader is not told its own name (729 · R90) — and for a held brief cancelled,
   * whose row names nobody. ⚑ **`called` and not `by`**, {@link TheAskNamed.called}'s key for a
   * conversation's name: a `by` an agent reads holds an id (`list_tasks`' `status_line.by`) or a
   * category (`asked_to_stop_by.by`). ⛔ Never an id: see this interface's note.
   */
  called?: string
  /** How long a summary may be. Present only on `summary-too-long`. */
  limit?: number
  /** How long the one that arrived was, in the same units. Present only on `summary-too-long`. */
  was?: number
}

/** 🔴 **A refusal, as a payload rather than a throw** — `341`'s shape, carried over MCP unchanged. */
export interface ReplyRefusal {
  readonly rail: ReplyRail
  readonly permanence: RailPermanence
  readonly retryable: boolean
  readonly reason: string
  /** ⛔ **425 · the act left, as a word** — one of `REFUSAL_REMEDIES`, or `null`. See {@link replyRemedyOf}. */
  readonly remedy: RefusalRemedy | null
  readonly detail: ReplyRefusalDetail
}

/**
 * The sentence for each rail.
 *
 * ⚠️ **A refusal INSTRUCTS or STATES A FACT ABOUT THIS CALL; it does not describe how the system
 * works** (HO-015 §2, standing). ⛔ None of these says where a piece comes from, who the giver is,
 * or how a reply is routed — the class of sentence the PO named as *"one mistake made eight
 * times"*. What each says is what happened to THIS call and what would make it succeed.
 *
 * A long summary names its measured length and the shared limit, never the caller's text. The
 * file remedy is rendered from the store's held-form list.
 */
const LONG_SUMMARY_REMEDY = `Put the rest in ${HELD_FORMS_SAID} and name its path in resource_paths; the piece stays open. Nothing was shortened for you.`

const UNKEPT_FILE_KIND_NAMES: Readonly<Record<string, string>> = {
  '.zsh': 'a .zsh file',
  '.sh': 'a .sh file',
  '.ts': 'a .ts file',
  '.js': 'a .js file',
  '.json': 'a .json file',
  '.txt': 'a .txt file',
  '.zip': 'a .zip file',
  '.csv': 'a .csv file',
}

/** Reply guidance uses fixed kind names rather than copying an unknown extension into the log. */
export function replyUnkeptFileReason(path: unknown): string {
  const dot = typeof path === 'string' ? path.lastIndexOf('.') : -1
  const slash = typeof path === 'string' ? path.lastIndexOf('/') : -1
  const extension = typeof path === 'string' && dot > slash + 1 ? path.slice(dot).toLowerCase() : ''
  const kind =
    (Object.hasOwn(UNKEPT_FILE_KIND_NAMES, extension)
      ? UNKEPT_FILE_KIND_NAMES[extension]
      : undefined) ?? 'a file of an unrecognised kind'
  return `This app does not keep ${kind}. It keeps ${HELD_FORMS_SAID}. Name its full path in summary instead of resource_paths; keep the file where it is. Nothing was kept or recorded.`
}

const REPLY_SENTENCES: Readonly<Record<ReplyRail, string>> = {
  'result-document-not-returned':
    'The main result document must be a Markdown file or page listed in resource_paths. Nothing was recorded.',
  // ⚠️ **The last clause is the remedy** (424): a label is minted by this app, so the one in the
  // refused call does not become yours later, however long you wait.
  'no-piece-by-that-name':
    'you hold no open piece by that name, so nothing was recorded. list_tasks names the pieces you hold, by label, and only one it names can be replied to; sending that name again will never succeed.',
  // ⚑ **D-016** — the act inside the cut: the person is answered in the conversation itself.
  // ⚑ **Commit 6** — then the verb that DOES finish work taken on for a person.
  'a-person-gave-that-piece':
    'that is this conversation’s own work — its root, which never ends — so there is nothing to reply about and nothing was recorded: answer the person here, in your own words. Work you took on with take_on_work is finished with reply_to_parent naming its piece.',
  'piece-already-ended':
    'stop work on that piece; no further reply is owed. It has ended, so nothing was recorded or changed. The detail says how it ended; retrying this piece cannot work.',
  // ⚑ 736 · `733` F-4 — the kinds rendered from the store's own list (`HELD_FORMS_SAID`).
  'summary-too-long': `Not handed back: the summary exceeds ${REPLY_SUMMARY_LIMIT.toLocaleString('en-US')} characters. ${LONG_SUMMARY_REMEDY}`,
  // Said with the piece's label when the detail holds it ({@link aPieceNotEndedWhileAQuestionStarts}).
  'a-conversation-with-its-questions-is-starting':
    "that piece wasn't handed back: a conversation with a question about it is still starting. Try again in a moment.",
  // Said with the piece's label when the detail holds it ({@link aPieceNotEndedItsQuestionsUnread}).
  'its-questions-could-not-all-be-read':
    "that piece wasn't handed back: its questions couldn't all be read. Try again; if it fails again, ask a person.",
}

function longSummarySentence(detail: ReplyRefusalDetail): string {
  const was = detail.was
  if (was === undefined || !Number.isSafeInteger(was) || was < 0) {
    return REPLY_SENTENCES['summary-too-long']
  }
  return `Not handed back: the summary is ${was.toLocaleString('en-US')} characters; the most is ${REPLY_SUMMARY_LIMIT.toLocaleString('en-US')}, so cut at least ${Math.max(0, was - REPLY_SUMMARY_LIMIT).toLocaleString('en-US')}. ${LONG_SUMMARY_REMEDY}`
}

/**
 * ⚑ **PE-006 · the detail in words: what to do first, then how it ended** — ⚑ **D-025 · and who, and
 * when**: *"… It was closed by BroBot at 19:39, so nothing was recorded or changed."*
 *
 * ⚠️ **Each fact only where the detail carries it**: the name ({@link ReplyRefusalDetail.called})
 * where the row named somebody other than the caller, the clock time ({@link clockTime}, the one
 * every surface says *when* in) where it holds the moment. ⛔ **With no name, the ending has no
 * actor** — never *"the giver"*, which the one who cancels a held brief need not be. ⚑ Naming who
 * ended the piece is a fact about THIS call, why it was refused, and not a description of who a
 * giver is.
 *
 * ⛔ **The name never opens the sentence, so it is written as it is spelled.** It follows *by*:
 * {@link AN_AGENT_THIS_APP_CANNOT_NAME} is a lower-case category, and an agent nobody has given a
 * display name is called by its slug — capitalising either after the full stop would change it.
 */
function endedPieceSentence(detail: ReplyRefusalDetail): string {
  const by = detail.called === undefined ? '' : ` by ${detail.called}`
  const at = detail.at === undefined ? '' : ` at ${clockTime(detail.at)}`
  switch (detail.state) {
    case 'answered':
      return `stop work on that piece; no further reply is owed. You already replied${at}, so nothing was recorded or changed.`
    case 'withdrawn':
      return `stop work on that piece; no further reply is owed. It was taken back${by}${at}, so nothing was recorded or changed.`
    case 'closed':
      return `stop work on that piece; no further reply is owed. It was closed${by}${at}, so nothing was recorded or changed.`
    default:
      return REPLY_SENTENCES['piece-already-ended']
  }
}

/** ⛔ `retryable` is DERIVED from `permanence` through one table, so the two cannot disagree. */
export function refuseReply(rail: ReplyRail, detail: ReplyRefusalDetail = {}): ReplyRefusal {
  const permanence = replyPermanenceOf(rail)
  return {
    rail,
    permanence,
    retryable: permanence === 'while-this-holds',
    reason: refusalReason(
      rail === 'piece-already-ended'
        ? endedPieceSentence(detail)
        : rail === 'summary-too-long'
          ? longSummarySentence(detail)
          : rail === 'a-conversation-with-its-questions-is-starting' && detail.label !== undefined
            ? aPieceNotEndedWhileAQuestionStarts(detail.label, 'work-replied')
            : rail === 'its-questions-could-not-all-be-read' && detail.label !== undefined
              ? aPieceNotEndedItsQuestionsUnread(detail.label, 'work-replied')
              : REPLY_SENTENCES[rail],
    ),
    remedy: replyRemedyOf(rail),
    detail,
  }
}

/**
 * 🔴 **The whole door, as a pure function of what the caller's own ledger holds** (393 §4) — ⚑ and,
 * since D-025, of what the host calls the one that ended a piece of it (`whatToCall`).
 *
 * ⛔ **`piece` is `undefined` when the caller's ledger holds no such piece — never when it holds
 * somebody else's.** The lookup is the entitlement, and it happens before this call; see this
 * file's header on why that is stronger than an ordered check. ⚑ **`root` is whether the name named
 * the caller's own root** (D-016), which is never a folded piece (R1) and so never `piece`.
 *
 * ⚠️ **The order is piece, then shape**, and it is the useful way round rather than the cheap one. A
 * caller holding a name that names nothing learns that first, because telling it about a summary
 * bound for a piece that does not exist would send it to rewrite a string that was never the
 * problem. ⛔ It leaks nothing either way: both questions are asked of the caller's own rows.
 */
export function admitReply(
  /** The piece as the call named it — a label or an id — echoed on every refusal. */
  named: string,
  piece: PieceRow | undefined,
  root: boolean,
  summary: string,
  /**
   * 🔴 **D-025 · what the host calls the one that ended the caller's piece** —
   * `RuntimeHost.whatToCallTheConversation`, PASSED: this module has no store. ⚑ The piece already
   * holds who ended it ({@link PieceRow.endedBy}), so the name alone
   * ({@link WhatToCallAConversation}), and asked only on `piece-already-ended`. ⛔ Required, for
   * {@link undrivenWorkText}'s `holder` reason.
   */
  whatToCall: WhatToCallAConversation,
): ReplyRefusal | null {
  if (piece === undefined) {
    return refuseReply(root ? 'a-person-gave-that-piece' : 'no-piece-by-that-name', {
      piece: named,
    })
  }
  // ⛔ **The same table the fold settles by**, imported rather than re-listed: a rail that kept its
  // own idea of which states are endings would be free to disagree with the derivation it guards,
  // and the disagreement would be invisible until a new state arrived.
  if (!TASK_IS_OPEN[piece.state]) {
    return refuseReply('piece-already-ended', {
      piece: named,
      label: piece.label,
      state: piece.state,
      // ⚑ **D-025 · when, and who** — off the row that ended it, the fold's own. ⚠️ The piece is the
      // caller's (`piece.owner`), so an ending by its owner is the caller's own reply: said by the
      // state, never by its own name (729 · R90).
      ...(piece.endedAt === null ? {} : { at: piece.endedAt }),
      ...(piece.endedBy === null || piece.endedBy === piece.owner
        ? {}
        : { called: whatToCall(piece.endedBy) }),
    })
  }
  if (summary.length > REPLY_SUMMARY_LIMIT) {
    return refuseReply('summary-too-long', {
      piece: named,
      label: piece.label,
      limit: REPLY_SUMMARY_LIMIT,
      was: summary.length,
    })
  }
  return null
}

/**
 * 🔴 **What became of the words, as a closed list** (393).
 *
 * ⛔ **Each answer names what happened, and *"nothing unwired implies a working state"***
 * (Slice 2 #7, carried forward as criterion 15). A reply that reached nobody must not report the
 * same word as one that arrived, and a model deciding what to do next acts differently on each of
 * these.
 *
 * ⚠️ **None of them is a failure of the REPLY.** The piece is closed before any of this is decided —
 * see `RuntimeHost.replyToParent` on why the ledger row cannot be conditional on somebody being
 * there to read it.
 */
export const REPLY_DELIVERIES = [
  /** The parent was idle, or not running and started for it: the reply is its next turn. */
  'sent',
  /**
   * The parent was busy, or its delivery failed while it still runs: the reply is held and goes
   * when its turn ends — ⚠️ unless the held message ends unsent first, which `729` (R89) records as
   * a later loss (`AN_ANSWER_HELD_THEN_LOST`).
   */
  'held',
  /**
   * ⚑ **D-030** — the delivery failed and the parent cannot take the reply in this life: it was not
   * running and could not be started now, or it was stopping. The reply is
   * held in its own ledger and goes first at its next start, whatever starts it — ⚠️ unless it
   * ends unsent first (R89).
   */
  'kept',
  /**
   * ⚑ **D-030** — nothing holds the words for the parent: its record would not take them, or they
   * could not be composed. Reported, with why, rather than raised.
   */
  'not-delivered',
] as const

export type ReplyDelivery = (typeof REPLY_DELIVERIES)[number]

/**
 * 🔴 **Whether the words actually reached the conversation that gave the work** (415, HO-021 §5) —
 * a table rather than a list containing only the landed members.
 *
 * ## ⛔ It exists so that *"nothing landed"* cannot be the absence of a branch
 *
 * ⚠️ **The PO protected this above every other property in the round:** *"a lost reply is the worst
 * outcome in this system — worse than a refused one, worse than a duplicated piece — because it is
 * the one failure mode with no signal."* ⛔ `not-delivered` is that failure, and until `415` it
 * left only a `console.warn`. ⚑ **D-017 · `no-conversation` is gone**: a giver that is not running
 * is started for the reply. ⚑ **D-010 ·
 * `parent-is-holding-a-message` is gone**: a busy parent now holds the reply beside whatever else
 * waits, so that loss can no longer happen.
 *
 * ⚑ **Keyed by {@link ReplyDelivery}, so a new delivery answer cannot be added without saying
 * whether it landed** — {@link TASK_IS_OPEN}'s shape, and the reason
 * `an-unenumerated-state-counts-as-success` is a rule. ⛔ A new member that landed nowhere and
 * nobody classified would otherwise inherit *silence* as its meaning.
 *
 * ⚠️ **`held` is LANDED.** The parent is busy, the words are in its mailbox and they go when its
 * turn ends; nothing is owed a row AS IT IS QUEUED — and since D-010 it is held whatever the
 * parent already holds.
 * 🔴 **729 · R89 — and a held reply that then ends UNSENT is owed the row then** (*"Lost is lost,
 * whatever lost it"*): a stop that cut its handover, a Cancel at its door or a crash —
 * `RuntimeHost.recordAnAnswerItsGiverNeverGot`, and the crash repair. ⚠️ A Close, a stop, a
 * stream's end and a quit hand held words on to the next start, and a moved sign-in keeps them for
 * its reopen, so none of them is a loss.
 * ⚑ This table stays what the agent was handed back at the call; the later loss is a later row.
 *
 * ⚑ **D-030 · `kept` is LANDED.** A giver that cannot take the reply in this life holds the words
 * in its own ledger, and its next start sends them first — the same held message, owed the same
 * later row if it then ends unsent.
 */
export const REPLY_LANDED: Readonly<Record<ReplyDelivery, boolean>> = {
  sent: true,
  held: true,
  'not-delivered': false,
  kept: true,
}

/**
 * The answer `reply_to_parent` gets — a returned union, never a throw (`341`'s shape).
 *
 * ⚠️ **`refusal` comes from this vocabulary or the resource store's** when a file handed in could not
 * be kept. ⛔ They are not merged and neither is translated: each resource sentence already says the
 * reply was not recorded, for this caller to pass through unchanged.
 */
export type ReplyOutcome =
  | {
      readonly ok: true
      readonly piece: string
      readonly label: string
      /** The `work_resource` ids kept with the reply, in the order the files were handed in. */
      readonly resources: readonly string[]
      readonly resultDocument?: string
      /**
       * ⚑ A person gave the piece, so there was no conversation to deliver it to, and nothing was
       * queued, told or woken (D-016 · commit 6 · R5).
       */
      readonly delivered: null
    }
  | ({
      readonly ok: true
      readonly piece: string
      readonly label: string
      /** The `work_resource` ids kept with the reply, in the order the files were handed in. */
      readonly resources: readonly string[]
      readonly resultDocument?: string
      /**
       * ⚑ **D-030 · the conversation the words went to, by the name every surface says** — its
       * giver, or the one in its place (D-017 · R10) — ⛔ never its id.
       */
      readonly giver: string
      /**
       * ⚑ **D-030 · D-017 · R10 — the conversation that gave the piece could never be reopened**, so
       * {@link giver} is the one that took its place, and the answer says so.
       */
      readonly tookItsPlace: boolean
    } & (
      | {
          /** What became of the words. */
          readonly delivered: 'sent'
          readonly why?: undefined
        }
      | {
          readonly delivered: 'held'
          /**
           * ⚑ Why it waits for more than its giver's turn, when it does: the giver holds a Claude
           * sign-in this Mac moved on from, and this app reopens it for what is held; the giver's
           * turn is stopped until a person answers it; or (F074) the giver's provider is at its
           * usage limit, and it goes at the reset (`RuntimeHost.whyWhatIsHeldWaits`).
           */
          readonly why?: string
        }
      | {
          readonly delivered: 'kept' | 'not-delivered'
          /**
           * ⚑ **D-017 · R14** — why, in words: the start's or the delivery's own reason, for `kept`;
           * the record's, for `not-delivered` (D-030).
           */
          readonly why: string
        }
    ))
  | { readonly ok: false; readonly refusal: ReplyRefusal | ResourceRefusal }

/**
 * ⚑ **D-016 · resources as every sentence names them** — `res_… (name)`, joined. ⛔ One spelling
 * for a reply, a piece's record, a brief's inputs, the note that tells an owner of new ones and the
 * answers that say what was kept: a resource is named by its id and its file's name, never by a
 * path.
 */
export function resourcesNamed(
  resources: readonly { readonly resource: string; readonly name: string }[],
): string {
  return resources.map((one) => `${one.resource} (${one.name})`).join(', ')
}

/**
 * ⚑ **D-016 · the door that reads a resource, said after the ones a sentence names** — one
 * spelling, for {@link resourcesSaid} and for every list of resources that ends on it.
 */
export const READ_ONE_WITH_READ_DOCUMENT = 'Read one with read_document.'

/** ⚑ **D-016 · {@link resourcesNamed} under a lead, then the door that reads one.** */
export function resourcesSaid(
  lead: string,
  resources: readonly { readonly resource: string; readonly name: string }[],
): string {
  return `${lead}: ${resourcesNamed(resources)}. ${READ_ONE_WITH_READ_DOCUMENT}`
}

/**
 * 🔴 **The words a giver actually receives.**
 *
 * ## ⛔ It says what it is, because it arrives as an ordinary turn
 *
 * ⚠️ **A reply reaches a giver through `queueMessage`, so it renders as a `user_turn`** — the same
 * shape a brief takes when a giver gives a piece. ⛔ Without a first line naming the piece, a giver
 * reading its own transcript would see words that look like a person's. ⚑ The provenance is
 * therefore in the TEXT, where the reader is, rather than in a field only the app can see.
 *
 * ## ⚠️ It states facts about THIS reply and instructs nothing
 *
 * ⛔ **No sentence here describes how the app works** (HO-015 §2, standing) — not how replies are
 * routed, not what a piece is, not what the giver may do next. Every line is a value off the row or
 * off the reply. ⚑ **A resource is named by its id and its file's name, never by a path**:
 * `read_document` is the giver AGENT's door, and it takes the id. ⚠️ **510 · the PERSON reading the
 * same row presses instead of quoting**, which is why the ids are also a field on {@link WorkReport}
 * and not only words in this sentence.
 *
 * ⚠️ **`needs_user_action` is rendered as *the agent said* rather than as a fact**, because that is
 * what it is: a claim by the conversation that made it, which grants nobody anything and escalates
 * nothing.
 *
 * 🔴 **D-016 · commit 7 · R3 — the holder by its NAME, never its id.** ⚑ The piece already names the
 * conversation (a piece has one owner), so the agent's name beside it cannot be confused with
 * another of that agent's conversations. ⚠️ `'owner'` left the `Pick` for {@link undrivenWorkText}'s
 * reason: the id cannot reach this sentence.
 *
 * ⚑ **D-022 · R2 — a correction that lost the race is said here, a fact about THIS reply**: a new
 * brief the giver sent was still held for the holder as it answered, so the answer is to the brief
 * before it. ⚠️ It claims nothing about whether the new brief was held before the answering turn
 * began or arrived during it — the one sentence is true in both.
 */
export function replyText(
  piece: Pick<PieceRow, 'label' | 'title'>,
  /** ⚑ What the conversation holding the piece is called — `RuntimeHost.whatToCallTheConversation`. */
  holder: string,
  reply: { outcome: TaskOutcome; summary: string; needsUserAction: boolean },
  /** The resources kept with this reply: `work_resource` ids and the names their files were kept by. */
  resources: readonly { readonly resource: string; readonly name: string }[],
  /**
   * 🔴 **D-022 · R2 — a new brief of this piece its giver sent was still held for the holder as it
   * answered**: the giver is told the answer is to the brief before it. ⛔ Required: a door that
   * forgot it would drop the one sentence that says a correction lost the race.
   */
  aNewBriefWaited: boolean,
): string {
  const lines = [
    `${pieceLine(piece.label, piece.title)} was answered by ${holder}: ${reply.outcome}.`,
    ...(aNewBriefWaited
      ? [
          `This answers the brief before your new one, which had not reached ${holder} when it answered.`,
        ]
      : []),
    reply.summary,
  ]
  if (resources.length > 0) lines.push(resourcesSaid('Its resources', resources))
  if (reply.needsUserAction) {
    lines.push(`That agent said ${A_PERSON_MUST_ACT_SENTENCE}.`)
  }
  return lines.join('\n\n')
}

/**
 * 🔴 **The facts beside the reply's words** (406, HO-019 §2) — see {@link WorkReport}.
 *
 * ⛔ **Built from the same values `work_replied` was published with**, in the same call, so the row
 * a person reads and the row the ledger holds cannot disagree. ⚠️ **`state` is `'answered'` and is
 * written here rather than read off {@link PieceRow.state}**: the row this takes is the piece as it
 * was BEFORE the reply — `deliverReply` is handed the row the lookup found — and copying its stale
 * `working` onto a report about a reply would be the report contradicting the sentence beside it.
 *
 * ⚑ **`needsUserAction` and `resources` are spread, never assigned**, so a reply that did not claim
 * the one or hand in the other leaves no key at all — what makes *absent* mean *the agent said no*
 * rather than *this app forgot to write it*.
 */
export function workAnswered(
  piece: Pick<PieceRow, 'piece' | 'label' | 'owner'>,
  reply: { outcome: TaskOutcome; needsUserAction: boolean },
  /**
   * ⛔ **510 · PASSED, and never picked off `piece`** — the ids {@link replyText} names, from the same
   * local, in the same call. 🔴 **`piece` is the row as it was BEFORE this reply**, so its own
   * `resources` are empty, exactly as its `state` is `working`.
   */
  resources: readonly string[],
): WorkReport {
  return {
    piece: piece.piece,
    label: piece.label,
    // ⚑ **506 · copied, never re-derived** — see {@link WorkReport.owner}. ⛔ Assigned rather than
    // spread: a piece always has an owner, so an absent key would be a row this app forgot.
    owner: piece.owner,
    state: 'answered',
    outcome: reply.outcome,
    ...(resources.length === 0 ? {} : { resources }),
    ...(reply.needsUserAction ? { needsUserAction: true as const } : {}),
  }
}

/**
 * 🔴 **The facts beside the undriven-work notice's words** (406) — {@link workAnswered}'s sibling.
 *
 * ⛔ **`state` is `'stalled'` and the cause travels with it**, which is `PieceRow.stalledBecause`'s
 * invariant — *non-null if and only if the state is `stalled`* — held here the same way the fold
 * holds it: by construction, because this is the only function that writes either.
 *
 * ⚠️ **No `outcome`, no `needsUserAction` and no `resources`.** Nothing has replied, so all three are
 * absent, and on a report that is not `answered` an absent claim means *nobody has said*. ⚑ An
 * answered piece can never afterwards stall: `answered` is not `TASK_IS_OPEN`, so the fold lets the
 * row go before any stall could reach it.
 */
export function workUndriven(
  piece: Pick<PieceRow, 'piece' | 'label' | 'owner'>,
  cause: TaskStallCause,
): WorkReport {
  return {
    piece: piece.piece,
    label: piece.label,
    // ⚑ **506 · the same field on BOTH halves** — a stall carries no `carriedFor` and must not, since
    // nothing came from the owner, so this is where the report names where the work is, as a FACT.
    owner: piece.owner,
    state: 'stalled',
    stalledBecause: cause,
  }
}

/**
 * 🔴 **724 · `720` F-C — how a caller names a conversation it holds the id of** — the host's naming,
 * which this module cannot call: it has no store. ⚑ **D-016 · commit 7 · R3 — either of two**:
 * `RuntimeHost.nameByItsWork` (the agent's name and the piece it owns) for an asker or a sender,
 * whom nothing else in the sentence names — ⚑ F033 · `nameByItsWorkUnder` when the sentence is
 * about one piece — and `RuntimeHost.whatToCallTheConversation` (the name alone) where a piece in
 * the sentence already does. ⚠️ Either answers a name or
 * {@link AN_AGENT_THIS_APP_CANNOT_NAME} — the first with the piece beside it — never the handle
 * (`HO-095` §5.3).
 */
export type WhatToCallAConversation = (conversation: string) => string

/**
 * 🔴 **724 · `720` F-C — an ask to stop, with whoever asked NAMED** — what the sentences here say
 * about an ask, where {@link PieceRow.stalledBy} carries the asker's conversation ID.
 *
 * ⛔ **Until `724` the id reached the sentence**: the notice pushed to a parent and `list_tasks`'
 * line read *"…, by sess_…"* for an agent's ask, where `HO-095` §5.3 wants a name (R41). ⚑ So a
 * composer here takes THIS, and `called` is not `asker`: a row's ask handed over as it is does not
 * compile — `624`'s narrowing of `holder`, applied to the asker. ⚠️ The id stays on the row a model
 * can press on (`asked_to_stop_by`), which is `HO-095` §6.4's *ids reachable, and out of the sentence*.
 *
 * 🔴 **729 · PM ruling R90 — unless the asker IS the reader** ({@link byTheReader}): then nothing is
 * named, and the sentence says the ask as the reader's own act (`724` F-2).
 */
export interface TheAskNamed {
  readonly by: WhoStoppedIt
  /**
   * The asking conversation's NAME, or `null` when the row names no conversation (a person's ask) —
   * ⚠️ and `null` when {@link byTheReader}: the reader is not told its own name.
   */
  readonly called: string | null
  /**
   * 🔴 **729 · PM ruling R90 — the one who asked IS the conversation this sentence is for** (`724`
   * F-2). ⚑ Said as its own act — {@link YOU_ASKED_IT_TO_STOP} — never *"…, by Ada"* to Ada.
   */
  readonly byTheReader: boolean
}

/**
 * ⚑ **724 · the one way to name an ask** — the row's, with its asker read through `whatToCall`.
 *
 * 🔴 **729 · R90 — and asked FOR a reader** (`724` F-2): the conversation the sentence is composed
 * for. ⛔ **Required, and there is no reader-less call**: both sentences that name an ask go to one
 * known conversation — the push to the giver, `list_tasks`' line to its caller — so a default would
 * be a reader nobody could be wrong about. ⚠️ **Only an AGENT's ask can be the reader's**: a
 * person's (`a-person`) and one this app cannot name answer `false`, and a row whose asker is not
 * recorded is never matched to a reader by two absent ids.
 */
export function theAskNamed(
  ask: PieceRow['stalledBy'],
  whatToCall: WhatToCallAConversation,
  reader: string,
): TheAskNamed | null {
  if (ask === null) return null
  if (ask.by === 'an-agent' && ask.asker !== null && ask.asker === reader) {
    return { by: ask.by, called: null, byTheReader: true }
  }
  return {
    by: ask.by,
    called: ask.asker === null ? null : whatToCall(ask.asker),
    byTheReader: false,
  }
}

/**
 * ⛔ **What this app calls a conversation it holds no identity for** (624, `HO-092` §2 on the
 * surface `HO-095` §5.3 names) — and it is a CATEGORY, never a name.
 *
 * ## 🔴 It exists so the fallback cannot be an id
 *
 * ⚠️ **`HO-095` §5.3: *"Task #1 (`task_30277c05…`) with `sess_a2d504f1…`. That is Ada. Say
 * Ada."*** ⛔ **The fix is only half done if the arm that cannot name somebody prints the handle
 * instead** — `relayed-turn.ts`'s `relayedSender` is the same shape for the same reason, and
 * `413` §4's surviving clause is the ruling behind both: *a turn attributed to the app is not a
 * turn attributed to a named agent unless the ledger holds that name.*
 *
 * ⚑ **When a reader meets it**: `SessionStore.identityOf` answers `null` for a conversation this
 * app holds no identity for — a row swept out of the person's own provider home, or imported from
 * one. ⚠️ **An identity nobody has NAMED is not this case**: `agentName`
 * falls through to the slug, which is a word a person can read and match against the roster.
 *
 * ⛔ **And the id is not lost with it.** {@link WorkReport.owner} carries the conversation on
 * the same row, which is where `HO-095` §6.4's *"keep ids reachable for diagnosis"* is honoured —
 * in the control projection rather than in the sentence.
 */
export const AN_AGENT_THIS_APP_CANNOT_NAME = 'an agent this app cannot name'

/**
 * 🔴 **484 · what was observed, and who asked when the ledger names somebody** (HO-029 §2.1) —
 * composed by {@link theStallAndItsAsk} since `720` (R72), which says an ask beside a turn the
 * provider finished as an ASK.
 *
 * ⛔ **This is the answer a tool gives an AGENT that HO-031 §2.1 is actually about.** HO-018 ruled
 * the condition is PUSHED rather than merely visible to a poll, so this sentence is what a parent
 * acts on — and *"the turn it was running in was stopped"* naming nobody is the false history in the
 * place it does the most damage.
 *
 * ⚑ **Both halves are imported and neither is spelled here**: {@link undrivenSentence} owns the
 * observation (*one table and three callers, never three tables*) and {@link askedByClause} owns the
 * actor's words, which is the SAME composition `list_tasks` appends to the row read back. ⚠️ Two
 * accounts of one event that disagreed about who did it is the shape `stoppedBy`'s own rule exists
 * against.
 */
const undrivenNotice = (
  cause: TaskStallCause,
  by: TheAskNamed | null,
  limit: TheLimitSaid | undefined,
  login: StoppedOnALogin | undefined,
): string => `${theStallAndItsAsk(cause, by, limit, login)}.`

/**
 * ⚑ **F076 — `login_refused`'s sentence with what this app did about it** — reopened since (and
 * nothing from the failed turn sent again), or, for Claude, not: the Mac holds no newer login yet.
 *
 * ⚑ **Whose login, and which kind** ({@link StoppedOnALogin}): a refused API key is not a login
 * renewed elsewhere — nothing on this Mac moved, and only a person can check or replace the key —
 * and a Codex sign-in is its profile's: reopened by itself when the profile was signed in to
 * another account, else a person signs it in again.
 * ⚠️ So *"has not been reopened since"* is said of Claude alone, where a reopen is the remedy; a
 * Codex conversation stays open after the refusal, and a reopen since is still said.
 */
function theLoginSentence(login: StoppedOnALogin): string {
  const onCodex = providerValue(login.provider, { claude: false, codex: true })
  const refused = onCodex
    ? login.onAKey === true
      ? 'its turn failed because the API key its Codex conversation was started with was refused, so a person needs to check or replace that key under “API key” on the Codex card in Providers'
      : login.reopened
        ? 'its turn failed because Codex refused the sign-in its conversation was started with, its profile having been signed in to another account since'
        : 'its turn failed because Codex refused the sign-in its conversation was started with, so a person needs to sign its Codex profile in again'
    : login.onAKey === true
      ? 'its turn failed because Claude refused the Anthropic API key its conversation was started with, so a person needs to check or replace that key under “API key” on the Claude card in Providers'
      : 'its turn failed because Claude refused the login its conversation was started with, as it does when another Claude on this computer renews or switches the login'
  if (login.reopened) {
    return `${refused}; its conversation has been reopened since, and nothing from that turn was sent again`
  }
  return onCodex ? refused : `${refused}, and its conversation has not been reopened since`
}

/** ⚑ **F074** — a limit as {@link theLimitSentence} says it: the provider's name, the reset, and when. */
interface TheLimitSaid {
  readonly provider: string
  readonly resetsAt: number | null
  /** Whether the provider named the limit it reached. */
  readonly named: boolean
  readonly now: number
}

/**
 * ⚑ **F074 — `provider_limited`'s sentence with whose limit and when it resets** — the table's
 * sentence (`UNDRIVEN_SENTENCES`) with the provider named, and the reset on the Mac's clock —
 * with its day when that is not the stall's. ⚠️ Composed here and not in `shared/tasks.ts`, whose fold reaches
 * no clock.
 */
function theLimitSentence(limit: TheLimitSaid): string {
  // A refusal that names no limit and no reset is nothing this app can time: the provider's plan or
  // its usage refused the turn, and only its own words say which.
  if (!limit.named && limit.resetsAt === null) {
    return `its turn ended because ${limit.provider} refused it on its plan or usage; ${limit.provider}’s own words are in that conversation`
  }
  const resets =
    limit.resetsAt === null ? '' : `; it resets at ${clockTimeFrom(limit.resetsAt, limit.now)}`
  return `its turn ended because ${limit.provider}’s usage limit was reached${resets}`
}

/**
 * ⚑ **F074 — the usage limit a stall's turn ended on, said** — the provider's name, and its reset
 * said as of the stall's own moment: ⛔ a notice reads no clock of its own. `undefined` on every
 * stall that carries no limit ({@link PieceRow.stoppedOnALimit}).
 */
export function theLimitItStoppedOn(
  piece: Partial<Pick<PieceRow, 'stalledAt' | 'stoppedOnALimit'>>,
): TheLimitSaid | undefined {
  const limit = piece.stoppedOnALimit
  if (limit === undefined) return undefined
  const resetsAt = limit.resetsAt ?? null
  return {
    provider: PROVIDER_NAME[limit.provider],
    resetsAt,
    named: limit.window !== undefined,
    now: piece.stalledAt ?? resetsAt ?? 0,
  }
}

/**
 * 🔴 **`720` · R72 — the stall, and who ASKED, as two facts** — the one composition the pushed notice
 * ({@link undrivenNotice}) and `list_tasks`' line both read, with no full stop so each caller can
 * frame it.
 *
 * ⛔ **`askedByClause` is cause-blind, and on `turn_ended` it would say something false.** Appended
 * as-is it reads *"its turn ended with this work still open, by a person"* — naming the asker as the
 * one who ENDED the turn, which is the conflation R43 removed: the provider finished that turn, and
 * the person only asked. ⚑ So on `turn_ended` the ask is said as an ask, in {@link ASKED_TO_STOP}'s
 * words; on `turn_interrupted` the clause is unchanged, byte for byte.
 *
 * 🔴 **729 · PM ruling R90 — and the READER's own ask is said as its own act, on both**: *"…; you
 * asked it to stop"* ({@link YOU_ASKED_IT_TO_STOP}), after the turn a provider finished and after
 * the turn it stopped alike — an ask either way, and never *"…, by <its own name>"* (`724` F-2).
 */
export function theStallAndItsAsk(
  cause: TaskStallCause,
  /** 🔴 **724 · `720` F-C — the ask, NAMED** ({@link TheAskNamed}), never the row's id. */
  by: TheAskNamed | null,
  /** ⚑ **F074** — the usage limit its turn ended on ({@link theLimitItStoppedOn}). */
  limit?: TheLimitSaid,
  /** ⚑ **F076** — what this app did about the login its turn failed on ({@link PieceRow.stoppedOnALogin}). */
  login?: StoppedOnALogin,
): string {
  const stall =
    cause === 'provider_limited' && limit !== undefined
      ? theLimitSentence(limit)
      : cause === 'login_refused' && login !== undefined
        ? theLoginSentence(login)
        : undrivenSentence(cause)
  if (by?.byTheReader === true) return `${stall}; ${YOU_ASKED_IT_TO_STOP}`
  const ask = by === null ? null : { by: by.by, asker: by.called }
  // ⚑ **F074 — and on `provider_limited`, as on `turn_ended`**: the provider refused that turn,
  // and the asker only asked. ⚑ **F076 — and on `login_refused`**, for the same reason.
  return by !== null && cause !== 'turn_interrupted'
    ? `${stall}; it had been ${ASKED_TO_STOP}${askedByClause(ask)}`
    : `${stall}${askedByClause(ask)}`
}

/**
 * 🔴 **The words a parent receives when work it gave out stopped being driven** (400,
 * HO-018 §2.1 · criterion 4).
 *
 * ## ⛔ Why there is a message at all, rather than a row somebody could go and read
 *
 * ⚠️ **HO-018: *"the change is that the condition is PUSHED, not merely visible to a poll."*** ⛔ A
 * parent that has to ask `list_tasks` to find out is a parent that waits forever unless something
 * reminds it — which is the criterion (*nobody waits forever in silence*) failing in exactly the
 * case it was written for. ⚑ So it arrives the way a question does: through `queueMessage`, as an
 * ordinary turn, in the transcript the parent is already reading.
 *
 * ## ⚠️ It states what was OBSERVED and rules nothing
 *
 * ⛔ **It does not say the work failed, and it does not tell the parent what to do.** HO-018's
 * principle is that the engine records what it observed and the parent decides; a sentence here
 * recommending *end it* or *re-assign it* would be this app making the decision and calling it a
 * notice. ⚑ Each cause renders as the event it came from — {@link TaskStallCause} — because *the
 * turn ended*, *somebody stopped it* and *the app restarted* are three different things to decide
 * about.
 *
 * ⛔ **No sentence here describes how the app works** (HO-015 §2, standing). The one imperative
 * names a tool that exists and the label to quote, which is {@link replyText}'s rule one subject
 * over.
 *
 * ## 🔴 614 · and it now carries what the child SAID (`HO-088` §5.2)
 *
 * ⚠️ **`HO-092` §3 is the measurement.** The header said `Idle`, the avatar said `idle`, this
 * notice said *not being worked on* — and the agent's own words on the same screen were *"I'm
 * still holding on your answers to the six trip questions… whenever you're ready."* ⛔ **Nothing
 * was false**: `openQuestionsByWork` folds rows the question TOOL writes, the agent asked in
 * prose, and the surface reported an empty record truthfully. ⚑ **So this is a fact the app did
 * not carry, and a comment claiming it repaired a lie would itself be one.**
 *
 * ⛔ **It reports the words and reads nothing in them** — `00-backlog.md` **D17**, permanent.
 * ⚠️ There is no predicate anywhere on this path over what the words SAY: nothing counts a
 * question mark, nothing decides whether the child is stuck, nothing flags a paragraph. ⚑ The one
 * property of the bytes that is read is their LENGTH, at `PREVIEW_CAP`.
 *
 * ## 🔴 D-012 · a PREVIEW of the last exchange, and a way to read more (proposal §6.5)
 *
 * ⛔ **It quoted the child's last message whole, up to 4 KB**, because a giver could not read its
 * child — and a long message cost the giver that context at every stall. ⚑ Now: who sent the
 * child's last turn and the start of what they wrote, then the start of the child's answer — and,
 * where the reader may read that conversation, `read_transcript` for the rest.
 *
 * 🔴 **And it does not claim the parent saw them** (`581`'s bound). This text is handed to
 * `queueMessage`; what that proves is what was SENT.
 *
 * ## ⚠️ Why the words are here and NOT on {@link workUndriven}'s report
 *
 * ⛔ **`WorkReport` is a durable wire contract and `406`'s review removed two fields for having no
 * reader.** ⚑ `506` and `510` put both back only once a surface PRESSED on them — a conversation
 * to open, a document to read — because what a row needs a FIELD for is a control that cannot be
 * parsed out of the prose (`where-the-work-is.ts`' own rule).
 *
 * ⚑ **These words need no such field, because the prose IS what a person is shown**:
 * `WorkReportEntry.vue` prints this string verbatim as the row's body, so the same change serves
 * the model reading the turn and the person reading the transcript. ⚠️ **That is a condition and
 * not a ruling** — the day a surface needs to press on these words rather than read them, that is
 * when the field is owed.
 */
export function undrivenWorkText(
  /**
   * ⚑ **624 · `assignedTo` LEFT this `Pick`** and that is a narrowing rather than tidiness.
   *
   * ⛔ **The two lines that read it now read {@link holder}** — `HO-095` §5.3 — so a signature
   * that still accepted the conversation would be a signature a future line could reach for,
   * which is exactly how the handle got into a person's sentence in the first place. ⚠️ Narrowing
   * it makes *this composer cannot print a `sess_…`* a fact the compiler holds rather than a rule
   * a writer has to keep (`a-narrowing-is-opt-in-at-the-call-site-too`, pointed at a parameter).
   */
  piece: Pick<PieceRow, 'label' | 'title' | 'questionLostAtRestart'> &
    Partial<
      Pick<PieceRow, 'stalledAt' | 'stoppedInTheBackground' | 'stoppedOnALimit' | 'stoppedOnALogin'>
    >,
  cause: TaskStallCause,
  /**
   * 🔴 **D-012 · that conversation's last exchange** — `SessionStore.lastExchange`, PASSED. It was
   * `614`'s *what that conversation last SAID*, quoted whole; the rest of this note is `614`'s.
   *
   * 🔴 **614 · what that conversation last SAID** — `SessionStore.whatItLastSaid`, PASSED.
   *
   * ⛔ **Required rather than defaulted**, which is {@link workAnswered}'s `documentId` rule and
   * its reason: the product has one call site, a default no call site reaches is a parameter
   * nobody can be wrong about, and the test call sites it reddens are the signal rather than the
   * cost.
   *
   * ⚠️ **Read at the call site and never here.** This module has no store and must not grow one —
   * `messageNamingThePiece`'s own boundary, one function over — and the read is by
   * {@link PieceRow.owner}, which is the conversation this sentence is already about.
   */
  exchange: Exchange,
  /**
   * 🔴 **624 · what the conversation HOLDING the work is called** (`HO-095` §5.3) —
   * `RuntimeHost.whatToCallTheConversation`, PASSED.
   *
   * ⛔ **Required and never defaulted**, which is {@link exchange}' own rule one parameter up and
   * its reason: the product has one call site, a default no call site reaches is a parameter
   * nobody can be wrong about, and the test call sites it reddens are the signal rather than the
   * cost.
   *
   * ⚠️ **Resolved at the call site and never here.** Naming a conversation is two reads — the
   * identity and the roster — and this module has no store and must not grow one
   * ({@link undrivenWorkText}'s own boundary, stated for `614`'s argument). ⛔ {@link
   * AN_AGENT_THIS_APP_CANNOT_NAME} is what a caller passes when those reads come up empty; a
   * `sess_…` handle is never a legal value here, and that is the whole of `HO-095` §5.3.
   */
  holder: string,
  /**
   * 🔴 **724 · `720` F-C — who asked the turn to stop, NAMED** ({@link theAskNamed} over
   * `RuntimeHost.nameByItsWorkUnder` the stopped piece, D-016 · commit 7 · R3, F033), or `null`
   * when nobody did — ⚑ and since
   * `729` (R90) NOT named when the asker is the parent this goes to: then the sentence says its own
   * ask as its own act ({@link TheAskNamed.byTheReader}). ⛔ Required and never defaulted, for
   * {@link holder}'s reason — and `'stalledBy'` left this `Pick` for it, so the id cannot reach the
   * sentence.
   */
  askedToStop: TheAskNamed | null,
  /** ⚑ **D-012** — names the conversation that sent the child its last message, as surfaces do. */
  nameOf: (who: AConversation) => string,
  /**
   * ⚑ **D-012 · whether THIS reader may `read_transcript` the child** — asked by the host, so the
   * notice never names a door its reader would be refused (`402`'s rule). ⚠️ The label it then
   * names is a value the tool takes (D-016 · commit 7 · R1: the piece's label names its owner), so
   * no id reaches this sentence — `owner` left the `Pick` above.
   */
  mayReadIt: boolean,
  /**
   * ⚑ **Whether the app's restart is what ended that conversation** — asked by the host (a quit
   * stamps each conversation it closes), so the words say *the app restarted* only when it did.
   */
  endedByTheRestart: boolean,
  /**
   * ⚑ **F084 · what that conversation still has running in the background as this is written** —
   * `RuntimeHost.whatStillRunsIn`, PASSED. ⚠️ Only a provider whose background work never wakes the
   * conversation (Codex) has a stalled piece with something still running: the fold stalls it at its
   * turn's end whatever runs. ⛔ Required, for {@link exchange}'s reason.
   */
  stillRunning: readonly string[],
  /**
   * ⚑ **F084 · what the stop of its last turn ended**, named — `RuntimeHost`'s
   * `lastStopEnded`, PASSED. ⚠️ Said only when a stop is what stalled the piece. ⛔ Required, for
   * {@link exchange}'s reason.
   */
  endedByTheStop: readonly string[],
): string {
  // ⚑ **484 · composed ABOVE the array and not inside it**, which keeps the line below the shape
  // `400`'s own mutation row anchors on. ⛔ A row of somebody else's must not go dark because this
  // dispatch put a call where a lookup used to be.
  const limit = cause === 'provider_limited' ? theLimitItStoppedOn(piece) : undefined
  const login = cause === 'login_refused' ? piece.stoppedOnALogin : undefined
  const said = undrivenNotice(cause, askedToStop, limit, login)
  // 🔴 **624 · a NAME where two ids used to be** (`HO-095` §5.3, `HO-092` §2 on a new surface).
  //
  // ⛔ **It read `Task #1 (task_30277c05…) with sess_a2d504f1…`** and the PO's answer was three
  // words: *"That is Ada. Say Ada."* ⚠️ **Both ids were pure duplication of fields the row beside
  // this prose already carries** — {@link WorkReport.piece} and {@link WorkReport.owner}, which
  // `506` and `510` put there precisely so a surface could press on them — so what is lost from the
  // sentence is not lost from the row (`HO-095` §6.4: *keep ids reachable for diagnosis… and out of
  // the sentence*).
  //
  // ⚑ **D-016 · the LABEL names the piece, beside its title** ({@link pieceLine}): it is the one
  // name a person says, and `list_tasks` takes it back — the imperative below names it again.
  // 🔴 **F074 — a limit is not *not being worked on***: the turn ended because the provider refused
  // it, and the words say that and when it resets — measured: a giver told *"not being worked on"*
  // about a helper the five-hour limit had stopped could only guess it was broken.
  const notWorkedOn = cause === 'provider_limited' ? '' : ' is not being worked on'
  const lines = [`${pieceLine(piece.label, piece.title)} with ${holder}${notWorkedOn}: ${said}`]
  // ⚑ **…and what a message sent to it meanwhile does**: the app holds it until the reset
  // (`RuntimeHost.itWaitsForItsLimit`), which only a known reset can end.
  if (limit !== undefined && limit.resetsAt !== null) {
    lines.push(`A message to ${holder} waits until then.`)
  }
  const stopped = whatStoppedWithIt(piece, cause, endedByTheRestart)
  if (stopped !== null) lines.push(stopped)
  // ⚑ **F084 · what the stop ended, and what still runs, named** — *not being worked on* is true of
  // the piece, and a giver who stopped the work to free the machine reads what still uses it.
  if (cause === 'turn_interrupted' && endedByTheStop.length > 0) {
    lines.push(`The stop ended ${theStoppedWork(endedByTheStop)}.`)
  }
  if (stillRunning.length > 0) {
    lines.push(`${holder} still has ${theStoppedWork(stillRunning)} running in the background.`)
  }
  if (piece.questionLostAtRestart) {
    lines.push('A question that conversation had asked was still unanswered when the app stopped.')
  }
  // 🔴 **614 · the words, carried and never described** (`HO-088` §5.2). ⛔ **After everything this
  // app observed and BEFORE the instruction**, which is the placement `exchangePreviewLines`
  // states: the quotation is the newest fact a parent acts on, and the line that follows it is
  // this app's own.
  //
  // ⚠️ **Spread from ONE composition** — that function's rule — so the paragraphs a parent is
  // PUSHED and anything a later surface shows are one account of one turn.
  //
  // ⛔ **Unconditional on the cause, and that is a refusal rather than an omission.** A
  // `Record<TaskStallCause, boolean>` was written and removed: it would have withheld the words
  // for `message_never_sent`, on the reasoning that a child which never received the work cannot
  // have been answering it — ⚑ which is a judgement about RELEVANCE, and HO-018's principle is
  // that the engine reports what it observed and the parent decides. ⚠️ The line claims only that
  // these are the last words that conversation said; the cause sentence above it already says
  // whether the work ever reached it, so the parent holds both facts and this app rules on
  // neither.
  // ⚑ **624 · the same NAME, so one conversation is called one thing on this notice.** ⛔ It was
  // the conversation's id here too — *"The last thing sess_a2d504f1… said"* — and that function's
  // own docblock justified it with *"the conversation id the caller already printed"*, which is a
  // reason that dies with the line above it.
  lines.push(...exchangePreviewLines(holder, exchange, nameOf))
  if (mayReadIt) {
    lines.push(`To read more of that conversation, call read_transcript with agent ${piece.label}.`)
  }
  lines.push(`It has not been answered. Read its record with list_tasks, naming ${piece.label}.`)
  return lines.join('\n\n')
}

/** How many of the stopped things a sentence names before it counts the rest. */
const STOPPED_NAMED = 3
/** How long one named thing may run before it is cut. */
const STOPPED_NAME_MAX = 120

/** What stopped, quoted and counted: *“a”, “b” and 2 more*. */
export function theStoppedWork(stopped: readonly string[]): string {
  const quoted = stopped.slice(0, STOPPED_NAMED).map((one) => {
    const cut = one.length > STOPPED_NAME_MAX ? `${one.slice(0, STOPPED_NAME_MAX - 1)}…` : one
    return `“${cut}”`
  })
  const more = stopped.length - quoted.length
  if (more > 0) return `${quoted.join(', ')} and ${String(more)} more`
  if (quoted.length <= 1) return quoted.join('')
  return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1] ?? ''}`
}

/**
 * 🔴 **What was waiting in the background when the work stopped, and what stopped it** — the line a
 * stall notice adds under its first, or `null` when nothing was ({@link
 * PieceRow.stoppedInTheBackground}).
 *
 * ⚑ It names the work, the time on this Mac's clock, and whether the app's restart did it: the
 * giver reads that the agent was waiting on something the restart took away, never that it gave up.
 */
export function whatStoppedWithIt(
  piece: Partial<Pick<PieceRow, 'stalledAt' | 'stoppedInTheBackground'>>,
  cause: TaskStallCause,
  endedByTheRestart: boolean,
): string | null {
  const stopped = piece.stoppedInTheBackground ?? []
  if (stopped.length === 0) return null
  if (cause !== 'background_stopped' && cause !== 'app_restarted') return null
  const named = theStoppedWork(stopped)
  // ⚑ On this Mac's clock, as every notice writes a time — ⛔ a notice reads no clock of its own.
  const time =
    piece.stalledAt === null || piece.stalledAt === undefined ? null : clockTime(piece.stalledAt)
  // ⚑ `background_stopped`'s own sentence already says it waited on background work that stopped;
  // this line names that work, and what stopped it.
  if (cause === 'background_stopped') {
    if (endedByTheRestart) {
      return time === null
        ? `That was ${named}, which the app’s restart stopped.`
        : `That was ${named}, which the app’s restart at ${time} stopped.`
    }
    return time === null
      ? `That was ${named}.`
      : `That was ${named}; its conversation ended at ${time}.`
  }
  // ⚑ `app_restarted` is written as the app starts again — after a crash, or for a scheduled wake-up
  // whose time passed while it was down — so its moment is the start, and what it says is only what is
  // certain: what it waited on did not come back with it.
  return time === null
    ? `It was waiting on ${named}, which did not survive the app’s restart.`
    : `It was waiting on ${named}, which did not survive the app’s restart (it started again at ${time}).`
}

/**
 * 🔴 **703 · the later facts that make a notice a giver still HOLDS about its work false** (`698` F-A)
 * — see `RuntimeHost.takeBackWhatALaterFactMadeFalse`, which takes back, for every fact, each
 * notice about the work the giver will still read (`theNoticesItWillStillRead`): the fact chooses
 * only the words.
 *
 *  - ⚑ **`'asked-about-it'`** — the giver's own question about the work reached its holder, which is
 *    running on it: *"…is not being worked on"* is false (R32's own basis, `673` F-1).
 *  - ⚑ **`'rebriefed'`** (D-016) — the giver's new brief of the work reached its holder, which is
 *    running on it: the same falsehood, by the giver's other act that drives the holder.
 *  - ⚑ **the three closed states** — the giver withdrew the work or closed it, or the holder
 *    answered it: every notice describes the work OPEN.
 */
export type WhatMadeItFalse =
  'asked-about-it' | 'rebriefed' | Extract<TaskState, 'withdrawn' | 'answered' | 'closed'>

/**
 * ⚑ **703 · the words each later fact is named in** — a closed record, so a fact cannot be added
 * without its sentence. ⚠️ Each names who acted: *"this conversation"* is the giver, whose
 * transcript the row is in; the holder is named.
 */
const WHAT_MADE_IT_FALSE: Readonly<Record<WhatMadeItFalse, (holder: string) => string>> = {
  'asked-about-it': (holder) => `this conversation asked ${holder} about that work`,
  rebriefed: (holder) => `this conversation gave ${holder} a new brief for that work`,
  withdrawn: () => 'this conversation withdrew that work',
  answered: (holder) => `${holder} answered that work`,
  closed: () => 'this conversation closed that work',
}

/**
 * 🔴 **703 · why this app took back its own notice: a LATER FACT made it false** (`698` F-A, under
 * `690`'s R32: *the app may withdraw its own UNREAD notice when a later fact makes it false*) — see
 * {@link WhatMadeItFalse}. ⛔ It is a PERSON's sentence, not a model's: the model never sees the
 * notice it names, and the transcript draws this beside the words that were not sent. ⚠️ It says who
 * acted and why, because the ending word alone (`retracted`) cannot say *which* later fact made the
 * notice false.
 */
export function aNoticeALaterFactRetracted(fact: WhatMadeItFalse, holder: string): string {
  return `${TAKEN_BACK_UNREAD}: ${WHAT_MADE_IT_FALSE[fact](holder)}`
}

/** ⚑ What every notice this app takes back unread says first — the rest names the later fact. */
const TAKEN_BACK_UNREAD = 'taken back by this app before it was read, because it was no longer true'

/**
 * ⚑ **How a question stopped waiting on an answer** — every ending a routed question can have, so an
 * ending cannot be added without its sentence. ⚠️ Each names the asker: the row is in the transcript
 * of the conversation the question was asked of.
 */
const WHY_A_QUESTION_NO_LONGER_WAITS: Readonly<
  Record<Exclude<RequestState, 'open'>, (asker: string) => string>
> = {
  answered: (asker) => `${asker}'s question had already been answered`,
  rejected: (asker) => `${asker}'s question had already been declined`,
  decided: (asker) => `${asker}'s request had already been settled`,
  withdrawn: (asker) => `${asker}'s question had been withdrawn`,
  abandoned: (asker) => `${asker} stopped, and its question went with it`,
  stranded: (asker) => `${asker}'s question was lost when this app stopped`,
  interrupted: (asker) => `${asker}'s question ended when its work was stopped`,
  'work-withdrawn': (asker) => `${asker}'s question was about work that had been taken back`,
  'work-closed': (asker) => `${asker}'s question was about work that had been closed`,
  'work-replied': (asker) => `${asker}'s question was about work that had been handed back`,
  'recipient-ended': (asker) => `this conversation stopped before it answered ${asker}'s question`,
}

/**
 * 🔴 **Why this app took back a question's notice unread: the question no longer waits on an
 * answer** — the notice would tell its reader to answer a question that is already over.
 * ⛔ A PERSON's sentence, as {@link aNoticeALaterFactRetracted}'s is: the model never sees the notice
 * it names.
 */
export function aQuestionNoticeALaterFactRetracted(
  ended: Exclude<RequestState, 'open'>,
  asker: string,
): string {
  return `${TAKEN_BACK_UNREAD}: ${WHY_A_QUESTION_NO_LONGER_WAITS[ended](asker)}`
}

/**
 * 🔴 **The lines that tell an owner which piece it is finishing** (412, `410` F1; the piece's LABEL
 * since D-016 · R4).
 *
 * ## ⛔ The defect, measured on both providers
 *
 * `410` F1: **a worker was never told the name it must quote.** The ledger carried it,
 * `reply_to_parent` demanded it, and the turn the model received was the giver's words alone — so the
 * only way to it was `list_tasks`, a tool the worker has to think to call. ⚠️ **Five refusals across
 * two providers**, and one piece Claude never answered. ⛔ **HO-009 §1 predicted the shape a month
 * before it was measured:** *"a worker that does not reliably call `reply_to_parent` with its task id
 * will fail in a way that looks like model flakiness rather than a missing instruction."*
 *
 * ## ⚑ Why it is composed HERE and not written into the factory text
 *
 * ⛔ **Standing rule 8**: factory text INSTRUCTS, and a fact about THIS conversation comes from
 * data. ⚠️ A piece's label is different on every brief, so it cannot live in a template at all, and
 * the dynamic layer is composed once per LAUNCH while this is once per BRIEF.
 *
 * ## ⚠️ What it deliberately does not contain
 *
 * ⛔ **No address, in any spelling.** HO-015 §1.3 — *"the model names which task it is finishing,
 * never who to send it to"* — and this module's own header is the rail that enforces it. A line
 * naming the giver would be `371`'s defect arriving as prose instead of as an argument.
 * ⛔ **It describes nothing** — not what a piece is, not where the reply goes, not what happens if
 * the owner stays silent. It names the label; the inputs its giver handed over, when there are any,
 * and the door that reads them (`read_document`); the two tools that finish or keep the work; and
 * the arguments each takes.
 *
 * ## ⛔ Two different strings leave `handToProvider`, and that is deliberate
 *
 * {@link messageWithHandedPaths}' rule, one subject over: **the provider gets this composition and
 * the LEDGER gets the giver's words alone.** Storing the composed string as the turn would make the
 * transcript render this app's sentence as something the giver wrote — `214`'s defect, which `216`
 * already refused from the attachment end.
 */
export function messageNamingThePiece(
  text: string,
  /**
   * ⚑ **The piece these words deliver, or `null`** — its label, and its inputs as they stand when
   * the words go out (D-016): the files its giver handed over, by id and name.
   */
  piece: {
    readonly label: string
    readonly definitionOfDone?: string
    readonly inputs: readonly { readonly resource: string; readonly name: string }[]
    /** ⚑ **W4.189 · the folder this piece grants its holder**, when it grants one. */
    readonly grant?: string
    readonly outputFolder?: string
  } | null,
): string {
  if (piece === null) return text
  const { label } = piece
  // 🔴 **Both verbs, because an owner that only knows one of them has only one way out** (437).
  //
  // ⛔ **This is the line `437`'s instruction had to go on, and `factory-text.ts` is not.** Standing
  // rule 8: *"where an agent must know a fact about the system, that fact comes from the DYNAMIC
  // layer, rendered from data — never asserted as prose in a template."* ⚑ Emitted only with a
  // piece, whose giver is the whole of how the app derives who `ask_question`'s `the-parent` reaches.
  //
  // 🔴 **608 · it does not say *and wait for the answer***: the verb returns as soon as the question
  // is routed, and a model told to wait would wait on a call that has already come back.
  //
  // 🔴 **611 · and it names `who_answers` beside the piece**: the verb refuses a call that does not
  // say who answers, so a sentence naming the verb and not the argument would walk a model into a
  // `malformed-request` on the one line this app renders to teach it the verb.
  // ⚑ **D-016 · its inputs, named where the piece is** — by id, the one door that reads them takes.
  const inputs = piece.inputs.length === 0 ? '' : `${resourcesSaid('Its inputs', piece.inputs)} `
  // Say that the conversation may also use the granted folder while the work is open. Its working directory has not moved, so paths in the granted folder must be written in full.
  const grant =
    piece.grant === undefined
      ? ''
      : `While it is open you may also work in ${piece.grant}: your working folder is unchanged, so write paths there in full. `
  const output =
    piece.outputFolder === undefined ? '' : `Put this piece's output in ${piece.outputFolder}. `
  const line =
    `This is piece ${label}. ${inputs}${grant}${output}Finish it by calling reply_to_parent with piece ${label}. ` +
    `If you need a decision before you can finish it, call ask_question with piece ${label} and ` +
    `who_answers — that keeps the work yours, where reply_to_parent hands it back.`
  const condition =
    piece.definitionOfDone === undefined ? '' : `Done when: ${piece.definitionOfDone}\n\n`
  return text.trim() === '' ? `${condition}${line}` : `${text}\n\n${condition}${line}`
}
