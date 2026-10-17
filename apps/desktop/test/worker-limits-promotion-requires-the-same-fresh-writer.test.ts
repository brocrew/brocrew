import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { LimitsReadEngine } from '../src/main/db/limits-read-engine'
import { freshLimitsSnapshot, limitsWriterSampler } from '../src/main/db/fresh-limits-snapshot'
import type { LimitsReadInput } from '../src/main/db/limits-read-protocol'
import { PROVIDER_WALL_LOOKBACK_MS } from '../src/shared/provider-limit'

const HERE = dirname(fileURLToPath(import.meta.url))
const AT = Date.UTC(2026, 9, 8, 21)
const input: LimitsReadInput = {
  operation: 1,
  databaseEpoch: 1,
  signInEpoch: 1,
  capturedAt: AT - 1,
  signInChangedAt: {},
  usage: {},
}

describe('only a fresh unchanged writer authorizes canonical preparation', () => {
  let directory: string
  let file: string
  let db: AppDatabase
  let clock: number
  const readers: LimitsReadEngine[] = []
  const others: Database.Database[] = []
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'brobot-fictional-limits-stamp-'))
    file = join(directory, 'fictional.sqlite')
    db = openDatabase(file)
    applyMigrations(db, join(HERE, '../src/main/db/migrations'))
    clock = AT
    db.exec('CREATE TABLE fictional_stamp_changes (id INTEGER)')
  })
  afterEach(() => {
    for (const reader of readers.splice(0)) reader.close()
    for (const other of others.splice(0)) other.close()
    vi.restoreAllMocks()
    db.close()
    rmSync(directory, { recursive: true, force: true })
  })
  const sample = () =>
    limitsWriterSampler(
      db,
      () => true,
      () => ++clock,
    )
  function read() {
    const reader = new LimitsReadEngine(file, () => ++clock)
    readers.push(reader)
    return reader.read(input)
  }

  it('accepts the real canonical complete empty snapshot even when no candidate ledger was counted', () => {
    const stamp = sample()
    const before = stamp()
    const result = read()
    const after = stamp()
    expect(result.canonical).toEqual({
      walk: 'every-provider-wall-recently-recorded',
      rows: [],
      ledgers: 0,
      rowsUnread: 0,
    })
    expect(before).not.toBeNull()
    expect(after).not.toBeNull()
    expect(freshLimitsSnapshot(input, result, before, after)).toBe(true)
  })

  it.each(['own', 'external', 'rollback'] as const)(
    'rejects overlapping %s changes after an actual native snapshot',
    (write) => {
      const stamp = sample()
      const before = stamp()
      const result = read()
      if (write === 'own') db.exec('INSERT INTO fictional_stamp_changes VALUES (1)')
      if (write === 'rollback')
        db.exec('BEGIN; INSERT INTO fictional_stamp_changes VALUES (1); ROLLBACK')
      if (write === 'external') {
        const other = new Database(file)
        others.push(other)
        other.exec('INSERT INTO fictional_stamp_changes VALUES (1)')
      }
      const after = stamp()
      expect(before).not.toBeNull()
      expect(after).not.toBeNull()
      expect(freshLimitsSnapshot(input, result, before, after)).toBe(false)
    },
  )

  it('rejects explicit transactions and an owned cursor at either sample without substituting a zero', () => {
    let noCursor = true
    const stamp = limitsWriterSampler(
      db,
      () => noCursor,
      () => ++clock,
    )
    expect(stamp()).not.toBeNull()
    db.exec('BEGIN')
    expect(stamp()).toBeNull()
    db.exec('ROLLBACK')
    noCursor = false
    expect(stamp()).toBeNull()
    noCursor = true
    expect(stamp()).not.toBeNull()
  })

  it('retained native iterators from every main store owner prevent a fresh snapshot', () => {
    const statements: Database.Statement[] = []
    const prepare = db.prepare.bind(db)
    vi.spyOn(db, 'prepare').mockImplementation((sql) => {
      const statement = prepare(sql)
      statements.push(statement)
      return statement
    })
    const store = createSessionStore(db, () => AT)
    store.create({
      id: 'fictional',
      provider: 'claude',
      cwd: directory,
      approvalMode: 'ask',
      profileId: 'fictional',
    })
    db.prepare(
      'INSERT INTO events (id,session_id,generation,ordinal,type,payload,created_at) VALUES (?,?,?,?,?,?,?)',
    ).run(
      'fictional-workflow',
      'fictional',
      0,
      0,
      'workflow_run',
      JSON.stringify({
        taskId: 'task',
        outputFile: 'fictional.md',
        agents: [{ agentId: 'agent' }],
      }),
      AT,
    )
    db.prepare(
      'INSERT INTO events (id,session_id,generation,ordinal,type,payload,created_at) VALUES (?,?,?,?,?,?,?)',
    ).run(
      'fictional-agent',
      'fictional',
      0,
      1,
      'sub_agent',
      JSON.stringify({ agentId: 'agent' }),
      AT,
    )
    db.prepare(
      'INSERT INTO events (id,session_id,generation,ordinal,type,payload,created_at) VALUES (?,?,?,?,?,?,?)',
    ).run(
      'fictional-person-turn',
      'fictional',
      0,
      2,
      'user_turn',
      JSON.stringify({ type: 'user_turn', text: 'fictional person writes' }),
      AT,
    )
    const owners = statements.filter(
      (statement) =>
        statement.source.includes('run.readable AS readable') ||
        statement.source.includes('reported.readable AS readable') ||
        (statement.source.includes("type = 'user_turn'") &&
          statement.source.includes('created_at AS at') &&
          statement.source.includes('ORDER BY ordinal DESC LIMIT ?')),
    )
    expect(owners).toHaveLength(4)
    const stamp = limitsWriterSampler(
      db,
      () => store.canReadFreshSnapshot?.() === true,
      () => ++clock,
    )
    for (const statement of owners) {
      const argument = statement.source.includes('ORDER BY ordinal DESC LIMIT ?')
        ? 200
        : statement.source.includes('AS path')
          ? 'task'
          : 'agent'
      const cursor = statement.iterate('fictional', 0, argument)
      expect(cursor.next().done).toBe(false)
      expect(statement.busy).toBe(true)
      expect(store.canReadFreshSnapshot?.()).toBe(false)
      expect(stamp()).toBeNull()
      cursor.return?.()
      expect(statement.busy).toBe(false)
      expect(stamp()).not.toBeNull()
      const exhausted = statement.iterate('fictional', 0, argument)
      expect([...exhausted]).toHaveLength(1)
      expect(stamp()).not.toBeNull()
      for (const row of statement.iterate('fictional', 0, argument)) {
        expect(row).toBeDefined()
        expect(stamp()).toBeNull()
        break
      }
      expect(statement.busy).toBe(false)
      expect(stamp()).not.toBeNull()
      expect(() => {
        for (const row of statement.iterate('fictional', 0, argument)) {
          expect(row).toBeDefined()
          expect(stamp()).toBeNull()
          throw new Error('fictional consumer stopped')
        }
      }).toThrow('fictional consumer stopped')
      expect(statement.busy).toBe(false)
      expect(stamp()).not.toBeNull()
    }
    expect(store.workflowOutputPath('fictional', 'task')).toBe('fictional.md')
    expect(store.whenAPersonLastWrote('fictional')).toBe(AT)
    expect(stamp()).not.toBeNull()
  })

  it('the exhaustive iterator census detects a new owner and requires all busy guards', () => {
    const source = readFileSync(join(HERE, '../src/main/db/session-store.ts'), 'utf8')
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const owners = (text: string) =>
      [...text.matchAll(/\b([A-Za-z_$][\w$]*)\.iterate\(/g)].map((match) => match[1]).sort()
    const expected = [
      'selectNewestTurnsOpened',
      'selectSubAgentReported',
      'selectWorkflowAgentTask',
      'selectWorkflowOutput',
    ]
    expect(owners(code)).toEqual(expected)
    expect(owners(code + '\nnewOwner.iterate()')).not.toEqual(expected)
    const fenced = (text: string) =>
      expected.every((owner) => text.includes(`${owner}.busy === false`))
    expect(fenced(code)).toBe(true)
    for (const owner of expected) {
      expect(owners(code.replace(`${owner}.iterate(`, 'missingOwner.iterate('))).not.toEqual(
        expected,
      )
      expect(fenced(code.replace(`${owner}.busy === false`, 'true'))).toBe(false)
    }
  })

  it('rejects wrong job, lifetime, writer, unsafe counters, coverage and both wall expiry boundaries', () => {
    const stamp = sample()
    const before = stamp()!
    const result = read()
    const after = stamp()!
    expect(freshLimitsSnapshot(input, result, before, after)).toBe(true)
    for (const changed of [
      { ...result, operation: 2 },
      { ...result, signInEpoch: 2 },
      { ...result, databaseEpoch: 2 },
      { ...result, snapshotPinStartedAt: before.at - 1 },
      { ...result, canonical: { ...result.canonical, rowsUnread: 1 } },
    ])
      expect(freshLimitsSnapshot(input, changed, before, after)).toBe(false)
    expect(freshLimitsSnapshot(input, result, before, { ...after, writer: {} })).toBe(false)
    expect(freshLimitsSnapshot(input, result, before, { ...after, totalChanges: -1n })).toBe(false)
    expect(freshLimitsSnapshot(input, result, before, { ...after, at: NaN })).toBe(false)
    const base = {
      provider: 'claude' as const,
      window: 'short',
      standing: 'stopped' as const,
      said: 'fictional',
      at: AT - 100,
      resetsAt: null,
    }
    const withWall = { ...result, canonical: { ...result.canonical, rows: [base] } }
    expect(freshLimitsSnapshot(input, withWall, before, after)).toBe(true)
    expect(
      freshLimitsSnapshot(
        input,
        {
          ...withWall,
          canonical: { ...withWall.canonical, rows: [{ ...base, resetsAt: after.at }] },
        },
        before,
        after,
      ),
    ).toBe(false)
    expect(
      freshLimitsSnapshot(
        input,
        {
          ...withWall,
          canonical: {
            ...withWall.canonical,
            rows: [{ ...base, at: after.at - PROVIDER_WALL_LOOKBACK_MS }],
          },
        },
        before,
        after,
      ),
    ).toBe(false)
  })
})
