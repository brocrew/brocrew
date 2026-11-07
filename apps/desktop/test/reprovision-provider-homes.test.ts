import { neutralHostDeps } from './lib/host-fixture'
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onProviderConnection } from '../src/main/providers/connection-runtime'
import { resolveProviderConnection } from '../src/main/db/provider-connections'
import { FakeRuntime, reprovisionCodexAuth } from '@brobot2/runtime'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { DEFAULT_PROFILE_ID, type RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { createSessionStore } from '../src/main/db/session-store'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
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
  let beforeReturn: (() => Promise<void>) | undefined
  let connectionRevision: number
  let pluginEnabled: boolean
  let pluginRevision: string
  let replacementCloseFails: boolean
  let activeCloseFails: boolean
  let host: RuntimeHost
  let closingHost: Promise<void> | undefined
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
    closingHost = undefined
    oldProcessExit = undefined
    stopped = 0
    resumeFails = false
    beforeStart = undefined
    beforeResume = undefined
    beforeReturn = undefined
    connectionRevision = 0
    pluginEnabled = false
    pluginRevision = 'a'
    replacementCloseFails = false
    activeCloseFails = false
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
      ...neutralHostDeps(() => root),
      connectionFor: (provider, connectionId) =>
        resolveProviderConnection(db, { provider, connectionId }).id,
      connectionRevision: () => connectionRevision,
      pluginAttachments: {
        agent: () => {
          if (!pluginEnabled) throw new Error('fictional plugins disabled')
          return {
            read: async () => ({
              revision: pluginRevision,
              servers: [
                {
                  name: 'plugin-fern',
                  url: 'http://127.0.0.1:8123/mcp',
                  capability: pluginRevision.repeat(64),
                },
              ],
            }),
            close: async () => {},
          }
        },
      },
      createRuntime: (provider, connectionId) =>
        onProviderConnection(
          provider,
          () => ({
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
                if (activeCloseFails) throw new Error('fictional active child close failed')
              }
              await beforeReturn?.()
              launches++
              return handle
            },
            resume: async (ref, options) => {
              await beforeResume?.()
              if (resumeFails) throw new Error('fictional restart failure')
              const handle = await runtime.resume(ref, options)
              if (replacementCloseFails) {
                const close = handle.close.bind(handle)
                handle.close = async () => {
                  await close()
                  throw new Error('fictional replacement close failed')
                }
              }
              handle.awaitProcessExit = () => oldProcessExit
              await beforeReturn?.()
              launches++
              return handle
            },
          }),
          (requested) => resolveProviderConnection(db, { provider, connectionId: requested }),
          connectionId,
          () => connectionRevision,
        ),
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
    await (closingHost ??= host.closeAll())
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  for (const opening of ['start', 'resume'] as const) {
    for (const change of ['changed-back', 'cancel', 'slow-then-cancel'] as const) {
      for (const proof of ['held', 'rejected'] as const) {
        it(`${opening} ${change} keeps a pending sign-in copy behind ${proof} process-exit proof`, async () => {
          const previous =
            opening === 'resume'
              ? await host.createSession({ provider: 'codex', profileId: 'alpha', cwd: root }, sink)
              : undefined
          if (previous) await host.close(previous.sessionId, sink)
          let entered!: () => void
          let release!: () => void
          let exited!: () => void
          let exitFailed!: (error: Error) => void
          const arrived = new Promise<void>((resolve) => {
            entered = resolve
          })
          const returning = new Promise<void>((resolve) => {
            release = resolve
          })
          oldProcessExit = new Promise<void>((resolve, reject) => {
            exited = resolve
            exitFailed = reject
          })
          void oldProcessExit.catch(() => {})
          beforeReturn = async () => {
            entered()
            await returning
          }
          if (change === 'slow-then-cancel')
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
          const launchKey = 'fictional-raced-launch'
          const openingResult = (
            previous
              ? host.resumeSession(previous.sessionId, sink, launchKey)
              : host.createSession(
                  { provider: 'codex', profileId: 'alpha', cwd: root, launchKey },
                  sink,
                )
          ).then(
            () => false,
            () => true,
          )
          try {
            await arrived
            expect(await run()).toMatchObject({ replaced: 2, pending: 1 })
            let cancelling =
              change === 'cancel' ? host.cancelLaunch(launchKey, sink.ownerId) : undefined
            if (change === 'changed-back') connectionRevision += 2
            if (change === 'slow-then-cancel') {
              let settled = false
              void openingResult.then(() => {
                settled = true
              })
              await vi.advanceTimersByTimeAsync(300_000)
              expect(settled).toBe(false)
              cancelling = host.cancelLaunch(launchKey, sink.ownerId)
              vi.useRealTimers()
            }
            release()
            expect(await openingResult).toBe(true)
            await cancelling
            await new Promise<void>((resolve) => setImmediate(resolve))
            expect(copy.mock.calls.map((call) => call[1])).not.toContain('alpha')
            expect(await host.reprovisionProviderHomes('codex', true)).toMatchObject({ pending: 1 })
            if (proof === 'held') {
              exited()
              await vi.waitFor(async () =>
                expect(await host.reprovisionProviderHomes('codex', true)).toMatchObject({
                  replaced: 3,
                  pending: 0,
                }),
              )
            } else {
              exitFailed(new Error('fictional process-exit proof failed'))
              await vi.waitFor(async () =>
                expect(await host.reprovisionProviderHomes('codex', true)).toMatchObject({
                  failed: 1,
                  pending: 0,
                }),
              )
              expect(copy.mock.calls.map((call) => call[1])).not.toContain('alpha')
              expect(await run()).toMatchObject({
                profiles: expect.arrayContaining([
                  { profileId: 'alpha', state: 'failed', reason: 'stop-failed' },
                ]),
              })
              expect(copy.mock.calls.map((call) => call[1])).not.toContain('alpha')
            }
          } finally {
            vi.useRealTimers()
            release()
            exited()
          }
        })
      }
    }
  }

  for (const proof of ['held', 'rejected'] as const) {
    it(`an internal plugin reopen retains ${proof} rejected-child exit proof before copying`, async () => {
      pluginEnabled = true
      oldProcessExit = Promise.resolve()
      const current = await host.createSession(
        { provider: 'codex', profileId: 'alpha', cwd: root },
        sink,
      )
      let entered!: () => void
      let release!: () => void
      let exited!: () => void
      let exitFailed!: (error: Error) => void
      const arrived = new Promise<void>((resolve) => {
        entered = resolve
      })
      const returning = new Promise<void>((resolve) => {
        release = resolve
      })
      oldProcessExit = new Promise<void>((resolve, reject) => {
        exited = resolve
        exitFailed = reject
      })
      void oldProcessExit.catch(() => {})
      beforeResume = async () => {
        entered()
        await returning
      }
      pluginRevision = 'b'
      const sending = host.send(current.sessionId, 'current task', sink)
      void sending.catch(() => {})
      try {
        await arrived
        connectionRevision += 2
        release()
        await sending
        await vi.waitFor(() =>
          expect(messages.some((one) => one.event.type === 'permission_request')).toBe(true),
        )
        expect(await run()).toMatchObject({ replaced: 2, pending: 1 })
        if (proof === 'rejected') vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        await host.respondPermission(current.sessionId, 'turn_1_perm', { outcome: 'allow' }, sink)
        await vi.waitFor(() => expect(stopped).toBeGreaterThan(0))
        await new Promise<void>((resolve) => setImmediate(resolve))
        expect(copy.mock.calls.map((call) => call[1])).not.toContain('alpha')
        expect(await host.reprovisionProviderHomes('codex', true)).toMatchObject({ pending: 1 })
        if (proof === 'held') {
          exited()
          await vi.waitFor(async () =>
            expect(await host.reprovisionProviderHomes('codex', true)).toMatchObject({
              replaced: 3,
              pending: 0,
            }),
          )
        } else {
          exitFailed(new Error('fictional replacement process-exit proof failed'))
          await new Promise<void>((resolve) => setImmediate(resolve))
          expect(await run()).toMatchObject({ pending: 1 })
          expect(copy.mock.calls.map((call) => call[1])).not.toContain('alpha')
        }
      } finally {
        release()
        exited()
        if (proof === 'rejected') {
          if (!vi.isFakeTimers()) vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
          closingHost = host.closeAll()
          await vi.advanceTimersByTimeAsync(10_001)
          await closingHost
          vi.useRealTimers()
        }
      }
    })
  }

  it('a refused plugin replacement with no exit witness and a failed close cannot permit copying', async () => {
    pluginEnabled = true
    const current = await host.createSession(
      { provider: 'codex', profileId: 'alpha', cwd: root },
      sink,
    )
    let entered!: () => void
    let release!: () => void
    const arrived = new Promise<void>((resolve) => {
      entered = resolve
    })
    const returning = new Promise<void>((resolve) => {
      release = resolve
    })
    beforeResume = async () => {
      entered()
      await returning
    }
    replacementCloseFails = true
    pluginRevision = 'b'
    const sending = host.send(current.sessionId, 'current task', sink)
    void sending.catch(() => {})
    try {
      await arrived
      connectionRevision += 2
      release()
      await sending
      await vi.waitFor(() =>
        expect(messages.some((one) => one.event.type === 'permission_request')).toBe(true),
      )
      expect(await run()).toMatchObject({ replaced: 2, pending: 1 })
      await host.respondPermission(current.sessionId, 'turn_1_perm', { outcome: 'allow' }, sink)
      await vi.waitFor(() => expect(stopped).toBeGreaterThan(0))
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(copy.mock.calls.map((call) => call[1])).not.toContain('alpha')
      await vi.waitFor(async () =>
        expect(await host.reprovisionProviderHomes('codex', true)).toMatchObject({
          failed: 1,
          pending: 0,
        }),
      )
      expect(await run()).toMatchObject({
        profiles: expect.arrayContaining([
          { profileId: 'alpha', state: 'failed', reason: 'stop-failed' },
        ]),
      })
      expect(copy.mock.calls.map((call) => call[1])).not.toContain('alpha')
    } finally {
      release()
    }
  })

  it('a managed active child with no exit witness and a failed close cannot permit copying', async () => {
    pluginEnabled = true
    await host.createSession({ provider: 'codex', profileId: 'alpha', cwd: root }, sink)
    activeCloseFails = true
    expect(await run()).toMatchObject({ replaced: 2, failed: 1, pending: 0 })
    expect(copy.mock.calls.map((call) => call[1])).not.toContain('alpha')
    expect(await run()).toMatchObject({
      profiles: expect.arrayContaining([
        { profileId: 'alpha', state: 'failed', reason: 'stop-failed' },
      ]),
    })
    expect(copy.mock.calls.map((call) => call[1])).not.toContain('alpha')
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

  it.each([true, false])(
    'switches and reopens an idle conversation with a live window: %s',
    async (alive) => {
      let windowAlive = true
      const created = await host.createSession(
        { provider: 'codex', profileId: 'alpha', cwd: root },
        {
          ...sink,
          get alive() {
            return windowAlive
          },
        },
      )
      await vi.waitFor(() =>
        expect(
          messages.some((one) => one.event.type === 'status' && one.event.state === 'idle'),
        ).toBe(true),
      )
      windowAlive = alive
      expect(await run()).toMatchObject({ replaced: 3, pending: 0, failed: 0 })
      await vi.waitFor(() => {
        expect(launches).toBe(2)
        expect(host.sessionIds).toContain(created.sessionId)
      })
    },
  )

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

  it('does not copy or restart when an exit proof fails during the batch close', async () => {
    let rejectExit!: () => void
    oldProcessExit = new Promise((_resolve, reject) => {
      rejectExit = () => reject(new Error('fictional exit failure during batch close'))
    })
    await host.createSession({ provider: 'codex', profileId: 'alpha', cwd: root }, sink)
    const copying = run()
    await vi.waitFor(() => expect(stopped).toBe(1))
    rejectExit()
    const outcome = await copying
    expect.soft(launches).toBe(1)
    expect(outcome).toMatchObject({
      replaced: 2,
      pending: 0,
      failed: 1,
      profiles: expect.arrayContaining([
        { profileId: 'alpha', state: 'failed', reason: 'stop-failed' },
      ]),
    })
    expect(copy.mock.calls.some((call) => call[1] === 'alpha')).toBe(false)
  })

  it('keeps the batch identity while a failed copy is still restarting its last home', async () => {
    await host.createSession({ provider: 'codex', profileId: 'beta', cwd: root }, sink)
    let entered!: () => void
    let release!: () => void
    const restarting = new Promise<void>((resolve) => {
      entered = resolve
    })
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    beforeResume = async () => {
      entered()
      await held
    }
    const realCopy = copy.getMockImplementation()!
    copy.mockImplementation((provider, id) => {
      if (id === 'beta') throw new Error('fictional last-home copy failure')
      return realCopy(provider, id)
    })
    const first = run()
    await restarting
    try {
      expect(await host.reprovisionProviderHomes('codex', true)).toMatchObject({
        pending: 1,
        failed: 0,
      })
      expect(await run()).toMatchObject({ pending: 1, failed: 0 })
      expect(copy).toHaveBeenCalledTimes(3)
    } finally {
      release()
    }
    expect(await first).toMatchObject({ replaced: 2, pending: 0, failed: 1 })
    expect(await host.reprovisionProviderHomes('codex', true)).toMatchObject({
      pending: 0,
      failed: 1,
    })
    expect(copy).toHaveBeenCalledTimes(3)
  })

  it('admits an auth probe atomically before a competing copy can claim the home', async () => {
    let entered!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    ops.check = vi.fn(async () => {
      entered()
      await held
      return { state: 'unknown' as const, reason: 'fictional probe' }
    })
    const checking = host.checkProviderAuth('codex', DEFAULT_PROFILE_ID)
    const copying = run()
    await started
    try {
      expect(await copying).toMatchObject({ replaced: 2, pending: 1 })
      expect(copy.mock.calls.some((call) => call[1] === DEFAULT_PROFILE_ID)).toBe(false)
    } finally {
      release()
    }
    await checking
    await vi.waitFor(async () =>
      expect(await host.reprovisionProviderHomes('codex', true)).toMatchObject({
        replaced: 3,
        pending: 0,
      }),
    )
  })

  it('does not start an auth probe while a competing copy owns the home', async () => {
    let entered!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const realCopy = copy.getMockImplementation()!
    copy.mockImplementation(async (provider, id) => {
      if (id === DEFAULT_PROFILE_ID) {
        entered()
        await held
      }
      return realCopy(provider, id)
    })
    ops.check = vi.fn(async () => ({ state: 'unknown' as const, reason: 'fictional probe' }))
    const copying = run()
    const checking = host.checkProviderAuth('codex', DEFAULT_PROFILE_ID)
    await started
    try {
      expect(ops.check).not.toHaveBeenCalled()
    } finally {
      release()
    }
    expect(await copying).toMatchObject({ replaced: 3, pending: 0 })
    await checking
    expect(ops.check).toHaveBeenCalledTimes(1)
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
