import { readFileSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { providerAuthPolicies } from '../providers/auth-definitions'
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
    return 'An API key has no spaces or line breaks. Paste it exactly as your provider shows it.'
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
  earlierKeysMoved?: true
}

/** The sealed keys an earlier version kept in the database, read only to move them. */
export type EarlierKeys = Pick<SessionStore, 'earlierApiKey' | 'forgetEarlierApiKey'>

export class ApiKeys {
  private readonly path: string
  private readonly changes = new Map<Provider, number>()
  private readonly lastSetAt = new Map<Provider, number>()
  private writes: Promise<unknown> = Promise.resolve()

  constructor(
    userData: string,
    private readonly earlier: EarlierKeys,
    private readonly clock: () => number = Date.now,
  ) {
    this.path = join(userData, API_KEYS_FILE)
  }

  status(provider: Provider): ApiKeyStatus {
    const spends = providerDescriptor(provider).apiKey.spendsToken
      ? { aCheckSpendsAToken: true as const }
      : {}
    const file = this.file()
    const entry = file?.keys[provider]
    if (entry !== undefined)
      return { provider, set: true, setAt: entry.setAt, inUse: true, ...spends }
    if (!this.cantBeUsed(provider, file))
      return { provider, set: false, setAt: null, inUse: false, ...spends }
    return {
      provider,
      set: true,
      setAt: this.earlier.earlierApiKey(provider)?.setAt ?? null,
      inUse: false,
      readState: 'unreadable',
      unreadableReason: SAVED_KEY_UNREADABLE,
      ...spends,
    }
  }

  async read(provider: Provider): Promise<string | null> {
    return (await this.current(provider))?.key ?? null
  }

  revision(provider: Provider): number {
    return this.changes.get(provider) ?? 0
  }

  /** Never waits: a key that is saved but can't be used refuses at once. */
  async current(provider: Provider): Promise<Entry | null> {
    const file = this.file()
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
        this.noEarlierKeysLeft(provider, file)
        return true
      })
    } catch {
      return 'BroCrew couldn’t write the key to its data folder, so it was not saved. Try again.'
    }
    this.earlier.forgetEarlierApiKey(provider)
    return null
  }

  async remove(provider: Provider): Promise<boolean> {
    this.changed(provider)
    let had = this.status(provider).set
    await this.change((file) => {
      const settled = this.noEarlierKeysLeft(provider, file)
      const setAt = file.keys[provider]?.setAt
      if (setAt === undefined && !file.cantRead?.includes(provider)) return settled
      if (setAt !== undefined) this.lastSetAt.set(provider, setAt)
      delete file.keys[provider]
      file.cantRead = file.cantRead?.filter((one) => one !== provider)
      had = true
      return true
    })
    this.earlier.forgetEarlierApiKey(provider)
    return had
  }

  /**
   * Moves the keys an earlier version sealed in the database into the file, once, in the
   * background. A key is in the file before its sealed copy goes. A person's save or remove
   * meanwhile wins: the opened key is then dropped.
   */
  async moveEarlierKeys(
    open: (sealed: string) => Promise<string>,
    moved: (provider: Provider) => void,
  ): Promise<void> {
    const waiting = SUPPORTED_PROVIDERS.filter((p) => this.earlier.earlierApiKey(p) !== null)
    if (waiting.length === 0) return
    await Promise.all(waiting.map((provider) => this.moveEarlierKey(provider, open, moved)))
    if (SUPPORTED_PROVIDERS.some((p) => this.earlier.earlierApiKey(p) !== null)) return
    await this.change((file) => {
      if (file.earlierKeysMoved === true) return false
      file.earlierKeysMoved = true
      return true
    }, false)
  }

  private async moveEarlierKey(
    provider: Provider,
    open: (sealed: string) => Promise<string>,
    moved: (provider: Provider) => void,
  ): Promise<void> {
    const row = this.earlier.earlierApiKey(provider)
    const file = this.file()
    if (row === null || file === null) return
    // Already moved, or replaced since: a restored database must not bring an old key back.
    if (file.keys[provider] !== undefined || file.earlierKeysMoved === true) {
      this.earlier.forgetEarlierApiKey(provider)
      return
    }
    let key: string
    try {
      key = await open(row.sealed)
      if (whyNotAKey(key) !== null) return
    } catch {
      return
    }
    const wrote = await this.change((next) => {
      const now = this.earlier.earlierApiKey(provider)
      if (
        next.keys[provider] !== undefined ||
        now?.sealed !== row.sealed ||
        now.setAt !== row.setAt
      )
        return false
      next.keys[provider] = { key: key.trim(), setAt: row.setAt }
      return true
    }, false).catch(() => false)
    if (!wrote) return
    this.earlier.forgetEarlierApiKey(provider)
    this.changed(provider)
    moved(provider)
  }

  /**
   * Marks the earlier keys moved once a person's act leaves none for any other provider, so a row
   * a restored database brings back is dropped unopened. Answers whether it marked.
   */
  private noEarlierKeysLeft(provider: Provider, file: KeysFile): boolean {
    if (file.earlierKeysMoved === true) return false
    if (SUPPORTED_PROVIDERS.some((p) => p !== provider && this.earlier.earlierApiKey(p) !== null))
      return false
    file.earlierKeysMoved = true
    return true
  }

  /** Saved, but not in a form a start can use: still sealed by an earlier version, or unreadable. */
  private cantBeUsed(provider: Provider, file: KeysFile | null): boolean {
    if (file === null || file.cantRead?.includes(provider) === true) return true
    return file.earlierKeysMoved !== true && this.earlier.earlierApiKey(provider) !== null
  }

  private changed(provider: Provider): void {
    this.changes.set(provider, this.revision(provider) + 1)
  }

  /** `null` when the file exists and can't be read; a missing file holds no keys. */
  private file(): KeysFile | null {
    let text: string
    try {
      text = readFileSync(this.path, 'utf8')
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { keys: {} } : null
    }
    try {
      return keysFileOf(JSON.parse(text))
    } catch {
      return null
    }
  }

  /**
   * Every change to the file goes through one queue, so two providers' writes never drop each
   * other's key. A person's save or remove sets an unreadable file aside, never overwriting it;
   * the background move leaves it alone.
   */
  /** Answers whether it wrote; it rejects when the write fails. */
  private change(edit: (file: KeysFile) => boolean, byAPerson = true): Promise<boolean> {
    const work = this.writes.then(async () => {
      const read = this.file()
      if (read === null && !byAPerson) return false
      const file: KeysFile =
        read === null
          ? { keys: {}, cantRead: [...SUPPORTED_PROVIDERS] }
          : { ...read, keys: { ...read.keys } }
      if (!edit(file)) return false
      // Copied, not moved: if the write fails the unreadable file still stands and still refuses.
      if (read === null) await copyFile(this.path, `${this.path}.unreadable-${this.clock()}`)
      if (file.cantRead?.length === 0) delete file.cantRead
      await writeAtomically(this.path, `${JSON.stringify({ version: 1, ...file }, null, 2)}\n`)
      return true
    })
    this.writes = work.catch(() => undefined)
    return work
  }
}

function keysFileOf(parsed: unknown): KeysFile {
  const { keys, cantRead, earlierKeysMoved } = parsed as Record<string, unknown>
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
  return {
    keys: read,
    ...(unread.length > 0 ? { cantRead: unread } : {}),
    ...(earlierKeysMoved === true ? { earlierKeysMoved: true } : {}),
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

/** Opens a key an earlier version sealed with Electron's `safeStorage`. */
export function openWithSafeStorage(safeStorage: {
  decryptStringAsync(encrypted: Buffer): Promise<{ result: string }>
}): (sealed: string) => Promise<string> {
  return async (sealed) =>
    (await safeStorage.decryptStringAsync(Buffer.from(sealed, 'base64'))).result
}
