import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_NORMAL_WORKER_POOLS,
  MAX_NORMAL_WORKERS_KEPT,
  MAX_NORMAL_WORKERS_PER_POOL,
  MAX_PROFILE_EXECUTION_BYTES,
  NO_PROFILE_EXECUTION,
  PROFILE_EXECUTION_VERSION,
  kindOf,
  profileExecutionFile,
  readAgainstTheDatabase,
  readProfileExecution,
  reconcileProfileExecution,
  writeProfileExecution,
  type KeptProfileExecution,
  type NormalWorkerBinding,
  type NormalWorkerPool,
  type ProfileExecution,
  type WhatTheDatabaseHolds,
  type WorkerBorn,
} from '../src/main/profile-execution-file'

// Only fictional side files and pure database evidence: no store, provider or native program.
const IDENTITY = 'aid:writer'
const CREATED = 42
const primary: NormalWorkerBinding = { number: 1, conversation: 'worker-1', phase: 'bound' }
const extra: NormalWorkerBinding = { number: 2, conversation: 'worker-2', phase: 'reserved' }
const pool = (workers: readonly NormalWorkerBinding[] = [primary, extra]): NormalWorkerPool => ({
  giver: 'giver-a',
  nextNumber: 3,
  workers,
})
const entry = (pools: readonly NormalWorkerPool[] = [pool()]): ProfileExecution => ({
  kind: 'normal',
  identityCreatedAt: CREATED,
  workerPools: pools,
})
const kept = (row: ProfileExecution = entry()): KeptProfileExecution => ({
  profiles: { [IDENTITY]: row },
})
const born = (worker: NormalWorkerBinding = primary, giver = 'giver-a'): WorkerBorn => ({
  identity: IDENTITY,
  identityCreatedAt: CREATED,
  giver,
  number: worker.number,
  conversation: worker.conversation,
})
const database = (
  conversations: readonly string[] = [],
  workersBorn: readonly WorkerBorn[] = [],
  overrides: Partial<WhatTheDatabaseHolds> = {},
): WhatTheDatabaseHolds => ({
  identityCreatedAt: (identity) => (identity === IDENTITY ? CREATED : null),
  hasConversation: (conversation) => conversations.includes(conversation),
  servicesBorn: [],
  workersBorn,
  ...overrides,
})
const unchanged = (input: KeptProfileExecution) => ({
  kept: input,
  changed: false,
  moved: [],
  conflicts: [],
})

let folder: string
let file: string
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'brocrew-worker-pools-'))
  file = profileExecutionFile(folder)
})
afterEach(() => rmSync(folder, { recursive: true, force: true }))
const holding = (profiles: unknown, version = PROFILE_EXECUTION_VERSION) => {
  writeFileSync(file, JSON.stringify({ version, profiles }))
  return readProfileExecution(file)
}

describe('bounded versioned normal pools', () => {
  it('[P01] reads legacy v1 normal and service entries, and writes only v2', () => {
    const profiles = {
      [IDENTITY]: { kind: 'normal', identityCreatedAt: CREATED },
      'aid:service': { kind: 'service', identityCreatedAt: 43, reserved: 'service-a' },
    } as const
    expect(holding(profiles, 1)).toEqual({ readable: true, kept: { profiles } })
    writeProfileExecution(file, { profiles })
    expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(2)
    expect(readProfileExecution(file)).toEqual({ readable: true, kept: { profiles } })
    expect(readdirSync(folder)).toEqual(['profile-execution.json'])
  })

  it('[P02] never silently ignores pools in a v1 file, including empty pools', () => {
    for (const workerPools of [[], [pool()]]) {
      expect(holding({ [IDENTITY]: { ...entry(), workerPools } }, 1).readable).toBe(false)
    }
    expect(holding({}, 3)).toEqual({ readable: false, why: 'it is not version 2' })
  })

  it('[P03] round trips multiple giver primaries and stable gaps without renumbering', () => {
    const input = kept(
      entry([
        { giver: 'giver-a', nextNumber: 9, workers: [primary, { ...extra, number: 7 }] },
        {
          giver: 'giver-b',
          nextNumber: 2,
          workers: [{ ...primary, conversation: 'other-primary' }],
        },
        { giver: 'giver-c', nextNumber: 12, workers: [] },
      ]),
    )
    writeProfileExecution(file, input)
    expect(readProfileExecution(file)).toEqual({ readable: true, kept: input })
  })

  const invalidPools: readonly [string, unknown][] = [
    ['not an array', {}],
    ['null', null],
    ['not a pool', [null]],
    ['missing giver', [{ nextNumber: 3, workers: [] }]],
    ['empty giver', [{ ...pool(), giver: '' }]],
    ['long giver', [{ ...pool(), giver: 'g'.repeat(201) }]],
    ['duplicate giver', [pool(), { ...pool([]) }]],
    ['zero next number', [{ ...pool(), nextNumber: 0 }]],
    ['negative next number', [{ ...pool(), nextNumber: -1 }]],
    ['fractional next number', [{ ...pool(), nextNumber: 3.5 }]],
    ['unsafe next number', [{ ...pool(), nextNumber: Number.MAX_SAFE_INTEGER + 1 }]],
    ['missing workers', [{ giver: 'g', nextNumber: 3 }]],
    ['not a worker', [pool([null as unknown as NormalWorkerBinding])]],
    ['zero worker number', [pool([{ ...primary, number: 0 }])]],
    ['negative worker number', [pool([{ ...primary, number: -1 }])]],
    ['fractional worker number', [pool([{ ...primary, number: 1.5 }])]],
    ['unsafe worker number', [pool([{ ...primary, number: Number.MAX_SAFE_INTEGER + 1 }])]],
    ['number equal to next', [pool([{ ...primary, number: 3 }])]],
    ['number above next', [pool([{ ...primary, number: 4 }])]],
    ['duplicate worker number', [pool([primary, { ...extra, number: 1 }])]],
    ['empty conversation', [pool([{ ...primary, conversation: '' }])]],
    ['long conversation', [pool([{ ...primary, conversation: 'w'.repeat(201) }])]],
    [
      'duplicate conversation within pool',
      [pool([primary, { ...extra, conversation: 'worker-1' }])],
    ],
    [
      'duplicate conversation across pools',
      [pool([primary]), { ...pool([primary]), giver: 'other' }],
    ],
    ['unknown phase', [pool([{ ...primary, phase: 'made' as 'bound' }])]],
    ['missing phase', [pool([{ number: 1, conversation: 'w' } as NormalWorkerBinding])]],
  ]
  it.each(invalidPools)('[P04] rejects %s', (_name, workerPools) => {
    expect(holding({ [IDENTITY]: { ...entry(), workerPools } }).readable).toBe(false)
  })

  it('[P05] pools belong only to normal entries; legacy service guards still hold', () => {
    expect(holding({ [IDENTITY]: { ...entry(), kind: 'service' } }).readable).toBe(false)
    for (const fields of [{ serviceConversation: 's' }, { reserved: 's' }, { removing: 's' }]) {
      expect(holding({ [IDENTITY]: { ...entry(), ...fields } }).readable).toBe(false)
    }
  })

  it('[P06] accepts each pool and worker ceiling, rejects one beyond', () => {
    const pools = Array.from({ length: MAX_NORMAL_WORKER_POOLS }, (_, i) => ({
      giver: `giver-${i}`,
      nextNumber: 1,
      workers: [],
    }))
    expect(holding(kept(entry(pools)).profiles).readable).toBe(true)
    expect(
      holding(kept(entry([...pools, { giver: 'overflow', nextNumber: 1, workers: [] }])).profiles)
        .readable,
    ).toBe(false)
    const workers = Array.from({ length: MAX_NORMAL_WORKERS_PER_POOL }, (_, i) => ({
      number: i + 1,
      conversation: `worker-${i}`,
      phase: 'bound' as const,
    }))
    const full = { ...pool(workers), nextNumber: workers.length + 1 }
    expect(holding(kept(entry([full])).profiles).readable).toBe(true)
    expect(
      holding(
        kept(
          entry([
            {
              ...full,
              nextNumber: 100,
              workers: [...workers, { number: 99, conversation: 'overflow', phase: 'reserved' }],
            },
          ]),
        ).profiles,
      ).readable,
    ).toBe(false)
  })

  it('[P07] bounds total workers across identities at the global store ceiling', () => {
    const pools = Array.from({ length: MAX_NORMAL_WORKER_POOLS }, (_, p) => ({
      giver: `g-${p}`,
      nextNumber: MAX_NORMAL_WORKERS_PER_POOL + 1,
      workers: Array.from({ length: MAX_NORMAL_WORKERS_PER_POOL }, (_, w) => ({
        number: w + 1,
        conversation: `w-${p}-${w}`,
        phase: 'bound' as const,
      })),
    }))
    expect(pools.flatMap((p) => p.workers)).toHaveLength(MAX_NORMAL_WORKERS_KEPT)
    const input = kept(entry(pools))
    writeProfileExecution(file, input)
    expect(readProfileExecution(file)).toEqual({ readable: true, kept: input })
    const tooMany = { profiles: { ...input.profiles, 'aid:other': entry([pool([primary])]) } }
    expect(holding(tooMany.profiles)).toEqual({ readable: false, why: 'it holds too many workers' })
    expect(() => writeProfileExecution(file, tooMany)).toThrow('too many workers')
  })

  it('[P08] bounds file bytes before reading and writing, preserving the previous file', () => {
    const text = JSON.stringify({ version: 2, profiles: {} })
    writeFileSync(file, text + ' '.repeat(MAX_PROFILE_EXECUTION_BYTES - Buffer.byteLength(text)))
    expect(readProfileExecution(file)).toEqual({ readable: true, kept: NO_PROFILE_EXECUTION })
    appendFileSync(file, ' ')
    expect(readProfileExecution(file)).toEqual({ readable: false, why: 'it is too large' })
    writeProfileExecution(file, kept())
    const previous = readFileSync(file, 'utf8')
    const tooLarge = {
      profiles: { [IDENTITY]: { ...entry(), ignored: 'x'.repeat(MAX_PROFILE_EXECUTION_BYTES) } },
    }
    expect(() => writeProfileExecution(file, tooLarge)).toThrow('too large')
    expect(readFileSync(file, 'utf8')).toBe(previous)
    expect(readdirSync(folder)).toEqual(['profile-execution.json'])
  })

  it('[P09] writer rejects invalid typed input before touching the existing file', () => {
    writeProfileExecution(file, kept())
    const previous = readFileSync(file, 'utf8')
    const invalid = kept(entry([pool([{ ...primary, number: 0 }])]))
    expect(() => writeProfileExecution(file, invalid)).toThrow('invalid entry')
    expect(readFileSync(file, 'utf8')).toBe(previous)
  })
})

describe('pure normal worker reservation recovery', () => {
  it('[P10] keeps exact bound registrations and ignores unrelated recorded siblings', () => {
    const input = kept(entry([pool([primary])]))
    expect(reconcileProfileExecution(input, database(['worker-1', 'unrelated'], [born()]))).toEqual(
      unchanged(input),
    )
  })

  it('[P11] drops only an uncommitted reservation, retaining pool and next number', () => {
    const input = kept(entry([pool([extra])]))
    const snapshot = JSON.stringify(input)
    expect(reconcileProfileExecution(input, database())).toEqual({
      kept: kept(entry([pool([])])),
      changed: true,
      moved: [IDENTITY],
      conflicts: [],
    })
    expect(JSON.stringify(input)).toBe(snapshot)
  })

  it('[P12] completes only a recorded conversation with its exact registration, immutably', () => {
    const input = kept()
    const snapshot = JSON.stringify(input)
    const settled = reconcileProfileExecution(
      input,
      database(['worker-1', 'worker-2'], [born(), born(extra)]),
    )
    expect(settled).toEqual({
      kept: kept(entry([pool([primary, { ...extra, phase: 'bound' }])])),
      changed: true,
      moved: [IDENTITY],
      conflicts: [],
    })
    expect(JSON.stringify(input)).toBe(snapshot)
    expect(
      reconcileProfileExecution(
        settled.kept,
        database(['worker-1', 'worker-2'], [born(), born(extra)]),
      ),
    ).toEqual(unchanged(settled.kept))
  })

  it.each(['bound', 'reserved'] as const)(
    '[P13] %s with a recorded conversation and no fact conflicts',
    (phase) => {
      const input = kept(entry([pool([{ ...extra, phase }])]))
      expect(reconcileProfileExecution(input, database(['worker-2']))).toEqual({
        ...unchanged(input),
        conflicts: [IDENTITY],
      })
    },
  )

  it.each(['bound', 'reserved'] as const)(
    '[P14] %s with a fact and no recorded conversation conflicts',
    (phase) => {
      const input = kept(entry([pool([{ ...extra, phase }])]))
      expect(reconcileProfileExecution(input, database([], [born(extra)]))).toEqual({
        ...unchanged(input),
        conflicts: [IDENTITY],
      })
    },
  )

  const mismatches: readonly [string, Partial<WorkerBorn>][] = [
    ['identity', { identity: 'aid:other' }],
    ['incarnation', { identityCreatedAt: CREATED + 1 }],
    ['giver', { giver: 'other-giver' }],
    ['number', { number: 3 }],
    ['conversation', { conversation: 'other-worker' }],
  ]
  it.each(mismatches)('[P15] rejects a registration with mismatched %s', (_field, wrong) => {
    const input = kept(entry([pool([extra])]))
    const settled = reconcileProfileExecution(
      input,
      database(['worker-2'], [{ ...born(extra), ...wrong }]),
    )
    expect(settled.kept).toEqual(input)
    expect(settled.changed).toBe(false)
    expect(settled.conflicts).toContain(IDENTITY)
    expect(
      kindOf({ readable: true, kept: settled.kept }, settled.conflicts, IDENTITY, CREATED),
    ).toBe('unknown')
  })

  it('[P16] rejects duplicate exact registrations and unlisted extra registrations', () => {
    const input = kept(entry([pool([primary])]))
    for (const facts of [
      [born(), born()],
      [born(), born(extra)],
    ]) {
      expect(reconcileProfileExecution(input, database(['worker-1', 'worker-2'], facts))).toEqual({
        ...unchanged(input),
        conflicts: [IDENTITY],
      })
    }
    expect(
      reconcileProfileExecution(NO_PROFILE_EXECUTION, database(['worker-1'], [born()])).conflicts,
    ).toEqual([IDENTITY])
    expect(
      reconcileProfileExecution(
        kept({ kind: 'service', identityCreatedAt: CREATED }),
        database(['worker-1'], [born()]),
      ).conflicts,
    ).toEqual([IDENTITY])
  })

  it('[P17] drops stale incarnations but never adopts their workers into a new pool', () => {
    const input = kept()
    for (const now of [null, CREATED + 1]) {
      expect(
        reconcileProfileExecution(input, database([], [], { identityCreatedAt: () => now })),
      ).toEqual({
        kept: NO_PROFILE_EXECUTION,
        changed: true,
        moved: [IDENTITY],
        conflicts: [],
      })
    }
  })

  it('[P18] retirement makes same-time recreation unknown, preserving all bindings', () => {
    const input = kept({ ...entry(), retired: true })
    const settled = reconcileProfileExecution(
      input,
      database(['worker-1', 'worker-2'], [born(), born(extra)]),
    )
    expect(settled).toEqual({ ...unchanged(input), conflicts: [IDENTITY] })
    expect(
      kindOf({ readable: true, kept: settled.kept }, settled.conflicts, IDENTITY, CREATED),
    ).toBe('unknown')
  })

  it('[P19] legacy normal entries with absent workersBorn remain supported', () => {
    const input = kept({ kind: 'normal', identityCreatedAt: CREATED })
    const db = database(['some-child'])
    delete (db as { workersBorn?: readonly WorkerBorn[] }).workersBorn
    expect(reconcileProfileExecution(input, db)).toEqual(unchanged(input))
  })

  it('[P20] missing side file with registrations is unreadable; a present empty file conflicts', () => {
    const missing = readProfileExecution(file)
    expect(readAgainstTheDatabase(missing, [], [born()])).toEqual({
      readable: false,
      why: 'it is missing, and the database holds a worker registration',
    })
    expect(readAgainstTheDatabase(missing, [])).toEqual(missing)
    const present = holding({})
    expect(readAgainstTheDatabase(present, [], [born()])).toEqual(present)
    expect(
      reconcileProfileExecution(NO_PROFILE_EXECUTION, database(['worker-1'], [born()])).conflicts,
    ).toEqual([IDENTITY])
    const unreadable = { readable: false, why: 'fictional unreadable file' } as const
    expect(readAgainstTheDatabase(unreadable, [], [born()])).toBe(unreadable)
  })

  it('[P21] a registered worker with no pools conflicts instead of legacy fallback', () => {
    const input = kept({ kind: 'normal', identityCreatedAt: CREATED })
    expect(reconcileProfileExecution(input, database(['worker-1'], [born()]))).toEqual({
      ...unchanged(input),
      conflicts: [IDENTITY],
    })
  })

  it.each(['bound', 'reserved'] as const)(
    '[P22] a recorded legacy primary may prove %s without a birth fact',
    (phase) => {
      const input = kept(entry([pool([{ ...primary, phase }])]))
      const legacyPrimaryMatches = vi.fn(() => true)
      const settled = reconcileProfileExecution(
        input,
        database(['worker-1'], [], { legacyPrimaryMatches }),
      )
      expect(settled.kept).toEqual(kept(entry([pool([primary])])))
      expect(settled.conflicts).toEqual([])
      expect(settled.changed).toBe(phase === 'reserved')
      expect(settled.moved).toEqual(phase === 'reserved' ? [IDENTITY] : [])
      expect(legacyPrimaryMatches).toHaveBeenCalledExactlyOnceWith(born())
    },
  )

  it('[P23] legacy proof never admits extras, unrecorded primaries or contradictory facts', () => {
    const legacyPrimaryMatches = vi.fn(() => true)
    const db = database(['worker-2'], [], { legacyPrimaryMatches })
    const input = kept(entry([pool([extra])]))
    expect(reconcileProfileExecution(input, db)).toEqual({
      ...unchanged(input),
      conflicts: [IDENTITY],
    })
    expect(legacyPrimaryMatches).not.toHaveBeenCalled()
    const reservedPrimary = kept(entry([pool([{ ...primary, phase: 'reserved' }])]))
    expect(
      reconcileProfileExecution(reservedPrimary, database([], [], { legacyPrimaryMatches })),
    ).toEqual({
      kept: kept(entry([{ ...pool([]), primaryNeverBorn: true }])),
      changed: true,
      moved: [IDENTITY],
      conflicts: [],
    })
    expect(legacyPrimaryMatches).not.toHaveBeenCalled()
    for (const facts of [[{ ...born(), giver: 'wrong' }], [born(), born()]]) {
      expect(
        reconcileProfileExecution(
          kept(entry([pool([primary])])),
          database(['worker-1'], facts, { legacyPrimaryMatches }),
        ).conflicts,
      ).toEqual([IDENTITY])
    }
    expect(legacyPrimaryMatches).not.toHaveBeenCalled()
  })

  it('[P24] false or absent legacy proof leaves a recorded unregistered primary unknown', () => {
    const input = kept(entry([pool([primary])]))
    for (const overrides of [{}, { legacyPrimaryMatches: () => false }]) {
      expect(reconcileProfileExecution(input, database(['worker-1'], [], overrides))).toEqual({
        ...unchanged(input),
        conflicts: [IDENTITY],
      })
    }
  })

  it('[P25] one conflict preserves uncommitted siblings rather than partially settling the entry', () => {
    const input = kept(
      entry([pool([extra, { number: 1, conversation: 'missing-bound', phase: 'bound' }])]),
    )
    expect(reconcileProfileExecution(input, database())).toEqual({
      ...unchanged(input),
      conflicts: [IDENTITY],
    })
  })

  it.each([
    ['foreign', 'bound'],
    ['foreign', 'reserved'],
    ['mixed', 'bound'],
    ['mixed', 'reserved'],
  ] as const)('[P27] %s identity facts block %s legacy-primary fallback', (which, phase) => {
    const input = kept(entry([pool([{ ...primary, phase }])]))
    const foreign = { ...born(), identity: 'aid:other' }
    const facts = which === 'foreign' ? [foreign] : [born(), foreign]
    const legacyPrimaryMatches = vi.fn(() => true)
    const settled = reconcileProfileExecution(
      input,
      database(['worker-1'], facts, { legacyPrimaryMatches }),
    )
    expect(settled.kept).toEqual(input)
    expect(settled.changed).toBe(false)
    expect(settled.conflicts).toContain(IDENTITY)
    expect(legacyPrimaryMatches).not.toHaveBeenCalled()
  })

  it.each([
    [primary, 'bound'],
    [primary, 'reserved'],
    [extra, 'bound'],
    [extra, 'reserved'],
  ] as const)(
    '[P28] worker %j in phase %s needs the actual-row proof when supplied',
    (worker, phase) => {
      const input = kept(entry([pool([{ ...worker, phase }])]))
      const fact = born(worker)
      const workerMatches = vi.fn(() => false)
      const legacyPrimaryMatches = vi.fn(() => true)
      const settled = reconcileProfileExecution(
        input,
        database([worker.conversation], [fact], {
          workerMatches,
          legacyPrimaryMatches,
        }),
      )
      expect(settled).toEqual({ ...unchanged(input), conflicts: [IDENTITY] })
      expect(workerMatches).toHaveBeenCalledExactlyOnceWith(fact)
      expect(legacyPrimaryMatches).not.toHaveBeenCalled()
    },
  )

  it.each(['bound', 'reserved'] as const)(
    '[P29] a true actual-row proof accepts an exact %s registration',
    (phase) => {
      const input = kept(entry([pool([{ ...extra, phase }])]))
      const workerMatches = vi.fn(() => true)
      const settled = reconcileProfileExecution(
        input,
        database(['worker-2'], [born(extra)], { workerMatches }),
      )
      expect(settled.kept).toEqual(kept(entry([pool([{ ...extra, phase: 'bound' }])])))
      expect(settled.conflicts).toEqual([])
      expect(settled.changed).toBe(phase === 'reserved')
      expect(workerMatches).toHaveBeenCalledExactlyOnceWith(born(extra))
    },
  )

  it('[P26] service reservation, removal and missing-file evidence retain their semantics', () => {
    const service = kept({ kind: 'service', identityCreatedAt: CREATED, reserved: 'service-a' })
    const recorded = database(['service-a'], [], {
      servicesBorn: [{ identity: IDENTITY, conversation: 'service-a' }],
    })
    expect(reconcileProfileExecution(service, recorded)).toEqual({
      kept: kept({ kind: 'service', identityCreatedAt: CREATED, serviceConversation: 'service-a' }),
      changed: true,
      moved: [IDENTITY],
      conflicts: [],
    })
    const removing = kept({
      kind: 'service',
      identityCreatedAt: CREATED,
      serviceConversation: 'service-a',
      removing: 'service-a',
    })
    expect(reconcileProfileExecution(removing, database())).toEqual({
      kept: kept({ kind: 'service', identityCreatedAt: CREATED }),
      changed: true,
      moved: [IDENTITY],
      conflicts: [],
    })
    expect(readAgainstTheDatabase(readProfileExecution(file), recorded.servicesBorn, [])).toEqual({
      readable: false,
      why: 'it is missing, and the database holds a service’s conversation',
    })
  })
})
