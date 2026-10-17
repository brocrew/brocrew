import { whoCancelledIt, type AskToStop } from './how-work-stopped'
import type { PersistedEventInfo, TranscriptEvent } from './runtime-ipc'
import { aPersonsOwnWords } from './a-persons-own-words'
// ⚑ **A TYPE and nothing else** (467), so this module's own rule survives the import: it cannot
// reach a database, a host, a clock or a filesystem, and an edge that is erased at build time
// cannot give it one. ⚠️ `questions.ts` does not import this file, so the checker sees no cycle.
import type { WorkInHand } from './questions'
import type { HowAPieceEnded, WorkThatNamesIt } from './piece-called'
import type { GivenFolder } from './work-folders'
import type { ModelAndEffort } from './model-choice'

/**
 * 🔴 **Piece rows, DERIVED — and the module that could not store one if it wanted to** (379 as
 * tasks, HO-007 S1 + criterion 2; pieces of work since D-016).
 *
 * ## ⛔ Criterion 2 is a property of this file's imports, not of a test
 *
 * HO-007 criterion 2 is *"task state is derived, never stored — drop the index, rebuild from the
 * ledger, identical rows."* ⚑ **D-016 kept it for pieces**: the `work` table holds what a piece IS —
 * its parent, number, owner, giver, title and brief as given — written once, in the same transaction
 * as the {@link WorkGivenEvent} that opens it, and never updated. ⛔ **Everything that HAPPENS to a
 * piece is a row in its OWNER's ledger**, and its state is folded from those rows here and stored
 * nowhere: there is no state column.
 *
 * ⛔ **This module imports types and nothing else.** It cannot reach a database, a host, a clock or
 * a filesystem, so *"the rows are a function of the ledger"* is checked by the compiler on every
 * build rather than by a test that has to remember to drop something.
 *
 * ## ⚑ What `393` added, and what it did NOT
 *
 * ⛔ **{@link PieceRow.outcome} exists, and only `reply_to_parent` fills it.** `379` left it out
 * because *"a nullable field that no code path can fill would be an option with no acceptance
 * case"*; S2 is the code path, so the field arrived with the thing that produces it and with
 * `answered` as the state it puts work into. ⚑ **Still no state column**: the outcome is on
 * {@link WorkRepliedEvent}, a ledger row like the give.
 *
 * ## ⛔ A root is never a row here (D-016 · R1)
 *
 * ⚑ **A conversation with no parent owns a root, and no give opens it**, so no `work_given` names it
 * and {@link derivePieces} can never open one. ⛔ A root's state is its conversation's; its title
 * and status line are read off its rows by the store, and its children are its own pieces' rows.
 *
 * ⚑ **D-016 · commit 6 · what a root's owner takes on for the person IS a row** — a piece under the
 * root, given by the person ({@link PieceRow.giver} `null`), opened by its own `work_given`
 * (`take_on_work`). ⛔ When its owner's turn ends with it open it waits on the person who asked
 * (`waiting-on-the-person-who-asked`), and never stalls on that turn: nobody is owed word of it.
 *
 * ## 🔴 One word for *nothing is driving this*, and the two it replaced (400, HO-018 §2)
 *
 * ⛔ **HO-018 amended criterion 4 to a property — *nobody waits forever in silence* — and withdrew
 * criterion 5 outright.** Between them those two rulings left `393`'s `silent` and `398`'s `stalled`
 * describing one observation, so one of them had to go.
 *
 * ⚠️ **They really were one observation, and the retraction is what made them one.** `393`'s
 * `silent` fired when a turn ended with the task still open; `398`'s `stalled` fired when a silence
 * window passed with no ending at all. ⛔ **HO-018 §2.2 took the window away** — *"an idle timeout on
 * a working child is the guess, and your measurement says we cannot pick the number honestly"* — so
 * the only surviving producer of *nothing is driving this work* is the turn ending, which is exactly
 * what `silent` already was. ⚑ Two words, one producer, is the vocabulary rot `395` spent a dispatch
 * undoing and `397` refused to extend.
 *
 * 🔴 **{@link TaskState.stalled} survives and `silent` is retired**, and the reason is not that the
 * PO named it:
 *
 *  - **`silent` is a claim about the CHILD'S MANNERS** — *it reached an ending and said nothing.*
 *    ⛔ That is false about two of the three things that now produce this state. A child whose turn
 *    somebody STOPPED was not silent; it was cut off. A child whose app was KILLED was not silent
 *    either, and it never even got the chance.
 *  - **`stalled` is a claim about the WORK** — *nothing is driving this* — which is true of all
 *    three, and it is the fact a parent acts on. ⚑ HO-018's own principle is that the parent
 *    decides; the word it decides from should describe the thing it decides about.
 *  - ⚠️ **And the reason it was ever two words is now written down**: {@link PieceRow.stalledBecause}
 *    carries the observation, so *which* of the three happened is a field rather than a second state
 *    name — `397`'s ruling (the actor on a neighbouring row, never inside the word) pointed at a
 *    cause instead of an actor.
 *
 * ## ⛔ Nothing here becomes terminal that the engine did not watch finish
 *
 * ⚑ **HO-018 §2's principle, and it is the thing to check a diff against.** ⛔ **Every state that
 * closes a piece is somebody DECIDING**: `answered`, the agent saying how it went; `withdrawn`, the
 * parent taking the work back; and `closed`, the parent ending the work without a reply (D-016).
 * ⚠️ **`abandoned` is gone from this vocabulary altogether** — it was reached by a quit and by a
 * conversation ending, and HO-018 §2.3 says neither of those tells us anything about the work.
 * ⛔ **The REQUEST vocabulary keeps its own `abandoned`, untouched and asserted to be untouched**,
 * which is `398` §3's measurement honoured rather than repeated: two vocabularies, one word, two
 * meanings, and only one of them moved.
 *
 * ## ⛔ The only way back to `working` is a row that says the work was HANDED OVER
 *
 * ⚠️ **`398` had another, because a TIMER can be wrong**: a provider that was merely slow came back,
 * and a `work_quiet: 'ended'` row undid a stall the clock had guessed at. ⛔ **Nothing here is a
 * guess any more**, so there is nothing of that kind to undo: every stall is an event the app
 * watched, and none of them un-happens.
 *
 * ⚑ **And the signal that would have done it does not say what it would need to say.** *This
 * conversation has started a turn* (`status: working`) is a fact about the CONVERSATION; *this task
 * is being worked on again* is a fact about one of possibly several tasks it holds, and the ledger
 * does not contain it. ⚠️ Using the first to assert the second is one word answering two questions,
 * which is `395`'s ruling — and it is measurable: a child given a SECOND piece of work would have
 * had the first one silently reported as driven again by the turn that started on the second.
 *
 * ⚠️ **648 · this heading said *there is no way back to `working`* and the fold has one.**
 * ⛔ `message_unqueued: 'sent'` moves an open task to `working` and clears its cause, and it is
 * right to: that row names ONE message, the message names ONE task, and *this task was handed over*
 * is precisely the fact the paragraph above says the ledger does not contain — except on that row,
 * where it does. ⚑ **The rule survives the correction and is sharper for it**: a task leaves
 * `stalled` only on a row about THAT TASK, never because a condition around it changed.
 *
 * ⚠️ **D-005 added a row that starts its OWNER's turn** — the owner already holds the work, and the
 * turn it runs is what drives it ({@link ITS_OWNER_RUNNING_AGAIN_DRIVES_IT}). 🔴 **D-016 · commit 6 ·
 * R4 — and that row drives only the piece it names where it names one**: a brief, a new brief or
 * any other words about a piece drive that piece — or, for words about work under it, the piece of
 * the owner's that work hangs under — and no other, so a turn started on a second piece never
 * reports the first as driven. ⚑ A delivery that names none (a person's words, a note about nothing)
 * drives every open piece, because nothing on it says which; so does a `status: working` whose
 * turn's row has not come yet, until it comes — a wake has none.
 *
 * ## ⚠️ And it still reads no clock
 *
 * ⛔ **Every transition below comes from an event the engine OBSERVED**: a turn ending, a launch
 * running, a message being taken back, a request being closed. ⚑ `396` §4's ruling is kept rather
 * than worked around — what it forbids is a fold that infers failure from silence, and there is now
 * nothing anywhere in the app that infers anything from silence about a working child.
 *
 * ⚑ **D-016c · a stop and a start say nothing about a piece** (`05`: an agent is never dead). A
 * conversation's process stopping is no cause of its own — it ends the drive it cut, as an
 * interrupted turn does — and a reopen moves nothing.
 */

/**
 * 🔴 **Every state a task can be in, as data** (379).
 *
 * ⛔ **A closed list because {@link TASK_IS_OPEN} is keyed by it**, so another state cannot be added
 * without deciding whether it is open — the shape `an-unenumerated-state-counts-as-success` exists
 * to force. ⚠️ A `for (const s of ['waiting','working'] as const)` in a test is NOT exhaustive over
 * this; loop over this constant so the tables and the loops gain a member together.
 *
 * ⚑ **This is not a planned ladder of task states and does not pretend to be.** One such ladder,
 * `PROPOSED → APPROVED → DRAFTED → READY → DISPATCHED → RUNNING → …`, needs above `DISPATCHED` a
 * proposal surface nobody has built. ⚠️ **`393` supplied the one below `RUNNING` that was
 * waiting on S2's reply** and named it `answered` rather than borrowing a rung of that ladder,
 * because the ladder's lower half also carries a review step nobody has built. **These are the
 * states an EVENT can put a task into today, and no others are claimed.**
 */
export const TASK_STATES = [
  'waiting',
  'working',
  /**
   * 🔴 **The worker asked the conversation that gave it this work a question, and nobody has
   * answered yet** (603 as `asking`, renamed by 609 · HO-018 §2.1 · HO-085 · HO-091 §1).
   *
   * ⛔ **OPEN, and for the same reason `stalled` is**: the work is still somebody's to finish.
   * ⚑ HO-018 §2.1 — *"`stalled` is a condition on an open task, never a terminal state"* — is the
   * sentence this member is built on, and `HO-085` §6 is where *a condition distinct from its
   * lifecycle* was read as OPEN rather than as NOT-A-STATE.
   *
   * ## ⚠️ 609 · it was called `asking`, and the rename is the family rather than a preference
   *
   * ⛔ **`asking` named what the agent DID; its two new neighbours name what it is WAITING ON**, and
   * a vocabulary whose members answer two different questions is the rot `395` spent a dispatch
   * undoing. ⚑ **The word a PERSON reads did not move** — `WORK_STATE_WORD` has said *waiting on an
   * answer* since `603` — so this rename brings the state name to the word rather than the reverse.
   * ⚠️ **Nothing durable spelled `asking`**: it is COMPOSED and no {@link WorkReport} producer can
   * write it (`workAnswered` and `workUndriven` are the only two), so no ledger anywhere holds the
   * old string and there is nothing to migrate.
   *
   * ## ⛔ It is keyed to THIS piece, and the most specific of the waits
   *
   * 🔴 **`ask_question` names a piece**, so `question_asked` names the work and
   * {@link openQuestionsByWork} groups by it. ⚠️ A permission carries no piece at all, so the wait
   * on a person cannot be keyed; the wait on a worker is keyed too since D-016, but it says only that
   * work is OUT, where this one says the reader owes an answer. ⛔ **That is why this one wins the
   * precedence** — see {@link composeWhatEachPieceIsWaitingOn}.
   *
   * ## ⛔ It is COMPOSED and never folded, and that is `400`'s rule kept rather than relaxed
   *
   * ⚠️ **{@link derivePieces} cannot produce this state and must not learn to.** `400`, at the
   * fold's own `travelled` set: *"Ids only: what became of each one is `deriveRoutedRequests`' answer
   * and this fold must not grow a second opinion about it."* ⛔ Whether a question is still open is
   * that answer, so the join lives ABOVE the fold — {@link composeWhatEachPieceIsWaitingOn} — where
   * both derivations are in hand. ⚑ `474`'s precedent, one surface over.
   *
   * ## ⚠️ Why it is none of its neighbours
   *
   *  - **not `working`** — true of the piece and useless to the giver, which is being told *a child
   *    is busy* about a child waiting on IT. ⛔ That is the sentence `HO-019` §1 is about.
   *  - **not `stalled`** — that word is a positive observation that nothing is driving the work,
   *    and something is: an answer. ⚑ {@link TaskStallCause} has no member for this and must not
   *    gain one; a cause says what the ENGINE observed stopping the work, and here nothing stopped.
   *  - **not `answered`** — nobody has replied, and `answered` is closed.
   *  - ⚠️ **and not the bare `waiting` two lines up**, which is a piece whose BRIEF is still in a
   *    mailbox. ⛔ Two different nothings; the `-on-` in these is what tells them apart, and
   *    {@link TASK_WAITS} derives itself from exactly that prefix rather than from a second list.
   */
  'waiting-on-an-answer',
  /**
   * 🔴 **This conversation raised something only a PERSON can settle, and nobody has** (609,
   * HO-088 §3.1's subject read the other way round).
   *
   * ⛔ **One fact about who may act.** A permission-shaped routing —
   * {@link RequestOnlyAPersonCanSettle}, every member of `ChannelRefusal` and not just the one the
   * briefs talk about. ⚑ It is raised by the conversation HOLDING the work, it is open in the
   * ledger, and the next move is a person's.
   *
   * ## ⚠️ It is a claim about the CONVERSATION, applied to the work it holds — and that is stated
   *
   * ⛔ **A permission names no piece** — `430` measured that a provider-raised question identifies
   * its request and its parent and NOT the work, and {@link RaisedQuestion.piece} is `null` for it
   * for ever. ⚑ **So this cannot be narrowed to one row and does not pretend to be**: every open
   * piece the conversation holds reads it, because the conversation is what is waiting. ⚠️ The
   * alternative was to invent a join the ledger does not contain, which is
   * *a derivation answering what its ledger does not hold*.
   *
   * ## ⛔ Why it is not `stalled`, which is what it read as until now
   *
   * ⚑ **A card on a person's screen is not *nothing is driving this work*.** ⚠️ A provider parks
   * the turn on a permission, and a surface that said `stalled` about work whose only blocker is a
   * decision nobody has made would be the false sentence `HO-019` §1 names, arriving through the
   * person's door instead of the parent's.
   *
   * ## ⚠️ Why it is NOT escalation
   *
   * ⛔ **{@link RoutedRequest.escalatedAt} does not reach this state and must not.** A question
   * routed to the parent that becomes a person's *"without anything about the work changing"* keeps
   * reading `waiting-on-an-answer` — ⚑ which is `603`'s own argument for not naming a state after
   * who owes the answer, kept rather than quietly reversed here.
   */
  'waiting-on-a-person',
  /**
   * 🔴 **This piece handed work out, and that work is still open** (609, HO-088 §5.1; per piece
   * since D-016).
   *
   * ⛔ **READ from the hand-over rows, never concluded from a child's state.** A piece given under
   * this one records it as its {@link PieceRow.parent}, and that fact was written at HAND-OVER.
   * ⚑ {@link TASK_IS_OPEN} over the rows of the pieces this conversation gave, keyed by their parent,
   * is the whole derivation and there is nothing to infer.
   *
   * ## 🔴 The PO ruled against the other way of getting here, and the reasons are measurable
   *
   * ⚠️ **Deriving it from whether the CHILD looks idle was proposed and refused:**
   *
   *  - ⛔ **a child idle because it FINISHED, because it CRASHED, and because it is waiting on a
   *    person are three different situations** — and the giver's state differs in each, while the
   *    idleness looks identical;
   *  - ⛔ **a giver genuinely waiting on a child that is mid-tool-call would not register at all.**
   *
   * ⚑ **An inference here would be this product's first**, and `HO-088` §5.1 is a standing ruling
   * against exactly that instinct.
   *
   * ## ⚠️ Nobody has to move, and that is what makes it the LAST the composition says
   *
   * ⛔ **It is the one wait with no addressee.** An answer is owed by the reader of the row; a
   * decision is owed by a person; this one is owed by nobody — the work is simply out. ⚑ So when
   * more than one is true, this is the one worth saying least, which is the precedence
   * {@link composeWhatEachPieceIsWaitingOn} holds.
   *
   * ## 🔴 What it takes away, said plainly, because it is a real cost
   *
   * ⛔ **A piece in this state is no longer `stalled`, so nobody is pushed *its turn ended with
   * this work still open* about it** — {@link stalledWithACause} answers `false`. ⚠️ **The notice
   * is not lost; it MOVES to where the work actually stopped**: the child's own row stalls, and the
   * conversation that gave THAT piece out is told about it. ⛔ A chain that goes quiet is reported at
   * its broken link rather than at every link above it, which is the whole point of reading the
   * hand-over rather than the idleness.
   *
   * ## ⚑ D-016 · it is THIS piece's fact, and its siblings do not read it
   *
   * ⚠️ **Until D-016 nothing joined a child's work to the work it was subdivided from**, so this wait
   * was the conversation's and every open task it held read it — and one task's open child silenced
   * its siblings' stalls (design notes §4). ⛔ **A piece records its parent now**, so only the piece
   * a child hangs under reads it, and a sibling whose turn ended with nothing out still stalls.
   */
  'waiting-on-a-worker',
  /**
   * 🔴 **D-016 · commit 6 · R3 — a piece a PERSON gave, left open by a turn that person's own
   * words opened and that ended on its own, with nobody asking it to stop** — the window's *waiting
   * on you*. ⚑ Any other drive ending stalls it, with its cause: a person owes nothing they were
   * not asked in their own turn.
   *
   * ⛔ **OPEN, and NOT `stalled`**: nothing stopped it that anybody is owed word of — the person who
   * asked is the one it waits for, and they read it in their own conversation. So it has no cause
   * ({@link PieceRow.stalledBecause} stays null), raises no notice and no band row, and refuses no
   * give.
   *
   * ## ⚑ FOLDED — one of the two waits that are (F097's is the other)
   *
   * ⚑ {@link derivePieces} writes it where such a turn ends with the piece open, over a piece whose
   * giver is `null` ({@link A_TURN_THAT_ANSWERED_A_PERSON_ENDS_ON}). ⛔ It is the fold's own observation (the drive ending, the
   * row's giver), not a second opinion about another derivation, which is why `400`'s rule does not
   * keep it out. ⚠️ **The composition still reads over it**: a question it asked, a card a person
   * owes, or a piece it gave out that is still open is the more specific wait, and is said instead
   * ({@link composeWhatEachPieceIsWaitingOn}).
   *
   * ⚑ **Left by any delivery that drives it** — the person writing, words naming it, a child's reply
   * about work under it (R4) — back to `working`. ⛔ **Never a conversation's wait**: it is said on
   * the piece only ({@link ConversationWait}).
   *
   * ⚠️ **Other causes may still stall such a piece** — a launch finding it mid-turn
   * (`app_restarted`), a replacement (`could_not_be_reopened`) — and nobody is told of those either
   * ({@link aStallItsGiverCanBeToldOf}).
   */
  'waiting-on-the-person-who-asked',
  /**
   * The holder answered a person and left the given piece open, so it waits on that person's
   * next words. Informational notes preserve this wait. A substantive delivery or the holder
   * explicitly working the piece drives it again; a reply, close or take-back ends it.
   * The giver keeps waiting on the holder and receives no stall notice for this state.
   */
  'waiting-on-the-person-who-wrote',
  /**
   * Its holder or giver marked it as waiting on purpose, with a status line saying what for. It
   * reads so instead of `working` or `stalled`, and a turn's end does not stall it, until a new
   * brief, a follow-up naming it, or a status line without the mark. Said on the piece only.
   */
  'waiting-on-purpose',
  /**
   * 🔴 **Nothing is driving this work, and the engine saw what stopped driving it** (400,
   * HO-018 §2 · criterion 4).
   *
   * ⛔ **An OBSERVATION, never a guess, and never a timer.** It is entered when a drive ends with
   * the work open — a turn ending or being interrupted, a wake going idle, or a stop cutting either
   * — over a piece a conversation gave (one a person gave waits on them instead,
   * `waiting-on-the-person-who-asked`), when a launch finds work nobody handed over, when a held
   * message ends without going out, and when the conversation holding it is replaced;
   * {@link PieceRow.stalledBecause} says which cause it was. ⚠️ **Stated without a count**: a count of producers a roster can outgrow is the hazard
   * rule 25 is about. ⚠️ **There is no window and no deadline**:
   * HO-018 §2.2 withdrew the criterion that had one, and `398`'s measurement is the reason (a
   * known-successful compaction was silent for **~90,829 ms** against a measured maximum of
   * **7,058 ms** in the same run — `00-slice4-measurements.md` §2, `n=16`).
   *
   * ## 🔴 OPEN, and that is the ruling this state carries
   *
   * ⛔ **A condition on an open task, never a terminal state** — HO-018's words, and its principle:
   * *the engine never terminally closes work it did not observe finishing.* ⚑ `393`'s rule is that a
   * second reply to one task is a permanent refusal, so a task CLOSED here could never be answered
   * — and every one of those producers is a moment at which a child may still have more to say.
   *
   * ⚑ **So a late reply still lands as `answered`.**
   *
   * 🔴 **648 · this paragraph ended *"but nothing puts it back to `working`"* and the fold beside it
   * does exactly that.** ⛔ `message_unqueued: 'sent'` moves any open task to `working` and clears
   * the cause — the branch is eight lines above the one that stalls on `'abandoned'` — so the
   * sentence was false rather than merely narrow. ⚠️ **The reason it never showed is that the two
   * cannot meet today**: a held message is ended by every path that stalls its task, so no fold has
   * yet had a `stalled` row whose message then went out. ⚑ **What survives is the RULE, and it is
   * the one 648 leans on**: a task returns to `working` only when a row in the ledger says the work
   * was actually handed over — never because a condition around it changed.
   *
   * 🔴 **D-005 · and a second row says it: a delivery that starts its owner's turn and names this
   * piece, or names none** (commit 6 · R4; a `status: working` whose turn's row has not come yet
   * drives every piece until it does) — for a stall where the owner already holds the work
   * ({@link ITS_OWNER_RUNNING_AGAIN_DRIVES_IT}). ⛔ F019: without it an owner woken by its last
   * helper's reply read `stalled` for its whole wake turn, and its giver was told so.
   *
   * ## ⚠️ Why it is not `abandoned` or `withdrawn`
   *
   *  - **not `abandoned`** — the conversation did not end. It is there, it is resumable, and asking
   *    it to carry on is exactly the right thing to do.
   *  - **not `withdrawn`** — nobody took the work back.
   *  - **not `working`** — `working` is the ABSENCE of a reason to say otherwise, and this is a
   *    positive observation with a moment attached. A parent reading *"working"* about work nothing
   *    is driving is being told the opposite of what happened.
   *
   * ⚠️ **`silent` was the old name for one third of this** and is gone; the module docblock argues
   * which word survived and why.
   */
  'stalled',
  'answered',
  /**
   * 🔴 **The parent took the work back** (429, HO-023 §5 + §4.3).
   *
   * ⛔ **CLOSED, and it was closed before this dispatch — what `429` added is a DOOR onto it.**
   * ⚠️ Until then the only producer was `message_unqueued` with `reason: 'cancelled'`: a parent
   * cancelling a message that was still in a mailbox. ⛔ **That reaches the WORDS and not the
   * WORK** — `folding-one-derivation-leaves-its-neighbour` — so a task whose message had already
   * been sent could not be taken back by anything, and a `stalled` task nothing would ever answer
   * held its receiver's work slot for ever.
   *
   * ⚑ **{@link WorkTakenBackEvent} is the second producer** (`task_withdrawn` until D-016), and the
   * two agree by construction rather than by care: both reach {@link TASK_IS_OPEN}`.withdrawn ===
   * false` through the same `settle`, and whichever arrives first makes the other a no-op over a
   * piece that is no longer open.
   *
   * ⛔ **It is a claim about the WORK and never about the conversation.** Taking a piece back does
   * not delete a session slot or end provider work by itself (`422` §4). ⚑ An owner that is mid-turn
   * on it keeps running, and is told; what it may no longer do is answer, which is the reply rails'
   * ended-piece arm.
   */
  'withdrawn',
  /**
   * 🔴 **D-016 · the giver ended the piece without a reply** — `update_work`'s close, folded from
   * {@link WorkClosedEvent}.
   *
   * ⛔ **CLOSED, and a decision as `answered` and `withdrawn` are**: the one that gave the work
   * decided it is no longer wanted.
   *
   * ## ⚠️ Why it is none of its neighbours
   *
   *  - **not `answered`** — nobody replied, and a closed piece carries no outcome.
   *  - **not `withdrawn`** — taking a piece back says the work is no longer owed by THIS owner, and
   *    it may be given again; closing it says the work itself is ended by the one that gave it.
   *
   * ⛔ **A claim about the WORK and never about the conversation**, `withdrawn`'s rule: an owner
   * mid-turn on it keeps running and is told to stop; what it may no longer do is reply, set its
   * status line or be given a new brief.
   */
  'closed',
] as const

export type TaskState = (typeof TASK_STATES)[number]

/**
 * 🔴 **The waits, DERIVED from {@link TASK_STATES} and never listed a second time** (609).
 *
 * ## ⛔ Why a template-literal type and not a second array
 *
 * ⚠️ **A hand-written second list is the drift hazard this repo has measured twice** —
 * `an-enumeration-whose-members-must-differ-needs-a-distinctness-check`, and
 * `a-hook-family-must-be-built-from-a-template-literal` is the shape that fixed it last time.
 * ⛔ A `waiting-on-…` member added to {@link TASK_STATES} joins this type, its runtime roster and
 * {@link WAITING_STANDS_FOR} in the same edit, and cannot be added to one and forgotten in the
 * others — as `waiting-on-the-person-who-asked` did (commit 6).
 *
 * ⚑ **The `-on-` is load-bearing and that is deliberate.** The bare `waiting` member — a task whose
 * MESSAGE is still in a mailbox — is not a member of this family and must not become one:
 * `'waiting'.startsWith('waiting-on-')` is false, which is the whole guard.
 *
 * ⚠️ **This is a SUBSET and not a second vocabulary.** Every member is a {@link TaskState}, every
 * member is {@link TASK_IS_OPEN}, and every surface meets all of them through `HO-091` §1's one
 * composition — which writes all but two of them, the two the fold writes beneath it (commit 6,
 * F097).
 */
export type TaskWait = Extract<TaskState, `waiting-on-${string}`>

/** ⚑ **The same waits as data**, filtered out of {@link TASK_STATES} rather than retyped. */
export const TASK_WAITS: readonly TaskWait[] = TASK_STATES.filter((state): state is TaskWait =>
  state.startsWith('waiting-on-'),
)

/**
 * ⛔ **Is this state one of the waits, as a guard a reader can narrow on** (609).
 *
 * ⚑ **One spelling of the prefix test**, so a surface deciding whether to print the fact behind the
 * word and {@link TASK_WAITS} cannot come to two answers about a state.
 */
export function theWaitIn(state: TaskState): TaskWait | null {
  return state.startsWith('waiting-on-') ? (state as TaskWait) : null
}

/**
 * ⚑ **D-016 · commit 6 · the waits a CONVERSATION can be in** — every wait but the two the fold
 * writes when an owner's turn ends with a piece open — on a piece a person gave, or (F097) one whose
 * turn a person's words opened — which are said on the piece only (plan ruling 9).
 */
export type ConversationWait = Exclude<
  TaskWait,
  'waiting-on-the-person-who-asked' | 'waiting-on-the-person-who-wrote' | 'waiting-on-purpose'
>

/** ⚑ The same, as data — filtered out of {@link TASK_WAITS}, never retyped. */
export const CONVERSATION_WAITS: readonly ConversationWait[] = TASK_WAITS.filter(
  (wait): wait is ConversationWait =>
    wait !== 'waiting-on-the-person-who-asked' &&
    wait !== 'waiting-on-the-person-who-wrote' &&
    wait !== 'waiting-on-purpose',
)

/**
 * 🔴 **What the engine OBSERVED that stopped this work being driven** (400, HO-018 §2).
 *
 * ⛔ **A cause beside the word, never inside it** — `397`'s ruling about an actor, applied to a
 * reason. ⚠️ Folding these three into three state names is how `silent` came to mean *the child said
 * nothing* about a child somebody had stopped; folding them into none would leave a parent told that
 * nothing is driving its work and given no way to tell a finished turn from a killed app.
 *
 * ⚑ **Each one is an event this app watched happen.** None of them is inferred from an absence, and
 * none of them claims to know WHY the child stopped — a wedged provider and a child that has simply
 * finished thinking produce the same ending, and `395`'s ruling is that a word implying a cause it
 * cannot know is the defect itself.
 */
export const TASK_STALL_CAUSES = [
  /**
   * ⛔ **Its turn ended and no reply came** — `393`'s `silent`, which is now this.
   *
   * ⚠️ **The turn ENDED of its own accord** (`completed` or `failed`). The child had its chance to
   * call `reply_to_parent` and the turn finished without one. ⛔ It says nothing about whether that
   * is a failure: the work may be half done, the child may reply on its next turn, and HO-018's
   * ruling is that the parent decides. ⚑ **`720` (R72): somebody may have ASKED it to stop first** —
   * the provider finished it anyway — and then {@link PieceRow.stalledBy} names who asked.
   */
  'turn_ended',
  /**
   * ⛔ **Somebody stopped the turn this work was running in** (`turn: interrupted`).
   *
   * 🔴 **`393` and `398` both EXCLUDED an interruption from this transition, and the reason was the
   * WORD rather than the fact.** *"Folding it here would report work as `said nothing` the instant
   * somebody pressed Stop"* — true of `silent`, and no longer true of anything: an interrupted turn
   * is one of the clearest cases there is of nothing driving the work, and it is exactly the case
   * criterion 4 exists for. ⚑ HO-007 S5's ruling that *"the agent keeps everything it was doing in
   * context and decides"* is untouched, because this state is OPEN and the work is still that
   * agent's.
   *
   * ⚑ **D-016c · a Close or a quit mid-turn lands HERE** (`05`: an agent is never dead). `close()`
   * interrupts the open turn before the process goes, so that `turn` row decides the piece, and the
   * stop's own terminal `status` moves nothing. ⚑ A background wake a stop cuts ends here too: since
   * F080 on its own `turn` row (`startedBy`, `interrupted`), and in a ledger written before, on the
   * stop's terminal `status` (`derivePieces`' `status` arm). ⚠️ A stream that FAILED under the host
   * writes neither row, and the fold is not told (`derivePieces`).
   */
  'turn_interrupted',
  /**
   * 🔴 **The app went away while this work was open** (HO-018 §2.3, criterion 14).
   *
   * ⛔ **The PO's own correction: *"I meant the app being killed while work is in progress."*** Two
   * ledger shapes reach this cause and they are two different moments of one restart:
   *
   *  - **the work had been handed over** — the child was mid-turn, the app died, and until this
   *    dispatch NOTHING was written about it. `SessionStore.settleRestartedWork` writes
   *    {@link WorkRestartedEvent} at the next launch.
   *  - **the work was still HELD** — the message never went, and `settleStrandedMessages` has
   *    written `message_unqueued: 'abandoned'` at every launch since `379`. ⚠️ **That row used to
   *    make the TASK `abandoned`, terminally**, which is the thing HO-018 §2.3 struck out: *"nothing
   *    about a quit tells us the work failed."*
   *
   * ⚑ **The message really was abandoned and the task really was not**, and both sentences are now
   * true at once: the ending on the message is unchanged and only what a task does with it moved.
   */
  'app_restarted',
  /**
   * 🔴 **The message carrying this work was never sent** — `message_unqueued: 'abandoned'`.
   *
   * ⛔ **Its own cause rather than {@link app_restarted}'s**, because the two are written by
   * different parties at different moments and a parent acts on them differently: this one means the
   * child never saw the work at all, so *send it again* is the obvious move.
   *
   * ⚠️ **Several producers, and 648 corrected a sentence that named two.** ⛔ A handover a stop cut
   * (`runFinalize` → `handOnWhatItHeld`, D-017) and the launch after a crash
   * (`settleStrandedMessages`) are the two ways of saying *the app went away holding it*; ⚑ **`runFlush` is another, and
   * it is not the app going away** — a queued message whose attached path vanished before the
   * flush (`216`). ⚑ A conversation holding a Claude sign-in the machine has moved on from was one
   * (`648`) and is not now: what its flush could not send stays held for the reopen on the current
   * sign-in. 🔴 **That is why the SENTENCE below does not say the app stopped**: a cause is only as
   * true as its widest producer.
   *
   * ⚑ **`379` made the MESSAGE `abandoned` here and `400` leaves that untouched**: the message
   * really was abandoned. What moved is only what a TASK does with that row — HO-018 §2.3,
   * *"nothing about a quit tells us the work failed."*
   */
  'message_never_sent',
  /**
   * ⚑ **D-017 · R10 — the conversation holding it can never be reopened, and a new one took its
   * place** (`05` rule 3) — its provider no longer has it, or never named it. ⚑ Written by the
   * fold at the old conversation's `replaced_by` row, over every open task it held: the new
   * conversation is the same agent and keeps its memory, and holds none of this work — its giver
   * gives it again, or takes it back (the message that was still carrying held work is not handed
   * on either). ⛔ **Final**: nothing starts the old conversation again, so no later row re-words
   * it — only its giver ends it, by taking it back (`withdraw_task`) or closing it (`update_work`).
   */
  'could_not_be_reopened',
  /**
   * 🔴 **Its conversation ended while it waited on background work, and the work stopped with it.**
   *
   * ⚑ An agent that starts a long background command ends its turn to wait for the notification,
   * and its work reads *working in the background*. A stop — a person's Close, or the app quitting to
   * restart — ends the conversation and every command it was running. ⛔ Until this cause the work
   * then stalled on its turn's own cause, *"its turn ended with this work still open"*, which reads
   * as the agent giving up. ⚑ What stopped rides beside it ({@link PieceRow.stoppedInTheBackground}),
   * so the words can name it. ⚑ A launch wakes a conversation whose background work a restart
   * stopped, and its turn drives the work again ({@link ITS_OWNER_RUNNING_AGAIN_DRIVES_IT}).
   */
  'background_stopped',
  /**
   * 🔴 **F074 — its turn ended on its provider's usage limit** — a `turn` row that carries
   * `limit`: the provider refused the turn for the limit, and said so in its own signals.
   *
   * ⛔ **Not {@link turn_ended}**, whose *"its turn ended with this work still open"* reads as the
   * agent giving up — measured on 2026-10-02, when a giver read exactly that about a helper whose
   * turn the five-hour limit had refused, and could only guess the helper was broken. ⚑ Whose limit
   * and when it resets ride beside it ({@link PieceRow.stoppedOnALimit}), so the words can say both.
   */
  'provider_limited',
  /**
   * 🔴 **F076 — its turn failed because its provider refused the login its conversation was started
   * with** — a `turn` row, or its session's terminal `status`, that carries `loginRefused`: Claude's
   * `auth_stale` (another Claude on this Mac renewing or switching the login does this, as does a
   * login that expired with nothing to renew it), and Codex's `unauthorized` on a failed turn. A
   * saved API key that stopped working is either, marked `onAKey`.
   *
   * ⛔ **Not {@link turn_ended}**, whose *"its turn ended with this work still open"* reads as the
   * agent giving up — measured on 2026-10-02, when a giver read exactly that about a helper whose
   * background work had finished as the login changed. ⚑ Whether the conversation has been reopened
   * since rides beside it ({@link PieceRow.stoppedOnALogin}).
   */
  'login_refused',
  /**
   * Its turn failed because its provider would not bill the account it runs on: a `turn` row that
   * carries `billingRefused` (Claude's `billing_error`, or Codex's out-of-quota on an API key).
   * Not {@link turn_ended}, which reads as the agent giving up, and not {@link provider_limited},
   * which ends at a reset: only a person paying ends this. The conversation and the Providers card
   * name the key; the sentence says who has to act.
   */
  'billing_refused',
] as const

export type TaskStallCause = (typeof TASK_STALL_CAUSES)[number]

/**
 * ⛔ **One sentence per cause, and each one names the EVENT rather than a conclusion** (400).
 *
 * ⚠️ **A closed record keyed by {@link TaskStallCause}**, so a fourth cause cannot be added without
 * somebody deciding what a parent is told about it — the shape `an-unenumerated-state-counts-as-
 * success` exists to force, applied to the sentence rather than to the state.
 *
 * ⚑ **It lives in `shared/` since `406`, and the move is the rule it already carried.** `400` wrote
 * *"one table and two callers, never two tables"* with `undrivenWorkText` and `list_tasks` as the
 * two; `406` adds a third — the row a PERSON reads in the conversation that gave the work — and
 * the renderer cannot import `main/`. ⛔ Duplicating five sentences into the renderer instead is
 * `169` §1's hazard, and the copy that drifts is always the one further from the thing it is about.
 *
 * ## 🔴 624 · `turn_ended` said one thing too many, and `614` is what made it visible
 *
 * ⛔ **It read *its turn ended and it replied nothing*, and `undrivenWorkText` then QUOTED what
 * the agent had said** — `HO-095` §5.2: *"The stall report contradicts itself. It says 'its turn
 * ended and it replied nothing' and then quotes what the agent replied."* ⚠️ Both halves were
 * written honestly: *replied* meant `reply_to_parent`, which really had not been called. ⛔ **A
 * person does not read it that way and neither does a model** — it is the app's word for one tool
 * beside the agent's own prose, and `HO-095` §3 traces what the pair cost: a false stall woke
 * BroBot, took a turn to disprove, and ended with a FALSE LESSON written to its permanent memory.
 *
 * ⚑ **The PO's replacement is a decomposition and not a rewording:** *the turn ended with the
 * task still open, and here is the last thing it said.* 🔴 **Two facts, both true, neither
 * implying the other** — the first is this entry, the second is the last exchange (`exchangePreviewLines` since D-012), and the
 * line that used to fold them into one claim is gone.
 *
 * ⚠️ **The other four are unchanged and were never this shape.** Each of them names an event this
 * app observed — a turn stopped, a restart, a message never sent, a replacement — and none of them
 * says anything about what the agent did or did not SAY.
 */
export const UNDRIVEN_SENTENCES: Readonly<Record<TaskStallCause, string>> = {
  // 🔴 **624 · what is claimed is the WORK's state and never the agent's speech** (`HO-095` §5.2).
  // ⛔ *and it replied nothing* was false beside `614`'s quotation of the agent's own last words.
  turn_ended: 'its turn ended with this work still open.',
  turn_interrupted: 'the turn it was running in was stopped.',
  app_restarted: 'the app restarted while it was open.',
  // 🔴 **648 · it said *the app stopped*, and not every producer is the app stopping** (`624`'s
  // repair, one member over). ⛔ A vanished attachment path ends a held message while the app runs
  // on. ⚑ **The member's own
  // headline was already the true sentence** — *the message carrying this work was never sent* —
  // and the specific reason rides {@link UnqueuedMessageEvent.detail}, where a person reads it on
  // the row the message left behind.
  message_never_sent: 'the message carrying it was never sent.',
  could_not_be_reopened:
    'the conversation it was given to could not be reopened, and a new conversation of the same agent took its place.',
  background_stopped:
    'it was waiting on background work, and that work stopped when its conversation ended.',
  // ⚑ **F074** — the provider and the reset are said where the row carries them
  // ({@link PieceRow.stoppedOnALimit}, `reply-rails.ts`' `theLimitSentence`); this is the sentence
  // without them.
  provider_limited: 'its turn ended because its provider’s usage limit was reached.',
  // ⚑ **F076** — whether this app reopened it is said where the row carries it
  // ({@link PieceRow.stoppedOnALogin}, `reply-rails.ts`' `theLoginSentence`); this is the sentence
  // without it.
  // ⚑ The login may be a sign-in or an API key a person saved, on either provider; the row says
  // which ({@link StoppedOnALogin}).
  login_refused:
    'its turn failed because its provider refused the sign-in or API key its conversation was started with.',
  billing_refused:
    'its turn failed because its provider would not bill the account it runs on; a person has to add credit to that account.',
}

/**
 * 🔴 **What each of the waits STANDS FOR, in the register a state name cannot carry** (603 as one
 * constant, generalised by 609).
 *
 * ⛔ **`pieceText`'s own rule (`taskText` until D-016), which every member owes exactly as the five causes do:** *"A state
 * name is this app's vocabulary; 'its turn ended with this work still open' is the fact it stands
 * for, and a reader deciding what to do next needs the fact."* ⚠️ **`624` moved the words that
 * rule is quoted with and not the rule** — see {@link UNDRIVEN_SENTENCES}.
 *
 * ⚑ A bare `waiting-on-a-person` on a line a model reads would be a word with nothing behind it —
 * `a-closed-vocabulary-guards-what-a-member-says`.
 *
 * ## ⚠️ Keyed by {@link TaskWait} and not by {@link TaskState}, and the narrowing is the point
 *
 * ⛔ **A `Record<TaskState, string | null>` would have made `null` mean two things** — *this state
 * needs no fact* for `answered`, and *this state's fact lives in another table keyed by another
 * vocabulary* for `stalled`. ⚑ Keying it to the family keeps one meaning: **every entry here is the
 * fact a wait stands for, and a wait cannot be added without one.**
 *
 * ⚠️ **Not in {@link UNDRIVEN_SENTENCES}, and the separation is the invariant.** That table is
 * keyed by {@link TaskStallCause} and every entry answers *what the engine observed STOPPING this
 * work*; nothing stopped in any of these. ⛔ An entry there would make `stalledBecause` non-null
 * for a state that is not `stalled`, which is the one thing {@link composeWhatEachPieceIsWaitingOn}
 * clears the fields to prevent — and the one thing the fold's own wait never writes.
 *
 * ⚑ **No full stop and no speaker**, {@link A_PERSON_MUST_ACT}'s shape: the line each lands on
 * already names the piece and the reader.
 *
 * 🔴 **Each one says what the LEDGER holds and never who must move.** *"Nobody has"* rather than
 * *"you have not"*: a permission can be answered by any person at the machine, and a question
 * routed to a parent can become a person's at an escalation without the work changing.
 */
export const WAITING_STANDS_FOR: Readonly<Record<TaskWait, string>> = {
  'waiting-on-an-answer': 'it asked about this and nobody has answered',
  'waiting-on-a-person': 'it raised something only a person can settle and nobody has',
  'waiting-on-a-worker': 'it handed work out and that work is still open',
  // ⚑ **D-016 · commit 6 · R3** — entered at a turn's end and left on any drive, a person's words
  // included: the ledger holds that nothing drove it since, and names nobody who must move.
  'waiting-on-the-person-who-asked':
    'its turn ended, and the person who asked for it has not written since',
  // ⚑ **F097** — the same shape: entered at the end of a turn a person's words opened, and left on
  // any drive; the ledger holds that a person wrote and nothing drove it since.
  'waiting-on-the-person-who-wrote':
    'a person wrote to it, its turn ended, and that person has not written since',
  'waiting-on-purpose': 'its status line marks it as waiting on purpose',
}

/**
 * ⚑ **The same sentence without its full stop, for a line that is already a list item** (400).
 *
 * ⛔ **One table and THREE callers, never three tables.** `list_tasks` renders the cause beside the
 * state, `undrivenWorkText` renders it in the message a parent is pushed, and `406`'s work row
 * renders it under the state word a person reads; two spellings of one observation is how a parent
 * comes to read two different accounts of one event.
 */
export function undrivenSentence(cause: TaskStallCause): string {
  return UNDRIVEN_SENTENCES[cause].replace(/\.$/, '')
}

/**
 * 🔴 **`720` · R72 — the stall causes an ASK to stop can ride beside**, as a closed record so a sixth
 * cause cannot be added without somebody deciding whether an ask reaches it.
 *
 * ⚑ **The ruling** (`709` F-2): *"A turn asked to stop that the provider completed anyway stalls with
 * the provider's word AND the one who asked (R43's two facts)."* ⛔ Until `720` only
 * `turn_interrupted` carried the ask, so a turn somebody asked to stop that Codex completed anyway
 * (`probe:codex-early-interrupt`, `709`) stalled `turn_ended` naming nobody — while
 * `howWorkStopped`, reading the same rows, said who asked.
 *
 * ⚠️ **The CAUSE is still the `turn` row's word** — the provider's, or this app's where that row
 * carries `wordOf: 'this-app'` (`720`, R71: a Claude Stop after its receipt, a Close). `turn_ended`
 * stays `turn_ended`; what rides beside it is who ASKED, never who stopped it — and the words that
 * carry it say so (`theStallAndItsAsk` in `reply-rails.ts`).
 */
export const AN_ASK_RIDES_ON: Readonly<Record<TaskStallCause, boolean>> = {
  turn_ended: true,
  turn_interrupted: true,
  app_restarted: false,
  message_never_sent: false,
  could_not_be_reopened: false,
  background_stopped: false,
  // ⚑ **F074** — a turn's ending, so an ask before it rides beside it as on `turn_ended`.
  provider_limited: true,
  // ⚑ **F076** — a turn's ending too.
  login_refused: true,
  billing_refused: true,
}

/**
 * 🔴 **D-005 · F019 — the stalls its owner starting to run again ends**, as a closed record so a
 * sixth cause cannot be added without somebody deciding.
 *
 * ⛔ **Measured (F019, 2026-09-25):** an owner waits on its helpers, its turn ends, and its work is
 * read `waiting-on-a-worker`. The last helper's task closes BEFORE its reply reaches the owner, so the
 * owner's work read `stalled` again — and the reply starting the owner's next turn pushed its giver
 * *"not being worked on"* at the one moment it demonstrably was, and the work read `stalled` until
 * the owner replied.
 *
 * ⚑ **A turn starting on the owner is a row in its OWN ledger** — `user_turn`, or the `status:
 * working` that precedes it on Claude and is the notice's trigger there — so the work goes back to
 * `working` there. ⚠️ **Only where the owner already HOLDS the work**: a turn ended or stopped with it
 * open, or a restart while it was open. ⛔ Not a message that never went out (the owner never got
 * the work, so its turn is not about it).
 *
 * 🔴 **D-016 · commit 6 · R4 — and only the piece that turn is about**: the piece its row names, or
 * every open piece when it names none ({@link UserTurnEvent.drives}); a `status: working` whose
 * turn's row has not come yet counts as naming none until it does. ⚑ A piece a person gave that
 * waits on them is driven the same way — it is no stall, so this table is not asked for it.
 *
 * ⚑ **Its own ledger says so two more ways** ({@link derivePieces}): its own status line on a piece,
 * written while it runs, drives that piece; and a turn an interrupt made room for goes back to what
 * the interrupt cut once its owner has answered what the turn was started for — provisionally, so
 * a drive that ends with nothing naming it again leaves the earlier stall standing.
 */
export const ITS_OWNER_RUNNING_AGAIN_DRIVES_IT: Readonly<Record<TaskStallCause, boolean>> = {
  turn_ended: true,
  turn_interrupted: true,
  app_restarted: true,
  message_never_sent: false,
  // ⚑ **D-017 · R10** — nothing runs the old conversation again.
  could_not_be_reopened: false,
  // ⚑ Its owner, started again, is told what stopped and drives the work again.
  background_stopped: true,
  // ⚑ **F074** — its next turn, after the limit, drives it again.
  provider_limited: true,
  // ⚑ **F076** — its next turn, on the current login, drives it again.
  login_refused: true,
  billing_refused: true,
}

/**
 * 🔴 **F097 · the endings on which a turn a person's own words opened leaves a piece a conversation
 * gave waiting on that person** (`waiting-on-the-person-who-wrote`) rather than stalled — as a
 * closed record, so a new cause cannot be added without somebody deciding.
 *
 * ⚑ **Only the turn ending on its own**: its provider finished it, and nobody asked it to stop (the
 * fold asks that beside this). The owner answered the person who wrote to it, and the next move is
 * theirs. ⛔ **Every other ending is a fact the giver is owed**, so it stalls as it always did: a
 * stop, a usage limit, a refused sign-in, background work its conversation's end took — and the
 * causes no turn ends on at all (a launch, a message never sent, a replacement).
 */
export const A_TURN_THAT_ANSWERED_A_PERSON_ENDS_ON: Readonly<Record<TaskStallCause, boolean>> = {
  turn_ended: true,
  // ⚑ The other endings of a turn, each a fact its giver is owed.
  turn_interrupted: false,
  provider_limited: false,
  login_refused: false,
  billing_refused: false,
  background_stopped: false,
  // ⚑ And the causes no turn ends on.
  app_restarted: false,
  message_never_sent: false,
  could_not_be_reopened: false,
}

/**
 * 🔴 **Is this work stopped, and did the engine say what it observed?** (557)
 *
 * ⚑ **D-016 · commit 6 · its two readers ask it through {@link aStallItsGiverCanBeToldOf}** — the
 * agent's notice and the person's band — which adds that a CONVERSATION gave the piece; the
 * argument that those two are complements is carried there.
 *
 * ## ⚠️ The second clause is the fold's own invariant, carried rather than re-decided
 *
 * ⛔ **{@link PieceRow.stalledBecause} is non-null if and only if {@link PieceRow.state} is
 * `stalled`** — `derivePieces` cannot write the state and the cause independently — so this reads
 * as a narrowing that can never fire. ⚑ **It is a TYPE GUARD rather than a check**: what it buys is
 * that neither reader needs a non-null assertion to hand the cause on, and a `!` is how an
 * invariant becomes a claim nothing checks.
 */
export function stalledWithACause(
  piece: PieceRow,
): piece is PieceRow & { readonly stalledBecause: TaskStallCause } {
  return piece.state === 'stalled' && piece.stalledBecause !== null
}

/**
 * ⚑ **D-016 · commit 6 — a piece a CONVERSATION gave**: every reader that tells, delivers to,
 * starts or retracts from a piece's giver holds one of these. ⛔ A piece a person gave is not one:
 * there is nobody to tell (R3).
 */
export type PieceAConversationGave = PieceRow & { readonly giver: string }

/**
 * ⚑ **D-016 · commit 6** — whether a conversation gave this piece; see
 * {@link PieceAConversationGave}.
 */
export function givenByAConversation(piece: PieceRow): piece is PieceAConversationGave {
  return piece.giver !== null
}

/**
 * 🔴 **D-016 · commit 6 · R3 — a stall its giver can be told of: stalled with a cause, and given by
 * a CONVERSATION** — the one predicate both recipients are admitted by (557's, widened), so they
 * stay complements. ⛔ A piece a person gave is left out of both, whatever stalled it: nobody could
 * be told, and the person who asked reads its row.
 *
 * ## ⛔ Why it is a function and not two comparisons written twice
 *
 * ⚠️ **There are TWO readers of *this work has stalled and nobody has been told***:
 * `RuntimeHost.tellIfNobodyHasYet` decides whether an AGENT is owed a notice, and
 * `SessionStore.stalledWorkNobodyWasToldAbout` decides whether a PERSON is. ⛔ **They must be
 * complements of each other and never overlap** — HO-062 §2's row promises the work *stalls and the
 * parent is told*, and a person told about work an agent was successfully told about is `452`
 * §5.1's queue of things already handled.
 *
 * ⚑ **One derivation is what makes the complement provable**: a mutation on this line takes both
 * arms down, which is the measurement that they are one rule and not two that happen to agree.
 *
 * ## 🔴 603/609 · both arms are handed COMPOSED rows, and that is what keeps them complements
 *
 * ⛔ **A task whose conversation is waiting on something reads a {@link TaskWait}, which carries no
 * cause**, so this predicate answers `false` for it and NEITHER recipient is owed a notice — the
 * parent is not told *its turn ended with this work still open* about a child waiting on the
 * parent itself, on a person, or on a worker of its own, and a person does not collect a row
 * about it.
 * ⚑ Neither reader needed a new condition: {@link composeWhatEachPieceIsWaitingOn} clears the cause
 * with the state, which is {@link stalledWithACause}'s invariant doing the work.
 *
 * ⚠️ **609 widened the population this excludes, and that is a behaviour change rather than a
 * tidy-up.** ⛔ Work whose giver is waiting on a person or on a worker used to reach both readers
 * as `stalled`/`turn_ended`. 🔴 **The notice is not lost — it moves to the link that actually
 * stopped**, because the child's own row still stalls and whoever gave THAT work out is still
 * told.
 *
 * ⚠️ **Composing ONE arm would have broken the property this docblock names.** `RuntimeHost`
 * composes at both of its triggers and `SessionStore.stalledWorkNobodyWasToldAbout` at its walk;
 * a dispatch that moved only the agent's half would leave the two reading different populations
 * of the same ledgers.
 */
export function aStallItsGiverCanBeToldOf(
  piece: PieceRow,
): piece is PieceAConversationGave & { readonly stalledBecause: TaskStallCause } {
  return stalledWithACause(piece) && givenByAConversation(piece)
}

/**
 * ⛔ **The agent's claim, said ONCE and rendered in two registers** (406) —
 * {@link undrivenSentence}'s rule one subject over: *one table and two callers, never two tables.*
 *
 * ⚠️ **Three surfaces spell this claim and they are one string plus one composition.** A PERSON
 * reads {@link A_PERSON_MUST_ACT} as the mark on the work row; a parent AGENT reads
 * {@link A_PERSON_MUST_ACT_SENTENCE} in the words `replyText` sends it; and the raw event stream
 * prints the mark. ⛔ Two spellings of one claim is how a person and the agent beside them come to
 * two accounts of what a worker said, and this is the claim a decision hangs on.
 *
 * ⚑ **The mark is the whole subject-and-verb and the sentence is BUILT from it**, so there is one
 * owner and nothing to keep in step — `331`'s remedy without `331`'s cost. ⚠️ **No full stop and
 * no speaker**: the message says *"That agent said …"* and the row's heading says who.
 *
 * ⛔ **It is not a summons and must never be rendered as one** (HO-019 §2, and this dispatch's §3).
 * The status grammar's amber means *frozen, waiting for a human*; a task that is answered is
 * neither. This is a claim an agent made about what happens next, kept where the rest of what the
 * agent said is kept.
 */
export const A_PERSON_MUST_ACT = 'a person has to act'

/**
 * ⚑ **The mark as a sentence, for a reader who is already reading** — see
 * {@link A_PERSON_MUST_ACT}.
 *
 * ⚠️ **Composed, never re-typed.** A second literal here would be the one that drifts, and it is
 * the half a parent AGENT acts on: `replyText` is the only account of the reply a parent that is
 * not this window's gets.
 */
export const A_PERSON_MUST_ACT_SENTENCE = `${A_PERSON_MUST_ACT} before this can go further`

/**
 * 🔴 **How a task ENDED, as the agent that did it said so** (393, HO-007 S2).
 *
 * ⛔ **A closed vocabulary, and an unknown value is a refusal rather than a pass** — the shape
 * `325`'s `holdersOf` got wrong in the other direction. `reply_to_parent` refuses an outcome that is
 * not one of these BY NAME and names the three, so a model that guessed a fourth is told what the
 * three are instead of having its guess written into a ledger nobody can query.
 *
 * ⚠️ **Three, and each one says something different about who is owed something next.**
 *
 *  - **`done`** — the work was done. Nobody is owed anything.
 *  - **`blocked`** — the work was NOT done and the agent believes somebody else can unblock it.
 *    ⚑ The parent is owed a decision.
 *  - **`failed`** — the work was not done and the agent has nothing further to try.
 *
 * ⛔ **`blocked` is not `needs_user_action`** and the two are deliberately separate arguments: the
 * first says who the work is stuck ON, the second says a PERSON has to move before anything else
 * can. A task can be `done` and still need a person (*"I wrote the migration; somebody has to run
 * it"*), and one flag doing both jobs would make that unsayable.
 */
export const TASK_OUTCOMES = ['done', 'blocked', 'failed'] as const

export type TaskOutcome = (typeof TASK_OUTCOMES)[number]

/**
 * 🔴 **What one agent says its message to another IS** (415, HO-021 §1) — the fact the app was
 * inferring and could not.
 *
 * ## ⛔ The app cannot read it off the caller, and `412` measured what happens when it tries
 *
 * ⚠️ **`RuntimeHost.workBeingAssigned` asked ONE question — does the caller decode to an agent —
 * and answered *this is work* for every message that did.** ⛔ So a project manager asking its
 * stalled worker *"what happened?"* opened a task, and HO-020's *"one piece of work became five
 * tasks"* was five MESSAGES rather than five assignments.
 *
 * 🔴 **It was measured on BOTH providers on the run that shipped the stall rule** (`412` §5): Codex's
 * project manager obeyed that rule to the letter — *"can you resume the already-assigned task
 * without receiving a new piece of work?"* — **and the app recorded that question as task #4**;
 * Claude's BroBot held the same rule on disk and broke it three times. ⚑ **Obedience produced the
 * same outcome as disobedience, so the instruction was never the variable** — standing rule 15, from
 * this measurement.
 *
 * ## 🔴 D-016 · no message gives work any more
 *
 * ⛔ **`work` was the third member** — a message that opened a task — and D-016 took it away with
 * the task: work is GIVEN with `give_work`, one act that names the profile, the title and the brief,
 * and a message only tells (`note`) or adds to work already given (`follow-up`). ⚑ So nothing a
 * message says can open a piece, whatever its kind.
 *
 * ## ⚠️ Two members, and what people reach for beside them is not in this vocabulary
 *
 * ⛔ **A REPLY is not here**, and that is a boundary rather than an omission. A reply reaches its
 * giver through `RuntimeHost.deliverReply` as {@link THE_APP_ITSELF}, which is not an agent at all
 * — so it meets no rail keyed on one, **by construction rather than by an exemption** (HO-021 §1
 * property 2). ⚑ A member here would be a second answer to a question the caller already answers.
 *
 * ⚠️ **And it is not {@link MailboxKind}.** That vocabulary says how a held message is carried and
 * who may take it back out; this one is what the sender said the words are.
 */
export const AGENT_MESSAGE_KINDS = [
  /**
   * 🔴 **D-010 · for information: no reply is expected** (plan §3.1). ⛔ It opens nothing.
   */
  'note',
  /**
   * 🔴 **D-010 · about work already given** (plan §3.1): it names the piece it follows up — one the
   * sender gave that conversation. ⛔ It opens nothing, so a giver can add to the work without adding
   * work. ⚑ A question is not a message at all since D-009: `ask_question`, whose answer comes back.
   */
  'follow-up',
] as const

/** One of {@link AGENT_MESSAGE_KINDS}. */
export type AgentMessageKind = (typeof AGENT_MESSAGE_KINDS)[number]

/**
 * Whether a value crossing in from a model's arguments is one of {@link AGENT_MESSAGE_KINDS}.
 *
 * 🔴 **D-010 · the kind is REQUIRED, at the handler** (plan §3.1). ⛔ It defaulted to `question`
 * (`553`) and to `work` before that; each default was a decision the caller had not made. ⚑ Still
 * OPTIONAL in the advertised schema, and `538` §3.3 is why: a schema-required argument fails on
 * Claude before the tool's own door runs (an `McpError`), and is a mere hint on Codex — so the
 * handler refuses a missing kind itself, the same way on both, with a sentence that names the two.
 * ⚠️ A row written before D-016 may say `work`, which is no longer a kind: this answers `false`,
 * and readers show nothing for it.
 */
export function isAgentMessageKind(value: unknown): value is AgentMessageKind {
  return typeof value === 'string' && (AGENT_MESSAGE_KINDS as readonly string[]).includes(value)
}

/**
 * 🔴 **What a giver is told about one piece of work it gave out, as FACTS** (406, HO-019 §2).
 *
 * ## ⛔ It exists because the giver's ledger holds no other record of what came back
 *
 * ⚠️ **`work_replied` is written into the OWNER's ledger and nowhere else** — `393`'s own ruling,
 * kept: *"a reply recorded in the parent's ledger would be a second half the fold could not see."*
 * ⛔ What the giver receives is WORDS, through `queueMessage`, and {@link derivePieces} folds one
 * session's own rows and can reach nothing. ⚑ So a person reading the conversation that gave the
 * work would have a paragraph and no facts — and HO-019 §2's property is *"at a glance and WITHOUT
 * READING"*, which is precisely what a paragraph cannot do.
 *
 * ⚑ **`404` already made this move for the other half.** `work_stall_told` (`work_reported` until
 * D-016) is a row in the GIVER's ledger recording that it was told about a stall; this is the same
 * shape for a READER instead of for a de-duplicator, and it rides the turn that carries the words
 * rather than being a second row free to arrive without them.
 *
 * ## ⛔ Every field is copied off the row or off the reply, and nothing here is computed
 *
 * ⚠️ **Two constructors and no third** — `workAnswered` and `workUndriven` in `reply-rails.ts`,
 * beside the sentences they travel with — so the facts a giver is shown and the words it is sent
 * cannot come to two accounts of one piece. ⛔ A caller assembling
 * one of these inline would be `398` §3's two vocabularies printed as one, in the one place a reader
 * compares them.
 *
 * 🔴 **It is a SECOND SPELLING of facts the owner's ledger already holds, and that is stated rather
 * than hidden.** The giver cannot read the owner's ledger, so there is no third option; what keeps
 * the two from disagreeing is that both are written from the same {@link PieceRow} in the same
 * call, and that nothing here is re-derived afterwards. ⚠️ It is a snapshot AT THE MOMENT OF THE
 * REPORT and says so: a piece answered after a stall notice leaves the notice's report reading
 * `stalled`, truthfully, because that is what was reported then.
 *
 * ## ⛔ Every field is READ (406, from the review)
 *
 * ⚠️ **A dead field on a DURABLE wire contract is worse than dead code**: it is written into every
 * giver's ledger for ever, and the next reader has to decide whether the absence of a consumer is an
 * omission or a ruling. ⚑ {@link owner} is what a person presses to reach the conversation the work
 * is with (`506`), and {@link resources} is what a person presses to READ what the answer handed in
 * (`510`, a document until D-016) — neither can be recovered from the sentence beside it.
 *
 * ## ⚠️ D-016 · re-keyed, and an older report is not read as one
 *
 * ⛔ **{@link piece} and {@link label} replaced a task's id and number**, and {@link isAWorkReport}
 * requires both — so a report written before D-016 is not a report to any reader, and its turn draws
 * as plain words.
 */
export interface WorkReport {
  /** The piece, by id — {@link PieceRow.piece}, copied. ⚠️ Never re-derived. */
  readonly piece: string
  /** The label a person and a model say out loud — {@link PieceRow.label}. */
  readonly label: string
  /**
   * 🔴 **The conversation the work is WITH** — {@link PieceRow.owner}, copied (506).
   *
   * ⛔ **A SUBJECT and never an author**, which is why it is here and not `TurnFacts.carriedFor`.
   * That field says *"these words came from that conversation"* and the answered reply sets it
   * truthfully; the undriven notice is this app's own sentence — it QUOTES the owner's last ended
   * turn, framed and attributed inside the text (`exchangePreviewLines`, D-012) — so stamping
   * `carriedFor` there would claim the app's own sentence came from the owner. ⚑ The work is with
   * the same conversation either way, which is the fact a person presses on.
   *
   * ⚠️ **Optional because the bound on the way in drops one this app could not have minted**; every
   * report this build writes carries it.
   */
  readonly owner?: string
  /**
   * ⛔ **Where the fold left it at the moment this was reported** — a {@link TaskState}, so a
   * surface keys its words off {@link TASK_STATES} and gains a member with the vocabulary rather
   * than by somebody remembering (`a-loop-over-a-literal-variant-list-is-not-exhaustive`).
   */
  readonly state: TaskState
  /**
   * How the owner said it went. ⛔ **Absent, never null**, and absent means *no reply has landed* —
   * {@link PieceRow.outcome}'s own rule, carried as an absence because that is what the wire spells.
   */
  readonly outcome?: TaskOutcome
  /**
   * 🔴 **The resources the reply handed in** — {@link PieceRow.resources}, by id, absent when there
   * were none (510; one document per task until D-016, any number of resources since).
   *
   * ⛔ **Ids, never paths**: the id is what every door takes — the owner's `read_document`, and a
   * person's window through main's own door, which re-checks the bytes against the hash.
   *
   * ⚑ **Never on a STALL, and that is structural.** Resources reach a {@link PieceRow} only through
   * the fold's `work_replied` arm, which settles the row to `answered`; `answered` is not
   * {@link TASK_IS_OPEN}, so a piece that has answered can never afterwards stall.
   */
  readonly resources?: readonly string[]
  /**
   * 🔴 **The owner's claim that a PERSON has to move next** — {@link PieceRow.needsUserAction},
   * absent unless it said so.
   *
   * ⛔ **`true` or absent, and there is no `false`**, exactly as `WorkRepliedEvent` spells it. ⚠️
   * **And absence is THREE-VALUED once {@link state} is read**: absent on an `answered` report is
   * *the agent said no*; absent on any other report is *nobody has said*. ⛔ A surface that rendered
   * both as *nothing is needed* would be making a claim no agent has made.
   */
  readonly needsUserAction?: true
  /**
   * What the engine OBSERVED stopped this work being driven — {@link PieceRow.stalledBecause}.
   *
   * ⛔ **Present if and only if {@link state} is `stalled`**, which is the fold's own invariant
   * carried across rather than re-checked: the two constructors, `workAnswered` and
   * `workUndriven`, are the only writers, and neither can set one without the other.
   *
   * ⚠️ **A report read back off a ledger can name a cause this vocabulary no longer has** —
   * `conversation_ended`, written until D-016c: the store bounds it as an id and never as a member,
   * so a reader words it through a lookup that answers nothing for one, never through
   * {@link undrivenSentence}.
   */
  readonly stalledBecause?: TaskStallCause
}

/**
 * 🔴 **729 · PM ruling R89 — the word a lost answer's record carries when it was HELD and then
 * lost** — `ReplyUndeliveredEvent.because`, beside the one `REPLY_DELIVERIES` member that lands
 * nowhere.
 *
 * ⚑ **R89 (`724` F-1, extends R84) · Lost is lost, whatever lost it:** *"An answer is not delivered
 * when it never reached the giver, by any road: refused (`reply_undelivered`), or held for a busy
 * giver and then abandoned by a Close, a quit, a crash or a sign-in latch. Its `list_tasks` row
 * carries the summary in every one of those cases."* ⚑ A Close, a quit and a sign-in latch no longer
 * abandon held words — the next start, or the reopen on the current sign-in, sends them.
 *
 * ⛔ **Not a `REPLY_DELIVERIES` member, and that is the fact rather than a gap**: the replying agent
 * was handed back `held` or `kept` (D-030) — which was true — and this is what became of the held
 * message later. ⚠️ So the row's `because` is no longer always *"the word the agent was handed
 * back"*; on this row it is the later ending, and the giver's own `message_unqueued` says which
 * ending it was.
 */
export const AN_ANSWER_HELD_THEN_LOST = 'held-then-lost'

/**
 * 🔴 **729 · R89 — the answer a held message carries, or `null` when it carries none** — asked of a
 * held message's AUTHORSHIP as it ends without being sent.
 *
 * ⚑ **An answer is the reply itself**: `deliverReply` queues it with the answer's own report
 * (`workAnswered`, `state: 'answered'`) and `carriedFor` the conversation that answered, which is
 * where `relayedFrom` comes from — the report's own `owner`. ⛔ **Both**: the report says the work
 * was answered, and `relayedFrom` says these are the answerer's words, carried — the app's own
 * notices are relayed from nobody.
 *
 * ⚠️ **Structural, so both writers can ask it**: `RuntimeHost` over a held message's
 * `TurnAuthorship`, and `SessionStore`'s crash repair over the stored row — one question, asked of
 * the same two keys. ⛔ **A report with no `owner` carries no answer here**: the record is written
 * into that conversation's ledger, and there would be none to write it into — nor could two absent
 * keys be read as a match.
 *
 * ⚠️ **A value that is not a report answers `null`, and never throws** ({@link isAWorkReport}, never
 * `!== undefined`) — `729`'s review. ⚑ The store's door already drops such a `work` on the way in,
 * import included (`boundWorkReport`), so the crash repair meets none; the predicate answers for
 * itself anyway, since the host hands it live authorship too.
 */
export function theAnswerItCarries(authorship: {
  readonly work?: WorkReport
  readonly relayedFrom?: string
}): (WorkReport & { readonly owner: string }) | null {
  const { work } = authorship
  if (!isAWorkReport(work)) return null
  const replier: unknown = work.owner
  return work.state === 'answered' &&
    typeof replier === 'string' &&
    authorship.relayedFrom === replier
    ? { ...work, owner: replier }
    : null
}

/**
 * 🔴 **Whether a value off the wire is shaped like a report at all** (406, from the review).
 *
 * ⛔ **The three fields with no fallback of their own.** `state` is read through a guard that answers
 * something true for a value this app has never heard of; {@link WorkReport.piece} and
 * {@link WorkReport.label} are printed. ⚠️ A `work: "hello"` on an imported ledger passes
 * `!== undefined`, reaches the row, and draws a label of *undefined* — the SHAPE of the value was the
 * one thing nothing checked.
 *
 * ⚑ **D-016 · and it is what keeps an older report inert.** A report written before D-016 names a
 * task by id and number, and has neither of these keys, so no reader takes it for a piece's.
 *
 * ⚑ **Structural and not exhaustive, deliberately.** It answers *is this a report* and not *is
 * every field a member of its vocabulary*, because the second question already has answers further
 * in and another here would be a second reading free to disagree with them.
 */
export function isAWorkReport(value: unknown): value is WorkReport {
  if (typeof value !== 'object' || value === null) return false
  const one = value as Partial<WorkReport>
  return (
    typeof one.piece === 'string' && typeof one.label === 'string' && typeof one.state === 'string'
  )
}

/**
 * 🔴 **One piece of work a conversation GAVE OUT, as the window that gave it reads it** (508).
 *
 * Show work the conversation gave out with its live state and the agent holding it.
 *
 * ## ⛔ Why this is a second shape and not {@link PieceRow} on the wire
 *
 * ⚠️ **{@link WorkReport}'s own rule governs:** *"A dead field on a DURABLE wire contract is worse
 * than dead code."* A {@link PieceRow} carries many more fields than this surface draws; the brief,
 * the held message, the ending, the resources, the stall's moment and asker, the lost question and
 * the summary would each arrive at a renderer with no reader **on this row**. ⚠️ **543 · some of
 * them have a reader on a DIFFERENT row** — `WorkEdge` carries `endedAt`, because a relationship
 * panel draws when work ended — and a field is carried where it is read.
 *
 * ## ⚑ It is worded by `WorkReading`, and that is a compiler fact rather than a convention
 *
 * ⛔ **The state fields are {@link WorkReport}'s, spelled identically — absences and all** — so
 * `workReading` words this row and the transcript's report row through ONE function. ⚠️ `222`
 * §4's one-vocabulary rule, kept by construction: another {@link TaskState} gains a word in
 * `WORK_STATE_WORD` and both surfaces get it, and neither can be given its own.
 *
 * ## 🔴 What is deliberately NOT here
 *
 * ⛔ **No liveness, of any shape.** `runningStateOf` can say who is WATCHING a conversation and
 * nothing about whether it is making progress (`505`), so a field of that kind on this row would
 * put a word a person acts on over a fact this app cannot check. ⚠️ {@link state} is the PIECE's
 * state, folded from events the app watched happen, and it claims nothing about the worker.
 *
 * ⛔ **No session id.** {@link givenToProfile} is the IDENTITY, which is what `agentName` joins on.
 * ⚠️ **543 · a reader for that id EXISTS, and this row still does not carry it**: `WorkEdge` names
 * both ends because a relationship panel draws an edge, and widening this row instead would have put
 * the id on the Work tab, which offers no press over it.
 */
export interface WorkGivenOut {
  /** Null is known absence; omitted when the ledger read was incomplete. */
  readonly definitionOfDone?: string | null
  /** The piece, by id — {@link PieceRow.piece}, copied. */
  readonly piece: string
  /** The label a person says out loud — {@link PieceRow.label}. */
  readonly label: string
  /** What the piece is called — {@link PieceRow.title}: the newest title, whoever set it. */
  readonly title: string
  /**
   * Where the fold left it — {@link PieceRow.state}. See {@link WorkReport.state} for the rule.
   *
   * ⚑ **603/609 · COMPOSED before it reaches here**, so this can be a {@link TaskWait} the
   * composition writes (never the one a piece a person gave reads: no conversation gave that out):
   * `SessionStore.workGivenOutBy` walks through {@link composeWhatEachPieceIsWaitingOn}, which is
   * what keeps the Work tab and `list_tasks` from saying two things about one piece.
   */
  readonly state: TaskState
  /** How the owner said it went. ⛔ **Absent, never null** — {@link WorkReport.outcome}'s rule. */
  readonly outcome?: TaskOutcome
  /** The owner's claim that a person has to move — {@link WorkReport.needsUserAction}'s rule. */
  readonly needsUserAction?: true
  /** What the engine observed stopped it — {@link WorkReport.stalledBecause}'s rule. */
  readonly stalledBecause?: TaskStallCause
  /**
   * 🔴 **The IDENTITY the work was given to** — the `agent_identity` slug behind
   * {@link PieceRow.owner}, resolved where the identity lives.
   *
   * ⛔ **Resolved in main rather than joined in the renderer, and the difference is measurable.**
   * `agentIdentities()` is re-read *"at mount and after a successful launch, and at no other
   * time"* (`472` F3), so a conversation an agent created since this window mounted is not in the
   * renderer's roster at all. ⚑ **`agentName` still does the naming** — this is the id it joins on.
   *
   * ⚠️ **`null` is *this app has no identity for that conversation*** — `agent_identity_id IS
   * NULL` — and it is the same null `agentName` already folds into `DEFAULT_PROFILE_LABEL`.
   */
  readonly givenToProfile: string | null
  /** Epoch ms the piece was given — {@link PieceRow.givenAt}. */
  readonly givenAt: number
  /** 🔴 **W4.189** — {@link PieceRow.givenFolder}: the folder it gave, and how; absent: none. */
  readonly givenFolder?: GivenFolder
}

/**
 * ⛔ **{@link WorkGivenOut} from the row it is derived from, in one place** (508).
 *
 * ⚠️ **Here rather than in the store, because it is a fact about the two SHAPES** and neither of
 * them can reach a database. ⛔ The absences are built the way the wire spells them —
 * `...(x === null ? {} : { x })` — so a row this app wrote and a row read back out of a
 * `.brobot` bundle are the same value.
 */
export function workGivenOut(row: PieceRow, givenToProfile: string | null): WorkGivenOut {
  return {
    piece: row.piece,
    label: row.label,
    title: row.title,
    ...(row.definitionOfDone === undefined ? {} : { definitionOfDone: row.definitionOfDone }),
    state: row.state,
    ...(row.outcome === null ? {} : { outcome: row.outcome }),
    ...(row.needsUserAction ? { needsUserAction: true as const } : {}),
    ...(row.stalledBecause === null ? {} : { stalledBecause: row.stalledBecause }),
    givenToProfile,
    givenAt: row.givenAt,
    ...(row.givenFolder === undefined ? {} : { givenFolder: row.givenFolder }),
  }
}

/**
 * ⛔ **Whether a task in this state is still somebody's to finish** — the one derived predicate, as
 * a table rather than as a `!==` list.
 *
 * ⚠️ **`stalled` is OPEN**, and that is the entry worth arguing about — HO-018 §2.1 took it
 * explicitly (*"take `TASK_IS_OPEN.stalled`"*). Calling it closed would be the *"unenumerated state
 * counting as success"* shape with a name on it: a task nobody will ever look at again because the
 * app decided that a turn ending, or a Stop, or a restart was an ending of the WORK. ⚑ **And it is
 * what makes a late reply possible**: a child that finished its turn and called `reply_to_parent` on
 * the next one still lands, because {@link derivePieces} only refuses a reply to a task it has
 * already CLOSED.
 *
 * ⛔ **`answered` is CLOSED, and it is the only state a reply produces.** `393`: a second reply to
 * one task is a refusal and it is permanent, which is a property of this row rather than of the
 * rail that reads it.
 *
 * 🔴 **There are three closed states, and every one of them is somebody DECIDING** (400, D-016).
 * `answered` is the agent saying how it went; `withdrawn` is the parent taking the work back;
 * `closed` is the parent ending the work without a reply. ⛔ **Everything else that happens to work
 * is a condition on an open task** — a turn ending, a Stop, a restart, a replacement — which is
 * HO-018 §2's principle stated as a table rather than as a sentence: *the engine never terminally
 * closes work it did not observe finishing.*
 */
export const TASK_IS_OPEN: Readonly<Record<TaskState, boolean>> = {
  waiting: true,
  working: true,
  // ⚑ **603/609 · every wait is open, for `stalled`'s reason and not for a new one.** ⛔ The work
  // is still somebody's to finish, and the thing each one is waiting on is exactly what would put
  // it back in motion — see {@link TASK_WAITS}, and {@link composeWhatEachPieceIsWaitingOn} for why
  // the fold writes only two of them: the folded waits are the fold's own observation (commit 6,
  // F097), and the others are joins across derivations that stay above the fold.
  //
  // 🔴 **A wait that was CLOSED could never be answered** — `393`'s rule that a second reply is a
  // permanent refusal — so a parent that answered a question, approved a permission or got its
  // worker's reply would find nothing left to reopen, and a person's request nothing to finish.
  'waiting-on-an-answer': true,
  'waiting-on-a-person': true,
  'waiting-on-a-worker': true,
  'waiting-on-the-person-who-asked': true,
  'waiting-on-the-person-who-wrote': true,
  'waiting-on-purpose': true,
  stalled: true,
  answered: false,
  withdrawn: false,
  closed: false,
}

/**
 * 🔴 **D-016 · one status line about a piece, and who set it when** — {@link PieceRow.statusLine}.
 */
export interface StatusLine {
  readonly text: string
  /** The conversation that set it — its owner for a reply's summary. */
  readonly by: string
  /** Epoch ms of the row that set it. */
  readonly at: number
  /** The line marks the piece as waiting on purpose, until a new brief or a follow-up names it. */
  readonly waiting?: true
  /**
   * What the wait is on. ⚑ Absent on a line marked waiting: a wait from before a wait named its
   * target, which needs classifying ({@link aWaitNeedsClassifying}).
   */
  readonly on?: WaitOn
}

/**
 * What a piece marked as waiting on purpose waits on: another piece, or a question its holder
 * asked an agent; a question or to-do its holder raised that waits on a person; a time the app
 * wakes its holder at; or a scheduled job or background task in its holder's conversation.
 */
export type WaitOn =
  | { readonly kind: 'agent'; readonly piece: string; readonly label: string }
  | { readonly kind: 'agent'; readonly request: string }
  | { readonly kind: 'person'; readonly request: string }
  | { readonly kind: 'time'; readonly at: number }
  | { readonly kind: 'event'; readonly job: string }
  | { readonly kind: 'event'; readonly background: string }

/** A stored row's {@link WaitOn}, or `undefined` where the row does not say one. */
export function aWaitOnOf(value: unknown): WaitOn | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const one = value as Record<string, unknown>
  const text = (key: string): string | null =>
    typeof one[key] === 'string' && one[key] !== '' ? (one[key] as string) : null
  const piece = text('piece')
  const label = text('label')
  const request = text('request')
  const job = text('job')
  const background = text('background')
  switch (one.kind) {
    case 'agent':
      if (piece !== null && label !== null) return { kind: 'agent', piece, label }
      return request === null ? undefined : { kind: 'agent', request }
    case 'person':
      return request === null ? undefined : { kind: 'person', request }
    case 'time':
      return typeof one.at === 'number' && Number.isFinite(one.at)
        ? { kind: 'time', at: one.at }
        : undefined
    case 'event':
      if (job !== null) return { kind: 'event', job }
      return background === null ? undefined : { kind: 'event', background }
    default:
      return undefined
  }
}

/**
 * The wait a status row marks, as its line carries it: none, one that names nothing, or one on a
 * target the row states in full ({@link aWaitOnOf}).
 */
export function theWaitItMarks(event: { readonly waiting?: unknown; readonly on?: unknown }): {
  readonly waiting?: true
  readonly on?: WaitOn
} {
  if (event.waiting !== true) return {}
  const on = aWaitOnOf(event.on)
  return on === undefined ? { waiting: true } : { waiting: true, on }
}

/** Whether a status line marks a wait that names nothing it waits on. */
export function aWaitNeedsClassifying(line: StatusLine | null): boolean {
  return line?.waiting === true && line.on === undefined
}

/** ⚑ **F074** — the usage limit a stall's turn ended on, as {@link PieceRow.stoppedOnALimit} holds it. */
export interface StoppedOnALimit {
  readonly provider: TurnLimitOnTheRow['provider']
  readonly resetsAt?: number
  /** The provider's name for the limit, when it named one. */
  readonly window?: string
}

/**
 * ⚑ **F076** — what {@link PieceRow.stoppedOnALogin} holds: whether this app reopened the
 * conversation on the current login since its turn failed on the one it was launched with.
 */
export interface StoppedOnALogin {
  readonly reopened: boolean
  /**
   * ⚑ The login refused was the API key a person saved, not a sign-in (`onAKey` on the `turn` or
   * `status` row, see `events.ts`) — so the words name the key and where to check it.
   */
  readonly onAKey?: true
  /**
   * ⚑ Whose login it was — the conversation's provider, as the store's fold is told
   * ({@link derivePieces}' `provider`): Claude's and Codex's refusals have different remedies.
   * Absent from a fold that was not told, which reads as Claude's, the first to have one.
   */
  readonly provider?: TurnLimitOnTheRow['provider']
}

/** The `limit` a `turn` row carries. */
type TurnLimitOnTheRow = NonNullable<Extract<TranscriptEvent, { type: 'turn' }>['limit']>

/**
 * ⚑ **F074 — the usage limit a `turn` row says its turn ended on**, for {@link derivePieces}: only
 * a `failed` turn's, and ⛔ a reset at or before the row's own moment is none — the provider's
 * remembered word about a limit that had already reset is not about this turn.
 */
function theLimitItEndedOn(
  event: Extract<TranscriptEvent, { type: 'turn' }>,
  at: number,
): StoppedOnALimit | undefined {
  if (event.state !== 'failed' || event.limit === undefined) return undefined
  const { provider, resetsAt, window } = event.limit
  return {
    provider,
    ...(resetsAt !== undefined && resetsAt > at ? { resetsAt } : {}),
    ...(window === undefined ? {} : { window }),
  }
}

/**
 * One piece of work, as derived (a task until D-016). ⚠️ **Every field is either copied off
 * {@link WorkGivenEvent} verbatim or folded from events that came after it** — nothing here is looked
 * up, which is why a rebuild reproduces it exactly. ⚑ The one fact handed in rather than folded is
 * the conversation's provider ({@link StoppedOnALogin.provider}), which a rebuild is handed too. ⛔ Never a root (D-016 · R1): a root has no
 * `work_given`, so no row opens for one.
 */
export interface PieceRow {
  /** `work_<uuid>`, off the give. What every door that names a piece takes, beside its label. */
  readonly piece: string
  /** The label a person and a model say out loud, `W1.2` — off the give, never recomputed. */
  readonly label: string
  /** The id of the piece this one was given under. */
  readonly parent: string
  /**
   * What the piece is called — the give's title, then the newest `work_retitled` about it, whoever
   * wrote it.
   */
  readonly title: string
  /**
   * The work, verbatim — the give's brief, then the newest `work_rebriefed` about it: the brief its
   * giver last set.
   */
  readonly brief: string
  /** Null is known absence; omitted when the ledger read was incomplete. */
  readonly definitionOfDone?: string | null
  /**
   * The conversation that gave the work, or `null`: a person — work its owner took on for them
   * (`take_on_work`, D-016 · commit 6). ⛔ Never a root: a root is never a row.
   */
  readonly giver: string | null
  /**
   * ⛔ **The conversation the work was given TO — the ledger this row was folded from.**
   *
   * ⚠️ **Not on the event**, deliberately: an event that named the session it is stored in would be
   * a second spelling of one fact, free to disagree with the row it sits in. {@link derivePieces}
   * takes the ledger's own name as an argument instead.
   */
  readonly owner: string
  /** Epoch ms of the give — the `at` of the event, not of anything derived from it. */
  readonly givenAt: number
  /** Included only by the closing-block read, from an observed state or status revision. */
  readonly lastRecordedChangeAt?: number | null
  /** `354`'s held-message id, or null when the brief went straight out. */
  readonly messageId: string | null
  /**
   * Where the fold left it.
   *
   * ⚠️ **603/609 · a row a SURFACE was handed can carry a composed {@link TaskWait}** — see
   * {@link composeWhatEachPieceIsWaitingOn}; the fold itself writes only two waits,
   * `waiting-on-the-person-who-asked` (D-016 · commit 6) and `waiting-on-the-person-who-wrote`
   * (F097). ⛔ *Where the fold left it* is still true
   * of every row {@link derivePieces} returns and of nothing else, and the difference is the whole
   * design: `400`'s rule keeps the second opinion out of the fold, and the join adds it above.
   */
  readonly state: TaskState
  /**
   * Epoch ms of the event that put it in a CLOSED state, or null while it is open.
   *
   * ⚠️ **Null for `stalled`**, because `stalled` is open: a turn ending, a Stop and a restart are
   * none of them the task ending, and stamping one would be this app claiming an ending HO-018 §2
   * explicitly refuses.
   */
  readonly endedAt: number | null
  /**
   * 🔴 **D-025 · the conversation whose act put it in a CLOSED state** — off the same row as
   * {@link endedAt}: its {@link owner} for a reply (`work_replied` is the owner's own row, in its
   * own ledger), and the row's own `by` for a take-back or a close — the giver, or the conversation
   * in its place.
   *
   * ⚠️ **`null` while it is open, and `null` when the row that ended it names nobody**: a held brief
   * cancelled (`message_unqueued`) carries no actor, whoever cancelled it — a take-back of a piece
   * still `waiting` among them, whose own row then lands on an ended piece. The honest absence, never
   * a guess at the giver. ⛔ An id, as {@link giver} is: a sentence names it through the host.
   */
  readonly endedBy: string | null
  /**
   * 🔴 **How the agent said it went, or null because it has not said** (393).
   *
   * ⛔ **Null is not a fourth outcome and must never be read as one.** It means *no reply has
   * landed*. ⚑ The two are derived from one event and cannot disagree: an `outcome` is written only
   * where the state is set to `answered`, and nothing else writes either.
   */
  readonly outcome: TaskOutcome | null
  /**
   * 🔴 **Which observation stopped this work being driven — non-null if and only if
   * {@link state} is `stalled`** (400).
   *
   * ⛔ **The invariant is held by CONSTRUCTION and not by a check**: `settle` clears this for every
   * state, and the one helper that can produce `stalled` requires a cause to do it. ⚠️ So a reader
   * never has to decide what a `stalled` row with no cause would mean, because the fold cannot make
   * one.
   *
   * ⚠️ **648 · this sentence named two writers of this field, and there are more.** ⛔ `settle`
   * clears it, `stall` sets it, and every other writer clears it inline with its two siblings: the
   * `message_unqueued: 'sent'` branch, `drivenAgain` (D-005) and `endedWithItOpen` (D-016 · commit
   * 6, a piece a person gave waiting on them). 🔴 **The first of those is why the sibling fields
   * below gained a line in 648**: it cleared the cause and left `stalledAt` and `stalledBy`
   * standing, which was the one place *three fields, one fact* was not held.
   *
   * ⚑ **It is cleared on the way out, and that is deliberate.** Once a child has replied, or has
   * gone back to work, *why it had stopped* is not what the parent is deciding about any more — and
   * a stale cause hanging off a `working` row would be exactly the sentence that is free to disagree
   * with the state beside it. The ledger keeps the history; this field carries the present.
   */
  readonly stalledBecause: TaskStallCause | null
  /**
   * 🔴 **When the observation was made — non-null exactly when {@link stalledBecause} is** (484,
   * HO-031 §2.2).
   *
   * ## ⛔ The field that stops two turns being read as one contradiction
   *
   * ⚠️ **BroBot read `stalled_because: 'turn_interrupted'` beside `lastTurn.how:
   * 'the-provider-faulted'` and reported that one of them named the wrong actor.** ⛔ **Neither
   * did.** A stall is latched by the FIRST ending that reaches a `working` task, and the rows that
   * return one to `working` are a message that actually went out (648 — see `'stalled'` in
   * {@link TASK_STATES}) and, since D-005, its owner starting to run again on it, so this field
   * describes one turn
   * while `AgentCard.lastEndedTurn` describes whichever turn closed last, and until this dispatch
   * nothing in either value said they were different moments.
   *
   * ⚑ **A time, and not a turn id.** The task fold has no turn ids — `events.turn_id` is a column of
   * the ledger and not a field of any event it reads — and inventing one here would be
   * *a derivation answering what its ledger does not contain*. Two moments a reader can compare is
   * what the defect needed and is all this app can honestly supply.
   */
  readonly stalledAt: number | null
  /**
   * 🔴 **Who ASKED the turn it stalled in to stop** (484, HO-029 §2.1 / HO-031 §2.1) — `null` when
   * nobody did, and `null` when no row says.
   *
   * ⛔ **`484` said *`turn_interrupted` and nothing else***: *"The turn it was running in was
   * stopped"* is an ACT, and HO-029 §2.1 is that any surface reporting an act reports the actor it
   * has — which this one has, on the `work_interrupted` row the same fold walks past. 🔴 **`720`
   * (R72) widened it to the other TURN cause on purpose**: a turn asked to stop that the provider
   * completed anyway stalls `turn_ended` — the provider's word — *"AND the one who asked (R43's two
   * facts)"*. ⚑ So this names the ASKER, never who ended the turn, and the sentences that carry it
   * say so (`theStallAndItsAsk`). ⚑ **The other three causes — a launch sweep, a message the app
   * never sent and a replacement — have no turn ending for an ask to precede**, and a `by` there
   * would be a guess ({@link AN_ASK_RIDES_ON} is the closed record).
   *
   * ⚠️ **`null` is the honest absence and never a fourth actor** — HO-029 §2.2, *"every event
   * written before this answers unknown"*.
   *
   * ## 🔴 494 · two producers, and the second one closes `492` F2
   *
   * ⛔ **`492` measured this field reading `null` for an act this app knows the author of**, and
   * priced a second `work_interrupted` row from `RuntimeHost.respondPermission`. ⚑ **Nothing new is
   * written.** {@link UserDecisionEvent.by} has carried the caller since `477`; the fold reads it
   * now, through `whoCancelledIt`, and `491`'s *a cancel writes no ask* is still true.
   *
   * ⚠️ **It reaches every door at once and that is structural rather than lucky.** Three adapters
   * stop a turn three different ways — a `turn/interrupt` frame on a Codex agent-tool card,
   * `{decision:'cancel'}` on a Codex command or file approval, `interrupt: true` on Claude's
   * `canUseTool` — and all three are answered through ONE host door that writes ONE row. ⛔ There
   * is no second place for a fourth adapter to forget.
   *
   * ⛔ **THREE reachable nulls remain and none of them is a failure to write:** a turn nobody asked
   * to stop (a window closing a conversation mid-turn, or a turn that simply ended), a decision
   * written before `477`, and a cause that is not a turn's at all.
   */
  readonly stalledBy: Pick<AskToStop, 'by' | 'asker'> | null
  /**
   * 🔴 **A question this conversation had asked was still unanswered when the app went
   * away** (400, HO-018 §2.4 · criterion 14).
   *
   * ## ⛔ The criterion the PO rewrote, and the mechanism it stopped asking for
   *
   * ⚠️ **HO-007 asked for *"the pending question rebuilt from the ledger"*.** HO-018 §2.4 withdrew
   * that: *"what I asked for specified a mechanism the design deliberately prevents"* — `396`'s
   * launch sweep closes every open routed request precisely because the provider holding it is gone,
   * and rebuilding one would offer a parent a question whose answer could reach nothing.
   *
   * ⚑ **The property it wanted is that the question is not SILENTLY lost**, and this is it: the
   * request closes, and the work that was in flight carries the fact that it happened. The parent
   * can re-ask by message, which is the door that was always there.
   *
   * ## ⛔ Only a question the PARENT could have answered
   *
   * ⚠️ **A permission-shaped routing never travelled** — `394` recorded it with
   * `RoutedRequest.because` set precisely so the refusal stays visible — so it was never the parent's
   * to answer and *"the parent can re-answer by message"* is false of it. ⛔ Counting it here would
   * make this flag true for nearly every crash, because a child parked on a permission card is the
   * ordinary way a turn waits: a field that is almost always true is a field nobody reads.
   *
   * ⚑ **So the fold tracks which routings TRAVELLED** and matches the stranding against those. ⚠️
   * That is two event types answering one question rather than one, which is why `request_routed`
   * is in the narrow read beside `request_stranded` — and why the census in
   * `a-task-you-can-see.test.ts` §7 has both.
   *
   * ## ⚠️ Two vocabularies touching, and which one owns the fact
   *
   * ⛔ **The REQUEST owns what happened to the request** — `RequestState.stranded`, written by
   * `settleStrandedRequests`, unchanged by this dispatch and asserted to be unchanged. ⚑ **This
   * field only REPORTS it**, on the row a parent is already reading, so a parent looking at its
   * work does not have to know that questions are a separate derivation to find out that one was
   * lost underneath it.
   *
   * ⚠️ **It is a latch and it survives the ending**, unlike {@link stalledBecause}: *a question was
   * lost here* stays true about what happened even after the work is answered, and a parent
   * reviewing a finished task is exactly who would want to know that the child had been asking
   * something.
   */
  readonly questionLostAtRestart: boolean
  /**
   * 🔴 **D-013 · what is still running in the background for it** (plan §3.7) — present while a
   * drive has ended with this work open AND with background work its provider will wake it for (a
   * backgrounded command, a scheduled wake-up). ⚑ The row reads `working` meanwhile, and a giver
   * reads *working in the background* and WHAT — so a build can be told from a server that never
   * ends. ⛔ Absent otherwise: it is never an empty list. ⚑ **D-016c · a stop takes the backgrounded
   * commands with it and leaves the schedule**, so after one only a scheduled wake-up is listed.
   */
  readonly inTheBackground?: readonly string[]
  /**
   * How many open pieces are ahead of it at the service it is queued on — present only on a piece
   * a service holds whose brief was never handed over, as the host draws a giver's board.
   */
  readonly queuedBehind?: number
  /**
   * When the piece being worked on at that service stalled — present beside {@link queuedBehind}
   * only while that piece is stalled, so a caller waiting behind it sees why it waits.
   */
  readonly queueStalledAt?: number
  /** Beside {@link queuedBehind} while services are off: nothing is handed over until they are on. */
  readonly queueWaitsForServices?: true
  /**
   * 🔴 **What was running in the background for it when its conversation ended** — present on a
   * `stalled` row whose stop took that work with it: {@link TaskStallCause} `background_stopped`, or
   * `app_restarted` after a crash, which leaves no ending in the ledger. ⚑ Each entry is what the
   * provider called the work (a command's description), or a scheduled wake-up. ⛔ **Read only while
   * the row is `stalled`**: {@link derivePieces}' `stall` is its one writer, and writes or drops it at
   * every stall — ⚠️ but a row driven again keeps it, unread, until its next stall.
   */
  readonly stoppedInTheBackground?: readonly string[]
  /**
   * 🔴 **F074 — the usage limit its turn ended on** — present on a `stalled` row whose cause is
   * `provider_limited`: whose limit, and when the provider said it resets (epoch ms; absent when it
   * did not say). ⛔ **Read only while the row is `stalled`**, {@link stoppedInTheBackground}'s
   * rule: {@link derivePieces}' `stall` writes or drops it at every stall.
   */
  readonly stoppedOnALimit?: StoppedOnALimit
  /**
   * 🔴 **F076 — its turn failed because Claude refused the login it was started with** — present on a `stalled`
   * row whose cause is `login_refused`, saying whether this app has reopened the conversation on the
   * current login since (a `reopened` row because the sign-in was renewed). ⛔ **Read only while the
   * row is `stalled`**, {@link stoppedOnALimit}'s rule.
   */
  readonly stoppedOnALogin?: StoppedOnALogin
  /**
   * ⚑ **F075 — a turn may still go back to it** — present on a `stalled` row an interrupt cut, while
   * the turn that interrupt made room for has not started yet, or is open and has not gone back to
   * it ({@link derivePieces}' go-back). ⚑ Cut by a turn its provider ended `interrupted`, or by one a
   * stop was asked of that it ended otherwise, short of a usage limit or a refused login (F075).
   * ⛔ Read only while the row is
   * `stalled`; never stored, so a row never carries it past that turn. ⚑ Its giver's notice waits
   * for that turn (`RuntimeHost`).
   */
  readonly aTurnMayGoBackToIt?: true
  /**
   * ⚑ **F097 — when the turn that answered a person who wrote to it ended, with this piece open**
   * (epoch ms): how long the person has owed it their next words. ⚑ Written at the end of
   * {@link derivePieces}' read on every row it leaves `waiting-on-the-person-who-wrote`, and on no
   * other; never stored. ⛔ **Read only while the row is in that state**,
   * {@link stoppedInTheBackground}'s rule: a row {@link composeWhatEachPieceIsWaitingOn} writes a
   * more specific wait over keeps it, unread.
   */
  readonly answeredAPersonAt?: number
  /**
   * 🔴 **The resources the reply handed in** — `work_resource` ids, off {@link WorkRepliedEvent},
   * empty until a reply lands and when it handed in none (510 as one document; D-016).
   *
   * ⚠️ **Ids, never paths** (380): the id is what every door takes. ⚑ Two readers, two doors, and
   * the id is what they share: an agent quotes it to `read_document`, and a person's window opens it
   * through main's own door — both read under this app's own resources folder and re-check the hash.
   */
  readonly resources: readonly string[]
  readonly resultDocument?: string
  /** The owner's report from its reply, without an app attestation of a saved file. */
  readonly savedMethod?: string
  /**
   * 🔴 **719 · the reply's own words — its summary — or null when no reply has landed** (PM ruling
   * R70, from `711` F-2: *"The pointer leads to the words"*).
   *
   * ⚑ **Why the row carries them**: an answer that never reached its giver is read there — until
   * `719` that door showed `answered` and the outcome but not the words, which were in the child's
   * ledger only. ⚑ Now `list_tasks` shows them — ⚠️ **since `724` (R84) only on a row whose words
   * reached nobody** ({@link answerReachedNobody}): the fold holds them for every answer, and the
   * door hands them on where this app RECORDED them lost (`reply_undelivered`) — ⚑ since `729`
   * (R89) by any road: not delivered (D-030: its giver's record would not take them, and the
   * replier is told its answer stays here), or held for its giver and then lost
   * ({@link AN_ANSWER_HELD_THEN_LOST}).
   *
   * ⛔ **Bounded as a summary already is, and never cut here**: `reply_to_parent` refuses one longer
   * than `REPLY_SUMMARY_LIMIT` (`WorkRepliedEvent.summary`'s *"no silent truncation anywhere on this
   * path"*), so what a reader holds is what the agent wrote. ⚠️ A longer body is a resource, and
   * {@link resources} names it.
   */
  readonly summary: string | null
  /**
   * 🔴 **724 · whether this app RECORDED that the answer reached no conversation** — a
   * `reply_undelivered` row about this piece in the holder's own ledger
   * ({@link ReplyUndeliveredEvent}, `415`), after its reply.
   *
   * ⚑ **PM ruling R84 (`719` F-5, amending R70):** *"An answered task's row carries the answer's
   * summary only when that answer was NOT delivered (`reply_undelivered` in the child's ledger).
   * Every other answered row stays as it was before R70."* ⚠️ `719` F-5 measured the cost it
   * answers: up to 1,280 units per answered row, on every `list_tasks` call, with no cap on rows.
   *
   * ⛔ **`false` is *no row says so*, never *it landed***. ⚑ It is written on
   * `!REPLY_LANDED[delivered]`, the answer that tells the replier its words stay on the piece, where
   * the giver can read them with `list_tasks` — so that answer and the row that shows the words are
   * one fact.
   *
   * 🔴 **729 · R89 — and a reply HELD for a busy giver that never reached it is written the same
   * way** (`724` F-1): *"Lost is lost, whatever lost it."* ⚑ `REPLY_LANDED` still counts `held` as
   * landed when the reply is queued — the words ARE in the giver's mailbox then, or in its ledger
   * for a `kept` one (D-030) — and when that held message ends without being sent (a stop that cut
   * its handover, a Cancel at its door — no control offers one — or, at the next
   * launch, a crash), `RuntimeHost` writes this row into the replier's ledger with
   * {@link AN_ANSWER_HELD_THEN_LOST}, and the crash repair does the same. ⚠️ **Written, not joined
   * at read time**: one record, so the child's transcript — whose card read *delivered* — and
   * `list_tasks` cannot come to disagree about one answer.
   */
  readonly answerReachedNobody: boolean
  /**
   * ⛔ **Whether the agent said a PERSON has to move before anything else can** (393).
   *
   * ⚠️ **False is the answer when there is no reply**, and that is not a claim that nothing is
   * needed — it is the absence of an agent having said so. The state carries that difference:
   * `stalled` with `needsUserAction: false` is *nobody has said*, `answered` with the same is *the
   * agent said no*.
   */
  readonly needsUserAction: boolean
  /**
   * 🔴 **D-016 · the piece's current status line** — the newest `work_status_set` about it, or its
   * reply's summary said by its owner, whichever came last; `null` while nobody has set one.
   *
   * ⚑ **The newest line stands**, whoever wrote it — its owner, its giver, or (from a later verb) a
   * person — and {@link StatusLine.by} says who.
   */
  readonly statusLine: StatusLine | null
  /**
   * On a piece read as `waiting-on-purpose`, the state the fold sees under the mark: what a
   * launch's sweep judges, and what the piece reads again once the mark ends.
   */
  readonly parkedOver?: TaskState
  /**
   * 🔴 **W4.189 · the folder its give named, as this app used it** — {@link
   * WorkGivenEvent.givenFolder}, copied: a `grant` lets its holder also work there while the piece
   * is open. ⛔ Absent on a give that named none, and on every give recorded before this build.
   */
  readonly givenFolder?: GivenFolder
  /** The model and effort its give asked for ({@link WorkGivenEvent.asked}); absent: none. */
  readonly asked?: ModelAndEffort
  /**
   * 🔴 **W4.189 · whether its brief has been handed over** — `true` when the give went straight
   * out, or its held message was unqueued as `sent`. ⛔ **Absent while it waits, and for good when
   * it was abandoned** (`message_never_sent`): a grant rides only the turn that carries its brief, so
   * a brief never handed over grants nothing. ⚠️ Not the fold's `state`, which a restart's first turn
   * can read `working` while the give still waits behind it.
   */
  readonly briefHandedOver?: true
}

/**
 * A piece waiting on the person who wrote to its holder, with the moment that wait began:
 * {@link derivePieces} stamps {@link PieceRow.answeredAPersonAt} on every row it leaves in that
 * state, so a row in it always carries one.
 */
export type PieceWaitingOnWhoWrote = PieceRow & { readonly answeredAPersonAt: number }

export const waitsOnWhoWrote = (row: PieceRow): row is PieceWaitingOnWhoWrote =>
  row.state === 'waiting-on-the-person-who-wrote'

/**
 * 🔴 **The open work a conversation is holding, as a person refers to it** (467) — one derivation,
 * for the two readers that have to agree.
 *
 * ⛔ **{@link TASK_IS_OPEN} decides what *open* means, and `stalled` is inside it**: nothing is
 * driving that work and the work has not ended, which is exactly the state a person wants to see
 * beside a frozen child. ⚠️ A second reader filtering by hand would have been free to read
 * `stalled` as closed, and the two lists would have disagreed about one conversation.
 *
 * ⚑ **The order is the fold's own** — the order the pieces were given in — and is not re-imposed
 * here. A caller that wants another one sorts what it is given. ⚠️ A root is not a row, so it is not
 * here: what a root-owner holds beside its pieces is its conversation's own work.
 */
export function openWorkOf(pieces: readonly PieceRow[]): readonly WorkInHand[] {
  return pieces
    .filter((piece) => TASK_IS_OPEN[piece.state])
    .map((piece) => ({ label: piece.label }))
}

/**
 * 🔴 **The one piece of work an id names, as a person refers to it — or `null` because this
 * conversation holds no such row** (474, from `463` F4).
 *
 * ⛔ **{@link TASK_IS_OPEN} is NOT asked here, and the difference from {@link openWorkOf} is the
 * point.** A question outlives the work it was about: a worker asks about W1.3, the giver answers a
 * day later, and it has finished in between. ⚠️ Filtering to open work would turn *"this is about
 * W1.3"* into *"nothing answers to it"* the moment the work ended, which is a sentence about this
 * app's filter wearing the clothes of a sentence about the ledger.
 *
 * ⚑ **The FIRST match, and a second cannot exist**: a piece id is `work_<uuid4>` and
 * `derivePieces` opens one row per give, so an id that matches twice in one ledger is a defect
 * elsewhere and not a state this predicate should have an opinion about.
 */
export function workNamed(pieces: readonly PieceRow[], piece: string): WorkInHand | null {
  const found = pieces.find((one) => one.piece === piece)
  return found === undefined ? null : { label: found.label }
}

/**
 * 🔴 **What ONE conversation is waiting on, as the three facts its own ledger and its gives hold**
 * (609, HO-088 §5.1) — the source BOTH projections of it are handed.
 *
 * ## ⛔ One source, three facts — because it is one mechanism and not three
 *
 * ⚑ **`HO-088` §5.1 in its own words: *one mechanism, three sources — NOT three mechanisms*.**
 * ⚠️ A second `compose…` function beside the first is how two surfaces come to two answers, which
 * is the whole of `400` and `HO-086`; a second SOURCE beside the first would move the same problem
 * one layer down, because each caller would then decide the precedence for itself.
 *
 * ⛔ **So the PRECEDENCE lives in {@link whichWait} and the READS live here.** ⚑ Every call site
 * across two layers builds one of these per conversation; none of them decides anything.
 *
 * 🔴 **621 · there are TWO readers**: {@link composeWhatEachPieceIsWaitingOn} projects it onto a
 * piece ROW and {@link theWaitAConversationIsIn} onto the CONVERSATION. ⛔ **Both go through one
 * ladder**, and the two answer different questions on purpose (`621` §4.4).
 *
 * ## ⚠️ Two of the three are keyed by piece, and one cannot be
 *
 * 🔴 **{@link answers} and {@link childrenOpen} are sets of pieces**: `ask_question` names a piece,
 * and every piece names the piece it was given under. ⛔ A permission names none —
 * {@link RaisedQuestion.piece} is `null` for a provider-raised question for ever (`430`) — so
 * {@link aPerson} is the conversation's, and a set there would be a join invented here
 * (`a-derivation-cannot-answer-what-its-ledger-does-not-contain`).
 */
export interface WhatAConversationIsWaitingOn {
  /**
   * ⛔ **The pieces this conversation has an unanswered question about** — `openQuestionsByWork`'s
   * keys, asked of {@link PieceRow.owner}. ⚠️ A question about no piece holds no piece (D-016).
   */
  readonly answers: ReadonlySet<string>
  /**
   * ⚑ **It raised something only a person can settle, and nobody has.**
   * ⚠️ Conversation-wide, because a permission carries no piece.
   */
  readonly aPerson: boolean
  /**
   * 🔴 **D-016 · the pieces with an OPEN piece given under them** — the `parent` of every piece this
   * conversation gave that {@link TASK_IS_OPEN} calls open. ⛔ **The HAND-OVER rows and never a
   * child's state**, read off the raw fold of what it gave (the composition this feeds would compose
   * inside its own source).
   */
  readonly childrenOpen: ReadonlySet<string>
}

/**
 * ⚑ **D-017 · R8 — the wait of a conversation whose record could not be read**: nothing this read
 * saw is outstanding, and the answer that skipped it says so.
 */
export const NOTHING_IT_WAITS_ON: WhatAConversationIsWaitingOn = {
  answers: new Set(),
  aPerson: false,
  childrenOpen: new Set(),
}

/**
 * 🔴 **The one composition: a piece whose conversation is waiting on something reads which WAIT it
 * is in, and not {@link TaskState.stalled}** (603 as one wait, generalised by 609 · HO-091 §1 ·
 * HO-088 §5; per piece since D-016).
 *
 * ## ⛔ Compose ONCE, read many times — and the alternative was ruled out rather than skipped
 *
 * ⚑ **`HO-091` §1:** *"Compose once, above both folds. Every surface that reports a task's state
 * reads that one composition."* ⚠️ The shape it refused is one surface composing and another not:
 * *"The disagreement is certain, not hypothetical. One surface composes and one does not, so they
 * differ by construction"*.
 *
 * ⛔ **So this is not a helper a reader may choose.** Every surface in this app that reports a
 * piece's state calls it — ⚠️ **since `664`, and not before**: the receiver's line and the Team
 * forest read the raw fold until then (`D32`).
 *
 * ## 🔴 The PRECEDENCE, and it is held HERE so that no caller can hold it
 *
 * ⚑ **answer → person → worker**, and the order is derived rather than chosen:
 *
 *  1. ⛔ **An answer this piece is owed** — the reader of the row is exactly who owes it.
 *  2. ⚠️ **`aPerson` next**, because somebody must move and it is not the agent.
 *  3. ⚑ **An open child of THIS piece last**, because NOBODY must move — the work is simply out.
 *     ⛔ When two are true, the one worth saying is the one somebody can act on.
 *
 * 🔴 **A row carries one word and the others are not lost**: the question is still in
 * `list_questions`, the card is still in the person's queue, and the handed-out work is still on
 * the Work tab.
 *
 * ## ⚠️ Why it is here and not inside {@link derivePieces}
 *
 * ⛔ **`400`'s rule, at the fold's own `travelled` set:** *"Ids only: what became of each one is
 * `deriveRoutedRequests`' answer and this fold must not grow a second opinion about it."* ⚑ Whether
 * a question is still open IS that answer, and the same is true of a permission and of another
 * conversation's work. 🔴 **The join therefore lives above the fold, where every derivation is
 * already in hand.**
 *
 * ⚑ **D-016 · commit 6 · the folded waits are no such join** — `waiting-on-the-person-who-asked`
 * and (F097) `waiting-on-the-person-who-wrote` are the fold's own observations (a drive ending over
 * a row whose giver is a person; a turn a person's words opened ending), so {@link derivePieces}
 * writes them and this composition does not. ⚠️ **It reads over them all the same**: an answer
 * owed, a card a person owes or an open child of the piece is the more specific wait, and is said
 * instead — and F097's moment is then read by nobody ({@link PieceRow.answeredAPersonAt}); with
 * none, the folded wait stands.
 *
 * ## ⛔ Every OPEN state, and no exception for any of them
 *
 * ⚑ **{@link TASK_IS_OPEN} is the whole condition.** ⚠️ A rule that fired only on `stalled` would
 * leave a giver reading `working` about an owner waiting on the giver itself; one that fired only on
 * `working` would leave `turn_ended` standing over every one of the three. ⛔ **A closed piece is
 * never touched**: a question outlives the work it was about ({@link workNamed}'s own rule), and a
 * piece taken back or closed ends its questions in the same fold that reads them.
 *
 * ## 🔴 The stall fields are CLEARED, because the invariant is load-bearing
 *
 * ⛔ **{@link PieceRow.stalledBecause} is non-null if and only if the state is `stalled`** — held by
 * construction in {@link derivePieces}, read as a type guard by {@link stalledWithACause}, and
 * spelled again on {@link WorkReport.stalledBecause}. ⚑ A composed row that kept its cause would
 * break all three at once.
 *
 * 🔴 **That clearing is also what carries the rule into the notice paths for free.**
 * {@link stalledWithACause} answers `false` for a composed row, so any reader handed composed rows
 * stops owing a stall notice about work whose question, decision or child is outstanding — and the
 * notice MOVES to the link that actually stopped: the child's own row stalls, and whoever gave THAT
 * piece out is told.
 *
 * ## ⚑ D-016 · the worker arm is THIS piece's
 *
 * ⚠️ **Until D-016 a conversation's open hand-over held every task it held**, so one task's open
 * child silenced its siblings' stalls (design notes §4). ⛔ **Now only the piece a child hangs under
 * reads `waiting-on-a-worker`**, and a sibling whose turn ended with nothing out stalls and is
 * reported.
 *
 * ## ⚑ The lookup is handed in rather than reached for
 *
 * ⛔ **Which is what keeps this module free of a database**, and what lets one test plant two rows
 * against the same derivation a host reads a store for. ⚠️ **It is asked of
 * {@link PieceRow.owner}**, the conversation HOLDING the work, because all three facts are about the
 * conversation that has to move next; asking the giver would walk the edge the wrong way. ⚠️ **It
 * is asked only for OPEN rows**, so a conversation whose work has all finished costs no read at all.
 */
export function composeWhatEachPieceIsWaitingOn(
  pieces: readonly PieceRow[],
  /** ⛔ **Everything the conversation holding a row is waiting on** — one read per conversation. */
  outstandingFor: (sessionId: string) => WhatAConversationIsWaitingOn,
): readonly PieceRow[] {
  return pieces.map((piece) => {
    if (!TASK_IS_OPEN[piece.state]) return piece
    const outstanding = outstandingFor(piece.owner)
    // ⛔ **THIS row's question and THIS row's children** — see {@link whichWait}, which holds the
    // precedence for both readers.
    const wait = whichWait(
      outstanding.answers.has(piece.piece),
      outstanding.aPerson,
      outstanding.childrenOpen.has(piece.piece),
    )
    if (wait === null) return piece
    return { ...piece, state: wait, stalledBecause: null, stalledAt: null, stalledBy: null }
  })
}

/**
 * 🔴 **The PRECEDENCE, spelled ONCE and read by both projections of it** (621, `HO-095` §5.1).
 *
 * ⛔ **Two spellings of *answer beats person beats worker* is exactly the shape `HO-091` §1 refused
 * one layer up** (*"one surface composes and one does not, so they differ by construction"*), so the
 * ladder is here and each reader hands it the facts about its own SUBJECT.
 *
 * ## ⛔ The two keyed arms are the caller's question, and the middle one is not
 *
 * ⚑ **{@link WhatAConversationIsWaitingOn.answers} and {@link WhatAConversationIsWaitingOn.childrenOpen}
 * are SETS keyed by piece**, so each has two honest readings and they belong to different subjects:
 *
 *  - ⛔ **about ONE ROW** — `has(piece.piece)`, which is the most specific true statement about that
 *    row;
 *  - ⛔ **about the CONVERSATION** — `size > 0`, which is *it asked, or handed work out, and that is
 *    still open*. ⚠️ See {@link theWaitAConversationIsIn}.
 *
 * 🔴 **Neither reading is derivable from the other**, which is why the arms are PARAMETERS rather
 * than a branch on a nullable id. ⚑ **`aPerson` is already a conversation-wide boolean** and is read
 * identically by both.
 */
function whichWait(
  /** ⛔ **An answer is outstanding FOR THE SUBJECT THE CALLER IS ASKING ABOUT.** */
  anAnswerIsOutstanding: boolean,
  aPersonOwesSomething: boolean,
  /** ⛔ **Work handed out under THE CALLER'S SUBJECT is still open.** */
  aChildIsOpen: boolean,
): ConversationWait | null {
  return anAnswerIsOutstanding
    ? 'waiting-on-an-answer'
    : aPersonOwesSomething
      ? 'waiting-on-a-person'
      : aChildIsOpen
        ? 'waiting-on-a-worker'
        : null
}

/**
 * 🔴 **What ONE CONVERSATION is waiting on — the waits a conversation can be in
 * ({@link ConversationWait}), about the conversation itself rather than about a row it holds** (621,
 * `HO-095` §5.1 · `EXT-014` §5).
 *
 * ## ⛔ The hole this closes, measured rather than argued
 *
 * ⚠️ **`HO-095` §5.1:** *"BroBot's header, avatar and rail row read* Idle *while Task #1 was being
 * worked on by Ada."* ⛔ **Every fact needed to say otherwise was already folded** — ⚑ **and the only
 * PLACE the app could say it was a task row.** 🔴 A conversation a person started held no task row at
 * all, so the composition had nothing to write the wait onto and every agent-state surface read
 * `idle`. ⚠️ **It still holds no ROW since D-016**: its root is its own work, and a root is never a
 * row (R1). ⚑ **D-036 · the ONE state says the worker wait now**, of every conversation whatever
 * its depth, and names who holds the work (`agentStateOf`'s *waiting on <name>*). ⚠️ **So this —
 * the poll's `waiting` — has no reader in the app**: every row the host builds carries its
 * verdicts, which the window reads instead, and only a reading built without them (a test's
 * hand-made one) falls back to it.
 *
 * ## ⚠️ It answers a DIFFERENT question from the composition, and that is the whole point
 *
 * ⛔ **`621` §4.4 named the two and forbade conflating them**, and they stay two reads over one
 * source:
 *
 * | | |
 * |---|---|
 * | ⚑ **{@link composeWhatEachPieceIsWaitingOn}** | *is THIS PIECE OF WORK waiting on something* — a row's `state` |
 * | ⚑ **this** | *is THIS CONVERSATION waiting on something* — true of a conversation that holds no piece row at all |
 *
 * 🔴 **One field does NOT answer both**, which is
 * `widening-a-predicate-widens-every-question-its-field-answers` honoured rather than risked: a
 * conversation with one open piece waiting on an answer and a second waiting on nothing gets ONE
 * conversation-level word and TWO different row words, and both are true.
 *
 * ## ⛔ Why `size > 0` is the honest keyed arm
 *
 * ⚑ **A non-empty {@link WhatAConversationIsWaitingOn.answers} is *this conversation asked about
 * work it holds and nobody has answered*** — its root included, which `ask_question` counts as held
 * work — and a non-empty {@link WhatAConversationIsWaitingOn.childrenOpen} is *it handed work out
 * and that work is still open*: claims about the conversation, not about which row.
 *
 * ⛔ **`null` is a real answer and means *nothing this app has recorded is outstanding here*** —
 * never *we did not look*. ⚑ The caller that builds the {@link WhatAConversationIsWaitingOn} is
 * what decides whether a look happened, exactly as it does for the fold.
 */
export function theWaitAConversationIsIn(
  outstanding: WhatAConversationIsWaitingOn,
): ConversationWait | null {
  return whichWait(
    outstanding.answers.size > 0,
    outstanding.aPerson,
    outstanding.childrenOpen.size > 0,
  )
}

/**
 * 🔴 **D-006 · F018 — where the work a conversation HOLDS stands**, for a surface that draws the
 * conversation idle.
 *
 * Conversation status reports whether a turn is running, not whether held work is answered or stalled. Keep that work state separately so idle agents are not all read as stuck.
 *
 * ⚑ **Only the two facts nothing else draws.** A wait is said by the host's verdicts on the same
 * row ({@link ConversationWaiting.needsYou}, `.waitingOnTheAnswerOf`, `.waitingOnTheWorkOf`), and
 * work being driven shows as the conversation's own turn. Work taken back or closed leaves nothing
 * to say: the conversation holds nothing open, which is what *idle* already says.
 */
export type HeldWork =
  | { readonly state: 'stalled' }
  | { readonly state: 'answered'; readonly outcome: TaskOutcome | null }

/**
 * 🔴 **D-006 · the one derivation of {@link HeldWork}**, over the pieces a conversation was GIVEN,
 * COMPOSED ({@link composeWhatEachPieceIsWaitingOn}) — so a turn that ended with its work out with a
 * helper reads that wait, never *stalled* (`609`: a stall is reported at the broken link).
 *
 * ⚑ **Open work speaks first**: any of it stalled → `stalled`; any other open work → `null` (a wait,
 * or a turn driving it, already says so — and a piece a person gave, waiting on them, is said on
 * the piece only: plan ruling 9). ⚑ **With nothing open, the work that ended LAST** decides:
 * `answered`, with what its owner said of it; taken back or closed → `null`. No work → `null`.
 */
export function whereTheWorkItHoldsStands(
  held: readonly PieceRow[],
  /**
   * A root belongs to a person-started conversation whose overall work stays open. Answered work taken on for that person must not make the conversation read as over; it awaits their next words. Open held work, including stalls, still contributes here.
   */
  ownsARoot = false,
): HeldWork | null {
  const open = held.filter((piece) => TASK_IS_OPEN[piece.state])
  if (open.length > 0) {
    return open.some((piece) => piece.state === 'stalled') ? { state: 'stalled' } : null
  }
  if (ownsARoot) return null
  const last = theOneThatEndedLast(held)
  return last?.state === 'answered' ? { state: 'answered', outcome: last.outcome } : null
}

/**
 * ⚑ **The piece that ended last**, among pieces in the order they were given — the latest
 * `endedAt`, and of two that ended together the one given later. ⚠️ One choice for
 * {@link whereTheWorkItHoldsStands} and {@link theWorkThatNamesItAmong}, so a plate's word and the
 * name beside it are never about two different pieces.
 */
function theOneThatEndedLast<Piece extends Pick<PieceRow, 'endedAt'>>(
  held: readonly Piece[],
): Piece | null {
  let last: Piece | null = null
  for (const piece of held) {
    if (last === null || (piece.endedAt ?? 0) >= (last.endedAt ?? 0)) last = piece
  }
  return last
}

/**
 * 🔴 **F033 · the work that names a conversation that owns no root, among the pieces it holds** —
 * in the order they were given, the fold's own.
 *
 * ⚑ **Open work names it**: the newest open piece, and how many more it holds open. ⚑ **With
 * nothing open, the piece that ended last names it, marked with how** — answered, taken back or
 * closed ({@link theOneThatEndedLast}). No piece at all → `null`: its agent's name alone.
 *
 * ⛔ **Never the newest piece however it ended** (F033): an idle helper read as the owner of work it
 * had already handed back — Arjun as *"the owner of W1.48"* with nothing held, and Ada as working on
 * a test taken back two and a half hours before. ⚑ **The last piece, marked, rather than the name
 * alone**: two conversations of one agent stay two names, and the address a sentence hands back
 * stays a label — an ended piece's label still names its owner.
 */
export function theWorkThatNamesItAmong(
  held: readonly Pick<PieceRow, 'label' | 'title' | 'state' | 'endedAt'>[],
): WorkThatNamesIt | null {
  const open = held.filter((piece) => TASK_IS_OPEN[piece.state])
  const newest = open.at(-1)
  if (newest !== undefined) {
    return {
      label: newest.label,
      title: newest.title,
      ...(open.length > 1 ? { more: open.length - 1 } : {}),
    }
  }
  const last = theOneThatEndedLast(held)
  if (last === null) return null
  return { label: last.label, title: last.title, ...howItEnded(last.state) }
}

/** ⚑ **F033** — `{ ended }` for a state a piece ends in, and nothing for an open one. */
function howItEnded(state: TaskState): { readonly ended?: HowAPieceEnded } {
  return state === 'answered' || state === 'withdrawn' || state === 'closed' ? { ended: state } : {}
}

/**
 * ⚑ **F088 · one piece, as a sentence about it names it** — its label and the title it stands under
 * now, marked with how it ended once it has ({@link howItEnded}), so the piece a message is about
 * reads as {@link theWorkThatNamesItAmong} would mark it. ⚑ No count: it is one piece.
 */
export function onePieceAsItStands(
  piece: Pick<PieceRow, 'label' | 'title' | 'state'>,
): WorkThatNamesIt {
  return { label: piece.label, title: piece.title, ...howItEnded(piece.state) }
}

/**
 * 🔴 **One conversation, and the one wait it is in** (621) — the row
 * {@link WhatEachConversationIsWaitingOn} carries.
 *
 * ⛔ **Both ids and no name.** `agentName(identity, identities)` is the app's one naming function
 * (`449`), and a display name computed on this row would be a second answer to *what is this
 * identity called* — {@link ConversationAtWork}'s own rule, one reading over, kept rather than
 * restated.
 */
export interface ConversationWaiting {
  /** The conversation's own id — what every other door on this wire calls `sessionId`. */
  readonly conversation: string
  /**
   * ⚑ **The identity this conversation runs as** — `HostedSession.profileId`, the slug resolved
   * once at launch. ⛔ It is here so a surface keyed by IDENTITY rather than by conversation can
   * ask its own question without a second read, which is exactly why
   * {@link ConversationAtWork.identity} exists.
   */
  readonly identity: string
  /**
   * 🔴 **The one wait this conversation is in, or `null` for none** — see
   * {@link theWaitAConversationIsIn}, which holds the precedence.
   *
   * ⛔ **`null` is *nothing recorded is outstanding*, never *nobody looked***: every row in this
   * reading was built from three narrow ledger reads taken at {@link
   * WhatEachConversationIsWaitingOn.readAt}. ⚠️ **676 · *recorded and readable*** — when
   * {@link WhatEachConversationIsWaitingOn.rowsUnread} is above `0`, a `null` here may be a wait
   * whose row could not be read, and a surface that says *nothing is outstanding* must say that too.
   *
   * ⛔ **D-016 · commit 6 · never the wait a piece a person gave reads**: that one is the piece's
   * (plan ruling 9), so this is a {@link ConversationWait}.
   *
   * ⚠️ **D-036 · read by no window off a row the host built** — see
   * {@link theWaitAConversationIsIn}: a window reads {@link needsYou}, {@link waitingOnTheAnswerOf}
   * and {@link waitingOnTheWorkOf}, and falls back to this only when a reading carries none of them.
   */
  readonly waiting: ConversationWait | null
  /**
   * 🔴 **D-006 · where the work it holds stands** — {@link whereTheWorkItHoldsStands} over its own
   * composed rows, or `null` for nothing to say. ⚑ On this row because it is the same population and
   * the same clock (a ledger write) as the waits, and the rail and the plates read it beside them.
   */
  readonly work: HeldWork | null
  /**
   * ⚑ **D-017 · R11 · R19 — a person's answer or approval is waiting in it**: a question asked of a
   * person or passed up to one, a decision, an ask against its rules, or a card that went to
   * nobody but a person — the host's one reading (`RuntimeHost.whoOwesIt`), the same `list_agents`
   * says *needs you* from, so the window draws it rather than working it out.
   *
   * ⚠️ Optional only for a reading built without it (a test's hand-made one): absent is *not read*.
   */
  readonly needsYou?: boolean
  /**
   * ⚑ **D-017 · R19 — what to call the conversation a question it asked went to** — its parent, or
   * the agent it named, named by the piece it owns (D-016 · commit 7 · R3) — or `null` when none: the
   * same reading, the same words (*"waiting on an answer from <name>"*).
   */
  readonly waitingOnTheAnswerOf?: string | null
  /** When it asked that question, epoch ms, or `null`; absent is *not read*, as above. */
  readonly waitingOnTheAnswerSince?: number | null
  /**
   * ⚑ **D-036 · what to call each conversation holding open work it gave** — each once, named by the
   * piece it owns, in the order of its oldest open give — or none: the same reading, the same words
   * (*"waiting on <name>"*). ⚠️ Optional only for a reading built without it, as {@link needsYou}
   * is: absent is *not read*.
   */
  readonly waitingOnTheWorkOf?: readonly string[]
  /** When it gave out the oldest of that open work, epoch ms, or `null`; absent is *not read*. */
  readonly waitingOnTheWorkSince?: number | null
  /**
   * The open work it gave whose holder has stopped with it ({@link StoppedWork}), oldest give
   * first. These pieces are not in {@link waitingOnTheWorkOf}: nothing is driving them, so this
   * conversation is not waiting on their holders. Absent is *not read*, as above.
   */
  readonly stoppedWork?: readonly StoppedWork[]
}

/**
 * A piece a conversation gave whose holder has stopped with it open: its turn ended with the
 * piece open, it asked no question about it and handed none of it out, it isn't parked on purpose,
 * and nothing is on its way to it (no start, no running turn, no words held for it).
 */
export interface StoppedWork {
  /** The piece's id. */
  readonly piece: string
  /** Its label, such as `W6.4.1`. */
  readonly label: string
  /** What to call the conversation holding it: its agent's name. */
  readonly holder: string
  /** The conversation holding it, by id: where a person looks. */
  readonly holderConversation: string
  /** When it stopped, epoch ms. */
  readonly at: number
}

/**
 * 🔴 **What every conversation this app is RUNNING is waiting on, as of ONE stated moment** (621,
 * `HO-095` §5.1 · `EXT-014` §5).
 *
 * ## ⛔ Its own door rather than a field on {@link WhatIsBeingDone}, and the reason is that
 * reading's own sentence
 *
 * ⚠️ **`whatIsBeingDone`'s docblock says *"No store read of any kind"* and argues it** — *"what is
 * it doing right now is a live fact and a ledger holds durable ones"* (`421`'s split). ⛔ **Every
 * fact here is a LEDGER fact**, so putting it on that row would have falsified the paragraph that
 * justifies its cost, which is `a-description-hardens-into-a-ruling-in-the-docblock-it-leaves`
 * arriving as a design choice rather than as a comment.
 *
 * ⚑ **And the two move on different clocks.** `told` moves when a provider frame arrives —
 * seconds — and a wait moves when somebody writes a ledger row. ⛔ A caller that needs both takes
 * them in ONE `Promise.all` and stamps its own instant, which is `588`'s rule stated where it
 * belongs: the pairing is the CALLER's, never a reading pretending to be two.
 *
 * ## ⛔ COMPLETE, for {@link WhatIsBeingDone.conversations}' reason exactly
 *
 * ⚑ **Every running conversation appears, `waiting: null` included.** ⚠️ A reading that listed
 * only the waiting rows would make *this conversation is waiting on nothing* and *this reading
 * does not cover it* one absence, and a surface cannot tell those apart — which is
 * `an-unenumerated-state-counts-as-success` with the enumeration on the wire.
 *
 * ⛔ **A conversation this app is NOT running is absent**, and that is the same gate
 * `whatIsBeingDone` uses: it draws no live state anywhere, so a wait about it would be a fact with
 * no surface and a ledger read with no reader.
 */
export interface WhatEachConversationIsWaitingOn {
  /**
   * ⛔ **The one moment every row below had been read by** — `WorkspaceReading.readAt`'s and
   * {@link WhatIsBeingDone}'s rule, and the same argument: `better-sqlite3` executes on this
   * thread and nothing here awaits, so no conversation can move between two of these rows and land
   * in one of them.
   *
   * ⚠️ **It is not a claim about NOW.** ⚑ It moves on ledger writes rather than on a clock, so it
   * ages far more slowly than a doing line — but a surface that draws it beside an age should draw
   * THIS one and not the neighbouring reading's.
   */
  readonly readAt: number
  /** ⛔ **Every conversation this app was running at {@link readAt}, and no others.** */
  readonly conversations: readonly ConversationWaiting[]
  /**
   * 🔴 **676 · F1 — how many ledger rows this answer's wait reads could not read**, counted ONCE
   * however many conversations' reads met the same row — `LedgerWalk.rowsUnread`'s meaning and its
   * rule: a count, never a cause.
   *
   * ⛔ **Until `676` a torn row here was skipped with a warning and nothing else**, so a
   * conversation whose question row was torn read *waiting on nothing* on the Team plate and the
   * rail, with no sign that anything had been missed. ⚠️ **Above `0`, any `waiting` below may be
   * narrower than the truth** — a torn row cannot say whose wait it was, so the count is the
   * answer's and never a conversation's.
   */
  readonly rowsUnread: number
  /**
   * 🔴 **D-017 · R8 — how many conversations' records a read here skipped WHOLE**, present only
   * when there were some. ⚠️ Above `0`, a conversation below may be waiting without saying so.
   */
  readonly ledgersSkipped?: number
}

/**
 * 🔴 **D-016 · the seven piece events, in the order `events_work_idx` lists them** — every event type
 * that is about one piece, in its owner's ledger (R5).
 *
 * ⛔ **Three lists must say the same seven words**: this one, the partial index in `db/schema.ts`
 * and the store's piece reads — a partial index serves a query only when the query's type list
 * implies the index's. ⚑ Typed against the union, so a renamed event is a compile error here.
 */
export const PIECE_EVENT_TYPES = [
  'work_given',
  'work_replied',
  'work_taken_back',
  'work_retitled',
  'work_status_set',
  'work_rebriefed',
  'work_closed',
] as const satisfies readonly TranscriptEvent['type'][]

/**
 * The stalls a wait on purpose outlasts: the drive ended while nothing was owed. ⛔ Not a
 * brief that never reached its holder, nor a holder that can never be reopened — both leave the
 * piece with nobody, and its giver must be told — nor a stall only a person can clear.
 */
export const A_WAIT_ON_PURPOSE_OUTLASTS: Readonly<Record<TaskStallCause, boolean>> = {
  turn_ended: true,
  turn_interrupted: true,
  app_restarted: true,
  background_stopped: true,
  message_never_sent: false,
  could_not_be_reopened: false,
  provider_limited: false,
  login_refused: false,
  billing_refused: false,
}

/**
 * ⚑ **D-016 · commit 6 · R4 — the piece a delivery row names for THIS ledger**: a brief's or a new
 * brief's own `piece`, else the piece it `drives`; `null` — it names none — drives every open
 * piece. ⛔ A row never carries both (`UserTurnEvent.drives`).
 *
 * ⚑ **D-022 · R4 — one spelling, read by the fold ({@link derivePieces}) and by the host**, which
 * keeps what each conversation's open turn drives, for `give_work`'s inference.
 */
export function theDriveOf(event: {
  readonly piece?: string
  readonly drives?: string
}): string | null {
  return event.piece ?? event.drives ?? null
}

function aNoteExpectsNoReply(
  one: Pick<
    Extract<TranscriptEvent, { type: 'user_turn' }>,
    'says' | 'attribution' | 'work' | 'relayedFrom' | 'appNotice' | 'piece'
  >,
): boolean {
  return (
    one.says === 'note' &&
    !aPersonsOwnWords(one) &&
    one.piece === undefined &&
    one.work === undefined &&
    one.appNotice === undefined
  )
}

/** Personal words drive their targets unless another substantive message names the same piece. */
function aPersonOpenedTheTurnFor(
  parts: readonly Pick<
    Extract<TranscriptEvent, { type: 'user_turn' }>,
    'attribution' | 'work' | 'relayedFrom' | 'appNotice' | 'piece' | 'drives' | 'says'
  >[],
): (piece: string) => boolean {
  const theirs = parts.filter(aPersonsOwnWords)
  if (theirs.length === 0) return () => false
  const everyPiece = theirs.some((one) => theDriveOf(one) === null)
  const theirPieces = new Set(theirs.map(theDriveOf).filter((one): one is string => one !== null))
  const anotherNamed = new Set(
    parts
      .filter((one) => !aPersonsOwnWords(one) && !aNoteExpectsNoReply(one))
      .map(theDriveOf)
      .filter((one): one is string => one !== null),
  )
  return (piece) => (everyPiece || theirPieces.has(piece)) && !anotherNamed.has(piece)
}

/**
 * 🔴 **D-027 · the one piece a delivered turn drives** — {@link theDriveOf} of every message it
 * delivered (`theMessagesOf`), when they all name the same one. ⛔ `null` when one of them names
 * none — the turn drives every open piece — or two of them name different pieces: a turn that drives
 * several is about no one piece. ⚑ A turn of one message answers what {@link theDriveOf} answers.
 */
export function theDriveOfTheTurn(
  messages: readonly { readonly piece?: string; readonly drives?: string }[],
): string | null {
  const drives = new Set(messages.map(theDriveOf))
  const [only] = drives
  return drives.size === 1 ? (only ?? null) : null
}

/**
 * The pieces a turn's messages name, each once, oldest first — where {@link theDriveOfTheTurn}
 * answers `null` both for words that name none and for words that name different pieces, this
 * tells the two apart. ⚑ Words that name none add nothing.
 */
export function thePiecesTheTurnNames(
  messages: readonly { readonly piece?: string; readonly drives?: string }[],
): readonly string[] {
  return [...new Set(messages.flatMap((one) => theDriveOf(one) ?? []))]
}

/**
 * 🔴 **The whole of S1: one conversation's ledger folded into the pieces it was given** (379 as
 * tasks; pieces since D-016).
 *
 * ⛔ **Pure, total, and ordered by the ledger it was handed.** The caller supplies the entries in
 * ordinal order — every reader in the app already does — and the fold walks them once.
 *
 * ## ⚠️ The transitions, and the guard each one needs
 *
 * ⚠️ **Stated without a COUNT** (`396`'s rule, and `398` needed it here): a list whose sentence
 * counts itself goes quietly wrong the first time anything is added to it.
 *
 *  - **`work_given`** opens the row: `waiting` when it carries a {@link WorkGivenEvent.messageId}
 *    (the owner was busy and the brief is being held), `working` when it does not (the owner was
 *    idle and the brief went straight out — or the owner took the work on itself, mid-turn, with
 *    `take_on_work`). ⛔ Two starting states because there are two branches in the delivery, not
 *    because a caller chose. ⚑ Its giver is copied as given: `null` is a person (D-016 · commit 6).
 *    ⚑ **A root has no such row, so no root is ever a row here** (D-016 · R1).
 *  - **`message_queued`** records nothing on a piece; it notes what the held words will drive when
 *    they go out (D-005a) — the piece its row names, or every open piece (D-016 · commit 6 · R4).
 *  - **`message_unqueued`** ends the wait, and only for the piece holding THAT message id — `354`'s
 *    rule that an unnamed ending may not be paired with a named beginning is why the comparison is
 *    on the string and never on position. `sent` → `working`; `cancelled` → `withdrawn`;
 *    `abandoned` → `stalled`, because the app went away before the work was ever handed over
 *    (400 — it used to be terminal, and see {@link TaskStallCause.app_restarted}). ⚑ And held work
 *    no waiting message drives any more is let go (D-005a): it stalls, or waits on the person who
 *    asked, on its turn's cause — except what the message that went out drives.
 *  - **`work_replied`** closes the row at `answered`, carrying the outcome, the summary (719) — which
 *    is also its status line, said by the owner — the resources and the person-flag off the event.
 *    ⛔ **Only for a piece this ledger still holds OPEN**, which is the whole of *"a second reply is
 *    a refusal"* expressed as a fold rather than as a check somebody has to remember: a closed piece
 *    is not in `open`, so a duplicate event lands on nothing. ⚑ It is ABOVE the turn branch on
 *    purpose — the reply is a tool call INSIDE the turn it ends, so the piece is already `answered` by
 *    the time the turn's ending arrives and the `working` guard below passes over it. **That ordering
 *    is what makes a stall mean *no reply* rather than *no reply yet*.** ⚑ And once its owner has
 *    answered every piece its open turn was started for, the turn goes back to what an interrupt cut
 *    to make room for it — provisionally ({@link cutByAnInterrupt}).
 *  - **`reply_undelivered`** moves nothing; on a row already `answered` it sets
 *    {@link PieceRow.answerReachedNobody} (`724`, R84) — the owner's own record, written after its
 *    reply, that the words reached no conversation (since `729`, R89, also when they were held and
 *    then lost). ⛔ A row no reply closed is passed over, and so is one that names no piece.
 *  - **`work_retitled`**, **`work_status_set`** and **`work_rebriefed`** set the row's title, its
 *    status line or its brief, open or ended — the newest one stands. ⛔ A row this ledger holds no
 *    piece for is passed over, and that is every line about the owner's own ROOT, which is never a
 *    row. ⚑ A new brief's own `user_turn` drives its piece again, as any turn naming it does. ⚑ **The
 *    owner's own status line, written while it runs, drives its piece** — the owner saying where it
 *    stands on that work is the owner working it; ⛔ the rest move nothing.
 *  - **`turn`** stalls a `working` piece a conversation gave, whichever way the turn ended:
 *    `completed` and `failed` carry {@link TaskStallCause.turn_ended}, `interrupted` carries
 *    {@link TaskStallCause.turn_interrupted} — and an ask to stop that preceded it rides on
 *    either as {@link PieceRow.stalledBy} (`720`, R72). ⚑ A `working` piece a person gave waits on
 *    them instead, with no cause (`waiting-on-the-person-who-asked`, D-016 · commit 6 · R3).
 *    ⚑ **F097** — and one a conversation gave waits on the person who wrote, with no cause, when a
 *    person's own words opened the turn, it ended on its own and nobody asked it to stop
 *    (`waiting-on-the-person-who-wrote`). ⚑ Unless something holds it — a waiting message that will drive it, running background work,
 *    or an earlier drive's hold this turn did not drive ({@link endOfDrive}).
 *    ⚠️ **The `working` guard is load-bearing and its absence is a real defect rather than a tidy
 *    one**: a piece queued behind a running turn sees THAT turn's ending arrive before its own
 *    brief is ever sent, so an unguarded rule would report work as undriven that had not yet been
 *    handed over. ⚑ What the turn went back to, with nothing naming it since, stands as its earlier
 *    stall instead; and an interrupted turn — or one a stop was asked of (F075) — hands what it
 *    stalled to the next turn ({@link cutByAnInterrupt}).
 *  - **`work_taken_back`** closes the row at `withdrawn` — the giver taking the work back (429).
 *    ⛔ **Only for a piece this ledger still holds OPEN**, which is `work_replied`'s sentence one
 *    verb over and is what makes *a piece is taken back once* a property of the fold rather than a
 *    check the door has to remember. ⚑ **It is the SECOND producer of that state and not the
 *    first**: `message_unqueued` with `cancelled` already reached a piece whose brief was still held,
 *    and the two are one act at that door — the take-back cancels the held brief and then writes
 *    this row, so a `waiting` piece derives `withdrawn` from whichever row the fold meets first and
 *    from the other one never.
 *  - **`work_closed`** closes the row at `closed` — the giver ending the work without a reply
 *    (D-016). ⛔ **Only for a piece this ledger still holds OPEN**, `work_taken_back`'s sentence in
 *    its own state; its door writes it before it takes back any held brief, so a `waiting` piece
 *    derives `closed` and not `withdrawn`.
 *  - **`work_restarted`** stalls each piece it NAMES that is still `waiting` or `working` at
 *    {@link TaskStallCause.app_restarted} — the launch found work nobody had finished. ⛔ It passes
 *    over a piece that is already `stalled`, which is what makes the sweep that writes it idempotent
 *    across launches without needing to remember anything; and over a piece given after it, which
 *    it cannot name. ⚑ A drive still waiting for its turn's row when the app went away drove every
 *    open piece first (D-016 · commit 6 · R4) — the launch read that named them saw it so. ⚑ What a
 *    drive had gone back to stands as its earlier stall first ({@link restoreTheEarlierStalls}).
 *  - **`user_turn`** records nothing on a piece; it opens a new turn, so it clears an older
 *    remembered ask before that different turn can end, and it drives again what its owner already
 *    holds (D-005) — since D-016 · commit 6 · R4 only the piece it names ({@link
 *    UserTurnEvent.piece}, or {@link UserTurnEvent.drives}), or every open piece when it names
 *    none. ⛔ An idle Stop has no terminal underneath it, and without this boundary its actor could
 *    leak onto a later cancellation (491). ⚑ It notes what the turn was started for, and what the
 *    last interrupt cut that it does not name ({@link cutByAnInterrupt}). ⚑ A turn whose words asked
 *    for that interrupt drives what the cut turn was driving, at once and as its own
 *    ({@link UserTurnEvent.askedForTheStop}). ⚑ **F097** — and whose words drove each piece it
 *    drives, which a wake after it keeps ({@link whoseWordsDroveItLast}).
 *  - **`user_decision`** records nothing and moves nothing; a `cancel` remembers WHO pressed it,
 *    for the `turn` ending underneath it (494). ⛔ **Every other outcome is passed over** — they
 *    answer a request rather than stopping a turn. ⚑ It is the same branch shape as the one below
 *    it and the same field, which is what makes *the last ask wins* one rule rather than two.
 *  - **`work_interrupted`** records nothing and moves nothing; it remembers WHO asked, for the
 *    `turn` ending underneath it (484). ⛔ **Not a transition** — the ask is not what stalls the
 *    work, the ending is — and it is cleared by that ending whether or not anything used it, or by
 *    a later `user_turn` when no such ending belonged to the ask.
 *  - **`request_routed`** records nothing and moves nothing; it only remembers which question ids
 *    were the PARENT's to answer, which is what the branch below needs and cannot get from its own
 *    event.
 *  - **`request_stranded`** sets {@link PieceRow.questionLostAtRestart} on everything still open, for
 *    a question that had travelled, and changes no state. ⚑ **The one branch here that is not a transition**, which is the shape
 *    `deriveRoutedRequests` already carries for `request_escalated`: *has this ended?* and *was
 *    something lost underneath it?* are two questions, and one vocabulary answering both is how a
 *    word comes to imply something nobody said.
 *  - **`status`** — `working` and `idle` start and end a drive (D-013); a drive asked to stop is
 *    carried on by the next turn whose words asked for that stop ({@link theCutTurnDrove}), as a
 *    `turn` a stop cut is. ⚑ A `working` with no turn
 *    open leaves what it drives to the turn's row (D-016 · commit 6 · R4): a drive that ends, or a
 *    read that stops, before any such row came drove every open piece. ⛔ **A terminal one
 *    (`ended` | `errored`) is no cause of its own** (D-016c, `05`): the open turn's own row, which
 *    `close()` and a fatal error write first, has decided what it drove — a background wake's too,
 *    since F080 (`startedBy`); a wake in a ledger written before, which has no such row, is ended
 *    here as an interrupted turn ({@link endOfDrive}); and the background commands die with the
 *    process while the schedule does not ({@link backgroundMoved}). ⚑ What a drive had gone back to stands as its
 *    earlier stall first ({@link restoreTheEarlierStalls}).
 *    ⚑ So a piece stalls on a turn's cause and never on a stop. ⚠️ It closed them until `400`
 *    (HO-018 §2.3), and stalled them `conversation_ended` until D-016c.
 *    ⛔ **A stream that FAILED under the host is a stop this fold is not told about**: the host
 *    writes a fatal `error`, which no branch here reads, and the adapter's own `turn` and terminal
 *    `status` go into a queue that has already failed. What its owner was driving reads `working`
 *    until a row moves it — the end of its owner's next drive, or the next launch's
 *    `work_restarted`.
 *  - **nothing else.** Every other event type is passed over, which is why a fold over a 27,000-row
 *    conversation costs one comparison per row.
 *
 * ## ⛔ Why a crashed `message_queued` cannot be answered here
 *
 * ⚠️ **A ledger holding `message_queued` with no ending is BYTE-IDENTICAL in the two cases that
 * matter** — the app is live and holding the message, and the app died holding it (`354` measured
 * both, and measured that the next launch wrote no ending either). ⛔ **So no function over the
 * ledger alone can tell them apart, and this one must not try.** A dangling held message derives to
 * `waiting`, truthfully, and the repair belongs where the difference is knowable: at startup, in
 * `SessionStore.settleStrandedMessages`, which writes the ending the crash could not. ⚑ **`400` is
 * the same sentence one case over**: a piece whose brief HAD been sent leaves a ledger that is
 * byte-identical for an owner still thinking and an owner whose app was killed, so
 * `SessionStore.settleRestartedWork` writes that difference down too, at the one moment nothing is
 * running.
 */
export function derivePieces(
  owner: string,
  entries: readonly PersistedEventInfo[],
  /**
   * 🔴 **D-013 · does this conversation's provider wake it when its background work ends?** — the
   * provider's own `backgroundWake` capability, read by the store. ⚑ Claude does (a backgrounded
   * command's notification, a scheduled job firing); Codex does not (`275`, measured: a background
   * terminal's end reaches no model), so its background work holds nothing.
   */
  options: {
    readonly trackChanges?: boolean
    /** The source ordinal of each observed stall, kept outside the public piece row. */
    readonly onStall?: (piece: string, ordinal: number) => void
    readonly backgroundWakesIt?: boolean
    /** ⚑ **F076** — this conversation's provider, for whose login a refusal names ({@link StoppedOnALogin.provider}). */
    readonly provider?: TurnLimitOnTheRow['provider']
  } = {},
): readonly PieceRow[] {
  const rows: PieceRow[] = []
  const changeTimes = new Map<string, { at: number; order: number }>()
  let changeAt = 0
  let changeOrder = 0
  let sourceOrdinal = -1
  const noteChange = (before: PieceRow, after: PieceRow): void => {
    if (
      options.trackChanges &&
      (theStateAsRead(before) !== theStateAsRead(after) ||
        before.statusLine !== after.statusLine ||
        before.definitionOfDone !== after.definitionOfDone) &&
      (changeTimes.get(after.piece)?.order ?? -1) <= changeOrder
    )
      changeTimes.set(after.piece, { at: changeAt, order: changeOrder })
  }
  // ⚠️ **Mutable state per open piece, folded down at the end.** A `PieceRow` is `readonly` because a
  // caller must not be able to edit a derivation; the fold keeps its own boxes.
  const open = new Map<string, { row: PieceRow; index: number }>()
  // ⚑ **724 · where each piece's row is, open or not** — `reply_undelivered` lands AFTER the reply
  // that closed the piece, and a line about a title or a status can land on an ended one, so `open`
  // has already let it go.
  const indexOfPiece = new Map<string, number>()
  const byMessage = new Map<string, string>()
  // ⚑ **Which of this conversation's questions were the PARENT's to answer** (400) — see
  // {@link PieceRow.questionLostAtRestart}. ⛔ Ids only: what became of each one is
  // `deriveRoutedRequests`' answer and this fold must not grow a second opinion about it.
  const travelled = new Set<string>()
  /**
   * 🔴 **484/491 · the ask the current turn ending belongs to, and nothing further back.**
   *
   * ⛔ **Consumed by the `turn` row it precedes, or discarded when a later `user_turn` opens.**
   * Those are the terminal and opener boundaries that keep it a fact about one turn rather than a
   * name that leaks forward. ⚠️ **The clearing is the load-bearing half**: a permission answered
   * `cancel` ends its turn `interrupted` — in the provider's own word since 709, unless the stream
   * then dies and the latch makes it this app's marked word (`720`, R71) — with NO
   * `work_interrupted` row at all,
   * so an idle ask left standing across the new turn would put a person's name on a cancellation
   * they never touched — which is `222`'s false sentence arriving through a different door.
   *
   * ⚑ **The LAST ask wins**, which is `howWorkStopped`'s own rule in this fold's currency: a person
   * stopping a turn an agent already asked about is named as the person.
   *
   * ⛔ **494 · TWO producers write into this box now**, and the sentence above is why that is safe
   * rather than ambiguous: whichever row the fold met last is the ask the ending belongs to.
   * ⚠️ The clearing paragraph's example moved with it — a permission answered `cancel` now writes
   * its own actor here, so what an idle ask must not cross into is a LATER turn, not this one.
   */
  let asked: Pick<AskToStop, 'by' | 'asker'> | null = null
  /** Whose words last drove each piece; notes preserve the author behind an existing person wait. */
  const whoseWordsDroveItLast = new Map<string, boolean>()
  let aPersonOpenedThisTurnFor: ((piece: string) => boolean) | null = null
  /** ⚑ **F097** — a person's own words last drove this piece ({@link whoseWordsDroveItLast}). */
  const aPersonOpenedItFor = (piece: string): boolean => whoseWordsDroveItLast.get(piece) === true
  /**
   * ⚑ **F097** — the ending each piece waiting on the person who wrote went to wait from: its moment
   * ({@link PieceRow.answeredAPersonAt}) and its cause, for a reply held for it ({@link aReplyIsHeldFor}).
   */
  const waitsOnWhoWroteSince = new Map<
    string,
    { readonly at: number; readonly cause: TaskStallCause }
  >()

  // ⚠️ **`carried` is what the REPLY brings and nothing else ever passes** — every other transition
  // moves a state and touches no field the agent authored. ⛔ Written as an explicit parameter
  // rather than as a mutation after the call, so a transition that forgot to clear it is a compile
  // error at the call site instead of a row that inherits another event's outcome.
  //
  // 🔴 **`stalledBecause` is CLEARED here and set nowhere but {@link stall}** (400). That is what
  // makes *"non-null if and only if the state is `stalled`"* a property of the code rather than a
  // sentence in a docblock: this function cannot write the state and the cause independently.
  const settle = (
    piece: string,
    state: Exclude<TaskState, 'stalled'>,
    at: number,
    /** 🔴 **D-025 · whose act the row is** — {@link PieceRow.endedBy}: `null` when it names nobody. */
    by: string | null,
    carried: Pick<
      PieceRow,
      | 'outcome'
      | 'summary'
      | 'resources'
      | 'needsUserAction'
      | 'statusLine'
      | 'resultDocument'
      | 'savedMethod'
    > | null = null,
  ): void => {
    const held = open.get(piece)
    if (held === undefined) return
    // ⛔ **The ending is stamped only for a state the table calls closed.** `stalled` is open, so it
    // carries no `endedAt` — see {@link PieceRow.endedAt}.
    const endedAt = TASK_IS_OPEN[state] ? held.row.endedAt : at
    // ⚑ **D-025 · and whose act it was, by the same rule** — the moment and the actor come off one
    // row, so they are stamped, and kept, together.
    const endedBy = TASK_IS_OPEN[state] ? held.row.endedBy : by
    const next: PieceRow = {
      ...held.row,
      ...(carried ?? {}),
      // ⚑ **D-025 · above `state`, and not beside `endedAt`**: `400` anchors the three lines from
      // `state,` to `stalledBecause: null,`, and a line among them would change their bytes.
      endedBy,
      state,
      endedAt,
      stalledBecause: null,
      // ⚑ **484 · cleared with the cause, because they are one fact written in three fields.**
      // {@link PieceRow.stalledBecause}'s own rule — *the fold cannot write the state and the cause
      // independently* — extended to the moment and the actor, so a `working` row can never carry
      // *who stopped it* from a stall it has since come back from.
      stalledAt: null,
      stalledBy: null,
    }
    noteChange(held.row, next)
    rows[held.index] = next
    if (TASK_IS_OPEN[state]) open.set(piece, { row: next, index: held.index })
    else {
      open.delete(piece)
      if (held.row.messageId !== null) byMessage.delete(held.row.messageId)
    }
  }

  /**
   * 🔴 **The only way into `stalled`, and it cannot be taken without saying what was observed**
   * (400).
   *
   * ⛔ **`stalled` is OPEN**, so nothing is stamped and nothing leaves `open` — the piece is still
   * somebody's to finish and a later reply or a later turn still reaches it.
   */
  const stall = (
    piece: string,
    cause: TaskStallCause,
    at: number,
    /** ⚑ **D-005a** — the ask of the turn that ended, for a stall written after it ({@link heldForTheQueue}). */
    by: PieceRow['stalledBy'] = asked,
    /** ⚑ What was running in the background for it and stopped — {@link PieceRow.stoppedInTheBackground}. */
    stopped: readonly string[] = [],
    /** ⚑ **F074** — the usage limit its turn ended on — {@link PieceRow.stoppedOnALimit}. */
    limit?: StoppedOnALimit,
    /** ⚑ **F076** — an earlier login stall this one restores — {@link PieceRow.stoppedOnALogin}. */
    login?: StoppedOnALogin,
  ): void => {
    const held = open.get(piece)
    if (held === undefined) return
    // ⚑ **D-017 · R10 — `could_not_be_reopened` is final** (its own note): a row written after the
    // `replaced_by` — the message that carried the work, ended as what it held was handed on — does
    // not re-word it.
    if (held.row.stalledBecause === 'could_not_be_reopened') return
    // ⚑ Written or dropped at every stall, so a row never carries an earlier stall's list or limit.
    const {
      stoppedInTheBackground: earlier,
      stoppedOnALimit: earlierLimit,
      stoppedOnALogin: earlierLogin,
      ...unstalled
    } = held.row
    void earlier
    void earlierLimit
    void earlierLogin
    const next: PieceRow = {
      ...unstalled,
      ...(stopped.length > 0 ? { stoppedInTheBackground: stopped } : {}),
      // ⚑ **F074** — handed only with `provider_limited`, by the turn that ended on the limit.
      ...(limit === undefined ? {} : { stoppedOnALimit: limit }),
      // ⚑ **F076** — handed only with `login_refused`, by the drive that failed on the login; and
      // reopened when a `reopened` row has come since.
      ...(login === undefined
        ? {}
        : {
            stoppedOnALogin:
              login.reopened || reopenedSinceItsLoginWasRefused
                ? { ...login, reopened: true }
                : login,
          }),
      state: 'stalled',
      endedAt: null,
      stalledBecause: cause,
      stalledAt: at,
      // 🔴 **484 · who asked is carried only where a TURN's ask can reach** — and since `720` (R72)
      // that is both turn causes: {@link AN_ASK_RIDES_ON}. ⛔ A launch sweep, a message the app
      // never sent and a replacement have no turn ending for an ask to precede, and a `by` on any
      // of them would be this fold guessing at an author the ledger does not record.
      stalledBy: AN_ASK_RIDES_ON[cause] ? by : null,
    }
    noteChange(held.row, next)
    rows[held.index] = next
    open.set(piece, { row: next, index: held.index })
    options.onStall?.(piece, sourceOrdinal)
  }

  /**
   * 🔴 **D-016 · commit 6 · R3 — the drive that held this piece ended with it open.** A piece
   * stalls on the drive's cause; ⚑ a piece a PERSON gave waits on them instead — no cause, no
   * notice, no band (`waiting-on-the-person-who-asked`) — where their own words opened the turn, it
   * ended on its own and nobody asked it to stop. ⚑ **F097 · and a piece a conversation
   * gave waits on the person who wrote** (`waiting-on-the-person-who-wrote`) when a person's own
   * words opened the turn, it ended on its own ({@link A_TURN_THAT_ANSWERED_A_PERSON_ENDS_ON}) and
   * nobody asked it to stop. ⚑ Every caller hands it a `working`
   * piece: the end of a drive ({@link endOfDrive}) and the holds let go after one
   * ({@link nothingWillDriveIt}, {@link backgroundMoved}, and the queue's own per piece).
   */
  const endedWithItOpen = (
    piece: string,
    cause: TaskStallCause,
    at: number,
    by: PieceRow['stalledBy'] = asked,
    stopped: readonly string[] = [],
    limit?: StoppedOnALimit,
    login?: StoppedOnALogin,
    /**
     * ⚑ **F097** — a person's own words opened the turn this is the end of, for this piece: the
     * drive's own, or what a hold kept of the drive whose ending it put off.
     */
    aPersonWroteIt = aPersonOpenedItFor(piece),
    /** ⚑ **F097** — since when it waited on that person, when a reply held for it is let go. */
    since?: number,
  ): void => {
    const held = open.get(piece)
    if (held === undefined) return
    if (
      held.row.giver !== null &&
      aPersonWroteIt &&
      by === null &&
      A_TURN_THAT_ANSWERED_A_PERSON_ENDS_ON[cause]
    ) {
      const waits: PieceRow = {
        ...held.row,
        state: 'waiting-on-the-person-who-wrote',
        endedAt: null,
        stalledBecause: null,
        stalledAt: null,
        stalledBy: null,
      }
      noteChange(held.row, waits)
      rows[held.index] = waits
      open.set(piece, { row: waits, index: held.index })
      waitsOnWhoWroteSince.set(piece, { at: since ?? at, cause })
      return
    }
    // ⚑ A piece a person gave waits on them only where they asked in the turn that ended: their own
    // words opened it, it ended on its own, and nobody asked it to stop. ⛔ Otherwise it stopped,
    // with its cause, and nothing says the person owes it anything.
    if (
      held.row.giver !== null ||
      !aPersonWroteIt ||
      by !== null ||
      !A_TURN_THAT_ANSWERED_A_PERSON_ENDS_ON[cause]
    ) {
      stall(piece, cause, at, by, stopped, limit, login)
      return
    }
    const next: PieceRow = {
      ...held.row,
      state: 'waiting-on-the-person-who-asked',
      endedAt: null,
      stalledBecause: null,
      stalledAt: null,
      stalledBy: null,
    }
    noteChange(held.row, next)
    rows[held.index] = next
    open.set(piece, { row: next, index: held.index })
  }

  /**
   * 🔴 **D-005a · F019 — the messages waiting in this conversation's OWN queue**, by id.
   *
   * ⚑ Measured by BroBot (F019's fix check, 2026-09-27, task #25): both helpers answered while their
   * owner was mid-turn, so their answers waited in its queue. Its turn ended with no helper work
   * open, the fold stalled its work, and the giver was told *"not being worked on"* about 10 s before
   * those answers started the owner's next turn. ⛔ **A message waiting here IS something driving
   * the work**: it starts the next turn when it goes out.
   *
   * ⚠️ An unnamed row (written before messages had names, `354`) pairs with nothing and is not
   * counted: counted, it could never leave, and the work would never stall.
   *
   * 🔴 **D-016 · commit 6 · R4 — each one maps to what it will drive** when it goes out
   * ({@link theDriveOf}): the one piece its row names, or `null` — every open piece, as every row
   * written before commit 6 does. ⚑ So work is held only for a message that will drive it.
   */
  const waitingToDriveIt = new Map<string, { target: string | null; note: boolean }>()
  const aWaitingMessageDrives = (piece: string, preservesPersonWait = false): boolean =>
    [...waitingToDriveIt.values()].some(
      ({ target, note }) =>
        (!preservesPersonWait || !note) && (target === null || target === piece),
    )
  /**
   * 🔴 **D-005a · work a turn ended on while something waited to drive it** — what that turn's end
   * would have written (a stall, or since D-016 · commit 6 the wait on the person who asked), kept so
   * that it is still written if no waiting message that drives it goes out (HO-018 §2.1: *nobody
   * waits forever in silence*). The row reads `working` meanwhile.
   */
  const heldForTheQueue = new Map<
    string,
    {
      readonly cause: TaskStallCause
      readonly by: PieceRow['stalledBy']
      readonly stopped?: readonly string[]
      /** ⚑ **F076** — the login rider its drive's end chose, handed on at the release. */
      readonly login?: StoppedOnALogin
      /** ⚑ **F097** — a person's own words opened the turn that drive ended, handed on at the release. */
      readonly aPersonWroteIt?: boolean
      /** ⚑ **F097** — since when it waited on that person, for a reply held for it ({@link aReplyIsHeldFor}). */
      readonly since?: number
    }
  >()
  const holdsAPersonReply = (
    piece: string,
    held:
      { aPersonWroteIt?: boolean; by: PieceRow['stalledBy']; cause: TaskStallCause } | undefined,
  ): boolean => {
    const row = open.get(piece)?.row
    return (
      row !== undefined &&
      row.giver !== null &&
      held?.aPersonWroteIt === true &&
      held.by === null &&
      A_TURN_THAT_ANSWERED_A_PERSON_ENDS_ON[held.cause]
    )
  }
  /**
   * 🔴 **D-013 · the background work this conversation's provider reports running** — ids to what
   * each is (`background_work`'s level, less what it says ENDED) and the wake-ups it has scheduled
   * (`scheduled_work`'s level). Levels REPLACE, never merge (`247`).
   */
  const inTheBackground = new Map<string, string>()
  const scheduled = new Map<string, string>()
  const backgroundWakesIt = options.backgroundWakesIt === true
  /** ⚑ **D-013 · a drive ended on these while waking background work ran** — see {@link PieceRow.inTheBackground}. */
  const heldForTheBackground = new Map<
    string,
    {
      readonly cause: TaskStallCause
      readonly by: PieceRow['stalledBy']
      /** ⚑ **F076** — the login rider its drive's end chose, handed on at the release. */
      readonly login?: StoppedOnALogin
      /** ⚑ **F097** — a person's own words opened the turn that drive ended, handed on at the release. */
      readonly aPersonWroteIt?: boolean
    }
  >()
  /**
   * ⚑ **F076 — work its held background stalled as that work finished, while the provider's wake
   * was still to come** ({@link backgroundWakesIt}), by when: the wake's drive judges it again — and
   * a session a refused login ends before that wake ran stalls it on the login instead. ⚑ **F097** —
   * work that release left waiting on the person who wrote, too, by the same moment.
   */
  const stalledAsItsWakeWasDue = new Map<string, number>()
  /**
   * ⚑ **F076 — the stop being read ended the session on a refused login** — set around the stop
   * arm's own {@link endOfDrive}, so the drive it cut stalls `login_refused` rather than
   * `turn_interrupted`.
   */
  let theStopWasARefusedLogin = false
  /** ⚑ …and that login was an API key a person saved (`onAKey` on the stop's `status`). */
  let theStopWasOnAKey = false
  /**
   * ⚑ **F076 — a `reopened` row since the last refused login** — so a stall written after the
   * reopen (a hold let go later, a stall put back) says it was reopened.
   */
  let reopenedSinceItsLoginWasRefused = false
  /** ⚑ **D-013 · a turn is open** (a received message opened it, and its `turn` has not closed it). */
  let aTurnIsOpen = false
  /**
   * 🔴 **D-016 · commit 6 · R4 — a drive began (`status: working` with no turn open) and its turn's
   * row has not come**: that row says what it drives. ⚑ Until it comes — and for a wake, which no
   * message opens — the drive is every open piece's, as a `status: working` was before per-piece driving:
   * a stall notice asked at this row must not tell a giver *"not being worked on"* about work the
   * coming turn drives. ⚑ Resolved by {@link aDriveNamedNothing} wherever the drive's end is judged,
   * and at the end of the read.
   */
  let aDriveWaitsForItsTurn = false
  let pendingDriveAt = 0
  let pendingDriveOrder = 0
  /**
   * ⚑ **D-013 · the provider is running and no `turn` has ended the drive yet** — set by `working`,
   * cleared by a `turn` or a stop. ⚑ A background wake ends on its own `turn` row since F080
   * (`startedBy`); in a ledger written before, it went idle again, or was stopped, with no turn.
   */
  let driving = false
  /**
   * 🔴 **The work an interrupt cut, and the turn it made room for** — measured: an interrupt made
   * room for another piece's brief, and its owner answered that piece and went back, in the same
   * turn, to the work the interrupt had stopped — which read stalled until its own reply, and
   * refused every give to its owner meanwhile.
   *
   *  - {@link cutByAnInterrupt} — what an interrupted turn stalled, each by the moment of that stall,
   *    handed to the next turn. ⚑ **F075** — and what a turn a stop was asked of stalled, when its
   *    provider ended it otherwise (`completed`, or `failed` short of a usage limit or a refused
   *    login).
   *  - {@link theTurnNames} — the pieces that turn was started for, when its row named each of them;
   *    `null` when it named none, which drove every open piece already.
   *  - {@link theTurnGoesBackTo} — what the interrupt cut and that turn does not name. ⛔ Only a
   *    piece still standing on the stall the interrupt made is gone back to.
   *
   * ⚑ **Once its owner has answered every piece it was started for and the turn goes on, it goes
   * back to those** ({@link goBackToWhatTheInterruptCut}) — ⚠️ provisionally ({@link wentBackTo}): at
   * the turn's end, one nothing named since stands as its earlier stall, cause, moment and ask whole
   * ({@link restoreTheEarlierStalls}) — ⛔ never a new `turn_ended`, and never held for the
   * background.
   */
  let cutByAnInterrupt = new Map<string, number>()
  let theTurnNames: Set<string> | null = null
  let theTurnGoesBackTo = new Map<string, number>()
  /**
   * ⚑ **What a drive a stop cut was driving, as the cut left each piece** — stalled at a moment
   * (and whether that drive had only gone back to it), waiting on the person who gave it, or held
   * for the background — for a next turn whose words asked for that stop
   * ({@link UserTurnEvent.askedForTheStop}): it carries on with them, as the cut drive did.
   */
  type AsTheCutLeftIt =
    | { readonly stalledAt: number; readonly wentBack: boolean }
    | { readonly waitsOnItsPerson: true }
    | { readonly heldForTheBackground: true }
  let theCutTurnDrove = new Map<string, AsTheCutLeftIt>()
  const wentBackTo = new Map<
    string,
    {
      readonly cause: TaskStallCause
      readonly at: number
      readonly by: PieceRow['stalledBy']
      readonly limit?: StoppedOnALimit
      readonly login?: StoppedOnALogin
    }
  >()
  /**
   * ⚑ **D-005a** — nothing will go out of the queue (the conversation was replaced): write what each
   * held piece's drive ended as, now.
   */
  const nothingWillDriveIt = (at: number): void => {
    for (const [piece, was] of heldForTheQueue) {
      if (open.get(piece)?.row.state === 'working') {
        endedWithItOpen(
          piece,
          was.cause,
          at,
          was.by,
          was.stopped,
          undefined,
          was.login,
          was.aPersonWroteIt === true,
          was.since,
        )
      }
    }
    heldForTheQueue.clear()
  }

  /**
   * ⚑ **F097 · a person's own words, held while their conversation is busy, are their reply** — so
   * each piece waiting on the person who wrote that those words will drive (`target`, or every piece
   * when they name none) is `working` again, held for the queue with the ending it waited from
   * (D-005a): the words going out drive it, and their being taken back leaves it waiting on that
   * person again, since the moment it first did. ⛔ Until then the person's list and count would ask
   * them for a reply they already wrote.
   */
  const aReplyIsHeldFor = (target: string | null): void => {
    for (const [piece, held] of [...open]) {
      if (held.row.state !== 'waiting-on-the-person-who-wrote') continue
      if (target !== null && target !== piece) continue
      const was = waitsOnWhoWroteSince.get(piece)
      if (was === undefined) continue
      heldForTheQueue.set(piece, {
        cause: was.cause,
        by: null,
        aPersonWroteIt: true,
        since: was.at,
      })
      const driven: PieceRow = { ...held.row, state: 'working' }
      noteChange(held.row, driven)
      rows[held.index] = driven
      open.set(piece, { row: driven, index: held.index })
    }
  }

  /**
   * 🔴 **D-013 · the background moved** — and when nothing waking is left, the work it held stalls
   * (*"it stalls only if that ends with no reply"*). ⚠️ The provider's wake, if one comes, starts a
   * drive ({@link drivenAgain}) and its end is judged again by {@link endOfDrive}.
   */
  const backgroundMoved = (
    at: number,
    /**
     * ⚑ **What a conversation's END stopped**, and the cause its producer named for it — handed in,
     * so this helper names no cause of its own: the work held on it stalls on that, never on its
     * turn's own cause.
     */
    ended: {
      readonly cause: TaskStallCause
      readonly by: PieceRow['stalledBy']
      readonly stopped: readonly string[]
    } | null = null,
  ): void => {
    if (inTheBackground.size + scheduled.size > 0) return
    for (const [piece, was] of heldForTheBackground) {
      if (open.get(piece)?.row.state !== 'working') continue
      const why = ended ?? was
      // ⚑ **D-016 · commit 6 · R4 — a message queued since, that will drive it, holds it now**, as
      // it would have held it at its drive's end: a drive that named another piece left this hold
      // standing ({@link drivenAgain}), and a message waiting IS something driving the work.
      if (aWaitingMessageDrives(piece, ended === null && holdsAPersonReply(piece, was)))
        heldForTheQueue.set(piece, why)
      else {
        endedWithItOpen(
          piece,
          why.cause,
          at,
          why.by,
          ended?.stopped,
          undefined,
          ended === null ? was.login : undefined,
          ended === null && was.aPersonWroteIt === true,
        )
        // ⚑ **F076** — finished, not stopped, on a provider whose wake comes next.
        if (ended === null && backgroundWakesIt) stalledAsItsWakeWasDue.set(piece, at)
      }
    }
    heldForTheBackground.clear()
  }

  /**
   * ⚑ **The drive that went back ends**: each piece it went back to that nothing named since stands
   * as its earlier stall again ({@link wentBackTo}) — a stall it was handed, put back, so it names
   * none of its own. Answers which.
   */
  const restoreTheEarlierStalls = (): string[] => {
    const restored: string[] = []
    for (const [piece, was] of wentBackTo) {
      if (open.get(piece)?.row.state !== 'working') continue
      stall(piece, was.cause, was.at, was.by, [], was.limit, was.login)
      restored.push(piece)
    }
    wentBackTo.clear()
    return restored
  }

  /** Drive the target work; informational notes keep existing person waits and their pending holds. */
  const drivenAgain = (target: string | null, preservesPersonWait = false): void => {
    // ⚑ **D-005a** — and what its queue was holding for it has driven it: nothing is owed.
    // ⚑ **D-013** — nor what the background held: the drive that ends next decides again.
    if (target === null) {
      for (const holds of [heldForTheQueue, heldForTheBackground]) {
        for (const [piece, held] of holds) {
          if (!preservesPersonWait || !holdsAPersonReply(piece, held)) holds.delete(piece)
        }
      }
    } else {
      for (const holds of [heldForTheQueue, heldForTheBackground]) {
        if (!preservesPersonWait || !holdsAPersonReply(target, holds.get(target)))
          holds.delete(target)
      }
    }
    for (const [piece, held] of [...open]) {
      if (target !== null && piece !== target) continue
      // Notes leave the person wait in place; substantive drives clear it.
      if (held.row.state === 'waiting-on-the-person-who-wrote') {
        if (preservesPersonWait) continue
        const driven: PieceRow = { ...held.row, state: 'working' }
        noteChange(held.row, driven)
        rows[held.index] = driven
        open.set(piece, { row: driven, index: held.index })
        continue
      }
      const cause = held.row.stalledBecause
      // ⚑ **D-016 · commit 6 · R3** — a piece a person gave that waits on them is driven as a stall
      // its owner running again ends is; neither leaves any other state.
      if (held.row.state !== 'waiting-on-the-person-who-asked') {
        if (held.row.state !== 'stalled' || cause === null) continue
        if (!ITS_OWNER_RUNNING_AGAIN_DRIVES_IT[cause]) continue
      }
      const next: PieceRow = {
        ...held.row,
        state: 'working',
        stalledBecause: null,
        stalledAt: null,
        stalledBy: null,
      }
      noteChange(held.row, next)
      rows[held.index] = next
      open.set(piece, { row: next, index: held.index })
    }
  }

  /**
   * ⚑ **D-016 · commit 6 · R4 — the drive that began with no turn open is judged, or the read ends,
   * and no turn's row said what it drives**: it drove every open piece
   * ({@link aDriveWaitsForItsTurn}).
   */
  const aDriveNamedNothing = (): void => {
    if (!aDriveWaitsForItsTurn) return
    aDriveWaitsForItsTurn = false
    drivenAgain(null)
  }

  /**
   * ⛔ **A note on every open piece, and never a transition** (400) — see
   * {@link PieceRow.questionLostAtRestart}.
   *
   * ⚠️ **Every OPEN one, because the ROUTING rows do not name a piece.** A conversation asks its
   * parent a question while it is doing work; which of the pieces it holds a MODEL-raised question
   * was about is not a fact the ledger contains, and inventing an attribution would be worse than
   * saying it of all the work that was in flight.
   *
   * 🔴 **`437` made that conditional, and this fold has not caught up.** {@link QuestionAskedEvent}
   * carries a `piece`, so a question raised through `ask_question` IS attributable — and this branch
   * still marks every open piece, because it matches on `travelled`, which holds ids and not
   * subjects. ⛔ **Stated rather than quietly narrowed**: making it exact would mean reading a
   * second event type here to learn one id's subject, and `400`'s rule is that this fold keeps no
   * second opinion about a question. ⚠️ **A finding for whoever needs the precision**, not a defect
   * — the flag is deliberately generous and says so.
   *
   * ⚑ **474 took the precision somewhere else rather than narrowing this** (`463` F4). {@link
   * workNamed} resolves `question_asked.piece` for the readers that ASK about one question, so a
   * person's queue and the transcript name the work exactly — and this flag goes on being generous,
   * because it answers a different question: *which of this conversation's work lost a question at
   * a restart*, of which the ledger records the ids and not the subjects. ⛔ Widening it here would
   * still be a second opinion, and `400`'s rule still holds.
   */
  const noteTheLostQuestion = (requestId: string): void => {
    if (!travelled.has(requestId)) return
    for (const [piece, held] of [...open]) {
      if (held.row.questionLostAtRestart) continue
      const next: PieceRow = { ...held.row, questionLostAtRestart: true }
      noteChange(held.row, next)
      rows[held.index] = next
      open.set(piece, { row: next, index: held.index })
    }
  }

  /**
   * 🔴 **D-013 · a drive ENDED — a turn, or a background wake (its own turn since F080)** (and D-016c: a
   * stop that cut either) — and what each piece of work still `working` becomes: held for the queue
   * (D-005a) when a waiting message will drive it (per piece since D-016 · commit 6), held for the
   * background, or ended open — stalled, or waiting on the person who asked
   * ({@link endedWithItOpen}). ⚑ ONE decision for every edge, so a wake's end and a stop's cannot be
   * judged by another rule.
   *
   * ⛔ **D-016 · commit 6 · R4 — a piece already held is not this drive's to judge.** A drive drops
   * the hold of every piece it drives ({@link drivenAgain}), so a piece still held for the queue or
   * the background was held by an earlier drive this one did not drive: its pending ending — that
   * drive's cause and ask — stands, and a drive that named another piece neither re-causes it nor
   * puts it in the second hold. ⚑ So a piece sits in one hold at most.
   */
  const endOfDrive = (
    interrupted: boolean,
    at: number,
    /** ⚑ **F074** — the usage limit the turn ended on, when its `turn` row carries one. */
    limit?: StoppedOnALimit,
    /** ⚑ **F076** — its provider refused the login the turn's conversation was started with (`loginRefused`). */
    loginRefused = false,
    /** ⚑ …and that login was an API key a person saved (`onAKey`). */
    onAKey = false,
    /** Its provider would not bill the account the turn ran on (`billingRefused`). */
    billingRefused = false,
  ): void => {
    // 🔴 **The ONE place the two TURN causes are produced** — for a `turn`, a wake and a stop
    // alike, so a wake's end is a turn's end, said the same way (`400`'s one producer per cause).
    //
    // 🔴 **`interrupted` is INCLUDED, and `393` and `398` both excluded it** (400). ⛔ Their
    // reason was that folding it here *"would report work as `said nothing` the instant somebody
    // pressed Stop"* — a complaint about the word `silent`, which is gone. ⚑ An interrupted turn
    // is nothing driving the work, said plainly, and it is exactly what criterion 4 is for; the
    // cause below is what keeps the two distinguishable.
    // ⚑ **F074 — and a turn its provider refused for its usage limit is the third**, which says so.
    const cause: TaskStallCause = interrupted
      ? 'turn_interrupted'
      : limit !== undefined
        ? 'provider_limited'
        : billingRefused
          ? 'billing_refused'
          : 'turn_ended'
    // ⚑ **F076 — and one that failed on a login this Mac moved on from, the fourth**: its `turn`
    // row, or the stop of the session that login ended ({@link theStopWasARefusedLogin}).
    const onTheLogin = loginRefused || theStopWasARefusedLogin
    const because: TaskStallCause = onTheLogin ? 'login_refused' : cause
    const keyRefused = loginRefused ? onAKey : theStopWasARefusedLogin && theStopWasOnAKey
    const login: StoppedOnALogin | undefined = onTheLogin
      ? {
          reopened: false,
          ...(keyRefused ? { onAKey: true } : {}),
          ...(options.provider === undefined ? {} : { provider: options.provider }),
        }
      : undefined
    if (onTheLogin) reopenedSinceItsLoginWasRefused = false
    for (const [piece, held] of [...open]) {
      if (held.row.state !== 'working') continue
      if (heldForTheQueue.has(piece) || heldForTheBackground.has(piece)) continue
      // ⚑ **F074 — a turn its provider refused for the usage limit is said at once**: what waits to
      // drive the work — a held message, a background wake — meets the same limit, and the app
      // holds its own until the reset, so its giver would hear nothing for hours.
      // ⚑ **F097** — each hold keeps whose words opened the turn, for the ending it puts off.
      // A billing refusal is said at once for the same reason: what waits meets the same refusal
      // until a person pays.
      const saidAtOnce = limit !== undefined || billingRefused
      const personWait =
        held.row.giver !== null &&
        aPersonOpenedItFor(piece) &&
        asked === null &&
        A_TURN_THAT_ANSWERED_A_PERSON_ENDS_ON[because]
      if (!saidAtOnce && aWaitingMessageDrives(piece, personWait)) {
        heldForTheQueue.set(piece, {
          cause: because,
          by: asked,
          ...(login ? { login } : {}),
          aPersonWroteIt: aPersonOpenedItFor(piece),
        })
      } else if (!saidAtOnce && backgroundWakesIt && inTheBackground.size + scheduled.size > 0) {
        heldForTheBackground.set(piece, {
          cause: because,
          by: asked,
          ...(login ? { login } : {}),
          aPersonWroteIt: aPersonOpenedItFor(piece),
        })
      } else endedWithItOpen(piece, because, at, asked, [], limit, login)
    }
  }

  /**
   * ⚑ **The open turn's owner has answered what it was started for, and the turn goes on: it goes
   * back to what the interrupt cut** — each still stalled by that interrupt is driven again,
   * remembering its stall ({@link wentBackTo}).
   */
  const goBackToWhatTheInterruptCut = (): void => {
    for (const [piece, cutAt] of theTurnGoesBackTo) {
      const held = open.get(piece)?.row
      if (held?.state !== 'stalled' || held.stalledAt !== cutAt) continue
      if (held.stalledBecause === null) continue
      wentBackTo.set(piece, {
        cause: held.stalledBecause,
        at: cutAt,
        by: held.stalledBy,
        ...(held.stoppedOnALimit === undefined ? {} : { limit: held.stoppedOnALimit }),
        ...(held.stoppedOnALogin === undefined ? {} : { login: held.stoppedOnALogin }),
      })
      drivenAgain(piece)
    }
    theTurnGoesBackTo = new Map()
  }

  /**
   * ⚑ **A drive a stop cut has ended: note what it was driving, as the cut left it** — see
   * {@link theCutTurnDrove}. `heldBefore` is the background's hold as the drive's end found it.
   */
  const noteWhatTheCutDrove = (
    driven: readonly string[],
    wentBack: readonly string[],
    heldBefore: ReadonlySet<string>,
  ): void => {
    theCutTurnDrove = new Map()
    for (const piece of [...driven, ...wentBack]) {
      const row = open.get(piece)?.row
      if (row?.state === 'stalled' && row.stalledAt !== null) {
        theCutTurnDrove.set(piece, { stalledAt: row.stalledAt, wentBack: wentBack.includes(piece) })
      } else if (row?.state === 'waiting-on-the-person-who-asked') {
        theCutTurnDrove.set(piece, { waitsOnItsPerson: true })
      } else if (
        row?.state === 'working' &&
        heldForTheBackground.has(piece) &&
        !heldBefore.has(piece)
      ) {
        theCutTurnDrove.set(piece, { heldForTheBackground: true })
      }
    }
  }

  /**
   * ⚑ **The turn opened by words that asked for the stop carries on with what it cut** — each piece
   * still as the cut left it is driven again: as this turn's own, or, where the cut drive had only
   * gone back to it and this turn does not name it, provisionally again ({@link wentBackTo}).
   */
  const carryOnWithWhatTheCutDrove = (
    cut: ReadonlyMap<string, AsTheCutLeftIt>,
    startedFor: ReadonlySet<string> | null,
  ): void => {
    for (const [piece, how] of cut) {
      const row = open.get(piece)?.row
      if (row === undefined) continue
      if ('waitsOnItsPerson' in how) {
        if (row.state === 'waiting-on-the-person-who-asked') drivenAgain(piece)
      } else if ('heldForTheBackground' in how) {
        if (row.state === 'working' && heldForTheBackground.has(piece)) drivenAgain(piece)
      } else if (row.state === 'stalled' && row.stalledAt === how.stalledAt) {
        if (row.stalledBecause === null) continue
        if (how.wentBack && startedFor !== null && !startedFor.has(piece)) {
          wentBackTo.set(piece, {
            cause: row.stalledBecause,
            at: how.stalledAt,
            by: row.stalledBy,
            ...(row.stoppedOnALimit === undefined ? {} : { limit: row.stoppedOnALimit }),
            ...(row.stoppedOnALogin === undefined ? {} : { login: row.stoppedOnALogin }),
          })
        }
        drivenAgain(piece)
      }
    }
  }

  for (const entry of entries) {
    changeAt = entry.at
    sourceOrdinal = entry.ordinal
    changeOrder += 1
    const event = entry.event
    if (event.type === 'user_turn') {
      // ⚑ **F076** — a turn of ours runs: what it drives is its own to judge.
      stalledAsItsWakeWasDue.clear()
      // 🔴 **491 · a new turn is the boundary an idle ask cannot cross.** A person's Stop
      // while nothing is running still writes `work_interrupted`, truthfully, but a later permission
      // can be cancelled without writing another ask. Keeping the idle row until that later turn's
      // terminal would name the person as the author of a cancellation they did not perform.
      //
      // ⛔ **The boundary is the durable row that OPENS the turn**, not `work_given`: a piece can
      // be given while an older turn is still running, and clearing there would erase the real
      // author of that older turn's ending. `SessionStore.appendTx` opens turns on this exact event.
      asked = null
      aTurnIsOpen = true
      // ⚑ **D-016 · commit 6 · R4** — the drive a `status: working` began is this turn's, and this
      // row says what it drives.
      aDriveWaitsForItsTurn = false
      // 🔴 **D-005 · and the turn it opens drives the work its owner already holds** (F019) — since
      // D-016 · commit 6 · R4 the piece it names, or every open piece when it names none.
      // ⚑ **D-027 · a turn that delivered several messages drives what each of them drives** — its
      // parts as the store's replay bound left them (`boundTheParts`): each an object with words.
      // ⚠️ A row whose parts none read drives every open piece, as a turn that names none does.
      const parts = event.parts ?? [event]
      // Track personal authorship for each piece that a substantive message drives.
      const aPersonsFor = aPersonOpenedTheTurnFor(parts)
      aPersonOpenedThisTurnFor = aPersonsFor
      const substantive = parts.filter((one) => !aNoteExpectsNoReply(one))
      // ⚑ **What it was started for, and what it would go back to** ({@link cutByAnInterrupt}).
      const named = parts.map(theDriveOf).filter((one): one is string => one !== null)
      const startedFor = parts.length > 0 && named.length === parts.length ? new Set(named) : null
      theTurnNames = startedFor
      // ⚑ **Words that asked for the stop carry on with what it cut** — see
      // {@link carryOnWithWhatTheCutDrove}.
      const carriesOn =
        event.askedForTheStop === true ? theCutTurnDrove : new Map<string, AsTheCutLeftIt>()
      theCutTurnDrove = new Map()
      theTurnGoesBackTo =
        startedFor === null
          ? new Map()
          : new Map(
              [...cutByAnInterrupt].filter(
                ([piece]) => !startedFor.has(piece) && !carriesOn.has(piece),
              ),
            )
      cutByAnInterrupt = new Map()
      // ⚑ **F097** — whose words drove each piece this turn drives: the pieces its messages name,
      // every open one when one names none, and what it carries on with.
      const drivesEvery = parts.length === 0 || named.length < parts.length
      for (const piece of [...(drivesEvery ? open.keys() : []), ...named, ...carriesOn.keys()]) {
        if (
          (open.get(piece)?.row.state === 'waiting-on-the-person-who-wrote' ||
            holdsAPersonReply(piece, heldForTheQueue.get(piece)) ||
            holdsAPersonReply(piece, heldForTheBackground.get(piece))) &&
          parts.length > 0 &&
          !substantive.some((one) => theDriveOf(one) === null || theDriveOf(one) === piece)
        )
          continue
        whoseWordsDroveItLast.set(piece, aPersonsFor(piece))
      }
      // A follow-up naming a piece ends its wait on purpose; any other words leave it standing.
      for (const one of parts) {
        const followedUp = one.says === 'follow-up' ? theDriveOf(one) : null
        const index = followedUp === null ? undefined : indexOfPiece.get(followedUp)
        const held = index === undefined ? undefined : rows[index]
        if (followedUp === null || index === undefined || held?.statusLine?.waiting !== true)
          continue
        const next: PieceRow = { ...held, statusLine: withoutTheWait(held.statusLine) }
        noteChange(held, next)
        rows[index] = next
        if (open.has(followedUp)) open.set(followedUp, { row: next, index })
      }
      carryOnWithWhatTheCutDrove(carriesOn, startedFor)
      if (parts.length === 0) drivenAgain(null)
      for (const one of parts) drivenAgain(theDriveOf(one), aNoteExpectsNoReply(one))
      continue
    }
    if (event.type === 'work_given') {
      const messageId = event.messageId ?? null
      const row: PieceRow = {
        piece: event.piece,
        label: event.label,
        parent: event.parent,
        title: event.title,
        brief: event.brief,
        definitionOfDone: event.definitionOfDone ?? null,
        giver: event.givenBy,
        owner,
        givenAt: entry.at,
        messageId,
        state: messageId === null ? 'working' : 'waiting',
        endedAt: null,
        endedBy: null,
        outcome: null,
        stalledBecause: null,
        stalledAt: null,
        stalledBy: null,
        questionLostAtRestart: false,
        summary: null,
        answerReachedNobody: false,
        resources: [],
        needsUserAction: false,
        statusLine: null,
        // ⚑ **W4.189** — the folder its give named, as recorded with it; an older give has none.
        ...(event.givenFolder === undefined ? {} : { givenFolder: event.givenFolder }),
        ...(event.asked === undefined ? {} : { asked: event.asked }),
        // ⚑ **W4.189** — a brief that went straight out was handed over with its give.
        ...(messageId === null ? { briefHandedOver: true as const } : {}),
      }
      indexOfPiece.set(event.piece, rows.length)
      open.set(event.piece, { row, index: rows.length })
      if (messageId !== null) byMessage.set(messageId, event.piece)
      rows.push(row)
      // ⚑ Work its owner took on for a person in a turn: whose words opened that turn drove it.
      if (event.givenBy === null && aTurnIsOpen && aPersonOpenedThisTurnFor !== null) {
        whoseWordsDroveItLast.set(event.piece, aPersonOpenedThisTurnFor(event.piece))
      }
      continue
    }
    if (event.type === 'message_queued') {
      // 🔴 **D-005a** — see {@link waitingToDriveIt}.
      if (event.messageId !== undefined) {
        waitingToDriveIt.set(event.messageId, {
          target: theDriveOf(event),
          note: aNoteExpectsNoReply(event),
        })
      }
      // ⚑ **F097** — a person's own words, held, are their reply ({@link aReplyIsHeldFor}).
      if (event.messageId !== undefined && aPersonsOwnWords(event)) {
        aReplyIsHeldFor(theDriveOf(event))
      }
      continue
    }
    if (event.type === 'message_unqueued') {
      // ⛔ **An unnamed ending pairs with nothing** (`354`). A ledger written before messages had
      // names holds `message_unqueued` rows with no `messageId`, and treating `undefined` as a match
      // would close whichever piece happened to be open.
      if (event.messageId === undefined) continue
      // 🔴 **D-005a · the last message that would have driven it left without going out** — so what
      // its turn's end was holding is written now. ⚑ `sent` writes nothing: the turn it starts drives
      // what it drives ({@link drivenAgain}).
      // ⚑ **D-016 · commit 6 · R4 — per piece**: held work no waiting message drives any more is let
      // go. A message that names no piece drives every one, so a ledger written before commit 6 lets
      // go exactly as it did — all at once, when the queue empties with nothing sent.
      // 🔴 **D-027 · a message SENT lets go of nothing**, for work it drives or not: several go out
      // together, each ending written before the ONE turn that delivers them all, so the work the
      // first drives would be let go at the second's ending, a moment before that turn drives it.
      // ⚑ Nothing moves for a ledger written before D-027: there each `sent` is followed by its own
      // turn, and held work whose last driving message went out is that turn's.
      if (waitingToDriveIt.delete(event.messageId) && event.reason !== 'sent') {
        for (const [one, was] of [...heldForTheQueue]) {
          if (aWaitingMessageDrives(one, holdsAPersonReply(one, was))) continue
          heldForTheQueue.delete(one)
          if (open.get(one)?.row.state === 'working') {
            endedWithItOpen(
              one,
              was.cause,
              entry.at,
              was.by,
              was.stopped,
              undefined,
              was.login,
              was.aPersonWroteIt === true,
              was.since,
            )
          }
        }
      }
      const piece = byMessage.get(event.messageId)
      if (piece === undefined) continue
      if (event.reason === 'sent') {
        const held = open.get(piece)
        if (held !== undefined) {
          // 🔴 **648 · all THREE stall fields, because they are one fact written in three** —
          // `484`'s rule, stated at {@link PieceRow.stalledAt} (*"non-null exactly when
          // `stalledBecause` is"*) and held everywhere but here. ⛔ This branch cleared the cause
          // and left the moment and the actor standing, so a `working` row could carry *who
          // stopped it* from a stall it had come back from — the exact sentence `settle`'s own
          // comment forbids, in the one writer that is neither `settle` nor `stall`.
          // ⚠️ **Unreachable today and repaired anyway**: every path that stalls a piece also ends
          // its held message, so no fold has yet had a `stalled` row whose message then went out.
          const next: PieceRow = {
            ...held.row,
            state: 'working',
            stalledBecause: null,
            stalledAt: null,
            stalledBy: null,
            // ⚑ **W4.189** — its brief went out with this turn.
            briefHandedOver: true,
          }
          noteChange(held.row, next)
          rows[held.index] = next
          open.set(piece, { row: next, index: held.index })
        }
        continue
      }
      if (event.reason === 'cancelled') {
        // ⚑ **D-025 · the row names nobody**, whoever cancelled the held brief
        // ({@link PieceRow.endedBy}).
        settle(piece, 'withdrawn', entry.at, null)
        continue
      }
      // 🔴 **`abandoned` names what happened to the MESSAGE and no longer to the piece** (400,
      // HO-018 §2.3). ⛔ The app went away before this work was handed over — *"nothing about a quit
      // tells us the work failed"* — so the giver is told nothing is driving it and decides.
      stall(piece, 'message_never_sent', entry.at)
      continue
    }
    if (event.type === 'work_replied') {
      // ⛔ **`settle` is the whole rule and there is no second check.** A reply naming a piece this
      // ledger never opened, or one it has already closed, finds nothing in `open` and changes
      // nothing — which is the same sentence the rail refuses at the tool, arrived at from the
      // other side. ⚑ Both readings agree here BECAUSE the tool refuses first; if it ever stopped,
      // this fold would still not let a second reply overwrite the first.
      settle(event.piece, 'answered', entry.at, owner, {
        outcome: event.outcome,
        // ⚑ **719 · R70 — the words, as the agent wrote them** — see {@link PieceRow.summary}.
        summary: event.summary,
        ...(event.savedMethod === undefined ? {} : { savedMethod: event.savedMethod }),
        resources: event.resources,
        ...(event.resultDocument === undefined ? {} : { resultDocument: event.resultDocument }),
        needsUserAction: event.needsUserAction === true,
        // ⚑ **D-016 · and the piece's last status line, said by its owner** — see
        // {@link PieceRow.statusLine}.
        statusLine: { text: event.summary, by: owner, at: entry.at },
      })
      // ⚑ **…and once its owner has answered everything its open turn was started for, the turn
      // goes back to what an interrupt cut for it** — see {@link cutByAnInterrupt}.
      if (aTurnIsOpen && theTurnNames?.delete(event.piece) === true && theTurnNames.size === 0) {
        theTurnNames = null
        goBackToWhatTheInterruptCut()
      }
      continue
    }
    if (event.type === 'reply_undelivered') {
      // 🔴 **724 · R84 — the answer reached no conversation** ({@link PieceRow.answerReachedNobody}).
      // ⛔ **Only on a row the fold has ANSWERED**: the words are the reply's, and a row naming a
      // piece this ledger never opened, or one no reply closed, has none to carry — nor does a row
      // written before D-016, which names no piece.
      if (event.piece === undefined) continue
      const index = indexOfPiece.get(event.piece)
      const answered = index === undefined ? undefined : rows[index]
      if (index !== undefined && answered?.state === 'answered') {
        rows[index] = { ...answered, answerReachedNobody: true }
      }
      continue
    }
    if (event.type === 'work_taken_back') {
      // 🔴 **The giver took the work back** (429). ⛔ **`settle` is the whole rule, exactly as it is
      // for a reply**: a take-back naming a piece this ledger never opened, or one it has already
      // closed, finds nothing in `open` and changes nothing. ⚑ So the door's own ended-piece rails
      // and this fold agree without either checking the other, and a ledger holding two take-backs
      // of one piece derives the same row as one.
      //
      // ⚠️ **It carries none of the owner's words onto the row** — `carried` is a reply's alone. A
      // take-back is the giver speaking about its own decision; `outcome`, `summary` (719),
      // `resources` and `needsUserAction` are the owner's words about work it did, and a piece taken
      // back has none of them. ⚑ **D-025 · only who took it back** ({@link PieceRow.endedBy}).
      settle(event.piece, 'withdrawn', entry.at, event.by)
      continue
    }
    if (event.type === 'work_closed') {
      // 🔴 **D-016 · the giver closed the work without a reply** — `work_taken_back`'s arm in its own
      // state. ⛔ **`settle` is the whole rule**: a close of a piece this ledger never opened, or one
      // already ended, changes nothing. ⚠️ It carries none of the owner's words onto the row, for
      // the take-back's reason: nobody replied — ⚑ only who closed it (D-025).
      settle(event.piece, 'closed', entry.at, event.by)
      continue
    }
    if (
      event.type === 'work_retitled' ||
      event.type === 'work_status_set' ||
      event.type === 'work_rebriefed'
    ) {
      // 🔴 **D-016 · a line about the piece, not a transition** — the newest title, status line or
      // brief stands, open or ended. ⛔ **A piece this ledger holds no row for is passed over**, and
      // that is every line about the owner's own ROOT: a root is never a row here (R1), and the store
      // reads a root's lines off the rows themselves.
      const index = indexOfPiece.get(event.piece)
      const held = index === undefined ? undefined : rows[index]
      if (index === undefined || held === undefined) continue
      const next: PieceRow =
        event.type === 'work_retitled'
          ? { ...held, title: event.title }
          : event.type === 'work_rebriefed'
            ? {
                ...held,
                ...(event.brief === undefined
                  ? {}
                  : { brief: event.brief, statusLine: withoutTheWait(held.statusLine) }),
                ...(event.definitionOfDone === undefined
                  ? {}
                  : { definitionOfDone: event.definitionOfDone }),
              }
            : {
                ...held,
                statusLine: {
                  text: event.line,
                  by: event.by,
                  at: entry.at,
                  ...theWaitItMarks(event),
                },
              }
      noteChange(held, next)
      rows[index] = next
      if (open.has(event.piece)) open.set(event.piece, { row: next, index })
      // ⚑ **Its OWNER saying where it stands, while it runs, is its owner working it** — so the
      // line drives that piece. ⛔ Not its giver's line, nor a title or a new brief: none of those is
      // the owner at work.
      if (event.type === 'work_status_set' && event.by === owner && (aTurnIsOpen || driving)) {
        if (aTurnIsOpen && aPersonOpenedThisTurnFor !== null) {
          whoseWordsDroveItLast.set(event.piece, aPersonOpenedThisTurnFor(event.piece))
        }
        drivenAgain(event.piece)
        // ⚑ Driven for real now, so its drive's end judges it as any other.
        wentBackTo.delete(event.piece)
      }
      continue
    }
    if (event.type === 'work_restarted') {
      // ⚑ **D-016 · commit 6 · R4 — a drive the app went away in, before its turn's row came, drove
      // every open piece** — the read the launch named its pieces from ended there, and saw it so.
      aDriveNamedNothing()
      // ⚑ …and what a drive went back to stands as it was, as at every end of a drive
      // ({@link restoreTheEarlierStalls}): the stall the interrupt made, never `app_restarted`.
      restoreTheEarlierStalls()
      cutByAnInterrupt = new Map()
      theCutTurnDrove = new Map()
      theTurnGoesBackTo = new Map()
      // 🔴 **The launch found work nobody had finished** (400, criterion 14). ⛔ **The pieces it
      // NAMES, and `waiting` and `working` only**: a piece already `stalled` has already told its
      // giver that nothing is driving it, and re-stating that at every launch would put a row in the
      // ledger whose only content is *the app started again*. ⚑ That guard is also the sweep's whole
      // idempotence — after this row lands, there is nothing left for the next launch to say. ⚠️ A
      // row written before D-016 names nothing, and stalls nothing. ⚑ D-016 · commit 6 · a piece a
      // person gave that waits on them is neither, so no launch names it: it stays waiting — ⚑ and
      // so does one waiting on the person who wrote (F097).
      // ⚑ A piece held for the background names what it was waiting on: after a crash nothing ended
      // the conversation in the ledger, so the work it was running is still listed here — and the
      // launch only names a piece held on a schedule when no wake-up will run it.
      const waitedOn = [...inTheBackground.values(), ...scheduled.values()]
      for (const piece of event.pieces ?? []) {
        const held = open.get(piece)
        if (held?.row.state === 'waiting' || held?.row.state === 'working') {
          stall(
            piece,
            'app_restarted',
            entry.at,
            asked,
            heldForTheBackground.has(piece) ? waitedOn : [],
          )
        }
      }
      continue
    }
    if (event.type === 'request_routed') {
      // ⛔ **No `because` is *the PARENT could have answered it*** — which is what this set is
      // for, one subject over: a question a parent could answer is one a stranding can lose.
      //
      // ⚠️ **611 · the sentence that stood here is FALSE** (HO-088 §2, standing rule 8.1). It read
      // *"the event carries `because` if and only if it carries `to: 'a-person'`, which `394` made
      // one fact seen twice"*. ⛔ **The *only if* half survives and the *if* half does not**: an
      // asker may now address a question to a person with nothing refused. ⚑ **The SET is still
      // right** — `questionLostAtRestart`'s own question is *could the parent have re-answered
      // it*, and the parent can answer an addressed question (`admitAnswer`) — so what moved is
      // the reason rather than the membership. ⚠️ Read off the EVENT here and not off
      // {@link WhereARequestWent}, because this fold has no derivation in hand.
      if (event.because === undefined) travelled.add(event.requestId)
      continue
    }
    if (event.type === 'request_stranded') {
      // 🔴 **Not a transition** (400) — see {@link noteTheLostQuestion}. The request's own fold
      // closes it `stranded`; this only reports, on the row a parent is already reading.
      noteTheLostQuestion(event.requestId)
      continue
    }
    if (event.type === 'user_decision') {
      // 🔴 **494 · the SECOND producer of an ask, and it is not a transition either.** ⛔ A
      // permission answered `cancel` ASKS the turn to stop on every door that offers it — except an
      // external-MCP elicitation card's, which since `736` (R97) asks nothing and whose row says so
      // (`stopsNothing`, passed over below; `720`'s R74 had it ask when its frame named the turn), and
      // `RuntimeHost.respondPermission` — its single writer — has recorded the caller since `477`.
      // ⚑ This fold was the missing half: the actor was in the ledger and nothing read it, which
      // is `484`'s own sentence recurring inside the reader `484` built.
      //
      // ⚠️ **`cancel` and no other outcome.** `allow`, `deny`, `answered` and `rejected` are
      // answers to a REQUEST; only this one is about the turn. ⛔ A branch that remembered them all
      // would name the person who allowed a tool as the author of whatever ended the turn next.
      //
      // ⛔ **Assigned whether or not it names anybody** — {@link whoCancelledIt}'s rule. A cancel
      // written before `477` carries no actor, and letting an earlier `work_interrupted` stand
      // would credit that person with a press they did not make, which is `491`'s defect exactly.
      if (event.stopsNothing === true) continue
      if (event.outcome === 'cancel') asked = whoCancelledIt(event.by)
      continue
    }
    if (event.type === 'work_interrupted') {
      // 🔴 **484 · remembered, never applied here** (HO-029 §2.1). ⛔ An ask is not a transition:
      // it moves no piece and stamps nothing, and the row that DOES stall the work is the `turn`
      // ending underneath it. ⚑ `397` put the actor on the neighbouring row precisely so a reader
      // joins the two rather than either one claiming the other's subject, and this fold is that
      // join performed once.
      //
      // ⚠️ **`agent` is present if and only if `by` is `an-agent`** — `WorkInterruptedEvent`'s own
      // rule — and it is cleared on every ask, so a person stopping a turn an agent already asked
      // about does not inherit the agent's name.
      asked = { by: event.by, asker: event.by === 'an-agent' ? (event.agent ?? null) : null }
      continue
    }
    if (event.type === 'turn' && event.startedBy === 'the-provider' && !aTurnIsOpen) {
      // 🔴 **F080 — the end of a turn the provider started by itself is a WAKE's end**, judged as
      // the `idle` below judges one written before F080 (with no `turn` row): only a wake that was
      // driving — and now told what the row says: a stop, a usage limit, a refused login. ⚑ So the
      // `idle` or the stop after it ends nothing more (`driving` is cleared here). ⚠️ A wake a
      // message joined (its `user_turn` opened a turn here) ends as that turn, in the arm below.
      if (driving) {
        aDriveNamedNothing()
        const heldBefore = new Set(heldForTheBackground.keys())
        const working = [...open]
          .filter(([, held]) => held.row.state === 'working')
          .map(([piece]) => piece)
        endOfDrive(
          event.state === 'interrupted',
          entry.at,
          theLimitItEndedOn(event, entry.at),
          event.state === 'failed' && event.loginRefused === true,
          event.state === 'failed' && event.onAKey === true,
          event.state === 'failed' && event.billingRefused === true,
        )
        theCutTurnDrove = new Map()
        if (asked !== null) noteWhatTheCutDrove(working, [], heldBefore)
      }
      driving = false
      // ⛔ **484 · the ask belongs to the drive it ended**, the `turn` arm's rule: an ask that
      // survived this wake would name its author as the stopper of the next one.
      asked = null
      continue
    }
    if (event.type === 'turn') {
      // ⚠️ **A snapshot, because {@link stall} writes to the map it is walking**, so the walk never
      // sees a row it has just changed. ⚑ **D-013 · the walk is {@link endOfDrive}'s**, which a
      // background wake's end asks too, and D-005a's queue and D-013's background hold it there.
      // ⚑ **D-016 · commit 6 · R4** — a drive whose turn's row never came drove every open piece.
      aDriveNamedNothing()
      // What this turn went back to, with nothing naming it since, stands as its earlier stall, and
      // what an interrupt cuts is handed to the next turn (see {@link cutByAnInterrupt}). A turn a
      // stop was asked of also cuts what it drove, however its provider ended it (Codex can say
      // `completed`), but not one that ended on a usage limit, a refused login or a billing
      // refusal: those wait for a reset, a reopen or a person paying, not for the next turn. Its
      // stall keeps the provider's word.
      const cut =
        event.state === 'interrupted' ||
        (asked !== null &&
          theLimitItEndedOn(event, entry.at) === undefined &&
          !(event.state === 'failed' && event.loginRefused === true) &&
          !(event.state === 'failed' && event.billingRefused === true))
      const wentBack = restoreTheEarlierStalls()
      const heldBefore = new Set(heldForTheBackground.keys())
      const working = cut
        ? [...open].filter(([, held]) => held.row.state === 'working').map(([piece]) => piece)
        : []
      endOfDrive(
        event.state === 'interrupted',
        entry.at,
        theLimitItEndedOn(event, entry.at),
        event.state === 'failed' && event.loginRefused === true,
        event.state === 'failed' && event.onAKey === true,
        event.state === 'failed' && event.billingRefused === true,
      )
      // ⚑ What this turn had not gone back to yet is still cut, by the same stall.
      cutByAnInterrupt = new Map(cut ? theTurnGoesBackTo : [])
      for (const piece of cut ? [...wentBack, ...working] : []) {
        const row = open.get(piece)?.row
        if (row?.state === 'stalled' && row.stalledAt !== null) {
          cutByAnInterrupt.set(piece, row.stalledAt)
        }
      }
      // ⚑ And what it was driving, for a next turn whose words asked for this stop.
      noteWhatTheCutDrove(working, cut ? wentBack : [], heldBefore)
      aTurnIsOpen = false
      aPersonOpenedThisTurnFor = null
      driving = false
      theTurnNames = null
      theTurnGoesBackTo = new Map()
      // ⛔ **484 · cleared whether or not anything used it**, and the `working` guard above is why
      // it has to be here rather than inside {@link stall}: a turn that stalled nothing has still
      // ENDED, and an ask that survived it would name the author of the next one.
      asked = null
      continue
    }
    if (event.type === 'status' && (event.state === 'ended' || event.state === 'errored')) {
      // 🔴 **D-016c · a stop is no cause of its own — it ends the drive it cut, as an interrupted
      // turn does** (`05`: an agent is never dead). ⛔ It closed every open piece until `400`
      // (HO-018 §2.3) and stalled it `conversation_ended` until D-016c; no piece reads the stop
      // itself — ⚑ only what it took away: background work a piece waited on (below).
      //
      // ⚑ **A turn it cut has already decided what it drove**: `close()` and a fatal error write the
      // open turn's own `turn` row first — and, since F080, a background WAKE's too (`startedBy`,
      // the arm above). ⚠️ **A wake in a ledger written before F080 has no such row**, and no `idle`
      // ahead of this, so a stop that cut one ends it here, `interrupted` — else its work would read
      // `working` with nothing behind it until the next start. ⛔ A stream that failed under the
      // host writes no terminal `status`, and never reaches this arm (this function's docblock).
      //
      // ⚑ **The commands it ran in the background died with it, and its schedule did not** (`253`: a
      // schedule survives a resume) — so the running level goes first, and work held on it alone
      // stalls `background_stopped`, naming those commands ({@link backgroundMoved}): never *in the
      // background* about a command that is gone, and never its turn's own cause either. ⚑ Work held for its own queue stays held: a stop hands what it held
      // on to its next start (D-017 · R3), and that message drives it.
      aDriveNamedNothing()
      // ⚑ What a drive went back to stands as it was ({@link restoreTheEarlierStalls}).
      restoreTheEarlierStalls()
      // 🔴 **…and the work held on what was RUNNING stalls on what the stop did**: its background
      // work stopped with it (`background_stopped`, naming it) — never its turn's own cause, *"its
      // turn ended with this work still open"*, which reads as the agent giving up.
      // 🔴 **F076 — a session its provider ended on a refused login**: the drive it cut failed on
      // the login ({@link theStopWasARefusedLogin}), and work whose wake never got to run stalls on
      // it too — never *its turn ended*.
      const onARefusedLogin = event.state === 'errored' && event.loginRefused === true
      theStopWasARefusedLogin = onARefusedLogin
      theStopWasOnAKey = onARefusedLogin && event.onAKey === true
      // ⚑ **The wake that never ran is the drive this stop cut**: what it would have driven, still
      // as its background's end left it, is driven again here and ends with it, on the login.
      if (onARefusedLogin) {
        for (const [piece, stalledAt] of stalledAsItsWakeWasDue) {
          const row = open.get(piece)?.row
          // ⚑ **F097** — or left waiting on the person who wrote, by that same release.
          const asItsReleaseLeftIt =
            row?.state === 'stalled'
              ? row.stalledAt === stalledAt
              : row?.state === 'waiting-on-the-person-who-wrote' &&
                waitsOnWhoWroteSince.get(piece)?.at === stalledAt
          if (!asItsReleaseLeftIt) continue
          drivenAgain(piece)
          driving = true
        }
      }
      stalledAsItsWakeWasDue.clear()
      const stoppedByTheEnd = [...inTheBackground.values()]
      inTheBackground.clear()
      if (driving || aTurnIsOpen) endOfDrive(true, entry.at)
      theStopWasARefusedLogin = false
      theStopWasOnAKey = false
      backgroundMoved(
        entry.at,
        stoppedByTheEnd.length > 0
          ? { cause: 'background_stopped', by: null, stopped: stoppedByTheEnd }
          : null,
      )
      aTurnIsOpen = false
      driving = false
      theTurnNames = null
      cutByAnInterrupt = new Map()
      theCutTurnDrove = new Map()
      theTurnGoesBackTo = new Map()
      // ⛔ **484 · the ask belongs to the drive it ended**, the `turn` arm's rule.
      asked = null
      continue
    }
    if (event.type === 'replaced_by') {
      // ⚑ **D-017 · R10 — it can never be reopened, and a new conversation took its place**: every
      // open piece it held stalls `could_not_be_reopened` — nothing will run it again.
      nothingWillDriveIt(entry.at)
      for (const [piece, held] of [...open]) {
        if (TASK_IS_OPEN[held.row.state]) stall(piece, 'could_not_be_reopened', entry.at)
      }
      continue
    }
    if (event.type === 'background_work') {
      // 🔴 **D-013** — the level REPLACES; an ending edge takes its one row away.
      if (event.running !== undefined) {
        inTheBackground.clear()
        for (const one of event.running) {
          inTheBackground.set(one.id, one.description ?? one.kind ?? one.id)
        }
      }
      if (event.ended !== undefined) inTheBackground.delete(event.ended.id)
      backgroundMoved(entry.at)
      continue
    }
    if (event.type === 'scheduled_work') {
      // A row that states no level (a scheduling call's receipt) moves nothing held on the level.
      if (event.jobs === undefined) continue
      scheduled.clear()
      for (const job of event.jobs) {
        scheduled.set(job.id, `a scheduled wake-up${job.schedule ? ` (${job.schedule})` : ''}`)
      }
      backgroundMoved(entry.at)
      continue
    }
    if (event.type === 'reopened') {
      stalledAsItsWakeWasDue.clear()
      restoreTheEarlierStalls()
      // ⚑ **F076 — reopened since its login was refused**, by whoever reopened it: each piece that
      // refusal stalled says so — after the stalls a drive went back to are restored, so a restored
      // one says so too — and so does one stalled later.
      reopenedSinceItsLoginWasRefused = true
      for (const [piece, held] of [...open]) {
        if (held.row.state !== 'stalled' || held.row.stoppedOnALogin === undefined) continue
        const next: PieceRow = {
          ...held.row,
          stoppedOnALogin: { ...held.row.stoppedOnALogin, reopened: true },
        }
        noteChange(held.row, next)
        rows[held.index] = next
        open.set(piece, { row: next, index: held.index })
      }
      aTurnIsOpen = false
      driving = false
      theTurnNames = null
      cutByAnInterrupt = new Map()
      theCutTurnDrove = new Map()
      theTurnGoesBackTo = new Map()
      // ⚑ **D-016 · commit 6 · R4** — a drive the last life began and never judged drives nothing
      // now.
      aDriveWaitsForItsTurn = false
    }
    if (event.type === 'status') {
      // 🔴 **D-013 · a background WAKE ends with no `turn`** (F019's second half, `P-001`): the
      // provider ran the model on its own and went idle again. ⚑ So *idle again, driving, with no
      // turn open* is the end of a drive, judged by the same {@link endOfDrive}. ⚑ **F080** — since
      // then a wake writes its own `turn` row, marked `startedBy` (the arm above), and this judges a
      // wake in a ledger written before. ⚠️ **Kept for those ledgers, and only for them**: every
      // conversation recorded before F080 holds its wakes this way and the fold reads the whole
      // ledger on every read, so without it a piece whose last drive was such a wake would read
      // `working`, with nothing behind it, until its holder's next turn.
      // ⚠️ Only `working` starts a drive, and `idle` ends one here (a stop, above): a card in the
      // middle of a wake (`waiting_permission`) is still that wake.
      if (event.state === 'idle') {
        if (driving && !aTurnIsOpen) {
          aDriveNamedNothing()
          // ⚑ A wake that was asked to stop is a cut drive, for words that asked for the stop.
          const heldBefore = new Set(heldForTheBackground.keys())
          const working = [...open]
            .filter(([, held]) => held.row.state === 'working')
            .map(([piece]) => piece)
          endOfDrive(false, entry.at)
          theCutTurnDrove = new Map()
          if (asked !== null) noteWhatTheCutDrove(working, [], heldBefore)
          // ⛔ **484** — the ask belongs to the drive it ended, as above.
          asked = null
        }
        driving = false
      }
      // 🔴 **D-005 · the turn's `status: working` drives again what its owner holds** — Claude writes
      // it before the turn's `user_turn`, and the owner's `status` is the row the stall notice is
      // decided on. ⚑ **D-016 · commit 6 · R4 — pending**: with no turn open, the turn's row is still
      // to say which piece it drives ({@link aDriveWaitsForItsTurn}).
      if (event.state === 'working') {
        if (!aTurnIsOpen) {
          aDriveWaitsForItsTurn = true
          pendingDriveAt = entry.at
          pendingDriveOrder = changeOrder
        }
        driving = true
      }
      // ⚑ **F076** — the wake came: its drive judges what it drives.
      if (event.state === 'working') stalledAsItsWakeWasDue.clear()
    }
  }

  // ⚑ **D-016 · commit 6 · R4 — a read taken between a `status: working` and its turn's row** sees
  // the work driven, as it did when that row drove every piece.
  if (aDriveWaitsForItsTurn) {
    changeAt = pendingDriveAt
    changeOrder = pendingDriveOrder
  }
  aDriveNamedNothing()

  // ⚑ **D-013 · what each held piece of work waits on in the background, as the reader sees it.**
  for (const [piece] of heldForTheBackground) {
    const held = open.get(piece)
    if (held === undefined || held.row.state !== 'working') continue
    rows[held.index] = {
      ...held.row,
      inTheBackground: [...inTheBackground.values(), ...scheduled.values()],
    }
  }

  // ⚑ **F075 — what a turn may still go back to**: cut by the last interrupt, while the turn it made
  // room for has not started, or is open and has not gone back to it — still on that same stall.
  for (const [piece, cutAt] of [...cutByAnInterrupt, ...(aTurnIsOpen ? theTurnGoesBackTo : [])]) {
    const held = open.get(piece)
    if (held?.row.state !== 'stalled' || held.row.stalledAt !== cutAt) continue
    rows[held.index] = { ...held.row, aTurnMayGoBackToIt: true }
  }

  // ⚑ **F097 — since when each piece still waiting on the person who wrote has waited** — see
  // {@link PieceRow.answeredAPersonAt}.
  for (const [piece, { at }] of waitsOnWhoWroteSince) {
    const held = open.get(piece)
    if (held?.row.state !== 'waiting-on-the-person-who-wrote') continue
    rows[held.index] = { ...held.row, answeredAPersonAt: at }
  }

  // ⚑ **A piece its status line marks as waiting reads so** ({@link theStateAsRead}): nothing
  // is owed until its wait is over, so no turn's end stalls it.
  for (const [piece, held] of open) {
    if (!readsAsWaitingOnPurpose(held.row)) continue
    rows[held.index] = asWaitingOnPurpose(held.row)
    open.set(piece, { row: rows[held.index] as PieceRow, index: held.index })
  }

  return options.trackChanges
    ? rows.map((row) => ({ ...row, lastRecordedChangeAt: changeTimes.get(row.piece)?.at ?? null }))
    : rows
}

/**
 * A piece read as waiting on purpose: what a stall or a drive left on the row is dropped, since
 * neither is what it stands on now.
 */
function asWaitingOnPurpose(row: PieceRow): PieceRow {
  const next: { -readonly [K in keyof PieceRow]: PieceRow[K] } = {
    ...row,
    state: 'waiting-on-purpose',
    parkedOver: row.state,
    stalledBecause: null,
    stalledAt: null,
    stalledBy: null,
  }
  delete next.stoppedInTheBackground
  delete next.stoppedOnALimit
  delete next.stoppedOnALogin
  delete next.aTurnMayGoBackToIt
  delete next.answeredAPersonAt
  return next
}

/**
 * Whether a piece reads as waiting on purpose: its newest status line carries the mark, and
 * what the fold sees under it is a drive's end or a wait on a person, never a piece left with nobody
 * or a stall a person must act on ({@link A_WAIT_ON_PURPOSE_OUTLASTS}).
 */
function readsAsWaitingOnPurpose(row: PieceRow): boolean {
  if (row.statusLine?.waiting !== true) return false
  if (row.state === 'stalled') {
    return row.stalledBecause !== null && A_WAIT_ON_PURPOSE_OUTLASTS[row.stalledBecause]
  }
  return (
    row.state === 'working' ||
    row.state === 'waiting-on-the-person-who-asked' ||
    row.state === 'waiting-on-the-person-who-wrote'
  )
}

/** The state a reader is shown: `waiting-on-purpose` where the mark covers what is under it. */
export function theStateAsRead(row: PieceRow): TaskState {
  return readsAsWaitingOnPurpose(row) ? 'waiting-on-purpose' : row.state
}

/** A status line with its wait on purpose taken off, or the line as it was when it marks none. */
function withoutTheWait(line: StatusLine | null): StatusLine | null {
  if (line?.waiting !== true) return line
  return { text: line.text, by: line.by, at: line.at }
}
