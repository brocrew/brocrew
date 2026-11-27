import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { sameWindowWriter } from '../src/main/db/window-routing-reads'
import { WindowReadEngine } from '../src/main/db/window-read-engine'
import type { WindowReadResult } from '../src/main/db/window-read-protocol'
import { windowWriterSampler } from '../src/main/db/window-writer-stamp'
import { filesLibraryFixture } from './helpers/files-library-fixture'

/**
 * After a restart the window's first list starts from the checkpoint of its folds: a ledger whose
 * kept fold is proven current is not folded again, and the answer is the cold answer. An append, a
 * rewrite in place and a new build each fold that ledger again.
 */
afterEach(() => vi.restoreAllMocks())

/** The fictional files workspace, its conversations each with a status row to fold. */
function fixture() {
  const f = filesLibraryFixture()
  onTestFinished(() => f.close())
  f.example()
  const conversations = (
    f.db.prepare('SELECT id FROM provider_session ORDER BY id').all() as { id: string }[]
  ).map((row) => row.id)
  const status = (id: string, state: string) =>
    f.store.append(id, f.store.nextOrdinal(id), { type: 'status', state } as never, 3)
  for (const id of conversations) status(id, 'working')
  // One given task told in its holder's ledger, so that ledger has pieces to fold.
  const given = f.db
    .prepare(
      `SELECT id, parent_id AS parent, owner_session_id AS holder, given_by_session_id AS giver, title
         FROM work WHERE given_by_session_id IS NOT NULL ORDER BY id LIMIT 1`,
    )
    .get() as { id: string; parent: string; holder: string; giver: string; title: string }
  f.store.append(
    given.holder,
    f.store.nextOrdinal(given.holder),
    {
      type: 'work_given',
      piece: given.id,
      label: 'W1.1',
      parent: given.parent,
      givenBy: given.giver,
      title: given.title,
      brief: given.title,
    } as never,
    3,
  )
  status(given.holder, 'working')
  return { ...f, status, holder: given.holder }
}

/** An engine whose piece-fold rows are counted, as a restarted worker would read them. */
function anEngine(file: string, madeBy?: string) {
  const engine = new WindowReadEngine(file, madeBy)
  onTestFinished(() => engine.close())
  const db = (engine as unknown as { db: AppDatabase }).db
  const prepare = db.prepare.bind(db)
  const counted = { rows: 0 }
  vi.spyOn(db, 'prepare').mockImplementation((sql) => {
    const statement = prepare(sql)
    if (sql.includes('json_remove')) {
      const iterate = statement.iterate.bind(statement)
      vi.spyOn(statement, 'iterate').mockImplementation(function* (...args) {
        for (const row of iterate(...args)) yield (counted.rows++, row)
      })
    }
    return statement
  })
  return { engine, counted }
}

const withoutToken = (result: WindowReadResult) => {
  const { cacheToken: _token, ...rest } = result as WindowReadResult & { cacheToken?: string }
  void _token
  return rest
}

const seenAt = (db: AppDatabase) => BigInt(db.pragma('data_version', { simple: true }) as number)

function keepTheCheckpoint(f: ReturnType<typeof fixture>, madeBy: string) {
  const { engine } = anEngine(f.file, madeBy)
  const listing = engine.read({ kind: 'listing' }) as WindowReadResult & { cacheToken: string }
  const kept = engine.read({
    kind: 'checkpoint',
    reuse: { token: listing.cacheToken, changed: [] },
  })
  if (kept.kind !== 'checkpoint') throw new Error('no checkpoint')
  expect(kept.rows.length).toBeGreaterThan(0)
  expect(f.store.keepWindowFoldCheckpoint(madeBy, kept.rows, seenAt(f.db))).toBe(true)
  return withoutToken(listing)
}

it('a restarted reader starts from the checkpoint and gives the cold answer, folding nothing', () => {
  const f = fixture()
  const cold = keepTheCheckpoint(f, 'fictional-build')
  const restarted = anEngine(f.file, 'fictional-build')
  expect(withoutToken(restarted.engine.read({ kind: 'listing' }))).toEqual(cold)
  expect(restarted.counted.rows).toBe(0)
})

it('an append, a rewrite in place and another build each fold again and still give the cold answer', () => {
  const f = fixture()
  keepTheCheckpoint(f, 'fictional-build')
  const coldNow = () => withoutToken(anEngine(f.file).engine.read({ kind: 'listing' }))

  f.status(f.holder, 'idle')
  const appended = anEngine(f.file, 'fictional-build')
  expect(withoutToken(appended.engine.read({ kind: 'listing' }))).toEqual(coldNow())
  expect(appended.counted.rows).toBeGreaterThan(0)

  keepTheCheckpoint(f, 'fictional-build')
  f.db
    .prepare(
      `UPDATE events SET payload = '{"type":"status","state":"ended"}'
        WHERE session_id = ? AND type = 'status'
          AND ordinal = (SELECT max(ordinal) FROM events WHERE session_id = ?)`,
    )
    .run(f.holder, f.holder)
  const rewritten = anEngine(f.file, 'fictional-build')
  expect(withoutToken(rewritten.engine.read({ kind: 'listing' }))).toEqual(coldNow())
  expect(rewritten.counted.rows).toBeGreaterThan(0)

  keepTheCheckpoint(f, 'fictional-build')
  const otherBuild = anEngine(f.file, 'another-build')
  expect(withoutToken(otherBuild.engine.read({ kind: 'listing' }))).toEqual(coldNow())
  expect(otherBuild.counted.rows).toBeGreaterThan(0)
})

it('keeping the checkpoint moves no window answer', () => {
  const f = fixture()
  const sample = windowWriterSampler(f.db, () => true)
  const before = sample({ kind: 'listing' })
  keepTheCheckpoint(f, 'fictional-build')
  expect(sameWindowWriter(before, sample({ kind: 'listing' }))).toBe(true)
})

it('a commit by another connection after the writer looked keeps nothing, so no rewrite slips in', () => {
  const f = fixture()
  const { engine } = anEngine(f.file, 'fictional-build')
  const listing = engine.read({ kind: 'listing' }) as WindowReadResult & { cacheToken: string }
  const kept = engine.read({
    kind: 'checkpoint',
    reuse: { token: listing.cacheToken, changed: [] },
  })
  if (kept.kind !== 'checkpoint') throw new Error('no checkpoint')
  const looked = seenAt(f.db)
  const other = openDatabase(f.file)
  other
    .prepare(
      `UPDATE events SET payload = '{"type":"status","state":"ended"}'
        WHERE session_id = ? AND type = 'status'`,
    )
    .run(f.holder)
  other.close()
  expect(f.store.keepWindowFoldCheckpoint('fictional-build', kept.rows, looked)).toBe(false)
  expect(f.db.prepare('SELECT count(*) AS n FROM window_fold_checkpoint').get()).toEqual({ n: 0 })
})
