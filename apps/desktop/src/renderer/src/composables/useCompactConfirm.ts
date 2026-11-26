import { computed, ref, watch } from 'vue'
import type { CapabilityStatus } from '../../../shared/runtime-ipc'
import { compactionOffer, offerHeading, type CompactionFacts } from '../lib/compaction-offer'

/**
 * One "Compact now…" confirm: the offer, whether its question is open, the question it asks, and
 * the answer. The press only opens the question; `compactIt` alone sends.
 */
export function useCompactConfirm(
  capability: () => CapabilityStatus | null,
  conversation: () => CompactionFacts | null,
  send: (intent: 'now' | 'queue') => void,
) {
  const offer = computed(() => compactionOffer(capability(), conversation()))
  const confirming = ref(false)
  // Shut whenever what the answer would do changes under the question: the offer withdrawn, or a
  // "now" that would become "after this turn". The person is asked again in the right words.
  watch(
    () => (offer.value.offered ? offer.value.intent : null),
    (intent, before) => {
      if (intent !== before) confirming.value = false
    },
  )
  const heading = computed(() => offerHeading(offer.value))

  function compactIt(): void {
    const now = offer.value
    // Read before the question is shut: an answer to no open question, or to a withdrawn offer,
    // sends nothing.
    const open = confirming.value
    confirming.value = false
    if (open && now.offered) send(now.intent)
  }

  return { offer, confirming, heading, compactIt }
}
