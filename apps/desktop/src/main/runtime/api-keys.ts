import { claudeCredentialsFileReader, parseClaudeOAuthToken } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import type { ApiKeyCheck, ApiKeyStatus } from '../../shared/runtime-ipc'
import type { SessionStore } from '../db/session-store'

/**
 * 🔒 **The API keys a person enters in BroBot, one per provider, kept sealed.**
 *
 * A key is the supported way to run a provider's agents; with none set, the provider runs on its
 * machine login, as before. This module is the one place a key is opened:
 *
 * - **Kept sealed.** {@link set} seals the key with a {@link KeyCipher} — Electron's `safeStorage` in
 *   the app, which on macOS encrypts with a key the system Keychain holds for this app — and the
 *   database keeps only that ciphertext (`provider_api_key`).
 * - **Opened only for a launch.** {@link read} is what a launch's key provider calls, every launch,
 *   so a key replaced or removed applies to the next one. Nothing hands a key back to the window:
 *   {@link status} says only whether one is set.
 * - **Never in a message.** No refusal, error or log line here carries the key, or any part of it.
 */

/** Seals and opens a key. `safeStorage` in the app; a stand-in in tests. */
export interface KeyCipher {
  /** Whether keys can be sealed on this machine right now. */
  available(): boolean | Promise<boolean>
  /** The key, sealed, as base64. */
  seal(key: string): string | Promise<string>
  /**
   * A sealed key, opened. Throws when it cannot be: {@link KeyStorageNotAnswering} when the
   * system's key storage gave no sealing key, {@link SealedWithAnotherKey} when it gave one and
   * the key still did not open.
   */
  open(sealed: string): string | Promise<string>
}

/**
 * The system's key storage is not handing over its sealing key now: on a Mac, the Keychain is
 * asking a person, or was refused. A later read may work.
 */
export class KeyStorageNotAnswering extends Error {}

/**
 * The key storage handed over its sealing key and the saved key still did not open: it was sealed
 * with another one. On a Mac that is another Keychain entry: the one that sealed it was deleted,
 * is another Mac's, or was made under another name of the app. Only saving the key again mends it.
 */
export class SealedWithAnotherKey extends Error {}

/** Why a saved key did not open, as far as this app can tell. */
export type WhyUnreadable = 'storage-not-answering' | 'sealed-with-another-key' | 'not-known'

/** The longest key accepted: well past any provider's, short of anything that is not a key. */
export const API_KEY_MAX_LENGTH = 512

/** What each provider's card on the Providers screen is headed — the words the window uses. */
export const PROVIDER_CARD: Readonly<Record<Provider, string>> = {
  claude: 'Claude',
  codex: 'Codex',
}

/**
 * Whether a key check sends one one-token request after the free model list, to learn whether the
 * key's account can pay. Anthropic's list is answered for a key with no credit, so Claude's does.
 */
const A_KEY_CHECK_SPENDS_A_TOKEN: Readonly<Record<Provider, boolean>> = {
  claude: true,
  codex: false,
}

/** Who answers for each provider's keys — named in a check's words. */
const KEY_ISSUER: Readonly<Record<Provider, string>> = {
  claude: 'Anthropic',
  codex: 'OpenAI',
}

/**
 * A saved key that cannot be opened now — the Keychain is asking or was refused, or the entry that
 * sealed it is gone or another one. Its words say which, where this app can tell
 * ({@link WhyUnreadable}). ⛔ A launch refuses rather than falling back to the login, which the
 * person did not ask for when they set a key.
 */
export class ApiKeyUnreadableError extends Error {
  readonly provider: Provider

  constructor(
    provider: Provider,
    platform: NodeJS.Platform = process.platform,
    why: WhyUnreadable = 'not-known',
  ) {
    const card = PROVIDER_CARD[provider]
    super(
      `BroCrew can’t read the API key saved for ${card} on this computer. ` +
        (platform === 'darwin' ? SAID_ON_A_MAC[why] : '') +
        `Save it again under “API key” ` +
        `on the ${card} card in Providers, or remove it there to use your sign-in instead.`,
    )
    this.name = 'ApiKeyUnreadableError'
    this.provider = provider
  }
}

/** What a Mac adds to the refusal, by why the key did not open: only what is true of that case. */
const SAID_ON_A_MAC: Readonly<Record<WhyUnreadable, string>> = {
  'storage-not-answering': 'macOS may be waiting for permission to read its saved key. ',
  'sealed-with-another-key':
    'It was saved with a Keychain entry this version of BroCrew doesn’t have. ',
  'not-known': '',
}

/** Why a read failed, from what it threw. */
function whyUnreadable(cause: unknown): WhyUnreadable {
  if (cause instanceof KeyStorageNotAnswering) return 'storage-not-answering'
  return cause instanceof SealedWithAnotherKey ? 'sealed-with-another-key' : 'not-known'
}

/**
 * Why a key was not kept, in words a person can act on, or `null` when it is fine. ⛔ It never
 * quotes the key.
 */
export function whyNotAKey(key: string): string | null {
  if (key.trim() === '') return 'Enter the key, or remove the one that is saved.'
  if (/\s/.test(key.trim())) {
    return 'An API key has no spaces or line breaks. Paste it exactly as your provider shows it.'
  }
  // ⚑ Printable ASCII: every provider's keys are, and a key with anything else would reach the
  // provider altered and be refused there, with nothing to say why.
  if (key.trim().length > API_KEY_MAX_LENGTH || !/^[\x21-\x7e]+$/.test(key.trim())) {
    return 'That does not look like an API key. Paste it exactly as your provider shows it.'
  }
  return null
}

/** How long BroBot waits for encryption or decryption before offering recovery. */
export const KEY_STORAGE_TIMEOUT_MS = 15_000

type OpenKey = { readonly key: string; readonly setAt: number }
type ReadState = { sealed: string; setAt: number; unreadableReason?: string }

export class ApiKeys {
  private readonly readability = new Map<Provider, ReadState>()
  private readonly changes = new Map<Provider, number>()
  private readonly lastSavedAt = new Map<Provider, number>()
  private readonly operations = new Map<Provider, Promise<unknown>>()
  private readonly reads = new Map<
    Provider,
    { sealed: string; setAt: number; work: Promise<OpenKey> }
  >()

  constructor(
    private readonly store: Pick<SessionStore, 'keptApiKey' | 'keepSealedApiKey' | 'forgetApiKey'>,
    private readonly cipher: KeyCipher,
    private readonly clock: () => number = Date.now,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  /** Status never opens a key or initializes the system's encryption service. */
  status(provider: Provider): ApiKeyStatus {
    const kept = this.store.keptApiKey(provider)
    const spends = A_KEY_CHECK_SPENDS_A_TOKEN[provider] ? { aCheckSpendsAToken: true as const } : {}
    if (kept === null) return { provider, set: false, setAt: null, inUse: false, ...spends }
    const read = this.readability.get(provider)
    const known = read?.sealed === kept.sealed && read.setAt === kept.setAt ? read : undefined
    return {
      provider,
      set: true,
      setAt: kept.setAt,
      inUse: known !== undefined && known.unreadableReason === undefined,
      ...(known === undefined ? { readState: 'not-checked' as const } : {}),
      ...(known?.unreadableReason === undefined
        ? {}
        : { readState: 'unreadable' as const, unreadableReason: known.unreadableReason }),
      ...spends,
    }
  }

  async read(provider: Provider): Promise<string | null> {
    return (await this.current(provider))?.key ?? null
  }

  revision(provider: Provider): number {
    return this.changes.get(provider) ?? 0
  }

  /** Concurrent launches share one read; only readability, never the key, is cached. */
  current(provider: Provider): Promise<OpenKey | null> {
    const kept = this.store.keptApiKey(provider)
    if (kept === null) return Promise.resolve(null)
    const reading = this.reads.get(provider)
    if (reading?.sealed === kept.sealed && reading.setAt === kept.setAt) return reading.work
    const change = this.changes.get(provider)
    const work = (async (): Promise<OpenKey> => {
      try {
        const key = await this.bounded(provider, () => this.cipher.open(kept.sealed))
        if (!key || !this.stillCurrent(provider, kept, change)) throw new Error('key changed')
        // The seal carries no check of its own: a wrong sealing key can open to garbage. What
        // opened is held to the rule every saved key passed.
        if (whyNotAKey(key) !== null) throw new SealedWithAnotherKey()
        this.readability.set(provider, kept)
        return { key, setAt: kept.setAt }
      } catch (cause) {
        const error = new ApiKeyUnreadableError(provider, this.platform, whyUnreadable(cause))
        if (this.stillCurrent(provider, kept, change))
          this.readability.set(provider, { ...kept, unreadableReason: error.message })
        throw error
      }
    })()
    this.reads.set(provider, { ...kept, work })
    const release = (): void => {
      if (this.reads.get(provider)?.work === work) this.reads.delete(provider)
    }
    void work.then(release, release)
    return work
  }

  async set(provider: Provider, key: string): Promise<string | null> {
    const why = whyNotAKey(key)
    if (why !== null) return why
    if (this.operations.has(provider)) return this.saveRefusal()
    const change = (this.changes.get(provider) ?? 0) + 1
    this.changes.set(provider, change)
    this.reads.delete(provider)
    try {
      const sealed = await this.bounded(provider, async (signal) => {
        if (!(await this.cipher.available()) || signal.aborted)
          throw new Error('encryption unavailable')
        return await this.cipher.seal(key.trim())
      })
      if (this.changes.get(provider) !== change)
        return 'The saved key changed while this save was waiting. Try again.'
      const previous = Math.max(
        this.lastSavedAt.get(provider) ?? -1,
        this.store.keptApiKey(provider)?.setAt ?? -1,
      )
      const setAt = Math.max(this.clock(), previous + 1)
      this.store.keepSealedApiKey(provider, sealed, setAt)
      this.lastSavedAt.set(provider, setAt)
      this.readability.set(provider, { sealed, setAt })
      return null
    } catch {
      return this.saveRefusal()
    }
  }

  private saveRefusal(): string {
    return (
      'BroCrew could not encrypt the key, so it was not saved. ' +
      (this.platform === 'darwin'
        ? 'macOS may be waiting for permission to use its saved key. '
        : '') +
      'Re-enter the key under “API key” in Providers and try again.'
    )
  }

  remove(provider: Provider): boolean {
    const setAt = this.store.keptApiKey(provider)?.setAt
    if (setAt !== undefined) this.lastSavedAt.set(provider, setAt)
    this.changes.set(provider, (this.changes.get(provider) ?? 0) + 1)
    this.readability.delete(provider)
    this.reads.delete(provider)
    return this.store.forgetApiKey(provider)
  }

  private stillCurrent(provider: Provider, kept: ReadState, change: number | undefined): boolean {
    const now = this.store.keptApiKey(provider)
    return (
      this.changes.get(provider) === change &&
      now?.sealed === kept.sealed &&
      now.setAt === kept.setAt
    )
  }

  private async bounded<T>(
    provider: Provider,
    action: (signal: AbortSignal) => T | Promise<T>,
  ): Promise<T> {
    // A deadline releases BroBot, not the native operation. Keep its slot until it really settles.
    if (this.operations.has(provider)) throw new KeyStorageNotAnswering('still waiting')
    const cancelled = new AbortController()
    const native = Promise.resolve().then(() => action(cancelled.signal))
    this.operations.set(provider, native)
    const release = (): void => {
      if (this.operations.get(provider) === native) this.operations.delete(provider)
    }
    void native.then(release, release)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        native,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new KeyStorageNotAnswering('timed out')),
            KEY_STORAGE_TIMEOUT_MS,
          )
        }),
      ])
    } finally {
      cancelled.abort()
      clearTimeout(timer)
    }
  }
}

/**
 * Whether removing a provider's key leaves a login it runs on here, for the words a refused key is
 * said with. Codex has its own sign-in on either platform. Claude runs on the person's own Claude
 * Code login: on a Mac it is not read for this; on Windows its file is, and an expired one counts,
 * since a start renews it. Linux, where the tests run, answers as a Mac does.
 */
export function aLoginRunsWithoutAKey(
  provider: Provider,
  platform: NodeJS.Platform = process.platform,
  readClaudeLogin: () => string | null = () => claudeCredentialsFileReader()(),
): boolean {
  if (provider === 'codex' || platform !== 'win32') return true
  try {
    return parseClaudeOAuthToken(readClaudeLogin(), 0) !== null
  } catch {
    return false
  }
}

/** How long a check waits for the provider before it says it could not reach it. */
export const KEY_CHECK_TIMEOUT_MS = 15_000

/** Where a check asks first — each provider's free, authenticated list of models. */
const KEY_CHECK_URL: Readonly<Record<Provider, string>> = {
  claude: 'https://api.anthropic.com/v1/models?limit=100',
  codex: 'https://api.openai.com/v1/models',
}

/** Where a Claude check sends its one-token request, to learn whether the key's account can pay. */
const CLAUDE_MESSAGES_URL = 'https://api.anthropic.com/v1/messages'

/**
 * The model a Claude check spends its one token on: the newest Haiku in the provider's own list,
 * the cheapest family, or else the newest model listed. Read from the list rather than named here,
 * so a retired model is never asked for. `null` when the list names none.
 */
export function theCheapestModel(ids: readonly string[]): string | null {
  return ids.find((id) => id.includes('haiku')) ?? ids[0] ?? null
}

/** The `id`s of an Anthropic model list, newest first as the provider sends them. */
function modelIdsIn(body: unknown): string[] {
  const data = (body as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return []
  return data.flatMap((row) => {
    const id = (row as { id?: unknown } | null)?.id
    return typeof id === 'string' ? [id] : []
  })
}

/**
 * Whether an Anthropic refusal says the key's account can't pay. Its `billing_error` type, or a 402,
 * says so; a request refused for a balance with no credit comes back as a 400
 * `invalid_request_error` whose only sign is its message, so that is read too. Only classified,
 * never shown.
 */
function cannotPay(status: number, body: unknown): boolean {
  const error = (body as { error?: { type?: unknown; message?: unknown } } | null)?.error
  if (status === 402 || error?.type === 'billing_error') return true
  return (
    status === 400 &&
    typeof error?.message === 'string' &&
    error.message.toLowerCase().includes('credit balance')
  )
}

async function bodyOf(answer: Response): Promise<unknown> {
  try {
    return await answer.json()
  } catch {
    return null
  }
}

/**
 * 🔒 Asks the provider whether it accepts a key. Only ever run when a person presses the check.
 *
 * Every provider is asked for its list of models, which spends nothing. Claude is then sent one
 * one-token request on its cheapest listed model, because the list is answered for a key whose
 * account has no credit and only a real request shows that; on a funded key it costs a tiny
 * fraction of a cent.
 *
 * The key goes in one request header and nowhere else. The answer never quotes it, nor anything
 * the provider sent back: a status code and an error's type are what is read.
 */
export async function askTheProvider(
  provider: Provider,
  key: string,
  fetchFor: typeof fetch = fetch,
): Promise<ApiKeyCheck> {
  const issuer = KEY_ISSUER[provider]
  const headers: Record<string, string> =
    provider === 'claude'
      ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
      : { authorization: `Bearer ${key}` }
  const unreachable: ApiKeyCheck = {
    ok: false,
    reason: `BroCrew could not reach ${issuer} to check the key. Check this computer’s connection and try again.`,
  }
  let listed: Response
  try {
    listed = await fetchFor(KEY_CHECK_URL[provider], {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(KEY_CHECK_TIMEOUT_MS),
    })
  } catch {
    return unreachable
  }
  if (!succeeded(listed.status)) return refusedAt(issuer, listed.status)
  if (!A_KEY_CHECK_SPENDS_A_TOKEN[provider]) return { ok: true }
  const model = theCheapestModel(modelIdsIn(await bodyOf(listed)))
  if (model === null) return { ok: true }
  let asked: Response
  try {
    asked = await fetchFor(CLAUDE_MESSAGES_URL, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'Hi' }] }),
      signal: AbortSignal.timeout(KEY_CHECK_TIMEOUT_MS),
    })
  } catch {
    return unreachable
  }
  if (succeeded(asked.status)) return { ok: true, answeredARequest: true }
  if (cannotPay(asked.status, await bodyOf(asked))) {
    return {
      ok: false,
      cannotPay: true,
      reason: `${issuer} knows this key, but the account it belongs to can’t pay for a request. Add credit to that account in the ${issuer} console, or save another key.`,
    }
  }
  if (asked.status === 429) {
    return {
      ok: false,
      reason: `${issuer} accepted the key but is limiting requests on it right now, so the check could not tell whether its account can pay. Try again in a moment.`,
    }
  }
  if (asked.status === 403) {
    return {
      ok: false,
      reason: `${issuer} knows this key but refused the check’s one-token request, so agents may not run on it either. Check its permissions in your ${issuer} account.`,
    }
  }
  return refusedAt(issuer, asked.status)
}

function succeeded(status: number): boolean {
  return status >= 200 && status < 300
}

/** The words for a status that refused the check. */
function refusedAt(issuer: string, status: number): ApiKeyCheck {
  if (status === 401) {
    return {
      ok: false,
      reason: `${issuer} did not accept this key. Check it, or save it again from your ${issuer} account.`,
    }
  }
  if (status === 403) {
    // Known, and refused this one request: a key restricted to fewer permissions answers so, and
    // agents may still run on it. The check cannot tell, and says only that.
    return {
      ok: false,
      reason: `${issuer} knows this key but refused the check’s request, which needs permission to list models. Agents may still run on it; if they do not, check its permissions in your ${issuer} account.`,
    }
  }
  return {
    ok: false,
    reason: `${issuer} answered ${String(status)} when the key was checked. Try again in a moment.`,
  }
}

/**
 * The app's cipher: Electron's `safeStorage`. On macOS it encrypts with a key kept in the system
 * Keychain under this app's name, so the database alone cannot give a key back.
 */
export function safeStorageCipher(safeStorage: {
  isAsyncEncryptionAvailable(): Promise<boolean>
  encryptStringAsync(plainText: string): Promise<Buffer>
  decryptStringAsync(encrypted: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>
}): KeyCipher {
  return {
    available: () => safeStorage.isAsyncEncryptionAvailable(),
    seal: async (key) => (await safeStorage.encryptStringAsync(key)).toString('base64'),
    open: async (sealed) => {
      try {
        return (await safeStorage.decryptStringAsync(Buffer.from(sealed, 'base64'))).result
      } catch (error) {
        throw whyItDidNotOpen(error)
      }
    },
  }
}

/**
 * The two ways Electron's `decryptStringAsync` fails, told apart by its own words (Electron 43.2.0,
 * `shell/browser/api/electron_api_safe_storage.cc`): no sealing key was handed over, or one was and
 * the decryption failed. Anything else is passed on as it came: should Electron reword either,
 * the refusal says neither of the two cases, which is still true, and the upgrade lane's Mac job
 * is where the difference is seen.
 */
const ELECTRON_HAD_NO_SEALING_KEY = 'is temporarily unavailable'
const ELECTRON_COULD_NOT_DECRYPT = 'Error while decrypting the ciphertext'

function whyItDidNotOpen(error: unknown): unknown {
  const said = error instanceof Error ? error.message : ''
  if (said.includes(ELECTRON_HAD_NO_SEALING_KEY)) return new KeyStorageNotAnswering()
  return said.includes(ELECTRON_COULD_NOT_DECRYPT) ? new SealedWithAnotherKey() : error
}
