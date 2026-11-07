import type {
  TaskState,
  ConversationWait,
  TaskStallCause,
  TaskOutcome,
} from './work-report-contracts'
import type { TranscriptEvent } from './conversation-events'
import type { AskToStop, WhoStoppedIt } from './how-work-stopped'
import type { ModelAndEffort } from './model-choice-contracts'
import type { GivenFolder } from './work-folders'

/** Work a conversation gave has a giver; work a person gave has nobody to tell. */
export type PieceAConversationGave = PieceRow & { readonly giver: string }

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
 * 🔴 **D-016 · one status line about a piece, and who set it when** — {@link PieceRow.statusLine}.
 */
export interface StatusLine {
  /** Source event ordinal in the conversation ledger. */
  readonly revision?: number
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
export type TurnLimitOnTheRow = NonNullable<Extract<TranscriptEvent, { type: 'turn' }>['limit']>

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
 * 🔴 **D-016 · a piece of work, GIVEN** — the event that opens a piece in its owner's ledger.
 *
 * ## ⛔ A row says what a piece IS; the owner's ledger says what HAPPENS to it
 *
 * ⚑ **The `work` table holds one row per piece, written once**: its parent, its number, its owner,
 * its giver, and its title and brief as given. ⛔ **Its STATE is never stored.** Every piece event
 * below lives in the OWNER's ledger, and `derivePieces` in `shared/tasks.ts` folds that ledger — the
 * rule tasks were built on (379), kept: *a row somebody has to remember to update is a row a crash
 * silently loses.* ⚠️ So this event and the `work` row are written in ONE transaction
 * (`SessionStore.recordGive`), and a crash can leave neither or both.
 *
 * ⚑ **A root has no such event.** A conversation with no parent gets its root with its own row, and
 * no give opens it (D-016 · R1): its state is its conversation's, so the fold never makes one a row.
 * ⚑ A piece a person asked for, taken on under a root (`take_on_work`, D-016 · commit 6), has one,
 * with {@link givenBy} `null`.
 *
 * ## ⚠️ Written once the brief is delivered or queued, never before
 *
 * ⛔ **A refused or failed send leaves no piece** (D-016 · R4). The number is taken before the send,
 * so the owner is told its label in the brief's own sender line; a number a failed send burned is
 * never reused, which is honest — numbers never repeat. ⚑ A piece taken on is written as its owner
 * takes it (D-016 · commit 6): nothing is sent.
 */
export interface WorkGivenEvent {
  type: 'work_given'
  /** ⛔ **`work_<uuid>`, the piece's id** — minted in the main process, never supplied by a caller. */
  piece: string
  /**
   * ⚑ **The label a person and a model say, `W1.2`** — carried so no reader walks the parents to
   * name the piece. ⛔ Written from the same numbers as the `work` row, in the same transaction.
   */
  label: string
  /**
   * The id of the piece this one was given under — the giver's own piece, a root or not; for work
   * taken on for a person, the owner's own root.
   */
  parent: string
  /**
   * ⛔ **The conversation that gave it, or `null`: a person** — work its owner took on for them
   * (`take_on_work`, D-016 · commit 6).
   */
  givenBy: string | null
  /** What the piece is called — bounded by `PIECE_TITLE_CHARS` at the door. */
  title: string
  /**
   * The work, verbatim, as it was sent to the owner as a turn — or as the owner wrote it down when
   * it took the work on.
   */
  brief: string
  /** The condition the giver supplied; absent on older work. */
  definitionOfDone?: string
  /**
   * 🔴 **The held message carrying the brief — present only while it was HELD.**
   *
   * ⛔ **Absent means the owner was idle and the brief went straight out** — or the owner took the
   * work on itself, mid-turn — and the fold starts the piece `working`; present, it starts
   * `waiting`, and `message_unqueued` names the same string, so the fold pairs a beginning with its
   * ending by name (`354`).
   */
  messageId?: string
  /**
   * 🔴 **W4.189 · the folder the give named, as this app used it** — the working folder of the
   * conversation it started, or a GRANT on the one that already existed: it may also work there
   * while this piece is open — with D's notice when the folder meets one of the places this app
   * names. ⛔ **Absent on every give recorded before this build**: an older row's folder is never
   * read as a grant.
   */
  givenFolder?: GivenFolder
  /**
   * The model and effort a give to a service asked for, judged at the give and applied when its
   * piece's turn comes; absent when it asked for none.
   */
  asked?: ModelAndEffort
}

/**
 * 🔴 **D-016 · a piece of work, answered by its owner** — `reply_to_parent`'s durable fact, in the
 * owner's ledger beside the `work_given` it closes.
 *
 * ⛔ **It carries no destination** (HO-015 §1.3): the reply names the piece, and the giver is on the
 * piece's row, so no argument a model supplies can aim it. ⚠️ **What the giver RECEIVES is a message
 * and not this row**: delivery is best-effort and says so, and this event lands whether or not the
 * words reached anybody.
 */
export interface WorkRepliedEvent {
  type: 'work_replied'
  /** The piece being answered — {@link WorkGivenEvent.piece}, and the only id that names work here. */
  piece: string
  /** How the owner said it went. One of `TASK_OUTCOMES`; a fourth value never reaches here. */
  outcome: TaskOutcome
  /**
   * ⛔ **The reply itself, bounded at the tool and never truncated** — and the piece's final status
   * line, said by its owner.
   */
  summary: string
  /** The agent's own words about what it saved, or why it saved none. */
  savedMethod?: string
  /**
   * ⚑ **The resources the reply handed in** — `work_resource` ids, kept by this app with the bytes
   * the owner handed over. ⛔ Possibly empty: most replies fit in the summary.
   */
  resources: readonly string[]
  resultDocument?: string
  /**
   * ⛔ **The owner's claim that a PERSON has to move next**, absent when it did not say so — a thing
   * the agent said, kept where the rest of what it said is kept; nothing changes because it is set.
   */
  needsUserAction?: true
}

/**
 * 🔴 **D-016 · a piece of work, taken back by its giver** (`withdraw_task`) — in the owner's ledger,
 * because the owner's ledger is the one the piece is folded from.
 *
 * ⚑ **It closes the piece and the questions its owner asked about it**: `deriveRoutedRequests` reads
 * this row too, so a taken-back piece leaves no question open behind it. ⛔ Written only after the
 * door's refusals, never before.
 */
export interface WorkTakenBackEvent {
  type: 'work_taken_back'
  piece: string
  /**
   * ⛔ **The conversation that took it back** — the giver, or the conversation in its place — or
   * `null`: a person, who takes back only the piece a service is on.
   */
  by: string | null
}

/**
 * 🔴 **D-016 · a piece's title, set again** (`update_work`, or a person's rename) — the newest title
 * stands, whoever set it.
 *
 * ⚑ **A root's title is written this way too**: a root has no `work_given`, and its owner names it
 * with this row — and a person renames it with one (D-016 · commit 7 · R4). ⛔ In the OWNER's ledger,
 * whoever wrote it.
 */
export interface WorkRetitledEvent {
  type: 'work_retitled'
  piece: string
  title: string
  /**
   * The conversation that set it, or `null`: a person — the window's rename of a piece a person gave
   * (D-016 · commit 7 · R4).
   */
  by: string | null
}

/**
 * 🔴 **D-016 · a piece's current status line** (`update_work`) — the newest line stands, and a
 * reply's summary is its owner's last one. ⛔ In the OWNER's ledger, whoever wrote it.
 */
export interface WorkStatusSetEvent {
  type: 'work_status_set'
  piece: string
  line: string
  /** The conversation that set it. */
  by: string
  /**
   * The line says the piece waits on purpose: it reads `waiting-on-purpose` and a turn's end does
   * not stall it, until a new brief, a follow-up naming it, or a line without this mark.
   */
  waiting?: true
  /** What it waits on, beside {@link waiting}. ⚑ Absent on a mark from before a wait named one. */
  on?: WaitOn
}

/**
 * A brief or done-condition revision in the owner's ledger. A giver revises agent-given work;
 * the holder may revise personal work. A condition-only revision preserves the brief and its drive.
 */
export interface WorkRebriefedEvent {
  type: 'work_rebriefed'
  piece: string
  brief?: string
  definitionOfDone?: string
  /** The conversation that made this revision. */
  by: string
  /**
   * 🔴 **D-022 · R1 — the held message this new brief rides**: its piece's give, still waiting when
   * the row was written, whose send reads the newest brief. ⛔ Absent when it was told as its own
   * turn, or not at all. Never rewritten: the row says it once.
   */
  messageId?: string
}

/**
 * 🔴 **D-047 · what a conversation GAVE, in its own ledger** — a piece it gave, or a new brief it
 * gave one: the piece, its label, the conversation it went to, and its title and brief WHOLE.
 *
 * ⚑ **Written once, as the give or the new brief succeeds and before its call answers**, so the
 * giver's card lands it on that call and draws the brief its arguments cut at 200 — after a restart
 * and from history too, since it is read with the page it is on. ⛔ **The piece fold never reads
 * it**: a piece's state is its owner's ledger's ({@link WorkGivenEvent}), and this is the giver's own
 * record.
 */
export interface WorkSentEvent {
  type: 'work_sent'
  /** The piece, by id. */
  piece: string
  /** Its label — `W1.2`. */
  label: string
  /** ⚑ Whether these words gave the piece, or gave it a new brief (`update_work`). */
  as: 'given' | 'rebriefed'
  /** The conversation holding the piece, which the words went to. */
  to: string
  /** Its title, whole, as it stood when the words went. */
  title: string
  /** The brief, whole — the words the holder was given. */
  brief: string
  /** 🔴 **W4.189** — {@link WorkGivenEvent.givenFolder}, on the giver's side: what it granted. */
  givenFolder?: GivenFolder
}

/**
 * 🔴 **D-016 · a piece, closed by its giver without a reply** (`update_work`'s close) — in the
 * owner's ledger, as a take-back is.
 *
 * ⚑ **It ends the piece (`closed`) and the questions its owner asked about it**:
 * `deriveRoutedRequests` reads this row too. ⛔ Written only after the door's refusals, never before.
 */
export interface WorkClosedEvent {
  type: 'work_closed'
  piece: string
  /**
   * ⛔ **The conversation that closed it** — the giver, or the conversation in its place — or
   * `null`: a person, who closes only stopped work *Waiting on you* lists.
   */
  by: string | null
}

/**
 * 🔴 **Somebody asked this conversation's work to stop, and who** (395, HO-007 S5) — the event
 * `340` named and deferred.
 *
 * ## ⛔ The gap it closes, in the words of the file that left it
 *
 * `RuntimeHost.noteUserCommand` refuses to widen {@link UserCommandEvent} to cover a commanded
 * gesture, and says why: *"Widening it would put 'the user interrupted this' in the ledger about a
 * gesture an agent made… ⚑ What the ledger does hold for a commanded turn is the turn itself; naming
 * the agent that asked for it needs an event that says so, and inventing one here would be this
 * dispatch writing the tools dispatch's vocabulary."* ⚑ **This is the tools dispatch.**
 *
 * ## ⚠️ It is NOT a second spelling of `user_command: 'interrupted'`
 *
 * ⛔ **They answer different questions and are gated by different predicates**, which is what makes
 * two rows right rather than a duplicate fact (169 §1):
 *
 *  - {@link UserCommandEvent} says **which control a PERSON pressed**. It is written at the IPC
 *    boundary *"because that boundary IS 'a person pressed something'"*, gated on `mayControl`, and
 *    is silent for every caller without a surface.
 *  - This row says **the work was asked to stop, and by whom**. It is written at the host's own
 *    door, for every caller, and it is the row {@link howWorkStopped} reads.
 *
 * ⚑ A person's Stop therefore writes both, and they cannot drift: the pairing is asserted by name —
 * ⚠️ except a press that JOINS an ask still unanswered (`723`, R83), which writes only the breadcrumb.
 *
 * ## ⛔ Written BEFORE the provider is touched, so a stall cannot erase the ask
 *
 * ⚠️ **The ask is the fact, not the outcome.** Codex's `interrupt()` awaits the answer to its
 * `turn/interrupt` request, which may never arrive (709), and Claude's forces a local terminal after
 * two seconds;
 * a row written afterwards would be missing for exactly the session a person is trying to explain.
 * ⚑ It is also what puts the row on the turn it stopped — `events.turn_id` takes the OPEN turn, and
 * the terminal that closes it has not been emitted yet.
 */
export interface WorkInterruptedEvent {
  type: 'work_interrupted'
  /**
   * ⛔ **One of {@link WhoStoppedIt}'s three words.** ⚠️ It is about the CALLER, never about the
   * conversation: `a-person` means a window's sink asked, `an-agent` means a tool call did, and
   * `a-caller-this-app-cannot-name` means neither positive test held.
   *
   * ⚑ **This sentence used to name a third member, `this-app`, and there is still no such
   * member** (477, reading this row as the precedent for {@link UserDecisionEvent.by}). ⛔ **The
   * exclusion is a REFUSAL and not an omission**: `RuntimeHost.recordTheAsk` returns without
   * writing a row when the caller is the app, for the reason the removed member was removed for —
   * *the app never asks a turn to stop as an act of its own*. ⚑ A teardown's stop is an absence
   * here, and `StopReading.who` reads it as `null`.
   *
   * ## 🔴 501 · this was a two-member vocabulary and the derivation was a NEGATIVE test
   *
   * ⛔ **`recordTheAsk` wrote `speaking === null ? 'a-person' : 'an-agent'`**, so a caller that is
   * neither a window nor an agent was recorded as a person. ⚠️ `477` named the defect and deferred
   * it — *"a two-member vocabulary has nowhere honest to put one"* — and `494` ended that by
   * deriving {@link WhoStoppedIt} from {@link WhoDidIt}.
   *
   * ⚑ **So there is one vocabulary here now and there used to be two.** `WHO_ASKED_IT_TO_STOP` was
   * a hand-written pair beside a derived set; the writer asks `whoDidIt` and refuses the app, so
   * what this field can hold IS `WhoDidIt` minus `the-app-itself` — by construction, and for every
   * member that vocabulary gains after this one.
   */
  by: WhoStoppedIt
  /**
   * The conversation that asked — **present if and only if {@link by} is `an-agent`**.
   *
   * ⚠️ **The agent's session id and not its `agent:` caller id**, so a reader can join this row to
   * the conversation's own ledger rather than having to know how a caller id is spelled.
   */
  agent?: string
  /**
   * 🔴 **732 · `730` F-4 — WHO the asking agent is: its identity, as the folded slug** —
   * `SessionStore.identityOf`, written beside {@link agent} and never without it.
   *
   * ⛔ **Until `732` the row carried the conversation alone**, and a transcript could only say
   * *"asked to stop by sess_…"*: {@link agentName} takes an identity slug, a `sess_…` handle is not
   * one, and no surface that draws a transcript holds a conversation-to-identity map —
   * {@link UserTurnEvent.relayedFromProfile}'s reason, one row type over. ⚑ **For a reader to name**
   * with `agentName(agentProfile, identities)` (R41), which is what `whatToCallTheConversation` wraps
   * — ⚑ since `737` the transcript does (`stop-unanswered.ts`' `whoAskedItToStop`): the ask's notice
   * names the agent where the window has the roster, and says the category where it does not.
   *
   * ⛔ **Never a display name** — `relayedFromProfile`'s rule: one edit to
   * `agent_identity.display_name` moves every surface at once, and a friendly word frozen onto this
   * row would name one agent two ways after a rename. ⚠️ **Absent** on every row written before
   * `732`, and for a conversation this app holds no identity for — ⛔ a reader then says the
   * category (`stoppedBy(by, null)`: *"an agent"*), never the `sess_…` handle (`HO-095` §5.3,
   * `nameTheConversation`). ⚠️ **A reader with no roster** — the readable export folds a transcript
   * without one — must be handed one or say the category; it may not print the slug.
   * ⚑ Bounded on replay by the slug's own rule (`boundRelayedIdentity`) — the PERSISTED copy: the
   * live wire carries what the writer built, as it does for `relayedFromProfile`.
   */
  agentProfile?: string
}

/**
 * Everything that goes into a transcript, live or replayed — the provider's events plus what
 * we did. One union, because the live stream and the recording have to fold the same way: if
 * replay took a different path, a reopened session could quietly differ from the one you were
 * just looking at.
 */
/**
 * 🔴 **The app went away while this conversation still held work, and the launch said so** (400,
 * HO-018 §2.3 + criterion 14).
 *
 * ## ⛔ The criterion the PO amended, and the mechanism it retired
 *
 * ⚠️ **HO-007 criterion 14 asked for *"a pending question rebuilt from the ledger"*, and HO-018
 * §2.4 withdrew that wording**: it named a mechanism `396` deliberately prevents. ⚑ The property it
 * wanted is *"nothing in flight is silently lost across a restart"*, and HO-018 §2.3 says which
 * restart it meant — **the app being killed while work is in progress.**
 *
 * ⛔ **That case wrote NOTHING before this row existed.** `settleOrphanRuns` closes the turn row and
 * reconciles `provider_session.status`, and appends no event at all — so work whose holder was
 * mid-turn when the power went out derived `working` for the rest of its life, and nobody was ever
 * told. ⚠️ The sibling case — work still HELD when the app died — was already written down, by
 * `settleStrandedMessages`, and it is the one this row deliberately does not duplicate.
 *
 * ## 🔴 A condition on OPEN work, which is HO-018's whole principle
 *
 * ⛔ **The engine never terminally closes work it did not observe finishing.** A quit says nothing
 * about whether the work failed: the conversation is resumable, the owner may be able to carry on,
 * and the giver is the one who decides. ⚑ So this row moves an open piece to
 * {@link TaskState.stalled} — *nothing is driving this* — and never to a terminal state. See
 * {@link TaskStallCause.app_restarted}.
 *
 * ## ⚠️ Written once per restart that has something to say, and idempotent by construction
 *
 * ⛔ **`SessionStore.settleRestartedWork` writes it only for a conversation that still holds an open
 * piece in `waiting` or `working`** — a piece already `stalled` has already told its giver that
 * nothing is driving it, and a second row would repeat it at every launch for ever. ⚑ That is the
 * latch, and it needs no statement of its own: after this row lands, every piece it names is
 * `stalled`, so the next launch finds nothing to say. ⛔ Never for a root: a root's state is its
 * conversation's (D-016 · R1).
 *
 * ## ⛔ Stamped at the launch, and there is no deadline anywhere near it
 *
 * ⚠️ **This is an observation with a moment, not a clock.** The app restarted; the launch is when we
 * learned it; `at` is now.
 */
export interface WorkRestartedEvent {
  type: 'work_restarted'
  /**
   * 🔴 **D-016 · the pieces the restart stalls** — the ones this conversation held open in `waiting`
   * or `working` when the launch looked.
   *
   * ⛔ **Named, so a piece given after this row is not a restart's to stall.** ⚠️ Absent on a row
   * written before D-016, which names nothing and so stalls nothing.
   */
  pieces?: readonly string[]
}

/**
 * 🔴 **This conversation has been told that a piece it gave out is not being driven** (404, HO-018
 * §2.1 · criterion 4; `work_reported` until D-016, `work_stall_told` since — keyed by piece).
 *
 * ## ⛔ It is in the GIVER's ledger, and that is the whole of why it exists
 *
 * ⚠️ **Every other row in this family is written into the OWNER's ledger** — {@link WorkGivenEvent},
 * {@link WorkRepliedEvent}, {@link WorkRestartedEvent} — and is folded by `derivePieces` into a
 * state. ⛔ **This one is not folded by anything and belongs to the other end of the edge**: it
 * records that a message about that piece reached the conversation that gave it out. ⚑
 * `derivePieces` never selects this type, so a piece's state cannot be changed by somebody having
 * been told about it.
 *
 * ## 🔴 Why the fact has to be DURABLE, measured
 *
 * ⛔ **`400` de-duplicated the push in memory and seeded the set from the child's own task rows**,
 * on the reasoning that a stall carried into a new slot *"belongs to a previous life of the app: the
 * parent was told then or it was not"*. ⚠️ **For {@link TaskStallCause.app_restarted} that reading
 * was provably wrong** — the row is written by `SessionStore.settleRestartedWork` at construction,
 * when nothing is running and nobody can have been told — and `402` measured the consequence live
 * (F6, row 15: *"1 inbound row on the pm; 'is not being worked on' ABSENT"*).
 *
 * ⚑ **So *has this conversation been told?* is answered from this conversation's own ledger** rather
 * than guessed from another conversation's state, and the answer survives a restart because the
 * ledger does.
 *
 * ## ⚠️ {@link WorkStallToldEvent.messageId} is what stops a receipt standing for a message that never arrived
 *
 * ⛔ **The notice goes through `queueMessage`, which either SENDS it or HOLDS it**, and a held
 * message can still be abandoned — by a quit, or by the launch after a crash. ⚑ When it was held,
 * the row names it, and `SessionStore.workReportedTo` withdraws the receipt if that message's own
 * ending says `abandoned`. ⚠️ **Absent means it went straight out**, not *unknown*: there was no
 * held message to name.
 *
 * ⚑ **A notice this app took back because a later fact made it false stands** (D-016c): the
 * giver's own question or new brief told it (R69), and a closed piece is owed nothing.
 */
export type WorkStallTold = WorkStallToldEvent | WorkStallSetRightEvent

/**
 * ⚑ **The member that tells a giver a CAUSE** — `pushed`, and the only one this app writes. See
 * {@link WorkStallTold} for the row and {@link WorkStallSetRightEvent} for the rows an older build
 * wrote beside it.
 */
export interface WorkStallToldEvent {
  type: 'work_stall_told'
  /** The piece this conversation was told about — {@link WorkGivenEvent.piece}. */
  piece: string
  /**
   * ⚑ **What it was told**, one of `TaskStallCause`. A row that recorded only *that* a conversation
   * was told would not be a record of what was said.
   *
   * ⚠️ **A receipt written before D-016c can name `conversation_ended`**, a cause this vocabulary
   * no longer has, and one may carry a `holderKeptOpen` beside it: both are a record of what was
   * said, and the receipt fold reads only the piece.
   */
  cause: TaskStallCause
  /** 🔴 **How it was told**: a message went into this conversation, and `queueMessage` accepted it. */
  how: 'pushed'
  /**
   * ⚠️ **The held message carrying the notice**, when it was held — see {@link WorkStallTold}.
   * ⛔ **Absent ⇒ it was sent, never *unknown*.**
   */
  messageId?: string
}

/**
 * ⚑ **A telling written until D-016c, and nothing writes one now** — kept because ledgers hold them
 * (Q4 of D-016c).
 *
 * ⚑ Each was a telling with no cause: a correction sent after the holder was started again
 * (`set-right`, 661), the giver's own wake standing in for one (`its-own-wake`, 673), and the
 * giver's own question (`its-own-question`, 719 · R69) or new brief (`its-own-brief`, D-016) taking
 * its unread notices back. ⛔ **Since D-016c a stop is told nothing, so nothing is set right**, and
 * a take-back by the giver's own act leaves the push's receipt standing as the telling.
 *
 * ⚑ **Read as told**: `SessionStore.workReportedTo` counts each one, and the raw event stream draws
 * what each said — `612`'s rule for a row nothing writes any more.
 */
export interface WorkStallSetRightEvent {
  type: 'work_stall_told'
  /** The piece this conversation was told about — {@link WorkGivenEvent.piece}. */
  piece: string
  /**
   * ⛔ **How it was told** — `set-right`: a correction went into this conversation. The other three
   * sent nothing: the giver's own wake, question or new brief was the telling.
   */
  how: 'set-right' | 'its-own-wake' | 'its-own-question' | 'its-own-brief'
  /**
   * ⚠️ {@link WorkStallToldEvent.messageId}'s rule exactly: absent ⇒ it was sent. ⛔ Never
   * present on `its-own-wake`, `its-own-question` or `its-own-brief`, which sent nothing.
   */
  messageId?: string
}

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

export {
  TASK_STATES,
  TASK_STALL_CAUSES,
  TASK_OUTCOMES,
  AGENT_MESSAGE_KINDS,
} from './work-report-contracts'

export type {
  TaskState,
  TaskWait,
  ConversationWait,
  TaskStallCause,
  TaskOutcome,
  AgentMessageKind,
  WorkReport,
} from './work-report-contracts'
