<script setup lang="ts">
/**
 * The conversation stays mounted across tabs so its scroll and draft survive.
 * The Graph tab shows its top-level tree with the current conversation outlined.
 * The Files tab reads the workspace library independently of the selected conversation.
 */
import { computed } from 'vue'
import { filesPerPiece, rootFilesOf, type FilesRead } from '../lib/files-kept'
import type { ForestView } from '../lib/the-forest'
import { conversationForest } from '../lib/conversation-forest'
import TeamForest from './TeamForest.vue'
import FilesLibrary from './FilesLibrary.vue'
import { useFilesLibrary } from '../composables/useFilesLibrary'
import { useMainTab, type MainTab } from '../composables/useMainTab'

const props = defineProps<{
  conversation: string
  /** The forest is read only by the graph or a file's link to its holder. */
  forest: ForestView | null | (() => ForestView | null)
  /** Legacy per-piece counts for the Graph; absent or null means unread. */
  files?: FilesRead | null
  /** ⚑ `true` where a reader can open a file, so the Files tab's lines are presses. */
  canOpenDocument?: boolean
}>()

const emit = defineEmits<{
  /** ⚑ **UI-006 · a node, pressed** — select that agent. The pane owns the selection's door. */
  select: [conversation: string]
  /** ⚑ **UI-002 · show this file** — the pane's viewer opens it. */
  openDocument: [resourceId: string]
  /** Open the conversation that kept a file on another piece, at that piece's brief. */
  openConversation: [sessionId: string, briefOf: string]
}>()

const tab = useMainTab()
const library = useFilesLibrary()
const forest = computed(() => (typeof props.forest === 'function' ? props.forest() : props.forest))
const graphView = computed(() => conversationForest(forest.value, props.conversation))
/** A different tree gets a fresh viewport; a stand-in keeps its predecessor's tree key. */
const graphTree = computed<string | undefined>((previous) => {
  const root = graphView.value?.rows.find((row) => row.kind === 'a-conversation')?.conversation
  return root && previous && (forest.value?.placeOf?.get(previous) ?? previous) === root
    ? previous
    : root
})

/**
 * ⚑ **Back to the conversation** — for a press elsewhere that shows a row in it. `true` when the
 * tab had to change, so the caller knows the row is not drawn until the next frame.
 */
function showConversation(): boolean {
  if (tab.value === 'conversation') return false
  tab.value = 'conversation'
  return true
}
defineExpose({ showConversation })

const TABS: readonly { id: MainTab; label: string; icon: string }[] = [
  { id: 'conversation', label: 'Conversation', icon: '#i-chat' },
  { id: 'graph', label: 'Graph', icon: '#i-graph' },
  { id: 'files', label: 'Files', icon: '#i-file' },
]

/** ⚑ **UI-002 · each piece's file count, for the Graph tab** — none before the tree has been read. */
const fileCounts = computed(() => (props.files ? filesPerPiece(props.files.files) : undefined))
/** ⚑ …and the files on this conversation's own root, which is never a task line. */
const rootFiles = computed(() =>
  props.files ? rootFilesOf(props.conversation, props.files.files) : null,
)

/** A Graph count enters the library at that exact task. */
function choose(one: MainTab): void {
  tab.value = one
}
function showFiles(piece: string): void {
  const file = props.files?.files.find((one) => one.piece === piece)
  library?.graphTask(piece, file?.label, file?.pieceTitle ?? null)
  tab.value = 'files'
}
const fileCount = computed(() => library?.count.value ?? null)
</script>

<template>
  <div class="conversation-main">
    <div
      class="main-tabs"
      role="tablist"
      aria-label="What the main panel shows"
      data-cy="main-tabs"
    >
      <button
        v-for="one in TABS"
        :key="one.id"
        class="main-tab"
        :class="{ on: tab === one.id }"
        type="button"
        role="tab"
        :aria-selected="tab === one.id"
        :data-cy="`main-tab-${one.id}`"
        @click="choose(one.id)"
      >
        <svg class="icon" aria-hidden="true"><use :href="one.icon" /></svg>
        {{ one.label }}
        <span
          v-if="one.id === 'files' && fileCount !== null"
          class="count"
          data-cy="main-tab-files-count"
          >({{ fileCount }})</span
        >
      </button>
    </div>
    <div v-show="tab === 'conversation'" class="main-conversation" data-cy="main-conversation">
      <slot />
    </div>
    <div v-if="tab === 'graph'" class="main-graph" data-cy="conversation-graph">
      <TeamForest
        :key="graphTree"
        :view="graphView"
        direction="right"
        :current="props.conversation"
        :file-counts="fileCounts"
        :root-files="rootFiles"
        fill
        @press="(row) => emit('select', row.conversation)"
        @files="showFiles"
      />
    </div>
    <div v-show="tab === 'files'" class="main-files" data-cy="conversation-files">
      <FilesLibrary :can-open="props.canOpenDocument ?? false" :active="tab === 'files'" />
    </div>
  </div>
</template>

<style scoped>
.conversation-main {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
}

.main-tabs {
  display: flex;
  flex: 0 0 auto;
  padding: 0 var(--space-12);
  border-bottom: var(--border-width) solid var(--line);
  gap: var(--space-6);
  background: var(--panel);
}

.main-tab {
  display: inline-flex;
  align-items: center;
  padding: var(--space-6) var(--space-2);
  border: 0;
  border-bottom: var(--border-accent-width) solid transparent;
  margin-bottom: -1px;
  background: none;
  color: var(--muted);
  cursor: pointer;
  font: inherit;
  font-size: var(--type-small);
  font-weight: var(--fw-semibold);
  gap: var(--space-3);
}

.main-tab .icon {
  width: var(--icon);
  height: var(--icon);
}

.main-tab:hover {
  color: var(--text-soft);
}

.main-tab.on {
  border-bottom-color: var(--accent);
  color: var(--accent-text);
}

.main-tab .count {
  color: var(--muted);
  font-weight: var(--fw-normal);
}

.main-graph,
.main-files {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  padding: var(--space-6) var(--space-11) var(--space-6);
}

.main-conversation {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}
</style>
