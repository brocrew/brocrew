<script setup lang="ts">
/**
 * Grey cards in the shape of the cards a list is about to show, while its first read is on its
 * way. No words on screen: a person sees that something is coming, and a screen reader hears
 * "Loading". An empty list and a list that could not be read are drawn by their page, never this.
 */
withDefaults(defineProps<{ count?: number }>(), { count: 2 })
</script>

<template>
  <ol class="loading-cards" aria-busy="true" data-cy="loading-cards">
    <li class="only-for-a-reader" role="status">Loading</li>
    <li v-for="index in count" :key="index" class="loading-card" aria-hidden="true">
      <span class="face"></span>
      <span class="lines">
        <span class="line who"></span>
        <span class="line one"></span>
        <span class="line rest"></span>
        <span class="foot">
          <span class="block"></span>
          <span class="block"></span>
        </span>
      </span>
    </li>
  </ol>
</template>

<style scoped>
.loading-cards {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  gap: var(--space-6);
  list-style: none;
}

.loading-card {
  display: flex;
  padding: var(--card-padding);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-card);
  background: var(--panel);
  gap: var(--space-7);
}

/* The Themes page's placeholder fill, so every grey block in the app is one grey. */
.face,
.line,
.block {
  background: var(--line);
  opacity: 0.35;
}

.face {
  width: var(--avatar-small);
  height: var(--avatar-small);
  flex: none;
  border-radius: var(--radius-pill);
}

.lines {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--space-4);
}

.line {
  height: var(--space-6);
  border-radius: var(--radius-2xs);
}

.who {
  width: 30%;
}

.one {
  width: 70%;
  height: var(--space-9);
}

.rest {
  width: 55%;
}

.foot {
  display: flex;
  margin-top: var(--space-2);
  gap: var(--space-4);
}

.block {
  width: 88px;
  height: var(--control-h);
  border-radius: var(--radius-sm);
}

.only-for-a-reader {
  position: absolute;
  overflow: hidden;
  width: 1px;
  height: 1px;
  padding: 0;
  border: 0;
  margin: -1px;
  clip-path: inset(50%);
}
</style>
