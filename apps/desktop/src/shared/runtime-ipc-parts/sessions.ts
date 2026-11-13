import type { AgentIdentity } from '../agent-identity-contracts'
import type { HandedPath } from '../attachment-contracts'
import type { PersistedEventInfo } from '../conversation-events'
import type {
  ConversationProviderBlock,
  LastKnownProviderBlock,
} from '../conversation-listing-contracts'
import type { RunningState } from '../conversation-running'
import type { SessionInstructions } from '../instruction-contracts'
import type { AgentModelChoice, SessionSettingsDisclosure } from '../model-choice-contracts'
import type { FirstMessageRefusal, LaunchRefusal } from './launch-vocabulary'
import type { ConversationAtWork } from '../what-is-being-done'
import type { WorkAncestry } from '../work-ancestry'
import type { ProviderConfigInfo } from './providers'
import type {
  PermissionDecision,
  ReasoningEffort,
  SessionRef,
  UserInputResponse,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import type {
  SessionLiveness,
  PlanGoAheadDisclosure,
  ApprovalModeDisclosure,
  QueuedMessageDisclosure,
} from './session-state'
export type {
  ProviderLimitHoldReason,
  AgentStateMoved,
  RuntimeStatesMessage,
  ProcessMemory,
  LivenessState,
  SessionLiveness,
  PlanGoAheadDisclosure,
  SessionLivenessMessage,
  ApprovalModeDisclosure,
  QueuedMessageDisclosure,
  RuntimeEventMessage,
} from './session-state'

/** A session the host created and is now pumping events for. */
export interface CreatedSession {
  /** Current has an explicit value or null; unavailable does not renew a kept value. */
  readonly providerBlock?: ConversationProviderBlock | null
  readonly providerBlockStatus?: 'current' | 'unavailable'
  /** Explicit null retires history; omission is no update. */
  readonly providerBlockLastKnown?: LastKnownProviderBlock | null
  /** Host-owned id. Not the provider ref: Claude's ref is null until its first turn's init. */
  sessionId: string
  provider: Provider
  /** The working directory the session actually runs in (the BroBot workspace by default). */
  cwd: string
  /** The app-owned per-profile provider home this session was launched in. */
  providerHome: string
  /** The profile that home belongs to — resolved by the host, not echoed from the request. */
  profileId: string
  /** The provider ref if it already exists (Codex: immediately; Claude: null until its first turn). */
  ref: SessionRef | null
  /** What is actually in the provider home, read when the session was created. */
  config: ProviderConfigInfo
  /**
   * **The instruction text this session was launched with** (158) — ours and the provider's.
   *
   * ⚠️ **A launch fact, and it does not change while the session runs.** The files are re-read on
   * every start and every resume (a profile is an identity the user edits, not a snapshot), so
   * editing one mid-conversation takes effect at the NEXT launch and not before. The UI says so;
   * nothing here should be refreshed in place, because refreshing it would show today's file beside
   * a conversation the model is having with yesterday's.
   */
  instructions: SessionInstructions
  /** How this session handles consequential actions right now, and what it will do next (034). */
  approvalMode: ApprovalModeDisclosure['approvalMode']
  pendingApprovalMode: ApprovalModeDisclosure['pendingApprovalMode']
  approvalNote: ApprovalModeDisclosure['approvalNote']
  /**
   * The tools it has been told to stop asking about entirely (058). Always empty on a session that
   * has just been created or resumed — a grant is made by answering a card, so there has been no
   * chance to make one — and kept current from the liveness channel after that.
   */
  blanketGrants: ApprovalModeDisclosure['blanketGrants']
  /**
   * Whether this conversation opens waiting for a go-ahead (060). True from the first frame for a
   * session launched in plan mode on a provider whose exit is ours — the plan has not arrived yet,
   * but the state that makes the bar meaningful has, and a bar that appeared only once a document
   * landed would leave the first turn looking like an ordinary one.
   */
  planNeedsGoAhead: PlanGoAheadDisclosure['planNeedsGoAhead']
  /**
   * The model, effort and plan mode this session is RUNNING with, and what it will run with next
   * (076) — kept current from the liveness channel after creation.
   *
   * ⚠️ **Its own key, not spread onto this object, and `settings.model` is not the same fact as a
   * model named at creation.** One is what a conversation was started with; the other is what it is
   * running now, which a user can have changed three times since. Flattening them would leave one
   * silently overwriting the other, and the header shows both.
   */
  settings: SessionSettingsDisclosure
  /**
   * The messages waiting for the running turn to end (077), in the order they will go (394). Always
   * empty on a session that has just been created or resumed — queueing needs a running turn and a
   * user, and neither has happened yet — and kept current from the liveness channel after that,
   * exactly like {@link blanketGrants}.
   */
  queued: readonly QueuedMessageDisclosure[]
  /** How the provider looks right now; updated over {@link RUNTIME_LIVENESS_CHANNEL}. */
  liveness: SessionLiveness
  /**
   * 🔴 **Whether somebody other than whoever is watching may give this conversation work**
   * (349, HO-006 §4.5).
   *
   * ⛔ **A surface implying a state that is not true is criterion 9, and this was one.** A session
   * can be SPAWNED by an agent and then taken over by a person — that is what the claim door is
   * for — and the agent that spawned it keeps the right to send into it for the whole life of the
   * conversation, before the claim, during it, and after the claiming window has gone. ⚡ **So a
   * person could be handed a turn they did not start, on a screen that said nothing about anybody
   * else being able to start one.**
   *
   * ⚠️ **A fact, not an identity, and 085's rule is why.** The commander is an `ownerId` —
   * `agent:sess_…` or `webContents:3` — and nothing on a screen may carry one. There is no
   * spawn-tree UI to resolve it into a name (the PO deferred one), so the honest disclosure is the
   * one thing a person can act on: somebody else can send here. The host-side id is on
   * `UnclaimedSession.commandedBy`, which no screen reads.
   *
   * ⛔ **True of a session that is COMMANDED, whoever the commander is.** It does not say *"an
   * agent"*, because `commandedBy` is an `ownerId` and a window's identity can be named as one
   * (340's own acceptance does exactly that); calling every commander an agent would be a second
   * claim this field cannot support.
   *
   * ⚠️ **A launch fact.** `commandedBy` is `readonly` on the slot and fixed at reservation, so this
   * cannot change while the session runs and the liveness channel deliberately does not carry it.
   * 🔴 **True again after a restart, for a conversation another one asked for** (373). Nothing is
   * persisted and nothing is remembered: a resume RE-DERIVES the commander from the provenance row
   * `341` writes, so a reopened child of a spawn discloses that somebody else can send here — which
   * is true of it, and was true of it before the app closed. ⚠️ **A commander that was not the
   * parent is named by nothing durable**, so that case still comes back `false`.
   */
  hasACommander: boolean
  /**
   * 🔴 **Was this conversation born without a window — as far as this app can say for the life
   * being handed over?** (523 — `519` item 3, item 1 of three.)
   *
   * ⛔ **The ORIGIN, and it is the only certain answer to it this app holds.** It is
   * `SessionSlot.bornWithoutASurface`, fixed at reservation and never written again — so a claim
   * does not move it and neither does a release. ⚠️ **{@link hasACommander} is
   * the field that looks like this one and is not it**: that is derived from `commandedBy`, its own
   * contract refuses to call a commander an agent, and it comes back `false` after a restart for a
   * commander that was not the parent. A conversation can be agent-born and arrive with
   * `hasACommander: false`.
   *
   * ⚑ **What it is FOR is the pair of acts a person cannot otherwise tell apart** (`519` F2). For a
   * conversation born without a window, closing the window RELEASES it and it keeps running; for one
   * born with a window, closing the window ENDS it. ⛔ Until `523` that difference reached no screen
   * at all — `bornWithoutASurface` had eleven references and not one of them was in `renderer/` or
   * `shared/`.
   *
   * ⚠️ **It does NOT say *an agent started this*.** `give_work` passes no sink, so every conversation
   * a give started is one of these — but so is anything else this app ever creates with a `null` sink,
   * and naming a cause the field does not carry is the mistake {@link hasACommander} already records.
   *
   * ⛔ **A reopen is a fresh reservation, and it answers from TWO facts since `661`** (`656` F2):
   * no surface asked for this life (a `null` sink, `652`), OR an agent asked for the conversation
   * (the row names a parent, whoever reopened it). ⚑ So an agent's child a WINDOW reopens answers `true`
   * — its window's departure releases it, exactly as a claimer's does — where from `523` to `661` it
   * answered `false` and that departure ENDED a conversation its parent still commands. ⚠️ **A
   * conversation a person created answers `false` when a window reopens it** and `true` when it is
   * reopened with no window; both are the pair of acts above, stated for this life.
   */
  startedWithoutAWindow: boolean
  /**
   * 🔴 **May the caller being handed this conversation give it back?** (523 — `519` item 3, item 2.)
   *
   * ⛔ **Told, never re-derived.** It is `RuntimeHost.mayHandBack` — *this caller owns it* AND
   * *it was {@link startedWithoutAWindow}* — answered by the host at the instant of the hand-over.
   * ⚠️ A renderer that recomputed it from the field above would be `169` §1's rule broken on a
   * refusal: two spellings of one question, and the surface's copy drifting from the door's.
   *
   * ⚑ **Not the same fact as {@link startedWithoutAWindow}, and the gap is why both are here.** The
   * origin is frozen at the reservation, for the whole of this life; this is a right that begins at
   * a claim — or, since `661`, at a window's REOPEN of a conversation an agent asked for — ends at
   * a release, and is false for the window that merely reads about it. ⛔ It is
   * `false` for a conversation handed to a caller that presented no surface: there is no window to
   * hand anything back from, which is `mayHandBack` refusing `THE_APP_ITSELF` said in data.
   */
  mayHandItBack: boolean
  /**
   * ⚑ **D-017b · why a message from this window cannot continue this conversation, or absent when
   * one can** — set only on a `recorded` hand-over ({@link SessionHandover}): the row's own refusal
   * (a conversation this app cannot start again), as a whole sentence, or that another window has it
   * open. ⚑ The composer draws it in place of the box.
   */
  cannotTakeAMessage?: string | null
  /**
   * ⚑ **D-017b · a setting changed from this view would not reach the conversation** — set only on a
   * `recorded` hand-over: a window holds it or it is on its way somewhere (the setting is that
   * window's), no message continues it, or its next message starts a new conversation in its place
   * (R10). ⚑ The settings controls are then statements. ⛔ The host refuses the same rows
   * (`RuntimeHost.aSettingForItsNextStart`), off the same predicate.
   */
  settingsFixed?: boolean
  /**
   * ⚑ **D-017b · this app ran it as NOBODY** — the sweep found it in a person's own provider folder
   * (`user-home`), or it was restored from a bundle another machine ran (`bundle`) — so
   * {@link profileId} names no identity of ours, and no surface names it by one (154: calling it
   * BroBot would invent one). Set only on a `recorded` hand-over; absent for every conversation this
   * app ran as an agent.
   */
  ranAsNobody?: 'user-home' | 'bundle'
}

/**
 * 🔴 **716 · a start main refused, as an answer** — only to a `createSession` that asked for one
 * (`answerARefusal: true`, which is opt-in: every caller that does not ask keeps the rejection it
 * handles today). `said` is the sentence a rejection would have carried, byte for byte; `reason` is
 * {@link LAUNCH_REFUSALS}'s word. ⚑ Only a refusal with a word is answered; anything else still
 * rejects. ⚑ **The window asks since `725`** (`session-store.ts` `create`, both doors): the sentence
 * is drawn where it always was, and the launcher reads the word to skip its sign-in check where
 * the table's third column says it has nothing to add (`NewConversation.vue` `theCheckCanSayMore`).
 */
export interface RefusedLaunch {
  readonly refused: {
    readonly reason: LaunchRefusal
    readonly said: string
  }
}

/**
 * 🔴 **682 · what `setAgentProvider` answers: the identity as it now stands, and the model choice
 * the same act CLEARED** (PM ruling `R31b`: *"`setAgentProvider` moving an identity to another
 * provider clears its choice in the same act, and its answer says so"*).
 *
 * ⚑ **`modelChoiceCleared` is the choice as it stood before**, so a surface can say what was taken
 * back; `null` when nothing was cleared. ⛔ **An intersection and not a wrapper**, so every surface
 * that already reads this answer as an {@link AgentIdentity} keeps reading it unchanged.
 */
export type AgentProviderSet = AgentIdentity & {
  readonly modelChoiceCleared: AgentModelChoice | null
}

/**
 * One page of a conversation, with what it takes to ask for the page before it (054).
 *
 * A cursor rather than a page NUMBER, because the ledger grows underneath the reader: an offset
 * counted from the end means something different every time a live event lands, and paging by one
 * would silently skip or repeat entries. `from` is an ordinal, which is stable for the life of the
 * row while the app runs; a migration that removes rows may renumber them before any window opens.
 */
export interface HistoryWindow {
  /** Core-owned relationships and the indexed ancestor rows needed outside this page. */
  workAncestry?: WorkAncestry
  /** Latest observed human turn, even when it precedes this bounded page. */
  humanAnswers?: import('../human-answer-contracts').HumanAnswers
  /** The ledger slice, in order. Empty is a state the UI renders, not an error. */
  entries: PersistedEventInfo[]
  /** The ordinal this page begins at — the next request's `before`. */
  from: number
  /** Whether anything precedes `from`. Read from the store, never inferred from `entries.length`. */
  hasOlder: boolean
  /**
   * Whether this page begins at a turn boundary. False means the event ceiling cut it partway
   * through a turn, and the top of the view is mid-thought rather than at a prompt.
   */
  turnAligned: boolean
  /**
   * 🔴 **D-035 · the tool inventory in force where this page begins** — the conversation's newest
   * `tool_inventory` row below {@link from}, which the window folds ahead of the page.
   *
   * ⚑ **Why.** A give, a reply, a question and a request taken on are drawn as cards only for the
   * tool names the conversation was handed, read as each call is folded — and a provider states
   * them once per start. A page that begins after that row drew every one of its calls as a plain
   * tool line: a conversation reopened from its history, a window that took a running one back, and
   * a page scrolled back to past a release. ⚠️ Absent when nothing precedes the page, or no
   * inventory does.
   */
  toolsInForce?: PersistedEventInfo
}

/**
 * A reopened session: everything a fresh one carries, plus what it said before. The
 * history rides on the resume result rather than arriving in a second call, so there
 * is no window where live events could reach the renderer before the past does.
 *
 * **A WINDOW since 054, not the whole ledger.** It carried every event a session had ever recorded,
 * which is what made reopening a long conversation the most expensive thing this app does. The rest
 * is still there and is fetched by scrolling — see {@link RuntimeBridge.earlierHistory}.
 */
export interface ResumedSession extends CreatedSession {
  history: HistoryWindow
  /**
   * **Which of the two things the host did** (100) — and the renderer must act on it.
   *
   * `resumed` is a RECORDING reopened: a new provider, on a conversation that had stopped. Its
   * replayed history describes a previous life, so the renderer applies `markReopened` — settling
   * the pending cards, clearing the activity, stopping the sub-agents and closing the tool calls —
   * on the stated ground that *"the only true one on reopen is that nothing is running"*.
   *
   * `attached` is the SAME session handed back to a surface that lost sight of it. It never
   * stopped. Every one of those corrections would be a lie about a conversation that is running
   * right now: a permission card the agent is waiting on would be settled and unanswerable, and a
   * tool that is still running would be drawn as finished.
   *
   * ⚠️ **Found in review, and it is the whole reason this field exists.** The first version of 100
   * had `attachOpen` avoid those corrections and left `resume` — the Reopen button itself, the one
   * gesture the dispatch is about — applying them to an attached session unconditionally. The
   * renderer cannot tell the two apart by looking, so the host says which.
   *
   * 🔴 **653 · "it never stopped" is true of the PROVIDER and not always of the WINDOW.** An
   * attached conversation's provider has been running the whole time — but that provider may have
   * been started by an earlier REOPEN, and then the history window handed over reaches back into the
   * life before it: a window that reopened a conversation and whose store was then rebuilt without
   * a navigation (Vite's HMR — a real reload CLOSES what the window started), or a conversation
   * woken with no window at all (`652`) and then claimed. ⛔ The corrections above are still wrong for
   * the life that is running; they are RIGHT for the life before it. ⚑ So `attached` keeps its
   * meaning, and the seam between the two lives travels on its own field — {@link liveFrom}.
   */
  handover: SessionHandover
  /**
   * 🔴 **The ordinal the conversation's CURRENT life began at, when this window may hold an earlier
   * one** (653) — present only on an `attached` hand-over whose running life was itself a reopen.
   *
   * ⛔ **What it fixes, measured on a real host with a provider that behaves like Claude on a
   * resume** (silent until its first turn's `system/init`): a person who took over a conversation
   * that had been woken with no window was drawn one that had ENDED, because the window ends the
   * previous life with `session: ended` and nothing of the new life had spoken yet. ⚠️ **And the
   * same for a window whose store is rebuilt without a navigation** (HMR) after it pressed Reopen
   * and before the first turn — reachable without anything `652` added. ⛔ Not ⌘R: `did-navigate`
   * closes the conversations a window started, so there is nothing left to hand back.
   *
   * ⚑ **The renderer applies the reopen correction AT this ordinal, not at the end of the page**:
   * what the previous life left open is settled, and a card THIS life has raised since is not —
   * which is exactly the difference between this and sending `resumed`. It is the renderer's own
   * `SessionRecord.liveFrom`, told rather than guessed, and every later re-fold crosses it too.
   *
   * ⚑ **D-017b · and on a `recorded` hand-over of a conversation nothing runs**: the ordinal after
   * the page, where the life the page records stopped — so what that life left open (a turn a crash
   * cut off, a card its provider held) is settled there, as a reopen settles it.
   *
   * ⚠️ **ABSENT — not `null` — for everything else**, on purpose: a spawned or created
   * conversation's hand-over is byte-for-byte what it was before this field existed. ⛔ **And absent
   * on `resumed`**: that window is read before the provider is asked, so the whole page is the
   * previous life and the epoch is where it ends — the renderer already takes it from there, and
   * a second answer to the same question is the thing not to add.
   */
  readonly liveFrom?: number
  /**
   * 🔴 **What the host knew of the running conversation as of the last row of {@link history}** —
   * on an `attached` hand-over only: its status, and the activity it was last told
   * (`BeingDoneTracker`, which moves with each row its provider sends).
   *
   * ⚑ **Why.** The page can begin after the `status` that opened the running turn: inside a long
   * turn, or at that turn's own `user_turn`, which a page may begin at and which comes just after
   * it. The row that set the activity can be older than the page too. Folded on its own, such a page
   * reads `idle` while the turn runs, so the window takes the status from here once the page is
   * replayed, and the activity wherever this holds one.
   *
   * ⚠️ **As handed over, and never kept current**: what arrives after the page says what changed.
   * ⛔ Absent on `resumed`, whose page ends where the new life begins (see {@link liveFrom}), and on
   * `recorded`, which this window is not fed.
   */
  readonly asHandedOver?: Pick<ConversationAtWork, 'status' | 'told'>
}

/**
 * See {@link ResumedSession.handover}. ⚑ **D-017b · `recorded`** — the conversation drawn from its
 * LEDGER, for a window this host is not feeding its events: nothing was started and nothing was
 * attached (`RuntimeBridge.look`). ⚑ Its `liveFrom`, when present, is where the life the page
 * records stopped, so the window settles what that life left open there.
 */
export type SessionHandover = 'resumed' | 'attached' | 'recorded'

/**
 * 🔴 **What a conversation is, one instant after its owner gave it back** (523).
 *
 * ⛔ **Three fields, and none of them is an echo of the request.** A release that returned its own
 * input would prove nothing; every field here is read from the host AFTER the write, which is what
 * lets a surface report the act rather than assume it (standing rule 18).
 *
 * ⚑ **It is deliberately not a {@link ResumedSession}.** Nothing is being handed over — there is no
 * history to replay, no handover to adopt, no queued mailbox to disclose and no liveness to project,
 * because the surface asking has just stopped being the place any of that goes.
 */
export interface ReleasedSession {
  /** The conversation that was handed back — the host's own id, not the one that was sent. */
  readonly sessionId: string
  /**
   * 🔴 **The room's word for it now** — `RuntimeHost.runningStateOf`, read after the release.
   *
   * ⚑ **`unwatched` is the measurement, not the constant.** The same three-armed word `421` put on
   * every conversation row is computed here off `slot.ownerId`, so this says *the owner really is
   * gone* rather than *the call did not throw*. ⚠️ A conversation that was on its way out would read
   * `not-running` — and could not have reached this far, because the door refuses it `still-closing`
   * first. See {@link RunningState}.
   */
  readonly running: RunningState
  /**
   * 🔴 **Is a question still standing that nobody can now answer?** (`519` F4, HO-037 §1.)
   *
   * ⛔ **The cost this gesture makes deliberate, reported rather than clamped.** Releasing does not
   * settle, withdraw or deny a pending permission card: it stays durable, stays visible in the
   * person's queue, and **cannot be answered by anybody** until somebody claims the conversation
   * again — not the parent, not the commander, not the app. ⚠️ *Tell, don't clamp*: the press is
   * allowed and the consequence is stated, rather than the control being disabled on a conversation
   * a person is entitled to stop watching.
   *
   * ⚑ **The LIVE status, not the last event's** (122's rule) — the handle knows whether a card is
   * still open and the event stream lags it. Same read as `UnclaimedSession.waitingForAHuman`, so
   * the sentence the pane says and the row the queue draws cannot disagree.
   */
  readonly waitingForAHuman: boolean
}

export interface CreateSessionInput {
  provider: Provider
  /**
   * Where the conversation works. **Omit to take the default**, which is the durable BroBot
   * workspace.
   *
   * ⚠️ **It is not a fresh scratch directory and it is not confined**: `checkSessionCwd` admits any
   * existing, searchable directory a person points this field at (`364`).
   */
  cwd?: string
  /**
   * Which profile's provider home to run in (085) — the shared-vs-isolated memory boundary.
   * Same profile ⇒ same home ⇒ the provider remembers across sessions; a different one ⇒ a
   * separate home that shares nothing. Omitted ⇒ {@link DEFAULT_PROFILE_ID}. It becomes a path
   * segment, so the host validates it.
   */
  profileId?: string
  /**
   * Whether this session prompts for consequential actions (078). Omitted ⇒ `'ask'` — the safe
   * default; `'auto'` ("yolo") is only ever reached by asking for it by name.
   */
  approvalMode?: 'ask' | 'auto'
  /**
   * How hard the model should think (024). Neutral across providers — each adapter spells it its
   * own way. ⚑ **D-042 · R1 — omitted ⇒ the host names one**: the effort of the pair R1's order
   * selects, or the named model's own default effort. Nothing runs on an unnamed default.
   */
  reasoningEffort?: ReasoningEffort
  /**
   * WHICH model to run (038). Free text, because the id vocabulary is the provider's and changes
   * without us. ⚑ **D-042 · R1 — omitted ⇒ the host names one, by R1's order**: this agent's
   * default, else the last pair a person picked on this provider, else the provider's own default
   * by name. ⚠️ What the provider reports back is still its own fact (`SessionSettingsDisclosure`'s
   * `reported`).
   */
  model?: string
  /**
   * Start this session in PLAN MODE (030): the agent proposes what it intends to do, and you
   * approve the plan before it carries it out.
   *
   * 🔴 **BOTH PROVIDERS, and this block is the argument for the descriptor said a third time**
   * (461, correcting 044's correction in place).
   *
   * ⛔ **Three sentences stood here and all three were false**: that this field was for one provider
   * because ours was not built, that the Codex descriptor still read the not-built word, and that
   * the Codex adapter took no notice of the field. ⚑ **They are named rather than reproduced** —
   * a docblock that quotes a retired claim is a retired claim the next reader can copy, and the
   * census in `ride-the-providers-door.test.ts` §4 could not then tell a quotation from a claim.
   *
   * ⚠️ They had been false since 057 asked the server (`collaborationMode/list` → Plan, Default) and
   * 060 measured the ending. **The history this block was recording is exactly what happened to it:**
   * 030 declared the capability absent, 044 falsified that against our own vendored types and
   * **corrected the claim in four other places and missed this one** — and 057 then moved the state
   * again and missed it too. ⚑ **`461` is the third correction of one sentence in one docblock, and
   * HO-027 §2 was briefed from the copy that survived.**
   *
   * ⛔ **So this line names the descriptor and states no state of its own.** Each adapter's
   * `planMode` capability entry is the one place that answers *can it, and have we built it* —
   * `packages/runtime/src/{claude,codex}/capabilities.ts` — and a surface that restates the answer
   * here is a surface free to disagree with it. **What travels with the field is the mechanism, not
   * the verdict:** Claude takes it as `Options.permissionMode: 'plan'`, Codex as
   * `TurnStartParams.collaborationMode: {mode:'plan'}` re-sent every turn, and the two ENDINGS
   * differ — Claude's is the model's own `ExitPlanMode` card, Codex's is this app sending
   * `{mode:'default'}` with the go-ahead (060). `planModeEnded` exists for the second of those.
   *
   * ⚠️ Not a safety gate. It changes what the agent DOES FIRST, not what it is allowed to do; the
   * approval mode is still the only thing gating actions. ⚑ **What IS a floor is ours and it is
   * Claude-only** (140): `promptGuardHooks` refuses consequential tools while that session is
   * planning — every one except the tools that create nothing, which 461 let through so a planning
   * agent can still put a proposal in front of a person.
   */
  planMode?: boolean
  /**
   * Start this session in the provider's **maximum-effort orchestration mode** (106) — for Claude,
   * `ultracode`: standing dynamic-workflow orchestration at any effort level.
   *
   * Treat `ultracode` as a boolean setting beside effort, matching the pinned SDK's `Settings.ultracode` in `sdk.d.ts:8701`. It is absent from `EffortLevel`, so keep it separate from `reasoningEffort`.
   *
   * ⚠️ **Launch only, and there is deliberately no `setSessionSetting` sibling.** It is
   * session-scoped and *"interactive toggles never persist it"* (the SDK's words), and 106 measured
   * that the CLI takes it with no error, no readback and no validation — a key no `Settings` declares
   * is accepted just as quietly. A mid-session control would report a success it could not verify,
   * so there is none, and nothing echoes this back on
   * {@link SessionSettingsDisclosure}: there is no honest present tense for it.
   *
   * ⚠️ **Not persisted, so a reopen does not re-ask.** No column, no `ResumableSessionInfo` field —
   * see `StartOptions.ultracode`, which is on the start options precisely so `ResumeOptions` cannot
   * carry it. Whether a provider has such a mode at all is
   * `ProviderCapabilities.ultracode`; Codex's is `absent`, because its `ultra` is an effort value on
   * the other axis.
   */
  ultracode?: boolean
  /** What this window calls this launch, so it can take it back (102). See {@link LaunchInput}. */
  launchKey?: string
}

/**
 * **What a surface calls the launch it is waiting on** (102) — the only handle a Cancel can have.
 *
 * ⚠️ **A create has no session id to cancel by.** The host mints the id inside `createSession`, and
 * the renderer learns it from the promise that resolves when the launch is over — which is exactly
 * the promise that never resolves in the case this exists for. So the naming goes the other way:
 * the window names its own gesture, passes the name with the launch, and cancels by it. The host
 * scopes every lookup by the sink's owner as well, so one window cannot cancel another's launch.
 *
 * A correlation token, never a label: nothing renders it, and it is not an id of anything that
 * outlives the launch.
 */
export interface LaunchInput {
  launchKey: string
}

/** Reopening a recording, with a name for the wait (102). */
export type ResumeInput = SessionInput & Partial<LaunchInput>

/**
 * ⚑ **D-017b · draw a conversation in this window, and start nothing** — see
 * {@link RuntimeBridge.look}. ⚑ `claim` is a person's press: a conversation running with no window
 * is taken for this window. ⛔ Absent or `false` — the window looking again because the world moved —
 * takes nothing.
 */
export interface LookInput extends SessionInput {
  claim?: boolean
}

/**
 * ⚑ **D-017b · a person's message from a conversation's full view, and the start it causes, in ONE
 * act** — `RuntimeHost.startAndSend`. ⚑ A send's fields, and the name for the wait a start needs
 * ({@link LaunchInput}): the composer's Stop reaches this start as the launcher's Cancel reaches a
 * launch (`cancelLaunch`).
 */
export type StartAndSendInput = SendInput & Partial<LaunchInput>

/** ⚑ The message went: the conversation runs in this window, handed over as a reopen is. */
export interface FirstMessageSent {
  readonly sent: ResumedSession
}

/**
 * ⚑ The message did not go — see {@link FIRST_MESSAGE_REFUSALS}. ⚑ **`running` is read off the
 * conversation when the answer is made**, never off which row of the table was taken.
 */
export interface FirstMessageNotSent {
  readonly notSent: {
    readonly refusedBy: FirstMessageRefusal
    /** The sentence a person reads. */
    readonly said: string
    /** ⚑ `716`'s word for a refused start — `null` on every other row, and for a start it cannot name. */
    readonly launch: LaunchRefusal | null
    /**
     * The conversation after an `after-the-start` refusal, if one is handed back.
     * `handover` distinguishes live adoption from recorded information. A recorded
     * snapshot neither attaches nor claims its stream; non-null `running` or live
     * liveness alone does not mean this window owns it. A live handover is adopted
     * as a reopen; a recorded snapshot keeps the view recorded. `null` otherwise.
     */
    readonly running: ResumedSession | null
  }
}

export type FirstMessageAnswer = FirstMessageSent | FirstMessageNotSent

export interface SendInput {
  sessionId: string
  text: string
  /**
   * ⛔ **Paths the person attached, if any** (216). Optional, because every existing caller sends
   * none and a required field would have been a change to every one of them for nothing.
   */
  attachments?: HandedPath[]
}

/**
 * What asking to queue a message actually did (077).
 *
 * ⚠️ **The race is real and it is unavoidable, so it is ANSWERED rather than refused.** "Queue this"
 * is decided in the renderer against a status that crossed a process boundary to get there; by the
 * time the command lands, the turn it was meant to wait behind may already have ended. Refusing then
 * would reject a press that was correct when it was made, and the user would have to press again for
 * no reason they could see.
 *
 * So a queue request that arrives at an idle session is SENT, and says so. The two outcomes are
 * distinguished because they leave different transcripts — `'sent'` opens a turn immediately, and
 * only `'queued'` leaves something to cancel — and a surface that could not tell them apart would
 * offer to cancel a message that had already gone.
 *
 * ⚑ **354 gave that difference a shape rather than a word inside the host.** Only the held branch
 * carries a name, because only a held message is a thing the person can still cancel; asking the
 * other branch for one does not compile. ⛔ **490 keeps that internal handle out of the agent-tool
 * answer**, where neither branch gives the caller an id it has no tool to use.
 */
export type QueueOutcome =
  /**
   * Held. It will be sent when the running turn ends; until then it can be cancelled — **by this
   * id and no other** (354).
   */
  | { readonly outcome: 'queued'; readonly messageId: string }
  /**
   * Nothing was running by the time this arrived, so it went straight out as an ordinary turn.
   *
   * ⛔ **No `messageId`, and that is the shape doing the work** (354). An id handed back here would
   * name a message that was never held, which a person could then try to cancel. Reading one off
   * this branch is a compile error rather than a rule somebody has to remember.
   */
  | { readonly outcome: 'sent' }

/**
 * What answering a card actually did — **including whether the request survived being refused**
 * (146, from 145 HIGH 1).
 *
 * ## The defect
 *
 * Both adapters correctly keep an unusable answer PENDING: Claude refuses above its broker slot,
 * Codex refuses before spending the claimed request, and `RuntimeHost` says in as many words that
 * such a card is *"STILL LIVE"*. The renderer threw that away. Every failed response went through
 * one `noteFailure`, which writes `item.note` — and any note makes a card settled and
 * non-awaiting. **Answer and Reject went, the waiting panel dropped it, the composer unfroze**, and
 * with no visible pending card `waiting_permission` projected as busy rather than frozen. The
 * provider and the runtime were still blocked, and Stop or close was the only ordinary recovery.
 *
 * ⚠️ **Reachable by an ordinary click**, which is what made it worth a wire change rather than a
 * comment: a provider option label that is only whitespace is legal in both pinned types, the card
 * counted it chosen and complete, and the adapter refused the empty answer it became.
 *
 * ## Why this is a value and not an exception
 *
 * `answer-refused.ts` already says the reason cannot cross this boundary as an error: *"Electron's
 * `ipcMain.handle` serialises only `.message`"*, so a refusal arriving in the renderer is
 * indistinguishable from any other string, and 085's translation exists precisely because of that.
 * A refusal is not a fault — it is an answer to the gesture, *"no, not like that"* — so it comes
 * back as one, carrying the one bit the renderer cannot derive: whether there is still a question
 * on screen to answer.
 *
 * ⛔ **A genuine fault still throws**, and still settles the card. An unclassified error means
 * nobody knows whether the request was consumed, and a card that stays live on a request that is
 * gone is the same lie in the other direction — see `session-store.ts`'s failure path.
 */
export type AnswerAck =
  /** The runtime took it. Whatever it means for the card arrives on the event stream. */
  | {
      readonly outcome: 'taken'
      /**
       * ⚑ **D-017 · R1 — taken, and not yet delivered**: a question this app asked was answered and
       * closed, and the conversation that asked could not be started now — the sentence says the
       * answer is kept for its next start, and why it did not start. ⚠️ Absent whenever the answer
       * went on to its asker. On a decision about an agent's request to register an MCP server, what
       * came of it: registered and what the server offers, or refused.
       */
      readonly reason?: string
    }
  | {
      readonly outcome: 'refused'
      /** The sentence to put ON the card — already translated out of the adapter's diagnostic. */
      readonly reason: string
      /**
       * **The request is still pending and this card is still answerable.**
       *
       * `true` only for `not-usable` and (`740`) `not-kept`: the answer was refused before it could
       * take the broker slot, so nothing was written and the same question is still waiting. `not-pending` and
       * `not-offered` are both about a request that has gone, and those settle the card exactly as
       * they always did.
       */
      readonly stillOpen: boolean
    }

/**
 * 🔴 **742 · `739` F-6 — what a person's answer to a PROVIDER's request did**: {@link AnswerAck}, or
 * that the provider has not taken it yet.
 *
 * ⛔ **The defect**: the host awaited the adapter's answer with no bound, so an adapter that never
 * settled it held the person's IPC for good — the card stayed dark and Home said *"answer sent —
 * waiting for the conversation to settle"* with nothing ever following it (standing rule 8.4).
 * ⚑ The host now waits {@link AnswerUnacknowledged.waitedMs} — `interrupt`'s own bound — and then
 * answers this arm.
 *
 * ⚠️ **Only the two doors that hand an answer to a provider answer it.** `decideInstruction` is
 * this app's own decision, settled before it returns, and keeps {@link AnswerAck}.
 */
export type ProviderAnswerAck = AnswerAck | AnswerUnacknowledged

/**
 * ⚑ **The host stopped waiting; the answer did not stop.** It is still with the provider, and
 * `settledWithin` released the WAITER, not the work — `interrupt`'s rule (709).
 *
 * - **If it lands later**, the host records it then: the conversation's `user_decision` row is
 *   written when the provider takes it, and that row settles the card, exactly as a prompt answer's
 *   does.
 * - **If it never lands**, nothing else is said, and the card is still the provider's question.
 *   ⚠️ The host's door would take a second answer as it took the first, but the window keeps the
 *   card's `sent` guard on this arm today (`noteAnswer`), so none is offered until `743` draws it.
 * - ⚠️ **If it is refused or fails after the bound, only the log says so** — nothing is carried to
 *   the window, including a refusal that would have left the card answerable (`not-usable`,
 *   `not-kept`). Both adapters on `main` refuse before they spend the request, inside the bound, so
 *   none reaches this; an adapter that refuses late would need a wire of its own (`742` F-2).
 * - ⛔ **Not a refusal, and not a fault.** Nothing is known to have been refused, and nothing is
 *   known to have been lost.
 *
 * ⚑ **No sentence rides on it.** The words are the surface's (`743`), rendered from the fact: the
 * provider has not acknowledged the answer after `waitedMs`. ⚠️ **Until `743` draws it, nothing on
 * screen does** — and the window's own bound (`737`'s 15 s *"no answer"* line) no longer fires for
 * these two doors, because this answers first (`742` F-1).
 */
export interface AnswerUnacknowledged {
  readonly outcome: 'unacknowledged'
  /**
   * How long the host waited, in milliseconds — the host's own bound, so a surface that says a
   * number says the one that was waited (rule 8.2).
   */
  readonly waitedMs: number
}

/** Ask a live session to change what it prompts for (034). */
export interface SetApprovalModeInput {
  sessionId: string
  /**
   * `'auto'` is the yolo opt-in and is only ever reached by asking for it BY NAME — the same
   * exact-match rule as at creation (078), re-applied here because this is a second door to the
   * same room.
   */
  mode: 'ask' | 'auto'
}

/**
 * Approve the plan and get to work (060) — the go-ahead, as one command.
 *
 * ⚠️ **The message is the CALLER's, not the host's, and that is deliberate.** The bar above the
 * composer tells the user which sentence pressing the button will send; handing that same string
 * down means the sentence disclosed and the sentence delivered are one value, rather than two
 * copies that agree until someone edits one of them.
 */
export interface EndPlanModeInput {
  sessionId: string
  /**
   * The go-ahead to send once the mode has changed. Appears in the transcript as what it is.
   *
   * ⚠️ **Absent is LEAVING, not a missing field** (085). Stopping the proposal and approving the
   * proposal are one transition on the wire — 076 established that and it is not being reopened —
   * so they stay one command, and the message riding with it is the entire difference between them.
   * No message means the agent hears nothing until the user types, and what they type is what it
   * acts on. A second command would put two controls on screen that both mean "stop planning",
   * which is the thing that ruling forbids.
   */
  text?: string
}

/**
 * Change the model, the effort, or plan mode on a live session (076).
 *
 * ⚠️ **An absent `value` is a request, not a missing field.** For `model` and `reasoningEffort` it
 * is the gesture that undoes a choice — *"back to the provider's own default"* — and ⚑ since D-042
 * (R1) the host NAMES that default before anything is sent: the provider's default model by its
 * name, and an effort only where the model offers one — its own default effort.
 *
 * ⚠️ **`planMode` here only ever turns planning ON** — typed `true`, so the other direction is not
 * expressible. Turning it off is the go-ahead and has its own command ({@link EndPlanModeInput}),
 * because releasing a plan without saying anything leaves a conversation that has been told to stop
 * planning and given nothing to do — see the 076 ruling.
 */
export interface SetSessionSettingInput {
  sessionId: string
  /**
   * Nested rather than spread, and not for tidiness: `RuntimeCommand` discriminates on `kind`, so a
   * body carrying its own `kind` at the top level would intersect to `never` and the command would
   * be unconstructible. The nesting is what lets one command carry three shapes.
   */
  body:
    | { kind: 'model'; value?: string }
    | { kind: 'reasoningEffort'; value?: string }
    | { kind: 'planMode'; on: true }
}

/**
 * What the folder picker came back with (076 §3) — `null` when the user cancelled.
 *
 * ⚠️ **A refusal still carries the path.** Cancelling and choosing-something-refused are different
 * events and the UI owes the user different things: nothing for the first, and for the second the
 * folder they picked plus the reason it cannot be used. Collapsing them to `null` would make a
 * rejected choice look like a changed mind, with the rule that rejected it never stated.
 *
 * `refusal` is `checkSessionCwd`'s own sentence, verbatim — see there for why it is not re-phrased
 * on the way through.
 */
export type ChosenCwd = { path: string; refusal?: string } | null

/**
 * ⛔ **What the attachment picker came back with** (216 §2/§3) — `null` when the user cancelled.
 *
 * Three outcomes, not two, for the reason {@link ChosenCwd} gives one field above: cancelling and
 * choosing-something-refused are different events, and a UI that collapsed them would show an error
 * to somebody who changed their mind.
 *
 * ⚑ **`refusal` is `classifyHandedPath`'s own sentence, verbatim** — it names what is wrong with the
 * thing they picked (nothing there, a shortcut pointing nowhere, not a file or folder), which is
 * what makes the refusal actionable rather than a shrug.
 */
export type ChosenAttachment = { handed: HandedPath } | { refusal: string } | null

/**
 * ⛔ **What one DROPPED path came back as** (218 §2) — {@link ChosenAttachment} without the `null`.
 *
 * ⚑ **The missing third case is deliberate and is the difference between the two gestures.** `null`
 * means *"cancelled"*, and there is no cancelling a drop: by the time main sees the paths the person
 * has already let go. A drop of three files therefore yields three answers, each of which is either
 * a path to stage or a sentence saying why it cannot be.
 *
 * ⚠️ **One answer per thing dropped, and ONE MORE when the cap was reached** (232 §3, correcting
 * this note). It used to say the reply *"still corresponds to the request the way
 * `captionHandedPaths` does"*, and `227` MEDIUM 5 is what that cost: `classifyDroppedPaths` sliced
 * at {@link MAX_HANDED_PATHS} and the eleventh file vanished with no verdict, no sentence, and
 * nothing on screen that had changed. ⛔ **The correspondence is one-way now** — every entry that
 * was looked at has an answer, and a trailing refusal names how many were not. A caller that zips
 * verdicts to its own list by index was already wrong (a non-string is dropped silently) and is
 * more obviously wrong now.
 */
export type DroppedPathVerdict = { handed: HandedPath } | { refusal: string }

/**
 * **May this folder be a session's cwd, and if not, why not** (203, from 195 H4).
 *
 * `checkSessionCwd`'s own answer, on the wire. The launcher had exactly one way to ask it — open the
 * native picker — so a folder the user TYPED was never checked at all: `cwdRefusal` was cleared on
 * every keystroke because *"the renderer cannot stat a path"*, and `launchBlocked` weighed the
 * profile and not the folder. Send was therefore lit over a folder that does not exist, which is the
 * *"no control that cannot act"* shape 106/118 forbid and 169 removed for the profile NAME.
 *
 * ⚠️ **`ok: true` carries the RESOLVED path**, because `~` expansion and `..` folding happen inside
 * the rule and a launcher showing the typed spelling beside a verdict about a different directory
 * would be answering a question it was not asked.
 */
export type CwdVerdict = { ok: true; path: string } | { ok: false; reason: string }

export interface RespondPermissionInput {
  sessionId: string
  /** The `permission_request` event's `id` — the only correlation the contract guarantees. */
  requestId: string
  decision: PermissionDecision
}

export interface RespondUserInputInput {
  sessionId: string
  /** The `user_input_request` event's `id`. */
  requestId: string
  response: UserInputResponse
}

/** A person's answer to a to-do an agent asked of them (`request_action`). */
export interface AnswerActionInput {
  /** The conversation that asked. */
  sessionId: string
  /** The to-do's request id. */
  request: string
  /** Done, or Can't do it. */
  done: boolean
  /** Their note, if they wrote one. */
  note?: string
}

export interface SessionInput {
  sessionId: string
}

/**
 * 🔴 **Take back the message a session is holding, BY NAME** (354).
 *
 * ⛔ **A separate input from {@link SessionInput}, because the id is required and this verb used to
 * be built from that one.** A cancel that named only the session took back whatever was held at the
 * moment it arrived, which is not necessarily what the person was looking at: the message they were
 * offered a cancel for can go, and another can be queued behind the turn it started, inside the gap
 * between the render and the press.
 *
 * ⚠️ **`messageId` is REQUIRED, and `runtimeCommandSchema` refuses a command without it rather than
 * stripping it** (`303` B: eight keys arrived, seven parsed, and the failure looked like a slow
 * provider). An older renderer's shape is answered with a refusal a person can read, not with a
 * cancellation of a message nobody named.
 */
export interface CancelQueuedMessageInput {
  sessionId: string
  /**
   * The held message's own name — the one {@link QueuedMessageDisclosure.id} publishes. ⚑ **700 · the
   * renderer takes it off the pressed row** (`QueuedItem.messageId`, `688`), never off the disclosure.
   */
  messageId: string
}

/**
 * Stop ONE piece of background work (248), by the id its own provider accepts.
 *
 * ⚠️ **`id` is the PROVIDER's stop key and the two providers disagree about what it is** — Claude's
 * `task_id`, Codex's `processId` — which `247` wrote into the type it came from rather than smoothing
 * over: *"a neutral surrogate would be a third identifier nobody could act on."* It reaches this
 * command as `background_work.running[].id` or `tool_result.backgroundId`, unmodified.
 */
export interface StopBackgroundWorkInput {
  sessionId: string
  id: string
}

/** Ask for the page of conversation before one already held (054). */
export interface EarlierHistoryInput {
  sessionId: string
  /**
   * The ordinal the caller's oldest page begins at — {@link HistoryWindow.from}. Exclusive: the
   * reply ends where this begins, so pages abut without overlapping and without a gap.
   */
  before: number
  /** How many turns to take. Defaults to {@link HISTORY_WINDOW_TURNS}; bounded at the wire. */
  turns?: number
}
