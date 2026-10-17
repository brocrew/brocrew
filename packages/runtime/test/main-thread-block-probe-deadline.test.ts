import { describe, expect, it } from 'vitest'
import { fingerprint, pinsOver, probeSource, squash } from './fixtures/probe-source'

/**
 * ⛔ **`243`'s main-thread-block probe — its outer deadline, and the code that ran** (`669`, from
 * `655` §4).
 *
 * This probe runs only under `vitest.smoke.config.ts`, so `pnpm run ci` never executes it. ⚠️ Until
 * `669` it had no bound but vitest's own per-test default, which frees the awaiter and not the lock
 * holder a row spawned. ⚑ It now runs inside `smoke/probe-run-deadline.ts` (tested under fake
 * timers); what is measured HERE is how it wires that in, and that the code is the code that ran.
 */

const source = probeSource('main-thread-block-probe.smoke.ts')
const code = squash(source)
const { occurrences, region } = pinsOver(source)

describe('669 · the 243 probe runs inside one derived outer deadline', () => {
  it('⛔ the budget is counted from the same table every row is measured from', () => {
    expect(region('const HOLDER_READY_MS =', 'interface Row {')).toBe(
      squash(`
        const HOLDER_READY_MS = 30_000
        const HOLDER_EXIT_MS = 30_000
        const KILL_GRACE_MS = 2_000
        const TEARDOWN_MS = KILL_GRACE_MS
        interface RowPlan {
          readonly holdMs: number
          readonly acquire: boolean
          readonly timeoutMs: number
        }
        const ROWS = [
          ['idle', { holdMs: 1_500, acquire: false, timeoutMs: 0 }],
          ['uncontended', { holdMs: 0, acquire: true, timeoutMs: 10_000 }],
          ['contended-500', { holdMs: 500, acquire: true, timeoutMs: 10_000 }],
          ['contended-2000', { holdMs: 2_000, acquire: true, timeoutMs: 10_000 }],
          ['contended-timeout', { holdMs: 3_000, acquire: true, timeoutMs: 1_000 }],
        ] as const satisfies readonly (readonly [string, RowPlan])[]
        function serialWaitsMs(plan: RowPlan): number[] {
          const held = plan.holdMs > 0
          return [
            ...(held ? [HOLDER_READY_MS] : []),
            plan.acquire ? plan.timeoutMs : plan.holdMs,
            ...(held ? [HOLDER_EXIT_MS] : []),
            TEARDOWN_MS,
          ]
        }
        const deadline = probeRunDeadline(
          '243 main-thread-block probe',
          runBudgetMs(ROWS.flatMap(([, plan]) => serialWaitsMs(plan))),
          TEARDOWN_MS,
        )
      `),
    )
    // ⛔ Every row the file measures comes from `ROWS` — a row the budget does not count cannot run.
    expect(
      occurrences('for (const [label, plan] of ROWS) rows.push(await measure(label, plan))'),
    ).toBe(1)
    expect(code.match(/await measure\(/g)).toHaveLength(1)
    expect(code.match(/deadline\.testTimeoutMs/g)).toHaveLength(1)
  })

  it('⛔ each row refuses to start past the deadline, and owns its holder before it spawns one', () => {
    const order = [
      'async function measure(label: string, plan: RowPlan): Promise<Row> { deadline.refuse(`starting row ${label}`)',
      'const release = deadline.own(() => closeOwnedRow())',
      'const spawned = spawnHolder(home, ready, plan.holdMs)',
      'await holderIsIn(spawned, ready)',
      'deadline.refuse(`row ${label} · the holder holds the lock`)',
      'ticker = setInterval(',
    ].map((text) => code.indexOf(squash(text)))
    expect(order.every((at) => at > -1)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    // ⚑ The teardown kills only a holder THIS row spawned, and waits for its exit, bounded.
    expect(region('const closeOwnedRow = async', 'const release = deadline.own(')).toBe(
      squash(`
        const closeOwnedRow = async (): Promise<void> => {
          if (ticker !== null) clearInterval(ticker)
          const child = holder?.child ?? null
          if (child === null || hasExited(child)) return
          child.kill('SIGKILL')
          await waitFor(() => hasExited(child), KILL_GRACE_MS, 'the killed holder to exit').catch(() => {})
        }
      `),
    )
    expect(occurrences('} finally { try { await closeOwnedRow() } finally { release() } }')).toBe(1)
    // ⚠️ `holder = spawned` is the line that hands the child to the teardown: without it an expiry
    // during `holderIsIn` would find nothing to kill.
    expect(occurrences('holder = spawned')).toBe(1)
  })
})

/**
 * 🔴 **`669` · the probe FILE is the code that ran green, and nothing between its pins moved.**
 *
 * ⚑ Run `2026-09-23T17-01-21-420Z-84578` on `0b37e36a` + this change, Node `v24.0.2`: idle
 * `maxGapMs` 13 over 1,501 ms, uncontended 2 ms, contended-500 and -2000 `maxGapMs` 13 and 12, and
 * contended-timeout refused *timed out acquiring provisioning lock* after 1,013 ms with a
 * `maxGapMs` of 14.
 *
 * ⚠️ **The fingerprint covers this file, not the modules it imports** — `probe-run-deadline.ts` is
 * TESTED in `ci` instead. An edit HERE owes a run, in the same commit:
 * `pnpm run probe:main-thread-block` — no provider, no credential, no tokens — **then** the new pin.
 */
describe('669 · the main-thread-block probe is the code that ran green', () => {
  it('🔴 nothing moved: the probe file, as code, is the code that ran', () => {
    expect(
      fingerprint(source),
      'the probe changed: run `pnpm run probe:main-thread-block`, then pin the value received',
    ).toBe('e88314b39045fcaf154ffb1b2acbe048d22e58c4eadab9b7d602b96bbc97650c')
  })
})
