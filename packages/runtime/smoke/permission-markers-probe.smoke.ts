import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { query } from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'
import type { RuntimeEvent } from '../src/events'
import type { SessionHandle } from '../src/runtime'
import {
  announcedVersion,
  assistantTurns,
  closeBounded,
  firstUserText,
  loopbackRuntime,
  startLoopback,
  until,
} from './loopback-claude'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

/**
 * 🔴 **695 · R36a — an ask the CLI marks `suppressAlwaysAllowRule` offers no *"don't ask again"***,
 * measured through the real permission path: the CLI's own `can_use_tool`, the SDK's mapping onto
 * `canUseTool`'s options, the product adapter's `handleCanUseTool`, the `permission_request` it
 * emits, and `respondPermission`'s gate.
 *
 * ## ⚑ What marks an ask
 *
 * On 2.1.281 an ask is marked when the tool's own safety check is one the classifier may NOT approve
 * — among them a Bash command with a real background `&`. ⚠️ Until `728` BroBot's guard hook forced
 * every card in `ask` mode, and the CLI then kept its marks only when the tool's own check would
 * have asked too — so an ordinary `echo` arrived unmarked and `echo … &` marked. Since `728` the hook
 * asks nothing on its own account, and a plain `echo` is on the CLI's read-only list, so it is not
 * asked at all: the control runs `perl -e`, which the CLI still asks for. 2.1.218 has no such
 * promotion: the marked command arrives unmarked there. Re-measured on 2.1.287: unchanged.
 *
 * | arm | the command the scripted model asks to run |
 * |---|---|
 * | **marked** | `echo r36 &` — the SUBJECT |
 * | **unmarked** | `perl -e 'print 36'` — the CONTROL: today's choices, a session grant among them |
 * | **pin-0.3.218** | `echo r36 &` through the 0.3.218 SDK and its CLI — only when `BROBOT_PROBE_SDK_0_3_218` names that SDK's `sdk.mjs` |
 *
 * ⚑ In every arm a session grant is pressed. In the marked arm it must be REFUSED by the adapter's
 * gate — the offer is the rail, not the label — and the card is then answered `deny`, so nothing
 * runs. ⚠️ **In the control and pin arms it is ACCEPTED, so the control's command (and `echo r36 &` on 2.1.218)
 * really runs** — in that arm's own scratch cwd, and harmless there.
 *
 * ⛔ **`defaultToNo` (R36b) is not measured here and cannot be**: 2.1.281 mints it only for the
 * claude.ai Artifact tool's deletions, a tool BroBot does not load — the CLI mints the mark, so a
 * scripted model cannot ask for it. Its path is pinned at the SDK boundary in
 * `claude-runtime.test.ts` instead.
 *
 * 🔒 `loopback-claude.ts`'s recipe — no token, no spend, no personal provider state. Run:
 * `pnpm run probe:permission-markers`. Not part of `pnpm run ci`.
 */

const WORDS = '695 permission-marker probe: run the command'

const COMMANDS = {
  marked: 'echo r36 &',
  // ⚑ Not `echo r36`: a plain `echo` is on the CLI's read-only list and, since `728`, this app's hook
  // no longer asks for it either — so the control would have no card to read. `perl -e` runs code
  // the CLI cannot read as harmless, and it still asks.
  unmarked: "perl -e 'print 36'",
  'pin-0.3.218': 'echo r36 &',
} as const

type ArmName = keyof typeof COMMANDS

const ASK_MS = 90_000
const TURN_MS = 60_000
const TEARDOWN_MS = 15_000
const SERIAL_WAITS_MS = [ASK_MS, TURN_MS, TEARDOWN_MS]

const deadline = probeRunDeadline(
  '695 permission-marker probe',
  runBudgetMs(Object.keys(COMMANDS).flatMap(() => SERIAL_WAITS_MS)),
  TEARDOWN_MS,
)

interface Arm {
  readonly label: ArmName
  readonly cli: string | null
  readonly listenedOn: number
  readonly configuredPort: number | null
  /** ⚑ What the SDK handed `canUseTool`, as it handed it — the CLI's own mark, before our code. */
  readonly sdkSaid: Record<string, unknown> | null
  readonly card: Extract<RuntimeEvent, { type: 'permission_request' }> | null
  /** What pressing a session grant on this card did: `refused`, `accepted`, or `not-offered-here`. */
  readonly sessionGrantPress: string | null
  /** ⚑ Rule 40 — some request arrived on the port this process listened on. */
  readonly reachedThisPort: boolean
  readonly failure: string | null
  readonly stderr: string
}

async function sdkAt0_3_218(): Promise<typeof query | null> {
  const entry = process.env['BROBOT_PROBE_SDK_0_3_218']
  if (entry === undefined || entry === '') return null
  return ((await import(entry)) as { query: typeof query }).query
}

async function measure(label: ArmName): Promise<Arm> {
  deadline.refuse(`starting arm ${label}`)
  const loopback = await startLoopback((request) => {
    if (firstUserText(request).includes(WORDS) && assistantTurns(request) === 0) {
      return {
        kind: 'tool_use',
        id: 'toolu_695_bash',
        name: 'Bash',
        input: { command: COMMANDS[label], description: '695 marker probe' },
      }
    }
    return { kind: 'text', text: 'ok' }
  })
  let handle: SessionHandle | null = null
  // ⛔ The deadline's teardown owns the CLI child too — an expired arm must not leave it running.
  const release = deadline.own(async () => {
    if (handle !== null) await closeBounded(handle, TEARDOWN_MS)
    await loopback.close()
  })
  const events: RuntimeEvent[] = []
  let failure: string | null = null
  let sessionGrantPress: string | null = null
  let rig: Awaited<ReturnType<typeof loopbackRuntime>> | null = null
  try {
    let sdkQuery: typeof query | undefined
    if (label === 'pin-0.3.218') {
      const older = await sdkAt0_3_218()
      if (older === null) {
        throw new Error('NOT PERFORMED — BROBOT_PROBE_SDK_0_3_218 names no 0.3.218 SDK entry')
      }
      sdkQuery = older
    }
    rig = await loopbackRuntime({
      scratch: runScratch('permission-markers'),
      label,
      port: loopback.port,
      ...(sdkQuery === undefined ? {} : { sdkQuery }),
    })
    const started = await rig.runtime.start({
      cwd: rig.cwd,
      providerHome: rig.providerHome,
      model: 'claude-haiku-4-5',
      approvalMode: 'ask',
    })
    handle = started
    void (async () => {
      for await (const event of started.events()) events.push(event)
    })()
    await started.send(WORDS)
    const card = (): Extract<RuntimeEvent, { type: 'permission_request' }> | undefined =>
      events.find(
        (one): one is Extract<RuntimeEvent, { type: 'permission_request' }> =>
          one.type === 'permission_request',
      )
    await until(() => card() !== undefined, ASK_MS, 'the Bash card')
    const asked = card()!
    const grant = asked.scope.availableDecisions.find(
      (one) => one === 'allow_for_session' || one === 'allow_all_for_session',
    )
    // ⚑ Press a session grant whether or not the card offers one — the gate is the rail.
    const pressing = grant ?? 'allow_all_for_session'
    try {
      await started.respondPermission(asked.id, { outcome: pressing })
      sessionGrantPress = grant === undefined ? 'accepted-though-not-offered' : 'accepted'
    } catch (error) {
      sessionGrantPress = `refused: ${error instanceof Error ? error.message : String(error)}`
    }
    if (sessionGrantPress.startsWith('refused')) {
      await started.respondPermission(asked.id, { outcome: 'deny' })
    }
    await until(() => events.some((one) => one.type === 'turn'), TURN_MS, 'the turn to close')
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  } finally {
    if (handle !== null) await closeBounded(handle, TEARDOWN_MS)
    await loopback.close()
    release()
  }
  const card =
    events.find(
      (one): one is Extract<RuntimeEvent, { type: 'permission_request' }> =>
        one.type === 'permission_request',
    ) ?? null
  const arm: Arm = {
    label,
    cli: rig === null ? null : announcedVersion(rig.recorded.frames),
    listenedOn: loopback.port,
    configuredPort: rig?.recorded.configuredPort ?? null,
    sdkSaid: rig?.recorded.asks.find((one) => one.toolName === 'Bash')?.options ?? null,
    card,
    sessionGrantPress,
    reachedThisPort: loopback.requests.some((one) => one.localPort === loopback.port),
    failure,
    stderr: rig?.recorded.stderr ?? '',
  }
  const evidence = runEvidence('permission-markers')
  mkdirSync(evidence, { recursive: true })
  writeFileSync(join(evidence, `${label}.json`), `${JSON.stringify({ ...arm, events }, null, 2)}\n`)
  if (failure === null && rig !== null) rmSync(rig.root, { recursive: true, force: true })
  console.log(
    `[695 permission markers · ${label}]`,
    JSON.stringify(
      {
        cli: arm.cli,
        command: COMMANDS[label],
        sdkSaid: {
          suppressAlwaysAllowRule: arm.sdkSaid?.['suppressAlwaysAllowRule'] ?? '<absent>',
          defaultToNo: arm.sdkSaid?.['defaultToNo'] ?? '<absent>',
          decisionReason: arm.sdkSaid?.['decisionReason'] ?? '<absent>',
        },
        card:
          card === null
            ? null
            : {
                suppressAlwaysAllowRule: card.suppressAlwaysAllowRule ?? '<absent>',
                defaultToNo: card.defaultToNo ?? '<absent>',
                availableDecisions: card.scope.availableDecisions,
                persistence: card.scope.persistence,
              },
        sessionGrantPress,
        failure,
      },
      null,
      2,
    ),
  )
  return arm
}

const SESSION_GRANTS = ['allow_for_session', 'allow_all_for_session']

it(
  '695 · unmarked (the control): an ordinary command keeps today’s choices',
  () =>
    deadline.within('arm unmarked', async () => {
      const arm = await measure('unmarked')
      expect(arm.failure, arm.stderr).toBeNull()
      expect(arm.configuredPort).toBe(arm.listenedOn)
      expect(arm.reachedThisPort).toBe(true)
      expect(arm.sdkSaid?.['suppressAlwaysAllowRule']).toBeUndefined()
      expect(arm.card?.suppressAlwaysAllowRule).toBeUndefined()
      expect(
        arm.card?.scope.availableDecisions.some((one) => SESSION_GRANTS.includes(one)),
        'the control card lost its session grant',
      ).toBe(true)
      expect(arm.sessionGrantPress).toBe('accepted')
    }),
  deadline.testTimeoutMs,
)

it(
  '695 · marked (the subject, R36a): no session grant is offered, and none is accepted',
  () =>
    deadline.within('arm marked', async () => {
      const arm = await measure('marked')
      expect(arm.failure, arm.stderr).toBeNull()
      expect(arm.configuredPort).toBe(arm.listenedOn)
      expect(arm.reachedThisPort).toBe(true)
      // ⚑ The CLI marked it — without this the arm measures nothing about the product.
      expect(arm.sdkSaid?.['suppressAlwaysAllowRule'], 'the CLI did not mark this ask').toBe(true)
      expect(
        arm.card?.scope.availableDecisions.filter((one) => SESSION_GRANTS.includes(one)),
        'a marked card still offers a session grant',
      ).toEqual([])
      expect(arm.card?.scope.persistence).toBe('once')
      expect(arm.card?.suppressAlwaysAllowRule).toBe(true)
      expect(arm.sessionGrantPress).toMatch(/^refused: /)
    }),
  deadline.testTimeoutMs,
)

// ⛔ Registered only when it can run — an arm that returned early would read as a pass.
if ((process.env['BROBOT_PROBE_SDK_0_3_218'] ?? '') === '') {
  console.log(
    '[695 permission markers · pin-0.3.218] NOT PERFORMED — BROBOT_PROBE_SDK_0_3_218 names no 0.3.218 SDK entry',
  )
} else
  it(
    '695 · pin 0.3.218: the older CLI, for the record',
    () =>
      deadline.within('arm pin-0.3.218', async () => {
        const arm = await measure('pin-0.3.218')
        expect(arm.failure, arm.stderr).toBeNull()
        expect(arm.cli).toBe('2.1.218')
        // ⚑ Measured, not a ruling: 2.1.218 does not promote a background `&` to a mark.
        expect(arm.sdkSaid?.['suppressAlwaysAllowRule']).toBeUndefined()
      }),
    deadline.testTimeoutMs,
  )
