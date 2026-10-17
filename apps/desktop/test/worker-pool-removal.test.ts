import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PROFILE_EXECUTION_VERSION,
  profileExecutionFile,
  readProfileExecution,
  reconcileProfileExecution,
  writeProfileExecution,
  type KeptProfileExecution,
  type NormalWorkerBinding,
  type NormalWorkerPool,
  type WhatTheDatabaseHolds,
  type WorkerBorn,
} from '../src/main/profile-execution-file'

// Fictional side files and pure database evidence; no host, provider or SQLite tree is opened.
const IDENTITY = 'aid:document-reader'
const CREATED = 42
const primary: NormalWorkerBinding = {
  number: 1,
  conversation: 'primary-reader',
  phase: 'bound',
  assignment: { piece: 'piece-a', giver: 'current-reviewer' },
}
const extra: NormalWorkerBinding = {
  number: 4,
  conversation: 'extra-reader',
  phase: 'reserved',
  assignment: { piece: 'piece-b', giver: 'current-reviewer' },
}
const pool = (fields: Partial<NormalWorkerPool> = {}): NormalWorkerPool => ({
  giver: 'reviewer',
  nextNumber: 12,
  workers: [primary, extra],
  removing: true,
  ...fields,
})
const kept = (pools: readonly NormalWorkerPool[] = [pool()]): KeptProfileExecution => ({
  profiles: { [IDENTITY]: { kind: 'normal', identityCreatedAt: CREATED, workerPools: pools } },
})
const born = (worker = primary, giver = 'reviewer'): WorkerBorn => ({
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
  identityCreatedAt: () => CREATED,
  hasConversation: (conversation) => conversations.includes(conversation),
  servicesBorn: [],
  workersBorn,
  ...overrides,
})
const unchanged = (input: KeptProfileExecution, conflicts: readonly string[] = []) => ({
  kept: input,
  changed: false,
  moved: [],
  conflicts,
})
const changed = (pools: readonly NormalWorkerPool[]) => ({
  kept: kept(pools),
  changed: true,
  moved: [IDENTITY],
  conflicts: [],
})

let folder: string
let file: string
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'brocrew-pool-removal-'))
  file = profileExecutionFile(folder)
})
afterEach(() => rmSync(folder, { recursive: true, force: true }))

describe('durable giver pool removal', () => {
  it('[D01] round trips removal intent and all existing holds and never-born metadata', () => {
    const input = kept([
      pool(),
      pool({
        giver: 'other-reviewer',
        workers: [{ ...extra, conversation: 'other-extra' }],
        primaryNeverBorn: true,
      }),
    ])
    writeProfileExecution(file, input)
    const read = readProfileExecution(file)
    expect(read).toEqual({ readable: true, kept: input })
    if (!read.readable) throw new Error('expected readable fictional side file')
    expect(read.kept.profiles[IDENTITY]?.workerPools?.[0]).not.toBe(
      input.profiles[IDENTITY]?.workerPools?.[0],
    )
    expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(2)
    expect(PROFILE_EXECUTION_VERSION).toBe(2)
    writeFileSync(file, JSON.stringify({ version: 1, profiles: input.profiles }))
    expect(readProfileExecution(file).readable).toBe(false)
  })

  it('[D02] rejects false or unknown intent fields before replacing a valid file', () => {
    for (const fields of [
      { removing: false },
      { removing: null },
      { removing: 'yes' },
      { removing: {} },
      { removing: true, futureRemoval: true },
      { removing: true, futureRemoval: undefined },
    ]) {
      writeProfileExecution(file, kept())
      const previous = readFileSync(file, 'utf8')
      const malformed = kept([pool(fields as unknown as Partial<NormalWorkerPool>)])
      expect(() => writeProfileExecution(file, malformed)).toThrow('invalid entry')
      expect(readFileSync(file, 'utf8')).toBe(previous)
      if (!Object.hasOwn(fields, 'futureRemoval') || fields.futureRemoval !== undefined) {
        writeFileSync(file, JSON.stringify({ version: 2, profiles: malformed.profiles }))
        expect(readProfileExecution(file).readable).toBe(false)
      }
    }
  })

  it('[D03] undoes a pre-delete intent only after the existing worker proofs pass', () => {
    const input = kept()
    const before = JSON.stringify(input)
    const assignmentWasAccepted = vi.fn(() => false)
    const settled = reconcileProfileExecution(
      input,
      database(['reviewer', primary.conversation, extra.conversation], [born(), born(extra)], {
        workerMatches: () => true,
        assignmentWasAccepted,
      }),
    )
    expect(settled).toEqual(
      changed([pool({ removing: undefined, workers: [primary, { ...extra, phase: 'bound' }] })]),
    )
    expect(Object.hasOwn(settled.kept.profiles[IDENTITY]?.workerPools?.[0] ?? {}, 'removing')).toBe(
      false,
    )
    expect(assignmentWasAccepted).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(input)).toBe(before)
    expect(
      reconcileProfileExecution(
        settled.kept,
        database(['reviewer', primary.conversation, extra.conversation], [born(), born(extra)]),
      ),
    ).toEqual(unchanged(settled.kept))
  })

  it('[D04] drops a fully deleted marked pool without settling vanished assignments', () => {
    const input = kept()
    const assignmentWasAccepted = vi.fn(() => true)
    const settled = reconcileProfileExecution(input, database([], [], { assignmentWasAccepted }))
    expect(settled).toEqual(changed([]))
    expect(assignmentWasAccepted).not.toHaveBeenCalled()
    expect(input).toEqual(kept())
    expect(reconcileProfileExecution(settled.kept, database())).toEqual(unchanged(settled.kept))
  })

  it('[D05] holds partial deletion or remaining pool facts, including a foreign binding collision', () => {
    const input = kept()
    for (const evidence of [
      database([primary.conversation]),
      database([extra.conversation]),
      database([], [born()]),
      database([], [born(extra)]),
      database([], [born({ ...extra, number: 7, conversation: 'unnamed-reader' })]),
      database([], [{ ...born(), identity: 'aid:foreign', giver: 'foreign-reviewer' }]),
      database([], [], { workersBorn: undefined }),
    ]) {
      const assignmentWasAccepted = vi.fn(() => true)
      const settled = reconcileProfileExecution(input, { ...evidence, assignmentWasAccepted })
      expect(settled.kept).toEqual(input)
      expect(settled.changed).toBe(false)
      expect(settled.moved).toEqual([])
      expect(settled.conflicts).toContain(IDENTITY)
      expect(settled.kept.profiles[IDENTITY]).toBe(input.profiles[IDENTITY])
      expect(assignmentWasAccepted).not.toHaveBeenCalled()
    }
  })

  it('[D06] missing conversations without prior intent keep the existing bound-pool conflict', () => {
    const input = kept([pool({ removing: undefined })])
    const settled = reconcileProfileExecution(input, database())
    expect(settled).toEqual(unchanged(input, [IDENTITY]))
    expect(settled.kept.profiles[IDENTITY]).toBe(input.profiles[IDENTITY])
  })

  it('[D07] preserves sibling pools, counters, holds and never-born proof when a marked pool is gone', () => {
    const sibling = pool({
      giver: 'other-reviewer',
      nextNumber: 29,
      removing: undefined,
      primaryNeverBorn: true,
      workers: [{ ...extra, conversation: 'other-extra', phase: 'bound' }],
    })
    const input = kept([pool(), sibling])
    const settled = reconcileProfileExecution(
      input,
      database(['other-reviewer', 'other-extra'], [born(sibling.workers[0], sibling.giver)]),
    )
    expect(settled).toEqual(changed([sibling]))
    expect(settled.kept.profiles[IDENTITY]?.workerPools?.[0]?.workers[0]).toBe(sibling.workers[0])
    expect(input).toEqual(kept([pool(), sibling]))

    // Another profile's unrelated worker under the same giver is a different pool.
    const foreignIdentity = 'aid:other-reader'
    const foreignWorker = { ...primary, conversation: 'foreign-reader' }
    const foreignEntry = {
      kind: 'normal' as const,
      identityCreatedAt: CREATED,
      workerPools: [{ giver: 'reviewer', nextNumber: 2, workers: [foreignWorker] }],
    }
    const withForeign = { profiles: { ...input.profiles, [foreignIdentity]: foreignEntry } }
    const scoped = reconcileProfileExecution(
      withForeign,
      database(
        ['other-reviewer', 'other-extra', foreignWorker.conversation],
        [
          born(sibling.workers[0], sibling.giver),
          { ...born(foreignWorker), identity: foreignIdentity },
        ],
      ),
    )
    expect(scoped).toEqual({
      ...changed([sibling]),
      kept: { profiles: { ...kept([sibling]).profiles, [foreignIdentity]: foreignEntry } },
    })
    expect(scoped.kept.profiles[foreignIdentity]).toBe(foreignEntry)
  })

  it('[D08] validates every pool before callbacks and rolls back intent changes on later conflict', () => {
    const siblingWorker = { ...primary, conversation: 'other-primary' }
    const sibling = pool({ giver: 'other-reviewer', workers: [siblingWorker], removing: undefined })
    const input = kept([pool({ workers: [primary] }), sibling])
    const recorded = [
      'reviewer',
      'other-reviewer',
      primary.conversation,
      siblingWorker.conversation,
    ]
    const facts = [born(), born(siblingWorker, sibling.giver)]
    const trace: string[] = []
    const good = reconcileProfileExecution(
      input,
      database(recorded, facts, {
        workerMatches: (fact) => {
          trace.push(`proof:${fact.conversation}`)
          return true
        },
        assignmentWasAccepted: (fact) => {
          trace.push(`accept:${fact.conversation}`)
          return false
        },
      }),
    )
    expect(good).toEqual(changed([pool({ workers: [primary], removing: undefined }), sibling]))
    expect(trace).toEqual([
      'proof:primary-reader',
      'proof:other-primary',
      'accept:primary-reader',
      'accept:other-primary',
    ])
    for (const evidence of [
      database(recorded, [facts[0]!, { ...facts[1]!, number: 9 }]),
      database(recorded, facts, { workerMatches: () => false, legacyPrimaryMatches: () => true }),
      database(['other-reviewer', siblingWorker.conversation], []),
      database(['reviewer', 'other-reviewer', siblingWorker.conversation], [facts[1]!]),
    ]) {
      const assignmentWasAccepted = vi.fn(() => true)
      const conflict = reconcileProfileExecution(input, { ...evidence, assignmentWasAccepted })
      expect(conflict).toEqual(unchanged(input, [IDENTITY]))
      expect(conflict.kept.profiles[IDENTITY]).toBe(input.profiles[IDENTITY])
      expect(assignmentWasAccepted).not.toHaveBeenCalled()
    }
  })
})
