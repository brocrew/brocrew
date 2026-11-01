import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import {
  VOICE_CAPTURE_SECONDS,
  VOICE_ERRORS,
  appendDictation,
  type VoiceBridge,
  type VoicePhase,
} from '../../../shared/voice'

export function useVoiceInput(options: {
  bridge: VoiceBridge | undefined
  draft: Ref<string>
  identity: () => object
  allowed: () => boolean
}) {
  const phase = ref<VoicePhase | 'idle' | 'error'>('idle')
  const error = ref('')
  const remaining = ref(VOICE_CAPTURE_SECONDS)
  const active = computed(() => phase.value !== 'idle' && phase.value !== 'error')
  let current: { id: string; identity: object; release: () => void } | undefined
  let ticker: ReturnType<typeof setInterval> | undefined
  const clearTicker = (): void => {
    clearInterval(ticker)
    ticker = undefined
  }
  const cancel = (): void => {
    const request = current
    current = undefined
    clearTicker()
    phase.value = 'idle'
    request?.release()
    if (request) void options.bridge?.cancel(request.id).catch(() => undefined)
  }
  const start = async (): Promise<void> => {
    const bridge = options.bridge
    if (!bridge?.supported || active.value || !options.allowed()) return
    error.value = ''
    remaining.value = VOICE_CAPTURE_SECONDS
    phase.value = 'permission'
    const request = { id: crypto.randomUUID(), identity: options.identity(), release: () => {} }
    current = request
    request.release = bridge.onState((state) => {
      if (current !== request || state.id !== request.id) return
      phase.value = state.phase
      clearTicker()
      if (state.phase === 'listening') {
        const until = Date.now() + VOICE_CAPTURE_SECONDS * 1_000
        ticker = setInterval(() => {
          remaining.value = Math.max(0, Math.ceil((until - Date.now()) / 1_000))
          if (remaining.value === 0) stop()
        }, 200)
      }
    })
    try {
      const result = await bridge.start(request.id)
      if (current !== request || options.identity() !== request.identity || !options.allowed())
        return
      if (result.ok) {
        options.draft.value = appendDictation(options.draft.value, result.text)
        phase.value = 'idle'
      } else {
        error.value = VOICE_ERRORS[result.error] ?? VOICE_ERRORS.protocol
        phase.value = error.value ? 'error' : 'idle'
      }
    } catch {
      if (current === request) {
        error.value = VOICE_ERRORS.unavailable
        phase.value = 'error'
      }
    } finally {
      request.release()
      if (current === request) {
        current = undefined
        clearTicker()
      }
    }
  }
  function stop(): void {
    if (!current || phase.value !== 'listening') return
    phase.value = 'transcribing'
    clearTicker()
    void options.bridge?.stop(current.id).catch(() => cancel())
  }
  watch(
    [options.identity, options.allowed],
    ([identity, allowed], [previousIdentity]) => {
      if (identity !== previousIdentity) {
        cancel()
        error.value = ''
      } else if (current && !allowed) cancel()
    },
    { flush: 'sync' },
  )
  onBeforeUnmount(cancel)
  return { phase, error, remaining, active, start, stop, cancel }
}
