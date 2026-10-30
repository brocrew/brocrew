<script setup lang="ts">
defineProps<{ progress: string; authUrl: string | null; error: string | null }>()
</script>

<template>
  <div class="native-progress" data-cy="native-setup-progress">
    <p v-if="progress && !error" class="line" role="status" aria-live="polite">{{ progress }}</p>
    <a
      v-if="authUrl"
      class="bb-button"
      :href="authUrl"
      target="_blank"
      rel="noopener"
      data-cy="native-sign-in-link"
      >Open sign-in page</a
    >
    <p v-if="error" class="line warn" role="alert" data-cy="native-sign-in-error">{{ error }}</p>
  </div>
</template>

<style scoped>
.native-progress {
  display: grid;
  min-width: 0;
  gap: var(--space-3);
}
.native-progress .line {
  margin: 0;
}
.native-progress a {
  justify-self: start;
}
</style>
