import type { IpcMain } from 'electron'
import { registerProviderSetup } from '../src/main/provider-setup/ipc'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FakeRuntime,
  type ProviderRuntimeContext,
  type ModelChoice,
  type AuthState,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { NULL_SESSION_STORE } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { CLAUDE_SETUP_BOUNDS, ClaudeSetupService } from '../src/main/providers/claude/setup-service'
import type { KeptUsage } from '../src/main/provider-usage-file'

class FakeChild extends EventEmitter {
  readonly pid = 70821
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
}

describe('native setup completion reaches existing runtime readiness notifications', () => {
  let folder: string, host: RuntimeHost, service: ClaudeSetupService, child: FakeChild
  let stopBridge: () => Promise<void>
  let revision: number, signedIn: boolean, installed: boolean
  let holdNext: Promise<void> | null
  let releaseHeld: (() => void) | null
  const listed: { provider: Provider; home: string }[] = []
  const moved = vi.fn(),
    kept = vi.fn()
  const check = vi.fn(async (): Promise<AuthState> =>
    signedIn
      ? { state: 'usable', login: 'account', expiresAt: null }
      : { state: 'absent', reason: 'fictional sign-in missing' },
  )
  const legacySignIn = vi.fn(async (): Promise<never> => {
    throw new Error('native completion must not start another browser flow')
  })

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'fictional-setup-readiness-'))
    revision = 0
    signedIn = true
    installed = true
    holdNext = null
    releaseHeld = null
    listed.length = 0
    moved.mockClear()
    kept.mockClear()
    check.mockClear()
    legacySignIn.mockClear()
    class ScriptedRuntime extends FakeRuntime {
      override async listModels(context: ProviderRuntimeContext): Promise<ModelChoice[]> {
        listed.push({ provider: this.provider, home: context.providerHome })
        const answerRevision = revision
        const held = holdNext
        holdNext = null
        if (held) await held
        if (!signedIn && this.provider === 'claude') throw new Error('fictional sign-in missing')
        return (await super.listModels(context)).map((model) => ({
          ...model,
          id: `r${answerRevision}-${model.id}`,
        }))
      }
    }
    const usage: KeptUsage = {
      readings: {
        claude: [
          { window: 'weekly', usedPercent: 44, resetsAt: Date.now() + 60_000, at: Date.now() },
        ],
        codex: [
          { window: 'weekly', usedPercent: 12, resetsAt: Date.now() + 60_000, at: Date.now() },
        ],
      },
      seen: { claude: [], codex: [] },
    }
    host = new RuntimeHost({
      store: NULL_SESSION_STORE,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(folder, 'exports'),
      createRuntime: (provider) => new ScriptedRuntime(provider),
      prepareProviderHome: (provider, profile) => join(folder, 'homes', profile, provider),
      providerHomePath: (provider, profile) => join(folder, 'homes', profile, provider),
      listProfiles: () => ['cedar', 'orbit'],
      resolveCwd: (_id, requested) => requested ?? folder,
      newSessionId: () => 'fictional-session',
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'X',
        model: 'fictional-model',
        authNote: null,
        files: [],
      }),
      usageKept: { read: () => usage, write: kept },
      providersMoved: moved,
      providerAuth: {
        credentialHome: (provider, profile) => join(folder, 'homes', profile, provider),
        check,
        signIn: legacySignIn,
        reprovision: () => {
          throw new Error('native completion does not copy a credential')
        },
        bringTheKeyToItsHomes: async () => null,
        replaceARefusedCopy: async () => 'not-tried',
      },
    })
    child = new FakeChild()
    service = new ClaudeSetupService(
      {
        platform: 'darwin',
        findProgram: () => (installed ? '/fictional/native/cli' : null),
        spawn: () => child,
        stop: vi.fn(),
      },
      { ...CLAUDE_SETUP_BOUNDS, stopMs: 10 },
    )
    const handlers = new Map<string, Parameters<IpcMain['handle']>[1]>()
    stopBridge = registerProviderSetup(
      {
        handle: (channel, handler) => {
          handlers.set(channel, handler)
        },
        removeHandler: (channel) => {
          handlers.delete(channel)
        },
      },
      { claude: service },
      () => false,
      (provider) => host.providerSetupCompleted(provider),
    )
  })
  afterEach(async () => {
    releaseHeld?.()
    child.emit('close', 1)
    await stopBridge()
    await host.closeAll()
    rmSync(folder, { recursive: true, force: true })
  })
  const ids = async (profile: string, provider: Provider): Promise<string[]> => {
    const answer = await host.providerModels(profile, provider)
    expect(answer.ok).toBe(true)
    return answer.ok ? answer.models.map((model) => model.id) : []
  }

  it('drops all affected profile catalogues and only that provider’s old usage, telling windows once', async () => {
    const old = await ids('cedar', 'claude')
    await ids('orbit', 'claude')
    const unrelated = await ids('cedar', 'codex')
    await ids('cedar', 'claude')
    expect(listed).toHaveLength(3)
    expect(host.providerUsage().claude).toHaveLength(1)
    service.signIn()
    revision = 1
    expect(await ids('cedar', 'claude')).toEqual(old)
    expect(moved).not.toHaveBeenCalled()
    child.emit('close', 0)
    expect(moved.mock.calls.map(([event]) => event)).toEqual([
      { what: 'usage', provider: 'claude' },
      { what: 'login', provider: 'claude' },
    ])
    expect(host.providerUsage().claude).toEqual([])
    expect(host.providerUsage().codex).toHaveLength(1)
    expect(kept).toHaveBeenCalledTimes(1)
    expect((await ids('cedar', 'claude'))[0]).toMatch(/^r1-/)
    expect((await ids('orbit', 'claude'))[0]).toMatch(/^r1-/)
    expect(await ids('cedar', 'codex')).toEqual(unrelated)
    expect(listed).toHaveLength(5)
    child.emit('close', 0)
    expect(moved).toHaveBeenCalledTimes(2)
    expect(legacySignIn).not.toHaveBeenCalled()
  })
  it('asks readiness again after native login instead of marking an absent profile usable itself', async () => {
    signedIn = false
    expect(await host.checkProviderAuth('claude', 'cedar')).toMatchObject({ state: 'absent' })
    service.signIn()
    expect(moved).not.toHaveBeenCalled()
    signedIn = true
    child.emit('close', 0)
    expect(moved).toHaveBeenCalledWith({ what: 'login', provider: 'claude' })
    expect(check).toHaveBeenCalledTimes(1)
    expect(await host.checkProviderAuth('claude', 'cedar')).toMatchObject({ state: 'usable' })
    expect(check).toHaveBeenCalledTimes(2)
    expect(legacySignIn).not.toHaveBeenCalled()
  })
  it('installation alone requests a fresh login check without claiming signed-in readiness', async () => {
    installed = false
    signedIn = false
    service.install()
    installed = true
    child.emit('close', 0)
    expect(moved).toHaveBeenCalledWith({ what: 'login', provider: 'claude' })
    expect(await host.checkProviderAuth('claude', 'cedar')).toMatchObject({ state: 'absent' })
    expect(service.state().phase).toBe('installed')
  })
  it.each(['error', 'cancel'] as const)(
    'leaves readiness, usage and caches unchanged on %s',
    async (outcome) => {
      const before = await ids('cedar', 'claude')
      service.signIn()
      revision = 1
      if (outcome === 'cancel') service.cancel()
      child.emit('close', outcome === 'error' ? 1 : 0)
      expect(moved).not.toHaveBeenCalled()
      expect(kept).not.toHaveBeenCalled()
      expect(await ids('cedar', 'claude')).toEqual(before)
      expect(listed).toHaveLength(1)
      expect(host.providerUsage().claude).toHaveLength(1)
    },
  )
  it('does not let an older in-flight model answer repopulate the invalidated cache', async () => {
    let release!: () => void
    holdNext = new Promise<void>((resolve) => {
      release = resolve
      releaseHeld = resolve
    })
    const before = host.providerModels('cedar', 'claude')
    await Promise.resolve()
    await Promise.resolve()
    expect(listed).toHaveLength(1)
    service.signIn()
    revision = 1
    child.emit('close', 0)
    const after = host.providerModels('cedar', 'claude')
    release()
    const old = await before,
      fresh = await after
    expect(old.ok && old.models[0]?.id).toMatch(/^r0-/)
    expect(fresh.ok && fresh.models[0]?.id).toMatch(/^r1-/)
    expect((await ids('cedar', 'claude'))[0]).toMatch(/^r1-/)
    expect(listed).toHaveLength(2)
  })
})
