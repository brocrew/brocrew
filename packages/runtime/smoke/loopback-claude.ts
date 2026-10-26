import type { ChildProcess } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { delimiter, join } from 'node:path'
import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { isTheSamePath } from '../src/built-in-skills'
import { ClaudeRuntime, type QueryFactory } from '../src/claude/claude-runtime'
import { provisionProviderHome } from '../src/internal/provider-home'

/**
 * 🔴 **695 · the PRODUCT's Claude adapter, driven against a scripted loopback model** — the shared
 * rig behind `probe:per-task-stop`, `probe:permission-markers` and `probe:claude-limit-notice`.
 *
 * ## ⚑ Why the product adapter and not a bare `query()`
 *
 * `675`'s and `680`'s loopback probes call the SDK's `query()` themselves, which is right for a
 * question about what the CLI hands the MODEL. ⛔ **These three ask what the CLI does to BroBot's own
 * launch** — the options `optionsFor` builds, the guard hooks, `canUseTool`, the events the handle
 * emits — so the only honest subject is `ClaudeRuntime` itself. The one thing replaced is the
 * network: a {@link QueryFactory} wraps the product's own options and points the child at this
 * process's port.
 *
 * ## No real token, spend, or personal state
 *
 * `675`'s recipe: the SDK's bundled CLI, an owned `listen(0)` Messages endpoint on `127.0.0.1`, a
 * managed home this rig provisions through the product's own `provisionProviderHome` under its own
 * scratch root (so `CLAUDE_CONFIG_DIR` — and with it the CLI's Keychain prefetch — is scoped to an
 * item that does not exist), and the literal token `probe-only`, sent only to the loopback port. ⚑
 * The adapter is handed a token provider that answers that literal, so nothing here reads a
 * Keychain entry. ⛔ **The factory REFUSES a launch whose config dir is not this rig's scratch** —
 * a check on the options the product actually built, not on the ones this file meant it to build.
 *
 * ⚑ Rule 40: the port the child is configured with is read back off the environment the factory
 * hands it — after any control arm's rewrite — AND every request records the port it arrived on
 * ({@link SeenRequest.localPort}), so a probe asserts the child actually reached this endpoint.
 *
 * ## Another Claude Code than the SDK's own
 *
 * `BROBOT_PROBE_CLAUDE=<absolute path>` (or `program`) hands the runtime that program, as the app
 * hands it the one it found; the runtime, not this rig, sets `pathToClaudeCodeExecutable`. So any
 * probe on this rig runs unchanged against an installed Claude Code:
 * `BROBOT_PROBE_CLAUDE=/opt/homebrew/bin/claude pnpm run probe:token-reach`. A program named this
 * way is contained by default ({@link containLaunch}): a scratch `HOME`, and on macOS a `security`
 * that answers nothing, so it reads neither the person's home nor their Keychain. Each launch's
 * spawn is recorded ({@link SpawnSeen}), so a probe can say which program ran.
 *
 * *"This captures what the provider put in its model-bound request, not a hosted model's obedience
 * to the text."* ⚠️ Here the model is a script, so nothing measured is about a model at all: it is
 * the CLI's own handling of a turn, a task and an ask.
 */

/** One request the loopback model was asked, as it arrived. */
export interface SeenRequest {
  readonly path: string
  readonly body: unknown
  readonly headers: IncomingMessage['headers']
  /**
   * ⚑ **Rule 40, measured rather than restated** — the port this request actually ARRIVED on, off
   * its own socket. A probe asserts some request carried the port `server.address()` returned: the
   * child talked to THIS endpoint, not merely that it was told its port.
   */
  readonly localPort: number | undefined
}

/** What the scripted model answers one request with. */
export type ScriptedReply =
  | { readonly kind: 'text'; readonly text: string; readonly headers?: Record<string, string> }
  | {
      readonly kind: 'tool_use'
      readonly name: string
      readonly input: Record<string, unknown>
      readonly id: string
    }
  /** ⚑ Never answered — the request stays open until the rig closes. Keeps a turn in flight. */
  | { readonly kind: 'hold' }
  | {
      readonly kind: 'status'
      readonly status: number
      readonly headers: Record<string, string>
      readonly body: unknown
    }

export interface Loopback {
  readonly port: number
  readonly requests: SeenRequest[]
  readonly closed: boolean
  close(): Promise<void>
}

const USAGE = {
  input_tokens: 11,
  output_tokens: 1,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
}

function writeStream(response: ServerResponse, events: readonly Record<string, unknown>[]): void {
  for (const event of events) {
    response.write(`event: ${String(event['type'])}\ndata: ${JSON.stringify(event)}\n\n`)
  }
  response.end()
}

function streamReply(response: ServerResponse, model: string, reply: ScriptedReply): void {
  const start = {
    type: 'message_start',
    message: {
      id: 'msg_695',
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: USAGE,
    },
  }
  response.statusCode = 200
  response.setHeader('content-type', 'text/event-stream')
  if (reply.kind === 'text') {
    for (const [name, value] of Object.entries(reply.headers ?? {})) response.setHeader(name, value)
    writeStream(response, [
      start,
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: reply.text } },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 1 },
      },
      { type: 'message_stop' },
    ])
    return
  }
  if (reply.kind === 'tool_use') {
    writeStream(response, [
      start,
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
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use', stop_sequence: null },
        usage: { output_tokens: 1 },
      },
      { type: 'message_stop' },
    ])
  }
}

/**
 * ⚑ The model-bound requests only — `count_tokens` and anything not under `/v1/messages` answered
 * without asking the script.
 */
export async function startLoopback(
  decide: (request: SeenRequest) => ScriptedReply,
): Promise<Loopback> {
  const requests: SeenRequest[] = []
  const held: ServerResponse[] = []
  const server: Server = createServer((request, response) => {
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
      const seen: SeenRequest = {
        path,
        body,
        headers: request.headers,
        localPort: request.socket.localPort,
      }
      requests.push(seen)
      const reply = decide(seen)
      if (reply.kind === 'hold') {
        held.push(response)
        return
      }
      if (reply.kind === 'status') {
        response.statusCode = reply.status
        for (const [name, value] of Object.entries(reply.headers)) response.setHeader(name, value)
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify(reply.body))
        return
      }
      streamReply(
        response,
        String((body as { model?: string } | null)?.model ?? 'claude-probe'),
        reply,
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
    get closed() {
      return !server.listening
    },
    async close() {
      for (const one of held) one.destroy()
      server.closeAllConnections()
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

/** The first user turn's text of a model-bound request — which conversation is asking. */
export function firstUserText(request: SeenRequest): string {
  const body = request.body as { messages?: { role?: string; content?: unknown }[] } | null
  const first = body?.messages?.find((one) => one.role === 'user')
  return JSON.stringify(first?.content ?? '')
}

/** How many assistant turns a model-bound request already carries — the step of its conversation. */
export function assistantTurns(request: SeenRequest): number {
  const body = request.body as { messages?: { role?: string }[] } | null
  return (body?.messages ?? []).filter((one) => one.role === 'assistant').length
}

/** The tools the CLI offered the model in a request, by name. */
export function offeredTools(request: SeenRequest): { name: string; input_schema?: unknown }[] {
  const body = request.body as { tools?: { name?: string; input_schema?: unknown }[] } | null
  return (body?.tools ?? []).flatMap((one) =>
    typeof one.name === 'string' ? [{ name: one.name, input_schema: one.input_schema }] : [],
  )
}

/** One CLI child the SDK started, as the product's own spawn was asked to start it. */
export interface SpawnSeen {
  /** The program the launch's options named (`pathToClaudeCodeExecutable`); `null` when they named none. */
  readonly asked: string | null
  readonly command: string
  readonly args: readonly string[]
  /** The names in the child's environment, sorted, never a value. */
  readonly envNames: readonly string[]
  readonly pid: number | null
  /** Off this exact ChildProcess, rather than inferred from a later PID lookup. */
  exit: { code: number | null; signal: string | null } | null
}

/** Observation of the real SDK method: its promise and answer are returned unchanged. */
export interface ReloadSeen {
  readonly calledAt: number
  settledAt: number | null
  state: 'pending' | 'fulfilled' | 'rejected'
  /** Only schema/count/owned-fixture comparisons are retained; never response paths or text. */
  answer: {
    arrays: boolean
    errorCount: unknown
    ownedPlugin: boolean
  } | null
}

/** What one launch recorded on its way through the factory. */
export interface Recorded {
  /** ⚑ The options the PRODUCT built, with the rig's own environment edits applied. */
  options: Options | null
  /** The port the child was configured with — rule 40. */
  configuredPort: number | null
  /** Every `canUseTool` call the SDK made, with the options object it passed, as it passed it. */
  readonly asks: { toolName: string; input: unknown; options: Record<string, unknown> }[]
  readonly frames: SDKMessage[]
  /** Every child the launches started, in order. */
  readonly spawns: SpawnSeen[]
  /** Held handles for focused SDK teardown; never serialized into evidence. */
  readonly processes: ChildProcess[]
  readonly reloads: ReloadSeen[]
  /** The children's stderr, the last 8 000 characters — the product's spawn keeps it from the SDK. */
  stderr: string
}

export interface LoopbackRuntime {
  readonly runtime: ClaudeRuntime
  readonly recorded: Recorded
  readonly cwd: string
  readonly providerHome: string
  readonly root: string
  /** The program the runtime was handed, or `undefined` — the SDK finds its own. */
  readonly program: string | undefined
}

/** Where {@link containLaunch} puts a contained launch's home and its `security`, under a rig root. */
export function containmentOf(root: string): { home: string; bin: string; securityLog: string } {
  const bin = join(root, 'bin')
  return { home: join(root, 'home'), bin, securityLog: join(bin, 'security.log') }
}

/**
 * Keeps a launch from the person's own home and Keychain: a scratch `HOME` (and `USERPROFILE` on
 * Windows), and on macOS a `security` first on `PATH` that logs it was asked and answers not found
 * (exit 44). Throws NOT PERFORMED if the environment carries a credential-shaped name holding
 * anything but this rig's own fakes. `root` is the scratch folder it may write under.
 */
export function containLaunch(
  env: Record<string, string | undefined>,
  root: string,
  apiKey: string | undefined,
): void {
  for (const [name, value] of Object.entries(env)) {
    if (!/API_KEY|AUTH_TOKEN|OAUTH|BEARER|CREDENTIAL|SECRET|PASSWORD/i.test(name)) continue
    if (name === 'CLAUDE_CODE_OAUTH_TOKEN' && value === 'probe-only') continue
    if (name === 'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR' && /^\d+$/.test(value ?? '')) continue
    if (name === 'ANTHROPIC_API_KEY' && apiKey !== undefined && value === apiKey) continue
    throw new Error(`NOT PERFORMED — the child's environment carries ${name}`)
  }
  const { home, bin } = containmentOf(root)
  mkdirSync(home, { recursive: true })
  // Windows names are case-blind: the spelling the environment already has is the one to set.
  const named = (wanted: string): string =>
    Object.keys(env).find((key) => key.toUpperCase() === wanted) ?? wanted
  env[named('HOME')] = home
  if (process.platform === 'win32') env[named('USERPROFILE')] = home
  if (process.platform === 'darwin') {
    mkdirSync(bin, { recursive: true })
    writeFileSync(
      join(bin, 'security'),
      '#!/bin/sh\necho "$@" >> "$(dirname "$0")/security.log"\nexit 44\n',
    )
    chmodSync(join(bin, 'security'), 0o755)
    env['PATH'] = `${bin}${delimiter}${env['PATH'] ?? '/usr/bin:/bin'}`
  }
}

/**
 * ⚑ A product `ClaudeRuntime` whose every launch talks to `port` and nothing else.
 *
 * `rewrite` edits the product's options before they reach the SDK — ⚠️ **only ever to make a
 * CONTROL arm one fact apart** (for instance, the same launch without a declaration), never to make
 * the subject pass — **or to OBSERVE** (`721`: wrap a product hook to record what it was handed and
 * what it answered, returning that answer unchanged, on every arm alike). `sdkQuery` swaps the SDK
 * itself, for a measurement at another pin.
 */
export async function loopbackRuntime(args: {
  readonly scratch: string
  readonly label: string
  readonly port: number
  readonly rewrite?: (options: Options) => void
  readonly sdkQuery?: typeof query
  readonly maxRetries?: number
  /** A fake API key for the product to run on, as if a person had entered it. Never a real one. */
  readonly apiKey?: string
  /** Whose way of handing over that key the product takes (`handOverApiKey`); this Mac's by default. */
  readonly platform?: NodeJS.Platform
  /**
   * The Claude Code program the product runs, by absolute path — `BROBOT_PROBE_CLAUDE` when that is
   * set; absent, the SDK's own copy.
   */
  readonly program?: string
  /** {@link containLaunch} on every launch — by default exactly when a program was named. */
  readonly contain?: boolean
  /** Observe the real reload method; never replace it or supply a response. */
  readonly observeReload?: { readonly name: string; readonly path: string }
}): Promise<LoopbackRuntime> {
  const program = args.program ?? (process.env['BROBOT_PROBE_CLAUDE'] || undefined)
  const contain = args.contain ?? program !== undefined
  mkdirSync(args.scratch, { recursive: true })
  const root = mkdtempSync(join(args.scratch, `${args.label}-`))
  const managedRoot = join(root, 'provider-homes')
  const providerHome = join(managedRoot, 'claude-probe')
  const cwd = join(root, 'cwd')
  mkdirSync(cwd, { recursive: true })
  mkdirSync(managedRoot, { recursive: true })
  await provisionProviderHome(managedRoot, providerHome)
  const recorded: Recorded = {
    options: null,
    configuredPort: null,
    asks: [],
    frames: [],
    spawns: [],
    processes: [],
    reloads: [],
    stderr: '',
  }
  const factory: QueryFactory = (params) => {
    const options: Options = { ...params.options }
    const env: Record<string, string | undefined> = { ...(options.env ?? {}) }
    // 🔒 Refuse a launch this rig did not scope — see the header.
    if (!(env['CLAUDE_CONFIG_DIR'] ?? '').startsWith(root)) {
      throw new Error('NOT PERFORMED — the product built a config dir outside this probe’s scratch')
    }
    if (env['CLAUDE_SECURESTORAGE_CONFIG_DIR'] !== undefined) {
      throw new Error('NOT PERFORMED — CLAUDE_SECURESTORAGE_CONFIG_DIR would unscope the Keychain')
    }
    env['ANTHROPIC_BASE_URL'] = `http://127.0.0.1:${args.port}`
    // ⚑ A launch that runs on an API key carries its descriptor, or on the Windows route the key
    // itself, not a login: adding one here would hand the CLI two credentials and measure the wrong
    // one.
    if (
      env['CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR'] === undefined &&
      env['ANTHROPIC_API_KEY'] === undefined
    ) {
      env['CLAUDE_CODE_OAUTH_TOKEN'] = 'probe-only'
    }
    env['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'] = '1'
    env['DISABLE_AUTOUPDATER'] = '1'
    if (args.maxRetries !== undefined) env['CLAUDE_CODE_MAX_RETRIES'] = String(args.maxRetries)
    if (contain) containLaunch(env, root, args.apiKey)
    options.env = env
    // Wraps the product's own spawn, innermost, so what is recorded is what was started.
    const productSpawn = options.spawnClaudeCodeProcess
    if (productSpawn !== undefined) {
      options.spawnClaudeCodeProcess = (spawnOptions) => {
        const spawned = productSpawn(spawnOptions)
        const child = spawned as unknown as ChildProcess
        recorded.processes.push(child)
        const seen: SpawnSeen = {
          asked: options.pathToClaudeCodeExecutable ?? null,
          command: spawnOptions.command,
          args: [...spawnOptions.args],
          envNames: Object.keys(spawnOptions.env).sort(),
          pid: child.pid ?? null,
          exit: null,
        }
        recorded.spawns.push(seen)
        child.once('exit', (code, signal) => {
          seen.exit = { code, signal }
        })
        child.stderr?.on('data', (chunk: Buffer | string) => {
          recorded.stderr = (recorded.stderr + String(chunk)).slice(-8_000)
        })
        return spawned
      }
    }
    const productCanUseTool = options.canUseTool
    if (productCanUseTool !== undefined) {
      options.canUseTool = (toolName, input, o) => {
        recorded.asks.push({
          toolName,
          input: JSON.parse(JSON.stringify(input)) as unknown,
          options: Object.fromEntries(
            Object.entries(o).filter(([key]) => key !== 'signal'),
          ) as Record<string, unknown>,
        })
        return productCanUseTool(toolName, input, o)
      }
    }
    options.stderr = (line: string) => {
      recorded.stderr = (recorded.stderr + line).slice(-8_000)
    }
    args.rewrite?.(options)
    // ⚑ Read AFTER the rewrite, off the environment the child is actually handed.
    const configured = /^http:\/\/127\.0\.0\.1:(\d+)$/.exec(
      (options.env as Record<string, string | undefined> | undefined)?.['ANTHROPIC_BASE_URL'] ?? '',
    )
    recorded.configuredPort = configured === null ? null : Number(configured[1])
    recorded.options = options
    if (args.observeReload && args.sdkQuery !== undefined) {
      throw new Error('NOT PERFORMED — reload observation requires the imported real SDK query')
    }
    const live = (args.sdkQuery ?? query)({ prompt: params.prompt, options })
    return new Proxy(live, {
      get(target, prop) {
        if (prop === Symbol.asyncIterator) {
          return () => {
            const inner = target[Symbol.asyncIterator]()
            const outer: AsyncIterator<SDKMessage> & AsyncIterable<SDKMessage> = {
              async next() {
                const step = await inner.next()
                if (!step.done)
                  recorded.frames.push(JSON.parse(JSON.stringify(step.value)) as SDKMessage)
                return step
              },
              async return(value?: unknown) {
                return inner.return
                  ? inner.return(value as never)
                  : { done: true as const, value: undefined }
              },
              [Symbol.asyncIterator]() {
                return outer
              },
            }
            return outer
          }
        }
        const value = Reflect.get(target, prop, target) as unknown
        if (prop === 'reloadPlugins' && args.observeReload && typeof value === 'function') {
          return (...a: unknown[]) => {
            const seen: ReloadSeen = {
              calledAt: performance.now(),
              settledAt: null,
              state: 'pending',
              answer: null,
            }
            recorded.reloads.push(seen)
            // Invoke on the actual Query receiver; do not manufacture or transform its promise.
            const pending = (value as (...args: unknown[]) => Promise<unknown>).apply(target, a)
            void pending.then(
              (answer) => {
                const r = answer as Record<string, unknown> | null
                seen.answer = {
                  arrays:
                    r !== null &&
                    typeof r === 'object' &&
                    ['commands', 'agents', 'plugins', 'mcpServers'].every((key) =>
                      Array.isArray(r[key]),
                    ),
                  errorCount: typeof r?.['error_count'] === 'number' ? r['error_count'] : null,
                  ownedPlugin:
                    Array.isArray(r?.['plugins']) &&
                    r['plugins'].some((plugin: unknown) => {
                      const p = plugin as {
                        name?: unknown
                        path?: unknown
                      } | null
                      return (
                        p?.name === args.observeReload!.name &&
                        isTheSamePath(p.path, args.observeReload!.path)
                      )
                    }),
                }
                seen.state = 'fulfilled'
                seen.settledAt = performance.now()
              },
              () => {
                seen.state = 'rejected'
                seen.settledAt = performance.now()
              },
            )
            return pending
          }
        }
        return typeof value === 'function'
          ? (value as (...a: unknown[]) => unknown).bind(target)
          : value
      },
    })
  }
  const apiKey = args.apiKey
  const runtime = new ClaudeRuntime(
    factory,
    undefined,
    () => 'probe-only',
    undefined,
    undefined,
    apiKey === undefined ? undefined : () => apiKey,
    args.platform,
    undefined,
    program,
  )
  return { runtime, recorded, cwd, providerHome, root, program }
}

/** The CLI version a launch's own `system/init` announced. */
export function announcedVersion(frames: readonly SDKMessage[]): string | null {
  for (const frame of frames) {
    const f = frame as { type?: string; subtype?: string; claude_code_version?: string }
    if (f.type === 'system' && f.subtype === 'init') return f.claude_code_version ?? null
  }
  return null
}

/**
 * ⛔ **Close a session within `ms`, whatever state an arm left it in** — every probe calls this in
 * its `finally` and in the deadline's own teardown, so a failed or expired arm cannot leave its CLI
 * child running (standing rule 13: a stalled close is NOT PERFORMED, never waited on).
 */
export async function closeBounded(handle: { close(): Promise<void> }, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      handle.close().catch(() => {}),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** ⛔ Bounded, standing rule 13 — a wait that runs out is NOT PERFORMED, never a failure. */
export async function until(predicate: () => boolean, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`NOT PERFORMED — ${what} within ${ms}ms`)
}
