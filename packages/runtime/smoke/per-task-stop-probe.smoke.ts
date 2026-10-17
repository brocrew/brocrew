import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { query } from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'
import type { RuntimeEvent } from '../src/events'
import type { SessionHandle } from '../src/runtime'
import {
  announcedVersion,
  assistantTurns,
  closeBounded,
  firstUserText,
  loopbackRuntime,
  offeredTools,
  startLoopback,
  until,
  type SeenRequest,
} from './loopback-claude'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

/**
 * 🔴 **695 · R35 — does a conversation's Stop spare the background agent a person can stop one by
 * one?** `680` F1, ruled by the PM: BroBot draws a per-task stop (`BackgroundBar.vue`, wired to
 * `Query.stopTask`), so it DECLARES `perTaskStopAffordance` and the conversation's Stop must leave
 * background tasks to it.
 *
 * ## ⚑ What the declaration moves
 *
 * On 2.1.281 an interrupt kills backgrounded **agents and workflows** (`local_agent`,
 * `local_workflow`) unless the launch declares `perTaskStopAffordance`, which spares them.
 * ⚠️ **Background Bash (`local_bash`) is spared either way, on both pins** — which is why this
 * probe backgrounds an AGENT: a Bash sleeper would read "spared" in every arm and measure nothing.
 * 2.1.218 has no declaration at all and kills the same set unconditionally.
 *
 * ## The arms — one fact apart
 *
 * | arm | the launch |
 * |---|---|
 * | **declared** | the product's own options, exactly as `optionsFor` builds them — the SUBJECT |
 * | **undeclared** | the same, with `perTaskStopAffordance` deleted — the CONTROL that must kill |
 * | **pin-0.3.218** | the product's options through the 0.3.218 SDK and its CLI — only when `BROBOT_PROBE_SDK_0_3_218` names that SDK's `sdk.mjs`; otherwise NOT PERFORMED |
 *
 * ⚑ Every arm: the scripted model backgrounds one sub-agent (`run_in_background: true`), whose own
 * model request is then HELD so it stays running; the parent's next request is held too, so a turn
 * is in flight — `interrupt()` is a no-op without one (`claude-runtime.ts`, `interrupt`). Then the
 * conversation's Stop, through `handle.interrupt()` — the call `ipc 'interrupt'` makes.
 * ⚑ **Spared** = the agent is still in the running level `SPARE_WINDOW_MS` after the turn closed
 * interrupted; **killed** = its `background_work.ended` arrived `stopped` inside that window.
 * ⚑ And the declaration's other half, in the declared arm: the per-task stop
 * (`handle.stopBackgroundWork`) still stops it.
 *
 * 🔒 `loopback-claude.ts`'s recipe — no token, no spend, no personal provider state. Run:
 * `pnpm run probe:per-task-stop`. Not part of `pnpm run ci`.
 */

const MAIN_WORDS = '695 per-task stop probe: background one sub-agent'
const SUB_WORDS = '695-SUBAGENT: wait here'

const START_MS = 90_000
const INTERRUPT_MS = 30_000
/** ⚑ The CLI's sweep is synchronous on the interrupt; an ending it owes arrives well inside this. */
const SPARE_WINDOW_MS = 10_000
const STOP_TASK_MS = 20_000
const TEARDOWN_MS = 15_000
const SERIAL_WAITS_MS = [START_MS, INTERRUPT_MS, SPARE_WINDOW_MS, STOP_TASK_MS, TEARDOWN_MS]

type ArmName = 'declared' | 'undeclared' | 'pin-0.3.218'

const ARMS: readonly ArmName[] = ['declared', 'undeclared', 'pin-0.3.218']

const deadline = probeRunDeadline(
  '695 per-task stop probe',
  runBudgetMs(ARMS.flatMap(() => SERIAL_WAITS_MS)),
  TEARDOWN_MS,
)

interface Arm {
  readonly label: ArmName
  readonly cli: string | null
  readonly declared: unknown
  readonly listenedOn: number | null
  readonly configuredPort: number | null
  readonly agentTool: string | null
  readonly agentTaskId: string | null
  /** ⚑ `spared` / `killed` / `null` when the arm could not be performed. */
  readonly afterStop: 'spared' | 'killed' | null
  /** The declared arm's per-task stop: `stopped` when it ended the agent. */
  readonly perTaskStop: string | null
  /**
   * ⚑ **The second lie R35 exposed**: did the stream END the spared agent's card between the Stop and
   * its own per-task stop? Until 695 the turn-end closer did exactly that. `null` when not reached.
   */
  readonly cardEndedWhileSpared: boolean | null
  /** ⚑ Rule 40 — some request arrived on the port this process listened on. */
  readonly reachedThisPort: boolean
  readonly turnOutcomes: string[]
  readonly failure: string | null
  readonly events: RuntimeEvent[]
  readonly requests: { path: string; firstUser: string; step: number }[]
  readonly stderr: string
}

/** The Agent tool the CLI offered, by what it is rather than by a name a bump may change. */
function agentToolOf(request: SeenRequest): string | null {
  for (const tool of offeredTools(request)) {
    const props = (tool.input_schema as { properties?: Record<string, unknown> } | undefined)
      ?.properties
    if (props !== undefined && 'run_in_background' in props && 'subagent_type' in props) {
      return tool.name
    }
  }
  return null
}

async function sdkAt0_3_218(): Promise<typeof query | null> {
  const entry = process.env['BROBOT_PROBE_SDK_0_3_218']
  if (entry === undefined || entry === '') return null
  const mod = (await import(entry)) as { query: typeof query }
  return mod.query
}

async function measure(label: ArmName): Promise<Arm> {
  deadline.refuse(`starting arm ${label}`)
  let agentTool: string | null = null
  const loopback = await startLoopback((request) => {
    const who = firstUserText(request)
    if (who.includes(SUB_WORDS)) return { kind: 'hold' }
    if (who.includes(MAIN_WORDS)) {
      if (assistantTurns(request) === 0) {
        agentTool = agentToolOf(request)
        if (agentTool === null) return { kind: 'text', text: 'no agent tool was offered' }
        return {
          kind: 'tool_use',
          id: 'toolu_695_agent',
          name: agentTool,
          input: {
            description: '695 background sleeper',
            prompt: SUB_WORDS,
            subagent_type: 'general-purpose',
            run_in_background: true,
          },
        }
      }
      // ⚑ The parent's next step: held, so the turn is still in flight when Stop is pressed.
      return { kind: 'hold' }
    }
    return { kind: 'text', text: 'ok' }
  })
  let handle: SessionHandle | null = null
  // ⛔ The deadline's teardown owns the CLI child too — an expired arm must not leave it running.
  const release = deadline.own(async () => {
    if (handle !== null) await closeBounded(handle, TEARDOWN_MS)
    await loopback.close()
  })
  const events: RuntimeEvent[] = []
  let failure: string | null = null
  let afterStop: Arm['afterStop'] = null
  let perTaskStop: string | null = null
  let cardEndedWhileSpared: boolean | null = null
  let agentTaskId: string | null = null
  let rig: Awaited<ReturnType<typeof loopbackRuntime>> | null = null
  try {
    let sdkQuery: typeof query | undefined
    if (label === 'pin-0.3.218') {
      const older = await sdkAt0_3_218()
      if (older === null) {
        throw new Error('NOT PERFORMED — BROBOT_PROBE_SDK_0_3_218 names no 0.3.218 SDK entry')
      }
      sdkQuery = older
    }
    rig = await loopbackRuntime({
      scratch: runScratch('per-task-stop'),
      label,
      port: loopback.port,
      ...(sdkQuery === undefined ? {} : { sdkQuery }),
      ...(label === 'undeclared'
        ? {
            rewrite: (options) => {
              delete (options as { perTaskStopAffordance?: boolean }).perTaskStopAffordance
            },
          }
        : {}),
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
          void started.respondPermission(event.id, { outcome: 'allow' }).catch(() => {})
        }
      }
    })()
    await started.send(MAIN_WORDS)
    const agentRunning = (): string | null => {
      for (let i = events.length - 1; i >= 0; i -= 1) {
        const event = events[i]!
        if (event.type === 'background_work' && event.running !== undefined) {
          return event.running.find((one) => one.kind === 'local_agent')?.id ?? null
        }
      }
      return null
    }
    await until(
      () =>
        agentRunning() !== null &&
        loopback.requests.some(
          (one) => firstUserText(one).includes(MAIN_WORDS) && assistantTurns(one) >= 1,
        ) &&
        loopback.requests.some((one) => firstUserText(one).includes(SUB_WORDS)),
      START_MS,
      'a running background agent, its own request, and the parent turn still in flight',
    )
    agentTaskId = agentRunning()
    const turnsBefore = events.filter((one) => one.type === 'turn').length
    const atStop = events.length
    await started.interrupt()
    await until(
      () => events.filter((one) => one.type === 'turn').length > turnsBefore,
      INTERRUPT_MS,
      'the turn to close after the conversation’s Stop',
    )
    const endedStopped = (): boolean =>
      events.some(
        (one) =>
          one.type === 'background_work' &&
          one.ended?.id === agentTaskId &&
          one.ended.outcome === 'stopped',
      )
    const waitEnd = Date.now() + SPARE_WINDOW_MS
    while (Date.now() < waitEnd && !endedStopped()) {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    afterStop = endedStopped() ? 'killed' : agentRunning() === agentTaskId ? 'spared' : null
    if (afterStop === null) {
      throw new Error('NOT PERFORMED — the agent neither ended stopped nor stayed in the level')
    }
    if (afterStop === 'spared' && agentTaskId !== null) {
      // ⚑ Between the Stop and the agent's own stop, its CARD must still be open in the stream.
      cardEndedWhileSpared = events
        .slice(atStop)
        .some(
          (one) => one.type === 'sub_agent' && one.phase === 'ended' && one.agentId === agentTaskId,
        )
      // ⚑ The declaration's promise, kept: the person's per-task stop still stops it.
      await Promise.race([
        started.stopBackgroundWork?.(agentTaskId),
        new Promise((resolve) => setTimeout(resolve, STOP_TASK_MS)),
      ])
      await until(endedStopped, STOP_TASK_MS, 'the per-task stop to end the spared agent')
      perTaskStop = 'stopped'
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  } finally {
    if (handle !== null) await closeBounded(handle, TEARDOWN_MS)
    await loopback.close()
    release()
  }
  const arm: Arm = {
    label,
    cli: rig === null ? null : announcedVersion(rig.recorded.frames),
    declared: rig?.recorded.options
      ? ((rig.recorded.options as { perTaskStopAffordance?: unknown }).perTaskStopAffordance ??
        '<absent>')
      : null,
    listenedOn: loopback.port,
    configuredPort: rig?.recorded.configuredPort ?? null,
    agentTool,
    agentTaskId,
    afterStop,
    perTaskStop,
    cardEndedWhileSpared,
    reachedThisPort: loopback.requests.some((one) => one.localPort === loopback.port),
    turnOutcomes: events.flatMap((one) => (one.type === 'turn' ? [one.state] : [])),
    failure,
    events,
    requests: loopback.requests.map((one) => ({
      path: one.path,
      firstUser: firstUserText(one).slice(0, 120),
      step: assistantTurns(one),
    })),
    stderr: rig?.recorded.stderr ?? '',
  }
  const evidence = runEvidence('per-task-stop')
  mkdirSync(evidence, { recursive: true })
  writeFileSync(join(evidence, `${label}.json`), `${JSON.stringify(arm, null, 2)}\n`)
  if (failure === null && rig !== null) rmSync(rig.root, { recursive: true, force: true })
  console.log(
    `[695 per-task stop · ${label}]`,
    JSON.stringify(
      {
        cli: arm.cli,
        declared: arm.declared,
        agentTool,
        agentTaskId,
        afterStop,
        perTaskStop,
        turns: arm.turnOutcomes,
        failure,
      },
      null,
      2,
    ),
  )
  return arm
}

it(
  '695 · undeclared (the control): a conversation’s Stop kills the background agent',
  () =>
    deadline.within('arm undeclared', async () => {
      const arm = await measure('undeclared')
      expect(arm.failure, arm.stderr).toBeNull()
      expect(arm.configuredPort).toBe(arm.listenedOn)
      expect(arm.reachedThisPort).toBe(true)
      expect(arm.declared).toBe('<absent>')
      expect(arm.afterStop).toBe('killed')
    }),
  deadline.testTimeoutMs,
)

it(
  '695 · declared (the subject, R35): the Stop spares it, and its own stop still stops it',
  () =>
    deadline.within('arm declared', async () => {
      const arm = await measure('declared')
      expect(arm.failure, arm.stderr).toBeNull()
      expect(arm.configuredPort).toBe(arm.listenedOn)
      expect(arm.reachedThisPort).toBe(true)
      expect(arm.afterStop).toBe('spared')
      expect(arm.declared, 'the product does not declare perTaskStopAffordance').toBe(true)
      // ⚑ …and the stream did not END the card of the agent it just spared (695's second lie).
      expect(arm.cardEndedWhileSpared, 'sub_agent ended for an agent still running').toBe(false)
      expect(arm.perTaskStop).toBe('stopped')
    }),
  deadline.testTimeoutMs,
)

// ⛔ Registered only when it can run — an arm that returned early would read as a pass.
if ((process.env['BROBOT_PROBE_SDK_0_3_218'] ?? '') === '') {
  console.log(
    '[695 per-task stop · pin-0.3.218] NOT PERFORMED — BROBOT_PROBE_SDK_0_3_218 names no 0.3.218 SDK entry',
  )
} else
  it(
    '695 · pin 0.3.218: the older CLI, for the record',
    () =>
      deadline.within('arm pin-0.3.218', async () => {
        const arm = await measure('pin-0.3.218')
        expect(arm.failure, arm.stderr).toBeNull()
        expect(arm.cli).toBe('2.1.218')
        // ⚑ Measured, not asserted into a ruling: 2.1.218 has no declaration to honour.
        expect(arm.afterStop).toBe('killed')
      }),
    deadline.testTimeoutMs,
  )
