<script setup lang="ts">
import { computed } from 'vue'
import AgentState from './AgentState.vue'
import type { GraphNode } from '../lib/forest-graph'
import { OPEN_THE_CONVERSATION } from '../lib/taking-over'
import { showFilesOn, type RootFiles } from '../lib/files-kept'

/**
 * # ⚑ One conversation's card in the forest — `668`'s card, on its own since the forest is drawn by
 * Vue Flow (2026-09-30)
 *
 * ⚑ **The card `TeamForest` drew in each generation's grid, unchanged**: the plate, the bold name
 * beside a mono slug, the standing in words, where it is, a named absence where its parent was not
 * drawn, and the pieces it holds — the three newest, the earlier ones a press away. ⚑ Vue Flow draws
 * it as a node; `TeamForest` places it and holds which cards are opened out.
 *
 * ⛔ **Its own component so the server can render it** — Vue Flow draws nodes only in a browser, and
 * the dot census reads a card's markup off a server render.
 */
const props = defineProps<{
  node: GraphNode
  /** ⚑ The conversation a person is in — outlined. */
  here?: boolean
  /** ⚑ Its earlier pieces are opened out. */
  opened?: boolean
  /**
   * ⚑ **UI-002 · how many files each piece holds, by piece id** — the Graph tab's; a task line with
   * files shows the count, and a press on it opens the Files tab there. ⛔ Absent on the Team page.
   */
  fileCounts?: ReadonlyMap<string, number>
  /**
   * ⚑ **UI-002 · the files on this conversation's own root**, counted on its card — a root is never a
   * task line. ⛔ Absent on every card but the conversation on screen's, and on the Team page.
   */
  rootFiles?: RootFiles | null
}>()

const emit = defineEmits<{
  /** ⚑ Open out, or fold back, its earlier pieces. */
  toggle: []
  /** ⚑ **UI-002 · a task line's file count, pressed** — show that piece's files. */
  files: [piece: string]
}>()

/** ⚑ A task line's file count — `0` where it holds none, or where no counts were handed in. */
const countOf = (piece: string | undefined): number =>
  piece === undefined ? 0 : (props.fileCounts?.get(piece) ?? 0)

/** ⚑ How many task lines a card shows before *N more*. */
const TASKS_SHOWN = 3

/**
 * ⚑ **The three NEWEST, with the earlier ones a press away** — `668`'s review: the fold lists a
 * conversation's tasks oldest first, and the first three were the oldest, so the one an agent is on
 * now was the one hidden.
 */
const shown = computed(() =>
  props.opened ? props.node.tasks : props.node.tasks.slice(-TASKS_SHOWN),
)
</script>

<template>
  <!-- ⚑ **The conversation's own row hook and facts, on the card itself** — so a server render of
       the card carries them as the page's drawing does. -->
  <!-- 🔴 **UI-005 · a press on a card is a press, never the start of a pan** (F043) — `nopan` and
       `nodrag`, Vue Flow's own words for it. ⚑ The card's press itself is Vue Flow's node click
       (`TeamForest`), so anywhere on the card presses it; ⛔ each control inside stops its own click
       there, so a count or *earlier* is not also a press on the card. -->
  <div
    class="card nopan nodrag"
    :class="{ current: props.here }"
    :data-cy="`forest-row-${props.node.row.key}`"
    data-kind="a-conversation"
    :data-depth="props.node.row.depth"
    :data-generation="props.node.generation"
    :data-conversation="props.node.row.conversation"
    :data-parent="props.node.parent ?? ''"
    :data-current="props.here"
  >
    <!-- ⚑ **D-017b · one press on every conversation node**: it opens in its full
       view, whatever it is doing. ⚑ **UI-005** — a button still, so a keyboard reaches it, and its
       click, like any on the card, is the node's (`TeamForest`'s `@node-click`). -->
    <button type="button" class="head" data-cy="forest-open" :title="OPEN_THE_CONVERSATION">
      <!-- Bind the whole plate so scheduled and background states retain their clock or terminal here. Use the rail row's avatar size. -->
      <AgentState size="row" v-bind="props.node.row.facets" :label="props.node.row.name" />
      <span class="who">
        <!-- ⚑ **Each clipper carries its own whole string** — a name or a slug a
           card this narrow can cut (the clipped-text ledger's row). -->
        <span class="name" data-cy="forest-name" :title="props.node.row.name">{{
          props.node.row.name
        }}</span>
        <span
          v-if="props.node.row.identity"
          class="slug"
          data-cy="forest-slug"
          :title="props.node.row.identity"
          >{{ props.node.row.identity }}</span
        >
      </span>
    </button>
    <!-- ⚠️ **The standing in WORDS** — the one place the forest says its holder's
       wait, since a plate never draws one (`645`); the task lines below it carry no
       dot since `668`, and `a-dot-says-one-thing.render.test.ts` §3 pins both. -->
    <span class="state">
      <span v-if="props.node.row.says" class="says" data-cy="forest-says">{{
        props.node.row.says
      }}</span>
      <span v-if="props.node.row.conversationRow?.whereSays" class="here" data-cy="forest-here">{{
        props.node.row.conversationRow?.whereSays
      }}</span>
      <!-- ⚑ **UI-002 · the files on its own root, counted** — a press opens the Files tab there. -->
      <button
        v-if="props.rootFiles"
        type="button"
        class="files"
        data-cy="forest-root-files"
        :data-piece="props.rootFiles.piece"
        :title="showFilesOn(props.rootFiles.count, props.rootFiles.label)"
        :aria-label="showFilesOn(props.rootFiles.count, props.rootFiles.label)"
        @click.stop="emit('files', props.rootFiles.piece)"
      >
        <svg class="icon" aria-hidden="true"><use href="#i-file" /></svg>{{ props.rootFiles.count }}
      </button>
    </span>
    <!-- 🔴 **A named absence, never a missing parent** — `641` §1.1. -->
    <span
      v-if="props.node.row.conversationRow?.parentNotDrawn"
      class="absent"
      data-cy="forest-parent-not-drawn"
      >Started by a conversation this reading did not draw</span
    >

    <!-- ⚑ **The tasks this conversation holds** — `631`'s task line, on the node. -->
    <!-- ⚑ **The earlier tasks, a press away** — above the three newest, where they
       fall in the order the tasks were given. -->
    <button
      v-if="props.node.tasks.length > TASKS_SHOWN"
      type="button"
      class="more"
      data-cy="forest-more"
      :aria-expanded="props.opened"
      @click.stop="emit('toggle')"
    >
      {{ props.opened ? 'Fewer' : `${props.node.tasks.length - TASKS_SHOWN} earlier` }}
    </button>
    <ul v-if="props.node.tasks.length" class="tasks">
      <li
        v-for="task in shown"
        :key="task.key"
        class="task-row"
        :data-cy="`forest-row-${task.key}`"
        data-kind="a-task"
        :data-depth="task.depth"
        :data-conversation="task.conversation"
      >
        <span class="task" data-cy="forest-task" :title="task.taskRow?.said">
          <span class="tnum" data-cy="forest-task-number">{{ task.taskRow?.reading.heading }}</span>
          <span
            class="mark"
            role="img"
            data-cy="forest-task-mark"
            :aria-label="task.taskRow?.reading.word"
            :title="task.taskRow?.reading.word"
            >{{ task.taskRow?.open ? '○' : '●' }}</span
          >
          <span class="said" data-cy="forest-task-said">{{ task.taskRow?.said }}</span>
          <!-- ⚑ **UI-002 · its files, counted** (`07` §2 item 3) — a press opens the Files tab at
               this piece. ⛔ The line itself stays words: only the count is a press. -->
          <button
            v-if="countOf(task.taskRow?.piece) > 0"
            type="button"
            class="files"
            data-cy="forest-task-files"
            :data-piece="task.taskRow?.piece"
            :title="showFilesOn(countOf(task.taskRow?.piece), task.taskRow?.reading.heading ?? '')"
            :aria-label="
              showFilesOn(countOf(task.taskRow?.piece), task.taskRow?.reading.heading ?? '')
            "
            @click.stop="emit('files', task.taskRow!.piece)"
          >
            <svg class="icon" aria-hidden="true"><use href="#i-file" /></svg
            >{{ countOf(task.taskRow?.piece) }}
          </button>
        </span>
        <span v-if="task.taskRow?.giverNotDrawn" class="absent" data-cy="forest-giver-not-drawn"
          >Given by a conversation this reading did not draw</span
        >
      </li>
    </ul>
  </div>
</template>

<style scoped>
.card {
  display: flex;
  width: 100%;
  min-width: 0;
  flex-direction: column;
  padding: var(--space-4) var(--space-5);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
  background: var(--panel);
  gap: var(--space-2);
}

.head {
  display: flex;
  min-width: 0;
  align-items: center;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  gap: var(--space-3);
  text-align: left;
}

button.head {
  cursor: pointer;
}

button.head:hover .name {
  text-decoration: underline;
}

.who {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.name {
  overflow: hidden;
  color: var(--text);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.slug {
  overflow: hidden;
  color: var(--faint);
  font-family: var(--font-mono);
  font-size: var(--type-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.state {
  display: flex;
  flex-wrap: wrap;
  color: var(--muted);
  font-size: var(--type-caption);
  gap: var(--space-3);
}

.here {
  color: var(--faint);
}

.tasks {
  display: flex;
  margin: var(--space-2) 0 0;
  flex-direction: column;
  padding: var(--space-2) 0 0;
  border-top: var(--border-width) solid var(--line);
  gap: var(--space-1);
  list-style: none;
}

.task-row {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.task {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  align-items: center;
  gap: var(--space-2);
}

.tnum {
  flex: 0 0 auto;
  color: var(--text);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
}

.mark {
  flex: 0 0 auto;
  color: var(--muted);
  font-size: var(--type-caption);
}

/* ⚠️ **One line and then an ellipsis** — the whole title is on the line's own `title`, and this
   component carries a row in the clipped-text ledger for it. */
.said {
  overflow: hidden;
  min-width: 0;
  flex: 1 1 auto;
  color: var(--muted);
  font-size: var(--type-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ⚑ **UI-002 · a piece's file count** — small, quiet, and a press; it never gives way to the title. */
.files {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  padding: 0 var(--space-2);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-pill);
  background: none;
  color: var(--muted);
  cursor: pointer;
  font: inherit;
  font-size: var(--type-caption);
  gap: var(--space-1);
}

.files:hover {
  border-color: var(--accent);
  color: var(--text);
}

.files .icon {
  width: 9px;
  height: 9px;
}

.absent {
  color: var(--faint);
  font-size: var(--type-caption);
  font-style: italic;
}

.more {
  align-self: flex-start;
  padding: 0;
  border: 0;
  background: none;
  color: var(--muted);
  cursor: pointer;
  font: inherit;
  font-size: var(--type-caption);
  text-decoration: underline;
}

/* ⚑ **The conversation a person is in**, outlined in the accent. */
.card.current {
  border-color: var(--accent);
  box-shadow: var(--accent-glow-weak);
}
</style>
