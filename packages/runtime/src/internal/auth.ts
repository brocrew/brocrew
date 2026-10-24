import { execFile, execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import {
  type BigIntStats,
  type Stats,
  chmodSync,
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

/**
 * How each provider's agents authenticate, and the health signals that say whether they can.
 *
 * **An API key a person enters in the app is the supported way.** It is stored encrypted by the
 * desktop app and handed to each launch by a provider ({@link ClaudeApiKeyProvider}); for Claude it
 * reaches the CLI through a file descriptor, never through an environment.
 *
 * **The machine login is the fallback when no key is set** (022, from the 015 recipes): Claude
 * reads the person's own Claude Code login per launch — the macOS Keychain item on a Mac, Claude
 * Code's own credentials file on Windows (the same JSON, {@link claudeCredentialsFilePath}); Codex
 * copies its `auth.json` into the profile home.
 * Everything is seam-injectable so the unit tests mock the Keychain/fs and no live secret ever
 * flows in `pnpm run ci`.
 *
 * ⛔ **An API key in this app's own environment is never passed on** — `buildChildEnv` drops it.
 * Only the key a person entered reaches a provider, by its own path.
 *
 * Hard rules (015): never write/log the Claude token; copy ONLY Codex `auth.json`,
 * once, `0600`, atomically, never symlinked; never overwrite a possibly-refreshed
 * profile credential; and on a missing/unhealthy managed credential surface an
 * explicit {@link AuthUnavailableError} — **never** a silent fall back to the
 * personal `~/.claude` / `~/.codex`.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** A managed provider credential is missing/unhealthy — the caller must surface it, not fall back. */
export class AuthUnavailableError extends Error {
  readonly provider: 'claude' | 'codex'

  constructor(provider: 'claude' | 'codex', message: string) {
    super(message)
    this.name = 'AuthUnavailableError'
    this.provider = provider
  }
}

/**
 * A Codex profile whose `config.toml` cannot be attested, so it is refused before Codex runs. Its own
 * class, because a person fixes the settings, not the sign-in.
 */
export class CodexSettingsUnusableError extends AuthUnavailableError {
  constructor(message: string) {
    super('codex', message)
    this.name = 'CodexSettingsUnusableError'
  }
}

/**
 * No Codex sign-in for a profile to copy at its first start: this computer has none, and BroBot's
 * own profile has none inside BroBot's data folder. Its own class, because signing in again does
 * not fix it where the sign-in is kept per profile: there was never one to renew.
 */
export class NoCodexSignInOnThisComputerError extends AuthUnavailableError {
  constructor(message: string) {
    super('codex', message)
    this.name = 'NoCodexSignInOnThisComputerError'
  }
}

/**
 * What tells one copy of a Codex sign-in from another without reading it: the file itself, its
 * size, and when it was last written. A copy Codex renewed in place keeps the file and changes the
 * other two; a copy replaced by another is another file.
 */
export interface CodexCopyIdentity {
  readonly dev: bigint
  readonly ino: bigint
  readonly size: bigint
  readonly mtimeNs: bigint
}

/**
 * Codex itself said it cannot use the sign-in this profile holds: the running program was asked,
 * and answered that a sign-in is there and names no account. Its own class, because this is the
 * one refusal a fresher copy answers. A sign-in refused before Codex was asked (a file's mode, its
 * shape) is not this.
 */
export class CodexRefusedItsSignInError extends AuthUnavailableError {
  /**
   * The copy that was refused: the one the home held before Codex was started and still held,
   * unchanged, when Codex answered. Null where the home held none, or held another by then: which
   * copy Codex refused is then not known, and none is replaced.
   */
  readonly refusedCopy: CodexCopyIdentity | null

  constructor(message: string, refusedCopy: CodexCopyIdentity | null) {
    super('codex', message)
    this.name = 'CodexRefusedItsSignInError'
    this.refusedCopy = refusedCopy
  }
}

/** A provider's managed-credential health; `reason` is a human string when not ok. */
export interface AuthHealth {
  ok: boolean
  reason?: string
}

// --- Claude: a person's API key, else the transient Keychain access-token bridge ---

/**
 * Yields the Anthropic API key a person entered in the app, or null when none is set. Read on every
 * launch, so a key replaced or removed applies to the next one. The value is a secret — callers
 * must not log it.
 */
export type ClaudeApiKeyProvider = () => string | null
export type ClaudeApiKeyProviderAsync = () => string | null | Promise<string | null>

/**
 * Yields the child's `CLAUDE_CODE_OAUTH_TOKEN` value, or null if the login is unavailable/expired —
 * and THROWS a machine shortage, as its default reader does since `710` (R52).
 */
export type ClaudeAuthTokenProvider = () => string | null

/**
 * Reads the raw Keychain secret for the Claude login; null if unavailable. Injectable for tests.
 * ⚠️ The default one throws a machine shortage (`710`, R52) — see {@link defaultKeychainReader}.
 */
export type KeychainReader = () => string | null

/**
 * Yields the machine's CURRENT token without blocking the caller's thread (149) — the turn gate's
 * reader. See {@link ClaudeAuthTokenProvider} for the launch-time one and why there are two.
 */
export type ClaudeAuthTokenProviderAsync = () => Promise<string | null>

/** The non-blocking {@link KeychainReader}. Injectable for tests, like its synchronous twin. */
export type KeychainReaderAsync = () => Promise<string | null>

/** The macOS Keychain generic-password service Claude Code stores its credentials under (015). */
const CLAUDE_KEYCHAIN_SERVICE = 'Claude Code-credentials'

const KEYCHAIN_ARGS = ['find-generic-password', '-s', CLAUDE_KEYCHAIN_SERVICE, '-w'] as const

/**
 * How long `security` gets to answer before we give up on it (149, from 148 H4).
 *
 * ⛔ **There was no bound at all, and one of the two readers blocks the thread it runs on.** macOS
 * `security` is not guaranteed to return: a locked Keychain, an access-control prompt, or a stalled
 * `securityd` all leave it sitting there. On the synchronous reader that is Electron's MAIN thread —
 * so the app freezes, and close/reopen freeze with it, which takes away the very escape this
 * feature's remedy is.
 *
 * Two seconds because this is a local IPC to a running daemon that costs **19–26 ms** when it works
 * (measured over seven runs, 147 §3). Two orders of magnitude of headroom is not a guess about the
 * slow case; it is far enough out that only a genuinely stuck `security` reaches it.
 *
 * ⚠️ **A read that times out yields `null`, which is "cannot tell" — never "superseded".** See
 * {@link claudeKeychainTokenProvider} and `ClaudeSessionHandle.checkSignIn` for why that direction
 * is the safe one.
 */
export const KEYCHAIN_READ_TIMEOUT_MS = 2_000

/**
 * Read the macOS Keychain credential blob for the Claude login (`security
 * find-generic-password -w`). Returns the raw secret string, or null when not on
 * macOS / the item is absent / access is denied. The value is a secret — callers
 * must not log it.
 *
 * ⚠️ **Synchronous, so it BLOCKS its caller — bounded by {@link KEYCHAIN_READ_TIMEOUT_MS} since
 * 149.** The app's launches read with {@link defaultKeychainReaderForALaunch} and its turn gate with
 * {@link defaultKeychainReaderAsync}; this one is the library default for a `ClaudeRuntime` given no
 * launch reader, and what the launch reader uses off the Mac, where the login is a file.
 *
 * 🔴 **710 · R52 — a machine that ran short is NOT an answer about the login, so it THROWS.** Every
 * other failure is still `null`. ⛔ Until `710` a `security` that could not be spawned — no process
 * slot (`EAGAIN`), no descriptor for its pipes (`EMFILE`) — read as *"no login"*, and a person
 * starting a conversation was told *"Your machine Claude login is missing or its token has
 * expired"* about a login that was fine. ⚑ Read by the errno's code (`transientSetupFailureOf`), and
 * thrown as it came, for each door that reads it to say in its own words. ⚑ **The doors, derived
 * from who calls `prepareProviderHome` and the launch's token provider** (`710`'s two reviews found
 * four that did not): a person's New Conversation and Reopen read a sentence
 * (`RuntimeHost.aShortageAsARefusal`), `give_work`, a wake and a message's start their retryable
 * words, the launcher's model field, a Library row's Import and the catch-up sweep a clause
 * (`RuntimeHost.howAFailureReads`), and the sign-in CHECK *"Could not ask"* —
 * `RuntimeHost.checkProviderAuth` answers any throw that way, which is the truth. ⚠️ Its
 * non-blocking twin, {@link defaultKeychainReaderAsync}, does NOT throw.
 */
export function defaultKeychainReader(): string | null {
  // ⚑ **On Windows, Claude Code's own credentials file** — the same login, kept where Claude Code
  // keeps it there ({@link claudeCredentialsFileReader}).
  if (process.platform === 'win32') return claudeCredentialsFileReader()()
  if (process.platform !== 'darwin') return null
  try {
    return execFileSync('security', [...KEYCHAIN_ARGS], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      // `timeout` alone leaves a wedged `security` to be SIGTERMed; a process stuck inside a
      // Keychain prompt may not take that, so the kill is the one that cannot be ignored.
      timeout: KEYCHAIN_READ_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    }).trim()
  } catch (error) {
    // ⛔ **710 · R52** — a shortage is the machine's, not the login's (the docblock above).
    if (transientSetupFailureOf(error) !== null) throw error
    return null // item not found, access denied, or timed out — "unavailable", never a fallback
  }
}

/**
 * The same read, **without blocking the thread** (149, fixing 148 H4).
 *
 * ⛔ **This is the one the turn gate uses, and the reason it exists is that the gate runs on
 * Electron's main process.** `execFileSync` there is a freeze of the whole app for as long as
 * `security` takes; `execFile` is a spawn the event loop keeps turning through, so a Keychain that
 * never answers costs this turn {@link KEYCHAIN_READ_TIMEOUT_MS} and costs the window nothing.
 *
 * Absent item, denied access, timeout and a non-zero exit are all "unavailable" — and ⚠️ **unlike
 * the synchronous one since `710` (R52), so is a machine that ran short**: this is the turn gate's
 * reader, whose `null` is *cannot tell* and fails open on purpose (`ClaudeSessionHandle.checkSignIn`),
 * while the throw belongs to a launch, which has a person's sentence to turn it into. The value is a
 * secret — callers must not log it.
 */
export async function defaultKeychainReaderAsync(): Promise<string | null> {
  if (process.platform === 'win32') return claudeCredentialsFileReaderAsync()()
  if (process.platform !== 'darwin') return null
  // ⛔ **710 · second review — a spawn Node refuses AT ONCE throws inside this executor,
  // synchronously** (`ENOMEM`, and every errno but the five it defers), and a throw there would
  // REJECT the read — the one outcome the turn gate's *cannot tell* contract rules out. ⚑ So it is
  // `null` too.
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
          // ⚠️ **`error` covers the timeout too** — Node reports a killed child as a failure with
          // `killed: true` — so there is no separate deadline to race here and no timer to clear.
          resolve(error ? null : stdout.trim())
        },
      )
    } catch {
      resolve(null)
    }
  })
}

/**
 * The read a launch makes, without blocking the thread: the login, or `null` when there is none —
 * and, as {@link defaultKeychainReader} does, a machine that ran short throws rather than reading as
 * no login. On a Mac it waits on `security` off the thread; elsewhere the login is a file, or none.
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
 * 🔴 **Where Claude Code keeps its login off the Keychain** — `.credentials.json` in its secure-storage
 * folder: `CLAUDE_SECURESTORAGE_CONFIG_DIR` when set (an empty one is `~/.claude`), else its config
 * folder, `CLAUDE_CONFIG_DIR`, else `~/.claude`. ⚑ It holds the same JSON as the Keychain item:
 * `claudeAiOauth` with `accessToken`, `refreshToken`, `expiresAt`, `refreshTokenExpiresAt`,
 * `subscriptionType`. ⛔ It is the PERSON's: nothing here writes it.
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
 * ⚑ **The {@link KeychainReader} on Windows: Claude Code's credentials file**, read whole on every
 * call, as the Keychain item is — so a login Claude Code has just renewed is the one the next read
 * sees, with no restart. `null` when the file is absent, unreadable or too large.
 * 🔴 **710 · R52 — a machine that ran short throws**, as the Keychain reader does: it is not an
 * answer about the login. The value is a secret — callers must not log it.
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

/**
 * The same read **without blocking the thread**, for the turn gate — and, like
 * {@link defaultKeychainReaderAsync}, it never throws: `null` is *cannot tell*.
 */
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
 * Parse the Keychain blob to the CURRENT Claude.ai OAuth **access** token, or null
 * if the blob is absent/malformed, the token is missing, or it has already expired
 * at `now` (epoch ms). Only the access token is surfaced — the refresh token is
 * never extracted, logged, or returned.
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
 * 🔒 **What the Keychain login says about itself, without the token** — for a person's Providers
 * screen: when the login itself expires, and the plan, in the provider's own word
 * (`subscriptionType`). `null` when there is no usable token, as {@link parseClaudeOAuthToken}
 * decides. ⛔ No token, no refresh token and no part of either leaves here.
 *
 * ⚑ **The login's end is `refreshTokenExpiresAt`, not `expiresAt`**: the access token lasts hours
 * and Claude renews it itself, while the refresh token's end is when Claude asks for a sign-in
 * again — the date Claude's own "login expires in N days" notice counts down to (milliseconds).
 * ⚠️ `null` where that notice says nothing too: the blob does not say, the date has passed while
 * the access token still works, or the access token outlives it by more than three days — a
 * renewal that brought no new end keeps the old one, which then says nothing true.
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
 * 🔒 **The Claude login a check reports**, as {@link AuthState}: a saved key when there is one — it
 * is what a launch runs on, and it does not expire — else the machine login's facts
 * ({@link claudeLoginFacts}), else `absent`. ⚠️ The key provider throws when a saved key cannot be
 * opened; the caller says that in its own words. ⛔ Never a token.
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
 * A {@link ClaudeAuthTokenProvider} backed by the machine Keychain login. It
 * RE-READS on every call (so an expired token is never reused) and yields only the
 * access token for transient `CLAUDE_CODE_OAUTH_TOKEN` injection — the caller passes
 * it straight to the child env and never persists it.
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
 * The same provider over the non-blocking reader (149) — **the one the turn gate consults.**
 *
 * One parse, one contract, two readers: everything that decides what the answer MEANS lives in
 * {@link parseClaudeOAuthToken}, which both of these call, so the blocking and non-blocking paths
 * cannot come to different conclusions about the same blob.
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
 * A one-way fingerprint of a machine credential, for asking *"is this still the same sign-in?"*
 * without ever holding the sign-in (147).
 *
 * ## Why a hash of the ACCESS TOKEN, and not the token, the expiry, or the account
 *
 * 🔒 **The token itself is never kept.** A session that remembered what it launched with would be a
 * second copy of the secret, alive for the whole conversation, in a process that also writes a
 * ledger and a log. SHA-256 over 108 characters of OAuth token is not invertible and is not a
 * credential: it authenticates nothing, and the only question it can answer is the only one we ask —
 * *are these two reads the same bytes?*
 *
 * ⚠️ **The expiry is NOT sufficient, and it is the obvious wrong answer.** `expiresAt` is
 * `number | null` — {@link parseClaudeOAuthToken} returns null for it when the blob omits it — so a
 * comparison built on it is silently blind exactly when the blob changes shape. The fingerprint
 * exists whenever a token exists.
 *
 * ⛔ **And it answers "the credential moved", NOT "the account changed" — measured, 147 §1.** The
 * Keychain blob holds `accessToken`, `refreshToken`, `expiresAt`, `refreshTokenExpiresAt`, `scopes`,
 * `subscriptionType`, `rateLimitTier` **and no account identity at all**: no id, no email, no
 * organization. So the credential cannot be asked who it belongs to, and an ordinary 8-hourly
 * refresh is indistinguishable from a deliberate account switch. That is not a defect in this
 * function; it is the fact any caller has to be honest about, and it is why the app TELLS the user
 * rather than acting on the difference. See `ClaudeSessionHandle.checkSignIn`.
 *
 * ⚠️ **And the blob's SHAPE is not a stable thing to key on either — three measurements, 149.**
 * `110` read 566 bytes on 2026-08-10 with an `organizationUuid` in them; `147` read it on 2026-08-14
 * and `149` again the same day, both **509 bytes with no `organizationUuid`**. Anthropic dropped the
 * one field that could have told a renewal from a switch, between two measurements four days apart.
 * A comparison built on any named identity field would therefore have gone quietly blind — the
 * failure mode {@link parseClaudeOAuthToken}'s `expiresAt` note is about, arriving through a
 * different field. The access token is the one thing the blob is certain to carry.
 */
export function credentialFingerprint(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/**
 * A tag for the sign-in a session launched on, from the fingerprint it already holds of it
 * ({@link SessionHandle.signInTag}). Digested once more and cut short, so what is kept on disk
 * beside a usage reading is not the fingerprint a sign-in is compared by.
 */
export function signInTagOf(launchFingerprint: string): string {
  return credentialFingerprint(`sign-in-tag:${launchFingerprint}`).slice(0, 32)
}

/**
 * Claude auth-health: ok iff the provider currently yields a token (login present + unexpired).
 *
 * ## What a Claude profile switch does to this app — measured, 098
 *
 * Claude and Codex credential state are independent. Switching a machine Claude profile does not explain a Codex failure; their credential lifecycles differ:
 *
 *  - **Nothing is copied.** 015's hard rule; there is no Claude credential in the profile home to go
 *    stale, and therefore nothing to re-provision.
 *  - **The Keychain is re-read on every launch** ({@link claudeKeychainTokenProvider} calls the
 *    reader per call, deliberately), and macOS holds **exactly one** `Claude Code-credentials`
 *    generic-password item — verified with `security find-generic-password`: one item, one `acct`.
 *    So switching machine profiles rewrites that single slot, and the next BroBot2 launch inherits
 *    whoever the machine is now. It is instant, it is not stale, and it cannot be out of sync.
 *  - ⇒ A Claude profile switch changes **which account Claude sessions run as**, and touches Codex
 *    not at all. Different credential, different file, different flow. The two events were
 *    coincidence.
 *
 * ⚠️ **What it DOES cost, named rather than fixed.** The Keychain access token is short-lived —
 * measured `expiresAt` 29 minutes ahead of the read, with a `refreshTokenExpiresAt` four weeks out
 * beside it. {@link parseClaudeOAuthToken} returns null the moment the access token expires, so this
 * reports unavailable while a perfectly good refresh token sits next to it. Refreshing it here is
 * exactly the shared-token stomp that broke Codex — one credential, two clients, one rotation — so
 * this never does: a launch has the person's own Claude Code renew it first
 * (`claude-login-renewal.ts`), and the reason says what to do when that cannot.
 */
export function claudeAuthHealth(
  provider: ClaudeAuthTokenProvider,
  apiKey?: ClaudeApiKeyProvider,
  /** How the person runs Claude Code here ({@link claudeCommandIn}), asked only to say it. */
  command?: () => string,
): AuthHealth {
  // ⚑ A set key is what a launch runs on, so it is all this needs: the login is not read.
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
 * 🔴 **What a person reads when a Claude agent has nothing to run on**: no API key is set, and the
 * person's own Claude Code login, the fallback, is not there to run on — said for the computer it is
 * said on. ⚑ The key comes first because it is the supported way; the login works for whoever has
 * one. ⚑ Read at the moment it is said, so it tells the state as it is now:
 *  - **a Mac**: its login is missing or expired; `claude` run once renews it.
 *  - **Windows**, reading Claude Code's own file ({@link claudeCredentialsFilePath}): expired — a
 *    start renews it by running Claude Code, or `claude` run once in PowerShell does, and BroBot picks
 *    the renewed login up by itself; no login in it, or no file — sign in once, or use a key; or a
 *    file that is there but could not be read just now — try again.
 * ⛔ No token and no part of one is in any of it.
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

/**
 * What a launch says when the login had expired and BroBot could not renew it: running the person's
 * Claude Code did not renew it, or no Claude Code was found to run.
 */
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

/** How a person puts a provider's own login on this computer, for the Providers screen to say. */
export interface ProviderSetup {
  /** The tool that holds the login. */
  readonly tool: string
  /** How to install the tool here, and where its own instructions are. */
  readonly install: { readonly command: string; readonly docs: string }
  /** The command that signs in, and that renews an expired login, as typed in {@link shell}. */
  readonly signInCommand: string
  /** Guidance for completing the interactive sign-in after the command opens. */
  readonly signInInstructions?: string
  /** The computer the steps are for, as a person names it. */
  readonly platform: SetupPlatform
  /** The app a person opens to run the commands, which they are written for. */
  readonly shell: 'PowerShell' | 'Terminal'
}

/** The two systems this app runs on, by the names a person knows them by. */
export type SetupPlatform = 'macOS' | 'Windows'

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

// --- Codex: copy auth.json once into the profile home (0600, atomic) ---

const CODEX_AUTH_FILE = 'auth.json'

/** The personal Codex credential path (`~/.codex/auth.json`) — the copy source. */
export function personalCodexAuthPath(): string {
  return join(homedir(), '.codex', CODEX_AUTH_FILE)
}

/**
 * Copy the personal Codex `auth.json` into the profile home **once**, atomically, at
 * mode `0600` (022, from 015). It copies **only** `auth.json` (never history/config/
 * db), copies its **content** (never symlinks the profile to the personal file,
 * which Codex may truncate/rewrite), and **never overwrites** an existing profile
 * credential — that copy may have been refreshed independently, and re-copying the
 * personal one on an mtime change would clobber it.
 *
 * Where the computer has no Codex sign-in, it copies `fallbackAuthPath` instead when one is given:
 * BroBot's own profile's sign-in, so an agent can start on a computer signed in to Codex only
 * inside BroBot. Both copies then share one renewing sign-in, and whichever renews first spends
 * the other's. The fallback is read only under `managedRoot`, through a folder chain with no link
 * in it, and must be a regular file holding a whole JSON object. With neither, it throws
 * {@link NoCodexSignInOnThisComputerError}; it never falls back to `~/.codex` itself.
 */
export async function provisionCodexAuth(
  providerHome: string,
  opts: { sourceAuthPath?: string; managedRoot?: string; fallbackAuthPath?: string } = {},
): Promise<void> {
  const source = opts.sourceAuthPath ?? personalCodexAuthPath()
  if (opts.fallbackAuthPath !== undefined && opts.managedRoot === undefined) {
    throw new Error('A fallback Codex sign-in is read only under a managed root.')
  }
  // 🔴 **This is the step that puts the credential on disk, so it re-proves the home it is writing
  // into** (293 §1). `provisionProviderHome` now survives its own lock, but it RETURNS — and the
  // ancestor can be swapped between that return and this call, which is the same escape one
  // function later. ⚠️ **Optional, and a caller that does not know the managed root gets the
  // behaviour it always had**: every test that copies into a bare temp directory, and
  // `reprovisionCodexAuth`, which is 098's separate writer.
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

/** A fallback sign-in, and the managed root its folder chain must stay under. */
export interface Fallback {
  readonly path: string
  readonly managedRoot: string
}

/**
 * The fallback sign-in's bytes, or null when there is none: only when the file, or a folder above
 * it, is not there. Read only from inside the managed root:
 *
 * - its folder chain under the managed root is pinned, with no link anywhere in it, and re-proved
 *   before the file is looked at and again after it is read. The file opened must be the regular
 *   file looked at, by device and inode. A process of the same person racing these paths between
 *   two checks and restoring them is out of reach here: it could read both files itself;
 * - anything else that keeps it from being read is a sign-in that could not be used: a link, a
 *   folder, a file too large or not a whole JSON object, a chain that is not BroBot's, or one that
 *   moved. A machine that ran short is said as itself. Codex rewrites its file in place, so a read
 *   that meets it half-written is tried again first.
 *
 * `between` is called between the look and the open, for a test to act in. ⚠️ Windows has no
 * `O_NOFOLLOW`, so its open follows a link put at the path: there the path is looked at again once
 * the file is open, and must still be that very regular file.
 */
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
  // Resolving it tells a file that is not there from one that cannot be read; whether it stays
  // inside the managed root is the pin's to judge.
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
        // Not whole yet: read again below.
      }
      if (attempt === 3) throw unusable('could not be read whole')
    }
  } finally {
    ancestry.release()
  }
}

/**
 * The sign-in a first start copies: the computer's own, else BroBot's own where the computer has
 * none and a fallback is named. A computer's sign-in that is missing with no fallback to copy
 * fails as the read failed.
 */
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
  // Serialize concurrent provisioning/auth writes for this home (027 P1-H).
  // ⚠️ `async` since 243: the copy is the same synchronous sequence it always was, and only the
  // WAIT for another process's copy stopped blocking the thread. See `withProviderHomeLock`.
  await withProviderHomeLock(
    providerHome,
    () => {
      ancestry?.verify()
      const dest = join(providerHome, CODEX_AUTH_FILE)

      // Copy exactly once: never clobber a possibly-refreshed profile credential, and
      // require the existing dest to be a private REGULAR file (reject symlink/non-file).
      const destStat = lstatOrNull(dest)
      if (destStat) {
        if (destStat.isSymbolicLink()) {
          throw new AuthUnavailableError(
            'codex',
            `profile auth.json is a symlink (tampered): ${dest}`,
          )
        }
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
        // Read the CONTENT; the profile is never symlinked to it.
        data = theSignInToCopy(source, fallback)
      } catch (error) {
        // BroBot's own sign-in was there and could not be used: said as it came.
        if (error instanceof AuthUnavailableError) throw error
        // A file that is not there, and no sign-in of BroBot's own to copy instead, is a computer
        // with no Codex sign-in; one that is there and could not be read is a sign-in that could
        // not be used, which the lines below say.
        if (isRecord(error) && error['code'] === 'ENOENT') {
          throw new NoCodexSignInOnThisComputerError(
            `personal Codex auth.json not found at ${source}` +
              (fallback === undefined ? '' : `, and BroBot's own has none at ${fallback.path}`),
          )
        }
        // 🔴 **710 · R52 — a machine that ran short did not lose a credential.** ⛔ Until `710` an
        // `EMFILE` here told a person *"personal Codex auth.json not found at <home>"* — a sign-in to
        // fix, with a path in it, about a file that was there. ⚑ Thrown as it came, for the door
        // that asked to say in its own words — the doors {@link defaultKeychainReader}'s note lists.
        if (transientSetupFailureOf(error) !== null) throw error
        throw new AuthUnavailableError('codex', `personal Codex auth.json not found at ${source}`)
      }

      // Unique, unguessable temp created with O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW: a
      // pre-existing temp OR a symlink at that path makes the create FAIL (ELOOP/EEXIST)
      // instead of redirecting the credential bytes to another file.
      const tmp = join(providerHome, `.auth.json.tmp-${randomBytes(12).toString('hex')}`)
      const flags =
        fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW
      // ⛔ **Immediately before the bytes exist anywhere**, not only before the lock (293 §1). This
      // is the last instruction that can still refuse; after it a credential is on some disk.
      ancestry?.verify()
      const fd = openSync(tmp, flags, 0o600)
      try {
        writeSync(fd, data)
        // No-clobber atomic install: hard-link the temp to the dest; `link` fails EEXIST
        // if a dest appeared concurrently rather than overwriting it.
        linkSync(tmp, dest)
      } finally {
        closeSync(fd)
        rmSync(tmp, { force: true }) // dest keeps the inode alive
      }
      chmodSync(dest, 0o600) // pin 0600 regardless of umask
      // On Windows a mode is only a read-only flag: there the file is kept to its owner by the
      // access list it inherits from the person's own profile folder.
    },
    { verify: ancestry?.verify },
  )
}

/** Where a fresh copy of a Codex sign-in may come from: this computer's own, or BroBot's own. */
export type CodexCopySource = 'the-computers' | 'brobots-own'

/** One place a fresh copy may be read from; BroBot's own is read as {@link fallbackSignIn} reads it. */
export type CodexCopyCandidate =
  | { readonly from: 'the-computers'; readonly sourceAuthPath: string }
  | { readonly from: 'brobots-own'; readonly fallback: Fallback }

/**
 * Replace a profile's Codex sign-in that Codex has just refused with a fresh copy of the same
 * account, from whichever candidate Codex refreshed last. Under the profile home's lock, and only
 * when all of this holds: the home holds a regular file naming an account; the candidate names that
 * same account; and Codex refreshed the candidate later than the copy, by the date each file
 * carries. So a copy that is as new as its sources is never replaced, the same bytes are never
 * copied again, and one replacement leaves nothing later to replace it with again. A home on an API key, on another
 * account, or whose account or date cannot be read is left as it is, and a candidate that cannot be
 * read, or names no date, is not used. Of a file, only its account and that date are read.
 * ⚑ And only the copy that was refused: `refused` says which it was, and a copy on disk that is no
 * longer that file, unchanged, is left as it is.
 */
export async function replaceARefusedCodexCopy(
  providerHome: string,
  opts: {
    managedRoot: string
    candidates: readonly CodexCopyCandidate[]
    /** The copy Codex refused, as it stood then. A copy that is no longer that one is left alone. */
    refused: CodexCopyIdentity
    /**
     * Whether whoever asked still wants this: asked under the lock, which may have been waited
     * for. A conversation stopped, or an app closing, meanwhile replaces nothing.
     */
    stillWanted: () => boolean
  },
): Promise<CodexCopySource | 'not-tried'> {
  const ancestry = trustProviderHomeAncestry(opts.managedRoot, providerHome, { includeLeaf: true })
  try {
    return await withProviderHomeLock(
      providerHome,
      () => {
        // ⛔ First, before the copy or any candidate is read: the wait for this lock may have
        // outlasted the conversation or the launch that asked.
        if (!opts.stillWanted()) return 'not-tried'
        ancestry.verify()
        const dest = join(providerHome, CODEX_AUTH_FILE)
        const held = exactLstatOrNull(dest)
        if (held === null || !held.isFile() || held.size > BigInt(CODEX_AUTH_FILE_MAX)) {
          return 'not-tried'
        }
        // ⛔ Only the copy that was refused. Codex has renewed this one in place since, or
        // something else has replaced it: it is not the refused copy any more, and may work.
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
          chmodSync(tmp, 0o600)
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

/** A profile home's copy of a Codex sign-in as it stands now, by what tells it apart; null where it holds none. */
export function codexCopyIdentityIn(providerHome: string): CodexCopyIdentity | null {
  const held = exactLstatOrNull(join(providerHome, CODEX_AUTH_FILE))
  if (held === null || !held.isFile()) return null
  return { dev: held.dev, ino: held.ino, size: held.size, mtimeNs: held.mtimeNs }
}

/** Whether two looks at a home found the same copy, unchanged; never where either found none. */
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

/** What a re-provision did. `unchanged` means the profile already held those exact bytes. */
export type ReprovisionOutcome = 'replaced' | 'unchanged'

/**
 * Copy the personal Codex `auth.json` into the profile home **again**, replacing what is there
 * (098) — the one sanctioned writer over a credential {@link provisionCodexAuth} refuses to touch.
 *
 * ## Why this is a second function and not a flag on the first
 *
 * `provisionCodexAuth`'s copy-once rule is correct and stays exactly as it was. It runs on **every**
 * session launch, and an overwrite there would clobber a profile credential that had refreshed
 * independently — silently, on a schedule, for the whole life of the app. That is the stomp the rule
 * exists to prevent, and a parameter that switched it off would put the stomp one careless call site
 * away.
 *
 * What the rule did not anticipate is that a copy can go **stale**, and then nothing could ever
 * replace it: the app had no way back short of deleting a file by hand. So the overwrite lives here,
 * in a function whose only caller is a person pressing a button. Automatic callers get the safe one;
 * this one is reachable only by asking for it by name.
 *
 * ⚠️ **This does not end the sharing.** The copy and `~/.codex` hold one rotating refresh token
 * between them, so the next refresh by either side breaks the other again — see `codex-login.ts` for
 * the measurement and for the remedy that does end it. Any surface offering this must say so.
 *
 * Everything else is {@link provisionCodexAuth}'s: the per-home lock, `0600`, content-not-symlink,
 * a temp created `O_EXCL|O_NOFOLLOW`, and a refusal if the destination has been replaced by a
 * symlink or a directory. Only the final install differs — `rename` (which replaces atomically)
 * where the first uses `link` (which refuses to).
 */
export async function reprovisionCodexAuth(
  providerHome: string,
  opts: { sourceAuthPath?: string } = {},
): Promise<ReprovisionOutcome> {
  const source = opts.sourceAuthPath ?? personalCodexAuthPath()
  return await withProviderHomeLock(providerHome, () => {
    const dest = join(providerHome, CODEX_AUTH_FILE)

    // The same fail-closed checks the copy-once path makes about an existing destination. A symlink
    // or a directory here is tampering, and `rename` would happily follow or fail confusingly; both
    // deserve the explicit error rather than a surprise.
    const destStat = lstatOrNull(dest)
    if (destStat?.isSymbolicLink()) {
      throw new AuthUnavailableError('codex', `profile auth.json is a symlink (tampered): ${dest}`)
    }
    if (destStat && !destStat.isFile()) {
      throw new AuthUnavailableError('codex', `profile auth.json is not a regular file: ${dest}`)
    }

    let data: Buffer
    try {
      data = readFileSync(source) // the CONTENT, never a symlink to it
    } catch (error) {
      // 🔴 **716 · `710` F-4 — the launch copy's rethrow, on the re-copy** (R52's class). ⛔ Until
      // `716` a machine that ran short told a person *"personal Codex auth.json not found … sign in
      // with the codex CLI first"* — a sign-in to redo, about a file that was there. ⚑ Thrown as it
      // came; `RuntimeHost.reprovisionProviderAuth` says it in a person's words, by the code.
      if (transientSetupFailureOf(error) !== null) throw error
      throw new AuthUnavailableError(
        'codex',
        `personal Codex auth.json not found at ${source} — sign in with the codex CLI first, then try again`,
      )
    }

    // Report honestly when there was nothing to do. A surface that says "re-copied" over identical
    // bytes teaches the user that the button does nothing, which is worse than saying so.
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
        closeSync(fd) // closed on the throwing path too — no descriptor outlives this block
      }
      chmodSync(tmp, 0o600) // pin the mode BEFORE it becomes the destination, regardless of umask
      // On Windows a mode is only a read-only flag: there the file is kept to its owner by the
      // access list it inherits from the person's own profile folder.
      renameSync(tmp, dest) // atomic REPLACE — the one difference from the copy-once path
    } catch (error) {
      rmSync(tmp, { force: true }) // a failed install leaves no half-written credential behind
      throw error
    }
    return 'replaced'
  })
}

/** Read a file, or null if it cannot be read — used only to detect a no-op re-copy. */
function readOrNull(path: string): Buffer | null {
  try {
    return readFileSync(path)
  } catch {
    return null
  }
}

/**
 * Codex auth-health: ok iff a managed `auth.json` exists, is a REGULAR file (not a dir/symlink), and
 * is 0600. ⚑ **F072 — the mode only where a file has one**: Windows reports every writable file as
 * `0666` whatever its access list says, so there the file's place under the person's own profile is
 * its protection, and the mode is not asked.
 */
export function codexAuthHealth(
  providerHome: string,
  platform: NodeJS.Platform = process.platform,
): AuthHealth {
  const dest = join(providerHome, CODEX_AUTH_FILE)
  const stat = lstatOrNull(dest)
  if (!stat) return { ok: false, reason: `no managed Codex auth.json in ${providerHome}` }
  if (stat.isSymbolicLink()) return { ok: false, reason: `Codex auth.json is a symlink (tampered)` }
  if (!stat.isFile())
    return { ok: false, reason: `Codex auth.json is not a regular file (e.g. a directory)` }
  const mode = stat.mode & 0o777
  if (platform !== 'win32' && mode !== 0o600)
    return { ok: false, reason: `Codex auth.json mode ${mode.toString(8)} != 0600` }
  return { ok: true }
}

/** A Codex login file larger than this is not read for its account. */
const CODEX_AUTH_FILE_MAX = 1024 * 1024

/**
 * **The account a Codex home is signed in to**, as a one-way name: its `auth.json`'s
 * `tokens.account_id`, or the one name `api-key` for a home logged in with a key. Never a token:
 * Codex renewing its own tokens on the same account keeps the same name. `null` when there is no
 * login to read, or none whole (a write under way): that is *cannot tell*, never a change.
 */
export async function codexAccountIn(providerHome: string): Promise<string | null> {
  try {
    const file = join(providerHome, CODEX_AUTH_FILE)
    // ⛔ Only a regular file: a link or a pipe in a home is not read.
    const found = await lstat(file)
    if (!found.isFile() || found.size > CODEX_AUTH_FILE_MAX) return null
    return codexAccountOf(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

/** {@link codexAccountIn}, read at once: for a launch, just before its app-server is spawned. */
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

/** The account a Codex `auth.json`'s text names, by the kind of login Codex's own `auth_mode` says. */
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

/**
 * When Codex last refreshed the sign-in a Codex `auth.json`'s text holds, by the `last_refresh`
 * date Codex writes beside the tokens at a sign-in and at every renewal. Null when the file names
 * none. ⚑ Not the file's own date on disk, which for a copy is when it was copied.
 */
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

/** The `sqlite_home` key as a REAL TOML parser resolves it, whatever spelling the file used. */
const SQLITE_HOME_KEY = 'sqlite_home'

/** A thrown value as text, for a fail-closed diagnostic. */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Every `sqlite_home` value declared anywhere in a parsed `config.toml`, with the dotted path it
 * was found at (048, fixing 044 P1-H).
 *
 * Deliberately conservative: a `sqlite_home` under ANY table still counts. The managed home's
 * config is app-owned, so a stray occurrence is worth attesting rather than assuming a scope that
 * would let state escape. Values are collected as `unknown` so a non-string (the key present but
 * not a path) fails closed at the caller instead of being coerced.
 */
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

/**
 * Attest that the profile home won't redirect Codex SQLite state OUT of the home (048, fixing
 * 044 P1-H; from 041 / 027 / 023 §6). We pin `CODEX_SQLITE_HOME=<providerHome>` in the spawn env,
 * but the official Codex config schema lets a `config.toml` `sqlite_home` override it.
 *
 * **Parsed with a real TOML parser.** The previous hand-rolled line scanner stripped surrounding
 * quotes but did not decode basic-string ESCAPES, so `"sqlite_home"` — which a conformant
 * parser resolves to `sqlite_home` — slipped past attestation, and the real Codex CLI then wrote
 * its SQLite state outside the managed home. TOML has too many equivalent spellings (bare,
 * `"quoted"`, `'literal'`, escaped, dotted, table-scoped) for a scanner to chase one at a time;
 * parsing gives us the same key resolution the provider itself performs.
 *
 * **Called BEFORE the transport spawns** (see `CodexRuntime.start`/`resume`, plus a re-check
 * before the first `initialize`) — a rejected declaration must never launch the app-server.
 *
 * Fails closed on: a malformed config (parse error — including TOML's own duplicate-key error),
 * more than one declaration anywhere in the document, a non-string or empty value, and a path
 * that is not contained in the home. Containment is checked on the **REAL** path (symlinks
 * resolved), because `sqlite_home = "inside-link"` is lexically inside the home while
 * `inside-link` may symlink anywhere.
 *
 * ⛔ **…and on a path that cannot be canonicalized at all** (183, from 182 H1). This function held
 * a SECOND COPY of the climb that finding was written about, with the same hole:
 * `sqlite_home = "bait"` where `<home>/bait` links to a file that is not there yet threw from
 * `realpathSync` exactly like a directory nobody had created, so it canonicalized back to
 * `<realHome>/bait`, passed containment, and let the real Codex CLI write its SQLite state through
 * the link. ⚑ **§2's caller audit is what surfaced it** — fixing the reported instance and leaving
 * its twin is how 170 came to fix three repros and leave the class open. One implementation now:
 * {@link realResolve}.
 */
export function assertCodexSqliteHomeContained(providerHome: string): void {
  const configPath = join(providerHome, 'config.toml')
  let content: string
  try {
    content = readFileSync(configPath, 'utf8')
  } catch {
    return // no config → nothing can redirect
  }

  let parsed: unknown
  try {
    parsed = parseToml(content)
  } catch (error) {
    // A config we cannot parse is a config we cannot attest — never launch on a guess.
    throw new CodexSettingsUnusableError(
      `profile config.toml could not be parsed, so sqlite_home cannot be attested (failing closed): ${errorText(error)}`,
    )
  }

  const declarations = collectSqliteHomeDeclarations(parsed)
  if (declarations.length === 0) return // no override → nothing can redirect
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
  // Canonicalize BOTH sides: a symlinked home must compare against its own real path too.
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

/** `lstat` or null (path missing) — never throws for a missing path. */
function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path)
  } catch {
    return null
  }
}
