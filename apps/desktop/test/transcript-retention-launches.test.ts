import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FakeRuntime, type AgentRuntime } from '@brobot2/runtime'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { prepareOnTheLogin } from '../src/main/providers/claude'
import type { ProviderAuthOps } from '../src/main/runtime/provider-homes'
import {
  TranscriptRetentionHost,
  transcriptStartupWasInterrupted,
} from '../src/main/transcript-retention'

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
const sink: RuntimeEventSink = {
  ownerId: 'fictional-window',
  aPersonIsBehindIt: true,
  alive: true,
  send() {},
  sendLiveness() {},
}
let dir: string
let db: AppDatabase
let host: RuntimeHost
let barrier = async (): Promise<void> => {}
let synchronize = async (): Promise<string | null> => null
let prepareHome: () => string | Promise<string>
const calls = {
  fresh: vi.fn(),
  resume: vi.fn(),
  model: vi.fn(),
  check: vi.fn(),
  signIn: vi.fn(),
  version: vi.fn(),
  renew: vi.fn(),
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'brocrew-clearing-launch-'))
  db = openDatabase(join(dir, 'fictional.sqlite'))
  applyMigrations(db, migrationsFolder)
  barrier = async () => {}
  synchronize = async () => null
  prepareHome = () => join(dir, 'fictional-home')
  for (const call of Object.values(calls)) call.mockClear()
  const runtime = new FakeRuntime('claude')
  const adapter: AgentRuntime = {
    provider: 'claude',
    listModels: (context) => {
      calls.model()
      return runtime.listModels(context)
    },
    start: (options) => {
      calls.fresh()
      return runtime.start(options)
    },
    resume: (ref, options) => {
      calls.resume()
      return runtime.resume(ref, options)
    },
  }
  const auth: ProviderAuthOps = {
    credentialHome: (_provider, profile) => join(dir, 'fictional-home', profile),
    check: async () => {
      calls.check()
      return { state: 'unknown', reason: 'fictional' }
    },
    signIn: async () => {
      calls.signIn()
      return {
        authUrl: 'https://example.invalid/fictional',
        completed: Promise.resolve({
          success: false,
          error: 'canceled',
          state: { state: 'unknown', reason: 'canceled' },
        }),
        cancel: async () => {},
      }
    },
    reprovision: () => 'replaced',
    bringTheKeyToItsHomes: () => synchronize(),
    replaceARefusedCopy: async () => 'not-tried',
  }
  let ids = 0
  let keySet = true
  host = new RuntimeHost({
    store: createSessionStore(db),
    discoverSessions: NO_DISCOVERY,
    nativeTranscriptPath: () => null,
    exportDirectory: () => join(dir, 'exports'),
    createRuntime: () => adapter,
    providerAuth: auth,
    apiKeys: {
      status: (provider) => ({
        provider,
        set: provider === 'codex' && keySet,
        setAt: 1,
        inUse: false,
      }),
      set: () => {
        keySet = true
        return null
      },
      remove: () => {
        keySet = false
        return true
      },
      read: () => (keySet ? 'fictional-key-never-sent' : null),
    },
    askTheProvider: async () => ({ ok: true, answeredARequest: true }),
    providerVersions: async () => {
      calls.version()
      return {
        claude: { version: null, reason: 'fictional' },
        codex: { version: null, reason: 'fictional' },
      }
    },
    beforeProviderLaunch: () => barrier(),
    loginRenewal: (provider) =>
      provider === 'claude'
        ? {
            launchLabel: 'Claude sign-in renewal',
            renew: async () => {
              calls.renew()
              return 'not-needed'
            },
            prepare: prepareOnTheLogin,
          }
        : undefined,
    prepareProviderHome: () => prepareHome(),
    providerHomePath: () => join(dir, 'fictional-home'),
    resolveCwd: () => dir,
    newSessionId: () => `fictional-${++ids}`,
    readProviderConfig: (_provider, home) => ({
      home,
      homeEnv: 'CLAUDE_CONFIG_DIR',
      model: 'fake-claude-a',
      authNote: null,
      files: [],
    }),
  })
})
afterEach(async () => {
  await host.closeAll()
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

it.each(['working', 'waiting_permission'] as const)(
  'a previous run left %s is captured before repair and skips this startup',
  async (status) => {
    const store = createSessionStore(db)
    store.create({
      id: 'fictional-crash',
      provider: 'claude',
      cwd: dir,
      approvalMode: 'ask',
      profileId: 'fictional-agent',
    })
    db.prepare('UPDATE provider_session SET status = ? WHERE id = ?').run(status, 'fictional-crash')
    const interrupted = transcriptStartupWasInterrupted(store)
    expect(interrupted).toBe(true)
    store.settleOrphanRuns(Date.now(), new Set())
    expect(transcriptStartupWasInterrupted(store)).toBe(false)
    const folder = join(
      dir,
      'provider-homes',
      'default',
      'fictional-agent',
      'claude',
      'projects',
      '-fictional',
    )
    mkdirSync(folder, { recursive: true })
    const target = join(folder, '11111111-1111-4111-8111-111111111111.jsonl')
    writeFileSync(target, 'fictional old transcript\n')
    const now = 1_800_000_000_000
    utimesSync(target, (now - 100 * 86_400_000) / 1000, (now - 100 * 86_400_000) / 1000)
    const skipped = new TranscriptRetentionHost(
      dir,
      () => false,
      () => now,
      interrupted,
    )
    try {
      await skipped.run()
      expect(existsSync(target)).toBe(true)
      expect(await skipped.recent(0, now)).toEqual([])
      await skipped.run()
      expect(existsSync(target)).toBe(true)
    } finally {
      await skipped.stop()
    }
    const nextStart = new TranscriptRetentionHost(
      dir,
      () => false,
      () => now,
      transcriptStartupWasInterrupted(store),
    )
    try {
      await nextStart.run()
      expect(existsSync(target)).toBe(false)
      expect(await nextStart.recent(0, now)).toMatchObject([{ conversations: 1 }])
    } finally {
      await nextStart.stop()
    }
  },
)

it('an unreadable previous-run signal skips clearing instead of assuming a clean exit', () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    expect(
      transcriptStartupWasInterrupted({
        whatACrashLeftRunning: () => {
          throw new Error('fictional unreadable rows')
        },
      }),
    ).toBe(true)
    expect(warning).toHaveBeenCalledTimes(1)
  } finally {
    warning.mockRestore()
  }
})

it.each(['fresh', 'resume', 'model', 'check', 'signIn', 'version', 'renew'] as const)(
  '%s cannot reach its provider while transcript clearing holds the launch barrier',
  async (kind) => {
    let session = ''
    if (kind === 'fresh' || kind === 'resume' || kind === 'renew') await host.modelList('claude')
    if (kind === 'resume') {
      session = (await host.createSession({ provider: 'claude', cwd: dir }, sink)).sessionId
      await host.close(session, sink)
    }
    for (const call of Object.values(calls)) call.mockClear()
    let release!: () => void
    let entered!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const arrived = new Promise<void>((resolve) => {
      entered = resolve
    })
    const gate = vi.fn(async () => {
      entered()
      await held
    })
    barrier = gate
    const pending =
      kind === 'fresh' || kind === 'renew'
        ? host.createSession({ provider: 'claude', cwd: dir }, sink)
        : kind === 'resume'
          ? host.resumeSession(session, sink)
          : kind === 'model'
            ? host.modelList('claude')
            : kind === 'version'
              ? host.providerVersions()
              : kind === 'check'
                ? host.checkProviderAuth('codex', 'fictional-agent')
                : host.signInProvider('codex', 'fictional-agent')
    try {
      await Promise.race([arrived, pending.then(() => undefined)])
      expect(gate).toHaveBeenCalledTimes(1)
      expect(calls[kind]).toHaveBeenCalledTimes(0)
      expect(host.providerProcessesInFlight()).toBe(true)
      release()
      await pending
      expect(calls[kind]).toHaveBeenCalledTimes(1)
    } finally {
      release()
      await pending
    }
  },
)

it.each(['save', 'remove', 'check'] as const)(
  'Codex key %s waits for clearing and owns synchronization until its native work settles',
  async (kind) => {
    let releaseBarrier!: () => void
    let releaseNative!: () => void
    let barrierEntered!: () => void
    let nativeEntered!: () => void
    const gate = new Promise<void>((resolve) => {
      releaseBarrier = resolve
    })
    const native = new Promise<void>((resolve) => {
      releaseNative = resolve
    })
    const atBarrier = new Promise<void>((resolve) => {
      barrierEntered = resolve
    })
    const atNative = new Promise<void>((resolve) => {
      nativeEntered = resolve
    })
    barrier = vi.fn(async () => {
      barrierEntered()
      await gate
    })
    const syncing = vi.fn(async () => {
      nativeEntered()
      await native
      return null
    })
    synchronize = syncing
    const operation =
      kind === 'save'
        ? host.setApiKey('codex', 'fictional-key-never-sent')
        : kind === 'remove'
          ? host.removeApiKey('codex')
          : host.checkApiKey('codex')
    try {
      await Promise.race([atBarrier, atNative, operation.then(() => undefined)])
      expect(barrier).toHaveBeenCalledTimes(1)
      expect(syncing).toHaveBeenCalledTimes(0)
      expect(host.providerProcessesInFlight()).toBe(true)
      releaseBarrier()
      await atNative
      expect(syncing).toHaveBeenCalledTimes(1)
      expect(host.providerProcessesInFlight()).toBe(true)
      releaseNative()
      await operation
      expect(host.providerProcessesInFlight()).toBe(false)
    } finally {
      releaseBarrier()
      releaseNative()
      await operation
    }
  },
)

it('a failed key synchronization releases its launch and keeps the existing notice', async () => {
  synchronize = async () => {
    throw new Error('fictional native failure')
  }
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const changed = await host.removeApiKey('codex')
    expect(changed).toMatchObject({
      notice: 'BroCrew could not tell the provider about the key yet; it will at its next launch.',
    })
    expect(host.providerProcessesInFlight()).toBe(false)
  } finally {
    vi.restoreAllMocks()
  }
})

it('model-home preparation waits for clearing and keeps its native key synchronization owned', async () => {
  let releaseBarrier!: () => void
  let releaseNative!: () => void
  let barrierEntered!: () => void
  let nativeEntered!: () => void
  const gate = new Promise<void>((resolve) => {
    releaseBarrier = resolve
  })
  const native = new Promise<void>((resolve) => {
    releaseNative = resolve
  })
  const atBarrier = new Promise<void>((resolve) => {
    barrierEntered = resolve
  })
  const atNative = new Promise<void>((resolve) => {
    nativeEntered = resolve
  })
  barrier = vi.fn(async () => {
    barrierEntered()
    await gate
  })
  const preparing = vi.fn(async () => {
    nativeEntered()
    await native
    return join(dir, 'fictional-home')
  })
  prepareHome = preparing
  const operation = host.modelList('claude')
  try {
    await Promise.race([atBarrier, atNative, operation.then(() => undefined)])
    expect(barrier).toHaveBeenCalledTimes(1)
    expect(preparing).toHaveBeenCalledTimes(0)
    expect(host.providerProcessesInFlight()).toBe(true)
    releaseBarrier()
    await atNative
    expect(preparing).toHaveBeenCalledTimes(1)
    expect(host.providerProcessesInFlight()).toBe(true)
    releaseNative()
    await operation
    expect(host.providerProcessesInFlight()).toBe(false)
  } finally {
    releaseBarrier()
    releaseNative()
    await operation
  }
})
