import { randomUUID } from 'node:crypto'
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
import type { ElicitationRequest, ElicitationResult, Options } from '@anthropic-ai/claude-agent-sdk'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { expect, it } from 'vitest'
import { z } from 'zod'
import { claudeAutoMemoryDir } from '../src/claude/auto-memory'
import type { RuntimeEvent } from '../src/events'
import type { SessionHandle } from '../src/runtime'
import {
  announcedVersion,
  closeBounded,
  firstUserText,
  loopbackRuntime,
  startLoopback,
  until,
  type SeenRequest,
} from './loopback-claude'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

/**
 * 🔴 **728 · R93 — does a Claude tool or MCP call behave in BroBot as it does in the CLI?**
 *
 * Run each scripted call twice through the product’s `ClaudeRuntime` using
 * `loopback-claude.ts`, with no real token, spend, or personal state:
 *
 * | arm | what it is |
 * |---|---|
 * | **cli** | the product's launch with BroBot's own `PreToolUse` hook REMOVED and an `onElicitation` that answers — so what reaches `canUseTool` is the CLI's own permission engine deciding, and what reaches `onElicitation` is the CLI forwarding a server's form |
 * | **product** | the product's launch, unchanged |
 *
 * ⚑ **The measure is WHERE THE CLI ASKS.** `canUseTool` is how the CLI asks its host (the SDK's
 * `can_use_tool`); an interactive CLI draws its own prompt at exactly those calls. A call the CLI
 * runs without asking never reaches `canUseTool` in the cli arm. The product arm then says whether
 * BroBot asks at the same calls, more, or fewer — and whether BroBot refuses a call on its own
 * (`PreToolUse` deny: the model is told, no card).
 *
 * ⚠️ *"This captures what the provider put in its model-bound request, not a hosted model's obedience
 * to the text."* Here the model is a script: what is measured is the CLI's handling of a call.
 *
 * Every card is answered Allow (WebFetch's Deny, so nothing is fetched), every question its first
 * option, and a server's form: `ask_form` → `{name:'Ada'}`, `ask_nothing` → accept, `ask_url` →
 * decline (nothing is opened). Run: `pnpm run probe:tool-calls-as-the-cli`. Not part of `pnpm run ci`.
 */

const WORDS = '728 tool-calls-as-the-cli probe'
const SERVER = 'probe728'

type Step = { readonly name: string; readonly input: (at: Paths) => Record<string, unknown> }
interface Paths {
  readonly cwd: string
  /** ⚑ 736 · the folder `cwd` sits in — where the `grant-*` scenarios' OUTSIDE files live. */
  readonly root: string
  readonly memory: string
  readonly port: number
}
interface Scenario {
  readonly key: string
  readonly steps: readonly Step[]
  readonly plan?: true
  readonly auto?: true
  /** ⚑ The MODEL enters plan mode itself (its first step is `EnterPlanMode`). */
  readonly enters?: true
  /**
   * 🔴 **736 · R94/R95 — a STANDING grant, pressed on the first card**: the cli arm answers that ask
   * with the CLI's OWN suggestions, as its "don't ask again" installs them (the SDK's own doc: return
   * *"this full set of suggestions"*); the product arm presses this outcome on its card, as a person
   * would. Every later card is a plain Allow on both.
   */
  readonly grant?: 'allow_for_session' | 'allow_always'
}

const bash = (command: string): Step => ({
  name: 'Bash',
  input: () => ({ command, description: `728 probe · ${command}` }),
})
const mcp = (tool: string): Step => ({
  name: `mcp__${SERVER}__${tool}`,
  input: () => ({ note: tool }),
})
const readA: Step = { name: 'Read', input: (at) => ({ file_path: `${at.cwd}/a.txt` }) }
const enterPlan: Step = { name: 'EnterPlanMode', input: () => ({}) }
const write = (name: string): Step => ({
  name: 'Write',
  input: (at) => ({ file_path: `${at.cwd}/${name}`, content: '728\n' }),
})
/** ⚑ 736 · a file OUTSIDE the conversation's folder — `<root>/<dir>/<name>`, beside `cwd`. */
const outside = (tool: 'Read' | 'Write', dir: string, name: string): Step => ({
  name: tool,
  input: (at) => ({
    file_path: `${at.root}/${dir}/${name}`,
    ...(tool === 'Write' ? { content: '736\n' } : {}),
  }),
})

const SCENARIOS: readonly Scenario[] = [
  { key: 'read', steps: [readA] },
  { key: 'grep', steps: [{ name: 'Grep', input: (at) => ({ pattern: 'seven', path: at.cwd }) }] },
  { key: 'glob', steps: [{ name: 'Glob', input: (at) => ({ pattern: '*.txt', path: at.cwd }) }] },
  { key: 'bash-ls', steps: [bash('ls')] },
  { key: 'bash-echo', steps: [bash('echo 728')] },
  { key: 'bash-git-status', steps: [bash('git status')] },
  { key: 'bash-rm', steps: [bash('rm -f zz728.txt')] },
  // ⚑ 740 · a command the interactive CLI offers a prefix rule for (*"don't ask again for: make build
  // \*"*, measured) — the Bash ask whose kept rule is not an `rm`'s.
  { key: 'bash-make', steps: [bash('make build')] },
  // ⚑ 740 · a file command like `rm` that is not `rm` (`736`'s interactive `A3x`: folder only).
  { key: 'bash-touch', steps: [bash('touch t728.txt')] },
  { key: 'write', steps: [write('new.txt')] },
  {
    key: 'edit',
    steps: [
      readA,
      {
        name: 'Edit',
        input: (at) => ({
          file_path: `${at.cwd}/a.txt`,
          old_string: 'seven',
          new_string: 'eight',
        }),
      },
    ],
  },
  {
    key: 'webfetch',
    steps: [
      {
        name: 'WebFetch',
        input: (at) => ({ url: `http://127.0.0.1:${String(at.port)}/728`, prompt: 'say it' }),
      },
    ],
  },
  { key: 'mcp', steps: [mcp('note_it')] },
  { key: 'mcp-read-only', steps: [mcp('look_it_up')] },
  {
    key: 'memory',
    steps: [
      {
        name: 'Write',
        input: (at) => ({ file_path: `${at.memory}/probe_728.md`, content: '728\n' }),
      },
    ],
  },
  { key: 'plan-write', plan: true, steps: [write('plan.txt')] },
  { key: 'plan-bash', plan: true, steps: [bash('ls')] },
  { key: 'plan-mcp', plan: true, steps: [mcp('note_it')] },
  // ⚑ An ORDINARY ask while planning — does the CLI still offer its own "don't ask again"?
  { key: 'plan-bash-rm', plan: true, steps: [bash('rm -f zz728.txt')] },
  // ⚑ The flow a person actually has: the MODEL enters plan mode itself, then acts — attended, and
  // in a session that may skip permissions (the terminal's `--dangerously-skip-permissions`). Each
  // arm's premise is the modes the CLI announces: its launch mode, then `plan`.
  { key: 'enter-plan-write', enters: true, steps: [enterPlan, write('plan.txt')] },
  { key: 'enter-plan-write-auto', enters: true, auto: true, steps: [enterPlan, write('plan.txt')] },
  {
    key: 'enter-plan-bash-auto',
    enters: true,
    auto: true,
    steps: [enterPlan, bash('wc -l a.txt')],
  },
  {
    key: 'enter-plan-rm-auto',
    enters: true,
    auto: true,
    steps: [enterPlan, bash('rm -f zz728.txt')],
  },
  { key: 'enter-plan-mcp-auto', enters: true, auto: true, steps: [enterPlan, mcp('note_it')] },
  // ⚑ The unattended mode, not planning: does the CLI's own skip-permissions still ask anything?
  { key: 'auto-bash-rm', auto: true, steps: [bash('rm -f zz728.txt')] },
  { key: 'auto-write', auto: true, steps: [write('new.txt')] },
  { key: 'auto-mcp', auto: true, steps: [mcp('note_it')] },
  { key: 'auto-write-claude-dir', auto: true, steps: [write('.claude/settings.local.json')] },
  { key: 'auto-write-git-dir', auto: true, steps: [write('.git/probe728')] },
  { key: 'auto-write-vscode-dir', auto: true, steps: [write('.vscode/settings.json')] },
  { key: 'write-claude-dir', steps: [write('.claude/settings.local.json')] },
  { key: 'write-git-dir', steps: [write('.git/probe728')] },
  // 🔴 **736 · R94 — the conversation grant is the CLI's own rule**: a read outside the folder,
  // granted for the conversation, then another file in the SAME folder, then one in another folder.
  {
    key: 'grant-read-outside',
    grant: 'allow_for_session',
    steps: [
      outside('Read', 'outside', 'a.txt'),
      outside('Read', 'outside', 'b.txt'),
      outside('Read', 'elsewhere', 'c.txt'),
    ],
  },
  // …a write in the folder, granted for the conversation, then another, then one outside it.
  {
    key: 'grant-write',
    grant: 'allow_for_session',
    steps: [write('n1.txt'), write('n2.txt'), outside('Write', 'outside', 'o1.txt')],
  },
  // 🔴 **740 · R99 — *always*, kept where the CLI keeps it: the PROJECT's local settings** — `make
  // build`, always allowed, then the same command again in this session. (`736` pressed *always* on
  // an `rm`; the interactive CLI offers none there, so neither does BroBot now.)
  {
    key: 'grant-make-always',
    grant: 'allow_always',
    steps: [bash('make build'), bash('make build')],
  },
  // 🔴 **740 · R99 (`736` F-9) — an `rm`'s conversation grant is the interactive CLI's: its folder**,
  // so the same `rm` is asked again (measured on the interactive CLI, K1).
  {
    key: 'grant-rm',
    grant: 'allow_for_session',
    steps: [bash('rm -f zz728.txt'), bash('rm -f zz728.txt')],
  },
  { key: 'elicit-form', steps: [mcp('ask_form')] },
  { key: 'elicit-empty', steps: [mcp('ask_nothing')] },
  { key: 'elicit-url', steps: [mcp('ask_url')] },
  {
    key: 'question-auto',
    auto: true,
    steps: [
      {
        name: 'AskUserQuestion',
        input: () => ({
          questions: [
            {
              question: 'Which one, 728?',
              header: 'Pick',
              multiSelect: false,
              options: [
                { label: 'Alpha', description: 'the first' },
                { label: 'Beta', description: 'the second' },
              ],
            },
          ],
        }),
      },
    ],
  },
]

type ArmName = 'cli' | 'product'

const TURN_MS = 60_000
const TEARDOWN_MS = 15_000
const deadline = probeRunDeadline(
  '728 tool-calls-as-the-cli probe',
  runBudgetMs(SCENARIOS.flatMap(() => [TURN_MS, TEARDOWN_MS, TURN_MS, TEARDOWN_MS])),
  TEARDOWN_MS,
)

/**
 * ⚑ **The step a conversation is at — the tool calls it already made**, counted as `tool_use` blocks.
 * ⚠️ Not `assistantTurns`: the rig answers every request as the same message id, and the CLI merges
 * two assistant messages that share one, so a two-step scenario would stand at step one for ever
 * (measured: the Edit step re-asked 1,581 times inside one arm's bound).
 */
function toolUsesSoFar(request: SeenRequest): number {
  const messages = (request.body as { messages?: { role?: string; content?: unknown }[] } | null)
    ?.messages
  let count = 0
  for (const message of messages ?? []) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (const part of message.content as { type?: string }[])
      if (part.type === 'tool_use') count += 1
  }
  return count
}

/** What the external server saw. */
interface ServerTraffic {
  readonly ran: string[]
  readonly answered: Record<string, string>
}

/** ⚑ A real external MCP server over streamable HTTP, one `McpServer` per session (`605`). */
async function startServer(
  traffic: ServerTraffic,
): Promise<{ readonly url: string; readonly close: () => Promise<void> }> {
  const build = (): McpServer => {
    const server = new McpServer({ name: 'brobot-728-probe', version: '0.0.0' })
    const answered = async (tool: string, ask: () => Promise<unknown>): Promise<string> => {
      try {
        traffic.answered[tool] = JSON.stringify(await ask())
      } catch (error) {
        traffic.answered[tool] = `error: ${error instanceof Error ? error.message : String(error)}`
      }
      return traffic.answered[tool]
    }
    server.registerTool(
      'note_it',
      { description: '728 probe · records that it ran', inputSchema: { note: z.string() } },
      () => {
        traffic.ran.push('note_it')
        return { content: [{ type: 'text', text: 'R728 note_it ran' }] }
      },
    )
    server.registerTool(
      'look_it_up',
      {
        description: '728 probe · records that it ran; its server says it only reads',
        inputSchema: { note: z.string() },
        annotations: { readOnlyHint: true },
      },
      () => {
        traffic.ran.push('look_it_up')
        return { content: [{ type: 'text', text: 'R728 look_it_up ran' }] }
      },
    )
    server.registerTool(
      'ask_form',
      { description: '728 probe · asks a one-field form', inputSchema: { note: z.string() } },
      async () => {
        traffic.ran.push('ask_form')
        const said = await answered('ask_form', () =>
          server.server.elicitInput({
            message: 'The 728 probe asks your name.',
            requestedSchema: {
              type: 'object',
              properties: { name: { type: 'string', title: 'Your name' } },
              required: ['name'],
            },
          }),
        )
        return { content: [{ type: 'text', text: `R728 ask_form · ${said}` }] }
      },
    )
    server.registerTool(
      'ask_nothing',
      { description: '728 probe · asks a zero-field form', inputSchema: { note: z.string() } },
      async () => {
        traffic.ran.push('ask_nothing')
        const said = await answered('ask_nothing', () =>
          server.server.elicitInput({
            message: 'The 728 probe asks: may I go on?',
            requestedSchema: { type: 'object', properties: {} },
          }),
        )
        return { content: [{ type: 'text', text: `R728 ask_nothing · ${said}` }] }
      },
    )
    server.registerTool(
      'ask_url',
      { description: '728 probe · asks a url-mode elicitation', inputSchema: { note: z.string() } },
      async () => {
        traffic.ran.push('ask_url')
        const said = await answered('ask_url', () =>
          server.server.elicitInput({
            mode: 'url',
            message: 'The 728 probe asks you to visit a page.',
            url: 'https://example.invalid/728-consent',
            elicitationId: 'probe-728-url',
          }),
        )
        return { content: [{ type: 'text', text: `R728 ask_url · ${said}` }] }
      },
    )
    return server
  }
  const transports = new Map<string, StreamableHTTPServerTransport>()
  const http = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      if (request.url === '/728') {
        response.setHeader('content-type', 'text/plain')
        response.end('728')
        return
      }
      const sessionId = request.headers['mcp-session-id']
      const existing = typeof sessionId === 'string' ? transports.get(sessionId) : undefined
      if (request.method !== 'POST') {
        if (existing) await existing.handleRequest(request, response)
        else {
          response.statusCode = 400
          response.end()
        }
        return
      }
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(chunk as Buffer)
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (existing) {
        await existing.handleRequest(request, response, body)
        return
      }
      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id: string): void => {
          transports.set(id, transport)
        },
      })
      await build().connect(transport)
      await transport.handleRequest(request, response, body)
    })()
  })
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject)
    http.listen(0, '127.0.0.1', resolve)
  })
  const address = http.address()
  if (address === null || typeof address === 'string') throw new Error('no loopback port')
  return {
    url: `http://127.0.0.1:${String(address.port)}/mcp`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const one of transports.values()) void one.close()
        http.closeAllConnections()
        http.close(() => resolve())
      }),
  }
}

/** ⚑ The text of every `tool_result` the CLI sent the model back — what the model was TOLD. */
function toolResults(requests: readonly SeenRequest[]): string[] {
  const told: string[] = []
  for (const request of requests) {
    const messages = (request.body as { messages?: { role?: string; content?: unknown }[] } | null)
      ?.messages
    const last = messages?.[messages.length - 1]
    if (last?.role !== 'user' || !Array.isArray(last.content)) continue
    for (const part of last.content as { type?: string; content?: unknown; is_error?: boolean }[]) {
      if (part.type !== 'tool_result') continue
      const text =
        typeof part.content === 'string'
          ? part.content
          : Array.isArray(part.content)
            ? (part.content as { text?: string }[]).map((one) => one.text ?? '').join('\n')
            : ''
      told.push(`${part.is_error === true ? 'ERROR ' : ''}${text}`.slice(0, 400))
    }
  }
  return [...new Set(told)]
}

/** One arm of one scenario, as measured. */
interface Measured {
  readonly scenario: string
  readonly arm: ArmName
  readonly cli: string | null
  /** ⚑ The mode the CLI itself announced in its `system/init` — each plan arm's premise. */
  readonly permissionMode: string | null
  /** ⚑ Every mode the CLI announced, in order (`system/init`, then any `system/status`). */
  readonly modes: string[]
  readonly listenedOn: number
  readonly configuredPort: number | null
  readonly reachedThisPort: boolean
  /** ⚑ Every call the CLI asked its host about, and the rules it offered to remember. */
  readonly asked: {
    tool: string
    suggestions: unknown
    decisionReason: unknown
    /** ⚑ 740 · the ask's marks and words, as the SDK hands them — what a host can read. */
    marks?: Record<string, unknown>
  }[]
  readonly cards: string[]
  readonly questions: number
  /** ⚑ Cards and questions the product marked as a SERVER's own request (`mcpServerAsks`). */
  readonly serverCards: number
  /** ⚑ A server's form the CLI handed `onElicitation` (the cli arm only). */
  readonly elicited: { mode: string | undefined; message: string; fields: string[] }[]
  readonly toolResults: string[]
  /** ⚑ What the arm left in its working directory — a write that happened is a file. */
  readonly files: string[]
  /** ⚑ 736 · the settings file a kept rule may have landed in: the provider home's, and the repo's. */
  readonly homeSettings: string | null
  readonly repoLocalSettings: string | null
  readonly server: ServerTraffic
  readonly failure: string | null
  readonly stderr: string
}

function containment(options: Options): void {
  const env = { ...(options.env ?? {}) } as Record<string, string | undefined>
  const configDir = env['CLAUDE_CONFIG_DIR']
  if (configDir === undefined) throw new Error('NOT PERFORMED — no CLAUDE_CONFIG_DIR to contain')
  // 🔒 `677`'s containment on top of the rig's: the rig's own root as HOME, and a `security` that
  // answers nothing, first on PATH — so no Keychain entry is asked for by name, whatever the CLI does.
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

/** The permission mode a launch's own `system/init` announced. */
function announcedMode(frames: readonly unknown[]): string | null {
  for (const frame of frames) {
    const f = frame as { type?: string; subtype?: string; permissionMode?: string }
    if (f.type === 'system' && f.subtype === 'init') return f.permissionMode ?? null
  }
  return null
}

/** Every permission mode the CLI announced, in order. */
function announcedModes(frames: readonly unknown[]): string[] {
  const modes: string[] = []
  for (const frame of frames) {
    const f = frame as { type?: string; subtype?: string; permissionMode?: string }
    if (f.type === 'system' && typeof f.permissionMode === 'string') modes.push(f.permissionMode)
  }
  return modes
}

async function measure(scenario: Scenario, arm: ArmName): Promise<Measured> {
  deadline.refuse(`starting ${scenario.key} · ${arm}`)
  const traffic: ServerTraffic = { ran: [], answered: {} }
  const server = await startServer(traffic)
  const serverPort = Number(new URL(server.url).port)
  const words = `${WORDS} · ${scenario.key} · ${arm}`
  let paths: Paths | null = null
  const loopback = await startLoopback((request) => {
    if (paths === null || !firstUserText(request).includes(words))
      return { kind: 'text', text: 'ok' }
    const at = toolUsesSoFar(request)
    const step = scenario.steps[at]
    if (step === undefined) return { kind: 'text', text: '728 done' }
    return {
      kind: 'tool_use',
      id: `toolu_728_${String(at)}`,
      name: step.name,
      input: step.input(paths),
    }
  })
  const elicited: Measured['elicited'] = []
  /** ⚑ 736 · the asks a `grant` scenario's cli arm answered itself (its own recorder, not the rig's). */
  const echoed: { tool: string; suggestions: unknown }[] = []
  let cardsSeen = 0
  let handle: SessionHandle | null = null
  const release = deadline.own(async () => {
    if (handle !== null) await closeBounded(handle, TEARDOWN_MS)
    await loopback.close()
    await server.close()
  })
  const events: RuntimeEvent[] = []
  let failure: string | null = null
  let rig: Awaited<ReturnType<typeof loopbackRuntime>> | null = null
  try {
    rig = await loopbackRuntime({
      scratch: runScratch('tool-calls-as-the-cli'),
      label: `${scenario.key}-${arm}`,
      port: loopback.port,
      rewrite: (options) => {
        containment(options)
        if (arm !== 'cli') return
        // ⚑ The ONE fact apart: BroBot's own gate out, so the CLI's engine decides alone.
        options.hooks = options.hooks?.Stop === undefined ? {} : { Stop: options.hooks.Stop }
        options.onElicitation = (request: ElicitationRequest): Promise<ElicitationResult> => {
          const schema = request.requestedSchema as
            { properties?: Record<string, unknown> } | undefined
          const fields = Object.keys(schema?.properties ?? {})
          elicited.push({ mode: request.mode, message: request.message, fields })
          if (request.mode === 'url') return Promise.resolve({ action: 'decline' })
          const content: Record<string, string> = fields.length === 0 ? {} : { name: 'Ada' }
          return Promise.resolve({ action: 'accept', content })
        }
        if (scenario.auto === true) {
          // The CLI's own unattended mode: `--dangerously-skip-permissions` — and, planning, its
          // plan mode entered from that session (skip-permissions still available).
          options.permissionMode = scenario.plan === true ? 'plan' : 'bypassPermissions'
          options.allowDangerouslySkipPermissions = true
        }
        // 🔴 736 · the CLI's own "don't ask again", answered as its host would: the first ask with the
        // full set of its suggestions, every later one a plain allow. Recorded as every ask is.
        if (scenario.grant !== undefined) {
          const rigAsks = options.canUseTool
          let first = true
          options.canUseTool = async (toolName, input, o) => {
            echoed.push({ tool: toolName, suggestions: o.suggestions ?? null })
            void rigAsks
            const answer = first
              ? {
                  behavior: 'allow' as const,
                  updatedInput: input,
                  updatedPermissions: o.suggestions ?? [],
                }
              : { behavior: 'allow' as const, updatedInput: input }
            first = false
            return answer
          }
        }
      },
    })
    writeFileSync(join(rig.cwd, 'a.txt'), 'seven\n')
    // ⚑ 736 · the files the `grant-*` scenarios read outside the folder.
    for (const [dir, name] of [
      ['outside', 'a.txt'],
      ['outside', 'b.txt'],
      ['elsewhere', 'c.txt'],
    ] as const) {
      mkdirSync(join(dirname(rig.cwd), dir), { recursive: true })
      writeFileSync(join(dirname(rig.cwd), dir, name), `${name}\n`)
    }
    // ⚑ What an `rm` arm removes, so a command that ran leaves a trace on disk (`728`'s review).
    writeFileSync(join(rig.cwd, 'zz728.txt'), '728\n')
    paths = {
      cwd: rig.cwd,
      root: dirname(rig.cwd),
      memory: claudeAutoMemoryDir(rig.providerHome),
      port: serverPort,
    }
    const started = await rig.runtime.start({
      cwd: rig.cwd,
      providerHome: rig.providerHome,
      model: 'claude-haiku-4-5',
      approvalMode: scenario.auto === true ? 'auto' : 'ask',
      ...(scenario.plan === true ? { planMode: true } : {}),
      externalMcp: { servers: [{ name: SERVER, url: server.url }], reservedToolNames: [] },
    })
    handle = started
    void (async () => {
      for await (const event of started.events()) {
        events.push(event)
        if (event.type === 'permission_request') {
          cardsSeen += 1
          // ⚑ 736 · a `grant` scenario presses its standing grant on its FIRST card, as a person would.
          // ⚑ A SERVER's card that offers no Allow — its url request, since CLI 2.1.287 — is denied,
          // the one answer a person there can give that is not Cancel. ⛔ Only a server's: any other
          // card that lost its Allow should hang this probe, not be quietly denied.
          const serversCardWithNoAllow =
            event.mcpServerAsks !== undefined && !event.scope.availableDecisions.includes('allow')
          const outcome =
            scenario.key === 'webfetch' || serversCardWithNoAllow
              ? 'deny'
              : scenario.grant !== undefined && cardsSeen === 1
                ? scenario.grant
                : 'allow'
          void started.respondPermission(event.id, { outcome }).catch(() => {})
        }
        if (event.type === 'user_input_request') {
          const answers = Object.fromEntries(
            event.questions.map((one) => [one.id, one.options[0]?.label ?? 'Ada']),
          )
          void started.respondUserInput(event.id, { kind: 'answer', answers }).catch(() => {})
        }
      }
    })()
    await started.send(words)
    await until(() => events.some((one) => one.type === 'turn'), TURN_MS, 'the turn to close')
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  } finally {
    if (handle !== null) await closeBounded(handle, TEARDOWN_MS)
    await loopback.close()
    await server.close()
    release()
  }
  const measured: Measured = {
    scenario: scenario.key,
    arm,
    cli: rig === null ? null : announcedVersion(rig.recorded.frames),
    permissionMode: rig === null ? null : announcedMode(rig.recorded.frames),
    modes: rig === null ? [] : announcedModes(rig.recorded.frames),
    listenedOn: loopback.port,
    configuredPort: rig?.recorded.configuredPort ?? null,
    reachedThisPort: loopback.requests.some((one) => one.localPort === loopback.port),
    asked: [
      ...(rig?.recorded.asks ?? []).map((one) => ({
        tool: one.toolName,
        suggestions: one.options['suggestions'] ?? null,
        decisionReason: one.options['decisionReason'] ?? null,
        marks: Object.fromEntries(
          [
            'title',
            'displayName',
            'description',
            'blockedPath',
            'suppressAlwaysAllowRule',
            'defaultToNo',
            'matchedAskRule',
          ].flatMap((key) => (one.options[key] === undefined ? [] : [[key, one.options[key]]])),
        ),
      })),
      ...echoed.map((one) => ({ ...one, decisionReason: null })),
    ],
    cards: events.flatMap((one) =>
      one.type === 'permission_request'
        ? [`${one.action} · ${one.scope.availableDecisions.join('/')}`]
        : [],
    ),
    questions: events.filter((one) => one.type === 'user_input_request').length,
    serverCards: events.filter(
      (one) =>
        (one.type === 'permission_request' || one.type === 'user_input_request') &&
        one.mcpServerAsks !== undefined,
    ).length,
    elicited,
    toolResults: toolResults(loopback.requests),
    files: rig === null || !existsSync(rig.cwd) ? [] : readdirSync(rig.cwd).sort(),
    homeSettings:
      rig === null || !existsSync(join(rig.providerHome, 'settings.json'))
        ? null
        : readFileSync(join(rig.providerHome, 'settings.json'), 'utf8'),
    repoLocalSettings:
      rig === null || !existsSync(join(rig.cwd, '.claude', 'settings.local.json'))
        ? null
        : readFileSync(join(rig.cwd, '.claude', 'settings.local.json'), 'utf8'),
    server: traffic,
    failure,
    stderr: rig?.recorded.stderr ?? '',
  }
  const evidence = runEvidence('tool-calls-as-the-cli')
  mkdirSync(evidence, { recursive: true })
  writeFileSync(
    join(evidence, `${scenario.key}-${arm}.json`),
    `${JSON.stringify({ ...measured, events }, null, 2)}\n`,
  )
  if (failure === null && rig !== null && existsSync(rig.root)) {
    rmSync(rig.root, { recursive: true, force: true })
  }
  console.log(
    `[728 · ${scenario.key} · ${arm}]`,
    JSON.stringify({
      asked: measured.asked.map((one) => one.tool),
      modes: measured.modes,
      files: measured.files,
      cards: measured.cards,
      questions: measured.questions,
      elicited: measured.elicited,
      ran: traffic.ran,
      answered: traffic.answered,
      told: measured.toolResults,
      failure,
    }),
  )
  return measured
}

const results = new Map<string, { cli: Measured; product: Measured }>()

async function both(scenario: Scenario): Promise<{ cli: Measured; product: Measured }> {
  const cli = await measure(scenario, 'cli')
  const product = await measure(scenario, 'product')
  for (const one of [cli, product]) {
    expect(one.failure, `${one.scenario} · ${one.arm}\n${one.stderr}`).toBeNull()
    // ⚑ Rule 40: the child was configured with this port AND talked to it.
    expect(one.configuredPort).toBe(one.listenedOn)
    expect(one.reachedThisPort).toBe(true)
    // ⚑ Each arm's premise, read off the child: a plan arm really ran in the CLI's plan mode, and
    // no other arm did — else a "plan" row measures an ordinary conversation.
    if (scenario.enters === true) {
      // ⚑ The model-entered arms: the launch mode, then `plan`, both announced by the CLI itself.
      expect(one.modes, `${one.scenario} · ${one.arm}: the modes the CLI announced`).toEqual([
        scenario.auto === true && one.arm === 'cli' ? 'bypassPermissions' : 'default',
        'plan',
      ])
      continue
    }
    expect(one.permissionMode, `${one.scenario} · ${one.arm}: the mode the CLI announced`).toBe(
      scenario.plan === true
        ? 'plan'
        : // ⚑ The product's `auto` runs in the CLI's `default` and answers every ask itself.
          scenario.auto === true && one.arm === 'cli'
          ? 'bypassPermissions'
          : 'default',
    )
  }
  results.set(scenario.key, { cli, product })
  return { cli, product }
}

const asksOf = (one: Measured): string[] =>
  one.asked.map((ask) => ask.tool).filter((tool) => tool !== 'AskUserQuestion')
const cardsOf = (one: Measured): string[] => one.cards.map((card) => card.split(' · ')[0]!)
const offeredOn = (card: string | undefined): string[] => card?.split(' · ')[1]?.split('/') ?? []
/** A refusal of BroBot's own — its sentences name it. */
const refused = (one: Measured): string[] =>
  one.toolResults.filter((told) => told.startsWith('ERROR ') && /brobot2/i.test(told))

/**
 * ⚑ **What the CLI itself asked, pinned absolutely** — the facts `728`'s notes and docblocks cite.
 * Product-equals-CLI alone would stay green if both arms went silent; this table would not.
 */
const THE_CLI_ASKS: Record<string, string[]> = {
  read: [],
  grep: [],
  glob: [],
  'bash-ls': [],
  'bash-echo': [],
  'bash-git-status': [],
  'bash-rm': ['Bash'],
  'bash-make': ['Bash'],
  'bash-touch': ['Bash'],
  write: ['Write'],
  edit: ['Edit'],
  webfetch: ['WebFetch'],
  mcp: [`mcp__${SERVER}__note_it`],
  'mcp-read-only': [`mcp__${SERVER}__look_it_up`],
  memory: [],
  'plan-write': ['Write'],
  'plan-bash': [],
  'plan-mcp': [`mcp__${SERVER}__note_it`],
  'plan-bash-rm': ['Bash'],
  'write-claude-dir': ['Write'],
  'write-git-dir': ['Write'],
}

/**
 * ⚑ **Did the CLI offer its own "don't ask again" on the ask** — its `suggestions`. The plan-mode
 * check offers none, an ordinary ask does, planning or not; BroBot withholds the conversation grant
 * on exactly the first (`offersAStandingRule`).
 */
const THE_CLI_SUGGESTS: Record<string, boolean> = {
  write: true,
  'bash-rm': true,
  mcp: true,
  webfetch: true,
  'plan-write': false,
  'plan-mcp': false,
  'plan-bash-rm': true,
}

for (const scenario of SCENARIOS.filter(
  (one) =>
    !one.key.startsWith('elicit-') &&
    one.auto !== true &&
    one.enters !== true &&
    one.grant === undefined,
)) {
  it(
    `728 · ${scenario.key}: BroBot asks where the CLI asks, and refuses nothing the CLI runs`,
    () =>
      deadline.within(scenario.key, async () => {
        const { cli, product } = await both(scenario)
        expect(asksOf(cli), 'what the CLI itself asked').toEqual(THE_CLI_ASKS[scenario.key])
        expect(asksOf(product), 'BroBot asked where the CLI did not, or not where it did').toEqual(
          asksOf(cli),
        )
        // ⚑ …and every one of those asks reached the person as a card: an answer given inside
        // `canUseTool` with no card is invisible to the line above (`728`'s review).
        expect(cardsOf(product), 'an ask BroBot answered with no card').toEqual(asksOf(cli))
        expect(refused(product), 'BroBot refused a call on its own account').toEqual([])
        expect(product.files, 'what is on disk after both arms, each card allowed').toEqual(
          cli.files,
        )
        const suggests = THE_CLI_SUGGESTS[scenario.key]
        if (suggests !== undefined) {
          const offered = cli.asked.map(
            (ask) => Array.isArray(ask.suggestions) && ask.suggestions.length > 0,
          )
          expect(offered, 'did the CLI offer its own "don’t ask again"').toEqual([suggests])
          if (scenario.plan === true) {
            // ⚑ While planning, the grant follows the CLI's own offer.
            expect(offeredOn(product.cards[0]).length > 3, 'a conversation grant offered').toBe(
              suggests,
            )
          }
        }
      }),
    deadline.testTimeoutMs,
  )
}

/**
 * 🔴 **736 · R94/R95 — what the CLI asks AFTER its own "don't ask again", pinned absolutely** — and
 * the product's standing grant is held to it, card for card — ⚑ `740`: except where the INTERACTIVE CLI
 * is the reference ({@link THE_PRODUCT_CARDS_AFTER_ITS_GRANT}). ⚑ Measured: a read outside the folder
 * covers its folder and not another; a write's *allow all edits* covers the next edit in the folder
 * and not one outside it; `make build`'s kept rule, echoed at `localSettings` only, is asked again in
 * the running session (`settingSources: []`).
 */
const THE_CLI_ASKS_AFTER_ITS_GRANT: Record<string, string[]> = {
  'grant-read-outside': ['Read', 'Read'],
  'grant-write': ['Write', 'Write'],
  // ⚑ 740 · the cli arm echoes the kept rule at `localSettings` ONLY, and under `settingSources: []`
  // the CLI does not apply a file rule in the running session (measured, `736`) — so it asks again.
  'grant-make-always': ['Bash', 'Bash'],
}

/**
 * ⚑ **740 · where the product is held to the INTERACTIVE CLI rather than to this probe's cli arm** —
 * K3: its *"don't ask again for: make build \*"* held for the rest of the session (the product sends
 * the rule at `session` beside `localSettings` for exactly that).
 */
const THE_PRODUCT_CARDS_AFTER_ITS_GRANT: Record<string, string[]> = {
  'grant-make-always': ['Bash'],
}

for (const [key, expected] of Object.entries(THE_CLI_ASKS_AFTER_ITS_GRANT)) {
  it(
    `736 · ${key}: a person's standing grant covers what the CLI's own covers — the CLI's rule, never a narrower one`,
    () =>
      deadline.within(key, async () => {
        const { cli, product } = await both(SCENARIOS.find((one) => one.key === key)!)
        expect(asksOf(cli), 'what the CLI asked after its own grant').toEqual(expected)
        // 🔴 ⛔ On `main` (`728`): the product installed a rule for exactly the first file, so the
        // second read and the second write were asked again — a card the CLI never raised.
        expect(cardsOf(product), 'the cards after the product’s grant').toEqual(
          THE_PRODUCT_CARDS_AFTER_ITS_GRANT[key] ?? asksOf(cli),
        )
        expect(refused(product), 'BroBot refused a call on its own account').toEqual([])
        if (key === 'grant-make-always') {
          // 🔴 **740 · R99 — kept where the CLI keeps it: the project's local settings**, the file
          // the CLI's own *"don't ask again"* writes (its cli arm, and the interactive CLI, K3) — and
          // never the provider home. ⛔ On `main` (`736`): the provider home's `settings.json`.
          expect(product.cards[0], 'the card offered always').toContain('allow_always')
          expect(product.repoLocalSettings ?? '', 'kept in the project').toContain(
            'Bash(make build *)',
          )
          expect(product.homeSettings, 'never in the provider home').toBeNull()
          expect(cli.repoLocalSettings ?? '', 'the CLI’s own: the same file').toContain(
            'Bash(make build *)',
          )
        }
      }),
    deadline.testTimeoutMs,
  )
}

it(
  '740 · grant-rm: an `rm`’s conversation grant is the interactive CLI’s — its folder — so the same `rm` is asked again',
  () =>
    deadline.within('grant-rm', async () => {
      const { product } = await both(SCENARIOS.find((one) => one.key === 'grant-rm')!)
      // ⚑ The reference is the INTERACTIVE CLI (`740`'s K1/K2): its only non-once choice on an `rm`
      // adds the folder for the session and asks the same `rm` again. ⚠️ This probe's cli arm echoes
      // the SDK's whole set instead (its own doc's *"this full set"*), so it is not the reference here.
      // ⛔ On `main` (`736`) the product installed that whole set and the second `rm` ran unasked.
      expect(cardsOf(product), 'the cards after the conversation grant').toEqual(['Bash', 'Bash'])
      expect(offeredOn(product.cards[0]), 'no always on an rm').not.toContain('allow_always')
      expect(product.repoLocalSettings, 'nothing kept').toBeNull()
      expect(product.homeSettings, 'nothing kept').toBeNull()
      expect(refused(product), 'BroBot refused a call on its own account').toEqual([])
    }),
  deadline.testTimeoutMs,
)

for (const scenario of SCENARIOS.filter(
  (one) => one.key.startsWith('elicit-') && one.key !== 'elicit-url',
)) {
  it(
    `728 · ${scenario.key}: a server's form reaches the person as the CLI hands it over`,
    () =>
      deadline.within(scenario.key, async () => {
        const { cli, product } = await both(scenario)
        // ⚑ Premise, read off the child: the CLI DOES hand this form to its host.
        expect(cli.elicited.length, 'the CLI never handed its host the form').toBe(1)
        const tool = scenario.steps[0]!.name.split('__')[2]!
        expect(
          product.serverCards,
          'the server asked and no person saw it as the server’s own request',
        ).toBe(1)
        expect(product.server.answered[tool]).toBe(cli.server.answered[tool])
      }),
    deadline.testTimeoutMs,
  )
}

/**
 * ⚑ **Until CLI 2.1.281 the CLI declared no url support**, so the server was told *"Client does not
 * support url elicitation"* and no host ever saw the request. 2.1.287 supports url elicitations
 * (its changelog: the 2025-11-25 protocol) and hands one to its host like a form. BroBot's card for
 * it offers no way to allow — this app cannot open the page for the person — so a person's Deny
 * must reach the server as the same `decline` the CLI's own host sends.
 */
it(
  '728 · elicit-url: the CLI hands a url request to its host, and BroBot’s card has no Allow and a Deny declines',
  () =>
    deadline.within('elicit-url', async () => {
      const { cli, product } = await both(SCENARIOS.find((one) => one.key === 'elicit-url')!)
      // ⚑ Premise, read off the child: the CLI handed the host the url form.
      expect(cli.elicited.map((one) => one.mode)).toEqual(['url'])
      expect(product.serverCards, 'the server asked and no person saw it').toBe(1)
      // ⚑ Exactly the two refusals: any allow-like choice (`allow_for_session` too) would be a card
      // offering what this app cannot do.
      expect(product.cards.at(-1)?.split(' · ').at(-1), 'the card offers only refusals').toBe(
        'deny/cancel',
      )
      // ⚑ Pinned outright: the CLI arm's `decline` is this probe's own host answer, so comparing the
      // two alone would pass with both missing.
      expect(cli.server.answered['ask_url']).toBe('{"action":"decline"}')
      expect(product.server.answered['ask_url']).toBe('{"action":"decline"}')
    }),
  deadline.testTimeoutMs,
)

it(
  '728 · question-auto: a question in the CLI’s unattended mode — for the record',
  () =>
    deadline.within('question-auto', async () => {
      const { cli, product } = await both(SCENARIOS.find((one) => one.key === 'question-auto')!)
      console.log(
        '[728 · question-auto]',
        JSON.stringify({
          cliAskedTheHost: cli.asked.map((one) => one.tool),
          productQuestions: product.questions,
          cliTold: cli.toolResults,
        }),
      )
      expect(product.questions).toBe(1)
    }),
  deadline.testTimeoutMs,
)

/**
 * ⚑ **What the CLI's own unattended mode asks, pinned absolutely** — its skip-permissions, and its
 * plan mode as the model enters it from such a session. BroBot's `auto` answers every other ask
 * itself — not a plan-mode one, which reaches the person — so each row is also exactly the cards a
 * person must see.
 */
const THE_UNATTENDED_CLI_ASKS: Record<string, string[]> = {
  'enter-plan-write-auto': ['Write'],
  'enter-plan-bash-auto': [],
  'enter-plan-rm-auto': ['Bash'],
  'enter-plan-mcp-auto': [`mcp__${SERVER}__note_it`],
  'auto-bash-rm': [],
  'auto-write': [],
  'auto-mcp': [],
  'auto-write-claude-dir': [],
  'auto-write-git-dir': [],
  'auto-write-vscode-dir': [],
}

for (const [key, expected] of Object.entries(THE_UNATTENDED_CLI_ASKS)) {
  it(
    `728 · ${key}: in \`auto\`, the person sees what the CLI’s unattended mode asks, and nothing else`,
    () =>
      deadline.within(key, async () => {
        const { cli, product } = await both(SCENARIOS.find((one) => one.key === key)!)
        console.log(
          `[728 · ${key}]`,
          JSON.stringify({
            cliAsked: asksOf(cli),
            productCards: product.cards,
            ran: product.server.ran,
          }),
        )
        expect(asksOf(cli), 'what the CLI’s unattended mode itself asked').toEqual(expected)
        expect(cardsOf(product), 'the cards BroBot’s `auto` raised').toEqual(asksOf(cli))
        // ⚑ …and what it let through went through (`728`'s review): the same tools ran on the
        // server, nothing was refused on BroBot's account, and the same files are on disk.
        expect(product.server.ran, 'what the server ran').toEqual(cli.server.ran)
        expect(refused(product), 'BroBot refused a call on its own account').toEqual([])
        expect(product.files).toEqual(cli.files)
      }),
    deadline.testTimeoutMs,
  )
}

it(
  '🔴 736 · R98 · enter-plan-write: the CLI does NOT ask before the model’s own EnterPlanMode — and in `ask` neither does BroBot',
  () =>
    deadline.within('enter-plan-write', async () => {
      const { cli, product } = await both(SCENARIOS.find((one) => one.key === 'enter-plan-write')!)
      expect(asksOf(cli), 'what the CLI asked: the Write, and not EnterPlanMode').toEqual(['Write'])
      // ⛔ On `main` (`728` F-11): a consent card of BroBot's own — one question — before the Write.
      // ⚑ The hook still ROUTES `EnterPlanMode` to the callback, which allows it and settles the plan
      // there (`asksOf(product)` names it); what a person sees is the CLI's asks and nothing else.
      expect(product.questions, 'no consent card').toBe(0)
      expect(cardsOf(product), 'a person sees what the CLI asked').toEqual(asksOf(cli))
      // ⚑ …and the Write, asked while planning, offers no conversation grant — the CLI's plan-mode
      // check offers none (`728`), which only holds if the allow settled the plan.
      expect(offeredOn(product.cards[0]), 'no conversation grant while planning').toEqual([
        'allow',
        'deny',
        'cancel',
      ])
    }),
  deadline.testTimeoutMs,
)
