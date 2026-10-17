import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { WALL_QUEUE_AT_MOST } from '../src/main/db/provider-wall-watch'
import { createSessionStore, rowsUnreadOnce, type SessionStore } from '../src/main/db/session-store'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * The reads the main thread repeats are kept between calls and carried forward with the rows
 * written since: the provider walls, with the launches and turns that date and retract them, and
 * one conversation's routed requests, questions and receipts. Each writer that can change an answer
 * is shown to change it, and a kept answer is always what reading everything again says.
 */
const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const NOW = Date.UTC(2026, 9, 16, 4)
const FIVE_HOUR = 'claude is rate-limited (five_hour)'
const SEVEN_DAY = 'claude is rate-limited (seven_day)'

let folder: string
let file: string
let db: AppDatabase
let store: SessionStore
/** The SQL of every statement run on the store's connection, in order. */
let ran: string[]

function counting(target: AppDatabase): void {
  const prepare = target.prepare.bind(target)
  vi.spyOn(target, 'prepare').mockImplementation((sql) => {
    const statement = prepare(sql)
    for (const name of ['get', 'all'] as const) {
      const read = statement[name].bind(statement)
      vi.spyOn(statement, name).mockImplementation((...args: unknown[]) => {
        ran.push(sql)
        return read(...args)
      })
    }
    return statement
  })
}

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'brobot2-kept-reads-'))
  file = join(folder, 'brobot2.sqlite')
  db = openDatabase(file)
  applyMigrations(db, migrations)
  ran = []
  counting(db)
  store = createSessionStore(db, () => NOW)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  db.close()
  rmSync(folder, { recursive: true, force: true })
})

const conversation = (id: string, provider: 'claude' | 'codex' = 'claude'): string => {
  store.create({ id, provider, cwd: folder, approvalMode: 'ask', profileId: 'agent' })
  return id
}
const put = (id: string, event: TranscriptEvent, at = NOW - HOUR): number => {
  const ordinal = store.nextOrdinal(id)
  store.append(id, ordinal, event, at)
  return ordinal
}
const raw = (
  id: string,
  type: string,
  payload: object | string,
  at: number,
  ordinal = store.nextOrdinal(id),
  generation = 0,
): string => {
  const key = `raw-${id}-${generation}-${ordinal}`
  db.prepare(
    `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    key,
    id,
    generation,
    ordinal,
    type,
    typeof payload === 'string' ? payload : JSON.stringify(payload),
    at,
  )
  return key
}
const walled = (id: string, said = FIVE_HOUR, at = NOW - 3 * HOUR): number =>
  put(id, { type: 'error', fatal: false, message: said }, at)
const aTurn = (id: string, ended: number): void => {
  put(id, { type: 'user_turn', text: 'fictional words' }, ended - 60_000)
  put(id, { type: 'turn', state: 'completed' }, ended)
}
/** How many times the month of walls was read from its first row. */
const wholeWallReads = (): number =>
  ran.filter((sql) => sql.includes('ORDER BY created_at, rowid LIMIT')).length
/** What reading everything again says: a store on a connection of its own. */
function readAgain<T>(read: (fresh: SessionStore) => T): T {
  const other = openDatabase(file)
  try {
    return read(createSessionStore(other, () => NOW))
  } finally {
    other.close()
  }
}

describe('the provider walls, kept between reads', () => {
  it('a wall written through the store is taken in without reading the month again', () => {
    conversation('a')
    walled('a')
    expect(store.providerLimitsSeen(NOW).rows).toHaveLength(1)
    ran.length = 0
    walled('a', SEVEN_DAY, NOW - 2 * HOUR)
    const seen = store.providerLimitsSeen(NOW)
    expect(seen.rows.map((one) => one.window).sort()).toEqual(['five_hour', 'seven_day'])
    expect(wholeWallReads()).toBe(0)
    expect(seen).toEqual(readAgain((fresh) => fresh.providerLimitsSeen(NOW)))
  })

  it('a wall written in plain SQL on the same connection is taken in too', () => {
    conversation('a')
    expect(store.providerLimitsSeen(NOW).rows).toEqual([])
    ran.length = 0
    raw('a', 'error', { type: 'error', fatal: false, message: FIVE_HOUR }, NOW - HOUR)
    expect(store.providerLimitsSeen(NOW).rows).toHaveLength(1)
    expect(wholeWallReads()).toBe(0)
  })

  it('a wall another connection writes is read whole', () => {
    conversation('a')
    expect(store.providerLimitsSeen(NOW).rows).toEqual([])
    const other = openDatabase(file)
    try {
      other
        .prepare(
          `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
           VALUES ('elsewhere', 'a', 0, 7, 'error', ?, ?)`,
        )
        .run(JSON.stringify({ type: 'error', fatal: false, message: FIVE_HOUR }), NOW - HOUR)
    } finally {
      other.close()
    }
    ran.length = 0
    expect(store.providerLimitsSeen(NOW).rows).toHaveLength(1)
    expect(wholeWallReads()).toBeGreaterThan(0)
  })

  it('a wall removed, rewritten, or taken with its conversation is gone', () => {
    conversation('a')
    conversation('b')
    conversation('c')
    walled('a')
    const rewritten = raw('b', 'error', { type: 'error', fatal: false, message: SEVEN_DAY }, NOW)
    walled('c', FIVE_HOUR, NOW - 2 * HOUR)
    expect(store.providerLimitsSeen(NOW).rows).toHaveLength(2)
    db.prepare(`UPDATE events SET payload = ? WHERE id = ?`).run(
      JSON.stringify({ type: 'error', fatal: false, message: 'a fictional timeout' }),
      rewritten,
    )
    expect(store.providerLimitsSeen(NOW).rows.map((one) => one.window)).toEqual(['five_hour'])
    db.prepare(`DELETE FROM events WHERE session_id = 'c'`).run()
    expect(store.providerLimitsSeen(NOW).rows.map((one) => one.at)).toEqual([NOW - 3 * HOUR])
    store.deleteTheTree(['a'])
    ran.length = 0
    expect(store.providerLimitsSeen(NOW).rows).toEqual([])
    expect(wholeWallReads()).toBeGreaterThan(0)
  })

  it('a completed turn retracts a stopped wall, and the turn removed or reopened brings it back', () => {
    conversation('a')
    conversation('b')
    walled('a')
    expect(store.providerLimitsSeen(NOW).rows).toHaveLength(1)
    ran.length = 0
    aTurn('b', NOW - HOUR)
    expect(store.providerLimitsSeen(NOW).rows).toEqual([])
    expect(wholeWallReads()).toBe(0)
    db.prepare(`UPDATE turn SET end_reason = 'failed' WHERE session_id = 'b'`).run()
    expect(store.providerLimitsSeen(NOW).rows).toHaveLength(1)
    aTurn('b', NOW - 30 * 60_000)
    expect(store.providerLimitsSeen(NOW).rows).toEqual([])
    db.prepare(`DELETE FROM turn WHERE session_id = 'b'`).run()
    expect(store.providerLimitsSeen(NOW)).toEqual(
      readAgain((fresh) => fresh.providerLimitsSeen(NOW)),
    )
    expect(store.providerLimitsSeen(NOW).rows).toHaveLength(1)
  })

  it('a completed turn retracts only its own provider’s walls, read again when a provider changes', () => {
    conversation('a')
    conversation('b')
    walled('a')
    aTurn('b', NOW - HOUR)
    expect(store.providerLimitsSeen(NOW).rows).toEqual([])
    db.prepare(`UPDATE provider_session SET provider = 'codex' WHERE id = 'b'`).run()
    expect(store.providerLimitsSeen(NOW).rows).toHaveLength(1)
  })

  it('a clear of its window retracts it, and a torn clear is counted unread', () => {
    conversation('a')
    walled('a')
    expect(store.providerLimitsSeen(NOW).rows).toHaveLength(1)
    put(
      'a',
      { type: 'provider_limit_clear', window: 'seven_day', source: 'rate_limit_event' },
      NOW - HOUR,
    )
    expect(store.providerLimitsSeen(NOW).rows).toHaveLength(1)
    put(
      'a',
      { type: 'provider_limit_clear', window: 'five_hour', source: 'rate_limit_event' },
      NOW - HOUR,
    )
    expect(store.providerLimitsSeen(NOW).rows).toEqual([])
    walled('a', FIVE_HOUR, NOW - 30 * 60_000)
    expect(store.providerLimitsSeen(NOW)).toMatchObject({ rows: [{}], rowsUnread: 0 })
    raw('a', 'provider_limit_clear', '{not json', NOW - 10 * 60_000)
    const seen = store.providerLimitsSeen(NOW)
    expect(seen.rowsUnread).toBe(1)
    expect(seen).toEqual(readAgain((fresh) => fresh.providerLimitsSeen(NOW)))
  })

  it('a launch written below a wall later dates it to the life before a sign-in change', () => {
    const changed = new Map([['claude' as const, NOW - 2 * HOUR]])
    conversation('a')
    put('a', { type: 'status', state: 'idle' }, NOW - 4 * HOUR)
    walled('a', FIVE_HOUR, NOW - HOUR)
    expect(store.providerLimitsSeen(NOW, changed).rows).toHaveLength(1)
    // A rebuilt generation's launch, from before the change, below the wall's ordinal.
    raw('a', 'launched', { type: 'launched' }, NOW - 3 * HOUR, 0, 1)
    const seen = store.providerLimitsSeen(NOW, changed)
    expect(seen.rows).toEqual([])
    expect(seen).toEqual(readAgain((fresh) => fresh.providerLimitsSeen(NOW, changed)))
  })

  it('a wall written in a transaction that rolls back is never kept', () => {
    conversation('a')
    expect(store.providerLimitsSeen(NOW).rows).toEqual([])
    expect(() =>
      db.transaction(() => {
        walled('a')
        expect(store.providerLimitsSeen(NOW).rows).toHaveLength(1)
        throw new Error('rolled back')
      })(),
    ).toThrow('rolled back')
    expect(store.providerLimitsSeen(NOW).rows).toEqual([])
    walled('a')
    expect(store.providerLimitsSeen(NOW).rows).toHaveLength(1)
  })

  it('a clock a little behind reads nothing again, and one a month on lets the old walls go', () => {
    conversation('a')
    walled('a', FIVE_HOUR, NOW - 3 * HOUR)
    expect(store.providerLimitsSeen(NOW).rows).toHaveLength(1)
    ran.length = 0
    expect(store.providerLimitsSeen(NOW - 10 * 60_000).rows).toHaveLength(1)
    expect(wholeWallReads()).toBe(0)
    const later = NOW + 32 * DAY
    expect(store.providerLimitsSeen(later)).toEqual(
      readAgain((fresh) => fresh.providerLimitsSeen(later)),
    )
    expect(store.providerLimitsSeen(later).ledgers).toBe(0)
  })

  it('two stores on one connection share the kept read', () => {
    conversation('a')
    walled('a')
    expect(store.providerLimitsSeen(NOW).rows).toHaveLength(1)
    const second = createSessionStore(db, () => NOW)
    ran.length = 0
    expect(second.providerLimitsSeen(NOW).rows).toHaveLength(1)
    expect(wholeWallReads()).toBe(0)
    walled('a', SEVEN_DAY, NOW - HOUR)
    expect(second.providerLimitsSeen(NOW).rows).toHaveLength(2)
    expect(store.providerLimitsSeen(NOW).rows).toHaveLength(2)
  })

  it('a store on a wrapper of the connection reads every wall the other store does', () => {
    conversation('a')
    conversation('b')
    walled('a')
    aTurn('b', NOW - 2 * HOUR)
    expect(store.providerLimitsSeen(NOW).rows).toEqual([])
    walled('a', SEVEN_DAY, NOW - HOUR)
    // Its own kept read, begun now, over the same temp tables.
    const wrapped = createSessionStore(new Proxy(db, {}), () => NOW)
    expect(wrapped.providerLimitsSeen(NOW).rows.map((one) => one.window)).toEqual(['seven_day'])
    expect(store.providerLimitsSeen(NOW).rows.map((one) => one.window)).toEqual(['seven_day'])
    aTurn('b', NOW - 30 * 60_000)
    expect(store.providerLimitsSeen(NOW).rows).toEqual([])
    expect(wrapped.providerLimitsSeen(NOW).rows).toEqual([])
  })

  it('clears read ahead in slices are kept as a read that is not kept reads them', () => {
    conversation('a')
    walled('a', FIVE_HOUR, NOW - 20 * DAY)
    const sevenDay = (at: number) =>
      put(
        'a',
        { type: 'provider_limit_clear', window: 'seven_day', source: 'rate_limit_event' },
        at,
      )
    for (let n = 0; n < 10; n++) sevenDay(NOW - 20 * DAY + HOUR + n * 60_000)
    // In the first slice: the clear that retracts the wall.
    put(
      'a',
      { type: 'provider_limit_clear', window: 'five_hour', source: 'rate_limit_event' },
      NOW - 19 * DAY,
    )
    // Rows 241–260 share one instant, and a torn clear lands first in the second slice.
    const tied = NOW - 18 * DAY + 240 * 60_000
    for (let n = 0; n < 590; n++) {
      if (n === 245) raw('a', 'provider_limit_clear', '{not json', tied)
      sevenDay(n >= 230 && n <= 250 ? tied : NOW - 18 * DAY + n * 60_000)
    }
    const clearSlices = () =>
      ran.filter((sql) => sql.includes('ORDER BY e.created_at, e.rowid LIMIT')).length
    let steps = 0
    let wroteMidway = false
    while (!store.readAheadProviderWalls(NOW, 0)) {
      steps += 1
      if (!wroteMidway && clearSlices() === 1) {
        // Below where the slices have reached, while they are still being read.
        raw('a', 'provider_limit_clear', '{not json', NOW - 19 * DAY - HOUR)
        wroteMidway = true
      }
    }
    expect(wroteMidway).toBe(true)
    expect(clearSlices()).toBe(3)
    expect(steps).toBeGreaterThan(2)
    ran.length = 0
    const seen = store.providerLimitsSeen(NOW)
    expect(ran.filter((sql) => sql.includes('provider_limit_clear'))).toEqual([])
    expect(seen).toMatchObject({ rows: [], rowsUnread: 2 })
    expect(seen).toEqual(db.transaction(() => store.providerLimitsSeen(NOW))())
  })

  it('read ahead in steps, the walls are kept as a hold would read them at once', () => {
    conversation('a')
    conversation('b')
    for (let n = 0; n < 600; n++) {
      raw(
        n % 2 === 0 ? 'a' : 'b',
        'error',
        { type: 'error', fatal: false, message: n % 3 === 0 ? FIVE_HOUR : 'a fictional timeout' },
        NOW - 10 * DAY + n * 60_000,
      )
    }
    aTurn('b', NOW - 20 * DAY)
    let steps = 0
    while (!store.readAheadProviderWalls(NOW, 0)) steps += 1
    expect(steps).toBeGreaterThan(2)
    ran.length = 0
    const seen = store.providerLimitsSeen(NOW, new Map([['claude', NOW - 30 * DAY]]))
    expect(wholeWallReads()).toBe(0)
    expect(ran.some((sql) => sql.includes("type = 'launched' AND session_id = ?"))).toBe(false)
    expect(seen).toEqual(
      readAgain((fresh) => fresh.providerLimitsSeen(NOW, new Map([['claude', NOW - 30 * DAY]]))),
    )
    expect(seen.rows).toHaveLength(1)
    expect(store.readAheadProviderWalls(NOW, 0)).toBe(true)
  })

  it('rows written after the read-ahead is done are taken in by the read-ahead, a slice at a time', () => {
    conversation('a')
    walled('a')
    while (!store.readAheadProviderWalls(NOW, 0));
    for (let n = 0; n < 700; n++) {
      raw(
        'a',
        'error',
        { type: 'error', fatal: false, message: n % 2 ? SEVEN_DAY : 'a fictional timeout' },
        NOW - HOUR + n,
      )
    }
    const queueReads = () =>
      ran.filter((sql) => sql.includes('JOIN main.events e ON e.rowid = a.event_row')).length
    ran.length = 0
    let steps = 0
    while (!store.readAheadProviderWalls(NOW, 0)) steps += 1
    expect(steps).toBeGreaterThan(1)
    expect(queueReads()).toBeGreaterThan(2)
    ran.length = 0
    const seen = store.providerLimitsSeen(NOW)
    expect(queueReads()).toBe(0)
    expect(seen.rows.map((one) => one.window).sort()).toEqual(['five_hour', 'seven_day'])
    expect(seen).toEqual(readAgain((fresh) => fresh.providerLimitsSeen(NOW)))
  })

  it('a long queue is emptied once taken in, and a read that had not taken it in begins again', () => {
    conversation('a')
    walled('a')
    const wrapped = createSessionStore(new Proxy(db, {}), () => NOW)
    expect(store.providerLimitsSeen(NOW).rows).toHaveLength(1)
    expect(wrapped.providerLimitsSeen(NOW).rows).toHaveLength(1)
    // Long enough to be emptied once taken in, short of the queue's bound.
    db.transaction(() => {
      for (let n = 0; n < 2000; n++) {
        raw(
          'a',
          'error',
          { type: 'error', fatal: false, message: 'a fictional timeout' },
          NOW - HOUR + n,
        )
      }
    })()
    walled('a', SEVEN_DAY, NOW - 30 * 60_000)
    expect(store.providerLimitsSeen(NOW).rows).toHaveLength(2)
    const queued = () =>
      (db.prepare('SELECT count(*) AS n FROM temp.provider_wall_added').get() as { n: number }).n
    expect(queued()).toBe(0)
    ran.length = 0
    expect(wrapped.providerLimitsSeen(NOW).rows).toHaveLength(2)
    expect(wholeWallReads()).toBeGreaterThan(0)
    expect(wrapped.providerLimitsSeen(NOW)).toEqual(store.providerLimitsSeen(NOW))
  })

  it('a conversation launched too often keeps no launches, and a later launch below a wall is still read', () => {
    const changed = new Map([['claude' as const, NOW - 2 * HOUR]])
    conversation('a')
    db.transaction(() => {
      for (let n = 0; n < 1100; n++)
        raw('a', 'launched', { type: 'launched' }, NOW - 10 * DAY + n * 60_000)
    })()
    // After the sign-in changed, by a life that began before it.
    walled('a', FIVE_HOUR, NOW - HOUR)
    expect(store.providerLimitsSeen(NOW, changed).rows).toEqual([])
    while (!store.readAheadProviderWalls(NOW, 0));
    ran.length = 0
    expect(store.readAheadProviderWalls(NOW, 0)).toBe(true)
    expect(ran.filter((sql) => sql.includes("type = 'launched' AND session_id = ?"))).toEqual([])
    // A rebuilt generation's launch below the wall, after the change: its life began after it.
    raw('a', 'launched', { type: 'launched' }, NOW - 90 * 60_000, 0, 1)
    ran.length = 0
    const seen = store.providerLimitsSeen(NOW, changed)
    // Not kept, so read again for the wall's life.
    expect(ran.filter((sql) => sql.includes("type = 'launched' AND session_id = ?"))).toHaveLength(
      1,
    )
    expect(seen.rows).toHaveLength(1)
    expect(seen).toEqual(readAgain((fresh) => fresh.providerLimitsSeen(NOW, changed)))
  })

  const queued = () =>
    (db.prepare('SELECT count(*) AS n FROM temp.provider_wall_added').get() as { n: number }).n
  const queueReads = () =>
    ran.filter((sql) => sql.includes('JOIN main.events e ON e.rowid = a.event_row')).length
  const timeouts = (count: number) =>
    db.transaction(() => {
      for (let n = 0; n < count; n++) {
        raw(
          'a',
          'error',
          {
            type: 'error',
            fatal: false,
            message: n === count - 1 ? SEVEN_DAY : 'a fictional timeout',
          },
          NOW - HOUR + n,
        )
      }
    })()

  it('a hold takes in at most the queue’s bound: 4,096 rows, in slices of 256', () => {
    conversation('a')
    walled('a')
    while (!store.readAheadProviderWalls(NOW, 0));
    // The queue holds what was written since it was last emptied, taken in or not: fill it to its
    // bound.
    timeouts(WALL_QUEUE_AT_MOST - queued())
    expect(queued()).toBe(WALL_QUEUE_AT_MOST)
    ran.length = 0
    const seen = store.providerLimitsSeen(NOW)
    expect(wholeWallReads()).toBe(0)
    expect(queueReads()).toBeLessThanOrEqual(WALL_QUEUE_AT_MOST / 256 + 1)
    expect(seen.rows).toHaveLength(2)
    expect(seen).toEqual(readAgain((fresh) => fresh.providerLimitsSeen(NOW)))
  })

  it('past the bound the queue is emptied as it is written, and the next hold reads the month whole', () => {
    conversation('a')
    walled('a')
    while (!store.readAheadProviderWalls(NOW, 0));
    timeouts(10_000)
    expect(queued()).toBeLessThanOrEqual(WALL_QUEUE_AT_MOST)
    ran.length = 0
    const seen = store.providerLimitsSeen(NOW)
    expect(wholeWallReads()).toBeGreaterThan(0)
    expect(queueReads()).toBeLessThanOrEqual(WALL_QUEUE_AT_MOST / 256 + 1)
    expect(seen.rows).toHaveLength(2)
    expect(seen).toEqual(readAgain((fresh) => fresh.providerLimitsSeen(NOW)))
  })

  it('a wall watch taken away is put back, and nothing it kept answers', () => {
    conversation('a')
    walled('a')
    expect(store.providerLimitsSeen(NOW).rows).toHaveLength(1)
    db.exec('DROP TRIGGER temp.provider_wall_event_added')
    walled('a', SEVEN_DAY, NOW - HOUR)
    const seen = store.providerLimitsSeen(NOW)
    expect(seen.rows).toHaveLength(2)
    expect(seen).toEqual(readAgain((fresh) => fresh.providerLimitsSeen(NOW)))
    walled('a', SEVEN_DAY, NOW - 30 * 60_000)
    ran.length = 0
    expect(store.providerLimitsSeen(NOW)).toEqual(
      readAgain((fresh) => fresh.providerLimitsSeen(NOW)),
    )
    expect(wholeWallReads()).toBe(0)
  })

  it('a wall watch put back is put back whole: a turn completed while it was away is read', () => {
    conversation('a')
    conversation('b')
    walled('a')
    expect(store.providerLimitsSeen(NOW).rows).toHaveLength(1)
    db.exec('DROP TRIGGER temp.provider_wall_turn_completed')
    aTurn('b', NOW - HOUR)
    expect(store.providerLimitsSeen(NOW).rows).toEqual([])
    expect(store.providerLimitsSeen(NOW)).toEqual(
      readAgain((fresh) => fresh.providerLimitsSeen(NOW)),
    )
  })

  it('a wall watch put back by a store made after the loss is put back whole, for every store', () => {
    conversation('a')
    conversation('b')
    walled('a')
    expect(store.providerLimitsSeen(NOW).rows).toHaveLength(1)
    db.exec('DROP TRIGGER temp.provider_wall_turn_completed')
    aTurn('b', NOW - HOUR)
    // Made before the store that kept the wall reads again: it is the one that finds the loss.
    const second = createSessionStore(db, () => NOW)
    const fresh = readAgain((one) => one.providerLimitsSeen(NOW))
    expect(fresh.rows).toEqual([])
    expect(second.providerLimitsSeen(NOW)).toEqual(fresh)
    expect(store.providerLimitsSeen(NOW)).toEqual(fresh)
    const wrapped = createSessionStore(new Proxy(db, {}), () => NOW)
    expect(wrapped.providerLimitsSeen(NOW)).toEqual(fresh)
  })

  it('a wall watch put back makes every store on the connection read again', () => {
    conversation('a')
    walled('a')
    const wrapped = createSessionStore(new Proxy(db, {}), () => NOW)
    expect(store.providerLimitsSeen(NOW).rows).toHaveLength(1)
    expect(wrapped.providerLimitsSeen(NOW).rows).toHaveLength(1)
    db.exec('DROP TRIGGER temp.provider_wall_event_added')
    walled('a', SEVEN_DAY, NOW - HOUR)
    expect(store.providerLimitsSeen(NOW).rows).toHaveLength(2)
    expect(wrapped.providerLimitsSeen(NOW).rows).toHaveLength(2)
    expect(wrapped.providerLimitsSeen(NOW)).toEqual(
      readAgain((fresh) => fresh.providerLimitsSeen(NOW)),
    )
  })
})

describe('one conversation’s folds, carried forward', () => {
  const routed = (id: string, requestId: string): void => {
    put(id, {
      type: 'question_asked',
      requestId,
      prompt: 'Which fictional tone?',
      questions: [{ id: 'answer', prompt: 'Which fictional tone?', options: [] }],
    })
    put(id, { type: 'request_routed', requestId, to: 'a-person' })
  }
  /** How many times one ledger's routed requests were read from its first routing. */
  const wholeRoutedFolds = (): number =>
    ran.filter((sql) => sql.includes('AND (ordinal >= (SELECT min(ordinal)')).length
  const wholeQuestionReads = (): number =>
    ran.filter((sql) => sql.includes("json_type(payload, '$.questions')")).length
  const routedAgain = (id: string) =>
    readAgain((fresh) => fresh.routedRequestsOf(id, rowsUnreadOnce()))

  it('the status rows an agent writes at work fold nothing again', () => {
    conversation('c')
    routed('c', 'r1')
    const kept = store.routedRequestsOf('c', rowsUnreadOnce())
    expect(kept.map((one) => one.state)).toEqual(['open'])
    store.questionsRaisedIn('c', rowsUnreadOnce())
    ran.length = 0
    for (let n = 0; n < 40; n++) put('c', { type: 'status', state: n % 2 ? 'idle' : 'working' })
    expect(store.routedRequestsOf('c', rowsUnreadOnce())).toEqual(kept)
    expect(store.questionsRaisedIn('c', rowsUnreadOnce()).has('r1')).toBe(true)
    expect(wholeRoutedFolds()).toBe(0)
    expect(wholeQuestionReads()).toBe(0)
  })

  it('a decision, a new routing and an ending provider are carried forward as a whole fold reads them', () => {
    conversation('c')
    put('c', { type: 'launched' })
    routed('c', 'r1')
    store.routedRequestsOf('c', rowsUnreadOnce())
    ran.length = 0
    put('c', { type: 'user_decision', requestId: 'r1', outcome: 'answered' })
    expect(store.routedRequestsOf('c', rowsUnreadOnce())).toEqual(routedAgain('c'))
    put('c', { type: 'request_routed', requestId: 'r2', to: 'a-person' })
    routed('c', 'r3')
    expect(store.routedRequestsOf('c', rowsUnreadOnce())).toEqual(routedAgain('c'))
    put('c', { type: 'status', state: 'ended' })
    const carried = store.routedRequestsOf('c', rowsUnreadOnce())
    expect(carried).toEqual(routedAgain('c'))
    expect(carried.map((one) => [one.requestId, one.state])).toEqual([
      ['r1', 'answered'],
      ['r2', 'abandoned'],
      ['r3', 'open'],
    ])
    expect(wholeRoutedFolds()).toBe(0)
  })

  it('a torn row after a kept fold is read whole and counted', () => {
    conversation('c')
    routed('c', 'r1')
    store.routedRequestsOf('c', rowsUnreadOnce())
    raw('c', 'status', '{not json', NOW)
    const unread = rowsUnreadOnce()
    expect(store.routedRequestsOf('c', unread).map((one) => one.state)).toEqual(['open'])
    expect(unread.count).toBe(1)
    // Not kept, so the next read folds the ledger whole and nothing else.
    put('c', { type: 'status', state: 'working' })
    ran.length = 0
    store.routedRequestsOf('c', rowsUnreadOnce())
    expect(ran.filter((sql) => sql.includes('ordinal > @after'))).toHaveLength(0)
    expect(wholeRoutedFolds()).toBe(1)
  })

  it('a row whose payload is JSON but no event is counted, kept or read whole', () => {
    conversation('c')
    routed('c', 'r1')
    raw('c', 'status', 'null', NOW - 1)
    const whole = rowsUnreadOnce()
    expect(store.routedRequestsOf('c', whole).map((one) => one.state)).toEqual(['open'])
    expect(whole.count).toBe(1)
    conversation('d')
    routed('d', 'r1')
    store.routedRequestsOf('d', rowsUnreadOnce())
    raw('d', 'status', 'null', NOW)
    const carried = rowsUnreadOnce()
    expect(store.routedRequestsOf('d', carried).map((one) => one.state)).toEqual(['open'])
    expect(carried.count).toBe(1)
  })

  it('a ledger that routes its first request is read whole', () => {
    conversation('c')
    put('c', { type: 'launched' })
    put('c', { type: 'status', state: 'idle' })
    expect(store.routedRequestsOf('c', rowsUnreadOnce())).toEqual([])
    routed('c', 'r1')
    expect(store.routedRequestsOf('c', rowsUnreadOnce()).map((one) => one.requestId)).toEqual([
      'r1',
    ])
  })

  it('a row the store writes below a kept fold’s newest row forgets it', () => {
    conversation('c')
    put('c', { type: 'launched' })
    routed('c', 'r1')
    store.append('c', 10, { type: 'status', state: 'working' }, NOW)
    expect(store.routedRequestsOf('c', rowsUnreadOnce()).map((one) => one.state)).toEqual(['open'])
    store.append('c', 5, { type: 'user_decision', requestId: 'r1', outcome: 'answered' }, NOW)
    expect(store.routedRequestsOf('c', rowsUnreadOnce()).map((one) => one.state)).toEqual([
      'answered',
    ])
  })

  it('a new question is read again, and a status row is not', () => {
    conversation('c')
    routed('c', 'r1')
    expect([...store.questionsRaisedIn('c', rowsUnreadOnce()).keys()]).toEqual(['r1'])
    ran.length = 0
    put('c', { type: 'status', state: 'working' })
    store.questionsRaisedIn('c', rowsUnreadOnce())
    expect(wholeQuestionReads()).toBe(0)
    routed('c', 'r2')
    expect([...store.questionsRaisedIn('c', rowsUnreadOnce()).keys()]).toEqual(['r1', 'r2'])
    expect(wholeQuestionReads()).toBe(1)
  })

  const aDecision = { type: 'user_decision', requestId: 'r', outcome: 'answered' } as const
  const aRoutingAtZero = (): void => {
    store.append(
      'c',
      0,
      {
        type: 'question_asked',
        requestId: 'r',
        prompt: 'Which fictional tone?',
        questions: [{ id: 'answer', prompt: 'Which fictional tone?', options: [] }],
      },
      NOW - HOUR,
    )
    store.append('c', 1, { type: 'request_routed', requestId: 'r', to: 'a-person' }, NOW - HOUR)
    store.append('c', 10, { type: 'status', state: 'working' }, NOW - HOUR)
    expect(store.routedRequestsOf('c', rowsUnreadOnce()).map((one) => one.state)).toEqual(['open'])
  }

  it('another store’s decision below a kept fold, then an ordinary append, is read', () => {
    conversation('c')
    aRoutingAtZero()
    createSessionStore(db, () => NOW).append('c', 5, aDecision, NOW - HOUR)
    store.append('c', 11, { type: 'status', state: 'idle' }, NOW)
    const read = store.routedRequestsOf('c', rowsUnreadOnce())
    expect(read.map((one) => one.state)).toEqual(['answered'])
    expect(read).toEqual(routedAgain('c'))
  })

  it('another connection’s decision below a kept fold is read', () => {
    conversation('c')
    aRoutingAtZero()
    const other = openDatabase(file)
    try {
      createSessionStore(other, () => NOW).append('c', 5, aDecision, NOW - HOUR)
    } finally {
      other.close()
    }
    store.append('c', 11, { type: 'status', state: 'idle' }, NOW)
    expect(store.routedRequestsOf('c', rowsUnreadOnce()).map((one) => one.state)).toEqual([
      'answered',
    ])
  })

  it('a row rewritten in plain SQL below a kept fold is read again, torn and restored', () => {
    conversation('c')
    routed('c', 'r1')
    expect([...store.questionsRaisedIn('c', rowsUnreadOnce()).keys()]).toEqual(['r1'])
    const row = db
      .prepare(`SELECT id, payload FROM events WHERE session_id = 'c' AND type = 'question_asked'`)
      .get() as { id: string; payload: string }
    db.prepare('UPDATE events SET payload = ? WHERE id = ?').run('{not json', row.id)
    put('c', { type: 'status', state: 'working' })
    const torn = rowsUnreadOnce()
    expect(store.questionsRaisedIn('c', torn).size).toBe(0)
    expect(torn.count).toBe(1)
    db.prepare('UPDATE events SET payload = ? WHERE id = ?').run(row.payload, row.id)
    put('c', { type: 'status', state: 'idle' })
    const whole = rowsUnreadOnce()
    expect([...store.questionsRaisedIn('c', whole).keys()]).toEqual(['r1'])
    expect(whole.count).toBe(0)
  })

  it('a ledger with more rows than a fold keeps to carry is folded whole when they move', () => {
    conversation('c')
    for (let n = 0; n < 370; n++) {
      routed('c', `r${n}`)
      put('c', { type: 'user_decision', requestId: `r${n}`, outcome: 'answered' })
    }
    routed('c', 'last')
    expect(
      store.routedRequestsOf('c', rowsUnreadOnce()).filter((one) => one.state === 'open'),
    ).toHaveLength(1)
    ran.length = 0
    put('c', { type: 'status', state: 'working' })
    store.routedRequestsOf('c', rowsUnreadOnce())
    expect(wholeRoutedFolds()).toBe(0)
    put('c', { type: 'user_decision', requestId: 'last', outcome: 'answered' })
    const read = store.routedRequestsOf('c', rowsUnreadOnce())
    expect(wholeRoutedFolds()).toBe(1)
    expect(read).toEqual(routedAgain('c'))
    expect(read.every((one) => one.state === 'answered')).toBe(true)
  })

  it('a row inserted or deleted in plain SQL below a kept fold is read, and nothing kept answers for it', () => {
    conversation('c')
    aRoutingAtZero()
    expect(store.routedRequestsAtHand('c')?.map((one) => one.state)).toEqual(['open'])
    const decision = raw('c', 'user_decision', aDecision, NOW - HOUR, 5)
    expect(store.routedRequestsAtHand('c')).toBeNull()
    expect(store.routedRequestsOf('c', rowsUnreadOnce()).map((one) => one.state)).toEqual([
      'answered',
    ])
    db.prepare('DELETE FROM events WHERE id = ?').run(decision)
    expect(store.routedRequestsOf('c', rowsUnreadOnce()).map((one) => one.state)).toEqual(['open'])
    expect(store.routedRequestsOf('c', rowsUnreadOnce())).toEqual(routedAgain('c'))
  })

  it('a fold watch taken away is put back, and nothing it kept answers', () => {
    conversation('c')
    aRoutingAtZero()
    for (const { name } of db
      .prepare(
        `SELECT name FROM sqlite_temp_master WHERE type = 'trigger' AND name LIKE 'fold_row_written_%'`,
      )
      .all() as { name: string }[])
      db.exec(`DROP TRIGGER temp.${name}`)
    raw('c', 'user_decision', aDecision, NOW - HOUR, 5)
    expect(store.routedRequestsOf('c', rowsUnreadOnce()).map((one) => one.state)).toEqual([
      'answered',
    ])
    // Put back: a later rewrite below what is kept is heard again.
    db.prepare(`DELETE FROM events WHERE session_id = 'c' AND ordinal = 5`).run()
    expect(store.routedRequestsOf('c', rowsUnreadOnce())).toEqual(routedAgain('c'))
  })
})

describe('a giver’s receipts, carried forward', () => {
  const wholeReceiptReads = (): number =>
    ran.filter(
      (sql) =>
        sql.includes("type IN ('work_stall_told', 'message_unqueued')") &&
        sql.includes('ORDER BY ordinal'),
    ).length

  /** A piece the giver gave, whose holder's turn ended without a reply. */
  function aStalledPiece(): { giver: string; piece: string } {
    const giver = 'giver'
    const holder = 'holder'
    store.create({
      id: giver,
      provider: 'claude',
      cwd: folder,
      approvalMode: 'ask',
      profileId: 'pm',
    })
    store.create({
      id: holder,
      provider: 'claude',
      cwd: folder,
      approvalMode: 'ask',
      profileId: 'worker',
      parentSessionId: giver,
    })
    const root = store.rootOf(giver)
    if (root === null) throw new Error('the giver owns no root')
    const number = store.numberUnder(root.piece)
    const label = `${root.label}.${String(number)}`
    const piece = 'work_fictional'
    store.recordGive(
      {
        piece,
        parent: root.piece,
        number,
        owner: holder,
        givenBy: giver,
        title: 'Fictional work',
        brief: 'Fictional work',
        folder: null,
        inputs: [],
      },
      store.nextOrdinal(holder),
      {
        type: 'work_given',
        piece,
        label,
        parent: root.piece,
        givenBy: giver,
        title: 'Fictional work',
        brief: 'Fictional work',
      },
      NOW - 2 * HOUR,
    )
    put(holder, {
      type: 'user_turn',
      text: 'Fictional work',
      attribution: 'app_authored',
      relayedFrom: giver,
      says: 'note',
    })
    put(holder, { type: 'status', state: 'working' })
    put(holder, { type: 'turn', state: 'completed' })
    put(holder, { type: 'status', state: 'idle' })
    return { giver, piece }
  }
  const stalled = (): string[] =>
    store.stalledWorkNobodyWasToldAbout(rowsUnreadOnce()).rows.map((one) => one.piece)

  it('a message sent reads nothing again, and the telling abandoned brings the piece back', () => {
    const { giver, piece } = aStalledPiece()
    expect(stalled()).toEqual([piece])
    put(giver, {
      type: 'work_stall_told',
      piece,
      how: 'pushed',
      cause: 'turn_ended',
      messageId: 'told',
    })
    expect(stalled()).toEqual([])
    ran.length = 0
    put(giver, { type: 'message_unqueued', messageId: 'other', reason: 'sent', text: 'words' })
    expect(stalled()).toEqual([])
    expect(wholeReceiptReads()).toBe(0)
    put(giver, { type: 'message_unqueued', messageId: 'told', reason: 'abandoned', text: 'words' })
    expect(stalled()).toEqual([piece])
    expect(wholeReceiptReads()).toBe(1)
  })

  it('a piece closed in plain SQL below its newest row is named as a fresh read names it', () => {
    const { giver, piece } = aStalledPiece()
    const before = store.workThatNames('holder')
    expect(before?.ended).toBeUndefined()
    // The holder's last row, rewritten in place: its newest ordinal does not move.
    db.prepare(
      `UPDATE events SET type = 'work_closed', payload = ?
        WHERE session_id = 'holder' AND ordinal = (SELECT max(ordinal) FROM events WHERE session_id = 'holder')`,
    ).run(JSON.stringify({ type: 'work_closed', piece, by: giver }))
    const after = store.workThatNames('holder')
    expect(after?.ended).toBeDefined()
    expect(after).toEqual(readAgain((fresh) => fresh.workThatNames('holder')))
  })

  const closeTheLastRow = (on: AppDatabase, piece: string, giver: string): void => {
    on.prepare(
      `UPDATE events SET type = 'work_closed', payload = ?
        WHERE session_id = 'holder' AND ordinal = (SELECT max(ordinal) FROM events WHERE session_id = 'holder')`,
    ).run(JSON.stringify({ type: 'work_closed', piece, by: giver }))
  }

  it('a piece closed by another connection below its newest row is named as a fresh read names it', () => {
    const { giver, piece } = aStalledPiece()
    expect(store.workThatNames('holder')?.ended).toBeUndefined()
    expect(store.workThatNamesAndItsWait('holder').named?.ended).toBeUndefined()
    const other = openDatabase(file)
    try {
      closeTheLastRow(other, piece, giver)
    } finally {
      other.close()
    }
    expect(store.workThatNames('holder')?.ended).toBeDefined()
    expect(store.workThatNames('holder')).toEqual(
      readAgain((fresh) => fresh.workThatNames('holder')),
    )
    expect(store.workThatNamesAndItsWait('holder')).toEqual(
      readAgain((fresh) => fresh.workThatNamesAndItsWait('holder')),
    )
  })

  it('a name read inside a transaction that rolls back is not kept', () => {
    const { giver, piece } = aStalledPiece()
    const open = store.workThatNames('holder')
    expect(open?.ended).toBeUndefined()
    expect(() =>
      db.transaction(() => {
        closeTheLastRow(db, piece, giver)
        expect(store.workThatNames('holder')?.ended).toBeDefined()
        expect(store.workThatNamesAndItsWait('holder').named?.ended).toBeDefined()
        throw new Error('rolled back')
      })(),
    ).toThrow('rolled back')
    expect(store.workThatNames('holder')).toEqual(open)
    expect(store.workThatNamesAndItsWait('holder').named).toEqual(open)
    expect(store.workThatNames('holder')).toEqual(
      readAgain((fresh) => fresh.workThatNames('holder')),
    )
  })

  it('a piece given below the first by another connection is folded from the new floor', () => {
    const { giver } = aStalledPiece()
    const before = store
      .piecesOwnedBefore('holder', 1_000, rowsUnreadOnce())
      .map((one) => one.piece)
    expect(before).toEqual(['work_fictional'])
    const root = store.rootOf(giver)
    if (root === null) throw new Error('the giver owns no root')
    const other = openDatabase(file)
    try {
      createSessionStore(other, () => NOW).recordGive(
        {
          piece: 'work_earlier',
          parent: root.piece,
          number: 99,
          owner: 'holder',
          givenBy: giver,
          title: 'Earlier work',
          brief: 'Earlier work',
          folder: null,
          inputs: [],
        },
        -1,
        {
          type: 'work_given',
          piece: 'work_earlier',
          label: `${root.label}.99`,
          parent: root.piece,
          givenBy: giver,
          title: 'Earlier work',
          brief: 'Earlier work',
        },
        NOW - 3 * HOUR,
      )
    } finally {
      other.close()
    }
    const after = store.piecesOwnedBefore('holder', 1_000, rowsUnreadOnce())
    expect(after.map((one) => one.piece).sort()).toEqual(['work_earlier', 'work_fictional'])
    expect(after).toEqual(
      readAgain((fresh) => fresh.piecesOwnedBefore('holder', 1_000, rowsUnreadOnce())),
    )
  })
})
