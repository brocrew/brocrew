import type { Page, Download } from 'playwright-core'
import type { HelperState } from './brocrewHelper.js'
export interface ProfileBrowser {
  /** One admitted agent call; private routing covers its entire lifetime. */
  agentCall?<T>(profiles: readonly string[], fn: () => Promise<T>): Promise<T>
  privateDownloadsActive?(profile: string): boolean
  downloadIsPrivate?(profile: string, download: Download): Promise<boolean>
  downloadFileIsPrivate?(profile: string, file: string): boolean
  deletePrivateDownload?(profile: string, download: Download): Promise<void>
  cancelPrivateDownload?(profile: string, download: Download): Promise<void>
  ensure(profile: string): Promise<{
    generation: number
  }>
  close(profile: string): Promise<void>
  removeWhenIdle(profile: string, remove: () => void): Promise<void>
  state(profile: string): {
    generation: number
    /** The BroCrew helper in this browser; absent when this browser has none. */
    helper?: HelperState
  } | null
  newPage(
    profile: string,
    opts: {
      newWindow: boolean
      windowOf?: Page
      onNote?: (note: string) => void
    },
  ): Promise<Page>
  windowId(profile: string, page: Page): Promise<number>
  /** The person turned the BroCrew helper on in the Chrome panel. */
  turnHelperOn(profile: string): Promise<void>
  usePage(profile: string, page: Page): Promise<void>
  onPage(profile: string, cb: (page: Page) => void): () => void
  onClosed(profile: string, cb: (generation: number) => void): () => void
  waitAllPagesClosed(profile: string, timeoutMs: number): Promise<'pages-closed' | 'timeout'>
  exclusive<T>(profile: string, fn: () => Promise<T>): Promise<T>
  dir(profile: string): string
  operate<T>(profile: string, fn: () => Promise<T>): Promise<T>
  /** savedFile identifies the native staging artifact actually copied by fn. */
  captureDownloads<T>(
    profile: string,
    page: Page,
    fn: () => Promise<T>,
    savedFile?: () => string | undefined,
    onprogress?: () => void,
    existing?: { download: Download; signal?: AbortSignal },
  ): Promise<T>
}
export class BrowserNotFoundError extends Error {
  constructor() {
    super('Install Google Chrome, then try again.')
    this.name = 'BrowserNotFoundError'
  }
}
export const BROWSER_MISSING =
  /distribution '[^']*' is not found|executable doesn't exist|browser executable not found|failed to launch.*ENOENT|spawn .* ENOENT/i
export class ProfileInUseError extends Error {
  constructor() {
    super('profile is open in another Chrome')
    this.name = 'ProfileInUseError'
  }
}

const browserHandleOriginals = new WeakMap<object, object>()
export function unwrapBrowserHandle<T extends object>(handle: T): T {
  return (browserHandleOriginals.get(handle) ?? handle) as T
}

/** Keeps internal window/CDP continuations on the admitted browser generation. */
export function fenceBrowserHandles<T extends object>(root: T, check: () => void): T {
  const proxies = new WeakMap<object, object>()
  const originals = new WeakMap<object, object>()
  const events = new Set(['on', 'once', 'off', 'removeListener'])
  const reads = new Set(['isClosed', 'url', 'context', 'pages', 'browser', 'isConnected'])
  const unwrap = (value: unknown): unknown => {
    if (!value || typeof value !== 'object') return value
    return originals.get(value) ?? value
  }
  const wrap = (value: unknown): unknown => {
    if (!value || typeof value !== 'object' || Buffer.isBuffer(value)) return value
    if (Array.isArray(value)) return value.map(wrap)
    if (
      Object.getPrototypeOf(value) === Object.prototype &&
      !Object.values(value).some((v) => typeof v === 'function')
    )
      return value
    const known = proxies.get(value)
    if (known) return known
    const listeners = new Map<
      string,
      WeakMap<(...args: unknown[]) => unknown, (...args: unknown[]) => unknown>
    >()
    const proxy = new Proxy(value, {
      get(target, prop) {
        const field = Reflect.get(target, prop, target)
        if (typeof field !== 'function') return wrap(field)
        return (...args: unknown[]) => {
          const event = events.has(String(prop))
          const cleanup = prop === 'detach'
          if (!event && !cleanup && !reads.has(String(prop))) check()
          const params = args.map(unwrap)
          if (event && typeof params[1] === 'function') {
            const callback = params[1] as (...values: unknown[]) => unknown
            const eventName = String(params[0])
            let callbacks = listeners.get(eventName)
            if (!callbacks) listeners.set(eventName, (callbacks = new WeakMap()))
            let listener = callbacks.get(callback)
            if (!listener) {
              listener = (...values) => {
                // Close observers must drain even after revocation. Other observations are stale.
                if (eventName !== 'close' && eventName !== 'disconnected') {
                  try {
                    check()
                  } catch {
                    return
                  }
                }
                return callback(
                  ...(eventName === 'page' || eventName === 'framenavigated'
                    ? values.map(wrap)
                    : values),
                )
              }
              callbacks.set(callback, listener)
            }
            params[1] = listener
          }
          const result = Reflect.apply(field, target, params)
          if (event) return proxy
          if (
            result &&
            typeof result === 'object' &&
            'then' in result &&
            typeof result.then === 'function'
          )
            return Promise.resolve(result).then((out: unknown) => {
              if (!cleanup) check()
              return wrap(out)
            })
          return wrap(result)
        }
      },
    })
    proxies.set(value, proxy)
    originals.set(proxy, value)
    browserHandleOriginals.set(proxy, value)
    return proxy
  }
  return wrap(root) as T
}
