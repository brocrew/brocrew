export type TaskState = (typeof TASK_STATES)[number]

/**
 * 🔴 **The waits, DERIVED from {@link TASK_STATES} and never listed a second time.**
 *
 * ## ⛔ Why a template-literal type and not a second array
 *
 * ⚠️ **A hand-written second list is a drift hazard** —
 * `an-enumeration-whose-members-must-differ-needs-a-distinctness-check`, and
 * `a-hook-family-must-be-built-from-a-template-literal` is the shape that prevents it. ⛔ A
 * `waiting-on-…` member added to {@link TASK_STATES} joins this type, its runtime roster and
 * {@link WAITING_STANDS_FOR} in the same edit, and cannot be added to one and forgotten in the
 * others.
 *
 * ⚑ **The `-on-` is load-bearing and that is deliberate.** The bare `waiting` member — a task whose
 * MESSAGE is still in a mailbox — is not a member of this family and must not become one:
 * `'waiting'.startsWith('waiting-on-')` is false, which is the whole guard.
 *
 * ⚠️ **This is a SUBSET and not a second vocabulary.** Every member is a {@link TaskState}, every
 * member is {@link TASK_IS_OPEN}, and every surface meets all of them through `HO-091` §1's one
 * composition — which writes all but two of them, the two the fold writes beneath it.
 */
export type TaskWait = Extract<TaskState, `waiting-on-${string}`>

/**
 * ⚑ **The waits a CONVERSATION can be in** — every wait but the two the fold writes when an owner's
 * turn ends with a piece open — on a piece a person gave, or one whose turn a person's words opened
 * — which are said on the piece only (plan ruling 9).
 */
export type ConversationWait = Exclude<
  TaskWait,
  'waiting-on-the-person-who-asked' | 'waiting-on-the-person-who-wrote' | 'waiting-on-purpose'
>

export type TaskStallCause = (typeof TASK_STALL_CAUSES)[number]

export type TaskOutcome = (typeof TASK_OUTCOMES)[number]

/** One of {@link AGENT_MESSAGE_KINDS}. */
export type AgentMessageKind = (typeof AGENT_MESSAGE_KINDS)[number]

/**
 * 🔴 **What a giver is told about one piece of work it gave out, as FACTS** (HO-019 §2).
 *
 * ## ⛔ It exists because the giver's ledger holds no other record of what came back
 *
 * ⚠️ **`work_replied` is written into the OWNER's ledger and nowhere else** — by ruling: *"a reply
 * recorded in the parent's ledger would be a second half the fold could not see."* ⛔ What the giver
 * receives is WORDS, through `queueMessage`, and {@link derivePieces} folds one session's own rows
 * and can reach nothing. ⚑ So a person reading the conversation that gave the work would have a
 * paragraph and no facts — and HO-019 §2's property is *"at a glance and WITHOUT READING"*, which
 * is precisely what a paragraph cannot do.
 *
 * ⚑ **The other half is already a row.** `work_stall_told` (`work_reported` until D-016) is a row
 * in the GIVER's ledger recording that it was told about a stall; this is the same shape for a
 * READER instead of for a de-duplicator, and it rides the turn that carries the words rather than
 * being a second row free to arrive without them.
 *
 * ## ⛔ Every field is copied off the row or off the reply, and nothing here is computed
 *
 * ⚠️ **Two constructors and no third** — `workAnswered` and `workUndriven` in `reply-rails.ts`,
 * beside the sentences they travel with — so the facts a giver is shown and the words it is sent
 * cannot come to two accounts of one piece. ⛔ A caller assembling one of these inline would be two
 * vocabularies printed as one, in the one place a reader compares them.
 *
 * 🔴 **It is a SECOND SPELLING of facts the owner's ledger already holds, and that is stated rather
 * than hidden.** The giver cannot read the owner's ledger, so there is no third option; what keeps
 * the two from disagreeing is that both are written from the same {@link PieceRow} in the same
 * call, and that nothing here is re-derived afterwards. ⚠️ It is a snapshot AT THE MOMENT OF THE
 * REPORT and says so: a piece answered after a stall notice leaves the notice's report reading
 * `stalled`, truthfully, because that is what was reported then.
 *
 * ## ⛔ Every field is READ
 *
 * ⚠️ **A dead field on a DURABLE wire contract is worse than dead code**: it is written into every
 * giver's ledger for ever, and the next reader has to decide whether the absence of a consumer is
 * an omission or a ruling. ⚑ {@link owner} is what a person presses to reach the conversation the
 * work is with, and {@link resources} is what a person presses to READ what the answer handed in —
 * neither can be recovered from the sentence beside it.
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
   * 🔴 **The conversation the work is WITH** — {@link PieceRow.owner}, copied.
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
   * were none.
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
 * 🔴 **Every state a task can be in, as data.**
 *
 * ⛔ **A closed list because {@link TASK_IS_OPEN} is keyed by it**, so another state cannot be added
 * without deciding whether it is open — the shape `an-unenumerated-state-counts-as-success` exists
 * to force. ⚠️ A `for (const s of ['waiting','working'] as const)` in a test is NOT exhaustive over
 * this; loop over this constant so the tables and the loops gain a member together.
 *
 * ⚑ **This is not a planned ladder of task states and does not pretend to be.** One such ladder,
 * `PROPOSED → APPROVED → DRAFTED → READY → DISPATCHED → RUNNING → …`, needs above `DISPATCHED` a
 * proposal surface nobody has built. ⚠️ **The state below `RUNNING` is `answered`** rather than a
 * rung of that ladder, because the ladder's lower half also carries a review step nobody has built.
 * **These are the states an EVENT can put a task into today, and no others are claimed.**
 */
export const TASK_STATES = [
  'waiting',
  'working',
  /**
   * 🔴 **The worker asked the conversation that gave it this work a question, and nobody has
   * answered yet** (HO-018 §2.1 · HO-085 · HO-091 §1).
   *
   * ⛔ **OPEN, and for the same reason `stalled` is**: the work is still somebody's to finish.
   * ⚑ HO-018 §2.1 — *"`stalled` is a condition on an open task, never a terminal state"* — is the
   * sentence this member is built on, and `HO-085` §6 is where *a condition distinct from its
   * lifecycle* was read as OPEN rather than as NOT-A-STATE.
   *
   * ## ⚠️ It names what the agent is WAITING ON, as its neighbours do
   *
   * ⛔ **A vocabulary whose members answer two different questions rots**, so every wait names what
   * it is waiting on rather than what the agent did. ⚑ **The word a PERSON reads is the same** —
   * `WORK_STATE_WORD` says *waiting on an answer*. ⚠️ **Nothing durable spells it**: it is COMPOSED
   * and no {@link WorkReport} producer can write it (`workAnswered` and `workUndriven` are the only
   * two).
   *
   * ## ⛔ It is keyed to THIS piece, and the most specific of the waits
   *
   * 🔴 **`ask_question` names a piece**, so `question_asked` names the work and
   * {@link openQuestionsByWork} groups by it. ⚠️ A permission carries no piece at all, so the wait
   * on a person cannot be keyed; the wait on a worker is keyed too, but it says only that work is
   * OUT, where this one says the reader owes an answer. ⛔ **That is why this one wins the
   * precedence** — see {@link composeWhatEachPieceIsWaitingOn}.
   *
   * ## ⛔ It is COMPOSED and never folded
   *
   * ⚠️ **{@link derivePieces} cannot produce this state and must not learn to.** The fold's own
   * `travelled` set says: *"Ids only: what became of each one is `deriveRoutedRequests`' answer and
   * this fold must not grow a second opinion about it."* ⛔ Whether a question is still open is that
   * answer, so the join lives ABOVE the fold — {@link composeWhatEachPieceIsWaitingOn} — where both
   * derivations are in hand.
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
   * 🔴 **This conversation raised something only a PERSON can settle, and nobody has** (HO-088
   * §3.1's subject read the other way round).
   *
   * ⛔ **One fact about who may act.** A permission-shaped routing —
   * {@link RequestOnlyAPersonCanSettle}, every member of `ChannelRefusal` and not just the one the
   * briefs talk about. ⚑ It is raised by the conversation HOLDING the work, it is open in the
   * ledger, and the next move is a person's.
   *
   * ## ⚠️ It is a claim about the CONVERSATION, applied to the work it holds — and that is stated
   *
   * ⛔ **A permission names no piece** — a provider-raised question identifies its request and its
   * parent and NOT the work, and {@link RaisedQuestion.piece} is `null` for it for ever. ⚑ **So
   * this cannot be narrowed to one row and does not pretend to be**: every open piece the
   * conversation holds reads it, because the conversation is what is waiting. ⚠️ The alternative was
   * to invent a join the ledger does not contain, which is *a derivation answering what its ledger
   * does not hold*.
   *
   * ## ⛔ Why it is not `stalled`
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
   * reading `waiting-on-an-answer` — ⚑ a state is not named after who owes the answer.
   */
  'waiting-on-a-person',
  /**
   * 🔴 **This piece handed work out, and that work is still open** (HO-088 §5.1; per piece).
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
   * ## ⚑ It is THIS piece's fact, and its siblings do not read it
   *
   * ⛔ **A piece records its parent**, so only the piece a child hangs under reads it, and a sibling
   * whose turn ended with nothing out still stalls: one piece's open child does not silence its
   * siblings' stalls.
   */
  'waiting-on-a-worker',
  /**
   * 🔴 **R3 — a piece a PERSON gave, left open by a turn that person's own words opened and that
   * ended on its own, with nobody asking it to stop** — the window's *waiting on you*. ⚑ Any other
   * drive ending stalls it, with its cause: a person owes nothing they were not asked in their own
   * turn.
   *
   * ⛔ **OPEN, and NOT `stalled`**: nothing stopped it that anybody is owed word of — the person who
   * asked is the one it waits for, and they read it in their own conversation. So it has no cause
   * ({@link PieceRow.stalledBecause} stays null), raises no notice and no band row, and refuses no
   * give.
   *
   * ## ⚑ FOLDED — one of the two waits that are (`waiting-on-the-person-who-wrote` is the other)
   *
   * ⚑ {@link derivePieces} writes it where such a turn ends with the piece open, over a piece whose
   * giver is `null` ({@link A_TURN_THAT_ANSWERED_A_PERSON_ENDS_ON}). ⛔ It is the fold's own
   * observation (the drive ending, the row's giver), not a second opinion about another derivation,
   * which is why the rule above does not keep it out. ⚠️ **The composition still reads over it**: a
   * question it asked, a card a person owes, or a piece it gave out that is still open is the more
   * specific wait, and is said instead ({@link composeWhatEachPieceIsWaitingOn}).
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
   * 🔴 **Nothing is driving this work, and the engine saw what stopped driving it** (HO-018 §2 ·
   * criterion 4).
   *
   * ⛔ **An OBSERVATION, never a guess, and never a timer.** It is entered when a drive ends with
   * the work open — a turn ending or being interrupted, a wake going idle, or a stop cutting either
   * — over a piece a conversation gave (one a person gave waits on them instead,
   * `waiting-on-the-person-who-asked`), when a launch finds work nobody handed over, when a held
   * message ends without going out, and when the conversation holding it is replaced;
   * {@link PieceRow.stalledBecause} says which cause it was. ⚠️ **Stated without a count**: a count
   * of producers a roster can outgrow is the hazard rule 25 is about. ⚠️ **There is no window and no
   * deadline**: HO-018 §2.2 withdrew the criterion that had one, and a measurement is the reason (a
   * known-successful compaction was silent for **~90,829 ms** against a measured maximum of **7,058
   * ms** in the same run — `00-slice4-measurements.md` §2, `n=16`).
   *
   * ## 🔴 OPEN, and that is the ruling this state carries
   *
   * ⛔ **A condition on an open task, never a terminal state** — HO-018's words, and its principle:
   * *the engine never terminally closes work it did not observe finishing.* ⚑ A second reply to one
   * task is a permanent refusal, so a task CLOSED here could never be answered — and every one of
   * those producers is a moment at which a child may still have more to say.
   *
   * ⚑ **So a late reply still lands as `answered`.**
   *
   * 🔴 **A task returns to `working` only when a row in the ledger says the work was actually handed
   * over** — never because a condition around it changed. ⛔ `message_unqueued: 'sent'` moves any
   * open task to `working` and clears the cause. ⚠️ Today the two cannot meet: a held message is
   * ended by every path that stalls its task, so no fold has yet had a `stalled` row whose message
   * then went out.
   *
   * 🔴 **And a second row says it: a delivery that starts its owner's turn and names this piece, or
   * names none** (R4; a `status: working` whose turn's row has not come yet drives every piece
   * until it does) — for a stall where the owner already holds the work
   * ({@link ITS_OWNER_RUNNING_AGAIN_DRIVES_IT}). ⛔ Without it an owner woken by its last helper's
   * reply would read `stalled` for its whole wake turn, and its giver would be told so.
   *
   * ## ⚠️ Why it is not `abandoned` or `withdrawn`
   *
   *  - **not `abandoned`** — the conversation did not end. It is there, it is resumable, and asking
   *    it to carry on is exactly the right thing to do.
   *  - **not `withdrawn`** — nobody took the work back.
   *  - **not `working`** — `working` is the ABSENCE of a reason to say otherwise, and this is a
   *    positive observation with a moment attached. A parent reading *"working"* about work nothing
   *    is driving is being told the opposite of what happened.
   */
  'stalled',
  'answered',
  /**
   * 🔴 **The parent took the work back** (HO-023 §5 + §4.3).
   *
   * ⛔ **CLOSED.** ⚠️ `message_unqueued` with `reason: 'cancelled'` — a parent cancelling a message
   * still in a mailbox — reaches the WORDS and not the WORK
   * (`folding-one-derivation-leaves-its-neighbour`), so without a door onto the work a task whose
   * message had already been sent could not be taken back by anything, and a `stalled` task nothing
   * would ever answer would hold its receiver's work slot for ever.
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
   * 🔴 **The giver ended the piece without a reply** — `update_work`'s close, folded from
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

/**
 * 🔴 **What the engine OBSERVED that stopped this work being driven** (HO-018 §2).
 *
 * ⛔ **A cause beside the word, never inside it** — the ruling about an actor, applied to a reason.
 * ⚠️ Folding these into state names would make a word mean *the child said nothing* about a child
 * somebody had stopped; folding them into none would leave a parent told that nothing is driving
 * its work and given no way to tell a finished turn from a killed app.
 *
 * ⚑ **Each one is an event this app watched happen.** None of them is inferred from an absence, and
 * none of them claims to know WHY the child stopped — a wedged provider and a child that has simply
 * finished thinking produce the same ending, and a word implying a cause it cannot know is the
 * defect itself.
 */
export const TASK_STALL_CAUSES = [
  /**
   * ⛔ **Its turn ended and no reply came.**
   *
   * ⚠️ **The turn ENDED of its own accord** (`completed` or `failed`). The child had its chance to
   * call `reply_to_parent` and the turn finished without one. ⛔ It says nothing about whether that
   * is a failure: the work may be half done, the child may reply on its next turn, and HO-018's
   * ruling is that the parent decides. ⚑ **R72: somebody may have ASKED it to stop first** — the
   * provider finished it anyway — and then {@link PieceRow.stalledBy} names who asked.
   */
  'turn_ended',
  /**
   * ⛔ **Somebody stopped the turn this work was running in** (`turn: interrupted`).
   *
   * 🔴 **An interrupted turn is one of the clearest cases there is of nothing driving the work**,
   * and it is exactly the case criterion 4 exists for. ⚑ HO-007 S5's ruling that *"the agent keeps
   * everything it was doing in context and decides"* is untouched, because this state is OPEN and
   * the work is still that agent's.
   *
   * ⚑ **A Close or a quit mid-turn lands HERE** (`05`: an agent is never dead). `close()`
   * interrupts the open turn before the process goes, so that `turn` row decides the piece, and the
   * stop's own terminal `status` moves nothing. ⚑ A background wake a stop cuts ends here too: on
   * its own `turn` row (`startedBy`, `interrupted`), and in a ledger written before F080, on the
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
   *  - **the work had been handed over** — the child was mid-turn and the app died.
   *    `SessionStore.settleRestartedWork` writes {@link WorkRestartedEvent} at the next launch.
   *  - **the work was still HELD** — the message never went, and `settleStrandedMessages` writes
   *    `message_unqueued: 'abandoned'` at every launch. ⚠️ **That row does not make the TASK
   *    `abandoned`** — HO-018 §2.3: *"nothing about a quit tells us the work failed."*
   *
   * ⚑ **The message really was abandoned and the task really was not**, and both sentences are true
   * at once.
   */
  'app_restarted',
  /**
   * 🔴 **The message carrying this work was never sent** — `message_unqueued: 'abandoned'`.
   *
   * ⛔ **Its own cause rather than {@link app_restarted}'s**, because the two are written by
   * different parties at different moments and a parent acts on them differently: this one means the
   * child never saw the work at all, so *send it again* is the obvious move.
   *
   * ⚠️ **Several producers.** ⛔ A handover a stop cut (`runFinalize` → `handOnWhatItHeld`, D-017)
   * and the launch after a crash (`settleStrandedMessages`) are the two ways of saying *the app
   * went away holding it*; ⚑ **`runFlush` is another, and it is not the app going away** — a queued
   * message whose attached path vanished before the flush. ⚑ A conversation holding a Claude
   * sign-in the machine has moved on from is not one: what its flush could not send stays held for
   * the reopen on the current sign-in. 🔴 **That is why the SENTENCE below does not say the app
   * stopped**: a cause is only as true as its widest producer.
   *
   * ⚑ **The MESSAGE is `abandoned` here, truthfully**; what a TASK does with that row is different
   * — HO-018 §2.3, *"nothing about a quit tells us the work failed."*
   */
  'message_never_sent',
  /**
   * ⚑ **R10 — the conversation holding it can never be reopened, and a new one took its place**
   * (`05` rule 3) — its provider no longer has it, or never named it. ⚑ Written by the fold at the
   * old conversation's `replaced_by` row, over every open task it held: the new conversation is the
   * same agent and keeps its memory, and holds none of this work — its giver gives it again, or
   * takes it back (the message that was still carrying held work is not handed on either). ⛔
   * **Final**: nothing starts the old conversation again, so no later row re-words it — only its
   * giver ends it, by taking it back (`withdraw_task`) or closing it (`update_work`).
   */
  'could_not_be_reopened',
  /**
   * 🔴 **Its conversation ended while it waited on background work, and the work stopped with it.**
   *
   * ⚑ An agent that starts a long background command ends its turn to wait for the notification,
   * and its work reads *working in the background*. A stop — a person's Close, or the app quitting
   * to restart — ends the conversation and every command it was running. ⛔ Without this cause the
   * work would stall on its turn's own cause, *"its turn ended with this work still open"*, which
   * reads as the agent giving up. ⚑ What stopped rides beside it
   * ({@link PieceRow.stoppedInTheBackground}), so the words can name it. ⚑ A launch wakes a
   * conversation whose background work a restart stopped, and its turn drives the work again
   * ({@link ITS_OWNER_RUNNING_AGAIN_DRIVES_IT}).
   */
  'background_stopped',
  /**
   * 🔴 **Its turn ended on its provider's usage limit** — a `turn` row that carries `limit`: the
   * provider refused the turn for the limit, and said so in its own signals.
   *
   * ⛔ **Not {@link turn_ended}**, whose *"its turn ended with this work still open"* reads as the
   * agent giving up — and a giver reading that about a helper the five-hour limit refused can only
   * guess the helper is broken. ⚑ Whose limit and when it resets ride beside it
   * ({@link PieceRow.stoppedOnALimit}), so the words can say both.
   */
  'provider_limited',
  /**
   * 🔴 **Its turn failed because its provider refused the login its conversation was started with**
   * — a `turn` row, or its session's terminal `status`, that carries `loginRefused`: Claude's
   * `auth_stale` (another Claude on this Mac renewing or switching the login does this, as does a
   * login that expired with nothing to renew it), and Codex's `unauthorized` on a failed turn. A
   * saved API key that stopped working is either, marked `onAKey`.
   *
   * ⛔ **Not {@link turn_ended}**, whose *"its turn ended with this work still open"* reads as the
   * agent giving up. ⚑ Whether the conversation has been reopened since rides beside it
   * ({@link PieceRow.stoppedOnALogin}).
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

/**
 * 🔴 **How a task ENDED, as the agent that did it said so** (HO-007 S2).
 *
 * ⛔ **A closed vocabulary, and an unknown value is a refusal rather than a pass.**
 * `reply_to_parent` refuses an outcome that is not one of these BY NAME and names the three, so a
 * model that guessed a fourth is told what the three are instead of having its guess written into a
 * ledger nobody can query.
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

/**
 * 🔴 **What one agent says its message to another IS** (HO-021 §1) — the fact the app was inferring
 * and could not.
 *
 * ## ⛔ The app cannot read it off the caller
 *
 * ⚠️ **Whether the caller decodes to an agent says nothing about whether its message is work.** ⛔ A
 * project manager asking its stalled worker *"what happened?"* is not giving work, and reading
 * every agent's message as work turns one piece of work into five tasks that are five MESSAGES
 * (HO-020). ⚑ **An instruction to the model does not fix it**: on both providers an obeyed rule and
 * a broken one produced the same outcome, so the instruction is never the variable — standing rule
 * 15.
 *
 * ## 🔴 No message gives work
 *
 * ⛔ Work is GIVEN with `give_work`, one act that names the profile, the title and the brief, and a
 * message only tells (`note`) or adds to work already given (`follow-up`). ⚑ So nothing a message
 * says can open a piece, whatever its kind.
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
   * 🔴 **For information: no reply is expected** (plan §3.1). ⛔ It opens nothing.
   */
  'note',
  /**
   * 🔴 **About work already given** (plan §3.1): it names the piece it follows up — one the sender
   * gave that conversation. ⛔ It opens nothing, so a giver can add to the work without adding work.
   * ⚑ A question is not a message at all: `ask_question`, whose answer comes back.
   */
  'follow-up',
] as const
