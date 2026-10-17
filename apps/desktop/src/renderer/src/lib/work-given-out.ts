import { agentName, type AgentIdentity } from '../../../shared/runtime-ipc'
import { walkCovers, type LedgerWalk } from '../../../shared/questions'
import { TASK_IS_OPEN, type WorkGivenOut } from '../../../shared/tasks'
import { agoWords } from './clock'
import { workReading, type WorkReading } from './work-report'
import { unreadSays } from './rows-unread'

/**
 * 🔴 **The work this conversation gave out, in words** (508, from `506` §1.4's refusal).
 *
 * ## Keep delegated work and its state visible
 *
 * > ⚑ *"in the right panel where we have the robot avatar, can we see the list of tasks opened by
 * > the agent and see their live status…?"*
 *
 * > ⚑ *"I don't see the list of tasks in the right panel where brobot avatar is, showing the tasks
 * > it assigned so far and their status etc.?"*
 *
 * `506` refused to build it and gave three reasons. Two of them are honoured here and the third is
 * the reason this file exists at all.
 *
 * ## ⛔ Where it lives, and why not in the panel the avatar is pinned to
 *
 * ⚠️ **The right panel is `SessionDrawer`, and the avatar is at the top of its OPEN tab.** That tab
 * is `SessionPanel`, whose founding sentence is *"It is a pure function of `TranscriptState` … and
 * it subscribes to nothing. That is the whole design."* ⛔ A polled band inside it is the
 * two-folds-disagreeing failure that comment exists to prevent, and `506` §1.4 named it.
 *
 * ⚑ **So the list is a SEVENTH TAB in the same drawer, one icon over from the avatar** — inside
 * the right panel a person was looking at, outside the projection that may not subscribe. ⚠️ And
 * the Open tab is not left silent about it: it reads ONE boolean and its empty column names where
 * the list is, which is `258`'s method exactly — *fold → words lib → a place that may subscribe →
 * a boolean the panel reads*.
 *
 * ⚠️ **547 corrected the second half of that sentence and not the first.** ⛔ The Open tab now
 * hosts a polled band of its own (`WorkingTogether`), so *outside the projection that may not
 * subscribe* is no longer why this list is a tab. ⚑ **It is a tab because it is a different
 * question** — what this conversation HANDED OUT, piece by piece, against who is around it — and
 * `547` §6 was told not to converge the two. See `SessionWork.vue`'s own corrected note.
 *
 * ## ⛔ Four rules this file is built to keep, and each one is somebody's scar
 *
 *  - ⛔ **Nothing here is computed from the words.** Every value is copied off {@link WorkGivenOut},
 *    which the store wrote from the fold; a renderer that read a state out of the prose would be a
 *    second reading of a fold it cannot see (`work-report.ts`'s own rule, and this file's reason
 *    for reading {@link workReading} rather than writing a second table).
 *  - ⛔ **One vocabulary, no call-site phrasing.** The state word, the cause sentence and the
 *    person-flag mark are {@link workReading}'s, which the transcript's work-report row already
 *    draws. ⚠️ A second `Record<TaskState, string>` here is the ordinary way two surfaces come to
 *    describe one fold differently — `222` §4, and `work-report.ts:72` already records what it cost
 *    to spell *"not being worked on"* twice.
 *  - ⛔ **Nothing here draws a negative it cannot stand behind.** {@link WorkGivenOutView.empty} is
 *    withheld whenever {@link WorkGivenOutView.doubt} is set, and {@link WorkGivenOutView.openCount}
 *    — the one signal that reaches the tab STRIP, where there is no room for a caveat — is absent
 *    rather than `0`. ⚑ `081`'s rule and `092`'s precedent, and the reason the strip may carry it
 *    at all is that it is a TALLY: `--muted`, never amber, never animated.
 *  - ⛔ **No liveness, of any shape.** {@link WorkGivenOut.state} is the PIECE's state, folded from
 *    events this app watched happen. `505` measured that `runningStateOf` can say who is WATCHING a
 *    conversation and nothing about whether it is making progress — *"a project manager that is
 *    working and one that has been wedged for forty minutes are the SAME ROW"* — so no field here
 *    is about the worker, and `484`'s lesson is that a field saying the wrong quiet thing is worse
 *    than one that admits it does not know.
 *
 * ## ⚠️ Which way this fails
 *
 * **Toward saying too little, and toward saying it late.** A piece that changed state moments ago
 * reads as it was at the last read until the next move of its work is pushed, and
 * {@link WorkGivenOutView.asOf} says how old a reading kept after a refused read is. A read that
 * did not answer keeps the last good rows and marks them; a read that answered with a walk word
 * this build cannot spell keeps its rows and withholds the sentence saying what was covered.
 * ⛔ **None of those is a false promise**, which is the direction that would matter: the failure
 * available here is a row that is stale or a list that is short by a number it states, never a row
 * claiming work is being driven when nothing is driving it.
 */

/** ⛔ **The ONE empty that is about the conversation**, rather than about this app or about a read. */
export const NOTHING_GIVEN_OUT = 'This conversation has not given anybody work'

/**
 * 🔴 **Why what is on this tab may not be what is in the database** — or `null`, no reason at all.
 *
 * ⛔ **Two causes, and a vocabulary rather than a flag**, because the two sentences below name two
 * different things. ⚠️ A
 * boolean would have made *the read did not answer* the only thing this tab could say, and one of
 * these two states is a read that answered perfectly well.
 */
export type WorkDoubt = 'the-read-did-not-answer' | 'a-word-this-app-cannot-spell'

/** ⛔ **Exhaustive**: a third cause fails to compile until somebody has decided what it says. */
export const WORK_DOUBT_WORDS: Readonly<Record<WorkDoubt, string>> = {
  'the-read-did-not-answer':
    'This list did not answer just now, so what is above is the last answer this window had. It is not a conversation that has given nobody work, and it is not a statement that nothing has changed since.',
  'a-word-this-app-cannot-spell':
    'This list came back describing a read this version of the app does not know how to explain, so the rows above are shown without the sentence that says what was covered.',
}

/** One piece of work this conversation gave out, as the tab draws it. */
export interface WorkGivenOutRow extends WorkReading {
  /** The piece's id — the row's key, and never drawn: its label is what a person reads. */
  readonly piece: string
  /**
   * 🔴 **Who it was given to** — {@link agentName}, the app's one naming function (`449`).
   *
   * ⛔ **Computed HERE from {@link WorkGivenOut.givenToProfile} and not carried on the wire**,
   * which is `467` §8.2's refusal: a display name on the row would be a second answer to *what is
   * this identity called*, free to disagree with the rail and the queue.
   *
   * ⚠️ **A cold or stale roster shows LESS and never nothing.** `agentIdentities()` is re-read
   * *"at mount and after a successful launch, and at no other time"* (`472` F3), so a conversation
   * an agent created since this window mounted is not in the roster — and `agentName` then falls
   * through to `profileLabel`, which is the identity's own slug. ⛔ That is why the id is resolved
   * in MAIN: a row here can always be named, and the brief's *"a row naming a task with no readable
   * agent name beside it is worse than no row"* has no reachable case left (a piece since D-016).
   */
  readonly who: string
  /**
   * The piece's TITLE, verbatim — never a summary, and never re-worded ({@link WorkGivenOut.title}:
   * the newest title, whoever set it). ⚑ One line by construction, bounded where it is given, so
   * it is drawn whole; an empty string draws nothing rather than a placeholder.
   */
  readonly said: string
  /** When it was handed out, in a person's words — `agoWords(givenAt, now)`. */
  readonly given: string
  /**
   * ⛔ **{@link TASK_IS_OPEN}, read and never re-derived** — the one predicate, as a table.
   *
   * 🔴 **Read through `Object.hasOwn`, and `??` would have been the bug `406`'s review found one
   * file over.** `TASK_IS_OPEN` is an object literal, so its prototype is `Object.prototype` and a
   * state naming one of its members — `constructor`, `toString`, `valueOf` — indexes to a
   * FUNCTION, which is neither `null` nor `undefined` and is TRUTHY. ⚠️ A `??` here would have
   * counted such a row as open and put it in the tally on the strip. ⛔ Reachable rather than
   * defensive: `toPersistedEvents` CASTS and a `.brobot` bundle is written through
   * `.passthrough()`, so a state this vocabulary has never heard of is bytes on disk.
   *
   * ⚑ **Unknown counts as CLOSED**, which is the fail-quiet direction: the tally is a claim that
   * something is still owed, and a row this app cannot classify is not evidence for it.
   */
  readonly open: boolean
}

/**
 * 🔴 **The tab, before any row.**
 *
 * ⚠️ **`says` is `null` only when this build cannot spell the walk it was handed** — `467` F7 —
 * and {@link doubt} then carries the reason.
 */
export interface WorkGivenOutView {
  readonly rows: readonly WorkGivenOutRow[]
  /**
   * ⛔ **How many of them are still somebody's to finish, or `null` when none are.**
   *
   * 🔴 **The ONE thing this tab may put on the tab strip** (`092` §2's rule, inherited): a
   * `--muted` tally on its own icon, and nothing else. ⚠️ Work being open is not a question, so it
   * may not light the drawer toggle badge, raise the attention bar, dot any tab, animate or touch
   * the top bar — the amber channel stays the attention channel's alone.
   *
   * ⛔ **Absent, never `0`** — `081`'s rule, and here it is also the fourth rule of
   * `scheduled-work.ts`: a strip has no room for the sentence that would make a zero mean
   * something, so an absent tally is the only honest empty it can draw.
   */
  readonly openCount: number | null
  /** ⛔ `walkCovers(walk)` — what the read COVERED, said once for the tab and never per row. */
  readonly says: string | null
  /**
   * {@link NOTHING_GIVEN_OUT}, or `null` — every other empty is a statement about something else.
   *
   * ⛔ **Withheld whenever {@link doubt} is set.** *This conversation has not given anybody work*
   * and *this list did not answer just now* are two sentences that deny each other, and both are
   * reachable at once: a conversation that has given nobody work keeps its empty list across a
   * refused poll and gains the mark. ⚠️ Two things on one screen disagreeing is `304`.
   *
   * ⚑ **A tab DOES draw this empty, unlike `ScheduleBar`, and the difference is the surface.** A
   * bar that does not render makes no claim; a tab a person deliberately opened and found blank
   * reads as *a panel that failed to load* — `067`'s own finding, which
   * {@link PANEL_EMPTY_WORDS} exists to answer one tab over.
   */
  readonly empty: string | null
  /**
   * ⛔ **Ledger rows the walk could not read, so this list is SHORT by an amount only this number
   * can say** — ⚠️ **678 · or a row it DOES draw is in the wrong state**: since `671` the walk counts
   * a torn row it met while composing a task's state, too. ⚠️ Not a count of rows found: an unread
   * ledger row usually folds into no row at all, so this and {@link rows} do not add up to anything
   * and must not be drawn as if they did.
   */
  readonly unread: number
  /**
   * ⚑ **678 · the sentence for {@link unread}** — `unreadSays`, one for every surface, with D-017's
   * records skipped whole; `null` when there is nothing to say.
   */
  readonly short: string | null
  /** 🔴 Why the list may not be current, or `null`. See {@link WorkDoubt}. */
  readonly doubt: WorkDoubt | null
  /**
   * 🔴 **How old this reading is, in a person's words** — `agoWords(reading.at, now)`.
   *
   * ⛔ **`null` while the newest read answered** (W4.74, D-033): the list is read again on every
   * move of its work, so an answered reading is the current one whatever its age, and an age under
   * it would say *stale* about a list that is not. ⚑ Said for rows KEPT after a read that did not
   * answer — the ones that may be behind.
   */
  readonly asOf: string | null
}

/**
 * 🔴 **One answer, and the conversation it is ABOUT.**
 *
 * ⛔ **The conversation is on the reading and is never assumed from the surface.** A person can
 * open conversation A and then B inside one round trip; without this the kept-last-good list would
 * draw A's work under B's drawer, which is the strongest false claim this tab could make.
 */
export interface WorkGivenOutReading {
  readonly conversation: string
  /** ⚑ The host's whole answer — the walk, and the rows it found. */
  readonly walk: LedgerWalk<WorkGivenOut>
  /** Whether the MOST RECENT read for this conversation answered (`434`'s distinction). */
  readonly answered: boolean
  /**
   * 🔴 **The instant this list was ASKED for, and every age on it is measured from here.**
   *
   * ⛔ **Stamped when the question goes out, never when the answer lands** — the read is a round
   * trip and a stamp taken after it over-states how fresh the list is by exactly that trip.
   */
  readonly at: number
}

/** Everything the fold reads. Plain data, so it can be asserted with no renderer at all. */
export interface WorkGivenOutInput {
  readonly reading: WorkGivenOutReading | null
  /** The conversation the SURFACE is showing. */
  readonly forConversation: string
  /** ⚑ `null` until the identities read lands — a cold window names every row by its slug. */
  readonly identities: readonly AgentIdentity[] | null
  /** The live instant ages are measured against. ⛔ A minute clock, never a mount-time constant. */
  readonly now: number
}

/**
 * ⛔ **The whole tab, from the reading and nothing else** (508).
 *
 * Pure and total. ⚑ `null` is *nothing has been read for this conversation yet* — a state the tab
 * draws as neither rows nor an empty sentence, because it has not asked a question yet and an
 * answer about a question nobody asked is the claim `434` spent a dispatch removing.
 */
export function workGivenOutView(input: WorkGivenOutInput): WorkGivenOutView | null {
  // ⛔ **`?? null`, and it is not belt-and-braces — it was found by the suite.** `SessionDrawer`
  // declares `work` as `WorkGivenOutReading | null`, so a mount that OMITS it type-checks and
  // passes `undefined` at run time, and seventeen render files do exactly that. ⚠️ The reading rule
  // is `074`'s either way — *nothing declared is nothing to say, whichever shape the nothing
  // arrives in* — and `ConversationPane`'s `capabilities` comment records the same discovery one
  // prop over. ⛔ Without this the computed THREW and took every one of those mounts down.
  const reading = input.reading ?? null
  if (reading === null || reading.conversation !== input.forConversation) return null

  const says = walkCovers(reading.walk.walk)
  // ⛔ **Order matters and the first arm wins**: a read that did not answer is a fact about THIS
  // poll, while an unspellable word is a fact about the answer it gave. A refused read leaves the
  // previous answer's word standing, so asking the word first would report the older problem.
  const doubt: WorkDoubt | null = !reading.answered
    ? 'the-read-did-not-answer'
    : says === null
      ? 'a-word-this-app-cannot-spell'
      : null

  const rows = reading.walk.rows.map((row) => rowOf(row, input))
  const open = rows.filter((row) => row.open).length

  return {
    rows,
    openCount: open === 0 ? null : open,
    says,
    // ⛔ **678 · and never *"has not given anybody work"* over rows it could not read** — the same
    // guard `working-together.ts` puts on the child list (547): the line under this one says a piece
    // of work may be MISSING, and this one would say there is none. Found by `678`'s scout.
    empty:
      doubt === null &&
      rows.length === 0 &&
      !(reading.walk.rowsUnread > 0) &&
      // ⚑ **D-017 · R8** — nor over a record it skipped whole.
      !((reading.walk.ledgersSkipped ?? 0) > 0)
        ? NOTHING_GIVEN_OUT
        : null,
    unread: reading.walk.rowsUnread,
    short: unreadSays(reading.walk.rowsUnread, reading.walk.ledgersSkipped),
    doubt,
    asOf: reading.answered ? null : agoWords(reading.at, input.now),
  }
}

function rowOf(
  row: WorkGivenOut,
  input: Pick<WorkGivenOutInput, 'identities' | 'now'>,
): WorkGivenOutRow {
  return {
    // ⛔ **The words are `workReading`'s, spread rather than re-picked**, so a field it gains
    // reaches this row with no edit here — and a field it loses breaks this file rather than
    // leaving a template printing nothing. ⚑ `WorkGivenOut`'s first five fields are
    // `WorkReport`'s, absences and all, which is what makes this call legal at all.
    ...workReading(row),
    piece: row.piece,
    who: agentName(row.givenToProfile, input.identities ?? null),
    said: row.title,
    given: agoWords(row.givenAt, input.now),
    open: Object.hasOwn(TASK_IS_OPEN, row.state) && TASK_IS_OPEN[row.state],
  }
}
