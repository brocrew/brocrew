import { describe, expect, it, vi } from 'vitest'
import { ClaudeRuntime, runtimeEventSchema, type RuntimeEvent } from '../src/index'
import { AsyncQueue } from '../src/internal/async-queue'
import { endsOpenSubAgents, OpenSubAgents } from '../src/internal/open-sub-agents'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { TheCliAnswersInOrder } from './the-cli-answers-in-order'

/**
 * **A sub-agent card cannot outlive its turn IN THE STREAM** (075, from 072 §5.1).
 *
 * ⚠️ **What was actually wrong is narrower than it was reported, and the correction matters.** 072
 * saw `smoke:claude` §3.1d red twice with the phases `[started, progress]`, grepped
 * `packages/runtime` and `apps/desktop`, found no turn-end closer and concluded the card *"stays
 * open forever — in the UI, in the ledger, and on replay."*
 *
 * The grep missed `apps/desktop/src/renderer/src/lib/transcript.ts:stopRunningSubAgents`, which the
 * fold calls on every terminal `turn` and again on replay. **Nobody has ever seen a spinner that
 * outlived its turn.** What is real is one layer down: the STREAM — and therefore the ledger, the
 * export and the archive — recorded a sub-agent that started and never ended, and `smoke:claude`
 * §3.1d asserts on the adapter's own events, so it was correct to fail. Three comments already
 * described the mechanism that did not exist; the renderer's fold is what made the screen look
 * right, so the lie was in the record rather than in front of anyone.
 *
 * These tests are on the adapters for that reason: the fold has always been fine, and asserting
 * there would go green without the fix.
 */

const started = (taskId: string, kind = 'Explore'): SDKMessage =>
  ({
    type: 'system',
    subtype: 'task_started',
    task_id: taskId,
    subagent_type: kind,
    description: 'map the thing',
  }) as unknown as SDKMessage

/** The PATCH with no terminal status — the message that leaves the card open (029/035). */
const patched = (taskId: string): SDKMessage =>
  ({
    type: 'system',
    subtype: 'task_updated',
    task_id: taskId,
    patch: { progress: 0.5 },
  }) as unknown as SDKMessage

class FakeQuery {
  private readonly messages = new AsyncQueue<SDKMessage>()
  emit(message: SDKMessage): void {
    this.messages.push(message)
  }
  end(): void {
    this.messages.close()
  }
  async interrupt(): Promise<void> {}
  async setPermissionMode(): Promise<void> {}
  close(): void {
    this.messages.close()
  }
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.cli.over(this.messages[Symbol.asyncIterator]())
  }
  /** ⚑ **F080** — results name the message they answer, as the CLI's do. */
  readonly cli = new TheCliAnswersInOrder()
}

const cards = (events: RuntimeEvent[]): Extract<RuntimeEvent, { type: 'sub_agent' }>[] =>
  events.filter((e): e is Extract<RuntimeEvent, { type: 'sub_agent' }> => e.type === 'sub_agent')

describe('OpenSubAgents — which cards are owed an ending', () => {
  it('opens on any phase that is not an ending, and forgets one the provider closed itself', () => {
    const open = new OpenSubAgents()
    open.note({ type: 'sub_agent', phase: 'started', agentId: 'a' })
    // `progress` opens one too: a session joined mid-flight (`SubAgentTasks.join`) never sees a
    // start, and a card the app is showing is a card it owes an ending.
    open.note({ type: 'sub_agent', phase: 'progress', agentId: 'b' })
    expect(open.size).toBe(2)

    open.note({ type: 'sub_agent', phase: 'ended', agentId: 'a' })
    expect(open.size).toBe(1)
    expect(open.closeAll()).toEqual([{ type: 'sub_agent', phase: 'ended', agentId: 'b' }])
    // Handed over, so a second boundary in the same turn cannot end the same card twice.
    expect(open.closeAll()).toEqual([])
  })

  it('costs nothing when the provider reported its own endings', () => {
    // The ordinary case, and the reason this is safe to run on every boundary rather than only the
    // suspicious ones: Codex normally ends its cards on the child's `idle` before the parent turn.
    const open = new OpenSubAgents()
    open.note({ type: 'sub_agent', phase: 'started', agentId: 'a' })
    open.note({ type: 'sub_agent', phase: 'ended', agentId: 'a', outcome: 'completed' })
    expect(open.closeAll()).toEqual([])
  })

  it('treats the session ending as a boundary too, because a mid-turn close emits no terminal turn', () => {
    // `SessionMachine.closeSession` clears its turn and emits NO `turn` — it goes straight to
    // `status:'ended'`. A `turn`-only check would let a card opened by that turn through.
    expect(endsOpenSubAgents({ type: 'turn', state: 'completed' })).toBe(true)
    expect(endsOpenSubAgents({ type: 'turn', state: 'interrupted' })).toBe(true)
    expect(endsOpenSubAgents({ type: 'status', state: 'ended' })).toBe(true)
    expect(endsOpenSubAgents({ type: 'status', state: 'errored' })).toBe(true)
    // …and nothing else, or a card would be closed while its agent is still working.
    expect(endsOpenSubAgents({ type: 'status', state: 'working' })).toBe(false)
    expect(endsOpenSubAgents({ type: 'status', state: 'waiting_permission' })).toBe(false)
    expect(endsOpenSubAgents({ type: 'status', state: 'idle' })).toBe(false)
  })
})

describe('the Claude adapter closes a card the provider never closed (075)', () => {
  async function session(): Promise<{
    fq: FakeQuery
    handle: Awaited<ReturnType<ClaudeRuntime['start']>>
    events: RuntimeEvent[]
    consumer: Promise<void>
  }> {
    const fq = new FakeQuery()
    const runtime = new ClaudeRuntime(
      (params) => {
        fq.cli.listen(params.prompt)
        return fq as never
      },
      async () => true,
    )
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    const events: RuntimeEvent[] = []
    const consumer = (async () => {
      for await (const event of handle.events()) events.push(event)
    })()
    return { fq, handle, events, consumer }
  }

  it('ends the card when the turn ends, and puts the ending BEFORE the turn', async () => {
    const { fq, handle, events, consumer } = await session()
    await handle.send('go')
    fq.emit({ type: 'system', subtype: 'init', session_id: 'sess_1', cwd: '/tmp/x' } as never)
    fq.emit(started('task_1'))
    // The exact message 072 measured: a patch with no terminal status. `normalize.ts` drops it to
    // chatter on purpose — a non-terminal patch must not close a card — which is what left the
    // sub-agent with no ending at all when no `task_notification` followed.
    fq.emit(patched('task_1'))
    fq.emit({ type: 'result', subtype: 'success', is_error: false } as never)

    await vi.waitFor(() => expect(events.some((e) => e.type === 'turn')).toBe(true))

    expect(cards(events).map((e) => e.phase)).toEqual(['started', 'ended'])
    // ⚠️ **Order, not just presence.** The other way round the ledger reads "the turn ended, and
    // then a sub-agent stopped", which is a different sentence — and on replay the fold would apply
    // the ending to a turn that had already closed the card.
    const ended = events.findIndex((e) => e.type === 'sub_agent' && e.phase === 'ended')
    const turn = events.findIndex((e) => e.type === 'turn')
    expect(ended).toBeGreaterThan(-1)
    expect(ended).toBeLessThan(turn)

    // No OUTCOME, and that is the point rather than an omission: "we never saw it end" is a
    // different fact from success, and `SubAgentEntry.vue` renders it as itself.
    const closing = cards(events).at(-1)
    expect(closing?.outcome).toBeUndefined()
    expect(closing?.summary).toBeUndefined()
    for (const event of events) expect(runtimeEventSchema.parse(event)).toBeTruthy()

    await handle.close()
    fq.end()
    await consumer
  })

  it('leaves a card the provider DID close exactly as the provider left it', async () => {
    // The guard against over-reach: a real ending carries an outcome and a summary, and a
    // turn-end closer that fired anyway would either duplicate the row or bury the outcome.
    const { fq, handle, events, consumer } = await session()
    await handle.send('go')
    fq.emit({ type: 'system', subtype: 'init', session_id: 'sess_1', cwd: '/tmp/x' } as never)
    fq.emit(started('task_1'))
    fq.emit({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'task_1',
      status: 'completed',
      summary: 'the child answered',
    } as never)
    fq.emit({ type: 'result', subtype: 'success', is_error: false } as never)

    await vi.waitFor(() => expect(events.some((e) => e.type === 'turn')).toBe(true))

    expect(cards(events).map((e) => e.phase)).toEqual(['started', 'ended'])
    expect(cards(events).at(-1)?.outcome).toBe('completed')
    expect(cards(events).at(-1)?.summary).toBe('the child answered')

    await handle.close()
    fq.end()
    await consumer
  })

  it('closes a card left open when the SESSION ends mid-turn, which emits no terminal turn', async () => {
    const { fq, handle, events, consumer } = await session()
    await handle.send('go')
    fq.emit({ type: 'system', subtype: 'init', session_id: 'sess_1', cwd: '/tmp/x' } as never)
    fq.emit(started('task_1'))
    // The stream is consumed asynchronously and `close()` drops everything after it, so the card
    // has to be ON before the close — otherwise this measures a message that never arrived.
    await vi.waitFor(() => expect(cards(events)).toHaveLength(1))

    // Closed with the turn still running. `SessionMachine.closeSession` nulls its turn WITHOUT
    // emitting one, so the only boundary this card ever gets is `status:'ended'`.
    await handle.close()
    fq.end()
    await consumer

    expect(cards(events).map((e) => e.phase)).toEqual(['started', 'ended'])
    const ended = events.findIndex((e) => e.type === 'sub_agent' && e.phase === 'ended')
    const terminal = events.findIndex((e) => e.type === 'status' && e.state === 'ended')
    expect(ended).toBeLessThan(terminal)
  })
})

/**
 * 🔴 **695 · R35 — a BACKGROUNDED agent is the one card that does outlive its turn.**
 *
 * ⚑ It was dispatched with `run_in_background`, its tool call returned at once, and the turn that
 * dispatched it ends while it works — and since `695` declared `perTaskStopAffordance` it outlives an
 * INTERRUPTED turn too. `probe:per-task-stop` measured the closer above writing `sub_agent ended`
 * for an agent that was still in the background level, still running, and still stoppable from the
 * bar beside the card. ⛔ The provider reports its ending (`task_notification`); the session
 * boundary still closes it, because the child's exit takes every task with it.
 */
describe('695 · R35 — a card whose agent is still running in the background is not ended by its turn', () => {
  const level = (ids: string[]): RuntimeEvent => ({
    type: 'background_work',
    running: ids.map((id) => ({ id, kind: 'local_agent' })),
    source: 'background_tasks_changed',
  })

  it('a turn spares a backgrounded card; the session boundary does not', () => {
    const open = new OpenSubAgents()
    open.note({ type: 'sub_agent', phase: 'started', agentId: 'bg' })
    open.note({ type: 'sub_agent', phase: 'started', agentId: 'fg' })
    open.note(level(['bg']))
    // ⚑ The control is in the same call: the foreground card IS closed by the same boundary.
    expect(open.closeAll({ type: 'turn', state: 'interrupted' })).toEqual([
      { type: 'sub_agent', phase: 'ended', agentId: 'fg' },
    ])
    expect(open.size).toBe(1)
    expect(open.closeAll({ type: 'status', state: 'ended' })).toEqual([
      { type: 'sub_agent', phase: 'ended', agentId: 'bg' },
    ])
  })

  it('the level is REPLACE-all: an agent that has left it is closed by the next turn', () => {
    const open = new OpenSubAgents()
    open.note({ type: 'sub_agent', phase: 'started', agentId: 'bg' })
    open.note(level(['bg']))
    expect(open.closeAll({ type: 'turn', state: 'completed' })).toEqual([])
    open.note(level([]))
    expect(open.closeAll({ type: 'turn', state: 'completed' })).toEqual([
      { type: 'sub_agent', phase: 'ended', agentId: 'bg' },
    ])
  })

  it('no boundary named — Codex’s call — closes every card, as before', () => {
    const open = new OpenSubAgents()
    open.note({ type: 'sub_agent', phase: 'started', agentId: 'bg' })
    open.note(level(['bg']))
    expect(open.closeAll()).toEqual([{ type: 'sub_agent', phase: 'ended', agentId: 'bg' }])
  })

  it('through the adapter: an interrupted turn leaves the backgrounded card open, and the close ends it', async () => {
    const fq = new FakeQuery()
    const runtime = new ClaudeRuntime(
      (params) => {
        fq.cli.listen(params.prompt)
        return fq as never
      },
      async () => true,
    )
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    const events: RuntimeEvent[] = []
    const consumer = (async () => {
      for await (const event of handle.events()) events.push(event)
    })()
    await handle.send('go')
    fq.emit({ type: 'system', subtype: 'init', session_id: 'sess_1', cwd: '/tmp/x' } as never)
    fq.emit(started('task_bg', 'general-purpose'))
    fq.emit({
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks: [{ task_id: 'task_bg', task_type: 'local_agent', description: 'map the thing' }],
      session_id: 'sess_1',
    } as never)
    fq.emit({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      terminal_reason: 'aborted_streaming',
    } as never)
    await vi.waitFor(() => expect(events.some((e) => e.type === 'turn')).toBe(true))
    const turn = events.findIndex((e) => e.type === 'turn')
    expect(
      events.slice(0, turn + 1).some((e) => e.type === 'sub_agent' && e.phase === 'ended'),
      'the turn ended a card whose agent the level still lists',
    ).toBe(false)

    await handle.close()
    fq.end()
    await consumer
    expect(cards(events).map((e) => e.phase)).toEqual(['started', 'ended'])
  })
})
