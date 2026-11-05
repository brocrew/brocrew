// Offline scratch proof only: a signed fictional catalogue, actual Chrome package, inert browser.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { registerPluginSettings } from '../src/main/plugins/settings'
import type { PluginSettingsReply } from '../src/shared/plugin-settings'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { PluginWorkspaceLease } from '../src/main/plugins/supervisor/client'
import { createPluginSupervisorLauncher } from '../src/main/plugins/supervisor/launcher'
import { preparePluginNodeRuntime, runtimeFiles } from '../src/main/plugins/node-runtime'
import { privateChild } from '../src/main/plugins/node-host-files'
import { liveGroupMembers } from '../resources/plugin-host/process-groups.mjs'
import { verifyOrdinaryChromeArchive } from './ordinary-chrome-archive'
import { fictionalPublicKey, signed } from '../test/plugin-package-fixtures'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import type { WorkspaceProjection } from '../src/main/plugins/lifecycle/types'
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
export async function proof(config: { root: string; resources: string; archive: string }) {
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
    `#!${node}\nimport fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';\nconst child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});\nfs.writeFileSync(path.join(process.env.BROCREW_PLUGIN_DATA,'fake-browser.json'),JSON.stringify({pid:process.pid,child:child.pid,serverPid:process.ppid}));\nprocess.on('SIGTERM',()=>{});setInterval(()=>{},1000);\n`,
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
  const checked = verifyOrdinaryChromeArchive(await readFile(config.archive))
  assert.equal(checked.verified.manifest.format, 3)
  const catalogue = signed({ format: 1, entries: [checked.release] })
  const cataloguePath = join(root, 'fictional-catalogue.json'),
    signaturePath = join(root, 'fictional-catalogue.sig')
  await writeFile(cataloguePath, catalogue.bytes, { mode: 0o600 })
  await writeFile(signaturePath, catalogue.signature, { mode: 0o600 })
  const personKey = 'd'.repeat(64)
  const launch = createPluginSupervisorLauncher({
    root,
    workspaceRoots: [workspace],
    resourcesRoot: config.resources,
    browserExecutable: browser,
    lifecycle: {
      publicKey: fictionalPublicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
      catalogue: cataloguePath,
      signature: signaturePath,
      personKey,
      downloads: [{ id: 'chrome', version: checked.release.version, archive: config.archive }],
    },
  })
  let lease: PluginWorkspaceLease | undefined,
    client: Awaited<ReturnType<typeof connectPluginSettings>> | undefined
  const previousExecutable = process.env.BROCREW_CHROME_EXECUTABLE
  process.env.BROCREW_CHROME_EXECUTABLE = browser
  let cleanupSafe = false
  const workspaceId = randomUUID(),
    events: string[] = []
  const projection: WorkspaceProjection = {
    workspaceId,
    async revoke() {
      events.push('revoke')
      return true
    },
    async applied() {
      events.push('applied')
    },
    async reconcile(change) {
      events.push(change.receipt ? 'bind' : 'clear')
    },
  }
  try {
    lease = await PluginWorkspaceLease.attach({
      root,
      workspaceRoot: workspace,
      generation: randomUUID(),
      build: 'fictional',
      launch,
    })
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
    client = await connectPluginSettings({
      path: join(root, 'person-control/person.sock'),
      personKey,
      root,
      pinnedPublicKey: fictionalPublicKey,
      target: { os: process.platform as 'darwin' | 'linux', cpu: process.arch as 'arm64' | 'x64' },
      catalogue,
      projection,
    })
    // The actual Settings handler, with an explicitly inert main-window identity. No Electron
    // window is opened; the verified page uses the real package MCP tools below.
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
    const inspection = await handler(event, { kind: 'inspect', source: config.archive })
    if (!inspection.ok || !('inspection' in inspection) || !inspection.inspection)
      throw new Error('Actual Settings package inspection failed')
    assert.equal(
      (await handler(event, { kind: 'install', id: 'chrome', package: inspection.inspection.ref }))
        .ok,
      true,
    )
    assert.equal((await client.catalogue())[0]?.state, 'Running')
    const screen = await client.screen('chrome')
    assert.equal(screen.verified.manifest.format, 3)
    assert.equal(screen.verified.manifest.id, 'chrome')
    const call = async (
      tool: string,
      args: import('../src/shared/plugin-contract').PluginJsonObject,
    ) => {
      const result = await screen.tools.callTool(
        tool,
        args,
        randomUUID(),
        new AbortController().signal,
      )
      assert.equal(result.status, 'result')
      if (result.status !== 'result') throw new Error('Actual package transport failed')
      return result.result
    }
    const read = async () => {
      const result = await call('configuration_snapshot', {})
      assert.notEqual(result.isError, true)
      const text = result.content.find(
        (value) =>
          value && typeof value === 'object' && !Array.isArray(value) && value.type === 'text',
      )
      if (!text || typeof text !== 'object' || Array.isArray(text) || typeof text.text !== 'string')
        throw new Error('Actual package snapshot missing')
      return JSON.parse(text.text) as { profiles: Array<{ name: string; enabled: boolean }> }
    }
    const snapshot = await read()
    assert.equal(
      snapshot.profiles.some((one) => one.name === 'fir'),
      true,
    )
    const ids = await wait(
      async () =>
        JSON.parse(await readFile(join(data, 'fake-browser.json'), 'utf8')) as {
          pid: number
          child: number
          serverPid: number
        },
    )
    const runNames = await readdir(join(root, 'host/runs'))
    assert.equal(runNames.length, 1)
    const runDirectory = join(root, 'host/runs', runNames[0]!)
    // The inert native executable records its exact OS parent. Generic format-3 runtime
    // exposes no retired HTTP process/admin receipt; positive group membership is checked below.
    const serverPid = ids.serverPid
    assert.ok(Number.isSafeInteger(serverPid) && serverPid > 1)
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
    client = undefined
    assert.equal(await lease.close(), true)
    lease = undefined
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
    assert.ok(events.includes('bind'))
    assert.ok(events.includes('revoke'))
    cleanupSafe = true
    return {
      passed: true,
      assertions: 27,
      realPackage: true,
      fictionalSignedCatalogue: true,
      fixtureDownload: true,
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
    if (previousExecutable === undefined) delete process.env.BROCREW_CHROME_EXECUTABLE
    else process.env.BROCREW_CHROME_EXECUTABLE = previousExecutable
    await client?.close().catch(() => undefined)
    const closed = await lease?.close().catch(() => false)
    if (!cleanupSafe && closed !== true) {
      /* Leave uncertain private roots/fences for inspection. */
    }
  }
}
