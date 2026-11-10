import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { codexAdHocNotesDir } from '@brobot2/runtime/codex'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import {
  createMemoryAmendmentObserver,
  createSessionStore,
  type SessionStore,
} from '../src/main/db/session-store'
import * as memory from '../src/main/runtime/agent-memory'
import type { AgentMemoryInputs, MemoryWriteSeams } from '../src/main/runtime/agent-memory'
import type { MemoryAmendment, MemoryObservation } from '../src/shared/agent-memory'
import type { ActedBy } from '../src/shared/who-did-it'

interface Edit {
  profile: string
  provider: 'codex'
  entry: string
  act: 'removed' | 'corrected'
  text: string
  confirmed: boolean
}
interface Result {
  ok: boolean
  reason?: string
  cause?: string
  amendment?: MemoryAmendment
}
interface Service {
  amend(said: Edit, by: ActedBy): Promise<Result>
  undo(slug: string, sourceId: string, confirmed: boolean, by: ActedBy): Promise<Result>
  checkInterrupted(slug: string, confirmed: boolean, by: ActedBy): Promise<Result>
  held(slug: string): boolean
  busy(slug: string): boolean
  close(waitMs?: number): Promise<void>
}
interface Inputs {
  store: SessionStore
  inputsOf: (slug: string) => AgentMemoryInputs
  now: () => number
  reconcile: (id: string, change: string, actual: MemoryObservation, by: ActedBy) => boolean
  changed?: (slug: string) => void
  seams?: { beforeEffect?: () => Promise<void>; writes?: MemoryWriteSeams }
}
const person = { who: 'a-person' } as const
const app = { who: 'the-app-itself' } as const
const agent = { who: 'an-agent', agent: 'ses-wren' } as const
const original = 'Saved text.\r\nCafé.\n'
const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
let root: string
let homes: string
let db: AppDatabase
let store: SessionStore
let clock: number
let services: Service[]
let releases: (() => void)[]
const home = (slug: string) => join(homes, 'default', slug, 'codex')
const entry = (slug = 'lark', name = 'note.md') => join(codexAdHocNotesDir(home(slug)), name)
const selection = (overrides: Partial<Edit> = {}): Edit => ({
  profile: 'lark',
  provider: 'codex',
  entry: entry(),
  act: 'removed',
  text: '',
  confirmed: true,
  ...overrides,
})
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((yes) => {
    resolve = yes
  })
  releases.push(resolve)
  return { promise, resolve }
}
async function create(overrides: Partial<Inputs> = {}): Promise<Service> {
  const factory = memory.createMemoryService as unknown as (inputs: Inputs) => Promise<Service>
  const service = await factory({
    store,
    inputsOf: (slug) => ({ profileId: slug, homesRoot: homes, homeOf: () => home(slug) }),
    now: () => clock++,
    reconcile: createMemoryAmendmentObserver(db, () => clock++).reconcile,
    ...overrides,
  })
  services.push(service)
  return service
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'memory-service-'))
  homes = join(root, 'homes')
  db = openDatabase(join(root, 'app.sqlite'))
  applyMigrations(db, migrations)
  clock = 1000
  store = createSessionStore(db, () => clock++)
  services = []
  releases = []
  for (const slug of ['lark', 'wren']) {
    store.createAgentIdentity({ slug, displayName: null, provider: 'codex' }, { by: 'a-person' })
    mkdirSync(dirname(entry(slug)), { recursive: true })
    writeFileSync(entry(slug), original, { mode: 0o640 })
  }
})
afterEach(async () => {
  for (const release of releases) release()
  for (const service of services) await service.close(0)
  db.close()
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

describe('memory writes retain their intent under one profile lock until honest settlement', () => {
  it('makes the saved text durable before unlink and records the observed result', async () => {
    const service = await create({
      seams: {
        writes: {
          beforeMemoryUnlink: () => {
            expect(existsSync(entry())).toBe(true)
            expect(store.memoryAmendmentsOf('lark')[0]).toMatchObject({
              outcome: 'pending',
              textBefore: original,
              textAfter: null,
              by: person,
            })
          },
        },
      },
    })
    expect(await service.amend(selection(), person)).toMatchObject({
      ok: true,
      amendment: { outcome: 'done', actual: { text: null }, settlement: { by: person } },
    })
    expect(existsSync(entry())).toBe(false)
    expect(service.held('lark')).toBe(false)
  })
  it('corrects and reverses exact text through the same durable path', async () => {
    const service = await create()
    const mode = statSync(entry()).mode & 0o777
    const changed = await service.amend(selection({ act: 'corrected', text: 'Updated.\n' }), person)
    expect(changed).toMatchObject({ ok: true, amendment: { outcome: 'done' } })
    expect(readFileSync(entry(), 'utf8')).toBe('Updated.\n')
    expect(statSync(entry()).mode & 0o777).toBe(mode)
    const undone = await service.undo('lark', changed.amendment!.id, true, person)
    expect(undone).toMatchObject({
      ok: true,
      amendment: { sourceId: changed.amendment!.id, act: 'corrected' },
    })
    expect(readFileSync(entry(), 'utf8')).toBe(original)
    expect(await service.undo('lark', undone.amendment!.id, true, person)).toMatchObject({
      ok: true,
    })
    expect(readFileSync(entry(), 'utf8')).toBe('Updated.\n')
  })
  it('restores a deletion exclusively and refuses a recreated or superseded source', async () => {
    const service = await create()
    const deleted = await service.amend(selection(), person)
    const restored = await service.undo('lark', deleted.amendment!.id, true, person)
    expect(restored).toMatchObject({
      ok: true,
      amendment: { act: 'restored', textAfter: original },
    })
    expect(readFileSync(entry(), 'utf8')).toBe(original)
    expect(await service.undo('lark', deleted.amendment!.id, true, person)).toMatchObject({
      ok: false,
      reason: 'source-changed',
    })
    const removed = await service.undo('lark', restored.amendment!.id, true, person)
    expect(removed).toMatchObject({ ok: true, amendment: { act: 'removed' } })
    writeFileSync(entry(), 'External text.')
    const count = store.memoryAmendmentsOf('lark').length
    expect(await service.undo('lark', removed.amendment!.id, true, person)).toMatchObject({
      ok: false,
    })
    expect(readFileSync(entry(), 'utf8')).toBe('External text.')
    expect(store.memoryAmendmentsOf('lark')).toHaveLength(count)
  })
  it('refuses an agent or the app before looking up an identity or touching files', async () => {
    const service = await create()
    const identities = vi.spyOn(store, 'agentIdentities')
    for (const by of [agent, app]) {
      expect(await service.amend(selection(), by)).toMatchObject({ reason: 'person-required' })
      expect(await service.undo('lark', 'not-a-row', true, by)).toMatchObject({
        reason: 'person-required',
      })
      expect(await service.checkInterrupted('lark', true, by)).toMatchObject({
        reason: 'person-required',
      })
    }
    expect(identities).not.toHaveBeenCalled()
    expect(readFileSync(entry(), 'utf8')).toBe(original)
  })
  it('requires a known identity and primary confirmation before begin', async () => {
    const service = await create()
    for (const bad of [
      selection({ profile: 'unknown' }),
      selection({ confirmed: false }),
      selection({ entry: join(root, 'outside.md') }),
    ])
      expect(await service.amend(bad, person)).toMatchObject({ ok: false })
    expect(store.memoryAmendmentsOf('lark')).toEqual([])
    expect(readFileSync(entry(), 'utf8')).toBe(original)
  })
  it.each(['EACCES', 'ENOSPC'] as const)(
    'keeps a real %s cause and allows a repaired later attempt',
    async (code) => {
      const failed = await create({
        seams: {
          beforeEffect: async () => {
            throw Object.assign(new Error(`${code}: ${entry()}`), { code })
          },
        },
      })
      const outcome = await failed.amend(selection(), person)
      expect(outcome).toMatchObject({
        ok: false,
        cause: expect.stringContaining(code),
        amendment: { outcome: 'unchanged' },
      })
      expect(outcome.cause).toContain(entry())
      expect(readFileSync(entry(), 'utf8')).toBe(original)
      await failed.close(0)
      const repaired = await create()
      expect((await repaired.amend(selection(), person)).ok).toBe(true)
    },
  )
  it('serializes one profile across entries while another profile can finish', async () => {
    const entered = deferred()
    const release = deferred()
    let calls = 0
    const service = await create({
      seams: {
        beforeEffect: async () => {
          if (calls++ === 0) {
            entered.resolve()
            await release.promise
          }
        },
      },
    })
    writeFileSync(entry('lark', 'second.md'), original)
    const first = service.amend(selection(), person)
    await entered.promise
    const second = service.amend(selection({ entry: entry('lark', 'second.md') }), person)
    expect(service.busy('lark')).toBe(true)
    expect(service.held('lark')).toBe(true)
    expect(store.memoryAmendmentsOf('lark')).toHaveLength(1)
    expect(existsSync(entry('lark', 'second.md'))).toBe(true)
    expect(
      await service.amend(selection({ profile: 'wren', entry: entry('wren') }), person),
    ).toMatchObject({ ok: true })
    release.resolve()
    expect(await first).toMatchObject({ ok: true })
    expect(await second).toMatchObject({ ok: true })
    expect(store.memoryAmendmentsOf('lark').every((row) => row.outcome === 'done')).toBe(true)
  })
  it('observes an interrupted change as the app before returning the service', async () => {
    const row = store.beginMemoryAmendment(
      {
        profileSlug: 'lark',
        provider: 'codex',
        entry: entry(),
        act: 'removed',
        by: person,
        textBefore: original,
        textAfter: null,
      },
      clock++,
    )!
    unlinkSync(entry())
    const service = await create()
    expect(store.memoryAmendment('lark', row.id)).toMatchObject({
      outcome: 'done',
      by: person,
      at: row.at,
      actual: { text: null },
      settlement: { by: app },
    })
    expect(service.held('lark')).toBe(false)
    expect(existsSync(entry())).toBe(false)
  })
  it.each([
    { valid: false, position: 'before' },
    { valid: false, position: 'after' },
    { valid: true, position: 'before' },
    { valid: true, position: 'after' },
  ])(
    'observes UTF-8 losslessly when replacement text is $position (valid=$valid)',
    async ({ valid, position }) => {
      const row = store.beginMemoryAmendment(
        {
          profileSlug: 'lark',
          provider: 'codex',
          entry: entry(),
          act: 'corrected',
          by: person,
          textBefore: position === 'before' ? '\uFFFD' : original,
          textAfter: position === 'after' ? '\uFFFD' : 'Changed.',
        },
        clock++,
      )!
      writeFileSync(entry(), valid ? Buffer.from('\uFFFD', 'utf8') : Buffer.from([0xff]))
      const api = await create()
      const observed = store.memoryAmendment('lark', row.id)!
      expect(observed.outcome).toBe(
        valid ? (position === 'after' ? 'done' : 'unchanged') : 'partial',
      )
      if (valid) expect(observed.actual).toEqual({ text: '\uFFFD' })
      else {
        expect(observed.actual).toMatchObject({
          text: null,
          unreadable: true,
          cause: expect.stringContaining('invalid UTF-8'),
        })
        expect(observed.actual?.cause).toContain(entry())
        expect((await api.undo('lark', row.id, true, person)).ok).toBe(false)
        expect(readFileSync(entry())).toEqual(Buffer.from([0xff]))
      }
    },
  )

  it.each([
    'beforeEffect',
    'beforeStageCreate',
    'beforeStagePublishOpen',
    'beforeMemoryUnlink',
  ] as const)(
    'keeps an external edit as a partial barrier instead of overwriting it during Undo: %s',
    async (at) => {
      const write = () => writeFileSync(entry(), 'External edit.')
      const api = await create({
        seams:
          at === 'beforeEffect'
            ? { beforeEffect: async () => write() }
            : { writes: { [at]: write } },
      })
      const result = await api.amend(
        selection(
          at === 'beforeMemoryUnlink' ? {} : { act: 'corrected', text: 'Our replacement.' },
        ),
        person,
      )
      expect(result).toMatchObject({
        ok: false,
        cause: expect.stringContaining('changed during this edit'),
        amendment: {
          outcome: 'partial',
          textBefore: original,
          actual: { text: 'External edit.' },
        },
      })
      expect(readFileSync(entry(), 'utf8')).toBe('External edit.')
      expect((await api.undo('lark', result.amendment!.id, true, person)).ok).toBe(false)
      expect(readFileSync(entry(), 'utf8')).toBe('External edit.')
    },
  )

  it('records unreadable namespace as partial instead of inventing an absence', async () => {
    const row = store.beginMemoryAmendment(
      {
        profileSlug: 'lark',
        provider: 'codex',
        entry: entry(),
        act: 'removed',
        by: person,
        textBefore: original,
        textAfter: null,
      },
      clock++,
    )!
    rmSync(dirname(entry()), { recursive: true })
    const service = await create()
    expect(store.memoryAmendment('lark', row.id)).toMatchObject({
      outcome: 'partial',
      actual: { text: null, unreadable: true },
      settlement: { by: app },
    })
    expect(await service.undo('lark', row.id, true, person)).toMatchObject({ ok: false })
  })
  it('does not change a file if the pending intent cannot be recorded', async () => {
    const service = await create({ store: { ...store, beginMemoryAmendment: () => null } })
    expect(
      await service.amend(selection({ act: 'corrected', text: 'Replacement.' }), person),
    ).toMatchObject({ ok: false, reason: 'not-recorded' })
    expect(readFileSync(entry(), 'utf8')).toBe(original)
    expect(store.memoryAmendmentsOf('lark')).toEqual([])
  })
  it('retains a failed settlement as pending until startup records what it finds', async () => {
    const service = await create({ store: { ...store, settleMemoryAmendment: () => false } })
    expect(await service.amend(selection(), person)).toMatchObject({
      ok: false,
      reason: 'not-recorded',
    })
    expect(service.held('lark')).toBe(true)
    expect(store.memoryAmendmentsOf('lark')[0]?.outcome).toBe('pending')
    await service.close(0)
    const resumed = await create()
    expect(store.memoryAmendmentsOf('lark')[0]).toMatchObject({
      outcome: 'done',
      settlement: { by: app },
    })
    expect(resumed.held('lark')).toBe(false)
  })
  it.each(['settlement', 'readback'] as const)(
    'keeps the actual %s database cause after a file publication',
    async (fault) => {
      const cause = `SQLITE_FULL: '/fictional/workspace.sqlite' during ${fault}`
      const broken = {
        ...store,
        ...(fault === 'settlement'
          ? {
              settleMemoryAmendment: () => {
                throw new Error(cause)
              },
            }
          : {
              memoryAmendment: () => {
                throw new Error(cause)
              },
            }),
      }
      const service = await create({ store: broken })
      const reply = await service.amend(
        selection({ act: 'corrected', text: 'Published replacement.' }),
        person,
      )
      expect(reply).toMatchObject({ ok: false, cause: expect.stringContaining(cause) })
      expect(readFileSync(entry(), 'utf8')).toBe('Published replacement.')
      expect(store.memoryAmendmentsOf('lark')[0]?.outcome).toBe(
        fault === 'settlement' ? 'pending' : 'done',
      )
      await service.close(0)
      await create()
      expect(store.memoryAmendmentsOf('lark')[0]?.outcome).toBe('done')
    },
  )

  it('names a database failure while checking an interrupted memory change and leaves it pending', async () => {
    const cause = `SQLITE_IOERR: '/fictional/workspace.sqlite' checking memory`
    const service = await create({
      store: {
        ...store,
        settleMemoryAmendment: () => {
          throw new Error(cause)
        },
      },
    })
    const row = store.beginMemoryAmendment(
      {
        profileSlug: 'lark',
        provider: 'codex',
        entry: entry(),
        act: 'removed',
        by: person,
        textBefore: original,
        textAfter: null,
      },
      clock++,
    )!
    expect(await service.checkInterrupted('lark', true, person)).toMatchObject({
      ok: false,
      cause: expect.stringContaining(cause),
    })
    expect(store.memoryAmendment('lark', row.id)?.outcome).toBe('pending')
    expect(readFileSync(entry(), 'utf8')).toBe(original)
  })

  it('undoes a completed legacy observation from saved before/after text and a fresh current read', async () => {
    const service = await create()
    const removed = await service.amend(selection(), person)
    const id = removed.amendment!.id
    db.prepare('UPDATE identity_memory_amendment SET actual=? WHERE id=?').run(
      JSON.stringify({ fingerprint: 'a'.repeat(64) }),
      id,
    )
    expect(store.memoryAmendment('lark', id)).toMatchObject({ outcome: 'done', actual: {} })
    expect(await service.undo('lark', id, true, person)).toMatchObject({ ok: true })
    expect(readFileSync(entry(), 'utf8')).toBe(original)
  })

  it('bounds quit, refuses queued work and prevents late filesystem, store or refresh effects', async () => {
    const entered = deferred()
    const release = deferred()
    let unavailable = false
    let lateCalls = 0
    const guarded = new Proxy(store, {
      get(target, key, receiver) {
        const value: unknown = Reflect.get(target, key, receiver)
        if (typeof value !== 'function') return value
        return (...args: unknown[]) => {
          if (unavailable) {
            lateCalls++
            throw new Error('The database is closed')
          }
          return Reflect.apply(value, target, args)
        }
      },
    })
    const service = await create({
      store: guarded,
      changed: () => {
        if (unavailable) lateCalls++
      },
      seams: {
        beforeEffect: async () => {
          entered.resolve()
          await release.promise
        },
      },
    })
    const first = service.amend(selection(), person)
    await entered.promise
    const queued = service.amend(selection({ act: 'corrected', text: 'Queued.' }), person)
    await service.close(0)
    unavailable = true
    expect(await service.amend(selection(), person)).toMatchObject({ reason: 'closing' })
    release.resolve()
    expect(await first).toMatchObject({ reason: 'closing' })
    expect(await queued).toMatchObject({ reason: 'closing' })
    expect(lateCalls).toBe(0)
    expect(readFileSync(entry(), 'utf8')).toBe(original)
    expect(store.memoryAmendmentsOf('lark')[0]?.outcome).toBe('pending')
  })
  it('does not wait for a stale pending record when no operation is in flight', async () => {
    store.beginMemoryAmendment(
      {
        profileSlug: 'lark',
        provider: 'codex',
        entry: entry(),
        act: 'removed',
        by: person,
        textBefore: original,
        textAfter: null,
      },
      clock++,
    )
    const service = await create({ reconcile: () => false })
    expect(service.held('lark')).toBe(true)
    await service.close(1000)
    expect(store.hasPendingMemoryAmendment('lark')).toBe(true)
  })
})
