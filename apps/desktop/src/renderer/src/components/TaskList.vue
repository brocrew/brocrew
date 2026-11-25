<script setup lang="ts">
import { vButtonKeys } from '../lib/button-keys'
import { computed, onBeforeUnmount, ref } from 'vue'
import type { WorkThatNamesIt } from '../../../shared/piece-called'
import { FOR_A_PERSON } from '../lib/outgoing-card'
import type { CastTask } from '../lib/working-together'
import AgentState from './AgentState.vue'
import MarkdownWords from './MarkdownWords.vue'

/**
 * 🔴 **One list of pieces of work, one line each** — the rows `WorkingTogether` drew twice, once for the work
 * this conversation gave out and once for the work it was given (`631`), now drawn in one place.
 *
 * List work given to this conversation under Current task. Each `cast-taken-work` row names its giver and shows the giver's dot when the band has its card; a press opens that giver. The caller's hook falls through from `<TaskList>` to `<ol>`, naming the list where it is placed.
 */
const props = defineProps<{
  tasks: readonly CastTask[]
  conversation?: string
  /** ⚑ `false` where no caller can act on a press, so none is drawn. */
  canOpen: boolean
  /**
   * Optional briefs keyed by work label; draw the current brief below its row.
   */
  briefs?: ReadonlyMap<string, string>
  /**
   * 🔴 **UI-008 · F051 — the work a PERSON gave this conversation: its root**, or `null` — the
   * first line, since it came first. ⚑ Its line says it is for the person and is never a press (no
   * conversation gave it); it is open for as long as its conversation is, so it is the current
   * piece where no other is open. ⛔ No state of its own: a root's is its conversation's (R1),
   * which the plate above says.
   */
  root?: WorkThatNamesIt | null
  /**
   * `current` shows only current work on the card. `all` shows every item oldest first in the All tasks popup.
   */
  mode: 'current' | 'all' | 'other'
  /** The last open match in the full result when All Tasks is paged. */
  currentPiece?: string | null
}>()

/**
 * ⚑ **What the list draws** — every piece, oldest first (the order the rows ARRIVE in: the walk is
 * sorted by when the work was handed out), or the newest one still open alone.
 */
const shown = computed(() => {
  if (props.mode !== 'current') return props.tasks
  const open = props.tasks.filter((one) => one.piece.open).at(-1)
  return open === undefined ? [] : [open]
})

/**
 * Expand the newest open work with its label, state, title and brief. Keep the other items to one line.
 */
const current = computed(() => {
  if (props.mode === 'other') return null
  if (props.currentPiece !== undefined)
    return shown.value.find((one) => one.piece.piece === props.currentPiece) ?? null
  return shown.value.filter((one) => one.piece.open).at(-1) ?? null
})
/** ⚑ **UI-008 · the root is the current piece where no other is open** — see {@link root}. */
const rootIsCurrent = computed(() =>
  props.currentPiece === undefined ? current.value === null : props.currentPiece === null,
)
const briefOf = (one: CastTask): string | null =>
  props.briefs?.get(one.piece.reading.heading) ?? null

/**
 * ⚑ **The brief is cut at three lines, and *Show more* brings the rest** — offered only where the
 * cut is real, measured on the drawn element.
 */
const briefOpen = ref(false)
const briefCut = ref(false)
let watching: ResizeObserver | undefined
function watchBrief(el: unknown): void {
  watching?.disconnect()
  watching = undefined
  if (!(el instanceof HTMLElement) || typeof ResizeObserver === 'undefined') return
  watching = new ResizeObserver(() => {
    briefCut.value = el.scrollHeight > el.clientHeight + 1
  })
  watching.observe(el)
}
onBeforeUnmount(() => watching?.disconnect())

const emit = defineEmits<{
  /** ⛔ **Names the conversation and does nothing else** — the act is the screen's (506). */
  openConversation: [conversation: string]
}>()

/**
 * ⚑ **Whether a press on this line would open a conversation** — `canOpen`, and a conversation that
 * gave the piece, which is the one a press opens. ⛔ D-016 · commit 6: a line given by a PERSON —
 * work its holder took on for them — has no giving conversation, so it is never a control, whatever
 * `canOpen` says.
 */
const pressable = (one: CastTask): boolean => props.canOpen && one.piece.from !== null
</script>

<template>
  <ol class="tasks">
    <!-- 🔴 **UI-008 · the work a person gave this conversation, first** (F051) — its label, whom
         it is for, and its title. ⛔ Never a button: no conversation gave it, so a press would open
         none. ⚑ The line's hooks are every line's. ⚠️ A template comment is rendered into SSR
         markup, so this one quotes none of the line's words. -->
    <li
      v-if="props.root && (props.mode === 'all' || rootIsCurrent)"
      class="task"
      :class="{ current: rootIsCurrent }"
    >
      <div
        class="trow flat"
        data-cy="cast-taken-work"
        data-root="true"
        data-open="true"
        data-pressable="false"
        :title="props.root.title ?? props.root.label"
      >
        <span class="tline">
          <span v-if="rootIsCurrent" class="ticon" aria-hidden="true">
            <svg class="icon"><use href="#i-file" /></svg>
          </span>
          <span class="tnum" :title="props.root.label">{{ props.root.label }}</span>
          <span class="tto" data-cy="cast-work-to" :title="FOR_A_PERSON">{{ FOR_A_PERSON }}</span>
        </span>
        <MarkdownWords
          v-if="props.root.title"
          class="tsaid"
          data-cy="cast-work-said"
          :text="props.root.title"
          :session-id="props.conversation"
        />
      </div>
      <MarkdownWords
        v-if="props.root.definitionOfDone"
        class="tbrief open"
        lead="Done when:"
        :text="props.root.definitionOfDone"
        :session-id="props.conversation"
      />
    </li>
    <li
      v-for="one in shown"
      :key="one.piece.piece"
      class="task"
      :class="{ current: one === current }"
    >
      <!-- The row's keyboard action opens its giver. Render prose in a container so its own
           links remain independent controls rather than buttons nested in a navigation button. -->
      <div
        v-bind="
          pressable(one)
            ? {
                role: 'button',
                tabindex: 0,
                onClick: () => emit('openConversation', one.piece.from!),
              }
            : {}
        "
        v-button-keys
        class="trow"
        :class="{ flat: !pressable(one) }"
        data-cy="cast-taken-work"
        :data-conversation="one.piece.from"
        :data-state="one.piece.state"
        :data-open="one.piece.open"
        :data-pressable="String(pressable(one))"
        :title="one.piece.said"
      >
        <span class="tline">
          <span v-if="one === current" class="ticon" aria-hidden="true">
            <svg class="icon"><use href="#i-file" /></svg>
          </span>
          <span class="tnum" :title="one.piece.reading.heading">{{
            one.piece.reading.heading
          }}</span>
          <AgentState v-if="one.facets" size="dot" v-bind="one.facets" :label="one.toName" />
          <span class="tto" data-cy="cast-work-to" :title="one.toName">{{ one.toName }}</span>
          <!-- ⚠️ **An icon with the word on its `title` and its label** — a status told by shape
             alone is a status for people who can separate shapes, and this app has a word for
             every one of them already. -->
          <!-- ⚑ **The current piece says its state in words, in a pill** — the mark inside it, and
               the word the mark's own label already carries, drawn beside it for the eye. -->
          <span :class="one === current ? 'tpill' : 'tbare'">
            <span
              class="tmark"
              role="img"
              data-cy="cast-work-mark"
              :aria-label="one.piece.reading.word"
              :title="one.piece.reading.word"
              >{{ one.piece.open ? '○' : '●' }}</span
            >
            <span v-if="one === current" class="tword" aria-hidden="true">{{
              one.piece.reading.word
            }}</span>
          </span>
        </span>
        <MarkdownWords
          class="tsaid"
          data-cy="cast-work-said"
          :text="one.piece.said"
          :session-id="props.conversation ?? one.piece.from ?? undefined"
        />
        <!-- ⚑ F083 · the current piece's wait, in the ledger's own sentence, under its pill. -->
        <span
          v-if="one === current && one.piece.reading.why"
          class="tcause"
          data-cy="cast-work-why"
          >{{ one.piece.reading.why }}</span
        >
      </div>
      <MarkdownWords
        v-if="(one === current || props.mode === 'all') && one.piece.reading.definitionOfDone"
        class="tbrief open"
        data-cy="cast-work-done"
        lead="Done when:"
        :text="one.piece.reading.definitionOfDone"
        :session-id="props.conversation ?? one.piece.from ?? undefined"
      />
      <template v-if="one === current && briefOf(one)">
        <div
          :ref="watchBrief"
          class="tbrief"
          :class="{ open: briefOpen }"
          data-cy="cast-work-brief"
        >
          <MarkdownWords
            :text="briefOf(one)!"
            :session-id="props.conversation ?? one.piece.from ?? undefined"
          />
        </div>
        <button
          v-if="briefCut || briefOpen"
          class="tmore"
          :class="{ open: briefOpen }"
          type="button"
          :aria-expanded="briefOpen"
          data-cy="cast-work-brief-more"
          @click="briefOpen = !briefOpen"
        >
          <svg class="icon" aria-hidden="true"><use href="#i-chevron" /></svg>
          {{ briefOpen ? 'Show less' : 'Show more' }}
        </button>
      </template>
    </li>
  </ol>
</template>

<style scoped>
/* 🔴 **631 · the piece lines** — one row each; only the title may clip, and its whole text is on
   the `title`. */
.tasks {
  display: flex;
  margin: 0 0 var(--space-5);
  flex-direction: column;
  padding: 0;
  gap: var(--space-3);
  list-style: none;
}

.task {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

/*
 * Give current work its own well using the quiet accent fill.
 */
.task.current {
  padding: var(--space-5) var(--space-6);
  border-radius: var(--radius);
  background: var(--accent-fill);
  gap: var(--space-3);
}

.ticon {
  display: inline-flex;
  width: 22px;
  height: 22px;
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-xs);
  background: var(--accent-fill-strong);
  color: var(--accent);
}

.ticon .icon {
  width: 13px;
  height: 13px;
}

.task.current .tnum {
  min-width: 0;
  flex: 0 1 auto;
  font-size: var(--type-body);
}

.task.current .tsaid {
  color: var(--text);
  font-size: var(--type-body);
  font-weight: var(--fw-medium);
}

.tbare {
  display: contents;
}

/* ⚑ The mark and its word in one pill — the accent pill. */
.tpill {
  display: inline-flex;
  flex: none;
  align-items: center;
  padding: 1px var(--space-4);
  border: var(--border-width) solid var(--accent-pill-border);
  border-radius: var(--radius-pill);
  background: var(--accent-pill-bg);
  color: var(--accent-text-soft);
  gap: var(--space-2);
}

.tpill .tmark {
  margin-left: 0;
}

.tword {
  font-size: var(--type-caption);
  font-weight: var(--fw-medium);
  white-space: nowrap;
}

/* ⚑ **The brief, cut at three lines** — the rest one press away, below it. */
.tbrief {
  display: -webkit-box;
  overflow: hidden;
  margin: 0;
  color: var(--text-soft);
  -webkit-box-orient: vertical;
  font-size: var(--type-body);
  -webkit-line-clamp: 3;
  line-height: 1.5;
  /* ⚑ W4.183 · a long path or link in a brief wraps rather than running past the box at 360px. */
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.tbrief.open {
  display: block;
  /* ⚑ W4.183 · open, it hides nothing — so it clips nothing, not even a glyph's overhang. */
  overflow: visible;
}

.tmore {
  display: inline-flex;
  align-self: flex-start;
  align-items: center;
  padding: var(--space-2) 0 0;
  border: 0;
  background: none;
  color: var(--accent-text-soft);
  cursor: pointer;
  font: inherit;
  font-size: var(--type-small);
  gap: var(--space-2);
}

.tmore .icon {
  width: 12px;
  height: 12px;
  transform: rotate(90deg);
}

.tmore.open .icon {
  transform: rotate(-90deg);
}

/* ⚑ **The whole row is the press.** Reset to nothing — the list owns the rhythm. */
/*
 * Put facts on the first line and the description below so it can use the column's full width.
 */
.trow {
  display: flex;
  width: 100%;
  min-width: 0;
  flex-direction: column;
  align-items: stretch;
  padding: var(--space-1) 0;
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
  font: inherit;
  gap: var(--space-3);
  text-align: left;
}

/* ⛔ **Not a control**: no pointer, and no hover answer, because nothing answers. */
.trow.flat {
  cursor: default;
}

.trow:hover .tsaid {
  color: var(--text);
}

.tline {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--space-3);
}

.tmark {
  flex: 0 0 auto;
  margin-left: auto;
  color: var(--muted);
  font-size: var(--type-caption);
}

.tto {
  overflow: hidden;
  min-width: 0;
  color: var(--text);
  font-size: var(--type-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ⚑ **718 · the label gives way before the name** — it clips at the end, keeps its head, and
   carries the whole heading on its `title`, so a long heading can never squeeze the giver's
   name to nothing or push the line past the drawer column (`718`'s review). */
.tnum {
  overflow: hidden;
  /* ⚑ It gives way FIRST (a shrink weight far above the name's), down to a floor that still reads
     a label like *W1.12* whole, so the giver keeps its name — measured at the narrow floor (then
     for *Task #NN*), where an even share left the name 8.6 px wide. */
  min-width: 5em;
  flex: 0 1000 auto;
  color: var(--text);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ⚠️ **Two lines and then an ellipsis** — the whole sentence is on the row's `title`, and this
   component carries a row in the clipped-text ledger. */
.tsaid {
  display: -webkit-box;
  overflow: hidden;
  min-width: 0;
  color: var(--muted);
  font-size: var(--type-caption);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.tcause {
  min-width: 0;
  color: var(--faint);
  font-size: var(--type-caption);
}
</style>
