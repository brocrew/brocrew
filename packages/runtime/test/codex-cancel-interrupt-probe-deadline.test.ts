import { describe, expect, it } from 'vitest'
import { fingerprint, pinsOver, probeSource, squash } from './fixtures/probe-source'

/**
 * ⛔ **The cancel-interrupt probe's census — `495`, repaired by `649`, re-aimed by `655`.**
 *
 * This probe runs only under `vitest.smoke.config.ts`, so `pnpm run ci` never executes it. `495`
 * pinned the words of a deadline that lived in this file; `649` measured that most edits to it
 * left those words standing and pinned the code instead. ⚑ **`655` moved the deadline into
 * `smoke/probe-run-deadline.ts` and the reader into `smoke/cancel-interrupt-reader.ts`**, where they
 * are TESTED — `test/probe-run-deadline.test.ts` under fake timers, `test/cancel-interrupt-reader.test.ts`
 * by fixture. ⚠️ So `495`'s three titles below keep their names and measure what is left HERE: how
 * this probe WIRES those two in. Rule 26: re-aimed, not deleted.
 */

const source = probeSource('codex-cancel-interrupt-probe.smoke.ts')
const reader = probeSource('cancel-interrupt-reader.ts')
const code = squash(source)
const { occurrences, region } = pinsOver(source)

describe('492 cancel-interrupt probe synchronization and total deadline', () => {
  it('⛔ gives both tests one absolute deadline, DERIVED from every arm’s own waits (655 · F2)', () => {
    // ⚑ `042`'s rule, ruled for this probe: the budget is the arms' serial waits × a margin, so a
    // wait that grows moves it — `492`'s five minutes was below A–D's own worst case.
    expect(region('const RPC_DEADLINE_MS =', 'const DECLINED =')).toBe(
      squash(`
        const RPC_DEADLINE_MS = 30_000
        const ARRIVAL_DEADLINE_MS = 60_000
        const SETTLE_MS = 15_000
        const EXIT_GRACE_MS = 2_000
        const KILL_GRACE_MS = 2_000
        const TEARDOWN_MS = EXIT_GRACE_MS + 2 * KILL_GRACE_MS
        function serialWaitsMs(plan: Plan): number[] {
          const common = [RPC_DEADLINE_MS, RPC_DEADLINE_MS, ARRIVAL_DEADLINE_MS, SETTLE_MS, TEARDOWN_MS]
          if (plan === 'answer-only') return common
          if (plan === 'answer-then-interrupt') return [...common, RPC_DEADLINE_MS]
          return [...common, RPC_DEADLINE_MS, RPC_DEADLINE_MS]
        }
        const ARMS = [
          ['A-never-answer', 'never-answer'],
          ['B-answer-then-interrupt', 'answer-then-interrupt'],
          ['C-answer-only', 'answer-only'],
          ['D-two-calls', 'two-answer-one-then-interrupt'],
        ] as const satisfies readonly (readonly [string, Plan])[]
        const deadline = probeRunDeadline(
          '492 probe',
          runBudgetMs(ARMS.flatMap(([, plan]) => serialWaitsMs(plan))),
          TEARDOWN_MS,
        )
      `),
    )
    // ⛔ Every arm the budget counts is an arm that runs — spread from `ARMS`, never spelled twice.
    for (const index of [0, 1, 2, 3])
      expect(occurrences(`await capture(...ARMS[${index}])`)).toBe(1)
    expect(code.match(/await capture\(/g)).toHaveLength(4)
    // ⚑ One deadline object, both tests inside it, and vitest's timeout past it.
    expect(code.match(/probeRunDeadline\(/g)).toHaveLength(1)
    expect(code.match(/deadline\.testTimeoutMs/g)).toHaveLength(2)
  })

  it('⛔ starts owned teardown before an outer expiry rejects the awaiter', () => {
    // ⚑ Teardown-before-reject is the helper's, and `probe-run-deadline.test.ts` measures it.
    // ⛔ What this probe owes is to OWN before anything exists, and to close whatever is open each
    // time — an expiry during the port bind found nothing to close (`649` F6).
    expect(region('const closeOwnedCapture = async', 'const waitFor = async')).toBe(
      squash(`
        const closeOwnedCapture = async (): Promise<void> => {
          try {
            if (transport !== null) await transport.close()
          } finally {
            try {
              if (reader !== null) await reader.done
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
      'async function capture(label: string, plan: Plan): Promise<Arm> { deadline.refuse(`starting arm ${label}`)',
      'const release = deadline.own(',
      'listenedOn = await listen(server)',
      'deadline.refuse(`starting arm ${label} · the loopback port is bound`)',
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
    expect(
      occurrences('} finally { try { await closeOwnedCapture() } finally { release() } }'),
    ).toBe(1)
    // ⚠️ `649` F6: a failing run keeps its root — capture never deletes it; only a measure that
    // got past every expectation does.
    expect(region('async function capture(', 'const methodsAfter')).not.toContain('rmSync(')
    expect(code.match(/rmSync\(/g)).toHaveLength(2)
  })

  it('🔴 writes B’s tool result and interrupt request in one continuation, without polling', () => {
    // ⚑ The reader is fixture-tested (`cancel-interrupt-reader.test.ts`), including a microtask
    // placed between the two writes. ⛔ This is the cheap backstop over its source.
    const resultWrite = reader.indexOf('transport.respond(incoming.id, options.declined)')
    const interruptWrite = reader.indexOf("transport.request('turn/interrupt'", resultWrite)
    expect(resultWrite).toBeGreaterThan(-1)
    expect(interruptWrite).toBeGreaterThan(resultWrite)
    expect(reader.slice(resultWrite, interruptWrite)).not.toMatch(
      /\bawait\b|waitFor|setTimeout|setInterval|setImmediate|queueMicrotask|nextTick|\.then\(|new Promise/,
    )
    // ⛔ And B is never ALSO interrupted from the main flow — a second request the adapter never sends.
    expect(
      occurrences("} else if (plan !== 'answer-only' && plan !== 'answer-then-interrupt') {"),
    ).toBe(1)
    // 🔴 `655` F1: the loop awaits nothing but its own frames — the interrupt is not awaited in it.
    const loop = reader.slice(reader.indexOf('const done = (async () => {'))
    expect(loop.match(/\bawait\b/g)).toEqual(['await'])
    expect(loop).toContain('for await (const incoming of transport.incoming())')
  })
})

/**
 * 🔴 **`655` · the probe FILE is the code that ran green, and nothing between its pins moved.**
 *
 * ⚑ Run `2026-09-23T03-10-56-621Z-29170` on `36c28154`, bundled Codex `0.146.0`, loopback: all
 * four arms as designed — A and B `interrupted`, C `completed`, D `interrupted` with its interrupt
 * accepted; rule 40's port read back equal in every arm. (`655`'s response lists the earlier runs.)
 *
 * ⚠️ **The fingerprint covers this file, not the modules it imports.** `probe-run-deadline.ts` and
 * `cancel-interrupt-reader.ts` ran too, and are TESTED in `ci` instead of pinned — an edit there
 * owes those tests; an edit HERE owes a run, in the same commit:
 * `pnpm run probe:codex-cancel-interrupt` — loopback, no credential, no tokens — **then** the new
 * pins. `probe-source.ts` states what the fingerprint cannot see.
 */
describe('655 · the cancel-interrupt probe is the code that ran green', () => {
  it('🔴 nothing moved: the probe file, as code, is the code that ran', () => {
    expect(
      fingerprint(source),
      'the probe changed: run `pnpm run probe:codex-cancel-interrupt`, then pin the value received',
    ).toBe('1251b1c8b9f5d0d43d86a8b0fee057c3f7a7d2f2f12c12476d2067403df91690')
  })

  it('⚑ rule 40: the child is configured with the port listen(0) returned, read back from its file', () => {
    expect(
      occurrences(
        "configuredPort = configuredPortOf(readFileSync(join(home, 'config.toml'), 'utf8'))",
      ),
    ).toBe(1)
    expect(
      occurrences("writeFileSync(join(home, 'config.toml'), providerStanza(listenedOn))"),
    ).toBe(1)
  })

  it('🔴 the experiment and its oracle: every expectation after the evidence line, then the cleanup', () => {
    expect(
      occurrences(`
        console.log(\`492 cancel-interrupt · \${JSON.stringify(report, null, 1)}\`)
        for (const arm of arms) {
          expect(arm.failure, \`\${arm.label} · the arm\`).toBeNull()
          expect(arm.toolCallAt, \`\${arm.label} · the turn reached our tool\`).not.toBeNull()
          expect(arm.listenedOn, \`\${arm.label} · the loopback port\`).not.toBeNull()
          expect(arm.configuredPort, \`\${arm.label} · the port in the child's config\`).toBe(arm.listenedOn)
          expect(arm.modelRequests, \`\${arm.label} · the child asked our fake\`).toBeGreaterThan(0)
        }
        expect(neverAnswer.answeredAt, 'A · nothing was answered').toBeNull()
        expect(neverAnswer.modelRequests, 'A · the model was asked exactly once').toBe(1)
        expect(neverAnswer.interruptError, 'A · turn/interrupt was accepted').toBeNull()
        expect(neverAnswer.interruptResolvedAt, 'A · turn/interrupt resolved').not.toBeNull()
        expect(neverAnswer.turnStatus, 'A · and the turn ended, saying how').toBe('interrupted')
        expect(answerThenInterrupt.interruptError, 'B · turn/interrupt was accepted').toBeNull()
        expect(answerThenInterrupt.turnStatus, 'B · the turn ended interrupted').toBe('interrupted')
        expect(answerOnly.interruptSentAt, 'C · no interrupt was sent').toBeNull()
        expect(answerOnly.turnStatus, 'C · so the provider completes the turn normally').toBe('completed')
        for (const arm of arms) rmSync(arm.root, { recursive: true, force: true })
      }
      it(
        '492 · a Codex turn blocked awaiting an agent-tool result, interrupted',
        () => deadline.within('measuring arms A–C', measureThreeArms),
        deadline.testTimeoutMs,
      )
      `),
    ).toBe(1)
    expect(
      occurrences(`
        console.log(\`492 second card · \${JSON.stringify(report, null, 1)}\`)
        expect(two.failure, 'D · the arm').toBeNull()
        expect(two.configuredPort, "D · the port in the child's config").toBe(two.listenedOn)
        expect(two.toolCalls, 'D · two calls were in flight').toBe(2)
        expect(two.interruptError, 'D · turn/interrupt was accepted').toBeNull()
        expect(two.interruptResolvedAt, 'D · turn/interrupt resolved').not.toBeNull()
        expect(two.turnStatus, 'D · the turn ended interrupted').toBe('interrupted')
        rmSync(two.root, { recursive: true, force: true })
      }
      it(
        '492 · a SECOND card, outstanding, when the turn is interrupted',
        () => deadline.within('measuring arm D', measureSecondCard),
        deadline.testTimeoutMs,
      )
      `),
    ).toBe(1)
    expect(source.match(/\bit\(/g)).toHaveLength(2)
  })
})
