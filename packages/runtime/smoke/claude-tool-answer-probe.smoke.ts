import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { createSdkMcpServer, query, tool, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'
import { z } from 'zod'
import { normalizeMessage, TOOL_SUMMARY_MAX } from '../src/claude/normalize'
import { buildChildEnv } from '../src/internal/child-env'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

/**
 * 🔴 **675 · what does a CLAUDE model read when one of OUR tools answers, and what does a person
 * read off the same answer?** — `probe:codex-tool-answer`'s question, asked of the other provider.
 *
 * ## ⛔ Why nothing in the repository could answer it
 *
 * Until `675`, `packages/runtime/src/claude/agent-tools.ts` answered every app tool with
 * `{ content: [{ type: 'text', text }], structuredContent }` — the prose a person reads and the
 * payload a model parses, kept apart (`462`). ⚠️ **Whether the CLI hands the model BOTH, one, or
 * neither had never been measured**: `the-answer-a-person-can-read.test.ts` asserted it
 * structurally and said so, and the renderer's `tool-answer.ts` called Claude unmeasured. This
 * probe's arm B is what corrected both (that test's §4, `675`; the renderer, `685` §2.2). It was
 * suspected that when `structuredContent` is present the CLI replaces the content with
 * `JSON.stringify` of it — which, if true, means the model never reads the prose and the transcript
 * row a person reads is the first 200 characters of our JSON. ⛔ **A suspicion is not a
 * measurement**, so this runs the bundled CLI against a loopback Messages endpoint and records the
 * model-bound bytes.
 *
 * ## 🔴 What it measured (2026-09-23, SDK 0.3.218's bundled CLI) — and the arms below assert it
 *
 * | arm | the model received | the transcript row a person reads |
 * |---|---|---|
 * | **A** | ⛔ **the JSON ONLY** — the prose was dropped | `{"outcome":"refused","rail":…,"reason":"that is not a task…` cut at 200 |
 * | **B** | ⚑ the prose, then the JSON, as two text blocks in order | the prose, cut at 200 |
 * | **C** | the prose | the prose, cut at 200 |
 *
 * ⚑ **So the app ships arm B** (`claude/agent-tools.ts`, 675). ⚠️ The CLI also asked the endpoint
 * `/api/hello` before the turn — answered here with a 404, and the turn ran regardless.
 *
 * ⚑ **Re-taken on the 0.3.281 bump (680), CLI 2.1.281: the same three rows, and one addition.** The
 * model is now ALSO handed the CLI's own `<system-reminder><total_tokens>…` after our answer (see
 * {@link CLI_REMINDER}), which the SDK stream does not carry. What our tool said reaches the model
 * exactly as the table says, so arm B stands and nothing in the app moved.
 *
 * ## ⚑ Three arms — one fact apart each
 *
 * | arm | what the tool answers | the question |
 * |---|---|---|
 * | **A · structured** | the pre-`675` shape: one text block + `structuredContent` | which half reaches the model, and the transcript |
 * | **B · two texts** | the prose and the JSON as TWO text blocks, no `structuredContent` | does the CLI carry both, in order? |
 * | **C · prose only** | one text block | ⚑ the CONTROL: the capture sees what the tool said at all |
 *
 * ## 🔒 It costs no tokens and reads no credential — and WHY, stated as what the CLI does
 *
 * `581`'s recipe (standing rule 6.1) on the other provider: the binary the SDK bundles, an owned
 * loopback endpoint on a `listen(0)` port, and a scratch `HOME` and `CLAUDE_CONFIG_DIR` per arm.
 * ⛔ **The CLI DOES look in the Keychain at startup**, whatever the environment holds — ⚑ **and the
 * scratch `CLAUDE_CONFIG_DIR` keeps that lookup off the person's item**: with it set, the CLI
 * scopes each service name to `-<sha256(config dir)[:8]>`, an item that does not exist, instead of
 * `Claude Code-credentials`. ⚠️ So that is asserted before every arm, with the variable that would
 * undo it (`CLAUDE_SECURESTORAGE_CONFIG_DIR`) asserted absent. The token handed over is the literal
 * `probe-only`, as `CLAUDE_CODE_OAUTH_TOKEN` exactly as the app hands over its own, and it is sent
 * only to the loopback port; the evidence file records paths and bodies, never headers. Nothing
 * here touches the person's `~/.claude`, their Keychain item, their userData or `:9444`.
 *
 * ⚑ **Rule 40**: the endpoint is an in-process `listen(0)` socket, so the assertion is that the child
 * was CONFIGURED with the port `server.address()` returned — and that the endpoint was then asked.
 *
 * Run: `pnpm run probe:claude-tool-answer`. Not part of `pnpm run ci`.
 */

const SERVER = 'brobot'
const TOOL = 'probe_answer'
const QUALIFIED = `mcp__${SERVER}__${TOOL}`
const TOOL_USE_ID = 'toolu_675_probe'

/**
 * ⚑ **A real refusal's two halves**, copied from `refuseTool('no-task-you-gave-that-agent')` —
 * chosen because its row is over the 200 cut, so the arms differ in what a person reads.
 * ⚠️ A copy, not an import: this package does not reach into `apps/desktop`. The transport question
 * is about the SHAPE, and the shape is what this copies.
 */
const REASON =
  'that is not a task you gave that agent, so nothing was done. It may belong to another conversation, to a different agent of yours, or to nothing at all. list_tasks lists the work you gave out.'
const PROSE = `refused (no-task-you-gave-that-agent): ${REASON}`
const PAYLOAD = {
  outcome: 'refused',
  rail: 'no-task-you-gave-that-agent',
  permanence: 'permanent',
  retryable: false,
  reason: REASON,
  remedy: null,
  detail: { agent: 'sess_675', task: 'task_675' },
}

type Answer = {
  content: { type: 'text'; text: string }[]
  structuredContent?: Record<string, unknown>
}

const ARMS = {
  'A-structured': {
    content: [{ type: 'text', text: PROSE }],
    structuredContent: PAYLOAD,
  },
  'B-two-texts': {
    content: [
      { type: 'text', text: PROSE },
      { type: 'text', text: JSON.stringify(PAYLOAD) },
    ],
  },
  'C-prose-only': { content: [{ type: 'text', text: PROSE }] },
} as const satisfies Record<string, Answer>

type ArmName = keyof typeof ARMS

/** ⚠️ Bounded, standing rule 13 — a CLI that never finishes its turn is NOT PERFORMED. */
const TURN_DEADLINE_MS = 90_000
/** The SDK's own close: it ends the child's stdin and waits for it to go. */
const TEARDOWN_MS = 10_000
const SERIAL_WAITS_MS = [TURN_DEADLINE_MS, TEARDOWN_MS]

const deadline = probeRunDeadline(
  '675 claude tool-answer probe',
  runBudgetMs(Object.keys(ARMS).flatMap(() => SERIAL_WAITS_MS)),
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

/** The Messages API's streamed shape, one event at a time. */
function sse(response: ServerResponse, events: readonly Record<string, unknown>[]): void {
  response.statusCode = 200
  response.setHeader('content-type', 'text/event-stream')
  response.setHeader('cache-control', 'no-cache')
  for (const event of events) {
    response.write(`event: ${String(event['type'])}\ndata: ${JSON.stringify(event)}\n\n`)
  }
  response.end()
}

const USAGE = {
  input_tokens: 11,
  output_tokens: 7,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
}

function messageStart(id: string, model: string): Record<string, unknown> {
  return {
    type: 'message_start',
    message: {
      id,
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: USAGE,
    },
  }
}

/** ⚑ **The synthetic model turn**: one `tool_use` for our tool, nothing else. */
function streamToolUse(response: ServerResponse, model: string): void {
  sse(response, [
    messageStart('msg_675_call', model),
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: TOOL_USE_ID, name: QUALIFIED, input: {} },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"note":"675"}' },
    },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage: { output_tokens: 7 },
    },
    { type: 'message_stop' },
  ])
}

/** Every other request — the closing turn, and anything the CLI asks on the side — gets words. */
function streamText(response: ServerResponse, model: string, text: string): void {
  sse(response, [
    messageStart('msg_675_text', model),
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 1 },
    },
    { type: 'message_stop' },
  ])
}

interface Block {
  readonly type?: string
  readonly tool_use_id?: string
  readonly content?: unknown
}

/** The `tool_result` block for our call, wherever in a request's messages it sits. */
function ourToolResult(body: unknown): Block | null {
  const messages = (body as { messages?: { content?: unknown }[] } | null)?.messages ?? []
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue
    for (const block of message.content as Block[]) {
      if (block.type === 'tool_result' && block.tool_use_id === TOOL_USE_ID) return block
    }
  }
  return null
}

function offersOurTool(body: unknown): boolean {
  const tools = (body as { tools?: { name?: string }[] } | null)?.tools ?? []
  return tools.some((one) => one.name === QUALIFIED)
}

interface Arm {
  readonly label: ArmName
  /** Every request the endpoint received: its path and its parsed body. */
  readonly requests: { path: string; body: unknown }[]
  /** ⚑ The `tool_result` block in the request that came back after our tool answered. */
  readonly modelSaw: Block | null
  /** ⚑ The same receipt as the SDK stream carried it — what the app's normalizer reads. */
  readonly streamSaw: Block | null
  /** ⚑ The transcript row a person reads, through the app's own normalizer. */
  readonly personRow: string | null
  readonly calledTheTool: number
  readonly listenedOn: number | null
  readonly configuredPort: number | null
  readonly failure: string | null
  readonly stderr: string
}

async function capture(label: ArmName): Promise<Arm> {
  deadline.refuse(`starting arm ${label}`)
  const scratch = runScratch('claude-tool-answer')
  mkdirSync(scratch, { recursive: true })
  const root = mkdtempSync(join(scratch, `${label}-`))
  const home = join(root, 'home')
  const configDir = join(home, '.claude')
  const cwd = join(root, 'cwd')
  mkdirSync(configDir, { recursive: true })
  mkdirSync(cwd, { recursive: true })

  const requests: { path: string; body: unknown }[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      let body: unknown
      try {
        body = raw === '' ? null : JSON.parse(raw)
      } catch {
        body = raw
      }
      const path = request.url ?? ''
      requests.push({ path, body })
      if (!path.startsWith('/v1/messages')) {
        response.statusCode = 404
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error' } }))
        return
      }
      if (path.startsWith('/v1/messages/count_tokens')) {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ input_tokens: 11 }))
        return
      }
      const model = String((body as { model?: string } | null)?.model ?? 'claude-probe')
      // ⛔ **Our tool is called once, and only on a request that offers it and has not yet had
      // its answer** — every later request, and every side request the CLI makes, gets words.
      if (offersOurTool(body) && ourToolResult(body) === null) streamToolUse(response, model)
      else streamText(response, model, 'done')
    })
  })

  let calledTheTool = 0
  let listenedOn: number | null = null
  let configuredPort: number | null = null
  let failure: string | null = null
  let stderr = ''
  let streamSaw: Block | null = null
  let personRow: string | null = null
  const abort = new AbortController()

  const closeOwnedCapture = async (): Promise<void> => {
    abort.abort()
    server.closeAllConnections()
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  const release = deadline.own(() => closeOwnedCapture())

  try {
    listenedOn = await listen(server)
    deadline.refuse(`starting arm ${label} · the loopback port is bound`)
    const baseUrl = `http://127.0.0.1:${listenedOn}`
    const env = buildChildEnv({
      HOME: home,
      CLAUDE_CONFIG_DIR: configDir,
      ANTHROPIC_BASE_URL: baseUrl,
      CLAUDE_CODE_OAUTH_TOKEN: 'probe-only',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
      DISABLE_AUTOUPDATER: '1',
      ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
    })
    // Use a config directory under this arm’s scratch and no variable that strips its
    // per-directory suffix, keeping CLI Keychain prefetch away from the personal item.
    if (!(env['CLAUDE_CONFIG_DIR'] ?? '').startsWith(root)) {
      throw new Error('NOT PERFORMED — the config dir is not this arm’s own scratch')
    }
    if (env['CLAUDE_SECURESTORAGE_CONFIG_DIR'] !== undefined) {
      throw new Error(
        'NOT PERFORMED — CLAUDE_SECURESTORAGE_CONFIG_DIR would unscope the Keychain lookup',
      )
    }
    // ⚑ Rule 40: the port the child is CONFIGURED with, read back off the environment it is given.
    const configured = /^http:\/\/127\.0\.0\.1:(\d+)$/.exec(env['ANTHROPIC_BASE_URL'] ?? '')
    configuredPort = configured === null ? null : Number(configured[1])

    const answer = ARMS[label] as Answer
    const server675 = createSdkMcpServer({
      name: SERVER,
      tools: [
        tool(
          TOOL,
          '675 probe · answers with the arm under test',
          { note: z.string().optional() },
          async () => {
            calledTheTool += 1
            return answer
          },
        ),
      ],
    })

    const turn = query({
      prompt: '675 · call the tool',
      options: {
        cwd,
        env,
        model: 'claude-haiku-4-5',
        mcpServers: { [SERVER]: server675 },
        strictMcpConfig: true,
        settingSources: [],
        allowedTools: [QUALIFIED],
        maxTurns: 3,
        abortController: abort,
        stderr: (line: string) => {
          stderr += line
        },
      },
    })

    const drained = (async () => {
      for await (const message of turn as AsyncIterable<SDKMessage>) {
        if (message.type !== 'user') continue
        const content = (message.message as { content?: unknown }).content
        if (!Array.isArray(content)) continue
        for (const block of content as Block[]) {
          if (block.type !== 'tool_result' || block.tool_use_id !== TOOL_USE_ID) continue
          streamSaw = block
          for (const event of normalizeMessage(message)) {
            if (event.type === 'tool_result' && event.id === TOOL_USE_ID) personRow = event.summary
          }
        }
      }
    })()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        drained,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error(`NOT PERFORMED — the turn did not end in ${TURN_DEADLINE_MS}ms`)),
            TURN_DEADLINE_MS,
          )
          timer.unref?.()
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  } finally {
    await closeOwnedCapture()
    release()
  }

  const modelSaw =
    requests.map((one) => ourToolResult(one.body)).find((block) => block !== null) ?? null
  const arm: Arm = {
    label,
    requests,
    modelSaw,
    streamSaw,
    personRow,
    calledTheTool,
    listenedOn,
    configuredPort,
    failure,
    stderr: stderr.slice(-4_000),
  }
  const evidence = runEvidence('claude-tool-answer')
  mkdirSync(evidence, { recursive: true })
  writeFileSync(join(evidence, `${label}.json`), `${JSON.stringify(arm, null, 2)}\n`)
  if (failure === null) rmSync(root, { recursive: true, force: true })
  return arm
}

/**
 * ⚑ **680 · what CLI 2.1.281 adds to every tool answer on its way to the model**, and nothing the
 * tool said: a `<system-reminder>` carrying `<total_tokens>…</total_tokens>`, appended to the last
 * text block (arm A) or as a block of its own after a `\n` on the one before (arms B and C). The SDK
 * stream does not carry it, so the stream no longer equals the model-bound bytes whole — it equals
 * them with this taken off. It is not inherited from the caller's environment: `buildChildEnv` is an
 * allow-list and passes no `CLAUDE_*` name through.
 */
const CLI_REMINDER =
  /\n*<system-reminder>\n<total_tokens>[^<]*<\/total_tokens>\n<\/system-reminder>\s*$/

/** The model-bound text with the CLI's own reminder taken off — what OUR tool answered. */
function ours(texts: readonly string[]): string[] {
  let removed = false
  const kept = texts
    .map((text) => {
      const cut = text.replace(CLI_REMINDER, '')
      removed ||= cut !== text
      return cut
    })
    .filter((text) => text !== '')
  const last = kept.length - 1
  if (removed && last >= 0 && kept[last]!.endsWith('\n')) kept[last] = kept[last]!.slice(0, -1)
  return kept
}

/** The reminder(s) the CLI appended, verbatim — printed, so the next bump can see if it moved. */
function cliAppended(texts: readonly string[]): string[] {
  return texts.flatMap((text) => {
    const found = CLI_REMINDER.exec(text)
    return found === null ? [] : [found[0].trim()]
  })
}

/** A receipt's text, however the CLI shaped it: a string, or the text blocks in order. */
function textOf(block: Block | null): string[] {
  if (block === null) return []
  if (typeof block.content === 'string') return [block.content]
  if (!Array.isArray(block.content)) return []
  return (block.content as { type?: string; text?: string }[])
    .filter((one) => one.type === 'text')
    .map((one) => one.text ?? '')
}

const arms: Partial<Record<ArmName, Arm>> = {}

/** ⚑ One arm: capture it, print what it measured, and hold it to the table in the header. */
async function measure(label: ArmName): Promise<void> {
  const arm = await capture(label)
  arms[label] = arm
  console.log(
    `[675 ${label}]`,
    JSON.stringify(
      {
        failure: arm.failure,
        requests: arm.requests.map((one) => one.path),
        calledTheTool: arm.calledTheTool,
        modelSaw: textOf(arm.modelSaw),
        cliAppended: cliAppended(textOf(arm.modelSaw)),
        streamSaw: textOf(arm.streamSaw),
        personRow: arm.personRow,
      },
      null,
      2,
    ),
  )
  expect(arm.failure, arm.stderr).toBeNull()
  // ⚑ Rule 40 — the child was configured with the port this process listened on, and asked it.
  expect(arm.configuredPort).toBe(arm.listenedOn)
  expect(arm.requests.length).toBeGreaterThan(0)
  expect(arm.calledTheTool).toBe(1)
  expect(arm.modelSaw, 'the model-bound request never carried our receipt').not.toBeNull()
  expect(arm.personRow, 'the SDK stream never carried our receipt').not.toBeNull()
  // ⚑ The stream echoes what the model was handed of OUR answer — the normalizer reads those bytes.
  // ⚠️ Since CLI 2.1.281 the model is also handed the CLI's own reminder, which the stream is not
  // (680) — so the comparison is over what the tool said, with the reminder recorded beside it.
  expect(textOf(arm.streamSaw)).toEqual(ours(textOf(arm.modelSaw)))
  // 🔴 **The measurement, per arm** — a CLI that changes its handling turns one of these red.
  const json = JSON.stringify(PAYLOAD)
  const expected: Record<ArmName, { model: string[]; row: string }> = {
    'A-structured': { model: [json], row: `${json.slice(0, TOOL_SUMMARY_MAX)}…` },
    'B-two-texts': { model: [PROSE, json], row: `${PROSE.slice(0, TOOL_SUMMARY_MAX)}…` },
    'C-prose-only': { model: [PROSE], row: `${PROSE.slice(0, TOOL_SUMMARY_MAX)}…` },
  }
  expect(ours(textOf(arm.modelSaw))).toEqual(expected[label].model)
  expect(arm.personRow).toBe(expected[label].row)
  // ⛔ The premise that makes the arms differ: the prose is over the cut, so A's row never reaches it.
  expect(PROSE.length).toBeGreaterThan(TOOL_SUMMARY_MAX)
}

it(
  '675 · A-structured: what the model and the person read',
  () => deadline.within('arm A-structured', () => measure('A-structured')),
  deadline.testTimeoutMs,
)
it(
  '675 · B-two-texts: what the model and the person read',
  () => deadline.within('arm B-two-texts', () => measure('B-two-texts')),
  deadline.testTimeoutMs,
)
it(
  '675 · C-prose-only: what the model and the person read',
  () => deadline.within('arm C-prose-only', () => measure('C-prose-only')),
  deadline.testTimeoutMs,
)
