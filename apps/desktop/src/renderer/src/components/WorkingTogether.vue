<script setup lang="ts">
import { vButtonKeys } from '../lib/button-keys'
import ConversationRow from './ConversationRow.vue'
import MarkdownWords from './MarkdownWords.vue'
import ModelPicker from './ModelPicker.vue'
import { computed, reactive, shallowReactive } from 'vue'
import type { Provider } from '@brobot2/shared'
import type { AgentIdentity, ProviderCapabilityMap } from '../../../shared/runtime-ipc'
import type { WorkEdge } from '../../../shared/who-called-whom'
import { TASK_IS_OPEN } from '../../../shared/tasks'
import { usePersistentChoice, usePersistentToggle } from '../composables/usePersistentToggle'
import { onPurposeSaid, workerName, workerState } from '../lib/conversation-list'
import { useMinuteClock } from '../composables/useMinuteClock'
import { useWhoCalledWhom } from '../composables/useWhoCalledWhom'
import { NOT_MEASURED, NOT_RUNNING_NOW, type AgentPanelSubAgent } from '../lib/agent-panel'
import { standingOf, type AgentFacets } from '../lib/agent-state'
import {
  inTheirPlace,
  LIST_DOUBT_WORDS,
  workingTogetherView,
  type CastCard,
  type CastReading,
} from '../lib/working-together'
import { compactionFactsOfAListedConversation, type CompactionFacts } from '../lib/compaction-offer'
import type { PickedModel } from '../lib/model-lists'
import CardCompactDoor from './CardCompactDoor.vue'
import CardEmpty from './CardEmpty.vue'
import CardSection from './CardSection.vue'
import { ROWS_UNREAD_LEAD } from '../lib/rows-unread'

/**
 * 🔴 **Who called whom, drawn** (547) — the first consumer of `543`'s `whoCalledWhom`, and the
 * first tab's new subject.
 *
 * ## ⛔ What a person sees, and what they saw before
 *
 * Show who is calling whom and let the person navigate between conversations. A single avatar and local pending-card count cannot describe delegated work elsewhere.
 *
 * ## ⚑ 577 · this band is UNCHANGED, and `EXT-010` §3.2 was answered one component up
 *
 * ⛔ **The PO: *"it is mostly explanation — two paragraphs about spawned conversations, on a
 * conversation with no children"*, and the remedy *"behind a disclosure, or below"*.** ⚠️ `577`
 * built the disclosure first and then measured what would go behind it: `cast-covers` WAS
 * `WALK_COVERS`' sentence (631 deleted it, with `ListCoverage.says`), and the comment on it says why it exists — *because the child list is
 * the only one on this band that makes a positive empty claim*. 🔴 **It is the QUALIFIER of
 * `No spawned conversations`, and in the one state that draws that claim — `answered`, no doubt,
 * `rowsUnread === 0` — every other mark that could qualify it is absent by construction.**
 * ⛑ A completeness signal a person has to press for is a completeness signal `543` §4 did not ask
 * for, so the other remedy was taken: `SessionPanel.vue` now draws this band BELOW the pane's own
 * answer instead of above it.
 *
 * ## ⚑ One card is a CONVERSATION — not an identity and not a task (v2.8 §01)
 *
 * ⛔ **A task-first flat list duplicates the avatar and loses direction; a role-first list MERGES
 * distinct conversations made from one identity** — the exact case `543` §0 plants and
 * `WorkGivenOut` cannot tell apart. ⚑ So the recipient is never drawn twice; the work it was given
 * is drawn on its own card, by the Graph tab, not by this band.
 *
 * ## 🔴 Where the state comes from, and where it stops
 *
 * ⛔ **No navigation state is drawn** — D-017b: a chip opens its conversation whatever it is doing,
 * through the screen's one door, and draws no press at all where nothing above it can act (`118`).
 *
 * ⛔ **No liveness word, of any shape.** `509`'s ruled field may not go on a reader whose cadence is
 * longer than the silence window, and this band re-reads on the half-minute. ⚑ **A card that says
 * what a conversation IS without claiming whether it is still alive is a complete card.**
 *
 * ## ⚠️ Every blank here is a different fact, and none of them is `0 spawned`
 *
 *  - **first read in flight** → the screen supplies the conversation being read; the band shows
 *    loading only until that relationship read settles.
 *  - **a complete, empty child list** → `No spawned conversations`, and `ListCoverage.count === 0`
 *    is the only thing that can produce it.
 *  - **a read that could not look, or a word this build cannot spell** → {@link LIST_DOUBT_WORDS},
 *    per LIST, because those are facts about one walk.
 *  - **a read that did not answer** → `THE_READ_DID_NOT_ANSWER`, ONCE, beside the moment it is
 *    about. ⛔ **Not per list**: `answered` is one boolean over one round trip, so three lists would
 *    have drawn three blocks for one fact — which is what v2.8 §06's *same anchor* means and what a
 *    surviving mutation row cost to learn.
 *  - **rows the walk could not read** → counted, once per list, and never added to anything.
 */
const props = defineProps<{
  /** ⚑ `null` until the first read for this conversation lands. */
  reading: CastReading | null
  /** The conversation this drawer is showing — what the reading is checked against. */
  conversation: string
  /** ⚑ `null` until the identities read lands — a cold window names every card by its slug. */
  identities: readonly AgentIdentity[] | null
  /** ⚑ `false` where no caller can act on a press, so none is drawn. */
  canOpen: boolean
  /**
   * 🔴 **W4.183 · each card's model, effort, context and memory** — `useAgentPanel`'s sub-agent
   * cards, by conversation. ⛔ Absent draws no telemetry row.
   */
  telemetry?: ReadonlyMap<string, AgentPanelSubAgent>
  /** What each provider can do, so a card's context figure can offer Compact now. */
  capabilities?: ProviderCapabilityMap | null
}>()

const emit = defineEmits<{
  /** ⛔ **Names the conversation and does nothing else** — the act is the screen's (506). */
  openConversation: [conversation: string]
}>()

/**
 * ⛔ **A minute clock, never a mount-time constant** — `504`'s finding two surfaces over. The age
 * below is measured from the read's own completion point, so an instant frozen at mount would make
 * a band that has just been re-read look older than the reading it came from.
 */
const minute = useMinuteClock()

const view = computed(() =>
  workingTogetherView({
    reading: props.reading,
    forConversation: props.conversation,
    identities: props.identities,
    now: minute.value,
  }),
)

/** ⚑ Every agent this conversation works with: the ones it spawned, then the others it gave work to. */
const cast = useWhoCalledWhom()

const listedById = computed(() => {
  const rows = cast.listedConversations.value ?? []
  const byId = new Map<string, (typeof rows)[number]>()
  for (const row of rows) {
    if (!byId.has(row.sessionId)) byId.set(row.sessionId, row)
  }
  return byId
})

// ⚑ F094 · a replaced conversation is drawn as its stand-in (D-034's place map, from the forest).
const allAgents = computed(() =>
  view.value
    ? inTheirPlace(
        [...view.value.children, ...view.value.others],
        cast.forest.value,
        props.identities,
      ).map((card) => {
        const listed = listedCard(card)
        const worker = listed?.worker
        return worker ? { ...card, name: workerName(worker, props.identities) } : card
      })
    : [],
)

const latestFirst = usePersistentToggle('brobot2.subAgents.latestFirst', false)
const idleChoices = [
  { value: 'false', label: 'Off', hours: 0 },
  { value: '1h', label: '1 h', hours: 1 },
  { value: '6h', label: '6 h', hours: 6 },
  { value: '24h', label: '24 h', hours: 24 },
  { value: 'true', label: 'All', hours: Infinity },
] as const
const idleRange = usePersistentChoice(
  'brobot2.subAgents.showIdle',
  'true' as (typeof idleChoices)[number]['value'],
  (value): value is (typeof idleChoices)[number]['value'] =>
    idleChoices.some((choice) => choice.value === value),
)
const idleHours = computed(
  () => idleChoices.find((choice) => choice.value === idleRange.value)!.hours,
)
function listedCard(card: CastCard) {
  return listedById.value.get(card.conversation)
}
// Classify the same cards the panel names, without treating an unread state as idle.
function hiddenWhenIdle(card: CastCard): boolean {
  const shown = asTheRailSays(card.conversation, card.facets)
  const listed = listedCard(card)
  return (
    card.replacedBy === undefined &&
    standingOf(shown.facets) === 'idle' &&
    !shown.facets.needing &&
    (shown.word === undefined || shown.word === 'idle') &&
    onPurposeSaid(listed?.state.is === 'idle', listed?.waitingOnPurpose) === null
  )
}
const idleAgents = computed(
  () => new Set(allAgents.value.filter(hiddenWhenIdle).map((card) => card.conversation)),
)
function showsIdle(card: CastCard): boolean {
  if (idleRange.value === 'false') return false
  if (idleRange.value === 'true') return true
  const at = listedCard(card)?.updatedAt
  return at === undefined || at >= minute.value - idleHours.value * 60 * 60_000
}
const agents = computed(() => {
  const rows = allAgents.value.filter(
    (card) => !idleAgents.value.has(card.conversation) || showsIdle(card),
  )
  return latestFirst.value
    ? rows.sort((a, b) => (listedCard(b)?.updatedAt ?? 0) - (listedCard(a)?.updatedAt ?? 0))
    : rows
})
const hiddenIdleCount = computed(
  () =>
    allAgents.value.filter((card) => idleAgents.value.has(card.conversation) && !showsIdle(card))
      .length,
)
/** The card's one task line: its newest piece, label first, and how many more it holds. */
function taskLine(
  card: CastCard,
): { key: string; label: string; title: string; more: number } | null {
  const named = listedCard(card)?.named
  if (named) {
    return { key: named.label, label: named.label, title: named.title ?? '', more: named.more ?? 0 }
  }
  const pieces = [...(piecesByConversation.value.get(card.conversation) ?? [])].sort(
    (a, b) => b.givenAt - a.givenAt,
  )
  const newest = pieces[0]
  return newest
    ? { key: newest.piece, label: newest.label, title: newest.title, more: pieces.length - 1 }
    : null
}

/** What the host knows of a card's conversation that decides whether Compact now is offered. */
function compactionOf(card: CastCard): CompactionFacts {
  return compactionFactsOfAListedConversation({
    is: listedCard(card)?.state.is,
    running:
      cast.runningConversations.value?.some((row) => row.sessionId === card.conversation) ?? false,
    who: card.name,
  })
}

const canCompact = computed(
  () => props.canOpen && props.capabilities !== undefined && cast.compact.value !== null,
)
function compactCapability(card: CastCard) {
  const provider = listedCard(card)?.provider
  const capabilities = props.capabilities
  return provider && capabilities && Object.hasOwn(capabilities, provider)
    ? capabilities[provider as Provider].requestCompaction
    : null
}
/** The conversation's own model chooser, opened from a card's model or effort. */
const canPick = computed(
  () => props.canOpen && props.capabilities !== undefined && cast.pickModel.value !== null,
)
const pickers = shallowReactive(new Map<string, InstanceType<typeof ModelPicker>>())
function pickerOf(card: CastCard) {
  const listed = listedCard(card)
  if (!canPick.value || !listed) return null
  const provider = listed.provider as Provider
  const facts = props.telemetry?.get(card.conversation)
  return {
    providers: [provider],
    profileId: listed.identity,
    shown: facts?.model.value
      ? { provider, model: facts.model.value, effort: facts.effort.value }
      : null,
    empty: 'Not named yet',
    takeWords: 'Switch from its next message',
    take: async (pick: PickedModel) =>
      (await cast.pickModel.value?.(card.conversation, pick)) ?? null,
    capabilities: props.capabilities ?? null,
  }
}
function openPicker(event: MouseEvent, conversation: string, at: 'model' | 'effort'): void {
  if (event.currentTarget instanceof HTMLElement)
    pickers.get(conversation)?.openedFrom(event.currentTarget, at)
}

/** The host's refusal of the last Compact now pressed on a card, by conversation. */
const compactRefused = reactive(new Map<string, string>())
async function compactCard(conversation: string): Promise<void> {
  compactRefused.delete(conversation)
  const refused = await cast.compact.value?.(conversation)
  if (refused) compactRefused.set(conversation, refused)
}

const piecesByConversation = computed(() => {
  const byConversation = new Map<string, WorkEdge[]>()
  if (!view.value || !props.reading) return byConversation
  const edges = new Map<string, WorkEdge>()
  for (const node of cast.forest.value?.nodes.rows ?? []) {
    if (node.node === 'a-task') edges.set(node.work.piece, node.work)
  }
  const read = props.reading.read
  for (const piece of [...read.workGivenOut.rows, ...read.workTakenIn.rows]) {
    edges.set(piece.piece, piece)
  }
  for (const piece of edges.values()) {
    if (!Object.hasOwn(TASK_IS_OPEN, piece.state) || !TASK_IS_OPEN[piece.state]) continue
    const held = byConversation.get(piece.to) ?? []
    held.push(piece)
    byConversation.set(piece.to, held)
  }
  return byConversation
})

/**
 * 🔴 **UI-001 · every agent here as its rail row draws it** — the plate and the word
 * (the cast's `railSays`), so this panel and the rail say one thing, and a row the window is not
 * fed says the host's one state: `get_agent_status`'. ⚑ BroBot's check: this card read *idle* for
 * Ana (a job due at 21:10) and *working* for Ayo (waiting on BroBot's answer), off whether their
 * processes ran. ⛔ Nothing here reads that now. ⚠️ A conversation the rail does not name yet draws
 * the faceless plate; with no rail on screen at all, the band's own reading.
 */
function asTheRailSays(
  conversation: string,
  own: AgentFacets,
): { facets: AgentFacets; word?: string; detail?: string } {
  const rail = cast.railSays.value
  if (rail === null) return { facets: own }
  return rail.get(conversation) ?? { facets: {} }
}

/** A card's four facts; the context figure last, so its Compact now confirm opens under the row. */
function metricsOf(card: AgentPanelSubAgent) {
  return (
    [
      ['model', 'Model', '#i-cube', card.model],
      ['effort', 'Reasoning effort', '#i-gauge', card.effort],
      ['memory', 'Memory (RAM)', '#i-ram', card.memory],
      ['context', 'Context', '#i-layers', card.context],
    ] as const
  ).map(([key, label, icon, fact]) => ({
    key,
    label,
    icon,
    value:
      fact.value === null
        ? null
        : `${fact.value}${card.from[key as keyof typeof card.from] ? ` (${card.from[key as keyof typeof card.from]})` : ''}`,
    short: fact.value,
    why: fact.value === null ? fact.why : '',
  }))
}

const totals = computed(() => ({
  active: allAgents.value.length - idleAgents.value.size,
  idle: idleAgents.value.size,
  known: allAgents.value.every(
    (card) =>
      card.replacedBy === undefined &&
      standingOf(asTheRailSays(card.conversation, card.facets).facets) !== 'unknown',
  ),
}))

/** The status line of the piece a card's agent waits on purpose with, while its word says so. */
function onPurposeLine(card: CastCard): string | null {
  const listed = listedCard(card)
  const said = onPurposeSaid(listed?.state.is === 'idle', listed?.waitingOnPurpose)
  return said !== null && chipWord(card) === said.word
    ? (listed?.waitingOnPurpose?.status ?? null)
    : null
}

/** ⚑ The chip's word: its rail row's — or, F094, that it was replaced, and by whom; never *idle*. */
function chipWord(card: CastCard): string | undefined {
  if (card.replacedBy !== undefined) return `replaced by ${card.replacedBy}`
  const word = asTheRailSays(card.conversation, card.facets).word
  return listedCard(card)?.worker ? workerState(word, listedCard(card)?.named) : word
}
</script>

<template>
  <section class="cast" data-cy="working-together">
    <!-- Place children directly below the parent without a redundant heading: the containing panel already identifies this conversation. -->

    <p
      v-if="!view && cast.loadingFor.value === conversation"
      class="quiet"
      role="status"
      data-cy="cast-loading"
    >
      Loading sub agents…
    </p>
    <p v-else-if="!view" class="quiet" data-cy="cast-not-read">
      Nothing has been read about the conversations around this one yet.
    </p>

    <template v-else>
      <!-- Keep only child-list warnings here, without an extra no-parent sentence or coverage reassurance. -->

      <!-- Avoid repeating the root conversation's name and state; the large avatar above the band already identifies it. -->

      <!-- List small agent chips side by side, first spawned conversations and then other conversations given work. Selecting a chip opens its agent as a Graph card does. Preserve `cast-children-strip`, which `tab-flow.mjs` uses. -->
      <!-- Count the Sub-agents strip and show each small plate, state-colored dot and name. Draw an empty box only for a known zero with no other agent on the strip. -->
      <CardSection
        class="sub-agents"
        icon="#i-users"
        :count="allAgents.length"
        data-cy="cast-sub-agents"
      >
        <template #title><span title="Started here">Started here</span></template>
        <!-- ⚑ **W4.183 · how many are at work** — v3's totals on the heading. -->
        <template v-if="telemetry && allAgents.length && totals.known" #action>
          <span class="team-totals" data-cy="cast-sub-agents-totals">
            <span class="team-total is-active"
              ><span class="chip-dot" aria-hidden="true"></span
              ><strong>{{ totals.active }}</strong> active</span
            >
            <span class="team-total"
              ><span class="chip-dot" aria-hidden="true"></span
              ><strong>{{ totals.idle }}</strong> idle</span
            >
          </span>
        </template>
        <div
          v-if="allAgents.length && (canOpen || hiddenIdleCount)"
          class="cast-controls"
          data-cy="cast-controls"
        >
          <button
            v-if="canOpen"
            type="button"
            class="cast-toggle"
            :aria-pressed="latestFirst"
            data-cy="cast-latest-first"
            @click="latestFirst = !latestFirst"
          >
            Latest first
          </button>
          <label v-if="canOpen" class="cast-idle-choice">
            Show idle
            <select v-model="idleRange" class="bb-input" data-cy="cast-show-idle">
              <option v-for="choice in idleChoices" :key="choice.value" :value="choice.value">
                {{ choice.label }}
              </option>
            </select>
          </label>
          <span v-if="hiddenIdleCount" class="quiet" data-cy="cast-idle-hidden"
            >{{ hiddenIdleCount }} idle hidden</span
          >
        </div>
        <ol v-if="agents.length" class="agent-chips" data-cy="cast-children-strip">
          <li v-for="card in agents" :key="`chip-${card.conversation}`">
            <!-- The card: its press opens that agent's conversation, and its figures sit under the press so the context figure can be a press of its own. -->
            <div class="chip-card" :class="{ flat: !canOpen }">
              <div
                v-bind="canOpen ? { role: 'button', tabindex: 0, title: `Open ${card.name}` } : {}"
                class="agent-chip"
                :aria-description="asTheRailSays(card.conversation, card.facets).detail"
                :class="{ flat: !canOpen }"
                :data-worker="listedCard(card)?.worker ? true : undefined"
                :data-conversation="card.conversation"
                @click="canOpen && emit('openConversation', card.conversation)"
                v-button-keys
              >
                <!-- Plate, name, profile and state, with a chevron when it can be opened; then one task line, what it said, and its figures under a line. -->
                <ConversationRow
                  class="team-identity"
                  plate="row"
                  id-prefix="cast"
                  :row="{
                    id: card.conversation,
                    facets: asTheRailSays(card.conversation, card.facets).facets,
                    plateLabel: card.name,
                    head: 'plain',
                    title: card.name,
                    marks: [
                      ...(taskLine(card)
                        ? [
                            {
                              key: 'label',
                              text: taskLine(card)!.label,
                              tone: 'label',
                              hint: [taskLine(card)!.label, taskLine(card)!.title]
                                .filter(Boolean)
                                .join(' · '),
                              cy: `cast-tile-label-${card.conversation}`,
                            },
                          ]
                        : []),
                      ...(card.conversation === conversation
                        ? [
                            {
                              key: 'owner',
                              text: 'this conversation',
                              cy: `cast-tile-owner-${card.conversation}`,
                            },
                          ]
                        : []),
                    ],
                    status: {
                      profile: card.identity,
                      word: chipWord(card) || null,
                      detail: asTheRailSays(card.conversation, card.facets).detail ?? undefined,
                    },
                  }"
                  :cy="{
                    title: `cast-tile-name-${card.conversation}`,
                    word: `cast-tile-word-${card.conversation}`,
                    profile: `cast-tile-profile-${card.conversation}`,
                  }"
                >
                  <template #aside>
                    <svg v-if="canOpen" class="icon team-chevron" aria-hidden="true">
                      <use href="#i-chevron" />
                    </svg>
                  </template>
                </ConversationRow>
              </div>
              <div
                v-if="taskLine(card)?.title || taskLine(card)?.more"
                class="chip-task"
                :title="taskLine(card)!.title"
              >
                <MarkdownWords
                  v-if="taskLine(card)!.title"
                  compact
                  class="chip-task-text"
                  :text="taskLine(card)!.title"
                  :session-id="card.conversation"
                  :data-cy="`cast-tile-piece-${card.conversation}-${taskLine(card)!.key}`"
                /><span
                  v-if="taskLine(card)!.more > 0"
                  class="chip-more"
                  :title="`${taskLine(card)!.more} more open`"
                  :data-cy="`cast-tile-piece-${card.conversation}-more`"
                  >+{{ taskLine(card)!.more }}</span
                >
              </div>
              <div
                v-if="onPurposeLine(card)"
                class="chip-says"
                :title="onPurposeLine(card)!"
                :data-cy="`cast-tile-on-purpose-${card.conversation}`"
              >
                <MarkdownWords :text="onPurposeLine(card)!" :session-id="card.conversation" />
              </div>
              <span
                v-if="telemetry?.get(card.conversation)"
                class="chip-telemetry"
                :data-cy="`cast-tile-telemetry-${card.conversation}`"
              >
                <template
                  v-for="metric in metricsOf(telemetry.get(card.conversation)!)"
                  :key="metric.key"
                >
                  <!-- The context figure is the press for Compact now, and its confirm opens under the row. -->
                  <span v-if="metric.key === 'context' && canCompact" class="chip-compact">
                    <CardCompactDoor
                      :capability="compactCapability(card)"
                      :conversation="compactionOf(card)"
                      :hint="`${metric.label}: ${metric.value ?? metric.why}`"
                      @compact-now="compactCard(card.conversation)"
                    >
                      <span class="chip-metric context" :class="{ missing: metric.value === null }"
                        ><svg class="icon" aria-hidden="true"><use :href="metric.icon" /></svg
                        ><span class="chip-metric-value">{{
                          metric.short ?? 'not recorded'
                        }}</span></span
                      >
                    </CardCompactDoor>
                  </span>
                  <button
                    v-else-if="
                      (metric.key === 'model' || metric.key === 'effort') && pickerOf(card)
                    "
                    type="button"
                    class="chip-metric chip-pick"
                    :class="[metric.key, { missing: metric.value === null }]"
                    :popovertarget="pickers.get(card.conversation)?.panelId"
                    aria-haspopup="dialog"
                    :aria-expanded="pickers.get(card.conversation)?.isOpen ?? false"
                    :title="`${metric.label}: ${metric.value ?? metric.why}`"
                    :aria-label="`Change ${metric.key === 'model' ? 'model' : 'effort'}, now ${metric.short ?? 'not recorded'}`"
                    :data-cy="`cast-tile-pick-${metric.key}-${card.conversation}`"
                    @click="
                      (event: MouseEvent) =>
                        openPicker(event, card.conversation, metric.key as 'model' | 'effort')
                    "
                  >
                    <svg class="icon" aria-hidden="true"><use :href="metric.icon" /></svg
                    ><span class="chip-metric-value">{{ metric.short ?? 'not recorded' }}</span>
                  </button>
                  <span
                    v-else
                    class="chip-metric"
                    :class="[metric.key, { missing: metric.value === null }]"
                    :title="`${metric.label}: ${metric.value ?? metric.why}`"
                    :aria-label="`${metric.label}: ${metric.value ?? metric.why}`"
                    ><svg class="icon" aria-hidden="true"><use :href="metric.icon" /></svg
                    ><span class="chip-metric-value">{{
                      metric.short ??
                      (metric.key !== 'memory'
                        ? 'not recorded'
                        : metric.why === NOT_RUNNING_NOW
                          ? 'not running'
                          : NOT_MEASURED)
                    }}</span></span
                  >
                </template>
              </span>
              <p
                v-if="compactRefused.get(card.conversation)"
                class="chip-refused"
                role="status"
                :data-cy="`cast-tile-compact-refused-${card.conversation}`"
              >
                {{ compactRefused.get(card.conversation) }}
              </p>
            </div>
            <ModelPicker
              v-if="pickerOf(card)"
              :ref="
                (picker) =>
                  picker
                    ? pickers.set(card.conversation, picker as InstanceType<typeof ModelPicker>)
                    : pickers.delete(card.conversation)
              "
              faceless
              v-bind="pickerOf(card)!"
            />
          </li>
        </ol>
        <p v-if="!agents.length && hiddenIdleCount" class="quiet" data-cy="cast-idle-empty">
          All sub agents are idle.
        </p>
        <CardEmpty
          v-if="view.childrenEmpty && !allAgents.length"
          icon="#i-users"
          :says="view.childrenEmpty"
          hint="Conversations this agent starts appear here."
          data-cy="cast-children-empty"
        />
      </CardSection>
      <!-- Keep the panel focused on its own agent and Sub-agents strip. The main panel's Graph tab shows child plates, state words and their delegated work. -->
      <!-- 🔴 **678 · F-R18a — the walk behind the work given out counted rows it could not read**,
           and nothing drew them (`631` took the per-list hooks with the cards). ⚑ The one sentence
           (`rows-unread.ts`), outside the list's `v-if`, so a list that lost every row still says so.
           ⚠️ **The heading stays for this line alone**: it says *a piece of work may be missing
           here*, and with no flat list left, *here* needs its name (`678`). -->
      <p v-if="view.gaveOutShort" class="tgroup" data-cy="cast-tasks-heading">Assigned by it</p>
      <p v-if="view.gaveOutShort" class="gap" data-cy="cast-given-short">
        <strong>{{ ROWS_UNREAD_LEAD }}</strong>
        {{ view.gaveOutShort }}
      </p>
      <!-- `SessionPanel` supplies the work given to this conversation separately from the child strip. -->

      <!-- Keep children in the strip and task navigation in work rows rather than repeat full child cards here. Retain `cast-children-empty`, `-doubt` and `-short`: they disclose whether an empty or shortened read can be trusted. -->
      <p v-if="view.childList.doubt" class="gap" data-cy="cast-children-doubt">
        <strong>The list of spawned conversations may not be current</strong>
        {{ LIST_DOUBT_WORDS[view.childList.doubt] }}
      </p>
      <p v-if="view.childList.short > 0" class="gap" data-cy="cast-children-short">
        <strong>That list is short</strong>
        {{ view.childList.short }}
        {{ view.childList.short === 1 ? 'row' : 'rows' }} could not be read, so a conversation this
        one spawned may be missing from it.
      </p>
      <!-- Omit the general coverage reassurance but retain incomplete-read warnings: `cast-children-doubt` for unreadable sources, `cast-children-short` for dropped rows and `cast-children-empty` only for a real zero. -->

      <!-- Show one refusal for the whole round trip because `answered` describes one read. If it did not answer, the strip, lists and timestamp are the last successful reading and must be marked as possibly stale through `THE_READ_DID_NOT_ANSWER` (`working-together.ts`). -->
      <p v-if="view.refusal" class="gap" data-cy="cast-refusal">
        <strong>This may not be current</strong>
        {{ view.refusal }}
      </p>

      <!-- 🔴 **One moment, over all three lists** — `543` stamps it last over one synchronous
           aggregate, which is the condition `540` said a single timestamp depended on. ⛔ Absent
           while the newest read answered: the band is read again on every move of its work (W4.74). -->
      <p v-if="view.asOf" class="covers" data-cy="cast-age">
        Last read {{ view.asOf }}. It’s read again when its work moves.
      </p>
    </template>
  </section>
</template>

<style scoped>
/* ⚑ The register this band already used for a group label, kept so the two headings read as
   siblings of everything else rather than as a new kind of thing. */
.tgroup {
  margin: 0;
  color: var(--muted);
  font-size: var(--type-caption);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
}

/*
 * Use no top padding so children sit directly below the parent after the redundant heading is removed.
 */
.cast {
  display: flex;
  flex-direction: column;
  padding: 0 var(--space-6) var(--space-6);
  gap: var(--space-4);
}

.quiet {
  margin: 0;
  color: var(--text);
  font-size: var(--type-caption);
  line-height: 1.5;
}

/* 🔴 **631 · the children, across the top of the band.**
   ⛔ **`--tile` is the arithmetic, once**: the drawer is ~344px, so a tile must be under half of it
   for two to sit together, and under a third for three. ⚠️ A hand-tuned width per breakpoint is the
   thing this avoids. */
.sub-agents {
  margin: 0 0 var(--space-5);
}

/*
 * Fit as many agent chips per row as the box allows.
 */
.agent-chips {
  display: grid;
  margin: 0;
  padding: 0;
  gap: var(--space-4);
  /* ⚑ W4.183 · v3: two cards a row, at every width the panel takes. */
  grid-template-columns: repeat(2, minmax(0, 1fr));
  list-style: none;
}

/* ⚑ Each card takes its row's height, so a card with a word and one without line up. */
.agent-chips > li {
  display: flex;
  min-width: 0;
}

/*
 * Near the panel's 360px minimum, use one chip per line so name, profile and run settings remain readable.
 */
@container agent-card (max-width: 439px) {
  .agent-chips {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* ⚑ **W4.183 · v3's card** — its identity row, then what it runs on under a line; a press opens
   that agent's conversation. */
.chip-card {
  display: flex;
  width: 100%;
  min-width: 0;
  flex-direction: column;
  padding: var(--space-4);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
  background: var(--panel);
  color: var(--text);
  font-size: var(--type-small);
  gap: var(--space-4);
}
.chip-card:not(.flat):has(.agent-chip:hover) {
  border-color: var(--accent-border);
  background: var(--accent-mix-4);
}
.agent-chip {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: stretch;
  border-radius: var(--radius-sm);
  cursor: pointer;
  gap: var(--space-4);
  text-align: left;
}
.agent-chip.flat {
  cursor: default;
}
.team-identity {
  display: grid;
  min-width: 0;
  align-items: center;
  gap: var(--space-3);
  grid-template-columns: auto minmax(0, 1fr) auto;
}

.team-chevron {
  width: 10px;
  height: 10px;
  color: var(--muted);
  transform: rotate(0deg);
}

/* ⚑ The dot before its state — its plate's own priority colour, as the card's header draws it. */
.chip-dot {
  width: 5px;
  height: 5px;
  flex: none;
  border-radius: 50%;
  background: var(--_c);
}

/* The card's task line, what it said, and its figures under a line. */
.chip-task {
  display: flex;
  min-width: 0;
  margin: 0;
  align-items: center;
  color: var(--text-soft);
  font-size: var(--type-caption);
  gap: var(--space-3);
}
.chip-task-text {
  overflow: hidden;
  min-width: 0;
  flex: 1 1 auto;
  text-overflow: ellipsis;
}
.team-identity :deep(.row-mark.label) {
  min-height: 0;
  line-height: 1;
  padding: 0;
  border-color: transparent;
  background: none;
  font-family: var(--font-mono);
  font-weight: var(--fw-normal);
}
.chip-more {
  flex: none;
  padding: 0 var(--space-3);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-pill);
  color: var(--muted);
}
.chip-says {
  display: -webkit-box;
  overflow: hidden;
  margin: 0;
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: 1.4;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.chip-telemetry {
  display: grid;
  margin-top: auto;
  align-items: center;
  justify-items: start;
  grid-template-columns: minmax(0, 1fr) auto;
  padding-top: var(--space-3);
  border-top: var(--border-width) solid var(--line);
  color: var(--text-soft);
  font-size: var(--type-caption);
  gap: var(--space-2) var(--space-5);
}
.chip-compact {
  display: contents;
}
.chip-telemetry :deep(.compact-door) {
  justify-self: stretch;
  grid-column: 1 / -1;
}
.chip-telemetry > *,
.chip-telemetry :deep(.compact-press) {
  max-width: 100%;
}
.chip-pick {
  padding: 0 var(--space-2);
  border: var(--border-width) solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
}
.chip-pick:hover,
.chip-pick[aria-expanded='true'] {
  border-color: var(--accent-border);
  background: var(--accent-mix-8);
}
.chip-refused {
  margin: 0;
  color: var(--muted);
  font-size: var(--type-caption);
}
.chip-metric {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: var(--space-2);
}

.chip-metric .icon {
  width: 12px;
  height: 12px;
  flex: none;
  color: var(--muted);
}

.chip-metric-value {
  overflow: hidden;
  min-width: 0;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chip-metric.model .chip-metric-value {
  font-family: var(--font-mono);
  font-size: var(--type-caption);
}

.chip-metric.effort .chip-metric-value {
  color: var(--accent-text);
  font-weight: var(--fw-semibold);
}

.chip-metric.missing .chip-metric-value {
  color: var(--faint);
}

/* ⚑ v3's totals: "● 0 active" and "● 6 idle", each a small chip. */
.team-totals {
  display: inline-flex;
  flex-wrap: wrap;
  font-weight: var(--fw-normal);
  gap: var(--space-2);
}

.team-total {
  display: inline-flex;
  align-items: center;
  padding: 1px var(--space-3);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--wash-2);
  color: var(--muted);
  font-size: var(--type-caption);
  gap: var(--space-2);
  white-space: nowrap;
}

.team-total strong {
  color: var(--text-soft);
}

.team-total.is-active {
  border-color: var(--accent-border);
  background: var(--accent-mix-8);
}

.team-total.is-active strong {
  color: var(--accent-text);
}

.team-total .chip-dot {
  background: var(--muted);
}

.team-total.is-active .chip-dot {
  background: var(--accent);
}

.gap {
  margin: 0;
  padding: var(--space-4);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
  background: var(--wash-1);
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: 1.5;
}

.gap strong {
  display: block;
  color: var(--text-soft);
}
.cast-idle-choice {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
.cast-idle-choice select {
  width: auto;
}
.cast-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}
.cast-toggle {
  padding: var(--space-1) var(--space-3);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: var(--type-caption);
  cursor: pointer;
}
.cast-toggle[aria-pressed='true'] {
  color: var(--accent-text);
  background: var(--panel);
}
</style>
