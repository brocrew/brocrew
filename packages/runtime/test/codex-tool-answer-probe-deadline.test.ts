import { describe, expect, it } from 'vitest'
import { pinsOver, probeSource, squash } from './fixtures/probe-source'

/**
 * ⛔ **`457`'s tool-answer probe — its outer deadline** (`669`, from `655` §4).
 *
 * This probe runs only under `vitest.smoke.config.ts`, so `pnpm run ci` never executes it. ⚠️ Until
 * `669` it had no bound but vitest's own per-test default. ⚑ What is measured HERE is how it wires in
 * `smoke/probe-run-deadline.ts` (tested under fake timers).
 */

const source = probeSource('codex-tool-answer-probe.smoke.ts')
const code = squash(source)
const { occurrences, region } = pinsOver(source)

describe('669 · the 457 probe runs inside one derived outer deadline', () => {
  it('⛔ the budget is counted from the waits each arm makes, over the arms it runs', () => {
    expect(region('const TURN_DEADLINE_MS =', 'function configuredPortOf(')).toBe(
      squash(`
        const TURN_DEADLINE_MS = 60_000
        const RPC_DEADLINE_MS = 30_000
        const SETTLE_MS = 5_000
        const EXIT_GRACE_MS = 2_000
        const KILL_GRACE_MS = 2_000
        const TEARDOWN_MS = EXIT_GRACE_MS + 2 * KILL_GRACE_MS
        const SERIAL_WAITS_MS = [RPC_DEADLINE_MS, RPC_DEADLINE_MS, TURN_DEADLINE_MS, SETTLE_MS, TEARDOWN_MS]
        const deadline = probeRunDeadline(
          '457 tool-answer probe',
          runBudgetMs(Object.keys(ARMS).flatMap(() => SERIAL_WAITS_MS)),
          TEARDOWN_MS,
        )
      `),
    )
    // ⛔ Two arms, both keyed from `ARMS` — an arm the budget does not count cannot run.
    expect(code.match(/await capture\('[AB]-[a-z-]+'\)/g)).toEqual([
      "await capture('A-one-item')",
      "await capture('B-two-items')",
    ])
    expect(occurrences('const contentItems = ARMS[label]')).toBe(1)
    expect(code.match(/deadline\.testTimeoutMs/g)).toHaveLength(1)
    // ⚑ The settle and the turn wait are the named bounds the budget counts, not literals.
    expect(occurrences('const itemBy = Date.now() + TURN_DEADLINE_MS')).toBe(1)
    expect(occurrences('const settle = Date.now() + SETTLE_MS')).toBe(1)
  })

  it('⛔ each arm refuses to start past the deadline, and owns its teardown before anything exists', () => {
    const order = [
      'async function capture(label: keyof typeof ARMS): Promise<Arm> { deadline.refuse(`starting arm ${label}`)',
      'const release = deadline.own(() => closeOwnedCapture())',
      'listenedOn = await listen(server)',
      'deadline.refuse(`starting arm ${label} · the loopback port is bound`)',
      'transport = new SpawnCodexTransport(',
    ].map((text) => code.indexOf(squash(text)))
    expect(order.every((at) => at > -1)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(occurrences("await bounded( 'initialize',")).toBe(1)
    expect(occurrences("await bounded( 'thread/start',")).toBe(1)
    expect(
      occurrences('} finally { try { await closeOwnedCapture() } finally { release() } }'),
    ).toBe(1)
  })

  it('⛔ roots are deleted only after every expectation — and rule 40 is one of them', () => {
    const capture = region('async function capture(', 'const isolateSaw =')
    expect(capture).not.toContain('rmSync(')
    const measure = code.slice(code.indexOf(squash('async function measureBothArms(')))
    expect(measure.indexOf('rmSync(arm.root')).toBeGreaterThan(measure.lastIndexOf('expect('))
    expect(
      occurrences(
        "expect(arm.configuredPort, `${arm.label} · the port in the child's config`).toBe( arm.listenedOn, )",
      ),
    ).toBe(1)
  })
})
