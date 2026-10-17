import type { WorkerBindingReading } from '../shared/worker-reading'
import type { KeptProfileExecution } from './profile-execution-file'

/** Indexed when the kept file changes, so conversation listings need no new database reads. */
export function indexWorkerReadings(
  kept: KeptProfileExecution,
  replacements: ReadonlyMap<string, string> = new Map(),
  terminalOf?: (birth: string) => string | null,
): ReadonlyMap<string, WorkerBindingReading> {
  const readings = new Map<string, WorkerBindingReading>()
  const ambiguous = new Set<string>()
  for (const [identity, entry] of Object.entries(kept.profiles)) {
    if (entry.kind !== 'normal' || entry.retired === true) continue
    for (const pool of entry.workerPools ?? []) {
      if (pool.removing === true) continue
      for (const worker of pool.workers) {
        if (worker.phase !== 'bound') continue
        let id = terminalOf === undefined ? worker.conversation : terminalOf(worker.conversation)
        if (id === null) continue
        const seen = new Set<string>()
        while (terminalOf === undefined && replacements.has(id)) {
          if (seen.has(id) || seen.size >= 63) {
            id = ''
            break
          }
          seen.add(id)
          id = replacements.get(id)!
        }
        if (id === '') continue
        if (readings.has(id) || ambiguous.has(id)) {
          readings.delete(id)
          ambiguous.add(id)
          continue
        }
        readings.set(
          id,
          Object.freeze({
            identity,
            giver: pool.giver,
            number: worker.number,
            bornAs: worker.conversation,
          }),
        )
      }
    }
  }
  return readings
}

export function workerLine(profile: string, number: number): string {
  return number === 1 ? `Worker: ${profile}.` : `Worker: ${profile} (${number}).`
}
