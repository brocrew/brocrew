import { navigationUrl } from '../shared/browser/navigationUrl.js'
import type { Locator, Page } from 'playwright-core'
import type { LocalFileGuardConfig } from '../localFileGuard.js'
import type { ProfileBrowser } from '../browser/profileBrowser.js'
import type { KeyedSerializer } from '../shared/browser/browser-lease.js'
import { isProfileName, RENAME_ERRORS } from '../profiles/store.js'
import type { ProfileStore } from '../profiles/store.js'
import { TabError, type TabRegistry, type TabState } from '../tabs.js'
import type { WindowTasks } from '../windows.js'
import { MAX_TEXT, ToolError } from './schema.js'
import type { ToolActivity } from '../shared/toolServer.js'
import type { PropSpec, ToolSpec } from './schema.js'
export interface ToolDeps {
  signal?: AbortSignal
  activity?: (stage: ToolActivity) => void
  store: ProfileStore
  browser: ProfileBrowser
  windows: WindowTasks
  tabs: TabRegistry
  serializer: KeyedSerializer
  guard: () => LocalFileGuardConfig
  downloadsRoot: string
  nativeDownloads?: string
  now?: () => Date
  logger?: {
    info(msg: string, fields?: Record<string, unknown>): void
  }
}
export type ToolOutput =
  | {
      json: unknown
    }
  | {
      text: string
    }
  | {
      image: Buffer
      caption: string
    }
export const DEFAULT_TIMEOUT_MS = 15000
export const DEFAULT_NETWORK_LIMIT = 50
const MAX_TIMEOUT_MS = 60000
export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024
export const tabId: PropSpec = {
  type: 'string',
  description: 'Tab id from open_tab or list_tabs, e.g. "t12".',
  pattern: /^t\d{1,9}$/,
}
export const ref: PropSpec = {
  type: 'string',
  description: 'Element ref from the latest snapshot of this tab, e.g. "e12".',
  pattern: /^[A-Za-z0-9]{1,12}$/,
}
export const timeoutMs: PropSpec = {
  type: 'number',
  description: `Optional time limit in ms (default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS}).`,
  integer: true,
  min: 1,
  max: MAX_TIMEOUT_MS,
}
export const profileName: PropSpec = {
  type: 'string',
  description: 'Profile name (a-z, 0-9, dash; 1-32 characters).',
  pattern: /^[a-z0-9-]{1,32}$/,
}
export const url: PropSpec = {
  type: 'string',
  description: 'URL to open in Chrome, or a native absolute local path.',
  minLength: 1,
  maxLength: 2000,
}
export const since: PropSpec = {
  type: 'number',
  description: 'Only entries after this sequence number (the "last" of an earlier call).',
  integer: true,
  min: 0,
}
export const networkLimit: PropSpec = {
  type: 'number',
  description: `How many requests to return, newest first (default ${DEFAULT_NETWORK_LIMIT}, max 200).`,
  integer: true,
  min: 1,
  max: 200,
}
export const networkType: PropSpec = {
  type: 'string',
  description:
    'Only requests of this resource type: document, stylesheet, image, media, font, script, xhr, fetch, websocket, eventsource, manifest, other.',
  pattern: /^[A-Za-z]{1,20}$/,
}
export const urlIncludes: PropSpec = {
  type: 'string',
  description: 'Only requests whose URL (without query) contains this text, case-insensitive.',
  minLength: 1,
  maxLength: 200,
}
export const KEY = /^[A-Za-z0-9+_ -]{1,40}$/
export function usableProfile(deps: ToolDeps, name: string): void {
  const rec = isProfileName(name) ? deps.store.get(name) : undefined
  if (!rec)
    throw new ToolError(
      `no profile named "${name}" — list_browser_profiles shows the profiles that exist`,
    )
  if (rec.deleting) throw new ToolError(RENAME_ERRORS.deleting)
}
export const generationOf =
  (deps: Pick<ToolDeps, 'browser'>): ((profile: string) => number | null) =>
  (p) =>
    deps.browser.state(p)?.generation ?? null
export function checkUrl(raw: string): string {
  try {
    return navigationUrl(raw)
  } catch (error) {
    throw new ToolError((error as Error).message)
  }
}
/** Download transport never inherits local navigation support, including redirects. */
export function checkDownloadUrl(raw: string): string {
  const target = checkUrl(raw)
  if (!/^https?:/.test(target))
    throw new ToolError(
      'download_url supports only http and https URLs; file URLs and local paths are not supported',
    )
  return target
}
export const timeoutOf = (args: Record<string, unknown>): number =>
  typeof args.timeoutMs === 'number' ? args.timeoutMs : DEFAULT_TIMEOUT_MS
export function capped(text: string): string {
  return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + '\n[truncated at 100 KB]' : text
}
export function jsonValue(value: unknown): string {
  let text: string | undefined
  try {
    text = JSON.stringify(value === undefined ? null : value)
  } catch {
    throw new ToolError('the result cannot be shown as JSON')
  }
  if (text === undefined) text = 'null'
  return capped(text)
}
export function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
/**
 * The wait before a tab action ends within the tool's own timeout or when the call is cancelled.
 * Nothing has been sent to the page at that point, so the agent can safely call again.
 */
function readiness(deps: ToolDeps, timeoutMs: number) {
  const signal = AbortSignal.any([
    ...(deps.signal ? [deps.signal] : []),
    AbortSignal.timeout(timeoutMs),
  ])
  const notReady = (id: string, waiting: 'tab' | 'browser'): ToolError =>
    new ToolError(
      deps.signal?.aborted
        ? `cancelled before tab ${id} was ready; nothing was sent`
        : `tab ${id} was not ready within ${Math.ceil(timeoutMs / 1000)} s (${
            waiting === 'tab'
              ? 'an earlier call on this tab is still running'
              : 'the browser did not answer'
          }); nothing was sent`,
    )
  return { signal, notReady }
}
/** Page-tool use which is not routed through onTab still updates context window preference. */
export async function useTab(deps: ToolDeps, args: Record<string, unknown>): Promise<TabState> {
  const id = args.tabId as string
  const timeoutMs = timeoutOf(args)
  const tab = deps.tabs.resolve(id, generationOf(deps))
  usableProfile(deps, tab.profile)
  const ready = readiness(deps, timeoutMs)
  await deps.browser.operate(tab.profile, async () => {
    deps.tabs.resolve(id, generationOf(deps))
    usableProfile(deps, tab.profile)
    try {
      await deps.browser.usePage(tab.profile, tab.page, ready.signal)
    } catch (error) {
      if (ready.signal.aborted) throw ready.notReady(id, 'browser')
      throw error
    }
    deps.tabs.resolve(id, generationOf(deps))
    usableProfile(deps, tab.profile)
  })
  return tab
}
export interface TabCall {
  tab: TabState
  page: Page
}
export function openDialogNote(tab: TabState): string | undefined {
  const dialog = tab.pendingDialog
  if (!dialog) return undefined
  return `tab ${tab.id} has an open ${dialog.type()} dialog: ${JSON.stringify(dialog.message().slice(0, 2000))} — call handle_dialog with tabId ${tab.id} and accept true or false to answer it`
}
function requireNoDialog(tab: TabState): void {
  const note = openDialogNote(tab)
  if (note) throw new TabError(note)
}
export async function onTab<T>(
  deps: ToolDeps,
  args: Record<string, unknown>,
  fn: (c: TabCall) => Promise<T>,
  waitForWindow = true,
): Promise<{
  value: T
  notes: string[]
}> {
  const id = args.tabId as string
  const timeoutMs = timeoutOf(args)
  const tab = deps.tabs.resolve(id, generationOf(deps))
  usableProfile(deps, tab.profile)
  requireNoDialog(tab)
  const ready = readiness(deps, timeoutMs)
  let waiting: 'tab' | 'browser' = 'tab'
  let acting = false
  const value = await deps.browser.operate(tab.profile, () => {
    const run = deps.serializer.runExclusive(tab.id, async () => {
      // A caller that stopped waiting must never have its action run later.
      if (ready.signal.aborted) throw ready.notReady(id, waiting)
      waiting = 'browser'
      deps.tabs.resolve(id, generationOf(deps))
      usableProfile(deps, tab.profile)
      requireNoDialog(tab)
      if (waitForWindow)
        try {
          await deps.browser.usePage(tab.profile, tab.page, ready.signal)
        } catch (error) {
          if (ready.signal.aborted) throw ready.notReady(id, waiting)
          throw error
        }
      else {
        const notes = tab.notes
        void deps.browser.usePage(tab.profile, tab.page).catch((error: unknown) => {
          notes.push(describeError(error))
        })
      }
      deps.tabs.resolve(id, generationOf(deps))
      usableProfile(deps, tab.profile)
      requireNoDialog(tab)
      if (ready.signal.aborted) throw ready.notReady(id, waiting)
      acting = true
      deps.activity?.('page-ready')
      try {
        return await fn({ tab, page: tab.page })
      } catch (error) {
        const note = openDialogNote(tab)
        if (note)
          throw new TabError(`${note}. The action's completion is unknown; do not replay it.`)
        throw error
      }
    })
    const gaveUp = new Promise<never>((_resolve, reject) => {
      const stop = () => {
        if (!acting) reject(ready.notReady(id, waiting))
      }
      if (ready.signal.aborted) stop()
      else ready.signal.addEventListener('abort', stop, { once: true })
      void run.finally(() => ready.signal.removeEventListener('abort', stop)).catch(() => {})
    })
    return Promise.race([run, gaveUp])
  })
  const notes = tab.notes.splice(0)
  const dialog = openDialogNote(tab)
  if (dialog) notes.push(dialog)
  return { value, notes }
}
export function withNotes(
  json: Record<string, unknown>,
  notes: string[],
): {
  json: unknown
} {
  return { json: notes.length ? { ...json, notes } : json }
}
export function locate(tab: TabState, page: Page, refId: string): Locator {
  if (tab.refs === null || !tab.refs.has(refId))
    throw new ToolError(`ref ${refId} is from an old snapshot — call snapshot again`)
  return page.locator(`aria-ref=${refId}`)
}
export const titleOf = (page: Page): Promise<string> =>
  Promise.race([
    page.title().catch(() => ''),
    new Promise<string>((r) => setTimeout(() => r(''), 2000).unref()),
  ])
export async function titleAfterLoad(page: Page): Promise<string> {
  const first = await titleOf(page)
  if (first !== '' || page.url() === 'about:blank') return first
  await page.waitForLoadState('domcontentloaded', { timeout: 1500 }).catch(() => undefined)
  const second = await titleOf(page)
  if (second !== '') return second
  await new Promise((r) => setTimeout(r, 400))
  return titleOf(page)
}
export async function cacheTabTitle(tab: TabState, readTitle = titleOf): Promise<string> {
  const revision = tab.navigationRevision
  const publication = tab.titlePublication
  const title = await readTitle(tab.page)
  if (
    tab.navigationRevision === revision &&
    (tab.titlePublication === publication || (title && !tab.title))
  ) {
    tab.title = title
    tab.titlePublication++
  }
  return title
}
export async function raceTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' })),
          ms,
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
export interface ToolDef {
  spec: ToolSpec
  downloadRouting?: false
  run(args: Record<string, unknown>, deps: ToolDeps): Promise<ToolOutput>
}
export function pageText(
  text: string,
  offset: number,
  max: number,
): {
  body: string
  next: number | null
} {
  const body = text.slice(offset, offset + max)
  return {
    body,
    next: offset + body.length < text.length ? offset + body.length : null,
  }
}
export const moreMarker = (tool: string, next: number | null): string =>
  next === null ? '' : `\n[more: call ${tool} again with offset=${next} to read on]`
export const pageOffset: PropSpec = {
  type: 'number',
  description:
    'Character offset to start from (default 0), for reading long pages in parts: use the offset named in the "[more: ...]" marker.',
  integer: true,
  min: 0,
  max: 100000000,
}
export const pageMaxChars: PropSpec = {
  type: 'number',
  description: 'Most characters to return (default and maximum 100000).',
  integer: true,
  min: 1,
  max: 100000,
}
