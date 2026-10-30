import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import {
  STORAGE_CHANNELS,
  isStorageLocation,
  type StorageAction,
  type StorageDirectory,
  type StorageLocation,
  type StorageOverview,
} from '../../shared/storage'
import { failedOverview, storageReason, type StorageRequest } from './engine'
import type { StorageService } from './service'
import { installSessionRelease } from '../window-navigation'

export interface StorageActions {
  readonly reveal: (path: string) => void
  /** Electron's HTTP cache API preserves cookies, sessions, files, plugins and recovery copies. */
  readonly clearCache: () => Promise<void>
  readonly isAppWindow: (event: IpcMainInvokeEvent) => boolean
}

export function registerStorageIpc(
  ipc: Pick<IpcMain, 'handle' | 'removeHandler'>,
  service: StorageService,
  actions: StorageActions,
): () => void {
  const running = new Map<WebContents, Map<string, AbortController>>()
  const watched = new Map<WebContents, () => void>()
  let clearing = false
  let closed = false
  const bounded = async <T>(pending: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        pending,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Cache operation timed out')), 15_000)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  const invalid = (): StorageAction => ({ ok: false, error: 'invalid-location' })
  const read = async (event: IpcMainInvokeEvent, request: StorageRequest) => {
    if (closed || !actions.isAppWindow(event))
      return { ok: false as const, error: 'unavailable' as const }
    const sender = event.sender
    if (!watched.has(sender)) {
      const abort = (): void => {
        for (const controller of running.get(sender)?.values() ?? []) controller.abort()
        running.delete(sender)
      }
      const destroyed = (): void => {
        abort()
        watched.get(sender)?.()
        watched.delete(sender)
      }
      installSessionRelease(sender, abort)
      sender.once('destroyed', destroyed)
      watched.set(sender, () => {
        sender.removeListener('did-navigate', abort)
        sender.removeListener('render-process-gone', abort)
        sender.removeListener('destroyed', abort)
        sender.removeListener('destroyed', destroyed)
      })
    }
    const requests = running.get(sender) ?? new Map<string, AbortController>()
    requests.get(request.kind)?.abort()
    const controller = new AbortController()
    requests.set(request.kind, controller)
    running.set(sender, requests)
    try {
      return await service.run(request, controller.signal)
    } finally {
      if (requests.get(request.kind) === controller) requests.delete(request.kind)
      if (requests.size === 0) running.delete(sender)
    }
  }
  ipc.handle(STORAGE_CHANNELS.measure, async (event): Promise<StorageOverview> => {
    const result = await read(event, { kind: 'measure' })
    return result.ok ? (result.value as StorageOverview) : failedOverview(result.error)
  })
  ipc.handle(
    STORAGE_CHANNELS.children,
    async (event, location: unknown): Promise<StorageDirectory> => {
      const safe = isStorageLocation(location)
      const fallback: StorageDirectory = {
        location: safe ? location : { part: 'workspace', segments: [] },
        entries: [],
        smallerCount: 0,
        smallerBytes: 0,
        totalBytes: 0,
        partial: true,
        error: 'invalid-location',
      }
      if (!safe) return fallback
      const result = await read(event, { kind: 'children', location })
      return result.ok ? (result.value as StorageDirectory) : { ...fallback, error: result.error }
    },
  )
  ipc.handle(STORAGE_CHANNELS.reveal, async (event, location: unknown): Promise<StorageAction> => {
    if (location !== undefined && !isStorageLocation(location)) return invalid()
    const result = await read(event, {
      kind: 'reveal',
      location: location as StorageLocation | undefined,
    })
    if (!result.ok) return result
    if (closed || event.sender.isDestroyed() || !actions.isAppWindow(event))
      return { ok: false, error: 'cancelled' }
    try {
      actions.reveal((result.value as { path: string }).path)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: storageReason(error) }
    }
  })
  ipc.handle(STORAGE_CHANNELS.clearCache, async (event): Promise<StorageAction> => {
    if (closed || !actions.isAppWindow(event)) return { ok: false, error: 'unavailable' }
    if (clearing) return { ok: false, error: 'busy' }
    clearing = true
    const pending = Promise.resolve()
      .then(() => actions.clearCache())
      .finally(() => {
        clearing = false
      })
    try {
      await bounded(pending)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: storageReason(error) }
    }
  })
  return () => {
    closed = true
    service.close()
    for (const unwatch of watched.values()) unwatch()
    watched.clear()
    running.clear()
    for (const channel of Object.values(STORAGE_CHANNELS)) ipc.removeHandler(channel)
  }
}
