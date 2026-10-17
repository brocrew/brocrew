import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { expect, it } from 'vitest'
// 🔒 **A deep import, and deliberately** — `codex-tool-answer-probe.smoke.ts`'s reason, verbatim:
// this probe owns its spawn so it can put the loopback provider's `env_key` in the child
// environment, which `createSpawnTransportFactory` sanitizes away.
import { SpawnCodexTransport } from '../src/codex/codex-transport'
import { bundledCodexBinary } from './bundled-codex'
import {
  bounded,
  readArm,
  wantedCalls,
  type ArmReader,
  type Plan,
  type Stamped,
} from './cancel-interrupt-reader'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

/**
 * 🔴 **492 · can a Codex turn BLOCKED AWAITING AN AGENT-TOOL RESULT be interrupted cleanly?**
 *
 * ## ⛔ The question, and why nothing in the repository could answer it
 *
 * `HO-032` §1 ruled that Cancel on an agent-tool card must send the interrupt instead of latching
 * a local bit. ⚠️ **The PO made one thing this dispatch's to measure:** *"An agent blocked awaiting
 * a tool result may not interrupt tidily, and that is yours to measure."* ⛔ **Against the
 * provider, not against our adapter's expectations** — when `492` wrote this, the adapter had never
 * sent `turn/interrupt` on this path and every test asserted the frame's ABSENCE. ⚑ `492` itself
 * changed that: `codex-runtime.ts`'s `handleAgentToolCall` now sends it on Cancel, and
 * `codex-runtime.test.ts` asserts it is sent exactly once. This probe is still the provider half.
 *
 * ⚑ **The blocked state is the whole point.** Codex is not thinking; its isolate is parked on an
 * `await` for a JSON-RPC response only this app can write. A turn interrupted while the model is
 * generating is `275`'s measurement and is not this one.
 *
 * ## 🔴 Two arms and their control — then a fourth, D, in its own test
 *
 * | arm | what the probe does | what it answers |
 * |---|---|---|
 * | **A · never-answer** | leaves `item/tool/call` outstanding, then `turn/interrupt` | the PO's question, literally: the turn is blocked on us and we interrupt it |
 * | **B · answer-then-interrupt** | answers with the product's own declined payload, then `turn/interrupt` | the shape the repair ships — does the ordering matter |
 * | **C · answer-only** | answers declined and never interrupts | ⛔ **the control**: the same decline, one fact over, so `interrupted` cannot be read off a turn that would have said it anyway |
 * | **D · two-calls** | holds two calls open, declines the first, then `turn/interrupt` | whether the provider clears the card nobody pressed — the second test, below |
 *
 * ⛔ **C is not decoration.** Without it, arm B reporting `interrupted` proves nothing about the
 * interrupt: `a-comparison-tested-where-both-sides-agree-measures-nothing` is this project's
 * standing rule, and the two readings diverge only on whether the RPC was sent.
 *
 * ## ⚑ It costs no tokens and needs no credential
 *
 * Use an owned loopback Responses endpoint, ephemeral port, and temporary `CODEX_HOME` under
 * scratch, with `env_key` set to `probe-only`. Personal `provider-homes/`, `~/.codex`, and
 * `:9444` stay untouched.
 *
 * ⚠️ **One outer budget for all four arms, A–D** (standing rule 13), shared by both tests below:
 * arm D does not receive a fresh one, and a wait that expires is reported as NOT PERFORMED rather
 * than waited on. ⛔ **`492` wrote it as five minutes; that was below the arms' own worst case**
 * (`649` F2), which `042`'s rule forbids — a hang must fail as its step, not as *budget exceeded*.
 * ⚑ It is now DERIVED from the waits below ({@link serialWaitsMs}), so it moves when they do.
 *
 * Run: `pnpm run probe:codex-cancel-interrupt`. Not part of `pnpm run ci`.
 */

const NAMESPACE = 'brobot'
const TOOL = 'spawn_agent'

/** ⚠️ Bounded, standing rule 13. */
const RPC_DEADLINE_MS = 30_000
const ARRIVAL_DEADLINE_MS = 60_000
/** How long we keep listening AFTER the interrupt, so a late `turn/completed` is not missed. */
const SETTLE_MS = 15_000
/**
 * ⚑ **The transport's own teardown bounds, passed explicitly** so the budget can count them:
 * `close()` ends stdin, waits `EXIT_GRACE_MS`, then SIGTERM and SIGKILL each wait `KILL_GRACE_MS`.
 */
const EXIT_GRACE_MS = 2_000
const KILL_GRACE_MS = 2_000
const TEARDOWN_MS = EXIT_GRACE_MS + 2 * KILL_GRACE_MS

/**
 * ⛔ **Every wait one arm can make in turn** — the worst case is each of them expiring. A and D
 * interrupt from the main flow (bind the turn id, then the RPC); B's interrupt is settled before
 * teardown; C, the control, sends none.
 */
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

/** ⛔ One budget for A–D together, derived — `042`'s rule, not a figure somebody chose. */
const deadline = probeRunDeadline(
  '492 probe',
  runBudgetMs(ARMS.flatMap(([, plan]) => serialWaitsMs(plan))),
  TEARDOWN_MS,
)

/**
 * ⛔ **The product's own declined payload, copied because it is the thing under test.**
 * `codex-runtime.ts`'s `handleAgentToolCall` answers every non-`allow` decision with exactly this
 * shape — `{contentItems:[inputText], success:false}` — and arms B and C send it verbatim so the
 * measurement is about the INTERRUPT and not about a payload this probe invented.
 */
const DECLINED = {
  contentItems: [
    {
      type: 'inputText',
      text: `the person using this app declined the ${TOOL} call, so nothing was done`,
    },
  ],
  success: false,
}

/**
 * 🔴 **The script the synthetic model runs.** `457` measured that a bare call produces `Output:`
 * with nothing after it, so the script reports the return value — which also means arm A's isolate
 * is parked on this `await` for as long as nobody answers.
 */
const EXEC_SOURCE = [
  `const answer = await tools.${NAMESPACE}__${TOOL}({ profile: "worker", task: "492" })`,
  `text("BROBOT492:" + JSON.stringify(answer))`,
].join('\n')

/**
 * ⛔ **Arm D's script: TWO calls in flight at once.** ⚑ The repair must not settle anybody else's
 * card on the person's behalf — that is the harm `INTERRUPT_RAILS`' `a-person-is-being-asked`
 * exists to refuse — so the question is whether the PROVIDER clears the other outstanding request
 * when the turn is interrupted, or whether it is left dangling with nobody holding it.
 */
const EXEC_SOURCE_TWO = [
  `const both = await Promise.all([`,
  `  tools.${NAMESPACE}__${TOOL}({ profile: "one", task: "492" }),`,
  `  tools.${NAMESPACE}__${TOOL}({ profile: "two", task: "492" }),`,
  `])`,
  `text("BROBOT492:" + JSON.stringify(both))`,
].join('\n')

function providerStanza(port: number): string {
  return [
    'model = "gpt-5.6-luna"',
    'model_provider = "capture"',
    '',
    '[model_providers.capture]',
    'name = "BroBot 492 capture"',
    `base_url = "http://127.0.0.1:${port}/v1"`,
    'env_key = "BROBOT_492_CAPTURE_KEY"',
    'request_max_retries = 0',
    'stream_max_retries = 0',
    '',
  ].join('\n')
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no loopback port')
  return address.port
}

function usage(): Record<string, unknown> {
  return {
    input_tokens: 11,
    input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    output_tokens: 7,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 18,
  }
}

function streamToolCall(response: ServerResponse, index: number, source: string): void {
  const send = (kind: string, payload: Record<string, unknown>): void => {
    response.write(`event: ${kind}\ndata: ${JSON.stringify({ type: kind, ...payload })}\n\n`)
  }
  response.statusCode = 200
  response.setHeader('content-type', 'text/event-stream')
  response.setHeader('cache-control', 'no-cache')
  response.setHeader('connection', 'keep-alive')
  send('response.created', { response: { id: `resp_492_${index}` } })
  send('response.output_item.done', {
    output_index: 0,
    item: {
      type: 'custom_tool_call',
      id: `ctc_492_${index}`,
      call_id: `call_492_${index}`,
      name: 'exec',
      input: source,
      status: 'completed',
    },
  })
  send('response.completed', { response: { id: `resp_492_${index}`, usage: usage() } })
  response.end()
}

/** The closing turn: a plain message, so an uninterrupted arm finishes instead of looping. */
function streamGoodbye(response: ServerResponse, index: number): void {
  const send = (kind: string, payload: Record<string, unknown>): void => {
    response.write(`event: ${kind}\ndata: ${JSON.stringify({ type: kind, ...payload })}\n\n`)
  }
  response.statusCode = 200
  response.setHeader('content-type', 'text/event-stream')
  response.setHeader('cache-control', 'no-cache')
  response.setHeader('connection', 'keep-alive')
  send('response.created', { response: { id: `resp_492_end_${index}` } })
  send('response.output_item.done', {
    output_index: 0,
    item: {
      type: 'message',
      id: `msg_492_${index}`,
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'done', annotations: [] }],
    },
  })
  send('response.completed', { response: { id: `resp_492_end_${index}`, usage: usage() } })
  response.end()
}

interface Arm {
  readonly label: string
  readonly plan: Plan
  /** Every notification the app-server published, stamped ms after `turn/start` went out. */
  readonly notifications: readonly Stamped[]
  /** Every server REQUEST it made us, stamped. */
  readonly requests: readonly Stamped[]
  /** The model requests the loopback endpoint saw. */
  readonly modelRequests: number
  /** How many `item/tool/call` requests were outstanding at once. */
  readonly toolCalls: number
  readonly toolCallAt: number | null
  readonly interruptSentAt: number | null
  readonly interruptResolvedAt: number | null
  readonly interruptError: string | null
  readonly turnCompletedAt: number | null
  readonly turnStatus: string | null
  readonly answeredAt: number | null
  /** ⚠️ Whether the provider itself cleared the outstanding tool call, and when. */
  readonly serverRequestResolvedAt: number | null
  readonly failure: string | null
  /** ⚑ Rule 40: the port the loopback server was given, and the one the child's config names. */
  readonly listenedOn: number | null
  readonly configuredPort: number | null
  /** ⚠️ Kept until the arm's expectations pass — a failing run leaves its evidence (`649` F6). */
  readonly root: string
}

/** ⚑ Rule 40: the port the child was CONFIGURED with, read back from the file it will read. */
function configuredPortOf(config: string): number | null {
  const match = /^base_url = "http:\/\/127\.0\.0\.1:(\d+)\/v1"$/m.exec(config)
  return match === null ? null : Number(match[1])
}

async function capture(label: string, plan: Plan): Promise<Arm> {
  deadline.refuse(`starting arm ${label}`)
  const scratch = runScratch('codex-cancel-interrupt')
  mkdirSync(scratch, { recursive: true })
  const root = mkdtempSync(join(scratch, `${label}-`))
  const home = join(root, 'home')
  const cwd = join(root, 'cwd')
  mkdirSync(home, { recursive: true })
  mkdirSync(cwd, { recursive: true })

  const script = plan === 'two-answer-one-then-interrupt' ? EXEC_SOURCE_TWO : EXEC_SOURCE
  let modelRequests = 0
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      modelRequests += 1
      if (modelRequests === 1) streamToolCall(response, modelRequests, script)
      else streamGoodbye(response, modelRequests)
    })
  })

  let transport: SpawnCodexTransport | null = null
  let reader: ArmReader | null = null
  let started = 0
  const since = (): number => (started === 0 ? 0 : Date.now() - started)
  let threadId = ''
  let turnId = ''
  let failure: string | null = null
  let listenedOn: number | null = null
  let configuredPort: number | null = null
  let turnCompletedAt: number | null = null
  let turnStatus: string | null = null

  /**
   * ⛔ **Owned BEFORE anything exists, and closes whatever is open EACH time it is called** (`649`
   * F6). The server, the child and its reader are made inside the `try` below, so a throw after
   * any of them — the bundled binary missing, a port that will not bind — still reaches this. ⚠️
   * And it is deliberately not single-flight: an expiry that lands while the port is still binding
   * finds nothing to close, so the `finally` must be able to close what was made after it.
   */
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

  const waitFor = async (what: () => boolean, ms: number): Promise<boolean> => {
    const until = Date.now() + ms
    while (!what() && Date.now() < until) await new Promise((r) => setTimeout(r, 25))
    return what()
  }

  try {
    listenedOn = await listen(server)
    // ⚠️ An expiry during the bind found nothing to close; refuse before spawning into it.
    deadline.refuse(`starting arm ${label} · the loopback port is bound`)
    writeFileSync(join(home, 'config.toml'), providerStanza(listenedOn))
    configuredPort = configuredPortOf(readFileSync(join(home, 'config.toml'), 'utf8'))

    transport = new SpawnCodexTransport(bundledCodexBinary(), ['app-server'], {
      cwd,
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: root,
        CODEX_HOME: home,
        CODEX_SQLITE_HOME: home,
        BROBOT_492_CAPTURE_KEY: 'probe-only',
      },
      exitGraceMs: EXIT_GRACE_MS,
      killGraceMs: KILL_GRACE_MS,
    })
    const owned = transport
    reader = readArm(owned, {
      plan,
      declined: DECLINED,
      since,
      turn: () => ({ threadId, turnId }),
      rpcDeadlineMs: RPC_DEADLINE_MS,
      probe: '492 probe',
    })
    const { reading, wantedCallsReached } = reader

    await bounded(
      'initialize',
      owned.request('initialize', {
        clientInfo: {
          name: 'brobot-492-probe',
          title: 'BroBot 492 cancel-interrupt probe',
          version: '0.0.0',
        },
        capabilities: { experimentalApi: true, requestAttestation: false },
      }),
      RPC_DEADLINE_MS,
    )
    owned.notify('initialized', {})
    const thread = (await bounded(
      'thread/start',
      owned.request('thread/start', {
        model: 'gpt-5.6-luna',
        modelProvider: 'capture',
        cwd,
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
        sandbox: 'danger-full-access',
        dynamicTools: [
          {
            type: 'namespace',
            name: NAMESPACE,
            description: 'Tools that reach the app this agent is running inside.',
            tools: [
              {
                type: 'function',
                name: TOOL,
                description: `492 probe · ${TOOL}`,
                inputSchema: {
                  type: 'object',
                  properties: { profile: { type: 'string' }, task: { type: 'string' } },
                },
              },
            ],
          },
        ],
      }),
      RPC_DEADLINE_MS,
    )) as { thread?: { id?: string } }
    threadId = thread.thread?.id ?? ''

    started = Date.now()
    // ⚑ **The turn id comes from the `turn/start` RESPONSE**, which is the authoritative binding
    // `037` chose over the `turn/started` notification — the same source `codex-runtime.ts` uses.
    const turnStart = owned.request('turn/start', {
      threadId,
      input: [{ type: 'text', text: '492 call the tool', text_elements: [] }],
      cwd,
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandboxPolicy: { type: 'dangerFullAccess' },
      model: 'gpt-5.6-luna',
      effort: 'low',
    })
    void turnStart.then(
      (result) => {
        const turn = (result as { turn?: { id?: string } } | undefined)?.turn
        if (typeof turn?.id === 'string') turnId = turn.id
      },
      () => {},
    )

    const blocked = await bounded(
      'the wanted item/tool/call',
      wantedCallsReached,
      ARRIVAL_DEADLINE_MS,
    )
      .then(() => true)
      .catch(() => false)
    if (!blocked) {
      failure = `NOT PERFORMED — fewer than ${wantedCalls(plan)} item/tool/call within ${ARRIVAL_DEADLINE_MS}ms`
    } else if (plan !== 'answer-only' && plan !== 'answer-then-interrupt') {
      const bound = await waitFor(() => turnId.length > 0, RPC_DEADLINE_MS)
      if (!bound) {
        failure = `NOT PERFORMED — turn/start did not bind a turn id within ${RPC_DEADLINE_MS}ms`
      } else {
        reading.interruptSentAt = since()
        try {
          await bounded(
            'turn/interrupt',
            owned.request('turn/interrupt', { threadId, turnId }),
            RPC_DEADLINE_MS,
          )
          reading.interruptResolvedAt = since()
        } catch (error) {
          reading.interruptError = error instanceof Error ? error.message : String(error)
        }
      }
    }

    // ⚠️ Bounded: a `turn/completed` that never comes is the answer, not a reason to keep waiting.
    const completed = (): boolean =>
      reading.notifications.some((one) => one.method === 'turn/completed')
    await waitFor(completed, SETTLE_MS)
    const done = reading.notifications.find((one) => one.method === 'turn/completed')
    if (done !== undefined) {
      turnCompletedAt = done.at
      const turn = (done.params as { turn?: { status?: unknown } } | undefined)?.turn
      turnStatus = typeof turn?.status === 'string' ? turn.status : '(no status on the frame)'
    }
    // ⚑ B's interrupt is settled BEFORE the transport closes — bounded by its own RPC deadline —
    // or a close would be recorded as its error.
    await reader.interruptSettled()
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  } finally {
    try {
      await closeOwnedCapture()
    } finally {
      release()
    }
  }

  const reading = reader?.reading
  const arm: Arm = {
    label,
    plan,
    notifications: [...(reading?.notifications ?? [])],
    requests: [...(reading?.requests ?? [])],
    modelRequests,
    toolCalls: reading?.toolCalls ?? 0,
    toolCallAt: reading?.toolCallAt ?? null,
    interruptSentAt: reading?.interruptSentAt ?? null,
    interruptResolvedAt: reading?.interruptResolvedAt ?? null,
    interruptError: reading?.interruptError ?? null,
    turnCompletedAt,
    turnStatus,
    answeredAt: reading?.answeredAt ?? null,
    serverRequestResolvedAt: reading?.serverRequestResolvedAt ?? null,
    failure: failure ?? reading?.failure ?? null,
    listenedOn,
    configuredPort,
    root,
  }
  const configPath = join(home, 'config.toml')
  writeFileSync(
    runEvidence(`492-${label}.json`),
    JSON.stringify(
      {
        config: existsSync(configPath) ? readFileSync(configPath, 'utf8') : null,
        toolCallId: reading?.toolCallId ?? null,
        ...arm,
      },
      null,
      1,
    ),
  )
  return arm
}

const methodsAfter = (arm: Arm, from: number | null): string[] =>
  from === null ? [] : arm.notifications.filter((one) => one.at >= from).map((one) => one.method)

async function measureThreeArms(): Promise<void> {
  // ⚑ Spread from `ARMS`, so an arm the budget does not count cannot be run.
  const neverAnswer = await capture(...ARMS[0])
  const answerThenInterrupt = await capture(...ARMS[1])
  const answerOnly = await capture(...ARMS[2])

  const arms = [neverAnswer, answerThenInterrupt, answerOnly]
  const report = Object.fromEntries(
    arms.map((arm) => [
      arm.label,
      {
        failure: arm.failure,
        modelRequests: arm.modelRequests,
        toolCalls: arm.toolCalls,
        toolCallAt: arm.toolCallAt,
        answeredAt: arm.answeredAt,
        interruptSentAt: arm.interruptSentAt,
        interruptResolvedAt: arm.interruptResolvedAt,
        interruptError: arm.interruptError,
        turnCompletedAt: arm.turnCompletedAt,
        turnStatus: arm.turnStatus,
        serverRequestResolvedAt: arm.serverRequestResolvedAt,
        serverRequests: arm.requests.map((one) => `${one.method}@${one.at}`),
        afterTheInterrupt: methodsAfter(arm, arm.interruptSentAt),
        allNotifications: arm.notifications.map((one) => `${one.method}@${one.at}`),
      },
    ]),
  )
  writeFileSync(runEvidence('492-report.json'), JSON.stringify(report, null, 1))
  console.log(`492 cancel-interrupt · ${JSON.stringify(report, null, 1)}`)

  // ⛔ **Every arm, and the review reason from `457`**: a regression that lands in `failure`
  // rather than throwing is a silent arm, and a silent arm is a green run.
  for (const arm of arms) {
    expect(arm.failure, `${arm.label} · the arm`).toBeNull()
    expect(arm.toolCallAt, `${arm.label} · the turn reached our tool`).not.toBeNull()
    // ⚑ Rule 40: the child was configured with the port this process was GIVEN, and used it.
    expect(arm.listenedOn, `${arm.label} · the loopback port`).not.toBeNull()
    expect(arm.configuredPort, `${arm.label} · the port in the child's config`).toBe(arm.listenedOn)
    expect(arm.modelRequests, `${arm.label} · the child asked our fake`).toBeGreaterThan(0)
  }

  // 🔴 **The premise: arm A really was BLOCKED on us.** Nothing was answered and the model was
  // never asked a second time, so the turn had nowhere to go but our response.
  expect(neverAnswer.answeredAt, 'A · nothing was answered').toBeNull()
  expect(neverAnswer.modelRequests, 'A · the model was asked exactly once').toBe(1)

  // 🔴 **The answer to the PO's question.**
  expect(neverAnswer.interruptError, 'A · turn/interrupt was accepted').toBeNull()
  expect(neverAnswer.interruptResolvedAt, 'A · turn/interrupt resolved').not.toBeNull()
  expect(neverAnswer.turnStatus, 'A · and the turn ended, saying how').toBe('interrupted')

  // ⚑ **And the shape the repair ships.**
  expect(answerThenInterrupt.interruptError, 'B · turn/interrupt was accepted').toBeNull()
  expect(answerThenInterrupt.turnStatus, 'B · the turn ended interrupted').toBe('interrupted')

  // ⛔ **The CONTROL, and it is what makes the two above a measurement.** The same declined
  // payload, one fact over — no `turn/interrupt` — and the provider reports an ordinary
  // completion. Without this, `interrupted` could be what a declined tool call says anyway.
  expect(answerOnly.interruptSentAt, 'C · no interrupt was sent').toBeNull()
  expect(answerOnly.turnStatus, 'C · so the provider completes the turn normally').toBe('completed')

  // ⚠️ Only a run that got this far deletes its roots; a failing one leaves them (`649` F6).
  for (const arm of arms) rmSync(arm.root, { recursive: true, force: true })
}

it(
  '492 · a Codex turn blocked awaiting an agent-tool result, interrupted',
  () => deadline.within('measuring arms A–C', measureThreeArms),
  deadline.testTimeoutMs,
)

/**
 * 🔴 **492 §3, second reading · the card the person did NOT press anything on.**
 *
 * ⛔ **`INTERRUPT_RAILS`' `a-person-is-being-asked` exists because `settleRequests()` denies every
 * open card on the person's behalf and writes nothing.** ⚑ So the repair must not call it — but
 * then somebody has to clear the other outstanding request, and *absence in a capture is not
 * absence*: the only way to know whether the provider does it is to leave one outstanding and look.
 *
 * ⚠️ **Two calls in flight, one answered, then the interrupt.** What happens to the second is the
 * measurement.
 */
async function measureSecondCard(): Promise<void> {
  const two = await capture(...ARMS[3])
  const report = {
    failure: two.failure,
    toolCalls: two.toolCalls,
    answeredAt: two.answeredAt,
    interruptSentAt: two.interruptSentAt,
    interruptResolvedAt: two.interruptResolvedAt,
    interruptError: two.interruptError,
    turnStatus: two.turnStatus,
    serverRequestResolvedAt: two.serverRequestResolvedAt,
    afterTheInterrupt: methodsAfter(two, two.interruptSentAt),
    allNotifications: two.notifications.map((one) => `${one.method}@${one.at}`),
  }
  writeFileSync(runEvidence('492-two-report.json'), JSON.stringify(report, null, 1))
  console.log(`492 second card · ${JSON.stringify(report, null, 1)}`)

  expect(two.failure, 'D · the arm').toBeNull()
  expect(two.configuredPort, "D · the port in the child's config").toBe(two.listenedOn)
  // ⛔ **The premise.** Without two outstanding calls this arm measures the same thing as arm B.
  expect(two.toolCalls, 'D · two calls were in flight').toBe(2)
  // ⚠️ `649` F6: a `turn/interrupt` that stalled or erred is NOT PERFORMED, and D never said so.
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
