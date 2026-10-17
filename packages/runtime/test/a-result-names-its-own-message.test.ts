import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClaudeRuntime, type ClaudeQuery, type RuntimeEvent } from '../src/index'
import { AsyncQueue } from '../src/internal/async-queue'

/**
 * # 🔴 F080 — the Claude adapter ends a turn only on the `result` that names its own message
 *
 * `a-turn-ends-on-its-own-result.test.ts` replays the bundled CLI's frames, where every result
 * carries both uuid keys or neither. These drive the adapter's own attribution
 * (`ClaudeSessionHandle.resultIsTheTurns`) one key and one case at a time:
 *
 *  - §1 · every message goes out with a uuid of its own;
 *  - §2 · either key the SDK documents names the turn's message (`user_message_uuid`, or
 *    `user_message_uuids` alone), and a result naming no message of the turn never ends it;
 *  - §3 · a late result of a STOPPED turn names that turn's message, not its replacement's, even
 *    while the replacement's own message is still waiting on its settings;
 *  - §4 · a message that joins a wake: its result ends the wake's turn, marked; and one whose queued
 *    settings were refused never left this app, so the wake runs on (`failTurn`'s `neverSent`);
 *  - §5 · a Stop asked of a wake is its word when the stream dies before the Stop lands.
 *
 * ⚑ The double here does NOT stamp results (`TheCliAnswersInOrder` would): each test says, frame by
 * frame, which message a result names.
 */

class WireQuery implements ClaudeQuery {
  private readonly messages = new AsyncQueue<SDKMessage>()
  /** Every message the adapter pushed, in order, with the uuid it carried. */
  readonly sent: { readonly uuid: unknown; readonly text: string }[] = []
  interruptCount = 0
  /** Runs inside `interrupt()`, before it answers — the CLI doing something while it is asked. */
  onInterrupt: (() => void) | null = null
  /** When set, the next `setModel` waits on it. */
  holdSettings: Promise<void> | null = null
  setModelCalls = 0
  refuseSettings = false

  listen(prompt: AsyncIterable<SDKUserMessage>): void {
    void (async () => {
      for await (const message of prompt) {
        const content = message.message.content
        this.sent.push({
          uuid: (message as { uuid?: unknown }).uuid,
          text: typeof content === 'string' ? content : '',
        })
      }
    })().catch(() => {})
  }

  emit(message: Record<string, unknown>): void {
    this.messages.push(message as unknown as SDKMessage)
  }
  fail(error: unknown): void {
    this.messages.fail(error)
  }
  end(): void {
    this.messages.close()
  }
  async interrupt(): Promise<unknown> {
    this.interruptCount++
    this.onInterrupt?.()
    await new Promise((resolve) => setTimeout(resolve, 20))
    return undefined
  }
  async setModel(): Promise<void> {
    this.setModelCalls++
    if (this.refuseSettings) throw new Error('the CLI refused the model')
    if (this.holdSettings) await this.holdSettings
  }
  close(): void {
    this.messages.close()
  }
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.messages[Symbol.asyncIterator]()
  }
}

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function aSession() {
  const root = mkdtempSync(join(tmpdir(), 'f080-own-result-'))
  roots.push(root)
  const fq = new WireQuery()
  const runtime = new ClaudeRuntime(
    (params) => {
      fq.listen(params.prompt)
      return fq
    },
    async () => true,
    () => 'test-token',
  )
  const handle = await runtime.start({ cwd: root, providerHome: join(root, 'home') })
  const events: RuntimeEvent[] = []
  const consumer = (async () => {
    for await (const event of handle.events()) events.push(event)
  })()
  fq.emit({ type: 'system', subtype: 'init', session_id: 'sess_f080', cwd: root })
  await vi.waitFor(() => expect(events.some((e) => e.type === 'session')).toBe(true))
  const done = async (): Promise<void> => {
    fq.end()
    await handle.close()
    await Promise.race([consumer, new Promise((resolve) => setTimeout(resolve, 1_000))])
  }
  return { fq, handle, events, done }
}

const turns = (events: readonly RuntimeEvent[]) =>
  events.flatMap((e) => (e.type === 'turn' ? [e] : []))

const says = (text: string): Record<string, unknown> => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
})

/** A frame the adapter emits as an event and the machine never reads — "everything before it was read". */
const aSubAgentsCall = (id: string): Record<string, unknown> => ({
  type: 'assistant',
  parent_tool_use_id: 'toolu_agent',
  message: {
    role: 'assistant',
    content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'ls' } }],
  },
})

const done = { type: 'result', subtype: 'success', is_error: false } as const

/** The uuid the n-th message went out with, once it has gone. */
async function uuidOf(fq: WireQuery, n: number): Promise<string> {
  await vi.waitFor(() => expect(fq.sent.length).toBeGreaterThan(n))
  const uuid = fq.sent[n]!.uuid
  if (typeof uuid !== 'string') throw new Error(`message ${String(n)} went out with no uuid`)
  return uuid
}

describe('§1 · every message goes out with a uuid of its own', () => {
  it('🔴 two messages, two uuids — and each turn ends on its own', async () => {
    const { fq, handle, events, done: finish } = await aSession()
    await handle.send('one')
    const first = await uuidOf(fq, 0)
    fq.emit({ ...done, user_message_uuid: first, user_message_uuids: [first] })
    await vi.waitFor(() => expect(turns(events)).toHaveLength(1))
    await handle.send('two')
    const second = await uuidOf(fq, 1)
    expect(first).toMatch(/^[0-9a-f-]{36}$/)
    expect(second).toMatch(/^[0-9a-f-]{36}$/)
    expect(second, 'the second message reused the first one’s uuid').not.toBe(first)
    fq.emit({ ...done, user_message_uuid: second, user_message_uuids: [second] })
    await vi.waitFor(() => expect(turns(events)).toHaveLength(2))
    expect(turns(events).map((t) => [t.state, t.startedBy])).toEqual([
      ['completed', undefined],
      ['completed', undefined],
    ])
    await finish()
  })
})

describe('§2 · either key names the message, and a result naming none never ends the turn', () => {
  it('🔴 `user_message_uuids` alone, among others, ends the turn', async () => {
    const { fq, handle, events, done: finish } = await aSession()
    await handle.send('go')
    const sent = await uuidOf(fq, 0)
    fq.emit({ ...done, user_message_uuids: ['0000-not-ours', sent] })
    await vi.waitFor(() => expect(turns(events)).toHaveLength(1))
    expect(handle.status()).toBe('idle')
    await finish()
  })

  it('🔴 `user_message_uuid` alone ends the turn', async () => {
    const { fq, handle, events, done: finish } = await aSession()
    await handle.send('go')
    const sent = await uuidOf(fq, 0)
    fq.emit({ ...done, user_message_uuid: sent })
    await vi.waitFor(() => expect(turns(events)).toHaveLength(1))
    expect(handle.status()).toBe('idle')
    await finish()
  })

  it('⛔ a result naming no message, or another message, leaves the turn open — its own ends it', async () => {
    const { fq, handle, events, done: finish } = await aSession()
    await handle.send('go')
    const sent = await uuidOf(fq, 0)
    // ⚑ The CLI's own loop (no key at all), then one naming somebody else's message.
    fq.emit({ ...done, num_turns: 0 })
    fq.emit({ ...done, user_message_uuid: 'not-ours', user_message_uuids: ['not-ours'] })
    fq.emit(says('the answer, after the CLI’s own loops'))
    fq.emit(aSubAgentsCall('toolu_marker_1'))
    await vi.waitFor(() => expect(events.some((e) => e.type === 'tool_call')).toBe(true))
    expect(turns(events), 'a result that named no message of ours ended the turn').toEqual([])
    expect(handle.status()).toBe('working')
    // ⚑ The words were the open turn's: no turn of the provider's own was opened for them.
    expect(events.some((e) => e.type === 'provider_turn')).toBe(false)

    fq.emit({ ...done, user_message_uuid: sent, user_message_uuids: [sent] })
    await vi.waitFor(() => expect(turns(events)).toHaveLength(1))
    expect(turns(events)[0]).toMatchObject({ state: 'completed' })
    expect(turns(events)[0]!.startedBy).toBeUndefined()
    expect(handle.status()).toBe('idle')
    await finish()
  })
})

describe('§3 · a stopped turn’s late result is never the replacement’s', () => {
  it('🔴 it names the stopped message while the replacement still waits on its settings: the replacement runs on', async () => {
    const { fq, handle, events, done: finish } = await aSession()
    await handle.send('one')
    const stopped = await uuidOf(fq, 0)
    fq.emit(says('working on one'))
    await vi.waitFor(() => expect(events.some((e) => e.type === 'assistant_message')).toBe(true))
    await handle.interrupt()
    await vi.waitFor(() => expect(turns(events)).toHaveLength(1))
    expect(turns(events)[0]).toMatchObject({ state: 'interrupted', wordOf: 'this-app' })

    // ⚑ The replacement opens, and waits on a queued model before its message is pushed.
    await handle.setModel('opus')
    let release: () => void = () => {}
    fq.holdSettings = new Promise<void>((resolve) => (release = resolve))
    const sending = handle.send('two')
    await vi.waitFor(() => expect(fq.setModelCalls).toBe(1))
    expect(fq.sent, 'the replacement went out before its settings').toHaveLength(1)

    // ⛔ The stopped turn's own result lands now, naming the stopped message.
    fq.emit({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      terminal_reason: 'aborted_streaming',
      user_message_uuid: stopped,
      user_message_uuids: [stopped],
    })
    fq.emit(aSubAgentsCall('toolu_marker_2'))
    await vi.waitFor(() => expect(events.some((e) => e.type === 'tool_call')).toBe(true))
    expect(turns(events), 'the stopped turn’s result ended its replacement').toHaveLength(1)

    fq.holdSettings = null
    release()
    await expect(sending, 'the replacement was ended before it was sent').resolves.toBeUndefined()
    const replacement = await uuidOf(fq, 1)
    expect(handle.status()).toBe('working')
    fq.emit({ ...done, user_message_uuid: replacement, user_message_uuids: [replacement] })
    await vi.waitFor(() => expect(turns(events)).toHaveLength(2))
    expect(turns(events)[1]).toMatchObject({ state: 'completed' })
    await finish()
  })
})

describe('§4 · a message that joins a wake', () => {
  /** Our turn ended, then the CLI wakes the agent by itself. */
  async function aWake() {
    const ctx = await aSession()
    await ctx.handle.send('background a sleep, then stop')
    const first = await uuidOf(ctx.fq, 0)
    ctx.fq.emit({ ...done, user_message_uuid: first, user_message_uuids: [first] })
    await vi.waitFor(() => expect(turns(ctx.events)).toHaveLength(1))
    ctx.fq.emit(says('the sleep finished'))
    await vi.waitFor(() => expect(ctx.events.some((e) => e.type === 'provider_turn')).toBe(true))
    expect(ctx.handle.status()).toBe('working')
    return ctx
  }

  it('🔴 its own result ends the one turn, the provider’s — no second ending for the wake', async () => {
    const { fq, handle, events, done: finish } = await aWake()
    await handle.send('and also this')
    const joined = await uuidOf(fq, 1)
    // ⚑ The CLI folds it into the loop it is running; that loop's one result names it.
    fq.emit({ ...done, user_message_uuid: joined, user_message_uuids: [joined] })
    await vi.waitFor(() => expect(turns(events)).toHaveLength(2))
    expect(turns(events)[1]).toMatchObject({ state: 'completed', startedBy: 'the-provider' })
    expect(turns(events)[1]!.wordOf, 'the provider ended it, not this app').toBeUndefined()
    expect(events.filter((e) => e.type === 'provider_turn')).toHaveLength(1)
    expect(handle.status()).toBe('idle')
    await finish()
  })

  it('🔴 a message whose queued settings were refused never left — the wake runs on, and ends on its own result', async () => {
    const { fq, handle, events, done: finish } = await aWake()
    await handle.setModel('opus')
    fq.refuseSettings = true
    await expect(handle.send('joins the wake')).rejects.toThrow()
    expect(fq.sent, 'the refused message was pushed').toHaveLength(1)
    // ⚑ The reason is said, and nothing ended.
    await vi.waitFor(() =>
      expect(
        events.some(
          (e) =>
            e.type === 'error' && /could not apply the queued settings/.test(e.message) && !e.fatal,
        ),
      ).toBe(true),
    )
    expect(turns(events), 'the wake was ended by a message that never left').toHaveLength(1)
    expect(handle.status()).toBe('working')

    // ⚑ The wake's own result (no uuid: a loop of the CLI's own) ends it, as the provider's.
    fq.emit({ ...done })
    await vi.waitFor(() => expect(turns(events)).toHaveLength(2))
    expect(turns(events)[1]).toMatchObject({ state: 'completed', startedBy: 'the-provider' })
    expect(handle.status()).toBe('idle')
    await finish()
  })

  it('⚑ the control — the same refusal with no wake running fails its own turn, this app’s word, unmarked', async () => {
    const { fq, handle, events, done: finish } = await aSession()
    await handle.setModel('opus')
    fq.refuseSettings = true
    await expect(handle.send('go')).rejects.toThrow()
    await vi.waitFor(() => expect(turns(events)).toHaveLength(1))
    expect(turns(events)[0]).toMatchObject({ state: 'failed', wordOf: 'this-app' })
    expect(turns(events)[0]!.startedBy).toBeUndefined()
    expect(handle.status()).toBe('idle')
    await finish()
  })
})

describe('§5 · a Stop asked of a wake is its word when the stream dies first', () => {
  async function aRunningWake() {
    const ctx = await aSession()
    await ctx.handle.send('go')
    const first = await uuidOf(ctx.fq, 0)
    ctx.fq.emit({ ...done, user_message_uuid: first })
    await vi.waitFor(() => expect(turns(ctx.events)).toHaveLength(1))
    ctx.fq.emit(says('woken'))
    await vi.waitFor(() => expect(ctx.events.some((e) => e.type === 'provider_turn')).toBe(true))
    return ctx
  }

  it('🔴 Stop, then the CLI dies before it answers: the wake ends `interrupted`, marked', async () => {
    const { fq, handle, events, done: finish } = await aRunningWake()
    fq.onInterrupt = () => fq.fail(new Error('the CLI died'))
    await handle.interrupt()
    await vi.waitFor(() => expect(turns(events)).toHaveLength(2))
    expect(turns(events)[1]).toMatchObject({
      state: 'interrupted',
      wordOf: 'this-app',
      startedBy: 'the-provider',
    })
    expect(handle.status()).toBe('errored')
    await finish()
  })

  it('⚑ the control — the CLI dies with no Stop asked: the wake fails, marked', async () => {
    const { fq, handle, events, done: finish } = await aRunningWake()
    fq.fail(new Error('the CLI died'))
    await vi.waitFor(() => expect(turns(events)).toHaveLength(2))
    expect(turns(events)[1]).toMatchObject({
      state: 'failed',
      wordOf: 'this-app',
      startedBy: 'the-provider',
    })
    expect(handle.status()).toBe('errored')
    await finish()
  })
})
