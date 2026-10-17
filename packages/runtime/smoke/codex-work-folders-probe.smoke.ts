import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { expect, it } from 'vitest'
// 🔒 **A deep import, and deliberately** — `codex-reopen-grant-probe.smoke.ts`'s reason: this probe
// owns its spawn so it can put the loopback provider's `env_key` in the child environment, which
// `createSpawnTransportFactory` sanitizes away. ⚑ Everything else is the PRODUCT's door:
// `CodexRuntime.start` → `setWorkFolders` → `send` → `respondPermission` → `close` →
// `CodexRuntime.resume`.
import {
  SpawnCodexTransport,
  type CodexIncoming,
  type CodexTransport,
} from '../src/codex/codex-transport'
import { CodexRuntime, codexAppServerArgs, type TransportFactory } from '../src/codex/codex-runtime'
import { CODEX_PROTOCOL_VERSION } from '../src/codex/protocol-version'
import type { RuntimeEvent } from '../src/events'
import type { PermissionOutcome } from '../src/permission'
import type { SessionHandle } from '../src/runtime'
import { bundledCodexBinary } from './bundled-codex'
import {
  addedMessages,
  excerptsAround,
  inputOf,
  lastInputType,
  newestMarker,
  rootMentions,
  toolOutputsOf,
  writableRootsOf,
} from './codex-work-folders-evidence'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

/**
 * 🔴 **W4.189 · shipping gate 1 — a Codex conversation given a work folder writes there without
 * asking, and only there, and the grant comes and goes with `setWorkFolders`.**
 *
 * ## ⛔ The question
 *
 * BroBot gives an existing Codex conversation extra *work folders* without moving its cwd:
 * `SessionHandle.setWorkFolders(list)` (next-turn) and `ProviderRuntimeContext.workFolders` (start
 * and resume). In `ask` (`workspace-write`) the adapter sends them as extra `writableRoots` on every
 * `turn/start` (`sandboxPolicyOf`, `askBaselineOf`) and as `sandbox_workspace_write.writable_roots`
 * on `thread/start` / `thread/resume` (`threadConfigOverlay`). This measures that the provider
 * HONOURS it: no card in a granted folder, a card in any other, and the grant's removal reaching
 * Codex although the server echoes the roots back.
 *
 * ## ⚑ The instrument — `581`'s recipe, through the product's runtime
 *
 * The BUNDLED binary; a loopback Responses endpoint on `listen(0)` scripting one code-mode `exec`
 * call per marked turn (`tools.apply_patch` / `tools.exec_command`, the default sandbox — never
 * escalated); one root under this run's scratch holding `home/` (`CODEX_HOME`, `CODEX_SQLITE_HOME`),
 * `cwd/`, and the two sibling folders `A/` (granted) and `B/` (never granted). `HOME` is the root.
 * ⛔ No model account, no token, no spend, no `auth.json`: nothing here touches `provider-homes/`,
 * `~/.codex` or `~/.claude`, and it launches no Electron. ⚠️ **The ONE substitution** (`672`'s): the
 * transport answers `getAuthStatus` and `account/read` itself, as an API-key sign-in. Every card is
 * DENIED, and recorded.
 *
 * ## ⚑ The arms
 *
 * | arm | launch | turns | what it establishes |
 * |---|---|---|---|
 * | control | started | `before` — patch in `A/` | `A/` asks before any grant |
 * | **1** | started | `setWorkFolders([A])` · `grant-patch` · `grant-shell` | no card, both files written |
 * | **2** | started | `other-patch` · `other-shell` | a file card for `B/`, denied, nothing written; the shell write fails with no card |
 * | **3** | started | `setWorkFolders([])` · `removed-patch` · `removed-shell` | `A/` asks again: the removal reached Codex |
 * | **4** | started → resumed | `setWorkFolders([A])` · `regrant-patch` · close · resume with `[A]` on a new app-server · `resumed-patch` · `resumed-other` | the grant rides the resume; `B/` still asks |
 * | **5** | resumed | — | the `thread/resume` response's sandbox lists `A` |
 * | evidence | resumed-bare | resume with NO work folders · `bare-patch` | what a reopen without the grant does (recorded, not asserted) |
 * | evidence | resumed-bare | `setWorkFolders([L])` (`L` a symlink to `C`) · `link-patch` · `setWorkFolders([])` · `unlink-patch` | whether a root granted through a symlink comes back re-spelled, and is still removed (recorded, not asserted) |
 *
 * ⚑ And, recorded and not asserted: what the model-bound requests TELL the model when the roots
 * change — every message Codex added between two requests, and whether it names `A`.
 *
 * *"This captures what the provider put in its model-bound request, not a hosted model's obedience
 * to the text."* (`581`)
 */

const MODEL = 'gpt-5.6-luna'
const KEY = 'BROBOT_W4189_CAPTURE_KEY'
const MARKER = /w189-turn-([a-z0-9-]+)/
const CALL_ID = 'call_w189_'

/** ⚠️ Bounded, standing rule 13 — a stalled app-server is NOT PERFORMED, never waited on. */
const OPEN_DEADLINE_MS = 30_000
/** ⚑ The scripted model answers at once; `697`'s turns of this shape end in about a second. */
const TURN_DEADLINE_MS = 30_000
const SETTLE_MS = 500
const EXIT_GRACE_MS = 2_000
const KILL_GRACE_MS = 2_000
const PUMP_MS = 5_000
/** ⚠️ A session close (`codex-reopen-grant-probe.smoke.ts`'s sizing): flush, interrupt, exit, kill. */
const CLOSE_FLUSH_MS = 2_000
const CLOSE_INTERRUPT_MS = 2_000
const CLOSE_MS = CLOSE_FLUSH_MS + CLOSE_INTERRUPT_MS + EXIT_GRACE_MS + 2 * KILL_GRACE_MS + PUMP_MS
const TEARDOWN_MS = CLOSE_MS

/**
 * ⛔ The launches, as one table the budget is counted from. ⚠️ Literals only: the deadline census
 * evaluates this derivation in a sandbox that refuses any imported value it reaches.
 */
const LAUNCHES = {
  started: {
    turns: [
      'before',
      'grant-patch',
      'grant-shell',
      'other-patch',
      'other-shell',
      'removed-patch',
      'removed-shell',
      'regrant-patch',
    ],
  },
  resumed: { turns: ['resumed-patch', 'resumed-other'] },
  'resumed-bare': { turns: ['bare-patch', 'link-patch', 'unlink-patch'] },
} as const
type Launch = keyof typeof LAUNCHES

const deadline = probeRunDeadline(
  'W4.189 codex work-folders probe',
  runBudgetMs(
    Object.values(LAUNCHES).flatMap((launch) => [
      OPEN_DEADLINE_MS + CLOSE_MS,
      ...launch.turns.map(() => TURN_DEADLINE_MS + SETTLE_MS),
    ]),
  ),
  TEARDOWN_MS,
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const clip = (text: unknown, max = 2_000): string => {
  const whole = typeof text === 'string' ? text : (JSON.stringify(text) ?? '')
  return whole.length <= max
    ? whole
    : `${whole.slice(0, max)}… (${String(whole.length - max)} more)`
}

/** One frame of the app-server traffic this probe cares about, tagged with the turn it fell in. */
interface WireEntry {
  readonly seq: number
  readonly launch: Launch
  readonly turn: string
  readonly what: string
  /** The `writableRoots` of the sandbox the frame carries, when it carries a `workspaceWrite` one. */
  readonly roots?: readonly string[] | null
  readonly detail?: unknown
}

/**
 * ⚑ The product's transport, with `672`'s one substitution, recording the sandbox every
 * `thread/*` and `turn/start` request and response carries, every `thread/settings/updated` echo,
 * every command and file change Codex reports finishing, and every request the server makes.
 */
class Recorded implements CodexTransport {
  constructor(
    private readonly inner: SpawnCodexTransport,
    private readonly launch: Launch,
    private readonly wire: WireEntry[],
    private readonly turnNow: () => string,
  ) {}
  get pid(): number | undefined {
    return this.inner.pid
  }
  private note(what: string, extra: { roots?: readonly string[] | null; detail?: unknown }): void {
    this.wire.push({
      seq: this.wire.length,
      launch: this.launch,
      turn: this.turnNow(),
      what,
      ...extra,
    })
  }
  async request(method: string, params: unknown): Promise<unknown> {
    if (method === 'getAuthStatus') {
      return { authMethod: 'apikey', authToken: null, requiresOpenaiAuth: false }
    }
    if (method === 'account/read') {
      return { account: { type: 'apiKey' }, requiresOpenaiAuth: false }
    }
    const sent = isRecord(params) ? params : {}
    if (method === 'thread/start' || method === 'thread/resume') {
      this.note(`request ${method}`, {
        detail: { sandbox: sent['sandbox'], config: sent['config'] },
      })
    }
    if (method === 'turn/start') {
      this.note('request turn/start', {
        roots: writableRootsOf(sent['sandboxPolicy']),
        detail: sent['sandboxPolicy'],
      })
    }
    const result = await Promise.resolve(this.inner.request(method, params))
    const answered = isRecord(result) ? result : {}
    if (method === 'initialize') {
      this.note('response initialize', { detail: { userAgent: answered['userAgent'] } })
    }
    if (method === 'thread/start' || method === 'thread/resume') {
      this.note(`response ${method}`, {
        roots: writableRootsOf(answered['sandbox']),
        detail: answered['sandbox'],
      })
    }
    return result
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
      const params = isRecord(frame.params) ? frame.params : {}
      if (frame.kind === 'request') {
        this.note(`server-request ${frame.method}`, {
          detail: {
            reason: params['reason'],
            changes: params['changes'],
            command: params['command'],
          },
        })
      } else if (frame.method === 'thread/settings/updated') {
        const settings = isRecord(params['threadSettings']) ? params['threadSettings'] : {}
        this.note('notification thread/settings/updated', {
          roots: writableRootsOf(settings['sandboxPolicy']),
          detail: settings['sandboxPolicy'],
        })
      } else if (frame.method === 'item/completed') {
        const item = isRecord(params['item']) ? params['item'] : {}
        if (item['type'] === 'commandExecution' || item['type'] === 'fileChange') {
          const changes = Array.isArray(item['changes']) ? item['changes'] : []
          this.note(`item/completed ${String(item['type'])}`, {
            detail: {
              status: item['status'],
              exitCode: item['exitCode'],
              command: item['command'],
              output: clip(item['aggregatedOutput'], 600),
              paths: changes.map((change: unknown) => (isRecord(change) ? change['path'] : null)),
            },
          })
        }
      }
      yield frame
    }
  }
  close(): void | Promise<void> {
    return this.inner.close()
  }
}

type Action = { kind: 'exec'; cmd: string } | { kind: 'patch'; patch: string }

/**
 * ⚑ Codex's code-mode gesture: one `exec` whose source calls the tool and hands back what it
 * answered — a refusal included, so the next request carries it either way. ⚠️ The command runs
 * in the DEFAULT sandbox: no `sandbox_permissions`, so it never asks — which is the point.
 */
function execSource(action: Action): string {
  const call =
    action.kind === 'exec'
      ? `tools.exec_command(${JSON.stringify({ cmd: action.cmd })})`
      : `tools.apply_patch(${JSON.stringify(action.patch)})`
  return [
    'let answer',
    `try { answer = await ${call} } catch (error) { answer = { thrown: String(error) } }`,
    'text("W189:" + JSON.stringify(answer))',
  ].join('\n')
}

const patchAdd = (file: string): string =>
  `*** Begin Patch\n*** Add File: ${file}\n+one\n*** End Patch\n`

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

interface ModelRequest {
  readonly n: number
  readonly marker: string | undefined
  readonly body: unknown
}

/**
 * ⚑ A scripted model: the newest `w189-turn-<name>` a user message names → one tool call, once;
 * everything else → a closing message. Keeps every request it was sent, and which call it made
 * for which turn.
 */
function scriptedModel(script: ReadonlyMap<string, Action>): {
  server: Server
  requests: ModelRequest[]
  calls: Map<string, string>
} {
  const requests: ModelRequest[] = []
  const calls = new Map<string, string>()
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const n = requests.length + 1
      let body: unknown
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        body = null
      }
      const marker = newestMarker(body, MARKER)
      requests.push({ n, marker, body })
      const action = marker === undefined ? undefined : script.get(marker)
      const answering = /_call_output$/.test(lastInputType(body))
      if (marker !== undefined && action !== undefined && !answering && !calls.has(marker)) {
        const callId = `${CALL_ID}${String(n)}`
        calls.set(marker, callId)
        stream(response, `resp_w189_${String(n)}`, {
          type: 'custom_tool_call',
          id: `ctc_w189_${String(n)}`,
          call_id: callId,
          name: 'exec',
          input: execSource(action),
          status: 'completed',
        })
        return
      }
      stream(response, `resp_w189_${String(n)}`, {
        type: 'message',
        id: `msg_w189_${String(n)}`,
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text: `w189 done ${String(n)}`, annotations: [] }],
      })
    })
  })
  return { server, requests, calls }
}

function providerStanza(port: number): string {
  return [
    `model = "${MODEL}"`,
    'model_provider = "capture"',
    '',
    '[model_providers.capture]',
    'name = "BroBot W4.189 work-folders capture"',
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

/** One card the product published, as the rig saw it, and whether the denial was TAKEN. */
interface CardSeen {
  readonly launch: Launch
  readonly turn: string
  readonly kind: string
  readonly action: string
  readonly detail: string
  readonly availableDecisions: readonly PermissionOutcome[]
  readonly persistence: string
  accepted: boolean | null
}

/** One launch's conversation: its events, the cards it published, and a turn driver. */
class Conversation {
  readonly events: RuntimeEvent[] = []
  readonly endings: { turn: string; state: string | null }[] = []
  private readonly pump: Promise<void>
  constructor(
    readonly handle: SessionHandle,
    readonly launch: Launch,
    private readonly now: { turn: string },
    cards: CardSeen[],
  ) {
    this.pump = (async () => {
      for await (const event of handle.events()) {
        this.events.push(event)
        if (event.type !== 'permission_request') continue
        const card: CardSeen = {
          launch,
          turn: now.turn,
          kind: event.kind,
          action: event.action,
          detail: clip(event.detail, 1_000),
          availableDecisions: event.scope.availableDecisions,
          persistence: event.scope.persistence,
          accepted: null,
        }
        cards.push(card)
        // ⚑ Every card is refused, and whether the refusal was TAKEN is recorded — a card that is
        // answered cannot hold a turn open.
        void handle.respondPermission(event.id, { outcome: 'deny' }).then(
          () => (card.accepted = true),
          () => (card.accepted = false),
        )
      }
    })()
  }
  private turnEvents(): RuntimeEvent[] {
    return this.events.filter((event) => event.type === 'turn')
  }
  async drive(turn: string): Promise<void> {
    this.now.turn = turn
    const before = this.turnEvents().length
    await bounded(`turn ${turn}`, TURN_DEADLINE_MS, async (signal) => {
      await this.handle.send(`w189-turn-${turn} please run the scripted action`)
      while (this.turnEvents().length <= before && !signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
    })
    const ended = this.turnEvents()[before]
    this.endings.push({ turn, state: ended?.type === 'turn' ? ended.state : null })
    // Trailing item reports land after the turn's own ending.
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
  }
  async close(): Promise<void> {
    await this.handle.close()
    await Promise.race([this.pump, new Promise((resolve) => setTimeout(resolve, PUMP_MS).unref())])
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
  const scratch = runScratch('codex-work-folders')
  mkdirSync(scratch, { recursive: true })
  const root = mkdtempSync(join(scratch, 'run-'))
  const home = join(root, 'home')
  const cwd = join(root, 'cwd')
  const A = join(root, 'A')
  const B = join(root, 'B')
  /** ⚑ A folder reached through a symlink: `L` → `C`, granted as `L`. */
  const C = join(root, 'C')
  const L = join(root, 'L')
  for (const dir of [home, cwd, A, B, C]) mkdirSync(dir, { recursive: true })
  symlinkSync(C, L)

  const script = new Map<string, Action>([
    ['before', { kind: 'patch', patch: patchAdd(join(A, 'before.txt')) }],
    ['grant-patch', { kind: 'patch', patch: patchAdd(join(A, 'granted.txt')) }],
    ['grant-shell', { kind: 'exec', cmd: `echo shell > ${join(A, 'shell.txt')}` }],
    ['other-patch', { kind: 'patch', patch: patchAdd(join(B, 'other.txt')) }],
    ['other-shell', { kind: 'exec', cmd: `echo shell > ${join(B, 'shell.txt')}` }],
    ['removed-patch', { kind: 'patch', patch: patchAdd(join(A, 'removed.txt')) }],
    ['removed-shell', { kind: 'exec', cmd: `echo shell > ${join(A, 'removed-shell.txt')}` }],
    ['regrant-patch', { kind: 'patch', patch: patchAdd(join(A, 'regranted.txt')) }],
    ['resumed-patch', { kind: 'patch', patch: patchAdd(join(A, 'resumed.txt')) }],
    ['resumed-other', { kind: 'patch', patch: patchAdd(join(B, 'resumed-other.txt')) }],
    ['bare-patch', { kind: 'patch', patch: patchAdd(join(A, 'bare.txt')) }],
    ['link-patch', { kind: 'patch', patch: patchAdd(join(L, 'link.txt')) }],
    ['unlink-patch', { kind: 'patch', patch: patchAdd(join(L, 'unlink.txt')) }],
  ])
  const model = scriptedModel(script)
  const cards: CardSeen[] = []
  const wire: WireEntry[] = []
  const now = { turn: '(opening)' }
  const conversations: Conversation[] = []
  const transports: Recorded[] = []
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
  const pids: Partial<Record<Launch, number | undefined>> = {}
  let startedAliveAfterClose: boolean | null = null
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
    // ⚑ Rule 40, BEFORE the first child starts.
    configuredBefore = configuredPortOf(home)
    if (configuredBefore !== listenedOn) {
      throw new Error(
        `NOT PERFORMED — the config names port ${String(configuredBefore)}, the endpoint is on ${String(listenedOn)}`,
      )
    }
    let launching: Launch = 'started'
    // ⚑ The product factory's shape — `codexAppServerArgs`, the context's home and cwd — with an
    // explicit env, so the loopback `env_key` reaches the child and `HOME` is this run's own.
    const factory: TransportFactory = (context) => {
      const transport = new Recorded(
        new SpawnCodexTransport(bundledCodexBinary(), codexAppServerArgs(), {
          cwd: context.cwd,
          env: {
            PATH: process.env['PATH'] ?? '',
            HOME: root,
            CODEX_HOME: context.providerHome,
            CODEX_SQLITE_HOME: context.providerHome,
            [KEY]: 'probe-only',
          },
          exitGraceMs: EXIT_GRACE_MS,
          killGraceMs: KILL_GRACE_MS,
        }),
        launching,
        wire,
        () => now.turn,
      )
      transports.push(transport)
      return transport
    }
    const runtime = new CodexRuntime(factory)
    const launched = (handle: SessionHandle, launch: Launch): Conversation => {
      const conversation = new Conversation(handle, launch, now, cards)
      conversations.push(conversation)
      pids[launch] = handle.providerPid
      return conversation
    }

    // ── The started launch: control, arms 1–3, and arm 4's first half ──────────────────────
    now.turn = '(opening started)'
    const first = launched(
      await bounded('start', OPEN_DEADLINE_MS, (signal) =>
        runtime.start({ cwd, providerHome: home, approvalMode: 'ask', model: MODEL, signal }),
      ),
      'started',
    )
    await first.drive('before')
    first.handle.setWorkFolders([A])
    await first.drive('grant-patch')
    await first.drive('grant-shell')
    await first.drive('other-patch')
    await first.drive('other-shell')
    first.handle.setWorkFolders([])
    await first.drive('removed-patch')
    await first.drive('removed-shell')
    first.handle.setWorkFolders([A])
    await first.drive('regrant-patch')
    const ref = first.handle.ref
    await first.close()
    startedAliveAfterClose = isAlive(pids.started)
    if (ref === null) throw new Error('NOT PERFORMED — the start issued no ref to resume')

    // ── Arm 4's second half and arm 5: a NEW app-server, resumed with the grant ─────────────
    launching = 'resumed'
    now.turn = '(opening resumed)'
    const second = launched(
      await bounded('resume', OPEN_DEADLINE_MS, (signal) =>
        runtime.resume(ref, {
          providerHome: home,
          approvalMode: 'ask',
          model: MODEL,
          workFolders: [A],
          signal,
        }),
      ),
      'resumed',
    )
    await second.drive('resumed-patch')
    await second.drive('resumed-other')
    await second.close()

    // ── Evidence only: a reopen WITHOUT the grant ───────────────────────────────────────────
    launching = 'resumed-bare'
    now.turn = '(opening resumed-bare)'
    const third = launched(
      await bounded('bare resume', OPEN_DEADLINE_MS, (signal) =>
        runtime.resume(ref, { providerHome: home, approvalMode: 'ask', model: MODEL, signal }),
      ),
      'resumed-bare',
    )
    await third.drive('bare-patch')
    // ⚠️ `askBaselineOf` matches roots AS SPELLED: a folder granted through a symlink whose echo came
    // back resolved would stay on after its removal. Measured here, not asserted.
    third.handle.setWorkFolders([L])
    await third.drive('link-patch')
    third.handle.setWorkFolders([])
    await third.drive('unlink-patch')
    await third.close()
    now.turn = '(closed)'

    // ⚑ …and AFTER: the launch rewrites `config.toml` (its memory gate) — the child must still be
    // pointed at this endpoint, or every turn above talked to something else.
    configuredAfter = configuredPortOf(home)
    if (configuredAfter !== listenedOn) {
      throw new Error(
        `NOT PERFORMED — after launch the config names port ${String(configuredAfter)}, not ${String(listenedOn)}`,
      )
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

  // ── Reading ─────────────────────────────────────────────────────────────────────────────────
  const files: Record<string, boolean> = {}
  for (const [dir, label] of [
    [A, 'A'],
    [B, 'B'],
    [C, 'C'],
  ] as const) {
    for (const name of [
      'before.txt',
      'granted.txt',
      'shell.txt',
      'other.txt',
      'removed.txt',
      'removed-shell.txt',
      'regranted.txt',
      'resumed.txt',
      'resumed-other.txt',
      'bare.txt',
      'link.txt',
      'unlink.txt',
    ]) {
      if (existsSync(join(dir, name))) files[`${label}/${name}`] = true
    }
  }
  const exists = (path: string): boolean => files[path] === true
  const cardsOn = (turn: string, kind?: string): CardSeen[] =>
    cards.filter((card) => card.turn === turn && (kind === undefined || card.kind === kind))
  const lastRequest = model.requests[model.requests.length - 1]?.body
  const outputs = toolOutputsOf(lastRequest)
  const toolOutput = (turn: string): string | null => {
    const call = model.calls.get(turn)
    return call === undefined ? null : clip(outputs[call] ?? null, 1_500)
  }
  const turnStartRoots = (turn: string): readonly string[] | null | undefined =>
    wire.find((entry) => entry.what === 'request turn/start' && entry.turn === turn)?.roots
  const resumeResponse = wire.find(
    (entry) => entry.launch === 'resumed' && entry.what === 'response thread/resume',
  )
  const resumeRequest = wire.find(
    (entry) => entry.launch === 'resumed' && entry.what === 'request thread/resume',
  )
  const bareResumeResponse = wire.find(
    (entry) => entry.launch === 'resumed-bare' && entry.what === 'response thread/resume',
  )
  const endings = conversations.flatMap((one) => one.endings)

  // ⚑ What the model was TOLD: every message Codex added between two requests, with the tags it
  // carries and whether it names `A` or `B`. ⚠️ The person's message is our marker and names neither.
  const told = model.requests.map((request, at) => {
    const added = addedMessages(at === 0 ? null : model.requests[at - 1]?.body, request.body)
    return {
      request: request.n,
      marker: request.marker ?? null,
      added: added.map((item) => ({
        role: item.role,
        ...rootMentions(item.text, A),
        namesB: item.text.includes(B),
        text: clip(item.text, 6_000),
      })),
    }
  })
  /** The first request a turn's marker reached — where a context update for it would ride. */
  const firstRequestOf = (turn: string): number | null =>
    model.requests.find((request) => request.marker === turn)?.n ?? null
  const toldAt = (turn: string): (typeof told)[number] | null => {
    const n = firstRequestOf(turn)
    return n === null ? null : (told.find((one) => one.request === n) ?? null)
  }
  /** Every place a MESSAGE of each request names `A` — tool calls and outputs left out. */
  const namingA = model.requests.map((request) => ({
    request: request.n,
    marker: request.marker ?? null,
    excerpts: excerptsAround(
      JSON.stringify(
        inputOf(request.body).filter((item) => isRecord(item) && item['type'] === 'message'),
      ),
      A,
      300,
    ),
  }))
  const userAgent = wire.find((entry) => entry.what === 'response initialize')?.detail

  const checks = {
    performed: failure,
    'control · before: A asks before any grant': {
      fileCards: cardsOn('before', 'file').length,
      written: exists('A/before.txt'),
    },
    'arm 1 · grant-patch: no card, written': {
      cards: cardsOn('grant-patch').length,
      written: exists('A/granted.txt'),
      turnStartRoots: turnStartRoots('grant-patch'),
    },
    'arm 1 · grant-shell: no card, written': {
      cards: cardsOn('grant-shell').length,
      written: exists('A/shell.txt'),
      output: toolOutput('grant-shell'),
    },
    'arm 2 · other-patch: a file card, denied, nothing written': {
      fileCards: cardsOn('other-patch', 'file').length,
      written: exists('B/other.txt'),
    },
    'arm 2 · other-shell: fails with no card': {
      cards: cardsOn('other-shell').length,
      written: exists('B/shell.txt'),
      output: toolOutput('other-shell'),
    },
    'arm 3 · removed-patch: a card again': {
      fileCards: cardsOn('removed-patch', 'file').length,
      written: exists('A/removed.txt'),
      turnStartRoots: turnStartRoots('removed-patch'),
    },
    'arm 3 · removed-shell: fails with no card': {
      cards: cardsOn('removed-shell').length,
      written: exists('A/removed-shell.txt'),
      output: toolOutput('removed-shell'),
    },
    'arm 4 · regrant-patch (before the close): no card, written': {
      cards: cardsOn('regrant-patch').length,
      written: exists('A/regranted.txt'),
    },
    'arm 4 · a new app-server': {
      pids: { started: pids.started ?? null, resumed: pids.resumed ?? null },
      startedAliveAfterClose,
    },
    'arm 4 · resumed-patch: no card, written': {
      cards: cardsOn('resumed-patch').length,
      written: exists('A/resumed.txt'),
    },
    'arm 4 · resumed-other: a file card, nothing written': {
      fileCards: cardsOn('resumed-other', 'file').length,
      written: exists('B/resumed-other.txt'),
    },
    'arm 5 · thread/resume': {
      requestConfig: isRecord(resumeRequest?.detail) ? resumeRequest.detail['config'] : null,
      responseRoots: resumeResponse?.roots ?? null,
    },
    'evidence · bare resume (no work folders)': {
      responseRoots: bareResumeResponse?.roots ?? null,
      turnStartRoots: turnStartRoots('bare-patch'),
      fileCards: cardsOn('bare-patch', 'file').length,
      written: exists('A/bare.txt'),
    },
    'evidence · a symlinked work folder (L → C), granted then removed': {
      L,
      C,
      grantTurnStartRoots: turnStartRoots('link-patch'),
      grantEchoRoots: wire.find(
        (entry) =>
          entry.what === 'notification thread/settings/updated' && entry.turn === 'link-patch',
      )?.roots,
      grantCards: cardsOn('link-patch').length,
      grantWritten: exists('C/link.txt'),
      removalTurnStartRoots: turnStartRoots('unlink-patch'),
      removalEchoRoots: wire.find(
        (entry) =>
          entry.what === 'notification thread/settings/updated' && entry.turn === 'unlink-patch',
      )?.roots,
      removalFileCards: cardsOn('unlink-patch', 'file').length,
      removalWritten: exists('C/unlink.txt'),
    },
  }

  const verdicts: { check: string; held: boolean; got: unknown }[] = []
  const hold = (check: string, held: boolean, got: unknown): void => {
    verdicts.push({ check, held, got })
  }
  const none = (turn: string): void =>
    hold(`${turn}: no card`, cardsOn(turn).length === 0, cardsOn(turn))
  const oneFileCard = (turn: string): void =>
    hold(`${turn}: one file card`, cardsOn(turn, 'file').length === 1, cardsOn(turn))
  const written = (path: string, want: boolean): void =>
    hold(`${path} ${want ? 'written' : 'not written'}`, exists(path) === want, exists(path))
  for (const one of endings)
    hold(`turn ${one.turn} completed`, one.state === 'completed', one.state)
  const notTaken = cards.filter((card) => card.accepted !== true)
  hold('every denial was taken', notTaken.length === 0, notTaken)

  // ⚑ The control: before any grant `A/` asks like any folder outside the cwd.
  oneFileCard('before')
  written('A/before.txt', false)
  // 🔴 Arm 1 — granted: no card, and both the patch and the sandboxed shell write land.
  hold(
    'grant-patch: turn/start carries A',
    turnStartRoots('grant-patch')?.includes(A) === true,
    turnStartRoots('grant-patch'),
  )
  none('grant-patch')
  written('A/granted.txt', true)
  none('grant-shell')
  written('A/shell.txt', true)
  // 🔴 Arm 2 — never granted: the patch asks and is refused; the shell write is stopped by the
  // sandbox and asks nothing.
  oneFileCard('other-patch')
  written('B/other.txt', false)
  none('other-shell')
  written('B/shell.txt', false)
  hold(
    'other-shell: the sandbox said no',
    /not permitted|denied|read-only/i.test(toolOutput('other-shell') ?? ''),
    toolOutput('other-shell'),
  )
  // 🔴 Arm 3 — removed: the adapter stops sending A although the server echoed it, and A asks again.
  hold(
    'removed-patch: turn/start drops A',
    turnStartRoots('removed-patch')?.includes(A) === false,
    turnStartRoots('removed-patch'),
  )
  oneFileCard('removed-patch')
  written('A/removed.txt', false)
  none('removed-shell')
  written('A/removed-shell.txt', false)
  // 🔴 Arm 4 — granted again, closed, resumed on a NEW app-server with the grant.
  none('regrant-patch')
  written('A/regranted.txt', true)
  hold('a new app-server', pids.resumed !== undefined && pids.resumed !== pids.started, pids)
  hold('the first app-server is gone', startedAliveAfterClose === false, startedAliveAfterClose)
  none('resumed-patch')
  written('A/resumed.txt', true)
  oneFileCard('resumed-other')
  written('B/resumed-other.txt', false)
  // 🔴 Arm 5 — the resume NAMED the grant, and Codex's own answer lists it.
  const resumeConfig = checks['arm 5 · thread/resume'].requestConfig
  const namedOnResume = isRecord(resumeConfig)
    ? resumeConfig['sandbox_workspace_write.writable_roots']
    : null
  hold(
    'thread/resume config names [A]',
    JSON.stringify(namedOnResume) === JSON.stringify([A]),
    namedOnResume,
  )
  hold(
    'thread/resume response lists A',
    resumeResponse?.roots?.includes(A) === true,
    resumeResponse?.roots ?? null,
  )

  const evidence = runEvidence('codex-work-folders')
  mkdirSync(evidence, { recursive: true })
  const put = (name: string, value: unknown): void =>
    writeFileSync(join(evidence, name), `${JSON.stringify(value, null, 1)}\n`)
  put('summary.json', {
    vendoredProtocol: CODEX_PROTOCOL_VERSION,
    userAgent,
    root,
    A,
    B,
    listenedOn,
    configuredBefore,
    configuredAfter,
    modelRequests: model.requests.length,
    endings,
    files,
    checks,
    failed: verdicts.filter((one) => !one.held),
    verdicts,
    toldAfterGrant: toldAt('grant-patch'),
    toldAfterRemoval: toldAt('removed-patch'),
    toldAfterRegrant: toldAt('regrant-patch'),
    toldAfterResume: toldAt('resumed-patch'),
    toldAfterBareResume: toldAt('bare-patch'),
    toldAfterSymlinkGrant: toldAt('link-patch'),
    toldAfterSymlinkRemoval: toldAt('unlink-patch'),
  })
  put('cards.json', cards)
  put('wire.json', wire)
  put('model-told.json', told)
  put('model-naming-A.json', namingA)
  put(
    'model-requests.json',
    model.requests.map((request) => ({
      n: request.n,
      marker: request.marker ?? null,
      input: isRecord(request.body) ? request.body['input'] : request.body,
    })),
  )
  put('model-request-1-whole.json', model.requests[0]?.body ?? null)
  console.log(
    `W4.189 codex work-folders · evidence ${evidence} ·`,
    JSON.stringify({ failure, failed: verdicts.filter((one) => !one.held), checks }, null, 1),
  )

  // ⛔ **Measured, or the run says why not** — a silent run is a green run.
  expect(failure, 'NOT PERFORMED').toBeNull()
  expect(model.requests.length, 'no request reached the loopback').toBeGreaterThan(0)
  expect(configuredAfter).toBe(listenedOn)
  expect(endings.map((one) => one.turn)).toEqual(
    Object.values(LAUNCHES).flatMap((one) => one.turns),
  )
  // ⚑ Every arm's checks at once, so one run names every one that did not hold.
  expect(verdicts.filter((one) => !one.held)).toEqual([])
  // ⚠️ Only a run whose every check held deletes its root (`649` F6).
  rmSync(root, { recursive: true, force: true })
}

it(
  'W4.189 · a Codex work folder is writable without a card, and only while it is granted',
  () => deadline.within('measuring the work folders', measureAndCheck),
  deadline.testTimeoutMs,
)
