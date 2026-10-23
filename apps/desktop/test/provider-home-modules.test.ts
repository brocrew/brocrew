import { describe, expect, it, vi } from 'vitest'
import { providerRecord } from '@brobot2/shared'
import { createProviderModules, providerAuthFromModules } from '../src/main/providers'
import type { ProviderHomePaths } from '../src/main/providers/module'

function fixture() {
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
  const modules = createProviderModules(pathsFor, {
    claude: {
      runtime: { program, key },
      home: { provisionHome: provision, key },
      auth: { key, keyStatus: status },
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
