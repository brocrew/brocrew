import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, expect, it } from 'vitest'
import {
  readCodexDiscovery,
  readCodexRolloutPath,
  readCodexRolloutPaths,
} from '../src/main/database/codex-records'

let root: string
let state: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'brocrew-codex-records-'))
  state = join(root, 'state_5.sqlite')
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

it('returns original discovery rows in native timestamp order with optional fields and spawn edges', () => {
  const db = new Database(state)
  try {
    db.exec(`CREATE TABLE threads (
      id TEXT, cwd TEXT, rollout_path TEXT, archived INTEGER, created_at INTEGER,
      created_at_ms INTEGER, updated_at INTEGER, updated_at_ms INTEGER,
      title, source, agent_role);
      CREATE TABLE thread_spawn_edges (child_thread_id TEXT, parent_thread_id TEXT)`)
    const insert = db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    insert.run('older', '/older', '/older.jsonl', 0, 10, null, 20, 90_000, null, 'cli', null)
    insert.run('newer', '/newer', '/newer.jsonl', 1, 11, 11_001, 30, null, 'Raw title', '{raw}', 'worker')
    db.prepare('INSERT INTO thread_spawn_edges VALUES (?, ?)').run('newer', 'older')
  } finally {
    db.close()
  }
  expect(readCodexDiscovery(state)).toEqual({
    rows: [
      {
        id: 'newer', cwd: '/newer', rollout_path: '/newer.jsonl', archived: 1,
        created_at: 11, created_at_ms: 11_001, updated_at: 30, updated_at_ms: null,
        title: 'Raw title', source: '{raw}', agent_role: 'worker',
      },
      {
        id: 'older', cwd: '/older', rollout_path: '/older.jsonl', archived: 0,
        created_at: 10, created_at_ms: null, updated_at: 20, updated_at_ms: 90_000,
        title: null, source: 'cli', agent_role: null,
      },
    ],
    edges: [{ child_thread_id: 'newer', parent_thread_id: 'older' }],
  })
})

it('keeps a readable older schema distinct from an unreadable database when optional fields and edges are absent', () => {
  const db = new Database(state)
  try {
    db.exec(`CREATE TABLE threads (
      id TEXT, cwd TEXT, rollout_path TEXT, archived INTEGER, created_at INTEGER,
      created_at_ms INTEGER, updated_at INTEGER, updated_at_ms INTEGER)`)
    db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('thread', '/work', '/rollout.jsonl', 0, 1, null, 2, null)
  } finally {
    db.close()
  }
  expect(readCodexDiscovery(state)).toEqual({
    rows: [{
      id: 'thread', cwd: '/work', rollout_path: '/rollout.jsonl', archived: 0,
      created_at: 1, created_at_ms: null, updated_at: 2, updated_at_ms: null,
    }],
    edges: [],
  })
})

it('retains single and batch path behavior for missing, non-string and repeated thread ids', () => {
  const db = new Database(state)
  try {
    db.exec('CREATE TABLE threads (id TEXT, rollout_path)')
    const insert = db.prepare('INSERT INTO threads VALUES (?, ?)')
    insert.run('first', '/first.jsonl')
    insert.run('second', '/second.jsonl')
    insert.run('not-a-path', 42)
  } finally {
    db.close()
  }
  expect(readCodexRolloutPath(state, 'first')).toBe('/first.jsonl')
  expect(readCodexRolloutPath(state, 'missing')).toBeNull()
  expect(readCodexRolloutPath(state, 'not-a-path')).toBeNull()
  expect(readCodexRolloutPaths(state, ['second', 'missing', 'first', 'second', 'not-a-path']))
    .toEqual(new Map([['second', '/second.jsonl'], ['first', '/first.jsonl']]))
  expect(readCodexRolloutPaths(state, [])).toEqual(new Map())
})

it('keeps unreadable and missing database failures as null for every query', () => {
  writeFileSync(state, 'not a database')
  for (const file of [state, join(root, 'missing.sqlite')]) {
    expect(readCodexDiscovery(file)).toBeNull()
    expect(readCodexRolloutPath(file, 'thread')).toBeNull()
    expect(readCodexRolloutPaths(file, ['thread'])).toBeNull()
  }
})

it('reads committed WAL rows without changing any source database family bytes', () => {
  const db = new Database(state)
  try {
    db.pragma('journal_mode = WAL')
    db.pragma('wal_autocheckpoint = 0')
    db.exec(`CREATE TABLE threads (
      id TEXT, cwd TEXT, rollout_path TEXT, archived INTEGER, created_at INTEGER,
      created_at_ms INTEGER, updated_at INTEGER, updated_at_ms INTEGER)`)
    db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('wal-thread', '/work', '/wal.jsonl', 0, 1, null, 2, null)
    const before = new Map(readdirSync(root).map((name) => [name, readFileSync(join(root, name))]))
    expect(before.has('state_5.sqlite-wal')).toBe(true)
    expect(readCodexDiscovery(state)?.rows.map((row) => row.id)).toEqual(['wal-thread'])
    expect(readCodexRolloutPath(state, 'wal-thread')).toBe('/wal.jsonl')
    expect(readCodexRolloutPaths(state, ['wal-thread'])).toEqual(new Map([['wal-thread', '/wal.jsonl']]))
    expect(readdirSync(root).sort()).toEqual([...before.keys()].sort())
    for (const [name, bytes] of before) expect(readFileSync(join(root, name))).toEqual(bytes)
  } finally {
    db.close()
  }
})
