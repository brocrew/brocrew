import { describe, expect, it } from 'vitest'
import { indexWorkerReadings, workerLine } from '../src/main/worker-readings'
import type { KeptProfileExecution, NormalWorkerPool } from '../src/main/profile-execution-file'

const pool: NormalWorkerPool = {
  giver: 'fictional-reviewer',
  nextNumber: 8,
  workers: [
    { number: 1, conversation: 'first-reader', phase: 'bound' },
    { number: 7, conversation: 'extra-reader', phase: 'bound' },
  ],
}
const kept = (
  more: Partial<KeptProfileExecution['profiles'][string]> = {},
): KeptProfileExecution => ({
  profiles: {
    reader: { kind: 'normal', identityCreatedAt: 42, workerPools: [pool], ...more },
  },
})

describe('stable worker readings', () => {
  it('keeps actual numbers, giver and birth identity without state or input mutation', () => {
    const data = kept()
    const before = JSON.stringify(data)
    expect([...indexWorkerReadings(data)]).toEqual([
      [
        'first-reader',
        { identity: 'reader', giver: 'fictional-reviewer', number: 1, bornAs: 'first-reader' },
      ],
      [
        'extra-reader',
        { identity: 'reader', giver: 'fictional-reviewer', number: 7, bornAs: 'extra-reader' },
      ],
    ])
    expect(JSON.stringify(data)).toBe(before)
    expect(Object.isFrozen(indexWorkerReadings(data).get('first-reader'))).toBe(true)
  })
  it('omits retired, removing, reserved and service bindings', () => {
    expect(indexWorkerReadings(kept({ retired: true })).size).toBe(0)
    expect(indexWorkerReadings(kept({ workerPools: [{ ...pool, removing: true }] })).size).toBe(0)
    expect(
      indexWorkerReadings(
        kept({ workerPools: [{ ...pool, workers: [{ ...pool.workers[0]!, phase: 'reserved' }] }] }),
      ).size,
    ).toBe(0)
    expect(indexWorkerReadings(kept({ kind: 'service' })).size).toBe(0)
    expect(indexWorkerReadings(kept({ workerPools: [] })).size).toBe(0)
  })
  it('follows a complete replacement cache without renumbering, and omits cyclic or colliding targets', () => {
    const replaced = new Map([
      ['first-reader', 'middle-reader'],
      ['middle-reader', 'latest-reader'],
    ])
    expect(indexWorkerReadings(kept(), replaced).get('latest-reader')).toEqual({
      identity: 'reader',
      giver: 'fictional-reviewer',
      number: 1,
      bornAs: 'first-reader',
    })
    expect(indexWorkerReadings(kept(), replaced).has('first-reader')).toBe(false)
    replaced.set('latest-reader', 'first-reader')
    expect(indexWorkerReadings(kept(), replaced).has('latest-reader')).toBe(false)
    expect(indexWorkerReadings(kept(), replaced).has('first-reader')).toBe(false)
    const collision = new Map([
      ['first-reader', 'same-target'],
      ['extra-reader', 'same-target'],
    ])
    expect(indexWorkerReadings(kept(), collision).size).toBe(0)
    const long = new Map<string, string>()
    for (let n = 0; n < 63; n++) long.set(n === 0 ? 'first-reader' : `link-${n}`, `link-${n + 1}`)
    expect(indexWorkerReadings(kept(), long).get('link-63')).toMatchObject({
      number: 1,
      bornAs: 'first-reader',
    })
    long.set('link-63', 'link-64')
    expect(indexWorkerReadings(kept(), long).has('link-64')).toBe(false)
  })
  it('uses only complete terminal evidence when supplied, never a routing-cache fallback', () => {
    const ordinary = new Map([['first-reader', 'unproved-routing-target']])
    expect(indexWorkerReadings(kept(), ordinary, () => null).size).toBe(0)
    expect([
      ...indexWorkerReadings(kept(), ordinary, (birth) =>
        birth === 'first-reader' ? 'proved-terminal' : null,
      ),
    ]).toEqual([
      [
        'proved-terminal',
        { identity: 'reader', giver: 'fictional-reviewer', number: 1, bornAs: 'first-reader' },
      ],
    ])
  })
  it('uses the exact primary and extra worker receipt lines', () => {
    expect(workerLine('document-reader', 1)).toBe('Worker: document-reader.')
    expect(workerLine('document-reader', 7)).toBe('Worker: document-reader (7).')
  })
})
