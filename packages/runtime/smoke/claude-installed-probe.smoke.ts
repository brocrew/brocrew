import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'
import { claudeProgramWhereTheSdkLooks } from '../src/claude/claude-binary'
import type { RuntimeEvent } from '../src/events'
import { buildChildEnv } from '../src/internal/child-env'
import type { ModelChoice, SessionHandle } from '../src/runtime'
import { bounded } from './cancel-interrupt-reader'
import {
  announcedVersion,
  closeBounded,
  containLaunch,
  containmentOf,
  loopbackRuntime,
  offeredTools,
  startLoopback,
  until,
  type LoopbackRuntime,
  type ScriptedReply,
  type SeenRequest,
  type SpawnSeen,
  type ReloadSeen,
} from './loopback-claude'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

/**
 * Runs BroBot's own Claude runtime against an installed Claude Code, with a scripted local model,
 * so a version can be called tested. The app hands every launch the program it found
 * (`pathToClaudeCodeExecutable`, set by `ClaudeRuntime`); CI runs this on macOS and Windows at the
 * oldest and the newest tested version (`apps/desktop/src/main/providers/claude/claude-code-tested.json`,
 * `.github/workflows/claude-code.yml`).
 *
 * ## The program
 *
 * `BROBOT_PROBE_CLAUDE=<absolute path>` names it, and the runtime is handed it as the app hands it
 * the one it found. Unset, the probe runs the copy the Agent SDK carries, and its evidence says so.
 * Its version is read twice: `--version` (with a scratch home and config folder, bounded) and the
 * `claude_code_version` its own `system/init` announces.
 *
 * ## The arms, each in a fresh provider home of its own
 *
 * 1. start: a turn in which the model runs `echo` through Bash, then answers; the turn completes
 *    and the command's answer carries the echo. The two version reads agree.
 * 2. hooks: the product's own `PreToolUse` and `Stop` hooks, wrapped to record what they were
 *    handed: `PreToolUse` fires for the Bash call and `Stop` for the completed turn. Whether `Stop`
 *    carries `effort.level`, on a model that takes an effort, is recorded, not asserted.
 * 3. resume: the conversation is closed, its CLI waited out, and `resume` brings it back in a new
 *    CLI: the session says `resumed`, and the next request to the model carries the first turn.
 * 4. models: the model list answers, non-empty, within its bound.
 * 5. key: a fake API key, handed over the way the app does on this system (a descriptor on macOS
 *    and Linux; `ANTHROPIC_API_KEY` beside `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST=1` on Windows), in
 *    a config folder nothing has run in: the CLI sends it as `x-api-key` and no login, the turn
 *    completes with nothing asked, and a command the model runs sees neither `ANTHROPIC_API_KEY`
 *    nor `CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR` and inherits no descriptor 3, while a canary
 *    carrying the same fake under another name is seen.
 * 6. key, the Windows way: on macOS and Linux, the same with the product told it runs on Windows,
 *    so the environment route is measured on this system too.
 * 7. reload (explicit focused SDK scope only): an owned, inert shared-skills plugin makes the product call the actual imported
 *    SDK's reloadPlugins before sending a turn. Its unchanged promise must resolve to a valid
 *    response naming that owned plugin, and that same CLI must complete the loopback turn.
 *    This qualifies the SDK/CLI acknowledgement, not the controlled main-app timeout fixture.
 *
 * After every launch: the options carry the program (when one was named) and the child the SDK
 * started is that program, read off the product's own spawn.
 *
 * No credential and no network model: the rig's literal `probe-only` login and the fake key, a
 * model on `127.0.0.1`, a scratch config folder and a scratch `HOME`, and on macOS a `security`
 * that answers nothing (`loopback-claude.ts`). No header and no variable's value is written down:
 * the command the model runs prints only whether each name is set, and how many values hold the
 * fake.
 *
 * Claude Code's Bash tool on Windows runs Git Bash, which GitHub's Windows runners carry; the
 * probe's own code starts no shell.
 *
 * ## Results on macOS arm64, SDK 0.3.287
 *
 * The SDK's own copy, 2.1.287: all six arms held. The npm install of 2.1.245: five held; on the key
 * arm a command the model ran saw `CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR` (the name alone, with no
 * descriptor 3 and no key behind it). 2.1.287 keeps that name from what it runs; 2.1.245 does not.
 * On both, `Stop` carried `effort.level` (`high`).
 *
 * Run: `pnpm run probe:claude-installed`, or `BROBOT_PROBE_CLAUDE=<path> pnpm run
 * probe:claude-installed`. Not part of `pnpm run ci`.
 */

/** The program named for this run, or `undefined` — the Agent SDK's own copy. */
const GIVEN = process.env['BROBOT_PROBE_CLAUDE'] || undefined

/** The fake API key the key arms run on, as if a person had entered it. Never a real one. */
const FAKE_KEY = 'sk-ant-fake-for-tests'

/** The positive control: the fake again, under a name the CLI has no reason to keep from a command. */
const CANARY = 'BROBOT_INSTALLED_PROBE_CANARY'

const MODEL = 'claude-haiku-4-5'

/**
 * The hooks arm's model and effort: a model that takes an effort, so whether `Stop` reports the
 * level is a fact about the program and not about a model that has none.
 */
const EFFORT_MODEL = 'sonnet'
const EFFORT = 'high'

/** What the start and hooks arms have the model echo. */
const ECHO = 'brobot-installed-probe-echo'

/** The resume arm's first answer, which the resumed conversation's request must carry. */
const FIRST_ANSWER = 'installed-probe first answer'

/**
 * The presence-only command, for Bash: whether each name is set, how many variables hold the
 * canary's value, and what descriptor 3 is — never a value.
 */
const PRESENCE_COMMAND =
  'k=unset; [ -n "${ANTHROPIC_API_KEY+x}" ] && k=set; ' +
  'd=unset; [ -n "${CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR+x}" ] && d=set; ' +
  'o=unset; [ -n "${CLAUDE_CODE_OAUTH_TOKEN+x}" ] && o=set; ' +
  'm=unset; [ -n "${CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST+x}" ] && m=set; ' +
  `c=unset; [ -n "\${${CANARY}+x}" ] && c=set; ` +
  'h=unset; [ -n "${CLAUDE_CONFIG_DIR+x}" ] && h=set; ' +
  `n=$(env | grep -c -F "$${CANARY}"); ` +
  'f=none; if [ -S /dev/fd/3 ]; then f=socket; elif [ -p /dev/fd/3 ]; then f=fifo; ' +
  'elif [ -e /dev/fd/3 ]; then f=other; fi; ' +
  'echo "presence key=$k descriptor=$d login=$o managed=$m canary=$c home=$h values=$n fd3=$f"'

const PRESENCE_LINE =
  /presence key=(\w+) descriptor=(\w+) login=(\w+) managed=(\w+) canary=(\w+) home=(\w+) values=(\d+) fd3=(\w+)/

type Arm = 'start' | 'hooks' | 'resume' | 'models' | 'key' | 'key-windows-route' | 'reload'

/** The words each arm's prompt carries, so the scripted model knows which conversation is asking. */
const WORDS: Readonly<Record<Arm, string>> = {
  start: 'installed-probe start: run the echo',
  hooks: 'installed-probe hooks: run the echo',
  resume: 'installed-probe resume: the first turn',
  models: 'installed-probe models: no turn is sent',
  key: 'installed-probe key: run the presence check',
  'key-windows-route': 'installed-probe key, the Windows way: run the presence check',
  reload: 'installed-probe reload: acknowledge the turn without running tools',
}

/** The resumed conversation's second prompt. */
const RESUMED_WORDS = 'installed-probe resume: the second turn, after the resume'

/** The one Bash call an arm's model makes, or `null`. */
const CALLS: Readonly<Record<Arm, { readonly id: string; readonly command: string } | null>> = {
  start: { id: 'toolu_installed_start', command: `echo ${ECHO}` },
  hooks: { id: 'toolu_installed_hooks', command: `echo ${ECHO}` },
  resume: null,
  models: null,
  key: { id: 'toolu_installed_key', command: PRESENCE_COMMAND },
  'key-windows-route': {
    id: 'toolu_installed_key_windows',
    command: PRESENCE_COMMAND,
  },
  reload: null,
}

/** Each wait is bounded; one that runs out is NOT PERFORMED, never a pass. */
const VERSION_MS = 30_000
const START_MS = 45_000
const SEND_MS = 30_000
/** The first turn of a cold CLI on a CI runner, its Bash call included. */
const TURN_MS = 90_000
const LIST_MS = 45_000
const TEARDOWN_MS = 15_000
/** How long a closed launch's CLI is given to exit before it is killed by pid. */
const EXIT_MS = 10_000
/** One launch with one turn: open, send, the turn's end, the close and the child's exit. */
const TURN_LAUNCH = [START_MS, SEND_MS, TURN_MS, TEARDOWN_MS, EXIT_MS]
const WAITS = [
  // start, and the version read before it
  VERSION_MS,
  ...TURN_LAUNCH,
  // hooks
  ...TURN_LAUNCH,
  // resume: the first launch, and the resumed one
  ...TURN_LAUNCH,
  ...TURN_LAUNCH,
  // models
  LIST_MS,
  TEARDOWN_MS,
  EXIT_MS,
  // key, and the Windows way (run on macOS and Linux only)
  ...TURN_LAUNCH,
  ...TURN_LAUNCH,
]

const focusedReload = process.env['BROBOT_PROBE_INSTALLED_SCOPE'] === 'reload'
const deadline = probeRunDeadline(
  'installed Claude Code probe',
  runBudgetMs(focusedReload ? [VERSION_MS, ...TURN_LAUNCH, VERSION_MS, ...TURN_LAUNCH] : WAITS),
  TEARDOWN_MS,
)

/** The program under test, by absolute path — or NOT PERFORMED, saying why there is none. */
function programUnderTest(): string {
  if (GIVEN !== undefined) {
    if (!isAbsolute(GIVEN)) {
      throw new Error(`NOT PERFORMED — BROBOT_PROBE_CLAUDE is not an absolute path: ${GIVEN}`)
    }
    if (!existsSync(GIVEN))
      throw new Error(`NOT PERFORMED — nothing at BROBOT_PROBE_CLAUDE: ${GIVEN}`)
    return GIVEN
  }
  const carried = claudeProgramWhereTheSdkLooks()
  if (carried === null) {
    throw new Error(
      'NOT PERFORMED — BROBOT_PROBE_CLAUDE is unset and the Agent SDK carries no Claude Code here',
    )
  }
  return carried
}

interface VersionRead {
  readonly said: string
  readonly version: string | null
  /** `0`, or what ended it: an exit code, a signal or an error. */
  readonly exit: string | number
}

/** `<program> --version`, in a scratch home and config folder of its own, bounded. */
async function versionOf(program: string): Promise<VersionRead> {
  mkdirSync(runScratch('claude-installed'), { recursive: true })
  const scratch = mkdtempSync(join(runScratch('claude-installed'), 'version-'))
  const config = join(scratch, 'config')
  mkdirSync(config, { recursive: true })
  const env = buildChildEnv({
    CLAUDE_CONFIG_DIR: config,
    DISABLE_AUTOUPDATER: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  }) as Record<string, string | undefined>
  containLaunch(env, scratch, undefined)
  return await new Promise<VersionRead>((resolve) => {
    execFile(
      program,
      ['--version'],
      { env, cwd: scratch, timeout: VERSION_MS, windowsHide: true, encoding: 'utf8' },
      (error, stdout, stderr) => {
        const said = `${stdout}${stderr}`.trim().slice(0, 500)
        resolve({
          said,
          version: /\d+\.\d+\.\d+/.exec(said)?.[0] ?? null,
          exit: error === null ? 0 : String(error.code ?? error.signal ?? error.message),
        })
      },
    )
  })
}

interface Message {
  readonly role?: string
  readonly content?: unknown
}

function messagesOf(request: SeenRequest): Message[] {
  return (request.body as { messages?: Message[] } | null)?.messages ?? []
}

/** Whether a person's words in this request carry `words`. */
function promptedWith(request: SeenRequest, words: string): boolean {
  return messagesOf(request).some(
    (one) => one.role === 'user' && JSON.stringify(one.content ?? '').includes(words),
  )
}

/** The text the CLI answered a tool call with, in this request's conversation, or `null`. */
function toolAnswerIn(request: SeenRequest, id: string): string | null {
  for (const message of messagesOf(request)) {
    if (!Array.isArray(message.content)) continue
    for (const block of message.content as {
      type?: string
      tool_use_id?: string
      content?: unknown
    }[]) {
      if (block.type !== 'tool_result' || block.tool_use_id !== id) continue
      if (typeof block.content === 'string') return block.content
      if (Array.isArray(block.content)) {
        return (block.content as { text?: string }[]).map((part) => part.text ?? '').join('')
      }
      return ''
    }
  }
  return null
}

const DONE: ScriptedReply = { kind: 'text', text: 'done' }

/** The scripted model: the arm's one Bash call, then `done`; the resume arm's two plain answers. */
function script(arm: Arm): (request: SeenRequest) => ScriptedReply {
  const call = CALLS[arm]
  return (request) => {
    if (arm === 'resume') {
      if (promptedWith(request, RESUMED_WORDS)) return { kind: 'text', text: 'second answer' }
      if (promptedWith(request, WORDS.resume)) return { kind: 'text', text: FIRST_ANSWER }
      return DONE
    }
    if (call === null || !promptedWith(request, WORDS[arm])) return DONE
    if (toolAnswerIn(request, call.id) !== null) return DONE
    if (!offeredTools(request).some((one) => one.name === 'Bash')) {
      return { kind: 'text', text: 'no Bash tool was offered' }
    }
    return {
      kind: 'tool_use',
      id: call.id,
      name: 'Bash',
      input: { command: call.command, description: 'installed-probe check' },
    }
  }
}

/** What one of the product's hooks was handed, and what it answered. */
interface HookSeen {
  readonly event: string
  readonly tool: string | null
  readonly toolUseId: string | null
  /** `effort.level` on the hook's input, when the CLI put one there. */
  readonly effort: string | null
  readonly answered: unknown
}

/**
 * Wraps the product's own `PreToolUse` and `Stop` hooks to record what they were handed, returning
 * the product's answer unchanged. Every launch alike; a model list carries no hooks.
 */
function observeHooks(options: Options, seen: HookSeen[]): void {
  const hooks = options.hooks
  if (hooks === undefined) return
  for (const event of ['PreToolUse', 'Stop'] as const) {
    const matcher = hooks[event]?.[0]
    const theHook = matcher?.hooks[0]
    if (matcher === undefined || theHook === undefined) {
      throw new Error(`NOT PERFORMED — the product installed no ${event} hook`)
    }
    matcher.hooks[0] = async (input, toolUseId, context) => {
      const answer = await theHook(input, toolUseId, context)
      const effort = (input as { effort?: { level?: unknown } }).effort?.level
      seen.push({
        event: input.hook_event_name,
        tool: input.hook_event_name === 'PreToolUse' ? input.tool_name : null,
        toolUseId: input.hook_event_name === 'PreToolUse' ? input.tool_use_id : null,
        effort: typeof effort === 'string' ? effort : null,
        answered: JSON.parse(JSON.stringify(answer ?? null)) as unknown,
      })
      return answer
    }
  }
}

/** What the product put in a launch's environment, read before this probe adds its canary. */
interface LaunchEnv {
  readonly descriptor: boolean
  readonly apiKeyName: boolean
  /** Whether the fake key's value is anywhere in the environment the CLI is handed. */
  readonly keyValueInEnv: boolean
  readonly managedByHost: boolean
  readonly loginToken: boolean
}

function launchEnvOf(options: Options): LaunchEnv {
  const env = (options.env ?? {}) as Record<string, string | undefined>
  return {
    descriptor: env['CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR'] !== undefined,
    apiKeyName: env['ANTHROPIC_API_KEY'] !== undefined,
    keyValueInEnv: Object.values(env).some((value) => (value ?? '').includes(FAKE_KEY)),
    managedByHost: env['CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST'] === '1',
    loginToken: env['CLAUDE_CODE_OAUTH_TOKEN'] !== undefined,
  }
}

interface Presence {
  readonly key: string
  readonly descriptor: string
  readonly login: string
  readonly managed: string
  readonly canary: string
  readonly home: string
  readonly values: number
  readonly fd3: string
}

function presenceIn(answer: string | null): Presence | null {
  const match = PRESENCE_LINE.exec(answer ?? '')
  if (match === null) return null
  return {
    key: match[1] ?? '',
    descriptor: match[2] ?? '',
    login: match[3] ?? '',
    managed: match[4] ?? '',
    canary: match[5] ?? '',
    home: match[6] ?? '',
    values: Number(match[7]),
    fd3: match[8] ?? '',
  }
}

/** Whether a child is still there, by pid. Signal 0 asks and sends nothing, on Windows too. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Kills, by pid, every child this probe's launches started that has not exited. */
function killLeft(spawns: readonly SpawnSeen[]): void {
  for (const one of spawns) {
    if (one.pid === null || !alive(one.pid)) continue
    try {
      process.kill(one.pid, 'SIGKILL')
    } catch {
      // Already gone.
    }
  }
}

/** Waits up to `ms` for every child to be gone, then kills the rest, and says which. */
async function goneWithin(
  spawns: readonly SpawnSeen[],
  ms: number,
): Promise<{ pid: number; exited: boolean; killed: boolean }[]> {
  const pids = spawns.flatMap((one) => (one.pid === null ? [] : [one.pid]))
  const end = Date.now() + ms
  while (Date.now() < end && pids.some(alive)) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return pids.map((pid) => {
    if (!alive(pid)) return { pid, exited: true, killed: false }
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Gone between the two questions.
    }
    return { pid, exited: false, killed: true }
  })
}

/** Focused SDK role: signal only the exact held ChildProcess, never a later PID lookup. */
function killOwned(rig: LoopbackRuntime): void {
  for (const child of rig.recorded.processes) {
    try {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    } catch {
      /* The outer owned-root census still has to prove drain. */
    }
  }
}

async function ownedGoneWithin(
  rig: LoopbackRuntime | null,
  ms: number,
): Promise<Drive['children']> {
  if (rig === null) return []
  const end = Date.now() + ms
  while (Date.now() < end && rig.recorded.spawns.some((spawn) => spawn.exit === null)) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return rig.recorded.spawns.flatMap((spawn, index) => {
    if (spawn.pid === null) return []
    const child = rig.recorded.processes[index]!
    const exited = spawn.exit !== null
    const killed = !exited && child.exitCode === null && child.signalCode === null
    try {
      if (killed) child.kill('SIGKILL')
    } catch {
      /* Retain the failed drain receipt. */
    }
    return [{ pid: spawn.pid, exited, killed }]
  })
}

/** Whether `work` settled within `ms`. */
async function settledWithin(work: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work.then(
        () => true,
        () => true,
      ),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), ms)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Every `claude_code_version` the launches' own `system/init` frames announced, in order. */
function initVersionsOf(rig: LoopbackRuntime): (string | null)[] {
  const versions: (string | null)[] = []
  for (const frame of rig.recorded.frames) {
    const f = frame as { type?: string; subtype?: string }
    if (f.type === 'system' && f.subtype === 'init') versions.push(announcedVersion([frame]))
  }
  return versions
}

interface Drive {
  readonly arm: Arm
  readonly given: string | null
  readonly program: string | null
  readonly version: VersionRead | null
  readonly initVersions: (string | null)[]
  readonly spawns: SpawnSeen[]
  readonly sessions: string[]
  readonly turns: string[]
  readonly fatal: string[]
  readonly permissionRequests: number
  readonly toolCalls: { name: string; id: string }[]
  /** The CLI's answer to the arm's Bash call, as it sent it back to the model. */
  readonly toolAnswer: string | null
  readonly presence: Presence | null
  readonly hooks: HookSeen[]
  readonly launchEnv: LaunchEnv | null
  readonly models: string[] | null
  readonly firstChildExited: boolean | null
  /** The resumed conversation's request carried the first turn and its answer. */
  readonly resumedCarriesFirst: boolean | null
  readonly configDirBefore: string[] | null
  readonly configDirAfter: string[] | null
  readonly wire: {
    readonly requests: number
    readonly reachedThisPort: boolean
    readonly apiKeySeen: boolean
    readonly everyRequestOnTheKey: boolean
    readonly bearerSeen: boolean
  }
  /** What the contained `security` was asked, on macOS — the arguments only. */
  readonly security: string[]
  readonly children: { pid: number; exited: boolean; killed: boolean }[]
  readonly failure: string | null
  readonly stderr: string
  readonly loopbackClosed: boolean
  readonly reloadCalls: ReloadSeen[]
  readonly reload: {
    readonly calls: ReloadSeen[]
    readonly beforeModelRequest: boolean
    readonly sharedRootOwned: boolean
    readonly loopbackClosed: boolean
    readonly configuredPortMatches: boolean
    readonly identity: ReturnType<typeof reloadIdentity> | null
  } | null
}

/** Public SDK metadata and byte identities only; no CLI parsing, profile or credential reads. */
function reloadIdentity(program: string) {
  const entry = fileURLToPath(import.meta.resolve('@anthropic-ai/claude-agent-sdk'))
  const metadata = JSON.parse(readFileSync(join(dirname(entry), 'package.json'), 'utf8')) as {
    name?: string
    version?: string
  }
  const root = fileURLToPath(new URL('../../../', import.meta.url))
  const digest = (path: string): string =>
    createHash('sha256').update(readFileSync(path)).digest('hex')
  const sources = Object.fromEntries(
    [
      'packages/runtime/smoke/claude-installed-probe.smoke.ts',
      'packages/runtime/smoke/loopback-claude.ts',
      'packages/runtime/src/claude/claude-runtime.ts',
      'packages/runtime/src/built-in-skills.ts',
      'packages/runtime/package.json',
      'pnpm-lock.yaml',
      'vitest.smoke.config.ts',
      '.github/workflows/macos.yml',
      '.github/workflows/windows.yml',
      'apps/desktop/src/main/providers/claude/claude-code-tested.json',
    ].map((path) => [path, digest(join(root, path))]),
  )
  return {
    sdk: {
      name: metadata.name,
      version: metadata.version,
      entry,
      sha256: digest(entry),
    },
    program: { path: program, sha256: digest(program) },
    expectedCliVersion: process.env['BROBOT_PROBE_EXPECTED_CLAUDE'] ?? null,
    // An operator must compare this runner claim and these bytes to the external final-SHA contract.
    sourceClaim: process.env['GITHUB_SHA'] ?? null,
    sources,
  }
}

async function measure(arm: Arm): Promise<Drive> {
  deadline.refuse(`arm ${arm}`)
  let modelRequestBeforeReloadAck = false
  const loopback = await startLoopback((request) => {
    if (arm === 'reload' && rig?.recorded.reloads.at(-1)?.state !== 'fulfilled') {
      modelRequestBeforeReloadAck = true
    }
    return script(arm)(request)
  })
  const handles: SessionHandle[] = []
  let rig: LoopbackRuntime | null = null
  let over = false
  const release = deadline.own(async () => {
    over = true
    for (const one of handles) await closeBounded(one, TEARDOWN_MS)
    await loopback.close()
    if (rig !== null) {
      if (focusedReload) killOwned(rig)
      else killLeft(rig.recorded.spawns)
    }
  })
  const events: RuntimeEvent[] = []
  const hooks: HookSeen[] = []
  let program: string | null = null
  let launchEnv: LaunchEnv | null = null
  let version: VersionRead | null = null
  let models: ModelChoice[] | null = null
  let firstChildExited: boolean | null = null
  let configDirBefore: string[] | null = null
  let configDirAfter: string[] | null = null
  let children: { pid: number; exited: boolean; killed: boolean }[]
  let failure: string | null = null
  let identity: ReturnType<typeof reloadIdentity> | null = null
  let sharedRoot: string | null = null
  let builtInRoot: string | null = null
  const onAKey = arm === 'key' || arm === 'key-windows-route' || arm === 'reload'

  /** A launch that answers after its bound is still closed, so no CLI is left running. */
  const open = async (what: string, opening: Promise<SessionHandle>): Promise<SessionHandle> => {
    void opening.then(
      (late) => {
        if (!handles.includes(late)) handles.push(late)
        if (over) void closeBounded(late, TEARDOWN_MS)
      },
      () => undefined,
    )
    const handle = await bounded(what, opening, START_MS)
    if (!handles.includes(handle)) handles.push(handle)
    void (async () => {
      try {
        for await (const event of handle.events()) events.push(event)
      } catch {
        // A stream that ends badly says so through its own events.
      }
    })()
    return handle
  }
  const turn = async (handle: SessionHandle, words: string): Promise<void> => {
    const from = events.length
    await bounded('the turn’s send', handle.send(words), SEND_MS)
    await until(
      () =>
        events
          .slice(from)
          .some((one) => one.type === 'turn' || (one.type === 'error' && one.fatal)),
      TURN_MS,
      'the turn’s end',
    )
  }

  try {
    program = programUnderTest()
    if (arm === 'reload') {
      if (GIVEN === undefined) {
        throw new Error('NOT PERFORMED — reload arm requires the explicitly named installed CLI')
      }
      identity = reloadIdentity(program)
      if (
        identity.sdk.name !== '@anthropic-ai/claude-agent-sdk' ||
        identity.sdk.version !== '0.3.287'
      ) {
        throw new Error('NOT PERFORMED — reload arm requires the source-pinned real SDK 0.3.287')
      }
      if (!/^\d+\.\d+\.\d+$/.test(identity.expectedCliVersion ?? '')) {
        throw new Error('NOT PERFORMED — reload arm needs exact BROBOT_PROBE_EXPECTED_CLAUDE')
      }
    }
    if (arm === 'start' || arm === 'reload') version = await versionOf(program)
    if (
      arm === 'reload' &&
      (version?.exit !== 0 || version.version !== identity?.expectedCliVersion)
    ) {
      throw new Error(
        'NOT PERFORMED — the installed program does not match the exact expected CLI version',
      )
    }
    rig = await loopbackRuntime({
      scratch: runScratch('claude-installed'),
      label: arm,
      port: loopback.port,
      maxRetries: 0,
      contain: true,
      ...(arm === 'reload' || arm === 'start'
        ? {
            // Paths are assigned below, before runtime.start invokes the query factory.
            observeReload: {
              name: 'brobot-installed-reload',
              get path() {
                return sharedRoot ?? ''
              },
            },
          }
        : {}),
      ...(onAKey ? { apiKey: FAKE_KEY } : {}),
      ...(arm === 'key-windows-route' ? { platform: 'win32' as const } : {}),
      rewrite: (options) => {
        launchEnv ??= launchEnvOf(options)
        observeHooks(options, hooks)
        if (onAKey) options.env = { ...options.env, [CANARY]: FAKE_KEY }
      },
    })
    const live = rig
    if (arm === 'reload') {
      sharedRoot = join(live.root, 'shared-skills')
      builtInRoot = join(live.root, 'built-in-skills')
      for (const [path, name] of [
        [sharedRoot, 'brobot-installed-reload'],
        [builtInRoot, 'brobot'],
      ] as const) {
        mkdirSync(join(path, '.claude-plugin'), { recursive: true })
        writeFileSync(
          join(path, '.claude-plugin', 'plugin.json'),
          JSON.stringify({ name, version: '1.0.0' }),
        )
      }
    }
    configDirBefore = readdirSync(live.providerHome).sort()
    const context = {
      providerHome: live.providerHome,
      approvalMode: 'auto' as const,
      ...(arm === 'reload'
        ? {
            sharedSkillsRoot: sharedRoot!,
            builtInSkills: { root: builtInRoot!, skills: [] },
          }
        : {}),
      ...(arm === 'hooks' ? { model: EFFORT_MODEL, reasoningEffort: EFFORT } : { model: MODEL }),
    }
    if (arm === 'models') {
      models = await bounded('the model list', live.runtime.listModels(context), LIST_MS)
    } else {
      const first = await open('the start', live.runtime.start({ cwd: live.cwd, ...context }))
      deadline.refuse(`arm ${arm} · the session is open`)
      await turn(first, WORDS[arm])
      if (arm === 'resume') {
        const ref = first.ref
        if (ref === null) throw new Error('NOT PERFORMED — the first launch left no conversation')
        const exited = first.awaitProcessExit?.()
        await closeBounded(first, TEARDOWN_MS)
        const at = handles.indexOf(first)
        if (at >= 0) handles.splice(at, 1)
        firstChildExited = exited === undefined ? false : await settledWithin(exited, EXIT_MS)
        if (!firstChildExited) {
          throw new Error('NOT PERFORMED — the first launch’s CLI did not exit before the resume')
        }
        deadline.refuse('arm resume · the resume')
        const second = await open('the resume', live.runtime.resume(ref, context))
        deadline.refuse('arm resume · the resumed session is open')
        await turn(second, RESUMED_WORDS)
      }
    }
    configDirAfter = readdirSync(live.providerHome).sort()
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  } finally {
    over = true
    for (const one of handles) await closeBounded(one, TEARDOWN_MS)
    await loopback.close()
    children = focusedReload
      ? await ownedGoneWithin(rig, EXIT_MS)
      : await goneWithin(rig?.recorded.spawns ?? [], EXIT_MS)
    release()
  }

  const call = CALLS[arm]
  const answers = loopback.requests.flatMap((one) => {
    const answer = call === null ? null : toolAnswerIn(one, call.id)
    return answer === null ? [] : [answer]
  })
  const toolAnswer = answers[0] ?? null
  // Headers are compared here and never written anywhere: the evidence holds booleans only.
  const bearer = (one: SeenRequest): boolean =>
    typeof one.headers.authorization === 'string' && one.headers.authorization !== ''
  const securityLog = rig === null ? null : containmentOf(rig.root).securityLog
  const drive: Drive = {
    arm,
    given: GIVEN ?? null,
    program,
    version,
    initVersions: rig === null ? [] : initVersionsOf(rig),
    spawns: rig?.recorded.spawns ?? [],
    sessions: events.flatMap((one) => (one.type === 'session' ? [one.state] : [])),
    turns: events.flatMap((one) => (one.type === 'turn' ? [one.state] : [])),
    fatal: events.flatMap((one) => (one.type === 'error' && one.fatal ? [one.message] : [])),
    permissionRequests: events.filter((one) => one.type === 'permission_request').length,
    toolCalls: events.flatMap((one) =>
      one.type === 'tool_call' ? [{ name: one.name, id: one.id }] : [],
    ),
    toolAnswer: toolAnswer === null ? null : toolAnswer.slice(0, 2_000),
    presence: onAKey ? presenceIn(toolAnswer) : null,
    hooks,
    launchEnv,
    models: models === null ? null : models.map((one) => one.id),
    firstChildExited,
    resumedCarriesFirst:
      arm !== 'resume'
        ? null
        : loopback.requests.some((one) => {
            const users = messagesOf(one).filter((message) => message.role === 'user')
            const said = (message: Message, words: string): boolean =>
              JSON.stringify(message.content ?? '').includes(words)
            const first = users.findIndex((message) => said(message, WORDS.resume))
            const second = users.findIndex((message) => said(message, RESUMED_WORDS))
            const answered = messagesOf(one).some(
              (message) => message.role === 'assistant' && said(message, FIRST_ANSWER),
            )
            return first >= 0 && second >= first && answered
          }),
    configDirBefore,
    configDirAfter,
    wire: {
      requests: loopback.requests.length,
      reachedThisPort: loopback.requests.some((one) => one.localPort === loopback.port),
      apiKeySeen: loopback.requests.some((one) => one.headers['x-api-key'] === FAKE_KEY),
      everyRequestOnTheKey:
        loopback.requests.length > 0 &&
        loopback.requests.every((one) => one.headers['x-api-key'] === FAKE_KEY),
      bearerSeen: loopback.requests.some(bearer),
    },
    security:
      securityLog !== null && existsSync(securityLog)
        ? readFileSync(securityLog, 'utf8')
            .split('\n')
            .filter((line) => line !== '')
        : [],
    children,
    failure,
    stderr: rig?.recorded.stderr ?? '',
    loopbackClosed: loopback.closed,
    reloadCalls: rig?.recorded.reloads ?? [],
    reload:
      arm !== 'reload'
        ? null
        : {
            calls: rig?.recorded.reloads ?? [],
            beforeModelRequest: !modelRequestBeforeReloadAck,
            sharedRootOwned:
              sharedRoot !== null && rig !== null && sharedRoot === join(rig.root, 'shared-skills'),
            loopbackClosed: loopback.closed,
            configuredPortMatches: rig?.recorded.configuredPort === loopback.port,
            identity,
          },
  }
  const evidence = runEvidence('claude-installed')
  mkdirSync(evidence, { recursive: true })
  writeFileSync(join(evidence, `${arm}.json`), `${JSON.stringify(drive, null, 1)}\n`)
  console.log(
    `[claude-installed · ${arm}]`,
    JSON.stringify({
      program: drive.program,
      given: drive.given,
      version: drive.version?.version,
      init: drive.initVersions,
      turns: drive.turns,
      sessions: drive.sessions,
      presence: drive.presence,
      models: drive.models?.length,
      failure: drive.failure,
    }),
  )
  return drive
}

/** What every launch of every arm must show: it ran the program under test, and it ended. */
function launchesHold(drive: Drive, launches: number): void {
  expect(drive.failure, `${drive.failure ?? ''}\n${drive.stderr}`).toBeNull()
  expect(drive.spawns, 'one child per launch').toHaveLength(launches)
  for (const spawn of drive.spawns) {
    // The product named the program on the launch, and only when one was named for this run…
    expect(spawn.asked, 'the program the launch’s options named').toBe(GIVEN ?? null)
    // …and the child the SDK started is that program, read off the product's own spawn.
    expect(spawn.command, 'the program the child ran').toBe(drive.program)
  }
  for (const child of drive.children) {
    expect(child.killed, `pid ${String(child.pid)} had to be killed`).toBe(false)
  }
}

/** A launch with turns: it reached this loopback, each turn completed, and nothing was asked. */
function turnsHold(drive: Drive, turns: number): void {
  expect(drive.wire.reachedThisPort, 'the CLI never reached this loopback').toBe(true)
  expect(drive.fatal, 'a fatal error').toEqual([])
  expect(drive.turns).toEqual(Array.from({ length: turns }, () => 'completed'))
  expect(drive.permissionRequests, 'something was asked').toBe(0)
}

/** The key arms: the key went to the CLI by the route the product chose, and to nothing it ran. */
function keyHolds(drive: Drive, environmentRoute: boolean): void {
  launchesHold(drive, 1)
  turnsHold(drive, 1)
  // A config folder nothing had run in, so this is a first run on the key.
  expect(drive.configDirBefore, 'the config folder was not fresh').toEqual([])
  // Off the wire: the CLI sent the fake as its key, on every request, and no login.
  expect(drive.wire.apiKeySeen, 'no request carried the key').toBe(true)
  expect(drive.wire.everyRequestOnTheKey, 'a request went without the key').toBe(true)
  expect(drive.wire.bearerSeen, 'a request carried a login').toBe(false)
  // What the product put in the CLI's environment, before this probe's canary.
  expect(drive.launchEnv).toEqual({
    descriptor: !environmentRoute,
    apiKeyName: environmentRoute,
    keyValueInEnv: environmentRoute,
    managedByHost: environmentRoute,
    loginToken: false,
  })
  // What a command the model ran saw — names only, and the canary as the control.
  expect(
    drive.presence,
    `the presence check's answer: ${drive.toolAnswer ?? 'none'}`,
  ).not.toBeNull()
  const presence = drive.presence!
  expect(presence.canary, 'the canary (control)').toBe('set')
  expect(presence.home, 'CLAUDE_CONFIG_DIR (control)').toBe('set')
  expect(presence.key, 'ANTHROPIC_API_KEY').toBe('unset')
  expect(presence.descriptor, 'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR').toBe('unset')
  expect(presence.login, 'CLAUDE_CODE_OAUTH_TOKEN').toBe('unset')
  expect(presence.values, 'variables holding the fake: the canary alone').toBe(1)
  if (process.platform !== 'win32') expect(presence.fd3, 'descriptor 3').toBe('none')
}

it(
  'installed Claude Code · start: a turn with a Bash call runs on the program, and both version reads agree',
  () =>
    deadline.within('arm start', async () => {
      const drive = await measure('start')
      launchesHold(drive, 1)
      turnsHold(drive, 1)
      expect(drive.sessions[0]).toBe('started')
      expect(drive.toolCalls.map((one) => one.name)).toContain('Bash')
      expect(drive.toolAnswer ?? '', 'the Bash call’s answer').toContain(ECHO)
      expect(drive.version?.exit, `--version said: ${drive.version?.said ?? ''}`).toBe(0)
      expect(drive.version?.version).not.toBeNull()
      // Negative control: this unchanged arm supplies no sharedSkillsRoot and calls no reload.
      expect(drive.reloadCalls).toEqual([])
      // Every `system/init` the launch announced names the version `--version` read.
      expect(drive.initVersions.length, 'no system/init').toBeGreaterThan(0)
      expect([...new Set(drive.initVersions)], 'system/init’s claude_code_version').toEqual([
        drive.version?.version,
      ])
      const evidence = runEvidence('claude-installed')
      writeFileSync(
        join(evidence, 'program.json'),
        `${JSON.stringify(
          {
            program: drive.program,
            from:
              GIVEN === undefined
                ? 'the Agent SDK’s own copy (BROBOT_PROBE_CLAUDE unset)'
                : 'BROBOT_PROBE_CLAUDE',
            versionSaid: drive.version?.said ?? null,
            version: drive.version?.version ?? null,
            initVersion: drive.initVersions[0] ?? null,
            platform: `${process.platform}-${process.arch}`,
          },
          null,
          1,
        )}\n`,
      )
    }),
  deadline.testTimeoutMs,
)

it(
  'installed Claude Code · hooks: the product’s PreToolUse fires for Bash and its Stop for the turn',
  () =>
    deadline.within('arm hooks', async () => {
      const drive = await measure('hooks')
      launchesHold(drive, 1)
      turnsHold(drive, 1)
      const pre = drive.hooks.findIndex(
        (one) =>
          one.event === 'PreToolUse' && one.tool === 'Bash' && one.toolUseId === CALLS.hooks?.id,
      )
      const stop = drive.hooks.findIndex((one) => one.event === 'Stop')
      expect(pre, 'PreToolUse for the Bash call').toBeGreaterThanOrEqual(0)
      expect(stop, 'Stop for the turn').toBeGreaterThan(pre)
      // Evidence only: whether this version says the effort a turn ran at.
      console.log(
        '[claude-installed · hooks] Stop carries effort.level:',
        drive.hooks[stop]?.effort ?? 'no',
      )
    }),
  deadline.testTimeoutMs,
)

it(
  'installed Claude Code · resume: a closed conversation comes back in a new CLI, with its first turn',
  () =>
    deadline.within('arm resume', async () => {
      const drive = await measure('resume')
      launchesHold(drive, 2)
      turnsHold(drive, 2)
      expect(drive.firstChildExited, 'the first CLI exited before the resume').toBe(true)
      expect(drive.sessions.filter((state) => state !== 'ended')).toEqual(['started', 'resumed'])
      expect(drive.resumedCarriesFirst, 'the resumed request carries the first turn').toBe(true)
    }),
  deadline.testTimeoutMs,
)

it(
  'installed Claude Code · models: the model list answers within its bound',
  () =>
    deadline.within('arm models', async () => {
      const drive = await measure('models')
      launchesHold(drive, 1)
      expect(drive.models?.length ?? 0, 'no model offered').toBeGreaterThan(0)
    }),
  deadline.testTimeoutMs,
)

it(
  'installed Claude Code · an API key, this system’s way: sent as x-api-key, nothing asked, kept from what the model runs',
  () =>
    deadline.within('arm key', async () =>
      keyHolds(await measure('key'), process.platform === 'win32'),
    ),
  deadline.testTimeoutMs,
)

// On Windows the arm above already is this route.
if (process.platform !== 'win32') {
  it(
    'installed Claude Code · an API key, the Windows way, on this system: the same',
    () =>
      deadline.within('arm key-windows-route', async () =>
        keyHolds(await measure('key-windows-route'), true),
      ),
    deadline.testTimeoutMs,
  )
}

if (focusedReload)
  it(
    'installed Claude Code · reload: the real SDK acknowledges the owned shared-skills plugin before the turn',
    () =>
      deadline.within('arm reload', async () => {
        const drive = await measure('reload')
        launchesHold(drive, 1)
        turnsHold(drive, 1)
        const reload = drive.reload!
        expect(reload.sharedRootOwned).toBe(true)
        expect(reload.loopbackClosed).toBe(true)
        expect(reload.configuredPortMatches).toBe(true)
        expect(reload.calls).toHaveLength(1)
        const call = reload.calls[0]!
        expect(call.state).toBe('fulfilled')
        expect(call.settledAt).not.toBeNull()
        expect(call.settledAt! - call.calledAt).toBeLessThan(10_000)
        expect(call.answer).toEqual({
          arrays: true,
          errorCount: 0,
          ownedPlugin: true,
        })
        expect(reload.beforeModelRequest).toBe(true)
        expect(drive.wire.everyRequestOnTheKey).toBe(true)
        expect(drive.wire.bearerSeen).toBe(false)
        expect(drive.launchEnv?.loginToken).toBe(false)
        expect(drive.toolCalls).toEqual([])
        expect(drive.initVersions).not.toHaveLength(0)
        expect([...new Set(drive.initVersions)]).toEqual([reload.identity!.expectedCliVersion])
        expect(drive.version?.version).toBe(reload.identity!.expectedCliVersion)
        expect(reload.identity!.sdk.version).toBe('0.3.287')
        expect(reload.identity!.program.path).toBe(drive.program)
        expect(drive.spawns[0]!.pid).not.toBeNull()
        expect(drive.spawns[0]!.exit).not.toBeNull()
        expect(drive.children).toEqual([{ pid: drive.spawns[0]!.pid, exited: true, killed: false }])
      }),
    deadline.testTimeoutMs,
  )
