import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { windowWriterSampler } from '../src/main/db/window-writer-stamp'
import { sameWindowWriter } from '../src/main/db/window-routing-reads'
import { withWindowWriteFence } from '../src/main/db/window-write-fence'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
const routes = { kind: 'routes' as const }
const leads = {
  kind: 'leads' as const,
  sessionId: 'alpha',
  before: 10,
  opening: 'fictional',
  historicalOpening: 'old fictional',
}

describe('window writer revisions follow the selected facts', () => {
  let directory: string
  let db: AppDatabase
  let sample: ReturnType<typeof windowWriterSampler>
  let ordinal: number
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'fictional-window-revision-'))
    db = openDatabase(join(directory, 'fictional.sqlite'))
    applyMigrations(db, migrations)
    const store = createSessionStore(db)
    for (const id of ['alpha', 'beta'])
      store.create({
        id,
        provider: 'codex',
        cwd: directory,
        approvalMode: 'ask',
        profileId: 'fictional',
      })
    sample = windowWriterSampler(db, () => true)
    ordinal = 0
    row('request_routed', '{"type":"request_routed","requestId":"fictional-seed"}')
  })
  afterEach(() => {
    vi.restoreAllMocks()
    db.close()
    rmSync(directory, { recursive: true, force: true })
  })
  function row(type: string, payload: string, session = 'alpha', at = ordinal++) {
    const id = 'fictional-' + ordinal++
    db.prepare(
      `INSERT INTO events
      (id, session_id, generation, ordinal, type, payload, created_at) VALUES (?, ?, 0, ?, ?, ?, 1000)`,
    ).run(id, session, at, type, payload)
    return id
  }

  it('ignores content and working/idle statuses, but includes terminal and unread statuses', () => {
    const before = sample(routes)
    row('text', '{"type":"text","text":"fictional"}')
    for (const state of ['working', 'idle'])
      row('status', JSON.stringify({ type: 'status', state }))
    expect(sameWindowWriter(before, sample(routes))).toBe(true)
    row('status', '{"type":"status","state":"ended"}')
    const ended = sample(routes)
    expect(sameWindowWriter(before, ended)).toBe(false)
    row('status', '{')
    expect(sameWindowWriter(ended, sample(routes))).toBe(false)
  })

  it('includes old-row payload updates, reclassification, deletion and rolled-back changes', () => {
    const id = row('request_routed', '{"type":"request_routed","requestId":"fictional"}')
    const before = sample(routes)
    db.prepare('UPDATE events SET payload = ? WHERE id = ?').run('{', id)
    const updated = sample(routes)
    expect(sameWindowWriter(before, updated)).toBe(false)
    db.exec('BEGIN')
    db.prepare('DELETE FROM events WHERE id = ?').run(id)
    expect(sample(routes)).toBeNull()
    db.exec('ROLLBACK')
    expect(sameWindowWriter(updated, sample(routes))).toBe(true)
    db.prepare('UPDATE events SET type = ? WHERE id = ?').run('text', id)
    expect(sameWindowWriter(updated, sample(routes))).toBe(false)
    const newId = row('question_asked', '{}')
    const inserted = sample(routes)
    db.prepare('DELETE FROM events WHERE id = ?').run(newId)
    expect(sameWindowWriter(inserted, sample(routes))).toBe(false)
  })

  it('leads ignore other sessions, above-bound rows and timestamp-only updates', () => {
    const before = sample(leads)
    row('user_turn', '{"sent":"fictional"}', 'beta', 2)
    row('user_turn', '{"sent":"fictional"}', 'alpha', 10)
    expect(sameWindowWriter(before, sample(leads))).toBe(true)
    const id = row('user_turn', '{"sent":"fictional"}', 'alpha', 3)
    const included = sample(leads)
    expect(sameWindowWriter(before, included)).toBe(false)
    db.prepare('UPDATE events SET created_at = 2000 WHERE id = ?').run(id)
    expect(sameWindowWriter(included, sample(leads))).toBe(true)
    db.prepare('UPDATE events SET ordinal = 12 WHERE id = ?').run(id)
    expect(sameWindowWriter(included, sample(leads))).toBe(false)
  })

  it('REPLACE cannot delete a relevant fact without moving its revision', () => {
    const id = row('request_routed', '{"type":"request_routed","requestId":"fictional"}')
    const before = sample(routes)
    db.prepare(
      `INSERT OR REPLACE INTO events
      (id, session_id, generation, ordinal, type, payload, created_at)
      SELECT id, session_id, generation, ordinal, 'text', '{"type":"text"}', created_at
      FROM events WHERE id = ?`,
    ).run(id)
    expect(sameWindowWriter(before, sample(routes))).toBe(false)
    db.pragma('recursive_triggers = OFF')
    expect(sample(routes)).toBeNull()
  })

  it('building an inactive projection does not invalidate until it becomes active', () => {
    const before = sample(routes)
    const leadBefore = sample(leads)
    const id = row('user_turn', '{"sent":"fictional"}', 'alpha', 4)
    const activeLead = sample(leads)
    db.prepare('UPDATE events SET generation = 1 WHERE id = ?').run(id)
    const inactiveLead = sample(leads)
    expect(sameWindowWriter(activeLead, inactiveLead)).toBe(false)
    const other = row('request_resolved', '{"type":"request_resolved","id":"fictional"}', 'beta', 5)
    db.prepare('UPDATE events SET generation = 1 WHERE id = ?').run(other)
    db.prepare('UPDATE events SET payload = ? WHERE id = ?').run('{"sent":"changed"}', id)
    expect(sameWindowWriter(before, sample(routes))).toBe(true)
    expect(sameWindowWriter(inactiveLead, sample(leads))).toBe(true)
    expect(sameWindowWriter(leadBefore, sample(leads))).toBe(false)
  })

  it('active-generation changes invalidate routes and only the affected lead session', () => {
    const before = sample(routes)
    const alpha = sample(leads)
    const betaQuery = { ...leads, sessionId: 'beta' }
    const beta = sample(betaQuery)
    db.prepare(
      `INSERT INTO derived_generation
      (session_id, active, normalizer_version, derived_through, highest, updated_at)
      VALUES ('alpha', 1, 1, 0, 1, 1000)`,
    ).run()
    expect(sameWindowWriter(before, sample(routes))).toBe(false)
    expect(sameWindowWriter(alpha, sample(leads))).toBe(false)
    expect(sameWindowWriter(beta, sample(betaQuery))).toBe(true)
    const active = sample(routes)
    db.prepare('UPDATE derived_generation SET building = 2 WHERE session_id = ?').run('alpha')
    expect(sameWindowWriter(active, sample(routes))).toBe(true)
    db.prepare('DELETE FROM derived_generation WHERE session_id = ?').run('alpha')
    expect(sameWindowWriter(active, sample(routes))).toBe(false)
  })

  it('samplers sharing a writer cannot alias watchers, and eviction changes their identity', () => {
    const before = sample(leads)
    const other = windowWriterSampler(db, () => true)
    expect(sameWindowWriter(before, other(leads))).toBe(true)
    other({ ...leads, sessionId: 'beta' })
    expect(sameWindowWriter(before, sample(leads))).toBe(true)
    for (let i = 11; i < 280; i++) other({ ...leads, before: i })
    expect(sameWindowWriter(before, sample(leads))).toBe(false)
    expect(db.prepare('SELECT count(*) AS n FROM temp.window_read_revision').get()).toEqual({
      n: 257,
    })
  })

  it('external commits, retained cursors and closed writers cannot pass freshness', () => {
    const before = sample(routes)
    const external = openDatabase(db.name)
    try {
      external.prepare('UPDATE provider_session SET updated_at = updated_at + 1').run()
    } finally {
      external.close()
    }
    expect(sameWindowWriter(before, sample(routes))).toBe(false)
    expect(windowWriterSampler(db, () => false)(routes)).toBeNull()
    db.close()
    expect(sample(routes)).toBeNull()
  })

  it.each(['window_read_event_INSERT', 'window_read_generation_UPDATE'])(
    'a missing %s trigger makes both snapshot kinds unsampled',
    (trigger) => {
      expect(sample(routes)).not.toBeNull()
      expect(sample(leads)).not.toBeNull()
      db.exec(`DROP TRIGGER temp.${trigger}`)
      expect(sample(routes)).toBeNull()
      expect(sample(leads)).toBeNull()
    },
  )

  it('an unreadable counter and a recreated counter cannot validate an older sample', () => {
    const before = sample(routes)
    expect(before).not.toBeNull()
    db.exec('DROP TABLE temp.window_read_revision')
    expect(sample(routes)).toBeNull()
    expect(sample(leads)).toBeNull()
    const repaired = windowWriterSampler(db, () => true)
    expect(repaired(routes)).not.toBeNull()
    expect(repaired(leads)).not.toBeNull()
    expect(sameWindowWriter(before, repaired(routes))).toBe(false)
  })

  it.each(['reopen', 'restore'] as const)(
    'a writer opened after %s installs triggers after migrations and detects relevant writes',
    async (kind) => {
      const oldSample = sample
      const oldStamp = sample(routes)
      const file = kind === 'restore' ? join(directory, 'restored.sqlite') : db.name
      if (kind === 'restore') await db.backup(file)
      db.close()
      db = openDatabase(file)
      applyMigrations(db, migrations)
      expect(
        db.prepare("SELECT count(*) AS n FROM sqlite_temp_master WHERE type = 'trigger'").get(),
      ).toEqual({ n: 0 })
      sample = windowWriterSampler(db, () => true)
      expect(
        db.prepare("SELECT count(*) AS n FROM sqlite_temp_master WHERE type = 'trigger'").get(),
      ).toEqual({ n: 6 })
      const before = sample(routes)
      const leadBefore = sample(leads)
      expect(before).not.toBeNull()
      expect(leadBefore).not.toBeNull()
      expect(oldSample(routes)).toBeNull()
      expect(sameWindowWriter(oldStamp, before)).toBe(false)
      row('request_resolved', '{"type":"request_resolved","id":"fictional"}')
      expect(sameWindowWriter(before, sample(routes))).toBe(false)
      row('user_turn', '{"sent":"fictional"}', 'alpha', 3)
      expect(sameWindowWriter(leadBefore, sample(leads))).toBe(false)
    },
  )

  it('a table replaced after installation stays unsampled until its triggers are reinstalled', () => {
    const before = sample(routes)
    const schema = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'events'")
      .get() as { sql: string }
    db.exec('DROP TABLE events')
    expect(sample(routes)).toBeNull()
    db.exec(schema.sql)
    expect(sample(routes)).toBeNull()
    const repaired = windowWriterSampler(db, () => true)
    expect(repaired(routes)).not.toBeNull()
    expect(sameWindowWriter(before, repaired(routes))).toBe(false)
    const restored = repaired(routes)
    row('request_routed', '{"type":"request_routed","requestId":"restored"}')
    expect(sameWindowWriter(restored, repaired(routes))).toBe(false)
  })

  it('bundle rows run without tracking triggers and fence every counter once', () => {
    const store = createSessionStore(db)
    let seen = 0
    db.function('fictional_bulk_probe', (count: unknown) => {
      seen++
      expect(sample(routes)).toBeNull()
      expect(sample(leads)).toBeNull()
      expect(count).toBe(0)
      return 0
    })
    db.exec(`CREATE TEMP TRIGGER fictional_probe AFTER INSERT ON main.events
      BEGIN SELECT fictional_bulk_probe((SELECT count(*) FROM sqlite_temp_master
        WHERE type = 'trigger' AND name LIKE 'window_read_%')); END`)
    const before = sample(routes)
    const leadBefore = sample(leads)
    store.importSnapshot({
      session: {
        id: 'bundle',
        provider: 'claude',
        sessionId: 'fictional-bundle',
        cwd: directory,
        profileId: 'fictional',
        updatedAt: 1000,
        createdAt: 1000,
      },
      derivedThrough: 0,
      ledger: Array.from({ length: 100 }, (_, i) => ({
        ordinal: i,
        at: 1000,
        event: { type: 'assistant_message' as const, text: 'fictional' },
      })),
    })
    expect(seen).toBe(100)
    expect(sample(routes)?.revision).toBe(before!.revision + 1n)
    expect(sample(leads)?.revision).toBe(leadBefore!.revision + 1n)
    expect(sample(routes)).not.toBeNull()
    const generation = store.beginGeneration('alpha')
    const next = sample(routes)
    store.appendGeneration('alpha', generation, [
      { ordinal: 0, at: 1000, event: { type: 'assistant_message', text: 'fictional projection' } },
    ])
    expect(sample(routes)?.revision).toBe(next!.revision + 1n)
  })

  it('a failed bulk restores triggers and still fences an earlier read', () => {
    const before = sample(routes)
    expect(() =>
      withWindowWriteFence(db, () => {
        throw new Error('fictional failure')
      }),
    ).toThrow('fictional failure')
    expect(sample(routes)?.revision).toBe(before!.revision + 1n)
    expect(sample(routes)).not.toBeNull()
  })

  it('failed trigger restoration retries on the next sample and warns at most once a minute', () => {
    let clock = 0
    sample = windowWriterSampler(
      db,
      () => true,
      () => clock,
    )
    const before = sample(routes)
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const original = db.exec.bind(db)
    const exec = vi.spyOn(db, 'exec').mockImplementation((sql) => {
      if (sql.includes('CREATE TEMP TRIGGER')) throw new Error('fictional restoration failure')
      return original(sql)
    })
    withWindowWriteFence(db, () => row('request_resolved', '{}'))
    expect(sample(routes)).toBeNull()
    expect(sample(leads)).toBeNull()
    expect(warned).toHaveBeenCalledTimes(1)
    clock = 59_999
    expect(sample(routes)).toBeNull()
    expect(warned).toHaveBeenCalledTimes(1)
    clock = 60_000
    expect(sample(leads)).toBeNull()
    expect(warned).toHaveBeenCalledTimes(2)
    exec.mockRestore()
    const recovered = sample(routes)
    expect(recovered).not.toBeNull()
    expect(sample(leads)).not.toBeNull()
    expect(sameWindowWriter(before, recovered)).toBe(false)
    const current = sample(routes)
    row('request_resolved', '{}')
    expect(sameWindowWriter(current, sample(routes))).toBe(false)
    expect(warned).toHaveBeenCalledTimes(2)
  })

  it('measures paired counter cost at realistic and maximum watcher counts', () => {
    const measurements: {
      round: number
      mode: string
      kind: string
      writes: number
      leadWatchers: number
      elapsedMs: number
      usPerRow: number
    }[] = []
    const writes = 3000
    for (let round = 0; round < 5; round++)
      for (const leadWatchers of [0, 1, 8, 256]) {
        const modes =
          round % 2 === 0 ? (['plain', 'watched'] as const) : (['watched', 'plain'] as const)
        for (const mode of modes) {
          const writeDb = openDatabase(join(directory, `${round}-${leadWatchers}-${mode}.sqlite`))
          try {
            applyMigrations(writeDb, migrations)
            createSessionStore(writeDb).create({
              id: 'alpha',
              provider: 'codex',
              cwd: directory,
              approvalMode: 'ask',
              profileId: 'fictional',
            })
            if (mode === 'watched') {
              const watched = windowWriterSampler(writeDb, () => true)
              for (let i = 0; i < leadWatchers; i++)
                watched({ ...leads, before: Number.MAX_SAFE_INTEGER - i })
            }
            const insert = writeDb.prepare(`INSERT INTO events
            (id, session_id, generation, ordinal, type, payload, created_at)
            VALUES (?, 'alpha', 0, ?, ?, ?, 1000)`)
            insert.run('seed', 0, 'request_routed', '{"type":"request_routed","requestId":"seed"}')
            for (let i = 0; i < 100; i++)
              insert.run(`warm-${i}`, i + 1, 'text', '{"type":"text","text":"warm"}')
            for (const kind of ['ordinary', 'relevant'] as const) {
              const inputs = Array.from({ length: writes }, (_, i) => {
                const type = kind === 'ordinary' ? (i % 2 ? 'status' : 'text') : 'request_resolved'
                return {
                  id: kind + i,
                  ordinal: 101 + i + (kind === 'ordinary' ? 0 : writes),
                  type,
                  payload:
                    type === 'status'
                      ? '{"type":"status","state":"working"}'
                      : JSON.stringify({ type, id: 'fictional', text: 'fictional stream' }),
                }
              })
              const began = performance.now()
              writeDb.transaction(() => {
                for (const input of inputs)
                  insert.run(input.id, input.ordinal, input.type, input.payload)
              })()
              const elapsedMs = performance.now() - began
              measurements.push({
                round,
                mode,
                kind,
                writes,
                leadWatchers,
                elapsedMs,
                usPerRow: (elapsedMs * 1000) / writes,
              })
            }
          } finally {
            writeDb.close()
          }
        }
      }
    const evidence = process.env['BROBOT_WINDOW_WRITE_OVERHEAD']
    if (evidence !== undefined)
      writeFileSync(evidence, JSON.stringify(measurements, null, 2) + '\n')
  }, 30_000)
})
