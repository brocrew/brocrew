import { execFile, execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import {
  type BigIntStats,
  type Stats,
  closeSync,
  constants as fsConstants,
  existsSync,
  linkSync,
  lstatSync,
  fstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { lstat, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { parse as parseToml } from 'smol-toml'
import {
  type TrustedAncestry,
  exactLstatOrNull,
  isTheSameFile,
  trustProviderHomeAncestry,
  withProviderHomeLock,
} from './provider-home'
import { realResolve } from './real-path'
import { transientSetupFailureOf } from '../runtime'
import type { AuthState, LoginAbsence } from '../auth-state'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export class AuthUnavailableError extends Error {
  readonly provider: 'claude' | 'codex'

  constructor(provider: 'claude' | 'codex', message: string) {
    super(message)
    this.name = 'AuthUnavailableError'
    this.provider = provider
  }
}

export class CodexSettingsUnusableError extends AuthUnavailableError {
  constructor(message: string) {
    super('codex', message)
    this.name = 'CodexSettingsUnusableError'
  }
}

export class NoCodexSignInOnThisComputerError extends AuthUnavailableError {
  constructor(message: string) {
    super('codex', message)
    this.name = 'NoCodexSignInOnThisComputerError'
  }
}

export interface CodexCopyIdentity {
  readonly dev: bigint
  readonly ino: bigint
  readonly size: bigint
  readonly mtimeNs: bigint
}

export class CodexRefusedItsSignInError extends AuthUnavailableError {
  readonly refusedCopy: CodexCopyIdentity | null

  constructor(message: string, refusedCopy: CodexCopyIdentity | null) {
    super('codex', message)
    this.name = 'CodexRefusedItsSignInError'
    this.refusedCopy = refusedCopy
  }
}

export interface AuthHealth {
  ok: boolean
  reason?: string
}

export type ClaudeApiKeyProvider = () => string | null
export type ClaudeApiKeyProviderAsync = () => string | null | Promise<string | null>

export type ClaudeAuthTokenProvider = () => string | null

export type KeychainReader = () => string | null

export type ClaudeAuthTokenProviderAsync = () => Promise<string | null>

export type KeychainReaderAsync = () => Promise<string | null>

const CLAUDE_KEYCHAIN_SERVICE = 'Claude Code-credentials'

const KEYCHAIN_ARGS = ['find-generic-password', '-s', CLAUDE_KEYCHAIN_SERVICE, '-w'] as const

export const KEYCHAIN_READ_TIMEOUT_MS = 2_000

const KEYCHAIN_ITEM_NOT_FOUND = 44

function theKeychainDidNotGiveIt(error: unknown, stderr: string): AuthUnavailableError {
  const code = (error as { code?: unknown } | null)?.code
  const said = stderr.trim() || `security exited with ${String(code ?? 'an error')}`
  return new AuthUnavailableError(
    'claude',
    `The Keychain did not give BroCrew this Mac's Claude login: ${said}`,
  )
}

export function defaultKeychainReader(): string | null {
  if (process.platform === 'win32') return claudeCredentialsFileReader()()
  if (process.platform !== 'darwin') return null
  try {
    return execFileSync('security', [...KEYCHAIN_ARGS], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: KEYCHAIN_READ_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    }).trim()
  } catch (error) {
    if (transientSetupFailureOf(error) !== null) throw error
    return null
  }
}

export async function defaultKeychainReaderAsync(): Promise<string | null> {
  if (process.platform === 'win32') return claudeCredentialsFileReaderAsync()()
  if (process.platform !== 'darwin') return null
  return new Promise((resolve) => {
    try {
      execFile(
        'security',
        [...KEYCHAIN_ARGS],
        { encoding: 'utf8', timeout: KEYCHAIN_READ_TIMEOUT_MS, killSignal: 'SIGKILL' },
        (error, stdout) => {
          resolve(error ? null : stdout.trim())
        },
      )
    } catch {
      resolve(null)
    }
  })
}

export async function defaultKeychainReaderForALaunch(): Promise<string | null> {
  if (process.platform !== 'darwin') return defaultKeychainReader()
  return new Promise((resolve, reject) => {
    try {
      execFile('security', [...KEYCHAIN_ARGS], { encoding: 'utf8' }, (error, stdout, stderr) => {
        if (!error) resolve(stdout.trim())
        else if (transientSetupFailureOf(error) !== null) reject(error)
        else if ((error as { code?: unknown }).code === KEYCHAIN_ITEM_NOT_FOUND) resolve(null)
        else reject(theKeychainDidNotGiveIt(error, String(stderr ?? '')))
      })
    } catch (error) {
      if (transientSetupFailureOf(error) !== null) reject(error)
      else reject(theKeychainDidNotGiveIt(error, ''))
    }
  })
}

export function claudeCredentialsFilePath(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const secure = env['CLAUDE_SECURESTORAGE_CONFIG_DIR']
  const folder =
    secure !== undefined ? secure || join(home, '.claude') : claudeConfigHome(env, home)
  return join(folder.normalize('NFC'), '.credentials.json')
}

function claudeConfigHome(env: NodeJS.ProcessEnv, home: string): string {
  const named = env['CLAUDE_CONFIG_DIR']
  return (named !== undefined && named !== '' ? named : join(home, '.claude')).normalize('NFC')
}

const CREDENTIALS_FILE_MAX = 1024 * 1024
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

export interface ClaudeOAuthToken {
  accessToken: string
  expiresAt: number | null
}

export function parseClaudeOAuthToken(raw: string | null, now: number): ClaudeOAuthToken | null {
  const oauth = claudeOAuthRecord(raw)
  if (!oauth) return null
  const accessToken = typeof oauth['accessToken'] === 'string' ? oauth['accessToken'] : ''
  if (!accessToken) return null
  const expiresAt = typeof oauth['expiresAt'] === 'number' ? oauth['expiresAt'] : null
  if (expiresAt !== null && expiresAt <= now) return null
  return { accessToken, expiresAt }
}

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

const CLAUDE_LOGIN_END_SLACK_MS = 3 * 24 * 60 * 60 * 1000

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

export function claudeLoginState(
  reader: KeychainReader = defaultKeychainReader,
  apiKey?: ClaudeApiKeyProvider,
  clock: () => number = Date.now,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
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

export function claudeKeychainTokenProvider(
  reader: KeychainReader = defaultKeychainReader,
  clock: () => number = Date.now,
): ClaudeAuthTokenProvider {
  return () => {
    const parsed = parseClaudeOAuthToken(reader(), clock())
    return parsed ? parsed.accessToken : null
  }
}

export function claudeKeychainTokenProviderForALaunch(
  reader: KeychainReaderAsync = defaultKeychainReaderForALaunch,
  clock: () => number = Date.now,
): ClaudeAuthTokenProviderAsync {
  return claudeKeychainTokenProviderAsync(reader, clock)
}

export function claudeKeychainTokenProviderAsync(
  reader: KeychainReaderAsync = defaultKeychainReaderAsync,
  clock: () => number = Date.now,
): ClaudeAuthTokenProviderAsync {
  return async () => {
    const parsed = parseClaudeOAuthToken(await reader(), clock())
    return parsed ? parsed.accessToken : null
  }
}

export function credentialFingerprint(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function claudeAuthHealth(
  provider: ClaudeAuthTokenProvider,
  apiKey?: ClaudeApiKeyProvider,
  command?: () => string,
): AuthHealth {
  if (apiKey?.()) return { ok: true }
  return provider()
    ? { ok: true }
    : {
        ok: false,
        reason: whyNoClaudeLogin(command === undefined ? {} : { command }),
      }
}

export async function claudeAuthHealthAsync(
  provider: ClaudeAuthTokenProviderAsync,
  apiKey?: ClaudeApiKeyProviderAsync,
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

const ENTER_A_KEY =
  'enter an API key under “API key” on the Claude card in Providers (in the left rail)'

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

function claudeLoginAbsence(
  raw: string | null,
  now: number,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  home: string,
): LoginAbsence {
  if (platform === 'win32') {
    const unreadable =
      raw === null ? existsSync(claudeCredentialsFilePath(env, home)) : !parsesAsJson(raw)
    if (unreadable) return 'unreadable'
  }
  return loginHasExpired(raw, now) ? 'expired' : 'no-login'
}

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

export const CLAUDE_LOGIN_RENEWED =
  'BroCrew renewed your Claude Code login by running `claude` once.'

export function claudeLoginNotRenewed(
  why: 'not-renewed' | 'not-installed',
  platform: NodeJS.Platform = process.platform,
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

export function claudeCommandIn(program: string | null, platform: NodeJS.Platform): string {
  // eslint-disable-next-line no-control-regex -- a path with a line break or a control character cannot be typed
  if (program === null || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(program)) return 'claude'
  if (program === '') return 'claude'
  if (platform === 'win32') {
    return `& '${program.replace(/['\u2018\u2019\u201a\u201b]/g, (quote) => quote + quote)}'`
  }
  return /^\/[\w@%+=:,./-]*$/.test(program) ? program : `'${program.replaceAll("'", "'\\''")}'`
}

export interface ProviderSetup {
  readonly tool: string
  readonly install: { readonly command: string; readonly docs: string }
  readonly signInCommand: string
  readonly signInInstructions?: string
  readonly platform: SetupPlatform
  readonly shell: 'PowerShell' | 'Terminal'
}

export type SetupPlatform = 'macOS' | 'Windows'

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

const CODEX_AUTH_FILE = 'auth.json'

export function personalCodexAuthPath(): string {
  return join(homedir(), '.codex', CODEX_AUTH_FILE)
}

export async function provisionCodexAuth(
  providerHome: string,
  opts: { sourceAuthPath?: string; managedRoot?: string; fallbackAuthPath?: string } = {},
): Promise<void> {
  const source = opts.sourceAuthPath ?? personalCodexAuthPath()
  if (opts.fallbackAuthPath !== undefined && opts.managedRoot === undefined) {
    throw new Error('A fallback Codex sign-in is read only under a managed root.')
  }
  const ancestry =
    opts.managedRoot === undefined
      ? null
      : trustProviderHomeAncestry(opts.managedRoot, providerHome, { includeLeaf: true })
  try {
    await provisionCodexAuthLocked(
      providerHome,
      source,
      ancestry,
      opts.fallbackAuthPath === undefined || opts.managedRoot === undefined
        ? undefined
        : { path: opts.fallbackAuthPath, managedRoot: opts.managedRoot },
    )
  } finally {
    ancestry?.release()
  }
}

export interface Fallback {
  readonly path: string
  readonly managedRoot: string
}

export function fallbackSignIn(
  { path, managedRoot }: Fallback,
  between: () => void = () => {},
  platform: NodeJS.Platform = process.platform,
): Buffer | null {
  const unusable = (why: string, error?: unknown): Error => {
    if (error !== undefined && transientSetupFailureOf(error) !== null) return error as Error
    return new AuthUnavailableError(
      'codex',
      `BroBot's own Codex sign-in ${why}: ${path}` +
        (error === undefined ? '' : ` (${error instanceof Error ? error.message : String(error)})`),
    )
  }
  const absent = (error: unknown): boolean =>
    isRecord(error) && (error['code'] === 'ENOENT' || error['code'] === 'ENOTDIR')
  try {
    realpathSync.native(path)
  } catch (error) {
    if (absent(error)) return null
    throw unusable('could not be read', error)
  }
  let ancestry: TrustedAncestry
  try {
    ancestry = trustProviderHomeAncestry(managedRoot, dirname(path), { includeLeaf: true })
  } catch (error) {
    throw unusable('is not where BroCrew keeps it', error)
  }
  const reproved = (): void => {
    try {
      ancestry.verify()
    } catch (error) {
      throw unusable('moved while it was read', error)
    }
  }
  try {
    for (let attempt = 1; ; attempt += 1) {
      reproved()
      let found: BigIntStats
      try {
        found = lstatSync(path, { bigint: true })
      } catch (error) {
        if (absent(error)) return null
        throw unusable('could not be read', error)
      }
      if (!found.isFile() || found.size > BigInt(CODEX_AUTH_FILE_MAX)) {
        throw unusable('is not a file')
      }
      between()
      let data: Buffer
      try {
        const fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
        try {
          const opened = fstatSync(fd, { bigint: true })
          if (!opened.isFile() || !isTheSameFile(opened, found)) {
            throw unusable('moved while it was read')
          }
          if (platform === 'win32') {
            const now = lstatSync(path, { bigint: true })
            if (!now.isFile() || !isTheSameFile(now, opened)) throw unusable('could not be read')
          }
          data = readFileSync(fd)
        } finally {
          closeSync(fd)
        }
      } catch (error) {
        if (error instanceof AuthUnavailableError) throw error
        throw unusable('could not be read', error)
      }
      reproved()
      try {
        const parsed: unknown = JSON.parse(data.toString('utf8'))
        if (isRecord(parsed) && !Array.isArray(parsed)) return data
      } catch {
        // An incomplete JSON read falls through to the existing bounded read loop.
      }
      if (attempt === 3) throw unusable('could not be read whole')
    }
  } finally {
    ancestry.release()
  }
}

function theSignInToCopy(source: string, fallback: Fallback | undefined): Buffer {
  try {
    return readFileSync(source)
  } catch (error) {
    if (!(isRecord(error) && error['code'] === 'ENOENT') || fallback === undefined) throw error
    const own = fallbackSignIn(fallback)
    if (own === null) throw error
    return own
  }
}

async function provisionCodexAuthLocked(
  providerHome: string,
  source: string,
  ancestry: TrustedAncestry | null,
  fallback: Fallback | undefined,
): Promise<void> {
  await withProviderHomeLock(
    providerHome,
    () => {
      ancestry?.verify()
      const dest = join(providerHome, CODEX_AUTH_FILE)

      const destStat = statOrNull(dest)
      if (destStat === null && lstatOrNull(dest)?.isSymbolicLink()) unlinkSync(dest)
      if (destStat) {
        if (!destStat.isFile()) {
          throw new AuthUnavailableError(
            'codex',
            `profile auth.json is not a regular file: ${dest}`,
          )
        }
        return
      }

      let data: Buffer
      try {
        data = theSignInToCopy(source, fallback)
      } catch (error) {
        if (error instanceof AuthUnavailableError) throw error
        if (isRecord(error) && error['code'] === 'ENOENT') {
          throw new NoCodexSignInOnThisComputerError(
            `personal Codex auth.json not found at ${source}` +
              (fallback === undefined ? '' : `, and BroBot's own has none at ${fallback.path}`),
          )
        }
        if (transientSetupFailureOf(error) !== null) throw error
        throw new AuthUnavailableError('codex', `personal Codex auth.json not found at ${source}`)
      }

      const tmp = join(providerHome, `.auth.json.tmp-${randomBytes(12).toString('hex')}`)
      const flags =
        fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW
      ancestry?.verify()
      const fd = openSync(tmp, flags, 0o600)
      try {
        writeSync(fd, data)
        linkSync(tmp, dest)
      } finally {
        closeSync(fd)
        rmSync(tmp, { force: true })
      }
    },
    { verify: ancestry?.verify },
  )
}

export type CodexCopySource = 'the-computers' | 'brobots-own'

export type CodexCopyCandidate =
  | { readonly from: 'the-computers'; readonly sourceAuthPath: string }
  | { readonly from: 'brobots-own'; readonly fallback: Fallback }

export async function replaceARefusedCodexCopy(
  providerHome: string,
  opts: {
    managedRoot: string
    candidates: readonly CodexCopyCandidate[]
    refused: CodexCopyIdentity
    stillWanted: () => boolean
  },
): Promise<CodexCopySource | 'not-tried'> {
  const ancestry = trustProviderHomeAncestry(opts.managedRoot, providerHome, { includeLeaf: true })
  try {
    return await withProviderHomeLock(
      providerHome,
      () => {
        if (!opts.stillWanted()) return 'not-tried'
        ancestry.verify()
        const dest = join(providerHome, CODEX_AUTH_FILE)
        const held = exactLstatOrNull(dest)
        if (held === null || !held.isFile() || held.size > BigInt(CODEX_AUTH_FILE_MAX)) {
          return 'not-tried'
        }
        if (!isTheSameCopy(held, opts.refused)) return 'not-tried'
        const refused = readOrNull(dest)
        if (refused === null) return 'not-tried'
        const account = codexAccountOf(refused.toString('utf8'))
        const refreshed = codexRefreshedAt(refused.toString('utf8'))
        if (account === null || account === 'api-key' || refreshed === null) return 'not-tried'
        let fresh: { from: CodexCopySource; bytes: Buffer; refreshed: number } | null = null
        for (const candidate of opts.candidates) {
          let bytes: Buffer | null
          try {
            bytes =
              candidate.from === 'the-computers'
                ? readFileSync(candidate.sourceAuthPath)
                : fallbackSignIn(candidate.fallback)
          } catch {
            continue
          }
          if (bytes === null || bytes.length > CODEX_AUTH_FILE_MAX) continue
          const text = bytes.toString('utf8')
          const when = codexRefreshedAt(text)
          if (codexAccountOf(text) !== account || when === null || when <= refreshed) continue
          if (fresh === null || when > fresh.refreshed) {
            fresh = { from: candidate.from, bytes, refreshed: when }
          }
        }
        if (fresh === null) return 'not-tried'
        const tmp = join(providerHome, `.auth.json.tmp-${randomBytes(12).toString('hex')}`)
        const flags =
          fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW
        ancestry.verify()
        const fd = openSync(tmp, flags, 0o600)
        try {
          try {
            writeSync(fd, fresh.bytes)
          } finally {
            closeSync(fd)
          }

          renameSync(tmp, dest)
        } catch (error) {
          rmSync(tmp, { force: true })
          throw error
        }
        return fresh.from
      },
      { verify: ancestry.verify },
    )
  } finally {
    ancestry.release()
  }
}

export function codexCopyIdentityIn(providerHome: string): CodexCopyIdentity | null {
  const held = exactLstatOrNull(join(providerHome, CODEX_AUTH_FILE))
  if (held === null || !held.isFile()) return null
  return { dev: held.dev, ino: held.ino, size: held.size, mtimeNs: held.mtimeNs }
}

export function isTheSameCodexCopy(
  one: CodexCopyIdentity | null | undefined,
  other: CodexCopyIdentity | null | undefined,
): boolean {
  return (
    one !== null &&
    one !== undefined &&
    other !== null &&
    other !== undefined &&
    isTheSameFile(one, other) &&
    one.size === other.size &&
    one.mtimeNs === other.mtimeNs
  )
}

function isTheSameCopy(held: BigIntStats, refused: CodexCopyIdentity): boolean {
  return (
    isTheSameFile(held, refused) && held.size === refused.size && held.mtimeNs === refused.mtimeNs
  )
}

export type ReprovisionOutcome = 'replaced' | 'unchanged'

export async function reprovisionCodexAuth(
  providerHome: string,
  opts: { sourceAuthPath?: string } = {},
): Promise<ReprovisionOutcome> {
  const source = opts.sourceAuthPath ?? personalCodexAuthPath()
  return await withProviderHomeLock(providerHome, () => {
    const dest = join(providerHome, CODEX_AUTH_FILE)

    const destStat = lstatOrNull(dest)
    if (destStat && !destStat.isFile() && !destStat.isSymbolicLink()) {
      throw new AuthUnavailableError('codex', `profile auth.json is not a regular file: ${dest}`)
    }

    let data: Buffer
    try {
      data = readFileSync(source)
    } catch (error) {
      if (transientSetupFailureOf(error) !== null) throw error
      throw new AuthUnavailableError(
        'codex',
        `personal Codex auth.json not found at ${source} — sign in with the codex CLI first, then try again`,
      )
    }

    const existing = destStat?.isFile() ? readOrNull(dest) : null
    if (existing && existing.equals(data)) return 'unchanged'

    const tmp = join(providerHome, `.auth.json.tmp-${randomBytes(12).toString('hex')}`)
    const flags =
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW
    const fd = openSync(tmp, flags, 0o600)
    try {
      try {
        writeSync(fd, data)
      } finally {
        closeSync(fd)
      }

      renameSync(tmp, dest)
    } catch (error) {
      rmSync(tmp, { force: true })
      throw error
    }
    return 'replaced'
  })
}

function readOrNull(path: string): Buffer | null {
  try {
    return readFileSync(path)
  } catch {
    return null
  }
}

export function codexAuthHealth(providerHome: string): AuthHealth {
  const dest = join(providerHome, CODEX_AUTH_FILE)
  const stat = statOrNull(dest)
  if (!stat) return { ok: false, reason: `no managed Codex auth.json in ${providerHome}` }
  if (!stat.isFile())
    return { ok: false, reason: `Codex auth.json is not a regular file (e.g. a directory)` }
  return { ok: true }
}

const CODEX_AUTH_FILE_MAX = 1024 * 1024

export async function codexAccountIn(providerHome: string): Promise<string | null> {
  try {
    const file = join(providerHome, CODEX_AUTH_FILE)
    const found = await lstat(file)
    if (!found.isFile() || found.size > CODEX_AUTH_FILE_MAX) return null
    return codexAccountOf(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

export function codexAccountInNow(providerHome: string): string | null {
  try {
    const file = join(providerHome, CODEX_AUTH_FILE)
    const found = lstatSync(file)
    if (!found.isFile() || found.size > CODEX_AUTH_FILE_MAX) return null
    return codexAccountOf(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function codexAccountOf(text: string): string | null {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(json)) return null
  const mode = json['auth_mode']
  const tokens = json['tokens']
  const account = isRecord(tokens) ? tokens['account_id'] : undefined
  const key = json['OPENAI_API_KEY']
  if (mode === 'apikey' || (mode === undefined && typeof key === 'string' && key !== '')) {
    return typeof key === 'string' && key !== '' ? 'api-key' : null
  }
  if ((mode === 'chatgpt' || mode === undefined) && typeof account === 'string' && account !== '') {
    return credentialFingerprint(`account:${account}`)
  }
  return null
}

function codexRefreshedAt(text: string): number | null {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  const said = isRecord(json) ? json['last_refresh'] : undefined
  const at = typeof said === 'string' ? Date.parse(said) : Number.NaN
  return Number.isFinite(at) ? at : null
}

const SQLITE_HOME_KEY = 'sqlite_home'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function collectSqliteHomeDeclarations(
  node: unknown,
  path: string[] = [],
): { at: string; value: unknown }[] {
  if (typeof node !== 'object' || node === null) return []
  if (Array.isArray(node))
    return node.flatMap((item, i) => collectSqliteHomeDeclarations(item, [...path, String(i)]))
  const found: { at: string; value: unknown }[] = []
  for (const [key, value] of Object.entries(node)) {
    const here = [...path, key]
    if (key === SQLITE_HOME_KEY) found.push({ at: here.join('.'), value })
    else found.push(...collectSqliteHomeDeclarations(value, here))
  }
  return found
}

export function assertCodexSqliteHomeContained(providerHome: string): void {
  const configPath = join(providerHome, 'config.toml')
  let content: string
  try {
    content = readFileSync(configPath, 'utf8')
  } catch {
    return
  }

  let parsed: unknown
  try {
    parsed = parseToml(content)
  } catch (error) {
    throw new CodexSettingsUnusableError(
      `profile config.toml could not be parsed, so sqlite_home cannot be attested (failing closed): ${errorText(error)}`,
    )
  }

  const declarations = collectSqliteHomeDeclarations(parsed)
  if (declarations.length === 0) return
  if (declarations.length > 1) {
    throw new CodexSettingsUnusableError(
      `profile config.toml declares sqlite_home ${declarations.length} times (${declarations
        .map((d) => d.at)
        .join(', ')}); which one applies is ambiguous (failing closed)`,
    )
  }
  const { at, value } = declarations[0]!
  if (typeof value !== 'string' || value === '') {
    throw new CodexSettingsUnusableError(
      `profile config.toml ${at} is not a usable path (${JSON.stringify(value)}) (failing closed)`,
    )
  }
  const home = realResolve(providerHome)
  const target = realResolve(resolve(providerHome, value))
  if (home === null || target === null) {
    throw new CodexSettingsUnusableError(
      `config ${at} cannot be canonicalized — something on the way to it is a link that leads ` +
        `nowhere, so where Codex would write cannot be established (failing closed): ${value}`,
    )
  }
  if (target !== home && !target.startsWith(home + sep)) {
    throw new CodexSettingsUnusableError(
      `config ${at} redirects Codex state out of the profile home: ${value} → ${target}`,
    )
  }
}

function statOrNull(path: string): Stats | null {
  try {
    return statSync(path)
  } catch {
    return null
  }
}

function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path)
  } catch {
    return null
  }
}
