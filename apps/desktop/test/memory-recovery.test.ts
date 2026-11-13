import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import * as storage from '../src/main/db/session-store'
import { legacyIdentity } from './fixtures/legacy-migration-data'
import { agentIdentityRowId } from '../src/main/db/identity'
import type { ActedBy } from '../src/shared/who-did-it'

interface Observation {
  text: string | null
  unreadable?: true
  cause?: string
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
const hash = (text: string) => text
const absent = { text: null }
let root: string
let db: AppDatabase
let store: storage.SessionStore
let clock: number
function recovery(): Recovery {
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
  return storage.createMemoryAmendmentObserver(db, () => clock++)
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
  it('requires a known identity, valid text and a valid time', () => {
    const api = recovery()
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
  it.each([agent, app, { who: 'a-caller-this-app-cannot-name' } as const])(
    'keeps initiator and ordinary observer distinct: %j',
    (by) => {
      const api = recovery()
      const saved = api.beginMemoryAmendment(remove(), clock++)!
      expect(api.settleMemoryAmendment('wren', saved.id, absent, person)).toBe(false)
      expect(api.settleMemoryAmendment('lark', saved.id, absent, by)).toBe(true)
      expect(api.memoryAmendment('lark', saved.id)).toMatchObject({
        by: person,
        at: saved.at,
        textBefore: text,
        textAfter: null,
        outcome: 'done',
        actual: absent,
        settlement: { by },
      })
      expect(api.settleMemoryAmendment('lark', saved.id, absent, person)).toBe(false)
    },
  )
  it.each([person, agent, app, { who: 'a-caller-this-app-cannot-name' } as const])(
    'round-trips an ordinary initiating caller: %j',
    (by) => {
      const saved = recovery().beginMemoryAmendment(remove({ by }), clock++)!
      expect(saved.by).toEqual(by)
      expect(recovery().settleMemoryAmendment('lark', saved.id, absent, person)).toBe(true)
      expect(recovery().memoryAmendment('lark', saved.id)).toMatchObject({
        by,
        settlement: { by: person },
      })
    },
  )
  it('observes startup only as the app', () => {
    const api = recovery()
    const saved = api.beginMemoryAmendment(remove(), clock++)!
    const internal = observer()
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
    [{ text: hash(text) }, 'unchanged'],
    [{ text: hash('external') }, 'partial'],
    [{ text: null, unreadable: true }, 'partial'],
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
    expect(api.settleMemoryAmendment('lark', saved.id, { text: hash('After') }, person)).toBe(true)
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
    expect(api.settleMemoryAmendment('lark', inverse.id, { text: hash(text) }, person)).toBe(true)
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
    expect(api.settleMemoryAmendment('lark', retry.id, { text: hash('external') }, person)).toBe(
      true,
    )
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
      ['done', JSON.stringify(absent), JSON.stringify({ who: 'an-agent', agent: '' }), 1],
      ['done', JSON.stringify(absent), '{}', 1],
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
    update.run(
      'done',
      JSON.stringify({ ...absent, fingerprint: null }),
      JSON.stringify(agent),
      1,
      saved.id,
    )
    expect(recovery().memoryAmendment('lark', saved.id)?.settlement?.by).toEqual(agent)
  })
  it.each([18, 21])(
    'roundtrips ordinary data and inert legacy history on the existing post-%i schema',
    (last) => {
      const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8'))
      const prefix = join(root, `through-${last}`)
      mkdirSync(join(prefix, 'meta'), { recursive: true })
      const entries = journal.entries.filter((one: { idx: number }) => one.idx <= last)
      for (const one of entries)
        copyFileSync(join(migrations, one.tag + '.sql'), join(prefix, one.tag + '.sql'))
      writeFileSync(join(prefix, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }))
      const file = join(root, 'compatibility.sqlite')
      let saved = openDatabase(file)
      try {
        applyMigrations(saved, prefix)
        legacyIdentity(saved, 'lark', 'codex')
        const identity = agentIdentityRowId('lark')
        const insert = saved.prepare(`INSERT INTO identity_memory_amendment
        (id, identity_id, seq, provider, entry, act, by, text_before, text_after, created_at, outcome, actual, settled_by, settled_at)
        VALUES (?, ?, ?, 'claude', ?, 'removed', ?, ?, NULL, ?, ?, ?, ?, ?)`)
        for (const [seq, outcome] of ['done', 'partial', 'unchanged', 'pending'].entries()) {
          const pending = outcome === 'pending'
          insert.run(
            `old-${outcome}`,
            identity,
            seq + 1,
            entry,
            JSON.stringify(person),
            text,
            seq + 1,
            outcome,
            pending
              ? null
              : JSON.stringify({ fingerprint: outcome === 'done' ? null : 'a'.repeat(64) }),
            pending ? null : JSON.stringify(app),
            pending ? null : 10,
          )
        }
        const rows = () =>
          saved.prepare('SELECT * FROM identity_memory_amendment ORDER BY seq').all()
        const originalRows = rows()
        const schema = (database = saved) =>
          database
            .prepare(
              "SELECT name, sql FROM sqlite_master WHERE tbl_name='identity_memory_amendment' ORDER BY name",
            )
            .all()
        const columns = () => saved.prepare('PRAGMA table_info(identity_memory_amendment)').all()
        const foreignKeys = () =>
          (
            saved.prepare('PRAGMA foreign_key_list(identity_memory_amendment)').all() as {
              table: string
              from: string
              to: string
              on_update: string
              on_delete: string
              match: string
            }[]
          )
            .map((key) => ({
              table: key.table,
              from: key.from,
              to: key.to,
              on_update: key.on_update,
              on_delete: key.on_delete,
              match: key.match,
            }))
            .sort((a, b) => a.from.localeCompare(b.from))
        const originalColumns = columns()
        const originalForeignKeys = foreignKeys()
        applyMigrations(saved, migrations)
        expect(columns()).toEqual(originalColumns)
        expect(foreignKeys()).toEqual(originalForeignKeys)
        const upgradedSchema = schema()
        expect(upgradedSchema).toEqual(schema(db))
        let api = storage.createSessionStore(saved, () => clock++)
        for (const outcome of ['done', 'partial', 'unchanged']) {
          expect(api.memoryAmendment('lark', `old-${outcome}`)).toMatchObject({
            outcome,
            actual: {},
          })
        }
        expect(api.memoryAmendment('lark', 'old-pending')?.outcome).toBe('pending')
        expect(
          api.settleMemoryAmendment(
            'lark',
            'old-pending',
            { fingerprint: null } as unknown as Observation,
            person,
          ),
        ).toBe(false)
        expect(rows()).toEqual(originalRows)
        const writtenJournal = saved.prepare('SELECT * FROM __drizzle_migrations ORDER BY id').all()
        saved.close()
        saved = openDatabase(file)
        applyMigrations(saved, migrations)
        api = storage.createSessionStore(saved, () => clock++)
        expect(rows()).toEqual(originalRows)
        expect(schema()).toEqual(upgradedSchema)
        expect(saved.prepare('SELECT * FROM __drizzle_migrations ORDER BY id').all()).toEqual(
          writtenJournal,
        )
        expect(saved.prepare('PRAGMA foreign_key_check').all()).toEqual([])
        expect(api.settleMemoryAmendment('lark', 'old-pending', { text: 'External' }, person)).toBe(
          true,
        )
        expect(api.memoryAmendment('lark', 'old-pending')?.outcome).toBe('partial')
        const observations: readonly Observation[] = [
          { text: 'After' },
          { text },
          { text: 'External' },
          { text: null },
          { text: null, unreadable: true, cause: 'ENOENT: /fictional/note.md' },
        ]
        const expected = ['done', 'unchanged', 'partial', 'done', 'partial']
        for (const [index, actual] of observations.entries()) {
          const removed = actual.text === null && !actual.unreadable
          const row = api.beginMemoryAmendment(
            remove(removed ? {} : { act: 'corrected', textAfter: 'After' }),
            clock++,
          )!
          expect(api.settleMemoryAmendment('lark', row.id, actual, person)).toBe(true)
          expect(api.memoryAmendment('lark', row.id)).toMatchObject({
            outcome: expected[index],
            actual,
          })
          expect(api.memoryAmendment('lark', row.id)?.actual).not.toHaveProperty('fingerprint')
          const stored = saved
            .prepare('SELECT actual FROM identity_memory_amendment WHERE id=?')
            .get(row.id) as { actual: string }
          expect(JSON.parse(stored.actual)).toEqual({ ...actual, fingerprint: null })
        }
        const pending = api.beginMemoryAmendment(remove(), clock++)!
        saved.exec(`CREATE TRIGGER fail_observation BEFORE UPDATE ON identity_memory_amendment
        BEGIN SELECT RAISE(ABORT, 'fictional settlement failure'); END`)
        expect(() => api.settleMemoryAmendment('lark', pending.id, { text: null }, person)).toThrow(
          'fictional settlement failure',
        )
        expect(api.memoryAmendment('lark', pending.id)).toMatchObject({ outcome: 'pending' })
        expect(api.memoryAmendment('lark', pending.id)?.actual).toBeUndefined()
        saved.exec('DROP TRIGGER fail_observation')
        expect(api.settleMemoryAmendment('lark', pending.id, { text: null }, person)).toBe(true)
        const settledRows = rows()
        saved.close()
        saved = openDatabase(file)
        expect(rows()).toEqual(settledRows)
        expect(schema()).toEqual(upgradedSchema)
        expect(saved.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      } finally {
        saved.close()
      }
    },
  )

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
      legacyIdentity(legacy, 'lark', 'codex')
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
    for (const bad of [{}, { text: 1 }, { text: hash(text), unreadable: true }])
      expect(api.settleMemoryAmendment('lark', saved.id, bad as Observation, person)).toBe(false)
    const badClock = storage.createMemoryAmendmentObserver(db, () => NaN)
    expect(badClock.reconcile(agentIdentityRowId('lark'), saved.id, absent, app)).toBe(false)
    expect(api.memoryAmendment('lark', saved.id)?.outcome).toBe('pending')
  })
})

describe('released 0030 knowledge data survives the actor migration', () => {
  it.each([
    { foreignKeys: true, fail: false },
    { foreignKeys: false, fail: false },
    { foreignKeys: true, fail: true },
    { foreignKeys: false, fail: true },
  ])(
    'preserves raw data with foreign keys $foreignKeys and rollback $fail',
    ({ foreignKeys, fail }) => {
      const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8'))
      // This prefix is byte-identical to released v0.2.22 b22ffee through 0030.
      const entries = journal.entries.filter((one: { idx: number }) => one.idx <= 30)
      expect(entries).toHaveLength(31)
      const next = journal.entries[31]
      expect(next.idx).toBe(31)
      expect(next.when).toBeGreaterThan(entries[30].when)
      const prefix = join(root, 'released-0030')
      const failing = join(root, 'failing-upgrade')
      const target = join(root, 'through-0031')
      const targetJournal = { ...journal, entries: [...entries, next] }
      for (const folder of [prefix, failing, target]) {
        mkdirSync(join(folder, 'meta'), { recursive: true })
        for (const one of entries)
          copyFileSync(join(migrations, one.tag + '.sql'), join(folder, one.tag + '.sql'))
        writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }))
      }
      writeFileSync(
        join(failing, next.tag + '.sql'),
        readFileSync(join(migrations, next.tag + '.sql'), 'utf8') +
          '\n--> statement-breakpoint\nINSERT INTO fictional_missing_upgrade_table VALUES (1);',
      )
      writeFileSync(join(failing, 'meta/_journal.json'), JSON.stringify(targetJournal))
      copyFileSync(join(migrations, next.tag + '.sql'), join(target, next.tag + '.sql'))
      writeFileSync(join(target, 'meta/_journal.json'), JSON.stringify(targetJournal))
      const file = join(root, 'released.sqlite')
      let saved = openDatabase(file)
      try {
        applyMigrations(saved, prefix)
        for (const slug of ['lark', 'wren']) legacyIdentity(saved, slug, 'codex')
        saved
          .prepare('INSERT INTO identity_instruction_seen (identity_id,seen_through) VALUES (?,3)')
          .run(agentIdentityRowId('lark'))
        const insert = (table: string, values: Record<string, string | number | null>) => {
          const columns = Object.keys(values)
          saved
            .prepare(
              `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
            )
            .run(...Object.values(values))
        }
        for (const slug of ['lark', 'wren']) {
          const identity = agentIdentityRowId(slug)
          for (const [index, outcome] of [
            'done',
            'done',
            'partial',
            'unchanged',
            'pending',
          ].entries()) {
            insert('identity_memory_amendment', {
              id: `${slug}-memory-${index}`,
              identity_id: identity,
              seq: index + 1,
              provider: index % 2 ? 'codex' : 'claude',
              entry: `${entry}-${index}`,
              act: 'removed',
              by: index === 0 ? 'legacy-observer' : '{ "who": "a-person", "old": true }',
              text_before: text,
              text_after: null,
              created_at: 10 + index,
              source_id: null,
              outcome,
              actual: index === 0 || outcome === 'pending' ? null : '{ "fingerprint": null }',
              settled_by:
                index === 0 || outcome === 'pending'
                  ? null
                  : JSON.stringify(index % 2 ? app : person),
              settled_at: index === 0 || outcome === 'pending' ? null : 100 + index,
            })
          }
          insert('identity_memory_amendment', {
            id: `${slug}-restore`,
            identity_id: identity,
            seq: 6,
            provider: 'claude',
            entry: `${entry}-0`,
            act: 'restored',
            by: JSON.stringify(person),
            text_before: null,
            text_after: text,
            created_at: 20,
            source_id: `${slug}-memory-0`,
            outcome: 'done',
            actual: null,
            settled_by: null,
            settled_at: null,
          })
          insert('identity_memory_amendment', {
            id: `${slug}-correct`,
            identity_id: identity,
            seq: 7,
            provider: 'codex',
            entry: `${entry}-correct`,
            act: 'corrected',
            by: JSON.stringify(person),
            text_before: text,
            text_after: 'After\r\n',
            created_at: 21,
            source_id: null,
            outcome: 'done',
            actual: '{"fingerprint":null}',
            settled_by: JSON.stringify(app),
            settled_at: 22,
          })
          for (const [index, outcome] of ['done', 'done', 'partial', 'pending'].entries()) {
            insert('identity_method_change', {
              id: `${slug}-method-${index}`,
              identity_id: identity,
              seq: index + 1,
              operation: index === 1 ? 'undo' : 'delete',
              source_id: index === 1 ? `${slug}-method-0` : null,
              target: 'review.md',
              files: JSON.stringify([
                {
                  name: 'review.md',
                  before: {
                    base64: Buffer.from(text).toString('base64'),
                    mode: 0o640,
                  },
                  afterBase64: null,
                },
              ]),
              by: index === 0 ? 'legacy-method-author' : JSON.stringify(person),
              outcome,
              actual:
                outcome === 'pending' ? null : '[{"name":"review.md","base64":null,"mode":416}]',
              created_at: 30 + index,
              settled_by: index === 0 || outcome === 'pending' ? null : JSON.stringify(app),
              settled_at: index === 0 || outcome === 'pending' ? null : 40 + index,
            })
          }
        }
        for (const slug of ['lark', 'wren']) {
          const identity = agentIdentityRowId(slug)
          const legacyAuthors = [
            null,
            '{ "profile": "wren", "name": "Old name", "legacy": true }',
            '[]',
            'null',
            '42',
          ]
          for (const [index, author] of legacyAuthors.entries()) {
            insert('identity_own_notes', {
              id: `${slug}-notes-${index + 1}`,
              identity_id: identity,
              version: index + 1,
              text: `Original ${index}.\r\nCafé.`,
              reason: `Saved reason ${index}.\r\n`,
              actor:
                index === 0
                  ? '{ "who": "a-person" }'
                  : index === 1
                    ? '{ "who": "an-agent", "agent": "legacy-session", "extra": true }'
                    : '{"who":"an-agent"}',
              author,
              restored_from_version: index === 4 ? 2 : null,
              created_at: 50 + index,
            })
          }
          insert('identity_own_notes_seen', { identity_id: identity, seen_through: 2 })
        }
        const tables = [
          'identity_memory_amendment',
          'identity_method_change',
          'identity_own_notes',
          'identity_own_notes_seen',
          'agent_identity',
          'identity_instruction_seen',
        ]
        const rows = () =>
          tables.map((table) =>
            saved
              .prepare(
                `SELECT * FROM ${table} ORDER BY ${['identity_instruction_seen', 'identity_own_notes_seen'].includes(table) ? 'identity_id' : 'id'}`,
              )
              .all(),
          )
        const schema = () =>
          saved
            .prepare(
              "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name",
            )
            .all()
        const journalRows = () =>
          saved.prepare('SELECT * FROM __drizzle_migrations ORDER BY id').all()
        const contracts = () =>
          tables.map((table) => ({
            columns: saved.prepare(`PRAGMA table_info(${table})`).all(),
            keys: (
              saved.prepare(`PRAGMA foreign_key_list(${table})`).all() as { from: string }[]
            ).sort((a, b) => a.from.localeCompare(b.from)),
            indexes: (
              saved
                .prepare(
                  "SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name=? ORDER BY name",
                )
                .all(table) as { name: string; sql: string | null }[]
            ).map((one) => ({ ...one, sql: one.sql?.replace(/\s+/g, '') ?? null })),
          }))
        const beforeRows = rows()
        const beforeSchema = schema()
        const beforeJournal = journalRows()
        const beforeContracts = contracts()
        saved.pragma(foreignKeys ? 'foreign_keys = ON' : 'foreign_keys = OFF')
        if (fail) {
          expect(() => applyMigrations(saved, failing)).toThrow(/fictional_missing_upgrade_table/)
          expect(schema()).toEqual(beforeSchema)
          expect(journalRows()).toEqual(beforeJournal)
        } else {
          applyMigrations(saved, target)
          expect(contracts()).toEqual(beforeContracts)
          expect(journalRows().slice(0, -1)).toEqual(beforeJournal)
          expect(journalRows()).toHaveLength(beforeJournal.length + 1)
          const upgradedSchema = schema()
          const upgradedJournal = journalRows()
          applyMigrations(saved, target)
          expect(journalRows()).toEqual(upgradedJournal)
          expect(schema()).toEqual(upgradedSchema)
        }
        expect(saved.pragma('foreign_keys', { simple: true })).toBe(foreignKeys ? 1 : 0)
        expect(rows()).toEqual(beforeRows)
        expect(saved.pragma('foreign_key_check')).toEqual([])
        const finalSchema = schema()
        const finalJournal = journalRows()
        saved.close()
        saved = openDatabase(file)
        saved.pragma(foreignKeys ? 'foreign_keys = ON' : 'foreign_keys = OFF')
        if (!fail) applyMigrations(saved, target)
        expect(rows()).toEqual(beforeRows)
        expect(schema()).toEqual(finalSchema)
        expect(journalRows()).toEqual(finalJournal)
        expect(saved.pragma('foreign_keys', { simple: true })).toBe(foreignKeys ? 1 : 0)
        expect(saved.pragma('foreign_key_check')).toEqual([])
        if (!fail) {
          saved.pragma('foreign_keys = ON')
          expect(() =>
            saved.prepare("DELETE FROM identity_memory_amendment WHERE id='lark-memory-0'").run(),
          ).toThrow(/FOREIGN KEY/)
          expect(() =>
            saved
              .prepare("UPDATE identity_memory_amendment SET seq=1 WHERE id='lark-correct'")
              .run(),
          ).toThrow(/UNIQUE/)
          expect(() =>
            saved.prepare("UPDATE identity_method_change SET seq=1 WHERE id='lark-method-2'").run(),
          ).toThrow(/UNIQUE/)
          expect(() =>
            saved
              .prepare(
                "UPDATE identity_method_change SET outcome='pending',actual=NULL,settled_by=NULL,settled_at=NULL WHERE id='lark-method-2'",
              )
              .run(),
          ).toThrow(/UNIQUE/)
          expect(() =>
            saved
              .prepare(
                "UPDATE identity_memory_amendment SET outcome='pending',actual=NULL,settled_by=NULL,settled_at=NULL WHERE id='lark-correct'",
              )
              .run(),
          ).toThrow(/UNIQUE/)
          expect(() =>
            saved.prepare("DELETE FROM identity_method_change WHERE id='lark-method-0'").run(),
          ).toThrow(/FOREIGN KEY/)
          expect(() =>
            saved.prepare("UPDATE identity_own_notes SET version=1 WHERE id='lark-notes-2'").run(),
          ).toThrow(/UNIQUE/)
          expect(() =>
            saved
              .prepare(
                "UPDATE identity_own_notes SET restored_from_version=5 WHERE id='lark-notes-5'",
              )
              .run(),
          ).toThrow(/CHECK/)
          expect(() =>
            saved
              .prepare("UPDATE identity_own_notes SET reason='  ' WHERE id='lark-notes-1'")
              .run(),
          ).toThrow(/CHECK/)
          expect(() =>
            saved
              .prepare("UPDATE identity_own_notes SET text=? WHERE id='lark-notes-1'")
              .run('Invalid\0text'),
          ).toThrow(/CHECK/)
          saved.prepare('DELETE FROM agent_identity WHERE id=?').run(agentIdentityRowId('wren'))
          for (const table of tables.slice(0, 4))
            expect(
              saved
                .prepare(`SELECT * FROM ${table} WHERE identity_id=?`)
                .all(agentIdentityRowId('wren')),
            ).toEqual([])
          expect(saved.pragma('foreign_key_check')).toEqual([])
        }
      } finally {
        saved.close()
      }
    },
  )
})
