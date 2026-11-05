import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import SupervisorDatabase from '../src/main/plugins/supervisor/sqlite-adapter'
import { GlobalPluginState } from '../src/main/plugins/state/store'
import { bootstrapPluginLifecycle } from '../src/main/plugins/lifecycle/bootstrap'
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import {
  PluginWorkspaceLease,
  pluginWorkspaceIdentity,
} from '../src/main/plugins/supervisor/client'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'

// Match the PRODUCTION standalone builder's replacement for every better-sqlite3 import.
// The adapter and node:sqlite remain real; neither method surface nor state recovery is mocked.
vi.mock('better-sqlite3', async () => ({
  default: (await import('../src/main/plugins/supervisor/sqlite-adapter')).default,
}))

const folders: string[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
})
async function folder() {
  const path = await realpath(
    await mkdtemp(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fs-')),
  )
  folders.push(path)
  return path
}

describe('standalone supervisor SQLite contract', () => {
  it('binds positional statements and reads the operation history after reopening', async () => {
    const path = join(await folder(), 'history.sqlite')
    let database = new SupervisorDatabase(path)
    try {
      database.exec('CREATE TABLE operations (id TEXT PRIMARY KEY, value TEXT NOT NULL)')
      const insert = database.prepare('INSERT INTO operations (id, value) VALUES (?, ?)')
      insert.run('fictional-one', '{"status":"committed"}')
      insert.run('fictional-two', '{"status":"aborted"}')
      expect(database.prepare('SELECT value FROM operations WHERE id = ?').get('absent'))
        .toBeUndefined()
      database.close()
      database = new SupervisorDatabase(path)
      expect(database.prepare('SELECT value FROM operations WHERE id = ?').get('fictional-one'))
        .toMatchObject({ value: '{"status":"committed"}' })
      expect(database.prepare('SELECT id FROM operations ORDER BY id').all()).toEqual([
        { id: 'fictional-one' },
        { id: 'fictional-two' },
      ])
    } finally {
      database.close()
    }
  })

  it('commits the whole callback and rolls back all writes on its original failure', async () => {
    const database = new SupervisorDatabase(join(await folder(), 'history.sqlite'))
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
      expect(interrupted).toThrow(failure)
      expect(database.prepare('SELECT id FROM operations ORDER BY id').all()).toEqual([
        { id: 'fictional-kept' },
      ])
      // A failure releases transaction ownership so a subsequent ordinary import can commit.
      expect(database.transaction(() => insert.run('fictional-after-failure'))).not.toThrow()
    } finally {
      database.close()
    }
  })

  it('preserves exclusive writer refusal and permits the successor after release', async () => {
    const path = join(await folder(), 'fence.sqlite')
    const owner = new SupervisorDatabase(path)
    const contender = new SupervisorDatabase(path)
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

  it('opens fresh public lifecycle state and attaches the real person client with this backend', async () => {
    vi.stubGlobal('fetch', () => {
      throw new Error('Unexpected network in fictional standalone bootstrap')
    })
    const scratch = await folder(),
      root = join(scratch, 'p'),
      workspaceRoot = join(scratch, 'w')
    await mkdir(workspaceRoot)
    const catalogue = { bytes: Buffer.from('{"format":3,"entries":[]}'), signature: Buffer.alloc(0) }
    const cataloguePath = join(scratch, 'catalogue.json'),
      personKey = 'a'.repeat(64),
      catalogueSha256 = createHash('sha256').update(catalogue.bytes).digest('hex')
    await writeFile(cataloguePath, catalogue.bytes, { flag: 'wx', mode: 0o600 })
    const owner = await PluginSupervisor.start({ root, workspaceRoots: [workspaceRoot] })
    let lease: PluginWorkspaceLease | undefined
    let settings: Awaited<ReturnType<typeof connectPluginSettings>> | undefined
    try {
      lease = await PluginWorkspaceLease.attach({
        root,
        workspaceRoot,
        generation: randomUUID(),
        build: 'fictional-standalone-sqlite',
      })
      const service = await bootstrapPluginLifecycle({
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
      expect(JSON.parse(await readFile(join(root, 'state/installed-state.json'), 'utf8')))
        .toMatchObject({ format: 2, active: [], pending: null })
      expect(owner.acceptsStarts()).toBe(true)
    } finally {
      await settings?.close()
      lease?.abandon()
      await owner.shutdown()
      await owner.closed
    }
    const reopened = GlobalPluginState.open({ root: join(root, 'state'), workspaceRoots: [workspaceRoot] })
    try {
      expect(reopened.exportActivation().entries).toEqual([])
      expect(reopened.inspect().pending).toBeNull()
    } finally {
      reopened.close()
    }
  })
})
