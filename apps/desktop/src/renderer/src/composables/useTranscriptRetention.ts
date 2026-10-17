import { onMounted, ref } from 'vue'
import type { TranscriptRetention } from '../../../shared/transcript-retention'

export function useTranscriptRetention(bridge = window.api?.transcriptRetention) {
  const period = ref<TranscriptRetention | null>(null)
  const saving = ref(false)
  const status = ref('')
  onMounted(async () => {
    if (!bridge) return
    try {
      period.value = await bridge.read()
    } catch {
      status.value = "That didn't work. Try again."
    }
  })
  const save = async (next: TranscriptRetention): Promise<void> => {
    if (!bridge || saving.value) return
    saving.value = true
    try {
      period.value = await bridge.set(next)
      status.value = ''
    } catch {
      status.value = "That didn't work. Try again."
    } finally {
      saving.value = false
    }
  }
  return { period, saving, status, save }
}
