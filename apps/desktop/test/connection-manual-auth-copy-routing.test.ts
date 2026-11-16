import { afterEach, expect, it, vi } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FakeRuntime } from '@brobot2/runtime'
import type { Provider, ProviderConnection } from '@brobot2/shared'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { ProviderConnectionUnavailable } from '../src/main/connections/records'
import type { ProviderAuthOps } from '../src/main/providers/auth-operations'
import type { ProviderHomePaths } from '../src/main/providers/module'
import { codexAuth } from '../src/main/providers/codex'
import { providerAuthFromHomes } from '../src/main/providers'
import { deriveProviderHome } from '../src/main/connections/homes'
import { claimResource } from '../src/main/runtime/held-resources'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import { fixtureProviderConfig, neutralHostDeps } from './lib/host-fixture'

type Recopy = (
  provider: Provider,
  profileId: string,
  connection?: ProviderConnection,
) => ReturnType<ProviderAuthOps['reprovision']>
type HomeRecopy = (
  profileId: string,
  connection?: ProviderConnection,
) => ReturnType<ProviderAuthOps['reprovision']>
let world: AServiceWorld
let host: RuntimeHost
afterEach(async () => {
  await host?.closeAll()
  await world?.cleanUp()
  vi.restoreAllMocks()
})

function fixture(resolver = true) {
  world = aServiceWorld()
  world.anAgent('fern', 'normal', 'codex')
  const rows: ProviderConnection[] = ['a', 'b'].map((id) => ({
    id: `fictional-copy-${id}`,
    provider: 'codex',
    name: `Fictional copy ${id}`,
    authMethod: id === 'a' ? 'sign-in' : 'api-key',
    credentialSource: id === 'a' ? 'provider-sign-in' : 'provider-api-key',
    baseUrl: null,
    enabled: true,
    contractVersion: 1,
  }))
  const [a, b] = rows
  if (!a || !b) throw new Error('Both fictional connections are required')
  for (const row of rows)
    world.db
      .prepare(
        'INSERT INTO provider_connection(id,provider,name,auth_method,credential_source) VALUES(?,?,?,?,?)',
      )
      .run(row.id, row.provider, row.name, row.authMethod, row.credentialSource)
  world.store.setModelChoice('fern', {
    provider: 'codex',
    model: 'fake-codex-a',
    effort: 'medium',
    connectionId: b.id,
  })
  const home = (provider: Provider, profileId: string, row?: ProviderConnection) =>
    deriveProviderHome(world.folder, { provider, profileId, connectionId: row?.id })
  const file = (row?: ProviderConnection) => join(home('codex', 'fern', row), 'auth.json')
  const before = JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: { account_id: 'acct-fictional-manual' },
    last_refresh: '2026-10-01T00:00:00Z',
    fixture: 'before',
  })
  const fresh = JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: { account_id: 'acct-fictional-manual' },
    last_refresh: '2026-11-01T00:00:00Z',
    fixture: 'fresh',
  })
  for (const row of [a, b, undefined]) {
    mkdirSync(home('codex', 'fern', row), { recursive: true })
    writeFileSync(file(row), before)
  }
  const machine = join(world.folder, 'fictional-machine-auth.json')
  writeFileSync(machine, fresh)
  const credentialHome = vi.fn<ProviderAuthOps['credentialHome']>(home)
  const noGesture = vi.fn((): never => {
    throw new Error('No sign-in, key or program operation')
  })
  const recopy = vi.fn<Recopy>(async (provider, profileId, row): Promise<'replaced'> => {
    writeFileSync(join(home(provider, profileId, row), 'auth.json'), fresh)
    return 'replaced'
  })
  const resolve = vi.fn((provider: Provider, id?: string | null) => {
    const row = rows.find((one) => one.provider === provider && (one.id === id || one.name === id))
    if (!row) throw new ProviderConnectionUnavailable()
    return row
  })
  const invalidates = vi.fn()
  host = new RuntimeHost({
    ...neutralHostDeps(() => world.folder),
    store: world.store,
    createRuntime: () => new FakeRuntime('codex'),
    newSessionId: () => 'fictional-manual-copy',
    providersMoved: invalidates,
    prepareProviderHome: noGesture,
    providerHomePath: (p, profile) => home(p, profile),
    ...(resolver ? { connectionFor: resolve } : {}),
    providerAuth: {
      credentialHome,
      reprovision: recopy,
      signIn: noGesture,
      replaceARefusedCopy: noGesture,
      check: async () => ({ state: 'absent', reason: 'Fictional absent login' }),
    },
    listProfiles: () => ['brobot', 'fern'],
    resolveCwd: () => world.folder,
    readProviderConfig: fixtureProviderConfig,
  })
  const run = (id?: string, provider: Provider = 'codex') =>
    executeRuntimeCommand(host, world.window, {
      kind: 'reprovisionProviderAuth',
      provider,
      profileId: 'fern',
      ...(id === undefined ? {} : { connectionId: id }),
    })
  return {
    a,
    b,
    home,
    file,
    before,
    fresh,
    machine,
    credentialHome,
    recopy,
    resolve,
    noGesture,
    invalidates,
    run,
  }
}

for (const alias of [false, true]) {
  it(`the public re-copy command qualifies ${alias ? 'alias' : 'ID'} A despite the agent default B`, async () => {
    const f = fixture()
    expect(await f.run(alias ? f.a.name : f.a.id)).toBe('replaced')
    expect(f.resolve).toHaveBeenCalledExactlyOnceWith('codex', alias ? f.a.name : f.a.id)
    expect(f.credentialHome).toHaveBeenCalledExactlyOnceWith('codex', 'fern', f.a)
    expect(f.recopy).toHaveBeenCalledExactlyOnceWith('codex', 'fern', f.a)
    expect(f.recopy.mock.calls[0]?.[2]).toBe(f.a)
    expect(readFileSync(f.file(f.a), 'utf8')).toBe(f.fresh)
    expect(readFileSync(f.file(f.b), 'utf8')).toBe(f.before)
    expect(readFileSync(f.file(), 'utf8')).toBe(f.before)
    expect(world.store.modelChoiceOf('fern')?.connectionId).toBe(f.b.id)
    expect(f.noGesture).not.toHaveBeenCalled()
  })
}

it('an omitted re-copy selection retains old claim and writer arities without resolving a default', async () => {
  const f = fixture()
  expect(await f.run()).toBe('replaced')
  expect(f.resolve).not.toHaveBeenCalled()
  expect(f.credentialHome).toHaveBeenCalledExactlyOnceWith('codex', 'fern')
  expect(f.recopy).toHaveBeenCalledExactlyOnceWith('codex', 'fern')
  expect(readFileSync(f.file(), 'utf8')).toBe(f.fresh)
  expect(readFileSync(f.file(f.a), 'utf8')).toBe(f.before)
})

for (const invalid of ['unknown', 'provider', 'no-resolver'] as const) {
  it(`${invalid} explicit re-copy is refused before home claims, invalidation or writes`, async () => {
    const f = fixture(invalid !== 'no-resolver')
    await expect(
      f.run(
        invalid === 'unknown' ? 'missing-connection' : f.a.id,
        invalid === 'provider' ? 'claude' : 'codex',
      ),
    ).rejects.toBeInstanceOf(ProviderConnectionUnavailable)
    expect(f.credentialHome).not.toHaveBeenCalled()
    expect(f.recopy).not.toHaveBeenCalled()
    expect(f.invalidates).not.toHaveBeenCalled()
    for (const row of [f.a, f.b, undefined])
      expect(readFileSync(f.file(row), 'utf8')).toBe(f.before)
  })
}

for (const blocked of ['a', 'legacy'] as const) {
  it(`a ${blocked} claim ${blocked === 'a' ? 'holds' : 'does not hold'} a re-copy to A`, async () => {
    const f = fixture()
    const held = claimResource(
      `credential:${f.home('codex', 'fern', blocked === 'a' ? f.a : undefined)}`,
      'Fictional other writer',
    )
    if (!held.ok) throw new Error('Fixture claim was already held')
    try {
      if (blocked === 'a') {
        await expect(f.run(f.a.id)).rejects.toThrow()
        expect(f.recopy).not.toHaveBeenCalled()
      } else expect(await f.run(f.a.id)).toBe('replaced')
      expect(readFileSync(f.file(f.b), 'utf8')).toBe(f.before)
      expect(readFileSync(f.file(), 'utf8')).toBe(f.before)
    } finally {
      held.claim.release()
    }
  })
}

function nativeFixture(status: 'saved' | 'throws' | 'unset') {
  const f = fixture()
  const keyPresence = vi.fn(() => {
    if (status === 'throws') throw new Error('Fictional unreadable key status')
    return status === 'saved'
  })
  const homeOf = vi.fn((profileId: string, connectionId?: string) =>
    deriveProviderHome(world.folder, { provider: 'codex', profileId, connectionId }),
  )
  const machineAuthPath = vi.fn(() => f.machine)
  const paths: ProviderHomePaths = {
    managedRoot: world.folder,
    defaultProfile: 'brobot',
    homeOf,
    profiles: () => ['brobot', 'fern'],
    assertMayOpen: () => {},
  }
  const native = codexAuth(paths, {
    command: f.noGesture,
    machineAuthPath,
    key: { isSaved: keyPresence, current: f.noGesture, change: async () => f.noGesture() },
  })
  const bound = providerAuthFromHomes({ claude: native, codex: native })
  const direct: HomeRecopy = native.reprovision.bind(native)
  const forwarded: Recopy = bound.reprovision.bind(bound)
  return { ...f, keyPresence, homeOf, machineAuthPath, direct, forwarded }
}

for (const adapted of [false, true]) {
  for (const status of ['saved', 'throws', 'unset'] as const) {
    it(`${adapted ? 'bound' : 'native'} sign-in A re-copy ignores ${status} global status and changes only A`, async () => {
      const f = nativeFixture(status)
      expect(await (adapted ? f.forwarded('codex', 'fern', f.a) : f.direct('fern', f.a))).toBe(
        'replaced',
      )
      expect(f.keyPresence).not.toHaveBeenCalled()
      expect(f.noGesture).not.toHaveBeenCalled()
      expect(f.machineAuthPath).toHaveBeenCalledOnce()
      expect(f.homeOf).toHaveBeenCalledWith('fern', f.a.id)
      expect(readFileSync(f.file(f.a), 'utf8')).toBe(f.fresh)
      expect(readFileSync(f.file(f.b), 'utf8')).toBe(f.before)
      expect(readFileSync(f.file(), 'utf8')).toBe(f.before)
    })
  }
  it(`${adapted ? 'bound' : 'native'} API-key re-copy refuses before global status, provisioning or source access`, async () => {
    const f = nativeFixture('unset')
    await expect(
      Promise.resolve().then(() =>
        adapted ? f.forwarded('codex', 'fern', f.b) : f.direct('fern', f.b),
      ),
    ).rejects.toThrow()
    expect(f.keyPresence).not.toHaveBeenCalled()
    expect(f.homeOf).not.toHaveBeenCalled()
    expect(f.machineAuthPath).not.toHaveBeenCalled()
    for (const row of [f.a, f.b, undefined])
      expect(readFileSync(f.file(row), 'utf8')).toBe(f.before)
  })
  for (const status of ['saved', 'throws'] as const) {
    it(`${adapted ? 'bound' : 'native'} omitted re-copy retains the ${status} legacy global-key veto`, async () => {
      const f = nativeFixture(status)
      await expect(
        Promise.resolve().then(() => (adapted ? f.forwarded('codex', 'fern') : f.direct('fern'))),
      ).rejects.toThrow('An API key is saved for Codex')
      expect(f.keyPresence).toHaveBeenCalledOnce()
      expect(f.homeOf).not.toHaveBeenCalled()
      expect(f.machineAuthPath).not.toHaveBeenCalled()
    })
  }
}
