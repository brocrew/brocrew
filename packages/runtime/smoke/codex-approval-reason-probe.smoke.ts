import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { expect, it } from 'vitest'
// 🔒 **A deep import, and deliberately** — `codex-reopen-grant-probe.smoke.ts`'s reason: this probe
// owns its spawn so it can put the loopback provider's `env_key` in the child environment, which
// `createSpawnTransportFactory` sanitizes away. ⚑ Everything else is the PRODUCT's door:
// `CodexRuntime.start` → `send` → the cards it publishes → `respondPermission` / `respondUserInput`.
import {
  SpawnCodexTransport,
  type CodexIncoming,
  type CodexTransport,
} from '../src/codex/codex-transport'
import { CodexRuntime, codexAppServerArgs, type TransportFactory } from '../src/codex/codex-runtime'
import type { RuntimeEvent } from '../src/events'
import type { SessionHandle } from '../src/runtime'
import {
  cancelVerdict,
  reasonVerdict,
  type AskSeen,
  type CancelSeen,
} from './approval-reason-evidence'
import { bundledCodexBinary } from './bundled-codex'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

/**
 * 🔴 **709 · who writes the words on a Codex approval card — and does the card carry them by their
 * author?** (R44, from `704` H-4/H-5; landed from `704`'s scratch capture, `704` §12.)
 *
 * ## ⛔ The question
 *
 * `704` §6 measured it once, in scratch: an escalated command's `reason` is the MODEL's
 * `justification`, verbatim. R44 then ruled that a model's words on a card are the agent's — carried
 * in a field named for their author, never unlabelled, never as the disclosure of what Allow runs.
 * ⚠️ **The answer moves with a Codex bump**, so it is a probe: who writes a `reason`, and whether
 * BroBot's profile offers the model `request_permissions` at all, are the bundled binary's to decide.
 *
 * ## ⚑ The instrument — `581`'s recipe, through the product's runtime
 *
 * Run the bundled binary against a loopback Responses endpoint on `listen(0)`, which returns
 * one scripted code-mode call for a marked turn and then a closing message. Each arm owns its
 * root, `HOME`, `CODEX_HOME`, `CODEX_SQLITE_HOME`, and cwd under scratch. Use no model
 * account, token, spend, or `auth.json`; leave personal `provider-homes/`, `~/.codex`, and
 * `:9444` untouched. Launch no Electron.
 *
 * ⚠️ **The ONE substitution** (`672`'s, as `probe:codex-reopen-grant` makes it): the transport
 * answers `getAuthStatus` and `account/read` itself, as an API-key sign-in. It also RECORDS every
 * server request's params before any normalizer, and Codex's own `turn/completed`. Everything is
 * forwarded.
 *
 * ⚠️ *"This captures what the provider put in its model-bound request, not a hosted model's
 * obedience to the text."* (`581`) — here the model is a script and its words are a nonce, so what is
 * measured is where Codex puts words the model wrote, and where the product then carries them.
 *
 * ## ⚑ The arms — three, and a control inside each
 *
 * | arm | config | turn | the scripted call | answered |
 * |---|---|---|---|---|
 * | **shipped** | BroBot's own | `justified` | `exec_command` escalated WITH a `justification` | Deny |
 * | | | `bare` | the same, WITHOUT one — the one-fact control | Deny |
 * | | | `cancelled` | the same as `justified` | **Cancel** — Codex's own ending beside the product's (the premise R43's tests plant) |
 * | | | `p-shipped` | `request_permissions` with a `reason` | Reject, if a card ever comes |
 * | | | `sandbox-denied` | `exec_command` NOT escalated, a write the `ask` sandbox refuses (`read-only` until `736`; `workspace-write` since R96, so the target is the arm's `outside` folder — outside its cwd and every temporary folder, `738`) | Deny, if Codex ever asks |
 * | | | `compound` | `justified` on `a && b` | Deny |
 * | **enabled** | + `[features] request_permissions_tool = true` | `p-enabled` | the same `request_permissions` | Reject |
 * | **policy** | + two `prompt` rules in its own `CODEX_HOME/rules/` | `rule-said` | a command the rule WITH a justification stops, not escalated | Deny |
 * | | | `rule-silent` | one the rule WITHOUT a justification stops | Deny |
 * | | | `rule-justified` | `rule-said`, with a model `justification` | Deny |
 * | | | `rule-escalated` | `rule-said`, escalated with a model `justification` | Deny |
 *
 * ⚑ **Measured on `709`** (bundled 0.146.0): `justified`'s and `compound`'s `reason` is the
 * justification, verbatim, beside the prefix rule Codex offers to remember
 * (`proposedExecpolicyAmendment`), and `bare` has no `reason` key; `p-shipped` is answered by Codex's
 * code-mode host itself — *"`tools.request_permissions` is not a function"* — so BroBot's profile
 * offers no permissions tool; `p-enabled`'s `reason` is the model's, verbatim; `cancelled` ends
 * `interrupted` in Codex's word. 🔴 **Every `rule-*` turn's `reason` is CODEX's** — *"`<command>`
 * requires approval: <the rule's justification>"*, or *"… requires approval by policy"* — even over
 * the model's escalation and justification, and with NO offered rule: that absence is what the
 * product's gate reads. `sandbox-denied` raises no request: the model is told the write failed.
 * ⚑ **Re-taken on bundled 0.160.0** (provider update 1): the same verdicts, once `rule-justified`
 * names `sandbox_permissions: use_default` — 0.160.0 refuses a `justification` without one before
 * anything is asked.
 *
 * 🔴 **`720` · R73 — and the verdict now reads the product's carry of Codex's words.** A `rule-*`
 * turn whose `reason` names its own `command` and a rule's text must reach the card as
 * `providerReason`, labelled `providerReasonFrom: 'a-policy-rule'` (else `the-rule-unsaid`); the
 * rule-silent sentence and every non-policy turn must carry neither (else `misattributed`).
 *
 * Run: `pnpm run probe:codex-approval-reason`. Not part of `pnpm run ci`; its verdict logic is
 * (`packages/runtime/test/codex-approval-reason-evidence.test.ts`).
 */

const MODEL = 'gpt-5.6-luna'
const KEY = 'BROBOT_709_CAPTURE_KEY'

/** ⛔ The arms, as one table the budget is counted from — see the docblock's. */
const ARMS = {
  shipped: {
    features: false,
    rules: false,
    turns: ['justified', 'bare', 'cancelled', 'p-shipped', 'sandbox-denied', 'compound'],
  },
  enabled: { features: true, rules: false, turns: ['p-enabled'] },
  policy: {
    features: false,
    rules: true,
    turns: ['rule-said', 'rule-silent', 'rule-justified', 'rule-escalated'],
  },
} as const
type Arm = keyof typeof ARMS

/** ⚠️ Bounded, standing rule 13 — a stalled app-server is NOT PERFORMED, never waited on. */
const OPEN_DEADLINE_MS = 30_000
/**
 * ⚑ **Derived, standing rule 22**: 704's scratch drove five such turns in 3.1 s on the same binary,
 * so 30 s is more than ten times the longest a healthy turn here takes.
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
  '709 codex approval-reason probe',
  runBudgetMs(
    Object.values(ARMS).flatMap((arm) => [
      OPEN_DEADLINE_MS + CLOSE_MS,
      // ⛔ **Every wait a turn makes, counted where it is made** (`704`'s rule, and `709`'s review):
      // the send, then the product's ending, each bounded by TURN_DEADLINE_MS.
      ...arm.turns.map(() => 2 * TURN_DEADLINE_MS + SETTLE_MS),
    ]),
  ),
  TEARDOWN_MS,
)

/** ⚑ The words the scripted model writes carry this run's pid, so no other run's can be mistaken for them. */
const NONCE = `n${String(process.pid)}`

/** ⚑ The words a POLICY author wrote — a `prompt` rule's own justification — never the model's. */
const POLICY_SAID = `POLICY-JUSTIFICATION-${NONCE}`

/**
 * ⚑ **The `policy` arm's rules, in its own `CODEX_HOME/rules/`** — two `prompt` rules, the second
 * with no justification. What an admin's `requirements.toml`, or a trusted project's `.codex/rules`,
 * can put in front of any command: Codex then asks, and writes the `reason` itself.
 */
const POLICY_RULES = [
  `prefix_rule(pattern=["/usr/bin/touch"], decision="prompt", justification="${POLICY_SAID}")`,
  'prefix_rule(pattern=["/bin/mkdir"], decision="prompt")',
  '',
].join('\n')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** What the recorder saw — every server request, and Codex's own endings, labelled by turn. */
interface Wire {
  current: string
  readonly requests: { turn: string; method: string; params: unknown }[]
  readonly completed: { turn: string; status: string }[]
}

/** The APPROVAL requests — the three a card is published for. */
const APPROVALS = new Set([
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
  'item/permissions/requestApproval',
])

/** ⚑ The product's transport, with `672`'s one substitution, and a RECORDER. */
class Recorded implements CodexTransport {
  constructor(
    private readonly inner: SpawnCodexTransport,
    private readonly wire: Wire,
  ) {}
  get pid(): number | undefined {
    return this.inner.pid
  }
  request(method: string, params: unknown): Promise<unknown> {
    if (method === 'getAuthStatus') {
      return Promise.resolve({ authMethod: 'apikey', authToken: null, requiresOpenaiAuth: false })
    }
    if (method === 'account/read') {
      return Promise.resolve({ account: { type: 'apiKey' }, requiresOpenaiAuth: false })
    }
    return Promise.resolve(this.inner.request(method, params))
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
      if (frame.kind === 'request') {
        this.wire.requests.push({
          turn: this.wire.current,
          method: frame.method,
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

/** One scripted code-mode call: a shell command, or a permissions request. */
type Action =
  | { readonly kind: 'exec'; readonly args: Record<string, unknown> }
  | { readonly kind: 'permissions'; readonly args: Record<string, unknown> }

function execSource(action: Action): string {
  const call =
    action.kind === 'exec'
      ? `tools.exec_command(${JSON.stringify(action.args)})`
      : `tools.request_permissions(${JSON.stringify(action.args)})`
  return [`const answer = await ${call}`, 'text("R709:" + JSON.stringify(answer))'].join('\n')
}

/** The call a turn makes, and the words the MODEL wrote into it — `null` where it wrote none. */
function scriptFor(
  turn: string,
  cwd: string,
  outside: string,
): { action: Action; modelWrote: string | null } {
  if (turn === 'p-shipped' || turn === 'p-enabled') {
    const modelWrote = `MODEL-REASON-${turn}-${NONCE}`
    return {
      action: {
        kind: 'permissions',
        args: { permissions: { file_system: { write: [outside] } }, reason: modelWrote },
      },
      modelWrote,
    }
  }
  const touch = `/usr/bin/touch ${join(cwd, `${turn}.txt`)}`
  // ⚑ Not escalated: the sandbox, or a `prompt` rule, is what asks — never the model.
  // ⚑ 738 · R96 — `ask`'s sandbox writes the cwd (and the temporary folders) unasked since `736`,
  // so `sandbox-denied` touches the arm's `outside` folder, the one write it still refuses; the
  // `rule-said` turn keeps the cwd, because there the `prompt` rule asks whatever the sandbox allows.
  if (turn === 'sandbox-denied') {
    return {
      action: { kind: 'exec', args: { cmd: `/usr/bin/touch ${join(outside, `${turn}.txt`)}` } },
      modelWrote: null,
    }
  }
  if (turn === 'rule-said') {
    return { action: { kind: 'exec', args: { cmd: touch } }, modelWrote: null }
  }
  if (turn === 'rule-silent') {
    return {
      action: { kind: 'exec', args: { cmd: `/bin/mkdir ${join(cwd, turn)}` } },
      modelWrote: null,
    }
  }
  if (turn === 'rule-justified') {
    const modelWrote = `MODEL-JUSTIFICATION-${turn}-${NONCE}`
    // ⚑ Bundled 0.160.0 refuses a `justification` with no `sandbox_permissions` before anything is
    // asked (*"`justification` requires an explicit `sandbox_permissions`"*), so the turn names
    // `use_default` — still not escalated, which is what this turn is about.
    return {
      action: {
        kind: 'exec',
        args: { cmd: touch, sandbox_permissions: 'use_default', justification: modelWrote },
      },
      modelWrote,
    }
  }
  const escalated = {
    cmd: turn === 'compound' ? `${touch} && /usr/bin/touch ${join(cwd, `${turn}-2.txt`)}` : touch,
    sandbox_permissions: 'require_escalated',
  }
  if (turn === 'bare') return { action: { kind: 'exec', args: escalated }, modelWrote: null }
  const modelWrote = `MODEL-JUSTIFICATION-${turn}-${NONCE}`
  return { action: { kind: 'exec', args: { ...escalated, justification: modelWrote } }, modelWrote }
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
 * ⚑ A scripted model: `709r-turn-<name>` in the user text → one code-mode call, then a closing
 * message — and, beside it, what the model was told each call returned.
 */
function scriptedModel(script: ReadonlyMap<string, Action>): {
  server: Server
  requests: () => number
  answers: Map<string, string>
} {
  let count = 0
  const served = new Set<string>()
  const answers = new Map<string, string>()
  const server = createServer((request, response) => {
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
      const marker = /709r-turn-([a-z0-9-]+)/.exec(lastUserText(body))?.[1]
      const told = toolOutputOf(body)
      if (marker !== undefined && told !== null && !answers.has(marker)) answers.set(marker, told)
      const action = marker === undefined ? undefined : script.get(marker)
      if (marker !== undefined && action !== undefined && told === null && !served.has(marker)) {
        served.add(marker)
        stream(response, `resp_709r_${String(count)}`, {
          type: 'custom_tool_call',
          id: `ctc_709r_${String(count)}`,
          call_id: `call_709r_${String(count)}`,
          name: 'exec',
          input: execSource(action),
          status: 'completed',
        })
        return
      }
      stream(response, `resp_709r_${String(count)}`, {
        type: 'message',
        id: `msg_709r_${String(count)}`,
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text: `709r done ${String(count)}`, annotations: [] }],
      })
    })
  })
  return { server, requests: () => count, answers }
}

function providerStanza(port: number, features: boolean): string {
  return [
    `model = "${MODEL}"`,
    'model_provider = "capture"',
    '',
    '[model_providers.capture]',
    'name = "BroBot 709 approval-reason capture"',
    `base_url = "http://127.0.0.1:${String(port)}/v1"`,
    `env_key = "${KEY}"`,
    'request_max_retries = 0',
    'stream_max_retries = 0',
    '',
    // ⚑ **The one fact the second arm changes** — Codex's own feature, in the probe's own home.
    ...(features ? ['[features]', 'request_permissions_tool = true', ''] : []),
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

/** A card the product published, and what answering it did. */
interface CardSeen {
  readonly turn: string
  readonly event: RuntimeEvent
  answered: 'taken' | 'refused' | 'pending'
}

interface ArmResult {
  readonly arm: Arm
  readonly failure: string | null
  readonly listenedOn: number
  readonly configuredBefore: number | null
  readonly configuredAfter: number | null
  readonly modelRequests: number
  readonly modelWrote: Record<string, string | null>
  readonly told: Record<string, string>
  readonly endings: readonly { turn: string; state: string }[]
}

async function runArm(arm: Arm, root: string, wire: Wire, cards: CardSeen[]): Promise<ArmResult> {
  deadline.refuse(`arm ${arm}`)
  const armRoot = mkdtempSync(join(root, `${arm}-`))
  const home = join(armRoot, 'home')
  const cwd = join(armRoot, 'cwd')
  const outside = join(armRoot, 'outside')
  for (const dir of [home, cwd, outside]) mkdirSync(dir, { recursive: true })
  const scripts = new Map<string, Action>()
  const modelWrote: Record<string, string | null> = {}
  for (const turn of ARMS[arm].turns) {
    const planned = scriptFor(turn, cwd, outside)
    scripts.set(turn, planned.action)
    modelWrote[turn] = planned.modelWrote
  }
  const model = scriptedModel(scripts)
  const transports: Recorded[] = []
  const endings: { turn: string; state: string }[] = []
  let handle: SessionHandle | null = null
  let pump: Promise<void> | null = null
  const closeOwned = async (): Promise<void> => {
    try {
      if (handle !== null) await handle.close().catch(() => {})
      if (pump !== null) {
        await Promise.race([pump, new Promise((resolve) => setTimeout(resolve, PUMP_MS).unref())])
      }
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
  let configuredAfter: number | null = null
  try {
    listenedOn = await new Promise<number>((resolve, reject) => {
      model.server.once('error', reject)
      model.server.listen(0, '127.0.0.1', () => {
        const address = model.server.address()
        if (address === null || typeof address === 'string') reject(new Error('no loopback port'))
        else resolve(address.port)
      })
    })
    writeFileSync(join(home, 'config.toml'), providerStanza(listenedOn, ARMS[arm].features))
    if (ARMS[arm].rules) {
      mkdirSync(join(home, 'rules'), { recursive: true })
      writeFileSync(join(home, 'rules', 'default.rules'), POLICY_RULES)
    }
    // ⚑ **Rule 40, BEFORE the child starts** — the port it will be configured with is the one
    // `listen(0)` returned, read back from the file it reads.
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
            PATH: process.env['PATH'] ?? '',
            HOME: armRoot,
            CODEX_HOME: context.providerHome,
            CODEX_SQLITE_HOME: context.providerHome,
            [KEY]: 'probe-only',
          },
          exitGraceMs: EXIT_GRACE_MS,
          killGraceMs: KILL_GRACE_MS,
        }),
        wire,
      )
      transports.push(transport)
      return transport
    }
    const runtime = new CodexRuntime(factory)
    const opened = await bounded(`${arm} start`, OPEN_DEADLINE_MS, (signal) =>
      runtime.start({ cwd, providerHome: home, approvalMode: 'ask', model: MODEL, signal }),
    )
    handle = opened
    const events: RuntimeEvent[] = []
    pump = (async () => {
      for await (const event of opened.events()) {
        events.push(event)
        if (event.type === 'turn') endings.push({ turn: wire.current, state: event.state })
        if (event.type !== 'permission_request' && event.type !== 'user_input_request') continue
        const card: CardSeen = { turn: wire.current, event, answered: 'pending' }
        cards.push(card)
        // ⚑ Every card is answered, or a turn is held open by it; whether the answer was TAKEN is
        // recorded, never swallowed (`697`).
        const answering =
          event.type === 'user_input_request'
            ? opened.respondUserInput(event.id, { kind: 'reject' })
            : opened.respondPermission(event.id, {
                outcome: wire.current === 'cancelled' ? 'cancel' : 'deny',
              })
        void answering.then(
          () => (card.answered = 'taken'),
          () => (card.answered = 'refused'),
        )
      }
    })()
    // ⚑ …and AFTER: the launch rewrites `config.toml` (its memory gate) — the child must still be
    // pointed at this endpoint, or every turn below talked to something else.
    configuredAfter = configuredPortOf(home)
    if (configuredAfter !== listenedOn) {
      throw new Error(
        `NOT PERFORMED — after launch the config names port ${String(configuredAfter)}, not ${String(listenedOn)}`,
      )
    }
    const ended = (): number => events.filter((event) => event.type === 'turn').length
    for (const turn of ARMS[arm].turns) {
      wire.current = turn
      const before = ended()
      await bounded(`turn ${turn}`, TURN_DEADLINE_MS, () =>
        opened.send(`709r-turn-${turn} please run the scripted action`),
      )
      await until(`turn ${turn}`, TURN_DEADLINE_MS, () => ended() > before)
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
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
  return {
    arm,
    failure,
    listenedOn,
    configuredBefore,
    configuredAfter,
    modelRequests: model.requests(),
    modelWrote,
    told: Object.fromEntries(model.answers),
    endings,
  }
}

/** ⚑ Every string on a card, but the author-named ones — where a model's words must NOT land. */
function stringsOn(value: unknown, skip: ReadonlySet<string>): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap((one) => stringsOn(one, skip))
  if (!isRecord(value)) return []
  return Object.entries(value).flatMap(([key, one]) => (skip.has(key) ? [] : stringsOn(one, skip)))
}

const NOT_A_SENTENCE = new Set(['type', 'id', 'agentReason'])

/** ⚑ The wire and the cards, read as one row per judged turn. */
function asksSeen(
  wire: Wire,
  cards: readonly CardSeen[],
  results: readonly ArmResult[],
): AskSeen[] {
  const judged = [
    'justified',
    'bare',
    'p-shipped',
    'p-enabled',
    'sandbox-denied',
    'rule-said',
    'rule-silent',
    'rule-justified',
    'rule-escalated',
    'compound',
  ]
  return judged.flatMap((turn) => {
    const result = results.find((one) => turn in one.modelWrote)
    if (result === undefined) return []
    const request = wire.requests.find((one) => one.turn === turn && APPROVALS.has(one.method))
    const card = cards.find((one) => one.turn === turn)
    const event = card?.event
    const agentReason =
      event?.type === 'permission_request'
        ? (event.agentReason ?? null)
        : event?.type === 'user_input_request'
          ? (event.permission?.agentReason ?? null)
          : null
    return [
      {
        turn,
        modelWrote: result.modelWrote[turn] ?? null,
        method: request?.method ?? null,
        rawReason:
          request === undefined || !isRecord(request.params) || !('reason' in request.params)
            ? undefined
            : (request.params['reason'] as string | null),
        // ⚑ 720 · R73's tie: the command Codex's own sentence must name.
        rawCommand:
          request !== undefined &&
          isRecord(request.params) &&
          typeof request.params['command'] === 'string'
            ? request.params['command']
            : null,
        card:
          event === undefined
            ? null
            : {
                agentReason,
                // ⚑ 720 · R73 — the provider's words and their kind, read off the product's card.
                providerReason:
                  event.type === 'permission_request' ? (event.providerReason ?? null) : null,
                providerReasonFrom:
                  event.type === 'permission_request' ? (event.providerReasonFrom ?? null) : null,
                elsewhere: stringsOn(event, NOT_A_SENTENCE),
              },
        toolAnswer: result.told[turn] ?? null,
      },
    ]
  })
}

async function measureAndCheck(): Promise<void> {
  deadline.refuse('starting')
  const scratch = runScratch('codex-approval-reason')
  mkdirSync(scratch, { recursive: true })
  const root = mkdtempSync(join(scratch, 'run-'))
  const wire: Wire = { current: '(none)', requests: [], completed: [] }
  const cards: CardSeen[] = []
  const results: ArmResult[] = []
  for (const arm of ['shipped', 'enabled', 'policy'] as const) {
    results.push(await runArm(arm, root, wire, cards))
  }

  const asks = asksSeen(wire, cards, results)
  const reasons = reasonVerdict(asks)
  const cancelled: CancelSeen = {
    providerStatus: wire.completed.find((one) => one.turn === 'cancelled')?.status ?? null,
    productWord:
      results.flatMap((one) => one.endings).find((one) => one.turn === 'cancelled')?.state ?? null,
  }
  const cancel = cancelVerdict(cancelled)
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
  writeFileSync(
    runEvidence('709-codex-approval-reason.json'),
    JSON.stringify(
      { codexVersion, reasons, cancel, cancelled, asks, results, wire, cards },
      null,
      1,
    ),
  )
  console.log(
    `709 codex approval-reason · ${codexVersion} · ${JSON.stringify({ reasons, cancel, asks, results }, null, 1)}`,
  )

  // ⛔ **Every arm MEASURED, or the run says which was not** — a silent arm is a green run.
  for (const one of results) expect(one.failure, `arm ${one.arm}`).toBeNull()
  // ⚑ The premise: each arm's child reached THIS endpoint — a turn answered by nothing measures
  // nothing about where Codex puts a model's words.
  for (const one of results) expect(one.modelRequests, `arm ${one.arm}`).toBeGreaterThan(0)
  // ⚑ Every card this run raised was answered, and the answer taken.
  expect(cards.map((one) => [one.turn, one.answered])).toEqual(
    cards.map((one) => [one.turn, 'taken']),
  )
  // 🔴 R44, in the product's own cards — and what BroBot's shipped profile offers the model.
  expect(reasons).toEqual({
    verdict: 'by-its-author',
    shipped: 'not-offered',
    sandboxRetry: 'not-asked',
  })
  // ⚑ The premise R43's tests plant — Codex's own word after a Cancel — and the product's beside it.
  expect(cancel).toEqual({ verdict: 'the-providers-word', word: 'interrupted' })
  // ⚠️ Only a run whose every arm was measured deletes its root (`649` F6).
  rmSync(root, { recursive: true, force: true })
}

it(
  '709 · the words the model writes on a Codex card are carried by their author, and a Cancel ends in Codex’s word',
  () => deadline.within('measuring the three arms', measureAndCheck),
  deadline.testTimeoutMs,
)
