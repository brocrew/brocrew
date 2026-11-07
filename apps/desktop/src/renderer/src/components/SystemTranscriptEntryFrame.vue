<template>
  <article class="msg app">
    <div class="msg-avatar">
      <svg class="icon"><use href="#i-bot" /></svg>
    </div>
    <div class="msg-column">
      <div class="msg-meta"><slot name="meta" /></div>
      <slot />
    </div>
  </article>
</template>

<style scoped>
.msg {
  display: grid;
  max-width: var(--measure-message);
  margin: 0 auto var(--space-10);
  gap: var(--space-5);
  grid-template-columns: var(--avatar) minmax(0, 1fr);
}

.msg-column {
  min-width: 0;
}

.msg-avatar {
  display: grid;
  width: var(--avatar);
  height: var(--avatar);
  border: var(--border-width) dashed var(--line-strong);
  border-radius: var(--radius-md);
  background: var(--wash-2);
  color: var(--muted);
  place-items: center;
}

.msg-avatar .icon {
  width: 15px;
  height: 15px;
}

.msg-meta {
  display: flex;
  height: 22px;
  align-items: center;
  color: var(--muted);
  font-size: var(--type-caption);
  gap: var(--space-4);
}

.msg-meta :deep(strong) {
  color: var(--text-soft);
  font-size: var(--type-small);
  font-weight: var(--fw-bold);
}

:deep(.system-entry-mark) {
  color: var(--faint);
  font-size: var(--type-caption);
}

:deep(.time) {
  margin-left: auto;
  color: var(--faint);
  font: var(--type-caption) / 1 var(--font-mono);
  opacity: 0.55;
  transition: opacity var(--dur-fast) ease;
}

.msg:hover :deep(.time) {
  opacity: 1;
}

:deep(.msg-body) {
  padding-top: var(--space-2);
  color: var(--text-soft);
  font-size: var(--type-reading);
  line-height: var(--leading-reading);
  white-space: pre-wrap;
}
</style>
