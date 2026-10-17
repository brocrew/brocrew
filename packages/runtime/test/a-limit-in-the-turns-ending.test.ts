import { readFileSync } from 'node:fs'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import type { RuntimeEvent } from '../src/events'
import { ClaudeLimitWatch, claudeResultOutcome } from '../src/claude/normalize'
import { RateLimitWatch, codexTurnHitItsUsageLimit } from '../src/codex/normalize'
import { SessionMachine } from '../src/internal/session-machine'

/**
 * # 🔴 F074 — a usage limit is recorded IN the turn's ending
 *
 * ⚑ Measured on 2026-10-02: a helper's turn ended on Claude's five-hour limit and its giver was told
 * *"its turn ended with this work still open"*, with the limit only among the errors around it. ⚑ Now
 * the `turn` row carries `limit` — whose, which window, and the reset the provider gave.
 *
 *  - §1 · Claude, from the frames the bundled CLI really sends (`claude-limit-notice.json`, the
 *    reset moved ahead of today so the frames stay a limit still in force).
 *  - §2 · Codex, from `TurnError.codexErrorInfo` and the rate-limit reads.
 *  - §3 · the machine writes it on a `failed` ending only.
 *
 * ⛔ Fake values only: no login, no provider.
 */

interface Fixture {
  readonly arms: Record<'usage-limit' | 'bare-429' | 'warning', { frames: SDKMessage[] }>
}

const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/claude-limit-notice.json', import.meta.url), 'utf8'),
) as Fixture

/** ⚑ An hour from now, in the frames' own unit — epoch seconds. */
const AHEAD_S = Math.floor(Date.now() / 1000) + 3_600

/** The arm's frames with every `resetsAt` moved to {@link AHEAD_S}. */
function framesOf(arm: keyof Fixture['arms'], resetsAt: number = AHEAD_S): SDKMessage[] {
  return JSON.parse(
    JSON.stringify(FIXTURE.arms[arm].frames).replace(/"resetsAt":\d+/g, `"resetsAt":${resetsAt}`),
  ) as SDKMessage[]
}

/** ⚑ What the adapter's run loop does with each frame: observe it, and end the turn at `result`. */
function endingOf(watch: ClaudeLimitWatch, frames: readonly SDKMessage[]) {
  let ending: { outcome: string; limit: unknown } | null = null
  for (const frame of frames) {
    watch.observe(frame)
    const outcome = claudeResultOutcome(frame)
    if (outcome) {
      ending = { outcome: outcome.outcome, limit: watch.turnEnded(outcome.outcome, Date.now()) }
    }
  }
  return ending
}

describe('F074 · a usage limit is recorded in the turn’s ending', () => {
  describe('§1 · Claude', () => {
    it('🔴 the usage-limit arm: the failed turn names Claude’s limit, its window and its reset', () => {
      expect(endingOf(new ClaudeLimitWatch(), framesOf('usage-limit'))).toEqual({
        outcome: 'failed',
        limit: { provider: 'claude', window: 'five_hour', resetsAt: AHEAD_S * 1000 },
      })
    })

    it('⛔ the bare 429 — “not your usage limit” — names no limit: the event named no window', () => {
      expect(endingOf(new ClaudeLimitWatch(), framesOf('bare-429'))).toEqual({
        outcome: 'failed',
        limit: undefined,
      })
    })

    it('⛔ the warning arm: a turn that completed names nothing, though the window was nearly spent', () => {
      expect(endingOf(new ClaudeLimitWatch(), framesOf('warning'))).toEqual({
        outcome: 'completed',
        limit: undefined,
      })
    })

    it('⛔ the same frames without the reply’s rate_limit mark name nothing — the event alone is no ending', () => {
      const frames = framesOf('usage-limit').filter((frame) => frame.type !== 'assistant')
      expect(endingOf(new ClaudeLimitWatch(), frames)).toEqual({
        outcome: 'failed',
        limit: undefined,
      })
    })

    it('⚑ a second refused turn with no event of its own (the CLI sends one per reset per 30 s) still names the limit', () => {
      const watch = new ClaudeLimitWatch()
      endingOf(watch, framesOf('usage-limit'))
      const again = framesOf('usage-limit').filter((frame) => frame.type !== 'rate_limit_event')
      expect(endingOf(watch, again)?.limit).toEqual({
        provider: 'claude',
        window: 'five_hour',
        resetsAt: AHEAD_S * 1000,
      })
    })

    it('⛔ …but not once an `allowed` event cleared it, nor once its reset has passed', () => {
      const cleared = new ClaudeLimitWatch()
      endingOf(cleared, framesOf('usage-limit'))
      cleared.observe({
        type: 'rate_limit_event',
        rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour' },
      } as unknown as SDKMessage)
      const again = framesOf('usage-limit').filter((frame) => frame.type !== 'rate_limit_event')
      expect(endingOf(cleared, again)?.limit).toBeUndefined()

      const passed = Math.floor(Date.now() / 1000) - 60
      expect(
        endingOf(new ClaudeLimitWatch(), framesOf('usage-limit', passed))?.limit,
      ).toBeUndefined()
    })

    it('⚑ a limit whose event says credits are required says so: its reset alone does not end it', () => {
      const frames = framesOf('usage-limit').map((frame) =>
        frame.type === 'rate_limit_event'
          ? ({
              ...frame,
              rate_limit_info: {
                ...(frame as unknown as { rate_limit_info: object }).rate_limit_info,
                errorCode: 'credits_required',
              },
            } as unknown as SDKMessage)
          : frame,
      )
      expect(endingOf(new ClaudeLimitWatch(), frames)).toEqual({
        outcome: 'failed',
        limit: {
          provider: 'claude',
          window: 'five_hour',
          resetsAt: AHEAD_S * 1000,
          creditsRequired: true,
        },
      })
    })
  })

  describe('§2 · Codex', () => {
    const failed = (codexErrorInfo: unknown): unknown => ({
      turn: { id: 't', status: 'failed', error: { message: 'x', codexErrorInfo } },
    })

    it('🔴 only `usageLimitExceeded` is a usage limit, and only on a failed turn', () => {
      expect(codexTurnHitItsUsageLimit(failed('usageLimitExceeded'))).toBe(true)
      expect(codexTurnHitItsUsageLimit(failed('rateLimitExceeded'))).toBe(false)
      expect(codexTurnHitItsUsageLimit(failed(null))).toBe(false)
      expect(
        codexTurnHitItsUsageLimit({
          turn: { id: 't', status: 'completed', error: { codexErrorInfo: 'usageLimitExceeded' } },
        }),
      ).toBe(false)
    })

    const AT_THE_WALL = {
      limitId: 'codex',
      limitName: null,
      rateLimitReachedType: 'rate_limit_reached',
      primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: AHEAD_S },
      secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: AHEAD_S + 86_400 },
    }

    it('⚑ the limit is the main bucket’s marker and its fullest window’s reset', () => {
      const watch = new RateLimitWatch()
      watch.observe(AT_THE_WALL)
      expect(watch.reachedLimit()).toEqual({
        provider: 'codex',
        window: 'rate_limit_reached',
        resetsAt: AHEAD_S * 1000,
      })
    })

    it('⚑ with both windows full, the reset is the later one — the turn goes only once both have reset', () => {
      const watch = new RateLimitWatch()
      watch.observe({
        ...AT_THE_WALL,
        secondary: { usedPercent: 100, windowDurationMins: 10080, resetsAt: AHEAD_S + 86_400 },
      })
      expect(watch.reachedLimit().resetsAt).toBe((AHEAD_S + 86_400) * 1000)
    })

    it('⛔ depleted credits name no reset — no window resets credits', () => {
      const watch = new RateLimitWatch()
      watch.observe({ ...AT_THE_WALL, rateLimitReachedType: 'workspace_member_credits_depleted' })
      expect(watch.reachedLimit()).toEqual({
        provider: 'codex',
        window: 'workspace_member_credits_depleted',
      })
    })

    it('⛔ while Codex says ordinary usage is not allowed, the ending names no reset', () => {
      const watch = new RateLimitWatch()
      watch.seed({
        rateLimits: AT_THE_WALL,
        rateLimitsByLimitId: { codex: AT_THE_WALL },
        ordinaryUsageAllowed: false,
      })
      expect(watch.reachedLimit()).toEqual({ provider: 'codex', window: 'rate_limit_reached' })
    })

    it('⚑ with nothing read yet, the ending still says whose limit it was', () => {
      expect(new RateLimitWatch().reachedLimit()).toEqual({ provider: 'codex' })
    })
  })

  describe('§3 · the machine', () => {
    const LIMIT = { provider: 'claude' as const, window: 'five_hour', resetsAt: AHEAD_S * 1000 }

    function machineSaying(): { machine: SessionMachine; said: RuntimeEvent[] } {
      const said: RuntimeEvent[] = []
      const machine = new SessionMachine((event) => said.push(event))
      machine.markStarting()
      machine.sessionStarted(
        { provider: 'claude', sessionId: 's', cwd: '/tmp' } as never,
        'started',
      )
      return { machine, said }
    }

    it('🔴 a failed turn carries the limit on its `turn` row, after the error that states it', () => {
      const { machine, said } = machineSaying()
      machine.beginTurn()
      machine.completeTurn('failed', "turn failed: You've hit your session limit", LIMIT)
      const ending = said.findIndex((event) => event.type === 'turn')
      expect(said[ending]).toEqual({ type: 'turn', state: 'failed', limit: LIMIT })
      expect(said[ending - 1]).toMatchObject({ type: 'error', fatal: false })
    })

    it('⛔ a turn that completed carries none, whatever it is handed', () => {
      const { machine, said } = machineSaying()
      machine.beginTurn()
      machine.completeTurn('completed', undefined, LIMIT)
      expect(said.find((event) => event.type === 'turn')).toEqual({
        type: 'turn',
        state: 'completed',
      })
    })
  })
})
