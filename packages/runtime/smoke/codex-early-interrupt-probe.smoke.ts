import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { expect, it } from 'vitest'
// 🔒 **A deep import, and deliberately** — `codex-reopen-grant-probe.smoke.ts`'s reason: this probe
// owns its spawn so it can put the loopback provider's `env_key` in the child environment, which
// `createSpawnTransportFactory` sanitizes away. ⚑ Everything else is the PRODUCT's door:
// `CodexRuntime.start` → `send` → `interrupt` → `close`.
import {
  SpawnCodexTransport,
  type CodexIncoming,
  type CodexTransport,
} from '../src/codex/codex-transport'
import { CodexRuntime, codexAppServerArgs, type TransportFactory } from '../src/codex/codex-runtime'
import type { RuntimeEvent } from '../src/events'
import type { SessionHandle } from '../src/runtime'
import { bundledCodexBinary } from './bundled-codex'
import { earlyInterruptVerdict, renamed, type Arm, type TurnSeen } from './early-interrupt-evidence'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

/**
 * 🔴 **704 · does an interrupt the product is asked for BEFORE Codex has started the turn stop it?**
 *
 * ## ⛔ The question, and the run that asked it
 *
 * `smoke:ui` step 48 went red on the hidden `main` baseline and green in `695`'s run (`695` F-b,
 * measured in `697`'s response §9; `697` H-e). The four runs' ledgers and Codex's own rollouts
 * named it (704's response §1): interrupt-and-send was pressed 33 ms and 82 ms after Send in the
 * two runs where it misbehaved, **before Codex's `task_started`**
 * (+42, +125) — and in both Codex then wrote **`task_complete`**, streaming the whole count. In the two
 * where it was pressed at ~210 ms, after the turn was running, Codex wrote `turn_aborted`. The
 * adapter's early latch (`interruptPending`, 037/029) fires `turn/interrupt` the moment the
 * `turn/start` RESPONSE binds the id — which is before the turn is ACTIVE — and swallows the answer.
 * ⛔ One run then refused the person's replacement message: the host waits five seconds for the turn
 * to end (`waitForIdle`), and Codex took 5.9 s to finish the turn it had been asked to stop.
 *
 * ## ⚑ The instrument — `581`'s recipe, through the product's runtime
 *
 * The bundled binary’s `listen(0)` loopback endpoint answers a marked turn with
 * `response.created`, holds the stream for {@link HOLD_MS}, then completes it. The turn is
 * running without generating and ends naturally unless stopped. Each arm owns scratch root,
 * `HOME`, `CODEX_HOME`, `CODEX_SQLITE_HOME`, and cwd. Use no account, token, spend, or
 * `auth.json`; leave personal provider homes, `~/.codex`, and `:9444` untouched and launch no
 * Electron.
 *
 * ⚠️ **The ONE substitution** (`672`'s, as `probe:codex-reopen-grant` makes it): the transport
 * answers `getAuthStatus` and `account/read` itself, as an API-key sign-in. It also RECORDS — every
 * `turn/start` and `turn/interrupt` the product writes and what Codex answers (the adapter swallows
 * the interrupt's answer), and Codex's own `turn/started` / `turn/completed`. Everything is forwarded.
 *
 * ⚠️ *"This captures what the provider put in its model-bound request, not a hosted model's
 * obedience to the text."* (`581`) — here the model is a script; what is measured is what the
 * app-server DOES with an interrupt, in its own word.
 *
 * ## ⚑ The arms — the subject, and a control on each side of it
 *
 * | arm | turns | what it establishes |
 * |---|---|---|
 * | **none** | `n1` — never interrupted | the held turn COMPLETES on its own: an early turn reading `completed` means the interrupt was lost, not that the script ended it |
 * | **late** | `l1` — interrupted after Codex's `turn/started` | an interrupt Codex CAN act on is `interrupted` in its own word |
 * | **early** | `e1`…`e4` — `send()` then `interrupt()` in the same tick | the subject: the product's latch fires as the id binds, before the turn is active |
 *
 * ⚠️ **The window is a race, so the run says whether it hit it** — an early turn whose first
 * interrupt was written after `turn/started` arrived measures nothing about the window, and a run in
 * which none was is NOT PERFORMED (`earlyInterruptVerdict`).
 *
 * Run: `pnpm run probe:codex-early-interrupt`. Not part of `pnpm run ci`; its verdict logic is
 * (`packages/runtime/test/codex-early-interrupt-evidence.test.ts`).
 */

const MODEL = 'gpt-5.6-luna'
const KEY = 'BROBOT_704_CAPTURE_KEY'

/** ⛔ The arms, as one table the budget is counted from — see the docblock's. */
const ARMS = {
  none: { turns: ['n1'] },
  late: { turns: ['l1'] },
  early: { turns: ['e1', 'e2', 'e3', 'e4'] },
} as const

/**
 * ⚑ **How long the scripted model holds a turn open before completing it.** Long enough that an
 * interrupt Codex honours ends the turn well before it (the late control's measured end is a few
 * milliseconds after the interrupt — 3 and 5 ms on 704's two runs), short enough that a lost one
 * costs three seconds rather than a count to sixty.
 */
const HOLD_MS = 3_000
/** How long after Codex's `turn/started` the late control asks — the turn is running by then. */
const LATE_AFTER_START_MS = 300

/** ⚠️ Bounded, standing rule 13 — a stalled app-server is NOT PERFORMED, never waited on. */
const OPEN_DEADLINE_MS = 30_000
/** One protocol call — the product's `send` and `interrupt`, each of which writes one request. */
const RPC_DEADLINE_MS = 10_000
/**
 * ⚑ **Derived, standing rule 22**: a turn nobody stops ends at {@link HOLD_MS} (3 s) and one Codex
 * stops ends in milliseconds, so 15 s is five times the longest a healthy turn here takes. Each turn
 * waits on it twice — the product's ending, then Codex's own.
 */
const TURN_DEADLINE_MS = 15_000
const START_DEADLINE_MS = 30_000
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
  '704 codex early-interrupt probe',
  runBudgetMs(
    // ⛔ **Every wait a turn can make, counted where it is made** (704's review): the send and the
    // interrupt, the product's ending and Codex's, the settle — and, for the late control, Codex's
    // `turn/started` and the pause after it (counted on every arm: an over-count only widens).
    Object.values(ARMS).flatMap((arm) => [
      OPEN_DEADLINE_MS + CLOSE_MS,
      START_DEADLINE_MS + LATE_AFTER_START_MS,
      ...arm.turns.map(() => 2 * RPC_DEADLINE_MS + 2 * TURN_DEADLINE_MS + SETTLE_MS),
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

/** What the recorder saw, stamped on this process's clock. */
interface Wire {
  /** the probe's own label for the turn it is driving — turns run one at a time */
  current: string
  readonly starts: { turn: string; at: number; providerTurnId: string | null; answer: string }[]
  readonly interrupts: { turn: string; at: number; turnId: string; answer: string }[]
  readonly started: { at: number; turnId: string }[]
  readonly completed: { at: number; turnId: string; status: string }[]
}

/**
 * ⚑ The product's transport, with `672`'s one substitution, and a RECORDER — the adapter writes
 * `turn/interrupt` and swallows whatever Codex answers (`sendInterruptRpc`), so this is the only
 * place that answer can be read.
 */
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
    const answer = Promise.resolve(this.inner.request(method, params))
    if (method === 'turn/start') {
      const seen = {
        turn: this.wire.current,
        at: Date.now(),
        providerTurnId: null as string | null,
        answer: 'pending',
      }
      this.wire.starts.push(seen)
      answer.then(
        (result) => {
          const turn = isRecord(result) && isRecord(result['turn']) ? result['turn'] : {}
          seen.providerTurnId = typeof turn['id'] === 'string' ? turn['id'] : null
          seen.answer = 'ok'
        },
        (error: unknown) => (seen.answer = errorText(error)),
      )
    }
    if (method === 'turn/interrupt') {
      const turnId =
        isRecord(params) && typeof params['turnId'] === 'string' ? params['turnId'] : ''
      const seen = { turn: this.wire.current, at: Date.now(), turnId, answer: 'pending' }
      this.wire.interrupts.push(seen)
      answer.then(
        () => (seen.answer = 'ok'),
        (error: unknown) => (seen.answer = errorText(error)),
      )
    }
    return answer
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
      if (frame.kind === 'notification') this.note(frame.method, frame.params)
      yield frame
    }
  }
  close(): void | Promise<void> {
    return this.inner.close()
  }
  private note(method: string, params: unknown): void {
    const turn = isRecord(params) && isRecord(params['turn']) ? params['turn'] : null
    const turnId = turn !== null && typeof turn['id'] === 'string' ? turn['id'] : ''
    if (method === 'turn/started') this.wire.started.push({ at: Date.now(), turnId })
    if (method === 'turn/completed') {
      const status = turn !== null && typeof turn['status'] === 'string' ? turn['status'] : '(none)'
      this.wire.completed.push({ at: Date.now(), turnId, status })
    }
  }
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

function send(response: ServerResponse, kind: string, payload: Record<string, unknown>): void {
  response.write(`event: ${kind}\ndata: ${JSON.stringify({ type: kind, ...payload })}\n\n`)
}

function finish(response: ServerResponse, id: string, text: string): void {
  send(response, 'response.output_item.done', {
    output_index: 0,
    item: {
      type: 'message',
      id: `msg_${id}`,
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text, annotations: [] }],
    },
  })
  send(response, 'response.completed', {
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

/** Per marked model request: did Codex cut it off before the script finished it? */
interface ModelTurn {
  readonly turn: string
  cutOff: boolean
  finished: boolean
}

/**
 * ⚑ A held model: `704-turn-<name>` in the user text → `response.created`, then {@link HOLD_MS} of
 * nothing, then a message and `response.completed` — unless Codex closes the request first.
 */
function heldModel(): { server: Server; turns: ModelTurn[]; release: () => void } {
  const turns: ModelTurn[] = []
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let count = 0
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      count += 1
      const id = `resp_704_${String(count)}`
      let body: unknown
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        body = null
      }
      response.statusCode = 200
      response.setHeader('content-type', 'text/event-stream')
      response.setHeader('cache-control', 'no-cache')
      response.setHeader('connection', 'keep-alive')
      send(response, 'response.created', { response: { id } })
      const marker = /704-turn-([a-z0-9]+)/.exec(lastUserText(body))?.[1]
      if (marker === undefined) {
        finish(response, id, '704 unmarked')
        return
      }
      const seen: ModelTurn = { turn: marker, cutOff: false, finished: false }
      turns.push(seen)
      response.on('close', () => {
        if (!seen.finished) seen.cutOff = true
      })
      const timer = setTimeout(() => {
        timers.delete(timer)
        if (response.writableEnded || response.destroyed) return
        seen.finished = true
        finish(response, id, `704 held ${marker} to the end`)
      }, HOLD_MS)
      timers.add(timer)
    })
  })
  return {
    server,
    turns,
    release: () => {
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
    },
  }
}

function providerStanza(port: number): string {
  return [
    `model = "${MODEL}"`,
    'model_provider = "capture"',
    '',
    '[model_providers.capture]',
    'name = "BroBot 704 early-interrupt capture"',
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
  readonly failure: string | null
  readonly listenedOn: number
  readonly configuredBefore: number | null
  readonly configuredAfter: number | null
  readonly model: readonly ModelTurn[]
  readonly endings: readonly { turn: string; state: string }[]
}

async function runArm(arm: Arm, root: string, wire: Wire): Promise<ArmResult> {
  deadline.refuse(`arm ${arm}`)
  const armRoot = mkdtempSync(join(root, `${arm}-`))
  const home = join(armRoot, 'home')
  const cwd = join(armRoot, 'cwd')
  mkdirSync(home, { recursive: true })
  mkdirSync(cwd, { recursive: true })
  const model = heldModel()
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
      model.release()
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
    writeFileSync(join(home, 'config.toml'), providerStanza(listenedOn))
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
    const providerTurnOf = (turn: string): string | null =>
      wire.starts.find((start) => start.turn === turn)?.providerTurnId ?? null
    for (const turn of ARMS[arm].turns) {
      wire.current = turn
      const before = ended()
      await bounded(`${turn}: send`, RPC_DEADLINE_MS, () =>
        opened.send(`704-turn-${turn} please wait`),
      )
      if (arm === 'early')
        await bounded(`${turn}: interrupt`, RPC_DEADLINE_MS, () => opened.interrupt())
      if (arm === 'late') {
        await until(`${turn}: Codex's turn/started`, START_DEADLINE_MS, () => {
          const id = providerTurnOf(turn)
          return id !== null && wire.started.some((started) => started.turnId === id)
        })
        await new Promise((resolve) => setTimeout(resolve, LATE_AFTER_START_MS))
        await bounded(`${turn}: interrupt`, RPC_DEADLINE_MS, () => opened.interrupt())
      }
      await until(`turn ${turn}`, TURN_DEADLINE_MS, () => ended() > before)
      // ⚠️ Codex's own ending lands beside the product's; waited for, never assumed.
      await until(`${turn}: Codex's turn/completed`, TURN_DEADLINE_MS, () => {
        const id = providerTurnOf(turn)
        return id !== null && wire.completed.some((done) => done.turnId === id)
      })
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
    model: model.turns,
    endings,
  }
}

/** ⚑ The wire, read as one row per turn — times relative to that turn's `turn/start`. */
function turnsSeen(wire: Wire, results: readonly ArmResult[]): TurnSeen[] {
  const rows: TurnSeen[] = []
  for (const [arm, spec] of Object.entries(ARMS) as [Arm, (typeof ARMS)[Arm]][]) {
    for (const turn of spec.turns) {
      const start = wire.starts.find((one) => one.turn === turn)
      const t0 = start?.at ?? 0
      const id = start?.providerTurnId ?? null
      const interrupts = wire.interrupts
        .filter((one) => one.turn === turn)
        .map((one) => ({ sentAt: one.at - t0, answer: one.answer }))
      const started = id === null ? undefined : wire.started.find((one) => one.turnId === id)
      const completed = id === null ? undefined : wire.completed.find((one) => one.turnId === id)
      rows.push({
        arm,
        turn,
        askedAt: arm === 'none' ? null : (interrupts[0]?.sentAt ?? null),
        interrupts,
        startedAt: started === undefined ? null : started.at - t0,
        providerStatus: completed?.status ?? null,
        productWord:
          results.flatMap((one) => one.endings).find((one) => one.turn === turn)?.state ?? null,
      })
    }
  }
  return rows
}

async function measureAndCheck(): Promise<void> {
  deadline.refuse('starting')
  const scratch = runScratch('codex-early-interrupt')
  mkdirSync(scratch, { recursive: true })
  const root = mkdtempSync(join(scratch, 'run-'))
  const wire: Wire = { current: '(none)', starts: [], interrupts: [], started: [], completed: [] }
  const results: ArmResult[] = []
  for (const arm of ['none', 'late', 'early'] as const) results.push(await runArm(arm, root, wire))

  const turns = turnsSeen(wire, results)
  const verdict = earlyInterruptVerdict(turns)
  const disagreeing = renamed(turns)
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
    runEvidence('704-codex-early-interrupt.json'),
    JSON.stringify({ codexVersion, verdict, disagreeing, turns, results, wire }, null, 1),
  )
  console.log(
    `704 codex early-interrupt · ${codexVersion} · ${JSON.stringify({ verdict, disagreeing, turns, results }, null, 1)}`,
  )

  // ⛔ **Every arm MEASURED, or the run says which was not** — a silent arm is a green run.
  for (const one of results) expect(one.failure, `arm ${one.arm}`).toBeNull()
  // ⚑ The premise, on the two controls: the held model is what makes a turn nobody stopped run for
  // HOLD_MS — the uninterrupted turn reached it and was held to the end, the late one was cut off.
  const modelOf = (arm: Arm): readonly ModelTurn[] =>
    results.find((one) => one.arm === arm)?.model ?? []
  expect(modelOf('none').map((turn) => [turn.turn, turn.finished])).toEqual([['n1', true]])
  expect(modelOf('late').map((turn) => [turn.turn, turn.finished])).toEqual([['l1', false]])
  // 🔴 The subject, in Codex's own word.
  expect(verdict).toEqual({ verdict: 'honoured' })
  // 🔴 **709 · R43 — the product recorded Codex's word on every turn**, and every turn has one.
  expect(turns.filter((turn) => turn.productWord === null).map((turn) => turn.turn)).toEqual([])
  expect(disagreeing).toEqual([])
  // ⚑ …and no early turn's model request was held to its end — ⚠️ measured on 704's fix, Codex
  // stops these before it asks the model at all, so an early turn may have NO request; on `main`
  // every one of them was held the whole HOLD_MS.
  expect(modelOf('early').filter((turn) => turn.finished)).toEqual([])
  // ⚠️ Only a run whose every arm was measured deletes its root (`649` F6).
  rmSync(root, { recursive: true, force: true })
}

it(
  '704 · an interrupt asked before Codex has started the turn stops it, in Codex’s own word',
  () => deadline.within('measuring the three arms', measureAndCheck),
  deadline.testTimeoutMs,
)
