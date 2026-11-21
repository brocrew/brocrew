import type { DatabaseMemory } from './database-memory'

export const WORKER_MEMORY_INTERVAL_MS = 30_000
export const WORKER_MEMORY_CONNECTIONS = 32
// Six header scalars, then role/generation/setting/availability for each connection: 1,072 bytes.
export const WORKER_MEMORY_BYTES = (6 + WORKER_MEMORY_CONNECTIONS * 4) * 8
export interface WorkerMemorySample {
  at: number
  heapUsed: number
  heapTotal: number
  connections: DatabaseMemory[]
  omitted: number
}

export function writeWorkerMemory(
  record: BigInt64Array,
  heap: { heapUsed: number; heapTotal: number },
  connections: readonly DatabaseMemory[],
  at = Date.now(),
): void {
  const complete = (Atomics.load(record, 0) | 1n) + 1n
  Atomics.store(record, 0, complete - 1n)
  const values = [
    at,
    heap.heapUsed,
    heap.heapTotal,
    Math.min(connections.length, WORKER_MEMORY_CONNECTIONS),
    Math.max(0, connections.length - WORKER_MEMORY_CONNECTIONS),
  ]
  values.forEach((value, index) => Atomics.store(record, index + 1, BigInt(value)))
  connections.slice(0, WORKER_MEMORY_CONNECTIONS).forEach((row, index) => {
    const offset = 6 + index * 4
    ;[row.role, row.generation, row.cacheSize ?? 0, row.cacheSize === null ? 0 : 1].forEach(
      (value, field) => Atomics.store(record, offset + field, BigInt(value)),
    )
  })
  Atomics.store(record, 0, complete)
}

/** A busy publisher is reported unavailable rather than waited for. */
export function readWorkerMemory(record: BigInt64Array): WorkerMemorySample | null {
  const before = Atomics.load(record, 0)
  if (before === 0n || before % 2n !== 0n) return null
  const at = Number(Atomics.load(record, 1))
  const heapUsed = Number(Atomics.load(record, 2))
  const heapTotal = Number(Atomics.load(record, 3))
  const count = Number(Atomics.load(record, 4))
  const omitted = Number(Atomics.load(record, 5))
  const connections = Array.from({ length: count }, (_, index) => {
    const offset = 6 + index * 4
    return {
      role: Number(Atomics.load(record, offset)),
      generation: Number(Atomics.load(record, offset + 1)),
      cacheSize:
        Atomics.load(record, offset + 3) === 0n ? null : Number(Atomics.load(record, offset + 2)),
    }
  })
  return before === Atomics.load(record, 0)
    ? { at, heapUsed, heapTotal, connections, omitted }
    : null
}
