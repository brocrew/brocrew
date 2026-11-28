<script lang="ts">
/** Where the words a launch was carrying end up. */
export type FirstMessageHome =
  /** Back on the page they were typed on — nothing opened to hold them. */
  | 'launcher'
  /** In the composer of the conversation that opened but did not manage to say them. */
  | 'conversation'
  /** Nowhere: they got out, or somebody else has already handed them back. */
  | 'nowhere'

/**
 * Decide where an unsent first message returns after opening and sending settle.
 * A cancelled launch without an error returns to the launcher; NewConversation.shouldRestoreDraft
 * handles failures with an error, so this function must not restore those words a second time.
 * Once a conversation opens, a refused first send returns its words and staged paths to that
 * conversation's composer. Keep the row live: closing it only leaves an ended row in the library.
 * The pane displays the refusal and lets the person send again, including attachment-only drafts.
 * This pure exported decision is covered by composer.render.test.ts outside Vue's async lifecycle.
 */
export function firstMessageBelongsTo(input: {
  /** The session that opened, or null for a launch that ended without one. */
  opened: string | null
  /** The launcher's error, or null — including for the ending nobody calls a failure. */
  launchError: string | null
  /** What the session said when the first message was refused, or null when it got out. */
  sendError: string | null
}): FirstMessageHome {
  // Nothing opened. `NewConversation`'s `shouldRestoreDraft` owns the ending that HAS an error and
  // has since 015; doing it here as well would write the same text twice, and the second write is
  // the one that could land over newer typing.
  if (input.opened === null) return input.launchError === null ? 'launcher' : 'nowhere'
  // A conversation opened. The words belong to it — it is the one that was going to say them — so
  // they come back in its composer rather than being dropped for having been in flight at the
  // wrong moment, and rather than being left on a launcher this launch has already emptied.
  return input.sendError === null ? 'nowhere' : 'conversation'
}

/**
 * # ⛔ Which profiles this screen may ask the providers about (257 §2)
 *
 * A model list is what a particular LOGIN may run, so the menu is per profile now — and this decides
 * which ones get asked. **Asking is a provider child process**, which is what makes the rule worth
 * writing down rather than inlining.
 *
 * ⛔ **Only profiles that EXIST.** The launcher's `+ New profile…` sentinel and a half-typed name are
 * both filtered out here, by membership rather than by knowing what the sentinel is — and that is not
 * merely tidy: on the host's side `prepareProviderHome` CREATES the home it probes, and for Codex
 * copies the machine credential into it. A screen that asked about every keystroke would bring
 * profiles into existence while somebody was still typing. The host refuses the same thing on its own
 * door; this is the near end of that rule.
 *
 * ⚠️ **Deduplicated**, because the launcher and the open conversation are usually the same profile
 * and asking twice in one tick is two children for one answer.
 *
 * ⚑ **Exported and pure for the reason {@link firstMessageBelongsTo} gives** — nothing mounts this
 * component, so a rule left inside the setup block is a rule no test can reach.
 */
export function profilesToProbe(input: {
  /** Every profile that exists, or `null` while the list has not arrived. */
  known: readonly string[] | null
  /**
   * The profile the front door will run as.
   *
   * ⚠️ **It was *"the launcher's current choice — a profile id, or its own sentinel for 'make a new
   * one'"*, and `417` removed both the menu and the sentinel** (HO-022 §2). The only value any
   * caller passes now is `DEFAULT_PROFILE_ID`. ⛔ **The membership filter below stays exactly as
   * it is**: it is this function's contract rather than a description of a menu, and what it
   * prevents — a provider home laid down (on Codex, with a copy of the machine credential) for an
   * id nobody has — is a cost the next caller can still incur.
   */
  launchChoice: string
  /** The open conversation's profile, or null when none is open. */
  openProfile: string | null
}): string[] {
  const known = input.known ?? []
  const wanted = [input.launchChoice, input.openProfile ?? '']
  return [...new Set(wanted.filter((id) => id !== '' && known.includes(id)))]
}
</script>

<script setup lang="ts">
import type { WhatAPickBecame } from '../../../shared/model-choice-contracts'
import type { HandedPath } from '../../../shared/attachment-contracts'
import { moveRequestFromWindow } from '../lib/move-request'
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUnmounted,
  ref,
  watch,
} from 'vue'
import type { AppInfo } from '@brobot2/shared'
import type {
  ChildWorkInput,
  ChildSendResult,
  ChildStateResult,
  ChildWorkResult,
  CommandTail,
  ToolAnswer,
  CreateSessionInput,
  PermissionDecision,
  Provider,
  ProviderCapabilityMap,
  ProviderProgram,
  ProviderVersion,
  UserInputResponse,
  ResourceReading,
  WorkflowOutputResult,
  InstructionSourceResult,
  RevealResult,
  ConfigFileResult,
  SessionPathTarget,
} from '../../../shared/runtime-ipc'
import { agentName, DEFAULT_PROFILE_ID, PROVIDER_NAME } from '../../../shared/runtime-ipc'
import { useAgentStore } from '../composables/useAgentStore'
import { NO_LAUNCH_CHOICES, type LaunchChoices } from '../lib/launch-choices'
import { pickInAConversation, type PickedModel } from '../lib/model-lists'
import { useModelLists } from '../composables/useModelLists'
import { useProfileSignIn } from '../composables/useProfileSignIn'
import { useClientApi, useClientProviders } from '../client-provider/injection'
import { desktopProviderApi } from '../client-provider/window'
import type { ClientDesktopApi } from '../../../shared/client-api'
import type { ClientScreenApi } from '../../../shared/client-screen-api'
import { oneReadAtATime } from '../lib/one-read-at-a-time'
import { handedBackSays } from '../lib/handing-it-back'
import {
  archiveConversation,
  dropTheirDrafts,
  lookingAfterTheyLeft,
} from '../lib/archive-and-delete'
import { profileItRunsAs, readableError } from '../lib/session-record'
import { takeBackThrough } from '../lib/take-back'
import {
  forgetPersistentPreference,
  usePersistentChoice,
  usePersistentToggle,
} from '../composables/usePersistentToggle'
import { DEFAULT_TAB, isDrawerTab, type DrawerTab } from '../lib/drawer'
import {
  attachmentsNotRestored,
  createDraftBook,
  draftKey,
  draftSlot,
  handRefusedBack,
  sweepDrafts,
} from '../lib/drafts'
import { newAgentDraftSlot } from '../../../shared/saved-drafts'
import { keepTheDraftBook, SAVED_DRAFTS } from '../lib/kept-drafts'
import { appClosing } from '../lib/app-closing'
import WaitingOnYou from './WaitingOnYou.vue'
import CanonicalDocumentOverlay from './CanonicalDocumentOverlay.vue'
import RecentActivity from './RecentActivity.vue'
import { usePersonsQueue } from '../lib/persons-queue'
// 🔴 **636 · the reading `621` built and left with no reader** — see {@link readWhatIsWaiting}.
// ⚠️ **This file is `631`'s and the edit is deliberately four small ones**; the response document
// names every line so the merge can be sequenced rather than discovered.
import { theWaitIn, theWorkIn } from '../lib/conversation-waits'
import type { ConversationIdentityBatchInput } from '../../../shared/conversation-title'
import { createFilesLibrary, provideFilesLibrary } from '../composables/useFilesLibrary'
import { createTeamProfileGraph, provideTeamProfileGraph } from '../composables/useTeamProfileGraph'
import FilesLibraryPreview from './FilesLibraryPreview.vue'
import { useOverlays } from '../lib/overlay-store'
import { useSessionStore } from '../composables/useSessionStore'
import { LAUNCHER, useSurface } from '../composables/useSurface'
import type { FirstMessageCameTo, LaunchDoor, SendIntent } from '../lib/session-store'
import AppTitleBar from './AppTitleBar.vue'
import ConversationPane from './ConversationPane.vue'
import MessageLinks from './MessageLinks.vue'
import LinkedHistory from './LinkedHistory.vue'
import type { WorkSearchQuery } from '../../../shared/work-search'
import { createMessageLinkResolver } from '../lib/runtime-message-links'
import IconSprite from './IconSprite.vue'
import NewConversation from './NewConversation.vue'
import { createLaunchGuard, saveFirstApproval } from '../lib/first-approval'
import { provideOverlayLayer } from './OverlayHost.vue'
import RuntimeOverlaySheets, { type SheetStart } from './RuntimeOverlaySheets.vue'
import ReadingPane from './ReadingPane.vue'
import SessionLibrary from './SessionLibrary.vue'
import SideRail from './SideRail.vue'
import { useRailFold } from '../composables/useRailFold'
import TeamWorkspace from './TeamWorkspace.vue'
import ToastStack from './ToastStack.vue'
import SettingsScreen, { type SettingsTab } from './SettingsScreen.vue'
import ProviderSetupAtLaunch from './ProviderSetupAtLaunch.vue'
import { useRuntimeNavigation } from '../composables/useRuntimeNavigation'
import { useRuntimeAttention } from '../composables/useRuntimeAttention'
import { useRuntimeScreenReadings } from '../composables/useRuntimeScreenReadings'
import { useRuntimeQueueActions } from '../composables/useRuntimeQueueActions'
import { provideConversationStars } from '../composables/useConversationStars'

/**
 * The app frame: a titlebar, the rail, and one surface.
 *
 * This is where "which conversation am I looking at" lives — and the only place it lives. The
 * store below holds every open session and knows nothing about the selection, so a conversation
 * you are not reading is still running, still receiving events, and still in the rail.
 *
 * The surface shows exactly one thing at a time: the conversation you picked, or an honest
 * placeholder for a destination that does not exist yet. It never shows a plausible-looking
 * dashboard — a fake surface inside a real app is worse than an empty one, because everything
 * around it is true.
 */
const client = useClientApi()
const { refresh: refreshConversationStars } = provideConversationStars(client.sessions, () =>
  say('Could not update star.'),
)
/**
 * The screen's runtime reads and intents, as the selected client gives them. A client supplied for
 * the providers alone has none of these, and the window's own adapter answers them, as before.
 */
function runtime(): ClientScreenApi {
  const api = client.screen ?? desktopProviderApi.screen
  if (api === undefined) throw new Error('The runtime is not available.')
  return api
}
/** The desktop-only operations (app info, navigation, drafts), when the client has them. */
function desktopIfAny(): ClientDesktopApi | undefined {
  return client.desktop ?? desktopProviderApi.desktop
}
function desktop(): ClientDesktopApi {
  const api = desktopIfAny()
  if (api === undefined) throw new Error('The desktop is not available.')
  return api
}
const resolveMessageLink = createMessageLinkResolver(client.sessions)
const store = useSessionStore()
/**
 * The overlay layer. It sits ON TOP of whatever surface is showing rather than being another value
 * of `place` — an overlay is a question about the thing behind it, and closing it has to give that
 * thing back exactly as it was.
 */
const overlays = useOverlays()

/**
 * The agent identities, read once and kept for the
 * life of the window.
 *
 * ⛔ **Not `RuntimeBridge.profiles()`.** That is a `readdir` of `provider-homes/` and it answers the
 * launcher's menu; this is the `agent_identity` rows a grant can name and `admitGive` refuses
 * against. The two disagree, deliberately, and `AgentIdentities.foldersWithoutARow` is where the
 * difference is reported rather than hidden.
 */
const agentStore = useAgentStore()
/**
 * ⛔ **An identity comes into being by a conversation RUNNING as it, so the list has to be re-read
 * when one starts** (355, review).
 *
 * `agent_identity` rows are written by `identityRowFor` on the session insert — that is criterion 12's
 * whole mechanism — so a person who types a new profile name into the launcher has created an
 * identity the rail could not show until the window was restarted. ⚠️ It is a cheap read and it is
 * not awaited: nothing on screen waits for it.
 *
 * 🔴 **534 · WHO calls it changed, and the sentence above did not.** It used to be called from
 * {@link start}, beside the one launch this window makes; it is now the `agents` reader of
 * {@link whenTheWorldMoves}, so it runs for every identity row this app writes — a launch under a
 * name nobody has used, a person's own Create, and `create_agent`, which
 * every agent may call. ⛔ **That last one is the caller the old placement could never have had**,
 * because no window performs it.
 */
function refreshAgents(): void {
  void agentStore.load()
}

/** Set the mode a person's next conversation opens in. */
async function setApprovalDefault(mode: 'ask' | 'auto'): Promise<void> {
  const refusal = await agentStore.setApprovalDefault(mode)
  if (refusal !== null) say(refusal)
}

/** The window's shared queue, used by Waiting on you and by the overlay. */
const persons = usePersonsQueue()

const rail = ref<InstanceType<typeof SideRail> | null>(null)
/** Whether the left menu is collapsed to its icons: by a press, or by a narrow window. */
const railFold = useRailFold()
/**
 * The Sessions page, when it is showing (151) — it re-reads its lists when the host says the
 * conversations moved, as the rail does.
 */
const library = ref<InstanceType<typeof SessionLibrary> | null>(null)
const libraryReveal = ref<{ entryId: string; visit: number } | null>(null)
let libraryVisit = 0
function revealLibraryEntry(entryId: string): void {
  libraryReveal.value = { entryId, visit: ++libraryVisit }
  place.value = 'sessions'
}

/** A recorded row from All conversations can anchor the palette after every row is archived. */
const librarySearchCaller = ref<string | null>(null)
/**
 * The conversation on screen, so {@link openRequest} can land on the card it was asked for (236 §2).
 *
 * ⚠️ **A ref rather than a prop, because the ask is an EVENT and not a state.** "Take me to this
 * card" happens once, at a click; a `focusItem` prop would have to be set, consumed and cleared,
 * and a second Open of the same card would set it to the value it already held and do nothing.
 */
const pane = ref<InstanceType<typeof ConversationPane> | null>(null)
/**
 * Which surface is on screen, and who may change it (095).
 *
 * ⚠️ **`place`, `activeId` and the follow-the-newest watch left this file together, and they had to
 * leave together**: the defect was in the relationship between them — the launcher being drawn by
 * `place: null` while the watch treated `place: null` as a gap to fill — and each of the three
 * reads as correct on its own. `useSurface` is where that relationship is now stated once, and
 * where it is tested without a browser.
 */
const screen = useSurface(store)
const { place, activeId, active, surface, view, showConversation } = screen
const settingsTab = ref<SettingsTab>('providers')
const setupProvider = ref<Provider | null>(null)
function openProviderSettings(provider?: Provider): void {
  setupProvider.value = provider ?? null
  openSettings('providers')
  void nextTick(() => {
    if (setupProvider.value === provider) setupProvider.value = null
  })
}

function openSettings(tab: SettingsTab = 'providers'): void {
  settingsTab.value = tab
  place.value = 'settings'
}
/**
 * Page the conversation on screen one window further back (054).
 *
 * Reads `activeId` at CALL time rather than closing over a record, so switching conversations while
 * a page is in flight cannot prepend one session's history onto another's — the store re-checks the
 * cursor for the same reason one layer down.
 */
/**
 * A person takes back the piece a service is on: the door's answer in words, or a refusal it threw
 * in the app's own sentence. The cast is read again, so the press goes once the piece has left.
 */
async function takeBackForAPerson(piece: string): Promise<string> {
  const said = await takeBackThrough(() => runtime().takeBackWork({ piece }))
  void readTheCast()
  return said
}

async function loadOlderForActive(): Promise<void> {
  const id = activeId.value
  if (id) await store.loadOlder(id)
}

/**
 * Read one instruction file the provider reported, for the conversation on screen (356 §2).
 *
 * ⚠️ **Nothing selected answers `no-source` rather than throwing**, on the same reasoning as its
 * neighbour: the row that raises this only exists inside a conversation, so this guards a future
 * caller rather than a case that fires today.
 */
async function readInstructionForActive(index: number): Promise<InstructionSourceResult> {
  const id = activeId.value
  if (!id) return { ok: false, reason: 'no-source' }
  return store.readInstructionSource(id, index)
}

/** Show one of the conversation's paths in the file manager (356 §1). */
async function revealPathForActive(target: SessionPathTarget): Promise<RevealResult> {
  const id = activeId.value
  if (!id) return { ok: false, reason: 'no-path' }
  return store.revealPath(id, target)
}

/** 🔴 733 · read one of the conversation's config files, by its name — the Info panel's Open. */
async function readConfigFileForActive(name: string): Promise<ConfigFileResult> {
  const id = activeId.value
  if (!id) return { ok: false, reason: 'no-path' }
  return store.readConfigFile(id, name)
}

/** Read a workflow run's output file for the conversation on screen (108). */
/**
 * 🔴 **Read one resource, by the id a work report names** (510; a resource since D-016).
 *
 * ⛔ **No session, and no `activeId` guard in front of it** — unlike every read beside it. A
 * resource id is a primary key in main's own table, so the answer does not depend on which
 * conversation is on screen; guarding on `activeId` would refuse a read that is perfectly
 * answerable and would make the press dead on a recording, which is the exact dead button `108`'s
 * review found on that pane.
 *
 * ⚠️ **No `say(readableError(cause))`.** Every read on this surface swallows the throw and returns
 * the union's least-claiming refusal, and the panel prints the sentence — `store.readResource`
 * answers `no-store`, which claims nothing about the row and nothing about the disk. ⛔ The error
 * line is for acts that CHANGE something and fail; a read that could not be asked is not one.
 */
/** The layer every open popup is drawn into, at the end of this screen's root. */
const overlayLayer = ref<HTMLElement | null>(null)
provideOverlayLayer(overlayLayer)

/** The document overlay a to-do's files open in. */
const todoDocument = ref<InstanceType<typeof CanonicalDocumentOverlay> | null>(null)

/**
 * A person answers a to-do through the store, which settles its card.
 * `null` when the host took the answer, else its words, and the look runs again so the row leaves.
 */
async function answerATodo(
  sessionId: string,
  request: string,
  done: boolean,
  note: string,
): Promise<string | null> {
  try {
    const ack = await store.answerAction(sessionId, request, done, note)
    void lookForWhatIsYours()
    return ack.outcome === 'taken' ? null : ack.reason
  } catch (cause) {
    return readableError(cause)
  }
}

async function readResourceForAnySurface(resourceId: string): Promise<ResourceReading> {
  return store.readResource(resourceId)
}

async function readWorkflowOutputForActive(taskId: string): Promise<WorkflowOutputResult> {
  const id = activeId.value
  // Nothing selected means nothing asked — the footer that raises this only exists inside a
  // conversation, so this is a guard against a future caller rather than a case that fires.
  if (!id) return { ok: false, reason: 'no-output' }
  return store.readWorkflowOutput(id, taskId)
}

/** Read what one sub-agent did, for the conversation on screen (112). */
async function readChildWorkForActive(what: ChildWorkInput): Promise<ChildWorkResult> {
  const id = activeId.value
  if (!id) return { ok: false, reason: 'unknown-agent' }
  return store.readChildWork(id, what)
}

/**
 * Ask what one child is doing, and say something to it (296) — one pair per surface, exactly as the
 * two readers above are.
 *
 * ⛔ **`not-live` is the honest answer when there is no id**, and it is a different word from the
 * readers' `unknown-agent` on purpose. A missing id here means no conversation is on screen, which
 * is a statement about this window rather than about the ledger — and `unknown-agent` would send a
 * reader looking for a child that had been lost.
 *
 */
async function readChildStateForActive(agentId: string): Promise<ChildStateResult> {
  const id = activeId.value
  if (!id) return { ok: false, reason: 'not-live' }
  return store.readChildState(id, agentId)
}

async function sendToChildForActive(agentId: string, text: string): Promise<ChildSendResult> {
  const id = activeId.value
  if (!id) return { ok: false, reason: 'not-live' }
  return store.sendToChild(id, agentId, text)
}

/**
 * Stop ONE piece of background work in the conversation on screen (248 §4).
 *
 * ⚠️ **It ANSWERS**, unlike the `interrupt` listener beside it, and that is the whole reason it is a
 * function rather than an emit handler: the registry disables the row's button while the request is
 * in flight and has to learn whether it landed, or a stop that failed leaves the only control for
 * still-running work reading *"Stopping…"* for ever.
 */
async function stopBackgroundWork(id: string): Promise<boolean> {
  const sessionId = activeId.value
  if (!sessionId) return false
  return store.stopBackgroundWork(sessionId, id)
}

/**
 * Read the output of a command while it is running.
 *
 * ⚠️ **The session is read at CALL time**, exactly as the stop above reads it, and the pane's own
 * watcher clears its follow when the conversation changes — so a read that crosses a switch lands in
 * a map that has already been emptied rather than under the wrong card.
 */
async function readCommandOutput(toolCallId: string): Promise<CommandTail | null> {
  const sessionId = activeId.value
  if (!sessionId) return null
  return store.readCommandOutput(sessionId, toolCallId)
}

/**
 * The whole of what one tool answered (462) — the read behind *"show me what it actually said"*.
 *
 * ⚠️ **The session is read at CALL time for the reason above it**, and the pane stamps the id it
 * captured onto the result, so an answer that lands after a conversation switch is hidden by the
 * pane's own guard rather than drawn under the wrong heading.
 */
async function readToolAnswer(toolCallId: string): Promise<ToolAnswer | null> {
  const sessionId = activeId.value
  if (!sessionId) return null
  return store.readToolAnswer(sessionId, toolCallId)
}

/** Put the conversation on screen back on the newest page of its ledger (054). */
async function jumpToLatestForActive(): Promise<void> {
  const id = activeId.value
  if (id) await store.jumpToLatest(id)
}

const onScreenNow = computed(() => (place.value === null ? activeId.value : null))
const {
  appElement,
  archiveKey,
  closeReading,
  conversationName,
  go,
  historyKey,
  historyMoved,
  linkedHistory,
  linkedIdentity,
  mainTab,
  olderLinkedHistory,
  onSideButton,
  openConversation,
  openFoundConversation,
  openMessageDestination,
  places,
  pressed,
  readFromTheLibrary,
  reading,
} = useRuntimeNavigation({
  store,
  agentStore,
  place,
  activeId,
  view,
  showConversation,
  settingsTab,
  openSettings,
  onScreenNow,
  runtime,
  resolveMessageLink,
  say,
})

function searchConversations(conversation: string, query: WorkSearchQuery) {
  return runtime().searchWork({ conversation, query })
}

function readRailIdentities(input: ConversationIdentityBatchInput) {
  return appClosing.value ? Promise.resolve([]) : runtime().readConversationIdentities(input)
}

let stopHearingNavigate: (() => void) | null = null

/**
 * 🔴 **What a new conversation will run on — resolved, not assumed** (423, HO-023 §3).
 *
 * ⛔ **`what the person asked for ?? BroBot's identity ?? the app frame's constant`** — which is
 * `admitGive`'s order with only the GIVER term removed, because a launch is the root of its own
 * chain. ⚑ **The first term arrived at `435`** (HO-025 §4): the front door draws a provider control
 * again, and what it writes is {@link launchChoices}`.provider`. The door still opens exactly one
 * identity — `DEFAULT_PROFILE_ID`, sent as `profileId` and used directly since `417` — so *"which
 * identity's preference applies"* has one answer and it is this one.
 *
 * ⚠️ **The SENTENCE and the PAYLOAD read the same value**, and that is the whole of why this is a
 * computed here rather than a resolution in the host. `NewConversation` renders
 * `providerIsFixed(props.defaultProvider)` and builds `{ provider: props.defaultProvider, … }` from
 * one prop; if the two could come apart, the screen would be able to name a provider the launch did
 * not use — and `417`'s sentence is load-bearing precisely because a person cannot change it
 * afterwards.
 *
 * ## 🔴 Where the identity's own answer can come from, measured rather than assumed
 *
 * 🔴 **This paragraph read *"on an app where a conversation has ever run, nothing a person can
 * press writes that column"*, and `433` built the press.** `setAgentProvider` is a person-only verb
 * and the capability sheet is where it is pressed, so an identity that already exists can now say
 * what its next conversation starts on. ⚠️ **The rest of the paragraph still holds and is what
 * makes the sentence a change rather than a contradiction**: a LAUNCH records no accident
 * (`identityRowFor` writes the identity's own seed, never the provider that launch used), the
 * capability writer's SET list is `CAPABILITY_COLUMNS` and provider is not one of them, and
 * `createAgentIdentity` answers null for a name that already exists.
 *
 * 🔴 **On an app where none has, it can — and `423`'s own gesture is how.** `agent_identity` is
 * EMPTY on a freshly migrated database: the one migration writes no row but the app-policy one.
 * ⚑ So a person who
 * opens the Team page's `New agent` before their first conversation can name `default`, choose a
 * provider, and decide what every conversation in that app runs on — which is exactly the answer
 * HO-023 §3 asked for, reachable in exactly one state. `NewAgent.vue`'s `namingBroBot` note is
 * where a person is told so, and `a-gesture-that-creates-an-agent.test.ts` §3 measures both halves.
 *
 * ⚑ **`423` deferred EDITING an identity that already exists — the state every used app is in —
 * and carried it as a finding. `433` is the dispatch that closed it**, with the verb HO-024 §2.2
 * called *required, not planned*: `setAgentProvider`, person-only, on this identity's own sheet.
 *
 * ## ⚠️ The window before the roster read lands
 *
 * `identities` is null until the unawaited read at `onMounted` answers, and in that window this
 * resolves to the constant for a reason other than *nobody has said*. ⛔ **It is a real window and
 * it is not closed here**: closing it means making the launcher wait on `agentStore.loaded`, which
 * would make a rail read a precondition for starting a conversation. ⚑ What it CANNOT do is make
 * the sentence disagree with the launch — both read this one computed, so they move together.
 *
 * 🔴 **And it MOVES under a mounted launcher, which `417` had been entitled to assume it could
 * not.** `NewAgent` is an overlay, a sibling of `<main>`, so `NewConversation` stays mounted while
 * a person creates `default` behind it — and `AgentStore.create` awaits its re-read, so this
 * recomputes with the launcher on screen. ⛔ `417` deleted `withAuthGesture`'s stamp on the
 * premise *"`props.defaultProvider` and `DEFAULT_PROFILE_ID` are both fixed for the life of this
 * surface"*; this dispatch falsifies that premise and puts the stamp back where it was removed.
 */
/**
 * 🔴 **The mode a conversation a PERSON starts begins in** (500, HO-036 §3.1) — *"a person sets
 * their approval mode once, and every conversation they start begins there."*
 *
 * ## ⛔ Resolved HERE, and that placement is the safety property rather than a convenience
 *
 * ⚑ **{@link frontDoorProvider}'s rule, one setting over:** *"the SENTENCE and the PAYLOAD read the
 * same value, and that is the whole of why this is a computed here rather than a resolution in the
 * host."* Both person-doors are handed this one value, so neither can show a mode its launch did
 * not use.
 *
 * 🔴 **And the half `frontDoorProvider` does not have to carry.** The default is spent ABOVE the
 * IPC boundary: it reaches a session only as an ordinary `approvalMode` on a `createSession` a
 * WINDOW sent. ⛔ **A give never crosses that boundary** — `agent-tools.ts` calls `host.giveWork`
 * in process — so nothing on the give path can read this, and `RuntimeHost` resolves the mode from
 * what its caller sent and from nothing else. ⚠️ **Resolving it in the host instead would have put
 * a person's preference in front of every give's value**, masked only by the coincidence that
 * `admitGive` always supplies one today.
 *
 * ⚠️ **`null` until the roster read lands, and the two doors send `'ask'` in that window** — the
 * same window {@link frontDoorProvider}'s docblock rules open on purpose, for the same reason:
 * closing it would make a policy read a precondition for starting a conversation. ⛔ What the
 * CONTROL does with that window is say so; what a LAUNCH does is take the word that keeps somebody
 * being asked.
 */
const frontDoorApproval = computed<'ask' | 'auto' | null>(
  () => agentStore.identities.value?.defaultApprovalMode ?? null,
)

const frontDoorProvider = ref<Provider | null>(null)
const frontDoorResolving = ref(true)
const frontDoorChoiceError = ref<string | null>(null)
let frontDoorChoiceRead = 0
let frontDoorChoicesAlive = true
onBeforeUnmount(() => {
  frontDoorChoicesAlive = false
  frontDoorChoiceRead++
})

/** Live roster names for the screen's attention and queue readers. */
function agentHeadingFor(profileSlug: string): string {
  // ⚠️ **The inner list, which is what `team-roster.ts` passes too** — `AgentIdentities` is the
  // whole reading and carries `use`, the folders and the registry beside the rows.
  return agentName(profileSlug, agentStore.identities.value?.identities ?? null)
}

/** The sheet owns its presentation; both launch doors still use the same start operation. */
const startFromSheet: SheetStart = async (input, firstMessage, attachments, told) => {
  await drafts.send(newAgentDraftSlot(input.profileId), () =>
    start(input, firstMessage, attachments, 'sheet', told),
  )
}

const notice = ref<string | null>(null)

const info = ref<AppInfo | null>(null)
const infoError = ref<string | null>(null)
const filesLibrary = createFilesLibrary({
  read: (request) => runtime().filesLibrary(request),
  workspace: () => info.value?.workspace.path ?? null,
  selected: () =>
    activeId.value === null ? null : { id: activeId.value, name: conversationName(activeId.value) },
})
provideFilesLibrary(filesLibrary)
const teamProfileGraph = createTeamProfileGraph({
  read: (request) => runtime().teamProfileGraph(request),
  workspace: () => info.value?.workspace.path ?? null,
})
provideTeamProfileGraph(teamProfileGraph)

/**
 * What each provider can do, as its adapter declares it (039).
 *
 * Fetched once at mount and held: it is a description of the build, not of a session, so it cannot
 * change while the window is open. `null` until it arrives — and `null` means **offer nothing**,
 * which is the only safe direction. A surface that guessed "probably available" during the fetch
 * would flash a control it might have to take away.
 */
const capabilities = ref<ProviderCapabilityMap | null>(null)

/**
 * The program each provider runs on this computer — one a person installed, or the copy BroBot
 * carries. Read at mount and
 * whenever the person moves between places, so a program installed or updated from the form's link
 * shows on coming back. Silent when the read fails: the Providers screen reads the same answer and
 * says why.
 */
const programs = ref<Partial<Record<Provider, ProviderProgram>> | null>(null)
let programsRead = 0
async function readProgramsOnce(): Promise<void> {
  const reading = ++programsRead
  const ask = runtime().providerVersions
  if (typeof ask !== 'function') return
  try {
    const versions = await ask()
    const found: Partial<Record<Provider, ProviderProgram>> = {}
    for (const [provider, version] of Object.entries(versions) as [Provider, ProviderVersion][]) {
      if (version.program !== undefined) found[provider] = version.program
    }
    if (reading === programsRead) programs.value = found
  } catch {
    // said on the Providers screen
  }
}
const readPrograms = oneReadAtATime(readProgramsOnce)
watch(place, () => void readPrograms())

/**
 * 🔴 **UI-012 · what each provider says it can RUN, per PROFILE** (257 §2) — the window's one holder
 * of D-042's lists (`lib/model-lists.ts`), which the model picker reads wherever it is drawn.
 *
 * A different kind of answer from `capabilities`, and held separately for that reason: capabilities
 * describe the BUILD and are free, this describes the PROVIDERS today and costs a probe each. ⚑ A
 * model list is what a particular LOGIN may run (`256` H1), so it is keyed by `provider:profile`
 * here and in the host — and ⛔ a credential gesture disowns a read still out for the old account
 * (293 §5, {@link authChangedFor}).
 */
const providerClient = useClientProviders()
const modelLists = useModelLists(providerClient)

const heldLaunchReadiness = computed(
  () =>
    Object.fromEntries(
      (Object.keys(PROVIDER_NAME) as Provider[]).map((provider) => [
        provider,
        modelLists.choices(provider)?.ready ?? null,
      ]),
    ) as Record<Provider, boolean | null>,
)

const launchReadiness = ref<Record<Provider, boolean | null>>(
  Object.fromEntries(
    (Object.keys(PROVIDER_NAME) as Provider[]).map((provider) => [provider, null]),
  ) as Record<Provider, boolean | null>,
)

/**
 * ⚑ **A person's pick in the open conversation, carried out** — see `pickInAConversation`.
 */
function pickModelForActive(pick: PickedModel): Promise<WhatAPickBecame | null | undefined> {
  const id = activeId.value
  return id === null ? Promise.resolve(undefined) : pickInAConversation(store, id, pick)
}

/** Refresh the profile's provider facts after a credential gesture settles. */
const authRefreshes = new Map<string, () => Promise<void>>()
function authChangedFor(profileId: string, changedProvider?: Provider): void {
  for (const provider of changedProvider
    ? [changedProvider]
    : (Object.keys(PROVIDER_NAME) as Provider[])) {
    modelLists.forget(profileId, { retainAnswered: true, provider })
    const key = `${provider}:${profileId}`
    let refresh = authRefreshes.get(key)
    if (!refresh) {
      refresh = oneReadAtATime(async () => {
        if (areActionableReadsClosed()) return
        await Promise.all([
          readPrograms(),
          useProfileSignIn(provider, profileId, providerClient).check(),
          modelLists.reread(provider),
          ...listsShown.value
            .filter((shown) => shown.provider === provider)
            .map((shown) => modelLists.read(shown.provider, shown.profileId)),
        ])
      })
      authRefreshes.set(key, refresh)
    }
    void refresh()
  }
}

/**
 * **Which profiles exist** (167) — the launcher's menu.
 *
 * ⚠️ **A startup read that is re-asked, and the reason is that it CHANGES.** `capabilities`
 * describes the build and is fixed for the life of the window. A profile comes into existence when a session is started in it, so a name typed into the
 * launcher is not in this list until the launch that created it has happened — see {@link start}.
 *
 * `null` until it arrives, which the launcher reads as "offer BroBot alone, and do not offer to make
 * a second one": the check against the names that already exist is what makes "new" a true word.
 */
const profiles = ref<string[] | null>(null)

async function refreshProfiles(): Promise<void> {
  try {
    profiles.value = await runtime().profiles()
  } catch {
    // Left as it was. A failed re-read must not take a menu away that is already on screen and
    // correct; the startup read below is the one whose failure is reported.
  }
}

/**
 * 🔴 **534 · the watch that used to be here is GONE, and the reason is a defect it could not see.**
 *
 * `151` wrote it: *"a closed conversation joins the reopen list, so both surfaces re-read when one
 * ends."* ⛔ **Two things were wrong with it and only the second is `534`'s report.**
 *
 *  1. ⚠️ **It fired TOO EARLY.** `store.live` drops a record when its `conversation_ended` event
 *     arrives, and the host's teardown runs after that: `stopProvider`, the terminal write, the
 *     archive, and only then `slots.delete`. So the re-read this watch provoked could land while
 *     the slot was still in the map, take `running: 'unwatched'` for a conversation that had
 *     ended, and draw it under *Not open in this window* — with nothing left to correct it.
 *  2. ⛔ **It only ever watched THIS window's own conversations**, which is the population the
 *     defect is not about.
 *
 * ⚑ **Both are closed by {@link whenTheWorldMoves}**: the host announces after the write, and it
 * announces for every conversation rather than for the ones this window happens to hold.
 */

/**
 * ⛔ **The reading light is not a preference any more (344), and this line is what makes that true
 * on a machine that already has one.**
 *
 * Remove the old per-machine reading-theme preference. Bodies now use light surfaces and the header and left menus use dark chrome, so there is no theme-toggle state to restore.
 *
 * ⚠️ **Deleting the READ is not enough by itself, and forgetting the key is not housekeeping.** A
 * machine that used the feature holds `"true"` or `"false"` under this name. Nothing reads it, so
 * it cannot pin a body dark today — but it is a live value under a name this app has stopped
 * meaning anything by, and the next preference that reaches for a near neighbour of it inherits a
 * decision somebody made about a control that no longer exists. It is removed once, on the first
 * render of the build that retired it, and a machine that never had it is untouched.
 */
forgetPersistentPreference('brobot2.chatLightTheme')
/**
 * Whether the drawer is showing, and which tab it is on (080).
 *
 * ## 🔴 **Open on first run since 385 §2, and it was shut from 080 to 384**
 *
 * Default the companion drawer to visible so available conversation facts appear without requiring the person to discover a toggle.
 *
 * ⚠️ **It changes what a FRESH profile sees and nothing else**, which is the whole of its blast
 * radius: `usePersistentToggle` reads storage first, so a machine that has ever pressed the toggle
 * keeps its own answer — including a machine that pressed it SHUT. ⛔ **The key is deliberately not
 * forgotten** the way `344` forgot `brobot2.chatLightTheme`: that key belonged to a control that no
 * longer exists, and this one belongs to a control that does. An app may seed a default; it does not
 * overwrite a choice a person made.
 *
 * ⚠️ **The attention model is what made the OLD default safe** (079 §5) — the count and the amber
 * status pill live outside the drawer, so a shut drawer hid the list and never the fact. ⚑ Opening
 * it does not spend that: those traces are still outside, and `conversation-chrome.test.ts` still
 * holds them for both states.
 *
 * A NEW key rather than `brobot2.sessionPanelOpen`: that one remembered whether a 300px panel was
 * open, which is a preference about a thing that no longer exists.
 */
const drawerOpen = usePersistentToggle('brobot2.drawerOpen', true)
const drawerTab = usePersistentChoice<DrawerTab>('brobot2.drawerTab', DEFAULT_TAB, isDrawerTab)

/**
 * Unsent text, one slot per conversation (019). It lives HERE because the composer is handed a
 * different conversation rather than rebuilt for each one — text the composer owned itself
 * followed you from thread to thread and could be sent to the wrong agent.
 *
 * Persist drafts across restart. The book remains the owner; `kept-drafts.ts` copies it to disk and restores the previous run below.
 */
/**
 * ⛔ **One book, and it owns the attachments too** (216 §2) — `drafts.paths`.
 *
 * ⚑ A message and the paths handed with it are one message, so there is deliberately no way to keep
 * one and forget the other: `keepOnly` prunes both. See {@link DraftBook.paths}.
 */
const drafts = createDraftBook()
/**
 * The SELECTED conversation's slot — which is what `ConversationPane` is bound to.
 *
 * ⚠️ **Not "the composer on screen", which is what this said and what it is not** (095, review). The
 * launcher binds itself to `draftSlot(null)` explicitly and always has; when the launcher is up,
 * this names the conversation waiting behind it. Both slots are kept alive below, so nothing was
 * ever lost by the wrong sentence — but a future reader trusting it would read the wrong draft.
 */
const draftKeyForActive = computed(() => draftSlot(activeId.value))

/**
 * ⛔ **The OTHER half of the launcher's unsent draft** (211 §1, from 210 finding 1) — provider,
 * profile, folder and every fine-tune setting.
 *
 * ⚑ **It lives here for exactly the reason the words above it do**: `NewConversation` is torn down
 * whenever a conversation is opened over it, so anything it owns is gone when you come back. 210
 * typed a prompt, chose Claude, chose the `field-notes` profile and a folder, looked at an existing
 * conversation and returned — to the prompt, under Codex, in BroBot's home, with a blank folder.
 *
 * ⚠️ **In memory, for this run of the app** — as `drafts` was until `744`, which keeps the WORDS and
 * paths across a restart (R100) and not these: this is a half-finished thought about a conversation
 * that has not started, not a preference to persist.
 */
/**
 * 🔴 **The OTHER half of the launcher's unsent draft, back at three fields** (435, HO-025 §4/§5).
 *
 * ## ⛔ The history, because both halves of it are load-bearing
 *
 * `211 §1` gave the launcher a whole-draft object because *"everything else the launcher decides —
 * which provider, which profile, which folder — lived in `ref`s inside `NewConversation.vue`, and
 * that component is torn down the moment a conversation is opened over it."* `210` typed a prompt,
 * chose Claude, chose the `field-notes` profile and a folder, looked at an existing conversation
 * and came back — to the prompt, under Codex, in BroBot's home, with a blank folder.
 *
 * ⚑ **`417` deleted `launchDraft` and `lib/launch-draft.ts` on a premise it had earned**: *"The
 * launcher decides nothing now, so there is nothing to carry."* ⛔ **HO-025 §5 falsified it** —
 * *"the front door asks nothing and OFFERS EVERYTHING"* — so the launcher decides three things
 * again, and `210`'s defect is reachable again the moment they live in the component.
 *
 * ## ⚠️ Three fields, and the shape is `LaunchChoices` rather than `211`'s eight
 *
 * ⛔ **The profile, the folder, the approval mode and the two fold flags are still not the front
 * door's to decide**, and a carrier with room for them is an invitation to put them back.
 * ⚑ **In memory, for this run of the app**, as `drafts` was until `744`: a half-finished thought about
 * a conversation that has not started, not a preference to persist. ⚠️ **R100 keeps the launcher's
 * words and paths across a restart and names nothing about these three**, so a person who restarts
 * finds their prompt again under the resolved defaults.
 *
 * ⚠️ **Not keyed, because there is one front door.** `drafts` is keyed because there is one slot per
 * conversation; this is one object because `NewConversation` renders under a `v-else` and there can
 * never be two of it.
 */
const launchChoices = ref<LaunchChoices>({ ...NO_LAUNCH_CHOICES })
async function resolveFrontDoor(): Promise<void> {
  const ours = ++frontDoorChoiceRead
  frontDoorResolving.value = true
  frontDoorChoiceError.value = null
  try {
    const answer = await modelLists.resolve({
      profileId: DEFAULT_PROFILE_ID,
      askedProvider: launchChoices.value.provider,
      providers: Object.entries(heldLaunchReadiness.value).map(([provider, ready]) => {
        const program = programs.value?.[provider as Provider]
        return {
          provider: provider as Provider,
          ready,
          program: program === undefined ? null : { standing: program.standing },
        }
      }),
    })
    if (frontDoorChoicesAlive && ours === frontDoorChoiceRead) {
      launchReadiness.value = Object.fromEntries(
        answer.readiness.map(({ provider, ready }) => [provider, ready]),
      ) as Record<Provider, boolean | null>
      frontDoorProvider.value = answer.provider
    }
  } catch (error) {
    if (frontDoorChoicesAlive && ours === frontDoorChoiceRead)
      frontDoorChoiceError.value = readableError(error)
  } finally {
    if (frontDoorChoicesAlive && ours === frontDoorChoiceRead) frontDoorResolving.value = false
  }
}
watch(
  [
    () => launchChoices.value.provider,
    heldLaunchReadiness,
    programs,
    () => agentStore.identities.value,
  ],
  () => void resolveFrontDoor(),
  { immediate: true, flush: 'sync' },
)

/**
 * A draft belongs to a conversation for as long as that conversation is open — OR for as long as
 * you are still reading it. Closing a conversation deliberately does not blank the pane
 * (`activeId` is keyed on the record existing, not on it being open), so cleaning up on openness
 * alone would delete a draft out from under someone still looking at the words. It goes when you
 * navigate away from a conversation you CLOSED.
 *
 * 🔴 **678 · R26 — and never through a REOPEN.** ⚠️ This said *"which is also the reopen rule: a
 * conversation you come back to starts empty"*, and `672` measured what that cost: a reopen from
 * the grant sheet closed a conversation that was not on screen and its words and attachments were
 * gone before it came back. ⚑ {@link closeAndReopen} now holds the slot through the gesture — see
 * `sweepDrafts`, which is this watcher, moved where a test can run it.
 *
 * ⛔ **One call prunes the drafts AND the paths handed with them** — see `DraftBook.paths` — and the
 * slots it keeps are still `liveDraftSlots`' (217): the launcher's is always among them.
 */
const draftSweep = sweepDrafts(
  drafts,
  () => store.live.value,
  () => draftKeyForActive.value,
  // ⚑ **D-017b · every conversation the one list names** — a stop ends nothing, so its words
  // survive a walk away for as long as it is listed.
  () => rail.value?.listedIds ?? [],
  // 🔴 **744 · a quit's own endings empty nothing** — see `sweepDrafts`' fifth door.
  () => appClosing.value,
)

/**
 * 🔴 **744 · R100 — the last run's drafts, back in their own slots BEFORE anything draws, and the
 * book kept on disk from then on** (`keepTheDraftBook`). `main.ts` read them before mounting, so the
 * restore is synchronous and every composer's first paint already carries its draft; the sweep
 * holds the conversations they belong to until each is OPEN in this window (`holdRestored`, the
 * hold a refused reopen gets) — never merely listed. ⛔ Nothing read means
 * nothing saved — a save writes the whole book, and one that never received the file's drafts would
 * erase them.
 *
 * ⚠️ **Stopped BEFORE the unmount, not after**: a hot reload mounts the next screen before
 * `onUnmounted` runs, and this one's last save has to reach main before that one asks for the book.
 */
const draftKeeping = keepTheDraftBook({
  book: drafts,
  sweep: draftSweep,
  handoff: inject(SAVED_DRAFTS, null),
  bridge: desktopIfAny(),
  closing: () => appClosing.value,
})
onBeforeUnmount(draftKeeping.stop)

/**
 * **The profiles actually on screen** — the launcher's choice and the open conversation's own (257 §2).
 *
 * ⚠️ **Declared here rather than beside {@link modelLists}** — it reads `active`, and a watcher with
 * `immediate` runs during setup, so it has to come after the ref it watches exists. The RULE is
 * {@link profilesToProbe}, exported, because nothing mounts this component.
 */
const shownProfiles = computed<string[]>(() =>
  profilesToProbe({
    known: profiles.value,
    // ⛔ **The front door's one profile, not a choice** (417) — it no longer has a menu, and this
    // probe is what `CredentialWhen.existing` means by *"this screen asking the provider which
    // models it can run"*. ⚑ Unchanged on the wire: an untouched launcher started on `default`
    // before, so the same one child is spawned on mount and the open conversation's own menu is
    // warm the moment it opens.
    launchChoice: DEFAULT_PROFILE_ID,
    // ⚑ **D-017b** — no profile for a conversation this app ran as nobody: its models are nobody's.
    openProfile: profileItRunsAs(active.value?.meta ?? null),
  }),
)

/**
 * ⚑ **UI-012 · the lists those profiles' pickers read, warmed once** — BroBot's for both providers
 * (the new-conversation form lists both, the same two children the screen asked for before), and
 * the open conversation's for ITS provider only: a conversation cannot change provider (`09` §2).
 */
const listsShown = computed(() => {
  const open = active.value?.meta ?? null
  return shownProfiles.value.flatMap((profileId) =>
    profileId === DEFAULT_PROFILE_ID
      ? (Object.keys(PROVIDER_NAME) as Provider[]).map((provider) => ({ provider, profileId }))
      : open === null
        ? []
        : [{ provider: open.provider, profileId }],
  )
})

watch(
  listsShown,
  (shown) => {
    for (const { provider, profileId } of shown) {
      void modelLists.read(provider, profileId, { once: true })
    }
  },
  { immediate: true },
)

function say(message: string): void {
  notice.value = message
  window.setTimeout(() => (notice.value = null), 2600)
}

/**
 * Put a refused message back, and say so if the ceiling kept part of it out (236 §5).
 *
 * ⚠️ **The MERGE is the book's and the SENTENCE is this screen's**, because those are the two things
 * each of them owns: nothing in this repository mounts `RuntimeScreen`, so every rule that can live
 * in `drafts.ts` does — including the wording, which is why this is three lines rather than thirty.
 */
function restoreRefused(slot: string, text: string, attachments: HandedPath[]): void {
  const refused = handRefusedBack(drafts, slot, text, attachments)
  if (refused > 0) say(attachmentsNotRestored(refused))
}

/**
 * ⚑ **718 · what {@link start} tells the surface that pressed** — the sheet's two moments
 * ({@link RuntimeOverlaySheets}): the conversation opened, or THIS launch was refused, in the host's words.
 */
interface LaunchTold {
  navigated?(): void
  opened?(): void
  refused?(
    sentence: string,
    reason: import('../../../shared/runtime-ipc').LaunchRefusal | null,
  ): void
}

/**
 * Start a conversation, and say the first thing in it.
 *
 * The message is sent AFTER the session is open, through the same path every later turn takes —
 * there is no "first message" special case in the store or the host, and the transcript records
 * this turn exactly like the ones that follow it.
 */
const frontDoorLaunch = createLaunchGuard()

async function startFromFrontDoor(
  input: CreateSessionInput,
  firstMessage: string,
  attachments: HandedPath[] = [],
): Promise<void> {
  await drafts.send(draftSlot(null), async () => {
    let accepted = false
    await frontDoorLaunch.run(async (release) => {
      accepted = await start(input, firstMessage, attachments, 'front-door', { navigated: release })
    })
    return accepted
  })
}

async function start(
  input: CreateSessionInput,
  firstMessage: string,
  attachments: HandedPath[] = [],
  door: LaunchDoor = 'front-door',
  told: LaunchTold = {},
): Promise<boolean> {
  const from = view()
  const sessionId = await store.create(input, door, told.refused)
  if (!sessionId) return false
  if (door === 'front-door') {
    const refusal = await saveFirstApproval(
      sessionId,
      input.approvalMode,
      agentStore.identities.value?.defaultApprovalModeChosen,
      (mode) => agentStore.setApprovalDefault(mode),
    )
    if (refusal !== null) {
      store.noteLaunchFailure(refusal)
      return false
    }
  }
  told.opened?.()
  showConversation(sessionId, from)
  told.navigated?.()
  // 🔴 **UI-012 · R-1 — a launch spends the form's pick**: the host made it the last pick, which the
  // form starts on from now (`09` §8), and a pick still held here would outrank every later one —
  // a drawer's or a sheet's too. ⚑ The provider stays: a Codex pick chose Codex.
  if (door === 'front-door') {
    launchChoices.value = { ...launchChoices.value, model: '', reasoningEffort: '' }
  }
  // ⚑ **A launch is what CREATES a profile** (167) — `prepareProviderHome` lays the home down the
  // first time a session runs in it — so this is the moment the menu can be stale. Not awaited: the
  // first message is what the user is waiting on, and a directory listing must not sit in front of
  // it. Unconditional rather than "only when a new name was typed": this surface does not know
  // which of the two the launcher did, and asking again costs one `readdir`.
  void refreshProfiles()
  // ⛔ **The first message carries what was attached to it** (217). `013` makes this the FIRST
  // turn, and it goes through the same `store.send` every later turn does — so the composition and
  // the disclosure `216` built are already here, and what was missing was only the carriage.
  const accepted = await store.send(sessionId, firstMessage, 'now', attachments)
  // ⛔ **The session opened and its first message did not get out** (221 §2). The conversation is
  // kept — see {@link firstMessageBelongsTo} for why closing it would replace a row you can act on
  // with one you cannot — and the words come back in ITS composer, one press from going out.
  const home = firstMessageBelongsTo({
    opened: sessionId,
    launchError: null,
    sendError: store.get(sessionId)?.error ?? null,
  })
  if (home === 'conversation') restoreRefused(draftKey(sessionId), firstMessage, attachments)
  return accepted
}

/**
 * 🔴 **Hand the open conversation back to nobody** (523 — `519` item 3, HO-045 §1).
 *
 * ⚑ **D-017b · the view stays**: `store.release` lets go of the conversation only after the host
 * agrees and then looks at it again, so it is drawn from its ledger — this window no longer holds it
 * — and a press on it, or a message sent from it, takes it back.
 *
 * ⚑ **What is said afterwards is computed from the host's answer** (standing rule 18): `handedBackSays`
 * reads `ReleasedSession`, so a release that did not take reports that it did not take. ⛔ **And the
 * refusal is shown rather than swallowed** — `overlays.notify` is the lane that paints above the
 * modal host, for the reason {@link reopenForGrant} states one function down.
 */
async function handBack(sessionId: string): Promise<void> {
  try {
    // ⚑ **What is SAID is computed from the host's answer**, never from the fact the call resolved
    // (standing rule 18): `handedBackSays` reads `ReleasedSession.running`, which the host measured
    // off its slot map after the write — so a release that did not take reports that it did not.
    say(handedBackSays(await store.release(sessionId)))
  } catch (cause: unknown) {
    // ⛔ **A refusal is SAID, not swallowed** — a press was made, and the sentences are the host's own: *"you started this conversation"*, *"it belongs to another window"*.
    say(readableError(cause))
    return
  }
  // 🔴 **534 · the two reads that were here have been retired**, and the sentence they carried was
  // false as well as redundant: it said the conversation would be *"listed nowhere until the next
  // poll"*, and there has never been a poll on either list. ⛔ **`RuntimeHost.release` announces**,
  // and it announces from the one method the deliberate hand-back and the departed window share —
  // so the row comes back into the running list for both, rather than for whichever caller
  // remembered to ask.
}

/**
 * Conversations left this window's lists: archived, or their records deleted. A view of one of
 * them closes as a view closes when its conversation stops existing, and the store lets each go.
 * The rule is `lookingAfterTheyLeft`'s.
 */
function theyLeft(conversations: readonly string[]): void {
  const next = lookingAfterTheyLeft(
    view(),
    conversations,
    store.live.value.map((record) => record.sessionId),
    LAUNCHER,
  )
  activeId.value = next.activeId
  place.value = next.place
  for (const sessionId of conversations) store.forget(sessionId)
}

/** Conversations this window archived: their unsent words wait for them, and their views close. */
function archivedHere(conversations: readonly string[]): void {
  places.markArchived(conversations, archiveKey)
  historyMoved.value += 1
  draftSweep.holdArchived(conversations)
  theyLeft(conversations)
}

/**
 * Archive the conversation on screen. Resolves to main's refusal, which the header draws as it
 * is, or null once the conversation and its helpers are archived and their views closed.
 */
const archiveOfActive = computed(() => {
  const sessionId = active.value?.sessionId
  if (sessionId === undefined) return undefined
  return async (): Promise<string | null> => {
    const outcome = await archiveConversation(runtime(), sessionId)
    if (!outcome.done) return outcome.refusal
    archivedHere(outcome.conversations)
    return null
  }
})

/** An Archive pressed in the delete sheet: the same closing, and the library reads again. */
function archivedFromTheSheet(conversations: readonly string[]): void {
  archivedHere(conversations)
  library.value?.reread()
}

/**
 * A delete took these conversations' records: their views close, the window's unsent words and
 * attached paths for each are dropped, and the library reads again.
 */
function deletedFromTheSheet(conversations: readonly string[]): void {
  places.markGone(conversations)
  historyMoved.value += 1
  theyLeft(conversations)
  dropTheirDrafts(drafts, conversations)
  library.value?.reread()
}

/**
 * Move this conversation onto the machine's current Claude sign-in (147) — close the child holding
 * the superseded credential, then reopen, which re-reads the Keychain.
 *
 * The reopen reports through the same `resumeError` every other reopen does, so a machine login that
 * has since expired says so in the place the user is already looking.
 */
async function reopenSignIn(sessionId: string): Promise<void> {
  await closeAndReopen(sessionId)
}

/**
 * 🔴 **Close one conversation and open it again, as one gesture.**
 *
 * ⚑ **Close AND resume, as one gesture, because half of it is a worse state than either end.** A
 * close alone leaves the user with an ended conversation and a Resume they now have to find; a
 * resume alone is refused, since `resumeSession` hands back the session already running rather than
 * spawning a second child onto the same transcript.
 *
 * ⛔ **A close that failed leaves the old child alive**; reopening on top of it would attach to
 * that very session and report success. Its sentence is already on the record, so there is nothing
 * to add here.
 *
 * @returns whether the conversation is open again. ⚠️ `false` covers both halves: a close that
 *   failed (whose sentence is on the record) and a resume that was refused (whose sentence is
 *   `store.resumeError`).
 */
async function closeAndReopen(sessionId: string): Promise<boolean> {
  // ⚠️ **`from` is read BEFORE the awaits** (095): a close and a start take as long as a provider
  // takes, and a person who moved meanwhile is not moved back.
  const from = view()
  // 🔴 **678 · R26 — the draft survives the reopen** — held from BEFORE the close, because the close
  // is what the sweep reacts to (`sweepDrafts`).
  return draftSweep.reopening(sessionId, async () => {
    const closed = await store.close(sessionId)
    if (!closed) return false
    const opened = await store.resume(sessionId)
    if (opened !== null) showConversation(opened, from)
    return opened !== null
  })
}

/** ⚑ **D-017b · a row pressed** — the conversation opens in its full view ({@link openConversation}). */
function select(sessionId: string): void {
  void openConversation(sessionId)
}

/** Keep the original slot until acceptance; queued drafts leave the composer while they wait. */
async function send(
  text: string,
  intent: SendIntent = 'now',
  attachments: HandedPath[] = [],
): Promise<void> {
  const sessionId = activeId.value
  if (!sessionId) return
  const submit = async (): Promise<boolean> => {
    const starting = store.isLaunching(sessionId)
    if (store.get(sessionId)?.phase === 'recorded' && !starting) {
      return continueIt(sessionId, text, attachments, true, true)
    }
    return store.send(sessionId, text, starting ? 'queue' : intent, attachments)
  }
  await drafts.send(draftKey(sessionId), submit, intent === 'queue')
}

/**
 * ⚑ **D-017b · a message from a recorded conversation's view continues it** — the words and the start
 * they cause in one act (`store.startAndSend`, the host's `startAndSend`): whatever stopped it, and
 * whether anything runs it now, the person just types.
 *
 * ⚑ **The draft slot is held through the start** (`678` R26), so a refused start loses nothing, and
 * every arm the words did not go puts them back — in this conversation's composer, or in the one
 * that took its place (D-017 · R10), which is the one the person is then shown. ⚠️ `from` is read
 * before anything is awaited (`095`). ⚑ The refusal itself is said on the record, beside the box
 * (`store.startAndSend`).
 */
async function continueIt(
  sessionId: string,
  text: string,
  attachments: HandedPath[],
  /** ⚑ `false` for words the person did not type — a drawer's *Compact now* — which go back nowhere. */
  giveTheWordsBack: boolean,
  draftKept = false,
): Promise<boolean> {
  const from = view()
  const answer: { came: FirstMessageCameTo | null } = { came: null }
  await draftSweep.reopening(sessionId, async () => {
    answer.came = await store.startAndSend(sessionId, text, attachments)
    return answer.came?.openHere ?? false
  })
  const came = answer.came
  if (
    giveTheWordsBack &&
    (came === null || !came.sent) &&
    (!draftKept || came?.tookItsPlace !== undefined)
  ) {
    restoreRefused(draftKey(came?.tookItsPlace ?? sessionId), text, attachments)
  }
  if (came?.tookItsPlace !== undefined && came.openHere) showConversation(came.tookItsPlace, from)
  return came?.sent ?? false
}

/**
 * 🔴 **718 · `R60` — *"Compact now…"*, confirmed: the person's `/compact`, through the send door.**
 *
 * ⚑ **`store.send`, the composer's own door**, so the host decides it exactly as it decides a typed
 * `/compact` — the person's turn, the provider's road, every refusal. ⛔ **Not {@link send}**: that
 * one owns the composer's retained draft, and a person who pressed a button in
 * the drawer did not type these words — a refusal is drawn beside the conversation by the pane
 * (`session-error`), as every refused send is, and their draft is left as they left it.
 * ⚑ **D-017b** — a recorded conversation takes it as it takes any message ({@link continueIt}).
 */
function compactNow(): void {
  const sessionId = activeId.value
  if (sessionId) void store.compact(sessionId)
}

/**
 * ⚑ **D-017b · the composer's Stop** — while a message from a recorded view is starting the
 * conversation, it stops that start (`store.cancelLaunch`); otherwise it asks what runs to stop.
 */
function stopIt(): void {
  const sessionId = activeId.value
  if (!sessionId) return
  if (store.isLaunching(sessionId)) void store.cancelLaunch(sessionId)
  else void store.interrupt(sessionId)
}

/**
 * Take back the message waiting to be sent (077). Defaulted to `'now'` above so the one caller that
 * is not the composer — the first message of a brand-new conversation — is unchanged.
 *
 * 🔴 **688 · the row that was pressed, by its NAME** ({@link QueuedItem.messageId}). ⛔ This used to
 * take back the HEAD of the mailbox whichever row was pressed, and a conversation can hold two since
 * `394` — so R33's take-back of a held go-ahead could have taken back a question waiting in front of
 * it. ⚑ The host refuses a name it is not holding (*"that is not a message this conversation is
 * holding"*), so a stale row takes back nothing rather than the wrong thing.
 *
 * ⛔ **No head fallback any more** (`688`'s review): only a row written before `354` has no name,
 * and main's mailbox never holds such a message — so the head was always a DIFFERENT message, and
 * since `670` it can be BroBot's go-ahead. A nameless row offers no *Cancel it* at all
 * (`QueuedMessage`'s `cancel`), so nothing reaches here without a name.
 */
function cancelQueued(messageId: string): void {
  const id = activeId.value
  if (id) void store.cancelQueuedMessage(id, messageId)
}

/** A held stop word, pressed as Stop now: the host takes it back and stops the turn, or refuses. */
function stopQueued(messageId: string): void {
  const id = activeId.value
  if (id) void store.takeBackAndStop(id, messageId)
}

function decide(requestId: string, decision: PermissionDecision): void {
  if (activeId.value) void store.respondPermission(activeId.value, requestId, decision)
}

async function moveRequest(
  sessionId: string,
  requestId: string,
  decision: 'move' | 'here',
): Promise<string | null> {
  return moveRequestFromWindow(
    { sessionId, requestId, decision },
    {
      decide: (input) => store.decideMoveRequest(input.sessionId, input.requestId, input.decision),
      open: openConversation,
      refresh: lookForWhatIsYours,
    },
  )
}
function moveFromConversation(requestId: string, decision: 'move' | 'here'): void {
  if (activeId.value !== null) void moveRequest(activeId.value, requestId, decision)
}

function respond(requestId: string, response: UserInputResponse): void {
  if (activeId.value) void store.respondUserInput(activeId.value, requestId, response)
}

const attention = useRuntimeAttention({
  store,
  persons,
  agentStore,
  desktopIfAny,
  rail,
  agentHeadingFor,
})
const {
  areActionableReadsClosed,
  clock,
  conversationWaits,
  homeNeedsYou,
  lookAfterAUsageNotice,
  lookForWhatIsYours,
  waitingHere,
} = attention
const readings = useRuntimeScreenReadings({
  store,
  attention,
  rail,
  library,
  info,
  teamProfileGraph,
  filesLibrary,
  screen,
  onScreenNow,
  mainTab,
  runtime,
  modelLists,
  readPrograms,
  invalidatePrograms: () => {
    programsRead++
  },
  persons,
  agentStore,
  refreshAgents,
  refreshConversationStars,
  authChangedFor,
  archivedHere,
  goToTheWork: (sessionId) => goToTheWork(sessionId),
})
const {
  activityReading,
  activityWindowMs,
  agentIdentityRevision,
  beingDone,
  chooseActivityWindow,
  chooseForestWindow,
  conversationIdentity,
  forestError,
  forestPending,
  forestWindow,
  listedNamedOfActive,
  listedStateOfActive,
  ownForestError,
  ownForestPending,
  personIdentityRevision,
  readAllTasks,
  setRules,
  readConversationForest,
  readOwnForest,
  readTaskPage,
  readTheCast,
  readTitleHistory,
  renameConversation,
  sinceLastHere,
  theForest,
  theForestView,
  work,
  workRevision,
} = readings
const { decideFromOverview, openRequest, heldHere, goToTheWork } = useRuntimeQueueActions({
  store,
  attention,
  castFacts: readings.castFacts,
  persons,
  agentStore,
  agentHeadingFor,
  rail,
  pane,
  todoDocument,
  openConversation,
  select,
  runtime,
  say,
  answerATodo,
  moveRequest,
  takeBackForAPerson,
})

/** Handle the new-conversation and history shortcuts. */
function onKey(event: KeyboardEvent): void {
  // Back and Forward: ⌘[ and ⌘] on a Mac, Alt+← and Alt+→ elsewhere.
  const step = historyKey(event)
  if (step !== null) {
    event.preventDefault()
    void go(step)
    return
  }
  if (!(event.metaKey || event.ctrlKey)) return
  if (event.key === 'n') {
    event.preventDefault()
    place.value = 'new'
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('mouseup', onSideButton)
  window.addEventListener('mousedown', onSideButton)
  // A swipe on a Mac's trackpad and a Windows Back key, as main hears them; a mouse's side button
  // can arrive this way too, and counts once.
  stopHearingNavigate =
    desktopIfAny()?.onNavigate?.((direction) => pressed(direction === 'back' ? -1 : 1, 'main')) ??
    null
  // ⚠️ Not awaited and not in the settled group below: nothing on screen waits for it, a read that
  // failed must not delay the app info and the capabilities that the launcher does wait for, and
  // the Team page says *Reading identities…* until it lands. ⛔ **`570` · the rail does not wait
  // on it any more and must not**: since `EXT-008` §4.4 took the AGENTS section out, the two
  // readers left are the conversation rows' own names and the palette, and both fall back to
  // `profileLabel` rather than drawing nothing. ⚑ It is also the one read that
  // can be REFUSED for a reason worth showing — `agentIdentities` answers only a channel with a
  // person behind it — and the store keeps that sentence.
  void agentStore.load()
  void readPrograms()
  /**
   * Both at once, and SETTLED rather than all-or-nothing.
   *
   * `Promise.all` would have coupled two unrelated reads: a capabilities failure would blank the app
   * info that had already arrived, and vice versa. They fail independently because they are
   * independent — but neither may fail QUIETLY. A capabilities fetch that died in silence would take
   * plan mode off the launcher with nothing said, which is indistinguishable from a provider that
   * cannot plan: the exact confusion 039 exists to end.
   */
  const [appInfo, declared, known] = await Promise.allSettled([
    desktop().getAppInfo(),
    runtime().capabilities(),
    runtime().profiles(),
  ])
  if (appInfo.status === 'fulfilled') info.value = appInfo.value
  if (declared.status === 'fulfilled') capabilities.value = declared.value
  if (known.status === 'fulfilled') profiles.value = known.value
  // ⚠️ **The model read is no longer one of these, because it can no longer be made here** (257 §2).
  // It is asked per PROFILE now, and which profile is a question about the launcher's choice and the
  // open conversation — so it belongs to {@link listsShown}' watcher, which fires the moment the list
  // above lands. What has not changed is that a failure is not reported: a list that could not be
  // read is a picker still offering *+ Add*, and posting a startup error on one provider being
  // unauthenticated — a normal state to be in — is what 058 refused.
  // ⚠️ **The profile read IS in this line, unlike the model read** (167). A failure here is the
  // `capabilities` shape rather than the model lists' shape: the launcher responds to `null` by taking
  // "+ New profile…" off the page, so a read that died in silence would remove the ONE control this
  // dispatch exists to add, and leave it indistinguishable from an app that never had it.
  const failures = [appInfo, declared, known]
    .filter((settled) => settled.status === 'rejected')
    .map(({ reason }) => readableError(reason))
  if (failures.length > 0) infoError.value = failures.join(' · ')
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('mouseup', onSideButton)
  window.removeEventListener('mousedown', onSideButton)
  stopHearingNavigate?.()
})
</script>

<template>
  <MessageLinks
    :resolve="resolveMessageLink"
    :open="openMessageDestination"
    :scope="`${place ?? ''}|${activeId ?? ''}|${linkedHistory?.sessionId ?? ''}`"
  >
    <div ref="appElement" class="app">
      <!-- Every icon the product draws, mounted once so any surface can reach it. -->
      <IconSprite />

      <!-- 🔴 **The one announcement channel, and it carries a summons and nothing else** (401).

           ⛔ **`role="status"`, whose implicit `aria-live` is `polite`** — this is the shell's only
           ALWAYS-MOUNTED region. ⚠️ **Not the app's only one, and that sentence stood here until it
           was counted**: there are nineteen others — `role="alert"` on every form refusal,
           `role="status"` on the launch read and two more — each of which exists only while it has
           something to say. ⚑ The one that is unconditional beside it is `ClosingShade`'s
           `assertive`, which is right there because the process is going away and would be wrong
           here: a question is waiting on a person who is not going anywhere, and it can wait for the
           sentence they are currently hearing.

           ⚠️ **612 · it said *"a question has already waited thirty seconds"*** (HO-088 §3.1): a
           question reached this queue one escalation window after it was asked. ⛔ **It reaches it
           immediately now**, so the argument for `polite` cannot rest on a wait that has already
           happened — it rests on the person being here, which is the half that was always true.

           ⛔ **The closed set, honoured on this channel too.** Two things may summon attention — a
           question and a permission — and what is announced here is the first of them, arriving
           from a conversation no surface in this window can otherwise show. ⚠️ **Nothing else may
           ever be routed through it**: not a completion, not a failure, not a count of anything
           else. An unconditional live region carrying ordinary activity is the defect the design's
           own attention-policy correction removed, and this is the one shape it kept.

           ⚑ **Mounted once, in the shell, and never inside the queue component** — which is drawn
           twice, and would announce everything twice. ⚠️ Empty while nothing is waiting, so it says
           nothing rather than reading out an all-clear. -->
      <div class="only-for-a-reader" role="status" data-cy="persons-queue-announcement">
        {{ persons.view.value?.announcement ?? '' }}
      </div>

      <AppTitleBar :info="info" :error="infoError" :provider-readiness="launchReadiness" />

      <div class="shell" :data-rail="railFold.collapsed.value ? 'collapsed' : 'open'">
        <!-- ⛔ **`:agents` SURVIVES the AGENTS section that is gone** (570). `449` folds this roster
             into the conversation rows' own names — this rail's `who()` is
             `agentName(profileId, props.agents?.identities)` — and the command palette
             reads it too, so a tidy-up that
             removed the prop with the block would put `brobot-workspace` back on every conversation
             row. The removed section also owned these two listeners:
             `@new-agent` and `@open-agent-capabilities` were raised by that section and by nothing
             else in the renderer, and both gestures are on `TeamWorkspace` below.

             🔴 **`:limits` is 617** — `HO-080` §4: *"a wall is the one condition where the answer
             changes from yes to no and nothing else on screen says so."* ⛔ **It is `persons.limits`
             and not a second fold of `walled`**: the queue's band already derives it from the same
             `supply` call above, so the rail and the band cannot disagree about which provider has
             stopped. Limits keep their own last reading between the less frequent limit looks. -->
        <SideRail
          ref="rail"
          :open="store.live.value"
          :provider-blocks="store.providerBlocks"
          :active-id="activeId"
          :on-screen="active"
          :place="place"
          :needs-you="homeNeedsYou.total"
          :needs-you-partial="persons.looked.value && homeNeedsYou.unread"
          :queue-looked="persons.looked.value"
          :workspace-folder="info?.workspace ?? null"
          :app-version="info?.version ?? null"
          :limits="persons.limits.value"
          :waiting="conversationWaits"
          :collapsed="railFold.collapsed.value"
          @fold="railFold.toggle()"
          @new-conversation="place = 'new'"
          @select="select"
          :read-identities="readRailIdentities"
          :identity-revision="workRevision + agentIdentityRevision + personIdentityRevision"
          :search-conversations="searchConversations"
          :library-search-caller="librarySearchCaller"
          @read-conversation="openFoundConversation"
          @read-starred="readFromTheLibrary"
          @reveal-library-entry="revealLibraryEntry"
          @go="
            (destination) => {
              linkedIdentity = null
              libraryReveal = null
              if (destination === 'tools' || destination === 'providers') openSettings(destination)
              else if (destination === 'settings') openSettings(settingsTab)
              else place = destination
            }
          "
          :agents="agentStore.identities.value"
        />

        <main class="main">
          <!-- An archived conversation a link opened, read-only, in place of the page it came from. -->
          <LinkedHistory
            v-if="linkedHistory"
            :key="linkedHistory.sessionId"
            :history="linkedHistory.history"
            :title="linkedHistory.title"
            :session-id="linkedHistory.sessionId"
            :load-older="olderLinkedHistory"
          />
          <!-- 🔴 **606 · `EXT-008` §3's first destination** — *Waiting on you*: what a person OWES,
               ⛔ **complete regardless of age** (`HO-025` §2). ⚑ **D-017 · R19 — from the host's
               reads over every conversation**, with only the cards no host read lists taken from this
               window ({@link waitingHere}) — the rail's badge counts the same.
               ⚠️ **It is `v-if` and the rest are `v-else-if`**, which is only ordering: the surfaces
               are mutually exclusive by construction. -->
          <WaitingOnYou
            v-else-if="surface === 'waiting'"
            :needs-you="waitingHere"
            :attention="homeNeedsYou"
            :clock="clock"
            :agents="agentStore.identities.value"
            @decide="decideFromOverview"
            @open-request="openRequest"
            @open-agent="(profileSlug) => overlays.open({ kind: 'agentCapabilities', profileSlug })"
            :since-last-here="sinceLastHere"
            @see-recent-activity="place = 'away'"
          />

          <!-- Recent activity: what changed, bounded by the chosen window, apart from Waiting on
               you, which is complete regardless of age. -->
          <RecentActivity
            v-else-if="surface === 'away'"
            :reading="activityReading"
            :window-ms="activityWindowMs"
            :clock="clock"
            @choose-window="chooseActivityWindow"
            @open="(sessionId) => void openConversation(sessionId)"
          />

          <!-- WIRED (047): every row here is read from our database and from the user's real provider
               homes. -->
          <SessionLibrary
            v-else-if="surface === 'sessions'"
            ref="library"
            :key="libraryReveal?.visit"
            :reveal-entry-id="libraryReveal?.entryId"
            :identities="agentStore.identities.value?.identities ?? null"
            @read="readFromTheLibrary"
            @delete="(sessionId) => overlays.open({ kind: 'deleteConversation', sessionId })"
            @archived="archivedHere"
            @search-caller="(sessionId) => (librarySearchCaller = sessionId)"
          />

          <!-- The Team page raises agent actions; this screen opens their sheets. -->
          <TeamWorkspace
            v-else-if="surface === 'team'"
            :focused-identity="linkedIdentity"
            :agents="agentStore.identities.value"
            :store="agentStore"
            :being-done="beingDone"
            :held="store.live.value.map((record) => record.sessionId)"
            :conversations="rail?.theOneList ?? null"
            :forest="theForestView"
            :forest-window="forestWindow"
            :forest-counts="theForest?.reading.counts ?? null"
            :forest-pending="forestPending"
            :forest-error="forestError"
            @forest-window="chooseForestWindow"
            @create="overlays.open({ kind: 'newAgent' })"
            @open="(profileSlug) => overlays.open({ kind: 'agentCapabilities', profileSlug })"
            @open-shapes="(profileSlug) => overlays.open({ kind: 'agentSections', profileSlug })"
            @open-conversation="select"
          />

          <SettingsScreen
            v-else-if="surface === 'settings'"
            data-chat-theme="light"
            v-model:tab="settingsTab"
            :setup-provider="setupProvider"
            :capabilities="capabilities"
            :warnings="persons.limits.value"
            :clock="clock"
            :store="agentStore"
            @auth-changed="authChangedFor"
            @usage-moved="lookAfterAUsageNotice"
            @start-conversation="place = 'new'"
            @add-server="overlays.open({ kind: 'externalMcpServers' })"
          />

          <!-- A library entry this app holds no ledger for. It has no conversation behind it, and
               offers nothing that would need one. -->
          <ReadingPane
            v-else-if="surface === 'reading' && reading"
            :entry="reading.entry"
            :identities="agentStore.identities.value?.identities ?? null"
            :history="reading.history"
            :on-read-resource="readResourceForAnySurface"
            :on-draw-resource="store.drawResource"
            :on-reveal-resource="store.revealResource"
            @back="closeReading"
          />

          <ConversationPane
            v-else-if="surface === 'conversation' && active?.meta"
            ref="pane"
            :record="active"
            :forest="readConversationForest"
            :forest-pending="ownForestPending"
            :forest-error="ownForestError"
            @refresh-forest="readOwnForest"
            :drawer-open="drawerOpen"
            :drawer-tab="drawerTab"
            :pick-model="pickModelForActive"
            :capabilities="capabilities"
            :work="work"
            :waiting="theWaitIn(conversationWaits, active.sessionId)"
            :held-work="theWorkIn(conversationWaits, active.sessionId)"
            :listed-state="listedStateOfActive"
            :provider-block="active ? store.providerBlocks.get(active.sessionId) : null"
            :named="listedNamedOfActive"
            :identity="conversationIdentity"
            :title-history="{ read: readTitleHistory, revision: workRevision }"
            :task-page-source="{
              read: readTaskPage,
              readAll: readAllTasks,
              setRules,
              revision: workRevision,
            }"
            :rename="renameConversation"
            :archive="archiveOfActive"
            :identities="agentStore.identities.value?.identities ?? null"
            :draft="drafts.read(draftKeyForActive)"
            :handing="drafts.paths.handing(draftKeyForActive)"
            :awaiting-send="drafts.awaitingSend(draftKeyForActive)"
            :cwd="active?.meta?.cwd ?? ''"
            :held="heldHere"
            :launching="store.isLaunching(active.sessionId)"
            :on-load-older="loadOlderForActive"
            :on-take-back="takeBackForAPerson"
            :on-jump-to-latest="jumpToLatestForActive"
            :on-read-workflow-output="readWorkflowOutputForActive"
            :on-read-resource="readResourceForAnySurface"
            :on-draw-resource="store.drawResource"
            :on-reveal-resource="store.revealResource"
            :on-read-instruction="readInstructionForActive"
            :on-reveal-path="revealPathForActive"
            :on-read-config-file="readConfigFileForActive"
            :on-read-child-work="readChildWorkForActive"
            :on-read-child-state="readChildStateForActive"
            :on-send-to-child="sendToChildForActive"
            :submit="send"
            @compact-now="compactNow"
            @update:draft="(text) => drafts.write(draftKeyForActive, text)"
            @decide="decide"
            @respond="respond"
            @move="moveFromConversation"
            @open-conversation="goToTheWork"
            @open-book="(profileSlug) => overlays.open({ kind: 'agentSections', profileSlug })"
            @interrupt="stopIt"
            :on-stop-background-work="stopBackgroundWork"
            :on-read-command-output="readCommandOutput"
            :on-read-tool-answer="readToolAnswer"
            @reopen-sign-in="activeId && reopenSignIn(activeId)"
            @cancel-queued="cancelQueued"
            @stop-queued="stopQueued"
            @hand-back="activeId && handBack(activeId)"
            @delete="activeId && overlays.open({ kind: 'deleteConversation', sessionId: activeId })"
            @take-it-over="activeId && openConversation(activeId)"
            @refresh-config="activeId && store.refreshConfig(activeId)"
            @set-approval-mode="(mode) => activeId && store.setApprovalMode(activeId, mode)"
            @set-session-setting="(body) => activeId && store.setSessionSetting(activeId, body)"
            @end-plan-mode="(text) => activeId && store.endPlanMode(activeId, text)"
            @toggle-drawer="drawerOpen = !drawerOpen"
            @update:drawer-tab="(tab) => (drawerTab = tab)"
            @show-instructions="
              () => {
                // 318 §2.3. **Set, never toggled**: the conversation is asking for a specific screen,
                // and a flip here would shut the drawer for anyone who already had it open. Both
                // halves are persisted, so the next conversation opens where this one left it.
                drawerOpen = true
                drawerTab = 'info'
              }
            "
          />

          <!-- You asked for a new one — and an app with no conversation in it is not an error state,
               it is a thread waiting to be started.

               ⚠️ **It reads `v-else` and it is no longer the fallback** (095). "Nothing open" used to
               ARRIVE here, by falling past every branch above with `place` still null, and that is
               precisely what made the launcher impossible to keep: a surface reached by absence
               cannot be told apart from an absence. The election above now names it — `place` becomes
               `'new'` the moment there is nothing to elect — so this branch is entered on purpose and
               stays entered until the user leaves it. The `v-else` remains as the backstop it always
               should have been: a record whose `meta` has not arrived yet has nothing to draw, and a
               blank pane would be worse than the launcher. -->
          <!-- ⚑ **The model picker reads BroBot's own lists, already being held** (435, UI-012).
               {@link listsShown} has read them on mount, so the front door's picker costs no new
               provider child. ⛔ **`choices` is held HERE and not in the component**: see
               {@link launchChoices}, and `210` for the defect that makes it a rule. -->
          <template v-else>
            <p v-if="frontDoorChoiceError" role="status" data-cy="launch-choices-unread">
              Could not read launch choices. {{ frontDoorChoiceError }}
              <button type="button" @click="resolveFrontDoor">Try again</button>
            </p>
            <p
              v-else-if="frontDoorProvider === null"
              role="status"
              data-cy="launch-choices-loading"
            >
              Reading launch choices…
            </p>
            <NewConversation
              v-if="frontDoorProvider !== null"
              :recent="rail?.theOneList ?? null"
              @open="select"
              :busy="
                frontDoorResolving ||
                frontDoorChoiceError !== null ||
                frontDoorLaunch.busy.value ||
                store.isLaunching()
              "
              :error="store.launchError.value"
              :refused-as="store.launchRefusal.value"
              :draft="drafts.read(draftSlot(null))"
              :handing="drafts.paths.handing(draftSlot(null))"
              :default-provider="frontDoorProvider"
              :provider-readiness="launchReadiness"
              :default-approval-mode="frontDoorApproval"
              :approval-default-chosen="agentStore.identities.value?.defaultApprovalModeChosen"
              :capabilities="capabilities"
              :programs="programs"
              :choices="launchChoices"
              @update:choices="(next) => (launchChoices = next)"
              @set-approval-default="(mode) => void setApprovalDefault(mode)"
              @auth-changed="authChangedFor"
              @open-providers="openProviderSettings"
              :submit="startFromFrontDoor"
              @cancel="store.cancelLaunch()"
              @update:draft="(text) => drafts.write(draftSlot(null), text)"
            />
          </template>
        </main>
      </div>

      <!-- A file an agent handed with a to-do, opened from Waiting on you or its corner. -->
      <CanonicalDocumentOverlay
        ref="todoDocument"
        :read="readResourceForAnySurface"
        :draw="store.drawResource"
        :reveal="store.revealResource"
      />
      <FilesLibraryPreview
        :library="filesLibrary"
        :workspace="info?.workspace.path ?? 'unread-workspace'"
        :read="readResourceForAnySurface"
        :draw="store.drawResource"
        :reveal="store.revealResource"
      />

      <!-- A provider that isn't ready opens its setup once at launch, until it is closed. -->
      <ProviderSetupAtLaunch
        :capabilities="capabilities"
        @open-providers="openSettings('providers')"
        @start-conversation="place = 'new'"
      />

      <!-- One overlay at a time, over everything. Its chrome is real even where its confirms are not. -->
      <RuntimeOverlaySheets
        :capabilities="capabilities"
        :default-approval-mode="frontDoorApproval"
        :start="startFromSheet"
        :drafts="drafts"
        :recent="rail?.theOneList ?? null"
        :programs="programs"
        @settings="openSettings"
        @open="select"
        @providers="openProviderSettings"
        @auth-changed="authChangedFor"
        @archived="archivedFromTheSheet"
        @deleted="deletedFromTheSheet"
      />

      <ToastStack />

      <!-- What a stub actually did, said out loud and briefly.

           ⚠️ **The SECOND toast in this file, and it is not the one `ToastStack` draws** — it is the
           app frame's own one-line notice. It gets 346's scope for the same reason and by the same
           sentence; leaving it out would have put one paper chip and one near-black chip on the same
           page, which is worse than either answer taken consistently. -->
      <div v-if="notice" class="toast" data-cy="toast" data-chat-theme="light">{{ notice }}</div>
      <!-- Every open popup is drawn here, newest last. -->
      <div ref="overlayLayer" class="overlay-layer" data-cy="overlay-layer"></div>
    </div>
  </MessageLinks>
</template>

<style scoped src="./RuntimeScreen.css"></style>
