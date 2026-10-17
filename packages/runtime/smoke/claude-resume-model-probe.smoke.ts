import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

/**
 * 🔴 **677 · what does a RESUMED Claude session run on, when the resume names a DIFFERENT model?**
 *
 * ## ⛔ The question, and why the code could not answer it
 *
 * `R25` §1.3 rules that a wake reads a person's CURRENT model choice, and asks for the provider
 * fact beside it: *"what a RESUME does with a model different from the one it was launched with is
 * a provider fact: measure it and say it; do not assume."* ⚑ The adapter hands the SDK `model` and
 * `resume` together (`claude-runtime.ts` `resume`), and the SDK turns them into `--model` and
 * `--resume` on the CLI with no reconciliation. ⚠️ **What the CLI then does is the CLI's own
 * decision**, and every resume this repository ever ran (`179`'s
 * `resume-agent-info`, `claude-live`) named the model it was started with.
 *
 * ## ⚑ The instrument — a loopback MESSAGES endpoint, `314`'s idea on the other provider
 *
 * The real SDK and the bundled CLI, pointed by `ANTHROPIC_BASE_URL` at an owned `listen(0)` server
 * that answers `/v1/messages` with a one-word streamed message and records what each request NAMES.
 * `ANTHROPIC_API_KEY` is `'probe-only'`. ⛔ No model account, no token, no spend; nothing here
 * touches the person's `~/.claude`, their `provider-homes/`, or `:9444`.
 *
 * ## 🔒 And the machine Keychain is made UNREACHABLE, not merely unused
 *
 * ⛔ **The security block forbids reading a credential, and a CLI that found one would send it to
 * this endpoint.** The CLI asks the Keychain by spawning `security
 * find-generic-password` by NAME, through `PATH`. ⚑ So the child's
 * `PATH` is ONE directory holding a fake `security` that answers *not found* (exit 44) and records
 * that it was asked, and the child's environment is built from nothing rather than inherited — no
 * `CLAUDE_CODE_OAUTH_TOKEN` can ride in. ⚠️ **And the endpoint checks every request's key** against
 * `'probe-only'` and refuses anything else WITHOUT keeping it: a foreign credential is counted, never
 * stored, and the run is then NOT PERFORMED rather than a measurement.
 *
 * ## 🔴 Seven steps on ONE session — the Codex probe's table
 *
 * | step | `resume` | `model` | the question |
 * |---|---|---|---|
 * | **A** | — | M1 | the paired positive: a started session runs on M1 |
 * | **D0** | yes | nothing | the resume path, asking nothing — ⚠️ M1 is also the CLI's default here, so it cannot tell memory from default |
 * | **C** | yes | M2 | does `--model` on a resume take? |
 * | **D1** | yes | nothing | …and does it STICK? ⚑ **the memory question** — M2 is not the default |
 * | **B** | yes | M1 + effort `high` | the product's own shape on a wake |
 * | **B2** | yes | M1 + effort `low` | a second level, so an effort is told apart from a constant |
 * | **D2** | yes | nothing | …and does an EFFORT stick the way a model does? |
 *
 * ⚠️ *"This captures what the provider put in its model-bound request, not a hosted model's
 * obedience to the text."* (`581`) — and the question IS which model the request names.
 *
 * ## ⚑ Measured — 2026-09-23, `677`, SDK 0.3.218 / bundled CLI 2.1.218 (the evidence JSON has the rest)
 *
 * | step | `model` in the request (= `system/init`'s) | `output_config.effort` |
 * |---|---|---|
 * | A | `claude-sonnet-5` | `high` (nothing asked: the CLI's own default) |
 * | D0 | `claude-sonnet-5` | `high` |
 * | C | `claude-opus-4-8` | `high` |
 * | D1 | **`claude-opus-4-8`** — the resume's model STUCK to the session | `high` |
 * | B | `claude-sonnet-5` | `high` |
 * | B2 | `claude-sonnet-5` | `low` |
 * | D2 | `claude-sonnet-5` | **`high`** — the effort did NOT stick: back to the default |
 *
 * 🔒 `apiKeySource: "ANTHROPIC_API_KEY"` on every step, no foreign credential, and the fake
 * `security` was asked twice per step — the Keychain is asked even with an API key set.
 * ⚠️ **Reported, not asserted** — the Codex probe's reason. Re-run before relying on the table.
 *
 * ⚑ **Re-taken 2026-09-24 on the 0.3.281 bump (`680`), bundled CLI 2.1.281: all seven rows the
 * same** — D1's model still sticks, D2's effort still falls back to `high`.
 *
 * Run: `pnpm run probe:claude-resume-model`. Not part of `pnpm run ci`.
 */

/**
 * ⚠️ **Two models the catalogue DESCRIBES with effort levels** (`claude-runtime.ts`' measured table:
 * `sonnet → claude-sonnet-5` and `opus → claude-opus-4-8`, both `[low…max]`). ⛔ The first run used
 * `claude-haiku-4-5` and its effort step changed nothing in the request — which is the undescribed
 * row the door refuses an effort for, measured from the other side, and not a measurement of effort.
 */
const M1 = 'claude-sonnet-5'
const M2 = 'claude-opus-4-8'
const KEY = 'probe-only'

const STEPS = {
  A: { resume: false, model: M1, effort: null },
  D0: { resume: true, model: null, effort: null },
  C: { resume: true, model: M2, effort: null },
  D1: { resume: true, model: null, effort: null },
  B: { resume: true, model: M1, effort: 'high' },
  // ⚑ A second level, so an effort that rides the request is told apart from a constant.
  B2: { resume: true, model: M1, effort: 'low' },
  // ⚑ …and whether an effort STICKS to the session the way a model does.
  D2: { resume: true, model: null, effort: null },
} as const satisfies Record<
  string,
  { resume: boolean; model: string | null; effort: 'high' | 'low' | null }
>
type Step = keyof typeof STEPS

/** ⚠️ Bounded, standing rule 13 — a CLI that never answers is NOT PERFORMED, never waited on. */
const TURN_DEADLINE_MS = 60_000
/**
 * The deadline's own teardown bound — ⚑ above the SDK's own kill horizon.
 *
 * ⚠️ **Not a wait any step makes, and a step's CLI may outlive it** (review, round two): the pinned
 * SDK's `close()` ends the CLI's stdin and schedules SIGTERM at 2 s and SIGKILL 5 s after that, on
 * unref'd timers. So the next step's `--resume` can start while the previous CLI is still exiting.
 * ⚑ The measured table is consistent across steps, and the evidence names each step's own request,
 * but a reader should know the steps are not strictly serial at the process level.
 */
const TEARDOWN_MS = 8_000

const deadline = probeRunDeadline(
  '677 claude resume-model probe',
  runBudgetMs(Object.keys(STEPS).map(() => TURN_DEADLINE_MS)),
  TEARDOWN_MS,
)

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no loopback port')
  return address.port
}

/** A one-word streamed Messages answer — the six events the API sends, and nothing else. */
function streamOk(response: ServerResponse, model: unknown, index: number): void {
  const send = (kind: string, payload: Record<string, unknown>): void => {
    response.write(`event: ${kind}\ndata: ${JSON.stringify({ type: kind, ...payload })}\n\n`)
  }
  response.statusCode = 200
  response.setHeader('content-type', 'text/event-stream')
  response.setHeader('cache-control', 'no-cache')
  send('message_start', {
    message: {
      id: `msg_677_${index}`,
      type: 'message',
      role: 'assistant',
      model: typeof model === 'string' ? model : M1,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 11, output_tokens: 1 },
    },
  })
  send('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
  send('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'ok' } })
  send('content_block_stop', { index: 0 })
  send('message_delta', {
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 1 },
  })
  send('message_stop', {})
  response.end()
}

/**
 * ⛔ **A credential that is not ours** — an `authorization` header of any kind, or an `x-api-key`
 * other than {@link KEY} — decided WITHOUT keeping what arrived.
 *
 * ⚠️ **A request carrying NO credential is not foreign**, and the first run said why: the CLI opens
 * with `HEAD /api/hello`, a reachability check that sends no key at all, and an equality test on the
 * key counted it as a stranger's. ⚑ It is answered `404` below like every other non-Messages path.
 */
function carriesAForeignCredential(request: IncomingMessage): boolean {
  const key = request.headers['x-api-key']
  return request.headers['authorization'] !== undefined || (key !== undefined && key !== KEY)
}

/** What one step's model-bound request named, and what the CLI said it ran on. */
interface Seen {
  readonly step: Step
  /** The `model` of the FIRST `/v1/messages` request this step made. */
  readonly requested: unknown
  /** Every top-level request field that is not the conversation itself — where an effort would ride. */
  readonly settings: Record<string, unknown> | null
  /** `system/init`'s `model`, the CLI's own account. */
  readonly initModel: unknown
  readonly apiKeySource: unknown
  readonly failure: string | null
}

async function measure(): Promise<{
  seen: Seen[]
  asked: string
  foreign: number
  paths: string[]
}> {
  deadline.refuse('starting')
  const scratch = runScratch('claude-resume-model')
  mkdirSync(scratch, { recursive: true })
  const root = mkdtempSync(join(scratch, 'session-'))
  const home = join(root, 'home')
  const cwd = join(root, 'cwd')
  const bin = join(root, 'bin')
  for (const dir of [home, cwd, bin]) mkdirSync(dir, { recursive: true })
  // 🔒 The only `security` this child can find: *not found*, and a line saying it was asked.
  const askedLog = join(root, 'security-asked.log')
  writeFileSync(askedLog, '')
  writeFileSync(join(bin, 'security'), `#!/bin/sh\necho "asked: $1" >> '${askedLog}'\nexit 44\n`)
  chmodSync(join(bin, 'security'), 0o755)

  const bodies: { index: number; body: Record<string, unknown> }[] = []
  const paths: string[] = []
  let foreign = 0
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      paths.push(`${request.method ?? '?'} ${request.url ?? '?'}`)
      if (carriesAForeignCredential(request)) {
        foreign += 1
        response.statusCode = 401
        response.end(
          '{"type":"error","error":{"type":"authentication_error","message":"677 probe"}}',
        )
        return
      }
      const messages =
        request.method === 'POST' &&
        ((request.url ?? '').startsWith('/v1/messages?') || request.url === '/v1/messages')
      // ⛔ A Messages request must carry OUR key — one with none is not a measurement of this CLI.
      if (!messages || request.headers['x-api-key'] !== KEY) {
        response.statusCode = 404
        response.end('{"type":"error","error":{"type":"not_found_error","message":"677 probe"}}')
        return
      }
      let body: Record<string, unknown>
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
      } catch {
        body = { unparsed: true }
      }
      bodies.push({ index: bodies.length, body })
      if (body['stream'] === true) {
        streamOk(response, body['model'], bodies.length)
        return
      }
      response.statusCode = 200
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          id: `msg_677_${bodies.length}`,
          type: 'message',
          role: 'assistant',
          model: body['model'],
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 11, output_tokens: 1 },
        }),
      )
    })
  })

  let active: { close?: () => void } | null = null
  const closeOwnedCapture = async (): Promise<void> => {
    try {
      active?.close?.()
    } finally {
      server.closeAllConnections()
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
  const release = deadline.own(() => closeOwnedCapture())

  const seen: Seen[] = []
  let sessionId = ''
  try {
    const port = await listen(server)
    // 🔒 Built from nothing: no inherited variable can carry a credential into the child.
    const env: Record<string, string> = {
      PATH: bin,
      HOME: root,
      CLAUDE_CONFIG_DIR: home,
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
      ANTHROPIC_API_KEY: KEY,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      DISABLE_AUTOUPDATER: '1',
      DISABLE_TELEMETRY: '1',
      DISABLE_ERROR_REPORTING: '1',
    }
    for (const step of Object.keys(STEPS) as Step[]) {
      deadline.refuse(`step ${step}`)
      const plan = STEPS[step]
      const before = bodies.length
      let failure: string | null = null
      let initModel: unknown = null
      let apiKeySource: unknown = null
      const options: Options = {
        cwd,
        env,
        settingSources: [],
        maxTurns: 1,
        ...(plan.resume ? { resume: sessionId } : {}),
        ...(plan.model === null ? {} : { model: plan.model }),
        ...(plan.effort === null ? {} : { effort: plan.effort }),
      }
      const q = query({ prompt: `677 step ${step}: say ok`, options })
      active = q as unknown as { close?: () => void }
      const by = Date.now() + TURN_DEADLINE_MS
      try {
        const iterator = q[Symbol.asyncIterator]()
        for (;;) {
          const remaining = by - Date.now()
          if (remaining <= 0) {
            failure = `NOT PERFORMED — no result within ${TURN_DEADLINE_MS}ms`
            break
          }
          let timer: ReturnType<typeof setTimeout> | undefined
          const next = await Promise.race([
            iterator.next(),
            new Promise<'late'>((resolve) => {
              timer = setTimeout(() => resolve('late'), remaining)
              timer.unref?.()
            }),
          ])
          if (timer !== undefined) clearTimeout(timer)
          if (next === 'late') {
            failure = `NOT PERFORMED — no result within ${TURN_DEADLINE_MS}ms`
            break
          }
          if (next.done === true) break
          const message = next.value as SDKMessage & Record<string, unknown>
          if (message.type === 'system' && message['subtype'] === 'init') {
            initModel = message['model']
            apiKeySource = message['apiKeySource']
            if (!plan.resume) sessionId = String(message['session_id'] ?? '')
          }
          if (message.type === 'result') break
        }
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error)
      } finally {
        active?.close?.()
        active = null
      }
      if (failure === null && bodies.length <= before) {
        failure = 'NOT PERFORMED — the CLI made no /v1/messages request'
      }
      const body = bodies[before]?.body ?? null
      const settings =
        body === null
          ? null
          : Object.fromEntries(
              // ⚠️ `metadata` carries a device id: an identifier this probe has no use for.
              Object.entries(body).filter(
                ([key]) => !['messages', 'system', 'tools', 'metadata'].includes(key),
              ),
            )
      seen.push({
        step,
        requested: body?.['model'] ?? null,
        settings,
        initModel,
        apiKeySource,
        failure,
      })
      if (failure !== null || foreign > 0) break
    }
  } finally {
    try {
      await closeOwnedCapture()
    } finally {
      release()
    }
  }
  const asked = readFileSync(askedLog, 'utf8')
  writeFileSync(
    runEvidence('677-claude-resume-model.json'),
    JSON.stringify({ M1, M2, sessionId, seen, paths, foreign, keychainAsked: asked }, null, 1),
  )
  console.log(
    `677 claude resume-model · ${JSON.stringify({ seen, paths, foreign, keychainAsked: asked }, null, 1)}`,
  )
  // ⚠️ Only a run that got this far deletes its root; a failing one leaves it (`649` F6).
  if (seen.every((one) => one.failure === null) && foreign === 0) {
    rmSync(root, { recursive: true, force: true })
  }
  return { seen, asked, foreign, paths }
}

async function measureAndCheck(): Promise<void> {
  const { seen, foreign, paths } = await measure()
  // ⚑ **Rule 40's question, for a child configured by ENVIRONMENT** — its `ANTHROPIC_BASE_URL` is
  // built from the port `listen(0)` returned, so comparing the two would be a tautology. ⚑ What CAN
  // go wrong is a CLI that ignores the variable: the proof it did not is that our endpoint was the
  // one asked — once per step, before any `/v1/messages`.
  expect(paths.filter((one) => one === 'HEAD /api/hello')).toHaveLength(seen.length)
  // 🔒 **No credential but ours ever reached the endpoint** — otherwise nothing below is ours.
  expect(foreign, 'a request carried a credential other than the probe’s').toBe(0)
  for (const one of seen) expect(one.failure, `step ${one.step}`).toBeNull()
  expect(seen.map((one) => one.step)).toEqual(Object.keys(STEPS))
  // ⚑ The CLI ran on OUR key, by its own account.
  for (const one of seen) expect(one.apiKeySource, `step ${one.step}`).toBe('ANTHROPIC_API_KEY')
  // 🔴 **The paired positive**: a session STARTED on M1 names M1.
  expect(seen[0]?.requested, 'A · the started session').toBe(M1)
  // ⚑ **The findings are REPORTED, not asserted** — the Codex probe's reason.
}

it(
  '677 · a resumed Claude session, asked for a different model',
  () => deadline.within('measuring the seven steps', measureAndCheck),
  deadline.testTimeoutMs,
)
