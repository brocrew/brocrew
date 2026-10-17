import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { expect, it } from 'vitest'
// 🔒 **A deep import, and deliberately** — the same one `codex-memory-config.smoke.ts` takes, for
// the same reason: this probe owns its spawn so it can put the loopback provider's `env_key` in the
// child environment, which `createSpawnTransportFactory` sanitizes away.
import { SpawnCodexTransport } from '../src/codex/codex-transport'
import { bundledCodexBinary } from './bundled-codex'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

/**
 * 🔴 **348 · does a Codex child SEE tools declared on `thread/start`, and does a resume keep them?**
 *
 * ## ⛔ The question this settles, and why the brief could not answer it
 *
 * `348`'s brief says Codex needs *"a real stdio child"* and a `config.toml` merge that can carry
 * `[mcp_servers]`, because that is how `307` measured Codex acquiring MCP servers. The vendored
 * protocol carries a second door the brief did not know about: `ThreadStartParams.dynamicTools`,
 * with `item/tool/call` coming back as a `ServerRequest`. ⚑ **That is the in-protocol mirror of the
 * in-process MCP server `347` found on the Claude side** — no subprocess, no socket, no port, and
 * nothing written into a file Codex co-owns.
 *
 * ⚠️ **Presence in a generated type is a SCHEMA verdict** (`044`'s rule, still the house rule). Two
 * things had to be measured before anything was built on it, and both are measured HERE.
 *
 * ## ⚑ It costs no tokens and needs no credential — `314`'s instrument, one field over
 *
 * The home targets an owned loopback Responses endpoint. Real `codex app-server` builds its
 * model-bound request, which is captured exactly before a `400` response. This measures the
 * tool inventory where availability is decided without a paid model turn. Place no credential
 * in the home and leave personal `provider-homes/`, `~/.codex`, and `:9444` untouched.
 *
 * ## 🔴 Four arms, because a capture that finds a name is not yet a measurement
 *
 * | arm | `dynamicTools` sent | expected |
 * |---|---|---|
 * | **A · namespace** | one `namespace` spec holding the five | the five names in the child's inventory |
 * | **B · flat** | five bare `function` specs | the five names in the child's inventory |
 * | **C · control** | none | the five names ABSENT |
 * | **D · resume** | sent on `thread/start` only, then a SECOND app-server resumes the thread and sends none | the five names still there |
 *
 * ⚠️ **C is the half that makes A and B mean anything.** `thread/start` accepts unknown params
 * silently — measured: `{brobotNotAField: "nonsense"}` is accepted where `{dynamicTools:
 * "nonsense"}` is `-32600` — so "the call succeeded" is not evidence that anything was read. Only a
 * name that is present in one arm and absent in the control is.
 *
 * ⛔ **D is the one the design turns on.** `ThreadResumeParams` has no `dynamicTools` field at all,
 * so if the server did not persist them there would be no way to re-supply them and every resumed
 * Codex agent would silently lose its tools — `307`'s asymmetry, arriving from the other side.
 *
 * ## ⛔ 669 · one outer deadline, derived from the waits below
 *
 * ⚠️ **Until `669` this file had no bound but vitest's own per-test default** (`655` §4), and three of
 * its protocol waits — `initialize`, `thread/start`, `thread/resume` — had none at all (standing rule
 * 13). ⚑ Each is bounded now, and the run sits inside `smoke/probe-run-deadline.ts` in the template's
 * shape: the budget is {@link ARM_OPTIONS}' own waits, every arm refuses to start past the deadline
 * and again once its port is bound, and owns its teardown before anything exists.
 *
 * Run: `pnpm run probe:codex-dynamic-tools`. Not part of `pnpm run ci`.
 */

/** ⚠️ Standing rule 13: a stalled request is NOT PERFORMED, never waited on. */
const RPC_DEADLINE_MS = 30_000
/** How long a turn is given to reach the endpoint — the wait `turn()` has always made. */
const TURN_WAIT_MS = 60_000
/**
 * The transport's own close: `close()` ends stdin, waits `EXIT_GRACE_MS`, then SIGTERM and SIGKILL
 * each wait `KILL_GRACE_MS`.
 */
const EXIT_GRACE_MS = 2_000
const KILL_GRACE_MS = 2_000
const TEARDOWN_MS = EXIT_GRACE_MS + 2 * KILL_GRACE_MS

interface ArmOptions {
  readonly thenResume?: boolean
}

/** One arm's worst case: a handshake, a thread, a turn and a close — twice when it resumes. */
function serialWaitsMs(opts: ArmOptions): number[] {
  const oneAppServer = [RPC_DEADLINE_MS, RPC_DEADLINE_MS, TURN_WAIT_MS, TEARDOWN_MS]
  return opts.thenResume === true ? [...oneAppServer, ...oneAppServer] : oneAppServer
}

/** ⛔ **The four arms, as one table the budget is counted from** — see this file's docblock. */
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

/** Bounded, standing rule 13 — a request that never answers is NOT PERFORMED, never waited on. */
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

/** ⚑ Rule 40: the port the child was CONFIGURED with, read back from the file it reads. */
function configuredPortOf(config: string): number | null {
  const match = /^base_url = "http:\/\/127\.0\.0\.1:(\d+)\/v1"$/m.exec(config)
  return match === null ? null : Number(match[1])
}

/** The five, spelled here rather than imported: this probe is the oracle, not the app. */
const TOOL_NAMES = [
  'list_agents',
  'get_agent_status',
  'spawn_agent',
  'message_agent',
  'end_agent',
] as const

const NAMESPACE = 'brobot'

function functionSpecs(): unknown[] {
  return TOOL_NAMES.map((name) => ({
    type: 'function',
    name,
    description: `348 probe · ${name}`,
    inputSchema: { type: 'object', properties: { note: { type: 'string' } } },
  }))
}

/** The loopback model provider — one stanza, so the arms differ only in what is sent on the wire. */
function providerStanza(port: number): string {
  return [
    'model = "gpt-5.6-luna"',
    'model_provider = "capture"',
    '',
    '[model_providers.capture]',
    'name = "BroBot 348 capture"',
    `base_url = "http://127.0.0.1:${port}/v1"`,
    'env_key = "BROBOT_348_CAPTURE_KEY"',
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

interface Arm {
  readonly label: string
  /** Every capture the endpoint saw, in order. */
  readonly bodies: unknown[]
  readonly failure: string | null
  readonly threadId: string | null
  readonly listenedOn: number | null
  readonly configuredPort: number | null
  /** ⚠️ Kept until every expectation passes — a failing run leaves its own (`649` F6). */
  readonly root: string
}

/**
 * Where in a captured Responses body a tool name can be found.
 *
 * ⚠️ **Both surfaces are searched, and the reason is `312`'s finding**: Codex publishes its own
 * memory tools inside the code-mode `exec` tool's model-visible DESCRIPTION rather than as
 * top-level tools, so a probe that searched only the tool array would have measured their absence
 * and been wrong. A dynamic tool could land on either, so this reports which.
 *
 * ⚠️ **Every level is searched, not one.** Bundled 0.160.0 sends no top-level `tools` at all: they
 * arrive in an `additional_tools` input item, as a `functions` namespace whose `exec` description
 * declares ours as `brobot__list_agents(…)`. A one-level search found nothing there.
 *
 * ⛔ **A tool is matched by this probe's own description, never by its bare name.** 0.160.0 ships
 * multi-agent tools of its own named `spawn_agent` and `list_agents` (feature-gated; not in this
 * probe's control capture), so a name alone could one day find Codex's tools and call them ours.
 */
function whereNamesLand(body: unknown, name: string): string[] {
  const marker = `348 probe · ${name}`
  const found: string[] = []
  const walk = (tools: unknown, where: string): void => {
    if (!Array.isArray(tools)) return
    for (const tool of tools) {
      const named = tool as { name?: string; description?: string; tools?: unknown[] }
      if ((named.description ?? '') === marker) found.push(`${where}[]`)
      else if ((named.description ?? '').includes(marker))
        found.push(`${where}[${named.name}].description`)
      walk(named.tools, `${where}[${named.name}]`)
    }
  }
  walk((body as { tools?: unknown[] } | undefined)?.tools, 'tools')
  const input = (body as { input?: unknown[] } | undefined)?.input
  if (Array.isArray(input)) {
    for (const item of input) {
      const entry = item as { type?: string; tools?: unknown[] }
      walk(entry.tools, entry.type ?? 'input')
    }
  }
  return [...new Set(found)]
}

const namesIn = (body: unknown): string[] =>
  TOOL_NAMES.filter((name) => whereNamesLand(body, name).length > 0)

/**
 * Run one arm: a fresh home, a loopback endpoint, one thread, one turn — and optionally a SECOND
 * app-server that resumes the same thread and sends no `dynamicTools` at all.
 */
async function capture(
  label: keyof typeof ARM_OPTIONS,
  dynamicTools: unknown[] | null,
  opts: ArmOptions,
): Promise<Arm> {
  deadline.refuse(`starting arm ${label}`)
  const scratch = runScratch('codex-dynamic-tools')
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
      response.end(JSON.stringify({ error: { message: 'BROBOT_348_CAPTURED' } }))
    })
  })

  let failure: string | null = null
  let threadId: string | null = null
  let listenedOn: number | null = null
  let configuredPort: number | null = null
  let config = ''
  let transport: SpawnCodexTransport | null = null
  let pump: Promise<void> | null = null

  /**
   * ⛔ **Owned BEFORE anything exists, and closes whatever is open EACH time it is called** — the
   * cancel probe's reason (`649` F6). ⚠️ An arm that resumes opens a SECOND app-server after the
   * first is closed, so this reads the CURRENT one each time rather than the one it was given.
   */
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
        BROBOT_348_CAPTURE_KEY: 'probe-only',
      },
      exitGraceMs: EXIT_GRACE_MS,
      killGraceMs: KILL_GRACE_MS,
    })

  /** Answer every server→client request rather than going quiet; the child waits on us otherwise. */
  const pumpOf = (owned: SpawnCodexTransport): Promise<void> =>
    (async () => {
      for await (const incoming of owned.incoming()) {
        if (incoming.kind === 'request') {
          owned.respondError(
            incoming.id,
            -32601,
            `the 348 probe does not implement ${incoming.method}`,
          )
        }
      }
    })()

  const handshake = async (owned: SpawnCodexTransport): Promise<void> => {
    await bounded(
      'initialize',
      owned.request('initialize', {
        clientInfo: {
          name: 'brobot-348-probe',
          title: 'BroBot 348 dynamic-tools probe',
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
      input: [{ type: 'text', text: `348 inventory ${label}`, text_elements: [] }],
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
          ...(dynamicTools === null ? {} : { dynamicTools }),
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
      // ⚑ A second app-server is a second capture STARTING, so it refuses past the deadline too.
      deadline.refuse(`arm ${label} · the resume`)
      const second = openTransport()
      transport = second
      pump = pumpOf(second)
      try {
        await handshake(second)
        // ⛔ **No `dynamicTools` here, and there is no field to put them in.** This is the whole arm.
        await bounded('thread/resume', second.request('thread/resume', { threadId, cwd }))
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

  const arm: Arm = {
    label,
    bodies: [...bodies],
    failure,
    threadId,
    listenedOn,
    configuredPort,
    root,
  }
  writeFileSync(runEvidence(`348-${label}.json`), JSON.stringify({ config, ...arm }, null, 1))
  return arm
}

async function measureFourArms(): Promise<void> {
  const namespaced = await capture(
    'A-namespace',
    [
      {
        type: 'namespace',
        name: NAMESPACE,
        description: 'Tools that reach the app this agent is running inside.',
        tools: functionSpecs(),
      },
    ],
    ARM_OPTIONS['A-namespace'],
  )
  const flat = await capture('B-flat', functionSpecs(), ARM_OPTIONS['B-flat'])
  const control = await capture('C-control', null, ARM_OPTIONS['C-control'])
  const resumed = await capture('D-resume', functionSpecs(), ARM_OPTIONS['D-resume'])
  const report = {
    A_namespace: {
      names: namesIn(namespaced.bodies[0]),
      where: whereNamesLand(namespaced.bodies[0], TOOL_NAMES[0]),
      captures: namespaced.bodies.length,
      failure: namespaced.failure,
    },
    B_flat: {
      names: namesIn(flat.bodies[0]),
      where: whereNamesLand(flat.bodies[0], TOOL_NAMES[0]),
      captures: flat.bodies.length,
      failure: flat.failure,
    },
    C_control: {
      names: namesIn(control.bodies[0]),
      captures: control.bodies.length,
      failure: control.failure,
    },
    D_resume: {
      first: namesIn(resumed.bodies[0]),
      afterResume: namesIn(resumed.bodies[1]),
      captures: resumed.bodies.length,
      failure: resumed.failure,
    },
  }
  console.log(`348 dynamic tools · ${JSON.stringify(report, null, 1)}`)

  // ⛔ **C first, because it is what makes the others measurements.** `thread/start` accepts unknown
  // params silently, so a name found in A or B means nothing until the arm that sent none finds none.
  expect(control.bodies.length, 'the control never reached the endpoint').toBeGreaterThan(0)
  expect(namesIn(control.bodies[0]), 'C · no dynamicTools sent, so no name may appear').toEqual([])

  // A and B · both declaration shapes reach the model, which is why the namespace is a CHOICE.
  expect(namesIn(namespaced.bodies[0]), 'A · namespace').toEqual([...TOOL_NAMES])
  expect(namesIn(flat.bodies[0]), 'B · flat').toEqual([...TOOL_NAMES])
  // ⚑ …and the namespace form is the one that keeps the server's name on every tool. A flat spec is
  // dropped into the same list as Codex's own built-ins with no prefix at all, so a future provider
  // tool called `end_agent` would collide in silence.
  const namespacedDeclaration = JSON.stringify(namespaced.bodies[0])
  expect(namespacedDeclaration).toContain(`${NAMESPACE}__${TOOL_NAMES[2]}`)
  expect(JSON.stringify(flat.bodies[0])).not.toContain(`${NAMESPACE}__${TOOL_NAMES[2]}`)

  // 🔴 D · the finding the whole design turns on. A SECOND app-server process resumed the thread
  // and sent no `dynamicTools` — there is no field to send them in — and the inventory came back.
  expect(resumed.failure, 'D · the resume arm failed').toBeNull()
  expect(resumed.bodies.length, 'D · the resumed turn never reached the endpoint').toBe(2)
  expect(namesIn(resumed.bodies[0]), 'D · before the resume').toEqual([...TOOL_NAMES])
  expect(namesIn(resumed.bodies[1]), 'D · after a cold resume by another process').toEqual([
    ...TOOL_NAMES,
  ])

  // ⚑ Rule 40: every arm's child was configured with the port THIS process was given.
  for (const arm of [namespaced, flat, control, resumed]) {
    expect(arm.listenedOn, `${arm.label} · the loopback port`).not.toBeNull()
    expect(arm.configuredPort, `${arm.label} · the port in the child's config`).toBe(arm.listenedOn)
  }

  // ⚠️ Only a run that got this far deletes its roots; a failing one leaves them (`649` F6).
  for (const arm of [namespaced, flat, control, resumed]) {
    rmSync(arm.root, { recursive: true, force: true })
  }
}

it(
  '348 · a Codex child sees tools declared on thread/start, and a resume keeps them',
  () => deadline.within('measuring arms A–D', measureFourArms),
  deadline.testTimeoutMs,
)
