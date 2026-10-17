<script setup lang="ts">
import { computed } from 'vue'
import type { PathsInAMessage } from '../composables/useMessagePaths'
import { personMessageParts } from '../lib/plain-message-links'
import PathsInText from './PathsInText.vue'

const props = defineProps<{ text: string; found: PathsInAMessage }>()
const parts = computed(() => personMessageParts(props.text))
</script>

<template>
  <template v-for="(part, index) in parts" :key="`${index}:${part.label ? part.text : ''}`">
    <button
      v-if="part.label"
      type="button"
      role="link"
      class="message-link"
      data-cy="message-link"
      data-person-link
      title=""
      :data-brocrew-target="part.text"
    >
      <svg class="icon message-link-indicator" role="img" aria-label="Conversation link">
        <use href="#i-chat" /></svg
      >{{ part.text }}
    </button>
    <PathsInText v-else :text="part.text" :found="found" />
  </template>
</template>
