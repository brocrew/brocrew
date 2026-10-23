import { describe, expect, it, vi } from 'vitest'
import { createProviderModules, providerAuthFromModules } from '../src/main/providers'
import type { ProviderHomePaths } from '../src/main/providers/module'

function fixture() {
  const command = vi.fn(() => '/fictional/codex')
  const program = vi.fn(() => '/fictional/claude')
  const key = vi.fn(() => null)
  const status = vi.fn(() => ({ set: false }))
  const provision = vi.fn()
  const homeOf = vi.fn((profileId: string) => `/fictional/homes/${profileId}`)
  const profiles = vi.fn(() => ['fern'])
  const assertMayOpen = vi.fn()
  const paths: ProviderHomePaths = {
    managedRoot: '/fictional/homes',
    defaultProfile: 'fern',
    homeOf,
    profiles,
    assertMayOpen,
  }
  const pathsFor = vi.fn(() => paths)
  const modules = createProviderModules(pathsFor, {
    runtime: { codexCommand: command, claudeProgram: program, apiKey: key },
    home: { provisionHome: provision, apiKey: key },
    auth: { codexCommand: command, apiKey: key, keyStatus: status },
  })
  return {
    modules,
    pathsFor,
    command,
    program,
    key,
    status,
    provision,
    homeOf,
    profiles,
    assertMayOpen,
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
      state.homeOf,
      state.profiles,
      state.assertMayOpen,
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
    expect(state.homeOf).not.toHaveBeenCalled()
  })

  it('keeps the pure reservation key apart from profile admission and credential work', () => {
    const state = fixture()
    const auth = providerAuthFromModules(state.modules)
    expect(auth.credentialHome('claude', 'willow')).toBe('/fictional/homes/willow')
    expect(auth.credentialHome('codex', 'willow')).toBe('/fictional/homes/willow')
    expect(state.assertMayOpen).not.toHaveBeenCalled()
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
