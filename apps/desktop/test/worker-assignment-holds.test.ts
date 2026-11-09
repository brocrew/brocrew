import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import {
  readProfileExecution,
  reconcileProfileExecution,
  writeProfileExecution,
  type KeptProfileExecution,
  type NormalWorkerAssignment,
  type NormalWorkerBinding,
  type NormalWorkerPool,
  type WhatTheDatabaseHolds,
  type WorkerBorn,
} from '../src/main/profile-execution-file'

// Fictional side files and pure evidence; no store, provider or application data.
const IDENTITY = 'aid:writer'
const CREATED = 42
const GIVER = 'giver-lineage'
const assignment: NormalWorkerAssignment = { piece: 'piece-a', giver: 'current-giver' }
const primary: NormalWorkerBinding = {
  number: 1,
  conversation: 'worker-primary',
  phase: 'bound',
  assignment,
}
const extra: NormalWorkerBinding = {
  number: 2,
  conversation: 'worker-extra',
  phase: 'reserved',
  assignment: { piece: 'piece-b', giver: 'another-giver' },
}
const kept = (
  workers: readonly NormalWorkerBinding[] = [primary],
  poolFields: Partial<Pick<NormalWorkerPool, 'primaryNeverBorn' | 'nextNumber'>> = {},
): KeptProfileExecution => ({
  profiles: {
    [IDENTITY]: {
      kind: 'normal',
      identityCreatedAt: CREATED,
      workerPools: [{ giver: GIVER, nextNumber: 9, workers, ...poolFields }],
    },
  },
})
const born = (worker: NormalWorkerBinding = primary): WorkerBorn => ({
  identity: IDENTITY,
  identityCreatedAt: CREATED,
  giver: GIVER,
  number: worker.number,
  conversation: worker.conversation,
})
const database = (
  conversations: readonly string[] = [primary.conversation],
  workersBorn: readonly WorkerBorn[] = [born()],
  overrides: Partial<WhatTheDatabaseHolds> = {},
): WhatTheDatabaseHolds => ({
  identityCreatedAt: () => CREATED,
  hasConversation: (id) => conversations.includes(id),
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
const withoutAssignment = (worker: NormalWorkerBinding): NormalWorkerBinding => ({
  number: worker.number,
  conversation: worker.conversation,
  phase: worker.phase,
})

let folder: string
let file: AppDatabase
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'brocrew-assignment-holds-'))
  file = openDatabase(join(folder, 'brobot2.sqlite'))
  applyMigrations(file, join(__dirname, '../src/main/db/migrations'))
})
afterEach(() => {
  file.close()
  rmSync(folder, { recursive: true, force: true })
})

describe('durable worker assignment holds', () => {
  it('[H01] round trips bound and reserved holds, copying both opaque ids at their ceiling', () => {
    const long = { ...primary, assignment: { piece: 'p'.repeat(200), giver: 'g'.repeat(200) } }
    const input = kept([long, extra, { number: 7, conversation: 'plain', phase: 'bound' }])
    writeProfileExecution(file, input)
    const read = readProfileExecution(file)
    expect(read).toEqual({ readable: true, kept: input })
    if (!read.readable) throw new Error('expected readable fictional file')
    expect(read.kept.profiles[IDENTITY]?.workerPools?.[0]?.workers[0]?.assignment).not.toBe(
      long.assignment,
    )
  })

  it('[H04] false or absent acceptance evidence preserves the hold, even with no work row', () => {
    const input = kept()
    for (const overrides of [{}, { assignmentWasAccepted: () => false }]) {
      const settled = reconcileProfileExecution(input, database(undefined, undefined, overrides))
      expect(settled).toEqual(unchanged(input))
      expect(settled.kept.profiles[IDENTITY]).toBe(input.profiles[IDENTITY])
    }
  })

  it('[H05] only proved durable acceptance clears the hold, immutably and with exact callback arguments', () => {
    const input = kept()
    const before = JSON.stringify(input)
    const assignmentWasAccepted = vi.fn(() => true)
    const settled = reconcileProfileExecution(
      input,
      database(undefined, undefined, { assignmentWasAccepted }),
    )
    expect(settled).toEqual({
      kept: kept([withoutAssignment(primary)]),
      changed: true,
      moved: [IDENTITY],
      conflicts: [],
    })
    expect(assignmentWasAccepted).toHaveBeenCalledExactlyOnceWith(born(), assignment)
    expect(JSON.stringify(input)).toBe(before)
    expect(reconcileProfileExecution(settled.kept, database())).toEqual(unchanged(settled.kept))
  })

  it('[H06] a proved recorded reservation binds first and retains or settles its hold by acceptance', () => {
    for (const accepted of [false, true]) {
      const input = kept([extra])
      const assignmentWasAccepted = vi.fn(() => accepted)
      const settled = reconcileProfileExecution(
        input,
        database([extra.conversation], [born(extra)], { assignmentWasAccepted }),
      )
      const worker = { ...extra, phase: 'bound' as const }
      expect(settled).toEqual({
        kept: kept([accepted ? withoutAssignment(worker) : worker]),
        changed: true,
        moved: [IDENTITY],
        conflicts: [],
      })
      expect(assignmentWasAccepted).toHaveBeenCalledExactlyOnceWith(born(extra), extra.assignment)
      expect(input).toEqual(kept([extra]))
    }
  })

  it('[H07] drops an unrecorded new-worker reservation, preserving nextNumber and never asking acceptance', () => {
    const input = kept([extra])
    const assignmentWasAccepted = vi.fn(() => true)
    const settled = reconcileProfileExecution(input, database([], [], { assignmentWasAccepted }))
    expect(settled).toEqual({ kept: kept([]), changed: true, moved: [IDENTITY], conflicts: [] })
    expect(assignmentWasAccepted).not.toHaveBeenCalled()
    expect(input).toEqual(kept([extra]))
  })

  it('[H08] missing, mismatched or vetoed birth evidence cannot authorize clearing a hold', () => {
    const input = kept()
    const bad = [
      database(undefined, undefined, { workerMatches: () => false }),
      database([], [born()]),
      database([primary.conversation], []),
      database(undefined, [{ ...born(), giver: 'wrong-lineage' }]),
    ]
    for (const db of bad) {
      const assignmentWasAccepted = vi.fn(() => true)
      const settled = reconcileProfileExecution(input, { ...db, assignmentWasAccepted })
      expect(settled).toEqual({ ...unchanged(input), conflicts: [IDENTITY] })
      expect(assignmentWasAccepted).not.toHaveBeenCalled()
    }
  })

  it('[H09] a legacy primary needs true row proof; extras cannot borrow it to clear assignments', () => {
    const assignmentWasAccepted = vi.fn(() => true)
    const legacyPrimaryMatches = vi.fn(() => true)
    const proved = reconcileProfileExecution(
      kept(),
      database([primary.conversation], [], {
        assignmentWasAccepted,
        legacyPrimaryMatches,
      }),
    )
    expect(proved).toEqual({
      kept: kept([withoutAssignment(primary)]),
      changed: true,
      moved: [IDENTITY],
      conflicts: [],
    })
    expect(assignmentWasAccepted).toHaveBeenCalledExactlyOnceWith(born(), assignment)
    for (const worker of [primary, { ...extra, phase: 'bound' as const }]) {
      assignmentWasAccepted.mockClear()
      const input = kept([worker])
      const settled = reconcileProfileExecution(
        input,
        database([worker.conversation], [], {
          assignmentWasAccepted,
          legacyPrimaryMatches: () => worker.number !== 1,
        }),
      )
      expect(settled).toEqual({ ...unchanged(input), conflicts: [IDENTITY] })
      expect(assignmentWasAccepted).not.toHaveBeenCalled()
    }
  })

  it('[H10] conflicts anywhere preserve every assignment and prevent partial acceptance checks', () => {
    const inputs = [kept([primary, { ...extra, phase: 'bound' as const }]), kept(), kept()]
    const databases = [
      database(),
      database(undefined, [born(), born(extra)]),
      database(undefined, undefined, {
        servicesBorn: [{ identity: IDENTITY, conversation: 'unexpected-service' }],
      }),
    ]
    inputs.forEach((input, index) => {
      const before = JSON.stringify(input)
      const assignmentWasAccepted = vi.fn(() => true)
      const db = databases[index]
      if (db === undefined) throw new Error('missing fictional evidence')
      const settled = reconcileProfileExecution(input, { ...db, assignmentWasAccepted })
      expect(settled).toEqual({ ...unchanged(input), conflicts: [IDENTITY] })
      expect(assignmentWasAccepted).not.toHaveBeenCalled()
      expect(JSON.stringify(input)).toBe(before)
    })
  })

  it('[H11] workers without holds and legacy/service entries keep their existing recovery semantics', () => {
    const input: KeptProfileExecution = {
      profiles: {
        ...kept([withoutAssignment(primary)]).profiles,
        'aid:legacy': { kind: 'normal', identityCreatedAt: CREATED },
        'aid:service': { kind: 'service', identityCreatedAt: CREATED, reserved: 'service-worker' },
      },
    }
    const assignmentWasAccepted = vi.fn(() => true)
    const settled = reconcileProfileExecution(
      input,
      database([primary.conversation, 'service-worker'], [born()], {
        assignmentWasAccepted,
        servicesBorn: [{ identity: 'aid:service', conversation: 'service-worker' }],
      }),
    )
    expect(settled).toEqual({
      kept: {
        profiles: {
          ...input.profiles,
          'aid:service': {
            kind: 'service',
            identityCreatedAt: CREATED,
            serviceConversation: 'service-worker',
          },
        },
      },
      changed: true,
      moved: ['aid:service'],
      conflicts: [],
    })
    expect(assignmentWasAccepted).not.toHaveBeenCalled()
  })

  it('[N01] a proved never-born primary records its marker while preserving a bound extra and counter', () => {
    const reservedPrimary = { ...primary, phase: 'reserved' as const }
    const boundExtra = { ...extra, phase: 'bound' as const }
    const input = kept([reservedPrimary, boundExtra])
    const before = JSON.stringify(input)
    const settled = reconcileProfileExecution(input, database([extra.conversation], [born(extra)]))
    expect(settled).toEqual({
      kept: kept([boundExtra], { primaryNeverBorn: true }),
      changed: true,
      moved: [IDENTITY],
      conflicts: [],
    })
    expect(JSON.stringify(input)).toBe(before)
    writeProfileExecution(file, settled.kept)
    expect(readProfileExecution(file)).toEqual({ readable: true, kept: settled.kept })
  })

  it('[N02] recorded, conflicting or merely absent primaries never imply a never-born marker', () => {
    const reservedPrimary = { ...primary, phase: 'reserved' as const }
    const boundExtra = { ...extra, phase: 'bound' as const }
    const input = kept([reservedPrimary, boundExtra])
    const cases = [
      {
        input,
        db: database([primary.conversation, extra.conversation], [born(), born(extra)]),
        expected: {
          kept: kept([primary, boundExtra]),
          changed: true,
          moved: [IDENTITY],
          conflicts: [],
        },
      },
      {
        input,
        db: database([extra.conversation], [{ ...born(), giver: 'wrong' }, born(extra)]),
        expected: { ...unchanged(input), conflicts: [IDENTITY] },
      },
      {
        input,
        db: database([primary.conversation, extra.conversation], [born(extra)], {
          legacyPrimaryMatches: () => false,
        }),
        expected: { ...unchanged(input), conflicts: [IDENTITY] },
      },
      {
        input: kept([primary, boundExtra]),
        db: database([extra.conversation], [born(extra)]),
        expected: { ...unchanged(kept([primary, boundExtra])), conflicts: [IDENTITY] },
      },
      {
        input: kept([], { nextNumber: 1 }),
        db: database([], []),
        expected: unchanged(kept([], { nextNumber: 1 })),
      },
      { input: kept([]), db: database([], []), expected: unchanged(kept([])) },
      {
        input: kept([boundExtra]),
        db: database([extra.conversation], [born(extra)]),
        expected: unchanged(kept([boundExtra])),
      },
    ]
    for (const row of cases) {
      const settled = reconcileProfileExecution(row.input, row.db)
      expect(settled).toEqual(row.expected)
      expect(settled.kept.profiles[IDENTITY]?.workerPools?.[0]?.primaryNeverBorn).toBeUndefined()
    }
  })

  it('[N03] copies valid markers', () => {
    const boundExtra = { ...extra, phase: 'bound' as const }
    for (const input of [
      kept([], { nextNumber: 2, primaryNeverBorn: true }),
      kept([boundExtra], { primaryNeverBorn: true }),
    ]) {
      writeProfileExecution(file, input)
      expect(readProfileExecution(file)).toEqual({ readable: true, kept: input })
    }
  })

  it('[N04] existing proof survives assignment settlement and every conflicted entry unchanged', () => {
    const boundExtra = { ...extra, phase: 'bound' as const }
    const input = kept([boundExtra], { primaryNeverBorn: true })
    const before = JSON.stringify(input)
    const accepted = reconcileProfileExecution(
      input,
      database([extra.conversation], [born(extra)], {
        assignmentWasAccepted: () => true,
      }),
    )
    expect(accepted).toEqual({
      kept: kept([withoutAssignment(boundExtra)], { primaryNeverBorn: true }),
      changed: true,
      moved: [IDENTITY],
      conflicts: [],
    })
    for (const db of [
      database([], [born(extra)]),
      database([extra.conversation, primary.conversation], [born(extra), born()]),
      database([extra.conversation], [born(extra)], {
        servicesBorn: [{ identity: IDENTITY, conversation: 'unexpected-service' }],
      }),
    ]) {
      const assignmentWasAccepted = vi.fn(() => true)
      expect(reconcileProfileExecution(input, { ...db, assignmentWasAccepted })).toEqual({
        ...unchanged(input),
        conflicts: [IDENTITY],
      })
      expect(assignmentWasAccepted).not.toHaveBeenCalled()
    }
    expect(JSON.stringify(input)).toBe(before)
  })
})
