<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { RetainedRecoveryCopy } from '../../../shared/recovery-retention'

const bridge = window.api?.recoveryRetention
const copy = ref<RetainedRecoveryCopy | null>(null)
const loaded = ref(false)
const busy = ref(false)
const status = ref('')
const size = computed(() => {
  const bytes = copy.value?.bytes ?? 0
  return bytes >= 1e9
    ? `${(bytes / 1e9).toFixed(1)} GB`
    : `${Math.max(1, Math.round(bytes / 1e6))} MB`
})
const expiry = computed(() => (copy.value ? new Date(copy.value.expiresAt).toLocaleString() : ''))
onMounted(async () => {
  if (!bridge) return
  try {
    copy.value = await bridge.read()
    loaded.value = true
  } catch {
    status.value = "That didn't work. Try again."
  }
})
async function deleteNow(): Promise<void> {
  if (!bridge || busy.value || !copy.value) return
  busy.value = true
  status.value = ''
  try {
    await bridge.deleteNow(copy.value.id)
    copy.value = await bridge.read()
  } catch {
    status.value = "That didn't work. Try again."
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="setting-card" data-cy="recovery-retention">
    <div class="setting-copy">
      <h2>Recovery copy</h2>
      <p v-if="copy">
        {{ size }}. Deletes on {{ expiry }} or after {{ copy.startsLeft }} more successful
        {{ copy.startsLeft === 1 ? 'start' : 'starts' }}, whichever comes first.
      </p>
      <p v-else-if="loaded">No recovery copy kept.</p>
      <p v-else-if="!status">Reading recovery copy…</p>
      <p v-if="status" role="status">{{ status }}</p>
    </div>
    <button v-if="copy" type="button" data-cy="recovery-delete" :disabled="busy" @click="deleteNow">
      Delete now
    </button>
  </section>
</template>
