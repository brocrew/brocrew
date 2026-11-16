import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AuthState } from '@brobot2/runtime'
import * as runtime from '@brobot2/runtime'
import * as claude from '@brobot2/runtime/claude'
import * as codex from '@brobot2/runtime/codex'
import type { Provider, ProviderConnection } from '@brobot2/shared'
import { claudeAuth } from '../src/main/providers/claude'
import { codexAuth } from '../src/main/providers/codex'
import type { ProviderHomePaths } from '../src/main/providers/module'
import { ApiKeyUnreadableError } from '../src/main/providers/api-key-error'

const signedIn: AuthState = { state: 'usable', login: 'account', expiresAt: null }
let directory: string
let paths: ProviderHomePaths

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'brocrew-connection-auth-'))
  paths = {
    managedRoot: directory,
    defaultProfile: 'fern',
    homeOf: (profile) => join(directory, profile),
    profiles: () => ['fern'],
    assertMayOpen: () => {},
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(directory, { recursive: true, force: true })
})

function connection(
  provider: Provider,
  authMethod: ProviderConnection['authMethod'],
): ProviderConnection {
  return {
    id: `${provider}:${authMethod}`,
    provider,
    name: 'Fictional connection',
    authMethod,
    credentialSource: authMethod === 'api-key' ? 'provider-api-key' : 'provider-sign-in',
    baseUrl: null,
    enabled: true,
    contractVersion: 1,
  }
}

it('an explicit Claude sign-in check ignores the saved key and uses the existing login reader', async () => {
  const reader = vi.spyOn(claude, 'defaultKeychainReaderForALaunch').mockResolvedValue(null)
  const state = vi.spyOn(claude, 'claudeLoginState').mockReturnValue(signedIn)
  const key = vi.fn(async () => 'fictional-key')
  const keyStatus = vi.fn(() => ({ set: true }))
  const auth = claudeAuth(paths, { key, keyStatus, platform: 'linux' })
  const answer = await Reflect.apply(auth.check, auth, [
    'fern',
    undefined,
    connection('claude', 'sign-in'),
  ])
  expect(answer).toEqual(signedIn)
  expect(reader).toHaveBeenCalledExactlyOnceWith()
  expect(state).toHaveBeenCalledOnce()
  expect(key).not.toHaveBeenCalled()
  expect(keyStatus).not.toHaveBeenCalled()
})

it('an explicit Claude sign-in probe reaches the existing probe with its cancellation signal', async () => {
  const probeLogin = vi.fn(async () => signedIn)
  const keyStatus = vi.fn(() => ({ set: true }))
  const auth = claudeAuth(paths, { probeLogin, keyStatus })
  const signal = new AbortController().signal
  expect(
    await Reflect.apply(auth.probe!, auth, ['fern', signal, connection('claude', 'sign-in')]),
  ).toEqual(signedIn)
  expect(probeLogin).toHaveBeenCalledExactlyOnceWith(signal)
  expect(keyStatus).not.toHaveBeenCalled()
})

it('an omitted Claude connection retains the existing saved-key check', async () => {
  const reader = vi.spyOn(claude, 'defaultKeychainReaderForALaunch').mockResolvedValue(null)
  const keyStatus = vi.fn(() => ({ set: true }))
  const auth = claudeAuth(paths, { keyStatus, platform: 'linux' })
  expect(await auth.check('fern')).toMatchObject({ state: 'usable', login: 'api-key' })
  expect(keyStatus).toHaveBeenCalledExactlyOnceWith()
  expect(reader).not.toHaveBeenCalled()
})

for (const method of ['check', 'probe'] as const) {
  it(`an explicit Claude sign-in ${method} ignores an unreadable saved key`, async () => {
    vi.spyOn(claude, 'defaultKeychainReaderForALaunch').mockResolvedValue(null)
    vi.spyOn(claude, 'claudeLoginState').mockReturnValue(signedIn)
    const error = new ApiKeyUnreadableError('claude')
    const keyStatus = vi.fn(() => ({ set: true, unreadableReason: error.message }))
    const key = vi.fn(() => {
      throw error
    })
    const probeLogin = vi.fn(async () => signedIn)
    const auth = claudeAuth(paths, { keyStatus, key, probeLogin, platform: 'linux' })
    const signal = new AbortController().signal
    expect(
      await Reflect.apply(auth[method]!, auth, ['fern', signal, connection('claude', 'sign-in')]),
    ).toEqual(signedIn)
    expect(keyStatus).not.toHaveBeenCalled()
    expect(key).not.toHaveBeenCalled()
    if (method === 'probe') expect(probeLogin).toHaveBeenCalledExactlyOnceWith(signal)
  })
}

it('an explicit Codex sign-in check preserves its existing home probe and signal', async () => {
  const probe = vi.spyOn(codex, 'probeCodexAuthInHome').mockResolvedValue(signedIn)
  const command = vi.fn(() => '/fictional/codex')
  const auth = codexAuth(paths, { command })
  const signal = new AbortController().signal
  expect(
    await Reflect.apply(auth.check, auth, ['fern', signal, connection('codex', 'sign-in')]),
  ).toEqual(signedIn)
  expect(probe).toHaveBeenCalledExactlyOnceWith(
    expect.any(Function),
    paths.homeOf('fern'),
    paths.homeOf('fern'),
    signal,
  )
  expect(command).toHaveBeenCalledExactlyOnceWith()
})

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: an explicit API connection check directs to Check key without probing OAuth`, async () => {
    const reader = vi.spyOn(claude, 'defaultKeychainReaderForALaunch').mockResolvedValue(null)
    const probe = vi.spyOn(codex, 'probeCodexAuthInHome').mockResolvedValue(signedIn)
    const provision = vi.spyOn(runtime, 'provisionProviderHome')
    const keyStatus = vi.fn(() => ({ set: true }))
    const command = vi.fn(() => '/fictional/codex')
    const auth =
      provider === 'claude'
        ? claudeAuth(paths, { keyStatus, platform: 'linux' })
        : codexAuth(paths, { command })
    const answer = await Reflect.apply(auth.check, auth, [
      'fern',
      undefined,
      connection(provider, 'api-key'),
    ])
    expect(answer).toMatchObject({ state: 'unknown', reason: expect.stringContaining('Check key') })
    expect(reader).not.toHaveBeenCalled()
    expect(probe).not.toHaveBeenCalled()
    expect(provision).not.toHaveBeenCalled()
    expect(keyStatus).not.toHaveBeenCalled()
    expect(command).not.toHaveBeenCalled()
  })
}
