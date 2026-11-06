import { describe, expect, it } from 'vitest'
import { pinsOver, probeSource, squash } from './fixtures/probe-source'

/**
 * ⛔ **`443`'s construction arm — its outer deadline, and the code that ran** (`669`, from `655` §4).
 *
 * This probe runs only under `vitest.smoke.config.ts`, so `pnpm run ci` never executes it. ⚠️ Until
 * `669` it had no bound but vitest's own per-test default, and a `TOTAL_MS` of eight minutes that was
 * typed rather than derived and checked only after the run had spent it. ⚑ What is measured HERE is
 * how it wires in `smoke/probe-run-deadline.ts`, and that the code is the code that ran.
 */

const source = probeSource('interruption-construction.smoke.ts')
const code = squash(source)
const { occurrences, region } = pinsOver(source)

describe('669 · the 443 probe runs inside one derived outer deadline', () => {
  it('⛔ the budget is counted from the waits each arm makes, and the typed total is gone', () => {
    expect(region('const STEP_MS =', 'interface TimedFrame {')).toBe(
      squash(`
        const STEP_MS = 45_000
        const HANDSHAKE_MS = 20_000
        const SAMPLE_MS = 500
        const EXIT_GRACE_MS = 2_000
        const KILL_GRACE_MS = 2_000
        const TEARDOWN_MS = 3 * HANDSHAKE_MS
        const ARMS = ['interrupt', 'control'] as const
        type ArmName = (typeof ARMS)[number]
        function serialWaitsMs(arm: ArmName): number[] {
          return [
            HANDSHAKE_MS,
            HANDSHAKE_MS,
            HANDSHAKE_MS,
            HANDSHAKE_MS,
            STEP_MS,
            ...(arm === 'interrupt' ? [STEP_MS, SAMPLE_MS] : [STEP_MS]),
            TEARDOWN_MS,
          ]
        }
        const deadline = probeRunDeadline(
          '443 interruption-construction probe',
          runBudgetMs(ARMS.flatMap((arm) => serialWaitsMs(arm))),
          TEARDOWN_MS,
        )
      `),
    )
    // ⛔ The teardown the helper waits for is the arm's own three-step close, bound for bound.
    const teardownSteps = region('const closeOwnedArm = async', 'const release = deadline.own(')
    expect(teardownSteps.match(/await bounded\([^,]+, HANDSHAKE_MS,/g)).toHaveLength(3)
    // ⛔ `TOTAL_MS` was a claim checked after the fact; the deadline is the bound now.
    expect(code).not.toContain('TOTAL_MS')
    expect(
      occurrences('const [interrupted, control] = [await runArm(ARMS[0]), await runArm(ARMS[1])]'),
    ).toBe(1)
    expect(code.match(/await runArm\(/g)).toHaveLength(2)
    expect(occurrences('await new Promise((resolve) => setTimeout(resolve, SAMPLE_MS))')).toBe(1)
    expect(code.match(/deadline\.testTimeoutMs/g)).toHaveLength(1)
  })

  it('⛔ each arm refuses to start past the deadline, and owns its teardown before anything exists', () => {
    const order = [
      'async function runArm(arm: ArmName): Promise<ArmEvidence> { deadline.refuse(`starting arm ${arm}`)',
      'const release = deadline.own(() => closeOwnedArm())',
      'listenedOn = await listen(server)',
      'deadline.refuse(`starting arm ${arm} · the loopback port is bound`)',
      'transport = new SpawnCodexTransport(',
    ].map((text) => code.indexOf(squash(text)))
    expect(order.every((at) => at > -1)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(occurrences('exitGraceMs: EXIT_GRACE_MS, killGraceMs: KILL_GRACE_MS')).toBe(1)
    expect(occurrences('} finally { try { await closeOwnedArm() } finally { release() } }')).toBe(1)
    // ⚠️ Each teardown step keeps the bound it always had and records a failure rather than
    // throwing past the next.
    const teardown = region('const closeOwnedArm = async', 'const release = deadline.own(')
    expect(teardown.match(/await bounded\(/g)).toHaveLength(3)
  })

  it('⛔ roots are deleted only after every expectation — and rule 40 is one of them', () => {
    const arm = region('async function runArm(', 'async function measureBothArms(')
    expect(arm).not.toContain('rmSync(')
    const measure = code.slice(code.indexOf(squash('async function measureBothArms(')))
    expect(measure.indexOf('rmSync(one.root')).toBeGreaterThan(measure.lastIndexOf('expect('))
    expect(
      occurrences(
        "expect(one.configuredPort, `${one.arm} · the port in the child's config`).toBe(one.listenedOn)",
      ),
    ).toBe(1)
  })
})
