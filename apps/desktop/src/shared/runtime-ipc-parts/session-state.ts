import type { AgentState } from '../agent-state-contracts'
import type { MailboxKind, PersistedEventInfo, TranscriptEvent } from '../conversation-events'
import type {
  ConversationProviderBlock,
  LastKnownProviderBlock,
} from '../conversation-listing-contracts'
import type { PublicationEpoch } from '../data-version'
import type { UserTurnEvent } from '../human-answer-contracts'
import type { SessionSettingsDisclosure } from '../model-choice-contracts'
import type { WorkAncestry } from '../work-ancestry'
import type { WorkFolderGrant } from '../work-folders'
import type { KeptFile } from './resources'

export interface ProviderLimitHoldReason extends ConversationProviderBlock {
  readonly is: 'provider-limit'
}

/** ⚑ **D-019** — one conversation on {@link RUNTIME_STATES_CHANNEL}. */
export interface AgentStateMoved {
  /** Current has an explicit value or null; unavailable does not renew a kept value. */
  readonly providerBlock?: ConversationProviderBlock | null
  readonly providerBlockStatus?: 'current' | 'unavailable'
  /** Explicit null retires history; omission is no update. */
  readonly providerBlockLastKnown?: LastKnownProviderBlock | null
  readonly conversation: string
  /** What `get_agent_status` would say of it at the moment it was sent. */
  readonly state: AgentState
}

/**
 * ⚑ **D-019 · D-026 · the whole payload** on {@link RUNTIME_STATES_CHANNEL}: what moved since the
 * last message — either list may be empty, never both.
 */
export interface RuntimeStatesMessage {
  /** The conversations whose one state moved, each with the state it is in now. */
  readonly moved: readonly AgentStateMoved[]
  /** ⚑ **D-026 · the files kept since**, each once its row was down — {@link FilesKept}'s row. */
  readonly kept: readonly KeptFile[]
  /** The publication it was sent at: newer than every answer composed before it. */
  readonly published?: { readonly epoch: PublicationEpoch; readonly seq: number }
}

/**
 * 🔴 **D-018 · the memory each running conversation's provider process holds** — its resident size
 * in bytes, read off the process this app started for it, for a person's card. ⛔ A person's alone:
 * on the window wire and on no toolset, and in no word an agent reads (`05` rule 5). ⚑ A
 * conversation this app is not running, or whose provider holds no pid, is absent: its card says
 * nothing.
 */
export interface ProcessMemory {
  readonly conversations: readonly { readonly conversation: string; readonly bytes: number }[]
  /**
   * Why no figure could be read at all, in a sentence a person reads: this system cannot list its
   * processes, or the listing failed just now. Then `conversations` is empty, and that says nothing
   * about what runs. Absent when the processes were read: a conversation not listed holds none.
   */
  readonly unmeasured?: string
}

/**
 * What the provider process looks like from here, derived from signals we already
 * have rather than from its pid — a process that is alive can still be wedged or
 * silent, so only a behavioural answer says whether it is usable. ⚑ Both adapters hold
 * the pid of the child this app started (`SessionHandle.providerPid`), and the memory
 * a person's card shows ({@link ProcessMemory}) is read off it.
 */
export type LivenessState =
  /** Active: the session is usable and events are flowing (or it is idle, or waiting on you). */
  | 'live'
  /** Working, but nothing has arrived for the stall window — busy, rate-limited, or stuck. */
  | 'silent'
  /** The session closed cleanly. */
  | 'ended'
  /** A fatal error, or the provider child died. */
  | 'errored'

export interface SessionLiveness {
  /** Current has an explicit value or null; unavailable does not renew a kept value. */
  readonly providerBlock?: ConversationProviderBlock | null
  readonly providerBlockStatus?: 'current' | 'unavailable'
  /** Explicit null retires history; omission is no update. */
  readonly providerBlockLastKnown?: LastKnownProviderBlock | null
  state: LivenessState
  /**
   * Epoch ms this state has been true since — for `silent`, when the provider
   * actually went quiet, not when we concluded it had. A duration would be stale by
   * the time it rendered, so the elapsed time is ticked off this in the renderer.
   */
  since: number
  /** One line of why, when there is something worth saying. */
  detail?: string
  /**
   * Beside `silent` only: the silence followed the model's reasoning, so a surface says how long it
   * has been thinking, counted from {@link since}.
   */
  thinking?: true
  /**
   * What the provider says it is running (081) — pre-formatted by the host, like the PID line.
   * Absent until the provider reports; each entry is `{ label, value }` so the panel renders rows
   * without knowing what any of them mean.
   */
  agent?: { label: string; value: string }[]
  /**
   * What this session prompts for, right now (034). On the liveness channel for the same reason as
   * the PID and the agent rows: it is live session state that changes without anyone issuing a
   * command. The mode moves when a TURN adopts a queued change — inside the handle, in the main
   * process — so a renderer that only learned it from command results would show a pending change
   * that never appeared to land.
   *
   * Absent on a message published before the session was described.
   */
  approval?: ApprovalModeDisclosure
  /**
   * Whether a plan is waiting for the go-ahead (060). On this channel for the same reason the
   * approval disclosure is: it changes inside the main process — the moment the go-ahead command
   * lands — and a renderer that only learned it from a command result would leave a second window
   * offering a button that has already been pressed.
   *
   * Absent on a message published before the session was described.
   */
  plan?: PlanGoAheadDisclosure
  /**
   * The model, effort and plan mode this session is running with (076). On this channel for exactly
   * the reason the approval disclosure is: a queued change is adopted by a TURN, inside the handle,
   * in the main process — so a renderer that only learned these from command results would show a
   * "from your next message" promise that never visibly landed.
   *
   * Absent on a message published before the session was described.
   */
  settings?: SessionSettingsDisclosure
  /**
   * The messages waiting for the running turn to end (077), in the order they will go (394).
   *
   * ⚠️ **`[]` rather than absent, and the difference is load-bearing.** Every other disclosure
   * here is optional because it is *unknown* until the session has been described; this one has a
   * true value — "nothing is queued" — that must be publishable, because that is exactly the state
   * a flush transitions INTO. Left optional, the message that says the queue has emptied would be
   * indistinguishable from a message published before anyone knew, and the surface would keep
   * offering to cancel a message that had already gone.
   *
   * ⛔ **A LIST since `394`, and the order is the delivery order.** It held one message until a
   * routed question needed a slot beside the work — see {@link MAILBOX_KINDS}. ⚑ The empty array
   * is what `null` used to be; `undefined` still means *no news*, which is what a liveness message
   * published before the session was described carries.
   */
  queued?: readonly QueuedMessageDisclosure[]
  /**
   * The machine sign-in this conversation was launched with has been replaced (147).
   *
   * On this channel because it becomes true inside the main process, at a turn boundary, without
   * anyone issuing a command — the same reason every disclosure above it is here. And it is a
   * LATCH: once true it stays true for the life of this child, because nothing a running session can
   * do reaches a credential it was not launched with. The way out is a new child, which is what the
   * Reopen button asks for.
   *
   * Absent on a message published before the session was described, exactly like its neighbours.
   */
  signInSuperseded?: boolean
  /**
   * ⛔ **This session's adapter can stop ONE piece of background work** (248).
   *
   * ⚠️ **ABSENT rather than `false` where the adapter has nothing to say**, which is the shape `150`
   * and `148` L3 made the rule here: `=== true` turned every adapter's silence into a positive
   * claim. Absent covers three real states that all mean the same thing to a button — the adapter
   * implements no stop (Codex today), the session is a recording with no handle at all, or this
   * message was published before the session was described.
   *
   * ⚠️ **"Codex today" was true when this was written in 248 and stopped being true in 275**, which
   * wired `thread/backgroundTerminals/terminate` — corrected in place rather than deleted, on 142's
   * rule, because the sentence is still exactly right about the SHAPE and only wrong about which
   * adapter is the example. The remaining one is the Fake, whose own doc calls it a declared gap.
   *
   * ⛔ **Why liveness and not `ProviderCapabilities`.** That map is per-PROVIDER and is fetched by
   * the launcher, which has no session; this is a property of the handle behind one conversation,
   * and `106`'s rule is that a control which cannot act must not be offered. A per-provider answer
   * would still be offering the button on a read-only transcript of a Claude session, where nothing
   * is behind it.
   */
  canStopBackgroundWork?: boolean
  /**
   * Whether this adapter holds output for a running command; gate command-tail reads on this capability.
   *
   * ⚠️ **Absent-not-false, on the rule the field above states**, and it covers the same three states:
   * the adapter streams nothing (Claude, measured — see `claude/capabilities.ts`), the session is a
   * recording with no handle, or this message predates the description.
   *
   * ⚑ **It pairs with the `commandOutput` CAPABILITY rather than duplicating it, and the division is
   * the one `canStopBackgroundWork` draws one field up.** This says whether to ASK; that says what to
   * SAY when the answer is that this provider never streams it. A card that only had this flag would
   * go silent on Claude, which is `039`'s undisclosed asymmetry; one that only had the capability
   * would ask a read-only transcript for a tail nothing is holding.
   */
  canReadCommandOutput?: boolean
  /**
   * ⛔ **Whether this session's adapter is HOLDING what its tools answered** (462) — the gate on
   * whether a row offers to show the whole answer at all.
   *
   * ⚠️ **Absent-not-false, on the rule two fields up**, and the state it covers that matters most
   * here is the second one: **a conversation replayed from the ledger has no handle, and nothing is
   * held for any of its rows.** ⛔ That is the hole `462` §2.2 is about — the answers are memory, not
   * a record — and this flag is what lets the row say so from what it already knows instead of
   * making a person press a door onto nothing.
   *
   * ⚑ **Unlike `canReadCommandOutput` there is NO capability beside it, and that is a fact rather
   * than an omission.** That pair exists because one provider streams a command's output and the
   * other does not, so a card has to say *why* it will never have a tail. Both adapters hold tool
   * answers; the only difference between them is WHICH receipts they hold, which is a property of
   * the call rather than of the provider, and the panel reports it from what it actually got.
   */
  canReadToolAnswer?: boolean
  /**
   * 🔴 **W4.189 · the folders this conversation may also work in, beyond its working folder** — one
   * per open piece that granted one ({@link WorkFolderGrant}): `queued` until the turn carrying its
   * brief starts, `applied` after. ⚑ Absent when it holds none; a grant that ended is gone from
   * here, and its piece's ending says when.
   */
  workFolders?: readonly WorkFolderGrant[]
}

/**
 * Whether this conversation is still proposing rather than doing, and whether ending that is a
 * gesture this app can make (060).
 *
 * ⚠️ **One field, and it is narrower than "is this session in plan mode".** It answers only the
 * question a UI needs before offering a button, so `false` covers three different situations —
 * never planned, already released, and *"planning, but the exit belongs to the provider's own
 * approval card"* — and nothing may read it as "not planning". See `SessionHandle.planNeedsGoAhead`,
 * which it is copied from; the host never keeps a second opinion about it.
 *
 * A separate interface from {@link ApprovalModeDisclosure} on purpose. It would have plumbed in one
 * fewer place folded in there, and it is a different fact: that one is what the session ASKS you
 * about, this one is what it is waiting for you to say. One object meaning two things is how the
 * pending-mode confusion started.
 */
export interface PlanGoAheadDisclosure {
  planNeedsGoAhead: boolean
}

/** One liveness change, addressed to a session. */
export interface SessionLivenessMessage {
  sessionId: string
  liveness: SessionLiveness
}

/**
 * What a session prompts for, as the UI is told it (034).
 *
 * `approvalMode` was a single field fixed at creation (078). It is still the field everything reads
 * — it is what the session is ACTUALLY running under — but it is no longer the whole story, because
 * a change the user has made does not take effect until the next turn. That gap is a state, not a
 * transient, and the UI has to be able to say so: it can last as long as a turn does.
 */
export interface ApprovalModeDisclosure {
  /**
   * The mode the session is running under NOW — echoed back from the host, not from what anyone
   * asked for, so the UI discloses what IS rather than what was requested.
   */
  approvalMode: 'ask' | 'auto'
  /**
   * The mode it will run under from its next turn, or `null` when nothing is pending. Never equal
   * to {@link approvalMode}: "pending" that means "the same" is not pending.
   */
  pendingApprovalMode: 'ask' | 'auto' | null
  /**
   * The disclosure line, worded by the host (078; always present since 082) — including the
   * Codex-only "sandbox OFF", and the pending change when there is one. Composed host-side for the
   * same reason as the PID line (076): what a mode MEANS for a given provider is host knowledge,
   * and a header that branched on the provider to phrase it would break the renderer's
   * provider-agnosticism.
   */
  approvalNote: string
  /**
   * Tools this session has been told to stop asking about entirely (058) — the
   * `allow_all_for_session` grants, by name, in the order they were made.
   *
   * ⚠️ **It rides here because a grant is part of "what this session prompts for", and because it
   * outlives the card that made it.** 031's rule is that a user must be able to see what they
   * granted; a card scrolls away, so a grant with no other home becomes something you would have
   * to remember clicking. It is a separate field rather than more words in {@link approvalNote}
   * because it is a different fact — the mode is what the session does by default, this is the
   * exception list — and one string meaning two things is how the pending-mode confusion started.
   *
   * Empty is the normal state, and also the honest answer for an adapter whose session grants live
   * inside the provider rather than in this process. See `SessionHandle.blanketGrants`.
   */
  blanketGrants: string[]
}

/**
 * The message waiting to be sent when the running turn ends (077), or `null` when there is none.
 *
 * ⚠️ **On the liveness channel because the queue EMPTIES without anyone issuing a command.** The
 * flush happens in the main process the moment a turn goes idle, so a renderer that only learned
 * about the queue from its own command results would keep showing a message as waiting after it had
 * been sent — and a second window would never have known it was there at all. Same reasoning as the
 * approval and settings disclosures, and the same failure if it is left off.
 */
export interface QueuedMessageDisclosure {
  /** An additional provider hold on these words; a person's own words are exempt. */
  readonly holdReason?: ProviderLimitHoldReason | null
  readonly holdReasonStatus?: 'current' | 'unavailable'
  /**
   * 🔴 **Which kind of thing this is waiting to be** (394) — see {@link MAILBOX_KINDS}.
   *
   * ⛔ **On the disclosure because the two are held under different rules**, and a surface offering
   * to cancel one must be able to say which it is offering back. ⚠️ **Required here and optional on
   * the event**, exactly as {@link id} is and for its reason: this describes what a session is
   * holding right now, and nothing has been held without a kind since this dispatch.
   */
  kind: MailboxKind
  /**
   * 🔴 **The held message's own name** (354) — `msg_<uuid>`, minted where the message was accepted.
   *
   * ⛔ **REQUIRED here, and optional on the two events, and the difference is not an oversight.**
   * This disclosure describes what a session is holding RIGHT NOW, and nothing has been held
   * without a name since `354`; the events are a durable ledger that also contains every message
   * queued before this dispatch existed. See {@link QueuedMessageEvent.messageId}.
   *
   * ⚑ **This is the name a cancel names** — `cancelQueuedMessage` takes it and refuses any other id.
   * ⚑ **700 · the press takes it off the pressed ROW**, whose `QueuedItem.messageId` is this same
   * name folded from the ledger's `message_queued` (`688`), not off this disclosure — so a stale row
   * takes back nothing rather than taking back the wrong message.
   */
  id: string
  /** What is waiting, verbatim — so the surface can show it and offer it back. */
  text: string
  /** Epoch ms it was queued, for "waiting since"; the renderer ticks the elapsed time off this. */
  since: number
  /**
   * 🔴 **Whose words are waiting** (687, R22) — {@link QueuedMessageEvent.attribution}, on the
   * surface that offers the cancel.
   *
   * ⛔ **The pane reads THIS and not the ledger** — whether the held `/compact` is the person's own
   * (`ConversationPane`'s `compactionIsWaiting`): a held plan go-ahead is `kind: 'work'` like the
   * person's own message, and matching {@link id} against the transcript's held row fails once that
   * row has been paged out (`054`) during a long turn. ⚑ **D-010** — the composer no longer reads it
   * to refuse a second message: several may wait, whoever wrote them.
   *
   * ⚑ **700 · `688` H1 — the *Cancel it* is not driven by this list at all.** It is drawn on the
   * held ROW, and it names that row's own message ({@link CancelQueuedMessageInput.messageId}, taken
   * off `QueuedItem.messageId`), so a take-back takes back the message that was pressed and never
   * whichever one waits first.
   *
   * ⚠️ **Absent on a message the person wrote**, and present on every app-authored one.
   */
  attribution?: UserTurnEvent['attribution']
}

/**
 * One event, addressed to a session. `ordinal` is the host's per-session sequence
 * number: it makes ordering checkable end-to-end and gives the renderer a stable
 * key without inventing one.
 */
export interface RuntimeEventMessage {
  errorFacts?: import('../error-facts').ErrorFacts
  /** Current core state, or explicitly pending until the existing state flush. Absent on history. */
  agentState?: AgentState | null
  published?: RuntimeStatesMessage['published']
  ancestryContext?: readonly PersistedEventInfo[]
  /** Updated by core when a provider work relationship changes. */
  workAncestry?: WorkAncestry
  /** History reads supply canonical per-turn context, including for pages cut mid-turn. */
  humanFinal?: import('../human-answer-contracts').HumanFinalContext | null
  sessionId: string
  ordinal: number
  /**
   * When this happened, epoch ms.
   *
   * On the ENVELOPE, beside `ordinal`, and deliberately not on `RuntimeEvent`: the time is ours,
   * not the provider's — the host stamps it as it records the event, and the same value goes to
   * the ledger's `created_at`, so the wire and the database can never disagree about when
   * something happened. `RuntimeEvent` stays the provider-neutral thing the GO-locked runtime
   * defines, with no notion of a clock in it.
   *
   * Replayed events carry their ORIGINAL recorded time rather than the moment of the replay, and
   * an imported conversation carries the provider's own timestamps (Slice 2 · 001).
   */
  at: number
  event: TranscriptEvent
}
