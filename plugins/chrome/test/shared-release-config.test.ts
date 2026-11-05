import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { bootstrapEnv, withBootstrap } from './ordinary-package-fixture.js'
import { loadConfig } from '../src/config.js'
import { createConfiguredProfileStore } from '../src/index.js'
import { createProfileStore } from '../src/profiles/store.js'
import * as release from '../src/sharedProfilesRelease.js'
import * as core from '../src/profiles/sharedStore.js'

const folders: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'fictional-release-config-'))
  folders.push(root)
  const home = join(root, 'local')
  mkdirSync(home)
  mkdirSync(join(root, 'shared'))
  return {
    home,
    shared: join(root, 'shared'),
    env: {
      ...bootstrapEnv(home, { sharedDataDirectory: join(root, 'shared') }),
      BROCREW_PLUGIN_OWNER_ID: '11111111-1111-4111-8111-111111111111',
    },
  }
}

it('ships an immutable release signal for qualified Mac and Windows only', () => {
  expect(release.sharedProfilesRelease).toEqual({ format: 1, mac: true, windows: true })
  expect(Object.isFrozen(release.sharedProfilesRelease)).toBe(true)
  for (const platform of ['darwin', 'win32'])
    expect(release.sharedProfilesReleased(platform, release.sharedProfilesRelease)).toBe(true)
  for (const platform of ['linux', 'unknown'])
    expect(release.sharedProfilesReleased(platform, release.sharedProfilesRelease)).toBe(false)
  expect(release.sharedProfilesReleased('darwin')).toBe(false)
  expect(!!loadConfig(fixture().env).shared).toBe(['darwin', 'win32'].includes(process.platform))
})

it.each([
  [{ format: 1, mac: true, windows: false }, true, false],
  [{ format: 1, mac: false, windows: true }, false, true],
  [{ format: 1, mac: true, windows: true }, true, true],
  [undefined, false, false],
  [null, false, false],
  [{}, false, false],
  [{ format: 2, mac: true, windows: true }, false, false],
  [{ format: 1, mac: 'true', windows: true }, false, false],
  [{ format: 1, mac: true }, false, false],
] as const)('releases only the explicitly enabled platform for %j', (signal, mac, windows) => {
  expect(release.sharedProfilesReleased('darwin', signal)).toBe(mac)
  expect(release.sharedProfilesReleased('win32', signal)).toBe(windows)
  expect(release.sharedProfilesReleased('linux', signal)).toBe(false)
  expect(release.sharedProfilesReleased('unknown', signal)).toBe(false)
})

it.each([
  { format: 1, mac: true, windows: false },
  { format: 1, mac: false, windows: true },
  { format: 1, mac: true, windows: true },
  null,
])('config follows the bundled platform release signal %j', (signal) => {
  const released = release.sharedProfilesReleased
  const check = vi
    .spyOn(release, 'sharedProfilesReleased')
    .mockImplementation((platform) => released(platform, signal))
  const expected = released(process.platform, signal)
  expect(!!loadConfig(fixture().env).shared).toBe(expected)
  expect(
    loadConfig({
      ...fixture().env,
      BROCREW_PLUGIN_OWNER_ID: '22222222-2222-4222-8222-222222222222',
    }).shared !== undefined,
  ).toBe(expected)
  expect(check).toHaveBeenCalledWith(process.platform, release.sharedProfilesRelease)
})

it.each([
  '{}',
  'not-json',
  JSON.stringify({
    format: 1,
    ownerId: '11111111-1111-4111-8111-111111111111',
    platform: process.platform,
    qualificationId: 'a'.repeat(64),
    legacyOwnersRetired: true,
  }),
])('owner receipts and environment release claims cannot enable migration: %s', (receipt) => {
  vi.spyOn(release, 'sharedProfilesReleased').mockReturnValue(false)
  const env = {
    ...fixture().env,
    BROCREW_CHROME_MIGRATION_QUALIFICATION: receipt,
    BROCREW_CHROME_SHARED_PROFILES_RELEASE: JSON.stringify({
      format: 1,
      mac: true,
      windows: true,
    }),
  }
  expect(loadConfig(env).shared).toBeUndefined()
  expect(loadConfig(withBootstrap(env, { sharedDataDirectory: undefined })).shared).toBeUndefined()
})

it('OFF preserves the original local names, list, storage and profile bytes with no shared writes', () => {
  vi.spyOn(release, 'sharedProfilesReleased').mockReturnValue(false)
  const { env, home, shared } = fixture()
  const local = createProfileStore({ home: home })
  local.create('fern', 'panel')
  local.create('local-legacy', 'panel')
  const file = join(home, 'profiles.json')
  const metadata = readFileSync(file)
  const dir = local.dirOf('fern')
  writeFileSync(join(dir, 'fictional-sign-in'), 'still-here')
  const before = statSync(dir).ino
  const store = createConfiguredProfileStore(loadConfig(env))
  expect(store.shared).toBeUndefined()
  expect(store.list().map((p) => p.name)).toEqual(['fern', 'local-legacy'])
  expect(store.dirOf('fern')).toBe(dir)
  expect(statSync(dir).ino).toBe(before)
  expect(readFileSync(file)).toEqual(metadata)
  expect(readFileSync(join(dir, 'fictional-sign-in'), 'utf8')).toBe('still-here')
  expect(store.create('cedar', 'panel').name).toBe('cedar')
  expect(existsSync(join(shared, 'registry.json'))).toBe(false)
  expect(existsSync(join(shared, 'profiles'))).toBe(false)
  expect(
    createConfiguredProfileStore({
      ...loadConfig(env),
      shared: {
        root: shared,
        workspaceId: env.BROCREW_PLUGIN_OWNER_ID,
        workspaceLabel: 'QA Alpha',
        migrationApproved: true,
      },
    }).shared,
  ).toBeUndefined()
})
it('OFF ignores unused shared environment fields exactly as the local-only plugin does', () => {
  vi.spyOn(release, 'sharedProfilesReleased').mockReturnValue(false)
  const { env } = fixture()
  expect(
    loadConfig({
      ...env,
      BROCREW_CHROME_SHARED: 'relative-missing',
      BROCREW_PLUGIN_OWNER_ID: '../invalid',
    }).shared,
  ).toBeUndefined()
})
it('ON requires host capability and admits facade and rename migration together on fictional folders', () => {
  vi.spyOn(release, 'sharedProfilesReleased').mockReturnValue(true)
  const { env, home, shared } = fixture()
  const local = createProfileStore({ home: home })
  local.create('fern', 'panel')
  const source = local.dirOf('fern')
  const before = statSync(source).ino
  const createShared = core.createSharedProfileStore
  const admitted = vi.spyOn(core, 'createSharedProfileStore').mockImplementation((options) => {
    expect(options.migrationApproved).toBe(true)
    return createShared({ ...options, chromeState: () => 'ended' })
  })
  const configured = loadConfig(env)
  expect(configured.shared?.migrationApproved).toBe(true)
  const store = createConfiguredProfileStore(configured)
  expect(store.shared).toBeDefined()
  expect(admitted).toHaveBeenCalledOnce()
  expect(store.get('fern')).toBeDefined()
  expect(store.dirOf('fern')).toBe(join(shared, 'profiles', 'fern'))
  expect(statSync(store.dirOf('fern')).ino).toBe(before)
  expect(existsSync(source)).toBe(false)
  expect(
    createConfiguredProfileStore(loadConfig(withBootstrap(env, { sharedDataDirectory: undefined })))
      .shared,
  ).toBeUndefined()
  expect(() => loadConfig({ ...env, BROCREW_PLUGIN_OWNER_ID: '../invalid' })).toThrow()
})

// D1 oracles are authored RED candidates; execution remains a Root-owned gate.
it.each([
  { fallback: '../invalid', priorOwner: undefined },
  {
    fallback: '11111111-1111-4111-8111-111111111111',
    priorOwner: { ownerId: '../invalid', ownerLabel: 'fictional' },
  },
])(
  'OFF ignores only the unused shared owner UUID and preserves local bytes: %j',
  ({ fallback, priorOwner }) => {
    vi.spyOn(release, 'sharedProfilesReleased').mockReturnValue(false)
    const { env, home, shared } = fixture()
    const local = createProfileStore({ home })
    local.create('fern', 'panel')
    const file = join(home, 'profiles.json')
    const before = readFileSync(file)
    const opaque = join(local.dirOf('fern'), 'Cookies')
    writeFileSync(opaque, 'opaque fictional account')
    const inode = statSync(local.dirOf('fern')).ino
    const config = loadConfig({
      ...withBootstrap(env, { priorOwner }),
      BROCREW_PLUGIN_OWNER_ID: fallback,
    })
    const store = createConfiguredProfileStore(config)
    expect(config.home).toBe(home)
    expect(config.shared).toBeUndefined()
    expect(store.shared).toBeUndefined()
    expect(store.dirOf('fern')).toBe(local.dirOf('fern'))
    expect(statSync(store.dirOf('fern')).ino).toBe(inode)
    expect(readFileSync(file)).toEqual(before)
    expect(readFileSync(opaque, 'utf8')).toBe('opaque fictional account')
    expect(existsSync(join(shared, 'registry.json'))).toBe(false)
    expect(existsSync(join(shared, 'profiles'))).toBe(false)
  },
)
it.each([
  { priorOwner: undefined },
  { priorOwner: { ownerId: '../invalid', ownerLabel: 'fictional' } },
])('ON still rejects an invalid shared UUID before storage effects: %j', (extra) => {
  vi.spyOn(release, 'sharedProfilesReleased').mockReturnValue(true)
  const { env, home, shared } = fixture()
  expect(() =>
    loadConfig({ ...withBootstrap(env, extra), BROCREW_PLUGIN_OWNER_ID: '../invalid' }),
  ).toThrow('identity')
  expect(existsSync(join(home, 'files'))).toBe(false)
  expect(existsSync(join(shared, 'profiles'))).toBe(false)
  expect(existsSync(join(shared, 'registry.json'))).toBe(false)
})
it.each([false, true])(
  'release %s still rejects malformed declared bootstrap paths and owner shapes before effects',
  (on) => {
    vi.spyOn(release, 'sharedProfilesReleased').mockReturnValue(on)
    for (const extra of [
      { dataDirectory: 'relative' },
      { sharedDataDirectory: 'relative' },
      { sharedDataDirectory: 1 },
      { priorOwner: null },
      { priorOwner: [] },
      { priorOwner: { ownerId: 1, ownerLabel: 'fictional' } },
      { priorOwner: { ownerId: '11111111-1111-4111-8111-111111111111' } },
      { legacyConfiguration: { directory: 'relative', floor: '/fictional' } },
    ]) {
      const { env, home, shared } = fixture()
      expect(() => loadConfig(withBootstrap(env, extra))).toThrow('Plugin unavailable')
      expect(existsSync(join(home, 'files'))).toBe(false)
      expect(existsSync(join(shared, 'registry.json'))).toBe(false)
      expect(existsSync(join(shared, 'profiles'))).toBe(false)
    }
  },
)
