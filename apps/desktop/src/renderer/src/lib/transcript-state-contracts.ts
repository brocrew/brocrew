import type { WorkAncestry } from '../../../shared/work-ancestry'
import type { BackgroundRow, ScheduledRow } from '../../../shared/agent-state-contracts'
import type { HumanAnswers } from '../../../shared/human-answer-contracts'
import type { RefusalTold } from '../../../shared/refusals'
import type {
  ContextReading,
  DeclaredToolset,
  FileChange,
  ProviderCommandSet,
  PublishedInventory,
  SessionRef,
  SessionStatus,
  ToolNaming,
} from '../../../shared/runtime-ipc'
import type { MessageJoins } from './message-receipt-contracts'
import type { StopUnanswered } from './stop-unanswered'
import type { NoticeItem, RelayedItem, TranscriptItem } from './transcript-message-contracts'
import type {
  OutgoingWords,
  RoutedAway,
  WorkflowRunCard,
  SubAgentCard,
} from './transcript-tool-contracts'

/**
 * **What is still running in this conversation, as the provider last stated the LEVEL** (248).
 *
 * ⛔ **REPLACE, never merge, and absent is not empty.** `247` carried the SDK's own instruction into
 * the event: *"consumers … should replace their set with each payload rather than pairing edges, so
 * a missed bookend cannot wedge a stale running indicator"*, and `[]` is the provider saying nothing
 * is running — the fact that clears this — while an event with no `running` at all did not state the
 * level and must change nothing. `222` is what a stale indicator costs.
 *
 * ## 🔴 Each row carries the COMMAND it is running (251 §2) — resolved once, and carried
 *
 * ⛔ **Not on the wire, and deliberately not added to it**: the `tool_call` that started the work
 * carries it and `toolCallId` is the join, so this is a read rather than a new fact. ⚠️ **Resolved
 * into the row rather than looked up when the bar renders**, because the registry outlives the items
 * — `carryForward` copies it across a slab release and carries no items — so a render-time join
 * would fall back to the description on a row that had not changed. ⚑ Which is also why
 * {@link withCommand} falls back to the PREVIOUS registry's answer: REPLACE governs *which work is
 * running*, and a row absent from the new payload stays gone.
 *
 * ⚑ **D-017 · R11 — the row is `shared/agent-state.ts`'s `BackgroundRow`**, which `main` fills the
 * same way from the same join, so an agent's *"running in the background · <command>"* is one
 * string in a tool's answer and on this window's plate.
 */
export interface BackgroundRegistry {
  /** Every piece of live background work after the last frame that stated the level. */
  running: BackgroundRow[]
  /**
   * ⚠️ **Rows the provider sent that the last level event did not carry** — past the cap, or with no
   * id at all. Non-zero means this list is UNDERSTATING what is running, and `247` §3 requires it
   * said out loud: *"a registry that quietly undercounts is worse than none."*
   *
   * Replaced together with {@link running}, because it describes that level and no other. An event
   * carrying only an ending leaves both alone.
   */
  dropped: number
}

/**
 * **What this conversation has promised to do LATER, as the provider last stated the LEVEL** (258,
 * from `253`'s event).
 *
 * ⛔ **The same REPLACE rule as {@link BackgroundRegistry}, and the same absent-is-not-empty line.**
 * `jobs` absent is *"this frame did not state the level"* and must leave the screen alone; `jobs: []`
 * is *"the provider says nothing is scheduled"* and is the only thing that clears the list.
 * Conflating them cost `222` a whole dispatch, and here the cost is sharper than a stale indicator:
 * a level that arrives with only an ending would erase a job that really is still going to fire.
 *
 * ⚠️ **Two REGISTRIES rather than one, and they are not two readings of one fact** (`253`, which
 * measured the difference rather than assuming it). `background_work` says what is running NOW; this
 * says what will run LATER. A cron produced **0** of the five `task_*` frames a backgrounded `Bash`
 * produced one row later in the same capture, and the SDK's own `BackgroundTaskSummary.type` labels
 * (`shell | subagent | monitor | workflow`) have no scheduled member. Merging them would put a
 * Stop button on a row nothing can stop and a *"still running"* word on work that is not.
 */
/**
 * **What the running agent will answer to, as the provider last stated it** (279).
 *
 * ⛔ **`set: null` is not `set: {commands: []}`, and this is the registry where that distinction is
 * finally visible to a person.** `279` §2: *"A session that has not started has no provider
 * commands. Say so; do not show an empty section as though the agent had none."*
 *
 *  - **`null`** — nobody has told us. A session that has not started; a session whose provider read
 *    failed; a recorded conversation being read back. The band is ABSENT and a sentence says why.
 *  - **`{commands: []}`** — the provider answered, and the answer is that this agent has none. The
 *    band may say so.
 *
 * ⚠️ **The event cannot express the first**, deliberately: `provider_commands.commands` is required,
 * so *"we were not told"* is the absence of the event rather than a field inside one. That is what
 * makes `null` unforgeable here — no adapter can publish it by accident.
 */
export interface CommandRegistry {
  /** The list and its prefix, together, as one frame stated them — or `null` if none has. */
  set: ProviderCommandSet | null
  /**
   * ⚠️ **Rows the provider named that the last level event did not carry** — past the cap, or with
   * no usable name. Non-zero means this list is UNDERSTATING what the agent has, and `247` §3's rule
   * applies unchanged: *"a registry that quietly undercounts is worse than none."*
   *
   * Replaced together with {@link set}, because it describes that list and no other.
   */
  dropped: number
}

/**
 * 🔴 **The tools this conversation has, as the last frame stated them** (358).
 *
 * ⛔ **THREE states, not two, and every one of them renders differently.** `279` needed
 * `null ≠ []`; this needs one more, because Codex will never publish an inventory and *"the
 * provider does not report one"* is permanently different from *"nobody has told us yet"*:
 *
 *  - **`set: null`** — nobody has told us. A session that has not started, one whose adapter
 *    published nothing, or a recorded conversation whose ledger holds no inventory up to the page
 *    being read (D-035: a page brings the one in force where it begins). ⛔ It must NOT read as a
 *    conversation with no tools.
 *  - **`set.published === null`** — the provider does not publish an inventory. BroBot's own
 *    declaration is known and may be shown as OFFERED; nothing here is confirmation, and the
 *    surface says which provider this is and why.
 *  - **`set.published !== null`** — the child stated its own inventory. Offered and confirmed can
 *    be told apart, and a tool BroBot declared that the child did not list is visible as exactly
 *    that.
 *
 * ⚠️ **The event cannot express the first**, deliberately: `tool_inventory.published` is required
 * and nullable, so *"we were not told"* is the absence of the event rather than a field inside one.
 * That is what makes `null` unforgeable here — no adapter can publish it by accident.
 */
export interface ToolRegistry {
  /** The last whole statement — both halves, as one frame made them — or `null` if none has. */
  set: ToolInventorySet | null
  /**
   * ⚠️ **Rows the last frame named that it did not carry** — past a cap, or with no usable name.
   * Non-zero means this inventory is UNDERSTATING what the conversation has, and `247` §3's rule
   * applies unchanged: *"a registry that quietly undercounts is worse than none."*
   *
   * Replaced together with {@link set}, because it describes that statement and no other.
   */
  dropped: number
  /**
   * 🔴 **WHEN this statement was made, epoch ms** (444, `444` relay 1). Null when nothing has
   * reported, or when the fold had no clock — worded on {@link ContextMeter.at}, which is the
   * sibling arm this copies.
   *
   * ⛔ **A count with no moment is a count a person cannot read.** A conversation started before
   * `441` showed **15** tools and a new one showed **16**; both numbers were true, and nothing on
   * any surface said which instant either was true AT. ⚑ `agentToolsFor` runs at
   * `startSessionInProfile` and at `reopenSession` and nowhere else, so a live conversation keeps
   * the set it was built with until it is reopened — and the two answers differ for exactly that
   * long.
   *
   * ⚠️ **Required, not optional, and that is the point.** `transcript-window.ts`'s `carryForward`
   * builds this registry FIELD BY FIELD by hand — its own docblock says *"nothing in the
   * typechecker would have said this field was missing"* — so an optional moment would be dropped
   * at the first window release with no compile error and no red test.
   *
   * ⛔ **It is not the moment we ASKED, and not necessarily a launch.** Claude publishes on every
   * `system/init` and an identical re-publish writes no row at all (its `lastInventory` dedup), so
   * this is when the ANSWER last moved — which is usually a launch and is not only a launch.
   */
  at: number | null
}

/**
 * One whole statement about one moment: what was offered, and what the child said it has.
 *
 * ⛔ **They travel together for `provider_commands`' reason, applied to two fields instead of
 * three**: a consumer that took `declared` from this frame and `published` from the last would be
 * reporting a disagreement that never existed.
 */
interface ToolInventorySet {
  /**
   * ⛔ **How this provider spells a server's tool.** Carried so nothing downstream has to recognise
   * a provider to read a name — `039`, enforced by `provider-neutrality.test.ts`.
   */
  naming: ToolNaming
  /** What BroBot handed this session — offered, never proof. */
  declared: DeclaredToolset | null
  /** What the child published about itself. `null` ⇒ this provider publishes none, ever. */
  published: PublishedInventory | null
}

export interface ScheduleRegistry {
  /**
   * Every job its provider listed in the last frame that stated the level — each with the moment
   * this fold first saw it listed ({@link ScheduledRow.listedSince}), which is what lets the one
   * state tell a one-shot's time from one that has passed. ⚠️ Not every job that will wake this
   * conversation: once it stops, the host starts it only for the jobs its provider will bring back
   * (D-029), and a view drawn from its ledger wears the host's word.
   *
   * ⛔ **Not swept at a session boundary**, as `stopDetachedWork` sweeps the registry above: `253`
   * measured a resumed session reporting the same job back on a `Stop` at 4 336 ms — *before its own
   * first prompt at 4 526 ms* — and ⚑ D-029 this app starts a stopped conversation in time for its
   * jobs, so a stop leaves its schedule its schedule.
   */
  jobs: ScheduledRow[]
  /**
   * ⚠️ **Rows the provider sent that the last level event did not carry** — past the 100 cap, or
   * with no id at all. Non-zero means this list is UNDERSTATING what is scheduled, and `247` §3's
   * rule applies unchanged: *"a registry that quietly undercounts is worse than none."*
   *
   * Replaced together with {@link jobs}, because it describes that level and no other.
   */
  dropped: number
  /**
   * ⚑ **F035 — the rows the last level took off, with their first listing**, so a job put back by
   * the level after keeps its moment. ⚠️ The host takes a one-shot whose minute had come off its own
   * level as the turn it began starts, and the provider's restated level puts it back when it had
   * not fired: listed again from that row's moment, a one-shot whose minute has passed would be
   * promised a year away. One level back only, which is the drop and its correction.
   */
  left: ScheduledRow[]
}

/**
 * What the context meter knows right now — a statement about the present, replaced wholesale.
 *
 * Deliberately NOT an item, for the same reason `activity` is not one (027): 078's whole point is
 * that a live gauge must absorb the usage stream instead of turning it into transcript rows. Codex
 * emits one of these per turn and Claude two per assistant message; as items they would bury the
 * conversation, and as a single replaced value they cost nothing.
 *
 * ⚠️ **`reading` is never null — it starts at `{kind:'unknown'}`.** A fresh conversation, a resumed
 * one that has not spoken and an imported read-only session all sit there, and the surface renders
 * *"no reading yet"* from a real value rather than from a null check that would tempt someone into
 * rendering a zero.
 */
interface ContextMeter {
  reading: ContextReading
  /** The provider's own signal name it was read from. Null exactly while nothing has reported. */
  source: string | null
  /** When it was read, epoch ms. Null when nothing has reported, or when the fold had no clock. */
  at: number | null
}

/** One provider report of file changes, kept as it arrived (096). */
export interface ChangeReport {
  /** A monotonic id, so a row can point at the report holding its diff without holding the text. */
  id: string
  changes: FileChange[]
  /** Files the report named beyond the cap — surfaced, never swallowed. */
  dropped: number
  /** The provider's own signal name: `turn/diff/updated`, `Edit`, `Write`. */
  source: string
  /** Which turn it landed in, counting from 1. The pane's This turn / Whole conversation axis. */
  turn: number
  /** True once this report's diff bodies were released — see {@link MAX_HELD_DIFF_REPORTS}. */
  released: boolean
  /**
   * WHICH ledger event produced it, when the fold was given one — see {@link Placed} for why this
   * exists at all.
   *
   * ⛔ **It is what makes the log CARRYABLE across a window release** (299 §2 finding 5). The state
   * a carry is computed from covers a superset of the events about to be re-folded, so carrying the
   * reports whole would double every one the retained suffix restates. The ordinal answers *"will
   * the re-fold build this again?"* exactly, where a count or a length cannot.
   *
   * Absent on a report built by a fold with no ordinals. Such a report is NOT carried — dropping it
   * is what happened to every report before this dispatch, so an unstamped fold is left exactly as
   * it was rather than given a guess.
   */
  ordinal?: number
}

/**
 * What the agent has done to the working tree (096, designed in 092).
 *
 * ⚠️ **Not items, and for the same reason the context meter is not one** (087): the transcript is
 * what the reader scrolls, and a file change is not a line in the conversation — 092's whole thesis
 * is that the individual writes stay inline as tool rows and the PANE consolidates them. Putting
 * reports in `items` would also have quietly changed every count, every window and every "is this
 * conversation empty" answer in the app, which is a large blast radius for a facet nothing renders.
 */
export interface ChangeLog {
  reports: ChangeReport[]
  /** Turns so far — each user message opens one. Zero until the reader says something. */
  turn: number
  /** Monotonic counter behind {@link ChangeReport.id}. */
  seq: number
  /**
   * Reports this fold is no longer holding, because a window release carried more of them across
   * than {@link MAX_CARRIED_CHANGE_REPORTS} (299 §2 finding 5).
   *
   * ⛔ **A cap is never silent** — 092's rule, 096's precedent, and the same shape as
   * `background.dropped` and `schedule.dropped`. It is a count of REPORTS and not of files: what
   * was released is exactly what we can no longer name, so naming a number of files would be an
   * invention. The pane says how many observations it has stopped holding, and nothing more.
   *
   * Zero for the whole life of any conversation short enough never to roll its window.
   */
  dropped: number
}

export interface TranscriptState {
  workAncestry: {
    after: number
    agents: Map<string, WorkAncestry['agents'][number]>
    tools: Map<string, WorkAncestry['tools'][number]>
    dispatches: Map<string, WorkAncestry['dispatches'][number]>
    missing: NonNullable<WorkAncestry['missing']>
    truncated: boolean
  }
  humanAnswers: HumanAnswers
  items: TranscriptItem[]
  status: SessionStatus
  /** The provider ref once announced — null for Claude until its first turn's init. */
  ref: SessionRef | null
  /** True once the session is terminal (closed or fatally errored): no further turns. */
  ended: boolean
  /** Monotonic item-id counter. */
  seq: number
  /** The assistant item currently receiving deltas. */
  streamingId: string | null
  /**
   * The streamed assistant block that no authoritative `assistant_message` has confirmed yet
   * (068, fixing 066 F5). Deltas are progressive rendering; the authoritative message is the truth.
   * A `tool_call` closes the streaming block, so without this the authoritative message could no
   * longer find it and appended a SECOND block with the same text.
   */
  provisionalId: string | null
  /**
   * What the agent is doing RIGHT NOW (027), or null when it is doing nothing we were told about.
   *
   * Deliberately NOT an item: this is a statement about the present, not a line in the transcript.
   * It is replaced wholesale as the phase changes and cleared when the turn ends.
   *
   * Only `turn` and `user_turn` clear activity. An activity event arriving between turns therefore survives until the next prompt; it cannot be assumed to end with the turn, especially for background sub-agent notifications.
   *
   * The field is kept rather than suppressed — it is a true report of what the provider is doing,
   * and throwing it away would lose information. What changed is that nothing may read it as proof
   * a turn is running: see `sessionDoing`, where `status` frames and this only refines.
   */
  activity: { phase: 'thinking' | 'tool' | 'waiting' | 'compacting'; detail?: string } | null
  /** The thinking block currently taking deltas, if any. */
  thinkingId: string | null
  /**
   * The checklist the CURRENT turn is updating, or null (028).
   *
   * Cleared when the turn ends, so a plan that carries on across turns is restated as a new block
   * rather than silently mutating one far above where the reader is. Both facts are complete and
   * true where they sit, and the transcript still reads in the order things happened.
   */
  planId: string | null
  /** tool-call id → item id. */
  toolItems: Record<string, string>
  /**
   * sub-agent id → the item that HOLDS its card (029): the dispatching tool row, or the top-level
   * `subAgent` item standing in for one that has not arrived. This is how a `progress` or `ended`
   * finds the card it belongs to — by identity, never by position.
   */
  subAgentHomes: Record<string, string>
  subAgentCards: Map<string, SubAgentCard>
  /**
   * A sub-agent's OWN tool call → the agent that made it (035).
   *
   * Index tool-use ids inside child cards separately from {@link toolItems}. A grandchild can name one as its parent even though that call has no top-level tool item; without this index the grandchild is stranded at the conversation root.
   */
  cardTools: Record<string, string>
  /**
   * sub-agent id → the answer whose echo has already been taken off that card (137).
   *
   * ⛔ **The memory {@link dropEchoedProse} did not have, and 136 measured what its absence cost.**
   * Removing "the most recent row equal to the summary" is a rule with no end: a card whose ending
   * arrives BEFORE the child's forwarded words removes one row per arriving message, so a child that
   * said the same sentence twice with work in between lost both copies and the body kept only the
   * tool. An echo is one event said twice, so exactly one removal answers it.
   *
   * Keyed by the ANSWER and not by a flag, because a summary can be restated and grow: a later,
   * longer answer is a different sentence and is allowed its own single removal.
   *
   * ⚠️ **Not carried across a window release, and the reason is on the other side of the carry**:
   * `asSubAgentEvent` deliberately does not restate a card's `summary`, so a rebuilt card has no
   * answer to measure anything against and there is no removal for the fresh fold to make twice.
   * ⛔ The first version of that carry DID restate it, and review measured the consequence — a
   * sentence spliced out of its chronological position, 136 §3 sequence two, reintroduced. Carrying
   * this map instead would not have fixed it and would have broken the other direction: a release
   * that leaves the echo ITSELF in the retained suffix needs the removal to happen, and a carried
   * memory would suppress it.
   */
  echoedAnswers: Record<string, string>
  /** request id → item id, for both permission and user-input cards. */
  /**
   * ⛔ **A `Map`, because the key is the PROVIDER's request id** (150, from 148 H3) — the same
   * reason and the same representation as {@link SessionRecord.requests}. Claude takes it straight
   * from the SDK's `toolUseID`, so `__proto__` is a legal one, and `state.requestItems['__proto__']
   * = itemId` on an ordinary object hits the inherited setter and stores nothing at all.
   */
  requestItems: Map<string, string>
  /**
   * 🔴 **474 · piece id → the label a person says out loud and the title it was given, for the work
   * THIS conversation was given** (from `463` F4; pieces since D-016).
   *
   * ⛔ **It draws no item of its own and exists only so another row can name its subject** — ⚑ and,
   * since UI-003, so a piece taken on for the person lands on its call's card.
   * `work_given` is ledger-only here and stays ledger-only — the brief above or below it already
   * says the work arrived — but the label it carries is the only thing in this ledger that turns the
   * `work_<uuid>` a reply's row names into something a reader recognises.
   *
   * ⛔ **A miss is a fact, not a gap**: a reply to a piece given before the retained suffix begins
   * finds nothing here, and its card says so rather than naming a label it guessed — which is the
   * digest's own rule for the same edge (`466`, *"the honest absence of it"*).
   */
  piecesGiven: Map<string, { label: string; title?: string }>
  /**
   * 🔴 **658 · who GAVE each piece in hand** — by piece id, so a reply's card can name the
   * conversation it goes to: the conversation from `work_given.givenBy`, and its identity from the
   * brief's own `relayedFromProfile`, since `work_given` names a conversation and no identity.
   * ⚑ **D-016 · commit 6 · or `person`**: a `work_given` whose `givenBy` is `null` — a piece its
   * holder took on for a person, which no brief gives. ⛔ The same retained-suffix rule as
   * {@link piecesGiven}: a miss is a fact, and the card says *its parent*.
   */
  pieceGivers: Map<string, { profile?: string; conversation?: string; person?: true }>
  /**
   * 🔴 **678 · a brief that arrived before the row that titles it** — the IDLE branch's order (see
   * {@link RelayedItem.opened}). ⚑ Emptied as each `work_given` arrives; a brief whose row never
   * comes stays here and goes on saying its label alone, which is the truth about it.
   */
  briefsAwaitingTheirTitle: Map<string, RelayedItem>
  /**
   * 🔴 **658 · a messaging row that landed BEFORE the call that wrote it** — see {@link landOutgoing}.
   *
   * ⚠️ **The host writes `work_replied`/`message_sent` inside the tool's handler** — ⚑ and D-047 a
   * give's `work_sent`, as late as the give takes — and nothing orders that write after the
   * provider-stream row announcing the call. ⛔ **Held until its call comes, and emptied by the
   * three things that mean it never will**: a `tool_result` whose call is not in view (a call before
   * the retained suffix), a sub-agent's `tool_result`, and the end of the run
   * ({@link stopOpenToolCalls}). ⚠️ **Never by an unrelated receipt** — an earlier call's result can
   * still be read after the handler wrote the row, and clearing there would lose it. ⚑ A give's
   * receipt takes the row it names ({@link settleTheGive}).
   */
  messageReceipts?: MessageJoins
  outgoingAhead: OutgoingWords[]
  /**
   * 🔴 **685 · a refusal notice waiting for its call's receipt** — see {@link NoticeItem.told}.
   *
   * ⚠️ **The host writes `tool_refused` inside the tool's handler**, so it lands before the receipt
   * and never after it. ⛔ Emptied as each receipt claims one, and by the end of the run
   * ({@link stopOpenToolCalls}): a refusal whose receipt never comes says only what it said.
   */
  /**
   * The rows this turn's errors drew so far, and its ending when it failed on a refused sign-in:
   * Codex's retry lines, the refusal, `turn failed`. Emptied at each turn a person or an agent
   * starts.
   */
  turnErrorRows: NoticeItem[]
  /**
   * The line a sign-in reopen drew, while a carrying-on turn may still come. An account change
   * keeps its message asking to send again until that turn is recorded; `name` is the provider's.
   */
  renewedLine: {
    readonly line: NoticeItem
    readonly name: string
    readonly replacedCopy?: true
  } | null
  refusalsAwaitingReceipt: {
    tool: string
    rail: string
    notice: NoticeItem
    told: RefusalTold | null
  }[]
  /**
   * How many cards are still waiting on the user, by kind (099).
   *
   * ⚠️ **Derived state, kept for exactly one reason: so a surface can ask WITHOUT walking the
   * transcript.** `sessionPanel` and `pendingKind` both answer this by scanning every item, which
   * is fine for the one conversation on screen and is not fine for the rail — it describes every
   * open conversation and re-renders whenever any of them changes, so a scan there makes the whole
   * rail re-render on every streaming delta. That cost is why the rail used to gate its scan on the
   * status column, and that gate is what made the rail's answer a SECOND derivation that could
   * differ from the pane's. This field removes the trade: the rail now feeds `needingFor` the same
   * numbers the pane does, in O(1), with no dependency on `items` at all.
   *
   * ⚠️ **Maintained by full RECOUNT, never by increments** — see {@link recountPending}. A counter
   * nudged at seven mutation sites is a counter that drifts the first time an eighth is added;
   * recomputing from `requestItems` costs nothing because it runs only when a request changes
   * state, which has happened 33 times in this app's entire recorded history.
   */
  pending: { permissions: number; questions: number }
  /**
   * ⚑ **D-017 · R19 — the cards in {@link pending} this app routed to ANOTHER conversation**
   * ({@link PermissionItem.routedTo}) — absent when none waits, as `routed` is on a card nothing
   * routed.
   *
   * ⛔ **Counted apart and never out of {@link pending}**: those counts gate the attention queue,
   * whose person's-queue answers read a live card whoever it was routed to. ⚑ A surface that says
   * whether a PERSON is owed something subtracts these — a question routed to the parent is the
   * parent's (R19) — and says the conversation is waiting on that one's answer instead. Kept by
   * {@link pending}'s own full recount, off the same items.
   */
  routedAway?: RoutedAway
  /** How full the context window is (087). See {@link ContextMeter} — never null, starts unknown. */
  meter: ContextMeter
  /** What the agent did to the working tree (096). See {@link ChangeLog} — never null, starts empty. */
  changes: ChangeLog
  /**
   * Every dynamic workflow this conversation has launched, by `task_id` (108).
   *
   * ⚠️ **The registry and the tool row hold the SAME object, not two copies.** A frame arrives with
   * a `task_id` and — on three of the four subtypes — a `tool_use_id`; the fold has to find the run
   * by the first and place it by the second. Copying would give the drawer and the transcript two
   * folds of one run, which is precisely the *"two answers to one question"* failure `session-panel`
   * exists to avoid. So this maps to the card the {@link ToolItem} also points at.
   *
   * It is keyed by `task_id` rather than by the anchor because `task_updated` — one of the two
   * endings — carries no anchor at all.
   */
  workflows: Record<string, WorkflowRunCard>
  /**
   * The last error notice this TURN drew — as it arrived, and as it was rendered (246 §1).
   *
   * ⛔ **Exactly one slot, and that is a decision rather than a shortcut.** The duplicate it exists
   * to catch is emitted back to back with what it repeats: `SessionMachine.completeTurn` says the
   * turn's terminal reason immediately after the provider's own `error` notification carried the
   * same text — measured in the same millisecond by 042, and in step 73's run at ledger ordinals 15
   * and 16 with nothing between them. A remembered SET would also swallow an error a turn genuinely
   * repeats (two failing tool calls with one message), and this fails the other way: an error in
   * between makes the ending say the cause a second time, which is a line too many rather than a
   * fact too few.
   *
   * ⚠️ **Both halves, because the two ends of the comparison are rendered differently.** A Codex
   * `auth` error is drawn as {@link AUTH_ERROR_NOTICE} while the turn's terminal message carries the
   * provider's own sentence verbatim; comparing only what was SHOWN would miss that pair, and
   * comparing only what ARRIVED would miss one whose envelope was unwrapped.
   *
   * ⛔ **Dropped when a turn OPENS**, so a cause said before a turn can never silence that turn's
   * ending — and dropped there and nowhere else. The first draft cleared it on the `turn` event too;
   * 246's mutation table returned that row GREEN, because a turn cannot begin without a `user_turn`
   * and the interval between them holds no terminal message. See `case 'turn'`.
   *
   * ⚠️ **Not carried across a window release** (`transcript-window.ts`'s `FoldCarry`), for the same
   * reason {@link TranscriptState.echoedAnswers} is not: a fold rebuilt from a suffix has not drawn
   * the cause, so it must be free to draw it. That is the direction that shows a fact rather than
   * hides one.
   */
  lastError: { raw: string; shown: string; diagnostic?: string; signInNotice?: string } | null
  /**
   * ⛔ **What is still running in the background right now** (248) — see {@link BackgroundRegistry}.
   *
   * ⚠️ **Not a `Record` keyed by id, and not merged.** Every other registry in this file accumulates;
   * this one is REPLACED wholesale by each frame that states the level, because that is what the
   * provider's own doc says a consumer must do, and because accumulating would mean pairing edges —
   * the one construction that can wedge a row on screen after its work has died.
   *
   * ⚑ **Carried across a window release**, unlike {@link TranscriptState.lastError}, and for the
   * opposite reason: a level is a statement about NOW rather than about the events in the window, so
   * a fold of a suffix that forgot it would drop a running row for work that is still going. The
   * carry cannot change what a fold of the same events would produce, because the last level event
   * wins either way.
   */
  background: BackgroundRegistry
  /**
   * ⛔ **What this conversation has promised to do LATER** (258) — see {@link ScheduleRegistry}.
   *
   * ⚑ **Carried across a window release for the reason {@link background} is**, and with a longer
   * reach: a schedule is republished only at TURN END, so a conversation that has rolled its window
   * mid-turn has thrown away the only events that would restate it and may not get another for
   * minutes. A registry rebuilt from a suffix would go quiet about a job that is still going to
   * fire, which is the exact silence this whole dispatch exists to remove.
   */
  schedule: ScheduleRegistry
  /**
   * ⛔ **What the running AGENT will answer to** (279) — see {@link CommandRegistry}.
   *
   * ⚑ **Carried across a window release for the reason {@link background} and {@link schedule} are,
   * and with the longest reach of the three**: this level is stated ONCE, at session start, and
   * again only if the provider changes its mind. A conversation long enough to roll its window would
   * otherwise forget the list for good — there is no next restatement to wait for.
   */
  commands: CommandRegistry
  /**
   * 🔴 **What tools this conversation has** (358) — see {@link ToolRegistry} for the three states.
   *
   * ⚑ **Beside `commands` rather than inside it**, though both are *"what the provider published
   * about itself"*: a command is something a PERSON types and a tool is something the MODEL calls,
   * they arrive on different frames, and Codex publishes one of them and not the other. One
   * registry would have had to carry a `null` meaning two different things.
   */
  tools: ToolRegistry
  /**
   * 🔴 **730 · R83 — the ask to stop the provider has not answered, while it stands**, or `null`.
   * ⚑ Read by the Stop control (`stopJoinsThatAsk`), which says a press joins it. ⚑ Cleared on the
   * next `turn` row and on a reopen (the host stops joining there), and on a newer ask
   * (`work_interrupted`) — which the host joins too, but nobody has waited on yet. ⚠️ A late answer
   * writes no row (`723` F-7), so between that answer and the `turn` this can outlive the ask — see
   * `lib/stop-unanswered.ts`.
   */
  stopUnanswered: StopUnanswered | null
  /**
   * 🔴 **D-001 · the requests a turn ended under while the host still held them** — by the
   * provider's request id, which survives a re-fold where an item id does not.
   *
   * ⛔ A turn's ending settles every open card on the premise that the adapter safe-rejects its
   * pending requests as it terminalises the turn. ⚠️ **Not always**: a Codex code-mode cell outlives
   * its turn with BroBot's own `give_work` card still claimed (`spawn_agent`'s when `738` P-1 measured
   * it, `sess_0d870a6d`), and a
   * Claude background agent can ask while the main turn's `result` lands. The machine keeps the
   * session on `waiting_permission` across that ending (122), so the card is still answerable —
   * and settling it froze the composer over a card with nothing to press.
   *
   * ⚑ So `case 'turn'` leaves those cards live and names them here, and `case 'status'` settles
   * whichever are still open once the status leaves `waiting_permission`: nothing holds them then.
   */
  heldPastTheirTurn: Set<string>
}
