import type { RuntimeEvent } from '../src/index'
import { CodexRuntime, type CodexIncoming, type CodexTransport } from '../src/codex'
import { AsyncQueue } from '../src/internal/async-queue'
import { CODEX_PROTOCOL_VERSION } from '../src/codex/protocol-version'
import {
  completedTurn,
  failedTurn,
  threadStartResponse,
  turnCompletedNotification,
  turnStartResponse,
  turnStartedNotification,
} from './fixtures/codex-protocol'
import {
  type Driver,
  collect,
  countPermissions,
  countTurns,
  decisionOf,
  latestPermissionId,
  waitUntil,
} from './conformance-claude-and-fake-drivers'

// --- Codex seam (fake transport) ---

/** The version-bearing userAgent a conformant app-server reports from `initialize` (043). */
const CONFORMANT_USER_AGENT = `brobot2/${CODEX_PROTOCOL_VERSION} (Mac OS 26.3.0; arm64) vscode/1.130.0 (brobot2; 0.0.0)`

/**
 * A FULL, protocol-valid handshake response with the prompting profile (013, made faithful in
 * 053) — built from the typed fixture so it can never drift back into a partial.
 */
const okThreadResponse = (id = 'th_1', cwd = '/tmp/x'): Record<string, unknown> =>
  threadStartResponse(id, cwd) as unknown as Record<string, unknown>

/**
 * The same handshake, ECHOING the profile the caller asked for (186).
 *
 * ⛔ **Another instance of the ticket's own class, found building the ledger.** The fixture answers
 * every `thread/start` with the PROMPTING profile whatever was requested, and the adapter checks the
 * echo (`validateApprovalProfile`, which exists because a server that quietly ignores the profile is
 * the dangerous failure). So an `auto` session could not be started on this seam at all: the double
 * refused it, in the adapter's own words, for a fault the double had. A conformant app-server
 * confirms what it was given — this does.
 */
function echoingThreadResponse(params: unknown, id = 'th_1'): Record<string, unknown> {
  const asked = (params ?? {}) as { cwd?: string; approvalPolicy?: string; sandbox?: string }
  const cwd = asked.cwd ?? '/tmp/x'
  const auto = asked.approvalPolicy === 'never'
  return threadStartResponse(id, cwd, {
    approvalPolicy: auto ? 'never' : 'on-request',
    // ⚑ 736 · R96 — the `ask` echo is the workspace-write one (the fixture's own, unchanged here).
    ...(auto ? { sandbox: { type: 'dangerFullAccess' } } : {}),
  }) as unknown as Record<string, unknown>
}

class FakeTransport implements CodexTransport {
  private readonly queue = new AsyncQueue<CodexIncoming>()
  private turnSeq = 0
  private lastTurnId = ''
  /** Every outbound request, so tests can assert on the REAL call args (056). */
  readonly requests: Array<{ method: string; params: unknown }> = []
  /**
   * Every response written back to a SERVER request (186) — what the app-server was actually told.
   *
   * Recorded rather than dropped for the same reason {@link requests} is: the ledger's currency is
   * what the provider heard, and a transport that swallows the answer makes every decision on this
   * seam look identical from the outside.
   */
  readonly responses: Array<{ id: string | number; result: unknown }> = []
  request(method: string, params?: unknown): Promise<unknown> {
    this.requests.push({ method, params })
    if (method === 'thread/start' || method === 'thread/resume') {
      return Promise.resolve(echoingThreadResponse(params))
    }
    // A conformant app-server attests the adopted CODEX_HOME (P1-H); the driver launches at /tmp/x/home.
    if (method === 'initialize')
      return Promise.resolve({ userAgent: CONFORMANT_USER_AGENT, codexHome: '/tmp/x/home' })
    if (method === 'turn/start') {
      // The AUTHORITATIVE TurnStartResponse — a FULL Turn (053), the correlation source (037,
      // fixing 036 P1-C). currentTurnId() returns this id for the driver's notifications.
      this.lastTurnId = `tn_${++this.turnSeq}`
      return Promise.resolve(turnStartResponse(this.lastTurnId))
    }
    return Promise.resolve({})
  }
  notify(): void {}
  respond(id: string | number, result: unknown): void {
    this.responses.push({ id, result })
  }
  respondError(id: string | number, code: number, message: string): void {
    this.responses.push({ id, result: { error: { code, message } } })
  }
  incoming(): AsyncIterable<CodexIncoming> {
    return this.queue
  }
  close(): void {
    this.queue.close()
  }
  notification(method: string, params: unknown): void {
    this.queue.push({ kind: 'notification', method, params })
  }
  /**
   * A server request as a CONFORMANT app-server sends it (061): the supported request shapes
   * declare `threadId`/`turnId` as required fields, so the faithful default is the active thread
   * plus the turn id bound by this fake's `turn/start` response. An explicit field overrides it.
   */
  serverRequest(id: string | number, method: string, params: unknown): void {
    const scoped =
      typeof params === 'object' && params !== null
        ? { threadId: 'th_1', turnId: this.lastTurnId, ...params }
        : params
    this.queue.push({ kind: 'request', id, method, params: scoped })
  }
  /** The provider turn id the last `turn/start` RESPONSE bound (037) — used to drive its notifications. */
  currentTurnId(): string {
    return this.lastTurnId
  }
}

/**
 * A realistic write-rejecting transport (007's explicit ask for the close path):
 * once `close()` runs, writes are DROPPED — they never reach the wire — exactly
 * as the real `SpawnCodexTransport.write()` silently returns after close. The
 * permissive `FakeTransport` masks the P1-1 decline-before-close bug because it
 * records writes even after close; this one exposes it.
 */
class StrictFakeTransport implements CodexTransport {
  readonly wire: Array<{ id: string | number; result: unknown }> = []
  readonly attempts: Array<{ id: string | number; result: unknown; afterClose: boolean }> = []
  private closed = false
  private readonly queue = new AsyncQueue<CodexIncoming>()
  private turnSeq = 0
  private lastTurnId = ''
  request(method: string): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('transport closed'))
    if (method === 'thread/start' || method === 'thread/resume') {
      return Promise.resolve(okThreadResponse())
    }
    if (method === 'initialize')
      return Promise.resolve({ userAgent: CONFORMANT_USER_AGENT, codexHome: '/tmp/x/home' })
    if (method === 'turn/start') {
      // The AUTHORITATIVE TurnStartResponse — a FULL Turn (053), the correlation source (037).
      this.lastTurnId = `tn_${++this.turnSeq}`
      return Promise.resolve(turnStartResponse(this.lastTurnId))
    }
    return Promise.resolve({})
  }
  notify(): void {}
  respond(id: string | number, result: unknown): void {
    this.attempts.push({ id, result, afterClose: this.closed })
    if (this.closed) return // dropped: never reaches the wire
    this.wire.push({ id, result })
  }
  respondError(id: string | number, code: number, message: string): void {
    const result = { error: { code, message } }
    this.attempts.push({ id, result, afterClose: this.closed })
    if (this.closed) return
    this.wire.push({ id, result })
  }
  incoming(): AsyncIterable<CodexIncoming> {
    return this.queue
  }
  close(): void {
    this.closed = true
    this.queue.close()
  }
  notification(method: string, params: unknown): void {
    this.queue.push({ kind: 'notification', method, params })
  }
  /**
   * A server request as a CONFORMANT app-server sends it (061): the supported request shapes
   * declare `threadId`/`turnId` as required fields, so the faithful default is the active thread
   * plus the turn id bound by this fake's `turn/start` response. An explicit field overrides it.
   */
  serverRequest(id: string | number, method: string, params: unknown): void {
    const scoped =
      typeof params === 'object' && params !== null
        ? { threadId: 'th_1', turnId: this.lastTurnId, ...params }
        : params
    this.queue.push({ kind: 'request', id, method, params: scoped })
  }
  /** The provider turn id the last `turn/start` RESPONSE bound (037) — used to drive its notifications. */
  currentTurnId(): string {
    return this.lastTurnId
  }
}

interface CodexCtl {
  transport: FakeTransport
}

const codexDriver: Driver = {
  provider: 'codex',
  reportsBurst: false,
  async start() {
    const transport = new FakeTransport()
    const runtime = new CodexRuntime(() => transport)
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    return { handle, events, consumer, ctl: { transport } satisfies CodexCtl }
  },
  async runTurn(ctx, outcome) {
    const ctl = ctx.ctl as CodexCtl
    const before = countTurns(ctx.events)
    await ctx.handle.send('x') // the turn/start RESPONSE binds the provider turn id (037)
    const turnId = ctl.transport.currentTurnId() // the id the response returned — drive its notifications
    ctl.transport.notification('turn/started', turnStartedNotification('th_1', turnId))
    if (outcome === 'interrupted') {
      const reqId = 1000 + before
      ctl.transport.serverRequest(reqId, 'item/commandExecution/requestApproval', { command: 'x' })
      await waitUntil(() => countPermissions(ctx.events) > 0, 'permission')
      await ctx.handle.respondPermission(latestPermissionId(ctx.events), { outcome: 'cancel' })
      // ⚑ 709 · R43 — Codex's OWN word after `{decision:'cancel'}`: `interrupted`, measured by
      // `probe:codex-approval-reason`'s cancel arm on the bundled 0.146.0. It used to plant `completed`
      // and let the latch rename it; the machine records the provider's word now.
      ctl.transport.notification(
        'turn/completed',
        turnCompletedNotification('th_1', completedTurn(turnId, { status: 'interrupted' })),
      )
    } else {
      ctl.transport.notification(
        'turn/completed',
        turnCompletedNotification(
          'th_1',
          outcome === 'failed' ? failedTurn(turnId, 'boom') : completedTurn(turnId),
        ),
      )
    }
    await waitUntil(() => countTurns(ctx.events) > before, `${outcome} turn`)
  },
  async beginActiveTurn(ctx) {
    const ctl = ctx.ctl as CodexCtl
    await ctx.handle.send('x')
    ctl.transport.notification(
      'turn/started',
      turnStartedNotification('th_1', ctl.transport.currentTurnId()),
    )
    await waitUntil(() => ctx.handle.status() === 'working', 'working')
  },
  burst(ctx) {
    const ctl = ctx.ctl as CodexCtl
    ctl.transport.notification('item/agentMessage/delta', { delta: '[MAIN] the run finished' })
  },
  injectLateTerminal(ctx) {
    const ctl = ctx.ctl as CodexCtl
    ctl.transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('late')),
    )
    ctl.transport.close()
  },
  async openPermission(ctx) {
    const ctl = ctx.ctl as CodexCtl
    await ctx.handle.send('x')
    ctl.transport.notification(
      'turn/started',
      turnStartedNotification('th_1', ctl.transport.currentTurnId()),
    )
    const before = countPermissions(ctx.events)
    ctl.transport.serverRequest(2000 + before, 'item/commandExecution/requestApproval', {
      command: 'x',
    })
    await waitUntil(() => countPermissions(ctx.events) > before, 'permission')
    return latestPermissionId(ctx.events)
  },
  triggerFatal(ctx) {
    ;(ctx.ctl as CodexCtl).transport.close() // stream ends → finishUnexpected → fatalError + settleAll
  },
  resumeForged() {
    // A forged/unissued Codex ref: thread/resume returns a MISMATCHED thread id → ResumeError.
    return new CodexRuntime(() => new FakeTransport()).resume(
      { provider: 'codex', sessionId: 'th_forged', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home' },
    )
  },
  ledger: {
    outcomes: {
      allow: 'ran',
      // The one seam that HAS the narrow grant: a Codex command approval offers
      // `acceptForSession`, and the app-server keeps what it covers.
      allow_for_session: 'ran',
      // ⛔ **And the one it does not offer**, because the grant 058 added is a gate THIS process
      // owns and Codex has no equivalent gate here to open (see `CodexSessionHandle.blanketGrants`).
      allow_all_for_session: 'not-offered',
      // ⚑ 736 · R95 — offered only where the PROVIDER offered its own choice that outlives the
      // conversation (a Codex prefix rule or *Always allow*, a Claude settings-file suggestion);
      // this seam's opened card carries none.
      allow_always: 'not-offered',
      deny: 'refused',
      cancel: 'refused',
    },
    wholesaleGrant:
      'the grant lives in the app-server, which reports nothing back about what it now holds — ' +
      'so this app has no gate to consult and `blanketGrants` is honestly empty (058)',
    unattended:
      'the approval profile rides on `turn/start`, so the SERVER does the not-asking and there is ' +
      'no card for this adapter to suppress (034, measured on the live app-server)',
    gaps: {
      isRetiring:
        'Codex has no adapter-initiated closing interval before a terminal status; host-initiated closes carry the host closing state',
      refreshManagedPlugins:
        'Codex has no per-thread MCP configuration update; the managed wrapper reopens between turns',
      builtInSkillsConfirmed: 'Codex does not use the Claude SDK skill catalogue confirmation',
      // ⚑ **722 · a gap by design**: the thread id is in `thread/start`'s own answer, so a Codex
      // launch has its ref before `start()` resolves and there is no window for this to cover.
      launchedAs:
        'the ref is known the instant `start()` resolves — there is no pre-init window (722)',
      // ⚑ **708 · a gap by design, and the host never asks it.** `R42` is about `/` commands, and
      // Codex publishes `$` skills (`279`) — so no `/` word can be one, whatever `skills/list`
      // answers, and `PROVIDER_COMMAND_PREFIX` lets the host know that without asking.
      providerCommands:
        'Codex has no `/` commands to ask about — its list is `$` skills, published at thread ' +
        'start and on `skills/changed` (279, 708)',
      // ⛔ **`stopBackgroundWork` LEFT this list in 275**, and `backgroundWork` stayed for a reason
      // that is now measured rather than deferred. `smoke/codex-background-probe.smoke.ts` ran three
      // live threads against the bundled 0.146.0 binary: a long command is detached by Codex ITSELF
      // — `turn/completed` at 4 009 ms over a 400-second `sleep`, with no `item/completed` ever — so
      // there is no moment at which a user could ask for a detachment that has not already happened.
      // A `backgroundWork()` here would be a control with nothing to control, which is 235's finding
      // and worse than an honest absence.
      backgroundWork:
        'Codex detaches a long command by itself — measured: the turn completed 4 s into a 400 s ' +
        'command — so there is no "detach this" gesture for an adapter to offer (275 §2)',
      // A gap by design: nothing more needs asking to tell one Codex account from another.
      account:
        'its sign-in tag is already of its account, which a renewal keeps, so a reading is told ' +
        'from another account’s by that',
    },
  },
  async tell(ctx, id, outcome) {
    const ctl = ctx.ctl as CodexCtl
    const before = ctl.transport.responses.length
    await ctx.handle.respondPermission(id, decisionOf(outcome))
    await waitUntil(
      () => ctl.transport.responses.length > before,
      `the ${outcome} response on the wire`,
    )
    const sent = ctl.transport.responses.at(-1)?.result as { decision?: string } | undefined
    return sent?.decision === 'accept' || sent?.decision === 'acceptForSession' ? 'ran' : 'refused'
  },
  asksAgainAfterWholesaleGrant() {
    // Never called: the ledger declares this seam holds no such gate, and the enforcement below
    // asserts the declaration from the other side instead (`blanketGrants` stays empty).
    return Promise.reject(new Error('codex holds no app-side session grant'))
  },
  async unattended() {
    const transport = new FakeTransport()
    const handle = await new CodexRuntime(() => transport).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
      approvalMode: 'auto',
    })
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    await handle.send('run unattended')
    const started = transport.requests.find((request) => request.method === 'turn/start')
    const proof = { cards: countPermissions(events), ran: false, wire: started?.params }
    await handle.close()
    await consumer
    return proof
  },
  runtimeUnderTest: () => new CodexRuntime(() => new FakeTransport()),
}

export { FakeTransport, StrictFakeTransport, codexDriver }
