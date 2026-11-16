import { afterEach, expect, it, vi } from 'vitest'
import { mkdirSync } from 'node:fs'
import { FakeRuntime, type ModelChoice } from '@brobot2/runtime'
import { providerRecord, type Provider, type ProviderConnection } from '@brobot2/shared'
import { RuntimeHost, type RuntimeHostDeps } from '../src/main/runtime/runtime-host'
import { ModelCatalogues } from '../src/main/connections/catalogues'
import { ProviderConnectionUnavailable } from '../src/main/connections/records'
import { deriveProviderHome } from '../src/main/connections/homes'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { PROVIDER_NAME } from '../src/shared/runtime-ipc'
import { STAND_IN_PROFILE } from '../src/shared/model-choice'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import { callOn } from './helpers/call-tool'
import { fixtureProviderConfig, neutralHostDeps } from './lib/host-fixture'

let world: AServiceWorld
let host: RuntimeHost
afterEach(async () => {
  await host?.closeAll()
  await world?.cleanUp()
  vi.restoreAllMocks()
})

async function fixture(
  owner: Provider,
  options: { resolver?: boolean; ambiguous?: boolean; shadow?: boolean } = {},
) {
  world = aServiceWorld()
  const caller: Provider = owner === 'claude' ? 'codex' : 'claude'
  world.anAgent('caller', 'normal', caller)
  world.anAgent('defaults', 'normal', owner)
  const rows: ProviderConnection[] = (['claude', 'codex'] as const).flatMap((provider) =>
    (['builtin', 'api-key', 'a', 'b'] as const).map((kind): ProviderConnection => ({
      id:
        kind === 'builtin'
          ? `${provider}:sign-in`
          : kind === 'api-key'
            ? `${provider}:api-key`
            : `${provider}-${kind}`,
      provider,
      name:
        kind === 'a' && options.ambiguous
          ? 'Shared endpoint'
          : kind === 'a' && options.shadow && provider !== owner
            ? `${owner}-a`
            : `${provider} endpoint ${kind}`,
      authMethod: kind === 'api-key' ? 'api-key' : 'sign-in',
      credentialSource: kind === 'api-key' ? 'provider-api-key' : 'provider-sign-in',
      baseUrl: null,
      enabled: true,
      contractVersion: 1,
    })),
  )
  for (const row of rows.filter((one) => one.id.endsWith('-a') || one.id.endsWith('-b')))
    world.db
      .prepare(
        'INSERT INTO provider_connection(id,provider,name,auth_method,credential_source) VALUES(?,?,?,?,?)',
      )
      .run(row.id, row.provider, row.name, row.authMethod, row.credentialSource)
  const a = rows.find((row) => row.id === `${owner}-a`)!
  const b = rows.find((row) => row.id === `${owner}-b`)!
  const resolve = vi.fn<NonNullable<RuntimeHostDeps['connectionFor']>>((provider, id) => {
    const found = rows.find(
      (row) =>
        row.provider === provider && (row.id === (id ?? `${provider}:sign-in`) || row.name === id),
    )
    if (found === undefined) throw new ProviderConnectionUnavailable()
    return found
  })
  const versions = vi.fn<NonNullable<RuntimeHostDeps['providerVersions']>>(async () =>
    providerRecord(() => ({ version: null, reason: 'Fictional version unavailable' })),
  )
  const models = (provider: Provider, row?: ProviderConnection): ModelChoice[] => {
    const scope = row?.id === `${provider}-a` ? 'a' : row?.id === `${provider}-b` ? 'b' : 'global'
    const effort = scope === 'a' ? 'medium' : scope === 'b' ? 'high' : 'low'
    const result: ModelChoice[] = [
      {
        id: `model-${scope}-${provider}`,
        label: scope,
        ...(scope !== 'global' || provider !== 'claude' ? { isDefault: true as const } : {}),
        efforts: [{ id: effort, label: effort }],
        defaultEffort: effort,
      },
      {
        id: 'shared-model',
        label: 'Shared model',
        efforts: [{ id: effort, label: effort }],
        defaultEffort: effort,
      },
    ]
    if (scope === 'global' && provider === 'claude')
      result.push({
        id: 'default',
        label: 'Default',
        isDefault: true,
        efforts: [{ id: 'medium', label: 'Medium' }],
        defaultEffort: 'medium',
      })
    return result
  }
  const home = (provider: Provider, profileId: string, row?: ProviderConnection) => {
    const path = deriveProviderHome(world.folder, { provider, profileId, connectionId: row?.id })
    mkdirSync(path, { recursive: true })
    return path
  }
  const prepare = vi.fn<NonNullable<RuntimeHostDeps['prepareProviderLaunch']>>(
    async (provider, profileId, row) => {
      const runtime = new FakeRuntime(provider)
      vi.spyOn(runtime, 'listModels').mockResolvedValue(models(provider, row))
      return { home: home(provider, profileId, row), runtime }
    },
  )
  let number = 0
  host = new RuntimeHost({
    ...neutralHostDeps(() => world.folder),
    store: world.store,
    createRuntime: (provider) => new FakeRuntime(provider),
    prepareProviderHome: async (provider, profileId) => home(provider, profileId),
    providerHomePath: (provider, profileId) => home(provider, profileId),
    prepareProviderLaunch: prepare,
    ...(options.resolver === false ? {} : { connectionFor: resolve }),
    listConnections: () => rows,
    providerVersions: versions,
    listProfiles: () => ['brobot', 'caller', 'defaults'],
    resolveCwd: () => world.folder,
    readProviderConfig: fixtureProviderConfig,
    newSessionId: () => `fictional-creator-${++number}`,
  })
  const created = await host.createSession(
    { provider: caller, profileId: 'caller', connectionId: `${caller}:sign-in`, cwd: world.folder },
    world.window,
  )
  const tools = agentToolsFor(host, created.sessionId)
  const mint = vi.spyOn(world.store, 'createAgentIdentity')
  const judged = vi.spyOn(ModelCatalogues.prototype, 'judgeTheDefaultItNames')
  const starts = vi.spyOn(FakeRuntime.prototype, 'start')
  prepare.mockClear()
  resolve.mockClear()
  versions.mockClear()
  const create = (args: Record<string, unknown>) =>
    callOn(tools, 'create_agent', { profile_slug: 'minted', ...args })
  const choice = () => world.store.modelChoiceOf('minted')
  const noWork = () => {
    expect(judged).not.toHaveBeenCalled()
    expect(prepare).not.toHaveBeenCalled()
    expect(versions).not.toHaveBeenCalled()
    expect(mint).not.toHaveBeenCalled()
    expect(starts).not.toHaveBeenCalled()
    expect(world.store.agentIdentities().some((one) => one.slug === 'minted')).toBe(false)
  }
  return { a, b, caller, resolve, prepare, versions, mint, judged, starts, create, choice, noWork }
}

for (const owner of ['claude', 'codex'] as const) {
  for (const alias of [false, true]) {
    it(`${owner}: create from another provider resolves ${alias ? 'an alias' : 'a canonical ID'} before reading A's model`, async () => {
      const f = await fixture(owner)
      const answer = await f.create({
        connectionId: alias ? f.a.name : f.a.id,
        model: `model-a-${owner}`,
      })
      expect(answer['outcome']).toBe('ok')
      expect(f.choice()).toEqual({
        provider: owner,
        model: `model-a-${owner}`,
        effort: 'medium',
        connectionId: f.a.id,
      })
      expect(world.store.agentIdentities().find((one) => one.slug === 'minted')?.provider).toBe(
        owner,
      )
      expect(f.prepare).toHaveBeenCalledExactlyOnceWith(owner, STAND_IN_PROFILE, f.a)
      expect(f.starts).not.toHaveBeenCalled()
    })
  }

  it(`${owner}: connection-only create keeps A's default instead of B's last pair`, async () => {
    const f = await fixture(owner)
    world.store.setModelChoice('defaults', {
      provider: owner,
      model: `model-b-${owner}`,
      effort: 'high',
      connectionId: f.b.id,
    })
    expect((await f.create({ connectionId: f.a.id }))['outcome']).toBe('ok')
    expect(f.choice()).toEqual({
      provider: owner,
      model: `model-a-${owner}`,
      effort: 'medium',
      connectionId: f.a.id,
    })
    expect(world.store.modelChoiceOf('defaults')?.connectionId).toBe(f.b.id)
    expect(f.starts).not.toHaveBeenCalled()
  })

  it(`${owner}: named provider and A's shared model use A's effort instead of legacy`, async () => {
    const f = await fixture(owner)
    expect(
      (await f.create({ provider: owner, connectionId: f.a.id, model: 'shared-model' }))['outcome'],
    ).toBe('ok')
    expect(f.choice()).toEqual({
      provider: owner,
      model: 'shared-model',
      effort: 'medium',
      connectionId: f.a.id,
    })
    expect(f.prepare).toHaveBeenCalledExactlyOnceWith(owner, STAND_IN_PROFILE, f.a)
  })

  it(`${owner}: a B-only model cannot be minted under A`, async () => {
    const f = await fixture(owner)
    expect(
      (await f.create({ provider: owner, connectionId: f.a.id, model: `model-b-${owner}` }))[
        'outcome'
      ],
    ).toBe('refused')
    expect(f.mint).not.toHaveBeenCalled()
    expect(f.prepare).toHaveBeenCalledExactlyOnceWith(owner, STAND_IN_PROFILE, f.a)
    expect(f.starts).not.toHaveBeenCalled()
  })

  it(`${owner}: listed-but-unavailable A is rejected before models or mint`, async () => {
    const f = await fixture(owner)
    f.resolve.mockImplementation(() => {
      throw new ProviderConnectionUnavailable()
    })
    expect((await f.create({ provider: owner, connectionId: f.a.id }))['outcome']).toBe('refused')
    f.noWork()
  })

  it(`${owner}: mismatching named provider is one plain refusal before models or mint`, async () => {
    const f = await fixture(owner)
    const answer = await f.create({
      provider: f.caller,
      connectionId: f.a.id,
      model: 'shared-model',
    })
    expect(answer['outcome']).toBe('refused')
    expect(answer['reason']).toBe(
      `This connection belongs to ${PROVIDER_NAME[owner]}; the request named ${PROVIDER_NAME[f.caller]}.`,
    )
    f.noWork()
  })

  it(`${owner}: unknown connection is rejected before models or mint`, async () => {
    const f = await fixture(owner)
    expect(
      (await f.create({ provider: owner, connectionId: 'fictional-missing' }))['outcome'],
    ).toBe('refused')
    f.noWork()
  })

  it(`${owner}: ambiguous alias is refused across providers even when a provider is named`, async () => {
    const f = await fixture(owner, { ambiguous: true })
    expect(
      (await f.create({ provider: owner, connectionId: 'Shared endpoint', model: 'shared-model' }))[
        'outcome'
      ],
    ).toBe('refused')
    f.noWork()
  })

  it(`${owner}: canonical ID wins over another provider's same-spelled alias`, async () => {
    const f = await fixture(owner, { shadow: true })
    expect((await f.create({ connectionId: f.a.id, model: 'shared-model' }))['outcome']).toBe('ok')
    expect(f.choice()?.provider).toBe(owner)
    expect(f.choice()?.connectionId).toBe(f.a.id)
    expect(f.resolve.mock.calls.every(([provider]) => provider === owner)).toBe(true)
    expect(f.prepare).toHaveBeenCalledExactlyOnceWith(owner, STAND_IN_PROFILE, f.a)
  })

  it(`${owner}: unexpected qualification errors propagate before models or mint`, async () => {
    const f = await fixture(owner)
    const failure = new Error('Fictional registry read failed')
    f.resolve.mockImplementation(() => {
      throw failure
    })
    await expect(f.create({ connectionId: f.a.id, model: 'shared-model' })).rejects.toBe(failure)
    f.noWork()
  })

  it(`${owner}: an absent qualifier cannot mint an explicit connection default`, async () => {
    const f = await fixture(owner, { resolver: false })
    expect(
      (await f.create({ provider: owner, connectionId: f.a.id, model: `model-global-${owner}` }))[
        'outcome'
      ],
    ).toBe('refused')
    f.noWork()
  })

  for (const method of ['sign-in', 'api-key'] as const) {
    for (const named of [false, true]) {
      it(`${owner}: ${method === 'sign-in' ? 'builtin connection' : 'builtin API-key connection'} creation ${named ? 'with' : 'without'} a named provider retains legacy rows`, async () => {
        const f = await fixture(owner)
        expect(
          (
            await f.create({
              ...(named ? { provider: owner } : {}),
              connectionId: `${owner}:${method}`,
              model: `model-global-${owner}`,
            })
          )['outcome'],
        ).toBe('ok')
        expect(f.choice()).toEqual({
          provider: owner,
          model: `model-global-${owner}`,
          effort: 'low',
          connectionId: `${owner}:${method}`,
        })
        expect(f.starts).not.toHaveBeenCalled()
      })
    }
  }

  it(`${owner}: no-ID model inference remains unchanged across caller providers`, async () => {
    const f = await fixture(owner)
    expect((await f.create({ model: `model-global-${owner}` }))['outcome']).toBe('ok')
    expect(f.choice()).toEqual({ provider: owner, model: `model-global-${owner}`, effort: 'low' })
    expect(f.judged.mock.calls[0]?.[2]).toEqual({ model: `model-global-${owner}` })
    expect(f.starts).not.toHaveBeenCalled()
  })

  it(`${owner}: no-ID model create with no qualifier keeps its old delegation`, async () => {
    const f = await fixture(owner, { resolver: false })
    expect((await f.create({ provider: owner, model: `model-global-${owner}` }))['outcome']).toBe(
      'ok',
    )
    expect(f.choice()).toEqual({ provider: owner, model: `model-global-${owner}`, effort: 'low' })
    expect(f.judged.mock.calls[0]?.[2]).toEqual({ model: `model-global-${owner}` })
    expect(f.starts).not.toHaveBeenCalled()
  })

  it(`${owner}: no-ID empty create with no qualifier keeps the caller and no model`, async () => {
    const f = await fixture(owner, { resolver: false })
    expect((await f.create({}))['outcome']).toBe('ok')
    expect(world.store.agentIdentities().find((one) => one.slug === 'minted')?.provider).toBe(
      f.caller,
    )
    expect(f.choice()).toBeNull()
    expect(f.judged).not.toHaveBeenCalled()
    expect(f.prepare).not.toHaveBeenCalled()
    expect(f.versions).not.toHaveBeenCalled()
    expect(f.starts).not.toHaveBeenCalled()
  })
}
