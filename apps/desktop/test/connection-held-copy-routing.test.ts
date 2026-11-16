import { afterEach, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FakeRuntime } from '@brobot2/runtime'
import { CodexRefusedItsSignInError, codexCopyIdentityIn } from '@brobot2/runtime/codex'
import type { ProviderHomePaths } from '../src/main/providers/module'
import { codexAuth } from '../src/main/providers/codex'
import { providerAuthFromHomes } from '../src/main/providers'
import { claimResource } from '../src/main/runtime/held-resources'
import type { Provider, ProviderConnection } from '@brobot2/shared'
import type { ProviderAuthOps } from '../src/main/providers/auth-operations'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { deriveProviderHome } from '../src/main/connections/homes'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import { fixtureProviderConfig, neutralHostDeps } from './lib/host-fixture'

let world: AServiceWorld
let host: RuntimeHost
afterEach(async () => {
  await host?.closeAll()
  await world?.cleanUp()
  vi.restoreAllMocks()
})

function signInConnection(provider: Provider, id: string, name: string): ProviderConnection {
  return {
    id,
    provider,
    name,
    authMethod: 'sign-in',
    credentialSource: 'provider-sign-in',
    baseUrl: null,
    enabled: true,
    contractVersion: 1,
  }
}

type CopyReplacement = (
  provider: Provider,
  profileId: string,
  refused: unknown,
  stillWanted: () => boolean,
  connection?: ProviderConnection,
) => ReturnType<ProviderAuthOps['replaceARefusedCopy']>

type HomeCopyReplacement = (
  profileId: string,
  refused: unknown,
  stillWanted: () => boolean,
  connection?: ProviderConnection,
) => ReturnType<ProviderAuthOps['replaceARefusedCopy']>

function keyPresence(state?: 'saved' | 'throws' | 'unset') {
  return vi.fn(() => {
    if (state === 'throws') throw new Error('Fictional key status unreadable')
    return state === 'saved'
  })
}

function fixture(
  provider: Provider,
  resolver = true,
  auth = true,
  replace?: CopyReplacement,
  options: { keyState?: 'saved' | 'throws' | 'unset'; apiKey?: boolean } = {},
) {
  world = aServiceWorld()
  world.anAgent('fern', 'normal', provider)
  const a: ProviderConnection = {
    ...signInConnection(provider, 'endpoint-a', 'Endpoint A'),
    ...(options.apiKey ? { authMethod: 'api-key', credentialSource: 'provider-api-key' } : {}),
  }
  const keyPresent = keyPresence(options.keyState)
  const b = signInConnection(provider, 'endpoint-b', 'Endpoint B')
  const builtin = signInConnection(provider, `${provider}:sign-in`, 'Sign-in')
  for (const row of [a, b])
    world.db
      .prepare(
        'INSERT INTO provider_connection(id, provider, name, auth_method, credential_source) VALUES(?,?,?,?,?)',
      )
      .run(row.id, row.provider, row.name, row.authMethod, row.credentialSource)
  const home = (p: Provider, profileId: string, row?: ProviderConnection) =>
    deriveProviderHome(world.folder, { provider: p, profileId, connectionId: row?.id })
  const credentialHome = vi.fn<ProviderAuthOps['credentialHome']>(home)
  const noGesture = vi.fn((): never => {
    throw new Error('No credential gesture')
  })
  const check = vi.fn<ProviderAuthOps['check']>(async () => ({
    state: 'absent',
    reason: 'Fictional absent sign-in',
  }))
  const ops: ProviderAuthOps = {
    check,
    credentialHome,
    reprovision: noGesture,
    signIn: noGesture,
    replaceARefusedCopy: replace ?? noGesture,
  }
  const resolve = vi.fn((p: Provider, id?: string | null): ProviderConnection => {
    if (p !== provider) throw new Error('Unexpected provider')
    if (id == null) return builtin
    const row = [a, b, builtin].find((one) => one.id === id || one.name === id)
    if (row === undefined) throw new Error('Unknown fictional route')
    return row
  })
  const runtime = new FakeRuntime(provider)
  const start = vi.spyOn(runtime, 'start')
  const prepare = vi.fn(async (p: Provider, profileId: string, row?: ProviderConnection) => {
    const path = home(p, profileId, row)
    mkdirSync(path, { recursive: true })
    return { home: path, runtime }
  })
  host = new RuntimeHost({
    ...neutralHostDeps(() => world.folder),
    store: world.store,
    createRuntime: () => runtime,
    prepareProviderHome: async (p, profileId) => (await prepare(p, profileId)).home,
    providerHomePath: (p, profileId) => home(p, profileId),
    prepareProviderLaunch: prepare,
    ...(resolver ? { connectionFor: resolve } : {}),
    ...(auth ? { providerAuth: ops } : {}),
    ...(options.keyState === undefined
      ? {}
      : {
          apiKeys: {
            status: (p: Provider) => {
              const set = keyPresent()
              return { provider: p, set, setAt: set ? 123 : null, inUse: set }
            },
            read: noGesture,
            set: noGesture,
            remove: noGesture,
          },
        }),
    listProfiles: () => ['brobot', 'fern'],
    resolveCwd: () => world.folder,
    readProviderConfig: fixtureProviderConfig,
    newSessionId: () => 'fictional-held-copy',
  })
  const running = async (connectionId?: string) => {
    const created = await host.createSession(
      {
        provider,
        profileId: 'fern',
        cwd: world.folder,
        ...(connectionId === undefined ? {} : { connectionId }),
      },
      world.window,
    )
    const result = start.mock.results.at(-1)
    if (result?.type !== 'return') throw new Error('No fake start')
    const handle = await result.value
    const checkSignIn = vi.fn(async () => false)
    Object.assign(handle, { checkSignIn })
    credentialHome.mockClear()
    prepare.mockClear()
    resolve.mockClear()
    check.mockClear()
    start.mockClear()
    keyPresent.mockClear()
    const refuse = async () => {
      await handle.runTurnRefusedOnItsLogin()
      await vi.waitFor(() => {
        expect(
          world.store
            .events(created.sessionId)
            .some(({ event }) => event.type === 'turn' && event.state === 'failed'),
        ).toBe(true)
        expect(checkSignIn).toHaveBeenCalledOnce()
      })
      expect(prepare).not.toHaveBeenCalled()
      expect(resolve).not.toHaveBeenCalled()
      expect(check).not.toHaveBeenCalled()
      expect(start).not.toHaveBeenCalled()
      expect(noGesture).not.toHaveBeenCalled()
    }
    return { created, refuse, handle }
  }
  return { a, b, builtin, home, credentialHome, running, runtime, start, keyPresent }
}

for (const id of ['Endpoint A', 'endpoint-a']) {
  it(`Codex reads the frozen ${id} copy after the agent default moves to B`, async () => {
    const f = fixture('codex')
    const { created, refuse } = await f.running(id)
    world.store.setModelChoice('fern', {
      provider: 'codex',
      model: 'model-b',
      effort: null,
      connectionId: f.b.id,
    })
    await refuse()
    expect(f.credentialHome).toHaveBeenCalledExactlyOnceWith('codex', 'fern', f.a)
    expect(f.credentialHome.mock.calls[0]?.[2]).toBe(f.a)
    expect(f.credentialHome.mock.results[0]?.value).toBe(f.home('codex', 'fern', f.a))
    expect(f.home('codex', 'fern', f.a)).not.toBe(f.home('codex', 'fern', f.b))
    expect(existsSync(f.home('codex', 'fern', f.a) + '/auth.json')).toBe(false)
    expect(world.store.connectionOf(created.sessionId)).toBe(f.a.id)
    expect(world.store.modelChoiceOf('fern')?.connectionId).toBe(f.b.id)
  })
}

it('Codex keeps the old two-argument copy read when there is no connection resolver', async () => {
  const f = fixture('codex', false)
  const { created, refuse } = await f.running()
  await refuse()
  expect(f.credentialHome).toHaveBeenCalledExactlyOnceWith('codex', 'fern')
  expect(f.credentialHome.mock.results[0]?.value).toBe(f.home('codex', 'fern'))
  expect(world.store.connectionOf(created.sessionId)).toBeNull()
})

it('Codex forwards its builtin sign-in row while both builtin home paths stay legacy', async () => {
  const f = fixture('codex')
  const { refuse } = await f.running(f.builtin.id)
  await refuse()
  expect(f.credentialHome).toHaveBeenCalledExactlyOnceWith('codex', 'fern', f.builtin)
  expect(f.credentialHome.mock.calls[0]?.[2]).toBe(f.builtin)
  expect(f.home('codex', 'fern', f.builtin)).toBe(f.home('codex', 'fern'))
  expect(f.home('codex', 'fern', { ...f.builtin, id: 'codex:api-key' })).toBe(
    f.home('codex', 'fern'),
  )
})

it('a missing copy-home read still leaves the failed turn without a credential gesture', async () => {
  const f = fixture('codex')
  const { refuse } = await f.running(f.a.id)
  f.credentialHome.mockImplementation(() => {
    throw new Error('Fictional unavailable home')
  })
  await refuse()
  expect(f.credentialHome).toHaveBeenCalledExactlyOnceWith('codex', 'fern', f.a)
})

it('Claude has no copy reader even when its running conversation holds A', async () => {
  const f = fixture('claude')
  const { refuse } = await f.running(f.a.id)
  await refuse()
  expect(f.credentialHome).not.toHaveBeenCalled()
})

it('Codex without auth operations still records the failed turn without reading a copy', async () => {
  const f = fixture('codex', true, false)
  const { refuse } = await f.running(f.a.id)
  await refuse()
  expect(f.credentialHome).not.toHaveBeenCalled()
})

function heldCopy(home: string, text = 'Fictional refused-copy fixture') {
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, 'auth.json'), text)
  const copy = codexCopyIdentityIn(home)
  expect(copy).not.toBeNull()
  return copy
}

for (const keyState of [undefined, 'saved', 'throws'] as const) {
  for (const opening of ['fresh', 'resume', 'turn'] as const) {
    it(`Codex ${opening} replacement carries A's row into the claim and writer after default B${keyState === undefined ? '' : ` with ${keyState} global key status`}`, async () => {
      const replace = vi.fn<CopyReplacement>(async () => 'not-tried')
      const f = fixture('codex', true, true, replace, { keyState })
      const copy = heldCopy(f.home('codex', 'fern', f.a))
      world.store.setModelChoice('fern', {
        provider: 'codex',
        model: 'fake-codex-a',
        effort: 'medium',
        connectionId: f.b.id,
      })
      if (opening === 'fresh') {
        f.start.mockImplementationOnce(async () => {
          f.keyPresent.mockClear()
          throw new CodexRefusedItsSignInError('Fictional refused start', copy)
        })
        await expect(
          host.createSession(
            { provider: 'codex', profileId: 'fern', connectionId: 'Endpoint A', cwd: world.folder },
            world.window,
          ),
        ).rejects.toThrow()
      } else {
        const running = await f.running(f.a.id)
        if (opening === 'resume') {
          await host.close(running.created.sessionId, world.window)
          vi.spyOn(f.runtime, 'resume').mockImplementationOnce(async () => {
            f.keyPresent.mockClear()
            throw new CodexRefusedItsSignInError('Fictional refused resume', copy)
          })
          f.credentialHome.mockClear()
          await expect(
            host.resumeSession(running.created.sessionId, world.window),
          ).rejects.toThrow()
        } else {
          Object.assign(running.handle, { signInCopyAtLaunch: () => copy })
          await running.refuse()
        }
        expect(world.store.connectionOf(running.created.sessionId)).toBe(f.a.id)
      }
      await vi.waitFor(() => expect(replace).toHaveBeenCalledOnce())
      expect(replace).toHaveBeenCalledWith('codex', 'fern', copy, expect.any(Function), f.a)
      expect(replace.mock.calls[0]?.[4]).toBe(f.a)
      expect(
        f.credentialHome.mock.calls.every((call) => call.length === 3 && call[2] === f.a),
      ).toBe(true)
      expect(world.store.modelChoiceOf('fern')?.connectionId).toBe(f.b.id)
      expect(f.keyPresent).not.toHaveBeenCalled()
    })
  }
}

for (const legacy of [false, true]) {
  it(`Codex replacement keeps ${legacy ? 'absent-row arities' : 'the builtin row and legacy home'}`, async () => {
    const replace = vi.fn<CopyReplacement>(async () => 'not-tried')
    const f = fixture('codex', !legacy, true, replace)
    const copy = heldCopy(f.home('codex', 'fern'))
    const running = await f.running(legacy ? undefined : f.builtin.id)
    Object.assign(running.handle, { signInCopyAtLaunch: () => copy })
    await running.refuse()
    await vi.waitFor(() => expect(replace).toHaveBeenCalledOnce())
    expect(replace.mock.calls[0]).toEqual(
      legacy
        ? ['codex', 'fern', copy, expect.any(Function)]
        : ['codex', 'fern', copy, expect.any(Function), f.builtin],
    )
    expect(f.credentialHome.mock.calls).toEqual(
      legacy
        ? [
            ['codex', 'fern'],
            ['codex', 'fern'],
          ]
        : [
            ['codex', 'fern', f.builtin],
            ['codex', 'fern', f.builtin],
          ],
    )
  })
}

for (const blocked of ['legacy', 'A'] as const) {
  it(`a claim on ${blocked} ${blocked === 'A' ? 'blocks' : 'does not block'} A's replacement`, async () => {
    const replace = vi.fn<CopyReplacement>(async () => 'not-tried')
    const f = fixture('codex', true, true, replace)
    const copy = heldCopy(f.home('codex', 'fern', f.a))
    const running = await f.running(f.a.id)
    Object.assign(running.handle, { signInCopyAtLaunch: () => copy })
    const home = f.home('codex', 'fern', blocked === 'A' ? f.a : undefined)
    const held = claimResource(`credential:${home}`, 'Fictional existing gesture')
    if (!held.ok) throw new Error('Fixture home already held')
    try {
      await running.refuse()
      await vi.waitFor(() => expect(f.credentialHome).toHaveBeenCalledTimes(2))
      if (blocked === 'A') expect(replace).not.toHaveBeenCalled()
      else expect(replace).toHaveBeenCalledOnce()
      expect(f.credentialHome.mock.calls[1]).toEqual(['codex', 'fern', f.a])
    } finally {
      held.claim.release()
    }
  })
}

function nativeReplacement(withMachine = true, keyState?: 'saved' | 'throws' | 'unset') {
  const f = fixture('codex')
  const text = (name: string, when: string) =>
    JSON.stringify({
      auth_mode: 'chatgpt',
      tokens: { account_id: 'acct-fictional-copy' },
      last_refresh: when,
      fixture: name,
    })
  const before = text('held', '2026-10-01T00:00:00Z')
  const fresh = text('fresh', '2026-11-01T00:00:00Z')
  const file = (row?: ProviderConnection) => join(f.home('codex', 'fern', row), 'auth.json')
  for (const row of [f.a, f.b, undefined]) heldCopy(f.home('codex', 'fern', row), before)
  const machine = join(world.folder, 'fictional-machine.json')
  if (withMachine) writeFileSync(machine, fresh)
  const homeOf = vi.fn((profileId: string, connectionId?: string) =>
    deriveProviderHome(world.folder, { provider: 'codex', profileId, connectionId }),
  )
  const paths: ProviderHomePaths = {
    managedRoot: world.folder,
    defaultProfile: 'brobot',
    homeOf,
    profiles: () => ['brobot', 'fern'],
    assertMayOpen: () => {},
  }
  const keyPresent = keyPresence(keyState)
  const noKeyOperation = vi.fn((): never => {
    throw new Error('No key operation')
  })
  const native = codexAuth(paths, {
    command: () => {
      throw new Error('No provider command')
    },
    machineAuthPath: () => machine,
    ...(keyState === undefined
      ? {}
      : {
          key: {
            isSaved: keyPresent,
            current: noKeyOperation,
            change: async () => noKeyOperation(),
          },
        }),
  })
  const direct: HomeCopyReplacement = native.replaceARefusedCopy.bind(native)
  const bound = providerAuthFromHomes({ claude: native, codex: native })
  const forwarded: CopyReplacement = bound.replaceARefusedCopy.bind(bound)
  return { ...f, before, fresh, text, file, homeOf, direct, forwarded, keyPresent, noKeyOperation }
}

for (const keyState of [undefined, 'saved', 'throws'] as const) {
  for (const adapted of [false, true]) {
    it(`${adapted ? 'the bound auth adapter' : 'the native writer'} replaces only A using its recorded copy${keyState === undefined ? '' : ` with ${keyState} global key status`}`, async () => {
      const f = nativeReplacement(true, keyState)
      const copy = codexCopyIdentityIn(f.home('codex', 'fern', f.a))
      const result = adapted
        ? await f.forwarded('codex', 'fern', copy, () => true, f.a)
        : await f.direct('fern', copy, () => true, f.a)
      expect(result).toBe('the-computers')
      expect(f.homeOf).toHaveBeenCalledWith('fern', f.a.id)
      expect(readFileSync(f.file(f.a), 'utf8')).toBe(f.fresh)
      expect(readFileSync(f.file(f.b), 'utf8')).toBe(f.before)
      expect(readFileSync(f.file(), 'utf8')).toBe(f.before)
      expect(f.keyPresent).not.toHaveBeenCalled()
      expect(f.noKeyOperation).not.toHaveBeenCalled()
    })
  }
}

for (const legacy of [false, true]) {
  it(`native copy replacement preserves ${legacy ? 'omitted identity' : 'builtin identity'} on the legacy home`, async () => {
    const f = nativeReplacement()
    const copy = codexCopyIdentityIn(f.home('codex', 'fern'))
    expect(
      await (legacy
        ? f.direct('fern', copy, () => true)
        : f.direct('fern', copy, () => true, f.builtin)),
    ).toBe('the-computers')
    expect(readFileSync(f.file(), 'utf8')).toBe(f.fresh)
    expect(readFileSync(f.file(f.a), 'utf8')).toBe(f.before)
    expect(readFileSync(f.file(f.b), 'utf8')).toBe(f.before)
  })
}

for (const noLongerWanted of [false, true]) {
  it(`native A replacement leaves every file alone when ${noLongerWanted ? 'the caller no longer wants it' : 'the refused copy has changed'}`, async () => {
    const f = nativeReplacement()
    const copy = codexCopyIdentityIn(f.home('codex', 'fern', f.a))
    const current = noLongerWanted ? f.before : f.before + '\n'
    if (!noLongerWanted) writeFileSync(f.file(f.a), current)
    expect(await f.direct('fern', copy, () => !noLongerWanted, f.a)).toBe('not-tried')
    expect(readFileSync(f.file(f.a), 'utf8')).toBe(current)
    expect(readFileSync(f.file(f.b), 'utf8')).toBe(f.before)
    expect(readFileSync(f.file(), 'utf8')).toBe(f.before)
  })
}

function brobotCopies(
  f: ReturnType<typeof nativeReplacement>,
  ownA: string | null,
  legacyAt = '2026-12-01T00:00:00Z',
) {
  const ownFile = (row?: ProviderConnection) => join(f.home('codex', 'brobot', row), 'auth.json')
  const b = f.text('BroBot B', '2026-12-02T00:00:00Z')
  const legacy = f.text('BroBot legacy', legacyAt)
  if (ownA !== null) heldCopy(f.home('codex', 'brobot', f.a), ownA)
  heldCopy(f.home('codex', 'brobot', f.b), b)
  heldCopy(f.home('codex', 'brobot'), legacy)
  return { ownFile, b, legacy }
}

for (const source of ['own A', 'missing A', 'unusable A'] as const) {
  it(`A's replacement uses ${source} without borrowing newer BroBot B or legacy`, async () => {
    const f = nativeReplacement(false)
    const ownA =
      source === 'own A'
        ? f.text('BroBot A', '2026-11-02T00:00:00Z')
        : source === 'missing A'
          ? null
          : 'Fictional unavailable sign-in'
    const homes = brobotCopies(f, ownA)
    const copy = codexCopyIdentityIn(f.home('codex', 'fern', f.a))
    const answer = await f.direct('fern', copy, () => true, f.a)
    expect(answer).toBe(source === 'own A' ? 'brobots-own' : 'not-tried')
    expect(readFileSync(f.file(f.a), 'utf8')).toBe(source === 'own A' ? ownA : f.before)
    expect(f.homeOf).toHaveBeenCalledWith('brobot', f.a.id)
    expect(readFileSync(f.file(f.b), 'utf8')).toBe(f.before)
    expect(readFileSync(f.file(), 'utf8')).toBe(f.before)
    expect(readFileSync(homes.ownFile(f.b), 'utf8')).toBe(homes.b)
    expect(readFileSync(homes.ownFile(), 'utf8')).toBe(homes.legacy)
    if (ownA === null) expect(existsSync(homes.ownFile(f.a))).toBe(false)
    else expect(readFileSync(homes.ownFile(f.a), 'utf8')).toBe(ownA)
  })
}

for (const omitted of [false, true]) {
  it(`${omitted ? 'an omitted' : 'a builtin'} replacement source keeps BroBot's legacy home`, async () => {
    const f = nativeReplacement(false)
    const homes = brobotCopies(f, f.text('BroBot A', '2026-12-03T00:00:00Z'))
    const copy = codexCopyIdentityIn(f.home('codex', 'fern'))
    expect(
      await (omitted
        ? f.direct('fern', copy, () => true)
        : f.direct('fern', copy, () => true, f.builtin)),
    ).toBe('brobots-own')
    expect(readFileSync(f.file(), 'utf8')).toBe(homes.legacy)
    expect(readFileSync(f.file(f.a), 'utf8')).toBe(f.before)
    expect(readFileSync(f.file(f.b), 'utf8')).toBe(f.before)
    if (omitted)
      expect(f.homeOf.mock.calls.filter(([profile]) => profile === 'brobot')).toEqual([['brobot']])
  })
}

for (const freshness of ['older', 'tie', 'newer'] as const) {
  it(`A's own fallback ${freshness} than the machine preserves existing candidate priority`, async () => {
    const f = nativeReplacement()
    const ownA = f.text(
      'BroBot A',
      freshness === 'older'
        ? '2026-10-15T00:00:00Z'
        : freshness === 'tie'
          ? '2026-11-01T00:00:00Z'
          : '2026-11-15T00:00:00Z',
    )
    const homes = brobotCopies(f, ownA, '2026-10-15T00:00:00Z')
    const copy = codexCopyIdentityIn(f.home('codex', 'fern', f.a))
    expect(await f.direct('fern', copy, () => true, f.a)).toBe(
      freshness === 'newer' ? 'brobots-own' : 'the-computers',
    )
    expect(readFileSync(f.file(f.a), 'utf8')).toBe(freshness === 'newer' ? ownA : f.fresh)
    expect(readFileSync(homes.ownFile(f.a), 'utf8')).toBe(ownA)
    expect(readFileSync(homes.ownFile(f.b), 'utf8')).toBe(homes.b)
    expect(readFileSync(homes.ownFile(), 'utf8')).toBe(homes.legacy)
    expect(readFileSync(f.file(f.b), 'utf8')).toBe(f.before)
    expect(readFileSync(f.file(), 'utf8')).toBe(f.before)
  })
}

for (const choice of ['api-row', 'legacy-saved', 'legacy-throws'] as const) {
  it(`${choice} leaves a refused copy and its credential claim alone`, async () => {
    const replace = vi.fn<CopyReplacement>(async () => 'not-tried')
    const explicit = choice === 'api-row'
    const f = fixture('codex', explicit, true, replace, {
      apiKey: explicit,
      keyState: explicit ? 'unset' : choice === 'legacy-saved' ? 'saved' : 'throws',
    })
    const copy = heldCopy(f.home('codex', 'fern', explicit ? f.a : undefined))
    f.start.mockImplementationOnce(async () => {
      f.keyPresent.mockClear()
      throw new CodexRefusedItsSignInError('Fictional refused start', copy)
    })
    await expect(
      host.createSession(
        {
          provider: 'codex',
          profileId: 'fern',
          cwd: world.folder,
          ...(explicit ? { connectionId: f.a.id } : {}),
        },
        world.window,
      ),
    ).rejects.toThrow()
    expect(replace).not.toHaveBeenCalled()
    expect(f.credentialHome).not.toHaveBeenCalled()
    if (explicit) expect(f.keyPresent).not.toHaveBeenCalled()
    else expect(f.keyPresent).toHaveBeenCalled()
    expect(codexCopyIdentityIn(f.home('codex', 'fern', explicit ? f.a : undefined))).toEqual(copy)
  })
}

for (const adapted of [false, true]) {
  it(`${adapted ? 'bound' : 'native'} replacement never writes an API-key row when the global key is absent`, async () => {
    const f = nativeReplacement(true, 'unset')
    const selected: ProviderConnection = {
      ...f.a,
      authMethod: 'api-key',
      credentialSource: 'provider-api-key',
    }
    const copy = codexCopyIdentityIn(f.home('codex', 'fern', f.a))
    f.homeOf.mockClear()
    expect(
      await (adapted
        ? f.forwarded('codex', 'fern', copy, () => true, selected)
        : f.direct('fern', copy, () => true, selected)),
    ).toBe('not-tried')
    expect(f.keyPresent).not.toHaveBeenCalled()
    expect(f.noKeyOperation).not.toHaveBeenCalled()
    expect(f.homeOf).not.toHaveBeenCalled()
    expect(readFileSync(f.file(f.a), 'utf8')).toBe(f.before)
    expect(readFileSync(f.file(f.b), 'utf8')).toBe(f.before)
    expect(readFileSync(f.file(), 'utf8')).toBe(f.before)
  })
}
