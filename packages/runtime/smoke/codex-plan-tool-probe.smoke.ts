import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { CODEX_PLAN_TOOL_CONFIG } from '../src/codex/codex-runtime'
// 🔒 **A deep import, and deliberately** — `codex-dynamic-tools-probe.smoke.ts`'s reason: this probe
// owns its spawn so it can put the loopback provider's `env_key` in the child environment, which
// `createSpawnTransportFactory` sanitizes away.
import { SpawnCodexTransport } from '../src/codex/codex-transport'
import { bundledCodexBinary } from './bundled-codex'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

/**
 * 🔴 **Does the planning tool reach a Codex agent BroBot opens?** (provider follow-ups 1, on the
 * 0.160.0 bump.)
 *
 * ## The question
 *
 * Codex 0.152.0 turned its planning tool off by default — *"enable it with
 * `tools.update_plan.enabled = true`"* — so an agent stopped calling `update_plan`, and the
 * conversation's checklist (`turn/plan/updated`) went quiet. W4 ruled that BroBot turns it back on
 * for its Codex agents, through the per-thread config overlay it already sends
 * ({@link CODEX_PLAN_TOOL_CONFIG}, on `thread/start` and `thread/resume`). This measures that the
 * overlay is what puts the tool in front of the model.
 *
 * ## The instrument — `348`'s, one field over
 *
 * Use bundled `codex app-server`, temporary `CODEX_HOME`, and an owned loopback endpoint
 * capturing the model-bound request before `400`. Set `env_key` to `probe-only`; use no
 * account, real token, or spend and read no personal state.
 *
 * | arm | `config` on `thread/start` | then | expected |
 * |---|---|---|---|
 * | **A · control** | none | — | `update_plan` ABSENT — 0.160.0's default |
 * | **B · overlay** | {@link CODEX_PLAN_TOOL_CONFIG} | — | `update_plan` present |
 * | **C · resume** | the overlay | a SECOND app-server resumes with the overlay, as the product does | present before and after |
 *
 * ⚠️ **A is the half that makes B and C mean anything** — `thread/start` accepts unknown config
 * silently, so only a tool present in B and absent in A is a measurement.
 *
 * Run: `pnpm run probe:codex-plan-tool`. Not part of `pnpm run ci`.
 */

/** ⚠️ Standing rule 13: a stalled request is NOT PERFORMED, never waited on. */
const RPC_DEADLINE_MS = 30_000
const TURN_WAIT_MS = 60_000
const EXIT_GRACE_MS = 2_000
const KILL_GRACE_MS = 2_000
const TEARDOWN_MS = EXIT_GRACE_MS + 2 * KILL_GRACE_MS

interface ArmOptions {
  readonly overlay: boolean
  readonly thenResume?: boolean
}

function serialWaitsMs(opts: ArmOptions): number[] {
  const oneAppServer = [RPC_DEADLINE_MS, RPC_DEADLINE_MS, TURN_WAIT_MS, TEARDOWN_MS]
  return opts.thenResume === true ? [...oneAppServer, ...oneAppServer] : oneAppServer
}

const ARM_OPTIONS = {
  'A-control': { overlay: false },
  'B-overlay': { overlay: true },
  'C-resume': { overlay: true, thenResume: true },
} as const satisfies Record<string, ArmOptions>

const deadline = probeRunDeadline(
  'codex plan-tool probe',
  runBudgetMs(Object.values(ARM_OPTIONS).flatMap((opts) => serialWaitsMs(opts))),
  TEARDOWN_MS,
)

async function bounded<T>(what: string, work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`NOT PERFORMED — ${what} did not answer in ${RPC_DEADLINE_MS}ms`)),
          RPC_DEADLINE_MS,
        )
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function configuredPortOf(config: string): number | null {
  const match = /^base_url = "http:\/\/127\.0\.0\.1:(\d+)\/v1"$/m.exec(config)
  return match === null ? null : Number(match[1])
}

function providerStanza(port: number): string {
  return [
    'model = "gpt-5.6-luna"',
    'model_provider = "capture"',
    '',
    '[model_providers.capture]',
    'name = "BroBot plan-tool capture"',
    `base_url = "http://127.0.0.1:${port}/v1"`,
    'env_key = "BROBOT_PLAN_TOOL_CAPTURE_KEY"',
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

/**
 * Whether a captured request offers the model `update_plan` — as a tool of that name at ANY level
 * of `tools` (top-level, or nested in an `additional_tools` item's namespaces, where 0.160.0 puts
 * them), or as a `### \`update_plan\`` entry in a tool's description (code mode's `exec` catalogue).
 */
function offersUpdatePlan(body: unknown): boolean {
  let found = false
  const walk = (tools: unknown): void => {
    if (!Array.isArray(tools)) return
    for (const tool of tools) {
      const named = tool as { name?: string; description?: string; tools?: unknown[] }
      if (named.name === 'update_plan') found = true
      if ((named.description ?? '').includes('### `update_plan`')) found = true
      walk(named.tools)
    }
  }
  walk((body as { tools?: unknown[] } | undefined)?.tools)
  const input = (body as { input?: unknown[] } | undefined)?.input
  if (Array.isArray(input)) for (const item of input) walk((item as { tools?: unknown[] }).tools)
  return found
}

interface Arm {
  readonly label: string
  readonly bodies: unknown[]
  readonly failure: string | null
  readonly listenedOn: number | null
  readonly configuredPort: number | null
  readonly root: string
}

async function capture(label: keyof typeof ARM_OPTIONS, opts: ArmOptions): Promise<Arm> {
  deadline.refuse(`starting arm ${label}`)
  const scratch = runScratch('codex-plan-tool')
  mkdirSync(scratch, { recursive: true })
  const root = mkdtempSync(join(scratch, `${label}-`))
  const home = join(root, 'home')
  const cwd = join(root, 'cwd')
  mkdirSync(home, { recursive: true })
  mkdirSync(cwd, { recursive: true })

  const bodies: unknown[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      try {
        bodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        bodies.push(Buffer.concat(chunks).toString('utf8'))
      }
      response.statusCode = 400
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ error: { message: 'BROBOT_PLAN_TOOL_CAPTURED' } }))
    })
  })

  let failure: string | null = null
  let threadId: string | null = null
  let listenedOn: number | null = null
  let configuredPort: number | null = null
  let transport: SpawnCodexTransport | null = null
  let pump: Promise<void> | null = null
  const overlay = opts.overlay ? { config: CODEX_PLAN_TOOL_CONFIG } : {}

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

  const openTransport = (): SpawnCodexTransport =>
    new SpawnCodexTransport(bundledCodexBinary(), ['app-server'], {
      cwd,
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: root,
        CODEX_HOME: home,
        CODEX_SQLITE_HOME: home,
        BROBOT_PLAN_TOOL_CAPTURE_KEY: 'probe-only',
      },
      exitGraceMs: EXIT_GRACE_MS,
      killGraceMs: KILL_GRACE_MS,
    })

  const pumpOf = (owned: SpawnCodexTransport): Promise<void> =>
    (async () => {
      for await (const incoming of owned.incoming()) {
        if (incoming.kind === 'request') {
          owned.respondError(
            incoming.id,
            -32601,
            `the plan-tool probe does not implement ${incoming.method}`,
          )
        }
      }
    })()

  const handshake = async (owned: SpawnCodexTransport): Promise<void> => {
    await bounded(
      'initialize',
      owned.request('initialize', {
        clientInfo: {
          name: 'brobot-plan-tool-probe',
          title: 'BroBot plan-tool probe',
          version: '0.0.0',
        },
        capabilities: { experimentalApi: true, requestAttestation: false },
      }),
    )
    owned.notify('initialized', {})
  }

  const turn = async (owned: SpawnCodexTransport, id: string, seen: number): Promise<void> => {
    void owned.request('turn/start', {
      threadId: id,
      input: [{ type: 'text', text: `plan-tool inventory ${label}`, text_elements: [] }],
      cwd,
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandboxPolicy: { type: 'dangerFullAccess' },
      model: 'gpt-5.6-luna',
      effort: 'low',
    })
    const waitUntil = Date.now() + TURN_WAIT_MS
    while (bodies.length <= seen && Date.now() < waitUntil) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }

  let config = ''
  try {
    listenedOn = await listen(server)
    deadline.refuse(`starting arm ${label} · the loopback port is bound`)
    writeFileSync(join(home, 'config.toml'), providerStanza(listenedOn))
    config = readFileSync(join(home, 'config.toml'), 'utf8')
    configuredPort = configuredPortOf(config)

    const first = openTransport()
    transport = first
    pump = pumpOf(first)
    try {
      await handshake(first)
      const started = (await bounded(
        'thread/start',
        first.request('thread/start', {
          model: 'gpt-5.6-luna',
          modelProvider: 'capture',
          cwd,
          approvalPolicy: 'never',
          approvalsReviewer: 'user',
          sandbox: 'danger-full-access',
          ...overlay,
        }),
      )) as { thread?: { id?: string } }
      threadId = started.thread?.id ?? null
      await turn(first, threadId ?? '', 0)
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
    } finally {
      await first.close()
      await pump
    }

    if (opts.thenResume === true && threadId !== null && failure === null) {
      deadline.refuse(`arm ${label} · the resume`)
      const second = openTransport()
      transport = second
      pump = pumpOf(second)
      try {
        await handshake(second)
        // ⚑ The overlay is re-sent, exactly as `threadResumeParams` does.
        await bounded(
          'thread/resume',
          second.request('thread/resume', { threadId, cwd, ...overlay }),
        )
        await turn(second, threadId, bodies.length)
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error)
      } finally {
        await second.close()
        await pump
      }
    }
  } catch (error) {
    failure ??= error instanceof Error ? error.message : String(error)
  } finally {
    try {
      await closeOwnedCapture()
    } finally {
      release()
    }
  }

  const arm: Arm = { label, bodies: [...bodies], failure, listenedOn, configuredPort, root }
  writeFileSync(runEvidence(`plan-tool-${label}.json`), JSON.stringify({ config, ...arm }, null, 1))
  return arm
}

async function measure(): Promise<void> {
  const control = await capture('A-control', ARM_OPTIONS['A-control'])
  const overlaid = await capture('B-overlay', ARM_OPTIONS['B-overlay'])
  const resumed = await capture('C-resume', ARM_OPTIONS['C-resume'])
  const report = {
    A_control: {
      offered: offersUpdatePlan(control.bodies[0]),
      captures: control.bodies.length,
      failure: control.failure,
    },
    B_overlay: {
      offered: offersUpdatePlan(overlaid.bodies[0]),
      captures: overlaid.bodies.length,
      failure: overlaid.failure,
    },
    C_resume: {
      first: offersUpdatePlan(resumed.bodies[0]),
      afterResume: offersUpdatePlan(resumed.bodies[1]),
      captures: resumed.bodies.length,
      failure: resumed.failure,
    },
  }
  console.log(`codex plan tool · ${JSON.stringify(report, null, 1)}`)

  // ⛔ The control first: what makes B and C measurements.
  for (const arm of [control, overlaid, resumed]) {
    expect(arm.failure, `${arm.label} · ran`).toBeNull()
    expect(arm.configuredPort, `${arm.label} · the port in the child's config`).toBe(arm.listenedOn)
  }
  expect(control.bodies.length, 'A · reached the endpoint').toBeGreaterThan(0)
  expect(offersUpdatePlan(control.bodies[0]), 'A · no overlay, so no planning tool (0.160.0)').toBe(
    false,
  )
  expect(overlaid.bodies.length, 'B · reached the endpoint').toBeGreaterThan(0)
  expect(offersUpdatePlan(overlaid.bodies[0]), 'B · the overlay puts the planning tool in').toBe(
    true,
  )
  expect(resumed.bodies.length, 'C · both turns reached the endpoint').toBe(2)
  expect(offersUpdatePlan(resumed.bodies[0]), 'C · before the resume').toBe(true)
  expect(offersUpdatePlan(resumed.bodies[1]), 'C · after a resume that re-sends the overlay').toBe(
    true,
  )

  for (const arm of [control, overlaid, resumed]) rmSync(arm.root, { recursive: true, force: true })
}

it(
  'provider follow-ups 1 · the planning tool reaches a Codex agent through the thread overlay',
  () => deadline.within('measuring arms A–C', measure),
  deadline.testTimeoutMs,
)
