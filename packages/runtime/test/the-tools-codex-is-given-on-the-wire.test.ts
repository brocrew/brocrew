import { describe, expect, it, vi } from 'vitest'
import { type RuntimeEvent } from '../src/index'
import { CodexRuntime } from '../src/codex'
import { z } from 'zod'
import type { AgentToolset } from '../src/agent-tools'
import { completedTurn, turnCompletedNotification } from './fixtures/codex-protocol'
import {
  FakeTransport,
  adopt,
  collect,
  firstOfType,
  has,
  okThread,
  inTurn,
} from './helpers/fake-codex-transport'

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

  it('thread/start declares current MCP tools, and no toolset declares no server', async () => {
    const withTools = await inTurn(tools().set)
    const config = started(withTools.transport)?.['config'] as {
      mcp_servers: Record<string, unknown>
    }
    expect(config.mcp_servers).toHaveProperty('brobot')
    expect(started(withTools.transport)).not.toHaveProperty('dynamicTools')
    await withTools.handle.close()

    // ⚠️ The paired negative — an absent toolset must not become an empty declaration, which would
    // put a catalogue in the child's prompt that lists nothing.
    const without = await inTurn(undefined)
    expect(started(without.transport)).not.toHaveProperty('dynamicTools')
    expect(started(without.transport)?.['config']).not.toHaveProperty('mcp_servers.brobot')
    await without.handle.close()
  })

  // This event records the current declaration, separately from native discovery.
  it('⛔ publishes what was DECLARED and says the provider reports nothing', async () => {
    const { transport, handle, events } = await inTurn(tools().set)
    await vi.waitFor(() => expect(events.some((e) => e.type === 'tool_inventory')).toBe(true))
    const event = events.find((e) => e.type === 'tool_inventory')
    expect(event?.published, 'the declaration is not a discovery receipt').toBeNull()
    expect(event?.declared?.server).toBe('brobot')
    expect(event?.declared?.tools.map((tool) => tool.name)).toEqual([
      'spawn_agent',
      'reply_to_parent',
    ])
    expect(event?.declared?.tools[0]?.parameters).toEqual([
      { name: 'profile_slug', type: 'string', required: true },
    ])
    expect(event?.naming).toEqual({ prefix: 'mcp__', separator: '__' })
    expect(event?.source).toBe('thread/start')
    expect((started(transport)?.['config'] as { mcp_servers: object }).mcp_servers).toHaveProperty(
      'brobot',
    )
    expect(started(transport)).not.toHaveProperty('dynamicTools')
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

  it('thread/resume supplies current MCP tools without replacing legacy dynamic state', async () => {
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
    expect((resumed as { config: { mcp_servers: object } }).config.mcp_servers).toHaveProperty(
      'brobot',
    )
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

  it.each([
    [
      'give_work',
      {
        profile: 'worker',
        to: 'new',
        conversation_title: 'New work',
        title: 'Task',
        brief: 'Work',
        definition_of_done: 'Done',
      },
    ],
    [
      'give_work',
      { profile: 'worker', to: 'W1.2', title: 'Task', brief: 'Work', definition_of_done: 'Done' },
    ],
    ['interrupt_agent', { agent: 'W1.2', reason: 'Pause this work' }],
    ['message_agent', { agent: 'W1.2', text: 'Stop and read this', interrupt: true }],
    ['message_agent', { agent: 'W1.2', text: 'A note' }],
    ['message_agent', { agent: 'W1.2', text: 'A note', interrupt: 'true' }],
  ] as const)('in ask, %s with %j reaches its handler without an app card', async (name, args) => {
    const call = vi.fn(async () => ({ text: 'handled' }))
    const { transport, handle, events } = await inTurn(
      {
        server: 'brobot',
        tools: [
          {
            name,
            description: 'Coordinate work in this app.',
            input: {},
            beyondItsRails:
              name === 'give_work'
                ? 'it-starts-something-outside-this-app'
                : name === 'interrupt_agent'
                  ? 'it-destroys-work-in-flight'
                  : 'nothing-its-rails-do-not-cover',
            ...(name === 'message_agent' && {
              beyondItsRailsWhen: (input: Record<string, unknown>) =>
                input['interrupt'] === true
                  ? 'it-destroys-work-in-flight'
                  : 'nothing-its-rails-do-not-cover',
            }),
            call,
          },
        ],
      },
      'ask',
    )
    transport.serverRequest(7, 'item/tool/call', {
      callId: 'coordination',
      namespace: 'brobot',
      tool: name,
      arguments: args,
    })
    await vi.waitFor(() => expect(call).toHaveBeenCalledExactlyOnceWith(args))
    expect(events.filter((event) => event.type === 'permission_request')).toEqual([])
    await vi.waitFor(() => expect(transport.responses).toHaveLength(1))
    expect(transport.responses[0]!.result).toMatchObject({ success: true })
    await handle.close()
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
