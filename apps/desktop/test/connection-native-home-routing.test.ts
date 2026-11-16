import { afterEach, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { providerRecord, type Provider, type ProviderConnection } from '@brobot2/shared'
import * as codexRuntimeModule from '@brobot2/runtime/codex'
import * as boundProviders from '../src/main/providers'
import { createProviderModules, providerAuthFromModules } from '../src/main/providers'
import {
  deriveProviderHome,
  homePathsForProvider,
  prepareProviderHome,
  providerHomesRoot,
  DEFAULT_PROFILE_ID,
} from '../src/main/connections/homes'

const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function nativeHomes(useCopyPrimitive = false) {
  const root = mkdtempSync(join(tmpdir(), 'fictional-native-connections-'))
  roots.push(root)
  const provision = vi.fn((_managed: string, home: string) => {
    mkdirSync(home, { recursive: true })
  })
  const copied = vi.fn()
  const paths = providerRecord((provider) => homePathsForProvider(root, provider))
  const modules = createProviderModules((provider) => paths[provider], {
    claude: {
      runtime: { program: () => '/fictional/claude', key: () => 'fictional-key' },
      home: {
        provisionHome: provision,
        key: () => 'fictional-key',
        login: async () => 'fictional-login',
        health: async () => ({ ok: true }),
      },
      auth: {},
    },
    codex: {
      runtime: { command: () => '/fictional/codex' },
      home: {
        provisionHome: provision,
        provisionCodexAuth: useCopyPrimitive ? undefined : copied,
        key: {
          current: () => ({ key: 'fictional-key', setAt: 1 }),
          change: async (_home, change) => ({
            ok: true,
            authMethod: change?.to === 'the-key' ? 'apikey' : null,
          }),
        },
      },
      auth: { command: () => '/fictional/codex' },
    },
  })
  return { root, modules, provision, copied, paths }
}

function connection(
  provider: Provider,
  id: string,
  method: 'api-key' | 'sign-in',
): ProviderConnection {
  return {
    id,
    provider,
    name: 'Fictional selected route',
    authMethod: method,
    credentialSource: method === 'api-key' ? 'provider-api-key' : 'provider-sign-in',
    baseUrl: null,
    enabled: true,
    contractVersion: 1,
  }
}

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: bound home paths carry a canonical additional connection id`, () => {
    const { root } = nativeHomes()
    const paths = homePathsForProvider(root, provider)
    const homeOf: (profile: string, id?: string) => string = paths.homeOf.bind(paths)
    const id = 'fictional-server-a'
    expect(homeOf('fern', id)).toBe(
      deriveProviderHome(root, { profileId: 'fern', provider, connectionId: id }),
    )
    expect(homeOf('fern', id)).not.toBe(homeOf('fern'))
  })

  it(`${provider}: the credential reservation names the same selected home without provisioning`, () => {
    const { root, modules, provision, copied } = nativeHomes()
    const auth = providerAuthFromModules(modules)
    const homeOf: (provider: Provider, profile: string, selected?: ProviderConnection) => string =
      auth.credentialHome.bind(auth)
    const selected = connection(provider, 'fictional-server-a', 'sign-in')
    expect(homeOf(provider, 'fern', selected)).toBe(
      deriveProviderHome(root, { profileId: 'fern', provider, connectionId: selected.id }),
    )
    expect(provision).not.toHaveBeenCalled()
    expect(copied).not.toHaveBeenCalled()
  })

  for (const method of ['api-key', 'sign-in'] as const) {
    it(`${provider}: real ${method} preparation returns each additional route's own home`, async () => {
      const { root, modules, copied } = nativeHomes()
      const selected = ['fictional-server-a', 'fictional-server-b'].map((id) =>
        connection(provider, id, method),
      )
      const homes: string[] = []
      for (const route of selected) {
        const prepared = await modules[provider].prepareLaunch('fern', route)
        homes.push(prepared.home)
        expect(prepared.home).toBe(
          deriveProviderHome(root, { profileId: 'fern', provider, connectionId: route.id }),
        )
        expect(prepared.runtime.provider).toBe(provider)
      }
      expect(homes[0]).not.toBe(homes[1])
      if (provider === 'codex' && method === 'api-key') expect(copied).not.toHaveBeenCalled()
    })
  }
}

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: omitted reservation and preparation keep their old forwarding arity`, async () => {
    const { root, modules, paths, provision } = nativeHomes()
    const reserved = vi.spyOn(modules[provider].auth, 'credentialHome')
    const home = vi.spyOn(paths[provider], 'homeOf')
    const legacy = deriveProviderHome(root, { profileId: 'fern', provider })
    expect(providerAuthFromModules(modules).credentialHome(provider, 'fern')).toBe(legacy)
    expect(reserved).toHaveBeenCalledExactlyOnceWith('fern')
    expect(home).toHaveBeenCalledExactlyOnceWith('fern')
    expect(provision).not.toHaveBeenCalled()
    home.mockClear()
    expect((await modules[provider].prepareLaunch('fern')).home).toBe(legacy)
    expect(home).toHaveBeenCalledExactlyOnceWith('fern')
  })
}

it('the selected Codex check probes its additional home rather than the default home', async () => {
  const { root, modules } = nativeHomes()
  mkdirSync(deriveProviderHome(root, { profileId: 'fern', provider: 'codex' }), { recursive: true })
  const probe = vi.spyOn(codexRuntimeModule, 'probeCodexAuthInHome').mockResolvedValue({
    state: 'unknown',
    reason: 'Fictional probe result',
  })
  const selected = connection('codex', 'fictional-server-a', 'sign-in')
  const home = deriveProviderHome(root, {
    profileId: 'fern',
    provider: 'codex',
    connectionId: selected.id,
  })
  await expect(
    providerAuthFromModules(modules).check('codex', 'fern', undefined, selected),
  ).resolves.toEqual({ state: 'unknown', reason: 'Fictional probe result' })
  expect(probe).toHaveBeenCalledExactlyOnceWith(expect.any(Function), home, home, undefined)
})

it('Codex initial preparation names the fallback copy from the same additional connection', async () => {
  const { root, modules } = nativeHomes(true)
  const copy = vi.spyOn(codexRuntimeModule, 'provisionCodexAuth').mockResolvedValue(undefined)
  const selected = connection('codex', 'fictional-server-a', 'sign-in')
  const home = deriveProviderHome(root, {
    profileId: 'fern',
    provider: 'codex',
    connectionId: selected.id,
  })
  const fallback = deriveProviderHome(root, {
    profileId: DEFAULT_PROFILE_ID,
    provider: 'codex',
    connectionId: selected.id,
  })
  await modules.codex.prepareLaunch('fern', selected)
  expect(copy).toHaveBeenCalledExactlyOnceWith(home, {
    managedRoot: providerHomesRoot(root),
    fallbackAuthPath: join(fallback, 'auth.json'),
  })
})

for (const id of [undefined, 'fictional-server-a']) {
  it(`the legacy home adapter ${id === undefined ? 'omits an absent route argument' : 'forwards an additional route argument'}`, async () => {
    const { root } = nativeHomes()
    const prepare = vi.fn(async () => '/fictional/prepared')
    vi.spyOn(boundProviders, 'homeStrategyFor').mockReturnValue({ prepare })
    const identity = {
      profileId: 'fern',
      provider: 'claude' as const,
      ...(id === undefined ? {} : { connectionId: id }),
    }
    await expect(prepareProviderHome(root, identity)).resolves.toBe('/fictional/prepared')
    expect(prepare.mock.calls).toEqual([id === undefined ? ['fern'] : ['fern', id]])
  })
}
