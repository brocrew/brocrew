import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import {
  ClaudeRuntime,
  parseRuntimeEvent,
  type ClaudeQuery,
  type RuntimeEvent,
  type ScheduleReceipt,
} from '../src/index'
import { SchedulingCalls } from '../src/claude/scheduling-calls'
import { AsyncQueue } from '../src/internal/async-queue'
import { MAX_SCHEDULED_JOBS } from '../src/scheduled-work'

/**
 * **A scheduling call's receipt, read at the provider's tool hooks as it runs.**
 *
 * The inputs below have the shapes the outside probe recorded from Claude Code 2.1.287
 * (`smoke/claude-scheduling-receipts-probe.smoke.ts`), with made-up ids and times.
 */

/** A clock the test moves by hand: the wall clock, and one that is never set. */
function aClock(): { wall: number; mono: number; at: { wall(): number; mono(): number } } {
  const clock = {
    wall: 1_800_000_000_000,
    mono: 5_000,
    at: { wall: () => clock.wall, mono: () => clock.mono },
  }
  return clock
}

const pre = (tool: string, id: string, input: unknown, extra: object = {}) => ({
  hook_event_name: 'PreToolUse',
  session_id: 's1',
  tool_name: tool,
  tool_input: input,
  tool_use_id: id,
  ...extra,
})

const post = (tool: string, id: string, input: unknown, response: unknown, extra: object = {}) => ({
  hook_event_name: 'PostToolUse',
  session_id: 's1',
  tool_name: tool,
  tool_input: input,
  tool_response: response,
  tool_use_id: id,
  duration_ms: 1,
  ...extra,
})

/** One call through both hooks, `ms` apart on both clocks. */
function oneCall(
  calls: SchedulingCalls,
  clock: ReturnType<typeof aClock>,
  tool: string,
  input: unknown,
  response: unknown,
  ms = 4,
): ScheduleReceipt | undefined {
  calls.called(pre(tool, 'toolu_1', input))
  clock.wall += ms
  clock.mono += ms
  return calls.answered(post(tool, 'toolu_1', input, response))?.receipt
}

describe('a scheduling call is kept as it ran', () => {
  it('a job created: the input as executed, the id it was given, and the bracket around it', () => {
    const clock = aClock()
    const calls = new SchedulingCalls(clock.at)
    const start = clock.wall
    const input = { cron: '*/5 * * * *', prompt: 'check the build', recurring: true }
    const event = (() => {
      calls.called(pre('CronCreate', 'toolu_1', input))
      clock.wall += 6
      clock.mono += 6
      return calls.answered(
        post('CronCreate', 'toolu_1', input, {
          id: 'a1b2c3d4',
          humanSchedule: 'Every 5 minutes',
          recurring: true,
          durable: false,
        }),
      )
    })()
    expect(event).toEqual({
      type: 'scheduled_work',
      receipt: {
        tool: 'CronCreate',
        toolUseId: 'toolu_1',
        calledAt: start,
        answeredAt: start + 6,
        input: { cron: '*/5 * * * *', recurring: true },
        result: { id: 'a1b2c3d4', recurring: true, durable: false },
      },
      source: 'hook/PostToolUse',
    })
    // It states no level, and the prompt stays with the tool call's own row.
    expect(event).not.toHaveProperty('jobs')
    expect(JSON.stringify(event)).not.toContain('check the build')
  })

  it('a one-shot, a cancellation, a listing and a wake-up, each in its published shape', () => {
    const clock = aClock()
    const calls = new SchedulingCalls(clock.at)
    expect(
      oneCall(
        calls,
        clock,
        'CronCreate',
        { cron: '31 17 7 10 *', prompt: 'p', recurring: false },
        { id: 'feed0001', humanSchedule: '31 17 7 10 *', recurring: false, durable: false },
      ),
    ).toMatchObject({
      input: { cron: '31 17 7 10 *', recurring: false },
      result: { id: 'feed0001', recurring: false },
    })
    expect(
      oneCall(calls, clock, 'CronDelete', { id: 'a1b2c3d4' }, { id: 'a1b2c3d4' }),
    ).toMatchObject({ tool: 'CronDelete', input: { id: 'a1b2c3d4' }, result: { id: 'a1b2c3d4' } })
    // A one-shot in a listing carries no `recurring`: absent stays absent, never `true`.
    expect(
      oneCall(
        calls,
        clock,
        'CronList',
        {},
        {
          jobs: [
            {
              id: 'a1b2c3d4',
              cron: '*/5 * * * *',
              humanSchedule: 'x',
              prompt: 'p',
              recurring: true,
            },
            {
              id: 'feed0001',
              cron: '31 17 7 10 *',
              humanSchedule: 'y',
              prompt: 'p',
              durable: false,
            },
          ],
        },
      )?.result,
    ).toEqual({
      jobs: [
        { id: 'a1b2c3d4', cron: '*/5 * * * *', recurring: true },
        { id: 'feed0001', cron: '31 17 7 10 *', durable: false },
      ],
    })
    expect(
      oneCall(
        calls,
        clock,
        'ScheduleWakeup',
        { delaySeconds: 120, reason: 'r', prompt: 'p', noop: false },
        { scheduledFor: 1_800_000_120_000, clampedDelaySeconds: 120, wasClamped: false },
      ),
    ).toEqual({
      tool: 'ScheduleWakeup',
      toolUseId: 'toolu_1',
      calledAt: expect.any(Number),
      answeredAt: expect.any(Number),
      // Neither the prompt nor the reason is copied.
      input: { delaySeconds: 120 },
      result: { scheduledFor: 1_800_000_120_000 },
    })
    expect(
      oneCall(
        calls,
        clock,
        'ScheduleWakeup',
        { stop: true },
        {
          scheduledFor: 0,
          clampedDelaySeconds: 0,
          wasClamped: false,
          stopped: true,
          cancelledWakeups: 1,
        },
      ),
    ).toMatchObject({
      input: { stop: true },
      result: { scheduledFor: 0, stopped: true, cancelledWakeups: 1 },
    })
  })

  it('⛔ an answer not in the published shape keeps the call and claims no result', () => {
    const clock = aClock()
    const calls = new SchedulingCalls(clock.at)
    for (const [tool, response] of [
      ['CronCreate', { id: 'a1b2c3d4' }],
      ['CronCreate', 'Error: Invalid cron expression'],
      ['CronDelete', { id: '' }],
      ['CronList', { jobs: 'none' }],
      ['ScheduleWakeup', { scheduledFor: -1 }],
    ] as const) {
      const receipt = oneCall(calls, clock, tool, {}, response)
      expect(receipt, `${tool} ${JSON.stringify(response)}`).toMatchObject({ tool })
      expect(receipt).not.toHaveProperty('result')
    }
  })

  it('⛔ any other tool, or a server’s tool of the same name, leaves no receipt', () => {
    const clock = aClock()
    const calls = new SchedulingCalls(clock.at)
    expect(calls.answered(post('Bash', 'toolu_2', { command: 'ls' }, 'ok'))).toBeUndefined()
    expect(
      calls.answered(
        post(
          'CronCreate',
          'toolu_3',
          { cron: '* * * * *' },
          { id: 'x', recurring: true },
          {
            mcp_server: { name: 'elsewhere' },
          },
        ),
      ),
    ).toBeUndefined()
    // A server's tool reaches the hooks under its own qualified name.
    expect(
      calls.answered(
        post(
          'mcp__elsewhere__CronCreate',
          'toolu_3b',
          { cron: '* * * * *' },
          { id: 'x', recurring: true },
        ),
      ),
    ).toBeUndefined()
    expect(calls.answered('not a hook input')).toBeUndefined()
    expect(calls.answered(post('CronList', '', {}, { jobs: [] }))).toBeUndefined()
  })

  it('⛔ no bracket without the start, or when the clock was set while the call ran', () => {
    const clock = aClock()
    const calls = new SchedulingCalls(clock.at)
    // Seen only at its end.
    const alone = calls.answered(post('CronList', 'toolu_4', {}, { jobs: [] }))?.receipt
    expect(alone).not.toHaveProperty('calledAt')
    expect(alone?.answeredAt).toBe(clock.wall)
    // The wall clock jumped an hour back in the 3 ms the call took.
    calls.called(pre('CronList', 'toolu_5', {}))
    clock.wall -= 3_600_000
    clock.mono += 3
    expect(
      calls.answered(post('CronList', 'toolu_5', {}, { jobs: [] }))?.receipt,
    ).not.toHaveProperty('calledAt')
    // …and forward by a minute.
    calls.called(pre('CronList', 'toolu_6', {}))
    clock.wall += 60_000
    clock.mono += 3
    expect(
      calls.answered(post('CronList', 'toolu_6', {}, { jobs: [] }))?.receipt,
    ).not.toHaveProperty('calledAt')
  })

  it('a call inside a sub-agent names it', () => {
    const clock = aClock()
    const calls = new SchedulingCalls(clock.at)
    expect(
      calls.answered(
        post('CronList', 'toolu_7', {}, { jobs: [] }, { agent_id: 'a1755ad0b5cc0a876' }),
      )?.receipt,
    ).toMatchObject({ childId: 'a1755ad0b5cc0a876' })
  })

  it('⛔ a listing past the cap keeps the cap and says how many it left out', () => {
    const clock = aClock()
    const calls = new SchedulingCalls(clock.at)
    const jobs = Array.from({ length: MAX_SCHEDULED_JOBS + 3 }, (_, i) => ({
      id: `j${String(i).padStart(3, '0')}`,
      cron: '* * * * *',
    }))
    const result = oneCall(calls, clock, 'CronList', {}, { jobs: [...jobs, { cron: 'no id' }] })
    expect(result).toMatchObject({ result: { dropped: 4 } })
    expect(result?.tool === 'CronList' ? result.result?.jobs : []).toHaveLength(MAX_SCHEDULED_JOBS)
  })

  it('⛔ calls never answered stay bounded: the oldest loses its bracket, the rest keep theirs', () => {
    const clock = aClock()
    const calls = new SchedulingCalls(clock.at)
    for (let i = 0; i < 65; i += 1) calls.called(pre('CronList', `toolu_open_${String(i)}`, {}))
    const first = calls.answered(post('CronList', 'toolu_open_0', {}, { jobs: [] }))?.receipt
    const last = calls.answered(post('CronList', 'toolu_open_64', {}, { jobs: [] }))?.receipt
    expect(first).not.toHaveProperty('calledAt')
    expect(last).toHaveProperty('calledAt')
  })

  it('every receipt it makes is one the event contract keeps whole', () => {
    const clock = aClock()
    const calls = new SchedulingCalls(clock.at)
    const events = [
      calls.answered(
        post(
          'CronCreate',
          'toolu_8',
          { cron: '0 9 * * 1-5', durable: true },
          {
            id: 'a1b2c3d4',
            humanSchedule: 'h',
            recurring: true,
            durable: true,
          },
        ),
      ),
      calls.answered(post('CronList', 'toolu_9', {}, { jobs: [{ id: 'x'.repeat(400) }] })),
      calls.answered(post('ScheduleWakeup', 'toolu_10', { delaySeconds: 'soon' }, {})),
      calls.answered(
        post(
          'CronList',
          'toolu_11',
          {},
          { jobs: [{ id: 'a1', cron: '* * * * *' }] },
          {
            agent_id: 'a1755ad0b5cc0a876',
          },
        ),
      ),
      calls.answered(post('CronDelete', 'toolu_12', { id: 'a1b2c3d4' }, { id: 'a1b2c3d4' })),
    ]
    // Bracketed, and a wake-up set then stopped: a stop's time is 0.
    calls.called(pre('CronCreate', 'toolu_13', { cron: '*/5 * * * *' }))
    clock.wall += 2
    clock.mono += 2
    events.push(
      calls.answered(
        post('CronCreate', 'toolu_13', { cron: '*/5 * * * *' }, { id: 'b2', recurring: true }),
      ),
    )
    for (const [id, input, response] of [
      ['toolu_14', { delaySeconds: 60 }, { scheduledFor: clock.wall + 60_000 }],
      ['toolu_15', { stop: true }, { scheduledFor: 0, stopped: true, cancelledWakeups: 1 }],
    ] as const) {
      calls.called(pre('ScheduleWakeup', id, input))
      events.push(calls.answered(post('ScheduleWakeup', id, input, response)))
    }
    expect(events.map((event) => event?.receipt && 'calledAt' in event.receipt)).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
      true,
      true,
    ])
    expect(events.map((event) => event?.receipt && 'result' in event.receipt)).toEqual([
      true,
      true,
      false,
      true,
      true,
      true,
      true,
      true,
    ])
    for (const event of events) {
      expect(event).toBeDefined()
      expect(parseRuntimeEvent(event)).toEqual({ ok: true, event })
    }
  })
})

class FakeQuery implements ClaudeQuery {
  private readonly messages = new AsyncQueue<SDKMessage>()
  emit(message: Record<string, unknown>): void {
    this.messages.push(message as unknown as SDKMessage)
  }
  end(): void {
    this.messages.close()
  }
  async interrupt(): Promise<unknown> {
    return undefined
  }
  close(): void {
    this.messages.close()
  }
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.messages[Symbol.asyncIterator]()
  }
}

describe('the adapter installs the hooks, and a receipt reaches the stream as the call runs', () => {
  it('PreToolUse and PostToolUse are installed beside the guard, and each lets the call go on', async () => {
    const fq = new FakeQuery()
    let captured: Options | undefined
    const runtime = new ClaudeRuntime(
      (params) => {
        captured = params.options
        return fq
      },
      async () => true,
    )
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    const events: RuntimeEvent[] = []
    const consumer = (async () => {
      for await (const event of handle.events()) events.push(event)
    })()
    fq.emit({ type: 'system', subtype: 'init', session_id: 's1', cwd: '/tmp/x' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    const options = captured!
    const signal = { signal: new AbortController().signal }
    const preHooks = (options.hooks?.PreToolUse ?? []).flatMap((matcher) => matcher.hooks)
    const postHooks = (options.hooks?.PostToolUse ?? []).flatMap((matcher) => matcher.hooks)
    // The guard is still there, and still first.
    expect(preHooks.length).toBeGreaterThanOrEqual(2)
    expect(postHooks).toHaveLength(1)
    // The reader is matched to the four tools by exact name, so no other call reaches it.
    const readers = [
      ...(options.hooks?.PreToolUse ?? []).slice(1),
      ...(options.hooks?.PostToolUse ?? []),
    ]
    for (const reader of readers) {
      expect(reader.matcher).toBe('CronCreate|CronDelete|CronList|ScheduleWakeup')
    }
    expect(options.hooks?.PreToolUse?.[0]?.matcher).toBeUndefined()
    const input = { cron: '*/5 * * * *', prompt: 'p', recurring: true }
    for (const hook of preHooks.slice(1)) {
      expect(await hook(pre('CronCreate', 'toolu_1', input) as never, 'toolu_1', signal)).toEqual({
        continue: true,
      })
    }
    expect(
      await postHooks[0]!(
        post('CronCreate', 'toolu_1', input, { id: 'a1b2c3d4', recurring: true }) as never,
        'toolu_1',
        signal,
      ),
    ).toEqual({ continue: true })
    // A hook handed something that is not a hook input still answers, and publishes nothing.
    expect(await postHooks[0]!({} as never, undefined, signal)).toEqual({ continue: true })
    await new Promise((resolve) => setTimeout(resolve, 20))
    fq.end()
    await handle.close()
    await consumer
    const receipts = events.filter(
      (event) => event.type === 'scheduled_work' && event.receipt !== undefined,
    )
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({
      source: 'hook/PostToolUse',
      receipt: {
        tool: 'CronCreate',
        toolUseId: 'toolu_1',
        calledAt: expect.any(Number),
        result: { id: 'a1b2c3d4', recurring: true },
      },
    })
  })
})
