import type { ChildProcess } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { dirname, join } from 'node:path'
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'
import type { RuntimeEvent } from '../src/events'
import type { SessionHandle } from '../src/runtime'
import type { SessionRef } from '../src/session-ref'
import {
  announcedVersion,
  closeBounded,
  loopbackRuntime,
  until,
  type LoopbackRuntime,
} from './loopback-claude'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

/**
 * 🔴 **741 · R99 (corrected) — what does the CLI tell the model when BroBot REOPENS a conversation
 * that was planning, in the default mode?**
 *
 * ## ⚑ The ruling, and the CLI fact it rests on
 *
 * *"A reopened conversation does NOT resume planning, whoever started the plan, and the model is
 * told it has left plan mode in the CLI's own words, as the CLI's resume tells it."* ⚑ `740`
 * measured the INTERACTIVE CLI 2.1.281: after `/exit` and `--continue`/`--resume`, a session that was
 * planning comes back in the default mode, and its first resumed turn sends the model *"## Exited
 * Plan Mode\n\nYou have exited plan mode. You can now make edits, run tools, and take actions."*
 * (transcript attachment `plan_mode_exit`) — only when the model had been told it was planning.
 * ⚠️ **What this file asks is the SDK path the product takes**: does the CLI say the same when the
 * product's own `ClaudeRuntime.resume` relaunches the session in `default`?
 *
 * ## ⚑ The instrument — `695`'s loopback rig, with `677`'s endpoint discipline
 *
 * `loopback-claude.ts`'s `loopbackRuntime`: the product's own `ClaudeRuntime`, the SDK's bundled CLI,
 * a managed home provisioned by the product's own `provisionProviderHome` under this run's scratch,
 * the literal token `probe-only`. ⚑ The Messages endpoint is this file's own `listen(0)` on
 * `127.0.0.1`, because it must REFUSE a credential that is not the probe's and keep nothing of it —
 * no header is ever stored, and a foreign request is counted, answered 401, and dropped.
 *
 * | arm | start | the start's one turn | resume | the question |
 * |---|---|---|---|---|
 * | **left** | `planMode` | `ok` | `planMode` + `planModeEnded` (→ `default`) | the product's reopen of a person-started plan: is the model told it left? |
 * | **model-entered** | default | `EnterPlanMode {}`, then `ok` | `planMode` + `planModeEnded` (→ `default`) | …of a plan the MODEL entered (R98: no card) |
 * | **planning** | `planMode` | `ok` | `planMode` alone (→ `plan`) | ⚑ the contrast — `main`'s reopen today |
 * | **never** | default | `ok` | default | ⚑ the control — no plan, no exit |
 *
 * ⚑ Each arm's premise is read off the child: the modes its `system/init` (and `system/status`)
 * announce, the mode the PRODUCT asked the resumed launch for, and the start turn's own request
 * carrying the CLI's plan-mode reminder — the model was told it was planning BEFORE the reopen.
 *
 * Use no real token or spend and touch no personal state. Every child’s `CLAUDE_CONFIG_DIR`
 * and `HOME` belong to scratch. A fake `security` first on `PATH` logs the lookup and returns
 * not found (exit 44); the only endpoint is this process’s port.
 *
 * ⚠️ *"This captures what the provider put in its model-bound request, not a hosted model's
 * obedience to the text."* (`581`) — here the model is a script, so what is measured is the CLI's
 * own words to it.
 *
 * ## ⚑ Measured — 2026-09-26, `741`, SDK 0.3.281 / bundled CLI 2.1.281 (run `…22-33-09-437Z-7032`)
 *
 * | arm | start announces | resume: product asks → CLI announces | the resumed turn's NEW user message |
 * |---|---|---|---|
 * | left | `init:plan` | `default` → `init:default` | 🔴 `content[0]`: the exit reminder (below), then the tokens reminder, then the prompt — no plan text |
 * | model-entered | `init:default`, `status:plan` | `default` → `init:default` | 🔴 the same exit reminder at `content[0]` — no plan text |
 * | planning | `init:plan` | `plan` → `init:plan` | the tokens reminder and the prompt — ⚠️ NO plan reminder re-sent (history keeps the first) |
 * | never | `init:default` | `default` → `init:default` | the tokens reminder and the prompt |
 *
 * ⚑ The exit reminder, exact: `<system-reminder>\n## Exited Plan Mode\n\nYou have exited plan mode.
 * You can now make edits, run tools, and take actions.\n</system-reminder>` — a text block of the
 * user message, never the `system` field; the transcript records it as attachment `plan_mode_exit`.
 * ⚑ The premise: `left`/`planning`'s start turn carried *"Plan mode is active…"* as a
 * `<system-reminder>` text block (`messages[0].content[4]`); `model-entered`'s rode inside the
 * `EnterPlanMode` tool result (`messages[2].content[0]`). Pinned below; re-run before relying on it.
 *
 * Run: `pnpm exec vitest run --config vitest.smoke.config.ts
 * packages/runtime/smoke/claude-plan-resume-probe.smoke.ts`. Not part of `pnpm run ci`.
 */

const WORDS = '741 plan-resume probe'
const KEY = 'probe-only'
const MODEL = 'claude-haiku-4-5'
/** The CLI's own exit words (`740`, measured on the interactive CLI). */
const EXIT_MARKERS = ['## Exited Plan Mode', 'You have exited plan mode'] as const
/** The CLI's own plan-mode reminders — full, sparse, and re-entry. */
const PLAN_MARKERS = [
  'Plan mode is active',
  'Plan mode still active',
  '## Re-entering Plan Mode',
] as const

const ARMS = {
  left: { starts: 'plan', enters: false, resume: { planMode: true, planModeEnded: true } },
  'model-entered': {
    starts: 'default',
    enters: true,
    resume: { planMode: true, planModeEnded: true },
  },
  planning: { starts: 'plan', enters: false, resume: { planMode: true } },
  never: { starts: 'default', enters: false, resume: {} },
} as const satisfies Record<
  string,
  {
    starts: 'plan' | 'default'
    enters: boolean
    resume: { planMode?: boolean; planModeEnded?: boolean }
  }
>
type ArmName = keyof typeof ARMS
const ARM_NAMES = Object.keys(ARMS) as ArmName[]

/** ⚑ The mode the PRODUCT must ask the resumed launch for — `stillPlanning`, read off its options. */
const ASKED_ON_RESUME: Record<ArmName, string> = {
  left: 'default',
  'model-entered': 'default',
  planning: 'plan',
  never: 'default',
}

/**
 * ⚑ **Pinned as measured** (see the header): the mode the resumed CLI announces, and the CLI's own
 * words about plan mode in the resumed turn's new user message.
 */
const EXIT_REMINDER =
  '<system-reminder>\n## Exited Plan Mode\n\nYou have exited plan mode. You can now make edits, run tools, and take actions.\n</system-reminder>'
const MEASURED: Record<ArmName, { readonly announces: string; readonly exit: readonly string[] }> =
  {
    left: { announces: 'default', exit: [EXIT_REMINDER] },
    'model-entered': { announces: 'default', exit: [EXIT_REMINDER] },
    planning: { announces: 'plan', exit: [] },
    never: { announces: 'default', exit: [] },
  }

/** ⛔ Bounded, standing rule 13 — a turn that never ends is NOT PERFORMED. */
const TURN_MS = 60_000
const TEARDOWN_MS = 15_000
/** How long a closed launch's CLI child is given to exit before the next launch, and then killed. */
const EXIT_MS = 10_000
const WAITS = ARM_NAMES.flatMap(() => [
  TURN_MS,
  TEARDOWN_MS,
  EXIT_MS,
  TURN_MS,
  TEARDOWN_MS,
  EXIT_MS,
])
const deadline = probeRunDeadline('741 claude plan-resume probe', runBudgetMs(WAITS), TEARDOWN_MS)

type Body = Record<string, unknown>

/** One model-bound request, as it arrived — ⛔ no header kept, and no `metadata`. */
interface Seen {
  readonly localPort: number | undefined
  readonly body: Body | null
}

interface Endpoint {
  readonly port: number
  readonly requests: Seen[]
  /** Every request's method and path, in order — the non-Messages ones included. */
  readonly paths: string[]
  /** ⛔ Requests that carried a credential other than the probe's — counted, never kept. */
  readonly counts: { foreign: number }
  close(): Promise<void>
}

type Reply =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'tool_use'
      readonly name: string
      readonly input: Record<string, unknown>
      readonly id: string
    }

function credentialOf(request: IncomingMessage): 'ours' | 'none' | 'foreign' {
  const auth = request.headers['authorization']
  const key = request.headers['x-api-key']
  if (auth === undefined && key === undefined) return 'none'
  const authOurs = auth === undefined || auth === `Bearer ${KEY}`
  const keyOurs = key === undefined || key === KEY
  return authOurs && keyOurs ? 'ours' : 'foreign'
}

function streamReply(response: ServerResponse, model: string, reply: Reply, n: number): void {
  const events: Record<string, unknown>[] = [
    {
      type: 'message_start',
      message: {
        // ⚑ A distinct id per answer, so the CLI never merges two of them (`728`'s measurement).
        id: `msg_741_${String(n)}`,
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 11, output_tokens: 1 },
      },
    },
  ]
  if (reply.kind === 'text') {
    events.push(
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: reply.text } },
    )
  } else {
    events.push(
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: reply.id, name: reply.name, input: {} },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(reply.input) },
      },
    )
  }
  events.push(
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: reply.kind === 'text' ? 'end_turn' : 'tool_use', stop_sequence: null },
      usage: { output_tokens: 1 },
    },
    { type: 'message_stop' },
  )
  response.statusCode = 200
  response.setHeader('content-type', 'text/event-stream')
  for (const event of events) {
    response.write(`event: ${String(event['type'])}\ndata: ${JSON.stringify(event)}\n\n`)
  }
  response.end()
}

/** ⚑ This file's own Messages endpoint — see the header for why it is not the rig's. */
async function startEndpoint(decide: (body: Body) => Reply): Promise<Endpoint> {
  const requests: Seen[] = []
  const paths: string[] = []
  const counts = { foreign: 0 }
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const url = request.url ?? ''
      paths.push(`${request.method ?? '?'} ${url}`)
      const credential = credentialOf(request)
      if (credential === 'foreign') {
        // ⛔ Counted, refused, and NOTHING of it kept — neither the header nor the body.
        counts.foreign += 1
        chunks.length = 0
        response.statusCode = 401
        response.setHeader('content-type', 'application/json')
        response.end('{"type":"error","error":{"type":"authentication_error","message":"741"}}')
        return
      }
      const messages = request.method === 'POST' && url.startsWith('/v1/messages')
      if (messages && url.startsWith('/v1/messages/count_tokens')) {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ input_tokens: 11 }))
        return
      }
      // ⛔ A Messages request with no credential is not this CLI speaking with ours.
      if (!messages || credential !== 'ours') {
        response.statusCode = 404
        response.setHeader('content-type', 'application/json')
        response.end('{"type":"error","error":{"type":"not_found_error","message":"741"}}')
        return
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        parsed = null
      }
      const body =
        parsed !== null && typeof parsed === 'object'
          ? Object.fromEntries(
              // ⚠️ `metadata` carries a device id — an identifier this probe has no use for.
              Object.entries(parsed as Body).filter(([key]) => key !== 'metadata'),
            )
          : null
      requests.push({ localPort: request.socket.localPort, body })
      const reply = body === null ? ({ kind: 'text', text: 'ok' } as const) : decide(body)
      const model = typeof body?.['model'] === 'string' ? body['model'] : MODEL
      if (body?.['stream'] === true) {
        streamReply(response, model, reply, requests.length)
        return
      }
      response.statusCode = 200
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          id: `msg_741_${String(requests.length)}`,
          type: 'message',
          role: 'assistant',
          model,
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 11, output_tokens: 1 },
        }),
      )
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no loopback port')
  return {
    port: address.port,
    requests,
    paths,
    counts,
    async close() {
      server.closeAllConnections()
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

/** A CLI child this probe launched through the product, by pid. */
interface Owned {
  readonly pid: number
  exited: boolean
  killed: boolean
  readonly exit: Promise<void>
}

/**
 * 🔒 `728`'s containment on top of the rig's, plus a refusal: the rig's root as `HOME`, a `security`
 * that answers nothing first on `PATH`, and NOT PERFORMED if the environment the product built
 * carries any credential-shaped variable but the probe's own literal.
 */
function containment(options: Options): void {
  const env = { ...(options.env ?? {}) } as Record<string, string | undefined>
  const configDir = env['CLAUDE_CONFIG_DIR']
  if (configDir === undefined) throw new Error('NOT PERFORMED — no CLAUDE_CONFIG_DIR to contain')
  for (const [name, value] of Object.entries(env)) {
    if (!/API_KEY|AUTH_TOKEN|OAUTH|BEARER|CREDENTIAL|SECRET|PASSWORD/i.test(name)) continue
    if (name === 'CLAUDE_CODE_OAUTH_TOKEN' && value === KEY) continue
    throw new Error(`NOT PERFORMED — the child's environment carries ${name}`)
  }
  const root = dirname(dirname(configDir))
  const bin = join(root, 'bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(
    join(bin, 'security'),
    '#!/bin/sh\necho "$@" >> "$(dirname "$0")/security.log"\nexit 44\n',
  )
  chmodSync(join(bin, 'security'), 0o755)
  env['HOME'] = root
  env['PATH'] = `${bin}:${env['PATH'] ?? '/usr/bin:/bin'}`
  options.env = env
}

/**
 * ⚑ **OBSERVE the product's own spawn** — its witness spawns the child and this records the pid it
 * returned, unchanged, so every CLI this probe caused can be waited for and, if need be, killed by
 * pid.
 */
function ownChildren(options: Options, owned: Owned[]): void {
  const productSpawn = options.spawnClaudeCodeProcess
  if (productSpawn === undefined) throw new Error('NOT PERFORMED — the product spawns no child')
  options.spawnClaudeCodeProcess = (spawnOptions) => {
    const child = productSpawn(spawnOptions) as unknown as ChildProcess
    const pid = child.pid
    if (pid !== undefined) {
      const one: Owned = {
        pid,
        exited: child.exitCode !== null || child.signalCode !== null,
        killed: false,
        exit: new Promise<void>((resolve) => {
          child.once('exit', () => {
            one.exited = true
            resolve()
          })
        }),
      }
      owned.push(one)
    }
    return child as unknown as ReturnType<typeof productSpawn>
  }
}

/** ⛔ Bounded: wait up to `ms` for every owned child to exit. */
async function exitedWithin(owned: readonly Owned[], ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      Promise.all(owned.filter((one) => !one.exited).map((one) => one.exit)),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** ⛔ Kill, by pid, every owned child that has not exited. */
function killLeft(owned: readonly Owned[]): void {
  for (const one of owned) {
    if (one.exited) continue
    try {
      process.kill(one.pid, 'SIGKILL')
      one.killed = true
    } catch {
      // ⚑ Already gone.
    }
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** One piece of text in a request — where it sits, and whether it is a `<system-reminder>`. */
interface Snippet {
  readonly where: string
  /** The message it sits in, or `null` for the `system` field. */
  readonly message: number | null
  readonly reminder: boolean
  readonly text: string
}

function textsOf(content: unknown): string[] {
  if (typeof content === 'string') return [content]
  if (!Array.isArray(content)) return []
  return (content as { type?: string; text?: string }[]).flatMap((one) =>
    one.type === 'text' && typeof one.text === 'string' ? [one.text] : [],
  )
}

function snippetsOf(body: Body): Snippet[] {
  const out: Snippet[] = []
  const push = (where: string, message: number | null, text: string): void => {
    out.push({ where, message, reminder: text.trimStart().startsWith('<system-reminder>'), text })
  }
  const system = body['system']
  if (typeof system === 'string') push('system', null, system)
  else if (Array.isArray(system)) {
    for (const [i, block] of (system as { text?: string }[]).entries()) {
      if (typeof block.text === 'string') push(`system[${String(i)}]`, null, block.text)
    }
  }
  const messages = (body['messages'] ?? []) as { role?: string; content?: unknown }[]
  for (const [j, message] of messages.entries()) {
    const at = `messages[${String(j)}] (${message.role ?? '?'})`
    if (typeof message.content === 'string') {
      push(`${at}.content`, j, message.content)
      continue
    }
    if (!Array.isArray(message.content)) continue
    for (const [k, block] of (
      message.content as { type?: string; text?: string; content?: unknown }[]
    ).entries()) {
      if (block.type === 'text' && typeof block.text === 'string')
        push(`${at}.content[${String(k)}] text`, j, block.text)
      if (block.type === 'tool_result') {
        for (const text of textsOf(block.content))
          push(`${at}.content[${String(k)}] tool_result`, j, text)
      }
    }
  }
  return out
}

/** The index of the last assistant message — everything after it is THIS request's new turn. */
function lastAssistant(body: Body): number {
  const messages = (body['messages'] ?? []) as { role?: string }[]
  let last = -1
  for (const [j, message] of messages.entries()) if (message.role === 'assistant') last = j
  return last
}

function toolUsesSoFar(body: Body): number {
  let count = 0
  for (const message of (body['messages'] ?? []) as { role?: string; content?: unknown }[]) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (const part of message.content as { type?: string }[])
      if (part.type === 'tool_use') count += 1
  }
  return count
}

function offered(body: Body): string[] {
  return ((body['tools'] ?? []) as { name?: string }[]).flatMap((one) =>
    typeof one.name === 'string' ? [one.name] : [],
  )
}

/** Excerpts of a long system text around each mention of plan mode. */
function excerpts(text: string): string[] {
  const out: string[] = []
  const pattern = /plan mode/gi
  for (let hit = pattern.exec(text); hit !== null; hit = pattern.exec(text)) {
    out.push(text.slice(Math.max(0, hit.index - 160), hit.index + 200))
  }
  return out
}

/** What one model-bound request told the model about plan mode — this turn apart from history. */
interface Told {
  readonly exitThisTurn: { where: string; reminder: boolean; text: string }[]
  readonly planThisTurn: { where: string; reminder: boolean; text: string }[]
  /** ⚑ Every snippet of this turn that mentions plan mode at all — no marker filter. */
  readonly mentionsThisTurn: { where: string; reminder: boolean; text: string }[]
  /** Snippets from the conversation's history that carry a marker — kept, not re-said. */
  readonly markersInHistory: { where: string; marker: string }[]
  readonly systemExcerpts: { where: string; excerpts: string[] }[]
  readonly systemCarriesExit: boolean
  readonly planToolsOffered: string[]
  readonly messageCount: number
}

function toldIn(body: Body): Told {
  const all = snippetsOf(body)
  const last = lastAssistant(body)
  const fresh = all.filter((one) => one.message !== null && one.message > last)
  const history = all.filter((one) => one.message !== null && one.message <= last)
  const system = all.filter((one) => one.message === null)
  const shape = (one: Snippet): { where: string; reminder: boolean; text: string } => ({
    where: one.where,
    reminder: one.reminder,
    text: one.text,
  })
  return {
    exitThisTurn: fresh.filter((one) => EXIT_MARKERS.some((m) => one.text.includes(m))).map(shape),
    planThisTurn: fresh.filter((one) => PLAN_MARKERS.some((m) => one.text.includes(m))).map(shape),
    mentionsThisTurn: fresh.filter((one) => /plan mode/i.test(one.text)).map(shape),
    markersInHistory: history.flatMap((one) =>
      [...EXIT_MARKERS, ...PLAN_MARKERS]
        .filter((m) => one.text.includes(m))
        .map((marker) => ({ where: one.where, marker })),
    ),
    systemExcerpts: system
      .map((one) => ({ where: one.where, excerpts: excerpts(one.text) }))
      .filter((one) => one.excerpts.length > 0),
    systemCarriesExit: system.some((one) => EXIT_MARKERS.some((m) => one.text.includes(m))),
    planToolsOffered: offered(body).filter((name) => /PlanMode/.test(name)),
    messageCount: ((body['messages'] ?? []) as unknown[]).length,
  }
}

/** Every permission mode the CLI announced, in order, with the frame that announced it. */
function announcedModes(frames: readonly SDKMessage[]): string[] {
  const modes: string[] = []
  for (const frame of frames) {
    const f = frame as { type?: string; subtype?: string; permissionMode?: string }
    if (f.type === 'system' && typeof f.permissionMode === 'string')
      modes.push(`${f.subtype ?? '?'}:${f.permissionMode}`)
  }
  return modes
}

function initMode(frames: readonly SDKMessage[]): string | null {
  for (const frame of frames) {
    const f = frame as { type?: string; subtype?: string; permissionMode?: string }
    if (f.type === 'system' && f.subtype === 'init') return f.permissionMode ?? null
  }
  return null
}

/** One launch of one arm — the start, or the resume. */
interface Phase {
  readonly which: 'start' | 'resume'
  readonly cli: string | null
  readonly askedMode: unknown
  readonly initMode: string | null
  readonly modes: string[]
  readonly configuredPort: number | null
  readonly requestPorts: (number | null)[]
  /** ⚑ What each of this launch's requests in OUR conversation told the model, in order. */
  readonly told: Told[]
  /** The first request of this launch's turn — for the resume, THE request the question is about. */
  readonly turnRequest: Body | null
  readonly events: string[]
  readonly turnEnded: string[]
  readonly fatal: string[]
}

interface ArmSeen {
  readonly arm: ArmName
  readonly listenedOn: number
  readonly phases: Phase[]
  readonly foreign: number
  readonly paths: string[]
  readonly security: string
  /** What the provider home's transcript recorded, line by line, reduced. */
  readonly transcript: Record<string, unknown>[]
  readonly children: { pid: number; exited: boolean; killed: boolean }[]
  readonly failure: string | null
  readonly stderr: string
  readonly root: string | null
}

function script(arm: ArmName, first: string, body: Body): Reply {
  // ⚑ The model-entered arm's first step: `EnterPlanMode {}` on its own conversation's first ask.
  if (
    ARMS[arm].enters &&
    JSON.stringify(body['messages'] ?? []).includes(first) &&
    offered(body).includes('EnterPlanMode') &&
    toolUsesSoFar(body) === 0
  ) {
    return { kind: 'tool_use', name: 'EnterPlanMode', input: {}, id: 'toolu_741_enter' }
  }
  return { kind: 'text', text: 'ok' }
}

/** Every line of every transcript under the home, reduced to what says what mode it was in. */
function transcriptOf(providerHome: string): Record<string, unknown>[] {
  const projects = join(providerHome, 'projects')
  if (!existsSync(projects)) return []
  const lines: Record<string, unknown>[] = []
  for (const folder of readdirSync(projects)) {
    for (const file of readdirSync(join(projects, folder))) {
      if (!file.endsWith('.jsonl')) continue
      for (const raw of readFileSync(join(projects, folder, file), 'utf8').split('\n')) {
        if (raw.trim() === '') continue
        let line: Record<string, unknown>
        try {
          line = JSON.parse(raw) as Record<string, unknown>
        } catch {
          continue
        }
        const attachment = line['attachment'] as { type?: string } | undefined
        const reduced: Record<string, unknown> = { file, type: line['type'] }
        if (line['subtype'] !== undefined) reduced['subtype'] = line['subtype']
        if (attachment?.type !== undefined) reduced['attachment'] = attachment.type
        if (line['permissionMode'] !== undefined) reduced['permissionMode'] = line['permissionMode']
        if (line['isMeta'] !== undefined) reduced['isMeta'] = line['isMeta']
        if (/exited plan mode/i.test(raw)) reduced['saysExited'] = true
        lines.push(reduced)
      }
    }
  }
  return lines
}

const captured: ArmSeen[] = []
const held = new Set<ArmName>()

async function runArm(arm: ArmName): Promise<ArmSeen> {
  deadline.refuse(`starting ${arm}`)
  const plan = ARMS[arm]
  const words = { start: `${WORDS} · ${arm} · first`, resume: `${WORDS} · ${arm} · resumed` }
  const endpoint = await startEndpoint((body) => script(arm, words.start, body))
  const owned: Owned[] = []
  let handle: SessionHandle | null = null
  const release = deadline.own(async () => {
    if (handle !== null) await closeBounded(handle, TEARDOWN_MS)
    await endpoint.close()
    killLeft(owned)
  })
  const phases: Phase[] = []
  let failure: string | null = null
  let rig: LoopbackRuntime | null = null
  try {
    rig = await loopbackRuntime({
      scratch: runScratch('claude-plan-resume'),
      label: arm,
      port: endpoint.port,
      maxRetries: 0,
      rewrite: (options) => {
        containment(options)
        ownChildren(options, owned)
      },
    })
    const context = {
      providerHome: rig.providerHome,
      model: MODEL,
      approvalMode: 'ask' as const,
    }
    let ref: SessionRef | null = null
    for (const which of ['start', 'resume'] as const) {
      deadline.refuse(`${arm} · ${which}`)
      const framesBefore = rig.recorded.frames.length
      const requestsBefore = endpoint.requests.length
      // ⚑ Rule 40, per launch: read off THIS launch's options, never the previous one's.
      rig.recorded.configuredPort = null
      rig.recorded.options = null
      const events: RuntimeEvent[] = []
      if (which === 'resume' && ref === null) throw new Error('NOT PERFORMED — no ref to resume')
      const opened: SessionHandle =
        which === 'start'
          ? await rig.runtime.start({
              cwd: rig.cwd,
              ...context,
              ...(plan.starts === 'plan' ? { planMode: true } : {}),
            })
          : await rig.runtime.resume(ref!, { ...context, ...plan.resume })
      handle = opened
      void (async () => {
        for await (const event of opened.events()) {
          events.push(event)
          // ⚑ Nothing here should ask; if anything does, it is answered and recorded.
          if (event.type === 'permission_request')
            void opened.respondPermission(event.id, { outcome: 'allow' }).catch(() => {})
          if (event.type === 'user_input_request') {
            const answers = Object.fromEntries(
              event.questions.map((one) => [one.id, one.options[0]?.label ?? 'ok']),
            )
            void opened.respondUserInput(event.id, { kind: 'answer', answers }).catch(() => {})
          }
        }
      })()
      const turnsBefore = events.filter((one) => one.type === 'turn').length
      await opened.send(which === 'start' ? words.start : words.resume)
      await until(
        () =>
          events.filter((one) => one.type === 'turn').length > turnsBefore ||
          events.some((one) => one.type === 'error' && one.fatal),
        TURN_MS,
        `${arm} · ${which}: the turn to end`,
      )
      ref = opened.ref ?? ref
      await closeBounded(opened, TEARDOWN_MS)
      handle = null
      // ⚑ The next launch reads the transcript this one wrote: its CLI is given time to exit.
      await exitedWithin(owned, EXIT_MS)
      killLeft(owned)
      const frames = rig.recorded.frames.slice(framesBefore)
      const ours = endpoint.requests.slice(requestsBefore).filter((one) => {
        const said = JSON.stringify(one.body?.['messages'] ?? [])
        return one.body !== null && (said.includes(words.start) || said.includes(words[which]))
      })
      const turnRequest =
        ours.find((one) => {
          const body = one.body!
          const last = lastAssistant(body)
          return snippetsOf(body).some(
            (s) => s.message !== null && s.message > last && s.text.includes(words[which]),
          )
        })?.body ?? null
      phases.push({
        which,
        cli: announcedVersion(frames),
        // ⚠️ Read through a cast: the reset above narrows the field to `null` for the compiler.
        askedMode: (rig.recorded.options as Options | null)?.permissionMode ?? null,
        initMode: initMode(frames),
        modes: announcedModes(frames),
        configuredPort: rig.recorded.configuredPort,
        requestPorts: endpoint.requests.slice(requestsBefore).map((one) => one.localPort ?? null),
        told: ours.map((one) => toldIn(one.body!)),
        turnRequest,
        events: events.map((one) => one.type),
        turnEnded: events.flatMap((one) => (one.type === 'turn' ? [one.state] : [])),
        fatal: events.flatMap((one) => (one.type === 'error' && one.fatal ? [one.message] : [])),
      })
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  } finally {
    if (handle !== null) await closeBounded(handle, TEARDOWN_MS)
    await endpoint.close()
    await exitedWithin(owned, EXIT_MS)
    killLeft(owned)
    release()
  }
  const seen: ArmSeen = {
    arm,
    listenedOn: endpoint.port,
    phases,
    foreign: endpoint.counts.foreign,
    paths: [...new Set(endpoint.paths)],
    security:
      rig !== null && existsSync(join(rig.root, 'bin', 'security.log'))
        ? readFileSync(join(rig.root, 'bin', 'security.log'), 'utf8')
        : '',
    transcript: rig === null ? [] : transcriptOf(rig.providerHome),
    children: owned.map((one) => ({ pid: one.pid, exited: one.exited, killed: one.killed })),
    failure,
    stderr: rig?.recorded.stderr ?? '',
    root: rig?.root ?? null,
  }
  captured.push(seen)
  const evidence = runEvidence('741-claude-plan-resume')
  mkdirSync(evidence, { recursive: true })
  writeFileSync(join(evidence, `${arm}.json`), `${JSON.stringify(seen, null, 2)}\n`)
  return seen
}

const hasMarker = (told: readonly Told[]): boolean =>
  told.some((one) => one.planThisTurn.length > 0)

for (const arm of ARM_NAMES) {
  it(
    `741 · ${arm}: what the resumed turn tells the model about plan mode`,
    () =>
      deadline.within(arm, async () => {
        const seen = await runArm(arm)
        expect(seen.failure, `NOT PERFORMED\n${seen.stderr}`).toBeNull()
        expect(seen.foreign, 'a request carried a credential other than the probe’s').toBe(0)
        const [start, resume] = seen.phases
        expect(start?.which).toBe('start')
        expect(resume?.which).toBe('resume')
        for (const phase of seen.phases) {
          // ⚑ Rule 40: configured with this port AND reached it.
          expect(phase.configuredPort, phase.which).toBe(seen.listenedOn)
          expect(phase.requestPorts.length, phase.which).toBeGreaterThan(0)
          expect(phase.requestPorts.every((port) => port === seen.listenedOn)).toBe(true)
          expect(phase.turnEnded, `${phase.which}: the turn`).toContain('completed')
          expect(phase.turnRequest, `${phase.which}: no request carried this turn`).not.toBeNull()
        }
        // ⚑ The premises, read off the child and the product's own launch.
        expect(start!.initMode, 'the mode the started CLI announced').toBe(ARMS[arm].starts)
        if (ARMS[arm].enters) {
          expect(start!.modes, 'the model entered plan mode itself').toContain('status:plan')
        }
        expect(resume!.askedMode, 'the mode the PRODUCT asked the reopen for').toBe(
          ASKED_ON_RESUME[arm],
        )
        // ⚑ …and the model was TOLD it was planning before the reopen — or, in the control, never.
        expect(hasMarker(start!.told), 'the start told the model plan mode was active').toBe(
          arm !== 'never',
        )
        if (arm === 'never') {
          // ⚑ The control: nothing about plan mode, entering or leaving, in either launch's turn.
          for (const phase of seen.phases) {
            for (const told of phase.told) {
              expect(told.exitThisTurn, phase.which).toEqual([])
              expect(told.planThisTurn, phase.which).toEqual([])
            }
          }
        }
        // ⚑ **The findings, pinned as measured** — a CLI bump that changes them fails here, by name.
        const resumed = toldIn(resume!.turnRequest!)
        expect(resume!.initMode, 'the mode the resumed CLI announced').toBe(MEASURED[arm].announces)
        expect(
          resumed.exitThisTurn.map((one) => one.text),
          'the CLI’s exit words in the resumed turn',
        ).toEqual(MEASURED[arm].exit)
        expect(resumed.planThisTurn, 'a plan-mode reminder in the resumed turn').toEqual([])
        expect(resumed.systemCarriesExit, 'the exit words in the system field').toBe(false)
        held.add(arm)
      }),
    deadline.testTimeoutMs,
  )
}

it(
  '741 · the table',
  () =>
    deadline.within('the table', async () => {
      const short = (text: string): string =>
        text.length > 240 ? `${text.slice(0, 240)}… (${String(text.length)} chars)` : text
      const table = captured.map((seen) => {
        const [start, resume] = seen.phases
        const resumed =
          resume?.turnRequest === null || resume === undefined ? null : toldIn(resume.turnRequest)
        return {
          arm: seen.arm,
          cli: start?.cli ?? null,
          start: {
            asked: start?.askedMode ?? null,
            modes: start?.modes ?? [],
            toldPlan: (start?.told ?? []).flatMap((one) =>
              one.planThisTurn.map((p) => ({
                where: p.where,
                reminder: p.reminder,
                text: short(p.text),
              })),
            ),
          },
          resume: {
            asked: resume?.askedMode ?? null,
            modes: resume?.modes ?? [],
            exitThisTurn: resumed?.exitThisTurn.map((one) => ({ ...one, text: one.text })) ?? null,
            planThisTurn:
              resumed?.planThisTurn.map((one) => ({ ...one, text: short(one.text) })) ?? null,
            mentionsThisTurn:
              resumed?.mentionsThisTurn.map((one) => ({
                where: one.where,
                text: short(one.text),
              })) ?? null,
            markersInHistory: resumed?.markersInHistory ?? null,
            systemCarriesExit: resumed?.systemCarriesExit ?? null,
            planToolsOffered: resumed?.planToolsOffered ?? null,
            laterRequestsExit: (resume?.told ?? [])
              .slice(1)
              .flatMap((one) => one.exitThisTurn.map((e) => e.where)),
          },
          transcript: seen.transcript.filter(
            (one) =>
              one['attachment'] !== undefined ||
              one['saysExited'] === true ||
              one['type'] === 'user',
          ),
          security: seen.security
            .trim()
            .split('\n')
            .filter((one) => one !== ''),
          children: seen.children,
          failure: seen.failure,
        }
      })
      writeFileSync(
        runEvidence('741-claude-plan-resume.json'),
        `${JSON.stringify(table, null, 2)}\n`,
      )
      console.log('[741 · table]', JSON.stringify(table, null, 2))
      // ⛔ Every CLI child this probe caused is gone — by its own exit event, and by pid.
      const children = captured.flatMap((seen) => seen.children)
      expect(children.length, 'no child was owned').toBeGreaterThanOrEqual(2 * captured.length)
      for (const child of children) {
        expect(child.exited || child.killed, `pid ${String(child.pid)}`).toBe(true)
      }
      await until(
        () => children.every((child) => !alive(child.pid)),
        EXIT_MS,
        'every owned child to be gone by pid',
      )
      expect(captured.map((one) => one.arm)).toEqual(ARM_NAMES)
      // ⚠️ Only a run whose every arm held deletes its roots; a failing one leaves them (`649` F6).
      if (held.size === captured.length) {
        for (const seen of captured) {
          if (seen.root !== null) rmSync(seen.root, { recursive: true, force: true })
        }
      }
    }),
  deadline.testTimeoutMs,
)
