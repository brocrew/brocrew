import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, symlink, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { manifestFor, packageFixture, verified } from './plugin-package-fixtures'
import { createRepoAwarePluginVerifier } from '../src/main/plugins/package-verifier'
import { parsePluginManifest } from '../src/main/plugins/package-schema'
import {
  sharedDataEnvironment,
  sharedDataOwner,
  checkedSharedDataOwner,
  pluginOwnerIdentity,
} from '../src/main/plugins/shared-data'
import { PluginProfileLedger } from '../src/main/plugins/lifecycle/profile-ledger'
import { PluginProfileLedger as EarlierProfileLedger } from './fixtures/plugin-delete-parent/profile-ledger'
import { randomUUID } from 'node:crypto'
import {
  SHARED_DATA_FEATURE,
  SHARED_DATA_PERMISSION,
  sharedWorkspaceLabel,
} from '../src/main/plugins/shared-data-contract'
import {
  releaseDisclosure,
  disclosureChanges,
  displayedDetailsHash,
} from '../src/main/plugins/mutation-disclosure'
import { OWNER_WIRE } from '../src/main/plugins/supervisor/protocol'
import { LaunchConfig } from '../src/main/plugins/supervisor/launch-format'

const folders: string[] = []
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
})
function fixturePackage(id = 'chrome', sharedData: boolean | undefined = true) {
  const manifest = manifestFor()
  Object.assign(manifest, {
    format: 2,
    id,
    authors: ['fictional'],
    executor: { kind: 'node', entry: manifest.server!.entry },
    hooks: [],
    sharedData,
  })
  if (sharedData) manifest.hostApi.requiredFeatures = [SHARED_DATA_FEATURE]
  return packageFixture({ manifest })
}
async function ownerFixture() {
  const folder = await realpath(
    await mkdtemp(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'shared-')),
  )
  folders.push(folder)
  const appData = join(folder, 'a'),
    workspaceRoot = join(folder, 'fern')
  await mkdir(join(appData, '@brobot2'), { recursive: true, mode: 0o700 })
  await mkdir(workspaceRoot, { mode: 0o700 })
  await writeFile(
    join(workspaceRoot, 'plugin-root.json'),
    JSON.stringify({ format: 1, slot: 'a' }),
    { mode: 0o600 },
  )
  await writeFile(
    join(appData, '@brobot2', 'plugin-root-pins.json'),
    JSON.stringify({ format: 1, selections: [{ workspace: workspaceRoot, slot: 'a' }] }),
    { mode: 0o600 },
  )
  const root = join(appData, '@brobot2', 'plugins-a')
  const owner = sharedDataOwner({
    appData,
    workspaceRoot,
    root,
    hidden: false,
    label: 'Fern\n\u202e workspace',
  })!
  return { folder, appData, workspaceRoot, root, hostRoot: join(root, 'host'), owner }
}

it('requires a declared host feature and modern consent schema for shared data', () => {
  const f = fixturePackage()
  expect(parsePluginManifest(f.manifestBytes).sharedData).toBe(true)
  for (const change of [
    { sharedData: 'true' },
    { hostApi: { ...f.manifest.hostApi, requiredFeatures: [] } },
    { format: 1 },
    { id: '../chrome' },
    {
      permissions: {
        ...f.manifest.permissions,
        resources: [{ id: SHARED_DATA_PERMISSION, label: 'Disguised', read: false, write: false }],
      },
    },
  ])
    expect(() =>
      parsePluginManifest(Buffer.from(JSON.stringify({ ...f.manifest, ...change }))),
    ).toThrow()
})

it('keeps old manifests valid and refuses new capability on a host without its feature', () => {
  const old = packageFixture()
  expect(parsePluginManifest(old.manifestBytes).sharedData).toBeUndefined()
  const f = fixturePackage()
  const defaultApi = { major: 1, minor: 0, features: [] }
  const checked = createRepoAwarePluginVerifier({
    target: { os: 'linux', cpu: 'x64' },
    apiSupport: { host: defaultApi, tools: defaultApi, ui: defaultApi },
  })
    .verifyCatalogue(f.bytes)
    .verifyPackage(f.manifest.id, f.manifest.version, f.archive)
  expect(checked.compatibility.host).toBe(false)
  expect(verified(f).compatibility.host).toBe(true)
  expect(OWNER_WIRE.features).toContain(SHARED_DATA_FEATURE)
})

it('grants only the verified plugin namespace, with stable identity and bounded display text', async () => {
  const f = await ownerFixture()
  const chrome = await sharedDataEnvironment(verified(fixturePackage()), f.hostRoot, f.owner)
  expect(chrome).toEqual({
    BROCREW_CHROME_SHARED: join(f.appData, '@brobot2', 'shared', 'chrome'),
    BROCREW_PLUGIN_OWNER_ID: pluginOwnerIdentity(f.root),
    BROCREW_PLUGIN_OWNER_LABEL: 'Fern workspace',
  })
  const other = await sharedDataEnvironment(
    verified(fixturePackage('other-plugin')),
    f.hostRoot,
    f.owner,
  )
  expect(other.BROCREW_OTHER_PLUGIN_SHARED).toBe(
    join(f.appData, '@brobot2', 'shared', 'other-plugin'),
  )
  expect(other.BROCREW_PLUGIN_OWNER_ID).toBe(chrome.BROCREW_PLUGIN_OWNER_ID)
  expect(other).not.toHaveProperty('BROCREW_CHROME_SHARED')
  const second = join(f.folder, 'cedar')
  await mkdir(second, { mode: 0o700 })
  await writeFile(join(second, 'plugin-root.json'), JSON.stringify({ format: 1, slot: 'b' }), {
    mode: 0o600,
  })
  await writeFile(
    join(f.appData, '@brobot2', 'plugin-root-pins.json'),
    JSON.stringify({
      format: 1,
      selections: [
        { workspace: f.workspaceRoot, slot: 'a' },
        { workspace: second, slot: 'b' },
      ],
    }),
    { mode: 0o600 },
  )
  const secondRoot = join(f.appData, '@brobot2', 'plugins-b')
  const secondOwner = sharedDataOwner({
    appData: f.appData,
    workspaceRoot: second,
    root: secondRoot,
    hidden: false,
  })!
  const secondEnv = await sharedDataEnvironment(
    verified(fixturePackage()),
    join(secondRoot, 'host'),
    secondOwner,
  )
  expect(secondEnv.BROCREW_CHROME_SHARED).toBe(chrome.BROCREW_CHROME_SHARED)
  expect(secondEnv.BROCREW_PLUGIN_OWNER_ID).not.toBe(chrome.BROCREW_PLUGIN_OWNER_ID)
  expect((await stat(chrome.BROCREW_CHROME_SHARED!)).isDirectory()).toBe(true)
  expect(sharedWorkspaceLabel('\u0000\u202e\n')).toBe('Workspace')
  expect(Array.from(sharedWorkspaceLabel('🙂'.repeat(200)))).toHaveLength(80)
})

it('keeps fixture and development-source owners outside the trusted shared launch interface', async () => {
  const f = await ownerFixture()
  const lifecycle = {
    source: 'repo-list',
    catalogue: join(f.folder, 'catalogue.json'),
    catalogueSha256: 'a'.repeat(64),
    personKey: 'b'.repeat(64),
    names: {},
  }
  const config = {
    format: 1,
    root: f.root,
    workspaceRoots: [f.workspaceRoot],
    runtime: { directory: f.folder, id: 'c'.repeat(64) },
    sharedDataOwner: f.owner,
    lifecycle,
  }
  expect(LaunchConfig.safeParse(config).success).toBe(true)
  for (const field of ['fixtureSource', 'devSource'])
    expect(
      LaunchConfig.safeParse({
        ...config,
        lifecycle: { ...lifecycle, [field]: join(f.folder, 'fixture') },
      }).success,
    ).toBe(false)
  expect(LaunchConfig.safeParse({ ...config, workspaceRoots: [] }).success).toBe(false)
  expect(LaunchConfig.safeParse({ ...config, lifecycle: undefined }).success).toBe(false)
})

it('consumes live commands durably without storing a replayable profile action', async () => {
  const f = await ownerFixture()
  await mkdir(f.root, { mode: 0o700 })
  const ledger = new PluginProfileLedger(f.root),
    installId = randomUUID()
  expect(await ledger.reserve(installId, 0)).toBe(1)
  expect(await ledger.revision(installId)).toBe(1)
  await expect(ledger.reserve(installId, 0)).rejects.toThrow()
  await expect(ledger.revision(installId, false)).rejects.toThrow()
  const { digest } = await import('../src/main/plugins/node-host-files')
  const checkpoint = JSON.parse(
    await readFile(
      join(f.root, 'profile-apply', digest(Buffer.from(installId)), 'checkpoint.json'),
      'utf8',
    ),
  )
  expect(checkpoint).toMatchObject({ format: 2, revision: 1 })
  expect(checkpoint).not.toHaveProperty('proposal')
  expect(await new EarlierProfileLedger(f.root).revision(installId)).toBe(1)
  expect(await ledger.reserve(installId, 1)).toBe(2)
})

it('gives all default-root workspaces one stable owner identity and shared switch scope', async () => {
  const f = await ownerFixture(),
    a = join(f.folder, 'default-a'),
    b = join(f.folder, 'default-b')
  await mkdir(a)
  await mkdir(b)
  const root = join(f.appData, '@brobot2', 'plugins')
  const first = sharedDataOwner({
    appData: f.appData,
    root,
    workspaceRoot: a,
    hidden: false,
    label: 'Ignored workspace label',
  })!
  const second = sharedDataOwner({ appData: f.appData, root, workspaceRoot: b, hidden: false })!
  expect(first).toEqual(second)
  expect(first.ownerId).toBe(pluginOwnerIdentity(root))
  expect(first.ownerId).not.toBe(f.owner.ownerId)
  expect(first.ownerLabel).toBe('the default workspaces')
  expect(first).not.toHaveProperty('workspaceRoot')
  const env = await sharedDataEnvironment(verified(fixturePackage()), join(root, 'host'), first)
  expect(env.BROCREW_PLUGIN_OWNER_ID).toBe(first.ownerId)
  expect(env).not.toHaveProperty('BROCREW_WORKSPACE_ID')
  expect(env).not.toHaveProperty('BROCREW_WORKSPACE_LABEL')
  expect(() => checkedSharedDataOwner(first, join(f.folder, 'scratch', 'host'))).toThrow()
})

it('omits every shared variable and creates no shared root for absent capability or owner', async () => {
  const f = await ownerFixture()
  const legacy = fixturePackage('chrome', false)
  delete legacy.manifest.sharedData
  for (const pkg of [
    packageFixture({ manifest: legacy.manifest }),
    fixturePackage('chrome', false),
  ])
    expect(await sharedDataEnvironment(verified(pkg), f.hostRoot, f.owner)).toEqual({})
  expect(await sharedDataEnvironment(verified(fixturePackage()), f.hostRoot)).toEqual({})
  expect(
    sharedDataOwner({
      appData: f.appData,
      root: f.root,
      workspaceRoot: f.workspaceRoot,
      hidden: true,
    }),
  ).toBeUndefined()
  expect(existsSync(join(f.appData, '@brobot2', 'shared'))).toBe(false)
})

it('rejects forged packages, conflicting identity, non-selected roots and revoked enrollment', async () => {
  const f = await ownerFixture(),
    pkg = verified(fixturePackage())
  await expect(sharedDataEnvironment({ ...pkg }, f.hostRoot, f.owner)).rejects.toMatchObject({
    code: 'package',
  })
  for (const owner of [
    { ...f.owner, ownerId: '00000000-0000-4000-8000-000000000001' },
    { ...f.owner, ownerLabel: '\u202e spoof' },
  ])
    expect(() => checkedSharedDataOwner(owner, f.hostRoot)).toThrow()
  expect(() => checkedSharedDataOwner(f.owner, join(f.folder, 'scratch', 'host'))).toThrow()
  await rm(join(f.workspaceRoot, 'plugin-root.json'))
  await expect(sharedDataEnvironment(pkg, f.hostRoot, f.owner)).rejects.toThrow()
  expect(existsSync(join(f.appData, '@brobot2', 'shared'))).toBe(false)
})

it('refuses a linked shared namespace without touching its target', async () => {
  const f = await ownerFixture(),
    outside = join(f.folder, 'outside')
  await mkdir(outside)
  await symlink(
    outside,
    join(f.appData, '@brobot2', 'shared'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  await expect(
    sharedDataEnvironment(verified(fixturePackage()), f.hostRoot, f.owner),
  ).rejects.toThrow()
  expect(existsSync(join(outside, 'chrome'))).toBe(false)
})

it('adds host-owned shared access to visible consent and marks an update as changed', () => {
  const current = releaseDisclosure(verified(fixturePackage()))
  const installed = releaseDisclosure(verified(fixturePackage('chrome', false)))
  expect(current.permissions.resources.at(-1)).toEqual({
    id: SHARED_DATA_PERMISSION,
    label:
      'Shared plugin data on this computer, accessible to other plugin owners; workspaces using the same plugin owner share its settings',
    read: true,
    write: true,
  })
  expect(disclosureChanges(current, installed).permissions).toBe(true)
  const display = {
    id: 'chrome',
    action: 'update' as const,
    catalogueDigest: 'a'.repeat(64),
    details: current,
    installed,
    changes: disclosureChanges(current, installed),
  }
  expect(displayedDetailsHash(display)).not.toBe(
    displayedDetailsHash({
      ...display,
      details: { ...current, permissions: installed.permissions },
    }),
  )
})
