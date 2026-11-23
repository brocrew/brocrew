<script setup lang="ts">
import type { Provider } from '@brobot2/shared'
import { useProviderLabel } from '../composables/useProviderLabel'

/** A provider's name, drawn the one way the window draws it. */
const props = defineProps<{ provider: Provider }>()
const label = useProviderLabel()
</script>

<template>
  <span class="provider-label" :data-provider="props.provider">{{ label(props.provider) }}</span>
</template>
