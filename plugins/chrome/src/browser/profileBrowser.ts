import type { Page } from 'playwright-core'
export type BrowserMode = 'headless' | 'visible'
export interface ProfileBrowser {
  ensure(
    profile: string,
    mode: BrowserMode,
  ): Promise<{
    generation: number
  }>
  close(profile: string): Promise<void>
  state(profile: string): {
    mode: BrowserMode
    generation: number
  } | null
  newPage(
    profile: string,
    opts: {
      newWindow: boolean
    },
  ): Promise<Page>
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
  ): Promise<T>
  touch(profile: string): void
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
