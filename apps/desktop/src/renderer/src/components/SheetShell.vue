<script setup lang="ts">
defineProps<{ glyph: string }>()
defineEmits<{ close: [] }>()
</script>

<template>
  <section class="sheet-shell">
    <div class="sheet-header">
      <div class="sheet-glyph">{{ glyph }}</div>
      <div class="sheet-header-copy"><slot name="header" /></div>
      <span class="spacer"></span>
      <button
        class="icon-button"
        type="button"
        aria-label="Close"
        data-cy="close-overlay"
        @click="$emit('close')"
      >
        <svg class="icon"><use href="#i-x" /></svg>
      </button>
    </div>
    <slot name="state" />
    <div v-if="$slots.body" class="sheet-body"><slot name="body" /></div>
    <div v-if="$slots.actions" class="sheet-actions"><slot name="actions" /></div>
    <slot name="footer" />
  </section>
</template>

<style scoped>
.sheet-shell {
  --sheet-width: 560px;
  --sheet-max-height: 88vh;
  --sheet-body-min-height: 0;
  --sheet-body-padding: var(--space-8) var(--space-9);

  display: flex;
  width: min(var(--sheet-width, 560px), 92vw);
  max-height: var(--sheet-max-height, 88vh);
  flex-direction: column;
  overflow: hidden;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-lg);
  background: var(--panel);
  box-shadow: var(--shadow);
}

.sheet-header {
  display: flex;
  min-height: var(--surface-header-h);
  flex: 0 0 auto;
  align-items: center;
  padding: var(--space-5) var(--space-7) var(--space-5) var(--space-9);
  border-bottom: var(--border-width) solid var(--line);
  gap: var(--space-6);
}

.sheet-glyph {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-md);
  background: var(--panel-2);
  color: var(--muted);
  font: var(--fw-bold) var(--type-caption) / 1 var(--font-mono);
  place-items: center;
}

.sheet-header-copy :deep(strong) {
  display: block;
  color: var(--text);
  font-size: var(--type-body);
  font-weight: var(--fw-bold);
}

.sheet-header-copy :deep(small) {
  display: block;
  margin-top: var(--space-2);
  color: var(--muted);
  font-size: var(--type-caption);
}

.sheet-header .spacer,
.sheet-actions :deep(.spacer) {
  flex: 1;
}

.icon-button {
  display: grid;
  width: 30px;
  height: 30px;
  padding: 0;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-md);
  background: var(--wash-2);
  color: var(--muted);
  place-items: center;
}

.sheet-body {
  display: flex;
  min-height: var(--sheet-body-min-height, 0);
  flex-direction: column;
  padding: var(--sheet-body-padding, var(--space-8) var(--space-9));
  overflow-y: auto;
  gap: var(--space-7);
}

.sheet-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: flex-end;
  padding: var(--space-6) var(--space-9);
  border-top: var(--border-width) solid var(--line);
  gap: var(--space-4);
}

.sheet-actions :deep(button) {
  padding: var(--space-4) var(--space-7);
  font-size: var(--type-caption);
}

.icon {
  width: 14px;
  height: 14px;
}
</style>
