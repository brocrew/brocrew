import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import * as storage from '../src/main/db/session-store'
import { agentIdentityRowId } from '../src/main/db/identity'
import type { ActedBy } from '../src/shared/who-did-it'

interface Observation {
  fingerprint: string | null
  unreadable?: true
}
interface Write {
  profileSlug: string
  provider: 'claude' | 'codex'
  entry: string
  act: 'removed' | 'corrected' | 'restored'
  by: ActedBy
  textBefore: string | null
  textAfter: string | null
  sourceId?: string
}
interface Change extends Omit<Write, 'profileSlug'> {
  id: string
  seq: number
  at: number
  outcome?: 'pending' | 'done' | 'partial' | 'unchanged'
  actual?: Observation
  settlement?: { by: ActedBy; at: number }
}
interface Recovery {
  beginMemoryAmendment(said: Write, at: number): Change | null
  settleMemoryAmendment(slug: string, id: string, actual: Observation, by: ActedBy): boolean
  hasPendingMemoryAmendment(slug: string): boolean
  memoryAmendment(slug: string, id: string): Change | null
}
const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
const person = { who: 'a-person' } as const
const app = { who: 'the-app-itself' } as const
const agent = { who: 'an-agent', agent: 'ses-wren' } as const
const entry = '/fictional/lark/memory/note.md'
const text = 'Saved before.\r\nCafé.\n'
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const absent = { fingerprint: null }
let root: string
let db: AppDatabase
let store: storage.SessionStore
let clock: number
function recovery(): Recovery {
  expect(Reflect.get(store, 'beginMemoryAmendment'), 'durable memory intent').toBeTypeOf('function')
  return store as unknown as Recovery
}
function remove(overrides: Partial<Write> = {}): Write {
  return {
    profileSlug: 'lark',
    provider: 'claude',
    entry,
    act: 'removed',
    by: person,
    textBefore: text,
    textAfter: null,
    ...overrides,
  }
}
function observer() {
  const create = Reflect.get(storage, 'createMemoryAmendmentObserver') as (
    db: AppDatabase,
    now: () => number,
  ) => { reconcile(id: string, change: string, actual: Observation, by: ActedBy): boolean }
  expect(create, 'app-only interrupted memory observation').toBeTypeOf('function')
  return create(db, () => clock++)
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'memory-recovery-'))
  db = openDatabase(join(root, 'app.sqlite'))
  applyMigrations(db, migrations)
  clock = 1000
  store = storage.createSessionStore(db, () => clock++)
  for (const slug of ['lark', 'wren'])
    store.createAgentIdentity({ slug, displayName: null, provider: 'codex' }, { by: 'a-person' })
})
afterEach(() => {
  db.close()
  rmSync(root, { recursive: true, force: true })
})

describe('memory intent survives interruption before its single honest observation', () => {
  it('retains planned text before any effect and across a database reopen', () => {
    const saved = recovery().beginMemoryAmendment(remove(), clock++)!
    expect(saved).toMatchObject({
      outcome: 'pending',
      by: person,
      textBefore: text,
      textAfter: null,
    })
    expect(saved.actual).toBeUndefined()
    expect(saved.settlement).toBeUndefined()
    db.close()
    db = openDatabase(join(root, 'app.sqlite'))
    store = storage.createSessionStore(db, () => clock++)
    expect(recovery().memoryAmendment('lark', saved.id)).toEqual(saved)
    expect(recovery().hasPendingMemoryAmendment('lark')).toBe(true)
  })
  it('begins only for a person, a known identity, valid text and a valid time', () => {
    const api = recovery()
    for (const by of [agent, app])
      expect(api.beginMemoryAmendment(remove({ by }), clock++)).toBeNull()
    for (const at of [-1, NaN, Infinity, 0.5])
      expect(api.beginMemoryAmendment(remove(), at)).toBeNull()
    for (const bad of [
      remove({ profileSlug: 'unknown' }),
      remove({ textBefore: null }),
      remove({ textBefore: 'x'.repeat(65537) }),
      remove({ textBefore: '\ud800' }),
      remove({ textAfter: 'still here' }),
    ])
      expect(api.beginMemoryAmendment(bad, clock++)).toBeNull()
    expect(store.memoryAmendmentsOf('lark')).toEqual([])
  })
  it('serializes the identity across providers and protects pending text from identity removal', () => {
    const api = recovery()
    const saved = api.beginMemoryAmendment(remove(), clock++)!
    expect(api.beginMemoryAmendment(remove({ provider: 'codex' }), clock++)).toBeNull()
    expect(store.writeMemoryAmendment(remove(), clock++)).toBeNull()
    expect(store.removeAgentIdentity('lark')).toBe(false)
    expect(api.memoryAmendment('lark', saved.id)?.textBefore).toBe(text)
    expect(api.beginMemoryAmendment(remove({ profileSlug: 'wren' }), clock++)).not.toBeNull()
    expect(api.settleMemoryAmendment('lark', saved.id, absent, person)).toBe(true)
    expect(store.removeAgentIdentity('lark')).toBe(true)
    expect(store.memoryAmendmentsOf('lark')).toEqual([])
  })
  it('settles once as the person and keeps the initiating actor, time and planned text', () => {
    const api = recovery()
    const saved = api.beginMemoryAmendment(remove(), clock++)!
    for (const by of [agent, app])
      expect(api.settleMemoryAmendment('lark', saved.id, absent, by)).toBe(false)
    expect(api.settleMemoryAmendment('wren', saved.id, absent, person)).toBe(false)
    expect(api.settleMemoryAmendment('lark', saved.id, absent, person)).toBe(true)
    expect(api.memoryAmendment('lark', saved.id)).toMatchObject({
      by: person,
      at: saved.at,
      textBefore: text,
      textAfter: null,
      outcome: 'done',
      actual: absent,
      settlement: { by: person },
    })
    expect(api.settleMemoryAmendment('lark', saved.id, absent, person)).toBe(false)
  })
  it('observes startup only as the app, without exposing reconciliation on SessionStore', () => {
    const api = recovery()
    const saved = api.beginMemoryAmendment(remove(), clock++)!
    const internal = observer()
    expect(Reflect.get(store, 'reconcileMemoryAmendment')).toBeUndefined()
    for (const by of [person, agent])
      expect(internal.reconcile(agentIdentityRowId('lark'), saved.id, absent, by)).toBe(false)
    expect(internal.reconcile(agentIdentityRowId('lark'), saved.id, absent, app)).toBe(true)
    expect(api.memoryAmendment('lark', saved.id)).toMatchObject({
      by: person,
      at: saved.at,
      outcome: 'done',
      actual: absent,
      settlement: { by: app },
    })
  })
  it.each([
    [{ fingerprint: hash(text) }, 'unchanged'],
    [{ fingerprint: hash('external') }, 'partial'],
    [{ fingerprint: null, unreadable: true }, 'partial'],
  ] as const)('records a truthful observation %j as %s', (actual, outcome) => {
    const api = recovery()
    const saved = api.beginMemoryAmendment(remove(), clock++)!
    expect(observer().reconcile(agentIdentityRowId('lark'), saved.id, actual, app)).toBe(true)
    expect(api.memoryAmendment('lark', saved.id)).toMatchObject({ outcome, actual })
    expect(api.hasPendingMemoryAmendment('lark')).toBe(false)
  })
  it('retains corrections before the write, and can record their source-linked reversal', () => {
    const api = recovery()
    const saved = api.beginMemoryAmendment(
      remove({ act: 'corrected', textAfter: 'After' }),
      clock++,
    )!
    expect(
      api.settleMemoryAmendment('lark', saved.id, { fingerprint: hash('After') }, person),
    ).toBe(true)
    const inverse = api.beginMemoryAmendment(
      remove({
        act: 'corrected',
        textBefore: 'After',
        textAfter: text,
        sourceId: saved.id,
      }),
      clock++,
    )!
    expect(inverse).toMatchObject({ sourceId: saved.id, outcome: 'pending' })
    expect(api.settleMemoryAmendment('lark', inverse.id, { fingerprint: hash(text) }, person)).toBe(
      true,
    )
  })
  it('skips unchanged attempts for the source rule and refuses partial external sources', () => {
    const api = recovery()
    const saved = api.beginMemoryAmendment(remove(), clock++)!
    expect(api.settleMemoryAmendment('lark', saved.id, absent, person)).toBe(true)
    const restore = remove({
      act: 'restored',
      textBefore: null,
      textAfter: text,
      sourceId: saved.id,
    })
    const attempt = api.beginMemoryAmendment(restore, clock++)!
    expect(api.settleMemoryAmendment('lark', attempt.id, absent, person)).toBe(true)
    expect(api.memoryAmendment('lark', attempt.id)?.outcome).toBe('unchanged')
    const retry = api.beginMemoryAmendment(restore, clock++)!
    expect(retry).not.toBeNull()
    expect(
      api.settleMemoryAmendment('lark', retry.id, { fingerprint: hash('external') }, person),
    ).toBe(true)
    expect(api.beginMemoryAmendment(restore, clock++)).toBeNull()
    expect(
      api.beginMemoryAmendment(
        remove({
          act: 'removed',
          textBefore: 'external',
          sourceId: retry.id,
        }),
        clock++,
      ),
    ).toBeNull()
  })
  it('enforces pending uniqueness and observation constraints even through raw SQL', () => {
    const saved = recovery().beginMemoryAmendment(remove(), clock++)!
    expect(() =>
      db
        .prepare(
          `INSERT INTO identity_memory_amendment
      (id, identity_id, seq, provider, entry, act, by, text_before, text_after, created_at, source_id, outcome)
      SELECT 'second-pending', identity_id, seq + 1, provider, entry, act, by,
        text_before, text_after, created_at, source_id, 'pending'
      FROM identity_memory_amendment WHERE id = ?`,
        )
        .run(saved.id),
    ).toThrow(/UNIQUE/)
    const update = db.prepare(`UPDATE identity_memory_amendment
      SET outcome = ?, actual = ?, settled_by = ?, settled_at = ? WHERE id = ?`)
    for (const [outcome, actual, by, at] of [
      ['done', '{}', JSON.stringify(person), 1],
      ['pending', JSON.stringify(absent), JSON.stringify(person), 1],
      ['partial', null, null, null],
      ['unchanged', JSON.stringify({ ...absent, unreadable: true }), JSON.stringify(person), 1],
      ['done', JSON.stringify(absent), JSON.stringify(agent), 1],
      ['done', JSON.stringify(absent), '{broken', 1],
      ['done', JSON.stringify(absent), JSON.stringify(person), -1],
      ['done', JSON.stringify(absent), JSON.stringify(person), 0.5],
    ])
      expect(() => update.run(outcome, actual, by, at, saved.id)).toThrow(/CHECK/)
    expect(() =>
      db
        .prepare('UPDATE identity_memory_amendment SET by = ? WHERE id = ?')
        .run('legacy-observer', saved.id),
    ).toThrow(/CHECK/)
    expect(recovery().memoryAmendment('lark', saved.id)?.outcome).toBe('pending')
  })
  it('upgrades populated legacy links twice without inventing observations or changing original fields', () => {
    const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8'))
    const cut = journal.entries.findIndex(
      (one: { tag: string }) => one.tag === '0018_memory_recovery',
    )
    expect(cut).toBe(18)
    const prefix = join(root, 'before-recovery')
    mkdirSync(join(prefix, 'meta'), { recursive: true })
    const entries = journal.entries.slice(0, cut)
    for (const one of entries)
      copyFileSync(join(migrations, one.tag + '.sql'), join(prefix, one.tag + '.sql'))
    writeFileSync(join(prefix, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }))
    const legacy = openDatabase(join(root, 'upgrading.sqlite'))
    try {
      applyMigrations(legacy, prefix)
      storage
        .createSessionStore(legacy)
        .createAgentIdentity(
          { slug: 'lark', displayName: null, provider: 'codex' },
          { by: 'a-person' },
        )
      const insert = legacy.prepare(`INSERT INTO identity_memory_amendment
        (id, identity_id, seq, provider, entry, act, by, text_before, text_after, created_at, source_id)
        VALUES (?, ?, ?, 'claude', ?, ?, ?, ?, ?, ?, ?)`)
      insert.run(
        'old-delete',
        agentIdentityRowId('lark'),
        1,
        entry,
        'removed',
        'legacy-observer',
        text,
        null,
        10,
        null,
      )
      insert.run(
        'old-restore',
        agentIdentityRowId('lark'),
        2,
        entry,
        'restored',
        JSON.stringify(person),
        null,
        text,
        20,
        'old-delete',
      )
      const before = legacy
        .prepare('SELECT * FROM identity_memory_amendment ORDER BY seq')
        .all() as object[]
      applyMigrations(legacy, migrations)
      applyMigrations(legacy, migrations)
      expect(legacy.prepare('SELECT * FROM identity_memory_amendment ORDER BY seq').all()).toEqual(
        before.map((one) => ({
          ...one,
          outcome: 'done',
          actual: null,
          settled_by: null,
          settled_at: null,
        })),
      )
      const rows = storage.createSessionStore(legacy).memoryAmendmentsOf('lark')
      expect(rows).toHaveLength(2)
      expect(
        rows.every(
          (one) =>
            one.outcome === undefined && one.actual === undefined && one.settlement === undefined,
        ),
      ).toBe(true)
      const indexes = legacy.prepare('PRAGMA index_list(identity_memory_amendment)').all() as {
        name: string
        unique: number
        partial: number
      }[]
      expect(indexes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'identity_memory_amendment_one_pending_uq',
            unique: 1,
            partial: 1,
          }),
          expect.objectContaining({ name: 'identity_memory_amendment_seq_uq', unique: 1 }),
          expect.objectContaining({ name: 'identity_memory_amendment_identity_idx' }),
        ]),
      )
      expect(legacy.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      legacy.close()
    }
  })
  it('refuses invalid observations and bad clocks without settling or fabricating an absence', () => {
    const api = recovery()
    const saved = api.beginMemoryAmendment(remove(), clock++)!
    for (const bad of [{}, { fingerprint: 'x' }, { fingerprint: hash(text), unreadable: true }])
      expect(api.settleMemoryAmendment('lark', saved.id, bad as Observation, person)).toBe(false)
    const create = Reflect.get(storage, 'createMemoryAmendmentObserver') as typeof observer
    const badClock = (
      create as unknown as (db: AppDatabase, now: () => number) => ReturnType<typeof observer>
    )(db, () => NaN)
    expect(badClock.reconcile(agentIdentityRowId('lark'), saved.id, absent, app)).toBe(false)
    expect(api.memoryAmendment('lark', saved.id)?.outcome).toBe('pending')
  })
})
