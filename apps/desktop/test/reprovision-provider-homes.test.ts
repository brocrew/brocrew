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
          const handle = await runtime.start(options)
          launches++
          return handle
        },
        resume: async (ref, options) => {
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
