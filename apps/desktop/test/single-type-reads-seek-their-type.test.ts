import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

/**
 * Four reads that each want one event type seek that type on the type/owner index, rather than
 * walking every fold row in their range, and answer exactly what the fold-index form answered:
 * the same rows in the same order, over ledgers where their type is rare among the others.
 */
describe('single-type reads seek their type', () => {
  let folder: string
  let db: AppDatabase
  let store: SessionStore
  let prepared: string[]

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'fictional-single-type-'))
    db = openDatabase(join(folder, 'fictional.sqlite'))
    applyMigrations(db, migrations)
    prepared = []
    const prepare = db.prepare.bind(db)
    ;(db as unknown as { prepare: typeof db.prepare }).prepare = ((sql: string) => {
      prepared.push(sql)
      return prepare(sql)
    }) as typeof db.prepare
    store = createSessionStore(db, () => 1)
    ;(db as unknown as { prepare: typeof db.prepare }).prepare = prepare
  })
  afterEach(() => {
    db.close()
    rmSync(folder, { recursive: true, force: true })
  })

  /** The one statement the store prepared that matches every one of `marks`. */
  const statement = (...marks: string[]): string => {
    const found = prepared.filter((sql) => marks.every((mark) => sql.includes(mark)))
    expect(found, marks.join(' · ')).toHaveLength(1)
    return found[0]!
  }
  const READS = {
    replacements: () =>
      statement("type = 'replaced_by' AND json_valid(payload)", 'ORDER BY events.rowid'),
    scheduleLevels: () => statement('AS first_listed', "type = 'scheduled_work'"),
    decisionOn: () =>
      statement(
        "type = 'user_decision'",
        "'$.requestId') END = ?",
        'ORDER BY ordinal DESC LIMIT 1',
      ),
    moveOffer: () => statement("json_type(payload, '$.move')", 'ORDER BY ordinal DESC LIMIT 1'),
  }
  const planOf = (sql: string): string[] =>
    (
      db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...(sql.match(/\?/g) ?? []).map(() => null)) as {
        detail: string
      }[]
    ).map((one) => one.detail)

  it('each seeks its one type on the type/owner index, and none walks the fold index', () => {
    for (const [name, read] of Object.entries(READS)) {
      const plan = planOf(read())
      const onEvents = plan.filter((detail) => /^(SEARCH|SCAN) events(?: |$)/.test(detail))
      expect(onEvents.length, name).toBeGreaterThan(0)
      for (const detail of onEvents)
        expect(detail, name).toMatch(
          /^SEARCH events USING (?:COVERING )?INDEX events_kind_owner_idx \(type=\?/,
        )
      expect(plan.join('\n'), name).not.toContain('events_fold_idx')
    }
  })

  describe('and answers as the fold-index form did, row for row', () => {
    let at = 0
    const ordinals = new Map<string, number>()
    const row = (session: string, type: string, payload: string, generation = 0) => {
      const key = `${session}:${String(generation)}`
      const ordinal = ordinals.get(key) ?? 0
      ordinals.set(key, ordinal + 1)
      db.prepare(
        'INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(`evt_${String(at)}`, session, generation, ordinal, type, payload, 1000 + at++)
    }
    const noise = (session: string, generation = 0) => {
      for (let i = 0; i < 120; i++)
        row(session, i % 3 === 0 ? 'user_turn' : 'status', '{"state":"idle"}', generation)
    }
    const asFoldIndex = (sql: string) => sql.replaceAll('events_kind_owner_idx', 'events_fold_idx')
    const both = (sql: string, ...args: unknown[]) => [
      db.prepare(asFoldIndex(sql)).all(...args),
      db.prepare(sql).all(...args),
    ]

    beforeEach(() => {
      at = 0
      ordinals.clear()
      for (const id of ['alpha', 'beta', 'gamma', 'delta'])
        store.create({
          id,
          provider: 'codex',
          cwd: folder,
          approvalMode: 'ask',
          profileId: 'fictional',
        })
      for (const id of ['alpha', 'beta', 'gamma', 'delta']) noise(id)
      row('alpha', 'replaced_by', '{"sessionId":"beta"}')
      row('gamma', 'replaced_by', '{"sessionId":"nobody"}')
      row('delta', 'replaced_by', '{not json')
      row('delta', 'replaced_by', '{"sessionId":"alpha"}')
      noise('alpha')
      row('alpha', 'scheduled_work', '{"jobs":[{"id":"j1"}]}')
      row('alpha', 'scheduled_work', '{"jobs":[{"id":"j1"},{"id":"j2"}]}')
      row('beta', 'scheduled_work', '{"jobs":[{"id":"j3"}]}')
      row('beta', 'scheduled_work', '{"jobs":[]}')
      row('gamma', 'scheduled_work', '{not json')
      row('alpha', 'user_decision', '{"requestId":"r1","decision":"allow"}')
      row('alpha', 'user_decision', '{"requestId":"r1","decision":"deny"}')
      row('alpha', 'user_decision', '{"requestId":"r2","decision":"allow"}')
      row('alpha', 'user_decision', '{not json')
      row('alpha', 'question_asked', '{"requestId":"m1","move":{"to":"x"}}')
      row('alpha', 'question_asked', '{"requestId":"q1"}')
      row('alpha', 'question_asked', '{"requestId":"m2","move":{"to":"y"}}')
      noise('alpha', 1)
      row('alpha', 'user_decision', '{"requestId":"r1","decision":"later"}', 1)
      row('alpha', 'question_asked', '{"requestId":"m3","move":{"to":"z"}}', 1)
    })

    it('replacements, in their order', () => {
      const [before, after] = both(READS.replacements())
      expect(after).toEqual(before)
      expect(after).toHaveLength(2)
    })

    it('the newest schedule level of each conversation', () => {
      const [before, after] = both(READS.scheduleLevels())
      expect(after).toEqual(before)
      expect(after!.length).toBeGreaterThan(0)
    })

    it('the decision on a request, newest first, per generation', () => {
      for (const args of [
        ['alpha', 0, 'r1'],
        ['alpha', 0, 'r2'],
        ['alpha', 1, 'r1'],
        ['beta', 0, 'r1'],
      ]) {
        const [before, after] = both(READS.decisionOn(), ...args)
        expect(after, args.join(':')).toEqual(before)
      }
    })

    it('the latest move offer, per generation', () => {
      for (const args of [
        ['alpha', 0],
        ['alpha', 1],
        ['beta', 0],
      ]) {
        const [before, after] = both(READS.moveOffer(), ...args)
        expect(after, args.join(':')).toEqual(before)
      }
    })
  })
})
