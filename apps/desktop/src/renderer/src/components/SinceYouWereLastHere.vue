<script setup lang="ts">
import { computed } from 'vue'
import { clockTime } from '../../../shared/clock'
import {
  REGISTER_SAYS,
  sinceWords,
  WHAT_ICON,
  WHAT_WORDS,
  type SinceView,
} from '../lib/recent-activity'
import { RECENT_ACTIVITY_LINES } from '../../../shared/recent-activity'

/**
 * What finished or failed since the person last had this window in front, a few lines at most,
 * each opening its conversation; the rest are on Recent activity.
 */
const props = defineProps<{
  view: SinceView
  /** When the person was last here. */
  since: number
  clock: number
}>()

const emit = defineEmits<{
  open: [conversation: string]
  seeAll: []
}>()

const summary = computed(() => sinceWords(props.view, props.since, props.clock))
</script>

<template>
  <article class="since bb-card" data-cy="since-last-here">
    <header class="since-head">
      <h2>Since you were last here</h2>
      <p data-cy="since-summary">{{ summary }}</p>
      <p v-if="props.view.partial" class="in-part" data-cy="since-read-in-part">
        Part of the record couldn’t be read, so some lines may be missing.
      </p>
      <p v-if="props.view.capped" class="in-part" data-cy="since-capped">
        Only the newest {{ RECENT_ACTIVITY_LINES }} were read; older ones may be missing.
      </p>
    </header>
    <ul v-if="props.view.lines.length > 0" class="lines">
      <li v-for="line in props.view.lines" :key="line.id">
        <button
          type="button"
          class="line"
          :disabled="line.conversation === null"
          :title="line.conversation === null ? 'No conversation to open' : 'Open the conversation'"
          data-cy="since-line"
          :data-what="line.what"
          :data-register="line.register"
          @click="line.conversation !== null && emit('open', line.conversation)"
        >
          <span class="mark" :class="line.what" aria-hidden="true">
            <svg class="icon"><use :href="WHAT_ICON[line.what]" /></svg>
          </span>
          <span class="words">
            <strong :title="line.piece.title ?? line.piece.label">{{
              line.piece.title ?? line.piece.label
            }}</strong>
            <span :title="REGISTER_SAYS[line.register]"
              >{{ line.agent }} · {{ line.piece.title === null ? '' : `${line.piece.label} · `
              }}{{ WHAT_WORDS[line.what] }}</span
            >
          </span>
          <time class="at" :datetime="new Date(line.at).toISOString()">{{
            clockTime(line.at)
          }}</time>
          <svg v-if="line.conversation !== null" class="icon open" aria-hidden="true">
            <use href="#i-arrow" />
          </svg>
        </button>
      </li>
    </ul>
    <footer class="since-foot">
      <button type="button" class="see-all" data-cy="since-see-all" @click="emit('seeAll')">
        See all in Recent activity
        <svg class="icon" aria-hidden="true"><use href="#i-arrow" /></svg>
      </button>
    </footer>
  </article>
</template>

<style scoped>
.since {
  flex: none;
  margin-bottom: var(--space-6);
  padding: 0;
  overflow: hidden;
}

.since-head {
  padding: var(--space-6) var(--space-7);
  border-bottom: var(--border-width) solid var(--line);
}

.since-head h2 {
  margin: 0;
  color: var(--text);
  font-size: var(--type-body);
  font-weight: var(--fw-semibold);
}

.since-head p {
  margin: var(--space-2) 0 0;
  color: var(--muted);
  font-size: var(--type-small);
}

.since-head .in-part {
  color: var(--danger-text);
}

.lines {
  margin: 0;
  padding: 0;
  list-style: none;
}

.lines li + li {
  border-top: var(--border-width) solid var(--line);
}

.line {
  display: flex;
  width: 100%;
  align-items: center;
  padding: var(--space-5) var(--space-7);
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  gap: var(--space-6);
}

.line:hover:not(:disabled) {
  background: var(--wash-3, var(--panel-2));
}

.line:disabled {
  cursor: default;
}

.mark {
  display: grid;
  width: 26px;
  height: 26px;
  flex: none;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  place-items: center;
}

.mark.failed {
  color: var(--danger-text);
}

.mark .icon {
  width: 13px;
  height: 13px;
}

.words {
  display: grid;
  min-width: 0;
  flex: 1;
  gap: var(--space-1);
}

.words strong {
  overflow: hidden;
  color: var(--text);
  font-weight: var(--fw-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.words span {
  color: var(--muted);
  font-size: var(--type-small);
}

.at {
  flex: none;
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: var(--type-small);
}

.icon.open {
  width: 13px;
  height: 13px;
  flex: none;
  color: var(--muted);
  transform: rotate(-45deg);
}

.since-foot {
  padding: var(--space-4) var(--space-7);
  border-top: var(--border-width) solid var(--line);
}

.see-all {
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent-link);
  font: inherit;
  font-size: var(--type-small);
  cursor: pointer;
  gap: var(--space-2);
}

.see-all .icon {
  width: 12px;
  height: 12px;
}
</style>
