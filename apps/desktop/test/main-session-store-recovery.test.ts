import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
let root: string
let db: AppDatabase
let store: SessionStore

const torn = (ordinal: number): void => {
  db.prepare(
    `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
     VALUES (?, 'sess_recovery', 0, ?, 'user_turn', '{not json', ?)`,
  ).run(`evt_torn_${ordinal}`, ordinal, ordinal + 1)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'brobot-session-recovery-'))
  db = openDatabase(join(root, 'db.sqlite'))
  applyMigrations(db, migrations)
  store = createSessionStore(db, () => 1_000)
  store.create({
    id: 'sess_recovery',
    provider: 'codex',
    cwd: root,
    approvalMode: 'ask',
    profileId: 'worker',
  })
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  db.close()
  rmSync(root, { recursive: true, force: true })
})

it('continues a windowed ledger read past a whole window of torn rows', () => {
  torn(0)
  torn(1)
  store.append('sess_recovery', 2, { type: 'user_turn', text: 'Readable after the damage' }, 3)
  expect(store.eventsFrom('sess_recovery', 0, 1)).toMatchObject([
    { ordinal: 2, event: { type: 'user_turn', text: 'Readable after the damage' } },
  ])
  store.append('sess_recovery', 3, { type: 'user_turn', text: 'A later message' }, 4)
  expect(store.eventsFrom('sess_recovery', 3, 1)).toMatchObject([
    { ordinal: 3, event: { type: 'user_turn', text: 'A later message' } },
  ])
  expect(store.eventsFrom('sess_recovery', 4, 1)).toEqual([])
})

it('finds the newest readable event when a newer row of the same type is torn', () => {
  store.append('sess_recovery', 0, { type: 'user_turn', text: 'Still readable' }, 1)
  torn(1)
  expect(store.newestOfType?.('sess_recovery', 'user_turn')).toMatchObject({
    ordinal: 0,
    event: { type: 'user_turn', text: 'Still readable' },
  })
  expect(store.newestOfType?.('sess_recovery', 'user_turn', undefined, 1)).toBeNull()
  expect(store.events('sess_recovery').map((one) => one.ordinal)).toEqual([0])
})
