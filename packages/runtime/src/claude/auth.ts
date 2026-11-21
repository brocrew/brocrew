import { execFile, execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AuthHealth, ProviderSetup } from '../internal/auth'
import type { AuthState, LoginAbsence } from '../auth-state'
import { transientSetupFailureOf } from '../runtime'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Yields the Anthropic API key a person entered in the app, or null when none is set. Read on every
 * launch, so a key replaced or removed applies to the next one. The value is a secret — callers
 * must not log it.
 */
export type ClaudeApiKeyProvider = () => string | null
export type ClaudeApiKeyProviderAsync = () => string | null | Promise<string | null>

/**
 * Yields the child's `CLAUDE_CODE_OAUTH_TOKEN` value, or null if the login is unavailable or expired.
 * Throws when the machine ran short of resources, as its default reader does.
 */
export type ClaudeAuthTokenProvider = () => string | null

/**
 * Reads the raw Keychain secret for the Claude login; null if unavailable. Injectable for tests.
 * The default one throws a machine shortage; see {@link defaultKeychainReader}.
 */
export type KeychainReader = () => string | null

/**
 * Yields the machine's current token without blocking the caller's thread: the turn gate's reader.
 * See {@link ClaudeAuthTokenProvider} for the launch-time one.
 */
export type ClaudeAuthTokenProviderAsync = () => Promise<string | null>

/** The non-blocking {@link KeychainReader}. Injectable for tests, like its synchronous twin. */
export type KeychainReaderAsync = () => Promise<string | null>

/** The macOS Keychain generic-password service Claude Code stores its credentials under. */
const CLAUDE_KEYCHAIN_SERVICE = 'Claude Code-credentials'

const KEYCHAIN_ARGS = ['find-generic-password', '-s', CLAUDE_KEYCHAIN_SERVICE, '-w'] as const

/**
 * How long `security` gets to answer before we give up (it normally takes about 25 ms). A locked
 * Keychain, an access prompt or a stalled `securityd` can leave it hanging, and the synchronous reader
 * would then freeze Electron's main thread. A timeout yields `null`, "cannot tell", never "superseded".
 */
export const KEYCHAIN_READ_TIMEOUT_MS = 2_000

/**
 * Read the macOS Keychain credential blob for the Claude login (`security find-generic-password -w`).
 * Returns the raw secret string, or null when not on macOS, the item is absent, or access is denied.
 * The value is a secret — callers must not log it.
 *
 * Synchronous, so it blocks its caller (bounded by {@link KEYCHAIN_READ_TIMEOUT_MS}). Launches use
 * {@link defaultKeychainReaderForALaunch} and the turn gate {@link defaultKeychainReaderAsync}; this is
 * the library default and what the launch reader uses off the Mac, where the login is a file.
 *
 * A machine that ran short (a `security` that cannot be spawned: `EAGAIN`, `EMFILE`) is not an answer
 * about the login, so it throws, as detected by `transientSetupFailureOf`; each caller words it
 * itself. Every other failure is `null`. The non-blocking {@link defaultKeychainReaderAsync} never throws.
 */
export function defaultKeychainReader(): string | null {
  // On Windows, Claude Code's own credentials file holds the same login ({@link claudeCredentialsFileReader}).
  if (process.platform === 'win32') return claudeCredentialsFileReader()()
  if (process.platform !== 'darwin') return null
  try {
    return execFileSync('security', [...KEYCHAIN_ARGS], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      // SIGKILL because a `security` stuck in a Keychain prompt may ignore the default SIGTERM.
      timeout: KEYCHAIN_READ_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    }).trim()
  } catch (error) {
    // A shortage is the machine's, not the login's (see the doc comment above).
    if (transientSetupFailureOf(error) !== null) throw error
    return null // item not found, access denied, or timed out — "unavailable", never a fallback
  }
}

/**
 * The same read without blocking the thread, for the turn gate on Electron's main process: a Keychain
 * that never answers costs the turn {@link KEYCHAIN_READ_TIMEOUT_MS} and the window nothing.
 *
 * Absent item, denied access, timeout, non-zero exit and a machine shortage are all `null` ("cannot
 * tell"), which the turn gate treats as fail-open (`ClaudeSessionHandle.checkSignIn`); only a launch
 * throws a shortage. The value is a secret — callers must not log it.
 */
export async function defaultKeychainReaderAsync(): Promise<string | null> {
  if (process.platform === 'win32') return claudeCredentialsFileReaderAsync()()
  if (process.platform !== 'darwin') return null
  // A spawn Node refuses at once throws synchronously inside this executor; that must not reject
  // the read, since the turn gate's contract is `null` for "cannot tell".
  return new Promise((resolve) => {
    try {
      execFile(
        'security',
        [...KEYCHAIN_ARGS],
        {
          encoding: 'utf8',
          timeout: KEYCHAIN_READ_TIMEOUT_MS,
          killSignal: 'SIGKILL',
        },
        (error, stdout) => {
          // `error` covers the timeout too (a killed child is reported as a failure), so no timer is needed.
          resolve(error ? null : stdout.trim())
        },
      )
    } catch {
      resolve(null)
    }
  })
}

/**
 * The read a launch makes without blocking the thread: the login, or `null` when there is none. As in
 * {@link defaultKeychainReader}, a machine shortage throws. Off the Mac the login is a file, or none.
 */
export async function defaultKeychainReaderForALaunch(): Promise<string | null> {
  if (process.platform !== 'darwin') return defaultKeychainReader()
  return new Promise((resolve, reject) => {
    const settle = (error: unknown): void => {
      if (transientSetupFailureOf(error) !== null) reject(error)
      else resolve(null)
    }
    try {
      execFile(
        'security',
        [...KEYCHAIN_ARGS],
        { encoding: 'utf8', timeout: KEYCHAIN_READ_TIMEOUT_MS, killSignal: 'SIGKILL' },
        (error, stdout) => {
          if (error) settle(error)
          else resolve(stdout.trim())
        },
      )
    } catch (error) {
      settle(error)
    }
  })
}

// --- Claude Code's login on Windows: its own credentials file ---

/**
 * Where Claude Code keeps its login off the Keychain: `.credentials.json` in `CLAUDE_SECURESTORAGE_CONFIG_DIR`
 * (empty means `~/.claude`), else `CLAUDE_CONFIG_DIR`, else `~/.claude`. It holds the same JSON as the
 * Keychain item (`claudeAiOauth` with `accessToken`, `refreshToken`, `expiresAt`,
 * `refreshTokenExpiresAt`, `subscriptionType`). It is the person's; nothing here writes it.
 */
export function claudeCredentialsFilePath(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const secure = env['CLAUDE_SECURESTORAGE_CONFIG_DIR']
  const folder =
    secure !== undefined ? secure || join(home, '.claude') : claudeConfigHome(env, home)
  return join(folder.normalize('NFC'), '.credentials.json')
}

/** Claude Code's own config folder: `CLAUDE_CONFIG_DIR`, else `~/.claude`, NFC as Claude Code has it. */
function claudeConfigHome(env: NodeJS.ProcessEnv, home: string): string {
  const named = env['CLAUDE_CONFIG_DIR']
  return (named !== undefined && named !== '' ? named : join(home, '.claude')).normalize('NFC')
}

/**
 * A credentials file larger than this is not read. The file is Claude Code's whole secure store, MCP
 * servers' sign-ins included, so the bound is the one the Keychain read has: `execFileSync`'s 1 MiB.
 */
const CREDENTIALS_FILE_MAX = 1024 * 1024
/**
 * The {@link KeychainReader} on Windows: Claude Code's credentials file, read whole on every call so a
 * freshly renewed login is seen without a restart. `null` when the file is absent, unreadable or too
 * large; a machine shortage throws, as in the Keychain reader. The value is a secret.
 */
export function claudeCredentialsFileReader(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): KeychainReader {
  return () => {
    const file = claudeCredentialsFilePath(env, home)
    try {
      if (statSync(file).size > CREDENTIALS_FILE_MAX) return null
      return readFileSync(file, 'utf8').trim()
    } catch (error) {
      if (transientSetupFailureOf(error) !== null) throw error
      return null
    }
  }
}

/** The same read without blocking the thread, for the turn gate; like {@link defaultKeychainReaderAsync}, it never throws. */
export function claudeCredentialsFileReaderAsync(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): KeychainReaderAsync {
  return async () => {
    try {
      const file = claudeCredentialsFilePath(env, home)
      if ((await stat(file)).size > CREDENTIALS_FILE_MAX) return null
      return (await readFile(file, 'utf8')).trim()
    } catch {
      return null
    }
  }
}

/** The current OAuth access token parsed from the Keychain blob (with its expiry, if present). */
export interface ClaudeOAuthToken {
  accessToken: string
  expiresAt: number | null
}

/**
 * Parse the Keychain blob to the current Claude.ai OAuth access token, or null if the blob is absent
 * or malformed, the token is missing, or it expired at `now` (epoch ms). The refresh token is never
 * extracted, logged or returned.
 */
export function parseClaudeOAuthToken(raw: string | null, now: number): ClaudeOAuthToken | null {
  const oauth = claudeOAuthRecord(raw)
  if (!oauth) return null
  const accessToken = typeof oauth['accessToken'] === 'string' ? oauth['accessToken'] : ''
  if (!accessToken) return null
  const expiresAt = typeof oauth['expiresAt'] === 'number' ? oauth['expiresAt'] : null
  if (expiresAt !== null && expiresAt <= now) return null // expired → unavailable
  return { accessToken, expiresAt }
}

/** The blob's `claudeAiOauth` record, or null when the blob is absent or malformed. */
function claudeOAuthRecord(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  return isRecord(json) && isRecord(json['claudeAiOauth']) ? json['claudeAiOauth'] : null
}

/**
 * What the Keychain login says about itself, without the token: when the login itself ends
 * (`refreshTokenExpiresAt` in ms, which is when Claude asks for a sign-in again; the access token
 * only lasts hours) and the plan (`subscriptionType`). `null` when there is no usable token. The end
 * is also `null` when the blob omits it, it has passed, or the access token outlives it by more than
 * three days (a stale end). No token leaves here.
 */
export function claudeLoginFacts(
  raw: string | null,
  now: number,
): { readonly expiresAt: number | null; readonly plan: string | null } | null {
  const token = parseClaudeOAuthToken(raw, now)
  if (token === null) return null
  const oauth = claudeOAuthRecord(raw)
  const ends = oauth?.['refreshTokenExpiresAt']
  const plan = oauth?.['subscriptionType']
  const said =
    typeof ends === 'number' &&
    Number.isFinite(ends) &&
    ends > now &&
    (token.expiresAt === null || token.expiresAt <= ends + CLAUDE_LOGIN_END_SLACK_MS)
  return {
    expiresAt: said ? ends : null,
    plan: typeof plan === 'string' && plan !== '' ? plan : null,
  }
}

/** How far past the login's end an access token may run before that end is taken as stale. */
const CLAUDE_LOGIN_END_SLACK_MS = 3 * 24 * 60 * 60 * 1000

/** A saved API key selects key authentication without opening it or reading the Mac login. */
export function claudeLoginStateWithAKey(
  reader: KeychainReader = defaultKeychainReader,
  clock: () => number = Date.now,
  platform: NodeJS.Platform = process.platform,
): AuthState {
  let behind: boolean | undefined
  if (platform === 'win32') {
    try {
      behind = claudeLoginFacts(reader(), clock()) !== null
    } catch {
      behind = undefined
    }
  }
  return {
    state: 'usable',
    login: 'api-key',
    expiresAt: null,
    ...(behind === undefined ? {} : { loginBehindTheKey: behind }),
  }
}

/**
 * The Claude login a check reports as {@link AuthState}: a saved key when there is one (a launch runs
 * on it and it does not expire), else the machine login's facts ({@link claudeLoginFacts}), else
 * `absent`. The key provider throws when a saved key cannot be opened; the caller words that. Never a token.
 */
export function claudeLoginState(
  reader: KeychainReader = defaultKeychainReader,
  apiKey?: ClaudeApiKeyProvider,
  clock: () => number = Date.now,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  /** How the person runs Claude Code here ({@link claudeCommandIn}), asked only to say it. */
  command: () => string = () => 'claude',
): AuthState {
  if (apiKey?.()) {
    return claudeLoginStateWithAKey(reader, clock, platform)
  }
  const now = clock()
  const raw = reader()
  const facts = claudeLoginFacts(raw, now)
  if (facts === null) {
    const why = claudeLoginAbsence(raw, now, platform, env, home)
    return { state: 'absent', reason: claudeAbsenceSaid(why, platform, command()), why }
  }
  return {
    state: 'usable',
    login: 'account',
    ...(facts.plan === null ? {} : { plan: facts.plan }),
    expiresAt: facts.expiresAt,
  }
}

/**
 * A {@link ClaudeAuthTokenProvider} backed by the machine Keychain login. It re-reads on every call so
 * an expired token is never reused, and yields only the access token, for transient
 * `CLAUDE_CODE_OAUTH_TOKEN` injection into the child env; it is never persisted.
 */
export function claudeKeychainTokenProvider(
  reader: KeychainReader = defaultKeychainReader,
  clock: () => number = Date.now,
): ClaudeAuthTokenProvider {
  return () => {
    const parsed = parseClaudeOAuthToken(reader(), clock())
    return parsed ? parsed.accessToken : null
  }
}

/** The token a launch runs on, read the launch's way ({@link defaultKeychainReaderForALaunch}). */
export function claudeKeychainTokenProviderForALaunch(
  reader: KeychainReaderAsync = defaultKeychainReaderForALaunch,
  clock: () => number = Date.now,
): ClaudeAuthTokenProviderAsync {
  return claudeKeychainTokenProviderAsync(reader, clock)
}

/**
 * The same provider over the non-blocking reader, for the turn gate. Both providers call
 * {@link parseClaudeOAuthToken}, so they cannot disagree about the same blob.
 */
export function claudeKeychainTokenProviderAsync(
  reader: KeychainReaderAsync = defaultKeychainReaderAsync,
  clock: () => number = Date.now,
): ClaudeAuthTokenProviderAsync {
  return async () => {
    const parsed = parseClaudeOAuthToken(await reader(), clock())
    return parsed ? parsed.accessToken : null
  }
}

/**
 * Claude auth-health: ok iff the provider currently yields a token (login present and unexpired).
 *
 * No Claude credential is copied into the profile home, and the Keychain is re-read on every launch,
 * so a machine Claude profile switch is picked up at once and cannot leave anything stale. The access
 * token is short-lived and {@link parseClaudeOAuthToken} returns null once it expires, so this
 * reports unavailable even with a good refresh token beside it. It never refreshes: two clients
 * rotating one refresh token breaks the login. A launch has the person's own Claude Code renew it
 * (`login-renewal.ts`), and the reason says what to do when that cannot.
 */
export function claudeAuthHealth(
  provider: ClaudeAuthTokenProvider,
  apiKey?: ClaudeApiKeyProvider,
  /** How the person runs Claude Code here ({@link claudeCommandIn}), asked only to say it. */
  command?: () => string,
): AuthHealth {
  // A set key is what a launch runs on, so the login is not read.
  if (apiKey?.()) return { ok: true }
  return provider()
    ? { ok: true }
    : {
        ok: false,
        reason: whyNoClaudeLogin(command === undefined ? {} : { command }),
      }
}

/** {@link claudeAuthHealth}, reading the login without blocking the thread. */
export async function claudeAuthHealthAsync(
  provider: ClaudeAuthTokenProviderAsync,
  apiKey?: ClaudeApiKeyProviderAsync,
  /** How the person runs Claude Code here ({@link claudeCommandIn}), asked only to say it. */
  command?: () => string,
): Promise<AuthHealth> {
  if (await apiKey?.()) return { ok: true }
  return (await provider())
    ? { ok: true }
    : {
        ok: false,
        reason: whyNoClaudeLogin(command === undefined ? {} : { command }),
      }
}

/** Where a person gives Claude a key: the “API key” section of its card on the Providers screen. */
const ENTER_A_KEY =
  'enter an API key under “API key” on the Claude card in Providers (in the left rail)'

/**
 * What a person reads when a Claude agent has nothing to run on: no API key is set and the person's
 * own Claude Code login is not usable, worded for the platform and read when it is said:
 *  - a Mac: the login is missing or expired; `claude` run once renews it.
 *  - Windows, reading Claude Code's own file ({@link claudeCredentialsFilePath}): expired (a start
 *    renews it, or `claude` run once in PowerShell, and BroBot picks it up); no login or no file
 *    (sign in once, or use a key); or a file that could not be read just now (try again).
 * No token is in any of it.
 */
export function whyNoClaudeLogin({
  platform = process.platform,
  env = process.env,
  home = homedir(),
  now = Date.now(),
  command = () => 'claude',
}: {
  readonly platform?: NodeJS.Platform
  readonly env?: NodeJS.ProcessEnv
  readonly home?: string
  readonly now?: number
  /** How the person runs Claude Code here ({@link claudeCommandIn}). */
  readonly command?: () => string
} = {}): string {
  if (platform !== 'win32') return claudeAbsenceSaid('no-login', platform, command())
  let raw: string | null
  try {
    raw = claudeCredentialsFileReader(env, home)()
  } catch {
    raw = null
  }
  return claudeAbsenceSaid(claudeLoginAbsence(raw, now, platform, env, home), platform, command())
}

/** Which absence a login read that found nothing to run on is. */
function claudeLoginAbsence(
  raw: string | null,
  now: number,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  home: string,
): LoginAbsence {
  if (platform === 'win32') {
    // A file that is there but gave nothing, or nothing whole (locked, too large, mid-write), is
    // not a person who never signed in.
    const unreadable =
      raw === null ? existsSync(claudeCredentialsFilePath(env, home)) : !parsesAsJson(raw)
    if (unreadable) return 'unreadable'
  }
  return loginHasExpired(raw, now) ? 'expired' : 'no-login'
}

/** A login with an access token whose time has passed: one Claude Code can renew. */
function loginHasExpired(raw: string | null, now: number): boolean {
  const oauth = claudeOAuthRecord(raw)
  return (
    oauth !== null &&
    typeof oauth['accessToken'] === 'string' &&
    oauth['accessToken'] !== '' &&
    typeof oauth['expiresAt'] === 'number' &&
    oauth['expiresAt'] <= now
  )
}

/** What a conversation says when the person's own Claude Code renewed their expired login for it. */
export const CLAUDE_LOGIN_RENEWED =
  'BroCrew renewed your Claude Code login by running `claude` once.'

/** What a launch says when the login had expired and could not be renewed: running Claude Code did not renew it, or none was found. */
export function claudeLoginNotRenewed(
  why: 'not-renewed' | 'not-installed',
  platform: NodeJS.Platform = process.platform,
  /** How the person runs Claude Code here ({@link claudeCommandIn}). */
  command = 'claude',
): string {
  const run =
    platform === 'win32'
      ? `open PowerShell and run \`${command}\``
      : `run \`${command}\` in a terminal`
  const what =
    why === 'not-installed'
      ? 'BroCrew did not find Claude Code on this computer to renew it (it looks on the PATH and in ' +
        'Claude Code’s own install folder). To renew it, install Claude Code if it is not there, '
      : 'BroCrew could not renew it by running Claude Code. To renew it, '
  return (
    `Your Claude Code login has expired, and ${what}${run}, log in again if it asks, then try ` +
    `again. Or ${ENTER_A_KEY}.`
  )
}

function parsesAsJson(text: string): boolean {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

/** The sentence for an absence. A Mac has one, which covers both a missing and an expired login. */
function claudeAbsenceSaid(why: LoginAbsence, platform: NodeJS.Platform, command: string): string {
  const run = `\`${command}\``
  if (platform !== 'win32') {
    return (
      'No Anthropic API key is set, and this Mac’s Claude login is missing or its token has expired. ' +
      'An expired one is renewed when a Claude conversation starts, by running Claude Code. ' +
      'Otherwise enter an API key under “API key” on the Claude card in Providers (in the left rail), ' +
      `or run ${run} in a terminal and log in, then try again.`
    )
  }
  switch (why) {
    case 'unreadable':
      return (
        'No Anthropic API key is set, and BroCrew could not read Claude Code’s login file on this ' +
        'computer just now. Try again in a moment. If it keeps happening, open PowerShell, run ' +
        `${run} and log in if it asks, then try again. Or ${ENTER_A_KEY}.`
      )
    case 'expired':
      return (
        'Your Claude Code login has expired. Starting a Claude conversation renews it by running ' +
        `Claude Code, when it is installed here. Or open PowerShell and run ${run} once, log in if ` +
        `it asks, then try again: BroCrew picks the renewed login up by itself. Or ${ENTER_A_KEY}.`
      )
    case 'no-login':
      return (
        'No Anthropic API key is set, and Claude Code is not signed in on this computer. To sign in ' +
        `once, open PowerShell, run ${run} and log in (install Claude Code first if it is not there), ` +
        `then try again. Or ${ENTER_A_KEY}.`
      )
  }
}

/**
 * Claude Code as a person runs it in this computer's shell (PowerShell on Windows, Terminal on a
 * Mac): `program`, the one BroBot found, by its full path, so it runs though its folder is not on
 * the shell's `PATH` (Anthropic's installer puts it in `~/.local/bin`, which a new shell may not
 * search). `claude` when BroBot found none, or found one whose path cannot be typed on one line.
 */
export function claudeCommandIn(program: string | null, platform: NodeJS.Platform): string {
  // eslint-disable-next-line no-control-regex -- a path with a line break or a control character cannot be typed
  if (program === null || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(program)) return 'claude'
  if (program === '') return 'claude'
  if (platform === 'win32') {
    // Single quotes: inside double quotes PowerShell expands `$` and the backtick. It reads the
    // curly single quotes as quotes too, and doubling any of them writes it.
    return `& '${program.replace(/['\u2018\u2019\u201a\u201b]/g, (quote) => quote + quote)}'`
  }
  // Bare only from the root and in plain characters, so no shell reads anything into it.
  return /^\/[\w@%+=:,./-]*$/.test(program) ? program : `'${program.replaceAll("'", "'\\''")}'`
}

/**
 * Claude Code's setup on this computer: the installer for its platform, and its sign-in command,
 * which runs `program`, the Claude Code BroBot found, or `null` when it found none
 * ({@link claudeCommandIn}).
 */
export function claudeSetup(
  platform: NodeJS.Platform = process.platform,
  program: string | null = null,
): ProviderSetup {
  const docs = 'https://code.claude.com/docs/en/setup'
  const windows = platform === 'win32'
  return {
    tool: 'Claude Code',
    install: windows
      ? { command: 'irm https://claude.ai/install.ps1 | iex', docs }
      : { command: 'curl -fsSL https://claude.ai/install.sh | bash', docs },
    signInCommand: claudeCommandIn(program, platform),
    signInInstructions: `If Claude Code opens at its interactive prompt, type /login there, not in ${windows ? 'PowerShell' : 'Terminal'}. Finish signing in in your browser, then return to BroCrew and check the sign-in again.`,
    platform: windows ? 'Windows' : 'macOS',
    shell: windows ? 'PowerShell' : 'Terminal',
  }
}
