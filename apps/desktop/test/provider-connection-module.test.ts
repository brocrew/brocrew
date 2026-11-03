import { expect, it, vi } from 'vitest'
import { providerRecord } from '@brobot2/shared'
import { createProviderModules } from '../src/main/providers'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import {
  listProviderConnections,
  resolveProviderConnection,
} from '../src/main/db/provider-connections'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

it('registers connection operations inside modules without probing a program, login or home', async () => {
  const db = openDatabase(':memory:')
  try {
    applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
    const sideEffect = vi.fn(() => {
      throw new Error('No provider work during metadata admission')
    })
    const paths = providerRecord((provider) => ({
      managedRoot: '/fictional/homes',
      defaultProfile: 'fern',
      homeOf: (profile: string) => `/fictional/${profile}/${provider}`,
      profiles: () => ['fern'],
      assertMayOpen: sideEffect,
    }))
    const sources = providerRecord((provider) => ({
      list: () => listProviderConnections(db, provider),
      resolve: (connectionId?: string | null) =>
        resolveProviderConnection(db, { provider, connectionId }),
    }))
    const modules = Reflect.apply(createProviderModules, undefined, [
      (provider: keyof typeof paths) => paths[provider],
      {
        claude: { runtime: { program: sideEffect }, home: { provisionHome: sideEffect }, auth: {} },
        codex: {
          runtime: { command: sideEffect },
          home: { provisionHome: sideEffect },
          auth: { command: sideEffect },
        },
      },
      (provider: keyof typeof sources) => sources[provider],
    ]) as ReturnType<typeof createProviderModules>
    for (const provider of ['claude', 'codex'] as const) {
      const operations = Reflect.get(modules[provider], 'connections') as
        typeof sources.claude | undefined
      expect(operations).toBeDefined()
      expect(operations?.list().map((item) => item.id)).toEqual([`${provider}:sign-in`])
      expect(operations?.resolve().id).toBe(`${provider}:sign-in`)
      const runtime = Reflect.apply(modules[provider].createRuntime, modules[provider], [
        `${provider}:api-key`,
      ])
      await expect(runtime.listModels({ providerHome: '/fictional/fern/state' })).rejects.toThrow(
        'connection',
      )
    }
    expect(sideEffect).not.toHaveBeenCalled()
  } finally {
    db.close()
  }
})
