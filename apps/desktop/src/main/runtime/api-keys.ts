import { copyFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { providerAuthPolicies } from '../providers/index'
import { providerDescriptor, SUPPORTED_PROVIDERS, type Provider } from '@brobot2/shared'
import type { ApiKeyCheck, ApiKeyStatus } from '../../shared/runtime-ipc'
import type { SessionStore } from '../db/session-store'
import { writeAtomically } from '../recovery/files'
import { ApiKeyUnreadableError, SAVED_KEY_UNREADABLE } from '../providers/api-key-error'
export { ApiKeyUnreadableError } from '../providers/api-key-error'

/** Saved API keys, in the clear, readable by the person's own account only. */
export const API_KEYS_FILE = 'api-keys.json'

export const API_KEY_MAX_LENGTH = 512

export function whyNotAKey(key: string): string | null {
  if (key.trim() === '') return 'Enter the key, or remove the one that is saved.'
  if (/\s/.test(key.trim())) {
    return 'Paste the key without spaces or line breaks.'
  }

  if (key.trim().length > API_KEY_MAX_LENGTH || !/^[\x21-\x7e]+$/.test(key.trim())) {
    return 'That does not look like an API key. Paste it exactly as your provider shows it.'
  }
  return null
}

type Entry = { readonly key: string; readonly setAt: number }
type Keys = Partial<Record<Provider, Entry>>
type KeysFile = {
  keys: Keys
  /** Providers whose key was in a file that couldn't be read, until saved again or removed. */
  cantRead?: Provider[]
}

export class ApiKeys {
  private readonly path: string
  private readonly changes = new Map<Provider, number>()
  private readonly lastSetAt = new Map<Provider, number>()
  private writes: Promise<unknown> = Promise.resolve()
  private readonly statuses = new Map<Provider, ApiKeyStatus>()
  private readonly legacy = new Set<Provider>()
  private reading = 0

  private constructor(
    userData: string,
    private readonly clock: () => number = Date.now,
    /** A key an earlier version sealed: it is never opened, and can't be used until saved again. */
    private readonly sealed: Pick<SessionStore, 'hasSealedApiKey' | 'forgetSealedApiKey'> = {
      hasSealedApiKey: () => false,
      forgetSealedApiKey: () => {},
    },
  ) {
    this.path = join(userData, API_KEYS_FILE)
    for (const provider of SUPPORTED_PROVIDERS) {
      if (sealed.hasSealedApiKey(provider)) this.legacy.add(provider)
    }
  }

  static async open(
    userData: string,
    clock: () => number = Date.now,
    sealed?: Pick<SessionStore, 'hasSealedApiKey' | 'forgetSealedApiKey'>,
  ): Promise<ApiKeys> {
    const keys = new ApiKeys(userData, clock, sealed)
    await keys.observe()
    return keys
  }

  /** Event delivery reads metadata only; credential reads and Settings refresh it off-thread. */
  status(provider: Provider): ApiKeyStatus {
    const status = this.statuses.get(provider)!
    return !status.set && this.legacy.has(provider) ? this.unreadable(provider) : { ...status }
  }

  async refreshStatus(provider: Provider): Promise<ApiKeyStatus> {
    const file = await this.observe()
    const status = this.statusOf(provider, file)
    return !status.set && this.legacy.has(provider) ? this.unreadable(provider) : status
  }

  private statusOf(provider: Provider, file: KeysFile | null): ApiKeyStatus {
    const spends = providerDescriptor(provider).apiKey.spendsToken
      ? { aCheckSpendsAToken: true as const }
      : {}
    const entry = file?.keys[provider]
    if (entry !== undefined)
      return { provider, set: true, setAt: entry.setAt, inUse: true, ...spends }
    if (!cantBeUsed(provider, file))
      return { provider, set: false, setAt: null, inUse: false, ...spends }
    return this.unreadable(provider)
  }

  private unreadable(provider: Provider): ApiKeyStatus {
    return {
      provider,
      set: true,
      setAt: null,
      inUse: false,
      readState: 'unreadable',
      unreadableReason: SAVED_KEY_UNREADABLE,
      ...(providerDescriptor(provider).apiKey.spendsToken
        ? { aCheckSpendsAToken: true as const }
        : {}),
    }
  }

  async read(provider: Provider): Promise<string | null> {
    return (await this.current(provider))?.key ?? null
  }

  revision(provider: Provider): number {
    return this.changes.get(provider) ?? 0
  }

  /** Read the current credential without blocking the app's event loop. */
  async current(provider: Provider): Promise<Entry | null> {
    const file = await this.observe()
    const entry = file?.keys[provider]
    if (entry !== undefined) return entry
    if (this.cantBeUsed(provider, file)) throw new ApiKeyUnreadableError(provider)
    return null
  }

  async set(provider: Provider, key: string): Promise<string | null> {
    const why = whyNotAKey(key)
    if (why !== null) return why
    this.changed(provider)
    try {
      await this.change((file) => {
        const previous = Math.max(
          this.lastSetAt.get(provider) ?? -1,
          file.keys[provider]?.setAt ?? -1,
        )
        const setAt = Math.max(this.clock(), previous + 1)
        file.keys[provider] = { key: key.trim(), setAt }
        file.cantRead = file.cantRead?.filter((one) => one !== provider)
        this.lastSetAt.set(provider, setAt)
        return true
      })
    } catch {
      return "Couldn't save the key. Try again."
    }
    this.sealed.forgetSealedApiKey(provider)
    this.legacy.delete(provider)
    return null
  }

  async remove(provider: Provider): Promise<boolean> {
    this.changed(provider)
    let had = this.legacy.has(provider)
    await this.change((file) => {
      const setAt = file.keys[provider]?.setAt
      if (setAt === undefined && !file.cantRead?.includes(provider)) return false
      if (setAt !== undefined) this.lastSetAt.set(provider, setAt)
      delete file.keys[provider]
      file.cantRead = file.cantRead?.filter((one) => one !== provider)
      had = true
      return true
    })
    this.sealed.forgetSealedApiKey(provider)
    this.legacy.delete(provider)
    return had
  }

  private cantBeUsed(provider: Provider, file: KeysFile | null): boolean {
    return cantBeUsed(provider, file) || this.legacy.has(provider)
  }

  private changed(provider: Provider): void {
    this.changes.set(provider, this.revision(provider) + 1)
  }

  /** `null` when the file exists and can't be read; a missing file holds no keys. */
  private async file(): Promise<KeysFile | null> {
    let text: string
    try {
      text = await readFile(this.path, 'utf8')
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { keys: {} } : null
    }
    try {
      return keysFileOf(JSON.parse(text))
    } catch {
      return null
    }
  }

  private remember(file: KeysFile | null): void {
    for (const provider of SUPPORTED_PROVIDERS)
      this.statuses.set(provider, this.statusOf(provider, file))
  }

  private async observe(): Promise<KeysFile | null> {
    const reading = ++this.reading
    const writes = this.writes
    await writes
    const file = await this.file()
    // A later read or a durable mutation owns the projection, never a superseded observation.
    if (reading === this.reading && writes === this.writes) this.remember(file)
    return file
  }

  /**
   * Every change to the file goes through one queue, so two providers' writes never drop each
   * other's key. An unreadable file is copied aside, never overwritten unseen.
   */
  private change(edit: (file: KeysFile) => boolean): Promise<void> {
    const work = this.writes.then(async () => {
      const read = await this.file()
      const file: KeysFile =
        read === null
          ? { keys: {}, cantRead: [...SUPPORTED_PROVIDERS] }
          : { ...read, keys: { ...read.keys } }
      if (!edit(file)) {
        this.reading++
        this.remember(read)
        return
      }
      // Copied, not moved: if the write fails the unreadable file still stands and still refuses.
      if (read === null) await copyFile(this.path, `${this.path}.unreadable-${this.clock()}`)
      if (file.cantRead?.length === 0) delete file.cantRead
      await writeAtomically(this.path, `${JSON.stringify({ version: 1, ...file }, null, 2)}\n`)
      this.reading++
      this.remember(file)
    })
    this.writes = work.catch(() => undefined)
    return work
  }
}

/** Saved, but in a file that couldn't be read. */
function cantBeUsed(provider: Provider, file: KeysFile | null): boolean {
  return file === null || file.cantRead?.includes(provider) === true
}

function keysFileOf(parsed: unknown): KeysFile {
  const { keys, cantRead } = parsed as Record<string, unknown>
  if (typeof keys !== 'object' || keys === null) throw new Error('no keys')
  const read: Keys = {}
  for (const provider of SUPPORTED_PROVIDERS) {
    const entry = (keys as Record<string, unknown>)[provider] as Partial<Entry> | undefined
    if (entry === undefined) continue
    if (typeof entry.key !== 'string' || entry.key === '') throw new Error('no key')
    if (typeof entry.setAt !== 'number') throw new Error('bad time')
    read[provider] = { key: entry.key, setAt: entry.setAt }
  }
  const unread = Array.isArray(cantRead)
    ? SUPPORTED_PROVIDERS.filter((provider) => cantRead.includes(provider))
    : []
  return { keys: read, ...(unread.length > 0 ? { cantRead: unread } : {}) }
}

export function aLoginRunsWithoutAKey(
  provider: Provider,
  platform: NodeJS.Platform = process.platform,
  readClaudeLogin?: () => string | null,
): boolean {
  return providerAuthPolicies[provider].key.loginRunsWithoutAKey(platform, readClaudeLogin)
}

export { KEY_CHECK_TIMEOUT_MS } from '../providers/key-check'
export { theCheapestModel } from '../providers/index'

export async function askTheProvider(
  provider: Provider,
  key: string,
  fetchFor: typeof fetch = fetch,
): Promise<ApiKeyCheck> {
  return await providerAuthPolicies[provider].key.check(key, fetchFor)
}
