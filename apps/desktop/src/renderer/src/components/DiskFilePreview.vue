<script setup lang="ts">
import { computed } from 'vue'
import { textViewFor } from '../../../shared/documents'
import DocumentBody from './DocumentBody.vue'

const props = defineProps<{
  file: { name: string; text: string; truncated: boolean }
}>()

const view = computed(() => textViewFor(props.file.name))
</script>

<template>
  <DocumentBody
    :source="file.text"
    :filename="file.name"
    :raw="view.raw"
    :source-only="view.sourceOnly"
    compact
  />
  <div v-if="file.truncated" class="cut">· cut at the size limit — this much was read</div>
</template>

<style scoped>
.cut {
  color: var(--waiting);
}
</style>
