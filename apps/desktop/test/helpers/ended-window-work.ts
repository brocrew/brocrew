import { expect, vi } from 'vitest'
import { aServiceWorld } from './a-service-world'
import { createSessionStore, type SessionStore } from '../../src/main/db/session-store'
import { windowFoldCache } from '../../src/main/db/window-fold-cache'
import { readWindowWork } from '../../src/main/db/window-work-reading'
import type { TranscriptEvent } from '../../src/shared/conversation-events'

export type EndedWorld = ReturnType<typeof endedWindowWork>
export function endedWindowWork() {
  const world = aServiceWorld()
  const { store, db, folder } = world
  const create = (id: string, rootful = false) =>
    store.create({
      id,
      provider: 'codex',
      cwd: folder,
      profileId: 'brobot',
      approvalMode: 'ask',
      ...(rootful ? {} : { parentSessionId: 'giver' }),
    })
  create('giver', true)
  const append = (owner: string, event: TranscriptEvent) =>
    store.append(owner, store.nextOrdinal(owner), event, world.clock++)
  const give = (owner: string, piece = `${owner}-piece`) => {
    const root = store.rootOf('giver')!
    const number = store.numberUnder(root.piece)
    const fields = {
      piece,
      parent: root.piece,
      givenBy: 'giver',
      title: piece,
      brief: 'Fictional work. '.repeat(100),
    }
    store.recordGive(
      { ...fields, number, owner, folder: null, inputs: [] },
      store.nextOrdinal(owner),
      { ...fields, type: 'work_given', label: `${root.label}.${number}` },
      world.clock++,
    )
    return piece
  }
  const seed = (ending: 'answered' | 'withdrawn' | 'closed', rootful = false) => {
    for (let i = 0; i < 16; i++) {
      const owner = `holder-${String(i).padStart(2, '0')}`
      create(owner, rootful)
      const piece = give(owner)
      append(
        owner,
        ending === 'answered'
          ? {
              type: 'work_replied',
              piece,
              outcome: 'done',
              summary: 'Fictional answer',
              resources: [],
            }
          : { type: ending === 'closed' ? 'work_closed' : 'work_taken_back', piece, by: 'giver' },
      )
    }
  }
  function read(
    useProof: boolean,
    alter?: (store: SessionStore) => SessionStore,
    brokenLedger?: string,
  ) {
    const cache = windowFoldCache(32 * 1024)
    const pieces = cache.get('pieces')!
    const set = pieces.set.bind(pieces)
    let firstAdmitted = false
    vi.spyOn(pieces, 'set').mockImplementation((owner, value) => {
      set(owner, value)
      if (owner === 'holder-00' && pieces.has(owner)) firstAdmitted = true
      return pieces
    })
    const reads = { stalls: [] as string[], stops: [] as string[] }
    let phase: keyof typeof reads | undefined
    const prepare = db.prepare.bind(db)
    const observation = vi.spyOn(db, 'prepare').mockImplementation((sql) => {
      const statement = prepare(sql)
      if (sql.includes('json_remove') && sql.includes("type IN ('work_given'")) {
        const iterate = statement.iterate.bind(statement)
        vi.spyOn(statement, 'iterate').mockImplementation(function* (...args) {
          if (phase !== undefined) reads[phase].push(String(args[0]))
          if (args[0] === brokenLedger) throw new Error('Fictional ledger read failure')
          yield* iterate(...args)
        })
      }
      return statement
    })
    try {
      const answer = db
        .transaction(() => {
          let snapshot = createSessionStore(
            db,
            () => world.clock,
            undefined,
            Math.random,
            undefined,
            true,
            cache,
          )
          if (alter) snapshot = alter(snapshot)
          const observed = new Proxy(snapshot, {
            get(target, key) {
              const method = Reflect.get(target, key)
              if (
                key !== 'stalledWorkNobodyWasToldAbout' &&
                key !== 'stalledWorkItsGiverWasToldAbout'
              )
                return method
              return (...args: unknown[]) => {
                phase = key === 'stalledWorkNobodyWasToldAbout' ? 'stalls' : 'stops'
                try {
                  return Reflect.apply(method, target, useProof ? args : args.slice(0, 1))
                } finally {
                  phase = undefined
                }
              }
            },
          })
          return readWindowWork(db, observed)
        })
        .deferred()
      return { answer, reads, firstAdmitted, firstEvicted: !pieces.has('holder-00') }
    } finally {
      observation.mockRestore()
    }
  }
  function compare(alter?: (store: SessionStore) => SessionStore, brokenLedger?: string) {
    const canonical = read(false, alter, brokenLedger)
    const reused = read(true, alter, brokenLedger)
    expect(reused.answer).toEqual(canonical.answer)
    return { canonical, reused }
  }
  return { ...world, create, append, give, seed, read, compare }
}
