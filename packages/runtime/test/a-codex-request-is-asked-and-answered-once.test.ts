import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { type RuntimeEvent, type SessionHandle, type StartPhaseSink } from '../src/index'
import { CodexRuntime, CodexSessionHandle } from '../src/codex'
import type { ServerRequestResolvedNotification } from '../src/codex/protocol/v2/ServerRequestResolvedNotification'
import {
  completedTurn,
  turnCompletedNotification,
  turnStartedNotification,
} from './fixtures/codex-protocol'
import {
  FakeTransport,
  adopt,
  collect,
  firstOfType,
  has,
  okThread,
  startCodex,
  startCodexInTurn,
} from './helpers/fake-codex-transport'

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
    it.each([0, 5 * 60_000])('registers built-in skills after %i ms of silence', async (ms) => {
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
      const listed = {
        data: [
          { cwd, errors: [], skills: skills.skills.map((one) => ({ ...one, enabled: true })) },
        ],
      }
      transport.onRequest(
        'skills/list',
        () => new Promise((answer) => setTimeout(() => answer(listed), ms)),
      )
      vi.useFakeTimers()
      const starting = runtime.start({
        cwd,
        providerHome: join(cwd, 'home'),
        builtInSkills: skills,
        startPhases: (phase) => said.push(phase),
      })
      const [handle] = await Promise.all([starting, vi.advanceTimersByTimeAsync(ms)])
      vi.useRealTimers()
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
