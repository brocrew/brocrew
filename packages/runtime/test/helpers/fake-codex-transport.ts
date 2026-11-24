import { existsSync } from 'node:fs'
import { beforeAll, expect, vi } from 'vitest'
import { type RuntimeEvent, type SessionHandle } from '../../src/index'
import {
  CodexRuntime,
  type CodexIncoming,
  type CodexLaunchContext,
  type CodexTransport,
} from '../../src/codex'
import type { AgentToolset } from '../../src/agent-tools'
import { CODEX_PLAN_TOOL_CONFIG, CODEX_QUESTION_TOOL_CONFIG } from '../../src/codex/codex-runtime'
import { AsyncQueue } from '../../src/internal/async-queue'
import { CODEX_PROTOCOL_VERSION } from '../../src/codex/protocol-version'
import { threadStartResponse, turnStartResponse } from '../fixtures/codex-protocol'

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

/** A transport factory that reports the configured provider home in its initialize response. */
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

export {
  adopt,
  collect,
  commandParams,
  EVERY_THREAD_OVERLAY,
  FakeTransport,
  firstOfType,
  has,
  inTurn,
  okThread,
  scopeOf,
  startCodex,
  startCodexInTurn,
}
