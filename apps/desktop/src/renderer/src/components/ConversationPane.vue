<script setup lang="ts">
import type { HandedPath } from '../../../shared/attachment-contracts'

import { computed, nextTick, onMounted, onUnmounted, provide, reactive, ref } from 'vue'

import { attachmentsNotRestored, puttingItBack, withTheseToo } from '../lib/drafts'
import { TAB_OF_THE_BAND } from '../lib/drawer'
import {
  controlHoldsTheStart,
  profileItRunsAs,
  requestDraft,
  type RequestDraft,
} from '../lib/session-record'
import {
  GO_AHEAD_LABEL,
  GO_AHEAD_MESSAGE,
  GO_AHEAD_NOTE,
  LEAVE_PLAN_LABEL,
  LEAVE_PLAN_TITLE,
} from '../lib/plan-mode'
import { sessionPanel } from '../lib/session-panel'
import { aSurfaceMayOpenADocument } from '../lib/opening-a-document'
import { A_COMMAND_HAS_NOT_ANSWERED } from '../lib/session-store'
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
import PromptComposer from './PromptComposer.vue'
import ConversationMain from './ConversationMain.vue'
import SessionDrawer from './SessionDrawer.vue'
import SignInPanel from './SignInPanel.vue'
import ProviderSetupProgress from './ProviderSetupProgress.vue'
import SessionHeader from './SessionHeader.vue'
import SessionShelf from './SessionShelf.vue'
import TranscriptView from './TranscriptView.vue'
import { useClientMessagePaths } from '../composables/useMessagePaths'
import { useConversationSignIn } from '../composables/useConversationSignIn'
import { useConversationOverlays } from '../composables/useConversationOverlays'
import { useToolRowControls } from '../composables/useToolRowControls'
import { useDrawerFit } from '../composables/useDrawerFit'
import { useConversationCast } from '../composables/useConversationCast'
import { usePaneAgentState } from '../composables/usePaneAgentState'
import { useComposerFacts } from '../composables/useComposerFacts'
import type { ConversationPaneEmits, ConversationPaneProps } from '../lib/conversation-pane-props'

/**
 * Render the supplied conversation record; the parent owns which record is selected.
 * Switching records leaves their running sessions and event delivery intact.
 * Local view state, such as an open image, names its conversation and must reset
 * when that record changes; see viewing.
 */
const props = defineProps<ConversationPaneProps>()

const emit = defineEmits<ConversationPaneEmits>()

const { paneBody, fit } = useDrawerFit()

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

const { cast, treeFiles, gaveOut, waitsOnPurpose, ownWait, takenIn, goToConversation } =
  useConversationCast(props)

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

const {
  who,
  ownAgent,
  needsGoAhead,
  agentFacets,
  takenWithoutThisWindow,
  settingsFixed,
  agentState,
  limitMinute,
  stillThinking,
  providerLimit,
  activity,
  lastReport,
  paneFootprint,
} = usePaneAgentState(props, control, panel)

const {
  runsWithoutThisWindow,
  composerState,
  hasQueued,
  compaction,
  canGoAhead,
  GO_AHEAD_WAITS_FOR_AN_ANSWER,
  sendBlocked,
  canTakeAMessage,
  interruptible,
  stopUnansweredWords,
} = useComposerFacts(props, control, panel, agentState, signInSuperseded, who)

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

const overlays = reactive(
  useConversationOverlays(props, transcript, () => canReadToolAnswers.value),
)

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
          :can-read-tool-answer="overlays.canReadToolAnswer"
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
          :stop-and-send="!runsWithoutThisWindow"
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
              !('outcome' in overlays.backgroundFor && overlays.backgroundFor.outcome) &&
              !('unfinished' in overlays.backgroundFor && overlays.backgroundFor.unfinished) &&
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
            :paths="messagePaths"
            opened
            :tail="tailFor(overlays.toolFor.callId)"
            :can-watch="canWatchCommands"
            :output-capability="outputCapability"
            :background-output-capability="backgroundOutputCapability"
            :can-stop="canStopBackgroundWork"
            :stopping="stoppingCall(overlays.toolFor.callId)"
            :can-read-answer="overlays.canReadToolAnswer(overlays.toolFor.callId)"
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
            :paths="messagePaths"
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
    <OverlayHost v-if="overlays.answerFor" label="Tool answer" @close="overlays.closeToolAnswer">
      <ToolAnswerViewer
        :name="overlays.answerFor.name"
        :answer="overlays.answerFor.answer"
        :can-ask="canReadToolAnswers || overlays.answerFor.answer !== null"
        :paths="messagePaths"
        :short-form="overlays.answerFor.shortForm"
        :call="overlays.answerFor.call"
        @close="overlays.closeToolAnswer"
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
