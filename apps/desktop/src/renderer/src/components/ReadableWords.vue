<script setup lang="ts">
/**
 * ⚑ **The Readable view of words that carry JSON** — the words as written, and each JSON value found
 * in them drawn indented, in the monospace face the tool-answer viewer draws JSON in
 * (`lib/words-with-json.ts`). ⛔ Never the Raw view: that one is the card's own body, exactly as sent.
 *
 * ⚠️ **The words beside a block lose the spaces and line breaks that touch it** — the block is its own
 * line already — and only here: the Raw view keeps every character.
 */
import { computed } from 'vue'
import MarkdownWords from './MarkdownWords.vue'
import type { WordsPart } from '../lib/words-with-json'

const props = defineProps<{ parts: readonly WordsPart[]; markdown?: boolean }>()

const drawn = computed(() =>
  props.parts.flatMap((part, index): WordsPart[] => {
    if (part.kind === 'json') return [part]
    const before = props.parts[index - 1]?.kind === 'json'
    const after = props.parts[index + 1]?.kind === 'json'
    let text = part.text
    if (before) text = text.trimStart()
    if (after) text = text.trimEnd()
    return text === '' ? [] : [{ kind: 'words', text }]
  }),
)
</script>

<template>
  <div class="readable">
    <template v-for="(part, index) in drawn" :key="index">
      <pre v-if="part.kind === 'json'" class="json" data-cy="words-json">{{ part.pretty }}</pre>
      <MarkdownWords v-else-if="markdown" :text="part.text" />
      <p v-else class="words">{{ part.text }}</p>
    </template>
  </div>
</template>

<style scoped>
.readable {
  display: grid;
  gap: var(--space-3);
}

.words {
  margin: 0;
  white-space: pre-wrap;
}

/* ⚑ `ToolAnswerViewer`'s `.part-body.json` face, on a quiet well so the block reads as data. */
.json {
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-xs);
  background: var(--wash-2);
  color: var(--text-soft);
  font: var(--type-caption) / 1.6 var(--font-mono);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
</style>
