import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { FakeRuntime, type ModelChoice, type StartOptions } from '@brobot2/runtime'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { NULL_SESSION_STORE } from '../src/main/db/session-store'
import { fixtureProviderConfig, neutralHostDeps, RecordingSink } from './lib/host-fixture'

it('a provider version refresh reaches the drawer, agent picker and launched aliases', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'brocrew-catalogue-version-'))
  const started: StartOptions[] = []
  let version = '2.1.321'
  let current = false
  let counter = 0
  const rows = (): ModelChoice[] => [
    {
      id: 'default',
      label: 'Default',
      resolvesTo: current ? 'opus-new' : 'sonnet-old',
      isDefault: true,
    },
    {
      id: 'fable',
      label: current ? 'Fable new' : 'Fable old',
      resolvesTo: current ? 'fable-new' : 'fable-old',
    },
  ]
  const host = new RuntimeHost({
    ...neutralHostDeps(() => folder),
    store: NULL_SESSION_STORE,
    readProviderConfig: fixtureProviderConfig,
    listProfiles: () => ['brobot', 'fern'],
    createRuntime: (provider) => {
      const runtime = new FakeRuntime(provider)
      return Object.assign(Object.create(runtime) as FakeRuntime, {
        listModels: async () => rows(),
        start: async (options: StartOptions) => {
          started.push(options)
          return runtime.start(options)
        },
      })
    },
    prepareProviderHome: (provider, profile) => join(folder, profile, provider),
    providerHomePath: (provider, profile) => join(folder, profile, provider),
    newSessionId: () => `catalogue_${++counter}`,
    resolveCwd: () => folder,
    providerVersions: async () => ({ claude: { version }, codex: { version: 'fictional-codex' } }),
  })
  try {
    await host.providerVersions()
    const previous = await host.modelList('claude')
    current = true
    version = '2.1.322'
    await host.providerVersions()
    const drawer = await host.modelList('claude')
    const picker = await host.modelList('claude', 'fern')
    expect(drawer.models).not.toEqual(previous.models)
    expect(drawer.models).toEqual(rows().map((row) => ({ ...row, addedBy: 'the-provider' })))
    expect(picker.models).toEqual(drawer.models)
    for (const row of picker.models) {
      await host.createSession(
        { provider: 'claude', profileId: 'fern', model: row.id },
        new RecordingSink(),
      )
    }
    expect(started.map((options) => options.model)).toEqual(['default', 'fable'])
  } finally {
    await host.closeAll()
    rmSync(folder, { recursive: true, force: true })
  }
})
