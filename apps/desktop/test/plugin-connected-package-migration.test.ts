import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { copyFile, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPluginNodeHost } from '../src/main/plugins/node-host'
import { preparePluginNodeRuntime } from '../src/main/plugins/node-runtime'
import { GlobalPluginState } from '../src/main/plugins/state/store'
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import { PluginWorkspaceLease } from '../src/main/plugins/supervisor/client'
import { PluginPackageVault } from '../src/main/plugins/lifecycle/vault'
import { createSupervisorLifecycle } from '../src/main/plugins/lifecycle/supervisor'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import { PluginPageTools } from '../src/main/plugins/ui/tool-rpc'
import { PLUGIN_PAGE_CHANNEL } from '../src/shared/plugin-page'
import type { PluginJsonObject, PluginToolCallResult } from '../src/shared/plugin-contract'
import type { WorkspaceProjection } from '../src/main/plugins/lifecycle/types'
import { pluginSha256 } from '../src/main/plugins/package-digests'
import { fictionalPublicKey, signed } from './plugin-package-fixtures'
import {
  historicalPackage,
  migrationPackages,
  packageBundleProvenance,
  type MigratedPackage,
} from './fixtures/connected-package-migration'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  try {
    for (const close of cleanups.splice(0).reverse()) await close()
  } finally {
    vi.restoreAllMocks()
  }
})
const priorOwner = {
  ownerId: '12345678-1234-5123-a123-123456789012',
  ownerLabel: 'the default workspaces',
}
const opaque = Buffer.from([0, 255, 17, 88, 128, 0, 3])
const group = '120363000000000001@g.us'
const target = {
  os: process.platform as 'darwin' | 'linux' | 'win32',
  cpu: process.arch as 'arm64' | 'x64',
}
interface CallAudit {
  pluginId: string
  runId: string
  calls: readonly (readonly unknown[])[]
}
interface ConnectedSession {
  service: Awaited<ReturnType<typeof createSupervisorLifecycle>>
  client: Awaited<ReturnType<typeof connectPluginSettings>>
  close(): Promise<void>
  pages: PluginPageTools[]
}
async function events(path: string): Promise<Record<string, unknown>[]> {
  return (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}
function jsonResult(answer: PluginToolCallResult): Record<string, unknown> {
  expect(answer.status).toBe('result')
  if (answer.status !== 'result') throw new Error(JSON.stringify(answer))
  expect(answer.result.isError).not.toBe(true)
  const text = answer.result.content.find(
    (part) => !!part && typeof part === 'object' && !Array.isArray(part) && part.type === 'text',
  )
  if (!text || typeof text !== 'object' || Array.isArray(text) || typeof text.text !== 'string')
    throw new Error('Expected the actual package JSON text result: ' + JSON.stringify(answer))
  return JSON.parse(text.text) as Record<string, unknown>
}
async function fixture(
  id: MigratedPackage,
  warning = false,
  boundary: 'conflicting' | 'numeric' = 'conflicting',
) {
  const parent = await realpath(
    await mkdtemp(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'connected-packages-')),
  )
  cleanups.push(() => rm(parent, { recursive: true, force: true }))
  const root = join(parent, 'installation')
  const appData = join(parent, 'app-data')
  const workspaceRoot = join(parent, 'workspace')
  const workspaceId = randomUUID()
  const home = join(root, 'host', 'data', id)
  const shared = join(appData, '@brobot2', 'shared', id)
  for (const dir of [root, appData, workspaceRoot, home, shared])
    await mkdir(dir, { recursive: true, mode: 0o700 })
  await writeFile(join(home, 'opaque-account.bin'), opaque)
  await writeFile(join(shared, 'opaque-shared.bin'), opaque)
  if (id === 'whatsapp') {
    await mkdir(join(home, 'bridge'))
    for (const name of ['session.db', 'messages.db', 'messages.db-wal', 'messages.db-shm'])
      await writeFile(join(home, 'bridge', name), opaque)
    await writeFile(
      join(home, 'settings.json'),
      JSON.stringify({ read: true, prefix: false, writable: [group] }) + '\n',
    )
    await writeFile(join(shared, 'fictional-phone.json'), JSON.stringify({ warning }))
  } else {
    await mkdir(join(home, 'profiles', 'fern', 'Default'), { recursive: true, mode: 0o700 })
    await writeFile(join(home, 'profiles', 'fern', 'Default', 'Cookies'), opaque)
    await writeFile(
      join(home, 'profiles.json'),
      JSON.stringify({
        defaults: 2,
        profiles: [
          {
            name: 'fern',
            displayName: 'Retained fictional fern',
            enabled: true,
            allowExtensions: false,
            allowSettings: false,
            allowSync: false,
            keepRunning: false,
            createdAt: '2026-01-01T00:00:00.000Z',
            createdBy: 'panel',
            description: 'Opaque old fictional profile',
            temporary: false,
            helper: 'off',
          },
        ],
      }) + '\n',
    )
  }
  const settingsBytes = id === 'whatsapp' ? await readFile(join(home, 'settings.json')) : undefined
  const packages = await migrationPackages(id, parent)
  for (const source of [
    'src/index.ts',
    'src/app.ts',
    'src/config.ts',
    'src/legacyConfiguration.ts',
  ])
    expect(packages.inputs.some((input) => input.endsWith(`plugins/${id}/${source}`))).toBe(true)
  expect(
    packages.inputs.some((input) =>
      input.endsWith(
        `plugins/${id}/src/${id === 'chrome' ? 'configuration.ts' : 'tools/configuration.ts'}`,
      ),
    ),
  ).toBe(true)
  expect(
    packages.inputs.some((input) =>
      input.endsWith(
        `plugins/${id}/src/${id === 'chrome' ? 'browser/chromeBrowser.ts' : 'bridge.ts'}`,
      ),
    ),
  ).toBe(false)
  const resources = join(parent, 'resources')
  await mkdir(join(resources, 'plugin-node'), { recursive: true })
  await copyFile(
    process.execPath,
    join(resources, 'plugin-node', process.platform === 'win32' ? 'node.exe' : 'node'),
  )
  await cp(new URL('../resources/plugin-host/', import.meta.url), join(resources, 'plugin-host'), {
    recursive: true,
  })
  const runtime = await preparePluginNodeRuntime({
    resourcesRoot: resources,
    durableRoot: join(parent, 'runtime'),
  })
  let state = GlobalPluginState.create({
    root: join(root, 'state'),
    workspaceRoots: [workspaceRoot],
  })
  let seeded = false
  let legacy: { directory: string; floor: string } | undefined
  let installId: string | undefined
  const oldFiles = new Map<string, Buffer>()
  const oldMtimes = new Map<string, bigint>()
  const audits: CallAudit[] = []
  const sessions: ConnectedSession[] = []
  // Seed at the real reservation boundary, before any package process exists. This callback
  // writes only fictional predecessor files; it does not fake readiness or alter an MCP result.
  function seedLegacy(point: string) {
    if (point !== 'prepared' || seeded) return
    const next = state.inspect().pending?.next
    if (!next || next.pluginId !== id) throw new Error('Expected a real installation reservation')
    seeded = true
    installId = next.installId
    legacy = {
      directory: join(root, 'profile-apply', pluginSha256(Buffer.from(installId))),
      floor: join(root, 'profile-apply', installId + '.floor'),
    }
    mkdirSync(join(legacy.directory, 'intents'), { recursive: true })
    const checkpoint = Buffer.from(
      JSON.stringify({ format: 2, installId, revision: 40, previous: 'b'.repeat(64) }) + '\n',
    )
    oldFiles.set(join(legacy.directory, 'birth'), Buffer.from(installId))
    oldFiles.set(legacy.floor, boundary === 'numeric' ? Buffer.from('9000\n') : checkpoint)
    oldFiles.set(
      join(legacy.directory, 'checkpoint.json'),
      Buffer.from(
        JSON.stringify({ format: 2, installId, revision: 40, previous: 'c'.repeat(64) }) + '\n',
      ),
    )
    // A reserved old action is consumed metadata, even when its command body cannot be parsed.
    oldFiles.set(
      join(legacy.directory, 'intents', '0000000000000041.json'),
      Buffer.from('{opaque consumed unlink/delete/open command: not JSON'),
    )
    oldFiles.set(
      join(legacy.directory, 'intents', '.new-fictional'),
      Buffer.from('unpublished action'),
    )
    for (const [path, bytes] of oldFiles) {
      writeFileSync(path, bytes)
      oldMtimes.set(path, statSync(path, { bigint: true }).mtimeNs)
    }
  }
  async function start(): Promise<ConnectedSession> {
    const owner = await PluginSupervisor.start({ root, workspaceRoots: [workspaceRoot] })
    const emergency: { close?: () => Promise<void> } = {}
    cleanups.push(async () => {
      if (emergency.close) await emergency.close()
      else await owner.shutdown()
    })
    const lease = await PluginWorkspaceLease.attach({
      root,
      workspaceRoot,
      generation: randomUUID(),
      build: 'fictional-connected-package',
    })
    const physical = createPluginNodeHost({
      root: join(root, 'host'),
      runtime,
      sharedDataOwner: { appData, ...priorOwner },
    })
    // Observe the actual retained client, with Vitest's default pass-through spy. Neither
    // readiness, requests, responses nor real stop/exited handles are replaced by a fake client.
    const host: ReturnType<typeof createPluginNodeHost> = {
      ...physical,
      async start(spec) {
        const run = await physical.start(spec)
        let ready: ReturnType<typeof run.ready> | undefined
        return {
          ...run,
          ready: () =>
            (ready ??= run.ready().then((connection) => {
              if (!connection.client) throw new Error('Expected the real retained MCP client')
              const spy = vi.spyOn(connection.client, 'callTool')
              audits.push({ pluginId: id, runId: run.runId, calls: spy.mock.calls })
              return connection
            })),
        }
      },
    }
    const service = await createSupervisorLifecycle({
      owner,
      host,
      personKey: '7'.repeat(64),
      read: async () => null,
      lifecycle: {
        root,
        state,
        pinnedPublicKey: fictionalPublicKey,
        target,
        appVersion: '1.0.0',
        catalogue: signed({ format: 1, entries: [] }),
        names: {},
        deny() {},
        fault: seedLegacy,
      },
    })
    const projection: WorkspaceProjection = {
      workspaceId,
      async applied() {},
      async reconcile() {},
      async revoke() {
        return true
      },
    }
    const client = await connectPluginSettings({
      root,
      path: service.path,
      personKey: '7'.repeat(64),
      projection,
      pinnedPublicKey: fictionalPublicKey,
      target,
      appVersion: '1.0.0',
      catalogue: signed({ format: 1, entries: [] }),
      propose: () => {
        throw new Error('Configure must call the actual package MCP tools')
      },
    })
    const pages: PluginPageTools[] = []
    let closed = false
    const close = async () => {
      if (closed) return
      closed = true
      for (const page of pages) page.close()
      await client.close()
      await service.close()
      await physical.stop()
      await lease.close()
      expect(await owner.shutdown()).toBe(true)
    }
    emergency.close = close
    const session = { service, client, pages, close }
    sessions.push(session)
    return session
  }
  cleanups.push(async () => {
    for (const session of sessions.slice().reverse()) await session.close()
    state.close()
  })
  return {
    id,
    parent,
    root,
    home,
    shared,
    workspaceId,
    packages,
    start,
    settingsBytes,
    get legacy() {
      if (!legacy) throw new Error('Legacy metadata was not seeded')
      return legacy
    },
    get installId() {
      return installId
    },
    get state() {
      return state
    },
    boundaryEvents: () => events(join(shared, 'fictional-boundary.jsonl')),
    forwarded(name: string) {
      return audits.flatMap((audit) =>
        audit.calls.flatMap(([input]) => {
          const params = input as {
            name: string
            arguments?: unknown
            _meta?: Record<string, unknown>
          }
          return params.name === name ? [{ ...audit, params }] : []
        }),
      )
    },
    consumedRevision: boundary === 'numeric' ? 9000 : 41,
    async unchangedLegacy() {
      for (const [path, bytes] of oldFiles) {
        expect(await readFile(path)).toEqual(bytes)
        expect(statSync(path, { bigint: true }).mtimeNs).toBe(oldMtimes.get(path))
      }
    },
    reopenState() {
      state.close()
      state = GlobalPluginState.open({ root: join(root, 'state'), workspaceRoots: [workspaceRoot] })
    },
  }
}
async function migrateSelected(f: Awaited<ReturnType<typeof fixture>>, format: 1 | 2) {
  const oldPackage = await historicalPackage(f.id, format, f.parent)
  expect(oldPackage.manifest.format).toBe(format)
  let session = await f.start()
  await session.client.applyPackage!(oldPackage.ref, 'install')
  const selected = f.state.exportActivation().entries.find((entry) => entry.pluginId === f.id)!
  const rootId = f.state.inspect().rootId
  expect(selected.release.archiveSha256).toBe(oldPackage.release.archive.sha256)
  expect(selected.release.version).toBe('0.0.1')
  expect(selected.installId).toBe(f.installId)
  await session.client.host!.request({ kind: 'enabled', pluginId: f.id, enabled: false })
  await session.client.host!.request({ kind: 'titles-enabled', pluginId: f.id, enabled: false })
  const enabled = f.state.getEnabled(f.workspaceId, f.id)
  const titles = f.state.getTitlesEnabled(f.workspaceId, f.id)
  expect(enabled.enabled).toBe(false)
  expect(titles.enabled).toBe(false)
  expect(
    existsSync(
      join(
        f.home,
        f.id === 'chrome' ? 'legacy-configuration-import.json' : 'legacy-configuration.json',
      ),
    ),
  ).toBe(false)
  await session.close()
  f.reopenState()
  expect(f.state.exportActivation().entries).toEqual([selected])
  expect(
    GlobalPluginState.readInstalledPackage(
      { root: join(f.root, 'state'), workspaceRoots: [join(f.parent, 'workspace')] },
      f.id,
    ),
  ).toEqual({
    version: oldPackage.manifest.version,
    archiveSha256: oldPackage.release.archive.sha256,
    manifestSha256: oldPackage.release.manifestSha256,
  })
  const persisted = await new PluginPackageVault(
    f.root,
    fictionalPublicKey,
    target,
    undefined,
    '1.0.0',
  ).load(oldPackage.release, [])
  expect(persisted.manifest.format).toBe(format)
  expect(persisted.manifest.id).toBe(f.id)
  expect(
    pluginSha256(
      await readFile(join(f.root, 'package-vault', oldPackage.release.archive.sha256, 'archive')),
    ),
  ).toBe(oldPackage.release.archive.sha256)
  session = await f.start()
  expect(f.state.exportActivation().entries).toEqual([selected])
  expect(f.state.getEnabled(f.workspaceId, f.id)).toEqual(enabled)
  expect(f.state.getTitlesEnabled(f.workspaceId, f.id)).toEqual(titles)
  await preserved(f)
  // This is the actual person Update path, after an old selected installation cold reopen.
  await session.client.applyPackage!(f.packages.refs[0]!, 'update')
  const converted = f.state.exportActivation().entries.find((entry) => entry.pluginId === f.id)!
  expect(converted.installId).toBe(selected.installId)
  expect(converted.incarnation).not.toBe(selected.incarnation)
  expect(converted.release.archiveSha256).toBe(f.packages.refs[0]!.sha256)
  expect(f.state.inspect().rootId).toBe(rootId)
  expect(f.state.getEnabled(f.workspaceId, f.id)).toEqual(enabled)
  expect(f.state.getTitlesEnabled(f.workspaceId, f.id)).toEqual(titles)
  expect(session.service.controller.agentAttachments(f.workspaceId)).toEqual([])
  const boots = (await f.boundaryEvents()).filter(
    (event) => event.event === (f.id === 'chrome' ? 'browser-start' : 'bridge-start'),
  )
  expect(boots).toHaveLength(1)
  expect(boots[0]).toMatchObject({
    bootstrap: {
      dataDirectory: f.home,
      sharedDataDirectory: f.shared,
      priorOwner,
      legacyConfiguration: f.legacy,
      previousVersion: '0.0.1',
      previousDataSchema: 1,
    },
  })
  // Only a new explicit person choice re-enables tools; update did not reset the old switch.
  await session.client.host!.request({ kind: 'enabled', pluginId: f.id, enabled: true })
  return { session, selected, titles }
}

async function configure(session: ConnectedSession, id: MigratedPackage) {
  const snapshot = await session.client.host!.snapshot()
  expect(snapshot.contributions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ pluginId: id, kind: 'settings.page', state: 'active' }),
    ]),
  )
  const screen = await session.client.screen(id)
  if (!screen.tools || !screen.page)
    throw new Error('Expected actual generic Configure screen/tools')
  expect(screen.hostViewId).toEqual(expect.any(String))
  const manifest = screen.verified.manifest
  expect(manifest.format).toBe(3)
  if (manifest.format !== 3) throw new Error('Expected the converted package manifest')
  expect(manifest.tools).toEqual({ source: 'mcp', inventory: 'tools.json' })
  const inventoryBytes = screen.verified.readFile(manifest.tools.inventory)
  expect(inventoryBytes).toBeDefined()
  const inventory = JSON.parse(Buffer.from(inventoryBytes!).toString())
  expect(Array.isArray(inventory) ? inventory : inventory.tools).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: id === 'chrome' ? 'configure_profile' : 'whatsapp_settings',
      }),
    ]),
  )
  expect(screen.verified.readFile(screen.page.entry)?.toString()).toContain(
    id === 'chrome' ? '<title>Chrome</title>' : '<title>WhatsApp</title>',
  )
  for (const asset of screen.page.assets) expect(screen.verified.readFile(asset)).toBeDefined()
  const page = new PluginPageTools(screen.tools)
  session.pages.push(page)
  return {
    screen,
    invoke: (tool: string, args: PluginJsonObject = {}) =>
      page.invoke({
        channel: PLUGIN_PAGE_CHANNEL,
        requestId: randomUUID(),
        method: 'callTool',
        params: { tool, arguments: args },
      }),
  }
}
function current(session: ConnectedSession, workspaceId: string) {
  const view = session.service.controller.agentAttachments(workspaceId)[0]
  if (!view) throw new Error('Expected an actual running package attachment')
  return { workspaceId, pluginId: view.pluginId, instanceId: view.runId }
}
async function preserved(f: Awaited<ReturnType<typeof fixture>>) {
  expect(await readFile(join(f.home, 'opaque-account.bin'))).toEqual(opaque)
  expect(await readFile(join(f.shared, 'opaque-shared.bin'))).toEqual(opaque)
  await f.unchangedLegacy()
}

// These test targets run the source entry under Node. They do not qualify a native browser,
// Go binary, rendered Electron DOM, published package dependencies or unchanged installed app.
describe('ordinary package migration through actual app and package code', () => {
  it.each([
    { format: 1 as const, boundary: 'conflicting' as const },
    { format: 2 as const, boundary: 'numeric' as const },
  ])(
    'Chrome updates selected format$format with $boundary highwater through Configure and reopen',
    async ({ format, boundary }) => {
      const f = await fixture('chrome', false, boundary)
      let { session } = await migrateSelected(f, format)
      const first = current(session, f.workspaceId)
      const page = await configure(session, 'chrome')
      const initial = jsonResult(await page.invoke('configuration_snapshot')) as {
        profiles: { name: string; displayName: string; enabled: boolean }[]
      }
      expect(initial.profiles).toHaveLength(1)
      const name = initial.profiles[0]!.name
      expect(initial.profiles[0]).toMatchObject({
        displayName: 'Retained fictional fern',
        enabled: true,
      })
      const profileRoot =
        process.platform === 'darwin' || process.platform === 'win32' ? f.shared : f.home
      expect(await readFile(join(profileRoot, 'profiles', name, 'Default', 'Cookies'))).toEqual(
        opaque,
      )
      expect(
        jsonResult(
          await page.invoke('configure_profile', {
            profile: name,
            action: 'rename-profile',
            newName: 'Fictional kept fern',
          }),
        ),
      ).toEqual({ profile: name, completed: true })
      expect(
        jsonResult(
          await page.invoke('configure_profile', {
            profile: name,
            action: 'set-flags',
            allowSync: true,
          }),
        ),
      ).toEqual({ profile: name, completed: true })
      expect(
        await page.invoke('configure_profile', {
          profile: name,
          action: 'set-enabled',
          enabled: 'wrong',
        }),
      ).toMatchObject({ status: 'result', result: { isError: true } })
      const sequenceBeforeHelper = f.state.inspect().sequence
      expect(
        jsonResult(
          await page.invoke('configure_profile', {
            profile: name,
            action: 'set-enabled',
            enabled: false,
          }),
        ),
      ).toEqual({ profile: name, completed: true })
      expect(
        await page.invoke('configure_profile', { profile: name, action: 'helper-on' }),
      ).toMatchObject({
        status: 'result',
        result: {
          isError: true,
          content: [{ type: 'text', text: 'Enable this profile first, then turn the helper on.' }],
        },
      })
      expect(jsonResult(await page.invoke('configuration_snapshot'))).toMatchObject({
        profiles: [expect.objectContaining({ name, enabled: false, helper: 'off' })],
      })
      expect((await f.boundaryEvents()).filter((event) => event.event === 'helper-on')).toEqual([])
      expect(
        jsonResult(
          await page.invoke('configure_profile', {
            profile: name,
            action: 'set-enabled',
            enabled: true,
          }),
        ),
      ).toEqual({ profile: name, completed: true })
      expect(
        jsonResult(await page.invoke('configure_profile', { profile: name, action: 'helper-on' })),
      ).toEqual({ profile: name, completed: true })
      expect(jsonResult(await page.invoke('configuration_snapshot'))).toMatchObject({
        profiles: [expect.objectContaining({ name, enabled: true, helper: 'turning-on' })],
      })
      expect((await f.boundaryEvents()).filter((event) => event.event === 'helper-on')).toEqual([
        expect.objectContaining({ profile: name, runId: first.instanceId }),
      ])
      expect(f.state.inspect().sequence).toBe(sequenceBeforeHelper)
      await f.unchangedLegacy()
      const markerPath = join(f.home, 'legacy-configuration-import.json')
      const marker = await readFile(markerPath)
      expect(JSON.parse(marker.toString())).toMatchObject({
        source: f.legacy,
        installId: f.installId,
        revision: f.consumedRevision,
        consumed: true,
      })
      expect((await f.boundaryEvents()).filter((e) => e.event === 'browser-open')).toEqual([])
      if (process.platform === 'darwin' || process.platform === 'win32') {
        const registry = JSON.parse(await readFile(join(f.shared, 'registry.json'), 'utf8'))
        expect(Object.keys(registry.workspaces)).toEqual([priorOwner.ownerId])
        expect(registry.profiles[0].perWorkspace).toHaveProperty(priorOwner.ownerId)
        expect(registry.workspaces).not.toHaveProperty(f.workspaceId)
      }
      await session.client.applyPackage!(f.packages.refs[1]!, 'update')
      await expect(page.invoke('configuration_snapshot')).rejects.toThrow('Plugin unavailable.')
      expect(current(session, f.workspaceId).instanceId).not.toBe(first.instanceId)
      let updated = await configure(session, 'chrome')
      expect(jsonResult(await updated.invoke('configuration_snapshot'))).toMatchObject({
        profiles: [
          expect.objectContaining({
            name,
            displayName: 'Fictional kept fern',
            allowSync: true,
            helper: 'turning-on',
          }),
        ],
      })
      await session.service.controller.restartPluginTools('chrome', undefined, () => {})
      await expect(updated.invoke('configuration_snapshot')).rejects.toThrow('Plugin unavailable.')
      expect(await readFile(markerPath)).toEqual(marker)
      await preserved(f)
      await session.close()
      f.reopenState()
      session = await f.start()
      expect(f.state.currentInstallation('chrome')?.installId).toBe(f.installId)
      expect(f.state.getTitlesEnabled(f.workspaceId, 'chrome').enabled).toBe(false)
      updated = await configure(session, 'chrome')
      expect(jsonResult(await updated.invoke('configuration_snapshot'))).toMatchObject({
        profiles: [
          expect.objectContaining({
            displayName: 'Fictional kept fern',
            allowSync: true,
            helper: 'turning-on',
          }),
        ],
      })
      expect(await readFile(join(profileRoot, 'profiles', name, 'Default', 'Cookies'))).toEqual(
        opaque,
      )
      expect(await readFile(markerPath)).toEqual(marker)
      await preserved(f)
      const boots = (await f.boundaryEvents()).filter((e) => e.event === 'browser-start')
      expect(boots).toHaveLength(4)
      expect(boots[1]).toMatchObject({
        bootstrap: {
          dataDirectory: f.home,
          sharedDataDirectory: f.shared,
          priorOwner,
          legacyConfiguration: f.legacy,
          previousVersion: f.packages.versions[0],
          previousDataSchema: 1,
        },
      })
      expect((await f.boundaryEvents()).filter((e) => e.event === 'browser-open')).toEqual([])
      expect(
        (await f.boundaryEvents()).filter((event) => event.event === 'helper-on'),
      ).toHaveLength(1)
      const configured = f
        .forwarded('configure_profile')
        .filter((call) => call.params._meta?.origin === 'settings.page')
      expect(configured).toHaveLength(7)
      for (const call of configured)
        expect(call).toMatchObject({
          pluginId: 'chrome',
          runId: first.instanceId,
          params: {
            _meta: {
              origin: 'settings.page',
              workspaceId: f.workspaceId,
              requestId: expect.any(String),
            },
          },
        })
    },
    240000,
  )

  it.each([false, true])(
    'WhatsApp keeps opaque account/history and settings, with explicit uninstall warning=%s',
    async (warning) => {
      const f = await fixture('whatsapp', warning)
      let { session } = await migrateSelected(f, 2)
      const first = current(session, f.workspaceId)
      let page = await configure(session, 'whatsapp')
      expect(jsonResult(await page.invoke('whatsapp_settings'))).toMatchObject({
        read: true,
        prefix: false,
        groups: expect.arrayContaining([expect.objectContaining({ jid: group, canWrite: true })]),
      })
      expect(await readFile(join(f.home, 'settings.json'))).toEqual(f.settingsBytes)
      expect(jsonResult(await page.invoke('whatsapp_set_prefix', { enabled: true }))).toMatchObject(
        {
          read: true,
          prefix: true,
          groups: expect.arrayContaining([expect.objectContaining({ jid: group, canWrite: true })]),
        },
      )
      expect(await page.invoke('whatsapp_set_read', { enabled: 'wrong' })).toMatchObject({
        status: 'result',
        result: { isError: true },
      })
      // An ordinary agent may not turn a person-only Configure action into account logout.
      expect(
        await session.service.controller.genericCallTool({
          ...first,
          name: 'whatsapp_unlink',
          arguments: {},
          requestId: randomUUID(),
          origin: 'agent',
        }),
      ).toMatchObject({ isError: true })
      expect(await page.invoke('whatsapp_before_remove')).toMatchObject({
        status: 'result',
        result: { isError: true },
      })
      expect(
        (await f.boundaryEvents()).filter(
          (e) => e.event === 'bridge-unlink' || e.event === 'bridge-pair',
        ),
      ).toEqual([])
      const markerPath = join(f.home, 'legacy-configuration.json')
      const marker = await readFile(markerPath)
      expect(JSON.parse(marker.toString())).toMatchObject({
        format: 1,
        source: f.legacy,
        installId: f.installId,
        consumedRevision: 41,
      })
      const chosen = await readFile(join(f.home, 'settings.json'))
      await session.client.applyPackage!(f.packages.refs[1]!, 'update')
      await expect(page.invoke('whatsapp_settings')).rejects.toThrow('Plugin unavailable.')
      expect(f.state.currentInstallation('whatsapp')?.installId).toBe(f.installId)
      expect(f.state.getTitlesEnabled(f.workspaceId, 'whatsapp').enabled).toBe(false)
      page = await configure(session, 'whatsapp')
      expect(jsonResult(await page.invoke('whatsapp_settings'))).toMatchObject({
        read: true,
        prefix: true,
      })
      await session.service.controller.restartPluginTools('whatsapp', undefined, () => {})
      await expect(page.invoke('whatsapp_status')).rejects.toThrow('Plugin unavailable.')
      await session.close()
      f.reopenState()
      session = await f.start()
      expect(f.state.currentInstallation('whatsapp')?.installId).toBe(f.installId)
      expect(f.state.getTitlesEnabled(f.workspaceId, 'whatsapp').enabled).toBe(false)
      page = await configure(session, 'whatsapp')
      expect(jsonResult(await page.invoke('whatsapp_settings'))).toMatchObject({
        read: true,
        prefix: true,
        groups: expect.arrayContaining([expect.objectContaining({ jid: group, canWrite: true })]),
      })
      expect(await readFile(join(f.home, 'settings.json'))).toEqual(chosen)
      for (const name of ['session.db', 'messages.db', 'messages.db-wal', 'messages.db-shm'])
        expect(await readFile(join(f.home, 'bridge', name))).toEqual(opaque)
      expect(await readFile(markerPath)).toEqual(marker)
      await preserved(f)
      const before = await f.boundaryEvents()
      expect(
        before.filter((e) => e.event === 'bridge-unlink' || e.event === 'bridge-pair'),
      ).toEqual([])
      const boots = before.filter((e) => e.event === 'bridge-start')
      expect(boots).toHaveLength(4)
      expect(boots[1]).toMatchObject({
        home: f.home,
        bridgeData: join(f.home, 'bridge'),
        bootstrap: {
          dataDirectory: f.home,
          sharedDataDirectory: f.shared,
          priorOwner,
          legacyConfiguration: f.legacy,
          previousVersion: f.packages.versions[0],
          previousDataSchema: 1,
        },
      })
      const removing = current(session, f.workspaceId)
      const outcome = await session.client.uninstall('whatsapp')
      const message = warning
        ? 'Logged out here. Also remove this device on your phone: WhatsApp → Linked devices.'
        : 'Logged out of WhatsApp.'
      expect(outcome).toMatchObject({
        data: 'deleted',
        cleanup: 'completed',
        result: {
          content: [{ type: 'text', text: message }],
          structuredContent: { status: warning ? 'warning' : 'complete', message },
        },
      })
      expect((await f.boundaryEvents()).filter((e) => e.event === 'bridge-unlink')).toEqual([
        expect.objectContaining({ runId: removing.instanceId }),
      ])
      const lifecycleCalls = f
        .forwarded('whatsapp_before_remove')
        .filter((call) => call.params._meta?.origin === 'lifecycle.beforeRemove')
      expect(lifecycleCalls).toHaveLength(1)
      const removal = f.state
        .inspect()
        .operations.find((record) => record.operation.request.consent.action === 'uninstall')
      expect(removal?.status).toBe('completed')
      expect(lifecycleCalls[0]!.params._meta?.requestId).toBe(
        removal!.operation.request.operationId,
      )
      expect(lifecycleCalls[0]).toMatchObject({
        pluginId: 'whatsapp',
        runId: removing.instanceId,
        params: {
          name: 'whatsapp_before_remove',
          arguments: {},
          _meta: {
            workspaceId: f.workspaceId,
            origin: 'lifecycle.beforeRemove',
            requestId: expect.any(String),
          },
        },
      })
      expect(session.service.controller.agentAttachments(f.workspaceId)).toEqual([])
      await expect(readFile(join(f.home, 'opaque-account.bin'))).rejects.toMatchObject({
        code: 'ENOENT',
      })
      expect(await readFile(join(f.shared, 'opaque-shared.bin'))).toEqual(opaque)
      await expect(page.invoke('whatsapp_status')).rejects.toThrow('Plugin unavailable.')
    },
    240000,
  )

  it('keeps WhatsApp data and does not infer explicit logout from a missing uninstall effect', async () => {
    const f = await fixture('whatsapp')
    let session = await f.start()
    await session.client.applyPackage!(f.packages.refs[0]!, 'install')
    const page = await configure(session, 'whatsapp')
    expect(jsonResult(await page.invoke('whatsapp_settings'))).toMatchObject({
      read: true,
      prefix: false,
    })
    const marker = await readFile(join(f.home, 'legacy-configuration.json'))
    const before = f.state.inspect()
    const install = f.state
      .exportActivation()
      .entries.find((entry) => entry.pluginId === 'whatsapp')!
    const operationId = randomUUID()
    // Reproduce an actual journal-only pending uninstall, with no controller explicitRemoval
    // fact. Recovery must not invent destructive person intent from this missing effect.
    await f.state.withExclusive(async () => {
      f.state.prepare({
        operationId,
        snapshot: null,
        workspaces: [f.workspaceId],
        consent: {
          action: 'uninstall',
          pluginId: 'whatsapp',
          expectedSequence: before.sequence,
          expectedInstallId: install.installId,
          release: null,
          at: 1,
        },
      })
    })
    expect(f.state.inspect().pending?.request.operationId).toBe(operationId)
    expect(existsSync(join(f.root, 'lifecycle-effects', operationId + '.json'))).toBe(false)
    await session.close()
    f.reopenState()
    session = await f.start()
    expect(f.state.inspect().pending).toBeNull()
    expect(session.service.controller.agentAttachments(f.workspaceId)).toEqual([])
    expect(f.state.exportActivation().entries).toEqual([])
    await preserved(f)
    expect(await readFile(join(f.home, 'settings.json'))).toEqual(f.settingsBytes)
    expect(await readFile(join(f.home, 'legacy-configuration.json'))).toEqual(marker)
    for (const name of ['session.db', 'messages.db', 'messages.db-wal', 'messages.db-shm'])
      expect(await readFile(join(f.home, 'bridge', name))).toEqual(opaque)
    expect(
      (await f.boundaryEvents()).filter(
        (event) => event.event === 'bridge-unlink' || event.event === 'bridge-pair',
      ),
    ).toEqual([])
    expect(f.forwarded('whatsapp_before_remove')).toEqual([])
  }, 240000)
})

it('rejects an ancestor dependency shadow while accepting the locked SDK transitive Express copy', async () => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'fictional-package-provenance-')))
  cleanups.push(() => rm(parent, { recursive: true, force: true }))
  const project = join(parent, 'isolated')
  const dependencies = join(project, 'node_modules')
  const top = join(dependencies, 'express')
  const nested = join(dependencies, '@modelcontextprotocol', 'sdk', 'node_modules', 'express')
  const shadow = join(parent, 'node_modules', 'express')
  for (const [root, version] of [
    [top, '4.22.3'],
    [nested, '5.2.1'],
    [shadow, '5.2.1'],
  ]) {
    await mkdir(root!, { recursive: true })
    await writeFile(join(root!, 'package.json'), JSON.stringify({ name: 'express', version }))
    await writeFile(join(root!, 'index.js'), 'export const fictional = true;')
  }
  await writeFile(
    join(project, 'package-lock.json'),
    JSON.stringify({
      packages: {
        'node_modules/express': { version: '4.22.3' },
        'node_modules/@modelcontextprotocol/sdk/node_modules/express': { version: '5.2.1' },
      },
    }),
  )
  expect(
    await packageBundleProvenance([join(top, 'index.js'), join(nested, 'index.js')], dependencies),
  ).toEqual([
    { name: 'express', version: '4.22.3', lockPath: 'node_modules/express' },
    {
      name: 'express',
      version: '5.2.1',
      lockPath: 'node_modules/@modelcontextprotocol/sdk/node_modules/express',
    },
  ])
  await expect(packageBundleProvenance([join(shadow, 'index.js')], dependencies)).rejects.toThrow(
    'Shadowed package dependency outside staged root: express',
  )
})
