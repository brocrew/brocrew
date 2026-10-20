import type { Locator, Page } from 'playwright-core'
import { LocalFileGuardError } from '../localFileGuard.js'
import type { LocalFileGuardConfig } from '../localFileGuard.js'
import type { ProfileBrowser } from '../browser/profileBrowser.js'
import { BrowserNotFoundError, ProfileInUseError } from '../browser/profileBrowser.js'
import { OperationBlockedError } from '../shared/browser/browser-lease.js'
import type { KeyedSerializer } from '../shared/browser/browser-lease.js'
import { isProfileName } from '../profiles/store.js'
import type { ProfileStore } from '../profiles/store.js'
import { TabError } from '../tabs.js'
import type { TabRegistry, TabState } from '../tabs.js'
import type { WindowTasks } from '../windows.js'
import { MAX_TEXT, ToolError } from './schema.js'
import type { PropSpec, ToolSpec } from './schema.js'
export interface ToolDeps {
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
export const MAX_TIMEOUT_MS = 60000
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
  description: 'http(s) URL, or about:blank.',
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
const refusalNotEnabled = (name: string): string =>
  `profile "${name}" is not enabled — the user can enable it in the Settings → Plugins → Chrome`
const refusalNotAllowed = (what: 'extensions' | 'settings', name: string): string =>
  `${what} are not allowed on profile "${name}" — the user can allow them in the Settings → Plugins → Chrome`
export type ProfileNeed = 'allowExtensions' | 'allowSettings'
export function usableProfile(deps: ToolDeps, name: string, need?: ProfileNeed): void {
  const rec = isProfileName(name) ? deps.store.get(name) : undefined
  if (!rec && isProfileName(name))
    throw new ToolError(
      `no profile named "${name}" — list_browser_profiles shows the profiles that exist`,
    )
  if (!rec || !rec.enabled)
    throw new ToolError(refusalNotEnabled(isProfileName(name) ? name : 'unknown'))
  if (need && !rec[need])
    throw new ToolError(
      refusalNotAllowed(need === 'allowExtensions' ? 'extensions' : 'settings', name),
    )
}
export const generationOf =
  (deps: Pick<ToolDeps, 'browser'>): ((profile: string) => number | null) =>
  (p) =>
    deps.browser.state(p)?.generation ?? null
export function checkUrl(raw: string): string {
  if (raw === 'about:blank') return raw
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new ToolError('the URL is not valid')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:')
    throw new ToolError('only http, https and about:blank URLs are allowed')
  return u.href
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
export function describeError(e: unknown, ms?: number): string {
  if (e instanceof ToolError || e instanceof TabError || e instanceof LocalFileGuardError)
    return e.message
  if (e instanceof ProfileInUseError || e instanceof BrowserNotFoundError) return e.message
  if (e instanceof OperationBlockedError)
    return 'the profile is being restarted — call again in a few seconds'
  const name = e instanceof Error ? e.name : ''
  if (name === 'TimeoutError') return `timed out${ms ? ` after ${ms} ms` : ''}`
  const text = e instanceof Error ? e.message : ''
  if (/Target (page, context or browser|closed)|has been closed/i.test(text))
    return 'the page or the browser was closed during the action'
  if (/strict mode violation/i.test(text))
    return 'the ref matches more than one element — call snapshot again'
  if (
    /not an <input>|Element is not|not a select|is not editable|not visible|intercepts pointer events|not enabled|detached/i.test(
      text,
    )
  )
    return 'the element cannot take this action right now'
  if (/net::|ERR_/.test(text)) return 'the page could not be loaded'
  return `the browser action failed${name ? ` (${name.replace(/[^\w]/g, '').slice(0, 30)})` : ''}`
}
export interface TabCall {
  tab: TabState
  page: Page
}
export async function onTab<T>(
  deps: ToolDeps,
  id: string,
  fn: (c: TabCall) => Promise<T>,
): Promise<{
  value: T
  notes: string[]
}> {
  const tab = deps.tabs.resolve(id, generationOf(deps))
  usableProfile(deps, tab.profile)
  deps.browser.touch(tab.profile)
  const value = await deps.browser.operate(tab.profile, () =>
    deps.serializer.runExclusive(tab.id, () => {
      deps.tabs.resolve(id, generationOf(deps))
      usableProfile(deps, tab.profile)
      return fn({ tab, page: tab.page })
    }),
  )
  return { value, notes: tab.notes.splice(0) }
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
  return { body, next: offset + body.length < text.length ? offset + body.length : null }
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
