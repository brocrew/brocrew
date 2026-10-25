<script setup lang="ts">
import { computed, nextTick, onScopeDispose, reactive, ref, watch } from 'vue'
import { useTeamProfileGraph } from '../composables/useTeamProfileGraph'
import { useTeamProfileCanvas } from '../composables/useTeamProfileCanvas'
import {
  graphDefaults,
  graphView,
  graphWords,
  matchesAgent,
  graphPartners,
  scalarCompare,
} from '../lib/team-profile-graph'
import { useMinuteClock } from '../composables/useMinuteClock'
import type { GraphNode } from '../../../shared/team-profile-graph'

const props = defineProps<{ active: boolean }>()
const emit = defineEmits<{ open: [profile: string] }>()
const controller = useTeamProfileGraph()
const controls = reactive(graphDefaults()),
  query = ref(''),
  page = ref(0)
const root = ref<HTMLElement | null>(null),
  canvas = ref<HTMLCanvasElement | null>(null),
  search = ref<HTMLInputElement | null>(null)
const selection = ref<{ id: string; createdAt: number } | null>(null)
const focused = ref<string | null>(null)
let opener: HTMLElement | null = null
const minute = useMinuteClock()
const reading = computed(() => controller?.reading.value ?? null)
const view = computed(() => (reading.value ? graphView(reading.value, controls) : null))
const selected = computed(
  () =>
    view.value?.nodes.find(
      (n) => n.id === selection.value?.id && n.createdAt === selection.value.createdAt,
    ) ?? null,
)
const words = computed(() => graphWords(query.value))
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
const listed = computed(() =>
  [...(view.value?.nodes ?? [])]
    .filter((n) => matchesAgent(n, words.value))
    .sort(
      (a, b) =>
        collator.compare(a.name, b.name) ||
        scalarCompare(a.profile, b.profile) ||
        scalarCompare(a.id, b.id),
    ),
)
const pages = computed(() => Math.max(1, Math.ceil(listed.value.length / 50)))
const visibleRows = computed(() => listed.value.slice(page.value * 50, (page.value + 1) * 50))
const partners = computed(() =>
  reading.value && view.value && selected.value
    ? graphPartners(reading.value, view.value, selected.value.id, controls.line)
    : [],
)
const savedAt = computed(() =>
  reading.value
    ? new Date(reading.value.header.readAt).toLocaleString(undefined, {
        timeZone: reading.value.header.timezone,
      })
    : '',
)
const age = computed(() =>
  reading.value ? Math.max(0, Math.floor((minute.value - reading.value.header.readAt) / 60000)) : 0,
)
function choose(id: string, from: HTMLElement, recenter = true): void {
  const node = view.value?.nodes.find((n) => n.id === id)
  if (!node) return
  selection.value = { id: node.id, createdAt: node.createdAt }
  opener = from
  if (recenter) drawing.center(id)
}
function close(): void {
  selection.value = null
  const target = opener?.isConnected ? opener : search.value
  void nextTick(() => target?.focus())
}
const drawing = useTeamProfileCanvas({
  canvas,
  view: () => view.value,
  controls,
  active: () => props.active,
  selected: () => selected.value?.id ?? null,
  focused: () => focused.value,
  query: () => query.value,
  select: (id, from) => choose(id, from, false),
  close,
})
const preview = computed(
  () => view.value?.nodes.find((n) => n.id === (drawing.hovered.value ?? focused.value)) ?? null,
)
function pick(node: GraphNode, event: MouseEvent): void {
  choose(node.id, event.currentTarget as HTMLElement)
}
async function turnPage(to: number): Promise<void> {
  page.value = Math.max(0, Math.min(pages.value - 1, to))
  await nextTick()
  root.value?.querySelector<HTMLButtonElement>('[data-graph-agent]')?.focus()
}
function resetForces(): void {
  controls.distance = 90
  controls.repulsion = 160
  controls.proximity = 'messages'
}
function date(value: number | null): string {
  return value === null ? 'Not recorded' : new Date(value).toLocaleString()
}
function value(node: GraphNode): number {
  return controls.size === 'equal' ? 1 : node[controls.size]
}
const settingSources: Record<GraphNode['configured']['source'], string> = {
  'conversation-setting': 'Saved conversation setting',
  'identity-model-choice': 'Saved profile model choice',
  'identity-provider': 'Saved profile provider',
  unknown: 'Unknown',
}
const kindSources: Record<GraphNode['kindQuality'], string> = {
  'stable-record': 'Saved kind record',
  'legacy-normal': 'No service or worker birth recorded',
  'unknown-file': 'Kind record unavailable',
  'unknown-incarnation': 'Profile incarnation could not be confirmed',
  'unknown-conflict': 'Kind records disagree',
  'unknown-lineage': 'History does not establish a kind',
  'unknown-changing': 'Kind record changed while reading',
}
const counts = [
  ['conversations', 'Conversations'],
  ['piecesHeld', 'Pieces held'],
  ['messagesSent', 'Messages sent'],
  ['recentTurns', 'Turns opened in 7 days'],
  ['directDescendants', 'Direct agents created'],
  ['descendants', 'All agents created below'],
  ['recordedWorking', 'Recorded working conversations'],
] as const
const coverage = computed(() =>
  reading.value ? Object.entries(reading.value.header.coverage) : [],
)
function coverageWords(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').toLocaleLowerCase()
}
watch(
  () => props.active,
  (active) => controller?.setActive(active),
  { immediate: true },
)
watch(
  () => [query.value, controls.activity, controls.showBroBot],
  async () => {
    const focused = document.activeElement as HTMLElement | null
    const id = focused?.dataset.graphAgent
    if (id) {
      const index = listed.value.findIndex((n) => n.id === id)
      page.value = index < 0 ? 0 : Math.floor(index / 50)
    } else page.value = 0
    await nextTick()
    if (id) {
      const target = Array.from(
        root.value?.querySelectorAll<HTMLButtonElement>('[data-graph-agent]') ?? [],
      ).find((n) => n.dataset.graphAgent === id)
      ;(target ?? search.value)?.focus()
    }
  },
)
watch(
  () => selected.value,
  (now, before) => {
    if (!now && before && selection.value !== null) {
      selection.value = null
      void nextTick(() => search.value?.focus())
    }
  },
)
watch(
  () => listed.value.length,
  () => {
    page.value = Math.min(page.value, pages.value - 1)
  },
)
watch(minute, () => {
  const header = reading.value?.header
  if (
    header &&
    (Intl.DateTimeFormat().resolvedOptions().timeZone !== header.timezone ||
      new Date().toLocaleDateString(undefined, { timeZone: header.timezone }) !==
        new Date(header.readAt).toLocaleDateString(undefined, { timeZone: header.timezone }))
  )
    controller?.markStale()
})
onScopeDispose(() => controller?.setActive(false))
</script>

<template>
  <section
    ref="root"
    class="profile-graph"
    aria-label="Profile graph"
    data-cy="team-profile-graph"
    @keydown.esc.stop="close"
  >
    <header class="reading-header">
      <div>
        <h3>Profile graph</h3>
        <p v-if="reading">
          Saved reading · {{ savedAt }} · {{ reading.header.timezone }} · {{ age }} min old<span
            v-if="controller?.stale.value"
          >
            · Stale — refresh for a newer reading</span
          >
        </p>
        <p v-else>Activity from saved history across this workspace.</p>
      </div>
      <button
        type="button"
        :aria-disabled="controller?.busy.value || (controller?.retryAt.value ?? 0) > Date.now()"
        @click="!controller?.busy.value && controller?.refresh()"
      >
        {{ controller?.busy.value ? 'Reading…' : 'Refresh' }}
      </button>
    </header>
    <p v-if="controller?.busy.value" role="status">
      Reading saved history. The displayed reading stays in place until every page is ready.
    </p>
    <p v-if="controller?.error.value" role="alert">
      This reading could not finish: {{ controller.error.value.cause }} ({{
        controller.error.value.phase
      }}, {{ controller.error.value.visited }} rows visited; remaining
      {{ controller.error.value.remaining }}).<span v-if="reading">
        The earlier reading is still shown.</span
      ><span v-if="controller.retryAt.value"> Refresh is available after the cooldown.</span>
    </p>
    <p v-if="!controller">Profile readings are unavailable in this window.</p>
    <div class="graph-controls">
      <label
        >Size
        <select v-model="controls.size">
          <option value="conversations">Conversations</option>
          <option value="piecesHeld">Pieces held</option>
          <option value="messagesSent">Messages sent</option>
          <option value="recentTurns">Turns in 7 days</option>
          <option value="descendants">All agents created below</option>
          <option value="equal">Equal</option>
        </select></label
      >
      <label
        >Lines
        <select v-model="controls.line">
          <option value="work">Work given</option>
          <option value="messages">Messages</option>
          <option value="questions">Questions to a named agent</option>
          <option value="all">All interactions</option>
        </select></label
      >
      <label
        >Scale
        <select v-model="controls.scaling">
          <option value="sqrt">Square root</option>
          <option value="log">Logarithmic</option>
        </select></label
      >
      <label
        >Activity
        <select v-model="controls.activity">
          <option value="all">All saved history</option>
          <option value="today">Active today</option>
          <option value="week">Active in 7 days</option>
          <option value="working">Recorded working</option>
        </select></label
      >
      <label><input v-model="controls.directions" type="checkbox" /> Directions</label>
      <label><input v-model="controls.showBroBot" type="checkbox" /> Show BroBot</label>
      <label><input v-model="controls.badges" type="checkbox" /> Descendant badges</label>
    </div>
    <div class="graph-controls force-controls">
      <label
        >Proximity
        <select v-model="controls.proximity">
          <option value="messages">Messages</option>
          <option value="selected">Selected lines</option>
        </select></label
      >
      <label
        >Distance {{ controls.distance }}
        <input v-model.number="controls.distance" type="range" min="30" max="220"
      /></label>
      <label
        >Repulsion {{ controls.repulsion }}
        <input v-model.number="controls.repulsion" type="range" min="20" max="500"
      /></label>
      <button type="button" @click="resetForces">Reset forces</button>
      <button v-if="!drawing.paused.value" type="button" @click="drawing.stop">Pause</button>
      <button
        v-else
        type="button"
        :disabled="!view || view.tooLarge || drawing.forcedColors.value || drawing.failed.value"
        @click="drawing.resume"
      >
        Resume
      </button>
      <button type="button" @click="drawing.zoom(1.2)">Zoom in</button>
      <button type="button" @click="drawing.zoom(1 / 1.2)">Zoom out</button>
      <button type="button" @click="drawing.fit">Fit</button>
    </div>
    <p class="graph-caveat">
      Counts describe retained saved history. Recorded working is a saved conversation status.
      Questions count routes to a named agent, not questions to a person or a parent. Sizes and
      descendant counts keep their full-reading totals when filters change.
    </p>
    <p>
      Message proximity includes message connections that have no visible line for the selected
      criterion. Zero-message selected connections keep a weak spring. Positions express competing
      forces, not exact ranks or distances.
    </p>
    <div v-if="reading" class="graph-content">
      <div class="agents-list">
        <label
          >Find an agent
          <input
            ref="search"
            v-model="query"
            type="search"
            placeholder="Name or profile"
            aria-controls="profile-graph-agents"
        /></label>
        <h4 aria-live="polite" aria-atomic="true">
          Agents · {{ listed.length }} of {{ view?.nodes.length ?? 0 }} shown
        </h4>
        <p v-if="reading.nodes.length === 0">No saved agents.</p>
        <p v-else-if="view?.nodes.length === 0">No agents match this activity filter.</p>
        <p v-else-if="listed.length === 0" role="status">No agents match your search.</p>
        <ul id="profile-graph-agents" class="agent-rows">
          <li v-for="node in visibleRows" :key="`${node.id}:${node.createdAt}`">
            <button
              type="button"
              :data-graph-agent="node.id"
              :aria-pressed="node.id === selected?.id"
              @focus="focused = node.id"
              @blur="focused = null"
              @click="pick(node, $event)"
            >
              <strong>{{ node.name }}</strong
              ><span>{{ node.profile }} · {{ node.kind }} · {{ value(node) }}</span>
              <span v-for="[key, label] in counts" :key="key">{{ label }}: {{ node[key] }}</span>
            </button>
          </li>
        </ul>
        <nav aria-label="Agent list pages" class="list-pages">
          <button type="button" :disabled="page === 0" @click="turnPage(page - 1)">Previous</button
          ><span>Page {{ page + 1 }} of {{ pages }}</span
          ><button type="button" :disabled="page + 1 >= pages" @click="turnPage(page + 1)">
            Next
          </button>
        </nav>
      </div>
      <div class="graph-stage">
        <p v-if="view?.tooLarge" role="status">
          Too many connections for the graph. The graph allows 1,000 agents and 5,000 connection
          pairs. Narrow the activity filter or hide BroBot. All agents, counts and cards remain in
          the list.
        </p>
        <p v-else-if="drawing.forcedColors.value" role="status">
          Use the Agents list in forced colors mode.
        </p>
        <p v-else-if="drawing.failed.value" role="alert">
          Graph layout unavailable. The Agents list and cards are available.
        </p>
        <canvas
          ref="canvas"
          v-show="!view?.tooLarge && !drawing.forcedColors.value && !drawing.failed.value"
          tabindex="0"
          role="img"
          aria-label="Agent connections. Use the Agents list to select every agent. Drag a node to move it, drag the background to pan; plus and minus zoom, F fits, Escape closes the card."
          @pointerdown="drawing.down"
          @pointermove="drawing.move"
          @pointerleave="drawing.leave"
          @pointerup="drawing.up"
          @pointercancel="drawing.cancel"
          @lostpointercapture="drawing.cancel"
          @wheel="drawing.wheel"
          @keydown="drawing.key"
        />
        <div class="agent-preview" :tabindex="preview ? 0 : -1" aria-label="Agent preview">
          <p v-if="preview">
            {{ preview.name }} · {{ preview.profile }} · {{ preview.kind }} ·
            {{ preview.configured.provider ?? 'Unknown provider' }} /
            {{ preview.configured.model ?? 'Unknown model'
            }}<span v-for="[key, label] in counts" :key="key">
              · {{ label }}: {{ preview[key] }}</span
            >
          </p>
        </div>
        <p v-if="drawing.hiddenLabels.value">
          {{ drawing.hiddenLabels.value }} names or badges are hidden to keep the drawing readable.
          The Agents list contains every count.
        </p>
        <p>
          Normal: circle · Service: diamond · Unknown: hollow · BroBot: ring. Drag background to
          pan. + / − to zoom, F to fit, Escape to close the card.
          {{ drawing.paused.value ? 'Layout paused.' : 'Layout running.' }}
        </p>
      </div>
      <aside
        class="agent-inspector"
        aria-label="Selected agent"
        :aria-live="selected ? 'polite' : 'off'"
      >
        <template v-if="selected">
          <button type="button" @click="close">Close card</button>
          <h4>{{ selected.name }}</h4>
          <p>
            {{ selected.profile }}<span v-if="selected.clipped"> · Display text shortened</span>
          </p>
          <dl>
            <dt>Kind</dt>
            <dd>{{ selected.kind }} · {{ kindSources[selected.kindQuality] }}</dd>
            <dt>Kind read</dt>
            <dd>{{ date(selected.kindReadAt) }}</dd>
            <dt>Configured provider</dt>
            <dd>{{ selected.configured.provider ?? 'Unknown' }}</dd>
            <dt>Configured model</dt>
            <dd>{{ selected.configured.model ?? 'Unknown' }}</dd>
            <dt>Setting source</dt>
            <dd>{{ settingSources[selected.configured.source] }}</dd>
            <template v-for="[key, label] in counts" :key="key"
              ><dt>{{ label }}</dt>
              <dd>{{ selected[key] }}</dd></template
            >
            <dt>Last turn activity</dt>
            <dd>{{ date(selected.lastTurnAt) }}</dd>
            <dt>Last saved update</dt>
            <dd>{{ date(selected.lastSavedUpdate) }}</dd>
            <dt>Reading age</dt>
            <dd>{{ age }} minutes<span v-if="controller?.stale.value"> · Stale</span></dd>
          </dl>
          <p>
            Saved conversations may include earlier incarnations of this profile. Kind and settings
            are conservative; unknown values stay unknown.
          </p>
          <button type="button" @click="emit('open', selected.profile)">Open profile</button>
          <h4>Top partners · selected lines</h4>
          <ul>
            <li v-for="partner in partners" :key="partner.node.id">
              <button
                type="button"
                @click="choose(partner.node.id, $event.currentTarget as HTMLElement)"
              >
                {{ partner.node.name }} · {{ partner.count }}
              </button>
            </li>
          </ul>
          <p v-if="partners.length === 0">No visible partners for these lines.</p>
        </template>
        <p v-else>
          Select an agent in the graph or the Agents list to see its saved counts and settings.
        </p>
        <details>
          <summary>Reading coverage and limits</summary>
          <p>
            Self interactions count toward saved totals but do not draw loops. Unresolved recipients
            and omitted creator links are disclosed below. Agent creation can contain cycles. Counts
            cover retained records, with active conversation generations for events and turns.
          </p>
          <dl>
            <template v-for="[key, count] in coverage" :key="key"
              ><dt>{{ coverageWords(key) }}</dt>
              <dd>{{ count }}</dd></template
            >
          </dl>
        </details>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.profile-graph {
  container-type: inline-size;
  width: 100%;
  color: var(--text);
  min-width: 0;
  font-size: var(--type-body);
}
.reading-header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: var(--space-8);
}
h3,
h4,
p {
  margin: 0 0 var(--space-5);
}
p {
  color: var(--text-soft);
  line-height: var(--leading-relaxed);
  overflow-wrap: anywhere;
}
button,
input,
select {
  font: inherit;
  color: var(--text);
  background: var(--panel);
  border: var(--border-width) solid var(--control-border);
  border-radius: var(--radius-xs);
  padding: var(--space-3) var(--space-5);
  max-width: 100%;
  min-height: max(44px, var(--control-h));
}
button {
  cursor: pointer;
}
input[type='checkbox'],
input[type='range'] {
  min-height: 0;
}
label {
  min-height: max(44px, var(--control-h));
}
h3 {
  font-size: var(--type-heading);
}
h4 {
  font-size: var(--type-body);
}
button:focus-visible,
input:focus-visible,
select:focus-visible,
canvas:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}
button[aria-pressed='true'] {
  border-color: var(--accent);
  background: var(--panel-2);
}
button:disabled,
button[aria-disabled='true'] {
  opacity: var(--disabled-opacity);
  cursor: default;
}
.graph-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-5) var(--space-8);
  margin: var(--space-6) 0;
}
label {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}
input[type='range'] {
  width: 7rem;
  padding: 0;
  accent-color: var(--accent);
}
input[type='checkbox'] {
  accent-color: var(--accent);
}
.graph-content {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(14rem, 19rem);
  grid-template-areas: 'stage inspector' 'list inspector';
  gap: var(--space-8);
}
.agents-list {
  grid-area: list;
  min-width: 0;
}
.agents-list > label {
  margin-bottom: var(--space-6);
}
.agent-rows {
  list-style: none;
  padding: 0;
  margin: 0;
  max-height: 28rem;
  overflow: auto;
}
.agent-rows button {
  width: 100%;
  text-align: left;
  margin-bottom: var(--space-3);
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-6);
}
.agent-rows strong {
  width: 100%;
}
.agent-rows span {
  font-size: max(13px, var(--type-small));
  overflow-wrap: anywhere;
}
.graph-stage {
  grid-area: stage;
  min-width: 0;
}
canvas {
  display: block;
  width: 100%;
  height: clamp(320px, 48vh, 520px);
  min-height: 320px;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-md);
  touch-action: none;
  font-family: inherit;
  font-size: max(13px, var(--type-small));
}
.agent-preview {
  height: calc(8em * var(--leading-relaxed));
  overflow: auto;
  margin: var(--space-5) 0;
}
.agent-preview:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}
.agent-inspector {
  grid-area: inspector;
  padding: var(--space-8);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-md);
  min-width: 0;
  align-self: start;
  overflow-wrap: anywhere;
}
dl {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-3) var(--space-5);
}
dt {
  color: var(--muted);
}
dd {
  margin: 0;
}
.list-pages {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  flex-wrap: wrap;
  margin-top: var(--space-4);
}
summary {
  cursor: pointer;
  margin: var(--space-6) 0;
}
@container (max-width: 900px) {
  .graph-content {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: 'list' 'stage' 'inspector';
  }
}
@container (max-width: 480px) {
  .reading-header {
    flex-wrap: wrap;
  }
  .graph-controls > label {
    width: 100%;
  }
  select {
    flex: 1;
    min-width: 0;
  }
}
@media (forced-colors: active) {
  button,
  input,
  select,
  .agent-inspector {
    border: 1px solid CanvasText;
  }
}
</style>
