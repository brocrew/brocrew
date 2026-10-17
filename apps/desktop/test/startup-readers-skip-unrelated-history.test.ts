import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

describe('startup readers skip unrelated history', () => {
  let directory: string
  let db: AppDatabase
  let store: SessionStore
  let prepared: string[]
  let next: number

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'brobot-startup-reads-'))
    db = openDatabase(':memory:')
    applyMigrations(db, migrations)
    prepared = []
    const prepare = db.prepare.bind(db)
    vi.spyOn(db, 'prepare').mockImplementation((sql) => {
      prepared.push(sql)
      return prepare(sql)
    })
    store = createSessionStore(db, () => 1)
    next = 0
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    db.close()
    rmSync(directory, { recursive: true, force: true })
  })

  function conversation(id: string): string {
    store.create({
      id,
      provider: 'claude',
      cwd: directory,
      approvalMode: 'ask',
      profileId: 'agent',
    })
    return id
  }

  function row(
    session: string,
    type: string,
    payload: object | string,
    at: number,
    generation = 0,
    ordinal = next,
  ): void {
    next += 1
    db.prepare(
      `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      `fixture-${next}`,
      session,
      generation,
      ordinal,
      type,
      typeof payload === 'string' ? payload : JSON.stringify(payload),
      at,
    )
  }

  const schedules = () =>
    [...store.newestScheduleLevels()].sort((a, b) => a.conversation.localeCompare(b.conversation))

  it('orders levels by time, generation and ordinal, with cross-generation receipts and compactions', () => {
    const live = conversation('live')
    row(live, 'scheduled_work', { jobs: [{ id: 'alpha' }] }, 100, 0, 0)
    row(live, 'scheduled_work', { jobs: [{ id: 'beta' }] }, 300, 4, 0)
    row(
      live,
      'scheduled_work',
      { jobs: [{ id: 'alpha', prompt: 'older generation' }] },
      400,
      1,
      999,
    )
    row(live, 'scheduled_work', { jobs: [{ id: 'alpha', prompt: 'older ordinal' }] }, 400, 5, 0)
    row(live, 'scheduled_work', { jobs: [{ id: 'beta', prompt: 'winner' }] }, 400, 5, 1)
    row(live, 'compaction', {}, 450, 8, 0)
    row(live, 'compaction', {}, 200, 9, 0)
    row(live, 'scheduled_work', { source: 'no level' }, 600, 9, 1)
    db.prepare(
      `INSERT INTO derived_generation
       (session_id, active, normalizer_version, derived_through, highest, updated_at)
       VALUES (?, 9, 1, 2, 2, 1)`,
    ).run(live)
    expect(schedules()).toEqual([
      {
        conversation: live,
        level: { jobs: [{ id: 'beta', prompt: 'winner', listedSince: 300 }], dropped: 0 },
        compactedAt: 450,
      },
    ])
  })

  it('keeps empty cancellation, dropped-only and torn newest levels separate from older jobs', () => {
    const cleared = conversation('cleared')
    row(cleared, 'scheduled_work', { jobs: [{ id: 'cancelled' }] }, 100)
    row(cleared, 'scheduled_work', { jobs: [] }, 200, 2)
    const torn = conversation('torn')
    row(torn, 'scheduled_work', { jobs: [{ id: 'never resurrect' }] }, 100)
    row(torn, 'scheduled_work', 'not JSON', 200, 3)
    const dropped = conversation('dropped')
    row(dropped, 'scheduled_work', { jobs: [], dropped: 2 }, 300)
    expect(schedules()).toEqual([
      { conversation: dropped, level: { jobs: [], dropped: 2 }, compactedAt: null },
    ])
    expect(console.warn).toHaveBeenCalledOnce()
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('unreadable schedule in torn'),
    )
  })

  it('retains readable jobs and counts malformed metadata and stated unread jobs', () => {
    const live = conversation('short')
    row(live, 'scheduled_work', { jobs: [{ id: 'ok' }, { id: 'removed' }] }, 10)
    row(
      live,
      'scheduled_work',
      {
        jobs: [
          { id: 'ok', schedule: '0 3 * * *', recurring: true },
          { id: 'bad-schedule', schedule: 7 },
          { id: 'bad-recurring', recurring: 7 },
          { id: 'bad-prompt', prompt: 7 },
          { id: 7 },
          null,
        ],
        dropped: 2,
      },
      20,
    )
    expect(schedules()).toEqual([
      {
        conversation: live,
        level: {
          jobs: [{ id: 'ok', schedule: '0 3 * * *', recurring: true, listedSince: 10 }],
          dropped: 7,
        },
        compactedAt: null,
      },
    ])
  })

  it('keeps replacement insertion order across generations and excludes torn or deleted targets', () => {
    const old = conversation('old')
    const first = conversation('first')
    const last = conversation('last')
    const missing = conversation('deleted')
    row(old, 'replaced_by', { sessionId: first }, 400, 4, 0)
    row(old, 'replaced_by', 'not JSON', 500, 8, 0)
    row(old, 'replaced_by', { sessionId: last }, 100, 0, 0)
    row(old, 'replaced_by', { sessionId: missing }, 600, 9, 0)
    db.prepare('DELETE FROM work WHERE owner_session_id = ?').run(missing)
    db.prepare('DELETE FROM provider_session WHERE id = ?').run(missing)
    row(old, 'replaced_by', { sessionId: 7 }, 700, 10, 0)
    expect(store.replacements()).toEqual([
      { replaced: old, by: first },
      { replaced: old, by: last },
    ])
    expect(new Map(store.replacements().map((one) => [one.replaced, one.by])).get(old)).toBe(last)
  })

  it('keeps background life boundaries, generation ordering, torn rows and the 200-row bound', () => {
    const live = conversation('background')
    row(live, 'background_work', { running: [{ id: 'past' }] }, 900, 0, 99)
    row(live, 'launched', {}, 100, 2, 0)
    row(live, 'background_work', { running: [{ id: 'a' }, { id: 'b' }] }, 200, 2, 1)
    row(live, 'background_work', { ended: { id: 'a' } }, 300, 2, 2)
    const torn = conversation('torn-background')
    row(torn, 'background_work', { running: [{ id: 'past' }] }, 100)
    row(torn, 'background_work', 'not JSON', 200)
    const capped = conversation('capped-background')
    row(capped, 'background_work', { running: [{ id: 'too old' }] }, 100)
    for (let n = 0; n < 200; n++)
      row(capped, 'background_work', { ended: { id: `ended-${n}` } }, 200)
    expect(store.backgroundTheRestartStopped([live, torn, capped], 1_000, 0)).toEqual([
      { conversation: live, stopped: ['b'], endedAt: 900 },
    ])
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('torn-background'))
    row(live, 'launched', {}, 950, 3, 0)
    expect(store.backgroundTheRestartStopped([live], 1_000, 0)).toEqual([])
  })

  it('keeps read work and results unchanged after adding 900,000 unrelated events', () => {
    const live = conversation('candidate')
    const target = conversation('target')
    row(live, 'scheduled_work', { jobs: [{ id: 'kept' }] }, 100)
    row(live, 'compaction', {}, 200)
    row(live, 'replaced_by', { sessionId: target }, 300)
    row(live, 'background_work', { running: [{ id: 'background' }] }, 400)
    row(live, 'status', { state: 'working' }, 500)
    for (let n = 0; n < 38; n++) conversation(`noise-${n}`)
    db.exec(`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<25000)
      INSERT INTO events (id,session_id,generation,ordinal,type,payload,created_at)
      SELECT 'fold-'||n,'noise-'||(n%38),0,n,'status','{"state":"idle"}',n FROM seq`)
    let checked = 0
    db.function('json_valid', { deterministic: true }, (text: unknown) => {
      checked += 1
      try {
        JSON.parse(String(text))
        return 1
      } catch {
        return 0
      }
    })
    const read = () => {
      checked = 0
      const result = {
        schedules: schedules(),
        replacements: store.replacements(),
        background: store.backgroundTheRestartStopped([live], 1_000, 0),
        evidence: store.scheduleEvidenceRows(live),
      }
      return { result, checked }
    }
    const before = read()
    db.exec(`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<900000)
      INSERT INTO events (id,session_id,generation,ordinal,type,payload,created_at)
      SELECT 'unrelated-'||n,'noise-'||(n%38),1,n,'tool_result','{}',n FROM seq`)
    const after = read()
    expect(after).toEqual(before)
    expect(after.checked).toBeGreaterThan(0)
    expect(after.checked).toBeLessThan(100)
    expect((db.prepare('SELECT count(*) AS n FROM events').get() as { n: number }).n).toBe(925005)
    const wanted = prepared.filter(
      (sql) =>
        sql.includes('AS first_listed') ||
        sql.startsWith('SELECT session_id, payload FROM events INDEXED') ||
        (sql.includes("type IN ('background_work', 'launched')") && sql.includes('LIMIT 200')) ||
        sql.startsWith('WITH walk AS MATERIALIZED'),
    )
    expect(wanted).toHaveLength(4)
    for (const sql of wanted) {
      const parameters = (sql.match(/\?/g) ?? []).map(() => live)
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...parameters) as {
        detail: string
      }[]
      expect(plan.some((one) => one.detail.includes('events_fold_idx'))).toBe(true)
      expect(
        plan.some(
          (one) =>
            /^(SCAN|SEARCH) (events|e)(?: |$)/.test(one.detail) &&
            !one.detail.includes('USING INDEX'),
        ),
      ).toBe(false)
      if (sql.includes('AS first_listed'))
        expect(plan.some((one) => /SEARCH e USING INDEX events_session_idx/.test(one.detail))).toBe(
          true,
        )
    }
  }, 60_000)
})
