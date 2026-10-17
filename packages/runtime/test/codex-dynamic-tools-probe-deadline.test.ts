import { describe, expect, it } from 'vitest'
import { fingerprint, pinsOver, probeSource, squash } from './fixtures/probe-source'

/**
 * ⛔ **`348`'s dynamic-tools probe — its outer deadline, its bounded requests, and the code that ran**
 * (`669`, from `655` §4).
 *
 * This probe runs only under `vitest.smoke.config.ts`, so `pnpm run ci` never executes it. ⚠️ Until
 * `669` it had no bound but vitest's own per-test default, and `initialize`, `thread/start` and
 * `thread/resume` were awaited bare (standing rule 13). ⚑ What is measured HERE is how it wires in
 * `smoke/probe-run-deadline.ts` (tested under fake timers), and that the code is the code that ran.
 */

const source = probeSource('codex-dynamic-tools-probe.smoke.ts')
const code = squash(source)
const { occurrences, region } = pinsOver(source)

describe('669 · the 348 probe runs inside one derived outer deadline', () => {
  it('⛔ the budget is counted from the same table every arm is run from', () => {
    expect(region('const RPC_DEADLINE_MS =', 'async function bounded<T>(')).toBe(
      squash(`
        const RPC_DEADLINE_MS = 30_000
        const TURN_WAIT_MS = 60_000
        const EXIT_GRACE_MS = 2_000
        const KILL_GRACE_MS = 2_000
        const TEARDOWN_MS = EXIT_GRACE_MS + 2 * KILL_GRACE_MS
        interface ArmOptions {
          readonly thenResume?: boolean
        }
        function serialWaitsMs(opts: ArmOptions): number[] {
          const oneAppServer = [RPC_DEADLINE_MS, RPC_DEADLINE_MS, TURN_WAIT_MS, TEARDOWN_MS]
          return opts.thenResume === true ? [...oneAppServer, ...oneAppServer] : oneAppServer
        }
        const ARM_OPTIONS = {
          'A-namespace': {},
          'B-flat': {},
          'C-control': {},
          'D-resume': { thenResume: true },
        } as const satisfies Record<string, ArmOptions>
        const deadline = probeRunDeadline(
          '348 dynamic-tools probe',
          runBudgetMs(Object.values(ARM_OPTIONS).flatMap((opts) => serialWaitsMs(opts))),
          TEARDOWN_MS,
        )
      `),
    )
    // ⛔ Four arms, each passing its own entry — an arm the budget does not count cannot run.
    const calls = code.match(
      /await capture\(\s*'[A-D]-[a-z]+',[^;]*?ARM_OPTIONS\['[A-D]-[a-z]+'\]\)/g,
    )
    expect(calls).toHaveLength(4)
    for (const [index, arm] of ['A-namespace', 'B-flat', 'C-control', 'D-resume'].entries()) {
      expect(calls?.[index]).toContain(`capture('${arm}',`)
      expect(calls?.[index]).toMatch(new RegExp(`ARM_OPTIONS\\['${arm}'\\]\\)$`))
    }
    expect(code.match(/deadline\.testTimeoutMs/g)).toHaveLength(1)
  })

  it('⛔ every request is bounded, and every app-server is owned before it exists', () => {
    // ⚑ Rule 13: the three that used to be awaited bare.
    expect(occurrences("await bounded( 'initialize',")).toBe(1)
    expect(occurrences("await bounded( 'thread/start',")).toBe(1)
    expect(
      occurrences(
        "await bounded('thread/resume', second.request('thread/resume', { threadId, cwd }))",
      ),
    ).toBe(1)
    expect(code.match(/\.request\('(initialize|thread\/start|thread\/resume)'/g)).toHaveLength(3)

    const order = [
      'deadline.refuse(`starting arm ${label}`)',
      'const release = deadline.own(() => closeOwnedCapture())',
      'listenedOn = await listen(server)',
      'deadline.refuse(`starting arm ${label} · the loopback port is bound`)',
      'const first = openTransport()',
      'deadline.refuse(`arm ${label} · the resume`)',
      'const second = openTransport()',
    ].map((text) => code.indexOf(squash(text)))
    expect(order.every((at) => at > -1)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    // ⚠️ The teardown reads the CURRENT transport, so the resume's second app-server is covered.
    expect(occurrences('transport = first')).toBe(1)
    expect(occurrences('transport = second')).toBe(1)
    expect(
      occurrences('} finally { try { await closeOwnedCapture() } finally { release() } }'),
    ).toBe(1)
  })

  it('⛔ roots are deleted only after every expectation — and rule 40 is one of them', () => {
    const capture = region('async function capture(', 'async function measureFourArms(')
    expect(capture).not.toContain('rmSync(')
    const measure = code.slice(code.indexOf(squash('async function measureFourArms(')))
    const deletes = measure.indexOf('rmSync(arm.root')
    const lastExpect = measure.lastIndexOf('expect(')
    expect(deletes).toBeGreaterThan(lastExpect)
    expect(
      occurrences(
        "expect(arm.configuredPort, `${arm.label} · the port in the child's config`).toBe( arm.listenedOn, )",
      ),
    ).toBe(1)
  })
})

/**
 * 🔴 **`669` · the probe FILE is the code that ran green, and nothing between its pins moved.**
 *
 * ⚑ Run `2026-09-23T17-01-31-158Z-86654` on `0b37e36a` + this change, bundled Codex, loopback: A and
 * B each reached the endpoint once with all five names, C once with none, D twice with all five
 * before AND after a cold resume by a second app-server; every arm's configured port equalled the
 * one `listen(0)` returned.
 *
 * ⚑ Re-pinned on run `2026-10-02T04-43-28-190Z-66109` (provider update 1, `providers` at `f40ef7e8`), bundled
 * Codex 0.160.0, loopback: the same four results, with the names now read at every level of the
 * request (0.160.0 nests them in an `additional_tools` namespace) and matched by the probe's own
 * descriptions.
 *
 * ⚠️ **The fingerprint covers this file, not the modules it imports.** An edit HERE owes a run, in
 * the same commit: `pnpm run probe:codex-dynamic-tools` — loopback, no credential, no tokens —
 * **then** the new pin.
 */
describe('669 · the dynamic-tools probe is the code that ran green', () => {
  it('🔴 nothing moved: the probe file, as code, is the code that ran', () => {
    expect(
      fingerprint(source),
      'the probe changed: run `pnpm run probe:codex-dynamic-tools`, then pin the value received',
    ).toBe('30558418f545183dd310ae5c1056ed312d9f13b8a654005d75d91638924c55ad')
  })
})
