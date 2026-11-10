import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import {
  VOICE_ERRORS,
  appendDictation,
  isVoiceSettingsPane,
  type VoiceBridge,
  type VoiceError,
  type VoicePhase,
} from '../../../shared/voice'

export function useVoiceInput(options: {
  bridge: VoiceBridge | undefined
  draft: Ref<string>
  identity: () => object
  allowed: () => boolean
}) {
  const phase = ref<VoicePhase | 'idle' | 'error'>('idle')
  const failure = ref<VoiceError | null>(null)
  const error = computed(() => (failure.value ? VOICE_ERRORS[failure.value] : ''))
  /** The System Settings pane that fixes the current error, if one does. */
  const settingsPane = computed(() => (isVoiceSettingsPane(failure.value) ? failure.value : null))
  const version = ref(0)
  const active = computed(() => phase.value !== 'idle' && phase.value !== 'error')
  let current: { id: string; identity: object; release: () => void } | undefined
  const cancel = (): void => {
    const request = current
    current = undefined
    phase.value = 'idle'
    request?.release()
    if (request) void options.bridge?.cancel(request.id).catch(() => undefined)
  }
  const start = async (): Promise<void> => {
    const bridge = options.bridge
    if (!bridge?.supported || active.value || !options.allowed()) return
    version.value += 1
    failure.value = null
    phase.value = 'permission'
    const request = { id: crypto.randomUUID(), identity: options.identity(), release: () => {} }
    current = request
    request.release = bridge.onState((state) => {
      if (current !== request || state.id !== request.id) return
      phase.value = state.phase
    })
    try {
      const result = await bridge.start(request.id)
      if (current !== request || options.identity() !== request.identity || !options.allowed())
        return
      if (result.ok) {
        options.draft.value = appendDictation(options.draft.value, result.text)
        phase.value = 'idle'
      } else {
        failure.value = Object.hasOwn(VOICE_ERRORS, result.error) ? result.error : 'protocol'
        phase.value = error.value ? 'error' : 'idle'
      }
    } catch {
      if (current === request) {
        failure.value = 'unavailable'
        phase.value = 'error'
      }
    } finally {
      request.release()
      if (current === request) {
        current = undefined
      }
    }
  }
  function stop(): void {
    if (!current || phase.value !== 'listening') return
    phase.value = 'transcribing'
    void options.bridge?.stop(current.id).catch(() => cancel())
  }
  function dismiss(): void {
    failure.value = null
    if (phase.value === 'error') phase.value = 'idle'
  }
  function openSettings(): void {
    const pane = settingsPane.value
    if (pane) void options.bridge?.openSettings(pane).catch(() => undefined)
  }
  watch(
    [options.identity, options.allowed],
    ([identity, allowed], [previousIdentity]) => {
      if (identity !== previousIdentity) {
        cancel()
        dismiss()
      } else if (current && !allowed) cancel()
    },
    { flush: 'sync' },
  )
  onBeforeUnmount(cancel)
  return {
    phase,
    error,
    settingsPane,
    active,
    version,
    start,
    stop,
    cancel,
    dismiss,
    openSettings,
  }
}
