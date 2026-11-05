import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { once } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { openPluginSqlite as openStandalone } from '../src/main/plugins/supervisor/sqlite-adapter'
import type { PluginSqlite } from '../src/main/plugins/sqlite-contract'
import { holdPluginSqlite } from './helpers/held-plugin-sqlite'
import { GlobalPluginState } from '../src/main/plugins/state/store'
import { bootstrapPluginLifecycle } from '../src/main/plugins/lifecycle/bootstrap'
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import {
  PluginWorkspaceLease,
  pluginWorkspaceIdentity,
} from '../src/main/plugins/supervisor/client'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import { createPluginNodeHost } from '../src/main/plugins/node-host'
import { seedSqliteHistory } from '../smoke/plugin-sqlite-bootstrap'

// Match the PRODUCTION standalone builder's replacement for the narrow contract module.
// The adapter and node:sqlite remain real; neither method surface nor state recovery is mocked.
vi.mock('../src/main/plugins/sqlite-contract', async () => ({
  openPluginSqlite: (await import('../src/main/plugins/supervisor/sqlite-adapter'))
    .openPluginSqlite,
}))
const { openPluginSqlite: openApp } = await vi.importActual<
  typeof import('../src/main/plugins/sqlite-contract')
>('../src/main/plugins/sqlite-contract')

const folders: string[] = []
const children: ChildProcess[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  for (const child of children.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    const exited = once(child, 'exit')
    child.kill('SIGKILL')
    await exited
  }
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
})
async function folder() {
  const path = await realpath(
    await mkdtemp(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fs-')),
  )
  folders.push(path)
  return path
}

describe.each([
  { name: 'app native', open: openApp },
  { name: 'standalone shipped Node', open: openStandalone },
])('$name SQLite contract', ({ open }) => {
  it('binds positional statements and reads the operation history after reopening', async () => {
    const path = join(await folder(), 'history.sqlite')
    let database = open(path)
    try {
      expect(database.prepare('PRAGMA journal_mode').get()).toMatchObject({
        journal_mode: 'delete',
      })
      expect(database.prepare('PRAGMA busy_timeout').get()).toMatchObject({ timeout: 0 })
      expect(database.prepare('PRAGMA synchronous').get()).toMatchObject({ synchronous: 2 })
      database.exec('CREATE TABLE operations (id TEXT PRIMARY KEY, value TEXT NOT NULL)')
      const insert = database.prepare('INSERT INTO operations (id, value) VALUES (?, ?)')
      insert.run('fictional-one', '{"status":"committed"}')
      insert.run('fictional-two', '{"status":"aborted"}')
      expect(
        database.prepare('SELECT value FROM operations WHERE id = ?').get('absent'),
      ).toBeUndefined()
      database.close()
      database = open(path)
      expect(
        database.prepare('SELECT value FROM operations WHERE id = ?').get('fictional-one'),
      ).toMatchObject({ value: '{"status":"committed"}' })
      expect(database.prepare('SELECT id FROM operations ORDER BY id').all()).toEqual([
        { id: 'fictional-one' },
        { id: 'fictional-two' },
      ])
    } finally {
      database.close()
    }
  })

  it('commits the whole callback and rolls back all writes on its original failure', async () => {
    const database = open(join(await folder(), 'history.sqlite'))
    try {
      database.exec('CREATE TABLE operations (id TEXT PRIMARY KEY)')
      const insert = database.prepare('INSERT INTO operations (id) VALUES (?)')
      const commit = database.transaction(() => {
        insert.run('fictional-kept')
        return 'committed'
      })
      expect(commit()).toBe('committed')
      const failure = new Error('fictional import interrupted')
      const interrupted = database.transaction(() => {
        insert.run('fictional-rolled-back')
        throw failure
      })
      let caught: unknown
      try {
        interrupted()
      } catch (error) {
        caught = error
      }
      expect(caught).toBe(failure)
      expect(database.prepare('SELECT id FROM operations ORDER BY id').all()).toEqual([
        { id: 'fictional-kept' },
      ])
      // A failure releases transaction ownership so a subsequent ordinary import can commit.
      expect(database.transaction(() => insert.run('fictional-after-failure'))).not.toThrow()
    } finally {
      database.close()
    }
  })

  it('confirms FULL before a transaction used as the first database operation', async () => {
    const database = open(join(await folder(), 'first-transaction.sqlite'))
    try {
      const transact = database.transaction(() => {
        // Policy SQL inside this transaction would fail; first-use setup must already be complete.
        expect(database.prepare('PRAGMA synchronous').get()).toMatchObject({ synchronous: 2 })
        database.exec('CREATE TABLE records (id INTEGER); INSERT INTO records VALUES (9)')
        return 'committed'
      })
      expect(transact()).toBe('committed')
      expect(database.prepare('SELECT id FROM records').all()).toEqual([{ id: 9 }])
    } finally {
      database.close()
    }
  })

  it('preserves exclusive writer refusal and permits the successor after release', async () => {
    const path = join(await folder(), 'fence.sqlite')
    const owner = open(path)
    const contender = open(path)
    try {
      owner.exec('BEGIN EXCLUSIVE')
      expect(() => contender.exec('BEGIN EXCLUSIVE')).toThrow(
        expect.objectContaining({ code: 'SQLITE_BUSY' }),
      )
      owner.exec('ROLLBACK')
      expect(() => contender.exec('BEGIN EXCLUSIVE')).not.toThrow()
      contender.exec('ROLLBACK')
    } finally {
      owner.close()
      contender.close()
    }
  })

  it('refuses missing existing-only/readonly files without creating anything, and enforces readonly', async () => {
    const home = await folder(),
      missing = join(home, 'absent.sqlite')
    expect(() => open(missing, { fileMustExist: true, timeout: 0 })).toThrow()
    expect(existsSync(missing)).toBe(false)
    expect(() => open(missing, { readonly: true, timeout: 0 })).toThrow()
    expect(existsSync(missing)).toBe(false)
    const path = join(home, 'history.sqlite'),
      writer = open(path)
    writer.exec('CREATE TABLE records (id INTEGER); INSERT INTO records VALUES (7)')
    writer.close()
    const reader = open(path, { readonly: true, fileMustExist: true, timeout: 0 })
    try {
      expect(reader.prepare('SELECT id FROM records').get()).toMatchObject({ id: 7 })
      expect(() => reader.prepare('INSERT INTO records VALUES (?)').run(8)).toThrow()
      expect(reader.prepare('SELECT id FROM records').all()).toEqual([{ id: 7 }])
    } finally {
      reader.close()
    }
    expect(() => reader.exec('SELECT 1')).toThrow()
  })

  it('refuses nested and returned-Promise transactions and rolls back their writes', async () => {
    const database = open(join(await folder(), 'transactions.sqlite'))
    try {
      database.exec('CREATE TABLE records (id INTEGER)')
      const nested = database.transaction(() => {
        database.exec('INSERT INTO records VALUES (1)')
        database.transaction(() => database.exec('INSERT INTO records VALUES (2)'))()
      })
      expect(nested).toThrow('plugin-sqlite-nested-transaction')
      const asyncResult = database.transaction(() => {
        database.exec('INSERT INTO records VALUES (3)')
        return Promise.resolve('forbidden')
      })
      expect(asyncResult).toThrow('plugin-sqlite-async-transaction')
      expect(database.prepare('SELECT id FROM records').all()).toEqual([])
    } finally {
      database.close()
    }
  })

  it('opens under a second-process EXCLUSIVE lock and maps every statement BUSY until release', async () => {
    const path = join(await folder(), 'held.sqlite'),
      database = open(path)
    database.exec('CREATE TABLE records (id INTEGER); INSERT INTO records VALUES (1)')
    const insert = database.prepare('INSERT INTO records VALUES (?)')
    const select = database.prepare('SELECT id FROM records')
    let contender: PluginSqlite | undefined
    try {
      const held = await holdPluginSqlite(path, children)
      try {
        const unopened = open(path, { fileMustExist: true, timeout: 0 })
        expect(() => unopened.close()).not.toThrow()
        contender = open(path, { fileMustExist: true, timeout: 0 })
        expect(() => contender!.exec('BEGIN EXCLUSIVE')).toThrow(
          expect.objectContaining({ code: 'SQLITE_BUSY' }),
        )
        expect(() => contender!.prepare('SELECT id FROM records')).toThrow(
          expect.objectContaining({ code: 'SQLITE_BUSY' }),
        )
        expect(() => contender!.transaction(() => 'not-entered')).toThrow(
          expect.objectContaining({ code: 'SQLITE_BUSY' }),
        )
        expect(() => insert.run(2)).toThrow(expect.objectContaining({ code: 'SQLITE_BUSY' }))
        expect(() => select.get()).toThrow(expect.objectContaining({ code: 'SQLITE_BUSY' }))
        expect(() => select.all()).toThrow(expect.objectContaining({ code: 'SQLITE_BUSY' }))
        expect(database.transaction(() => insert.run(3))).toThrow(
          expect.objectContaining({ code: 'SQLITE_BUSY' }),
        )
      } finally {
        await held.release()
      }
      // The SAME contender survives failed first-use attempts, applies FULL, then acquires.
      expect(() => contender!.exec('BEGIN EXCLUSIVE')).not.toThrow()
      contender!.exec('ROLLBACK')
      expect(contender!.prepare('PRAGMA synchronous').get()).toMatchObject({ synchronous: 2 })
      expect(contender!.prepare('PRAGMA busy_timeout').get()).toMatchObject({ timeout: 0 })
      expect(contender!.prepare('PRAGMA journal_mode').get()).toMatchObject({
        journal_mode: 'delete',
      })
      database.transaction(() => insert.run(4))()
      expect(select.all()).toEqual([{ id: 1 }, { id: 4 }])
    } finally {
      contender?.close()
      database.close()
    }
  })
})

describe('public bootstrap with the standalone SQLite contract substitution', () => {
  it.each(['fresh', 'legacy', 'history'] as const)(
    'opens %s public lifecycle state and attaches the real person client with this backend',
    async (kind) => {
      vi.stubGlobal('fetch', () => {
        throw new Error('Unexpected network in fictional standalone bootstrap')
      })
      const scratch = await folder(),
        root = join(scratch, 'p'),
        workspaceRoot = join(scratch, 'w')
      await mkdir(workspaceRoot)
      const operations = kind === 'fresh' ? [] : await seedSqliteHistory(root, workspaceRoot, kind)
      const catalogue = {
        bytes: Buffer.from('{"format":3,"entries":[]}'),
        signature: Buffer.alloc(0),
      }
      const cataloguePath = join(scratch, 'catalogue.json'),
        personKey = 'a'.repeat(64),
        catalogueSha256 = createHash('sha256').update(catalogue.bytes).digest('hex')
      await writeFile(cataloguePath, catalogue.bytes, { flag: 'wx', mode: 0o600 })
      const owner = await PluginSupervisor.start({ root, workspaceRoots: [workspaceRoot] })
      let lease: PluginWorkspaceLease | undefined
      let settings: Awaited<ReturnType<typeof connectPluginSettings>> | undefined
      let service: Awaited<ReturnType<typeof bootstrapPluginLifecycle>> | undefined
      try {
        lease = await PluginWorkspaceLease.attach({
          root,
          workspaceRoot,
          generation: randomUUID(),
          build: 'fictional-standalone-sqlite',
        })
        service = await bootstrapPluginLifecycle({
          root,
          workspaceRoots: [workspaceRoot],
          owner,
          // An empty catalogue cannot start a package. Only the unused host boundary is inert.
          host: {} as Parameters<typeof bootstrapPluginLifecycle>[0]['host'],
          plan: {
            source: 'repo-list',
            appVersion: '1.0.0',
            catalogue: cataloguePath,
            catalogueSha256,
            personKey,
            names: {},
          },
        })
        settings = await connectPluginSettings({
          path: service.path,
          personKey,
          root,
          pinnedPublicKey: null,
          repoCatalogueSha256: catalogueSha256,
          target: { os: 'darwin', cpu: 'arm64' },
          appVersion: '1.0.0',
          catalogue,
          projection: {
            workspaceId: pluginWorkspaceIdentity(workspaceRoot),
            applied: async () => {},
            revoke: async () => true,
            reconcile: async () => {},
          },
          download: async () => {
            throw new Error('Unexpected download in fictional standalone bootstrap')
          },
        })
        expect(settings.host).toBeDefined()
        expect(await settings.catalogue()).toEqual([])
        expect(
          JSON.parse(await readFile(join(root, 'state/installed-state.json'), 'utf8')),
        ).toMatchObject({ format: 2, active: [], pending: null })
        expect(owner.acceptsStarts()).toBe(true)
      } finally {
        await settings?.close()
        await service?.close()
        lease?.abandon()
        await owner.shutdown()
        await owner.closed
      }
      const reopened = GlobalPluginState.open({
        root: join(root, 'state'),
        workspaceRoots: [workspaceRoot],
      })
      try {
        expect(reopened.exportActivation().entries).toEqual([])
        expect(reopened.inspect().pending).toBeNull()
        for (const operation of operations)
          expect(reopened.operation(operation.operation.request.operationId)).toEqual(operation)
        const closedHistory = reopened.inspect()
        reopened.close()
        expect(closedHistory.operations).toEqual(operations)
      } finally {
        reopened.close()
      }
    },
  )

  it('keeps real node-host retirement pending until a separate process releases the slot', async () => {
    const root = join(await folder(), 'host'),
      slots = join(root, 'process-slots'),
      data = join(root, 'data/fictional-kite')
    await mkdir(slots, { recursive: true, mode: 0o700 })
    await mkdir(data, { recursive: true, mode: 0o700 })
    const opaque = join(data, 'opaque.bin')
    await writeFile(opaque, Buffer.from([0, 255, 7]))
    const slot = join(slots, 'fictional-kite.sqlite'),
      seed = openStandalone(slot)
    seed.close()
    const held = await holdPluginSqlite(slot, children)
    const host = createPluginNodeHost({
      root,
      runtime: {} as Parameters<typeof createPluginNodeHost>[0]['runtime'],
    })
    let finished = false,
      released = false
    const retiring = host.removeData('fictional-kite').finally(() => {
      finished = true
    })
    void retiring.catch(() => {})
    try {
      await new Promise((resolve) => setTimeout(resolve, 60))
      expect(finished).toBe(false)
      expect(await readFile(opaque)).toEqual(Buffer.from([0, 255, 7]))
      await held.release()
      released = true
      await retiring
      expect(existsSync(data)).toBe(false)
    } finally {
      if (!released) await held.release()
      await retiring
      await host.stop()
    }
  })
})
