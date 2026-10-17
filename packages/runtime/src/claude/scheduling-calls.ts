import type { ScheduleReceipt, ScheduledWorkEvent } from '../events'
import {
  MAX_SCHEDULED_JOBS,
  MAX_SCHEDULE_TEXT,
  SCHEDULING_TOOLS,
  type SchedulingTool,
} from '../scheduled-work'

/**
 * **The provider's scheduling calls, read at its documented `PreToolUse` and `PostToolUse` hooks**,
 * and published as receipts on `scheduled_work` rows that state no level.
 *
 * Measured from outside (`smoke/claude-scheduling-receipts-probe.smoke.ts`, CLI 2.1.287): both
 * hooks fire for `CronCreate`, `CronDelete`, `CronList` and `ScheduleWakeup`; `tool_response` has
 * the shape the SDK publishes for each (`sdk-tools.d.ts`); a call the provider refuses (an unknown
 * job id, a cron that is not one) runs neither hook, so it leaves no receipt.
 *
 * The two hooks bracket the call: `calledAt` is when the provider was about to run it and
 * `answeredAt` when it reported the result. That bracket is kept only when the wall clock and a
 * monotonic one agree on the time between them, so a clock set while the call ran cannot make it
 * look earlier or later than it was.
 *
 * Every value arrives through a hook callback with no schema in front of it, so each field a
 * receipt keeps is checked here against the published type, and an answer whose kept fields do not
 * check is kept with no `result`: the call happened, and what it did is not known. Total and non-throwing: a hook that throws would fail
 * inside the provider's tool call.
 */

/** The most calls waiting for their result at once; past it, the oldest loses its bracket. */
const MAX_OPEN_CALLS = 64

/** How far the wall clock may drift from the monotonic one over a call, in milliseconds. */
const SAME_CLOCK_MS = 1_000

const SOURCE = 'hook/PostToolUse'

interface Clock {
  /** Milliseconds since the epoch. */
  wall(): number
  /** Milliseconds on a clock that is never set. */
  mono(): number
}

const systemClock: Clock = { wall: () => Date.now(), mono: () => performance.now() }

type Fields = Record<string, unknown>

const isFields = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_SCHEDULE_TEXT
    ? value
    : undefined

const flag = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined

const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined

/** The fields that are present, so an absent one stays absent rather than `undefined`. */
function present<T extends Fields>(fields: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as Partial<T>
}

function isSchedulingTool(name: unknown): name is SchedulingTool {
  return typeof name === 'string' && (SCHEDULING_TOOLS as readonly string[]).includes(name)
}

/** One of the provider's own tools: a server's tool of the same name is not one. */
function itsOwnSchedulingCall(input: Fields): input is Fields & { tool_name: SchedulingTool } {
  return input['mcp_server'] === undefined && isSchedulingTool(input['tool_name'])
}

function cronCreateOf(
  input: unknown,
  response: unknown,
): Pick<Extract<ScheduleReceipt, { tool: 'CronCreate' }>, 'input' | 'result'> {
  const cron = isFields(input) ? text(input['cron']) : undefined
  const id = isFields(response) ? text(response['id']) : undefined
  const recurring = isFields(response) ? flag(response['recurring']) : undefined
  return {
    ...(cron === undefined || !isFields(input)
      ? {}
      : {
          input: {
            cron,
            ...present({ recurring: flag(input['recurring']), durable: flag(input['durable']) }),
          },
        }),
    ...(id === undefined || recurring === undefined || !isFields(response)
      ? {}
      : { result: { id, recurring, ...present({ durable: flag(response['durable']) }) } }),
  }
}

function cronDeleteOf(
  input: unknown,
  response: unknown,
): Pick<Extract<ScheduleReceipt, { tool: 'CronDelete' }>, 'input' | 'result'> {
  const asked = isFields(input) ? text(input['id']) : undefined
  const answered = isFields(response) ? text(response['id']) : undefined
  return {
    ...(asked === undefined ? {} : { input: { id: asked } }),
    ...(answered === undefined ? {} : { result: { id: answered } }),
  }
}

function cronListOf(
  response: unknown,
): Pick<Extract<ScheduleReceipt, { tool: 'CronList' }>, 'result'> {
  if (!isFields(response) || !Array.isArray(response['jobs'])) return {}
  const rows: unknown[] = response['jobs']
  const jobs: NonNullable<
    Extract<ScheduleReceipt, { tool: 'CronList' }>['result']
  >['jobs'][number][] = []
  let dropped = 0
  // An indexed loop, so a hole in a sparse array is counted rather than skipped.
  for (let at = 0; at < rows.length; at += 1) {
    const row = rows[at]
    const id = isFields(row) ? text(row['id']) : undefined
    if (id === undefined || !isFields(row) || jobs.length >= MAX_SCHEDULED_JOBS) {
      dropped += 1
      continue
    }
    jobs.push({
      id,
      ...present({
        cron: text(row['cron']),
        recurring: flag(row['recurring']),
        durable: flag(row['durable']),
      }),
    })
  }
  return { result: { jobs, ...(dropped > 0 ? { dropped } : {}) } }
}

function scheduleWakeupOf(
  input: unknown,
  response: unknown,
): Pick<Extract<ScheduleReceipt, { tool: 'ScheduleWakeup' }>, 'input' | 'result'> {
  const delay = isFields(input) ? input['delaySeconds'] : undefined
  const asked = isFields(input)
    ? present({
        delaySeconds:
          typeof delay === 'number' && Number.isFinite(delay) && delay >= 0 ? delay : undefined,
        stop: flag(input['stop']),
      })
    : {}
  const scheduledFor = isFields(response) ? count(response['scheduledFor']) : undefined
  return {
    ...(Object.keys(asked).length === 0 ? {} : { input: asked }),
    ...(scheduledFor === undefined || !isFields(response)
      ? {}
      : {
          result: {
            scheduledFor,
            ...present({
              stopped: flag(response['stopped']),
              cancelledWakeups: count(response['cancelledWakeups']),
            }),
          },
        }),
  }
}

export class SchedulingCalls {
  /** Each call seen at `PreToolUse` and not yet answered, by its tool-use id. */
  private readonly open = new Map<string, { readonly wall: number; readonly mono: number }>()

  constructor(private readonly clock: Clock = systemClock) {}

  /** A `PreToolUse` hook's input: the moment a scheduling call is about to run. */
  called(input: unknown): void {
    if (!isFields(input) || !itsOwnSchedulingCall(input)) return
    const id = text(input['tool_use_id'])
    if (id === undefined) return
    if (this.open.size >= MAX_OPEN_CALLS && !this.open.has(id)) {
      const oldest = this.open.keys().next().value
      if (oldest !== undefined) this.open.delete(oldest)
    }
    this.open.set(id, { wall: this.clock.wall(), mono: this.clock.mono() })
  }

  /** A `PostToolUse` hook's input: the receipt to publish, or nothing for any other call. */
  answered(input: unknown): ScheduledWorkEvent | undefined {
    if (!isFields(input) || !itsOwnSchedulingCall(input)) return undefined
    const toolUseId = text(input['tool_use_id'])
    if (toolUseId === undefined) return undefined
    const answeredAt = this.clock.wall()
    const mono = this.clock.mono()
    const call = this.open.get(toolUseId)
    this.open.delete(toolUseId)
    const sameClock =
      call !== undefined &&
      answeredAt >= call.wall &&
      Math.abs(answeredAt - call.wall - (mono - call.mono)) <= SAME_CLOCK_MS
    const base = {
      toolUseId,
      ...(sameClock ? { calledAt: call.wall } : {}),
      answeredAt,
      ...present({ childId: text(input['agent_id']) }),
    }
    const asked = input['tool_input']
    const response = input['tool_response']
    const receipt: ScheduleReceipt =
      input.tool_name === 'CronCreate'
        ? { ...base, tool: 'CronCreate', ...cronCreateOf(asked, response) }
        : input.tool_name === 'CronDelete'
          ? { ...base, tool: 'CronDelete', ...cronDeleteOf(asked, response) }
          : input.tool_name === 'CronList'
            ? { ...base, tool: 'CronList', ...cronListOf(response) }
            : { ...base, tool: 'ScheduleWakeup', ...scheduleWakeupOf(asked, response) }
    return { type: 'scheduled_work', receipt, source: SOURCE }
  }
}
