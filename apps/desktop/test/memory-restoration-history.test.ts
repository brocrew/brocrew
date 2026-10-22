import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { agentIdentityRowId } from '../src/main/db/identity'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { MEMORY_AMENDMENT } from '../src/shared/agent-memory'
import { runtimeCommandSchema } from '../src/main/runtime/ipc'
import type { ActedBy } from '../src/shared/who-did-it'

interface Written {
  profileSlug: string
  provider: 'claude' | 'codex'
  entry: string
  act: 'removed' | 'corrected' | 'restored'
  by: ActedBy
  textBefore: string | null
  textAfter: string | null
  sourceId?: string
}
interface Change extends Omit<Written, 'profileSlug'> {
  id: string
  seq: number
  at: number
}
const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
const person = { who: 'a-person' } as const
const entry = '/fictional/lark/memory/note.md'
const saved = 'A saved note.\r\nCafé.\n'
let root: string
let db: AppDatabase
let store: SessionStore
let clock: number
const write = (said: Written): Change | null => {
  let result: Change | null = null
  expect(() => {
    result = (
      store.writeMemoryAmendment as unknown as (said: Written, at: number) => Change | null
    )(said, clock++)
  }, 'unsupported or stale restoration returns a refusal, not a SQL exception').not.toThrow()
  return result
}
function removed(profileSlug = 'lark', path = entry): Change {
  return write({
    profileSlug,
    provider: 'claude',
    entry: path,
    act: 'removed',
    by: person,
    textBefore: saved,
    textAfter: null,
  })!
}
const restoration = (source: Change): Written => ({
  profileSlug: 'lark',
  provider: 'claude',
  entry: source.entry,
  act: 'restored',
  by: person,
  textBefore: null,
  textAfter: source.textBefore,
  sourceId: source.id,
})
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'memory-history-'))
  db = openDatabase(join(root, 'app.sqlite'))
  applyMigrations(db, migrations)
  store = createSessionStore(db)
  clock = 1000
  for (const slug of ['lark', 'wren'])
    store.createAgentIdentity({ slug, displayName: null, provider: 'codex' }, { by: 'a-person' })
})
afterEach(() => {
  db.close()
  rmSync(root, { recursive: true, force: true })
})

describe('memory restoration keeps absence, source and author in the existing history', () => {
  it('records restored text with an absent before state and survives a store reopen', () => {
    const source = removed()
    const result = write(restoration(source))!
    expect(result).toMatchObject({
      act: 'restored',
      textBefore: null,
      textAfter: saved,
      sourceId: source.id,
      by: person,
      seq: 2,
    })
    store = createSessionStore(db)
    const rows = store.memoryAmendmentsOf('lark') as unknown as Change[]
    expect(rows).toEqual([result, source])
    expect(rows[1]).toMatchObject({ textBefore: saved, textAfter: null, act: 'removed' })
  })
  it('refuses forged source, provider, entry, text and actor without appending a row', () => {
    const source = removed()
    const foreign = removed('wren', '/fictional/wren/memory/note.md')
    for (const overrides of [
      { sourceId: 'missing' },
      { sourceId: foreign.id },
      { provider: 'codex' as const },
      { entry: '/fictional/lark/memory/another.md' },
      { textAfter: 'invented' },
      { textBefore: '' },
      { sourceId: undefined },
      { by: { who: 'an-agent', agent: 'ses-wren' } as const },
      { by: { who: 'the-app-itself' } as const },
    ])
      expect(write({ ...restoration(source), ...overrides })).toBeNull()
    expect(store.memoryAmendmentsOf('lark')).toHaveLength(1)
    expect(write(restoration(source))).not.toBeNull()
  })
  it('refuses a corrected source, a superseded deletion and a duplicate restoration', () => {
    const source = removed()
    const corrected = write({
      profileSlug: 'lark',
      provider: 'claude',
      entry,
      act: 'corrected',
      by: person,
      textBefore: '',
      textAfter: 'newer',
    })!
    expect(write(restoration(corrected))).toBeNull()
    expect(write(restoration(source))).toBeNull()
    const next = removed()
    expect(write(restoration(next))).not.toBeNull()
    expect(write(restoration(next))).toBeNull()
    expect(store.memoryAmendmentsOf('lark')).toHaveLength(4)
  })
  it('records the inverse of a restoration only against its exact current text', () => {
    const source = removed()
    const restored = write(restoration(source))!
    const inverse: Written = {
      profileSlug: 'lark',
      provider: 'claude',
      entry,
      act: 'removed',
      by: person,
      textBefore: saved,
      textAfter: null,
      sourceId: restored.id,
    }
    expect(write({ ...inverse, sourceId: source.id })).toBeNull()
    expect(write({ ...inverse, textBefore: 'external' })).toBeNull()
    expect(write({ ...inverse, by: { who: 'an-agent', agent: 'ses-wren' } })).toBeNull()
    const undone = write(inverse)!
    expect(undone).toMatchObject({
      act: 'removed',
      sourceId: restored.id,
      by: person,
      textBefore: saved,
      textAfter: null,
    })
    expect(write(inverse)).toBeNull()
    expect(write(restoration(undone))).toMatchObject({ act: 'restored', sourceId: undone.id })
  })
  it('keeps restored off the ordinary edit wire and names it in the history vocabulary', () => {
    expect([...MEMORY_AMENDMENT]).toContain('restored')
    expect(
      runtimeCommandSchema.safeParse({
        kind: 'amendAgentMemory',
        profileId: 'lark',
        provider: 'claude',
        entry,
        act: 'restored',
        text: 'forged',
      }).success,
    ).toBe(false)
  })
  it('enforces the new absence and source constraints and preserves the old pairings', () => {
    const source = removed()
    const columns = db.prepare('PRAGMA table_info(identity_memory_amendment)').all() as {
      name: string
      notnull: number
    }[]
    expect(columns.find((one) => one.name === 'text_before')?.notnull).toBe(0)
    expect(columns.map((one) => one.name)).toContain('source_id')
    const insert = db.prepare(`INSERT INTO identity_memory_amendment
      (id,identity_id,seq,provider,entry,act,by,text_before,text_after,created_at,source_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    const raw = (
      act: string,
      before: string | null,
      after: string | null,
      sourceId: string | null,
      by = JSON.stringify(person),
    ) =>
      insert.run(
        'raw-change',
        agentIdentityRowId('lark'),
        9,
        'claude',
        entry,
        act,
        by,
        before,
        after,
        9,
        sourceId,
      )
    expect(() => raw('restored', null, saved, null)).toThrow(/CHECK/)
    expect(() => raw('restored', '', saved, source.id)).toThrow(/CHECK/)
    expect(() => raw('removed', null, null, null)).toThrow(/CHECK/)
    expect(() => raw('corrected', null, saved, null)).toThrow(/CHECK/)
    expect(() => raw('corrected', '', saved, source.id)).toThrow(/CHECK/)
    for (const by of ['legacy-observer', '"a-person"', '{"who":null}', '{"who":"an-agent"}'])
      expect(() => raw('restored', null, saved, source.id, by)).toThrow(/CHECK/)
    expect(() => raw('restored', null, saved, 'missing')).toThrow(/FOREIGN KEY/)
    expect(write(restoration(source))).not.toBeNull()
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(store.removeAgentIdentity('lark')).toBe(true)
    expect(store.memoryAmendmentsOf('lark')).toEqual([])
  })
  it('preserves legacy memory rows through the forward migration and its second application', () => {
    const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8')) as {
      entries: { idx: number; tag: string }[]
    }
    const boundary = journal.entries.findIndex((one) => one.tag === '0017_memory_restoration')
    expect(boundary).toBe(17)
    const prior = join(root, 'prior')
    mkdirSync(join(prior, 'meta'), { recursive: true })
    const entries = journal.entries.slice(0, boundary)
    writeFileSync(join(prior, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }))
    for (const one of entries)
      copyFileSync(join(migrations, one.tag + '.sql'), join(prior, one.tag + '.sql'))
    const old = openDatabase(join(root, 'legacy.sqlite'))
    try {
      applyMigrations(old, prior)
      const legacy = createSessionStore(old)
      legacy.createAgentIdentity(
        { slug: 'lark', displayName: null, provider: 'codex' },
        { by: 'a-person' },
      )
      old
        .prepare(
          `INSERT INTO identity_memory_amendment
        (id,identity_id,seq,provider,entry,act,by,text_before,text_after,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          'legacy-delete',
          agentIdentityRowId('lark'),
          1,
          'claude',
          entry,
          'removed',
          JSON.stringify(person),
          saved,
          null,
          1,
        )
      old
        .prepare(
          `INSERT INTO identity_memory_amendment
        (id,identity_id,seq,provider,entry,act,by,text_before,text_after,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          'legacy-correction',
          agentIdentityRowId('lark'),
          2,
          'codex',
          entry,
          'corrected',
          'legacy-observer',
          'before',
          'after',
          2,
        )
      const before = old.prepare('SELECT * FROM identity_memory_amendment').all()
      applyMigrations(old, migrations)
      applyMigrations(old, migrations)
      const after = old.prepare('SELECT * FROM identity_memory_amendment').all() as Record<
        string,
        unknown
      >[]
      expect(
        after.map(({ source_id, ...row }) => {
          expect(source_id).toBeNull()
          return row
        }),
      ).toEqual(before)
      const indexes = old.prepare('PRAGMA index_list(identity_memory_amendment)').all() as {
        name: string
      }[]
      expect(indexes.map((one) => one.name)).toContain('identity_memory_amendment_identity_idx')
      expect(indexes.map((one) => one.name)).toContain('identity_memory_amendment_seq_uq')
      expect(old.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      old.close()
    }
  })
  it('keeps ordinary legacy amendment results and attribution unchanged', () => {
    const source = removed()
    expect(source).toEqual({
      id: 'mem:lark:1',
      seq: 1,
      provider: 'claude',
      entry,
      act: 'removed',
      by: person,
      textBefore: saved,
      textAfter: null,
      at: 1000,
    })
  })
})
