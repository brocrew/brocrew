import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FakeProviderSessions, type FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { resolveProviderConnection } from '../src/main/connections/records'
import { createSessionStore } from '../src/main/db/session-store'
import { usageKeptIn } from '../src/main/provider-usage-file'
import { RuntimeHost, THE_APP_ITSELF } from '../src/main/runtime/runtime-host'
import { ApiKeys } from '../src/main/runtime/api-keys'
import { neutralHostDeps, RecordingSink, syntheticProviderHome } from './lib/host-fixture'
import { sinkOwnerId } from '../src/main/runtime/window-caller'
import { anOpenGate, ProviderDouble } from './lib/provider-double'

let db: AppDatabase
let directory: string
let host: RuntimeHost
let handles: FakeSessionHandle[]
let saved: boolean
let clock: number
let count: number
const moved = vi.fn()
const sink = new RecordingSink(sinkOwnerId({ id: 1 }))
const sessions = new FakeProviderSessions()

function hostOn(apiKeys?: ApiKeys, lookAtTheLimitAgainMs?: number): RuntimeHost {
  return new RuntimeHost({
    ...neutralHostDeps(() => directory),
    ...(apiKeys === undefined ? {} : { apiKeys }),
    store: createSessionStore(db),
    connectionFor: (provider, connectionId) =>
      resolveProviderConnection(db, { provider, connectionId, keySaved: saved }),
    createRuntime: (provider) => new ProviderDouble(provider, handles, sessions, anOpenGate()),
    prepareProviderHome: syntheticProviderHome(() => directory),
    providerHomePath: (provider, profile) => join(directory, profile, provider),
    resolveCwd: () => directory,
    newSessionId: () => `fictional-usage-${++count}`,
    usageKept: usageKeptIn(db),
    lookAtTheLimitAgainMs,
    readProviderConfig: (_provider, home) => ({
      home,
      homeEnv: 'FICTIONAL_PROVIDER_HOME',
      model: 'fictional-small',
      authNote: null,
      files: [],
    }),
    now: () => clock,
    providersMoved: moved,
  })
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'brocrew-connection-usage-'))
  db = openDatabase(':memory:')
  applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
  handles = []
  saved = false
  count = 0
  moved.mockClear()
  clock = Date.UTC(2026, 10, 12)
  host = hostOn()
})

afterEach(async () => {
  await host.closeAll()
  db.close()
  rmSync(directory, { recursive: true, force: true })
})

async function open(provider: Provider, connectionId?: string, tag = 'a1'.repeat(16)) {
  const created = await host.createSession(
    { provider, profileId: 'fern', ...(connectionId === undefined ? {} : { connectionId }) },
    sink,
  )
  const handle = handles.at(-1)!
  Object.assign(handle, { signInTag: () => tag })
  return { created, handle }
}

async function emit(
  provider: Provider,
  handle: FakeSessionHandle,
  percent: number,
  resetsAt: number | null,
  connectionId?: string,
) {
  handle.simulateProviderUsage([{ window: 'seven_day', usedPercent: percent, resetsAt }])
  const reading = () =>
    host
      .providerUsage()
      [provider].find((row) => connectionId === undefined || row.connectionId === connectionId)
  await vi.waitFor(() => expect(reading()?.usedPercent).toBe(percent))
  return reading()!
}

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: a sparse update on the same selected route retains its reset`, async () => {
    saved = true
    const first = await open(provider, `${provider}:api-key`)
    const reset = clock + 3_600_000
    await emit(provider, first.handle, 30, reset)
    const reading = await emit(provider, first.handle, 12, null)
    expect(reading.resetsAt).toBe(reset)
  })

  it(`${provider}: identical figures on another route still publish its new attribution`, async () => {
    const first = await open(provider, `${provider}:sign-in`)
    await emit(provider, first.handle, 30, null)
    saved = true
    const second = await open(provider, `${provider}:api-key`)
    moved.mockClear()
    second.handle.simulateProviderUsage([{ window: 'seven_day', usedPercent: 30, resetsAt: null }])
    await vi.waitFor(() => expect(moved).toHaveBeenCalledWith({ what: 'usage', provider }))
    expect(
      host.providerUsage()[provider].find((row) => row.connectionId === `${provider}:api-key`),
    ).toMatchObject({
      connectionId: `${provider}:api-key`,
      usedPercent: 30,
    })
  })

  it(`${provider}: sparse readings never inherit another connection's reset`, async () => {
    const first = await open(provider, `${provider}:sign-in`)
    const reset = clock + 7 * 24 * 3_600_000
    await emit(provider, first.handle, 30, reset)
    saved = true
    const second = await open(provider, `${provider}:api-key`)
    const reading = await emit(provider, second.handle, 3, null, `${provider}:api-key`)
    expect(reading.resetsAt).toBeNull()
    expect(reading).toMatchObject({ connectionId: `${provider}:api-key` })
  })

  it(`${provider}: a still-running older session keeps its own route after the default changes`, async () => {
    const first = await open(provider, `${provider}:sign-in`)
    saved = true
    const second = await open(provider, `${provider}:api-key`)
    await emit(provider, second.handle, 3, null)
    const reading = await emit(provider, first.handle, 40, clock + 3_600_000, `${provider}:sign-in`)
    expect(reading).toMatchObject({ connectionId: `${provider}:sign-in` })
  })

  it(`${provider}: legacy NULL is attributed to the route this reopened life actually used`, async () => {
    const first = await open(provider)
    await host.close(first.created.sessionId, sink)
    db.prepare('UPDATE provider_session SET connection_id = NULL WHERE id = ?').run(
      first.created.sessionId,
    )
    saved = true
    await host.resumeSession(first.created.sessionId, sink)
    const handle = handles.at(-1)!
    Object.assign(handle, { signInTag: () => 'a1'.repeat(16) })
    saved = false
    const reading = await emit(provider, handle, 12, null)
    expect(reading).toMatchObject({ connectionId: `${provider}:api-key` })
    expect(createSessionStore(db).connectionOf(first.created.sessionId)).toBeNull()
  })

  it(`${provider}: restart retains the recorded identity unconfirmed instead of guessing today's default`, async () => {
    const first = await open(provider, `${provider}:sign-in`)
    await emit(provider, first.handle, 30, clock + 3_600_000)
    await host.closeAll()
    saved = true
    host = hostOn()
    const reading = host.providerUsage()[provider][0]!
    expect(reading).toMatchObject({ usedPercent: 30, unconfirmed: true })
    expect(reading).toHaveProperty('connectionId', `${provider}:sign-in`)
  })
}

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: keeps the same window for both recorded routes at once`, async () => {
    const subscription = await open(provider, `${provider}:sign-in`)
    await emit(provider, subscription.handle, 30, clock + 3_600_000)
    saved = true
    const key = await open(provider, `${provider}:api-key`, 'b2'.repeat(16))
    key.handle.simulateProviderUsage([
      { window: 'seven_day', usedPercent: 3, resetsAt: clock + 7_200_000 },
    ])
    await vi.waitFor(() =>
      expect(host.providerUsage()[provider]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ connectionId: `${provider}:sign-in`, usedPercent: 30 }),
          expect.objectContaining({ connectionId: `${provider}:api-key`, usedPercent: 3 }),
        ]),
      ),
    )
    expect(host.providerUsage()[provider]).toHaveLength(2)
  })

  it(`${provider}: a sparse return keeps each route's own reset after an intervening route`, async () => {
    const subscription = await open(provider, `${provider}:sign-in`)
    const subscriptionReset = clock + 3_600_000
    const keyReset = clock + 7_200_000
    await emit(provider, subscription.handle, 30, subscriptionReset)
    saved = true
    const key = await open(provider, `${provider}:api-key`, 'b2'.repeat(16))
    key.handle.simulateProviderUsage([{ window: 'seven_day', usedPercent: 3, resetsAt: keyReset }])
    await vi.waitFor(() =>
      expect(host.providerUsage()[provider]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            connectionId: `${provider}:api-key`,
            usedPercent: 3,
            resetsAt: keyReset,
          }),
        ]),
      ),
    )
    subscription.handle.simulateProviderUsage([
      { window: 'seven_day', usedPercent: 12, resetsAt: null },
    ])
    await vi.waitFor(() =>
      expect(host.providerUsage()[provider]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            connectionId: `${provider}:sign-in`,
            usedPercent: 12,
            resetsAt: subscriptionReset,
          }),
          expect.objectContaining({
            connectionId: `${provider}:api-key`,
            usedPercent: 3,
            resetsAt: keyReset,
          }),
        ]),
      ),
    )
    expect(host.providerUsage()[provider]).toHaveLength(2)
  })

  it(`${provider}: SQLite retains two routes, a legacy unknown reading and an opaque unknown ID independently`, () => {
    const kept = usageKeptIn(db)
    const before = kept.read()
    const readings = [
      {
        window: 'seven_day',
        usedPercent: 30,
        resetsAt: null,
        at: clock,
        connectionId: `${provider}:sign-in`,
      },
      {
        window: 'seven_day',
        usedPercent: 3,
        resetsAt: null,
        at: clock,
        connectionId: `${provider}:api-key`,
      },
      { window: 'seven_day', usedPercent: 9, resetsAt: null, at: clock },
      { window: 'seven_day', usedPercent: 7, resetsAt: null, at: clock, connectionId: 'unknown' },
    ]
    kept.write({ ...before, readings: { ...before.readings, [provider]: readings } })
    expect(usageKeptIn(db).read().readings[provider]).toEqual(readings)
  })
}

for (const provider of ['claude', 'codex'] as const) {
  for (const [method, change, retained] of [
    ['sign-in', 'key', true],
    ['api-key', 'key', false],
    ['api-key', 'sign-in', true],
    ['sign-in', 'sign-in', false],
    ['sign-in', 'remove-key', true],
    ['api-key', 'remove-key', false],
  ] as const) {
    it(`${provider}: a ${change} change ${retained ? 'preserves' : 'retires'} the selected ${method} readings`, async () => {
      const keys = new ApiKeys(directory, () => clock)
      if (method === 'api-key' || change === 'remove-key') {
        await expect(keys.set(provider, 'fictional-existing-key')).resolves.toBeNull()
        saved = true
      }
      await host.closeAll()
      host = hostOn(keys)
      const selected = await open(provider, `${provider}:${method}`)
      const reset = clock + 3_600_000
      await emit(provider, selected.handle, 30, reset)
      if (change === 'key') {
        const changed = await host.setApiKey(provider, 'fictional-replacement-key')
        expect(changed).toMatchObject({ set: true, inUse: true })
        expect(changed).not.toHaveProperty('refused')
        saved = true
      } else if (change === 'remove-key') {
        const changed = await host.removeApiKey(provider)
        expect(changed).toMatchObject({ set: false, inUse: false })
        expect(changed).not.toHaveProperty('refused')
        saved = false
      } else {
        host.providerSetupCompleted(provider, 'signIn')
      }
      if (!retained) {
        expect(host.providerUsage()[provider]).toEqual([])
        selected.handle.simulateProviderUsage([
          { window: 'fictional-after-change', usedPercent: 99, resetsAt: clock + 7_200_000 },
        ])
        await vi.waitFor(() =>
          expect(
            host
              .usageWindowsSeen()
              [provider].some((row) => row.window === 'fictional-after-change'),
          ).toBe(true),
        )
        expect(host.providerUsage()[provider]).toEqual([])
        return
      }
      expect(host.providerUsage()[provider]).toEqual([
        expect.objectContaining({
          connectionId: `${provider}:${method}`,
          usedPercent: 30,
          resetsAt: reset,
        }),
      ])
      selected.handle.simulateProviderUsage([
        { window: 'seven_day', usedPercent: 12, resetsAt: null },
      ])
      await vi.waitFor(() =>
        expect(host.providerUsage()[provider]).toEqual([
          expect.objectContaining({
            connectionId: `${provider}:${method}`,
            usedPercent: 12,
            resetsAt: reset,
          }),
        ]),
      )
    })
  }
}

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: restart confirmation and account replacement affect only the reporting connection`, async () => {
    const firstReset = clock + 3_600_000
    const secondReset = clock + 7_200_000
    const subscription = await open(provider, `${provider}:sign-in`)
    await emit(provider, subscription.handle, 30, firstReset)
    saved = true
    const key = await open(provider, `${provider}:api-key`, 'b2'.repeat(16))
    key.handle.simulateProviderUsage([
      { window: 'five_hour', usedPercent: 3, resetsAt: secondReset },
    ])
    await vi.waitFor(() =>
      expect(host.providerUsage()[provider]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            connectionId: `${provider}:api-key`,
            window: 'five_hour',
            usedPercent: 3,
          }),
        ]),
      ),
    )
    await host.closeAll()
    clock += 1_000
    host = hostOn()
    expect(host.providerUsage()[provider]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          connectionId: `${provider}:sign-in`,
          usedPercent: 30,
          unconfirmed: true,
        }),
        expect.objectContaining({
          connectionId: `${provider}:api-key`,
          usedPercent: 3,
          unconfirmed: true,
        }),
      ]),
    )
    expect(host.providerUsage()[provider]).toHaveLength(2)
    const confirmed = await open(provider, `${provider}:sign-in`)
    confirmed.handle.simulateProviderUsage([
      { window: 'seven_day', usedPercent: 12, resetsAt: null },
    ])
    await vi.waitFor(() => {
      const readings = host.providerUsage()[provider]
      const own = readings.find((row) => row.connectionId === `${provider}:sign-in`)!
      expect(own).toMatchObject({ usedPercent: 12, resetsAt: firstReset })
      expect(own.unconfirmed).not.toBe(true)
      expect(readings.find((row) => row.connectionId === `${provider}:api-key`)).toMatchObject({
        window: 'five_hour',
        usedPercent: 3,
        resetsAt: secondReset,
        unconfirmed: true,
      })
      expect(readings).toHaveLength(2)
    })
    const replacement = await open(provider, `${provider}:api-key`, 'c3'.repeat(16))
    replacement.handle.simulateProviderUsage([
      { window: 'seven_day', usedPercent: 9, resetsAt: null },
    ])
    await vi.waitFor(() => {
      const readings = host.providerUsage()[provider]
      expect(readings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            connectionId: `${provider}:sign-in`,
            usedPercent: 12,
            resetsAt: firstReset,
          }),
          expect.objectContaining({
            connectionId: `${provider}:api-key`,
            window: 'seven_day',
            usedPercent: 9,
            resetsAt: null,
          }),
        ]),
      )
      expect(
        readings.find((row) => row.connectionId === `${provider}:api-key`)?.unconfirmed,
      ).not.toBe(true)
      expect(readings.some((row) => row.window === 'five_hour')).toBe(false)
      expect(readings).toHaveLength(2)
    })
  })

  it(`${provider}: a retained legacy unknown reading is not relabelled or confirmed by a recorded connection`, async () => {
    await host.closeAll()
    const kept = usageKeptIn(db)
    const before = kept.read()
    kept.write({
      ...before,
      readings: {
        ...before.readings,
        [provider]: [
          { window: 'seven_day', usedPercent: 9, resetsAt: clock + 3_600_000, at: clock },
        ],
      },
    })
    host = hostOn()
    expect(host.providerUsage()[provider]).toEqual([
      expect.objectContaining({ usedPercent: 9, unconfirmed: true }),
    ])
    expect(host.providerUsage()[provider][0]).not.toHaveProperty('connectionId')
    const selected = await open(provider, `${provider}:sign-in`)
    selected.handle.simulateProviderUsage([
      { window: 'seven_day', usedPercent: 12, resetsAt: null },
    ])
    await vi.waitFor(() => {
      const readings = host.providerUsage()[provider]
      const legacy = readings.find((row) => row.connectionId === undefined)!
      expect(legacy).toMatchObject({
        usedPercent: 9,
        resetsAt: clock + 3_600_000,
        unconfirmed: true,
      })
      expect(legacy).not.toHaveProperty('connectionId')
      const own = readings.find((row) => row.connectionId === `${provider}:sign-in`)!
      expect(own).toMatchObject({ usedPercent: 12, resetsAt: null })
      expect(own.unconfirmed).not.toBe(true)
      expect(readings).toHaveLength(2)
    })
  })
}

for (const provider of ['claude', 'codex'] as const) {
  for (const [changedMethod, keptMethod] of [
    ['sign-in', 'api-key'],
    ['api-key', 'sign-in'],
  ] as const) {
    it(`${provider}: an external ${changedMethod} change cannot freeze or clear the running ${keptMethod} readings`, async () => {
      saved = true
      const kept = await open(provider, `${provider}:${keptMethod}`, 'b2'.repeat(16))
      const reset = clock + 3_600_000
      await emit(provider, kept.handle, 30, reset)
      clock += 1_000
      const changed = await open(provider, `${provider}:${changedMethod}`, 'a1'.repeat(16))
      const check = vi.fn(async () => true)
      Object.assign(changed.handle, { checkSignIn: check })
      await expect(
        host.send(
          changed.created.sessionId,
          'Fictional observe the credential change.',
          THE_APP_ITSELF,
        ),
      ).rejects.toThrow(/sign-in|login/i)
      expect(check).toHaveBeenCalled()
      expect(
        host
          .providerUsage()
          [provider].find((row) => row.connectionId === `${provider}:${keptMethod}`),
      ).toMatchObject({ usedPercent: 30, resetsAt: reset })
      kept.handle.simulateProviderUsage([
        { window: 'seven_day', usedPercent: 12, resetsAt: null },
        { window: 'fictional-after-external-change', usedPercent: 1, resetsAt: null },
      ])
      await vi.waitFor(() =>
        expect(
          host
            .usageWindowsSeen()
            [provider].some((row) => row.window === 'fictional-after-external-change'),
        ).toBe(true),
      )
      const reading = host
        .providerUsage()
        [provider].find((row) => row.connectionId === `${provider}:${keptMethod}`)!
      expect(reading).toMatchObject({ usedPercent: 12, resetsAt: reset })
      expect(reading.unconfirmed).not.toBe(true)
      expect(createSessionStore(db).connectionOf(kept.created.sessionId)).toBe(
        `${provider}:${keptMethod}`,
      )
      expect(handles).toHaveLength(2)
    })
  }
}

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: an API change retires later old siblings on that route while a fresh life can report`, async () => {
    saved = true
    const native = await open(provider, `${provider}:sign-in`, 'b2'.repeat(16))
    const nativeReset = clock + 3_600_000
    await emit(provider, native.handle, 30, nativeReset)
    clock += 1_000
    const reporter = await open(provider, `${provider}:api-key`, 'a1'.repeat(16))
    clock += 1_000
    const peer = await open(provider, `${provider}:api-key`, 'a1'.repeat(16))
    peer.handle.simulateProviderUsage([
      { window: 'seven_day', usedPercent: 55, resetsAt: clock + 7_200_000 },
    ])
    await vi.waitFor(() =>
      expect(
        host.providerUsage()[provider].find((row) => row.connectionId === `${provider}:api-key`)
          ?.usedPercent,
      ).toBe(55),
    )
    const check = vi.fn(async () => true)
    const peerCheck = vi.fn(async () => false)
    Object.assign(reporter.handle, { checkSignIn: check })
    Object.assign(peer.handle, { checkSignIn: peerCheck })
    await expect(
      host.send(
        reporter.created.sessionId,
        'Fictional observe the changed API credential.',
        THE_APP_ITSELF,
      ),
    ).rejects.toThrow(/sign-in|login/i)
    expect(check).toHaveBeenCalled()
    expect(peerCheck).not.toHaveBeenCalled()
    expect(
      host.providerUsage()[provider].filter((row) => row.connectionId === `${provider}:api-key`),
    ).toEqual([])
    peer.handle.simulateProviderUsage([
      { window: 'fictional-retired-api-peer', usedPercent: 99, resetsAt: null },
    ])
    await vi.waitFor(() =>
      expect(
        host
          .usageWindowsSeen()
          [provider].some((row) => row.window === 'fictional-retired-api-peer'),
      ).toBe(true),
    )
    expect(
      host.providerUsage()[provider].filter((row) => row.connectionId === `${provider}:api-key`),
    ).toEqual([])
    native.handle.simulateProviderUsage([{ window: 'seven_day', usedPercent: 12, resetsAt: null }])
    await vi.waitFor(() =>
      expect(
        host.providerUsage()[provider].find((row) => row.connectionId === `${provider}:sign-in`),
      ).toMatchObject({ usedPercent: 12, resetsAt: nativeReset }),
    )
    clock += 1_000
    const fresh = await open(provider, `${provider}:api-key`, 'c3'.repeat(16))
    fresh.handle.simulateProviderUsage([
      { window: 'seven_day', usedPercent: 8, resetsAt: clock + 7_200_000 },
    ])
    await vi.waitFor(() =>
      expect(
        host.providerUsage()[provider].find((row) => row.connectionId === `${provider}:api-key`),
      ).toMatchObject({ window: 'seven_day', usedPercent: 8 }),
    )
    peer.handle.simulateProviderUsage([
      { window: 'fictional-retired-api-peer-again', usedPercent: 99, resetsAt: null },
    ])
    await vi.waitFor(() =>
      expect(
        host
          .usageWindowsSeen()
          [provider].some((row) => row.window === 'fictional-retired-api-peer-again'),
      ).toBe(true),
    )
    const api = host
      .providerUsage()
      [provider].filter((row) => row.connectionId === `${provider}:api-key`)
    expect(api).toHaveLength(1)
    expect(api[0]).toMatchObject({ window: 'seven_day', usedPercent: 8 })
    expect(api[0]?.unconfirmed).not.toBe(true)
    expect(
      host.providerUsage()[provider].find((row) => row.connectionId === `${provider}:sign-in`),
    ).toMatchObject({ usedPercent: 12, resetsAt: nativeReset })
    expect(handles).toHaveLength(4)
  })
}

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: a native-login poll asks its native life instead of an older API life`, async () => {
    await host.closeAll()
    host = hostOn(undefined, 50)
    saved = true
    const api = await open(provider, `${provider}:api-key`)
    const reset = clock + 3_600_000
    await emit(provider, api.handle, 30, reset)
    clock += 1_000
    const native = await open(provider, `${provider}:sign-in`, 'b2'.repeat(16))
    const apiCheck = vi.fn(async () => false)
    const nativeCheck = vi.fn(async () => false)
    Object.assign(api.handle, { checkSignIn: apiCheck })
    Object.assign(native.handle, { checkSignIn: nativeCheck })
    const store = createSessionStore(db)
    const wall = `fictional-${provider}-native-poll-wall`
    store.create({ id: wall, provider, cwd: directory, approvalMode: 'ask', profileId: 'fern' })
    store.append(
      wall,
      0,
      {
        type: 'error',
        message: `${provider} is rate-limited (rate_limit_reached) — the turn may stall until it resets; resets ${new Date(reset).toISOString()}`,
        fatal: false,
      },
      clock,
    )
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      expect(
        (
          await host.queueMessage(
            native.created.sessionId,
            'Fictional work waiting for a native limit.',
            THE_APP_ITSELF,
          )
        ).outcome,
      ).toBe('queued')
      const before = nativeCheck.mock.calls.length
      expect(apiCheck).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(50)
      expect(nativeCheck.mock.calls.length).toBeGreaterThan(before)
      expect(apiCheck).not.toHaveBeenCalled()
      expect(
        host.providerUsage()[provider].find((row) => row.connectionId === `${provider}:api-key`),
      ).toMatchObject({ usedPercent: 30, resetsAt: reset })
      api.handle.simulateProviderUsage([
        { window: 'seven_day', usedPercent: 12, resetsAt: null },
        { window: 'fictional-native-poll-api-updated', usedPercent: 1, resetsAt: null },
      ])
      await vi.waitFor(() =>
        expect(
          host
            .usageWindowsSeen()
            [provider].some((row) => row.window === 'fictional-native-poll-api-updated'),
        ).toBe(true),
      )
      expect(
        host.providerUsage()[provider].find((row) => row.connectionId === `${provider}:api-key`),
      ).toMatchObject({ usedPercent: 12, resetsAt: reset })
      expect(handles).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })
}
