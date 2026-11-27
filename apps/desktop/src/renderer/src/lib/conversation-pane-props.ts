import type { HandedPath } from '../../../shared/attachment-contracts'
import type { WhatAPickBecame } from '../../../shared/model-choice-contracts'
import type { AgentState } from '../../../shared/agent-state-contracts'
import type { ConversationWait, HeldWork } from '../../../shared/task-contracts'
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
import type { PickedModel } from './model-lists'
import type {
  ConversationIdentity,
  ConversationRenameInput,
  ConversationRenameResult,
} from '../../../shared/conversation-title'
import type { WorkThatNamesIt } from '../../../shared/piece-called'
// ⚑ **636 · a TYPE only** — see {@link ConversationPane.waiting}, which is narrowed before it
// arrives and is never derived here.
import type { WorkGivenOutReading } from './work-given-out'
import type { DraftHanding } from './drafts'
import type { DrawerTab } from './drawer'
import type { SessionRecord } from './session-record'
import type { ResourceDrawer, ResourceReader, ResourceRevealer } from './opening-a-document'
import type { SendIntent } from './session-store'
import type { ForestView } from './the-forest'
import type { TitleHistorySource } from '../components/ConversationTitleHistory.vue'
import type { TaskPageSource } from '../composables/useConversationTaskPage'
import type { ProviderBlockFacts } from './provider-limit-status'

/** What `ConversationPane` is handed (moved out of `ConversationPane.vue` unchanged). */
export interface ConversationPaneProps {
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
}

/** What `ConversationPane` tells its screen (moved out of `ConversationPane.vue` unchanged). */
export interface ConversationPaneEmits {
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
}
