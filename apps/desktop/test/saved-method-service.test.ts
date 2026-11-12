import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as methods from '../src/main/saved-method-service'
import * as memory from '../src/main/runtime/agent-memory'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { agentIdentityRowId } from '../src/main/db/identity'
import { createSessionStore } from '../src/main/db/session-store'
import {
  createMethodChangeStore,
  type MethodChangeStore,
  type MethodChangeReconciler,
} from '../src/main/db/method-changes'
import type { MethodDeleteSelection, MethodLibrary } from '../src/shared/saved-method-library'
import type { ActedBy } from '../src/shared/who-did-it'

interface Change {
  id: string
  outcome: 'pending' | 'done' | 'partial'
  operation: 'delete' | 'undo'
  settlement: { by: ActedBy; at: number } | null
  by: ActedBy
  canUndo?: boolean
  noEffect?: boolean
}
type Result = { ok: true; change: Change } | { ok: false; reason: string; change?: Change }
interface Service {
  list(slug: string, offset?: number, limit?: number): MethodLibrary
  remove(slug: string, selection: MethodDeleteSelection, by: ActedBy): Promise<Result>
  undo(slug: string, id: string, by: ActedBy): Promise<Result>
  checkInterrupted(slug: string, confirmed: boolean, by: ActedBy): Promise<Result>
  history(
    slug: string,
    offset?: number,
    limit?: number,
  ): { ok: true; changes: readonly Change[] } | { ok: false; reason: string }
}
interface Inputs {
  homesRoot: string
  folderOf: (slug: string) => string
  identities: () => readonly { id: string; slug: string }[]
  changes: MethodChangeStore & MethodChangeReconciler
  now: () => number
  stage: typeof memory.stageKnowledgeFile
  sweep: (folder: string, check: () => void) => void
  changed?: (slug: string) => void
  seams?: {
    beforePrepare?: () => Promise<void>
    beforeUnlink?: (name: string) => void
    writes?: memory.MemoryWriteSeams
  }
}
const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
const person = { who: 'a-person' } as const
const app = { who: 'the-app-itself' } as const
const agent = { who: 'an-agent', agent: 'ses-wren' } as const
const line = '- Review | During review | verified 2026-10-21 | review.md\r\n'
const bytes = Buffer.from([0xff, 0x00, 0x0d, 0x0a])
let root: string
let homesRoot: string
let db: AppDatabase
let changes: Inputs['changes']
let identities: { id: string; slug: string }[]
let clock: number
const folderOf = (slug: string) => join(homesRoot, slug, 'runbooks')
const path = (name: string, slug = 'lark') => join(folderOf(slug), name)
async function service(extra: Partial<Inputs> = {}): Promise<Service> {
  const create = Reflect.get(methods, 'createSavedMethodService') as (
    inputs: Inputs,
  ) => Promise<Service>
  expect(create, 'the locked saved-method filesystem service').toBeTypeOf('function')
  return create({
    homesRoot,
    folderOf,
    identities: () => identities,
    changes,
    now: () => clock++,
    stage: memory.stageKnowledgeFile,
    sweep: Reflect.get(memory, 'sweepKnowledgeStages') as Inputs['sweep'],
    ...extra,
  })
}
function selection(api: Service, name = 'review.md', slug = 'lark'): MethodDeleteSelection {
  const listed = api.list(slug)
  const item = listed.items.find((item) => item.name === name)!
  expect(item).toBeDefined()
  return {
    confirmed: true,
    key: item.key,
  }
}
function pending() {
  const image = { base64: bytes.toString('base64'), mode: 0o640 }
  return changes.begin(
    agentIdentityRowId('lark'),
    {
      operation: 'delete',
      sourceId: null,
      target: 'review.md',
      files: [{ name: 'review.md', before: image, afterBase64: null, afterMode: null }],
    },
    person,
    1000,
  )!
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'saved-method-service-'))
  homesRoot = join(root, 'homes')
  db = openDatabase(join(root, 'app.sqlite'))
  applyMigrations(db, migrations)
  const store = createSessionStore(db)
  identities = ['lark', 'wren'].map((slug) =>
    store.createAgentIdentity({ slug, displayName: null, provider: 'codex' }, { by: 'a-person' })!,
  )
  changes = createMethodChangeStore(db, () => clock++)
  clock = 5000
  for (const slug of ['lark', 'wren']) {
    mkdirSync(folderOf(slug), { recursive: true })
    writeFileSync(path('review.md', slug), bytes, { mode: 0o640 })
    writeFileSync(path('index.md', slug), `# Keep\r\n${line}untouched`, { mode: 0o600 })
  }
})
afterEach(() => {
  db.close()
  rmSync(root, { recursive: true, force: true })
})

describe('saved methods change only through a confirmed, recoverable profile operation', () => {
  it('deletes, restarts, restores exact binary/index bytes and can undo the Undo', async () => {
    const api = await service()
    const index = readFileSync(path('index.md'))
    const removed = await api.remove('lark', selection(api), person)
    expect(removed.ok).toBe(true)
    expect(existsSync(path('review.md'))).toBe(false)
    expect(readFileSync(path('index.md'), 'utf8')).toBe('# Keep\r\nuntouched')
    expect(removed.change).toMatchObject({ by: person, outcome: 'done' })
    const audit = changes.read(agentIdentityRowId('lark'), removed.change!.id)!
    expect(audit.files.every((file) => file.afterMode !== undefined)).toBe(true)
    expect(audit.actual!.every((file) => file.mode !== undefined)).toBe(true)
    const restarted = await service()
    const restored = await restarted.undo('lark', removed.change!.id, person)
    expect(restored.ok).toBe(true)
    expect(readFileSync(path('review.md'))).toEqual(bytes)
    expect(readFileSync(path('index.md'))).toEqual(index)
    const again = await restarted.undo('lark', restored.change!.id, person)
    expect(again.ok).toBe(true)
    expect(existsSync(path('review.md'))).toBe(false)
  })
  it.each([person, app, agent, { who: 'a-caller-this-app-cannot-name' } as const])(
    'requires primary confirmation and records the ordinary caller $who',
    async (by) => {
      const api = await service()
      const shown = selection(api)
      expect((await api.remove('lark', { ...shown, confirmed: false }, person)).ok).toBe(false)
      writeFileSync(path('index.md'), 'external index')
      const removed = await api.remove('lark', shown, by)
      expect(removed).toMatchObject({ ok: true, change: { by, settlement: { by } } })
      expect(changes.read(agentIdentityRowId('lark'), removed.change!.id)).toMatchObject({
        by,
        settlement: { by },
      })
      expect(existsSync(path('review.md'))).toBe(false)
      expect(readFileSync(path('index.md'), 'utf8')).toBe('external index')
    },
  )
  it('records colleague Undo while rejecting another profile or an older change id', async () => {
    const api = await service()
    const removed = await api.remove('lark', selection(api), person)
    expect((await api.undo('wren', removed.change!.id, person)).ok).toBe(false)
    const restored = await api.undo('lark', removed.change!.id, agent)
    expect(restored).toMatchObject({ ok: true, change: { by: agent, settlement: { by: agent } } })
    expect(api.history('lark')).toMatchObject({
      ok: true,
      changes: expect.arrayContaining([expect.objectContaining({ by: agent })]),
    })
    expect((await api.undo('lark', removed.change!.id, person)).ok).toBe(false)
  })
  it('refuses recreated files and external edits rather than overwriting them', async () => {
    const api = await service()
    const removed = await api.remove('lark', selection(api), person)
    writeFileSync(path('review.md'), 'created elsewhere')
    expect((await api.undo('lark', removed.change!.id, person)).ok).toBe(false)
    expect(readFileSync(path('review.md'), 'utf8')).toBe('created elsewhere')
    rmSync(path('review.md'))
    writeFileSync(path('index.md'), 'edited elsewhere')
    expect((await api.undo('lark', removed.change!.id, person)).ok).toBe(false)
  })
  it('deleting the index leaves methods; deleting a hard link leaves its other name', async () => {
    const api = await service()
    const index = await api.remove('lark', selection(api, 'index.md'), person)
    expect(index.ok).toBe(true)
    expect(readFileSync(path('review.md'))).toEqual(bytes)
    expect((await api.undo('lark', index.change!.id, person)).ok).toBe(true)
    linkSync(path('review.md'), join(root, 'other-name.md'))
    expect((await api.remove('lark', selection(api), person)).ok).toBe(true)
    expect(readFileSync(join(root, 'other-name.md'))).toEqual(bytes)
  })
  it.each([
    'beforePrepare',
    'beforeStageCreate',
    'beforeStagePublishOpen',
    'beforeUnlink',
  ] as const)(
    'preserves an external index/body writer at %s with truthful partial history',
    async (at) => {
      const changed = at === 'beforeUnlink' ? 'review.md' : 'index.md'
      const external = Buffer.from('External writer bytes.\r\n')
      const write = () => writeFileSync(path(changed), external)
      const api = await service({
        seams:
          at === 'beforePrepare'
            ? { beforePrepare: async () => write() }
            : at === 'beforeUnlink'
              ? { beforeUnlink: write }
              : { writes: { [at]: write } },
      })
      const result = await api.remove('lark', selection(api), person)
      expect(result).toMatchObject({
        ok: false,
        cause: expect.stringContaining('changed during this edit'),
        change: { outcome: 'partial' },
      })
      expect(readFileSync(path(changed))).toEqual(external)
      expect(existsSync(path('review.md'))).toBe(true)
      const recorded = changes.read(agentIdentityRowId('lark'), result.change!.id)!
      expect(recorded.actual).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: changed, base64: external.toString('base64') }),
        ]),
      )
      if (at === 'beforeUnlink')
        expect(readFileSync(path('index.md'), 'utf8')).toBe('# Keep\r\nuntouched')
      else expect(readFileSync(path('review.md'))).toEqual(bytes)
      const reopened = await service()
      expect((await reopened.undo('lark', result.change!.id, person)).ok).toBe(false)
      expect(readFileSync(path(changed))).toEqual(external)
    },
  )

  it('does not overwrite a writer interleaved with a completed operation’s Undo', async () => {
    const api = await service()
    const deleted = await api.remove('lark', selection(api), person)
    expect(deleted.ok).toBe(true)
    const undoing = await service({
      seams: {
        beforePrepare: async () => {
          writeFileSync(path('index.md'), 'External index.')
        },
      },
    })
    const result = await undoing.undo('lark', deleted.change!.id, person)
    expect(result).toMatchObject({ ok: false, change: { outcome: 'partial' } })
    expect(readFileSync(path('index.md'), 'utf8')).toBe('External index.')
    expect(existsSync(path('review.md'))).toBe(false)
  })

  it('records a partial phase and restores only its known states', async () => {
    const api = await service({
      seams: {
        beforeUnlink: () => {
          throw new Error('fixture unlink denied')
        },
      },
    })
    const removed = await api.remove('lark', selection(api), person)
    expect(removed).toMatchObject({
      ok: false,
      cause: expect.stringContaining('fixture unlink denied'),
      change: { outcome: 'partial' },
    })
    expect(readFileSync(path('review.md'))).toEqual(bytes)
    const restarted = await service()
    expect((await restarted.undo('lark', removed.change!.id, person)).ok).toBe(true)
    expect(readFileSync(path('index.md'), 'utf8')).toBe(`# Keep\r\n${line}untouched`)
  })
  it('keeps the last effective change undoable after attempts that publish nothing', async () => {
    let stop = false
    const api = await service({
      seams: {
        beforePrepare: async () => {
          if (stop) throw new Error('fixture preparation denied')
        },
      },
    })
    const index = readFileSync(path('index.md'))
    const removed = await api.remove('lark', selection(api), person)
    expect(removed.ok).toBe(true)
    stop = true
    const undoAttempt = await api.undo('lark', removed.change!.id, person)
    expect(undoAttempt).toMatchObject({
      ok: false,
      cause: expect.stringContaining('fixture preparation denied'),
      change: { outcome: 'partial' },
    })
    const deleteAttempt = await api.remove('lark', selection(api, 'index.md'), person)
    expect(deleteAttempt).toMatchObject({ ok: false, change: { outcome: 'partial' } })
    const history = api.history('lark')
    expect(history).toMatchObject({
      ok: true,
      changes: [
        { id: deleteAttempt.change!.id, noEffect: true, canUndo: false },
        { id: undoAttempt.change!.id, noEffect: true, canUndo: false },
        { id: removed.change!.id, canUndo: true },
      ],
    })
    expect(api.history('lark', 2, 1)).toMatchObject({
      ok: true,
      changes: [{ id: removed.change!.id, canUndo: true }],
    })
    expect(changes.list(agentIdentityRowId('lark'), 0, 100)).toHaveLength(3)
    stop = false
    expect((await api.undo('lark', undoAttempt.change!.id, person)).ok).toBe(false)
    const restored = await api.undo('lark', removed.change!.id, person)
    expect(restored.ok).toBe(true)
    expect(readFileSync(path('review.md'))).toEqual(bytes)
    expect(readFileSync(path('index.md'))).toEqual(index)
    expect(changes.list(agentIdentityRowId('lark'), 0, 100)).toHaveLength(4)
  })
  it('a failed begin writes no files, and a failed settlement remains visibly pending', async () => {
    const api = await service({ changes: { ...changes, begin: () => null } })
    expect((await api.remove('lark', selection(api), person)).ok).toBe(false)
    expect(readFileSync(path('review.md'))).toEqual(bytes)
    const failure = await service({ changes: { ...changes, settle: () => false } })
    const removed = await failure.remove('lark', selection(failure), person)
    expect(removed).toMatchObject({ ok: false, change: { outcome: 'pending' } })
    expect(changes.hasPending(agentIdentityRowId('lark'))).toBe(true)
    const restarted = await service()
    expect(changes.hasPending(agentIdentityRowId('lark'))).toBe(false)
    const history = restarted.history('lark')
    expect(history).toMatchObject({
      ok: true,
      changes: [{ outcome: 'done', by: person, settlement: { by: app } }],
    })
  })
  it('shows the database settlement cause after publication and records the real outcome on reopen', async () => {
    const cause = `SQLITE_FULL: '/fictional/workspace.sqlite' settling saved methods`
    const api = await service({
      changes: {
        ...changes,
        settle: () => {
          throw new Error(cause)
        },
      },
    })
    expect(await api.remove('lark', selection(api), person)).toMatchObject({
      ok: false,
      cause: expect.stringContaining(cause),
      change: { outcome: 'pending' },
    })
    expect(existsSync(path('review.md'))).toBe(false)
    expect(changes.hasPending(agentIdentityRowId('lark'))).toBe(true)
    const reopened = await service()
    expect(reopened.history('lark')).toMatchObject({ ok: true, changes: [{ outcome: 'done' }] })
  })

  it('shows the database cause during an explicit interruption check without claiming completion', async () => {
    const cause = `SQLITE_IOERR: '/fictional/workspace.sqlite' checking saved methods`
    const api = await service({
      changes: {
        ...changes,
        settle: () => {
          throw new Error(cause)
        },
      },
    })
    const row = pending()
    expect(await api.checkInterrupted('lark', true, person)).toMatchObject({
      ok: false,
      cause: expect.stringContaining(cause),
    })
    expect(changes.read(agentIdentityRowId('lark'), row.id)?.outcome).toBe('pending')
    expect(readFileSync(path('review.md'))).toEqual(bytes)
  })

  it('startup observes unfinished work without changing its author or restoring files', async () => {
    const row = pending()
    rmSync(path('review.md'))
    await service()
    expect(changes.read(agentIdentityRowId('lark'), row.id)).toMatchObject({
      outcome: 'done',
      by: person,
      settlement: { by: app },
    })
    expect(existsSync(path('review.md'))).toBe(false)
  })
  it('undoes a completed legacy operation from its recorded bytes and fresh content without trusting digests', async () => {
    const api = await service()
    const removed = await api.remove('lark', selection(api), person)
    expect(removed.ok).toBe(true)
    if (!removed.ok) throw new Error('remove did not finish')
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%method%change%'")
      .all() as { name: string }[]
    expect(table).toHaveLength(1)
    const name = table[0]!.name
    const stored = db
      .prepare(`SELECT files, actual FROM ${name} WHERE id=?`)
      .get(removed.change.id) as { files: string; actual: string }
    const files = JSON.parse(stored.files).map(
      (one: { afterBase64?: string | null; before: Record<string, unknown> | null }) => {
        const { afterBase64, ...old } = one
        return {
          ...old,
          before: old.before === null ? null : { ...old.before, fingerprint: 'a'.repeat(64) },
          after: afterBase64 === null ? null : 'b'.repeat(64),
        }
      },
    )
    const actual = JSON.parse(stored.actual).map((one: { base64?: string | null }) => {
      const { base64, ...old } = one
      return { ...old, fingerprint: base64 === null ? null : 'c'.repeat(64) }
    })
    db.prepare(`UPDATE ${name} SET files=?, actual=? WHERE id=?`).run(
      JSON.stringify(files),
      JSON.stringify(actual),
      removed.change.id,
    )
    const reopened = await service()
    expect((await reopened.undo('lark', removed.change.id, person)).ok).toBe(true)
    expect(readFileSync(path('review.md'))).toEqual(bytes)
    expect(readFileSync(path('index.md'), 'utf8')).toBe(`# Keep\r\n${line}untouched`)
  })

  it('a person can check an interrupted operation without impersonating startup or changing files', async () => {
    let settle = false
    const api = await service({
      changes: { ...changes, settle: (...args) => settle && changes.settle(...args) },
    })
    const removed = await api.remove('lark', selection(api), person)
    expect(removed).toMatchObject({ ok: false, change: { outcome: 'pending' } })
    expect((await api.checkInterrupted('lark', true, agent)).ok).toBe(false)
    expect((await api.checkInterrupted('lark', false, person)).ok).toBe(false)
    settle = true
    const checked = await api.checkInterrupted('lark', true, person)
    expect(checked).toMatchObject({
      ok: true,
      change: { outcome: 'done', by: person, settlement: { by: person } },
    })
    expect(existsSync(path('review.md'))).toBe(false)
  })
  it('serializes concurrent requests through awaited preparation and keeps intent before effect', async () => {
    let release!: () => void
    let entered!: () => void
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    const ready = new Promise<void>((resolve) => {
      entered = resolve
    })
    const api = await service({
      seams: {
        beforePrepare: async () => {
          entered()
          await waiting
        },
      },
    })
    const shown = selection(api)
    const first = api.remove('lark', shown, person)
    await ready
    expect(changes.hasPending(agentIdentityRowId('lark'))).toBe(true)
    expect(readFileSync(path('review.md'))).toEqual(bytes)
    let finished = false
    const second = api.remove('lark', shown, person).then((value) => {
      finished = true
      return value
    })
    await Promise.resolve()
    expect(finished).toBe(false)
    release()
    expect((await first).ok).toBe(true)
    expect((await second).ok).toBe(false)
    expect(changes.list(agentIdentityRowId('lark'), 0, 100)).toHaveLength(1)
  })
  it('dangling cleanup refuses Undo if the absent target was recreated', async () => {
    rmSync(path('review.md'))
    const api = await service()
    const removed = await api.remove('lark', selection(api), person)
    expect(removed.ok).toBe(true)
    writeFileSync(path('review.md'), 'new')
    expect((await api.undo('lark', removed.change!.id, person)).ok).toBe(false)
  })
  it('refuses hostile keys, never deletes what a linked method leads to, and does not provision unknown profile folders', async () => {
    const api = await service()
    const shown = selection(api)
    expect((await api.remove('../outside', shown, person)).ok).toBe(false)
    expect((await api.remove('lark', { ...shown, key: path('review.md') }, person)).ok).toBe(false)
    rmSync(path('review.md'))
    writeFileSync(join(root, 'outside.md'), bytes)
    symlinkSync(join(root, 'outside.md'), path('review.md'))
    await api.remove('lark', selection(api), person)
    expect(readFileSync(join(root, 'outside.md'))).toEqual(bytes)
    expect(existsSync(folderOf('unknown'))).toBe(false)
  })
  it.runIf(process.platform !== 'win32')(
    'rejects an external chmod and faithfully restores original modes',
    async () => {
      chmodSync(path('review.md'), 0o640)
      const api = await service()
      const removed = await api.remove('lark', selection(api), person)
      chmodSync(path('index.md'), 0o644)
      expect((await api.undo('lark', removed.change!.id, person)).ok).toBe(false)
      chmodSync(path('index.md'), 0o600)
      expect((await api.undo('lark', removed.change!.id, person)).ok).toBe(true)
      const row = changes.list(agentIdentityRowId('lark'), 0, 1)[0]!
      expect(row.actual?.find((file) => file.name === 'review.md')?.mode).toBe(0o640)
    },
  )
  it('keeps corrupt pending records visible and never uses their bytes', async () => {
    const row = pending()
    db.prepare('UPDATE identity_method_change SET files = ? WHERE id = ?').run('[]', row.id)
    const api = await service()
    expect(api.history('lark')).toMatchObject({ ok: false, reason: 'history-unreadable' })
    expect((await api.remove('lark', selection(api), person)).ok).toBe(false)
    expect(readFileSync(path('review.md'))).toEqual(bytes)
  })
  it('public history contains metadata but never recovery base64 or source text', async () => {
    const api = await service()
    expect((await api.remove('lark', selection(api), person)).ok).toBe(true)
    const history = JSON.stringify(api.history('lark'))
    expect(history).not.toContain('base64')
    expect(history).not.toContain(bytes.toString('base64'))
    expect(history).not.toContain('During review')
  })
  it('startup sweeps inactive app stages without deleting other files', async () => {
    writeFileSync(path('.review.md.brobot-01234567890123456789abcd'), 'crash bytes', {
      mode: 0o600,
    })
    writeFileSync(path('keep.txt'), 'keep')
    await service()
    expect(readdirSync(folderOf('lark')).sort()).toEqual(['index.md', 'keep.txt', 'review.md'])
  })
})
