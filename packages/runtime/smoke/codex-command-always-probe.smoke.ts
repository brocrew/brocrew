import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { expect, it } from 'vitest'
// 🔒 **A deep import, and deliberately** — `codex-reopen-grant-probe.smoke.ts`'s reason: this probe
// owns its spawn so it can put the loopback provider's `env_key` in the child environment, which
// `createSpawnTransportFactory` sanitizes away. ⚑ Everything else is the PRODUCT's door:
// `CodexRuntime.start` → `send` → the cards it publishes → `respondPermission` → `close` →
// `CodexRuntime.start` / `CodexRuntime.resume` on the same home.
import {
  SpawnCodexTransport,
  type CodexIncoming,
  type CodexTransport,
} from '../src/codex/codex-transport'
import { CodexRuntime, codexAppServerArgs, type TransportFactory } from '../src/codex/codex-runtime'
import type { RuntimeEvent } from '../src/events'
import type { PermissionOutcome } from '../src/permission'
import type { SessionHandle } from '../src/runtime'
import { bundledCodexBinary } from './bundled-codex'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

/**
 * 🔴 **740 · R99 — Codex's command *always* (the exec-policy amendment), measured THROUGH THE
 * PRODUCT** (`736` F-5).
 *
 * ## ⛔ The question
 *
 * `736` (R95) mapped an offered `{ acceptWithExecpolicyAmendment: { execpolicy_amendment } }` on a
 * command approval to `allow_always`, and has the product send that decision back VERBATIM when a
 * person presses it (`codex-runtime.ts`, `commandScope` → `respondPermission`). ⚠️ `736` measured
 * the amendment only in Codex's OWN terminal (*"Yes, and don't ask again for commands that start
 * with …"* writes `<CODEX_HOME>/rules/default.rules`, and the next launch honours it). The ruling:
 * *"Codex's command always is measured through the product before it is drawn: answer allow_always,
 * see rules/default.rules written, and a relaunch is not asked."* This is that measurement.
 *
 * ## ⚑ The instrument — `581`'s recipe, through the product's runtime (`697`'s shape)
 *
 * Use the bundled binary through `SpawnCodexTransport` and `CodexRuntime` on BroBot’s `ask`
 * profile. A `listen(0)` loopback endpoint scripts one code-mode `exec` calling
 * `tools.exec_command` with `sandbox_permissions: 'require_escalated'`, a `justification`,
 * and no `prefix_rule`; Codex supplies the amendment proposal, then receives a closing
 * message. Each arm owns its root, `HOME`, `CODEX_HOME`, `CODEX_SQLITE_HOME`, and cwd under
 * scratch. Use no account, real token, spend, or `auth.json`. The endpoint refuses
 * credentials other than {@link PROBE_ONLY} and retains none. A fake `security` first on
 * `PATH` logs and exits 44; it intercepts CLI PATH lookup, not direct Security-framework
 * calls. Personal provider homes, `~/.codex`, and `:9444` remain untouched; launch no
 * Electron.
 *
 * ⚠️ **The ONE substitution** (`672`'s): the transport answers `getAuthStatus` and `account/read`
 * itself, as an API-key sign-in. It also RECORDS every server request's params before any
 * normalizer, and every answer the product wrote back, verbatim.
 *
 * ⚠️ *"This captures what the provider put in its model-bound request, not a hosted model's
 * obedience to the text."* (`581`) — here the model is a script; what is measured is what Codex
 * asks, what the product shows and sends back, what Codex keeps in its home, and whether it asks
 * again.
 *
 * ## ⚑ The arms — two, one fact apart (the answer)
 *
 * | arm | launch | turns | answered |
 * |---|---|---|---|
 * | **always** | 1 · `start` | `a1` `touch x740.txt` · `a2` the same, same thread | `a1` *Always allow*; `a2` — if a card comes — Deny |
 * | | 2 · `start` (a NEW conversation, same home) | `a3` the same · `a4` `mkdir -p y740` (another prefix) | `a3` — if asked — Deny; `a4` Deny (the in-launch control: it IS asked) |
 * | | 3 · `resume` of launch 1's thread | `a3r` the same · `a4r` `mkdir -p y740` | as launch 2 |
 * | **control** | 1 · `start` | `c1` `touch x740.txt` · `c2` the same, same thread | `c1` plain Allow (once); `c2` Deny — it IS asked again |
 *
 * ⚑ **What each clause owes, read off the child and the product** ({@link clauseVerdicts}): a
 * premise that fails (Codex asked nothing, offered no amendment, the control launch asked nothing)
 * is `not-performed`, never *"not asked"*.
 *
 * Run: `pnpm run probe:codex-command-always`. Not part of `pnpm run ci`.
 */

const MODEL = 'gpt-5.6-luna'
const KEY = 'BROBOT_740_CAPTURE_KEY'
/** ⛔ The ONLY credential the loopback endpoint accepts — a literal, never a real key. */
const PROBE_ONLY = 'probe-only'

/** The two command shapes: the subject, and a different prefix for the in-launch control. */
const TOUCH = '/usr/bin/touch x740.txt'
const MKDIR = '/bin/mkdir -p y740'

/**
 * ⛔ Each turn: the escalated command it scripts, what a person presses if a card comes, and the
 * name it leaves in the arm's cwd when it runs (read, then removed, after every turn).
 */
const TURNS: Readonly<
  Record<string, { cmd: string; press: 'allow_always' | 'allow' | 'deny'; leaves: string }>
> = {
  a1: { cmd: TOUCH, press: 'allow_always', leaves: 'x740.txt' },
  a2: { cmd: TOUCH, press: 'deny', leaves: 'x740.txt' },
  a3: { cmd: TOUCH, press: 'deny', leaves: 'x740.txt' },
  a4: { cmd: MKDIR, press: 'deny', leaves: 'y740' },
  a3r: { cmd: TOUCH, press: 'deny', leaves: 'x740.txt' },
  a4r: { cmd: MKDIR, press: 'deny', leaves: 'y740' },
  c1: { cmd: TOUCH, press: 'allow', leaves: 'x740.txt' },
  c2: { cmd: TOUCH, press: 'deny', leaves: 'x740.txt' },
}

/** ⛔ The arms, as one table the budget is counted from — see the docblock's. */
const ARMS = {
  always: {
    launches: [
      { how: 'start', turns: ['a1', 'a2'] },
      { how: 'start', turns: ['a3', 'a4'] },
      { how: 'resume', turns: ['a3r', 'a4r'] },
    ],
  },
  control: { launches: [{ how: 'start', turns: ['c1', 'c2'] }] },
} as const
type Arm = keyof typeof ARMS

/** ⚠️ Bounded, standing rule 13 — a stalled app-server is NOT PERFORMED, never waited on. */
const OPEN_DEADLINE_MS = 30_000
/**
 * ⚑ **Derived, standing rule 22** — `probe:codex-approval-reason`'s: `704`'s scratch drove five such
 * escalated-command turns in 3.1 s on the same binary, so 30 s is more than ten times the longest a
 * healthy turn here takes.
 */
const TURN_DEADLINE_MS = 30_000
/** Trailing item reports land after the turn's own ending. */
const SETTLE_MS = 500
const EXIT_GRACE_MS = 2_000
const KILL_GRACE_MS = 2_000
const PUMP_MS = 5_000
/** ⚠️ A SESSION close — `probe:codex-reopen-grant`'s sizing of the same path, for its reason. */
const CLOSE_FLUSH_MS = 2_000
const CLOSE_INTERRUPT_MS = 2_000
const CLOSE_MS = CLOSE_FLUSH_MS + CLOSE_INTERRUPT_MS + EXIT_GRACE_MS + 2 * KILL_GRACE_MS + PUMP_MS
const TEARDOWN_MS = CLOSE_MS

const deadline = probeRunDeadline(
  '740 codex command-always probe',
  runBudgetMs(
    Object.values(ARMS).flatMap((arm) =>
      arm.launches.flatMap((launch) => [
        OPEN_DEADLINE_MS + CLOSE_MS,
        // ⛔ **Every wait a turn makes, counted where it is made**: the send, then the ending.
        ...launch.turns.map(() => 2 * TURN_DEADLINE_MS + SETTLE_MS),
      ]),
    ),
  ),
  TEARDOWN_MS,
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** What the recorder saw, by turn — every server request, every answer, Codex's own endings. */
interface Wire {
  current: string
  readonly requests: { turn: string; method: string; id: string | number; params: unknown }[]
  readonly answers: { turn: string; id: string | number; result: unknown }[]
  readonly errors: { turn: string; id: string | number; code: number; message: string }[]
  readonly completed: { turn: string; status: string }[]
  /** ⚑ What Codex said each thread runs with — its own echo of `thread/start` / `thread/resume`. */
  readonly opens: {
    label: string
    method: string
    threadId: unknown
    approvalPolicy: unknown
    sandbox: unknown
  }[]
  /** ⚑ The product's own turn endings, by turn. */
  readonly endings: { turn: string; state: string }[]
}

/** ⚑ The product's transport, with `672`'s one substitution, and a RECORDER of both directions. */
class Recorded implements CodexTransport {
  constructor(
    private readonly inner: SpawnCodexTransport,
    private readonly wire: Wire,
  ) {}
  get pid(): number | undefined {
    return this.inner.pid
  }
  get exited(): Promise<void> | undefined {
    return this.inner.exited
  }
  request(method: string, params: unknown): Promise<unknown> {
    if (method === 'getAuthStatus') {
      return Promise.resolve({ authMethod: 'apikey', authToken: null, requiresOpenaiAuth: false })
    }
    if (method === 'account/read') {
      return Promise.resolve({ account: { type: 'apiKey' }, requiresOpenaiAuth: false })
    }
    const label = this.wire.current
    return Promise.resolve(this.inner.request(method, params)).then((response) => {
      if (method === 'thread/start' || method === 'thread/resume') {
        const thread = isRecord(response) && isRecord(response['thread']) ? response['thread'] : {}
        this.wire.opens.push({
          label,
          method,
          threadId: thread['id'],
          approvalPolicy: isRecord(response) ? response['approvalPolicy'] : undefined,
          sandbox: isRecord(response) ? response['sandbox'] : undefined,
        })
      }
      return response
    })
  }
  notify(method: string, params: unknown): void {
    this.inner.notify(method, params)
  }
  respond(id: string | number, result: unknown): void {
    // ⚑ **What the product SENT back**, verbatim — the amendment is read here, not inferred.
    this.wire.answers.push({ turn: this.wire.current, id, result })
    this.inner.respond(id, result)
  }
  respondError(id: string | number, code: number, message: string): void {
    this.wire.errors.push({ turn: this.wire.current, id, code, message })
    this.inner.respondError(id, code, message)
  }
  async *incoming(): AsyncIterable<CodexIncoming> {
    for await (const frame of this.inner.incoming()) {
      if (frame.kind === 'request') {
        this.wire.requests.push({
          turn: this.wire.current,
          method: frame.method,
          id: frame.id,
          params: frame.params,
        })
      }
      if (frame.kind === 'notification' && frame.method === 'turn/completed') {
        const turn =
          isRecord(frame.params) && isRecord(frame.params['turn']) ? frame.params['turn'] : {}
        const status = typeof turn['status'] === 'string' ? turn['status'] : '(none)'
        this.wire.completed.push({ turn: this.wire.current, status })
      }
      yield frame
    }
  }
  close(): void | Promise<void> {
    return this.inner.close()
  }
}

function execSource(turn: string): string {
  const call = `tools.exec_command(${JSON.stringify({
    cmd: TURNS[turn]?.cmd ?? 'true',
    sandbox_permissions: 'require_escalated',
    justification: '740 probe: needs to run this outside the sandbox',
  })})`
  return [`const answer = await ${call}`, 'text("B740:" + JSON.stringify(answer))'].join('\n')
}

function lastUserText(body: unknown): string {
  const input = isRecord(body) && Array.isArray(body['input']) ? body['input'] : []
  for (let at = input.length - 1; at >= 0; at -= 1) {
    const item: unknown = input[at]
    if (!isRecord(item) || item['role'] !== 'user' || !Array.isArray(item['content'])) continue
    return item['content']
      .map((part: unknown) =>
        isRecord(part) && typeof part['text'] === 'string' ? part['text'] : '',
      )
      .join(' ')
  }
  return ''
}

/** ⚑ What the model was TOLD its call returned — the custom tool call's output, as text. */
function toolOutputOf(body: unknown): string | null {
  const input = isRecord(body) && Array.isArray(body['input']) ? body['input'] : []
  const last: unknown = input[input.length - 1]
  if (
    !isRecord(last) ||
    typeof last['type'] !== 'string' ||
    !last['type'].endsWith('_call_output')
  ) {
    return null
  }
  const output = last['output']
  if (typeof output === 'string') return output
  return Array.isArray(output)
    ? output
        .map((part: unknown) =>
          isRecord(part) && typeof part['text'] === 'string' ? part['text'] : '',
        )
        .join('\n')
    : null
}

/**
 * ⚑ **What the model was told in THIS turn** — the first tool output after the turn's last user
 * message, wherever it sits (a1's follow-up did not END with it on the first run of this probe).
 */
function outputInThisTurn(body: unknown): string | null {
  const input = isRecord(body) && Array.isArray(body['input']) ? (body['input'] as unknown[]) : []
  let lastUser = -1
  input.forEach((item, at) => {
    if (isRecord(item) && item['role'] === 'user') lastUser = at
  })
  const found = input
    .slice(lastUser + 1)
    .find(
      (item) =>
        isRecord(item) && typeof item['type'] === 'string' && item['type'].endsWith('_call_output'),
    )
  return found === undefined ? null : toolOutputOf({ input: [found] })
}

/** One input item, as a line of the trail: its type, its role, and the start of its text. */
function itemLine(item: unknown): { type: string; role: string | null; text: string } {
  if (!isRecord(item)) return { type: typeof item, role: null, text: '' }
  const content = item['content']
  const text = Array.isArray(content)
    ? content
        .map((part: unknown) =>
          isRecord(part) && typeof part['text'] === 'string' ? part['text'] : '',
        )
        .join(' ')
    : typeof item['output'] === 'string'
      ? item['output']
      : typeof item['input'] === 'string'
        ? item['input']
        : ''
  return {
    type: typeof item['type'] === 'string' ? item['type'] : '(none)',
    role: typeof item['role'] === 'string' ? item['role'] : null,
    text: text.slice(0, 240),
  }
}

function stream(response: ServerResponse, id: string, item: Record<string, unknown>): void {
  const send = (kind: string, payload: Record<string, unknown>): void => {
    response.write(`event: ${kind}\ndata: ${JSON.stringify({ type: kind, ...payload })}\n\n`)
  }
  response.statusCode = 200
  response.setHeader('content-type', 'text/event-stream')
  response.setHeader('cache-control', 'no-cache')
  response.setHeader('connection', 'keep-alive')
  send('response.created', { response: { id } })
  send('response.output_item.done', { output_index: 0, item })
  send('response.completed', {
    response: {
      id,
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

/**
 * ⛔ **A request whose credential is not the probe literal is refused and never kept** — its body
 * is not read, and only the reason is recorded, never a header's value.
 */
function refusalOf(request: IncomingMessage): string | null {
  if (request.headers['authorization'] !== `Bearer ${PROBE_ONLY}`) {
    return 'authorization is not the probe-only literal'
  }
  for (const name of ['cookie', 'x-api-key', 'chatgpt-account-id', 'openai-organization']) {
    if (request.headers[name] !== undefined) return `carries a ${name} header`
  }
  return null
}

/** ⚑ One model-bound request, as the trail records it — never a header's credential, never a body. */
interface TrailLine {
  readonly n: number
  readonly marker: string | null
  readonly served: 'tool-call' | 'message'
  readonly memgen: string | string[] | null
  readonly subagent: string | string[] | null
  readonly lastItems: readonly { type: string; role: string | null; text: string }[]
}

/** ⚑ A scripted model: `740-turn-<name>` in the user text → one `exec` call, then a message. */
function scriptedModel(): {
  server: Server
  requests: () => number
  told: Map<string, string>
  refused: string[]
  headerNames: Set<string>
  localPorts: Set<number>
  trail: TrailLine[]
} {
  let count = 0
  const trail: TrailLine[] = []
  const served = new Set<string>()
  const told = new Map<string, string>()
  const refused: string[] = []
  const headerNames = new Set<string>()
  const localPorts = new Set<number>()
  const server = createServer((request, response) => {
    const refusal = refusalOf(request)
    if (refusal !== null) {
      refused.push(refusal)
      request.resume()
      response.statusCode = 401
      response.end()
      return
    }
    for (const name of Object.keys(request.headers)) headerNames.add(name)
    if (request.socket.localPort !== undefined) localPorts.add(request.socket.localPort)
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      count += 1
      let body: unknown
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        body = null
      }
      const marker = /740-turn-([a-z0-9]+)/.exec(lastUserText(body))?.[1]
      const output = toolOutputOf(body)
      const thisTurn = outputInThisTurn(body)
      if (marker !== undefined && thisTurn !== null && !told.has(marker)) told.set(marker, thisTurn)
      const input = isRecord(body) && Array.isArray(body['input']) ? body['input'] : []
      const serves =
        marker !== undefined && output === null && !served.has(marker) && marker in TURNS
      trail.push({
        n: count,
        marker: marker ?? null,
        served: serves ? 'tool-call' : 'message',
        memgen: request.headers['x-openai-memgen-request'] ?? null,
        subagent: request.headers['x-openai-subagent'] ?? null,
        lastItems: input.slice(-3).map(itemLine),
      })
      if (serves && marker !== undefined) {
        served.add(marker)
        stream(response, `resp_740_${String(count)}`, {
          type: 'custom_tool_call',
          id: `ctc_740_${String(count)}`,
          call_id: `call_740_${String(count)}`,
          name: 'exec',
          input: execSource(marker),
          status: 'completed',
        })
        return
      }
      stream(response, `resp_740_${String(count)}`, {
        type: 'message',
        id: `msg_740_${String(count)}`,
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text: `740 done ${String(count)}`, annotations: [] }],
      })
    })
  })
  return { server, requests: () => count, told, refused, headerNames, localPorts, trail }
}

function providerStanza(port: number): string {
  return [
    `model = "${MODEL}"`,
    'model_provider = "capture"',
    '',
    '[model_providers.capture]',
    'name = "BroBot 740 command-always capture"',
    `base_url = "http://127.0.0.1:${String(port)}/v1"`,
    `env_key = "${KEY}"`,
    'request_max_retries = 0',
    'stream_max_retries = 0',
    '',
  ].join('\n')
}

/** ⚑ Rule 40: the port the child is CONFIGURED with, read back from the file it reads. */
function configuredPortOf(home: string): number | null {
  const match = /^base_url = "http:\/\/127\.0\.0\.1:(\d+)\/v1"$/m.exec(
    readFileSync(join(home, 'config.toml'), 'utf8'),
  )
  return match === null ? null : Number(match[1])
}

/** ⚑ Where Codex keeps its prefix rules — read here as a literal, NOT from the product's constant. */
const rulesFileOf = (home: string): string => join(home, 'rules', 'default.rules')
const readRules = (home: string): string | null =>
  existsSync(rulesFileOf(home)) ? readFileSync(rulesFileOf(home), 'utf8') : null

/** ⛔ Every `await` on a launch or a turn is bounded; a stall is NOT PERFORMED, never waited on. */
async function bounded<T>(
  what: string,
  ms: number,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const giveUp = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work(giveUp.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          giveUp.abort()
          reject(new Error(`NOT PERFORMED — ${what} did not finish in ${String(ms)}ms`))
        }, ms)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** ⚑ A poll that STOPS when its bound gives up (`704`'s review) — never a spin past the deadline. */
const until = (what: string, ms: number, done: () => boolean): Promise<void> =>
  bounded(what, ms, async (signal) => {
    while (!done() && !signal.aborted) await new Promise((resolve) => setTimeout(resolve, 10))
  })

const isAlive = (pid: number | undefined): boolean | null => {
  if (pid === undefined) return null
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** A card the product published, what a person pressed, and whether the product took it. */
interface CardSeen {
  readonly arm: Arm
  readonly turn: string
  readonly kind: string
  readonly detail: string
  readonly availableDecisions: readonly PermissionOutcome[]
  readonly persistence: string
  readonly grants: unknown
  readonly amendments: number
  readonly wanted: PermissionOutcome
  readonly pressed: PermissionOutcome
  answered: 'pending' | 'taken' | 'refused'
  refusal: string | null
}

/** One turn: whether its command RAN (its file appeared), and Codex's rules file after it. */
interface TurnSeen {
  readonly arm: Arm
  readonly launch: number
  readonly how: 'start' | 'resume'
  readonly turn: string
  readonly cmd: string
  ran: boolean | null
  rulesAfter: string | null
}

interface LaunchSeen {
  readonly launch: number
  readonly how: 'start' | 'resume'
  readonly threadId: string | null
  readonly pid: number | undefined
  modelRequests: number
  configuredAfter: number | null
  aliveAfterClose: boolean | null
}

interface ArmResult {
  readonly arm: Arm
  readonly failure: string | null
  readonly home: string
  readonly listenedOn: number
  readonly configuredBefore: number | null
  readonly launches: readonly LaunchSeen[]
  readonly modelRequests: number
  readonly localPorts: readonly number[]
  readonly refusedRequests: readonly string[]
  readonly headerNames: readonly string[]
  readonly told: Record<string, string>
  readonly trail: readonly TrailLine[]
  readonly rulesDir: readonly string[] | null
  readonly rulesAtEnd: string | null
  readonly securityLog: string | null
  /** ⛔ Every provider pid this arm started, and those still alive after its teardown (killed). */
  readonly pids: readonly (number | undefined)[]
  readonly survivors: readonly number[]
}

async function runArm(
  arm: Arm,
  root: string,
  wire: Wire,
  cards: CardSeen[],
  turns: TurnSeen[],
): Promise<ArmResult> {
  deadline.refuse(`arm ${arm}`)
  const armRoot = mkdtempSync(join(root, `${arm}-`))
  const home = join(armRoot, 'home')
  const cwd = join(armRoot, 'cwd')
  const bin = join(armRoot, 'bin')
  for (const dir of [home, cwd, bin]) mkdirSync(dir, { recursive: true })
  // ⛔ **No Keychain**: a fake `security` first on the child's PATH, logging and exiting 44.
  const securityLog = join(armRoot, 'security.log')
  writeFileSync(
    join(bin, 'security'),
    `#!/bin/sh\nprintf '%s\\n' "security $*" >> '${securityLog}'\nexit 44\n`,
  )
  chmodSync(join(bin, 'security'), 0o755)
  const model = scriptedModel()
  const transports: Recorded[] = []
  /** ⛔ Read at SPAWN — the transport forgets its pid once closed (this probe's first run). */
  const spawned: (number | undefined)[] = []
  const launches: LaunchSeen[] = []
  let handle: SessionHandle | null = null
  let pump: Promise<void> | null = null
  const closeSession = async (): Promise<void> => {
    const open = handle
    handle = null
    if (open !== null) await open.close().catch(() => {})
    const draining = pump
    pump = null
    if (draining !== null) {
      await Promise.race([draining, new Promise((resolve) => setTimeout(resolve, PUMP_MS).unref())])
    }
  }
  const closeOwned = async (): Promise<void> => {
    try {
      await closeSession()
      for (const one of transports) await Promise.resolve(one.close()).catch(() => {})
    } finally {
      model.server.closeAllConnections()
      if (model.server.listening) {
        await new Promise<void>((resolve) => model.server.close(() => resolve()))
      }
    }
  }
  const release = deadline.own(() => closeOwned())

  let failure: string | null = null
  let listenedOn = 0
  let configuredBefore: number | null = null
  try {
    listenedOn = await new Promise<number>((resolve, reject) => {
      model.server.once('error', reject)
      model.server.listen(0, '127.0.0.1', () => {
        const address = model.server.address()
        if (address === null || typeof address === 'string') reject(new Error('no loopback port'))
        else resolve(address.port)
      })
    })
    writeFileSync(join(home, 'config.toml'), providerStanza(listenedOn))
    // ⚑ **Rule 40, BEFORE the first child starts** — the port it will be configured with is the
    // one `listen(0)` returned, read back from the file it reads.
    configuredBefore = configuredPortOf(home)
    if (configuredBefore !== listenedOn) {
      throw new Error(
        `NOT PERFORMED — the config names port ${String(configuredBefore)}, the endpoint is on ${String(listenedOn)}`,
      )
    }
    const factory: TransportFactory = (context) => {
      const transport = new Recorded(
        new SpawnCodexTransport(bundledCodexBinary(), codexAppServerArgs(), {
          cwd: context.cwd,
          env: {
            PATH: `${bin}:${process.env['PATH'] ?? ''}`,
            HOME: armRoot,
            CODEX_HOME: context.providerHome,
            CODEX_SQLITE_HOME: context.providerHome,
            [KEY]: PROBE_ONLY,
          },
          exitGraceMs: EXIT_GRACE_MS,
          killGraceMs: KILL_GRACE_MS,
        }),
        wire,
      )
      transports.push(transport)
      spawned.push(transport.pid)
      return transport
    }
    const runtime = new CodexRuntime(factory)
    let firstRef: SessionHandle['ref'] = null
    const plan: readonly { readonly how: 'start' | 'resume'; readonly turns: readonly string[] }[] =
      ARMS[arm].launches
    for (const [index, launch] of plan.entries()) {
      deadline.refuse(`arm ${arm} launch ${String(index + 1)}`)
      wire.current = `${arm}#${String(index + 1)}`
      const requestsBefore = model.requests()
      const resumeRef: SessionHandle['ref'] = firstRef
      const opened: SessionHandle = await bounded(
        `${arm} launch ${String(index + 1)} (${launch.how})`,
        OPEN_DEADLINE_MS,
        (signal): Promise<SessionHandle> => {
          if (launch.how === 'start') {
            return runtime.start({
              cwd,
              providerHome: home,
              approvalMode: 'ask',
              model: MODEL,
              signal,
            })
          }
          if (resumeRef === null) {
            throw new Error('NOT PERFORMED — the first launch issued no ref to resume')
          }
          return runtime.resume(resumeRef, {
            providerHome: home,
            approvalMode: 'ask',
            model: MODEL,
            signal,
          })
        },
      )
      handle = opened
      if (index === 0) firstRef = opened.ref
      const events: RuntimeEvent[] = []
      pump = (async () => {
        for await (const event of opened.events()) {
          events.push(event)
          if (event.type === 'turn') wire.endings.push({ turn: wire.current, state: event.state })
          if (event.type === 'user_input_request') {
            void opened.respondUserInput(event.id, { kind: 'reject' }).catch(() => {})
            continue
          }
          if (event.type !== 'permission_request') continue
          const offered = event.scope.availableDecisions
          const wanted: PermissionOutcome = TURNS[wire.current]?.press ?? 'deny'
          // ⚑ The press only where it is OFFERED; everything else is refused — a card that is
          // answered cannot hold a turn open, and what was wanted is kept beside what was pressed.
          const pressed: PermissionOutcome = offered.includes(wanted) ? wanted : 'deny'
          const card: CardSeen = {
            arm,
            turn: wire.current,
            kind: event.kind,
            detail: event.detail,
            availableDecisions: offered,
            persistence: event.scope.persistence,
            grants: event.scope.grants ?? null,
            amendments: event.scope.amendments.length,
            wanted,
            pressed,
            answered: 'pending',
            refusal: null,
          }
          cards.push(card)
          // ⚑ Whether the answer was TAKEN is recorded, never swallowed (`697`).
          void opened.respondPermission(event.id, { outcome: pressed }).then(
            () => (card.answered = 'taken'),
            (error: unknown) => {
              card.answered = 'refused'
              card.refusal = errorText(error)
            },
          )
        }
      })()
      const seenLaunch: LaunchSeen = {
        launch: index + 1,
        how: launch.how,
        threadId: opened.ref?.sessionId ?? null,
        pid: opened.providerPid,
        modelRequests: 0,
        configuredAfter: null,
        aliveAfterClose: null,
      }
      launches.push(seenLaunch)
      // ⚑ …and AFTER: the launch rewrites `config.toml` (its memory gate) — the child must still be
      // pointed at this endpoint, or every turn below talked to something else.
      seenLaunch.configuredAfter = configuredPortOf(home)
      if (seenLaunch.configuredAfter !== listenedOn) {
        throw new Error(
          `NOT PERFORMED — after launch ${String(index + 1)} the config names port ${String(seenLaunch.configuredAfter)}, not ${String(listenedOn)}`,
        )
      }
      const ended = (): number => events.filter((event) => event.type === 'turn').length
      for (const turn of launch.turns) {
        wire.current = turn
        const seen: TurnSeen = {
          arm,
          launch: index + 1,
          how: launch.how,
          turn,
          cmd: TURNS[turn]?.cmd ?? '(none)',
          ran: null,
          rulesAfter: null,
        }
        turns.push(seen)
        const before = ended()
        await bounded(`turn ${turn} send`, TURN_DEADLINE_MS, () =>
          opened.send(`740-turn-${turn} please run the scripted command`),
        )
        await until(`turn ${turn} ending`, TURN_DEADLINE_MS, () => ended() > before)
        await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
        // ⚑ Whether the command RAN, read off the folder — then cleared, so the next turn's file
        // is that turn's.
        const leaves = join(cwd, TURNS[turn]?.leaves ?? '(none)')
        seen.ran = existsSync(leaves)
        rmSync(leaves, { recursive: true, force: true })
        seen.rulesAfter = readRules(home)
      }
      wire.current = `${arm}#${String(index + 1)} close`
      await closeSession()
      seenLaunch.modelRequests = model.requests() - requestsBefore
      seenLaunch.aliveAfterClose = isAlive(seenLaunch.pid)
    }
  } catch (error) {
    failure = errorText(error)
  } finally {
    try {
      await closeOwned()
    } finally {
      release()
    }
  }
  // ⛔ **Every child this arm started is gone** — and one that is not is killed by pid, and named.
  const pids = [...spawned]
  const survivors = pids.filter((pid): pid is number => isAlive(pid) === true)
  for (const pid of survivors) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // gone between the check and the kill
    }
  }
  const rulesDir = join(home, 'rules')
  return {
    arm,
    failure,
    home,
    listenedOn,
    configuredBefore,
    launches,
    modelRequests: model.requests(),
    localPorts: [...model.localPorts],
    refusedRequests: [...model.refused],
    headerNames: [...model.headerNames].sort(),
    told: Object.fromEntries(model.told),
    trail: model.trail,
    rulesDir: existsSync(rulesDir) ? readdirSync(rulesDir).sort() : null,
    rulesAtEnd: readRules(home),
    securityLog: existsSync(securityLog) ? readFileSync(securityLog, 'utf8') : null,
    pids,
    survivors,
  }
}

/** The approvals Codex itself asked on one turn — read off the child, before any normalizer. */
function codexAsked(wire: Wire, turn: string): { id: string | number; params: unknown }[] {
  return wire.requests.filter(
    (one) => one.turn === turn && one.method === 'item/commandExecution/requestApproval',
  )
}

/** The amendment decision Codex OFFERED on one request, verbatim — or `undefined`. */
function offeredAmendment(params: unknown): unknown {
  const list = isRecord(params) ? params['availableDecisions'] : undefined
  if (!Array.isArray(list)) return undefined
  return list.find(
    (one: unknown) => isRecord(one) && isRecord(one['acceptWithExecpolicyAmendment']),
  ) as unknown
}

/** The prefix inside an offered amendment. */
function prefixOf(amendment: unknown): readonly string[] | null {
  if (!isRecord(amendment)) return null
  const inner = amendment['acceptWithExecpolicyAmendment']
  const prefix = isRecord(inner) ? inner['execpolicy_amendment'] : undefined
  return Array.isArray(prefix) && prefix.every((one) => typeof one === 'string')
    ? (prefix as string[])
    : null
}

/**
 * ⚑ **Does the rules file hold an ALLOW rule for exactly this prefix?** Each `prefix_rule(…)` line's
 * `pattern=[…]` parsed as JSON and compared whole — never a substring of the file.
 */
function rulesAllow(rules: string | null, prefix: readonly string[]): boolean {
  if (rules === null) return false
  return rules.split('\n').some((line) => {
    const match = /^prefix_rule\(pattern=(\[.*\]),\s*decision="allow"\)\s*$/.exec(line.trim())
    if (match === null) return false
    try {
      return JSON.stringify(JSON.parse(match[1] ?? '')) === JSON.stringify(prefix)
    } catch {
      return false
    }
  })
}

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

type Verdict =
  | { readonly verdict: 'held' }
  | { readonly verdict: 'broken' | 'not-performed'; readonly because: string }

const held: Verdict = { verdict: 'held' }
const broken = (because: string): Verdict => ({ verdict: 'broken', because })
const notPerformed = (because: string): Verdict => ({ verdict: 'not-performed', because })

/**
 * 🔴 **The ruling's clauses, each read off the child AND the product.** ⛔ A premise that fails is
 * `not-performed`, never *"not asked"*: Codex asked nothing, offered no amendment, the answer was
 * not taken, the control inside the launch asked nothing, or a silent turn did not run.
 */
function clauseVerdicts(
  wire: Wire,
  cards: readonly CardSeen[],
  turns: readonly TurnSeen[],
  results: readonly ArmResult[],
): Record<string, Verdict> {
  const cardsOf = (turn: string): CardSeen[] => cards.filter((one) => one.turn === turn)
  const turnOf = (turn: string): TurnSeen | undefined => turns.find((one) => one.turn === turn)
  const always = results.find((one) => one.arm === 'always')
  const control = results.find((one) => one.arm === 'control')

  // 1 · answer allow_always — through the product, and what went back is what Codex offered.
  const asked = codexAsked(wire, 'a1')
  const offered = asked.length === 1 ? offeredAmendment(asked[0]?.params) : undefined
  const prefix = prefixOf(offered)
  const card = cardsOf('a1')[0]
  const answer: Verdict =
    asked.length !== 1
      ? notPerformed(`Codex asked ${String(asked.length)} command approvals on a1, not one`)
      : offered === undefined || prefix === null
        ? notPerformed('Codex offered no exec-policy amendment on a1')
        : cardsOf('a1').length !== 1
          ? broken(`Codex asked once; the product published ${String(cardsOf('a1').length)} cards`)
          : !card?.availableDecisions.includes('allow_always')
            ? broken('Codex offered the amendment; the card offers no allow_always')
            : !sameJson(card.grants, {
                  allow_always: [{ kind: 'command-prefix', prefix }],
                  alwaysFile: rulesFileOf(always?.home ?? ''),
                })
              ? broken(
                  `the card's grants do not name the prefix and the file: ${JSON.stringify(card.grants)}`,
                )
              : card.answered !== 'taken'
                ? broken(`the product did not take allow_always: ${card.refusal ?? card.answered}`)
                : !sameJson(
                      wire.answers.find((one) => one.turn === 'a1' && one.id === asked[0]?.id)
                        ?.result,
                      { decision: offered },
                    )
                  ? broken('what went back to Codex is not the decision it offered, verbatim')
                  : held

  // 2 · rules/default.rules written, with an allow rule for that prefix.
  const rules: Verdict =
    answer.verdict !== 'held' || prefix === null
      ? notPerformed('the answer was not taken')
      : turnOf('a1')?.rulesAfter === null
        ? broken('no rules/default.rules after a1')
        : !rulesAllow(turnOf('a1')?.rulesAfter ?? null, prefix)
          ? broken('rules/default.rules holds no allow rule for the offered prefix')
          : held

  /** A turn that should NOT be asked, beside the control that SHOULD be. */
  const notAsked = (turn: string, controlTurn: string | null): Verdict => {
    if (answer.verdict !== 'held') return notPerformed('the answer was not taken')
    if (controlTurn !== null && codexAsked(wire, controlTurn).length === 0) {
      return notPerformed(`the control ${controlTurn} (another prefix) was not asked either`)
    }
    if (codexAsked(wire, turn).length > 0 || cardsOf(turn).length > 0) {
      return broken(
        `${turn} was asked again — Codex ${String(codexAsked(wire, turn).length)}, cards ${String(cardsOf(turn).length)}`,
      )
    }
    if (turnOf(turn)?.ran !== true) return notPerformed(`${turn} was not asked and did not run`)
    return held
  }
  const resumed = always?.launches.find((one) => one.launch === 3)
  const first = always?.launches.find((one) => one.launch === 1)
  const second = always?.launches.find((one) => one.launch === 2)

  // 5 · the control arm: a plain Allow is once — asked again, and nothing kept.
  const c1 = cardsOf('c1')[0]
  const controlVerdict: Verdict =
    codexAsked(wire, 'c1').length !== 1 || c1 === undefined
      ? notPerformed('c1 raised no card')
      : c1.pressed !== 'allow' || c1.answered !== 'taken' || turnOf('c1')?.ran !== true
        ? notPerformed(`c1's plain Allow was not taken and run (${c1.pressed}, ${c1.answered})`)
        : codexAsked(wire, 'c2').length === 0 || cardsOf('c2').length === 0
          ? broken('c2 was NOT asked again after a plain Allow')
          : control?.rulesAtEnd !== null
            ? broken('a plain Allow wrote rules/default.rules')
            : held

  return {
    answerAllowAlwaysAccepted: answer,
    rulesDefaultWritten: rules,
    sameThreadNotAsked: notAsked('a2', null),
    relaunchNotAsked:
      second?.threadId === first?.threadId
        ? notPerformed('launch 2 is not a new conversation')
        : notAsked('a3', 'a4'),
    resumeNotAsked:
      resumed?.threadId !== first?.threadId
        ? notPerformed('launch 3 did not resume launch 1’s thread')
        : notAsked('a3r', 'a4r'),
    controlAskedAgain: controlVerdict,
  }
}

async function measureAndCheck(): Promise<void> {
  deadline.refuse('starting')
  const scratch = runScratch('codex-command-always')
  mkdirSync(scratch, { recursive: true })
  const root = mkdtempSync(join(scratch, 'run-'))
  const wire: Wire = {
    current: '(none)',
    requests: [],
    answers: [],
    errors: [],
    completed: [],
    opens: [],
    endings: [],
  }
  const cards: CardSeen[] = []
  const turns: TurnSeen[] = []
  const results: ArmResult[] = []
  for (const arm of Object.keys(ARMS) as Arm[]) {
    results.push(await runArm(arm, root, wire, cards, turns))
  }

  // ⚠️ Bounded, on its own home, and never able to lose the evidence below.
  let codexVersion: string
  try {
    codexVersion = execFileSync(bundledCodexBinary(), ['--version'], {
      encoding: 'utf8',
      timeout: 10_000,
      env: { PATH: process.env['PATH'] ?? '', HOME: root, CODEX_HOME: join(root, 'version-home') },
    }).trim()
  } catch (error) {
    codexVersion = `unknown — ${errorText(error)}`
  }
  const verdicts = clauseVerdicts(wire, cards, turns, results)
  const perTurn = turns.map((seen) => ({
    ...seen,
    codexAsked: codexAsked(wire, seen.turn).map((one) => ({
      availableDecisions: isRecord(one.params) ? one.params['availableDecisions'] : undefined,
      proposedExecpolicyAmendment: isRecord(one.params)
        ? one.params['proposedExecpolicyAmendment']
        : undefined,
      command: isRecord(one.params) ? one.params['command'] : undefined,
      answered:
        wire.answers.find((answer) => answer.turn === seen.turn && answer.id === one.id)?.result ??
        null,
    })),
    cards: cards.filter((one) => one.turn === seen.turn),
    codexEnded: wire.completed.filter((one) => one.turn === seen.turn).map((one) => one.status),
    productEnded: wire.endings.filter((one) => one.turn === seen.turn).map((one) => one.state),
    toldTheModel: results.find((one) => seen.turn in one.told)?.told[seen.turn] ?? null,
  }))
  writeFileSync(
    runEvidence('740-codex-command-always.json'),
    JSON.stringify({ codexVersion, verdicts, perTurn, results, wire }, null, 1),
  )
  console.log(
    `740 codex command always · ${codexVersion} · ${JSON.stringify({ verdicts, perTurn, results }, null, 1)}`,
  )

  // ⛔ **Every arm MEASURED, or the run says which was not** — a silent arm is a green run.
  for (const one of results) {
    expect(one.failure, `arm ${one.arm}`).toBeNull()
    // ⚑ The premise: each launch's child reached THIS endpoint, on the port it was configured with.
    for (const launch of one.launches) {
      expect(
        launch.modelRequests,
        `arm ${one.arm} launch ${String(launch.launch)}`,
      ).toBeGreaterThan(0)
      expect(launch.configuredAfter).toBe(one.listenedOn)
      expect(launch.aliveAfterClose, `arm ${one.arm} launch ${String(launch.launch)}`).toBe(false)
    }
    expect(one.localPorts).toEqual([one.listenedOn])
    // ⛔ No credential but the probe literal reached the endpoint, and no Keychain CLI was run.
    expect(one.refusedRequests, `arm ${one.arm} · refused requests`).toEqual([])
    expect(one.securityLog, `arm ${one.arm} · security was run`).toBeNull()
    // ⚑ …over pids that were READ — a survivor check over `undefined` is a pass about nothing.
    expect(one.pids.length, `arm ${one.arm} · spawned`).toBe(one.launches.length)
    for (const pid of one.pids)
      expect(pid, `arm ${one.arm} · a pid read at spawn`).toBeGreaterThan(0)
    expect(one.survivors, `arm ${one.arm} · children alive after teardown`).toEqual([])
  }
  // 🔴 **R99 — each clause of the ruling, through the product.**
  expect(verdicts).toEqual({
    answerAllowAlwaysAccepted: held,
    rulesDefaultWritten: held,
    sameThreadNotAsked: held,
    relaunchNotAsked: held,
    resumeNotAsked: held,
    controlAskedAgain: held,
  })
  // ⚠️ Only a run whose every arm was measured deletes its root (`649` F6).
  rmSync(root, { recursive: true, force: true })
}

it(
  '740 · R99 — Codex’s command always (the exec-policy amendment), through the product: answered, kept in rules/default.rules, not asked again',
  () => deadline.within('measuring the two arms', measureAndCheck),
  deadline.testTimeoutMs,
)
