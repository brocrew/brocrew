import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeRuntime, reprovisionCodexAuth } from '@brobot2/runtime'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { DEFAULT_PROFILE_ID, type RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { createSessionStore } from '../src/main/db/session-store'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import {
  deriveProviderHome,
  listProfileIds,
  type ProviderAuthOps,
} from '../src/main/runtime/provider-homes'

const messages: RuntimeEventMessage[] = []
const sink: RuntimeEventSink = {
  ownerId: 'test',
  aPersonIsBehindIt: true,
  alive: true,
  send(message) {
    messages.push(message)
  },
  sendLiveness() {},
}

describe('copying this install’s provider sign-ins', () => {
  let root: string
  let db: AppDatabase
  let launches: number
  let oldProcessExit: Promise<void> | undefined
  let stopped: number
  let resumeFails: boolean
  let beforeStart: (() => Promise<void>) | undefined
  let beforeResume: (() => Promise<void>) | undefined
  let host: RuntimeHost
  let ops: ProviderAuthOps
  const copy = vi.fn()
  const keyRead = vi.fn()
  let keySaved: boolean
  let keyStatusFails: boolean
  const home = (id: string) => deriveProviderHome(root, { provider: 'codex', profileId: id })
  const run = () =>
    executeRuntimeCommand(host, sink, { kind: 'reprovisionProviderHomes', provider: 'codex' })

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'brocrew-recopy-'))
    db = openDatabase(join(root, 'test.sqlite'))
    applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
    launches = 0
    oldProcessExit = undefined
    stopped = 0
    resumeFails = false
    beforeStart = undefined
    beforeResume = undefined
    messages.length = 0
    keySaved = false
    keyStatusFails = false
    copy.mockReset()
    keyRead.mockReset()
    const source = join(root, 'machine-sign-in.json')
    writeFileSync(source, '{"madeUpSignIn":"new-fictional-sign-in"}')
    for (const id of [DEFAULT_PROFILE_ID, 'alpha', 'beta']) {
      mkdirSync(home(id), { recursive: true })
      writeFileSync(join(home(id), 'auth.json'), '{"madeUpSignIn":"old"}')
    }
    mkdirSync(deriveProviderHome(root, { provider: 'claude', profileId: 'other-provider' }), {
      recursive: true,
    })
    copy.mockImplementation((_provider: string, id: string) =>
      reprovisionCodexAuth(home(id), { sourceAuthPath: source }),
    )
    ops = {
      credentialHome: (_provider, id) => home(id),
      reprovision: copy,
      check: async () => ({ state: 'unknown', reason: 'not probed' }),
      signIn: async () => {
        throw new Error('not used')
      },
      bringTheKeyToItsHomes: async () => null,
      replaceARefusedCopy: async () => 'not-tried',
    }
    let counter = 0
    const runtime = new FakeRuntime('codex')
    host = new RuntimeHost({
      store: createSessionStore(db),
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(root, 'exports'),
      createRuntime: () => ({
        provider: 'codex',
        listModels: runtime.listModels.bind(runtime),
        start: async (options) => {
          await beforeStart?.()
          const handle = await runtime.start(options)
          handle.awaitProcessExit = () => oldProcessExit
          const close = handle.close.bind(handle)
          handle.close = async () => {
            stopped++
            await close()
          }
          launches++
          return handle
        },
        resume: async (ref, options) => {
          await beforeResume?.()
          if (resumeFails) throw new Error('fictional restart failure')
          const handle = await runtime.resume(ref, options)
          launches++
          return handle
        },
      }),
      prepareProviderHome: (_provider, id) => home(id),
      providerHomePath: (_provider, id) => home(id),
      resolveCwd: () => root,
      newSessionId: () => `session_${++counter}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: provider === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR',
        model: 'fake',
        authNote: null,
        files: [],
      }),
      listProfiles: (provider) => listProfileIds(root, provider),
      providerAuth: ops,
      apiKeys: {
        status: () => {
          if (keyStatusFails) throw new Error('status unavailable')
          return { set: keySaved }
        },
        read: keyRead,
        remove: vi.fn(),
        set: vi.fn(),
      } as never,
    })
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('replaces every existing home through the locked copy, without probing or reading a key', async () => {
    const before = statSync(join(home('alpha'), 'auth.json')).ino
    expect(await run()).toMatchObject({ replaced: 3, skipped: 0, failed: 0 })
    expect(copy.mock.calls.map((call) => call[1])).toEqual([DEFAULT_PROFILE_ID, 'alpha', 'beta'])
    expect(statSync(join(home('alpha'), 'auth.json')).ino).not.toBe(before)
    expect(keyRead).not.toHaveBeenCalled()
    expect(await run()).toMatchObject({ replaced: 0, skipped: 3, failed: 0 })
  })

  it('skips saved API keys without reading their contents or touching the homes', async () => {
    keySaved = true
    expect(await run()).toMatchObject({
      replaced: 0,
      skipped: 3,
      failed: 0,
      profiles: expect.arrayContaining([
        { profileId: 'alpha', state: 'skipped', reason: 'api-key' },
      ]),
    })
    expect(copy).not.toHaveBeenCalled()
    expect(keyRead).not.toHaveBeenCalled()
  })

  it('keeps a running task intact, then switches and restarts it automatically at idle', async () => {
    const created = await host.createSession(
      { provider: 'codex', profileId: 'alpha', cwd: root },
      sink,
    )
    await host.send(created.sessionId, 'hello', sink)
    await vi.waitFor(() =>
      expect(messages.some((one) => one.event.type === 'permission_request')).toBe(true),
    )
    const before = statSync(join(home('alpha'), 'auth.json')).ino
    expect(await run()).toMatchObject({
      replaced: 2,
      pending: 1,
      skipped: 0,
      failed: 0,
      profiles: expect.arrayContaining([{ profileId: 'alpha', state: 'pending' }]),
    })
    expect(host.sessionIds).toContain(created.sessionId)
    expect(messages.some((one) => one.event.type === 'turn')).toBe(false)
    expect(statSync(join(home('alpha'), 'auth.json')).ino).toBe(before)
    await host.respondPermission(created.sessionId, 'turn_1_perm', { outcome: 'allow' }, sink)
    await vi.waitFor(async () =>
      expect(await host.reprovisionProviderHomes('codex', true)).toMatchObject({
        replaced: 3,
        pending: 0,
        failed: 0,
      }),
    )
    await vi.waitFor(() => {
      expect(launches).toBe(2)
      expect(host.sessionIds).toContain(created.sessionId)
    })
    expect(
      messages.filter((one) => one.event.type === 'turn').map((one) => one.event),
    ).toContainEqual(expect.objectContaining({ state: 'completed' }))
    expect(statSync(join(home('alpha'), 'auth.json')).ino).not.toBe(before)
  })

  it('switches an idle open conversation now and reopens it automatically', async () => {
    const created = await host.createSession(
      { provider: 'codex', profileId: 'alpha', cwd: root },
      sink,
    )
    await vi.waitFor(() =>
      expect(
        messages.some((one) => one.event.type === 'status' && one.event.state === 'idle'),
      ).toBe(true),
    )
    expect(await run()).toMatchObject({ replaced: 3, pending: 0, failed: 0 })
    await vi.waitFor(() => {
      expect(launches).toBe(2)
      expect(host.sessionIds).toContain(created.sessionId)
    })
  })

  it('waits for every busy conversation sharing a home before switching', async () => {
    const one = await host.createSession({ provider: 'codex', profileId: 'alpha', cwd: root }, sink)
    const two = await host.createSession({ provider: 'codex', profileId: 'alpha', cwd: root }, sink)
    await host.send(one.sessionId, 'one', sink)
    await host.send(two.sessionId, 'two', sink)
    await vi.waitFor(() =>
      expect(messages.filter((one) => one.event.type === 'permission_request')).toHaveLength(2),
    )
    expect(await run()).toMatchObject({ replaced: 2, pending: 1 })
    await host.respondPermission(one.sessionId, 'turn_1_perm', { outcome: 'allow' }, sink)
    await vi.waitFor(() =>
      expect(
        messages.some(
          (message) => message.sessionId === one.sessionId && message.event.type === 'turn',
        ),
      ).toBe(true),
    )
    expect(copy.mock.calls.some((call) => call[1] === 'alpha')).toBe(false)
    await host.respondPermission(two.sessionId, 'turn_1_perm', { outcome: 'allow' }, sink)
    await vi.waitFor(async () =>
      expect(await host.reprovisionProviderHomes('codex', true)).toMatchObject({
        replaced: 3,
        pending: 0,
      }),
    )
    await vi.waitFor(() => {
      expect(launches).toBe(4)
      expect(host.sessionIds).toHaveLength(2)
    })
  })

  it('does not copy while a stopped app-server can still write its old sign-in', async () => {
    let confirmExit!: () => void
    oldProcessExit = new Promise((resolve) => {
      confirmExit = resolve
    })
    await host.createSession({ provider: 'codex', profileId: 'alpha', cwd: root }, sink)
    await vi.waitFor(() =>
      expect(
        messages.some((one) => one.event.type === 'status' && one.event.state === 'idle'),
      ).toBe(true),
    )
    const copying = run()
    await vi.waitFor(() => expect(stopped).toBe(1))
    expect(copy.mock.calls.some((call) => call[1] === 'alpha')).toBe(false)
    // A final write from the old process is replaced only after exit is confirmed.
    writeFileSync(join(home('alpha'), 'auth.json'), '{"madeUpSignIn":"late-old-refresh"}')
    confirmExit()
    expect(await copying).toMatchObject({ replaced: 3, pending: 0, failed: 0 })
    await vi.waitFor(() => {
      expect(launches).toBe(2)
      expect(host.sessionIds).toHaveLength(1)
    })
  })

  it('reports a failed automatic restart as a failure instead of a completed switch', async () => {
    await host.createSession({ provider: 'codex', profileId: 'alpha', cwd: root }, sink)
    await vi.waitFor(() =>
      expect(
        messages.some((one) => one.event.type === 'status' && one.event.state === 'idle'),
      ).toBe(true),
    )
    resumeFails = true
    expect(await run()).toMatchObject({
      replaced: 2,
      pending: 0,
      failed: 1,
      profiles: expect.arrayContaining([
        { profileId: 'alpha', state: 'failed', reason: 'restart-failed' },
      ]),
    })
  })

  it('keeps a former slot’s unconfirmed process ahead of the copy', async () => {
    let confirm!: () => void
    oldProcessExit = new Promise((resolve) => {
      confirm = resolve
    })
    const former = await host.createSession(
      { provider: 'codex', profileId: 'alpha', cwd: root },
      sink,
    )
    await host.close(former.sessionId, sink)
    oldProcessExit = undefined
    const current = await host.createSession(
      { provider: 'codex', profileId: 'alpha', cwd: root },
      sink,
    )
    await host.send(current.sessionId, 'current task', sink)
    await vi.waitFor(() =>
      expect(
        messages.some(
          (one) => one.sessionId === current.sessionId && one.event.type === 'permission_request',
        ),
      ).toBe(true),
    )
    expect(await run()).toMatchObject({ replaced: 2, pending: 1 })
    await host.respondPermission(current.sessionId, 'turn_1_perm', { outcome: 'allow' }, sink)
    await vi.waitFor(() =>
      expect(
        messages.some((one) => one.sessionId === current.sessionId && one.event.type === 'turn'),
      ).toBe(true),
    )
    expect(copy.mock.calls.some((call) => call[1] === 'alpha')).toBe(false)
    confirm()
    await vi.waitFor(async () =>
      expect(await host.reprovisionProviderHomes('codex', true)).toMatchObject({
        replaced: 3,
        pending: 0,
      }),
    )
  })

  it('holds a new launch behind a busy home’s pending switch without blocking the switch itself', async () => {
    const current = await host.createSession(
      { provider: 'codex', profileId: 'alpha', cwd: root },
      sink,
    )
    await host.send(current.sessionId, 'current task', sink)
    await vi.waitFor(() =>
      expect(messages.some((one) => one.event.type === 'permission_request')).toBe(true),
    )
    expect(await run()).toMatchObject({ replaced: 2, pending: 1 })
    let opened = false
    const next = host
      .createSession({ provider: 'codex', profileId: 'alpha', cwd: root }, sink)
      .then((one) => {
        opened = true
        return one
      })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(opened).toBe(false)
    expect(launches).toBe(1)
    await host.respondPermission(current.sessionId, 'turn_1_perm', { outcome: 'allow' }, sink)
    expect((await next).sessionId).not.toBe(current.sessionId)
    await vi.waitFor(async () =>
      expect(await host.reprovisionProviderHomes('codex', true)).toMatchObject({
        replaced: 3,
        pending: 0,
      }),
    )
  })

  it('switches after leaving planning without sending a message', async () => {
    const current = await host.createSession(
      { provider: 'codex', profileId: 'alpha', cwd: root, planMode: true },
      sink,
    )
    expect(await run()).toMatchObject({ replaced: 2, pending: 1 })
    await host.endPlanMode(current.sessionId, sink)
    await vi.waitFor(async () =>
      expect(await host.reprovisionProviderHomes('codex', true)).toMatchObject({
        replaced: 3,
        pending: 0,
      }),
    )
  })

  it('switches after an in-flight start fails and gives up its home', async () => {
    let entered!: () => void
    let fail!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const blocked = new Promise<void>((_resolve, reject) => {
      fail = () => reject(new Error('fictional start failure'))
    })
    beforeStart = async () => {
      entered()
      await blocked
    }
    const opening = host
      .createSession({ provider: 'codex', profileId: 'alpha', cwd: root }, sink)
      .catch(() => null)
    await started
    expect(await run()).toMatchObject({ replaced: 2, pending: 1 })
    fail()
    expect(await opening).toBeNull()
    await vi.waitFor(async () =>
      expect(await host.reprovisionProviderHomes('codex', true)).toMatchObject({
        replaced: 3,
        pending: 0,
      }),
    )
  })

  it('does not declare a racing reopen complete while its provider start can still fail', async () => {
    const current = await host.createSession(
      { provider: 'codex', profileId: 'alpha', cwd: root },
      sink,
    )
    let releaseCopy!: () => void
    const heldCopy = new Promise<void>((resolve) => {
      releaseCopy = resolve
    })
    const realCopy = copy.getMockImplementation()!
    copy.mockImplementation(async (provider, id) => {
      if (id === 'alpha') await heldCopy
      return realCopy(provider, id)
    })
    let finished = false
    const copying = run().then((result) => {
      finished = true
      return result
    })
    await vi.waitFor(() => expect(copy.mock.calls.some((call) => call[1] === 'alpha')).toBe(true))
    let entered!: () => void
    let fail!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const heldStart = new Promise<void>((_resolve, reject) => {
      fail = () => reject(new Error('fictional racing resume failure'))
    })
    beforeResume = async () => {
      entered()
      await heldStart
    }
    const reopening = host.resumeSession(current.sessionId, sink).catch(() => null)
    releaseCopy()
    await started
    expect(finished).toBe(false)
    try {
      expect(await host.reprovisionProviderHomes('codex', true)).toMatchObject({
        profiles: expect.arrayContaining([{ profileId: 'alpha', state: 'pending' }]),
      })
    } finally {
      fail()
    }
    expect(await reopening).toBeNull()
    expect(await copying).toMatchObject({
      replaced: 2,
      pending: 0,
      failed: 1,
      profiles: expect.arrayContaining([
        { profileId: 'alpha', state: 'failed', reason: 'restart-failed' },
      ]),
    })
  })

  it('does not copy after process-exit confirmation fails', async () => {
    let rejectExit!: () => void
    oldProcessExit = new Promise((_resolve, reject) => {
      rejectExit = () => reject(new Error('fictional exit failure'))
    })
    const former = await host.createSession(
      { provider: 'codex', profileId: 'alpha', cwd: root },
      sink,
    )
    await host.close(former.sessionId, sink)
    rejectExit()
    expect(await run()).toMatchObject({
      replaced: 2,
      pending: 0,
      failed: 1,
      profiles: expect.arrayContaining([
        { profileId: 'alpha', state: 'failed', reason: 'stop-failed' },
      ]),
    })
    expect(copy.mock.calls.some((call) => call[1] === 'alpha')).toBe(false)
  })

  it('leaves homes alone when API-key status cannot be checked', async () => {
    keyStatusFails = true
    expect(await run()).toMatchObject({
      replaced: 0,
      skipped: 3,
      failed: 0,
      profiles: expect.arrayContaining([
        { profileId: 'alpha', state: 'skipped', reason: 'key-status-unavailable' },
      ]),
    })
    expect(copy).not.toHaveBeenCalled()
  })

  it('reports a failed home without exposing its error and continues to the next home', async () => {
    const realCopy = copy.getMockImplementation()!
    copy.mockImplementation((provider, id) => {
      if (id === 'alpha')
        throw new Error('fictional provider error that must stay out of the result')
      return realCopy(provider, id)
    })
    const result = await run()
    expect(result).toMatchObject({
      replaced: 2,
      skipped: 0,
      failed: 1,
      profiles: expect.arrayContaining([
        { profileId: 'alpha', state: 'failed', reason: 'copy-failed' },
      ]),
    })
    expect(JSON.stringify(result)).not.toContain('fictional provider error')
  })

  it('honors the existing host credential claim while another re-copy holds it', async () => {
    let release!: () => void
    copy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve('replaced')
        }),
    )
    const first = host.reprovisionProviderAuth('codex', DEFAULT_PROFILE_ID)
    expect(await run()).toMatchObject({ replaced: 2, failed: 1 })
    release()
    await first
    expect(await run()).toMatchObject({ failed: 0 })
  })
})
