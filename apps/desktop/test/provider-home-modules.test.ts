import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCodexModule } from '../src/main/providers/codex'
import { describe, expect, it, vi } from 'vitest'
import { providerRecord } from '@brobot2/shared'
import { createProviderModules, providerAuthFromModules } from '../src/main/providers'
import type { ProviderHomePaths } from '../src/main/providers/module'

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
    await expect(auth.bringTheKeyToItsHomes('claude')).resolves.toBeNull()
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
      const module = createCodexModule(
        {
          managedRoot: root,
          defaultProfile: 'fern',
          homeOf: () => home,
          profiles: () => ['fern'],
          assertMayOpen: () => {},
        },
        {
          runtime: { command: () => '/fictional/codex' },
          home: {
            provisionHome: (_root, target) => {
              mkdirSync(target, { recursive: true })
            },
            provisionCodexAuth: copy,
            key: { current, change },
          },
          auth: { command: () => '/fictional/codex' },
        },
      )
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
        expect(change).toHaveBeenCalledExactlyOnceWith(home, {
          to: 'the-key',
          apiKey: 'fictional-fern-key',
        })
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
