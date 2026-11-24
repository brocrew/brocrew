import { describe, expect, it, vi } from 'vitest'
import { type RuntimeEvent, type SessionHandle, TurnInProgress } from '../src/index'
import { CodexRuntime } from '../src/codex'
import { A_COMPACTION_IS_STILL_OUTSTANDING } from '../src/codex/codex-runtime'
import {
  completedTurn,
  malformedTurnStartResponse,
  turnCompletedNotification,
  turnStartedNotification,
} from './fixtures/codex-protocol'
import {
  FakeTransport,
  adopt,
  collect,
  has,
  okThread,
  startCodex,
  startCodexInTurn,
} from './helpers/fake-codex-transport'

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
