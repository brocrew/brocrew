import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { expect, it } from 'vitest'
// 🔒 **A deep import, and deliberately** — `codex-dynamic-tools-probe.smoke.ts`'s reason, verbatim:
// this probe owns its spawn so it can put the loopback provider's `env_key` in the child
// environment, which `createSpawnTransportFactory` sanitizes away.
import { SpawnCodexTransport } from '../src/codex/codex-transport'
import { bundledCodexBinary } from './bundled-codex'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

/**
 * 🔴 **677 · what does a RESUMED Codex thread run on, when the resume names a DIFFERENT model?**
 *
 * ## ⛔ The question, and why the code could not answer it
 *
 * `R25` §1.3 rules that a wake reads a person's CURRENT model choice — and says, in the same
 * breath, *"what a RESUME does with a model different from the one it was launched with is a
 * provider fact: measure it and say it; do not assume."* ⚑ The adapter sends the model on
 * `thread/resume` AND on the first `turn/start` (`codex-runtime.ts`' `threadResumeParams` and
 * `turnStartParams`); the vendored protocol DECLARES both as overrides — *"Configuration overrides
 * for the resumed thread"* and *"Override the model for this turn and subsequent turns"* — and
 * **nothing in the tree has ever measured either against a changed model** (`677`'s map: every
 * resume the repo ever ran named the model it was started with).
 *
 * ## ⚑ The instrument — `314`'s, with the turn allowed to finish
 *
 * Use the bundled binary with an owned `listen(0)` loopback endpoint, temporary `CODEX_HOME`
 * under scratch, and `env_key: 'probe-only'`. Use no account, real token, or spend; leave
 * personal provider homes, `~/.codex`, and `:9444` untouched. Completing each request with a
 * one-word message writes a real rollout, so cross-process resume loads an actual thread.
 *
 * ## 🔴 Seven steps on ONE thread, each a new app-server — which is what a wake is
 *
 * | step | `thread/resume` | first `turn/start` | the question |
 * |---|---|---|---|
 * | **A** | — (`thread/start` with M1) | nothing | the paired positive: a started thread runs on M1 |
 * | **D0** | nothing | nothing | the resume path, asking nothing — ⚠️ M1 is also the config's model, so it cannot tell memory from default |
 * | **C** | `model: M2` | nothing | does the resume's override alone take? |
 * | **D1** | nothing | nothing | …and does it STICK? ⚑ **the memory question** — M2 is not the config's model |
 * | **B** | `model: M1` | `model: M1, effort: high` | the product's own shape on a wake |
 * | **B2** | `model: M1` | `model: M1, effort: low` | a second level, told apart from a constant |
 * | **D2** | nothing | nothing | …and does an EFFORT stick the way a model does? |
 *
 * ⚠️ *"This captures what the provider put in its model-bound request, not a hosted model's
 * obedience to the text."* (`581`) — here that is exactly the question: which model the request
 * NAMES.
 *
 * ## ⚑ Measured — 2026-09-23, `677`, bundled codex 0.146.0 (the run's evidence JSON has the bodies)
 *
 * | step | model named in the request | `reasoning.effort` |
 * |---|---|---|
 * | A | `gpt-5.6-luna` | `medium` (nothing asked) |
 * | D0 | `gpt-5.6-luna` | `medium` |
 * | C | `gpt-5.6-terra` | `medium` |
 * | D1 | **`gpt-5.6-terra`** — the resume's model STUCK to the thread | `medium` |
 * | B | `gpt-5.6-luna` | `high` |
 * | B2 | `gpt-5.6-luna` | `low` |
 * | D2 | `gpt-5.6-luna` | **`low`** — the effort STUCK too |
 *
 * ⚠️ **The findings are printed and written to the evidence, not asserted** — a changed provider is
 * a new measurement, not a red run. Re-run and compare before relying on this table.
 *
 * Run: `pnpm run probe:codex-resume-model`. Not part of `pnpm run ci`.
 */

const M1 = 'gpt-5.6-luna'
const M2 = 'gpt-5.6-terra'

/** ⛔ The steps, as one table the budget is counted from — see the docblock's. */
const STEPS = {
  A: { resume: null, turn: {} },
  D0: { resume: {}, turn: {} },
  C: { resume: { model: M2 }, turn: {} },
  D1: { resume: {}, turn: {} },
  B: { resume: { model: M1 }, turn: { model: M1, effort: 'high' } },
  // ⚑ A second level, so an effort that rides the request is told apart from a constant…
  B2: { resume: { model: M1 }, turn: { model: M1, effort: 'low' } },
  // ⚑ …and whether an effort STICKS to the thread the way a model does.
  D2: { resume: {}, turn: {} },
} as const satisfies Record<
  string,
  { resume: Record<string, string> | null; turn: Record<string, string> }
>
type Step = keyof typeof STEPS

/** ⚠️ Bounded, standing rule 13 — a stalled app-server is NOT PERFORMED, never waited on. */
const RPC_DEADLINE_MS = 30_000
const TURN_DEADLINE_MS = 60_000
const EXIT_GRACE_MS = 2_000
const KILL_GRACE_MS = 2_000
const TEARDOWN_MS = EXIT_GRACE_MS + 2 * KILL_GRACE_MS

/** One step's worst case: `initialize`, `thread/*`, the turn, the close. */
const SERIAL_WAITS_MS = [RPC_DEADLINE_MS, RPC_DEADLINE_MS, TURN_DEADLINE_MS, TEARDOWN_MS]

const deadline = probeRunDeadline(
  '677 codex resume-model probe',
  runBudgetMs(Object.keys(STEPS).flatMap(() => SERIAL_WAITS_MS)),
  TEARDOWN_MS,
)

function providerStanza(port: number): string {
  return [
    `model = "${M1}"`,
    'model_provider = "capture"',
    '',
    '[model_providers.capture]',
    'name = "BroBot 677 capture"',
    `base_url = "http://127.0.0.1:${port}/v1"`,
    'env_key = "BROBOT_677_CAPTURE_KEY"',
    'request_max_retries = 0',
    'stream_max_retries = 0',
    '',
  ].join('\n')
}

/** ⚑ Rule 40: the port the child was CONFIGURED with, read back from the file it reads. */
function configuredPortOf(config: string): number | null {
  const match = /^base_url = "http:\/\/127\.0\.0\.1:(\d+)\/v1"$/m.exec(config)
  return match === null ? null : Number(match[1])
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

/** A completed one-word turn — the shape `codex-tool-answer-probe`'s closing turn streams. */
function streamDone(response: ServerResponse, index: number): void {
  const send = (kind: string, payload: Record<string, unknown>): void => {
    response.write(`event: ${kind}\ndata: ${JSON.stringify({ type: kind, ...payload })}\n\n`)
  }
  response.statusCode = 200
  response.setHeader('content-type', 'text/event-stream')
  response.setHeader('cache-control', 'no-cache')
  response.setHeader('connection', 'keep-alive')
  send('response.created', { response: { id: `resp_677_${index}` } })
  send('response.output_item.done', {
    output_index: 0,
    item: {
      type: 'message',
      id: `msg_677_${index}`,
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'ok', annotations: [] }],
    },
  })
  send('response.completed', {
    response: {
      id: `resp_677_${index}`,
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

/** What one step's model-bound request named. */
interface Seen {
  readonly step: Step
  readonly model: unknown
  readonly effort: unknown
  readonly failure: string | null
}

async function measure(): Promise<Seen[]> {
  deadline.refuse('starting')
  const scratch = runScratch('codex-resume-model')
  mkdirSync(scratch, { recursive: true })
  const root = mkdtempSync(join(scratch, 'thread-'))
  const home = join(root, 'home')
  const cwd = join(root, 'cwd')
  mkdirSync(home, { recursive: true })
  mkdirSync(cwd, { recursive: true })

  const bodies: Record<string, unknown>[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      try {
        bodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
      } catch {
        bodies.push({ unparsed: Buffer.concat(chunks).toString('utf8') })
      }
      streamDone(response, bodies.length)
    })
  })

  let transport: SpawnCodexTransport | null = null
  let pump: Promise<void> | null = null
  const completed: string[] = []
  const closeCurrent = async (): Promise<void> => {
    try {
      if (transport !== null) await transport.close()
    } finally {
      if (pump !== null) await pump
      transport = null
      pump = null
    }
  }
  const closeOwnedCapture = async (): Promise<void> => {
    try {
      await closeCurrent()
    } finally {
      server.closeAllConnections()
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
  const release = deadline.own(() => closeOwnedCapture())

  const bounded = async <T>(what: string, work: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error(`NOT PERFORMED — ${what} did not answer in ${RPC_DEADLINE_MS}ms`)),
            RPC_DEADLINE_MS,
          )
          timer.unref?.()
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  const seen: Seen[] = []
  let threadId = ''
  let listenedOn: number
  let configuredPort: number | null
  try {
    listenedOn = await listen(server)
    writeFileSync(join(home, 'config.toml'), providerStanza(listenedOn))
    configuredPort = configuredPortOf(readFileSync(join(home, 'config.toml'), 'utf8'))
    // ⚑ **Rule 40, BEFORE the first child starts**: the port the children will be CONFIGURED with is
    // the one `listen(0)` returned — read back from the file they read, not from the variable.
    if (configuredPort !== listenedOn) {
      throw new Error(
        `NOT PERFORMED — the config names port ${String(configuredPort)}, the endpoint is on ${String(listenedOn)}`,
      )
    }

    for (const step of Object.keys(STEPS) as Step[]) {
      deadline.refuse(`step ${step}`)
      const plan = STEPS[step]
      const before = bodies.length
      let failure: string | null = null
      transport = new SpawnCodexTransport(bundledCodexBinary(), ['app-server'], {
        cwd,
        env: {
          PATH: process.env['PATH'] ?? '',
          HOME: root,
          CODEX_HOME: home,
          CODEX_SQLITE_HOME: home,
          BROBOT_677_CAPTURE_KEY: 'probe-only',
        },
        exitGraceMs: EXIT_GRACE_MS,
        killGraceMs: KILL_GRACE_MS,
      })
      const owned = transport
      completed.length = 0
      pump = (async () => {
        for await (const incoming of owned.incoming()) {
          if (incoming.kind === 'notification' && incoming.method === 'turn/completed') {
            completed.push(step)
          }
          if (incoming.kind === 'request') {
            owned.respondError(
              incoming.id,
              -32601,
              `the 677 probe does not implement ${incoming.method}`,
            )
          }
        }
      })()
      try {
        await bounded(
          'initialize',
          owned.request('initialize', {
            clientInfo: {
              name: 'brobot-677-probe',
              title: 'BroBot 677 resume-model probe',
              version: '0.0.0',
            },
            capabilities: { experimentalApi: true, requestAttestation: false },
          }),
        )
        owned.notify('initialized', {})
        const shared = {
          cwd,
          approvalPolicy: 'never',
          approvalsReviewer: 'user',
          sandbox: 'danger-full-access',
        }
        if (plan.resume === null) {
          const started = (await bounded(
            'thread/start',
            owned.request('thread/start', { ...shared, model: M1, modelProvider: 'capture' }),
          )) as { thread?: { id?: string } }
          threadId = started.thread?.id ?? ''
        } else {
          await bounded(
            'thread/resume',
            owned.request('thread/resume', { ...shared, threadId, ...plan.resume }),
          )
        }
        // ⚠️ **Its rejection is KEPT** (review): a turn the app-server refuses would otherwise be an
        // unhandled rejection and this step would report a timeout instead of the protocol's reason.
        let turnRefused: string | null = null
        owned
          .request('turn/start', {
            threadId,
            input: [{ type: 'text', text: `677 step ${step}`, text_elements: [] }],
            cwd,
            approvalPolicy: 'never',
            approvalsReviewer: 'user',
            sandboxPolicy: { type: 'dangerFullAccess' },
            ...plan.turn,
          })
          .catch((error: unknown) => {
            turnRefused = error instanceof Error ? error.message : String(error)
          })
        // ⚠️ **Bounded** (standing rule 13): the request, then the turn's own completion — so the
        // rollout is written before this process is closed and the next step resumes it.
        const by = Date.now() + TURN_DEADLINE_MS
        while (
          (bodies.length <= before || completed.length === 0) &&
          turnRefused === null &&
          Date.now() < by
        ) {
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        if (turnRefused !== null) {
          failure = `the app-server refused turn/start: ${turnRefused}`
        } else if (bodies.length <= before) {
          failure = `NOT PERFORMED — no model request within ${TURN_DEADLINE_MS}ms`
        } else if (completed.length === 0) {
          failure = `NOT PERFORMED — the turn did not complete within ${TURN_DEADLINE_MS}ms`
        }
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error)
      } finally {
        await closeCurrent()
      }
      const body = bodies[before] ?? {}
      const reasoning = body['reasoning'] as { effort?: unknown } | undefined
      seen.push({ step, model: body['model'], effort: reasoning?.effort ?? null, failure })
      if (failure !== null) break
    }
  } finally {
    try {
      await closeOwnedCapture()
    } finally {
      release()
    }
  }

  writeFileSync(
    runEvidence('677-codex-resume-model.json'),
    JSON.stringify({ M1, M2, listenedOn, configuredPort, threadId, seen, bodies }, null, 1),
  )
  console.log(`677 codex resume-model · ${JSON.stringify(seen, null, 1)}`)
  // ⚠️ **Only a run whose every step was measured deletes its root** — a failing one leaves it,
  // home and rollouts included (`649` F6). ⛔ It was unconditional until the review read it.
  if (seen.length === Object.keys(STEPS).length && seen.every((one) => one.failure === null)) {
    rmSync(root, { recursive: true, force: true })
  }
  return seen
}

/** The measurement, then the two things this probe may assert: every step ran, and step A's positive. */
async function measureAndCheck(): Promise<void> {
  const seen = await measure()
  // ⛔ **Every step MEASURED, or the run says which was not** — a silent step is a green run.
  for (const one of seen) expect(one.failure, `step ${one.step}`).toBeNull()
  expect(seen.map((one) => one.step)).toEqual(Object.keys(STEPS))
  // 🔴 **The paired positive**: a thread STARTED on M1 runs on M1 — without it, what the resumes
  // name would be unreadable.
  expect(seen[0]?.model, 'A · the started thread').toBe(M1)
  // ⚑ **The findings are REPORTED, not asserted**: this probe exists to say what the provider does,
  // and an assertion on the answer would make a changed provider a red run rather than a new
  // measurement. The table is printed above and written to the run's evidence.
}

it(
  '677 · a resumed Codex thread, asked for a different model',
  () => deadline.within('measuring the seven steps', measureAndCheck),
  deadline.testTimeoutMs,
)
