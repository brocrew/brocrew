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
 * # ⛔ Both endings of one launch, decided in ONE place (221 §2)
 *
 * `start` composes two operations — open a conversation, then say the first thing in it — and until
 * now each ending was decided by its own `if` at its own point in the function, one of them behind
 * a second exported predicate (`shouldReturnFirstMessage`, retired into this). This is both, so
 * they cannot answer differently about the same words.
 *
 * ## `launcher` — 102, found by review
 *
 * The other half of `NewConversation`'s `shouldRestoreDraft`, and it exists because that one cannot
 * see this: it fires on `busy` falling with an ERROR up, which was the only way to tell "the launch
 * ended without opening anything" from "it opened" — until `102` added a second ending with no
 * error on it. A cancelled launch therefore ate the message. Typed, sent, composer cleared on send,
 * `lastTried` wiped by the same watcher that declined to hand it back: nothing left holding it. The
 * sentence the host gives back is *"Start it again whenever you are ready"*, which is only true if
 * the message is still there to start it with.
 *
 * ⚑ **Exported and pure for the reason `shouldRestoreDraft` states out loud** — *"a watcher is not
 * reachable from a node/SSR test, so the decision lives here where it can be pinned"* — and this one
 * lives in an `async` continuation, which is worse.
 *
 * ## §2's question: the row a failed first send leaves behind
 *
 * `220` pressed an attachment-only Send on the launcher, got raw zod, and was left — in its own
 * words — holding *"an empty rail row"*. The dispatch asks whether a launch whose opening message
 * never reached the provider should leave one, and the instinct is to take it away.
 *
 * ⛔ **It should not, and the reason is that closing cannot take it away.** The rail row is created
 * by the LAUNCH, not by the send: `store.create` writes the `provider_session` row before a first
 * message exists. A close does not un-create it — `close()` moves the record to `ended` and it
 * STAYS, deliberately, for the reopen list. So the trade on offer is a live empty conversation you
 * can act on for a **dead** one you cannot, which the session library then keeps for good. That is
 * `151`'s subject arriving as a fix for itself.
 *
 * ⚑ **And the row is not inert.** By the time the send is attempted, `showConversation` has already
 * put the person inside that conversation; the pane renders the host's own reason
 * (`data-cy="session-error"`); and this function sends the words AND the staged paths back to its
 * composer, where one press sends them. A conversation you are standing in, holding what you typed,
 * is not a ghost.
 *
 * ⚠️ **What actually fixes §2 is §1 and §3, upstream of it.** The gesture that produced this state
 * for an ordinary person is gone — the wire accepts an attachment-only send — and what is left
 * refuses in a sentence rather than in schema language. The state remains reachable (a file that
 * moved between the paperclip and the press; a Claude sign-in superseded on the first press; a
 * provider that died on launch, `180`), and in each of those the conversation is exactly where the
 * next attempt belongs.
 *
 * ⛔ **Written here rather than only in a response doc**, on `219` §2's rule: three times in this
 * project a defect has lived inside a gap a doc had already named. `composer.render.test.ts` pins
 * every branch.
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
import { moveRequestFromWindow } from '../lib/move-request'
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  watch,
  watchEffect,
} from 'vue'
import { DEFAULT_CONVERSATION_PROVIDER } from '@brobot2/shared/providers'
import type { AppInfo } from '@brobot2/shared'
import type {
  ChildWorkInput,
  ChildSendResult,
  ChildStateResult,
  ChildWorkResult,
  CommandTail,
  ToolAnswer,
  CreateSessionInput,
  LibraryEntry,
  PermissionDecision,
  Provider,
  ProviderCapabilityMap,
  ProviderProgram,
  ProviderVersion,
  UserInputResponse,
  ResourceReading,
  WhatAPickBecame,
  KeptFile,
  WorkflowOutputResult,
  InstructionSourceResult,
  RevealResult,
  ConfigFileResult,
  SessionPathTarget,
  HandedPath,
} from '../../../shared/runtime-ipc'
import {
  agentName,
  DEFAULT_PROFILE_ID,
  HELD_ELSEWHERE,
  PROVIDER_NAME,
} from '../../../shared/runtime-ipc'
import { useAgentStore } from '../composables/useAgentStore'
import { providerForALaunch, providersNotChosenIn } from '../lib/agent-store'
import { NO_LAUNCH_CHOICES, type LaunchChoices } from '../lib/launch-choices'
import { pickInAConversation, type PickedModel } from '../lib/model-lists'
import { useModelLists } from '../composables/useModelLists'
import { useProfileSignIn } from '../composables/useProfileSignIn'
import { providerReady, readyProvider } from '../lib/provider-models'
import { conversationsToReopen, type AConversationToReopen } from '../lib/reopening'
import { oneReadAtATime } from '../lib/one-read-at-a-time'
import { handedBackSays } from '../lib/handing-it-back'
import {
  archiveConversation,
  dropTheirDrafts,
  leftTheListsFromElsewhere,
  lookingAfterTheyLeft,
} from '../lib/archive-and-delete'
import { whenTheWorldMoves } from '../lib/the-world-moved'
import { limitsDisplayLane, type LimitsDisplayState } from '../lib/limits-display'
import { profileItRunsAs, readableError } from '../lib/session-record'
import { takeBackThrough } from '../lib/take-back'
import { useSpawnSafety } from '../lib/spawn-safety'
import AgentSectionsSheet from './AgentSectionsSheet.vue'
import CapabilitiesSheet from './CapabilitiesSheet.vue'
import ExternalMcpRegistry from './ExternalMcpRegistry.vue'
import {
  forgetPersistentPreference,
  usePersistentChoice,
  usePersistentToggle,
} from '../composables/usePersistentToggle'
import { recordFacets, standingWord, stateHere } from '../lib/agent-state'
import {
  answeredFromHere,
  answerFor,
  attentionQueue,
  attentionToACardNobodyHolds,
  listedNowhereElse,
  OPEN_REQUEST_MISSED,
  type AttentionDecision,
  type AttentionRequest,
} from '../lib/attention'
import { DEFAULT_TAB, isDrawerTab, type DrawerTab } from '../lib/drawer'
import { hiddenDrawerTabs, offeredTab } from '../lib/developer-views'
import { useDebugMode } from '../composables/useDebugMode'
import {
  attachmentsNotRestored,
  createDraftBook,
  draftKey,
  draftSlot,
  sweepDrafts,
} from '../lib/drafts'
import { keepTheDraftBook, SAVED_DRAFTS } from '../lib/kept-drafts'
import { appClosing } from '../lib/app-closing'
import { homeAttention } from '../lib/home-attention'
import { syncAttentionSignals } from '../composables/useAttentionSignals'
import WaitingOnYou from './WaitingOnYou.vue'
import CanonicalDocumentOverlay from './CanonicalDocumentOverlay.vue'
import RecentActivity from './RecentActivity.vue'
import {
  LOOK_EVERY_MS,
  limitsReadCadence,
  usePersonsQueue,
  type PersonsQueueRow,
} from '../lib/persons-queue'
import { askedQuestionItemIn, briefItemIn } from '../lib/transcript'
import { THE_BRIEF_IS_FURTHER_BACK } from '../lib/outgoing-card'
// 🔴 **636 · the reading `621` built and left with no reader** — see {@link readWhatIsWaiting}.
// ⚠️ **This file is `631`'s and the edit is deliberately four small ones**; the response document
// names every line so the merge can be sequenced rather than discovered.
import {
  theWaitIn,
  theWorkIn,
  whenItOwedIn,
  whenItsWaitsBeganIn,
  whoItOwesIn,
  whoseAnswerIn,
  whoseWorkIn,
  stoppedWorkIn,
} from '../lib/conversation-waits'
import type { WhatEachConversationIsWaitingOn } from '../../../shared/tasks'
import type { WhatIsBeingDone } from '../../../shared/what-is-being-done'
import type { TheWholeForest } from '../../../shared/the-whole-forest'
import { forestView } from '../lib/the-forest'
import { ROSTER_EVERY_MS } from '../lib/team-roster'
import { refusedToOpen } from '../lib/taking-over'
import { afterAPlacedLaunch } from '../lib/placed-launch'
import { THE_COMPACT_COMMAND } from '../lib/compaction-offer'
import { type WorkGivenOutReading } from '../lib/work-given-out'
import { theWorkAPersonGave } from '../lib/working-together'
import { filesReadFor } from '../lib/files-kept'
import { useWhoCalledWhom } from '../composables/useWhoCalledWhom'
import { MAX_DIGEST_SPAN_MS } from '../../../shared/digest'
import type { RecentActivityReading } from '../../../shared/recent-activity'
import {
  ACTIVITY_READ_EVERY_MS,
  DEFAULT_ACTIVITY_WINDOW_MS,
  sinceView,
} from '../lib/recent-activity'
import { useLastSeen } from '../composables/useLastSeen'
import type { WorkspaceReading } from '../../../shared/workspace-reading'
import { useOverlays, type Overlay } from '../lib/overlay-store'
import { useSessionStore } from '../composables/useSessionStore'
import { LAUNCHER, useSurface } from '../composables/useSurface'
import type { LedgerWalk, PersonsDecision, PersonsQuestion } from '../../../shared/questions'
import type { StalledWork } from '../../../shared/stalled-work'
import type { StoppedWorkForAPerson } from '../../../shared/stopped-work'
import type { WorkIncident } from '../../../shared/work-incidents'
import type { WaitingOnWhoWrote } from '../../../shared/waiting-on-who-wrote'
import type { InstructionAskWaiting } from '../../../shared/own-instructions'
import type { AnswerAck, McpServerRequestForAPerson } from '../../../shared/runtime-ipc'
import type { FirstMessageCameTo, LaunchDoor, SendIntent } from '../lib/session-store'
import type { TranscriptMode } from '../lib/transcript-mode'
import { createWindow, openAt, prependPage, type WindowState } from '../lib/transcript-window'
import AppTitleBar from './AppTitleBar.vue'
import ConversationPane from './ConversationPane.vue'
import MessageLinks from './MessageLinks.vue'
import LinkedHistory from './LinkedHistory.vue'
import type { ResolvedMessageLink } from '../lib/message-links'
import { resolveMessageLink } from '../lib/runtime-message-links'
import DeleteConversation from './DeleteConversation.vue'
import IconSprite from './IconSprite.vue'
import NewConversation from './NewConversation.vue'
import { createLaunchGuard, saveFirstApproval } from '../lib/first-approval'
import OverlayHost, { provideOverlayLayer } from './OverlayHost.vue'
import { createPlaceHistory, type HistoryEntry, type Place } from '../lib/place-history'
import { aDialogIsOpen } from '../lib/a-dialog-is-open'
import { conversationTitle } from '../lib/conversation-list'
import { platformHere } from '../lib/this-computer'
import { provideMainTab, type MainTab } from '../composables/useMainTab'
import { providePlaceNavigator } from '../composables/usePlaceNavigator'
import NewAgent from './NewAgent.vue'
import StartAsAgent from './StartAsAgent.vue'
import ReadingPane from './ReadingPane.vue'
import SessionLibrary from './SessionLibrary.vue'
import SideRail from './SideRail.vue'
import { useRailFold } from '../composables/useRailFold'
import { listenProviderStates } from '../lib/provider-limit-facts'
import TeamWorkspace from './TeamWorkspace.vue'
import ToastStack from './ToastStack.vue'
import SettingsScreen, { type SettingsTab } from './SettingsScreen.vue'
import ProviderSetupAtLaunch from './ProviderSetupAtLaunch.vue'

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
const store = useSessionStore()
/**
 * The overlay layer. It sits ON TOP of whatever surface is showing rather than being another value
 * of `place` — an overlay is a question about the thing behind it, and closing it has to give that
 * thing back exactly as it was.
 */
const overlays = useOverlays()

/**
 * 🔴 **The agent identities, and the global spawning switch** (355) — rows, read once, kept for the
 * life of the window.
 *
 * ⛔ **Not `RuntimeBridge.profiles()`.** That is a `readdir` of `provider-homes/` and it answers the
 * launcher's menu; this is the `agent_identity` rows a grant can name and `admitGive` refuses
 * against. The two disagree, deliberately, and `AgentIdentities.foldersWithoutARow` is where the
 * difference is reported rather than hidden.
 */
const agentStore = useAgentStore()
const safety = useSpawnSafety()

/**
 * ⚑ **Throw the global spawning switch, and say when it could not be thrown** (355).
 *
 * ⛔ **The toast is the whole error path, and that is deliberate.** The rail row draws what the
 * store now holds — which on a refusal is what it held before — so a switch that did not move is
 * already visible. What the row cannot carry is WHY, and the app's one-line notice is where every
 * other *"that did not happen"* in this screen goes.
 */
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

async function setSpawning(enabled: boolean): Promise<void> {
  const refusal = await agentStore.setSpawning(enabled)
  if (refusal !== null) say(refusal)
}

/**
 * 🔴 **A person set the mode every conversation they start begins in** (500, HO-036 §3.1).
 *
 * ⚑ **{@link setSpawning}'s shape, one setting over**, and deliberately identical: the store
 * patches the held roster from what the DATABASE answered, this reports a refusal the same way, and
 * a person meets one grammar for both of the app-wide settings this app keeps in its LEDGER.
 * ⚠️ The three `localStorage` preferences above are app-wide too and are deliberately not this
 * shape: they are per-machine view state, which `usePersistentToggle` rules *"has no business in
 * the DB or over IPC"* — and this one decides what an agent does without asking.
 */
async function setApprovalDefault(mode: 'ask' | 'auto'): Promise<void> {
  const refusal = await agentStore.setApprovalDefault(mode)
  if (refusal !== null) say(refusal)
}

/**
 * 🔴 **This screen supplies the window's one emergency stop, and two surfaces draw it** (390).
 *
 * ⛔ **The rail's anchored switch and the overlay layer's safety lane are ONE state**, not two that
 * agree. `388` measured what the second one is for: every `OverlayHost` is a fixed `inset: 0`
 * `aria-modal` layer that covers the rail, so `385 §3`'s anchoring — real, and proved against
 * SCROLLING — left the stop unreachable by mouse and by Tab while any modal was open.
 *
 * ⚠️ **`watchEffect`, so it re-supplies on every read the store makes**, including the one
 * {@link refreshAgents} fires when an identity row is written anywhere in this app (`534`) and the
 * patch `AgentStore.setSpawning` applies from the database's own answer. ⚑ It is the SAME value the rail's identities section is
 * handed below — a conduit for one fact, not a second reader of it.
 */
watchEffect(() => {
  safety.supply(agentStore.identities.value, (enabled) => void setSpawning(enabled))
})

/**
 * 🔴 **The window's one person's queue** (401) — supplied below, drawn by *Waiting on you* and by
 * the overlay layer's corner. ⚑ `spawn-safety`'s shape one subject over, and for the same reason: two surfaces
 * that agree by construction rather than two that happen to.
 */
const persons = usePersonsQueue()

const rail = ref<InstanceType<typeof SideRail> | null>(null)
/** Whether the left menu is collapsed to its icons: by a press, or by a narrow window. */
const railFold = useRailFold()
/**
 * The Sessions page, when it is showing (151) — it re-reads its lists when the host says the
 * conversations moved, as the rail does.
 */
const library = ref<InstanceType<typeof SessionLibrary> | null>(null)
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
const { place, activeId, active, surface, view, showConversation } = useSurface(store)
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
  const said = await takeBackThrough(() => window.api.runtime.takeBackWork({ piece }))
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
 * A person answers a to-do through the host's `answerAction` door.
 * `null` when it took the answer, else its words, and the look runs again so the row leaves.
 */
async function answerATodo(
  sessionId: string,
  request: string,
  done: boolean,
  note: string,
): Promise<string | null> {
  try {
    const ack = await window.api.runtime.answerAction({
      sessionId,
      request,
      done,
      ...(note === '' ? {} : { note }),
    })
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
/**
 * A library entry this app holds no ledger for, being READ (047) — a conversation found in a
 * provider's folder and never imported, so there is no conversation to open: its view says so.
 *
 * Held here beside `place` rather than fetched inside the reading pane, for the same reason the
 * selected conversation is: the surface renders what it is handed, and the screen owns which one
 * that is.
 */
const reading = ref<{ entry: LibraryEntry; history: WindowState } | null>(null)

/**
 * ⚑ **D-017b · a library entry, pressed** — one this app records opens in its full view
 * ({@link openConversation}); one it holds no ledger for is read, and its view says why.
 */
function readFromTheLibrary(entry: LibraryEntry): void {
  if (entry.recordId) {
    void openConversation(entry.recordId)
    return
  }
  reading.value = { entry, history: createWindow() }
  place.value = 'reading'
}

/** Back to the list. The transcript is dropped with it — nothing here is worth keeping warm. */
function closeReading(): void {
  reading.value = null
  place.value = 'sessions'
}

/**
 * ⚑ **D-017b · open one conversation in its one full view** — every press that opens a conversation:
 * the rail's and the palette's rows, the room's and the Team page's, the forest's, a work report's
 * link, a queue row's travel and the library's rows.
 *
 * ⚑ One this window is fed is shown at once. Any other is looked at first ({@link SessionStore.look}):
 * the host hands it over — attached, taken when it runs with no window, or drawn from its ledger —
 * and it is shown only if the person has not moved meanwhile (`095`, `useSurface`'s rule).
 * ⛔ **Nothing is started**: a message sent from its view is what continues it.
 *
 * Resolves to whether it is on screen; a refusal is said in the host's own words.
 */
async function openConversation(
  sessionId: string,
  stillHere: () => boolean = () => true,
): Promise<boolean> {
  const from = view()
  const opened = store.isLive(sessionId) ? sessionId : await store.look(sessionId)
  if (opened === null) {
    say(refusedToOpen(store.lookError.value))
    return false
  }
  if (!stillHere()) return false
  showConversation(opened, from)
  return place.value === null && activeId.value === opened
}

type LinkedHistoryReading = { sessionId: string; title: string; history: WindowState }
interface MessageLinkPlace {
  view: ReturnType<typeof view>
  history: LinkedHistoryReading | null
  identity: string | null
}
const appElement = ref<HTMLElement | null>(null)
/** The main area, where each place draws its page. */
const mainArea = (): HTMLElement | null =>
  appElement.value?.querySelector<HTMLElement>('main.main') ?? null
const linkedIdentity = ref<string | null>(null)
const linkedHistory = ref<LinkedHistoryReading | null>(null)

function messageLinkPlace(): MessageLinkPlace {
  return { view: view(), history: linkedHistory.value, identity: linkedIdentity.value }
}

function stillAtLinkPlace(from: MessageLinkPlace): boolean {
  const now = view()
  return (
    now.place === from.view.place &&
    now.activeId === from.view.activeId &&
    linkedHistory.value === from.history &&
    linkedIdentity.value === from.identity
  )
}

/** After a link opened a place, the window's Back takes the focus, so a key press goes back. */
async function focusBack(): Promise<void> {
  await nextTick()
  appElement.value?.querySelector<HTMLButtonElement>('[data-cy="nav-back"]')?.focus()
}

/** Opening a link reads or selects; it never starts a conversation or answers its cards. */
async function openMessageDestination(answer: ResolvedMessageLink): Promise<boolean> {
  const from = messageLinkPlace()
  const destination = answer.opens
  if (destination === null || answer.state === 'unavailable') return false
  if ('identityId' in destination) {
    await agentStore.load()
    if (agentStore.loadError.value !== null) return false
    if (!agentStore.identities.value?.identities.some((one) => one.id === destination.identityId))
      return false
    if (!stillAtLinkPlace(from)) return false
    linkedHistory.value = null
    linkedIdentity.value = destination.identityId
    place.value = 'team'
    await focusBack()
    return true
  }
  if (answer.state === 'archived') {
    const page = await window.api.runtime.latestHistory({ sessionId: destination.sessionId })
    if (!stillAtLinkPlace(from)) return false
    const history = createWindow()
    openAt(history, page, destination.sessionId)
    linkedHistory.value = { sessionId: destination.sessionId, title: answer.title ?? '', history }
    return true
  }
  if (!(await openConversation(destination.sessionId, () => stillAtLinkPlace(from)))) return false
  linkedHistory.value = null
  linkedIdentity.value = null
  await focusBack()
  return true
}

/**
 * Back and Forward: the places this window has shown, as `place-history.ts` keeps them. A place is a
 * screen, a conversation (with its tab), a Team profile, a library entry being read, or an archived
 * conversation's read-only history. It is recorded by watching what the screen shows, so every way
 * of getting somewhere counts the same. Going there again only reads: a conversation is opened as
 * the sidebar opens it, and nothing is sent, started or answered.
 */
const mainTab = ref<MainTab>('conversation')
provideMainTab(mainTab)
const places = createPlaceHistory()
/** Set while Back or Forward puts a place on screen, so nothing reads that as a move of its own. */
let showingFromHistory = false
/** Moves whenever the history does, so what reads it draws again. */
const historyMoved = ref(0)
/**
 * Counts the places a person went to, so a step that finishes after they went on is dropped. A
 * different place or another tab of it is a move; the same place drawn again with a new name is not.
 */
let arrivals = 0

const SCREEN_NAME: Readonly<Record<string, string>> = {
  waiting: 'Waiting on you',
  away: 'Recent activity',
  new: 'New conversation',
  sessions: 'All conversations',
  team: 'Team',
  settings: 'Settings',
}

function conversationName(sessionId: string): string {
  // Read here rather than through `cast`: the watch below first runs before `cast` is declared.
  const row = useWhoCalledWhom().listedConversations.value?.find(
    (one) => one.sessionId === sessionId,
  )
  return row === undefined ? 'a conversation' : conversationTitle(row.label, row.named)
}

/** The place on screen now, or `null` while it shows nothing a person chose. */
function placeHere(): Place | null {
  const archive = linkedHistory.value
  if (archive !== null) {
    return {
      key: `archive:${archive.sessionId}`,
      name: archive.title === '' ? 'an archived conversation' : archive.title,
      conversation: archive.sessionId,
      identity: null,
      tab: null,
      payload: archive,
    }
  }
  const where = place.value
  if (where === 'team' && linkedIdentity.value !== null) {
    const id = linkedIdentity.value
    const one = agentStore.identities.value?.identities.find((each) => each.id === id)
    return {
      key: `profile:${id}`,
      name: one === undefined ? 'an agent' : (one.displayName ?? one.slug),
      conversation: null,
      identity: id,
      tab: null,
    }
  }
  if (where === 'reading') {
    const read = reading.value
    if (read === null) return null
    return {
      key: `reading:${read.entry.id}`,
      name: read.entry.title,
      conversation: null,
      identity: null,
      tab: null,
      payload: read.entry,
    }
  }
  if (where !== null) {
    return {
      key: `screen:${where === 'tools' || where === 'providers' ? 'settings' : where}`,
      name: SCREEN_NAME[where] ?? (where === 'tools' || where === 'providers' ? 'Settings' : where),
      conversation: null,
      identity: null,
      tab: where === 'settings' ? settingsTab.value : null,
    }
  }
  const id = activeId.value
  if (id === null) return null
  return {
    key: `conversation:${id}`,
    name: conversationName(id),
    conversation: id,
    identity: null,
    tab: mainTab.value,
  }
}

/** The page's scroller: the tallest box in the main area that scrolls. */
function mainScroller(): HTMLElement | null {
  const main = mainArea()
  if (main === null) return null
  let best: HTMLElement | null = null
  for (const one of main.querySelectorAll<HTMLElement>('*')) {
    if (one.scrollHeight <= one.clientHeight + 1) continue
    const overflow = getComputedStyle(one).overflowY
    if (overflow !== 'auto' && overflow !== 'scroll') continue
    if (best === null || one.clientHeight > best.clientHeight) best = one
  }
  return best
}

const scrollNow = (): number | null => mainScroller()?.scrollTop ?? null

// Whatever moved the screen, the place it shows now is recorded, before it is drawn, so the page
// being left still says where it was scrolled to.
watch(
  placeHere,
  (now) => {
    if (now === null) return
    const was = places.current()?.place
    if (!showingFromHistory && (was?.key !== now.key || was.tab !== now.tab)) arrivals += 1
    places.arrive(now, scrollNow)
    historyMoved.value += 1
  },
  // The first place too: a window that opens on the launcher can come back to it.
  { flush: 'pre', immediate: true },
)

// An archived history is read over the place it was opened from; moving to another place ends it.
watch(
  [place, activeId],
  () => {
    if (!showingFromHistory) linkedHistory.value = null
  },
  { flush: 'sync' },
)

const backTo = computed(() => {
  void historyMoved.value
  return places.next(-1)?.place.name ?? null
})
const forwardTo = computed(() => {
  void historyMoved.value
  return places.next(1)?.place.name ?? null
})

/** Read an archived conversation's newest page, for its read-only history. */
async function archiveReading(sessionId: string, title: string): Promise<LinkedHistoryReading> {
  const page = await window.api.runtime.latestHistory({ sessionId })
  const history = createWindow()
  openAt(history, page, sessionId)
  return { sessionId, title, history }
}

/**
 * What showing `entry` again needs, read before anything moves: `ready` with the archived page it
 * shows, if any; `gone` when its profile was removed; or `refused` with the host's words.
 */
type Readiness =
  | { kind: 'ready'; archive: LinkedHistoryReading | null }
  | { kind: 'gone' }
  | { kind: 'refused'; words: string }

async function readyToShow(entry: HistoryEntry): Promise<Readiness> {
  const target = entry.place
  if (target.identity !== null) {
    await agentStore.load()
    const known = agentStore.identities.value?.identities.some((one) => one.id === target.identity)
    return known === false ? { kind: 'gone' } : { kind: 'ready', archive: null }
  }
  const id = target.conversation
  if (id === null) return { kind: 'ready', archive: null }
  const archived = target.key.startsWith('archive:')
  if (!archived && store.get(id) !== null) return { kind: 'ready', archive: null }
  // The host is asked first, every time: deleted since, it is gone past; archived since, from here
  // or elsewhere, it comes back as its read-only history.
  const now = await window.api.runtime
    .resolveLink(`brocrew://conversation/${encodeURIComponent(id)}`)
    .catch(() => null)
  if (now?.state === 'deleted') return { kind: 'gone' }
  if (!archived && now?.state === 'archived') {
    places.markArchived([id], archiveKey)
    historyMoved.value += 1
  } else if (!archived) {
    if ((await store.look(id, 'again')) !== null) return { kind: 'ready', archive: null }
    return { kind: 'refused', words: refusedToOpen(store.lookError.value) }
  }
  // A page already read is shown again only once the host has said the conversation is there.
  const kept = target.payload as LinkedHistoryReading | undefined
  const there = now?.state === 'archived' || now?.state === 'available'
  if (archived && there && kept !== undefined) return { kind: 'ready', archive: kept }
  try {
    return { kind: 'ready', archive: await archiveReading(id, entry.place.name) }
  } catch (cause) {
    return { kind: 'refused', words: refusedToOpen(readableError(cause)) }
  }
}

const archiveKey = (conversation: string): string => `archive:${conversation}`

async function show(target: Place, archive: LinkedHistoryReading | null): Promise<void> {
  showingFromHistory = true
  try {
    if (archive !== null) {
      linkedIdentity.value = null
      linkedHistory.value = archive
      return
    }
    linkedHistory.value = null
    if (target.key.startsWith('conversation:') && target.conversation !== null) {
      linkedIdentity.value = null
      activeId.value = target.conversation
      place.value = null
      mainTab.value = (target.tab as MainTab | null) ?? 'conversation'
      return
    }
    if (target.key.startsWith('profile:')) {
      linkedIdentity.value = target.identity
      place.value = 'team'
      return
    }
    if (target.key.startsWith('reading:')) {
      reading.value = { entry: target.payload as LibraryEntry, history: createWindow() }
      place.value = 'reading'
      return
    }
    linkedIdentity.value = null
    const screen = target.key.slice('screen:'.length)
    if (screen === 'settings') openSettings((target.tab as SettingsTab | null) ?? 'providers')
    else place.value = screen
  } finally {
    await nextTick()
    showingFromHistory = false
  }
}

let travelling = false

/**
 * Whether a step read so far may now be taken: refused when the person went somewhere meanwhile,
 * or a dialog opened while it was read. Asked right before anything moves, after every wait.
 */
const mayMoveNow = (startedAt: number): boolean => arrivals === startedAt && !aDialogIsOpen()

/** A place's name at the start of a sentence: a name we have as it is, the fallbacks capitalised. */
const UNNAMED = new Set(['a conversation', 'an agent', 'an archived conversation'])
const sentenceStart = (name: string): string =>
  UNNAMED.has(name) ? name.charAt(0).toUpperCase() + name.slice(1) : name

/**
 * One step back (-1) or forward (1). Each place on the way is checked before anything moves: a
 * removed one is gone past and named, and one that can't be shown leaves the window and its place
 * in the history where they were. A person who goes somewhere meanwhile keeps their move.
 */
async function go(step: -1 | 1): Promise<void> {
  // A press while a step is under way is that step's, and does nothing more.
  if (travelling || aDialogIsOpen()) return
  travelling = true
  const startedAt = arrivals
  const looked: string[] = []
  try {
    for (;;) {
      const target = places.next(step)
      if (target === undefined) return
      const conversation = target.place.conversation
      const held = conversation !== null && store.get(conversation) !== null
      const ready = await readyToShow(target)
      if (conversation !== null && !held && store.get(conversation) !== null)
        looked.push(conversation)
      // The one wait before anything moves is over: from here to the step, nothing awaits.
      if (!mayMoveNow(startedAt)) return
      if (ready.kind === 'refused') {
        say(ready.words)
        return
      }
      if (ready.kind === 'gone') {
        const removed = target.place.identity ?? target.place.conversation
        if (removed === null) return
        places.markGone([removed])
        historyMoved.value += 1
        continue
      }
      const { reached, passed } = places.go(step, scrollNow)
      historyMoved.value += 1
      const way = step === -1 ? 'Back' : 'Forward'
      for (const one of passed)
        say(`${sentenceStart(one.place.name)} was deleted, so ${way} went past it.`)
      if (reached === undefined) return
      await show(reached.place, ready.archive)
      await nextTick()
      await new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      )
      const scroller = mainScroller()
      if (scroller !== null && reached.scroll !== null) scroller.scrollTop = reached.scroll
      // Focus left with the page it was on goes to the new page's heading, never to the body.
      const focused = document.activeElement
      if (focused === null || focused === document.body || !focused.isConnected) {
        const heading = mainArea()?.querySelector<HTMLElement>('h1, h2')
        if (heading) {
          if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1')
          heading.focus({ preventScroll: true })
        }
      }
      return
    }
  } finally {
    travelling = false
    // A conversation opened for a step that didn't happen is let go again.
    for (const id of looked) if (id !== onScreenNow.value) store.forget(id)
  }
}

providePlaceNavigator({
  backTo,
  forwardTo,
  back: () => void go(-1),
  forward: () => void go(1),
})

const onAMac = /mac/i.test(platformHere())

/** The step a key press asks for: ⌘[ and ⌘] on a Mac, Alt+← and Alt+→ elsewhere; else `null`. */
function historyKey(event: KeyboardEvent): -1 | 1 | null {
  if (onAMac) {
    if (!event.metaKey || event.ctrlKey || event.altKey) return null
    if (event.key === '[' || event.code === 'BracketLeft') return -1
    if (event.key === ']' || event.code === 'BracketRight') return 1
    return null
  }
  if (!event.altKey || event.ctrlKey || event.metaKey) return null
  if (event.key === 'ArrowLeft') return -1
  if (event.key === 'ArrowRight') return 1
  return null
}

/**
 * A mouse's side button can reach the window twice, as its own press and as main's push, in either
 * order. The other channel's event for the same step within this long is the same press: it is
 * paired with the press it belongs to and does nothing, and a press already paired takes no more.
 */
const SAME_PRESS_MS = 300
let lastPress: { step: -1 | 1; at: number; from: 'mouse' | 'main'; paired: boolean } | null = null

function pressed(step: -1 | 1, from: 'mouse' | 'main'): void {
  const now = Date.now()
  const before = lastPress
  if (
    before !== null &&
    !before.paired &&
    before.from !== from &&
    before.step === step &&
    now - before.at < SAME_PRESS_MS
  ) {
    before.paired = true
    return
  }
  lastPress = { step, at: now, from, paired: false }
  void go(step)
}

function onSideButton(event: MouseEvent): void {
  if (event.button !== 3 && event.button !== 4) return
  event.preventDefault()
  if (event.type !== 'mouseup') return
  pressed(event.button === 3 ? -1 : 1, 'mouse')
}

let stopHearingNavigate: (() => void) | null = null

async function olderLinkedHistory(): Promise<void> {
  const reading = linkedHistory.value
  if (reading === null) return
  const page = await window.api.runtime.earlierHistory({
    sessionId: reading.sessionId,
    before: reading.history.from,
  })
  if (linkedHistory.value === reading) prependPage(reading.history, page, reading.sessionId)
}

/**
 * 🔴 **The FALLBACK for an identity that has not said** (423, HO-023 §3) — no longer the answer.
 *
 * ⚠️ **Its own first sentence was false for two dispatches and is corrected here.** It read *"what
 * a new conversation starts on unless its settings say otherwise (005)"*, and `417 §3` measured
 * that there are no settings that say otherwise: nothing in this app can move a session's provider
 * once it is open. Codex is still the value, and still because that is the quota dogfooding can
 * spend; the header shows what any given conversation is actually running, and a reopened one keeps
 * whatever it was recorded with.
 *
 * ⛔ **What changed is its RANK, and `419` F3 wrote the line:** *"the dispatch that lands the roster
 * surface makes `DEFAULT_PROVIDER` the fallback for an identity that has not said."* The spawn door
 * has resolved `asked.provider ?? providerOf(profileId) ?? parent.provider` since `419` (and since
 * `682` a person's model choice in force before all three, on the spawn side only); a launch has no
 * parent, so the third term here is this constant. {@link frontDoorProvider} is that
 * resolution and it is the only reader of this name.
 *
 * The default comes from the shared provider registry. Live instruments derive the same
 * value from that declaration.
 */
const DEFAULT_PROVIDER: Provider = DEFAULT_CONVERSATION_PROVIDER

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

const frontDoorProvider = computed<Provider>(() =>
  readyProvider(
    // 🔴 **The asked term is FIRST, and it is the whole of `435`'s change here** (HO-025 §4). The
    // front door offers a provider again, and *which provider will this conversation start on* still
    // has exactly one derivation — this one. ⛔ The control does not preview the answer; it moves the
    // first term and reads the result back, so the sentence, the select and the payload cannot come
    // apart. See `providerForALaunch`'s own docblock for why the term is a parameter rather than a
    // `??` at this call site.
    providerForALaunch(
      agentStore.identities.value,
      DEFAULT_PROFILE_ID,
      DEFAULT_PROVIDER,
      launchChoices.value.provider,
    ),
    launchReadiness.value,
  ),
)

/**
 * 🔴 **The same resolution, for an identity that is not BroBot** (423 relay 1).
 *
 * ⛔ **One function, two doors, and the second is what makes the first observable.** Nothing a
 * person can press writes `default`'s provider on an app that has run a conversation — see
 * {@link frontDoorProvider} — so until this door existed, `providerForALaunch`'s first term could
 * only fire in one state. ⚑ **An identity a person CREATED can say what it runs on**, and this is
 * where that answer is spent: create `archivist` on Claude, open a conversation as it, and it runs
 * on Claude while the front door goes on running on the frame's own fallback.
 *
 * ⚠️ **A function and not a computed**, because the argument is the overlay's and changes with it;
 * the roster it reads is reactive, so the sheet's sentence still follows a create underneath it.
 */
function providerForAgent(profileSlug: string): Provider {
  return providerForALaunch(agentStore.identities.value, profileSlug, DEFAULT_PROVIDER)
}

/**
 * ⚑ **What the Team card calls this identity** (626) — `providerForAgent`'s shape one question over.
 *
 * ⛔ **`agentName` and not a name composed here**, because it is the SAME derivation `team-roster.ts`
 * uses for `member.heading`: the sheet a person opens from a card must not call the agent something
 * the card did not. ⚠️ Resolved on every render from the live roster rather than snapshotted onto
 * the overlay member, which is that member's own rule.
 */
function agentHeadingFor(profileSlug: string): string {
  // ⚠️ **The inner list, which is what `team-roster.ts` passes too** — `AgentIdentities` is the
  // whole reading and carries `use`, the folders and the registry beside the rows.
  return agentName(profileSlug, agentStore.identities.value?.identities ?? null)
}

/**
 * 🔴 **Start a conversation that was PLACED** (423 relay 1) — the second door's landing.
 *
 * ⛔ **`start` itself, and not a second flow.** Everything that makes a launch a launch — the
 * roster re-read, the profile re-read, the first message going through `store.send` — is that
 * function's, and a copy here would be the second implementation `013` spent a dispatch removing
 * from the composer.
 *
 * ## 🔴 718 · `710` F-9 — the refusal is drawn where the person pressed
 *
 * ⛔ **This closed the sheet UNCONDITIONALLY, before the launch was asked**, on the claim that the
 * refusal *"is shown where every other launch failure is shown"*. ⚠️ Traced, that place is
 * `NewConversation` alone (`store.launchError`), which is not on screen while a person starts a
 * conversation from a Team card — so a refused start showed NOWHERE, and the words typed into the
 * sheet went with it (`firstMessageBelongsTo` hands them to the launcher's slot, and only for a
 * cancelled launch). ⚑ Now the sheet stays up while its launch runs — the composer's own `starting`
 * state and Cancel ({@link SessionStore.isPlacing}) — and closes only when the conversation OPENS.
 * A refusal lands in the sheet, as `store.placedError`, with the words back in its box.
 *
 * ⚠️ **A sheet no longer on screen has nowhere to draw it.** Closing one cancels its launch
 * ({@link closeOverlay}), so what reaches this is a sheet REPLACED by another overlay while its launch
 * ran — and its refusal is said in the window-wide notice instead, `100`'s *a refusal is SAID, not
 * swallowed*. The decision is {@link afterAPlacedLaunch}'s, as data. ⛔ Compared by the overlay OBJECT the press
 * came from ({@link placedFrom}), so a sheet opened afresh afterwards — even for the same agent — is
 * not mistaken for the one that asked, and shows neither its `starting` nor its refusal.
 * ⚑ **The refusal is THIS launch's own** (`told.refused`, `forLaunch`'s rule since `718`'s review):
 * a later sheet's launch cannot inherit it, and it is said once.
 */
function startPlaced(
  input: CreateSessionInput,
  firstMessage: string,
  attachments: HandedPath[],
): void {
  const sheet = overlays.overlay.value
  placedFrom.value = sheet
  const stillThere = (): boolean => sheet !== null && overlays.overlay.value === sheet
  let refusal: string | null = null
  void start(input, firstMessage, attachments, 'sheet', {
    opened: () => {
      if (afterAPlacedLaunch({ kind: 'opened' }, stillThere()).close) overlays.close()
    },
    refused: (sentence) => {
      refusal = sentence
    },
  }).then(() => {
    if (refusal === null) return
    const { notice } = afterAPlacedLaunch({ kind: 'refused', sentence: refusal }, stillThere())
    if (notice !== null) overlays.notify(notice)
  })
}
/**
 * ⚑ **718 · the sheet the last placed launch was pressed in** — so the store's ONE sheet launch
 * and ONE sheet refusal ({@link SessionStore.isPlacing}, `placedError`) are drawn only by the
 * sheet that asked for them. See {@link startPlaced}.
 */
const placedFrom = shallowRef<unknown>(null)
const placedHere = computed(
  () => placedFrom.value !== null && placedFrom.value === overlays.overlay.value,
)

/**
 * 🔴 **718 · closing the StartAsAgent sheet while its launch runs CANCELS that launch** (`718`'s
 * second review round).
 *
 * ⛔ **The sheet is that launch's only Cancel, and the only surface that can draw its refusal or
 * hand its words back.** Closed — its ×, Esc, or a press on the backdrop — the launch ran on with
 * nothing anywhere that could stop it (a fresh sheet is not the one that asked, so it offers no
 * Cancel), and a refusal then took the typed words with it. ⚑ So closing it means what a person
 * closing a sheet that says *starting* means: never mind. `102`'s rule makes a cancel say nothing.
 * ⚠️ A launch that answered first still opens its conversation — the close lost that race — and a
 * refusal that did is said by {@link startPlaced}, as ever.
 *
 * ⛔ **Every overlay closes through here**, so the rule cannot be skipped by a way of closing that
 * forgot it; for any other overlay {@link placedHere} is false and this is `overlays.close()`.
 */
function closeOverlay(): void {
  if (placedHere.value && store.isPlacing()) void store.cancelPlaced()
  overlays.close()
}

/** What a screen reader calls the open sheet: the words its own title shows. */
function overlayLabel(overlay: Overlay): string {
  switch (overlay.kind) {
    case 'newAgent':
      return 'New agent'
    case 'externalMcpServers':
      return 'External tools'
    case 'agentSections':
      return 'Agent knowledge'
    case 'agentCapabilities':
      return agentHeadingFor(overlay.profileSlug)
    case 'startAsAgent':
      return `New conversation as ${agentHeadingFor(overlay.profileSlug)}`
    case 'deleteConversation':
      return 'Delete a conversation'
  }
}
const notice = ref<string | null>(null)

const info = ref<AppInfo | null>(null)
const infoError = ref<string | null>(null)

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
async function readPrograms(): Promise<void> {
  const ask = window.api.runtime.providerVersions
  if (typeof ask !== 'function') return
  try {
    const versions = await ask()
    const found: Partial<Record<Provider, ProviderProgram>> = {}
    for (const [provider, version] of Object.entries(versions) as [Provider, ProviderVersion][]) {
      if (version.program !== undefined) found[provider] = version.program
    }
    programs.value = found
  } catch {
    // said on the Providers screen
  }
}
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
const modelLists = useModelLists()
const launchSignIns = Object.fromEntries(
  (Object.keys(PROVIDER_NAME) as Provider[]).map((provider) => [
    provider,
    useProfileSignIn(provider, DEFAULT_PROFILE_ID),
  ]),
) as Record<Provider, ReturnType<typeof useProfileSignIn>>
const launchReadiness = computed(
  () =>
    Object.fromEntries(
      (Object.keys(PROVIDER_NAME) as Provider[]).map((provider) => [
        provider,
        providerReady(
          modelLists.held(provider),
          launchSignIns[provider].auth,
          programs.value?.[provider],
        ),
      ]),
    ) as Record<Provider, boolean | null>,
)

/**
 * ⚑ **A person's pick in the open conversation, carried out** — see `pickInAConversation`.
 */
function pickModelForActive(pick: PickedModel): Promise<WhatAPickBecame | null | undefined> {
  const id = activeId.value
  return id === null ? Promise.resolve(undefined) : pickInAConversation(store, id, pick)
}

/**
 * 🔴 **A credential gesture settled for this profile, so what we hold about it is no longer news.**
 *
 * ⛔ **Found reviewing 257's own diff, and without it §2's invalidation reaches nobody.** The host
 * drops that home's memoized catalogue when a sign-in or a re-copy finishes — but this screen
 * remembers which profiles it has already asked about, so the menu on the page would go on showing
 * the account the person just signed OUT of, for the rest of the app run. The host forgetting and
 * the surface never re-asking is a fix that works perfectly and changes nothing anyone can see.
 *
 * ⚠️ Re-asked immediately rather than on the next mount, because the gesture IS the moment: somebody
 * has just signed this profile in and is looking at the menu it should have changed. One provider
 * child per gesture, and nothing on a timer.
 */
function authChangedFor(profileId: string): void {
  // ⛔ **This DISOWNS the read in flight as well as forgetting the answer** (293 §5). Without the
  // ticket, a read started under the previous account was free to land after the replacement.
  modelLists.forget(profileId)
  for (const shown of listsShown.value) {
    if (shown.profileId === profileId) void modelLists.read(shown.provider, shown.profileId)
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
    profiles.value = await window.api.runtime.profiles()
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
 * Digest first: lifecycle noise and provider chatter are hidden until asked for, and the raw
 * event stream comes with the asking.
 */
const debug = usePersistentToggle('brobot2.debugMode', false)
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
 * ⚑ **W4.13 · debug mode** — off, the developer views are not offered, and a panel on one (now, or
 * kept from a run with it on) moves to the panel's default tab.
 */
const debugMode = useDebugMode()
const hiddenTabs = computed(() => hiddenDrawerTabs(debugMode.value))
watch(
  [drawerTab, hiddenTabs],
  ([tab, hidden]) => {
    drawerTab.value = offeredTab(tab, hidden)
  },
  { immediate: true },
)

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
watch(frontDoorProvider, (provider, before) => {
  if (provider !== before && launchChoices.value.provider !== provider)
    launchChoices.value = { ...launchChoices.value, provider, model: '', reasoningEffort: '' }
})

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
  bridge: window.api,
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

const mode = computed<TranscriptMode>(() => (debug.value ? 'debug' : 'normal'))

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
  const refused = drafts.restore(slot, text, attachments)
  if (refused > 0) say(attachmentsNotRestored(refused))
}

/**
 * ⚑ **718 · what {@link start} tells the surface that pressed** — the sheet's two moments
 * ({@link startPlaced}): the conversation opened, or THIS launch was refused, in the host's words.
 */
interface LaunchTold {
  navigated?(): void
  opened?(): void
  refused?(sentence: string): void
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
  await frontDoorLaunch.run((release) =>
    start(input, firstMessage, attachments, 'front-door', { navigated: release }),
  )
}

async function start(
  input: CreateSessionInput,
  firstMessage: string,
  attachments: HandedPath[] = [],
  door: LaunchDoor = 'front-door',
  told: LaunchTold = {},
): Promise<void> {
  const from = view()
  const sessionId = await store.create(input, door, told.refused)
  // 🔴 **534 · `if (sessionId) refreshAgents()` used to be here and it has been retired.**
  //
  // `355` put it here because *"a conversation that opened may have brought an identity into
  // being"* — true, and written by `ensureIdentityRow` inside the same `store.create` the host
  // runs from `register`. ⛔ **That is now where it is announced from**, so the rule lives beside
  // the write instead of beside one of the callers that can cause it — and the caller it was never
  // beside was an agent's own start (`spawn_agent` then, `give_work` since D-016), which is how
  // `534` got a rail that had never heard of an identity a project manager made.
  // Left where it was typed on failure: the launcher's own slot still holds it (NewConversation
  // hands it back), and no conversation that did not write it can end up with it. The composer
  // emptied that slot itself on send, so there is nothing to clear here on the way past.
  if (!sessionId) {
    // ⚑ **718 · the sheet keeps its own words** (`710` F-9): its composer hands them back when its
    // launch settles refused, exactly as the launcher's does (`shouldRestoreDraft`), so nothing is
    // written into the LAUNCHER's slot for a press that was not made there.
    if (door === 'sheet') return
    const home = firstMessageBelongsTo({
      opened: sessionId,
      launchError: store.launchError.value,
      sendError: null,
    })
    if (home === 'launcher') {
      // ⛔ **Both halves, through the book's own restore** (217). `drafts.write` returned the words
      // and left the paths where the composer had already cleared them — a draft that looks whole
      // and is not, which is `211`'s defect wearing a new coat and exactly what §2 names.
      restoreRefused(draftSlot(null), firstMessage, attachments)
    }
    return
  }
  if (door === 'front-door') {
    const refusal = await saveFirstApproval(
      sessionId,
      input.approvalMode,
      agentStore.identities.value?.defaultApprovalModeChosen,
      (mode) => agentStore.setApprovalDefault(mode),
    )
    if (refusal !== null) {
      store.launchError.value = refusal
      restoreRefused(draftSlot(null), firstMessage, attachments)
      return
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
  await store.send(sessionId, firstMessage, 'now', attachments)
  // ⛔ **The session opened and its first message did not get out** (221 §2). The conversation is
  // kept — see {@link firstMessageBelongsTo} for why closing it would replace a row you can act on
  // with one you cannot — and the words come back in ITS composer, one press from going out.
  const home = firstMessageBelongsTo({
    opened: sessionId,
    launchError: null,
    sendError: store.get(sessionId)?.error ?? null,
  })
  if (home === 'conversation') restoreRefused(draftKey(sessionId), firstMessage, attachments)
}

/**
 * 🔴 **What this window has open as one identity** (470, HO-028 §3) — the grant sheet's offer.
 *
 * ⛔ **Here and not in the sheet**, which is {@link providerForAgent}'s rule on a second value: a
 * surface that re-derived it could disagree with the rail about which conversations are open, and
 * the two are one press apart.
 *
 * ⚠️ **`store.live` is what THIS WINDOW holds** — a conversation the host is running that this
 * window never opened is not in it, and `running` on the wire is per-host, so the sheet is told to
 * treat an empty list as *nothing to offer* and never as *nothing is running*. See
 * {@link AConversationToReopen}.
 *
 * ⚑ **A computed, and LAZY is what makes it affordable.** {@link conversationsToReopen} walks each
 * open conversation's fold through `sessionPanel`, which is a pass over its items — so it is read
 * in exactly one place, inside the overlay branch that draws this sheet, and a window with no
 * grant sheet open never evaluates it at all. ⛔ **A function would repeat that walk on every
 * render of this screen**, which is every event any open conversation receives; the computed
 * repeats it only when one of those folds actually moves. ⚠️ The guard is what keeps the
 * dependency from being taken while another overlay is up.
 */
const openAsForSheet = computed<readonly AConversationToReopen[]>(() => {
  const overlay = overlays.overlay.value
  if (overlay === null || overlay.kind !== 'agentCapabilities') return []
  // ⚑ **678 · no longer which of them is the selected one** — R26: every draft survives the reopen.
  return conversationsToReopen(store.live.value, overlay.profileSlug)
})

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
    const outcome = await archiveConversation(window.api.runtime, sessionId)
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
 * 🔴 **The grant sheet's reopen: do not move the window, and SAY it if it fails** (470, review).
 *
 * ⚑ **`overlays.notify` is the one lane that paints above the host** (`ToastStack`) — every other
 * lane paints UNDER `OverlayHost`'s dimmed, `aria-modal` scrim, where a person cannot see it. ⛔ **No
 * new sentence**: it carries the store's own refusal.
 */
async function reopenForGrant(sessionId: string): Promise<void> {
  if (await closeAndReopen(sessionId, false)) return
  // ⚠️ **`resumeError` OR the record's own** — a close that failed put its sentence on the record,
  // and a cancelled launch deliberately sets neither, which is a gesture the person made.
  const said = store.resumeError.value ?? store.get(sessionId)?.error ?? null
  if (said !== null) overlays.notify(said)
}

/**
 * Move this conversation onto the machine's current Claude sign-in (147) — close the child holding
 * the superseded credential, then reopen, which re-reads the Keychain.
 *
 * ⚑ **A named caller over {@link closeAndReopen} rather than the gesture itself**, because the two
 * callers differ in WHY: this one is the Keychain, and the grant sheet's is the row `admitGive`
 * reads. ⛔ The reasoning for doing both halves as one gesture moved with the body.
 *
 * The reopen reports through the same `resumeError` every other reopen does, so a machine login that
 * has since expired says so in the place the user is already looking.
 */
async function reopenSignIn(sessionId: string): Promise<void> {
  await closeAndReopen(sessionId)
}

/**
 * 🔴 **Close one conversation and open it again, as one gesture** — {@link reopenSignIn}'s body,
 * lifted at `470` because HO-028 §3 gave it a second caller.
 *
 * ⚑ **Close AND resume, as one gesture, because half of it is a worse state than either end.** A
 * close alone leaves the user with an ended conversation and a Resume they now have to find; a
 * resume alone is refused, since `resumeSession` hands back the session already running rather than
 * spawning a second child onto the same transcript.
 *
 * ⚠️ **That paragraph was DELETED rather than lifted when this body was**, and `470 · relay 1`
 * found two live pointers still aimed at it — {@link reopenSignIn} saying the reasoning *"moved
 * with the body"* and `CapabilitiesSheet`'s `reopen` emit quoting it as something `RuntimeScreen`
 * says. ⛔ **Both were true of no file**, which is `a-pointer-clause-is-a-claim` with the claim
 * pointing at a sentence the same commit removed.
 *
 * ⛔ **A close that failed leaves the old child alive**; reopening on top of it would attach to
 * that very session and report success. Its sentence is already on the record, so there is nothing
 * to add here.
 *
 * ⚠️ **The two callers want the same thing for different reasons** — `147` the machine's current
 * credential, HO-028 §3 the grant this app now holds; both are facts a provider is handed at
 * launch and never again, and both are *"their press, never ours"*.
 *
 * ⛔ **They differ in one thing and review is what found it: WHERE THE PERSON IS STANDING.** The
 * sign-in bar is inside the conversation it reopens, so the move is a self-assignment and the
 * refusal lands on the surface being looked at. ⚑ The grant sheet is a modal over anything, so it
 * passes `show: false` and says the refusal itself — see the mount.
 *
 * @returns whether the conversation is open again. ⚠️ `false` covers both halves: a close that
 *   failed (whose sentence is on the record) and a resume that was refused (whose sentence is
 *   `store.resumeError`).
 */
async function closeAndReopen(sessionId: string, show = true): Promise<boolean> {
  // ⚠️ **`from` is read BEFORE the awaits** (095): a close and a start take as long as a provider
  // takes, and a person who moved meanwhile is not moved back.
  const from = view()
  // 🔴 **678 · R26 — the draft survives the reopen** — held from BEFORE the close, because the close
  // is what the sweep reacts to (`sweepDrafts`).
  return draftSweep.reopening(sessionId, async () => {
    const closed = await store.close(sessionId)
    if (!closed) return false
    const opened = await store.resume(sessionId)
    // 🔴 **470 · `show` is FALSE for the grant sheet's caller**: it can be opened over any surface,
    // and a press on a row for another conversation must not walk the window there behind a modal.
    if (opened !== null && show) showConversation(opened, from)
    return opened !== null
  })
}

/** ⚑ **D-017b · a row pressed** — the conversation opens in its full view ({@link openConversation}). */
function select(sessionId: string): void {
  void openConversation(sessionId)
}

/**
 * Send, and if it does not get through, PUT THE TEXT BACK (077).
 *
 * ⚠️ **The composer clears the box the instant it emits**, so without this a refused send takes the
 * message with it. *"A silently dropped message is the worst outcome"* is the dispatch's own
 * standard, and losing it in the renderer would fail that standard just as completely as losing it in
 * the host.
 *
 * Written to the slot the message CAME FROM, keyed by conversation (019) rather than to whatever is
 * on screen when the command finally settles — an await is long enough to change threads in.
 *
 * ⚑ **D-017b · a recorded conversation is continued by what is sent to it** ({@link continueIt}) —
 * and while that start is on its way in, a second message waits behind it (the host queues it behind
 * the start, D-017 · R1).
 */
function send(text: string, intent: SendIntent = 'now', attachments: HandedPath[] = []): void {
  const sessionId = activeId.value
  if (!sessionId) return
  const slot = draftKey(sessionId)
  const starting = store.isLaunching(sessionId)
  if (store.get(sessionId)?.phase === 'recorded' && !starting) {
    void continueIt(sessionId, text, attachments, true)
    return
  }
  // ⛔ **`attachments` comes from the EVENT, not from the book** (216). It was read from the book
  // here — except it was not read at all, and every attachment a person made was cleared from the
  // composer and dropped. Carried on the send event, this cannot be forgotten again.
  void store.send(sessionId, text, starting ? 'queue' : intent, attachments).then((ok) => {
    // ⛔ **The words and the paths go back together, and each guards itself** — the rule lives in
    // the book (see {@link DraftBook.restore}) rather than here, because nothing mounts this
    // component and a rule the mutation table cannot reach is a rule nobody is checking.
    if (!ok) restoreRefused(slot, text, attachments)
  })
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
): Promise<void> {
  const from = view()
  const answer: { came: FirstMessageCameTo | null } = { came: null }
  await draftSweep.reopening(sessionId, async () => {
    answer.came = await store.startAndSend(sessionId, text, attachments)
    return answer.came?.openHere ?? false
  })
  const came = answer.came
  if (giveTheWordsBack && (came === null || !came.sent)) {
    restoreRefused(draftKey(came?.tookItsPlace ?? sessionId), text, attachments)
  }
  if (came?.tookItsPlace !== undefined && came.openHere) showConversation(came.tookItsPlace, from)
}

/**
 * 🔴 **718 · `R60` — *"Compact now…"*, confirmed: the person's `/compact`, through the send door.**
 *
 * ⚑ **`store.send`, the composer's own door**, so the host decides it exactly as it decides a typed
 * `/compact` — the person's turn, the provider's road, every refusal. ⛔ **Not {@link send}**: that
 * one writes a refused message back into the composer's draft, and a person who pressed a button in
 * the drawer did not type these words — a refusal is drawn beside the conversation by the pane
 * (`session-error`), as every refused send is, and their draft is left as they left it.
 * ⚑ **D-017b** — a recorded conversation takes it as it takes any message ({@link continueIt}).
 */
function compactNow(intent: 'now' | 'queue'): void {
  const sessionId = activeId.value
  if (!sessionId) return
  if (store.get(sessionId)?.phase === 'recorded' && !store.isLaunching(sessionId)) {
    void continueIt(sessionId, THE_COMPACT_COMMAND, [], false)
    return
  }
  void store.send(sessionId, THE_COMPACT_COMMAND, intent, [])
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

/**
 * ⛔ **`null` until the first reading lands** (636) — *nobody has looked*, which every surface
 * draws as nothing at all rather than as *nothing is waiting*. See `WaitReading`, where the
 * three absences are told apart. ⚑ **Declared above {@link needsYou}**, whose words read it (D-017 · R19)
 * and which a watch reads as soon as the screen is set up.
 */
const conversationWaits = ref<WhatEachConversationIsWaitingOn | null>(null)

/**
 * ⛔ **Everything that needs the user, across every open conversation** (205, from 195 H3).
 *
 * Projected HERE, once, because this is where the records are — and handed to *Waiting on you* and
 * to the rail as data. Two components deriving it themselves is the shape 099 measured going wrong.
 *
 * ⚑ **`standingWord(recordFacets(record))` is 203's word, reused rather than restated.** The rail
 * draws its rows from the same two calls, so a conversation cannot be `needs you: permission` in
 * one place and something else in the other.
 */
const needsYou = computed<AttentionRequest[]>(() =>
  attentionQueue(
    store.live.value,
    (record) => {
      // ⚑ **D-017 · R11** — in the ONE state's words (`stateHere`), as the rail row says them: off
      // the same reading, so who owes it the next move is the host's verdict here too (R19).
      const facets = recordFacets(
        record,
        theWaitIn(conversationWaits.value, record.sessionId),
        theWorkIn(conversationWaits.value, record.sessionId),
        // ⚑ **F036** — who waits on its answer, off the host's state of it (the rail's listed row).
        whoItOwesIn(rail.value?.listedOf(record.sessionId)?.state),
      )
      return standingWord(
        facets,
        stateHere(
          record,
          facets,
          whoseAnswerIn(conversationWaits.value, record.sessionId),
          whoseWorkIn(conversationWaits.value, record.sessionId),
          {},
          stoppedWorkIn(conversationWaits.value, record.sessionId),
        ),
      )
    },
    // ⚑ **714 · R41** — the identity each waiting row's conversation runs as
    // (`AttentionRequest.who`), named over the roster.
    agentHeadingFor,
  ),
)

/**
 * ⚑ **D-017 · R19 — what *Waiting on you* and its counts take from this window**: the cards no host
 * read lists ({@link listedNowhereElse}). ⛔ Everything else there is the host's read over every
 * conversation, so what waits on a person never depends on which conversations this window holds.
 * ⚠️ {@link needsYou} stays whole for the queue's rows, which take their answers off a live card
 * wherever this window holds one.
 */
const waitingHere = computed(() => listedNowhereElse(needsYou.value))

/**
 * 🔴 **Every card this window has answered, by the key the queue rows carry** (468, `453` weak
 * point 1) — see `answeredFromHere`, which is where the derivation and its argument live.
 *
 * ⚑ **A press is answered in one tick and the LIST is answered in up to five seconds**, and
 * between those two moments the row fell into the branch for *this window holds the conversation
 * and the card is not in the page it holds* — which told a person to go and answer a card they had
 * just answered. ⛔ Nothing between those two events is wrong; the sentence drawn across them was.
 */
const answered = computed(() => answeredFromHere(store.live.value))

/**
 * ⛔ **The rail's *Waiting on you* badge counts what that page calls WORK** (305 §1, narrowed by
 * 468).
 *
 * ⚑ **The same function *Waiting on you* calls, on the same inputs**, so a badge and the screen it
 * opens cannot come to different numbers — a pure call from two places is one source, which is the
 * shape `permission-offer.ts` settled in 299.
 *
 * ⚠️ **Stated without a COUNT since `401`**, and the count is why: this said *"the same two
 * inputs"*, `401` added a third, and `homeAttention`'s new argument is OPTIONAL — so leaving it
 * off here compiled, ran, and made the rail draw no badge over a question escalated to a person
 * while the screen that button opens listed it. ⛔ `304`'s contradiction, re-created inside the
 * dispatch that cites it. `persons-queue.test.ts` §6 pins that every call site in this component
 * passes them all.
 */
const homeNeedsYou = computed(() =>
  homeAttention({
    // ⚑ **D-017 · R19** — {@link waitingHere}, and the instruction asks beside the queue's rows,
    // read off the queue module as *Waiting on you* and the corner read them. ⚑ **F097** — and the
    // work whose agent answered a person, read the same way.
    requests: waitingHere.value,
    // ⚑ …and the agents a person has to choose a provider for, as that page counts them.
    onlyYou:
      (persons.view.value?.count ?? 0) +
      (persons.asks.value?.rows.length ?? 0) +
      (persons.serverRequests.value?.rows.length ?? 0) +
      (persons.waitingOnWhoWrote.value?.rows.length ?? 0) +
      persons.workWaits.value.todos.rows.length +
      persons.workWaits.value.incidents.rows.length +
      providersNotChosenIn(agentStore.identities.value).length,
    // 🔴 **453 · `mayBeShort`, and it is a FIX rather than a rename.** ⛔ This call site passed
    // `partial` alone while another passed `partial || stale` — `434` widened one of the two — so
    // the rail's summary could say the workspace was quiet over a list that stopped answering. ⚑ The disjunction is derived on the view now, so the two cannot diverge again.
    // ⚑ **678 · on the queue**, so it covers the stalled band's two holes as well — the Waiting-on-you
    // page draws that band now, and this line and that page answer the same question.
    // ⚑ **D-017 · R19** — the field covers a look for the asks that has not answered, too.
    unread: persons.mayBeShort.value,
  }),
)

/** The native signs use exactly the count and populations the Waiting on you page draws. */
syncAttentionSignals(
  computed(() => ({
    count: homeNeedsYou.value.total,
    populations: [
      {
        name: 'requests',
        ready: persons.view.value !== null && !persons.view.value.partial,
        keys: [...waitingHere.value, ...(persons.view.value?.rows ?? [])].map(
          (row) => `request:${row.key}`,
        ),
      },
      {
        name: 'instructions',
        ready: persons.asks.value !== null && !persons.asks.value.partial,
        keys: (persons.asks.value?.rows ?? []).map((row) => `instruction:${row.askId}`),
      },
      {
        name: 'servers',
        ready: persons.serverRequests.value !== null && !persons.serverRequests.value.partial,
        keys: (persons.serverRequests.value?.rows ?? []).map((row) => `server:${row.requestId}`),
      },
      {
        name: 'replies',
        ready: persons.waitingOnWhoWrote.value !== null && !persons.waitingOnWhoWrote.value.unread,
        keys: (persons.waitingOnWhoWrote.value?.rows ?? []).map((row) => `reply:${row.key}`),
      },
      {
        name: 'todos',
        ready: persons.attentionReady.value.todos,
        keys: persons.workWaits.value.todos.rows.map((row) => `todo:${row.key}`),
      },
      {
        name: 'incidents',
        ready: persons.attentionReady.value.incidents,
        keys: persons.workWaits.value.incidents.rows.map((row) => `incident:${row.key}`),
      },
      {
        name: 'providers',
        ready: agentStore.identities.value !== null,
        keys: providersNotChosenIn(agentStore.identities.value).map(
          (row) => `provider:${row.slug}`,
        ),
      },
    ],
  })),
  // A hot reload may retain the previous preload until the next app launch.
  (signal) => window.api.attentionSignals?.(signal) ?? Promise.resolve(),
)

/**
 * ⛔ **A clock that ticks ONLY while something is waiting** (205).
 *
 * The queue's whole argument is *"how long has this been frozen"*, and an age is a lie the moment it
 * stops moving: 195's 63 seconds would have read as one fixed number for the rest of the session if
 * the clock were sampled once.
 *
 * ⚠️ **One second, because that is the resolution `agoWords` actually prints.** Its first band is
 * `${seconds}s ago` — checked, not assumed — so a ten-second tick would show `40s` for a card that
 * had been frozen for 49, on the surface whose entire purpose is that number. Above a minute it
 * repaints without changing a word, which costs a diff of a handful of rows.
 *
 * ⛔ **The interval exists ONLY while there is a row to age.** A timer that re-renders the window
 * forever on an empty dashboard is the cost 099 spent a dispatch removing from the rail.
 */
const clock = ref(Date.now())
let ticking: ReturnType<typeof setInterval> | null = null
watch(
  // ⚑ **401 joins the condition rather than adding a second timer.** The escalated rows carry an
  // age too — *how long has this been yours* is the whole argument for that surface as much as for
  // this one — and a conversation can be escalated with nothing pending in this window at all.
  // ⚑ W4.63 · and while a provider's limit stands: the Providers card says when it lifts, by day.
  // ⚑ F097 · and while a reply is owed or work has stopped: each of those rows says how long ago,
  // and a clock that stood still would say *0s ago* for hours.
  () =>
    needsYou.value.length > 0 ||
    (persons.view.value?.count ?? 0) > 0 ||
    (persons.limits.value?.walls.length ?? 0) > 0 ||
    (persons.waitingOnWhoWrote.value?.rows.length ?? 0) > 0 ||
    (persons.stalled.value?.rows.length ?? 0) > 0,
  (waiting) => {
    if (waiting && ticking === null) {
      clock.value = Date.now()
      ticking = setInterval(() => (clock.value = Date.now()), 1_000)
    }
    if (!waiting && ticking !== null) {
      clearInterval(ticking)
      ticking = null
    }
  },
  { immediate: true },
)
onUnmounted(() => {
  if (ticking !== null) clearInterval(ticking)
})

/**
 * 🔴 **This screen does the LOOKING for the queue that ends at a person** (401, criterion 11).
 *
 * ## ⛔ It is a poll because nothing pushes, and that is measured rather than assumed
 *
 * ⚠️ **Three independent facts, each sufficient on its own.** (1) `request_routed` is written
 * into the ledger of the CHILD that asked, and a child a PM spawned is reserved under no owner —
 * its sink is the discard, so `emitOurs` returns before it sends. (2) A row for a conversation the
 * host is not running is written straight to the database with no wire message at all. (3) Even in
 * the window that does own the child, `transcript.ts` draws nothing for that row at all — it
 * returns, for `437`'s reason: the words are already on the page twice.
 *
 * ⚑ **612 · the three facts named `request_escalated` until `HO-088` §3.1 removed the only thing
 * that wrote one.** ⛔ **Every one of them is unchanged and the SUBJECT moved**, which is the
 * strongest form this argument has ever had: the row that reaches a person now is the ROUTING
 * itself, written by `ask_question` or `pass_question_up` in the asker's own ledger.
 *
 * ⛔ **So the ONLY way this window can know is to ask**, and the cadence is `LOOK_EVERY_MS`.
 *
 * ## ⛔ It is NOT gated on this window's own conversations, and the first version was
 *
 * 🔴 **`store.live` and the population this queue is about are disjoint, which is the whole
 * point of the queue.** The row is written for a session the HOST is running, and the ordinary one
 * is a child a PM spawned — reserved under no owner, so it is in the host's slots and never in this
 * window's records. A look gated on `store.live.value.length > 0` therefore stops at the exact
 * moment it matters most: close the PM and the worker it spawned goes on running, addresses its
 * next question to a person, and nothing ever asks again. ⚠️ **A cold window is the same defect one
 * step earlier** — relaunch, press *Waiting on you* before opening anything, and the screen says
 * nothing needs you over a row that is in the database.
 *
 * ⚑ **612 · the sentence said *"its question falls due thirty seconds later"***, and there is no
 * deadline for it to fall due at (HO-088 §3.1). ⛔ **The defect it describes got WORSE, not
 * better**: the row now lands the instant the agent calls, so the window a gated look would miss
 * starts immediately rather than half a minute in.
 *
 * ⚑ **So it runs for the life of the screen**, and the cost it was gated for is not there:
 * `questionsAPersonMustAnswer` starts from `SELECT DISTINCT session_id … WHERE type = 'request_routed'`,
 * which is EMPTY in a database where nothing has ever routed a question — which is every install
 * that has not spawned an agent.
 *
 * ## 🔴 A refusal is not an all-clear
 *
 * ⛔ **`null` from the store means the read did not answer, and the last answer is KEPT.** Blanking
 * the queue on a dropped IPC call would draw *"nothing is waiting on you"* out of a failure, which
 * is the strongest false claim this app could make about somebody's own workload.
 */
const escalated = ref<LedgerWalk<PersonsQuestion> | null>(null)
/**
 * 🔴 **The second population, and the one a spawned child actually produces** (403, `402` F1).
 *
 * ⛔ **The look above could never have found it.** Every spawned child is `ask` BY RAIL, so its
 * first consequential tool call parks on a permission card — and a permission never travels, so it
 * is never escalated, so `questionsForAPerson` cannot admit one. ⚠️ **Measured live: three
 * permissions needed a person on one worker and that reader listed none of them.** A child frozen
 * on an answer only a person can give was in NONE of the populations a person was shown.
 *
 * ⚑ **Same cadence, same refusal reading, same `null`-is-not-empty rule** — see below.
 */
const decided = ref<LedgerWalk<PersonsDecision> | null>(null)
/**
 * 🔴 **Whether the MOST RECENT look answered, per population** (434) — see
 * {@link PersonsQueueView.stale}.
 *
 * ⛔ **True before the first look, and that reads backwards until you say what `stale` means**: it
 * is *a read that used to answer has stopped*, and before the first look nothing has stopped. The
 * absence that IS drawn at that moment is `null` from the view, which is *nobody has answered yet*.
 */
const lastLookAnswered = ref<{ questions: boolean; decisions: boolean }>({
  questions: true,
  decisions: true,
})
/**
 * 🔴 **The wall read of the one look, and the first that is not a thing a person owes** (533,
 * HO-052 §4).
 *
 * ⛔ **Two real runs, two days, both providers, and he saw neither.** Each wall was a non-fatal
 * `error` row in a transcript nobody was reading. ⚑ The PO's ruling is that it belongs where
 * everything else that needs him belongs, so it arrives on this poll — and it is drawn BESIDE the
 * queue's rows rather than as one, because a wall cannot be answered. See
 * `persons-queue.ts`' `ProviderLimitsView` for the whole argument.
 *
 * Scheduled limit looks run less often than actionable looks. An explicit refresh still reads
 * them immediately; a skipped look preserves both the last answer and its failure status.
 */
const limitsDisplay = ref<LimitsDisplayState>({ status: 'updating', reading: null })
const limitsLane = limitsDisplayLane((state) => (limitsDisplay.value = state))
let stopHearingLimits: (() => void) | null = null
let actionableReadSequence = 0
let actionableReadsClosed = false
/**
 * 🔴 **557 · work that has stopped with nobody left to tell** — another read of the one look.
 *
 * ⛔ **The last good answer is kept for the reads above's reason**: a dropped call must not be able
 * to say *nothing has stopped*, which is the one all-clear `555` §3.1 measured this app making
 * while it was false.
 */
const stalledWork = ref<LedgerWalk<StalledWork> | null>(null)
/** ⛔ **Whether the MOST RECENT look for stalled work answered** — `lastWallLookAnswered`'s fact. */
const lastStallLookAnswered = ref(true)
/**
 * Work whose holder stopped with it, its giver told: another read of the one look, the last good
 * answer kept for the stalls' reason.
 */
const stoppedWork = ref<LedgerWalk<StoppedWorkForAPerson> | null>(null)
/** Whether the most recent look for stopped work answered. */
const lastStopLookAnswered = ref(true)
/** Open work no other list shows, read in the same look; the last good answer kept. */
const workIncidents = ref<LedgerWalk<WorkIncident> | null>(null)
/** Whether the most recent look for that work answered. */
const lastIncidentLookAnswered = ref(true)
/**
 * ⚑ **D-017 · R19 — every ask against an identity's instructions nobody has answered**, read over
 * every conversation — another read of the one look. ⛔ The last good answer is kept, for the reads
 * above's reason: a dropped call must not be able to take an ask off a person's list.
 */
const instructionAsks = ref<readonly InstructionAskWaiting[] | null>(null)
/** ⛔ **Whether the MOST RECENT look for instruction asks answered** — `lastStallLookAnswered`'s fact. */
const lastAskLookAnswered = ref(true)
/**
 * ⚑ **F097 — the work whose agent answered a person and waits on their next words**, read over every
 * conversation — another read of the one look. ⛔ The last good answer is kept, for the reads above's
 * reason: a dropped call must not be able to take a piece off a person's list.
 */
const waitingOnWhoWrote = ref<LedgerWalk<WaitingOnWhoWrote> | null>(null)
/** ⛔ **Whether the MOST RECENT look for that work answered** — `lastStallLookAnswered`'s fact. */
const lastReplyLookAnswered = ref(true)
/**
 * The agents' requests to register an MCP server, read over every conversation in the one look. The
 * last good answer is kept, for the reads above's reason.
 */
const mcpServerRequests = ref<readonly McpServerRequestForAPerson[] | null>(null)
/** Whether the most recent look for those requests answered. */
const lastServerRequestLookAnswered = ref(true)
let looking: ReturnType<typeof setInterval> | null = null
const lookAtLimits = limitsReadCadence()

/**
 * ⛔ **One look, both populations, and they go out TOGETHER** (403).
 *
 * ⚠️ **`Promise.all` rather than two awaits**, and it is not a micro-optimisation: the two lists
 * are drawn as one queue with one count, and two reads a round trip apart can straddle an answer.
 * ⛔ **It BOUNDS that gap; it does not close it** — the two are separate IPC calls answered by
 * separate synchronous folds, so the honest claim is that they are in flight together rather than
 * that they are atomic. A single store sweep serving both is what would close it, and `403` filed
 * the cost rather than redesigning the readers at the end of a dispatch.
 *
 * ⛔ **Each keeps its own last answer on a refusal**, because a dropped call for one population
 * must not blank the other — and `personsQueueView` now honours that one layer down, which the
 * first version did not.
 */
/**
 * ⚑ **W4.63 · a provider's usage moved — look now**, so a limit that lifted leaves the Providers
 * card without waiting for the next tick. ⚑ One at a time: a notice while one is out joins it.
 */
let aLookAfterANotice: Promise<void> | null = null
function lookAfterAUsageNotice(): void {
  aLookAfterANotice ??= lookForWhatIsYours().finally(() => {
    aLookAfterANotice = null
  })
}

async function lookForWhatIsYours(scheduled = false): Promise<void> {
  void refreshLimitsDisplay(scheduled)
  const mine = ++actionableReadSequence
  const [questions, decisions, stalls, asks, owed, serverAsks, stops, incidents] =
    await Promise.all([
      store.questionsForAPerson(),
      store.decisionsForAPerson(),
      // 🔴 **557 · the stalls, in the SAME `Promise.all` for `533`'s reason exactly.** ⛔ The two
      // bands and the rows are one card, and a read a round trip after the others would let that card
      // be drawn from two moments. ⚑ Its name ends `ForAPerson`, so it is CONSCRIPTED into this look
      // by `everything-a-person-must-answer-is-in-the-queue.test.ts`.
      store.stalledWorkForAPerson(),
      // ⚑ **D-017 · R19 · the asks, in the SAME `Promise.all` for `403`'s reason**: *Waiting on you*
      // draws it beside the rows, and a read a round trip after them could straddle a decision.
      store.instructionAsksForAPerson(),
      // ⚑ **F097 · the work waiting on a person's reply, in the SAME `Promise.all`**, for the asks'
      // reason. ⚑ Its name ends `ForAPerson`, so it is CONSCRIPTED into this look too.
      store.waitingOnWhoWroteForAPerson(),
      // The agents' requests to register an MCP server, in the same look for the asks' reason.
      store.mcpServerRequestsForAPerson(),
      // The stopped work, beside the stalls it never shares a piece with, in the same look.
      store.stoppedWorkForAPerson(),
      // Open work no other list shows, in the same look: it is drawn beside the stops it never repeats.
      store.workIncidentsForAPerson(),
    ])
  if (actionableReadsClosed || mine !== actionableReadSequence) return
  if (questions !== null) escalated.value = questions
  if (decisions !== null) decided.value = decisions
  // ⛔ **The last good answer is kept here too**, for the reads above's reason: a dropped call must
  // not be able to withdraw work that is still stopped.
  if (stalls !== null) stalledWork.value = stalls
  lastStallLookAnswered.value = stalls !== null
  // ⛔ **The last good answer is kept here too**, for the reads above's reason.
  if (asks !== null) instructionAsks.value = asks
  lastAskLookAnswered.value = asks !== null
  // ⛔ **…and here** (F097).
  if (owed !== null) waitingOnWhoWrote.value = owed
  lastReplyLookAnswered.value = owed !== null
  if (serverAsks !== null) mcpServerRequests.value = serverAsks
  lastServerRequestLookAnswered.value = serverAsks !== null
  if (stops !== null) stoppedWork.value = stops
  lastStopLookAnswered.value = stops !== null
  if (incidents !== null) workIncidents.value = incidents
  lastIncidentLookAnswered.value = incidents !== null
  // 🔴 **Whether the look that just landed ANSWERED, which the values above cannot say** (434).
  //
  // ⛔ **Keeping the last good answer is right and it hides the failure.** A population whose read
  // starts refusing keeps its rows for ever, so `personsQueueView`'s `partial` — which reads
  // `null` — is false for ever too, and a list frozen at the minute the read died is drawn with
  // nothing saying so. ⚠️ **A queue that silently omits an item fails criterion 17 in the
  // direction that costs most**, and everything that arrived since the freeze is omitted.
  lastLookAnswered.value = {
    questions: questions !== null,
    decisions: decisions !== null,
  }
}

async function refreshLimitsDisplay(scheduled = false): Promise<void> {
  await lookAtLimits(() => limitsLane.refresh(() => store.readLimitsDisplay()), scheduled)
}

/**
 * 🔴 **The workspace's two counts, for the rail's one live signal** (571, `EXT-008` §4.3).
 *
 * ⛔ **`null` until the first reading lands**, which `liveSignalView` draws as nothing at all —
 * *nobody has looked yet* is not a number and the rail may not invent one for it.
 */
const workspace = ref<WorkspaceReading | null>(null)

/**
 * 🔴 **571 · the rail's live signal is read, not derived** — `567`'s `readWorkspace`, whose whole
 * point is that one stamped moment covers both counts.
 *
 * ## ⚠️ It rides {@link lookForWhatIsYours}' tick, and that is the answer to *"do not invent a poll"*
 *
 * ⛔ **This window already has one authority on what needs a person and one cadence for it.** The
 * `needsYou` half of this reading is EXACTLY the populations `personsQueueView` merges and
 * (D-017 · R19) the instruction asks drawn beside them, so a second cadence would let the rail and
 * the queue disagree about one number for a reason neither surface could explain. ⚑ **Fired in the same tick callback rather than inside that function's
 * `Promise.all`**, because that fold is *one card drawn from one moment* (`403`, `533`, `557`) and
 * this is a different card with a stamp of its own; going out together is what bounds the gap, and
 * two calls in one callback are in flight together exactly as five in one `Promise.all` are.
 *
 * ## ⚑ And the half a push DOES carry
 *
 * ⛔ **`534`'s `conversations` subject re-reads this**, because a conversation being born or ending
 * is precisely what moves the `open` count, and it is written by callers no gesture here can see.
 * ⚠️ **No new subject was added**: the `needsYou` populations announce nothing today, and `534`'s
 * own rule is that a subject nothing reads may not exist. See `571`'s response §3.
 *
 * ## ⛔ Ungated, unlike {@link readActivity}
 *
 * ⚑ The rail is on screen on every surface this window has, so there is no state in which this
 * tick paints nothing — which is the exact test {@link readActivity}'s gate applies and fails.
 *
 * ⛔ **A refusal keeps the last good reading**, for {@link lookForWhatIsYours}' reason and one of
 * this shape's own: a reading assembled here would carry a {@link WorkspaceReading.readAt} this window
 * minted rather than measured.
 */
async function readTheWorkspaceOnce(): Promise<void> {
  const reading = await store.readWorkspace()
  if (reading !== null) workspace.value = reading
}
/**
 * 🔴 **678 · one read at a time, and the last change always read** — {@link oneReadAtATime}, the
 * shape `672` gave the Team page's forest. ⛔ **Priced first** (`678` §4, 200 conversations × 2,000
 * events, fake runtime): **155 ms per read** on the main process, fired on every `conversations`
 * announcement on every page — ending three conversations announced six and blocked it for 929 ms.
 * ⚑ Coalesced, a burst costs at most two reads (310 ms). ⚠️ **Still over the 100 ms bar**: one read
 * alone is 155 ms, and what would bring it under — one walk of the routing ledgers instead of two, no
 * walk of an ended one, or a read of the `open` count alone for this arm — is main's, handed back.
 */
const readTheWorkspace = oneReadAtATime(readTheWorkspaceOnce)

/**
 * 🔴 **636 · what every conversation this app is RUNNING is waiting on** (`621` §5.1 ·
 * `HO-095` §5.1 · `HO-096` §4) — the read `621` put on the wire and deliberately left with no
 * renderer.
 *
 * > 🔴 **`HO-095` §5.1:** *"BroBot's header, avatar and rail row read `Idle` while Task #1 was
 * > being worked on by Ada."*
 *
 * ## ⛔ A POLL, and it is the same measurement `readTheCast` records one function up
 *
 * ⚠️ **A child's `work_replied` is written into the CHILD's ledger**, so the conversation that
 * gave the work out is told nothing at all when the work moves — `RuntimeScreen`'s own note, and
 * `621` §4's measurement. ⛔ **No window can derive this from its own stream**, so asking is the
 * only honest cadence.
 *
 * ## ⚑ It rides {@link lookForWhatIsYours}' tick, for {@link readTheWorkspace}'s reason exactly
 *
 * ⛔ **Ungated, like the live signal and unlike {@link readActivity}**: the rail is on screen on every
 * surface this window has, so there is no state in which this tick paints nothing. ⚠️ **Fired in
 * the same callback rather than inside that function's `Promise.all`**, because that fold is one
 * card drawn from one moment and this reading carries a `readAt` of its own.
 *
 * ⚠️ **NOT folded into {@link readTheCast}**, whose own note says why it is not this read: that
 * one is gated on a conversation being on screen and the rail draws a population.
 *
 * ## ⛔ A refusal keeps the last good reading, and the reason is sharper here than elsewhere
 *
 * ⚑ **`null` from the store is *we did not look*.** Blanking on it would make every rail row fall
 * back to the word its live facets produce — `idle` for a conversation whose worker is still
 * working — which is the exact sentence this dispatch exists to remove, restored by a dropped
 * IPC call.
 */
async function readWhatIsWaiting(): Promise<void> {
  const reading = await store.whatEachConversationIsWaitingOn()
  if (reading !== null) conversationWaits.value = reading
}

/** The time window Recent activity reads, as the person chose it. */
const activityWindowMs = ref<number>(DEFAULT_ACTIVITY_WINDOW_MS)

function chooseActivityWindow(ms: number): void {
  activityWindowMs.value = ms
  void readActivity()
}

/**
 * Recent activity for the chosen window, and, for Waiting on you, what finished or failed since the
 * person was last here. Each reading is kept with the window or visit it was read for and shown
 * only for that one, so a reply for another span never speaks for the one chosen; only the newest
 * ask may write. A read that fails leaves `null`, which the page says is not read yet.
 */
const activityHeld = ref<{ span: number; reading: RecentActivityReading | null } | null>(null)
const activityReading = computed(() =>
  activityHeld.value?.span === activityWindowMs.value ? activityHeld.value.reading : null,
)
const sinceReading = ref<{
  since: number
  from: number
  reading: RecentActivityReading
} | null>(null)
let activityAsked = 0
let sinceAsked = 0
let readingActivity: ReturnType<typeof setInterval> | null = null
const lastSeen = useLastSeen(() => info.value?.workspace.path ?? null)

/** One read per call, for the page on screen: the page's window, or the box's visit. */
async function readActivity(): Promise<void> {
  if (surface.value === 'away') return readPage()
  if (surface.value === 'waiting') return readSince()
}

async function readPage(): Promise<void> {
  const to = Date.now()
  const asked = activityWindowMs.value
  const mine = ++activityAsked
  const reading = await store.recentActivity(to - asked, to)
  if (mine === activityAsked && asked === activityWindowMs.value)
    activityHeld.value = { span: asked, reading }
}

async function readSince(): Promise<void> {
  const since = lastSeen.since.value
  if (since === null) return
  const to = Date.now()
  // No further back than one read may reach; the box then says the time it starts from.
  const from = Math.max(since, to - MAX_DIGEST_SPAN_MS)
  const mine = ++sinceAsked
  const reading = await store.recentActivity(from, to)
  if (mine !== sinceAsked || since !== lastSeen.since.value) return
  sinceReading.value = reading === null ? null : { since, from, reading }
}

const sinceLastHere = computed(() => {
  const held = sinceReading.value
  if (held === null || held.since !== lastSeen.since.value) return null
  const seen = sinceView(held.reading, held.from)
  return seen === null ? null : { view: seen, since: held.from }
})
watch(lastSeen.since, () => void readActivity())

/**
 * 🔴 **What each running conversation was last told it is doing** (593) — `575`'s read, taken with
 * the forest ({@link readWhoIsWorking}) and, between pushes, by the one glance ({@link glance}).
 *
 * ⛔ **The read makes ZERO database calls**, *"which is what makes it affordable on a 30-second
 * poll"* (`575`). ⚠️ **A FASTER interval of its own would put TWO ages on one page** — the
 * forest's and the doing words' — and the page has one sentence for how old it is.
 *
 * ⚠️ **`null` on a refusal, deliberately, and it is the one place this screen does NOT keep the
 * last good answer.** Every other kept read is a LIST whose absence would read as *nothing is
 * here*; this one is a REFINEMENT, and dropping it returns a card to the plate it would draw
 * without it — less rather than something else, and never a tool name from a minute ago.
 */
const beingDone = ref<WhatIsBeingDone | null>(null)
/**
 * Read the whole forest for the Team page's Graph tab.
 *
 * ⛔ **Read in the SAME call as {@link beingDone} and on the same tick**, which is `637` §5's
 * printed shape and the reason this screen does not grow a second interval: the docblock above
 * warns that *"a FASTER interval of its own would put TWO ages on one band"*, and a forest drawn
 * beside a doing word has exactly that hazard — two readings, two moments.
 *
 * ⚠️ **`null` is NOT kept on a refusal**, like its sibling and for its reason. ⚑ A stale TREE
 * reads as *this is the shape of your work*, which is a louder false claim than an absent one. `641` §5.5: *"`null` from the read draws we could not tell, never
 * an empty tree."*
 */
const theForest = ref<TheWholeForest | null>(null)
/**
 * ⚑ **641 · the forest, folded for the drawing** — one derivation, and the window's own `held` is
 * what makes `hereIsOf`'s fourth navigation state reachable.
 */
const theForestView = computed(() => foldTheForest(theForest.value, beingDone.value))

/**
 * Fold the conversation's Graph tab from the same forest as the Team page. {@link readTheCast} supplies the polled forest and what each running conversation was last told.
 */
const conversationForestView = computed(() =>
  foldTheForest(cast.forest.value, cast.reading.value?.atWork ?? null),
)
const readConversationForest = () => conversationForestView.value

/** ⚑ **One fold for both drawings of the forest** — the Team page's and a conversation's tab. */
function foldTheForest(forest: TheWholeForest | null, atWork: WhatIsBeingDone | null) {
  return forestView({
    forest,
    atWork,
    // ⛔ **Already on this screen and ungated** — `636`'s reading, reused rather than read again.
    waits: conversationWaits.value,
    identities: agentStore.identities.value?.identities ?? null,
    held: new Set(store.live.value.map((record) => record.sessionId)),
    // 🔴 **UI-004 · every card is the rail's row** — the rail's plate and the rail's word, on D-019's
    // push, so the Graph and the Team page change the moment the rail and the right panel do (668's
    // `live` was this for the conversations this window holds; the rail derives those the same way,
    // `recordFacets` on this screen's waits). See `ForestViewInput.said`.
    said: cast.railSays.value,
  })
}

/**
 * 🔴 **593 · the Team page's reading** — {@link beingDone} and the forest.
 *
 * ⛔ `whatIsBeingDone` is complete and keyed by conversation, and `byIdentity` is the door `575`
 * named for this page. ⚑ **Gated on the page being on screen**, and re-checked after the await,
 * which is what stops an answer landing on a screen that has moved: a tick nothing paints is pure
 * cost.
 *
 * 🔴 **672 · one read at a time, and the last change always read** — see {@link oneReadAtATime}.
 * ⛔ `668` put this read on every `conversations` and `work` announcement, and a burst of six held
 * the main process for 132–146 ms on a 200-conversation workspace (`672` §3, measured). ⚑ **Every
 * trigger goes through the one wrapped function** — the arrival watch and both arms (W4.74 took the
 * tick away: D-033 pushes every move of the work) — so
 * two reads are never in the air at once, ⚠️ and the sequence number this read used to carry
 * (`rosterRead`'s rule, for a tick landing beside an arrival) had nothing left to order: it is gone
 * rather than kept as a line no mutation could make fail.
 */
async function readWhoIsWorkingOnce(): Promise<void> {
  if (surface.value !== 'team') return
  // ⚑ **641 · ONE call for both** — `637` §5 prints this exact shape, and a second await here
  // would be a second moment for one page.
  const [doing, grown] = await Promise.all([store.whatIsBeingDone(), store.theWholeForest()])
  // ⚑ **The person moved while it was in flight.** Writing it would leave the next screen holding
  // a reading taken for one nobody is looking at — and this ref is the ONE place on this screen
  // that does not keep its last good answer (see {@link beingDone}).
  if (surface.value !== 'team') return
  beingDone.value = doing
  theForest.value = grown
}
const readWhoIsWorking = oneReadAtATime(readWhoIsWorkingOnce)

// ⚑ **Arriving at Team re-reads immediately** — a page just opened is read, never one left from
// before; every move after that is pushed (W4.74) — `readActivity`'s `watch(surface, …)` exactly, one
// surface over.
watch(surface, (now) => {
  if (now === 'team') void readWhoIsWorking()
})

/* ---------------------------------------------------------------------------
   508 · the work the ACTIVE conversation gave out — the drawer's Work tab
   --------------------------------------------------------------------------- */

/**
 * 🔴 **The work this conversation handed to other agents** (508) — the Work tab's reading.
 *
 * ⛔ **Owned here for the reason every other poll on this screen is**: this component owns every
 * poll that feeds a surface it mounts — the queue, the digest, the roster and now this — keeps the
 * last good answer on a refusal, and hands the result down. ⚠️ A poller inside the drawer would
 * re-ask on every tab click, because the drawer mounts one body at a time and a person switching
 * tabs remounts the one that owns it.
 *
 * 🔴 **W4.74 · no poll any more.** A child's `work_given` and `work_replied` are written into the
 * CHILD's ledger, so the giver's own ledger never told it the work moved; ⚑ `638` announced every
 * verb's move as `work`, and D-033 a turn's too — so this list is read again on that push, on
 * arriving, and (after a read that did not answer) on the glance.
 */
const work = ref<WorkGivenOutReading | null>(null)
/**
 * ⛔ **Which read is the newest, because the conversation id alone cannot say** — two triggers read
 * the SAME conversation, the arrival watch and a push, and without a sequence they land in
 * completion order and the older can overwrite the newer.
 */
let workRead = 0

/**
 * ⚠️ **Gated on a conversation being on screen**: this read opens one ledger per conversation the
 * work went to, and a tick nothing paints is pure cost.
 */
async function readTheWork(): Promise<void> {
  // ⚠️ **Gated on the CONVERSATION being on screen, not merely on one being open.** `activeId`
  // survives a walk to another page — `useSurface` only clears it when the conversation closes —
  // so a tick keyed on it alone would read a ledger for a drawer that is not mounted, which is the
  // *"a tick nothing paints is pure cost"* rule `readActivity` follows. ⛔ Found by reading
  // `useSurface`, not by a failure: the poll works either way and the cost is invisible.
  const asked = surface.value === 'conversation' ? activeId.value : null
  if (asked === null) return
  workRead += 1
  const mine = workRead
  // ⛔ **The instant the QUESTION went out** — every age on the tab is measured from here.
  const at = Date.now()
  const answer = await store.workGivenBy(asked)
  // ⚑ **The person moved while it was in flight** — writing it would leave the next conversation's
  // first frame holding this one's work.
  if (asked !== activeId.value) return
  // ⛔ **A later read has already landed, so this one is history.**
  if (mine !== workRead) return
  if (answer !== null) {
    work.value = { conversation: asked, walk: answer, answered: true, at }
    return
  }
  // ⛔ **A refusal for the conversation we are LOOKING at keeps its rows and marks them; one for a
  // conversation we have never had an answer about has nothing to keep.**
  work.value = work.value?.conversation === asked ? { ...work.value, answered: false } : null
}

// ⚑ **Opening a conversation re-reads immediately** — a list just opened is read, never one left
// from before; every move after that is pushed (W4.74).
watch(activeId, () => void readTheWork())

// ⚑ **…and so does ARRIVING at one from somewhere else**, which is the other half of the gate
// above — `readActivity`'s `watch(surface, …)` exactly, one surface over. ⛔ Without it a person who
// walked to another page and back would look at a reading as old as the time they spent away, with
// the age line the only thing saying so.
watch(surface, (now) => {
  if (now === 'conversation') void readTheWork()
})

/* ---------------------------------------------------------------------------
   547 · who called whom — the conversations around the one on screen
   --------------------------------------------------------------------------- */

/**
 * 🔴 **The band on the first drawer tab** (547, over `543`'s aggregate read).
 *
 * ⛔ **Owned here for the reason every other poll on this screen is**: this component owns every
 * poll that feeds a surface it mounts, keeps the last good answer on a refusal, and hands the
 * result on. ⚠️ **What is different is only how it travels.** `ConversationPane.vue` is the one hop
 * between here and `SessionDrawer`, and `547` §1.1 puts that file out of bounds while `545` is in
 * flight on it — so the answer goes into a window-level ref instead of down three props. ⚑ **547
 * F5**: the poll did not move, the wire did.
 *
 * 🔴 **W4.74 · pushed whole, polled no more.** `534`'s `runtime:changed` announces the session-row
 * write that creates a child, and the `conversations` arm re-reads on it; ⚑ the WORK half is
 * announced as `work` — every verb since `638`, and a turn's move since D-033 — and re-read on it.
 * What no push carries (what each agent is doing at this moment, and its process's memory) is the
 * glance's ({@link glance}).
 */
const cast = useWhoCalledWhom()
/** ⛔ **Which read is the newest, because the conversation id alone cannot say** — `workRead`'s. */
let castRead = 0

/**
 * ⚠️ **Gated on a conversation being on screen**, exactly as {@link readTheWork} is: this read opens
 * one ledger per conversation the work went to, and a tick nothing paints is pure cost.
 */
async function readTheCast(): Promise<void> {
  const asked = surface.value === 'conversation' ? activeId.value : null
  if (asked === null) return
  void readProcessMemory()
  castRead += 1
  const mine = castRead
  cast.loadingFor.value = asked
  const answerPending = store.whoCalledWhom(asked)
  const doingPending = store.whatIsBeingDone()
  // The graph and activity refine the cards; neither holds up their first relationship reading.
  const forestPending = store.theWholeForest().then((grown) => {
    if (mine === castRead && asked === activeId.value && grown !== null) {
      cast.forest.value = grown
    }
  })
  const answer = await answerPending
  if (mine !== castRead || asked !== activeId.value) return
  cast.loadingFor.value = null
  if (answer !== null) {
    // ⛔ **No `at` of this window's own.** `543` stamps `readAt` LAST over one synchronous aggregate
    // — the completion point `540` MI-19 said a single timestamp depended on — so a second instant
    // taken here would be a clock the band would have to choose between. ⚑ It also means a kept
    // last-good answer keeps its OWN timestamp, which is `547` §3.3's requirement for free.
    cast.reading.value = { conversation: asked, read: answer, answered: true, atWork: null }
  } else {
    // A failed refresh keeps this conversation's last cards, without old activity words.
    cast.reading.value =
      cast.reading.value?.conversation === asked
        ? { ...cast.reading.value, answered: false, atWork: null }
        : null
  }
  const doing = await doingPending
  if (mine !== castRead || asked !== activeId.value) return
  const reading = cast.reading.value
  if (reading?.conversation === asked && reading.answered) {
    cast.reading.value = { ...reading, atWork: doing }
  }
  await forestPending
}

// ⚑ **Opening a conversation re-reads immediately** — a band just opened is read, never one left
// from before; every move after that is pushed (W4.74).
watch(activeId, () => void readTheCast())
watch(surface, (now) => {
  if (now === 'conversation') void readTheCast()
})

/**
 * 🔴 **D-018 · the memory each running conversation's process holds, for the agent cards** —
 * asked with the band ({@link readTheCast}), so it moves when the band does: opening a
 * conversation, its tick, a start or a stop (`conversations`), and the work moving. ⚑ Main shares
 * one read between askers, so a later ask never gets an older answer and no counter is needed.
 *
 * ⛔ **A read that did not answer draws no figure**: a figure is a live process's, and a kept one
 * could belong to a process that has since stopped. ⚠️ **Not in the band's `Promise.all`**: the
 * figure is no part of the band's one moment, and awaiting it would hold the cards for a `ps`.
 */
async function readProcessMemory(): Promise<void> {
  const held = await store.processMemory()
  cast.processMemory.value = new Map(
    (held?.conversations ?? []).map((one) => [one.conversation, one.bytes]),
  )
  cast.memoryUnmeasured.value = held?.unmeasured ?? null
}

/**
 * 🔴 **W4.74 · the one glance left on a clock — at what no push carries.** ⚑ Every move of a piece
 * is pushed (`work`, D-033), so nothing here re-reads the work. Two facts move with no push at all:
 * what each agent is doing at this moment (its tool, its phase — `whatIsBeingDone`, which reads no
 * store) and the memory each conversation's process holds (`processMemory`, one shared listing).
 *
 * ⛔ **Only while a person can see them** — this window in front, the page visible, and the Team
 * page or a conversation on screen. ⚑ Arriving on either re-reads at once, and so does this window
 * coming back to the front, so the glance bounds how old a page being LOOKED at can get, never how
 * old a page just opened is.
 *
 * ⚑ **And a read that did not answer is asked again here** — the clock was the only retry the
 * work's readers had, and a quiet workspace may push nothing for a long time.
 */
let glancing: ReturnType<typeof setInterval> | null = null
/** ⛔ Which glance is the newest — a read that lands after a newer one is history (`workRead`'s). */
let glanceRead = 0
async function glance(): Promise<void> {
  if (document.visibilityState !== 'visible' || !document.hasFocus()) return
  glanceRead += 1
  const mine = glanceRead
  if (surface.value === 'team') {
    // ⚑ A forest read that did not answer is asked again, whole.
    if (theForest.value === null) {
      void readWhoIsWorking()
      return
    }
    const doing = await store.whatIsBeingDone()
    // ⚑ {@link beingDone}'s own rule: no kept answer — a refusal draws no doing words.
    if (surface.value === 'team' && mine === glanceRead) beingDone.value = doing
    return
  }
  const asked = surface.value === 'conversation' ? activeId.value : null
  if (asked === null) return
  void readProcessMemory()
  // ⚑ Rows kept after a read that did not answer are asked again, whole.
  if (work.value?.conversation === asked && !work.value.answered) void readTheWork()
  if (cast.reading.value?.conversation === asked && !cast.reading.value.answered) {
    void readTheCast()
    return
  }
  const doing = await store.whatIsBeingDone()
  // ⚑ The doing words refine the band's last reading, of this conversation only; ⛔ a refusal drops
  // them rather than keep a tool name from a minute ago (`632`, {@link readTheCast}).
  const reading = cast.reading.value
  if (mine !== glanceRead || asked !== activeId.value) return
  if (reading === null || reading.conversation !== asked) return
  cast.reading.value = { ...reading, atWork: reading.answered ? doing : null }
}

/** ⚑ This window coming back to the front glances at once, rather than at the next tick. */
function glanceOnReturn(): void {
  if (document.visibilityState === 'visible' && document.hasFocus()) {
    void glance()
    // ⚑ And the programs, so one updated in a terminal is what the new-conversation form says.
    void readPrograms()
  }
}

/**
 * 🔴 **UI-002 · the files kept, for the Files tab and the agent card** — D-026's one door, asked in
 * two scopes in one worker snapshot: the tree of the conversation on screen, and what it added itself —
 * the selected agent's, whose card the right panel shows (UI-006).
 *
 * ⚑ **Asked when the conversation or the surface moves, the moment the states channel
 * says a file was kept (D-026 R3), and when the work moves** — a retitle changes the title each row
 * stands under and keeps no file. ⚑ Once on mount too, for a screen that remounts on a
 * conversation (HMR with a surviving store), whose watches then have nothing to fire on. ⛔ No
 * poll: every kept file is told — ⚑ and a re-read is the whole union the channel's note asks for,
 * with no guess about which scope a new row belongs to.
 *
 * ⚠️ **The band's two guards**: the person moved while it was in flight, or a later read landed.
 */
let filesRead = 0
async function readTheFiles(): Promise<void> {
  const asked = surface.value === 'conversation' ? activeId.value : null
  if (asked === null) return
  filesRead += 1
  const mine = filesRead
  let tree: readonly KeptFile[] | null = null
  let added: readonly KeptFile[] | null = null
  try {
    const answer = await window.api.runtime.filesKept({
      scope: 'tree',
      conversation: asked,
      withAdded: true,
    })
    if (answer.ok) {
      tree = answer.files
      added = answer.added ?? null
    }
  } catch {
    // A failed read keeps the previous lists and allows the next refresh to retry.
  }
  if (asked !== activeId.value || mine !== filesRead) return
  cast.treeFiles.value = filesReadFor(asked, tree, cast.treeFiles.value)
  cast.cardFiles.value = filesReadFor(asked, added, cast.cardFiles.value)
}

watch([activeId, surface], () => void readTheFiles())

/**
 * ⚑ **D-017b · a recorded conversation is held only while it is on screen** — the list names every
 * conversation, and the store keeps a page of one only for the view drawing it. ⚑ So a person
 * leaving one lets it go ({@link SessionStore.forget}), and a live one that stops while it is not on
 * screen is let go too. ⛔ `forget` keeps anything live, anything being handed over and anything a
 * command for it is still out on.
 */
const onScreenNow = computed(() => (place.value === null ? activeId.value : null))
watch(onScreenNow, (_now, was) => {
  if (was !== null) store.forget(was)
})
watch(
  () => store.live.value.map((record) => record.sessionId),
  (now, before) => {
    for (const sessionId of before ?? []) {
      if (!now.includes(sessionId) && sessionId !== onScreenNow.value) store.forget(sessionId)
    }
  },
)

/**
 * ⚑ **D-017b · the recorded conversation on screen moved** — its row's last activity is not the one
 * its view was drawn at, or another window took it or let it go — so it is looked at again: a fresh
 * page, and the host's word on whether a message from here continues it. ⛔ **Asked of THIS
 * conversation's row only** (a start or a stop of any other moves the same announcement), and never
 * a take: a look that is not a press takes nothing.
 *
 * ⚠️ **A claim and a release write no row** — the host moves only the owner — so the last activity
 * alone would leave a view drawn while another window held it saying so after that window let go
 * (or claiming it free after another window took it). ⚑ The row's own *open in another window* is
 * compared with what the view was told, and a difference is a move.
 */
/** The conversations the host's list named at its last answer, `null` before it first answered. */
let listedLastTime: ReadonlySet<string> | null = null

function lookAgainIfItMoved(): void {
  const sessionId = onScreenNow.value
  const listedNow = rail.value?.theOneList?.map((row) => row.sessionId) ?? null
  const before = listedLastTime
  if (listedNow !== null) listedLastTime = new Set(listedNow)
  // Archived or deleted from another window, or by an agent: the view reacts as to its own press,
  // and the words typed here wait for it, since an archive keeps them.
  const left = leftTheListsFromElsewhere(
    sessionId,
    before,
    listedNow,
    store.live.value.map((record) => record.sessionId),
  )
  if (left !== null) {
    archivedHere([left])
    return
  }
  if (sessionId === null) return
  const record = store.get(sessionId)
  if (record?.phase !== 'recorded' || record.meta === null) return
  const listed = rail.value?.listedOf(sessionId) ?? null
  if (listed === null) return
  const toldItWasElsewhere = record.meta.cannotTakeAMessage === HELD_ELSEWHERE
  if (
    listed.updatedAt === record.meta.liveness.since &&
    listed.inAnotherWindow === toldItWasElsewhere
  ) {
    return
  }
  void store.look(sessionId, 'again')
}

/**
 * ⚑ **D-017b · the one state the host says of the conversation on screen** — its row in the one
 * list — which a view drawn from its ledger draws on its plate, so the view and its row say one
 * thing (the row draws the same state). ⚑ `null` while the list has not named it.
 */
const listedStateOfActive = computed(() =>
  active.value === null ? null : (rail.value?.listedOf(active.value.sessionId)?.state ?? null),
)
/** When each of the active conversation's waits began, as the host read them. */
const waitsBeganOfActive = computed(() =>
  active.value === null
    ? {}
    : {
        ...whenItsWaitsBeganIn(conversationWaits.value, active.value.sessionId),
        owes: whenItOwedIn(listedStateOfActive.value),
      },
)

/**
 * 🔴 **D-016 · commit 7 · R2 — the work that names the conversation on screen**, off its row in the
 * one list, as {@link listedStateOfActive} is: the header titles it with that work. ⚑ `null` while
 * the list names none.
 */
const listedNamedOfActive = computed(() =>
  active.value === null ? null : (rail.value?.listedOf(active.value.sessionId)?.named ?? null),
)

/**
 * ⚑ **R4 — the header's rename, offered only where the door accepts it: a piece a person gave.**
 * ⛔ On this surface that is exactly a ROOT (a label of one number): a conversation that owns a root
 * is named by that root, and one that owns none is named by a piece its parent gave it — only a
 * conversation with a root takes work on for a person.
 *
 * ⚑ **A refusal is the door's own words, handed back to the field**; a throw (the bridge, a quit)
 * is said as {@link readableError} says it. ⚠️ The list is asked again BEFORE the field closes, so
 * the old title does not flash back — except on a conversation still starting, whose row is written
 * once its launch settles: the old title shows until then, and the `work` announcement the host
 * makes when the row is down re-reads the list here, as in every other window.
 */
const retitleOfActive = computed(() => {
  // ⚑ **UI-008 · the one rule, asked** — the card's *Current task* draws the same root.
  const named = theWorkAPersonGave(listedNamedOfActive.value)
  if (named === null) return undefined
  return async (title: string): Promise<string | null> => {
    try {
      const retitled = await window.api.runtime.retitleWork({ piece: named.label, title })
      if (!retitled.ok) return retitled.reason
      await rail.value?.refreshResumable()
      return null
    } catch (cause) {
      return readableError(cause)
    }
  }
})

// Arriving at Recent activity or Waiting on you reads again at once, so neither shows a reading up
// to a tick old.
watch(surface, (now) => {
  if (now === 'away' || now === 'waiting') void readActivity()
})

/**
 * 🔴 **534 · what the host says MOVED, told rather than asked** — one of the two things on this
 * screen that are, with {@link stopHearingStates}.
 *
 * ⛔ **Every other reader below is a poll or a re-read after a gesture this window made**, which is
 * why a conversation an agent spawned reached no list at all. `whenTheWorldMoves` holds the rules —
 * drop a subject we do not know, ask nothing during a quit, and a reader per subject by TYPE — and
 * this is the wiring, kept here because this component owns the two surfaces that draw the answers.
 *
 * ⚠️ **`refreshResumable` on BOTH surfaces, exactly as every retired call site did**: the rail and
 * the library fold the same two reads, and a channel that refreshed one of them would be the
 * disagreement `151` paired them to prevent.
 */
let stopListening: (() => void) | null = null
/**
 * 🔴 **D-019 · what each agent is doing, told the moment it moves** — `runtime:states`, which
 * carries the answer where `runtime:changed` carries none: handed to the rail
 * (`SideRail.hearStates`), whose one list every surface draws the host's state from — its rows,
 * the cards under the strip (`cast.railSays`), the palette, the Team shelf and the plate of a view
 * drawn from its ledger. ⛔ So nothing re-reads the list to learn a state: not the waits reading,
 * not the band's tick. ⚑ Wired here beside {@link stopListening}, because this component owns what
 * main tells the window. ⚑ **D-026 · the channel carries the files kept too**: the rail folds only
 * the states, and a message that kept a file reads the files again ({@link readTheFiles}, UI-002).
 */
let stopHearingStates: (() => void) | null = null

onMounted(() => {
  stopHearingStates = listenProviderStates(window.api.runtime, store, (message) => {
    rail.value?.hearStates(message)
    // ⚑ **UI-002 · a file kept anywhere is read again at once** — see {@link readTheFiles}.
    if (message.kept.length > 0) void readTheFiles()
  })
  // ⚑ **UI-002 · the files' first read** — they have no tick, so a screen that remounts on a
  // conversation already open reads them itself ({@link readTheFiles}); on the launcher it asks nothing.
  void readTheFiles()
  stopListening = whenTheWorldMoves((listener) => window.api.runtime.onChanged(listener), {
    conversations: () => {
      void rail.value?.refreshResumable().then(lookAgainIfItMoved)
      void library.value?.refreshResumable()
      // 🔴 **547 · and the band on the drawer's first tab**, which draws the SPAWN half of that
      // same announcement. ⛔ **`543` §5.3 measured that this is the half a push can carry**: a
      // child appears when a `provider_session` row is written, and `attachHeldSession` announces
      // inside the block that writes it. ⚑ **638 · and the WORK half
      // announces now too** — see the `work` arm below. ⛔ This sentence said *the WORK half
      // announces nothing and keeps the tick, which is why no third subject was added (`534`'s own
      // rule: do not add a subject nothing reads)*, and `631`'s two task lists are the reader that
      // rule was waiting for.
      void readTheCast()
      // Refresh the Team forest when a conversation opens, ends or is spawned, rather than waiting for arrival or its periodic tick. `readWhoIsWorking` runs only while the page is visible.
      void readWhoIsWorking()
      // 🔴 **571 · and the rail's live signal**, whose `open` half is a count of conversations that
      // are not over — which is the exact fact this subject announces. ⛔ **The `needsYou` half
      // announces nothing and keeps the tick.** ⚠️ **638 · the REASON changed and the fact did
      // not**: a third subject exists now, and `needsYou` is not it — that half is a person's
      // queue, whose writers `638` did not survey, so giving it this arm would be a subject
      // claiming a population nobody measured (`534`'s own rule, and `567` §5's reading of it).
      void readTheWorkspace()
    },
    // 🔴 **638 · the work moved somewhere in this app** — see {@link RUNTIME_CHANGE_SUBJECTS}.
    // ⛔ **The SAME reader the `conversations` arm calls**, deliberately: `631`'s two task lists and
    // `632`'s child rows are one `Promise.all` inside {@link readTheCast}, so one arm serves both
    // and there is no second cadence to disagree with the first (`631` §2.1).
    // ⚠️ **No conversation id is carried and none could be**: a task's state is composed from other
    // conversations' ledgers, so the reader asks the question it already asks and gets the whole
    // answer — which is this channel's contract rather than an economy.
    work: () => {
      void readTheCast()
      // ⚑ **D-016 · commit 7 · R2 — and the rail's list, for the work that names each
      // conversation**, which a give, a reply, a take-back, a close or a retitle moves and nothing
      // pushes. ⛔ Not for what each agent is doing, which arrives on its own
      // ({@link stopHearingStates}).
      void rail.value?.refreshResumable()
      // 🔴 **668 · the forest draws every task too** — the same reason as the `conversations` arm.
      void readWhoIsWorking()
      // 🔴 **638 · and the drawer's Work tab, which is the OTHER surface in this file drawing a
      // task's state** — `508`'s list, fed by {@link readTheWork}. ⛔ Its own docblock said *"a
      // poll, because nothing pushes… the conversation that gave the work is told nothing at all
      // when the work moves"*, and after this dispatch that is false. ⚠️ **Without this line the
      // band would update instantly while the tab beside it kept the old word for 30 s** — two
      // surfaces, one screen, two answers, which is the `631` §2.1 defect this arm exists to
      // prevent, arriving one tab over.
      void readTheWork()
      // ⚑ **UI-002 · and the files**, whose rows say the title each piece stands under NOW — a
      // retitle moves it and keeps no file, so no kept push carries it.
      void readTheFiles()
    },
    // ⚑ **`agentStore.load()` through {@link refreshAgents}**, so the launch path's retired call
    // and this one are the same function rather than two readers of one store.
    // ⚑ **UI-012 · and the model lists** — a last pick, a default or a hand-added model moved.
    agents: () => {
      refreshAgents()
      void modelLists.reread()
    },
  })
  stopHearingLimits = window.api.runtime.onLimitsDisplayChanged((message) => {
    limitsLane.changed(message)
    if (message.why === 'scope') void refreshLimitsDisplay()
  })
  void lookForWhatIsYours()
  // ⚑ **571 · the rail's live signal reads on the SAME first pass and the SAME tick** — see
  // {@link readTheWorkspace} for why it rides this cadence rather than getting one of its own.
  void readTheWorkspace()
  // ⚑ **636 · and the three waits, on the same first pass and the same tick**, for the reason one
  // line up — see {@link readWhatIsWaiting}.
  void readWhatIsWaiting()
  looking = setInterval(() => {
    void lookForWhatIsYours(true)
    void readTheWorkspace()
    void readWhatIsWaiting()
  }, LOOK_EVERY_MS)
  void readActivity()
  readingActivity = setInterval(() => void readActivity(), ACTIVITY_READ_EVERY_MS)
  // 🔴 **W4.74 · D-033 · no re-read of the work on a clock.** The Team page's forest, the band and
  // the Work tab used to re-read every half minute (`593`, `547`, `508`); every move of a piece now
  // arrives as `work` (a turn's too, since D-033), and each is read again on it, on `conversations`,
  // and on arriving. ⚑ What no push carries — what each agent is doing at this moment, and the
  // memory its process holds — is glanced at instead, and only while a person can see it.
  glancing = setInterval(() => void glance(), ROSTER_EVERY_MS)
  window.addEventListener('focus', glanceOnReturn)
  document.addEventListener('visibilitychange', glanceOnReturn)
  // 🔴 **The press, supplied rather than re-implemented** — `goToTheWork` is `506`'s door, which
  // claims the conversation when this window does not hold it and selects only after the claim has
  // landed (rule 18). ⛔ While this is null the band draws no press at all, which is what a drawer
  // mounted with no screen above it gets.
  cast.goTo.value = (conversation) => void goToTheWork(conversation)
})
onUnmounted(() => {
  // ⛔ **534 · unsubscribed like every interval below.** The preload holds the listener on
  // `ipcRenderer`, which outlives this component under HMR, so a screen that did not let go would
  // leave a second listener re-reading through a store the new one has replaced.
  stopListening?.()
  actionableReadsClosed = true
  actionableReadSequence++
  limitsLane.close()
  stopHearingLimits?.()
  stopHearingLimits = null
  stopListening = null
  stopHearingStates?.()
  stopHearingStates = null
  if (looking !== null) clearInterval(looking)
  if (readingActivity !== null) clearInterval(readingActivity)
  if (glancing !== null) clearInterval(glancing)
  window.removeEventListener('focus', glanceOnReturn)
  document.removeEventListener('visibilitychange', glanceOnReturn)
  // ⛔ **Handed back, because the ref outlives this component under HMR** — a band left holding a
  // press into a screen that has been replaced would claim through a store nobody is listening to.
  cast.goTo.value = null
  castRead++
  cast.loadingFor.value = null
  // ⚑ **UI-001 · and the rail's rows with it** — a band left holding them would draw a replaced
  // screen's words.
  cast.railSays.value = null
  // ⚑ **D-018 · and the process figures** — a card left holding them would draw a replaced
  // screen's read.
  cast.processMemory.value = new Map()
  cast.memoryUnmeasured.value = null
  // ⚑ **UI-002 · and the files** — a Files tab left holding them would draw a replaced screen's read.
  cast.treeFiles.value = null
  cast.cardFiles.value = null
  // ⚠️ **Back to *nobody has answered*, not to *nothing is waiting*.** The module is a singleton
  // that outlives this component under HMR, and a stale list of rows pointing at conversations a
  // new store has never heard of is worse than no list.
  persons.forget()
})

/**
 * 🔴 **Take a person to the card, and never answer it for them** (401 §5.1).
 *
 * ⛔ **Knowledge escalates; authority does not.** This walks to the conversation the question was
 * raised in and scrolls to the card; the card is where a permission is decided and a question is
 * answered, through `respondUserInput`, which is unchanged.
 *
 * ⚑ **D-017b · the conversation opens as any press opens it** ({@link openConversation}) — attached,
 * taken for this window when it runs with no window, or drawn from its ledger when nothing runs it,
 * where a question this app asked is still answerable (D-017 · R6). ⛔ Nothing is started to get
 * there.
 *
 * ⛔ **The card only once the conversation is on screen**: a person who moved while it was being
 * opened is not moved back, and no card is looked for on a pane that is not drawn.
 */
async function goToQuestion(row: PersonsQueueRow): Promise<void> {
  if (!(await openConversation(row.sessionId))) return
  const record = store.get(row.sessionId)
  if (record === null) return
  await nextTick()
  // ⛔ **The card, not the conversation.** `requestItems` is the fold's own request id → item id
  // map; a request whose card has been released from the window's page has no item, and that is
  // said rather than landed on silently (106). ⚑ **UI-009 · a question this app asked is on the
  // call that asked it** — its own card, which `requestItems` does not hold.
  const itemId =
    record.control.requestItems.get(row.requestId) ??
    askedQuestionItemIn(record.control, row.requestId)
  if (itemId === undefined || pane.value?.focus(itemId) !== true) say(OPEN_REQUEST_MISSED)
}

/**
 * 🔴 **The conversations THIS WINDOW is running** (506) — `store.live`'s ids, once.
 *
 * ⛔ **Several surfaces ask this question, so it is spelled once here.** The person's queue and the
 * transcript's work reports; `169` §1 is that a rule spelled several times drifts in one of them.
 * ⚑ The queue's copy is pointed here, and the rail's one list reads the same `store.live` it is
 * handed.
 *
 * ⚑ **An ARRAY, and the one `Set` each reader needs is its own.** A prop that is a `Set` is a prop
 * a render test has to construct.
 */
const heldHere = computed<readonly string[]>(() =>
  store.live.value.map((record) => record.sessionId),
)

/**
 * This window's last press on a row whose conversation no window holds, by row key: sent until the
 * row leaves the list, or the host's words when the answer was not taken.
 */
const pressedWhereNobodyHolds = ref(new Map<string, { sent: boolean; refused: string | null }>())

/** The rows for requests in conversations no window holds, from the cards the host read. */
const nobodyHolds = computed(() => {
  const held = new Set(heldHere.value)
  const rows = new Map<string, AttentionRequest>()
  for (const decision of decided.value?.rows ?? []) {
    const { askedBy, requestId } = decision.request
    if (decision.card === undefined || held.has(askedBy)) continue
    const key = `${askedBy}:${requestId}`
    const row = attentionToACardNobodyHolds(
      askedBy,
      decision.card,
      pressedWhereNobodyHolds.value.get(key) ?? { sent: false, refused: null },
      agentHeadingFor,
    )
    if (row !== undefined) rows.set(key, row)
  }
  return rows
})

watch(decided, (walked) => {
  const listed = new Set(
    (walked?.rows ?? []).map((one) => `${one.request.askedBy}:${one.request.requestId}`),
  )
  for (const key of [...pressedWhereNobodyHolds.value.keys()]) {
    if (!listed.has(key)) pressedWhereNobodyHolds.value.delete(key)
  }
})

/**
 * ⚑ **UI-001 · what the rail says of each conversation, mirrored for the band** — the right panel's
 * cards draw an agent from its rail row, so the two say one thing, and a row this window is not fed
 * says the host's one state (`get_agent_status`'). ⚑ Followed, never re-derived.
 */
watchEffect(() => {
  cast.railSays.value = rail.value?.says ?? null
})

/**
 * Open the conversation named by a work report so the person can follow the work there.
 *
 * ⚑ **D-017b · one door for every press that opens a conversation** — {@link openConversation}; the
 * stopped-work band's button (557) and the forest's rows go the same way.
 *
 * 🔴 **UI-011 · and a give card's cut note brings its piece's brief into view there** (F037) —
 * `briefOf`, the piece's label: {@link goToQuestion}'s landing, once the conversation is on
 * screen; ⛔ a brief further back is said, never landed short of silently (106). ⚠️ Found in the
 * READER's fold, not the control one a question is found in: a brief is history, and the ids
 * `focus` matches are the rows that fold draws.
 */
async function goToTheWork(sessionId: string, briefOf?: string): Promise<void> {
  if (!(await openConversation(sessionId)) || briefOf === undefined) return
  const record = store.get(sessionId)
  if (record === null) return
  await nextTick()
  const itemId = briefItemIn(record.transcript, briefOf)
  if (itemId === undefined || pane.value?.focus(itemId) !== true) say(THE_BRIEF_IS_FURTHER_BACK)
}

/**
 * ⛔ **One state, two surfaces** — *Waiting on you*'s *Yours to settle* group and the overlay
 * layer's corner, supplied here exactly as the emergency stop is.
 *
 * ⚠️ **`answerable` is the live queue's own ROWS** (434), so a queue row can both say that its
 * card is also listed here and offer that card's own answers — instead of the two lists silently
 * describing one conversation twice, and instead of a second place deciding what a request offers.
 */
watchEffect(() => {
  persons.supply(
    escalated.value,
    decided.value,
    {
      held: new Set(heldHere.value),
      // ⛔ **The live ROW, not its key** (434). It carries what may be sent, so the queue can
      // offer the answer instead of only a way to walk to it — and *"is it also on screen"* and
      // *"what may be sent here"* stay one fact.
      answerable: new Map(needsYou.value.map((request) => [request.key, request])),
      nobodyHolds: nobodyHolds.value,
      // 🔴 **468 · what this window has already answered**, so the row a person just cleared says
      // so instead of sending them to a card that is over. See {@link answeredFromHere}.
      answeredFromHere: answered.value,
      now: clock.value,
      lastLookAnswered: lastLookAnswered.value,
    },
    {
      travel: (row) => void goToQuestion(row),
      settle: (row, decision) => settleFromTheQueue(row, decision),
      // ⚑ **UI-009** — a question this app asked, answered on its card.
      answer: (row, response) => answerFromTheQueue(row, response),
      move: (row, decision) => moveRequest(row.sessionId, row.requestId, decision),
      takeOver: (row) => void takeOverForTheQueue(row),
      // ⚑ **557 · `506`'s door, unchanged** — the band's destination is the conversation the
      // work is IN, which is the population that function already answers for. ⛔ A second copy of
      // its four steps was written and removed: `a-second-function-in-the-same-shape-disarms-a-
      // file-scoped-census`, and `506 M12`/`M13` went ambiguous on it.
      open: (sessionId) => void goToTheWork(sessionId),
      // ⚑ **D-017 · R19** — an ask about an identity's rules, decided on its row.
      decideInstruction: (askId, approve) => void decideInstructionAsk(askId, approve),
      // An agent's request to register an MCP server, decided on its row.
      decideMcpServerRequest: (requestId, approve) => decideAServerRequest(requestId, approve),
      // A to-do answered Done or Can't do it, with its note; the host's words when it didn't take it.
      answerTodo: (sessionId, request, done, note) => answerATodo(sessionId, request, done, note),
      openFile: (resource) => void todoDocument.value?.open(resource),
      // A stopped piece handed back to its giver; the next look drops its row.
      handBack: async (label) => {
        const said = await takeBackForAPerson(label)
        void lookForWhatIsYours()
        return said
      },
    },
    {
      walked: limitsDisplay.value.reading?.walked ?? null,
      lastLookAnswered: limitsDisplay.value.status === 'ready',
      display: limitsDisplay.value,
    },
    // ⚑ **557 · in the SAME supply as the rows and the walls**, which is that method's own rule:
    // one call, one moment, so the card's three parts cannot come from three looks.
    { walked: stalledWork.value, lastLookAnswered: lastStallLookAnswered.value },
    // ⚑ **D-017 · R19 · the asks, in the SAME supply**, for that rule — so *Waiting on you* and the
    // overlay's corner count and list one look's asks, named over the roster.
    {
      walked: instructionAsks.value,
      lastLookAnswered: lastAskLookAnswered.value,
      nameOf: agentHeadingFor,
    },
    // ⚑ **F097 · the work waiting on a person's reply, in the SAME supply**, for that rule.
    { walked: waitingOnWhoWrote.value, lastLookAnswered: lastReplyLookAnswered.value },
    {
      walked: mcpServerRequests.value,
      lastLookAnswered: lastServerRequestLookAnswered.value,
      nameOf: agentHeadingFor,
    },
    { walked: stoppedWork.value, lastLookAnswered: lastStopLookAnswered.value },
    {
      incidents: workIncidents.value?.rows ?? null,
      lastLookAnswered: lastIncidentLookAnswered.value,
      rowsUnread: workIncidents.value?.rowsUnread ?? 0,
      ...(workIncidents.value?.ledgersSkipped === undefined
        ? {}
        : { ledgersSkipped: workIncidents.value.ledgersSkipped }),
    },
  )
})

/**
 * 🔴 **Settle a queue row where it is — criterion 17's *clearing it there clears it
 * everywhere*** (434).
 *
 * ⛔ **It is {@link decideFromOverview}, reached from a second surface, and deliberately not a
 * second path.** The live row is looked up by the queue row's own key, and the send is the same
 * `respondPermission` / `respondUserInput` the card and the overview already use; the request fold
 * closes the row and every projection refolds off the ledger. ⚠️ **Nothing here records that a row
 * was cleared** — a dismissed-list in the window would be a second opinion about what is closed,
 * which is the one thing criterion 17 forbids by name.
 *
 * ⚑ **UI-009 · a question this app asked is not settled here** — its card answers it
 * ({@link answerFromTheQueue}), and it has no live row to find.
 *
 * ⚠️ **The live lookup below is checked again**, because the queue's rows are five seconds old and
 * `store.live` is not — a conversation can be closed between the render and the press, and
 * answering the wrong one would look completely correct.
 */
function settleFromTheQueue(row: PersonsQueueRow, decision: AttentionDecision): void {
  const live = needsYou.value.find((request) => request.key === row.key)
  if (live === undefined && nobodyHolds.value.has(row.key)) {
    void answerWhereNobodyHolds(row, decision)
    return
  }
  if (live === undefined) {
    say('That card is no longer on this window — open the conversation to answer it.')
    return
  }
  decideFromOverview(live, decision)
}

/**
 * Answer, from its row, a request in a conversation no window holds. The host answers it only if it
 * is a person's and still open. The row says the answer was sent until the next look drops it, or
 * shows the host's words if it was not taken.
 */
async function answerWhereNobodyHolds(
  row: PersonsQueueRow,
  decision: AttentionDecision,
): Promise<void> {
  if (pressedWhereNobodyHolds.value.get(row.key)?.sent === true) return
  pressedWhereNobodyHolds.value.set(row.key, { sent: true, refused: null })
  const answer = answerFor(decision)
  const said =
    'permission' in answer
      ? await store.respondPermission(row.sessionId, row.requestId, answer.permission)
      : await store.respondUserInput(row.sessionId, row.requestId, answer.userInput)
  await lookForWhatIsYours()
  if (said === null) return
  const stillListed =
    !lastLookAnswered.value.decisions ||
    (decided.value?.rows ?? []).some(
      (one) => `${one.request.askedBy}:${one.request.requestId}` === row.key,
    )
  if (stillListed) {
    pressedWhereNobodyHolds.value.set(row.key, { sent: false, refused: said })
    return
  }
  pressedWhereNobodyHolds.value.delete(row.key)
  say(said)
}

/**
 * 🔴 **UI-009 · answer a question this app asked, from its card on *Waiting on you*** (F052).
 *
 * ⚑ **The SAME `store.respondUserInput` the conversation's card uses**, with the id this app minted:
 * where this window holds the asker `markSent` marks the draft before the first await, so the card
 * says *answer sent* inside one tick (`064`, `207` M2, `468`); ⚑ **D-017 · R6 — where it holds
 * nothing, the host is still asked**, and finds the question in the asker's ledger, running or
 * stopped. ⛔ A second press cannot deliver twice: the host refuses an answered question in its
 * own words. ⚑ The look runs again at once, so a question that was taken leaves the list.
 *
 * ⚑ **The host's words go back to the card only while the question is still on the list** (F2) —
 * a refusal over a question that is still open. ⛔ Words about a question that has LEFT the list —
 * taken and kept for its asker's next start, or already over — reopened the card's presses over a
 * question nobody could answer any more; they are said, and the card goes with its row. ⚠️ A look
 * that did not answer cannot say the row went, so it is read as still listed.
 *
 * ⚠️ **`row.sessionId` is the conversation that ASKED**, whose ledger the host finds the question in.
 */
async function answerFromTheQueue(
  row: PersonsQueueRow,
  response: UserInputResponse,
): Promise<string | null> {
  const said = await store.respondUserInput(row.sessionId, row.requestId, response)
  await lookForWhatIsYours()
  if (said === null) return null
  const stillListed =
    !lastLookAnswered.value.questions ||
    (escalated.value?.rows ?? []).some(
      (one) => `${one.request.askedBy}:${one.request.requestId}` === row.key,
    )
  if (stillListed) return said
  say(said)
  return null
}

/**
 * ⚑ **D-017 · R19 — a person decides an agent's ask about an identity's rules from *Waiting on
 * you*** — the same `decideInstruction` that identity's own sheet presses. ⚑ The host's words when
 * it did not take it, and the look again at once, so the row goes when it did.
 */
async function decideInstructionAsk(askId: string, approve: boolean): Promise<void> {
  const refused = await agentStore.decideInstruction(askId, approve)
  if (refused !== null) say(refused)
  await lookForWhatIsYours()
}

/**
 * A person decides an agent's request to register an MCP server from its row. The look runs again
 * at once, so the waiting list has caught up when the host's answer goes back to the card, which
 * keeps its words.
 */
async function decideAServerRequest(requestId: string, approve: boolean): Promise<AnswerAck> {
  const ack = await agentStore.decideMcpServerRequest(requestId, approve)
  await lookForWhatIsYours()
  return ack
}

/**
 * 🔴 **Take the conversation over so its card can be answered in the queue** (434).
 *
 * ⛔ **`336`'s door with the navigation left off.** {@link goToQuestion} already claims for this
 * population on the way past — an agent-spawned child is reserved under no owner — so this adds
 * no entitlement; what it adds is staying put. ⚑ Once the claim lands the record is in
 * `store.live`, `needsYou` recomputes, and the row gains its answers in place: the person never
 * leaves the one list.
 *
 * ⚠️ **A refusal is said in the host's own words**, exactly as the travelling gesture says it.
 */
async function takeOverForTheQueue(row: PersonsQueueRow): Promise<void> {
  try {
    await store.claim(row.sessionId)
  } catch (cause: unknown) {
    say(readableError(cause))
  }
}

/**
 * ⛔ **Answering from the overview — and it goes through 203's owner check like everything else.**
 *
 * ⚠️ **This window OWNS these sessions, and that is why it is allowed, not because the overview is
 * special.** `store.live` is this window's own records; the command carries this window's sink; and
 * `RuntimeHost.require` asks `mayControl(slot, by)` on the way in (203). A window that does not own
 * a session has no record for it here, so it cannot even build a row to press — and if one were
 * forged onto the wire, the host refuses it with `not-yours`. Both halves are asserted.
 *
 * ⚑ **It does NOT widen what a non-owner can see.** 203 §11 #2 left that question open and it is
 * the PM's: this surface reads `store.live`, which is exactly what this window already renders.
 */
function decideFromOverview(request: AttentionRequest, decision: AttentionDecision): void {
  // ⛔ **`request.sessionId`, never `activeId`.** Every other answer path on this screen answers the
  // conversation on screen, and that is correct for them; here it would answer the wrong one and
  // look right doing it. See `answerFor` for the half that decides the payload.
  const answer = answerFor(decision)
  if ('permission' in answer) {
    void store.respondPermission(request.sessionId, request.requestId, answer.permission)
    return
  }
  void store.respondUserInput(request.sessionId, request.requestId, answer.userInput)
}

/**
 * Go to the card itself, where the full disclosure and the richer controls live.
 *
 * ⛔ **The `itemId` was carried the whole way here and thrown away** (236 §2, from 231 #5). The row
 * emits the whole request, `205` wrote `ConversationPane.focus(itemId)` for this, and this function
 * used the session id alone — so Open on the older of two pending requests landed at ordinary scroll
 * position, in a conversation with two cards, with nothing saying which one you had asked for. `205`
 * is the dispatch whose subject was *"everything that needs you in one place"*.
 *
 * ⚠️ **`nextTick` and not `nextTick × 2`, and the reason is what the tick is waiting for.** The
 * switch to the conversation is a reactive change here; the pane and its transcript are mounted
 * inside the parent's own patch, so one flush is the whole tree. The wait exists because
 * {@link select} may be the thing that MOUNTS the pane — opening from the overview usually is —
 * and `pane.value` is null until it does.
 *
 * ⛔ **A miss is SAID, not swallowed** (106). `focusItem` answers false when the card is not in the
 * part of the transcript this window holds; landing silently at the wrong scroll position is the
 * defect this fixes, so it must not be the fallback either.
 */
function openRequest(request: AttentionRequest): void {
  select(request.sessionId)
  void nextTick(() => {
    if (pane.value?.focus(request.itemId) !== true) say(OPEN_REQUEST_MISSED)
  })
}

/** ⌘N starts a conversation; ⌘K would open a palette that does not exist yet, and says so. */
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
  if (event.key === 'k') {
    event.preventDefault()
    say('Command palette — not wired yet.')
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('mouseup', onSideButton)
  window.addEventListener('mousedown', onSideButton)
  // A swipe on a Mac's trackpad and a Windows Back key, as main hears them; a mouse's side button
  // can arrive this way too, and counts once.
  stopHearingNavigate =
    window.api.onNavigate?.((direction) => pressed(direction === 'back' ? -1 : 1, 'main')) ?? null
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
    window.api.getAppInfo(),
    window.api.runtime.capabilities(),
    window.api.runtime.profiles(),
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
    :scope="`${place ?? ''}|${activeId ?? ''}`"
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

      <AppTitleBar :info="info" :error="infoError" />

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
             stopped. Limits keep their own last reading between the less frequent limit looks;
             workspace counts keep the actionable cadence. -->
        <SideRail
          ref="rail"
          :open="store.live.value"
          :provider-blocks="store.providerBlocks"
          :active-id="activeId"
          :on-screen="active"
          :place="place"
          :needs-you="homeNeedsYou.total"
          :workspace="workspace"
          :workspace-folder="info?.workspace ?? null"
          :app-version="info?.version ?? null"
          :limits="persons.limits.value"
          :waiting="conversationWaits"
          :collapsed="railFold.collapsed.value"
          @fold="railFold.toggle()"
          @new-conversation="place = 'new'"
          @select="select"
          @go="
            (destination) => {
              linkedIdentity = null
              if (destination === 'tools' || destination === 'providers') openSettings(destination)
              else if (destination === 'settings') openSettings(settingsTab)
              else place = destination
            }
          "
          :agents="agentStore.identities.value"
          @command="say('Command palette — not wired yet.')"
        />

        <main class="main">
          <!-- An archived conversation a link opened, read-only, in place of the page it came from. -->
          <LinkedHistory
            v-if="linkedHistory"
            :key="linkedHistory.sessionId"
            :history="linkedHistory.history"
            :title="linkedHistory.title"
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
            :clock="clock"
            :agents="agentStore.identities.value"
            @decide="decideFromOverview"
            @open-request="openRequest"
            @open-agent="(profileSlug) => overlays.open({ kind: 'agentCapabilities', profileSlug })"
            :since-last-here="sinceLastHere"
            @open-conversation="(sessionId) => void openConversation(sessionId)"
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
            :identities="agentStore.identities.value?.identities ?? null"
            @read="readFromTheLibrary"
            @open="select"
            @delete="(sessionId) => overlays.open({ kind: 'deleteConversation', sessionId })"
            @archived="archivedHere"
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
            :mode="mode"
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
            :mode="mode"
            :debug="debug"
            :drawer-open="drawerOpen"
            :drawer-tab="drawerTab"
            :hidden-drawer-tabs="hiddenTabs"
            :pick-model="pickModelForActive"
            :capabilities="capabilities"
            :work="work"
            :waiting="theWaitIn(conversationWaits, active.sessionId)"
            :held-work="theWorkIn(conversationWaits, active.sessionId)"
            :answer-from="whoseAnswerIn(conversationWaits, active.sessionId)"
            :work-with="whoseWorkIn(conversationWaits, active.sessionId)"
            :stopped-work="stoppedWorkIn(conversationWaits, active.sessionId)"
            :waits-began="waitsBeganOfActive"
            :listed-state="listedStateOfActive"
            :provider-block="active ? store.providerBlocks.get(active.sessionId) : null"
            :named="listedNamedOfActive"
            :retitle="retitleOfActive"
            :archive="archiveOfActive"
            :identities="agentStore.identities.value?.identities ?? null"
            :draft="drafts.read(draftKeyForActive)"
            :handing="drafts.paths.handing(draftKeyForActive)"
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
            @send="send"
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
            @toggle-debug="debug = !debug"
            @toggle-drawer="drawerOpen = !drawerOpen"
            @update:drawer-tab="(tab) => (drawerTab = offeredTab(tab, hiddenTabs))"
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
          <NewConversation
            v-else
            :recent="rail?.theOneList ?? null"
            @open="select"
            :busy="frontDoorLaunch.busy.value || store.isLaunching()"
            :error="store.launchError.value"
            :refused-as="store.launchRefusal.value"
            :debug="debug"
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
            @start="startFromFrontDoor"
            @cancel="store.cancelLaunch()"
            @update:draft="(text) => drafts.write(draftSlot(null), text)"
            @toggle-debug="debug = !debug"
          />
        </main>
      </div>

      <!-- A file an agent handed with a to-do, opened from Waiting on you or its corner. -->
      <CanonicalDocumentOverlay
        ref="todoDocument"
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
      <OverlayHost
        v-if="overlays.overlay.value"
        :label="overlayLabel(overlays.overlay.value)"
        @close="closeOverlay()"
      >
        <!-- 🔴 **An agent being brought into being** (423). ⛔ It writes an `agent_identity` row — the
             gesture `417` deleted and `419` built every layer of but this one. ⚠️ **Every overlay in
             this chain is named rather than a `v-else`**: the union is exhaustive here, so a kind
             added without a branch draws nothing and is visible immediately, rather than opening
             somebody else's sheet. -->
        <NewAgent v-if="overlays.overlay.value.kind === 'newAgent'" @close="overlays.close()" />
        <!-- Edit the external_mcp_server rows resolved at launch. Agent grants are configured
             separately on CapabilitiesSheet. -->
        <ExternalMcpRegistry
          v-else-if="overlays.overlay.value.kind === 'externalMcpServers'"
          @close="overlays.close()"
        />
        <!-- 🔴 **626 · the popup's second door, hosted here rather than in `TeamWorkspace`.**
             ⛔ **Deliberately NOT a local `OverlayHost` on that page**: `a-stop-a-modal-cannot-cover`
             §3 censuses the host components precisely so a fifth one does not appear without anybody
             deciding it should, and this sheet needs nothing that host does not already give it.
             ⚑ **The name is resolved HERE, live, from the roster this screen already holds** — the
             overlay member carries a slug and never a snapshot. -->
        <AgentSectionsSheet
          v-else-if="overlays.overlay.value.kind === 'agentSections'"
          :profile-slug="overlays.overlay.value.profileSlug"
          :agent-name="agentHeadingFor(overlays.overlay.value.profileSlug)"
          :store="agentStore"
          @close="overlays.close()"
        />
        <CapabilitiesSheet
          v-else-if="overlays.overlay.value.kind === 'agentCapabilities'"
          :profile-slug="overlays.overlay.value.profileSlug"
          :runs-on="providerForAgent(overlays.overlay.value.profileSlug)"
          :capabilities="capabilities"
          :open-as="openAsForSheet"
          @close="overlays.close()"
          @start-conversation="(slug) => overlays.open({ kind: 'startAsAgent', profileSlug: slug })"
          @reopen="(sessionId) => void reopenForGrant(sessionId)"
        />
        <!-- 🔴 **The app's SECOND launch door** (423 relay 1). ⛔ It is the one HO-023 §2 named — *"a
             new conversation is with BroBot; every other session is placed somewhere"* — and it exists because `424` measured that after `417` merges, every
             conversation a person can open is BroBot's, in the workspace, and so is everything it
             spawns. ⚑ The provider is RESOLVED here, from the identity it opens, so this sheet's
             sentence and its payload are one value. -->
        <StartAsAgent
          v-else-if="overlays.overlay.value.kind === 'startAsAgent'"
          :profile-slug="overlays.overlay.value.profileSlug"
          :provider="providerForAgent(overlays.overlay.value.profileSlug)"
          :default-approval-mode="frontDoorApproval"
          :capabilities="capabilities"
          :busy="placedHere && store.isPlacing()"
          :error="placedHere ? store.placedError.value : null"
          @start="startPlaced"
          @cancel="void store.cancelPlaced()"
          @close="closeOverlay()"
        />
        <!-- The confirmation before a delete: it reads what would go, and a person ticks each part. -->
        <DeleteConversation
          v-else-if="overlays.overlay.value.kind === 'deleteConversation'"
          :key="overlays.overlay.value.sessionId"
          :session-id="overlays.overlay.value.sessionId"
          @close="closeOverlay()"
          @archived="archivedFromTheSheet"
          @deleted="deletedFromTheSheet"
        />
      </OverlayHost>

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

<style scoped>
/* ⛔ **Off-screen without being hidden** (401). `display: none` and `visibility: hidden` take an
   element out of the accessibility tree, which would make the region above announce nothing at
   all; the clip-rect pattern leaves it in the tree and out of the picture. ⚠️ `white-space: nowrap`
   so a sentence cannot wrap into a 1px box and be laid out at a height a reader's cursor lands in. */
.only-for-a-reader {
  position: absolute;
  overflow: hidden;
  width: 1px;
  height: 1px;
  padding: 0;
  border: 0;
  margin: -1px;
  clip-path: inset(50%);
  white-space: nowrap;
}

.app {
  display: grid;
  width: 100vw;
  /*
   * ⚠️ **`100%` of `#app`, not `100vh`, and the horizontal scrollbar is the difference** (338).
   * `#app` is `overflow-x: auto; overflow-y: hidden` so that a window narrower than
   * `--app-min-w` is a scrollbar rather than a silent cut; when that bar appears it takes 11 px
   * (measured) out of `#app`'s content box. A frame keyed to the VIEWPORT does not know that
   * happened, overflows `#app` by exactly the bar's height, and loses its bottom 11 px — the
   * composer's own row — to the `overflow-y: hidden` beside the reach. `100%` is the same 808 px
   * as `100vh` whenever there is no bar, which is every width at or above 1180.
   */
  height: 100%;
  min-width: var(--app-min-w);
  background-color: var(--window-bg-color, var(--app-bg));
  background-image: var(--window-bg-image, none);
  background-position: var(--window-bg-position, 0% 0%);
  background-repeat: var(--window-bg-repeat, repeat);
  background-size: var(--window-bg-size, auto);
  image-rendering: var(--window-bg-rendering, auto);
  grid-template-rows: var(--titlebar-h) 1fr;
}

.app > * {
  image-rendering: auto;
}

.shell {
  display: grid;
  min-height: 0;
  grid-template-columns: var(--rail-w) 1fr;
}

.shell[data-rail='collapsed'] {
  grid-template-columns: var(--rail-w-collapsed) 1fr;
}

/* The surface fills its column and owns its own padding: the conversation runs edge to edge,
   with the reading measure doing the centring inside it.

   ⚑ **384 §1.3 · the tuck.** `border-top-left-radius` is the whole geometry change this dispatch
   makes to the frame, and it is deliberate that it is only a corner: v2.3's own workspace is
   `border-radius: 22px 0 0 0`, rounded against the rail and the titlebar and square against the
   window's own edges, which is what makes the paper read as a sheet laid into the chrome.
   ⛔ **`overflow: hidden` was already here and is what makes the radius clip its contents** — it is
   not defensive, it is the surface column refusing to scroll (`base.css` §the reach). The dark that
   shows through the corner is `.app`'s `--app-bg`.
   ⚠️ **No padding, no gutter, no `transform`, no `backdrop-filter`.** A gutter would take horizontal
   pixels out of `.pane-body`, and `drawerFit` measures its two thresholds (940 / 880) on exactly
   that box — at the app's own opening width the drawer would have dropped from `--drawer-w` to
   `--drawer-w-narrow` as a side effect of a background change. And a `transform` or a
   `backdrop-filter` here would make this element a containing block for `position: fixed`, which is
   the escape `app-frame-reachable.dom.test.ts` reproduces on purpose. */
.main {
  position: relative;
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  border-top-left-radius: var(--surface-tuck);
  /* ⚠️ **`box-shadow` and not a `border`.** A border is part of the box, so it would take a pixel
     off the surface column's width and hand it to `drawerFit`'s arithmetic; an inset shadow paints
     the same hairline and takes nothing. */
  box-shadow: inset var(--border-width) var(--border-width) 0 0 var(--surface-edge);
}

.not-built {
  display: flex;
  max-width: 46ch;
  height: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  margin: 0 auto;
  color: var(--faint);
  gap: var(--space-5);
  text-align: center;
}

.not-built .big {
  width: 28px;
  height: 28px;
}

.not-built h1 {
  margin: 0;
  color: var(--text-soft);
  font-size: var(--type-heading);
  font-weight: var(--fw-semibold);
}

.not-built p {
  margin: 0;
  font-size: var(--type-small);
  line-height: var(--leading-relaxed);
}

.toast {
  position: absolute;
  bottom: var(--space-8);
  left: 50%;
  padding: var(--space-4) var(--space-7);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--panel-3);
  box-shadow: var(--shadow);
  color: var(--text-soft);
  font-size: var(--type-small);
  transform: translateX(-50%);
}
</style>
