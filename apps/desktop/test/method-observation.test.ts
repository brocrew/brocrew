import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { agentIdentityRowId } from '../src/main/db/identity'
import { createSessionStore } from '../src/main/db/session-store'
import {
  createMethodChangeStore,
  type MethodChangeRecord,
  type MethodChangeStore,
  type MethodFileState,
} from '../src/main/db/method-changes'
import type { ActedBy } from '../src/shared/who-did-it'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
const person = { who: 'a-person' } as const
const app = { who: 'the-app-itself' } as const
const agent = { who: 'an-agent', agent: 'ses-wren' } as const
const lark = agentIdentityRowId('lark')
const wren = agentIdentityRowId('wren')
const bytes = Buffer.from('Read the change.\r\n')
const fingerprint = createHash('sha256').update(bytes).digest('hex')
const image = { base64: bytes.toString('base64'), fingerprint, mode: 0o600 }
const intent = {
  operation: 'delete' as const,
  sourceId: null,
  target: 'review.md',
  files: [{ name: 'review.md', before: image, after: null }],
}
const absent = [{ name: 'review.md', fingerprint: null }]
type Observer = Extract<ActedBy, { who: 'a-person' | 'the-app-itself' }>
type Observed = MethodChangeRecord & {
  readonly settlement: { readonly by: Observer; readonly at: number } | null
}
type Observations = Omit<MethodChangeStore, 'read'> & {
  read(identity: string, id: string): Observed | null
  reconcile(identity: string, id: string, actual: readonly MethodFileState[], by: ActedBy): boolean
}
const factory = createMethodChangeStore as unknown as (
  db: AppDatabase,
  now: () => number,
) => Observations

let folder: string
let db: AppDatabase
let api: Observations
let clock: number
const now = () => clock++
const begin = () => api.begin(lark, intent, person, 1000)!
function reconcile(identity: string, id: string, actual: readonly MethodFileState[], by: ActedBy) {
  expect(api.reconcile, 'the internal interrupted-change observation door').toBeTypeOf('function')
  return api.reconcile(identity, id, actual, by)
}
function identities() {
  const store = createSessionStore(db, now)
  for (const slug of ['lark', 'wren']) {
    expect(
      store.createAgentIdentity({ slug, displayName: null, provider: 'codex' }, { by: 'a-person' }),
    ).not.toBeNull()
  }
  expect(Reflect.get(store, 'reconcileMethodChange')).toBeUndefined()
}
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'method-observation-'))
  db = openDatabase(join(folder, 'app.sqlite'))
  applyMigrations(db, migrations)
  clock = 5000
  identities()
  api = factory(db, now)
})
afterEach(() => {
  db.close()
  rmSync(folder, { recursive: true, force: true })
})

describe('the app records interrupted method outcomes without impersonating the person', () => {
  it('keeps the initiating person separate from an automatic observer across reopen', () => {
    const started = begin()
    const at = clock
    expect(reconcile(lark, started.id, absent, app)).toBe(true)
    const saved = api.read(lark, started.id)
    expect(saved).toMatchObject({
      by: person,
      createdAt: 1000,
      outcome: 'done',
      actual: absent,
      settlement: { by: app, at },
    })
    db.close()
    db = openDatabase(join(folder, 'app.sqlite'))
    api = factory(db, now)
    expect(api.read(lark, started.id)).toEqual(saved)
  })

  it('allows only the app to reconcile, without granting it begin or ordinary settle', () => {
    const started = begin()
    expect(reconcile(lark, started.id, absent, person)).toBe(false)
    expect(reconcile(lark, started.id, absent, agent)).toBe(false)
    expect(api.begin(wren, intent, app, 1001)).toBeNull()
    expect(api.settle(lark, started.id, 'done', absent, app)).toBe(false)
    expect(api.read(lark, started.id)).toMatchObject({ outcome: 'pending', settlement: null })
    const at = clock
    expect(api.settle(lark, started.id, 'done', absent, person)).toBe(true)
    expect(api.read(lark, started.id)).toMatchObject({
      by: person,
      settlement: { by: person, at },
    })
  })

  it.each([
    { name: 'unchanged original bytes', actual: [{ name: 'review.md', fingerprint }] },
    {
      name: 'unknown external bytes',
      actual: [{ name: 'review.md', fingerprint: 'f'.repeat(64) }],
    },
    {
      name: 'unreadable state',
      actual: [{ name: 'review.md', fingerprint: null, unreadable: true as const }],
    },
  ])('records partial for $name instead of claiming the plan happened', ({ actual }) => {
    const started = begin()
    expect(reconcile(lark, started.id, actual, app)).toBe(true)
    expect(api.read(lark, started.id)).toMatchObject({
      by: person,
      outcome: 'partial',
      actual,
      settlement: { by: app },
    })
  })

  it('scopes observations to a pending identity record and refuses malformed or repeated input', () => {
    const started = begin()
    expect(reconcile(wren, started.id, absent, app)).toBe(false)
    expect(reconcile(lark, 'missing', absent, app)).toBe(false)
    for (const invalid of [[], [...absent, ...absent], [{ name: 'other.md', fingerprint: null }]]) {
      expect(reconcile(lark, started.id, invalid, app)).toBe(false)
      expect(api.read(lark, started.id)?.outcome).toBe('pending')
    }
    expect(reconcile(lark, started.id, absent, app)).toBe(true)
    const settled = api.read(lark, started.id)
    expect(reconcile(lark, started.id, absent, app)).toBe(false)
    expect(api.read(lark, started.id)).toEqual(settled)
  })

  it('continues to refuse external post-state bytes when undo is requested after observation', () => {
    const started = begin()
    const other = Buffer.from('A later edit')
    const otherHash = createHash('sha256').update(other).digest('hex')
    expect(reconcile(lark, started.id, [{ name: 'review.md', fingerprint: otherHash }], app)).toBe(
      true,
    )
    expect(
      api.begin(
        lark,
        {
          operation: 'undo',
          sourceId: started.id,
          target: intent.target,
          files: [
            {
              name: 'review.md',
              before: {
                base64: other.toString('base64'),
                fingerprint: otherHash,
                mode: 0o600,
              },
              after: fingerprint,
            },
          ],
        },
        person,
        1002,
      ),
    ).toBeNull()
  })

  it('does not write invalid observer clocks or erase a pending outcome', () => {
    const started = begin()
    for (const value of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const invalidClock = factory(db, () => value)
      expect(invalidClock.reconcile, 'internal app observation').toBeTypeOf('function')
      expect(invalidClock.reconcile(lark, started.id, absent, app)).toBe(false)
      expect(invalidClock.settle(lark, started.id, 'done', absent, person)).toBe(false)
      expect(api.read(lark, started.id)?.outcome).toBe('pending')
    }
  })

  it('migrates populated pre-observer rows twice with unknown observer metadata', () => {
    db.close()
    rmSync(join(folder, 'app.sqlite'), { force: true })
    const older = join(folder, 'old-migrations')
    mkdirSync(join(older, 'meta'), { recursive: true })
    const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8')) as {
      entries: { idx: number; tag: string }[]
    }
    journal.entries = journal.entries.filter((entry) => entry.idx <= 15)
    writeFileSync(join(older, 'meta/_journal.json'), JSON.stringify(journal))
    for (const entry of journal.entries)
      copyFileSync(join(migrations, entry.tag + '.sql'), join(older, entry.tag + '.sql'))
    db = openDatabase(join(folder, 'app.sqlite'))
    applyMigrations(db, older)
    identities()
    const insert = db.prepare(`INSERT INTO identity_method_change
      (id, identity_id, seq, operation, source_id, target, files, by, outcome, actual, created_at)
      VALUES (?, ?, ?, 'delete', NULL, 'review.md', ?, ?, ?, ?, 1000)`)
    for (const [i, outcome] of ['done', 'partial', 'pending'].entries()) {
      insert.run(
        'legacy-' + outcome,
        lark,
        i + 1,
        JSON.stringify(intent.files),
        JSON.stringify(person),
        outcome,
        outcome === 'pending'
          ? null
          : JSON.stringify(outcome === 'done' ? absent : [{ name: 'review.md', fingerprint }]),
      )
    }
    const undoFiles = [{ name: 'review.md', before: null, after: fingerprint }]
    db.prepare(
      `INSERT INTO identity_method_change
      (id, identity_id, seq, operation, source_id, target, files, by, outcome, actual, created_at)
      VALUES ('legacy-undo', ?, 4, 'undo', 'legacy-done', 'review.md', ?, ?, 'done', ?, 1001)`,
    ).run(
      lark,
      JSON.stringify(undoFiles),
      JSON.stringify(person),
      JSON.stringify([{ name: 'review.md', fingerprint }]),
    )
    applyMigrations(db, migrations)
    applyMigrations(db, migrations)
    const columns = (db.pragma('table_info(identity_method_change)') as { name: string }[]).map(
      (row) => row.name,
    )
    expect(columns).toContain('settled_by')
    expect(columns).toContain('settled_at')
    api = factory(db, now)
    for (const outcome of ['done', 'partial', 'pending']) {
      expect(api.read(lark, 'legacy-' + outcome)).toMatchObject({
        by: person,
        outcome,
        createdAt: 1000,
        files: intent.files,
        settlement: null,
      })
    }
    expect(api.read(lark, 'legacy-undo')).toMatchObject({
      operation: 'undo',
      sourceId: 'legacy-done',
      files: undoFiles,
      by: person,
      settlement: null,
    })
    const indexes = (db.pragma('index_list(identity_method_change)') as { name: string }[]).map(
      (index) => index.name,
    )
    expect(indexes).toContain('identity_method_change_sequence_uq')
    expect(indexes).toContain('identity_method_change_pending_uq')
    expect(db.pragma('foreign_key_check')).toEqual([])
  })

  it('backs observer roles, paired fields and pending-state restrictions with a database check', () => {
    const started = begin()
    expect(api.settle(lark, started.id, 'done', absent, person)).toBe(true)
    expect(api.read(lark, started.id)?.settlement).toMatchObject({ by: person })
    const update = db.prepare(
      'UPDATE identity_method_change SET settled_by = ?, settled_at = ? WHERE id = ?',
    )
    for (const [by, at] of [
      [JSON.stringify(app), null],
      [null, 5000],
      ['{}', 5000],
      [JSON.stringify(agent), 5000],
      [JSON.stringify(app), -1],
      [JSON.stringify(app), 0.5],
      [JSON.stringify(app), Number.MAX_SAFE_INTEGER + 1],
    ]) {
      expect(() => update.run(by, at, started.id)).toThrow(/identity_method_change_settlement_ck/)
    }
    const pending = begin()
    expect(() => update.run(JSON.stringify(app), 5000, pending.id)).toThrow(
      /identity_method_change_settlement_ck/,
    )
  })
})
