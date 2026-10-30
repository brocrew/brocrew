<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { RetainedRecoveryCopy } from '../../../shared/recovery-retention'
import { fullTime } from '../lib/clock'

const bridge = window.api?.recoveryRetention
const copy = ref<RetainedRecoveryCopy | null>(null)
const loaded = ref(false)
const busy = ref(false)
const status = ref('')
const confirming = ref(false)
const size = computed(() => {
  const bytes = copy.value?.bytes ?? 0
  return bytes >= 1e9
    ? `${(bytes / 1e9).toFixed(1)} GB`
    : `${Math.max(1, Math.round(bytes / 1e6))} MB`
})
const expiry = computed(() => (copy.value ? fullTime(Date.parse(copy.value.expiresAt)) : ''))
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
  if (!bridge || busy.value || !copy.value || !confirming.value) return
  busy.value = true
  status.value = ''
  try {
    await bridge.deleteNow(copy.value.id)
    copy.value = await bridge.read()
  } catch {
    status.value = "Couldn't delete the recovery copy. Try again."
  } finally {
    busy.value = false
    confirming.value = false
  }
}
</script>

<template>
  <section class="setting-card" data-cy="recovery-retention">
    <div class="setting-copy">
      <h2>Recovery copy</h2>
      <p v-if="copy">
        {{ size }}, made before the update to {{ copy.appVersion }}. Deleted on {{ expiry }}, or
        sooner after {{ copy.startsLeft }} more successful
        {{ copy.startsLeft === 1 ? 'start' : 'starts' }}.
      </p>
      <p v-else-if="loaded">No recovery copy kept.</p>
      <p v-else-if="!status">Reading recovery copy…</p>
      <p v-if="status" role="status">{{ status }}</p>
    </div>
    <button
      v-if="copy && !confirming"
      class="bb-button"
      type="button"
      data-cy="recovery-delete"
      @click="confirming = true"
    >
      Delete now
    </button>
    <div
      v-if="copy && confirming"
      role="alertdialog"
      aria-label="Delete recovery copy"
      class="recovery-confirmation"
      data-cy="recovery-delete-confirmation"
    >
      <p>Delete the recovery copy? You can't go back to the earlier version after this.</p>
      <button
        class="bb-button"
        type="button"
        data-cy="recovery-delete-confirm"
        :disabled="busy"
        @click="deleteNow"
      >
        Delete now
      </button>
      <button
        class="bb-button"
        type="button"
        data-cy="recovery-delete-cancel"
        :disabled="busy"
        @click="confirming = false"
      >
        Cancel
      </button>
    </div>
  </section>
</template>

<style scoped>
.setting-card {
  flex-wrap: wrap;
}
.setting-copy {
  flex: 1;
  min-width: 0;
}
.setting-copy h2 {
  margin: 0 0 var(--space-3);
  font-size: var(--type-body);
  font-weight: var(--fw-semibold);
}
.setting-copy p,
.recovery-confirmation p {
  margin: 0;
  color: var(--muted);
  font-size: var(--type-small);
  line-height: var(--leading-relaxed);
}
.recovery-confirmation {
  flex-basis: 100%;
}
.recovery-confirmation button {
  margin-top: var(--space-4);
  margin-right: var(--space-4);
}
</style>
