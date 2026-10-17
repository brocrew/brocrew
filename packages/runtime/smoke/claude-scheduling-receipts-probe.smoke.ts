import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  HookCallbackMatcher,
  HookEvent,
  Options,
  SDKMessage,
} from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'
import type { RuntimeEvent } from '../src/events'
import type { SessionHandle } from '../src/runtime'
import {
  announcedVersion,
  closeBounded,
  firstUserText,
  loopbackRuntime,
  offeredTools,
  startLoopback,
  until,
  type ScriptedReply,
  type SeenRequest,
} from './loopback-claude'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

/**
 * **What the CLI hands BroBot when an agent schedules, lists and cancels work** — the public shapes a
 * receipt is built from, measured from outside.
 *
 * The product's Claude adapter runs against a scripted loopback model (`loopback-claude.ts`: no
 * token, no spend, a scratch home, no Keychain), and the script calls `CronCreate`, `CronList`,
 * `CronDelete` and `ScheduleWakeup` in turn, including calls that should fail. Hook callbacks are
 * added beside the product's own, only to record what each is handed. For every call it records:
 *
 * - whether `PreToolUse`, `PostToolUse` and `PostToolUseFailure` fire, with their `tool_use_id`,
 *   `tool_input`, `tool_response` or `error`, and the moment each arrived; `UserPromptSubmit` and
 *   `Stop` too;
 * - the SDK frames: the assistant's `tool_use` block, and the user frame's `tool_result` and
 *   `tool_use_result`;
 * - the events the product emitted, `scheduled_work` levels included.
 *
 * | arm | what the script does |
 * |---|---|
 * | `tools` | creates a repeating job and a one-shot, lists, deletes the first, deletes an id that is not there, creates with a cron that is not one, sets a wake-up and stops it, lists again |
 * | `subagent` | asks a sub-agent to create a job: do the hooks fire inside it, and what names the child |
 *
 * "This captures what the provider put in its model-bound request, not a hosted model's obedience
 * to the text": the model is a script. Run: `pnpm run probe:scheduling-receipts`. Not part of
 * `pnpm run ci`.
 */

const WORDS = 'scheduling receipts probe: run the script'
const SUB_WORDS = 'scheduling receipts probe: the sub-agent creates a job'
const TICK = 'RECEIPT_PROBE tick'

const TURN_MS = 120_000
const TEARDOWN_MS = 15_000

const deadline = probeRunDeadline(
  'scheduling receipts probe',
  runBudgetMs([TURN_MS, TEARDOWN_MS, TURN_MS, TEARDOWN_MS]),
  TEARDOWN_MS,
)

type ArmName = 'tools' | 'subagent'

/** One hook callback, as it was handed over. */
interface HookSeen {
  readonly at: number
  readonly event: string
  readonly toolUseId: unknown
  readonly input: unknown
}

/** A one-shot's cron, pinned to a minute 30 minutes from now in this machine's local time. */
function aMinuteAhead(): string {
  const at = new Date(Date.now() + 30 * 60_000)
  return `${String(at.getMinutes())} ${String(at.getHours())} ${String(at.getDate())} ${String(at.getMonth() + 1)} *`
}

/**
 * How many of this script's calls the request already carries answers to: the script's next step.
 * Counting assistant messages would not do, since the CLI joins replies that share a message id.
 */
function answered(request: SeenRequest, prefix: string): number {
  const ids = new Set(JSON.stringify(request.body).match(new RegExp(`${prefix}\\d+`, 'g')) ?? [])
  const body = request.body as { messages?: { content?: unknown }[] } | null
  let count = 0
  for (const message of body?.messages ?? []) {
    if (!Array.isArray(message.content)) continue
    for (const block of message.content as { type?: string; tool_use_id?: string }[]) {
      if (block.type === 'tool_result' && ids.has(block.tool_use_id ?? '')) count += 1
    }
  }
  return count
}

/** The id a `CronCreate` call answered, from what the hooks or the frames were handed. */
function createdId(
  toolUseId: string,
  hooks: readonly HookSeen[],
  frames: readonly SDKMessage[],
  request: SeenRequest,
): string {
  for (const hook of hooks) {
    const input = hook.input as { hook_event_name?: string; tool_response?: { id?: unknown } }
    if (hook.toolUseId === toolUseId && typeof input.tool_response?.id === 'string') {
      return input.tool_response.id
    }
  }
  for (const frame of frames) {
    const f = frame as {
      type?: string
      message?: { content?: { type?: string; tool_use_id?: string }[] }
      tool_use_result?: { id?: unknown }
    }
    const answers = f.message?.content?.some((one) => one.tool_use_id === toolUseId) === true
    if (f.type === 'user' && answers && typeof f.tool_use_result?.id === 'string') {
      return f.tool_use_result.id
    }
  }
  // The last resort: an id-shaped word in the tool result the model was handed.
  const said = JSON.stringify(request.body)
  const at = said.indexOf(toolUseId, said.lastIndexOf('tool_result'))
  const found = /\b([0-9a-f]{8})\b/.exec(said.slice(Math.max(0, at)))
  return found?.[1] ?? 'not-found'
}

interface Arm {
  readonly label: string
  readonly cli: string | null
  readonly listenedOn: number
  readonly configuredPort: number | null
  readonly reachedThisPort: boolean
  readonly offered: readonly string[]
  readonly hooks: readonly HookSeen[]
  readonly frames: readonly SDKMessage[]
  readonly events: readonly RuntimeEvent[]
  readonly permissionAsks: readonly string[]
  readonly scriptedCalls: readonly { step: number; name: string; id: string; input: unknown }[]
  readonly failure: string | null
  readonly stderr: string
}

function scrub(value: unknown, root: string): unknown {
  return JSON.parse(
    JSON.stringify(value)
      .replaceAll(root, '<root>')
      .replace(/\/tmp\/cc-socks\/\d+\.sock/g, '<socket>'),
  ) as unknown
}

async function measure(label: ArmName): Promise<Arm> {
  deadline.refuse(`starting arm ${label}`)
  const hooks: HookSeen[] = []
  const scriptedCalls: { step: number; name: string; id: string; input: unknown }[] = []
  let rig: Awaited<ReturnType<typeof loopbackRuntime>> | null = null
  let offered: string[] = []
  const call = (
    step: number,
    name: string,
    input: Record<string, unknown>,
    who: string = label,
  ): ScriptedReply => {
    const id = `toolu_probe_${who}_${String(step)}`
    scriptedCalls.push({ step, name, id, input })
    return { kind: 'tool_use', name, input, id }
  }
  const agentTool = (): string => (offered.includes('Agent') ? 'Agent' : 'Task')

  const toolsScript = (request: SeenRequest): ScriptedReply => {
    const step = answered(request, `toolu_probe_${label}_`)
    if (step === 0) offered = offeredTools(request).map((one) => one.name)
    const frames = rig?.recorded.frames ?? []
    switch (step) {
      case 0:
        return call(step, 'CronCreate', { cron: '*/5 * * * *', prompt: TICK, recurring: true })
      case 1:
        return call(step, 'CronCreate', { cron: aMinuteAhead(), prompt: TICK, recurring: false })
      case 2:
        return call(step, 'CronList', {})
      case 3:
        return call(step, 'CronDelete', {
          id: createdId(`toolu_probe_${label}_0`, hooks, frames, request),
        })
      case 4:
        return call(step, 'CronDelete', { id: 'feedf00d' })
      case 5:
        return call(step, 'CronCreate', { cron: 'not a cron', prompt: TICK })
      case 6:
        return call(step, 'ScheduleWakeup', {
          delaySeconds: 120,
          reason: 'probe',
          prompt: TICK,
          noop: false,
        })
      case 7:
        return call(step, 'ScheduleWakeup', { stop: true })
      case 8:
        return call(step, 'CronList', {})
      default:
        return { kind: 'text', text: 'done' }
    }
  }
  const subagentScript = (request: SeenRequest): ScriptedReply => {
    const step = answered(request, `toolu_probe_${label}_`)
    if (firstUserText(request).includes(SUB_WORDS)) {
      return answered(request, 'toolu_probe_child_') === 0
        ? call(0, 'CronCreate', { cron: '*/7 * * * *', prompt: TICK, recurring: true }, 'child')
        : { kind: 'text', text: 'child done' }
    }
    if (step === 0) offered = offeredTools(request).map((one) => one.name)
    switch (step) {
      case 0:
        return call(step, agentTool(), {
          description: 'create a job',
          prompt: SUB_WORDS,
          subagent_type: 'general-purpose',
        })
      case 1:
        return call(step, 'CronList', {})
      default:
        return { kind: 'text', text: 'done' }
    }
  }

  const scripts: Record<ArmName, (request: SeenRequest) => ScriptedReply> = {
    tools: toolsScript,
    subagent: subagentScript,
  }

  const loopback = await startLoopback((request) => {
    const text = firstUserText(request)
    if (!text.includes(WORDS) && !text.includes(SUB_WORDS)) return { kind: 'text', text: 'ok' }
    return scripts[label](request)
  })
  let handle: SessionHandle | null = null
  const release = deadline.own(async () => {
    if (handle !== null) await closeBounded(handle, TEARDOWN_MS)
    await loopback.close()
  })
  const events: RuntimeEvent[] = []
  const permissionAsks: string[] = []
  let failure: string | null = null
  try {
    const record =
      (event: string): HookCallbackMatcher['hooks'][number] =>
      async (input, toolUseId) => {
        hooks.push({
          at: Date.now(),
          event,
          toolUseId,
          input: JSON.parse(JSON.stringify(input)) as unknown,
        })
        return { continue: true }
      }
    rig = await loopbackRuntime({
      scratch: runScratch('claude-scheduling-receipts'),
      label,
      port: loopback.port,
      maxRetries: 0,
      // Observes only: each added callback records what it is handed and lets the call go on.
      rewrite: (options: Options) => {
        const added: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {}
        for (const event of [
          'PreToolUse',
          'PostToolUse',
          'PostToolUseFailure',
          'UserPromptSubmit',
          'Stop',
        ] as const) {
          added[event] = [...(options.hooks?.[event] ?? []), { hooks: [record(event)] }]
        }
        options.hooks = { ...options.hooks, ...added }
      },
    })
    const started = await rig.runtime.start({
      cwd: rig.cwd,
      providerHome: rig.providerHome,
      model: 'claude-haiku-4-5',
    })
    handle = started
    void (async () => {
      for await (const event of started.events()) {
        events.push(event)
        if (event.type === 'permission_request') {
          permissionAsks.push(JSON.stringify(event).slice(0, 400))
          await started.respondPermission(event.id, { outcome: 'allow' }).catch(() => {})
        }
      }
    })()
    await started.send(WORDS)
    await until(() => events.some((one) => one.type === 'turn'), TURN_MS, 'the turn to close')
    await new Promise((resolve) => setTimeout(resolve, 1_500))
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  } finally {
    if (handle !== null) await closeBounded(handle, TEARDOWN_MS)
    await loopback.close()
    release()
  }
  const root = rig?.root ?? '<no root>'
  const arm: Arm = {
    label,
    cli: rig === null ? null : announcedVersion(rig.recorded.frames),
    listenedOn: loopback.port,
    configuredPort: rig?.recorded.configuredPort ?? null,
    reachedThisPort: loopback.requests.some(
      (one) => one.localPort === loopback.port && firstUserText(one).includes(WORDS),
    ),
    offered,
    hooks: scrub(hooks, root) as HookSeen[],
    frames: scrub(rig?.recorded.frames ?? [], root) as SDKMessage[],
    events: scrub(events, root) as RuntimeEvent[],
    permissionAsks,
    scriptedCalls,
    failure,
    stderr: rig?.recorded.stderr ?? '',
  }
  const evidence = runEvidence('claude-scheduling-receipts')
  mkdirSync(evidence, { recursive: true })
  writeFileSync(join(evidence, `${label}.json`), `${JSON.stringify(arm, null, 2)}\n`)
  writeFileSync(
    join(evidence, `${label}-requests.json`),
    `${JSON.stringify(
      scrub(
        loopback.requests.map((one) => one.body),
        root,
      ),
      null,
      2,
    )}\n`,
  )
  if (failure === null && rig !== null) rmSync(rig.root, { recursive: true, force: true })
  console.log(
    `[scheduling receipts · ${label}]`,
    JSON.stringify(
      {
        cli: arm.cli,
        offeredScheduling: offered.filter((one) => /Cron|Schedule|Agent|Task/.test(one)),
        hooks: arm.hooks.map((one) => {
          const input = one.input as { tool_name?: string; agent_id?: string }
          return `${one.event} ${String(input.tool_name)} ${String(one.toolUseId)}${input.agent_id === undefined ? '' : ` agent ${input.agent_id}`}`
        }),
        permissionAsks: arm.permissionAsks.length,
        scheduledWork: arm.events.filter((one) => one.type === 'scheduled_work').length,
        failure,
      },
      null,
      2,
    ),
  )
  return arm
}

for (const label of ['tools', 'subagent'] as const) {
  it(
    `scheduling receipts · ${label}`,
    () =>
      deadline.within(`arm ${label}`, async () => {
        const arm = await measure(label)
        expect(arm.failure, arm.stderr).toBeNull()
        expect(arm.configuredPort).toBe(arm.listenedOn)
        expect(arm.cli).not.toBeNull()
        expect(arm.reachedThisPort, 'the turn never reached this loopback').toBe(true)
        // What the product published: one receipt for each call that ran, with its bracket and
        // its result; none for the two the provider refused.
        const receipts = arm.events.flatMap((event) =>
          event.type === 'scheduled_work' && event.receipt !== undefined ? [event.receipt] : [],
        )
        if (label === 'tools') {
          expect(receipts.map((one) => one.tool)).toEqual([
            'CronCreate',
            'CronCreate',
            'CronList',
            'CronDelete',
            'ScheduleWakeup',
            'ScheduleWakeup',
            'CronList',
          ])
          for (const receipt of receipts) {
            expect(receipt, receipt.toolUseId).toHaveProperty('calledAt')
            expect(receipt, receipt.toolUseId).toHaveProperty('result')
          }
        }
      }),
    deadline.testTimeoutMs,
  )
}
