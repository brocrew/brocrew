import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TheCliAnswersInOrder } from '../../../packages/runtime/test/the-cli-answers-in-order'
import {
  AuthUnavailableError,
  CLAUDE_LOGIN_RENEWED,
  ClaudeRuntime,
  type ClaudeLoginRenewal,
} from '@brobot2/runtime'
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { prepareOnTheLogin } from '../src/main/providers/claude'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { createSessionStore as createRendererStore } from '../src/renderer/src/lib/session-store'
import type { SessionRecord } from '../src/renderer/src/lib/session-record'
import { REOPENED_ON_A_RENEWED_SIGN_IN, type NoticeItem } from '../src/renderer/src/lib/transcript'
import { isVisibleIn } from '../src/renderer/src/lib/transcript-mode'
import type {
  ResumedSession,
  RuntimeBridge,
  RuntimeEventMessage,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'
import { everythingOverTheWire } from './lib/the-wire'

/**
 * 🔴 **D-004 · R101 — a Claude conversation killed by a login renewed elsewhere on this Mac reopens
 * itself on the new login, and says so.**
 *
 * A mid-turn `auth_stale` failure (“OAuth access token has been revoked”) stops the
 * conversation. Reopening and sending another message must use a login renewed by another
 * Claude process; a child holding an injected token cannot renew that token itself.
 *
 * ⚑ **Real host, real SQLite ledger, the product's own `ClaudeRuntime` over scripted SDK frames, and
 * the real renderer store in the window.** The machine login is a fake reader: the token is a plain
 * test string, and it changes between the launch and the fatal 401 exactly as a renewal does.
 * 🔒 No real credential is read anywhere in this file.
 */

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

class FakeQuery {
  private resolve: ((value: IteratorResult<SDKMessage>) => void) | null = null
  private readonly buffer: SDKMessage[] = []
  private done = false

  emit(message: SDKMessage): void {
    if (this.resolve) {
      const resolve = this.resolve
      this.resolve = null
      resolve({ value: message, done: false })
      return
    }
    this.buffer.push(message)
  }

  end(): void {
    this.done = true
    if (this.resolve) {
      const resolve = this.resolve
      this.resolve = null
      resolve({ value: undefined as never, done: true })
    }
  }

  async interrupt(): Promise<void> {}
  async setPermissionMode(): Promise<void> {}
  close(): void {
    this.end()
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.cli.over({
      next: (): Promise<IteratorResult<SDKMessage>> => {
        const queued = this.buffer.shift()
        if (queued) return Promise.resolve({ value: queued, done: false })
        if (this.done) return Promise.resolve({ value: undefined as never, done: true })
        return new Promise((resolve) => {
          this.resolve = resolve
        })
      },
    })
  }

  /** ⚑ F080: it reads what the adapter sends, and each `result` names the message it answers. */
  readonly cli = new TheCliAnswersInOrder()
}

/** ⛔ One window's two ends, the way the preload builds them (`a-woken-conversation…`'s `Window`). */
class Window {
  readonly received: RuntimeEventMessage[] = []
  readonly resumes: ResumedSession[] = []
  private listeners: ((message: RuntimeEventMessage) => void)[] = []
  readonly sink: RuntimeEventSink

  constructor(private readonly host: RuntimeHost) {
    const listeners = (): ((message: RuntimeEventMessage) => void)[] => this.listeners
    this.sink = {
      ownerId: 'webContents:1',
      aPersonIsBehindIt: true,
      alive: true,
      send: (message) => {
        this.received.push(message)
        listeners().forEach((listener) => listener(message))
      },
      sendLiveness: () => {},
    }
  }

  bridge(): RuntimeBridge {
    const run = async <T>(kind: string, input: Record<string, unknown> = {}): Promise<T> => {
      const answered = await executeRuntimeCommand(this.host, this.sink, {
        kind,
        ...input,
      } as Parameters<typeof executeRuntimeCommand>[2])
      return structuredClone(answered) as T
    }
    const bridge: Partial<RuntimeBridge> = {
      createSession: (input) => run('createSession', { ...input }),
      resume: async (input) => {
        const handed = await run<ResumedSession>('resume', { ...input })
        this.resumes.push(handed)
        return handed
      },
      // ⚑ **D-017b · the window takes a conversation it is sent events for back through `look`**,
      // which starts nothing: the host started it for this window, and the look attaches it.
      look: async (input) => {
        const handed = await run<ResumedSession>('look', { ...input })
        this.resumes.push(handed)
        return handed
      },
      onEvent: (fn) => {
        this.listeners.push(fn)
        return () => {
          this.listeners = this.listeners.filter((one) => one !== fn)
        }
      },
      onLiveness: () => () => {},
      // ⚑ **D-017 · the store now asks for what is open when it starts** (`45a11477`); without this
      // door every mount rejected unhandled. Through the real command, like its neighbours.
      attachOpen: () => run<ResumedSession[]>('attachOpen'),
    }
    return everythingOverTheWire(bridge) as RuntimeBridge
  }
}

const frame = (value: Record<string, unknown>): SDKMessage => value as unknown as SDKMessage
const REVOKED = 'Failed to authenticate. API Error: 401 OAuth access token has been revoked.'

describe('D-004 · R101 — a login renewed elsewhere reopens the conversation it killed', () => {
  let dir: string
  let db: AppDatabase
  let ledger: SessionStore
  let hosts: RuntimeHost[]
  /** ⚑ What the provider has "on disk": every id a `system/init` announced. */
  let announced: Set<string>
  /** Every query the product built, and the options it built them with. */
  let launches: { fq: FakeQuery; options: Options }[]
  /** 🔒 The fake machine login — a test string, or `null` for missing or expired. */
  let machineLogin: string | null
  /** The app's renewal of an expired Claude Code login, when a test gives one. */
  let renewal: (() => Promise<ClaudeLoginRenewal>) | undefined
  /** Whether a Claude key is saved, which a launch runs on instead of the login. */
  let keySaved: boolean
  let launchBarrier: (() => Promise<void>) | undefined

  function buildHost(): RuntimeHost {
    const renewForThisHost = renewal
    const built = new RuntimeHost({
      store: ledger,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(dir, 'exports'),
      createRuntime: () =>
        new ClaudeRuntime(
          (params) => {
            const fq = new FakeQuery()
            launches.push({ fq, options: params.options })
            fq.cli.listen(params.prompt)
            return fq as never
          },
          async (sessionId) => announced.has(sessionId),
          () => machineLogin,
          async () => machineLogin,
        ),
      prepareProviderHome: (which) => {
        if (machineLogin === null) {
          throw new AuthUnavailableError('claude', 'the login has expired (this test’s sentence)')
        }
        const home = join(dir, 'homes', which)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (which) => join(dir, 'homes', which),
      resolveCwd: () => join(dir, 'cwd'),
      newSessionId: () => 'sess_d004',
      ...(renewForThisHost === undefined
        ? {}
        : {
            loginRenewal: (provider: import('@brobot2/shared').Provider) =>
              provider === 'claude'
                ? {
                    launchLabel: 'Claude sign-in renewal',
                    renew: renewForThisHost,
                    prepare: prepareOnTheLogin,
                  }
                : undefined,
          }),
      ...(launchBarrier === undefined ? {} : { beforeProviderLaunch: launchBarrier }),
      ...(keySaved
        ? {
            apiKeys: {
              status: (provider) => ({ provider, set: true, setAt: 1, inUse: true }),
              set: () => {
                throw new Error('this test keeps its key')
              },
              remove: () => {
                throw new Error('this test keeps its key')
              },
              read: () => 'sk-ant-made-up',
            },
          }
        : {}),
      readProviderConfig: (_which, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-d004-'))
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrations)
    ledger = createSessionStore(db)
    hosts = []
    announced = new Set()
    launches = []
    machineLogin = 'test-token-at-launch'
    renewal = undefined
    keySaved = false
    launchBarrier = undefined
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  const eventsOf = (sessionId: string): TranscriptEvent[] =>
    ledger.events(sessionId).map((entry) => entry.event)

  /**
   * ⚑ **D-017b · the window's record holds the RECORDED hand-over** (`look`, once the life that died
   * is let go) — ⛔ never the dying life's `attached` one: its hand-back, grants and settings are
   * that life's.
   */
  const holdsTheRecordedHandover = (one: SessionRecord): boolean =>
    one.meta !== null && 'handover' in one.meta && one.meta.handover === 'recorded'

  /**
   * ⚑ A conversation in a person's window, one turn in, and a second turn the revoked sign-in kills
   * — the measured shape: the provider's init, then the CLI's own `authentication_failed` notice.
   * `renew` runs after the turn began and before the fatal 401, as another Claude on the Mac
   * renewing does. ⚑ `the-stream-ended` (T-002) kills it another way instead: the provider stream
   * ends mid-turn, a fatal error with no `auth_stale` cause.
   */
  async function killedMidTurn(
    renew: () => void,
    how: 'revoked' | 'the-stream-ended' = 'revoked',
  ): Promise<{
    host: RuntimeHost
    window: Window
    record: () => SessionRecord
    sessionId: string
  }> {
    const host = buildHost()
    const window = new Window(host)
    const renderer = createRendererStore(window.bridge())
    const sessionId = await renderer.create({ provider: 'claude', cwd: join(dir, 'cwd') })
    if (sessionId === null) throw new Error('the conversation never opened')
    const cwd = join(dir, 'cwd')
    await host.send(sessionId, 'first', window.sink)
    announced.add('provider-A')
    launches[0]?.fq.emit(frame({ type: 'system', subtype: 'init', session_id: 'provider-A', cwd }))
    launches[0]?.fq.emit(frame({ type: 'result', subtype: 'success', is_error: false }))
    await waitFor(
      () => eventsOf(sessionId).some((event) => event.type === 'turn'),
      'the first turn to end',
    )

    await host.send(sessionId, 'run the long job', window.sink)
    // ⚑ **Mid-turn**, as measured: a renewal before the send is the turn gate's refusal instead
    // (`assertSignInCurrent`, the sign-in bar) — a different path, and not this card's.
    renew()
    if (how === 'the-stream-ended') launches[0]?.fq.end()
    else
      launches[0]?.fq.emit(
        frame({
          type: 'assistant',
          message: {
            role: 'assistant',
            model: '<synthetic>',
            content: [{ type: 'text', text: REVOKED }],
          },
          error: 'authentication_failed',
        }),
      )
    await waitFor(
      () =>
        eventsOf(sessionId).some((event) => event.type === 'status' && event.state === 'errored'),
      'the conversation to die on the revoked sign-in',
    )
    return {
      host,
      window,
      record: () => renderer.get(sessionId) as SessionRecord,
      sessionId,
    }
  }

  it('🔴 a renewed login: reopened by itself on the new one, taken back by the window, said once', async () => {
    const { window, record, sessionId } = await killedMidTurn(() => {
      machineLogin = 'test-token-renewed-elsewhere'
    })

    // ⚑ A second launch, a RESUME of the same provider conversation, on the renewed login.
    await waitFor(() => launches.length === 2, 'the reopen')
    expect(launches[1]?.options.resume).toBe('provider-A')
    expect(launches[1]?.options.env?.['CLAUDE_CODE_OAUTH_TOKEN']).toBe(
      'test-token-renewed-elsewhere',
    )

    // ⚑ The row says why, and it reached the window that watched it die.
    expect(eventsOf(sessionId)).toContainEqual({
      type: 'reopened',
      because: 'the-sign-in-was-renewed',
    })
    // ⚑ **D-017b · the window looks again whenever its record's fold ends** — answered from the
    // ledger once the life that died is let go — and again when the reopened life's events reach
    // it. ⚑ The take-back is that second look: attached, and carrying the seam (`liveFrom`) only a
    // life after a stop has.
    const takenBack = (): ResumedSession[] =>
      window.resumes.filter((one) => one.handover === 'attached' && one.liveFrom !== undefined)
    await waitFor(() => takenBack().length === 1, 'the window to take it back')
    expect(takenBack()[0]?.sessionId).toBe(sessionId)
    await waitFor(() => record().phase === 'open', 'the window’s record to be live again')

    // ⚑ One line says so, and the transcript is not ended.
    const said = record().control.items.filter(
      (item): item is NoticeItem =>
        item.kind === 'notice' && item.text === REOPENED_ON_A_RENEWED_SIGN_IN,
    )
    expect(said).toHaveLength(1)
    expect(record().control.ended).toBe(false)
    // ⚑ **T-002 · `1004 M11`**: at `warn`, so the reading view keeps it: it answers the stop drawn
    // just above it. And the card's own promise is in its words.
    expect(said[0]?.level).toBe('warn')
    expect(isVisibleIn('normal', said[0]!)).toBe(true)
    expect(REOPENED_ON_A_RENEWED_SIGN_IN).toContain('Nothing was re-sent: send again to carry on.')

    // ⛔ **Nothing was re-sent**: the failed turn is the last message a person sent, and the new
    // child was handed no turn at all.
    const sent = eventsOf(sessionId).flatMap((event) =>
      event.type === 'user_turn' ? [event.text] : [],
    )
    expect(sent).toEqual(['first', 'run the long job'])
    const after = eventsOf(sessionId).slice(
      eventsOf(sessionId).findIndex((event) => event.type === 'reopened'),
    )
    expect(after.some((event) => event.type === 'user_turn')).toBe(false)
  })

  it('the same token: today’s stop, and no reopen', async () => {
    const { sessionId, record } = await killedMidTurn(() => {})
    await waitFor(
      () => record().phase === 'recorded' && holdsTheRecordedHandover(record()),
      'the window’s record to end, drawn from the ledger',
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(launches).toHaveLength(1)
    expect(eventsOf(sessionId).some((event) => event.type === 'reopened')).toBe(false)
  })

  // ⚑ **T-002 · `1004 M13`**: only a death the LOGIN caused is reopened on a renewed one. A child
  // that died another way while the login happened to be renewed keeps today's stop: the line
  // would name a cause that is not true.
  it('a death that was not the sign-in, on a renewed login: today’s stop, and no reopen', async () => {
    const { sessionId, record } = await killedMidTurn(() => {
      machineLogin = 'test-token-renewed-elsewhere'
    }, 'the-stream-ended')
    await waitFor(
      () => record().phase === 'recorded' && holdsTheRecordedHandover(record()),
      'the window’s record to end, drawn from the ledger',
    )
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(launches).toHaveLength(1)
    expect(eventsOf(sessionId).some((event) => event.type === 'reopened')).toBe(false)
  })

  it('🔴 an expired login the person’s Claude Code renews: reopened on the renewed one', async () => {
    let renewals = 0
    renewal = async () => {
      if (machineLogin !== null) return 'not-needed'
      renewals++
      machineLogin = 'test-token-renewed-by-claude-code'
      return 'renewed'
    }
    const { sessionId, record } = await killedMidTurn(() => {
      machineLogin = null
    })
    await waitFor(() => launches.length === 2, 'the reopen on the renewed login')
    expect(renewals).toBe(1)
    expect(launches[1]?.options.resume).toBe('provider-A')
    expect(launches[1]?.options.env?.['CLAUDE_CODE_OAUTH_TOKEN']).toBe(
      'test-token-renewed-by-claude-code',
    )
    expect(eventsOf(sessionId)).toContainEqual({
      type: 'reopened',
      because: 'the-sign-in-was-renewed',
    })
    // The person is told, once, that their Claude Code renewed the login.
    const launched = eventsOf(sessionId).filter((event) => event.type === 'launched')
    expect(launched.at(-1)).toEqual({ type: 'launched', loginRenewed: CLAUDE_LOGIN_RENEWED })
    expect(launched.filter((event) => 'loginRenewed' in event)).toHaveLength(1)
    await waitFor(
      () =>
        record().control.items.some(
          (item) => item.kind === 'notice' && item.text === CLAUDE_LOGIN_RENEWED,
        ),
      'the line saying the login was renewed',
    )
  })

  it('deleting a stopped conversation cannot release its still-running recovery renewal', async () => {
    let release!: () => void
    let entered!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const began = new Promise<void>((resolve) => {
      entered = resolve
    })
    renewal = async () => {
      if (machineLogin !== null) return 'not-needed'
      entered()
      await held
      return 'not-renewed'
    }
    const { host, sessionId } = await killedMidTurn(() => {
      machineLogin = null
    })
    try {
      await began
      expect(await host.deleteConversation(sessionId, ['records'])).toMatchObject({
        done: true,
        removed: ['records'],
      })
      expect(ledger.recordedOne(sessionId)).toBeNull()
      expect(host.providerProcessesInFlight()).toBe(true)
    } finally {
      release()
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    await waitFor(
      () => !host.providerProcessesInFlight(),
      'the independent renewal lease to settle',
    )
    expect(launches).toHaveLength(1)
  })

  it('a queued recovery waits at the clearing barrier before its renewal can start', async () => {
    let releaseBarrier!: () => void
    let barrierEntered!: () => void
    let nativeEntered!: () => void
    const held = new Promise<void>((resolve) => {
      releaseBarrier = resolve
    })
    const atBarrier = new Promise<void>((resolve) => {
      barrierEntered = resolve
    })
    const atNative = new Promise<void>((resolve) => {
      nativeEntered = resolve
    })
    let nativeCalls = 0
    let gateCalls = 0
    launchBarrier = async () => {
      if (machineLogin !== null) return
      gateCalls++
      barrierEntered()
      await held
    }
    renewal = async () => {
      if (machineLogin !== null) return 'not-needed'
      nativeCalls++
      nativeEntered()
      return 'not-renewed'
    }
    const { host } = await killedMidTurn(() => {
      machineLogin = null
    })
    try {
      await Promise.race([atBarrier, atNative])
      expect(gateCalls).toBe(1)
      expect(nativeCalls).toBe(0)
      expect(host.providerProcessesInFlight()).toBe(true)
      releaseBarrier()
      await atNative
    } finally {
      releaseBarrier()
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    await waitFor(() => !host.providerProcessesInFlight(), 'the gated renewal to settle')
    expect(nativeCalls).toBe(1)
  })

  it('🔴 a start on an expired login has it renewed first, and its first row says so', async () => {
    machineLogin = null
    let renewals = 0
    renewal = async () => {
      if (machineLogin !== null) return 'not-needed'
      renewals++
      machineLogin = 'test-token-renewed-by-claude-code'
      return 'renewed'
    }
    const host = buildHost()
    const window = new Window(host)
    const renderer = createRendererStore(window.bridge())
    const sessionId = await renderer.create({ provider: 'claude', cwd: join(dir, 'cwd') })
    if (sessionId === null) throw new Error('the conversation never opened')
    expect(renewals).toBe(1)
    expect(eventsOf(sessionId)).toContainEqual({
      type: 'launched',
      loginRenewed: CLAUDE_LOGIN_RENEWED,
    })
  })

  it('⛔ a model-list read never renews: it says the login’s own sentence, and a start renews it', async () => {
    machineLogin = null
    let renewals = 0
    renewal = async () => {
      renewals++
      return 'renewed'
    }
    const host = buildHost()
    const list = await host.modelList('claude')
    expect(renewals).toBe(0)
    expect(JSON.stringify(list)).toContain('the login has expired (this test’s sentence)')
  })

  it('a key saved: the login is not renewed, and no reopen', async () => {
    keySaved = true
    let renewals = 0
    renewal = async () => {
      renewals++
      return 'renewed'
    }
    const { record } = await killedMidTurn(() => {
      machineLogin = null
    })
    await waitFor(
      () => record().phase === 'recorded' && holdsTheRecordedHandover(record()),
      'the window’s record to end, drawn from the ledger',
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(renewals).toBe(0)
    expect(launches).toHaveLength(1)
  })

  it('an expired login Claude Code could not renew: today’s stop, and no reopen', async () => {
    renewal = async () => 'not-renewed'
    const { sessionId, record } = await killedMidTurn(() => {
      machineLogin = null
    })
    await waitFor(
      () => record().phase === 'recorded' && holdsTheRecordedHandover(record()),
      'the window’s record to end, drawn from the ledger',
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(launches).toHaveLength(1)
    expect(eventsOf(sessionId).some((event) => event.type === 'reopened')).toBe(false)
  })

  it('an expired or missing login: today’s stop, and no reopen', async () => {
    const { sessionId, record } = await killedMidTurn(() => {
      machineLogin = null
    })
    await waitFor(
      () => record().phase === 'recorded' && holdsTheRecordedHandover(record()),
      'the window’s record to end, drawn from the ledger',
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(launches).toHaveLength(1)
    expect(eventsOf(sessionId).some((event) => event.type === 'reopened')).toBe(false)
  })
})
