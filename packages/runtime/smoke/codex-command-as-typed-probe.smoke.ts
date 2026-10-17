import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { expect, it } from 'vitest'
// 🔒 **A deep import, and deliberately** — `codex-early-interrupt-probe.smoke.ts`'s reason: this
// probe owns its spawn so it can put the loopback provider's `env_key` in the child environment,
// which `createSpawnTransportFactory` sanitizes away. ⚑ Everything else is the PRODUCT's door:
// `CodexRuntime.start` → `send` → `close`.
import {
  SpawnCodexTransport,
  type CodexIncoming,
  type CodexTransport,
} from '../src/codex/codex-transport'
import { CodexRuntime, codexAppServerArgs, type TransportFactory } from '../src/codex/codex-runtime'
import type { RuntimeEvent } from '../src/events'
import type { SessionHandle } from '../src/runtime'
import { bundledCodexBinary } from './bundled-codex'
import { A_PERSONS_FRAME } from './command-as-typed-evidence'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

/**
 * 🔴 **708 · what Codex's app-server does with a person's `/compact` — and with a `$skill`.**
 *
 * ## ⛔ The question `R42` left for Codex
 *
 * `708` §1: *"Codex: measure what a person's `/compact` does over the app-server. If Codex publishes
 * no command list there, its messages keep the frame and you report what Codex did with the words
 * (a finding, not a fix)."* ⚑ Codex publishes `$` skills and no `/` commands (`279`), so `R42`
 * keeps the frame on Codex; this measures what the frame — and its absence — costs there.
 *
 * ⚠️ **And the palette tells a person the same thing for both providers**: *"Type one with `$` in
 * the conversation"*. A `$skill` typed into BroBot reaches Codex as TEXT, and Codex's own protocol
 * has a separate `UserInput` item for a skill (`{ type: 'skill', name, path }`) that BroBot never
 * sends — so whether a `$name` in text does anything at all is the question under that sentence.
 *
 * | arm | what it sends | what it establishes |
 * |---|---|---|
 * | **plain** | an ordinary message | the CONTROL: one turn, no skill, no compaction |
 * | **compact-framed** | a first turn, then the product's frame and `/compact` | what BroBot SENT a Codex conversation for a person's `/compact` until 713 (`R59` sends `thread/compact/start` now — **compact-person**) |
 * | **compact-bare** | a first turn, then `/compact` | whether Codex would have run it bare — so the frame's cost is measured, not assumed |
 * | **compact-rpc** | a first turn, then `thread/compact/start` | the POSITIVE control: that the recorder sees a compaction Codex really runs |
 * | **compact-instructions** (713) | a first turn, then `thread/compact/start` with an `instructions` marker | `R59`'s question — does the request take instructions, refuse them, or drop them? |
 * | **compact-empty** (713) | `thread/compact/start` on a thread with no turns | whether a compaction with nothing to compact still STARTS — the adapter's bound rests on it |
 * | **compact-person** (713) | a first turn, then the PRODUCT's `SessionHandle.compact` | `R59` through the product: Codex's compaction, bound, drawn, and no words |
 * | **skill-framed** | the product's frame, then `$<skill> …` | what BroBot sends for a person's `$skill` |
 * | **skill-bare** | `$<skill> …` | whether the frame is what stands between the mention and the skill |
 *
 * ⚑ The skill is one Codex itself published for the arm's own scratch home, read off the
 * `provider_commands` the product emits at thread start — never a name this probe made up. ⚑ The
 * frame is the product's WHOLE frame (`A_PERSONS_FRAME`, pinned to `messageNamingItsSender`), so the
 * mention sits as far into the text as it does in the app.
 *
 * ## ⚑ The instrument — `581`'s recipe, through the product's runtime
 *
 * The bundled binary uses a `listen(0)` loopback endpoint recording request bodies and
 * returning completed messages. Each arm owns scratch root, `HOME`, `CODEX_HOME`,
 * `CODEX_SQLITE_HOME`, and cwd; use no account, token, spend, or `auth.json`, touch no
 * personal provider homes, `~/.codex`, or `:9444`, and launch no Electron. The only
 * substitution answers `getAuthStatus` and `account/read` as API-key sign-in while recording
 * Codex notifications. Before and after launch, read back the child’s configured port from
 * its config file and compare it to the port actually assigned.
 *
 * *"This captures what the provider put in its model-bound request, not a hosted model's obedience
 * to the text."*
 *
 * Run: `pnpm run probe:codex-command-as-typed`. Not part of `pnpm run ci`.
 */

const MODEL = 'gpt-5.6-luna'
const KEY = 'BROBOT_708_CAPTURE_KEY'
const FIRST = '708 first turn: reply with the single word ok'
/** ⚑ 713 · a marker nothing else writes, so a match in a request can only be these instructions. */
const INSTRUCTIONS = `BROBOT_713_COMPACT_INSTRUCTIONS_${String(process.pid)}`

const ARMS = [
  'plain',
  'compact-framed',
  'compact-bare',
  'compact-rpc',
  'compact-instructions',
  'compact-empty',
  'compact-person',
  'skill-framed',
  'skill-bare',
] as const
type Arm = (typeof ARMS)[number]

/** ⚠️ Bounded, standing rule 13 — a stalled app-server is NOT PERFORMED, never waited on. */
const OPEN_DEADLINE_MS = 30_000
const RPC_DEADLINE_MS = 10_000
/** ⚑ The scripted model answers at once, so a turn ends in well under a second; 15 s is a stall. */
const TURN_DEADLINE_MS = 15_000
const SETTLE_MS = 500
const EXIT_GRACE_MS = 2_000
const KILL_GRACE_MS = 2_000
const PUMP_MS = 5_000
/** ⚑ How long a compaction Codex was ASKED for may take to be announced — a scripted summary. */
const COMPACTION_DEADLINE_MS = 15_000
/**
 * ⚑ **How long a `/compact` MESSAGE is watched for a compaction after its turn** (708's second
 * review): the negative arms must look at least as long as the positive control took to see a real
 * one, and the run asserts that it did.
 */
const COMPACTION_WATCH_MS = 5_000
const VERSION_MS = 10_000
const CLOSE_MS = 2_000 + 2_000 + EXIT_GRACE_MS + 2 * KILL_GRACE_MS + PUMP_MS
const TEARDOWN_MS = CLOSE_MS

const deadline = probeRunDeadline(
  '708 codex command-as-typed probe',
  runBudgetMs([
    VERSION_MS,
    // ⛔ **Every wait an arm can make, counted where it is made** (704's review, re-taken by 708's):
    // the launch, the published-skills wait, two sends, two turns, the compaction, the settle, the
    // close — counted on every arm, since an over-count only widens.
    ...ARMS.map(
      () =>
        OPEN_DEADLINE_MS +
        3 * RPC_DEADLINE_MS +
        2 * TURN_DEADLINE_MS +
        COMPACTION_DEADLINE_MS +
        COMPACTION_WATCH_MS +
        SETTLE_MS +
        CLOSE_MS,
    ),
  ]),
  TEARDOWN_MS,
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** ⚑ The product's transport, with `672`'s one substitution, recording every notification. */
class Recorded implements CodexTransport {
  readonly notifications: string[] = []
  /** ⚑ 713 · every request the product sent, by method, in order. */
  readonly asked: string[] = []
  /** ⚑ 713 · every notification with its time and the turn it names, in arrival order. */
  readonly timeline: string[] = []
  private readonly born = performance.now()
  constructor(private readonly inner: SpawnCodexTransport) {}
  get pid(): number | undefined {
    return this.inner.pid
  }
  request(method: string, params: unknown): Promise<unknown> {
    this.asked.push(method)
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
      if (frame.kind === 'notification') {
        const item =
          isRecord(frame.params) && isRecord(frame.params['item']) ? frame.params['item'] : null
        const type = item !== null && typeof item['type'] === 'string' ? `:${item['type']}` : ''
        this.notifications.push(`${frame.method}${type}`)
        this.timeline.push(`${this.at()} ${frame.method}${type} turn=${turnOf(frame.params)}`)
      }
      yield frame
    }
  }
  close(): void | Promise<void> {
    return this.inner.close()
  }
  /** ⚑ 713 · a mark on the same clock as the notifications — an RPC's answer, say. */
  mark(what: string): void {
    this.timeline.push(`${this.at()} ${what}`)
  }
  private at(): string {
    return `+${String(Math.round(performance.now() - this.born))}ms`
  }
}

/** ⚑ 713 · the turn a notification names — `turn.id` on the turn frames, `turnId` on an item's. */
function turnOf(params: unknown): string {
  if (!isRecord(params)) return '-'
  if (typeof params['turnId'] === 'string') return params['turnId']
  const turn = params['turn']
  return isRecord(turn) && typeof turn['id'] === 'string' ? turn['id'] : '-'
}

/** One input item of a model-bound request, as the model reads it. */
interface Item {
  readonly role: string
  readonly type: string
  readonly text: string
}

function itemsOf(body: unknown): Item[] {
  const input = isRecord(body) && Array.isArray(body['input']) ? body['input'] : []
  return input.map((item: unknown) => {
    if (!isRecord(item)) return { role: '', type: typeof item, text: '' }
    const content = Array.isArray(item['content']) ? item['content'] : []
    const text = content
      .map((part: unknown) =>
        isRecord(part) && typeof part['text'] === 'string' ? part['text'] : '',
      )
      .join('\n')
    return {
      role: typeof item['role'] === 'string' ? item['role'] : '',
      type: typeof item['type'] === 'string' ? item['type'] : '',
      text,
    }
  })
}

function send(response: ServerResponse, kind: string, payload: Record<string, unknown>): void {
  response.write(`event: ${kind}\ndata: ${JSON.stringify({ type: kind, ...payload })}\n\n`)
}

/** A model that answers every request at once, and keeps every request it was sent. */
function recordingModel(): { server: Server; bodies: unknown[] } {
  const bodies: unknown[] = []
  let count = 0
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      count += 1
      const id = `resp_708_${String(count)}`
      try {
        bodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        bodies.push(null)
      }
      response.statusCode = 200
      response.setHeader('content-type', 'text/event-stream')
      send(response, 'response.created', { response: { id } })
      send(response, 'response.output_item.done', {
        output_index: 0,
        item: {
          type: 'message',
          id: `msg_${id}`,
          status: 'completed',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'ok', annotations: [] }],
        },
      })
      send(response, 'response.completed', {
        response: {
          id,
          usage: {
            input_tokens: 11,
            input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
            output_tokens: 1,
            output_tokens_details: { reasoning_tokens: 0 },
            total_tokens: 12,
          },
        },
      })
      response.end()
    })
  })
  return { server, bodies }
}

function providerStanza(port: number): string {
  return [
    `model = "${MODEL}"`,
    'model_provider = "capture"',
    '',
    '[model_providers.capture]',
    'name = "BroBot 708 command capture"',
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

const until = async (what: string, ms: number, done: () => boolean): Promise<void> =>
  await bounded(what, ms, async (signal) => {
    while (!done() && !signal.aborted) await new Promise((resolve) => setTimeout(resolve, 10))
  })

interface ArmResult {
  readonly arm: Arm
  /** The words the measured turn sent — `null` for the RPC control and an arm that never got there. */
  readonly sent: string | null
  /** The skill this arm named, off the list Codex published for its home — `null` for the others. */
  readonly skill: string | null
  readonly published: readonly string[]
  readonly failure: string | null
  readonly listenedOn: number
  readonly configuredBefore: number | null
  readonly configuredAfter: number | null
  /** Every model-bound request the arm made, as the model reads it. */
  readonly requests: readonly Item[][]
  /**
   * ⚑ **713 · every request body WHOLE, as sent** — top-level fields included (`instructions`,
   * `tools`, …), which {@link requests} does not read. What a negative about a marker searches.
   */
  readonly bodies: readonly string[]
  readonly notifications: readonly string[]
  /** The product's own word for each turn that ended, in order. */
  readonly ended: readonly string[]
  /** ⚑ The RPC control: ms from its request to the first compaction notification — `null` elsewhere. */
  readonly compactedAfterMs: number | null
  /** ⚑ 713 · what `thread/compact/start` answered — its result, or `error: …` — `null` on a message arm. */
  readonly rpcAnswer: string | null
  /** ⚑ 713 · every notification with its time and turn, and the RPC's answer on the same clock. */
  readonly timeline: readonly string[]
  /** ⚑ 713 · every request the PRODUCT sent, by method — `compact-person`'s evidence of which door. */
  readonly asked: readonly string[]
  /** ⚑ 713 · the product's own `compaction` events — what the transcript draws. */
  readonly compactions: readonly RuntimeEvent[]
}

async function runArm(arm: Arm, root: string): Promise<ArmResult> {
  deadline.refuse(`arm ${arm}`)
  const armRoot = mkdtempSync(join(root, `${arm}-`))
  const home = join(armRoot, 'home')
  const cwd = join(armRoot, 'cwd')
  mkdirSync(home, { recursive: true })
  mkdirSync(cwd, { recursive: true })
  const model = recordingModel()
  const transports: Recorded[] = []
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
  let sent: string | null = null
  let skill: string | null = null
  let published: string[] = []
  const ended: string[] = []
  let compactedAfterMs: number | null = null
  let rpcAnswer: string | null = null
  const productEvents: RuntimeEvent[] = []
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
      )
      transports.push(transport)
      return transport
    }
    const runtime = new CodexRuntime(factory)
    const opened = await bounded(`${arm} start`, OPEN_DEADLINE_MS, (signal) =>
      runtime.start({ cwd, providerHome: home, approvalMode: 'auto', model: MODEL, signal }),
    )
    handle = opened
    const events: RuntimeEvent[] = []
    pump = (async () => {
      for await (const event of opened.events()) {
        events.push(event)
        productEvents.push(event)
        if (event.type === 'turn') ended.push(event.state)
      }
    })()
    configuredAfter = configuredPortOf(home)
    if (configuredAfter !== listenedOn) {
      throw new Error(
        `NOT PERFORMED — after launch the config names port ${String(configuredAfter)}, not ${String(listenedOn)}`,
      )
    }
    // ⚑ The skills Codex published for THIS home — the product emits them at thread start.
    await until(`${arm}: the published skills`, RPC_DEADLINE_MS, () =>
      events.some((event) => event.type === 'provider_commands'),
    ).catch(() => {})
    const list = events.find((event) => event.type === 'provider_commands')
    published = list?.type === 'provider_commands' ? list.commands.map((one) => one.name) : []
    const turn = async (text: string): Promise<void> => {
      const before = ended.length
      await bounded(`${arm}: send`, RPC_DEADLINE_MS, () => opened.send(text))
      await until(`${arm}: the turn`, TURN_DEADLINE_MS, () => ended.length > before)
    }
    // ⚑ **A plain first turn on every compact arm**, so there is a conversation to compact — the
    // Claude probe's reason; a `/compact` on an empty thread would say nothing about one with history.
    // ⚑ 713 · except `compact-empty`, whose whole question is what compacting NOTHING does.
    if (arm.startsWith('compact') && arm !== 'compact-empty') await turn(FIRST)
    if (arm === 'compact-rpc' || arm === 'compact-instructions' || arm === 'compact-empty') {
      const threadId = opened.ref?.sessionId
      const transport = transports[0]
      if (threadId === undefined || transport === undefined) {
        throw new Error('NOT PERFORMED — no thread id to compact')
      }
      // ⚑ **713 · `R59`'s question: does `thread/compact/start` take instructions?** The generated
      // params type is `{ threadId }` and nothing else; this asks the binary, with a marker nothing
      // else writes, whether an `instructions` field is refused, or taken, or silently dropped.
      const params =
        arm === 'compact-instructions' ? { threadId, instructions: INSTRUCTIONS } : { threadId }
      const asked = Date.now()
      transport.mark('asked thread/compact/start')
      rpcAnswer = await bounded(`${arm}: thread/compact/start`, RPC_DEADLINE_MS, () =>
        transport.request('thread/compact/start', params).then(
          (result) => JSON.stringify(result),
          (error: unknown) => `error: ${errorText(error)}`,
        ),
      )
      transport.mark(`answered ${rpcAnswer}`)
      if (arm === 'compact-empty') {
        await new Promise((resolve) => setTimeout(resolve, COMPACTION_WATCH_MS))
      } else {
        await until(`${arm}: Codex's compaction`, COMPACTION_DEADLINE_MS, () =>
          transport.notifications.some((method) => /compact/i.test(method)),
        )
        compactedAfterMs = Date.now() - asked
        // ⚑ …and until the turn it runs as has ended, so its whole timeline is on the record.
        await until(
          `${arm}: the compaction's turn`,
          TURN_DEADLINE_MS,
          () =>
            transport.notifications.lastIndexOf('turn/completed') >
            transport.notifications.findIndex((method) => /compact/i.test(method)),
        ).catch(() => {})
      }
    } else if (arm === 'compact-person') {
      // 🔴 **713 · `R59` through the PRODUCT's door** — `SessionHandle.compact`, which the host calls
      // for a person's `/compact` on this provider. ⚑ The adapter binds the turn Codex runs it as,
      // and what comes out of the product's own event stream is what the transcript draws.
      const compact = opened.compact
      if (compact === undefined)
        throw new Error('NOT PERFORMED — the product has no compaction door')
      await bounded(`${arm}: compact`, RPC_DEADLINE_MS, () => compact.call(opened))
      await until(`${arm}: the product's compaction`, COMPACTION_DEADLINE_MS, () =>
        events.some((event) => event.type === 'compaction'),
      )
      await until(`${arm}: the compaction's turn`, TURN_DEADLINE_MS, () => ended.length === 2)
    } else {
      if (arm.startsWith('skill')) {
        skill = published.includes('skill-creator') ? 'skill-creator' : (published[0] ?? null)
        if (skill === null)
          throw new Error('NOT PERFORMED — Codex published no skill for this home')
      }
      const words =
        arm === 'plain'
          ? '708 plain: reply with the single word ok'
          : arm.startsWith('compact')
            ? '/compact'
            : `$${skill ?? ''} 708 skill probe: reply with the single word ok`
      sent = arm.endsWith('framed') ? `${A_PERSONS_FRAME}\n\n${words}` : words
      await turn(sent)
      // ⚑ A `/compact` message is watched as long as a real compaction takes to be announced.
      if (arm.startsWith('compact')) {
        await new Promise((resolve) => setTimeout(resolve, COMPACTION_WATCH_MS))
      }
    }
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
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
    sent,
    skill,
    published,
    failure,
    listenedOn,
    configuredBefore,
    configuredAfter,
    requests: model.bodies.map((body) => itemsOf(body)),
    bodies: model.bodies.map((body) => JSON.stringify(body)),
    notifications: transports.flatMap((one) => one.notifications),
    ended,
    compactedAfterMs,
    rpcAnswer,
    timeline: transports.flatMap((one) => one.timeline),
    asked: transports.flatMap((one) => one.asked),
    compactions: productEvents.filter((event) => event.type === 'compaction'),
  }
}

const results: Partial<Record<Arm, ArmResult>> = {}

/**
 * ⚑ **The measured turn's OWN model-bound request** — the one carrying the words sent, exactly, as
 * a user item. ⚠️ Not the last request: Codex runs a background memory-consolidation request of its
 * own after a turn, measured on every arm, and reading that one would be reading somebody else's call.
 */
function turnRequest(result: ArmResult): Item[] | null {
  if (result.sent === null) return null
  return (
    result.requests.find((items) =>
      items.some((item) => item.role === 'user' && item.text === result.sent),
    ) ?? null
  )
}

/** ⚑ Did Codex inject the NAMED skill into the measured turn — its own `<skill>` item, by name? */
function skillInjected(result: ArmResult): boolean {
  return (turnRequest(result) ?? []).some(
    (item) =>
      item.role === 'user' && item.text.startsWith(`<skill>\n<name>${result.skill ?? ''}</name>`),
  )
}

/**
 * ⛔ **Did ANY skill reach ANY request of this arm?** — the controls' question (708's review): a
 * control asked about the named skill asks about `<name></name>`, which no injection writes, and
 * could never fail.
 */
function anySkillInjected(result: ArmResult): boolean {
  return result.requests.some((items) =>
    items.some((item) => item.role === 'user' && item.text.startsWith('<skill>\n')),
  )
}

const compacted = (result: ArmResult): string[] =>
  result.notifications.filter((method) => /compact/i.test(method))

/** ⚑ 713 · Codex's own summary requests — its fixed compaction prompt, as the model reads it. */
const summaryRequests = (result: ArmResult): number =>
  result.requests.filter((items) =>
    items.some(
      (item) => item.role === 'user' && item.text.includes('CONTEXT CHECKPOINT COMPACTION'),
    ),
  ).length

it(
  '708 · what Codex does with a person’s /compact and $skill, framed and bare',
  () =>
    deadline.within('every arm', async () => {
      const scratch = runScratch('codex-command-as-typed')
      mkdirSync(scratch, { recursive: true })
      const root = mkdtempSync(join(scratch, 'run-'))
      let codexVersion: string
      try {
        codexVersion = execFileSync(bundledCodexBinary(), ['--version'], {
          encoding: 'utf8',
          timeout: VERSION_MS,
          env: {
            PATH: process.env['PATH'] ?? '',
            HOME: root,
            CODEX_HOME: join(root, 'version-home'),
          },
        }).trim()
      } catch (error) {
        codexVersion = `unknown — ${errorText(error)}`
      }
      const evidence = runEvidence('codex-command-as-typed')
      mkdirSync(evidence, { recursive: true })
      for (const arm of ARMS) {
        const result = await runArm(arm, root)
        results[arm] = result
        const summary = {
          failure: result.failure,
          ended: result.ended,
          skill: result.skill,
          wordsReachedTheModel: turnRequest(result) !== null,
          skillInjected: skillInjected(result),
          anySkillInjected: anySkillInjected(result),
          compaction: compacted(result),
          rpcAnswer: result.rpcAnswer,
        }
        console.log(`[708 codex ${arm}]`, JSON.stringify(summary, null, 2))
        writeFileSync(
          join(evidence, `${arm}.json`),
          `${JSON.stringify({ codexVersion, ...result }, null, 2)}\n`,
        )
      }
      console.log('[708 codex version]', codexVersion)
      const measured = (arm: Arm): ArmResult => {
        const result = results[arm]
        if (result === undefined) throw new Error(`NOT PERFORMED — arm ${arm} never ran`)
        return result
      }
      for (const arm of ARMS) {
        const result = measured(arm)
        expect(result.failure, `${arm}: ${String(result.failure)}`).toBeNull()
        // ⚑ Rule 40 — configured with the port `listen(0)` returned, before and after the launch.
        expect(result.configuredBefore).toBe(result.listenedOn)
        expect(result.configuredAfter).toBe(result.listenedOn)
        // ⚑ …and the endpoint was ASKED: every arm made a model call, and every turn completed.
        expect(result.requests.length, `${arm}: no model call`).toBeGreaterThan(0)
        expect(
          result.ended.every((state) => state === 'completed'),
          `${arm}: ${String(result.ended)}`,
        ).toBe(true)
        // ⚑ Every arm that sent WORDS: a model call carried them. (The RPC arms and the product's
        // own compaction send none — `sent` is `null` there, and that is their point.)
        if (result.sent !== null) {
          expect(turnRequest(result), `${arm}: no model call carried the words sent`).not.toBeNull()
        }
      }
      // ⚑ **Measured 2026-09-24 on the bundled Codex** (the version is in each arm's evidence):
      //
      // | arm | the words reached the model | Codex compacted | a skill was injected |
      // |---|---|---|---|
      // | plain | ✔ | — | — |
      // | compact-framed | ✔ | ⛔ no | — |
      // | compact-bare | ✔ | ⛔ no | — |
      // | compact-rpc | (no words) | ✔ | — |
      // | compact-instructions (713) | (no words) | ✔ — and the instructions reached NO request | — |
      // | compact-empty (713) | (no words) | ✔ — even with no history | — |
      // | compact-person (713) | ⛔ no — the PRODUCT's `compact()` | ✔ one `compaction`, `manual` | — |
      // | skill-framed | ✔ | — | ✔ the named one |
      // | skill-bare | ✔ | — | ✔ the named one |
      //
      // 🔴 **So over the app-server a `/compact` is words, framed or bare** — and the RPC control shows
      // the recorder DOES see a compaction Codex runs: its compaction is a request of its own
      // (`thread/compact/start`) that no message reaches. ⛔ `R42` keeps the frame on Codex and the
      // frame costs nothing here: a person's `/compact` did nothing before `708` and does nothing
      // after it. That is a FINDING (`708`'s response), not a fix.
      // ⚑ **And a `$skill` survives the product's whole frame**: Codex finds the mention anywhere in
      // the text and injects the skill, so the palette's *"Type one with $ in the conversation"* is
      // true on Codex.
      //
      // 🔴 **713 · `R59`.** ⛔ **`thread/compact/start` takes no instructions**: `{ threadId }` is its
      // whole params type, and an `instructions` field is ACCEPTED (`{}`) and DROPPED — the marker
      // reached no request, while the compaction's own summary request (Codex's fixed *CONTEXT
      // CHECKPOINT COMPACTION* prompt) did go out. So the host refuses `/compact <instructions>` in
      // words. ⚑ And a person's `/compact` through the PRODUCT — `SessionHandle.compact` — runs that
      // compaction as a turn the adapter binds, whose one `compaction` event says `manual`, while no
      // request carries `/compact` as words.
      expect(
        compacted(measured('compact-rpc')),
        'the recorder saw no compaction at all',
      ).not.toEqual([])
      // ⚑ …and the negative arms watched LONGER than the real one took to be announced.
      expect(measured('compact-rpc').compactedAfterMs ?? Infinity).toBeLessThan(COMPACTION_WATCH_MS)
      for (const arm of ['compact-framed', 'compact-bare'] as const) {
        expect(compacted(measured(arm)), `${arm}: Codex compacted on a message`).toEqual([])
        expect(anySkillInjected(measured(arm))).toBe(false)
      }
      for (const arm of ['skill-framed', 'skill-bare'] as const) {
        expect(skillInjected(measured(arm)), `${arm}: the $ mention reached no skill`).toBe(true)
      }
      // ⚑ The control: an ordinary turn carries no skill at all and compacts nothing.
      expect(anySkillInjected(measured('plain'))).toBe(false)
      expect(compacted(measured('plain'))).toEqual([])

      // 🔴 **713 · the instructions question** — accepted, compacted, and carried by NO request, while
      // the compaction's own request went out (the positive control that the recorder saw it).
      const withInstructions = measured('compact-instructions')
      expect(withInstructions.rpcAnswer, 'Codex refused the field outright').toBe('{}')
      expect(compacted(withInstructions)).not.toEqual([])
      expect(
        summaryRequests(withInstructions),
        'no compaction request was recorded',
      ).toBeGreaterThan(0)
      // ⛔ **Searched over every body WHOLE** (713's review): an input-item search cannot see a
      // top-level field, and Codex writes its own instructions into one. ⚑ The same search FINDS
      // the compaction's own prompt, so it is a search that could have succeeded.
      expect(
        withInstructions.bodies.some((body) => body.includes('CONTEXT CHECKPOINT COMPACTION')),
        'the whole-body search finds nothing it should',
      ).toBe(true)
      expect(
        withInstructions.bodies.some((body) => body.includes(INSTRUCTIONS)),
        'the instructions reached a request — R59’s refusal would be refusing something Codex takes',
      ).toBe(false)
      // ⚑ …and an EMPTY thread compacts too: the turn it runs as starts, so the adapter's bound on a
      // compaction that never starts is about the app-server, not about having nothing to compact.
      const empty = measured('compact-empty')
      expect(empty.rpcAnswer).toBe('{}')
      expect(compacted(empty)).not.toEqual([])

      // 🔴 **713 · a person's `/compact`, through the product's door.**
      const person = measured('compact-person')
      expect(person.asked.filter((method) => method === 'thread/compact/start')).toHaveLength(1)
      expect(
        person.asked.filter((method) => method === 'turn/start'),
        'only the first turn',
      ).toHaveLength(1)
      expect(person.ended).toEqual(['completed', 'completed'])
      expect(person.compactions).toEqual([
        expect.objectContaining({
          type: 'compaction',
          trigger: 'manual',
          source: 'contextCompaction',
        }),
      ])
      expect(summaryRequests(person), 'Codex ran no compaction request').toBeGreaterThan(0)
      // ⚠️ **As a MESSAGE — the words alone, or behind a frame** — never as a substring: this arm's
      // own scratch folder is `compact-person-…`, and Codex writes its path into every request.
      expect(
        person.requests.some((items) =>
          items.some((item) => item.role === 'user' && /(^|\n)\/compact$/.test(item.text.trim())),
        ),
        'the words /compact reached a model',
      ).toBe(false)
      // ⚑ …and the same test FINDS them where they were sent as words — the two message arms — so
      // the negative above is a search that could have succeeded.
      for (const arm of ['compact-framed', 'compact-bare'] as const) {
        expect(
          measured(arm).requests.some((items) =>
            items.some((item) => item.role === 'user' && /(^|\n)\/compact$/.test(item.text.trim())),
          ),
          `${arm}: the message test found no /compact where one was sent`,
        ).toBe(true)
      }
      // ⛔ **Only a run whose every arm was measured deletes its scratch** (`649` F6, as 704 keeps it) —
      // a red keeps each arm's CODEX_HOME, rollouts and logs for whoever reads it.
      rmSync(root, { recursive: true, force: true })
    }),
  deadline.testTimeoutMs,
)
