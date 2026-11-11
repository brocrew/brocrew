<script setup lang="ts">
import { computed } from 'vue'
import { renderChatMarkdown } from '../lib/markdown'
import { documentClicked, documentsNamedIn } from '../lib/the-documents-a-reply-names'
import { useClientMessagePaths, usePathsIn, type PathsHere } from '../composables/useMessagePaths'

const props = defineProps<{
  text: string
  lead?: string
  paths?: PathsHere | null
  sessionId?: string
  documents?: readonly string[]
}>()
const emit = defineEmits<{ openDocument: [resourceId: string] }>()
const here = useClientMessagePaths(
  () => props.sessionId ?? null,
  () => !props.paths && !!props.sessionId,
)
const html = computed(() => renderChatMarkdown(props.text, props.lead).trimEnd())
const paths = usePathsIn(
  () => props.paths ?? here.value,
  () => [html.value],
)
const rendered = computed(() => paths.mark(documentsNamedIn(html.value, props.documents ?? [])))

function clicked(event: MouseEvent): void {
  const resource = documentClicked(event.target)
  if (resource === null) return paths.clicked(event)
  event.preventDefault()
  emit('openDocument', resource)
}
</script>

<template>
  <div class="markdown-words" @click="clicked">
    <!-- eslint-disable-next-line vue/no-v-html -- the shared chat renderer disables author HTML. -->
    <div class="md-chat" v-html="rendered"></div>
    <p
      v-if="paths.failure.value"
      class="message-path-failure"
      role="status"
      data-cy="message-path-failure"
    >
      {{ paths.failure.value }}
    </p>
  </div>
</template>

<style scoped>
.markdown-words {
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
  white-space: normal;
}

.md-chat {
  white-space: normal;
}
</style>
