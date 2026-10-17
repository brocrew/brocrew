import { describe, expect, it } from 'vitest'
import { fingerprint, pinsOver, probeSource, squash } from './fixtures/probe-source'

/**
 * ⛔ **`605`'s external-MCP probe — its outer deadline, and the code that ran** (`655`, from
 * `649` F3).
 *
 * This probe runs only under `vitest.smoke.config.ts`, so `pnpm run ci` never executes it. ⚠️ Until
 * `655` it had no bound but vitest's 20-minute per-test default, which is BELOW its own seven arms'
 * worst case — so a hang would have surfaced as a bare vitest timeout naming no step, and that
 * timeout frees the awaiter, not the child. ⚑ It now uses `smoke/probe-run-deadline.ts` (tested
 * under fake timers); what is measured HERE is how it wires that in, and that the code is the code
 * that ran.
 */

const source = probeSource('codex-external-mcp-probe.smoke.ts')
const code = squash(source)
const { occurrences, region } = pinsOver(source)

describe('655 · the 605 probe runs inside one derived outer deadline', () => {
  it('⛔ the budget is counted from the same table every arm is run from', () => {
    expect(region('const EXIT_GRACE_MS =', 'function configuredPortOf(')).toBe(
      squash(`
        const EXIT_GRACE_MS = 2_000
        const KILL_GRACE_MS = 2_000
        const TEARDOWN_MS = EXIT_GRACE_MS + 2 * KILL_GRACE_MS
        interface ArmOptions {
          readonly thenCallTheTool?: boolean
          readonly thenTakeATurn?: boolean
          readonly mode?: 'ask' | 'auto'
          readonly openaiFormElicitation?: boolean
          readonly modelCallsTheTool?: boolean
          readonly answer?: 'cancel' | 'decline'
          readonly thenInterruptItsTurn?: boolean
        }
        function serialWaitsMs(opts: ArmOptions): number[] {
          return [
            WAIT_MS,
            WAIT_MS,
            WAIT_MS,
            ...(opts.thenTakeATurn === true ? [WAIT_MS, WAIT_MS] : []),
            ...(opts.thenCallTheTool === true ? [WAIT_MS] : []),
            ...(opts.modelCallsTheTool === true ? [WAIT_MS, WAIT_MS] : []),
            ...(opts.thenInterruptItsTurn === true ? [WAIT_MS] : []),
            TEARDOWN_MS,
          ]
        }
        const ARM_OPTIONS = {
          A: {},
          B: {},
          C: {},
          D: {},
          E: { thenCallTheTool: true, mode: 'auto' },
          F: { thenCallTheTool: true, thenTakeATurn: true, mode: 'ask' },
          G: { thenCallTheTool: true, mode: 'ask', openaiFormElicitation: true },
          H: { modelCallsTheTool: true, mode: 'ask', answer: 'cancel' },
          I: { modelCallsTheTool: true, mode: 'ask', answer: 'decline' },
          J: { modelCallsTheTool: true, mode: 'ask', answer: 'cancel', thenInterruptItsTurn: true },
        } as const satisfies Record<string, ArmOptions>
        const deadline = probeRunDeadline(
          '605 probe',
          runBudgetMs(Object.values(ARM_OPTIONS).flatMap((opts) => serialWaitsMs(opts))),
          TEARDOWN_MS,
        )
      `),
    )
    // ⛔ Ten arms (`720` added H, I and J), each passing its own entry — an arm the budget does not
    // count cannot run.
    const calls = code.match(/await runArm\([^)]*\)/g) ?? []
    expect(calls).toHaveLength(10)
    for (const [index, arm] of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'].entries()) {
      expect(calls[index]).toMatch(new RegExp(`ARM_OPTIONS\\.${arm}\\)$`))
    }
  })

  it('⛔ each arm refuses to start past the deadline, and owns its teardown before anything exists', () => {
    // ⚠️ `655`'s review found the first adoption half done: ownership taken only after the external
    // server, the model endpoint and the child already existed, and no refusal after the binds.
    expect(
      region('const closeOwnedArm = async', 'try { external = await startExternalMcpServer('),
    ).toBe(
      squash(`
        const closeOwnedArm = async (): Promise<void> => {
          try {
            if (transport !== null) await transport.close()
          } finally {
            try {
              if (pump !== null) await pump
            } finally {
              capture.closeAllConnections()
              if (capture.listening) {
                await new Promise((resolve) => capture.close(() => resolve(undefined)))
              }
              if (external !== null) await external.close()
            }
          }
        }
        const release = deadline.own(() => closeOwnedArm())
      `),
    )
    const order = [
      'async function runArm(label: string, offer: Offer, opts: ArmOptions): Promise<Arm> { deadline.refuse(`starting arm ${label}`)',
      'const release = deadline.own(',
      "external = await startExternalMcpServer( traffic, opts.modelCallsTheTool === true ? 'url' : 'form', )",
      'capturePort = await listen(capture)',
      'deadline.refuse(`starting arm ${label} · both loopback ports are bound`)',
      'transport = new SpawnCodexTransport(',
    ].map((text) => code.indexOf(squash(text)))
    expect(
      order.every((at) => at > -1),
      'every step is present',
    ).toBe(true)
    expect(
      [...order].sort((a, b) => a - b),
      'and in this order',
    ).toEqual(order)
    expect(occurrences('} finally { try { await closeOwnedArm() } finally { release() } }')).toBe(1)
  })

  it('⚑ rule 40, and a failing arm keeps its root', () => {
    expect(
      occurrences(String.raw`
        function configuredPortOf(config: string): number | null {
          const match = /^base_url = "http:\/\/127\.0\.0\.1:(\d+)\/v1"$/m.exec(config)
          return match === null ? null : Number(match[1])
        }
      `),
    ).toBe(1)
    expect(
      occurrences(
        "configuredPort = configuredPortOf(readFileSync(join(home, 'config.toml'), 'utf8'))",
      ),
    ).toBe(1)
    expect(
      occurrences(`
        const ran = [
          nested,
          dotted,
          homeFile,
          control,
          inAuto,
          inAsk,
          inAskWithForms,
          cancelInTurn,
          declineInTurn,
          cancelThenItsTurn,
        ].filter((arm): arm is Arm => arm !== null)
        for (const arm of ran) {
          expect(arm.capturePort, \`\${arm.label} · the model endpoint's port\`).not.toBeNull()
          expect(arm.configuredPort, \`\${arm.label} · the port in the child's config\`).toBe(
            arm.capturePort,
          )
        }
        for (const arm of ran) rmSync(arm.root, { recursive: true, force: true })
      }
      `),
    ).toBe(1)
    expect(code.match(/rmSync\(/g)).toHaveLength(1)
  })

  it('⚑ the one test IS its deadline, and vitest’s timeout sits past it', () => {
    expect(
      occurrences(`
        it(
          '605 · an external MCP server reaches a Codex child, and its elicitation names the server',
          () => deadline.within('measuring arms A–J', measureExternalMcp),
          deadline.testTimeoutMs,
        )
      `),
    ).toBe(1)
    expect(source.match(/\bit\(/g)).toHaveLength(1)
  })
})

/**
 * 🔴 **`655` · the probe FILE is the code that ran green.** ⚑ Run `2026-09-25T07-09-45-371Z-20249`
 * (`720`, on `main` `c6cb62dc` + the branch; its first run was `2026-09-25T06-14-28-775Z-3116`),
 * bundled Codex `0.146.0`, loopback: all TEN arms
 * without failure — A, B and C registered the server, the control D registered nothing, F and G
 * carried the `mcpServer/elicitation/request` frame as `605` measured it, and `720`'s H, I and J
 * (R74): a url-mode frame naming its own bound turn; after `cancel` alone (H) and `decline` (I) the
 * turn `completed` with the model called again (both asserted); after `cancel` then `turn/interrupt`
 * to the frame's turn (J) it ended `interrupted` — and every arm's configured port equal to its endpoint's (rule
 * 40). (`655`'s run was `2026-09-23T03-11-20-830Z-36148` on `36c28154`, seven arms.) ⚑ Re-pinned
 * on run `2026-10-02T04-43-28-190Z-66109` (provider update 1, `providers` at `f40ef7e8`), bundled Codex 0.160.0,
 * loopback: all ten arms green, F now asserting its turns reached the model before its negatives,
 * and the tool's name nowhere in the model-bound turn (0.160.0 defers it).
 *
 * ⚠️ The fingerprint covers this file; `probe-run-deadline.ts` is TESTED in `ci` instead. ⛔ An edit
 * HERE owes a run, in the same commit: `pnpm run probe:codex-external-mcp` — loopback, no
 * credential, no tokens — **then** the new pins.
 */
describe('655 · the 605 probe is the code that ran green', () => {
  it('🔴 nothing moved: the probe file, as code, is the code that ran', () => {
    expect(
      fingerprint(source),
      'the probe changed: run `pnpm run probe:codex-external-mcp`, then pin the value received',
    ).toBe('dc0a8a9c2f6a3b2dd945614aabd05a3da668c39b1c043f9631853bfa7f5379e9')
  })
})
