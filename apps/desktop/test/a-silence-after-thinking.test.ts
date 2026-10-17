import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CanUseTool, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeRuntime, type RuntimeEvent } from '@brobot2/runtime'
import { TheCliAnswersInOrder } from '../../../packages/runtime/test/the-cli-answers-in-order'
import { LivenessTracker } from '../src/main/runtime/liveness'

/**
 * A silence after the model's reasoning, read by both of its readers together: the real Claude
 * adapter's stall notice, and main's header tracker fed every event the adapter delivers. The
 * notice is the adapter's own, so neither reader may take it for the provider working again.
 */

class FakeQuery {
  readonly cli = new TheCliAnswersInOrder()
  private resolve: ((value: IteratorResult<SDKMessage>) => void) | null = null
  private readonly buffer: SDKMessage[] = []
  private done = false

  emit(message: SDKMessage): void {
    if (this.resolve) {
      const resolve = this.resolve
      this.resolve = null
      resolve({ value: message, done: false })
      return
    }
    this.buffer.push(message)
  }

  end(): void {
    this.done = true
    if (this.resolve) {
      const resolve = this.resolve
      this.resolve = null
      resolve({ value: undefined as never, done: true })
    }
  }

  async interrupt(): Promise<void> {}
  async setPermissionMode(): Promise<void> {}
  close(): void {
    this.end()
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.cli.over({
      next: (): Promise<IteratorResult<SDKMessage>> => {
        const queued = this.buffer.shift()
        if (queued) return Promise.resolve({ value: queued, done: false })
        if (this.done) return Promise.resolve({ value: undefined as never, done: true })
        return new Promise((resolve) => {
          this.resolve = resolve
        })
      },
    })
  }
}

const thinks = {
  type: 'stream_event',
  event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '' } },
} as unknown as SDKMessage

const says = (text: string): SDKMessage =>
  ({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  }) as unknown as SDKMessage

const THINKING = 'Still thinking (2 min).'
const GENERIC = /^still working — no activity for 120s\./

describe('a silence after thinking, through the adapter and the header together', () => {
  const cleanups: (() => Promise<void>)[] = []
  afterEach(async () => {
    vi.useRealTimers()
    for (const cleanup of cleanups.splice(0)) await cleanup()
  })

  /** A turn whose last provider event was reasoning, two minutes and a second ago. */
  async function aTurnThatThought() {
    const fq = new FakeQuery()
    let canUseTool: CanUseTool | undefined
    const runtime = new ClaudeRuntime(
      (params) => {
        canUseTool = params.options.canUseTool
        fq.cli.listen(params.prompt)
        return fq as never
      },
      async () => true,
    )
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    const events: RuntimeEvent[] = []
    const header = new LivenessTracker(() => {}, { now: () => Date.now() })
    const consumer = (async () => {
      for await (const event of handle.events()) {
        header.observe(event)
        events.push(event)
      }
    })()
    cleanups.push(async () => {
      header.stop()
      fq.end()
      await handle.close()
      await consumer
    })
    fq.emit({ type: 'system', subtype: 'init', session_id: 'sess_1', cwd: '/tmp/x' } as never)
    await vi.waitFor(() => expect(events.some((e) => e.type === 'session')).toBe(true))

    vi.useFakeTimers()
    await handle.send('think it over')
    await vi.advanceTimersByTimeAsync(0)
    expect(handle.status()).toBe('working')
    fq.emit(thinks)
    await vi.advanceTimersByTimeAsync(121_000)

    const notices = () => events.flatMap((e) => (e.type === 'error' && e.stall ? [e.message] : []))
    expect(notices()).toEqual([THINKING])
    expect(header.current).toMatchObject({ state: 'silent', detail: THINKING })
    if (!canUseTool) throw new Error('the adapter never handed the SDK a canUseTool')
    return { fq, handle, header, notices, canUseTool }
  }

  it('says it once, and the header stays silent and thinking past 240 s', async () => {
    const { header, notices } = await aTurnThatThought()
    const since = header.current.since
    await vi.advanceTimersByTimeAsync(120_000)
    expect(notices(), 'the notice re-armed the watchdog').toEqual([THINKING])
    expect(header.current).toEqual({ state: 'silent', since, detail: THINKING, thinking: true })
  })

  it('real progress re-arms both: reasoning as thinking, words as today', async () => {
    const { fq, header, notices } = await aTurnThatThought()
    fq.emit(thinks)
    await vi.advanceTimersByTimeAsync(0)
    expect(header.current.state).toBe('live')
    await vi.advanceTimersByTimeAsync(121_000)
    expect(notices()).toEqual([THINKING, THINKING])
    expect(header.current).toMatchObject({ state: 'silent', detail: THINKING })

    fq.emit(says('found it'))
    await vi.advanceTimersByTimeAsync(0)
    expect(header.current.state).toBe('live')
    await vi.advanceTimersByTimeAsync(121_000)
    expect(notices()).toHaveLength(3)
    expect(notices()[2]).toMatch(GENERIC)
    expect(header.current.detail).toMatch(/^no activity for 120s/)
  })

  it('a question to the person ends the silence, and none is reported while it is open', async () => {
    const { handle, header, notices, canUseTool } = await aTurnThatThought()
    void canUseTool(
      'AskUserQuestion',
      { questions: [{ question: 'Red or blue?', options: ['red', 'blue'] }] },
      { toolUseID: 'tu_q', signal: new AbortController().signal } as never,
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(handle.status()).toBe('waiting_permission')
    expect(header.current.state).toBe('live')
    await vi.advanceTimersByTimeAsync(240_000)
    expect(notices()).toEqual([THINKING])
    expect(header.current.state).toBe('live')
  })

  it('the end of the turn ends the silence, and no notice follows', async () => {
    const { fq, handle, header, notices } = await aTurnThatThought()
    fq.emit({ type: 'result', subtype: 'success', is_error: false } as never)
    await vi.advanceTimersByTimeAsync(0)
    expect(handle.status()).toBe('idle')
    expect(header.current.state).toBe('live')
    await vi.advanceTimersByTimeAsync(240_000)
    expect(notices()).toEqual([THINKING])
    expect(header.current.state).toBe('live')
  })
})
