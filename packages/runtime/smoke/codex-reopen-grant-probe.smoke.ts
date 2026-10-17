import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { expect, it } from 'vitest'
// 🔒 **A deep import, and deliberately** — `codex-dynamic-tools-probe.smoke.ts`'s reason: this probe
// owns its spawn so it can put the loopback provider's `env_key` in the child environment, which
// `createSpawnTransportFactory` sanitizes away. ⚑ Everything else is the PRODUCT's door:
// `CodexRuntime.start` → `respondPermission` → `close` → `CodexRuntime.resume`.
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
import {
  cardsThatOverpromise,
  reopenVerdict,
  sweepVerdict,
  type CardSeen,
} from './reopen-grant-evidence'
import { runEvidence, runScratch } from './run-paths'

/**
 * 🔴 **697 · `672`'s Codex reopen-grant instrument, landed — does `allow for this session` survive a
 * reopen, and what does a Codex card say it grants?**
 *
 * ## ⛔ The questions
 *
 * 1. **The reopen.** `reopening.ts` tells a person that reopening a conversation *"forgets this
 *    session's 'allow for this session' approvals"*. On Claude that is a fresh `SessionGrants`; on
 *    Codex the grant lives in the app-server, and `672` §2.1 measured it: a file change granted for
 *    the session ASKED again after close → resume on a new app-server, **3 of 3** — control, the
 *    same server, no ask; a fresh thread asks. This is that instrument, kept (`672` F-list).
 * 2. **`672` F1, live.** Every Codex COMMAND card `672` saw offered a one-shot Allow and no session
 *    accept, while its `persistence` said `session` — *"for the whole conversation"* — because the
 *    server PROPOSED an exec-policy amendment. ⚑ `697` derives `persistence` from the offer; every
 *    card this run publishes is held to that (`cardsThatOverpromise` is empty).
 * 3. **`672`'s command sweep, live (`704`).** `reopening.ts` tells a reader a Codex command card was
 *    never offered the session grant, *"on 14 shapes"* — `672`'s measurement, of which `697`'s
 *    three arms re-measured ONE (a plain escalated `touch`, on every command turn). ⚑ The `sweep`
 *    arm drives all fourteen on every run and
 *    `sweepVerdict` reads it: `never-offered`. ⚑ Every one of those cards said `once` until `736`;
 *    since R95 each offers Codex's own kept rule, *Always allow*, and says `always` (`738`, measured).
 *
 * ## ⚑ The instrument — `581`'s recipe, through the product's runtime
 *
 * The bundled binary’s `listen(0)` loopback endpoint scripts one code-mode `exec` tool call
 * per marked turn using `tools.exec_command` or `tools.apply_patch`. Each arm owns scratch
 * root, `HOME`, `CODEX_HOME`, `CODEX_SQLITE_HOME`, and cwd. Use no account, token, spend, or
 * `auth.json`; leave personal provider homes, `~/.codex`, and `:9444` untouched and launch no
 * Electron.
 *
 * ⚠️ **The ONE substitution** (`672`'s): the transport answers `getAuthStatus` and `account/read`
 * itself, as an API-key sign-in — a loopback provider has no sign-in, and the product's credential
 * gate would refuse the launch as `absent`. The only other way through is a synthetic `auth.json`,
 * which §6 forbids. Everything else is forwarded to the real app-server.
 *
 * ⚠️ *"This captures what the provider put in its model-bound request, not a hosted model's
 * obedience to the text."* (`581`) — here the model is a script; what is measured is what the
 * app-server ASKS and what the product PUBLISHES.
 *
 * ## ⚑ The arms
 *
 * | arm | turns | what it establishes |
 * |---|---|---|
 * | **control** | `c1` command · `c2` command · `c3` ADD a file (session grant) · `c4` UPDATE it | one app-server: the grant holds (`c4` asks nothing) |
 * | **reopen** | `r1` command · `r2` ADD (session grant) · `r2b` UPDATE · close · resume · `r3` command · `r4` UPDATE | the in-server control (`r2b`), then the subject (`r4`) |
 * | **default** | `d1` command · `d2` UPDATE on a fresh thread | asking is the default the reopen returns to |
 * | **sweep** (`704`) | one turn per shape of {@link SWEEP_SHAPES}, each denied | no command card offers `allow for this session` (`sweepVerdict`); each offers Codex's kept rule, *Always allow*, and says `always` (R95, measured by `738`; `once` until `736`) |
 *
 * ⚑ **738 · R96's re-aim (`736` F-2)**: under `ask` Codex writes inside its own folder (and `/tmp`)
 * with no card, so every PATCH turn — `c3`/`r2` ADD, and each UPDATE after them, `d2`'s included —
 * targets `p697.txt` in the arm's `outside` folder, a sibling of its cwd and outside every temporary
 * folder, where `ask` still asks. ⚠️ The commands stay in the cwd: each is escalated
 * (`require_escalated`), which asks wherever it writes.
 *
 * ⚑ **The sweep is `672`'s, both halves** (`704`): the six escalated entries of its `ZZ672_SHAPES`
 * and the eight its verifier added (arm D) — the 14 shapes `reopening.ts` cites, with each command
 * string as `672` wrote it and the file targets renamed `x704.txt` / `y704.txt` in the arm's cwd.
 * ⛔ **`ZZ672_SHAPES`' two `use_default` entries are left out**, and not by oversight: under this
 * probe's `ask` profile (`on-request`, `read-only` when `704` measured it; `workspace-write` since
 * `736`, R96) a sandboxed command raises NO approval —
 * `672` measured `s-default-sandbox` produce no command item at all and `s-curl` fail with exit 7
 * and no card — so neither can ever put a card in front of the verdict, and listing them would make
 * it `not-performed` on every run. ⚠️ The network-approval shape (`networkApprovalContext`) is not
 * reachable on this profile either (`672`'s NOTPERF), and is not swept.
 *
 * Run: `pnpm run probe:codex-reopen-grant`. Not part of `pnpm run ci`; its verdict logic is held to
 * planted turns in `packages/runtime/test/codex-reopen-grant-evidence.test.ts`.
 */

const MODEL = 'gpt-5.6-luna'
const KEY = 'BROBOT_697_CAPTURE_KEY'

/** ⚠️ Bounded, standing rule 13 — a stalled app-server is NOT PERFORMED, never waited on. */
const OPEN_DEADLINE_MS = 30_000
const TURN_DEADLINE_MS = 30_000
/**
 * ⚑ **704 · the sweep's own per-turn bound, and what makes it reachable** (standing rule 22).
 * `672`'s eight-turn shape sweep — the same bundled app-server, a loopback model scripted the same
 * way, the same `ask` profile, every card denied — took 7.35 s of test time (`run-shapes.log`) for
 * the launch, the eight turns with a 500 ms settle after each, and the close together: under 0.92 s
 * a turn, so this is more than ten times what a sweep turn has taken. ⚠️ A bound on a STALL, not a
 * timing claim — a turn past it is NOT PERFORMED, its arm's `failure`. ⛔ And it is what keeps the
 * derived budget under vitest's twenty-minute `testTimeout` (`scripts/test/smoke-deadlines.test.mjs`
 * lists the files above it): at {@link TURN_DEADLINE_MS} the sweep's turns alone would carry it past.
 */
const SWEEP_TURN_DEADLINE_MS = 10_000
const SETTLE_MS = 500
const EXIT_GRACE_MS = 2_000
const KILL_GRACE_MS = 2_000
const PUMP_MS = 5_000
/**
 * ⚠️ **A session close, not a transport close** (697's review): `closeOwned` goes through
 * `handle.close()`, which drains in-flight work and interrupts a live turn before the transport's
 * own exit and kill graces — `codex-runtime.ts`' `CLOSE_FLUSH_TIMEOUT_MS` and
 * `CLOSE_INTERRUPT_TIMEOUT_MS`, sized here as `codex-live.smoke.ts` sizes the same path.
 */
const CLOSE_FLUSH_MS = 2_000
const CLOSE_INTERRUPT_MS = 2_000
const CLOSE_MS = CLOSE_FLUSH_MS + CLOSE_INTERRUPT_MS + EXIT_GRACE_MS + 2 * KILL_GRACE_MS + PUMP_MS
const TEARDOWN_MS = CLOSE_MS

/**
 * ⚑ **704 · `672`'s escalated command shapes, each command as `672` wrote it** — `s-*` from its
 * `ZZ672_SHAPES`, `d-*` from its verifier's arm D; `x` and `y` are `x704.txt` and `y704.txt` in the
 * sweep arm's cwd. The two `use_default` entries are left out — the docblock says why.
 *
 * ⛔ **Literals and arrow functions only, and nothing imported**: `ARMS` reads these names, the
 * budget reads `ARMS`, and the deadline census evaluates that derivation in a sandbox that refuses
 * any imported value it reaches (`scripts/lib/smoke-deadline-census.mjs`) — so the paths are joined
 * in the sweep arm's script, never here.
 */
type Shape = (at: { readonly x: string; readonly y: string; readonly cwd: string }) => Action
const SWEEP_SHAPES: Readonly<Record<string, Shape>> = {
  's-simple': ({ x }) => ({ kind: 'exec', cmd: `/usr/bin/touch ${x}` }),
  's-and': ({ x, y }) => ({ kind: 'exec', cmd: `/usr/bin/touch ${x} && /usr/bin/touch ${y}` }),
  's-pipe': ({ x }) => ({ kind: 'exec', cmd: `echo hi | /usr/bin/tee ${x}` }),
  's-prefix': ({ x }) => ({
    kind: 'exec',
    cmd: `/usr/bin/touch ${x}`,
    extra: { prefix_rule: ['/usr/bin/touch'] },
  }),
  's-python': ({ x }) => ({ kind: 'exec', cmd: `python3 -c "open('${x}','w').write('a')"` }),
  's-bashc': ({ x }) => ({ kind: 'exec', cmd: `bash -c "touch ${x}"` }),
  'd-heredoc': ({ x }) => ({ kind: 'exec', cmd: `cat > ${x} <<'EOF'\nhi\nEOF` }),
  'd-redirect': ({ x }) => ({ kind: 'exec', cmd: `echo hi > ${x}` }),
  'd-semicolon': ({ x, y }) => ({ kind: 'exec', cmd: `/usr/bin/touch ${x}; /usr/bin/touch ${y}` }),
  'd-subshell': ({ x }) => ({ kind: 'exec', cmd: `(/usr/bin/touch ${x})` }),
  'd-cmdsubst': ({ x }) => ({ kind: 'exec', cmd: `/usr/bin/touch $(echo ${x})` }),
  'd-envassign': ({ x }) => ({ kind: 'exec', cmd: `FOO=1 /usr/bin/touch ${x}` }),
  'd-rm': ({ x }) => ({ kind: 'exec', cmd: `rm -f ${x}` }),
  'd-cd': ({ cwd }) => ({ kind: 'exec', cmd: `cd ${cwd} && /usr/bin/touch x704.txt` }),
}

/**
 * ⛔ The arms, as one table the budget is counted from — see the docblock's. ⚑ Each carries the
 * bound its turns are driven under (`704`), so the drive and the budget read the same number.
 */
const ARMS = {
  control: { opens: 1, turnMs: TURN_DEADLINE_MS, turns: ['c1', 'c2', 'c3', 'c4'] },
  reopen: { opens: 2, turnMs: TURN_DEADLINE_MS, turns: ['r1', 'r2', 'r2b', 'r3', 'r4'] },
  default: { opens: 1, turnMs: TURN_DEADLINE_MS, turns: ['d1', 'd2'] },
  sweep: { opens: 1, turnMs: SWEEP_TURN_DEADLINE_MS, turns: Object.keys(SWEEP_SHAPES) },
} as const
type Arm = keyof typeof ARMS

const deadline = probeRunDeadline(
  '697 codex reopen-grant probe',
  runBudgetMs(
    Object.values(ARMS).flatMap((arm) => [
      ...Array.from({ length: arm.opens }, () => OPEN_DEADLINE_MS + CLOSE_MS),
      ...arm.turns.map(() => arm.turnMs + SETTLE_MS),
    ]),
  ),
  TEARDOWN_MS,
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** ⚑ The product's transport, with the one substitution the header names — and nothing recorded. */
class SignedInAsAKey implements CodexTransport {
  constructor(private readonly inner: SpawnCodexTransport) {}
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
    return this.inner.request(method, params)
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
  incoming(): AsyncIterable<CodexIncoming> {
    return this.inner.incoming()
  }
  close(): void | Promise<void> {
    return this.inner.close()
  }
}

/**
 * ⚑ `extra` (`704`, `672`'s own field) is spread AFTER the three fixed arguments — `s-prefix`'s
 * `prefix_rule`. ⚠️ Last, so it can override `sandbox_permissions`; no shape of
 * {@link SWEEP_SHAPES} does, and one that did would be a `use_default` shape this probe leaves out.
 */
type Action =
  { kind: 'exec'; cmd: string; extra?: Record<string, unknown> } | { kind: 'patch'; patch: string }

function execSource(action: Action): string {
  const call =
    action.kind === 'exec'
      ? `tools.exec_command(${JSON.stringify({
          cmd: action.cmd,
          sandbox_permissions: 'require_escalated',
          justification: '697 probe: needs to write outside the read-only sandbox',
          ...action.extra,
        })})`
      : `tools.apply_patch(${JSON.stringify(action.patch)})`
  return [`const answer = await ${call}`, 'text("B697:" + JSON.stringify(answer))'].join('\n')
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

function lastInputType(body: unknown): string {
  const input = isRecord(body) && Array.isArray(body['input']) ? body['input'] : []
  const last: unknown = input[input.length - 1]
  return isRecord(last) && typeof last['type'] === 'string' ? last['type'] : '(none)'
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

/** ⚑ A scripted model: `697-turn-<name>` in the user text → one tool call, then a closing message. */
function scriptedModel(script: ReadonlyMap<string, Action>): {
  server: Server
  requests: () => number
} {
  let count = 0
  const served = new Set<string>()
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
      const marker = /697-turn-([a-z0-9-]+)/.exec(lastUserText(body))?.[1]
      const action = marker === undefined ? undefined : script.get(marker)
      const answering = /_call_output$/.test(lastInputType(body))
      if (marker !== undefined && action !== undefined && !answering && !served.has(marker)) {
        served.add(marker)
        stream(response, `resp_697_${String(count)}`, {
          type: 'custom_tool_call',
          id: `ctc_697_${String(count)}`,
          call_id: `call_697_${String(count)}`,
          name: 'exec',
          input: execSource(action),
          status: 'completed',
        })
        return
      }
      stream(response, `resp_697_${String(count)}`, {
        type: 'message',
        id: `msg_697_${String(count)}`,
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text: `697 done ${String(count)}`, annotations: [] }],
      })
    })
  })
  return { server, requests: () => count }
}

function providerStanza(port: number): string {
  return [
    `model = "${MODEL}"`,
    'model_provider = "capture"',
    '',
    '[model_providers.capture]',
    'name = "BroBot 697 reopen-grant capture"',
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

const patchAdd = (file: string): string =>
  `*** Begin Patch\n*** Add File: ${file}\n+one\n*** End Patch\n`
const patchUpdate = (file: string, from: string, to: string): string =>
  `*** Begin Patch\n*** Update File: ${file}\n@@\n-${from}\n+${to}\n*** End Patch\n`

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

/** One conversation: its events, the cards it published, and a turn driver that answers them. */
class Conversation {
  readonly events: RuntimeEvent[] = []
  turn = '(none)'
  answer: 'allow_for_session' | 'deny' = 'deny'
  private readonly pump: Promise<void>
  constructor(
    readonly handle: SessionHandle,
    readonly cards: CardSeen[],
    /** ⚑ Its arm's bound on one turn, from `ARMS` — the number the budget counted (`704`). */
    private readonly turnMs: number,
  ) {
    this.pump = (async () => {
      for await (const event of handle.events()) {
        this.events.push(event)
        if (event.type !== 'permission_request') continue
        const offered: readonly PermissionOutcome[] = event.scope.availableDecisions
        // ⚑ The session grant only where it is OFFERED; everything else is refused — a card
        // that is answered cannot hold a turn open.
        const outcome =
          this.answer === 'allow_for_session' && offered.includes('allow_for_session')
            ? 'allow_for_session'
            : 'deny'
        const card: CardSeen = {
          turn: this.turn,
          kind: event.kind,
          availableDecisions: offered,
          persistence: event.scope.persistence,
          amendments: event.scope.amendments.length,
          answer: { outcome, accepted: null },
        }
        cards.push(card)
        // ⚑ Whether the answer was TAKEN is recorded, never swallowed — a grant refused on its way
        // in would otherwise read as one that did not survive the reopen.
        void handle.respondPermission(event.id, { outcome }).then(
          () => (card.answer.accepted = true),
          () => (card.answer.accepted = false),
        )
      }
    })()
  }
  private ended(): number {
    return this.events.filter((event) => event.type === 'turn').length
  }
  async drive(turn: string, answer: 'allow_for_session' | 'deny'): Promise<void> {
    this.turn = turn
    this.answer = answer
    const before = this.ended()
    await bounded(`turn ${turn}`, this.turnMs, async () => {
      await this.handle.send(`697-turn-${turn} please run the scripted action`)
      while (this.ended() <= before) await new Promise((resolve) => setTimeout(resolve, 25))
    })
    // Trailing item reports land after the turn's own ending.
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
  }
  async close(): Promise<void> {
    await this.handle.close()
    await Promise.race([this.pump, new Promise((resolve) => setTimeout(resolve, PUMP_MS).unref())])
  }
}

interface ArmResult {
  readonly arm: Arm
  readonly failure: string | null
  readonly listenedOn: number
  readonly configuredBefore: number | null
  readonly configuredAfter: number | null
  readonly modelRequests: number
  readonly pids: readonly (number | undefined)[]
  readonly firstAliveAfterClose: boolean | null
  readonly files: Record<string, string | null>
}

async function runArm(
  arm: Arm,
  cards: CardSeen[],
  root: string,
  script: (cwd: string, outside: string) => Map<string, Action>,
  drive: (
    open: () => Promise<Conversation>,
    reopen: (ref: SessionHandle['ref']) => Promise<Conversation>,
    cwd: string,
  ) => Promise<{ pids: (number | undefined)[]; firstAliveAfterClose: boolean | null }>,
): Promise<ArmResult> {
  deadline.refuse(`arm ${arm}`)
  const armRoot = mkdtempSync(join(root, `${arm}-`))
  const home = join(armRoot, 'home')
  const cwd = join(armRoot, 'cwd')
  const outside = join(armRoot, 'outside')
  mkdirSync(home, { recursive: true })
  mkdirSync(cwd, { recursive: true })
  mkdirSync(outside, { recursive: true })
  const model = scriptedModel(script(cwd, outside))
  const conversations: Conversation[] = []
  const transports: SignedInAsAKey[] = []
  const closeOwned = async (): Promise<void> => {
    try {
      for (const one of conversations) await one.close().catch(() => {})
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
  let pids: (number | undefined)[] = []
  let firstAliveAfterClose: boolean | null = null
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
    // ⚑ **Rule 40, BEFORE the first child starts** — the port the child will be configured with is
    // the one `listen(0)` returned, read back from the file it reads.
    configuredBefore = configuredPortOf(home)
    if (configuredBefore !== listenedOn) {
      throw new Error(
        `NOT PERFORMED — the config names port ${String(configuredBefore)}, the endpoint is on ${String(listenedOn)}`,
      )
    }
    // ⚑ The product factory's shape — `codexAppServerArgs`, the context's home and cwd — with an
    // explicit env, so the loopback `env_key` reaches the child and `HOME` is this arm's own.
    const factory: TransportFactory = (context) => {
      const transport = new SignedInAsAKey(
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
      )
      transports.push(transport)
      return transport
    }
    const runtime = new CodexRuntime(factory)
    const launched = (handle: SessionHandle): Conversation => {
      const conversation = new Conversation(handle, cards, ARMS[arm].turnMs)
      conversations.push(conversation)
      return conversation
    }
    const open = async (): Promise<Conversation> =>
      launched(
        await bounded(`${arm} start`, OPEN_DEADLINE_MS, (signal) =>
          runtime.start({ cwd, providerHome: home, approvalMode: 'ask', model: MODEL, signal }),
        ),
      )
    const reopen = async (ref: SessionHandle['ref']): Promise<Conversation> => {
      if (ref === null) throw new Error('NOT PERFORMED — the first launch issued no ref to resume')
      return launched(
        await bounded(`${arm} resume`, OPEN_DEADLINE_MS, (signal) =>
          runtime.resume(ref, { providerHome: home, approvalMode: 'ask', model: MODEL, signal }),
        ),
      )
    }
    ;({ pids, firstAliveAfterClose } = await drive(open, reopen, cwd))
    // ⚑ …and AFTER: the launch rewrites `config.toml` (its memory gate) — the child must still be
    // pointed at this endpoint, or every turn above talked to something else.
    configuredAfter = configuredPortOf(home)
    if (configuredAfter !== listenedOn) {
      throw new Error(
        `NOT PERFORMED — after launch the config names port ${String(configuredAfter)}, not ${String(listenedOn)}`,
      )
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  } finally {
    try {
      await closeOwned()
    } finally {
      release()
    }
  }
  const read = (dir: string, name: string): string | null =>
    existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8').trim() : null
  return {
    arm,
    failure,
    listenedOn,
    configuredBefore,
    configuredAfter,
    modelRequests: model.requests(),
    pids,
    firstAliveAfterClose,
    files: { 'x697.txt': read(cwd, 'x697.txt'), 'p697.txt': read(outside, 'p697.txt') },
  }
}

const isAlive = (pid: number | undefined): boolean | null => {
  if (pid === undefined) return null
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function measureAndCheck(): Promise<void> {
  deadline.refuse('starting')
  const scratch = runScratch('codex-reopen-grant')
  mkdirSync(scratch, { recursive: true })
  const root = mkdtempSync(join(scratch, 'run-'))
  const cards: CardSeen[] = []
  const touch = (cwd: string): Action => ({
    kind: 'exec',
    cmd: `/usr/bin/touch ${join(cwd, 'x697.txt')}`,
  })
  const results: ArmResult[] = []

  results.push(
    await runArm(
      'control',
      cards,
      root,
      (cwd, outside) =>
        new Map<string, Action>([
          ['c1', touch(cwd)],
          ['c2', touch(cwd)],
          ['c3', { kind: 'patch', patch: patchAdd(join(outside, 'p697.txt')) }],
          ['c4', { kind: 'patch', patch: patchUpdate(join(outside, 'p697.txt'), 'one', 'two') }],
        ]),
      async (open) => {
        const one = await open()
        await one.drive('c1', 'allow_for_session')
        await one.drive('c2', 'deny')
        await one.drive('c3', 'allow_for_session')
        await one.drive('c4', 'deny')
        return { pids: [one.handle.providerPid], firstAliveAfterClose: null }
      },
    ),
  )

  results.push(
    await runArm(
      'reopen',
      cards,
      root,
      (cwd, outside) =>
        new Map<string, Action>([
          ['r1', touch(cwd)],
          ['r2', { kind: 'patch', patch: patchAdd(join(outside, 'p697.txt')) }],
          ['r2b', { kind: 'patch', patch: patchUpdate(join(outside, 'p697.txt'), 'one', 'two') }],
          ['r3', touch(cwd)],
          ['r4', { kind: 'patch', patch: patchUpdate(join(outside, 'p697.txt'), 'two', 'three') }],
        ]),
      async (open, reopen) => {
        const first = await open()
        const pidA = first.handle.providerPid
        await first.drive('r1', 'allow_for_session')
        await first.drive('r2', 'allow_for_session')
        // ⚑ The in-server control: the grant is demonstrably live in THIS app-server before the close.
        await first.drive('r2b', 'deny')
        // ⚑ The product's close, then the product's resume on a NEW app-server.
        await first.close()
        const firstAliveAfterClose = isAlive(pidA)
        const second = await reopen(first.handle.ref)
        await second.drive('r3', 'deny')
        await second.drive('r4', 'deny')
        return { pids: [pidA, second.handle.providerPid], firstAliveAfterClose }
      },
    ),
  )

  results.push(
    await runArm(
      'default',
      cards,
      root,
      (cwd, outside) => {
        writeFileSync(join(outside, 'p697.txt'), 'one\n') // so the UPDATE has something to change
        return new Map<string, Action>([
          ['d1', touch(cwd)],
          ['d2', { kind: 'patch', patch: patchUpdate(join(outside, 'p697.txt'), 'one', 'two') }],
        ])
      },
      async (open) => {
        const one = await open()
        await one.drive('d1', 'deny')
        await one.drive('d2', 'deny')
        return { pids: [one.handle.providerPid], firstAliveAfterClose: null }
      },
    ),
  )

  // ⚑ **704 · `672`'s command sweep** — one fresh thread, one shape a turn, every card refused.
  results.push(
    await runArm(
      'sweep',
      cards,
      root,
      (cwd) => {
        const at = { x: join(cwd, 'x704.txt'), y: join(cwd, 'y704.txt'), cwd }
        return new Map<string, Action>(
          Object.entries(SWEEP_SHAPES).map(([name, shape]) => [name, shape(at)]),
        )
      },
      async (open) => {
        const one = await open()
        for (const name of ARMS.sweep.turns) await one.drive(name, 'deny')
        return { pids: [one.handle.providerPid], firstAliveAfterClose: null }
      },
    ),
  )

  const verdict = reopenVerdict(cards, { grant: 'r2', control: 'r2b', reopened: 'r4' })
  const sweep = sweepVerdict(cards, ARMS.sweep.turns)
  const overpromise = cardsThatOverpromise(cards)
  // ⚠️ Bounded, on its own home, and never able to lose the evidence below (697's review).
  let codexVersion: string
  try {
    codexVersion = execFileSync(bundledCodexBinary(), ['--version'], {
      encoding: 'utf8',
      timeout: 10_000,
      env: { PATH: process.env['PATH'] ?? '', HOME: root, CODEX_HOME: join(root, 'version-home') },
    }).trim()
  } catch (error) {
    codexVersion = `unknown — ${error instanceof Error ? error.message : String(error)}`
  }
  writeFileSync(
    runEvidence('697-codex-reopen-grant.json'),
    JSON.stringify({ codexVersion, results, cards, verdict, sweep, overpromise }, null, 1),
  )
  console.log(
    `697 codex reopen-grant · ${codexVersion} · ${JSON.stringify({ verdict, sweep, overpromise, results }, null, 1)}`,
  )

  // ⛔ **Every arm MEASURED, or the run says which was not** — a silent arm is a green run.
  for (const one of results) expect(one.failure, `arm ${one.arm}`).toBeNull()
  // ⚑ The premises the verdict rests on: each arm's model was reached, the reopen really was a new
  // app-server, and the first one was gone.
  for (const one of results) expect(one.modelRequests, `arm ${one.arm}`).toBeGreaterThan(0)
  const reopened = results.find((one) => one.arm === 'reopen')
  expect(reopened?.pids[0]).not.toBe(reopened?.pids[1])
  expect(reopened?.firstAliveAfterClose).toBe(false)
  // ⚑ The two controls: one app-server keeps its grant (`c4`), and a fresh thread asks (`d2`).
  expect(results.find((one) => one.arm === 'control')?.files['p697.txt']).toBe('two')
  expect(cards.filter((card) => card.turn === 'd2' && card.kind === 'file')).toHaveLength(1)
  // 🔴 The subject — measured as `672` found it; a changed provider is a red run here on purpose,
  // because `reopening.ts` tells a person this sentence and it would then be false.
  expect(verdict).toEqual({ verdict: 'forgotten' })
  expect(reopened?.files['p697.txt']).toBe('two') // r4 was asked, and refused
  // 🔴 `672` F1, live: no card promises a persistence its buttons cannot grant — as a consistency
  // check over every card, AND in literal values where `main` and `697` differ, so a wrong
  // `persistenceOf` cannot agree with itself here.
  expect(overpromise).toEqual([])
  // ⚑ The premise the command half rests on: the server PROPOSED an amendment on a card that
  // offers no session accept — the exact shape `main` called `session`.
  const proposed = cards.filter(
    (card) =>
      card.kind === 'command' &&
      card.amendments > 0 &&
      !card.availableDecisions.includes('allow_for_session'),
  )
  expect(proposed.length).toBeGreaterThan(0)
  // 🔴 **738 · R95 (`736`) — the amendment Codex OFFERS is now a button, *Always allow*, and the card
  // says `always`** (`persistenceOf`): measured here on every proposed card, where `697` measured
  // `once`. ⚑ Still in literal values, and still never `session` — the `672` F1 shape — so a wrong
  // `persistenceOf` cannot agree with itself here.
  expect(proposed.map((card) => card.availableDecisions.includes('allow_always'))).toEqual(
    proposed.map(() => true),
  )
  expect(proposed.map((card) => card.persistence)).toEqual(proposed.map(() => 'always'))
  // ⚑ …and the other direction: a file card offering the session accept says `session`.
  const sessionFiles = cards.filter(
    (card) => card.kind === 'file' && card.availableDecisions.includes('allow_for_session'),
  )
  expect(sessionFiles.length).toBeGreaterThan(0)
  expect(sessionFiles.map((card) => card.persistence)).toEqual(sessionFiles.map(() => 'session'))
  // 🔴 **704 · `672`'s command sweep, re-measured** — `reopening.ts` tells a reader a Codex command
  // card was never offered the session grant on these shapes; a changed provider is a red run here
  // on purpose, for the same reason as the reopen verdict above.
  expect(sweep).toEqual({ verdict: 'never-offered' })
  // ⚑ …and in literal values, so a wrong `persistenceOf` cannot agree with itself on them.
  const sweepCards = cards.filter(
    (card) => card.kind === 'command' && ARMS.sweep.turns.includes(card.turn),
  )
  // ⚑ 738 · R95 (`736`): every sweep shape is offered Codex's own kept rule — *Always allow* — and
  // says `always`, measured on all 14 where `704` measured `once`; never `session`, the sweep's
  // subject above.
  expect(sweepCards).toHaveLength(ARMS.sweep.turns.length)
  expect(sweepCards.map((card) => card.availableDecisions.includes('allow_always'))).toEqual(
    sweepCards.map(() => true),
  )
  expect(sweepCards.map((card) => card.persistence)).toEqual(sweepCards.map(() => 'always'))
  // ⚑ Its live control, the same collector in the same run: a session grant IS visible to it where
  // the server offers one — the file cards on `c3` and `r2` — so `never-offered` is a reading of
  // the sweep's cards, not a collector blind to the button.
  expect(sessionFiles.map((card) => card.turn)).toEqual(expect.arrayContaining(['c3', 'r2']))
  // ⚠️ Only a run whose every arm was measured deletes its root (`649` F6).
  rmSync(root, { recursive: true, force: true })
}

it(
  '697 · a Codex session grant across a reopen, and what each card says it grants',
  () => deadline.within('measuring the four arms', measureAndCheck),
  deadline.testTimeoutMs,
)
