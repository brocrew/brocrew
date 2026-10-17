import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
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
// `CodexRuntime.start` → `send` → `close` → `CodexRuntime.resume` of the same thread → `send`.
import {
  SpawnCodexTransport,
  type CodexIncoming,
  type CodexTransport,
} from '../src/codex/codex-transport'
import { CodexRuntime, codexAppServerArgs, type TransportFactory } from '../src/codex/codex-runtime'
import type { RuntimeEvent } from '../src/events'
import type { SessionHandle } from '../src/runtime'
import { bundledCodexBinary } from './bundled-codex'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

/**
 * 🔴 **741 · R99 (corrected) — what a Codex planning thread resumed as `left` tells the model,
 * measured THROUGH THE PRODUCT.**
 *
 * ## ⛔ The question
 *
 * The ruling: *"a reopened conversation does NOT resume planning, whoever started the plan, and the
 * model is told it has left plan mode in the CLI's own words, as the CLI's resume tells it."* `740`
 * measured the Claude CLI's side. On Codex, plan mode is a per-turn `collaborationMode` that
 * `codex-runtime.ts` derives from the launch context (`planPhaseOf`: `never` · `planning` · `left`)
 * and re-sends on every `turn/start`; the thread's mode is sticky server-side. ⚑ So the question
 * here is what the product puts on `turn/start` after a resume as `left`, and what the app-server
 * then puts in front of the MODEL — in Codex's own words, not ours.
 *
 * ## ⚑ The instrument — `581`'s recipe, through the product's runtime (`697`'s and `740`'s shape)
 *
 * Use the bundled binary through `SpawnCodexTransport` and `CodexRuntime` on BroBot’s `ask`
 * profile. A `listen(0)` loopback endpoint records request bodies and returns plain closing
 * messages without tool calls. Each arm owns scratch root, `HOME`, `CODEX_HOME`,
 * `CODEX_SQLITE_HOME`, and cwd; use no account, real token, spend, or `auth.json`. Refuse
 * credentials other than {@link PROBE_ONLY} without retaining them. A fake `security` first
 * on `PATH` logs and exits 44, intercepting CLI PATH lookup but not direct Security-framework
 * calls. Personal provider homes, `~/.codex`, and `:9444` remain untouched; launch no
 * Electron.
 *
 * ⚠️ **The ONE substitution** (`672`'s): the transport answers `getAuthStatus` and `account/read`
 * itself, as an API-key sign-in. It also RECORDS what the product wrote on every `turn/start`
 * (the `collaborationMode`, verbatim) and what the child echoed on `thread/settings/updated`.
 *
 * ⚠️ *"This captures what the provider put in its model-bound request, not a hosted model's
 * obedience to the text."* (`581`) — here the model is a script; what is measured is what the
 * product asks for and what Codex then tells the model.
 *
 * ## ⚑ The arms — three, each one fact apart
 *
 * | arm | launch 1 · `start` | turn | launch 2 · `resume` (same thread, same home) | turn |
 * |---|---|---|---|---|
 * | **left** (the subject) | `planMode: true` | `l1` | `planMode: true`, `planModeEnded: true` | `l2` |
 * | **planning** (`main` today, the contrast) | `planMode: true` | `p1` | `planMode: true` | `p2` |
 * | **never** (control) | no plan mode | `n1` | no plan mode | `n2` |
 *
 * ⚑ **Each premise is read off the child** ({@link verdictOf}): every launch reached this endpoint,
 * the resume is the SAME thread on a NEW app-server and the first one is gone, and on the first
 * turn of `left` and `planning` the product asked for `plan` AND the model was told it was planning.
 * A premise that fails is `not-performed`, never *"not told"*.
 *
 * Run: `pnpm exec vitest run --config vitest.smoke.config.ts
 * packages/runtime/smoke/codex-plan-resume-probe.smoke.ts`. Not part of `pnpm run ci`.
 */

const MODEL = 'gpt-5.6-luna'
const KEY = 'BROBOT_741_CAPTURE_KEY'
/** ⛔ The ONLY credential the loopback endpoint accepts — a literal, never a real key. */
const PROBE_ONLY = 'probe-only'

/**
 * ⛔ The arms, as one table the budget is counted from — see the docblock's. Literals only: the
 * deadline census evaluates the derivation in a sandbox that refuses any imported value.
 */
const ARMS = {
  left: {
    launches: [
      { how: 'start', planMode: true, planModeEnded: false, turn: 'l1' },
      { how: 'resume', planMode: true, planModeEnded: true, turn: 'l2' },
    ],
  },
  planning: {
    launches: [
      { how: 'start', planMode: true, planModeEnded: false, turn: 'p1' },
      { how: 'resume', planMode: true, planModeEnded: false, turn: 'p2' },
    ],
  },
  never: {
    launches: [
      { how: 'start', planMode: false, planModeEnded: false, turn: 'n1' },
      { how: 'resume', planMode: false, planModeEnded: false, turn: 'n2' },
    ],
  },
} as const
type Arm = keyof typeof ARMS

/** ⚠️ Bounded, standing rule 13 — a stalled app-server is NOT PERFORMED, never waited on. */
const OPEN_DEADLINE_MS = 30_000
/**
 * ⚑ **Derived, standing rule 22** — `probe:codex-command-always`'s bound: a scripted turn on the
 * same binary through the same runtime ends in well under 3 s, so 30 s is more than ten times the
 * longest a healthy turn here takes. A turn past it is NOT PERFORMED, its arm's `failure`.
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
  '741 codex plan-resume probe',
  runBudgetMs(
    Object.values(ARMS).flatMap((arm) =>
      arm.launches.flatMap(() => [
        OPEN_DEADLINE_MS + CLOSE_MS,
        // ⛔ **Every wait a turn makes, counted where it is made**: the send, then the ending.
        2 * TURN_DEADLINE_MS + SETTLE_MS,
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

/** What the recorder saw, by label — what the product sent, what the child echoed. */
interface Wire {
  current: string
  /** ⚑ The `collaborationMode` the product wrote on each `turn/start`, verbatim (absent = `null`). */
  readonly turnStarts: { turn: string; hasMode: boolean; collaborationMode: unknown }[]
  /** ⚑ What the child said each thread runs with — its own echo of `thread/start` / `thread/resume`. */
  readonly opens: { label: string; method: string; threadId: unknown }[]
  /** ⚑ Every `thread/settings/updated` the child sent: the mode and the instructions it filled in. */
  readonly settings: {
    label: string
    mode: unknown
    developerInstructions: string | null
  }[]
  readonly completed: { turn: string; status: string }[]
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
    if (method === 'turn/start') {
      const mode = isRecord(params) ? params['collaborationMode'] : undefined
      this.wire.turnStarts.push({
        turn: label,
        hasMode: isRecord(params) && 'collaborationMode' in params,
        collaborationMode: mode ?? null,
      })
    }
    return Promise.resolve(this.inner.request(method, params)).then((response) => {
      if (method === 'thread/start' || method === 'thread/resume') {
        const thread = isRecord(response) && isRecord(response['thread']) ? response['thread'] : {}
        this.wire.opens.push({ label, method, threadId: thread['id'] })
      }
      return response
    })
  }
  notify(method: string, params: unknown): void {
    this.inner.notify(method, params)
  }
  respond(id: string | number, result: unknown): void {
    this.inner.respond(id, result)
  }
  respondError(id: string | number, code: number, message: string): void {
    this.inner.respondError(id, code, message)
  }
  async *incoming(): AsyncIterable<CodexIncoming> {
    for await (const frame of this.inner.incoming()) {
      if (frame.kind === 'notification' && frame.method === 'thread/settings/updated') {
        const settings =
          isRecord(frame.params) && isRecord(frame.params['threadSettings'])
            ? frame.params['threadSettings']
            : {}
        const collaboration = isRecord(settings['collaborationMode'])
          ? settings['collaborationMode']
          : {}
        const inner = isRecord(collaboration['settings']) ? collaboration['settings'] : {}
        const instructions = inner['developer_instructions']
        this.wire.settings.push({
          label: this.wire.current,
          mode: collaboration['mode'] ?? null,
          developerInstructions: typeof instructions === 'string' ? instructions : null,
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

/** The text of one content part, whatever its shape. */
function partText(part: unknown): string {
  if (typeof part === 'string') return part
  return isRecord(part) && typeof part['text'] === 'string' ? part['text'] : ''
}

function lastUserText(body: unknown): string {
  const input = isRecord(body) && Array.isArray(body['input']) ? body['input'] : []
  for (let at = input.length - 1; at >= 0; at -= 1) {
    const item: unknown = input[at]
    if (!isRecord(item) || item['role'] !== 'user' || !Array.isArray(item['content'])) continue
    return item['content'].map(partText).join(' ')
  }
  return ''
}

/**
 * ⚑ **Where Codex speaks of a collaboration mode** — any text part in `input` that names one. The
 * words are Codex's; which mode a part DECLARES is classified in {@link modeOfText}.
 */
const MODE_WORDS = /collaboration[ _]mode|plan mode|default mode/i

/**
 * ⚑ **Which mode a part of Codex's text puts the model IN** — read off the header each of Codex's
 * two built-in mode texts opens with (`060`'s measurement: default's *"# Collaboration Mode:
 * Default"*; plan's own header). Anything else that merely mentions a mode is `mention`.
 */
function modeOfText(text: string): 'plan' | 'default' | 'mention' {
  if (/#\s*Collaboration Mode:\s*Default/i.test(text)) return 'default'
  if (/#\s*(Collaboration Mode:\s*)?Plan Mode/i.test(text)) return 'plan'
  return 'mention'
}

/** One text part of the model-bound `input` that speaks of a mode, and where it sits. */
interface ModeText {
  readonly at: number
  readonly part: number
  readonly type: string
  readonly role: string | null
  readonly declares: 'plan' | 'default' | 'mention'
  /**
   * ⚑ `history` — before the previous probe turn's own message, so replayed from the thread;
   * `this-turn` — after it, so put there for THIS turn. On a thread's first turn nothing is history.
   */
  readonly sits: 'history' | 'this-turn'
  readonly text: string
}

/** One model-bound request, as the trail records it — never a header's credential. */
interface ModelRequest {
  readonly n: number
  readonly arm: Arm
  readonly marker: string | null
  readonly memgen: string | string[] | null
  readonly subagent: string | string[] | null
  readonly inputLength: number
  /** The index of the last `role: user` item — the turn's own message. */
  readonly lastUserAt: number
  /** ⚑ The input as an outline — index, type, role and the start of each item's text. */
  readonly outline: readonly string[]
  readonly modeTexts: readonly ModeText[]
  /** The lines of the top-level `instructions` that speak of a mode (the base prompt). */
  readonly instructionsLength: number
  readonly instructionsModeLines: readonly string[]
  /** ⚑ The whole body, kept in the evidence file (never a header). */
  readonly body: unknown
}

function modelRequestOf(
  n: number,
  arm: Arm,
  request: IncomingMessage,
  body: unknown,
): ModelRequest {
  const input: unknown[] = isRecord(body) && Array.isArray(body['input']) ? body['input'] : []
  // ⚑ The probe's own turn messages, in order: the one before the last marks where history ends.
  const turnAts = input.flatMap((item, at) =>
    isRecord(item) &&
    item['role'] === 'user' &&
    Array.isArray(item['content']) &&
    /741-turn-/.test(item['content'].map(partText).join(' '))
      ? [at]
      : [],
  )
  const priorTurnAt = turnAts.at(-2) ?? -1
  let lastUserAt = -1
  const outline: string[] = []
  const modeTexts: ModeText[] = []
  input.forEach((item, at) => {
    if (!isRecord(item)) {
      outline.push(`${String(at)} ${typeof item}`)
      return
    }
    const type = typeof item['type'] === 'string' ? item['type'] : '(none)'
    const role = typeof item['role'] === 'string' ? item['role'] : null
    if (role === 'user') lastUserAt = at
    const parts: unknown[] = Array.isArray(item['content'])
      ? item['content']
      : typeof item['output'] === 'string'
        ? [item['output']]
        : []
    const texts = parts.map(partText)
    outline.push(
      `${String(at)} ${type}/${role ?? '-'} · ${texts
        .map((text) => JSON.stringify(text.slice(0, 100)))
        .join(' | ')}`,
    )
    texts.forEach((text, part) => {
      if (MODE_WORDS.test(text)) {
        const sits = at > priorTurnAt ? 'this-turn' : 'history'
        modeTexts.push({ at, part, type, role, declares: modeOfText(text), sits, text })
      }
    })
  })
  const instructions =
    isRecord(body) && typeof body['instructions'] === 'string' ? body['instructions'] : ''
  const marker = /741-turn-([a-z0-9]+)/.exec(lastUserText(body))?.[1] ?? null
  return {
    n,
    arm,
    marker,
    memgen: request.headers['x-openai-memgen-request'] ?? null,
    subagent: request.headers['x-openai-subagent'] ?? null,
    inputLength: input.length,
    lastUserAt,
    outline,
    modeTexts,
    instructionsLength: instructions.length,
    instructionsModeLines: instructions.split('\n').filter((line) => MODE_WORDS.test(line)),
    body,
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

/** ⚑ A recording model: every request kept, every one answered with a plain closing message. */
function recordingModel(arm: Arm): {
  server: Server
  requests: () => number
  trail: ModelRequest[]
  refused: string[]
  localPorts: Set<number>
} {
  let count = 0
  const trail: ModelRequest[] = []
  const refused: string[] = []
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
      trail.push(modelRequestOf(count, arm, request, body))
      stream(response, `resp_741_${String(count)}`, {
        type: 'message',
        id: `msg_741_${String(count)}`,
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text: `741 done ${String(count)}`, annotations: [] }],
      })
    })
  })
  return { server, requests: () => count, trail, refused, localPorts }
}

function providerStanza(port: number): string {
  return [
    `model = "${MODEL}"`,
    'model_provider = "capture"',
    '',
    '[model_providers.capture]',
    'name = "BroBot 741 plan-resume capture"',
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

interface LaunchSeen {
  readonly launch: number
  readonly how: 'start' | 'resume'
  readonly planMode: boolean
  readonly planModeEnded: boolean
  readonly turn: string
  readonly threadId: string | null
  readonly pid: number | undefined
  /** ⚑ What the product's handle says it is running, before and after its one turn. */
  readonly settingsAtOpen: unknown
  settingsAfterTurn: unknown
  productEnded: string[]
  modelRequests: number
  configuredAfter: number | null
  aliveAfterClose: boolean | null
}

interface ArmResult {
  readonly arm: Arm
  readonly failure: string | null
  readonly listenedOn: number
  readonly configuredBefore: number | null
  readonly launches: readonly LaunchSeen[]
  readonly modelRequests: number
  readonly localPorts: readonly number[]
  readonly refusedRequests: readonly string[]
  readonly trail: readonly ModelRequest[]
  readonly securityLog: string | null
  /** ⛔ Every provider pid this arm started, and those still alive after its teardown (killed). */
  readonly pids: readonly (number | undefined)[]
  readonly survivors: readonly number[]
}

async function runArm(arm: Arm, root: string, wire: Wire): Promise<ArmResult> {
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
  const model = recordingModel(arm)
  const transports: Recorded[] = []
  /** ⛔ Read at SPAWN — the transport forgets its pid once closed (`740`'s first run). */
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
    for (const [index, launch] of ARMS[arm].launches.entries()) {
      deadline.refuse(`arm ${arm} launch ${String(index + 1)}`)
      wire.current = `${arm}#${String(index + 1)}`
      const requestsBefore = model.requests()
      const resumeRef: SessionHandle['ref'] = firstRef
      const plan = { planMode: launch.planMode, planModeEnded: launch.planModeEnded }
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
              ...plan,
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
            ...plan,
            signal,
          })
        },
      )
      handle = opened
      if (index === 0) firstRef = opened.ref
      const events: RuntimeEvent[] = []
      const seenLaunch: LaunchSeen = {
        launch: index + 1,
        how: launch.how,
        planMode: launch.planMode,
        planModeEnded: launch.planModeEnded,
        turn: launch.turn,
        threadId: opened.ref?.sessionId ?? null,
        pid: opened.providerPid,
        settingsAtOpen: opened.settings ?? null,
        settingsAfterTurn: null,
        productEnded: [],
        modelRequests: 0,
        configuredAfter: null,
        aliveAfterClose: null,
      }
      launches.push(seenLaunch)
      pump = (async () => {
        for await (const event of opened.events()) {
          events.push(event)
          if (event.type === 'turn') seenLaunch.productEnded.push(event.state)
          // ⚑ Nothing here should ask; anything that does is refused, so it cannot hold a turn.
          if (event.type === 'user_input_request') {
            void opened.respondUserInput(event.id, { kind: 'reject' }).catch(() => {})
          }
          if (event.type === 'permission_request') {
            void opened.respondPermission(event.id, { outcome: 'deny' }).catch(() => {})
          }
        }
      })()
      // ⚑ …and AFTER: the launch rewrites `config.toml` (its memory gate) — the child must still be
      // pointed at this endpoint, or the turn below talked to something else.
      seenLaunch.configuredAfter = configuredPortOf(home)
      if (seenLaunch.configuredAfter !== listenedOn) {
        throw new Error(
          `NOT PERFORMED — after launch ${String(index + 1)} the config names port ${String(seenLaunch.configuredAfter)}, not ${String(listenedOn)}`,
        )
      }
      const ended = (): number => events.filter((event) => event.type === 'turn').length
      wire.current = launch.turn
      const before = ended()
      await bounded(`turn ${launch.turn} send`, TURN_DEADLINE_MS, () =>
        opened.send(`741-turn-${launch.turn} please reply in one line`),
      )
      await until(`turn ${launch.turn} ending`, TURN_DEADLINE_MS, () => ended() > before)
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
      seenLaunch.settingsAfterTurn = opened.settings ?? null
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
  return {
    arm,
    failure,
    listenedOn,
    configuredBefore,
    launches,
    modelRequests: model.requests(),
    localPorts: [...model.localPorts],
    refusedRequests: [...model.refused],
    trail: model.trail,
    securityLog: existsSync(securityLog) ? readFileSync(securityLog, 'utf8') : null,
    pids,
    survivors,
  }
}

/** ⚑ The model-bound request that carried a turn's own message — the first, not a side request. */
function turnRequest(results: readonly ArmResult[], turn: string): ModelRequest | undefined {
  return results
    .flatMap((one) => one.trail)
    .find((one) => one.marker === turn && one.memgen === null && one.subagent === null)
}

/** ⚑ What the model was LAST told about its mode in one request, in input order. */
function lastDeclared(request: ModelRequest | undefined): ModeText | undefined {
  return request?.modeTexts.filter((one) => one.declares !== 'mention').at(-1)
}

/** The mode the product asked for on one turn's `turn/start`: `plan`, `default`, or `none`. */
function modeAsked(wire: Wire, turn: string): string {
  const start = wire.turnStarts.find((one) => one.turn === turn)
  if (start === undefined) return '(no turn/start)'
  if (!start.hasMode) return 'none'
  const mode = isRecord(start.collaborationMode) ? start.collaborationMode['mode'] : undefined
  return typeof mode === 'string' ? mode : JSON.stringify(start.collaborationMode)
}

/**
 * ⚑ **Codex's own words, as the bundled 0.146.0 app-server wrote them** (`741`'s first run) — the
 * sentence its plan-mode text holds the model to, and the one its default-mode text ends it with.
 * Held here as literals so a provider that rewords either is a red run, never a silent pass.
 */
const PLAN_SENTENCE = 'You are in **Plan Mode** until a developer message explicitly ends it.'
const DEFAULT_SENTENCE =
  'You are now in Default mode. Any previous instructions for other modes (e.g. Plan mode) are no longer active.'

type Verdict =
  | { readonly verdict: 'told' | 'held' }
  | { readonly verdict: 'not-told' | 'broken' | 'not-performed'; readonly because: string }

const held: Verdict = { verdict: 'held' }
const notPerformed = (because: string): Verdict => ({ verdict: 'not-performed', because })
const broken = (because: string): Verdict => ({ verdict: 'broken', because })

/** ⚑ The premises every arm's verdict rests on, read off the child — or why one failed. */
function premiseOf(results: readonly ArmResult[], arm: Arm): string | null {
  const one = results.find((result) => result.arm === arm)
  if (one === undefined || one.failure !== null) {
    return `the ${arm} arm was not measured: ${one?.failure ?? 'absent'}`
  }
  const [first, second] = one.launches
  if (first === undefined || second === undefined) return `${arm}: two launches were not made`
  if (first.modelRequests === 0 || second.modelRequests === 0) {
    return `${arm}: a launch did not reach the endpoint`
  }
  if (second.threadId === null || second.threadId !== first.threadId) {
    return `${arm}: the resume is not the first launch’s thread`
  }
  if (first.aliveAfterClose !== false || first.pid === second.pid) {
    return `${arm}: the resume did not run on a new app-server`
  }
  return null
}

/**
 * 🔴 **After a resume as `left`, is the model told in Codex's own words that it is no longer
 * planning?** ⛔ Each premise read off the child first — a failed one is `not-performed`.
 */
function verdictOf(wire: Wire, results: readonly ArmResult[]): Verdict {
  const premise = premiseOf(results, 'left')
  if (premise !== null) return notPerformed(premise)
  if (modeAsked(wire, 'l1') !== 'plan') {
    return notPerformed(`l1’s turn/start asked for ${modeAsked(wire, 'l1')}, not plan`)
  }
  const l1 = lastDeclared(turnRequest(results, 'l1'))
  if (l1?.declares !== 'plan' || !l1.text.includes(PLAN_SENTENCE)) {
    return notPerformed('on l1 the model was not told it was planning — nothing to leave')
  }
  const request = turnRequest(results, 'l2')
  if (request === undefined) return notPerformed('no model-bound request carried l2')
  const last = lastDeclared(request)
  const lastPlan = request.modeTexts.filter((one) => one.declares === 'plan').at(-1)
  if (last?.declares !== 'default' || !last.text.includes(DEFAULT_SENTENCE)) {
    return {
      verdict: 'not-told',
      because: `l2 asked for ${modeAsked(wire, 'l2')}; the last mode text the model read declares ${last?.declares ?? 'nothing'}`,
    }
  }
  // ⚑ Where it sits is part of the answer: put there for THIS turn, after the plan text the thread
  // replays, and before the turn's own message.
  if (last.sits !== 'this-turn' || last.at >= request.lastUserAt) {
    return { verdict: 'not-told', because: `the default text sits at input[${String(last.at)}]` }
  }
  if (lastPlan !== undefined && lastPlan.at >= last.at) {
    return { verdict: 'not-told', because: 'a plan text follows the default text' }
  }
  return { verdict: 'told' }
}

/**
 * ⚑ **The contrast (`planning`, `main` today) and the control (`never`)**, each one fact from the
 * subject: a resume as `planning` asks for `plan` again and the model's last word is still Codex's
 * plan text — replayed, nothing new; a thread that never planned is asked for no mode and reads no
 * mode text on either turn.
 */
function contrastOf(wire: Wire, results: readonly ArmResult[]): Record<string, Verdict> {
  const planning = ((): Verdict => {
    const premise = premiseOf(results, 'planning')
    if (premise !== null) return notPerformed(premise)
    if (modeAsked(wire, 'p1') !== 'plan') return notPerformed('p1 did not ask for plan')
    if (lastDeclared(turnRequest(results, 'p1'))?.declares !== 'plan') {
      return notPerformed('on p1 the model was not told it was planning')
    }
    const request = turnRequest(results, 'p2')
    if (request === undefined) return notPerformed('no model-bound request carried p2')
    if (modeAsked(wire, 'p2') !== 'plan') return broken(`p2 asked for ${modeAsked(wire, 'p2')}`)
    const last = lastDeclared(request)
    if (last?.declares !== 'plan' || !last.text.includes(PLAN_SENTENCE)) {
      return broken(`p2’s last mode text declares ${last?.declares ?? 'nothing'}`)
    }
    return held
  })()
  const never = ((): Verdict => {
    const premise = premiseOf(results, 'never')
    if (premise !== null) return notPerformed(premise)
    for (const turn of ['n1', 'n2']) {
      const request = turnRequest(results, turn)
      if (request === undefined) return notPerformed(`no model-bound request carried ${turn}`)
      if (modeAsked(wire, turn) !== 'none')
        return broken(`${turn} asked for ${modeAsked(wire, turn)}`)
      if (request.modeTexts.length > 0) {
        return broken(`${turn}’s model read ${String(request.modeTexts.length)} mode text(s)`)
      }
    }
    return held
  })()
  return { planningStillPlans: planning, neverSaysNothing: never }
}

async function measureAndCheck(): Promise<void> {
  deadline.refuse('starting')
  const scratch = runScratch('codex-plan-resume')
  mkdirSync(scratch, { recursive: true })
  const root = mkdtempSync(join(scratch, 'run-'))
  const wire: Wire = { current: '(none)', turnStarts: [], opens: [], settings: [], completed: [] }
  const results: ArmResult[] = []
  for (const arm of Object.keys(ARMS) as Arm[]) results.push(await runArm(arm, root, wire))

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
  const verdict = verdictOf(wire, results)
  const contrast = contrastOf(wire, results)
  const perTurn = results.flatMap((one) =>
    one.launches.map((launch) => {
      const request = turnRequest(results, launch.turn)
      return {
        arm: one.arm,
        launch: launch.launch,
        how: launch.how,
        turn: launch.turn,
        context: { planMode: launch.planMode, planModeEnded: launch.planModeEnded },
        threadId: launch.threadId,
        productAsked: modeAsked(wire, launch.turn),
        turnStart: wire.turnStarts.find((start) => start.turn === launch.turn) ?? null,
        childEchoed: wire.settings
          .filter((echo) => echo.label === launch.turn)
          .map((echo) => ({
            mode: echo.mode,
            opens: echo.developerInstructions?.slice(0, 200) ?? null,
          })),
        productSettings: { atOpen: launch.settingsAtOpen, afterTurn: launch.settingsAfterTurn },
        productEnded: launch.productEnded,
        codexEnded: wire.completed.filter((done) => done.turn === launch.turn).map((d) => d.status),
        modelRequest:
          request === undefined
            ? null
            : {
                n: request.n,
                inputLength: request.inputLength,
                lastUserAt: request.lastUserAt,
                modeTexts: request.modeTexts.map((text) => ({
                  at: text.at,
                  part: text.part,
                  type: text.type,
                  role: text.role,
                  declares: text.declares,
                  sits: text.sits,
                  opens: text.text.slice(0, 240),
                })),
                lastDeclared: lastDeclared(request)?.declares ?? null,
                instructionsModeLines: request.instructionsModeLines,
              },
      }
    }),
  )
  writeFileSync(
    runEvidence('741-codex-plan-resume.json'),
    JSON.stringify({ codexVersion, verdict, contrast, perTurn, wire, results }, null, 1),
  )
  console.log(
    `741 codex plan resume · ${codexVersion} · ${JSON.stringify(
      {
        verdict,
        contrast,
        perTurn,
        outlines: results.flatMap((one) =>
          one.trail.map((request) => ({
            arm: one.arm,
            n: request.n,
            marker: request.marker,
            memgen: request.memgen,
            outline: request.outline,
          })),
        ),
        arms: results.map((one) => ({
          arm: one.arm,
          failure: one.failure,
          listenedOn: one.listenedOn,
          localPorts: one.localPorts,
          refused: one.refusedRequests,
          securityLog: one.securityLog,
          pids: one.pids,
          survivors: one.survivors,
          launches: one.launches,
        })),
      },
      null,
      1,
    )}`,
  )

  // ⛔ **Every arm MEASURED, or the run says which was not** — a silent arm is a green run.
  for (const one of results) {
    expect(one.failure, `arm ${one.arm}`).toBeNull()
    // ⚑ The premise: each launch's child reached THIS endpoint, on the port it was configured with,
    // and the resume is the SAME thread on a NEW app-server whose predecessor is gone.
    expect(one.launches).toHaveLength(2)
    for (const launch of one.launches) {
      expect(
        launch.modelRequests,
        `arm ${one.arm} launch ${String(launch.launch)}`,
      ).toBeGreaterThan(0)
      expect(launch.configuredAfter).toBe(one.listenedOn)
      expect(launch.aliveAfterClose, `arm ${one.arm} launch ${String(launch.launch)}`).toBe(false)
    }
    expect(one.launches[1]?.threadId).toBe(one.launches[0]?.threadId)
    expect(one.launches[1]?.pid).not.toBe(one.launches[0]?.pid)
    expect(one.localPorts).toEqual([one.listenedOn])
    // ⛔ No credential but the probe literal reached the endpoint, and no Keychain CLI was run.
    expect(one.refusedRequests, `arm ${one.arm} · refused requests`).toEqual([])
    expect(one.securityLog, `arm ${one.arm} · security was run`).toBeNull()
    // ⚑ …over pids that were READ — a survivor check over `undefined` is a pass about nothing.
    expect(one.pids.length, `arm ${one.arm} · spawned`).toBe(2)
    for (const pid of one.pids) {
      expect(pid, `arm ${one.arm} · a pid read at spawn`).toBeGreaterThan(0)
    }
    expect(one.survivors, `arm ${one.arm} · children alive after teardown`).toEqual([])
  }
  // 🔴 **The subject** — after a resume as `left`, Codex tells the model in its own words that it has
  // left plan mode; measured as `741` found it, so a changed provider is a red run here on purpose.
  expect(verdict).toEqual({ verdict: 'told' })
  // ⚑ …and the contrast and the control, each one fact apart.
  expect(contrast).toEqual({ planningStillPlans: held, neverSaysNothing: held })
  // ⚠️ Only a run whose every arm was measured deletes its root (`649` F6).
  rmSync(root, { recursive: true, force: true })
}

it(
  '741 · R99 — a Codex planning thread resumed as left: what the product asks for, and what Codex tells the model',
  () => deadline.within('measuring the three arms', measureAndCheck),
  deadline.testTimeoutMs,
)
