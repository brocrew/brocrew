import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'
import type { RuntimeEvent } from '../src/events'
import type { SessionHandle } from '../src/runtime'
import type { SessionRef } from '../src/session-ref'
import { changeCodexKeyInHome } from '../src/codex/codex-login'
import type { TransportFactory } from '../src/codex/codex-runtime'
import { bundledCodexTransportFactory } from './bundled-codex'
import { bounded } from './cancel-interrupt-reader'
import {
  announcedVersion,
  closeBounded,
  loopbackRuntime,
  offeredTools,
  startLoopback,
  until,
  type LoopbackRuntime,
  type ScriptedReply,
  type SeenRequest,
} from './loopback-claude'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

/**
 * 🔒 **Does a Claude credential reach anything a Claude agent runs?** A presence-only check, for
 * both credentials a launch can run on.
 *
 * ## The question
 *
 * BroBot launches each Claude CLI on one of two credentials (`ClaudeRuntime.childEnvAdditions`):
 * - **an API key a person entered**, written into a pipe the CLI reads as descriptor 3 — the
 *   environment carries only `CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR=3`; ⚑ **on Windows**, where the
 *   CLI can read no such pipe, as `ANTHROPIC_API_KEY` in the CLI's environment beside
 *   `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST=1` (`handOverApiKey`);
 * - **otherwise the machine login**, as `CLAUDE_CODE_OAUTH_TOKEN` in the CLI's environment.
 *
 * An environment, and an open descriptor, are inherited by default, so the question is what the CLI
 * passes on to the processes IT starts.
 *
 * ## How it is measured, and why it reads no credential
 *
 * The product's own `ClaudeRuntime` is driven against a scripted loopback model
 * (`loopback-claude.ts`): a scratch provider home, an owned `127.0.0.1` port, and no Keychain read.
 * The credentials are the fakes {@link FAKE_TOKEN} and {@link FAKE_KEY}. Each route runs one tiny
 * recorder ({@link RECORDER}) that writes down only whether each name in {@link NAMES} is set, how
 * many of its environment's values contain a fake under ANY name, and whether it inherited a
 * descriptor 3. It never writes a value.
 *
 * - **Bash:** the scripted model runs the recorder through `Bash` in the foreground, then in the
 *   background, then asks a sub-agent to run it through its own `Bash`.
 * - **stdio MCP server:** the recorder is added as one, and answers just enough MCP to be listed.
 * - **Hooks:** the recorder is added as a `SessionStart`, `UserPromptSubmit` and `PreToolUse` command
 *   hook through the flag settings.
 * - **Launch paths:** a fresh start, then a resume of the same conversation in a new CLI process,
 *   on each credential. Every Claude launch in the app builds its environment in
 *   `childEnvAdditions`, whoever asked for it (a person, or another agent); the model list does
 *   too, and runs no tools.
 * - **The Windows route, on this Mac:** the key arms again, with the product told it runs on
 *   Windows (`ClaudeRuntime`'s `platform`). The CLI's JavaScript is the same on both systems, so
 *   what it passes on is measured here; that the CLI reads the key on Windows itself is measured by
 *   `scripts/windows-packaged-check.mjs` on GitHub's Windows runner.
 *
 * ⚠️ BroBot itself launches no stdio MCP server and no command hook today: its own tools run in its
 * own process, external servers are reached over HTTP, and `settingSources: []` loads no settings
 * file. The observers are added here to measure what the CLI WOULD hand one.
 *
 * Controls, so a "not set" is a measurement:
 * - `CLAUDE_CONFIG_DIR` comes from the same additions as the credential: a route that sees it and
 *   not the credential is a route the CLI filtered, not one that saw no environment.
 * - {@link CANARY} carries the arm's fake under another name: the value scan is shown to work.
 * - Off the wire: the loopback must receive the arm's fake (a login bearer, or an `x-api-key`), and
 *   never the other credential — the CLI held the one the product chose.
 * - What the product put in the CLI's own environment, read before this probe adds anything: on a
 *   key arm, the descriptor's number and never the key; on a Windows-route arm, the key and the
 *   switch, and no descriptor.
 *
 * ## What it measured (2026-10-02, SDK 0.3.281, CLI 2.1.281)
 *
 * On all seven routes, both launch paths and both credentials: `CLAUDE_CONFIG_DIR` set, the canary
 * set, no credential name set (`CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`,
 * `CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR`), the fake under no name but the canary's, and no
 * descriptor 3 inherited — while the CLI authenticated with the credential. A secret under a name
 * the CLI does not know (the canary) passes straight through, which is why the key never travels as
 * `ANTHROPIC_API_KEY`. Not measured: the same with `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` set, which
 * BroBot never sets. ⚠️ What this does NOT protect: the CLI process's own starting environment,
 * which another process of the same user can read (`ps -E`, measured on a throwaway process).
 *
 * ⚑ **The Windows route (2026-10-02, SDK 0.3.287, CLI 2.1.287), on this Mac:** the CLI sent the key
 * as its `x-api-key`; on all seven routes, fresh and resumed, `ANTHROPIC_API_KEY` was not set and the
 * key was under no name but the canary's. ⚑ The control, the same launch without
 * `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST`: `ANTHROPIC_API_KEY` set on all seven — the switch is what
 * keeps it out.
 *
 * Installed Claude Code (SDK 0.3.287, macOS, each run with `BROBOT_PROBE_CLAUDE=<that program>`):
 * 2.1.257 and 2.1.290 hold on all seven routes, both credentials and both handovers. 2.1.245 does
 * not: on the key arms it passes `CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR=3` on to what it runs (the
 * name, never the key, and no descriptor 3). So the oldest tested version
 * (`claude-code-tested.json`) is 2.1.257, the first published after 2.1.252, which
 * `probe:claude-installed` shows doing the same.
 *
 * Run: `pnpm run probe:token-reach`, on another Claude Code with `BROBOT_PROBE_CLAUDE=<path>`. Not
 * part of `pnpm run ci`.
 */

/** The fake login token the login arms carry. Never a real one. */
const FAKE_TOKEN = 'fake-for-presence-test'

/** The fake API key the key arms run on, as if a person had entered it. Never a real one. */
const FAKE_KEY = 'sk-ant-fake-for-tests'

/**
 * The positive control: the arm's fake value again, under a name the CLI has no reason to remove. A
 * route that reports it is a route where the value scan works, and where a secret that is NOT on
 * the CLI's list would arrive.
 */
const CANARY = 'TOKEN_REACH_CANARY'

/**
 * The names each route reports on. `CLAUDE_CONFIG_DIR` and {@link CANARY} are controls. Only the
 * Windows route's launch env carries `ANTHROPIC_API_KEY`, and there its absence is the measurement;
 * elsewhere it, like `ANTHROPIC_AUTH_TOKEN`, says nothing slipped one in on the way.
 * `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST` is no credential: the CLI passes it on, so a `claude` an
 * agent starts runs host-managed too, and the Windows route's arms record that it does.
 */
const NAMES = [
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST',
  'CLAUDE_CONFIG_DIR',
  CANARY,
] as const

/** Every route that must report, or the arm was not measured. */
const ROUTES = [
  'bash',
  'bash-background',
  'bash-subagent',
  'mcp',
  'hook:SessionStart',
  'hook:UserPromptSubmit',
  'hook:PreToolUse',
] as const

/**
 * The recorder: `node recorder.mjs <route> <out> <mode> <fd3>`. It appends one JSON line — booleans,
 * a count, and what descriptor 3 was — then either serves a minimal MCP (`mode` = `mcp`) or reads
 * its stdin to the end and exits.
 *
 * ⚑ **Descriptor 3** is where the CLI reads the person's key from. Whether a route INHERITED it is
 * asked by the shell that starts the recorder, before Node opens descriptors of its own
 * ({@link FD3_CHECK}): `none`, `socket`, `fifo` or `other`. Node's pipes are socket pairs.
 */
const RECORDER = `import { appendFileSync } from 'node:fs'
const [route, out, mode] = process.argv.slice(2)
const names = ${JSON.stringify(NAMES)}
const fakes = ${JSON.stringify([FAKE_TOKEN, FAKE_KEY])}
const present = Object.fromEntries(names.map((name) => [name, process.env[name] !== undefined]))
const fakeValueAnywhere = Object.values(process.env).filter((value) =>
  fakes.some((fake) => (value ?? '').includes(fake)),
).length
const fd3 = process.argv[5] ?? 'unknown'
appendFileSync(out, JSON.stringify({ route, present, fakeValueAnywhere, fd3 }) + '\\n')
if (mode === 'mcp') {
  let buffer = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    buffer += chunk
    let end
    while ((end = buffer.indexOf('\\n')) >= 0) {
      const line = buffer.slice(0, end)
      buffer = buffer.slice(end + 1)
      let message
      try { message = JSON.parse(line) } catch { continue }
      if (message.id === undefined) continue
      const result =
        message.method === 'initialize'
          ? { protocolVersion: message.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'presence-recorder', version: '1' } }
          : message.method === 'tools/list'
            ? { tools: [] }
            : null
      const reply = result === null
        ? { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'not offered' } }
        : { jsonrpc: '2.0', id: message.id, result }
      process.stdout.write(JSON.stringify(reply) + '\\n')
    }
  })
  process.stdin.on('end', () => process.exit(0))
} else {
  process.stdin.resume()
  process.stdin.on('end', () => process.exit(0))
  setTimeout(() => process.exit(0), 5000).unref()
}
`

/**
 * The shell words that say what descriptor 3 is, as `$k`, before the recorder starts. Every route
 * runs the recorder through a shell (the CLI runs Bash calls and hook commands with one; the MCP
 * server is started as `/bin/sh -c`), so each answer is about what that route inherited.
 */
const FD3_CHECK =
  'k=none; if [ -S /dev/fd/3 ]; then k=socket; elif [ -p /dev/fd/3 ]; then k=fifo; ' +
  'elif [ -e /dev/fd/3 ]; then k=other; fi; '

/** The shell command that runs the recorder for one route, after {@link FD3_CHECK}. */
function recorderCommand(script: string, route: string, file: string, mode: string): string {
  const node = JSON.stringify(process.execPath)
  return `${FD3_CHECK}exec ${node} ${JSON.stringify(script)} ${route} ${JSON.stringify(file)} ${mode} "$k"`
}

interface Report {
  readonly route: string
  readonly present: Record<(typeof NAMES)[number], boolean>
  readonly fakeValueAnywhere: number
  readonly fd3: string
}

/** What a launch runs on: the machine login, or an API key a person entered. */
type Credential = 'login' | 'key'

/** One product runtime, and one conversation to resume, per credential and the way it is handed over. */
type Rig = 'login' | 'key' | 'key-windows'

const ARMS = [
  'fresh',
  'resumed',
  'key-fresh',
  'key-resumed',
  'key-windows-fresh',
  'key-windows-resumed',
] as const
type Arm = (typeof ARMS)[number]

const CREDENTIAL: Readonly<Record<Arm, Credential>> = {
  fresh: 'login',
  resumed: 'login',
  'key-fresh': 'key',
  'key-resumed': 'key',
  'key-windows-fresh': 'key',
  'key-windows-resumed': 'key',
}

const RIG: Readonly<Record<Arm, Rig>> = {
  fresh: 'login',
  resumed: 'login',
  'key-fresh': 'key',
  'key-resumed': 'key',
  'key-windows-fresh': 'key-windows',
  'key-windows-resumed': 'key-windows',
}

/** The platform each rig's product is told it runs on: this Mac's, or Windows for its key route. */
const PLATFORM: Readonly<Record<Rig, NodeJS.Platform | undefined>> = {
  login: undefined,
  key: undefined,
  'key-windows': 'win32',
}

const FAKE_OF: Readonly<Record<Credential, string>> = { login: FAKE_TOKEN, key: FAKE_KEY }

/** The word each arm's prompt carries, so the scripted model knows which turn is asking. */
const WORDS: Readonly<Record<Arm, string>> = {
  fresh: 'token-reach fresh: run the recorder',
  resumed: 'token-reach resumed: run the recorder again',
  'key-fresh': 'token-reach key fresh: run the recorder',
  'key-resumed': 'token-reach key resumed: run the recorder again',
  'key-windows-fresh': 'token-reach key windows fresh: run the recorder',
  'key-windows-resumed': 'token-reach key windows resumed: run the recorder again',
}

/** What the main agent asks its sub-agent to do, per arm. */
const SUB_WORDS: Readonly<Record<Arm, string>> = {
  fresh: 'token-reach sub-agent fresh: run the recorder',
  resumed: 'token-reach sub-agent resumed: run the recorder',
  'key-fresh': 'token-reach sub-agent key fresh: run the recorder',
  'key-resumed': 'token-reach sub-agent key resumed: run the recorder',
  'key-windows-fresh': 'token-reach sub-agent key windows fresh: run the recorder',
  'key-windows-resumed': 'token-reach sub-agent key windows resumed: run the recorder',
}

/** ⚠️ Each wait is bounded; one that runs out is NOT PERFORMED, never a pass. */
const START_MS = 45_000
const SEND_MS = 30_000
const TURN_MS = 60_000
/** The background command may report after the turn has ended. */
const REPORTS_MS = 15_000
const TEARDOWN_MS = 15_000
const WAITS = [START_MS, SEND_MS, TURN_MS, REPORTS_MS, TEARDOWN_MS]

/** The Codex arm: a login, a logout and the reads around them, on the bundled binary. */
const CODEX_MS = 60_000

const deadline = probeRunDeadline(
  'token-reach probe',
  runBudgetMs([...ARMS.flatMap(() => WAITS), CODEX_MS]),
  TEARDOWN_MS,
)

/** The last message of a model-bound request. */
function lastMessage(request: SeenRequest): { role?: string; content?: unknown } | undefined {
  const body = request.body as { messages?: { role?: string; content?: unknown }[] } | null
  return body?.messages?.at(-1)
}

interface Message {
  readonly role?: string
  readonly content?: unknown
}

function messagesOf(request: SeenRequest): Message[] {
  return (request.body as { messages?: Message[] } | null)?.messages ?? []
}

/**
 * Every tool call this request's conversation has already answered. ⚠️ The scripted model decides
 * from this set rather than from the order of blocks: the CLI merges consecutive user turns into
 * one message, and the API puts tool answers before any text in it, so block order does not say
 * what came last.
 */
function answeredCalls(request: SeenRequest): Set<string> {
  const ids = new Set<string>()
  for (const message of messagesOf(request)) {
    if (!Array.isArray(message.content)) continue
    for (const block of message.content as { type?: string; tool_use_id?: string }[]) {
      if (block.type === 'tool_result' && block.tool_use_id) ids.add(block.tool_use_id)
    }
  }
  return ids
}

/** Whether a person's words, or a sub-agent's prompt, in this request carry `words`. */
function promptedWith(request: SeenRequest, words: string, firstOnly: boolean): boolean {
  const users = messagesOf(request).filter((one) => one.role === 'user')
  return (firstOnly ? users.slice(0, 1) : users).some((one) =>
    JSON.stringify(one.content ?? '').includes(words),
  )
}

/** What the product put in a launch's environment, read before this probe adds anything. */
interface LaunchEnv {
  readonly descriptor: boolean
  readonly loginToken: boolean
  readonly apiKeyName: boolean
  /** Whether the fake KEY's value is anywhere in the environment the CLI is handed. */
  readonly keyValueInEnv: boolean
  /** Whether the CLI is told the host provides its credential (the Windows route's switch). */
  readonly managedByHost: boolean
}

interface Measured {
  readonly arm: Arm
  readonly cli: string | null
  /** At least one request reached this arm's loopback. */
  readonly reachedThisPort: boolean
  /** The premise, off the wire: the CLI held this arm's fake credential and authenticated with it. */
  readonly cliUsedTheCredential: boolean
  /** A key arm's requests carried no login bearer, and a login arm's carried no API key. */
  readonly onlyThatCredential: boolean
  readonly launchEnv: LaunchEnv | null
  /**
   * The CLI answered the background call as a background shell (its own words: "Command running in
   * background with ID"), so `bash-background` really ran as one.
   */
  readonly ranInBackground: boolean
  readonly reports: Report[]
  readonly failure: string | null
  readonly stderr: string
}

/**
 * The scripted model, one step per answer: Bash in the foreground, Bash in the background, a
 * sub-agent, and the sub-agent's own Bash. Everything else is told `done`.
 */
function script(arm: Arm): (request: SeenRequest) => ScriptedReply {
  const id = (step: string) => `toolu_token_reach_${arm.replaceAll('-', '_')}_${step}`
  const bash = (step: string, route: string, background: boolean): ScriptedReply => ({
    kind: 'tool_use',
    id: id(step),
    name: 'Bash',
    input: {
      command: recorderCommand(recorder(arm), route, out(arm), 'bash'),
      description: 'presence-only recorder',
      ...(background ? { run_in_background: true } : {}),
    },
  })
  return (request) => {
    const tools = offeredTools(request).map((one) => one.name)
    if (!tools.includes('Bash')) return { kind: 'text', text: 'done' }
    const answered = answeredCalls(request)
    // The sub-agent's conversation opens with the prompt it was given.
    if (promptedWith(request, SUB_WORDS[arm], true)) {
      return answered.has(id('sub'))
        ? { kind: 'text', text: 'done' }
        : bash('sub', 'bash-subagent', false)
    }
    if (!promptedWith(request, WORDS[arm], false)) return { kind: 'text', text: 'done' }
    if (!answered.has(id('fg'))) return bash('fg', 'bash', false)
    if (!answered.has(id('bg'))) return bash('bg', 'bash-background', true)
    const agent = tools.find((name) => name === 'Agent' || name === 'Task')
    if (!answered.has(id('agent')) && agent !== undefined) {
      return {
        kind: 'tool_use',
        id: id('agent'),
        name: agent,
        input: {
          description: 'presence check',
          prompt: SUB_WORDS[arm],
          subagent_type: 'general-purpose',
        },
      }
    }
    return { kind: 'text', text: 'done' }
  }
}

function readReports(arm: Arm): Report[] {
  if (!existsSync(out(arm))) return []
  return readFileSync(out(arm), 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Report)
}

/** One rig, and one conversation to resume, per credential. */
const rigs: Partial<Record<Rig, LoopbackRuntime>> = {}
const refs: Partial<Record<Rig, SessionRef>> = {}
const launchEnvs: Partial<Record<Arm, LaunchEnv>> = {}
const measured: Partial<Record<Arm, Measured>> = {}

const isFresh = (arm: Arm): boolean =>
  arm === 'fresh' || arm === 'key-fresh' || arm === 'key-windows-fresh'

async function measure(arm: Arm): Promise<Measured> {
  deadline.refuse(`arm ${arm}`)
  const credential = CREDENTIAL[arm]
  const rigName = RIG[arm]
  const loopback = await startLoopback(script(arm))
  let handle: SessionHandle | null = null
  let over = false
  const release = deadline.own(async () => {
    if (handle !== null) await closeBounded(handle, TEARDOWN_MS)
    await loopback.close()
  })
  const events: RuntimeEvent[] = []
  let failure: string | null = null
  currentArm = arm
  currentPort = loopback.port
  try {
    if (isFresh(arm)) {
      const platform = PLATFORM[rigName]
      rigs[rigName] = await loopbackRuntime({
        scratch: runScratch('token-reach'),
        label: `token-reach-${rigName}`,
        port: loopback.port,
        rewrite: (options) => observe(options),
        ...(credential === 'key' ? { apiKey: FAKE_KEY } : {}),
        ...(platform === undefined ? {} : { platform }),
      })
    }
    const current = rigs[rigName]
    if (current === undefined) throw new Error(`NOT PERFORMED — no ${rigName} rig`)
    writeFileSync(out(arm), '')
    let opening: Promise<SessionHandle>
    if (isFresh(arm)) {
      opening = current.runtime.start({
        cwd: current.cwd,
        providerHome: current.providerHome,
        model: 'claude-haiku-4-5',
        approvalMode: 'auto',
      })
    } else {
      const ref = refs[rigName]
      if (ref === undefined) throw new Error('NOT PERFORMED — the fresh arm left no conversation')
      opening = current.runtime.resume(ref, {
        providerHome: current.providerHome,
        model: 'claude-haiku-4-5',
        approvalMode: 'auto',
      })
    }
    // ⚠️ A launch that answers after its bound is still closed — never a CLI left running.
    opening
      .then((late) => {
        handle = late
        if (over) void closeBounded(late, TEARDOWN_MS)
      })
      .catch(() => undefined)
    const started = await bounded(`the ${arm} launch`, opening, START_MS)
    handle = started
    void (async () => {
      for await (const event of started.events()) events.push(event)
    })()
    deadline.refuse(`arm ${arm} · the session is open`)
    await bounded('the turn’s send', started.send(WORDS[arm]), SEND_MS)
    await until(() => events.some((one) => one.type === 'turn'), TURN_MS, 'the turn’s end')
    if (isFresh(arm) && started.ref !== null) refs[rigName] = started.ref
    await until(
      () => {
        const routes = new Set(readReports(arm).map((one) => one.route))
        return ROUTES.every((route) => routes.has(route))
      },
      REPORTS_MS,
      'a report from every route',
    )
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  } finally {
    over = true
    if (handle !== null) await closeBounded(handle, TEARDOWN_MS)
    await loopback.close()
    release()
  }
  const rig = rigs[rigName]
  // ⚠️ Headers are compared here and never written anywhere: the evidence holds booleans only.
  const bearer = (one: SeenRequest): boolean =>
    typeof one.headers.authorization === 'string' && one.headers.authorization !== ''
  const apiKeyHeader = (one: SeenRequest): boolean =>
    typeof one.headers['x-api-key'] === 'string' && one.headers['x-api-key'] !== ''
  const result: Measured = {
    arm,
    cli: rig === undefined ? null : announcedVersion(rig.recorded.frames),
    reachedThisPort: loopback.requests.some((one) => one.localPort === loopback.port),
    cliUsedTheCredential: loopback.requests.some((one) =>
      credential === 'login'
        ? one.headers.authorization === `Bearer ${FAKE_TOKEN}`
        : one.headers['x-api-key'] === FAKE_KEY,
    ),
    onlyThatCredential: loopback.requests.every((one) =>
      credential === 'login' ? !apiKeyHeader(one) : !bearer(one),
    ),
    launchEnv: launchEnvs[arm] ?? null,
    ranInBackground: loopback.requests.some((one) =>
      messagesOf(one).some(
        (message) =>
          Array.isArray(message.content) &&
          (message.content as { type?: string; tool_use_id?: string; content?: unknown }[]).some(
            (block) =>
              block.type === 'tool_result' &&
              block.tool_use_id === `toolu_token_reach_${arm.replaceAll('-', '_')}_bg` &&
              /Command running in background with ID/.test(JSON.stringify(block.content ?? '')),
          ),
      ),
    ),
    reports: rig === undefined ? [] : readReports(arm),
    failure,
    stderr: rig?.recorded.stderr ?? '',
  }
  measured[arm] = result
  const evidence = runEvidence('token-reach')
  mkdirSync(evidence, { recursive: true })
  // Each request's shape, no text and no headers: what the scripted model was answering.
  const shapes = loopback.requests.map((one) => {
    const last = lastMessage(one)
    return {
      tools: offeredTools(one).map((tool) => tool.name),
      messages: ((one.body as { messages?: unknown[] } | null)?.messages ?? []).length,
      lastRole: last?.role,
      lastBlocks: Array.isArray(last?.content)
        ? (last.content as { type?: string; tool_use_id?: string }[]).map(
            (block) => `${String(block.type)}${block.tool_use_id ? `:${block.tool_use_id}` : ''}`,
          )
        : typeof last?.content,
    }
  })
  writeFileSync(
    join(evidence, `${arm}.json`),
    `${JSON.stringify({ ...result, requests: shapes }, null, 1)}\n`,
  )
  console.log(
    `[token-reach · ${arm}]`,
    JSON.stringify(
      {
        cli: result.cli,
        cliUsedTheCredential: result.cliUsedTheCredential,
        onlyThatCredential: result.onlyThatCredential,
        launchEnv: result.launchEnv,
        reports: result.reports,
        failure,
      },
      null,
      1,
    ),
  )
  return result
}

/** The arm being launched, and the loopback port it talks to — read by {@link observe}. */
let currentArm: Arm = 'fresh'
let currentPort: number | null = null

/** The rig's root: `loopbackRuntime` puts the provider home at `<root>/provider-homes/claude-probe`. */
function rootOf(configDir: string): string {
  return join(configDir, '..', '..')
}

function rigOf(arm: Arm): LoopbackRuntime {
  const rig = rigs[RIG[arm]]
  if (rig === undefined) throw new Error('NOT PERFORMED — no rig')
  return rig
}

function recorder(arm: Arm): string {
  return join(rigOf(arm).root, 'recorder.mjs')
}

function out(arm: Arm): string {
  return join(rigOf(arm).root, `${arm}.jsonl`)
}

/**
 * The observers, added to the options the product built: a stdio MCP server, three command hooks,
 * the canary, and — on a login arm — the fake login token. ⚠️ A fresh arm's launch is built before
 * its rig is assigned, so the paths are derived from the config dir the product chose.
 */
function observe(options: Options): void {
  const env = { ...(options.env ?? {}) } as Record<string, string | undefined>
  // ⚑ What the PRODUCT chose, read before anything is added below.
  launchEnvs[currentArm] = {
    descriptor: env['CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR'] !== undefined,
    loginToken: env['CLAUDE_CODE_OAUTH_TOKEN'] !== undefined,
    apiKeyName: env['ANTHROPIC_API_KEY'] !== undefined,
    keyValueInEnv: Object.values(env).some((value) => (value ?? '').includes(FAKE_KEY)),
    managedByHost: env['CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST'] === '1',
  }
  const root = rootOf(env['CLAUDE_CONFIG_DIR'] ?? '')
  const script = join(root, 'recorder.mjs')
  writeFileSync(script, RECORDER)
  const file = join(root, `${currentArm}.jsonl`)
  const credential = CREDENTIAL[currentArm]
  if (credential === 'login') env['CLAUDE_CODE_OAUTH_TOKEN'] = FAKE_TOKEN
  env[CANARY] = FAKE_OF[credential]
  // Each arm has its own loopback; the rig was built with the first one's port.
  if (currentPort !== null) env['ANTHROPIC_BASE_URL'] = `http://127.0.0.1:${currentPort}`
  options.env = env
  const hook = (route: string) => ({
    type: 'command' as const,
    command: recorderCommand(script, route, file, 'hook'),
  })
  options.mcpServers = {
    ...(options.mcpServers ?? {}),
    'presence-recorder': {
      type: 'stdio',
      command: '/bin/sh',
      args: ['-c', recorderCommand(script, 'mcp', file, 'mcp')],
    },
  }
  const settings = typeof options.settings === 'object' ? options.settings : {}
  options.settings = {
    ...settings,
    hooks: {
      SessionStart: [{ hooks: [hook('hook:SessionStart')] }],
      UserPromptSubmit: [{ hooks: [hook('hook:UserPromptSubmit')] }],
      PreToolUse: [{ matcher: 'Bash', hooks: [hook('hook:PreToolUse')] }],
    },
  }
}

function assertArm(result: Measured): void {
  const credential = CREDENTIAL[result.arm]
  expect(result.failure, result.stderr).toBeNull()
  expect(result.reachedThisPort, 'the child never reached this loopback').toBe(true)
  expect(result.ranInBackground, 'the background call did not run in the background').toBe(true)
  expect(result.cli).not.toBeNull()
  // The premise, off the wire: the CLI held this arm's credential, and only that one.
  expect(result.cliUsedTheCredential, 'no request carried the fake credential').toBe(true)
  expect(result.onlyThatCredential, 'a request carried the other credential').toBe(true)
  // What the product put in the CLI's own environment: a key arm, the descriptor and never the key;
  // a Windows-route arm, the key and the switch that has the CLI keep it from what it runs.
  const windows = RIG[result.arm] === 'key-windows'
  expect(result.launchEnv).toEqual({
    descriptor: credential === 'key' && !windows,
    loginToken: credential === 'login',
    apiKeyName: windows,
    keyValueInEnv: windows,
    managedByHost: windows,
  })
  // Every route reported, or this arm measured nothing about it.
  const routes = new Set(result.reports.map((one) => one.route))
  for (const route of ROUTES) expect(routes, `${route} never reported`).toContain(route)
  for (const report of result.reports) {
    // The controls: the route saw the variables added beside the credential, and the value scan
    // found the canary — so the absences below are measurements, not a recorder that sees nothing.
    expect(report.present.CLAUDE_CONFIG_DIR, `${report.route}: control`).toBe(true)
    expect(report.present[CANARY], `${report.route}: canary`).toBe(true)
    expect(report.present.CLAUDE_CODE_OAUTH_TOKEN, `${report.route}: token name`).toBe(false)
    expect(report.present.ANTHROPIC_API_KEY, `${report.route}: API key name`).toBe(false)
    expect(report.present.ANTHROPIC_AUTH_TOKEN, `${report.route}: auth token`).toBe(false)
    expect(report.present.CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR, `${report.route}: fd name`).toBe(
      false,
    )
    // ⚑ The switch is passed on, as it is: no credential, and a nested `claude` reads it.
    expect(report.present.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST, `${report.route}: switch`).toBe(
      windows,
    )
    // Exactly one value holds a fake: the canary's. The credential's is under no other name.
    expect(report.fakeValueAnywhere, `${report.route}: credential under any name`).toBe(1)
    // …and the descriptor the key came through is not inherited: nothing there to read.
    expect(report.fd3, `${report.route}: descriptor 3`).toBe('none')
  }
}

function forgetScratch(rigName: Rig): void {
  const fresh = ARMS.find((arm) => RIG[arm] === rigName && isFresh(arm))
  const resumed = ARMS.find((arm) => RIG[arm] === rigName && !isFresh(arm))
  if (fresh === undefined || resumed === undefined) return
  const rig = rigs[rigName]
  // Only a fully measured pair deletes its scratch.
  if (measured[fresh]?.failure === null && measured[resumed]?.failure === null && rig) {
    rmSync(rig.root, { recursive: true, force: true })
  }
}

it(
  'token-reach · a fresh start on the login: Bash, a stdio MCP server and hooks see no token',
  () => deadline.within('arm fresh', async () => assertArm(await measure('fresh'))),
  deadline.testTimeoutMs,
)
it(
  'token-reach · a resumed conversation on the login: the same routes, a new CLI process',
  () =>
    deadline.within('arm resumed', async () => {
      assertArm(await measure('resumed'))
      forgetScratch('login')
    }),
  deadline.testTimeoutMs,
)
it(
  'token-reach · a fresh start on an API key: the key reaches the CLI and nothing it runs',
  () => deadline.within('arm key-fresh', async () => assertArm(await measure('key-fresh'))),
  deadline.testTimeoutMs,
)
it(
  'token-reach · a resumed conversation on an API key: the same routes, a new CLI process',
  () =>
    deadline.within('arm key-resumed', async () => {
      assertArm(await measure('key-resumed'))
      forgetScratch('key')
    }),
  deadline.testTimeoutMs,
)
it(
  'token-reach · the Windows route, on this Mac: the key in the CLI’s environment reaches nothing it runs',
  () =>
    deadline.within('arm key-windows-fresh', async () =>
      assertArm(await measure('key-windows-fresh')),
    ),
  deadline.testTimeoutMs,
)
it(
  'token-reach · the Windows route, resumed: the same routes, a new CLI process',
  () =>
    deadline.within('arm key-windows-resumed', async () => {
      assertArm(await measure('key-windows-resumed'))
      forgetScratch('key-windows')
    }),
  deadline.testTimeoutMs,
)

/** The fake OpenAI key the Codex arm logs a throwaway home in with. Never a real one. */
const FAKE_CODEX_KEY = 'sk-fake-for-tests-codex'

/** Every file under a home, and how many of them hold the fake key — names only, never contents. */
function filesHolding(home: string, fake: string): { files: number; holding: string[] } {
  const holding: string[] = []
  let files = 0
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) {
        files += 1
        if (readFileSync(path).includes(fake)) holding.push(path.slice(home.length + 1))
      }
    }
  }
  walk(home)
  return { files, holding }
}

/**
 * 🔒 **Codex · a person's key reaches Codex's own `auth.json`, and nothing else** — BroBot's login of
 * a profile home with it (`changeCodexKeyInHome`, Codex's own `account/login/start {type:'apiKey'}`),
 * on the bundled binary, in a throwaway home, with a fake key. No network: a login is local.
 *
 * Measured: the spawn is never handed the key (the factory is asked for a home and a folder only);
 * after the login the key is in `auth.json` (mode `0600`) and in no other file of the home — Codex's
 * own logs and state included; after the logout it is in none.
 */
it(
  'token-reach · Codex: a person’s key reaches its auth.json and nothing else, and leaves with a logout',
  () =>
    deadline.within('arm codex', async () => {
      const scratch = runScratch('token-reach')
      mkdirSync(scratch, { recursive: true })
      const home = mkdtempSync(join(scratch, 'codex-key-'))
      const asked: string[] = []
      const real = bundledCodexTransportFactory()
      const factory: TransportFactory = (options) => {
        asked.push(JSON.stringify(options))
        return real(options)
      }
      const login = await changeCodexKeyInHome(factory, home, {
        to: 'the-key',
        apiKey: FAKE_CODEX_KEY,
      })
      const afterLogin = filesHolding(home, FAKE_CODEX_KEY)
      const authMode = existsSync(join(home, 'auth.json'))
        ? (statSync(join(home, 'auth.json')).mode & 0o777).toString(8)
        : null
      const logout = await changeCodexKeyInHome(factory, home, { to: 'no-key' })
      const afterLogout = filesHolding(home, FAKE_CODEX_KEY)
      const result = {
        login,
        authMode,
        afterLogin,
        logout,
        afterLogout,
        spawnAskedWithTheKey: asked.some((one) => one.includes(FAKE_CODEX_KEY)),
      }
      const evidence = runEvidence('token-reach')
      mkdirSync(evidence, { recursive: true })
      writeFileSync(join(evidence, 'codex.json'), `${JSON.stringify(result, null, 1)}\n`)
      console.log('[token-reach · codex]', JSON.stringify(result, null, 1))
      expect(login).toEqual({ ok: true, authMethod: 'apikey' })
      expect(result.spawnAskedWithTheKey).toBe(false)
      expect(authMode).toBe('600')
      expect(afterLogin.holding).toEqual(['auth.json'])
      expect(afterLogin.files).toBeGreaterThan(1)
      expect(logout).toEqual({ ok: true, authMethod: null })
      expect(afterLogout.holding).toEqual([])
      rmSync(home, { recursive: true, force: true })
    }),
  deadline.testTimeoutMs,
)
