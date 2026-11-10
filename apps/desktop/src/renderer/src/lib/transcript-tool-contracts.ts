import type { MessageSentEvent } from '../../../shared/conversation-events'
import type { MoveOffer, MoveReceipt } from '../../../shared/move-contracts'
import type { ActionAsked, RequestRoutedEvent } from '../../../shared/question-contracts'
import type { RefusalTold } from '../../../shared/refusals'
import type {
  PermissionDecision,
  RuntimeEvent,
  WorkflowAgent,
  WorkflowPhase,
} from '../../../shared/runtime-ipc'
import type { WorkRepliedEvent } from '../../../shared/task-contracts'
import type { ActedBy } from '../../../shared/who-did-it'
import type { BackgroundOutcome } from './background-work'

export type PermissionRequestEvent = Extract<RuntimeEvent, { type: 'permission_request' }>

export type UserInputRequestEvent = Extract<RuntimeEvent, { type: 'user_input_request' }>

export type PermissionOutcome = PermissionDecision['outcome']

/**
 * ⛔ **Why a request offers no way to ALLOW it** (487) — the WORD the adapter wrote, whose sentence
 * `permission-offer.ts` renders. Derived from the event so a fourth reason is a compile error in
 * the `Record` that says what each one means, the way `PermissionOutcome` already is.
 */
export type NoPositiveBecause = NonNullable<PermissionRequestEvent['scope']['noPositiveBecause']>

export interface ToolItem {
  kind: 'tool'
  id: string
  /** The provider's tool-use id — the correlation between a call and its result. */
  callId: string
  name: string
  summary: string
  /**
   * `at` on the result is when the RESULT landed, and the only reason it is kept: how long a tool
   * took is the difference between it and the call's own `at`. Measured from the two envelopes,
   * never from a clock read while rendering — a replayed conversation must show the durations it
   * actually had, not the age of the replay.
   *
   * ⚑ **`durationMs` is the same question answered by the provider instead** (327), and it is
   * carried so the row can show ONE duration rather than two derivations of it — `064`/`099`'s rule.
   * The subtraction above spans two `RuntimeHost` delivery stamps, so it includes transport and the
   * host's pump; measured, the envelopes were 7 ms apart for a call the provider timed at 4. See
   * {@link ToolEntry}'s `took`, which prefers this one and falls back to the subtraction.
   */
  result: { summary: string; ok: boolean; at?: number; durationMs?: number } | null
  /**
   * The whole sentence one of the app's own tools refused this call with, as the host kept it on
   * the refusal: the receipt above holds only its first part. Absent on a call that was not refused,
   * and on every refusal written before the host kept it.
   */
  told?: RefusalTold
  /** The rail from the uniquely matched refusal row for this call. */
  refusalRail?: 'that-agent-is-you'
  /**
   * 🔴 **What this call reached inside the profile's own memory store, relative to that store**
   * (330) — present only when the provider said where its store is and this call named a file in it.
   *
   * Preserve the known memory path so the row can identify memory activity without relying on the truncated end of a long filename.
   *
   * ⚑ **Relative, and that is `MemoryRecallEntry`'s own convention** — the other provider's memory
   * rows already show paths *"relative to the profile's memory base path"*. {@link summary} still
   * carries the whole absolute path, so nothing is hidden; this is what the row LEADS with.
   *
   * ⚠️ **Absent never means "not a memory".** See the event field: it means nothing said it was one.
   */
  memoryPath?: string
  /**
   * We stopped watching before this call reported back (074) — set by {@link stopOpenToolCalls} at
   * every boundary that ends the thing running it.
   *
   * ⚠️ Deliberately NOT an outcome. `result` stays `null`, because no result arrived; this says only
   * that none ever will, which is what turns a false "running…" into a true "did not finish".
   */
  unfinished?: boolean
  /**
   * This call is already rendered as something else, so the conversation should not show the same
   * fact twice (028). Set from a `plan_update`'s `supersedes`: Claude builds its checklist out of
   * `TaskCreate`/`TaskUpdate` calls, and without this a three-step plan appears as three tool rows
   * AND the checklist they produced — while Codex, whose plan is a notification, shows only the
   * checklist. The flag makes both providers render the same thing.
   *
   * It HIDES rather than deletes, and only in `normal`: debug still shows every call, because
   * debug's contract is that it shows what the provider really said.
   */
  superseded?: boolean
  /**
   * The sub-agents this call dispatched (029), nested rather than listed beside it. A `Task` row
   * with a card inside it reads as one thing that happened; the same two side by side read as two.
   */
  subAgents?: SubAgentCard[]
  /**
   * Set when this row is a SUB-AGENT's call that had nowhere to go yet (029): the child's tool
   * blocks can reach the fold before the `task_started` that creates its card, and a call dropped
   * into the conversation in that window is the exact misattribution 029 exists to end. Recording
   * whose it is means the card can reclaim it the moment it appears — see {@link reclaimChildRows}.
   */
  parentToolCallId?: string
  /**
   * The dynamic workflow this call launched (108), if it is a `Workflow` call — ONE evolving tree,
   * never a row per frame. See {@link WorkflowRunCard}.
   */
  workflow?: WorkflowRunCard
  /**
   * ⛔ **This call's work LEFT rather than finished** (248) — present only when the provider said so.
   *
   * ⚠️ **Presence is the whole flag, and it has exactly TWO writers.** From a receipt it is set from
   * `tool_result.backgrounded` alone — `247` is explicit about why not from the receipt's wording:
   * *"'Command running in background with ID: …' is the provider's sentence, it has changed shape
   * across pins, and the flag beside it is derived from the level set."* And never from
   * `backgroundId` — Codex attaches a `processId` to **every** PTY-backed command, foreground
   * included, so a card gated on having an id would put "still running" on finished commands, which
   * is the false-settled card's mirror image.
   *
   * ⛔ **The second writer is the LEVEL itself** ({@link markLevelRunning}, 287 finding 1), and it is
   * not the trap above wearing a hat: the level is read at a turn boundary and nowhere else, so a
   * row in it is work that outlived its turn — the definition of the subject. It exists because
   * Codex's detached commands produce no `tool_result` at all, so the receipt writer never fires and
   * the card had nothing to read.
   *
   * ⚑ **The card becomes the completion record.** While {@link DetachedWork.outcome} is absent the
   * work is still going; when `background_work.ended` names this call, the outcome, the summary and
   * the output file land here and the row stops saying *"still running"* — the half `245` measured
   * as never changing at all.
   */
  background?: DetachedWork
  /**
   * The provider's key for stopping this command independently of the turn, whether or not it detached.
   *
   * ## ⛔ Why this is a second field and not `background.id`
   *
   * ⚠️ **{@link detachment} refuses to read `backgroundId` and that refusal is right.** Codex
   * attaches a `processId` to every PTY-backed command, foreground included, so a card that called
   * itself detached because it had one would put *"still running"* on finished commands. ⚑ **That is
   * an argument about what having a key MEANS, not about whether to keep it** — and 248 kept neither,
   * so the app has been holding a working stop key for every Codex command and rendering nothing.
   *
   * ⛔ **Measured before it was built** (`probe:command-output` §C): while a turn was blocked on
   * `sleep 300.52243`, the card carried `backgroundId=77615`, `thread/backgroundTerminals/list`
   * carried `processId: "77615"` for the same `itemId`, `terminate` answered `{terminated:true}`, the
   * OS stopped listing the process — ⚑ **and the turn went on to complete**, with an honest
   * `ok=false` receipt and the model saying so. Stopping one command really does leave the
   * conversation alone.
   *
   * ## ⚠️ Which way this fails, and what keeps it safe
   *
   * **A provider id is not unique for ever.** Codex's `processId` is a counter it recycles, and a
   * transcript row lives as long as the conversation does — so a key pressed long after its command
   * died could name somebody else's process. ⛔ **What makes that unreachable is not this field but
   * WHEN the control is offered**: only while the row is still running, and `stopOpenToolCalls`
   * marks every open row `unfinished` at each boundary that ends the thing running it (074). A
   * replayed or reopened conversation therefore has no running rows at all, and inside one live
   * session the provider cannot have recycled the number of a process that is still alive.
   *
   * Absent for every call whose provider named no key — which is every Claude call that did not
   * detach, and is a real state rather than a gap: see `claude/normalize.ts`, which sets
   * `backgroundId` only alongside `backgrounded`.
   */
  stopKey?: string
  /**
   * 🔴 **658 · a call that put THIS conversation's words into ANOTHER one** — see {@link OutgoingWords}.
   *
   * Use dedicated cards for app messaging calls rather than generic MCP rows.
   *
   * Absent on every other call, and on these two when this session was never told its tools' names
   * ({@link ToolRegistry.set} `null`): ⛔ recognition is by the name THIS session was handed, never by
   * a provider's spelling written here.
   */
  outgoing?: OutgoingWords
}

/**
 * 🔴 **658 · What one of this app's two messaging tools DID, read off the host's own row.**
 *
 * ⛔ **The arguments are the model's, and both adapters bound them at 200 characters** — a reply's
 * summary may run to 1,280. The host's row is whole: `work_replied` carries a reply's words and
 * outcome, `message_sent` a message's recipient, kind and delivery. ⚑ **So the row lands on the call
 * that produced it**, and the card draws the row.
 *
 * ⚑ **678 · and since `671` the row carries a MESSAGE's words too** — `message_sent.text`, cut at
 * `REPLY_SUMMARY_LIMIT` and `clipped` when cut. ⚠️ **This said *"`message_sent` carries none"***,
 * which was true until `671`; a row written before it still carries none, and only then does the
 * card fall back to what survived the arguments' 200-character bound (`outgoing-card.ts`).
 *
 * ⚠️ **`null` until that row arrives, and for good when the call was refused** — a refused call wrote
 * no row, and its receipt ({@link ToolItem.result}) is the whole story.
 */
export type OutgoingWords =
  | { tool: 'reply_to_parent'; reply: OutgoingReply | null }
  | { tool: 'message_agent'; sent: OutgoingMessage | null }
  | { tool: 'ask_question'; asked: OutgoingQuestion | null }
  | { tool: 'request_action'; asked: OutgoingQuestion | null }
  | { tool: 'pass_question_up'; asked: OutgoingQuestion | null }
  /**
   * Read the successful give's `work_sent` event from this ledger to show its complete title and brief before the call answers. Arguments can be cut at 200 characters; the separate `work_given` belongs to the recipient's ledger.
   */
  | { tool: 'give_work'; given: OutgoingGive | null }
  /**
   * 🔴 **UI-003 · a request its sender took on for the person** (F038) — `take_on_work`. ⚑ Its
   * `work_given` (`givenBy: null`, the one row only this door writes) is written into THIS ledger
   * and lands on the call, so the card draws the whole brief the arguments cut at 200.
   */
  | { tool: 'take_on_work'; taken: OutgoingTakeOn | null }
  /**
   * 🔴 **D-047 · a piece given a new brief** — an `update_work` call that carried one. ⚑ Its
   * `work_sent` (`as: 'rebriefed'`) lands here, so the card draws the new brief whole. ⚠️ Only a
   * call whose arguments carry a `brief` is this ({@link outgoingToolOf}); every other
   * `update_work` — a status, a title, a close — stays a tool row.
   */
  | { tool: 'update_work'; rebriefed: OutgoingRebrief | null }

/**
 * 🔴 **D-047 · a new brief this conversation gave a piece**, as its own ledger keeps it — off its
 * `work_sent` (`as: 'rebriefed'`).
 */
export interface OutgoingRebrief {
  readonly piece: string
  /** `W1.2` — the label the piece is known by everywhere. */
  readonly label: string
  /** The piece's title as it stood when the new brief went. */
  readonly title: string
  /** ⚑ The whole new brief. */
  readonly brief: string
  /** The conversation holding the piece, which the new brief went to. */
  readonly to: string
}

/**
 * ⚑ **UI-003 · the piece a conversation took on for the person** — off its own `work_given`.
 */
export interface OutgoingTakeOn {
  definitionOfDone?: string
  readonly piece: string
  /** `W1.7` — the label the piece is known by everywhere. */
  readonly label: string
  readonly title: string
  /** ⚑ The whole brief, as the door kept it. */
  readonly brief: string
  /**
   * ⚑ **The newest status line its holder set on it** (`update_work`) — until the reply that
   * finishes it, whose summary is its last word (`WorkStatusSetEvent`).
   */
  status?: string
}

/**
 * 🔴 **D-047 · a piece this conversation gave, as its own ledger keeps it** — off its `work_sent`.
 */
export interface OutgoingGive {
  /** `W1.2` — the label the piece is known by everywhere, which the give's receipt begins with. */
  readonly label: string
  readonly title: string
  /** ⚑ The whole brief, as the holder was given it. */
  readonly brief: string
  /** The conversation holding the piece, which the brief went to. */
  readonly to: string
}

/**
 * Render `ask_question` and `pass_question_up` as question cards. Their `question_asked` row is written before the call answers, with `request_routed` describing the destination, so the card can show the whole question and where it went.
 */
export type QuestionTool = 'ask_question' | 'pass_question_up'

/**
 * ⚑ **UI-009 · one part of a question this conversation sent, with the rules it is answered by** —
 * `question_asked.questions[n]`, read field by field (`UserInputQuestion`'s shape).
 */
export interface OutgoingQuestionPart {
  /** ⛔ The key an answer is filed under — `''` on a row that named none, which nothing can answer. */
  readonly id: string
  /** The provider's short label for the part, when it gave one. */
  readonly header?: string
  readonly prompt: string
  readonly options: readonly { readonly label: string; readonly description?: string }[]
  readonly multiSelect?: true
  /** ⚑ An answer off the list is taken — `raiseAQuestion` sets it wherever it offers options. */
  readonly allowOther?: true
  readonly secret?: true
}

/**
 * ⚑ **`question_asked`, as the card draws it** — plus where `request_routed` sent it and how it
 * closed. ⚑ **UI-009 · and how it was answered**, when this conversation's own ledger says so: the
 * host writes `user_decision` into the ASKER's ledger for a question this app asked, so the card
 * stops offering an answer once one was given.
 */
export interface OutgoingQuestion {
  action?: ActionAsked
  move?: MoveOffer
  movedTo?: MoveReceipt
  /** ⛔ The app's own `req_…` id — what `request_routed` and a closing row name. Never printed. */
  requestId: string
  /**
   * The piece it is about — absent on a question passed up, which names none of this conversation's,
   * and on a question about no piece.
   */
  piece?: string
  /** That piece's label — `question_asked.label`, present beside {@link piece}. */
  label?: string
  /** ⚑ The question it carries, when it was passed up — `question_asked.passedUpFrom`. */
  passedUpFrom?: string
  /** The words, as recorded — whole. */
  prompt: string
  /** Each part, its options, and the rules it is answered by. */
  parts: readonly OutgoingQuestionPart[]
  /** ⚑ What the conversation that passed it up added, beside the words and never instead of them. */
  context?: string
  /** Where it went — `request_routed.to`; absent until that row lands. */
  to?: RequestRoutedEvent['to']
  /** ⚑ The parent it went to, as a profile — the piece's giver. Absent where this ledger cannot say. */
  toProfile?: string
  /** ⛔ The conversation that answers it — `request_routed.parent`, for the card's press; never printed. */
  toConversation?: string
  /** ⚑ How it closed without an answer — `question_withdrawn`, `question_recipient_ended`. */
  closed?: 'withdrawn' | 'recipient-ended'
  /** ⚑ **UI-009 · how it was settled** — `user_decision`, in this conversation's own ledger. */
  answered?: 'answered' | 'rejected'
  /** ⚑ Who settled it — `user_decision.by`, beside {@link answered}. */
  by?: ActedBy
  /** ⚑ **UI-009 · the host's words for an answer from this window it did not take** — still open. */
  refused?: string
  /** ⚑ **UI-009 · the host's words for an answer it closed** — kept for a next start, or over. */
  note?: string
}

/**
 * ⚑ `work_replied`, as the card draws it — plus WHO it went to, from this ledger's `work_given` and
 * the brief that gave the piece.
 */
export interface OutgoingReply {
  piece: string
  outcome: WorkRepliedEvent['outcome']
  summary: string
  /** ⚑ The resources the reply handed in, by id — possibly none. */
  resources: readonly string[]
  needsUserAction?: true
  /** The label the piece is known by — absent when its `work_given` is before the retained suffix. */
  label?: string
  /**
   * ⚑ **The conversation that GAVE the piece, as a profile** — the relayer the brief that gave it
   * named (`user_turn.relayedFromProfile`). ⚠️ Absent when that turn is before the retained suffix
   * or names no identity: the card then says *its parent* rather than a name it guessed.
   */
  toProfile?: string
  /** ⚑ That conversation's id — `work_given.givenBy` — so the card can open it. Absent with the row. */
  toConversation?: string
  /**
   * ⚑ **D-016 · commit 6 · a piece a person gave** — `work_given.givenBy` is `null`: its holder
   * took it on for the person, and the reply went to no conversation (R5). ⚠️ Absent also where
   * this ledger's `work_given` is before the retained suffix — `work_replied` names no giver — and
   * the card then reads as any reply whose give is out of view: *its parent*, and — once the call
   * answered — the receipt, which says where the reply went, never *delivered*.
   */
  toThePerson?: true
  /**
   * 🔴 **The reply was recorded and did NOT reach its parent** — `reply_undelivered.because`, one of
   * `REPLY_DELIVERIES` that `REPLY_LANDED` says landed nowhere — ⚑ or, since `729` (R89),
   * `held-then-lost`: a reply HELD for its parent (the call said `held`, or `kept` — D-030) whose
   * held message then ended unsent, a row that arrives LATER, after the call answered.
   *
   * ⛔ **Without it the card would say *delivered* over a lost reply** — `HO-021`'s *"the one failure
   * mode with no signal"*, drawn as a success. ⚠️ Absent means no such row arrived; it is read as
   * *delivered* only once the call has answered, because the host writes the call's own row before it
   * does — and a card that read *delivered* moves when the later row comes.
   */
  undelivered?: string
}

/** ⚑ `message_sent`, as the card draws it. */
export interface OutgoingMessage {
  /** ⚠️ The recipient's PROFILE — `null` when its identity row was not written yet. */
  toProfile: string | null
  /** ⛔ The recipient CONVERSATION, for the card's press — never printed: it is a `sess_` handle. */
  toConversation: string
  /** The receiver's recorded conversation label, separate from the subject piece. */
  toLabel?: string
  /** The sender's claim — `null` when a replayed row carries a word this app does not know. */
  kind: MessageSentEvent['kind'] | null
  /** ⛔ `null` when a replayed row does not say — then nothing on the card claims it was sent. */
  delivery: MessageSentEvent['delivery'] | null
  /**
   * ⚑ **678 · the words, as the host recorded them** (`671` G1) — `null` on a row written before
   * `671`, and on one whose field is not a string: the card then reads the call's arguments.
   */
  text: string | null
  /** ⛔ **`text` is the head of a longer message** — `MessageSentEvent.clipped`, never inferred. */
  clipped: boolean
  /**
   * 🔴 **688 · the piece these words name, on the SENDER's card** (`687` H2; a piece since D-016) —
   * {@link RelayedItem.opened}'s shape, read by the same function (`pieceSays`), so a card names a
   * piece one way wherever it is drawn.
   *
   * ⚑ Present when the receipt names a piece ({@link MessageSentEvent.piece}) — a follow-up always
   * does, a note may; `label` when it also carries {@link MessageSentEvent.label} as a label
   * `pieceCalled` spells. ⚠️ **Absent** for a message about no piece. ⛔ **A piece with no readable
   * label is *Piece*** — never a label guessed.
   */
  about?: { label?: string }
}

/**
 * What became of one tool call's detached work (248) — see {@link ToolItem.background}.
 *
 * Deliberately NOT a transcript item, for the reason {@link WorkflowRunCard} is not: the call that
 * started it is already on screen, and a second row for the same event is `035`'s duplicate.
 */
export interface DetachedWork {
  /**
   * The provider's own stop key — Claude's `task_id`, Codex's `processId` — or absent when the
   * receipt carried none.
   *
   * ⛔ **It is the CORRELATION between this row and the registry above the composer**, and that is
   * what it is for rather than a field kept in case. The two surfaces show one piece of work in two
   * places on purpose (§3), and without a shared key on screen a reader cannot tell whether the row
   * saying *"still running"* is the row the bar is offering to stop. `ToolEntry` renders it as
   * `data-background-id`.
   *
   * ⚠️ **The stop is NOT gated on it.** That control lives in the registry, whose own rows carry a
   * required id; gating a second affordance on this one would be the *"one at a time"* shape `094`
   * is about. Absent is still a real state — the provider named no key — and it means only that this
   * row cannot be pointed at a bar row.
   */
  id?: string
  /** Only ever set from an ending the provider reported. Absent = still running. */
  outcome?: BackgroundOutcome
  /**
   * We stopped watching before this work reported back (074's rule, applied here) — set by
   * {@link stopOpenToolCalls} at every boundary that ends the thing running it.
   *
   * ⚠️ **Deliberately NOT an outcome.** `outcome` stays absent because none arrived; this says only
   * that none ever will, which is what turns a false *"still running"* into a true *"did not
   * finish"*. Without it a conversation quit mid-command would replay, forever, claiming a dead
   * process was live — `222`'s stale indicator arriving through the store rather than through a
   * missed bookend.
   */
  unfinished?: boolean
  /**
   * The provider's own sentence about how it ended — *"Background command … completed (exit code
   * 0)"*. Rendered in the card's body beside the receipt, so the row that said it LEFT also says
   * what became of it.
   */
  summary?: string
  /**
   * Where the work wrote its output.
   *
   * ⛔ **Nothing opens it, and that is named rather than implied.** `WorkflowRunCard` carries the
   * same field WITH an affordance behind it (`readWorkflowOutput` over IPC, an overlay in the pane);
   * background work has no such read, so writing one is a dispatch of its own rather than a line
   * here. It is kept because it is the provider's own fact about this row — a reader who opens the
   * Events tab can follow it today — and because the alternative is re-deriving it from a ledger
   * later. ⚠️ The doc it replaced said *"opened on request"*, which was `107` §4's rule quoted about
   * a control that does not exist.
   */
  outputFile?: string
  /**
   * When the ending landed, so the row can say how long the WORK took rather than how long the
   * detachment took.
   *
   * ⛔ Without this the card would print the receipt's duration — `1.2 s` for a command that ran for
   * half a minute — which is a smaller version of the same lie this whole task is about.
   */
  endedAt?: number
}

/**
 * One dynamic workflow, folded from its frames (108, designed in 107).
 *
 * ⚠️ **Not a transcript item, for the same reason {@link SubAgentCard} is not**, and with a sharper
 * consequence: the reproduction run sent **12 frames** and a 22-agent run would send far more. If
 * each were an item, asking for a workflow would bury the conversation under its own progress bar —
 * 078's *"without turning every usage update into a transcript row"*, which is the rule this whole
 * surface is built to keep.
 *
 * It belongs to the `Workflow` tool call that launched it, bound by `toolUseId`, and is mutated in
 * place by every later frame.
 */
export interface WorkflowRunCard {
  /** `task_id` — the correlation key across all four subtypes. */
  taskId: string
  /** The launching tool-use id, kept so an orphan can be adopted later (029's precedent). */
  toolUseId?: string
  /** The workflow's own name, from `task_started`. */
  name?: string
  /** What the run was asked to do. */
  description?: string
  phases: WorkflowPhase[]
  agents: WorkflowAgent[]
  /** Run-level totals, replaced wholesale on each frame — they are a statement about now. */
  usage?: { tokens?: number; toolCalls?: number; ms?: number }
  /** True until an ending arrives, or until the thing running it goes away. */
  running: boolean
  /** Only ever set from an ending the provider reported. Absent = still running. */
  outcome?: 'completed' | 'failed' | 'unknown'
  /** Where the run wrote its answer (107 §4). Opened on request, never inlined. */
  outputFile?: string
  /**
   * We stopped watching before this run reported back (074's rule, applied here). Deliberately NOT
   * an outcome: `outcome` stays absent because none arrived, and this says only that none ever will.
   */
  unfinished?: boolean
  /** Agents the provider named past the cap, so the tree can say so rather than look complete. */
  droppedAgents?: number
}

/**
 * One sub-agent the main agent dispatched (029) — what it is, what it is doing, and how it ended.
 *
 * It is NOT a transcript item. It belongs to the tool call that dispatched it, so it lives on that
 * {@link ToolItem} and is bound by `parentToolCallId` — never by being the most recent thing on
 * screen. `tools` is the child's OWN tool activity, which Claude forwards into the parent stream by
 * default; collecting it here is what turns a heartbeat counter into a nested transcript, without
 * enabling `forwardSubagentText`.
 */
export interface SubAgentCard {
  agentId: string
  /**
   * What kind of thing `agentId` IS (111), as the adapter stated it on the wire — a dispatch inside
   * the parent's process (`task`), or a real thread with a file of its own (`thread`).
   *
   * ⚠️ **Read, never derived.** The renderer may not recognise a provider (039), and this is the
   * fact that actually differs — see `subAgentEventSchema.idKind`.
   */
  idKind?: 'task' | 'thread'
  /** The dispatching tool-use id — the binding, kept so an orphan can be adopted later. */
  parentToolCallId?: string
  /**
   * How this agent became known (135) — see `subAgentEventSchema.origin`.
   *
   * ⚠️ **`observed` is the only value that changes what the card says, and the distinction it draws
   * is not "no `parentToolCallId`".** A Claude `task_updated` also arrives without one, and it is a
   * child whose dispatch we simply have not been told yet — `rehome` adopts it the moment we are.
   * An `observed` card is one nothing will ever adopt: its dispatch happened on another connection,
   * so its parent is unknown rather than pending, and the head must say so instead of showing a
   * nameless peer of the child that actually spawned it.
   */
  origin?: 'announced' | 'observed'
  kind?: string
  title?: string
  lastTool?: string
  usage?: { tokens?: number; toolCalls?: number; ms?: number }
  /** True until an ending arrives, or until the turn ends without one. */
  running: boolean
  /** Only ever set from an outcome the provider reported. Absent = "we were not told". */
  outcome?: 'completed' | 'failed' | 'interrupted'
  summary?: string
  /**
   * What the child DID and what it SAID, in the one order it arrived in (128).
   *
   * ⚠️ **One list, because 058's rule is about a single sequence.** `044` P3 shipped tools and text
   * in two collections and reassembled them for display, and the reassembly put a tool in front of
   * the text that preceded it. Two arrays merged at render is that same shape: an order held in two
   * places is an order that can disagree with itself. Here the sequence IS the storage, so a prose
   * run between two calls cannot be anywhere but between them.
   */
  body: SubAgentBodyRow[]
}

/** One of the child's own tool calls, as it appears in {@link SubAgentCard.body}. */
export interface SubAgentToolRow {
  kind: 'tool'
  callId: string
  name: string
  summary: string
  result?: { summary: string; ok: boolean }
  /** As {@link ToolItem.unfinished}, for the child's own rows. */
  unfinished?: boolean
  /**
   * As {@link ToolItem.background}, for the child's own rows (248).
   *
   * ⚑ **Not defensive.** `248` §5's probe measured a dispatched sub-agent running a `Bash` of its
   * own, and nothing stops that child asking for `run_in_background` — the same field, the same
   * receipt, one level down. A card row that stayed green while its command ran on would be the
   * defect this task exists to end, moved somewhere harder to see.
   */
  background?: DetachedWork
  /**
   * The agents THIS call dispatched (035) — an agent's agent, nested under the call that made it
   * rather than stranded at top level. Absent for the overwhelming majority of calls, which
   * dispatch nothing; a card is only ever added here by {@link placeCard} or {@link rehome}.
   */
  subAgents?: SubAgentCard[]
}

/**
 * A run of the child's own words, forwarded into the parent stream and owned by its card (128).
 *
 * ⛔ **A run, not a message, and never merged with its neighbours.** The adapter already flushes a
 * text run whenever a tool interrupts it (058), so two runs on a card are two things the child said
 * with work in between. Concatenating them here would undo the ordering the wire took care to keep.
 */
interface SubAgentProse {
  kind: 'prose'
  id: string
  text: string
}

type SubAgentBodyRow = SubAgentToolRow | SubAgentProse

/**
 * The agent's working checklist (028) — one item that updates IN PLACE for as long as the turn
 * runs, because it is the plan as it stands now and not a log of every revision it went through.
 *
 * `steps` is always the COMPLETE list: both adapters state it wholesale (the Claude one keeps the
 * running list itself, since its todo tools are incremental), so the fold replaces and never merges.
 */
export interface PlanItem {
  kind: 'plan'
  id: string
  steps: { text: string; status: 'pending' | 'active' | 'done' }[]
  /** Codex's `explanation` — a sentence about the plan, not a step in it. */
  note?: string
  /** A plan DOCUMENT. Unpopulated until 030 fills it from plan mode. */
  body?: string
}

export interface PermissionItem {
  kind: 'permission'
  id: string
  request: PermissionRequestEvent
  /** The decision this app sent, or null while the agent is still frozen on it. */
  outcome: PermissionOutcome | null
  /** Why it stopped being actionable without a decision (teardown), or why answering failed. */
  note: string | null
  /** {@link UserInputItem.refused} — the same field, for the same reason. */
  refused: string | null
  /**
   * 🔴 **Who answered it** (503) — {@link UserDecisionEvent.by}, carried off the row that set
   * {@link outcome} and off nothing else.
   *
   * ⛔ **OPTIONAL for one reason only: the row was written before this app recorded who** (HO-029
   * §2.2). ⚠️ It is NOT *an actor we failed to write* — every writer has written it since `477` —
   * and nothing backfills.
   *
   * ⚑ **Read only where {@link outcome} is non-null.** A card settled by a teardown has no
   * decision, so it has no answerer and no ledger gap either; see {@link whoAnsweredIt}.
   */
  by?: ActedBy
  /**
   * ⚑ **D-017 · R19 — this app routed the request** (`request_routed`): to the parent, which
   * answers it, or to a person's queue, which the host's own read lists. ⛔ So *Waiting on you*
   * never counts this card: it is listed there from the host's read or not at all. ⚠️ Optional,
   * because a card nothing routed — one in a conversation no agent started — carries no such row.
   */
  routed?: true
  /**
   * ⚑ **D-017 · R19 — the conversation this app routed it to, which owes its answer** — the row's
   * `parent`, on a card routed to the parent or to an agent it named, and absent on one routed to a
   * person. ⚑ While it waits, this conversation is *waiting on that one's answer*, never *needs you*
   * ({@link TranscriptState.routedAway}); a person may still answer it here.
   */
  routedTo?: string
}

/**
 * ⚑ **D-017 · R19 — the waiting cards this app routed to another conversation**
 * ({@link TranscriptState.routedAway}): how many of each, and the conversation owing the first of
 * them's answer.
 */
export interface RoutedAway {
  permissions: number
  questions: number
  to: string
}

export interface UserInputItem {
  kind: 'userInput'
  id: string
  request: UserInputRequestEvent
  answered: 'answered' | 'rejected' | null
  note: string | null
  /** {@link PermissionItem.by} — the same field, off the same row, for the same reason. */
  by?: ActedBy
  /** {@link PermissionItem.routed} — the same field, off the same row, for the same reason. */
  routed?: true
  /** {@link PermissionItem.routedTo} — the same field, off the same row, for the same reason. */
  routedTo?: string
  /**
   * Why the LAST attempt to answer did not land, on a card that is **still waiting** (146).
   *
   * ⛔ **A second field rather than a second meaning for `note`, because they are opposites.** A
   * note is an ending — teardown settled this card, the provider withdrew it, the host refused a
   * response for a request that has gone — and {@link isAwaitingAnswer} reads it as one. That is
   * exactly what killed a live card: the adapters refuse an unusable answer BEFORE it takes the
   * broker slot, so nothing is written and the question is still on screen, and writing a note
   * about it removed Answer, removed Reject, dropped the card from the waiting panel and unfroze
   * the composer while the provider went on waiting (145 HIGH 1).
   *
   * So this says the other thing: the gesture bounced, the sentence explains why, **and the card is
   * unchanged**. ⛔ **It is copy and not state**: {@link isAwaitingAnswer} ignores it, nothing
   * branches on it, and a card carrying one is exactly as answerable as a card carrying none.
   *
   * ⚠️ **It used to say *"nothing derived reads it"* and `468` made that false** — the sentence
   * survived the change that killed it, which is `458`'s subject. `attentionQueue` now carries it
   * onto {@link AttentionRequest.refused} so the person's own queue can draw the same sentence the
   * card does, from this one field. ⚑ **Still copy**: the projection renders it and decides
   * nothing with it.
   */
  refused: string | null
}
