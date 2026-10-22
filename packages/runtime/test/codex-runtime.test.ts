import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AuthUnavailableError,
  CodexRefusedItsSignInError,
  codexCopyIdentityIn,
  CodexRuntime,
  codexAccountIn,
  CodexSessionHandle,
  ResumeError,
  type CodexIncoming,
  type CodexLaunchContext,
  type CodexTransport,
  type PermissionDecision,
  type PermissionOutcome,
  type PermissionScope,
  ALWAYS_HONOURED,
  isAlwaysHonoured,
  type RuntimeEvent,
  type SessionHandle,
  type StartPhaseSink,
  QUESTION_REQUEST_KEYS,
  askedOfTheChannel,
  TurnInProgress,
} from '../src/index'
import { MAX_PERMISSION_DETAIL_CHARS } from '../src/events'
import { z } from 'zod'
import type { AgentToolset } from '../src/agent-tools'
import {
  A_COMPACTION_IS_STILL_OUTSTANDING,
  CODEX_PLAN_TOOL_CONFIG,
  CODEX_QUESTION_TOOL_CONFIG,
  codexAppServerArgs,
  createSpawnTransportFactory,
  THE_AGENT_ASKS_FOR_ACCESS,
} from '../src/codex/codex-runtime'
import { AsyncQueue } from '../src/internal/async-queue'
import { CODEX_PROTOCOL_VERSION, codexVersionFromUserAgent } from '../src/codex/protocol-version'
import type { ServerRequestResolvedNotification } from '../src/codex/protocol/v2/ServerRequestResolvedNotification'
import {
  completedTurn,
  failedTurn,
  malformedThreadStartResponse,
  malformedTurnStartResponse,
  threadStartResponse,
  threadStartResponseWithEmptyId,
  threadStartResponseWithoutCwd,
  turnCompletedNotification,
  turnStartResponse,
  turnStartedNotification,
} from './fixtures/codex-protocol'

/** ⚑ What every thread's overlay carries: Codex's planning tool on, and its own question tool off. */
const EVERY_THREAD_OVERLAY = { ...CODEX_PLAN_TOOL_CONFIG, ...CODEX_QUESTION_TOOL_CONFIG }

/**
 * ⚠️ **736 · every launch in this file now reads the kept rules of `/tmp/x/home`** — Claude's
 * `settings.json`, Codex's `brobot-kept-tool-approvals.json`. On a machine where that path held one,
 * dozens of launch assertions would change underneath; this says so loudly instead of flaking.
 */
beforeAll(() => {
  for (const kept of ['settings.json', 'brobot-kept-tool-approvals.json']) {
    expect(existsSync(`/tmp/x/home/${kept}`), `/tmp/x/home/${kept} exists on this machine`).toBe(
      false,
    )
  }
})

/** A controllable stand-in for the codex app-server transport. */
class FakeTransport implements CodexTransport {
  private readonly queue = new AsyncQueue<CodexIncoming>()
  private readonly responders = new Map<string, (params: unknown) => unknown>()
  private readonly failing = new Set<string>()
  requests: { method: string; params: unknown }[] = []
  responses: { id: string | number; result: unknown }[] = []
  errors: { id: string | number; code: number; message: string }[] = []
  /** The codexHome a conformant app-server echoes from `initialize` (P1-H); set by {@link adopt}. */
  codexHome: string | undefined
  /** The version-bearing userAgent a conformant app-server reports (043); overridable per test. */
  userAgent = `brobot2/${CODEX_PROTOCOL_VERSION} (Mac OS 26.3.0; arm64) vscode/1.130.0 (brobot2; 0.0.0)`
  /** How many times close() was called — proves teardown reaches the transport (028 P1-A). */
  closeCount = 0
  /** When true, `respond` throws like the real transport does after terminal (028 P1-A). */
  throwOnRespond = false
  /** Turn ids this fake returned from `turn/start`, in order — the response is authoritative (037). */
  turnStartIds: string[] = []
  private turnSeq = 0
  /** When set, the NEXT turn/start hangs until settleTurnStart() (to exercise the early-interrupt latch). */
  private deferNext = false
  private pendingTurnStart: ((result: unknown) => void) | null = null

  onRequest(method: string, responder: (params: unknown) => unknown): void {
    this.responders.set(method, responder)
  }
  /** Hold the next `turn/start` response open so a test can interrupt BEFORE the id is bound (037). */
  deferNextTurnStart(): void {
    this.deferNext = true
  }
  /** Settle a deferred `turn/start` with a FULL, protocol-valid TurnStartResponse (037/053). */
  settleTurnStart(id: string): void {
    this.turnStartIds.push(id)
    const resolve = this.pendingTurnStart
    this.pendingTurnStart = null
    resolve?.(turnStartResponse(id))
  }
  failRequest(method: string): void {
    this.failing.add(method)
  }
  notification(method: string, params: unknown): void {
    this.queue.push({ kind: 'notification', method, params })
  }
  /**
   * A server request as a CONFORMANT app-server sends it (061): every supported request shape
   * declares `threadId`/`turnId` as required fields, so the faithful default is the ACTIVE
   * thread + the turn id this fake's `turn/start` response bound. A test supplying either field
   * explicitly overrides the default — that is how the out-of-scope probes are written.
   *
   * Before 061 this double sent NO scope at all, which is precisely why an unscoped adapter
   * looked correct in tests while accepting foreign-thread/stale-turn requests live.
   */
  serverRequest(id: string | number, method: string, params: unknown): void {
    const scoped =
      typeof params === 'object' && params !== null
        ? { threadId: 'th_1', turnId: this.lastTurnId, ...params }
        : params
    this.queue.push({ kind: 'request', id, method, params: scoped })
  }

  /** Send `params` VERBATIM — for probes of malformed/absent scope, which must not be defaulted. */
  serverRequestRaw(id: string | number, method: string, params: unknown): void {
    this.queue.push({ kind: 'request', id, method, params })
  }

  /** The provider turn id the last `turn/start` RESPONSE bound (037) — the faithful `turnId`. */
  get lastTurnId(): string {
    return this.turnStartIds[this.turnStartIds.length - 1] ?? ''
  }

  request(method: string, params: unknown): Promise<unknown> {
    this.requests.push({ method, params })
    if (this.failing.has(method)) return Promise.reject(new Error(`transport: ${method} failed`))
    const responder = this.responders.get(method)
    if (responder) return Promise.resolve(responder(params))
    // A conformant app-server echoes the adopted CODEX_HOME in `initialize` (P1-H) and reports
    // its version in the userAgent's first token, `<clientName>/<codexVersion>` (043).
    if (method === 'initialize') {
      return Promise.resolve({
        userAgent: this.userAgent,
        codexHome: this.codexHome,
        platformFamily: 'unix',
        platformOs: 'macos',
      })
    }
    if (method === 'turn/start') {
      // A conformant app-server returns a FULL TurnStartResponse (053) — the
      // AUTHORITATIVE correlation (037, fixing 036 P1-C). A test can defer it to exercise
      // the early-interrupt latch; otherwise it auto-assigns the next id (tn_1, tn_2, …).
      if (this.deferNext) {
        this.deferNext = false
        return new Promise((resolve) => {
          this.pendingTurnStart = resolve
        })
      }
      const id = `tn_${++this.turnSeq}`
      this.turnStartIds.push(id)
      return Promise.resolve(turnStartResponse(id))
    }
    return Promise.resolve({})
  }
  notify(): void {}
  respond(id: string | number, result: unknown): void {
    if (this.throwOnRespond) throw new Error('write after terminal')
    this.responses.push({ id, result })
  }
  respondError(id: string | number, code: number, message: string): void {
    this.errors.push({ id, code, message })
  }
  incoming(): AsyncIterable<CodexIncoming> {
    return this.queue
  }
  /** End the incoming stream WITHOUT an explicit transport close (a child-process death). */
  endIncoming(): void {
    this.queue.close()
  }
  close(): void {
    this.closeCount++
    this.queue.close()
  }
  /**
   * The process this fake "owns", when a test gives it one (233) — see {@link CodexTransport.exited}.
   *
   * ⚠️ **Absent by default, and that is the point.** A fake transport spawns nothing, so `exited`
   * is genuinely `undefined` and the handle above it must answer *"cannot say"* rather than
   * inventing a settled promise.
   */
  exited: Promise<void> | undefined
  quiesced?: Promise<void>
  /** Give this fake a process whose exit the test controls. Returns the trigger. */
  ownsAProcess(): () => void {
    let die!: () => void
    this.exited = new Promise<void>((resolve) => {
      die = resolve
    })
    return die
  }
}

/** A transport factory mirroring a conformant app-server adopting our CODEX_HOME (P1-H):
 *  the fake reports the launched providerHome as its codexHome so attestation passes. */
function adopt(transport: FakeTransport): (ctx: CodexLaunchContext) => CodexTransport {
  return (ctx) => {
    transport.codexHome ??= ctx.providerHome
    return transport
  }
}

function collect(
  handle: { events(): AsyncIterable<RuntimeEvent> },
  sink: RuntimeEvent[],
): Promise<void> {
  return (async () => {
    for await (const event of handle.events()) sink.push(event)
  })()
}
function firstOfType<T extends RuntimeEvent['type']>(
  events: RuntimeEvent[],
  type: T,
): Extract<RuntimeEvent, { type: T }> {
  const found = events.find((e): e is Extract<RuntimeEvent, { type: T }> => e.type === type)
  if (!found) throw new Error(`no ${type} event found`)
  return found
}
const has = (events: RuntimeEvent[], pred: (e: RuntimeEvent) => boolean) => () =>
  expect(events.some(pred)).toBe(true)

/**
 * A FULL, protocol-valid `thread/start` response echoing the prompting profile (013, made
 * faithful in 053). Built from the typed fixture, so it cannot drift back into a partial and a
 * vendored-protocol change is a compile error here rather than a shape the provider never sends.
 */
const okThread = (id: string, cwd = '/tmp/x'): Record<string, unknown> =>
  threadStartResponse(id, cwd) as unknown as Record<string, unknown>

async function startCodex(): Promise<{
  transport: FakeTransport
  handle: Awaited<ReturnType<CodexRuntime['start']>>
  events: RuntimeEvent[]
  consumer: Promise<void>
}> {
  const transport = new FakeTransport()
  transport.onRequest('thread/start', () => okThread('th_1'))
  const runtime = new CodexRuntime(adopt(transport))
  const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
  const events: RuntimeEvent[] = []
  const consumer = collect(handle, events)
  return { transport, handle, events, consumer }
}

/**
 * Start a session AND open a turn (061). A conformant app-server only raises approval /
 * user-input requests INSIDE a live turn and scopes them to it, so any test that exercises a
 * server request must first have a turn for that request to belong to. `turn/start`'s response
 * binds `tn_1`, which {@link FakeTransport.serverRequest} then uses as the faithful `turnId`.
 */
async function startCodexInTurn(): Promise<{
  transport: FakeTransport
  handle: Awaited<ReturnType<CodexRuntime['start']>>
  events: RuntimeEvent[]
  consumer: Promise<void>
}> {
  const ctx = await startCodex()
  await ctx.handle.send('go')
  // ⚠️ **Wait for the turn's own `working` to be DELIVERED, not merely published** (201). `send`
  // resolves when the turn is accepted; the status it publishes reaches this array one queue hop
  // later. Every caller below takes `events.length` as a marker the instant this returns, so a
  // `working` still in flight lands INSIDE the window and reads as a status the test provoked. It
  // did not race until 201 put one more event on the queue ahead of it — which is 193's lesson in
  // miniature: a marker taken mid-drain is a marker whose meaning depends on how fast the queue is.
  await vi.waitFor(() =>
    expect(ctx.events.filter((e) => e.type === 'status').at(-1)?.state).toBe('working'),
  )
  return ctx
}

describe('CodexRuntime — the credential pre-flight (098)', () => {
  /** `getAuthStatus`/`account/read` as the app-server really answers them, per state. */
  const STATUS = (method: string | null) => ({
    authMethod: method,
    authToken: null,
    requiresOpenaiAuth: true,
  })
  const ACCOUNT = (account: unknown) => ({ account, requiresOpenaiAuth: true })
  const SIGNED_IN = { type: 'chatgpt', email: 'probe@example.invalid', planType: 'pro' }

  function transportAnswering(status: unknown, account: unknown): FakeTransport {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1'))
    transport.onRequest('thread/resume', () => okThread('th_1'))
    transport.onRequest('getAuthStatus', () => status)
    transport.onRequest('account/read', () => account)
    return transport
  }

  /**
   * 🔴 **A sign-in that moves to another account in this profile** — by account, never by token.
   * Fake `auth.json` files in a scratch home only.
   */
  describe('a sign-in that moves to another account', () => {
    let home: string
    beforeEach(() => {
      home = mkdtempSync(join(tmpdir(), 'codex-moved-sign-in-'))
    })
    afterEach(() => rmSync(home, { recursive: true, force: true }))
    const signedIn = (account: string, accessToken: string): void =>
      writeFileSync(
        join(home, 'auth.json'),
        JSON.stringify({
          auth_mode: 'chatgpt',
          OPENAI_API_KEY: null,
          tokens: {
            id_token: 'fake-id-token',
            access_token: accessToken,
            refresh_token: 'fake-refresh-token',
            account_id: account,
          },
          last_refresh: '2026-10-06T00:00:00Z',
        }),
      )
    const started = () =>
      new CodexRuntime(adopt(transportAnswering(STATUS('chatgpt'), ACCOUNT(SIGNED_IN)))).start({
        cwd: home,
        providerHome: home,
      })

    it('🔴 the same account renewing its own tokens never trips it', async () => {
      signedIn('acct-one', 'fake-access-one')
      const handle = await started()
      signedIn('acct-one', 'fake-access-two')
      expect(await handle.checkSignIn?.()).toBe(false)
      expect(handle.signInSuperseded).toBe(false)
    })

    it('🔴 another account trips it, and it stays tripped', async () => {
      signedIn('acct-one', 'fake-access-one')
      const handle = await started()
      signedIn('acct-two', 'fake-access-three')
      expect(await handle.checkSignIn?.()).toBe(true)
      signedIn('acct-one', 'fake-access-one')
      expect(await handle.checkSignIn?.()).toBe(true)
      expect(handle.signInSuperseded).toBe(true)
    })

    it('a home that cannot be read now, or a launch with no readable login: cannot tell, never a change', async () => {
      signedIn('acct-one', 'fake-access-one')
      const handle = await started()
      writeFileSync(join(home, 'auth.json'), '{ half a fi')
      expect(await handle.checkSignIn?.()).toBe(false)
      rmSync(join(home, 'auth.json'))
      const unread = await started()
      signedIn('acct-two', 'fake-access-two')
      expect(await unread.checkSignIn?.()).toBe(false)
    })

    it('Codex’s own `auth_mode` decides the kind of login; a link in the home is not read', async () => {
      signedIn('acct-one', 'fake-access-one')
      const account = await codexAccountIn(home)
      expect(account).not.toBeNull()
      // A ChatGPT login that also carries a key is still that account.
      writeFileSync(
        join(home, 'auth.json'),
        JSON.stringify({
          auth_mode: 'chatgpt',
          OPENAI_API_KEY: 'a-made-up-key',
          tokens: { access_token: 'fake-access-two', account_id: 'acct-one' },
        }),
      )
      expect(await codexAccountIn(home)).toBe(account)
      // A login of another kind, with no account, is cannot tell.
      writeFileSync(join(home, 'auth.json'), JSON.stringify({ auth_mode: 'agentIdentity' }))
      expect(await codexAccountIn(home)).toBeNull()
      // ⛔ A link is not followed.
      const elsewhere = join(home, 'elsewhere.json')
      signedIn('acct-one', 'fake-access-one')
      renameSync(join(home, 'auth.json'), elsewhere)
      symlinkSync(elsewhere, join(home, 'auth.json'))
      expect(await codexAccountIn(home)).toBeNull()
    })

    it('a key in place of a sign-in is another account too', async () => {
      signedIn('acct-one', 'fake-access-one')
      const handle = await started()
      writeFileSync(
        join(home, 'auth.json'),
        JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'a-made-up-key' }),
      )
      expect(await handle.checkSignIn?.()).toBe(true)
    })

    it('the tag it gives its sign-in is of the account: a renewal keeps it, another account or a key does not', async () => {
      signedIn('acct-one', 'fake-access-one')
      const tag = (await started()).signInTag?.()
      expect(tag).toMatch(/^[0-9a-f]{32}$/)
      signedIn('acct-one', 'fake-access-two')
      expect((await started()).signInTag?.()).toBe(tag)
      signedIn('acct-two', 'fake-access-three')
      expect((await started()).signInTag?.()).toMatch(/^[0-9a-f]{32}$/)
      expect((await started()).signInTag?.()).not.toBe(tag)
      writeFileSync(
        join(home, 'auth.json'),
        JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'a-made-up-key' }),
      )
      expect((await started()).signInTag?.()).toBeNull()
    })

    it('a saved key has a stable launch identity by revision, with no key in it', async () => {
      writeFileSync(
        join(home, 'auth.json'),
        JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'fictional-key' }),
      )
      const stamp = (revision: number) =>
        writeFileSync(join(home, 'brobot-api-key-login.json'), JSON.stringify({ setAt: revision }))
      stamp(17)
      const first = await started()
      const tag = first.signInTag?.()
      expect(tag).toMatch(/^[0-9a-f]{32}$/)
      expect((await started()).signInTag?.()).toBe(tag)
      stamp(18)
      expect((await started()).signInTag?.()).not.toBe(tag)
      expect(first.signInTag?.()).toBe(tag)
      expect(tag).not.toContain('fictional-key')
    })
  })

  it('refuses to start on an expired credential — before a thread exists, let alone a turn', async () => {
    // The provider can accept `thread/start` with a refused credential and fail only when a
    // turn begins. The app must refuse earlier, before spending the person’s message on a
    // conversation that cannot run.
    const transport = transportAnswering(STATUS('chatgpt'), ACCOUNT(null))
    const runtime = new CodexRuntime(adopt(transport))

    await expect(runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })).rejects.toThrow(
      /sign-in has expired/,
    )
    expect(transport.requests.map((r) => r.method)).not.toContain('thread/start')
  })

  /**
   * 🔴 **A refused credential says which one it was** — a home logged in with the person's OpenAI key
   * answers the launch's probe as an `apiKey` account, so a later `unauthorized` is the KEY refused
   * (`onAKey`), never *"sign in again"*. ⚑ Fake answers only: no key reaches anything here.
   */
  describe('which credential a refusal was', () => {
    const refusedAfterStartingOn = async (
      status: unknown,
      account: unknown,
    ): Promise<RuntimeEvent[]> => {
      const transport = transportAnswering(status, account)
      const handle = await new CodexRuntime(adopt(transport)).start({
        cwd: '/tmp/x',
        providerHome: '/tmp/x/home',
      })
      const events: RuntimeEvent[] = []
      const consumer = collect(handle, events)
      transport.notification('error', {
        threadId: 'th_1',
        turnId: 'tn_none',
        error: { message: 'Incorrect API key provided', codexErrorInfo: 'unauthorized' },
      })
      await vi.waitFor(has(events, (e) => e.type === 'error'))
      await handle.close()
      await consumer
      return events.filter((e) => e.type === 'error')
    }

    it('🔴 on a saved key: the refusal is marked `onAKey`', async () => {
      expect(await refusedAfterStartingOn(STATUS('apikey'), ACCOUNT({ type: 'apiKey' }))).toEqual([
        {
          type: 'error',
          message: 'Incorrect API key provided',
          fatal: false,
          cause: 'auth',
          onAKey: true,
        },
      ])
    })

    it('⚑ control: on a ChatGPT sign-in, it is not', async () => {
      expect(await refusedAfterStartingOn(STATUS('chatgpt'), ACCOUNT(SIGNED_IN))).toEqual([
        { type: 'error', message: 'Incorrect API key provided', fatal: false, cause: 'auth' },
      ])
    })

    /** A turn the app-server failed, with the `TurnError` member it named. */
    const turnFailedWith = async (
      status: unknown,
      account: unknown,
      codexErrorInfo: string,
      message = 'refused',
    ): Promise<RuntimeEvent[]> => {
      const transport = transportAnswering(status, account)
      const handle = await new CodexRuntime(adopt(transport)).start({
        cwd: '/tmp/x',
        providerHome: '/tmp/x/home',
      })
      const events: RuntimeEvent[] = []
      const consumer = collect(handle, events)
      await handle.send('go')
      await vi.waitFor(has(events, (e) => e.type === 'status' && e.state === 'working'))
      const failed = failedTurn('tn_1', message)
      transport.notification(
        'turn/completed',
        turnCompletedNotification('th_1', {
          ...failed,
          error: { ...failed.error!, codexErrorInfo: codexErrorInfo as never },
        }),
      )
      await vi.waitFor(has(events, (e) => e.type === 'turn'))
      await handle.close()
      await consumer
      return events.filter((e) => e.type === 'turn')
    }

    it('🔴 F076 · a turn failed on a saved key: its row says the login was refused, and that it was the key', async () => {
      expect(
        await turnFailedWith(STATUS('apikey'), ACCOUNT({ type: 'apiKey' }), 'unauthorized'),
      ).toEqual([{ type: 'turn', state: 'failed', loginRefused: true, onAKey: true }])
    })

    it('🔴 F076 · a turn failed on a ChatGPT sign-in: its row says the login was refused', async () => {
      expect(await turnFailedWith(STATUS('chatgpt'), ACCOUNT(SIGNED_IN), 'unauthorized')).toEqual([
        { type: 'turn', state: 'failed', loginRefused: true },
      ])
    })

    it('🔴 a turn failed where Codex finds the account’s workspace, on a sign-in it refused: typed `other`, and its row says the login was refused', async () => {
      const refusedAtRouting = 'workspace routing discovery unauthorized (401)'
      expect(
        await turnFailedWith(STATUS('chatgpt'), ACCOUNT(SIGNED_IN), 'other', refusedAtRouting),
      ).toEqual([{ type: 'turn', state: 'failed', loginRefused: true }])
      // ⛔ The same request failing for another reason is a turn that failed, and no more.
      for (const message of [
        'workspace routing discovery failed',
        'workspace routing discovery timed out',
      ]) {
        const [row] = await turnFailedWith(STATUS('chatgpt'), ACCOUNT(SIGNED_IN), 'other', message)
        expect(row, message).toMatchObject({ type: 'turn', state: 'failed' })
        expect(row, message).not.toHaveProperty('loginRefused')
      }
    })

    it('⛔ a usage limit is never read as a refused login — on a key or a sign-in', async () => {
      for (const [status, account] of [
        [STATUS('apikey'), ACCOUNT({ type: 'apiKey' })],
        [STATUS('chatgpt'), ACCOUNT(SIGNED_IN)],
      ]) {
        const [row] = await turnFailedWith(status, account, 'usageLimitExceeded')
        expect(row).toMatchObject({ type: 'turn', state: 'failed' })
        expect(row).not.toHaveProperty('loginRefused')
      }
    })

    it('🔴 on a saved key, `usageLimitExceeded` is the key’s account out of quota: a billing refusal, never a limit', async () => {
      // OpenAI's `insufficient_quota` on an API key arrives as `usageLimitExceeded`; nothing resets
      // it, so it must not ride as a limit that does.
      expect(
        await turnFailedWith(STATUS('apikey'), ACCOUNT({ type: 'apiKey' }), 'usageLimitExceeded'),
      ).toEqual([{ type: 'turn', state: 'failed', billingRefused: true, onAKey: true }])
    })

    it('⚑ control: on a ChatGPT sign-in it is the plan’s usage limit, as before', async () => {
      const [row] = await turnFailedWith(
        STATUS('chatgpt'),
        ACCOUNT(SIGNED_IN),
        'usageLimitExceeded',
      )
      expect(row).toMatchObject({ type: 'turn', state: 'failed', limit: { provider: 'codex' } })
      expect(row).not.toHaveProperty('billingRefused')
      expect(row).not.toHaveProperty('onAKey')
    })

    it('🔴 …and its `error` notification says the same, on a key only', async () => {
      const quotaOn = async (status: unknown, account: unknown): Promise<RuntimeEvent[]> => {
        const transport = transportAnswering(status, account)
        const handle = await new CodexRuntime(adopt(transport)).start({
          cwd: '/tmp/x',
          providerHome: '/tmp/x/home',
        })
        const events: RuntimeEvent[] = []
        const consumer = collect(handle, events)
        transport.notification('error', {
          threadId: 'th_1',
          turnId: 'tn_none',
          willRetry: false,
          error: {
            message: 'Quota exceeded. Check your plan and billing details.',
            codexErrorInfo: 'usageLimitExceeded',
          },
        })
        await vi.waitFor(has(events, (e) => e.type === 'error'))
        await handle.close()
        await consumer
        return events.filter((e) => e.type === 'error')
      }
      expect(await quotaOn(STATUS('apikey'), ACCOUNT({ type: 'apiKey' }))).toEqual([
        {
          type: 'error',
          message: 'Quota exceeded. Check your plan and billing details.',
          fatal: false,
          billingRefused: true,
          onAKey: true,
        },
      ])
      const [onASignIn] = await quotaOn(STATUS('chatgpt'), ACCOUNT(SIGNED_IN))
      expect(onASignIn).not.toHaveProperty('billingRefused')
    })

    it('⚑ a probe that could not ask marks nothing — it learned nothing about the credential', async () => {
      // No probe handlers at all: both requests fail, the probe answers `unknown`, the launch goes.
      const { transport, handle, events, consumer } = await startCodex()
      transport.notification('error', {
        threadId: 'th_1',
        turnId: 'tn_none',
        error: { message: 'Unauthorized', codexErrorInfo: 'unauthorized' },
      })
      await vi.waitFor(has(events, (e) => e.type === 'error'))
      expect(firstOfType(events, 'error')).not.toHaveProperty('onAKey')
      await handle.close()
      await consumer
    })
  })

  it('🔴 a turn that carries on hands Codex no input; a turn of words hands it its words', async () => {
    const transport = transportAnswering(STATUS('chatgpt'), ACCOUNT(SIGNED_IN))
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
    })
    // ⚑ Both hand back the turn's own promise, with no async wrapper of their own: a wrapper's ticks
    // would let the provider's first rows land ahead of the host's row for the turn.
    const startsATurn = vi.spyOn(
      handle as unknown as { startATurn(text: string | null): Promise<void> },
      'startATurn',
    )
    const carried = handle.carryOn!()
    expect(carried).toBe(startsATurn.mock.results[0]?.value)
    await carried
    const turn = transport.requests.find((r) => r.method === 'turn/start')
    expect((turn?.params as { input?: unknown }).input).toEqual([])
    // ⚑ The same door, with words: they are its input, as always.
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1')),
    )
    await vi.waitFor(() => expect(handle.status()).toBe('idle'))
    const sent = handle.send('hello')
    expect(sent).toBe(startsATurn.mock.results[1]?.value)
    await sent
    const turns = transport.requests.filter((r) => r.method === 'turn/start')
    expect((turns[1]?.params as { input?: unknown }).input).toEqual([
      { type: 'text', text: 'hello', text_elements: [] },
    ])
    await handle.close()
  })

  it('starts normally on a working credential — the same code path, the other answer', async () => {
    // The pairing. Without it, the refusal above is equally satisfied by a runtime that never starts.
    const transport = transportAnswering(STATUS('chatgpt'), ACCOUNT(SIGNED_IN))
    const runtime = new CodexRuntime(adopt(transport))
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })

    expect(transport.requests.map((r) => r.method)).toContain('thread/start')
    expect(handle.ref?.sessionId).toBe('th_1')
    await handle.close()
  })

  it('🔴 a start Codex refuses names the copy it began on, and none when another was put there before Codex answered', async () => {
    const home = mkdtempSync(join(tmpdir(), 'brobot-codex-refused-home-'))
    const copy = join(home, 'auth.json')
    const fictional = JSON.stringify({
      auth_mode: 'chatgpt',
      tokens: { account_id: 'acct-fictional-a', access_token: 'FICTIONAL' },
    })
    try {
      writeFileSync(copy, fictional, { mode: 0o600 })
      const beganOn = codexCopyIdentityIn(home)
      expect(beganOn).not.toBeNull()
      const refused = new CodexRuntime(
        adopt(transportAnswering(STATUS('chatgpt'), ACCOUNT(null))),
      ).start({ cwd: '/tmp/x', providerHome: home })
      await expect(refused).rejects.toBeInstanceOf(CodexRefusedItsSignInError)
      await expect(refused).rejects.toMatchObject({ refusedCopy: beganOn })

      // ⛔ Another copy under the same name, after the app-server is started and before it answers:
      // not the one this launch began on, so the refusal names none.
      const started = adopt(transportAnswering(STATUS('chatgpt'), ACCOUNT(null)))
      const withAnotherPutThere = new CodexRuntime((context) => {
        writeFileSync(`${copy}.new`, fictional, { mode: 0o600 })
        renameSync(`${copy}.new`, copy)
        return started(context)
      }).start({ cwd: '/tmp/x', providerHome: home })
      await expect(withAnotherPutThere).rejects.toBeInstanceOf(CodexRefusedItsSignInError)
      await expect(withAnotherPutThere).rejects.toMatchObject({ refusedCopy: null })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('refuses a RESUME on an expired credential too — reopening is a launch (095)', async () => {
    const transport = transportAnswering(STATUS('chatgpt'), ACCOUNT(null))
    const runtime = new CodexRuntime(adopt(transport))
    const resuming = runtime.resume(
      { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 3 },
      { providerHome: '/tmp/x/home' },
    )
    await expect(resuming).rejects.toThrow(/sign-in has expired/)
    // 🔴 **673 · and it arrives as the SIGN-IN, not as a lost thread** (`663` F6). ⛔ Re-aimed, not
    // stripped: this pinned the words and the words were right; what it could not see was that they
    // came wrapped in the causeless `ResumeError` a missing thread also throws, so no caller could
    // tell *sign in again* from *this thread is gone*. ⚑ The other arm — a thread the provider no
    // longer has — is `honest resume`'s missing-thread test.
    await expect(resuming).rejects.toBeInstanceOf(AuthUnavailableError)
    await expect(resuming).rejects.not.toBeInstanceOf(ResumeError)
    // ⚑ And as Codex's own answer, the one refusal a fresher copy of the sign-in answers. No copy
    // is in this home, so it names none.
    await expect(resuming).rejects.toBeInstanceOf(CodexRefusedItsSignInError)
    await expect(resuming).rejects.toMatchObject({ refusedCopy: null })

    // Paired on the same path: a working credential reopens.
    const ok = transportAnswering(STATUS('chatgpt'), ACCOUNT(SIGNED_IN))
    const handle = await new CodexRuntime(adopt(ok)).resume(
      { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 3 },
      { providerHome: '/tmp/x/home' },
    )
    expect(handle.ref?.sessionId).toBe('th_1')
    await handle.close()
  })

  it('an app-server that does not answer the question still starts — `unknown` never blocks', async () => {
    // A build without these methods must not be reported as "signed out". `FakeTransport` replies
    // `{}` to anything unregistered, which is exactly that shape.
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1'))
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
    })
    expect(handle.ref?.sessionId).toBe('th_1')
    await handle.close()
  })

  it('🔒 the pre-flight never asks the provider to refresh', async () => {
    const transport = transportAnswering(STATUS('chatgpt'), ACCOUNT(SIGNED_IN))
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
    })
    // The refresh token is SHARED with the user's own ~/.codex, and OAuth rotates it on use.
    const asked = transport.requests.filter(
      (r) => r.method === 'getAuthStatus' || r.method === 'account/read',
    )
    expect(asked).toHaveLength(2)
    for (const request of asked) {
      expect((request.params as { refreshToken?: unknown }).refreshToken).toBe(false)
    }
    expect(
      (
        transport.requests.find((r) => r.method === 'getAuthStatus')?.params as {
          includeToken?: unknown
        }
      ).includeToken,
    ).toBe(false)
    await handle.close()
  })
})

describe('CodexRuntime — handshake & message flow', () => {
  it('start does initialize/initialized/thread/start (prompting profile) and exposes the ref', async () => {
    const { transport, handle, events, consumer } = await startCodex()
    expect(handle.ref).toEqual({ provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 })
    await vi.waitFor(has(events, (e) => e.type === 'session'))
    expect(firstOfType(events, 'session').state).toBe('started')

    const start = transport.requests.find((r) => r.method === 'thread/start')
    // ⚑ 736 · R96 — the prompting profile's sandbox is the Codex CLI's default preset now.
    expect(start?.params).toMatchObject({
      approvalPolicy: 'on-request',
      sandbox: 'workspace-write',
    })

    await handle.close()
    await consumer
  })

  it('send issues turn/start; turn/completed → turn+idle, never session:ended; close emits one session:ended', async () => {
    const { transport, handle, events, consumer } = await startCodex()
    await handle.send('hi')
    expect(transport.requests.some((r) => r.method === 'turn/start')).toBe(true)

    // The turn/start RESPONSE already bound tn_1 (037); these notifications carry the real
    // threadId+turnId so the turn-scoped content is honored (a mismatched one is ignored).
    transport.notification('turn/started', turnStartedNotification('th_1', 'tn_1'))
    transport.notification('item/agentMessage/delta', {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'm1',
      delta: 'hey',
    })
    transport.notification('item/completed', {
      threadId: 'th_1',
      turnId: 'tn_1',
      item: { type: 'agentMessage', id: 'm1', text: 'hey' },
    })
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1')),
    )
    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.state === 'completed'))
    // The streamed content was attributed to the current turn (bound from the response).
    expect(events.some((e) => e.type === 'assistant_delta' && e.text === 'hey')).toBe(true)
    expect(events.some((e) => e.type === 'assistant_message' && e.text === 'hey')).toBe(true)
    expect(events.some((e) => e.type === 'session' && e.state === 'ended')).toBe(false)

    await handle.close()
    await consumer
    expect(events.filter((e) => e.type === 'session' && e.state === 'ended')).toHaveLength(1)
    expect(handle.status()).toBe('ended')
  })

  it('⛔ 662 · a stamp changes nothing on the Codex wire — `turn/start` is identical with and without one', async () => {
    // ⚑ `CODEX_CAPABILITIES.turnProvenance` is `absent` because the pinned protocol has no field
    // for it, and this is that entry's other half: the adapter drops the argument rather than
    // inventing a place for it. Measured against a bare send in a second session, because a stamp
    // that reached any field would make the two requests differ.
    const bare = await startCodex()
    await bare.handle.send('hi')
    const stamped = await startCodex()
    await stamped.handle.send('hi', { kind: 'peer', from: 'sess_pm', name: 'Ada' })
    const turnStart = (transport: FakeTransport): unknown =>
      transport.requests.find((request) => request.method === 'turn/start')?.params
    expect(turnStart(stamped.transport), 'the stamped send did reach the wire').toBeDefined()
    expect(turnStart(stamped.transport)).toStrictEqual(turnStart(bare.transport))
    for (const one of [bare, stamped]) {
      await one.handle.close()
      await one.consumer
    }
  })

  it('⛔ the HANDLE carries the rate-limit watch — the wiring, not the class (188 §2)', async () => {
    // ⚑ **This test exists because its mutation row came back GREEN.** `RateLimitWatch` had six
    // tests of its own and nothing asserted that production passes one, so removing
    // `this.rateLimits` from the `normalizeNotification` call — the whole fix, from the user's side
    // — changed no colour anywhere. A class with tests and a call site without them is exactly the
    // vacuity 182 §4 asked for.
    const { transport, handle, events, consumer } = await startCodex()
    const frame = {
      rateLimits: {
        limitId: 'codex',
        primary: { usedPercent: 95, windowDurationMins: 300, resetsAt: 4_000_000_000 },
        secondary: null,
      },
    }
    transport.notification('account/rateLimits/updated', frame)
    await vi.waitFor(has(events, (e) => e.type === 'error' && e.message.includes('95%')))
    // The same frame again. Per-frame, this is a second identical transcript warning; through the
    // session's own watch it is a repetition with nothing new in it.
    transport.notification('account/rateLimits/updated', frame)
    // …and a frame that DOES change the state, so the wait below cannot pass on the first one and
    // the assertion is not just "nothing arrived yet".
    transport.notification('account/rateLimits/updated', {
      rateLimits: {
        ...frame.rateLimits,
        primary: { usedPercent: 99, windowDurationMins: 300, resetsAt: 4_000_000_000 },
      },
    })
    await vi.waitFor(has(events, (e) => e.type === 'error' && e.message.includes('99%')))

    const warnings = events.filter((e) => e.type === 'error' && e.message.includes('rate limit'))
    expect(warnings.map((e) => (e.type === 'error' ? e.message : '')).join(' | ')).toContain('95%')
    expect(warnings, 'three frames, two states, two lines').toHaveLength(2)

    await handle.close()
    await consumer
  })

  it('unmapped notification → unknown card', async () => {
    const { transport, handle, events, consumer } = await startCodex()
    transport.notification('some/future', { x: 1 })
    await vi.waitFor(has(events, (e) => e.type === 'unknown'))
    await handle.close()
    await consumer
  })

  /**
   * ⛔ **§2's choice, from the wire and from the user's side** (201). `RateLimitWatch.seed` has its
   * own tests; this is the wiring, and 188's own lesson is that a class with tests and a call site
   * without them is a fix that changes no colour when it is deleted.
   */
  describe('the rate-limit baseline (201 §2)', () => {
    /** The read as the pinned binary really answers it — two buckets, the main one at a wall. */
    const AT_THE_WALL = {
      limitId: 'codex',
      limitName: null,
      primary: { usedPercent: 100, windowDurationMins: 10080, resetsAt: 4_000_000_000 },
      secondary: null,
      credits: { hasCredits: false, unlimited: false, balance: '0' },
      individualLimit: null,
      spendControlReached: false,
      planType: 'prolite',
      rateLimitReachedType: 'rate_limit_reached',
    }
    const RESPONSE = {
      rateLimits: AT_THE_WALL,
      rateLimitsByLimitId: {
        codex: AT_THE_WALL,
        codex_bengalfox: {
          limitId: 'codex_bengalfox',
          limitName: 'GPT-5.3-Codex-Spark',
          primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: 4_100_000_000 },
          secondary: null,
        },
      },
      rateLimitResetCredits: { availableCount: 0, credits: [] },
    }

    it('⛔ the handle ASKS, and a user already at the wall hears about it before any frame', async () => {
      const transport = new FakeTransport()
      transport.onRequest('thread/start', () => okThread('th_1'))
      transport.onRequest('account/rateLimits/read', () => RESPONSE)
      const handle = await new CodexRuntime(adopt(transport)).start({
        cwd: '/tmp/x',
        providerHome: '/tmp/x/home',
      })
      const events: RuntimeEvent[] = []
      const consumer = collect(handle, events)

      await vi.waitFor(has(events, (e) => e.type === 'error' && e.message.includes('rate-limited')))
      // ⛔ It really was a REQUEST, not a frame we happened to receive. Exactly one, per handle.
      expect(transport.requests.filter((r) => r.method === 'account/rateLimits/read')).toHaveLength(
        1,
      )
      // ⚑ …and the answer is carried whole, as chatter, so a debug reader can tell "the account is
      // fine" from "we never asked" (200 §8's first open item, on this dispatch's surface).
      const record = events.find(
        (e) => e.type === 'unknown' && e.label === 'account/rateLimits/read',
      )
      expect(record?.type === 'unknown' ? record.category : null).toBe('lifecycle')
      expect(record?.type === 'unknown' ? record.raw : null).toMatchObject({
        method: 'account/rateLimits/read',
        result: { rateLimits: { rateLimitReachedType: 'rate_limit_reached' } },
      })

      // ⛔ **The sequence 192 H1 §1 describes, end to end.** The sparse frame that used to be the
      // first thing this session ever heard now merges into a real snapshot, so it cannot downgrade
      // a wall the provider never withdrew.
      transport.notification('account/rateLimits/updated', {
        rateLimits: {
          primary: { usedPercent: 92, windowDurationMins: 300, resetsAt: 4_000_000_000 },
        },
      })
      transport.notification('some/future', { marker: 1 })
      await vi.waitFor(has(events, (e) => e.type === 'unknown' && e.label === 'some/future'))
      expect(
        events.filter((e) => e.type === 'error' && e.message.includes('approaching')),
        'nothing weaker than the wall was ever said',
      ).toEqual([])

      await handle.close()
      await consumer
    })

    it('provider follow-ups 1 · a read that says ordinary usage is NOT allowed is asked again before the next turn, never inferred', async () => {
      const transport = new FakeTransport()
      transport.onRequest('thread/start', () => okThread('th_1'))
      let reads = 0
      transport.onRequest('account/rateLimits/read', () => {
        reads += 1
        // The first read says "not allowed"; the second, before the turn, says it is again.
        return { ...RESPONSE, ordinaryUsageAllowed: reads === 1 ? false : true }
      })
      const handle = await new CodexRuntime(adopt(transport)).start({
        cwd: '/tmp/x',
        providerHome: '/tmp/x/home',
      })
      const events: RuntimeEvent[] = []
      const consumer = collect(handle, events)
      await vi.waitFor(() => expect(reads).toBe(1))
      await handle.send('go')
      // ⛔ No reset time decides it: the provider is asked again, once, as the turn starts.
      await vi.waitFor(() => expect(reads).toBe(2))
      await handle.close()
      await consumer

      // ⚑ The paired negative: a read that said nothing about it is not re-asked.
      const quiet = new FakeTransport()
      quiet.onRequest('thread/start', () => okThread('th_2'))
      let quietReads = 0
      quiet.onRequest('account/rateLimits/read', () => {
        quietReads += 1
        return RESPONSE
      })
      const other = await new CodexRuntime(adopt(quiet)).start({
        cwd: '/tmp/x',
        providerHome: '/tmp/x/home',
      })
      await vi.waitFor(() => expect(quietReads).toBe(1))
      await other.send('go')
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(quietReads).toBe(1)
      await other.close()
    })

    it('⚠️ a baseline that cannot be fetched says so, and the session is unharmed', async () => {
      const transport = new FakeTransport()
      transport.onRequest('thread/start', () => okThread('th_1'))
      transport.failRequest('account/rateLimits/read')
      const handle = await new CodexRuntime(adopt(transport)).start({
        cwd: '/tmp/x',
        providerHome: '/tmp/x/home',
      })
      const events: RuntimeEvent[] = []
      const consumer = collect(handle, events)

      await vi.waitFor(
        has(events, (e) => e.type === 'unknown' && e.label === 'account/rateLimits/read'),
      )
      const record = firstOfType(events, 'unknown')
      expect(record.raw).toMatchObject({ method: 'account/rateLimits/read' })
      expect(JSON.stringify(record.raw)).toContain('failed')
      // ⛔ A baseline is a nicety; the conversation is not. Nothing about the failure is fatal, and
      // the session goes on to run a turn.
      expect(events.some((e) => e.type === 'session' && e.state === 'ended')).toBe(false)
      await handle.send('go')
      await vi.waitFor(has(events, (e) => e.type === 'status' && e.state === 'working'))

      await handle.close()
      await consumer
    })
  })
})

describe('CodexRuntime — approvals', () => {
  it('commandExecution requestApproval → permission_request; allow → accept', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(71, 'item/commandExecution/requestApproval', {
      command: 'rm x',
      cwd: '/tmp/x',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const perm = firstOfType(events, 'permission_request')
    // The card id is the TYPE-PRESERVING key (045) so answering it round-trips to exactly one
    // provider request; the wire response still carries the RAW numeric id.
    expect(perm).toMatchObject({ id: 'number:71', kind: 'command' })
    expect(handle.status()).toBe('waiting_permission')

    await handle.respondPermission('number:71', { outcome: 'allow' })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    expect(transport.responses[0]).toEqual({ id: 71, result: { decision: 'accept' } })

    await handle.close()
    await consumer
  })

  it('fileChange deny → decline; cancel → cancel; allow_for_session → acceptForSession', async () => {
    const cases: [PermissionDecision, string][] = [
      [{ outcome: 'deny' }, 'decline'],
      [{ outcome: 'cancel' }, 'cancel'],
      [{ outcome: 'allow_for_session' }, 'acceptForSession'],
    ]
    for (const [decision, expected] of cases) {
      const { transport, handle, events, consumer } = await startCodexInTurn()
      transport.serverRequest(72, 'item/fileChange/requestApproval', { reason: 'write' })
      await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
      expect(firstOfType(events, 'permission_request').kind).toBe('file')
      await handle.respondPermission('number:72', decision)
      await vi.waitFor(() => expect(transport.responses.length).toBe(1))
      expect(transport.responses[0]).toEqual({ id: 72, result: { decision: expected } })
      await handle.close()
      await consumer
    }
  })

  it('⛔ 736 · R95 — `allow_always` on a card that carries no answer for it is refused `not-offered`, and nothing goes on the wire', async () => {
    // ⚑ `736`'s review: a file approval publishes no offered set, so the gate above did not refuse it,
    // and it went out as `decline` while the ledger recorded *Always allow*.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(73, 'item/fileChange/requestApproval', { reason: 'write' })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    await expect(
      handle.respondPermission('number:73', { outcome: 'allow_always' }),
    ).rejects.toMatchObject({ refusal: 'not-offered' })
    expect(transport.responses).toEqual([])
    // ⚑ THE CONTROL — the card is still live, and a plain Allow answers it.
    await handle.respondPermission('number:73', { outcome: 'allow' })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    expect(transport.responses[0]).toEqual({ id: 73, result: { decision: 'accept' } })
    await handle.close()
    await consumer
  })

  it('a duplicate approval id (SAME kind) yields ONE card and exactly ONE safe response — never accept-after-decline (036 P1-B)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(42, 'item/commandExecution/requestApproval', {
      command: 'echo FIRST',
      cwd: '/tmp/x',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))

    // Duplicate provider id (same kind): NO second card, and the REUSED id is settled fail-closed —
    // pre-fix it sent a decline AND (on answer) an accept: two contradictory responses for one id.
    transport.serverRequest(42, 'item/commandExecution/requestApproval', {
      command: 'echo SECOND',
      cwd: '/tmp/x',
    })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 42)).toBe(true))

    // Exactly one card (the FIRST action); the duplicate surfaced none.
    expect(events.filter((e) => e.type === 'permission_request').length).toBe(1)
    expect(firstOfType(events, 'permission_request').detail).toBe('echo FIRST')

    // EXACTLY ONE provider response for id 42 — the safe decline — never a second/contradictory one.
    expect(transport.responses.filter((r) => r.id === 42)).toEqual([
      { id: 42, result: { decision: 'decline' } },
    ])

    // The reused id was settled fail-closed: answering the now-dead card is rejected, and NO accept
    // is ever sent for id 42 (pre-fix: respondPermission succeeds and an accept follows the decline).
    await expect(handle.respondPermission('number:42', { outcome: 'allow' })).rejects.toThrow()
    await new Promise((r) => setTimeout(r, 10))
    expect(transport.responses.filter((r) => r.id === 42)).toHaveLength(1)
    expect(
      transport.responses.some(
        (r) => r.id === 42 && (r.result as { decision?: string }).decision === 'accept',
      ),
    ).toBe(false)

    await handle.close()
    await consumer
  })

  it('a duplicate provider id CROSS kind (permission then user-input) yields ONE card and one safe response — no second actionable card (036 P1-B)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    // A permission request claims the session-global id 90.
    transport.serverRequest(90, 'item/commandExecution/requestApproval', {
      command: 'echo FIRST',
      cwd: '/tmp/x',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))

    // A user-input request REUSES id 90 (cross-kind). JSON-RPC ids are session-global, so this is a
    // collision: NO second (user-input) card, and the id yields no second response. Pre-fix the two
    // brokers had independent id spaces → the same id surfaced a SECOND actionable card.
    transport.serverRequest(90, 'item/tool/requestUserInput', {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'it',
      questions: [{ id: 'q', question: 'pick', options: [] }],
    })
    // Proceed as soon as the duplicate is processed — EITHER the safe response (post-fix) OR a second
    // card (pre-fix, separate brokers). This makes the meaningful "no second card" assertion the crisp
    // discriminator instead of a coarse timeout.
    await vi.waitFor(() =>
      expect(
        transport.responses.some((r) => r.id === 90) ||
          events.some((e) => e.type === 'user_input_request'),
      ).toBe(true),
    )

    // One card total (the permission) — the cross-kind duplicate surfaced NO user_input_request card.
    expect(events.filter((e) => e.type === 'permission_request')).toHaveLength(1)
    expect(events.some((e) => e.type === 'user_input_request')).toBe(false)
    // One safe provider response for id 90 (the existing permission settled fail-closed → decline).
    expect(transport.responses.filter((r) => r.id === 90)).toEqual([
      { id: 90, result: { decision: 'decline' } },
    ])
    // The now-dead permission card can no longer authorize the reused id.
    await expect(handle.respondPermission('number:90', { outcome: 'allow' })).rejects.toThrow()

    await handle.close()
    await consumer
  })

  it('numeric 1 and string "1" are DISTINCT requests, SAME kind — two cards, two correctly-typed responses, neither hangs (044 P1-B)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    // `RequestId = string | number`, so these are two different provider requests. Pre-fix the
    // key was `String(id)`, so the second collided with the first: one card, one response, and
    // the string-id request was left with NO reply at all (it hung).
    transport.serverRequest(1, 'item/commandExecution/requestApproval', {
      command: 'echo NUMERIC',
      cwd: '/tmp/x',
    })
    transport.serverRequest('1', 'item/commandExecution/requestApproval', {
      command: 'echo STRING',
      cwd: '/tmp/x',
    })
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'permission_request')).toHaveLength(2),
    )

    // TWO distinct cards, each describing its own action, with type-distinct correlation keys.
    const cards = events.filter(
      (e): e is Extract<RuntimeEvent, { type: 'permission_request' }> =>
        e.type === 'permission_request',
    )
    expect(cards.map((c) => c.id)).toEqual(['number:1', 'string:1'])
    expect(cards.map((c) => c.detail)).toEqual(['echo NUMERIC', 'echo STRING'])

    // Each is answerable independently, and each response carries the RAW id with its ORIGINAL
    // type — `1` (number) and `"1"` (string) — so the provider can correlate both.
    await handle.respondPermission('number:1', { outcome: 'allow' })
    await handle.respondPermission('string:1', { outcome: 'deny' })
    await vi.waitFor(() => expect(transport.responses.length).toBe(2))
    expect(transport.responses).toContainEqual({ id: 1, result: { decision: 'accept' } })
    expect(transport.responses).toContainEqual({ id: '1', result: { decision: 'decline' } })
    // Type-preserving on the wire: the numeric response id is a number, the string one a string.
    expect(typeof transport.responses.find((r) => r.id === 1)?.id).toBe('number')
    expect(typeof transport.responses.find((r) => r.id === '1')?.id).toBe('string')

    await handle.close()
    await consumer
  })

  it('numeric 1 and string "1" are DISTINCT requests, CROSS kind — two cards, neither suppressed (044 P1-B)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(2, 'item/commandExecution/requestApproval', {
      command: 'echo NUMERIC',
      cwd: '/tmp/x',
    })
    transport.serverRequest('2', 'item/tool/requestUserInput', {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'it',
      questions: [{ id: 'q', question: 'pick', options: [] }],
    })
    await vi.waitFor(() => expect(events.some((e) => e.type === 'user_input_request')).toBe(true))

    // Both surfaced — the cross-kind collision guard must not fire on a DIFFERENT id.
    expect(events.filter((e) => e.type === 'permission_request')).toHaveLength(1)
    expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(1)
    expect(firstOfType(events, 'permission_request').id).toBe('number:2')
    expect(firstOfType(events, 'user_input_request').id).toBe('string:2')

    await handle.respondPermission('number:2', { outcome: 'allow' })
    await handle.respondUserInput('string:2', { kind: 'answer', answers: { q: 'x' } })
    await vi.waitFor(() => expect(transport.responses.length).toBe(2))
    expect(transport.responses).toContainEqual({ id: 2, result: { decision: 'accept' } })
    expect(transport.responses).toContainEqual({
      id: '2',
      result: { answers: { q: { answers: ['x'] } } },
    })

    await handle.close()
    await consumer
  })

  it('provider follow-ups 1 · `isBlocking` rides the question card as data — and a non-blocking one still WAITS on the person, because Codex does', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(95, 'item/tool/requestUserInput', {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'it',
      questions: [{ id: 'q', question: 'pick', options: [] }],
      isBlocking: false,
      autoResolutionMs: null,
    })
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    const card = events.find((e) => e.type === 'user_input_request')
    expect(card?.type === 'user_input_request' ? card.isBlocking : undefined).toBe(false)
    // ⛔ Codex 0.160.0's `request_user_input` awaits the answer whatever `isBlocking` says, so the
    // conversation is waiting on the person — W4's ruling (a) on provider follow-ups 1.
    expect(handle.status()).toBe('waiting_permission')
    await handle.close()
    await consumer
  })

  it('a duplicate provider id CROSS kind, REVERSE order (user-input then permission) settles the user-input request fail-closed — one card, one safe response (036 P1-B)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    // A user-input request claims the session-global id 91 (owned by the userInputs broker).
    transport.serverRequest(91, 'item/tool/requestUserInput', {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'it',
      questions: [{ id: 'q', question: 'pick', options: [] }],
    })
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))

    // A permission request REUSES id 91 (cross-kind, reverse order): collision → the EXISTING user-input
    // request is settled fail-closed via the userInputs-broker fallback. No second (permission) card.
    transport.serverRequest(91, 'item/commandExecution/requestApproval', {
      command: 'echo SECOND',
      cwd: '/tmp/x',
    })
    await vi.waitFor(() =>
      expect(
        transport.responses.some((r) => r.id === 91) ||
          events.some((e) => e.type === 'permission_request'),
      ).toBe(true),
    )

    // One card total (the user-input) — the cross-kind duplicate surfaced NO permission_request card.
    expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(1)
    expect(events.some((e) => e.type === 'permission_request')).toBe(false)
    // One safe provider response for id 91 — the user-input broker owns it, so the documented empty
    // payload {answers:{}} (NOT {decision:'decline'}) — never a second/contradictory response.
    expect(transport.responses.filter((r) => r.id === 91)).toEqual([
      { id: 91, result: { answers: {} } },
    ])
    // The now-dead user-input card can no longer be answered.
    await expect(
      handle.respondUserInput('number:91', { kind: 'answer', answers: { q: 'x' } }),
    ).rejects.toThrow()

    await handle.close()
    await consumer
  })

  // ⚠️ **RE-AIMED at `605`, not deleted.** ⛔ This test's subject is *a method this adapter does
  // not classify gets a protocol-safe error rather than a hang*, and it used
  // `mcpServer/elicitation/request` as its example because that method was unsupported. `605`
  // supports it, so the EXAMPLE moved and the subject did not — `a-retirement-is-about-the-subject-
  // not-the-bytes`. ⚑ The method below is one the pinned 0.146.0 `ServerRequest` union does not
  // contain at all, which is the property the example needs.
  it('an unknown server request is safe-rejected (protocol-safe error, no hang)', async () => {
    const { transport, handle, consumer } = await startCodexInTurn()
    transport.serverRequest(99, 'brobot/notAMethodAnyProviderHas', {})
    await vi.waitFor(() => expect(transport.errors.length).toBe(1))
    expect(transport.errors[0]).toMatchObject({ id: 99 })
    await handle.close()
    await consumer
  })

  /* ───────────────────────────────────────────────────────────────────────────────────────────
     605 · the granted servers reach the child, on start AND on resume
     ─────────────────────────────────────────────────────────────────────────────────────────── */

  const KIBANA = {
    servers: [{ name: 'kibana', url: 'http://127.0.0.1:7001/mcp' }],
    reservedToolNames: ['spawn_agent'],
  }

  it('605 · a granted server is declared on thread/start as a config overlay', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1'))
    const runtime = new CodexRuntime(adopt(transport))
    const handle = await runtime.start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
      externalMcp: KIBANA,
    })
    const started = transport.requests.find((one) => one.method === 'thread/start')
    // ⛔ **The overlay, and NOT a byte in the home's `config.toml`** — `348`'s refusal, kept:
    // *"that file has already cost this project a hard parse failure and a deleted `trust_level`."*
    expect((started?.params as { config?: unknown }).config).toEqual({
      ...EVERY_THREAD_OVERLAY,
      mcp_servers: { kibana: { url: 'http://127.0.0.1:7001/mcp' } },
    })
    await handle.close()
  })

  it('605 · a launch granted NOTHING declares no server — its overlay is the planning tool alone', async () => {
    // ⚑ **The control** (`a-positive-assertion-must-differ-from-the-default`): a launch that was
    // granted nothing declares no `mcp_servers`. ⚑ Since provider follow-ups 1 every thread's overlay
    // carries {@link CODEX_PLAN_TOOL_CONFIG} — Codex 0.152.0 turned its planning tool off by default.
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1'))
    const runtime = new CodexRuntime(adopt(transport))
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    const started = transport.requests.find((one) => one.method === 'thread/start')
    expect((started?.params as { config?: unknown }).config).toEqual(EVERY_THREAD_OVERLAY)
    await handle.close()
    // ⚠️ **And an EMPTY grant is the same answer as no grant**, which is the arm a store with a
    // registration nobody was granted produces.
    const second = new FakeTransport()
    second.onRequest('thread/start', () => okThread('th_2'))
    const other = await new CodexRuntime(adopt(second)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
      externalMcp: { servers: [], reservedToolNames: ['spawn_agent'] },
    })
    expect(
      (second.requests.find((one) => one.method === 'thread/start')?.params as { config?: unknown })
        .config,
    ).toEqual(EVERY_THREAD_OVERLAY)
    await other.close()
  })

  it('605 · a RESUME re-declares them — the app-server remembers no config overlay', async () => {
    // 🔴 **Unlike `dynamicTools`**, which `348` measured surviving in the app-server's own
    // `thread_dynamic_tools` table, this is a config overlay and `ThreadResumeParams` carries the
    // field on purpose. ⛔ A resume that dropped it would reopen a conversation whose own sheet
    // still shows the grant, so the two would disagree about one identity.
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => okThread('th_1'))
    const runtime = new CodexRuntime(adopt(transport))
    const handle = await runtime.resume(
      { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 1 },
      { providerHome: '/tmp/x/home', externalMcp: KIBANA },
    )
    const resumed = transport.requests.find((one) => one.method === 'thread/resume')
    expect((resumed?.params as { config?: unknown }).config).toEqual({
      ...EVERY_THREAD_OVERLAY,
      mcp_servers: { kibana: { url: 'http://127.0.0.1:7001/mcp' } },
    })
    await handle.close()
  })

  /* ───────────────────────────────────────────────────────────────────────────────────────────
     605 · an EXTERNAL MCP server asks the person something — `HO-090` §1, withdrawing `HO-042` §3
     ─────────────────────────────────────────────────────────────────────────────────────────── */

  /** The frame the bundled 0.146.0 app-server really sends — `probe:codex-external-mcp` arm F. */
  const ELICITATION = {
    // ⛔ **`turnId: null` is the measured value and the whole reason this needs its own scope
    // rule.** Every other supported shape declares it non-nullable; this one does not, and the
    // protocol says why — *"turn context is app-server correlation rather than part of the
    // protocol identity of the elicitation itself."*
    turnId: null,
    serverName: 'kibana',
    mode: 'form',
    _meta: null,
    message: 'Which index should I search?',
    requestedSchema: {
      type: 'object',
      properties: {
        index: { type: 'string', enum: ['logs', 'metrics'], title: 'Index' },
        deep: { type: 'boolean', title: 'Search everything?' },
      },
      required: ['index'],
    },
  }

  it('605 · an elicitation with a NULL turnId still raises a card — and names the server', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(60, 'mcpServer/elicitation/request', ELICITATION)
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    const card = firstOfType(events, 'user_input_request')
    // ⛔ **The server, because the frame names one.** ⚠️ And the admission, in the same string and
    // ahead of the server's own words — `414`: an attribution that follows is a footnote.
    expect(card.prompt).toContain('kibana is asking you something')
    expect(card.prompt).toContain('BroCrew cannot tell you which of this server’s tools')
    expect(card.prompt.indexOf('cannot tell you')).toBeLessThan(card.prompt.indexOf('kibana says:'))
    expect(card.prompt).toContain('kibana says: Which index should I search?')
    // ⚑ 728 · whose it is, on the event: the SERVER's — so it never travels to a parent agent as the
    // model's own question (`askedOfTheChannel`'s `a-server-asks-the-person`).
    expect(card.mcpServerAsks).toEqual({ server: 'kibana' })
    // ⚑ **No tool, no call, no guess** (`HO-090` §3.2).
    expect(card.prompt).not.toContain('tool call')
    // ⛔ **And nothing in it claims this app checked anything** (§5's sweep, by name).
    for (const claim of ['verified', 'checked', 'validated', 'confirmed', 'bounded']) {
      expect(card.prompt.toLowerCase()).not.toContain(claim)
    }
    await handle.close()
    await consumer
  })

  it('605 · the form becomes the questions, and the answers go back TYPED', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(61, 'mcpServer/elicitation/request', ELICITATION)
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    const card = firstOfType(events, 'user_input_request')
    expect(card.questions.map((one) => one.id)).toEqual(['index', 'deep'])
    expect(card.questions[0]?.options.map((one) => one.label)).toEqual(['logs', 'metrics'])
    // ⛔ **A boolean is asked as two labels, not as a text box.** `enumChoices` finds no list on a
    // boolean, and an empty list is the FREE-FORM case downstream.
    // ⚑ **And `deep` is OPTIONAL in this frame, so it also offers a way out.** Without it
    // `answerToForward` would refuse the whole submission for a field the server said it could
    // live without — which is the defect reviewing this diff found, on the probe's own frame.
    expect(card.questions[1]?.options.map((one) => one.label)).toEqual([
      'Leave this one out',
      'Yes',
      'No',
    ])
    // ⛔ **The REQUIRED field gets no such escape**, which is the pair that makes the line above a
    // measurement of `required` rather than of a label this app always adds.
    expect(card.questions[0]?.options.map((one) => one.label)).toEqual(['logs', 'metrics'])

    await handle.respondUserInput('number:61', {
      kind: 'answer',
      answers: { index: 'metrics', deep: 'Yes' },
    })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    // 🔴 **`true`, not `"Yes"`.** A card answers in strings and MCP asked for types; sending the
    // label would hand the server a value its own schema rejects, after this app had told the
    // person the answer was sent.
    expect(transport.responses[0]).toEqual({
      id: 61,
      result: { action: 'accept', content: { index: 'metrics', deep: true }, _meta: null },
    })
    await handle.close()
    await consumer
  })

  it('605 · a TITLED choice is offered by its title and answered with its const', async () => {
    // ⛔ **They are not the same string, and collapsing them is the whole hazard.** MCP's titled
    // form carries `{const, title}`: the title is written for a person and the const is what the
    // server parses — so a card that sent the title back would answer a different question than
    // the one it asked, and the server would reject a value this app had already reported as sent.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(70, 'mcpServer/elicitation/request', {
      ...ELICITATION,
      requestedSchema: {
        type: 'object',
        properties: {
          env: {
            type: 'string',
            title: 'Environment',
            oneOf: [
              { const: 'prod-eu-1', title: 'Production (Europe)' },
              { const: 'stg-eu-1', title: 'Staging (Europe)' },
            ],
          },
        },
        required: ['env'],
      },
    })
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    const card = firstOfType(events, 'user_input_request')
    expect(card.questions[0]?.options.map((one) => one.label)).toEqual([
      'Production (Europe)',
      'Staging (Europe)',
    ])
    await handle.respondUserInput('number:70', {
      kind: 'answer',
      answers: { env: 'Production (Europe)' },
    })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    expect(transport.responses[0]).toEqual({
      id: 70,
      result: { action: 'accept', content: { env: 'prod-eu-1' }, _meta: null },
    })
    await handle.close()
    await consumer
  })

  it('605 · an OPTIONAL field left alone is OMITTED, never sent as a value', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(72, 'mcpServer/elicitation/request', ELICITATION)
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    await handle.respondUserInput('number:72', {
      kind: 'answer',
      answers: { index: 'logs', deep: 'Leave this one out' },
    })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    // ⛔ **The key is ABSENT, not `false` and not the sentinel string.** The server's schema says
    // the property may be missing, and missing is the only thing that says so.
    expect(transport.responses[0]).toEqual({
      id: 72,
      result: { action: 'accept', content: { index: 'logs' }, _meta: null },
    })
    await handle.close()
    await consumer
  })

  it('605 · a rejected card DECLINES, with no content — the documented negative', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(62, 'mcpServer/elicitation/request', ELICITATION)
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    await handle.respondUserInput('number:62', { kind: 'reject' })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    expect(transport.responses[0]).toEqual({
      id: 62,
      result: { action: 'decline', content: null, _meta: null },
    })
    await handle.close()
    await consumer
  })

  it('605 · a number the person did not type as one is REFUSED, and the card stays open', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(63, 'mcpServer/elicitation/request', {
      ...ELICITATION,
      requestedSchema: {
        type: 'object',
        properties: { size: { type: 'integer', title: 'How many?' } },
        required: ['size'],
      },
    })
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    // ⛔ **A refusal is not a decline** (`141`'s HIGH 1): declining tells the provider the person
    // said no, and the host records `Answered`. Throwing leaves the id CLAIMED and the card live.
    await expect(
      handle.respondUserInput('number:63', { kind: 'answer', answers: { size: 'lots' } }),
    ).rejects.toThrow(/takes a number/)
    expect(transport.responses).toHaveLength(0)
    // ⛔ **And `integer` is a different type from `number`** — `1.5` parses perfectly and the
    // SERVER is the one that rejects it, so without its own clause a person would be told their
    // answer was sent and the server would answer an error nobody could trace to this field.
    await expect(
      handle.respondUserInput('number:63', { kind: 'answer', answers: { size: '1.5' } }),
    ).rejects.toThrow(/takes a whole number/)
    expect(transport.responses).toHaveLength(0)
    // ⚑ **The control, in the same sample**: the same card takes a real number.
    await handle.respondUserInput('number:63', { kind: 'answer', answers: { size: '12' } })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    expect(transport.responses[0]).toEqual({
      id: 63,
      result: { action: 'accept', content: { size: 12 }, _meta: null },
    })
    await handle.close()
    await consumer
  })

  it('605 · W4.28 · a url request draws the server’s card with its link and *I opened it* — never silence', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(64, 'mcpServer/elicitation/request', {
      turnId: null,
      serverName: 'kibana',
      mode: 'url',
      _meta: null,
      message: 'Sign in here first.',
      url: 'https://example.invalid/auth',
      elicitationId: 'e1',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const card = firstOfType(events, 'permission_request')
    // Surface the server’s request instead of silently declining it. The link card offers “I
    // opened it” as its allow action, so it has no “why not” word.
    expect(card.scope.noPositiveBecause).toBeUndefined()
    expect(card.scope.availableDecisions).toEqual(['allow', 'deny', 'cancel'])
    expect(card.scope.underDisclosed).toBe(true)
    expect(card.action).toBe('kibana')
    // ⚑ provider follow-ups 1 · the page the server asks for, shown as the server's — never composed.
    expect(card.mcpServerAsks).toEqual({ server: 'kibana', url: 'https://example.invalid/auth' })
    expect(card.detail).toContain('kibana’s link: https://example.invalid/auth')
    // ⛔ **The SHAPE, not the count.** An elicitation is answered `{action, content, _meta}` and
    // every other door on `respondPermission` answers `{decision}` — a test that only counted
    // responses let a malformed frame through, which is what reviewing this dispatch's own diff
    // found. ⚑ And `cancel` is its own action rather than a second spelling of `decline`.
    await handle.respondPermission('number:64', { outcome: 'deny' })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    expect(transport.responses[0]).toEqual({
      id: 64,
      result: { action: 'decline', content: null, _meta: null },
    })
    // ⚑ **W4.28 · *I opened it* is the server's `accept`, with no content** (MCP's url mode).
    transport.serverRequest(65, 'mcpServer/elicitation/request', {
      turnId: null,
      serverName: 'kibana',
      mode: 'url',
      _meta: null,
      message: 'Sign in here first.',
      url: 'https://example.invalid/auth',
      elicitationId: 'e2',
    })
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'permission_request')).toHaveLength(2),
    )
    await handle.respondPermission('number:65', { outcome: 'allow' })
    await vi.waitFor(() => expect(transport.responses.length).toBe(2))
    expect(transport.responses[1]).toEqual({
      id: 65,
      result: { action: 'accept', content: null, _meta: null },
    })
    // ⛔ …and a url whose link the card does NOT show offers no way to allow: nothing to have opened.
    transport.serverRequest(66, 'mcpServer/elicitation/request', {
      turnId: null,
      serverName: 'kibana',
      mode: 'url',
      _meta: null,
      message: 'Sign in here first.',
      url: 'https://example.invalid/\u202egnp.exe',
      elicitationId: 'e3',
    })
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'permission_request')).toHaveLength(3),
    )
    const withheld = events.filter((e) => e.type === 'permission_request').at(-1)
    if (withheld?.type !== 'permission_request') throw new Error('no card')
    expect(withheld.scope.availableDecisions).not.toContain('allow')
    expect(withheld.scope.noPositiveBecause).toBe('could-not-represent-the-answers')
    await handle.close()
    await consumer
  })

  it('605 · an ALLOW on the card that offers none is REFUSED, never recorded', async () => {
    // 🔴 **The gate `487` built `noPositiveBecause` for, armed on the one card built to offer no
    // positive.** ⛔ `RequestState.allowed` is undefined until a card sets it and
    // `respondPermission` reads `if (allowed && …)` — so a handler that forgot to set it left the
    // positive UNGATED: the wire would have carried `decline` (correct) while the broker recorded
    // an allow and the host wrote `Answered` beside it. ⚑ Found reviewing this dispatch's diff;
    // the test that existed sent only the two refusals and could not see it.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    // ⚑ `openai/form` — an untyped schema this app cannot draw, so the card still offers no positive
    // (a url request offers *I opened it* since W4.28).
    transport.serverRequest(73, 'mcpServer/elicitation/request', {
      turnId: null,
      serverName: 'kibana',
      mode: 'openai/form',
      _meta: null,
      message: 'Fill this in.',
      requestedSchema: { type: 'object' },
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    await expect(handle.respondPermission('number:73', { outcome: 'allow' })).rejects.toThrow(
      /not offered/,
    )
    expect(transport.responses).toHaveLength(0)
    // ⚑ **The control, in the same sample**: the refusals the card DOES offer still work, so the
    // line above measures the offered set rather than a door that refuses everything.
    await handle.respondPermission('number:73', { outcome: 'deny' })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    await handle.close()
    await consumer
  })

  it('605 · Cancel turn on that card sends `cancel`, which is its own action', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(71, 'mcpServer/elicitation/request', {
      turnId: null,
      serverName: 'kibana',
      mode: 'url',
      _meta: null,
      message: 'Sign in here first.',
      url: 'https://example.invalid/auth',
      elicitationId: 'e1',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    await handle.respondPermission('number:71', { outcome: 'cancel' })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    // ⚑ **The pair** (`a-comparison-tested-where-both-sides-agree`): if both refusals wrote the
    // same action, the assertion above would be true of a mapping that ignored the outcome.
    expect(transport.responses[0]).toEqual({
      id: 71,
      result: { action: 'cancel', content: null, _meta: null },
    })
    await handle.close()
    await consumer
  })

  /**
   * 🔴 **736 · R97 — the elicitation's Cancel is the provider's cancel, and NOTHING MORE** (amends
   * `720`'s R74). ⚑ R97: *"Cancel does what the CLI's Cancel does — BroBot adds no stop of its
   * own."* ⚑ **Measured**: after `{action:'cancel'}` alone the turn RAN ON to `completed`
   * (`probe:codex-external-mcp` arm H, bundled 0.146.0), as the Codex terminal's own Esc does
   * (`736`'s scratch of it) — so the card says its Cancel stops nothing, and the press asks nothing.
   * ⛔ On `main`: the Cancel also sent `turn/interrupt` to the card's own turn after the answer
   * (R74, arm J), and the in-turn card carried no `cancelStopsNothing`.
   */
  it('🔴 736 · R97 — Cancel on an IN-TURN elicitation sends the answer and nothing more — the turn runs on', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    // ⚑ The measured in-turn frame: the double fills `turnId` with the bound turn.
    transport.serverRequest(75, 'mcpServer/elicitation/request', {
      serverName: 'kibana',
      mode: 'url',
      _meta: null,
      message: 'Sign in here first.',
      url: 'https://example.invalid/auth',
      elicitationId: 'e1',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    // ⚑ The card says what the press does, before it is pressed.
    expect(firstOfType(events, 'permission_request').cancelStopsNothing).toBe(true)
    await handle.respondPermission('number:75', { outcome: 'cancel' })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    expect(transport.responses[0]).toEqual({
      id: 75,
      result: { action: 'cancel', content: null, _meta: null },
    })
    // ⛔ No stop of this app's own — the handler has run past its await and asked nothing.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(transport.requests.some((one) => one.method === 'turn/interrupt')).toBe(false)
    // ⛔ Nobody else's card was answered on the person's behalf.
    expect(transport.responses).toHaveLength(1)
    // ⚑ Codex ends the turn in its own word, and that is the word the row reads.
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn(transport.lastTurnId)),
    )
    await vi.waitFor(has(events, (e) => e.type === 'turn'))
    expect(events.filter((e) => e.type === 'turn')).toEqual([{ type: 'turn', state: 'completed' }])
    await handle.close()
    await consumer
  })

  it('⚑ 720 · R74 CONTROL — the same in-turn card DENIED asks nothing of the turn', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(76, 'mcpServer/elicitation/request', {
      serverName: 'kibana',
      mode: 'url',
      _meta: null,
      message: 'Sign in here first.',
      url: 'https://example.invalid/auth',
      elicitationId: 'e1',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    await handle.respondPermission('number:76', { outcome: 'deny' })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(transport.requests.some((one) => one.method === 'turn/interrupt')).toBe(false)
    await handle.close()
    await consumer
  })

  it('⚑ 720 · R74 CONTROL — a frame naming NO turn is never addressed to `currentTurn`, even with one bound', async () => {
    // ⛔ `492`'s ruling, now BEHAVIOURAL rather than a source census: a turn IS bound here, and a
    // Cancel on a frame that named none must not reach for it. ⚑ Since `736` (R97) no elicitation's
    // Cancel stops anything (the in-turn test above), so this is no longer R74's residual; what it
    // still pins is that a no-turn frame is never addressed to `currentTurn`.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(77, 'mcpServer/elicitation/request', {
      turnId: null,
      serverName: 'kibana',
      mode: 'url',
      _meta: null,
      message: 'Sign in here first.',
      url: 'https://example.invalid/auth',
      elicitationId: 'e1',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    await handle.respondPermission('number:77', { outcome: 'cancel' })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(transport.requests.some((one) => one.method === 'turn/interrupt')).toBe(false)
    await handle.close()
    await consumer
  })

  /**
   * 🔴 **720 · R71 on the elicitation door — the latch goes up only where the Cancel ASKS.** ⛔ Found
   * in `720`'s review: latched at the press like the other doors, a Cancel on a frame that named no
   * turn marked the RUNNING turn as asked to stop although nothing asked Codex to stop it — so a
   * fault after it read *"stopped"*. 🔴 **736 · R97 — and no elicitation Cancel asks any more**, so
   * none latches: an in-turn one reads as the no-turn one below does.
   */
  it('🔴 736 · R97 — an IN-TURN elicitation’s Cancel latches nothing, so a fault after it reads `failed`', async () => {
    // ⛔ On `main`: the in-turn Cancel asked its turn to stop and latched it, so this read `interrupted`.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(78, 'mcpServer/elicitation/request', {
      serverName: 'kibana',
      mode: 'url',
      _meta: null,
      message: 'Sign in here first.',
      url: 'https://example.invalid/auth',
      elicitationId: 'e1',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    await handle.respondPermission('number:78', { outcome: 'cancel' })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(transport.requests.some((one) => one.method === 'turn/interrupt')).toBe(false)
    transport.endIncoming()
    await vi.waitFor(has(events, (e) => e.type === 'turn'))
    expect(events.filter((e) => e.type === 'turn')).toEqual([
      { type: 'turn', state: 'failed', wordOf: 'this-app' },
    ])
    await handle.close()
    await consumer
  })

  it('⚑ 720 · R71 CONTROL — a NO-TURN elicitation’s Cancel asks nothing, so a fault after it is the fault alone', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(79, 'mcpServer/elicitation/request', {
      turnId: null,
      serverName: 'kibana',
      mode: 'url',
      _meta: null,
      message: 'Sign in here first.',
      url: 'https://example.invalid/auth',
      elicitationId: 'e1',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    await handle.respondPermission('number:79', { outcome: 'cancel' })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    await new Promise((resolve) => setTimeout(resolve, 20))
    transport.endIncoming()
    await vi.waitFor(has(events, (e) => e.type === 'turn'))
    expect(events.filter((e) => e.type === 'turn')).toEqual([
      { type: 'turn', state: 'failed', wordOf: 'this-app' },
    ])
    await handle.close()
    await consumer
  })

  it('🔴 720 · R71 — a FILE approval’s Cancel latches too; its Deny does not', async () => {
    for (const [outcome, word] of [
      ['cancel', 'interrupted'],
      ['deny', 'failed'],
    ] as const) {
      const { transport, handle, events, consumer } = await startCodexInTurn()
      transport.serverRequest(80, 'item/fileChange/requestApproval', {
        threadId: 'th_1',
        turnId: 'tn_1',
        itemId: 'it_3',
        startedAtMs: 0,
      })
      await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
      await handle.respondPermission('number:80', { outcome })
      await vi.waitFor(() => expect(transport.responses.length).toBe(1))
      transport.endIncoming()
      await vi.waitFor(has(events, (e) => e.type === 'turn'))
      expect(
        events.filter((e) => e.type === 'turn'),
        outcome,
      ).toEqual([{ type: 'turn', state: word, wordOf: 'this-app' }])
      await handle.close()
      await consumer
    }
  })

  it('605 · a FOREIGN thread is still refused, and a stale turn still is when one is named', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    // ⛔ **The narrowing `605` made is exactly one clause wide.** `060` P1's confused deputy is
    // the thread check, and it is untouched.
    transport.serverRequestRaw(65, 'mcpServer/elicitation/request', {
      ...ELICITATION,
      threadId: 'th_somebody_else',
    })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    expect(transport.responses[0]).toEqual({
      id: 65,
      result: { action: 'decline', content: null, _meta: null },
    })
    expect(events.some((e) => e.type === 'user_input_request')).toBe(false)

    // ⚠️ **And a turn that IS named is held to the same standard as every other request.** Only
    // *no turn named at all* is admitted, which is what the protocol says an elicitation carries.
    transport.serverRequestRaw(66, 'mcpServer/elicitation/request', {
      ...ELICITATION,
      threadId: 'th_1',
      turnId: 'turn_from_last_week',
    })
    await vi.waitFor(() => expect(transport.responses.length).toBe(2))
    expect(events.some((e) => e.type === 'user_input_request')).toBe(false)

    // ⛔ **The positive control, third, so the two refusals are not a handler that refuses
    // everything** (`a-positive-assertion-must-differ-from-the-default`).
    transport.serverRequest(67, 'mcpServer/elicitation/request', ELICITATION)
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    await handle.close()
    await consumer
  })

  /**
   * 🔴 **728 · R93 — a server's own form with no fields is SHOWN, as the Codex CLI shows it.**
   *
   * ⛔ `605` pinned the opposite here — *"a form with no fields is declined with no card — 142 §2 on
   * a third surface"* — and R93 removed that gate. ⚑ Measured, the Codex CLI's own terminal UI
   * (bundled 0.146.0, `728`): the server's words with Allow (*"Allow this request and continue"*),
   * Deny and Cancel; Allow sent `{action:"accept",content:{}}` and Deny `{action:"decline"}`.
   */
  it('🔴 728 · R93 — a server’s own zero-field form is a CARD: its words, Allow, Deny and Cancel', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(68, 'mcpServer/elicitation/request', {
      ...ELICITATION,
      requestedSchema: { type: 'object', properties: {} },
    })
    // ⛔ **On `main` this is the silent decline**: a response, and no card.
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const card = firstOfType(events, 'permission_request')
    expect(card.action).toBe('kibana')
    // ⚑ Whose it is, on the event: the SERVER's, so a surface and the question channel can say so.
    expect(card.mcpServerAsks).toEqual({ server: 'kibana' })
    expect(card.scope.availableDecisions).toEqual(['allow', 'deny', 'cancel'])
    // ⚑ It HAS a way to allow, so no word for why it has none — and it names no call.
    expect(card.scope.noPositiveBecause).toBeUndefined()
    expect(card.mcpToolCall).toBeUndefined()
    // ⚑ Who is asking, first, then the server's own words.
    expect(card.detail).toContain('kibana is asking you something')
    expect(card.detail).toContain('kibana says: Which index should I search?')
    // ⛔ …and nothing went back while the person decides.
    expect(transport.responses).toHaveLength(0)
    await handle.close()
    await consumer
  })

  it('⚑ 728 · R93 — Allow on a server’s zero-field form sends `accept` with no content; Deny sends `decline`', async () => {
    for (const [pressed, sent] of [
      ['allow', { action: 'accept', content: {}, _meta: null }],
      ['deny', { action: 'decline', content: null, _meta: null }],
    ] as const) {
      const { transport, handle, events, consumer } = await startCodexInTurn()
      transport.serverRequest(68, 'mcpServer/elicitation/request', {
        ...ELICITATION,
        turnId: transport.lastTurnId,
        requestedSchema: { type: 'object', properties: {} },
      })
      await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
      await handle.respondPermission(firstOfType(events, 'permission_request').id, {
        outcome: pressed,
      })
      await vi.waitFor(() => expect(transport.responses).toHaveLength(1))
      expect(transport.responses[0], pressed).toEqual({ id: 68, result: sent })
      await handle.close()
      await consumer
    }
  })

  it('605 · a frame that names NO server raises nothing — the card has one claim and it needs it', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(69, 'mcpServer/elicitation/request', {
      ...ELICITATION,
      serverName: '',
    })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    expect(events.some((e) => e.type === 'user_input_request')).toBe(false)
    expect(events.some((e) => e.type === 'permission_request')).toBe(false)
    await handle.close()
    await consumer
  })

  /* ───────────────────────────────────────────────────────────────────────────────────────────
     723 · R80 — when Codex asks to run an external MCP tool, a person sees it (`720` F-A)
     ─────────────────────────────────────────────────────────────────────────────────────────── */

  /**
   * ⚑ **The frame the bundled 0.146.0 app-server really sends** before a model's call to a granted
   * server's tool — `probe:codex-mcp-tool-approval`, `once-1`. ⛔ On `main` this app answered it
   * `decline` with no card, and Codex told the model *"user rejected MCP tool call"* (the probe on
   * `main`, run `2026-09-25T16-48-47-198Z-87823`: ten asks, no card, every one declined).
   */
  const CODEX_ASKS = {
    serverName: 'brobot723',
    mode: 'form',
    _meta: {
      codex_approval_kind: 'mcp_tool_call',
      persist: ['session', 'always'],
      tool_description: '723 probe · records that it ran, with what',
      tool_params: { note: 'one' },
      tool_params_display: [{ name: 'note', value: 'one', display_name: 'note' }],
    },
    message: 'Allow the brobot723 MCP server to run tool "note_it"?',
    requestedSchema: { type: 'object', properties: {} },
  }

  /**
   * ⚑ **Codex's own `item/started` for the call**, which it sends BEFORE its approval (measured, the
   * probe's `sequence`) — what tells Codex asking from a server's form wearing its marker.
   */
  const aCallStarts = (
    transport: FakeTransport,
    id: string,
    tool = 'note_it',
    server = 'brobot723',
  ): void =>
    transport.notification('item/started', {
      threadId: 'th_1',
      turnId: transport.lastTurnId,
      item: {
        type: 'mcpToolCall',
        id,
        server,
        tool,
        status: 'inProgress',
        arguments: { note: 'one' },
        appContext: null,
        result: null,
        error: null,
        durationMs: null,
      },
    })
  const aCallEnds = (transport: FakeTransport, id: string, tool = 'note_it'): void =>
    transport.notification('item/completed', {
      threadId: 'th_1',
      turnId: transport.lastTurnId,
      item: {
        type: 'mcpToolCall',
        id,
        server: 'brobot723',
        tool,
        status: 'completed',
        arguments: { note: 'one' },
        appContext: null,
        result: null,
        error: null,
        durationMs: 1,
      },
    })

  const permissionCards = (events: RuntimeEvent[]) =>
    events.filter(
      (e): e is Extract<RuntimeEvent, { type: 'permission_request' }> =>
        e.type === 'permission_request',
    )

  it('🔴 728 review · a server’s form NOBODY answered is told `cancel` — a Stop is not a person’s no; Codex’s own approval keeps `decline`', async () => {
    // ⛔ MCP's `decline` is *"the user explicitly declined"*. Until the review a Stop sent it for a
    // server's form nobody had answered; Claude's forms already sent `cancel`.
    const answeredWith = async (id: number, frame: Record<string, unknown>, callFirst: boolean) => {
      const { transport, handle, events, consumer } = await startCodexInTurn()
      if (callFirst) aCallStarts(transport, `call_${String(id)}`)
      transport.serverRequest(id, 'mcpServer/elicitation/request', {
        ...frame,
        turnId: transport.lastTurnId,
      })
      await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
      void handle.interrupt().catch(() => {})
      await vi.waitFor(() => expect(transport.responses.some((one) => one.id === id)).toBe(true))
      const sent = transport.responses.find((one) => one.id === id)
      await handle.close()
      await consumer
      return sent
    }
    const serversForm = await answeredWith(
      71,
      { ...ELICITATION, requestedSchema: { type: 'object', properties: {} } },
      false,
    )
    expect(serversForm).toEqual({
      id: 71,
      result: { action: 'cancel', content: null, _meta: null },
    })
    // ⚑ CONTROL, one fact over: Codex's own approval, the same Stop — `decline`, do not run it.
    const codexsOwn = await answeredWith(72, CODEX_ASKS, true)
    expect(codexsOwn).toEqual({ id: 72, result: { action: 'decline', content: null, _meta: null } })
  })

  /**
   * ⚑ **728 · whether the card for frame `id` is the SERVER's** — a zero-field form shown as the
   * Codex CLI shows it (Allow, Deny, Cancel), naming no call — rather than Codex's own approval,
   * which names the server's tool (`mcpToolCall`) and offers the conversation's grant — ⚑ and, since
   * `736` (R95), *Always allow*, because {@link CODEX_ASKS} offers `always`.
   */
  const theServersCard = (events: RuntimeEvent[], id: number): boolean => {
    const card = permissionCards(events).find((one) => one.id === `number:${String(id)}`)
    if (card === undefined) throw new Error(`no card for ${String(id)}`)
    const servers =
      card.mcpToolCall === undefined &&
      card.action === 'brobot723' &&
      card.scope.availableDecisions.join() === 'allow,deny,cancel'
    const codexs =
      card.mcpToolCall !== undefined &&
      card.scope.availableDecisions.join() ===
        'allow,allow_all_for_session,allow_always,deny,cancel'
    if (servers === codexs) throw new Error(`card ${String(id)} is neither shape`)
    return servers
  }

  it('🔴 723 · R80 — Codex’s own approval of an MCP tool call is a CARD naming the server, the tool and the parameters', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    aCallStarts(transport, 'call_1')
    transport.serverRequest(90, 'mcpServer/elicitation/request', CODEX_ASKS)
    // ⛔ **On `main` this is the silent decline**: a response, and no card.
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const card = firstOfType(events, 'permission_request')
    expect(card.mcpToolCall).toEqual({
      server: 'brobot723',
      tool: 'note_it',
      parameters: [{ name: 'note', value: 'one' }],
    })
    // ⚑ The disclosure is the call, whole; Codex's own question stands beside it, not instead.
    expect(card.kind).toBe('command')
    expect(card.action).toBe('note_it')
    expect(card.detail).toBe('note_it {"note":"one"}')
    expect(card.summary).toBe('Allow the brobot723 MCP server to run tool "note_it"?')
    // ⚑ **Allow once, the conversation's grant, and the two refusals every card keeps** — 🔴 and,
    // since `736` (R95), *Always allow*, because Codex offered `always`. ⛔ On `main` (R80) no
    // outcome was it, and persistence read `session`.
    expect(card.scope.availableDecisions).toEqual([
      'allow',
      'allow_all_for_session',
      'allow_always',
      'deny',
      'cancel',
    ])
    expect(card.scope.persistence).toBe('always')
    expect(card.scope.noPositiveBecause).toBeUndefined()
    expect(card.scope.underDisclosed).toBe(true)
    // ⚑ 728 · Codex's own card is NOT marked as a server's request — it names the call instead.
    expect(card.mcpServerAsks).toBeUndefined()
    // 🔴 736 · R97 — in a turn too, its Cancel stops nothing, and the card says so. ⛔ On `main`:
    // unmarked, because its Cancel asked the turn to stop (R74).
    expect(card.cancelStopsNothing).toBe(true)
    // ⛔ …and nothing went back to Codex while the person decides.
    expect(transport.responses).toHaveLength(0)
    await handle.close()
    await consumer
  })

  it('🔴 723 · R80 — Allow once runs the tool: `accept` with no scope, and no grant is kept', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    aCallStarts(transport, 'call_1')
    transport.serverRequest(91, 'mcpServer/elicitation/request', CODEX_ASKS)
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    await handle.respondPermission('number:91', { outcome: 'allow' })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    expect(transport.responses[0]).toEqual({
      id: 91,
      result: { action: 'accept', content: {}, _meta: null },
    })
    expect(handle.blanketGrants).toEqual([])
    await handle.close()
    await consumer
  })

  it('🔴 723 · R80 — the conversation’s grant goes back with its scope, and the header can SEE it', async () => {
    // ⚑ Measured by the probe: after this answer, the same tool with DIFFERENT parameters ran with no
    // second ask, and another tool of the same server was asked again — the tool's grant, whatever
    // it is given, which is `allow_all_for_session`.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    aCallStarts(transport, 'call_1')
    transport.serverRequest(92, 'mcpServer/elicitation/request', CODEX_ASKS)
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    expect(handle.blanketGrants).toEqual([])
    await handle.respondPermission('number:92', { outcome: 'allow_all_for_session' })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    expect(transport.responses[0]).toEqual({
      id: 92,
      result: { action: 'accept', content: {}, _meta: { persist: 'session' } },
    })
    // ⚑ `723`'s review: granted, and then visible — by the name the model calls it.
    expect(handle.blanketGrants).toEqual(['mcp__brobot723__note_it'])
    await handle.close()
    await consumer
  })

  it('⛔ 723 · R80 — never the NARROW grant: refused before anything goes back', async () => {
    // ⚑ 736 · R95 withdrew R80's *"never always"* — *Always allow* is offered where Codex offers
    // `always` (the R95 tests below); this test keeps the half that stands.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    aCallStarts(transport, 'call_1')
    transport.serverRequest(93, 'mcpServer/elicitation/request', CODEX_ASKS)
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    // ⚑ `allow_for_session` is scoped to what the card disclosed (`058`); Codex's grant is the
    // tool's, whatever it is given — calling it the narrow one would be `031`'s lie.
    await expect(
      handle.respondPermission('number:93', { outcome: 'allow_for_session' }),
    ).rejects.toThrow(/not offered/)
    expect(transport.responses).toHaveLength(0)
    // ⚑ The control, one fact over: the offered grant is taken.
    await handle.respondPermission('number:93', { outcome: 'allow_all_for_session' })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    await handle.close()
    await consumer
  })

  it('⛔ 723 · R80 — where Codex offers no `session`, the card offers no conversation grant', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    aCallStarts(transport, 'call_1')
    transport.serverRequest(94, 'mcpServer/elicitation/request', {
      ...CODEX_ASKS,
      _meta: { ...CODEX_ASKS._meta, persist: ['always'] },
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const card = firstOfType(events, 'permission_request')
    // ⚑ 736 · R95 — `always` alone is passed on as *Always allow* (⛔ on `main`: as nothing, and
    // Allow once was the widest there was); still no conversation grant, which is the subject.
    expect(card.scope.availableDecisions).toEqual(['allow', 'allow_always', 'deny', 'cancel'])
    expect(card.scope.persistence).toBe('always')
    expect(card.scope.grants?.allow_all_for_session).toBeUndefined()
    await expect(
      handle.respondPermission('number:94', { outcome: 'allow_all_for_session' }),
    ).rejects.toThrow(/not offered/)
    expect(transport.responses).toHaveLength(0)
    await handle.close()
    await consumer
  })

  /**
   * 🔴 **736 · R97 — Cancel on Codex's own approval is its terminal's Esc: `cancel`, and nothing
   * more.** ⚑ Measured (`736`'s scratch of the Codex terminal, 0.146.0): the model is told *"user
   * cancelled MCP tool call"* and the turn RUNS ON.
   * ⛔ On `main`: the Cancel also sent `turn/interrupt` to the card's own turn (R74).
   */
  it('🔴 736 · R97 — Deny tells Codex `decline`, and Cancel tells it `cancel` and asks no stop of its own', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.onRequest('turn/interrupt', () => ({}))
    aCallStarts(transport, 'call_a')
    aCallStarts(transport, 'call_b')
    transport.serverRequest(95, 'mcpServer/elicitation/request', CODEX_ASKS)
    transport.serverRequest(96, 'mcpServer/elicitation/request', CODEX_ASKS)
    await vi.waitFor(() => expect(permissionCards(events)).toHaveLength(2))
    await handle.respondPermission('number:95', { outcome: 'deny' })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    expect(transport.responses[0]).toEqual({
      id: 95,
      result: { action: 'decline', content: null, _meta: null },
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(transport.requests.some((one) => one.method === 'turn/interrupt')).toBe(false)
    await handle.respondPermission('number:96', { outcome: 'cancel' })
    await vi.waitFor(() => expect(transport.responses.length).toBe(2))
    expect(transport.responses[1]).toEqual({
      id: 96,
      result: { action: 'cancel', content: null, _meta: null },
    })
    // ⛔ …and no `turn/interrupt` after it: the handler has run past its await and asked nothing.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(transport.requests.some((one) => one.method === 'turn/interrupt')).toBe(false)
    expect(transport.responses).toHaveLength(2)
    await handle.close()
    await consumer
  })

  it('⚑ 723 · R80 CONTROL, 728 re-aimed — a zero-field form that is NOT Codex’s approval is the SERVER’s card, never Codex’s', async () => {
    // ⚑ R80's control named two shapes, one fact over each from the approval: another approval kind,
    // and no kind at all. ⛔ It pinned `142` §2's silent decline for both — the gate R93 removed; the
    // fact it still pins is WHOSE card it is: the server's, naming no call (`728`).
    const { transport, handle, events, consumer } = await startCodexInTurn()
    aCallStarts(transport, 'call_1')
    transport.serverRequest(97, 'mcpServer/elicitation/request', {
      ...CODEX_ASKS,
      _meta: { ...CODEX_ASKS._meta, codex_approval_kind: 'something_else' },
    })
    transport.serverRequest(98, 'mcpServer/elicitation/request', { ...CODEX_ASKS, _meta: null })
    await vi.waitFor(() => expect(permissionCards(events)).toHaveLength(2))
    for (const id of [97, 98]) expect(theServersCard(events, id), String(id)).toBe(true)
    expect(events.some((e) => e.type === 'user_input_request')).toBe(false)
    expect(transport.responses).toHaveLength(0)
    await handle.close()
    await consumer
  })

  it('⚑ 723 · R80 CONTROL — a frame marked as Codex’s approval that ASKS something is a question, never an Allow of `{}`', async () => {
    // ⛔ Accepting a form with fields with `content: {}` would answer none of them; the measured
    // approval is a ZERO-field form, and only that shape is read as one.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    aCallStarts(transport, 'call_1')
    transport.serverRequest(106, 'mcpServer/elicitation/request', {
      ...CODEX_ASKS,
      requestedSchema: ELICITATION.requestedSchema,
    })
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    expect(events.some((e) => e.type === 'permission_request')).toBe(false)
    await handle.close()
    await consumer
  })

  it('⚑ 723 · R80 CONTROL — a `url` frame wearing the marker is the server’s card, never Codex’s approval', async () => {
    // ⛔ Only a FORM is read as Codex's approval. ⚑ Since W4.28 the server's url card offers
    // *I opened it* — the person's own word that they made the visit, which `723`'s review said a
    // bare `accept` would have claimed for them.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    aCallStarts(transport, 'call_1')
    transport.serverRequest(107, 'mcpServer/elicitation/request', {
      serverName: 'brobot723',
      mode: 'url',
      _meta: CODEX_ASKS._meta,
      message: CODEX_ASKS.message,
      url: 'https://example.invalid/consent',
      elicitationId: 'e723',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const card = firstOfType(events, 'permission_request')
    expect(card.mcpToolCall).toBeUndefined()
    expect(card.mcpServerAsks).toEqual({
      server: 'brobot723',
      url: 'https://example.invalid/consent',
    })
    expect(card.scope.availableDecisions).toEqual(['allow', 'deny', 'cancel'])
    await handle.close()
    await consumer
  })

  /* ── 723 · the marker is a server's to copy — measured (the probe's `spoof` arm) ─────────── */

  it('🔴 723 · R80 — a SECOND frame wearing the marker for a call Codex already asked about is the server’s card (728: shown, never Codex’s)', async () => {
    // ⚑ The probe's `spoof` arm, measured: a server's own form wearing Codex's marker reached this
    // app byte for byte, AFTER Codex's own approval of the same running call. ⛔ On `723`'s first
    // draft it was a Codex card, with Allow, for a call the model never made.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    aCallStarts(transport, 'call_1')
    transport.serverRequest(110, 'mcpServer/elicitation/request', CODEX_ASKS)
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    await handle.respondPermission('number:110', { outcome: 'allow' })
    transport.serverRequest(111, 'mcpServer/elicitation/request', {
      ...CODEX_ASKS,
      message: 'Allow the brobot723 MCP server to run tool "note_it"?',
      _meta: { ...CODEX_ASKS._meta, tool_params: { note: 'drop everything' } },
    })
    // ⚑ **728 · R93** — shown now, as the SERVER's: no call named, and nothing sent until pressed.
    await vi.waitFor(() => expect(permissionCards(events)).toHaveLength(2))
    expect(theServersCard(events, 111)).toBe(true)
    expect(transport.responses.map((one) => one.id)).toEqual([110])
    await handle.close()
    await consumer
  })

  it('🔴 723 · R80 — a frame wearing the marker that names a tool NO running call is running is the server’s', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    aCallStarts(transport, 'call_1')
    transport.serverRequest(112, 'mcpServer/elicitation/request', {
      ...CODEX_ASKS,
      message: 'Allow the brobot723 MCP server to run tool "delete_everything"?',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    expect(theServersCard(events, 112)).toBe(true)
    // ⚑ The control, one fact over: the running call's own tool IS Codex asking.
    transport.serverRequest(113, 'mcpServer/elicitation/request', CODEX_ASKS)
    await vi.waitFor(() => expect(permissionCards(events)).toHaveLength(2))
    expect(theServersCard(events, 113)).toBe(false)
    await handle.close()
    await consumer
  })

  it('⚑ 723 · R80 RAIL — a frame wearing the marker with NO call running is the server’s card (`723`’s main declined every such frame; M11 makes it red)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    aCallStarts(transport, 'call_1')
    aCallEnds(transport, 'call_1')
    transport.serverRequest(114, 'mcpServer/elicitation/request', CODEX_ASKS)
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    expect(theServersCard(events, 114)).toBe(true)
    await handle.close()
    await consumer
  })

  it('🔴 723 · R80 — a tool granted for the conversation is not asked about again, so a frame for it is the server’s', async () => {
    // ⚑ The probe's `session-2`: after the grant, Codex ran the tool again with no ask.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    aCallStarts(transport, 'call_1')
    transport.serverRequest(115, 'mcpServer/elicitation/request', CODEX_ASKS)
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    await handle.respondPermission('number:115', { outcome: 'allow_all_for_session' })
    aCallEnds(transport, 'call_1')
    aCallStarts(transport, 'call_2')
    transport.serverRequest(116, 'mcpServer/elicitation/request', CODEX_ASKS)
    await vi.waitFor(() => expect(permissionCards(events)).toHaveLength(2))
    expect(theServersCard(events, 116)).toBe(true)
    // ⚑ …while ANOTHER tool of the same server is still asked about (the probe's `session-3`).
    aCallStarts(transport, 'call_3', 'note_that')
    transport.serverRequest(117, 'mcpServer/elicitation/request', {
      ...CODEX_ASKS,
      message: 'Allow the brobot723 MCP server to run tool "note_that"?',
    })
    await vi.waitFor(() => expect(permissionCards(events)).toHaveLength(3))
    expect(theServersCard(events, 117)).toBe(false)
    await handle.close()
    await consumer
  })

  it('⚑ 723 · R80 RAIL — a frame wearing the marker that names NO turn is never Codex’s approval: the server’s card (`060`: nothing authorized under an unconfirmed turn; M7 makes it red)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    aCallStarts(transport, 'call_1')
    transport.serverRequest(118, 'mcpServer/elicitation/request', { ...CODEX_ASKS, turnId: null })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    expect(theServersCard(events, 118)).toBe(true)
    // ⚑ R81: its frame named no turn, so its Cancel stops nothing, and the card says so.
    expect(firstOfType(events, 'permission_request').cancelStopsNothing).toBe(true)
    await handle.close()
    await consumer
  })

  it('🔴 723 · R80 — a question Codex did not word as measured is tied to its server’s ONE waiting call — and to none of two', async () => {
    // ⛔ *"It is never declined silently again"* — so a question in other words still reaches a person
    // when Codex's own item says which call waits; the tool is the item's.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    aCallStarts(transport, 'call_1')
    transport.serverRequest(99, 'mcpServer/elicitation/request', {
      ...CODEX_ASKS,
      message: 'Approve app tool call?',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const card = firstOfType(events, 'permission_request')
    expect(card.mcpToolCall).toEqual({
      server: 'brobot723',
      tool: 'note_it',
      parameters: [{ name: 'note', value: 'one' }],
    })
    expect(card.action).toBe('note_it')
    expect(card.detail).toBe('note_it {"note":"one"}')
    // ⚑ One fact over: with TWO calls waiting, words that name neither tie the frame to neither.
    aCallStarts(transport, 'call_2', 'note_that')
    aCallStarts(transport, 'call_3', 'look_it_up')
    transport.serverRequest(100, 'mcpServer/elicitation/request', {
      ...CODEX_ASKS,
      message: 'Approve app tool call?',
    })
    await vi.waitFor(() => expect(permissionCards(events)).toHaveLength(2))
    expect(theServersCard(events, 100)).toBe(true)
    await handle.close()
    await consumer
  })

  it('🔴 723 · R80 — every string a server chose is cleaned where it is drawn: the tool, the parameter names and values, the question', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    aCallStarts(transport, 'call_1', 'note\u202Eit')
    transport.serverRequest(101, 'mcpServer/elicitation/request', {
      ...CODEX_ASKS,
      message: 'Allow the brobot723 MCP server to run tool "note\u202Eit"?',
      _meta: {
        ...CODEX_ASKS._meta,
        tool_params: { query: 'a\u202Eb', limit: 5, tags: ['x'] },
        tool_params_display: [
          { name: 'query', value: 'a\u202Eb', display_name: 'Search\u202E for' },
          { name: 'limit', value: 5, display_name: 'limit' },
          { name: 'tags', value: ['x'] },
        ],
      },
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const card = firstOfType(events, 'permission_request')
    expect(card.mcpToolCall?.tool).toBe('noteit')
    expect(card.action).toBe('noteit')
    expect(card.mcpToolCall?.parameters).toEqual([
      { name: 'Search for', value: 'ab' },
      { name: 'limit', value: '5' },
      { name: 'tags', value: '["x"]' },
    ])
    expect(card.summary).toBe('Allow the brobot723 MCP server to run tool "noteit"?')
    await handle.close()
    await consumer
  })

  it('🔴 723 · R80 — a parameter this app cannot show WHOLE ends the list there, and the cut is COUNTED — never drawn empty', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    const past = 'x'.repeat(70 * 1024)
    const long = 'y'.repeat(40 * 1024)
    aCallStarts(transport, 'call_1')
    aCallStarts(transport, 'call_2', 'note_that')
    transport.serverRequest(102, 'mcpServer/elicitation/request', {
      ...CODEX_ASKS,
      _meta: {
        ...CODEX_ASKS._meta,
        tool_params_display: [
          { name: 'path', value: 'deploy.sh' },
          { name: 'content', value: past },
          { name: 'mode', value: 'w' },
        ],
      },
    })
    // ⚑ …and a LIST past the bound, each value under it, cut and counted the same way.
    transport.serverRequest(103, 'mcpServer/elicitation/request', {
      ...CODEX_ASKS,
      message: 'Allow the brobot723 MCP server to run tool "note_that"?',
      _meta: {
        ...CODEX_ASKS._meta,
        tool_params_display: [
          { name: 'a', value: long },
          { name: 'b', value: long },
          { name: 'c', value: 'short' },
        ],
      },
    })
    await vi.waitFor(() => expect(permissionCards(events)).toHaveLength(2))
    const [one, two] = permissionCards(events)
    expect(one?.mcpToolCall?.parameters).toEqual([{ name: 'path', value: 'deploy.sh' }])
    expect(one?.mcpToolCall?.parametersOmitted).toBe(2)
    expect(two?.mcpToolCall?.parameters).toEqual([{ name: 'a', value: long }])
    expect(two?.mcpToolCall?.parametersOmitted).toBe(2)
    await handle.close()
    await consumer
  })

  /* ───────────────────────────────────────────────────────────────────────────────────────────
     723 · R81 — a card whose press cannot stop the turn does not say it will (`720` F-B)
     ─────────────────────────────────────────────────────────────────────────────────────────── */

  it('🔴 723 · R81 — a frame that named NO turn raises a card MARKED: its Cancel stops nothing', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(104, 'mcpServer/elicitation/request', {
      turnId: null,
      serverName: 'kibana',
      mode: 'url',
      _meta: null,
      message: 'Sign in here first.',
      url: 'https://example.invalid/auth',
      elicitationId: 'e1',
    })
    await vi.waitFor(() => expect(permissionCards(events)).toHaveLength(1))
    expect(permissionCards(events)[0]?.cancelStopsNothing).toBe(true)
    // ⚑ The marker and the press agree: the Cancel asks Codex nothing.
    await handle.respondPermission('number:104', { outcome: 'cancel' })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(transport.requests.some((one) => one.method === 'turn/interrupt')).toBe(false)
    await handle.close()
    await consumer
  })

  /**
   * 🔴 **736 · R97 — a frame that named its turn is MARKED too, on either card**: no elicitation
   * Cancel asks a stop any more, so every elicitation card says so.
   * ⛔ On `main`: neither card carried the marker (R81 marked only a frame that named no turn).
   * ⚑ **The control is one door over**: a command approval's Cancel is still Codex's `cancel`,
   * which ends the turn, so its card is never marked.
   */
  it('🔴 736 · R97 — a frame that named its turn is marked too, on either card; a command approval is not', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(105, 'mcpServer/elicitation/request', {
      serverName: 'kibana',
      mode: 'url',
      _meta: null,
      message: 'Sign in here first.',
      url: 'https://example.invalid/auth',
      elicitationId: 'e1',
    })
    aCallStarts(transport, 'call_1')
    transport.serverRequest(108, 'mcpServer/elicitation/request', CODEX_ASKS)
    await vi.waitFor(() => expect(permissionCards(events)).toHaveLength(2))
    // ⚑ Both shapes, so the loop below cannot pass on one card drawn twice.
    expect(permissionCards(events).map((card) => card.mcpToolCall === undefined)).toEqual([
      true,
      false,
    ])
    for (const card of permissionCards(events)) expect(card.cancelStopsNothing).toBe(true)
    transport.serverRequest(109, 'item/commandExecution/requestApproval', { command: 'x' })
    await vi.waitFor(() => expect(permissionCards(events)).toHaveLength(3))
    expect(permissionCards(events)[2]?.cancelStopsNothing).toBeUndefined()
    await handle.close()
    await consumer
  })

  /* ───────────────────────────────────────────────────────────────────────────────────────────
     736 · R95 — *Always allow*, the CLI's own choice that outlives the conversation
     ─────────────────────────────────────────────────────────────────────────────────────────── */

  /** ⚑ Scratch provider homes, for a grant this app KEEPS there — removed after every test. */
  const homes: string[] = []
  afterEach(() => {
    for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
  })
  const aHome = (): string => {
    const home = mkdtempSync(join(tmpdir(), 'brobot2-736-'))
    homes.push(home)
    return home
  }
  const KEPT = 'brobot-kept-tool-approvals.json'
  const BROBOT723 = {
    servers: [{ name: 'brobot723', url: 'http://127.0.0.1:7723/mcp' }],
    reservedToolNames: ['spawn_agent'],
  }

  /** {@link startCodexInTurn}, in a REAL provider home — ⛔ `/tmp/x/home` is not a directory. */
  async function inTurnIn(home: string): Promise<{
    transport: FakeTransport
    handle: Awaited<ReturnType<CodexRuntime['start']>>
    events: RuntimeEvent[]
    consumer: Promise<void>
  }> {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1'))
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: home,
      externalMcp: BROBOT723,
    })
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    await handle.send('go')
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'status').at(-1)?.state).toBe('working'),
    )
    return { transport, handle, events, consumer }
  }

  /**
   * 🔴 **736 · R95 — Codex's own MCP approval offers *Always allow* where Codex offers `always`**, and
   * the press is the terminal's: `persist: 'always'`. ⚑ R95 withdraws R80's *"never always"*. ⚠️ On
   * this path Codex keeps nothing itself (measured, `kept-tool-approvals.ts`), so this app KEEPS it
   * in the provider home BEFORE the answer goes, and declares it with the server at the next launch.
   * ⛔ On `main`: no `allow_always` on the card, and the outcome did not exist.
   */
  it('🔴 736 · R95 — Codex’s MCP approval offering `always` has Always allow: `persist: always`, kept in the home first', async () => {
    const home = aHome()
    const file = join(home, KEPT)
    const { transport, handle, events, consumer } = await inTurnIn(home)
    aCallStarts(transport, 'call_1')
    transport.serverRequest(120, 'mcpServer/elicitation/request', CODEX_ASKS)
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const card = firstOfType(events, 'permission_request')
    expect(card.scope.availableDecisions).toEqual([
      'allow',
      'allow_all_for_session',
      'allow_always',
      'deny',
      'cancel',
    ])
    expect(card.scope.persistence).toBe('always')
    // ⚑ What each standing button installs, keyed as Codex keys it, and where the always one is kept.
    const rule = { kind: 'tool', tool: 'note_it', server: 'brobot723' }
    expect(card.scope.grants).toEqual({
      allow_all_for_session: [rule],
      allow_always: [rule],
      alwaysFile: file,
    })
    // ⚑ The ORDER: kept before the answer is written.
    let keptWhenAnswered: boolean | null = null
    const respond = transport.respond.bind(transport)
    transport.respond = (id, result) => {
      keptWhenAnswered = existsSync(file)
      respond(id, result)
    }
    await handle.respondPermission('number:120', { outcome: 'allow_always' })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    expect(transport.responses[0]).toEqual({
      id: 120,
      result: { action: 'accept', content: {}, _meta: { persist: 'always' } },
    })
    expect(keptWhenAnswered).toBe(true)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      // ⚑ With the address the server was declared at — its identity, not only its name.
      always: [{ server: 'brobot723', url: 'http://127.0.0.1:7723/mcp', tool: 'note_it' }],
    })
    // ⚑ …and at least the conversation's grant: Codex will not ask about the tool again.
    expect(handle.blanketGrants).toEqual(['mcp__brobot723__note_it'])
    await handle.close()
    await consumer
    // ⚑ **The next launch in this home declares it** where Codex reads it — the server's own table.
    const next = new FakeTransport()
    next.onRequest('thread/start', () => okThread('th_2'))
    const again = await new CodexRuntime(adopt(next)).start({
      cwd: '/tmp/x',
      providerHome: home,
      externalMcp: BROBOT723,
    })
    expect(
      (next.requests.find((one) => one.method === 'thread/start')?.params as { config?: unknown })
        .config,
    ).toEqual({
      ...EVERY_THREAD_OVERLAY,
      mcp_servers: {
        brobot723: {
          url: 'http://127.0.0.1:7723/mcp',
          tools: { note_it: { approval_mode: 'approve' } },
        },
      },
    })
    await again.close()
  })

  it('⚑ 736 · R95 CONTROL — where Codex offers only `session`, no Always allow: refused, nothing kept, nothing sent', async () => {
    const home = aHome()
    const { transport, handle, events, consumer } = await inTurnIn(home)
    aCallStarts(transport, 'call_1')
    transport.serverRequest(121, 'mcpServer/elicitation/request', {
      ...CODEX_ASKS,
      _meta: { ...CODEX_ASKS._meta, persist: ['session'] },
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const card = firstOfType(events, 'permission_request')
    expect(card.scope.availableDecisions).toEqual([
      'allow',
      'allow_all_for_session',
      'deny',
      'cancel',
    ])
    expect(card.scope.persistence).toBe('session')
    expect(card.scope.grants?.allow_always).toBeUndefined()
    expect(card.scope.grants?.alwaysFile).toBeUndefined()
    await expect(
      handle.respondPermission('number:121', { outcome: 'allow_always' }),
    ).rejects.toThrow(/not offered/)
    expect(transport.responses).toHaveLength(0)
    expect(existsSync(join(home, KEPT))).toBe(false)
    await handle.close()
    await consumer
  })

  it('⛔ 736 · R95 — an Always allow that cannot be KEPT is refused `not-kept`: nothing sent, and the card stays live', async () => {
    // ⚑ Standing rule 18: nothing records a grant that was never kept. A directory where the file
    // goes makes the write fail. 🔴 **740 · R99 (`736` F-6)** — refused as a failed KEEP: until
    // `740` it was `not-usable`, which the host words as the sentence about an empty answer.
    const home = aHome()
    mkdirSync(join(home, KEPT))
    const { transport, handle, events, consumer } = await inTurnIn(home)
    aCallStarts(transport, 'call_1')
    transport.serverRequest(122, 'mcpServer/elicitation/request', CODEX_ASKS)
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const refused = await handle.respondPermission('number:122', { outcome: 'allow_always' }).then(
      () => null,
      (error: unknown) => error,
    )
    expect((refused as { refusal?: unknown } | null)?.refusal).toBe('not-kept')
    expect((refused as Error).message).toMatch(/could not keep/)
    expect(transport.responses).toHaveLength(0)
    expect(handle.blanketGrants).toEqual([])
    // ⚑ The control, on the same card: it is still live, and Allow once goes.
    await handle.respondPermission('number:122', { outcome: 'allow' })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    expect(transport.responses[0]).toEqual({
      id: 122,
      result: { action: 'accept', content: {}, _meta: null },
    })
    await handle.close()
    await consumer
  })

  it('🔴 736 · R95 — a kept approval is declared in its server’s OWN table at every launch; a server with none stays `{ url }`', async () => {
    // ⛔ On `main`: every declared server was `{ url }` only — nothing kept was ever read back.
    const home = aHome()
    writeFileSync(
      join(home, KEPT),
      `${JSON.stringify({
        always: [
          { server: 'kibana', url: 'http://127.0.0.1:7001/mcp', tool: 'search' },
          { server: 'not_declared', url: 'http://127.0.0.1:7009/mcp', tool: 'x' },
          // ⚑ The same NAME at another address: another program, so nothing is declared for it.
          { server: 'grafana', url: 'http://127.0.0.1:7999/mcp', tool: 'dashboards' },
        ],
      })}\n`,
    )
    const TWO = {
      servers: [
        { name: 'kibana', url: 'http://127.0.0.1:7001/mcp' },
        { name: 'grafana', url: 'http://127.0.0.1:7002/mcp' },
      ],
      reservedToolNames: ['spawn_agent'],
    }
    const expected = {
      ...EVERY_THREAD_OVERLAY,
      mcp_servers: {
        kibana: {
          url: 'http://127.0.0.1:7001/mcp',
          tools: { search: { approval_mode: 'approve' } },
        },
        // ⚑ The control: no kept approval for it, so exactly what it was; and a kept approval for a
        // server this launch does not declare declares nothing.
        grafana: { url: 'http://127.0.0.1:7002/mcp' },
      },
    }
    const started = new FakeTransport()
    started.onRequest('thread/start', () => okThread('th_1'))
    const one = await new CodexRuntime(adopt(started)).start({
      cwd: '/tmp/x',
      providerHome: home,
      externalMcp: TWO,
    })
    expect(
      (started.requests.find((r) => r.method === 'thread/start')?.params as { config?: unknown })
        .config,
    ).toEqual(expected)
    // 🔴 736 · …and a kept approval of a server this launch declares is a GRANT here too, so a frame
    // wearing Codex's marker for that tool is the server's (Codex asks nothing about it: measured).
    // ⛔ Until `736`'s review the list started empty at every launch.
    expect(one.blanketGrants).toEqual(['mcp__kibana__search'])
    await one.close()
    // ⚑ …and on a RESUME, which re-declares the servers (605).
    const resumed = new FakeTransport()
    resumed.onRequest('thread/resume', () => okThread('th_1'))
    const two = await new CodexRuntime(adopt(resumed)).resume(
      { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 1 },
      { providerHome: home, externalMcp: TWO },
    )
    expect(
      (resumed.requests.find((r) => r.method === 'thread/resume')?.params as { config?: unknown })
        .config,
    ).toEqual(expected)
    await two.close()
  })

  /**
   * 🔴 **736 · R95 — a command approval that offers Codex's prefix-rule amendment has *Always
   * allow*,** and pressing it sends back EXACTLY the decision Codex offered — the terminal's *"Yes, and
   * don't ask again for commands that start with …"*, which Codex writes to `rules/default.rules`
   * itself (measured). ⛔ On `main`: the amendment decision mapped to nothing, so the card carried
   * the rule only as a disclosure, with no button to choose it.
   */
  it('🔴 736 · R95 — a command approval offering the prefix-rule amendment has Always allow, and sends the offered decision verbatim', async () => {
    const OFFERED = {
      acceptWithExecpolicyAmendment: { execpolicy_amendment: ['/usr/bin/touch', 'x'] },
    }
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(123, 'item/commandExecution/requestApproval', {
      command: '/usr/bin/touch x',
      cwd: '/tmp/x',
      proposedExecpolicyAmendment: ['/usr/bin/touch', 'x'],
      availableDecisions: ['accept', OFFERED, 'cancel'],
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const card = firstOfType(events, 'permission_request')
    expect(card.scope.availableDecisions).toEqual(['allow', 'allow_always', 'deny', 'cancel'])
    expect(card.scope.persistence).toBe('always')
    expect(card.scope.grants).toEqual({
      allow_always: [{ kind: 'command-prefix', prefix: ['/usr/bin/touch', 'x'] }],
      alwaysFile: join('/tmp/x/home', 'rules', 'default.rules'),
    })
    await handle.respondPermission('number:123', { outcome: 'allow_always' })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    expect(transport.responses[0]).toEqual({ id: 123, result: { decision: OFFERED } })
    await handle.close()
    await consumer
  })

  it('⚑ 736 · R95 CONTROL — a command approval with NO amendment offered has no Always allow, and refuses one', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(124, 'item/commandExecution/requestApproval', {
      command: '/usr/bin/touch x',
      cwd: '/tmp/x',
      proposedExecpolicyAmendment: ['/usr/bin/touch', 'x'],
      availableDecisions: ['accept', 'cancel'],
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const card = firstOfType(events, 'permission_request')
    expect(card.scope.availableDecisions).toEqual(['allow', 'deny', 'cancel'])
    expect(card.scope.persistence).toBe('once')
    expect(card.scope.grants).toBeUndefined()
    await expect(
      handle.respondPermission('number:124', { outcome: 'allow_always' }),
    ).rejects.toThrow(/not offered/)
    expect(transport.responses).toHaveLength(0)
    await handle.close()
    await consumer
  })

  it('close() safe-rejects a pending approval (app-server gets decline)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(80, 'item/commandExecution/requestApproval', { command: 'x' })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    await handle.close()
    await consumer
    expect(
      transport.responses.some(
        (r) => r.id === 80 && (r.result as { decision: string }).decision === 'decline',
      ),
    ).toBe(true)
  })

  it('respondPermission on an unknown id throws', async () => {
    const { handle, consumer } = await startCodex()
    await expect(handle.respondPermission('nope', { outcome: 'allow' })).rejects.toThrow()
    await handle.close()
    await consumer
  })
})

describe('CodexRuntime — honest resume', () => {
  it('resume → thread/resume; a MATCHING response emits session resumed and exposes the ref', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => okThread('th_x'))
    const runtime = new CodexRuntime(adopt(transport))
    const handle = await runtime.resume(
      { provider: 'codex', sessionId: 'th_x', cwd: '/tmp/x', rotation: 3 },
      { providerHome: '/tmp/x/home' },
    )
    expect(handle.ref).not.toBeNull()
    expect(handle.ref?.sessionId).toBe('th_x')
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    await vi.waitFor(has(events, (e) => e.type === 'session'))
    expect(firstOfType(events, 'session').state).toBe('resumed')
    await handle.close()
    await consumer
  })

  it('resume of a missing thread → ResumeError (no silent fresh thread)', async () => {
    const transport = new FakeTransport()
    transport.failRequest('thread/resume')
    const runtime = new CodexRuntime(adopt(transport))
    const resuming = runtime.resume(
      { provider: 'codex', sessionId: 'gone', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home' },
    )
    await expect(resuming).rejects.toBeInstanceOf(ResumeError)
    // ⚑ **673 · the lost-thread arm stays a `ResumeError`, and now says what it wrapped** — the other
    // half of `663` F6, measured beside the sign-in arm above.
    const lost = await resuming.catch((error: unknown) => error)
    // ⚠️ The transport's OWN error, not merely an error: `cause` is what was wrapped.
    expect((lost as Error).cause).toMatchObject({ message: 'transport: thread/resume failed' })
    // ⚑ **706 · this double's failure is a TRANSPORT's, not the app-server's answer** — so it is not
    // read as a thread that is gone. What Codex really answers for a missing thread, measured, and
    // what the adapter makes of it: `a-session-the-provider-no-longer-has.test.ts`.
    expect((lost as ResumeError).noSuchSession).toBe(false)
  })

  it('resume: malformed thread/resume ({}) → ResumeError, does not echo the requested id', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => malformedThreadStartResponse) // named: no thread at all
    const runtime = new CodexRuntime(adopt(transport))
    await expect(
      runtime.resume(
        { provider: 'codex', sessionId: 'th_x', cwd: '/tmp/x', rotation: 0 },
        { providerHome: '/tmp/x/home' },
      ),
    ).rejects.toBeInstanceOf(ResumeError)
  })

  it('resume: returned thread.id differs from requested → ResumeError', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => threadStartResponse('th_OTHER', '/tmp/x'))
    const runtime = new CodexRuntime(adopt(transport))
    await expect(
      runtime.resume(
        { provider: 'codex', sessionId: 'th_x', cwd: '/tmp/x', rotation: 0 },
        { providerHome: '/tmp/x/home' },
      ),
    ).rejects.toBeInstanceOf(ResumeError)
  })

  it('resume: returned cwd differs from requested → ResumeError', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => threadStartResponse('th_x', '/tmp/OTHER'))
    const runtime = new CodexRuntime(adopt(transport))
    await expect(
      runtime.resume(
        { provider: 'codex', sessionId: 'th_x', cwd: '/tmp/x', rotation: 0 },
        { providerHome: '/tmp/x/home' },
      ),
    ).rejects.toBeInstanceOf(ResumeError)
  })

  it('resume: response omits cwd → ResumeError (cwd must be proven, not echoed)', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => threadStartResponseWithoutCwd('th_x')) // matching id, no cwd
    const runtime = new CodexRuntime(adopt(transport))
    await expect(
      runtime.resume(
        { provider: 'codex', sessionId: 'th_x', cwd: '/tmp/x', rotation: 0 },
        { providerHome: '/tmp/x/home' },
      ),
    ).rejects.toBeInstanceOf(ResumeError)
  })

  it('resume with a wrong-provider ref → ResumeError', async () => {
    const runtime = new CodexRuntime(() => new FakeTransport())
    await expect(
      runtime.resume(
        { provider: 'claude', sessionId: 'x', cwd: '/tmp/x', rotation: 0 },
        { providerHome: '/tmp/x/home' },
      ),
    ).rejects.toBeInstanceOf(ResumeError)
  })
})

describe('CodexRuntime — provider-home isolation (021)', () => {
  it('passes the launch cwd + provider home to the transport factory', async () => {
    let ctx: unknown
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1', '/work/dir'))
    const runtime = new CodexRuntime((c) => {
      ctx = c
      transport.codexHome = c.providerHome
      return transport
    })
    const handle = await runtime.start({ cwd: '/work/dir', providerHome: '/managed/proj/profile' })
    expect(ctx).toEqual({ cwd: '/work/dir', providerHome: '/managed/proj/profile' })
    await handle.close()
  })

  it('threads the same provider home into the factory on resume', async () => {
    let ctx: unknown
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => okThread('th_x'))
    const runtime = new CodexRuntime((c) => {
      ctx = c
      transport.codexHome = c.providerHome
      return transport
    })
    const handle = await runtime.resume(
      { provider: 'codex', sessionId: 'th_x', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/managed/proj/profile' },
    )
    expect(ctx).toEqual({ cwd: '/tmp/x', providerHome: '/managed/proj/profile' })
    await handle.close()
  })

  it('fails closed when initialize reports a codexHome that is not the profile home', async () => {
    // The app-server ignored our CODEX_HOME (or a host config overrode it): its
    // state would leak across profiles, so the session must not start.
    const transport = new FakeTransport()
    transport.onRequest('initialize', () => ({
      userAgent: transport.userAgent,
      codexHome: '/some/other/home',
    }))
    transport.onRequest('thread/start', () => okThread('th_1'))
    const runtime = new CodexRuntime(adopt(transport))
    await expect(
      runtime.start({ cwd: '/tmp/x', providerHome: '/managed/profile' }),
    ).rejects.toThrow(/profile home/)
  })

  it('accepts a matching codexHome echoed by initialize', async () => {
    const transport = new FakeTransport()
    transport.onRequest('initialize', () => ({
      userAgent: transport.userAgent,
      codexHome: '/managed/profile',
    }))
    transport.onRequest('thread/start', () => okThread('th_1'))
    const runtime = new CodexRuntime(adopt(transport))
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/managed/profile' })
    expect(handle.ref?.sessionId).toBe('th_1')
    await handle.close()
  })

  it('fails closed when initialize does not report a codexHome (absence rejected, 027 P1-H)', async () => {
    const transport = new FakeTransport()
    transport.onRequest('initialize', () => ({ userAgent: transport.userAgent })) // NO codexHome — protocol requires it
    transport.onRequest('thread/start', () => okThread('th_1'))
    const runtime = new CodexRuntime(adopt(transport))
    await expect(
      runtime.start({ cwd: '/tmp/x', providerHome: '/managed/profile' }),
    ).rejects.toThrow(/codexHome/)
  })
})

describe('CodexRuntime — every launch keeps Codex’s own agents (D-014)', () => {
  it('runs the app-server with no config override', () => {
    expect(codexAppServerArgs()).toEqual(['app-server'])
  })

  // ⚑ **Landing D-014 · `1014 M16`**: the argv the real factory SPAWNS, not only the function it
  // calls. A `codex` that records its own arguments and exits stands in for the CLI.
  it('the real factory launches exactly that argv — nothing appended at the call site', async () => {
    const root = mkdtempSync(join(tmpdir(), 'brobot2-d014-argv-'))
    try {
      const out = join(root, 'argv.json')
      const codex = process.platform === 'win32' ? join(root, 'app-server') : join(root, 'codex')
      writeFileSync(
        codex,
        `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.platform === 'win32' ? ['app-server', ...process.argv.slice(2)] : process.argv.slice(2)))\n`,
      )
      chmodSync(codex, 0o755)
      const home = join(root, 'home')
      mkdirSync(home)
      const transport = createSpawnTransportFactory(
        process.platform === 'win32' ? process.execPath : codex,
      )({ cwd: root, providerHome: home }) as {
        exited?: Promise<void>
      }
      await transport.exited
      const argv = JSON.parse(readFileSync(out, 'utf8')) as string[]
      expect(argv).toEqual(codexAppServerArgs())
      expect(argv.join(' ')).not.toContain('agents.enabled')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('hands the transport only the folder and the home, on a fresh and a resumed launch', async () => {
    const startedContexts: CodexLaunchContext[] = []
    const startTransport = new FakeTransport()
    startTransport.onRequest('thread/start', () => okThread('th_start'))
    const started = await new CodexRuntime((context) => {
      startedContexts.push(context)
      startTransport.codexHome = context.providerHome
      return startTransport
    }).start({ cwd: '/tmp/d014/start', providerHome: '/tmp/d014/start-home' })
    expect(startedContexts).toEqual([
      { cwd: '/tmp/d014/start', providerHome: '/tmp/d014/start-home' },
    ])
    await started.close()

    const resumedContexts: CodexLaunchContext[] = []
    const resumeTransport = new FakeTransport()
    resumeTransport.onRequest('thread/resume', () => okThread('th_resume', '/tmp/d014/resume'))
    const resumed = await new CodexRuntime((context) => {
      resumedContexts.push(context)
      resumeTransport.codexHome = context.providerHome
      return resumeTransport
    }).resume(
      { provider: 'codex', sessionId: 'th_resume', cwd: '/tmp/d014/resume', rotation: 0 },
      { providerHome: '/tmp/d014/resume-home' },
    )
    expect(resumedContexts).toEqual([
      { cwd: '/tmp/d014/resume', providerHome: '/tmp/d014/resume-home' },
    ])
    await resumed.close()
  })
})

describe('CodexRuntime — auth inheritance (022)', () => {
  it('fails closed (AuthUnavailableError) at start when managed auth is unhealthy — no spawn, no fallback', async () => {
    let spawned = false
    const runtime = new CodexRuntime(
      () => {
        spawned = true
        return new FakeTransport()
      },
      () => ({ ok: false, reason: 'no managed Codex auth.json' }),
    )
    const starting = runtime.start({ cwd: '/tmp/x', providerHome: '/managed/profile' })
    await expect(starting).rejects.toBeInstanceOf(AuthUnavailableError)
    // ⛔ Refused here, before Codex was asked: never the class that says Codex itself refused.
    await expect(starting).rejects.not.toBeInstanceOf(CodexRefusedItsSignInError)
    expect(spawned).toBe(false) // never reached the transport factory / app-server
  })

  it('proceeds when managed auth is healthy', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1'))
    const runtime = new CodexRuntime(adopt(transport), () => ({ ok: true }))
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/managed/profile' })
    expect(handle.ref?.sessionId).toBe('th_1')
    await handle.close()
  })

  it('fails closed on resume when managed auth is unhealthy (AuthUnavailableError, not a silent fallback)', async () => {
    const runtime = new CodexRuntime(
      () => new FakeTransport(),
      () => ({ ok: false, reason: 'unhealthy' }),
    )
    await expect(
      runtime.resume(
        { provider: 'codex', sessionId: 'th_x', cwd: '/tmp/x', rotation: 0 },
        { providerHome: '/managed/profile' },
      ),
    ).rejects.toBeInstanceOf(AuthUnavailableError)
  })
})

describe('CodexRuntime — serverRequest/resolved retires the request (051)', () => {
  /** The real notification shape, type-checked against the generated protocol. */
  const resolved = (requestId: string | number, threadId = 'th_1') =>
    ({ threadId, requestId }) satisfies ServerRequestResolvedNotification

  it('retires the card and BLOCKS a late answer — no decision ever reaches the wire (044 P2 #1)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(70, 'item/commandExecution/requestApproval', {
      command: 'rm -rf /',
      cwd: '/tmp/x',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))

    // The provider clears the request (it does this on turn start/completion/interruption).
    transport.notification('serverRequest/resolved', resolved(70))
    await vi.waitFor(has(events, (e) => e.type === 'request_resolved'))
    expect(firstOfType(events, 'request_resolved').id).toBe('number:70')

    // The reviewer's probe: a LATE allow used to write `accept`. It must now be refused…
    await expect(handle.respondPermission('number:70', { outcome: 'allow' })).rejects.toThrow()
    await new Promise((r) => setTimeout(r, 10))
    // …and NOTHING may be written for that id — not the late accept, and not a second response
    // of our own (the provider already resolved it).
    expect(transport.responses.filter((r) => r.id === 70)).toEqual([])

    await handle.close()
    await consumer
  })

  it('correlates by TYPE-PRESERVING id: resolving numeric 1 leaves string "1" untouched (045)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(1, 'item/commandExecution/requestApproval', { command: 'numeric' })
    transport.serverRequest('1', 'item/commandExecution/requestApproval', { command: 'string' })
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'permission_request')).toHaveLength(2),
    )

    transport.notification('serverRequest/resolved', resolved(1)) // the NUMERIC one only
    await vi.waitFor(has(events, (e) => e.type === 'request_resolved'))
    expect(events.filter((e) => e.type === 'request_resolved').map((e) => e.id)).toEqual([
      'number:1',
    ])

    // The numeric request is dead; the string one is still answerable and still reaches the wire.
    await expect(handle.respondPermission('number:1', { outcome: 'allow' })).rejects.toThrow()
    await handle.respondPermission('string:1', { outcome: 'allow' })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === '1')).toBe(true))
    expect(transport.responses.filter((r) => r.id === 1)).toEqual([])

    await handle.close()
    await consumer
  })

  it('IGNORES a resolution for a different thread', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(71, 'item/commandExecution/requestApproval', { command: 'x' })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))

    transport.notification('serverRequest/resolved', resolved(71, 'th_OTHER'))
    await new Promise((r) => setTimeout(r, 15))
    expect(events.some((e) => e.type === 'request_resolved')).toBe(false)

    // Still ours to answer, and the decision still reaches the wire.
    await handle.respondPermission('number:71', { outcome: 'allow' })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 71)).toBe(true))
    expect(transport.responses).toContainEqual({ id: 71, result: { decision: 'accept' } })

    await handle.close()
    await consumer
  })

  it('retires a USER-INPUT request too, and is a no-op for an id we never claimed', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(72, 'item/tool/requestUserInput', {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'it',
      questions: [{ id: 'q', question: 'pick', options: [] }],
    })
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))

    // An id we never saw must not emit anything.
    transport.notification('serverRequest/resolved', resolved(999))
    await new Promise((r) => setTimeout(r, 10))
    expect(events.some((e) => e.type === 'request_resolved')).toBe(false)

    transport.notification('serverRequest/resolved', resolved(72))
    await vi.waitFor(has(events, (e) => e.type === 'request_resolved'))
    await expect(
      handle.respondUserInput('number:72', { kind: 'answer', answers: { q: 'x' } }),
    ).rejects.toThrow()
    expect(transport.responses.filter((r) => r.id === 72)).toEqual([])

    await handle.close()
    await consumer
  })
})

describe('CodexRuntime — CLI ↔ vendored-protocol version gate (043 P2-6)', () => {
  const uaFor = (version: string): string =>
    `brobot2/${version} (Mac OS 26.3.0; arm64) vscode/1.130.0 (brobot2; 0.0.0)`

  it('a matching CLI version launches normally', async () => {
    const transport = new FakeTransport()
    transport.userAgent = uaFor(CODEX_PROTOCOL_VERSION)
    transport.onRequest('thread/start', () => okThread('th_1'))
    const runtime = new CodexRuntime(adopt(transport))
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    expect(handle.ref?.sessionId).toBe('th_1')
    await handle.close()
  })

  it('a DRIFTED CLI version fails the launch closed with an actionable message', async () => {
    // A PATH `codex` of another version can silently mis-parse the wire through our generated
    // types (renamed fields → undefined, new variants → our `unknown` branches), so drift must
    // be loud at launch rather than confusing behavior later.
    const transport = new FakeTransport()
    // DERIVED from the pin, not hardcoded: a literal here became the pinned version on the next
    // CLI bump, and the test failed for agreeing with itself.
    const drifted = CODEX_PROTOCOL_VERSION.replace(/(\d+)$/, (patch) => String(Number(patch) + 1))
    transport.userAgent = uaFor(drifted)
    transport.onRequest('thread/start', () => okThread('th_1'))
    const runtime = new CodexRuntime(adopt(transport))
    await expect(runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })).rejects.toThrow(
      new RegExp(
        `${drifted.replace(/\./g, '\\.')}.*${CODEX_PROTOCOL_VERSION.replace(/\./g, '\\.')}`,
      ),
    )
    await expect(runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })).rejects.toThrow(
      /protocol:generate|pin the CLI/,
    )
  })

  it('an initialize response with NO readable version fails closed (never assume compatibility)', async () => {
    for (const userAgent of ['', 'fake', 'no-version-here (Mac OS)']) {
      const transport = new FakeTransport()
      transport.userAgent = userAgent
      transport.onRequest('thread/start', () => okThread('th_1'))
      const runtime = new CodexRuntime(adopt(transport))
      await expect(runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })).rejects.toThrow(
        /version not reported/,
      )
    }
  })

  it('parses the codex version from the FIRST userAgent token, not our own client version', () => {
    // Real shape: `<clientName>/<codexVersion> (OS; arch) …; <ourClientVersion>)`.
    expect(
      codexVersionFromUserAgent(
        'brobot2/0.145.0 (Mac OS 26.3.0; arm64) vscode/1.130.0 (brobot2; 0.0.0)',
      ),
    ).toBe('0.145.0')
    expect(codexVersionFromUserAgent('probe/1.2.3-rc.1 (Linux)')).toBe('1.2.3-rc.1')
    expect(codexVersionFromUserAgent('nonsense')).toBeNull()
    expect(codexVersionFromUserAgent('')).toBeNull()
  })
})

describe('CodexRuntime — sqlite_home attested BEFORE spawn (041 P1-H)', () => {
  let home: string
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'brobot-codex-prespawn-'))
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('a redirecting sqlite_home rejects start WITHOUT ever constructing the transport (no app-server is launched)', async () => {
    // Pre-fix the attestation ran inside begin() — i.e. AFTER the spawn + handshake — so the
    // app-server was already live, with state redirected outside the managed home.
    writeFileSync(join(home, 'config.toml'), '"sqlite_home" = "/tmp/brobot-escape"\n')
    let spawned = false
    const runtime = new CodexRuntime(() => {
      spawned = true
      return new FakeTransport()
    })
    await expect(runtime.start({ cwd: '/tmp/x', providerHome: home })).rejects.toBeInstanceOf(
      AuthUnavailableError,
    )
    expect(spawned).toBe(false) // the transport factory was never reached
  })

  it('a redirecting sqlite_home rejects resume WITHOUT constructing the transport', async () => {
    writeFileSync(join(home, 'config.toml'), 'sqlite_home = "/tmp/brobot-escape"\n')
    let spawned = false
    const runtime = new CodexRuntime(() => {
      spawned = true
      return new FakeTransport()
    })
    await expect(
      runtime.resume(
        { provider: 'codex', sessionId: 'th_x', cwd: '/tmp/x', rotation: 0 },
        { providerHome: home },
      ),
    ).rejects.toBeInstanceOf(AuthUnavailableError)
    expect(spawned).toBe(false)
  })

  it('a directly-constructed handle still fails closed — before ANY protocol traffic', async () => {
    // The runtime's pre-spawn gate can't cover a handle built directly with a caller-supplied
    // transport, so begin() re-attests before the first request rather than after a round-trip.
    writeFileSync(join(home, 'config.toml'), '"sqlite_home" = "/tmp/brobot-escape"\n')
    const transport = new FakeTransport()
    const handle = new CodexSessionHandle(transport, '/tmp/x', 0, home)
    await expect(handle.begin('started', undefined)).rejects.toBeInstanceOf(AuthUnavailableError)
    expect(transport.requests).toEqual([]) // not even `initialize` was sent
    await handle.close()
  })

  it('a CONTAINED sqlite_home still launches normally', async () => {
    writeFileSync(join(home, 'config.toml'), 'sqlite_home = "sub/state"\n')
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1'))
    const runtime = new CodexRuntime(adopt(transport))
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: home })
    expect(handle.ref?.sessionId).toBe('th_1')
    await handle.close()
  })
})

/**
 * 🔴 **704 · an interrupt Codex REFUSED, because the turn it names was not running yet.**
 *
 * ⚑ Measured by `probe:codex-early-interrupt` against the bundled 0.146.0 binary, 4 of 4: a
 * `turn/interrupt` written after the `turn/start` RESPONSE binds the id but before Codex starts the
 * turn is REFUSED (`-32600`: `no active turn to interrupt`, or `expected active turn id … but found …`
 * while the turn before still holds Codex's active slot) — which `sendInterruptRpc` swallows — and
 * Codex then runs the turn to its end. That is `smoke:ui` step 48's red on the hidden `main` baseline:
 * interrupt-and-send pressed 82 ms after Send, the count run to sixty, the person's replacement
 * refused by the host five seconds later. ⚑ `turn/started` is the moment the turn becomes
 * interruptible, so an interrupt asked for this turn is sent again there.
 */
describe('CodexRuntime — 704 · an interrupt asked before Codex has started the turn', () => {
  const interrupts = (transport: FakeTransport): { method: string; params: unknown }[] =>
    transport.requests.filter((request) => request.method === 'turn/interrupt')

  it('🔴 asked before the turn/start RESPONSE: fired at the bind, and AGAIN when Codex says the turn started', async () => {
    const { transport, handle, consumer } = await startCodex()
    transport.deferNextTurnStart()
    await handle.send('count')
    await handle.interrupt()
    transport.settleTurnStart('tn_1')
    await vi.waitFor(() => expect(interrupts(transport)).toHaveLength(1)) // the bind's — refused live
    transport.notification('turn/started', turnStartedNotification('th_1', 'tn_1'))
    await vi.waitFor(() => expect(interrupts(transport)).toHaveLength(2))
    expect(interrupts(transport)[1]?.params).toMatchObject({ threadId: 'th_1', turnId: 'tn_1' })
    await handle.close()
    await consumer
  })

  it('🔴 asked after the bind but before turn/started: sent at once, and again at turn/started', async () => {
    const { transport, handle, consumer } = await startCodex()
    await handle.send('count') // the response binds tn_1 at once
    await vi.waitFor(() => expect(transport.turnStartIds).toEqual(['tn_1']))
    await handle.interrupt()
    await vi.waitFor(() => expect(interrupts(transport)).toHaveLength(1))
    transport.notification('turn/started', turnStartedNotification('th_1', 'tn_1'))
    await vi.waitFor(() => expect(interrupts(transport)).toHaveLength(2))
    expect(interrupts(transport)[1]?.params).toMatchObject({ threadId: 'th_1', turnId: 'tn_1' })
    await handle.close()
    await consumer
  })

  it('⚑ controls: asked AFTER turn/started is sent once; a turn/started nobody interrupted sends none', async () => {
    const { transport, handle, events, consumer } = await startCodex()
    await handle.send('one')
    await vi.waitFor(() => expect(transport.turnStartIds).toEqual(['tn_1']))
    transport.notification('turn/started', turnStartedNotification('th_1', 'tn_1'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(interrupts(transport)).toHaveLength(0) // started, and nobody asked
    await handle.interrupt()
    await vi.waitFor(() => expect(interrupts(transport)).toHaveLength(1))
    // ⚑ Asked after `turn/started`, so the one RPC is the one that reaches a running turn — the
    // turn then ends, and nothing more is sent for it.
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1', { status: 'interrupted' })),
    )
    await vi.waitFor(() => expect(events.filter((event) => event.type === 'turn')).toHaveLength(1))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(interrupts(transport)).toHaveLength(1)
    await handle.close()
    await consumer
  })

  it('⛔ the next turn is never interrupted by the last one’s ask — a turn/started for another turn sends nothing', async () => {
    const { transport, handle, events, consumer } = await startCodex()
    await handle.send('one')
    await vi.waitFor(() => expect(transport.turnStartIds).toEqual(['tn_1']))
    await handle.interrupt()
    await vi.waitFor(() => expect(interrupts(transport)).toHaveLength(1))
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1', { status: 'interrupted' })),
    )
    await vi.waitFor(() => expect(events.filter((event) => event.type === 'turn')).toHaveLength(1))
    await vi.waitFor(() => expect(handle.status()).toBe('idle'))
    await handle.send('two') // the replacement — binds tn_2
    await vi.waitFor(() => expect(transport.turnStartIds).toEqual(['tn_1', 'tn_2']))
    // A stale `turn/started` for the interrupted turn, and the replacement's own: neither resends.
    transport.notification('turn/started', turnStartedNotification('th_1', 'tn_1'))
    transport.notification('turn/started', turnStartedNotification('th_1', 'tn_2'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(interrupts(transport)).toHaveLength(1)
    // ⛔ …and once the replacement IS interrupted, a stale `turn/started` for the OLD turn still
    // sends nothing — only the turn it names, if it is ours, is asked again.
    await handle.interrupt()
    await vi.waitFor(() => expect(interrupts(transport)).toHaveLength(2))
    transport.notification('turn/started', turnStartedNotification('th_1', 'tn_1'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(interrupts(transport).map((request) => request.params)).toEqual([
      expect.objectContaining({ turnId: 'tn_1' }),
      expect.objectContaining({ turnId: 'tn_2' }),
    ])
    transport.notification('turn/started', turnStartedNotification('th_1', 'tn_2'))
    await vi.waitFor(() => expect(interrupts(transport)).toHaveLength(3))
    expect(interrupts(transport)[2]?.params).toMatchObject({ turnId: 'tn_2' })
    await handle.close()
    await consumer
  })
})

describe('CodexRuntime — turn correlation (037/029 P1-C: bound from the turn/start RESPONSE)', () => {
  it('an interrupt() BEFORE the turn/start RESPONSE is latched and fired once the response binds the provider turnId; terminal is interrupted', async () => {
    const { transport, handle, events, consumer } = await startCodex()
    transport.deferNextTurnStart() // hold the authoritative response so no id is bound yet
    await handle.send('go')
    // Interrupt before the response resolves — there is no provider turnId yet.
    await handle.interrupt()
    expect(transport.requests.some((r) => r.method === 'turn/interrupt')).toBe(false) // latched, not yet sent

    // The AUTHORITATIVE turn/start response resolves → the latched interrupt fires, correlated to its id.
    transport.settleTurnStart('tn_1')
    await vi.waitFor(() =>
      expect(transport.requests.some((r) => r.method === 'turn/interrupt')).toBe(true),
    )
    expect(transport.requests.find((r) => r.method === 'turn/interrupt')?.params).toMatchObject({
      turnId: 'tn_1',
    })

    // ⚑ **Codex honours it, in its own word** — `interrupted`, measured by
    // `probe:codex-early-interrupt` on 704's adapter (4 of 4). 🔴 **709 · R43: and that word is what
    // the turn records**; it used to be whatever Codex said, renamed by the latch.
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1', { status: 'interrupted' })),
    )
    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.state === 'interrupted'))
    await handle.close()
    await consumer
  })

  it('🔴 709 · R43 — …and an early interrupt Codex COMPLETED anyway is recorded `completed`, the ask notwithstanding', async () => {
    // ⛔ **`main`'s shape before 704**, measured by `probe:codex-early-interrupt`: Codex refused the
    // interrupt as not-yet-running and ran the turn to its end — and the ledger said `interrupted`
    // over it, 4 of 4, because `SessionMachine.completeTurn` renamed Codex's word once an interrupt
    // had been asked. ⚑ The ask is still made (the frame below); the ending is Codex's.
    const { transport, handle, events, consumer } = await startCodex()
    transport.deferNextTurnStart()
    await handle.send('go')
    await handle.interrupt()
    transport.settleTurnStart('tn_1')
    await vi.waitFor(() =>
      expect(transport.requests.some((r) => r.method === 'turn/interrupt')).toBe(true),
    )
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1')),
    )
    await vi.waitFor(has(events, (e) => e.type === 'turn'))
    expect(
      events.filter((e) => e.type === 'turn').map((e) => (e.type === 'turn' ? e.state : '')),
    ).toEqual(['completed'])
    await handle.close()
    await consumer
  })

  it('a delayed duplicate turn/started + stale turn/completed for an OLD provider turn cannot rebind or terminalize the current turn (036 P1-C repro)', async () => {
    const { transport, handle, events, consumer } = await startCodex()
    // Turn 1: the turn/start RESPONSE binds tn_1 (authoritative); a matching turn/started is a
    // validated no-op; its own completion ends it.
    await handle.send('one')
    expect(transport.turnStartIds).toEqual(['tn_1']) // the response returned the correlation id
    transport.notification('turn/started', turnStartedNotification('th_1', 'tn_1'))
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1')),
    )
    await vi.waitFor(() => expect(events.filter((e) => e.type === 'turn').length).toBe(1))

    // Turn 2: the RESPONSE binds tn_2 IMMEDIATELY — before any turn/started notification arrives.
    await handle.send('two')
    expect(transport.turnStartIds).toEqual(['tn_1', 'tn_2'])
    await vi.waitFor(() => expect(handle.status()).toBe('working'))

    // The 036 repro: a DELAYED DUPLICATE turn/started for the OLD provider turn tn_1 must NOT
    // rebind turn 2 (pre-fix, binding came from THIS notification, so turn 2 — not yet bound —
    // latched onto the old tn_1), and a STALE turn/completed(tn_1) must NOT terminalize it.
    transport.notification('turn/started', turnStartedNotification('th_1', 'tn_1'))
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1')),
    )
    await new Promise((r) => setTimeout(r, 25))
    expect(events.filter((e) => e.type === 'turn')).toHaveLength(1) // still only turn 1's terminal
    expect(handle.status()).toBe('working') // turn 2 is still live, bound to tn_2

    // Turn 2's OWN provider completion terminalizes it — and only it (exactly one more terminal).
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_2')),
    )
    await vi.waitFor(() => expect(events.filter((e) => e.type === 'turn').length).toBe(2))
    await handle.close()
    await consumer
  })

  it('a stale turn-scoped delta/item for an OLD provider turn is ignored (validated against the response-bound id)', async () => {
    const { transport, handle, events, consumer } = await startCodex()
    await handle.send('one')
    expect(transport.turnStartIds).toEqual(['tn_1'])
    transport.notification('turn/started', turnStartedNotification('th_1', 'tn_1'))
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1')),
    )
    await vi.waitFor(() => expect(events.filter((e) => e.type === 'turn').length).toBe(1))

    // Turn 2 (bound tn_2). A LATE delta for the OLD turn tn_1 must not surface as turn-2 content.
    await handle.send('two')
    expect(transport.turnStartIds).toEqual(['tn_1', 'tn_2'])
    transport.notification('item/agentMessage/delta', {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'm',
      delta: 'STALE',
    })
    transport.notification('item/agentMessage/delta', {
      threadId: 'th_1',
      turnId: 'tn_2',
      itemId: 'm',
      delta: 'FRESH',
    })
    await vi.waitFor(() =>
      expect(events.some((e) => e.type === 'assistant_delta' && e.text === 'FRESH')).toBe(true),
    )
    expect(events.some((e) => e.type === 'assistant_delta' && e.text === 'STALE')).toBe(false) // dropped: wrong turn
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_2')),
    )
    await handle.close()
    await consumer
  })

  /**
   * Each row says how a LEAK would show itself, because that differs by method and a shared
   * assertion would be inert for some of them. Three carry a `STALE` marker into the payload — for
   * `tokenUsage` it had to be added, since nothing else in the shape is recognisable. The fourth,
   * `summaryPartAdded`, cannot: it normalizes to a bare `{thinking, delta}` with no payload at all,
   * so its arrival IS the evidence. Every row's predicate was confirmed to fire with the gate
   * removed — a check that cannot fail is not a check.
   */
  const staleLeak = (arrivals: RuntimeEvent[]): boolean =>
    arrivals.some((e) => JSON.stringify(e).includes('STALE'))
  const thinkingLeak = (arrivals: RuntimeEvent[]): boolean =>
    arrivals.some((e) => e.type === 'thinking')
  const planLeak = (arrivals: RuntimeEvent[]): boolean =>
    arrivals.some((e) => e.type === 'plan_update')
  const subAgentLeak = (arrivals: RuntimeEvent[]): boolean =>
    arrivals.some((e) => e.type === 'sub_agent')

  it.each([
    [
      'item/reasoning/summaryTextDelta',
      { itemId: 'rs_1', summaryIndex: 0, delta: 'STALE' },
      (a: RuntimeEvent[]) => staleLeak(a) || thinkingLeak(a),
    ],
    ['item/reasoning/summaryPartAdded', { itemId: 'rs_1', summaryIndex: 1 }, thinkingLeak],
    [
      // 028's addition, and the worst of the set to leak: the plan is stated WHOLESALE, so a late
      // one does not add a stale line — it REPLACES the running turn's checklist with the finished
      // turn's. Both predicates fire with the gate removed (mutation-verified): the marker rides in
      // a step, and any `plan_update` at all here is already the bug.
      'turn/plan/updated',
      { explanation: null, plan: [{ step: 'STALE', status: 'completed' }] },
      (a: RuntimeEvent[]) => staleLeak(a) || planLeak(a),
    ],
    ['item/commandExecution/outputDelta', { itemId: 'exec_1', delta: 'STALE\n' }, staleLeak],
    [
      // 184's addition, and the first member of the set that is here for what the app READS rather
      // than for what it renders: this is the one method {@link PatchTargets} learns from that was
      // outside the gate. Its leak still shows the same way as its neighbours' — the marker rides in
      // the opaque `unknown{raw}` — so the row costs nothing extra and is what turns red when the
      // entry is removed.
      'item/fileChange/patchUpdated',
      { itemId: 'exec_1', changes: [{ path: '/w/STALE.txt', kind: { type: 'add' } }] },
      staleLeak,
    ],
    [
      'thread/tokenUsage/updated',
      { marker: 'STALE', tokenUsage: { total: { totalTokens: 1 } } },
      staleLeak,
    ],
    [
      // 033's addition, and it needed no new entry in the gated set: a sub-agent's BIRTH is an
      // ordinary `item/started` carrying a `subAgentActivity`, so it was gated the day it became
      // first-class. That is worth an assertion rather than an assumption — a card opened by a
      // finished turn would sit in the live conversation with nothing left to end it.
      'item/started',
      {
        item: {
          type: 'subAgentActivity',
          id: 'call_STALE',
          kind: 'started',
          agentThreadId: 'STALE-child-thread',
          agentPath: '/root/stale',
        },
      },
      (a: RuntimeEvent[]) => staleLeak(a) || subAgentLeak(a),
    ],
  ])(
    'a stale-turn %s is IGNORED, not applied to the current turn (027 gating)',
    async (method, extra, leaked) => {
      // All four were exempt from turn-gating only because they normalized to opaque unknown{raw} —
      // "no first-class content, cannot bind or terminalize a turn". For the two reasoning methods
      // 027 made that a live bug: promoted to `thinking`, a late event from a finished turn lands
      // on the turn now running. The other two are gated by choice, not necessity. Every one was
      // confirmed live to carry threadId AND turnId, so gating them is possible either way.
      const { transport, handle, events, consumer } = await startCodex()
      await handle.send('one')
      transport.notification('turn/started', turnStartedNotification('th_1', 'tn_1'))
      transport.notification(
        'turn/completed',
        turnCompletedNotification('th_1', completedTurn('tn_1')),
      )
      await vi.waitFor(() => expect(events.filter((e) => e.type === 'turn').length).toBe(1))

      const before = events.length
      await handle.send('two') // now bound to tn_2
      transport.notification(method, { threadId: 'th_1', turnId: 'tn_1', ...extra }) // STALE
      await new Promise((resolve) => setTimeout(resolve, 30))

      // Nothing from the finished turn may reach the stream at all.
      const arrivals = events.slice(before)
      expect(leaked(arrivals), `${method} from a finished turn leaked into the live one`).toBe(
        false,
      )

      transport.notification(
        'turn/completed',
        turnCompletedNotification('th_1', completedTurn('tn_2')),
      )
      await handle.close()
      await consumer
    },
  )

  it('thread/status/changed is DELIBERATELY not turn-gated — it has no turn to gate on', async () => {
    // It carries a threadId and NO turnId, because it describes the thread rather than a turn
    // (captured live: {threadId, status:{type:'active'|'idle', activeFlags:[…]}}). Gating it on a
    // turn id it does not have would drop it entirely, so it stays exempt — and therefore may
    // inform session-level status only, never a turn-scoped indicator.
    const { transport, handle, events, consumer } = await startCodex()
    const before = events.length
    transport.notification('thread/status/changed', {
      threadId: 'th_1',
      status: { type: 'active', activeFlags: ['waitingOnApproval'] },
    })
    await vi.waitFor(() => expect(events.length).toBeGreaterThan(before))
    // It survives (not dropped), and it is NOT a turn-scoped indicator.
    const arrivals = events.slice(before)
    expect(arrivals.some((e) => e.type === 'activity')).toBe(false)
    await handle.close()
    await consumer
  })

  it('a malformed turn/start response (no turn id) is a provider protocol error → fails closed (errored), never proceeds uncorrelated (036 P1-C)', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1'))
    transport.onRequest('turn/start', () => malformedTurnStartResponse) // named: no turn id
    const runtime = new CodexRuntime(adopt(transport))
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    await handle.send('go')
    await vi.waitFor(has(events, (e) => e.type === 'error' && e.fatal === true))
    expect(events.some((e) => e.type === 'status' && e.state === 'errored')).toBe(true)
    expect(events.some((e) => e.type === 'turn')).toBe(true) // the uncorrelated turn is terminalized, not left hanging
    await handle.close()
    await consumer
  })
})

/**
 * 🔴 **395 · a Codex interruption and a Codex fault, side by side on this adapter's own wire.**
 *
 * ⛔ **Measured HERE and not carried over from Claude**, because the two interrupt paths **differ in
 * kind** — and the difference is the one a reader would most naturally assume away.
 */
describe('395 · telling a Codex interruption from a Codex fault', () => {
  it('🔴 the discriminator is the NEIGHBOURS, not the turn — an interrupt emits no `error`', async () => {
    const { transport, handle, events, consumer } = await startCodex()
    await handle.send('go')
    await handle.interrupt()
    // ⚑ **Codex's own terminal is what closes the turn, in Codex's own word** — `interrupted`, what
    // an interrupt of a running turn gets (`probe:codex-early-interrupt`'s late arm). 🔴 **709 · R43:
    // the word is Codex's; nothing reclassifies it** — see the IN KIND test below.
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1', { status: 'interrupted' })),
    )
    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.state === 'interrupted'))
    // ⛔ **No `error` anywhere.** That absence is the one wire-level signal present for every fault
    // and for no interruption, and it is the same on both providers — which is a thing this file
    // MEASURES rather than a thing the Claude file's result implies.
    expect(events.some((e) => e.type === 'error')).toBe(false)
    expect(events.filter((e) => e.type === 'status').at(-1)).toMatchObject({ state: 'idle' })
    await handle.close()
    await consumer
  })

  it('⛔ …and a FAULT on the same turn emits a fatal `error` and ends `errored`', async () => {
    const { transport, handle, events, consumer } = await startCodex()
    await handle.send('go')
    // ⚑ **The same point in the same turn as the interrupt above** — the app-server's stream ends
    // and nothing acknowledges anything, which is the fault that looks most like a stop.
    transport.endIncoming()
    await consumer
    const errors = events.filter((e) => e.type === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ fatal: true })
    expect(events.some((e) => e.type === 'status' && e.state === 'errored')).toBe(true)
    // ⛔ **And the turn is `failed`, not `interrupted`** — nothing had asked it to stop.
    expect(
      events.filter((e) => e.type === 'turn').map((e) => (e.type === 'turn' ? e.state : '')),
    ).toEqual(['failed'])
    await handle.close()
  })

  it('⚑ 709 · a card CANCELLED, then the stream ends — the machine’s own word after the ask, beside the fault', async () => {
    // ⚑ **What the Cancel latch still decides since R43**: the provider's ending is recorded as the
    // provider says it, so the latch no longer renames a completion — but a FATAL error on a turn a
    // person already cancelled is written by the machine, and the latch is what makes it read
    // `interrupted` beside the error (`how-work-stopped`'s `it-was-stopped-and-it-faulted`) rather
    // than `failed`, the fault alone. ⚑ The pair is the test below: the same card, answered Deny.
    // ⚑ The agent-tool door reads `interrupted` for the same sequence since `720` (R71: *"both
    // latch"*) — pinned in the 492 block, with its Deny control.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(64, 'item/commandExecution/requestApproval', {
      command: 'rm -rf build',
      cwd: '/tmp/x',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    await handle.respondPermission('number:64', { outcome: 'cancel' })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 64)).toBe(true))
    transport.endIncoming()
    await consumer
    expect(events.filter((e) => e.type === 'error')).toMatchObject([{ fatal: true }])
    expect(
      events.filter((e) => e.type === 'turn').map((e) => (e.type === 'turn' ? e.state : '')),
    ).toEqual(['interrupted'])
    await handle.close()
  })

  it('⚑ 709 · …and the control one fact over: the same card answered DENY, then the stream ends, is the fault alone', async () => {
    // ⛔ **Only the answer moves.** A Deny asks nothing to stop, so no latch may be set — a latch
    // widened to every answer would draw this fault `it-was-stopped-and-it-faulted` too.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(64, 'item/commandExecution/requestApproval', {
      command: 'rm -rf build',
      cwd: '/tmp/x',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    await handle.respondPermission('number:64', { outcome: 'deny' })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 64)).toBe(true))
    transport.endIncoming()
    await consumer
    expect(events.filter((e) => e.type === 'error')).toMatchObject([{ fatal: true }])
    expect(
      events.filter((e) => e.type === 'turn').map((e) => (e.type === 'turn' ? e.state : '')),
    ).toEqual(['failed'])
    await handle.close()
  })

  it('🔴 IN KIND: Codex does NOT force a local terminal — it fires the RPC and waits', async () => {
    // ⛔ **This is the half a comparison must not carry over.** Claude's `interrupt()` ends with
    // `forceEnd()`, so its turn is over when the call returns. ⚠️ Codex's calls `forceEnd` only on
    // the branch where there is no live turn to address; with one running it sends `turn/interrupt`,
    // awaits only its ANSWER — the call below returns with the turn still open — and leaves the
    // ending to the provider's own `turn/completed` (709 corrected *"waits for"* it).
    const { transport, handle, events, consumer } = await startCodex()
    await handle.send('go')
    await handle.interrupt()
    // ⚑ **The RPC went out, addressed to the provider's turn id** — which Claude's `Query.interrupt()`
    // takes no argument for at all.
    expect(transport.requests.find((r) => r.method === 'turn/interrupt')?.params).toMatchObject({
      turnId: 'tn_1',
    })
    // ⛔ **And NOTHING has terminalized.** The interrupt has been asked for and the turn is still
    // open, which is the state a tool that answered *"stopped"* would be lying about — and the
    // reason `RuntimeHost.interruptAgent` bounds its wait and answers `asked`.
    expect(events.some((e) => e.type === 'turn')).toBe(false)
    expect(handle.status()).toBe('working')
    // ⚑ **Only the provider's own terminal ends it, and in the provider's own word** (709, R43) —
    // it used to reclassify whatever outcome that terminal carried.
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1', { status: 'interrupted' })),
    )
    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.state === 'interrupted'))
    await handle.close()
    await consumer
  })
})

describe('CodexRuntime — close/fatal barrier (028 P1-A)', () => {
  it('a fatal stream loss reaps the transport from the errored state; a later close() still completes', async () => {
    const { transport, handle, events, consumer } = await startCodex()
    expect(transport.closeCount).toBe(0)
    transport.endIncoming() // the app-server stream ends WITHOUT an explicit transport.close()
    await consumer // finishUnexpected: fatalError + reap the transport
    expect(events.some((e) => e.type === 'status' && e.state === 'errored')).toBe(true)
    expect(transport.closeCount).toBeGreaterThan(0) // reaped from the errored state (pre-fix: 0)
    await handle.close() // a later close still resolves (memoized errored-state branch)
  })

  it('a tracked handler that throws "write after terminal" does not surface an unhandled rejection', async () => {
    const rejections: unknown[] = []
    const onRej = (reason: unknown): void => {
      rejections.push(reason)
    }
    process.on('unhandledRejection', onRej)
    try {
      const transport = new FakeTransport()
      transport.onRequest('thread/start', () => okThread('th_1'))
      const runtime = new CodexRuntime(adopt(transport))
      const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
      const events: RuntimeEvent[] = []
      const consumer = collect(handle, events)
      await handle.send('go') // an approval only exists inside a live turn (061)
      // Open a permission — its handler is now tracked, awaiting the broker.
      transport.serverRequest(90, 'item/commandExecution/requestApproval', { command: 'x' })
      await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
      // On close the settled handler resolves and calls respond → which now THROWS
      // (transport terminal). The tracked-handler rejection must be swallowed.
      transport.throwOnRespond = true
      await handle.close()
      await consumer
      await new Promise((r) => setTimeout(r, 40)) // let any unhandled rejection surface
      expect(rejections).toEqual([])
    } finally {
      process.off('unhandledRejection', onRej)
    }
  })
})

describe('CodexRuntime — handshake validation & ref honesty', () => {
  it('start: malformed thread/start ({}) rejects and closes the transport; no empty-id ref escapes', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => malformedThreadStartResponse) // named: invalid handshake
    let closed = false
    const realClose = transport.close.bind(transport)
    transport.close = () => {
      closed = true
      realClose()
    }
    const runtime = new CodexRuntime(adopt(transport))
    await expect(runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })).rejects.toThrow()
    expect(closed).toBe(true)
  })

  it('start: empty thread id is rejected (sessionId:"" never surfaces)', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => threadStartResponseWithEmptyId())
    const runtime = new CodexRuntime(adopt(transport))
    await expect(runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })).rejects.toThrow()
  })

  it('close before a confirmed handshake emits no session event and no "unstarted" placeholder', async () => {
    const transport = new FakeTransport()
    const handle = new CodexSessionHandle(transport, '/tmp/x', 0, '/tmp/x/home') // begin() never called → _ref null
    expect(handle.ref).toBeNull()
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    await handle.close()
    await consumer
    expect(events.some((e) => e.type === 'session')).toBe(false)
    expect(handle.status()).toBe('ended')
  })
})

describe('CodexRuntime — config-independent prompting (007 P1-6)', () => {
  it('pins on-request + user reviewer + workspace-write on thread/start', async () => {
    // ⚑ 736 · R96 — `ask` is the Codex CLI's default preset (`workspace-write`); `read-only` until then.
    const { transport, handle, consumer } = await startCodex()
    const start = transport.requests.find((r) => r.method === 'thread/start')
    expect(start?.params).toMatchObject({
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      sandbox: 'workspace-write',
    })
    await handle.close()
    await consumer
  })

  it('re-pins the user reviewer on every turn/start', async () => {
    const { transport, handle, consumer } = await startCodex()
    await handle.send('hi')
    const turn = transport.requests.find((r) => r.method === 'turn/start')
    expect(turn?.params).toMatchObject({ approvalsReviewer: 'user' })
    await handle.close()
    await consumer
  })

  it('asks for a reasoning summary on every turn/start (027)', async () => {
    // The whole thinking view for Codex rests on this ONE field. Without it the server sends
    // `reasoning` items with `{summary:[], content:[]}` — captured live — and the disclosure is an
    // empty box. Nothing else in the suite would notice it going missing: no summary means no
    // `summaryTextDelta`, and a test that only checks what we do with deltas we never get passes.
    const { transport, handle, events, consumer } = await startCodex()
    await handle.send('hi')
    transport.notification('turn/started', turnStartedNotification('th_1', 'tn_1'))
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1')),
    )
    await vi.waitFor(() => expect(events.filter((e) => e.type === 'turn').length).toBe(1))
    await handle.send('again') // EVERY turn, not just the first
    const turns = transport.requests.filter((r) => r.method === 'turn/start')
    expect(turns).toHaveLength(2)
    for (const turn of turns) expect(turn.params).toMatchObject({ summary: 'detailed' })
    await handle.close()
    await consumer
  })

  it('pins the user reviewer on thread/resume', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => okThread('th_x'))
    const runtime = new CodexRuntime(adopt(transport))
    const handle = await runtime.resume(
      { provider: 'codex', sessionId: 'th_x', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home' },
    )
    expect(transport.requests.find((r) => r.method === 'thread/resume')?.params).toMatchObject({
      approvalsReviewer: 'user',
    })
    await handle.close()
  })

  it('asks thread/resume for no past turns, and for no page of them', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => okThread('th_x'))
    const handle = await new CodexRuntime(adopt(transport)).resume(
      { provider: 'codex', sessionId: 'th_x', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home' },
    )
    const params = transport.requests.find((r) => r.method === 'thread/resume')?.params as Record<
      string,
      unknown
    >
    expect(params.excludeTurns).toBe(true)
    expect('history' in params).toBe(false)
    expect('initialTurnsPage' in params).toBe(false)
    await handle.close()
  })

  it('shows no usage Codex replays after a resume, and the next turn’s own usage as before', async () => {
    // A resume that asks for past turns may be followed by a replayed usage update for an old turn.
    // The context meter never took it: no turn is running, so the turn gate drops it. What the meter
    // shows after a resume is therefore the same whether or not past turns were asked for.
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => okThread('th_1'))
    const handle = await new CodexRuntime(adopt(transport)).resume(
      { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home' },
    )
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    const usage = (turnId: string, used: number) => ({
      threadId: 'th_1',
      turnId,
      tokenUsage: { last: { totalTokens: used }, total: { totalTokens: used } },
    })
    transport.notification('thread/tokenUsage/updated', usage('tn_old', 111))
    await handle.send('go')
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'status').at(-1)?.state).toBe('working'),
    )
    transport.notification('thread/tokenUsage/updated', usage(transport.lastTurnId, 222))
    await vi.waitFor(() => expect(events.some((e) => e.type === 'context_reading')).toBe(true))
    const readings = events.filter((e) => e.type === 'context_reading')
    expect(readings).toHaveLength(1)
    expect(readings[0]).toMatchObject({ reading: { kind: 'tokens', used: 222 } })
    await handle.close()
    await consumer
  })

  describe('each phase of a launch is said as it is reached, by name only', () => {
    const IN_ORDER = [
      'boot-gate-entered',
      'boot-gate-passed',
      'spawned',
      'initialize-sent',
      'initialized',
      'boot-gate-released',
      'thread-sent',
      'thread-answered',
      'validated',
    ]
    it('a fresh start and a resume, in order, with the size of the thread’s answer', async () => {
      for (const opening of ['start', 'resume'] as const) {
        const transport = new FakeTransport()
        transport.onRequest('thread/start', () => okThread('th_1'))
        transport.onRequest('thread/resume', () => okThread('th_1'))
        Object.assign(transport, {
          responseBytes: (method: string) => (method === `thread/${opening}` ? 4096 : undefined),
        })
        const said: { phase: string; detail?: { bytes?: number } }[] = []
        const startPhases: StartPhaseSink = (phase, detail) =>
          said.push(detail === undefined ? { phase } : { phase, detail })
        const runtime = new CodexRuntime(adopt(transport))
        const handle =
          opening === 'start'
            ? await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home', startPhases })
            : await runtime.resume(
                { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 },
                { providerHome: '/tmp/x/home', startPhases },
              )
        expect(said.map((one) => one.phase)).toEqual(IN_ORDER)
        expect(said.find((one) => one.phase === 'thread-answered')?.detail).toEqual({ bytes: 4096 })
        // Names and a size only: nothing a launch sends or receives.
        expect(JSON.stringify(said)).not.toMatch(/th_1|\/tmp|home/)
        await handle.close()
      }
    })
    it('says the skills registered when the launch has built-in skills', async () => {
      const transport = new FakeTransport()
      transport.onRequest('thread/start', () => okThread('th_1'))
      const said: string[] = []
      const runtime = new CodexRuntime(adopt(transport))
      // Six fictional skills, listed back by Codex as the check expects.
      const root = resolve('/tmp/fictional/codex')
      const skills = {
        root,
        skills: [
          'delegate',
          'hand-back',
          'split-work',
          'ask-and-wait',
          'remember',
          'build-software',
        ].map((name) => ({
          name,
          description: `Description of ${name}.`,
          path: join(root, name, 'SKILL.md'),
        })),
      }
      transport.onRequest('skills/extraRoots/set', () => ({}))
      transport.onRequest('skills/list', () => ({
        data: [
          {
            cwd: '/tmp/x',
            errors: [],
            skills: skills.skills.map((one) => ({ ...one, enabled: true })),
          },
        ],
      }))
      const handle = await runtime.start({
        cwd: '/tmp/x',
        providerHome: '/tmp/x/home',
        builtInSkills: skills,
        startPhases: (phase) => said.push(phase),
      })
      expect(said.indexOf('skills-registered')).toBeGreaterThan(said.indexOf('boot-gate-released'))
      expect(said.indexOf('skills-registered')).toBeLessThan(said.indexOf('thread-sent'))
      await handle.close()
    })
    it('a sink that throws does not stop the launch', async () => {
      const transport = new FakeTransport()
      transport.onRequest('thread/start', () => okThread('th_1'))
      const handle = await new CodexRuntime(adopt(transport)).start({
        cwd: '/tmp/x',
        providerHome: '/tmp/x/home',
        startPhases: () => {
          throw new Error('fictional sink failure')
        },
      })
      expect(handle.status()).not.toBe('errored')
      await handle.close()
    })
  })

  // Hostile-config regression: a host config that routes escalation to an
  // auto-approver, opens full access, or disables approvals is rejected — the
  // adapter refuses to run a session that would not reach the UI (fail closed).
  it('rejects a handshake that routed the reviewer to auto_review', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({
      ...okThread('th_1'),
      approvalsReviewer: 'auto_review',
    }))
    const runtime = new CodexRuntime(adopt(transport))
    await expect(runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })).rejects.toThrow(
      /approval profile/,
    )
  })

  // Sandbox is validated as an ALLOW-list — ⚑ `workspaceWrite` only since `736` (R96, the Codex CLI's
  // default preset; `readOnly` until then): full access and externalSandbox are still refused.
  it('rejects a handshake with a danger-full-access sandbox', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({
      ...okThread('th_1'),
      sandbox: { type: 'dangerFullAccess' },
    }))
    const runtime = new CodexRuntime(adopt(transport))
    await expect(runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })).rejects.toThrow(
      /approval profile/,
    )
  })

  /**
   * 🔴 **736 · R96 — `ask` is the Codex CLI's DEFAULT preset, so a read-only echo is the wrong
   * profile.** ⚑ R96: *"BroBot's `ask` on Codex is the Codex CLI's default preset (`workspace-write` +
   * `on-request`), not its Read Only preset."* ⛔ On `main`: `readOnly` was the only sandbox `ask`
   * accepted, and this workspace-write echo was the one refused.
   */
  it('🔴 736 · R96 — rejects a handshake with a read-only sandbox, and starts on a workspace-write one', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({
      ...okThread('th_1'),
      sandbox: { type: 'readOnly', networkAccess: false },
    }))
    const runtime = new CodexRuntime(adopt(transport))
    await expect(runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })).rejects.toThrow(
      /approval profile/,
    )
    // ⚑ The pair, one fact over: the workspace-write echo (with a writable root of its own) starts.
    const accepted = new FakeTransport()
    accepted.onRequest('thread/start', () => ({
      ...okThread('th_1'),
      sandbox: {
        type: 'workspaceWrite',
        writableRoots: ['/tmp/x'],
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
    }))
    const handle = await new CodexRuntime(adopt(accepted)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
    })
    expect(handle.ref?.sessionId).toBe('th_1')
    await handle.close()
  })

  it('rejects a handshake with an external sandbox (opaque, no escalation guarantee)', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({
      ...okThread('th_1'),
      sandbox: { type: 'externalSandbox', networkAccess: true },
    }))
    const runtime = new CodexRuntime(adopt(transport))
    await expect(runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })).rejects.toThrow(
      /approval profile/,
    )
  })

  // Policy is validated as an ALLOW-list (on-request only): 'never', 'untrusted',
  // and the granular form can all skip approvals.
  it("rejects a handshake with a 'never' approval policy", async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({ ...okThread('th_1'), approvalPolicy: 'never' }))
    const runtime = new CodexRuntime(adopt(transport))
    await expect(runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })).rejects.toThrow(
      /approval profile/,
    )
  })

  it("rejects a handshake with an 'untrusted' approval policy", async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({
      ...okThread('th_1'),
      approvalPolicy: 'untrusted',
    }))
    const runtime = new CodexRuntime(adopt(transport))
    await expect(runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })).rejects.toThrow(
      /approval profile/,
    )
  })

  it('rejects a handshake with a granular approval policy that disables permission requests', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({
      ...okThread('th_1'),
      approvalPolicy: {
        granular: {
          sandbox_approval: false,
          rules: false,
          skill_approval: false,
          request_permissions: false,
          mcp_elicitations: false,
        },
      },
    }))
    const runtime = new CodexRuntime(adopt(transport))
    await expect(runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })).rejects.toThrow(
      /approval profile/,
    )
  })

  it('fails closed if a mid-session thread/settings/updated moves off the prompting profile', async () => {
    const { transport, handle, events, consumer } = await startCodex()
    // a hostile mid-session change: reviewer routed to an auto-approver
    transport.notification('thread/settings/updated', {
      threadSettings: {
        approvalPolicy: 'on-request',
        approvalsReviewer: 'auto_review',
        // ⚑ 736 · R96 — the `ask` sandbox (was `readOnly`), so the reviewer is the ONE fact moved.
        sandboxPolicy: {
          type: 'workspaceWrite',
          writableRoots: [],
          networkAccess: false,
          excludeTmpdirEnvVar: false,
          excludeSlashTmp: false,
        },
      },
    })
    await vi.waitFor(has(events, (e) => e.type === 'error' && e.fatal === true))
    expect(events.some((e) => e.type === 'status' && e.state === 'errored')).toBe(true)
    await handle.close()
    await consumer
  })
})

describe('CodexRuntime — approval scope disclosure (007 P1-7)', () => {
  const scopeOf = (events: RuntimeEvent[]) => {
    const p = events.find((e) => e.type === 'permission_request')
    if (!p || p.type !== 'permission_request') throw new Error('no permission_request')
    return p
  }

  const commandParams = {
    threadId: 'th_1',
    turnId: 'tn_1',
    itemId: 'it_1',
    startedAtMs: 123,
    command: 'curl https://api.example.com',
    cwd: '/tmp/x',
    commandActions: [{ type: 'read', command: 'cat a', name: 'cat', path: '/tmp/x/a.txt' }],
    networkApprovalContext: { host: 'api.example.com', protocol: 'https' },
    // The REAL AdditionalPermissionProfile shape (AdditionalNetworkPermissions is `{ enabled }`).
    additionalPermissions: { network: { enabled: true }, fileSystem: null },
    proposedExecpolicyAmendment: ['curl', '*'],
    proposedNetworkPolicyAmendments: [{ host: 'cdn.example.com', action: 'allow' }],
    availableDecisions: ['accept', 'acceptForSession', 'decline', 'cancel'],
  }

  it('maps a command approval to the full neutral scope', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(50, 'item/commandExecution/requestApproval', commandParams)
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    expect(req.scope).toEqual({
      cwd: '/tmp/x',
      paths: ['/tmp/x/a.txt'],
      networkHosts: ['https://api.example.com', 'cdn.example.com'], // egress protocol folded in
      persistence: 'session', // acceptForSession is ON the card (697: a proposal alone never is)
      amendments: [
        { kind: 'exec', detail: 'curl *' },
        { kind: 'network', detail: 'allow cdn.example.com' },
      ],
      availableDecisions: ['allow', 'allow_for_session', 'deny', 'cancel'],
      underDisclosed: true, // additionalPermissions present → surfaced, not dropped
      approvalMode: 'ask', // the mode is part of the honest scope (078)
    })
    await handle.close()
    await consumer
  })

  /**
   * A command card warns only when something is not shown. It shows the whole command and its
   * folder; the paths and hosts Codex picks out of a command are best-effort, so a card that draws
   * them keeps the warning, as does one asking for more than the command (extra permissions,
   * network access) or carrying a field this app does not know.
   */
  describe('a command card warns only when something is not shown', () => {
    const WHOLE = {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'it_1',
      startedAtMs: 123,
      kind: 'command',
      approvalId: null,
      environmentId: null,
      reason: null,
      command: 'touch notes.txt',
      cwd: '/tmp/x',
      commandActions: [{ type: 'unknown', command: 'touch notes.txt' }],
      networkApprovalContext: null,
      additionalPermissions: null,
      proposedExecpolicyAmendment: ['touch', 'notes.txt'],
      proposedNetworkPolicyAmendments: null,
      availableDecisions: ['accept', 'acceptForSession', 'decline', 'cancel'],
    }
    const flagOf = async (params: Record<string, unknown>): Promise<boolean> => {
      const { transport, handle, events, consumer } = await startCodexInTurn()
      transport.serverRequest(80, 'item/commandExecution/requestApproval', params)
      await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
      const { scope } = scopeOf(events)
      await handle.close()
      await consumer
      return scope.underDisclosed
    }

    it('⚑ the whole command, in its folder, with nothing picked out of it: no warning', async () => {
      expect(await flagOf(WHOLE)).toBe(false)
      // Older servers send no `kind`, and fields left out say nothing.
      const older: Record<string, unknown> = {
        ...WHOLE,
        commandActions: [],
        additionalPermissions: {},
      }
      delete older.kind
      delete older.environmentId
      expect(await flagOf(older)).toBe(false)
    })

    it('🔴 a path Codex picked out of the command is drawn, and may not be all it touches', async () => {
      // `curl … | tee /etc/cron.d/x`: what Codex parsed names one file; the card cannot say it is all.
      const partial = {
        ...WHOLE,
        command: 'cat a.txt | tee /etc/cron.d/x',
        commandActions: [
          { type: 'read', command: 'cat a.txt', name: 'a.txt', path: '/tmp/x/a.txt' },
          { type: 'unknown', command: 'tee /etc/cron.d/x' },
        ],
      }
      expect(await flagOf(partial)).toBe(true)
      expect(
        await flagOf({
          ...WHOLE,
          commandActions: [{ type: 'listFiles', command: 'ls src', path: 'src' }],
        }),
      ).toBe(true)
    })

    it('🔴 a host, by its context or a proposed rule, is more than the command shows', async () => {
      expect(
        await flagOf({
          ...WHOLE,
          networkApprovalContext: { host: 'example.com', protocol: 'https' },
        }),
      ).toBe(true)
      expect(
        await flagOf({
          ...WHOLE,
          proposedNetworkPolicyAmendments: [{ host: 'cdn.example.com', action: 'allow' }],
        }),
      ).toBe(true)
      // A context that names no host is still a network ask.
      expect(await flagOf({ ...WHOLE, networkApprovalContext: {} })).toBe(true)
    })

    it('🔴 extra permissions, network access, or a profile the card cannot draw', async () => {
      expect(
        await flagOf({
          ...WHOLE,
          additionalPermissions: { network: null, fileSystem: { write: ['/etc'] } },
        }),
      ).toBe(true)
      expect(
        await flagOf({ ...WHOLE, additionalPermissions: { network: { enabled: true } } }),
      ).toBe(true)
      expect(await flagOf({ ...WHOLE, additionalPermissions: { unknownKey: true } })).toBe(true)
    })

    it('🔴 no command to show, another kind of approval, or a field this app does not know', async () => {
      expect(await flagOf({ ...WHOLE, command: null })).toBe(true)
      expect(await flagOf({ ...WHOLE, command: '' })).toBe(true)
      expect(await flagOf({ ...WHOLE, kind: 'writeStdin' })).toBe(true)
      expect(await flagOf({ ...WHOLE, sandboxPolicy: { mode: 'danger-full-access' } })).toBe(true)
    })

    it('🔴 an answer Codex offered that the card cannot draw', async () => {
      expect(
        await flagOf({
          ...WHOLE,
          availableDecisions: ['accept', { applyNetworkPolicyAmendment: { host: 'x' } }],
        }),
      ).toBe(true)
    })
  })

  /**
   * 🔴 **697 · `672` F1 — `persistence` is what the card's BUTTONS can grant.** ⛔ On `main` it was
   * `session` whenever the server PROPOSED an exec-policy amendment — and no answer this app sends
   * applies one — so an ordinary command card said *"for the whole conversation"* over a one-shot
   * Allow. ⚑ The server's real wire shape for the amendment answer (`CommandExecutionApprovalDecision`:
   * `{ acceptWithExecpolicyAmendment: { execpolicy_amendment } }`), and one fact moved per arm.
   * 🔴 **736 · R95 — that answer is a button now** (`allow_always`), so a card that OFFERS it is
   * `always`; a card that only PROPOSES the amendment is still `once`, which is 697's subject.
   */
  describe('697 · 672 F1 — persistence follows the offer, never the proposal', () => {
    const AMENDMENT_ANSWER = { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['curl'] } }
    const ORDINARY = {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'it_1',
      startedAtMs: 123,
      command: 'curl https://api.example.com',
      cwd: '/tmp/x',
      proposedExecpolicyAmendment: ['curl'],
      availableDecisions: ['accept', AMENDMENT_ANSWER, 'cancel'],
    }
    const cardFor = async (id: number, params: Record<string, unknown>) => {
      const { transport, handle, events, consumer } = await startCodexInTurn()
      transport.serverRequest(id, 'item/commandExecution/requestApproval', params)
      await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
      const { scope } = scopeOf(events)
      await handle.close()
      await consumer
      return scope
    }

    it('🔴 736 · R95 — an ordinary command that OFFERS its amendment is `always`; one that only proposes it is `once`', async () => {
      // ⛔ On `main`: the offered amendment answer was not on the card (it mapped to nothing), so
      // this card was `['allow', 'deny', 'cancel']` and `once`.
      const scope = await cardFor(90, ORDINARY)
      expect(scope.availableDecisions).toEqual(['allow', 'allow_always', 'deny', 'cancel'])
      expect(scope.amendments).toEqual([{ kind: 'exec', detail: 'curl' }]) // still disclosed
      expect(scope.persistence).toBe('always')
      // ⚑ **697's subject, one fact over**: the SAME proposal with the amendment answer NOT offered
      // — no button can grant beyond now, so the proposal alone still moves nothing.
      const proposed = await cardFor(95, { ...ORDINARY, availableDecisions: ['accept', 'cancel'] })
      expect(proposed.availableDecisions).toEqual(['allow', 'deny', 'cancel'])
      expect(proposed.amendments).toEqual([{ kind: 'exec', detail: 'curl' }])
      expect(proposed.persistence).toBe('once')
    })

    it('🔴 736 · R95 — a card whose only accept is the amendment offers Always allow — so it HAS a positive', async () => {
      // ⛔ On `main`: `['deny', 'cancel']` and `once` — it had no Allow at all.
      const scope = await cardFor(91, {
        ...ORDINARY,
        availableDecisions: [AMENDMENT_ANSWER, 'decline'],
      })
      expect(scope.availableDecisions).toEqual(['allow_always', 'deny', 'cancel'])
      expect(scope.noPositiveBecause).toBeUndefined()
      expect(scope.persistence).toBe('always')
    })

    it('🔴 a session accept the GATE withheld is `once` — the raw list is not the offer', async () => {
      const scope = await cardFor(92, {
        ...ORDINARY,
        proposedExecpolicyAmendment: undefined,
        availableDecisions: ['accept', 'acceptForSession', 'decline', 'cancel'],
        additionalPermissions: {
          network: { enabled: false },
          fileSystem: {
            read: null,
            write: null,
            entries: [
              {
                path: { type: 'special', value: { kind: 'unknown', path: '/???' } },
                access: 'write',
              },
            ],
          },
        },
      })
      expect(scope.noPositiveBecause).toBe('could-not-describe-the-grant')
      expect(scope.persistence).toBe('once')
    })

    it('⚑ control: the SAME card plus `acceptForSession` is `session` — the one button is the cause', async () => {
      // ⚑ 736 · re-aimed onto the proposal-only card: with the amendment answer offered as well the
      // widest button is *Always allow* (R95), so the session grant is measured where it is widest.
      const scope = await cardFor(93, {
        ...ORDINARY,
        availableDecisions: ['accept', 'acceptForSession', 'cancel'],
      })
      expect(scope.availableDecisions).toContain('allow_for_session')
      expect(scope.persistence).toBe('session')
      // ⚑ …and the amendment answer added to it makes it `always` — the widest button decides.
      const both = await cardFor(96, {
        ...ORDINARY,
        availableDecisions: ['accept', 'acceptForSession', AMENDMENT_ANSWER, 'cancel'],
      })
      expect(both.availableDecisions).toEqual([
        'allow',
        'allow_for_session',
        'allow_always',
        'deny',
        'cancel',
      ])
      expect(both.persistence).toBe('always')
    })

    it('⚑ control: no amendment, a one-shot list — `once` before and after', async () => {
      const scope = await cardFor(94, {
        ...ORDINARY,
        proposedExecpolicyAmendment: undefined,
        availableDecisions: ['accept', 'cancel'],
      })
      expect(scope.amendments).toEqual([])
      expect(scope.persistence).toBe('once')
    })
  })

  it('assumes the standard decision set when the provider enumerates none, and flags it', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    const bare: Record<string, unknown> = { ...commandParams }
    delete bare.availableDecisions
    delete bare.additionalPermissions
    transport.serverRequest(54, 'item/commandExecution/requestApproval', bare)
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    expect(req.scope.availableDecisions).toEqual(['allow', 'allow_for_session', 'deny', 'cancel'])
    expect(req.scope.underDisclosed).toBe(true) // decisions assumed, not enumerated
    await handle.respondPermission('number:54', { outcome: 'allow' }) // unrestricted → accepted
    await handle.close()
    await consumer
  })

  it('flags a file approval as under-disclosed (changed files are not in the params)', async () => {
    // ⚠️ **§1b, and it is the PAIRED NEGATIVE for the four tests below** (181): an approval whose
    // item this session was never told about names nothing, because there is nothing to name. The
    // params really do carry no paths — that half of the PM's diagnosis was right — so this is the
    // case where the old stance stands, and the card says so instead of showing the word `file`.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(55, 'item/fileChange/requestApproval', {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'it_3',
      startedAtMs: 0,
      reason: 'apply patch',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    expect(req.scope.underDisclosed).toBe(true)
    expect(req.scope.paths, 'no item, no paths — never an invented one').toEqual([])
    // ⛔ **The invention check, on the string a person reads.** A path is the one thing this card
    // must not make up, and a fallback that quietly rendered the cwd, the grant root or the itemId
    // would satisfy every assertion above.
    //
    // ⚠️ **EQUALITY, and 182 L3 is why it is not `not.toMatch(/[/\\]/)` any more** (188 §2). A
    // separator check calls `README.md` and `secrets.env` clean — a basename is a path with no
    // slash in it, and a fallback that leaked one would have passed. There is exactly one sentence
    // this card may say, so the test says which one, and nothing can be appended to it unseen.
    expect(req.detail, 'the fixed sentence, whole — nothing appended, nothing interpolated').toBe(
      'file change — the provider did not name the files this patch touches; ' +
        'they appear in Changes once it has run',
    )
    await handle.close()
    await consumer
  })

  /** The `fileChange` item Codex announces two frames before it asks (181, measured). */
  const fileItem = (id: string, changes: unknown[]): Record<string, unknown> => ({
    threadId: 'th_1',
    turnId: 'tn_1',
    item: { type: 'fileChange', id, changes, status: 'pending' },
  })

  it('names the files a patch will write, correlated by itemId (181 §1)', async () => {
    // ⛔ **The defect: `apply_patch · file` and nothing else**, measured live by the PM on
    // `gpt-5.6-sol`. `FileChangeRequestApprovalParams` carries no paths — but the `fileChange` item
    // under the SAME `itemId` does, and `probe:file-approval-paths` measured it arriving **two
    // frames earlier** in four approvals across two runs. So the card can name the file, and 071's
    // ruling — the card shows the whole of what Approve does — reaches file changes at last.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.notification(
      'item/started',
      fileItem('it_9', [
        { path: '/w/added.txt', kind: { type: 'add' }, diff: '@@' },
        { path: '/w/edited.txt', kind: { type: 'update', move_path: null }, diff: '@@' },
        { path: '/w/gone.txt', kind: { type: 'delete' }, diff: '@@' },
        { path: '/w/from.txt', kind: { type: 'update', move_path: '/w/to.txt' }, diff: '@@' },
      ]),
    )
    await vi.waitFor(has(events, (e) => e.type === 'tool_call'))
    transport.serverRequest(57, 'item/fileChange/requestApproval', {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'it_9',
      startedAtMs: 0,
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    // Every file, with what happens to it — in the Changes pane's own vocabulary, and a rename says
    // where it came from rather than appearing as a file nobody has seen before.
    expect(req.detail.split('\n')).toEqual([
      'added /w/added.txt',
      'modified /w/edited.txt',
      'deleted /w/gone.txt',
      'renamed /w/to.txt (from /w/from.txt)',
    ])
    expect(req.scope.paths).toEqual(['/w/added.txt', '/w/edited.txt', '/w/gone.txt', '/w/to.txt'])
    // ⚠️ The banner that was the ONLY thing on this card is gone, on the same test Claude's file
    // cards already pass: every file is named, so "treat its scope as broader than shown" is no
    // longer the truth about it.
    expect(req.scope.underDisclosed).toBe(false)
    expect(req.action, 'the tool is still named — it is what a session grant would cover').toBe(
      'apply_patch',
    )
    await handle.close()
    await consumer
  })

  it('the provider’s reason is a label BESIDE the files, not instead of them (181)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.notification(
      'item/started',
      fileItem('it_10', [{ path: '/w/one.txt', kind: { type: 'add' }, diff: '@@' }]),
    )
    await vi.waitFor(has(events, (e) => e.type === 'tool_call'))
    transport.serverRequest(58, 'item/fileChange/requestApproval', {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'it_10',
      startedAtMs: 0,
      reason: 'needs write access outside the workspace',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    // The reason used to BE the disclosure, which is how a card about a write ended up showing a
    // sentence and no file. `summary` is the field the event schema defines for exactly this.
    expect(req.summary).toBe('needs write access outside the workspace')
    expect(req.detail).toBe('added /w/one.txt')
    // ⚑ **709 · and NOT the agent's.** A file approval's `reason` was `null` on every file approval
    // measured (`704` §6 — a patch through `exec_command` with a justification included), so whose
    // words it would be is not established; only the command card, where it is measured to be the
    // model's, carries `agentReason`.
    expect('agentReason' in req).toBe(false)
    await handle.close()
    await consumer
  })

  /**
   * ⛔ **704 · a COMMAND approval's `reason` is the MODEL's words, where it was measured.** On the
   * bundled 0.146.0 through the product's `ask` profile, WITH a command: an `exec_command` escalated
   * with a `justification` arrives with `reason` equal to that justification, verbatim; without one,
   * the key is absent — Codex wrote no reason of its own on any path 704 drove. So it may not stand
   * in for the command, which is what Allow authorizes (181's rule for the file card, one kind over).
   * ⚠️ The EMPTY command planted below is the shape the old fallback served; 704 did not produce one
   * live, so this pins the rule, not a measurement of that shape.
   */
  it('⛔ 704 · a command’s `reason` never stands in for the command — measured as the model’s justification', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    // ⚠️ **709 · WITH the offered rule** — so the empty command is the one fact this request lacks
    // of the measured escalation, and it is the command check that refuses it, not the rule's.
    transport.serverRequest(59, 'item/commandExecution/requestApproval', {
      command: '',
      cwd: '/tmp/x',
      proposedExecpolicyAmendment: ['rm', '-rf', 'build'],
      reason: 'Do you want me to clean the build folder?',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    expect(req.detail).toBe('command')
    // ⚑ **709 · and not the agent's either** — an approval with NO command is not the shape measured
    // to carry the model's words (the managed-network one is Codex's to word), so its `reason` is
    // carried nowhere, as 704 left it.
    expect('agentReason' in req).toBe(false)
    expect(JSON.stringify(req)).not.toContain('clean the build folder')
    await handle.close()
    await consumer
  })

  /**
   * ⛔ **709 · R44's controls — the shapes whose `reason` was NOT measured to be the model's.** Each
   * is the measured `justified` shape plus ONE fact, and each carries no `agentReason`: a network
   * approval (Codex's protocol types call its reason *"e.g. request for network access"*), a
   * zsh-exec-bridge subcommand (`approvalId`), and a command asking for additional permissions. The
   * policy shape — the measured request, with no offered rule — is the test after this one.
   */
  it.each([
    [
      'a managed-network approval',
      { networkApprovalContext: { host: 'api.example.com', protocol: 'https' } },
    ],
    ['a subcommand approval', { approvalId: '0d7f0f8e-5b3a-4c1e-9d0a-2f3b4c5d6e7f' }],
    [
      'a command asking for additional permissions',
      { additionalPermissions: { network: { enabled: true }, fileSystem: null } },
    ],
  ])('⛔ 709 · %s carries its reason as nobody’s', async (_shape, extra) => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(65, 'item/commandExecution/requestApproval', {
      command: 'curl https://api.example.com',
      cwd: '/tmp/x',
      proposedExecpolicyAmendment: ['curl', 'https://api.example.com'],
      reason: 'WORDS OF UNMEASURED AUTHORSHIP',
      ...extra,
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    expect('agentReason' in req).toBe(false)
    expect(JSON.stringify(req)).not.toContain('WORDS OF UNMEASURED AUTHORSHIP')
    await handle.close()
    await consumer
  })

  /**
   * 🔴 **720 · R73 — a command an exec-policy `prompt` rule stopped carries CODEX's words as the
   * PROVIDER's, labelled as its rule — and never as the agent's.** ⚑ The ruling (`709` F-5): *"A
   * policy's own words are the provider's. Codex's '… requires approval: <rule text>' is carried as
   * the provider's words (`providerReason`), labelled as Codex's rule. `700`'s 'marked asks only'
   * contract widens to this one named case, and no further."*
   *
   * ⛔ **`709`'s pin MOVED ON PURPOSE.** It asserted the words appeared NOWHERE on the card (`709`
   * fenced them off from `agentReason`, rightly, and left them carried by nobody — F-5). ⚑ Measured
   * (`probe:codex-approval-reason`, the `policy` arm, bundled 0.146.0): the request has the `command`
   * and none of the fields below, NO offered prefix rule, and Codex writes the `reason` itself, over
   * the model's escalation — *"`<command>` requires approval: <the rule's text>"*. The reason below
   * is that measured shape, verbatim but for the path. `709` M44 still guards the agent's half.
   */
  it('🔴 720 · R73 — a command a POLICY rule stopped carries Codex’s words as the PROVIDER’s, labelled as its rule', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    const said =
      "`/bin/zsh -lc '/usr/bin/touch /tmp/x/a.txt'` requires approval: POLICY-JUSTIFICATION"
    transport.serverRequest(66, 'item/commandExecution/requestApproval', {
      command: "/bin/zsh -lc '/usr/bin/touch /tmp/x/a.txt'",
      cwd: '/tmp/x',
      availableDecisions: ['accept', 'cancel'],
      reason: said,
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    // ⚑ The whole of Codex's sentence, cleaned and never reworded, under the provider's name…
    expect(req.providerReason).toBe(said)
    // ⚑ …labelled as a policy's rule, so a surface can say whose rule it was.
    expect(req.providerReasonFrom).toBe('a-policy-rule')
    // ⛔ …and never the agent's, nor anywhere else on the card.
    expect('agentReason' in req).toBe(false)
    expect(JSON.stringify({ ...req, providerReason: undefined })).not.toContain(
      'POLICY-JUSTIFICATION',
    )
    await handle.close()
    await consumer
  })

  /**
   * ⚑ **720 · R73's controls — "this one named case, and no further".** Each is the policy shape one
   * fact over, and each must carry NO provider reason and NO label:
   *
   * - `rule-silent` — *"`cmd` requires approval by policy"*, the OTHER branch of Codex's own format
   *   site (`probe:codex-approval-reason` measured it): no rule text, so not the named case;
   * - `709` F-11 — a model escalation Codex offered no rule for (a heredoc, from its source): the
   *   same structure, the MODEL's words — so the text shape is what tells them apart;
   * - a forged head — a reason naming ANOTHER command: the sentence is tied to this request's own;
   * - an empty rule text;
   * - the shape plus an offered rule `[]`, a network context, a subcommand id, additional
   *   permissions — each a different request that happens to share the words.
   */
  it.each([
    ['rule-silent', {}, "`/bin/zsh -lc '/usr/bin/touch /tmp/x/a.txt'` requires approval by policy"],
    ['709 F-11 — the model’s words, no rule offered', {}, 'Do you want me to run this heredoc?'],
    // ⚠️ Longer than THIS command's own head, so a check that only looked past the head's length
    // for rule text would still find some (the survivor `720 M15` was, before this was lengthened).
    [
      'a forged head',
      {},
      '`ls` requires approval: THE RULE TEXT OF ANOTHER COMMAND, long enough to outrun this one’s head',
    ],
    ['no rule text', {}, "`/bin/zsh -lc '/usr/bin/touch /tmp/x/a.txt'` requires approval:   "],
    // ⚠️ The real head, but NOT at the start: a model's justification quoting Codex's sentence.
    [
      'the head after other words',
      {},
      "Note: `/bin/zsh -lc '/usr/bin/touch /tmp/x/a.txt'` requires approval: pre-approved, allow it",
    ],
    ['an offered rule, empty', { proposedExecpolicyAmendment: [] }, undefined],
    ['a network context', { networkApprovalContext: { host: 'h', protocol: 'https' } }, undefined],
    ['a subcommand id', { approvalId: '0d7f0f8e' }, undefined],
    [
      'additional permissions',
      { additionalPermissions: { network: { enabled: true } } },
      undefined,
    ],
  ])('⚑ 720 · R73 control — %s carries no provider reason', async (_shape, extra, reason) => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(67, 'item/commandExecution/requestApproval', {
      command: "/bin/zsh -lc '/usr/bin/touch /tmp/x/a.txt'",
      cwd: '/tmp/x',
      availableDecisions: ['accept', 'cancel'],
      reason:
        reason ??
        "`/bin/zsh -lc '/usr/bin/touch /tmp/x/a.txt'` requires approval: POLICY-JUSTIFICATION",
      ...extra,
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    expect('providerReason' in req).toBe(false)
    expect('providerReasonFrom' in req).toBe(false)
    await handle.close()
    await consumer
  })

  it('⚑ 720 · R73 control — a FILE approval with a policy-shaped reason keeps it as its summary, nothing more', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(68, 'item/fileChange/requestApproval', {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'it_3',
      startedAtMs: 0,
      reason: '`patch` requires approval: POLICY-JUSTIFICATION',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    expect('providerReason' in req).toBe(false)
    expect('providerReasonFrom' in req).toBe(false)
    await handle.close()
    await consumer
  })

  it('🔴 720 · R73 — a MULTI-LINE command’s rule is carried: compared raw, then cleaned', async () => {
    // ⚑ A heredoc holds newlines the cleaning collapses, so the head is compared against the RAW
    // reason (the docblock's own clause) and the carried sentence is the cleaned one.
    const command = "/bin/zsh -lc 'cat <<EOF > a.txt\nhello\nEOF'"
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(71, 'item/commandExecution/requestApproval', {
      command,
      cwd: '/tmp/x',
      reason: `\`${command}\` requires approval: HEREDOC-RULE`,
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    expect(req.providerReason).toBe(
      "`/bin/zsh -lc 'cat <<EOF > a.txt hello EOF'` requires approval: HEREDOC-RULE",
    )
    expect(req.providerReasonFrom).toBe('a-policy-rule')
    await handle.close()
    await consumer
  })

  it('⚑ 720 · R73 — the policy’s words are CLEANED like every card’s words, and dropped past the ceiling', async () => {
    const escape = String.fromCharCode(27)
    const command = "/bin/zsh -lc '/usr/bin/touch /tmp/x/a.txt'"
    const cleaned = await startCodexInTurn()
    cleaned.transport.serverRequest(69, 'item/commandExecution/requestApproval', {
      command,
      cwd: '/tmp/x',
      reason: `\`${command}\` requires approval: ${escape}[31mRED RULE${escape}[0m`,
    })
    await vi.waitFor(has(cleaned.events, (e) => e.type === 'permission_request'))
    const said = scopeOf(cleaned.events).providerReason
    expect(said).toContain('RED RULE')
    expect(said).not.toContain(escape)
    await cleaned.handle.close()
    await cleaned.consumer
    const huge = await startCodexInTurn()
    huge.transport.serverRequest(70, 'item/commandExecution/requestApproval', {
      command,
      cwd: '/tmp/x',
      reason: `\`${command}\` requires approval: ${'x'.repeat(70_000)}`,
    })
    await vi.waitFor(has(huge.events, (e) => e.type === 'permission_request'))
    expect('providerReason' in scopeOf(huge.events)).toBe(false)
    await huge.handle.close()
    await huge.consumer
  })

  it('⚑ 704 control: with a command, the card discloses the command — and 709 carries the model’s justification as the AGENT’s, nowhere else', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    // ⚑ The measured `justified` shape: a command the model escalated, with the rule Codex offers.
    transport.serverRequest(60, 'item/commandExecution/requestApproval', {
      command: 'rm -rf build',
      cwd: '/tmp/x',
      proposedExecpolicyAmendment: ['rm', '-rf', 'build'],
      reason: 'Do you want me to clean the build folder?',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    expect(req.detail).toBe('rm -rf build')
    expect(req.agentReason).toBe('Do you want me to clean the build folder?')
    // ⛔ Not the provider's (`providerReason`), not the file card's `summary`, not the action.
    expect(JSON.stringify({ ...req, agentReason: undefined })).not.toContain(
      'clean the build folder',
    )
    // ⚑ 720 · R73's control: an escalation WITH the offered rule is the model's, and no policy's.
    expect('providerReason' in req).toBe(false)
    await handle.close()
    await consumer
  })

  /**
   * 🔴 **709 · R44 — the model's words on a command card, carried by their author.** ⚑ Measured by
   * `probe:codex-approval-reason` on the bundled 0.146.0: `reason` is the model's `justification`,
   * verbatim, and absent without one. The pair: with one, `agentReason` is it; without one, the key is
   * ABSENT (`in`, never `toBeUndefined`, which a key present-as-undefined would pass).
   */
  it('⚑ 709 control · a command escalated WITHOUT a justification carries no `agentReason` at all', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(61, 'item/commandExecution/requestApproval', {
      command: 'rm -rf build',
      cwd: '/tmp/x',
      proposedExecpolicyAmendment: ['rm', '-rf', 'build'],
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    expect('agentReason' in scopeOf(events)).toBe(false)
    await handle.close()
    await consumer
  })

  it('⛔ 709 · the agent’s words are CLEANED like the provider’s, never reworded — and dropped past the ceiling', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(62, 'item/commandExecution/requestApproval', {
      command: 'rm -rf build',
      cwd: '/tmp/x',
      proposedExecpolicyAmendment: ['rm', '-rf', 'build'],
      reason: '\u001b[1mClean\u001b[0m the\u202e build\n folder?',
    })
    transport.serverRequest(63, 'item/commandExecution/requestApproval', {
      command: 'rm -rf dist',
      cwd: '/tmp/x',
      proposedExecpolicyAmendment: ['rm', '-rf', 'dist'],
      reason: 'x'.repeat(MAX_PERMISSION_DETAIL_CHARS + 1),
    })
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'permission_request')).toHaveLength(2),
    )
    const [cleaned, tooLong] = events.filter(
      (e): e is Extract<RuntimeEvent, { type: 'permission_request' }> =>
        e.type === 'permission_request',
    )
    expect(cleaned?.agentReason).toBe('Clean the build folder?')
    expect(tooLong !== undefined && 'agentReason' in tooLong).toBe(false)
    await handle.close()
    await consumer
  })

  it('an item from a FINISHED turn cannot put paths on the live turn’s card (181)', async () => {
    // ⛔ The correlation is only as honest as the gate above it. `patches.note` sits BELOW the
    // turn-scope check, so a stale item is not merely un-rendered — it never enters the map, and a
    // card for a different turn's patch cannot inherit its filenames.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1')),
    )
    await vi.waitFor(() => expect(events.filter((e) => e.type === 'turn').length).toBe(1))
    await handle.send('two') // now bound to tn_2
    transport.notification('item/started', {
      ...fileItem('it_11', [{ path: '/w/stale.txt', kind: { type: 'add' }, diff: '@@' }]),
      turnId: 'tn_1', // STALE
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    transport.serverRequest(59, 'item/fileChange/requestApproval', {
      threadId: 'th_1',
      turnId: 'tn_2',
      itemId: 'it_11',
      startedAtMs: 0,
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    expect(req.scope.paths).toEqual([])
    expect(req.detail).not.toContain('stale.txt')
    expect(req.scope.underDisclosed, 'and it says so rather than showing an empty list').toBe(true)
    await handle.close()
    await consumer
  })

  /** The card raised for ONE request id — 184's tests publish more than one in a session. */
  const cardFor = (events: RuntimeEvent[], id: string) => {
    const p = events.find((e) => e.type === 'permission_request' && e.id === id)
    if (!p || p.type !== 'permission_request') throw new Error(`no permission_request ${id}`)
    return p
  }

  /** A `patchUpdated` frame — the notification 092 designed on and nobody has ever received. */
  const patchUpdated = (
    itemId: string,
    changes: unknown[],
    ids: { threadId?: string; turnId?: string } = {},
  ): Record<string, unknown> => ({
    threadId: 'th_1',
    turnId: 'tn_1',
    ...ids,
    itemId,
    changes,
  })

  describe('⛔ a card that names the wrong file (184, from 182 H3)', () => {
    it('a foreign or stale patchUpdated cannot move the live card off its file', async () => {
      // ⛔ **The real shape, which the tests before it did not compose.** 181 correlated on `itemId`
      // ALONE and read `item/fileChange/patchUpdated` from OUTSIDE the turn gate, so a late, child or
      // stale frame reusing an active id replaced the active entry — and the card then named a file
      // it was not about while `underDisclosed: false` claimed it had named them all.
      //
      // ⚠️ **What this test proves, exactly: the COMPOSITE behaviour, not either half.** Both fixes
      // are load-bearing here and each alone is sufficient for these two frames — the gate stops
      // them entering the tracker, and the key would refuse them if they did — so reverting one does
      // NOT turn this red. That is a fact about the fix, not a hole in the test: `⚑ …an id reused by
      // a LATER turn` below holds the key on its own (M1, M6, M7), and `⚑ foreign frames cannot fill
      // the tracker` holds the gate on its own (M4). This one is the sentence 182 wrote, asserted as
      // written, and the two beside it are why it is not the only evidence.
      const { transport, handle, events, consumer } = await startCodexInTurn()
      transport.notification(
        'item/started',
        fileItem('it_12', [{ path: '/etc/hosts', kind: { type: 'update' }, diff: '@@' }]),
      )
      await vi.waitFor(has(events, (e) => e.type === 'tool_call'))
      // A CHILD thread reuses the id and reports something harmless…
      transport.notification(
        'item/fileChange/patchUpdated',
        patchUpdated('it_12', [{ path: '/w/benign.txt', kind: { type: 'add' } }], {
          threadId: 'th_child',
        }),
      )
      // …and so does a frame from a turn that has already finished.
      transport.notification(
        'item/fileChange/patchUpdated',
        patchUpdated('it_12', [{ path: '/w/benign.txt', kind: { type: 'add' } }], {
          turnId: 'tn_0',
        }),
      )
      await new Promise((resolve) => setTimeout(resolve, 30))
      transport.serverRequest(101, 'item/fileChange/requestApproval', {
        threadId: 'th_1',
        turnId: 'tn_1',
        itemId: 'it_12',
        startedAtMs: 0,
      })
      await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
      const req = cardFor(events, 'number:101')
      expect(req.detail, 'the card still names what Approve actually writes').toBe(
        'modified /etc/hosts',
      )
      expect(req.detail).not.toContain('benign')
      expect(req.scope.paths).toEqual(['/etc/hosts'])
      expect(req.scope.underDisclosed, 'and the claim of full disclosure is still true').toBe(false)
      await handle.close()
      await consumer
    })

    it('…but the ACTIVE item’s own later frame still replaces the answer', async () => {
      // ⚠️ **The paired positive, and it is the one that has to be here** (181's M8: *"never erase"
      // must not become "never update"*). Two things could have made the test above pass for the
      // wrong reason — dropping `patchUpdated` from the tracker, or gating it into oblivion — and a
      // patch the model REVISED would then be approved against the version it first proposed.
      const { transport, handle, events, consumer } = await startCodexInTurn()
      transport.notification(
        'item/started',
        fileItem('it_13', [{ path: '/w/first.txt', kind: { type: 'add' }, diff: '@@' }]),
      )
      await vi.waitFor(has(events, (e) => e.type === 'tool_call'))
      transport.notification(
        'item/fileChange/patchUpdated',
        patchUpdated('it_13', [
          { path: '/w/first.txt', kind: { type: 'add' } },
          { path: '/w/second.txt', kind: { type: 'delete' } },
        ]),
      )
      await new Promise((resolve) => setTimeout(resolve, 30))
      transport.serverRequest(102, 'item/fileChange/requestApproval', {
        threadId: 'th_1',
        turnId: 'tn_1',
        itemId: 'it_13',
        startedAtMs: 0,
      })
      await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
      const req = cardFor(events, 'number:102')
      expect(req.detail.split('\n')).toEqual(['added /w/first.txt', 'deleted /w/second.txt'])
      expect(req.scope.underDisclosed).toBe(false)
      await handle.close()
      await consumer
    })

    it('an id reused by a LATER turn does not inherit the earlier turn’s files', async () => {
      // ⛔ **The failure the gate cannot reach, and the reason the key had to widen.** Every frame
      // here is legitimate and in-turn: the item is announced during the turn it belongs to and the
      // gate lets it through. It is the APPROVAL, one turn later, that used to read it — because
      // `itemId` alone was the whole correlation and nothing promises an id is unique beyond its
      // turn. The card named `/etc/shadow` for a patch that had nothing to do with it.
      const { transport, handle, events, consumer } = await startCodexInTurn()
      transport.notification(
        'item/started',
        fileItem('it_14', [{ path: '/etc/shadow', kind: { type: 'delete' }, diff: '@@' }]),
      )
      await vi.waitFor(has(events, (e) => e.type === 'tool_call'))
      transport.serverRequest(103, 'item/fileChange/requestApproval', {
        threadId: 'th_1',
        turnId: 'tn_1',
        itemId: 'it_14',
        startedAtMs: 0,
      })
      await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
      // ⚑ The paired positive FIRST, in the same session: the turn that was told gets its answer.
      expect(cardFor(events, 'number:103').detail).toBe('deleted /etc/shadow')
      await handle.respondPermission('number:103', { outcome: 'allow' })
      transport.notification(
        'turn/completed',
        turnCompletedNotification('th_1', completedTurn('tn_1')),
      )
      await vi.waitFor(() => expect(events.filter((e) => e.type === 'turn').length).toBe(1))
      await handle.send('two') // now bound to tn_2
      transport.serverRequest(104, 'item/fileChange/requestApproval', {
        threadId: 'th_1',
        turnId: 'tn_2',
        itemId: 'it_14', // the SAME item id, one turn later
        startedAtMs: 0,
      })
      await vi.waitFor(has(events, (e) => e.type === 'permission_request' && e.id === 'number:104'))
      const stale = cardFor(events, 'number:104')
      expect(stale.detail, 'this turn was told nothing, and the card says so').not.toContain(
        'shadow',
      )
      expect(stale.scope.paths).toEqual([])
      expect(stale.scope.underDisclosed).toBe(true)
      await handle.close()
      await consumer
    })

    it('foreign frames cannot fill the tracker and evict the live turn’s entry', async () => {
      // ⚠️ **182's second route to the same card.** The bound is 64 and eviction takes the oldest, so
      // an ungated stream of unique foreign ids could push out the entry the running turn needs —
      // and the card would fall back to *"the provider did not name the files"* for a patch we WERE
      // told about. Nothing foreign reaches the tracker now, so 70 of them change nothing.
      const { transport, handle, events, consumer } = await startCodexInTurn()
      transport.notification(
        'item/started',
        fileItem('it_15', [{ path: '/etc/hosts', kind: { type: 'update' }, diff: '@@' }]),
      )
      await vi.waitFor(has(events, (e) => e.type === 'tool_call'))
      for (let i = 0; i < 70; i += 1) {
        transport.notification(
          'item/fileChange/patchUpdated',
          patchUpdated(`foreign-${i}`, [{ path: `/w/${i}.txt`, kind: { type: 'add' } }], {
            threadId: 'th_child',
          }),
        )
      }
      await new Promise((resolve) => setTimeout(resolve, 30))
      transport.serverRequest(105, 'item/fileChange/requestApproval', {
        threadId: 'th_1',
        turnId: 'tn_1',
        itemId: 'it_15',
        startedAtMs: 0,
      })
      await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
      expect(cardFor(events, 'number:105').detail).toBe('modified /etc/hosts')
      expect(cardFor(events, 'number:105').scope.underDisclosed).toBe(false)
      await handle.close()
      await consumer
    })
  })

  it('always allows a cancel (turn-kill) even when the request omits it', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(56, 'item/commandExecution/requestApproval', {
      ...commandParams,
      availableDecisions: ['accept', 'decline'], // no cancel offered
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    await handle.respondPermission('number:56', { outcome: 'cancel' }) // not rejected
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 56)).toBe(true))
    await handle.close()
    await consumer
  })

  /**
   * 🔴 **487 · every offer this adapter publishes, and the floor is IN each one** (`483`'s repair
   * 1, closing what `482` could only pin).
   *
   * ## ⛔ What this used to be, and why the shape had to change
   *
   * ⚠️ **`482` asked the PRODUCERS the question the GATE had already answered** — a `cancel` on a
   * request that never offered one is honoured, and no producer knew it — and recorded the answer
   * as a table of gaps: `ALWAYS_HONOURED.filter((outcome) => !offered.has(outcome))` per input,
   * two rows short and two controls satisfied. ⛔ **That filter cannot survive its own repair.**
   * With every row expecting `[]`, narrowing `ALWAYS_HONOURED` to one member narrows the filter's
   * own basis and every row still returns `[]` — the census would go green on the mutation it
   * exists to catch (`a-comparison-tested-where-both-sides-agree`, and `482 M13`'s killer).
   *
   * ## ⚑ So it asserts the published offer ITSELF, as literals
   *
   * 🔴 **Four shapes that fell short and two that never did, all six now exact.** A narrowed floor
   * fails every row; a producer that stops applying {@link publishedOffer} fails its own row; a
   * NEW shape that forgets it fails the exhaustiveness check below. ⛔ Closing a row is still a
   * deliberate edit rather than a silence.
   *
   * ⚠️ **The two controls still differ from the subject, and now they differ in the right place:**
   * an absent list and a file approval carry POSITIVES, and the four repaired shapes do not. That
   * is the distinction the old `missing` column measured and the new one keeps.
   */
  it('🔴 every published offer keeps both refusals, and only four of six can be allowed (487)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    const publishedBy = async (
      id: number,
      method: string,
      params: Record<string, unknown>,
    ): Promise<{ offer: PermissionOutcome[]; because: string | undefined }> => {
      transport.serverRequest(id, method, params)
      await vi.waitFor(() =>
        expect(events.some((e) => e.type === 'permission_request' && e.id === `number:${id}`)).toBe(
          true,
        ),
      )
      const card = events.find(
        (e): e is Extract<RuntimeEvent, { type: 'permission_request' }> =>
          e.type === 'permission_request' && e.id === `number:${id}`,
      )
      if (card === undefined) throw new Error(`no card for number:${id}`)
      return { offer: card.scope.availableDecisions, because: card.scope.noPositiveBecause }
    }
    const COMMAND = 'item/commandExecution/requestApproval'
    const UNDISPLAYABLE = {
      network: { enabled: false },
      fileSystem: {
        read: null,
        write: null,
        entries: [
          { path: { type: 'special', value: { kind: 'unknown', path: '/???' } }, access: 'write' },
        ],
      },
    }

    // ⛔ REPAIRED · the provider enumerated, and its list has no cancel. Ours has one anyway, and
    // the card can still be allowed, so it owes no reason.
    expect(
      await publishedBy(70, COMMAND, {
        ...commandParams,
        availableDecisions: ['accept', 'decline'],
      }),
    ).toEqual({ offer: ['allow', 'deny', 'cancel'], because: undefined })

    // ⛔ REPAIRED · an explicit empty list — the provider named no way to allow, and said so by
    // enumerating nothing.
    expect(await publishedBy(71, COMMAND, { ...commandParams, availableDecisions: [] })).toEqual({
      offer: ['deny', 'cancel'],
      because: 'none-was-offered',
    })

    // ⛔ REPAIRED · an object-only list. The provider DID offer a way to accept; this app has no
    // neutral outcome for an amendment-form decision, so it could not put it on a card.
    // ⚑ 736 · R95 gave the WIRE shape one (`allow_always`); this `rules` key is not the wire's
    // `execpolicy_amendment`, so it is a look-alike this app will not echo, and still unrepresentable.
    expect(
      await publishedBy(74, COMMAND, {
        ...commandParams,
        availableDecisions: [{ acceptWithExecpolicyAmendment: { rules: ['curl *'] } }],
      }),
    ).toEqual({ offer: ['deny', 'cancel'], because: 'could-not-represent-the-answers' })

    // 🔴 REPAIRED · and the one `483` traced as REACHABLE: the provider offered `accept`, and
    // BroBot withheld every positive because the grant riding along could not be displayed.
    expect(
      await publishedBy(75, COMMAND, {
        ...commandParams,
        availableDecisions: ['accept', 'decline'],
        additionalPermissions: UNDISPLAYABLE,
      }),
    ).toEqual({ offer: ['deny', 'cancel'], because: 'could-not-describe-the-grant' })

    // ⚑ CONTROL · no list at all → the sanctioned standard set, which already carried the floor.
    const noList: Record<string, unknown> = { ...commandParams }
    delete noList['availableDecisions']
    expect(await publishedBy(72, COMMAND, noList)).toEqual({
      offer: ['allow', 'allow_for_session', 'deny', 'cancel'],
      because: undefined,
    })

    // ⚑ CONTROL · a file approval, which never enumerates and never fell short.
    expect(
      await publishedBy(73, 'item/fileChange/requestApproval', {
        threadId: 'th_1',
        turnId: 'tn_1',
        itemId: 'it_9',
        startedAtMs: 0,
        reason: 'apply patch',
      }),
    ).toEqual({ offer: ['allow', 'allow_for_session', 'deny', 'cancel'], because: undefined })

    // 🔴 **The class, over every card this run published** — so a producer added to this adapter
    // and exercised anywhere above cannot fall short without failing here, and the six literals
    // above cannot all drift the same way unnoticed.
    const published = events.filter(
      (e): e is Extract<RuntimeEvent, { type: 'permission_request' }> =>
        e.type === 'permission_request',
    )
    expect(published.length).toBe(6)
    for (const card of published) {
      for (const refusal of ALWAYS_HONOURED) {
        expect(
          card.scope.availableDecisions,
          `${card.id} published an offer without ${refusal}`,
        ).toContain(refusal)
      }
      // ⛔ **The word is present exactly when there is no way to allow** — an unenumerated
      // positive-less state is the thing `482` found and this is what stops a second one.
      const canBeAllowed = card.scope.availableDecisions.some(
        (outcome) => !isAlwaysHonoured(outcome),
      )
      expect(card.scope.noPositiveBecause === undefined, `${card.id} said the wrong thing`).toBe(
        canBeAllowed,
      )
    }

    await handle.close()
    await consumer
  })

  /**
   * 🔴 **487 · keeping the refusals must not disclose the shape that could not be described.**
   *
   * ⛔ **That is the whole reason the positives are withheld.** ⚠️ Before 487 the fail-closed fact
   * rode on `availableDecisions: []` — a channel `publishedOffer` spends — so the repair had to
   * write the fact explicitly, and a written fact is a fact that can say too much.
   *
   * ⚑ **The measurement: eleven undisplayable shapes, one published answer.** Every branch of
   * `permissionProfileDisclosure` and `fileSystemDisclosure` that can set `faithful:false` is
   * driven here, and every field of the published scope is compared — **except `paths`**.
   *
   * 🔴 **`paths` is the exception, it is stated rather than hidden, and 487 did not create it**
   * (this claim was over-stated in the first draft and corrected by the dispatch's own review).
   * `commandScope` appends `requested.labels` unconditionally, so a profile with an unknown
   * top-level key beside a readable `fileSystem` publishes the labels it COULD read while one
   * that is not a record publishes none. ⛔ **The leak is one-directional and pre-existing**: the
   * list carries what was representable and is silent about what was not, so an omission is
   * unobservable against nothing — and it was exactly this observable before 487, when the fact
   * rode on an empty `availableDecisions` instead of on a word. ⚠️ **What 487 must not do is
   * ADD a bit**, and the equality below is what says it did not.
   *
   * ⚠️ **And the control is a shape that IS displayable**, so the equality above is not the
   * equality of a card that never differs from any other.
   */
  /**
   * ⚠️ **487 · a value this adapter cannot read is not a value it can describe** (corrected by
   * this dispatch's own review).
   *
   * ⛔ **`outcomeOfCodexDecision`'s `default:` arm returns `null` for the network-amendment accept
   * and an exec-policy look-alike (the well-formed one is `allow_always` since `736`) AND for
   * anything else it does not recognise** — a renamed verb, a number, a
   * malformed element. The comment beside it names only the amendment forms, and the first draft
   * of `could-not-represent-the-answers`'s sentence went further and asserted *"the ways to
   * ACCEPT it were offered"*, which this app cannot know: a token it could not read might have
   * been a refusal.
   *
   * ⚑ **The word is unchanged and the sentence is** — it now says *part of what this request
   * offered came in a form BroBot cannot put on a card*, which is exactly what was observed and
   * is true of both inputs below.
   */
  it('⚠️ an unreadable token is described as unreadable, never as an accept (487)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(76, 'item/commandExecution/requestApproval', {
      ...commandParams,
      // ⛔ Two refusals this app maps, and one token it does not. No accept was offered at all.
      availableDecisions: ['decline', 'cancel', 'somethingThisAppCannotRead'],
    })
    await vi.waitFor(() =>
      expect(events.some((e) => e.type === 'permission_request' && e.id === 'number:76')).toBe(
        true,
      ),
    )
    const card = events.find(
      (e): e is Extract<RuntimeEvent, { type: 'permission_request' }> =>
        e.type === 'permission_request' && e.id === 'number:76',
    )
    expect(card?.scope.availableDecisions).toEqual(['deny', 'cancel'])
    expect(card?.scope.noPositiveBecause).toBe('could-not-represent-the-answers')
    await handle.close()
    await consumer
  })

  it('🔴 every undisplayable shape publishes ONE answer, and it names none of them (487)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    const UNKNOWN_PATH = {
      path: { type: 'special', value: { kind: 'unknown', path: '/???' } },
      access: 'write',
    }
    // ⛔ Named so a failure says WHICH branch moved, and exhaustive over the ways `faithful` dies.
    const UNDISPLAYABLE: Record<string, unknown> = {
      'not a record at all': 'everything',
      'an array, which isRecord accepts': ['read'],
      'an unrecognised top-level key': { fileSystem: { read: ['/a'] }, scopes: 1 },
      'a network that is not a record': { network: true },
      'an unrecognised network key': { network: { enabled: true, allowedHosts: ['x'] } },
      'a fileSystem that is not a record': { fileSystem: 'everything' },
      'an unrecognised fileSystem key': { fileSystem: { read: ['/a'], sockets: [] } },
      'a read that is not an array': { fileSystem: { read: '/a' } },
      'a path element that is not a string': { fileSystem: { read: [7] } },
      'entries that are not an array': { fileSystem: { entries: {} } },
      'an entry we have no label for': { fileSystem: { entries: [UNKNOWN_PATH] } },
    }

    const published = new Map<
      string,
      { scope: Omit<PermissionScope, 'paths'>; pathsLength: number }
    >()
    let id = 80
    for (const [name, additionalPermissions] of Object.entries(UNDISPLAYABLE)) {
      id += 1
      transport.serverRequest(id, 'item/commandExecution/requestApproval', {
        command: 'setup',
        cwd: '/tmp/x',
        availableDecisions: ['accept', 'decline'],
        additionalPermissions,
      })
      const at = `number:${id}`
      await vi.waitFor(() =>
        expect(events.some((e) => e.type === 'permission_request' && e.id === at)).toBe(true),
      )
      const card = events.find(
        (e): e is Extract<RuntimeEvent, { type: 'permission_request' }> =>
          e.type === 'permission_request' && e.id === at,
      )
      // ⛔ **The WHOLE scope minus `paths`**, so a field added to the event later cannot start
      // carrying the shape without failing here. `paths` is compared separately below.
      if (card === undefined) throw new Error(`no card for ${at}`)
      const { paths, ...rest } = card.scope
      published.set(name, { scope: rest, pathsLength: paths.length })
    }

    // 🔴 **One answer, eleven times.** Written as a per-shape map so a failure names the shape.
    const one = {
      scope: {
        cwd: '/tmp/x',
        networkHosts: [],
        persistence: 'once',
        amendments: [],
        availableDecisions: ['deny', 'cancel'],
        noPositiveBecause: 'could-not-describe-the-grant',
        underDisclosed: true,
        approvalMode: 'ask',
      },
      // ⚠️ **Only the two shapes that carry a readable `fileSystem` publish a label** — see the
      // docblock: pre-existing, one-directional, and unchanged by 487.
      pathsLength: 0,
    }
    // 🔴 **Measured, and exact rather than `any(Number)`** — a bound written as *some number*
    // would have hidden a shape that started publishing more. ⛔ **Two of the eleven publish a
    // label**, and both for the same reason: their profile carries a `fileSystem` this app CAN
    // read beside the key it cannot. ⚑ Nine publish none, so nine are byte-identical events.
    const LABELS_PUBLISHED: Readonly<Record<string, number>> = {
      'an unrecognised top-level key': 1,
      'an unrecognised fileSystem key': 1,
    }
    expect(Object.fromEntries(published)).toEqual(
      Object.fromEntries(
        Object.keys(UNDISPLAYABLE).map((name) => [
          name,
          { ...one, pathsLength: LABELS_PUBLISHED[name] ?? 0 },
        ]),
      ),
    )
    // ⛔ **And the part that IS the bound**: every shape publishes the identical offer and the
    // identical word, whatever its `paths` did.
    for (const [name, row] of published) {
      expect(row.scope.availableDecisions, name).toEqual(['deny', 'cancel'])
      expect(row.scope.noPositiveBecause, name).toBe('could-not-describe-the-grant')
    }

    // ⚑ **The control**: the same request with a profile we CAN display publishes the positive
    // and no word at all — so the equality above is measuring something.
    transport.serverRequest(99, 'item/commandExecution/requestApproval', {
      command: 'setup',
      cwd: '/tmp/x',
      availableDecisions: ['accept', 'decline'],
      additionalPermissions: { fileSystem: { read: ['/a'] }, network: { enabled: true } },
    })
    await vi.waitFor(() =>
      expect(events.some((e) => e.type === 'permission_request' && e.id === 'number:99')).toBe(
        true,
      ),
    )
    const shown = events.find(
      (e): e is Extract<RuntimeEvent, { type: 'permission_request' }> =>
        e.type === 'permission_request' && e.id === 'number:99',
    )
    expect(shown?.scope.availableDecisions).toEqual(['allow', 'deny', 'cancel'])
    expect(shown?.scope.noPositiveBecause).toBeUndefined()

    await handle.close()
    await consumer
  })

  it('does NOT leak the raw provider payload into the neutral event', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(51, 'item/commandExecution/requestApproval', commandParams)
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    expect(new Set(Object.keys(req))).toEqual(
      new Set(['type', 'id', 'kind', 'action', 'detail', 'scope']),
    )
    const serialized = JSON.stringify(req)
    for (const leak of [
      'threadId',
      'turnId',
      'itemId',
      'startedAtMs',
      'commandActions',
      'networkApprovalContext',
      'additionalPermissions',
    ]) {
      expect(serialized).not.toContain(leak)
    }
    await handle.close()
    await consumer
  })

  it('maps a file approval grant root to a session-wide scope', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(52, 'item/fileChange/requestApproval', {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'it_2',
      startedAtMs: 0,
      reason: 'apply patch',
      grantRoot: '/tmp/x/src',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    expect(req.kind).toBe('file')
    expect(req.scope).toMatchObject({
      grantRoot: '/tmp/x/src',
      persistence: 'session',
      paths: ['/tmp/x/src'],
    })
    await handle.close()
    await consumer
  })

  /**
   * 🔴 **697 — a file card with NO grant root still offers `allow for this session`, so it says
   * `session`.** ⛔ On `main` it said `once` beside that button — measured live by
   * `probe:codex-reopen-grant` on every file card it raised — which is `058`'s *"the same class of
   * lie in the other direction"*. ⚑ The grant-root card above is the control: `session` before and
   * after, for the reason it always had.
   */
  it('697 · a file card with no grant root says what its session button can grant', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(55, 'item/fileChange/requestApproval', {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'it_3',
      startedAtMs: 0,
      reason: 'apply patch',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    expect(req.kind).toBe('file')
    // ⚑ The premise: the session accept IS on the card.
    expect(req.scope.availableDecisions).toContain('allow_for_session')
    expect(req.scope.grantRoot).toBeUndefined()
    expect(req.scope.persistence).toBe('session')
    await handle.close()
    await consumer
  })

  it('rejects a respondPermission decision the request does not offer', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(53, 'item/commandExecution/requestApproval', {
      ...commandParams,
      availableDecisions: ['decline', 'cancel'], // no accept offered
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    // 'allow' → 'accept' is not offered → rejected, request stays pending
    await expect(handle.respondPermission('number:53', { outcome: 'allow' })).rejects.toThrow(
      /not offered/,
    )
    // 'deny' → 'decline' is offered → accepted
    await handle.respondPermission('number:53', { outcome: 'deny' })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 53)).toBe(true))
    await handle.close()
    await consumer
  })

  it('an explicit list with a mix of amendment-form + decline surfaces ONLY the representable set, no invented allow (023 P1-F)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(60, 'item/commandExecution/requestApproval', {
      command: 'curl http://x',
      cwd: '/tmp/x',
      // Provider offers an amendment-form accept (object) + a plain decline — NO plain accept.
      // ⚑ 736 · a LOOK-ALIKE: `rules` is not the wire's `execpolicy_amendment`, so it is still
      // unrepresentable; the wire shape is `allow_always` since R95 (the R95 tests, `approvals`).
      availableDecisions: [{ acceptWithExecpolicyAmendment: { rules: ['curl *'] } }, 'decline'],
      proposedExecpolicyAmendment: ['curl', '*'],
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    // ⚑ **487 · the representable offered decision, and the floor.** The provider's `decline`
    // maps to `deny`; `cancel` is here because every published offer keeps both refusals, and
    // NOT because an accept was invented — there is still no positive on this card.
    expect(req.scope.availableDecisions).toEqual(['deny', 'cancel'])
    // 🔴 **487 · and the card says WHY it cannot be allowed**: the provider offered a way to
    // accept and this app has no neutral outcome for an amendment-form decision.
    expect(req.scope.noPositiveBecause).toBe('could-not-represent-the-answers')
    expect(req.scope.underDisclosed).toBe(true) // an unrepresentable amendment-form decision was offered
    expect(req.scope.amendments).toContainEqual({ kind: 'exec', detail: 'curl *' }) // the amendment is surfaced, not dropped
    // Plain allow ('accept') was NOT offered → rejected, never sent on the wire.
    await expect(handle.respondPermission('number:60', { outcome: 'allow' })).rejects.toThrow(
      /not offered/,
    )
    expect(transport.responses.some((r) => r.id === 60)).toBe(false)
    await handle.close()
    await consumer
  })

  it('an explicit list with ONLY an amendment-form accept yields NO WAY TO ALLOW, says why, and fails closed (023 P1-F · 487)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(61, 'item/commandExecution/requestApproval', {
      command: 'curl http://x',
      cwd: '/tmp/x',
      // ⚑ 736 · a LOOK-ALIKE (`rules`, not the wire's `execpolicy_amendment`) — still unrepresentable.
      availableDecisions: [{ acceptWithExecpolicyAmendment: { rules: ['curl *'] } }],
      proposedExecpolicyAmendment: ['curl', '*'],
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    // ⚑ **487 · no representable POSITIVE — and never the standard 4-set.** The two refusals are
    // on it because both gates honour them whatever was offered; the card could not be answered
    // at all before, which is `483`'s repair 1.
    expect(req.scope.availableDecisions).toEqual(['deny', 'cancel'])
    expect(req.scope.noPositiveBecause).toBe('could-not-represent-the-answers')
    expect(req.scope.underDisclosed).toBe(true)
    // Both positive outcomes fail closed (unoffered); only a safe cancel/decline works.
    await expect(handle.respondPermission('number:61', { outcome: 'allow' })).rejects.toThrow(
      /not offered/,
    )
    await expect(
      handle.respondPermission('number:61', { outcome: 'allow_for_session' }),
    ).rejects.toThrow(/not offered/)
    // ⚑ 736 · and the look-alike is never echoed as an *Always allow* either.
    await expect(
      handle.respondPermission('number:61', { outcome: 'allow_always' }),
    ).rejects.toThrow(/not offered/)
    expect(transport.responses.some((r) => r.id === 61)).toBe(false) // nothing sent on the wire
    await handle.respondPermission('number:61', { outcome: 'cancel' }) // safe fallback always works
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 61)).toBe(true))
    await handle.close()
    await consumer
  })

  it('an explicit EMPTY availableDecisions:[] offers no way to ALLOW — no positive decision reaches the wire (036 P1-F #3 · 487)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    // PRESENT-but-empty ≠ absent: the provider enumerated a list and it offers no decision.
    // Pre-fix `length > 0` treated this as "absent" and widened it to all four standard choices,
    // then accepted a positive decision the provider never offered.
    transport.serverRequest(62, 'item/commandExecution/requestApproval', {
      command: 'rm -rf /',
      cwd: '/tmp/x',
      availableDecisions: [],
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    // ⚑ **487 · NOT the invented allow/session/deny/cancel set**, and not nothing either: the
    // provider named no way to allow, so the card carries the two refusals and says that.
    expect(req.scope.availableDecisions).toEqual(['deny', 'cancel'])
    expect(req.scope.noPositiveBecause).toBe('none-was-offered')
    // The whole command is shown and Codex offered nothing the card cannot draw: no warning.
    expect(req.scope.underDisclosed).toBe(false)
    // Every positive outcome fails closed; nothing is written to the wire.
    await expect(handle.respondPermission('number:62', { outcome: 'allow' })).rejects.toThrow(
      /not offered/,
    )
    await expect(
      handle.respondPermission('number:62', { outcome: 'allow_for_session' }),
    ).rejects.toThrow(/not offered/)
    expect(transport.responses.some((r) => r.id === 62)).toBe(false)
    // The safe negatives still work (so the turn can always proceed).
    await handle.respondPermission('number:62', { outcome: 'deny' })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 62)).toBe(true))
    await handle.close()
    await consumer
  })

  it('a command with nothing picked out of it is disclosed by the command itself, which the card shows whole', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    // Its network and file effects appear in no field but the command, and the card draws no list
    // beside it that could be read as all it touches: the command is the disclosure, as on
    // Claude's shell card.
    transport.serverRequest(63, 'item/commandExecution/requestApproval', {
      command: 'curl https://api.example | tee /etc/cron.d/x',
      cwd: '/tmp/x',
      availableDecisions: ['accept', 'decline'], // representable, and no additionalPermissions
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    expect(req.scope.underDisclosed).toBe(false)
    expect(req.detail).toBe('curl https://api.example | tee /etc/cron.d/x')
    expect(req.scope.paths).toEqual([])
    expect(req.scope.networkHosts).toEqual([])
    await handle.close()
    await consumer
  })

  it('a command requesting filesystem entries DISCLOSES them access-labelled (path/glob/special) (036 P1-F #5)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(64, 'item/commandExecution/requestApproval', {
      command: 'setup',
      cwd: '/tmp/x',
      availableDecisions: ['accept', 'decline'],
      // The REAL AdditionalFileSystemPermissions shape: legacy read/write + the newer `entries`.
      additionalPermissions: {
        network: { enabled: false },
        fileSystem: {
          read: null,
          write: ['/tmp/x/legacy'],
          entries: [
            { path: { type: 'path', path: '/etc' }, access: 'write' },
            { path: { type: 'glob_pattern', pattern: '**/*.ts' }, access: 'read' },
            { path: { type: 'special', value: { kind: 'tmpdir' } }, access: 'write' },
          ],
        },
      },
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    // Pre-fix the UI saw NONE of this (paths: []) while accepting granted it all.
    expect(req.scope.paths).toEqual([
      'write /tmp/x/legacy',
      'write /etc',
      'read glob:**/*.ts',
      'write special:tmpdir',
    ])
    expect(req.scope.underDisclosed).toBe(true)
    // Everything requested is displayable, so the offered accept remains available.
    await handle.respondPermission('number:64', { outcome: 'allow' })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 64)).toBe(true))
    expect(transport.responses.find((r) => r.id === 64)?.result).toEqual({ decision: 'accept' })
    await handle.close()
    await consumer
  })

  it('a command whose requested permissions are NOT displayable fails positives closed (036 P1-F #5)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(65, 'item/commandExecution/requestApproval', {
      command: 'setup',
      cwd: '/tmp/x',
      availableDecisions: ['accept', 'decline'], // accept IS offered…
      additionalPermissions: {
        network: { enabled: false },
        // …but a `special:unknown` path cannot be shown truthfully, so accepting would grant
        // filesystem access the user never saw.
        fileSystem: {
          read: null,
          write: null,
          entries: [
            {
              path: { type: 'special', value: { kind: 'unknown', path: '/???', subpath: null } },
              access: 'write',
            },
          ],
        },
      },
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    expect(scopeOf(events).scope.underDisclosed).toBe(true)
    // 🔴 **487 · the invariant, re-argued rather than renumbered.** The rule was *the card must
    // not ADVERTISE a decision the gate will reject*, and it held by making the offer a subset of
    // the gate. ⛔ **The gate was never the offered set alone**: `respondPermission` exempts
    // {@link ALWAYS_HONOURED} by construction, so the honest statement of the rule is **every
    // POSITIVE on a card is one the gate admits, and the two refusals are admitted always**. The
    // old form was the strictly-smaller offer that satisfied it, and on this branch — the one
    // `483` traced as reachable — it left a person a card with no answer at all.
    expect(scopeOf(events).scope.availableDecisions).toEqual(['deny', 'cancel'])
    // ⚑ **And it says whose decision that was.** The provider offered `accept`; BroBot withheld
    // it because the grant riding along could not be shown.
    expect(scopeOf(events).scope.noPositiveBecause).toBe('could-not-describe-the-grant')
    // Positives fail closed even though the provider offered accept — nothing on the wire.
    await expect(handle.respondPermission('number:65', { outcome: 'allow' })).rejects.toThrow(
      /not offered/,
    )
    expect(transport.responses.some((r) => r.id === 65)).toBe(false)
    await handle.respondPermission('number:65', { outcome: 'deny' }) // safe negative still works
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 65)).toBe(true))
    await handle.close()
    await consumer
  })

  it('an ABSENT decision list combined with undisplayable permissions still blocks positives (widening must not defeat fail-closed)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    // The dangerous interaction: an absent list normally widens to the sanctioned STANDARD set
    // (unrestricted), while the undisplayable profile must fail positives closed. Fail-closed wins.
    transport.serverRequest(66, 'item/commandExecution/requestApproval', {
      command: 'setup',
      cwd: '/tmp/x',
      // no availableDecisions at all → would otherwise assume the standard four
      additionalPermissions: {
        network: { enabled: false },
        fileSystem: {
          read: null,
          write: null,
          entries: [
            {
              path: { type: 'special', value: { kind: 'unknown', path: '/???', subpath: null } },
              access: 'write',
            },
          ],
        },
      },
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    // ⚑ **487 · NOT the widened standard four** — fail-closed still wins on every positive — and
    // the two refusals, which fail-closed never had a reason to withhold.
    expect(scopeOf(events).scope.availableDecisions).toEqual(['deny', 'cancel'])
    expect(scopeOf(events).scope.noPositiveBecause).toBe('could-not-describe-the-grant')
    expect(scopeOf(events).scope.underDisclosed).toBe(true)
    await expect(handle.respondPermission('number:66', { outcome: 'allow' })).rejects.toThrow(
      /not offered/,
    )
    await expect(
      handle.respondPermission('number:66', { outcome: 'allow_for_session' }),
    ).rejects.toThrow(/not offered/)
    expect(transport.responses.some((r) => r.id === 66)).toBe(false) // nothing reached the wire
    await handle.respondPermission('number:66', { outcome: 'cancel' }) // safe negative always works
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 66)).toBe(true))
    await handle.close()
    await consumer
  })

  it('a sandbox DENY entry is disclosed as a RESTRICTION, not as a granted path', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(67, 'item/commandExecution/requestApproval', {
      command: 'setup',
      cwd: '/tmp/x',
      availableDecisions: ['accept', 'decline'],
      additionalPermissions: {
        network: { enabled: false },
        fileSystem: {
          read: null,
          write: null,
          entries: [
            { path: { type: 'path', path: '/work' }, access: 'write' },
            { path: { type: 'path', path: '/etc' }, access: 'deny' }, // a RESTRICTION
          ],
        },
      },
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    // `restrict /etc`, never `deny /etc` — the latter reads as a granted path in a list the UI
    // presents as "what accepting opens".
    expect(scopeOf(events).scope.paths).toEqual(['write /work', 'restrict /etc'])
    await handle.close()
    await consumer
  })
})

describe('CodexRuntime — user-input requests (007 P2-1)', () => {
  const questionParams = {
    threadId: 'th_1',
    turnId: 'tn_1',
    itemId: 'it_1',
    questions: [
      {
        id: 'q_color',
        header: 'Color',
        question: 'pick a color',
        isOther: false,
        isSecret: false,
        options: [{ label: 'blue', description: '' }],
      },
    ],
    autoResolutionMs: null,
  }
  const permParams = {
    threadId: 'th_1',
    turnId: 'tn_1',
    itemId: 'it_2',
    environmentId: null,
    startedAtMs: 0,
    cwd: '/tmp/x',
    reason: 'needs write',
    permissions: { network: { enabled: true }, fileSystem: { read: null, write: ['/tmp/x/out'] } },
  }
  const resultFor = (transport: FakeTransport, id: number) =>
    transport.responses.find((r) => r.id === id)?.result

  it('requestUserInput → user_input_request(questions); answer → answers-by-questionId (no {answer})', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(80, 'item/tool/requestUserInput', questionParams)
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    const req = firstOfType(events, 'user_input_request')
    // ⛔ **`false`, and MEASURED** (139): `ToolRequestUserInputQuestion` carries no multi-select flag,
    // so a Codex question is single-select and says so — rather than leaving the field absent, which
    // is what a question built before the flag existed looks like.
    // ⚑ **143: `allowOther` is FALSE here, and that is the point of reading it.** This fixture sends
    // `isOther: false`, which the pinned normalizer would never produce for an ordinary question —
    // it forces `is_other = true`. The adapter copies what the REQUEST said rather than what the
    // provider's source code says it will say (086), so a producer that declines the escape gets a
    // card with no free-form field and an answer off the list is refused.
    expect(req.questions).toEqual([
      {
        id: 'q_color',
        prompt: 'pick a color',
        header: 'Color',
        options: [{ label: 'blue' }],
        allowOther: false,
        secret: false,
        multiSelect: false,
      },
    ])
    expect(Object.keys(req)).not.toContain('raw')
    await handle.respondUserInput('number:80', { kind: 'answer', answers: { q_color: 'blue' } })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 80)).toBe(true))
    expect(resultFor(transport, 80)).toEqual({ answers: { q_color: { answers: ['blue'] } } })
    await handle.close()
    await consumer
  })

  /**
   * **139 · the asymmetry, recorded rather than assumed.**
   *
   * 020's comment says the neutral question is built from Claude `AskUserQuestion` questions *or*
   * Codex `requestUserInput` ones, and 135 is the precedent for measuring each side instead of
   * assuming they mirror: `ToolRequestUserInputQuestion` is `{id, header, question, isOther,
   * isSecret, options}` and has no multi-select flag anywhere. The tempting wrong reading is the
   * ANSWER type — `{answers: Array<string>}`, plural for every question — and a response shape that
   * CAN carry several is not a question that asked for several (035: do not invent a signal the
   * provider does not send).
   *
   * ⚠️ **This test pins what is true today, and names where to change when it stops being.** If
   * Codex grows a multi-select flag, `codexQuestions` is the one line that reads it and this is the
   * assertion that has to move — deliberately, not by a pass-through nobody ruled on.
   */
  it('a Codex question is single-select even when the params carry a flag we do not model', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(88, 'item/tool/requestUserInput', {
      ...questionParams,
      questions: [{ ...questionParams.questions[0], multiSelect: true }],
    })
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    expect(firstOfType(events, 'user_input_request').questions[0]?.multiSelect).toBe(false)

    // And the answer still leaves in the protocol's own plural wrapper, one answer inside it — the
    // shape that made the flag look unnecessary and never said anything about the question.
    await handle.respondUserInput('number:88', { kind: 'answer', answers: { q_color: 'blue' } })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 88)).toBe(true))
    expect(resultFor(transport, 88)).toEqual({ answers: { q_color: { answers: ['blue'] } } })
    await handle.close()
    await consumer
  })

  it('requestUserInput decline → documented {answers:{}} payload, never a JSON-RPC error', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(81, 'item/tool/requestUserInput', questionParams)
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    await handle.respondUserInput('number:81', { kind: 'reject' })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 81)).toBe(true))
    expect(resultFor(transport, 81)).toEqual({ answers: {} })
    expect(transport.errors.some((e) => e.id === 81)).toBe(false)
    await handle.close()
    await consumer
  })

  it('⚠️ a decline’s reason is not sent to Codex: its answer has no place for one', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(181, 'item/tool/requestUserInput', questionParams)
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    await handle.respondUserInput('number:181', { kind: 'reject', reason: 'I do not know' })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 181)).toBe(true))
    expect(resultFor(transport, 181)).toEqual({ answers: {} })
    await handle.close()
    await consumer
  })

  it('permissions requestApproval → user_input_request(permission scope); answer → {permissions,scope}', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(82, 'item/permissions/requestApproval', permParams)
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    const req = firstOfType(events, 'user_input_request')
    expect(req.questions).toEqual([])
    // Access-labelled (039): the UI sees it is a WRITE grant, not just "some path".
    // 🔴 **709 · R44 — the model's `reason` is the AGENT's** (measured: `probe:codex-approval-reason`),
    // so it rides `agentReason`, and nothing carries it without an author.
    expect(req.permission).toEqual({
      cwd: '/tmp/x',
      agentReason: 'needs write',
      paths: ['write /tmp/x/out'],
      network: true,
    })
    // ⛔ **…and it is not the headline.** It was: `prompt = reason || …`. The card's headline is this
    // app's own sentence, as the Claude adapter's plan cards are.
    expect(req.prompt).toBe(THE_AGENT_ASKS_FOR_ACCESS)
    expect(
      JSON.stringify({ ...req, permission: { ...req.permission, agentReason: null } }),
    ).not.toContain('needs write')
    expect(Object.keys(req)).not.toContain('raw')
    await handle.respondUserInput('number:82', { kind: 'answer', answers: {} }) // permission grant: no questions to answer
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 82)).toBe(true))
    expect(resultFor(transport, 82)).toEqual({ permissions: permParams.permissions, scope: 'turn' })
    await handle.close()
    await consumer
  })

  it('⛔ 709 · a permissions card’s agent words are CLEANED like a command card’s — and dropped past the ceiling', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(88, 'item/permissions/requestApproval', {
      ...permParams,
      reason: '\u001b[1mneeds\u001b[0m\u202e write\n access',
    })
    transport.serverRequest(89, 'item/permissions/requestApproval', {
      ...permParams,
      itemId: 'it_3',
      reason: 'x'.repeat(MAX_PERMISSION_DETAIL_CHARS + 1),
    })
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(2),
    )
    const [cleaned, tooLong] = events.filter(
      (e): e is Extract<RuntimeEvent, { type: 'user_input_request' }> =>
        e.type === 'user_input_request',
    )
    expect(cleaned?.permission?.agentReason).toBe('needs write access')
    expect(tooLong?.permission !== undefined && 'agentReason' in tooLong.permission).toBe(false)
    await handle.close()
    await consumer
  })

  it('a permissions request with fileSystem ENTRIES discloses them access-labelled, then grants exactly what was shown (036 P1-F #5)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    // The reviewer's repro shape: `entries: [{ path: '/etc', access: 'write' }]` — pre-fix the UI
    // displayed NO path while a positive answer echoed the raw grant back to the provider.
    const entryParams = {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'it_9',
      environmentId: null,
      startedAtMs: 0,
      cwd: '/tmp/x',
      reason: 'needs /etc',
      permissions: {
        network: { enabled: false },
        fileSystem: {
          read: null,
          write: null,
          entries: [
            { path: { type: 'path', path: '/etc' }, access: 'write' },
            {
              path: { type: 'special', value: { kind: 'project_roots', subpath: 'src' } },
              access: 'read',
            },
          ],
        },
      },
    }
    transport.serverRequest(87, 'item/permissions/requestApproval', entryParams)
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    const req = firstOfType(events, 'user_input_request')
    // The UI now SEES the entries (pre-fix: paths: []).
    expect(req.permission).toEqual({
      cwd: '/tmp/x',
      agentReason: 'needs /etc',
      paths: ['write /etc', 'read special:project_roots/src'],
      network: false,
    })
    // Everything was displayed, so the CONSTRUCTED grant (047 — never a raw echo) reproduces
    // exactly the disclosed subset.
    await handle.respondUserInput('number:87', { kind: 'answer', answers: {} })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 87)).toBe(true))
    expect(resultFor(transport, 87)).toEqual({
      permissions: entryParams.permissions,
      scope: 'turn',
    })
    await handle.close()
    await consumer
  })

  /**
   * A grant must satisfy the vendored `GrantedPermissionProfile`: its `network`/`fileSystem`
   * sections may be ABSENT or an object — never top-level `null` (unlike the REQUEST type, which
   * permits null). This is the runtime mirror of the `satisfies` guard in the adapter (047).
   */
  const assertConformantGrant = (result: unknown): Record<string, unknown> => {
    const grant = result as { permissions: Record<string, unknown>; scope: string }
    expect(grant.scope).toBe('turn')
    expect(typeof grant.permissions).toBe('object')
    for (const section of ['network', 'fileSystem'] as const) {
      if (section in grant.permissions) {
        // Present ⇒ must be an object, never null (the out-of-contract shape 044 P1-F found).
        expect(grant.permissions[section]).not.toBeNull()
        expect(typeof grant.permissions[section]).toBe('object')
      }
    }
    return grant.permissions
  }

  it('a NULLABLE permissions request yields a conformant grant — null sections omitted, never echoed raw (044 P1-F)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    // The reviewer's protocol-valid repro: `network` is top-level null. Pre-fix it was echoed
    // verbatim, producing a response that does NOT satisfy `GrantedPermissionProfile`.
    transport.serverRequest(94, 'item/permissions/requestApproval', {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'it_n',
      environmentId: null,
      startedAtMs: 0,
      cwd: '/tmp/x',
      reason: 'needs write',
      permissions: { network: null, fileSystem: { read: null, write: ['/tmp/out'] } },
    })
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    // The write is still disclosed to the user (039 coupling intact).
    expect(firstOfType(events, 'user_input_request').permission).toMatchObject({
      paths: ['write /tmp/out'],
      network: false,
    })

    await handle.respondUserInput('number:94', { kind: 'answer', answers: {} })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 94)).toBe(true))
    const granted = assertConformantGrant(resultFor(transport, 94))
    // The null section is OMITTED (not echoed as null); the requested write is granted.
    expect('network' in granted).toBe(false)
    expect(granted['fileSystem']).toEqual({ read: null, write: ['/tmp/out'] })

    await handle.close()
    await consumer
  })

  it('a FULLY-NULL permissions request yields a conformant grant-nothing (044 P1-F)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(95, 'item/permissions/requestApproval', {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'it_nn',
      environmentId: null,
      startedAtMs: 0,
      cwd: '/tmp/x',
      reason: 'asks for nothing',
      permissions: { network: null, fileSystem: null },
    })
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    await handle.respondUserInput('number:95', { kind: 'answer', answers: {} })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 95)).toBe(true))
    // Both sections omitted → an empty (valid) profile, never `{network:null, fileSystem:null}`.
    expect(resultFor(transport, 95)).toEqual({ permissions: {}, scope: 'turn' })
    assertConformantGrant(resultFor(transport, 95))

    await handle.close()
    await consumer
  })

  it('an out-of-spec network `enabled` is granted exactly as it was DISCLOSED (shown == granted)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    // `enabled` is `boolean | null` per the generated type; a malformed value must not be able to
    // make the grant say something different from the card the user approved.
    transport.serverRequest(96, 'item/permissions/requestApproval', {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'it_bad',
      environmentId: null,
      startedAtMs: 0,
      cwd: '/tmp/x',
      reason: 'malformed network ask',
      permissions: { network: { enabled: 'yes' }, fileSystem: null },
    })
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    // The card discloses NO network access…
    expect(firstOfType(events, 'user_input_request').permission?.network).toBe(false)
    await handle.respondUserInput('number:96', { kind: 'answer', answers: {} })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 96)).toBe(true))
    // …so the grant must not say otherwise, and must stay a conformant boolean.
    const granted = assertConformantGrant(resultFor(transport, 96))
    expect(granted['network']).toEqual({ enabled: false })

    await handle.close()
    await consumer
  })

  it('a permissions request the neutral scope cannot display FAILS CLOSED — no raw grant is echoed unseen (036 P1-F #5)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(88, 'item/permissions/requestApproval', {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'it_10',
      environmentId: null,
      startedAtMs: 0,
      cwd: '/tmp/x',
      reason: 'needs something we cannot render',
      permissions: {
        network: { enabled: false },
        // A `special:unknown` path has no truthful display — so accepting must grant NOTHING.
        fileSystem: {
          read: null,
          write: null,
          entries: [
            {
              path: { type: 'special', value: { kind: 'unknown', path: '/???', subpath: null } },
              access: 'write',
            },
          ],
        },
      },
    })
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    await handle.respondUserInput('number:88', { kind: 'answer', answers: {} }) // a POSITIVE answer…
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 88)).toBe(true))
    // …yields the documented grant-NOTHING payload, never the raw requested profile.
    expect(resultFor(transport, 88)).toEqual({ permissions: {}, scope: 'turn' })
    expect(JSON.stringify(resultFor(transport, 88))).not.toContain('unknown') // no raw echo
    await handle.close()
    await consumer
  })

  it('permissions decline → documented {permissions:{},scope:"turn"}, never a JSON-RPC error', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(83, 'item/permissions/requestApproval', permParams)
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    await handle.respondUserInput('number:83', { kind: 'reject' })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 83)).toBe(true))
    expect(resultFor(transport, 83)).toEqual({ permissions: {}, scope: 'turn' })
    expect(transport.errors.some((e) => e.id === 83)).toBe(false)
    await handle.close()
    await consumer
  })

  const multiQuestionParams = {
    threadId: 'th_1',
    turnId: 'tn_1',
    itemId: 'it_1',
    questions: [
      {
        id: 'q_a',
        header: 'A',
        question: 'first?',
        isOther: false,
        isSecret: false,
        options: [{ label: 'x', description: '' }],
      },
      {
        id: 'q_b',
        header: 'B',
        question: 'second?',
        isOther: false,
        isSecret: false,
        options: [{ label: 'y', description: '' }],
      },
    ],
    autoResolutionMs: null,
  }

  it('requestUserInput with MULTIPLE questions answers EVERY questionId (033, fixing 023 P2 #1)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(85, 'item/tool/requestUserInput', multiQuestionParams)
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    await handle.respondUserInput('number:85', {
      kind: 'answer',
      answers: { q_a: 'x', q_b: ['y'] },
    })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 85)).toBe(true))
    // ⛔ **`q_b` used to send `['y','z']` here, and this line called it "a multi-select value"**
    // (142 §2, correcting rather than deleting it). The same commit asserts a few hundred lines up
    // that every Codex question is published `multiSelect:false` — *"the test suite actively
    // blesses the contradiction"* (141). One value per question is what the provider's own shape
    // means; the array wrapper is `ToolRequestUserInputAnswer`'s, not evidence of several.
    expect(resultFor(transport, 85)).toEqual({
      answers: { q_a: { answers: ['x'] }, q_b: { answers: ['y'] } },
    })
    await handle.close()
    await consumer
  })

  /**
   * ⛔ **The contract Codex did not keep** (142 §2, from 141 HIGH 2). `permission.ts` has promised
   * since 139 that an answer fails closed on empty, blank and several-for-one; `userInputPayloadFor`
   * checked only that every question id was PRESENT, so every one of these reached the provider.
   * Each is refused ALONE, with the other question answered properly, so no case can pass on
   * another's failure — and each is followed by a good answer to the SAME id, which is what proves
   * a refusal left the request alive rather than burning it.
   */
  const CODEX_UNFORWARDABLE: readonly {
    what: string
    answers: Record<string, string | string[]>
  }[] = [
    { what: 'an empty array', answers: { q_a: [], q_b: 'y' } },
    { what: 'a blank string', answers: { q_a: '   ', q_b: 'y' } },
    { what: 'an array of blanks', answers: { q_a: ['', ' '], q_b: 'y' } },
    {
      what: 'several for a question Codex publishes as single-select',
      answers: { q_a: ['x', 'w'], q_b: 'y' },
    },
    { what: 'a substantively partial answer — present, but empty', answers: { q_a: 'x', q_b: [] } },
    // 143: both questions in this fixture declare `isOther: false`, so a typed answer is one the
    // provider said it would not take. Refused here rather than sent — the flag would be decoration
    // if nothing enforced it, which is precisely how `multiSelect` failed in 139.
    {
      what: 'a value that is not on the list, for a question that takes no other',
      answers: { q_a: 'something I typed', q_b: 'y' },
    },
  ]

  for (const [i, { what, answers }] of CODEX_UNFORWARDABLE.entries()) {
    it(`requestUserInput fails closed on ${what}, and never writes it to the wire`, async () => {
      const { transport, handle, events, consumer } = await startCodexInTurn()
      const id = 90 + i
      transport.serverRequest(id, 'item/tool/requestUserInput', multiQuestionParams)
      await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))

      await expect(
        handle.respondUserInput(`number:${id}`, { kind: 'answer', answers }),
      ).rejects.toThrow(/cannot be forwarded/)
      // ⛔ Nothing on the wire — not the bad answer, and not a DECLINE either. A decline would tell
      // the provider the user said no while the host recorded `Answered`: 141's HIGH 1, on the
      // provider it was reported for.
      expect(transport.responses.some((r) => r.id === id)).toBe(false)
      expect(transport.errors.some((e) => e.id === id)).toBe(false)

      await handle.respondUserInput(`number:${id}`, {
        kind: 'answer',
        answers: { q_a: 'x', q_b: 'y' },
      })
      await vi.waitFor(() => expect(transport.responses.some((r) => r.id === id)).toBe(true))
      expect(resultFor(transport, id)).toEqual({
        answers: { q_a: { answers: ['x'] }, q_b: { answers: ['y'] } },
      })
      await handle.close()
      await consumer
    })
  }

  it('an `isOther` question takes the answer that is not on the list, in the provider’s own slot (143)', async () => {
    // ⛔ **141 MEDIUM 1, on the Codex half.** The pinned `0.146.0` spec calls options *"2–3 mutually
    // exclusive choices"*, the client adds a free-form Other, and
    // `normalize_request_user_input_args` forces `is_other = true` on every ordinary question — so
    // in practice EVERY Codex question offers this. BroBot rendered a text field only when the
    // option list was empty, which that normalizer forbids, so the escape was unreachable.
    const otherParams = {
      ...multiQuestionParams,
      questions: multiQuestionParams.questions.map((q) => ({ ...q, isOther: true })),
    }
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(96, 'item/tool/requestUserInput', otherParams)
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    expect(firstOfType(events, 'user_input_request').questions[0]!.allowOther).toBe(true)

    await handle.respondUserInput('number:96', {
      kind: 'answer',
      answers: { q_a: 'neither — the third thing', q_b: 'y' },
    })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 96)).toBe(true))
    // ⚑ **The SAME slot a label occupies, and that is the provider's shape rather than a loss.**
    // `ToolRequestUserInputAnswer` is `{answers: string[]}` with no field marking a member as
    // freeform, and the pinned app-server test client puts a selected option and a free-form Other
    // response into that one array alike. Unlike Claude there is no `response` to set, so on Codex
    // the distinction exists only where the options are — in `answerToForward`, which is what
    // refused the identical value in the loop above when `isOther` was false.
    expect(resultFor(transport, 96)).toEqual({
      answers: { q_a: { answers: ['neither — the third thing'] }, q_b: { answers: ['y'] } },
    })
    await handle.close()
    await consumer
  })

  it('carries `isSecret` rather than dropping it a second time (143, from 141 §3.1)', async () => {
    // 141: *"not exposed by the ordinary pinned model-tool schema and defaults false"* — so no
    // ordinary question sets it today — and BroBot dropped it anyway, *"leaving a latent masking gap
    // if another valid producer sets it"*. Carried, so the card can mask the field instead of
    // rendering a secret in clear text the first time some producer does send one.
    const secretParams = {
      ...multiQuestionParams,
      questions: [{ ...multiQuestionParams.questions[0]!, isSecret: true, isOther: true }],
    }
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(97, 'item/tool/requestUserInput', secretParams)
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    const question = firstOfType(events, 'user_input_request').questions[0]!
    expect(question.secret).toBe(true)
    // The paired negative on the same run: the sibling fixture says `false`, so `true` is being read
    // off the request rather than stamped onto every question.
    expect(multiQuestionParams.questions[0]!.isSecret).toBe(false)
    await handle.respondUserInput('number:97', { kind: 'answer', answers: { q_a: 'hunter2' } })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 97)).toBe(true))
    await handle.close()
    await consumer
  })

  it('requestUserInput with an INCOMPLETE answer is refused, and the card stays live (033, 142)', async () => {
    // This asserted `{answers:{}}` on the wire — the documented DECLINE payload — for an answer the
    // user did give. The provider heard "declined" and the ledger said "Answered". Refusing leaves
    // the id claimed, so the question can still be answered.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(86, 'item/tool/requestUserInput', multiQuestionParams)
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    await expect(
      handle.respondUserInput('number:86', { kind: 'answer', answers: { q_a: 'x' } }), // q_b unanswered
    ).rejects.toThrow(/cannot be forwarded/)
    expect(transport.responses.some((r) => r.id === 86)).toBe(false)
    expect(transport.errors.some((e) => e.id === 86)).toBe(false)
    await handle.close()
    await consumer
  })

  it('a REJECT is still the documented empty payload, and still ends the request (033)', async () => {
    // ⚠️ The paired negative for every refusal above: `{answers:{}}` is not gone, it is what saying
    // NO means. A fix that stopped writing it at all would have broken the safe-decline contract
    // while every "nothing on the wire" assertion above stayed green.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(87, 'item/tool/requestUserInput', multiQuestionParams)
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    await handle.respondUserInput('number:87', { kind: 'reject' })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 87)).toBe(true))
    expect(resultFor(transport, 87)).toEqual({ answers: {} })
    await handle.close()
    await consumer
  })

  it('a question id of `__proto__` or `constructor` reaches the provider (146 §2)', async () => {
    // ⛔ **145 HIGH 2, the Codex half.** `ToolRequestUserInputQuestion.id` is an unrestricted
    // `String` in the pinned protocol — validated for options, never for id syntax or reserved
    // names — and `codexAnswers` built its response on an ordinary `{}`. So `answers['__proto__']`
    // set the prototype and the provider received `{answers:{}}`, which is byte for byte the
    // payload `userInputDecline` uses to say NO, while BroBot recorded the question as answered.
    // And `answers['constructor']` read back as the inherited function one layer up, in the card.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(140, 'item/tool/requestUserInput', {
      ...questionParams,
      questions: [
        { ...questionParams.questions[0]!, id: '__proto__' },
        { ...questionParams.questions[0]!, id: 'constructor', question: 'and again' },
      ],
    })
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    expect(firstOfType(events, 'user_input_request').questions.map((q) => q.id)).toEqual([
      '__proto__',
      'constructor',
    ])

    // ⚠️ **`JSON.parse`, and the reason is the defect itself.** An object LITERAL written
    // `{__proto__: 'blue'}` is the prototype-setter syntax, so the key never becomes a property and
    // this test would be asserting over an empty map. `JSON.parse` defines rather than assigns —
    // and so does the IPC schema, which is what the renderer's answer really arrives through.
    await handle.respondUserInput('number:140', {
      kind: 'answer',
      answers: JSON.parse('{"__proto__":"blue","constructor":"blue"}') as Record<string, string>,
    })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 140)).toBe(true))

    // ⛔ Asserted through the OWN properties and the serialisation, because a `toEqual` on a plain
    // object would happily read `__proto__` back off the prototype it had just been assigned into.
    const payload = resultFor(transport, 140) as { answers: Record<string, unknown> }
    expect(Object.getOwnPropertyNames(payload.answers).sort()).toEqual(['__proto__', 'constructor'])
    expect(JSON.stringify(payload)).toBe(
      '{"answers":{"__proto__":{"answers":["blue"]},"constructor":{"answers":["blue"]}}}',
    )
    await handle.close()
    await consumer
  })

  it('two questions with the SAME ID are declined, and never become a card (146 §2)', async () => {
    // ⛔ The provider's response is keyed by question id and nothing upstream enforces uniqueness —
    // `codexQuestions` even falls back to a positional `q{i}`, so `id: "q1"` beside a question with
    // no id at all collides without either being malformed on its face. Two questions sharing one
    // draft key means answering the first fills both and one slot is written twice. Declined where
    // the empty case is declined, for the same reason and by the same route.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(141, 'item/tool/requestUserInput', {
      ...questionParams,
      questions: [
        { ...questionParams.questions[0]!, id: 'q1' },
        { ...questionParams.questions[0]!, id: undefined, question: 'the second' },
      ],
    })

    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 141)).toBe(true))
    expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(0)
    expect(resultFor(transport, 141)).toEqual({ answers: {} })
    expect(transport.errors.some((e) => e.id === 141)).toBe(false)

    // ⚠️ **The paired positive**: the same two questions with distinct ids are an ordinary call.
    transport.serverRequest(142, 'item/tool/requestUserInput', {
      ...questionParams,
      questions: [
        { ...questionParams.questions[0]!, id: 'q1' },
        { ...questionParams.questions[0]!, id: 'q2', question: 'the second' },
      ],
    })
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    expect(firstOfType(events, 'user_input_request').questions.map((q) => q.id)).toEqual([
      'q1',
      'q2',
    ])
    await handle.close()
    await consumer
  })

  it('carries a NON-EMPTY option description across this adapter (146 §4.3)', async () => {
    // ⛔ **145 MEDIUM 3: the 24/24 mutation claim did not protect this branch.** Every Codex
    // fixture in this file sends `description: ""`, so deleting the non-empty spread in
    // `codexQuestions` stayed green — M10's one red came from the CLAUDE fixture. The
    // implementation was correct and the PROTECTION was not, which is a different defect and
    // exactly as reportable.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(143, 'item/tool/requestUserInput', {
      ...questionParams,
      questions: [
        {
          id: 'q_env',
          header: 'Env',
          question: 'where should this run?',
          isOther: false,
          isSecret: false,
          options: [
            { label: 'staging', description: 'the shared box, safe to break, rebuilt nightly' },
            { label: 'production', description: '' },
          ],
        },
      ],
    })
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))

    // The positive and the negative in one shape: a real reason is carried verbatim, and an empty
    // one is DROPPED rather than rendered as a blank line that reads like an empty answer (086).
    expect(firstOfType(events, 'user_input_request').questions[0]!.options).toEqual([
      { label: 'staging', description: 'the shared box, safe to break, rebuilt nightly' },
      { label: 'production' },
    ])
    await handle.close()
    await consumer
  })

  it('a requestUserInput with NO questions is declined, and never becomes a live Approve (064, 142)', async () => {
    // ⛔ **`106` and 141's HIGH 1 in one gesture.** `ToolRequestUserInputParams.questions` is
    // unconstrained, pinned 0.146.0 says *"prefer 1"* rather than enforcing a minimum, and the
    // normalizer vacuously accepts `[]`. `UserInputCard` labels its button on `questions.length`
    // and gates it on `every([])`, which is TRUE — so BroBot drew a live **Approve** on a question
    // card, and pressing it sent the same `{answers:{}}` Codex uses for a decline while the ledger
    // recorded Answered. What it renders now is nothing at all: the malformed call is declined
    // where 064 declines Claude's, before any card exists.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(88, 'item/tool/requestUserInput', { questions: [] })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 88)).toBe(true))
    expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(0)
    expect(resultFor(transport, 88)).toEqual({ answers: {} })
    expect(transport.errors.some((e) => e.id === 88)).toBe(false)

    // ⚠️ **The paired positive, in the same test**: a PERMISSION request legitimately carries no
    // questions, and its Approve means what it says. A guard that keyed on `questions.length` alone
    // would silently stop publishing every exec approval Codex makes.
    transport.serverRequest(89, 'item/permissions/requestApproval', {
      cwd: '/tmp/x',
      reason: 'needs write',
      permissions: { write: ['/tmp/x'] },
    })
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(1),
    )
    await handle.close()
    await consumer
  })

  it('two EXPLICIT duplicate ids are declined by the duplicate check alone (150)', async () => {
    // ⛔ **This test exists because 150 nearly made the 146 §2 one stop testing anything.** That one
    // uses `id: 'q1'` beside a question with NO id — and 150's new empty-id check catches exactly
    // that shape too, so with both guards in place deleting the duplicate check would have left it
    // green. A collision where BOTH ids are present and truthy can only be caught by
    // `duplicateAnswerKey`, which is what keeps that guard under test.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(95, 'item/tool/requestUserInput', {
      questions: [
        { id: 'same', question: 'first?', options: [{ label: 'a' }] },
        { id: 'same', question: 'second?', options: [{ label: 'b' }] },
      ],
    })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 95)).toBe(true))
    expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(0)
    expect(resultFor(transport, 95)).toEqual({ answers: {} })
    expect(transport.errors.some((e) => e.id === 95)).toBe(false)
    await handle.close()
    await consumer
  })

  it('a question with a MISSING id is declined before publication (150, 148 M5)', async () => {
    // ⛔ **142's defect in a place 142 could not see.** `codexQuestions` maps a missing/empty raw id
    // to a positional `q{i}`; that normalized id passes every check, reaches the card, and
    // `answerToForward` accepts an answer keyed by it — but `codexAnswers` writes only when the
    // ORIGINAL `providerId` is truthy. So the user answers, the payload is `{answers:{}}`, which is
    // byte for byte this provider's DECLINE shape, the request is spent, and the host records
    // `Answered`. A human answer destroyed on the way out, with the ledger claiming it landed.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(90, 'item/tool/requestUserInput', {
      questions: [{ question: 'Which one?', options: [{ label: 'a' }, { label: 'b' }] }],
    })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 90)).toBe(true))
    expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(0)
    expect(resultFor(transport, 90)).toEqual({ answers: {} })
    expect(transport.errors.some((e) => e.id === 90)).toBe(false)

    // ⚠️ **The paired positive**: an EXPLICIT id publishes exactly as it always did. The fix is
    // about an id that cannot be returned, not about questions being harder to ask.
    transport.serverRequest(91, 'item/tool/requestUserInput', {
      questions: [{ id: 'q_real', question: 'Which one?', options: [{ label: 'a' }] }],
    })
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(1),
    )
    await handle.close()
    await consumer
  })

  it('…and an EMPTY-STRING id is the same defect, declined the same way (150)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(92, 'item/tool/requestUserInput', {
      questions: [{ id: '', question: 'Which one?', options: [{ label: 'a' }] }],
    })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 92)).toBe(true))
    expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(0)
    expect(resultFor(transport, 92)).toEqual({ answers: {} })
    await handle.close()
    await consumer
  })

  it('a blank option label NEVER becomes a card on Codex either (150, 148 M6)', async () => {
    // The same dead control, refused by the same route on the other provider — one shared predicate
    // (`unanswerableOptionLabel`) so the two adapters cannot drift on what "unanswerable" means.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(93, 'item/tool/requestUserInput', {
      questions: [
        { id: 'q1', question: 'Which one?', options: [{ label: '   ' }, { label: 'real' }] },
      ],
    })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 93)).toBe(true))
    expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(0)
    expect(resultFor(transport, 93)).toEqual({ answers: {} })

    // ⚠️ **The paired positive, byte for byte**: meaningful surrounding spaces are a choice somebody
    // wrote, and they are preserved exactly (143/146) rather than trimmed away with the blank one.
    transport.serverRequest(94, 'item/tool/requestUserInput', {
      questions: [
        { id: 'q2', question: 'Which one?', options: [{ label: ' spaced ' }, { label: 'real' }] },
      ],
    })
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(1),
    )
    const published = events.filter((e) => e.type === 'user_input_request')[0]!
    expect(published.questions[0]!.options).toEqual([{ label: ' spaced ' }, { label: 'real' }])
    await handle.close()
    await consumer
  })
})

describe('CodexRuntime — lifecycle-bounded request-id tombstones (044 P2 #7)', () => {
  /**
   * The retained-tombstone diagnostic, read through the concrete handle the runtime returns.
   * Reports the ABSENCE of any bound as the finding itself, so the pre-fix run fails with the
   * bug in words rather than an opaque `undefined` TypeError.
   */
  const tombstones = (handle: SessionHandle): number => {
    const count = (handle as CodexSessionHandle).tombstoneCount
    if (typeof count !== 'number') {
      throw new Error(
        'no tombstone accounting exists: request-id tombstones are retained for the life of the ' +
          'session, unbounded in the number of requests (044 P2 #7)',
      )
    }
    return count
  }

  /** Drive one full turn: send → approval `id` → allow → provider response → turn/completed. */
  async function turnWithApproval(
    transport: FakeTransport,
    handle: Awaited<ReturnType<CodexRuntime['start']>>,
    events: RuntimeEvent[],
    id: number | string,
    turnId: string,
  ): Promise<void> {
    const responsesBefore = transport.responses.length
    const cardsBefore = events.filter((e) => e.type === 'permission_request').length
    await handle.send('go')
    transport.serverRequest(id, 'item/commandExecution/requestApproval', {
      command: 'echo hi',
      cwd: '/tmp/x',
    })
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'permission_request').length).toBe(cardsBefore + 1),
    )
    await handle.respondPermission(`${typeof id}:${id}`, { outcome: 'allow' })
    await vi.waitFor(() => expect(transport.responses.length).toBe(responsesBefore + 1))
    const turnsBefore = events.filter((e) => e.type === 'turn').length
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn(turnId)),
    )
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'turn').length).toBe(turnsBefore + 1),
    )
  }

  it('BOUNDED MEMORY: the 10,000-request probe settles to a bounded residual, not 10,000', async () => {
    // The reviewer's scenario: 10k answered requests retained every id for the life of the
    // session. Retention is now tied to the TURN, so a turn that handled 10k requests retires all
    // of them at its terminal — the residual is O(1), independent of the request count.
    const { transport, handle, events, consumer } = await startCodex()
    await handle.send('go')
    for (let id = 0; id < 10_000; id++) {
      transport.serverRequest(id, 'item/commandExecution/requestApproval', {
        command: `echo ${id}`,
        cwd: '/tmp/x',
      })
    }
    await vi.waitFor(
      () => expect(events.filter((e) => e.type === 'permission_request').length).toBe(10_000),
      { timeout: 20_000 },
    )
    for (let id = 0; id < 10_000; id++) {
      await handle.respondPermission(`number:${id}`, { outcome: 'deny' })
    }
    await vi.waitFor(() => expect(transport.responses.length).toBe(10_000), { timeout: 20_000 })
    // Pre-terminal: nothing is retired mid-turn — at least one entry per request is still held
    // (across the claimed / responded / broker-answered stores), so every id stays guarded.
    expect(tombstones(handle)).toBeGreaterThanOrEqual(10_000)

    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1')),
    )
    await vi.waitFor(has(events, (e) => e.type === 'turn'))

    // The whole point: 10k requests → a bounded residual, replaced by an O(1) numeric floor.
    expect(tombstones(handle)).toBe(0)

    await handle.close()
    await consumer
  }, 60_000)

  it('SAFETY: a late answer for a RETIRED id is still a refusal — no second response, no authorization', async () => {
    // The named stale-authorization regression. Retiring the tombstone must not open a window in
    // which an answer for a finished request authorizes anything.
    const { transport, handle, events, consumer } = await startCodex()
    await turnWithApproval(transport, handle, events, 7, 'tn_1')
    expect(transport.responses).toEqual([{ id: 7, result: { decision: 'accept' } }])
    expect(tombstones(handle)).toBe(0) // retired

    // A late/duplicate/replayed ANSWER for the retired id: refused (the resolver is gone with its
    // turn), and provably no second provider response is written.
    await expect(handle.respondPermission('number:7', { outcome: 'allow' })).rejects.toThrow()
    await new Promise((r) => setTimeout(r, 10))
    expect(transport.responses.filter((r) => r.id === 7)).toHaveLength(1)

    await handle.close()
    await consumer
  })

  it('SAFETY: a REPLAYED provider request for a retired id publishes NO card and no second response', async () => {
    // Retirement drops the per-id tombstone, so the O(1) floor is what refuses the replay. Without
    // it the replayed id would surface a fresh card and earn a second JSON-RPC response for an id
    // whose exchange is already complete.
    const { transport, handle, events, consumer } = await startCodex()
    await turnWithApproval(transport, handle, events, 7, 'tn_1')
    const cardsAfterTurn1 = events.filter((e) => e.type === 'permission_request').length

    await handle.send('again') // a NEW turn — the replay lands inside a live turn
    transport.serverRequest(7, 'item/commandExecution/requestApproval', {
      command: 'echo REPLAY',
      cwd: '/tmp/x',
    })
    await new Promise((r) => setTimeout(r, 20))

    expect(events.filter((e) => e.type === 'permission_request').length).toBe(cardsAfterTurn1)
    expect(transport.responses.filter((r) => r.id === 7)).toHaveLength(1)

    await handle.close()
    await consumer
  })

  it('SAFETY: retirement happens at the TURN terminal, never mid-turn — a same-turn duplicate is still refused', async () => {
    const { transport, handle, events, consumer } = await startCodex()
    await handle.send('go')
    transport.serverRequest(5, 'item/commandExecution/requestApproval', {
      command: 'echo FIRST',
      cwd: '/tmp/x',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    await handle.respondPermission('number:5', { outcome: 'allow' })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    expect(tombstones(handle)).toBeGreaterThan(0) // NOT retired: the turn is still live

    // Same-turn duplicate → no second card, no second response (036 P1-B still holds).
    transport.serverRequest(5, 'item/commandExecution/requestApproval', {
      command: 'echo SECOND',
      cwd: '/tmp/x',
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(events.filter((e) => e.type === 'permission_request')).toHaveLength(1)
    expect(transport.responses.filter((r) => r.id === 5)).toHaveLength(1)

    await handle.close()
    await consumer
  })

  it('TYPE-PRESERVING across retirement: numeric 1 retired does not retire string "1" (045)', async () => {
    const { transport, handle, events, consumer } = await startCodex()
    await turnWithApproval(transport, handle, events, 1, 'tn_1')

    // String "1" is a DIFFERENT id — the numeric floor must not swallow it. It gets its own card.
    await handle.send('next')
    transport.serverRequest('1', 'item/commandExecution/requestApproval', {
      command: 'echo STRING ONE',
      cwd: '/tmp/x',
    })
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'permission_request').length).toBe(2),
    )
    const card = events.filter((e) => e.type === 'permission_request')[1]
    expect(card).toMatchObject({ id: 'string:1', detail: 'echo STRING ONE' })

    // …while the retired NUMERIC 1 stays refused.
    transport.serverRequest(1, 'item/commandExecution/requestApproval', {
      command: 'echo NUMERIC REPLAY',
      cwd: '/tmp/x',
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(events.filter((e) => e.type === 'permission_request')).toHaveLength(2)

    await handle.close()
    await consumer
  })
})

describe('CodexRuntime — server requests are scoped to the active thread+turn (060 P1)', () => {
  /** Every supported server-request method, with the shape each one answers on refusal. */
  const METHODS = [
    { method: 'item/commandExecution/requestApproval', refusal: { decision: 'decline' } },
    { method: 'item/fileChange/requestApproval', refusal: { decision: 'decline' } },
    { method: 'item/tool/requestUserInput', refusal: { answers: {} } },
    { method: 'item/permissions/requestApproval', refusal: { permissions: {}, scope: 'turn' } },
  ] as const

  /** A card of ANY actionable kind — a scope-rejected request must publish neither. */
  const cards = (events: RuntimeEvent[]): RuntimeEvent[] =>
    events.filter((e) => e.type === 'permission_request' || e.type === 'user_input_request')

  it("REVIEWER'S PROBE: a FOREIGN-THREAD approval is never actionable and is never accepted", async () => {
    // Pre-fix: this produced a live card, and answering it wrote decision:"accept" for a request
    // belonging to another conversation — a confused deputy.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(71, 'item/commandExecution/requestApproval', {
      threadId: 'th_OTHER',
      command: 'rm -rf /',
      cwd: '/tmp/x',
    })
    // Settle: pre-fix the adapter published a card here and waited for a human answer.
    await new Promise((r) => setTimeout(r, 30))
    expect(
      cards(events),
      'a foreign-thread request must never become an actionable card',
    ).toHaveLength(0)
    expect(transport.responses).toEqual([{ id: 71, result: { decision: 'decline' } }])
    // The neutral API cannot be used to authorize it either — nothing is pending for that id.
    await expect(handle.respondPermission('number:71', { outcome: 'allow' })).rejects.toThrow()
    expect(
      transport.responses.some((r) => (r.result as { decision?: string }).decision === 'accept'),
    ).toBe(false)

    await handle.close()
    await consumer
  })

  it("REVIEWER'S PROBE: a STALE-TURN approval (right thread, old turn) is never actionable", async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(72, 'item/commandExecution/requestApproval', {
      turnId: 'tn_STALE', // the live turn is tn_1
      command: 'rm -rf /',
      cwd: '/tmp/x',
    })
    await new Promise((r) => setTimeout(r, 30))
    expect(cards(events), 'a stale-turn request must never become actionable').toHaveLength(0)
    expect(transport.responses).toEqual([{ id: 72, result: { decision: 'decline' } }])

    await handle.close()
    await consumer
  })

  it('an approval raised while IDLE (no live turn) is refused — nothing can be authorized out of turn', async () => {
    const { transport, handle, events, consumer } = await startCodex() // no send → no turn
    transport.serverRequest(73, 'item/commandExecution/requestApproval', {
      threadId: 'th_1',
      turnId: 'tn_1',
      command: 'rm -rf /',
    })
    await new Promise((r) => setTimeout(r, 30))
    expect(cards(events), 'an out-of-turn request must never become actionable').toHaveLength(0)
    expect(transport.responses).toEqual([{ id: 73, result: { decision: 'decline' } }])

    await handle.close()
    await consumer
  })

  it('MISSING or MALFORMED scope fails closed for every supported method, with that method’s safe refusal', async () => {
    // The generated params declare threadId/turnId as REQUIRED strings, so an absent or
    // wrong-typed field is malformed — refused, never given the benefit of the doubt.
    const unscoped: unknown[] = [
      { command: 'x' }, // both fields absent
      { threadId: 'th_1', command: 'x' }, // turnId absent
      { turnId: 'tn_1', command: 'x' }, // threadId absent
      { threadId: 42, turnId: 'tn_1', command: 'x' }, // wrong type
      { threadId: 'th_1', turnId: 42, command: 'x' },
      'not a record',
      null,
    ]
    for (const { method, refusal } of METHODS) {
      for (const [i, params] of unscoped.entries()) {
        const { transport, handle, events, consumer } = await startCodexInTurn()
        transport.serverRequestRaw(500 + i, method, params) // VERBATIM — no faithful defaults
        await new Promise((r) => setTimeout(r, 20))
        expect(cards(events), `${method} ${JSON.stringify(params)}`).toHaveLength(0)
        expect(transport.responses[0], `${method} ${JSON.stringify(params)}`).toEqual({
          id: 500 + i,
          result: refusal,
        })
        await handle.close()
        await consumer
      }
    }
  })

  it('an IN-SCOPE request of every supported method still publishes a card and resolves normally', async () => {
    // The other half of fail-closed: the gate must not break real approvals.
    for (const { method } of METHODS) {
      const { transport, handle, events, consumer } = await startCodexInTurn()
      // ⚠️ **The user-input case needs a QUESTION to be a real one** (142). This sent the same
      // command-approval params to all four methods, so the `requestUserInput` leg was a request
      // with no questions at all — which used to publish a card, and now does not (064's rule,
      // applied where 141 found it missing). Its own test above owns the zero-question case; here
      // the fixture has to be a request the provider could actually send.
      transport.serverRequest(80, method, {
        command: 'ls',
        cwd: '/tmp/x',
        reason: 'why',
        questions: [
          {
            id: 'q_a',
            header: 'A',
            question: 'first?',
            isOther: false,
            isSecret: false,
            options: [{ label: 'x', description: '' }],
          },
        ],
      })
      await vi.waitFor(() => expect(cards(events).length).toBe(1))
      expect(cards(events)[0]).toMatchObject({ id: 'number:80' })
      await handle.close()
      await consumer
    }
  })

  it('a scope-rejected request does NOT burn a legitimate id: the SAME id still works in scope', async () => {
    // The refusal must not claim the id or tombstone it in a way that suppresses a later, genuine
    // request — and it must not answer on behalf of an id an in-scope request already owns.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    // An in-scope request claims id 90 and stays pending.
    transport.serverRequest(90, 'item/commandExecution/requestApproval', { command: 'legit' })
    await vi.waitFor(() => expect(cards(events).length).toBe(1))

    // A foreign-thread copy of the SAME id must not answer for the live one.
    transport.serverRequest(90, 'item/commandExecution/requestApproval', {
      threadId: 'th_OTHER',
      command: 'evil',
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(cards(events)).toHaveLength(1) // still just the legitimate card
    expect(transport.responses).toHaveLength(0) // the owner's response is still to come

    // The legitimate request answers normally — its id was never burned.
    await handle.respondPermission('number:90', { outcome: 'allow' })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    expect(transport.responses[0]).toEqual({ id: 90, result: { decision: 'accept' } })

    await handle.close()
    await consumer
  })

  it('an UNSUPPORTED method is still a JSON-RPC error, and is refused before any scope logic', async () => {
    const { transport, handle, consumer } = await startCodexInTurn()
    transport.serverRequestRaw(99, 'item/future/requestSomething', { threadId: 'th_OTHER' })
    await vi.waitFor(() => expect(transport.errors.length).toBe(1))
    expect(transport.errors[0]).toMatchObject({ id: 99, code: -32601 })
    await handle.close()
    await consumer
  })
})

describe('CodexRuntime — the server-request id lifecycle is one state machine (066 F1+F2)', () => {
  const cards = (events: RuntimeEvent[]): RuntimeEvent[] =>
    events.filter((e) => e.type === 'permission_request' || e.type === 'user_input_request')
  const acceptsFor = (transport: FakeTransport, id: number) =>
    transport.responses.filter(
      (r) => r.id === id && (r.result as { decision?: string }).decision === 'accept',
    )

  it('F1: a same-kind duplicate arriving BEFORE the answer is processed → decline, never accept', () =>
    (async () => {
      const { transport, handle, events, consumer } = await startCodexInTurn()
      transport.serverRequest(42, 'item/commandExecution/requestApproval', { command: 'legit' })
      await vi.waitFor(() => expect(cards(events).length).toBe(1))

      // A second in-scope request reuses the live id: the provider now has two outstanding
      // requests under id 42 and no answer can be attributed to one of them.
      transport.serverRequest(42, 'item/commandExecution/requestApproval', { command: 'evil' })
      await vi.waitFor(() => expect(transport.responses.length).toBe(1))

      expect(cards(events)).toHaveLength(1) // the duplicate never got a card
      expect(transport.responses).toEqual([{ id: 42, result: { decision: 'decline' } }])
      // …and the OWNER's card is retired, not left on screen as a dead card the user cannot
      // action: the collision spends the id, so answering it throws — the UI must be told.
      expect(events.filter((e) => e.type === 'request_resolved')).toEqual([
        { type: 'request_resolved', id: 'number:42' },
      ])
      // The card is dead: answering it cannot resurrect an accept.
      await expect(handle.respondPermission('number:42', { outcome: 'allow' })).rejects.toThrow()
      await new Promise((r) => setTimeout(r, 20))
      expect(acceptsFor(transport, 42)).toHaveLength(0)

      await handle.close()
      await consumer
    })())

  it('F1: the duplicate enqueued in the SAME TICK as the answer still yields exactly one response', async () => {
    // 066's probe: enqueue the duplicate, then answer synchronously in the same tick. Whichever
    // transition happens first, the id is SPENT atomically — so there is exactly ONE wire response
    // and never both an accept and a decline.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(42, 'item/commandExecution/requestApproval', { command: 'legit' })
    await vi.waitFor(() => expect(cards(events).length).toBe(1))

    transport.serverRequest(42, 'item/commandExecution/requestApproval', { command: 'evil' })
    await handle.respondPermission('number:42', { outcome: 'allow' }).catch(() => undefined)
    await new Promise((r) => setTimeout(r, 30))

    // EXACTLY ONE response for the id — no accept-after-decline, no decline-after-accept.
    expect(transport.responses.filter((r) => r.id === 42)).toHaveLength(1)
    expect(cards(events)).toHaveLength(1) // still only the owner's card
    await handle.close()
    await consumer
  })

  it('F2: an id SPENT by an out-of-scope refusal serves NO second request (no dead card)', async () => {
    // Pre-fix: the out-of-scope decline marked the id responded but not claimed, so the legit
    // request that followed got a card whose answer was then silently dropped on the wire.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(77, 'item/commandExecution/requestApproval', {
      threadId: 'th_OTHER',
      command: 'evil',
    })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    expect(transport.responses[0]).toEqual({ id: 77, result: { decision: 'decline' } })

    // A legitimate, in-scope request now reuses the spent id.
    transport.serverRequest(77, 'item/commandExecution/requestApproval', { command: 'legit' })
    await new Promise((r) => setTimeout(r, 30))

    expect(cards(events), 'a spent id must not publish a card').toHaveLength(0)
    expect(transport.responses.filter((r) => r.id === 77)).toHaveLength(1)
    await handle.close()
    await consumer
  })

  it('F2: an id SPENT by an unsupported-method error serves NO second request', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequestRaw(950, 'item/future/requestSomething', { threadId: 'th_1' })
    await vi.waitFor(() => expect(transport.errors.length).toBe(1))

    transport.serverRequest(950, 'item/commandExecution/requestApproval', { command: 'legit' })
    await new Promise((r) => setTimeout(r, 30))

    expect(cards(events)).toHaveLength(0)
    expect(transport.responses.filter((r) => r.id === 950)).toHaveLength(0)
    await handle.close()
    await consumer
  })

  it('F2 reverse: a legit CLAIMED id is not burned by a later unsupported request for the same id', async () => {
    // The DoS guard (061 generalised): an illegitimate collider — unsupported or out of scope —
    // is not a claim, so it may not kill a live card. The owner still answers normally.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(950, 'item/commandExecution/requestApproval', { command: 'legit' })
    await vi.waitFor(() => expect(cards(events).length).toBe(1))

    transport.serverRequestRaw(950, 'item/future/requestSomething', { threadId: 'th_1' })
    await new Promise((r) => setTimeout(r, 20))
    expect(transport.errors.filter((e) => e.id === 950)).toHaveLength(0) // owner's slot untouched

    await handle.respondPermission('number:950', { outcome: 'allow' })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    expect(transport.responses[0]).toEqual({ id: 950, result: { decision: 'accept' } })
    await handle.close()
    await consumer
  })

  it('SINGLE-SHOT: a normal in-scope approval still resolves with exactly one accept', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(5, 'item/commandExecution/requestApproval', { command: 'ls' })
    await vi.waitFor(() => expect(cards(events).length).toBe(1))
    await handle.respondPermission('number:5', { outcome: 'allow' })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    expect(transport.responses).toEqual([{ id: 5, result: { decision: 'accept' } }])
    // Answering twice never writes twice.
    await expect(handle.respondPermission('number:5', { outcome: 'allow' })).rejects.toThrow()
    await new Promise((r) => setTimeout(r, 20))
    expect(transport.responses.filter((r) => r.id === 5)).toHaveLength(1)
    await handle.close()
    await consumer
  })

  it('a user-input answer is atomic too: one response, and a late answer writes nothing', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(6, 'item/tool/requestUserInput', {
      questions: [{ id: 'q1', prompt: 'pick' }],
    })
    await vi.waitFor(() => expect(cards(events).length).toBe(1))
    await handle.respondUserInput('number:6', { kind: 'answer', answers: { q1: 'yes' } })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    await expect(
      handle.respondUserInput('number:6', { kind: 'answer', answers: { q1: 'no' } }),
    ).rejects.toThrow()
    await new Promise((r) => setTimeout(r, 20))
    expect(transport.responses.filter((r) => r.id === 6)).toHaveLength(1)
    await handle.close()
    await consumer
  })
})

describe('waiting on the user is not silence (076)', () => {
  /** Drive a turn to an open `user_input_request` and leave it unanswered. */
  async function awaitingAnswer() {
    const ctx = await startCodexInTurn()
    ctx.transport.serverRequest(11, 'item/tool/requestUserInput', {
      questions: [{ id: 'q1', prompt: 'which one?' }],
    })
    await vi.waitFor(has(ctx.events, (e) => e.type === 'user_input_request'))
    return ctx
  }

  it('the status is waiting_permission while a question is open, and the watchdog is disarmed', async () => {
    const { transport, handle, events, consumer } = await awaitingAnswer()

    expect(handle.status()).toBe('waiting_permission')
    expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(1)
    const watchdog = (handle as unknown as { stallWatchdog: { armed: boolean } }).stallWatchdog
    expect(watchdog.armed, 'the watchdog must be disarmed while waiting on the user').toBe(false)

    await handle.respondUserInput('number:11', { kind: 'answer', answers: { q1: 'a' } })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    await handle.close()
    await consumer
  })

  it('no stall ping fires while the user is thinking', async () => {
    const { handle, events, consumer } = await awaitingAnswer()

    const withStall = handle as unknown as { reportStall(ms: number): void }
    withStall.reportStall(120_000)
    await new Promise((r) => setTimeout(r, 20))

    expect(
      events.filter((e) => e.type === 'error' && /no activity/.test(e.message)),
      'no stall ping may fire while a question is open',
    ).toHaveLength(0)

    await handle.close()
    await consumer
  })

  it('after the answer the status returns to working and a GENUINE stall still pings', async () => {
    const { transport, handle, events, consumer } = await awaitingAnswer()
    await handle.respondUserInput('number:11', { kind: 'answer', answers: { q1: 'a' } })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    await vi.waitFor(() => expect(handle.status()).toBe('working'))

    const withStall = handle as unknown as { reportStall(ms: number): void }
    withStall.reportStall(120_000)
    await vi.waitFor(has(events, (e) => e.type === 'error' && /no activity/.test(e.message)))

    await handle.close()
    await consumer
  })
})

describe('a silence after reasoning is said as thinking (F145)', () => {
  async function silenceAfter(method: string, params: Record<string, unknown>): Promise<string[]> {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    vi.useFakeTimers()
    try {
      transport.notification(method, { threadId: 'th_1', turnId: 'tn_1', ...params })
      await vi.advanceTimersByTimeAsync(121_000)
      return events
        .filter((e) => e.type === 'error')
        .map((e) => (e.type === 'error' ? e.message : ''))
    } finally {
      vi.useRealTimers()
      await handle.close()
      await consumer
    }
  }

  it('after a reasoning summary, two silent minutes read "Still thinking (2 min)."', async () => {
    expect(
      await silenceAfter('item/reasoning/summaryTextDelta', {
        itemId: 'rs_1',
        summaryIndex: 0,
        delta: 'weighing it',
      }),
    ).toEqual(['Still thinking (2 min).'])
  })

  it("after the model's words, the same silence keeps today's notice", async () => {
    const said = await silenceAfter('item/agentMessage/delta', { itemId: 'm1', delta: 'hi' })
    expect(said).toHaveLength(1)
    expect(said[0]).toMatch(/^still working — no activity for 120s\..*you can interrupt\.$/)
  })

  it('the thinking notice is said once: it neither re-arms the watchdog nor forgets the reasoning', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    vi.useFakeTimers()
    const stalls = () =>
      events.flatMap((e) =>
        e.type === 'error' ? [{ message: e.message, stall: e.stall, thinking: e.thinking }] : [],
      )
    try {
      transport.notification('item/reasoning/summaryTextDelta', {
        threadId: 'th_1',
        turnId: 'tn_1',
        itemId: 'rs_1',
        summaryIndex: 0,
        delta: 'weighing it',
      })
      await vi.advanceTimersByTimeAsync(121_000)
      expect(stalls()).toEqual([
        { message: 'Still thinking (2 min).', stall: true, thinking: true },
      ])
      await vi.advanceTimersByTimeAsync(120_000)
      expect(stalls(), 'the notice re-armed the watchdog').toEqual([
        { message: 'Still thinking (2 min).', stall: true, thinking: true },
      ])

      // Real progress that is not reasoning re-arms it, and the next silence is said as today.
      transport.notification('item/agentMessage/delta', {
        threadId: 'th_1',
        turnId: 'tn_1',
        itemId: 'm1',
        delta: 'hi',
      })
      await vi.advanceTimersByTimeAsync(121_000)
      expect(stalls()).toHaveLength(2)
      expect(stalls()[1]?.message).toMatch(/^still working — no activity for 120s\./)
      expect(stalls()[1]?.thinking).toBeUndefined()
    } finally {
      vi.useRealTimers()
      await handle.close()
      await consumer
    }
  })
})

describe('auto-approve mode — Codex (078)', () => {
  async function startWith(approvalMode?: 'ask' | 'auto') {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () =>
      approvalMode === 'auto'
        ? ({
            ...okThread('th_1'),
            approvalPolicy: 'never',
            approvalsReviewer: 'user',
            sandbox: { type: 'dangerFullAccess' },
          } as Record<string, unknown>)
        : okThread('th_1'),
    )
    const runtime = new CodexRuntime(adopt(transport))
    const handle = await runtime.start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
      ...(approvalMode ? { approvalMode } : {}),
    })
    return { transport, handle }
  }

  const startParams = (transport: FakeTransport) =>
    transport.requests.find((r) => r.method === 'thread/start')?.params as Record<string, unknown>

  it('ASK is unchanged — the prompting profile, by default and when asked for', async () => {
    // ⚑ 736 · R96 — the prompting profile's sandbox is the Codex CLI's default preset now
    // (`workspace-write`; `read-only` until then). Unchanged by 078 is the subject.
    for (const mode of [undefined, 'ask' as const]) {
      const { transport, handle } = await startWith(mode)
      expect(startParams(transport)).toMatchObject({
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
        sandbox: 'workspace-write',
      })
      await handle.close()
    }
  })

  it('AUTO starts the thread with never + danger-full-access, and the validator ACCEPTS it', async () => {
    // The generated enums (`AskForApproval` has 'never'; `SandboxMode` has 'danger-full-access')
    // were read from the vendored protocol, not guessed.
    const { transport, handle } = await startWith('auto')
    expect(startParams(transport)).toMatchObject({
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandbox: 'danger-full-access',
    })
    // Reaching a live handle at all means validateApprovalProfile accepted the echoed yolo profile.
    expect(handle.ref?.sessionId).toBe('th_1')
    await handle.close()
  })

  /**
   * 🔴 **160 · the CLI-equivalence assertions, and why they are HERE rather than only in a doc.**
   *
   * ⛔ 157 moved both modes onto named `[permissions.<id>]` profiles so that `auto` kept the whole
   * machine minus the credential roots. It worked. It was still the wrong call: the reason given was
   * that BroBot is unlike the CLI, and a CLI agent can already read `~/.codex/auth.json`. **A revert
   * that only deleted 157's tests would leave nothing standing against re-adding the profile.**
   *
   * ⚑ **What each of these pins was MEASURED on the pinned 0.146.0 binary by 160**, against a
   * disposable `CODEX_HOME`, using `command/exec` (a standalone request — no thread, no turn, no
   * tokens), same command under each policy:
   *
   * | operation | `sandboxPolicy: dangerFullAccess` | `permissionProfile: brobot-auto` |
   * |---|---|---|
   * | read a credential file in a denied root | exit 0 | ⛔ *"Operation not permitted"* |
   * | `ps -o pid= -p 1` | exit 0 | ⛔ *"sandbox-exec: execvp() of 'ps' failed"* |
   * | `top -l 1 -n 0` | exit 0 | ⛔ refused |
   *
   * ⚠️ **The loss came from having ANY Seatbelt profile, not from the deny entries** — `ps`, `top`,
   * `sudo` and the rest are setuid binaries, and nothing in `[permissions.<id>.filesystem]` grants
   * them back because they are not filesystem rules. An empty deny set would not have bought them
   * back. `danger-full-access` applies no policy at all, which is the whole of why it is here.
   */
  describe('and it behaves like the CLI, which is what `danger-full-access` buys (160)', () => {
    it('⚑ AUTO carries NO permissions profile — the field 157 added is gone from every request', async () => {
      // ⛔ The paired negative for the `sandbox: 'danger-full-access'` positive above. 155 measured
      // that `permissions` and `sandbox` are MUTUALLY EXCLUSIVE (-32600, *"`permissions` cannot be
      // combined with `sandbox`"*), so a request carrying both would not merely be redundant — it
      // would fail every launch. This is what makes the revert a clean swap rather than a merge.
      const { transport, handle } = await startWith('auto')
      await handle.send('go')
      const carrying = transport.requests.filter(
        (r) => (r.params as Record<string, unknown>)?.['permissions'] !== undefined,
      )
      expect(carrying.map((r) => r.method)).toEqual([])
      // …and the positive beside it, so this cannot pass by no requests being made at all.
      expect(transport.requests.map((r) => r.method)).toEqual(
        expect.arrayContaining(['thread/start', 'turn/start']),
      )
      await handle.close()
    })

    it('⚑ …and neither does ASK, whose behaviour did not move through either change', async () => {
      // 001 non-negotiable 1. 157 could not give `ask` the deny set anyway — a single `deny` entry
      // disables approval escalation, so an accepted card did nothing — which is why `ask` shipped
      // with an empty deny set and is byte-for-byte unchanged now that the profile is gone.
      const { transport, handle } = await startWith('ask')
      await handle.send('go')
      expect(
        transport.requests.filter(
          (r) => (r.params as Record<string, unknown>)?.['permissions'] !== undefined,
        ),
      ).toEqual([])
      // ⚑ 736 · R96 moved `ask`'s sandbox to the CLI's default preset — still a sandbox MODE, never
      // a permissions profile, which is what this pins.
      expect(startParams(transport)).toMatchObject({
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
        sandbox: 'workspace-write',
      })
      await handle.close()
    })

    it('⛔ Codex is handed no path policy and no permissions profile — its sandbox mode is the whole of it', async () => {
      // ⚑ **This is the assertion that says what `auto` means now.** `danger-full-access` applies no
      // Seatbelt policy, so a Codex session in `auto` can read `~/.codex/auth.json` and run `ps` —
      // measured above, and exactly what the same agent does in a terminal. There is no per-call
      // hook on this adapter to narrow it and, since 160, no profile either. (Until `726` the app's
      // `protectedRoots` could be handed to `start` and reached no request; R92 removed the field.)
      const { transport, handle } = await startWith('auto')
      await handle.send('go')
      const wire = JSON.stringify(transport.requests)
      expect(wire).not.toContain('permissions')
      // …and the positive: the requests really were made and really do carry the yolo sandbox, so
      // the absence above is an absence from something rather than from nothing.
      expect(wire).toContain('danger-full-access')
      await handle.close()
    })
  })

  /**
   * 🔴 **160 §2 · the trap in the revert: 157 WROTE a `[permissions.*]` block into every home.**
   *
   * ⚑ **Measured on the pinned 0.146.0 binary rather than reasoned about** — a disposable
   * `CODEX_HOME` carrying 157's exact file, launched the way 160 launches: `thread/start` with
   * `read-only` and with `danger-full-access` both succeed, a cold-process `thread/resume` on a real
   * rollout succeeds, `activePermissionProfile` comes back **null** in every case, and stderr and
   * `configWarning` are empty. **A stale block does nothing to a launch.** 157 §11.3 had warned the
   * failure mode might be *every Codex session refuses to open*; it is not.
   *
   * ⚠️ **Inert is not ignored, which is why the file is removed rather than left.** Naming the block
   * explicitly on a `command/exec` in the same process proved it live — a denied read came back
   * *"Operation not permitted"*, `ps` came back *"sandbox-exec: execvp() failed"*. What sat in those
   * homes was a working, credential-denying policy that nothing selects, under a header claiming it
   * is rewritten every launch. See `codex-stale-permission-config.test.ts` for the removal's own
   * fail-safe, and `stale-permission-config.ts` for the whole measurement.
   */
  describe('a home carrying 157’s stale `[permissions.*]` block (160 §2)', () => {
    let home: string

    beforeEach(() => {
      home = mkdtempSync(join(tmpdir(), 'brobot2-stale-launch-'))
    })

    afterEach(() => {
      rmSync(home, { recursive: true, force: true })
    })

    const STALE = '# Generated by BroBot2 — rewritten on every session launch. Do not edit.\n'

    for (const mode of ['ask', 'auto'] as const) {
      it(`⛔ STILL LAUNCHES — in ${mode}`, async () => {
        // Acceptance 5. The adapter must not turn a harmless file into a failed launch of its own
        // accord, and the binary does not either.
        writeFileSync(join(home, 'config.toml'), STALE)
        const transport = new FakeTransport()
        transport.onRequest('thread/start', () =>
          mode === 'auto'
            ? ({
                ...okThread('th_1'),
                approvalPolicy: 'never',
                approvalsReviewer: 'user',
                sandbox: { type: 'dangerFullAccess' },
              } as Record<string, unknown>)
            : okThread('th_1'),
        )
        const handle = await new CodexRuntime(adopt(transport)).start({
          cwd: '/tmp/x',
          providerHome: home,
          approvalMode: mode,
        })
        expect(handle.ref?.sessionId).toBe('th_1')
        await handle.close()
      })
    }

    it('⚑ …and the block is gone BEFORE the spawn, not after it', async () => {
      // ⚠️ **The ordering is the same one 157's WRITE needed, in reverse.** The app-server loads its
      // config once at startup, so a removal that ran after `transportFactory` would leave the block
      // live for the whole session — a migration that reports success and changes nothing.
      //
      // ⛔ **Corrected in place at 314, and the correction is the point.** This used to assert the
      // FILE was absent at the spawn. There is a `config.toml` at that moment again now, because
      // 314 writes the memory gates into every home on every launch — so the question the assertion
      // has to ask is whether 157's BLOCK is gone, which is what it was ever about. Both migrations
      // are above the spawn, and the second one is asserted here rather than left to be discovered.
      const config = join(home, 'config.toml')
      writeFileSync(config, STALE)
      let atSpawn: string | null = null
      const transport = new FakeTransport()
      transport.codexHome = home
      transport.onRequest('thread/start', () => okThread('th_1'))
      const handle = await new CodexRuntime(() => {
        atSpawn = existsSync(config) ? readFileSync(config, 'utf8') : null
        return transport
      }).start({ cwd: '/tmp/x', providerHome: home })
      expect(atSpawn, "157's block must already be gone when the transport is built").not.toContain(
        '# Generated by BroBot2',
      )
      expect(atSpawn, '…and 314’s gates must already be in it').toContain('memories = true')
      await handle.close()
    })

    it('⛔ …and even when its TOML no longer PARSES — 168 M4', async () => {
      // ⛔ **The one home that could not launch was the one the migration could never reach.**
      // `assertCodexSqliteHomeContained` parses this very file and fails closed on a config it
      // cannot read; it used to run BEFORE the removal, so a 157 block whose TOML had been broken
      // — by a half-written file, an editor, a merge — threw `AuthUnavailableError` on every start
      // and every resume, forever, with the line that would have deleted it two lines below the
      // throw. The removal runs first now.
      //
      // ⚠️ **Corrected in place at 314**: the block is still deleted here, and the home is then
      // given a fresh `config.toml` carrying only the memory gates. So the assertion moved from
      // *the file is absent* to *the block is gone and what is there now parses* — which is the
      // property 168 M4 was about, and the stronger half of it.
      const config = join(home, 'config.toml')
      writeFileSync(config, `${STALE}[permissions.deny\nthis = "is not toml\n`)
      const transport = new FakeTransport()
      transport.onRequest('thread/start', () => okThread('th_1'))
      const handle = await new CodexRuntime(adopt(transport)).start({
        cwd: '/tmp/x',
        providerHome: home,
      })
      expect(handle.ref?.sessionId).toBe('th_1')
      const after = readFileSync(config, 'utf8')
      expect(after, 'the unparseable block is gone, not merely stepped over').not.toContain(
        'permissions.deny',
      )
      expect(after).not.toContain('# Generated by BroBot2')
      expect(after).toContain('dedicated_tools = true')
      await handle.close()
    })

    it('⚑ …but an unparseable config that is NOT ours still fails the launch closed', async () => {
      // ⛔ **The paired positive, and the reason removing-before-attesting is not a hole.** The
      // removal deletes only a file carrying our own generated header. Somebody else's broken
      // `config.toml` reaches the attestation exactly as it did before, is refused there, and is
      // still on disk afterwards — this app does not delete a Codex config it did not write.
      const config = join(home, 'config.toml')
      writeFileSync(config, '[permissions.deny\nthis = "is not toml\n')
      const transport = new FakeTransport()
      transport.onRequest('thread/start', () => okThread('th_1'))
      await expect(
        new CodexRuntime(adopt(transport)).start({ cwd: '/tmp/x', providerHome: home }),
      ).rejects.toThrow(/could not be parsed/)
      expect(existsSync(config), 'left strictly alone').toBe(true)
    })

    it('⚑ a RESUME clears it too — the path a 157-era home is most likely to arrive by', async () => {
      // Resume reaches existing profiles’ homes. Remove the disabling block and add the gates
      // on that path as well as fresh launch.
      const config = join(home, 'config.toml')
      writeFileSync(config, STALE)
      const transport = new FakeTransport()
      transport.onRequest('thread/resume', () => okThread('th_1'))
      const handle = await new CodexRuntime(adopt(transport)).resume(
        { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 },
        { providerHome: home },
      )
      const after = readFileSync(config, 'utf8')
      expect(after).not.toContain('# Generated by BroBot2')
      expect(after).toContain('memories = true')
      await handle.close()
    })

    it('🔒 …but a config this app did NOT generate is MERGED into, never deleted or replaced', async () => {
      // The fail-safe, asserted where it matters: at launch, on a real home, not only in the unit.
      //
      // ⛔ **The title and the assertion were both corrected at 314, and the honest word is
      // "merged".** This used to say *survives the launch untouched* and compared the whole file
      // byte-for-byte — true while the app wrote nothing, and false the moment it writes the memory
      // gates. What the fail-safe actually promises has not changed: the removal deletes only a file
      // carrying our own generated header, and everything a person or Codex put in this file is
      // still here afterwards. That is what is asserted now, key by key, which is also what 312
      // measured the whole-file rewrite destroying.
      const config = join(home, 'config.toml')
      const theirs =
        'model = "gpt-5"\n\n[projects."/Users/someone/dev/thing"]\ntrust_level = "trusted"\n'
      writeFileSync(config, theirs)
      const transport = new FakeTransport()
      transport.onRequest('thread/start', () => okThread('th_1'))
      const handle = await new CodexRuntime(adopt(transport)).start({
        cwd: '/tmp/x',
        providerHome: home,
      })
      const after = readFileSync(config, 'utf8')
      expect(after).toContain('model = "gpt-5"')
      expect(after).toContain('[projects."/Users/someone/dev/thing"]\ntrust_level = "trusted"')
      expect(after).toContain('memories = true')
      await handle.close()
    })
  })

  it('ASK still REJECTS a `never` profile — 007 P1-6 is intact', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({
      ...okThread('th_1'),
      approvalPolicy: 'never',
      sandbox: { type: 'dangerFullAccess' },
    }))
    await expect(
      new CodexRuntime(adopt(transport)).start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' }),
    ).rejects.toThrow(/approval profile/i)
  })

  it('AUTO rejects a PARTIAL downgrade — approvals off but the sandbox still on', async () => {
    // Fail-closed per mode: "close enough" is exactly how an unnoticed half-applied profile slips
    // through, so `auto` is validated as strictly as `ask`, just against the other profile.
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({
      ...okThread('th_1'),
      approvalPolicy: 'never',
      // ⚑ 736 · R96 — the `ask` sandbox left on is `workspaceWrite` now (was `readOnly`).
      sandbox: { type: 'workspaceWrite' },
    }))
    await expect(
      new CodexRuntime(adopt(transport)).start({
        cwd: '/tmp/x',
        providerHome: '/tmp/x/home',
        approvalMode: 'auto',
      }),
    ).rejects.toThrow(/approval profile/i)
  })

  it('a RESUMED session re-applies its mode on thread/resume', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => ({
      ...okThread('th_1'),
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandbox: { type: 'dangerFullAccess' },
    }))
    const handle = await new CodexRuntime(adopt(transport)).resume(
      { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home', approvalMode: 'auto' },
    )
    const resumeParams = transport.requests.find((r) => r.method === 'thread/resume')?.params
    expect(resumeParams).toMatchObject({
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
    })
    await handle.close()
  })
})

describe('switching the approval mode mid-conversation — Codex (034)', () => {
  const turnParams = (transport: FakeTransport) =>
    transport.requests
      .filter((r) => r.method === 'turn/start')
      .map((r) => r.params as Record<string, unknown>)

  /**
   * ⚑ **736 · R96 — the `ask` sandbox as the fixture's handshake echoes it** (`workspaceWrite`, what
   * bundled 0.146.0 echoes for `sandbox: 'workspace-write'`); until `736` `{type:'readOnly',
   * networkAccess:false}`. ⚠️ Also, field for field, the adapter's fallback when nothing was echoed.
   */
  const WORKSPACE_WRITE_ECHOED = {
    type: 'workspaceWrite',
    writableRoots: [],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  }

  async function inTurn(approvalMode?: 'ask' | 'auto') {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () =>
      approvalMode === 'auto'
        ? ({
            ...okThread('th_1'),
            approvalPolicy: 'never',
            approvalsReviewer: 'user',
            sandbox: { type: 'dangerFullAccess' },
          } as Record<string, unknown>)
        : okThread('th_1'),
    )
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
      ...(approvalMode ? { approvalMode } : {}),
    })
    return { transport, handle }
  }

  it('EVERY turn re-pins the whole profile, not just the reviewer', async () => {
    // Nothing re-asserted the policy or the sandbox after the handshake, so a mid-session override
    // could move either and only `thread/settings/updated` would notice. It is also the mechanism
    // the switch below rides on, which is why it has to be unconditional.
    const { transport, handle } = await inTurn()
    await handle.send('one')
    expect(turnParams(transport)[0]).toMatchObject({
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      // `workspaceWrite` carries four fields the `thread/start` string form has no room for (⚑ 736 ·
      // R96; `readOnly`'s one network flag until then). These are what the app-server echoes for a
      // thread started `workspace-write`, so re-sending them every turn has to be a no-op — a re-pin
      // that quietly changed the sandbox would be worse than none.
      sandboxPolicy: WORKSPACE_WRITE_ECHOED,
    })
    await handle.close()
  })

  it('a requested change does NOT touch the turn already running', async () => {
    // The wire fact this whole design is built on (034 probe, live app-server): a mid-turn
    // `thread/settings/update` is ACCEPTED and echoed back, and the very next command in that same
    // turn prompts anyway. So the only honest thing to do is not to move until the next turn.
    const { transport, handle } = await inTurn()
    await handle.send('one')
    await handle.setApprovalMode('auto')

    expect(handle.approval).toEqual({ effective: 'ask', requested: 'auto' })
    // Not one extra frame on the wire: nothing can be said to the provider that would matter yet.
    expect(transport.requests.filter((r) => r.method === 'thread/settings/update')).toHaveLength(0)
    // And the card the user may be looking at RIGHT NOW still discloses the mode it was raised
    // under — the mode that is actually governing it.
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    transport.serverRequest(1, 'item/commandExecution/requestApproval', { command: 'ls' })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    expect(firstOfType(events, 'permission_request').scope.approvalMode).toBe('ask')
    await handle.close()
    await consumer
  })

  it('the NEXT turn carries it, and it is effective from the moment it is sent', async () => {
    const { transport, handle } = await inTurn()
    await handle.send('one')
    await handle.setApprovalMode('auto')
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn(transport.lastTurnId)),
    )
    await vi.waitFor(() => expect(handle.status()).toBe('idle'))

    await handle.send('two')
    expect(turnParams(transport)[1]).toMatchObject({
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandboxPolicy: { type: 'dangerFullAccess' },
    })
    // Adopted in the same step that sends it: what the provider was told and what we claim can
    // never be read apart from one another.
    expect(handle.approval).toEqual({ effective: 'auto', requested: 'auto' })
    await handle.close()
  })

  it('switches back, and the reverse direction is not special', async () => {
    const { transport, handle } = await inTurn('auto')
    await handle.setApprovalMode('ask')
    expect(handle.approval).toEqual({ effective: 'auto', requested: 'ask' })
    await handle.send('one')
    expect(turnParams(transport)[0]).toMatchObject({
      approvalPolicy: 'on-request',
      // ⚑ 736 · a thread started in `auto` echoed no `ask` sandbox, so this is the fallback —
      // `workspaceWrite` with nothing extra (`readOnly`, no network, until `736`).
      sandboxPolicy: WORKSPACE_WRITE_ECHOED,
    })
    expect(handle.approval.effective).toBe('ask')
    await handle.close()
  })

  it('only the exact string turns approvals off', async () => {
    // The same fail-safe rule as at creation (078), re-applied because this is a second door to
    // the same room: anything that is not literally `auto` lands on the prompting profile.
    const { handle } = await inTurn()
    await handle.setApprovalMode('AUTO' as 'auto')
    expect(handle.approval.requested).toBe('ask')
    await handle.close()
  })

  it('the mid-session settings guard follows the NEW mode once it is adopted', async () => {
    // `thread/settings/updated` fails the session closed when the effective profile disagrees with
    // the mode (007 P1-6). Codex sends one in response to a turn-start override — measured — so if
    // the guard were still checking the old mode, using the switch would kill the session.
    const { transport, handle } = await inTurn()
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    await handle.setApprovalMode('auto')
    await handle.send('one')
    transport.notification('thread/settings/updated', {
      threadId: 'th_1',
      threadSettings: {
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
        sandboxPolicy: { type: 'dangerFullAccess' },
      },
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(events.filter((e) => e.type === 'error')).toHaveLength(0)
    expect(handle.status()).not.toBe('errored')
    await handle.close()
    await consumer
  })

  it('still fails closed when the provider moves to a profile NOBODY asked for', async () => {
    // The guard has not been loosened — only re-pointed. A settings change to the yolo profile on a
    // session whose requested mode is still `ask` is the confused-deputy case it exists for.
    const { transport, handle } = await inTurn()
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    await handle.send('one')
    transport.notification('thread/settings/updated', {
      threadId: 'th_1',
      threadSettings: {
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
        sandboxPolicy: { type: 'dangerFullAccess' },
      },
    })
    await vi.waitFor(has(events, (e) => e.type === 'error' && e.fatal === true))
    expect(events.some((e) => e.type === 'status' && e.state === 'errored')).toBe(true)
    await consumer
  })

  it('a turn/start that FAILS un-adopts the mode it was carrying (034 review)', async () => {
    // The mode is adopted before the request is written, which is the safe direction while a turn is
    // genuinely in flight — but it is only tolerable because the NEXT turn re-sends the profile and
    // corrects any overstatement. A turn/start that never landed has no next turn to correct it, so
    // without a rollback the session would sit there claiming AUTO while the app-server was never
    // told anything and nothing had run unprompted.
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1'))
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
    })
    // Rejected, not thrown: the real transport returns a promise on every path — a terminal error
    // rejects, and a failed stdin write is caught and rejected — so a synchronous throw would be a
    // shape only the fake can produce.
    transport.failRequest('turn/start')
    await handle.setApprovalMode('auto')
    await handle.send('one')
    await vi.waitFor(() => expect(handle.approval.effective).toBe('ask'))
    // The user's choice did not fail — the turn did. So it is still queued for the next one.
    expect(handle.approval).toEqual({ effective: 'ask', requested: 'auto' })
    await handle.close()
  })

  it('the per-turn sandbox re-pin echoes the SERVER’s workspaceWrite policy, not our guess (034 review)', async () => {
    // The thread is opened with the bare string `sandbox: 'workspace-write'`, which has no room for
    // its writable roots, network flag or temp-dir flags — the server picks them. Re-pinning the
    // tagged policy every turn means asserting a value for each, and asserting a captured constant
    // would quietly TIGHTEN (or loosen) the sandbox on any deployment whose default differs. So we
    // re-send what it told us it was. ⚑ 736 · R96 — `workspaceWrite` (was `readOnly`), and every
    // field below differs from the fallback, so a guess cannot pass.
    const echoed = {
      type: 'workspaceWrite',
      writableRoots: ['/tmp/also'],
      networkAccess: true,
      excludeTmpdirEnvVar: true,
      excludeSlashTmp: true,
    }
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({ ...okThread('th_1'), sandbox: echoed }))
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
    })
    await handle.send('one')
    expect(turnParams(transport)[0]?.['sandboxPolicy']).toEqual(echoed)
    await handle.close()
  })

  it('…and it keeps following the server when the settings change (034 review)', async () => {
    // ⚑ 736 · R96 — the `workspaceWrite` echo (was `readOnly`).
    const { transport, handle } = await inTurn()
    await handle.send('one')
    expect(turnParams(transport)[0]).toMatchObject({ sandboxPolicy: WORKSPACE_WRITE_ECHOED })
    const updated = { ...WORKSPACE_WRITE_ECHOED, writableRoots: ['/tmp/also'], networkAccess: true }
    transport.notification('thread/settings/updated', {
      threadId: 'th_1',
      threadSettings: {
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
        sandboxPolicy: updated,
      },
    })
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn(transport.lastTurnId)),
    )
    await vi.waitFor(() => expect(handle.status()).toBe('idle'))
    await handle.send('two')
    expect(turnParams(transport)[1]?.['sandboxPolicy']).toEqual(updated)
    await handle.close()
  })

  it('a dangerFullAccess echo teaches it nothing about workspaceWrite (034 review)', async () => {
    // Only a fully-formed workspaceWrite policy is evidence about what the `ask` sandbox means here
    // (⚑ 736 · R96; readOnly until then). The yolo profile's echo is about the OTHER mode, and a
    // switch back must not carry it over.
    const { transport, handle } = await inTurn()
    await handle.setApprovalMode('auto')
    await handle.send('one')
    transport.notification('thread/settings/updated', {
      threadId: 'th_1',
      threadSettings: {
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
        sandboxPolicy: { type: 'dangerFullAccess' },
      },
    })
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn(transport.lastTurnId)),
    )
    await vi.waitFor(() => expect(handle.status()).toBe('idle'))
    await handle.setApprovalMode('ask')
    await handle.send('two')
    expect(turnParams(transport)[1]).toMatchObject({ sandboxPolicy: WORKSPACE_WRITE_ECHOED })
    await handle.close()
  })
})

/**
 * 🔴 **W4.189 · a give's folder is a work-folder grant on the conversation** — on Codex, extra
 * `writableRoots` of the `ask` sandbox: on every `turn/start`, and on the thread itself at
 * `thread/start` and `thread/resume`. ⛔ Nothing in `auto`. ⚑ Next-turn, like the settings 076 made.
 */
describe('W4.189 · work folders are writable roots of the ask sandbox — Codex', () => {
  const turnParams = (transport: FakeTransport) =>
    transport.requests
      .filter((r) => r.method === 'turn/start')
      .map((r) => r.params as Record<string, unknown>)
  const sandboxOf = (transport: FakeTransport, turn: number) =>
    turnParams(transport)[turn]?.['sandboxPolicy']
  const configOf = (transport: FakeTransport, method: 'thread/start' | 'thread/resume') =>
    (transport.requests.find((r) => r.method === method)?.params as { config?: unknown }).config
  /** What the fixture's handshake echoes for `ask` — no root, no network, no temp dir excluded. */
  const ECHOED = {
    type: 'workspaceWrite',
    writableRoots: [] as string[],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  }
  const AUTO_ECHO = {
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
    sandbox: { type: 'dangerFullAccess' },
  }

  async function launch(
    opts: {
      approvalMode?: 'ask' | 'auto'
      workFolders?: readonly string[]
      /** The `ask` sandbox the handshake echoes, when a test is about the echo. */
      echoed?: Record<string, unknown>
    } = {},
  ) {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({
      ...okThread('th_1'),
      ...(opts.approvalMode === 'auto' ? AUTO_ECHO : {}),
      ...(opts.echoed ? { sandbox: opts.echoed } : {}),
    }))
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
      ...(opts.approvalMode ? { approvalMode: opts.approvalMode } : {}),
      ...(opts.workFolders ? { workFolders: opts.workFolders } : {}),
    })
    return { transport, handle }
  }

  /** End the running turn as the server would, and wait for the session to be idle again. */
  async function endTurn(transport: FakeTransport, handle: SessionHandle): Promise<void> {
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn(transport.lastTurnId)),
    )
    await vi.waitFor(() => expect(handle.status()).toBe('idle'))
  }

  /** The server echoing the `ask` sandbox it now runs, as it does after a turn's override. */
  function echo(transport: FakeTransport, sandboxPolicy: Record<string, unknown>): void {
    transport.notification('thread/settings/updated', {
      threadId: 'th_1',
      threadSettings: { approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxPolicy },
    })
  }

  it('🔴 a launch’s work folders are writable roots of its first turn — and of the thread it opened', async () => {
    const { transport, handle } = await launch({ workFolders: ['/w/a', '/w/b'] })
    expect(configOf(transport, 'thread/start'), 'the thread’s own sandbox agrees').toEqual({
      ...EVERY_THREAD_OVERLAY,
      'sandbox_workspace_write.writable_roots': ['/w/a', '/w/b'],
    })
    expect(handle.workFolders).toEqual({ effective: ['/w/a', '/w/b'], requested: ['/w/a', '/w/b'] })
    await handle.send('one')
    expect(sandboxOf(transport, 0)).toEqual({ ...ECHOED, writableRoots: ['/w/a', '/w/b'] })
    await handle.close()
  })

  it('⚑ THE CONTROL — no work folder: the overlay names no roots, and the turn re-pins the echo as it was', async () => {
    const { transport, handle } = await launch()
    expect(configOf(transport, 'thread/start')).toEqual({ ...EVERY_THREAD_OVERLAY })
    await handle.send('one')
    expect(sandboxOf(transport, 0)).toEqual(ECHOED)
    expect(handle.workFolders).toEqual({ effective: [], requested: [] })
    await handle.close()
  })

  it('⛔ auto carries none — no overlay key, and `dangerFullAccess` alone on the turn', async () => {
    const { transport, handle } = await launch({ approvalMode: 'auto', workFolders: ['/w/a'] })
    expect(configOf(transport, 'thread/start')).toEqual({ ...EVERY_THREAD_OVERLAY })
    await handle.send('one')
    expect(sandboxOf(transport, 0)).toEqual({ type: 'dangerFullAccess' })
    // ⚑ Still the session's grants: a switch to `ask` carries them on its next turn.
    expect(handle.workFolders.effective).toEqual(['/w/a'])
    await handle.setApprovalMode('ask')
    await endTurn(transport, handle)
    await handle.send('two')
    expect(sandboxOf(transport, 1)).toEqual({ ...ECHOED, writableRoots: ['/w/a'] })
    await handle.close()
  })

  it('🔴 a change mid-turn rides the NEXT turn, never the one running — and nothing goes on the wire for it', async () => {
    const { transport, handle } = await launch()
    await handle.send('one')
    handle.setWorkFolders(['/w/a'])
    expect(handle.workFolders).toEqual({ effective: [], requested: ['/w/a'] })
    expect(transport.requests.filter((r) => r.method === 'thread/settings/update')).toHaveLength(0)
    await endTurn(transport, handle)
    await handle.send('two')
    expect(sandboxOf(transport, 1)).toEqual({ ...ECHOED, writableRoots: ['/w/a'] })
    expect(handle.workFolders).toEqual({ effective: ['/w/a'], requested: ['/w/a'] })
    await handle.close()
  })

  it('⛔ a turn/start that FAILS un-adopts the list it was carrying, and keeps it asked for', async () => {
    const { transport, handle } = await launch({ workFolders: ['/w/a'] })
    transport.failRequest('turn/start')
    handle.setWorkFolders(['/w/a', '/w/b'])
    await handle.send('one')
    expect(sandboxOf(transport, 0), 'it was sent').toEqual({
      ...ECHOED,
      writableRoots: ['/w/a', '/w/b'],
    })
    await vi.waitFor(() => expect(handle.workFolders.effective).toEqual(['/w/a']))
    expect(handle.workFolders.requested, 'the person’s choice did not fail — the turn did').toEqual(
      ['/w/a', '/w/b'],
    )
    await handle.close()
  })

  it('🔴 THE BASELINE TRAP — a folder taken away is gone from the next turn, though the server echoed it back', async () => {
    // ⚠️ The re-pin re-sends the server's own echo (034), and after a turn that carried work folders
    // the echo carries them too. Taken as it came, a removed folder would ride every later turn.
    const { transport, handle } = await launch()
    handle.setWorkFolders(['/w/a', '/w/b'])
    await handle.send('one')
    echo(transport, { ...ECHOED, writableRoots: ['/w/a', '/w/b'] })
    await endTurn(transport, handle)

    handle.setWorkFolders(['/w/b'])
    await handle.send('two')
    expect(sandboxOf(transport, 1)).toEqual({ ...ECHOED, writableRoots: ['/w/b'] })
    echo(transport, { ...ECHOED, writableRoots: ['/w/b'] })
    await endTurn(transport, handle)

    handle.setWorkFolders([])
    await handle.send('three')
    expect(sandboxOf(transport, 2)).toEqual(ECHOED)
    await handle.close()
  })

  it('🔴 …and a folder the LAUNCH named, which the handshake echoed, is taken away the same way', async () => {
    const { transport, handle } = await launch({
      workFolders: ['/w/a'],
      echoed: { ...ECHOED, writableRoots: ['/w/a'] },
    })
    handle.setWorkFolders([])
    await handle.send('one')
    expect(sandboxOf(transport, 0)).toEqual(ECHOED)
    await handle.close()
  })

  it('⚑ a root the thread had BEFORE any work folder is the thread’s own — a grant of the same path ending leaves it', async () => {
    const { transport, handle } = await launch({ echoed: { ...ECHOED, writableRoots: ['/w/own'] } })
    handle.setWorkFolders(['/w/own', '/w/a'])
    await handle.send('one')
    expect(sandboxOf(transport, 0), 'once each').toEqual({
      ...ECHOED,
      writableRoots: ['/w/own', '/w/a'],
    })
    echo(transport, { ...ECHOED, writableRoots: ['/w/own', '/w/a'] })
    await endTurn(transport, handle)
    handle.setWorkFolders([])
    await handle.send('two')
    expect(sandboxOf(transport, 1)).toEqual({ ...ECHOED, writableRoots: ['/w/own'] })
    await handle.close()
  })

  it('⚑ the server’s network and temp-dir flags ride through every change, as it reported them', async () => {
    const flags = { networkAccess: true, excludeTmpdirEnvVar: true, excludeSlashTmp: true }
    const { transport, handle } = await launch({
      workFolders: ['/w/a'],
      echoed: { ...ECHOED, ...flags, writableRoots: ['/w/a'] },
    })
    await handle.send('one')
    expect(sandboxOf(transport, 0)).toEqual({ ...ECHOED, ...flags, writableRoots: ['/w/a'] })
    await endTurn(transport, handle)
    handle.setWorkFolders([])
    await handle.send('two')
    expect(sandboxOf(transport, 1)).toEqual({ ...ECHOED, ...flags, writableRoots: [] })
    await handle.close()
  })

  it('🔴 a RESUME names them on the thread again — beside the effort the overlay already carries', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => okThread('th_1'))
    const handle = await new CodexRuntime(adopt(transport)).resume(
      { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home', workFolders: ['/w/a'], reasoningEffort: 'high' },
    )
    expect(configOf(transport, 'thread/resume')).toEqual({
      ...EVERY_THREAD_OVERLAY,
      'sandbox_workspace_write.writable_roots': ['/w/a'],
      model_reasoning_effort: 'high',
    })
    expect(handle.workFolders.effective).toEqual(['/w/a'])
    await handle.send('one')
    expect(sandboxOf(transport, 0)).toEqual({ ...ECHOED, writableRoots: ['/w/a'] })
    await handle.close()
  })

  it('⛔ …and an `auto` resume does not', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => ({ ...okThread('th_1'), ...AUTO_ECHO }))
    const handle = await new CodexRuntime(adopt(transport)).resume(
      { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home', approvalMode: 'auto', workFolders: ['/w/a'] },
    )
    expect(configOf(transport, 'thread/resume')).toEqual({ ...EVERY_THREAD_OVERLAY })
    await handle.close()
  })
})

describe('the approval mode is disclosed on the permission scope (078)', () => {
  it('a card raised in AUTO says the session is unattended', async () => {
    // In `auto` a card is itself an anomaly — so if one surfaces, it must state that everything
    // else in this session is running unprompted.
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({
      ...okThread('th_1'),
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandbox: { type: 'dangerFullAccess' },
    }))
    const runtime = new CodexRuntime(adopt(transport))
    const handle = await runtime.start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
      approvalMode: 'auto',
    })
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    await handle.send('go')
    transport.serverRequest(1, 'item/commandExecution/requestApproval', { command: 'ls' })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    expect(firstOfType(events, 'permission_request').scope.approvalMode).toBe('auto')
    await handle.close()
    await consumer
  })

  it('a card raised in ASK discloses ask — the disclosure is never blank', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(1, 'item/commandExecution/requestApproval', { command: 'ls' })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    expect(firstOfType(events, 'permission_request').scope.approvalMode).toBe('ask')
    await handle.close()
    await consumer
  })
})

describe('the effective model + reasoning come from the PROVIDER (081)', () => {
  it('the handshake response reports the model — not the option we passed', async () => {
    // We usually passed NO model and let the provider choose, so echoing our own input would be a
    // guess dressed as a fact. Started with no model, the descriptor still shows what Codex says.
    // ⚑ D-042 · R1: the desktop host no longer sends an absent model — every start and resume names
    // one, the provider's default among them by name. The adapter contract still allows an absent
    // model, so this case stands; and even a NAMED model is a request, never the report (081).
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({ ...okThread('th_1'), model: 'gpt-5.1-codex' }))
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
    })
    expect(handle.agentInfo?.model).toBe('gpt-5.1-codex')
    await handle.close()
  })

  it('the handshake ALSO reports the reasoning effort — a config.toml effort shows immediately (082)', async () => {
    // The 081 bug: only `ThreadSettings.effort` was read, so an effort set in `config.toml` was live
    // on the server from the first message yet the panel showed `…` until some later
    // `settings/updated` happened to arrive. `ThreadStartResponse.reasoningEffort` is the field.
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({
      ...okThread('th_1'),
      model: 'gpt-5.1-codex',
      reasoningEffort: 'high',
    }))
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
    })
    expect(handle.agentInfo?.reasoningEffort, 'available at start, not only later').toBe('high')
    expect(handle.agentInfo?.model).toBe('gpt-5.1-codex')
    await handle.close()
  })

  it('what we ASKED for reaches the wire — turn/start carries the effort (024)', async () => {
    // The 024 bug: `TurnStartParams.effort` is settable and was never set, so the server had
    // nothing to report and the panel said `…` forever. This is the write half of the fix, and
    // per-turn was the ONLY lever we used — `ThreadStartParams` has no effort field of its own.
    // ⚑ D-042: turn/start still carries the effort on every turn, and thread/start and
    // thread/resume now carry it too, through the config overlay (`config.model_reasoning_effort`,
    // `CodexSessionHandle.openTheThread`), so the handshake runs at it before the first turn.
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1'))
    const started: unknown[] = []
    transport.onRequest('turn/start', (params) => {
      started.push(params)
      return {}
    })
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
      reasoningEffort: 'high',
    })
    await handle.send('think hard about this')
    expect(started).toHaveLength(1)
    expect((started[0] as { effort?: string }).effort).toBe('high')
    await handle.close()
  })

  it('asking for nothing sends nothing — the server keeps its own default (024)', async () => {
    // Omitted must not become 'medium' on the wire: a value we never chose would override an
    // effort the user configured in config.toml, and would then be reported back as if it were
    // theirs.
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1'))
    const started: unknown[] = []
    transport.onRequest('turn/start', (params) => {
      started.push(params)
      return {}
    })
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
    })
    await handle.send('anything')
    expect((started[0] as { effort?: string }).effort).toBeUndefined()
    await handle.close()
  })

  it('a REPORTED effort is flagged as reported — Codex confirms, so it is fact (024)', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({
      ...okThread('th_1'),
      model: 'gpt-5.1-codex',
      reasoningEffort: 'high',
    }))
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
    })
    expect(handle.agentInfo?.reasoningEffortReported).toBe(true)
    await handle.close()
  })

  it('a handshake WITHOUT an effort still reports none — absent, never invented', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({ ...okThread('th_1'), model: 'gpt-5.1-codex' }))
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
    })
    expect(handle.agentInfo?.reasoningEffort).toBeUndefined()
    await handle.close()
  })

  it('a later model/rerouted preserves the handshake effort (082 + 081 no-erase)', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({
      ...okThread('th_1'),
      model: 'gpt-5.1-codex',
      reasoningEffort: 'high',
    }))
    const runtime = new CodexRuntime(adopt(transport))
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    transport.notification('model/rerouted', {
      threadId: 'th_1',
      turnId: 'tn_1',
      fromModel: 'gpt-5.1-codex',
      toModel: 'gpt-5.1-codex-mini',
      reason: 'overloaded',
    })
    await vi.waitFor(() => expect(handle.agentInfo?.model).toBe('gpt-5.1-codex-mini'))
    expect(handle.agentInfo?.reasoningEffort, 'a reroute reports no effort').toBe('high')
    await handle.close()
    await consumer
  })

  it('thread/settings/updated supplies the reasoning effort and keeps the model current', async () => {
    const { transport, handle, consumer } = await startCodex()
    transport.notification('thread/settings/updated', {
      threadId: 'th_1',
      threadSettings: {
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
        // ⚑ 736 · R96 — the prompting profile's sandbox (was `readOnly`, which now fails closed).
        sandboxPolicy: { type: 'workspaceWrite' },
        model: 'gpt-5.1-codex-max',
        effort: 'high', // the REAL field name — there is no `reasoning_effort` in the protocol
      },
    })
    await vi.waitFor(() => expect(handle.agentInfo?.reasoningEffort).toBe('high'))
    expect(handle.agentInfo?.model).toBe('gpt-5.1-codex-max')
    await handle.close()
    await consumer
  })

  it('a model/rerouted updates the model — the panel must not show a stale one', async () => {
    const { transport, handle, consumer } = await startCodex()
    transport.notification('thread/settings/updated', {
      threadId: 'th_1',
      threadSettings: {
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
        // ⚑ 736 · R96 — the prompting profile's sandbox (was `readOnly`, which now fails closed).
        sandboxPolicy: { type: 'workspaceWrite' },
        model: 'gpt-5.1-codex',
        effort: 'medium',
      },
    })
    await vi.waitFor(() => expect(handle.agentInfo?.model).toBe('gpt-5.1-codex'))

    transport.notification('model/rerouted', {
      threadId: 'th_1',
      turnId: 'tn_1',
      fromModel: 'gpt-5.1-codex',
      toModel: 'gpt-5.1-codex-mini',
      reason: 'overloaded',
    })
    await vi.waitFor(() => expect(handle.agentInfo?.model).toBe('gpt-5.1-codex-mini'))
    // A reroute reports no effort — the known one must survive rather than being erased.
    expect(handle.agentInfo?.reasoningEffort).toBe('medium')

    await handle.close()
    await consumer
  })
})

describe('plan mode reaches the Codex wire as collaborationMode (057)', () => {
  /** Start a session, run one turn, and hand back what `turn/start` was given. */
  async function turnParams(
    options: Record<string, unknown>,
    handshake: Record<string, unknown> = {},
  ): Promise<{
    params: Record<string, unknown>
    transport: FakeTransport
    handle: SessionHandle
  }> {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({ ...okThread('th_1'), ...handshake }))
    const sent: unknown[] = []
    transport.onRequest('turn/start', (params) => {
      sent.push(params)
      return turnStartResponse('tn_1')
    })
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
      ...options,
    })
    await handle.send('do the thing')
    return { params: sent[0] as Record<string, unknown>, transport, handle }
  }

  it('a planning session sends the exact shape the app-server accepts', async () => {
    // ⚠️ Every field here was measured, not inferred, and each of the first three was a rejection
    // before it was a test: `{mode}` alone → "missing field `settings`"; `settings:{}` → "missing
    // field `model`"; `settings.model: null` → "invalid type: null, expected a string". The probe
    // sent them against a bogus thread id, so params were deserialized and no turn ever ran.
    const { params, handle } = await turnParams({ planMode: true }, { model: 'gpt-5.1-codex' })
    expect(params['collaborationMode']).toEqual({
      mode: 'plan',
      settings: {
        // The SERVER's model, echoed back. Plan mode's settings take precedence over
        // `TurnStartParams.model`, so anything else here would move the session onto another model
        // as a side effect of asking it to plan.
        model: 'gpt-5.1-codex',
        reasoning_effort: null,
        // null means "use the built-in instructions for the selected mode" — measured: the server
        // filled it with 9,156 characters of its own plan-mode prompt. Putting anything of ours
        // there would REPLACE that and turn plan mode off while the setting still said `plan`.
        developer_instructions: null,
      },
    })
    await handle.close()
  })

  it('an ordinary session sends NO collaborationMode at all', async () => {
    // Not `{mode:'default'}`. Sending a mode at all overrides the thread's model, effort AND
    // developer instructions — including the `developerInstructions` a systemHint put there at
    // `thread/start` — so the quiet path has to stay quiet.
    for (const options of [{}, { planMode: false }]) {
      const { params, handle } = await turnParams(options)
      expect(params).not.toHaveProperty('collaborationMode')
      await handle.close()
    }
  })

  it('the effort the session chose survives being asked to plan', async () => {
    // `collaborationMode` takes precedence over `effort`, so leaving `reasoning_effort` null while
    // the turn also carries `effort:'high'` would let the mode's own preset (`medium`, per
    // `collaborationMode/list`) quietly win. Echoing our own value back makes the override a no-op —
    // the same reasoning the sandbox re-pin uses.
    const { params, handle } = await turnParams({ planMode: true, reasoningEffort: 'high' })
    expect(params['effort']).toBe('high')
    expect(params['collaborationMode']).toMatchObject({
      settings: { reasoning_effort: 'high' },
    })
    await handle.close()
  })

  it('…and so does an effort only the SERVER knows about', async () => {
    // Nobody asked, but `config.toml` did: the handshake reports it (082) and that report is what
    // goes back into the mode's settings. Without this, a planning turn silently demotes a session
    // the user configured elsewhere.
    const { params, handle } = await turnParams({ planMode: true }, { reasoningEffort: 'ultra' })
    expect(params).not.toHaveProperty('effort') // we still asked for nothing
    expect(params['collaborationMode']).toMatchObject({ settings: { reasoning_effort: 'ultra' } })
    await handle.close()
  })

  it('a RESUMED planning session is still planning', async () => {
    // The thread's `collaborationMode` is sticky server-side, so a resume that dropped the flag
    // would leave the thread planning while the session believed it was not — invisible AND still
    // in force. Re-sending it every turn is what keeps the two in agreement.
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => okThread('th_1'))
    const sent: unknown[] = []
    transport.onRequest('turn/start', (params) => {
      sent.push(params)
      return turnStartResponse('tn_1')
    })
    const handle = await new CodexRuntime(adopt(transport)).resume(
      { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home', planMode: true },
    )
    await handle.send('carry on')
    expect((sent[0] as Record<string, unknown>)['collaborationMode']).toMatchObject({
      mode: 'plan',
    })
    await handle.close()
  })

  it('a plan-mode session with no reported model REFUSES the turn rather than dropping the setting', async () => {
    // The failure this guards is the one the dispatch calls the worst outcome: a toggle that
    // silently does nothing. `settings.model` is a required non-null string, so a session that
    // cannot fill it has to choose between failing loudly and running un-planned while the UI still
    // shows the tick. `ThreadStartResponse.model` is required and validated, so this is a guard
    // against a future that stops reporting it — never a state seen on the wire.
    const transport = new FakeTransport()
    const handshake = okThread('th_1')
    delete handshake['model']
    transport.onRequest('thread/start', () => handshake)
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
      planMode: true,
    })
    await expect(handle.send('plan this')).rejects.toThrow(/plan-mode turn/)
    expect(transport.requests.some((r) => r.method === 'turn/start')).toBe(false)
    // ⚠️ …and the REFUSAL does not brick the session (057 review). The first version of this guard
    // sat just after `beginTurn()`, which marks a turn live and emits `working` — so the throw left
    // an open turn nothing was driving, the session sat at `working` forever, and every later send
    // failed with "a turn is in progress". The assertion below is the one that catches that: the
    // second attempt must fail the SAME way as the first, not with a turn-in-progress complaint.
    expect(handle.status()).not.toBe('working')
    await expect(handle.send('plan this')).rejects.toThrow(/plan-mode turn/)
    await handle.close()
  })

  it('the plan document RESTATES the running checklist instead of emptying it (057 review)', async () => {
    // `plan_update` means "here is the complete list" (028), so the document event's `steps: []`
    // would erase an open checklist. The normalizer is pure and cannot see one plan while producing
    // the other, so the handle restates it — the same thing `todoPlan.document()` does on the Claude
    // side. The two plans are not expected to meet on this provider (the server forbids the
    // checklist tool while planning), which is a reason to expect this never to fire, not a reason
    // to leave the erase possible.
    const { transport, handle, events, consumer } = await startCodex()
    await handle.send('go')
    transport.notification('turn/plan/updated', {
      threadId: 'th_1',
      turnId: 'tn_1',
      explanation: null,
      plan: [
        { step: 'read hello.js', status: 'completed' },
        { step: 'write the flag', status: 'inProgress' },
      ],
    })
    await vi.waitFor(() => expect(events.some((e) => e.type === 'plan_update')).toBe(true))
    transport.notification('item/completed', {
      threadId: 'th_1',
      turnId: 'tn_1',
      item: { type: 'plan', id: 'p1', text: '# Plan\n\nDo the thing.' },
    })
    await vi.waitFor(() => expect(events.filter((e) => e.type === 'plan_update')).toHaveLength(2))
    const document = events.filter((e) => e.type === 'plan_update').at(-1)
    expect(document).toMatchObject({
      body: '# Plan\n\nDo the thing.',
      steps: [
        { text: 'read hello.js', status: 'done' },
        { text: 'write the flag', status: 'active' },
      ],
    })
    await handle.close()
    await consumer
  })

  it('an EMPTY checklist notification does not wipe what the document would restate (064)', async () => {
    // ⚠️ Found by 067's review, carried into 064. `turn/plan/updated` with an empty `plan` array
    // normalises to `plan_update{steps: []}` with no body and no note — an event that says NOTHING.
    // The renderer already reads it that way (*"an empty checklist appearing out of nowhere claims a
    // plan exists and shows none"*), while `restatePlan` read it as "the checklist is now empty" and
    // wiped its memory. The plan DOCUMENT that followed then went out with `steps: []` at a consumer
    // whose contract is to REPLACE on it — erasing a checklist the reader could still see.
    const { transport, handle, events, consumer } = await startCodex()
    await handle.send('go')
    transport.notification('turn/plan/updated', {
      threadId: 'th_1',
      turnId: 'tn_1',
      explanation: null,
      plan: [{ step: 'read hello.js', status: 'inProgress' }],
    })
    await vi.waitFor(() => expect(events.some((e) => e.type === 'plan_update')).toBe(true))

    // The event that says nothing.
    transport.notification('turn/plan/updated', {
      threadId: 'th_1',
      turnId: 'tn_1',
      explanation: null,
      plan: [],
    })
    await vi.waitFor(() => expect(events.filter((e) => e.type === 'plan_update')).toHaveLength(2))

    transport.notification('item/completed', {
      threadId: 'th_1',
      turnId: 'tn_1',
      item: { type: 'plan', id: 'p1', text: '# Plan\n\nDo the thing.' },
    })
    await vi.waitFor(() => expect(events.filter((e) => e.type === 'plan_update')).toHaveLength(3))

    expect(events.filter((e) => e.type === 'plan_update').at(-1)).toMatchObject({
      body: '# Plan\n\nDo the thing.',
      steps: [{ text: 'read hello.js', status: 'active' }],
    })
    await handle.close()
    await consumer
  })

  it('an UNATTENDED planning session still runs unattended — no new consent surface (057, per 056)', async () => {
    // ⚠️ 056's hazard, checked on the other provider: it added a tool name to a set that is consulted
    // ABOVE the auto-approve early return, and nearly shipped a yolo session that stops until a human
    // comes back. Plan mode here goes on `turn/start` and touches no approval path at all — so this
    // asserts what that buys: yolo keeps its profile, the plan rides along with it, and nothing is
    // raised for anyone to answer.
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({
      ...okThread('th_1'),
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandbox: { type: 'dangerFullAccess' },
    }))
    const sent: unknown[] = []
    transport.onRequest('turn/start', (params) => {
      sent.push(params)
      return turnStartResponse('tn_1')
    })
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
      approvalMode: 'auto',
      planMode: true,
    })
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    await handle.send('plan and go')
    const params = sent[0] as Record<string, unknown>
    expect(params['approvalPolicy'], 'yolo is not softened by planning').toBe('never')
    expect(params['sandboxPolicy']).toEqual({ type: 'dangerFullAccess' })
    expect(params['collaborationMode']).toMatchObject({ mode: 'plan' })
    // The plan document arrives, and asks nothing of anybody. Scoped the way a conformant
    // app-server scopes it (060/061): an unscoped notification is dropped, and working around that
    // here would be testing a wire nobody sends.
    transport.notification('item/completed', {
      threadId: 'th_1',
      turnId: 'tn_1',
      item: { type: 'plan', id: 'p1', text: '# Plan\n\nDo the thing.' },
    })
    await vi.waitFor(() => expect(events.some((e) => e.type === 'plan_update')).toBe(true))
    expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(0)
    expect(events.filter((e) => e.type === 'permission_request')).toHaveLength(0)
    await handle.close()
    await consumer
  })
})

describe('the go-ahead that ends Codex plan mode (060)', () => {
  /**
   * A planning session plus every `turn/start` it sends, so a mode change is visible turn by turn.
   *
   * `turn(text)` sends AND terminalizes, because one live turn per session is a `SessionMachine`
   * invariant (008) and this suite's whole subject is what the SECOND turn carries.
   */
  async function planning(options: Record<string, unknown> = {}) {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({ ...okThread('th_1'), model: 'gpt-5.6-sol' }))
    const sent: Record<string, unknown>[] = []
    transport.onRequest('turn/start', (params) => {
      sent.push(params as Record<string, unknown>)
      return turnStartResponse(`tn_${sent.length}`)
    })
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
      planMode: true,
      ...options,
    })
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    async function turn(text: string): Promise<void> {
      const n = sent.length + 1
      await handle.send(text)
      transport.notification(
        'turn/completed',
        turnCompletedNotification('th_1', completedTurn(`tn_${n}`)),
      )
      await vi.waitFor(() => expect(handle.status()).toBe('idle'))
    }
    return { transport, handle, sent, events, consumer, turn }
  }

  it('⚠️ leaving without approving reaches the wire as the SAME transition (085)', async () => {
    // Plan-off and the go-ahead use the same wire transition. Assert that through the bytes
    // so the person can enter and leave planning mode without a second transition vocabulary.
    //
    // The app-level difference between approving and leaving is whether a message rides along.
    // Below, NOTHING is sent after `setPlanMode(false)` except the user's own next words, and the
    // turn that carries them is byte-identical in `collaborationMode` to the one the go-ahead
    // produces. If these two ever diverge, "leaving" has quietly become a second transition.
    const { handle, sent, consumer, turn } = await planning()
    await turn('plan it')
    expect(
      (sent[0]?.['collaborationMode'] as { mode: string }).mode,
      'positive: it really was planning',
    ).toBe('plan')

    await handle.setPlanMode(false)
    expect(handle.planNeedsGoAhead, 'the bar goes on the REQUEST, not on the next turn').toBe(false)
    // The user's own prompt — no approval text, nothing this app composed on their behalf.
    await turn('actually, what does the config file look like?')

    const second = sent[1] as Record<string, unknown>
    expect((second['collaborationMode'] as { mode: string }).mode).toBe('default')
    expect(second['input'] ?? second['text'] ?? JSON.stringify(second)).not.toContain('Go ahead')

    await handle.close()
    await consumer
  })

  it('a planning turn carries the INTENDED effort and model, not the last reported ones (076)', async () => {
    // ⚠️ **The trap this closes is silent by construction, and only on planning sessions.**
    // `collaborationMode` is documented to take precedence over `model` and `reasoning_effort` on
    // the same request. Until 076 this adapter filled it with what the SERVER last reported —
    // correct while nothing could change them mid-conversation, and a silent no-op the moment
    // `setReasoningEffort` existed: the user's new effort would go out in `effort` and be
    // overridden, on the same message, by the old one.
    //
    // So the failure mode was never an error. It was the effort control doing nothing at all, on
    // exactly the conversations whose settings someone is watching.
    const { handle, sent, consumer, turn } = await planning()
    await turn('plan it')
    expect((sent[0]?.['collaborationMode'] as { settings: { model: string } }).settings.model).toBe(
      'gpt-5.6-sol',
    )

    await handle.setReasoningEffort('high')
    await handle.setModel('gpt-5.6-terra')
    await turn('plan it differently')
    const second = sent[1] as Record<string, unknown>
    const mode = second['collaborationMode'] as {
      settings: { model: string; reasoning_effort: string | null }
    }
    expect(second['effort'], 'the turn asks for it').toBe('high')
    expect(mode.settings.reasoning_effort, 'and the field that OVERRIDES it agrees').toBe('high')
    expect(second['model']).toBe('gpt-5.6-terra')
    expect(mode.settings.model).toBe('gpt-5.6-terra')

    await handle.close()
    await consumer
  })

  it('a session that never planned stays quiet until asked, then asserts a mode (076)', async () => {
    // `never → planning` is the direction 057/060 never had, and the quiet path matters: a session
    // that never planned sends NO `collaborationMode` at all, because sending one replaces the
    // thread's developer instructions.
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({ ...okThread('th_1'), model: 'gpt-5.6-sol' }))
    const sent: Record<string, unknown>[] = []
    transport.onRequest('turn/start', (params) => {
      sent.push(params as Record<string, unknown>)
      return turnStartResponse(`tn_${sent.length}`)
    })
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
    })
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    const runTurn = async (text: string): Promise<void> => {
      const n = sent.length + 1
      await handle.send(text)
      transport.notification(
        'turn/completed',
        turnCompletedNotification('th_1', completedTurn(`tn_${n}`)),
      )
      await vi.waitFor(() => expect(handle.status()).toBe('idle'))
    }

    await runTurn('one')
    expect(sent[0]?.['collaborationMode'], 'the quiet path stays quiet').toBeUndefined()
    expect(handle.settings.planMode).toEqual({ effective: false, requested: false })

    await handle.setPlanMode(true)
    expect(handle.settings.planMode, 'queued like every other setting').toEqual({
      effective: false,
      requested: true,
    })
    await runTurn('now plan')
    expect((sent[1]?.['collaborationMode'] as { mode: string }).mode).toBe('plan')
    expect(handle.planNeedsGoAhead).toBe(true)

    // ⚠️ `never → left` must NOT be reachable, which is why this is asserted on a session that HAS
    // planned rather than assumed from the type. `left` means "keep asserting {mode:'default'}", and
    // asserting a mode on a thread that never planned would replace its developer instructions — so
    // a tolerant no-op there is a data-loss bug wearing a shrug.
    await handle.setPlanMode(false)
    await runTurn('go on')
    expect((sent[2]?.['collaborationMode'] as { mode: string }).mode).toBe('default')

    await handle.close()
    await consumer
  })

  it('sends the model on turn/start, which is how a change reaches a running conversation (076)', async () => {
    // Before 076 the model was sent once, at `thread/start` — which is exactly why changing it meant
    // starting a new conversation. `TurnStartParams.model` is documented as an override "for this
    // turn and subsequent turns", the same mechanism the approval profile and the effort ride.
    const { handle, sent, consumer, turn } = await planning({ planMode: false })
    await turn('one')
    expect(sent[0]?.['model'], 'nobody asked, so nothing is claimed').toBeUndefined()
    expect(sent[0]?.['effort'], 'and the same for the effort').toBeUndefined()

    await handle.setModel('gpt-5.6-terra')
    // ⚠️ `ultra` is the point of this line: it is Codex's own level, it is NOT in Claude's union,
    // and 024's neutral `'low'|'medium'|'high'` is the only reason it was unreachable. The adapter
    // deliberately does not second-guess it — the server owns that vocabulary and answers
    // `supportedReasoningEfforts` per model.
    await handle.setReasoningEffort('ultra')
    await turn('two')
    expect(sent[1]?.['model']).toBe('gpt-5.6-terra')
    expect(sent[1]?.['effort']).toBe('ultra')

    await handle.close()
    await consumer
  })

  it('the go-ahead switches the NEXT turn to {mode:"default"} — the measured ending', async () => {
    // ⚠️ This is the whole task, and it is measured rather than reasoned. The server's plan-mode
    // instructions say it stays in plan mode "until a developer message explicitly ends it", and no
    // client can write a developer-role message (`UserInput` has no such variant). 060 ran two
    // threads against the bundled 0.146.0 binary, same prompt, same sandbox, `approvalPolicy:
    // 'never'`: the turn that sent no `collaborationMode` produced ANOTHER PLAN and wrote nothing;
    // the turn that switched to `default` ran a command and wrote the file. The switch is the
    // ending. Nothing of ours is put in the conversation's mouth to achieve it.
    const { handle, sent, turn, consumer } = await planning()
    await turn('plan it')
    expect(sent[0]?.['collaborationMode']).toMatchObject({ mode: 'plan' })
    expect(handle.planNeedsGoAhead).toBe(true)

    await handle.setPlanMode(false)
    expect(handle.planNeedsGoAhead).toBe(false)

    await turn('Go ahead with this plan.')
    expect(sent[1]?.['collaborationMode']).toEqual({
      mode: 'default',
      // The same echoed settings as the plan turn: the server's own model back at it, so the
      // documented precedence over model/effort/instructions changes nothing but the mode.
      settings: { model: 'gpt-5.6-sol', reasoning_effort: null, developer_instructions: null },
    })
    await handle.close()
    await consumer
  })

  it('and KEEPS asserting it on every turn after — the sticky-mode trap in the other direction', async () => {
    // The thread's `collaborationMode` is sticky server-side. If the released session went quiet
    // after one `default`, a `turn/start` that never landed would leave the thread planning while
    // the session believed it had stopped — and nothing would ever say otherwise again. Re-asserting
    // is what makes the next turn correct whatever happened to the last one.
    const { handle, sent, turn, consumer } = await planning()
    await handle.setPlanMode(false)
    await turn('one')
    await turn('two')
    await turn('three')
    expect(sent.map((p) => (p['collaborationMode'] as { mode: string }).mode)).toEqual([
      'default',
      'default',
      'default',
    ])
    await handle.close()
    await consumer
  })

  it('a RESUMED session that was released comes back released (acceptance 3, across a restart)', async () => {
    // The durable half. Resumed as a plain "not planning" session, the adapter would send no mode at
    // all — and the thread's sticky value is whatever the last landed turn set, so a conversation the
    // user had released could quietly go back to proposing after a restart, with the bar gone.
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => ({ ...okThread('th_1'), model: 'gpt-5.6-sol' }))
    const sent: Record<string, unknown>[] = []
    transport.onRequest('turn/start', (params) => {
      sent.push(params as Record<string, unknown>)
      return turnStartResponse('tn_1')
    })
    const handle = await new CodexRuntime(adopt(transport)).resume(
      { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home', planMode: true, planModeEnded: true },
    )
    expect(handle.planNeedsGoAhead, 'a released plan is not waiting on anyone').toBe(false)
    await handle.send('carry on')
    expect(sent[0]?.['collaborationMode']).toMatchObject({ mode: 'default' })
    await handle.close()
  })

  it('⚠️ but `planModeEnded` WITHOUT `planMode` sends nothing — the systemHint it would wipe', async () => {
    // The pair is read as a pair on purpose. Asserting `{mode:'default'}` on a thread that never
    // planned is not harmless: a collaboration mode takes precedence over developer instructions,
    // and `developer_instructions: null` means "use the built-in ones for this mode" — so it would
    // REPLACE the workspace instructions a `systemHint` put there (057 §6.3, 006's files). A stray
    // or malformed flag must therefore mean nothing at all rather than something quiet and wrong.
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => ({ ...okThread('th_1'), model: 'gpt-5.6-sol' }))
    const sent: Record<string, unknown>[] = []
    transport.onRequest('turn/start', (params) => {
      sent.push(params as Record<string, unknown>)
      return turnStartResponse('tn_1')
    })
    const handle = await new CodexRuntime(adopt(transport)).resume(
      { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home', planModeEnded: true },
    )
    await handle.send('hello')
    expect(sent[0]).not.toHaveProperty('collaborationMode')
    expect(handle.planNeedsGoAhead).toBe(false)
    await handle.close()
  })

  it('refuses a go-ahead nobody asked for, and refuses a second one', async () => {
    // A button whose backing call quietly succeeded without doing anything is the failure this
    // codebase keeps naming. The second refusal matters just as much: by then the plan really has
    // been approved, and a call that "worked" would suggest it had not.
    const quiet = new FakeTransport()
    quiet.onRequest('thread/start', () => ({ ...okThread('th_1'), model: 'gpt-5.6-sol' }))
    const ordinary = await new CodexRuntime(adopt(quiet)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
    })
    expect(ordinary.planNeedsGoAhead).toBe(false)
    await expect(ordinary.setPlanMode(false)).rejects.toThrow(/not planning/)
    await ordinary.close()

    const { handle, consumer } = await planning()
    await handle.setPlanMode(false)
    await expect(handle.setPlanMode(false)).rejects.toThrow(/already been given the go-ahead/)
    await handle.close()
    await consumer
  })

  it('refuses on a session that is over, BEFORE the flag moves (060 review)', async () => {
    // ⚠️ Ending plan mode writes no wire traffic, so on a closed session it would happily "succeed"
    // against something that can never send another turn. The host then persists `plan_ended_at`
    // and drops the bar, and the `send` meant to carry the switch fails — leaving a dead
    // conversation recorded as released. The second assertion is the one that matters: the refusal
    // left the state alone, so nothing downstream can act on a half-made change.
    const { handle, consumer } = await planning()
    await handle.close()
    await expect(handle.setPlanMode(false)).rejects.toThrow(/no longer active/)
    expect(handle.planNeedsGoAhead, 'a refused go-ahead must not have moved anything').toBe(true)
    await consumer
  })

  it('a released session with no reported model refuses the turn rather than dropping the switch', async () => {
    // ⚠️ The asymmetric half of 057's guard. Without the model the collaboration mode cannot be
    // built, and a `left` session that let the turn go anyway would send exactly the payload the
    // probe's CONTROL sent — no mode at all — which made the agent re-plan. So the failure of
    // dropping it here is not "the turn runs unplanned", it is "the go-ahead is silently withdrawn".
    const transport = new FakeTransport()
    const handshake = okThread('th_1')
    delete handshake['model']
    transport.onRequest('thread/start', () => handshake)
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
      planMode: true,
    })
    await handle.setPlanMode(false)
    await expect(handle.send('go ahead')).rejects.toThrow(/post-plan turn/)
    expect(transport.requests.some((r) => r.method === 'turn/start')).toBe(false)
    // …and it does not brick the session either (057 review's lesson, re-checked on the new branch).
    expect(handle.status()).not.toBe('working')
    await handle.close()
  })

  it('an UNATTENDED session still runs unattended AFTER the go-ahead (acceptance 4, per 056)', async () => {
    // ⚠️ 056's hazard, third dispatch running: a consent surface consulted ABOVE the auto-approve
    // early return silently stops a yolo run until a human comes back. 057 refused to add a card
    // partly for that reason; 060 adds the affordance anyway, so it owns the risk — and the way it
    // is discharged is that the go-ahead is NOT a consent surface. Nothing waits on it, so an
    // unattended session that never receives one runs to completion, and one that does keeps its
    // profile intact.
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({
      ...okThread('th_1'),
      model: 'gpt-5.6-sol',
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandbox: { type: 'dangerFullAccess' },
    }))
    const sent: Record<string, unknown>[] = []
    transport.onRequest('turn/start', (params) => {
      sent.push(params as Record<string, unknown>)
      return turnStartResponse(`tn_${sent.length}`)
    })
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
      approvalMode: 'auto',
      planMode: true,
    })
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)

    await handle.send('plan and go')
    transport.notification('item/completed', {
      threadId: 'th_1',
      turnId: 'tn_1',
      item: { type: 'plan', id: 'p1', text: '# Plan\n\nDo the thing.' },
    })
    await vi.waitFor(() => expect(events.some((e) => e.type === 'plan_update')).toBe(true))
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1')),
    )
    await vi.waitFor(() => expect(handle.status()).toBe('idle'))

    await handle.setPlanMode(false)
    await handle.send('Go ahead with this plan.')
    // Yolo survives the release, in both fields, on the very turn that carries the switch.
    expect(sent[1]?.['approvalPolicy'], 'yolo is not softened by the go-ahead').toBe('never')
    expect(sent[1]?.['sandboxPolicy']).toEqual({ type: 'dangerFullAccess' })
    expect(sent[1]?.['collaborationMode']).toMatchObject({ mode: 'default' })
    // And the strongest assertion is the negative one: nothing anywhere is waiting for a human.
    expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(0)
    expect(events.filter((e) => e.type === 'permission_request')).toHaveLength(0)
    await handle.close()
    await consumer
  })
})

describe('the model list, asked of the app-server rather than written down (058)', () => {
  /**
   * Probed against the bundled 0.146.0 binary before any of this was written: `model/list` answers
   * straight after `initialize`, with **no thread, no turn and no tokens**, and returned seven rows.
   * Three facts from that probe are what these tests hold the adapter to.
   */
  const row = (over: Record<string, unknown>): Record<string, unknown> => ({
    id: 'gpt-5.6-sol',
    model: 'gpt-5.6-sol',
    displayName: 'GPT-5.6-Sol',
    description: 'Latest frontier agentic coding model.',
    hidden: false,
    upgrade: null,
    upgradeInfo: null,
    isDefault: true,
    ...over,
  })

  /** A runtime whose transport answers `model/list` from a script of pages. */
  function listing(pages: { data: unknown[]; nextCursor: string | null }[]): {
    runtime: CodexRuntime
    transport: FakeTransport
  } {
    const transport = new FakeTransport()
    let page = 0
    transport.onRequest('model/list', () => pages[Math.min(page++, pages.length - 1)])
    return { runtime: new CodexRuntime(adopt(transport)), transport }
  }

  it("maps a row, and carries the provider's own upgrade note instead of dropping it", async () => {
    const { runtime, transport } = listing([
      {
        data: [
          row({}),
          // The measured deprecation row: `gpt-5.4` carries an `upgrade` to `gpt-5.6-terra` and a
          // sentence explaining it. 058's dispatch guessed this field meant "needs a plan you do
          // not have"; the probe said deprecation. Either way it must not be swallowed.
          // ⚑ D-042: it names itself as its `model`, as a row whose id is its own model does — so
          // it carries no `resolvesTo` (the A to the next row's B).
          row({
            id: 'gpt-5.4',
            model: 'gpt-5.4',
            displayName: 'GPT-5.4',
            description: 'Previous frontier model.',
            isDefault: false,
            upgrade: 'gpt-5.6-terra',
            upgradeInfo: {
              model: 'gpt-5.6-terra',
              upgradeCopy: null,
              modelLink: null,
              migrationMarkdown: 'GPT-5.4 will be deprecated soon\n\nSwitch to GPT-5.6 Terra.\n',
            },
          }),
          // `upgrade` with no `upgradeInfo` — the provider says there is a successor and nothing
          // more. The fallback states exactly that and does not embroider it.
          // ⚑ D-042: its `model` is the helper's `gpt-5.6-sol`, not its id — the shape whose id
          // points at another model, which the row now says as `resolvesTo`.
          row({ id: 'gpt-5.4-mini', displayName: '', isDefault: false, upgrade: 'gpt-5.6-luna' }),
        ],
        nextCursor: null,
      },
    ])

    const models = await runtime.listModels({ providerHome: '/tmp/x/home' })
    expect(models).toEqual([
      {
        id: 'gpt-5.6-sol',
        label: 'GPT-5.6-Sol',
        description: 'Latest frontier agentic coding model.',
        // ⚑ **D-042 · R1 — Codex's default, by name**: the row the server marks `isDefault`, kept
        // instead of dropped. Its `model` is its id, so no `resolvesTo`.
        isDefault: true,
      },
      {
        id: 'gpt-5.4',
        label: 'GPT-5.4',
        description: 'Previous frontier model.',
        note: 'GPT-5.4 will be deprecated soon\n\nSwitch to GPT-5.6 Terra.',
      },
      {
        id: 'gpt-5.4-mini',
        label: 'gpt-5.4-mini', // no displayName → the id, never a blank menu row
        description: 'Latest frontier agentic coding model.',
        note: 'Superseded by gpt-5.6-luna.',
        // ⚑ D-042: `Model.model` where it differs from the id. `isDefault: false` leaves no key.
        resolvesTo: 'gpt-5.6-sol',
      },
    ])
    // No thread, no turn — the probe is `initialize` + the list and nothing else, which is what
    // makes it free. A `thread/start` creeping in here would cost a conversation per app launch.
    expect(transport.requests.map((r) => r.method)).toEqual(['initialize', 'model/list'])
    expect(transport.closeCount, 'a probe may never leak an app-server').toBe(1)
  })

  it('never asks for HIDDEN rows, and drops one anyway if the server sends it', async () => {
    // ⚠️ The mechanism is the ABSENCE of a flag. `ModelListParams.includeHidden` is documented
    // "when true, include models that are hidden from the default picker list", and the probe
    // proved it: the plain call returned 7 rows, `includeHidden:true` returned 8, the extra one
    // being `codex-auto-review` — the only row with `hidden:true`. So respecting `hidden` means
    // not passing the flag, and this asserts the flag is absent rather than merely false.
    const { runtime, transport } = listing([
      { data: [row({}), row({ id: 'codex-auto-review', hidden: true })], nextCursor: null },
    ])
    const models = await runtime.listModels({ providerHome: '/tmp/x/home' })

    expect(models.map((m) => m.id)).toEqual(['gpt-5.6-sol'])
    const params = transport.requests.find((r) => r.method === 'model/list')?.params
    expect(params).not.toHaveProperty('includeHidden')
  })

  it('follows the cursor, because taking page one would ship a truncated catalogue', async () => {
    // `limit:3` came back with `nextCursor:"3"` on the real server. Today the unpaged call answers
    // everything at once, but that is a fact about a catalogue of seven, not a guarantee.
    const { runtime, transport } = listing([
      { data: [row({ id: 'a' })], nextCursor: 'c1' },
      { data: [row({ id: 'b' })], nextCursor: 'c2' },
      { data: [row({ id: 'c' })], nextCursor: null },
    ])
    const models = await runtime.listModels({ providerHome: '/tmp/x/home' })

    expect(models.map((m) => m.id)).toEqual(['a', 'b', 'c'])
    // The cursor is echoed back, and the FIRST call sends none — a cursor invented for page one
    // would ask the server to resume from a position nobody established.
    expect(
      transport.requests.filter((r) => r.method === 'model/list').map((r) => r.params),
    ).toEqual([{}, { cursor: 'c1' }, { cursor: 'c2' }])
  })

  it('stops on a cursor that never ends, rather than looping forever', async () => {
    // The loop is driven by a value the SERVER chooses. A server that returned a cursor pointing at
    // itself would otherwise spin until the app died, and this probe runs at launcher-open.
    const { runtime, transport } = listing([{ data: [row({})], nextCursor: 'always' }])
    const models = await runtime.listModels({ providerHome: '/tmp/x/home' })

    const calls = transport.requests.filter((r) => r.method === 'model/list').length
    expect(calls).toBe(20)
    expect(models).toHaveLength(20)
    expect(transport.closeCount).toBe(1)
  })

  it('gives up on an app-server that is alive but silent, and still reaps it', async () => {
    // ⚠️ The same defect the Claude probe had, found by 058's review. `transport.request` settles
    // when the child answers, when it EXITS, or when the transport is closed — so an app-server
    // that is running and simply not replying settles nothing. The `finally` holding `close()` was
    // then unreachable: the child outlived the app AND `listModels` never settled, which the host's
    // cache turned into a permanently pending promise for every later caller.
    const transport = new FakeTransport()
    transport.onRequest('model/list', () => new Promise(() => {})) // alive, and never answering
    const runtime = new CodexRuntime(adopt(transport))

    vi.useFakeTimers()
    try {
      const probing = runtime.listModels({ providerHome: '/tmp/x/home' })
      const settled = expect(probing).rejects.toThrow(/did not answer/)
      await vi.advanceTimersByTimeAsync(20_000)
      await settled
    } finally {
      vi.useRealTimers()
    }
    expect(transport.closeCount, 'the stalled app-server must still be reaped').toBe(1)
  })

  it('closes the app-server when the list FAILS, not only when it succeeds', async () => {
    const transport = new FakeTransport()
    transport.failRequest('model/list')
    const runtime = new CodexRuntime(adopt(transport))
    await expect(runtime.listModels({ providerHome: '/tmp/x/home' })).rejects.toThrow(/model\/list/)
    expect(transport.closeCount, 'a rejected probe still tears its child down').toBe(1)
  })

  it("reports NO wholesale grants, because Codex's live inside the app-server (058)", async () => {
    // Not a stub and not "nothing was granted": this adapter answers `acceptForSession` on the wire
    // and the SERVER remembers whatever that covers, so a non-empty list here could only be a guess
    // at provider-side state. `[]` is the honest report, and the gap it implies is written down.
    const { handle, consumer } = await startCodex()
    expect(handle.blanketGrants).toEqual([])
    await handle.close()
    await consumer
  })
})

/**
 * **Two open cards are one waiting session** (063, from 061 finding 7).
 *
 * Codex reaches this more easily than Claude does. The app-server is free to raise an exec approval
 * and a user question in the same turn, `RequestBroker` permits concurrent requests on purpose, and
 * each handler used to bracket its own await with `waiting_permission` → `working`. So answering
 * either one published `working` while the other was still on screen: the renderer showing a card,
 * the durable store clearing the blocked reason on that very event, and the stall watchdog re-armed
 * to count the user's own thinking time as provider silence.
 *
 * ⚠️ **Every assertion here reads the delivered EVENTS, not `handle.status()`.** The cached status
 * moves the moment the adapter emits; the event reaches a consumer a queue-hop later. A negative
 * assertion taken between the two would pass on a broken build, so the waits below are on the event
 * list itself and each negative one is preceded by a flush.
 */
describe('CodexRuntime — the combined wait lease (063)', () => {
  const statuses = (events: RuntimeEvent[], from: number): string[] =>
    events
      .slice(from)
      .filter((e) => e.type === 'status')
      .map((e) => e.state)

  /** Let every pending queue hop land, so "no `working` yet" means it, rather than "not yet". */
  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 20))

  const question = (turnId = 'tn_1') => ({
    threadId: 'th_1',
    turnId,
    itemId: 'it',
    questions: [{ id: 'q', question: 'pick', options: ['a', 'b'] }],
  })

  it('an approval and a question: answering the approval leaves the session waiting', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    const before = events.length

    transport.serverRequest(101, 'item/commandExecution/requestApproval', {
      command: 'rm x',
      cwd: '/tmp/x',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    transport.serverRequest(102, 'item/tool/requestUserInput', question())
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))

    // ONE `waiting_permission`. The second request changed the count and published nothing.
    expect(statuses(events, before)).toEqual(['waiting_permission'])

    await handle.respondPermission('number:101', { outcome: 'allow' })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 101)).toBe(true))
    await flush()
    // ⚠️ The finding, asserted: the question is unanswered, so the session is still waiting.
    expect(statuses(events, before), 'no `working` while a card is still open').toEqual([
      'waiting_permission',
    ])

    await handle.respondUserInput('number:102', { kind: 'answer', answers: { q: 'a' } })
    await vi.waitFor(() =>
      expect(statuses(events, before)).toEqual(['waiting_permission', 'working']),
    )

    await handle.close()
    await consumer
  })

  it('…and in the other order — answering the question first also leaves it waiting', async () => {
    // The count, not the kind and not the order. Fixing one arrangement and leaving the other is
    // exactly how a per-request bracket looked correct for as long as it did.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    const before = events.length

    transport.serverRequest(103, 'item/tool/requestUserInput', question())
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    transport.serverRequest(104, 'item/commandExecution/requestApproval', {
      command: 'echo two',
      cwd: '/tmp/x',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    expect(statuses(events, before)).toEqual(['waiting_permission'])

    await handle.respondUserInput('number:103', { kind: 'answer', answers: { q: 'b' } })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 103)).toBe(true))
    await flush()
    expect(statuses(events, before)).toEqual(['waiting_permission'])

    await handle.respondPermission('number:104', { outcome: 'deny' })
    await vi.waitFor(() =>
      expect(statuses(events, before)).toEqual(['waiting_permission', 'working']),
    )

    await handle.close()
    await consumer
  })

  it('one card behaves exactly as it always did — waiting, then working', async () => {
    // The regression guard for the fix itself: a lease that never published `working` at all would
    // satisfy every "no working yet" assertion above.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    const before = events.length

    transport.serverRequest(105, 'item/commandExecution/requestApproval', {
      command: 'echo solo',
      cwd: '/tmp/x',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    expect(statuses(events, before)).toEqual(['waiting_permission'])

    await handle.respondPermission('number:105', { outcome: 'allow' })
    await vi.waitFor(() =>
      expect(statuses(events, before)).toEqual(['waiting_permission', 'working']),
    )

    await handle.close()
    await consumer
  })

  it('closing under two open cards never claims the session went back to work', async () => {
    // `settleAll()` resolves both waits at once on teardown. Each takes the shutting-down exit,
    // which brings the count down WITHOUT publishing — a `working` on the way out would re-arm the
    // watchdog and rewrite the durable status of a session that is ending.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    const before = events.length

    transport.serverRequest(106, 'item/commandExecution/requestApproval', {
      command: 'echo one',
      cwd: '/tmp/x',
    })
    transport.serverRequest(107, 'item/tool/requestUserInput', question())
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))

    await handle.close()
    await consumer

    expect(statuses(events, before)[0]).toBe('waiting_permission')
    expect(statuses(events, before), 'nothing said the session went back to work').not.toContain(
      'working',
    )
    expect(statuses(events, before).at(-1)).toBe('ended')
    // Both provider requests still got a safe answer — the lease changed the status vocabulary, not
    // the fail-closed contract.
    expect(transport.responses.filter((r) => r.id === 106 || r.id === 107)).toHaveLength(2)
  })
})

describe('CodexRuntime — the image path is CHECKED, not believed (067)', () => {
  /**
   * The seam between a pure normalizer and a filesystem.
   *
   * `normalizeNotification` produces the provider's own `savedPath` string, unexamined, because it
   * has no home to examine it against. The adapter is where that string is replaced by a real path
   * or by nothing at all — and this is the test that the substitution actually happens on the way
   * out rather than being described in a comment.
   *
   * Real directories and a real file: the subject is what the filesystem says.
   */
  let home: string
  let images: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'brobot-067-rt-'))
    images = join(home, 'generated_images', 'th_1')
    mkdirSync(images, { recursive: true })
  })

  afterEach(() => rmSync(home, { recursive: true, force: true }))

  async function startIn(providerHome: string): Promise<{
    transport: FakeTransport
    handle: Awaited<ReturnType<CodexRuntime['start']>>
    events: RuntimeEvent[]
    consumer: Promise<void>
  }> {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1'))
    const runtime = new CodexRuntime(adopt(transport))
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome })
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    // A turn, because `item/completed` is turn-scoped and a notification outside the bound turn is
    // dropped before it ever reaches the normalizer — see TURN_SCOPED_METHODS.
    await handle.send('draw a fox')
    return { transport, handle, events, consumer }
  }

  const imageItem = (savedPath?: string): Record<string, unknown> => ({
    type: 'imageGeneration',
    id: 'exec-1',
    status: 'completed',
    revisedPrompt: 'a curled-up red fox',
    // The field that must never travel. Present in the notification, absent from every event.
    result: 'A'.repeat(200_000),
    ...(savedPath ? { savedPath } : {}),
  })

  it('substitutes the REAL path when the provider named a file inside its own home', async () => {
    const file = join(images, 'exec-1.png')
    writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const { transport, handle, events, consumer } = await startIn(home)
    transport.notification('item/completed', {
      threadId: 'th_1',
      turnId: 'tn_1',
      item: imageItem(file),
    })
    await vi.waitFor(has(events, (e) => e.type === 'image'))
    const image = firstOfType(events, 'image')
    expect(image.path).toContain('exec-1.png')
    expect(image.prompt).toBe('a curled-up red fox')
    // ⚠️ The 200 KB blob went nowhere. Asserted over EVERY event, not just the image one.
    expect(JSON.stringify(events)).not.toContain('AAAA')
    await handle.close()
    await consumer
  })

  it('finds the file by convention when the provider named no path at all', async () => {
    writeFileSync(join(images, 'exec-1.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const { transport, handle, events, consumer } = await startIn(home)
    transport.notification('item/completed', {
      threadId: 'th_1',
      turnId: 'tn_1',
      item: imageItem(),
    })
    await vi.waitFor(has(events, (e) => e.type === 'image'))
    expect(firstOfType(events, 'image').path).toContain('exec-1.png')
    await handle.close()
    await consumer
  })

  it('🔴 726 · R92 — KEEPS a real image the provider named outside its home', async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'brobot-067-out-'))
    try {
      const escape = join(elsewhere, 'exec-1.png')
      writeFileSync(escape, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      const { transport, handle, events, consumer } = await startIn(home)
      transport.notification('item/completed', {
        threadId: 'th_1',
        turnId: 'tn_1',
        item: imageItem(escape),
      })
      await vi.waitFor(has(events, (e) => e.type === 'image'))
      const image = firstOfType(events, 'image')
      // ⛔ **On `main` the path was dropped** — it had to be inside `<home>/generated_images`. Since
      // `726` (R92) a real image the provider names is shown wherever it is.
      expect(image.path).toBe(realpathSync.native(escape))
      expect(image.imageId).toBe('exec-1')
      await handle.close()
      await consumer
    } finally {
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })

  it('emits an image with no path when the file simply is not there', async () => {
    const { transport, handle, events, consumer } = await startIn(home)
    transport.notification('item/completed', {
      threadId: 'th_1',
      turnId: 'tn_1',
      item: imageItem(join(images, 'exec-1.png')),
    })
    await vi.waitFor(has(events, (e) => e.type === 'image'))
    expect(firstOfType(events, 'image').path).toBeUndefined()
    await handle.close()
    await consumer
  })
})

/**
 * **What Codex says it read, retained at last** (158).
 *
 * ⚑ `instructionSources` has been on the wire since before this app existed — `ThreadStartResponse`,
 * `ThreadResumeResponse` and `ThreadForkResponse` all declare it, and the fixture above has carried
 * the field the whole time. 156 §4 went looking for a runtime consumer and found none: *"production
 * searches find only generated protocol types and fixtures."*
 *
 * Display an agent’s instructions in the UI. Codex reads its own files, so surface the list
 * the provider reports as the provider’s list rather than injecting text.
 */
describe('the instruction files Codex reports (158)', () => {
  const sources = ['/homes/codex/AGENTS.md', '/work/AGENTS.md', '/work/repo/AGENTS.md']

  it('⛔ start: the reported sources are retained, in the provider’s own order', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({
      ...threadStartResponse('th_1'),
      instructionSources: sources,
    }))
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
    })

    // Order is meaning: global first, then project root-to-cwd, which is the composition order.
    expect(handle.instructionSources).toEqual(sources)
    await handle.close()
  })

  it('⛔ resume: a fresh read REPLACES the old list, never merges with it', async () => {
    // A cold resume re-reads (156), so a file the resumed thread no longer loads must disappear
    // from the list rather than linger because it was true once.
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => ({
      ...threadStartResponse('th_1'),
      instructionSources: ['/homes/codex/AGENTS.md'],
    }))
    const handle = await new CodexRuntime(adopt(transport)).resume(
      { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home' },
    )

    expect(handle.instructionSources).toEqual(['/homes/codex/AGENTS.md'])
    await handle.close()
  })

  it('⚠️ an EMPTY list reads as nothing reported — not as an empty section', async () => {
    // The fixture's default. "Reported none" and "reported nothing" are the same to a reader, and
    // a heading over an empty list is the absence 086 rules out in the other direction.
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1'))
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
    })

    expect(handle.instructionSources).toBeUndefined()
    await handle.close()
  })

  it('🔒 non-string entries are dropped — wire data reaching a surface is filtered', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({
      ...threadStartResponse('th_1'),
      instructionSources: ['/work/AGENTS.md', 42, null, { path: '/evil' }, ''],
    }))
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
    })

    expect(handle.instructionSources).toEqual(['/work/AGENTS.md'])
    await handle.close()
  })
})

/**
 * ⛔ **200 · scope by what the frame carries, not by its name.**
 *
 * 192 filed two HIGHs about the Codex scope predicate; an adversarial re-read downgraded both to
 * `PARTLY_CONFIRMED`/`MEDIUM` and found they share ONE root cause — thread scope was decided by
 * method-name MEMBERSHIP (`TURN_SCOPED_METHODS`), so everything outside those nine names got no
 * correlation at all, including methods whose generated type declares `threadId` REQUIRED. That set
 * had been widened reactively in 027, 028 and 184, and this is the dispatch that stopped widening it.
 *
 * ⚠️ **These assertions are the coverage that was missing, not decoration.** Before them, the only
 * end-to-end evidence that a foreign thread was refused anywhere was ONE test about
 * `serverRequest/resolved` — and, in the other direction, **nothing in this repo drove
 * `thread/status/changed` through a handle at all**. `codex-sub-agents.test.ts` feeds the tracker
 * directly, so implementing this dispatch's §1a as written — drop every frame naming another thread
 * — would have deleted every sub-agent ending in the app with the whole suite still green. That is
 * 193's vacuity subject on a live boundary, and the exemption below is why it did not happen.
 */
describe('CodexSessionHandle — thread scope, by what the frame carries (200)', () => {
  /** Somebody else's conversation, on our connection. */
  const OTHER = 'th_SOMEBODY_ELSE'
  /**
   * The prompting profile a conformant `thread/settings/updated` echoes — anything else fails closed.
   * ⚑ 736 · R96 — its sandbox is `workspaceWrite` (was `readOnly`).
   */
  const PROMPTING = {
    approvalsReviewer: 'user',
    approvalPolicy: 'on-request',
    sandboxPolicy: { type: 'workspaceWrite' },
  }
  /** A one-file git diff, in the format `parseUnifiedDiff` reads. */
  const diffOf = (path: string, line: string): string =>
    [
      `diff --git a/${path} b/${path}`,
      'index 0000000..1111111 100644',
      `--- a/${path}`,
      `+++ b/${path}`,
      '@@ -0,0 +1 @@',
      `+${line}`,
    ].join('\n')

  const scope = (handle: unknown): { seen: number; dropped: number } =>
    (handle as CodexSessionHandle).frameScope

  /**
   * A barrier, not a sleep. The transport is ordered and `onNotification` is synchronous, so once a
   * marker sent AFTER the frames under test has been observed, those frames have been processed and
   * "nothing arrived" is a fact rather than a race. ⚠️ The marker carries no ids, so the gate cannot
   * drop it — a barrier the fix could silence would assert nothing.
   */
  async function barrier(
    transport: FakeTransport,
    events: RuntimeEvent[],
    tag: string,
  ): Promise<void> {
    transport.notification(`marker/${tag}`, {})
    await vi.waitFor(has(events, (e) => e.type === 'unknown' && e.label === `marker/${tag}`))
  }

  it('⛔ a frame naming a FOREIGN thread is dropped — for all four methods 192 named', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    const turnId = transport.lastTurnId
    // Four methods, four different consequences, none of them this conversation's business. The
    // settings one carries a NON-prompting profile, which is the serious half of 192 H3: reaching
    // `checkSettingsProfile` it becomes `finishUnexpected` + `transport.close()`, so a foreign
    // thread could KILL this session.
    transport.notification('error', {
      threadId: OTHER,
      turnId,
      error: { message: 'somebody else exploded', codexErrorInfo: 'unauthorized' },
    })
    transport.notification('turn/diff/updated', {
      threadId: OTHER,
      turnId,
      diff: diffOf('their/secret.ts', 'not ours'),
    })
    transport.notification('thread/settings/updated', {
      threadId: OTHER,
      threadSettings: { ...PROMPTING, approvalPolicy: 'never', model: 'foreign-model' },
    })
    transport.notification('model/rerouted', {
      threadId: OTHER,
      turnId,
      fromModel: 'gpt-5',
      toModel: 'foreign-model',
      reason: 'highRiskCyberActivity',
    })
    await barrier(transport, events, 'foreign')

    expect(events.filter((e) => e.type === 'error')).toEqual([])
    expect(events.filter((e) => e.type === 'file_change')).toEqual([])
    expect((handle as CodexSessionHandle).agentInfo?.model).not.toBe('foreign-model')
    // ⛔ The one that bites: the session is still alive and the transport was never torn down.
    // ⚠️ **Both terminal states, not just `ended`** — `finishUnexpected` terminalizes as `errored`,
    // so a check for `ended` alone would have let a killed session through. The mutation aimed at
    // this line found that out (200 M4, second occupant).
    expect(['ended', 'errored']).not.toContain(handle.status())
    expect(transport.closeCount).toBe(0)
    expect(scope(handle).dropped).toBe(4)

    await handle.close()
    await consumer
  })

  it('⚠️ …and the SAME four naming THIS thread all arrive — the paired positive', async () => {
    // Without this, the drop above is equally satisfied by an adapter that handles none of them.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    const turnId = transport.lastTurnId
    transport.notification('error', {
      threadId: 'th_1',
      turnId,
      error: { message: 'ours exploded' },
    })
    transport.notification('turn/diff/updated', {
      threadId: 'th_1',
      turnId,
      diff: diffOf('ours.ts', 'ours'),
    })
    transport.notification('thread/settings/updated', {
      threadId: 'th_1',
      threadSettings: { ...PROMPTING, model: 'ours-model' },
    })
    transport.notification('model/rerouted', {
      threadId: 'th_1',
      turnId,
      fromModel: 'gpt-5',
      toModel: 'rerouted-model',
      reason: 'highRiskCyberActivity',
    })
    await barrier(transport, events, 'ours')

    const messages = events.flatMap((e) => (e.type === 'error' ? [e.message] : []))
    expect(messages.some((m) => m.includes('ours exploded'))).toBe(true)
    expect(messages.some((m) => m.includes('rerouted-model'))).toBe(true)
    expect(firstOfType(events, 'file_change').changes.map((c) => c.path)).toEqual(['ours.ts'])
    // `thread/settings/updated` reports the live model, and the reroute overwrites it afterwards —
    // both reached `mergeAgentInfo`, which is what this asserts.
    expect((handle as CodexSessionHandle).agentInfo?.model).toBe('rerouted-model')
    expect(scope(handle).dropped).toBe(0)

    await handle.close()
    await consumer
  })

  it('⛔ the sub-agent ending SURVIVES the gate — the frame whose threadId is its subject', async () => {
    // ⚠️ **This is the correction 200 made to its own brief, and the test that would have caught
    // implementing it verbatim.** `ThreadStatusChangedNotification` declares `threadId` non-nullable
    // and the id it carries is the CHILD's — it is what ends a sub-agent card (033), and before 226
    // it was also the only evidence a grandchild existed (135). A universal "drop every foreign
    // thread" would have dropped every one of them, and no existing test drives this method through
    // a handle. ⚠️ **226 measured a second frame that does the same job** — the child's own
    // `turn/completed`, which says HOW it ended; see the block at the foot of this file.
    const ALPHA = 'th_alpha_child'
    const GRANDCHILD = 'th_grandchild'
    const { transport, handle, events, consumer } = await startCodexInTurn()
    const turnId = transport.lastTurnId
    const birth = {
      item: {
        type: 'subAgentActivity',
        id: 'call_alpha',
        kind: 'started',
        agentThreadId: ALPHA,
        agentPath: 'alpha',
      },
      threadId: 'th_1',
      turnId,
    }
    // Verbatim capture order: the empty child reports `idle` BEFORE it is announced.
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'idle' } })
    transport.notification('item/started', birth)
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'active' } })
    // 135's grandchild: announced to nobody on this connection, and known only by going active.
    transport.notification('thread/status/changed', {
      threadId: GRANDCHILD,
      status: { type: 'active' },
    })
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'idle' } })
    await barrier(transport, events, 'children')

    const cards = events.flatMap((e) => (e.type === 'sub_agent' ? [`${e.agentId}:${e.phase}`] : []))
    expect(cards).toEqual([
      `${ALPHA}:started`,
      `${ALPHA}:progress`,
      `${GRANDCHILD}:started`,
      `${ALPHA}:ended`,
    ])
    // ⚑ Nothing was dropped: every one of those frames named a thread that is not ours.
    expect(scope(handle).dropped).toBe(0)

    await handle.close()
    await consumer
  })

  it('⛔ an OUT-OF-TURN credential error is still delivered — the assertion that stops the next widening', async () => {
    // 192 asked for `error` to join the turn-scoped set. ⛔ Refused, and this is why:
    // `isCurrentProviderTurn` is false whenever there is no live turn, so a gated `error` arriving
    // between turns is silently dropped — including the one that says the credential was rejected
    // and the session can never run. There is no turn open here at all.
    const { transport, handle, events, consumer } = await startCodex()
    expect(handle.status()).not.toBe('working')
    transport.notification('error', {
      threadId: 'th_1',
      turnId: 'tn_none',
      error: { message: 'Unauthorized: your sign-in has expired', codexErrorInfo: 'unauthorized' },
    })
    await vi.waitFor(has(events, (e) => e.type === 'error' && e.cause === 'auth'))
    expect(firstOfType(events, 'error').message).toContain('sign-in has expired')

    await handle.close()
    await consumer
  })

  it('⛔ a STALE `turn/diff/updated` cannot overwrite the running turn — and the live one still wins', async () => {
    // Each payload is a FULL SNAPSHOT and `foldChanges` is later-record-wins by path, so a late
    // frame from a finished turn does not add a stale row — it REPLACES the running turn's.
    const { transport, handle, events, consumer } = await startCodex()
    await handle.send('one')
    transport.notification('turn/diff/updated', {
      threadId: 'th_1',
      turnId: 'tn_1',
      diff: diffOf('one.ts', 'from turn one'),
    })
    await vi.waitFor(has(events, (e) => e.type === 'file_change'))
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1')),
    )
    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.state === 'completed'))

    await handle.send('two')
    // The stale frame: turn one's id, turn one's snapshot, arriving while turn two runs.
    transport.notification('turn/diff/updated', {
      threadId: 'th_1',
      turnId: 'tn_1',
      diff: diffOf('one.ts', 'from turn one, restated late'),
    })
    await barrier(transport, events, 'stale-diff')
    expect(events.filter((e) => e.type === 'file_change')).toHaveLength(1)

    // ⚠️ The paired positive on the same path: turn TWO's own later snapshot still arrives.
    transport.notification('turn/diff/updated', {
      threadId: 'th_1',
      turnId: 'tn_2',
      diff: diffOf('two.ts', 'from turn two'),
    })
    await vi.waitFor(
      has(events, (e) => e.type === 'file_change' && e.changes[0]?.path === 'two.ts'),
    )

    await handle.close()
    await consumer
  })

  it('⛔ `account/rateLimits/updated` still arrives — its type carries NO ids at all', async () => {
    // ⚑ The refusal of "just gate every first-class method". `AccountRateLimitsUpdatedNotification`
    // is `{ rateLimits }` and nothing else, by design: it describes the ACCOUNT, not a thread. It
    // passes on the absence rule, and it must — it is the only warning before the weekly wall (177).
    const { transport, handle, events, consumer } = await startCodex()
    transport.notification('account/rateLimits/updated', {
      rateLimits: {
        limitId: 'codex',
        primary: { usedPercent: 96, windowDurationMins: 300, resetsAt: 4_000_000_000 },
        secondary: null,
      },
    })
    await vi.waitFor(has(events, (e) => e.type === 'error' && e.message.includes('96%')))
    expect(scope(handle).dropped).toBe(0)

    await handle.close()
    await consumer
  })

  it('⚑ the counter reads what the gate refused AGAINST what the transport delivered (§3)', async () => {
    // ⚠️ Without the denominator, a gate that started dropping frames and a provider that stopped
    // sending them read identically — and they have opposite remedies. 184's precedent: gating must
    // not seal the evidence that gating was needed.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    // The handshake and `turn/start` are REQUESTS, not notifications, so the count starts at zero
    // and every increment below is a frame this test put on the wire.
    const before = scope(handle).seen
    expect(before).toBe(0)
    transport.notification('error', { threadId: OTHER, error: { message: 'theirs' } })
    transport.notification('error', { threadId: OTHER, error: { message: 'theirs again' } })
    transport.notification('turn/diff/updated', {
      threadId: OTHER,
      turnId: 'tn_1',
      diff: diffOf('theirs.ts', 'x'),
    })
    await barrier(transport, events, 'counted')

    const after = (handle as CodexSessionHandle).frameScope
    expect(after.dropped).toBe(3)
    // The marker was SEEN and not dropped: the denominator counts frames the gate let through too.
    expect(after.seen).toBe(before + 4)
    expect(after.byMethod).toEqual({ error: 2, 'turn/diff/updated': 1 })

    await handle.close()
    await consumer
  })

  it('🔒 the counter is BOUNDED — its key comes off the wire (052)', async () => {
    // A diagnostic that a provider can grow without limit is a leak, and `notificationCategory`
    // already assumes nothing about how many method names exist. Past the cap the tally stays exact
    // and only the attribution is given up, which is the half that matters least.
    const { transport, handle, events, consumer } = await startCodex()
    for (let i = 0; i < 50; i++) {
      transport.notification(`invented/method${i}`, { threadId: OTHER })
    }
    await barrier(transport, events, 'bounded')

    const after = (handle as CodexSessionHandle).frameScope
    expect(after.dropped, 'every drop is still counted').toBe(50)
    expect(Object.keys(after.byMethod).length, 'but not every one is named').toBeLessThanOrEqual(33)
    expect(after.byMethod['(other)']).toBe(50 - 32)

    await handle.close()
    await consumer
  })
})

/**
 * ⛔ **What a Codex child actually reports about itself, and what this session was throwing away**
 * (226, from 225 finding 1).
 *
 * The explorer asked Codex for two children named `alpha` and `beta`; both drew as `nested agent`,
 * with no name, no parent, no usage and no outcome. ⚠️ **`226` measured the wire before touching a
 * line** (`pnpm run probe:two-children`, pinned 0.146.0, a control turn that spawns nothing) and the
 * capture refutes three sentences this repo had hardened:
 *
 *  - a depth-2 birth is *"announced on a connection this app does not hold"* (135) — it arrives
 *    here, stamped with the depth-1 CHILD's `threadId`, carrying `agentPath: /root/coordinator/gamma`
 *    and the call that dispatched it;
 *  - *"there is no usage… an ending carries NO outcome"* (033) — each child sends its own
 *    `thread/tokenUsage/updated` and a `turn/completed` whose `turn.status` is the generated
 *    `TurnStatus` union, with `durationMs`;
 *  - *"a Codex child reports no usage"* (111) — measured on five children in one session.
 *
 * ⚑ **Each was true of the instrument that measured it.** Every one of those frames names the
 * child's thread, and 200's gate refuses a frame naming another thread before anything reads it —
 * so the captures those claims were written from could not have contained the evidence against
 * them. The frames are still refused as CONTENT; they are now also read as reports.
 *
 * ⚠️ **Driven through a real handle, never through the tracker.** `codex-sub-agents.test.ts` feeds
 * `CodexSubAgents` directly, and a tracker that answers correctly behind a gate that never calls it
 * is exactly the shape 200's own comment warns about — the app would be unchanged and the suite
 * green.
 */
describe('CodexSessionHandle — a child reports on itself (226)', () => {
  /** This session's own thread, as `startCodex` binds it. */
  const OURS = 'th_1'
  /** A child of ours, announced on our thread. */
  const ALPHA = 'th_alpha'
  /** A child of ALPHA's, announced on ALPHA's thread — 135's grandchild, with a name. */
  const GAMMA = 'th_gamma'
  /** Somebody else's conversation. Never a child, and the reason this is not a hole. */
  const STRANGER = 'th_stranger'

  const scope = (handle: unknown): { seen: number; dropped: number; adopted: number } =>
    (handle as CodexSessionHandle).frameScope

  /**
   * A birth announcement, on whichever thread announced it.
   *
   * ⚠️ **`turnId` is the caller's, and on OUR thread it must be the BOUND one.** `item/started` is
   * turn-scoped content: a birth carrying some other turn's id is refused before the tracker ever
   * sees it, the child is then known only by going active, and the card that results is the
   * `observed` one this dispatch exists to stop producing. These fixtures had exactly that mistake
   * on their first run, and it passed three of five assertions — which is what a fixture that
   * reaches the wrong branch looks like from the outside.
   */
  const birthOn = (
    threadId: string,
    agentThreadId: string,
    agentPath: string,
    turnId = 'tn_child',
  ): unknown => ({
    item: {
      type: 'subAgentActivity',
      id: `call_${agentThreadId}`,
      kind: 'started',
      agentThreadId,
      agentPath,
    },
    threadId,
    turnId,
  })

  const usageOn = (threadId: string, totalTokens: number): unknown => ({
    threadId,
    turnId: 'tn_child',
    tokenUsage: {
      total: { totalTokens, inputTokens: totalTokens, outputTokens: 0 },
      // ⚠️ Deliberately larger than `total`, which cannot happen on the wire: it is here so a
      // reading of the wrong field is a visible number rather than a coincidence.
      last: { totalTokens: totalTokens * 10, inputTokens: 0, outputTokens: 0 },
      modelContextWindow: 258_400,
    },
  })

  const completedOn = (
    threadId: string,
    status: string,
    durationMs: number | null,
    turnId = 'tn_child',
  ): unknown => ({
    threadId,
    turn: { id: turnId, items: [], itemsView: 'summary', status, error: null, durationMs },
  })

  /** The child announcing which of its own turns it is on — the correlation an outcome is checked against. */
  const startedOn = (threadId: string, turnId: string): unknown => ({
    threadId,
    turn: {
      id: turnId,
      items: [],
      itemsView: 'notLoaded',
      status: 'inProgress',
      error: null,
      durationMs: null,
    },
  })

  async function barrier(
    transport: FakeTransport,
    events: RuntimeEvent[],
    tag: string,
  ): Promise<void> {
    transport.notification(`marker/${tag}`, {})
    await vi.waitFor(has(events, (e) => e.type === 'unknown' && e.label === `marker/${tag}`))
  }

  const subAgents = (events: RuntimeEvent[]): Extract<RuntimeEvent, { type: 'sub_agent' }>[] =>
    events.filter((e): e is Extract<RuntimeEvent, { type: 'sub_agent' }> => e.type === 'sub_agent')

  it('⛔ the GRANDCHILD is announced, named and parented — 225 finding 1, at its cause', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    // Capture order, verbatim: the empty thread reports `idle` before it is announced, and the
    // grandchild's birth lands on ALPHA's thread rather than ours.
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'idle' } })
    transport.notification(
      'item/started',
      birthOn(OURS, ALPHA, '/root/alpha', transport.lastTurnId),
    )
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'active' } })
    transport.notification('thread/status/changed', { threadId: GAMMA, status: { type: 'idle' } })
    transport.notification('item/started', birthOn(ALPHA, GAMMA, '/root/alpha/gamma'))
    // ⛔ **The byte-identical repeat 033 was dispatched over**, and it arrives for a grandchild
    // exactly as it does for a child: `item/started` and `item/completed` carry the same item, so
    // reading both announces every descendant twice.
    transport.notification('item/completed', birthOn(ALPHA, GAMMA, '/root/alpha/gamma'))
    transport.notification('thread/status/changed', { threadId: GAMMA, status: { type: 'active' } })
    await barrier(transport, events, 'grandchild')

    const gamma = subAgents(events).filter((e) => e.agentId === GAMMA)
    // Born from the announcement, then working from its own status — the same two events a
    // depth-1 child produces, which is the point.
    expect(gamma.map((e) => e.phase)).toEqual(['started', 'progress'])
    // ⛔ The four blanks 225 reported, all four now answered by the provider's own words.
    expect(gamma[0]?.kind, 'the name the model coined, lineage and all').toBe('alpha/gamma')
    expect(gamma[0]?.parentToolCallId, 'the call that dispatched it').toBe(`call_${GAMMA}`)
    expect(gamma[0]?.idKind).toBe('thread')
    // ⛔ **NOT observed.** `origin: 'observed'` is what makes the card say `nested agent` and
    // `nested — parent not reported`; a card that carries a name must not also carry that.
    expect(gamma[0]?.origin).toBeUndefined()
    // ⚑ Its own `active` did not open a SECOND card: `report` registered it, so `status` finds it.
    expect(
      subAgents(events).filter((e) => e.agentId === GAMMA && e.phase === 'started'),
    ).toHaveLength(1)
    // The accounting: the birth frame was still refused as content, and counted as adopted once.
    // Both birth frames were refused as content; only the first was read as an announcement.
    expect(scope(handle).dropped, "the child's frames are still not our content").toBe(2)
    expect(scope(handle).adopted, 'the repeat announced nothing').toBe(1)

    await handle.close()
    await consumer
  })

  it('⛔ the outcome and the usage reach the card — and the idle that precedes them still ends it', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.notification(
      'item/started',
      birthOn(OURS, ALPHA, '/root/alpha', transport.lastTurnId),
    )
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'active' } })
    transport.notification('thread/tokenUsage/updated', usageOn(ALPHA, 34_483))
    // ⛔ **A reading with no `total` in it is not a zero.** `readNumber` refuses it and nothing is
    // emitted, so a malformed frame cannot write `0k tokens` over a real measurement.
    transport.notification('thread/tokenUsage/updated', { threadId: ALPHA, tokenUsage: {} })
    // ⚠️ **STARTED then COMPLETED, and the count must move once.** Counting the start would report
    // work the child has begun as work it has done — `074`'s reading, one surface over.
    transport.notification('item/started', {
      threadId: ALPHA,
      turnId: 'tn_child',
      item: { type: 'commandExecution', id: 'exec-1', command: 'uname -s', status: 'inProgress' },
    })
    transport.notification('item/completed', {
      threadId: ALPHA,
      turnId: 'tn_child',
      item: { type: 'commandExecution', id: 'exec-1', command: 'uname -s', status: 'completed' },
    })
    // ⛔ **A tool the child STARTED and never finished**, so the count below is a count of what it
    // has done rather than of what it reached for.
    transport.notification('item/started', {
      threadId: ALPHA,
      turnId: 'tn_child',
      item: { type: 'commandExecution', id: 'exec-2', command: 'sleep 60', status: 'inProgress' },
    })
    // …and a second one that DOES finish, so the count is proven to accumulate. `mergeUsage` keeps
    // the larger of what it holds, so a constant `1` would leave the card reading "1 tool" forever
    // — and every assertion below would still pass.
    transport.notification('item/completed', {
      threadId: ALPHA,
      turnId: 'tn_child',
      item: { type: 'fileChange', id: 'patch-1', status: 'completed' },
    })
    // ⛔ **A THIRD start with no completion, and the asymmetry is the whole point.** With two starts
    // and two completions, counting the wrong one gives the identical answer — `M14` survived its
    // first run for exactly that reason, the same shape as 224's `M8`. Three starts against two
    // completions is what makes the two readings distinguishable.
    transport.notification('item/started', {
      threadId: ALPHA,
      turnId: 'tn_child',
      item: { type: 'webSearch', id: 'search-1', query: 'anything', status: 'inProgress' },
    })
    // ⛔ **A NEGATIVE reading, which the schema would happily validate.** `usage` has no lower
    // bound, so a number that cannot be a measurement would survive `mergeUsage` and draw on the
    // card. It must be refused where it is read, and the honest blank is the fallback (111).
    transport.notification('thread/tokenUsage/updated', {
      threadId: ALPHA,
      tokenUsage: { total: { totalTokens: -1 }, last: { totalTokens: -1 } },
    })
    // ⚠️ **A frame this reader has no branch for, and the wire really sends it** — two per child in
    // the 226 capture. A child's thread is not a licence to read everything on it: an unhandled
    // method must contribute nothing rather than something shaped like progress.
    transport.notification('mcpServer/startupStatus/updated', {
      threadId: ALPHA,
      name: 'codex_apps',
      status: 'ready',
      error: null,
      failureReason: null,
    })
    // Measured order: `idle` lands ONE frame before `turn/completed`, so the ending arrives with no
    // outcome and the outcome follows it.
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'idle' } })
    // ⛔ **A reading that arrives AFTER the card ended.** `status` has refused to speak about a
    // closed card since 033, and the progress paths 226 added must refuse it for the same reason: a
    // `progress` for an ended card puts it back in `openSubAgents`, to be closed a second time at
    // the next turn boundary. Nothing in this run had exercised that, and `M25` survived on it.
    transport.notification('thread/tokenUsage/updated', usageOn(ALPHA, 999_999))
    transport.notification('turn/completed', completedOn(ALPHA, 'completed', 7610))
    await barrier(transport, events, 'ended')

    const alpha = subAgents(events).filter((e) => e.agentId === ALPHA)
    expect(alpha.map((e) => e.phase)).toEqual([
      'started',
      'progress',
      'progress',
      'progress',
      'progress',
      'ended',
      'ended',
    ])
    // ⛔ `total`, never `last` — the fixture's `last` is ten times larger precisely so this cannot
    // pass by accident.
    expect(alpha.find((e) => e.usage?.tokens)?.usage?.tokens).toBe(34_483)
    // ⛔ **Exactly one token reading reached the card, out of four sent.** The empty one carried no
    // number, the negative one carried one that cannot be a measurement, and the last one arrived
    // after the card had ended — so `999_999` must appear nowhere.
    const tokenReadings = alpha.filter((e) => e.usage?.tokens !== undefined)
    expect(tokenReadings.map((e) => e.usage?.tokens)).toEqual([34_483])
    // …and a count that MOVES, once per completion and never for the start beside it.
    const counted = alpha.filter((e) => e.usage?.toolCalls !== undefined)
    expect(counted.map((e) => e.usage?.toolCalls)).toEqual([1, 2])
    const last = alpha.at(-1)
    expect(last?.phase).toBe('ended')
    expect(last?.outcome).toBe('completed')
    expect(last?.usage?.ms).toBe(7610)
    // ⚑ **The counter, on the paths that are not a birth.** Four frames reported something — one
    // token reading, two tool completions, one outcome — and five did not: the empty reading, the
    // two tool STARTS, and the `mcpServer` frame nothing reads. Without this, `adopted` is only ever
    // proven to move on the announcement path.
    expect(scope(handle).adopted).toBe(4)
    // ⚠️ **Eleven refused, four of them read.** The two `thread/status/changed` frames are not in
    // either number: they are SUBJECT-method frames, so the gate never refuses them and they reach
    // `status()` whole. The counter is about the other kind.
    expect(scope(handle).dropped).toBe(11)

    // A repeat says nothing new: one outcome per child, however many times the provider sends it.
    transport.notification('turn/completed', completedOn(ALPHA, 'completed', 7610))
    await barrier(transport, events, 'repeat')
    expect(subAgents(events).filter((e) => e.agentId === ALPHA && e.outcome)).toHaveLength(1)
    // …and a frame that reported nothing is refused, not adopted.
    expect(scope(handle).adopted, 'a repeat is read and not counted').toBe(4)

    await handle.close()
    await consumer
  })

  it('⛔ a REPEATED `active` after an ending says nothing (transitions, not states)', async () => {
    // ⚠️ **The provider repeats a status freely** — that premise is why `working` exists. It mirrors
    // the status stream and nothing else, so anything that writes it from outside makes the next
    // repeat read as a fresh transition: a spurious `progress`, a cleared `ended`, and then a second
    // outcome-less `ended` on the following idle. `M28` survived until this test existed.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.notification(
      'item/started',
      birthOn(OURS, ALPHA, '/root/alpha', transport.lastTurnId),
    )
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'active' } })
    transport.notification('turn/started', startedOn(ALPHA, 'tn_one'))
    transport.notification('turn/completed', completedOn(ALPHA, 'completed', 1000, 'tn_one'))
    // The thread is still active as far as the status stream is concerned, so this changes nothing.
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'active' } })
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'idle' } })
    await barrier(transport, events, 'repeat-active')

    expect(subAgents(events).map((e) => `${e.phase}:${e.outcome ?? '-'}`)).toEqual([
      'started:-',
      'progress:-',
      'ended:completed',
    ])

    await handle.close()
    await consumer
  })

  it('⛔ a child that runs a SECOND turn reports how THAT one went', async () => {
    // ⚠️ **The flag that stops a repeat must not stop a sequel.** `turn/completed` is reported once
    // per ending, not once per child — a thread that goes active again is running another turn, and
    // that turn has an outcome of its own. `status`'s own comment already commits to this for the
    // ENDING (*"a child that goes active again … is reported as working again"*); an outcome flag
    // that stayed latched beside it would have made the two disagree.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.notification(
      'item/started',
      birthOn(OURS, ALPHA, '/root/alpha', transport.lastTurnId),
    )
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'active' } })
    transport.notification('turn/started', startedOn(ALPHA, 'tn_one'))
    transport.notification('turn/completed', completedOn(ALPHA, 'completed', 1000, 'tn_one'))
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'idle' } })
    // …and it is asked to do something else.
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'active' } })
    transport.notification('turn/started', startedOn(ALPHA, 'tn_two'))
    // ⛔ **A DELAYED frame from the first turn, arriving during the second.** It must not report
    // turn one's outcome — or turn one's duration — as turn two's. A boolean latch cleared on
    // `active` would have let this through; correlating on the turn id is what refuses it.
    transport.notification('turn/completed', completedOn(ALPHA, 'interrupted', 99_999, 'tn_one'))
    transport.notification('turn/completed', completedOn(ALPHA, 'failed', 2000, 'tn_two'))
    await barrier(transport, events, 'second-turn')

    const ended = subAgents(events).filter((e) => e.agentId === ALPHA && e.outcome)
    expect(ended.map((e) => e.outcome)).toEqual(['completed', 'failed'])
    // ⚑ And the duration is the child's whole life, not whichever turn was longest: 1000 + 2000,
    // with the stale frame's 99,999 nowhere in it.
    expect(ended.map((e) => e.usage?.ms)).toEqual([1000, 3000])

    await handle.close()
    await consumer
  })

  it('⛔ a child that FAILED says so, and `inProgress` fails closed (055, inherited)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    const BETA = 'th_beta'
    transport.notification(
      'item/started',
      birthOn(OURS, ALPHA, '/root/alpha', transport.lastTurnId),
    )
    transport.notification('item/started', birthOn(OURS, BETA, '/root/beta', transport.lastTurnId))
    transport.notification(
      'item/started',
      birthOn(OURS, GAMMA, '/root/gamma', transport.lastTurnId),
    )
    transport.notification('turn/completed', completedOn(ALPHA, 'failed', null))
    // ⛔ A `turn/completed` claiming the turn is still running is a contradiction, and the one
    // reading that must never be picked is "it succeeded".
    transport.notification('turn/completed', completedOn(BETA, 'inProgress', null))
    // ⚑ The third word in the provider's union, which nothing else in this file reaches — and the
    // one the smoke's vocabulary guard admits without ever having seen it produced.
    transport.notification('turn/completed', completedOn(GAMMA, 'interrupted', 42))
    await barrier(transport, events, 'failed')

    expect(subAgents(events).find((e) => e.agentId === ALPHA && e.outcome)?.outcome).toBe('failed')
    expect(subAgents(events).find((e) => e.agentId === BETA && e.outcome)?.outcome).toBe('failed')
    const stopped = subAgents(events).find((e) => e.agentId === GAMMA && e.outcome)
    expect(stopped?.outcome).toBe('interrupted')
    expect(stopped?.usage?.ms).toBe(42)
    // No `durationMs` on the wire means no `ms` on the card — never a zero.
    expect(subAgents(events).find((e) => e.agentId === ALPHA && e.outcome)?.usage).toBeUndefined()
    // ⛔ **And the trailing `idle` adds NOTHING** — the whole phase list, not just the outcomes, so
    // a second outcome-less `ended` cannot hide behind a filter that only looks at cards with one.
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'idle' } })
    await barrier(transport, events, 'after-failed')
    expect(
      subAgents(events)
        .filter((e) => e.agentId === ALPHA)
        .map((e) => e.phase),
    ).toEqual(['started', 'ended'])

    await handle.close()
    await consumer
  })

  it('🔒 a thread that is NOT one of ours reports NOTHING — the door is membership, not method', async () => {
    // ⚠️ **This is the assertion that keeps 226 from being a hole in 200.** The four methods below
    // are exactly the ones a child is read for; sent by a conversation this session was never told
    // about, every one must be refused as before, with nothing emitted and nothing adopted.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    const before = events.length
    // ⛔ **The door that actually opens, opened first.** `observe` fails OPEN — any thread that goes
    // active and is not ours gets an entry — so a test that never sends `active` exercises the case
    // where the door was already shut and proves nothing about the one that is reachable. This gets
    // its card, exactly as before 226, and then everything else must still be refused.
    transport.notification('thread/status/changed', {
      threadId: STRANGER,
      status: { type: 'active' },
    })
    transport.notification('item/started', birthOn(STRANGER, 'th_theirs', '/root/theirs'))
    transport.notification('item/completed', {
      threadId: STRANGER,
      item: { type: 'commandExecution', id: 'exec-x', command: 'rm -rf /', status: 'completed' },
    })
    transport.notification('thread/tokenUsage/updated', usageOn(STRANGER, 99_999))
    transport.notification('turn/completed', completedOn(STRANGER, 'completed', 1))
    await barrier(transport, events, 'stranger')

    // The observed card, and nothing else: no name, no descendant, no tokens, no tool count, no
    // outcome. `origin: 'observed'` is the whole of what an unannounced thread may put on screen.
    const theirs = subAgents(events.slice(before))
    expect(theirs.map((e) => `${e.agentId}:${e.phase}:${e.origin ?? '-'}`)).toEqual([
      `${STRANGER}:started:observed`,
    ])
    expect(theirs[0]?.usage).toBeUndefined()
    expect(theirs[0]?.outcome).toBeUndefined()
    expect(scope(handle).adopted, 'nothing an unannounced thread said was read').toBe(0)
    expect(scope(handle).dropped).toBe(4)

    await handle.close()
    await consumer
  })

  it('🔒 a birth may not name OUR OWN thread, or the thread announcing it', async () => {
    // ⛔ **The one door that writes an id it did not read from `threadId`.** Every other path keys
    // on the id the gate already checked; `descendant` takes `agentThreadId` out of the payload. An
    // item naming our own thread would put this session into `children` — after which its own
    // `thread/status/changed`, exempt from the foreign gate by design, would stop reaching
    // `observe`'s refusal and start driving a sub-agent card of the conversation itself.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.notification(
      'item/started',
      birthOn(OURS, ALPHA, '/root/alpha', transport.lastTurnId),
    )
    // ⚠️ **The marker is taken AFTER a barrier, never straight after the send.** `events.length`
    // read on the next line counts a queue that has not drained, so ALPHA's own birth lands inside
    // the window and reads as a card this test provoked — 201's lesson, in miniature.
    await barrier(transport, events, 'self-setup')
    const before = events.length
    transport.notification('item/started', birthOn(ALPHA, OURS, '/root/alpha/ourselves'))
    transport.notification('item/started', birthOn(ALPHA, ALPHA, '/root/alpha/itself'))
    await barrier(transport, events, 'self')

    expect(
      subAgents(events.slice(before)),
      'no card for ourselves, and none for the announcer',
    ).toEqual([])
    // …and the paired positive: an ordinary descendant on the same thread IS taken, so the refusal
    // above is about the two ids and not about the path being dead.
    transport.notification('item/started', birthOn(ALPHA, GAMMA, '/root/alpha/gamma'))
    await barrier(transport, events, 'self-positive')
    expect(subAgents(events).filter((e) => e.agentId === GAMMA)).toHaveLength(1)

    await handle.close()
    await consumer
  })

  it('⛔ a card the PARENT turn closed hears nothing more (075)', async () => {
    // ⚠️ **An interrupt is the ordinary way to reach this.** The parent's terminal `turn` closes
    // every open child card so the ledger cannot read "the turn ended, and then a sub-agent
    // stopped". Three of the child's own reports arrive after that boundary, and each would speak
    // about a card the app has already closed — the token reading worst of all, because a
    // `progress` puts it back in `open` to be closed a second time on the next turn.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.notification(
      'item/started',
      birthOn(OURS, ALPHA, '/root/alpha', transport.lastTurnId),
    )
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'active' } })
    // The parent's turn ends while the child is still running. ⚠️ The BOUND turn id, or
    // `isCurrentProviderTurn` ignores it and this test would wait for a boundary that never comes.
    transport.notification(
      'turn/completed',
      completedOn(OURS, 'interrupted', 10, transport.lastTurnId),
    )
    await vi.waitFor(has(events, (e) => e.type === 'turn'))
    const before = events.length
    transport.notification('thread/tokenUsage/updated', usageOn(ALPHA, 12_345))
    transport.notification('turn/completed', completedOn(ALPHA, 'completed', 500))
    transport.notification('item/completed', {
      threadId: ALPHA,
      item: { type: 'commandExecution', id: 'exec-late', command: 'ls', status: 'completed' },
    })
    await barrier(transport, events, 'sealed')

    expect(subAgents(events.slice(before)), 'the card was closed with the turn').toEqual([])
    // …and the card DID get its honest ending from the boundary, so this is a refusal of late
    // reports rather than a card that never existed.
    expect(
      subAgents(events).filter((e) => e.agentId === ALPHA && e.phase === 'ended'),
    ).toHaveLength(1)

    await handle.close()
    await consumer
  })

  it("🔒 a child's WORDS stay out of the parent's transcript (128)", async () => {
    // The same frames carry the child's prose and its final answer. They are not forwarded: the
    // card has no body to own them, and unowned speech reading as the parent's own is what 128
    // exists to have stopped.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.notification(
      'item/started',
      birthOn(OURS, ALPHA, '/root/alpha', transport.lastTurnId),
    )
    transport.notification('item/agentMessage/delta', {
      threadId: ALPHA,
      turnId: 'tn_child',
      itemId: 'msg_child',
      delta: 'I am the child speaking',
    })
    transport.notification('item/completed', {
      threadId: ALPHA,
      turnId: 'tn_child',
      item: { type: 'agentMessage', id: 'msg_child', text: 'Darwin', phase: 'final_answer' },
    })

    // ⛔ **The paired positive, and without it this proves nothing.** The identical message on OUR
    // thread, with the bound turn, DOES reach the transcript — so "the child's words are absent" is
    // a fact about whose thread they arrived on, not about a haystack that was empty either way.
    transport.notification('item/completed', {
      threadId: OURS,
      turnId: transport.lastTurnId,
      item: {
        type: 'agentMessage',
        id: 'msg_ours',
        text: 'PARENT SPEAKING',
        phase: 'final_answer',
      },
    })
    await barrier(transport, events, 'quiet')

    const text = events
      .map((e) =>
        e.type === 'assistant_message' ? e.text : e.type === 'assistant_delta' ? e.text : '',
      )
      .join('')
    expect(text, 'the instrument can see a message at all').toContain('PARENT SPEAKING')
    expect(text).not.toContain('child speaking')
    expect(text).not.toContain('Darwin')
    // …and the child's frames really did travel the adopted path rather than being ignored wholesale.
    expect(scope(handle).dropped, "the child's two frames were refused as content").toBe(2)
    // …and the agentMessage did not count as a tool call either.
    expect(subAgents(events).some((e) => e.usage?.toolCalls !== undefined)).toBe(false)

    await handle.close()
    await consumer
  })
})

/**
 * ⛔ **233 · the handle publishes the transport's exit fact, and nothing else.**
 *
 * The transport has collected `child.on('exit')` since 031 and never handed it to anyone —
 * `awaitExit(ms)` computed *"did it really die"* three times per teardown and `doReapGroup`
 * discarded the boolean at all three call sites. `codex-transport.test.ts` pins the fact itself;
 * this pins the one line that publishes it, which a mutation table found nothing else covered.
 */
describe('233 · CodexSessionHandle.awaitProcessExit', () => {
  it('⛔ is the transport process, not a settled promise', async () => {
    const transport = new FakeTransport()
    const die = transport.ownsAProcess()
    transport.onRequest('thread/start', () => okThread('th_exit'))
    const runtime = new CodexRuntime(adopt(transport))
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })

    const fact = handle.awaitProcessExit?.()
    expect(fact, 'a transport that owns a process must publish its exit').toBeDefined()
    // ⚑ **Identity, not just settlement.** A `Promise.resolve()` would satisfy "defined" and would
    // be exactly the over-claim under test; only the transport's own promise is the fact.
    expect(fact).toBe(transport.exited)

    let exited = false
    void (fact as Promise<void>).then(() => (exited = true))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(exited, 'a live app-server must not be reported as an exit').toBe(false)

    die()
    await fact
    expect(exited).toBe(true)
    await handle.close()
  })

  it('⚑ …and says "cannot say" for a transport that owns no process', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_none'))
    const runtime = new CodexRuntime(adopt(transport))
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })

    // ⛔ `undefined`, NOT `Promise.resolve()`. The host reads absence as "this adapter cannot say"
    // and falls back to the weaker thing it did before 233; a settled promise would be a receipt
    // for a process nobody ever observed.
    expect(handle.awaitProcessExit?.()).toBeUndefined()
    await handle.close()
  })
})

/**
 * 275 · **The stop Codex never had, wired to the gesture Claude already has.**
 *
 * ⛔ Every shape below is one `smoke/codex-background-probe.smoke.ts` measured on the pinned
 * 0.146.0 binary. `background-terminals.test.ts` holds the level's own behaviour; these are the
 * three facts about the HANDLE, which is what the host and the button read.
 */
describe('CodexSessionHandle — stopping one live command (275)', () => {
  const ROW = {
    itemId: 'exec-62bc2acf-84b1-41a0-8d14-505c4014166e',
    processId: '42852',
    command: 'sleep 402.278',
    cwd: '/tmp/x',
    osPid: null,
    cpuPercent: null,
    rssKb: null,
  }

  it('⛔ OFFERS the method at all — which is the whole of `canStopBackgroundWork` for Codex', async () => {
    const { handle, consumer } = await startCodex()
    // ⚑ `RuntimeHost.publishLiveness` reads exactly this: `handle.stopBackgroundWork === undefined`
    // is what published `canStopBackgroundWork: false` for every Codex conversation until 275, and
    // `ConversationPane` draws no button without it. The paired negative is one line down.
    expect(typeof handle.stopBackgroundWork).toBe('function')
    // …and `backgroundWork` stays absent, which is the ruling the gap ledger records: Codex detaches
    // a long command by itself, so there is no "detach this" gesture to offer.
    expect(handle.backgroundWork).toBeUndefined()
    await handle.close()
    await consumer
  })

  it('sends `thread/backgroundTerminals/terminate` with the processId the card carries', async () => {
    const { transport, handle, consumer } = await startCodex()
    transport.onRequest('thread/backgroundTerminals/terminate', () => ({ terminated: true }))
    transport.onRequest('thread/backgroundTerminals/list', () => ({ data: [], nextCursor: null }))
    await handle.stopBackgroundWork?.('42852')
    expect(
      transport.requests.find((r) => r.method === 'thread/backgroundTerminals/terminate'),
    ).toEqual({
      method: 'thread/backgroundTerminals/terminate',
      params: { threadId: 'th_1', processId: '42852' },
    })
    await handle.close()
    await consumer
  })

  it('⛔ passes a provider refusal through — the measured -32600, not a swallowed no-op', async () => {
    const { transport, handle, consumer } = await startCodex()
    transport.failRequest('thread/backgroundTerminals/terminate')
    await expect(handle.stopBackgroundWork?.('not-an-integer')).rejects.toThrow(/failed/)
    await handle.close()
    await consumer
  })

  it('answers `false` once the session is over — no throw, and no claim that a stop was sent', async () => {
    const { transport, handle, consumer } = await startCodex()
    await handle.close()
    await consumer
    const before = transport.requests.length
    // ⛔ **`false`, not `undefined`** (287 finding 5). It was a SILENT no-op, which
    // `RuntimeHost.stopBackgroundWork` turned into `true` — so the bar read *"Stopping… / Asked to
    // stop"* over a request that never reached the transport. Not throwing is still right: a closed
    // conversation is not broken.
    await expect(handle.stopBackgroundWork?.('42852')).resolves.toBe(false)
    expect(transport.requests.length).toBe(before)
  })

  it('⛔ publishes the level when a turn ends — the instant the app is about to say idle (250)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.onRequest('thread/backgroundTerminals/list', () => ({
      data: [ROW],
      nextCursor: null,
    }))
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1')),
    )
    await vi.waitFor(() =>
      expect(events.some((e) => e.type === 'background_work' && (e.running?.length ?? 0) > 0)).toBe(
        true,
      ),
    )
    const level = events.find((e) => e.type === 'background_work')
    expect(level).toMatchObject({
      running: [
        {
          id: '42852',
          toolCallId: 'exec-62bc2acf-84b1-41a0-8d14-505c4014166e',
          description: 'sleep 402.278',
        },
      ],
      source: 'thread/backgroundTerminals/list',
    })
    await handle.close()
    await consumer
  })

  /**
   * # 🔴 287 finding 2 · a stale completion for turn A could expose and STOP turn B's foreground work
   *
   * ⛔ **`onTurnCompleted` rejected the stale turn id correctly and the caller asked for the level
   * anyway.** Codex lists every PTY from process start — measured at t = 0 ms — including ordinary
   * foreground commands, so that rejected edge put turn B's live `git status` into the registry with
   * a Stop button beside it, polled it, and when it left the list attached a generated
   * `ended: unknown` to B's card, where `ToolEntry`'s rule since `248` puts a detachment ABOVE the
   * real successful result.
   *
   * ⚑ The two-turn state is `036 P1-C`'s own repro, already in this file; this is the same shape
   * asked a different question — not *"did it terminalize turn B"* but *"did it ask the provider
   * anything"*.
   */
  it('🔴 a STALE turn/completed asks for NO level — it is not a turn boundary (287 finding 2)', async () => {
    const listCalls = (t: FakeTransport): number =>
      t.requests.filter((r) => r.method === 'thread/backgroundTerminals/list').length
    const { transport, handle, events, consumer } = await startCodexInTurn()

    // ⚑ **The paired positive, first**: turn 1's OWN completion is ours, so it asks exactly once.
    transport.onRequest('thread/backgroundTerminals/list', () => ({ data: [], nextCursor: null }))
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1')),
    )
    await vi.waitFor(() => expect(listCalls(transport)).toBe(1))

    // Turn 2 begins and runs an ordinary FOREGROUND command. From here a list would name it.
    await handle.send('two')
    await vi.waitFor(() => expect(handle.status()).toBe('working'))
    transport.onRequest('thread/backgroundTerminals/list', () => ({
      data: [ROW],
      nextCursor: null,
    }))

    // The delayed duplicate for the OLD turn, arriving while turn 2 is live.
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1')),
    )
    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(listCalls(transport), 'a rejected completion buys no request').toBe(1)
    expect(
      events.filter((e) => e.type === 'background_work' && (e.running?.length ?? 0) > 0),
      'and turn 2’s foreground command never entered the registry',
    ).toEqual([])
    expect(handle.status(), 'turn 2 is still running, as 036 P1-C already required').toBe('working')
    await handle.close()
    await consumer
  })

  it('⛔ states the level on a RESUME, so a replayed ledger stops showing dead rows', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => okThread('th_1'))
    transport.onRequest('thread/backgroundTerminals/list', () => ({ data: [], nextCursor: null }))
    const handle = await new CodexRuntime(adopt(transport)).resume(
      { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home' },
    )
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    // ⚠️ **An empty level is the WHOLE point here** — it is the frame that clears rows the ledger
    // replayed for processes that died with the previous app-server. A `start` gets no such frame,
    // which the next test asserts from the other side.
    await vi.waitFor(() =>
      expect(events.some((e) => e.type === 'background_work' && e.running?.length === 0)).toBe(
        true,
      ),
    )
    await handle.close()
    await consumer
  })

  it('…and asks nothing on a fresh START, where there is no ledger to have replayed one', async () => {
    const { transport, handle, consumer } = await startCodex()
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(
      transport.requests.filter((r) => r.method === 'thread/backgroundTerminals/list'),
      'a guaranteed-empty answer on every session this app opens is the request 275 §1 warns about',
    ).toEqual([])
    await handle.close()
    await consumer
  })

  it('⛔ stops asking once the session closes — 273’s door, on the channel 275 opened', async () => {
    const { transport, handle, consumer } = await startCodex()
    transport.onRequest('thread/backgroundTerminals/list', () => ({
      data: [ROW],
      nextCursor: null,
    }))
    await handle.close()
    await consumer
    const after = transport.requests.filter(
      (r) => r.method === 'thread/backgroundTerminals/list',
    ).length
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(
      transport.requests.filter((r) => r.method === 'thread/backgroundTerminals/list').length,
      'the watch must not out-live the session it belongs to',
    ).toBe(after)
  })
})

/**
 * 🔴 **What a TOOL answered, whole** (462) — `457`'s finding 1, which it measured and handed over:
 * *"the structured half of a tool answer is durable nowhere and has no surface."*
 *
 * ## ⛔ Why this block is here and not beside the pure reader
 *
 * `codexToolAnswerParts` is a pure function and `the-answer-a-person-can-read.test.ts` drives it
 * directly. ⚠️ **What that cannot reach is the WIRING** — which method feeds it, whether it sits
 * above or below the turn gate, and whether the thread gate above both still refuses a foreign
 * conversation's item. Those are properties of this adapter, and this is the harness that has a
 * transport.
 */
describe('CodexSessionHandle — the whole of what a tool answered (462)', () => {
  const ITEM = 'exec-462-b24c-f0b42a7ad785'
  const completed = (
    turnId: string,
    over: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    threadId: 'th_1',
    turnId,
    item: {
      type: 'dynamicToolCall',
      id: ITEM,
      namespace: 'brobot',
      tool: 'list_projects',
      arguments: {},
      status: 'completed',
      success: true,
      durationMs: 4,
      contentItems: [
        { type: 'inputText', text: 'Six projects, and you may send work into all of them.' },
        { type: 'inputText', text: '{"outcome":"ok","count":6}' },
      ],
      ...over,
    },
  })

  it('⚑ both halves are held, keyed by the id the ROW carries', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    const turnId = transport.lastTurnId
    transport.notification('item/completed', completed(turnId))
    await vi.waitFor(() => expect(handle.toolAnswer?.(ITEM)?.parts).toHaveLength(2))
    expect(handle.toolAnswer?.(ITEM)?.parts.map((p) => p.text)).toEqual([
      'Six projects, and you may send work into all of them.',
      '{"outcome":"ok","count":6}',
    ])

    // ⛔ **The correlation the panel rests on**, asserted rather than assumed: the id the hold is
    // keyed by is the id on the row, so a button on that row asks about the call it is under.
    const row = events.find((e) => e.type === 'tool_result')
    expect(row?.type === 'tool_result' && row.id, 'the hold is keyed by the row’s own id').toBe(
      ITEM,
    )
    // ⚠️ …and the row's summary is still the CUT copy — the pair is the whole design.
    expect(row?.type === 'tool_result' && row.summary).toBe(
      'Six projects, and you may send work into all of them.',
    )

    // ⚠️ **The paired negative**: an id nothing answered is `null`, not an empty answer. Two
    // different sentences on the panel, and `074`'s rule is that they stay apart.
    expect(handle.toolAnswer?.('exec-nobody'), 'an id we hold nothing for').toBeNull()
    await handle.close()
    await consumer
  })

  it('⛔ a foreign thread’s completion writes nothing — the gate above it is still the gate', async () => {
    const { transport, handle, consumer } = await startCodexInTurn()
    const turnId = transport.lastTurnId
    transport.notification('item/completed', { ...completed(turnId), threadId: 'th_someone_else' })
    // ⚑ The control, on the same call, one field different: our own thread lands.
    transport.notification('item/completed', completed(turnId))
    await vi.waitFor(() => expect(handle.toolAnswer?.(ITEM)).not.toBeNull())
    expect(handle.toolAnswer?.(ITEM)?.parts).toHaveLength(2)
    await handle.close()
    await consumer
  })

  it('⚠️ a COMMAND’s completion holds nothing here — its output has a surface of its own', async () => {
    const { transport, handle, consumer } = await startCodexInTurn()
    const turnId = transport.lastTurnId
    transport.notification('item/completed', {
      threadId: 'th_1',
      turnId,
      item: { type: 'commandExecution', id: 'exec-cmd', command: 'ls', aggregatedOutput: 'a\nb\n' },
    })
    // ⛔ …and the control that makes the negative mean something: a tool answer on the same
    // transport, in the same turn, IS held.
    transport.notification('item/completed', completed(turnId))
    await vi.waitFor(() => expect(handle.toolAnswer?.(ITEM)).not.toBeNull())
    expect(
      handle.toolAnswer?.('exec-cmd'),
      'a command’s output was held as a tool answer',
    ).toBeNull()
    await handle.close()
    await consumer
  })
})

/**
 * Display what a running command is printing, rather than only its card.
 *
 * ## ⛔ Every shape here is one `probe:command-output` measured on the pinned 0.146.0 binary
 *
 * ```
 *  11647 ms · item/commandExecution/outputDelta item=exec-14dfe485-… "tick-2\n"
 *   tool_call id=exec-14dfe485-…  backgroundId=28992      ⚑ the SAME item id
 *  ⛔ output frames AFTER turn/completed: 39, still ticking
 * ```
 *
 * ## ⚠️ The stream this suite drives has NO `tool_result`, and §5 asked for exactly that
 *
 * `280` #1 existed because *"every desktop test uses a Claude-style receipt"* — and a detached Codex
 * command emits **no `item/completed`, ever** (275 measured it 30 s after the process was killed).
 * ⛔ So the rows below never send one. A suite that closed the item would be measuring the one shape
 * this provider does not produce, and the post-turn half — the whole point — would be unreachable.
 */
describe('CodexSessionHandle — a running command’s output (300)', () => {
  const ITEM = 'exec-14dfe485-2de2-4f00-b24c-f0b42a7ad785'
  const started = (turnId: string): Record<string, unknown> => ({
    threadId: 'th_1',
    turnId,
    item: { type: 'commandExecution', id: ITEM, command: 'seq 1 12', processId: '28992' },
  })
  const delta = (turnId: string, text: string): Record<string, unknown> => ({
    threadId: 'th_1',
    turnId,
    itemId: ITEM,
    delta: text,
  })

  it('⚑ keeps what the command prints, keyed by the id the CARD carries', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    const turnId = transport.lastTurnId
    transport.notification('item/started', started(turnId))
    transport.notification('item/commandExecution/outputDelta', delta(turnId, 'tick-1\n'))
    transport.notification('item/commandExecution/outputDelta', delta(turnId, 'tick-2\n'))
    await vi.waitFor(() => expect(handle.commandOutput?.(ITEM)?.text).toBe('tick-1\ntick-2\n'))

    // ⛔ **The correlation the whole design rests on**, asserted rather than assumed — `275` had to
    // measure the equivalent for `backgroundId` before a Stop could be drawn from it.
    const call = events.find((e) => e.type === 'tool_call')
    expect(call, 'a card must exist for the tail to belong to').toBeDefined()
    expect(call?.type === 'tool_call' && call.id, 'the delta names the card’s own id').toBe(ITEM)

    // ⚠️ **The paired negative**: an id nothing streamed is `null`, not an empty tail. Those are two
    // different sentences on the card and `074`'s rule is that they must stay apart.
    expect(handle.commandOutput?.('exec-nobody'), 'an id we hold nothing for').toBeNull()
    await handle.close()
    await consumer
  })

  it('🔴 …and KEEPS keeping it after the turn ends — which is when it becomes background work', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    const turnId = transport.lastTurnId
    transport.notification('item/started', started(turnId))
    transport.notification('item/commandExecution/outputDelta', delta(turnId, 'bgtick-1\n'))
    await vi.waitFor(() => expect(handle.commandOutput?.(ITEM)?.text).toBe('bgtick-1\n'))

    // ⛔ **No `item/completed` — this is the Codex shape, and §5's gate.** The turn ends over a
    // command that is still running, which is `247`'s definition of the subject.
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn(turnId)),
    )
    await vi.waitFor(() => expect(events.filter((e) => e.type === 'turn')).toHaveLength(1))
    const eventsAtTurnEnd = events.length

    // 39 of these arrived after `turn/completed` in the live probe. Every one is dropped by
    // `TURN_SCOPED_METHODS` — correctly — and every one must still reach the tail.
    transport.notification('item/commandExecution/outputDelta', delta(turnId, 'bgtick-2\n'))
    transport.notification('item/commandExecution/outputDelta', delta(turnId, 'bgtick-3\n'))
    await vi.waitFor(() =>
      expect(handle.commandOutput?.(ITEM)?.text).toBe('bgtick-1\nbgtick-2\nbgtick-3\n'),
    )

    // ⚠️ **The paired negative, and it is the reason the gate stays.** Not one of those frames may
    // become an EVENT: a delta from a finished turn appended to the conversation is 027/028's defect
    // and this dispatch does not reopen it. The tail grew; the transcript did not.
    expect(events.length, 'a post-turn delta must reach the tail and nothing else').toBe(
      eventsAtTurnEnd,
    )
    await handle.close()
    await consumer
  })

  it('⛔ a delta for ANOTHER thread reaches neither the tail nor the transcript', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    const turnId = transport.lastTurnId
    transport.notification('item/started', started(turnId))
    transport.notification('item/commandExecution/outputDelta', delta(turnId, 'ours\n'))
    await vi.waitFor(() => expect(handle.commandOutput?.(ITEM)?.text).toBe('ours\n'))
    const before = events.length

    // ⚑ **The thread gate is ABOVE the tail feed**, which is what keeps *"ungated by turn"* from
    // meaning *"ungated"*. A frame naming somebody else's conversation is refused before anything
    // here sees it — `200`'s `namesForeignThread`, one screen up from the feed.
    transport.notification('item/commandExecution/outputDelta', {
      threadId: 'th_someone_else',
      turnId,
      itemId: ITEM,
      delta: 'FOREIGN\n',
    })
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(handle.commandOutput?.(ITEM)?.text, 'a foreign thread wrote into our tail').toBe(
      'ours\n',
    )
    expect(events.length).toBe(before)
    await handle.close()
    await consumer
  })

  it('⚑ says the tail is CLOSED once the provider reports the item finished', async () => {
    const { transport, handle, consumer } = await startCodexInTurn()
    const turnId = transport.lastTurnId
    transport.notification('item/started', started(turnId))
    transport.notification('item/commandExecution/outputDelta', delta(turnId, 'done\n'))
    await vi.waitFor(() => expect(handle.commandOutput?.(ITEM)?.closed).toBe(false))
    transport.notification('item/completed', {
      threadId: 'th_1',
      turnId,
      item: { type: 'commandExecution', id: ITEM, command: 'seq 1 12', status: 'completed' },
    })
    // ⚠️ **The text SURVIVES the close.** A card that emptied the moment the work ended would take
    // the answer away at exactly the moment it was wanted.
    await vi.waitFor(() =>
      expect(handle.commandOutput?.(ITEM)).toEqual({
        text: 'done\n',
        dropped: 0,
        closed: true,
      }),
    )
    await handle.close()
    await consumer
  })

  it('🔴 …and the registry’s ENDING closes it too, which is a detached command’s only closer', async () => {
    const { transport, handle, consumer } = await startCodexInTurn()
    const turnId = transport.lastTurnId
    transport.notification('item/started', started(turnId))
    transport.notification('item/commandExecution/outputDelta', delta(turnId, 'detached\n'))
    await vi.waitFor(() => expect(handle.commandOutput?.(ITEM)?.closed).toBe(false))

    // ⛔ **No `item/completed` on this path, ever** (275, measured). The level is what ends it: one
    // list naming the row, then one that does not.
    transport.onRequest('thread/backgroundTerminals/list', () => ({
      data: [{ itemId: ITEM, processId: '28992', command: 'seq 1 12', cwd: '/tmp/x' }],
      nextCursor: null,
    }))
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn(turnId)),
    )
    await vi.waitFor(() =>
      expect(transport.requests.some((r) => r.method === 'thread/backgroundTerminals/list')).toBe(
        true,
      ),
    )
    transport.onRequest('thread/backgroundTerminals/list', () => ({ data: [], nextCursor: null }))
    await vi.waitFor(() => expect(handle.commandOutput?.(ITEM)?.closed).toBe(true), {
      timeout: 4_000,
    })
    expect(handle.commandOutput?.(ITEM)?.text, 'and what it printed is still there').toBe(
      'detached\n',
    )
    await handle.close()
    await consumer
  })

  it('⛔ lets the buffers go when the session does', async () => {
    const { transport, handle, consumer } = await startCodexInTurn()
    const turnId = transport.lastTurnId
    transport.notification('item/started', started(turnId))
    transport.notification('item/commandExecution/outputDelta', delta(turnId, 'held\n'))
    await vi.waitFor(() => expect(handle.commandOutput?.(ITEM)?.text).toBe('held\n'))
    await handle.close()
    await consumer
    // ⚠️ **`null`, which is "we hold nothing" and NOT an empty tail** — a closed conversation reads
    // `unfinished` off the transcript's own sweep, not off a buffer we kept holding (074).
    expect(handle.commandOutput?.(ITEM)).toBeNull()
  })
})

/**
 * 🔴 **314 · the two gates reach every Codex home, on every launch.**
 *
 * A provisioned Codex home can have no `config.toml`, leaving memory off with no separate
 * migration hook. The launch path reaches every home and must configure it before the child
 * exists. `codex-memory-config.test.ts` checks `ensureCodexMemoryConfig`’s string behavior;
 * these tests check launch ordering and invocation.
 */
describe('Codex memory is switched on at launch (314 §2)', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'brobot2-314-launch-'))
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  const config = (): string => join(home, 'config.toml')

  it('⛔ a START on a home with no config writes both gates — before the spawn', async () => {
    // ⚠️ **Before the spawn, for the reason 160's removal is**: the app-server reads its config once
    // at startup, so a write that landed after `transportFactory` would be a launch that reports
    // memory on and runs a child that has it off.
    let atSpawn: string | null = null
    const transport = new FakeTransport()
    transport.codexHome = home // this launch really reaches `initialize`, so the home must attest
    transport.onRequest('thread/start', () => okThread('th_1'))
    const handle = await new CodexRuntime(() => {
      atSpawn = existsSync(config()) ? readFileSync(config(), 'utf8') : null
      return transport
    }).start({ cwd: '/tmp/x', providerHome: home })
    expect(atSpawn, 'the gates must be on disk when the transport is built').toContain(
      'memories = true',
    )
    expect(atSpawn).toContain('dedicated_tools = true')
    expect(atSpawn).toContain('use_memories = true')
    expect(atSpawn).toContain('generate_memories = true')
    await handle.close()
  })

  it('⛔ …and so does a RESUME — the path an existing profile actually arrives by', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => okThread('th_1'))
    const handle = await new CodexRuntime(adopt(transport)).resume(
      { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 },
      { providerHome: home },
    )
    expect(readFileSync(config(), 'utf8')).toContain('dedicated_tools = true')
    await handle.close()
  })

  it('⚠️ a config that cannot be merged still LAUNCHES, and is left exactly as it was', async () => {
    // ⛔ **Memory is a feature; a launch is the product.** `features = 3` is somebody's value at a
    // name we want, and this app neither replaces it nor refuses to start Codex over it. The cost of
    // being wrong here is a profile without memory — which is where every profile was yesterday.
    const theirs = 'features = 3\n'
    writeFileSync(config(), theirs)
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1'))
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: home,
    })
    expect(handle.ref?.sessionId).toBe('th_1')
    expect(readFileSync(config(), 'utf8')).toBe(theirs)
    await handle.close()
  })

  it('⛔ the gates are written BELOW the stale sweep and ABOVE the attestation', async () => {
    // ⚑ **Both halves of that ordering are load-bearing and neither is visible from one call site.**
    // Below the sweep, or we merge into a file the next line deletes. Above the attestation, because
    // `assertCodexSqliteHomeContained` parses this very file — so a launch that failed closed on a
    // config we had not written yet would be attesting a file the child never sees.
    //
    // ⚠️ The `sqlite_home` here is contained, so the attestation PASSES; what it proves is that the
    // attestation ran on bytes that already carried the gates.
    writeFileSync(config(), 'sqlite_home = "sub/state"\n')
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1'))
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: home,
    })
    const after = readFileSync(config(), 'utf8')
    expect(after).toContain('sqlite_home = "sub/state"')
    expect(after).toContain('memories = true')
    await handle.close()
  })

  it('🔴 …and a config that REDIRECTS sqlite state still fails the launch closed', async () => {
    // ⛔ **The paired negative, and the one that would matter if the ordering were wrong.** Writing
    // to a home before attesting it must not become a way of accepting it: this config is refused at
    // exactly the same line it was refused at before 314, and the merge above it changes nothing
    // about that. ⚠️ The escape is still on disk afterwards — we do not delete somebody's config.
    writeFileSync(config(), 'sqlite_home = "/tmp/brobot-escape"\n')
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1'))
    await expect(
      new CodexRuntime(adopt(transport)).start({ cwd: '/tmp/x', providerHome: home }),
    ).rejects.toThrow(/redirects/)
    expect(readFileSync(config(), 'utf8')).toContain('sqlite_home = "/tmp/brobot-escape"')
  })
})

/**
 * 🔴 **348 · the five tools on the wire** — declared on `thread/start`, called back as
 * `item/tool/call`, and gated by the session's approval mode exactly as the Claude adapter gates
 * the same five.
 */
describe('348 · dynamic tools, on the wire', () => {
  /** One tool, recording what it was handed, so "it did not run" is assertable. */
  function tools(): { set: AgentToolset; calls: Record<string, unknown>[] } {
    const calls: Record<string, unknown>[] = []
    return {
      calls,
      set: {
        server: 'brobot',
        instructions: 'reach the app',
        tools: [
          {
            name: 'spawn_agent',
            description: 'Create another agent.',
            beyondItsRails: 'it-starts-something-outside-this-app',
            input: { profile_slug: z.string() },
            call: async (args) => {
              calls.push(args)
              return { text: 'spawned sess_9', structured: { outcome: 'ok' } }
            },
          },
          // ⚑ **486 · a verb whose rails are the whole gate, beside one that keeps its card** —
          // standing rule 3's pairing, in the fixture rather than in a second toolset: the two
          // readings must DIVERGE inside one session or the tests below measure nothing.
          {
            name: 'reply_to_parent',
            description: 'Answer the conversation that gave you the work.',
            beyondItsRails: 'nothing-its-rails-do-not-cover',
            input: { task_id: z.string() },
            call: async (args) => {
              calls.push(args)
              return { text: 'replied', structured: { outcome: 'ok' } }
            },
          },
        ],
      },
    }
  }

  const started = (transport: FakeTransport) =>
    transport.requests.find((one) => one.method === 'thread/start')?.params as
      Record<string, unknown> | undefined

  /** Start a session with a toolset AND open a turn, so a server request has a turn to belong to. */
  async function inTurn(
    agentTools: AgentToolset | undefined,
    approvalMode?: 'ask' | 'auto',
  ): Promise<{
    transport: FakeTransport
    handle: SessionHandle
    events: RuntimeEvent[]
  }> {
    const transport = new FakeTransport()
    // A conformant app-server ECHOES the profile it was asked for, and the adapter fails the launch
    // closed when it does not (013) — so an `auto` arm has to be answered as an `auto` server.
    transport.onRequest('thread/start', () =>
      approvalMode === 'auto'
        ? {
            ...okThread('th_1'),
            approvalPolicy: 'never',
            approvalsReviewer: 'user',
            sandbox: { type: 'dangerFullAccess' },
          }
        : okThread('th_1'),
    )
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
      ...(agentTools ? { agentTools } : {}),
      ...(approvalMode ? { approvalMode } : {}),
    })
    const events: RuntimeEvent[] = []
    void collect(handle, events)
    await handle.send('go')
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'status').at(-1)?.state).toBe('working'),
    )
    return { transport, handle, events }
  }

  const firstAct = 'message_act_00000000-0000-4000-8000-000000000001'
  const secondAct = 'message_act_00000000-0000-4000-8000-000000000002'
  const messageAnswer = (messageAct: string) => ({
    text: 'Done.',
    structured: { outcome: 'ok', kind: 'note', delivery: 'sent', agent: 'receiver', messageAct },
  })
  function messageTools(
    call: (args: Record<string, unknown>) => Promise<import('../src/agent-tools').AgentToolAnswer>,
  ): AgentToolset {
    return {
      server: 'brobot',
      tools: [
        {
          name: 'message_agent',
          description: 'Deliver a note.',
          beyondItsRails: 'nothing-its-rails-do-not-cover',
          input: { act: z.string() },
          call,
        },
      ],
    }
  }
  function finishedMessage(
    transport: FakeTransport,
    id: string,
    changes: Record<string, unknown> = {},
  ): void {
    transport.notification('item/completed', {
      threadId: 'th_1',
      turnId: transport.lastTurnId,
      item: {
        id,
        type: 'dynamicToolCall',
        namespace: 'brobot',
        tool: 'message_agent',
        status: 'completed',
        success: true,
        contentItems: [{ type: 'inputText', text: 'Done.' }],
        ...changes,
      },
    })
  }

  it.each(['auto', 'rails', 'card'] as const)(
    'the %s dispatch exit keeps a receipt inside the app',
    async (path) => {
      const original = messageTools(async () => messageAnswer(firstAct))
      const set: AgentToolset =
        path === 'card'
          ? {
              ...original,
              tools: original.tools.map((one) => ({
                ...one,
                beyondItsRails: 'it-destroys-work-in-flight',
              })),
            }
          : original
      const { transport, handle, events } = await inTurn(set, path === 'auto' ? 'auto' : 'ask')
      try {
        transport.serverRequest(1, 'item/tool/call', {
          callId: 'a',
          namespace: 'brobot',
          tool: 'message_agent',
          arguments: { act: firstAct },
        })
        if (path === 'card') {
          const card = await vi.waitFor(() => firstOfType(events, 'permission_request'))
          expect(transport.responses).toHaveLength(0)
          await handle.respondPermission(card.id, { outcome: 'allow' })
        }
        await vi.waitFor(() => expect(transport.responses).toHaveLength(1))
        expect(transport.responses[0]!.result).toEqual({
          contentItems: [{ type: 'inputText', text: 'Done.' }],
          success: true,
        })
        finishedMessage(transport, 'a')
        await vi.waitFor(() =>
          expect(events.some((event) => event.type === 'tool_result')).toBe(true),
        )
        expect(events.find((event) => event.type === 'tool_result')).toMatchObject({
          id: 'a',
          messageAct: firstAct,
        })
      } finally {
        await handle.close()
      }
    },
  )

  it.each(['refused', 'thrown', 'failed-result'] as const)(
    'a %s message cannot publish an act from a claimed call',
    async (path) => {
      const set = messageTools(async () => {
        if (path === 'thrown') throw new Error('fictional handler failure')
        if (path === 'refused')
          return {
            text: 'refused (no-such-agent): Nothing was sent.',
            structured: { ...messageAnswer(firstAct).structured, outcome: 'refused' },
          }
        return messageAnswer(firstAct)
      })
      const { transport, handle, events } = await inTurn(set, 'auto')
      try {
        transport.serverRequest(1, 'item/tool/call', {
          callId: 'a',
          namespace: 'brobot',
          tool: 'message_agent',
          arguments: { act: firstAct },
        })
        await vi.waitFor(() => expect(transport.responses).toHaveLength(1))
        finishedMessage(
          transport,
          'a',
          path === 'failed-result' ? { success: false, status: 'failed' } : {},
        )
        await vi.waitFor(() =>
          expect(events.some((event) => event.type === 'tool_result')).toBe(true),
        )
        expect(events.find((event) => event.type === 'tool_result')).not.toHaveProperty(
          'messageAct',
        )
        finishedMessage(transport, 'a')
        await vi.waitFor(() =>
          expect(events.filter((event) => event.type === 'tool_result')).toHaveLength(2),
        )
        expect(events.filter((event) => event.type === 'tool_result')[1]).not.toHaveProperty(
          'messageAct',
        )
      } finally {
        await handle.close()
      }
    },
  )

  it('pairs actual accepted callIds when two messages complete out of order, independently of RPC ids', async () => {
    const { transport, handle, events } = await inTurn(
      messageTools(async (args) => messageAnswer(String(args.act))),
      'auto',
    )
    try {
      transport.serverRequest(700, 'item/tool/call', {
        callId: 'a',
        namespace: 'brobot',
        tool: 'message_agent',
        arguments: { act: firstAct },
      })
      transport.serverRequest(701, 'item/tool/call', {
        callId: 'b',
        namespace: 'brobot',
        tool: 'message_agent',
        arguments: { act: secondAct },
      })
      await vi.waitFor(() => expect(transport.responses).toHaveLength(2))
      for (const response of transport.responses)
        expect(response.result).toMatchObject({
          contentItems: [{ type: 'inputText', text: 'Done.' }],
          success: true,
        })
      finishedMessage(transport, 'b')
      finishedMessage(transport, 'a')
      await vi.waitFor(() =>
        expect(events.filter((event) => event.type === 'tool_result')).toHaveLength(2),
      )
      expect(events.filter((event) => event.type === 'tool_result')).toMatchObject([
        { id: 'b', messageAct: secondAct },
        { id: 'a', messageAct: firstAct },
      ])
      finishedMessage(transport, 'a')
      finishedMessage(transport, '700')
      await vi.waitFor(() =>
        expect(events.filter((event) => event.type === 'tool_result')).toHaveLength(4),
      )
      expect(
        events
          .filter((event) => event.type === 'tool_result')
          .slice(2)
          .every((event) => !('messageAct' in event)),
      ).toBe(true)
    } finally {
      await handle.close()
    }
  })

  it('a foreign or stale completion does not spend the matching current message receipt', async () => {
    const { transport, handle, events } = await inTurn(
      messageTools(async () => messageAnswer(firstAct)),
      'auto',
    )
    try {
      transport.serverRequest(1, 'item/tool/call', {
        callId: 'a',
        namespace: 'brobot',
        tool: 'message_agent',
        arguments: { act: firstAct },
      })
      await vi.waitFor(() => expect(transport.responses).toHaveLength(1))
      finishedMessage(transport, 'a', { namespace: 'foreign' })
      transport.notification('item/completed', {
        threadId: 'th_1',
        turnId: 'old',
        item: {
          id: 'a',
          type: 'dynamicToolCall',
          namespace: 'brobot',
          tool: 'message_agent',
          status: 'completed',
          success: true,
        },
      })
      finishedMessage(transport, 'a')
      await vi.waitFor(() =>
        expect(events.filter((event) => event.type === 'tool_result')).toHaveLength(2),
      )
      expect(events.filter((event) => event.type === 'tool_result')).toMatchObject([
        { id: 'a' },
        { id: 'a', messageAct: firstAct },
      ])
      expect(events.filter((event) => event.type === 'tool_result')[0]).not.toHaveProperty(
        'messageAct',
      )
    } finally {
      await handle.close()
    }
  })

  it('duplicate accepted provider callIds fail closed even when their RPC ids differ', async () => {
    const { transport, handle, events } = await inTurn(
      messageTools(async () => messageAnswer(firstAct)),
      'auto',
    )
    try {
      for (const rpc of [1, 2])
        transport.serverRequest(rpc, 'item/tool/call', {
          callId: 'a',
          namespace: 'brobot',
          tool: 'message_agent',
          arguments: { act: firstAct },
        })
      await vi.waitFor(() => expect(transport.responses).toHaveLength(2))
      finishedMessage(transport, 'a')
      await vi.waitFor(() =>
        expect(events.some((event) => event.type === 'tool_result')).toBe(true),
      )
      expect(events.find((event) => event.type === 'tool_result')).not.toHaveProperty('messageAct')
    } finally {
      await handle.close()
    }
  })

  it.each(['auto', 'rails', 'card'] as const)(
    'a provider resolves a deferred %s message before its response, so its late answer has no receipt',
    async (path) => {
      let finish: ((answer: import('../src/agent-tools').AgentToolAnswer) => void) | undefined
      const original = messageTools(async (args) =>
        args.act === firstAct
          ? new Promise((resolve) => {
              finish = resolve
            })
          : messageAnswer(secondAct),
      )
      const set: AgentToolset =
        path === 'card'
          ? {
              ...original,
              tools: original.tools.map((one) => ({
                ...one,
                beyondItsRails: 'it-destroys-work-in-flight',
              })),
            }
          : original
      const { transport, handle, events } = await inTurn(set, path === 'auto' ? 'auto' : 'ask')
      try {
        transport.serverRequest(700, 'item/tool/call', {
          callId: 'a',
          namespace: 'brobot',
          tool: 'message_agent',
          arguments: { act: firstAct },
        })
        if (path === 'card') {
          const card = await vi.waitFor(() => firstOfType(events, 'permission_request'))
          await handle.respondPermission(card.id, { outcome: 'allow' })
        }
        await vi.waitFor(() => expect(finish).toBeDefined())
        expect(transport.responses).toHaveLength(0)
        transport.notification('serverRequest/resolved', { threadId: 'th_1', requestId: 700 })
        transport.serverRequest(701, 'item/tool/call', {
          callId: 'b',
          namespace: 'brobot',
          tool: 'message_agent',
          arguments: { act: secondAct },
        })
        if (path === 'card') {
          const next = await vi.waitFor(() => {
            const cards = events.filter((event) => event.type === 'permission_request')
            expect(cards).toHaveLength(2)
            return cards[1]!
          })
          await handle.respondPermission(next.id, { outcome: 'allow' })
        }
        await vi.waitFor(() => expect(transport.responses.map((one) => one.id)).toEqual([701]))
        finish!(messageAnswer(firstAct))
        finishedMessage(transport, 'a')
        finishedMessage(transport, 'b')
        await vi.waitFor(() =>
          expect(events.filter((event) => event.type === 'tool_result')).toHaveLength(2),
        )
        const results = events.filter((event) => event.type === 'tool_result')
        expect(results[0]).toMatchObject({ id: 'a' })
        expect(results[0]).not.toHaveProperty('messageAct')
        expect(results[1]).toMatchObject({ id: 'b', messageAct: secondAct })
        expect(transport.responses.map((one) => one.id)).toEqual([701])
      } finally {
        finish?.(messageAnswer(firstAct))
        await handle.close()
      }
    },
  )

  it.each(['auto', 'rails', 'card'] as const)(
    'a response sent before provider resolution keeps its %s message receipt',
    async (path) => {
      const original = messageTools(async () => messageAnswer(firstAct))
      const set: AgentToolset =
        path === 'card'
          ? {
              ...original,
              tools: original.tools.map((one) => ({
                ...one,
                beyondItsRails: 'it-destroys-work-in-flight',
              })),
            }
          : original
      const { transport, handle, events } = await inTurn(set, path === 'auto' ? 'auto' : 'ask')
      try {
        transport.serverRequest(700, 'item/tool/call', {
          callId: 'a',
          namespace: 'brobot',
          tool: 'message_agent',
          arguments: { act: firstAct },
        })
        if (path === 'card') {
          const card = await vi.waitFor(() => firstOfType(events, 'permission_request'))
          await handle.respondPermission(card.id, { outcome: 'allow' })
        }
        await vi.waitFor(() => expect(transport.responses.map((one) => one.id)).toEqual([700]))
        transport.notification('serverRequest/resolved', { threadId: 'th_1', requestId: 700 })
        finishedMessage(transport, 'a')
        await vi.waitFor(() =>
          expect(events.filter((event) => event.type === 'tool_result')).toHaveLength(1),
        )
        expect(events.find((event) => event.type === 'tool_result')).toMatchObject({
          id: 'a',
          messageAct: firstAct,
        })
        finishedMessage(transport, 'a')
        await vi.waitFor(() =>
          expect(events.filter((event) => event.type === 'tool_result')).toHaveLength(2),
        )
        expect(events.filter((event) => event.type === 'tool_result')[1]).not.toHaveProperty(
          'messageAct',
        )
        expect(transport.responses.map((one) => one.id)).toEqual([700])
      } finally {
        await handle.close()
      }
    },
  )

  it('a host callback finishing after turn retirement cannot attach its act to the next turn', async () => {
    let finish: ((answer: import('../src/agent-tools').AgentToolAnswer) => void) | undefined
    const { transport, handle, events } = await inTurn(
      messageTools(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      ),
      'auto',
    )
    try {
      transport.serverRequest(1, 'item/tool/call', {
        callId: 'a',
        namespace: 'brobot',
        tool: 'message_agent',
        arguments: { act: firstAct },
      })
      await vi.waitFor(() => expect(finish).toBeDefined())
      transport.notification(
        'turn/completed',
        turnCompletedNotification('th_1', completedTurn(transport.lastTurnId)),
      )
      await vi.waitFor(() =>
        expect(events.some((event) => event.type === 'turn' && event.state === 'completed')).toBe(
          true,
        ),
      )
      finish!(messageAnswer(firstAct))
      await handle.send('next')
      finishedMessage(transport, 'a')
      await vi.waitFor(() =>
        expect(events.some((event) => event.type === 'tool_result')).toBe(true),
      )
      expect(events.find((event) => event.type === 'tool_result')).not.toHaveProperty('messageAct')
    } finally {
      await handle.close()
    }
  })

  it('⛔ thread/start carries the namespace, and a session with no toolset carries no field', async () => {
    const withTools = await inTurn(tools().set)
    const spec = (started(withTools.transport)?.['dynamicTools'] as { name?: string }[])?.[0]
    expect(spec?.name).toBe('brobot')
    await withTools.handle.close()

    // ⚠️ The paired negative — an absent toolset must not become an empty declaration, which would
    // put a catalogue in the child's prompt that lists nothing.
    const without = await inTurn(undefined)
    expect(started(without.transport)).not.toHaveProperty('dynamicTools')
    await without.handle.close()
  })

  /**
   * 🔴 **358 · the arm whose whole point is that the provider says NOTHING.**
   *
   * ⛔ **`published: null` is not a placeholder for a read nobody wrote.** Every type on this
   * protocol that could carry an inventory back was read for `358` — `ThreadStartResponse`,
   * `ThreadStartedNotification`, `ThreadResumeResponse`, `Thread` (whose `extra` is
   * `Record<string, never>`), `ThreadReadResponse`, `ThreadSettings` — and not one has a tools
   * field. `353` saw a Codex inventory exactly once, and only by standing up a fake Responses
   * endpoint and reading the child's own outbound request body.
   */
  it('⛔ publishes what was DECLARED and says the provider reports nothing', async () => {
    const { transport, handle, events } = await inTurn(tools().set)
    await vi.waitFor(() => expect(events.some((e) => e.type === 'tool_inventory')).toBe(true))
    const event = events.find((e) => e.type === 'tool_inventory')
    expect(event?.published, 'this provider publishes no inventory, ever').toBeNull()
    expect(event?.declared?.server).toBe('brobot')
    expect(event?.declared?.tools.map((tool) => tool.name)).toEqual([
      'spawn_agent',
      'reply_to_parent',
    ])
    expect(event?.declared?.tools[0]?.parameters).toEqual([
      { name: 'profile_slug', type: 'string', required: true },
    ])
    // ⛔ **Codex's own spelling, as DATA** — no `mcp__` prefix, which is what `353` measured on the
    // child's wire. A surface that assumed Claude's would match nothing and would look exactly like
    // a conversation whose tools never arrived.
    expect(event?.naming).toEqual({ prefix: '', separator: '__' })
    expect(event?.source).toBe('thread/start')
    // ⚑ …and the declaration really did go out on the wire in the same run, so `declared` here is
    // the thing the child was given rather than a copy of an object nobody sent.
    expect((started(transport)?.['dynamicTools'] as { name?: string }[])?.[0]?.name).toBe('brobot')
    await handle.close()
  })

  it('⛔ …and a session with NO toolset publishes `declared: null`, not an empty one', async () => {
    // The paired negative: without it, "declared names our server" is a string found in an event.
    const { handle, events } = await inTurn(undefined)
    await vi.waitFor(() => expect(events.some((e) => e.type === 'tool_inventory')).toBe(true))
    const event = events.find((e) => e.type === 'tool_inventory')
    expect(event?.declared).toBeNull()
    expect(event?.published).toBeNull()
    await handle.close()
  })

  it('🔴 a RESUMED thread still states its inventory, and says which moment it is', async () => {
    // ⛔ **The resume path sends no `dynamicTools` — there is no field for it** — but the toolset is
    // still held by the handle and still answers `item/tool/call`. A reopened conversation that
    // published nothing would read as a conversation whose tools had gone.
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => okThread('th_1'))
    const handle = await new CodexRuntime(adopt(transport)).resume(
      { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home', agentTools: tools().set },
    )
    const events: RuntimeEvent[] = []
    void collect(handle, events)
    await vi.waitFor(() => expect(events.some((e) => e.type === 'tool_inventory')).toBe(true))
    const event = events.find((e) => e.type === 'tool_inventory')
    expect(event?.declared?.tools.map((tool) => tool.name)).toEqual([
      'spawn_agent',
      'reply_to_parent',
    ])
    expect(event?.published).toBeNull()
    // ⚑ **The `source` is the one thing that differs from a start**, and it is what tells a reader
    // that this statement came from a reopen rather than from a fresh declaration.
    expect(event?.source).toBe('thread/resume')
    await handle.close()
  })

  it('🔴 thread/resume carries no tools, because the app-server remembers them', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => okThread('th_1'))
    const handle = await new CodexRuntime(adopt(transport)).resume(
      { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home', agentTools: tools().set },
    )
    const resumed = transport.requests.find((one) => one.method === 'thread/resume')?.params
    // ⛔ `ThreadResumeParams` has no such field; `probe:codex-dynamic-tools` arm D measured a second
    // app-server process resuming a thread and rebuilding the same inventory. This negative is
    // paired with the positive above, so it cannot pass over a params object that carries nothing.
    expect(resumed).not.toHaveProperty('dynamicTools')
    expect(resumed).toHaveProperty('cwd', '/tmp/x')
    await handle.close()
  })

  it('🔴 a RESUMED session answers a tool call — the toolset is carried, not re-declared', async () => {
    // ⛔ **`ProviderRuntimeContext.agentTools`: *"forgetting it on a resume is how a spawned agent
    // silently loses its tools"*.** The app-server remembers the DECLARATION, so the child still
    // sees five tools after a resume — it does not remember how to CALL them, and a resume that
    // dropped this object would rebuild an inventory nothing on this side could answer.
    const { set, calls } = tools()
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => ({
      ...okThread('th_1'),
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandbox: { type: 'dangerFullAccess' },
    }))
    const handle = await new CodexRuntime(adopt(transport)).resume(
      { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 },
      {
        providerHome: '/tmp/x/home',
        agentTools: set,
        approvalMode: 'auto',
      },
    )
    const events: RuntimeEvent[] = []
    void collect(handle, events)
    await handle.send('go')
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'status').at(-1)?.state).toBe('working'),
    )
    transport.serverRequest(7, 'item/tool/call', {
      callId: 'c1',
      namespace: 'brobot',
      tool: 'spawn_agent',
      arguments: { profile_slug: 'worker' },
    })
    await vi.waitFor(() => expect(transport.responses).toHaveLength(1))
    expect(calls).toEqual([{ profile_slug: 'worker' }])
    expect((transport.responses[0]!.result as { success: boolean }).success).toBe(true)
    await handle.close()
  })

  it('⛔ in auto, a tool call runs and is answered with the tool’s own result — no card', async () => {
    const { set, calls } = tools()
    const { transport, handle, events } = await inTurn(set, 'auto')
    transport.serverRequest(7, 'item/tool/call', {
      callId: 'c1',
      namespace: 'brobot',
      tool: 'spawn_agent',
      arguments: { profile_slug: 'worker' },
    })
    await vi.waitFor(() => expect(transport.responses).toHaveLength(1))
    expect(calls).toEqual([{ profile_slug: 'worker' }])
    const answer = transport.responses[0]!.result as { success: boolean; contentItems: unknown[] }
    expect(answer.success).toBe(true)
    expect(JSON.stringify(answer.contentItems)).toContain('spawned sess_9')
    // ⚑ …and no permission card, which is the Claude adapter's `auto` behaviour in Codex's spelling.
    expect(events.filter((e) => e.type === 'permission_request')).toEqual([])
    await handle.close()
  })

  it('🔴 in ask, the call waits behind a card and runs only when a person allows it', async () => {
    const { set, calls } = tools()
    const { transport, handle, events } = await inTurn(set, 'ask')
    transport.serverRequest(7, 'item/tool/call', {
      callId: 'c1',
      namespace: 'brobot',
      tool: 'spawn_agent',
      arguments: { profile_slug: 'worker' },
    })
    const card = await vi.waitFor(() => firstOfType(events, 'permission_request'))
    // The card is the same `command` card Claude publishes for `mcp__brobot__spawn_agent`.
    expect(card.kind).toBe('command')
    expect(card.action).toBe('spawn_agent')
    expect(card.detail).toContain('worker')
    // ⚑ **`cancel` since 482** (`478` F4): the adapter honoured it on this card all along —
    // `isAlwaysHonoured` exempts it from the offered-set gate — and no surface drew it, which is a
    // move a person has and cannot reach. ⛔ Still no `allow_for_session`: see the next case.
    expect(card.scope.availableDecisions).toEqual(['allow', 'deny', 'cancel'])
    // ⛔ **Nothing has run and nothing has been answered while the card is open.**
    expect(calls).toEqual([])
    expect(transport.responses).toEqual([])

    await handle.respondPermission(card.id, { outcome: 'allow' })
    await vi.waitFor(() => expect(transport.responses).toHaveLength(1))
    expect(calls).toEqual([{ profile_slug: 'worker' }])
    expect((transport.responses[0]!.result as { success: boolean }).success).toBe(true)
    await handle.close()
  })

  /**
   * 🔴 **486 · this app's own verbs are gated by rails, not by a card** (HO-031 §2.4).
   *
   * ⛔ **THIS adapter is the second enforcer, and the exemption is worth nothing without it.** ⚠️ An
   * exemption honoured on one provider and not the other would leave one verb carded here and free
   * there — the same app, two answers to *does answering my parent need a human*.
   */
  it('🔴 in ask, a verb whose rails are the whole gate runs with NO card — and the one beside it still cards', async () => {
    const { set, calls } = tools()
    const { transport, handle, events } = await inTurn(set, 'ask')
    transport.serverRequest(7, 'item/tool/call', {
      callId: 'c1',
      namespace: 'brobot',
      tool: 'reply_to_parent',
      arguments: { task_id: 'task_1' },
    })
    await vi.waitFor(() => expect(transport.responses).toHaveLength(1))
    // ⛔ **It RAN**, and nobody was asked anything — HO-031 §2.9's *"it had to ask permission to
    // answer me"*, closed.
    expect(calls).toEqual([{ task_id: 'task_1' }])
    expect((transport.responses[0]!.result as { success: boolean }).success).toBe(true)
    expect(events.filter((e) => e.type === 'permission_request')).toEqual([])

    // ⚑ **The paired positive, same session, same mode, one fact over**: the verb that starts
    // something outside this app is still behind a card, and nothing has run for it.
    transport.serverRequest(8, 'item/tool/call', {
      callId: 'c2',
      namespace: 'brobot',
      tool: 'spawn_agent',
      arguments: { profile_slug: 'worker' },
    })
    const card = await vi.waitFor(() => firstOfType(events, 'permission_request'))
    expect(card.action).toBe('spawn_agent')
    expect(calls).toEqual([{ task_id: 'task_1' }])
    expect(transport.responses).toHaveLength(1)
    await handle.respondPermission(card.id, { outcome: 'allow' })
    await vi.waitFor(() => expect(transport.responses).toHaveLength(2))
    await handle.close()
  })

  it('⛔ a tool this session does not offer is exempted by nothing', async () => {
    // ⚠️ **The lookup is the SESSION'S own toolset**, so a name nobody declared cannot buy the
    // exemption by spelling — which is `asksAPersonOnly`'s rule arriving at this adapter.
    const { set, calls } = tools()
    const { transport, handle, events } = await inTurn(set, 'ask')
    transport.serverRequest(7, 'item/tool/call', {
      callId: 'c1',
      namespace: 'brobot',
      tool: 'a_verb_this_session_never_declared',
      arguments: {},
    })
    const card = await vi.waitFor(() => firstOfType(events, 'permission_request'))
    expect(card.action).toBe('a_verb_this_session_never_declared')
    expect(calls).toEqual([])
    // ⚑ …and once allowed, the toolset answers that nothing by that name is offered — a card for a
    // verb that does not exist is the fail-closed direction, not a door.
    await handle.respondPermission(card.id, { outcome: 'allow' })
    await vi.waitFor(() => expect(transport.responses).toHaveLength(1))
    expect((transport.responses[0]!.result as { success: boolean }).success).toBe(false)
    await handle.close()
  })

  /**
   * ⚑ **A verb may be carded for SOME calls only** (`beyondItsRailsWhen`): `message_agent` raises no
   * card until it is asked to stop the receiver's turn, and then raises the one `interrupt_agent`
   * does. ⛔ This adapter reads the call's own arguments, so the same verb in the same session
   * answers two ways — and a non-boolean `interrupt` is no stop.
   */
  describe('a verb carded for some calls only', () => {
    const MAYBE: AgentToolset = {
      server: 'brobot',
      tools: [
        {
          name: 'message_agent',
          description: 'Say something to an agent.',
          beyondItsRails: 'nothing-its-rails-do-not-cover',
          beyondItsRailsWhen: (args) =>
            args['interrupt'] === true
              ? 'it-destroys-work-in-flight'
              : 'nothing-its-rails-do-not-cover',
          input: { text: z.string(), interrupt: z.boolean().optional() },
          call: async () => ({ text: 'held', structured: { outcome: 'ok' } }),
        },
      ],
    }

    it('🔴 without interrupt it runs with no card, and with interrupt it cards and waits', async () => {
      const { transport, handle, events } = await inTurn(MAYBE, 'ask')
      transport.serverRequest(7, 'item/tool/call', {
        callId: 'c1',
        namespace: 'brobot',
        tool: 'message_agent',
        arguments: { text: 'a note' },
      })
      await vi.waitFor(() => expect(transport.responses).toHaveLength(1))
      expect(events.filter((e) => e.type === 'permission_request')).toEqual([])

      transport.serverRequest(8, 'item/tool/call', {
        callId: 'c2',
        namespace: 'brobot',
        tool: 'message_agent',
        arguments: { text: 'stop and read this', interrupt: true },
      })
      const card = await vi.waitFor(() => firstOfType(events, 'permission_request'))
      expect(card.action).toBe('message_agent')
      expect(transport.responses).toHaveLength(1)
      await handle.respondPermission(card.id, { outcome: 'allow' })
      await vi.waitFor(() => expect(transport.responses).toHaveLength(2))
      await handle.close()
    })

    it('⛔ an interrupt that is not exactly true is no stop: it runs with no card', async () => {
      const { transport, handle, events } = await inTurn(MAYBE, 'ask')
      transport.serverRequest(7, 'item/tool/call', {
        callId: 'c1',
        namespace: 'brobot',
        tool: 'message_agent',
        arguments: { text: 'a note', interrupt: 'true' },
      })
      await vi.waitFor(() => expect(transport.responses).toHaveLength(1))
      expect(events.filter((e) => e.type === 'permission_request')).toEqual([])
      await handle.close()
    })
  })

  it('⛔ a person’s Deny runs nothing, and says so as a broken call rather than as a rail', async () => {
    const { set, calls } = tools()
    const { transport, handle, events } = await inTurn(set, 'ask')
    transport.serverRequest(7, 'item/tool/call', {
      callId: 'c1',
      namespace: 'brobot',
      tool: 'spawn_agent',
      arguments: { profile_slug: 'worker' },
    })
    const card = await vi.waitFor(() => firstOfType(events, 'permission_request'))
    await handle.respondPermission(card.id, { outcome: 'deny' })
    await vi.waitFor(() => expect(transport.responses).toHaveLength(1))
    expect(calls).toEqual([])
    const answer = transport.responses[0]!.result as { success: boolean }
    // ⚠️ A RAIL's refusal is `success:true` — the door answered. This is the other thing, and the
    // two must not arrive wearing the same shape or the model cannot tell a rule from a person.
    expect(answer.success).toBe(false)
    expect(JSON.stringify(transport.responses[0]!.result)).toContain('declined')
    await handle.close()
  })

  /**
   * 🔴 **492 · the word now costs a frame — this is the frame** (`HO-032` §1, closing `483`'s
   * repair 2 and the last item in Slice 5's first exit half).
   *
   * ## ⛔ What this test asserted until this dispatch, and why the assertion was right
   *
   * ⚠️ **`483` pinned the defect here, deliberately, as a measurement rather than as desired
   * behaviour**: `respondPermission(cancel)` latched the LOCAL machine's interrupt bit, the
   * agent-tool handler sent the same declined tool result as Deny, and only when Codex later
   * reported an ORDINARY `turn/completed` did the machine consume the bit and publish a local
   * `interrupted` label. ⛔ *"the whole turn is interrupted"* was a rename, not a stop.
   *
   * ⚑ **The PO ruled option 1 — send the interrupt** — and gave the reason the softer option was
   * refused: *"Deny and Cancel do the same thing on that door, and the only difference is a label
   * that is false."* 🔴 So the two assertions `483` wrote — *no `turn/interrupt` was sent*, twice —
   * are INVERTED here rather than deleted, which is what makes this file's history readable.
   *
   * ## ⚠️ The ORDER is asserted, and it is a measurement rather than a preference
   *
   * ⛔ **The tool result goes back first and the frame second.** `probe:codex-cancel-interrupt`
   * drove pinned 0.146.0 both ways: arm A left the call outstanding, interrupted, and the turn
   * still ended `interrupted` in 16 ms — but the app-server then completed that dangling call
   * ITSELF with `status:'failed'` five ms AFTER `turn/completed`, and sent no
   * `serverRequest/resolved` for it. ⚑ Answering first leaves nothing claimed on either side.
   */
  it('🔴 agent-tool Cancel asks Codex to stop — the tool result, then turn/interrupt (492)', async () => {
    const { set, calls } = tools()
    const { transport, handle, events } = await inTurn(set, 'ask')
    transport.serverRequest(7, 'item/tool/call', {
      callId: 'c1',
      namespace: 'brobot',
      tool: 'spawn_agent',
      arguments: { profile_slug: 'worker' },
    })
    const card = await vi.waitFor(() => firstOfType(events, 'permission_request'))
    // ⛔ The button exists, which is the half `478` asked for and `482` shipped.
    expect(card.scope.availableDecisions).toContain('cancel')
    // ⚑ **The floor did not move** (492 §5): outcome 1 of `HO-032` §1 was reached, so `cancel` is
    // still offered on this door and `publishedOffer`'s always-honoured pair is untouched.
    expect(card.scope.availableDecisions).toEqual(['allow', 'deny', 'cancel'])

    await handle.respondPermission(card.id, { outcome: 'cancel' })
    await vi.waitFor(() => expect(transport.responses).toHaveLength(1))
    // ⛔ Nothing ran, and the provider was answered rather than left holding the call.
    expect(calls).toEqual([])
    expect((transport.responses[0]!.result as { success: boolean }).success).toBe(false)
    expect(JSON.stringify(transport.responses[0]!.result)).toContain('declined')

    // 🔴 **`483`'s assertion, inverted.** The frame goes out, and it names the BOUND turn — an
    // interrupt addressed to any other turn is one the app-server ignores.
    const interrupt = await vi.waitFor(() => {
      const sent = transport.requests.find((request) => request.method === 'turn/interrupt')
      expect(sent, 'no turn/interrupt was sent').toBeDefined()
      return sent!
    })
    expect(interrupt.params).toEqual({ threadId: 'th_1', turnId: transport.lastTurnId })
    // ⚠️ **Exactly one**, so a repair that also routed through `interrupt()` would be visible here.
    expect(transport.requests.filter((one) => one.method === 'turn/interrupt')).toHaveLength(1)

    // ⛔ **And nobody else's card was settled.** `interrupt()` calls `settleRequests()` on the line
    // after its own latch, which safe-rejects every open card and writes nothing — the act
    // `INTERRUPT_RAILS`' `a-person-is-being-asked` refuses an agent for. A person answering one
    // card must not answer the ones beside it, so this door does not call it.
    expect(transport.responses).toHaveLength(1)

    // ⚑ **The word arrives as the PROVIDER's**, which is what makes the latch unnecessary rather
    // than merely unwanted — measured on the pinned binary, `turn/completed{status:'interrupted'}`.
    transport.notification(
      'turn/completed',
      turnCompletedNotification(
        'th_1',
        completedTurn(transport.lastTurnId, { status: 'interrupted' }),
      ),
    )
    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.state === 'interrupted'))
    await handle.close()
  })

  /**
   * 🔴 **492 · an ordinary completion is no longer called `interrupted`** (`HO-032` §1, the half
   * the PO asked to be SHOWN).
   *
   * ⛔ **Under `492` this was the latch's own signature.** The provider reports a plain
   * `completed` — the race where the turn finished before the frame landed, and until that dispatch
   * the ONLY thing this door ever saw — and the app reports what happened rather than what it had
   * decided to call it. ⚠️ Under the old code this assertion was unreachable: the bit was set before
   * the response went out, so every completion on this path was renamed. ⚠️ **Since `709` (R43) no
   * latch renames a completion on any door**, so this pins the provider's word here and can no
   * longer see a latch; the latch's absence on this door is pinned by the Cancel-then-the-stream-ends
   * test below and by `make-the-word-mean-one-thing`'s §3 census.
   *
   * ⚑ **`howWorkStopped` reads it as `it-finished`**, and its own docblock has always allowed that
   * pair — *"a turn can be asked to stop and finish anyway"*.
   */
  it('⛔ …and a completion nobody stopped keeps its own word, which the latch made impossible (492)', async () => {
    const { set } = tools()
    const { transport, handle, events } = await inTurn(set, 'ask')
    transport.serverRequest(7, 'item/tool/call', {
      callId: 'c1',
      namespace: 'brobot',
      tool: 'spawn_agent',
      arguments: { profile_slug: 'worker' },
    })
    const card = await vi.waitFor(() => firstOfType(events, 'permission_request'))
    await handle.respondPermission(card.id, { outcome: 'cancel' })
    await vi.waitFor(() =>
      expect(transport.requests.some((one) => one.method === 'turn/interrupt')).toBe(true),
    )
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn(transport.lastTurnId)),
    )
    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.state === 'completed'))
    // 🔴 **The whole of `483`'s finding, gone**: no local rename of a word the provider did not say.
    expect(events.some((e) => e.type === 'turn' && e.state === 'interrupted')).toBe(false)
    await handle.close()
  })

  it('🔴 720 · R71 — …and a Cancel here, then the stream ends, reads `interrupted`: this door LATCHES too', async () => {
    // ⚑ **The ruling** (`709` F-1): *"Cancel, then the stream dies reads the same on Codex's
    // command/file approval and on the agent-tool card: both latch, because a Cancel asked a stop on
    // both, and a fault after it is not the provider's word alone."* ⛔ **On `main` this read
    // `failed`** (`the-provider-faulted`) — `492` returned above the latch on this door — while the
    // command door's Cancel read `interrupted` for the same sequence (the 395 block). ⚑ The word is
    // the machine's own, and marked so (R71).
    const { set } = tools()
    const { transport, handle, events } = await inTurn(set, 'ask')
    transport.serverRequest(7, 'item/tool/call', {
      callId: 'c1',
      namespace: 'brobot',
      tool: 'spawn_agent',
      arguments: { profile_slug: 'worker' },
    })
    const card = await vi.waitFor(() => firstOfType(events, 'permission_request'))
    await handle.respondPermission(card.id, { outcome: 'cancel' })
    await vi.waitFor(() =>
      expect(transport.requests.some((one) => one.method === 'turn/interrupt')).toBe(true),
    )
    transport.endIncoming()
    await vi.waitFor(has(events, (e) => e.type === 'turn'))
    await vi.waitFor(has(events, (e) => e.type === 'error'))
    expect(events.filter((e) => e.type === 'error')).toMatchObject([{ fatal: true }])
    expect(events.filter((e) => e.type === 'turn')).toEqual([
      { type: 'turn', state: 'interrupted', wordOf: 'this-app' },
    ])
    await handle.close()
  })

  it('⚑ 720 · CONTROL one fact over — the same card DENIED, then the stream ends, reads `failed`', async () => {
    // ⚑ A Deny asks no stop (482), so it sets no latch: a fault after it is the fault alone. This is
    // what refuses a latch widened to every answer.
    const { set } = tools()
    const { transport, handle, events } = await inTurn(set, 'ask')
    transport.serverRequest(7, 'item/tool/call', {
      callId: 'c1',
      namespace: 'brobot',
      tool: 'spawn_agent',
      arguments: { profile_slug: 'worker' },
    })
    const card = await vi.waitFor(() => firstOfType(events, 'permission_request'))
    await handle.respondPermission(card.id, { outcome: 'deny' })
    await vi.waitFor(() => expect(transport.responses).toHaveLength(1))
    transport.endIncoming()
    await vi.waitFor(has(events, (e) => e.type === 'turn'))
    expect(events.filter((e) => e.type === 'turn')).toEqual([
      { type: 'turn', state: 'failed', wordOf: 'this-app' },
    ])
    expect(transport.requests.some((request) => request.method === 'turn/interrupt')).toBe(false)
    await handle.close()
  })

  it('⚑ …and the control one fact over: the same press as DENY leaves the turn completed (482)', async () => {
    const { set, calls } = tools()
    const { transport, handle, events } = await inTurn(set, 'ask')
    transport.serverRequest(7, 'item/tool/call', {
      callId: 'c1',
      namespace: 'brobot',
      tool: 'spawn_agent',
      arguments: { profile_slug: 'worker' },
    })
    const card = await vi.waitFor(() => firstOfType(events, 'permission_request'))
    await handle.respondPermission(card.id, { outcome: 'deny' })
    await vi.waitFor(() => expect(transport.responses).toHaveLength(1))
    expect(calls).toEqual([])
    // 🔴 **492 · where the two words now DIVERGE, and it is the frame rather than a label.** ⛔ The
    // declined payload is byte-identical to a cancel's, deliberately — *nobody ran your tool* is one
    // outcome and a model must not read two sentences for it. ⚑ What a deny does not do is ask the
    // turn to stop, and this is the assertion `483` wrote about the cancel, now true of the verb it
    // is actually true of.
    expect(transport.requests.some((request) => request.method === 'turn/interrupt')).toBe(false)
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn(transport.lastTurnId)),
    )
    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.state === 'completed'))
    // ⛔ And the divergence is real: a deny never claims the turn.
    expect(events.some((e) => e.type === 'turn' && e.state === 'interrupted')).toBe(false)
    expect(transport.requests.some((request) => request.method === 'turn/interrupt')).toBe(false)
    await handle.close()
  })

  it('⚠️ a session-wide grant is not on offer for these tools', async () => {
    const { set } = tools()
    const { transport, handle, events } = await inTurn(set, 'ask')
    transport.serverRequest(7, 'item/tool/call', {
      callId: 'c1',
      namespace: 'brobot',
      tool: 'spawn_agent',
      arguments: {},
    })
    const card = await vi.waitFor(() => firstOfType(events, 'permission_request'))
    // ⛔ 001 non-negotiable 1: a tool pre-approved before anyone looks at its arguments. The Claude
    // side's allow is one-shot for the same reason, so this outcome is never offered here.
    await expect(
      handle.respondPermission(card.id, { outcome: 'allow_for_session' }),
    ).rejects.toThrow(/not offered/)
    expect(transport.responses).toEqual([])
    await handle.close()
  })

  it('🔴 a tool call for a FOREIGN thread never reaches the toolset', async () => {
    const { set, calls } = tools()
    const { transport, handle } = await inTurn(set, 'auto')
    transport.serverRequestRaw(7, 'item/tool/call', {
      threadId: 'somebody_elses_thread',
      turnId: transport.lastTurnId,
      callId: 'c1',
      namespace: 'brobot',
      tool: 'spawn_agent',
      arguments: { profile_slug: 'worker' },
    })
    await vi.waitFor(() => expect(transport.responses).toHaveLength(1))
    expect(calls).toEqual([])
    expect((transport.responses[0]!.result as { success: boolean }).success).toBe(false)
    await handle.close()
  })
})

/**
 * 🔴 **394 · what Codex puts in front of a person, and which half of it may travel** (HO-007 S4,
 * criterion 10).
 *
 * ## ⛔ From the wire, not from a capture
 *
 * ⚠️ **`394` §3, and the Claude suite carries the same paragraph**: every event below is built by
 * the REAL adapter from a REAL server request and handed to the real classifier.
 *
 * ## 🔴 The kind this provider differs in, and it is the dangerous one
 *
 * ⛔ **On Codex a permission arrives on the SAME EVENT TYPE as a question**, told apart by one
 * field: `handleUserInputRequest` reads `isPermission = method === 'item/permissions/requestApproval'`
 * and emits `{questions: [], permission}` for it and `{questions}` for a question. ⚠️ **A classifier
 * that asked only *"is this a `permission_request`?"* would hand a parent agent the power to widen
 * its child's sandbox** — which is why `a-grant-of-access` is its own member and is asked FIRST.
 *
 * ⚑ **And `isSecret` is Codex's alone.** `141` measured that the pinned model-tool schema does not
 * expose it and it defaults false, so no ordinary question sets it today — *absence in a capture is
 * not absence*, and the neutral question has carried the flag since `143` for exactly this.
 */
describe('394 · Codex · what may travel to a parent', () => {
  const askParams = {
    threadId: 'th_1',
    turnId: 'tn_1',
    itemId: 'it_1',
    questions: [
      {
        id: 'q_branch',
        header: 'Branch',
        question: 'which branch?',
        isOther: false,
        isSecret: false,
        options: [{ label: 'main', description: '' }],
      },
    ],
    // ⚑ What 0.160.0 really sends: `isBlocking` is required on the wire (provider follow-ups 1).
    isBlocking: false,
    autoResolutionMs: null,
  }
  const grantParams = {
    threadId: 'th_1',
    turnId: 'tn_1',
    itemId: 'it_2',
    environmentId: null,
    startedAtMs: 0,
    cwd: '/tmp/x',
    reason: 'needs write',
    permissions: { network: { enabled: true }, fileSystem: { read: null, write: ['/tmp/x/out'] } },
  }

  it('🔴 a question TRAVELS; a permissions grant and a command approval do NOT', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(80, 'item/tool/requestUserInput', askParams)
    transport.serverRequest(82, 'item/permissions/requestApproval', grantParams)
    transport.serverRequest(84, 'item/commandExecution/requestApproval', {
      command: 'rm x',
      cwd: '/tmp/x',
    })
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(2),
    )
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))

    const verdictFor = (id: string): ReturnType<typeof askedOfTheChannel> => {
      const raised = events.find(
        (event) =>
          (event.type === 'user_input_request' || event.type === 'permission_request') &&
          event.id === id,
      )
      if (raised === undefined) throw new Error(`no request was raised for ${id}`)
      return askedOfTheChannel(raised)
    }

    expect(verdictFor('number:80')).toMatchObject({ travels: true, id: 'number:80' })
    // 🔴 **The one that arrives dressed as a question.** Both of the first two are
    // `user_input_request`; only the field tells them apart, and only one may travel.
    expect(verdictFor('number:82')).toEqual({
      travels: false,
      id: 'number:82',
      because: 'a-grant-of-access',
    })
    expect(verdictFor('number:84')).toEqual({
      travels: false,
      id: 'number:84',
      because: 'a-permission-decision',
    })

    // ⚠️ **The admitted NAMED SET, against what this adapter really emits for a question** — and the
    // grant is the control that shows the set is doing work: it carries one key more, and that key
    // is the whole difference.
    const asked = events.find(
      (event) => event.type === 'user_input_request' && event.id === 'number:80',
    )
    const granted = events.find(
      (event) => event.type === 'user_input_request' && event.id === 'number:82',
    )
    expect(Object.keys(asked ?? {}).sort()).toEqual([...QUESTION_REQUEST_KEYS].sort())
    // ⚑ A grant carries no `isBlocking` (only a question does) and one key the set refuses.
    expect(Object.keys(granted ?? {}).sort()).toEqual(
      ['type', 'id', 'prompt', 'questions', 'permission'].sort(),
    )

    await handle.close()
    await consumer
  })

  it('⛔ a question whose answer is a SECRET is a person’s to type, and the ordinary one beside it still travels', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(85, 'item/tool/requestUserInput', askParams)
    transport.serverRequest(86, 'item/tool/requestUserInput', {
      ...askParams,
      itemId: 'it_3',
      questions: [
        {
          id: 'q_token',
          header: 'Token',
          question: 'paste the deploy token',
          isOther: true,
          isSecret: true,
          options: [],
        },
      ],
    })
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(2),
    )
    const raised = (id: string) =>
      events.find((event) => event.type === 'user_input_request' && event.id === id)
    // ⚑ **The pair, one fact over.** Same provider, same method, same shape; one field differs and
    // one of them travels — which is what makes this a measurement rather than a preference.
    expect(askedOfTheChannel(raised('number:85')!)).toMatchObject({ travels: true })
    expect(askedOfTheChannel(raised('number:86')!)).toEqual({
      travels: false,
      id: 'number:86',
      because: 'a-secret-only-a-person-can-type',
    })
    // ⛔ **And the flag really did survive the normalizer**, or the assertion above would be about a
    // question the adapter had flattened — the shape `143` added the field to prevent.
    const secret = raised('number:86')
    expect(secret?.type === 'user_input_request' && secret.questions[0]?.secret).toBe(true)

    await handle.close()
    await consumer
  })
})

/**
 * 🔴 **713 · `R59` — Codex's own compaction, asked for, and run as the turn it is.**
 *
 * ⚑ **The wire is the one `probe:codex-command-as-typed` measured on the bundled 0.146.0**:
 * `thread/compact/start` answers `{}`; then `turn/started` names a NEW turn; then a
 * `contextCompaction` item opens and closes under it; then `turn/completed`. ⛔ The answer carries
 * no turn id, so the turn binds from its `turn/started` — the one bind this adapter takes from a
 * notification — and each arm below puts one hazard of that on the path.
 */
describe('CodexRuntime — 713 · R59, a compaction asked for', () => {
  const compactionItem = (turnId: string, phase: 'started' | 'completed') => ({
    threadId: 'th_1',
    turnId,
    item: { type: 'contextCompaction', id: `cc_${turnId}` },
    ...(phase === 'started' ? { startedAtMs: 1 } : { completedAtMs: 2 }),
  })

  /** Codex's measured compaction, notification by notification, under turn `id`. */
  const codexCompacts = (transport: FakeTransport, id: string): void => {
    transport.notification('turn/started', turnStartedNotification('th_1', id))
    transport.notification('item/started', compactionItem(id, 'started'))
    transport.notification('item/completed', compactionItem(id, 'completed'))
    transport.notification('turn/completed', turnCompletedNotification('th_1', completedTurn(id)))
  }

  const compactions = (events: RuntimeEvent[]) =>
    events.filter(
      (event): event is Extract<RuntimeEvent, { type: 'compaction' }> =>
        event.type === 'compaction',
    )

  it('🔴 asks `thread/compact/start` for THIS thread, sends no `turn/start`, and is a turn of its own', async () => {
    const { transport, handle, events, consumer } = await startCodex()
    expect(handle.compact, 'Codex compacts on request').toBeDefined()
    await handle.compact?.()
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'status').at(-1)?.state).toBe('working'),
    )
    expect(transport.requests.filter((r) => r.method === 'thread/compact/start')).toEqual([
      { method: 'thread/compact/start', params: { threadId: 'th_1' } },
    ])
    expect(transport.requests.some((r) => r.method === 'turn/start')).toBe(false)

    codexCompacts(transport, 'tn_compact')
    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.state === 'completed'))
    // ⚑ **ONE row** — the item opens and closes under one id, and only its completion draws.
    // ⚑ …and it says a person asked, the word Claude's `compact_boundary` carries for `/compact`.
    expect(compactions(events)).toEqual([
      {
        type: 'compaction',
        compactionId: 'cc_tn_compact',
        trigger: 'manual',
        source: 'contextCompaction',
      },
    ])
    expect(handle.status()).toBe('idle')
    await handle.close()
    await consumer
  })

  it('⚑ the control: a compaction inside an ORDINARY turn is drawn and says nothing about who asked', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    // Codex's automatic compaction runs inside the turn that filled the window, under its id.
    transport.notification('turn/started', turnStartedNotification('th_1', 'tn_1'))
    transport.notification('item/completed', compactionItem('tn_1', 'completed'))
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1')),
    )
    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.state === 'completed'))
    expect(compactions(events)).toEqual([
      { type: 'compaction', compactionId: 'cc_tn_1', source: 'contextCompaction' },
    ])
    await handle.close()
    await consumer
  })

  const compacting = (events: RuntimeEvent[]) =>
    events.filter((e) => e.type === 'activity' && e.phase === 'compacting')

  /**
   * ⚑ **717 · `713` F-3 · Codex says a compaction is UNDER WAY, the way Claude does.** Measured: the
   * `contextCompaction` item opens 140 ms before it closes, with Codex's summary request between them.
   * So its `started` phase raises the live `compacting` pill, and only its `completed` phase draws the
   * boundary row.
   */
  it('🔴 717 · the item OPENING raises `activity: compacting` — once, and before the one row', async () => {
    const { transport, handle, events, consumer } = await startCodex()
    await handle.compact?.()
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'status').at(-1)?.state).toBe('working'),
    )
    codexCompacts(transport, 'tn_compact')
    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.state === 'completed'))
    expect(compacting(events), 'the compaction never said it was under way').toHaveLength(1)
    const pill = events.findIndex((e) => e.type === 'activity' && e.phase === 'compacting')
    expect(pill).toBeLessThan(events.findIndex((e) => e.type === 'compaction'))
    expect(compactions(events), 'still ONE row').toHaveLength(1)
    await handle.close()
    await consumer
  })

  it('⚑ 717 · the control: an ORDINARY turn — reasoning, a command, an answer — says nothing of compacting', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    const on = (item: Record<string, unknown>) => ({ threadId: 'th_1', turnId: 'tn_1', item })
    transport.notification('turn/started', turnStartedNotification('th_1', 'tn_1'))
    transport.notification('item/started', on({ type: 'reasoning', id: 'r1' }))
    transport.notification('item/completed', on({ type: 'reasoning', id: 'r1' }))
    const command = { type: 'commandExecution', id: 'x1', command: 'ls', status: 'inProgress' }
    transport.notification('item/started', on(command))
    transport.notification('item/completed', on({ ...command, status: 'completed' }))
    transport.notification('item/completed', on({ type: 'agentMessage', id: 'm1', text: 'done' }))
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1')),
    )
    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.state === 'completed'))
    // ⚑ Non-vacuity: the turn DID raise a live activity — just never this one.
    expect(events.some((e) => e.type === 'activity' && e.phase === 'thinking')).toBe(true)
    expect(compacting(events)).toEqual([])
    await handle.close()
    await consumer
  })

  it('⛔ 717 · a CHILD’s compaction, on its own thread, raises no pill here — the same frame on this one does', async () => {
    // ⚠️ Claude's arm guards a sub-agent's compaction by hand (`subAgentParent`); Codex's never reaches
    // the normaliser, because a frame naming another thread goes to the child tracker, not here
    // (`namesForeignThread`). ⚑ So the child is a REAL one — announced on this thread — and its frame
    // carries THIS session's bound turn id, so only the thread tells the two frames apart (`717`'s
    // review, round 1: a stranger's thread and a stranger's turn were dropped by the turn gate anyway).
    const { transport, handle, events, consumer } = await startCodexInTurn()
    const turnId = transport.lastTurnId
    transport.notification('item/started', {
      item: {
        type: 'subAgentActivity',
        id: 'call_child',
        kind: 'started',
        agentThreadId: 'th_child',
        agentPath: 'child',
      },
      threadId: 'th_1',
      turnId,
    })
    transport.notification('item/started', {
      threadId: 'th_child',
      turnId,
      item: { type: 'contextCompaction', id: 'cc_child' },
    })
    transport.notification('item/started', {
      threadId: 'th_1',
      turnId,
      item: { type: 'contextCompaction', id: 'cc_own' },
    })
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn(turnId)),
    )
    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.state === 'completed'))
    // ⚑ The child was really there — its card was born from the announcement.
    expect(events.some((e) => e.type === 'sub_agent' && e.agentId === 'th_child')).toBe(true)
    expect(compacting(events), 'only THIS thread’s compaction').toHaveLength(1)
    await handle.close()
    await consumer
  })

  it('⛔ refused while a turn runs, exactly as `send` is — and nothing is asked of Codex', async () => {
    const { transport, handle, consumer } = await startCodexInTurn()
    await expect(handle.compact?.()).rejects.toBeInstanceOf(TurnInProgress)
    expect(transport.requests.some((r) => r.method === 'thread/compact/start')).toBe(false)
    await handle.close()
    await consumer
  })

  it('⛔ a request Codex refuses fails the turn with its reason, and gives the session back', async () => {
    const { transport, handle, events, consumer } = await startCodex()
    transport.failRequest('thread/compact/start')
    await handle.compact?.()
    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.state === 'failed'))
    expect(
      events.some(
        (e) =>
          e.type === 'error' &&
          !e.fatal &&
          e.message === 'thread/compact/start failed: transport: thread/compact/start failed',
      ),
    ).toBe(true)
    expect(handle.status()).toBe('idle')
    await handle.close()
    await consumer
  })

  it('⛔ a late duplicate of the turn BEFORE never binds it — the compaction’s own `turn/started` does', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.notification('turn/started', turnStartedNotification('th_1', 'tn_1'))
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1')),
    )
    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.state === 'completed'))
    await handle.compact?.()
    // ⚠️ 037's hazard, on the one bind that reads a notification: the previous turn, again.
    transport.notification('turn/started', turnStartedNotification('th_1', 'tn_1'))
    transport.notification('item/completed', compactionItem('tn_1', 'completed'))
    codexCompacts(transport, 'tn_compact')
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'turn' && e.state === 'completed')).toHaveLength(2),
    )
    // ⚑ Only the compaction's own item drew — the stale id bound nothing, so its item was dropped.
    expect(compactions(events).map((e) => e.compactionId)).toEqual(['cc_tn_compact'])
    await handle.close()
    await consumer
  })

  it('⚑ an interrupt asked before the id is known is sent the moment the turn starts, naming it', async () => {
    const { transport, handle, events, consumer } = await startCodex()
    await handle.compact?.()
    await handle.interrupt()
    expect(transport.requests.some((r) => r.method === 'turn/interrupt')).toBe(false)
    transport.notification('turn/started', turnStartedNotification('th_1', 'tn_compact'))
    await vi.waitFor(() =>
      expect(transport.requests.filter((r) => r.method === 'turn/interrupt')).toEqual([
        { method: 'turn/interrupt', params: { threadId: 'th_1', turnId: 'tn_compact' } },
      ]),
    )
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_compact', { status: 'interrupted' })),
    )
    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.state === 'interrupted'))
    await handle.close()
    await consumer
  })

  it('⛔ an accepted compaction that never STARTS is given up, in words — not left `working`', async () => {
    const { handle, events, consumer } = await startCodex()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      await handle.compact?.()
      // Let the `{}` answer land, which is what arms the bound.
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(14_999)
      expect(events.some((e) => e.type === 'turn' && e.state === 'failed')).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
    } finally {
      vi.useRealTimers()
    }
    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.state === 'failed'))
    expect(
      events.some(
        (e) =>
          e.type === 'error' &&
          e.message === 'Codex accepted the compaction and did not start it within 15 seconds',
      ),
    ).toBe(true)
    expect(handle.status()).toBe('idle')
    await handle.close()
    await consumer
  })

  /** ⚑ Let the bound give a compaction up: asked, answered `{}`, and never started. */
  const aCompactionGivenUp = async (
    handle: SessionHandle,
    events: RuntimeEvent[],
  ): Promise<void> => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      await handle.compact?.()
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(15_000)
    } finally {
      vi.useRealTimers()
    }
    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.state === 'failed'))
  }

  it('⛔ after a give-up, a second compaction is refused until the first shows itself — its start is never taken for the second’s', async () => {
    const { transport, handle, events, consumer } = await startCodex()
    await aCompactionGivenUp(handle, events)
    const asked = () => transport.requests.filter((r) => r.method === 'thread/compact/start').length
    expect(asked()).toBe(1)
    // ⛔ Asked again while the first may still start: refused in words, and Codex is asked nothing.
    await expect(handle.compact?.()).rejects.toThrow(A_COMPACTION_IS_STILL_OUTSTANDING)
    expect(asked()).toBe(1)
    // ⚑ The first shows itself, late — its frames are NOT drawn — and then a compaction may be asked.
    codexCompacts(transport, 'tn_late')
    await vi.waitFor(async () => {
      await handle.compact?.()
    })
    expect(asked()).toBe(2)
    expect(compactions(events)).toEqual([])
    codexCompacts(transport, 'tn_second')
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'turn' && e.state === 'completed')).toHaveLength(1),
    )
    expect(compactions(events).map((e) => e.compactionId)).toEqual(['cc_tn_second'])
    await handle.close()
    await consumer
  })

  it('⚑ …and a turn of OURS that runs to its end clears the wait — its own start does not', async () => {
    const { transport, handle, events, consumer } = await startCodex()
    await aCompactionGivenUp(handle, events)
    await handle.send('go')
    await vi.waitFor(() => expect(transport.lastTurnId).toBe('tn_1'))
    transport.notification('turn/started', turnStartedNotification('th_1', 'tn_1'))
    // ⚠️ **A sync point AFTER that `turn/started`** — our own turn's start emits nothing, so this
    // waits on the delta behind it, which the adapter reads only once the start has been read
    // (713's row M25 survived a version that asked before the frame had landed).
    transport.notification('item/agentMessage/delta', {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'm1',
      delta: 'hey',
    })
    await vi.waitFor(has(events, (e) => e.type === 'assistant_delta' && e.text === 'hey'))
    // ⚑ The control: a `turn/started` for the turn this session bound is not the stray showing
    // itself — still the outstanding sentence, not `TurnInProgress`.
    await expect(handle.compact?.()).rejects.toThrow(A_COMPACTION_IS_STILL_OUTSTANDING)
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1')),
    )
    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.state === 'completed'))
    await handle.compact?.()
    expect(transport.requests.filter((r) => r.method === 'thread/compact/start')).toHaveLength(2)
    await handle.close()
    await consumer
  })

  it('⚑ the control: one that STARTS inside the bound is not given up when the bound passes', async () => {
    const { transport, handle, events, consumer } = await startCodex()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      await handle.compact?.()
      await vi.advanceTimersByTimeAsync(0)
      transport.notification('turn/started', turnStartedNotification('th_1', 'tn_compact'))
      await vi.advanceTimersByTimeAsync(16_000)
    } finally {
      vi.useRealTimers()
    }
    expect(events.some((e) => e.type === 'turn' && e.state === 'failed')).toBe(false)
    expect(handle.status()).toBe('working')
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_compact')),
    )
    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.state === 'completed'))
    await handle.close()
    await consumer
  })
})

describe('Codex launch settings stay with the launch', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'brobot2-codex-launch-settings-'))
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  const memory = [
    'features.memories=true',
    'memories.dedicated_tools=true',
    'memories.use_memories=true',
    'memories.generate_memories=true',
  ]

  for (const opening of ['start', 'resume'] as const) {
    for (const approval of ['ask', 'auto'] as const) {
      it(`${opening} records the ordered values sent for ${approval}, without server addresses`, async () => {
        const transport = new FakeTransport()
        transport.onRequest(`thread/${opening}`, () => ({
          ...okThread('th_1'),
          ...(approval === 'auto'
            ? {
                approvalPolicy: 'never',
                approvalsReviewer: 'user',
                sandbox: { type: 'dangerFullAccess' },
              }
            : {}),
        }))
        const options = {
          providerHome: home,
          approvalMode: approval,
          reasoningEffort: 'high',
          workFolders: ['/fictional/shared'],
          externalMcp: {
            servers: [
              { name: 'first', url: 'http://127.0.0.1:7001/mcp' },
              { name: 'second', url: 'http://127.0.0.1:7002/mcp' },
            ],
            reservedToolNames: [],
          },
        }
        const runtime = new CodexRuntime(adopt(transport))
        const handle =
          opening === 'start'
            ? await runtime.start({ ...options, cwd: '/tmp/x' })
            : await runtime.resume(
                { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 },
                options,
              )
        try {
          const sent = transport.requests.find((one) => one.method === `thread/${opening}`)
            ?.params as Record<string, unknown>
          expect(sent['config']).toEqual({
            'tools.update_plan.enabled': true,
            // ⚑ Codex's own question tool is off on every thread, start and resume.
            'tools.experimental_request_user_input.enabled': false,
            mcp_servers: {
              first: { url: 'http://127.0.0.1:7001/mcp' },
              second: { url: 'http://127.0.0.1:7002/mcp' },
            },
            ...(approval === 'ask'
              ? { 'sandbox_workspace_write.writable_roots': ['/fictional/shared'] }
              : {}),
            model_reasoning_effort: 'high',
          })
          expect(handle.launchSettings).toEqual([
            { key: 'memory', value: memory },
            {
              key: 'thread-overrides',
              value: [
                'tools.update_plan.enabled=true',
                'tools.experimental_request_user_input.enabled=false',
                'mcp_servers=["first","second"]',
                ...(approval === 'ask'
                  ? ['sandbox_workspace_write.writable_roots=["/fictional/shared"]']
                  : []),
                'model_reasoning_effort="high"',
              ],
            },
            { key: 'plan-tool', value: true },
            {
              key: 'approval-sandbox',
              value: [
                `approvalPolicy=${sent['approvalPolicy']}`,
                `approvalsReviewer=${sent['approvalsReviewer']}`,
                `sandbox=${sent['sandbox']}`,
              ],
            },
            { key: 'collaboration-mode', value: 'default' },
            { key: 'approval', value: approval },
            // ⚑ What that key turns off, by Codex's own name for it…
            { key: 'tools-off', value: ['request_user_input'] },
            // ⚑ …and the one it has no switch for, said as left on.
            { key: 'tools-left-on', value: ['request_user_input_async'] },
          ])
          const config = readFileSync(join(home, 'config.toml'), 'utf8')
          expect(config).toContain('memories = true')
          expect(config).toContain('dedicated_tools = true')
          expect(config).toContain('use_memories = true')
          expect(config).toContain('generate_memories = true')
          expect(JSON.stringify(handle.launchSettings)).not.toContain('127.0.0.1')
        } finally {
          await handle.close()
        }
      })
    }

    it(`${opening} keeps memory unknown when the merge is refused`, async () => {
      const original = 'features = 3\n'
      writeFileSync(join(home, 'config.toml'), original)
      const transport = new FakeTransport()
      transport.onRequest(`thread/${opening}`, () => okThread('th_1'))
      const runtime = new CodexRuntime(adopt(transport))
      const handle =
        opening === 'start'
          ? await runtime.start({ cwd: '/tmp/x', providerHome: home })
          : await runtime.resume(
              { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 },
              { providerHome: home },
            )
      try {
        expect(handle.launchSettings?.find((one) => one.key === 'memory')?.value).toBeNull()
        expect(handle.launchSettings?.find((one) => one.key === 'thread-overrides')?.value).toEqual(
          ['tools.update_plan.enabled=true', 'tools.experimental_request_user_input.enabled=false'],
        )
        expect(readFileSync(join(home, 'config.toml'), 'utf8')).toBe(original)
      } finally {
        await handle.close()
      }
    })
  }

  it.each([
    [{}, 'default'],
    [{ planMode: true }, 'plan'],
    [{ planMode: true, planModeEnded: true }, 'default'],
  ] as const)('records the initial collaboration selection %j', async (options, expected) => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1'))
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: home,
      ...options,
    })
    try {
      expect(handle.launchSettings?.find((one) => one.key === 'collaboration-mode')?.value).toBe(
        expected,
      )
      const sent = transport.requests.find((one) => one.method === 'thread/start')
        ?.params as Record<string, unknown>
      expect(sent).not.toHaveProperty('collaborationMode')
      // ⚑ Planning or not, the plan tool stays on and the question tool stays off.
      expect(sent['config']).toEqual({
        'tools.update_plan.enabled': true,
        'tools.experimental_request_user_input.enabled': false,
      })
    } finally {
      await handle.close()
    }
  })

  it('later settings and file changes do not replace or mutate the launch values', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1'))
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: home,
    })
    try {
      const launched = handle.launchSettings
      const original = JSON.stringify(launched)
      await handle.setApprovalMode?.('auto')
      await handle.setPlanMode?.(true)
      await handle.setReasoningEffort?.('low')
      await handle.setModel?.('another-model')
      handle.setWorkFolders?.(['/fictional/later'])
      writeFileSync(join(home, 'config.toml'), 'features = 3\n')
      expect(handle.launchSettings).toBe(launched)
      expect(JSON.stringify(handle.launchSettings)).toBe(original)
      expect(Object.isFrozen(launched)).toBe(true)
      for (const one of launched ?? []) {
        expect(Object.isFrozen(one)).toBe(true)
        if (Array.isArray(one.value)) expect(Object.isFrozen(one.value)).toBe(true)
      }
      expect(transport.requests.filter((one) => one.method === 'thread/start')).toHaveLength(1)
    } finally {
      await handle.close()
    }
  })
})

describe('shared skills at a Codex turn boundary', () => {
  let home: string
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), 'fictional-shared-codex-')))
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })
  it.each([
    ['start', false],
    ['resume', false],
    ['start', true],
    ['resume', true],
  ] as const)(
    'registers both roots on %s and reloads before each turn (managed plugin: %s)',
    async (opening, withPlugin) => {
      const transport = new FakeTransport()
      transport.onRequest('thread/start', () => okThread('th_1', home))
      transport.onRequest('thread/resume', () => okThread('th_1', home))
      transport.onRequest('skills/list', () => ({
        data: [{ cwd: home, errors: [], skills: [] }],
      }))
      transport.onRequest('mcpServerStatus/list', () => ({
        data: [{ name: 'plugin-fern', runtimeStatus: 'connected', toolsError: null, tools: {} }],
      }))
      const runtime = new CodexRuntime(adopt(transport))
      const context = {
        providerHome: home,
        builtInSkills: { root: join(home, 'built-in-skills'), skills: [] },
        sharedSkillsRoot: join(home, 'shared-skills'),
        ...(withPlugin
          ? {
              managedPluginMcp: [
                {
                  name: 'plugin-fern',
                  url: 'http://127.0.0.1:8123/mcp',
                  capability: 'a'.repeat(64),
                },
              ],
            }
          : {}),
      }
      const handle =
        opening === 'start'
          ? await runtime.start({ ...context, cwd: home })
          : await runtime.resume(
              { provider: 'codex', sessionId: 'th_1', cwd: home, rotation: 0 },
              context,
            )
      expect(
        transport.requests.find((one) => one.method === 'skills/extraRoots/set')?.params,
      ).toEqual({ extraRoots: [context.builtInSkills.root, context.sharedSkillsRoot] })
      expect(transport.requests.filter((one) => one.method === 'skills/config/write')).toEqual([])
      const first = transport.requests.length
      await handle.send('Check the recipe.')
      await vi.waitFor(() =>
        expect(transport.requests.slice(first).some((one) => one.method === 'turn/start')).toBe(
          true,
        ),
      )
      expect(
        transport.requests
          .slice(first)
          .filter((one) =>
            ['mcpServerStatus/list', 'skills/list', 'turn/start'].includes(one.method),
          )
          .map((one) => one.method),
      ).toEqual(
        withPlugin
          ? ['mcpServerStatus/list', 'skills/list', 'turn/start']
          : ['skills/list', 'turn/start'],
      )
      expect(
        transport.requests.slice(first).find((one) => one.method === 'skills/list')?.params,
      ).toEqual({ cwds: [home], forceReload: true })
      await expect(handle.send('A concurrent turn.')).rejects.toThrow()
      transport.notification(
        'turn/completed',
        turnCompletedNotification('th_1', completedTurn(transport.lastTurnId)),
      )
      await vi.waitFor(() => expect(handle.status()).toBe('idle'))
      const second = transport.requests.length
      await handle.send('Check the edited recipe.')
      await vi.waitFor(() =>
        expect(transport.requests.slice(second).some((one) => one.method === 'turn/start')).toBe(
          true,
        ),
      )
      expect(
        transport.requests
          .slice(second)
          .filter((one) => ['skills/list', 'turn/start'].includes(one.method))
          .map((one) => one.method),
      ).toEqual(['skills/list', 'turn/start'])
      transport.notification(
        'turn/completed',
        turnCompletedNotification('th_1', completedTurn(transport.lastTurnId)),
      )
      await vi.waitFor(() => expect(handle.status()).toBe('idle'))
      transport.onRequest('skills/list', () =>
        Promise.reject(new Error('fictional reload failure')),
      )
      await handle.send('An unread refresh.')
      await vi.waitFor(() => expect(handle.status()).toBe('idle'))
      const afterFailure = transport.requests.filter((one) => one.method === 'turn/start').length
      expect(afterFailure).toBe(2)
      let release!: () => void
      transport.onRequest(
        'skills/list',
        () =>
          new Promise((done) => {
            release = () => done({ data: [] })
          }),
      )
      await handle.send('A turn stopped during refresh.')
      await vi.waitFor(() => expect(release).toBeDefined())
      await handle.close()
      release()
      await new Promise((done) => setTimeout(done, 10))
      expect(transport.requests.filter((one) => one.method === 'turn/start')).toHaveLength(
        afterFailure,
      )
    },
  )
})
it.each(['start', 'resume'] as const)(
  'managed plugin Codex %s carries only its broker capability',
  async (launch) => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1'))
    transport.onRequest('thread/resume', () => okThread('th_1'))
    const runtime = new CodexRuntime(adopt(transport))
    const route = {
      name: 'plugin-fern',
      url: 'http://127.0.0.1:8123/mcp',
      capability: 'a'.repeat(64),
    }
    const context = {
      providerHome: '/tmp/x/home',
      managedPluginMcp: [route],
      externalMcp: {
        servers: [{ name: 'fictional-registry', url: 'http://127.0.0.1:8124/mcp' }],
        reservedToolNames: [],
      },
    }
    const handle =
      launch === 'start'
        ? await runtime.start({ cwd: '/tmp/x', ...context })
        : await runtime.resume(
            { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 1 },
            context,
          )
    try {
      const request = transport.requests.find((one) => one.method === `thread/${launch}`)
      expect((request?.params as { config: unknown }).config).toEqual({
        ...EVERY_THREAD_OVERLAY,
        mcp_servers: {
          'fictional-registry': { url: 'http://127.0.0.1:8124/mcp' },
          'plugin-fern': {
            url: route.url,
            http_headers: { Authorization: `Bearer ${route.capability}` },
          },
        },
      })
    } finally {
      await handle.close()
    }
  },
)

describe('managed resume ownership', () => {
  it('retains the allocated handle before a refused resume handshake', async () => {
    const transport = new FakeTransport()
    const die = transport.ownsAProcess()
    transport.onRequest('thread/resume', () => {
      throw new Error('fictional refusal')
    })
    const runtime = new CodexRuntime(adopt(transport))
    let allocated: SessionHandle | undefined
    try {
      await expect(
        runtime.resume(
          { provider: 'codex', sessionId: 'fictional-thread', cwd: '/tmp/x', rotation: 0 },
          {
            providerHome: '/tmp/x/home',
            onSessionCreated: (handle) => {
              allocated = handle
            },
          },
        ),
      ).rejects.toThrow()
      expect(allocated).toBeDefined()
      expect(allocated!.awaitProcessExit!()).toBe(transport.exited)
    } finally {
      die()
      await allocated?.close()
    }
  })
  it('publishes the stronger cleanup fact when the transport can prove group quiescence', async () => {
    const transport = new FakeTransport()
    transport.ownsAProcess()()
    let quiet!: () => void
    transport.quiesced = new Promise<void>((resolve) => {
      quiet = resolve
    })
    transport.onRequest('thread/start', () => okThread('fictional-thread'))
    const runtime = new CodexRuntime(adopt(transport))
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    try {
      expect(handle.awaitProcessExit!()).toBe(transport.quiesced)
      let proved = false
      void handle.awaitProcessExit!()!.then(() => {
        proved = true
      })
      await handle.close()
      expect(proved).toBe(false)
    } finally {
      quiet()
      await handle.close()
    }
    await handle.awaitProcessExit!()
  })
})
