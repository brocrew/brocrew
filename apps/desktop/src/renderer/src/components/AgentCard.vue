<script setup lang="ts">
import type { ProviderLimitDisplay } from '../lib/provider-limit-status'
import { fileManagerHere } from '../lib/this-computer'
import { showName } from '../lib/message-paths'
import { computed, ref, watch } from 'vue'
import { assetUrl } from '../../../shared/asset-url'
import type { AgentState as OneState } from '../../../shared/agent-state'
import type { WorkThatNamesIt } from '../../../shared/piece-called'
import type { AgentFacets } from '../lib/agent-state'
import { agoWords } from '../lib/clock'
import {
  barFraction,
  formatTokens,
  groupTokens,
  isRedline,
  percentText,
} from '../lib/context-meter'
import { FILES_DID_NOT_ANSWER, fileKindOf, fileTitleSays } from '../lib/files-kept'
import { ROWS_UNREAD_LEAD } from '../lib/rows-unread'
import type { PanelAsset, PanelEntry, SessionPanel as SessionPanelView } from '../lib/session-panel'
import type { TranscriptState } from '../lib/transcript'
import { isVisibleIn, type TranscriptMode } from '../lib/transcript-mode'
import { latestWords } from '../lib/latest-words'
import type { CastTask } from '../lib/working-together'
import { useMinuteClock } from '../composables/useMinuteClock'
import type { AgentPanelActs } from '../composables/useAgentPanel'
import type { ConversationModelPick } from '../composables/useConversationModelPick'
import {
  CHANGES_APPLY_NEXT,
  type ConversationControls,
} from '../composables/useConversationControls'
import ModelPicker from './ModelPicker.vue'
import AgentBookButton from './AgentBookButton.vue'
import CardApproval from './CardApproval.vue'
import AgentState from './AgentState.vue'
import BackgroundBar from './BackgroundBar.vue'
import CardEmpty from './CardEmpty.vue'
import CardSection from './CardSection.vue'
import ScheduleBar from './ScheduleBar.vue'
import SessionBot from './SessionBot.vue'
import TaskList from './TaskList.vue'
import CardCompactDoor from './CardCompactDoor.vue'
import SignInPanel from './SignInPanel.vue'
import type { ProfileSignIn } from '../composables/useProfileSignIn'
import type { CapabilityStatus } from '../../../shared/runtime-ipc'
import type { CompactionFacts } from '../lib/compaction-offer'

/**
 * Draw the agent card for the conversation on screen, using the shared avatar and available agent facts.
 *
 * List work given to this conversation. Agents below it appear as nodes in the main panel's Graph tab, with the work given to each.
 *
 * Draw three parts in order:
 * 1. `SessionBot` shows the plate, name, profile, state and place, with latest words when this window holds the transcript.
 * 2. Current task lists work given to the agent and its giver, with an empty section when none exists.
 * 3. Transcript facts show permissions, questions, provider sub-agents, workflows, checklist and assets for the selected conversation.
 *
 * ⚑ **`scrolls`: the card that fills the panel keeps part 1 still and scrolls the rest** — the pin
 * `090` §3 made for the bot — and draws whatever the caller slots in at the end of that scroller.
 */
const props = defineProps<{
  /** ⚑ The agent's plate — absent draws no plate rather than a faceless one. */
  facets?: AgentFacets
  providerLimit?: ProviderLimitDisplay | null
  who?: string
  profile?: string | null
  /**
   * ⚑ The work given TO this agent, oldest first. ⛔ **Absent is *not read yet***, never *none*: the
   * Current task box then says nothing has been read rather than *No current task*.
   */
  tasks?: readonly CastTask[]
  /**
   * 🔴 **UI-008 · F051 — the work a PERSON gave this agent's conversation: its root** — drawn first
   * in *Current task*, for the person and never a press; `null` or absent where it owns none.
   * ⚠️ Drawn with {@link tasks}, once its walk has been read: the box says one thing at a time.
   */
  root?: WorkThatNamesIt | null
  /** ⚑ `rows-unread.ts`' sentence for the walk behind {@link tasks}, when it could not read rows. */
  tasksShort?: string | null
  /** ⚑ `false` where no caller can act on a press, so the task lines draw none (`118`). */
  canOpen: boolean
  /** ⚑ What this window's transcript of the agent says is open. */
  panel: SessionPanelView
  state: TranscriptState
  /**
   * ⚑ **D-017 · R11 — this agent's ONE state** (`stateHere`), for the word under its plate — the
   * rail row's own, and `list_agents'`. Absent, the plate says the arm's plain word.
   */
  agentState?: OneState
  shown?: TranscriptState
  mode: TranscriptMode
  conversation?: string
  /** ⚑ The pane's one Stop gate (`094`) — see `SessionDrawer`'s note. Absent is *cannot stop*. */
  canStopBackgroundWork?: boolean
  /** ⚑ Stop one piece of background work by the provider's own id; `false` is *it did not go out*. */
  onStopBackgroundWork?: (id: string) => Promise<boolean>
  /** ⚑ The card that fills the panel: parts 1–2 stay, part 3 and the slot scroll. */
  scrolls?: boolean
  /**
   * Pass the facts and actions folded by `useAgentPanel` together: folder, run strip, task counts and files. When absent, draw none of them.
   */
  agent?: AgentPanelActs
  /**
   * This conversation's model and effort, as its settings choose them: where a pick can reach it,
   * the model and the effort in the run strip open the model picker.
   */
  modelPick?: ConversationModelPick | null
  /**
   * Its plan and approval mode and what is queued for its next message: the Plan chip, the
   * approval mode beside the plate, and the queued changes under the run strip. Absent draws none.
   */
  controls?: ConversationControls | null
  /** ⚑ The newest read of the files did not answer — they are the last that did, and say so. */
  filesStale?: boolean
  /** ⚑ `true` where a reader can open a file, so each row is a press; absent draws plain rows. */
  canOpenDocument?: boolean
  /**
   * ⚑ **W4.183 · compaction, as `compaction-offer.ts` gates it** — the provider's capability and this
   * conversation's send facts. ⛔ Absent draws no door.
   */
  compactCapability?: CapabilityStatus | null
  /** Its profile's sign-in, drawn here when it has expired or is missing, with its gestures. */
  profileSignIn?: ProfileSignIn | null
  signInCapability?: CapabilityStatus | null
  reprovisionCapability?: CapabilityStatus | null
  compaction?: CompactionFacts | null
  /** ⚑ **F093 · `true` where "What this agent receives" can open** — absent draws no button. */
  canOpenInputs?: boolean
}>()

const emit = defineEmits<{
  navigate: [itemId: string]
  openAsset: [asset: PanelAsset]
  openConversation: [conversation: string]
  /** ⚑ **UI-002 · show this file** — the surface above opens it, by its id. */
  openDocument: [resourceId: string]
  /** ⚑ **F093 · open "What this agent receives"** — the pane above raises the popup. */
  openInputs: []
  openBook: [profileSlug: string]
  /** ⚑ **W4.183 · the person answered the confirm** — sent up as the Context popup sends it. */
  compactNow: [intent: 'now' | 'queue']
}>()

/** ⚑ **UI-002 · the Files box**: by piece, the newest first (`07` §2 item 2). */
/** ⚑ The folder and the run strip, from the v3 fold — nothing where it was not handed. */
const run = computed(() => props.agent?.panel.value.run ?? null)
const picker = ref<InstanceType<typeof ModelPicker> | null>(null)
const mayPick = computed(() => props.modelPick?.changeable.value === true)
const plan = computed(() => props.controls?.plan.value ?? null)
const approval = computed(() => props.controls?.approval.value ?? null)
const pending = computed(() => props.controls?.pending.value ?? [])

function openThePicker(event: MouseEvent, at: 'model' | 'effort'): void {
  const button = event.currentTarget
  if (button instanceof HTMLElement) picker.value?.openedFrom(button, at)
}
const workspace = computed(() => props.agent?.panel.value.workspace ?? null)
const files = computed(() => props.agent?.panel.value.files ?? null)
const counts = computed(() => props.agent?.panel.value.taskCounts ?? null)
/** ⚑ Every piece "All tasks" lists: the work given to it, and the root a person gave. */
const allTasks = computed(() => (counts.value?.all ?? 0) + (root.value === null ? 0 : 1))
/** ⚑ A copied path says so for a moment on the Copy control itself. */
const copied = ref(false)
/** ⚑ W4.183 · a tile's type tag (PNG, PDF…), from its file name. */
const formatOf = (file: { name: string }): string => {
  const dot = file.name.lastIndexOf('.')
  return dot > 0 ? file.name.slice(dot + 1).toUpperCase() : ''
}
const kindOf = fileKindOf
/** ⚑ "Workspace ⌄" shows the folder's path under the two buttons. */
const pathShown = ref(false)
async function copyPath(): Promise<void> {
  if (props.agent === undefined) return
  copied.value = await props.agent.copyPath()
  if (copied.value) setTimeout(() => (copied.value = false), 1600)
}

// Current reasons keep the listed jobs visible even when automatic starts leave the state idle.
const scheduleShown = computed(
  () =>
    props.state.schedule.jobs.some((job) => job.notStarted !== undefined) ||
    (props.agentState?.is !== 'idle' && props.agentState?.is !== 'waiting-on-a-worker'),
)
/** ⚑ The bar's own answer where nothing can stop: *it did not go out* (`BackgroundBar`'s contract). */
const refuseStop = (): Promise<boolean> => Promise.resolve(false)
const root = computed(() => props.root ?? null)
// ⚑ **UI-008 · a root is open for as long as its conversation is** — it never ends (R1).
const hasTasks = computed(
  () => props.tasks !== undefined && (props.tasks.length > 0 || root.value !== null),
)
const hasOpenTask = computed(
  () => root.value !== null || (props.tasks?.some((one) => one.piece.open) ?? false),
)

/**
 * ⚑ **Each piece's brief, by its label** — the words that gave it, which arrived in this
 * conversation as the turn that opened it (`RelayedItem.opened`). ⛔ Only where this window holds
 * the transcript, and the newest words for a label win: a new brief replaces the old.
 */
const briefs = computed(() => {
  const found = new Map<string, string>()
  for (const item of props.state.items) {
    const label = item.kind === 'relayed' ? item.opened?.label : undefined
    if (label !== undefined && item.kind === 'relayed' && item.text.trim() !== '')
      found.set(label, item.text.trim())
  }
  return found
})

/**
 * Show the latest words and their age beside the plate only when this window holds the transcript. See `latest-words.ts`.
 */
const latest = computed(() => latestWords(props.state))
const minute = useMinuteClock()
const latestAgo = computed(() =>
  latest.value?.at == null ? null : agoWords(latest.value.at, minute.value),
)
function showLatest(): void {
  if (latest.value && canReach(latest.value.itemId)) emit('navigate', latest.value.itemId)
}

/**
 * Use the Context popup's `state.meter` reading: a percentage when the window size is known, window size not reported otherwise, and an em dash before any reading. The figure opens the popup even before a reading arrives; missing usage is not zero.
 */
const PENDING_CAPABILITY = {
  state: 'absent',
  reason: 'Still asking this provider what it can do.',
  checkedAgainst: 'the capability fetch has not returned yet',
} as const
const signInNeeded = computed(() => {
  const state = props.profileSignIn?.auth?.state
  return state === 'stale' || state === 'absent'
})

const context = computed(() => {
  const reading = props.state.meter.reading
  if (reading.kind === 'unknown')
    return { figure: '—', detail: 'no reading yet', fill: null, limit: false }
  if (reading.kind === 'tokens')
    return {
      figure: formatTokens(reading.used),
      detail: 'window size not reported',
      fill: null,
      limit: false,
    }
  // ⚑ W4.183 · v3 draws the context in tokens ("910k"); the share is on its title.
  return {
    figure: formatTokens(reading.used),
    detail: `${percentText(reading) ?? '—'}% of ${groupTokens(reading.window)} tokens`,
    fill: barFraction(reading),
    limit: isRedline(reading),
  }
})

/**
 * Rows are identical in every section but their label, so they render through one list.
 *
 * A section with nothing in it is not rendered at all — not rendered empty. "Open" is the panel's
 * entire contract, and four permanent headings sitting at zero would be a list of things that are
 * NOT happening, which is the transcript's job and not this one's.
 */
const SECTIONS = [
  { key: 'permissions', label: 'Permissions', cy: 'panel-permissions' },
  { key: 'questions', label: 'Questions', cy: 'panel-questions' },
  /**
   * 🔴 **506 · `Sub-agents`, and the rename is the same defect the empty paragraph carried.**
   *
   * Label this section Sub-agents: its rows come from this conversation's `sub_agent` events, using Claude's `task_id` or Codex's `agentThreadId`. The left rail's Agents section lists app identities, a different population. Match the rows' `sub-agent` fallback wording.
   *
   * ⛔ **The hook is unchanged.** `panel-agents` is what the render tests, the live smoke and
   * `tab-flow.mjs` address this band by; renaming a handle would move three instruments to say
   * one word better.
   */
  { key: 'agents', label: 'Sub-agents', cy: 'panel-agents' },
  /**
   * 108. **One row per running workflow, never its agents.** A 22-agent fan-out is one happening,
   * and the list this sits in is read at a glance — see `session-panel.ts` on why the children stay
   * in the tree.
   *
   * ⚠️ Last on purpose. The order above is a priority: a permission freezes the composer, a question
   * holds the turn, an agent is working. A workflow is working too and wants nothing from you, so it
   * sits below everything that might.
   */
  { key: 'workflows', label: 'Workflows', cy: 'panel-workflows' },
] as const

/**
 * The item ids a click could actually reach.
 *
 * One pass, and only over the handful of ids the panel is showing. An entry whose item is filtered
 * out of the current view has nowhere to scroll to, and a row that silently does nothing when
 * pressed is the thing this codebase keeps deleting — so it is disabled and says why instead.
 */
const reachable = computed(() => {
  const wanted = new Set<string>()
  // ⚠️ **Derived from {@link SECTIONS}, not restated** (108 review, HIGH). It used to list the three
  // sections by hand, and adding a fourth — `workflows` — left every one of its rows permanently
  // disabled, wired to a click that could never fire, wearing "this part of the conversation is not
  // on screen" about a tool row that was right there. The one thing the row exists to do could not
  // be done, and nothing failed. Reading the same list the template renders makes the next section
  // reachable by construction rather than by somebody remembering two places.
  const view = props.panel
  const within = props.shown ?? props.state
  for (const section of SECTIONS)
    for (const entry of view[section.key] as PanelEntry[]) wanted.add(entry.itemId)
  if (view.todo) wanted.add(view.todo.itemId)
  if (latest.value) wanted.add(latest.value.itemId)

  // Walked over what is RENDERED, which is a different fold from the one listed above whenever the
  // reader has scrolled off the tail. The two folds have their own id spaces, so nothing from the
  // live tail matches anything in a window of old history — which is the right answer: those rows
  // genuinely are not on screen, and the row says so rather than doing nothing when pressed.
  const found = new Set<string>()
  for (const item of within.items) {
    if (wanted.has(item.id) && isVisibleIn(props.mode, item)) found.add(item.id)
  }
  return found
})

const canReach = (itemId: string): boolean => reachable.value.has(itemId)

/** ⚑ The tiles whose picture would not load — they draw the image mark instead of a broken one. */
const unloaded = ref(new Set<string>())

/**
 * Show Stop beside a running provider sub-agent. The bar above the composer keeps its own stop control.
 *
 * ⚑ **Only where the provider lists it as running work it can stop**: a sub-agent row is keyed
 * `agent:<id>` (`session-panel.ts`), and `<id>` is Claude's `task_id` — the same id the background
 * registry names and stops by. ⛔ One gate, `canStopBackgroundWork`, exactly as the bar reads it.
 */
const AGENT_KEY = 'agent:'
const stopIdOf = (section: string, entry: PanelEntry): string | null => {
  if (section !== 'agents' || !props.canStopBackgroundWork || !props.onStopBackgroundWork)
    return null
  if (!entry.key.startsWith(AGENT_KEY)) return null
  const id = entry.key.slice(AGENT_KEY.length)
  return props.state.background.running.some((row) => row.id === id) ? id : null
}

/** ⚑ Asked, and not yet ended — the bar's own in-flight rule; forgotten when the stop did not go out. */
const asked = ref(new Set<string>())
watch(
  () => props.conversation,
  () => {
    asked.value = new Set()
  },
)
async function stop(id: string): Promise<void> {
  asked.value = new Set(asked.value).add(id)
  if (!(await props.onStopBackgroundWork!(id))) {
    const next = new Set(asked.value)
    next.delete(id)
    asked.value = next
  }
}

const sections = computed(() => {
  const view = props.panel
  return SECTIONS.map((section) => ({
    ...section,
    entries: view[section.key] as PanelEntry[],
  })).filter((section) => section.entries.length > 0)
})

const fileManager = fileManagerHere()
</script>

<template>
  <div class="agent-card" :class="{ scrolls: props.scrolls }">
    <!-- ⚑ **2 · The agent**, one size wherever it is drawn. -->
    <SessionBot
      v-if="props.facets"
      :facets="props.facets"
      :who="props.who"
      :profile="props.profile ?? null"
      :state="props.agentState"
      :provider-limit="props.providerLimit"
    >
      <template v-if="approval || props.profile" #head>
        <AgentBookButton
          compact
          v-if="props.profile"
          :profile-slug="props.profile"
          @open="(profile) => emit('openBook', profile)"
        />
        <CardApproval
          v-if="approval"
          :approval="approval"
          @choose="(mode) => props.controls?.chooseApproval(mode)"
        />
      </template>
      <!-- Show the workspace path with actions to reveal it in the file manager or copy it. -->
      <template v-if="workspace && workspace.name" #rail>
        <span class="workspace-dock" data-cy="card-workspace">
          <button
            type="button"
            class="workspace-label"
            :aria-expanded="pathShown"
            :title="workspace.path.value ?? ''"
            data-cy="card-workspace-name"
            @click="pathShown = !pathShown"
          >
            Workspace
            <svg class="icon" aria-hidden="true"><use href="#i-chevron" /></svg>
          </button>
          <span class="workspace-tools">
            <button
              type="button"
              class="workspace-control"
              :disabled="!props.agent?.mayOpenFolder.value"
              :title="showName(workspace.name, fileManager)"
              :aria-label="showName(workspace.name, fileManager)"
              data-cy="card-workspace-open"
              @click="void props.agent?.openFolder()"
            >
              <svg class="icon" aria-hidden="true"><use href="#i-folder" /></svg>
            </button>
            <button
              type="button"
              class="workspace-control"
              :title="copied ? 'Copied' : 'Copy the workspace path'"
              :aria-label="copied ? 'Copied' : 'Copy the workspace path'"
              data-cy="card-workspace-copy"
              @click="void copyPath()"
            >
              <svg class="icon" aria-hidden="true">
                <use :href="copied ? '#i-check' : '#i-copy'" />
              </svg>
            </button>
          </span>
          <span v-if="pathShown" class="workspace-path" data-cy="card-workspace-path">{{
            workspace.path.value
          }}</span>
          <span v-if="props.agent?.folderSaid.value" class="workspace-said" role="status">
            {{ props.agent.folderSaid.value }}
          </span>
        </span>
      </template>
      <p v-if="approval?.pendingLine" class="approval-pending" data-cy="card-approval-pending">
        {{ approval.pendingLine }}
      </p>
      <!-- ⚑ **Its latest words, in a bubble beside the plate** — a way IN like every row here: a
           press shows the message in the conversation, where it is on screen. -->
      <component
        :is="canReach(latest.itemId) ? 'button' : 'p'"
        v-if="latest"
        class="said"
        :class="{ pressable: canReach(latest.itemId) }"
        v-bind="canReach(latest.itemId) ? { type: 'button' } : {}"
        data-cy="card-latest"
        :data-item="latest.itemId"
        :title="latest.text"
        @click="showLatest"
      >
        <svg class="icon said-icon" aria-hidden="true"><use href="#i-chat" /></svg>
        <span class="said-text" data-cy="card-latest-words">{{ latest.text }}</span>
        <span v-if="latestAgo" class="said-ago" data-cy="card-latest-ago">{{ latestAgo }}</span>
      </component>
    </SessionBot>

    <!-- Show model, effort, context usage and process memory in the run strip. Omit facts this window lacks and explain missing readings where the strip names them. Provide the door to the conversation's supplied context. -->
    <div class="run-strip" data-cy="card-run">
      <span class="run-settings">
        <!-- With no model known yet, a conversation that can change it still offers the picker. -->
        <component
          :is="mayPick ? 'button' : 'span'"
          v-if="run?.model.value || mayPick"
          v-bind="
            mayPick
              ? {
                  type: 'button',
                  popovertarget: picker?.panelId,
                  'aria-haspopup': 'dialog',
                  'aria-expanded': picker?.isOpen ?? false,
                  'aria-label': run?.model.value
                    ? `Change model, now ${run.model.value}`
                    : 'Choose a model',
                }
              : {}
          "
          class="run-item run-model"
          :title="run?.model.value ? `Model: ${run.model.value}` : 'No model named yet'"
          data-cy="card-run-model"
          @click="(event: MouseEvent) => mayPick && openThePicker(event, 'model')"
        >
          <svg class="icon" aria-hidden="true"><use href="#i-cube" /></svg>
          <span class="run-value">{{ run?.model.value || 'Choose model' }}</span>
        </component>
        <component
          :is="mayPick ? 'button' : 'span'"
          v-if="run?.effort.value"
          v-bind="
            mayPick
              ? {
                  type: 'button',
                  popovertarget: picker?.panelId,
                  'aria-haspopup': 'dialog',
                  'aria-expanded': picker?.isOpen ?? false,
                  'aria-label': `Change effort, now ${run.effort.value}`,
                }
              : {}
          "
          class="run-item run-effort"
          :title="`Reasoning effort: ${run.effort.value}`"
          data-cy="card-run-effort"
          @click="(event: MouseEvent) => mayPick && openThePicker(event, 'effort')"
        >
          <svg class="icon" aria-hidden="true"><use href="#i-gauge" /></svg>
          <span class="run-value">{{ run.effort.value }}</span>
        </component>
        <!-- Plan first: a press turns it on where the conversation can take it. The way out of a
             plan stays the plan's own, below the transcript or the provider's own request. -->
        <component
          :is="plan.canTurnOn ? 'button' : 'span'"
          v-if="plan"
          v-bind="plan.canTurnOn ? { type: 'button', 'aria-label': plan.label } : {}"
          class="run-item run-plan"
          :class="{ pending: plan.pending }"
          :title="plan.title"
          data-cy="card-run-plan"
          :data-state="plan.state"
          @click="plan.canTurnOn && props.controls?.turnPlanOn()"
        >
          <svg class="icon" aria-hidden="true"><use href="#i-file" /></svg>
          <span class="run-value">{{ plan.word }}</span>
        </component>
      </span>
      <span class="run-metrics">
        <!-- 🔴 **W4.208 · the figure opens the Context popup** — the gauge, its source, every
             compaction and "Compact now…", which the Context tab held until it was retired. -->
        <component
          :is="props.agent ? 'button' : 'span'"
          v-bind="props.agent ? { type: 'button' } : {}"
          class="run-item context"
          :class="{ limit: context.limit }"
          :title="`Context: ${context.figure} · ${context.detail}`"
          :aria-haspopup="props.agent ? 'dialog' : undefined"
          data-cy="card-run-context"
          @click="props.agent?.openContext()"
        >
          <svg class="icon" aria-hidden="true"><use href="#i-layers" /></svg>
          <strong class="context-figure">{{ context.figure }}</strong>
        </component>
        <span
          v-if="run?.memory.value"
          class="run-item"
          title="Memory held by its agent process. The commands it runs are not counted."
          data-cy="card-run-memory"
        >
          <svg class="icon" aria-hidden="true"><use href="#i-ram" /></svg>
          <span class="run-value">{{ run.memory.value }}</span>
        </span>
        <!-- 🔴 **W4.183 · "Compact now…"**, beside what it acts on — the Context popup's own door. -->
        <CardCompactDoor
          v-if="props.compactCapability !== undefined"
          :capability="props.compactCapability"
          :conversation="props.compaction ?? null"
          @compact-now="(intent) => emit('compactNow', intent)"
        />
      </span>
    </div>
    <!-- The conversation's own model picker; its panel is placed by whichever of the model and
         the effort was pressed. -->
    <ModelPicker
      v-if="mayPick && props.modelPick?.picker.value"
      ref="picker"
      faceless
      v-bind="props.modelPick.picker.value"
    />
    <!-- What the last pick became, and, while a change waits for the next message, what is asked
         for against what runs now. -->
    <div
      v-if="props.modelPick?.became.value || pending.length > 0"
      class="run-became"
      data-cy="card-pick-became"
    >
      <p v-if="props.modelPick?.became.value" class="became-said">
        {{ props.modelPick.became.value }}
      </p>
      <p v-if="pending.length > 0" class="became-said" data-cy="card-pending">
        {{ CHANGES_APPLY_NEXT }}
        <span v-for="line in pending" :key="line.cy" :data-cy="line.cy">{{ ' ' + line.text }}</span>
      </p>
    </div>
    <!-- Its profile's sign-in, when it has expired or is missing: renewed here, without a restart. -->
    <div v-if="signInNeeded && props.profileSignIn" class="card-sign-in" data-cy="card-sign-in">
      <SignInPanel
        :provider="props.profileSignIn.provider"
        :state="props.profileSignIn.auth"
        :sign-in="props.signInCapability ?? PENDING_CAPABILITY"
        :reprovision="props.reprovisionCapability ?? PENDING_CAPABILITY"
        :busy="props.profileSignIn.busy"
        :notice="props.profileSignIn.notice"
        @check="props.profileSignIn.check()"
        @reprovision="props.profileSignIn.copyMachineSignIn()"
        @sign-in="props.profileSignIn.signIn()"
        @cancel-sign-in="props.profileSignIn.cancel()"
      />
    </div>
    <!-- 🔴 **F093 (C1 a) · the one addition to v3** — the door to everything it is given. -->
    <button
      v-if="props.canOpenInputs"
      type="button"
      class="bb-button bb-button--quiet inputs-door"
      data-cy="card-open-inputs"
      @click="emit('openInputs')"
    >
      <svg class="icon" aria-hidden="true"><use href="#i-info" /></svg>
      Instructions, memory and tools
    </button>

    <!-- ⚑ **3 · Whatever else is known about it**, and the caller's slot at the end. ⚠️ On the
         scrolling card this is `090` §3's scroller: parts 1–2 above it never scroll away. -->
    <div class="panel-body" data-cy="panel-body">
      <!-- Show work given to this agent under Current task: draw the selected work in full and the rest as single lines. Preserve the `cast-taken*` hooks used by these rows. -->
      <CardSection
        class="card-task"
        icon="#i-play"
        accent
        fold="brobot2.cardTaskFolded"
        data-cy="card-task"
      >
        <template #title>
          <span data-cy="cast-taken-heading">Current task</span>
        </template>
        <!-- ⚑ **W4.183 · v3's "All tasks (n) →"**: the current piece alone until it is pressed. -->
        <!-- ⛔ Offered wherever a piece is not already shown: the current one is, the rest are not. -->
        <template v-if="allTasks > (hasOpenTask ? 1 : 0)" #action>
          <button
            type="button"
            class="text-action"
            aria-haspopup="dialog"
            data-cy="card-tasks-all"
            @click="props.agent?.openTasks()"
          >
            All tasks
            <span class="text-action-count">({{ allTasks }})</span>
            <svg class="icon" aria-hidden="true"><use href="#i-arrow" /></svg>
          </button>
        </template>
        <!-- ⛔ **Not read yet is not *no task*** — before the work given to this agent has been read,
             the box says so rather than claiming there is none (`641` §5.5's rule, and the state a
             selected agent's card is in between its selection and its read, UI-006). -->
        <p v-if="props.tasks === undefined" class="task-unread" data-cy="card-task-unread">
          Nothing has been read about its work yet.
        </p>
        <CardEmpty
          v-else-if="!hasOpenTask"
          icon="#i-check"
          says="No current task"
          hint="Work given to this agent appears here."
          data-cy="card-task-empty"
        />
        <TaskList
          v-if="hasTasks"
          data-cy="cast-taken"
          :tasks="props.tasks!"
          mode="current"
          :root="root"
          :can-open="props.canOpen"
          :briefs="briefs"
          @open-conversation="(conversation) => emit('openConversation', conversation)"
        />
        <!-- Show work counts by state. -->
        <p v-if="counts && counts.all > 0" class="task-counts" data-cy="card-task-counts">
          <span class="task-count active"
            ><svg class="icon" aria-hidden="true"><use href="#i-play" /></svg
            ><strong>{{ counts.active }}</strong> active</span
          >
          <span class="task-count open"
            ><svg class="icon" aria-hidden="true"><use href="#i-clock" /></svg
            ><strong>{{ counts.open }}</strong> open</span
          >
          <span class="task-count closed"
            ><svg class="icon" aria-hidden="true"><use href="#i-check" /></svg
            ><strong>{{ counts.closed }}</strong> closed</span
          >
        </p>
        <!-- 🔴 **678 · F-R18a** — the walk behind it counted rows it could not read. -->
        <p v-if="props.tasksShort" class="gap" data-cy="cast-taken-short">
          <strong>{{ ROWS_UNREAD_LEAD }}</strong>
          {{ props.tasksShort }}
        </p>
      </CardSection>

      <section
        v-for="section in sections"
        :key="section.key"
        class="panel-section"
        :data-cy="section.cy"
      >
        <div class="section-head">
          <span>{{ section.label }}</span>
          <span class="tally">{{ section.entries.length }}</span>
        </div>
        <div v-for="entry in section.entries" :key="entry.key" class="row-line">
          <button
            class="row"
            type="button"
            data-cy="panel-row"
            :data-item="entry.itemId"
            :data-mark="Boolean(entry.facets)"
            :disabled="!canReach(entry.itemId)"
            :title="
              canReach(entry.itemId)
                ? 'Show this in the conversation'
                : 'This part of the conversation is not on screen'
            "
            @click="emit('navigate', entry.itemId)"
          >
            <!-- The agent this row is about (082). A permission and a question look different at a
                 glance now instead of only reading differently, and a running sub-agent shows what it
                 is on. The facets are decided by the projection with the item in hand — this template
                 never infers a state from which section it is rendering. -->
            <AgentState
              v-if="entry.facets"
              size="compact"
              v-bind="entry.facets"
              :label="entry.title"
            />
            <span class="row-copy">
              <span class="row-title">{{ entry.title }}</span>
              <span v-if="entry.detail" class="row-detail">{{ entry.detail }}</span>
            </span>
          </button>
          <!-- ⚑ **Stop, beside the row and never inside it** — a button in a button is invalid, and the
               row is the way IN; this is the one act. See {@link stopIdOf}. -->
          <button
            v-if="stopIdOf(section.key, entry)"
            class="row-stop"
            type="button"
            :disabled="asked.has(stopIdOf(section.key, entry)!)"
            :title="
              asked.has(stopIdOf(section.key, entry)!)
                ? 'Asked to stop. The provider reports the ending on its own.'
                : 'Stop this one. The conversation keeps running.'
            "
            @click="void stop(stopIdOf(section.key, entry)!)"
          >
            {{ asked.has(stopIdOf(section.key, entry)!) ? 'Stopping…' : 'Stop' }}
          </button>
        </div>
      </section>

      <!-- Show background work and the schedule on the agent card, using the same `control` projection and the pane's Stop gate. Template comments enter SSR markup, so keep them free of quoted runtime messages. -->
      <div class="card-bars">
        <BackgroundBar
          :registry="props.state.background"
          :conversation="props.conversation ?? ''"
          :can-stop="props.canStopBackgroundWork ?? false"
          :on-stop="props.onStopBackgroundWork ?? refuseStop"
          fold="brobot2.cardBackgroundFolded"
        />
        <template v-if="scheduleShown">
          <ScheduleBar :registry="props.state.schedule" fold="brobot2.cardScheduleFolded" />
        </template>
      </div>

      <!-- The checklist, while it still has a step left. It renders as a summary rather than as a
           second copy of `PlanEntry`: the entry in the conversation is the plan, and this is a
           reminder that there is one, one click away from it. -->
      <section v-if="props.panel.todo" class="panel-section" data-cy="panel-todo">
        <div class="section-head">
          <span>Checklist</span>
          <span class="tally"
            >{{ props.panel.todo.done }} of {{ props.panel.todo.steps.length }}</span
          >
        </div>
        <button
          class="row"
          type="button"
          data-cy="panel-row"
          :data-item="props.panel.todo.itemId"
          :disabled="!canReach(props.panel.todo.itemId)"
          title="Show the checklist in the conversation"
          @click="emit('navigate', props.panel.todo.itemId)"
        >
          <ol class="steps">
            <li
              v-for="(step, index) in props.panel.todo.steps"
              :key="index"
              class="step"
              :class="step.status"
              :data-status="step.status"
            >
              <span class="mark" aria-hidden="true">{{ step.status === 'done' ? '✓' : '' }}</span>
              <span class="step-text">{{ step.text }}</span>
            </li>
          </ol>
          <span v-if="props.panel.todo.note" class="row-detail">{{ props.panel.todo.note }}</span>
        </button>
      </section>

      <!-- 🔴 **UI-002 · what this agent made, and the inputs it handed over** — `07-where-resources-show`
           §2 item 2: *"what has this agent made?"*, grouped by piece, the newest first. ⛔ Nothing
           read draws no box, and neither does a real zero, as *Images* draws none. -->
      <!-- Show a file filter, the four newest tiles and the remaining count. View all opens the complete list grouped by work, newest first. -->
      <CardSection
        v-if="files && files.total > 0"
        class="card-files"
        icon="#i-file"
        :count="files.total"
        fold="brobot2.cardFilesFolded"
        data-cy="card-files"
      >
        <template #title>Files</template>
        <template #action>
          <button
            type="button"
            class="text-action"
            aria-haspopup="dialog"
            data-cy="card-files-all"
            @click="props.agent?.openFiles()"
          >
            View all
            <svg class="icon" aria-hidden="true"><use href="#i-arrow" /></svg>
          </button>
        </template>
        <label class="files-filter">
          <svg class="icon" aria-hidden="true"><use href="#i-search" /></svg>
          <input
            v-if="props.agent"
            :value="props.agent.fileFilter.value"
            @input="props.agent.filterFiles(($event.target as HTMLInputElement).value)"
            type="search"
            placeholder="Filter files or task labels…"
            aria-label="Filter this agent's files by name or task label"
            data-cy="card-files-filter"
          />
        </label>
        <p v-if="files.why" class="files-why" data-cy="card-files-why">{{ files.why }}</p>
        <template v-else>
          <ul class="file-tiles" data-cy="card-file-tiles">
            <li v-for="file in files.tiles" :key="file.resourceId">
              <component
                :is="props.canOpenDocument ? 'button' : 'div'"
                v-bind="props.canOpenDocument ? { type: 'button' } : {}"
                class="file-tile"
                :class="{ flat: !props.canOpenDocument }"
                data-cy="card-file"
                :data-document="file.resourceId"
                :data-role="file.role"
                :title="fileTitleSays(file)"
                @click="props.canOpenDocument && emit('openDocument', file.resourceId)"
              >
                <span class="file-tile-top">
                  <span class="file-tile-tag" :title="file.pieceTitle ?? file.label">{{
                    file.label
                  }}</span>
                  <span v-if="formatOf(file)" class="file-tile-format">{{ formatOf(file) }}</span>
                </span>
                <span class="file-tile-glyph" :data-kind="kindOf(file)" aria-hidden="true">
                  <svg class="icon">
                    <use
                      :href="
                        kindOf(file) === 'image' || kindOf(file) === 'svg' ? '#i-image' : '#i-file'
                      "
                    />
                  </svg>
                </span>
                <span class="file-tile-name">{{ file.title }}</span>
              </component>
            </li>
          </ul>
          <p class="files-caption" data-cy="card-files-caption">
            {{ files.tiles.length }} of {{ files.matching.length }}
            {{ files.matching.length === 1 ? 'file' : 'files'
            }}{{ files.matching.length < files.total ? ` · ${files.total} in all` : '' }}
            <button
              v-if="files.more > 0"
              type="button"
              class="files-all"
              data-cy="card-files-more"
              aria-haspopup="dialog"
              @click="props.agent?.openFiles()"
            >
              +{{ files.more }} more
            </button>
          </p>
        </template>
        <!-- ⚠️ **A list kept from the last read that answered says so**, once, under it. -->
        <p v-if="props.filesStale" class="files-stale" data-cy="card-files-stale">
          {{ FILES_DID_NOT_ANSWER }}
        </p>
      </CardSection>

      <!-- Show generated images after open work so pending actions remain first. Each tile contains the image, filename and file kind, with the generation prompt in its title. Use Images for generated pictures and Files for artifacts kept on work. Preserve the `panel-assets` hook used by `tab-flow.mjs`. -->
      <CardSection
        v-if="props.panel.assets.length > 0"
        class="card-images"
        icon="#i-image"
        :count="props.panel.assets.length"
        data-cy="panel-assets"
      >
        <template #title>Images</template>
        <ul class="tiles">
          <li v-for="asset in props.panel.assets" :key="asset.key">
            <button
              class="tile"
              type="button"
              data-cy="panel-asset"
              :data-item="asset.itemId"
              :title="asset.prompt ? `Open this image — ${asset.prompt}` : 'Open this image'"
              @click="emit('openAsset', asset)"
            >
              <span class="thumb" aria-hidden="true">
                <svg v-if="unloaded.has(asset.key)" class="icon"><use href="#i-image" /></svg>
                <img
                  v-else
                  :src="assetUrl(asset.path)"
                  alt=""
                  loading="lazy"
                  @error="unloaded = new Set(unloaded).add(asset.key)"
                />
              </span>
              <span class="tile-name" :title="asset.name">{{ asset.name }}</span>
              <span class="tile-kind">Image</span>
            </button>
          </li>
        </ul>
      </CardSection>
      <slot />
    </div>
  </div>
</template>

<style scoped>
/* ⚑ **The card that fills the panel** — a column whose last part is the scroller (`090` §3). */
.agent-card.scrolls {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
}

/* ⚑ **The bubble** — the accent's own quiet fill, and a notch pointing back at the plate. */
.said {
  position: relative;
  display: flex;
  width: 100%;
  align-items: flex-start;
  margin: var(--space-3) 0 0;
  padding: var(--space-4) var(--space-5);
  border: 0;
  border-radius: var(--radius-lg);
  /* ⚑ W4.183 · v3's lilac: the accent mixed into the panel, so it follows the drawer's surface. */
  background: var(--accent-mix-12);
  color: var(--text-soft);
  font: inherit;
  gap: var(--space-4);
  text-align: left;
}

.said::before {
  position: absolute;
  top: var(--space-5);
  left: -4px;
  width: 9px;
  height: 9px;
  background: inherit;
  content: '';
  transform: rotate(45deg);
}

.said.pressable {
  cursor: pointer;
}

.said.pressable:hover .said-text {
  color: var(--text);
}

.said-icon {
  width: 14px;
  height: 14px;
  margin-top: 1px;
  color: var(--accent);
}

.said-text {
  display: -webkit-box;
  overflow: hidden;
  min-width: 0;
  flex: 1 1 auto;
  -webkit-box-orient: vertical;
  font-size: var(--type-body);
  -webkit-line-clamp: 3;
  line-height: 1.45;
}

.said-ago {
  flex: none;
  align-self: center;
  color: var(--faint);
  font-size: var(--type-caption);
  white-space: nowrap;
}

/*
 * Mix the theme's accent into the panel for tints that follow the drawer's light surface.
 */
.agent-card {
  container: agent-card / inline-size;
}

/* The workspace dock, under the avatar: "Workspace ⌄", then two buttons in one bordered pair. */
.workspace-dock {
  display: grid;
  width: 76px;
  gap: var(--space-2);
}

.workspace-label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  background: none;
  color: var(--muted);
  cursor: pointer;
  font-size: var(--type-caption);
  gap: var(--space-1);
}

.workspace-label:hover {
  color: var(--accent-text);
}

.workspace-label .icon {
  width: 10px;
  height: 10px;
  transform: rotate(90deg);
}

.workspace-label[aria-expanded='true'] .icon {
  transform: rotate(-90deg);
}

.workspace-tools {
  display: grid;
  overflow: hidden;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
  background: var(--accent-mix-5);
  grid-template-columns: 1fr 1fr;
}

.workspace-control {
  display: grid;
  height: 31px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  cursor: pointer;
  place-items: center;
}

.workspace-control + .workspace-control {
  border-left: var(--border-width) solid var(--line);
}

.workspace-control:hover:not(:disabled) {
  background: var(--accent-mix-12);
}

.workspace-control:disabled {
  color: var(--faint);
  cursor: default;
}

.workspace-control .icon {
  width: 15px;
  height: 15px;
}

.workspace-path,
.workspace-said {
  color: var(--faint);
  font-size: var(--type-caption);
  overflow-wrap: anywhere;
  text-align: center;
}

/* The model row: one bordered strip — the model in monospace and its effort, then the context in
   tokens and the memory its process holds. It folds in two where the panel is narrow (v3: 430px). */
.run-strip {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  margin: 0 var(--space-6) var(--space-4);
  padding: var(--space-2) var(--space-3);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
  background: var(--accent-mix-5);
  gap: var(--space-1) var(--space-3);
}

.run-settings,
.run-metrics {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.run-metrics {
  margin-left: auto;
}

.run-item {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  padding: var(--space-1) var(--space-2);
  color: var(--text-soft);
  font-size: var(--type-caption);
  gap: var(--space-2);
}

.run-item .icon {
  width: 13px;
  height: 13px;
  flex: none;
  color: var(--muted);
}

.run-value {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.run-model .run-value {
  color: var(--text-soft);
  font-family: var(--font-mono);
  font-size: var(--type-caption);
  overflow-wrap: anywhere;
  white-space: normal;
}

.run-effort .run-value {
  color: var(--accent-text);
  font-weight: var(--fw-semibold);
}

.context-figure {
  color: var(--text-soft);
  font-weight: var(--fw-normal);
}

.context.limit .context-figure {
  color: var(--danger);
}

button.context {
  border: var(--border-width) solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: var(--type-caption);
}

button.context:hover {
  border-color: var(--accent-border);
  background: var(--accent-mix-8);
}

/* The model and the effort, where a press opens the model picker: drawn as the context figure. */
button.run-model,
button.run-effort,
button.run-plan {
  border: var(--border-width) solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: var(--type-caption);
}

button.run-model:hover,
button.run-effort:hover,
button.run-plan:hover,
button.run-model[aria-expanded='true'],
button.run-effort[aria-expanded='true'] {
  border-color: var(--accent-border);
  background: var(--accent-mix-8);
}

.run-became {
  margin: 0 var(--space-6) var(--space-4);
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: 1.4;
}

.became-said {
  margin: 0;
}

/* The plan's word in the accent, as the effort's is. A queued change is said under the strip. */
.run-plan .run-value {
  color: var(--accent-text);
  font-weight: var(--fw-semibold);
}

/* A border in every state, so a queued change marks the chip without moving the strip. */
.run-plan {
  border: var(--border-width) solid transparent;
  border-radius: var(--radius-sm);
}

.run-plan.pending {
  border-style: dashed;
  border-color: var(--line-strong);
}

/* The chosen mode applies with the next message. */
.approval-pending {
  margin: 0;
  color: var(--accent-text);
  font-size: var(--type-small);
}

@container agent-card (max-width: 430px) {
  .run-settings,
  .run-metrics {
    width: 100%;
    justify-content: space-between;
  }

  .run-metrics {
    padding-top: var(--space-1);
    border-top: var(--border-width) solid var(--line);
    margin-left: 0;
  }
}

.card-sign-in {
  flex: 0 0 auto;
  margin: 0 var(--space-6) var(--space-4);
}

.inputs-door {
  /* ⚑ Ida's review: aligned with the panel's content, not centred like a heading. */
  align-self: flex-start;
  margin: 0 var(--space-6) var(--space-4);
}

/* A heading's one act, as v3's "All tasks (17) →" and "View all →". */
.text-action {
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent-text);
  cursor: pointer;
  font-size: var(--type-caption);
  gap: var(--space-2);
  white-space: nowrap;
}

.text-action-count {
  color: var(--muted);
}

.text-action .icon {
  width: 12px;
  height: 12px;
}

/* Its work in three counts, under the current task. */
.task-counts {
  display: flex;
  flex-wrap: wrap;
  margin: var(--space-4) 0 0;
  color: var(--muted);
  font-size: var(--type-caption);
  gap: var(--space-2) var(--space-6);
}

.task-count {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.task-count .icon {
  width: 11px;
  height: 11px;
}

.task-count strong {
  color: var(--text-soft);
}

.task-count.active .icon {
  color: var(--accent);
}

.task-count.open .icon {
  color: var(--waiting);
}

.task-count.closed .icon {
  color: var(--success);
}

/* The Files box: a filter, four tiles, a caption. */
.files-filter {
  display: flex;
  align-items: center;
  margin-top: var(--space-4);
  padding: 0 var(--space-4);
  border: var(--border-width) solid var(--control-border);
  border-radius: var(--radius-md);
  color: var(--muted);
  gap: var(--space-3);
}

.files-filter:focus-within {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

.files-filter .icon {
  width: 13px;
  height: 13px;
  flex: none;
}

.files-filter input {
  min-width: 0;
  flex: 1;
  padding: var(--space-3) 0;
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: var(--type-caption);
  outline: none;
}

.files-why {
  margin: var(--space-4) 0 0;
  color: var(--faint);
  font-size: var(--type-caption);
}

.file-tiles {
  display: grid;
  margin: var(--space-4) 0 0;
  padding: 0;
  gap: var(--space-3);
  grid-template-columns: repeat(4, minmax(0, 1fr));
  list-style: none;
}

.file-tile {
  display: flex;
  width: 100%;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  padding: var(--space-3) var(--space-3) var(--space-4);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
  background: var(--accent-mix-5);
  color: inherit;
  font: inherit;
  gap: var(--space-3);
  text-align: center;
}

.file-tile:not(.flat) {
  cursor: pointer;
}

.file-tile:not(.flat):hover {
  border-color: var(--accent-border);
  background: var(--accent-mix-12);
}

.file-tile-top {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-1);
}

.file-tile-tag {
  overflow: hidden;
  padding: 0 var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--accent-mix-12);
  color: var(--accent-text);
  font-size: var(--type-caption);
  font-weight: var(--fw-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-tile-format {
  color: var(--muted);
  font-size: var(--type-caption);
}

/*
 * Near the panel's 360px minimum width, show the four newest files in two columns so names retain space and the displayed count remains accurate.
 */
@container agent-card (max-width: 439px) {
  .file-tiles {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.file-tile-glyph {
  display: grid;
  width: 30px;
  height: 32px;
  border-radius: var(--radius-md);
  background: color-mix(
    in srgb,
    var(--_tint, var(--accent)) 12%,
    var(--panel)
  ); /* raw: mixes the tint this element sets for itself */
  color: var(--_tint, var(--accent));
  place-items: center;
}

.file-tile-glyph[data-kind='image'] {
  --_tint: var(--success);
}

.file-tile-glyph[data-kind='pdf'] {
  --_tint: var(--danger);
}

.file-tile-glyph[data-kind='svg'] {
  --_tint: var(--waiting);
}

.file-tile-glyph .icon {
  width: 18px;
  height: 18px;
}

.file-tile-name {
  display: -webkit-box;
  overflow: hidden;
  width: 100%;
  -webkit-box-orient: vertical;
  color: var(--text-soft);
  font-size: var(--type-caption);
  -webkit-line-clamp: 2;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.files-caption {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  margin: var(--space-4) 0 0;
  color: var(--text-soft);
  font-size: var(--type-caption);
  font-weight: var(--fw-semibold);
  gap: var(--space-3);
}

.files-all {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent-text);
  cursor: pointer;
  font-size: var(--type-caption);
  font-weight: var(--fw-normal);
}

/* ⚑ The running and scheduled bars, at the panel's margins. */
.card-bars {
  display: flex;
  flex-direction: column;
  padding: 0 var(--space-5);
  gap: var(--space-3);
}

.card-bars:empty {
  display: none;
}

/* ⚑ The work given to this agent — at the panel's margins, above its plate. The heading and the gap
   line are the band's own register. */
.card-task {
  margin: 0 var(--space-5) var(--space-5);
}

.task-unread {
  margin: 0;
  color: var(--faint);
  font-size: var(--type-small);
}

.card-task .tasks {
  margin: 0;
}

.card-images,
.card-files {
  margin: 0 var(--space-5) var(--space-5);
}

/* ⚑ **UI-002 · one piece a row**: its label in a column of its own, its files beside it. */

/* ⚑ **One tile per file** — as many to a row as the column holds, never narrower than a name. */
.tiles {
  display: grid;
  margin: 0;
  padding: 0;
  gap: var(--space-4);
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  list-style: none;
}

.tile {
  display: flex;
  width: 100%;
  min-width: 0;
  flex-direction: column;
  padding: var(--space-3) var(--space-3) var(--space-4);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
  color: inherit;
  cursor: pointer;
  font: inherit;
  gap: var(--space-2);
  text-align: left;
}

.tile:hover {
  border-color: var(--accent-border);
}

.thumb {
  display: flex;
  overflow: hidden;
  align-items: center;
  justify-content: center;
  margin-bottom: var(--space-2);
  border-radius: var(--radius-xs);
  aspect-ratio: 4 / 3;
  background: var(--wash-2);
}

.thumb .icon {
  width: 22px;
  height: 22px;
  color: var(--faint);
}

.thumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.tile-name {
  overflow: hidden;
  color: var(--text);
  font-size: var(--type-small);
  font-weight: var(--fw-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tile-kind {
  color: var(--muted);
  font-size: var(--type-caption);
}

.card-task .gap,
.files-stale {
  margin: 0;
  padding: var(--space-4);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
  background: var(--wash-1);
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: 1.5;
}

/* ⚠️ **The scroller, and it is here rather than on the drawer for one reason** (090 §3): the bot
   above it must not scroll away, and `.drawer-body` — which scrolls every OTHER tab — would take
   the whole panel with it. This one takes the list only. */
.panel-body {
  display: flex;
  flex-direction: column;
}

.agent-card.scrolls > .panel-body {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  /* Matched to `.drawer-body`'s, so moving the scroll did not move the look of it. */
  scrollbar-color: var(--scrollbar-thumb) transparent;
  scrollbar-width: thin;
}

.panel-section + .panel-section {
  border-top: var(--border-width) solid var(--line);
}

.section-head {
  display: flex;
  align-items: center;
  padding: var(--space-5) var(--space-6) var(--space-3);
  color: var(--muted);
  font-size: var(--type-caption);
  gap: var(--space-3);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
}

.tally {
  margin-left: auto;
  color: var(--faint);
  letter-spacing: 0;
  text-transform: none;
}

/* ⚑ A row and, for a running sub-agent the provider can stop, its Stop beside it. */
.row-line {
  display: flex;
  align-items: center;
}

.row-line > .row {
  min-width: 0;
  flex: 1;
}

/* The bar's own Stop, one size: the same act in two places looks like one act. */
.row-stop {
  flex: 0 0 auto;
  margin-right: var(--space-6);
  padding: var(--space-3) var(--space-5);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-soft);
  cursor: pointer;
  font-size: var(--type-caption);
}

.row-stop:hover:not(:disabled) {
  background: var(--wash-2);
}

.row-stop:disabled {
  color: var(--faint);
  cursor: default;
}

.row {
  display: grid;
  width: 100%;
  align-items: center;
  padding: var(--space-3) var(--space-6);
  border: 0;
  border-left: var(--border-accent-width) solid transparent;
  background: transparent;
  color: var(--text-soft);
  gap: var(--space-4);
  /* One column when the row has no agent — a checklist is not an agent, so it must not be indented
     as if a mark had been left out. */
  grid-template-columns: minmax(0, 1fr);
  text-align: left;
}

.row[data-mark='true'] {
  grid-template-columns: 24px minmax(0, 1fr);
}

.row-copy {
  min-width: 0;
}

.row:hover:not(:disabled) {
  border-left-color: var(--accent);
  background: var(--wash-5);
}

/* A row with nowhere to jump to still SAYS the thing is open — that is the panel's job — it just
   stops pretending to be a control. */
.row:disabled {
  border-left-color: transparent;
  cursor: default;
  opacity: 0.55;
}

.row-title {
  display: block;
  overflow: hidden;
  font-size: var(--type-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* One line, clipped. The whole detail is on the card this row jumps to, and a panel row that grows
   to four lines pushes the thing under it off the bottom of a column that exists to be scannable. */
.row-detail {
  display: block;
  overflow: hidden;
  margin-top: var(--space-1);
  color: var(--faint);
  font-size: var(--type-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.steps {
  margin: 0;
  padding: 0;
  list-style: none;
}

.step {
  display: grid;
  align-items: baseline;
  padding: 1px 0;
  color: var(--muted);
  font-size: var(--type-caption);
  gap: var(--space-3);
  grid-template-columns: 10px minmax(0, 1fr);
  line-height: var(--leading-relaxed);
}

/* The same shape grammar as the checklist in the conversation (028): an empty ring pending, a
   filled dot active, a tick done — so the colour is reinforcement and never the only signal. */
.mark {
  display: grid;
  width: 10px;
  height: 10px;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-pill);
  font-size: var(--type-caption);
  place-items: center;
  transform: translateY(1px);
}

.step.active {
  color: var(--text-soft);
}

.step.active .mark {
  border-color: var(--accent);
  background: var(--accent);
}

.step.done {
  color: var(--faint);
}

.step.done .step-text {
  text-decoration: line-through;
}

.step.done .mark {
  border-color: var(--success);
  color: var(--success);
}
</style>
