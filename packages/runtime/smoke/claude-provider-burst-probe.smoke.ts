import { rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'
import type { RuntimeEvent } from '../src/events'
import type { SessionHandle, TurnProvenance } from '../src/runtime'
import type { SessionRef } from '../src/session-ref'
import {
  announcedVersion,
  closeBounded,
  loopbackRuntime,
  startLoopback,
  until,
  type SeenRequest,
} from './loopback-claude'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

/**
 * 🔴 **F080 — what Claude Code sends when it starts work by itself, and what the adapter makes of it.**
 *
 * ## The two shapes the ledgers showed (2026-10-02/03)
 *
 *  1. **A background task wakes the agent** after its turn ended: the agent works on, with no turn
 *     row at all — `get_agent_status` said its last turn *finished* 43 minutes before it stopped.
 *  2. **A resume after a restart stopped background work**: the app's wake turn read `completed`
 *     1–10 ms after `session resumed`, before any model output, and the model's real answer came
 *     about 1.3 s later as a burst Claude Code started itself.
 *
 * ## The arms
 *
 * | arm | what happens |
 * |---|---|
 * | **A · wake** | turn 1 backgrounds `sleep`, then ends; the sleep finishes and the CLI wakes the agent |
 * | **B · resume-after-stop** | turn 1 backgrounds a long `sleep`, ends; the session is CLOSED (as a quit does, which stops it); a resume, then one message |
 * | **C · resume-control** | the same, with nothing in the background — the control F080 named |
 * | **D · local-command** | a person's `/cost`: no model, `num_turns: 0` |
 * | **E · usage-limit** | the model refuses with a five-hour 429 |
 * | **F · person**, **G · peer** | one message carrying the `origin` the app sends: a person's (`human`), an agent's (`peer`, no `fromMode`) |
 * | **H · compact**, **I · clear** | a turn, then a person's `/compact` or `/clear` as its own turn |
 *
 * ⚑ Every arm records the CLI's SDK frames in order, and the product adapter's events with the
 * moment each arrived, and which model request answered what (the scripted model echoes the last
 * user text it was given). ⚠️ This measures the CLI and the adapter; the scripted model is not a
 * model.
 *
 * Use `loopback-claude.ts` with no real token, spend, or personal state. Run `pnpm run
 * probe:claude-provider-burst` deliberately, outside `pnpm run ci`.
 */

const WORDS = {
  A: 'F080 probe A: background a short sleep, then stop',
  B: 'F080 probe B: background a long sleep, then stop',
  C: 'F080 probe C: say ok',
  F: 'F080 probe F: a person says ok',
  G: 'F080 probe G: an agent says ok',
} as const
const NOTICE = 'F080 probe notice: the app restarted and stopped your background work'

const TURN_MS = 60_000
/** ⚑ How long the CLI may take to wake the agent after the short sleep ends. */
const WAKE_MS = 60_000
/** ⚑ After the resume's first ending, how long anything more the CLI sends is still collected. */
const AFTER_MS = 15_000
const TEARDOWN_MS = 15_000
const SERIAL_WAITS_MS = [TURN_MS, WAKE_MS, AFTER_MS, TEARDOWN_MS]

type ArmName =
  | 'A-wake'
  | 'B-resume-after-stop'
  | 'C-resume-control'
  | 'D-local-command'
  | 'E-usage-limit'
  | 'F-person'
  | 'G-peer'
  | 'H-compact'
  | 'I-clear'
const ARMS: readonly ArmName[] = [
  'A-wake',
  'B-resume-after-stop',
  'C-resume-control',
  'D-local-command',
  'E-usage-limit',
  'F-person',
  'G-peer',
  'H-compact',
  'I-clear',
]

/** ⚑ The `origin` each arm's first message carries — what the app sends for a person or an agent. */
const ORIGIN: Partial<Record<ArmName, TurnProvenance>> = {
  'F-person': { kind: 'person' },
  'G-peer': { kind: 'peer', from: 'sess_f080_probe_parent', name: 'F080 probe parent' },
}
/** ⚑ The person's command each of these arms sends as a second turn, after the first ends. */
const THEN: Partial<Record<ArmName, string>> = { 'H-compact': '/compact', 'I-clear': '/clear' }

/** ⚑ Arm E's refusal — the unified headers a subscription's five-hour wall carries (`probe:claude-limit-notice`). */
const RESET_EPOCH_S = Math.floor(Date.now() / 1000) + 5_400
const REJECTED: Record<string, string> = {
  'anthropic-ratelimit-unified-status': 'rejected',
  'anthropic-ratelimit-unified-reset': String(RESET_EPOCH_S),
  'anthropic-ratelimit-unified-representative-claim': 'five_hour',
  'anthropic-ratelimit-unified-5h-status': 'rejected',
  'anthropic-ratelimit-unified-5h-reset': String(RESET_EPOCH_S),
  'anthropic-ratelimit-unified-5h-utilization': '1.0',
  'retry-after': '5400',
}

const deadline = probeRunDeadline(
  'F080 provider-burst probe',
  runBudgetMs(ARMS.flatMap(() => [...SERIAL_WAITS_MS, ...SERIAL_WAITS_MS])),
  TEARDOWN_MS,
)

/** The text of the LAST user message a model request carries — what that request answers. */
function lastUserText(request: SeenRequest): string {
  const body = request.body as { messages?: { role?: string; content?: unknown }[] } | null
  const users = (body?.messages ?? []).filter((one) => one.role === 'user')
  const last = users.at(-1)?.content
  if (typeof last === 'string') return last
  if (!Array.isArray(last)) return ''
  return last
    .map((block: { type?: string; text?: string; content?: unknown }) =>
      block.type === 'text'
        ? (block.text ?? '')
        : block.type === 'tool_result'
          ? `[tool_result] ${JSON.stringify(block.content ?? '').slice(0, 120)}`
          : `[${block.type ?? '?'}]`,
    )
    .join(' | ')
}

interface Stamped {
  readonly at: number
  readonly event: RuntimeEvent
}

interface Arm {
  readonly label: ArmName
  readonly cli: string | null
  readonly failure: string | null
  /** The frames of each life, as `type/subtype` and a short detail, in order. */
  readonly lives: {
    readonly frames: string[]
    readonly events: string[]
    /** ⚑ The life's raw frames, scrubbed ({@link scrub}) — what the fixture keeps. */
    readonly raw: unknown[]
    /** ⚑ The life's adapter events, in order. */
    readonly stream: RuntimeEvent[]
  }[]
  /** What each model request answered: the last user text it carried, and what the script said. */
  readonly requests: { readonly answered: string; readonly replied: string }[]
}

/** The uuids this app's messages carried in a life — what its results echoed back. */
function sentIn(frames: readonly SDKMessage[]): string[] {
  const sent = new Set<string>()
  for (const frame of frames) {
    const said = frame as { type?: string; user_message_uuid?: unknown }
    if (said.type === 'result' && typeof said.user_message_uuid === 'string') {
      sent.add(said.user_message_uuid)
    }
  }
  return [...sent]
}

/**
 * ⚑ A life's frames with this machine's paths — and its time zone, which the CLI prints beside a
 * reset — written out, and its uuids marked: the uuid this app sent as `<sent>`, which the replay
 * test puts its own in place of, and every other as `<uuid>`.
 */
function scrub(frames: readonly SDKMessage[], root: string): unknown[] {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  let text = JSON.stringify(frames)
  for (const one of sentIn(frames)) text = text.replaceAll(one, '<sent>')
  return JSON.parse(
    text
      .replaceAll(root, '<root>')
      .replaceAll(zone, '<tz>')
      .replaceAll(homedir(), '<home>')
      // ⚑ The CLI names a project's folder by its path with every `/` a `-` (`projects/-Users-…`).
      .replaceAll(homedir().replaceAll('/', '-'), '<home>')
      .replace(/\/private\/tmp\/claude-\d+[^"\\]*/g, '<tmp>')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>'),
  ) as unknown[]
}

function frameLine(frame: SDKMessage): string {
  const kind = `${frame.type}${'subtype' in frame && frame.subtype ? `/${String(frame.subtype)}` : ''}`
  if (frame.type === 'result') {
    const r = frame as unknown as {
      is_error?: boolean
      num_turns?: number
      result?: string
      terminal_reason?: string
      user_message_uuid?: string
      user_message_uuids?: string[]
      local_command?: string
    }
    return `${kind} is_error=${String(r.is_error)} num_turns=${String(r.num_turns)} terminal=${String(r.terminal_reason)} uuid=${String(r.user_message_uuid)} uuids=${JSON.stringify(r.user_message_uuids)} local=${String(r.local_command)} result=${JSON.stringify((r.result ?? '').slice(0, 60))}`
  }
  if (frame.type === 'assistant') {
    const content = (
      frame.message as { content?: { type?: string; text?: string; name?: string }[] }
    ).content
    return `${kind} ${JSON.stringify((content ?? []).map((c) => (c.type === 'text' ? c.text?.slice(0, 50) : `${c.type}:${c.name ?? ''}`)))}`
  }
  if (frame.type === 'user') {
    return `${kind} ${JSON.stringify(JSON.stringify((frame as { message?: unknown }).message ?? '').slice(0, 90))}`
  }
  if (frame.type === 'system') {
    const s = frame as unknown as { status?: string; task_id?: string; summary?: string }
    return `${kind}${s.status ? ` status=${s.status}` : ''}${s.task_id ? ` task=${s.task_id}` : ''}${s.summary ? ` ${JSON.stringify(s.summary.slice(0, 50))}` : ''}`
  }
  return kind
}

function eventLine(stamped: Stamped, t0: number): string {
  const { event } = stamped
  const at = `+${String(stamped.at - t0).padStart(6)}ms`
  if (event.type === 'status') return `${at} status ${event.state}`
  if (event.type === 'turn')
    return `${at} turn ${event.state}${event.wordOf ? ` (${event.wordOf})` : ''}${event.startedBy ? ` startedBy=${event.startedBy}` : ''}`
  if (event.type === 'session') return `${at} session ${event.state}`
  if (event.type === 'assistant_message')
    return `${at} assistant_message ${JSON.stringify(event.text.slice(0, 50))}`
  if (event.type === 'background_work') {
    return `${at} background_work ${event.running ? `running=${event.running.length}` : ''}${event.ended ? ` ended=${event.ended.outcome}` : ''}`
  }
  if (event.type === 'error') return `${at} error ${JSON.stringify(event.message.slice(0, 70))}`
  return `${at} ${event.type}`
}

async function measure(label: ArmName): Promise<Arm> {
  deadline.refuse(`starting arm ${label}`)
  const replied: { answered: string; replied: string }[] = []
  const words =
    label === 'A-wake'
      ? WORDS.A
      : label === 'B-resume-after-stop'
        ? WORDS.B
        : label === 'D-local-command'
          ? '/cost'
          : label === 'F-person'
            ? WORDS.F
            : label === 'G-peer'
              ? WORDS.G
              : WORDS.C
  const sleepFor = label === 'A-wake' ? 4 : 600
  const loopback = await startLoopback((request) => {
    const answered = lastUserText(request)
    let reply:
      | { kind: 'text'; text: string }
      | {
          kind: 'tool_use'
          name: string
          input: Record<string, unknown>
          id: string
        }
    if (label === 'E-usage-limit') {
      replied.push({ answered: answered.slice(0, 120), replied: '429 rejected' })
      return {
        kind: 'status',
        status: 429,
        headers: REJECTED,
        body: {
          type: 'error',
          error: {
            type: 'rate_limit_error',
            message: 'This request would exceed your rate limit.',
          },
        },
      }
    }
    if (answered.includes(words) && (label === 'A-wake' || label === 'B-resume-after-stop')) {
      reply = {
        kind: 'tool_use',
        id: `toolu_f080_${label.slice(0, 1)}`,
        name: 'Bash',
        input: {
          command: `sleep ${String(sleepFor)}`,
          description: 'F080 probe sleeper',
          run_in_background: true,
        },
      }
    } else if (answered.startsWith('[tool_result]')) {
      reply = { kind: 'text', text: 'PROBE-REPLY: the sleep is running in the background' }
    } else {
      reply = { kind: 'text', text: `PROBE-REPLY to: ${answered.slice(0, 60)}` }
    }
    replied.push({ answered: answered.slice(0, 120), replied: JSON.stringify(reply).slice(0, 120) })
    return reply
  })
  let handle: SessionHandle | null = null
  const release = deadline.own(async () => {
    if (handle !== null) await closeBounded(handle, TEARDOWN_MS)
    await loopback.close()
  })
  const lives: Arm['lives'][number][] = []
  let failure: string | null = null
  let rig: Awaited<ReturnType<typeof loopbackRuntime>> | null = null
  try {
    rig = await loopbackRuntime({
      scratch: runScratch('provider-burst'),
      label,
      port: loopback.port,
      maxRetries: 0,
    })
    const context = {
      providerHome: rig.providerHome,
      model: 'claude-haiku-4-5',
      approvalMode: 'auto' as const,
    }
    const live = async (
      open: () => Promise<SessionHandle>,
      run: (h: SessionHandle, stamped: Stamped[]) => Promise<void>,
    ): Promise<SessionRef | null> => {
      const framesFrom = rig!.recorded.frames.length
      const stamped: Stamped[] = []
      const t0 = Date.now()
      const opened = await open()
      handle = opened
      void (async () => {
        for await (const event of opened.events()) stamped.push({ at: Date.now(), event })
      })()
      await run(opened, stamped)
      const ref = opened.ref
      await closeBounded(opened, TEARDOWN_MS)
      handle = null
      await new Promise((resolve) => setTimeout(resolve, 500))
      const frames = rig!.recorded.frames.slice(framesFrom)
      lives.push({
        frames: frames.map(frameLine),
        events: stamped.map((one) => eventLine(one, t0)),
        raw: scrub(frames, rig!.root),
        stream: stamped.map((one) => one.event),
      })
      return ref
    }
    const turns = (stamped: Stamped[]): number =>
      stamped.filter((one) => one.event.type === 'turn').length
    // ── life 1: the turn that backgrounds the sleep (or, in C, says ok) ──────────────────────
    const ref = await live(
      () => rig!.runtime.start({ cwd: rig!.cwd, ...context }),
      async (opened, stamped) => {
        await opened.send(words, ORIGIN[label])
        await until(() => turns(stamped) >= 1, TURN_MS, 'turn 1 to end')
        const then = THEN[label]
        if (then !== undefined) {
          await until(() => opened.status() === 'idle', TURN_MS, 'the session to settle')
          await opened.send(then)
          await until(() => turns(stamped) >= 2, TURN_MS, `${then} to end`)
        }
        if (label === 'A-wake') {
          // ⚑ The sleep ends ~4 s later and the CLI wakes the agent by itself.
          const requests = replied.length
          await until(
            () =>
              replied.length > requests &&
              stamped.some(
                (one, at) =>
                  at > 0 &&
                  one.event.type === 'status' &&
                  one.event.state === 'idle' &&
                  stamped
                    .slice(0, at)
                    .filter((s) => s.event.type === 'status' && s.event.state === 'idle').length >=
                    1,
              ),
            WAKE_MS,
            'the CLI to wake the agent and go idle again',
          )
          await new Promise((resolve) => setTimeout(resolve, 3_000))
        } else {
          await new Promise((resolve) => setTimeout(resolve, 2_000))
        }
      },
    )
    if (label === 'B-resume-after-stop' || label === 'C-resume-control') {
      if (ref === null) throw new Error('NOT PERFORMED — life 1 left no ref to resume')
      // ── life 2: the resume, and one message — as the app's restart wake sends its notice ──
      await live(
        () => rig!.runtime.resume(ref, context),
        async (opened, stamped) => {
          await opened.send(NOTICE)
          await until(() => turns(stamped) >= 1, TURN_MS, 'the resume’s turn to end')
          // ⚑ Anything the CLI sends after that first ending — the burst F080 saw.
          await new Promise((resolve) => setTimeout(resolve, AFTER_MS))
        },
      )
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  } finally {
    release()
    if (handle !== null) await closeBounded(handle, TEARDOWN_MS)
    await loopback.close()
  }
  const arm: Arm = {
    label,
    cli: rig === null ? null : announcedVersion(rig.recorded.frames),
    failure,
    lives,
    requests: replied,
  }
  writeFileSync(runEvidence(`provider-burst-${label}.json`), JSON.stringify(arm, null, 1))
  if (rig !== null) rmSync(rig.root, { recursive: true, force: true })
  return arm
}

async function run(): Promise<void> {
  const arms: Arm[] = []
  for (const label of ARMS) arms.push(await measure(label))
  for (const arm of arms) {
    console.log(
      `\n=== ${arm.label} · CLI ${String(arm.cli)}${arm.failure ? ` · FAILED: ${arm.failure}` : ''}`,
    )
    arm.lives.forEach((life, index) => {
      console.log(`--- life ${String(index + 1)} · frames`)
      for (const line of life.frames) console.log(`  ${line}`)
      console.log(`--- life ${String(index + 1)} · adapter events`)
      for (const line of life.events) console.log(`  ${line}`)
    })
    console.log('--- model requests')
    for (const one of arm.requests)
      console.log(`  answered ${JSON.stringify(one.answered)} → ${one.replied}`)
  }
  for (const arm of arms) expect(arm.failure, `${arm.label} · ran`).toBeNull()
  const byLabel = new Map(arms.map((arm) => [arm.label, arm]))
  const arm = (label: ArmName): Arm => byLabel.get(label)!
  const events = (label: ArmName, life: number): RuntimeEvent[] =>
    arm(label).lives[life]?.stream ?? []
  const results = (label: ArmName, life: number): { uuid: unknown }[] =>
    (arm(label).lives[life]?.raw ?? []).flatMap((frame) => {
      const said = frame as { type?: string; user_message_uuid?: unknown }
      return said.type === 'result' ? [{ uuid: said.user_message_uuid }] : []
    })

  // ⚑ The CLI: every result that answers one of this app's messages names it; its own loops none.
  expect(results('A-wake', 0).map((one) => one.uuid)).toEqual(['<sent>', undefined])
  expect(results('B-resume-after-stop', 1).map((one) => one.uuid)).toEqual([undefined, '<sent>'])
  expect(results('C-resume-control', 1).map((one) => one.uuid)).toEqual(['<sent>'])
  expect(results('D-local-command', 0).map((one) => one.uuid)).toEqual(['<sent>'])
  expect(results('E-usage-limit', 0).map((one) => one.uuid)).toEqual(['<sent>'])
  // ⚑ …whoever wrote it: a person's message and an agent's, as the app sends them…
  expect(results('F-person', 0).map((one) => one.uuid)).toEqual(['<sent>'])
  expect(results('G-peer', 0).map((one) => one.uuid)).toEqual(['<sent>'])
  // ⚑ …and a person's `/compact` and `/clear`, each its own turn.
  expect(results('H-compact', 0).map((one) => one.uuid)).toEqual(['<sent>', '<sent>'])
  expect(results('I-clear', 0).map((one) => one.uuid)).toEqual(['<sent>', '<sent>'])
  for (const label of ['F-person', 'G-peer', 'H-compact', 'I-clear'] as const) {
    const said = events(label, 0)
    expect(
      said.filter((one) => one.type === 'turn').map((one) => one.type === 'turn' && one.state),
      `${label} · every turn ends, on its own result`,
    ).toEqual(
      label === 'F-person' || label === 'G-peer' ? ['completed'] : ['completed', 'completed'],
    )
    expect(
      said.some((one) => one.type === 'provider_turn'),
      `${label} · no provider turn`,
    ).toBe(false)
  }

  // ⚑ The adapter: A's wake is a turn the provider started, written before its content.
  const wake = events('A-wake', 0)
  const began = wake.findIndex((one) => one.type === 'provider_turn')
  expect(began, 'A · the wake opened a provider turn').toBeGreaterThan(0)
  expect(wake.slice(began).find((one) => one.type === 'turn')).toMatchObject({
    type: 'turn',
    state: 'completed',
    startedBy: 'the-provider',
  })
  const firstWakeWords = wake.findIndex((one, at) => at > began && one.type === 'assistant_message')
  expect(firstWakeWords, 'A · the wake’s words come inside it').toBeGreaterThan(began)
  // ⚑ B's resume: ONE turn, and it ends after the model's answer — never on the CLI's empty loop.
  const resumed = events('B-resume-after-stop', 1)
  const ended = resumed.flatMap((one, at) => (one.type === 'turn' ? [at] : []))
  expect(ended, 'B · one turn').toHaveLength(1)
  expect(
    resumed.some((one) => one.type === 'provider_turn'),
    'B · no provider turn',
  ).toBe(false)
  expect(
    resumed.findIndex((one) => one.type === 'assistant_message'),
    'B · the answer comes before the turn ends',
  ).toBeLessThan(ended[0]!)
  // ⚑ E — a refused turn is ours, and fails with its limit.
  expect(events('E-usage-limit', 0).find((one) => one.type === 'turn')).toMatchObject({
    state: 'failed',
    limit: { provider: 'claude', window: 'five_hour' },
  })

  writeFileSync(
    new URL('../test/fixtures/claude-provider-bursts.json', import.meta.url),
    `${JSON.stringify(
      {
        cli: arms[0]?.cli ?? null,
        arms: Object.fromEntries(
          arms.map((one) => [
            one.label,
            { lives: one.lives.map((life) => ({ frames: life.raw })) },
          ]),
        ),
      },
      null,
      1,
    )}\n`,
  )
}

it(
  'F080 · what Claude Code sends when it starts work by itself, and what the adapter makes of it',
  () => deadline.within('measuring arms A–I', run),
  deadline.testTimeoutMs,
)
