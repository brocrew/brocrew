import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { expect, it } from 'vitest'
// 🔒 **A deep import, and deliberately** — `codex-reopen-grant-probe.smoke.ts`'s reason: this probe
// owns its spawn so it can put the loopback provider's `env_key` in the child environment, which
// `createSpawnTransportFactory` sanitizes away. ⚑ Everything else is the PRODUCT's door:
// `CodexRuntime.start` → `close` → `CodexRuntime.resume`.
import {
  SpawnCodexTransport,
  type CodexIncoming,
  type CodexTransport,
} from '../src/codex/codex-transport'
import { CodexRuntime, codexAppServerArgs, type TransportFactory } from '../src/codex/codex-runtime'
import type { RuntimeEvent } from '../src/events'
import { ResumeError, type SessionHandle } from '../src/runtime'
import type { SessionRef } from '../src/session-ref'
import { bundledCodexBinary } from './bundled-codex'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

/**
 * 🔴 **706 · what does Codex answer when the thread a resume names is GONE — and what does a resume
 * that failed for a moment look like beside it?** (`705` F-3)
 *
 * ## ⛔ The question, and why the code could not answer it
 *
 * Until `706` the host let go of a conversation the quit left open only when its resume was refused
 * with a `ResumeError` that carried NO cause — Claude's *"session not found"* has none. ⚠️ Codex's
 * adapter wraps every failure of `begin` with the failure as `cause` (`673`), so a thread Codex no
 * longer had was never let go: every press failed again, forever. ⚑ Since `706` it reads the
 * adapter's `ResumeError.noSuchSession`, and this probe is what that adapter's answer is measured by. ⛔ And *"has a cause"* was never what told a
 * never from a failure of this attempt; it was only what Claude's shape happened to be. `705` F-3
 * named the defect by reading; this measures the shape the app-server actually answers with.
 *
 * ## ⚑ The instrument — `581`'s recipe, through the product's runtime (`697`'s rig)
 *
 * Run the bundled binary against a `listen(0)` loopback endpoint completing each turn with
 * one word. Each arm owns scratch root, `HOME`, `CODEX_HOME`, `CODEX_SQLITE_HOME`, and cwd.
 * Use no account, token, spend, or `auth.json`; touch no personal provider homes, `~/.codex`,
 * or `:9444`, and launch no Electron. Substitute only `getAuthStatus` and `account/read` as
 * API-key sign-in, since the loopback provider has none and the product gate would return
 * `absent`. Forward everything else.
 *
 * ## ⚑ The arms — three nevers, a positive control, and the transient control
 *
 * | arm | before the resume | what it establishes |
 * |---|---|---|
 * | **live** | start · one turn · close | the rig CAN resume: the same resume of a thread that exists succeeds |
 * | **never-issued** | nothing — a UUIDv7 nobody issued | the app-server's answer for an id it never had |
 * | **rollout-gone** | start · one turn · close · delete the thread's rollout file | a thread whose history is gone from disk |
 * | **home-wiped** | start · one turn · close · wipe the home, write its config again | a home cleaned under a conversation that outlived it |
 * | **died** | start · one turn · close · the app-server killed as `thread/resume` is asked | ⛔ **a failure of THIS attempt** — the next press may work, so it must never be read as a never |
 *
 * ⚠️ *"This captures what the provider put in its model-bound request, not a hosted model's
 * obedience to the text."* (`581`) — here no model is asked anything on a resume; what is measured is
 * what the APP-SERVER answers `thread/resume` with, and what the product's adapter makes of it.
 *
 * ## ⚑ Measured — 2026-09-24, `706`, bundled `codex-cli 0.146.0` (the run's evidence JSON has the bodies)
 *
 * | arm | what `thread/resume` was answered with, on the wire | the product's `ResumeError` |
 * |---|---|---|
 * | live | a matching thread — resumed | — |
 * | never-issued | `{"code":-32600,"message":"no rollout found for thread id <id>"}` | `noSuchSession: true` |
 * | rollout-gone | `{"code":-32600,"message":"failed to resolve rollout path \`<home>/sessions/…/rollout-…-<id>.jsonl\`: file does not exist"}` | `noSuchSession: true` |
 * | home-wiped | `{"code":-32600,"message":"no rollout found for thread id <id>"}` | `noSuchSession: true` |
 * | died | no answer — the transport's `codex app-server exited` | `noSuchSession: false` |
 *
 * ⚠️ **The code is the same for all three nevers and says nothing on its own** — `-32600` is JSON-RPC's
 * *invalid request*. ⚑ So `codex/lost-thread.ts` reads the refusal in full and asks the disk; this
 * probe asserts the adapter's answer for every arm, so a Codex that rewords a refusal is a red run
 * here (and a conversation that is never let go in the app — never one that is forgotten).
 *
 * Run: `pnpm run probe:codex-lost-thread`. Not part of `pnpm run ci`.
 */

const MODEL = 'gpt-5.6-luna'
const KEY = 'BROBOT_706_CAPTURE_KEY'

/** ⛔ The arms, as one table the budget is counted from — see the docblock's. */
const ARMS = {
  live: { opens: 2, turns: 1 },
  'never-issued': { opens: 1, turns: 0 },
  'rollout-gone': { opens: 2, turns: 1 },
  'home-wiped': { opens: 2, turns: 1 },
  died: { opens: 2, turns: 1 },
} as const
type Arm = keyof typeof ARMS

/** ⚠️ Bounded, standing rule 13 — a stalled app-server is NOT PERFORMED, never waited on. */
const OPEN_DEADLINE_MS = 30_000
const TURN_DEADLINE_MS = 30_000
const EXIT_GRACE_MS = 2_000
const KILL_GRACE_MS = 2_000
const PUMP_MS = 5_000
/** ⚠️ A session close, not a transport close — `697`'s sizing of the same path. */
const CLOSE_FLUSH_MS = 2_000
const CLOSE_INTERRUPT_MS = 2_000
const CLOSE_MS = CLOSE_FLUSH_MS + CLOSE_INTERRUPT_MS + EXIT_GRACE_MS + 2 * KILL_GRACE_MS + PUMP_MS
const TEARDOWN_MS = CLOSE_MS

const deadline = probeRunDeadline(
  '706 codex lost-thread probe',
  runBudgetMs(
    Object.values(ARMS).flatMap((arm) => [
      ...Array.from({ length: arm.opens }, () => OPEN_DEADLINE_MS + CLOSE_MS),
      ...Array.from({ length: arm.turns }, () => TURN_DEADLINE_MS),
    ]),
  ),
  TEARDOWN_MS,
)

/** One link of an error's cause chain, as it is — its class, its words, and every own field. */
interface Link {
  readonly name: string
  readonly message: string
  readonly fields: Record<string, unknown>
}

function chainOf(error: unknown): Link[] {
  const links: Link[] = []
  const seen = new Set<unknown>()
  let link: unknown = error
  while (link !== undefined && link !== null && !seen.has(link) && links.length < 8) {
    seen.add(link)
    if (link instanceof Error) {
      const fields: Record<string, unknown> = {}
      for (const key of Object.keys(link)) {
        const value = (link as unknown as Record<string, unknown>)[key]
        fields[key] =
          key === 'cause' ? '(next link)' : key === 'ref' ? '(the ref resumed)' : (value ?? null)
      }
      links.push({ name: link.constructor.name, message: link.message, fields })
      link = link.cause
    } else {
      links.push({ name: typeof link, message: String(link), fields: {} })
      link = undefined
    }
  }
  return links
}

/**
 * ⚑ The product's transport, with the one substitution the header names — plus a record of what
 * `thread/resume` was answered with ON THE WIRE, before the adapter wraps it, and the `died` arm's
 * kill.
 */
class SignedInAsAKey implements CodexTransport {
  readonly resumeRefusals: Link[][] = []
  constructor(
    private readonly inner: SpawnCodexTransport,
    private readonly dieAtResume: boolean,
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
    if (method !== 'thread/resume') return this.inner.request(method, params)
    // ⛔ **The transient control**: the app-server dies as the handshake's last question is asked —
    // the shape of a child that crashed, or was killed, mid-launch. The next attempt starts a new one.
    if (this.dieAtResume && this.inner.pid !== undefined) process.kill(this.inner.pid, 'SIGKILL')
    return this.inner.request(method, params).catch((error: unknown) => {
      this.resumeRefusals.push(chainOf(error))
      throw error
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
  incoming(): AsyncIterable<CodexIncoming> {
    return this.inner.incoming()
  }
  close(): void | Promise<void> {
    return this.inner.close()
  }
}

function stream(response: ServerResponse, index: number): void {
  const send = (kind: string, payload: Record<string, unknown>): void => {
    response.write(`event: ${kind}\ndata: ${JSON.stringify({ type: kind, ...payload })}\n\n`)
  }
  response.statusCode = 200
  response.setHeader('content-type', 'text/event-stream')
  response.setHeader('cache-control', 'no-cache')
  response.setHeader('connection', 'keep-alive')
  send('response.created', { response: { id: `resp_706_${String(index)}` } })
  send('response.output_item.done', {
    output_index: 0,
    item: {
      type: 'message',
      id: `msg_706_${String(index)}`,
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'ok', annotations: [] }],
    },
  })
  send('response.completed', {
    response: {
      id: `resp_706_${String(index)}`,
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
}

/** ⚑ A model that completes every turn with one word, and counts what reached it. */
function oneWordModel(): { server: Server; requests: () => number } {
  let count = 0
  const server = createServer((request, response) => {
    request.on('data', () => {})
    request.on('end', () => {
      count += 1
      stream(response, count)
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
    'name = "BroBot 706 lost-thread capture"',
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

/** Every rollout file under a home whose name carries the thread id — the thread's history on disk. */
function rolloutsOf(home: string, threadId: string): string[] {
  const found: string[] = []
  const walk = (dir: string, depth: number): void => {
    if (depth > 6 || !existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path, depth + 1)
      else if (entry.name.includes(threadId)) found.push(path)
    }
  }
  walk(join(home, 'sessions'), 0)
  walk(join(home, 'archived_sessions'), 0)
  return found
}

/** ⚑ A UUIDv7 in the shape Codex issues, which no app-server issued. */
const NEVER_ISSUED = '01990000-0000-7000-8000-000000000706'

interface ArmResult {
  readonly arm: Arm
  /** ⛔ The RIG's failure — an arm that was not measured. `null` when it was. */
  readonly failure: string | null
  readonly listenedOn: number
  readonly configuredBefore: number | null
  readonly configuredAfter: number | null
  readonly modelRequests: number
  /** The rollout files the arm removed (`rollout-gone`) — what "gone" meant, on disk. */
  readonly removed: readonly string[]
  /** ⚑ The resume's outcome through the product's `CodexRuntime.resume`. */
  readonly resumed: boolean
  readonly thrown: readonly Link[] | null
  readonly isResumeError: boolean
  /** ⚑ The product's answer to *does the provider still have it* — `ResumeError.noSuchSession`. */
  readonly noSuchSession: boolean | null
  /** ⚑ What `thread/resume` was refused with on the wire, before the adapter wrapped it. */
  readonly wire: readonly (readonly Link[])[]
}

async function runArm(arm: Arm, root: string): Promise<ArmResult> {
  deadline.refuse(`arm ${arm}`)
  const armRoot = mkdtempSync(join(root, `${arm}-`))
  const home = join(armRoot, 'home')
  const cwd = join(armRoot, 'cwd')
  mkdirSync(home, { recursive: true })
  mkdirSync(cwd, { recursive: true })
  const model = oneWordModel()
  const handles: SessionHandle[] = []
  const pumps: Promise<void>[] = []
  const transports: SignedInAsAKey[] = []
  const closeOwned = async (): Promise<void> => {
    try {
      for (const one of handles) await one.close().catch(() => {})
      await Promise.race([
        Promise.all(pumps),
        new Promise((resolve) => setTimeout(resolve, PUMP_MS).unref()),
      ])
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
  let removed: string[] = []
  let resumed = false
  let thrown: Link[] | null = null
  let isResumeError = false
  let noSuchSession: boolean | null = null
  let resumeTransport: SignedInAsAKey | null = null
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
    let dieAtResume = false
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
        dieAtResume,
      )
      transports.push(transport)
      return transport
    }
    const runtime = new CodexRuntime(factory)
    const own = (handle: SessionHandle): SessionHandle => {
      handles.push(handle)
      const events: RuntimeEvent[] = []
      pumps.push(
        (async () => {
          for await (const event of handle.events()) events.push(event)
        })(),
      )
      ;(handle as SessionHandle & { seen?: RuntimeEvent[] }).seen = events
      return handle
    }
    const turnsEnded = (handle: SessionHandle): number =>
      ((handle as SessionHandle & { seen?: RuntimeEvent[] }).seen ?? []).filter(
        (event) => event.type === 'turn',
      ).length

    let ref: SessionRef
    if (ARMS[arm].turns === 0) {
      ref = { provider: 'codex', sessionId: NEVER_ISSUED, cwd, rotation: 0 }
    } else {
      const first = own(
        await bounded(`${arm} start`, OPEN_DEADLINE_MS, (signal) =>
          runtime.start({ cwd, providerHome: home, approvalMode: 'ask', model: MODEL, signal }),
        ),
      )
      await bounded(`${arm} turn`, TURN_DEADLINE_MS, async (signal) => {
        await first.send('706 one turn, so the thread has a history on disk')
        // ⛔ The loop stops with its bound (rule 13) — a stalled turn must not leave it polling.
        while (turnsEnded(first) < 1 && !signal.aborted) {
          await new Promise((resolve) => setTimeout(resolve, 25))
        }
      })
      await first.close()
      if (first.ref === null) throw new Error('NOT PERFORMED — the first launch issued no ref')
      ref = first.ref
      if (rolloutsOf(home, ref.sessionId).length === 0) {
        throw new Error('NOT PERFORMED — the turn wrote no rollout to remove or to resume')
      }
      if (arm === 'rollout-gone') {
        removed = rolloutsOf(home, ref.sessionId)
        for (const path of removed) rmSync(path, { force: true })
      }
      if (arm === 'home-wiped') {
        rmSync(home, { recursive: true, force: true })
        mkdirSync(home, { recursive: true })
        writeFileSync(join(home, 'config.toml'), providerStanza(listenedOn))
      }
      dieAtResume = arm === 'died'
    }
    const before = transports.length
    try {
      own(
        await bounded(`${arm} resume`, OPEN_DEADLINE_MS, (signal) =>
          runtime.resume(ref, { providerHome: home, approvalMode: 'ask', model: MODEL, signal }),
        ),
      )
      resumed = true
    } catch (error) {
      // ⛔ The rig's own bound is NOT an answer — a resume that never settled was not measured.
      if (error instanceof Error && error.message.startsWith('NOT PERFORMED')) throw error
      thrown = chainOf(error)
      isResumeError = error instanceof ResumeError
      noSuchSession = error instanceof ResumeError ? error.noSuchSession : null
    }
    resumeTransport = transports[before] ?? null
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
  return {
    arm,
    failure,
    listenedOn,
    configuredBefore,
    configuredAfter,
    modelRequests: model.requests(),
    removed,
    resumed,
    thrown,
    isResumeError,
    noSuchSession,
    wire: resumeTransport?.resumeRefusals ?? [],
  }
}

async function measureAndCheck(): Promise<void> {
  deadline.refuse('starting')
  const scratch = runScratch('codex-lost-thread')
  mkdirSync(scratch, { recursive: true })
  const root = mkdtempSync(join(scratch, 'run-'))
  const results: ArmResult[] = []
  for (const arm of Object.keys(ARMS) as Arm[]) results.push(await runArm(arm, root))

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
    runEvidence('706-codex-lost-thread.json'),
    JSON.stringify({ codexVersion, results }, null, 1),
  )
  console.log(`706 codex lost-thread · ${codexVersion} · ${JSON.stringify(results, null, 1)}`)

  // ⛔ **Every arm MEASURED, or the run says which was not** — a silent arm is a green run.
  for (const one of results) expect(one.failure, `arm ${one.arm}`).toBeNull()
  const of = (arm: Arm): ArmResult => {
    const found = results.find((one) => one.arm === arm)
    if (found === undefined) throw new Error(`arm ${arm} missing`)
    return found
  }
  // ⚑ The positive control: the rig resumes a thread that exists.
  expect(of('live').resumed).toBe(true)
  // ⚑ Every other arm was refused, and refused as a `ResumeError`.
  for (const arm of ['never-issued', 'rollout-gone', 'home-wiped', 'died'] as const) {
    expect(of(arm).resumed, `arm ${arm}`).toBe(false)
    expect(of(arm).isResumeError, `arm ${arm}`).toBe(true)
  }
  // 🔴 **The product's answer** — the three nevers are a thread the provider does not have…
  for (const arm of ['never-issued', 'rollout-gone', 'home-wiped'] as const) {
    expect(of(arm).noSuchSession, `arm ${arm}`).toBe(true)
  }
  // ⛔ …and an app-server that died is a failure of the attempt, never one.
  expect(of('died').noSuchSession).toBe(false)
  // ⚑ The premise the control stands on: it died on the wire, not in a refusal it answered.
  expect(
    of('died')
      .wire.flat()
      .map((link) => link.message),
  ).toContain('codex app-server exited')
  // ⚠️ Only a run whose every arm was measured deletes its root (`649` F6).
  rmSync(root, { recursive: true, force: true })
}

it(
  '706 · what Codex answers a resume of a thread it no longer has — and a resume that died',
  () => deadline.within('measuring the five arms', measureAndCheck),
  deadline.testTimeoutMs,
)
