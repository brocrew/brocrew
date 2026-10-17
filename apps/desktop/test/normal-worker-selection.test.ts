import { describe, expect, it } from 'vitest'
import {
  assignNormalWorker,
  releaseNormalAssignment,
  bindNormalWorker,
  NormalWorkerLeases,
  reserveNormalWorker,
  selectNormalWorker,
  workerPoolFor,
} from '../src/main/normal-worker-pools'
import {
  MAX_NORMAL_WORKERS_PER_POOL,
  type NormalWorkerPool,
  type ProfileExecution,
} from '../src/main/profile-execution-file'

const pool: NormalWorkerPool = {
  giver: 'giver',
  nextNumber: 4,
  workers: [
    { number: 3, conversation: 'worker-three', phase: 'bound' },
    { number: 1, conversation: 'primary', phase: 'bound' },
    { number: 2, conversation: 'worker-two', phase: 'bound' },
  ],
}
const entry: ProfileExecution = { kind: 'normal', identityCreatedAt: 12, workerPools: [pool] }

describe('normal worker selection', () => {
  it('keeps the primary for ordinary work, even if busy and an extra is free', () => {
    expect(
      selectNormalWorker(
        pool,
        false,
        (id) => id !== 'primary',
        () => false,
      ),
    ).toEqual({
      kind: 'existing',
      worker: pool.workers[1],
    })
  })
  it('uses the free primary first, then the lowest free extra, independently of storage order', () => {
    expect(
      selectNormalWorker(
        pool,
        true,
        () => true,
        () => false,
      ),
    ).toMatchObject({ kind: 'existing', worker: { number: 1 } })
    expect(
      selectNormalWorker(
        pool,
        true,
        (id) => id !== 'primary',
        () => false,
      ),
    ).toMatchObject({ kind: 'existing', worker: { number: 2 } })
  })
  it('excludes reserved and leased workers and allocates the next number only when none is free', () => {
    const partlyStarting = {
      ...pool,
      workers: pool.workers.map((worker) =>
        worker.number === 1 ? { ...worker, phase: 'reserved' as const } : worker,
      ),
    }
    expect(
      selectNormalWorker(
        partlyStarting,
        true,
        () => true,
        (id) => id === 'worker-two',
      ),
    ).toMatchObject({ kind: 'existing', worker: { number: 3 } })
    expect(
      selectNormalWorker(
        partlyStarting,
        true,
        () => false,
        () => false,
      ),
    ).toEqual({ kind: 'start', number: 4 })
  })
  it('does not invent a primary for an incomplete pool, or exceed the worker bound', () => {
    expect(
      selectNormalWorker(
        { ...pool, workers: [pool.workers[0]!] },
        false,
        () => true,
        () => false,
      ),
    ).toEqual({ kind: 'unknown' })
    const full: NormalWorkerPool = {
      giver: 'giver',
      nextNumber: MAX_NORMAL_WORKERS_PER_POOL + 1,
      workers: Array.from({ length: MAX_NORMAL_WORKERS_PER_POOL }, (_, at) => ({
        number: at + 1,
        conversation: `worker-${at}`,
        phase: 'bound' as const,
      })),
    }
    expect(
      selectNormalWorker(
        full,
        true,
        () => false,
        () => false,
      ),
    ).toEqual({ kind: 'full' })
    expect(
      selectNormalWorker(
        null,
        true,
        () => false,
        () => false,
      ),
    ).toEqual({ kind: 'start', number: 1 })
  })
  it('holds an assignment after a crash, even if the provider otherwise appears free', () => {
    const held: NormalWorkerPool = {
      ...pool,
      workers: pool.workers.map((worker) => ({
        ...worker,
        assignment: { piece: 'waiting-piece', giver: 'giver' },
      })),
    }
    expect(
      selectNormalWorker(
        held,
        true,
        () => true,
        () => false,
      ),
    ).toEqual({ kind: 'start', number: 4 })
    expect(
      selectNormalWorker(
        held,
        false,
        () => true,
        () => false,
      ),
    ).toMatchObject({ kind: 'existing', worker: { number: 1 } })
  })
  it('does not retry an absent primary without explicit never-born proof', () => {
    const uncertain: NormalWorkerPool = { giver: 'giver', nextNumber: 7, workers: [] }
    expect(
      selectNormalWorker(
        uncertain,
        false,
        () => true,
        () => false,
      ),
    ).toEqual({ kind: 'unknown' })
    expect(
      reserveNormalWorker({ ...entry, workerPools: [uncertain] }, 'giver', 1, 'replacement'),
    ).toBeNull()
    const proved = { ...uncertain, primaryNeverBorn: true as const, workers: [pool.workers[0]!] }
    expect(
      selectNormalWorker(
        proved,
        false,
        () => true,
        () => false,
      ),
    ).toEqual({ kind: 'start', number: 1 })
    expect(
      selectNormalWorker(
        proved,
        true,
        () => true,
        () => false,
      ),
    ).toMatchObject({ kind: 'existing', worker: { number: 3 } })
    const retried = reserveNormalWorker({ ...entry, workerPools: [proved] }, 'giver', 1, 'retried')!
    expect(retried.workerPools![0]!.workers).toHaveLength(2)
    expect(retried.workerPools![0]!.nextNumber).toBe(7)
    expect(retried.workerPools![0]!.primaryNeverBorn).toBeUndefined()
  })
  it('keeps pools separate by giver, and refuses ambiguous replacement lineage', () => {
    const other = {
      ...pool,
      giver: 'other-giver',
      workers: [{ number: 1, conversation: 'other-primary', phase: 'bound' as const }],
    }
    const multiple = { ...entry, workerPools: [pool, other] }
    expect(workerPoolFor(multiple, ['giver-replacement', 'giver'])).toEqual({ known: true, pool })
    expect(workerPoolFor(multiple, ['other-giver'])).toEqual({ known: true, pool: other })
    expect(workerPoolFor(multiple, ['giver', 'other-giver'])).toEqual({ known: false })
    expect(workerPoolFor(multiple, ['unrelated'])).toEqual({ known: true, pool: null })
  })
  it('reserves before another selection and completes only that exact durable binding', () => {
    const reserved = reserveNormalWorker(entry, 'giver', 4, 'new-worker')!
    expect(reserved).not.toBeNull()
    expect(reserved.workerPools![0]!.nextNumber).toBe(5)
    expect(reserved.workerPools![0]!.workers.at(-1)).toEqual({
      number: 4,
      conversation: 'new-worker',
      phase: 'reserved',
    })
    expect(reserveNormalWorker(reserved, 'giver', 4, 'second-worker')).toBeNull()
    expect(reserveNormalWorker(reserved, 'giver', 5, 'new-worker')).toBeNull()
    expect(bindNormalWorker(reserved, 'giver', 4, 'wrong-worker')).toBeNull()
    const bound = bindNormalWorker(reserved, 'giver', 4, 'new-worker')!
    expect(bound.workerPools![0]!.workers.at(-1)?.phase).toBe('bound')
    expect(entry).toEqual({ kind: 'normal', identityCreatedAt: 12, workerPools: [pool] })
  })
  it('records exclusive assignment ownership and never clears a later piece from a stale completion', () => {
    const held = assignNormalWorker(entry, 'giver', 'primary', {
      piece: 'first-piece',
      giver: 'giver',
    })!
    expect(held.workerPools![0]!.workers[1]!.assignment).toEqual({
      piece: 'first-piece',
      giver: 'giver',
    })
    expect(
      assignNormalWorker(held, 'giver', 'primary', { piece: 'second-piece', giver: 'giver' }),
    ).toBeNull()
    const released = releaseNormalAssignment(held, 'giver', 'primary', 'first-piece')
    expect(released.workerPools![0]!.workers[1]!.assignment).toBeUndefined()
    const later = assignNormalWorker(released, 'giver', 'primary', {
      piece: 'second-piece',
      giver: 'giver',
    })!
    expect(releaseNormalAssignment(later, 'giver', 'primary', 'first-piece')).toEqual(later)
    expect(entry.workerPools![0]!.workers[1]!.assignment).toBeUndefined()
  })
  it('holds an exclusive lease and ignores a stale completion after another give acquired it', () => {
    const leases = new NormalWorkerLeases()
    const release = leases.take('primary')!
    expect(leases.has('primary')).toBe(true)
    expect(leases.take('primary')).toBeNull()
    release()
    const releaseNext = leases.take('primary')!
    release()
    expect(leases.has('primary')).toBe(true)
    releaseNext()
    expect(leases.has('primary')).toBe(false)
  })
  it('retries only a primary proved never born, preserving the extra-number counter', () => {
    const empty: ProfileExecution = {
      kind: 'normal',
      identityCreatedAt: 12,
      workerPools: [{ giver: 'giver', nextNumber: 7, workers: [], primaryNeverBorn: true }],
    }
    expect(
      selectNormalWorker(
        empty.workerPools![0]!,
        true,
        () => false,
        () => false,
      ),
    ).toEqual({ kind: 'start', number: 1 })
    const retry = reserveNormalWorker(empty, 'giver', 1, 'retried-primary')!
    expect(retry.workerPools![0]!.nextNumber).toBe(7)
    expect(retry.workerPools![0]!.primaryNeverBorn).toBeUndefined()
    expect(reserveNormalWorker(empty, 'giver', 2, 'another-number')).toBeNull()
  })
})
