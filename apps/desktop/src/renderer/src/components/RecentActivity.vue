<script setup lang="ts">
import { transcriptsClearedWords } from '../../../shared/transcript-retention'
import { computed } from 'vue'
import { clockTime } from '../../../shared/clock'
import {
  RECENT_ACTIVITY_LINES,
  skillImportWords,
  type RecentActivityReading,
} from '../../../shared/recent-activity'
import {
  ACTIVITY_WINDOWS,
  activitySays,
  byDay,
  pieceWords,
  REGISTER_SAYS,
  WHAT_ICON,
  WHAT_WORDS,
} from '../lib/recent-activity'

/**
 * Recent activity: what agents finished, started, stopped or failed in a chosen time window, newest
 * first, one dated line each, each opening its conversation. A window that has not been read yet
 * says so, rather than looking like a quiet one.
 */
const props = defineProps<{
  /** The host's reading for the chosen window, or `null` before one has arrived. */
  reading: RecentActivityReading | null
  windowMs: number
  /** Now, as the screen's clock has it, for "Today" and "Yesterday". */
  clock: number
}>()

const emit = defineEmits<{
  chooseWindow: [ms: number]
  open: [conversation: string]
}>()

const says = computed(() => activitySays(props.reading))
const days = computed(() => byDay(props.reading?.lines ?? [], props.clock))
const windowWords = computed(
  () => ACTIVITY_WINDOWS.find((one) => one.ms === props.windowMs)?.label ?? 'chosen time window',
)
/** Each state's tile colour; a start keeps the tile's own accent. */
const TONE: Readonly<Record<string, string>> = {
  finished: 'bb-icon-box--success',
  failed: 'bb-icon-box--danger',
  started: '',
  stopped: 'bb-icon-box--quiet',
}
const someClaimed = computed(() => props.reading?.lines.some((line) => line.register === 'claimed'))
</script>

<template>
  <section
    class="activity-surface"
    data-wired="true"
    data-cy="recent-activity"
    data-chat-theme="light"
  >
    <header class="page-head">
      <div class="head-copy">
        <h1 class="bb-page-title">Recent activity</h1>
        <p>See what your agents finished, started or stopped in a chosen time window.</p>
      </div>
    </header>

    <div class="page-body">
      <div class="window-choice" role="group" aria-label="Time window" data-cy="activity-window">
        <button
          v-for="choice in ACTIVITY_WINDOWS"
          :key="choice.ms"
          type="button"
          class="choice"
          :class="{ chosen: choice.ms === props.windowMs }"
          :aria-pressed="choice.ms === props.windowMs"
          :data-cy="`activity-window-${String(choice.ms)}`"
          @click="emit('chooseWindow', choice.ms)"
        >
          Last {{ choice.label }}
        </button>
      </div>

      <p v-if="says === 'not-read'" class="state" data-cy="activity-not-read">
        Not read yet. This isn’t the same as nothing having happened.
      </p>

      <template v-else>
        <p v-if="says === 'read-in-part'" class="state warn" data-cy="activity-read-in-part">
          Part of the record couldn’t be read, so some lines may be missing.
        </p>

        <div v-if="says === 'nothing-recorded'" class="state" data-cy="activity-empty">
          <p>No activity recorded in the last {{ windowWords }}.</p>
          <p class="hint">Try a longer time window.</p>
        </div>

        <article v-if="props.reading?.skillImports?.length" class="activity-card bb-card">
          <p
            v-for="line in props.reading.skillImports"
            :key="line.id"
            class="line notice bb-entry"
            data-cy="activity-skill-import"
          >
            <time class="at bb-entry-time" :datetime="new Date(line.at).toISOString()">{{
              clockTime(line.at)
            }}</time>
            <span class="mark bb-icon-box bb-icon-box--waiting" aria-hidden="true">
              <svg class="icon"><use href="#i-alert" /></svg>
            </span>
            <span class="words bb-entry-words">
              <span class="who import-words">{{ skillImportWords(line) }}</span>
            </span>
          </p>
        </article>
        <article v-if="props.reading?.transcriptsCleared?.length" class="activity-card bb-card">
          <p
            v-for="line in props.reading.transcriptsCleared"
            :key="line.at"
            class="line notice bb-entry"
            data-cy="activity-transcripts-cleared"
          >
            <time class="at bb-entry-time" :datetime="new Date(line.at).toISOString()">{{
              clockTime(line.at)
            }}</time>
            <span class="mark bb-icon-box bb-icon-box--quiet" aria-hidden="true">
              <svg class="icon"><use href="#i-archive" /></svg>
            </span>
            <span class="words bb-entry-words">
              <span class="who">{{ transcriptsClearedWords(line) }}</span>
            </span>
          </p>
        </article>
        <article v-if="days.length > 0" class="activity-card bb-card" data-cy="activity-list">
          <section v-for="day in days" :key="day.key" class="day" data-cy="activity-day">
            <h2 class="day-head">
              <strong v-if="day.word">{{ day.word }}</strong>
              <span>{{ day.date }}</span>
            </h2>
            <ul class="lines">
              <li v-for="line in day.lines" :key="line.id">
                <button
                  type="button"
                  class="line bb-entry"
                  :disabled="line.conversation === null"
                  :title="
                    line.conversation === null ? 'No conversation to open' : 'Open the conversation'
                  "
                  data-cy="activity-line"
                  :data-what="line.what"
                  :data-register="line.register"
                  @click="line.conversation !== null && emit('open', line.conversation)"
                >
                  <time class="at bb-entry-time" :datetime="new Date(line.at).toISOString()">{{
                    clockTime(line.at)
                  }}</time>
                  <span class="mark bb-icon-box" :class="TONE[line.what]" aria-hidden="true">
                    <svg class="icon"><use :href="WHAT_ICON[line.what]" /></svg>
                  </span>
                  <span class="words bb-entry-words">
                    <span class="who" :title="REGISTER_SAYS[line.register]"
                      ><strong>{{ line.agent }}</strong> {{ WHAT_WORDS[line.what] }}</span
                    >
                    <span class="piece bb-entry-detail" :title="pieceWords(line)">{{
                      pieceWords(line)
                    }}</span>
                  </span>
                  <svg v-if="line.conversation !== null" class="icon open" aria-hidden="true">
                    <use href="#i-arrow" />
                  </svg>
                </button>
              </li>
            </ul>
          </section>
          <p v-if="props.reading?.capped" class="foot" data-cy="activity-capped">
            Showing the newest {{ RECENT_ACTIVITY_LINES }}. Older lines aren’t shown here.
          </p>
          <p v-if="someClaimed" class="foot" data-cy="activity-claimed-note">
            Reported outcomes come from the agent.
          </p>
        </article>
      </template>
    </div>
  </section>
</template>

<style scoped>
/* The page shell, as the other pages in the main area declare it. */
.activity-surface {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  background-color: var(--conversation-bg-color, var(--chat-bg));
  background-image: var(--conversation-bg-image, var(--paper-wash));
  background-position: var(--conversation-bg-position, 0% 0%);
  background-repeat: var(--conversation-bg-repeat, repeat);
  background-size: var(--conversation-bg-size, auto);
  image-rendering: var(--conversation-bg-rendering, auto);
  color: var(--text);
}

.activity-surface > * {
  image-rendering: auto;
}

.page-head {
  display: flex;
  min-height: var(--surface-header-h);
  flex: 0 0 auto;
  align-items: center;
  padding: var(--space-10) var(--space-12);
  border-bottom: var(--border-width) solid var(--line);
  background: var(--surface-header-bg);
}

.head-copy h1 {
  margin: 0;
  color: var(--text);
}

.head-copy p {
  margin: var(--space-2) 0 0;
  color: var(--muted);
  font-size: var(--type-small);
  line-height: var(--leading-relaxed);
}

.page-body {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  padding: var(--space-10) var(--space-12);
  overflow-y: auto;
  gap: var(--space-8);
}

.window-choice {
  display: flex;
  flex-wrap: wrap;
  align-self: flex-start;
  padding: var(--space-2);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
  gap: var(--space-2);
}

.choice {
  padding: var(--space-3) var(--space-5);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-soft);
  font: inherit;
  font-size: var(--type-small);
  cursor: pointer;
}

.choice.chosen {
  background: var(--accent-fill-weak);
  color: var(--accent-text);
  font-weight: var(--fw-semibold);
}

.state {
  margin: 0;
  color: var(--text-soft);
  font-size: var(--type-small);
}

.state p {
  margin: 0;
}

.state .hint {
  margin-top: var(--space-2);
  color: var(--muted);
}

.state.warn {
  color: var(--danger-text);
}

.activity-card {
  padding: 0;
  overflow: hidden;
}

/* Every card's entries are one row: the time, a tile in the entry's own colour, the words, and the
   way to the conversation where there is one. */
.day + .day {
  border-top: var(--border-width) solid var(--line);
}

.day-head {
  display: flex;
  margin: 0;
  align-items: baseline;
  padding: var(--space-6) var(--space-8);
  border-bottom: var(--border-width) solid var(--line);
  background: var(--panel-2);
  color: var(--muted);
  font-size: var(--type-small);
  font-weight: var(--fw-normal);
  gap: var(--space-4);
}

.day-head strong {
  color: var(--text);
  font-size: var(--type-body);
  font-weight: var(--fw-semibold);
}

.lines {
  margin: 0;
  padding: 0;
  list-style: none;
}

.lines li + li {
  border-top: var(--border-width) solid var(--line);
}

/* A line is a button: no button chrome, the whole row the press. */
.line {
  width: 100%;
  margin: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: var(--type-body);
  text-align: left;
  cursor: pointer;
}

.line:hover:not(:disabled) {
  background: var(--wash-3, var(--panel-2));
}

.line:disabled,
.line.notice {
  cursor: default;
}

.who {
  color: var(--text-soft);
  overflow-wrap: anywhere;
}

.who strong {
  color: var(--text);
  font-weight: var(--fw-semibold);
}

.piece {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.icon.open {
  width: var(--icon);
  height: var(--icon);
  flex: none;
  color: var(--muted);
  transform: rotate(-45deg);
}

.foot {
  margin: 0;
  padding: var(--space-6) var(--space-8);
  border-top: var(--border-width) solid var(--line);
  color: var(--muted);
  font-size: var(--type-small);
}
</style>
