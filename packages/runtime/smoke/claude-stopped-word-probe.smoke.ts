import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { format, resolveConfig } from 'prettier'
import { expect, it } from 'vitest'
import type { RuntimeEvent } from '../src/events'
import type { SessionHandle } from '../src/runtime'
import { bounded } from './cancel-interrupt-reader'
import { stoppedWordVerdict, type StopArm, type StopSeen } from './claude-stopped-evidence'
import {
  announcedVersion,
  assistantTurns,
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
 * 🔴 **709 · R43 — what the bundled Claude CLI says, on its own `result`, about a turn that was
 * stopped — and does the product record that word?**
 *
 * ## ⛔ Why it had to be measured
 *
 * R43 took away `SessionMachine.completeTurn`'s rename: the ledger records the PROVIDER's word. On
 * Claude that word is not the subtype — a stopped turn closes `error_during_execution`, which is also
 * a real execution error — so without reading more, a person's Cancel would read as a fault. The SDK
 * declares `terminal_reason` (*"Why the query loop terminated"*), with `aborted_streaming` and
 * `aborted_tools` among its values; nothing in the repo had ever seen one for a stop.
 *
 * | arm | the turn | answered |
 * |---|---|---|
 * | **finishes** | the scripted model replies `ok` — the CONTROL | nothing to answer |
 * | **stopped-streaming** | the model's request is HELD, so the turn is streaming | `handle.interrupt()` — a Stop |
 * | **stopped-in-tool** | the model runs `perl -e 'sleep 20'`, allowed | `handle.interrupt()` while it runs |
 * | **cancelled-card** | the model asks for a Bash command | the card answered **Cancel** — `canUseTool`'s `interrupt: true` |
 *
 * ⚑ **Measured on `709`** (CLI 2.1.281): `completed`, `aborted_streaming`, `aborted_tools`,
 * `aborted_tools`. On a Stop the interrupt's receipt comes FIRST and Claude's result after it (65–102 ms
 * mid-stream, 2–8 s in a tool, over two runs), so the product's word there is its own forced
 * `interrupted` (`074`) and Claude's arrives to agree, unread. ⛔ **So only the Cancel arm tests
 * `claudeResultOutcome` live** — the verdict names which arms were read and which were ended first.
 * On all four, CLAUDE's word is measured. ⚑ **The run rewrites
 * `test/fixtures/claude-stopped-results.json`** — every `ci` test of `claudeResultOutcome`'s mapping
 * reads it — so a CLI bump is re-measured by running this, not by editing a fixture by hand.
 * ⚑ **Re-measured on CLI 2.1.287**: the same four words, and the in-tool result now ~0.1 s after
 * the receipt (the fixture's `_order`).
 *
 * Use `loopback-claude.ts` with no real token, spend, personal state, or Electron. The
 * scripted model measures the CLI’s stop handling rather than hosted-model obedience. Run
 * `pnpm run probe:claude-stopped-word` deliberately, outside `pnpm run ci`; verdict logic is
 * in `packages/runtime/test/claude-stopped-evidence.test.ts`.
 */

const WORDS: Readonly<Record<StopArm, string>> = {
  finishes: '709-stopped-word finishes: say ok',
  'stopped-streaming': '709-stopped-word stopped-streaming: hold',
  'stopped-in-tool': '709-stopped-word stopped-in-tool: run the sleeper',
  'cancelled-card': '709-stopped-word cancelled-card: run the command',
}

/** ⛔ The arms, as one table the budget is counted from — see the docblock's. */
const ARMS = ['finishes', 'stopped-streaming', 'stopped-in-tool', 'cancelled-card'] as const

/** ⚠️ Bounded, standing rule 13 — the CLI's start and the turn's send: a stalled CLI is NOT PERFORMED, never waited on. */
const START_MS = 60_000
/** The request, the card, or the turn's own ending — each its own wait. */
const STEP_MS = 30_000
/** ⚑ Measured: Claude's result for a turn stopped in a tool came 2–8 s after the receipt (2.1.281). */
const RESULT_MS = 30_000
/** The pause while the sleeper runs, and Claude's own ack wait inside `interrupt()` — 2 s each. */
const INTERRUPT_MS = 4_000
const SETTLE_MS = 500
const TEARDOWN_MS = 15_000

const deadline = probeRunDeadline(
  '709 claude stopped-word probe',
  runBudgetMs(
    ARMS.flatMap(() => [
      START_MS,
      START_MS,
      STEP_MS,
      INTERRUPT_MS,
      RESULT_MS,
      STEP_MS,
      SETTLE_MS,
      TEARDOWN_MS,
    ]),
  ),
  TEARDOWN_MS,
)

function reply(arm: StopArm): ScriptedReply {
  if (arm === 'finishes') return { kind: 'text', text: 'ok' }
  if (arm === 'stopped-streaming') return { kind: 'hold' }
  if (arm === 'cancelled-card') {
    return {
      kind: 'tool_use',
      id: 'toolu_709_card',
      name: 'Bash',
      input: { command: "perl -e 'print 709'", description: '709 cancel' },
    }
  }
  return {
    kind: 'tool_use',
    id: 'toolu_709_sleep',
    name: 'Bash',
    // ⚑ Not `sleep 20` or `echo`: these arms need a card, and the CLI's own engine asks for neither
    // (both are on its read-only list). Until `728` this app's hook asked for them; since, the CLI
    // decides. `perl -e` runs code the CLI cannot read as harmless, and it still asks.
    input: { command: "perl -e 'sleep 20'", description: '709 sleeper' },
  }
}

interface Arm {
  readonly arm: StopArm
  readonly cli: string | null
  readonly listenedOn: number
  readonly configuredPort: number | null
  readonly reachedThisPort: boolean
  readonly failure: string | null
  /** Claude's own `result` frame for the turn, verbatim. */
  readonly result: Record<string, unknown> | null
  /** ms after the turn was sent: the stop, its receipt, and Claude's result. */
  readonly stopAskedAt: number | null
  readonly receiptAt: number | null
  readonly resultAt: number | null
  readonly seen: StopSeen
  readonly stderr: string
}

const captured: Partial<Record<StopArm, Arm>> = {}

async function measure(arm: StopArm): Promise<Arm> {
  deadline.refuse(`arm ${arm}`)
  const loopback = await startLoopback((request) =>
    firstUserText(request).includes(WORDS[arm]) && assistantTurns(request) === 0
      ? reply(arm)
      : { kind: 'text', text: 'ok' },
  )
  let handle: SessionHandle | null = null
  const release = deadline.own(async () => {
    if (handle !== null) await closeBounded(handle, TEARDOWN_MS)
    await loopback.close()
  })
  const events: RuntimeEvent[] = []
  let rig: Awaited<ReturnType<typeof loopbackRuntime>> | null = null
  let failure: string | null = null
  let over = false
  let openAtStop: boolean | null = null
  let endedBeforeClaudesResult = false
  let stopAskedAt: number | null = null
  let receiptAt: number | null = null
  let resultAt: number | null = null
  const resultFrame = (): Record<string, unknown> | undefined =>
    rig?.recorded.frames.find((frame) => (frame as { type?: string }).type === 'result') as
      Record<string, unknown> | undefined
  try {
    rig = await loopbackRuntime({
      scratch: runScratch('claude-stopped-word'),
      label: arm,
      port: loopback.port,
    })
    const starting = rig.runtime.start({
      cwd: rig.cwd,
      providerHome: rig.providerHome,
      model: 'claude-haiku-4-5',
      approvalMode: 'ask',
    })
    // ⚠️ A start that answers after its bound is still closed — never a CLI left running.
    starting
      .then((late) => {
        handle = late
        if (over) void closeBounded(late, TEARDOWN_MS)
      })
      .catch(() => undefined)
    const started = await bounded('the CLI’s start', starting, START_MS)
    handle = started
    void (async () => {
      for await (const event of started.events()) {
        // ⚑ Frames are recorded BEFORE the adapter reads them, so a result already here at the
        // ending means the ending could be read off it; none here means the product ended first.
        if (event.type === 'turn' && !events.some((one) => one.type === 'turn')) {
          endedBeforeClaudesResult = resultFrame() === undefined
        }
        events.push(event)
      }
    })()
    const t0 = Date.now()
    await bounded('the turn’s send', started.send(WORDS[arm]), START_MS)
    const stillRunning = (): boolean => !events.some((one) => one.type === 'turn')
    const card = (): Extract<RuntimeEvent, { type: 'permission_request' }> | undefined =>
      events.find(
        (one): one is Extract<RuntimeEvent, { type: 'permission_request' }> =>
          one.type === 'permission_request',
      )
    if (arm === 'stopped-streaming') {
      await until(
        () => loopback.requests.some((one) => firstUserText(one).includes(WORDS[arm])),
        STEP_MS,
        'the held request',
      )
      stopAskedAt = Date.now() - t0
      openAtStop = stillRunning()
      await started.interrupt()
      receiptAt = Date.now() - t0
    } else if (arm === 'stopped-in-tool') {
      await until(() => card() !== undefined, STEP_MS, 'the sleeper’s card')
      await started.respondPermission(card()!.id, { outcome: 'allow' })
      await new Promise((resolve) => setTimeout(resolve, 2_000))
      stopAskedAt = Date.now() - t0
      // ⛔ The premise, MEASURED rather than assumed: the turn is open and the sleeper's result has
      // not gone back to the model (no request after the first assistant turn).
      openAtStop = stillRunning() && !loopback.requests.some((one) => assistantTurns(one) >= 1)
      await started.interrupt()
      receiptAt = Date.now() - t0
    } else if (arm === 'cancelled-card') {
      await until(() => card() !== undefined, STEP_MS, 'the Bash card')
      stopAskedAt = Date.now() - t0
      openAtStop = stillRunning()
      await started.respondPermission(card()!.id, { outcome: 'cancel' })
    }
    await until(() => resultFrame() !== undefined, RESULT_MS, 'Claude’s own result')
    resultAt = Date.now() - t0
    await until(() => events.some((one) => one.type === 'turn'), STEP_MS, 'the product’s ending')
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  } finally {
    over = true
    if (handle !== null) await closeBounded(handle, TEARDOWN_MS)
    await loopback.close()
    release()
  }
  const result = resultFrame() ?? null
  const seen: StopSeen = {
    arm,
    result:
      result === null
        ? null
        : {
            subtype: String(result['subtype']),
            terminalReason:
              typeof result['terminal_reason'] === 'string' ? result['terminal_reason'] : null,
          },
    productWords: events.flatMap((one) => (one.type === 'turn' ? [one.state] : [])),
    productErrors: events.filter((one) => one.type === 'error').length,
    openAtStop,
    endedBeforeClaudesResult,
  }
  const measured: Arm = {
    arm,
    cli: rig === null ? null : announcedVersion(rig.recorded.frames),
    listenedOn: loopback.port,
    configuredPort: rig?.recorded.configuredPort ?? null,
    reachedThisPort: loopback.requests.some(
      (one) => one.localPort === loopback.port && firstUserText(one).includes(WORDS[arm]),
    ),
    failure,
    result,
    stopAskedAt,
    receiptAt,
    resultAt,
    seen,
    stderr: rig?.recorded.stderr ?? '',
  }
  captured[arm] = measured
  const evidence = runEvidence('claude-stopped-word')
  mkdirSync(evidence, { recursive: true })
  writeFileSync(
    join(evidence, `${arm}.json`),
    `${JSON.stringify({ ...measured, frames: rig?.recorded.frames ?? [], events }, null, 1)}\n`,
  )
  // ⚠️ Only an arm that was measured deletes its root (`649` F6).
  if (failure === null && rig !== null) rmSync(rig.root, { recursive: true, force: true })
  console.log(
    `[709 claude stopped word · ${arm}]`,
    JSON.stringify({ cli: measured.cli, seen, stopAskedAt, receiptAt, resultAt, failure }, null, 1),
  )
  return measured
}

for (const arm of ARMS) {
  it(
    `709 · ${arm}`,
    () =>
      deadline.within(`arm ${arm}`, async () => {
        const measured = await measure(arm)
        expect(measured.failure, measured.stderr).toBeNull()
        // ⚑ Rule 40: the child was configured with THIS port, and a turn reached it.
        expect(measured.configuredPort).toBe(measured.listenedOn)
        expect(measured.reachedThisPort, 'the turn never reached this loopback').toBe(true)
        expect(measured.cli).not.toBeNull()
      }),
    deadline.testTimeoutMs,
  )
}

it(
  '709 · Claude’s word for every arm, recorded as said — read live on the Cancel — and the fixture is written from them',
  () =>
    deadline.within('the verdict and the fixture', async () => {
      const arms = ARMS.map((arm) => captured[arm])
      // ⛔ **Every arm MEASURED, or nothing is written** — a fixture built from a failed arm, from a
      // CLI that announced no version, or from a child that never reached this loopback (rule 40)
      // would pin a word nobody measured. Everything a per-arm test asserts, again here.
      expect(
        arms.every(
          (one) =>
            one !== undefined &&
            one.failure === null &&
            one.cli !== null &&
            one.configuredPort === one.listenedOn &&
            one.reachedThisPort,
        ),
      ).toBe(true)
      const measured = arms as Arm[]
      const verdict = stoppedWordVerdict(measured.map((one) => one.seen))
      expect(verdict).toMatchObject({ verdict: 'the-providers-word' })
      // ⚑ The one arm with no forced ending: Claude's result is its only ending, so it is READ.
      expect(verdict.verdict === 'the-providers-word' && verdict.read).toContain('cancelled-card')
      const stop = (arm: StopArm): string => {
        const one = captured[arm]
        return `interrupt() called +${String(one?.stopAskedAt)} ms, its receipt +${String(one?.receiptAt)} ms, this result +${String(one?.resultAt)} ms`
      }
      const fixture = {
        _provenance: `709 · measured, not written: the bundled Claude CLI ${String(captured.finishes?.cli)} driven through the product's own ClaudeRuntime against a scripted loopback model (packages/runtime/smoke/loopback-claude.ts), no token, no spend. Each value is the turn's own \`result\` frame, verbatim. Regenerate with \`pnpm run probe:claude-stopped-word\`.`,
        _order: `stoppedStreaming: ${stop('stopped-streaming')}. stoppedInTool: ${stop('stopped-in-tool')}. cancelledCard: no interrupt() at all — the card's Cancel answers canUseTool with interrupt:true, and this result is the turn's only ending.`,
        finishes: captured.finishes?.result,
        cancelledCard: captured['cancelled-card']?.result,
        stoppedStreaming: captured['stopped-streaming']?.result,
        stoppedInTool: captured['stopped-in-tool']?.result,
      }
      // ⚠️ Formatted as `format:check` reads it — a fixture the probe rewrites must not turn `ci` red.
      // Expanded first: prettier keeps an object open that was open, so a re-run keeps the objects'
      // layout. ⚠️ An array is refitted to the print width, so one can reflow when its values change.
      const path = fileURLToPath(
        new URL('../test/fixtures/claude-stopped-results.json', import.meta.url),
      )
      const options = { ...(await resolveConfig(path)), filepath: path }
      writeFileSync(path, await format(JSON.stringify(fixture, null, 2), options))
    }),
  deadline.testTimeoutMs,
)
