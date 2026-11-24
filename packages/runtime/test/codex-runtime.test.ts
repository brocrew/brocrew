import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type PermissionDecision, type RuntimeEvent } from '../src/index'
import { CodexRuntime } from '../src/codex'
import { completedTurn, turnCompletedNotification } from './fixtures/codex-protocol'
import {
  EVERY_THREAD_OVERLAY,
  FakeTransport,
  adopt,
  collect,
  firstOfType,
  has,
  okThread,
  startCodex,
  startCodexInTurn,
} from './helpers/fake-codex-transport'

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
      tool_name: 'note_it',
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

  it('uses the provider tool name when an approval question uses a template', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    aCallStarts(transport, 'call_1')
    aCallStarts(transport, 'call_2', 'note_that')
    transport.serverRequest(70, 'mcpServer/elicitation/request', {
      ...CODEX_ASKS,
      message: 'Allow this action?',
      _meta: { ...CODEX_ASKS._meta, tool_name: 'note_that' },
    })
    await vi.waitFor(has(events, (event) => event.type === 'permission_request'))
    expect(theServersCard(events, 70)).toBe(false)
    await handle.respondPermission('number:70', { outcome: 'allow' })
    expect(transport.responses[0]).toMatchObject({
      id: 70,
      result: { action: 'accept' },
    })
    await handle.close()
    await consumer
  })

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
      _meta: { ...CODEX_ASKS._meta, tool_name: 'delete_everything' },
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
      _meta: { ...CODEX_ASKS._meta, tool_name: 'note_that' },
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
      _meta: { ...CODEX_ASKS._meta, tool_name: undefined },
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
      _meta: { ...CODEX_ASKS._meta, tool_name: undefined },
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
        tool_name: 'note\u202Eit',
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
        tool_name: 'note_that',
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

  /** Codex offers Always allow through persist: always. This app keeps the rule in the home
   * before answering, then declares it with that server on the next launch. */
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
    const rule = {
      kind: 'tool',
      tool: 'note_it',
      server: 'brobot723',
      listedAs: 'mcp__brobot723__note_it',
    }
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
