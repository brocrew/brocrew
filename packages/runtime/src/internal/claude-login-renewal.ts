import { spawn } from 'node:child_process'
import type { AuthState } from '../auth-state'
import { createHash } from 'node:crypto'
import { mkdirSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * Renewing the person's own Claude Code login by running their own Claude Code.
 *
 * Claude Code renews an expired access token itself before it calls the model, and writes the
 * renewed login back to its own store (the Keychain on a Mac, its credentials file on Windows), where
 * the next read finds it. It has no command that only renews, and `--bare` turns its login off, so
 * the run is the smallest model call it can make: one line to Haiku, with no tools, no settings files
 * (so no hooks or plugins), no MCP servers and nothing written to its history. BroBot never handles
 * the refresh token itself.
 */

/**
 * How a renewal ended. `renewed`: the login reads as current after the run. `not-needed`: it did not
 * need renewing. `not-installed`: no Claude Code was found to run.
 */
export type ClaudeLoginRenewal = 'renewed' | 'not-needed' | 'not-installed' | 'not-renewed'

/** The arguments of the run: the smallest model call Claude Code makes with the person's login. */
export const CLAUDE_RENEWAL_ARGS: readonly string[] = [
  '-p',
  'ok',
  '--model',
  'haiku',
  '--system-prompt',
  'Reply with: ok',
  '--tools',
  '',
  '--max-turns',
  '1',
  '--strict-mcp-config',
  '--setting-sources',
  '',
  '--no-session-persistence',
]

/** How long the run may take before it is asked to stop. */
export const CLAUDE_RENEWAL_TIME_LIMIT_MS = 60_000

/** How long a run asked to stop gets before it is killed, and the folder it ran in is let go. */
const STOP_GRACE_MS = 5_000

/** Credentials of this app's own that must not reach the person's Claude Code, which uses its own. */
const NOT_HANDED_ON = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
  'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR',
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
]

/**
 * On a Mac these name a Keychain item of their own (`Claude Code-credentials-<hash>`), and BroBot
 * reads the person's usual one: the run renews that one.
 */
const NOT_HANDED_ON_A_MAC = ['CLAUDE_CONFIG_DIR', 'CLAUDE_SECURESTORAGE_CONFIG_DIR']

/**
 * How a run ended: its exit code (`null` when it could not start or was stopped). ⛔ Never what it
 * printed: the person's own Claude Code may print anything about their account.
 */
export interface ARunEnded {
  readonly code: number | null
  readonly timedOut: boolean
}

/** Runs a program to its end, or stops it at the time limit. */
export type RunAProgram = (
  program: string,
  args: readonly string[],
  options: {
    readonly cwd: string
    readonly env: NodeJS.ProcessEnv
    readonly timeoutMs: number
    readonly stopGraceMs?: number
    readonly signal?: AbortSignal
  },
) => Promise<ARunEnded>

export interface ClaudeRenewalSeams {
  /** The person's own Claude Code, or `null` when it is not installed. Never a bundled copy. */
  readonly findProgram: () => string | null
  readonly platform?: NodeJS.Platform
  readonly env?: NodeJS.ProcessEnv
  readonly run?: RunAProgram
  readonly timeLimitMs?: number
  readonly stopGraceMs?: number
  /** Stops a run under way, when the app quits. */
  readonly signal?: AbortSignal
}

/** A login read's access token and its end, when it holds one. */
function tokenOf(
  raw: string | null,
): { readonly token: string; readonly expiresAt: number | null } | null {
  if (raw === null || raw === '') return null
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  const oauth =
    typeof json === 'object' && json !== null
      ? (json as Record<string, unknown>)['claudeAiOauth']
      : undefined
  if (typeof oauth !== 'object' || oauth === null) return null
  const { accessToken, expiresAt } = oauth as Record<string, unknown>
  if (typeof accessToken !== 'string' || accessToken === '') return null
  return { token: accessToken, expiresAt: typeof expiresAt === 'number' ? expiresAt : null }
}

/**
 * Whether a login read needs renewing: it has an access token that has ended. Not before: a renewal
 * ends the token running conversations hold. A login that is not there, or not readable, does not.
 */
export function claudeLoginNeedsRenewal(raw: string | null, now: number): boolean {
  const held = tokenOf(raw)
  return held !== null && held.expiresAt !== null && held.expiresAt <= now
}

/** Whether a read after a run holds a current login other than the one before it. */
function renewedSince(before: string | null, after: string | null, now: number): boolean {
  const was = tokenOf(before)
  const is = tokenOf(after)
  return is !== null && (is.expiresAt === null || is.expiresAt > now) && is.token !== was?.token
}

function pathKeyOf(env: NodeJS.ProcessEnv): string {
  return Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH'
}

function pathOf(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  return (env[pathKeyOf(env)] ?? '')
    .split(platform === 'win32' ? ';' : ':')
    .filter((dir) => dir !== '')
}

/**
 * The run's environment: the person's own, without this app's credentials, with no self-update and
 * few retries, and with the program's own folder first on the PATH, so a Claude Code installed with
 * npm finds its Node from an app opened in Finder.
 */
export function claudeRenewalEnv(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  program?: string,
): NodeJS.ProcessEnv {
  const dropped = platform === 'darwin' ? [...NOT_HANDED_ON, ...NOT_HANDED_ON_A_MAC] : NOT_HANDED_ON
  const handed: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (!dropped.includes(key.toUpperCase())) handed[key] = value
  }
  handed['DISABLE_AUTOUPDATER'] = '1'
  handed['ENABLE_CLAUDEAI_MCP_SERVERS'] = 'false'
  handed['CLAUDE_CODE_MAX_RETRIES'] = '2'
  if (program !== undefined) {
    const folders = [dirname(program)]
    try {
      folders.push(dirname(realpathSync(program)))
    } catch {
      // A program that cannot be resolved runs from where it was found.
    }
    const key = pathKeyOf(handed)
    const path = [...new Set([...folders, ...pathOf(handed, platform)])]
    handed[key] = path.join(platform === 'win32' ? ';' : ':')
  }
  return handed
}

const runAProgram: RunAProgram = (
  program,
  args,
  { cwd, env, timeoutMs, signal, stopGraceMs = STOP_GRACE_MS },
) =>
  new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ code: null, timedOut: false })
      return
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(program, [...args], { cwd, env, stdio: 'ignore', windowsHide: true })
    } catch {
      resolve({ code: null, timedOut: false })
      return
    }
    let timedOut = false
    let stopped = false
    const timers: NodeJS.Timeout[] = []
    let settled = false
    const settle = (code: number | null): void => {
      if (settled) return
      settled = true
      for (const timer of timers) clearTimeout(timer)
      signal?.removeEventListener('abort', stop)
      resolve({ code: stopped ? null : code, timedOut })
    }
    const stop = (): void => {
      if (stopped || settled) return
      stopped = true
      child.kill('SIGTERM')
      timers.push(
        setTimeout(() => {
          if (!settled) child.kill('SIGKILL')
        }, stopGraceMs),
      )
    }
    timers.push(
      setTimeout(() => {
        timedOut = true
        stop()
      }, timeoutMs),
    )
    signal?.addEventListener('abort', stop, { once: true })
    child.once('error', () => {
      if (child.pid === undefined) settle(null)
    })
    child.once('close', (code) => settle(code))
    if (signal?.aborted) stop()
  })

/** Explicit manual model check; no credential read, output capture, tools or saved session. */
export async function probeClaudeCodeLogin(seams: ClaudeRenewalSeams): Promise<AuthState> {
  const unknown = (reason: string): AuthState => ({ state: 'unknown', reason })
  if (seams.signal?.aborted) return unknown('The Claude sign-in check was cancelled.')
  try {
    const program = seams.findProgram()
    if (program === null) return unknown('Claude Code was not found. Install it or sign in again.')
    const ended = await (seams.run ?? runAProgram)(
      program,
      [
        ...CLAUDE_RENEWAL_ARGS,
        '--mcp-config',
        '{"mcpServers":{}}',
        '--disallowedTools',
        'mcp__*',
        '--settings',
        '{"disableAllHooks":true}',
      ],
      {
        cwd: renewalFolder(),
        env: {
          ...claudeRenewalEnv(seams.env, seams.platform, program),
          CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
        },
        timeoutMs: seams.timeLimitMs ?? 8_000,
        stopGraceMs: seams.stopGraceMs ?? 1_000,
        ...(seams.signal === undefined ? {} : { signal: seams.signal }),
      },
    )
    if (seams.signal?.aborted) return unknown('The Claude sign-in check was cancelled.')
    if (ended.timedOut)
      return unknown(
        'Claude Code did not answer the sign-in check in time. Check again or sign in again.',
      )
    return ended.code === 0
      ? { state: 'usable', login: 'account', expiresAt: null }
      : unknown('Claude Code could not complete the sign-in check. Check again or sign in again.')
  } catch {
    return unknown('Claude Code could not run the sign-in check. Check again or sign in again.')
  }
}

/** The folder the run works in: one, so Claude Code keeps no new entry per run. */
function renewalFolder(): string {
  const folder = join(tmpdir(), 'brobot-claude-renewal')
  mkdirSync(folder, { recursive: true })
  return folder
}

/**
 * Runs the person's own Claude Code once, from a folder of its own, so it renews its login. `ran`
 * only says it ran; {@link claudeLoginRenewer} reads the login again to know whether it renewed.
 */
export async function renewClaudeCodeLogin(
  seams: ClaudeRenewalSeams,
): Promise<'ran' | 'not-installed'> {
  const platform = seams.platform ?? process.platform
  const program = seams.findProgram()
  if (program === null) return 'not-installed'
  const started = Date.now()
  const ended = await (seams.run ?? runAProgram)(program, CLAUDE_RENEWAL_ARGS, {
    cwd: renewalFolder(),
    env: claudeRenewalEnv(seams.env, platform, program),
    timeoutMs: seams.timeLimitMs ?? CLAUDE_RENEWAL_TIME_LIMIT_MS,
    ...(seams.signal === undefined ? {} : { signal: seams.signal }),
  })
  if (ended.code !== 0) {
    console.warn(
      `Claude Code at ${program} ${
        ended.timedOut ? 'was stopped at the time limit' : `exited ${String(ended.code)}`
      } (${String(Date.now() - started)} ms)`,
    )
  }
  return 'ran'
}

/** A one-way name for a login's access token, to know a login again without keeping it. */
function fingerprintOf(raw: string | null): string {
  return createHash('sha256')
    .update(tokenOf(raw)?.token ?? '', 'utf8')
    .digest('hex')
}

/**
 * One renewal at a time for the whole app: starts that find the login expired together wait for the
 * same run. It renewed only when the login reads afterwards as a current one other than before.
 * An expired login a run could not renew is not run for again; the next try is for the next login,
 * one the person renews or signs in to by hand.
 */
export function claudeLoginRenewer(
  seams: ClaudeRenewalSeams & {
    /** Reads the person's login now, as its store holds it. */
    readonly readLogin: () => Promise<string | null>
  },
): () => Promise<ClaudeLoginRenewal> {
  let running: Promise<ClaudeLoginRenewal> | null = null
  let notRenewed: string | null = null
  const renewal = async (): Promise<ClaudeLoginRenewal> => {
    const before = await seams.readLogin()
    if (!claudeLoginNeedsRenewal(before, Date.now())) return 'not-needed'
    if (fingerprintOf(before) === notRenewed) return 'not-renewed'
    let ran: 'ran' | 'not-installed'
    try {
      ran = await renewClaudeCodeLogin(seams)
    } catch (error) {
      // A run that could not be made is not made again for the same login either.
      console.warn(
        `Claude Code could not be run to renew its login: ${error instanceof Error ? error.name : 'an error'}`,
      )
      notRenewed = fingerprintOf(before)
      return 'not-renewed'
    }
    if (ran === 'not-installed') return 'not-installed'
    if (renewedSince(before, await seams.readLogin(), Date.now())) {
      notRenewed = null
      return 'renewed'
    }
    console.warn('Claude Code ran, and its login still reads as expired to BroCrew.')
    notRenewed = fingerprintOf(before)
    return 'not-renewed'
  }
  return () => {
    running ??= renewal()
      .catch((): ClaudeLoginRenewal => 'not-renewed')
      .finally(() => {
        running = null
      })
    return running
  }
}
