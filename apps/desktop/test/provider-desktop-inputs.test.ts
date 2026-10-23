import { describe, expect, it, vi } from 'vitest'
import { providerRecord } from '@brobot2/shared'
import * as registry from '../src/main/providers'
import { LOOK_FOR_THE_INSTALLED_ONE } from '../src/main/runtime/claude-program'

type Inputs = Parameters<typeof registry.createProviderModules>[1]
function inputsFactory(): (...args: unknown[]) => Inputs {
  const factory = Reflect.get(registry, 'desktopProviderInputs') as ((...args: unknown[]) => Inputs) | undefined
  expect(factory, 'provider-owned desktop binding').toBeDefined()
  if (factory === undefined) throw new Error('Provider-owned desktop binding is absent')
  return factory
}
function context() {
  return {
    isPackaged: false,
    resourcesPath: '/fictional/resources',
    platform: 'darwin' as const,
    arch: 'arm64',
    managedRoot: '/fictional/homes',
    commandLine: { hasSwitch: vi.fn(() => false), getSwitchValue: vi.fn(() => '') },
    signal: new AbortController().signal,
    keys: { read: vi.fn(async () => null), current: vi.fn(async () => null), status: vi.fn(() => ({ set: false })) },
  }
}
function fixture() {
  const env = context()
  let claudePath = '/fictional/claude'
  let codexPath = '/fictional/codex'
  const findProgram = vi.fn(() => ({ path: claudePath, from: 'given' as const, update: null, others: [] }))
  const resolveProgram = vi.fn(() => ({ path: codexPath, from: 'carried' as const }))
  const renew = vi.fn(async () => 'not-needed' as const)
  const renewal = vi.fn(() => renew)
  const readLogin = vi.fn(() => { throw new Error('No login read during binding') })
  const claudeVersion = vi.fn(async () => ({ version: '2.1.0' }))
  const codexVersion = vi.fn(async () => ({ version: '0.160.0' }))
  const claudeVersions = vi.fn<(program: unknown) => typeof claudeVersion>(() => claudeVersion)
  const codexVersions = vi.fn<(program: unknown) => typeof codexVersion>(() => codexVersion)
  const transport = vi.fn(() => () => { throw new Error('No transport is spawned by this fixture') })
  const changeKey = vi.fn(async () => ({ ok: true, authMethod: 'apiKey' }))
  const inputs = inputsFactory()(env, {
    claude: { findProgram, renewal, readLogin, versionReader: claudeVersions },
    codex: { resolveProgram, versionReader: codexVersions, transportFactory: transport, changeKey },
  })
  return { env, inputs, findProgram, resolveProgram, renewal, renew, readLogin, claudeVersion, codexVersion, claudeVersions, codexVersions, transport, changeKey, move: () => { claudePath += '-new'; codexPath += '-new' } }
}

describe('provider-owned desktop inputs', () => {
  it('binds version caches and renewal once, with no program, credential, key or home read', () => {
    const f = fixture()
    const unread = vi.fn((): never => { throw new Error('No home work at registration') })
    const paths = providerRecord(() => ({ managedRoot: '/fictional/homes', defaultProfile: 'fern', homeOf: unread, profiles: unread, assertMayOpen: unread }))
    const modules = registry.createProviderModules((provider) => paths[provider], f.inputs)
    for (const provider of ['claude', 'codex'] as const)
      expect(Reflect.get(modules[provider], 'program')).toBe(Reflect.get(f.inputs[provider], 'program'))
    expect(f.claudeVersions).toHaveBeenCalledTimes(1)
    expect(f.codexVersions).toHaveBeenCalledTimes(1)
    expect(f.renewal).toHaveBeenCalledExactlyOnceWith({ readLogin: f.readLogin, signal: f.env.signal, findProgram: f.inputs.claude.runtime.programFound })
    expect(modules.claude.auth.renewal?.renew).toBe(f.renew)
    for (const fn of [f.findProgram, f.resolveProgram, f.renew, f.readLogin, f.claudeVersion, f.codexVersion, ...Object.values(f.env.keys), unread, ...Object.values(f.env.commandLine)])
      expect(fn).not.toHaveBeenCalled()
  })

  it('shares the fresh installed lookup and keeps launch versus every-copy selection distinct', async () => {
    const f = fixture()
    expect(f.inputs.claude.runtime.programFound).toBe(f.inputs.claude.home.programFound)
    expect(f.inputs.claude.runtime.programFound).toBe(f.inputs.claude.auth.programFound)
    expect(f.inputs.claude.runtime.program()).toBe('/fictional/claude')
    expect(f.findProgram).toHaveBeenLastCalledWith({ isPackaged: false, given: undefined, everyCopy: false })
    expect(f.inputs.claude.runtime.programFound?.()).toBe('/fictional/claude')
    expect(f.findProgram).toHaveBeenLastCalledWith({ isPackaged: true, given: LOOK_FOR_THE_INSTALLED_ONE })
    const all = f.claudeVersions.mock.calls[0]?.[0] as () => unknown
    all()
    expect(f.findProgram).toHaveBeenLastCalledWith({ isPackaged: false, given: undefined, everyCopy: true })
    f.move()
    expect(f.inputs.claude.runtime.programFound?.()).toBe('/fictional/claude-new')
    f.env.commandLine.hasSwitch.mockReturnValue(true)
    f.env.commandLine.getSwitchValue.mockReturnValue('/fictional/explicit')
    f.inputs.claude.runtime.program()
    expect(f.findProgram).toHaveBeenLastCalledWith({ isPackaged: false, given: '/fictional/explicit', everyCopy: false })
    const program = Reflect.get(f.inputs.claude, 'program') as { version(): Promise<unknown>; installedPath(): string | null }
    expect(program.version).toBe(f.claudeVersion)
    expect(program.installedPath).toBe(f.inputs.claude.runtime.programFound)
    await program.version()
    expect(f.claudeVersion).toHaveBeenCalledTimes(1)
    expect(f.env.keys.read).not.toHaveBeenCalled()
  })

  it('uses the same current bundled program for runtime, auth and each key change', async () => {
    const f = fixture()
    expect(f.inputs.codex.runtime.command()).toBe('/fictional/codex')
    expect(f.inputs.codex.auth.command()).toBe('/fictional/codex')
    expect(f.resolveProgram).toHaveBeenLastCalledWith({ isPackaged: false, resourcesPath: '/fictional/resources', platform: 'darwin', arch: 'arm64' })
    f.move()
    const key = f.inputs.codex.auth.key
    expect(key).toBe(f.inputs.codex.home.key)
    if (key === undefined) throw new Error('The key binding is absent')
    await key.change('/fictional/profile', { to: 'no-key' })
    expect(f.transport).toHaveBeenCalledExactlyOnceWith('/fictional/codex-new')
    expect(f.changeKey).toHaveBeenCalledExactlyOnceWith(f.transport.mock.results[0]?.value, '/fictional/profile', { to: 'no-key' })
    await key.current()
    expect(f.env.keys.current).toHaveBeenCalledExactlyOnceWith('codex')
    expect(key.isSaved?.()).toBe(false)
    expect(f.env.keys.status).toHaveBeenCalledExactlyOnceWith('codex')
    expect(f.env.keys.read).not.toHaveBeenCalled()
  })
})
