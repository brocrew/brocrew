import { describe, expect, it, vi } from 'vitest'
import { type RuntimeEvent } from '../src/index'
import { has, startCodexInTurn } from './helpers/fake-codex-transport'

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
