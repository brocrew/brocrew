import { mkdtempSync, rmSync } from 'node:fs'
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
  type MethodFileChange,
  type MethodFileState,
} from '../src/main/db/method-changes'
import type { ActedBy } from '../src/shared/who-did-it'

type Change = MethodFileChange & { readonly afterMode?: number | null }
type State = MethodFileState & { readonly mode?: number | null }
type RecordWithModes = Omit<MethodChangeRecord, 'files' | 'actual'> & {
  readonly files: readonly Change[]
  readonly actual: readonly State[] | null
}
interface Modes {
  begin(identity: string, intent: unknown, by: ActedBy, at: number): RecordWithModes | null
  settle(
    identity: string,
    id: string,
    outcome: 'done' | 'partial',
    actual: readonly State[],
    by: ActedBy,
  ): boolean
  reconcile(identity: string, id: string, actual: readonly State[], by: ActedBy): boolean
  read(identity: string, id: string): RecordWithModes | null
}
const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
const person = { who: 'a-person' } as const
const app = { who: 'the-app-itself' } as const
const identity = agentIdentityRowId('lark')
const original = Buffer.from('before\r\n')
const replacement = Buffer.from('after\r\n')
const image = (bytes: Buffer, mode: number) => ({
  base64: bytes.toString('base64'),
  mode,
})
const file = {
  name: 'index.md',
  before: image(original, 0o640),
  afterBase64: replacement.toString('base64'),
  afterMode: 0o600,
}
const intent = { operation: 'delete', sourceId: null, target: 'index.md', files: [file] }
const actual = [{ name: 'index.md', base64: replacement.toString('base64'), mode: 0o600 }]
let root: string
let db: AppDatabase
let api: Modes
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'method-modes-'))
  db = openDatabase(join(root, 'app.sqlite'))
  applyMigrations(db, migrations)
  expect(
    createSessionStore(db).createAgentIdentity(
      { slug: 'lark', displayName: null, provider: 'codex' },
      { by: 'a-person' },
    ),
  ).not.toBeNull()
  api = createMethodChangeStore(db) as unknown as Modes
})
afterEach(() => {
  db.close()
  rmSync(root, { recursive: true, force: true })
})
function start() {
  const row = api.begin(identity, intent, person, 1000)!
  expect(row.files[0]).toMatchObject({ afterMode: 0o600 })
  return row
}
describe('method recovery compares permissions as well as bytes', () => {
  it('retains planned and observed modes across reopen', () => {
    const row = start()
    expect(api.settle(identity, row.id, 'done', actual, person)).toBe(true)
    db.close()
    db = openDatabase(join(root, 'app.sqlite'))
    api = createMethodChangeStore(db) as unknown as Modes
    expect(api.read(identity, row.id)?.files[0]?.afterMode).toBe(0o600)
    expect(api.read(identity, row.id)?.actual).toEqual(actual)
  })
  it('refuses done when only the bytes match the plan', () => {
    const row = start()
    expect(api.settle(identity, row.id, 'done', [{ ...actual[0]!, mode: 0o644 }], person)).toBe(
      false,
    )
    expect(api.read(identity, row.id)?.outcome).toBe('pending')
    expect(api.settle(identity, row.id, 'done', actual, person)).toBe(true)
  })
  it('records unexpected app-observed permissions as partial', () => {
    const row = start()
    expect(api.reconcile(identity, row.id, [{ ...actual[0]!, mode: 0o644 }], app)).toBe(true)
    expect(api.read(identity, row.id)?.outcome).toBe('partial')
  })
  it.each([-1, 0o1000, 0.5, null, '600'])(
    'refuses an invalid planned mode %s without a pending blocker',
    (bad) => {
      const row = start()
      expect(api.settle(identity, row.id, 'done', actual, person)).toBe(true)
      expect(
        api.begin(identity, { ...intent, files: [{ ...file, afterMode: bad }] }, person, 2000),
      ).toBeNull()
    },
  )
  it('validates observed mode and absence pairs before settlement', () => {
    const row = start()
    for (const state of [
      { ...actual[0]!, mode: -1 },
      { ...actual[0]!, mode: null },
      { ...actual[0]!, base64: null },
    ])
      expect(api.settle(identity, row.id, 'partial', [state], person)).toBe(false)
    expect(api.settle(identity, row.id, 'done', actual, person)).toBe(true)
    const deleted = api.begin(
      identity,
      { ...intent, files: [{ ...file, afterBase64: null, afterMode: null }] },
      person,
      2000,
    )!
    expect(
      api.settle(
        identity,
        deleted.id,
        'done',
        [{ name: 'index.md', base64: null, mode: null }],
        person,
      ),
    ).toBe(true)
  })
  it('keeps legacy unknown modes unknown instead of fabricating them', () => {
    const row = start()
    expect(api.settle(identity, row.id, 'done', actual, person)).toBe(true)
    const legacyFile = { name: file.name, before: file.before, afterBase64: file.afterBase64 }
    const legacy = api.begin(identity, { ...intent, files: [legacyFile] }, person, 2000)!
    expect(legacy.files[0]).not.toHaveProperty('afterMode')
    expect(
      api.settle(
        identity,
        legacy.id,
        'done',
        [{ name: 'index.md', base64: replacement.toString('base64') }],
        person,
      ),
    ).toBe(true)
    expect(api.read(identity, legacy.id)?.actual?.[0]).not.toHaveProperty('mode')
  })
})
