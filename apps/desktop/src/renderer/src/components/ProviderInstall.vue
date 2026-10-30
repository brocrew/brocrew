<script setup lang="ts">
import { ref } from 'vue'
defineProps<{
  tool: string
  busy: boolean
  progress: string
  error: string | null
  details: string | null
  docs: string
}>()
const message = ref<HTMLElement | null>(null)
defineExpose({ focus: () => message.value?.focus() })
const emit = defineEmits<{ install: []; cancel: [] }>()
</script>

<template>
  <section class="provider-install" :aria-busy="busy" data-cy="provider-install">
    <p v-if="!busy" ref="message" tabindex="-1" class="line" data-cy="install-missing">
      {{ tool }} isn’t installed.
    </p>
    <div class="install-actions">
      <button
        type="button"
        class="bb-button bb-button--primary"
        :disabled="busy"
        data-cy="install-program"
        @click="emit('install')"
      >
        {{ busy ? `Installing ${tool}…` : `Install ${tool}` }}
      </button>
      <button
        v-if="busy"
        type="button"
        class="bb-button bb-button--quiet"
        data-cy="install-cancel"
        @click="emit('cancel')"
      >
        Cancel
      </button>
    </div>
    <p
      v-if="progress && !error"
      class="line"
      role="status"
      aria-live="polite"
      data-cy="install-progress"
    >
      {{ progress }}
    </p>
    <template v-if="error">
      <div class="bb-notice bb-notice--waiting" role="alert" data-cy="install-failure">
        <p class="line">{{ error }}</p>
        <pre v-if="details" data-cy="install-error-output">{{ details }}</pre>
      </div>
      <a class="bb-button" :href="docs" target="_blank" rel="noopener" data-cy="install-help">
        How to install
      </a>
    </template>
  </section>
</template>

<style scoped>
.provider-install {
  display: grid;
  min-width: 0;
  gap: var(--space-5);
  padding-block: var(--space-5);
  color: var(--text);
}
.provider-install .line {
  margin: 0;
}
.install-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}
.provider-install > a {
  justify-self: start;
}
.provider-install pre {
  max-height: calc(var(--space-32) * 3);
  overflow: auto;
  margin: var(--space-4) 0 0;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: var(--type-caption);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
}
</style>
