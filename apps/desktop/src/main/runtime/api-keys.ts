import { ApiKeyUnreadableError, type WhyUnreadable } from '../providers/api-key-error'
export { ApiKeyUnreadableError, PROVIDER_CARD, type WhyUnreadable } from '../providers/api-key-error'
import { providerAuthPolicies } from '../providers/auth-definitions'
import { providerDescriptor, type Provider } from '@brobot2/shared'
import type { ApiKeyCheck, ApiKeyStatus } from '../../shared/runtime-ipc'
import type { SessionStore } from '../db/session-store'

export interface KeyCipher {
  available(): boolean | Promise<boolean>

  seal(key: string): string | Promise<string>

  open(sealed: string): string | Promise<string>
}

export class KeyStorageNotAnswering extends Error {}

export class SealedWithAnotherKey extends Error {}

export const API_KEY_MAX_LENGTH = 512

function whyUnreadable(cause: unknown): WhyUnreadable {
  if (cause instanceof KeyStorageNotAnswering) return 'storage-not-answering'
  return cause instanceof SealedWithAnotherKey ? 'sealed-with-another-key' : 'not-known'
}

export function whyNotAKey(key: string): string | null {
  if (key.trim() === '') return 'Enter the key, or remove the one that is saved.'
  if (/\s/.test(key.trim())) {
    return 'An API key has no spaces or line breaks. Paste it exactly as your provider shows it.'
  }

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
    const spends = providerDescriptor(provider).apiKey.spendsToken
      ? { aCheckSpendsAToken: true as const }
      : {}
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

export function aLoginRunsWithoutAKey(
  provider: Provider,
  platform: NodeJS.Platform = process.platform,
  readClaudeLogin?: () => string | null,
): boolean {
  return providerAuthPolicies[provider].key.loginRunsWithoutAKey(platform, readClaudeLogin)
}

export { KEY_CHECK_TIMEOUT_MS } from '../providers/key-check'
export { theCheapestModel } from '../providers/auth-definitions'

export async function askTheProvider(
  provider: Provider,
  key: string,
  fetchFor: typeof fetch = fetch,
): Promise<ApiKeyCheck> {
  return await providerAuthPolicies[provider].key.check(key, fetchFor)
}

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

const ELECTRON_HAD_NO_SEALING_KEY = 'is temporarily unavailable'
const ELECTRON_COULD_NOT_DECRYPT = 'Error while decrypting the ciphertext'

function whyItDidNotOpen(error: unknown): unknown {
  const said = error instanceof Error ? error.message : ''
  if (said.includes(ELECTRON_HAD_NO_SEALING_KEY)) return new KeyStorageNotAnswering()
  return said.includes(ELECTRON_COULD_NOT_DECRYPT) ? new SealedWithAnotherKey() : error
}
