<script setup lang="ts">
import { runtimePathCalls, useMessagePaths, usePathsIn } from '../composables/useMessagePaths'
import { renderChatMarkdown } from '../lib/markdown'
import MarkdownWords from './MarkdownWords.vue'

const props = defineProps<{ text: string; sessionId?: string }>()
const here = useMessagePaths(
  () => props.sessionId ?? null,
  () => (props.sessionId ? runtimePathCalls() : null),
)
const paths = usePathsIn(
  () => here.value,
  () => [renderChatMarkdown(props.text)],
)
</script>

<template>
  <div class="request-markdown" @click="paths.clicked">
    <MarkdownWords :text="text" :found="paths" />
    <p v-if="paths.failure.value" class="message-path-failure" role="status">
      {{ paths.failure.value }}
    </p>
  </div>
</template>

<style scoped>
.request-markdown {
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
  white-space: normal;
}
</style>
