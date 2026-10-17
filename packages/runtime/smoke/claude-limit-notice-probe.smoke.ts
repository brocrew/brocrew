import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'
import type { RuntimeEvent } from '../src/events'
import type { SessionHandle } from '../src/runtime'
import {
  announcedVersion,
  closeBounded,
  firstUserText,
  loopbackRuntime,
  startLoopback,
  until,
  type ScriptedReply,
} from './loopback-claude'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

/**
 * 🔴 **695 · F4 — what the bundled CLI sends when a turn hits a usage wall, and whether BroBot's wall
 * still hears it** (`680` F4).
 *
 * ## ⚑ Why it had to be measured
 *
 * `680` moved a CLI notice's words onto the error event's `message` (R28a/b) — and a `rate_limit`
 * notice's words are the CLI's own *"You've hit your session limit · resets 3pm (…)"*, which
 * `readProviderLimit` does not read. Before 680 that event said `claude is rate-limited`, which it
 * did. ⚠️ So a wall was lost **unless** the CLI also sends a `rate_limit_event` — the other channel,
 * which 680 did not touch. Only the CLI can say which it sends, so this asks it.
 *
 * | arm | what the scripted endpoint answers the turn with |
 * |---|---|
 * | **usage-limit** | `429` with the unified headers a subscription's wall carries — `status: rejected`, the five-hour claim, a reset — the SUBJECT |
 * | **bare-429** | `429` with no unified headers — a throttle that names no limit |
 * | **warning** | `200` and a reply, with `status: allowed_warning` — the CONTROL: the channel speaks when nothing is refused |
 *
 * ⚑ `CLAUDE_CODE_MAX_RETRIES=0` in every arm, so a `429` is answered once rather than retried
 * for minutes. The SDK frames of each arm are written to `test/fixtures/claude-limit-notice.json`
 * — the fixture `a-wall-the-cli-announces.test.ts` reads — with this run's paths written out.
 *
 * `loopback-claude.ts` uses no token or spend and touches no personal state. It captures the
 * provider’s model-bound request rather than hosted-model obedience. Run `pnpm run
 * probe:claude-limit-notice` deliberately, outside `pnpm run ci`.
 */

const WORDS = '695 limit-notice probe: reply ok'

/** A reset an hour and a half after the run starts, in the headers' own unit — epoch seconds. */
const RESET_EPOCH_S = Math.floor(Date.now() / 1000) + 5_400

const REJECTED: Record<string, string> = {
  'anthropic-ratelimit-unified-status': 'rejected',
  'anthropic-ratelimit-unified-reset': String(RESET_EPOCH_S),
  'anthropic-ratelimit-unified-representative-claim': 'five_hour',
  'anthropic-ratelimit-unified-5h-status': 'rejected',
  'anthropic-ratelimit-unified-5h-reset': String(RESET_EPOCH_S),
  'anthropic-ratelimit-unified-5h-utilization': '1.0',
  'anthropic-ratelimit-unified-7d-utilization': '0.4',
  'anthropic-ratelimit-unified-fallback': 'available',
  'retry-after': '5400',
}

const WARNING: Record<string, string> = {
  'anthropic-ratelimit-unified-status': 'allowed_warning',
  'anthropic-ratelimit-unified-reset': String(RESET_EPOCH_S),
  'anthropic-ratelimit-unified-representative-claim': 'five_hour',
  'anthropic-ratelimit-unified-5h-status': 'allowed_warning',
  'anthropic-ratelimit-unified-5h-reset': String(RESET_EPOCH_S),
  'anthropic-ratelimit-unified-5h-utilization': '0.92',
  'anthropic-ratelimit-unified-5h-surpassed-threshold': '0.9',
}

const RATE_LIMIT_BODY = {
  type: 'error',
  error: { type: 'rate_limit_error', message: 'This request would exceed your rate limit.' },
}

const ARMS = {
  'usage-limit': (): ScriptedReply => ({
    kind: 'status',
    status: 429,
    headers: REJECTED,
    body: RATE_LIMIT_BODY,
  }),
  'bare-429': (): ScriptedReply => ({
    kind: 'status',
    status: 429,
    headers: {},
    body: RATE_LIMIT_BODY,
  }),
  warning: (): ScriptedReply => ({ kind: 'text', text: 'ok', headers: WARNING }),
} as const

type ArmName = keyof typeof ARMS

const TURN_MS = 90_000
const TEARDOWN_MS = 15_000

const deadline = probeRunDeadline(
  '695 limit-notice probe',
  runBudgetMs(Object.keys(ARMS).flatMap(() => [TURN_MS, TEARDOWN_MS])),
  TEARDOWN_MS,
)

interface Arm {
  readonly label: ArmName
  readonly cli: string | null
  readonly listenedOn: number
  readonly configuredPort: number | null
  readonly frames: SDKMessage[]
  readonly events: RuntimeEvent[]
  readonly failure: string | null
  readonly stderr: string
  /** ⚑ Rule 40 — the arm's own turn arrived, on the port this process listened on. */
  readonly reachedThisPort: boolean
}

const captured: Partial<Record<ArmName, Arm>> = {}

/**
 * This run's own paths — and the machine's time zone, which the CLI prints beside a reset — written
 * out, so the fixture says nothing about the machine it came from.
 */
function scrub(value: unknown, root: string): unknown {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return JSON.parse(
    JSON.stringify(value)
      .replaceAll(root, '<root>')
      .replaceAll(zone, '<tz>')
      .replace(/\/tmp\/cc-socks\/\d+\.sock/g, '<socket>')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>'),
  ) as unknown
}

async function measure(label: ArmName): Promise<Arm> {
  deadline.refuse(`starting arm ${label}`)
  const loopback = await startLoopback((request) =>
    firstUserText(request).includes(WORDS) ? ARMS[label]() : { kind: 'text', text: 'ok' },
  )
  let handle: SessionHandle | null = null
  // ⛔ The deadline's teardown owns the CLI child too — an expired arm must not leave it running.
  const release = deadline.own(async () => {
    if (handle !== null) await closeBounded(handle, TEARDOWN_MS)
    await loopback.close()
  })
  const events: RuntimeEvent[] = []
  let failure: string | null = null
  let rig: Awaited<ReturnType<typeof loopbackRuntime>> | null = null
  try {
    rig = await loopbackRuntime({
      scratch: runScratch('claude-limit-notice'),
      label,
      port: loopback.port,
      maxRetries: 0,
    })
    const started = await rig.runtime.start({
      cwd: rig.cwd,
      providerHome: rig.providerHome,
      model: 'claude-haiku-4-5',
    })
    handle = started
    void (async () => {
      for await (const event of started.events()) events.push(event)
    })()
    await started.send(WORDS)
    await until(() => events.some((one) => one.type === 'turn'), TURN_MS, 'the turn to close')
    // ⚑ A moment more: a limit event can trail the result it belongs to.
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
    frames: scrub(rig?.recorded.frames ?? [], root) as SDKMessage[],
    events: scrub(events, root) as RuntimeEvent[],
    failure,
    stderr: rig?.recorded.stderr ?? '',
    reachedThisPort: loopback.requests.some(
      (one) => one.localPort === loopback.port && firstUserText(one).includes(WORDS),
    ),
  }
  captured[label] = arm
  const evidence = runEvidence('claude-limit-notice')
  mkdirSync(evidence, { recursive: true })
  writeFileSync(join(evidence, `${label}.json`), `${JSON.stringify(arm, null, 2)}\n`)
  if (failure === null && rig !== null) rmSync(rig.root, { recursive: true, force: true })
  const said = arm.frames.flatMap((frame): unknown[] => {
    const f = frame as {
      type?: string
      error?: string
      message?: { model?: string; content?: { type?: string; text?: string }[] }
      rate_limit_info?: unknown
      is_api_error_message?: boolean
    }
    if (f.type === 'assistant')
      return [
        {
          assistant: f.message?.model,
          error: f.error ?? null,
          flag: f.is_api_error_message ?? null,
          text: (f.message?.content ?? []).map((one) => one.text ?? '').join(''),
        },
      ]
    if (f.type === 'rate_limit_event') return [{ rateLimitEvent: f.rate_limit_info }]
    return []
  })
  console.log(
    `[695 limit notice · ${label}]`,
    JSON.stringify(
      {
        cli: arm.cli,
        said,
        errors: arm.events.flatMap((one) => (one.type === 'error' ? [one.message] : [])),
        failure,
      },
      null,
      2,
    ),
  )
  return arm
}

for (const label of Object.keys(ARMS) as ArmName[]) {
  it(
    `695 · ${label}`,
    () =>
      deadline.within(`arm ${label}`, async () => {
        const arm = await measure(label)
        expect(arm.failure, arm.stderr).toBeNull()
        expect(arm.configuredPort).toBe(arm.listenedOn)
        expect(arm.cli).not.toBeNull()
        // ⛔ A turn that never reached the scripted endpoint captured some OTHER answer.
        expect(arm.reachedThisPort, 'the turn never reached this loopback').toBe(true)
      }),
    deadline.testTimeoutMs,
  )
}

it(
  '695 · the fixture, written from all three arms',
  () =>
    deadline.within('the fixture', async () => {
      const arms = Object.keys(ARMS) as ArmName[]
      expect(arms.every((one) => captured[one]?.failure === null)).toBe(true)
      expect(arms.every((one) => captured[one]?.reachedThisPort === true)).toBe(true)
      const fixture = {
        _about:
          '695 F4 — the SDK frames the bundled CLI sent for a usage wall (usage-limit), a bare 429 (bare-429) and a warning (warning), captured by probe:claude-limit-notice against a loopback endpoint. Paths written <root>.',
        cli: captured['usage-limit']?.cli ?? null,
        arms: Object.fromEntries(arms.map((one) => [one, { frames: captured[one]?.frames ?? [] }])),
      }
      writeFileSync(
        fileURLToPath(new URL('../test/fixtures/claude-limit-notice.json', import.meta.url)),
        `${JSON.stringify(fixture, null, 2)}\n`,
      )
    }),
  deadline.testTimeoutMs,
)
