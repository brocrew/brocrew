import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCodexModule } from '../src/main/providers/codex'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as codexRuntimeModule from '@brobot2/runtime/codex'
import { ScriptedAppServer } from './lib/scripted-codex-host'
import { providerRecord } from '@brobot2/shared'
import { AuthUnavailableError, type SessionHandle } from '@brobot2/runtime'
import { createProviderModules, providerAuthFromModules } from '../src/main/providers'
import type { ProviderHomePaths } from '../src/main/providers/module'
import { ApiKeyUnreadableError } from '../src/main/providers/api-key-error'

afterEach(() => vi.restoreAllMocks())

function homePaths(root: string, home: string, profiles = ['fern']): ProviderHomePaths {
  return {
    managedRoot: root,
    defaultProfile: 'fern',
    homeOf: () => home,
    profiles: () => [...profiles],
    assertMayOpen: () => {},
  }
}

for (const order of ['sibling launch', 'earlier sibling launch'] as const) {
  it(`Codex subscription keeps its mode and OAuth bytes across ${order} in the same profile home`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'brocrew-sibling-mode-'))
    const home = join(root, 'fern', 'codex')
    mkdirSync(home, { recursive: true })
    const oauth = Buffer.from(JSON.stringify({ auth_mode: 'chatgpt' }))
    writeFileSync(join(home, 'auth.json'), oauth)
    const handles: SessionHandle[] = []
    const modesAtSpawn: string[] = []
    const apiKeysAtWork: unknown[] = []
    const change = vi.fn(async () => ({ ok: true as const, authMethod: null }))
    const current = vi.fn(async () => ({ key: 'fictional-existing-key', setAt: 17 }))
    const copy = vi.fn((target: string) => writeFileSync(join(target, 'auth.json'), oauth))
    vi.spyOn(codexRuntimeModule, 'createSpawnTransportFactory').mockImplementation(
      () => (context) => {
        expect(context.providerHome).toBe(home)
        const atSpawn = readFileSync(join(context.providerHome, 'auth.json'))
        expect(atSpawn).toEqual(oauth)
        if (!context.apiKeyBound) {
          modesAtSpawn.push((JSON.parse(atSpawn.toString()) as { auth_mode: string }).auth_mode)
        }
        const server = new ScriptedAppServer(context.providerHome)
        const request = server.request.bind(server)
        server.request = (method, params) => {
          if (method === 'thread/start') {
            const calls = server.requests.map((one) => one.method)
            if (context.apiKeyBound) {
              const login = server.requests.find((one) => one.method === 'account/login/start')
              expect(calls[0]).toBe('initialize')
              expect(calls.indexOf('account/login/start')).toBeGreaterThan(0)
              expect(calls.indexOf('account/login/start')).toBeLessThan(
                calls.indexOf('getAuthStatus'),
              )
              expect(calls.indexOf('getAuthStatus')).toBeLessThan(calls.indexOf('account/read'))
              expect(login?.params).toEqual({ type: 'apiKey', apiKey: 'fictional-existing-key' })
              apiKeysAtWork.push(login?.params['apiKey'])
            } else {
              expect(calls).not.toContain('account/login/start')
            }
          }
          return request(method, params)
        }
        return server
      },
    )
    const module = createCodexModule(
      {
        ...homePaths(root, home),
        homeOf: (profile) => join(root, profile, 'codex'),
      },
      {
        runtime: { command: () => '/fictional/codex' },
        home: {
          provisionHome: (_root, target) => {
            mkdirSync(target, { recursive: true })
          },
          provisionCodexAuth: copy,
          key: { isSaved: () => true, current, change },
        },
        auth: { command: () => '/fictional/codex' },
      },
    )
    const subscription = {
      id: 'codex:sign-in',
      provider: 'codex',
      name: 'ChatGPT',
      authMethod: 'sign-in',
      credentialSource: 'provider-sign-in',
      baseUrl: null,
      enabled: true,
      contractVersion: 1,
    } as const
    const api = {
      ...subscription,
      id: 'codex:api-key',
      name: 'API key',
      authMethod: 'api-key',
      credentialSource: 'provider-api-key',
    } as const
    const startSibling = async () => {
      const launch = await module.prepareLaunch('fern', api)
      expect(launch.home).toBe(home)
      expect(launch.runtime).toBeInstanceOf(codexRuntimeModule.CodexRuntime)
      handles.push(await launch.runtime.start({ providerHome: home, cwd: home, model: 'gpt-5' }))
      expect(apiKeysAtWork).toEqual(['fictional-existing-key'])
      expect(readFileSync(join(home, 'auth.json'))).toEqual(oauth)
    }
    try {
      if (order === 'earlier sibling launch') await startSibling()
      const launch = await module.prepareLaunch('fern', subscription)
      expect(launch.home).toBe(home)
      expect(launch.runtime).toBeInstanceOf(codexRuntimeModule.CodexRuntime)
      const oauthBefore = readFileSync(join(home, 'auth.json'))
      expect(oauthBefore).toEqual(oauth)
      expect(modesAtSpawn).toEqual([])
      if (order === 'sibling launch') await startSibling()
      expect(readFileSync(join(home, 'auth.json'))).toEqual(oauthBefore)
      handles.push(await launch.runtime.start({ providerHome: home, cwd: home, model: 'gpt-5' }))
      expect(modesAtSpawn).toEqual(['chatgpt'])
      expect(readFileSync(join(home, 'auth.json'))).toEqual(oauthBefore)
      expect(apiKeysAtWork).toEqual(['fictional-existing-key'])
      expect(current).toHaveBeenCalledTimes(1)
      expect(copy).toHaveBeenCalledExactlyOnceWith(home)
      expect(change).not.toHaveBeenCalled()
    } finally {
      await Promise.all(handles.map((handle) => handle.close())).finally(() =>
        rmSync(root, { recursive: true, force: true }),
      )
    }
  })
}

it('overlapping legacy cleanups converge to OAuth without reading the global key', async () => {
  const root = mkdtempSync(join(tmpdir(), 'brocrew-legacy-cleanup-'))
  const home = join(root, 'fern', 'codex')
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, 'auth.json'), '{"auth_mode":"apikey"}')
  writeFileSync(join(home, 'brobot-api-key-login.json'), '{"setAt":17}')
  let entered!: () => void
  let release!: () => void
  let secondPrepared!: () => void
  let secondEntered!: () => void
  let releaseSecond!: () => void
  const firstEntered = new Promise<void>((resolve) => {
    entered = resolve
  })
  const firstReleased = new Promise<void>((resolve) => {
    release = resolve
  })
  const secondReady = new Promise<void>((resolve) => {
    secondPrepared = resolve
  })
  const secondCleanup = new Promise<void>((resolve) => {
    secondEntered = resolve
  })
  const secondReleased = new Promise<void>((resolve) => {
    releaseSecond = resolve
  })
  let preparations = 0
  let cleanups = 0
  const current = vi.fn(async () => ({ key: 'fictional-saved-key', setAt: 17 }))
  const change = vi.fn(async () => {
    if (++cleanups === 1) {
      entered()
      await firstReleased
    } else {
      secondEntered()
      await secondReleased
    }
    rmSync(join(home, 'auth.json'), { force: true })
    return { ok: true as const, authMethod: null }
  })
  const module = createCodexModule(homePaths(root, home), {
    runtime: { command: () => '/fictional/codex' },
    home: {
      provisionHome: () => {
        if (++preparations === 2) secondPrepared()
      },
      key: { current, change },
      provisionCodexAuth: () => writeFileSync(join(home, 'auth.json'), '{"auth_mode":"chatgpt"}'),
    },
    auth: { command: () => '/fictional/codex' },
  })
  try {
    const first = module.home.prepare('fern')
    await firstEntered
    const second = module.home.prepare('fern')
    await secondReady
    await secondCleanup
    release()
    await first
    expect(readFileSync(join(home, 'auth.json'), 'utf8')).toBe('{"auth_mode":"chatgpt"}')
    releaseSecond()
    await second
    expect(current).not.toHaveBeenCalled()
    expect(JSON.parse(readFileSync(join(home, 'auth.json'), 'utf8'))).toEqual({
      auth_mode: 'chatgpt',
    })
    expect(existsSync(join(home, 'brobot-api-key-login.json'))).toBe(false)
  } finally {
    release()
    releaseSecond()
    rmSync(root, { recursive: true, force: true })
  }
})

it('a refused legacy cleanup retains its stamp for retry and leaves another home untouched', async () => {
  const root = mkdtempSync(join(tmpdir(), 'brocrew-legacy-retry-'))
  const home = join(root, 'fern', 'codex')
  const other = join(root, 'moss', 'codex')
  for (const path of [home, other]) {
    mkdirSync(path, { recursive: true })
    writeFileSync(join(path, 'auth.json'), '{"auth_mode":"apikey"}')
    writeFileSync(join(path, 'brobot-api-key-login.json'), '{"setAt":17}')
  }
  const current = vi.fn(() => {
    throw new Error('must not read the global key')
  })
  const change = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, reason: 'Fictional logout refusal.' })
    .mockImplementationOnce(async () => {
      rmSync(join(home, 'auth.json'))
      return { ok: true, authMethod: null }
    })
  const copy = vi.fn(() => writeFileSync(join(home, 'auth.json'), '{"auth_mode":"chatgpt"}'))
  const module = createCodexModule(homePaths(root, home, ['fern', 'moss']), {
    runtime: { command: () => '/fictional/codex' },
    home: { provisionHome: () => {}, key: { current, change }, provisionCodexAuth: copy },
    auth: { command: () => '/fictional/codex' },
  })
  try {
    await expect(module.home.prepare('fern')).rejects.toThrow(
      'Fictional logout refusal. Try again in a moment.',
    )
    expect(readFileSync(join(home, 'auth.json'), 'utf8')).toBe('{"auth_mode":"apikey"}')
    expect(existsSync(join(home, 'brobot-api-key-login.json'))).toBe(true)
    expect(copy).not.toHaveBeenCalled()
    await module.home.prepare('fern')
    expect(readFileSync(join(home, 'auth.json'), 'utf8')).toBe('{"auth_mode":"chatgpt"}')
    expect(existsSync(join(home, 'brobot-api-key-login.json'))).toBe(false)
    expect(readFileSync(join(other, 'auth.json'), 'utf8')).toBe('{"auth_mode":"apikey"}')
    expect(readFileSync(join(other, 'brobot-api-key-login.json'), 'utf8')).toBe('{"setAt":17}')
    expect(current).not.toHaveBeenCalled()
    expect(change).toHaveBeenCalledTimes(2)
    expect(copy).toHaveBeenCalledExactlyOnceWith(home)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

for (const error of [
  new ApiKeyUnreadableError('codex'),
  new TypeError('fictional reader failure'),
]) {
  it(`an API-bound launch preserves ${error.name} without preparing a home or changing native auth`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'brocrew-key-read-error-'))
    const home = join(root, 'fern', 'codex')
    const provision = vi.fn()
    const change = vi.fn()
    const module = createCodexModule(homePaths(root, home), {
      runtime: { command: () => '/fictional/codex' },
      home: {
        provisionHome: provision,
        key: {
          current: () => {
            throw error
          },
          change,
        },
      },
      auth: { command: () => '/fictional/codex' },
    })
    try {
      const pending = module.prepareLaunch('fern', {
        id: 'codex:api-key',
        provider: 'codex',
        name: 'API key',
        authMethod: 'api-key',
        credentialSource: 'provider-api-key',
        baseUrl: null,
        enabled: true,
        contractVersion: 1,
      })
      if (error instanceof ApiKeyUnreadableError) {
        await expect(pending).rejects.toBeInstanceOf(AuthUnavailableError)
        await expect(pending).rejects.toMatchObject({ provider: 'codex', message: error.message })
      } else await expect(pending).rejects.toBe(error)
      expect(provision).not.toHaveBeenCalled()
      expect(change).not.toHaveBeenCalled()
      expect(existsSync(home)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}

for (const oldApiCopy of [false, true]) {
  it(`Codex home preparation ${oldApiCopy ? 'replaces its old API copy for subscription' : 'keeps OAuth bytes when a global key is saved'}`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'brocrew-home-mode-'))
    const home = join(root, 'fern', 'codex')
    mkdirSync(home, { recursive: true })
    const original = JSON.stringify({ auth_mode: oldApiCopy ? 'apikey' : 'chatgpt' })
    writeFileSync(join(home, 'auth.json'), original)
    if (oldApiCopy) writeFileSync(join(home, 'brobot-api-key-login.json'), '{"setAt":17}')
    const current = vi.fn(async () => ({ key: 'fictional-saved-key', setAt: 17 }))
    const change = vi.fn(async (target: string) => {
      rmSync(join(target, 'auth.json'))
      return { ok: true as const, authMethod: null }
    })
    const module = createCodexModule(homePaths(root, home), {
      runtime: { command: () => '/fictional/codex' },
      home: {
        provisionHome: () => {},
        key: { current, change },
        machineAuthPath: () => join(root, 'fictional-missing-source'),
        ...(oldApiCopy
          ? {
              provisionCodexAuth: () =>
                writeFileSync(join(home, 'auth.json'), '{"auth_mode":"chatgpt"}'),
            }
          : {}),
      },
      auth: { command: () => '/fictional/codex' },
    })
    try {
      if (oldApiCopy) {
        await module.prepareLaunch('fern', {
          id: 'codex:sign-in',
          provider: 'codex',
          name: 'ChatGPT',
          authMethod: 'sign-in',
          credentialSource: 'provider-sign-in',
          baseUrl: null,
          enabled: true,
          contractVersion: 1,
        })
        expect(change).toHaveBeenCalledExactlyOnceWith(home)
        expect(existsSync(join(home, 'brobot-api-key-login.json'))).toBe(false)
        expect(JSON.parse(readFileSync(join(home, 'auth.json'), 'utf8'))).toEqual({
          auth_mode: 'chatgpt',
        })
      } else {
        await module.home.prepare('fern')
        expect(readFileSync(join(home, 'auth.json'), 'utf8')).toBe(original)
        expect(change).not.toHaveBeenCalled()
      }
      expect(current).not.toHaveBeenCalled()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}

function fixture(renewLogin?: () => Promise<'renewed'>) {
  const command = vi.fn(() => '/fictional/codex')
  const program = vi.fn(() => '/fictional/claude')
  const key = vi.fn(() => null)
  const status = vi.fn(() => ({ set: false }))
  const provision = vi.fn()
  const paths = providerRecord((provider) => ({
    managedRoot: '/fictional/homes',
    defaultProfile: 'fern',
    homeOf: vi.fn((profileId: string) => `/fictional/homes/default/${profileId}/${provider}`),
    profiles: vi.fn(() => ['fern']),
    assertMayOpen: vi.fn(),
  }))
  const pathsFor = vi.fn((provider: keyof typeof paths): ProviderHomePaths => paths[provider])
  const authInputs = { key, keyStatus: status }
  if (renewLogin !== undefined) Reflect.set(authInputs, 'renewLogin', renewLogin)
  const modules = createProviderModules(pathsFor, {
    claude: {
      runtime: { program, key },
      home: { provisionHome: provision, key },
      auth: authInputs,
    },
    codex: {
      runtime: { command },
      home: { provisionHome: provision },
      auth: { command },
    },
  })
  return {
    modules,
    pathsFor,
    command,
    program,
    key,
    status,
    provision,
    paths,
  }
}

for (const [provider, unreadable] of [
  ['claude', false],
  ['codex', false],
  ['claude', true],
] as const) {
  it(`${provider}: a selected API connection with ${unreadable ? 'an unreadable' : 'no usable'} key fails in its real adapter before home or process work`, async () => {
    const state = fixture()
    const error = unreadable ? new ApiKeyUnreadableError(provider) : null
    if (error !== null)
      state.key.mockImplementation(() => {
        throw error
      })
    const pending = state.modules[provider].prepareLaunch('fern', {
      id: `${provider}:api-key`,
      provider,
      name: 'Fictional API key',
      authMethod: 'api-key',
      credentialSource: 'provider-api-key',
      baseUrl: null,
      enabled: true,
      contractVersion: 1,
    })
    await expect(pending).rejects.toBeInstanceOf(AuthUnavailableError)
    await expect(pending).rejects.toMatchObject({
      provider,
      message: error?.message ?? 'The selected API key is unavailable',
    })
    expect(state.provision).not.toHaveBeenCalled()
    expect(state.program).not.toHaveBeenCalled()
    expect(state.command).not.toHaveBeenCalled()
    expect(state.paths[provider].homeOf).not.toHaveBeenCalled()
  })
}

describe('bound provider home modules', () => {
  it('binds optional login renewal without running it and keeps the launch wrapper outside', async () => {
    const order: string[] = []
    const renew = vi.fn(async () => {
      order.push('renew')
      return 'renewed' as const
    })
    const state = fixture(renew)
    type Renewal = {
      readonly launchLabel: string
      renew(): Promise<'renewed'>
      prepare(
        prepare: () => string,
        renew: () => Promise<'renewed'>,
      ): Promise<{ readonly home: string; readonly loginRenewed: boolean }>
    }
    const own = Reflect.get(state.modules.claude.auth, 'renewal') as Renewal | undefined
    expect(own).toBeDefined()
    if (own === undefined) throw new Error('The bound renewal is absent')
    expect(own.renew).toBe(renew)
    expect(own.launchLabel).toBe('Claude sign-in renewal')
    expect(Reflect.get(state.modules.codex.auth, 'renewal')).toBeUndefined()
    const forwarded = Reflect.get(providerAuthFromModules(state.modules), 'loginRenewal') as
      ((provider: 'claude' | 'codex') => Renewal | undefined) | undefined
    expect(forwarded?.('claude')).toBe(own)
    expect(forwarded?.('codex')).toBeUndefined()
    expect(renew).not.toHaveBeenCalled()
    expect(state.key).not.toHaveBeenCalled()
    await expect(
      own.prepare(
        () => {
          order.push('prepare')
          return '/fictional/home'
        },
        () => {
          order.push('launch-wrapper')
          return own.renew()
        },
      ),
    ).resolves.toEqual({ home: '/fictional/home', loginRenewed: true })
    expect(order).toEqual(['launch-wrapper', 'renew', 'prepare'])
  })

  it('registers without resolving a program, reading credentials or touching a home', () => {
    const state = fixture()
    expect(state.pathsFor).toHaveBeenCalledTimes(2)
    for (const operation of [
      state.command,
      state.program,
      state.key,
      state.status,
      state.provision,
      ...Object.values(state.paths).flatMap((paths) => [
        paths.homeOf,
        paths.profiles,
        paths.assertMayOpen,
      ]),
    ])
      expect(operation).not.toHaveBeenCalled()
  })

  it('constructs a fresh runtime per launch and asks only its own program', () => {
    const state = fixture()
    const first = state.modules.claude.createRuntime()
    const second = state.modules.claude.createRuntime()
    expect(first).not.toBe(second)
    expect(first.provider).toBe('claude')
    expect(state.program).toHaveBeenCalledTimes(2)
    expect(state.command).not.toHaveBeenCalled()
    const other = state.modules.codex.createRuntime()
    expect(other.provider).toBe('codex')
    expect(state.command).toHaveBeenCalledTimes(1)
    expect(state.key).not.toHaveBeenCalled()
    for (const paths of Object.values(state.paths)) expect(paths.homeOf).not.toHaveBeenCalled()
  })

  it('keeps the pure reservation key apart from profile admission and credential work', () => {
    const state = fixture()
    const auth = providerAuthFromModules(state.modules)
    expect(auth.credentialHome('claude', 'willow')).toBe('/fictional/homes/default/willow/claude')
    expect(auth.credentialHome('codex', 'willow')).toBe('/fictional/homes/default/willow/codex')
    for (const paths of Object.values(state.paths))
      expect(paths.assertMayOpen).not.toHaveBeenCalled()
    expect(state.provision).not.toHaveBeenCalled()
    expect(state.key).not.toHaveBeenCalled()
  })

  it('preserves the current refusal results for operations without a profile credential', async () => {
    const state = fixture()
    const auth = providerAuthFromModules(state.modules)
    expect(() => auth.reprovision('claude', 'willow')).toThrow(
      'there is no profile credential to re-copy',
    )
    await expect(auth.signIn('claude', 'willow')).rejects.toThrow(
      'there is no profile credential to sign in',
    )
    expect(state.provision).not.toHaveBeenCalled()
    expect(state.key).not.toHaveBeenCalled()
  })
})

for (const available of [true, false]) {
  it(`Codex prepared API-key launch ${available ? 'captures one reading through home preparation' : 'refuses a missing key without using the sign-in'}`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'brocrew-prepared-codex-'))
    try {
      const home = join(root, 'fern', 'codex')
      let saved = available ? { key: 'fictional-fern-key', setAt: 17 } : null
      const current = vi.fn(async () => {
        const selected = saved
        saved = null
        return selected
      })
      const change = vi.fn(async () => ({
        ok: true as const,
        authMethod: 'apikey',
      }))
      const copy = vi.fn()
      const server = new ScriptedAppServer(home)
      vi.spyOn(codexRuntimeModule, 'createSpawnTransportFactory').mockReturnValue(() => server)
      const module = createCodexModule(homePaths(root, home), {
        runtime: { command: () => '/fictional/codex' },
        home: {
          provisionHome: (_root, target) => {
            mkdirSync(target, { recursive: true })
          },
          provisionCodexAuth: copy,
          key: { current, change },
        },
        auth: { command: () => '/fictional/codex' },
      })
      const pending = module.prepareLaunch('fern', {
        id: 'codex:api-key',
        provider: 'codex',
        name: 'API key',
        authMethod: 'api-key',
        credentialSource: 'provider-api-key',
        baseUrl: null,
        enabled: true,
        contractVersion: 1,
      })
      if (available) {
        const prepared = await pending
        expect(prepared.home).toBe(home)
        expect(prepared.runtime.provider).toBe('codex')
        expect(change).not.toHaveBeenCalled()
        expect(existsSync(join(home, 'auth.json'))).toBe(false)
        await prepared.runtime.listModels?.({ providerHome: home })
        expect(server.requests.find((one) => one.method === 'account/login/start')?.params).toEqual(
          {
            type: 'apiKey',
            apiKey: 'fictional-fern-key',
          },
        )
        expect(server.requests.some((one) => one.method === 'model/list')).toBe(true)
      } else {
        await expect(pending).rejects.toThrow('The selected API key is unavailable')
        expect(change).not.toHaveBeenCalled()
        expect(existsSync(home)).toBe(false)
      }
      expect(current).toHaveBeenCalledTimes(1)
      expect(saved).toBeNull()
      expect(copy).not.toHaveBeenCalled()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}
