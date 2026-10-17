import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { expect, it } from 'vitest'
// 🔒 **A deep import, and deliberately** — `codex-command-as-typed-probe.smoke.ts`'s reason: this
// probe owns its spawn so it can put the loopback provider's `env_key` in the child environment,
// which `createSpawnTransportFactory` sanitizes away. ⚑ Everything else is the PRODUCT's door:
// `CodexRuntime.start` / `resume` → `send` → `close`.
import {
  SpawnCodexTransport,
  type CodexIncoming,
  type CodexTransport,
} from '../src/codex/codex-transport'
import { CodexRuntime, codexAppServerArgs, type TransportFactory } from '../src/codex/codex-runtime'
import type { RuntimeEvent } from '../src/events'
import type { SessionHandle } from '../src/runtime'
import type { SessionRef } from '../src/session-ref'
import { bundledCodexBinary } from './bundled-codex'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

/**
 * 🔴 **715 · R64 on Codex — can a Codex thread report a MOVED cwd on a later turn?**
 *
 * ## ⛔ Why
 *
 * `715` §2.3: *"`codex-runtime.ts` has the same shaped check (codex resume mismatch). Measure
 * whether a Codex thread can report a moved cwd on a later turn. If it can, the same rule; if it
 * cannot, say so with the measurement."* ⚑ On Claude it can (`probe:claude-resume-after-cd`): the
 * bundled CLI's later `system/init` names the directory its Bash tool `cd`'d into. ⚠️ Codex's check
 * (`validateHandshake`) reads the `thread/start` | `thread/resume` RESPONSE, once per launch — so
 * the question here is whether anything a later turn does can move what Codex REPORTS as the
 * thread's cwd: on a later frame of the same launch, or on the next resume's response.
 *
 * ## ⚑ The instrument — `581`'s recipe, through the product's runtime
 *
 * Run the bundled binary against a `listen(0)` loopback endpoint. A {@link MOVE} turn
 * receives a code-mode `custom_tool_call` for `exec` calling `tools.exec_command` with `cd
 * sub && pwd`; other turns receive `ok`. The root, `HOME`, `CODEX_HOME`, `CODEX_SQLITE_HOME`,
 * and cwd belong to scratch. Use no account, token, spend, or `auth.json`; touch no personal
 * provider homes, `~/.codex`, or `:9444` and launch no Electron. Substitute only
 * `getAuthStatus` and `account/read` as API-key sign-in. Read the child’s configured port
 * before and after launch and compare it to the actual assigned port.
 *
 * ## 🔴 Four launches on ONE thread — each a new app-server, which is what a reopen is
 *
 * | launch | opens | turns | the question |
 * |---|---|---|---|
 * | **fresh-cd** | `start` | `cd sub`, plain | does any later frame name `sub` as the THREAD's cwd? |
 * | **resumed-plain** | `resume` | plain | ⚑ the control: the resume response's `thread.cwd`, nobody having moved |
 * | **resumed-cd** | `resume` | `cd sub`, plain | a resumed Codex thread changes cwd before its next turn |
 * | **resumed-after-cd** | `resume` | plain | does a `cd` in the launch before move what the NEXT resume reports? |
 *
 * ⚑ **The search shape** (standing rule 4): every key named `cwd`, at any depth, in every
 * notification and in every `thread/*` response; and every `<cwd>…</cwd>` in every model-bound
 * request, which is where Codex tells its model the working directory. ⚑ **Its positive control**:
 * the `pwd` the command printed, which must name `sub` — the move happened, so a search that finds
 * no moved thread cwd is looking at a thread that had one to report.
 *
 * *"This captures what the provider put in its model-bound request, not a hosted model's obedience
 * to the text."*
 *
 * Run: `pnpm run probe:codex-resume-after-cd`. Not part of `pnpm run ci`.
 */

const MODEL = 'gpt-5.6-luna'
const KEY = 'BROBOT_715_CAPTURE_KEY'
const MOVE = '715 · move into the subfolder'
const SUB = 'sub'
const CALL_ID = 'call_715_'

const LAUNCHES = {
  'fresh-cd': { opens: 'start', turns: [MOVE, '715 · after the move'] },
  'resumed-plain': { opens: 'resume', turns: ['715 · plain'] },
  'resumed-cd': { opens: 'resume', turns: [MOVE, '715 · after the move'] },
  'resumed-after-cd': { opens: 'resume', turns: ['715 · reopened after a move'] },
} as const satisfies Record<string, { opens: 'start' | 'resume'; turns: readonly string[] }>
type Launch = keyof typeof LAUNCHES

/** ⚠️ Bounded, standing rule 13 — a stalled app-server is NOT PERFORMED, never waited on. */
const OPEN_DEADLINE_MS = 30_000
const RPC_DEADLINE_MS = 10_000
/** ⚑ The scripted model answers at once; a turn with a command ends in about a second. */
const TURN_DEADLINE_MS = 20_000
const SETTLE_MS = 500
const EXIT_GRACE_MS = 2_000
const KILL_GRACE_MS = 2_000
const PUMP_MS = 5_000
const CLOSE_MS = EXIT_GRACE_MS + 2 * KILL_GRACE_MS + PUMP_MS
const TEARDOWN_MS = CLOSE_MS

const deadline = probeRunDeadline(
  '715 codex resume-after-cd probe',
  runBudgetMs(
    // ⛔ **Every wait a launch can make, counted where it is made**: the open, each turn's send and
    // its end, the settle, the close.
    Object.values(LAUNCHES).map(
      (launch) =>
        OPEN_DEADLINE_MS +
        launch.turns.length * (RPC_DEADLINE_MS + TURN_DEADLINE_MS) +
        SETTLE_MS +
        CLOSE_MS,
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

/** Every key named `cwd`, at any depth, with the path it was found at. */
function cwdsIn(value: unknown, at: string, into: { at: string; cwd: string }[]): void {
  if (Array.isArray(value)) {
    value.forEach((one, index) => cwdsIn(one, `${at}[${String(index)}]`, into))
    return
  }
  if (!isRecord(value)) return
  for (const [key, one] of Object.entries(value)) {
    if (key === 'cwd' && typeof one === 'string') into.push({ at: `${at}.cwd`, cwd: one })
    else cwdsIn(one, `${at}.${key}`, into)
  }
}

/** ⚑ The product's transport, with `672`'s one substitution, recording every cwd it carries. */
class Recorded implements CodexTransport {
  readonly cwds: { at: string; cwd: string }[] = []
  readonly responses: { method: string; result: unknown }[] = []
  /** Every command Codex reports finishing — where it ran and what it printed. */
  readonly commands: { command: string; cwd: string; output: string }[] = []
  constructor(private readonly inner: SpawnCodexTransport) {}
  get pid(): number | undefined {
    return this.inner.pid
  }
  async request(method: string, params: unknown): Promise<unknown> {
    if (method === 'getAuthStatus') {
      return { authMethod: 'apikey', authToken: null, requiresOpenaiAuth: false }
    }
    if (method === 'account/read') {
      return { account: { type: 'apiKey' }, requiresOpenaiAuth: false }
    }
    const result = await Promise.resolve(this.inner.request(method, params))
    if (method.startsWith('thread/')) {
      this.responses.push({ method, result })
      cwdsIn(result, `response ${method}`, this.cwds)
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
      if (frame.kind === 'notification') {
        cwdsIn(frame.params, frame.method, this.cwds)
        const item = isRecord(frame.params) ? frame.params['item'] : undefined
        if (
          frame.method === 'item/completed' &&
          isRecord(item) &&
          item['type'] === 'commandExecution'
        ) {
          this.commands.push({
            command: String(item['command']),
            cwd: String(item['cwd']),
            output: String(item['aggregatedOutput']),
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

function send(response: ServerResponse, kind: string, payload: Record<string, unknown>): void {
  response.write(`event: ${kind}\ndata: ${JSON.stringify({ type: kind, ...payload })}\n\n`)
}

const USAGE = {
  input_tokens: 11,
  input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
  output_tokens: 1,
  output_tokens_details: { reasoning_tokens: 0 },
  total_tokens: 12,
}

/**
 * ⚑ **Does this request still owe a move?** — every {@link MOVE} a user item asked for, against every
 * `exec` call of ours whose output has come back. Counted over the WHOLE input, the Claude probe's
 * reason: reading the last item's shape is how a script ends up calling the tool in a loop.
 */
function owesAMove(body: unknown): boolean {
  const input = isRecord(body) && Array.isArray(body['input']) ? body['input'] : []
  let moves = 0
  let answered = 0
  for (const item of input) {
    if (!isRecord(item)) continue
    if (item['type'] === 'custom_tool_call_output' && String(item['call_id']).startsWith(CALL_ID))
      answered += 1
    if (item['role'] !== 'user' || !Array.isArray(item['content'])) continue
    for (const part of item['content']) {
      if (isRecord(part) && typeof part['text'] === 'string')
        moves += part['text'].split(MOVE).length - 1
    }
  }
  return moves > answered
}

/** A model that `cd`s when asked to and answers `ok` otherwise, keeping every request it was sent. */
function scriptedModel(cwd: () => string): { server: Server; bodies: unknown[] } {
  const bodies: unknown[] = []
  let count = 0
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      count += 1
      const id = `resp_715_${String(count)}`
      let body: unknown
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        body = null
      }
      bodies.push(body)
      response.statusCode = 200
      response.setHeader('content-type', 'text/event-stream')
      send(response, 'response.created', { response: { id } })
      const item = owesAMove(body)
        ? {
            type: 'custom_tool_call',
            id: `ctc_715_${String(count)}`,
            call_id: `${CALL_ID}${String(count)}`,
            name: 'exec',
            input: [
              `const answer = await tools.exec_command(${JSON.stringify({ cmd: `cd ${SUB} && pwd`, workdir: cwd() })})`,
              'text("BROBOT715:" + JSON.stringify(answer))',
            ].join('\n'),
            status: 'completed',
          }
        : {
            type: 'message',
            id: `msg_${id}`,
            status: 'completed',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'ok', annotations: [] }],
          }
      send(response, 'response.output_item.done', { output_index: 0, item })
      send(response, 'response.completed', { response: { id, usage: USAGE } })
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
    'name = "BroBot 715 cwd capture"',
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

interface LaunchResult {
  readonly launch: Launch
  readonly failure: string | null
  /** Why the product refused to reopen the thread — the barrier's own words — or null. */
  readonly refused: string | null
  readonly listenedOn: number
  readonly configuredBefore: number | null
  readonly configuredAfter: number | null
  /** Every `cwd` key Codex sent this launch, in a notification or a `thread/*` response. */
  readonly cwds: readonly { at: string; cwd: string }[]
  /**
   * Every `<cwd>…</cwd>` in each of this launch's model-bound requests, one list per request — what
   * Codex told its model. ⚠️ A request carries the thread's history, so an unchanged count means no
   * NEW working directory was told; a move would add one.
   */
  readonly toldTheModel: readonly (readonly string[])[]
  /** Every command Codex reported finishing: where it ran, and what it printed — `pwd`'s answer. */
  readonly commands: readonly { command: string; cwd: string; output: string }[]
  readonly refAfter: SessionRef | null
  readonly ended: readonly string[]
  readonly fatal: readonly string[]
}

interface Shared {
  readonly root: string
  readonly home: string
  readonly cwd: string
  readonly model: { server: Server; bodies: unknown[] }
  readonly listenedOn: number
  ref: SessionRef | null
}

let shared: Shared | null = null

async function theThread(): Promise<Shared> {
  if (shared !== null) return shared
  const scratch = runScratch('codex-resume-after-cd')
  mkdirSync(scratch, { recursive: true })
  const root = mkdtempSync(join(scratch, 'thread-'))
  const home = join(root, 'home')
  const cwd = join(root, 'cwd')
  mkdirSync(home, { recursive: true })
  mkdirSync(join(cwd, SUB), { recursive: true })
  const model = scriptedModel(() => cwd)
  const listenedOn = await new Promise<number>((resolve, reject) => {
    model.server.once('error', reject)
    model.server.listen(0, '127.0.0.1', () => {
      const address = model.server.address()
      if (address === null || typeof address === 'string') reject(new Error('no loopback port'))
      else resolve(address.port)
    })
  })
  writeFileSync(join(home, 'config.toml'), providerStanza(listenedOn))
  shared = { root, home, cwd, model, listenedOn, ref: null }
  return shared
}

async function runLaunch(launch: Launch, thread: Shared): Promise<LaunchResult> {
  deadline.refuse(`launch ${launch}`)
  const plan = LAUNCHES[launch]
  const transports: Recorded[] = []
  let handle: SessionHandle | null = null
  let pump: Promise<void> | null = null
  const closeOwned = async (): Promise<void> => {
    if (handle !== null) await handle.close().catch(() => {})
    if (pump !== null) {
      await Promise.race([pump, new Promise((resolve) => setTimeout(resolve, PUMP_MS).unref())])
    }
    for (const one of transports) await Promise.resolve(one.close()).catch(() => {})
  }
  // ⛔ An expired deadline tears down the app-server AND the scripted model — no later launch runs.
  const release = deadline.own(async () => {
    await closeOwned()
    thread.model.server.closeAllConnections()
    if (thread.model.server.listening) {
      await new Promise<void>((resolve) => thread.model.server.close(() => resolve()))
    }
  })
  const bodiesBefore = thread.model.bodies.length
  let failure: string | null = null
  let refused: string | null = null
  let refAfter: SessionRef | null = null
  const ended: string[] = []
  const fatal: string[] = []
  const configuredBefore = configuredPortOf(thread.home)
  let configuredAfter: number | null = null
  try {
    if (configuredBefore !== thread.listenedOn) {
      throw new Error(
        `NOT PERFORMED — the config names port ${String(configuredBefore)}, the endpoint is on ${String(thread.listenedOn)}`,
      )
    }
    const factory: TransportFactory = (context) => {
      const transport = new Recorded(
        new SpawnCodexTransport(bundledCodexBinary(), codexAppServerArgs(), {
          cwd: context.cwd,
          env: {
            PATH: process.env['PATH'] ?? '',
            HOME: thread.root,
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
    const context = { providerHome: thread.home, approvalMode: 'auto' as const, model: MODEL }
    let opened: SessionHandle | null = null
    try {
      opened = await bounded(`${launch} open`, OPEN_DEADLINE_MS, (signal) =>
        plan.opens === 'start'
          ? runtime.start({ cwd: thread.cwd, ...context, signal })
          : thread.ref === null
            ? Promise.reject(new Error('NOT PERFORMED — no thread to resume'))
            : runtime.resume(thread.ref, { ...context, signal }),
      )
    } catch (error) {
      // ⚑ The barrier refusing is this probe's FINDING, not a probe that could not run.
      if (plan.opens === 'resume' && /resume mismatch/.test(errorText(error))) {
        refused = errorText(error)
      } else throw error
    }
    handle = opened
    const live = opened
    if (live !== null) {
      const events: RuntimeEvent[] = []
      pump = (async () => {
        for await (const event of live.events()) {
          events.push(event)
          if (event.type === 'turn') ended.push(event.state)
          if (event.type === 'error' && event.fatal) fatal.push(event.message)
        }
      })()
      configuredAfter = configuredPortOf(thread.home)
      for (const words of plan.turns) {
        const before = ended.length
        await bounded(`${launch}: send`, RPC_DEADLINE_MS, () => live.send(words))
        await until(
          `${launch}: the turn`,
          TURN_DEADLINE_MS,
          () => ended.length > before || fatal.length > 0,
        )
        if (fatal.length > 0) break
      }
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
      refAfter = live.ref
      if (plan.opens === 'start') thread.ref = live.ref
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
  const bodies = thread.model.bodies.slice(bodiesBefore)
  return {
    launch,
    failure,
    refused,
    listenedOn: thread.listenedOn,
    configuredBefore,
    configuredAfter,
    cwds: transports.flatMap((one) => one.cwds),
    toldTheModel: bodies.map((body) =>
      [...JSON.stringify(body).matchAll(/<cwd>([^<]*)<\/cwd>/g)].map((match) => match[1] ?? ''),
    ),
    commands: transports.flatMap((one) => one.commands),
    refAfter,
    ended,
    fatal,
  }
}

const results: LaunchResult[] = []
/** The launches whose every check held — the root is deleted only when all of them did. */
const held = new Set<Launch>()

for (const launch of Object.keys(LAUNCHES) as Launch[]) {
  it(
    `715 · codex · ${launch}`,
    () =>
      deadline.within(`launch ${launch}`, async () => {
        const result = await runLaunch(launch, await theThread())
        results.push(result)
        const cwd = shared?.cwd ?? '<no cwd>'
        const scrub = (value: unknown): unknown =>
          JSON.parse(JSON.stringify(value).replaceAll(cwd, '<launch>')) as unknown
        const evidence = runEvidence('715-codex-resume-after-cd')
        mkdirSync(evidence, { recursive: true })
        writeFileSync(join(evidence, `${launch}.json`), `${JSON.stringify(result, null, 2)}\n`)
        console.log(`[715 · codex · ${launch}]`, JSON.stringify(scrub(result), null, 2))
        expect(result.failure, 'NOT PERFORMED').toBeNull()
        if (result.refused !== null) {
          held.add(launch)
          return
        }
        // ⚑ Rule 40, before the launch and after it.
        expect(result.configuredBefore).toBe(result.listenedOn)
        expect(result.configuredAfter).toBe(result.listenedOn)
        // ⚑ …and this launch's turns REACHED it (715's review): the config above is this probe's
        // own file, so what proves the child talked to the fake is the fake being asked, and every
        // turn the launch sent ending `completed`.
        expect(result.toldTheModel.length, 'no request reached the loopback').toBeGreaterThan(0)
        expect(result.ended).toEqual(LAUNCHES[launch].turns.map(() => 'completed'))
        held.add(launch)
      }),
    deadline.testTimeoutMs,
  )
}

it(
  '715 · codex · the search found what it was looking for',
  () =>
    deadline.within('the controls', async () => {
      try {
        const moved = results.filter((one) =>
          (LAUNCHES[one.launch].turns as readonly string[]).includes(MOVE),
        )
        expect(moved.map((one) => one.launch)).toEqual(['fresh-cd', 'resumed-cd'])
        // ⚑ **The positive control**: every launch that asked for a move ran `cd` and printed a
        // `pwd` inside the subfolder — the move happened, so a thread cwd that stayed put is a
        // finding about Codex rather than a search that never had a move to see.
        for (const one of moved) {
          expect(
            one.commands.some(
              (command) =>
                command.command.includes(`cd ${SUB}`) &&
                command.output.trim() === join(shared?.cwd ?? '<no cwd>', SUB),
            ),
            `${one.launch}: the command never printed ${SUB}`,
          ).toBe(true)
        }
        // ⚑ …and the search reads cwd keys at all: the handshake's own `thread.cwd` is one.
        for (const one of results.filter((result) => result.refused === null)) {
          expect(
            one.cwds.some((found) => found.at.startsWith('response thread/')),
            `${one.launch}: no thread response carried a cwd`,
          ).toBe(true)
        }
      } finally {
        if (shared !== null) {
          shared.model.server.closeAllConnections()
          if (shared.model.server.listening) {
            await new Promise<void>((resolve) => shared!.model.server.close(() => resolve()))
          }
          // ⚠️ Only a run whose every launch held deletes its root; a failing one leaves it.
          if (results.length > 0 && held.size === results.length) {
            rmSync(shared.root, { recursive: true, force: true })
          }
        }
      }
    }),
  deadline.testTimeoutMs,
)
