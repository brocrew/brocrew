import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { expect, it } from 'vitest'
import { z } from 'zod'
// 🔒 **A deep import, and deliberately** — the same one `codex-dynamic-tools-probe.smoke.ts` takes,
// for the same reason: this probe owns its spawn so it can put the loopback provider's `env_key` in
// the child environment, which `createSpawnTransportFactory` sanitizes away.
import { SpawnCodexTransport } from '../src/codex/codex-transport'
import { bundledCodexBinary } from './bundled-codex'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

/**
 * 🔴 **605 · can an EXTERNAL MCP server reach a Codex child, and does its approval name the
 * server?** — the two facts `HO-090` §1 turns on, taken off the wire rather than off a type.
 *
 * ## ⛔ The two questions, and why neither could be answered by reading
 *
 * **Q1 · reach.** `RuntimeHost.externalMcpContext` hands a launch nothing unless
 * `capabilitiesFor(provider).externalMcpServers` is `available`, and Codex's entry is `unwired`.
 * ⚠️ **Moving that entry is only honest if a granted server actually arrives in the child** —
 * otherwise the sheet offers a grant that does nothing, which is acceptance #7's *"nothing unwired
 * implies a working state"*. ⛔ **The Claude adapter has `Options.mcpServers`; the Codex adapter
 * has no such field**, and `348` deliberately refused to write `[mcp_servers]` into the home's
 * `config.toml` (*"that file has already cost this project a hard parse failure and a deleted
 * `trust_level`"*). ⚑ So the question is whether the VENDORED protocol carries a door — and
 * `ThreadStartParams.config` is a per-thread config overlay nobody here has ever sent.
 *
 * **Q2 · the server's name.** `codex/capabilities.ts` says the elicitation *"names the server and
 * the prose"* (`507` F2) and `McpServerElicitationRequestParams` declares `serverName: string`,
 * NOT nullable. ⚠️ **A generated type is a SCHEMA verdict, not proof the server sends it**
 * (`044`'s standing rule). This reads the frame the app-server actually emits.
 *
 * ## ⚑ It costs no tokens and needs no credential — `314`'s instrument, one method over
 *
 * The home’s owned loopback Responses endpoint returns `400` without a paid turn. No model
 * turn is needed: the probe itself issues the protocol’s client `mcpServer/tool/call`
 * request, receiving elicitation on the same connection. Place no credential in the home and
 * leave personal `provider-homes/`, `~/.codex`, and `:9444` untouched.
 *
 * ## 🔴 Four arms and a control, because a registration that succeeds proves nothing alone
 *
 * | arm | how the server is offered | what it measures |
 * |---|---|---|
 * | **A · nested overlay** | `thread/start` `config: { mcp_servers: { … } }` | the door that writes no file |
 * | **B · dotted overlay** | `thread/start` `config: { 'mcp_servers.x.url': … }` | the `-c` spelling of the same door |
 * | **C · home file** | `[mcp_servers.x]` in the home's `config.toml` | `307`'s route, the one `348` avoided |
 * | **D · control** | nothing offered | the name must be ABSENT |
 * | **E · elicitation** | the first arm that registered, then `mcpServer/tool/call` | does the frame carry `serverName` |
 * | **H · a Cancel, in a turn** | a scripted MODEL calls the tool; the server asks in `url` mode; answered `cancel` | does the turn run on? which turn does the frame name? |
 * | **I · a Deny, in a turn** | H one fact over: answered `decline` | the control H is read against |
 * | **J · a Cancel, then its turn asked to stop** | H, then `turn/interrupt` to the FRAME's `turnId` | does an interrupt after the answer end the turn? (R74's repair, `720`; withdrawn by R97 at `736`, kept here as a measurement of Codex) |
 *
 * 🔴 **H, I and J are `720`'s (R74)** — `709` F-10: the elicitation card's Cancel told the MCP
 * server `cancel` and asked Codex nothing, under a line saying *"the whole turn is asked to stop"*.
 * ⚠️ They are the first arms here with a MODEL: the loopback endpoint answers a scripted code-mode
 * `exec` that calls the external tool, then a plain closing message — so the tool is called INSIDE
 * a turn, as a person's agent would call it, and Codex's own `turn/completed` says how it ended.
 * ⚑ The answer to the server is the product's own wire answer (`codex-runtime.ts`
 * `respondPermission`: `{action, content: null, _meta: null}`); the probe is the oracle, the app is
 * tested in `ci`.
 *
 * ⚠️ **D is what makes A, B and C measurements.** `thread/start` accepts unknown params silently —
 * `348` measured `{brobotNotAField: "nonsense"}` accepted — so a successful call is not evidence
 * that anything was read.
 *
 * ⛔ **Every wait is bounded** (standing rule 13): a stalled call is NOT PERFORMED, never failed.
 * ⚑ **And so is the RUN** (`655`): one outer deadline for all seven arms, derived from the waits by
 * `042`'s rule (`probe-run-deadline.ts`), which tears the live arm's child and servers down before
 * it rejects. Until `655` this probe had no bound but vitest's 20-minute default — below its own
 * seven arms' worst case, so a hang would have surfaced as a bare vitest timeout naming no step.
 *
 * Run: `pnpm run probe:codex-external-mcp`. Not part of `pnpm run ci`.
 */

/** The server name this probe registers. Deliberately unlike anything Codex ships. */
const SERVER_NAME = 'brobotprobe'

/** The tool that elicits. One argument, so the call is trivially valid. */
const TOOL_NAME = 'ask_the_person'

/** ⛔ Every protocol wait (rule 13). Generous for a loopback child, short enough to report. */
const WAIT_MS = 60_000

/** ⚑ The transport's own teardown bounds, passed explicitly so the budget can count them. */
const EXIT_GRACE_MS = 2_000
const KILL_GRACE_MS = 2_000
const TEARDOWN_MS = EXIT_GRACE_MS + 2 * KILL_GRACE_MS

interface ArmOptions {
  readonly thenCallTheTool?: boolean
  /** ⚑ Start a turn so the child builds a model-bound request this can read the inventory off. */
  readonly thenTakeATurn?: boolean
  /** ⚑ Defaults to `auto`, which is what the first five arms measured. */
  readonly mode?: 'ask' | 'auto'
  /** ⚠️ The app's own capabilities unless an arm is deliberately measuring one more field. */
  readonly openaiFormElicitation?: boolean
  /**
   * ⚑ **720 · a scripted MODEL calls the external tool inside a turn** — and the server asks in
   * `url` mode, the one mode whose card this app draws with a Cancel (`codex-runtime.ts`
   * `handleExternalMcpElicitation`).
   */
  readonly modelCallsTheTool?: boolean
  /** ⚑ 720 · how the probe answers the server's elicitation — the product's wire shape. */
  readonly answer?: 'cancel' | 'decline'
  /** ⚑ 720 · …then `turn/interrupt`, addressed to the turn the FRAME names (R74's repair). */
  readonly thenInterruptItsTurn?: boolean
}

/** ⛔ Every wait one arm can make in turn: three RPCs, the two turn polls, the tool call, teardown. */
function serialWaitsMs(opts: ArmOptions): number[] {
  return [
    WAIT_MS,
    WAIT_MS,
    WAIT_MS,
    ...(opts.thenTakeATurn === true ? [WAIT_MS, WAIT_MS] : []),
    ...(opts.thenCallTheTool === true ? [WAIT_MS] : []),
    // ⚑ 720 · `turn/start`, then the wait for `turn/completed` — and, for J, HEADROOM for the
    // interrupt's answer: it is sent without being awaited, so no serial wait is spent on it.
    ...(opts.modelCallsTheTool === true ? [WAIT_MS, WAIT_MS] : []),
    ...(opts.thenInterruptItsTurn === true ? [WAIT_MS] : []),
    TEARDOWN_MS,
  ]
}

/**
 * ⛔ **The options of every arm the test below runs.** The budget is counted from THIS table, and
 * every `runArm` call passes its entry, so an arm the budget does not count cannot be run.
 */
const ARM_OPTIONS = {
  A: {},
  B: {},
  C: {},
  D: {},
  E: { thenCallTheTool: true, mode: 'auto' },
  F: { thenCallTheTool: true, thenTakeATurn: true, mode: 'ask' },
  G: { thenCallTheTool: true, mode: 'ask', openaiFormElicitation: true },
  H: { modelCallsTheTool: true, mode: 'ask', answer: 'cancel' },
  I: { modelCallsTheTool: true, mode: 'ask', answer: 'decline' },
  J: { modelCallsTheTool: true, mode: 'ask', answer: 'cancel', thenInterruptItsTurn: true },
} as const satisfies Record<string, ArmOptions>

const deadline = probeRunDeadline(
  '605 probe',
  runBudgetMs(Object.values(ARM_OPTIONS).flatMap((opts) => serialWaitsMs(opts))),
  TEARDOWN_MS,
)

/** ⚑ Rule 40: the port the child was CONFIGURED with, read back from the file it will read. */
function configuredPortOf(config: string): number | null {
  const match = /^base_url = "http:\/\/127\.0\.0\.1:(\d+)\/v1"$/m.exec(config)
  return match === null ? null : Number(match[1])
}

/** ⚠️ A bound on one promise, so a stalled call is reported rather than waited on. */
async function within<T>(what: string, promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`NOT PERFORMED: ${what} (${WAIT_MS}ms)`)),
          WAIT_MS,
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
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

/** What the external MCP server did while an arm ran. */
interface McpTraffic {
  /** Every JSON-RPC method the server was asked for, in order. */
  readonly methods: string[]
  /** What `elicitInput` answered, or the error it threw. */
  elicitOutcome: string | null
}

/**
 * ⛔ **A real external MCP server over streamable HTTP** — the same transport this app's own
 * registry preflight speaks (`discoverExternalMcpTools` uses `StreamableHTTPClientTransport`), so
 * what registers here is the shape a person actually registers.
 */
async function startExternalMcpServer(
  traffic: McpTraffic,
  // ⚑ **720 · `url` for the in-turn arms** — the mode whose card this app draws with a Cancel.
  asks: 'form' | 'url',
): Promise<{
  readonly url: string
  readonly close: () => Promise<void>
}> {
  // ⛔ **One `McpServer` PER SESSION, and the first run of this probe is why.** The SDK's `Server`
  // holds ONE transport, so connecting a second session to a shared instance silently unbound the
  // first — the server registered, `tools/list` never arrived, and the arm reported an empty tool
  // map that looked like a Codex limitation. ⚑ A harness bug that reads as a product finding is
  // `a-broken-check's-silence-reads-as-a-clean-result` with the terminal replaced by a JSON file.
  const build = (): McpServer => {
    const mcp = new McpServer({ name: 'brobot-605-probe', version: '0.0.0' })
    mcp.registerTool(
      TOOL_NAME,
      {
        description: '605 probe · elicits, so the app-server has something to forward',
        inputSchema: { note: z.string().optional() },
      },
      async () => {
        // ⚑ **The whole point of the arm.** An MCP server asking the person something is what Codex
        // forwards as `mcpServer/elicitation/request` — and this probe is reading what that frame
        // carries, not whether a model would have triggered it.
        try {
          const answered =
            asks === 'url'
              ? await mcp.server.elicitInput({
                  mode: 'url',
                  message: 'The 720 probe would like you to sign in.',
                  url: 'https://example.invalid/720',
                  elicitationId: 'e720',
                })
              : await mcp.server.elicitInput({
                  message: 'The 605 probe would like a word.',
                  requestedSchema: {
                    type: 'object',
                    properties: { confirm: { type: 'boolean', title: 'Go ahead?' } },
                    required: ['confirm'],
                  },
                })
          traffic.elicitOutcome = JSON.stringify(answered)
        } catch (error) {
          traffic.elicitOutcome = error instanceof Error ? error.message : String(error)
        }
        // ⚑ 720 · in a turn the MODEL reads this, so it says what the server was told.
        return {
          content: [
            {
              type: 'text',
              text:
                asks === 'url'
                  ? `605 probe answered · ${traffic.elicitOutcome ?? 'nothing'}`
                  : '605 probe answered',
            },
          ],
        }
      },
    )
    return mcp
  }

  const transports = new Map<string, StreamableHTTPServerTransport>()
  const http = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      const sessionId = request.headers['mcp-session-id']
      const existing = typeof sessionId === 'string' ? transports.get(sessionId) : undefined
      // ⚠️ **A GET is the SSE stream the server pushes requests down**, and a DELETE ends the
      // session — neither carries a body, so neither is read for one.
      if (request.method !== 'POST') {
        if (existing) await existing.handleRequest(request, response)
        else {
          response.statusCode = 400
          response.end()
        }
        return
      }
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(chunk as Buffer)
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      // ⛔ **Read on EVERY post, not only the first.** The first run of this probe recorded the
      // body only for a session's opening frame, so `tools/list` and `tools/call` were invisible
      // and the arm reported two bare `initialize`s as though nothing else had happened.
      for (const frame of Array.isArray(body) ? body : [body]) {
        const named = (frame as { method?: string } | null)?.method
        if (typeof named === 'string') traffic.methods.push(named)
      }
      if (existing) {
        await existing.handleRequest(request, response, body)
        return
      }
      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id: string): void => {
          transports.set(id, transport)
        },
      })
      await build().connect(transport)
      await transport.handleRequest(request, response, body)
    })()
  })
  const port = await listen(http)
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const one of transports.values()) void one.close()
        http.close(() => resolve())
      }),
  }
}

/** The loopback model provider — one stanza, so the arms differ only in how the server is offered. */
function providerStanza(port: number): string {
  return [
    'model = "gpt-5.6-luna"',
    'model_provider = "capture"',
    '',
    '[model_providers.capture]',
    'name = "BroBot 605 capture"',
    `base_url = "http://127.0.0.1:${port}/v1"`,
    'env_key = "BROBOT_605_CAPTURE_KEY"',
    'request_max_retries = 0',
    'stream_max_retries = 0',
    '',
  ].join('\n')
}

/** How this arm offers the external server to the child. */
type Offer = 'nested-overlay' | 'dotted-overlay' | 'home-file' | 'none'

interface Arm {
  readonly label: string
  /** The server names the child reported, with the tools it found on each. */
  readonly registered: Record<string, string[]>
  /** Everything the app-server asked the external server for. */
  readonly mcpMethods: string[]
  /** The `mcpServer/elicitation/request` frame, exactly as it arrived. */
  readonly elicitation: { method: string; params: unknown } | null
  /** What the MCP server's own `elicitInput` came back with. */
  readonly elicitOutcome: string | null
  /** What `mcpServer/tool/call` answered. */
  readonly toolCall: unknown
  /**
   * 🔴 **Whether the DEVELOPER MESSAGE the model reads mentions the server at all** — the
   * `additional_tools` item carrying `exec`'s catalogue, which is where `312` measured Codex
   * publishing its own nested tools.
   *
   * ⛔ **This is the question `modelSees` does NOT answer**, and reviewing this dispatch's diff
   * is what separated them: a whole-body grep finds the leaf inside
   * `client_metadata['x-codex-turn-metadata']`, which is API telemetry and reaches no model.
   * ⚑ *Present in the turn's registry* and *offered to the model* are two facts, and only the
   * second one is a capability.
   */
  readonly inTheDeveloperMessage: boolean
  /**
   * ⛔ **Where the external tool's name landed in the MODEL-BOUND request** — the only surface that
   * answers *can the agent use it*. A server the app-server connected to whose tools never reach
   * the model is still a grant that does nothing (`307`'s asymmetry, one layer up).
   */
  readonly modelSees: string[]
  /**
   * ⛔ **Whether a turn reached the model at all, and how many requests it made** — the premise of
   * every negative above. A turn `turn/start` refused leaves `modelSees` empty and the developer
   * message silent, which would read as *"the name is nowhere"*.
   */
  readonly turnFailure: string | null
  readonly modelRequests: number
  /** ⚑ **720 · R74 — what the in-turn arms (H, I, J) read off the child**, or `null` elsewhere. */
  readonly inTurn: InTurn | null
  readonly failure: string | null
  /** ⚑ Rule 40: the port the model endpoint was given, and the one the child's config names. */
  readonly capturePort: number | null
  readonly configuredPort: number | null
  /** ⚠️ Kept until the expectations pass — a failing run leaves its evidence (`655`). */
  readonly root: string
}

/** ⚑ **720 · one in-turn arm, as the child told it.** */
interface InTurn {
  /** The turn `turn/start` bound. */
  readonly boundTurn: string | null
  /** The `turnId` the server's elicitation frame named, verbatim — `null`, a string, or absent. */
  readonly frameTurnId: unknown
  readonly frameMode: unknown
  /**
   * ⚠️ **Codex's OWN approval of the tool call**, which arrived first, on the same method, as a
   * zero-field `form` marked `_meta.codex_approval_kind: 'mcp_tool_call'` — answered `accept` here
   * so the server's own elicitation can arrive. `null` when none came.
   */
  readonly codexsOwnApproval: unknown
  /** How the probe answered the server's elicitation. */
  readonly answered: 'cancel' | 'decline'
  /** Model requests the loopback saw AFTER the answer went out — the turn running on. */
  readonly modelRequestsAfterTheAnswer: number | null
  /** What the model was told the tool call returned, in the first request after the answer. */
  readonly toldTheModel: string | null
  /** Codex's own `turn/completed.turn.status`. */
  readonly turnStatus: string | null
  /** J only: `answered`, `refused: …`, or `pending` — the `turn/interrupt` the frame's turn was sent. */
  readonly interrupt: string | null
}

/** ⚑ 720 · a Responses stream carrying ONE output item — the scripted model's whole answer. */
function streamOne(response: ServerResponse, id: string, item: Record<string, unknown>): void {
  const send = (kind: string, payload: Record<string, unknown>): void => {
    response.write(`event: ${kind}\ndata: ${JSON.stringify({ type: kind, ...payload })}\n\n`)
  }
  response.statusCode = 200
  response.setHeader('content-type', 'text/event-stream')
  response.setHeader('cache-control', 'no-cache')
  send('response.created', { response: { id } })
  send('response.output_item.done', { output_index: 0, item })
  send('response.completed', {
    response: {
      id,
      usage: {
        input_tokens: 1,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
        output_tokens: 1,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: 2,
      },
    },
  })
  response.end()
}

/** ⚑ 720 · what the model was told its last call returned — the `*_call_output` item, as text. */
function toolOutputIn(body: unknown): string | null {
  const input = (body as { input?: unknown } | null)?.input
  if (!Array.isArray(input)) return null
  for (let at = input.length - 1; at >= 0; at -= 1) {
    const item = input[at] as { type?: unknown; output?: unknown } | null
    if (typeof item?.type !== 'string' || !item.type.endsWith('_call_output')) continue
    return typeof item.output === 'string' ? item.output : JSON.stringify(item.output)
  }
  return null
}

/**
 * ⛔ **Every QUALIFIED spelling of a leaf name anywhere in a captured model-bound body.**
 *
 * ⚠️ **It reads the whole body and not the tool arrays, and the first run of this arm is why.**
 * `312` already measured that Codex publishes tools inside the code-mode `exec` tool rather than
 * as top-level entries; an external MCP tool goes one step further and appears in the turn's own
 * `client_metadata` registry. ⛔ A search scoped to `tools[]` found NOTHING and would have been
 * reported as *the model never sees it* — `a-negative-is-only-as-strong-as-the-search-shape`.
 */
function qualifiedSpellings(body: unknown, leaf: string): string[] {
  const whole = JSON.stringify(body)
  const found = new Set<string>()
  for (const match of whole.matchAll(new RegExp(`[A-Za-z0-9_]*${leaf}`, 'g'))) found.add(match[0])
  return [...found]
}

/**
 * ⛔ **The two profiles this app launched with at `720`** — `APPROVAL_PROFILES` in
 * `codex-runtime.ts:1157`, copied here because a probe is the oracle and not the app. ⚠️ `ask` has
 * been `workspace-write` since `736` (R96); this copy was not re-aimed, so arms H–J below measure
 * `720`'s profile, not the one BroBot launches now.
 */
const PROFILES = {
  ask: { approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'read-only' },
  auto: { approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: 'danger-full-access' },
} as const

async function runArm(label: string, offer: Offer, opts: ArmOptions): Promise<Arm> {
  deadline.refuse(`starting arm ${label}`)
  const scratch = runScratch('codex-external-mcp')
  mkdirSync(scratch, { recursive: true })
  const root = mkdtempSync(join(scratch, `${label}-`))
  const home = join(root, 'home')
  const cwd = join(root, 'cwd')
  mkdirSync(home, { recursive: true })
  mkdirSync(cwd, { recursive: true })

  const traffic: McpTraffic = { methods: [], elicitOutcome: null }
  const modelBound: unknown[] = []
  const capture = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      try {
        modelBound.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        modelBound.push(Buffer.concat(chunks).toString('utf8'))
      }
      // ⚑ **720 · a scripted model, for the in-turn arms**: its first answer is a code-mode `exec`
      // that calls the external tool; every later one closes the turn with a plain message.
      if (opts.modelCallsTheTool === true) {
        const n = modelBound.length
        streamOne(
          response,
          `resp_720_${String(n)}`,
          n === 1
            ? {
                type: 'custom_tool_call',
                id: `ctc_720_${String(n)}`,
                call_id: `call_720_${String(n)}`,
                name: 'exec',
                input: `const r = await tools.mcp__${SERVER_NAME}__${TOOL_NAME}({ note: "720" })\ntext("BROBOT720:" + JSON.stringify(r))`,
                status: 'completed',
              }
            : {
                type: 'message',
                id: `msg_720_${String(n)}`,
                status: 'completed',
                role: 'assistant',
                content: [{ type: 'output_text', text: '720 done', annotations: [] }],
              },
        )
        return
      }
      response.statusCode = 400
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ error: { message: 'BROBOT_605_CAPTURED' } }))
    })
  })
  let failure: string | null = null
  let turnFailure: string | null = null
  let elicitation: { method: string; params: unknown } | null = null
  let toolCall: unknown = null
  const registered: Record<string, string[]> = {}
  let external: { readonly url: string; readonly close: () => Promise<void> } | null = null
  let transport: SpawnCodexTransport | null = null
  let pump: Promise<void> | null = null
  let capturePort: number | null = null
  let configuredPort: number | null = null
  // ⚑ 720 · what the in-turn arms read off the child, as it arrives.
  let threadOf = ''
  let boundTurn: string | null = null
  let codexsOwnApproval: unknown = null
  let answeredAfter: number | null = null
  let turnStatus: string | null = null
  let interrupt: string | null = null

  /**
   * ⛔ **Owned BEFORE anything exists, and closes whatever is open EACH time it is called** — the
   * cancel probe's reason (`649` F6): the external server, the model endpoint and the child are all
   * made inside the `try` below, so a throw after any of them — or an expiry during a bind — still
   * reaches this.
   */
  const closeOwnedArm = async (): Promise<void> => {
    try {
      if (transport !== null) await transport.close()
    } finally {
      try {
        if (pump !== null) await pump
      } finally {
        capture.closeAllConnections()
        if (capture.listening) {
          await new Promise((resolve) => capture.close(() => resolve(undefined)))
        }
        if (external !== null) await external.close()
      }
    }
  }
  const release = deadline.own(() => closeOwnedArm())

  try {
    external = await startExternalMcpServer(
      traffic,
      opts.modelCallsTheTool === true ? 'url' : 'form',
    )
    capturePort = await listen(capture)
    // ⚠️ An expiry during either bind found nothing to close; refuse before spawning into it.
    deadline.refuse(`starting arm ${label} · both loopback ports are bound`)
    const config =
      providerStanza(capturePort) +
      (offer === 'home-file'
        ? [`[mcp_servers.${SERVER_NAME}]`, `url = "${external.url}"`, ''].join('\n')
        : '')
    writeFileSync(join(home, 'config.toml'), config)
    configuredPort = configuredPortOf(readFileSync(join(home, 'config.toml'), 'utf8'))

    const overlay: Record<string, unknown> | undefined =
      offer === 'nested-overlay'
        ? { mcp_servers: { [SERVER_NAME]: { url: external.url } } }
        : offer === 'dotted-overlay'
          ? { [`mcp_servers.${SERVER_NAME}.url`]: external.url }
          : undefined

    transport = new SpawnCodexTransport(bundledCodexBinary(), ['app-server'], {
      cwd,
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: root,
        CODEX_HOME: home,
        CODEX_SQLITE_HOME: home,
        BROBOT_605_CAPTURE_KEY: 'probe-only',
      },
      exitGraceMs: EXIT_GRACE_MS,
      killGraceMs: KILL_GRACE_MS,
    })
    const owned = transport

    /**
     * ⛔ **Answer every server→client request** — the child waits on us otherwise — **and KEEP the
     * elicitation frame** rather than only counting it. `declined` is the documented negative, so
     * nothing here says a person allowed anything.
     */
    pump = (async () => {
      for await (const incoming of owned.incoming()) {
        if (incoming.kind === 'notification' && incoming.method === 'turn/completed') {
          const turn = (incoming.params as { turn?: { status?: unknown } } | null)?.turn
          turnStatus = typeof turn?.status === 'string' ? turn.status : '(none)'
        }
        if (incoming.kind !== 'request') continue
        if (incoming.method === 'mcpServer/elicitation/request') {
          const params = incoming.params as { _meta?: unknown; turnId?: unknown } | null
          const meta = params?._meta as { codex_approval_kind?: unknown } | null | undefined
          // ⚠️ **720 · Codex's OWN approval of an MCP tool call rides the same method**, marked
          // `_meta.codex_approval_kind`. It is Codex asking, not the server: accepted here, and kept,
          // so the server's own elicitation — the thing measured — can arrive.
          if (meta?.codex_approval_kind !== undefined) {
            codexsOwnApproval = incoming.params
            owned.respond(incoming.id, { action: 'accept', content: {}, _meta: null })
            continue
          }
          elicitation = { method: incoming.method, params: incoming.params }
          answeredAfter = modelBound.length
          owned.respond(incoming.id, {
            action: opts.answer ?? 'decline',
            content: null,
            _meta: null,
          })
          // ⚑ **720 · J — R74's repair, measured**: the turn the FRAME names is asked to stop, after
          // the answer and without awaiting it here (the pump must go on reading the child).
          if (opts.thenInterruptItsTurn === true) {
            const named = typeof params?.turnId === 'string' ? params.turnId : ''
            if (named === '') interrupt = 'NOT PERFORMED — the frame named no turn'
            else {
              interrupt = 'pending'
              owned.request('turn/interrupt', { threadId: threadOf, turnId: named }).then(
                () => (interrupt = 'answered'),
                (error: unknown) =>
                  (interrupt = `refused: ${error instanceof Error ? error.message : String(error)}`),
              )
            }
          }
          continue
        }
        owned.respondError(
          incoming.id,
          -32601,
          `the 605 probe does not implement ${incoming.method}`,
        )
      }
    })()

    await within(
      'initialize',
      owned.request('initialize', {
        clientInfo: {
          name: 'brobot-605-probe',
          title: 'BroBot 605 external MCP probe',
          version: '0.0.0',
        },
        // ⚑ **The product's own capabilities, verbatim** — `codex-runtime.ts:1090`. A probe that
        // negotiated more than the app does would measure a child the app never gets.
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
          ...(opts.openaiFormElicitation === true ? { mcpServerOpenaiFormElicitation: true } : {}),
        },
      }),
    )
    owned.notify('initialized', {})
    const started = (await within(
      'thread/start',
      owned.request('thread/start', {
        model: 'gpt-5.6-luna',
        modelProvider: 'capture',
        cwd,
        ...PROFILES[opts.mode ?? 'auto'],
        ...(overlay === undefined ? {} : { config: overlay }),
      }),
    )) as { thread?: { id?: string } }
    const threadId = started.thread?.id ?? ''
    threadOf = threadId

    const listed = (await within(
      'mcpServerStatus/list',
      owned.request('mcpServerStatus/list', { threadId }),
    )) as { data?: { name?: string; tools?: Record<string, unknown> }[] }
    for (const one of listed.data ?? []) {
      if (typeof one.name !== 'string') continue
      registered[one.name] = Object.keys(one.tools ?? {})
    }

    if (opts.thenTakeATurn === true) {
      // ⚑ **A turn the loopback endpoint answers `400` to.** The request is BUILT before it is
      // sent, so the child's whole tool inventory is on the wire and no model turn is paid for.
      // ⚠️ **`turn/start` spells the sandbox differently from `thread/start`** — `sandboxPolicy`
      // and the full object, never the bare `sandbox` mode (`codex-runtime.ts:1498`). Sending the
      // thread spelling here is `-32600`, and a `void`ed request would have swallowed it.
      turnFailure = null
      owned
        .request('turn/start', {
          threadId,
          input: [{ type: 'text', text: '605 inventory', text_elements: [] }],
          cwd,
          approvalPolicy: PROFILES[opts.mode ?? 'auto'].approvalPolicy,
          approvalsReviewer: 'user',
          sandboxPolicy: { type: 'readOnly', networkAccess: false },
          model: 'gpt-5.6-luna',
          effort: 'low',
        })
        .catch((error: unknown) => {
          turnFailure = error instanceof Error ? error.message : String(error)
        })
      const deadline = Date.now() + WAIT_MS
      while (modelBound.length === 0 && turnFailure === null && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      // ⚠️ **A SECOND turn, because a catalogue could be built lazily.** ⛔ If the external
      // server's tools are absent from the first turn's developer message and present in the
      // second, the answer is *yes, after a warm-up*; if they are absent from both, the answer
      // is *no*, and a one-turn probe could not have told them apart.
      owned
        .request('turn/start', {
          threadId,
          input: [{ type: 'text', text: '605 inventory, again', text_elements: [] }],
          cwd,
          approvalPolicy: PROFILES[opts.mode ?? 'auto'].approvalPolicy,
          approvalsReviewer: 'user',
          sandboxPolicy: { type: 'readOnly', networkAccess: false },
          model: 'gpt-5.6-luna',
          effort: 'low',
        })
        .catch(() => {})
      const second = Date.now() + WAIT_MS
      while (modelBound.length < 2 && Date.now() < second) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }

    if (opts.thenCallTheTool === true && registered[SERVER_NAME] !== undefined) {
      toolCall = await within(
        'mcpServer/tool/call',
        owned.request('mcpServer/tool/call', {
          threadId,
          server: SERVER_NAME,
          tool: TOOL_NAME,
          arguments: { note: '605' },
        }),
      )
    }

    // 🔴 **720 · R74 — the tool called by a MODEL, inside a turn**, on the profile `ask` launches.
    if (opts.modelCallsTheTool === true && registered[SERVER_NAME] !== undefined) {
      const bound = (await within(
        'turn/start',
        owned.request('turn/start', {
          threadId,
          input: [{ type: 'text', text: '720 · call the external tool', text_elements: [] }],
          cwd,
          approvalPolicy: PROFILES[opts.mode ?? 'auto'].approvalPolicy,
          approvalsReviewer: 'user',
          sandboxPolicy: { type: 'readOnly', networkAccess: false },
          model: 'gpt-5.6-luna',
          effort: 'low',
        }),
      )) as { turn?: { id?: string } }
      boundTurn = bound.turn?.id ?? null
      // ⛔ Bounded (rule 13): a turn Codex never ends is NOT PERFORMED, never waited on.
      const ends = Date.now() + WAIT_MS
      while (turnStatus === null && Date.now() < ends) {
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      if (turnStatus === null) throw new Error(`NOT PERFORMED: turn/completed (${WAIT_MS}ms)`)
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  } finally {
    try {
      await closeOwnedArm()
    } finally {
      release()
    }
  }

  const arm: Arm = {
    label,
    registered,
    mcpMethods: [...traffic.methods],
    elicitation,
    elicitOutcome: traffic.elicitOutcome,
    toolCall,
    modelSees: [...new Set(modelBound.flatMap((body) => qualifiedSpellings(body, TOOL_NAME)))],
    turnFailure,
    modelRequests: modelBound.length,
    inTurn:
      opts.modelCallsTheTool === true
        ? {
            boundTurn,
            frameTurnId: (elicitation as { params?: { turnId?: unknown } } | null)?.params?.turnId,
            frameMode: (elicitation as { params?: { mode?: unknown } } | null)?.params?.mode,
            codexsOwnApproval,
            answered: opts.answer ?? 'decline',
            modelRequestsAfterTheAnswer:
              answeredAfter === null ? null : modelBound.length - answeredAfter,
            toldTheModel:
              answeredAfter === null ? null : toolOutputIn(modelBound[answeredAfter] ?? null),
            turnStatus,
            interrupt,
          }
        : null,
    inTheDeveloperMessage: modelBound.some((body) =>
      JSON.stringify((body as { input?: unknown }).input ?? null).includes(SERVER_NAME),
    ),
    failure,
    capturePort,
    configuredPort,
    root,
  }
  const configPath = join(home, 'config.toml')
  writeFileSync(
    runEvidence(`605-${label}.json`),
    JSON.stringify(
      {
        config: existsSync(configPath) ? readFileSync(configPath, 'utf8') : null,
        modelBound,
        ...arm,
      },
      null,
      1,
    ),
  )
  return arm
}

async function measureExternalMcp(): Promise<void> {
  const nested = await runArm('A-nested-overlay', 'nested-overlay', ARM_OPTIONS.A)
  const dotted = await runArm('B-dotted-overlay', 'dotted-overlay', ARM_OPTIONS.B)
  const homeFile = await runArm('C-home-file', 'home-file', ARM_OPTIONS.C)
  const control = await runArm('D-control', 'none', ARM_OPTIONS.D)

  const reachedBy: Offer | null =
    nested.registered[SERVER_NAME] !== undefined
      ? 'nested-overlay'
      : dotted.registered[SERVER_NAME] !== undefined
        ? 'dotted-overlay'
        : homeFile.registered[SERVER_NAME] !== undefined
          ? 'home-file'
          : null

  // ⛔ **`auto` first, and the first run of this probe is why it is not the only one.** Under
  // `approvalPolicy: 'never'` the app-server answered the elicitation ITSELF — `elicitInput`
  // returned `{action:"decline"}` and no `mcpServer/elicitation/request` ever reached this client.
  // ⚑ That is `HO-090` §2 measured rather than assumed (*the card never appears in yolo*), and it
  // means an arm run in `auto` measures the wrong half.
  const inAuto =
    reachedBy === null ? null : await runArm('E-auto-elicitation', reachedBy, ARM_OPTIONS.E)

  // 🔴 **The arm the card turns on**: the profile this app launches `ask` with.
  const inAsk =
    reachedBy === null ? null : await runArm('F-ask-elicitation', reachedBy, ARM_OPTIONS.F)

  // ⚠️ **One fact over.** If F finds nothing, this says whether the missing fact was the client
  // capability rather than the approval policy — an arm that differs in one field is what makes
  // the other arm's result mean something (§6.1).
  const inAskWithForms =
    reachedBy === null ? null : await runArm('G-ask-openai-forms', reachedBy, ARM_OPTIONS.G)

  // 🔴 **720 · R74 — the Cancel door, in a turn**, and the control one fact over, and the repair.
  const cancelInTurn =
    reachedBy === null ? null : await runArm('H-cancel-in-a-turn', reachedBy, ARM_OPTIONS.H)
  const declineInTurn =
    reachedBy === null ? null : await runArm('I-decline-in-a-turn', reachedBy, ARM_OPTIONS.I)
  const cancelThenItsTurn =
    reachedBy === null ? null : await runArm('J-cancel-then-its-turn', reachedBy, ARM_OPTIONS.J)
  const inTurnOf = (arm: Arm | null): unknown =>
    arm === null
      ? 'NOT PERFORMED — no arm registered the server, so there was nothing to call'
      : { ...arm.inTurn, elicitOutcome: arm.elicitOutcome, failure: arm.failure }

  const elicitationOf = (arm: Arm | null): unknown =>
    arm === null
      ? 'NOT PERFORMED — no arm registered the server, so there was nothing to elicit from'
      : {
          mcpMethods: arm.mcpMethods,
          modelSees: arm.modelSees,
          inTheDeveloperMessage: arm.inTheDeveloperMessage,
          elicitationFrame: arm.elicitation,
          elicitOutcome: arm.elicitOutcome,
          toolCall: arm.toolCall,
          failure: arm.failure,
        }

  const report = {
    A_nested_overlay: { registered: nested.registered, failure: nested.failure },
    B_dotted_overlay: { registered: dotted.registered, failure: dotted.failure },
    C_home_file: { registered: homeFile.registered, failure: homeFile.failure },
    D_control: { registered: control.registered, failure: control.failure },
    reachedBy,
    E_auto: elicitationOf(inAuto),
    F_ask: elicitationOf(inAsk),
    G_ask_openai_forms: elicitationOf(inAskWithForms),
    H_cancel_in_a_turn: inTurnOf(cancelInTurn),
    I_decline_in_a_turn: inTurnOf(declineInTurn),
    J_cancel_then_its_turn: inTurnOf(cancelThenItsTurn),
  }
  console.log(`605 external MCP on Codex · ${JSON.stringify(report, null, 2)}`)

  // ⛔ **The control first, because it is what makes the others measurements.** `thread/start`
  // accepts unknown params silently, so "the call succeeded" is evidence of nothing.
  expect(control.registered[SERVER_NAME], 'D · nothing offered, so nothing may register').toBe(
    undefined,
  )
  expect(reachedBy, 'A/B/C · at least one route must register the server').not.toBeNull()
  // ⚑ **Reach is a TOOL the MODEL can see and the child can run, not a name in a status list.**
  // A server that registers and whose tools never reach the model is a grant that does nothing by
  // a longer road — `307`'s asymmetry one layer up.
  expect(inAsk?.registered[SERVER_NAME], 'F · the tools the child found').toContain(TOOL_NAME)
  // ⛔ **The negatives' premise first**: F's turns really reached the model, both of them. Without
  // it, a refused `turn/start` would leave both negatives below passing on nothing.
  expect(inAsk?.failure ?? null, 'F · ran').toBeNull()
  expect(inAsk?.turnFailure ?? null, 'F · its turn started').toBeNull()
  expect(inAsk?.modelRequests ?? 0, 'F · both turns reached the model').toBeGreaterThanOrEqual(2)
  // ⚑ **The SPELLING, because it is what a reserved-name backstop would have to match** — the same
  // `mcp__<server>__<leaf>` shape `tool-inventory.ts` measured on Claude. ⚠️ Bundled 0.146.0 put it
  // in the turn's `client_metadata` registry; 0.160.0 sends no registry, and the name appears
  // nowhere in the model-bound turn: Codex defers it, and `exec`'s instructions say a deferred tool
  // is listed in `ALL_TOOLS`. ⚑ The spelling is proven by arms H, I and J instead: their scripted
  // model calls `tools.mcp__<server>__<leaf>`, and the server's url request — asserted below — can
  // only arrive if that call reached the tool.
  expect(inAsk?.modelSees, 'F · the name is nowhere in the model-bound turn on 0.160.0').toEqual([])
  // 🔴 **AND THE HALF THAT IS ABSENT, pinned so it is a measured fact rather than a silence.**
  // ⛔ The spelling above lived only in `client_metadata` (0.146.0), which is API telemetry; the
  // developer message the MODEL reads names the server in NEITHER turn. ⚠️ **If this ever goes red, that
  // is the good news** — it means Codex started telling the agent what it has been granted, and
  // `codex/capabilities.ts`' note should say so. ⚑ Written as the assertion rather than as a
  // comment, because a negative nobody pins is a negative nobody re-takes.
  expect(
    inAsk?.inTheDeveloperMessage,
    'F · the server is NOT enumerated to the model — see 605',
  ).toBe(false)
  expect(JSON.stringify(inAsk?.toolCall), 'F · the tool answered through the app-server').toContain(
    '605 probe answered',
  )

  // 🔴 **720 · R74, read off the child.** ⚑ Each in-turn arm's PREMISES first: it ran, the server
  // asked in `url` mode (the card with a Cancel), and the frame named the turn `turn/start` bound —
  // so a Cancel can be addressed by the frame, never by `currentTurn` (`492`).
  for (const arm of [cancelInTurn, declineInTurn, cancelThenItsTurn]) {
    expect(arm?.failure ?? null, `${arm?.label} · ran`).toBeNull()
    expect(arm?.inTurn?.frameMode, `${arm?.label} · the server asked in url mode`).toBe('url')
    expect(arm?.inTurn?.boundTurn, `${arm?.label} · a turn was bound`).toMatch(/.+/)
    expect(arm?.inTurn?.frameTurnId, `${arm?.label} · the frame names ITS turn`).toBe(
      arm?.inTurn?.boundTurn,
    )
    // ⚠️ **Codex's OWN approval arrived first**, a zero-field `form` on the same method — the
    // premise the arm had to answer before the server could ask anything (`720` F-A: until `723`
    // this app declined a zero-field form with no card, so no model-driven external call got this
    // far; since `723`, R80, Codex's approval is a card — `probe:codex-mcp-tool-approval`).
    expect(
      arm?.inTurn?.codexsOwnApproval,
      `${arm?.label} · Codex asked its own approval`,
    ).toMatchObject({
      mode: 'form',
      _meta: { codex_approval_kind: 'mcp_tool_call' },
      requestedSchema: { properties: {} },
    })
  }
  // ⚑ The server was told what the card's press says, verbatim, in each arm.
  expect(cancelInTurn?.elicitOutcome, 'H · the server was told cancel').toBe('{"action":"cancel"}')
  expect(declineInTurn?.elicitOutcome, 'I · the server was told decline').toBe(
    '{"action":"decline"}',
  )
  // 🔴 **H — the Cancel ALONE: the turn ran on**, exactly as the Deny (I) did. ⛔ So on `main` the
  // card's *"the whole turn is asked to stop"* was false, and `709` F-10 was right to suspect it.
  expect(cancelInTurn?.inTurn?.turnStatus, 'H · the turn Codex ended').toBe('completed')
  expect(
    cancelInTurn?.inTurn?.modelRequestsAfterTheAnswer,
    'H · the model was called again',
  ).toBeGreaterThan(0)
  expect(declineInTurn?.inTurn?.turnStatus, 'I · the control ran on too').toBe('completed')
  expect(
    declineInTurn?.inTurn?.modelRequestsAfterTheAnswer,
    'I · the model was called again too',
  ).toBeGreaterThan(0)
  // ⚑ **J — R74's repair: `turn/interrupt` to the FRAME's turn, after the answer, ends it.**
  // ⚠️ `736` (R97) withdrew this repair from the product — the app no longer sends it after an
  // elicitation Cancel — so this measures Codex alone, not what BroBot does today.
  expect(cancelThenItsTurn?.inTurn?.interrupt, 'J · the interrupt was answered').toBe('answered')
  expect(cancelThenItsTurn?.inTurn?.turnStatus, 'J · the turn Codex ended').toBe('interrupted')

  const ran = [
    nested,
    dotted,
    homeFile,
    control,
    inAuto,
    inAsk,
    inAskWithForms,
    cancelInTurn,
    declineInTurn,
    cancelThenItsTurn,
  ].filter((arm): arm is Arm => arm !== null)
  // ⚑ Rule 40: every child was configured with the port its model endpoint was GIVEN.
  for (const arm of ran) {
    expect(arm.capturePort, `${arm.label} · the model endpoint's port`).not.toBeNull()
    expect(arm.configuredPort, `${arm.label} · the port in the child's config`).toBe(
      arm.capturePort,
    )
  }
  // ⚠️ Only a run that got this far deletes its roots; a failing one leaves them.
  for (const arm of ran) rmSync(arm.root, { recursive: true, force: true })
}

it(
  '605 · an external MCP server reaches a Codex child, and its elicitation names the server',
  () => deadline.within('measuring arms A–J', measureExternalMcp),
  deadline.testTimeoutMs,
)
