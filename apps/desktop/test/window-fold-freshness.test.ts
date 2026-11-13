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

it('reuses unrelated owners while corrections, rollback, import and external writes stay fresh', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fictional-fold-freshness-'))
  const file = join(directory, 'fictional.sqlite')
  const db = openDatabase(file)
  applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
  const store = createSessionStore(db)
  for (const id of ['alpha', 'beta']) {
    store.adopt({
      id,
      provider: 'codex',
      sessionId: `fictional-${id}`,
      cwd: directory,
      profileId: 'fictional',
      createdAt: 1,
      updatedAt: 1,
    })
    store.append(
      id,
      0,
      {
        type: 'work_given',
        piece: `${id}-child`,
        parent: store.rootOf(id)!.piece,
        label: `${store.rootOf(id)!.label}.1`,
        givenBy: 'alpha',
        title: 'Fictional',
        brief: 'Fictional',
      },
      1,
    )
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
    }
  }
  const root = store.rootOf('alpha')!.piece
  const payload = (title: string) =>
    JSON.stringify({ type: 'work_retitled', piece: root, title, by: null })
  try {
    read('cold')
    expect(new Set(owners)).toEqual(new Set(['alpha', 'beta']))
    read('warm')
    expect(rows).toBe(0)
    store.append('alpha', 1001, { type: 'work_retitled', piece: root, title: 'First', by: null }, 2)
    expect(read('one-owner-commit').title).toBe('First')
    expect(new Set(owners)).toEqual(new Set(['alpha']))
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
      db.prepare('UPDATE events SET payload = ? WHERE session_id = ? AND ordinal = 1001').run(
        payload('Mixed correction'),
        'alpha',
      )
    })()
    expect(read('mixed-append-and-correction').title).toBe('Mixed correction')
    expect(new Set(owners)).toEqual(new Set(['alpha', 'beta']))
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
    expect(new Set(owners)).toEqual(new Set(['alpha', 'beta']))
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
