import {
  MAX_NORMAL_WORKER_POOLS,
  MAX_NORMAL_WORKERS_PER_POOL,
  type NormalWorkerAssignment,
  type NormalWorkerBinding,
  type NormalWorkerPool,
  type ProfileExecution,
} from './profile-execution-file'

export type WorkerPoolRead =
  { readonly known: true; readonly pool: NormalWorkerPool | null } | { readonly known: false }

/** A replacement giver follows its existing pool; two matching pools are not merged. */
export function workerPoolFor(
  entry: ProfileExecution,
  giverLineage: readonly string[],
): WorkerPoolRead {
  if (entry.kind !== 'normal' || entry.retired === true) return { known: false }
  const found = (entry.workerPools ?? []).filter((pool) => giverLineage.includes(pool.giver))
  if (found.length > 1) return { known: false }
  return { known: true, pool: found[0] ?? null }
}

export type WorkerSelection =
  | { readonly kind: 'existing'; readonly worker: NormalWorkerBinding }
  | { readonly kind: 'start'; readonly number: number }
  | { readonly kind: 'full' }
  | { readonly kind: 'unknown' }

/** Ordinary work keeps the primary. Parallel work requires a positively free binding. */
export function selectNormalWorker(
  pool: NormalWorkerPool | null,
  parallel: boolean,
  free: (conversation: string) => boolean,
  leased: (conversation: string) => boolean,
): WorkerSelection {
  if (pool === null || (pool.workers.length === 0 && pool.nextNumber === 1))
    return { kind: 'start', number: 1 }
  const primary = pool.workers.find((worker) => worker.number === 1)
  if (primary === undefined && pool.primaryNeverBorn !== true) return { kind: 'unknown' }
  if (!parallel)
    return primary === undefined
      ? { kind: 'start', number: 1 }
      : { kind: 'existing', worker: primary }
  const worker = [...pool.workers]
    .sort((left, right) => left.number - right.number)
    .find(
      (one) =>
        one.phase === 'bound' &&
        one.assignment === undefined &&
        !leased(one.conversation) &&
        free(one.conversation),
    )
  if (worker !== undefined) return { kind: 'existing', worker }
  if (pool.primaryNeverBorn === true) return { kind: 'start', number: 1 }
  if (pool.workers.length >= MAX_NORMAL_WORKERS_PER_POOL) return { kind: 'full' }
  if (!Number.isSafeInteger(pool.nextNumber + 1)) return { kind: 'unknown' }
  return { kind: 'start', number: pool.nextNumber }
}

/** Reserve in the owned file before starting; no existing binding is overwritten. */
export function reserveNormalWorker(
  entry: ProfileExecution,
  giver: string,
  number: number,
  conversation: string,
): ProfileExecution | null {
  if (
    entry.kind !== 'normal' ||
    entry.retired === true ||
    !Number.isSafeInteger(number) ||
    number < 1 ||
    conversation.length === 0 ||
    conversation.length > 200 ||
    giver.length === 0 ||
    giver.length > 200
  )
    return null
  const pools = entry.workerPools ?? []
  const pool = pools.find((one) => one.giver === giver)
  if (
    (pool === undefined && pools.length >= MAX_NORMAL_WORKER_POOLS) ||
    pools.some((one) => one.workers.some((worker) => worker.conversation === conversation)) ||
    pool?.workers.some((worker) => worker.number === number) === true ||
    (pool?.workers.length ?? 0) >= MAX_NORMAL_WORKERS_PER_POOL
  )
    return null
  const next = pool?.nextNumber ?? 1
  // A never-born primary can be tried again; extra numbers are never handed out twice.
  if (number !== next && !(number === 1 && pool?.primaryNeverBorn === true)) return null
  if (!Number.isSafeInteger(Math.max(next, number + 1))) return null
  const added: NormalWorkerPool = {
    giver,
    nextNumber: Math.max(next, number + 1),
    workers: [...(pool?.workers ?? []), { number, conversation, phase: 'reserved' }],
  }
  return {
    ...entry,
    workerPools:
      pool === undefined ? [...pools, added] : pools.map((one) => (one === pool ? added : one)),
  }
}

/** Complete only the reservation whose id and number were actually recorded. */
export function bindNormalWorker(
  entry: ProfileExecution,
  giver: string,
  number: number,
  conversation: string,
): ProfileExecution | null {
  const pool = entry.workerPools?.find((one) => one.giver === giver)
  const worker = pool?.workers.find(
    (one) => one.number === number && one.conversation === conversation,
  )
  if (
    entry.kind !== 'normal' ||
    entry.retired === true ||
    pool === undefined ||
    worker === undefined
  )
    return null
  return {
    ...entry,
    workerPools: entry.workerPools!.map((one) =>
      one === pool
        ? {
            ...one,
            workers: one.workers.map((binding) =>
              binding === worker ? { ...binding, phase: 'bound' as const } : binding,
            ),
          }
        : one,
    ),
  }
}

/** A stale completion cannot release the lease another give owns. */
export class NormalWorkerLeases {
  private readonly held = new Map<string, symbol>()
  has(conversation: string): boolean {
    return this.held.has(conversation)
  }
  take(conversation: string): (() => void) | null {
    if (this.held.has(conversation)) return null
    const token = Symbol()
    this.held.set(conversation, token)
    return () => {
      if (this.held.get(conversation) === token) this.held.delete(conversation)
    }
  }
}

/** Before any delivery await, keep its piece so a crash cannot make the worker appear free. */
export function assignNormalWorker(
  entry: ProfileExecution,
  giver: string,
  conversation: string,
  assignment: NormalWorkerAssignment,
): ProfileExecution | null {
  const pool = entry.workerPools?.find((one) => one.giver === giver)
  const worker = pool?.workers.find((one) => one.conversation === conversation)
  if (
    entry.kind !== 'normal' ||
    entry.retired === true ||
    pool === undefined ||
    worker === undefined ||
    worker.assignment !== undefined
  )
    return null
  return {
    ...entry,
    workerPools: entry.workerPools!.map((one) =>
      one === pool
        ? {
            ...one,
            workers: one.workers.map((binding) =>
              binding === worker ? { ...binding, assignment } : binding,
            ),
          }
        : one,
    ),
  }
}

/** Clear only the same accepted piece; a late completion must not release a newer assignment. */
export function releaseNormalAssignment(
  entry: ProfileExecution,
  giver: string,
  conversation: string,
  piece: string,
): ProfileExecution {
  return {
    ...entry,
    workerPools: entry.workerPools?.map((pool) =>
      pool.giver !== giver
        ? pool
        : {
            ...pool,
            workers: pool.workers.map((worker) => {
              if (worker.conversation !== conversation || worker.assignment?.piece !== piece)
                return worker
              const bound = { ...worker }
              delete bound.assignment
              return bound
            }),
          },
    ),
  }
}
