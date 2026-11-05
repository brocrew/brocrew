// Source-side fixture setup and observations; every owner is the separate frozen production entry.
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { GlobalPluginState } from '../src/main/plugins/state/store'
import { LifecycleEffects } from '../src/main/plugins/lifecycle/files'
import { createPluginSupervisorLauncher } from '../src/main/plugins/supervisor/launcher'
import {
  PluginWorkspaceLease,
  pluginWorkspaceIdentity,
} from '../src/main/plugins/supervisor/client'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import { pluginStartupDiagnostic } from '../src/main/plugins/startup-failure'
import { openPluginSqlite } from '../src/main/plugins/sqlite-contract'
import type { SpawnRecord } from './frozen-supervisor-witness'

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

/** Real state API writes two aborted fictional installs: no selected package can start or replay. */
export async function seedSqliteHistory(
  root: string,
  workspace: string,
  kind: 'legacy' | 'history',
) {
  await mkdir(root, { recursive: true, mode: 0o700 })
  const state = GlobalPluginState.open({ root: join(root, 'state'), workspaceRoots: [workspace] })
  const operations = []
  try {
    const effects = await LifecycleEffects.open(root, true)
    for (const at of [0, 1]) {
      const operationId = randomUUID(),
        before = state.inspect()
      const operation = state.prepare({
        operationId,
        snapshot: null,
        consent: {
          action: 'install',
          pluginId: 'fictional-kite',
          at,
          expectedSequence: before.sequence,
          expectedInstallId: before.guards[0]?.installId ?? null,
          release: {
            version: `${at + 1}.0.0`,
            archiveSha256: 'b'.repeat(64),
            manifestSha256: 'c'.repeat(64),
            dataSchema: 1,
          },
        },
      })
      state.abort(operationId)
      await effects.write({
        format: 1,
        operationId,
        pluginId: 'fictional-kite',
        installId: operation.next!.installId,
        action: 'install',
        phase: 'aborted',
        offlineCleanup: true,
        compensates: null,
      })
      operations.push(state.operation(operationId)!)
    }
  } finally {
    state.close()
  }
  if (kind === 'legacy') {
    // Keep the original archive as evidence; reclaim must import the compact saved snapshot.
    await rename(join(root, 'state/operations.sqlite'), join(root, 'seed-history.sqlite'))
    return operations.slice(-1)
  }
  return operations
}

async function bounded<T>(work: Promise<T>, label: string, limit = 35_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`sqlite-bootstrap-deadline: ${label}; root retained`)),
          limit,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
async function wait<T>(work: () => Promise<T>): Promise<T> {
  const until = performance.now() + 30_000
  let last: unknown
  do {
    try {
      return await work()
    } catch (error) {
      last = error
    }
    await new Promise((resolve) => setTimeout(resolve, 30))
  } while (performance.now() < until)
  throw new Error('sqlite-bootstrap-timeout', { cause: last })
}

export async function sqliteBootstrapCases(options: {
  root: string
  resources: string
  entryHash: string
  spawns: SpawnRecord[]
}) {
  const proofs = []
  for (const kind of ['fresh', 'legacy', 'history'] as const) {
    const directory = join(options.root, 'sql', kind),
      root = join(directory, 'p'),
      workspace = join(directory, 'w')
    await mkdir(workspace, { recursive: true, mode: 0o700 })
    const operations = kind === 'fresh' ? [] : await seedSqliteHistory(root, workspace, kind)
    const opaque = join(directory, 'opaque.bin'),
      opaqueBytes = Buffer.from([0, 255, 8, 3])
    await writeFile(opaque, opaqueBytes, { flag: 'wx', mode: 0o600 })
    const catalogue = {
        bytes: Buffer.from('{"format":3,"entries":[]}'),
        signature: Buffer.alloc(0),
      },
      cataloguePath = join(directory, 'catalogue.json'),
      personKey = 'a'.repeat(64)
    await writeFile(cataloguePath, catalogue.bytes, { flag: 'wx', mode: 0o600 })
    const launch = createPluginSupervisorLauncher({
      root,
      workspaceRoots: [workspace],
      resourcesRoot: options.resources,
      lifecycle: {
        source: 'repo-list',
        appVersion: '1.0.0',
        catalogue: cataloguePath,
        catalogueSha256: sha(catalogue.bytes),
        personKey,
        names: {},
      },
    })
    const firstSpawn = options.spawns.length
    let lease: PluginWorkspaceLease | undefined
    let settings: Awaited<ReturnType<typeof connectPluginSettings>> | undefined
    try {
      lease = await PluginWorkspaceLease.attach({
        root,
        workspaceRoot: workspace,
        generation: randomUUID(),
        build: `sqlite-${kind}`,
        launch,
      })
      try {
        settings = await wait(() =>
          connectPluginSettings({
            path: join(root, 'person-control/person.sock'),
            personKey,
            root,
            pinnedPublicKey: null,
            repoCatalogueSha256: sha(catalogue.bytes),
            target: { os: 'darwin', cpu: 'arm64' },
            appVersion: '1.0.0',
            catalogue,
            projection: {
              workspaceId: pluginWorkspaceIdentity(workspace),
              applied: async () => {},
              revoke: async () => true,
              reconcile: async () => {},
            },
            download: async () => {
              throw new Error('Unexpected bootstrap download')
            },
          }),
        )
      } catch (error) {
        // The timeout stays unchanged; preserve the launcher's real bounded stderr as its cause.
        throw Object.assign(
          new Error(`sqlite-${kind} person attachment failed`, { cause: error }),
          {
            launchDiagnostic: pluginStartupDiagnostic(launch.diagnostic(error)) ?? null,
          },
        )
      }
      const record = JSON.parse(await readFile(join(root, 'supervisor/owner.json'), 'utf8'))
      assert.equal(record.phase, 'accepting')
      assert.equal(record.epoch, lease.epoch)
      assert.ok(settings.host)
      assert.deepEqual(await settings.catalogue(), [])
      const owner = options.spawns[firstSpawn]!
      assert.equal(owner.argv[0], join(root, 'supervisor-entries', options.entryHash, 'entry.cjs'))
      await assert.rejects(launch())
      assert.match(String(pluginStartupDiagnostic(launch.diagnostic())?.stderr), /Plugin busy/)
      assert.equal(options.spawns.length, firstSpawn + 2)
      assert.equal(
        (await bounded(options.spawns[firstSpawn + 1]!.exited, `${kind} busy exit`)).code,
        1,
      )
      await settings.close()
      settings = undefined
      assert.equal(await lease.close(), true)
      lease = undefined
      assert.equal((await bounded(owner.exited, `${kind} owner exit`)).code, 0)
      // Observe the BUILT owner's output before any source state open can reclaim/import it.
      const archivePath = join(root, 'state/operations.sqlite'),
        snapshotPath = join(root, 'state/installed-state.json')
      const archiveBytes = await readFile(archivePath),
        snapshotBytes = await readFile(snapshotPath)
      const archive = openPluginSqlite(archivePath, {
        readonly: true,
        fileMustExist: true,
        timeout: 0,
      })
      let archiveRows
      try {
        archiveRows = archive
          .prepare('SELECT id, status, value FROM operations ORDER BY sequence, id')
          .all()
          .map((row) => {
            assert.ok(typeof row.value === 'string')
            return { id: row.id, status: row.status, value: JSON.parse(row.value) }
          })
        assert.deepEqual(
          archiveRows,
          operations.map((operation) => ({
            id: operation.operation.request.operationId,
            status: operation.status,
            value: operation,
          })),
        )
      } finally {
        archive.close()
      }
      assert.deepEqual(
        await readFile(archivePath),
        archiveBytes,
        'Readonly archive observation changed owner output',
      )
      assert.deepEqual(
        await readFile(snapshotPath),
        snapshotBytes,
        'Readonly observation changed owner snapshot',
      )
      const snapshot = JSON.parse(snapshotBytes.toString('utf8'))
      assert.equal(snapshot.format, 2)
      assert.equal(snapshot.pending, null)
      assert.deepEqual(snapshot.active, [])
      assert.deepEqual(snapshot.recentOperations, operations.slice(-1))
      // These are separate API/reopen controls, after the immutable owner-output assertions.
      const state = GlobalPluginState.open({
        root: join(root, 'state'),
        workspaceRoots: [workspace],
      })
      let history: ReturnType<GlobalPluginState['inspect']>
      try {
        for (const operation of operations)
          assert.deepEqual(state.operation(operation.operation.request.operationId), operation)
        history = state.inspect()
        assert.deepEqual(state.exportActivation().entries, [])
      } finally {
        state.close()
      }
      // Closed-state history takes the readonly/existing-only factory path.
      assert.deepEqual(history.operations, operations)
      assert.deepEqual(await readFile(opaque), opaqueBytes)
      proofs.push({
        kind,
        root,
        epoch: record.epoch,
        personAnswered: true,
        accepting: true,
        operationIds: operations.map((operation) => operation.operation.request.operationId),
        historyCount: operations.length,
        archiveObservedBeforeReopen: true,
        archiveSha256BeforeReopen: sha(archiveBytes),
        archiveRows,
        secondLaunchBusy: true,
        ownerExitCode: owner.child.exitCode,
        spawnRange: [firstSpawn, options.spawns.length],
      })
    } finally {
      if (settings) await bounded(settings.close(), `${kind} failure person close`).catch(() => {})
      if (lease) await bounded(lease.close(), `${kind} failure lease close`).catch(() => {})
      // Every fictional input, archive and failed-process handle is retained.
    }
  }
  return proofs
}
