import { describe, expect, it } from 'vitest'
import { fingerprint, pinsOver, probeSource, squash } from './fixtures/probe-source'

/**
 * ⛔ **The exec-permission probe's census — `495`, repaired by `649`, re-aimed by `655`.**
 *
 * This probe runs only under `vitest.smoke.config.ts`, so `pnpm run ci` never executes it. ⚑ `655`
 * moved its deadline into `smoke/probe-run-deadline.ts` (tested under fake timers) and its two
 * judgments — *was `cancel` offered*, *did the command run* — into `smoke/exec-approval-evidence.ts`
 * (tested both ways). ⚠️ `495`'s three titles below keep their names and measure what is left
 * HERE: how this probe wires them in. Rule 26: re-aimed, not deleted.
 */

const source = probeSource('codex-exec-permission-approval.smoke.ts')
const code = squash(source)
const { occurrences, region } = pinsOver(source)
const commandWireStart = source.indexOf('function execSource(')
const commandWire = source.slice(
  commandWireStart,
  source.indexOf('function streamGoodbye', commandWireStart),
)
const measureStart = source.indexOf('async function measureProviderApproval')
const measure = source.slice(measureStart, source.indexOf('it(', measureStart))

describe('495 exec-permission provider probe total deadline', () => {
  it('⛔ gives the whole provider reconstruction one outer deadline, DERIVED from its waits (655 · F2)', () => {
    // ⚑ `495` wrote three minutes; the waits this probe makes now sum to 172 s, and `042`'s rule
    // puts the budget comfortably past that — derived, so a wait that grows moves it.
    expect(region('const RPC_DEADLINE_MS =', 'function commandArguments(')).toBe(
      squash(`
        const RPC_DEADLINE_MS = 30_000
        const APPROVAL_DEADLINE_MS = 60_000
        const SETTLE_MS = 15_000
        const POST_TERMINAL_MS = 1_000
        const EXIT_GRACE_MS = 2_000
        const KILL_GRACE_MS = 2_000
        const TEARDOWN_MS = EXIT_GRACE_MS + 2 * KILL_GRACE_MS
        const SERIAL_WAITS_MS = [
          RPC_DEADLINE_MS,
          RPC_DEADLINE_MS,
          RPC_DEADLINE_MS,
          APPROVAL_DEADLINE_MS,
          SETTLE_MS,
          POST_TERMINAL_MS,
          TEARDOWN_MS,
        ]
        const deadline = probeRunDeadline(
          '495 exec-permission probe',
          runBudgetMs(SERIAL_WAITS_MS),
          TEARDOWN_MS,
        )
      `),
    )
    expect(code.match(/deadline\.testTimeoutMs/g)).toHaveLength(1)
  })

  it('⛔ starts owned transport and server teardown before expiry rejects the test', () => {
    // ⚑ Teardown-before-reject is the helper's (`probe-run-deadline.test.ts`). ⛔ This probe owes
    // ownership before anything exists, and a teardown that closes whatever is open each time.
    expect(
      region('const closeOwnedCapture = async', 'try { listenedOn = await listen(server)'),
    ).toBe(
      squash(`
        const closeOwnedCapture = async (): Promise<void> => {
          try {
            if (transport !== null) await transport.close()
          } finally {
            try {
              if (pump !== null) await pump
            } finally {
              server.closeAllConnections()
              if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
            }
          }
        }
        const release = deadline.own(() => closeOwnedCapture())
      `),
    )
    const order = [
      "async function capture(): Promise<Captured> { deadline.refuse('starting the capture')",
      'const release = deadline.own(',
      'listenedOn = await listen(server)',
      "deadline.refuse('starting the capture · the loopback port is bound')",
      'transport = new SpawnCodexTransport(',
    ].map((text) => code.indexOf(squash(text)))
    expect(order.every((at) => at > -1)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(
      occurrences('} finally { try { await closeOwnedCapture() } finally { release() } }'),
    ).toBe(1)
  })

  it('🔴 enters exec_command through the pinned code-mode custom exec boundary', () => {
    expect(commandWire).toContain(
      '`const answer = await tools.exec_command(${JSON.stringify(args)})`',
    )
    expect(commandWire).toContain("type: 'custom_tool_call'")
    expect(commandWire).toContain("name: 'exec'")
    expect(commandWire).toContain('input: execSource(args)')
    expect(commandWire).not.toContain("type: 'function_call'")
    expect(commandWire).not.toContain("name: 'exec_command'")

    expect(measure).toContain("namedTool(captured.modelBodies[0], 'exec')")
    expect(measure).toContain("expect(execTool?.['type']).toBe('custom')")
    expect(measure).toContain("expect(execDescription).toContain('exec_command')")
    expect(measure).toContain("expect(execDescription).toContain('with_additional_permissions')")
    expect(measure).toContain("expect(execDescription).toContain('additional_permissions')")
  })
})

/**
 * 🔴 **`655` · the probe FILE is the code that ran green, and nothing between its pins moved.**
 *
 * ⚑ Run `2026-09-23T03-11-10-033Z-32697` on `36c28154`, bundled Codex `0.146.0`, loopback: raw
 * offer `accept`, `cancel`; `cancel` sent because offered; the approval's item ended `declined` with
 * no process, exit code or output; the turn ended `interrupted`; rule 40's port read back equal.
 * (`655`'s response lists the earlier runs.) ⚑ Re-pinned on run `2026-10-02T04-43-28-190Z-66109` (provider update 1,
 * `providers` at `f40ef7e8`), bundled Codex 0.160.0, loopback, green — `exec` now looked up inside
 * the `functions` namespace 0.160.0 nests it in.
 *
 * ⚠️ **The fingerprint covers this file, not the modules it imports** — `probe-run-deadline.ts` and
 * `exec-approval-evidence.ts` are TESTED in `ci` instead. An edit HERE owes a run, in the same
 * commit: `pnpm run probe:codex-exec-permission` — loopback, no credential, no tokens — **then**
 * the new pins.
 */
describe('655 · the exec-permission probe is the code that ran green', () => {
  it('🔴 nothing moved: the probe file, as code, is the code that ran', () => {
    expect(
      fingerprint(source),
      'the probe changed: run `pnpm run probe:codex-exec-permission`, then pin the value received',
    ).toBe('2afb7b6fa2a7ea9f375d3d09b928d1e9fccf5bdca15311eaabada95f08c6b430')
  })

  it('🔒 a decision is sent only if OFFERED, and it is cancel (655 · F7)', () => {
    expect(
      occurrences(`
        if (!offers(incoming.params, 'cancel')) {
          failure = 'NOT PERFORMED — the provider did not offer cancel, so no decision was sent'
          continue
        }
        answered = { decision: 'cancel' }
        ownedTransport.respond(incoming.id, answered)
      `),
    ).toBe(1)
    expect(source.match(/\.respond\(/g)).toHaveLength(1)
    // ⚑ F7's evidence source: every notification kept WITH its params — the item record is read
    // from these — and judged only after the terminal and a listen past it.
    expect(
      occurrences('notifications.push({ method: incoming.method, params: incoming.params })'),
    ).toBe(1)
    expect(
      occurrences(`
        if (!(await waitFor(() => terminal() !== undefined, SETTLE_MS))) {
          failure ??= \`NOT PERFORMED — the turn reached no terminal within \${SETTLE_MS}ms of the answer\`
        }
        await new Promise((resolve) => setTimeout(resolve, POST_TERMINAL_MS))
      `),
    ).toBe(1)
  })

  it('🔴 the criterion-17 oracle, then "did not run" off the provider’s own record, then the cleanup', () => {
    expect(
      occurrences(
        'console.log(`495 CODEX EXEC PERMISSION APPROVAL — ${JSON.stringify(report)}`)' +
          String.raw`
            expect(captured.failure).toBeNull()
            expect(captured.merge.outcome).toBe('written')
            expect(captured.config.match(/^\[features\]\s*$/gm) ?? []).toHaveLength(1)
            expect(captured.config).toMatch(/^exec_permission_approvals\s*=\s*true\s*$/m)
            expect(captured.modelBodies).not.toHaveLength(0)
            expect(captured.listenedOn).not.toBeNull()
            expect(captured.configuredPort).toBe(captured.listenedOn)
            expect(execTool, 'the model request did not advertise the code-mode exec tool').toBeDefined()
            expect(execTool?.['type']).toBe('custom')
            expect(execDescription).toContain('exec_command')
            expect(execDescription).toContain('with_additional_permissions')
            expect(execDescription).toContain('additional_permissions')
            expect(approvalRequests).toHaveLength(1)
            expect(params['command']).toBe(EXPECTED_PROVIDER_COMMAND)
            expect(params['cwd']).toBe((captured.forcedArguments['workdir'] as string | undefined) ?? '')
            expect(decisions.length).toBeGreaterThan(0)
            expect(decisions).toContain('accept')
            expect(decisions).toContain('cancel')
            expect(params['additionalPermissions']).toEqual(EXPECTED_RAW_PROFILE)
            expect(captured.answered).toEqual({ decision: 'cancel' })
            expect(captured.turnStatus, 'the turn reached its own terminal after cancel').not.toBeNull()
            expect(evidence.ranBecause, 'the command the provider offered did not run').toEqual([])
            const asked = evidence.items.find((one) => one.id === params['itemId'])
            expect(asked?.status, 'the provider reported the command it asked about as declined').toBe(
              'declined',
            )
            rmSync(captured.root, { recursive: true, force: true })
          }
          it(
            '495 · the pinned provider emits the reachable undisplayable exec permission request',
            () => deadline.within('capturing the raw command approval', measureProviderApproval),
            deadline.testTimeoutMs,
          )
          `,
      ),
    ).toBe(1)
    expect(source.match(/\bit\(/g)).toHaveLength(1)
  })
})
