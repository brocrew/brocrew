<script setup lang="ts">
import { computed, ref } from 'vue'
import { renderChatMarkdown } from '../lib/markdown'
import type { ThinkingItem } from '../lib/transcript'

/**
 * The model's reasoning (027) — quiet by default, because it is what the agent was doing on the
 * way to the answer rather than the answer.
 *
 * **Usually there are no words**, and the whole point of this component is to say that honestly
 * instead of rendering an empty box. Claude reports a token estimate and never the text; Codex
 * sends a summary only when the turn asked for one. So:
 *  - **words** → an expandable disclosure with the summary inside.
 *  - **no words** → a pill alone: "thought · ~165 tokens", or just "thought" with no count.
 *
 * What is shown is a SUMMARY of the reasoning, never the raw chain of thought — no provider gives
 * us that. Saying so is not a comment's job: the expanded body says it on screen, because a reader
 * who opens a disclosure labelled "thought" has every reason to assume they are reading what the
 * model actually thought, and they are not.
 */
const props = defineProps<{
  item: ThinkingItem
  /** Start open, as a run's panel does when a person has already asked to see this thought. */
  opened?: boolean
}>()

/** Open only when there is something to open. A disclosure over nothing is a lie about content. */
const open = ref(props.opened === true)
const hasText = computed(() => props.item.text.trim() !== '')
const rendered = computed(() => (hasText.value ? renderChatMarkdown(props.item.text) : ''))

const label = computed(() => {
  const verb = props.item.streaming ? 'thinking' : 'thought'
  const tokens = props.item.tokens
  return tokens !== undefined ? `${verb} · ~${tokens} tokens` : verb
})
</script>

<template>
  <div
    class="thinking"
    data-cy="thinking-entry"
    :data-streaming="item.streaming ? 'true' : 'false'"
  >
    <button
      v-if="hasText"
      class="head"
      type="button"
      :aria-expanded="open"
      data-cy="thinking-toggle"
      @click="open = !open"
    >
      <span class="chevron">{{ open ? '▾' : '▸' }}</span>
      <span class="label">{{ label }}</span>
    </button>
    <!-- No words: the pill IS the whole statement, and it is not a button, because there is
         nothing behind it to open. -->
    <span v-else class="head static" data-cy="thinking-pill">
      <span class="dot" :class="{ live: item.streaming }"></span>
      <span class="label">{{ label }}</span>
    </span>

    <div v-if="open && hasText" class="body">
      <!-- ⚑ Hooked (237 §4). A live step asserts this sentence is here, and reading it off `.caption`
           made a stylesheet rename able to red a step with "the app misleads users about whose
           words these are". A `data-cy` is what a test is allowed to depend on. -->
      <p class="caption" data-cy="thinking-caption">
        summary of the reasoning — not the model's own words
      </p>
      <!-- eslint-disable-next-line vue/no-v-html -- markdown-it runs with `html: false`; see
           lib/markdown.ts. -->
      <div class="md-chat" data-cy="thinking-text" v-html="rendered"></div>
    </div>
  </div>
</template>

<style scoped>
.thinking {
  max-width: var(--measure-message);
  margin: 0 auto var(--space-6);
  /* The message column: the avatar tile and the gap after it, as AssistantMessage lays them out. */
  padding-left: calc(var(--avatar-small) + var(--space-6));
}

.head {
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--faint);
  font-size: var(--type-caption);
  gap: var(--space-3);
}

.head:not(.static):hover {
  color: var(--muted);
}

.chevron {
  width: 8px;
  font-size: var(--type-caption);
}

/* The dot carries the state-colour grammar: accent while it is still thinking, quiet once done. */
.dot {
  width: 5px;
  height: 5px;
  border-radius: var(--radius-pill);
  background: var(--faint);
}

.dot.live {
  animation: pulse 1.4s ease-in-out infinite;
  background: var(--accent);
  box-shadow: var(--accent-glow);
}

.body {
  margin-top: var(--space-3);
  padding: var(--space-4) var(--space-5);
  border-left: var(--border-accent-width) solid var(--line-strong);
  color: var(--muted);
  font-size: var(--type-small);
  line-height: var(--leading-relaxed);
}

.caption {
  margin: 0 0 var(--space-3);
  color: var(--faint);
  font-size: var(--type-caption);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.35;
  }
}
</style>
