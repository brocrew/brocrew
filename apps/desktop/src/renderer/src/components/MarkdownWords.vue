<script setup lang="ts">
import { computed } from 'vue'
import { renderChatMarkdown } from '../lib/markdown'
import { documentClicked, documentsNamedIn } from '../lib/the-documents-a-reply-names'
import { useClientMessagePaths, usePathsIn, type PathsHere } from '../composables/useMessagePaths'

const props = defineProps<{
  text: string
  compact?: boolean
  streaming?: boolean
  lead?: string
  paths?: PathsHere | null
  sessionId?: string
  documents?: readonly string[]
}>()
const emit = defineEmits<{ openDocument: [resourceId: string] }>()
const here = useClientMessagePaths(
  () => props.sessionId ?? null,
  () => !props.streaming && !props.paths && !!props.sessionId,
)
const html = computed(() => renderChatMarkdown(props.text, props.lead, props.streaming).trimEnd())
const paths = usePathsIn(
  () => (props.streaming ? null : (props.paths ?? here.value)),
  () => [html.value],
)
const rendered = computed(() =>
  props.streaming ? html.value : paths.mark(documentsNamedIn(html.value, props.documents ?? [])),
)

function clicked(event: MouseEvent): void {
  // Links keep their own action when these words are inside a navigable preview.
  if (event.target instanceof Element && event.target.closest('.md-chat a, .md-chat button'))
    event.stopPropagation()
  const resource = documentClicked(event.target)
  if (resource === null) return paths.clicked(event)
  event.preventDefault()
  emit('openDocument', resource)
}
</script>

<template>
  <div class="markdown-words" :class="{ compact }" @click="clicked">
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

.markdown-words.compact .md-chat,
.markdown-words.compact :deep(.md-chat :is(p, pre, ul, ol, li, blockquote, hr)),
.markdown-words.compact :deep(.md-chat :is(h1, h2, h3, h4, h5, h6)),
.markdown-words.compact :deep(.md-chat :is(table, thead, tbody, tr, th, td)) {
  display: inline;
}

.markdown-words.compact,
.markdown-words.compact .md-chat,
.markdown-words.compact :deep(.md-chat *) {
  white-space: nowrap;
}

.markdown-words.compact :deep(br) {
  display: none;
}
</style>
