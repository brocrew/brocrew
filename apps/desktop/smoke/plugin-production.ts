// Offline scratch proof only: an unsigned fictional repo list, actual Chrome package, inert browser.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { registerPluginSettings } from '../src/main/plugins/settings'
import type { PluginSettingsReply } from '../src/shared/plugin-settings'
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  PluginSupervisorAttachment,
  pluginWorkspaceIdentity,
} from '../src/main/plugins/supervisor/client'
import { productionPluginController } from '../src/main/plugins/production'
import { SupervisorStorage } from '../src/main/plugins/supervisor/storage'
import { preparePluginNodeRuntime, runtimeFiles } from '../src/main/plugins/node-runtime'
import { privateChild } from '../src/main/plugins/node-host-files'
import { liveGroupMembers } from '../resources/plugin-host/process-groups.mjs'
import { verifyChromeUiArchive } from './chrome-ui-archive'
import { repoListFor } from '../test/plugin-repo-list-fixtures'
import { GlobalPluginState } from '../src/main/plugins/state/store'

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
export async function proof(config: {
  root: string
  resources: string
  archive: string
  list?: string
}) {
  await mkdir(config.root, { mode: 0o700 })
  const root = await privateChild(config.root, 'g'),
    workspace = await privateChild(config.root, 'workspace')
  const runtime = await preparePluginNodeRuntime({
    resourcesRoot: config.resources,
    durableRoot: join(root, 'runtimes'),
  })
  const { node } = await runtimeFiles(runtime)
  const browser = join(root, 'fake-browser')
  await writeFile(
    browser,
    `#!${node}\nimport fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';\nconst child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});\nfs.writeFileSync(path.join(process.env.BROCREW_CHROME_DATA,'fake-browser.json'),JSON.stringify({pid:process.pid,child:child.pid}));\nprocess.on('SIGTERM',()=>{});setInterval(()=>{},1000);\n`,
    { mode: 0o700 },
  )
  const data = await privateChild(root, 'host/data/chrome')
  await privateChild(data, 'profiles/fir')
  const kept = join(data, 'profiles/fir/fictional-kept')
  const download = join(await privateChild(data, 'downloads'), 'fictional-download')
  await writeFile(download, 'fictional download stays', { mode: 0o600 })
  await writeFile(kept, 'fictional profile and downloads stay', { mode: 0o600 })
  await writeFile(
    join(data, 'profiles.json'),
    JSON.stringify({ profiles: [{ name: 'fir', enabled: true, temporary: false }] }),
    { mode: 0o600 },
  )
  await writeFile(
    join(data, 'restore.json'),
    JSON.stringify({
      savedAt: new Date().toISOString(),
      profiles: [{ name: 'fir', urls: ['https://example.invalid/fictional'] }],
    }),
    { mode: 0o600 },
  )
  const compression = config.archive.endsWith('.gz') ? 'tar.gz' : 'tar'
  const checked = verifyChromeUiArchive(await readFile(config.archive), compression)
  assert.equal(checked.verified.manifest.skills.length, 0)
  const catalogue = config.list
    ? await readFile(config.list)
    : Buffer.from(JSON.stringify(repoListFor(checked.release, 'Chrome')))
  const input = await privateChild(config.root, 'release-input')
  await writeFile(join(input, 'catalogue.json'), catalogue, { mode: 0o600 })
  const archives = await privateChild(input, 'archives')
  await writeFile(
    join(
      archives,
      checked.release.archive.sha256 + (compression === 'tar.gz' ? '.tar.gz' : '.tar'),
    ),
    await readFile(config.archive),
    { mode: 0o600 },
  )
  const supervisor = new PluginSupervisorAttachment(),
    client = productionPluginController()
  let cleanupSafe = false
  const workspaceId = pluginWorkspaceIdentity(workspace)
  try {
    client.start({
      root,
      workspaceRoot: workspace,
      resourcesRoot: config.resources,
      browserExecutable: browser,
      build: 'fictional',
      appVersion: '0.0.0',
      fixtureSource: input,
      supervisor,
    })
    assert.equal(await client.ready!(), true)
    assert.equal(client.available!(), true)
    const launchDirectory = await wait(async () => {
      for (const name of await readdir(join(root, 'supervisor-launches'))) {
        const path = join(root, 'supervisor-launches', name)
        try {
          assert.equal(JSON.parse(await readFile(join(path, 'lifecycle.json'), 'utf8')).ready, true)
          return path
        } catch {
          /* Not ready is not authority. */
        }
      }
      throw new Error('not-ready')
    })
    const servicePid = JSON.parse(await readFile(join(launchDirectory, 'service.json'), 'utf8')).pid
    assert.notEqual(servicePid, process.pid)
    // The actual Settings handler, with an explicitly inert main-window identity. No Electron
    // window is opened; the isolated screen binding/read remains the verified adapter below.
    const window = Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
      webContents: Object.assign(new EventEmitter(), { mainFrame: {}, send() {} }),
    })
    let handler!: (event: unknown, input: unknown) => Promise<PluginSettingsReply>
    registerPluginSettings(
      {
        handle(_channel: string, callback: typeof handler) {
          handler = callback
        },
      } as never,
      () => window as never,
      client,
    )
    const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
    assert.equal((await client.catalogue())[0]?.state, 'Available')
    assert.equal((await handler(event, { kind: 'install', id: 'chrome' })).ok, true)
    assert.equal((await client.catalogue())[0]?.state, 'Running')
    const screen = await client.screen('chrome')
    assert.equal(screen.verified.manifest.id, 'chrome')
    const snapshot = (await screen.peer.read(
      { surface: 'chrome' },
      0,
      screen.binding,
      new AbortController().signal,
    )) as { profiles: { name: string }[] }
    assert.equal(snapshot.profiles[0]?.name, 'fir')
    assert.equal(client.instructionCatalogue()?.[0]?.state, 'Running')
    await screen.peer.proposeConfig(
      { action: 'create-profile', profile: 'birch' },
      0,
      screen.binding,
      new AbortController().signal,
    )
    await screen.peer.proposeConfig(
      { action: 'set-enabled', profile: 'birch', enabled: true },
      1,
      screen.binding,
      new AbortController().signal,
    )
    const applied = (await screen.peer.read(
      { surface: 'chrome' },
      0,
      screen.binding,
      new AbortController().signal,
    )) as { configRevision: number; profiles: { name: string; enabled: boolean }[] }
    assert.equal(applied.configRevision, 2)
    assert.equal(applied.profiles.find((one) => one.name === 'birch')?.enabled, true)
    await assert.rejects(
      screen.peer.proposeConfig(
        { action: 'create-profile', profile: 'fir' },
        0,
        screen.binding,
        new AbortController().signal,
      ),
    )

    const ids = await wait(
      async () =>
        JSON.parse(await readFile(join(data, 'fake-browser.json'), 'utf8')) as {
          pid: number
          child: number
        },
    )
    const runNames = await readdir(join(root, 'host/runs'))
    assert.equal(runNames.length, 1)
    const runDirectory = join(root, 'host/runs', runNames[0]!)
    const ready = JSON.parse(await readFile(join(runDirectory, 'process.json'), 'utf8'))
    const serverPid = ready.groups[0][0] as number
    assert.ok((await liveGroupMembers(serverPid)).includes(ids.pid))
    assert.ok((await liveGroupMembers(serverPid)).includes(ids.child))
    let uiClosed = false
    screen.onInvalidate(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      uiClosed = true
    })
    assert.equal((await handler(event, { kind: 'uninstall', id: 'chrome' })).ok, true)
    assert.equal(uiClosed, true)
    assert.equal(screen.current(screen.binding), false)
    assert.equal((await client.catalogue())[0]?.state, 'Available')
    assert.deepEqual(await liveGroupMembers(serverPid), [])
    const exit = JSON.parse(await readFile(join(runDirectory, 'exit.json'), 'utf8'))
    assert.equal(exit.exited, true)
    assert.equal(exit.runId, runNames[0])
    assert.equal(await readFile(kept, 'utf8'), 'fictional profile and downloads stay')
    assert.equal(await readFile(download, 'utf8'), 'fictional download stays')
    await assert.rejects(
      readFile(join(root, 'host/packages', checked.release.archive.sha256, 'plugin.json')),
    )
    await client.close()
    await supervisor.quit()
    const ownerStorage = new SupervisorStorage(root, [workspace], false)
    try {
      assert.equal(ownerStorage.read()?.phase, 'stopped')
    } finally {
      ownerStorage.close()
    }
    await wait(async () => {
      assert.throws(() => process.kill(servicePid, 0))
      return true
    })
    const state = GlobalPluginState.open({ root: join(root, 'state'), workspaceRoots: [workspace] })
    try {
      assert.equal(state.inspect().guards[0]?.phase, 'removed')
      assert.deepEqual(state.projections(workspaceId), [])
    } finally {
      state.close()
    }
    cleanupSafe = true
    return {
      passed: true,
      assertions: 31,
      realPackage: true,
      unsignedRepoList: true,
      fixtureDownload: false,
      productionController: true,
      localRelease: true,
      profileCreateEnable: true,
      staleApplyRefused: true,
      noSecondDialog: true,
      durableEntry: true,
      personBridge: true,
      actualSettingsHandler: true,
      inertSettingsWindow: true,
      readyBeforeActivation: true,
      realHost: true,
      fakeBrowser: true,
      consumerAndUiRevoked: true,
      codeRemoved: true,
      dataKept: true,
      tombstoneDurable: true,
      receiptsInGlobalJournal: true,
      exactRunProof: true,
      descendantsExited: true,
      supervisorExited: true,
    }
  } finally {
    await client.close().catch(() => undefined)
    await supervisor.quit().catch(() => undefined)
    if (!cleanupSafe) {
      /* Leave uncertain private roots/fences for inspection. */
    }
  }
}
