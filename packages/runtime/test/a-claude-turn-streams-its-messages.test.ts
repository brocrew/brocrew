import { readFileSync } from 'node:fs'
import type { CanUseTool, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it, vi } from 'vitest'
import { type AgentToolset, type RuntimeEvent } from '../src/index'
import { ClaudeRuntime } from '../src/claude'
import { FakeQuery, init, collect, firstOfType, has, startFake } from './fake-claude-query'

describe('ClaudeRuntime internal message receipts', () => {
  const act = 'message_act_00000000-0000-4000-8000-000000000001'
  const messageTools: AgentToolset = {
    server: 'brobot',
    tools: [
      {
        name: 'message_agent',
        description: 'Deliver a note.',
        input: {},
        beyondItsRails: 'nothing-its-rails-do-not-cover',
        call: async () => ({
          text: 'Done.',
          structured: {
            outcome: 'ok',
            delivery: 'sent',
            kind: 'note',
            agent: 'receiver',
            messageAct: act,
          },
        }),
      },
    ],
  }
  const use = (id: string, name = 'mcp__brobot__message_agent', parent: string | null = null) => ({
    type: 'assistant',
    parent_tool_use_id: parent,
    message: { content: [{ type: 'tool_use', id, name, input: {} }] },
  })

  it('the query owns its actual registered message answer across a parent result and rejects a foreign legacy receipt', async () => {
    const { fq, handle, events, consumer, sdkOptions } = await startFake({
      agentTools: messageTools,
    })
    try {
      fq.emit(init('sess_1', '/tmp/x'))
      await vi.waitFor(has(events, (event) => event.type === 'session'))
      const server = sdkOptions().mcpServers?.brobot as unknown as {
        instance: {
          _registeredTools: Record<
            string,
            { handler(args: unknown, extra: unknown): Promise<unknown> }
          >
        }
      }
      const raw = (await server.instance._registeredTools.message_agent!.handler({}, {})) as {
        content: unknown[]
        _meta?: unknown
      }
      expect(raw.content).toEqual([{ type: 'text', text: 'Done.' }])
      fq.emit(use('owned', 'mcp__brobot__message_agent', 'parent'))
      fq.emit(use('foreign', 'mcp__other__message_agent'))
      fq.emit({
        type: 'result',
        subtype: 'success',
        session_id: 'sess_1',
        result: 'parent ended',
        is_error: false,
      })
      fq.emit({
        type: 'user',
        parent_tool_use_id: 'parent',
        tool_use_result: raw,
        message: { content: [{ type: 'tool_result', tool_use_id: 'owned', content: raw.content }] },
      })
      fq.emit({
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'foreign',
              content: [
                { type: 'text', text: 'Done.' },
                {
                  type: 'text',
                  text: JSON.stringify({
                    outcome: 'ok',
                    delivery: 'sent',
                    kind: 'note',
                    agent: 'receiver',
                    messageAct: act,
                  }),
                },
              ],
            },
          ],
        },
      })
      await vi.waitFor(() =>
        expect(events.filter((event) => event.type === 'tool_result')).toHaveLength(2),
      )
      expect(events.filter((event) => event.type === 'tool_result')[0]).toMatchObject({
        id: 'owned',
        messageAct: act,
        parentToolCallId: 'parent',
      })
      expect(events.filter((event) => event.type === 'tool_result')[1]).not.toHaveProperty(
        'messageAct',
      )
    } finally {
      await handle.close()
      fq.end()
      await consumer
    }
  })
})

describe('ClaudeRuntime — message flow', () => {
  it('session + ref become available on the first turn init (null before)', async () => {
    const { fq, handle, events, consumer } = await startFake()
    expect(handle.ref).toBeNull() // no validated ref until the first-turn init (011)
    fq.emit(init('sess_1', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'session'))
    expect(firstOfType(events, 'session').state).toBe('started')
    expect(handle.ref).toEqual({
      provider: 'claude',
      sessionId: 'sess_1',
      cwd: '/tmp/x',
      rotation: 0,
    })
    await handle.close()
    fq.end()
    await consumer
  })

  it('result → turn+idle, never session:ended; close emits exactly one session:ended', async () => {
    const { fq, handle, events, consumer } = await startFake()
    fq.emit(init('sess_1', '/tmp/x'))
    await handle.send('hi')
    fq.emit({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    })
    fq.emit({ type: 'result', subtype: 'success', is_error: false })
    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.state === 'completed'))
    expect(events.some((e) => e.type === 'session' && e.state === 'ended')).toBe(false)

    await handle.close()
    fq.end()
    await consumer
    expect(events.filter((e) => e.type === 'session' && e.state === 'ended')).toHaveLength(1)
    expect(handle.status()).toBe('ended')
  })

  /**
   * **The identity half of 199 (192 H5), at the adapter.**
   *
   * The defect: the pinned SDK emits `conversation_reset` on `/clear`, plan-mode exit and its
   * fresh-session flows and tells the surface to mount a fresh transcript under
   * `new_conversation_id` — and this app read that field with nothing at all. `handle.ref` went on
   * naming the pre-reset conversation, so everything downstream of it did too: the row a resume
   * reopens from, the archive sweep's copy, and the `session:'ended'` the close announces.
   */
  describe('a conversation reset moves the ref (199)', () => {
    const reset = (newId: string) => ({
      type: 'conversation_reset',
      new_conversation_id: newId,
      session_id: 'sess_1',
      uuid: 'u1',
    })

    /**
     * 🔴 **721 · R75 — the ref follows the TRANSCRIPT: the next init's id, never
     * `new_conversation_id`.** ⚑ Measured (`probe:claude-resume-after-cd`, `715`, CLI 2.1.281 and
     * 2.1.218): a `/clear` sends `conversation_reset{new_conversation_id: R}` and then, adjacent,
     * `system/init` naming a THIRD id B — and R has no transcript on disk (resuming it: *"session not
     * found"*), while B does and reopens. ⛔ **This test used to plant the reset ALONE and expect R**:
     * `199`'s reading of the SDK's *"mount a fresh transcript under new_conversation_id"*, which the
     * measurement contradicts.
     */
    it('🔴 721 · R75 — follows the init AFTER the reset, not the id the reset named', async () => {
      const { fq, handle, events, consumer } = await startFake()
      fq.emit(init('sess_1', '/tmp/x'))
      await vi.waitFor(has(events, (e) => e.type === 'session'))

      // The measured order: the reset, then — adjacent — the init naming the conversation that has
      // a transcript.
      fq.emit(reset('sess_2'))
      fq.emit(init('sess_3', '/tmp/x'))
      await vi.waitFor(has(events, (e) => e.type === 'conversation_reset'))

      // The event says where the conversation went…
      expect(events.filter((e) => e.type === 'conversation_reset')).toEqual([
        {
          type: 'conversation_reset',
          ref: { provider: 'claude', sessionId: 'sess_3', cwd: '/tmp/x', rotation: 0 },
          source: 'conversation_reset + system/init',
        },
      ])
      // …and the handle — which is what the host archives, hands over and persists from — agrees.
      expect(handle.ref).toEqual({
        provider: 'claude',
        sessionId: 'sess_3',
        cwd: '/tmp/x',
        rotation: 0,
      })
      // ⛔ It is NOT a second opening. The session announced itself once and still has.
      expect(events.filter((e) => e.type === 'session')).toHaveLength(1)

      await handle.close()
      fq.end()
      await consumer
      // …and the ending names the conversation the provider was actually in.
      const ended = events.filter((e) => e.type === 'session' && e.state === 'ended')
      expect(ended).toHaveLength(1)
      expect(ended[0]).toMatchObject({ ref: { sessionId: 'sess_3' } })
    })

    it('🔴 721 · R75 — …and keeps the LAUNCH cwd when that init names the folder the model moved to', async () => {
      const { fq, handle, events, consumer } = await startFake()
      fq.emit(init('sess_1', '/tmp/x'))
      await vi.waitFor(has(events, (e) => e.type === 'session'))
      fq.emit(reset('sess_2'))
      fq.emit(init('sess_3', '/tmp/x/findings'))
      await vi.waitFor(has(events, (e) => e.type === 'conversation_reset'))
      // ⚑ R64: the ref keeps the launch cwd — where the provider keeps the transcript.
      expect(handle.ref).toEqual({
        provider: 'claude',
        sessionId: 'sess_3',
        cwd: '/tmp/x',
        rotation: 0,
      })
      await handle.close()
      fq.end()
      await consumer
    })

    it('🔴 721 · R75 — the reset’s OWN id names nothing: a reset with no init after it moves no ref', async () => {
      const { fq, handle, events, consumer } = await startFake()
      fq.emit(init('sess_1', '/tmp/x'))
      await vi.waitFor(has(events, (e) => e.type === 'session'))
      fq.emit(reset('sess_2'))
      // ⚠️ Fenced on THIS frame's payload: the reset's own `unknown{lifecycle}` also has a `raw`, and
      // a fence on any raw passed before the frames under test were read (721 M5 SURVIVED on it).
      fq.emit({ type: 'weird_internal', payload: 721 })
      await vi.waitFor(
        has(events, (e) => e.type === 'unknown' && JSON.stringify(e.raw).includes('721')),
      )
      // ⛔ On `main` this moved to `sess_2` — a conversation with no transcript, which no resume opens.
      expect(events.some((e) => e.type === 'conversation_reset')).toBe(false)
      expect(handle.ref).toMatchObject({ sessionId: 'sess_1' })
      await handle.close()
      fq.end()
      await consumer
    })

    it('🔴 721 · R75 — one reset moves the ref ONCE: a later init after that is R64’s, and moves nothing', async () => {
      const { fq, handle, events, consumer } = await startFake()
      fq.emit(init('sess_1', '/tmp/x'))
      await vi.waitFor(has(events, (e) => e.type === 'session'))
      fq.emit(reset('sess_2'))
      fq.emit(init('sess_3', '/tmp/x'))
      fq.emit(init('sess_4', '/tmp/x'))
      fq.emit({ type: 'weird_internal', payload: 722 })
      await vi.waitFor(
        has(events, (e) => e.type === 'unknown' && JSON.stringify(e.raw).includes('722')),
      )
      expect(events.filter((e) => e.type === 'conversation_reset')).toHaveLength(1)
      expect(handle.ref).toMatchObject({ sessionId: 'sess_3' })
      await handle.close()
      fq.end()
      await consumer
    })

    /**
     * ⛔ **What `session-machine.ts:239-241`'s early return protects, asserted rather than
     * described** — because 199 had to move the ref without weakening it.
     *
     * `sessionStarted` begins `if (this.isTerminal || this._state === 'active') return`, and that
     * is two guarantees in one line: a TERMINAL session never returns to `active` and never
     * publishes another opening, and an ACTIVE session announces its opening EXACTLY ONCE — so a
     * second `system/init` restates no `started`, re-runs no `sync()` (which would republish a
     * status), and redefines the session's identity through no back door.
     *
     * The reset never calls that method, so both hold unchanged: identity moves on its own event,
     * and the opening door is still the only way to become `active`.
     */
    it('…while a second `system/init` still moves nothing — the guard it did not go through', async () => {
      const { fq, handle, events, consumer } = await startFake()
      fq.emit(init('sess_1', '/tmp/x'))
      await vi.waitFor(has(events, (e) => e.type === 'session'))
      const statusesBefore = events.filter((e) => e.type === 'status').length

      // A second handshake, naming a DIFFERENT conversation. Only `sessionStarted` reads it, and
      // its guard drops it on the floor.
      fq.emit(init('sess_impostor', '/tmp/x'))
      fq.emit({ type: 'weird_internal', payload: 1 }) // a fence, so the wait cannot pass vacuously
      await vi.waitFor(has(events, (e) => e.type === 'unknown' && e.raw !== null))

      expect(handle.ref).toMatchObject({ sessionId: 'sess_1' })
      expect(events.filter((e) => e.type === 'session')).toHaveLength(1)
      expect(events.filter((e) => e.type === 'status')).toHaveLength(statusesBefore)

      await handle.close()
      fq.end()
      await consumer
    })

    // ⚠️ 721: under R75 a reset alone never emits, so this pins only that the FRAME itself names
    // nothing. The init after it — the half that could — is the next test's.
    it('says nothing when it arrives before the handshake — init is the only door to a first identity', async () => {
      const { fq, handle, events, consumer } = await startFake()
      expect(handle.ref).toBeNull()

      fq.emit(reset('sess_2'))
      fq.emit({ type: 'weird_internal', payload: 2 })
      await vi.waitFor(has(events, (e) => e.type === 'unknown' && e.raw !== null))

      expect(events.some((e) => e.type === 'conversation_reset')).toBe(false)
      expect(handle.ref).toBeNull()

      await handle.close()
      fq.end()
      await consumer
    })

    it('⚑ 721 · R75 — a reset before the handshake is spent on the init that opens the session: a later init moves nothing', async () => {
      const { fq, handle, events, consumer } = await startFake()
      fq.emit(reset('sess_2'))
      fq.emit(init('sess_1', '/tmp/x'))
      await vi.waitFor(has(events, (e) => e.type === 'session'))
      // ⛔ A reset left pending past the opening would hand THIS init — no reset before it — the ref.
      fq.emit(init('sess_3', '/tmp/x'))
      // ⚠️ Fenced on THIS frame's payload: the reset's own `unknown{lifecycle}` also has a `raw`, and
      // a fence on any raw passed before the frames under test were read (721 M5 SURVIVED on it).
      fq.emit({ type: 'weird_internal', payload: 721 })
      await vi.waitFor(
        has(events, (e) => e.type === 'unknown' && JSON.stringify(e.raw).includes('721')),
      )

      expect(events.some((e) => e.type === 'conversation_reset')).toBe(false)
      expect(handle.ref).toMatchObject({ sessionId: 'sess_1', cwd: '/tmp/x' })

      await handle.close()
      fq.end()
      await consumer
    })

    it('says nothing when the id has not changed — no seam, no rewrite', async () => {
      const { fq, handle, events, consumer } = await startFake()
      fq.emit(init('sess_1', '/tmp/x'))
      await vi.waitFor(has(events, (e) => e.type === 'session'))

      // ⚑ 721 · R75: the reset moves nothing by itself — the init after it is what could, so it is
      // the init that names the conversation the session is already on.
      fq.emit(reset('sess_1'))
      fq.emit(init('sess_1', '/tmp/x'))
      fq.emit({ type: 'weird_internal', payload: 3 })
      await vi.waitFor(
        has(events, (e) => e.type === 'unknown' && JSON.stringify(e.raw).includes('"payload":3')),
      )

      expect(events.some((e) => e.type === 'conversation_reset')).toBe(false)
      expect(handle.ref).toMatchObject({ sessionId: 'sess_1' })

      await handle.close()
      fq.end()
      await consumer
    })

    /**
     * ⚠️ **A property, and NOT a guard 199 added** — and the mutation table is how that is known.
     * The emit line first carried `this.machine.isTerminal ? null : …`, and the row aimed at it came
     * back GREEN: `runLoop` stops reading the moment `terminated` is set, and every path to a
     * terminal state sets it in the same synchronous block. So what holds this is the loop's own
     * check, exactly as it holds every other event — and the check that claimed to hold it is gone.
     */
    // ⚠️ 721's second review: what holds this is the CLOSED STREAM — the query is closed before
    // `terminated` is set, and nothing arrives after it (the SDK's iterator ends; this fake's queue
    // drops it) — so the adapter's own `terminated` check is not reachable from here. It pins that a
    // closed session reports nothing more; it cannot tell which of the two held it.
    it('says nothing after the session is over — the closed stream delivers nothing more', async () => {
      const { fq, handle, events, consumer } = await startFake()
      fq.emit(init('sess_1', '/tmp/x'))
      await vi.waitFor(has(events, (e) => e.type === 'session'))
      await handle.close()

      // ⚑ 721 · R75: with the init the move now comes from.
      fq.emit(reset('sess_2'))
      fq.emit(init('sess_3', '/tmp/x'))
      fq.end()
      await consumer

      expect(events.some((e) => e.type === 'conversation_reset')).toBe(false)
      expect(handle.ref).toMatchObject({ sessionId: 'sess_1' })
    })
  })

  it('unmapped SDK message → unknown card (no crash)', async () => {
    const { fq, handle, events, consumer } = await startFake()
    fq.emit({ type: 'weird_internal', payload: 1 })
    await vi.waitFor(has(events, (e) => e.type === 'unknown'))
    await handle.close()
    fq.end()
    await consumer
  })
})

describe('ClaudeRuntime — delta coalescing (007 P2-3)', () => {
  it('coalesces streamed token deltas into fewer assistant_delta events, flushed before the terminal', async () => {
    const { fq, handle, events, consumer } = await startFake()
    fq.emit(init('sess_1', '/tmp/x'))
    await handle.send('hi')
    for (const t of ['a', 'b', 'c', 'd', 'e']) {
      fq.emit({
        type: 'stream_event',
        // Protocol-shaped: `content_block_delta` REQUIRES `index` (068 — an incomplete cast fixture
        // is how a malformed frame passed for a valid one).
        event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } },
      })
    }
    fq.emit({ type: 'result', subtype: 'success', is_error: false })
    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.state === 'completed'))

    const deltas = events.filter((e) => e.type === 'assistant_delta')
    expect(deltas.length).toBeLessThan(5) // coalesced (pre-fix: one event per token = 5)
    expect(deltas.map((d) => (d.type === 'assistant_delta' ? d.text : '')).join('')).toBe('abcde') // content intact
    // the coalesced delta lands before the terminal turn (ordering preserved)
    const lastDelta = events.map((e) => e.type).lastIndexOf('assistant_delta')
    const firstTurn = events.findIndex((e) => e.type === 'turn')
    expect(lastDelta).toBeGreaterThanOrEqual(0)
    expect(lastDelta).toBeLessThan(firstTurn)

    await handle.close()
    fq.end()
    await consumer
  })
})

describe('the machine’s own announcements are not evidence about the provider (123)', () => {
  /**
   * ⛔ **The regression 123 nearly shipped, and it was worse than the bug 123 fixes.** Found in
   * review, reproduced end to end, on the most ordinary path in the app: a turn that streams text
   * and completes.
   *
   * ```
   * status:working | assistant_delta | turn:completed      …and handle.status() === 'working'
   * ```
   *
   * `completeTurn` detaches the turn before it emits the terminal (110's ordering). `emit` feeds the
   * `DeltaCoalescer`, whose contract is that buffered deltas flush BEFORE any non-delta event — so
   * emitting the `turn` re-entered `deliver`, which called `noteProviderWork` for the flushed delta,
   * which found no turn and latched a burst. `derive()` then said `working` for good, and `sync()`
   * published nothing because `working` was already out there. Nothing on the wire even hinted at
   * it; `send` refused and the queue flush waited on an `idle` that could not arrive — 122's
   * stranding, verbatim, from a new direction.
   */
  it('a turn that merely streamed text still reaches idle', async () => {
    const { fq, handle, events, consumer } = await startFake()
    fq.emit(init('sess_1', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'session'))
    await handle.send('go')
    // Buffered by the coalescer's 30ms window, so the terminal is what flushes it.
    fq.emit({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } },
    })
    fq.emit({ type: 'result', subtype: 'success', is_error: false })
    await vi.waitFor(has(events, (e) => e.type === 'turn'))

    expect(handle.status(), 'the session was left working with nothing able to retract it').toBe(
      'idle',
    )
    // …and the delta really did arrive, or this passes over a stream that never happened.
    expect(events.filter((e) => e.type === 'assistant_delta')).toHaveLength(1)
    expect(events.filter((e) => e.type === 'status').at(-1)).toMatchObject({ state: 'idle' })

    fq.end()
    await handle.close()
    await consumer
  })

  it('…and the same on the way out of a Stop pressed mid-stream', async () => {
    // The everyday shape of it: the coalescer's buffer is non-empty for essentially the whole of a
    // text stream, so a Stop pressed while text arrives almost always finds one.
    const { fq, handle, events, consumer } = await startFake()
    fq.emit(init('sess_1', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'session'))
    await handle.send('go')
    fq.emit({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } },
    })
    await handle.interrupt()
    await vi.waitFor(has(events, (e) => e.type === 'turn'))

    expect(handle.status()).toBe('idle')
    expect(
      events.filter((e) => e.type === 'turn').map((e) => (e.type === 'turn' ? e.state : '')),
    ).toEqual(['interrupted'])
    // …and the session takes another turn, which is what "usable" means (074).
    await expect(handle.send('again')).resolves.toBeUndefined()

    fq.end()
    await handle.close()
    await consumer
  })
})

describe('a burst the provider starts by itself (123)', () => {
  /**
   * The shape `probe:out-of-turn` measured on the wire: the foreground turn ends, and 18 s later a
   * background task finishes and the SDK wakes its own main agent — no `user_turn`, no turn of ours,
   * a whole agent loop, and one `result/success` at the end of it.
   */
  async function aBurst() {
    const ctx = await startFake()
    ctx.fq.emit(init('sess_1', '/tmp/x'))
    await vi.waitFor(has(ctx.events, (e) => e.type === 'session'))
    await ctx.handle.send('kick it off in the background')
    ctx.fq.emit({ type: 'result', subtype: 'success', is_error: false } as never)
    await vi.waitFor(has(ctx.events, (e) => e.type === 'turn'))
    expect(ctx.handle.status()).toBe('idle')
    return ctx
  }

  it('reads as working, and interrupt() ends it as a turn the provider started (F080)', async () => {
    const { handle, events, consumer, fq } = await aBurst()
    fq.emit({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: '[MAIN] the run finished' }] },
    })
    await vi.waitFor(has(events, (e) => e.type === 'assistant_message'))
    expect(handle.status()).toBe('working')

    await handle.interrupt()
    expect(fq.interruptCount, 'Stop never reached the provider').toBe(1)
    expect(handle.status()).toBe('idle')
    // 🔴 **F080 — two turns now**: the one the user started, and the burst, which opened as a
    // `provider_turn` and is ended by the Stop — `interrupted`, this app's word, marked. ⛔ Until
    // F080 a burst wrote no turn, and a wake had none in the ledger at all.
    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.startedBy === 'the-provider'))
    expect(events.filter((e) => e.type === 'provider_turn')).toHaveLength(1)
    expect(
      events.filter((e) => e.type === 'turn').map((e) => e.type === 'turn' && e.startedBy),
    ).toEqual([undefined, 'the-provider'])

    fq.end()
    await handle.close()
    await consumer
  })

  it("a background sub-agent's own tool call opens no burst, the main agent's still does (D-040)", async () => {
    // ⛔ F054: the sub-agent's frames carry `parent_tool_use_id`, and read by type alone they held
    // the conversation at `working` for eleven minutes over a main agent doing nothing.
    const { handle, events, consumer, fq } = await aBurst()
    fq.emit({
      type: 'assistant',
      parent_tool_use_id: 'toolu_agent',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_child', name: 'Bash', input: { command: 'ls' } }],
      },
    } as never)
    await vi.waitFor(has(events, (e) => e.type === 'tool_call'))
    expect(handle.status(), "a sub-agent's tool call made the conversation work").toBe('idle')

    // ⚑ The paired positive: the main agent's own tool call, unparented, does open one.
    fq.emit({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_main', name: 'Bash', input: { command: 'pwd' } }],
      },
    })
    await vi.waitFor(() => expect(handle.status()).toBe('working'))

    fq.end()
    await handle.close()
    await consumer
  })

  it('a replacement turn that fails before it starts still closes (123, review)', async () => {
    // ⛔ **A reviewer's bricked session, driven through the adapter that produces it.** Stop leaves a
    // debt; the replacement turn then fails inside `applyPendingSettings` before it has produced a
    // single event, and routing that failure through `completeTurn` had the debt absorb it. The turn
    // stayed open forever at `working`, the composer stayed locked, and every later send was refused
    // — the "session bricked by its own error path" this file already warns about, reached from a
    // direction 123 opened.
    const { fq, handle, events, consumer } = await startFake()
    fq.emit(init('sess_1', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'session'))
    await handle.send('go')
    await handle.interrupt() // the debt
    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.state === 'interrupted'))

    // The next turn's settings push is refused by the provider.
    fq.setModel = () => Promise.reject(new Error('refused'))
    await handle.setModel('some-model')
    await expect(handle.send('do it instead')).rejects.toThrow(/refused/)

    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.state === 'failed'))
    expect(handle.status(), 'the replacement turn was left open by its own failure').toBe('idle')
    // …and the session is usable once the provider stops refusing: the whole point of terminalizing
    // on the way out. (The model request is deliberately kept and re-applied — the user still wants
    // it — so the next send retries the same call.)
    fq.setModel = () => Promise.resolve()
    await expect(handle.send('and now this')).resolves.toBeUndefined()

    fq.end()
    await handle.close()
    await consumer
  })

  it('a burst that keeps working is not reported as stalled', async () => {
    // ⚠️ **The regression 123 would have shipped without this.** The stall watchdog is armed off
    // `status: working`, which now covers a burst — and progress used to be counted only while a
    // TURN was open, so a burst that worked steadily for two minutes read as silent by definition
    // and raised *"no activity for 120s"* over an agent that had not stopped. The watchdog measures
    // silence; this pins what counts as not-silence.
    const { handle, events, consumer, fq } = await aBurst()
    const talk = (text: string): void => {
      fq.emit({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text }] },
      })
    }

    // ⛔ **The clock is installed BEFORE the burst arms the watchdog, and a reviewer measured why.**
    // Arming first left the timer on the REAL clock: reverting `trackProgress` then meant it was
    // simply never re-armed onto the fake timeline, so the "no notice appeared" assertion below
    // passed over nothing and only the positive at the end could fail — reporting *"the notice never
    // arrived"*, which is the opposite of the regression this test documents.
    vi.useFakeTimers()
    try {
      talk('[MAIN] the run finished')
      await vi.advanceTimersByTimeAsync(0)
      expect(handle.status(), 'the burst never armed the watchdog at all').toBe('working')

      // Steadily busy across three whole windows.
      for (let i = 0; i < 3; i += 1) {
        await vi.advanceTimersByTimeAsync(90_000)
        talk(`[MAIN] still going ${i}`)
        await vi.advanceTimersByTimeAsync(0)
      }
      expect(
        events.filter((e) => e.type === 'assistant_message'),
        'the burst produced no content, so "no stall notice" would mean nothing',
      ).toHaveLength(4)
      expect(
        events.filter((e) => e.type === 'error').map((e) => (e.type === 'error' ? e.message : '')),
        'a busy burst was reported as stalled',
      ).toEqual([])

      // …and the paired positive: once it really does go quiet, the notice arrives — and its
      // closing promise, "you can interrupt", is true of a burst as of 123.
      await vi.advanceTimersByTimeAsync(130_000)
      const stall = events.find((e) => e.type === 'error')
      expect(stall && stall.type === 'error' ? stall.message : null).toMatch(
        /still working — no activity for 120s.*you can interrupt/,
      )
    } finally {
      vi.useRealTimers()
    }

    fq.end()
    await handle.close()
    await consumer
  })

  it('a silence after thinking is said as thinking, not as a stall (F145)', async () => {
    const { handle, events, consumer, fq } = await aBurst()
    vi.useFakeTimers()
    try {
      // The provider is working (it said something), and the last thing it sends is reasoning.
      fq.emit({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: '[MAIN] looking into it' }] },
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(handle.status(), 'the burst never armed the watchdog').toBe('working')
      fq.emit({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: '' },
        },
      })
      await vi.advanceTimersByTimeAsync(121_000)
      const stalls = events
        .filter((e) => e.type === 'error')
        .map((e) => (e.type === 'error' ? e.message : ''))
      expect(stalls).toEqual(['Still thinking (2 min).'])
    } finally {
      vi.useRealTimers()
    }
    fq.end()
    await handle.close()
    await consumer
  })

  it('the thinking notice is said once: it neither re-arms the watchdog nor forgets the reasoning', async () => {
    const { handle, events, consumer, fq } = await aBurst()
    vi.useFakeTimers()
    const stalls = () =>
      events.flatMap((e) =>
        e.type === 'error' ? [{ message: e.message, stall: e.stall, thinking: e.thinking }] : [],
      )
    try {
      fq.emit({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: '[MAIN] looking into it' }] },
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(handle.status(), 'the burst never armed the watchdog').toBe('working')
      fq.emit({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: '' },
        },
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
      fq.emit({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: '[MAIN] found it' }] },
      })
      await vi.advanceTimersByTimeAsync(121_000)
      expect(stalls()).toHaveLength(2)
      expect(stalls()[1]?.message).toMatch(/^still working — no activity for 120s\./)
      expect(stalls()[1]?.stall).toBe(true)
      expect(stalls()[1]?.thinking).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
    fq.end()
    await handle.close()
    await consumer
  })
})

/**
 * 🔴 **D-002 · `738` P-2 — Stop while a command runs, then send, and the stopped turn closed the new
 * one.** `smoke:claude` 3.4, red in both batches; the CLI's own transcript gave the order each time:
 * the follow-up enqueued, the stopped call's `tool_result` (`is_error`), `[Request interrupted…]`,
 * and then the new reply. Replayed here in that order, with Claude's measured `aborted_tools` result.
 */
describe('D-002 · a stopped call’s receipt lands after the replacement opened', () => {
  it('🔴 the stopped turn’s result is absorbed, and the reply lands inside its own turn', async () => {
    const stoppedInTool = (
      JSON.parse(
        readFileSync(new URL('./fixtures/claude-stopped-results.json', import.meta.url), 'utf8'),
      ) as { stoppedInTool: SDKMessage }
    ).stoppedInTool
    const { fq, handle, events, consumer } = await startFake()
    fq.emit(init('sess_1', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'session'))
    await handle.send('run the 30 s loop')
    fq.emit({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_sleeper',
            name: 'Bash',
            input: { command: 'for i in $(seq 1 30); do echo tick $i; sleep 1; done' },
          },
        ],
      },
    })
    await vi.waitFor(has(events, (e) => e.type === 'tool_call'))

    await handle.interrupt() // Stop: the turn ends here, and Claude still owes its `result`
    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.state === 'interrupted'))
    await handle.send('Reply with exactly: RESUMED-OK')
    expect(handle.status()).toBe('working')

    // ⚑ The CLI's order after the send: the stopped call's receipt, then the stopped turn's result.
    fq.emit({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            tool_use_id: 'toolu_sleeper',
            type: 'tool_result',
            content: '[Request interrupted by user for tool use]',
            is_error: true,
          },
        ],
      },
    })
    await vi.waitFor(has(events, (e) => e.type === 'tool_result'))
    fq.emit(stoppedInTool)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(
      events.filter((e) => e.type === 'turn').map((e) => (e.type === 'turn' ? e.state : '')),
      'the stopped turn’s result closed the replacement',
    ).toEqual(['interrupted'])
    expect(handle.status()).toBe('working')

    // …and the replacement's own reply and `result` close it, as its own.
    fq.emit({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'RESUMED-OK' }] },
    })
    fq.emit({ type: 'result', subtype: 'success', is_error: false } as never)
    await vi.waitFor(() =>
      expect(
        events.filter((e) => e.type === 'turn').map((e) => (e.type === 'turn' ? e.state : '')),
      ).toEqual(['interrupted', 'completed']),
    )
    expect(handle.status()).toBe('idle')
    expect(
      events.some((e) => e.type === 'error'),
      'the stopped turn’s fault was drawn',
    ).toBe(false)

    fq.end()
    await handle.close()
    await consumer
  })
})

describe('a stalled turn is visible and recoverable (074 — the live incident)', () => {
  /**
   * The observed sequence, faithfully: the model finishes its message, the stream emits
   * `message_stop`, and then the provider goes QUIET — no `result`, and the stream never ends.
   * That is not a stream error (`finishUnexpected` covers that) and not a completion-propagation
   * bug (a `result` always terminalizes); the provider simply stops.
   */
  async function stalledTurn() {
    const ctx = await startFake()
    ctx.fq.emit(init('sess_1', '/tmp/x'))
    await vi.waitFor(has(ctx.events, (e) => e.type === 'session'))
    await ctx.handle.send('do the thing')
    ctx.fq.emit({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'all done' }] },
    })
    ctx.fq.emit({ type: 'stream_event', event: { type: 'message_stop' } })
    await vi.waitFor(has(ctx.events, (e) => e.type === 'assistant_message'))
    return ctx
  }

  it('REPRO: the turn does not terminalize on its own — status stays working', async () => {
    const { handle, events, consumer, fq } = await stalledTurn()
    await new Promise((r) => setTimeout(r, 60))
    // No terminal turn, no error: exactly the silent, permanent "working" from the incident.
    expect(events.some((e) => e.type === 'turn')).toBe(false)
    expect(handle.status()).toBe('working')
    fq.end()
    await handle.close()
    await consumer
  })

  it('RECOVERY: interrupt() terminalizes a stalled turn and the session stays usable', async () => {
    // The heart of the fix. Previously `interrupt()` awaited the SDK ack unbounded and relied on
    // "the ensuing `result` still closes the turn" — but a stalled provider sends neither, so the
    // one recovery path was as stuck as the thing it recovered from.
    const { handle, events, consumer, fq } = await stalledTurn()

    await handle.interrupt()

    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.state === 'interrupted'))
    expect(handle.status()).toBe('idle')
    // Usable: a fresh turn is accepted after the recovery.
    await expect(handle.send('next')).resolves.toBeUndefined()

    fq.end()
    await handle.close()
    await consumer
  })

  it('RECOVERY holds even when the provider never acknowledges the interrupt', async () => {
    // A provider wedged badly enough to ignore the interrupt must not wedge us with it.
    const fq = new FakeQuery()
    fq.interrupt = () => new Promise<never>(() => {}) // never settles
    let canUse: CanUseTool | undefined
    const runtime = new ClaudeRuntime(
      (params) => {
        canUse = params.options.canUseTool
        return fq
      },
      async () => true,
    )
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    void canUse
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    fq.emit(init('sess_1', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'session'))
    await handle.send('go')

    await handle.interrupt() // bounded — must return, not hang

    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.state === 'interrupted'))
    // The wedged CLI is retired, so the next message starts a fresh one.
    expect(fq.closeCount).toBe(1)
    await vi.waitFor(() => expect(handle.status()).toBe('ended'))
    fq.end()
    await handle.close()
    await consumer
  }, 15_000)

  it('VISIBILITY: a stalled working turn eventually surfaces a non-fatal notice', async () => {
    // Driven by the real watchdog with its default window would take minutes, so this asserts the
    // wiring: the notice is a non-fatal error (visible, never terminal) naming the idle time.
    const { handle, events, consumer, fq } = await stalledTurn()
    const withStall = handle as unknown as { reportStall(ms: number): void }
    withStall.reportStall(120_000)

    await vi.waitFor(has(events, (e) => e.type === 'error' && /no activity/.test(e.message)))
    const notice = events.find((e) => e.type === 'error' && /no activity/.test(e.message))
    expect(notice).toBeDefined()
    expect(notice?.type === 'error' && notice.fatal).toBe(false)
    expect(notice?.type === 'error' && notice.message).toMatch(/120s/)
    expect(handle.status()).toBe('working') // a notice, not a kill
    // …and it is still recoverable afterwards.
    await handle.interrupt()
    expect(handle.status()).toBe('idle')
    fq.end()
    await handle.close()
    await consumer
  })
})
