import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { rowsUnreadOnce } from '../src/main/db/rows-unread'
import { windowFoldCache } from '../src/main/db/window-fold-cache'
import { WindowReadEngine } from '../src/main/db/window-read-engine'
import { adoptOwnerWithChild } from './helpers/adopt-owner-with-child'
import { withoutBrief } from './helpers/window-incident-cases'

const cleanup: (() => void)[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const close of cleanup.splice(0).reverse()) close()
})

it.each([false, true])(
  'consumes an unretained incident piece fold once and preserves both skip sets (torn=%s)',
  (torn) => {
    const directory = mkdtempSync(join(tmpdir(), 'incident-pieces-'))
    const file = join(directory, 'fictional.sqlite')
    const db = openDatabase(file)
    cleanup.push(() => {
      db.close()
      rmSync(directory, { recursive: true, force: true })
    })
    applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
    const store = createSessionStore(db)
    adoptOwnerWithChild(store, 'alpha', directory, 'Fictional open work')
    store.append(
      'alpha',
      store.nextOrdinal('alpha'),
      {
        type: 'user_turn',
        text: 'Fictional words',
        humanInitiated: true,
      },
      2,
    )
    const skipped = store.nextOrdinal('alpha')
    if (torn)
      db.prepare(
        'INSERT INTO events(id,session_id,ordinal,type,payload,created_at,generation) VALUES(?,?,?,?,?,?,0)',
      ).run('fictional-torn-piece', 'alpha', skipped, 'work_status_set', '{', 3)
    const unread = rowsUnreadOnce()
    const expected = store.piecesOwnedBy('alpha', unread)
    const expectedOpen = store.openPiecesOf('alpha', rowsUnreadOnce())
    const engine = new WindowReadEngine(file)
    cleanup.push(() => engine.close())
    // Exercise the canonical read when the existing cache cannot retain an entry.
    Object.assign(engine, { answers: windowFoldCache(0) })
    const native = (engine as unknown as { db: AppDatabase }).db
    const prepare = native.prepare.bind(native)
    let pieceReads = 0
    let readsBeforeNewestTurn: number | undefined
    vi.spyOn(native, 'prepare').mockImplementation((sql) => {
      const statement = prepare(sql)
      if (sql.includes('json_remove') && sql.includes("type IN ('work_given'")) {
        const iterate = statement.iterate.bind(statement)
        vi.spyOn(statement, 'iterate').mockImplementation(function* (...args) {
          pieceReads++
          yield* iterate(...args)
        })
      }
      if (
        sql ===
        'SELECT id FROM turn WHERE session_id = ? ORDER BY generation DESC, ordinal DESC LIMIT 1'
      ) {
        const get = statement.get.bind(statement)
        vi.spyOn(statement, 'get').mockImplementation((...args) => {
          readsBeforeNewestTurn ??= pieceReads
          return get(...args)
        })
      }
      return statement
    })
    const result = engine.read({ kind: 'incidents' })
    if (result.kind !== 'incidents') throw new Error('wrong incident reading')
    const owner = result.owners.find((one) => one.sessionId === 'alpha')!
    // Incident reads carry open pieces without their brief text.
    expect(owner.pieces).toEqual(expectedOpen.map(withoutBrief))
    expect(owner.history.states).toEqual(expected.map((one) => [one.piece, one.state]))
    expect(unread.count).toBe(torn ? 1 : 0)
    expect(owner.piecesSkipped).toEqual(torn ? [skipped] : [])
    expect(owner.history.statesSkipped).toEqual(owner.piecesSkipped)
    // The terminal is now selected before the one shared current/cut replay begins.
    expect(readsBeforeNewestTurn).toBe(0)
    expect(pieceReads).toBe(1)
  },
)
