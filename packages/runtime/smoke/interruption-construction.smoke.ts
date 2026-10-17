import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { loadavg } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { SpawnCodexTransport } from '../src/codex/codex-transport'
import { bundledCodexBinary } from './bundled-codex'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

/**
 * 443 · construction arm for criterion 8. The bundled Codex app-server talks to a loopback
 * Responses endpoint that is the model. No credential is provisioned and no real model is invoked.
 *
 * The endpoint holds a response open after `response.created`. The probe sends `turn/interrupt`
 * to the real bundled app-server while that provider request is active, and observes the raw
 * `turn/completed` frame. A second arm releases the same stream normally. This proves that the
 * interrupt control reaches the app-server before a provider turn boundary; it cannot prove that
 * the BroBot adapter or a real model perceived the interruption or retained task context later.
 *
 * ## ⛔ 669 · one outer deadline, derived from the waits below
 *
 * ⚠️ **Until `669` this file had no bound but vitest's own per-test default** (`655` §4). It had a
 * `TOTAL_MS` of eight minutes, typed rather than derived and checked only AFTER the run had spent it
 * — an assertion about elapsed time, not a bound. ⚑ Its waits were already bounded one by one; the
 * run now sits inside `smoke/probe-run-deadline.ts` in the template's shape, with the budget counted
 * from {@link ARMS}' own waits, a refusal before each arm and again once its port is bound, and the
 * arm's teardown owned before anything exists.
 *
 * Run the file ALONE: `pnpm exec vitest run --config vitest.smoke.config.ts
 * packages/runtime/smoke/interruption-construction.smoke.ts`. ⛔ Not `pnpm run probe:interrupt` —
 * its other two files are live providers.
 */

const MARKER = 'BROBOT_443_WORK_IN_FLIGHT'
const MODEL = 'gpt-5.6-luna'
const STEP_MS = 45_000
const HANDSHAKE_MS = 20_000
/** The interrupt arm's sample of the endpoint, taken before this probe's own teardown. */
const SAMPLE_MS = 500
/**
 * The transport's own close: `close()` ends stdin, waits `EXIT_GRACE_MS`, then SIGTERM and SIGKILL
 * each wait `KILL_GRACE_MS`.
 */
const EXIT_GRACE_MS = 2_000
const KILL_GRACE_MS = 2_000
/**
 * ⚑ **The arm's OWN close, which is what an expiry waits for** — three steps, each bounded at
 * {@link HANDSHAKE_MS}: the transport's close (its own reap inside it), the event drain, the loopback.
 * ⚠️ It was the transport's reap alone until the `669` review, so an expiry could reject before the
 * drain and the loopback close had run.
 */
const TEARDOWN_MS = 3 * HANDSHAKE_MS

/** ⛔ **The two arms, as one list the budget is counted from.** */
const ARMS = ['interrupt', 'control'] as const
type ArmName = (typeof ARMS)[number]

/**
 * One arm's worst case, wait by wait: the loopback bind, the three handshake requests, the active
 * provider request, then the interrupt arm's terminal and endpoint sample or the control's terminal,
 * and the arm's own bounded teardown. ⚠️ The interrupt RPC's own `STEP_MS` runs BESIDE the terminal
 * wait, not after it, so it adds nothing serial.
 */
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

interface TimedFrame {
  readonly at: number
  readonly method: string
  readonly params: unknown
}

interface Outbound {
  readonly at: number
  readonly method: string
  readonly params: unknown
  readonly responseAt?: number
  readonly failure?: string
}

interface ArmEvidence {
  readonly arm: string
  readonly threadId: string | null
  readonly turnId: string | null
  readonly endpointSawMarker: boolean
  readonly endpointStartedAt: number | null
  readonly endpointClosedAt: number | null
  /** Sampled before this probe's teardown, so its own `response.end()` cannot count. */
  readonly endpointClosedBeforeCleanup: boolean | null
  readonly ordinaryResponseCompletedAt: number | null
  readonly interruptCalledAt: number | null
  readonly loads: readonly string[]
  readonly outbound: readonly Outbound[]
  readonly frames: readonly TimedFrame[]
  readonly error: string | null
  readonly listenedOn: number | null
  readonly configuredPort: number | null
  /** ⚠️ Kept until every expectation passes — a failing run leaves its own (`649` F6). */
  readonly root: string
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function load(label: string, into: string[]): void {
  const [one, five, fifteen] = loadavg()
  into.push(
    `${label}: ${(one ?? 0).toFixed(2)} / ${(five ?? 0).toFixed(2)} / ${(fifteen ?? 0).toFixed(2)}`,
  )
}

async function bounded<T>(name: string, milliseconds: number, action: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      action,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${name}: NOT PERFORMED after ${milliseconds} ms`)),
          milliseconds,
        )
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function until(
  name: string,
  predicate: () => boolean,
  milliseconds = STEP_MS,
): Promise<void> {
  const endsAt = Date.now() + milliseconds
  while (Date.now() < endsAt) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`${name}: NOT PERFORMED after ${milliseconds} ms`)
}

function sendEvent(response: ServerResponse, kind: string, payload: Record<string, unknown>): void {
  response.write(`event: ${kind}\ndata: ${JSON.stringify({ type: kind, ...payload })}\n\n`)
}

function completeResponse(response: ServerResponse, index: number): void {
  const responseId = `resp_443_${index}`
  sendEvent(response, 'response.output_item.done', {
    output_index: 0,
    item: {
      type: 'message',
      id: `msg_443_${index}`,
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'control completed normally', annotations: [] }],
    },
  })
  sendEvent(response, 'response.completed', {
    response: {
      id: responseId,
      usage: {
        input_tokens: 11,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
        output_tokens: 7,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: 18,
      },
    },
  })
  response.end()
}

function providerStanza(port: number): string {
  return [
    `model = "${MODEL}"`,
    'model_provider = "capture"',
    '',
    '[model_providers.capture]',
    'name = "BroBot 443 construction endpoint"',
    `base_url = "http://127.0.0.1:${port}/v1"`,
    'env_key = "BROBOT_443_CAPTURE_KEY"',
    'request_max_retries = 0',
    'stream_max_retries = 0',
    '',
  ].join('\n')
}

async function listen(server: Server): Promise<number> {
  await bounded(
    'loopback listen',
    HANDSHAKE_MS,
    new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    }),
  )
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no owned loopback port')
  return address.port
}

/** ⚑ Rule 40: the port the child was CONFIGURED with, read back from the file it reads. */
function configuredPortOf(config: string): number | null {
  const match = /^base_url = "http:\/\/127\.0\.0\.1:(\d+)\/v1"$/m.exec(config)
  return match === null ? null : Number(match[1])
}

function turnOf(frame: TimedFrame): { id?: string; status?: string } | null {
  const params = frame.params as { turn?: { id?: string; status?: string } } | undefined
  return params?.turn ?? null
}

async function runArm(arm: ArmName): Promise<ArmEvidence> {
  deadline.refuse(`starting arm ${arm}`)
  const scratch = runScratch('interruption-construction')
  mkdirSync(scratch, { recursive: true })
  const root = mkdtempSync(join(scratch, `${arm}-`))
  const home = join(root, 'home')
  const cwd = join(root, 'cwd')
  mkdirSync(home, { recursive: true })
  mkdirSync(cwd, { recursive: true })

  const loads: string[] = []
  const outbound: Outbound[] = []
  const frames: TimedFrame[] = []
  let endpointSawMarker = false
  let endpointStartedAt: number | null = null
  let endpointClosedAt: number | null = null
  let endpointClosedBeforeCleanup: boolean | null = null
  let ordinaryResponseCompletedAt: number | null = null
  let heldResponse: ServerResponse | null = null
  let interruptCalledAt: number | null = null
  let threadId: string | null = null
  let turnId: string | null = null
  let error: string | null = null
  let transport: SpawnCodexTransport | null = null
  let pump: Promise<void> | null = null
  let listenedOn: number | null = null
  let configuredPort: number | null = null

  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      endpointSawMarker ||= body.includes(MARKER)
      endpointStartedAt = Date.now()
      response.on('close', () => {
        endpointClosedAt = Date.now()
      })
      response.statusCode = 200
      response.setHeader('content-type', 'text/event-stream')
      response.setHeader('cache-control', 'no-cache')
      response.setHeader('connection', 'keep-alive')
      heldResponse = response
      sendEvent(response, 'response.created', { response: { id: 'resp_443_1' } })
    })
  })

  /**
   * ⛔ **Owned BEFORE anything exists, and closes whatever is open EACH time it is called** — the
   * template's reason (`649` F6): an expiry that lands while the port is binding finds nothing to
   * close, so the `finally` must be able to close what was made after it. ⚑ Every step keeps the
   * bound it always had, and a failed one is recorded rather than thrown past the next.
   */
  const closeOwnedArm = async (): Promise<void> => {
    const pendingResponse = heldResponse as ServerResponse | null
    if (pendingResponse !== null && !pendingResponse.writableEnded) pendingResponse.end()
    if (transport !== null) {
      try {
        await bounded(`${arm} close`, HANDSHAKE_MS, transport.close())
      } catch (cause) {
        error ??= `close: ${errorText(cause)}`
      }
    }
    if (pump !== null) {
      try {
        await bounded(`${arm} event drain`, HANDSHAKE_MS, pump)
      } catch (cause) {
        error ??= `event drain: ${errorText(cause)}`
      }
    }
    if (!server.listening) return
    try {
      await bounded(
        `${arm} loopback close`,
        HANDSHAKE_MS,
        new Promise<void>((resolve) => server.close(() => resolve())),
      )
    } catch (cause) {
      error ??= `loopback close: ${errorText(cause)}`
      server.closeAllConnections()
    }
  }
  const release = deadline.own(() => closeOwnedArm())

  try {
    listenedOn = await listen(server)
    deadline.refuse(`starting arm ${arm} · the loopback port is bound`)
    writeFileSync(join(home, 'config.toml'), providerStanza(listenedOn))
    configuredPort = configuredPortOf(readFileSync(join(home, 'config.toml'), 'utf8'))
    load(`${arm} before bundled app-server launch`, loads)
    transport = new SpawnCodexTransport(bundledCodexBinary(), ['app-server'], {
      cwd,
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: root,
        CODEX_HOME: home,
        CODEX_SQLITE_HOME: home,
        BROBOT_443_CAPTURE_KEY: 'probe-only',
      },
      exitGraceMs: EXIT_GRACE_MS,
      killGraceMs: KILL_GRACE_MS,
    })
    const wire = transport
    pump = (async () => {
      for await (const frame of wire.incoming()) {
        if (frame.kind === 'notification') {
          frames.push({ at: Date.now(), method: frame.method, params: frame.params })
        } else {
          wire.respondError(
            frame.id,
            -32601,
            `443 construction probe does not implement ${frame.method}`,
          )
        }
      }
    })()
    const send = async (method: string, params: unknown): Promise<unknown> => {
      const row: {
        at: number
        method: string
        params: unknown
        responseAt?: number
        failure?: string
      } = {
        at: Date.now(),
        method,
        params,
      }
      outbound.push(row)
      try {
        const answer = await wire.request(method, params)
        row.responseAt = Date.now()
        return answer
      } catch (cause) {
        row.failure = errorText(cause)
        throw cause
      }
    }
    await bounded(
      `${arm} initialize`,
      HANDSHAKE_MS,
      send('initialize', {
        clientInfo: {
          name: 'brobot-443-probe',
          title: 'BroBot 443 construction probe',
          version: '0.0.0',
        },
        capabilities: { experimentalApi: true, requestAttestation: false },
      }),
    )
    wire.notify('initialized', {})
    const started = (await bounded(
      `${arm} thread/start`,
      HANDSHAKE_MS,
      send('thread/start', {
        model: MODEL,
        modelProvider: 'capture',
        cwd,
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
        sandbox: 'danger-full-access',
        ephemeral: true,
      }),
    )) as { thread?: { id?: string } }
    threadId = started.thread?.id ?? null
    if (threadId === null) throw new Error('thread/start returned no thread id')
    const turnStarted = (await bounded(
      `${arm} turn/start`,
      HANDSHAKE_MS,
      send('turn/start', {
        threadId,
        input: [{ type: 'text', text: `Work marker ${MARKER}.`, text_elements: [] }],
        cwd,
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
        sandboxPolicy: { type: 'dangerFullAccess' },
        model: MODEL,
        effort: 'low',
      }),
    )) as { turn?: { id?: string } }
    turnId = turnStarted.turn?.id ?? null
    if (turnId === null) throw new Error('turn/start returned no turn id')
    await until(`${arm} active provider request`, () => {
      const response = heldResponse
      return (
        response !== null &&
        !response.writableEnded &&
        frames.some((frame) => frame.method === 'turn/started' && turnOf(frame)?.id === turnId)
      )
    })
    load(`${arm} active before decision`, loads)
    expect(endpointSawMarker, `${arm} model endpoint must receive the in-flight marker`).toBe(true)
    expect(
      frames.filter((frame) => frame.method === 'turn/completed'),
      `${arm} must have no boundary yet`,
    ).toEqual([])

    if (arm === 'interrupt') {
      interruptCalledAt = Date.now()
      const pending = bounded(
        'turn/interrupt RPC settlement',
        STEP_MS,
        send('turn/interrupt', { threadId, turnId }),
      )
      pending.catch(() => {}) // the terminal wait may fail first; final teardown still owns this request
      load('interrupt RPC sent before boundary', loads)
      const request = outbound.find((row) => row.method === 'turn/interrupt')
      expect(request?.at).toBeGreaterThanOrEqual(interruptCalledAt)
      expect(ordinaryResponseCompletedAt).toBeNull()
      expect(
        frames.filter((frame) => frame.method === 'turn/completed' && frame.at < request!.at),
      ).toEqual([])
      await until('raw matching interrupted terminal', () =>
        frames.some(
          (frame) =>
            frame.method === 'turn/completed' &&
            turnOf(frame)?.id === turnId &&
            turnOf(frame)?.status === 'interrupted',
        ),
      )
      // 443 finding: a raw app-server terminal does not reliably predict when the loopback HTTP
      // stream closes. It stayed open for 45 seconds in one run and closed within this sampling
      // window in another. Sample before our own teardown, but never make either value the oracle
      // for the protocol's turn terminal or for a real model receiving cancellation.
      await new Promise((resolve) => setTimeout(resolve, SAMPLE_MS))
      endpointClosedBeforeCleanup = endpointClosedAt !== null
      await pending
      load('raw interrupted terminal and endpoint-close sample', loads)
    } else {
      const response = heldResponse as ServerResponse | null
      if (response === null) throw new Error('control has no held response')
      ordinaryResponseCompletedAt = Date.now()
      completeResponse(response, 1)
      load('control released ordinary response', loads)
      await until('raw matching completed terminal', () =>
        frames.some(
          (frame) =>
            frame.method === 'turn/completed' &&
            turnOf(frame)?.id === turnId &&
            turnOf(frame)?.status === 'completed',
        ),
      )
      endpointClosedBeforeCleanup = endpointClosedAt !== null
      load('raw completed terminal', loads)
    }
  } catch (cause) {
    error = errorText(cause)
  } finally {
    try {
      await closeOwnedArm()
    } finally {
      release()
    }
  }

  const evidence: ArmEvidence = {
    arm,
    threadId,
    turnId,
    endpointSawMarker,
    endpointStartedAt,
    endpointClosedAt,
    endpointClosedBeforeCleanup,
    ordinaryResponseCompletedAt,
    interruptCalledAt,
    loads: [...loads],
    outbound: [...outbound],
    frames: [...frames],
    error,
    listenedOn,
    configuredPort,
    root,
  }
  writeFileSync(runEvidence(`443-codex-${arm}.json`), JSON.stringify(evidence, null, 2))
  return evidence
}

async function measureBothArms(): Promise<void> {
  const started = Date.now()
  // ⚑ Spread from `ARMS`, so an arm the budget does not count cannot be run.
  const [interrupted, control] = [await runArm(ARMS[0]), await runArm(ARMS[1])]
  const report = {
    elapsedMs: Date.now() - started,
    interrupt: {
      load: interrupted.loads,
      error: interrupted.error,
      turnId: interrupted.turnId,
      outboundInterrupt: interrupted.outbound.find((row) => row.method === 'turn/interrupt'),
      terminal: interrupted.frames.find((frame) => frame.method === 'turn/completed'),
      ordinaryResponseCompletedAt: interrupted.ordinaryResponseCompletedAt,
      endpointClosedBeforeCleanup: interrupted.endpointClosedBeforeCleanup,
    },
    control: {
      load: control.loads,
      error: control.error,
      terminal: control.frames.find((frame) => frame.method === 'turn/completed'),
      ordinaryResponseCompletedAt: control.ordinaryResponseCompletedAt,
      endpointClosedBeforeCleanup: control.endpointClosedBeforeCleanup,
    },
  }
  console.log(`443 Codex construction: ${JSON.stringify(report, null, 2)}`)
  expect(interrupted.error, 'interrupt arm must finish every bounded step').toBeNull()
  expect(control.error, 'normal completion control must finish every bounded step').toBeNull()
  const interrupt = interrupted.outbound.find((row) => row.method === 'turn/interrupt')
  const interruptedTerminal = interrupted.frames.find((frame) => frame.method === 'turn/completed')
  const controlTerminal = control.frames.find((frame) => frame.method === 'turn/completed')
  expect(interrupt?.params).toMatchObject({
    threadId: interrupted.threadId,
    turnId: interrupted.turnId,
  })
  expect(
    interrupted.endpointStartedAt,
    'the provider request existed before interrupt',
  ).not.toBeNull()
  expect(
    interrupt?.at,
    'the RPC was written while the provider request was live',
  ).toBeGreaterThanOrEqual(interrupted.endpointStartedAt ?? Number.POSITIVE_INFINITY)
  expect(
    interruptedTerminal?.at,
    'provider terminal follows the interrupt RPC',
  ).toBeGreaterThanOrEqual(interrupt?.at ?? Number.POSITIVE_INFINITY)
  expect(
    turnOf(interruptedTerminal!),
    'raw provider terminal, not a local interrupted bit',
  ).toMatchObject({
    id: interrupted.turnId,
    status: 'interrupted',
  })
  expect(
    control.outbound.some((row) => row.method === 'turn/interrupt'),
    'control sent no interrupt',
  ).toBe(false)
  expect(
    controlTerminal?.at,
    'ordinary completion precedes control terminal',
  ).toBeGreaterThanOrEqual(control.ordinaryResponseCompletedAt ?? Number.POSITIVE_INFINITY)
  expect(turnOf(controlTerminal!), 'normal-completion control').toMatchObject({
    id: control.turnId,
    status: 'completed',
  })
  expect(
    control.endpointClosedBeforeCleanup,
    'endpoint close monitor fires when normal control ends its stream',
  ).toBe(true)
  expect(
    interrupted.ordinaryResponseCompletedAt,
    'the held model stream was never ordinarily completed',
  ).toBeNull()
  expect(
    control.ordinaryResponseCompletedAt,
    'the normal control was explicitly completed',
  ).not.toBeNull()
  // ⚑ Rule 40: each arm's child was configured with the port THIS process was given.
  for (const one of [interrupted, control]) {
    expect(one.listenedOn, `${one.arm} · the loopback port`).not.toBeNull()
    expect(one.configuredPort, `${one.arm} · the port in the child's config`).toBe(one.listenedOn)
  }

  // ⚠️ Only a run that got this far deletes its roots; a failing one leaves them (`649` F6).
  for (const one of [interrupted, control]) rmSync(one.root, { recursive: true, force: true })
}

it(
  '443 · bundled Codex receives an interrupt before the provider turn boundary (construction only)',
  () => deadline.within('measuring the interrupt arm and its control', measureBothArms),
  deadline.testTimeoutMs,
)
