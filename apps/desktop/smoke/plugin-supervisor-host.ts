// Real durable entry + verified Chrome, with fictional stored profiles and an inert browser.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, copyFile, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { PluginFence } from '../src/main/plugins/state/fence'
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import {
  PluginWorkspaceLease,
  pluginWorkspaceIdentity,
} from '../src/main/plugins/supervisor/client'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import { createPluginSupervisorLauncher } from '../src/main/plugins/supervisor/launcher'
import {
  PLUGIN_HOST_SCRIPTS,
  preparePluginNodeRuntime,
  runtimeFiles,
} from '../src/main/plugins/node-runtime'
import { privateChild } from '../src/main/plugins/node-host-files'
import { liveGroupMembers } from '../resources/plugin-host/process-groups.mjs'
import { verifyChromeUiArchive } from './chrome-ui-archive'
import { catalogueBytes } from '../test/plugin-package-fixtures'
import { pluginSha256 } from '../src/main/plugins/package-digests'

async function wait<T>(read: () => Promise<T>): Promise<T> {
  for (let i = 0; i < 300; i++) {
    try {
      return await read()
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  throw new Error('fictional-proof-timeout')
}
export async function proof(config: { root: string; resources: string; archive: string }) {
  await mkdir(config.root, { mode: 0o700 })
  const global = join(config.root, 'global'),
    workspace = join(config.root, 'workspace')
  await mkdir(workspace, { mode: 0o700 })
  const seed = await PluginSupervisor.start({ root: global, workspaceRoots: [workspace] })
  assert.equal(await seed.shutdown(), true)
  const resources = await privateChild(config.root, 'fictional-app')
  for (const [folder, names] of [
    ['plugin-node', ['node', 'runtime.json', 'LICENSE']],
    ['plugin-host', [...PLUGIN_HOST_SCRIPTS]],
    ['plugin-supervisor', ['entry.cjs']],
  ] as const) {
    const target = await privateChild(resources, folder)
    for (const name of names)
      await copyFile(join(config.resources, folder, name), join(target, name))
  }
  const runtime = await preparePluginNodeRuntime({
    resourcesRoot: resources,
    durableRoot: join(global, 'runtimes'),
  })
  const { node } = await runtimeFiles(runtime)
  const browser = join(global, 'fake-browser')
  await writeFile(
    browser,
    `#!${node}\nimport fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';\nconst child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});\nfs.writeFileSync(path.join(process.env.BROCREW_CHROME_DATA,'fake-browser.json'),JSON.stringify({pid:process.pid,child:child.pid,serverPid:process.ppid}));\nprocess.on('SIGTERM',()=>{});setInterval(()=>{},1000);\n`,
    { mode: 0o700 },
  )
  const home = await privateChild(global, 'host/data/chrome')
  await privateChild(home, 'profiles/fir')
  await writeFile(
    join(home, 'profiles.json'),
    JSON.stringify({ profiles: [{ name: 'fir', enabled: true, temporary: false }] }),
    { mode: 0o600 },
  )
  await writeFile(
    join(home, 'restore.json'),
    JSON.stringify({
      savedAt: new Date().toISOString(),
      profiles: [{ name: 'fir', urls: ['https://example.invalid/fictional'] }],
    }),
    { mode: 0o600 },
  )
  const checked = verifyChromeUiArchive(await readFile(config.archive))
  const catalogue = catalogueBytes({ format: 1, entries: [checked.release] })
  const cataloguePath = join(global, 'fictional-catalogue.json')
  await writeFile(cataloguePath, catalogue.bytes, { mode: 0o600 })
  const fixtureSource = await privateChild(global, 'fixture-release')
  const archives = await privateChild(fixtureSource, 'archives')
  await writeFile(
    join(archives, checked.release.archive.sha256 + '.tar'),
    await readFile(config.archive),
    { mode: 0o600 },
  )
  const personKey = 'd'.repeat(64)
  const launch = createPluginSupervisorLauncher({
    root: global,
    workspaceRoots: [workspace],
    resourcesRoot: resources,
    browserExecutable: browser,
    lifecycle: {
      source: 'repo-list',
      catalogue: cataloguePath,
      catalogueSha256: pluginSha256(catalogue.bytes),
      fixtureSource,
      names: { chrome: 'Chrome' },
      personKey,
    },
  })
  const lock = join(global, 'supervisor/owner-lock.sqlite')
  const fence = PluginFence.acquire(lock)
  try {
    await fence.async({}, async () => {
      await assert.rejects(launch(), (error) => (error as { code?: string }).code === 'unavailable')
    })
  } finally {
    fence.release()
  }
  let lease: PluginWorkspaceLease | undefined,
    secondLease: PluginWorkspaceLease | undefined,
    client: Awaited<ReturnType<typeof connectPluginSettings>> | undefined,
    servicePid: number | undefined
  try {
    lease = await PluginWorkspaceLease.attach({
      root: global,
      workspaceRoot: workspace,
      generation: randomUUID(),
      build: 'fictional',
      launch: async () => {
        await launch()
        // App replacement before the first lease cannot invalidate durable entry/Node bytes.
        await rm(resources, { recursive: true })
      },
    })
    const directories = (await readdir(join(global, 'supervisor-launches'))).map((name) =>
      join(global, 'supervisor-launches', name),
    )
    const service = await wait(async () => {
      for (const path of directories) {
        try {
          const service = JSON.parse(await readFile(join(path, 'service.json'), 'utf8'))
          assert.equal(JSON.parse(await readFile(join(path, 'lifecycle.json'), 'utf8')).ready, true)
          return service
        } catch {
          /* Only a started entry supplies these private receipts. */
        }
      }
      throw new Error('not-ready')
    })
    servicePid = service.pid
    assert.notEqual(servicePid, process.pid)
    client = await connectPluginSettings({
      path: join(global, 'person-control/person.sock'),
      personKey,
      root: global,
      target: { os: process.platform as 'darwin' | 'linux', cpu: process.arch as 'arm64' | 'x64' },
      catalogue,
      projection: {
        workspaceId: pluginWorkspaceIdentity(workspace),
        applied: async () => {},
        revoke: async () => true,
        reconcile: async () => {},
      },
      propose() {
        throw new Error('no Apply in this supervisor proof')
      },
      download: async () => {
        throw new Error('Unexpected network download in fictional supervisor proof')
      },
    })
    await client.install('chrome')
    const contender = PluginFence.acquire(lock)
    try {
      assert.throws(
        () => contender.sync({}, () => true),
        (error) => (error as { code?: string }).code === 'busy',
      )
    } finally {
      contender.release()
    }
    await assert.rejects(
      PluginSupervisor.start({ root: global, workspaceRoots: [] }),
      (error) => (error as { code?: string }).code === 'busy',
    )
    const ids = await wait(
      async () =>
        JSON.parse(await readFile(join(home, 'fake-browser.json'), 'utf8')) as {
          pid: number
          child: number
          serverPid: number
        },
    )
    const serverPid = ids.serverPid
    assert.ok(Number.isSafeInteger(serverPid) && serverPid > 1)
    const runNames = await readdir(join(global, 'host/runs'))
    assert.equal(runNames.length, 1)
    const runId = runNames[0]!
    const receiptPath = join(global, 'host/runs', runId, 'exit.json')
    const members = await liveGroupMembers(serverPid)
    assert.ok(members.includes(ids.pid))
    assert.ok(members.includes(ids.child))
    const secondWorkspace = await privateChild(config.root, 'second-workspace')
    let relaunched = false
    secondLease = await PluginWorkspaceLease.attach({
      root: global,
      workspaceRoot: secondWorkspace,
      generation: randomUUID(),
      build: 'fictional',
      launch: async () => {
        relaunched = true
        throw new Error('must reuse incumbent')
      },
    })
    assert.equal(relaunched, false)
    assert.equal(await lease.close(), true)
    await secondLease.renew()
    assert.ok((await liveGroupMembers(serverPid)).includes(ids.pid))
    await client.close()
    client = undefined
    assert.equal(await secondLease.close(), true)
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
    assert.equal(receipt.exited, true)
    assert.equal(receipt.runId, runId)
    assert.equal(receipt.pluginId, 'chrome')
    assert.equal(receipt.releaseDigest, checked.release.archive.sha256)
    assert.deepEqual(await liveGroupMembers(serverPid), [])
    assert.equal(
      JSON.parse(await readFile(join(global, 'supervisor/owner.json'), 'utf8')).phase,
      'stopped',
    )
    const db = new Database(lock, { timeout: 0, fileMustExist: true })
    try {
      assert.equal(db.pragma('journal_mode', { simple: true }), 'delete')
      assert.equal(db.pragma('synchronous', { simple: true }), 2)
    } finally {
      db.close()
    }
    await wait(async () => {
      assert.throws(() => process.kill(servicePid!, 0))
      return true
    })
    return {
      passed: true,
      assertions: 23,
      realPackage: true,
      fakeBrowser: true,
      durableEntry: true,
      unsignedLifecycle: true,
      settingsInstall: true,
      appReplaced: true,
      sqliteMutualExclusion: true,
      incumbentReused: true,
      firstLeasePreserved: true,
      rollbackJournal: true,
      leaseEnded: true,
      exactRunProof: true,
      descendantsExited: true,
      supervisorExited: true,
    }
  } finally {
    await client?.close().catch(() => undefined)
    await lease?.close()
    await secondLease?.close()
  }
}
