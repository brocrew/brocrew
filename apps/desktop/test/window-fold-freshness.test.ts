import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { WindowReadEngine } from '../src/main/db/window-read-engine'
import { windowWriterSampler, type WindowWriterStamp } from '../src/main/db/window-writer-stamp'
import { sameWindowWriter } from '../src/main/db/window-routing-reads'
import { withWindowWriteFence } from '../src/main/db/window-write-fence'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { adoptOwnerWithChild } from './helpers/adopt-owner-with-child'

it('reuses unrelated owners while corrections, rollback, import and external writes stay fresh', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fictional-fold-freshness-'))
  const file = join(directory, 'fictional.sqlite')
  const db = openDatabase(file)
  applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
  const store = createSessionStore(db)
  for (const id of ['alpha', 'beta']) {
    adoptOwnerWithChild(store, id, directory, 'Fictional')
    db.prepare(
      `WITH RECURSIVE n(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM n WHERE value < 1000)
      INSERT INTO events(id,session_id,generation,ordinal,type,payload,created_at)
      SELECT ? || value, ?, 0, value, 'status', '{"type":"status","state":"idle"}', 1 FROM n`,
    ).run(`seed-${id}`, id)
  }
  const sampler = windowWriterSampler(db, () => true)
  const engine = new WindowReadEngine(file)
  const worker = (engine as unknown as { db: AppDatabase }).db
  let owners: string[] = []
  let rows = 0
  const prepare = worker.prepare.bind(worker)
  vi.spyOn(worker, 'prepare').mockImplementation((sql) => {
    const statement = prepare(sql)
    if (!sql.includes('json_remove')) return statement
    const iterate = statement.iterate.bind(statement)
    vi.spyOn(statement, 'iterate').mockImplementation(function* (...args) {
      owners.push(
        typeof args[0] === 'string' ? args[0] : String((args[0] as { session?: string })?.session),
      )
      for (const row of iterate(...args)) {
        rows++
        yield row
      }
    })
    return statement
  })
  let accepted: { stamp: WindowWriterStamp; token: string } | undefined
  const results: unknown[] = []
  const read = (phase: string, after?: () => void) => {
    owners = []
    rows = 0
    const before = sampler({ kind: 'routes' })!
    expect(before).not.toBeNull()
    const changed = accepted === undefined ? null : sampler.changedOwners!(accepted.stamp, before)
    const started = performance.now()
    const result = engine.read({
      kind: 'routes',
      ...(accepted !== undefined && changed !== null
        ? { reuse: { token: accepted.token, changed: [...changed] } }
        : {}),
    })
    after?.()
    const valid = sameWindowWriter(before, sampler({ kind: 'routes' }))
    expect(result.kind).toBe('routes')
    if (result.kind !== 'routes') throw new Error('wrong result')
    if (valid) accepted = { stamp: before, token: result.cacheToken! }
    results.push({
      phase,
      rows,
      walks: owners.length,
      owners: [...owners],
      valid,
      elapsedMs: performance.now() - started,
    })
    return {
      valid,
      title: result.work!.owners.find((one) => one.id === 'alpha')!.naming.value.named?.title,
      unread: result.work!.owners.find((one) => one.id === 'alpha')!.naming.skipped,
      beta: result.work!.owners.find((one) => one.id === 'beta')!.naming.value.named?.title,
      betaOpen: result.work!.owners.find((one) => one.id === 'beta')!.openWork.value.length,
    }
  }
  const root = store.rootOf('alpha')!.piece
  const payload = (title: string) =>
    JSON.stringify({ type: 'work_retitled', piece: root, title, by: null })
  try {
    expect(read('cold').betaOpen).toBe(2)
    expect(new Set(owners)).toEqual(new Set(['alpha', 'beta']))
    read('warm')
    expect(rows).toBe(0)
    store.append('alpha', 1001, { type: 'work_retitled', piece: root, title: 'First', by: null }, 2)
    expect(read('one-owner-commit').title).toBe('First')
    // An append is carried forward from the kept fold: alpha's 1,000 seeded rows are not read.
    expect(rows).toBeLessThan(1000)
    db.prepare('UPDATE events SET payload = ? WHERE session_id = ? AND ordinal = 1001').run(
      payload('Corrected'),
      'alpha',
    )
    expect(read('same-ordinal-update').title).toBe('Corrected')
    expect(new Set(owners)).toEqual(new Set(['alpha']))
    db.transaction(() => {
      store.append(
        'beta',
        1001,
        {
          type: 'work_retitled',
          piece: store.rootOf('beta')!.piece,
          title: 'Beta append',
          by: null,
        },
        3,
      )
      store.append('beta', 1002, { type: 'work_closed', piece: 'beta-child', by: 'alpha' }, 3)
      db.prepare('UPDATE events SET payload = ? WHERE session_id = ? AND ordinal = 1001').run(
        payload('Mixed correction'),
        'alpha',
      )
    })()
    const mixed = read('mixed-append-and-correction')
    expect(mixed.title).toBe('Mixed correction')
    expect(mixed.beta).toBe('Beta append')
    // Beta's appended close is carried forward into its kept fold; only alpha is read whole.
    expect(mixed.betaOpen).toBe(1)
    expect(new Set(owners)).toEqual(new Set(['alpha', 'beta']))
    expect(rows).toBeLessThan(2000)
    expect(() =>
      db.transaction(() => {
        db.prepare('UPDATE events SET payload = ? WHERE session_id = ? AND ordinal = 1001').run(
          payload('Rolled back'),
          'alpha',
        )
        throw new Error('rollback')
      })(),
    ).toThrow('rollback')
    expect(read('rollback').title).toBe('Mixed correction')
    expect(rows).toBe(0)
    const rejected = read('rejected-after-read', () => {
      db.prepare('UPDATE events SET payload = ? WHERE session_id = ? AND ordinal = 1001').run(
        payload('After rejected snapshot'),
        'alpha',
      )
    })
    expect(rejected.valid).toBe(false)
    expect(read('after-rejection').title).toBe('After rejected snapshot')
    expect(new Set(owners)).toEqual(new Set(['alpha']))
    const external = openDatabase(file)
    try {
      external
        .prepare('UPDATE events SET payload = ? WHERE session_id = ? AND ordinal = 1001')
        .run(payload('External'), 'alpha')
    } finally {
      external.close()
    }
    expect(read('external-correction').title).toBe('External')
    expect(new Set(owners)).toEqual(new Set(['alpha', 'beta']))
    withWindowWriteFence(db, () => {
      db.prepare('UPDATE events SET payload = ? WHERE session_id = ? AND ordinal = 1001').run(
        payload('Imported'),
        'alpha',
      )
    })
    expect(read('import-fence').title).toBe('Imported')
    expect(new Set(owners)).toEqual(new Set(['alpha', 'beta']))
    db.prepare('UPDATE events SET payload = ? WHERE session_id = ? AND ordinal = 1001').run(
      '{',
      'alpha',
    )
    expect(read('malformed').unread.length).toBeGreaterThan(0)
    expect(read('malformed-again').unread.length).toBeGreaterThan(0)
    expect(owners).toContain('alpha')
    const generation = store.beginGeneration('alpha')
    store.appendGeneration('alpha', generation, [
      {
        ordinal: 0,
        at: 3,
        event: { type: 'work_retitled', piece: root, title: 'New generation', by: null },
      },
    ])
    expect(
      store.promoteGeneration('alpha', generation, { normalizerVersion: 1, derivedThrough: 1001 }),
    ).toBe(true)
    expect(read('generation').title).toBe('New generation')
    console.info(JSON.stringify({ foldFreshness: results }))
  } finally {
    engine.close()
    vi.restoreAllMocks()
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

it('folds an incident owner again once when its newest turn moves without a fold row', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fictional-turn-move-'))
  const file = join(directory, 'fictional.sqlite')
  const db = openDatabase(file)
  applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
  const store = createSessionStore(db)
  adoptOwnerWithChild(store, 'alpha', directory, 'Fictional')
  const append = (event: object) =>
    store.append('alpha', store.nextOrdinal('alpha'), event as TranscriptEvent, 2)
  for (const text of ['First fictional turn', 'Second fictional turn']) {
    append({ type: 'user_turn', text })
    append({ type: 'turn', state: 'completed' })
  }
  const engine = new WindowReadEngine(file)
  const worker = (engine as unknown as { db: AppDatabase }).db
  let rows = 0
  const prepare = worker.prepare.bind(worker)
  vi.spyOn(worker, 'prepare').mockImplementation((sql) => {
    const statement = prepare(sql)
    if (!sql.includes('json_remove')) return statement
    const iterate = statement.iterate.bind(statement)
    vi.spyOn(statement, 'iterate').mockImplementation(function* (...args) {
      for (const row of iterate(...args)) yield (rows++, row)
    })
    return statement
  })
  let token: string | undefined
  const read = () => {
    rows = 0
    const reuse = token === undefined ? {} : { reuse: { token, changed: [] } }
    const result = engine.read({ kind: 'incidents', ...reuse })
    if (result.kind !== 'incidents') throw new Error('wrong result')
    token = result.routing.cacheToken
    return result.owners.find((one) => one.sessionId === 'alpha')!.history.newestTurn
  }
  try {
    const second = read()
    read()
    expect(rows).toBe(0)
    // The first turn becomes the newest by its turn row alone; no ledger row is written.
    db.prepare('UPDATE turn SET ordinal = 99 WHERE session_id = ? AND id != ?').run('alpha', second)
    const first = read()
    expect(first).not.toBe(second)
    expect(rows).toBeGreaterThan(0)
    expect(read()).toBe(first)
    expect(rows).toBe(0)
  } finally {
    engine.close()
    vi.restoreAllMocks()
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

it('reads a ledger whole when carrying its kept questions forward fails', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fictional-carry-fails-'))
  const file = join(directory, 'fictional.sqlite')
  const db = openDatabase(file)
  applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
  const store = createSessionStore(db)
  adoptOwnerWithChild(store, 'alpha', directory, 'Fictional')
  const ask = (requestId: string) =>
    store.append(
      'alpha',
      store.nextOrdinal('alpha'),
      { type: 'question_asked', requestId, prompt: 'Which?', questions: [] } as TranscriptEvent,
      2,
    )
  ask('first')
  const engine = new WindowReadEngine(file)
  const worker = (engine as unknown as { db: AppDatabase }).db
  let failOnce = false
  const prepare = worker.prepare.bind(worker)
  vi.spyOn(worker, 'prepare').mockImplementation((sql) => {
    const statement = prepare(sql)
    if (!sql.includes("'user_input_request', 'question_asked')")) return statement
    const iterate = statement.iterate.bind(statement)
    vi.spyOn(statement, 'iterate').mockImplementation((...args) => {
      // Only the carry asks from a finite ordinal; the whole read asks from the start.
      if (failOnce && Number.isFinite(args[2])) {
        failOnce = false
        throw new Error('fictional read fault')
      }
      return iterate(...args)
    })
    return statement
  })
  let token: string | undefined
  const raised = () => {
    const reuse = token === undefined ? {} : { reuse: { token, changed: [] } }
    const result = engine.read({ kind: 'listing', ...reuse })
    if (result.kind !== 'listing') throw new Error('wrong result')
    token = result.cacheToken
    return result.work.raised.find(([id]) => id === 'alpha')![1].value.map(([id]) => id)
  }
  try {
    expect(raised()).toEqual(['first'])
    ask('second')
    failOnce = true
    expect(raised()).toEqual(['first', 'second'])
    expect(failOnce).toBe(false)
  } finally {
    engine.close()
    vi.restoreAllMocks()
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
