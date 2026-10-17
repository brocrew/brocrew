<script setup lang="ts">
import { computed } from 'vue'
import type { PathsInAMessage } from '../composables/useMessagePaths'

/**
 * Plain text, with the paths main found in it drawn as controls. Without a found path it is the
 * text exactly as `{{ }}` draws it.
 */
const props = defineProps<{
  text: string
  /** The message's paths; absent draws the plain text. */
  found?: PathsInAMessage | null
}>()

const marked = computed(() => props.found?.markText(props.text) ?? null)
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- the text is escaped before any control is added,
       and every value in a control is escaped too; see lib/the-paths-a-message-names.ts. -->
  <span v-if="marked !== null" class="paths-in-text" v-html="marked"></span>
  <template v-else>{{ text }}</template>
</template>
