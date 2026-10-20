import { browserChoice, launchTarget } from './launchConfig.js'
import type { BrowserChoice } from './launchConfig.js'
export function fixUserAgent(userAgent: string): string {
  return userAgent.replace('HeadlessChrome', 'Chrome')
}
export const UA_EXPRESSION = 'navigator.userAgent'
export function chromeVersionOf(userAgent: string): string | null {
  const m = /(?:Headless)?Chrome\/(\d+)\.(\d+)/.exec(userAgent)
  return m ? `${m[1]}.${m[2]}` : null
}
export interface UaInfo {
  userAgent: string
  chromeVersion: string | null
}
export type UaReader = (signal?: AbortSignal) => Promise<string>
export interface ChromeUa {
  get(): Promise<UaInfo>
  invalidate(): void
  peek(): UaInfo | null
}
export const UA_TTL_MS = 24 * 3600 * 1000
export const UA_READ_TIMEOUT_MS = 30000
export const UA_RETRY_MS = 60000
export const DEFAULT_FALLBACK_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36'
export function fallbackUaFor(platform: NodeJS.Platform = process.platform): string {
  const system =
    platform === 'win32'
      ? 'Windows NT 10.0; Win64; x64'
      : platform === 'darwin'
        ? null
        : 'X11; Linux x86_64'
  return system === null
    ? DEFAULT_FALLBACK_UA
    : DEFAULT_FALLBACK_UA.replace('Macintosh; Intel Mac OS X 10_15_7', system)
}
export class UaReadTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`the Chrome UA read exceeded ${timeoutMs}ms`)
    this.name = 'UaReadTimeoutError'
  }
}
export interface ChromeUaDeps {
  read: UaReader
  now?: () => number
  ttlMs?: number
  timeoutMs?: number
  fallback?: string
  retryMs?: number
  onFallback?: (reason: 'timeout' | 'error', used: 'last-known' | 'default') => void
}
export function createChromeUa(deps: ChromeUaDeps): ChromeUa {
  const now = deps.now ?? (() => performance.now())
  const ttl = deps.ttlMs ?? UA_TTL_MS
  const timeoutMs = deps.timeoutMs ?? UA_READ_TIMEOUT_MS
  const retryMs = deps.retryMs ?? UA_RETRY_MS
  let cached:
    | (UaInfo & {
        at: number
        provisional: boolean
      })
    | null = null
  let lastRead: UaInfo | null = null
  let pending: Promise<UaInfo> | null = null
  const infoOf = (userAgent: string): UaInfo => ({
    userAgent,
    chromeVersion: chromeVersionOf(userAgent),
  })
  async function readBounded(): Promise<string> {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new UaReadTimeoutError(timeoutMs))
      }, timeoutMs)
    })
    const work = deps.read(controller.signal)
    work.catch(() => undefined)
    try {
      return await Promise.race([work, timedOut])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
  async function resolveUa(): Promise<UaInfo> {
    try {
      const info = infoOf(fixUserAgent(String(await readBounded())))
      lastRead = info
      cached = { ...info, at: now(), provisional: false }
      return info
    } catch (e) {
      const stand =
        lastRead ?? (deps.fallback !== undefined ? infoOf(fixUserAgent(deps.fallback)) : null)
      if (stand === null) throw e
      cached = { ...stand, at: now(), provisional: true }
      try {
        deps.onFallback?.(
          e instanceof UaReadTimeoutError ? 'timeout' : 'error',
          lastRead ? 'last-known' : 'default',
        )
      } catch {
        /* Continue without this optional result. */
      }
      return stand
    }
  }
  return {
    get() {
      if (cached && now() - cached.at < (cached.provisional ? retryMs : ttl))
        return Promise.resolve({ userAgent: cached.userAgent, chromeVersion: cached.chromeVersion })
      if (!pending) {
        pending = resolveUa().finally(() => {
          pending = null
        })
      }
      return pending
    },
    invalidate() {
      cached = null
    },
    peek: () =>
      cached ? { userAgent: cached.userAgent, chromeVersion: cached.chromeVersion } : null,
  }
}
export const createUaReader =
  (choice: BrowserChoice = browserChoice()): UaReader =>
  async (signal) => {
    const { chromium } = await import('playwright-core')
    const browser = await chromium.launch({
      ...launchTarget(choice),
      headless: true,
      timeout: UA_READ_TIMEOUT_MS,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    })
    const stop = (): void => void browser.close().catch(() => undefined)
    if (signal?.aborted) {
      stop()
      throw new UaReadTimeoutError(UA_READ_TIMEOUT_MS)
    }
    signal?.addEventListener('abort', stop, { once: true })
    try {
      const page = await browser.newPage()
      return String(await page.evaluate(UA_EXPRESSION))
    } finally {
      signal?.removeEventListener('abort', stop)
      await browser.close().catch(() => undefined)
    }
  }
export const realUaReader: UaReader = createUaReader()
