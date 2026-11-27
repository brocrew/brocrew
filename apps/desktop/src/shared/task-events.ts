/**
 * The work events a conversation's ledger records: given, replied, taken back, retitled, status,
 * rebriefed, sent, closed, interrupted, restarted and stall notices. Split out of task-contracts.ts
 * as a pure move.
 */
import type { TaskStallCause, TaskOutcome } from './work-report-contracts'
import type { ActedBy, WhoStoppedIt } from './who-did-it'
import type { ModelAndEffort } from './model-choice-contracts'
import type { GivenFolder } from './work-folders'

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
 * 🔴 **D-016 · a piece of work, taken back by a conversation** (`withdraw_task`) — in the owner's ledger,
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
  /** When present, takes precedence over legacy by attribution. */
  actor?: ActedBy
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
  /** When present, takes precedence over legacy by attribution. */
  actor?: ActedBy
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
  /**
   * Its brief is held for the holder's next input, so the holder's wait on purpose ends when that
   * brief is sent, not at this row. Rows without it end the wait here.
   */
  held?: true
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
  /** When present, takes precedence over legacy by attribution. */
  actor?: ActedBy
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
  /** The reason supplied with an explicit stop. */
  reason?: string
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
