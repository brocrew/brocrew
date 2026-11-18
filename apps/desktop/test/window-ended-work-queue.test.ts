import { afterEach, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { WindowReadEngine } from '../src/main/db/window-read-engine'
import { windowFoldCache } from '../src/main/db/window-fold-cache'
import { readWindowWork } from '../src/main/db/window-work-reading'
import { createSessionStore } from '../src/main/db/session-store'
import { rowsUnreadOnce } from '../src/main/db/rows-unread'
import type { AppDatabase } from '../src/main/db/connection'
import { endedWindowWork, type EndedWorld } from './helpers/ended-window-work'

const worlds: EndedWorld[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const world of worlds.splice(0)) await world.cleanUp()
})
function world() {
  const w = endedWindowWork()
  worlds.push(w)
  return w
}

it.each(['answered', 'withdrawn', 'closed'] as const)(
  'reuses clean %s proof under byte eviction without dropping walked ledgers',
  (ending) => {
    const w = world()
    w.seed(ending)
    const { canonical, reused } = w.compare()
    expect(reused.firstAdmitted).toBe(true)
    expect(reused.firstEvicted).toBe(true)
    const queue = reused.answer.queue!
    for (const fact of [queue.stalls, queue.stops]) {
      expect(fact).toEqual({
        value: {
          walk: 'every-conversation-that-was-given-work',
          ledgers: 16,
          rowsUnread: 0,
          rows: [],
        },
        skipped: [],
      })
    }
    expect(canonical.reads.stalls.length).toBeGreaterThan(0)
    expect(canonical.reads.stops.length).toBeGreaterThan(0)
    expect(reused.reads).toEqual({ stalls: [], stops: [] })
  },
)

it('reads late ended-piece edits and delivery markers before proving there is no open work', () => {
  const w = world()
  w.seed('answered')
  w.read(true)
  const piece = 'holder-00-piece'
  w.append('holder-00', { type: 'work_retitled', piece, title: 'Revised title', by: 'giver' })
  w.append('holder-00', { type: 'work_rebriefed', piece, brief: 'Revised brief', by: 'giver' })
  w.append('holder-00', { type: 'work_status_set', piece, line: 'Revised status', by: 'giver' })
  w.append('holder-00', {
    type: 'reply_undelivered',
    piece,
    parent: 'giver',
    because: 'not-delivered',
  })
  const { reused } = w.compare()
  expect(
    reused.answer.owners.find((one) => one.id === 'holder-00')!.naming.value.named,
  ).toMatchObject({ title: 'Revised title', ended: 'answered' })
  expect(w.store.piecesOwnedBy('holder-00')[0]).toMatchObject({
    title: 'Revised title',
    brief: 'Revised brief',
    statusLine: 'Revised status',
    state: 'answered',
    answerReachedNobody: true,
  })
  expect(reused.reads).toEqual({ stalls: [], stops: [] })
})

it('rechecks new open work and keeps told and untold stalls in their original order', () => {
  const w = world()
  w.seed('answered')
  w.read(true)
  for (const owner of ['holder-00', 'holder-01', 'holder-02']) {
    const piece = w.give(owner, `${owner}-new`)
    w.append(owner, { type: 'work_restarted', pieces: [piece] })
  }
  w.append('giver', {
    type: 'work_stall_told',
    piece: 'holder-01-new',
    cause: 'app_restarted',
    how: 'pushed',
  })
  const { reused } = w.compare()
  expect(reused.answer.queue!.stalls.value.rows.map((one) => one.piece)).toEqual([
    'holder-00-new',
    'holder-02-new',
  ])
  expect(reused.answer.queue!.stops.value.rows.map((one) => one.piece)).toEqual(['holder-01-new'])
  for (const reads of Object.values(reused.reads)) {
    expect(reads).toContain('holder-00')
    expect(reads).not.toContain('holder-03')
  }
  const proof = vi.fn(() => true)
  const ordinary = w.db.transaction(() =>
    w.store.stalledWorkNobodyWasToldAbout(rowsUnreadOnce(), proof),
  )()
  expect(ordinary.rows.map((one) => one.piece)).toEqual(['holder-00-new', 'holder-02-new'])
  expect(proof).not.toHaveBeenCalled()
})

it('does not shortcut rootful owners even when their child pieces ended', () => {
  const w = world()
  w.seed('closed', true)
  const { reused } = w.compare()
  expect(reused.answer.owners.find((one) => one.id === 'holder-00')!.openWork.value).not.toEqual([])
  expect(reused.reads.stalls).toContain('holder-00')
  expect(reused.reads.stops).toContain('holder-00')
})

it('falls back for absent naming instead of treating it as ended', () => {
  const w = world()
  w.seed('closed')
  const { reused } = w.compare((store) => {
    const naming = store.workThatNamesAndItsWait.bind(store)
    vi.spyOn(store, 'workThatNamesAndItsWait').mockImplementation((owner, unread) =>
      owner === 'holder-00' ? { named: null, waitingOnPurpose: null } : naming(owner, unread),
    )
    return store
  })
  expect(reused.reads.stalls).toEqual(['holder-00'])
  expect(reused.reads.stops).toEqual(['holder-00'])
})

it('replays unread rows independently for both stalled facts and retains full holder coverage', () => {
  const w = world()
  w.seed('withdrawn')
  const ordinal = w.store.nextOrdinal('holder-00')
  w.db
    .prepare(
      'INSERT INTO events(id,session_id,ordinal,type,payload,created_at,generation) VALUES(?,?,?,?,?,?,0)',
    )
    .run('fictional-malformed', 'holder-00', ordinal, 'work_status_set', '{', w.clock++)
  const { reused } = w.compare()
  for (const fact of [reused.answer.queue!.stalls, reused.answer.queue!.stops]) {
    expect(fact.skipped).toEqual([['holder-00', [ordinal]]])
    expect(fact.value).toMatchObject({ ledgers: 16, rowsUnread: 1, rows: [] })
  }
  expect(reused.reads.stalls).toContain('holder-00')
  expect(reused.reads.stops).toContain('holder-00')
})

it.each([false, true])(
  'expires a captured proof after queue construction, including failure=%s',
  (fail) => {
    const w = world()
    w.seed('closed')
    let proof: ((owner: string) => boolean) | undefined
    const read = () =>
      w.read(true, (store) => {
        const stalled = store.stalledWorkNobodyWasToldAbout.bind(store)
        vi.spyOn(store, 'stalledWorkNobodyWasToldAbout').mockImplementation((unread, noOpen) => {
          proof = noOpen
          expect(proof?.('holder-00')).toBe(true)
          if (fail) throw new Error('Fictional queue read failure')
          return stalled(unread, noOpen)
        })
        return store
      })
    if (fail) expect(read).toThrow('Fictional queue read failure')
    else read()
    expect(proof?.('holder-00')).toBe(false)
    expect(w.db.inTransaction).toBe(false)
  },
)

it('does not use proof outside an immutable snapshot transaction', () => {
  const w = world()
  w.seed('closed')
  const snapshot = createSessionStore(
    w.db,
    () => w.clock,
    undefined,
    Math.random,
    undefined,
    true,
    windowFoldCache(0),
  )
  let proof: ((owner: string) => boolean) | undefined
  const stalled = snapshot.stalledWorkNobodyWasToldAbout.bind(snapshot)
  vi.spyOn(snapshot, 'stalledWorkNobodyWasToldAbout').mockImplementation((unread, noOpen) => {
    proof = noOpen
    expect(noOpen?.('holder-00')).toBe(false)
    return stalled(unread, noOpen)
  })
  expect(readWindowWork(w.db, snapshot).queue!.stalls.value.ledgers).toBe(16)
  expect(proof?.('holder-00')).toBe(false)
})

it('still refuses cancellation after consuming ended-work proof, then permits a fresh reading', () => {
  const w = world()
  w.seed('answered')
  const engine = new WindowReadEngine(join(w.folder, 'brobot2.sqlite'))
  Object.assign(engine, { answers: windowFoldCache(0) })
  const native = (engine as unknown as { db: AppDatabase }).db
  const prepare = native.prepare.bind(native)
  let done = false
  const observation = vi.spyOn(native, 'prepare').mockImplementation((sql) => {
    const statement = prepare(sql)
    if (
      sql.includes(
        'SELECT DISTINCT owner_session_id AS id FROM work WHERE given_by_session_id IS NOT NULL',
      )
    ) {
      const all = statement.all.bind(statement)
      vi.spyOn(statement, 'all').mockImplementation((...args) => {
        done = true
        return all(...args)
      })
    }
    return statement
  })
  try {
    expect(() => engine.read({ kind: 'routes' }, () => done)).toThrow()
    expect(done).toBe(true)
    expect(native.inTransaction).toBe(false)
    observation.mockRestore()
    expect(engine.read({ kind: 'routes' }).kind).toBe('routes')
  } finally {
    engine.close()
  }
})
