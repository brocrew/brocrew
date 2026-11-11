import type { SessionRef } from '@brobot2/runtime'
import type { Provider, SessionStatus, TurnEnding } from '@brobot2/shared'
import type { AgentState } from './agent-state-contracts'
import type { RunningState } from './conversation-running'
import type { ReportedModel } from './model-choice-contracts'
import type { WorkThatNamesIt } from './piece-called'
import type { WaitOn } from './task-contracts'
import type { WorkerBindingReading } from './worker-reading'

export interface ConversationProviderBlock {
  readonly provider: Provider
  /** Null means the provider supplied no reset time. */
  readonly resetsAt: number | null
}

/** Previously validated evidence, with no current or admission authority. */
export interface LastKnownProviderBlock extends ConversationProviderBlock {
  readonly asOf: number
  /** Core's display deadline; older unknown-reset facts omit history until refreshed. */
  readonly displayUntil?: number
}

/**
 * A piece its holder marked as waiting on purpose (`update_work` with `on`), by its label, and
 * that status line's text: the holder's own words, at most as long as a status line may be.
 */
export interface PieceWaitingOnPurpose {
  readonly label: string
  readonly status: string
  /** What it waits on; absent for a wait from before a wait named one, which needs classifying. */
  readonly on?: WaitOn
  /**
   * For a wait on an agent: what to call the conversation holding the piece it waits on, or the
   * one its question went to.
   */
  readonly agentName?: string
}

/**
 * A recorded session that could be resumed: it has a provider ref to resume *from*.
 * The row is what 084's resume flow offers; `approvalMode` is here because it is the
 * one launch decision that cannot be re-derived, and resuming an `auto` session as
 * `ask` (or the reverse) would silently change what the agent may do.
 */
export interface ResumableSessionInfo {
  /** Stable normal-worker identity, absent when its binding is unavailable. */
  readonly worker?: WorkerBindingReading
  /** Current has an explicit value or null; unavailable does not renew a kept value. */
  readonly providerBlock?: ConversationProviderBlock | null
  readonly providerBlockStatus?: 'current' | 'unavailable'
  /** Explicit null retires history; omission is no update. */
  readonly providerBlockLastKnown?: LastKnownProviderBlock | null
  sessionId: string
  provider: Provider
  ref: SessionRef
  cwd: string
  status: SessionStatus
  /**
   * 🔴 **What this app is doing with it RIGHT NOW** (421) — see {@link RunningState}.
   *
   * Keep this beside status: ledger status describes the conversation, while the host's slot map describes its process. An idle row may be not running after a crash or unwatched when another agent owns it.
   */
  running: RunningState
  /**
   * ⚑ **D-017b · what this agent is doing, in the ONE derivation** (`agent-state.ts`, D-017 · R11) —
   * the state `list_agents` says of it, which the window's one list draws on the row. ⛔ Never
   * whether a process runs (`05` rule 5). ⚑ As of this read: every change after it arrives on
   * {@link RUNTIME_STATES_CHANNEL} (D-019).
   */
  state: AgentState
  /**
   * 🔴 **D-016 · commit 7 · R2 — the work that names it** — the header, the rail row and the ⌘K
   * palette show it where they showed the conversation's name, the agent's name beside it: a
   * conversation that owns a root is named by that root (its label, and its newest title — `null`
   * until it is titled); any other by the newest open piece it holds, with how many more it holds
   * open, else ⚑ F033 by the piece that ended last, with how it ended. `null` only when it holds
   * no piece at all. ⚑ Read by `SessionStore.workThatNames`, per row. ⚑ Those three, and the Team
   * roster, draw it with `theWorkThatNamesItSaid` — the count and the mark included; the header's
   * rename field edits the title alone.
   */
  named: WorkThatNamesIt | null
  /**
   * The newest open piece it holds, when that piece reads as waiting on purpose, with the status
   * line that marks it; absent otherwise, and for a service's.
   */
  readonly waitingOnPurpose?: PieceWaitingOnPurpose
  /** Null only for rows written before the mode was recorded — never guessed. */
  approvalMode: 'ask' | 'auto' | null
  /** Null for rows recorded before profiles could be chosen; those ran in the default one. */
  profileId: string | null
  /**
   * The reasoning effort this conversation is selected to run at (024; D-042 · R1), replayed on
   * reopen. Null where its model offers none, or for a row that has named none yet.
   */
  reasoningEffort: string | null
  /**
   * The model this conversation is selected to run (038; D-042 · R1), replayed on reopen. Null only
   * for a row that has named none yet — adopted, or from before D-042 and not started since.
   */
  model: string | null
  /** ⚑ **D-042 · R5 — what its provider last reported running**, absent until it has said. */
  reported?: ReportedModel
  /** Whether it was started in plan mode (030), replayed on reopen. Null for rows older than it. */
  planMode: boolean | null
  /**
   * When this session was imported from a provider home (087), or null if this app ran it. An
   * adopted session's messages and approvals were never ours, so the UI must not imply they were.
   */
  adoptedAt: number | null
  /**
   * Whether reopening it will show a conversation. False for an adopted session whose transcript
   * has not been imported — so the row can say that instead of the chat simply being empty (088).
   */
  hasTranscript: boolean
  /**
   * ⛔ **How its LAST turn ended** (222), or null when it never closed one.
   *
   * ⚠️ **Not a second opinion about {@link status}, and the pair is the whole feature.** `status`
   * answers *"is this conversation over"*; this answers *"did the work in it finish"*. `220` read
   * three closed conversations off this list after quitting the app mid-turn and got the same word
   * for all three, because until now only the first question had an answer here.
   *
   * ⚑ Derived from `turn.end_reason` at list time rather than stored on the row — measured, and the
   * reasoning is in `session-store.ts`'s `LAST_ENDING_COLUMN`.
   */
  lastEnding: TurnEnding | null
  /**
   * That another conversation spawned this one, and what the provider says about it (111), or null
   * for a row that is not a child — or one recorded before we knew to ask.
   *
   * ⛔ **Absent from this interface until 118, and that absence WAS the bug** (`116` §5). `111` put
   * the descent on `LibraryEntry`, so the Library could say "child of —" while this list, the one
   * with the button on it, could not tell a sub-agent from a conversation a person started.
   *
   * ⚑ The SAME shape the library row carries, from the same mapping function, so the two surfaces
   * cannot describe one conversation's parentage differently.
   */
  child: LibraryChild | null
  /**
   * Why Resume is not offered on this row, or null when it is (118).
   *
   * ⚠️ **A row carrying this is still a row, with everything else it had.** It is not the same
   * question as {@link UnresumableSessionInfo}, which is "there is nothing to resume FROM": this
   * conversation has a provider ref in a home we provision and a transcript we hold, and every
   * other control on it — export, and the read below — still works. What it has no input end for
   * is a turn. The surface owes the reader this sentence and an alternative, not a blank space.
   */
  resumeRefusal: string | null
  updatedAt: number
}

/**
 * A recorded session the reopen list must show but cannot offer, with the reason. Kept separate
 * from {@link ResumableSessionInfo} so the two can never be confused: this one has no ref, so
 * there is nothing to resume from and no Resume button to press.
 */
export interface UnresumableSessionInfo {
  /** Stable normal-worker identity, absent when its binding is unavailable. */
  readonly worker?: WorkerBindingReading
  /** Current has an explicit value or null; unavailable does not renew a kept value. */
  readonly providerBlock?: ConversationProviderBlock | null
  readonly providerBlockStatus?: 'current' | 'unavailable'
  /** Explicit null retires history; omission is no update. */
  readonly providerBlockLastKnown?: LastKnownProviderBlock | null
  sessionId: string
  provider: Provider
  cwd: string
  status: SessionStatus
  /**
   * 🔴 **What this app is doing with it right now** (421) — see {@link RunningState}.
   *
   * ⚑ **On this half too, for the reason {@link lastEnding} gives one field down**: the rail folds
   * both lists into one row shape, and a fact only the offerable half carried would let the rail
   * describe two live conversations differently because of a column neither of them is about. ⚠️ A
   * live Claude session is in THIS list for the whole of its first turn — it has no `external_ref`
   * until the provider's init arrives — so the half without the ref is not the half without the
   * running conversations.
   */
  running: RunningState
  /**
   * ⚑ **D-017b** — {@link ResumableSessionInfo.state}, on this half for {@link running}'s reason:
   * as of this read, and moved after it on {@link RUNTIME_STATES_CHANNEL} (D-019).
   */
  state: AgentState
  /**
   * ⚑ **D-016 · commit 7 · R2** — {@link ResumableSessionInfo.named}, on this half for
   * {@link running}'s reason.
   */
  named: WorkThatNamesIt | null
  /** {@link ResumableSessionInfo.waitingOnPurpose}, on this half for {@link running}'s reason. */
  readonly waitingOnPurpose?: PieceWaitingOnPurpose
  profileId: string | null
  adoptedAt: number | null
  updatedAt: number
  /**
   * Whether we hold its messages (088) — which is the difference between a row that can be opened
   * READ-ONLY and one that can do nothing at all (151, `106`).
   */
  hasTranscript: boolean
  /**
   * **Whether the sweep found this conversation in the user's OWN provider folder** (046/047) —
   * the answer, carried, rather than the rule (154).
   *
   * Conversations found in the person's own provider folder remain in the Library, but cannot be resumed through this app's owned-home reopen list. Separate what is recorded from what this launch can continue.
   *
   * ⚠️ **A field and not a predicate in the renderer, because `032` says one test.** The rule is
   * `session-store.ts`'s `foundInUserHome`, where it was measured and where its reason is written
   * down; this is that function's answer travelling to a surface that has to act on it. The two
   * facts it is computed from — `adoptedAt` and `profileId` — are on this shape too, and a
   * renderer deriving it from them would be the second implementation. There were already two
   * (`session-library.ts` had its own `fromUserHome`); this field is what makes there be one.
   */
  foundInUserHome: boolean
  /**
   * ⛔ **The OTHER "no home to reopen into" class** (214 §1) — restored from a bundle.
   *
   * On the wire for the same reason `foundInUserHome` is, and it is the same rule one member wider:
   * the store computes it and every surface that acts on it reads that answer. ⚠️ Without it the
   * rail's closed list dropped one half of the class and kept the other — which half depended on
   * what the bundle's `meta` happened to say about a profile, so one origin chip got opposite
   * treatment on one surface.
   */
  restoredFromBundle: boolean
  /**
   * How its last turn ended, or null (222) — see {@link ResumableSessionInfo.lastEnding}.
   *
   * ⚑ **On this half too, because the rail folds both lists into one row shape** (151). A field only
   * the offerable half carried would make the rail's own list describe two rows differently for a
   * reason that has nothing to do with how either of them ended.
   */
  lastEnding: TurnEnding | null
  reason: string
}

/**
 * What a library row can say about its parentage (111).
 *
 * Provider records can establish a child while omitting parent, depth or other descent fields. Represent missing values honestly rather than inventing a parent.
 */
export interface LibraryChild {
  parentSessionId: string | null
  depth: number | null
  nickname: string | null
  role: string | null
}
