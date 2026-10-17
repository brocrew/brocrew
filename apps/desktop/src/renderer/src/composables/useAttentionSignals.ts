import { onScopeDispose, watch, type Ref } from 'vue'
import type { AttentionSignal } from '../../../shared/attention-signals'
import { attentionSignalTracker, type AttentionPopulation } from '../lib/attention-signals'
import { usePersistentToggle } from './usePersistentToggle'

let shared: Ref<boolean> | null = null

/** A window preference, exposed for Settings; main only applies its native effects. */
export function useAttentionSignals(): Ref<boolean> {
  shared ??= usePersistentToggle('brobot2.attentionSignals', true)
  return shared
}

/** Uses the page's existing count and rows, with no additional host reads. */
export function syncAttentionSignals(
  reading: Readonly<Ref<{ count: number; populations: readonly AttentionPopulation[] }>>,
  send: (signal: AttentionSignal) => Promise<void>,
  enabled = useAttentionSignals(),
): void {
  const next = attentionSignalTracker()
  let last: AttentionSignal | null = null
  const publish = (signal: AttentionSignal): void => {
    if (
      last?.enabled === signal.enabled &&
      last.count === signal.count &&
      last.arrival === signal.arrival
    )
      return
    last = signal
    void send(signal).catch((error: unknown) => {
      if (last === signal) last = null
      console.warn('Attention signals could not update.', error)
    })
  }
  const stop = watch(
    () => [enabled.value, reading.value] as const,
    ([on, snapshot]) => publish(next(on, snapshot.count, snapshot.populations)),
    { immediate: true },
  )
  onScopeDispose(() => {
    stop()
    publish({ enabled: false, count: 0, arrival: last?.arrival ?? 0 })
  })
}
