import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { expect, it } from 'vitest'
// 🔒 **A deep import, and deliberately** — `codex-tool-answer-probe.smoke.ts`'s reason, verbatim:
// this probe owns its spawn so it can put the loopback provider's `env_key` in the child
// environment, which `createSpawnTransportFactory` sanitizes away.
import { SpawnCodexTransport } from '../src/codex/codex-transport'
import { bundledCodexBinary } from './bundled-codex'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

/**
 * 🔴 **679 · is a Codex request id numbered per CONNECTION?** — the provider half of `675` F-b.
 *
 * ## ⛔ The question, and why the app suite cannot answer it
 *
 * ⚠️ **`answer_question` and `pass_question_up` found a question by its id alone**, across every
 * child routed to the caller. That is wrong exactly when two children's ids can be one string.
 * `a-question-is-known-by-who-asked-it.test.ts` measures the app on a double that mints `ui_N` per
 * handle — ⛔ **which is the double's choice, not the provider's.** Whether a real provider's ids
 * collide is a fact about the pinned binary, and this is where it is read.
 *
 * ⚑ **The Codex adapter's card id is `requestKey(id)` = `${typeof id}:${id}`** of the app-server's
 * JSON-RPC SERVER-REQUEST id (`codex-runtime.ts`), and every conversation has its own app-server
 * process and connection. So the whole question is: does each connection number its server
 * requests from the same start?
 *
 * ## ⚑ Two connections, the same script on each — and a control inside each
 *
 * | arm | what the synthetic model does | what it answers |
 * |---|---|---|
 * | **first-child** | calls one of our tools TWICE in one `exec` | two server requests on one connection |
 * | **second-child** | the same, on its own app-server | two more, on another connection |
 *
 * ⛔ **The control is inside each arm: the two ids ON ONE connection must differ.** Without it a
 * binary that stamped every request with one constant would read as *numbered per connection*.
 *
 * ## ⚠️ What it measures and what it does not
 *
 * ⚑ **`item/tool/call` is the server request a loopback model can provoke on demand** — no plan
 * mode, no approval policy, no credential. ⛔ **The questions a child raises arrive as OTHER server
 * requests** (`item/tool/requestUserInput`, the approval requests) on the same JSON-RPC connection;
 * whether they draw from the SAME counter is not what this reads, and it is not claimed. What is
 * measured is that ids are per connection and start alike — which is all a collision needs: two
 * children whose question is the same numbered request of their own connections.
 *
 * Use an owned loopback Responses endpoint, ephemeral port, temporary `CODEX_HOME` under
 * scratch, and `env_key: 'probe-only'`. The probe needs no credential or paid tokens and
 * leaves personal `provider-homes/`, `~/.codex`, and `:9444` untouched.
 *
 * Run: `pnpm run probe:codex-request-ids`. Not part of `pnpm run ci`.
 */

const NAMESPACE = 'brobot'
const TOOL = 'list_agents'
const ARMS = ['first-child', 'second-child'] as const
type ArmLabel = (typeof ARMS)[number]

/** ⚠️ Bounded, standing rule 13 — a stalled app-server is NOT PERFORMED, never waited on. */
const TURN_DEADLINE_MS = 60_000
/** ⚠️ The same rule for one request: `initialize` and `thread/start`. */
const RPC_DEADLINE_MS = 30_000
/** One more beat after the second call completes, so the turn's closing request lands. */
const SETTLE_MS = 5_000
/** The transport's own close: stdin ends, `EXIT_GRACE_MS`, then SIGTERM and SIGKILL. */
const EXIT_GRACE_MS = 2_000
const KILL_GRACE_MS = 2_000
const TEARDOWN_MS = EXIT_GRACE_MS + 2 * KILL_GRACE_MS

/** One arm's worst case: two requests, the dynamic items, the settle and the close. */
const SERIAL_WAITS_MS = [RPC_DEADLINE_MS, RPC_DEADLINE_MS, TURN_DEADLINE_MS, SETTLE_MS, TEARDOWN_MS]

const deadline = probeRunDeadline(
  '679 request-id probe',
  runBudgetMs(ARMS.flatMap(() => SERIAL_WAITS_MS)),
  TEARDOWN_MS,
)

/** ⚑ Rule 40: the port the child was CONFIGURED with, read back from the file it reads. */
function configuredPortOf(config: string): number | null {
  const match = /^base_url = "http:\/\/127\.0\.0\.1:(\d+)\/v1"$/m.exec(config)
  return match === null ? null : Number(match[1])
}

/**
 * ⚑ **Two calls in one script, awaited in turn**, so the second server request is issued only after
 * the first is answered — two distinct requests on one connection, never two in flight racing for a
 * number.
 */
const EXEC_SOURCE = [
  `const first = await tools.${NAMESPACE}__${TOOL}({ note: "679-1" })`,
  `const second = await tools.${NAMESPACE}__${TOOL}({ note: "679-2" })`,
  `text("BROBOT679:" + JSON.stringify([first, second]))`,
].join('\n')

function providerStanza(port: number): string {
  return [
    'model = "gpt-5.6-luna"',
    'model_provider = "capture"',
    '',
    '[model_providers.capture]',
    'name = "BroBot 679 capture"',
    `base_url = "http://127.0.0.1:${port}/v1"`,
    'env_key = "BROBOT_679_CAPTURE_KEY"',
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

function sse(response: ServerResponse): (kind: string, payload: Record<string, unknown>) => void {
  response.statusCode = 200
  response.setHeader('content-type', 'text/event-stream')
  response.setHeader('cache-control', 'no-cache')
  response.setHeader('connection', 'keep-alive')
  return (kind, payload) => {
    response.write(`event: ${kind}\ndata: ${JSON.stringify({ type: kind, ...payload })}\n\n`)
  }
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

/** ⚑ The synthetic model turn: a `custom_tool_call` for `exec`, which is how a Codex model reaches one of OUR tools. */
function streamToolCalls(response: ServerResponse, index: number): void {
  const send = sse(response)
  send('response.created', { response: { id: `resp_679_${index}` } })
  send('response.output_item.done', {
    output_index: 0,
    item: {
      type: 'custom_tool_call',
      id: `ctc_679_${index}`,
      call_id: `call_679_${index}`,
      name: 'exec',
      input: EXEC_SOURCE,
      status: 'completed',
    },
  })
  send('response.completed', { response: { id: `resp_679_${index}`, usage: usage() } })
  response.end()
}

/** The closing turn: a plain message, so the thread finishes instead of calling the tool for ever. */
function streamGoodbye(response: ServerResponse, index: number): void {
  const send = sse(response)
  send('response.created', { response: { id: `resp_679_end_${index}` } })
  send('response.output_item.done', {
    output_index: 0,
    item: {
      type: 'message',
      id: `msg_679_${index}`,
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'done', annotations: [] }],
    },
  })
  send('response.completed', { response: { id: `resp_679_end_${index}`, usage: usage() } })
  response.end()
}

interface Arm {
  readonly label: ArmLabel
  /** ⚑ Every server request the app-server made on this connection, in order, raw id and all. */
  readonly serverRequests: readonly { readonly id: string | number; readonly method: string }[]
  readonly failure: string | null
  readonly listenedOn: number | null
  readonly configuredPort: number | null
  /** ⚠️ Kept until every expectation passes — a failing run leaves its own (`649` F6). */
  readonly root: string
}

async function capture(label: ArmLabel): Promise<Arm> {
  deadline.refuse(`starting arm ${label}`)
  const scratch = runScratch('codex-request-ids')
  mkdirSync(scratch, { recursive: true })
  const root = mkdtempSync(join(scratch, `${label}-`))
  const home = join(root, 'home')
  const cwd = join(root, 'cwd')
  mkdirSync(home, { recursive: true })
  mkdirSync(cwd, { recursive: true })

  let modelRequests = 0
  const server = createServer((request, response) => {
    request.on('data', () => undefined)
    request.on('end', () => {
      modelRequests += 1
      // ⛔ **The FIRST request runs the script; every later one ends the turn.**
      if (modelRequests === 1) streamToolCalls(response, modelRequests)
      else streamGoodbye(response, modelRequests)
    })
  })

  const serverRequests: { id: string | number; method: string }[] = []
  const completed: unknown[] = []
  let failure: string | null = null
  let listenedOn: number | null = null
  let configuredPort: number | null = null
  let transport: SpawnCodexTransport | null = null
  let pump: Promise<void> | null = null

  /** ⛔ Owned BEFORE anything exists, and closes whatever is open each time (`649` F6). */
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

  /** ⚠️ Standing rule 13: a request that never answers is a stated NOT PERFORMED. */
  const bounded = async <T>(what: string, work: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error(`NOT PERFORMED — ${what} did not answer in ${RPC_DEADLINE_MS}ms`)),
            RPC_DEADLINE_MS,
          )
          timer.unref?.()
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  try {
    listenedOn = await listen(server)
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
        BROBOT_679_CAPTURE_KEY: 'probe-only',
      },
      exitGraceMs: EXIT_GRACE_MS,
      killGraceMs: KILL_GRACE_MS,
    })

    const ownedTransport = transport
    pump = (async () => {
      for await (const incoming of ownedTransport.incoming()) {
        if (incoming.kind === 'notification') {
          const item = (incoming.params as { item?: { type?: string } } | undefined)?.item
          if (incoming.method === 'item/completed' && item?.type === 'dynamicToolCall') {
            completed.push(item)
          }
          continue
        }
        if (incoming.kind !== 'request') continue
        // 🔴 **The measurement: the RAW id, before any BroBot key is made of it.**
        serverRequests.push({ id: incoming.id, method: incoming.method })
        if (incoming.method === 'item/tool/call') {
          ownedTransport.respond(incoming.id, {
            contentItems: [{ type: 'inputText', text: 'ok' }],
            success: true,
          })
          continue
        }
        ownedTransport.respondError(
          incoming.id,
          -32601,
          `the 679 probe does not implement ${incoming.method}`,
        )
      }
    })()

    await bounded(
      'initialize',
      ownedTransport.request('initialize', {
        clientInfo: {
          name: 'brobot-679-probe',
          title: 'BroBot 679 request-id probe',
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
                description: `679 probe · ${TOOL}`,
                inputSchema: { type: 'object', properties: { note: { type: 'string' } } },
              },
            ],
          },
        ],
      }),
    )) as { thread?: { id?: string } }
    void ownedTransport.request('turn/start', {
      threadId: started.thread?.id ?? '',
      input: [{ type: 'text', text: '679 call the tool twice', text_elements: [] }],
      cwd,
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandboxPolicy: { type: 'dangerFullAccess' },
      model: 'gpt-5.6-luna',
      effort: 'low',
    })
    // ⚠️ **Bounded** (standing rule 13): both calls completed, or NOT PERFORMED.
    const by = Date.now() + TURN_DEADLINE_MS
    while (completed.length < 2 && Date.now() < by) await new Promise((r) => setTimeout(r, 50))
    if (completed.length < 2) {
      failure = `NOT PERFORMED — ${String(completed.length)} of 2 dynamic calls completed within ${String(TURN_DEADLINE_MS)}ms`
    }
    const settle = Date.now() + SETTLE_MS
    while (modelRequests < 2 && Date.now() < settle) await new Promise((r) => setTimeout(r, 50))
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  } finally {
    try {
      await closeOwnedCapture()
    } finally {
      release()
    }
  }

  const arm: Arm = {
    label,
    serverRequests: [...serverRequests],
    failure,
    listenedOn,
    configuredPort,
    root,
  }
  writeFileSync(runEvidence(`679-${label}.json`), JSON.stringify(arm, null, 1))
  return arm
}

async function measureBothConnections(): Promise<void> {
  const [first, second] = [await capture('first-child'), await capture('second-child')]
  const idsOf = (arm: Arm): (string | number)[] =>
    arm.serverRequests.filter((one) => one.method === 'item/tool/call').map((one) => one.id)
  const report = {
    firstChild: { failure: first.failure, serverRequests: first.serverRequests },
    secondChild: { failure: second.failure, serverRequests: second.serverRequests },
    // ⚑ **What the adapter would key them as** — `requestKey`'s own spelling, computed from the raw
    // id rather than asserted.
    keysAsTheAdapterSpellsThem: [first, second].map((arm) =>
      idsOf(arm).map((id) => `${typeof id}:${String(id)}`),
    ),
  }
  writeFileSync(runEvidence('679-report.json'), JSON.stringify(report, null, 1))
  console.log(`679 request ids · ${JSON.stringify(report, null, 1)}`)

  for (const arm of [first, second]) {
    expect(arm.failure, `${arm.label} · the arm`).toBeNull()
    expect(idsOf(arm), `${arm.label} · two tool calls, two server requests`).toHaveLength(2)
    // ⛔ **THE CONTROL: on ONE connection the two ids differ** — so what follows is a numbering,
    // not a constant stamped on every request.
    const [one, two] = idsOf(arm)
    expect(one, `${arm.label} · two requests on one connection carry two ids`).not.toEqual(two)
    expect(typeof one, `${arm.label} · a numeric id, which the adapter keys as number:N`).toBe(
      'number',
    )
  }
  // 🔴 **THE MEASUREMENT: two connections number their server requests alike** — the first request
  // on each carries one id, and so does the second. ⚑ So two Codex conversations whose question is
  // the same numbered request of their own connection reach a parent under ONE card id.
  expect(idsOf(second), 'the second connection numbers exactly as the first').toEqual(idsOf(first))

  // ⚑ Rule 40: each arm's child was configured with the port THIS process was given.
  for (const arm of [first, second]) {
    expect(arm.listenedOn, `${arm.label} · the loopback port`).not.toBeNull()
    expect(arm.configuredPort, `${arm.label} · the port in the child's config`).toBe(arm.listenedOn)
  }

  // ⚠️ Only a run that got this far deletes its roots; a failing one leaves them (`649` F6).
  for (const arm of [first, second]) rmSync(arm.root, { recursive: true, force: true })
}

it(
  '679 · a Codex request id is numbered per connection, and two connections number alike',
  () => deadline.within('measuring two connections', measureBothConnections),
  deadline.testTimeoutMs,
)
