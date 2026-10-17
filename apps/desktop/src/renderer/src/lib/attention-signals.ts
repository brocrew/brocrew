import { MAX_ATTENTION_ARRIVAL, type AttentionSignal } from '../../../shared/attention-signals'

export interface AttentionPopulation {
  readonly name: string
  readonly ready: boolean
  readonly keys: readonly string[]
}

// Shared by screen remounts in this document; a native reload starts a new replay baseline.
let documentArrival = 0

/** Baseline each list when it first answers: opening the app is not a newly arrived item. */
export function attentionSignalTracker(): (
  enabled: boolean,
  count: number,
  populations: readonly AttentionPopulation[],
) => AttentionSignal {
  const previous = new Map<string, ReadonlySet<string>>()
  let wasEnabled = false
  return (enabled, count, populations) => {
    const known = new Set([...previous.values()].flatMap((keys) => [...keys]))
    let added = false
    for (const population of populations) {
      if (!population.ready) continue
      if (previous.has(population.name) && population.keys.some((key) => !known.has(key))) {
        added = true
      }
      previous.set(population.name, new Set(population.keys))
    }
    if (enabled && wasEnabled && added) {
      documentArrival = Math.min(documentArrival + 1, MAX_ATTENTION_ARRIVAL)
    }
    wasEnabled = enabled
    return { enabled, count, arrival: documentArrival }
  }
}
