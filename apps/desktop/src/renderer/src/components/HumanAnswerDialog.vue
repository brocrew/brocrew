<script setup lang="ts">
import type { HumanTurnAnswer } from '../../../shared/human-turn-answer'
import MarkdownWords from './MarkdownWords.vue'
import OverlayHost from './OverlayHost.vue'

defineProps<{ answer: HumanTurnAnswer }>()
defineEmits<{ close: [] }>()
</script>

<template>
  <OverlayHost label="Answer to you" @close="$emit('close')">
    <section class="answer-dialog" data-cy="human-answer-dialog">
      <header>
        <h2>Answer to you</h2>
        <button type="button" class="btn" @click="$emit('close')">Close</button>
      </header>
      <div class="answer-scroll">
        <h3>You asked</h3>
        <MarkdownWords data-cy="human-answer-prompt" :text="answer.prompt" />
        <h3>Final answer</h3>
        <MarkdownWords data-cy="human-answer-final" :text="answer.final?.text ?? ''" />
      </div>
    </section>
  </OverlayHost>
</template>

<style scoped>
.answer-dialog {
  width: min(760px, calc(100% - 2 * var(--lane-clear)));
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  padding: 20px;
  color: var(--text);
  background: var(--panel);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
h2 {
  font-size: var(--type-heading);
  margin: 0;
}
h3 {
  font-size: var(--type-small);
  margin: 24px 0 12px;
  color: var(--text);
}
.answer-scroll {
  min-height: 0;
  overflow: auto;
  overflow-wrap: anywhere;
  color: var(--text-soft);
}
</style>
