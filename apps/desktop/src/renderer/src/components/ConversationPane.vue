<script setup lang="ts">
import type { HandedPath } from '../../../shared/attachment-contracts'
import type { WhatAPickBecame } from '../../../shared/model-choice-contracts'
import type { AgentState, StoppedPiece } from '../../../shared/agent-state-contracts'
import type { ConversationWait, HeldWork } from '../../../shared/task-contracts'

import { computed, nextTick, onMounted, onUnmounted, provide, reactive, ref } from 'vue'
import type {
  AgentIdentity,
  PermissionDecision,
  ProviderCapabilityMap,
  SetSessionSettingInput,
  UserInputResponse,
  ChildWorkInput,
  ChildSendResult,
  ChildStateResult,
  ChildWorkResult,
  CommandTail,
  ToolAnswer,
  WorkflowOutputResult,
  InstructionSourceResult,
  RevealResult,
  ConfigFileResult,
  SessionPathTarget,
} from '../../../shared/runtime-ipc'
import { stopJoinsThatAsk } from '../lib/stop-unanswered'
import type { PickedModel } from '../lib/model-lists'
import { useWhoCalledWhom } from '../composables/useWhoCalledWhom'
import { aGiverWaitsOnPurposeSays, ownWaitSaid } from '../lib/conversation-list'
import {
  activityLine,
  facetsOfState,
  forAPerson,
  needingFor,
  parkedOnAnotherAnswer,
  sessionFacets,
  stateHere,
  stateForRecord,
  facetsForRecord,
  type SessionFacetInput,
} from '../lib/agent-state'

import type {
  ConversationIdentity,
  ConversationRenameInput,
  ConversationRenameResult,
} from '../../../shared/conversation-title'
import type { WorkThatNamesIt } from '../../../shared/piece-called'
// ⚑ **636 · a TYPE only** — see {@link ConversationPane.waiting}, which is narrowed before it
// arrives and is never derived here.

import { scheduleHeld, somethingRunning } from '../../../shared/agent-state'
import { whoItOwesIn } from '../lib/conversation-waits'
import type { WorkGivenOutReading } from '../lib/work-given-out'
import { THE_COMPACT_COMMAND, type CompactionFacts } from '../lib/compaction-offer'
import type { DraftHanding } from '../lib/drafts'
import { attachmentsNotRestored, puttingItBack, withTheseToo } from '../lib/drafts'
import { TAB_OF_THE_BAND, drawerFit, type DrawerFit, type DrawerTab } from '../lib/drawer'
import {
  controlHoldsTheStart,
  lastReportAt,
  profileItRunsAs,
  requestDraft,
  turnsTakenWithoutThisWindow,
  whoIsIn,
  type RequestDraft,
  type SessionRecord,
} from '../lib/session-record'
import {
  GO_AHEAD_LABEL,
  GO_AHEAD_MESSAGE,
  GO_AHEAD_NOTE,
  LEAVE_PLAN_LABEL,
  LEAVE_PLAN_TITLE,
} from '../lib/plan-mode'
import { sessionPanel } from '../lib/session-panel'
import { CLOSING_BLOCK, SIGN_IN_SUPERSEDED_BLOCK } from '../lib/send-refusals'
import { aCommandInTheBox, aCommandTakesNoAttachmentsYet } from '../lib/a-command-with-files'
import type { SendBlock } from '../lib/composer-notice'
import {
  aSurfaceMayOpenADocument,
  type ResourceDrawer,
  type ResourceReader,
  type ResourceRevealer,
} from '../lib/opening-a-document'
import { A_COMMAND_HAS_NOT_ANSWERED, type SendIntent } from '../lib/session-store'
import type { ForestView } from '../lib/the-forest'
import ActivityPill from './ActivityPill.vue'
import ImageViewer from './ImageViewer.vue'
import CanonicalDocumentOverlay from './CanonicalDocumentOverlay.vue'
import WorkflowOutputViewer from './WorkflowOutputViewer.vue'
import WorkflowEntry from './WorkflowEntry.vue'
import PlanEntry from './PlanEntry.vue'
import ToolEntry from './ToolEntry.vue'
import SheetShell from './SheetShell.vue'
import ChildWorkViewer from './ChildWorkViewer.vue'
import ToolAnswerViewer from './ToolAnswerViewer.vue'
import RunInput from './RunInput.vue'
import OverlayHost, { useModalDepth } from './OverlayHost.vue'
import SessionTools from './SessionTools.vue'
import AgentInstructionsSheet from './AgentInstructionsSheet.vue'
import AgentInputPopup from './AgentInputPopup.vue'
import { READ_WHAT_THE_MODEL_GOT } from '../lib/agent-inputs'
import PromptComposer, { type ComposerState } from './PromptComposer.vue'
import ConversationMain from './ConversationMain.vue'
import SessionDrawer from './SessionDrawer.vue'
import type { TitleHistorySource } from './ConversationTitleHistory.vue'
import type { TaskPageSource } from '../composables/useConversationTaskPage'
import SignInPanel from './SignInPanel.vue'
import ProviderSetupProgress from './ProviderSetupProgress.vue'
import { providerLimitDisplay, type ProviderBlockFacts } from '../lib/provider-limit-status'
import { useMinuteClock } from '../composables/useMinuteClock'
import { useStillThinking } from '../lib/still-thinking'
import SessionHeader from './SessionHeader.vue'
import SessionShelf from './SessionShelf.vue'
import TranscriptView from './TranscriptView.vue'
import { useClientMessagePaths } from '../composables/useMessagePaths'
import { useConversationSignIn } from '../composables/useConversationSignIn'
import { useConversationOverlays } from '../composables/useConversationOverlays'
import { useToolRowControls } from '../composables/useToolRowControls'

/**
 * Render the supplied conversation record; the parent owns which record is selected.
 * Switching records leaves their running sessions and event delivery intact.
 * Local view state, such as an open image, names its conversation and must reset
 * when that record changes; see viewing.
 */
const props = defineProps<{
  record: SessionRecord
  /** The main panel reads the forest lazily; `null` means it has not been read. */
  forest?: ForestView | null | (() => ForestView | null)
  forestPending?: boolean
  forestError?: string | null

  /**
   * Whether the drawer is showing (080). A view preference, owned and
   * persisted by the screen rather than reset every time you switch conversation.
   */
  drawerOpen: boolean
  /** Which tab it is on — persisted beside `drawerOpen`, so coming back lands where you left. */
  drawerTab: DrawerTab

  /**
   * 🔴 **UI-012 · a person's model pick, carried out** — the model, then the effort
   * (`pickInAConversation`), by the screen that holds the conversation; the drawer's picker calls
   * it. ⚑ Absent: the picker is a statement.
   */
  pickModel?: ((pick: PickedModel) => Promise<WhatAPickBecame | null | undefined>) | undefined
  /**
   * Every provider's declared capabilities (039). Passed through rather than fetched here — one
   * read per app run, owned by the screen. The panel's *Compact now…* reads
   * `requestCompaction` from it (087; live since `718`, `compaction-offer.ts`); nothing here
   * interprets it — the pane hands the drawer its own send facts beside it ({@link compaction}).
   */
  capabilities: ProviderCapabilityMap | null
  /**
   * 🔴 **The work this conversation gave out** (508) — the Work tab's whole input, passed through.
   *
   * ⛔ **Owned by the screen, for the reason `capabilities` is**: `RuntimeScreen`
   * owns every poll that feeds a surface it mounts, keeps the last good answer on a refusal, and
   * hands the result down. ⚠️ Nothing here interprets it — this pane forwards it to the drawer and
   * reads exactly one derived boolean off it for the Open tab's empty column.
   *
   * ⚑ **Optional, and the absence draws no tab body of its own** — the five render tests that
   * mount this pane without it are asserting about a conversation whose work has not been read,
   * which is the state on the first frame of every real one.
   */
  work?: WorkGivenOutReading | null
  /**
   * 🔴 **The one wait THIS conversation is in** (636, `621` §5.1 · `HO-095` §5.1) — the row for
   * this conversation out of `store.whatEachConversationIsWaitingOn()`, already narrowed by
   * {@link theWaitIn}.
   *
   * ## ⛔ Why it is a prop and not something this pane could fold
   *
   * ⚠️ **`facetInput` below reads five facets off `control`**, which is this window's fold of THIS
   * conversation's ledger. ⛔ A child's `work_replied` is written into the CHILD's ledger, so a
   * conversation whose worker is working is told nothing at all when the work moves — `621` §4's
   * measurement, and the reason `whatEachConversationIsWaitingOn` is a read rather than an event.
   * ⚑ **Same channel as {@link ConversationPane.work}**: the screen owns every poll that feeds a
   * surface it mounts, keeps the last good answer on a refusal, and hands the result down.
   *
   * ## ⚠️ Absent is *nobody has looked*, and it never becomes `idle`
   *
   * ⛔ **The three absences are told apart one call up** — see {@link WaitReading} — and only the
   * narrowed answer arrives here. ⚑ Every render test that mounts this pane without it is
   * asserting about a conversation whose wait has not been read, which is the state on the first
   * frame of every real one, and those assertions do not move.
   */
  waiting?: ConversationWait | null
  /**
   * 🔴 **D-006 · where the work this conversation holds stands** — {@link ConversationWaiting.work},
   * handed down beside {@link ConversationPane.waiting} from the same reading, on its rules.
   */
  heldWork?: HeldWork | null
  /**
   * ⚑ **D-017 · R19 — what the HOST calls the conversation a question this one asked went to**
   * (`whoseAnswerIn`, off the same reading as {@link ConversationPane.waiting}), or `null` — the
   * state's *"waiting on an answer from <name>"*. ⛔ The pane names nobody itself.
   */
  answerFrom?: string | null
  /**
   * ⚑ **D-036 — what the HOST calls each conversation holding open work this one gave**
   * (`whoseWorkIn`, off the same reading), or none — the state's *"waiting on <name>"*. ⛔ The pane
   * names nobody itself.
   */
  workWith?: readonly string[]
  /**
   * The pieces this conversation gave whose holder stopped with them open (`stoppedWorkIn`, off the
   * same reading), or none: the state's *"W6.4.1 with Quinn: stopped at 00:28"*.
   */
  stoppedWork?: readonly StoppedPiece[]
  /** When each wait began, as the host read them; a wait it gives no start for has none. */
  waitsBegan?: {
    readonly answer?: number | null
    readonly owes?: number | null
    readonly work?: number | null
  }
  /**
   * ⚑ **D-017b · the one state the host says of this conversation** — its row in the one list — or
   * `null` while the list has not named it. ⚑ A view drawn from its ledger draws its plate from it,
   * as its row does: this window is not fed its events, so its own fold cannot say what it is doing
   * while another window, or none, takes its turns.
   */
  listedState?: AgentState | null
  providerBlock?: ProviderBlockFacts | null
  /**
   * 🔴 **D-016 · commit 7 · R2 — the work that names this conversation**, off the same row as
   * {@link listedState}, or `null` while the list names none — the header's title. ⚑ Handed
   * through.
   */
  named?: WorkThatNamesIt | null
  identity?: ConversationIdentity | null
  titleHistory?: TitleHistorySource
  taskPageSource?: TaskPageSource
  /** Rename this conversation through the host. */
  rename?: (input: ConversationRenameInput) => Promise<ConversationRenameResult>
  /** Archive this conversation: the header's press. Handed through; the screen owns the bridge. */
  archive?: () => Promise<string | null>
  /**
   * ⚑ **The identity roster** (449's `agentName`) — read by every surface this pane owns.
   *
   * ⛔ **It said *so a Work row can say WHO the work went to* and named one reader** (449); `537`
   * gave it a second — the author above every assistant turn — and `545` a third: the heading on a
   * row another conversation relayed. ⚠️ **The clause is generalised rather than extended**, which
   * is `a-number-can-survive-the-death-of-its-derivation` applied to a sentence: a list of readers
   * in a docblock goes false the next time somebody adds one.
   *
   * 🔴 **The sentence once carried a NUMBER** — *three surfaces* — and went false the next time a
   * reader was added (`551`). ⛔ **The count is removed rather than corrected** — the same repair
   * `545` made to `TurnAuthorship`'s *"The three keys…"*, for the reason this paragraph already gave.
   *
   * ⚠️ `null` before the read lands is a real state: every row then reads as `profileLabel` does.
   */
  identities?: readonly AgentIdentity[] | null
  /** What is typed in THIS conversation and not yet sent (019). Owned by the screen, keyed by id. */
  draft: string
  awaitingSend?: boolean
  submit?: (text: string, intent: SendIntent, attachments: HandedPath[]) => Promise<void>
  /**
   * The screen owns the attachments alongside the draft so acquisition survives a keyed remount.
   * Required so the composer always has the same transaction for this conversation.
   */
  handing: DraftHanding
  /** This conversation's working directory, so the picker can say when a path is outside it. */
  cwd: string
  /**
   * 🔴 **The conversations this window is running, so a work report can take a person to the one
   * it names** (506). ⚑ Handed to the transcript and read nowhere else here — see
   * `lib/where-the-work-is.ts`.
   *
   * ⚠️ **Optional, and `RuntimeScreen` is the one binding that supplies it** — NOT because a missing
   * one is harmless: the two other transcripts in this app are reading a recording and have no
   * runtime to press into. `106` — the control is absent there rather than dead.
   */
  held?: readonly string[]
  /**
   * ⚑ **D-017b · a message from this view is starting the conversation now**
   * (`SessionStore.isLaunching`): the composer is busy, its Stop stops that start, and a second
   * message waits behind it.
   */
  launching?: boolean
  /**
   * Fetch and prepend the page of conversation before the one on screen (054).
   *
   * A PROP rather than an emit, because the scroll restore needs `scrollHeight` from either side of
   * the fetch and only the scroll container can take both readings. Absent for a caller with no
   * paging behind it.
   */
  onLoadOlder?: () => Promise<void>
  /** Takes a piece back from the service it is on, as a person, and answers in words. */
  onTakeBack?: (piece: string) => Promise<string>
  /**
   * Re-read the newest page after scrolling back released the tail (054). The escape from a window
   * that has left the end of the ledger — without it the transcript stays frozen for the life of
   * the session, which is what 054's review found.
   */
  onJumpToLatest?: () => Promise<void>
  /**
   * Read a workflow run's output file (108).
   *
   * A PROP for the same reason `onLoadOlder` is one: it is a FETCH, and this pane owns the overlay
   * that shows the result but not the bridge that produces it. Absent for a caller with no runtime
   * behind it — the read-only reading pane, and every SSR test — in which case the footer's button
   * simply does nothing rather than throwing into a template.
   */
  onReadWorkflowOutput?: (taskId: string) => Promise<WorkflowOutputResult>
  /**
   * 🔴 **Read one resource by the id a work report names** (510; a resource since D-016).
   *
   * ⚑ **A PROP for its neighbour's reason**: it is a FETCH, and this pane owns the panel that
   * shows the result but not the bridge that produces it. ⛔ **Absent is what makes the press
   * absent** — `TranscriptView` is handed `canOpenDocument` from exactly this, so a caller with
   * no runtime draws no control rather than a dead one.
   *
   * ⚠️ **It takes no session id**, unlike every read above it: a resource id is a primary key in
   * main's own table, and the answer does not depend on which conversation is on screen.
   */
  onReadResource?: ResourceReader
  /**
   * 🔴 **D-032 · the doors that draw a kept picture or PDF, and show a kept file in Finder** — fetches,
   * for {@link onReadResource}'s reason. ⛔ Absent, the file is told about and no button is drawn.
   */
  onDrawResource?: ResourceDrawer
  onRevealResource?: ResourceRevealer
  /**
   * Read one instruction file the provider reported (356 §2) — forwarded to the Info tab.
   *
   * ⚠️ **Optional, and its absence draws no button.** A panel that cannot open a file must not
   * offer to: every existing mount of this drawer supplies neither callback, and each of them is
   * also the negative test that the affordances are not drawn where they cannot work.
   */
  onReadInstruction?: (index: number) => Promise<InstructionSourceResult>
  /** Show one of this session's paths in the file manager (356 §1). Optional for the same reason. */
  onRevealPath?: (target: SessionPathTarget) => Promise<RevealResult>
  /** 🔴 733 · read one config file onto the app's paper — the Info panel's Open. Optional likewise. */
  onReadConfigFile?: (name: string) => Promise<ConfigFileResult>
  /** Read what one sub-agent did (112). A prop for exactly the same reason as the line above. */
  onReadChildWork?: (what: ChildWorkInput) => Promise<ChildWorkResult>
  /**
   * Ask what one child is doing, and say something to it (296).
   *
   * ⚠️ **Both optional and both absent together in practice**, so a mount that has neither is the
   * pre-296 viewer exactly — which is what keeps `conversation-chrome.render.test.ts` and the two
   * `paneProps` copies honest without either of them having to know about children.
   */
  onReadChildState?: (agentId: string) => Promise<ChildStateResult>
  onSendToChild?: (agentId: string, text: string) => Promise<ChildSendResult>
  /**
   * ⛔ **Stop ONE piece of background work, and answer whether the request went out** (248 §4).
   *
   * A PROP rather than an emit for the reason `onLoadOlder` is one, sharpened: an emit is
   * fire-and-forget, and the registry has to learn the ANSWER — a stop that never landed must give
   * the button back rather than leave the only control for still-running work reading *"Stopping…"*
   * for ever (`106`). Absent for a caller with no runtime behind it, in which case the registry
   * renders no button at all, which is what `canStopBackgroundWork` would already have said.
   */
  onStopBackgroundWork?: (id: string) => Promise<boolean>
  /**
   * Read what one running command has printed.
   *
   * A PROP for the reason above it is one, and read on a timer this pane owns: the card that is
   * showing a running command asks to be followed, and this is what the following calls. Absent for
   * a caller with no runtime behind it — a recording, or a test mounting the chrome — where every
   * card reads `null` and says so in words rather than showing an empty box.
   */
  onReadCommandOutput?: (toolCallId: string) => Promise<CommandTail | null>
  /**
   * ⛔ **The whole of what one tool answered** (462) — `457`'s finding 1.
   *
   * ⚠️ **A prop for the reason its neighbour is one, and called ONCE rather than on a timer.** A
   * tail changes while nobody does anything; a receipt does not change after it lands, so this is
   * read when a person presses the button and never again. Absent for a caller with no runtime
   * behind it, where the panel says so in words.
   */
  onReadToolAnswer?: (toolCallId: string) => Promise<ToolAnswer | null>
}>()

const emit = defineEmits<{
  refreshForest: []
  openBook: [profileSlug: string]
  /** ⛔ The text, the intent, and the paths handed with it (216) — one event, so they cannot part. */
  send: [text: string, intent: SendIntent, attachments: HandedPath[]]
  decide: [requestId: string, decision: PermissionDecision]
  move: [requestId: string, decision: 'move' | 'here']
  respond: [requestId: string, response: UserInputResponse]
  interrupt: []
  /**
   * 🔴 **718 · `R60` — the panel's confirmed "Compact now…"**, passed through: the screen owns
   * the send door, and the press is the person's `/compact` through it (`713` §3). ⛔ Not {@link
   * send}: that event puts a refused message BACK in the composer, and these are not words the
   * person typed there.
   */
  compactNow: [intent: 'now' | 'queue']
  /** Take back the message waiting to be sent (077) — ⚑ 688 · the row that was pressed, by name. */
  cancelQueued: [messageId: string]
  /** Take a held stop word back and stop the turn, as one host call. */
  stopQueued: [messageId: string]
  /** ⚑ **523 · pass-through**: this pane holds no decision about it. */
  handBack: []
  /** Open the delete confirmation for this conversation. Pass-through. */
  delete: []
  /**
   * ⚑ **D-017b · take this conversation for this window** — a card on a view drawn from its ledger,
   * whose turns no window takes, pressed *Take it over to answer here*. ⚑ Pass-through: the screen
   * opens it, which takes it.
   */
  takeItOver: []
  refreshConfig: []
  setApprovalMode: [mode: 'ask' | 'auto']
  setSessionSetting: [body: SetSessionSettingInput['body']]
  /**
   * Stop proposing. WITH text it is the go-ahead and the payload is the message the bar said it
   * would send (060); WITHOUT text it is leaving, and nothing is said on the user's behalf (085).
   * One event, because it is one transition — see `lib/plan-mode.ts`.
   */
  endPlanMode: [text?: string]
  /**
   * Close this child and open the conversation again on the machine's current sign-in (147).
   *
   * One event for the pair, because it is one gesture and half of it is never wanted: closing
   * without reopening is what the header's own X already does.
   */
  reopenSignIn: []

  toggleDrawer: []
  'update:drawerTab': [tab: DrawerTab]
  /**
   * Show this profile's memory store (318 §2.3) — **open the drawer AND choose its tab**.
   *
   * ⛔ **One event for the pair, because half of it is useless.** `toggleDrawer` is a FLIP, so a
   * caller that wanted the Info tab had to guess whether the drawer was already open and could shut
   * it by asking; and `update:drawerTab` only lands while it is open. There was no way to say *"show
   * me that"* from the conversation at all — which is the plumbing half of why the panel was three
   * clicks away and nobody found it. The same shape `reopenSignIn` above uses, for the same reason.
   */
  showInstructions: []
  /**
   * ⚑ **506 · pass-through, like `decide` and `respond` above**: this pane holds no routing
   * either. The claim-if-needed and the navigation are `RuntimeScreen`'s, where the person's
   * queue already presses the same door. ⚑ **UI-011 · `briefOf`** rides along: the piece whose
   * brief the opened conversation brings into view.
   */
  openConversation: [sessionId: string, briefOf?: string]
  'update:draft': [text: string]
}>()

/**
 * How the drawer sits in the width the transcript and it share (079 §4).
 *
 * ⚠️ **Measured, not derived from the window.** `.app` has a `min-width`, so a window narrower than
 * it does not make the layout narrower — it makes the page scroll. A media query would therefore
 * detach the drawer while the reading column still had every pixel it asked for. What is observed
 * is the row they share, whose width does not depend on the drawer's own state, so opening the
 * drawer cannot feed back into the decision that sizes it.
 *
 * SSR and any test without a DOM get `docked`: it is the state a wide window is in, and a
 * layout mode is not something to guess at on a machine that has no layout.
 */
const paneBody = ref<HTMLElement | null>(null)
const fit = ref<DrawerFit>('docked')
let sizes: ResizeObserver | null = null

onMounted(() => {
  if (typeof ResizeObserver === 'undefined' || !paneBody.value) return
  // ⚠️ **Measured SYNCHRONOUSLY first.** A ResizeObserver's first callback lands after the browser
  // has already painted, so on a narrow window the drawer would dock at its comfortable width for a
  // frame and squeeze the transcript under its floor before correcting — a visible flinch on every
  // cold open, and the only moment the 560px floor is not honoured. Found in review. `onMounted`
  // runs before paint, so reading the box here means the first frame is already right.
  fit.value = drawerFit(paneBody.value.getBoundingClientRect().width)
  sizes = new ResizeObserver((entries) => {
    const width = entries[0]?.contentRect.width
    if (width && width > 0) fit.value = drawerFit(width)
  })
  sizes.observe(paneBody.value)
})

onUnmounted(() => {
  sizes?.disconnect()
  sizes = null
})

/** The fold on SCREEN: the movable reading window (054). Rendering, and nothing else. */
const transcript = computed(() => props.record.transcript)

/**
 * The fold that says what this session IS (064) — status, ended, activity, what is still waiting.
 *
 * ⚠️ **The same object as {@link transcript} for every ordinary moment**, so this is not a second
 * opinion; it is the same one, named for what it is used for. They differ only while the reader has
 * scrolled back past a released slab, and everything below reads THIS one because every one of them
 * is a claim about the session rather than about the page — which is 061 finding 5 in one line:
 * *"reading position and current control-plane truth are one projection."*
 */
const control = computed(() => props.record.control)

/**
 * What is open in this conversation (037) — one projection, read by everything that has an opinion
 * about it, so they cannot come to different conclusions about the same session.
 *
 * The composer freezes on it: the status says a turn is frozen, but only the items know whether the
 * thing freezing it is still unanswered, and answering is the only way forward — so the composer
 * has to say so rather than accept a message that answers nothing. The header badge counts it. The
 * alternative is the drift 037 exists to avoid, and it starts with two `.some()` calls that agree
 * today.
 *
 * The panel computes it AGAIN from the state it is handed, rather than being passed this value.
 * That is deliberate and it is not a saving forgone: a component given both a state and a
 * pre-computed summary of it can be handed two things that do not match, which is the one failure
 * this whole task exists to make impossible. It costs a second linear pass over items inside a
 * render that is already linear in them.
 */
const panel = computed(() => sessionPanel(control.value))

/**
 * Determine composer state from both the conversation's state and whether it can accept a message.
 *
 * ⚠️ **`panel.waiting` is *what is OWED*, and a composer freezes on *what is BLOCKED*.** ⚑ The
 * CARDS are counted here, off this window's own fold, which is right when the host's word lags by a
 * frame. The conversation being blocked is `control.status`, which is the host's one derivation
 * (`042` measured three writers of it and `122` left one). ⚠️ **Reading the STATUS alone would give
 * up `064`'s rule** that the composer's state is control truth read locally — a card released from
 * this window's page still has an open request behind it.
 */
const composerState = computed<ComposerState>(() => {
  // ⚑ **D-017b · a message from this view is starting it** — busy, with the start's Stop.
  if (props.launching === true) return 'busy'
  // ⚑ **D-017b · a conversation drawn from its ledger takes its next message**, whatever its fold
  // last said: nothing in it is working here, and the message is what continues it. ⛔ **Above the
  // cards**: a card on such a view is answered by the window that holds it — or, where none does,
  // once this window takes it (the card's own press) — so it freezes nothing here.
  if (props.record.phase === 'recorded') return 'idle'
  // ⛔ **The CARDS, and deliberately not `panel.waiting`** — see this computed's own note.
  if (panel.value.permissions.length + panel.value.questions.length > 0) return 'frozen'
  // 🔴 **The host is holding this conversation on a person**, whether or not its card is in the part
  // of the fold this window holds.
  if (control.value.status === 'waiting_permission') return 'frozen'
  return control.value.status === 'idle' ? 'idle' : 'busy'
})

/**
 * All speaker labels use the recorded agent identity. Until it is known, say Assistant.
 * The header names the provider separately.
 */
const who = computed(() => ownAgent.value ?? 'Assistant')

/**
 * 🔴 **667 · this conversation's own agent by NAME, or `null`** — what a card puts on its own side of
 * *"Ada to BroBot"*, and what {@link who} is derived FROM, so the card and the agent's replies
 * cannot name one agent two ways (`658`).
 *
 * ⚠️ **`null` is the record with no `meta`** — {@link who} answers it *Assistant*, which is a word
 * for the absence and not a name, so a card is handed the absence and says *this conversation*.
 *
 * ## ⛔ Asked in ONE spelling — `658`'s G5, both halves of a heading alike
 *
 * ⚠️ **`meta.profileId` is `provider_session.profile_id`, the DIRECTORY spelling** — whatever case a
 * person typed at launch — and {@link agentName} folds its lookup key but NOT its fallback (`610`),
 * while every name on the OTHER half of a card is canonical. So an identity nobody has named read
 * *"dev to Dev"* on one card. `667` folded it here first, and in the rail, the drawer's plate and
 * the closed-thread list, with a renderer `oneSpelling`.
 * ⚑ **678 · `agentName` folds its fallback itself since `671`** (`667` G5a, handed back and closed),
 * so the four renderer folds were a second fold of an already-folded name and are gone — ⛔ one
 * owner for the spelling, in `shared/`, that a fifth caller cannot forget.
 */
const ownAgent = computed((): string | null => {
  const meta = props.record.meta
  if (!meta) return null
  // ⚑ **D-017b · {@link whoIsIn}** — a conversation this app ran as nobody is its provider's, never
  // BroBot's.
  return whoIsIn(meta, props.identities ?? null)
})

/**
 * 🔴 **The one channel that is not a prop** — the screen's who-called-whom read (`547`).
 *
 * ## ⛔ Why this reaches a singleton when everything else here arrives as a prop
 *
 * ⚠️ **`547` wrote the reason down before this file could act on it.** Its brief §1.1 put
 * `ConversationPane.vue` out of bounds while `545` was inside it, and this file is the only hop
 * between `RuntimeScreen` — which owns every poll that feeds a surface it mounts — and the drawer
 * that draws the band. ⚑ So the poll stayed where the convention puts it and only the TRANSPORT
 * moved, into `useWhoCalledWhom`. **That is `547` F5, and it is still open**: the repair is a prop
 * on this component and one binding on `<SessionDrawer>`, and it needs `RuntimeScreen.vue`, which
 * `550` is in. ⛔ **Not taken here** (551 §5), and this pane and the drawer move together the day
 * it is.
 */
const cast = useWhoCalledWhom()

/**
 * ⚑ **UI-002 · the files on this conversation's tree**, for the Files tab — the screen's read
 * (`TheCast.treeFiles`). ⛔ `null` while the read is about another conversation, as {@link gaveOut}
 * guards: a person can open two conversations inside one round trip.
 */
const treeFiles = computed(() => {
  const read = cast.treeFiles.value
  return read !== null && read.conversation === props.record.sessionId ? read : null
})

/**
 * ⚑ **The work this conversation gave out, as the cast last read it** — where a give's card in the
 * transcript finds the conversation its piece went to (`outgoing-card.ts`), since the receipt names
 * no id (D-016 · commit 7 · R1). ⛔ **`null` while the reading is about another conversation** —
 * `parentCardOf`'s guard: a person can open two conversations inside one round trip, and that
 * reading's gives are not this one's.
 */
const gaveOut = computed(() => {
  const reading = cast.reading.value
  return reading?.conversation === props.record.sessionId ? reading.read.workGivenOut.rows : null
})

/** Whom this conversation waits on while a piece it gave waits on purpose, and why. */
const waitsOnPurpose = computed(() =>
  aGiverWaitsOnPurposeSays(gaveOut.value ?? [], cast.listedConversations.value),
)

/** What this conversation says of its own typed wait, in the words its giver's page uses. */
const ownWait = computed(() =>
  ownWaitSaid(
    cast.listedConversations.value?.find((row) => row.sessionId === props.record.sessionId),
  ),
)

/** ⚑ **UI-002 · the work this conversation was given**, by {@link gaveOut}'s guard — see `RelayedEntry`. */
const takenIn = computed(() => {
  const reading = cast.reading.value
  return reading?.conversation === props.record.sessionId ? reading.read.workTakenIn.rows : null
})

/**
 * 🔴 **Take a person to a conversation** — `506`'s door, through the same ref `547`'s band presses.
 *
 * ⛔ **Nothing is reported as done here** (rule 18): `goToTheWork` claims the conversation when
 * this window does not hold it, says what the host refused in the host's own words, and selects
 * only after the claim has landed. ⚑ **UI-006 · a press on the Graph selects through it.**
 */
function goToConversation(conversation: string): void {
  cast.goTo.value?.(conversation)
}

/**
 * ⚑ **Show the band** — the surface that holds the children, the work and the read's own freshness.
 *
 * ⛔ **Set the tab, then open if it is shut** — `318` §2.3's rule, which this pane already states
 * for `showInstructions`: *"a flip here would shut the drawer for anyone who already had it open."*
 * ⚠️ Two existing events rather than a new one, so `RuntimeScreen` needs no edit (551 §5).
 * ⚑ **UI-006 · reached from the template alone** — a press on the Graph (`@select` below).
 */
function showTheBand(): void {
  emit('update:drawerTab', TAB_OF_THE_BAND)
  if (!props.drawerOpen) emit('toggleDrawer')
}

async function showTaskSection(): Promise<void> {
  const conversation = props.record.sessionId
  showTheBand()
  await nextTick()
  if (props.record.sessionId !== conversation) return
  const section = paneBody.value?.querySelector<HTMLElement>('[data-cy="card-task"]')
  if (!section) return
  if (section.dataset.folded === 'true') {
    section.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')?.click()
    await nextTick()
  }
  if (!section.isConnected || props.record.sessionId !== conversation) return
  section.scrollIntoView({ block: 'nearest' })
  section.focus({ preventScroll: true })
}

/**
 * ⚑ **D-010 · *Put it back* APPENDS** — {@link puttingItBack} and {@link withTheseToo}: several
 * messages may wait, so one put back joins what is in the composer rather than replacing it.
 * ⛔ Into the draft's own transaction (292 §2), which is where the composer reads it from — the
 * same slot, whether this pane is on screen when it lands or not.
 */
function restoreQueued(text: string, handed: HandedPath[]): void {
  emit('update:draft', puttingItBack(props.draft, text))
  const merged = withTheseToo(props.handing.staged, handed)
  props.handing.stage(merged.staged)
  if (merged.didNotFit > 0) props.handing.refuse(attachmentsNotRestored(merged.didNotFit))
}

/**
 * Whether a message is already waiting to be sent (077).
 *
 * ⚠️ **Read from `meta`, which the liveness channel keeps current — not from the transcript fold.**
 * The queue empties in the main process when a turn ends, with no command returning to say so, and
 * a reader paged back into history is looking at a fold that may not contain the queued item at all.
 * 064's rule: the composer's state is CONTROL truth.
 */
const hasQueued = computed(() => (props.record.meta?.queued?.length ?? 0) > 0)

/**
 * 🔴 **718 · `R60` — what the panel's "Compact now…" is offered on: the facts the COMPOSER
 * reads**, handed over rather than re-derived, so the control is live exactly where a plain Send of
 * `/compact` would go (`compaction-offer.ts`). ⛔ Not {@link sendBlocked}, which also carries what the
 * composer says about the DRAFT — a compaction sends no draft.
 *
 * ⚠️ `state` is {@link composerState} itself: a sixth `ComposerState` fails to compile here until
 * somebody decides what the offer says in it.
 */
const compaction = computed<CompactionFacts>(() => ({
  state: composerState.value,
  closing: props.record.phase === 'closing',
  signInSuperseded: signInSuperseded.value,
  hasQueued: hasQueued.value,
  // ⚑ **The person's own `/compact`, held behind the turn** — the answer to R60's question already
  // on its way, read off the same CONTROL truth {@link hasQueued} reads (`meta.queued`).
  // ⚠️ `typeof` because a held row read by a double or an older bridge may carry no words at all, and
  // a computed the drawer reads must not throw over a fact it only needs for one sentence.
  compactionIsWaiting: (props.record.meta?.queued ?? []).some(
    (held) =>
      held.attribution !== 'app_authored' &&
      typeof held.text === 'string' &&
      held.text.trim().split(/\s/)[0] === THE_COMPACT_COMMAND,
  ),
  who: who.value,
}))

/**
 * Whether this conversation is waiting for a go-ahead (060) — read from the session, never from
 * anything this component decides. `?? false` covers the frames before the host has described the
 * session: a bar that flickered on during opening would be offering to release a plan that does
 * not exist yet.
 */
const needsGoAhead = computed(() => props.record.meta?.planNeedsGoAhead ?? false)

const {
  signInSuperseded,
  signInClient,
  providerName,
  profileSignIn,
  signInRefused,
  signInTarget,
  signInRenewedFor,
  signInSetup,
  signInAgain,
  PENDING_CAPABILITY,
  signInNeeded,
  canReopenSignIn,
  signInBarCost,
  signInOf,
} = useConversationSignIn(props, transcript, control, emit)

const {
  canStopBackgroundWork,
  canWatchCommands,
  canReadToolAnswers,
  outputCapability,
  backgroundOutputCapability,
  onWatchCommand,
  tailFor,
  stoppingCall,
  onStopCommand,
} = useToolRowControls(props)

/**
 * The button is disabled unless the composer would accept a message, because pressing it SENDS
 * one. Derived from the same `composerState` rather than from a second reading of the status, so
 * the two controls can never disagree about whether this conversation can be spoken to — a button
 * that was live while the box was frozen would be refused by the host, *"cannot start work on the
 * plan: this conversation is still working"*, which is a worse way to learn the same thing.
 *
 * ⚠️ **678 · corrected (`670` §6).** This said the press *"would fail in the runtime with 'a turn is
 * in progress'"*. ⛔ **It never reached the runtime**: `RuntimeHost`'s go-ahead asks the status
 * first and refuses before it releases the plan — so the sentence above is that guard's own words.
 * ⚑ **And a race lost PAST the guard is not a failure since `670`**: another sender opened a turn
 * between the guard and the send, and the go-ahead is HELD and goes when that turn ends.
 *
 * ⚠️ **`busy` is the second half, and it is what makes a DOUBLE CLICK harmless.** Nothing about the
 * conversation changes until the command returns, so two clicks in the same breath would send two
 * go-aheads — and the second one is refused, correctly: by the host's guard while the first one's
 * turn runs, or by the handle once it has ended, because by then the plan has already been released
 * (678: this said *"by the handle"* alone). The user would have seen an error for pressing a button twice. `busy` is
 * the flag every other command on this record already sets while one is in flight; reusing it means
 * the guard cannot drift from them. ⚠️ **739 (`737` F-6) — while one is in flight AND inside its
 * bound** (`A_COMMAND_IS_WAITED_ON_MS`): a go-ahead with no answer after it lights this button
 * again, so a second press can go out while the first is still out, and the host's guard is what
 * refuses it — the pane says the first has had no answer (`session-unanswered`).
 *
 * ⛔ **And the sign-in is the third, added by 149 (148 H2).** This button SENDS, so everything true
 * of the composer is true of it — and the composer is refused outright while the machine sign-in has
 * moved on. It stayed live because it reads composer AVAILABILITY rather than the composer's answer,
 * and the host let it through: the go-ahead was the one send path outside the gate, so pressing this
 * released the plan durably and then started a turn on the superseded child. The host refuses it now;
 * this keeps the user from having to learn that by pressing.
 */
const canGoAhead = computed(
  () => composerState.value === 'idle' && !props.record.busy && !signInSuperseded.value,
)

/**
 * 🔴 **739 · `737` F-6 — why the go-ahead is dark when no turn is running**: a command for this
 * conversation is still out (`busy`), for up to `A_COMMAND_IS_WAITED_ON_MS`. ⛔ The title said
 * *"Wait for the current turn to finish"* here too, over a conversation with no turn running.
 */
const GO_AHEAD_WAITS_FOR_AN_ANSWER =
  'Wait for what you just asked of this conversation to be answered, then start work.'

/**
 * Show the send reasons the window already knows, with closing before sign-in and attachments.
 * Frozen and ended states keep their own actionable hints. Busy sends use the same sign-in rule;
 * Stop is independent. The host remains the authority for facts this window does not hold.
 */
const sendBlocked = computed<SendBlock[]>(() => {
  // Every reason that holds, most important first: the composer shows the first and counts the rest.
  const reasons: SendBlock[] = []
  // ⚑ **D-017b · a message from here cannot continue it** — the host said so when it drew it
  // (another window has it open, or this app cannot start it again), in its own words.
  const cannot = props.record.meta?.cannotTakeAMessage ?? null
  if (cannot !== null) reasons.push({ words: cannot })
  // ⛔ **Closing outranks `frozen`** (234 §2, from `228` M2). ⚠️ **219 gated Send on
  // `closing` and left this line above it**, so a conversation closed with a card open kept the
  // frozen advice: *"answer the request above to continue"*, about a request `close()` settles at
  // teardown start (`settleRequests()`), in a conversation that is not going to continue. ⚑ The
  // same precedence argument this block already makes for the sign-in: a conversation on its way
  // out cannot be repaired by the remedy the state names, so naming it first would name a later
  // that does not exist.
  if (props.record.phase === 'closing') reasons.push({ words: CLOSING_BLOCK })
  if (composerState.value !== 'idle' && composerState.value !== 'busy') return reasons
  if (signInSuperseded.value) reasons.push({ words: SIGN_IN_SUPERSEDED_BLOCK })
  const command = aCommandInTheBox(props.draft, control.value.commands)
  if (command !== null && props.handing.staged.length > 0)
    reasons.push({
      words: aCommandTakesNoAttachmentsYet(command),
      fix: { label: 'Remove attachments', press: () => props.handing.stage([]) },
    })
  return reasons
})

/**
 * 🔴 **696 · `688` L1 — whether a message can be typed and sent here NOW**, for the one sentence that
 * tells a person to: a taken-back go-ahead's *"— type your next message to carry on"*
 * (`takenBackGoAheadsThatMayCarryOn`).
 *
 * ⛔ **Four facts, each one a way the instruction was false** (`696`'s review, two rounds): a
 * message from here cannot continue it (D-017b); it is `closing`; its sign-in was superseded, so no message can go out on
 * it until it is reopened; or the reader has scrolled back past a released slab, where a message the
 * person sent after the row sits in a part of the conversation this page does not hold. ⚑ Frozen is
 * not one: the card is answered, and then a message goes. ⚠️ **Asked of the facts, not of
 * {@link sendBlocked}**: that one answers *what the composer says*, and it says nothing of a
 * superseded sign-in while frozen — the card's advice outranks it there — though the sign-in still
 * holds every message back (round two). ⚠️ **Today that pair cannot meet** (round two's refuter): the
 * held go-ahead is Codex's (`endPlanMode` is a Codex-only path) and only Claude's adapter reports a
 * superseded sign-in. ⚑ The clause is kept because it is asked of the FACT, not of a provider — the
 * day either side widens, it holds without anybody remembering this paragraph.
 */
const canTakeAMessage = computed(
  () =>
    (props.record.meta?.cannotTakeAMessage ?? null) === null &&
    props.record.phase !== 'closing' &&
    !signInSuperseded.value &&
    props.record.window.atTail,
)

/**
 * ⛔ **Whether the turn can still be taken back — the composer's `interruptible`, supplied for the
 * first time** (234 §2, from `228` M2).
 *
 * ⚠️ **It was a DEAD PROP from 102/103 until this dispatch** (corrected in review — the first draft
 * said "since 094", which is the dispatch that added `frozen` to `canInterrupt`, not the one that
 * killed the prop). The LAUNCHER passed `interruptible: false` until 102 flipped it and 103 removed
 * it; from then nothing in `src` set it, so it was permanently `true` and two branches of the
 * composer's `canInterrupt` were unreachable. `composer-parity.test.ts` named it as such rather than
 * deleting it, on the grounds that 219 §4 scoped that dispatch to the send gate. ⚑ **This is the
 * caller it was waiting for.**
 *
 * ⛔ **Stop is the one control the sign-in block deliberately leaves lit** — interrupting needs no
 * credential — **and closing is not that case.** Teardown ends the running turn itself, and bounds
 * it (070); pressing Stop into a handle whose provider is already being stopped is a second way to
 * ask for a thing that is already happening, and it can come back as a session error from a handle
 * that has gone. ⚠️ Nothing is lost: Close is the stronger gesture and it is the one in flight.
 *
 * ⚑ **One computed, read by the button and by the key**, because `onKey` is the third stop
 * affordance and 094 is the dispatch about what happens when they are gated one at a time.
 */
const interruptible = computed(() => props.record.phase !== 'closing')

/**
 * 🔴 **730 · R83 — what the Stop control says while an ask to stop goes unanswered**, or `null`.
 * ⚑ Off {@link control} and never the reading window: it is a claim about NOW. ⚑ The provider off
 * the record's meta, as the transcript's cards name it (`725`, R73).
 */
const stopUnansweredWords = computed(() =>
  control.value.stopUnanswered === null
    ? null
    : stopJoinsThatAsk(
        control.value.stopUnanswered,
        props.record.meta?.provider ?? null,
        // ⚑ **737 · and which agent asked**, named as the notice names it (`734` F-2).
        props.identities ?? null,
      ),
)

/**
 * ⚑ **D-017 · R19 — the cards on the panel a PERSON owes an answer to**: all but those routed to
 * another conversation, which that one answers — the panel still lists them, and a person may still
 * answer them here.
 */
const cardsForAPerson = computed(() =>
  forAPerson(
    { permissions: panel.value.permissions.length, questions: panel.value.questions.length },
    control.value.routedAway,
  ),
)

/**
 * The agent, as the header's plate draws it (082).
 *
 * Built HERE because this is the only place that holds all three sources at once — the control
 * projection for what it is doing, the session's liveness for what it is, and the panel this
 * component already computed for what it needs. The header is handed the answer rather than half of
 * it plus a guess.
 *
 * ⚠️ **The NEEDING badge and the drawer's waiting BADGE are counted from different things, and that
 * is deliberate.** The count is `panel.waiting` — permissions and questions, the two that block —
 * and it is what 079 §5's attention guarantee is written about. `plan` is in here as well, because
 * a plan waiting for a go-ahead is genuinely waiting on you; it blocks nothing, so it must not
 * inflate a count that means "frozen", but a badge that shows it is more information, not less.
 */
const facetInput = computed<SessionFacetInput>(() => ({
  phase: props.record.phase,
  status: control.value.status,
  activity: control.value.activity,
  streaming: control.value.streamingId !== null,
  liveness: props.record.meta?.liveness.state ?? null,
  // `needingFor` returns undefined when nothing waits, and `sessionFacets` already drops an
  // undefined `needing` — so passing it straight through is the same object with less machinery.
  // ⚑ **D-017 · R19 — {@link cardsForAPerson}**, never the cards routed to another conversation.
  needing: needingFor({
    ...cardsForAPerson.value,
    planNeedsGoAhead: needsGoAhead.value,
  }),
  // ⚑ **D-017 · R19 — and a turn parked only on those is waiting on another conversation's answer**.
  parkedOnAnotherAnswer: parkedOnAnotherAnswer(cardsForAPerson.value, control.value.routedAway),
  // ⛔ **The fourth facet, from the SAME `control` every field above is read from** (250). The
  // registry this asks is the one {@link BackgroundBar} renders a few lines down in this very
  // template — so the pill above the conversation and the list above the composer are two readings
  // of one object rather than two opinions, which is the whole of 099.
  detached: somethingRunning(control.value.background),
  // Read scheduled state from the same `control.schedule` registry that {@link ScheduleBar} renders. Background work alone cannot identify a conversation that has a cron but nothing currently running.
  scheduled: scheduleHeld(control.value.schedule),
  // 🔴 **The SIXTH facet, and the only one on this list that is NOT read off `control`** (636) —
  // see {@link ConversationPane.waiting}. ⛔ It is what makes the header pill, the plate under the
  // avatar and the screen-reader sentence say something other than *idle* about a conversation
  // whose work is out with another agent — `HO-095` §5.1's three surfaces, two of which are drawn
  // from this one object.
  //
  // ⚠️ **`?? undefined`, because `null` is not a value this facet has.** The prop's `null` is
  // *nobody has looked*; the facet's absence is the same thing, and {@link sessionFacets} drops
  // an absent key rather than carrying it.
  waiting: props.waiting ?? undefined,
  // 🔴 **D-006 · the SEVENTH facet**, beside the sixth and on its `?? undefined` rule — so the pill
  // and the plate say *answered* or *not being worked on* about an idle agent's work.
  work: props.heldWork ?? undefined,
  // ⚑ **F036 · the EIGHTH facet** — another agent waits on its answer, as the host's state of it says.
  owes: whoItOwesIn(props.listedState),
}))

/**
 * ⚑ **D-017b · a view drawn from its ledger draws the host's state** ({@link listedState}), as its
 * row in the one list does: its own fold is a page, not the present, so it cannot tell a
 * conversation another window is working in from one nothing runs — and the plate saying *idle*
 * over a row saying *active* was one screen saying two things.
 */
const hostSays = computed((): AgentState | null =>
  props.record.phase === 'recorded' && props.record.agentState === undefined
    ? (props.listedState ?? null)
    : null,
)

const agentFacets = computed(() => ({
  ...(hostSays.value === null
    ? facetsForRecord(props.record, sessionFacets(facetInput.value))
    : // What it needs a person for is this view's own to say: the cards it holds open.
      facetsOfState(hostSays.value, sessionFacets(facetInput.value).needing)),
  // A pending launch is current even while the transcript still shows the previous turn.
  ...(props.launching === true ? { being: 'starting' as const } : {}),
}))

/**
 * ⚑ **D-017b · whose window takes this conversation's turns, when it is not this one** — see
 * {@link turnsTakenWithoutThisWindow}: its cards are answered there, and a message held in it goes
 * when its turn ends.
 */
const takenWithoutThisWindow = computed(() => turnsTakenWithoutThisWindow(props.record))

/**
 * ⚑ **D-017b · the settings are statements here** — a view drawn from its ledger whose settings the
 * host would not take (`CreatedSession.settingsFixed`): a window holds it, no message continues it,
 * or its messages go to the conversation continuing its job. ⚠️ A record that stopped and has not
 * been looked at again still holds the last life's `meta`, which says nothing: statements until it
 * is.
 */
const settingsFixed = computed(
  () => props.record.phase === 'recorded' && props.record.meta?.settingsFixed !== false,
)

/**
 * ⚑ **D-017 · R11 — this conversation's ONE state** (`stateHere`, `shared/agent-state.ts`) — what
 * it left running, when it next wakes, whose answer it waits on, who holds the work it gave out —
 * derived once, beside the facets, for the word under the plate: the rail row's word, and the one
 * `list_agents` reports.
 */
const agentState = computed(
  () =>
    hostSays.value ??
    stateForRecord(props.record, () =>
      stateHere(
        props.record,
        agentFacets.value,
        props.answerFrom ?? null,
        props.workWith ?? [],
        props.waitsBegan,
        props.stoppedWork ?? [],
      ),
    ),
)

/**
 * The pill's line, from the SAME input object the plate is drawn from (089).
 *
 * ⚠️ **One `computed`, read twice — not two readings of `control`.** The plate and the pill are six
 * inches apart on screen and answer the same question; building each from its own gathering of the
 * same fields is precisely how they came to disagree in the first place. Sharing the input makes
 * "the pill says a tool is running while the face says replying" unrepresentable rather than
 * merely fixed.
 */
const limitMinute = useMinuteClock()
/** "Still thinking (N min)." while the provider is silent after the model's reasoning, or `null`. */
const stillThinking = useStillThinking(() => {
  const said = props.record.meta?.liveness
  return said?.state === 'silent' && said.thinking === true ? said.since : null
})
const providerLimit = computed(() =>
  providerLimitDisplay(
    props.providerBlock !== undefined ? props.providerBlock : props.record.meta,
    agentFacets.value.needing === 'permission' ||
      agentFacets.value.needing === 'question' ||
      agentFacets.value.waiting === 'waiting-on-a-person'
      ? { is: 'needs-you' }
      : agentState.value,
    limitMinute.value,
  ),
)
const activity = computed(() => activityLine(facetInput.value))

/**
 * The status line's stamp. ⚑ **The rule lives in `lib/session-record.ts`, not here** — it is a derivation
 * over the record's two windows with a hazard in it, which is exactly the kind of thing that file
 * exists to hold where a test can drive it without a component (389 §3).
 */
const lastReport = computed<number | null>(() => lastReportAt(props.record))

/**
 * The right panel sits beside the conversation on its Open tab, where the card's large plate says
 * who the agent is, so the header leaves out its small one. Floating over a narrow pane, on another
 * tab or shut, the panel shows no plate there and the header keeps it.
 */
const theCardShowsTheAgent = computed(
  () =>
    props.drawerOpen &&
    props.record.meta !== null &&
    fit.value === 'docked' &&
    props.drawerTab === 'open',
)

// Bound rather than referenced in the template, because the copy is governed by a rule (see
// `lib/plan-mode.ts`) and a test that checks the rule has to be able to reach the strings.
const goAheadLabel = GO_AHEAD_LABEL
const goAheadNote = GO_AHEAD_NOTE
const goAheadMessage = GO_AHEAD_MESSAGE
const leavePlanLabel = LEAVE_PLAN_LABEL
const leavePlanTitle = LEAVE_PLAN_TITLE

/**
 * The pill's presence and text, handed to the transcript so it can re-pin when the pill takes or
 * gives back space beneath it (027). Its text is in here as well as its presence because a long
 * enough tool name wraps to a second line, which is the same problem one line further down.
 *
 * ⚠️ **It is no longer the whole footprint, and `520` is why** — see {@link paneFootprint}. The pill
 * is one of TWO things that can appear beside the scroll container; this computes the pill's half.
 */
const activityFootprint = computed(() => {
  const line = activity.value
  return line ? `${line.doing}:${line.detail ?? ''}` : ''
})

/**
 * 🔴 **Everything that can appear BESIDE the scroll container, as one string** (520, on 027's rail).
 *
 * ⛔ **027's mechanism, generalised to the category rather than to the pill.** Its own comment in
 * `TranscriptView` states the rule: *"the activity pill is a SIBLING of this scroll container, not a
 * child: when it appears, this element loses ~28px of height while `scrollTop` stays put, and a
 * reader pinned to the bottom silently loses the last line to the fold."*
 *
 * ⚑ **One footprint and not two props**, because the transcript's question is *did anything beside
 * me change size*, and two signals would be two answers to it — `169` §1, on a rail rather than on
 * copy. A third such sibling joins this string; it does not get its own channel.
 */
const paneFootprint = computed(
  () =>
    // ⚑ 739 review — the no-answer line (`session-unanswered`) is a third sibling that takes height,
    // and on a TIMER: a reader pinned to the bottom stays pinned when it appears.
    `${activityFootprint.value}|${props.record.unanswered > 0 ? 'unanswered' : ''}`,
)

/**
 * Take the reader to what the panel just named (037) — **and to what Attention just named** (236 §2).
 *
 * The transcript owns the scroll container, so it owns the scroll: this only forwards the id.
 *
 * ⛔ **The boolean is now RETURNED rather than dropped, because it has a caller that cares** (236
 * §2, from 231 #5). The panel's Navigate does not: it disables a row it cannot reach, so a miss can
 * only be the frame between that render and the click. The overview's Open is the opposite case —
 * it arrives from a surface that is not this conversation, having just switched to it, and *"the
 * card is not in the part of this conversation on screen"* is a real outcome a person has to be
 * told about rather than left to discover by scrolling.
 *
 * ⚠️ **Exposed, and it was not before.** `205` wrote {@link focus} for exactly this and wired only
 * the panel's half; `<script setup>` exposes nothing by default, so `RuntimeScreen` could not have
 * called it even if `openRequest` had carried the id — which it also did not. Two halves, each
 * looking like the other one was there.
 */
const view = ref<InstanceType<typeof TranscriptView> | null>(null)

const main = ref<InstanceType<typeof ConversationMain> | null>(null)

function focus(itemId: string): boolean {
  // ⚑ **A row is shown IN the conversation**, so a press from the right panel while the main panel
  // shows the graph brings the conversation back first — and scrolls once it is drawn, since a
  // hidden row is found but cannot be scrolled to.
  const found = view.value?.focusItem(itemId) ?? false
  if (main.value?.showConversation() === true && found)
    void nextTick(() => view.value?.focusItem(itemId))
  return found
}

defineExpose({ focus })

/**
 * Where a card keeps what the reader has done with it (064).
 *
 * On the RECORD, not in the card, so it survives the re-mount a re-fold causes — see
 * `SessionRecord.requests`. Bound as a function rather than the map itself because the entry is
 * made on first sight, and the record is the thing that owns it.
 */
function draftFor(requestId: string): RequestDraft {
  return requestDraft(props.record, requestId)
}

const overlays = reactive(useConversationOverlays(props, transcript))

/**
 * 🔴 **F093 (C9 d) · what the model got with one message**, for the switch under each message here
 * and in the popup's Per message tab — this pane is what knows the session.
 */
provide(READ_WHAT_THE_MODEL_GOT, (ordinal: number) => {
  const sessions = signInClient.sessions
  const read = sessions?.whatTheModelGot
  if (read === undefined) return Promise.reject(new Error('This window cannot read it.'))
  return read.call(sessions, props.record.sessionId, ordinal)
})

/**
 * 🔴 **The resource a person opened off a work report** (510) — ⚑ **and since `640` the
 * state, the host and the panel are one component for the whole app**,
 * {@link CanonicalDocumentOverlay}.
 *
 * ⚠️ **The `067` guard did not go away; it moved and generalised.** This pane is reused across
 * conversations without a `key`, so a file opened in one must not float over the next — that
 * is the overlay's `scope`, handed `props.record.sessionId` where it is mounted. ⛔ A fourth
 * surface now inherits the fix instead of re-deriving it, which is what `562` §6 boarded.
 */
const documentOverlay = ref<InstanceType<typeof CanonicalDocumentOverlay> | null>(null)

/**
 * ⚑ **640 · may this surface open a document — ASKED, not decided here.**
 * {@link aSurfaceMayOpenADocument} holds the rule for the whole app; before the fold each of the
 * three surfaces spelled it out for itself, and the room spelled it four times in one element.
 */
const mayOpenADocument = computed(() => aSurfaceMayOpenADocument(props.onReadResource))

/** The paths this conversation's messages name, as main answers for them. */
const messagePaths = useClientMessagePaths(() => props.record.sessionId)

/** Open the named resource through the existing document overlay. */
async function openResource(resourceId: string): Promise<void> {
  // ⚑ **UI-002 · with the row it was pressed from**, where the tree or the card read one — so the
  // viewer's header can say its title, who, for which piece and when (`07` §3).
  const row =
    treeFiles.value?.files.find((file) => file.resourceId === resourceId) ??
    cast.cardFiles.value?.files.find((file) => file.resourceId === resourceId) ??
    null
  await documentOverlay.value?.open(resourceId, row)
}

async function refreshChildWork(): Promise<void> {
  const read = props.onReadChildWork
  const open = overlays.readingChild
  if (!read || !open || open.agentId === null) return
  const result = await read({ part: 'transcript', agentId: open.agentId })
  const still = overlays.readingChild
  if (!still || still.sessionId !== open.sessionId || still.agentId !== open.agentId) return
  overlays.readingChild = { ...still, result }
}

/**
 * Esc asks a running turn to stop — the composer says so, and the input is the provider's. ⚑ While
 * an ask the provider has not answered stands, the host joins the press to it (`730`, R83) — except
 * while a card is up (`frozen`), where the press is a new ask that settles the card: the key sends
 * the same `interrupt` either way, and the composer's words say what it does
 * ({@link stopUnansweredWords}, drawn only while `busy`).
 *
 * ⚠️ **`frozen` as well as `busy` since 094.** This was the third affordance gated on `busy`
 * alone; the composer's stop button was the other two. With a card open there was therefore no
 * key, no button and no way at all to stop the turn short of closing the conversation.
 *
 * ⛔ **And it asks {@link interruptible} as well, since 234 §2** — the prop this pane now supplies,
 * so the key and the composer's `canInterrupt` are gated by one fact instead of the key being the
 * affordance that kept working after the other two went.
 *
 * ⚠️ **The sentence that used to be here said the launcher's composer *"is a different
 * component"*, and it is the same one** (217 §9 c, corrected by 219 §3). Both surfaces mount
 * `PromptComposer`; what differs is what each hands it, which is asserted rather than described —
 * see `composer-parity.test.ts`.
 */
const modalDepth = useModalDepth()

function onKey(event: KeyboardEvent): void {
  // Escape belongs to the open viewer, including one raised outside this pane.
  if (
    modalDepth.value > 0 ||
    overlays.openFor ||
    overlays.outputFor ||
    overlays.childFor ||
    overlays.answerFor
  )
    return
  if (event.key !== 'Escape') return
  if (composerState.value !== 'busy' && composerState.value !== 'frozen') return
  // ⛔ **The same fact the button reads** (234 §2). A key that still stopped the turn while the
  // button had gone would be 094's finding upside down — one affordance gated and the others not.
  if (!interruptible.value) return
  event.preventDefault()
  emit('interrupt')
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <!-- Put the reading theme on the whole pane, including the drawer, so the conversation body, adjacent panel, overlay scrim and image viewer share a coherent surface.

       So the attribute is back where 022 put it, and everything inside the pane inherits it.

       Keep the boundary fixed on the light chat theme: bodies use light surfaces while the header and left menus remain dark chrome. There is no reading-theme toggle to supply a value. -->
  <section
    class="conversation-pane bb-conversation-ground"
    data-cy="conversation-pane"
    :data-session-id="props.record.meta?.sessionId"
    data-chat-theme="light"
  >
    <SessionHeader
      :session="props.record.meta"
      :status="control.status"
      :drawer-open="props.drawerOpen"
      :waiting="panel.waiting"
      :facets="agentFacets"
      :provider-limit="providerLimit"
      :waits-on-purpose="waitsOnPurpose"
      :own-wait="ownWait"
      :capabilities="props.capabilities"
      :tools="control.tools"
      :named="props.named ?? null"
      :identity="props.identity"
      :open-task="showTaskSection"
      :rename="props.rename"
      :archive="props.archive"
      :activity="activity"
      :last-report-at="lastReport"
      :plate="!theCardShowsTheAgent"
      @hand-back="emit('handBack')"
      @delete="emit('delete')"
      @toggle-drawer="emit('toggleDrawer')"
      @open-tools="overlays.toolsFor = props.record.sessionId"
    />

    <!-- ⛔ **The shared shelf** (389 §3) — a `flex: 0 0 auto` sibling of `.pane-body`, so it spans
         the transcript AND the companion and takes no horizontal pixels from either. ⚠️ `v-if` on
         `meta`: before the host describes the conversation, the header's *"Starting…"* says it. -->
    <SessionShelf v-if="props.record.meta" :facets="agentFacets" />

    <div class="pane-body" ref="paneBody" :data-drawer="props.drawerOpen" :data-fit="fit">
      <!-- Put the conversation in the main panel's slot while retaining these bindings here; the right panel is its sibling. -->
      <ConversationMain
        ref="main"
        class="pane-main"
        data-cy="reading-surface"
        :conversation="props.record.sessionId"
        :forest="props.forest ?? null"
        :forest-pending="props.forestPending"
        :forest-error="props.forestError"
        @refresh-forest="emit('refreshForest')"
        :files="treeFiles"
        :can-open-document="mayOpenADocument"
        @open-document="(resourceId) => void openResource(resourceId)"
        @open-conversation="(sessionId, briefOf) => emit('openConversation', sessionId, briefOf)"
        @select="
          (conversation) => {
            // ⛔ The one on screen is selected already: asking the door again would re-read a
            // recorded conversation's page and drop the history loaded above it.
            if (conversation !== props.record.sessionId) goToConversation(conversation)
            showTheBand()
          }
        "
      >
        <!-- ⛔ **KEYED by conversation** (299 §2, from 297 finding 3) — the third component in this
             app to need it and the one nobody keyed. `RuntimeScreen` reuses this pane when the
             active conversation changes, so `useStickToBottom`'s `let stuck` came across with it:
             scroll up in a finished thread A, click B in the rail, and B opens parked at A's pixel
             offset and **silently stops following its own newest line — permission cards included —
             for the life of the mount**. That is verbatim the failure `useStickToBottom.ts:4` names
             as the composable's reason to exist.
             ⚑ **`SessionDrawer` keys `EventStream` for exactly this** (292 §4, from 288 M2) and the
             composer below is keyed for the IME version of the same class. `stuck` is a closure
             local with one writer and no setter, so a rebuild is the only reset. The offset AND
             the follow must be forgotten; `SessionDrawer` says why listing just one falls short. -->
        <TranscriptView
          :key="props.record.sessionId"
          ref="view"
          :items="transcript.items"
          :session-id="props.record.sessionId"
          :queued-disclosures="props.record.meta?.queued ?? null"
          :limit-now="limitMinute"
          :who="who"
          :own-agent="ownAgent"
          :identities="props.identities ?? null"
          :provider="props.record.meta?.provider ?? null"
          :can-recover-sign-in="
            signInRefused !== null &&
            props.record.phase !== 'closing' &&
            (props.record.meta?.cannotTakeAMessage ?? null) === null &&
            profileSignIn !== null &&
            canReopenSignIn &&
            control.ended
          "
          :sign-in-expired="signInNeeded"
          :sign-in-renewed="signInRenewedFor === props.record.sessionId"
          :recovering-sign-in="
            props.record.busy || signInSetup.busy.value || profileSignIn?.busy !== 'idle'
          "
          :held="props.held"
          :gave-out="gaveOut"
          :footprint="paneFootprint"
          :has-older="props.record.window.hasOlder"
          :turn-aligned="props.record.window.turnAligned"
          :load-older="props.onLoadOlder"
          :take-back="props.onTakeBack"
          :at-tail="props.record.window.atTail"
          :jump-to-latest="props.onJumpToLatest"
          :draft-for="draftFor"
          :tail-for="tailFor"
          :can-watch-commands="canWatchCommands"
          :can-open-store="true"
          :files="treeFiles?.files ?? null"
          :taken-in="takenIn"
          :can-open-document="mayOpenADocument"
          :output-capability="outputCapability"
          :background-output-capability="backgroundOutputCapability"
          :can-send-answers="canTakeAMessage && composerState !== 'frozen'"
          :can-stop-commands="canStopBackgroundWork"
          :stopping-call="stoppingCall"
          :can-read-tool-answers="canReadToolAnswers"
          :can-take-a-message="canTakeAMessage"
          :recorded="props.record.phase === 'recorded'"
          :taken-without-this-window="takenWithoutThisWindow"
          :can-answer-questions="true"
          :paths="messagePaths"
          :turn-running="control.status === 'working'"
          :still-thinking="stillThinking"
          :can-stop-turn="(composerState === 'busy' || composerState === 'frozen') && interruptible"
          @decide="(id, decision) => emit('decide', id, decision)"
          @move="(id, decision) => emit('move', id, decision)"
          @respond="(id, response) => emit('respond', id, response)"
          @take-it-over="emit('takeItOver')"
          @open-image="overlays.openImage"
          @open-conversation="(sessionId, briefOf) => emit('openConversation', sessionId, briefOf)"
          @open-document="(resourceId) => void openResource(resourceId)"
          @open-workflow-output="overlays.openWorkflowOutput"
          @open-child-work="overlays.openChildWork"
          @watch-command="onWatchCommand"
          @stop-command="(callId, key) => void onStopCommand(callId, key)"
          @open-tool-answer="(callId, name) => void overlays.openToolAnswer(callId, name)"
          @cancel-queued="(messageId) => emit('cancelQueued', messageId)"
          @stop-queued="(messageId) => emit('stopQueued', messageId)"
          @open-instructions="emit('showInstructions')"
          @restore-queued="restoreQueued"
          @send-answer="(text) => emit('send', text, 'now', [])"
          @sign-in="signInAgain()"
          @retry-sign-in="emit('reopenSignIn')"
        />

        <!-- This session's own failures, next to the session they belong to rather than at the top
             of the app, where they would be indistinguishable from another chat's. -->
        <p v-if="props.record.error" class="pane-error" data-cy="session-error">
          {{ props.record.error }}
        </p>
        <ProviderSetupProgress
          v-if="signInRefused && signInTarget === props.record.sessionId"
          :progress="signInSetup.state.value?.progress ?? ''"
          :auth-url="signInSetup.state.value?.authUrl ?? null"
          :error="signInSetup.error.value"
        />
        <button
          v-if="signInRefused && signInTarget === props.record.sessionId && signInSetup.busy.value"
          type="button"
          class="bb-button"
          @click="signInSetup.cancel()"
        >
          Cancel sign-in
        </button>
        <div
          v-if="profileSignIn && signInNeeded && !signInRefused"
          class="pane-sign-in"
          data-cy="pane-sign-in"
        >
          <SignInPanel
            :provider="props.record.meta!.provider"
            :display-name="providerName(props.record.meta!.provider)"
            :state="profileSignIn.auth"
            :sign-in="
              props.capabilities?.[props.record.meta!.provider]?.signIn ?? PENDING_CAPABILITY
            "
            :reprovision="
              props.capabilities?.[props.record.meta!.provider]?.reprovisionAuth ??
              PENDING_CAPABILITY
            "
            :busy="profileSignIn.busy"
            :notice="profileSignIn.notice"
            @check="profileSignIn.check(true)"
            @reprovision="profileSignIn.copyMachineSignIn()"
            @sign-in="profileSignIn.signIn()"
            @cancel-sign-in="profileSignIn.cancel()"
          />
        </div>
        <!-- 🔴 **739 · `737` F-6 — a command that has had no answer, said beside the failures**
             (rule 8.4): `busy` no longer counts it, so the controls it darkened are lit again —
             though an answer's own card keeps its buttons until the host answers, and the store
             still awaits it. Not a failure, so not drawn as one; it goes once every answer has come. -->
        <p v-if="props.record.unanswered > 0" class="pane-unanswered" data-cy="session-unanswered">
          {{ A_COMMAND_HAS_NOT_ANSWERED }}
        </p>

        <!-- The machine sign-in moved on without this conversation (147).

             ⚑ **It says what happened, what it costs, and offers the one thing that fixes it** — the
             three parts 106 requires of any control. The child holds a snapshot of the login it was
             launched with and can never refresh it, so a turn on the old one is refused rather than
             sent; this is where the user finds out, at the moment they try, with the way forward
             attached instead of a sentence pointing at the sidebar.

             ⚠️ **It does not name an account, because we do not know one.** The Keychain credential
             carries no identity (147 §1, re-measured 149 after 110 saw an `organizationUuid` that is
             no longer there) — a renewal and a deliberate switch look identical from here — so "you
             are now signed in as X" would be an invented fact, and 039 is what that costs. What we
             can say for certain is that it is not the one this conversation started on.

             Say that renewal counts as a sign-in change. Another client can renew the shared token without an account switch and revoke the credential held by this child; explain the refusal before the next answer fails.

             ⛔ **And a person's own turn is not taken on its own.** A resume settles every open card
             (`markReopened`), forgets this session's "allow for this session" grants, and cannot
             carry `ultracode` at all — costs the user never agreed to, imposed on a guess about
             which of two things happened. So the app tells, and the user presses — and while there
             is live work to lose, the button waits rather than offering to lose it (149, 148 M3).
             ⚑ What an agent or this app sends meanwhile is held, and the host reopens the
             conversation by itself for it once nothing would be lost (`reopenForWhatWaits`). -->
        <div v-if="signInSuperseded" class="sign-in-bar" data-cy="sign-in-superseded">
          <div class="sign-in-bar-lines">
            <p class="sign-in-bar-note">
              This conversation is holding {{ signInOf }} it started with, and that sign-in has
              changed since. No more turns can go out on the old one.
            </p>
            <p class="sign-in-bar-cost" data-cy="sign-in-cost">{{ signInBarCost }}</p>
          </div>
          <button
            class="sign-in-bar-button"
            type="button"
            :disabled="!canReopenSignIn"
            :title="
              canReopenSignIn
                ? 'Close this conversation and open it again on the current sign-in.'
                : signInBarCost
            "
            data-cy="sign-in-reopen-button"
            @click="emit('reopenSignIn')"
          >
            Reopen on the current sign-in
          </button>
        </div>

        <!-- What the agent is doing right now (027): above the composer, so it never fights the
             streaming caret and never pushes the conversation around as it changes. -->
        <ActivityPill :line="activity" />

        <!-- `AgentCard` draws background work and schedule bars from the same `control` projection and Stop gate the pane hands to the drawer. Template comments enter SSR markup, so keep them free of quoted runtime messages. -->

        <!-- The go-ahead (060). Beside the composer rather than attached to the plan document,
             because the plan is a transcript entry that scrolls away and this is a standing
             property of the conversation — it is true from the first frame, before any document
             has arrived, and stays true through every re-proposal until it is pressed.

             It is NOT a card and nothing waits on it: no turn is held open, no provider is
             blocked, and a session nobody ever presses it for runs to completion. That is what
             keeps it clear of 056's hazard, where a consent surface consulted above the
             auto-approve return silently stopped an unattended run. -->
        <div v-if="needsGoAhead" class="plan-bar" data-cy="plan-go-ahead">
          <p class="plan-bar-note">{{ goAheadNote }}</p>
          <button
            class="plan-bar-button"
            type="button"
            :disabled="!canGoAhead"
            :title="
              canGoAhead
                ? goAheadNote
                : signInSuperseded
                  ? 'Reopen this conversation on the current sign-in first.'
                  : composerState === 'idle'
                    ? GO_AHEAD_WAITS_FOR_AN_ANSWER
                    : 'Wait for the current turn to finish, then start work.'
            "
            data-cy="plan-go-ahead-button"
            @click="emit('endPlanMode', goAheadMessage)"
          >
            {{ goAheadLabel }}
          </button>
          <!-- The way out that is not an approval (085). Same command, same wire transition, no
               message — so it is NOT the "two controls that both mean stop planning" 076 forbids.
               It is the second OUTCOME of the one gesture, sitting where the first one already is.

               ⚠️ Enabled while a turn is running, unlike its neighbour, and the asymmetry is the
               point: that button SENDS and this one does not. Being made to wait for a turn to end
               before you may stop steering it is the opposite of leaving "at will". -->
          <button
            class="plan-bar-leave"
            type="button"
            :disabled="props.record.busy"
            :title="leavePlanTitle"
            data-cy="plan-leave-button"
            @click="emit('endPlanMode')"
          >
            {{ leavePlanLabel }}
          </button>
        </div>

        <!-- Keyed by conversation, so switching REBUILDS the field instead of re-pointing it.
             Keeping one textarea alive across a switch left one thing behind that the draft prop
             cannot reach: an in-progress IME composition. Vue's v-model refuses to write a new
             value into a composing field, then replays the composed text through whatever handler
             is bound when the composition ends — so a half-typed Japanese word begun in thread A
             committed into thread B's draft. The draft itself survives the rebuild because it
             lives in the book, not in here. -->
        <PromptComposer
          :key="props.record.sessionId"
          :state="composerState"
          :interruptible="interruptible"
          :who="who"
          :draft="props.draft"
          :submit="props.submit"
          :awaiting-send="props.awaitingSend"
          :blocked="sendBlocked"
          :handing="props.handing"
          :cwd="props.cwd"
          :can-attach="true"
          :has-queued="hasQueued"
          :stop-unanswered="stopUnansweredWords"
          @send="(text, intent, handed) => emit('send', text, intent, handed)"
          @interrupt="emit('interrupt')"
          @update:draft="(text) => emit('update:draft', text)"
        />
      </ConversationMain>

      <!-- One drawer with tabs (079/080, filled out by 087, 096 and 508). What still needs you,
           what you can change, what this conversation handed out, the raw stream and where it
           lives — beside the conversation rather than scrolled away inside it, and rendered from
           the CONTROL projection so scrolling into history never makes the controls disagree with
           the live session (064).
           ⚠️ **The count is gone from this sentence rather than corrected** (458's rule): a number
           in prose outlives the derivation that made it true, and this one had already said *six*
           through two dispatches that changed it. -->
      <SessionDrawer
        v-if="props.drawerOpen && props.record.meta"
        :title-history="props.titleHistory"
        :task-page-source="props.taskPageSource"
        :can-open-document="mayOpenADocument"
        @open-document="(resourceId) => void openResource(resourceId)"
        :session="props.record.meta"
        :approval-saving="props.record.busy"
        :state="control"
        :shown="transcript"
        :session-ref="control.ref"
        :status="control.status"
        :fixed="settingsFixed"
        :recorded="props.record.phase === 'recorded'"
        :pick-model="props.pickModel"
        :capabilities="props.capabilities"
        :waiting="panel.waiting"
        :facets="agentFacets"
        :agent-state="agentState"
        :provider-limit="providerLimit"
        :named="props.named ?? null"
        :work="props.work ?? null"
        :identities="props.identities ?? null"
        :own-wait="ownWait"
        :compaction="compaction"
        :tab="props.drawerTab"
        :fit="fit"
        @update:tab="(tab) => emit('update:drawerTab', tab)"
        @navigate="focus"
        @compact-now="(intent) => emit('compactNow', intent)"
        @open-asset="overlays.openImage"
        :on-reveal-path="props.onRevealPath"
        :on-read-config-file="props.onReadConfigFile"
        :can-stop-background-work="canStopBackgroundWork"
        :on-stop-background-work="props.onStopBackgroundWork"
        :on-open-run="overlays.openPanelRun"
        @refresh-config="emit('refreshConfig')"
        @open-instructions="overlays.instructionsFor = props.record.sessionId"
        @open-inputs="overlays.inputsFor = props.record.sessionId"
        @open-book="(profile) => emit('openBook', profile)"
        @set-approval-mode="(mode) => emit('setApprovalMode', mode)"
        @set-session-setting="(body) => emit('setSessionSetting', body)"
      />
    </div>

    <!-- One image, from either entrance (067). `OverlayHost` owns the chrome — Esc, the backdrop,
         the focus trap — so this is only the thing on it. -->
    <OverlayHost v-if="overlays.openFor" label="Image" @close="overlays.viewing = null">
      <ImageViewer
        :path="overlays.openFor.path"
        :prompt="overlays.openFor.prompt"
        @close="overlays.viewing = null"
      />
    </OverlayHost>

    <!-- What a workflow wrote (108), on paper with the Markdown/Raw toggle — 107 §4's ruling. Same
         `OverlayHost`, so there is one answer to "what does opening a thing do". -->
    <OverlayHost
      v-if="overlays.workflowFor || overlays.planFor || overlays.toolFor || overlays.backgroundFor"
      :label="overlays.workflowFor ? 'Workflow' : overlays.planFor ? 'Checklist' : 'Run'"
      @close="overlays.closePanelRun"
    >
      <SheetShell glyph="↳" style="--sheet-width: 780px" @close="overlays.closePanelRun">
        <template #header
          ><strong>{{
            overlays.workflowFor ? 'Workflow' : overlays.planFor ? 'Checklist' : 'Run'
          }}</strong></template
        >
        <template #body>
          <RunInput
            v-if="overlays.backgroundFor"
            :pending-output="
              transcript.background.running.some((work) => work.id === overlays.backgroundFor?.id)
            "
            :text="overlays.backgroundFor.run?.input"
            :progress="overlays.backgroundFor.run?.progress"
            :result="overlays.backgroundFor.run?.result"
          />
          <PlanEntry v-if="overlays.planFor?.kind === 'plan'" :item="overlays.planFor" embedded />
          <ToolEntry
            v-if="overlays.toolFor?.kind === 'tool'"
            :key="overlays.toolFor.callId"
            :item="overlays.toolFor"
            opened
            :tail="tailFor(overlays.toolFor.callId)"
            :can-watch="canWatchCommands"
            :output-capability="outputCapability"
            :background-output-capability="backgroundOutputCapability"
            :can-stop="canStopBackgroundWork"
            :stopping="stoppingCall(overlays.toolFor.callId)"
            :can-read-answer="canReadToolAnswers"
            :can-open-child="!!props.onReadChildWork"
            :can-open-output="!!props.onReadWorkflowOutput"
            @open-child="overlays.openChildWork"
            @open-output="overlays.openWorkflowOutput"
            @watch="onWatchCommand"
            @stop="onStopCommand"
            @open-answer="
              (callId, name) => {
                overlays.readingTool = null
                void overlays.openToolAnswer(callId, name)
              }
            "
          />
          <WorkflowEntry
            v-if="overlays.workflowFor"
            :run="overlays.workflowFor"
            opened
            :can-open-child="!!props.onReadChildWork"
            :can-open-output="!!props.onReadWorkflowOutput"
            @open-child="overlays.openChildWork"
            @open-output="overlays.openWorkflowOutput"
          />
        </template>
      </SheetShell>
    </OverlayHost>

    <OverlayHost
      v-if="overlays.outputFor"
      label="Workflow output"
      @close="overlays.readingOutput = null"
    >
      <WorkflowOutputViewer
        :result="overlays.outputFor.result"
        :workflow="overlays.outputFor.workflow"
        @close="overlays.readingOutput = null"
      />
    </OverlayHost>

    <!-- 🔴 **510 · the resource a work report names** — *"there is one answer to what does
         opening a thing do"*. ⛔ **640 · and the answer is now one COMPONENT rather than one
         panel mounted three times**: the host, the state and the `067` scope guard are
         `CanonicalDocumentOverlay`'s, and this pane names which conversation it is for. -->
    <CanonicalDocumentOverlay
      ref="documentOverlay"
      :read="props.onReadResource"
      :draw="props.onDrawResource"
      :reveal="props.onRevealResource"
      :scope="props.record.sessionId"
    />

    <!-- 🔴 **What tools this conversation has** (358), through the same host as the three viewers
         above it. ⛔ **The CONTROL projection, not the fold on screen**: the inventory is a fact
         about the session, and reading it off a transcript scrolled back into history would report
         what was true then. That is the same split `SessionDrawer` makes between `state` and
         `shown`, applied to a registry rather than to items. -->
    <OverlayHost
      v-if="overlays.toolsOpen"
      label="Inventory workbench"
      @close="overlays.toolsFor = null"
    >
      <SessionTools :tools="control.tools" @close="overlays.toolsFor = null" />
    </OverlayHost>

    <!-- 🔴 **The agent's side, wide** (`527` §3.3) — raised HERE with the pane's other sheets, so
         the pane, the transcript and the drawer all stay mounted underneath it. ⛔ **That is the
         whole of *"an index entry that opens wide satisfies both; a separate screen he has to
         navigate to does not"*** (`HO-050` §1.2): nothing routes, nothing unmounts, Escape and the
         backdrop close it, and `OverlayHost` gives focus back to the entry that opened it. -->
    <OverlayHost
      v-if="overlays.instructionsOpen"
      label="What this agent was told"
      @close="overlays.instructionsFor = null"
    >
      <AgentInstructionsSheet
        :instructions="overlays.instructionsOpen.instructions"
        :on-read-instruction="props.onReadInstruction"
        :on-reveal-path="props.onRevealPath"
        :tools="control.tools"
        :relaunched="props.record.liveFrom !== null"
        @close="overlays.instructionsFor = null"
      />
    </OverlayHost>

    <!-- 🔴 **F093 · everything this agent is given**, through the same host as the sheet above. -->
    <OverlayHost
      v-if="overlays.inputsOpen"
      label="Instructions, memory and tools"
      @close="overlays.inputsFor = null"
    >
      <AgentInputPopup
        :session-id="props.record.sessionId"
        :provider="overlays.inputsOpen.provider"
        :who="who"
        :profile="profileItRunsAs(overlays.inputsOpen)"
        :state="control"
        :start-loaded="controlHoldsTheStart(props.record)"
        @close="overlays.inputsFor = null"
      />
    </OverlayHost>

    <!-- What one tool answered (462), on the same paper and through the same host as the two above. -->
    <OverlayHost
      v-if="overlays.answerFor"
      label="Tool answer"
      @close="overlays.readingAnswer = null"
    >
      <ToolAnswerViewer
        :name="overlays.answerFor.name"
        :answer="overlays.answerFor.answer"
        :can-ask="canReadToolAnswers"
        :short-form="overlays.answerFor.shortForm"
        :call="overlays.answerFor.call"
        @close="overlays.readingAnswer = null"
      />
    </OverlayHost>

    <!-- What one sub-agent did (112), on the same paper and through the same host. -->
    <OverlayHost
      v-if="overlays.childFor"
      label="What a sub-agent did"
      @close="overlays.readingChild = null"
    >
      <ChildWorkViewer
        :result="overlays.childFor.result"
        :run="
          overlays.childFor.agentId
            ? transcript.subAgentCards.get(overlays.childFor.agentId)?.run
            : undefined
        "
        :label="overlays.childFor.label"
        :agent="overlays.childFor.agentId"
        :on-refresh="refreshChildWork"
        :on-read-state="onReadChildState"
        :on-send="onSendToChild"
        @close="overlays.readingChild = null"
      />
    </OverlayHost>
  </section>
</template>

<style scoped src="./ConversationPane.css"></style>
