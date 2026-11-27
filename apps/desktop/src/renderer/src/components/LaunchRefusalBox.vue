<script setup lang="ts">
/** The box both launch surfaces show when the host refuses a launch, with the host's own words. */
defineProps<{
  error: string
  /** The test hook on the sentence, which each surface already names. */
  textCy: string
}>()
</script>

<template>
  <div class="blocker" role="alert">
    <p class="b-head">
      <svg class="icon"><use href="#i-alert" /></svg>The launch didn’t start
    </p>
    <p class="b-body" :data-cy="textCy">{{ error }}</p>
  </div>
</template>

<style scoped>
.blocker {
  padding: var(--space-4) var(--space-5);
  border: var(--border-width) solid var(--danger-border);
  border-radius: var(--radius-sm);
  background: var(--danger-bg);
  text-align: left;
}

.b-head {
  display: flex;
  align-items: center;
  margin: 0;
  color: var(--danger-text);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
  gap: var(--space-3);
}

.b-head .icon {
  width: 13px;
  height: 13px;
  color: var(--danger);
}

.b-body {
  margin: var(--space-2) 0 0;
  color: var(--danger-text-notice);
  font-size: var(--type-caption);
  line-height: var(--leading-normal);
}
</style>
