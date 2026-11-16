import { afterEach, expect, it, vi } from 'vitest'
import { mkdirSync } from 'node:fs'
import { FakeRuntime } from '@brobot2/runtime'
import type { ProviderConnection } from '@brobot2/shared'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { LoginRenewalOperations } from '../src/main/providers/auth-types'
import { deriveProviderHome } from '../src/main/connections/homes'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import { fixtureProviderConfig, neutralHostDeps } from './lib/host-fixture'

const MARKER = 'Fictional renewal fixture fatal error'
let world: AServiceWorld
let host: RuntimeHost
afterEach(async () => {
  await host?.closeAll()
  await world?.cleanUp()
  vi.restoreAllMocks()
})

async function fixture(
  mode: 'sign-in' | 'api-key' | 'legacy',
  global: 'saved' | 'throws' | 'unset',
  cause: 'auth' | 'auth_stale' = 'auth',
  marksKey = mode === 'api-key',
) {
  world = aServiceWorld()
  world.anAgent('fern', 'normal', 'claude')
  const row: ProviderConnection = {
    id: 'fictional-renewal-a',
    provider: 'claude',
    name: 'Fictional renewal A',
    authMethod: mode === 'api-key' ? 'api-key' : 'sign-in',
    credentialSource: mode === 'api-key' ? 'provider-api-key' : 'provider-sign-in',
    baseUrl: null,
    enabled: true,
    contractVersion: 1,
  }
  world.db
    .prepare(
      'INSERT INTO provider_connection(id,provider,name,auth_method,credential_source) VALUES(?,?,?,?,?)',
    )
    .run(row.id, row.provider, row.name, row.authMethod, row.credentialSource)
  const keyStatus = vi.fn(() => {
    if (global === 'throws') throw new Error('Fictional unreadable global key status')
    const set = global === 'saved'
    return { provider: 'claude' as const, set, setAt: set ? 123 : null, inUse: set }
  })
  const noKeyOperation = vi.fn((): never => {
    throw new Error('No key operation')
  })
  let afterFailure = false
  let moved = false
  const order: string[] = []
  const renew = vi.fn<LoginRenewalOperations['renew']>(async () => {
    order.push('renew')
    if (!afterFailure) return 'not-needed'
    moved = true
    return 'renewed'
  })
  const renewRejected = vi.fn<NonNullable<LoginRenewalOperations['renewRejected']>>(async () => {
    order.push('renewRejected')
    moved = true
    return 'renewed'
  })
  const prepareRenewal = vi.fn<LoginRenewalOperations['prepare']>(async (prepare, runRenewal) => {
    const outcome = await runRenewal()
    return { home: await prepare(), loginRenewed: outcome === 'renewed' }
  })
  const runtime = new FakeRuntime('claude')
  const handles: Awaited<ReturnType<FakeRuntime['start']>>[] = []
  const closed = new Set<Awaited<ReturnType<FakeRuntime['start']>>>()
  const decorate = (handle: Awaited<ReturnType<FakeRuntime['start']>>) => {
    const events = handle.events.bind(handle)
    vi.spyOn(handle, 'events').mockImplementation(async function* () {
      try {
        for await (const event of events()) {
          yield event.type === 'error' && event.fatal && event.message === MARKER
            ? { ...event, cause, ...(marksKey ? { onAKey: true as const } : {}) }
            : event
        }
      } finally {
        closed.add(handle)
      }
    })
    Object.assign(handle, { checkSignIn: vi.fn(async () => moved) })
    handles.push(handle)
    return handle
  }
  const originalStart = runtime.start.bind(runtime)
  const originalResume = runtime.resume.bind(runtime)
  const start = vi
    .spyOn(runtime, 'start')
    .mockImplementation(async (...args) => decorate(await originalStart(...args)))
  const resume = vi
    .spyOn(runtime, 'resume')
    .mockImplementation(async (...args) => decorate(await originalResume(...args)))
  const prepare = vi.fn(
    async (provider: 'claude' | 'codex', profileId: string, selected?: ProviderConnection) => {
      order.push('prepare')
      const home = deriveProviderHome(world.folder, {
        provider,
        profileId,
        connectionId: selected?.id,
      })
      mkdirSync(home, { recursive: true })
      return { home, runtime }
    },
  )
  host = new RuntimeHost({
    ...neutralHostDeps(() => world.folder),
    store: world.store,
    createRuntime: () => runtime,
    prepareProviderHome: async (provider, profileId) => (await prepare(provider, profileId)).home,
    prepareProviderLaunch: prepare,
    providerHomePath: (provider, profileId) =>
      deriveProviderHome(world.folder, { provider, profileId }),
    ...(mode === 'legacy' ? {} : { connectionFor: () => row }),
    loginRenewal: (provider) =>
      provider === 'claude'
        ? {
            launchLabel: 'Fictional Claude renewal',
            renew,
            renewRejected,
            rejectedTurnContinuation: 'Continue the fictional message.',
            prepare: prepareRenewal,
          }
        : undefined,
    apiKeys: {
      status: keyStatus,
      set: noKeyOperation,
      read: noKeyOperation,
      remove: noKeyOperation,
    },
    listProfiles: () => ['brobot', 'fern'],
    resolveCwd: () => world.folder,
    readProviderConfig: fixtureProviderConfig,
    newSessionId: () => 'fictional-renewal-session',
  })
  const create = () =>
    host.createSession(
      {
        provider: 'claude',
        profileId: 'fern',
        cwd: world.folder,
        approvalMode: 'ask',
        ...(mode === 'legacy' ? {} : { connectionId: row.id }),
      },
      world.window,
    )
  const clear = () => {
    renew.mockClear()
    renewRejected.mockClear()
    prepareRenewal.mockClear()
    prepare.mockClear()
    keyStatus.mockClear()
    order.length = 0
  }
  const fail = async (id: string) => {
    const handle = handles.at(-1)!
    await host.queueMessage(id, 'Fictional request before login refusal', world.window)
    await vi.waitFor(() =>
      expect(world.store.events(id).some(({ event }) => event.type === 'permission_request')).toBe(
        true,
      ),
    )
    afterFailure = true
    handle.simulateError(MARKER, true)
    await vi.waitFor(() => {
      expect(closed.has(handle)).toBe(true)
      expect(
        world.store
          .events(id)
          .some(({ event }) => event.type === 'turn' && event.state === 'failed'),
      ).toBe(true)
    })
  }
  const settled = async (id: string, schedules: boolean) => {
    if (schedules)
      await vi.waitFor(() =>
        expect(
          world.store
            .events(id)
            .some(({ event }) => event.type === 'work_recovery' && event.phase !== 'pending'),
        ).toBe(true),
      )
    else await vi.waitFor(() => expect(world.store.recordedOne(id)?.status).toBe('errored'))
  }
  return {
    row,
    create,
    clear,
    fail,
    settled,
    renew,
    renewRejected,
    prepareRenewal,
    prepare,
    keyStatus,
    noKeyOperation,
    resume,
    start,
    order,
    handles,
    move: () => {
      moved = true
    },
  }
}

for (const mode of ['sign-in', 'api-key', 'legacy'] as const) {
  for (const global of ['saved', 'throws', 'unset'] as const) {
    for (const opening of ['fresh', 'resume'] as const) {
      it(`${mode}/${global}: ${opening} preparation renews only its selected login mode`, async () => {
        const f = await fixture(mode, global)
        const created = await f.create()
        if (opening === 'resume') {
          await host.close(created.sessionId, world.window)
          f.clear()
          await host.resumeSession(created.sessionId, world.window)
        }
        const expected = mode === 'sign-in' || (mode === 'legacy' && global === 'unset')
        expect(f.renew).toHaveBeenCalledTimes(expected ? 1 : 0)
        expect(f.prepareRenewal).toHaveBeenCalledTimes(expected ? 1 : 0)
        expect(f.order[0]).toBe(expected ? 'renew' : 'prepare')
        if (expected) expect(f.order.indexOf('renew')).toBeLessThan(f.order.indexOf('prepare'))
        if (mode !== 'legacy') expect(f.keyStatus).not.toHaveBeenCalled()
        expect(f.noKeyOperation).not.toHaveBeenCalled()
        expect(f.prepare.mock.calls.at(-1)?.[2]).toBe(mode === 'legacy' ? undefined : f.row)
        expect(world.store.connectionOf(created.sessionId)).toBe(
          mode === 'legacy' ? null : f.row.id,
        )
      })
    }
    for (const cause of ['auth', 'auth_stale'] as const) {
      it(`${mode}/${global}: fatal ${cause} settles the actual turn before its mode-specific renewal decision`, async () => {
        const f = await fixture(mode, global, cause)
        const created = await f.create()
        f.clear()
        await f.fail(created.sessionId)
        const expected = mode === 'sign-in' || (mode === 'legacy' && global === 'unset')
        await f.settled(created.sessionId, expected || cause === 'auth_stale')
        expect(f.renewRejected).toHaveBeenCalledTimes(expected ? 1 : 0)
        expect(f.resume).toHaveBeenCalledTimes(expected ? 1 : 0)
        expect(
          world.store.events(created.sessionId).some(({ event }) => event.type === 'reopened'),
        ).toBe(expected)
        if (!expected) expect(f.renew).not.toHaveBeenCalled()
        if (mode !== 'legacy') expect(f.keyStatus).not.toHaveBeenCalled()
        expect(f.noKeyOperation).not.toHaveBeenCalled()
        expect(world.store.connectionOf(created.sessionId)).toBe(
          mode === 'legacy' ? null : f.row.id,
        )
      })
    }
  }
}

it('an API-key row alone prevents rejected-login renewal when the provider omits onAKey', async () => {
  const f = await fixture('api-key', 'unset', 'auth', false)
  const created = await f.create()
  f.clear()
  await f.fail(created.sessionId)
  await f.settled(created.sessionId, false)
  expect(f.renewRejected).not.toHaveBeenCalled()
  expect(f.renew).not.toHaveBeenCalled()
  expect(f.resume).not.toHaveBeenCalled()
  expect(f.keyStatus).not.toHaveBeenCalled()
  expect(f.noKeyOperation).not.toHaveBeenCalled()
  expect(world.store.recordedOne(created.sessionId)?.status).toBe('errored')
  expect(world.store.connectionOf(created.sessionId)).toBe(f.row.id)
  expect(world.store.events(created.sessionId).some(({ event }) => event.type === 'reopened')).toBe(
    false,
  )
})
