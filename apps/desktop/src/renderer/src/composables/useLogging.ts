import { onMounted, ref } from 'vue'
import type { LoggingState } from '../../../shared/logging'

export function useLogging(bridge = globalThis.window?.api?.logging) {
  const state = ref<LoggingState | null>(null)
  const saving = ref(false)
  const error = ref('')

  async function load(): Promise<void> {
    error.value = ''
    if (!bridge) {
      error.value = 'Logging is not available in this window.'
      return
    }
    try {
      state.value = await bridge.getLogging()
    } catch {
      error.value = 'Could not read the logging setting. Try again.'
    }
  }
  onMounted(load)

  async function save(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement
    if (!bridge || !state.value || saving.value) return
    saving.value = true
    error.value = ''
    try {
      state.value = await bridge.setLoggingDebug(input.checked)
    } catch {
      error.value = 'Could not save the logging setting. Try again.'
    } finally {
      input.checked = state.value?.debug ?? false
      saving.value = false
    }
  }

  return { state, saving, error, load, save }
}
