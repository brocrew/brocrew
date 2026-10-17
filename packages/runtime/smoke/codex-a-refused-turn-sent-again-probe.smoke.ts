import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { expect, it } from 'vitest'
// A deep import, for the reason `codex-resume-model-probe.smoke.ts` gives: this probe owns its
// spawn so the loopback provider's `env_key` reaches the child.
import { SpawnCodexTransport } from '../src/codex/codex-transport'
import { bundledCodexBinary } from './bundled-codex'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

/**
 * # A turn Codex refused, sent again on the same thread: what does the model then receive?
 *
 * When this app repairs a conversation's refused Codex sign-in, it reopens the conversation. To
 * send the refused message again by itself, it must know whether the thread already holds that
 * message: by Codex's source, a turn records its input before the request that can be refused.
 *
 * ## The instrument
 *
 * A loopback Responses endpoint on `listen(0)`, a throwaway `CODEX_HOME`, `env_key` set to
 * `'probe-only'`, the bundled binary. No account, no token, no spend; nothing here touches a
 * person's `~/.codex` or this app's data. The endpoint answers the first request with 401, as a
 * provider refuses a sign-in, and every later one with a completed one-word message.
 *
 * ⚠️ The refusal this stands in for comes where Codex finds the account's workspace, before its
 * first request to the model; this one comes at that request. Both come after the turn's input is
 * recorded, which is what is measured here.
 *
 * ## The steps, each its own app-server, as a reopen is
 *
 * | step | | what is measured |
 * |---|---|---|
 * | **refused** | `thread/start`, then a turn with the message | the endpoint answers 401 |
 * | **sent again** | `thread/resume`, then a turn with the same message, byte for byte | how many times the model receives it |
 * | **paired** | a new thread, a turn with the message, answered | the paired positive: once |
 * | **refused, a second thread** | as **refused**, on a new thread | the endpoint answers 401 |
 * | **carried on** | `thread/resume`, then a turn with no input | whether Codex takes it, and how many times the model receives the message |
 */

const MESSAGE = 'Please summarise the open pull requests in this repository.'

const RPC_DEADLINE_MS = 30_000
const TURN_DEADLINE_MS = 60_000
const EXIT_GRACE_MS = 2_000
const KILL_GRACE_MS = 2_000
const TEARDOWN_MS = EXIT_GRACE_MS + 2 * KILL_GRACE_MS
const STEPS = ['refused', 'sent again', 'paired', 'refused, a second thread', 'carried on'] as const
type Step = (typeof STEPS)[number]

const deadline = probeRunDeadline(
  'codex a refused turn sent again probe',
  runBudgetMs(
    STEPS.flatMap(() => [RPC_DEADLINE_MS, RPC_DEADLINE_MS, TURN_DEADLINE_MS, TEARDOWN_MS]),
  ),
  TEARDOWN_MS,
)

function providerStanza(port: number): string {
  return [
    'model = "gpt-5.6-luna"',
    'model_provider = "capture"',
    '',
    '[model_providers.capture]',
    'name = "BroBot sent-again capture"',
    `base_url = "http://127.0.0.1:${port}/v1"`,
    'env_key = "BROBOT_SENT_AGAIN_CAPTURE_KEY"',
    'request_max_retries = 0',
    'stream_max_retries = 0',
    '',
  ].join('\n')
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

function refused(response: ServerResponse): void {
  response.statusCode = 401
  response.setHeader('content-type', 'application/json')
  response.end(
    JSON.stringify({ error: { message: 'unauthorized', type: 'invalid_request_error' } }),
  )
}

function answered(response: ServerResponse, index: number): void {
  const send = (kind: string, payload: Record<string, unknown>): void => {
    response.write(`event: ${kind}\ndata: ${JSON.stringify({ type: kind, ...payload })}\n\n`)
  }
  response.statusCode = 200
  response.setHeader('content-type', 'text/event-stream')
  send('response.created', { response: { id: `resp_sent_again_${index}` } })
  send('response.output_item.done', {
    output_index: 0,
    item: {
      type: 'message',
      id: `msg_sent_again_${index}`,
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'ok', annotations: [] }],
    },
  })
  send('response.completed', {
    response: {
      id: `resp_sent_again_${index}`,
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

/** How many of a request's input items are a person's message holding exactly {@link MESSAGE}. */
function timesTheMessageIsIn(body: Record<string, unknown>): number {
  const input = Array.isArray(body['input']) ? (body['input'] as unknown[]) : []
  let times = 0
  for (const item of input) {
    if (typeof item !== 'object' || item === null) continue
    const one = item as { role?: unknown; content?: unknown }
    if (one.role !== 'user' || !Array.isArray(one.content)) continue
    for (const part of one.content as { text?: unknown }[]) {
      if (part?.text === MESSAGE) times += 1
    }
  }
  return times
}

interface Seen {
  readonly step: Step
  readonly requests: number
  readonly timesTheModelReceivedIt: number | null
  readonly turnEnded: string | null
  readonly failure: string | null
}

async function measure(): Promise<Seen[]> {
  deadline.refuse('starting')
  const scratch = runScratch('codex-sent-again')
  mkdirSync(scratch, { recursive: true })
  const root = mkdtempSync(join(scratch, 'thread-'))
  const home = join(root, 'home')
  const cwd = join(root, 'cwd')
  mkdirSync(home, { recursive: true })
  mkdirSync(cwd, { recursive: true })

  const bodies: Record<string, unknown>[] = []
  let refuseNext = false
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      try {
        bodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
      } catch {
        bodies.push({ unparsed: Buffer.concat(chunks).toString('utf8') })
      }
      if (refuseNext) {
        refuseNext = false
        refused(response)
      } else answered(response, bodies.length)
    })
  })

  let transport: SpawnCodexTransport | null = null
  let pump: Promise<void> | null = null
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
  let refusedThread = ''
  try {
    writeFileSync(join(home, 'config.toml'), providerStanza(await listen(server)))
    for (const step of STEPS) {
      deadline.refuse(`step ${step}`)
      const before = bodies.length
      refuseNext = step.startsWith('refused')
      let failure: string | null = null
      let turnEnded: string | null = null
      transport = new SpawnCodexTransport(bundledCodexBinary(), ['app-server'], {
        cwd,
        env: {
          PATH: process.env['PATH'] ?? '',
          HOME: root,
          CODEX_HOME: home,
          CODEX_SQLITE_HOME: home,
          BROBOT_SENT_AGAIN_CAPTURE_KEY: 'probe-only',
        },
        exitGraceMs: EXIT_GRACE_MS,
        killGraceMs: KILL_GRACE_MS,
      })
      const owned = transport
      pump = (async () => {
        for await (const incoming of owned.incoming()) {
          if (incoming.kind === 'notification' && incoming.method === 'turn/completed') {
            const turn = (incoming.params as { turn?: { status?: unknown } } | undefined)?.turn
            turnEnded = typeof turn?.status === 'string' ? turn.status : 'completed'
          }
          if (incoming.kind === 'request') {
            owned.respondError(
              incoming.id,
              -32601,
              `this probe does not implement ${incoming.method}`,
            )
          }
        }
      })()
      try {
        await bounded(
          'initialize',
          owned.request('initialize', {
            clientInfo: {
              name: 'brobot-sent-again-probe',
              title: 'BroBot probe',
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
        let threadId: string
        if (step === 'sent again' || step === 'carried on') {
          threadId = refusedThread
          await bounded('thread/resume', owned.request('thread/resume', { ...shared, threadId }))
        } else {
          const started = (await bounded(
            'thread/start',
            owned.request('thread/start', { ...shared, modelProvider: 'capture' }),
          )) as { thread?: { id?: string } }
          threadId = started.thread?.id ?? ''
          if (step.startsWith('refused')) refusedThread = threadId
        }
        let turnRefused: string | null = null
        owned
          .request('turn/start', {
            threadId,
            // ⚑ Carrying on sends nothing new: the turn asks the model to answer what the thread holds.
            input:
              step === 'carried on' ? [] : [{ type: 'text', text: MESSAGE, text_elements: [] }],
            cwd,
            approvalPolicy: 'never',
            approvalsReviewer: 'user',
            sandboxPolicy: { type: 'dangerFullAccess' },
          })
          .catch((error: unknown) => {
            turnRefused = error instanceof Error ? error.message : String(error)
          })
        const by = Date.now() + TURN_DEADLINE_MS
        while (turnEnded === null && turnRefused === null && Date.now() < by) {
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        if (turnRefused !== null) failure = `the app-server refused turn/start: ${turnRefused}`
        else if (turnEnded === null)
          failure = `NOT PERFORMED — no turn ending in ${TURN_DEADLINE_MS}ms`
        else if (bodies.length <= before) failure = 'NOT PERFORMED — no model request'
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error)
      } finally {
        await closeCurrent()
      }
      const body = bodies[bodies.length - 1]
      seen.push({
        step,
        requests: bodies.length - before,
        timesTheModelReceivedIt:
          body === undefined || bodies.length <= before ? null : timesTheMessageIsIn(body),
        turnEnded,
        failure,
      })
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
    runEvidence('codex-a-refused-turn-sent-again.json'),
    JSON.stringify({ message: MESSAGE, seen, bodies }, null, 1),
  )
  console.log(`codex a refused turn sent again · ${JSON.stringify(seen, null, 1)}`)
  if (seen.length === STEPS.length && seen.every((one) => one.failure === null)) {
    rmSync(root, { recursive: true, force: true })
  }
  return seen
}

async function measureAndCheck(): Promise<void> {
  const seen = await measure()
  for (const one of seen) expect(one.failure, `step ${one.step}`).toBeNull()
  expect(seen.map((one) => one.step)).toEqual([...STEPS])
  // The paired positive: a message answered at once reaches the model once.
  expect(seen[2]?.timesTheModelReceivedIt, 'paired').toBe(1)
  // The finding is reported, not asserted: the table is printed above and written to the evidence.
}

it(
  'a turn Codex refused, sent again on the same thread: what the model receives',
  () => deadline.within('measuring the three steps', measureAndCheck),
  deadline.testTimeoutMs,
)
