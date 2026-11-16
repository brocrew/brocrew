import { afterEach, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { FakeRuntime } from '@brobot2/runtime'
import * as codex from '@brobot2/runtime/codex'
import type { Provider, ProviderConnection } from '@brobot2/shared'
import type { ProviderSignIn } from '../src/main/providers/auth-types'
import type { ProviderAuthOps } from '../src/main/providers/auth-operations'
import type { ProviderHomePaths } from '../src/main/providers/module'
import { codexAuth } from '../src/main/providers/codex'
import { providerAuthFromHomes } from '../src/main/providers'
import {
  listProviderConnections,
  ProviderConnectionUnavailable,
} from '../src/main/connections/records'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { claimResource } from '../src/main/runtime/held-resources'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import { neutralHostDeps, fixtureProviderConfig } from './lib/host-fixture'

type Start = (
  provider: Provider,
  profile: string,
  signal?: AbortSignal,
  row?: ProviderConnection,
) => Promise<ProviderSignIn>
type HomeStart = (
  profile: string,
  signal?: AbortSignal,
  row?: ProviderConnection,
) => Promise<ProviderSignIn>
const outcome = {
  success: true,
  state: { state: 'usable' as const, login: 'account' as const, expiresAt: null },
}
let world: AServiceWorld
let host: RuntimeHost
let release: (() => void)[] = []
afterEach(async () => {
  for (const finish of release) finish()
  release = []
  await host?.closeAll()
  await world?.cleanUp()
  vi.restoreAllMocks()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function fixture(held = false, resolver = true) {
  world = aServiceWorld()
  world.anAgent('fern', 'normal', 'codex')
  const builtins = listProviderConnections(world.db, 'codex')
  const subscription = builtins.find((row) => row.authMethod === 'sign-in')
  const key = builtins.find((row) => row.authMethod === 'api-key')
  if (!subscription || !key) throw new Error('Fictional database requires both builtin modes')
  const a = { ...subscription, id: 'fictional-oauth-a', name: 'Fictional OAuth A' }
  const b = { ...subscription, id: 'fictional-oauth-b', name: 'Fictional OAuth B' }
  const api = { ...key, id: 'fictional-oauth-key', name: 'Fictional OAuth key' }
  for (const row of [a, b, api])
    world.db
      .prepare(
        'INSERT INTO provider_connection(id,provider,name,auth_method,credential_source) VALUES(?,?,?,?,?)',
      )
      .run(row.id, row.provider, row.name, row.authMethod, row.credentialSource)
  const choose = (id: string) =>
    world.store.setModelChoice('fern', {
      provider: 'codex',
      model: 'fake-codex-a',
      effort: 'medium',
      connectionId: id,
    })
  choose(b.id)
  const selected = vi.fn((provider: Provider, id?: string | null) => {
    const row = [a, b, api].find(
      (one) => one.provider === provider && (one.id === id || one.name === id),
    )
    if (!row) throw new ProviderConnectionUnavailable()
    return row
  })
  const home = (profile: string, row?: ProviderConnection) =>
    join(world.folder, 'fictional-login-homes', profile, row?.id ?? 'legacy')
  const credentialHome = vi.fn((_provider: Provider, profile: string, row?: ProviderConnection) =>
    home(profile, row),
  )
  const completed = deferred<Awaited<ProviderSignIn['completed']>>()
  release.push(() => completed.resolve(outcome))
  if (!held) completed.resolve(outcome)
  const cancel = vi.fn(async () => {
    completed.resolve({
      success: false,
      error: 'canceled',
      state: { state: 'unknown', reason: 'canceled' },
    })
  })
  const start = vi.fn<Start>(async () => ({
    authUrl: 'https://login.example.invalid/fictional',
    completed: completed.promise,
    cancel,
  }))
  const browser = vi.fn<(url: string) => Promise<void>>(async () => {})
  const changed = vi.fn()
  const unexpected = vi.fn((): never => {
    throw new Error('No provider or credential operation')
  })
  const ops: ProviderAuthOps = {
    credentialHome,
    signIn: start,
    reprovision: unexpected,
    replaceARefusedCopy: unexpected,
    check: unexpected,
  }
  host = new RuntimeHost({
    ...neutralHostDeps(() => world.folder),
    store: world.store,
    newSessionId: () => 'fictional-oauth-session',
    createRuntime: () => new FakeRuntime('codex'),
    prepareProviderHome: unexpected,
    providerHomePath: (_p, profile) => home(profile),
    providerAuth: ops,
    ...(resolver ? { connectionFor: selected } : {}),
    openExternal: browser,
    providersMoved: changed,
    listProfiles: () => ['brobot', 'fern', 'pine'],
    resolveCwd: () => world.folder,
    readProviderConfig: fixtureProviderConfig,
  })
  const run = (id?: string, provider: Provider = 'codex') =>
    executeRuntimeCommand(host, world.window, {
      kind: 'signInProvider',
      provider,
      profileId: 'fern',
      ...(id === undefined ? {} : { connectionId: id }),
    })
  return {
    a,
    b,
    api,
    choose,
    home,
    credentialHome,
    selected,
    start,
    browser,
    changed,
    unexpected,
    completed,
    cancel,
    run,
  }
}

for (const alias of [false, true]) {
  it(`manual sign-in qualifies ${alias ? 'alias' : 'ID'} A despite the agent default B`, async () => {
    const f = fixture()
    expect(await f.run(alias ? f.a.name : f.a.id)).toMatchObject({
      success: true,
      state: outcome.state,
    })
    expect(f.selected).toHaveBeenCalledExactlyOnceWith('codex', alias ? f.a.name : f.a.id)
    expect(f.credentialHome).toHaveBeenCalledExactlyOnceWith('codex', 'fern', f.a)
    expect(f.start).toHaveBeenCalledExactlyOnceWith('codex', 'fern', expect.any(AbortSignal), f.a)
    expect(f.start.mock.calls[0]?.[3]).toBe(f.a)
    expect(f.browser).toHaveBeenCalledExactlyOnceWith('https://login.example.invalid/fictional')
    expect(world.store.modelChoiceOf('fern')?.connectionId).toBe(f.b.id)
    expect(f.unexpected).not.toHaveBeenCalled()
  })
}

it('omitted manual sign-in retains old claim/start arities and signal position', async () => {
  const f = fixture()
  expect(await f.run()).toMatchObject({ success: true })
  expect(f.selected).not.toHaveBeenCalled()
  expect(f.credentialHome).toHaveBeenCalledExactlyOnceWith('codex', 'fern')
  expect(f.start).toHaveBeenCalledExactlyOnceWith('codex', 'fern', expect.any(AbortSignal))
})
for (const invalid of ['unknown', 'provider', 'no-resolver'] as const) {
  it(`${invalid} sign-in selection fails before port/home claims, browser or invalidation`, async () => {
    const f = fixture(false, invalid !== 'no-resolver')
    const port = claimResource('oauth:codex', 'Fictional existing flow')
    if (!port.ok) throw new Error('Fixture port already held')
    try {
      await expect(
        f.run(
          invalid === 'unknown' ? 'missing-oauth' : f.a.id,
          invalid === 'provider' ? 'claude' : 'codex',
        ),
      ).rejects.toBeInstanceOf(ProviderConnectionUnavailable)
      expect(f.credentialHome).not.toHaveBeenCalled()
      expect(f.start).not.toHaveBeenCalled()
      expect(f.browser).not.toHaveBeenCalled()
      expect(f.changed).not.toHaveBeenCalled()
    } finally {
      port.claim.release()
    }
  })
}

it('an owning profile cancels active A after selecting B; another profile cannot cancel it', async () => {
  const f = fixture(true)
  f.choose(f.a.id)
  const running = f.run(f.a.id)
  await vi.waitFor(() => expect(f.start).toHaveBeenCalledOnce())
  f.choose(f.b.id)
  await expect(f.run(f.b.id)).rejects.toThrow(/sign-in.*progress|signing in/i)
  expect(f.start).toHaveBeenCalledOnce()
  await host.cancelProviderSignIn('codex', 'pine')
  expect(f.cancel).not.toHaveBeenCalled()
  await host.cancelProviderSignIn('codex', 'fern')
  expect(await running).toMatchObject({ success: false, detail: 'canceled' })
  expect(f.cancel).toHaveBeenCalled()
})

it('cancellation during a pending selected sign-in start reaches its original signal', async () => {
  const f = fixture(true)
  f.start.mockImplementation(
    async (_p, _profile, signal) =>
      new Promise<ProviderSignIn>((_resolve, reject) => {
        const aborted = () => reject(new Error('Fictional pending login canceled'))
        if (signal?.aborted) aborted()
        else signal?.addEventListener('abort', aborted, { once: true })
      }),
  )
  const running = f.run(f.a.id)
  const rejected = expect(running).rejects.toThrow('Fictional pending login canceled')
  await vi.waitFor(() => expect(f.start).toHaveBeenCalledOnce())
  await host.cancelProviderSignIn('codex', 'fern')
  await rejected
  expect(f.start.mock.calls[0]?.[2]?.aborted).toBe(true)
  expect(f.browser).not.toHaveBeenCalled()
})

it('selected home and provider port stay held until the sign-in teardown actually settles', async () => {
  const f = fixture()
  const teardown = deferred<void>()
  release.push(() => teardown.resolve())
  f.cancel.mockImplementation(() => teardown.promise)
  const running = f.run(f.a.id)
  await vi.waitFor(() => expect(f.cancel).toHaveBeenCalledOnce())
  for (const key of [`credential:${f.home('fern', f.a)}`, 'oauth:codex']) {
    const held = claimResource(key, 'Fictional next gesture')
    if (held.ok) held.claim.release()
    expect(held.ok).toBe(false)
  }
  teardown.resolve()
  expect(await running).toMatchObject({ success: true })
  for (const key of [`credential:${f.home('fern', f.a)}`, 'oauth:codex']) {
    const free = claimResource(key, 'Fictional next gesture')
    expect(free.ok).toBe(true)
    if (free.ok) free.claim.release()
  }
})

function nativeFixture(status: 'saved' | 'throws' | 'unset') {
  const f = fixture()
  const keyPresence = vi.fn(() => {
    if (status === 'throws') throw new Error('Fictional unreadable status')
    return status === 'saved'
  })
  const homeOf = vi.fn((profile: string, id?: string) =>
    join(world.folder, 'fictional-native-login', profile, id ?? 'legacy'),
  )
  const paths: ProviderHomePaths = {
    managedRoot: world.folder,
    defaultProfile: 'brobot',
    homeOf,
    profiles: () => ['brobot', 'fern'],
    assertMayOpen: () => {},
  }
  const command = vi.fn(() => 'fictional-codex-command')
  const original = codex.startCodexLogin
  const loggedIn = deferred<void>()
  const transport: codex.CodexTransport = {
    async request(method) {
      if (method === 'account/login/start')
        return { loginId: 'fictional-oauth', authUrl: 'https://login.example.invalid/fictional' }
      if (method === 'getAuthStatus')
        return { authMethod: 'chatgpt', authToken: null, requiresOpenaiAuth: true }
      if (method === 'account/read')
        return { account: { type: 'chatgpt', email: 'fictional@example.invalid', planType: 'pro' } }
      return {}
    },
    notify() {},
    respond() {},
    respondError() {},
    close: vi.fn(),
    async *incoming() {
      await loggedIn.promise
      yield { kind: 'notification', method: 'account/login/completed', params: { success: true } }
    },
  }
  const login = vi
    .spyOn(codex, 'startCodexLogin')
    .mockImplementation(async (_factory, home, cwd, signal) => {
      const started = await original(() => transport, home, cwd, signal)
      loggedIn.resolve()
      return started
    })
  const native = codexAuth(paths, {
    command,
    key: { isSaved: keyPresence, current: f.unexpected, change: async () => f.unexpected() },
  })
  const bound = providerAuthFromHomes({ claude: native, codex: native })
  const direct: HomeStart = native.signIn.bind(native)
  const forwarded: Start = bound.signIn.bind(bound)
  return { ...f, keyPresence, homeOf, command, transport, login, direct, forwarded }
}
for (const adapted of [false, true]) {
  for (const status of ['saved', 'throws', 'unset'] as const) {
    it(`${adapted ? 'bound' : 'native'} selected sign-in A ignores ${status} global status`, async () => {
      const f = nativeFixture(status)
      const signal = new AbortController().signal
      const started = await (adapted
        ? f.forwarded('codex', 'fern', signal, f.a)
        : f.direct('fern', signal, f.a))
      expect(await started.completed).toMatchObject({
        success: true,
        state: { state: 'usable', login: 'account' },
      })
      expect(f.keyPresence).not.toHaveBeenCalled()
      expect(f.homeOf).toHaveBeenCalledExactlyOnceWith('fern', f.a.id)
      expect(f.login).toHaveBeenCalledWith(
        expect.any(Function),
        f.homeOf.mock.results[0]?.value,
        f.homeOf.mock.results[0]?.value,
        signal,
      )
      expect(f.command).toHaveBeenCalledOnce()
      expect(f.unexpected).not.toHaveBeenCalled()
      await started.cancel()
    })
  }
  it(`${adapted ? 'bound' : 'native'} API selection is refused before home or transport construction`, async () => {
    const f = nativeFixture('unset')
    await expect(
      adapted ? f.forwarded('codex', 'fern', undefined, f.api) : f.direct('fern', undefined, f.api),
    ).rejects.toThrow()
    expect(f.keyPresence).not.toHaveBeenCalled()
    expect(f.homeOf).not.toHaveBeenCalled()
    expect(f.command).not.toHaveBeenCalled()
    expect(f.login).not.toHaveBeenCalled()
  })
  for (const status of ['saved', 'throws'] as const) {
    it(`${adapted ? 'bound' : 'native'} omitted sign-in keeps the ${status} legacy key veto`, async () => {
      const f = nativeFixture(status)
      await expect(adapted ? f.forwarded('codex', 'fern') : f.direct('fern')).rejects.toThrow(
        'An API key is saved for Codex',
      )
      expect(f.keyPresence).toHaveBeenCalledOnce()
      expect(f.homeOf).not.toHaveBeenCalled()
      expect(f.command).not.toHaveBeenCalled()
    })
  }
}
