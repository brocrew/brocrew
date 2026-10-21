<script setup lang="ts">
import type { ProviderLimitDisplay } from '../lib/provider-limit-status'
import { computed, watch } from 'vue'
import type { AgentState as OneState } from '../../../shared/agent-state'
import type { WorkThatNamesIt } from '../../../shared/piece-called'
import type { AgentFacets } from '../lib/agent-state'
import { sessionPanel, type PanelAsset } from '../lib/session-panel'
import type { TranscriptState } from '../lib/transcript'
import type { TranscriptMode } from '../lib/transcript-mode'
import type {
  AgentIdentity,
  CreatedSession,
  KeptFile,
  ProviderCapabilityMap,
  RevealResult,
  SessionPathTarget,
  SetSessionSettingInput,
  WhatAPickBecame,
} from '../../../shared/runtime-ipc'
import type { PickedModel } from '../lib/model-lists'
import { useAgentPanel } from '../composables/useAgentPanel'
import { useConversationControls } from '../composables/useConversationControls'
import { useConversationModelPick } from '../composables/useConversationModelPick'
import { useProfileSignIn } from '../composables/useProfileSignIn'
import type { CapabilityStatus } from '../../../shared/runtime-ipc'
import type { CompactionFacts } from '../lib/compaction-offer'
import {
  parentCardOf,
  theWorkAPersonGave,
  workingTogetherView,
  type CastReading,
} from '../lib/working-together'
import { useMinuteClock } from '../composables/useMinuteClock'
import AgentCard from './AgentCard.vue'
import AllFilesDialog from './AllFilesDialog.vue'
import AllTasksDialog from './AllTasksDialog.vue'
import ContextDialog from './ContextDialog.vue'
import OverlayHost from './OverlayHost.vue'
import AgentState from './AgentState.vue'
import WorkingTogether from './WorkingTogether.vue'

/**
 * What still needs you, and what is still happening — beside the conversation instead of buried in
 * it (037).
 *
 * It holds **no state**. Every ROW on it is `sessionPanel(state)`, a pure projection of the same
 * fold the transcript is rendered from, so the two cannot disagree: answering a card removes it
 * from both in the same tick, because there is only one fact and this is the second place it is
 * read. See `lib/session-panel.ts` for why that matters more than it sounds.
 *
 * ⚠️ **It said *"Everything on it is `sessionPanel(state)`"* until `547`, and that stopped being
 * true.** ⛔ The tab now also HOSTS two blocks it does not fold — `SessionBot` since `090` and
 * `WorkingTogether` since `547` — and both arrive as data and are placed rather than read. ⚑ **The
 * clause that matters is unchanged and is the one `506` §1.4 refused a band over**: *nothing here
 * subscribes to anything.* Every input is a prop, and a polled reading is somebody else's poll.
 *
 * It is also strictly a way IN. Every row navigates and nothing else — no Allow, no Deny, no
 * answer field. Those live on the cards, under the disclosure rules 031/034 wrote for them, and a
 * second set here would be a second code path that has to stay honest about a security decision.
 *
 * ⚠️ **Assets (067) are the one thing here that is not "open", and their row opens rather than
 * navigates.** Both are departures and both are the same departure: an asset is a FILE the session
 * produced, so the thing a reader wants from its row is the file. The rule above is really "a row
 * takes you to the thing it names, and never acts on your behalf" — a viewer is still a way in, and
 * opening one decides nothing. What the panel still does not do is own state: the asset list is
 * projected from the same items the transcript renders, and the overlay it asks for is opened by
 * the surface above, not here.
 */
const props = defineProps<{
  approvalSaving?: boolean
  /**
   * What is OPEN — the session's control projection (064).
   *
   * Deliberately not the fold on screen. "What still needs you" is a question about the session,
   * and answering it from the reader's scroll position is 061 finding 5: page back far enough and
   * the panel emptied, the badge went to zero and the composer unfroze, on a session that was
   * sitting blocked on a permission the whole time.
   */
  state: TranscriptState
  /**
   * The fold the transcript is actually rendering, when that is a different one (064).
   *
   * Only ever used to decide whether a row can be scrolled TO — never what the panel lists. Absent
   * for the ordinary case and for the read-only pane, where there is one fold and it is both.
   */
  shown?: TranscriptState
  /**
   * Which items the transcript is currently showing. Not used to decide what the panel LISTS —
   * that is the state's business — only whether a row can be scrolled to, so the panel never
   * offers a jump to somewhere that is not on screen.
   */
  mode: TranscriptMode
  /**
   * The agent this conversation is (082), drawn at the pinned top of this tab (090).
   *
   * Forwarded whole to `SessionBot` and read nowhere else here — this component decides the block's
   * PLACE and nothing about its content, which is what makes moving the block a move.
   *
   * Optional because this component does not need one to do its job: it is a projection of a
   * transcript, and every caller that HAS an agent passes it. When it is absent nothing is drawn —
   * not a faceless plate, which would be a mark that says nothing standing where a mark means
   * something. (An earlier version of this comment blamed "the read-only pane"; that pane does not
   * render this component at all. Found in review — a reason that names a caller which does not
   * exist is worse than no reason.)
   */
  facets?: AgentFacets
  providerLimit?: ProviderLimitDisplay | null
  /** ⚑ **D-017 · R11 — its ONE state** (`stateHere`), forwarded whole with {@link facets}. */
  agentState?: OneState
  /** ⚑ **UI-008 · the work that names it** — the root a person gave it, for its *Current task*. */
  named?: WorkThatNamesIt | null
  /**
   * Its name, for the line above the plate — handed in, never one this component invents.
   *
   * ⚑ **537 · the AGENT's name**, and it was the provider's. See `SessionBot`'s own note.
   */
  who?: string
  /**
   * 🔴 **547 · who called whom** — the conversations around this one, and the work that passed
   * between them.
   *
   * ## ⛔ Why a polled reading is allowed onto this tab at all, when `506` §1.4 refused one
   *
   * ⚠️ **`506` refused a polled BAND that this component would have had to fold**, and the sentence
   * it refused for is still true: *"It is a pure function of `TranscriptState` … and it subscribes
   * to nothing."* ⚑ **Nothing here subscribes.** This prop is data, handed down like `facets` and
   * `who`, and it is forwarded WHOLE to {@link WorkingTogether} — this component decides the
   * block's PLACE and nothing about its content, which is exactly what it does for `SessionBot`.
   *
   * This panel describes the conversation shown by the avatar, while the separate Work tab reads the polled work list.
   *
   * ⚠️ **Optional, and its absence draws nothing** — the state every mount that is not a drawer is
   * in, and the state of a real drawer's first frame.
   */
  cast?: CastReading | null
  /** The conversation this panel is about — ⛔ what {@link cast} is CHECKED against, never assumed. */
  conversation?: string
  /** ⚑ `null` until the identities read lands — a cold window names every card by its slug. */
  identities?: readonly AgentIdentity[] | null
  /** ⚑ **631 · the profile of the agent this panel is about** — threaded, never derived here. */
  profile?: string | null
  /** ⚑ **W4.183 · the session this panel is about** — its folder and what it runs on, for v3. */
  session?: CreatedSession | null
  /** The screen's model pick for this conversation, carried out from the card's model and effort. */
  pickModel?: ((pick: PickedModel) => Promise<WhatAPickBecame | null | undefined>) | undefined
  /** What each provider can do, for the picker's remedy on a refused list. */
  capabilities?: ProviderCapabilityMap | null
  /** Nothing set here would reach the conversation (`CreatedSession.settingsFixed`). */
  fixed?: boolean
  /** Drawn from its ledger: its next start leaves planning, so plan first is not offered. */
  recorded?: boolean
  /** ⚑ Show one of this session's paths in Finder — the card's Open folder. */
  onRevealPath?: (target: SessionPathTarget) => Promise<RevealResult>
  /** ⚑ `false` where no caller can act on a press, so the band draws none (`118`). */
  canOpenConversation?: boolean
  /** ⚑ The pane's one Stop gate (`094`) — see `SessionDrawer`'s note. Absent is *cannot stop*. */
  canStopBackgroundWork?: boolean
  /** ⚑ Stop one piece of background work by the provider's own id; `false` is *it did not go out*. */
  onStopBackgroundWork?: (id: string) => Promise<boolean>
  /** ⚑ **UI-002 · the files the card's agent added** — absent is *not read*. */
  files?: readonly KeptFile[]
  /** ⚑ The newest read of {@link files} did not answer — they are the last that did. */
  filesStale?: boolean
  /** ⚑ `true` where a reader can open a file, so the card's file rows are presses. */
  canOpenDocument?: boolean
  /** ⚑ **W4.183 · compaction, as `compaction-offer.ts` gates it** — the card's and the popup's. */
  compactCapability?: CapabilityStatus | null
  compaction?: CompactionFacts | null
  /** ⚑ **F093 · `true` where "What this agent receives" can open.** Passed to the card. */
  canOpenInputs?: boolean
  /** Whether this provider can be signed into, and its machine sign-in copied, inside a profile. */
  signInCapability?: CapabilityStatus | null
  reprovisionCapability?: CapabilityStatus | null
}>()

const minute = useMinuteClock()

const emit = defineEmits<{
  navigate: [itemId: string]
  /** Show this file. The panel is the index, not the viewer — the surface above opens it. */
  openAsset: [asset: PanelAsset]
  /**
   * 🔴 **547 · UI-006 · select that agent** — a chip, the way up or a task line's giver, passed
   * straight up; the act is the screen's one door (`goToTheWork`), which opens the conversation,
   * says the host's own refusal, and selects only once it landed. ⚑ This component decides nothing
   * about it.
   */
  openConversation: [conversation: string]
  /** ⚑ **UI-002 · show this file** — passed straight up; the pane's viewer opens it. */
  openDocument: [resourceId: string]
  /** ⚑ **F093 · open "What this agent receives"** — passed straight up. */
  openInputs: []
  compactNow: [intent: 'now' | 'queue']
  /** The card's approval mode and Plan chip ask for a change, passed straight up. */
  setApprovalMode: [mode: 'ask' | 'auto']
  setSessionSetting: [body: SetSessionSettingInput['body']]
}>()

/**
 * ⛔ **The conversation that spawned this one** (631) — {@link parentCardOf}, never a second fold.
 *
 * ⚠️ **`null` is the ordinary case and draws nothing**: most conversations have no parent, and a
 * row saying so above the agent would be a sentence about an absence at the top of every panel.
 */
const castInput = computed(() => ({
  reading: props.cast ?? null,
  forConversation: props.conversation ?? '',
  identities: props.identities ?? null,
  now: minute.value,
}))

const parent = computed(() => parentCardOf(castInput.value))

/**
 * Pass `useAgentPanel`'s folded card facts together, including the model, effort, context and memory read by the Sub-agents band.
 */
const agent = useAgentPanel({
  conversation: () => props.conversation ?? null,
  session: () => props.session ?? null,
  state: () => props.state,
  who: () => props.who ?? '',
  profile: () => props.profile ?? null,
  facets: () => props.facets ?? {},
  agentState: () => props.agentState ?? null,
  named: () => props.named ?? null,
  cast: () => props.cast ?? null,
  identities: () => props.identities ?? null,
  files: () => props.files ?? null,
  revealPath: props.onRevealPath,
  openConversation: (conversation) => emit('openConversation', conversation),
  openDocument: (resourceId) => emit('openDocument', resourceId),
  navigate: (itemId) => emit('navigate', itemId),
})
// ⚑ **W4.208 · the Context popup holds "Compact now…"'s confirm**, so it never outlives the
// conversation it was opened on: this panel is reused when the selection moves.
watch(
  () => props.conversation,
  () => {
    agent.contextDialogOpen.value = false
  },
)
// The model and effort on the card open the conversation's model picker; its plan and approval
// mode beside them ask for a change through the same route the screen carries out.
const modelPick = useConversationModelPick({
  session: () => props.session ?? null,
  pickModel: () => props.pickModel,
  fixed: () => props.fixed ?? true,
  capabilities: () => props.capabilities ?? null,
})
const controls = useConversationControls({
  session: () => props.session ?? null,
  capabilities: () => props.capabilities ?? null,
  fixed: () => props.fixed ?? true,
  recorded: () => props.recorded ?? false,
  saving: () => props.approvalSaving ?? false,
  setApprovalMode: (mode) => emit('setApprovalMode', mode),
  setSessionSetting: (body) => emit('setSessionSetting', body),
})
/** This agent's own profile sign-in, shared with its conversation; `null` without a profile. */
const profileSignIn = computed(() => {
  const provider = props.session?.provider
  return provider && props.profile ? useProfileSignIn(provider, props.profile) : null
})
const telemetry = computed(
  () => new Map(agent.panel.value.subAgents.cards.map((card) => [card.conversation, card])),
)

/**
 * Read work given to this conversation using the band's own fold over the same input as {@link parent}. Reusing the fold keeps the list and band consistent.
 */
const band = computed(() => workingTogetherView(castInput.value))

/**
 * 🔴 **UI-008 · F051 — the work a person gave it**, first in its *Current task*: the root the work
 * that names it is, or `null` ({@link theWorkAPersonGave}) — which the band's walk never holds.
 */
const root = computed(() => theWorkAPersonGave(props.named))

const panel = computed(() => sessionPanel(props.state))
</script>

<template>
  <div class="session-panel" data-cy="session-panel" :data-waiting="panel.waiting">
    <!-- ⚠️ **Outside `.panel-body`, which is the scroller** (090 §3). "It does not scroll away" is
         this line as much as any CSS rule: the block is a sibling ABOVE the scroll container, so
         there is no scroll position at which it can be anywhere else.
         No SIZE condition and no state condition — the only question left is whether there is an
         agent to draw at all, and when there is not, nothing is drawn rather than a faceless
         plate. -->
    <!-- 🔴 **The conversation on screen, as an agent card** — the selected agent's (UI-006; each
         agent under it is a node on the Graph tab): the work given to it, its plate, then everything
         open in it. ⚑ It fills the panel, so its tasks and plate stay put
         and the rest scrolls (`090` §3), with the agents around it at the end of that scroller. -->
    <!-- Keep parent navigation above the card and outside its scroller: arrow, small plate and name select the parent. `parentCardOf` supplies the same fold as the band. A null parent, including before the reading arrives, draws nothing. -->
    <div v-if="parent" class="came-from" data-cy="panel-came-from">
      <button
        type="button"
        class="came-who"
        data-cy="came-from-open"
        :data-conversation="parent.conversation"
        :title="`Up to ${parent.name}`"
        @click="emit('openConversation', parent.conversation)"
      >
        <svg class="icon came-up" aria-hidden="true"><use href="#i-up" /></svg>
        <AgentState size="compact" v-bind="parent.facets" :label="parent.name" />
        <span class="came-name" :title="parent.name" data-cy="came-from-name">{{
          parent.name
        }}</span>
      </button>
    </div>
    <AgentCard
      scrolls
      :facets="props.facets"
      :agent-state="props.agentState"
      :provider-limit="props.providerLimit"
      :who="props.who"
      :profile="props.profile ?? null"
      :agent="agent"
      :model-pick="modelPick"
      :controls="controls"
      :tasks="band?.taken"
      :root="root"
      :tasks-short="band?.tookInShort ?? null"
      :can-open="props.canOpenConversation ?? false"
      :panel="panel"
      :state="props.state"
      :shown="props.shown"
      :mode="props.mode"
      :conversation="props.conversation"
      :can-stop-background-work="props.canStopBackgroundWork"
      :on-stop-background-work="props.onStopBackgroundWork"
      :files-stale="props.filesStale"
      :can-open-document="props.canOpenDocument"
      :can-open-inputs="props.canOpenInputs"
      :compact-capability="props.compactCapability"
      :compaction="props.compaction"
      :profile-sign-in="profileSignIn"
      :sign-in-capability="props.signInCapability ?? null"
      :reprovision-capability="props.reprovisionCapability ?? null"
      @navigate="(itemId) => emit('navigate', itemId)"
      @open-asset="(asset) => emit('openAsset', asset)"
      @open-conversation="(conversation) => emit('openConversation', conversation)"
      @open-document="(resourceId) => emit('openDocument', resourceId)"
      @open-inputs="emit('openInputs')"
      @compact-now="(intent) => emit('compactNow', intent)"
    >
      <!-- 🔴 **547 · who called whom** — the conversations around this one, and the work that
             passed between them. ⛔ **Props and NOT a slot**, and the slot was written first: with the
             band handed in as slot content, `SessionDrawer` would be the component that imports it —
             and `tab-flow.reach.test.mjs` derives *which tab can reach this hook* from the import
             graph rooted at each tab's own body. ⚠️ The band's hooks would have been claimed by
             `open` and reachable from nothing, which is a census going quiet rather than a design
             improving. ⚑ Forwarded whole either way: this component decides the block's PLACE and
             nothing about its content, exactly as it does for `SessionBot`, and `506` §1.4's founding
             sentence stays literally true — *nothing here subscribes to anything*.

             ⚠️ **BELOW everything that wants something from you, and that ordering is this panel's
             own.** The sections above are a priority — a permission freezes the composer, a question
             holds the turn — and *"everything below this line wants nothing from you at all"*. ⛔ A band of child cards above an open permission would
             push the one thing a person has to answer off the bottom of a 320px column.

             Keep the pane's answer first and the relationship band below its short paragraph. This preserves visible caller relationships without placing large explanations of absent children above the useful content.

             ⛑ **The disclosure was built first and rejected, and the reason is in this band's own
             comment**: `cast-covers` existed *because the child list is the only one on this band that
             makes a positive empty claim* (631 deleted it), and in the one state that draws that claim every other
             mark that could qualify it is absent by construction. ⛔ Folding it would have put a
             completeness signal behind a press, which is what `543` §4 is against. -->
      <WorkingTogether
        v-if="props.conversation"
        :reading="props.cast ?? null"
        :conversation="props.conversation"
        :identities="props.identities ?? null"
        :can-open="props.canOpenConversation ?? false"
        :telemetry="telemetry"
        @open-conversation="(conversation) => emit('openConversation', conversation)"
      />
    </AgentCard>
    <!-- Use the shared overlay host for All tasks and View all. The card retains current work and four files; popups expose their complete collections. -->
    <OverlayHost
      v-if="agent.tasksDialogOpen.value"
      label="All tasks"
      @close="agent.tasksDialogOpen.value = false"
    >
      <AllTasksDialog
        :tasks="band?.taken ?? []"
        :root="root"
        :can-open="props.canOpenConversation ?? false"
        :state="props.state"
        @close="agent.tasksDialogOpen.value = false"
        @open-conversation="
          (conversation) => {
            agent.tasksDialogOpen.value = false
            emit('openConversation', conversation)
          }
        "
      />
    </OverlayHost>
    <OverlayHost
      v-if="agent.filesDialogOpen.value"
      label="All files"
      @close="agent.filesDialogOpen.value = false"
    >
      <AllFilesDialog
        :files="props.files ?? []"
        :can-open="props.canOpenDocument ?? false"
        :query="agent.fileFilter.value"
        @close="agent.filesDialogOpen.value = false"
        @open-document="(resourceId) => emit('openDocument', resourceId)"
      />
    </OverlayHost>
    <!-- 🔴 **W4.208 · "Context", in a popup** — what the Context tab drew, opened from the card's
         context figure. ⚑ A jump to a compaction boundary shuts it, so the transcript is seen. -->
    <OverlayHost
      v-if="agent.contextDialogOpen.value"
      label="Context"
      @close="agent.contextDialogOpen.value = false"
    >
      <ContextDialog
        :state="props.state"
        :shown="props.shown"
        :mode="props.mode"
        :provider="props.session?.provider ?? ''"
        :capability="props.compactCapability ?? null"
        :conversation="props.compaction ?? null"
        @close="agent.contextDialogOpen.value = false"
        @navigate="
          (itemId) => {
            agent.contextDialogOpen.value = false
            emit('navigate', itemId)
          }
        "
        @compact-now="
          (intent) => {
            agent.contextDialogOpen.value = false
            emit('compactNow', intent)
          }
        "
      />
    </OverlayHost>
  </div>
</template>

<style scoped>
/* ⚑ **UI-006 · the way up, its own row at the top of the panel** (F045) — a quiet pill: the arrow
   in the accent, the parent's small plate and its name. ⛔ It never shrinks: the card below it is
   the scroller. */
.came-from {
  display: flex;
  min-width: 0;
  max-width: 100%;
  flex: 0 0 auto;
  margin: var(--space-4) var(--space-5) 0;
}

/* ⚠️ **A button that is a LINK** — reset, then drawn as a pill. */
.came-who {
  display: inline-flex;
  min-width: 0;
  max-width: 100%;
  align-items: center;
  padding: var(--space-1) var(--space-4) var(--space-1) var(--space-3);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-pill);
  background: var(--panel);
  color: inherit;
  cursor: pointer;
  font: inherit;
  gap: var(--space-3);
}

.came-who:hover {
  border-color: var(--accent-border);
}

.came-up {
  width: 13px;
  height: 13px;
  flex: none;
  color: var(--accent);
}

.came-name {
  overflow: hidden;
  min-width: 0;
  color: var(--text-soft);
  font-size: var(--type-small);
  font-weight: var(--fw-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* A tab body since 080, not a column of its own: the drawer owns the border, the width and the
   scroll, so this is the content and nothing around it. */
.session-panel {
  /* `flex: 1` so the panel fills the drawer body. 088 needed that height for a reason that is now
     gone (it was what `justify-content: center` on the quiet block centred WITHIN), but the height
     itself is load-bearing for a new reason: `.panel-body` below is the scroll container, and a
     `flex: 1; overflow-y: auto` child needs a definite height to scroll inside instead of growing. */
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  /* ⚠️ **This is what makes the pin a RULE rather than a sentence** (090 review).
     `.drawer-body` still has `overflow: auto` — it has to, it scrolls the other five tabs — and the
     bot is `flex: 0 0 auto`, so it does not shrink. Squeeze the window below the strip plus the
     block (~213px of viewport) and the bot overflowed THIS box, `.drawer-body` saw it and became
     the scroller, and the one thing this task is about — a bot that cannot scroll away — stopped
     being true. It clips here instead. The same line is the backstop if `min-height: 0` above ever
     goes: without it, the invariant was a comment claiming `.drawer-body` never fires, with nothing
     making that so. */
  overflow: hidden;
}
</style>
