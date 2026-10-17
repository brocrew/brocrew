import { describe, expect, it } from 'vitest'
import { AsyncQueue } from '../src/internal/async-queue'
import type { CodexIncoming } from '../src/codex/codex-transport'
import { readArm, type Plan, type ReaderTransport } from '../smoke/cancel-interrupt-reader'

/**
 * 🔴 **`655` · the cancel-interrupt probe's reader, driven by a fixture** (`649` F1).
 *
 * ⛔ **`495`'s reader awaited arm B's `turn/interrupt` inside its own loop**, so every frame the
 * app-server sent while the interrupt was pending was stamped when it was DEQUEUED: B's
 * `turn/completed` could never read earlier than `interruptResolvedAt`. ⚑ The first test below
 * drives exactly that ordering in — the terminal arrives, THEN the interrupt answers — and asserts
 * the reader records it as it happened. The old reader could not produce this row.
 */

/** A transport the test drives by hand: frames in, answers and requests recorded, one RPC held. */
function fixtureTransport(): ReaderTransport & {
  readonly frames: AsyncQueue<CodexIncoming>
  readonly responses: { id: string | number; result: unknown }[]
  readonly errors: { id: string | number; code: number }[]
  readonly requested: { method: string; params: unknown }[]
  /** Every write to the provider, in the ORDER it was made. */
  readonly writes: string[]
  answerInterrupt(): void
  failInterrupt(message: string): void
} {
  const frames = new AsyncQueue<CodexIncoming>()
  const responses: { id: string | number; result: unknown }[] = []
  const errors: { id: string | number; code: number }[] = []
  const requested: { method: string; params: unknown }[] = []
  const writes: string[] = []
  let settle: { resolve: (value: unknown) => void; reject: (error: unknown) => void } | null = null
  return {
    frames,
    responses,
    errors,
    requested,
    writes,
    incoming: () => frames,
    respond: (id, result) => {
      responses.push({ id, result })
      writes.push(`respond ${id}`)
    },
    respondError: (id, code) => {
      errors.push({ id, code })
      writes.push(`respondError ${id}`)
    },
    request: (method, params) => {
      requested.push({ method, params })
      writes.push(`request ${method}`)
      return new Promise((resolve, reject) => {
        settle = { resolve, reject }
      })
    },
    answerInterrupt: () => settle?.resolve({}),
    failInterrupt: (message) => settle?.reject(new Error(message)),
  }
}

/** Let the reader's loop and every continuation queued behind a frame run. */
const drain = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

const DECLINED = { contentItems: [{ type: 'inputText', text: 'declined' }], success: false }

function arm(plan: Plan, ids = { threadId: 'thr_1', turnId: 'turn_1' }) {
  const transport = fixtureTransport()
  let now = 0
  const reader = readArm(transport, {
    plan,
    declined: DECLINED,
    since: () => now,
    turn: () => ids,
    rpcDeadlineMs: 30_000,
    probe: 'fixture probe',
  })
  return {
    transport,
    reader,
    at: (ms: number): void => {
      now = ms
    },
  }
}

const toolCall = (id: number): CodexIncoming => ({
  kind: 'request',
  id,
  method: 'item/tool/call',
  params: { turnId: 'turn_1' },
})
const turnCompleted: CodexIncoming = {
  kind: 'notification',
  method: 'turn/completed',
  params: { turn: { id: 'turn_1', status: 'interrupted' } },
}

describe('655 · arm B no longer measures its own await', () => {
  it('🔴 a turn/completed that arrives while the interrupt is pending is stamped when it ARRIVES', async () => {
    const { transport, reader, at } = arm('answer-then-interrupt')
    at(10)
    transport.frames.push(toolCall(7))
    await drain()
    expect(transport.responses).toEqual([{ id: 7, result: DECLINED }])
    expect(transport.requested).toEqual([
      { method: 'turn/interrupt', params: { threadId: 'thr_1', turnId: 'turn_1' } },
    ])
    expect(reader.reading.interruptSentAt).toBe(10)

    at(20)
    transport.frames.push(turnCompleted)
    await drain()
    at(30)
    transport.answerInterrupt()
    await reader.interruptSettled()

    const completed = reader.reading.notifications.find((one) => one.method === 'turn/completed')
    expect(completed?.at, 'stamped when it arrived').toBe(20)
    expect(reader.reading.interruptResolvedAt).toBe(30)
    // ⛔ The ordering the old reader made impossible: the terminal BEFORE the interrupt's answer.
    expect(completed!.at).toBeLessThan(reader.reading.interruptResolvedAt!)
    transport.frames.close()
    await reader.done
  })

  it('⚑ the control, one fact over: the interrupt answering FIRST is recorded in that order too', async () => {
    const { transport, reader, at } = arm('answer-then-interrupt')
    at(10)
    transport.frames.push(toolCall(7))
    await drain()
    at(15)
    transport.answerInterrupt()
    await reader.interruptSettled()
    at(25)
    transport.frames.push(turnCompleted)
    await drain()

    const completed = reader.reading.notifications.find((one) => one.method === 'turn/completed')
    expect(reader.reading.interruptResolvedAt).toBe(15)
    expect(completed?.at).toBe(25)
    transport.frames.close()
    await reader.done
  })

  it('🔴 the interrupt goes out in the SAME continuation as the declined result', async () => {
    // ⚑ `codex-runtime.ts`'s `handleAgentToolCall` writes the result, then the interrupt, with
    // nothing asynchronous between. A microtask queued the instant the result is written must
    // already find the interrupt requested — any deferral, even one microtask, arrives after it.
    const { transport, reader } = arm('answer-then-interrupt')
    let requestedBeforeTheNextMicrotask: boolean | null = null
    const respond = transport.respond
    transport.respond = (id, result) => {
      respond(id, result)
      queueMicrotask(() => {
        requestedBeforeTheNextMicrotask = transport.requested.length > 0
      })
    }
    transport.frames.push(toolCall(7))
    await drain()
    expect(requestedBeforeTheNextMicrotask).toBe(true)
    // ⛔ And in the adapter's ORDER: the result first, then the interrupt — never the reverse.
    expect(transport.writes).toEqual(['respond 7', 'request turn/interrupt'])
    transport.answerInterrupt()
    transport.frames.close()
    await reader.done
  })

  it('⛔ the arrival signal is not held behind the interrupt: it fires with the tool call', async () => {
    const { transport, reader } = arm('answer-then-interrupt')
    let arrived = false
    void reader.wantedCallsReached.then(() => {
      arrived = true
    })
    transport.frames.push(toolCall(7))
    await drain()
    // ⚠️ The interrupt is still unanswered — the old reader had not reached this line yet.
    expect(arrived).toBe(true)
    transport.answerInterrupt()
    transport.frames.close()
    await reader.done
  })

  it('⚠️ an interrupt that errs is recorded as its error, and the reader reads on', async () => {
    const { transport, reader, at } = arm('answer-then-interrupt')
    transport.frames.push(toolCall(7))
    await drain()
    transport.failInterrupt('codex transport closed')
    await reader.interruptSettled()
    expect(reader.reading.interruptError).toBe('codex transport closed')
    expect(reader.reading.interruptResolvedAt).toBeNull()
    at(40)
    transport.frames.push(turnCompleted)
    await drain()
    expect(reader.reading.notifications.map((one) => one.at)).toEqual([40])
    transport.frames.close()
    await reader.done
  })

  it('⛔ with the ids unbound, B sends NO interrupt and says NOT PERFORMED', async () => {
    const { transport, reader } = arm('answer-then-interrupt', { threadId: 'thr_1', turnId: '' })
    transport.frames.push(toolCall(7))
    await drain()
    expect(transport.requested).toEqual([])
    expect(reader.reading.failure).toMatch(
      /^NOT PERFORMED — answer-then-interrupt reached the tool/,
    )
    transport.frames.close()
    await reader.done
  })
})

describe('655 · the other three arms, as 492 designed them', () => {
  it('⛔ A answers nothing and interrupts nothing from the reader', async () => {
    const { transport, reader } = arm('never-answer')
    transport.frames.push(toolCall(7))
    await drain()
    expect(transport.responses).toEqual([])
    expect(transport.requested).toEqual([])
    expect(reader.reading.answeredAt).toBeNull()
    transport.frames.close()
    await reader.done
  })

  it('⚑ C, the control, declines and never interrupts', async () => {
    const { transport, reader } = arm('answer-only')
    transport.frames.push(toolCall(7))
    await drain()
    expect(transport.responses).toEqual([{ id: 7, result: DECLINED }])
    expect(transport.requested).toEqual([])
    transport.frames.close()
    await reader.done
  })

  it('⚠️ D answers the FIRST call only, and is "reached" at the second', async () => {
    const { transport, reader } = arm('two-answer-one-then-interrupt')
    let arrived = false
    void reader.wantedCallsReached.then(() => {
      arrived = true
    })
    transport.frames.push(toolCall(1))
    await drain()
    expect(arrived, 'one call is not two').toBe(false)
    transport.frames.push(toolCall(2))
    await drain()
    expect(arrived).toBe(true)
    expect(transport.responses.map((one) => one.id)).toEqual([1])
    expect(transport.requested).toEqual([])
    transport.frames.close()
    await reader.done
  })

  it('⚑ any other server request is refused, not left waiting', async () => {
    const { transport, reader } = arm('answer-only')
    transport.frames.push({
      kind: 'request',
      id: 9,
      method: 'item/fileChange/requestApproval',
      params: {},
    })
    await drain()
    expect(transport.errors).toEqual([{ id: 9, code: -32601 }])
    transport.frames.close()
    await reader.done
  })
})
