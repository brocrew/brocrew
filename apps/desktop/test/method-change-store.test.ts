import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import type { ActedBy } from '../src/shared/who-did-it'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
const person = { who: 'a-person' } as const
const agent = { who: 'an-agent', agent: 'ses-wren' } as const
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const image = (bytes: Buffer) => ({
  base64: bytes.toString('base64'),
  fingerprint: hash(bytes),
  mode: 0o600,
})

// Local expected contracts keep the tests-only commit typecheckable on the earlier store.
type Image = ReturnType<typeof image>
type FileChange = { name: string; before: Image | null; after: string | null }
type State = { name: string; fingerprint: string | null; unreadable?: true }
type Intent = {
  operation: 'delete' | 'undo'
  sourceId: string | null
  target: string
  files: readonly FileChange[]
}
type Record = Intent & {
  id: string
  sequence: number
  by: ActedBy
  outcome: 'pending' | 'done' | 'partial'
  actual: readonly State[] | null
  createdAt: number
}
type Recovery = {
  beginMethodChange(profile: string, said: Intent, by: ActedBy, at: number): Record | null
  settleMethodChange(
    profile: string,
    id: string,
    outcome: 'done' | 'partial',
    actual: readonly State[],
    by: ActedBy,
  ): boolean
  methodChange(profile: string, id: string): Record | null
  methodChanges(profile: string, offset?: number, limit?: number): readonly Record[]
}

describe('saved-method recovery intents retain exact bytes and attributable outcomes', () => {
  let folder: string
  let db: AppDatabase
  let store: SessionStore
  let clock: number
  const recovery = () => store as unknown as Recovery
  const before = image(Buffer.from([0x23, 0x20, 0x41, 0x0d, 0x0a, 0xff]))
  const deletion = (
    files: readonly FileChange[] = [{ name: 'review.md', before, after: null }],
  ): Intent => ({
    operation: 'delete',
    sourceId: null,
    target: 'review.md',
    files,
  })
  const begin = (said = deletion(), by: ActedBy = person, profile = 'lark') =>
    recovery().beginMethodChange(profile, said, by, clock++)

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'method-changes-'))
    db = openDatabase(join(folder, 'app.sqlite'))
    applyMigrations(db, migrations)
    clock = 1000
    store = createSessionStore(db, () => clock++)
    for (const profile of ['lark', 'wren'])
      store.create({
        id: `ses-${profile}`,
        profileId: profile,
        provider: 'codex',
        cwd: folder,
        approvalMode: 'ask',
      })
  })

  afterEach(() => {
    db.close()
    rmSync(folder, { recursive: true, force: true })
  })

  it('durably records exact binary and CRLF bytes before an operation can be claimed done', () => {
    const started = begin()
    expect(started).toMatchObject({
      sequence: 1,
      by: person,
      outcome: 'pending',
      actual: null,
      files: [{ name: 'review.md', before }],
    })
    if (started === null) throw new Error('no recovery intent')
    db.close()
    db = openDatabase(join(folder, 'app.sqlite'))
    store = createSessionStore(db, () => clock++)
    expect(recovery().methodChange('lark', started.id)).toEqual(started)
    expect(
      Buffer.from(recovery().methodChange('lark', started.id)!.files[0]!.before!.base64, 'base64'),
    ).toEqual(Buffer.from([0x23, 0x20, 0x41, 0x0d, 0x0a, 0xff]))
    expect(store.ownInstructionsOf('lark').versions).toEqual([])
  })

  it('records no change for a missing identity or a non-person actor', () => {
    expect(begin(deletion(), person, 'absent')).toBeNull()
    expect(begin(deletion(), agent)).toBeNull()
    expect(begin(deletion(), { who: 'the-app-itself' })).toBeNull()
    expect(recovery().methodChanges('lark')).toEqual([])
  })

  it('refuses unsafe names, corrupt or oversized before-images, and no-op deletion intents', () => {
    for (const name of ['../review.md', '..\\review.md', 'bad\0.md', 'notes/review.md']) {
      expect(begin(deletion([{ name, before, after: null }]))).toBeNull()
    }
    for (const bad of [
      { ...before, fingerprint: '0'.repeat(64) },
      { ...before, base64: `${before.base64}\n` },
      { ...before, mode: 0o7777 },
      image(Buffer.alloc(16 * 1024 + 1)),
    ])
      expect(begin(deletion([{ name: 'review.md', before: bad, after: null }]))).toBeNull()
    expect(begin(deletion([{ name: 'review.md', before, after: before.fingerprint }]))).toBeNull()
    expect(
      begin(
        deletion([
          { name: 'review.md', before, after: null },
          { name: 'review.md', before, after: null },
        ]),
      ),
    ).toBeNull()
    expect(recovery().methodChanges('lark')).toEqual([])
  })

  it('bounds the combined recovery bytes even for differently cased index names', () => {
    const index = image(Buffer.alloc(64 * 1024))
    expect(
      begin(
        deletion([
          { name: 'index.md', before: index, after: null },
          { name: 'Index.md', before: image(Buffer.alloc(16 * 1024 + 1)), after: null },
        ]),
      ),
    ).toBeNull()
    expect(
      begin(
        deletion([
          { name: 'index.md', before: index, after: null },
          { name: 'review.md', before: image(Buffer.alloc(16 * 1024)), after: null },
        ]),
      ),
    ).not.toBeNull()
  })

  it('allows at most one unfinished change per identity and requires reconciliation before Undo', () => {
    const started = begin()!
    expect(begin()).toBeNull()
    expect(() =>
      db
        .prepare(
          `INSERT INTO identity_method_change
      (id, identity_id, seq, operation, source_id, target, files, by, outcome, actual, created_at)
      SELECT 'parallel-intent', identity_id, seq + 1, operation, source_id, target, files, by,
        outcome, actual, created_at FROM identity_method_change WHERE id = ?`,
        )
        .run(started.id),
    ).toThrow(/UNIQUE/)
    expect(
      begin({
        operation: 'undo',
        sourceId: started.id,
        target: 'review.md',
        files: [{ name: 'review.md', before: null, after: before.fingerprint }],
      }),
    ).toBeNull()
    expect(begin(deletion(), person, 'wren')).not.toBeNull()
    recovery().settleMethodChange(
      'lark',
      started.id,
      'done',
      [{ name: 'review.md', fingerprint: null }],
      person,
    )
    expect(begin()).not.toBeNull()
  })

  it('settles once, only for the identity and person, without changing the intent bytes', () => {
    const started = begin()!
    const actual = [{ name: 'review.md', fingerprint: null }]
    expect(recovery().settleMethodChange('lark', started.id, 'done', actual, agent)).toBe(false)
    expect(recovery().settleMethodChange('wren', started.id, 'done', actual, person)).toBe(false)
    expect(
      recovery().settleMethodChange(
        'lark',
        started.id,
        'done',
        [{ name: 'review.md', fingerprint: before.fingerprint }],
        person,
      ),
    ).toBe(false)
    const settledAt = clock
    expect(recovery().settleMethodChange('lark', started.id, 'done', actual, person)).toBe(true)
    expect(recovery().settleMethodChange('lark', started.id, 'partial', actual, person)).toBe(false)
    expect(recovery().methodChange('lark', started.id)).toEqual({
      ...started,
      actual,
      outcome: 'done',
      settlement: { by: person, at: settledAt },
    })
    expect(recovery().methodChange('wren', started.id)).toBeNull()
  })

  it('binds Undo to stored before-images and post-state, and records reversal of Undo', () => {
    const started = begin()!
    recovery().settleMethodChange(
      'lark',
      started.id,
      'done',
      [{ name: 'review.md', fingerprint: null }],
      person,
    )
    const undo: Intent = {
      operation: 'undo',
      sourceId: started.id,
      target: 'review.md',
      files: [{ name: 'review.md', before: null, after: before.fingerprint }],
    }
    expect(begin(undo, person, 'wren')).toBeNull()
    expect(
      begin({ ...undo, files: [{ name: 'review.md', before, after: before.fingerprint }] }),
    ).toBeNull()
    expect(
      begin({ ...undo, files: [{ name: 'review.md', before: null, after: '0'.repeat(64) }] }),
    ).toBeNull()
    const restored = begin(undo)!
    expect(restored).toMatchObject({
      sequence: 2,
      operation: 'undo',
      sourceId: started.id,
      by: person,
    })
    expect(
      recovery().settleMethodChange(
        'lark',
        restored.id,
        'done',
        [{ name: 'review.md', fingerprint: before.fingerprint }],
        person,
      ),
    ).toBe(true)
    const reversed = begin({
      operation: 'undo',
      sourceId: restored.id,
      target: 'review.md',
      files: [{ name: 'review.md', before, after: null }],
    })
    expect(reversed).toMatchObject({
      sequence: 3,
      sourceId: restored.id,
      files: [{ before, after: null }],
    })
  })

  it('recovers reconciled partial states and refuses pending or external bytes', () => {
    const oldIndex = image(
      Buffer.from('- Review | During review | verified 2026-10-22 | review.md\r\n'),
    )
    const newIndex = image(Buffer.from(''))
    const files = [
      { name: 'index.md', before: oldIndex, after: newIndex.fingerprint },
      { name: 'review.md', before, after: null },
    ]
    const started = begin(deletion(files))!
    const undoFiles = [
      { name: 'index.md', before: newIndex, after: oldIndex.fingerprint },
      { name: 'review.md', before, after: before.fingerprint },
    ]
    expect(
      begin({ operation: 'undo', sourceId: started.id, target: 'review.md', files: undoFiles }),
    ).toBeNull()
    expect(
      recovery().settleMethodChange(
        'lark',
        started.id,
        'partial',
        [
          { name: 'index.md', fingerprint: newIndex.fingerprint },
          { name: 'review.md', fingerprint: before.fingerprint },
        ],
        person,
      ),
    ).toBe(true)
    const restored = begin({
      operation: 'undo',
      sourceId: started.id,
      target: 'review.md',
      files: undoFiles,
    })!
    expect(restored).not.toBeNull()
    recovery().settleMethodChange(
      'lark',
      restored.id,
      'done',
      [
        { name: 'index.md', fingerprint: oldIndex.fingerprint },
        { name: 'review.md', fingerprint: before.fingerprint },
      ],
      person,
    )
    const changed = image(Buffer.from('Someone changed the method'))
    const external = begin(deletion())!
    recovery().settleMethodChange(
      'lark',
      external.id,
      'partial',
      [{ name: 'review.md', fingerprint: changed.fingerprint }],
      person,
    )
    expect(
      begin({
        operation: 'undo',
        sourceId: external.id,
        target: 'review.md',
        files: [{ name: 'review.md', before: changed, after: before.fingerprint }],
      }),
    ).toBeNull()
    const unreadable = begin(deletion())!
    recovery().settleMethodChange(
      'lark',
      unreadable.id,
      'partial',
      [{ name: 'review.md', fingerprint: null, unreadable: true }],
      person,
    )
    expect(
      begin({
        operation: 'undo',
        sourceId: unreadable.id,
        target: 'review.md',
        files: [{ name: 'review.md', before: null, after: before.fingerprint }],
      }),
    ).toBeNull()
  })

  it('keeps a pending recovery record alive until its filesystem outcome is settled', () => {
    store.createAgentIdentity(
      { slug: 'finch', displayName: null, provider: 'codex' },
      { by: 'a-person' },
    )
    const pending = begin(deletion(), person, 'finch')!
    expect(store.removeAgentIdentity('finch')).toBe(false)
    expect(recovery().methodChange('finch', pending.id)?.outcome).toBe('pending')
    expect(
      recovery().settleMethodChange(
        'finch',
        pending.id,
        'partial',
        [{ name: 'review.md', fingerprint: before.fingerprint }],
        person,
      ),
    ).toBe(true)
    expect(store.removeAgentIdentity('finch')).toBe(true)
    expect(recovery().methodChanges('finch')).toEqual([])
  })

  it('removes the entire recovery chain when a never-run identity is deleted', () => {
    expect(
      store.createAgentIdentity(
        { slug: 'finch', displayName: null, provider: 'codex' },
        { by: 'a-person' },
      ),
    ).not.toBeNull()
    const deleted = begin(deletion(), person, 'finch')!
    recovery().settleMethodChange(
      'finch',
      deleted.id,
      'done',
      [{ name: 'review.md', fingerprint: null }],
      person,
    )
    const restored = begin(
      {
        operation: 'undo',
        sourceId: deleted.id,
        target: 'review.md',
        files: [{ name: 'review.md', before: null, after: before.fingerprint }],
      },
      person,
      'finch',
    )!
    recovery().settleMethodChange(
      'finch',
      restored.id,
      'done',
      [{ name: 'review.md', fingerprint: before.fingerprint }],
      person,
    )
    expect(store.removeAgentIdentity('finch')).toBe(true)
    expect(recovery().methodChanges('finch')).toEqual([])
    expect(db.pragma('foreign_key_check')).toEqual([])
  })

  it('keeps identity removal usable in fixtures from before the recovery table existed', () => {
    store.createAgentIdentity(
      { slug: 'finch', displayName: null, provider: 'codex' },
      { by: 'a-person' },
    )
    db.exec('DROP TABLE identity_method_change')
    expect(store.removeAgentIdentity('finch')).toBe(true)
    expect(db.pragma('foreign_key_check')).toEqual([])
  })

  it('pages identity history newest first and never repairs a corrupt recovery record silently', () => {
    for (let i = 0; i < 5; i++) {
      const started = begin()!
      recovery().settleMethodChange(
        'lark',
        started.id,
        'done',
        [{ name: 'review.md', fingerprint: null }],
        person,
      )
    }
    expect(
      recovery()
        .methodChanges('lark', 1, 2)
        .map((one) => one.sequence),
    ).toEqual([4, 3])
    expect(recovery().methodChanges('wren')).toEqual([])
    expect(recovery().methodChanges('lark', -1)).toEqual([])
    expect(recovery().methodChanges('lark', 0, 101)).toEqual([])
    const latest = recovery().methodChanges('lark', 0, 1)[0]!
    db.prepare('UPDATE identity_method_change SET files = ? WHERE id = ?').run('[]', latest.id)
    expect(() => recovery().methodChange('lark', latest.id)).toThrow(/unreadable/)
  })
})
