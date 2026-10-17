import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { expect, it } from 'vitest'
// 🔒 **A deep import, deliberately.** The ordinary factory strips arbitrary environment
// variables; this probe owns its spawn so the run-owned loopback provider's `env_key` is the only
// extra value the child receives. No credential is copied into the home.
import { SpawnCodexTransport } from '../src/codex/codex-transport'
import { ensureCodexMemoryConfig } from '../src/index'
import { bundledCodexBinary } from './bundled-codex'
import { executionEvidence, offers, type Frame } from './exec-approval-evidence'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

/**
 * 🔴 **495 criterion 17 · the provider request that makes the fail-closed card reachable.**
 *
 * `483` found a real adapter branch that no executable instrument reconstructed: Codex offers an
 * accepting decision while an `additional_permissions.file_system.entries[0]` grant contains a
 * `special/unknown` path BroBot cannot truthfully display. `487` repaired what BroBot publishes for
 * that request, but the provider half remained represented only by a fake transport fixture.
 *
 * This probe makes the pinned `codex app-server` produce the request itself. A run-owned loopback
 * Responses endpoint deterministically emits the code-mode `custom_tool_call` named `exec`; its
 * JavaScript calls `tools.exec_command` with the canonical provider arguments below. The raw
 * server→client approval frame is captured before any BroBot normalizer sees it, and the test proves
 * that the provider:
 *
 *  1. accepted the non-default `exec_permission_approvals = true` feature after the shipped config
 *     merger edited the SAME `[features]` table;
 *  2. advertised the code-mode `exec` surface and its `exec_command` declaration, then accepted the
 *     canonical `entries[0]` special/unknown profile; and
 *  3. returned a non-empty decision list containing an accepting decision alongside that exact
 *     profile.
 *
 * Each invocation owns `CODEX_HOME`, `CODEX_SQLITE_HOME`, `HOME`, cwd, HTTP port, and
 * process. Read no existing Codex home, `auth.json`, personal `provider-homes/`, default
 * Electron userData, or `:9444`. The loopback endpoint acts as the model, requiring no
 * credential or paid tokens.
 *
 * 🔒 **The only decision it sends is `cancel`, and only if the provider OFFERED it** — checked on
 * the raw request before answering (`649` F7). ⚑ **And that `/usr/bin/true` did not run is now
 * ASSERTED**, off the provider's own record of the item after the turn's own terminal
 * (`exec-approval-evidence.ts`), rather than claimed.
 *
 * ⚠️ **One outer budget for the whole reconstruction** (standing rule 13), DERIVED from the waits
 * below by `042`'s rule so it comfortably exceeds their sum (`probe-run-deadline.ts`). ⛔ `495`
 * wrote it as three minutes; the waits this probe now makes sum to more than two and a half. If
 * it expires, teardown of the owned app-server and loopback server starts before the test is
 * rejected as NOT PERFORMED.
 *
 * Run: `pnpm run probe:codex-exec-permission`. Not part of `pnpm run ci`.
 */

const PROFILE_MARKER = ':brobot2-495-undisplayable'
const CAPTURE_KEY = 'BROBOT_495_EXEC_PERMISSION_CAPTURE_KEY'
const RPC_DEADLINE_MS = 30_000
const APPROVAL_DEADLINE_MS = 60_000
/** ⚑ After `cancel`, how long the turn has to reach its own terminal before "did not run" is judged. */
const SETTLE_MS = 15_000
/**
 * ⚠️ **And how long it keeps listening AFTER that terminal** (`655` review): on 0.146.0 an item's
 * `item/completed` has been measured arriving 3–10 ms after `turn/completed`, so the judgment waits
 * past the terminal rather than closing on it.
 */
const POST_TERMINAL_MS = 1_000
/** ⚑ The transport's own teardown bounds, passed explicitly so the budget can count them. */
const EXIT_GRACE_MS = 2_000
const KILL_GRACE_MS = 2_000
const TEARDOWN_MS = EXIT_GRACE_MS + 2 * KILL_GRACE_MS

/**
 * ⛔ **Every wait the capture can make in turn**: `initialize`, `thread/start`, `turn/start`, the
 * approval's arrival, the turn's terminal after `cancel`, and teardown.
 */
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

/** Exact model-facing arguments. Keep the snake_case: this is the `exec_command` tool contract. */
function commandArguments(cwd: string): Record<string, unknown> {
  return {
    cmd: '/usr/bin/true',
    workdir: cwd,
    sandbox_permissions: 'with_additional_permissions',
    additional_permissions: {
      file_system: {
        entries: [
          {
            path: {
              type: 'special',
              value: { kind: 'unknown', path: PROFILE_MARKER },
            },
            access: 'write',
          },
        ],
      },
    },
  }
}

/**
 * Pinned Codex 0.146.0 projects the custom exec call through its login-shell wrapper.
 *
 * ⚠️ **`/bin/zsh` is a fact about THIS Mac account, not about the pin** (`649` F4). The child's env
 * carries no `SHELL`, so the binary most likely reads the account's login shell; on an account whose
 * shell is bash this oracle fails. A known account assumption, recorded rather than engineered.
 */
const EXPECTED_PROVIDER_COMMAND = '/bin/zsh -lc /usr/bin/true'

/** Exact app-server wire projection of {@link commandArguments}' permission profile. */
const EXPECTED_RAW_PROFILE = {
  network: null,
  fileSystem: {
    read: null,
    write: null,
    entries: [
      {
        path: {
          type: 'special',
          value: { kind: 'unknown', path: PROFILE_MARKER, subpath: null },
        },
        access: 'write',
      },
    ],
  },
}

function providerConfig(port: number): string {
  return [
    'model = "gpt-5.6-luna"',
    'model_provider = "capture"',
    '',
    '[model_providers.capture]',
    'name = "BroBot 495 exec permission capture"',
    `base_url = "http://127.0.0.1:${port}/v1"`,
    `env_key = "${CAPTURE_KEY}"`,
    'request_max_retries = 0',
    'stream_max_retries = 0',
    '',
    '[features]',
    'exec_permission_approvals = true',
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

/**
 * The exact code-mode gesture. At this pin `exec_command` is a deferred function inside the
 * model-visible custom `exec` tool; it is not a top-level Responses `function_call`.
 */
function execSource(args: Record<string, unknown>): string {
  return [
    `const answer = await tools.exec_command(${JSON.stringify(args)})`,
    'text("BROBOT495:" + JSON.stringify(answer))',
  ].join('\n')
}

function streamCommand(response: ServerResponse, args: Record<string, unknown>): void {
  const send = (kind: string, payload: Record<string, unknown>): void => {
    response.write(`event: ${kind}\ndata: ${JSON.stringify({ type: kind, ...payload })}\n\n`)
  }
  response.statusCode = 200
  response.setHeader('content-type', 'text/event-stream')
  response.setHeader('cache-control', 'no-cache')
  response.setHeader('connection', 'keep-alive')
  send('response.created', { response: { id: 'resp_495_exec_permission' } })
  send('response.output_item.done', {
    output_index: 0,
    item: {
      type: 'custom_tool_call',
      id: 'ctc_495_exec_permission',
      call_id: 'call_495_exec_permission',
      name: 'exec',
      input: execSource(args),
      status: 'completed',
    },
  })
  send('response.completed', {
    response: { id: 'resp_495_exec_permission', usage: usage() },
  })
  response.end()
}

/** Defensive closing response if Codex asks the loopback model what to do after cancellation. */
function streamGoodbye(response: ServerResponse, index: number): void {
  const send = (kind: string, payload: Record<string, unknown>): void => {
    response.write(`event: ${kind}\ndata: ${JSON.stringify({ type: kind, ...payload })}\n\n`)
  }
  response.statusCode = 200
  response.setHeader('content-type', 'text/event-stream')
  response.setHeader('cache-control', 'no-cache')
  response.setHeader('connection', 'keep-alive')
  send('response.created', { response: { id: `resp_495_done_${index}` } })
  send('response.output_item.done', {
    output_index: 0,
    item: {
      type: 'message',
      id: `msg_495_done_${index}`,
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'cancelled', annotations: [] }],
    },
  })
  send('response.completed', {
    response: { id: `resp_495_done_${index}`, usage: usage() },
  })
  response.end()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The Responses API has used both direct function tools and `{ function: ... }` wrappers. ⚑ Bundled
 * 0.160.0 also nests them: `exec` arrives inside a `functions` namespace in an `additional_tools`
 * input item, so a namespace's own `tools` are searched too.
 */
function namedTool(body: unknown, name: string): Record<string, unknown> | undefined {
  if (!isRecord(body)) return undefined
  const pools: unknown[][] = []
  if (Array.isArray(body['tools'])) pools.push(body['tools'])
  if (Array.isArray(body['input'])) {
    for (const item of body['input']) {
      if (isRecord(item) && Array.isArray(item['tools'])) pools.push(item['tools'])
    }
  }
  for (let at = 0; at < pools.length; at += 1) {
    for (const raw of pools[at]!) {
      if (!isRecord(raw)) continue
      const candidate = isRecord(raw['function']) ? raw['function'] : raw
      if (candidate['name'] === name) return candidate
      if (Array.isArray(raw['tools'])) pools.push(raw['tools'])
    }
  }
  return undefined
}

interface RawRequest {
  readonly id: string | number
  readonly method: string
  readonly params: unknown
}

interface Captured {
  readonly config: string
  readonly merge: { readonly outcome: string; readonly why: string | null }
  readonly forcedArguments: Record<string, unknown>
  readonly modelBodies: readonly unknown[]
  readonly serverRequests: readonly RawRequest[]
  /** Every notification, with its params: the item lifecycle is what "did not run" is read from. */
  readonly notifications: readonly Frame[]
  /** The decision actually sent, or `null` if the provider did not offer `cancel`. */
  readonly answered: { readonly decision: 'cancel' } | null
  readonly turnStatus: string | null
  /** ⚑ Rule 40: the port the loopback server was given, and the one the child's config names. */
  readonly listenedOn: number | null
  readonly configuredPort: number | null
  readonly failure: string | null
  /** ⚠️ Kept until the expectations pass — a failing run leaves its evidence (`649` F6). */
  readonly root: string
}

async function bounded<T>(what: string, work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined
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

/** ⚑ Rule 40: the port the child was CONFIGURED with, read back after the shipped merger ran. */
function configuredPortOf(config: string): number | null {
  const match = /^base_url = "http:\/\/127\.0\.0\.1:(\d+)\/v1"$/m.exec(config)
  return match === null ? null : Number(match[1])
}

async function capture(): Promise<Captured> {
  deadline.refuse('starting the capture')
  const scratch = runScratch('codex-exec-permission-approval')
  mkdirSync(scratch, { recursive: true })
  const root = mkdtempSync(join(scratch, 'run-'))
  const home = join(root, 'home')
  const cwd = join(root, 'cwd')
  mkdirSync(home, { recursive: true })
  mkdirSync(cwd, { recursive: true })

  const forcedArguments = commandArguments(cwd)
  const modelBodies: unknown[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      try {
        modelBodies.push(JSON.parse(raw))
      } catch {
        modelBodies.push(raw)
      }
      if (modelBodies.length === 1) streamCommand(response, forcedArguments)
      else streamGoodbye(response, modelBodies.length)
    })
  })

  let transport: SpawnCodexTransport | null = null
  let pump: Promise<void> | null = null
  let config = ''
  let merge: Captured['merge'] = { outcome: 'not-run', why: null }
  let failure: string | null = null
  let answered: Captured['answered'] = null
  let turnStatus: string | null = null
  let listenedOn: number | null = null
  let configuredPort: number | null = null
  const serverRequests: RawRequest[] = []
  const notifications: Frame[] = []

  /**
   * ⛔ **Owned BEFORE anything exists, and closes whatever is open EACH time it is called** — the
   * cancel probe's reason (`649` F6): an expiry that lands while the port is binding finds nothing
   * to close, so the `finally` must be able to close what was made after it.
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

  try {
    listenedOn = await listen(server)
    deadline.refuse('starting the capture · the loopback port is bound')
    const configPath = join(home, 'config.toml')
    writeFileSync(configPath, providerConfig(listenedOn))

    // ⛔ The feature is present BEFORE the shipped writer runs. Its survival is the preservation
    // claim; the raw approval below is the provider-acceptance claim.
    const result = ensureCodexMemoryConfig(home)
    merge = {
      outcome: result.outcome,
      why: 'why' in result && typeof result.why === 'string' ? result.why : null,
    }
    config = readFileSync(configPath, 'utf8')
    configuredPort = configuredPortOf(config)

    transport = new SpawnCodexTransport(bundledCodexBinary(), ['app-server', '--strict-config'], {
      cwd,
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: root,
        CODEX_HOME: home,
        CODEX_SQLITE_HOME: home,
        [CAPTURE_KEY]: 'probe-only',
      },
      exitGraceMs: EXIT_GRACE_MS,
      killGraceMs: KILL_GRACE_MS,
    })

    const ownedTransport = transport
    pump = (async () => {
      for await (const incoming of ownedTransport.incoming()) {
        if (incoming.kind === 'notification') {
          notifications.push({ method: incoming.method, params: incoming.params })
          continue
        }
        serverRequests.push({
          id: incoming.id,
          method: incoming.method,
          params: incoming.params,
        })
        if (incoming.method !== 'item/commandExecution/requestApproval') {
          ownedTransport.respondError(
            incoming.id,
            -32601,
            `the 495 probe does not implement ${incoming.method}`,
          )
          continue
        }
        // 🔒 **Only a decision the provider OFFERED** (`649` F7). `cancel` is one of its own raw
        // decisions on this shape — the independent safe negative. If it is not offered, NOTHING is
        // sent: the arm is NOT PERFORMED, and teardown ends the child before anything can run.
        if (!offers(incoming.params, 'cancel')) {
          failure = 'NOT PERFORMED — the provider did not offer cancel, so no decision was sent'
          continue
        }
        answered = { decision: 'cancel' }
        ownedTransport.respond(incoming.id, answered)
      }
    })()

    await bounded(
      'initialize',
      ownedTransport.request('initialize', {
        clientInfo: {
          name: 'brobot-495-probe',
          title: 'BroBot 495 exec permission approval probe',
          version: '0.0.0',
        },
        capabilities: { experimentalApi: true, requestAttestation: false },
      }),
    )
    ownedTransport.notify('initialized', {})
    const started = (await bounded(
      'thread/start',
      ownedTransport.request('thread/start', {
        model: 'gpt-5.6-luna',
        modelProvider: 'capture',
        cwd,
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
        sandbox: 'read-only',
        ephemeral: true,
      }),
    )) as { thread?: { id?: string } }
    const threadId = started.thread?.id
    if (typeof threadId !== 'string' || threadId.length === 0) {
      throw new Error('thread/start returned no thread id')
    }

    await bounded(
      'turn/start',
      ownedTransport.request('turn/start', {
        threadId,
        input: [
          {
            type: 'text',
            text: '495 deterministic exec permission approval probe',
            text_elements: [],
          },
        ],
        cwd,
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
        sandboxPolicy: { type: 'readOnly', networkAccess: false },
        model: 'gpt-5.6-luna',
        effort: 'low',
      }),
    )

    const waitFor = async (what: () => boolean, ms: number): Promise<boolean> => {
      const until = Date.now() + ms
      while (!what() && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 25))
      return what()
    }
    const approvalArrived = (): boolean =>
      serverRequests.some((one) => one.method === 'item/commandExecution/requestApproval')
    if (!(await waitFor(approvalArrived, APPROVAL_DEADLINE_MS))) {
      throw new Error(
        `NOT PERFORMED — no command approval arrived in ${APPROVAL_DEADLINE_MS}ms; ` +
          `requests=${serverRequests.map((one) => one.method).join(',') || '(none)'}`,
      )
    }

    // ⚑ **The turn's own terminal, before anything is judged** — without it, "did not run" is NOT
    // PERFORMED rather than claimed. ⚠️ Then a short listen past it, for item reports that trail.
    const terminal = (): Frame | undefined =>
      notifications.find((one) => one.method === 'turn/completed')
    if (!(await waitFor(() => terminal() !== undefined, SETTLE_MS))) {
      failure ??= `NOT PERFORMED — the turn reached no terminal within ${SETTLE_MS}ms of the answer`
    }
    await new Promise((resolve) => setTimeout(resolve, POST_TERMINAL_MS))
    const turn = (terminal()?.params as { turn?: { status?: unknown } } | undefined)?.turn
    turnStatus = typeof turn?.status === 'string' ? turn.status : null
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  } finally {
    try {
      await closeOwnedCapture()
    } finally {
      release()
    }
  }

  return {
    config:
      config ||
      (existsSync(join(home, 'config.toml'))
        ? readFileSync(join(home, 'config.toml'), 'utf8')
        : ''),
    merge,
    forcedArguments,
    modelBodies: [...modelBodies],
    serverRequests: [...serverRequests],
    notifications: [...notifications],
    answered,
    turnStatus,
    listenedOn,
    configuredPort,
    failure,
    root,
  }
}

async function measureProviderApproval(): Promise<void> {
  const captured = await capture()
  const approvalRequests = captured.serverRequests.filter(
    (one) => one.method === 'item/commandExecution/requestApproval',
  )
  const approval = approvalRequests[0]
  const params = isRecord(approval?.params) ? approval.params : {}
  const decisions = Array.isArray(params['availableDecisions']) ? params['availableDecisions'] : []

  const evidence = executionEvidence(captured.notifications)
  const execTool = namedTool(captured.modelBodies[0], 'exec')
  const execDescription =
    typeof execTool?.['description'] === 'string' ? execTool['description'] : ''

  const report = {
    failure: captured.failure,
    merge: captured.merge,
    config: captured.config,
    forcedArguments: captured.forcedArguments,
    syntheticModelCall: {
      type: 'custom_tool_call',
      name: 'exec',
      input: execSource(captured.forcedArguments),
    },
    modelRequestCount: captured.modelBodies.length,
    advertised: {
      customExec: execTool !== undefined && execTool['type'] === 'custom',
      execCommand: execDescription.includes('exec_command'),
      withAdditionalPermissions: execDescription.includes('with_additional_permissions'),
      additionalPermissions: execDescription.includes('additional_permissions'),
    },
    rawApproval: approval ?? null,
    answered: captured.answered,
    turnStatus: captured.turnStatus,
    execution: evidence,
    listenedOn: captured.listenedOn,
    configuredPort: captured.configuredPort,
    root: captured.root,
    allServerRequestMethods: captured.serverRequests.map((one) => one.method),
    notificationMethods: captured.notifications.map((one) => one.method),
  }
  writeFileSync(
    runEvidence('codex-exec-permission-approval.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  console.log(`495 CODEX EXEC PERMISSION APPROVAL — ${JSON.stringify(report)}`)

  // Instrument health first. A silent child must never look like evidence that the branch is gone.
  expect(captured.failure).toBeNull()
  expect(captured.merge.outcome).toBe('written')
  expect(captured.config.match(/^\[features\]\s*$/gm) ?? []).toHaveLength(1)
  expect(captured.config).toMatch(/^exec_permission_approvals\s*=\s*true\s*$/m)
  expect(captured.modelBodies).not.toHaveLength(0)
  // ⚑ Rule 40: the child was configured with the port this process was GIVEN — read back after
  // the shipped merger rewrote the file — and the requests above prove it used it.
  expect(captured.listenedOn).not.toBeNull()
  expect(captured.configuredPort).toBe(captured.listenedOn)
  expect(execTool, 'the model request did not advertise the code-mode exec tool').toBeDefined()
  expect(execTool?.['type']).toBe('custom')
  expect(execDescription).toContain('exec_command')
  expect(execDescription).toContain('with_additional_permissions')
  expect(execDescription).toContain('additional_permissions')

  // The provider oracle: one raw approval, an accepting choice, and the exact undisplayable grant.
  expect(approvalRequests).toHaveLength(1)
  expect(params['command']).toBe(EXPECTED_PROVIDER_COMMAND)
  expect(params['cwd']).toBe((captured.forcedArguments['workdir'] as string | undefined) ?? '')
  expect(decisions.length).toBeGreaterThan(0)
  expect(decisions).toContain('accept')
  expect(decisions).toContain('cancel')
  expect(params['additionalPermissions']).toEqual(EXPECTED_RAW_PROFILE)
  expect(captured.answered).toEqual({ decision: 'cancel' })

  // 🔒 **The probe's whole claim, asserted** (`649` F7): after the turn's OWN terminal, the
  // provider reported no execution fact for any command — no process, no exit code, no
  // `completed`, no output.
  expect(captured.turnStatus, 'the turn reached its own terminal after cancel').not.toBeNull()
  expect(evidence.ranBecause, 'the command the provider offered did not run').toEqual([])
  // ⚑ **And not by absence:** the item the approval named is the one the provider itself reports
  // `declined` — measured on 0.146.0 by `655`'s first run, so a provider that stopped reporting
  // command items could not pass this by saying nothing.
  const asked = evidence.items.find((one) => one.id === params['itemId'])
  expect(asked?.status, 'the provider reported the command it asked about as declined').toBe(
    'declined',
  )

  // ⚠️ Only a run that got this far deletes its root; a failing one leaves it (`649` F6).
  rmSync(captured.root, { recursive: true, force: true })
}

it(
  '495 · the pinned provider emits the reachable undisplayable exec permission request',
  () => deadline.within('capturing the raw command approval', measureProviderApproval),
  deadline.testTimeoutMs,
)
