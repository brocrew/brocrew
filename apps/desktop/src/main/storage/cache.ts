import { join } from 'node:path'
import { StorageFailure } from './engine'
import type { StorageService } from './service'

/** Electron 43's network context stores HTTP cache in the Cache child of session storage. */
export function httpCacheFolder(sessionStorage: string | null): string | null {
  // https://github.com/electron/electron/blob/v43.2.0/shell/browser/net/network_context_service.cc#L74-L87
  return sessionStorage === null ? null : join(sessionStorage, 'Cache')
}

export async function clearHttpCache(
  storage: Pick<StorageService, 'run'>,
  clear: () => Promise<void>,
): Promise<void> {
  const checked = await storage.run({ kind: 'reveal', location: { part: 'cache', segments: [] } })
  if (!checked.ok) throw new StorageFailure(checked.error)
  await clear()
}
