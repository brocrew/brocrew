import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ClaudeQuery } from '@brobot2/runtime/claude'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { ApiKeys } from '../src/main/runtime/api-keys'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { resolveProviderConnection } from '../src/main/db/provider-connections'
import { createClaudeModule } from '../src/main/providers/claude'

const native = vi.hoisted(() => ({
  queryFactory: vi.fn<(params: unknown) => ClaudeQuery>(),
  login: vi.fn(() => 'fictional-login'),
  spawn: vi.fn(() => {
    throw new Error('No provider process in this test')
  }),
}))

vi.mock('@brobot2/runtime/claude', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@brobot2/runtime/claude')>()
  return {
    ...actual,
    ClaudeRuntime: class extends actual.ClaudeRuntime {
      constructor(...args: ConstructorParameters<typeof actual.ClaudeRuntime>) {
        super(
          (params) => native.queryFactory(params),
          async () => true,
          native.login,
          async () => native.login(),
          native.spawn,
          args[5],
          'linux',
          args[7],
          args[8],
          args[9],
          args[10],
        )
      }
    },
  }
})

class Query implements ClaudeQuery {
  private end!: () => void
  private readonly ended = new Promise<void>((resolve) => {
    this.end = resolve
  })
  readonly close = vi.fn(() => this.end())
  async interrupt() {
    return undefined
  }
  async supportedModels() {
    return []
  }
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return {
      next: async () => {
        await this.ended
        return { done: true, value: undefined }
      },
    }
  }
}

let dir: string
let db: AppDatabase
const handles: import('@brobot2/runtime').SessionHandle[] = []
beforeEach(() => {
  vi.clearAllMocks()
  dir = mkdtempSync(join(tmpdir(), 'brocrew-connection-auth-'))
  db = openDatabase(':memory:')
  applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
})
afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close()))
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function moduleOn(key: () => string | null | Promise<string | null>) {
  return createClaudeModule(
    {
      managedRoot: dir,
      defaultProfile: 'fictional-profile',
      homeOf: () => join(dir, 'claude'),
      profiles: () => ['fictional-profile'],
      assertMayOpen: () => {},
    },
    {
      runtime: { program: () => '/fictional/claude', key },
      home: {
        key,
        login: async () => native.login(),
        provisionHome: (_root, home) => {
          mkdirSync(home, { recursive: true })
        },
      },
      auth: {},
    },
  )
}

for (const operation of ['start', 'resume', 'models'] as const) {
  for (const method of ['sign-in', 'api-key'] as const) {
    it(`Claude ${operation}: keeps the selected ${method} method when the saved key changes during its read`, async () => {
      createSessionStore(db)
      const keys = new ApiKeys(dir)
      if (method === 'api-key') await keys.set('claude', 'fictional-fern-key')
      const connection = resolveProviderConnection(db, {
        provider: 'claude',
        keySaved: keys.status('claude').set,
      })
      const home = join(dir, 'claude')
      mkdirSync(home)
      const query = new Query()
      native.queryFactory.mockReturnValue(query)
      const readKey = vi.fn(async () => {
        if (method === 'sign-in') await keys.set('claude', 'fictional-willow-key')
        const key = await keys.read('claude')
        await keys.remove('claude')
        return key
      })
      const { runtime } = await moduleOn(readKey).prepareLaunch('fictional-profile', connection)
      const options = { cwd: dir, providerHome: home }
      if (operation === 'models') {
        expect(await runtime.listModels(options)).toEqual([])
      } else {
        const handle =
          operation === 'start'
            ? await runtime.start(options)
            : await runtime.resume(
                { provider: 'claude', sessionId: 'fictional-native', cwd: dir, rotation: 0 },
                options,
              )
        handles.push(handle)
      }
      expect(native.queryFactory).toHaveBeenCalledTimes(1)
      expect(native.spawn).not.toHaveBeenCalled()
      if (method === 'sign-in') {
        expect(readKey).not.toHaveBeenCalled()
        expect(native.login).toHaveBeenCalled()
      } else {
        expect(readKey).toHaveBeenCalledTimes(1)
        expect(native.login).not.toHaveBeenCalled()
        expect(keys.status('claude').set).toBe(false)
      }
      expect(connection.authMethod).toBe(method)
    })
  }

  it(`Claude ${operation}: a selected API key that disappears does not fall back to a login`, async () => {
    createSessionStore(db)
    const keys = new ApiKeys(dir)
    await keys.set('claude', 'fictional-fern-key')
    const connection = resolveProviderConnection(db, {
      provider: 'claude',
      keySaved: keys.status('claude').set,
    })
    await keys.remove('claude')
    const home = join(dir, 'claude')
    mkdirSync(home)
    const pending = moduleOn(() => keys.read('claude')).prepareLaunch(
      'fictional-profile',
      connection,
    )
    await expect(pending).rejects.toThrow('The selected API key is unavailable')
    expect(native.queryFactory).not.toHaveBeenCalled()
    expect(native.login).not.toHaveBeenCalled()
    expect(native.spawn).not.toHaveBeenCalled()
  })
}

for (const method of ['sign-in', 'api-key'] as const) {
  it(`prepares one Claude ${method} selection for the home and runtime`, async () => {
    let saved: string | null = method === 'api-key' ? 'fictional-fern-key' : null
    const readKey = vi.fn(async () => saved)
    const readLogin = vi.fn(async () => 'fictional-login')
    const connection = {
      ...resolveProviderConnection(db, { provider: 'claude', keySaved: method === 'api-key' }),
      authMethod: method,
    }
    const module = createClaudeModule(
      {
        managedRoot: dir,
        defaultProfile: 'fictional-profile',
        homeOf: () => join(dir, 'claude'),
        profiles: () => ['fictional-profile'],
        assertMayOpen: () => {},
      },
      {
        runtime: { program: () => '/fictional/claude', key: readKey },
        home: {
          key: readKey,
          login: readLogin,
          provisionHome: (_root, home) => {
            mkdirSync(home, { recursive: true })
            saved = method === 'api-key' ? null : 'fictional-willow-key'
          },
        },
        auth: {},
      },
    )
    const prepared = await module.prepareLaunch('fictional-profile', connection)
    native.queryFactory.mockReturnValue(new Query())
    expect(await prepared.runtime.listModels({ providerHome: prepared.home })).toEqual([])
    expect(readKey).toHaveBeenCalledTimes(method === 'api-key' ? 1 : 0)
    expect(readLogin).toHaveBeenCalledTimes(method === 'sign-in' ? 1 : 0)
    expect(native.queryFactory).toHaveBeenCalledTimes(1)
    expect(saved).toBe(method === 'api-key' ? null : 'fictional-willow-key')
  })
}
