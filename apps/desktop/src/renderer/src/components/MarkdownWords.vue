<script setup lang="ts">
import { computed } from 'vue'
import { renderChatMarkdown } from '../lib/markdown'
import type { PathsInAMessage } from '../composables/useMessagePaths'
const props = defineProps<{ text: string; found?: PathsInAMessage | null }>()
const rendered = computed(() => {
  const html = renderChatMarkdown(props.text).trimEnd()
  return props.found?.mark(html) ?? html
})
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- the shared chat renderer disables author HTML. -->
  <div class="md-chat" v-html="rendered"></div>
</template>

<style scoped>
.md-chat {
  white-space: normal;
}
</style>
