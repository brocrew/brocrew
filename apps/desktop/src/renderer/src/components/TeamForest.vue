<script lang="ts">
/** ⚑ How many forest drawings this window has made — each gets its own Vue Flow store. */
let forestDrawings = 0
</script>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import {
  Handle,
  Position,
  VueFlow,
  useVueFlow,
  type Edge,
  type Node,
  type NodeChange,
} from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'
import ForestCard from './ForestCard.vue'
import ForestGroupCard from './ForestGroupCard.vue'
import type { ForestRow, ForestView } from '../lib/the-forest'
import type { RootFiles } from '../lib/files-kept'
import { forestGraph, forestNodes, waitsOnIt, type GraphNode } from '../lib/forest-graph'
import { rightwardForest } from '../lib/forest-layout'
import { ROWS_UNREAD_LEAD } from '../lib/rows-unread'

/** Draw the given tree with Vue Flow, keeping each conversation's work on its card. */

const props = defineProps<{
  /** ⛔ **`null` until this window has asked** — the tab says so rather than drawing an empty tree. */
  view: ForestView | null
  /** ⚑ The conversation a person is in, outlined — absent on the Team page. */
  current?: string | null
  /** Team uses generation rows; a conversation uses columns from left to right. */
  direction?: 'down' | 'right'
  /** ⚑ Take the parent's whole height — the main panel's Graph tab. */
  fill?: boolean
  /** ⚑ **UI-002 · each piece's file count** — the Graph tab's; absent on the Team page. */
  fileCounts?: ReadonlyMap<string, number>
  /** ⚑ **UI-002 · the files on the current conversation's own root** — drawn on its card only. */
  rootFiles?: RootFiles | null
}>()

const emit = defineEmits<{
  /**
   * 🔴 **668 · a node, pressed — the ROW, so the page can open its conversation.** ⚑ The act is
   * the screen's (`506`).
   */
  press: [row: ForestRow]
  /** ⚑ **UI-002 · a piece's file count, pressed** — passed straight up. */
  files: [piece: string]
}>()

/**
 * ⚑ **One slot, in pixels** — a node's card plus the gutter beside it — and the gap between two
 * generations, where their lines run.
 */
const SLOT = 208
const GUTTER = 16
const CARD = SLOT - GUTTER
const BAND = 48
/** ⚑ A card's height before it is measured — only its first frame is placed with it. */
const UNMEASURED = 96
/** ⚑ The smallest zoom the first view takes — below it a card cannot be read, so it centres instead. */
const LEAST_ZOOM = 0.6

const rightward = computed(() => props.direction === 'right')
const graph = computed(() => {
  if (props.view === null) return null
  if (!rightward.value) return forestGraph(props.view, true)
  const cards = forestNodes(props.view, true)
  return { generations: cards.length ? [cards] : [] }
})

/** ⚑ **One Vue Flow store per drawing** — the Team page and a conversation's tab never share one. */
forestDrawings += 1
const flowId = `forest-${String(forestDrawings)}`
const flow = useVueFlow(flowId)

/** ⚑ **Each card's measured height**, filled as Vue Flow measures them. */
const heights = ref<ReadonlyMap<string, number>>(new Map())
function measured(changes: NodeChange[]): void {
  let next: Map<string, number> | null = null
  for (const change of changes) {
    if (change.type !== 'dimensions' || !change.dimensions) continue
    if (heights.value.get(change.id) === change.dimensions.height) continue
    next ??= new Map(heights.value)
    next.set(change.id, change.dimensions.height)
  }
  if (next) heights.value = next
}

/** Place measured cards with Dagre for columns, or the existing Team layout for rows. */
const nodes = computed((): Node<GraphNode>[] => {
  const drawn = graph.value
  if (drawn === null) return []
  const placed: Node<GraphNode>[] = []
  const coordinates = rightward.value
    ? rightwardForest(drawn.generations.flat(), heights.value, CARD, BAND, GUTTER, UNMEASURED)
    : null
  let top = 0
  for (const generation of drawn.generations) {
    let tallest = 0
    for (const node of generation) {
      const id = node.row.conversation
      tallest = Math.max(tallest, heights.value.get(id) ?? UNMEASURED)
      placed.push({
        id,
        type: 'agent',
        position: coordinates ? coordinates.get(id)! : { x: node.centre * SLOT - CARD / 2, y: top },
        sourcePosition: rightward.value ? Position.Right : Position.Bottom,
        targetPosition: rightward.value ? Position.Left : Position.Top,
        data: node,
        draggable: false,
        selectable: false,
        connectable: false,
      })
    }
    top += tallest + BAND
  }
  return placed
})

/**
 * ⚑ **A line from each parent to each child** — 🔴 UI-004 · dashed and moving while the parent waits
 * on the child: while the child holds an open piece its parent gave it ({@link waitsOnIt}). ⛔ It was
 * dashed while the child was mid-turn, which said nothing about the work between them.
 */
const edges = computed((): Edge[] =>
  (graph.value?.generations ?? []).flatMap((generation) =>
    generation.flatMap((node): Edge[] =>
      node.parent === null
        ? []
        : [
            {
              id: `forest-edge-${node.row.conversation}`,
              source: node.parent,
              target: node.row.conversation,
              type: 'smoothstep',
              animated: waitsOnIt(node),
            },
          ],
    ),
  ),
)

/**
 * ⚑ **The first view**: the whole forest when it can be read at a glance, else the conversation a
 * person is in, centred. ⚠️ Taken once the cards are measured, and again when the forest first
 * arrives — never on a re-read, so a person's own pan and zoom are theirs.
 */
/** ⚑ D-034 · the conversation on screen, at its place: a replaced one is drawn as its stand-in. */
const currentHere = computed(() =>
  props.current ? (props.view?.placeOf?.get(props.current) ?? props.current) : props.current,
)

let viewed = false
async function firstView(): Promise<void> {
  if (viewed || nodes.value.length === 0) return
  viewed = true
  await nextTick()
  await flow.fitView({ padding: 0.12, maxZoom: 1, minZoom: LEAST_ZOOM })
  const here = currentHere.value
    ? nodes.value.find((node) => isCurrent(node.data!))
    : undefined
  if (here && flow.viewport.value.zoom <= LEAST_ZOOM + 0.001) {
    const height = heights.value.get(here.id) ?? UNMEASURED
    await flow.setCenter(here.position.x + CARD / 2, here.position.y + height / 2, { zoom: 0.85 })
  }
}

/** ⚑ The node a card is, from Vue Flow's own slot — typed once, here. */
const asNode = (data: unknown): GraphNode => data as GraphNode
const isCurrent = (node: GraphNode): boolean =>
  node.row.conversation === currentHere.value || node.members?.some((member) => member.row.conversation === currentHere.value) === true
function pressNode(data: unknown): void {
  const node = asNode(data)
  if (node.members) toggle(node.row.conversation)
  else emit('press', node.row)
}
const count = computed(() => {
  const view = props.view
  if (!view?.coverage.walked) return null
  if (!props.current && view.coverage.cut > 0) return `Newest ${view.coverage.drawn} of ${view.coverage.there}`
  const total = view.rows.filter((row) => row.kind === 'a-conversation' && !row.conversationRow?.context).length
  return `${total} ${total === 1 ? 'conversation' : 'conversations'}`
})

/** ⚠️ **Which nodes a person has opened out** — component-local, and forgotten with the tab. */
const opened = ref<ReadonlySet<string>>(new Set())
function toggle(conversation: string): void {
  const next = new Set(opened.value)
  if (next.has(conversation)) next.delete(conversation)
  else next.add(conversation)
  opened.value = next
}
</script>

<template>
  <section
    class="forest"
    :class="{ fill: props.fill }"
    data-cy="team-forest"
    aria-label="Who called whom"
  >
    <!-- ⛔ **Nothing has been read yet** — one line, and never an empty tree (`641` §5.5). -->
    <p v-if="props.view === null" class="quiet" data-cy="forest-not-read">
      Nothing has been read about this workspace yet.
    </p>

    <template v-else>
      <div class="graph-toolbar" data-cy="forest-toolbar">
        <slot name="filters" />
        <span v-if="count !== null" class="compact-count" data-cy="forest-drawn">{{ count }}</span>
        <div class="zoom" role="group" aria-label="Zoom the forest">
          <button type="button" title="Zoom out" data-cy="forest-zoom-out" @click="flow.zoomOut()">
            −
          </button>
          <button type="button" title="Zoom in" data-cy="forest-zoom-in" @click="flow.zoomIn()">
            +
          </button>
          <button
            type="button"
            title="Show the whole forest"
            data-cy="forest-fit"
            @click="flow.fitView({ padding: 0.12, maxZoom: 1 })"
          >
            Fit
          </button>
        </div>
      </div>

      <!-- 🔴 **The forest, on Vue Flow** (2026-09-30) — pan, zoom and fit inside this box, never the
           page; the placement is `forest-graph.ts`'s, the lines are Vue Flow's. -->
      <div
        v-if="graph && graph.generations.length"
        class="flow"
        :class="{ fill: props.fill }"
        data-cy="forest-rows"
      >
        <!-- Handle a single press through Vue Flow's node click listener. Without a listener, a non-draggable, non-selectable node gets `pointer-events: none`, causing card clicks to pan the canvas instead. -->
        <VueFlow
          :id="flowId"
          :nodes="nodes"
          :edges="edges"
          :nodes-draggable="false"
          :nodes-connectable="false"
          :elements-selectable="false"
          :zoom-on-scroll="false"
          :pan-on-scroll="true"
          :zoom-on-double-click="false"
          :min-zoom="0.2"
          :max-zoom="1.5"
          @nodes-change="measured"
          @nodes-initialized="firstView"
          @node-click="({ node }) => pressNode(node.data)"
        >
          <template #node-agent="{ data }">
            <!-- ⚑ One name for the node Vue Flow hands the slot, so the card reads as it did. -->
            <template v-for="node in [asNode(data)]" :key="node.row.key">
              <div class="node" :class="{ 'context-parent': node.row.conversationRow?.context }" :data-context="node.row.conversationRow?.context ? 'parent' : undefined" :style="{ width: `${CARD}px` }">
                <Handle
                  type="target"
                  :position="rightward ? Position.Left : Position.Top"
                  :connectable="false"
                />
                <ForestGroupCard
                  v-if="node.members"
                  :node="node"
                  :here="isCurrent(node)"
                  :opened="opened.has(node.row.conversation)"
                  @toggle="toggle(node.row.conversation)"
                  @press="(row) => emit('press', row)"
                />
                <ForestCard
                  v-else
                  :node="node"
                  :here="isCurrent(node)"
                  :opened="opened.has(node.row.conversation)"
                  :file-counts="props.fileCounts"
                  :root-files="
                    props.rootFiles?.conversation === node.row.conversation ? props.rootFiles : null
                  "
                  @files="(piece) => emit('files', piece)"
                  @toggle="toggle(node.row.conversation)"
                />
                <Handle
                  type="source"
                  :position="rightward ? Position.Right : Position.Bottom"
                  :connectable="false"
                />
              </div>
            </template>
          </template>
        </VueFlow>
        <!-- ⚑ **Zoom and fit, beside the drawing** — a trackpad pinch zooms too. -->

      </div>

      <!-- ⚑ **A read that ANSWERED and found nothing** — and it is not the same as not having read. -->
      <p v-else class="quiet" data-cy="forest-empty">
        {{
          props.current
            ? 'This conversation is not in the current graph reading.'
            : 'This app has not started a conversation yet.'
        }}
      </p>

      <p v-if="!props.view.coverage.walked" class="quiet" data-cy="forest-not-walked">
        {{ props.view.coverage.covers ?? 'This reading could not look at the conversations.' }}
      </p>
      <p v-if="props.view.coverage.short" class="quiet" data-cy="forest-rows-unread">
        {{ ROWS_UNREAD_LEAD }} {{ props.view.coverage.short }}
      </p>
      <p v-if="props.view.coverage.waitsShort" class="quiet" data-cy="forest-waits-unread">
        {{ ROWS_UNREAD_LEAD }} {{ props.view.coverage.waitsShort }}
      </p>
    </template>
  </section>
</template>

<style scoped>
/* ⚑ **Declarations copied from `WorkingTogether.vue` and `SessionPanel.vue`, never their class
   names** — scoped styles are per-component and a shared name shares nothing
   (`a-scoped-class-matches-nothing-in-another-component`). */
.forest {
  display: flex;
  width: 100%;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-4);
}

.forest.fill {
  min-height: 0;
  flex: 1;
}

.quiet {
  margin: 0;
  color: var(--muted);
  font-size: var(--type-caption);
}

.graph-toolbar {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--space-4);
}

.compact-count {
  margin-left: auto;
  color: var(--faint);
  font-size: var(--type-caption);
  white-space: nowrap;
}

.context-parent { opacity: 0.55; }
.context-parent:hover, .context-parent:focus-within { opacity: 1; }

/* 🔴 **The drawing's own box** (2026-09-30) — Vue Flow pans and zooms inside it; ⛔ never the page.
   ⚠️ Vue Flow needs a box with a height: a page gets a tall one, the Graph tab the whole column. */
.flow {
  position: relative;
  height: clamp(360px, 62vh, 880px);
  min-width: 0;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--wash-1);
}

.flow.fill {
  height: auto;
  min-height: 0;
  flex: 1;
  border: 0;
  border-radius: 0;
}

/* ⚑ The lines, in the app's strong hairline; dashed and moving while the parent waits on the child. */
.flow :deep(.vue-flow__edge-path) {
  stroke: var(--line-strong);
  stroke-width: 1.5;
}

/* ⚑ The handles are where a line meets a card — nothing a person connects, so nothing drawn. */
.flow :deep(.vue-flow__handle) {
  width: 1px;
  min-width: 0;
  height: 1px;
  min-height: 0;
  border: 0;
  background: transparent;
  pointer-events: none;
}

.node {
  display: flex;
}

/* ⚑ **The conversation a person is in**, outlined in the accent. */

.zoom {
  flex-shrink: 0;
  margin-left: auto;
  display: flex;
  overflow: hidden;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--panel);
}

.zoom button {
  min-width: 26px;
  height: 24px;
  padding: 0 var(--space-3);
  border: 0;
  background: none;
  color: var(--text-soft);
  cursor: pointer;
  font: inherit;
  font-size: var(--type-small);
}

.zoom button + button {
  border-left: var(--border-width) solid var(--line);
}

.zoom button:hover {
  background: var(--wash-3);
}

</style>
