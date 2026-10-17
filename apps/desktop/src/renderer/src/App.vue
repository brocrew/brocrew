<script lang="ts">
/**
 * Subscribe to the main process's closing announcement. Export the subscription from the
 * plain script block so it can be tested without a window or preload; setup owns only
 * the ref and lifecycle hooks.
 *
 * Both optional checks matter: SSR and DOM tests may have no `window.api`, and an older
 * preload may lack `onClosing`. Neither should fail mounting for a shutdown-only message.
 *
 * @returns the unsubscribe, or a no-op when no subscription is available.
 */
export function watchClosing(onClosing: () => void): () => void {
  return window.api?.onClosing?.(onClosing) ?? ((): void => {})
}
</script>

<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import RuntimeScreen from './components/RuntimeScreen.vue'
import ClosingShade from './components/ClosingShade.vue'
import { appClosing, beginClosing } from './lib/app-closing'

/**
 * Mount the screen's own title bar, rail and surface, with {@link ClosingShade} outside
 * that frame so application shutdown covers all of it. The shared closing flag lives in
 * `lib/app-closing.ts`: list readers also need it to avoid queries after the database
 * closes. This component owns the one subscription to the main-process announcement.
 */
let stopWatching: (() => void) | undefined
onMounted(() => {
  stopWatching = watchClosing(beginClosing)
})
onBeforeUnmount(() => stopWatching?.())
</script>

<template>
  <RuntimeScreen />
  <ClosingShade v-if="appClosing" />
</template>
