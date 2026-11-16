import { afterEach, expect, it, vi } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { resolveProviderConnection } from '../src/main/connections/records'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import { fixtureProviderConfig, neutralHostDeps } from './lib/host-fixture'

const worlds: AServiceWorld[] = []
const hosts: RuntimeHost[] = []
const saved = new Set<Provider>()
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.closeAll()))
  await Promise.all(worlds.splice(0).map((world) => world.cleanUp()))
  vi.restoreAllMocks()
})

function fixture(provider: Provider) {
  saved.clear()
  const world = aServiceWorld()
  worlds.push(world)
  world.anAgent('fern', 'normal', provider)
  const prepare = vi.fn(() => world.folder)
  const create = vi.fn((provider: Provider) => new FakeRuntime(provider))
  const connectionFor = vi.fn((provider: Provider, connectionId?: string | null) =>
    resolveProviderConnection(world.db, { provider, connectionId, keySaved: saved.has(provider) }),
  )
  const host = new RuntimeHost({
    ...neutralHostDeps(() => world.folder),
    store: world.store,
    resolveCwd: () => world.folder,
    newSessionId: () => 'fictional-unused-listing',
    readProviderConfig: fixtureProviderConfig,
    providerHomePath: () => world.folder,
    createRuntime: create,
    connectionFor,
    prepareProviderHome: prepare,
    listProfiles: () => ['fern'],
  })
  hosts.push(host)
  return {
    store: world.store,
    host,
    dir: world.folder,
    sink: world.window,
    create,
    prepare,
    connectionFor,
  }
}

for (const provider of ['claude', 'codex'] as const) {
  for (const withRef of [false, true]) {
    for (const bound of [false, true]) {
      it(`${provider}: the public listing retains the recorded connection (${withRef ? 'resumable' : 'unresumable'}, ${bound ? 'bound' : 'legacy'})`, async () => {
        const f = fixture(provider)
        const { dir, host, sink } = f
        const id = 'fictional-title-listing'
        f.store.create({
          id,
          provider,
          profileId: 'fern',
          cwd: dir,
          approvalMode: 'ask',
          ...(bound ? { connectionId: `${provider}:sign-in` } : {}),
          ...(withRef ? { launchedAs: 'fictional-provider-ref' } : {}),
        })
        if (withRef)
          expect(
            f.store.nameItsLaunch(id, {
              provider,
              sessionId: 'fictional-provider-ref',
              cwd: dir,
              rotation: 0,
            }),
          ).toBe(true)
        saved.add(provider)
        f.connectionFor.mockClear()
        const rows = await executeRuntimeCommand(host, sink, {
          kind: withRef ? 'listResumable' : 'listUnresumable',
        })
        expect(rows).toHaveLength(1)
        expect(rows).toMatchObject([
          { sessionId: id, provider, connectionId: bound ? `${provider}:sign-in` : null },
        ])
        expect(f.store.connectionOf(id)).toBe(bound ? `${provider}:sign-in` : null)
        expect(f.connectionFor).not.toHaveBeenCalled()
        expect(f.prepare).not.toHaveBeenCalled()
        expect(f.create).not.toHaveBeenCalled()
      })
    }
  }
}
