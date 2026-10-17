import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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
 * 🔴 **F096 — whether the bundled CLI carries the WEEKLY window to BroBot, and in what shape.**
 *
 * The CLI builds `rate_limit_info.unifiedWindows` from the API's
 * `anthropic-ratelimit-unified-{5h,7d,…}-{utilization,reset}` headers, and includes a window only
 * when the API sent both its figure and its reset. Whether a real account's responses carry the 7d
 * headers only that account can say; **what the CLI and BroBot make of them when they do** a
 * stand-in can, and that is what this asks: an ordinary `200` answer carrying the five-hour and the
 * seven-day headers, then the `provider_usage` reading BroBot's adapter takes from the frame.
 *
 * 🔒 `loopback-claude.ts`'s recipe — no token, no spend, nothing of anyone's account. Run:
 * `pnpm run probe:claude-usage-windows`. Not part of `pnpm run ci`.
 */
const WORDS = 'F096 usage-windows probe: reply ok'

/** Each window's reset, in the headers' own unit — epoch seconds. */
const NOW_S = Math.floor(Date.now() / 1000)
const FIVE_HOUR_RESET_S = NOW_S + 3 * 3_600
const SEVEN_DAY_RESET_S = NOW_S + 4 * 86_400

const ALLOWED_WITH_BOTH_WINDOWS: Record<string, string> = {
  'anthropic-ratelimit-unified-status': 'allowed',
  'anthropic-ratelimit-unified-reset': String(FIVE_HOUR_RESET_S),
  'anthropic-ratelimit-unified-representative-claim': 'five_hour',
  'anthropic-ratelimit-unified-5h-status': 'allowed',
  'anthropic-ratelimit-unified-5h-reset': String(FIVE_HOUR_RESET_S),
  'anthropic-ratelimit-unified-5h-utilization': '0.12',
  'anthropic-ratelimit-unified-7d-status': 'allowed',
  'anthropic-ratelimit-unified-7d-reset': String(SEVEN_DAY_RESET_S),
  'anthropic-ratelimit-unified-7d-utilization': '0.34',
}

const TURN_MS = 90_000
const TEARDOWN_MS = 15_000

const deadline = probeRunDeadline(
  'F096 usage-windows probe',
  runBudgetMs([TURN_MS, TEARDOWN_MS]),
  TEARDOWN_MS,
)

it(
  'F096 · the weekly window, from the API headers through the CLI to BroBot’s reading',
  () =>
    deadline.within('the one arm', async () => {
      const loopback = await startLoopback((request): ScriptedReply =>
        firstUserText(request).includes(WORDS)
          ? { kind: 'text', text: 'ok', headers: ALLOWED_WITH_BOTH_WINDOWS }
          : { kind: 'text', text: 'ok' },
      )
      let handle: SessionHandle | null = null
      const release = deadline.own(async () => {
        if (handle !== null) await closeBounded(handle, TEARDOWN_MS)
        await loopback.close()
      })
      const events: RuntimeEvent[] = []
      let rig: Awaited<ReturnType<typeof loopbackRuntime>> | undefined
      try {
        rig = await loopbackRuntime({
          scratch: runScratch('claude-usage-windows'),
          label: 'weekly',
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
      } finally {
        if (handle !== null) await closeBounded(handle, TEARDOWN_MS)
        await loopback.close()
        release()
      }
      if (rig === undefined) throw new Error('the loopback runtime never started')

      const frames = rig.recorded.frames as SDKMessage[]
      const said = frames.flatMap((frame) => {
        const f = frame as { type?: string; rate_limit_info?: unknown }
        return f.type === 'rate_limit_event' ? [f.rate_limit_info] : []
      })
      const readings = events.flatMap((one) =>
        one.type === 'provider_usage' ? [one.readings] : [],
      )
      const evidence = runEvidence('claude-usage-windows')
      mkdirSync(evidence, { recursive: true })
      writeFileSync(
        join(evidence, 'weekly.json'),
        `${JSON.stringify({ cli: announcedVersion(rig.recorded.frames), said, readings }, null, 2)}\n`,
      )
      console.log('[F096 usage windows]', JSON.stringify({ said, readings }, null, 2))
      rmSync(rig.root, { recursive: true, force: true })

      expect(announcedVersion(rig.recorded.frames)).not.toBeNull()
      expect(
        loopback.requests.some(
          (one) => one.localPort === loopback.port && firstUserText(one).includes(WORDS),
        ),
        'the turn never reached this loopback',
      ).toBe(true)
      // 🔴 The CLI carries the weekly window, as a fraction and epoch seconds…
      expect(said).toContainEqual(
        expect.objectContaining({
          unifiedWindows: expect.objectContaining({
            seven_day: { utilization: 0.34, resetsAt: SEVEN_DAY_RESET_S },
          }),
        }),
      )
      // 🔴 …and BroBot reads it as a percentage and epoch ms, beside the five-hour window.
      expect(readings.flat()).toEqual(
        expect.arrayContaining([
          { window: 'seven_day', usedPercent: 34, resetsAt: SEVEN_DAY_RESET_S * 1000 },
          { window: 'five_hour', usedPercent: 12, resetsAt: FIVE_HOUR_RESET_S * 1000 },
        ]),
      )
    }),
  deadline.testTimeoutMs,
)
