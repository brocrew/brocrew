import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, statfsSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { it } from 'vitest'
import { openDatabase, type AppDatabase } from '../apps/desktop/src/main/db/connection'
import { applyMigrations } from '../apps/desktop/src/main/db/migrate'
import { createSessionStore } from '../apps/desktop/src/main/db/session-store'
import { QUESTION_COPY_TRIGGERS } from '../apps/desktop/src/main/db/question-copies'
import { aServiceWorld } from '../apps/desktop/test/helpers/a-service-world'

const root = process.env.STORAGE_QUALIFICATION_ROOT
const name = process.env.STORAGE_QUALIFICATION_FIXTURE
assert.equal(process.platform, 'linux', 'qualification never runs on the main Mac')
assert(root && name)
const folder: string = root
const heartbeatPath = process.env.STORAGE_QUALIFICATION_HEARTBEAT ?? join(folder, 'heartbeat.json')
const stage = process.env.STORAGE_QUALIFICATION_STAGE
const file = join(folder, stage === 'seed' ? 'fixture.sqlite' : 'bounds.sqlite')
const migrations = resolve('apps/desktop/src/main/db/migrations')
const cases = {
  tiny: { rows: 4000, stride: 10, pad: 'x'.repeat(900) },
  large: { rows: 700000, stride: 10, pad: 'x'.repeat(900) },
  sparse: { rows: 1000000, stride: 10000, pad: 'x'.repeat(450) },
  multibyte: { rows: 16000, stride: 10, pad: '😀'.repeat(20000) },
  oversize: { rows: 10000, stride: 10, pad: 'x'.repeat(900) },
} as const
assert(name in cases)
const fixture = cases[name as keyof typeof cases]
const cap = 256 * 1024
const stamp = () => process.hrtime.bigint()
const milliseconds = (ns: bigint) => Number(ns) / 1e6
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const keyOf = (n: number) => `key-${String(n % 97).padStart(6, '0')}`
const question = (n: number) => n % fixture.stride === fixture.stride - 1
const payload = (n: number) => {
  const pad = name === 'oversize' && n < 32 ? 'x'.repeat(1048576 + n * 32768) : fixture.pad
  return JSON.stringify(question(n) ? { passedUpFrom: keyOf(n), pad } : { state: 'idle', pad })
}
const questionOverhead = Buffer.byteLength(JSON.stringify({ passedUpFrom: keyOf(0), pad: '' }))
const statusOverhead = Buffer.byteLength(JSON.stringify({ state: 'idle', pad: '' }))
const padBytes = Buffer.byteLength(fixture.pad)
const byteCount = (n: number) =>
  (question(n) ? questionOverhead : statusOverhead) +
  (name === 'oversize' && n < 32 ? 1048576 + n * 32768 : padBytes)
const progress = (db: AppDatabase) =>
  db.prepare('SELECT * FROM question_copy_progress WHERE id = 1').get() as Record<string, unknown>
const receipt = (path: string, value: unknown) =>
  writeFileSync(
    join(folder, path === 'fixture.json' ? path : `bounds-${path}`),
    JSON.stringify(value, null, 2) + '\n',
  )
const distribution = (values: number[]) => {
  assert(values.length > 0)
  const ordered = [...values].sort((a, b) => a - b)
  const at = (p: number) =>
    ordered[Math.min(ordered.length - 1, Math.ceil(p * ordered.length) - 1)]!
  return { count: ordered.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: ordered.at(-1) }
}
function historyHash(db: AppDatabase) {
  const hash = createHash('sha256')
  for (const row of db.prepare("SELECT * FROM events WHERE id LIKE 'seed:%' ORDER BY id").iterate())
    hash.update(JSON.stringify(row) + '\n')
  return hash.digest('hex')
}

function planAssertions(lookup: string, lookupPlan: string[], walk: string, walkPlan: string[]) {
  assert(lookup.includes('INDEXED BY question_copy_key_idx'))
  assert(walk.includes('INDEXED BY events_fold_idx'))
  assert(
    lookupPlan.some((line) =>
      /SEARCH q USING INDEX question_copy_key_idx.*passed_up_from=\?/i.test(line),
    ),
  )
  assert(lookupPlan.some((line) => /SEARCH e USING INDEX.*\(id=\?\)/i.test(line)))
  assert(!lookupPlan.some((line) => /\bSCAN [qe]\b/i.test(line)))
  assert(walkPlan.some((line) => /SEARCH events USING INDEX events_fold_idx.*>/i.test(line)))
  assert(!walkPlan.some((line) => /SCAN events|TEMP B-TREE FOR ORDER BY/i.test(line)))
}

function bounded<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    promise,
    new Promise<never>((_, fail) => {
      timer = setTimeout(() => fail(new Error(`${label} timed out`)), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

it('qualifies the pinned store and host over the explicitly selected scratch fixture', async () => {
  const free = statfsSync(folder)
  assert(free.bavail * free.bsize > 12 * 1024 ** 3, 'at least 12 GiB scratch headroom required')
  if (stage === 'seed') {
    const db = openDatabase(file)
    try {
      applyMigrations(db, migrations)
      const store = createSessionStore(db)
      for (let n = 0; n < 1000; n++)
        store.create({
          id: `session-${String(n).padStart(4, '0')}`,
          provider: 'codex',
          cwd: folder,
          approvalMode: 'ask',
          profileId: 'fictional',
        })
      store.create({
        id: 'writer',
        provider: 'codex',
        cwd: folder,
        approvalMode: 'ask',
        profileId: 'fictional',
      })
      const insert = db.prepare(
        'INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      let bytes = 0
      db.transaction(() => {
        for (let n = 0; n < fixture.rows; n++) {
          if (n % 10000 === 0)
            writeFileSync(heartbeatPath, JSON.stringify({ stage, at: Date.now(), rows: n }))
          const body = payload(n)
          assert.equal(Buffer.byteLength(body), byteCount(n))
          bytes += Buffer.byteLength(body)
          insert.run(
            `seed:${String(n).padStart(9, '0')}`,
            `session-${String(Math.floor(n / Math.ceil(fixture.rows / 1000))).padStart(4, '0')}`,
            Math.floor((n % Math.ceil(fixture.rows / 1000)) / Math.ceil(fixture.rows / 4000)),
            n,
            question(n) ? 'question_asked' : 'status',
            body,
            n + 1,
          )
        }
      })()
      assert.equal(progress(db).done, 0)
      const fallbackResult = store.conversationsHoldingACopyOf(keyOf(fixture.rows - 1))
      // This engine fixture starts with the old journal schema. It is distinct from binary writes.
      for (const trigger of Object.keys(QUESTION_COPY_TRIGGERS)) db.exec(`DROP TRIGGER ${trigger}`)
      db.exec('DROP TABLE question_copy; DROP TABLE question_copy_progress')
      db.pragma('wal_checkpoint(TRUNCATE)')
      receipt('fixture.json', {
        name,
        rows: fixture.rows,
        questions: Math.floor(fixture.rows / fixture.stride),
        bytes,
        dbBytes: statSync(file).size,
        fallbackResult,
        historyHash: historyHash(db),
        lineage: db.prepare('SELECT * FROM __drizzle_migrations ORDER BY id').all(),
        seedPid: process.pid,
        sqlite: db.prepare('SELECT sqlite_version() AS version').get(),
        schema: db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all(),
      })
    } finally {
      db.close()
    }
    return
  }

  assert.equal(stage, 'bounds')
  const before = JSON.parse(readFileSync(join(folder, 'fixture.json'), 'utf8'))
  assert.notEqual(process.pid, before.seedPid)
  const samples: Record<string, unknown>[] = []
  let world: ReturnType<typeof aServiceWorld> | undefined
  let host: ReturnType<ReturnType<typeof aServiceWorld>['aHost']> | undefined
  let failure: string | null = null
  const cleanupErrors: string[] = []
  let outcome = 'incomplete'
  const heartbeat = setInterval(
    () =>
      writeFileSync(
        heartbeatPath,
        JSON.stringify({ stage, at: Date.now(), slices: samples.length }),
      ),
    1000,
  )
  let ownedDb: AppDatabase | undefined
  try {
    const db = (ownedDb = openDatabase(file))
    const sql = new Set<string>()
    let stepped: {
      id: string
      bytes: number
      session: string
      generation: number
      ordinal: number
    }[] = []
    let nextExpected = 0
    const observed = new Proxy(db, {
      get(target, property) {
        if (property === 'prepare')
          return (statement: string) => {
            sql.add(statement)
            const prepared = target.prepare(statement)
            if (!/SELECT id, type, session_id AS session/.test(statement)) return prepared
            const see = (value: unknown) => {
              const row = value as (typeof stepped)[number]
              assert.equal(
                row.id,
                `seed:${String(nextExpected).padStart(9, '0')}`,
                'full ordered fold stream includes every nonquestion exactly once',
              )
              const perSession = Math.ceil(fixture.rows / 1000)
              assert.deepEqual(
                [row.session, row.generation, row.ordinal],
                [
                  `session-${String(Math.floor(nextExpected / perSession)).padStart(4, '0')}`,
                  Math.floor((nextExpected % perSession) / Math.ceil(fixture.rows / 4000)),
                  nextExpected,
                ],
                'tuple fields are independently derived from the generator ordinal',
              )
              const bytes = byteCount(nextExpected++)
              assert.equal(row.bytes, bytes, 'independent UTF-8 byte oracle')
              stepped.push({ ...row, bytes })
              return value
            }
            return new Proxy(prepared, {
              get(statementTarget, method) {
                if (method === 'iterate')
                  return function* (...args: unknown[]) {
                    for (const row of statementTarget.iterate(...args)) yield see(row)
                  }
                if (method === 'all')
                  return (...args: unknown[]) => statementTarget.all(...args).map(see)
                const member = Reflect.get(statementTarget, method, statementTarget)
                return typeof member === 'function' ? member.bind(statementTarget) : member
              },
            })
          }
        const member = Reflect.get(target, property, target)
        return typeof member === 'function' ? member.bind(target) : member
      },
    })
    const store = createSessionStore(observed)
    const sentinel = keyOf(fixture.rows - 1)
    const directQuery =
      "SELECT DISTINCT session_id AS id FROM events WHERE type='question_asked' AND CASE WHEN json_valid(payload) THEN json_extract(payload,'$.passedUpFrom') END = ? ORDER BY session_id"
    const direct = (key: string) =>
      db
        .prepare(directQuery)
        .all(key)
        .map((row) => (row as { id: string }).id)
    assert.equal(progress(db).done, 0)
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS n FROM question_copy').get() as { n: number }).n,
      0,
    )
    const reference = direct(sentinel)
    assert(reference.length > 0)
    assert.deepEqual(
      store.conversationsHoldingACopyOf(sentinel),
      reference,
      'incomplete copies must not hide a late key',
    )
    db.prepare('UPDATE question_copy_progress SET done=1 WHERE id=1').run()
    assert.notDeepEqual(
      store.conversationsHoldingACopyOf(sentinel),
      reference,
      'empty ready-copy negative control must be discriminating',
    )
    db.prepare('UPDATE question_copy_progress SET done=0 WHERE id=1').run()
    const scheduler: string[] = []
    let completed!: () => void
    let failed!: (error: unknown) => void
    const filled = new Promise<void>((done, fail) => {
      completed = done
      failed = fail
    })
    const traced = new Proxy(store, {
      get(target, property) {
        if (property === 'fillQuestionCopies')
          return (rows: number, bytes: number) => {
            try {
              assert(Number.isInteger(rows) && rows >= 50 && rows <= 2000)
              assert.equal(bytes, cap)
              stepped = []
              const start = stamp()
              const result = target.fillQuestionCopies(rows, bytes)
              const took = milliseconds(stamp() - start)
              assert.equal(stepped.length, result.visited)
              assert(stepped.length <= rows)
              assert(stepped.slice(0, -1).reduce((sum, row) => sum + row.bytes, 0) < cap)
              const cursor = progress(db),
                last = stepped.at(-1)
              if (last)
                assert.deepEqual(
                  [cursor.after_session, cursor.after_generation, cursor.after_ordinal],
                  [last.session, last.generation, last.ordinal],
                )
              const id = samples.length
              samples.push({
                id,
                rows,
                bytes: stepped.reduce((sum, row) => sum + row.bytes, 0),
                stepped: stepped.length,
                state: result.state,
                diagnosticMs: took,
                cursor,
              })
              scheduler.push(`slice-${id}`)
              if (id === 0)
                void (
                  host as unknown as {
                    archives: { background(work: () => Promise<void>): Promise<void> }
                  }
                ).archives.background(async () => {
                  scheduler.push('other')
                })
              if (result.state === 'done') {
                assert.equal(nextExpected, fixture.rows)
                completed()
              } else assert.equal(result.state, 'filled')
              return result
            } catch (error) {
              failed(error)
              throw error
            }
          }
        const member = Reflect.get(target, property, target)
        return typeof member === 'function' ? member.bind(target) : member
      },
    })
    world = aServiceWorld()
    host = world.aHost({ servicesOn: false, store: traced })
    host.fillQuestionCopies()
    await bounded(filled, 420000, 'observed complete fill')
    host.stopSweeping()
    await bounded(host.drainArchiveWork(), 10000, 'observed archive drain')
    assert(
      scheduler.indexOf('other') > scheduler.indexOf('slice-0') &&
        scheduler.indexOf('other') < scheduler.indexOf('slice-1'),
    )
    assert.equal(progress(db).done, 1)
    assert.equal(nextExpected, fixture.rows)
    for (let n = 0; n < 97; n++) {
      assert.deepEqual(store.conversationsHoldingACopyOf(keyOf(n)), direct(keyOf(n)))
      writeFileSync(heartbeatPath, JSON.stringify({ stage, at: Date.now(), key: n }))
    }
    const lookup = [...sql].find((statement) =>
      statement.includes('FROM question_copy q INDEXED BY'),
    )
    const walk = [...sql].find((statement) =>
      /SELECT id, type, session_id AS session/.test(statement),
    )
    assert(lookup && walk)
    const explain = (statement: string, values: unknown[]) =>
      db.prepare(`EXPLAIN QUERY PLAN ${statement}`).all(...values) as { detail: string }[]
    const pk = (
      db.prepare("PRAGMA index_list('events')").all() as { name: string; origin: string }[]
    ).find((row) => row.origin === 'pk')
    assert(pk)
    assert.deepEqual(
      (db.prepare(`PRAGMA index_info('${pk.name}')`).all() as { name: string }[]).map(
        (row) => row.name,
      ),
      ['id'],
    )
    const plans: unknown[] = []
    for (const key of [sentinel, keyOf(fixture.stride - 1), 'absent', 5, '5']) {
      const look = explain(lookup, [key, key])
      assert(look.some((row) => row.detail.includes(`USING INDEX ${pk.name} (id=?)`)))
      for (const cursor of [
        ['', -1, -1],
        ['session-0500', 1, 1000],
        ['session-9999', 9, fixture.rows],
      ])
        for (const limit of [50, 200, 2000]) {
          const walked = explain(walk, [...cursor, limit])
          planAssertions(
            lookup,
            look.map((row) => row.detail),
            walk,
            walked.map((row) => row.detail),
          )
          plans.push({ key, keyType: typeof key, cursor, limit, lookup: look, walk: walked })
        }
    }
    const goodLookup = explain(lookup, [sentinel, sentinel]).map((row) => row.detail)
    const goodWalk = explain(walk, ['', -1, -1, 200]).map((row) => row.detail)
    assert.throws(() =>
      planAssertions(
        lookup.replace('INDEXED BY question_copy_key_idx', ''),
        goodLookup,
        walk,
        goodWalk,
      ),
    )
    assert.throws(() => planAssertions(lookup, ['SCAN q', 'SCAN e'], walk, goodWalk))
    assert.throws(() =>
      planAssertions(lookup, goodLookup, walk.replace('INDEXED BY events_fold_idx', ''), goodWalk),
    )
    assert.throws(() =>
      planAssertions(lookup, goodLookup, walk, ['SCAN events USING INDEX events_fold_idx']),
    )
    const expected =
      "SELECT id AS event_id, CASE WHEN json_valid(payload) THEN json_extract(payload,'$.passedUpFrom') END AS passed_up_from, session_id, typeof(CASE WHEN json_valid(payload) THEN json_extract(payload,'$.passedUpFrom') END) AS kind FROM events WHERE type='question_asked' AND CASE WHEN json_valid(payload) THEN json_extract(payload,'$.passedUpFrom') END IS NOT NULL"
    const actual =
      'SELECT event_id,passed_up_from,session_id,typeof(passed_up_from) AS kind FROM question_copy'
    assert.deepEqual(db.prepare(`${expected} EXCEPT ${actual}`).all(), [])
    assert.deepEqual(db.prepare(`${actual} EXCEPT ${expected}`).all(), [])
    assert.equal(historyHash(db), before.historyHash)
    assert.deepEqual(
      db.prepare('SELECT * FROM __drizzle_migrations ORDER BY id').all(),
      before.lineage,
    )
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok')
    assert.deepEqual(db.pragma('foreign_key_check'), [])
    const indexDDL = db
      .prepare(
        "SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name IN ('events','question_copy') ORDER BY name",
      )
      .all()
    const kept = progress(db)
    db.exec('DROP INDEX question_copy_key_idx')
    assert.throws(() => explain(lookup, [sentinel, sentinel]), 'real missing-index plan control')
    assert.deepEqual(store.conversationsHoldingACopyOf(sentinel), reference)
    assert.deepEqual(progress(db), kept)
    receipt('plans.json', {
      lookup,
      lookupHash: digest(lookup),
      walk,
      walkHash: digest(walk),
      plans,
      indexDDL,
      primaryKeyIndex: pk,
      helperInputNegativeControls: 4,
      realMissingIndexControl: true,
    })
    receipt('summary.json', {
      name,
      rows: fixture.rows,
      totalStepped: nextExpected,
      incompleteCopyFallback: true,
      missingIndexFallback: true,
      fullCopyParity: true,
      sourceHistoryPreserved: true,
      scheduler,
      timingScope: 'invasive bounds observer; not production timing',
      diagnosticSlices: distribution(
        samples.filter((row) => row.state === 'filled').map((row) => Number(row.diagnosticMs)),
      ),
      sourceSHA: execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
        timeout: 5000,
      }).trim(),
      sourceHash: digest(readFileSync(resolve('apps/desktop/src/main/db/question-copies.ts'))),
    })
    outcome = 'assertions-completed'
  } catch (error) {
    failure = String(error)
    throw error
  } finally {
    for (const [label, release] of [
      [
        'host',
        async () => {
          host?.stopSweeping()
          await host?.drainArchiveWork()
        },
      ],
      [
        'world',
        async () => {
          await world?.cleanUp()
        },
      ],
      ['database', () => ownedDb?.close()],
    ] as const) {
      try {
        await bounded(Promise.resolve().then(release), 10000, `cleanup ${label}`)
      } catch (error) {
        cleanupErrors.push(`${label}: ${String(error)}`)
      }
    }
    clearInterval(heartbeat)
    writeFileSync(
      join(folder, 'bounds-slices.ndjson'),
      samples.map((row) => JSON.stringify(row)).join('\n') + '\n',
    )
    receipt('terminal.json', {
      stage,
      outcome: outcome === 'assertions-completed' && cleanupErrors.length === 0 ? 'pass' : 'fail',
      error: failure,
      cleanupErrors,
      timingQualified: false,
    })
  }
  if (cleanupErrors.length) throw new Error(cleanupErrors.join('; '))
})
