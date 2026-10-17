<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { clockTime } from '../../../shared/clock'
import { MAIN_RESULT_WORDS, WORK_FILE_GROUP_WORDS } from '../../../shared/work-file-groups'
import { fullTime } from '../lib/clock'
import {
  addedBySays,
  ALSO_KEPT_ON,
  FILE_FILTERS,
  FILES_DID_NOT_ANSWER,
  fileTitleSays,
  filtered,
  NONE_UNDER,
  ROLE_WORD,
  treeFileGroups,
  type FileFilter,
  type FilesRead,
} from '../lib/files-kept'
import CardEmpty from './CardEmpty.vue'

/**
 * # ⚑ UI-002 · the Files tab — every file on this conversation's work, and on all of it under
 *
 * List files on the pieces this conversation holds or gave and everything under them,
 * grouped by piece in tree order. Show each file once with the other pieces that kept the same
 * bytes, and provide All, Made and Inputs filters.
 *
 * ⛔ **Nothing here opens a file**: a press hands its id up, and the pane's one viewer reads it —
 * which never runs what it shows.
 */
const props = defineProps<{
  /** ⚑ The tree's files, for THIS conversation — `null` is *not read yet*. */
  read: FilesRead | null
  /** ⚑ `true` where a reader can open a file, so each line is a press. */
  canOpen: boolean
  /**
   * ⚑ **UI-002 · the piece to open the tab at** — a count pressed on the Graph tab. Its group is
   * brought into view and marked; ⚑ a new `press` each time, so the same piece again comes back.
   */
  at?: { readonly piece: string; readonly press: number } | null
  /** The conversation holding a piece, where the forest names it. */
  holderOf?: (piece: string) => string | null
}>()

const emit = defineEmits<{
  /** ⚑ Show this file — the pane's viewer opens it, by its id. */
  openDocument: [resourceId: string]
  /** Open the conversation that kept a file on another piece, at that piece's brief. */
  openConversation: [sessionId: string, briefOf: string]
}>()

const filter = ref<FileFilter>('all')
const groups = computed(() => treeFileGroups(props.read?.files ?? [], props.holderOf))
const shown = computed(() =>
  treeFileGroups(filtered(props.read?.files ?? [], filter.value), props.holderOf),
)
/** ⚑ What a filter that leaves nothing says — `null` while it leaves something, or shows all. */
const noneSays = computed(() =>
  shown.value.length === 0 && filter.value !== 'all' ? NONE_UNDER[filter.value] : null,
)
/** ⚑ The group a count on the Graph tab opened the tab at — marked until another is. */
const marked = ref<string | null>(null)
const list = ref<HTMLElement | null>(null)
watch(
  () => props.at?.press,
  async () => {
    const piece = props.at?.piece
    if (piece === undefined) return
    marked.value = piece
    await nextTick()
    // A piece whose files all stand on another piece's row has no group: its mention is shown.
    const at = `[data-piece="${CSS.escape(piece)}"]`
    ;(
      list.value?.querySelector<HTMLElement>(`[data-cy="tree-file-group"]${at}`) ??
      list.value?.querySelector<HTMLElement>(`[data-cy="tree-file-also-piece"]${at}`)
    )?.scrollIntoView({ block: 'nearest' })
  },
  { immediate: true },
)

// ⚑ **A filter is chosen for one conversation's work** — the tab outlives a change of conversation,
// and a filter carried over would open the next one's on a choice nobody made there.
watch(
  () => props.read?.conversation ?? null,
  () => {
    filter.value = 'all'
    // ⚑ …and a piece marked on it is not marked on the next one's.
    marked.value = null
  },
)

function open(resourceId: string): void {
  if (props.canOpen) emit('openDocument', resourceId)
}
</script>

<template>
  <section ref="list" class="tree-files" data-cy="tree-files">
    <!-- ⛔ **Not read yet is not *no files*** — `641` §5.5's rule, as the card's Current task says it. -->
    <p v-if="props.read === null" class="quiet" data-cy="tree-files-unread">
      Nothing has been read about the files on this work yet.
    </p>
    <CardEmpty
      v-else-if="groups.length === 0"
      icon="#i-file"
      says="No files kept yet"
      hint="A file appears here when an agent keeps one on this work, or on work under it."
      data-cy="tree-files-empty"
    />
    <template v-else>
      <div class="filters" role="group" aria-label="Which files" data-cy="tree-files-filters">
        <button
          v-for="one in FILE_FILTERS"
          :key="one.id"
          class="filter"
          :class="{ on: filter === one.id }"
          type="button"
          :aria-pressed="filter === one.id"
          :data-cy="`tree-files-filter-${one.id}`"
          @click="filter = one.id"
        >
          {{ one.label }}
        </button>
      </div>
      <ol class="groups">
        <li
          v-for="group in shown"
          :key="group.piece"
          class="group"
          :class="{ marked: marked === group.piece }"
          data-cy="tree-file-group"
          :data-piece="group.piece"
          :aria-current="marked === group.piece ? 'location' : undefined"
          :style="{ '--_depth': Math.min(group.depth, 4) }"
        >
          <p class="piece">
            <span class="label">{{ group.label }}</span>
            <span v-if="group.pieceTitle" class="piece-title" :title="group.pieceTitle">{{
              group.pieceTitle
            }}</span>
          </p>
          <section
            v-for="section in group.sections"
            :key="section.group ?? 'unclassified'"
            class="file-section"
            data-cy="tree-file-section"
            :data-group="section.group"
          >
            <h3
              v-if="section.group !== null"
              class="section-title"
              data-cy="tree-file-section-title"
            >
              {{ WORK_FILE_GROUP_WORDS[section.group] }}
            </h3>
            <ul class="lines">
              <li v-for="line in section.lines" :key="line.file.resourceId">
                <component
                  :is="props.canOpen ? 'button' : 'div'"
                  v-bind="props.canOpen ? { type: 'button' } : {}"
                  class="line file"
                  :class="{ flat: !props.canOpen, 'with-main': line.file.mainResult }"
                  data-cy="tree-file"
                  :data-document="line.file.resourceId"
                  :data-role="line.file.role"
                  :title="fileTitleSays(line.file)"
                  @click="open(line.file.resourceId)"
                >
                  <span class="file-title">{{ line.file.title }}</span>
                  <span class="role">{{ ROLE_WORD[line.file.role] }}</span>
                  <span class="who" :title="addedBySays(line.file)">{{
                    addedBySays(line.file)
                  }}</span>
                  <span class="time" :title="fullTime(line.file.keptAt)">{{
                    clockTime(line.file.keptAt)
                  }}</span>
                  <span
                    v-if="line.file.mainResult"
                    class="main-result"
                    data-cy="tree-file-main-result"
                  >
                    {{ MAIN_RESULT_WORDS }}
                  </span>
                </component>
                <!-- The other pieces that kept the same bytes, each opening where it was kept. -->
                <p v-if="line.alsoOn.length > 0" class="also" data-cy="tree-file-also">
                  {{ ALSO_KEPT_ON
                  }}<template v-for="(other, index) in line.alsoOn" :key="other.piece"
                    >{{ index === 0 ? ' ' : ', '
                    }}<button
                      v-if="other.conversation !== null"
                      class="also-piece"
                      :class="{ marked: marked === other.piece }"
                      type="button"
                      data-cy="tree-file-also-piece"
                      :data-piece="other.piece"
                      :aria-current="marked === other.piece ? 'location' : undefined"
                      @click="emit('openConversation', other.conversation, other.label)"
                    >
                      {{ other.label }}</button
                    ><span
                      v-else
                      :class="{ marked: marked === other.piece }"
                      data-cy="tree-file-also-piece"
                      :data-piece="other.piece"
                      :aria-current="marked === other.piece ? 'location' : undefined"
                      >{{ other.label }}</span
                    ></template
                  >.
                </p>
              </li>
            </ul>
          </section>
        </li>
      </ol>
      <!-- ⚑ **A filter that leaves nothing says so** — the pills stay above it, to go back. -->
      <p v-if="noneSays" class="quiet" data-cy="tree-files-none">{{ noneSays }}</p>
    </template>
    <!-- ⚠️ **A list kept from the last read that answered says so**, once, under it — an empty one
         too, which would otherwise claim *no files* as a fact of now. -->
    <p v-if="props.read !== null && !props.read.answered" class="quiet" data-cy="tree-files-stale">
      {{ FILES_DID_NOT_ANSWER }}
    </p>
  </section>
</template>

<style scoped>
.tree-files {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--space-6);
  overflow-y: auto;
}

.quiet {
  margin: 0;
  color: var(--muted);
  font-size: var(--type-caption);
}

/* ⚑ **All · Made · Inputs** — quiet pills, the chosen one in the accent's own fill. */
.filters {
  display: flex;
  flex: 0 0 auto;
  align-self: flex-end;
  gap: var(--space-2);
}

.filter {
  padding: var(--space-1) var(--space-5);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-pill);
  background: none;
  color: var(--muted);
  cursor: pointer;
  font: inherit;
  font-size: var(--type-caption);
  font-weight: var(--fw-semibold);
}

.filter.on {
  border-color: var(--accent);
  background: var(--accent-fill);
  color: var(--text);
}

.groups,
.lines {
  display: flex;
  min-width: 0;
  margin: 0;
  padding: 0;
  flex-direction: column;
  list-style: none;
}

.groups {
  gap: var(--space-7);
}

.lines {
  gap: var(--space-2);
}

.file-section {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-2);
}

.section-title {
  margin: 0;
  color: var(--muted);
  font-size: var(--type-caption);
  font-weight: var(--fw-semibold);
}

.main-result {
  white-space: nowrap;
  color: var(--muted);
  font-size: var(--type-caption);
}

/* ⚑ **One piece of the tree**, set in under the piece above it, as the tree nests. */
.group {
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding-left: calc(var(--_depth, 0) * var(--space-8));
  gap: var(--space-3);
}

/* ⚑ **The piece a count on the Graph tab opened the tab at** — the accent's own quiet fill. */
.group.marked {
  border-radius: var(--radius-md);
  background: var(--accent-fill);
}

/* A piece a Graph count opened, named in another file's also line. */
.also .marked {
  border-radius: var(--radius-xs);
  background: var(--accent-fill);
}

.piece {
  display: flex;
  min-width: 0;
  margin: 0;
  align-items: baseline;
  gap: var(--space-4);
}

.label {
  flex: 0 0 auto;
  color: var(--text);
  font-size: var(--type-small);
  font-weight: var(--fw-bold);
}

.piece-title {
  overflow: hidden;
  min-width: 0;
  color: var(--text-soft);
  font-size: var(--type-small);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ⚑ **One file a line**: its title, then what it is to its piece, who kept it and when. */
.line {
  display: grid;
  width: 100%;
  min-width: 0;
  align-items: baseline;
  padding: var(--space-2) var(--space-4);
  border: 0;
  border-radius: var(--radius-xs);
  background: none;
  color: inherit;
  column-gap: var(--space-6);
  font: inherit;
  font-size: var(--type-caption);
  grid-template-columns: minmax(0, 1fr) 4em 8em 5.5em;
  text-align: left;
}

.line:not(.flat) {
  cursor: pointer;
}

.line:not(.flat):hover {
  background: var(--accent-fill);
}

.line.file.with-main {
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto auto;
}

.file-title {
  overflow: hidden;
  color: var(--text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.role,
.time {
  color: var(--muted);
  white-space: nowrap;
}

/* The other pieces that kept the same bytes, quiet, under the file's row; it wraps when long. */
.also {
  margin: 0;
  padding: 0 var(--space-4) var(--space-2);
  color: var(--muted);
  font-size: var(--type-caption);
}

.also-piece {
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 2px;
  cursor: pointer;
}

.also-piece:hover,
.also-piece:focus-visible {
  color: var(--text-soft);
  text-decoration-style: solid;
}

.who {
  overflow: hidden;
  color: var(--text-soft);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
