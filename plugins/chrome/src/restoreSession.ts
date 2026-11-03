import fs from 'node:fs'
import path from 'node:path'
import type { ProfileBrowser } from './browser/profileBrowser.js'
import type { Logger } from './logger.js'
import type { ProfileStore } from './profiles/store.js'
import type { TabRegistry } from './tabs.js'
import { watchWindow } from './tools/showHide.js'
export const RESTORE_FILE = 'restore.json'
export const RESTORE_MAX_AGE_MS = 10 * 60 * 1000
export const RESTORE_MAX_PAGES = 50
export const RESTORE_PROFILE_BUDGET_MS = 5000
export const RESTORE_TOTAL_BUDGET_MS = 90000
export const RESTORE_LOAD_TIMEOUT_MS = 10000
const KEPT_SCHEMES = new Set(['http:', 'https:', 'file:'])
export interface SavedProfile {
  name: string
  urls: string[]
  identity?: string
}
export interface SavedSession {
  format?: 2
  savedAt: string
  profiles: SavedProfile[]
}
export function urlsToKeep(urls: readonly string[]): string[] {
  const out: string[] = []
  for (const raw of urls) {
    let u: URL
    try {
      u = new URL(raw)
    } catch {
      continue
    }
    if (!KEPT_SCHEMES.has(u.protocol)) continue
    out.push(u.href)
    if (out.length >= RESTORE_MAX_PAGES) break
  }
  return out
}
export interface VisibleSource {
  visiblePages(): Array<{
    profile: string
    urls: string[]
  }>
}
export function saveVisibleSession(
  file: string,
  source: VisibleSource,
  canSave: (name: string) => boolean,
  now: () => Date = () => new Date(),
  logger?: Logger,
  identityOf?: (name: string) => string,
): void {
  try {
    const profiles = source
      .visiblePages()
      .filter((p) => canSave(p.profile))
      .map((p) => ({
        name: p.profile,
        urls: urlsToKeep(p.urls),
        ...(identityOf ? { identity: identityOf(p.profile) } : {}),
      }))
      .filter((p) => p.urls.length > 0)
    if (profiles.length === 0) {
      fs.rmSync(file, { force: true })
      return
    }
    const session: SavedSession = {
      ...(identityOf ? { format: 2 } : {}),
      savedAt: now().toISOString(),
      profiles,
    }
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(session) + '\n', { mode: 0o600 })
    fs.renameSync(tmp, file)
    logger?.info('restore: saved', {
      profiles: profiles.length,
      pages: profiles.reduce((n, p) => n + p.urls.length, 0),
    })
  } catch {
    logger?.warn('restore: could not save the visible windows')
  }
}
export function takeFreshSession(
  file: string,
  now: () => Date = () => new Date(),
  logger?: Logger,
): SavedSession | null {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
  fs.rmSync(file, { force: true })
  try {
    const parsed = JSON.parse(text) as Partial<SavedSession>
    if (parsed.format !== undefined && parsed.format !== 2) return null
    const at = typeof parsed.savedAt === 'string' ? Date.parse(parsed.savedAt) : NaN
    if (!Number.isFinite(at) || !Array.isArray(parsed.profiles)) return null
    const age = now().getTime() - at
    if (age < 0 || age > RESTORE_MAX_AGE_MS) {
      logger?.info('restore: the save is too old, nothing restored', {
        ageSeconds: Math.round(age / 1000),
      })
      return null
    }
    const profiles = parsed.profiles
      .filter(
        (p): p is SavedProfile =>
          typeof p === 'object' &&
          p !== null &&
          typeof (p as SavedProfile).name === 'string' &&
          Array.isArray((p as SavedProfile).urls),
      )
      .map((p) => ({
        name: p.name,
        ...(typeof p.identity === 'string' ? { identity: p.identity } : {}),
        urls: urlsToKeep(p.urls.filter((u): u is string => typeof u === 'string')),
      }))
      .filter((p) => p.urls.length > 0)
    return {
      ...(parsed.format === 2 ? { format: 2 } : {}),
      savedAt: parsed.savedAt as string,
      profiles,
    }
  } catch {
    return null
  }
}
export interface RestoreDeps {
  file: string
  store: ProfileStore
  browser: ProfileBrowser
  tabs: TabRegistry
  logger: Logger
  now?: () => Date
  clock?: () => number
}
export async function restoreVisibleSession(deps: RestoreDeps): Promise<string[]> {
  const { store, browser, tabs, logger } = deps
  const session = takeFreshSession(deps.file, deps.now, logger)
  if (!session) return []
  const clock = deps.clock ?? Date.now
  const totalEnd = clock() + RESTORE_TOTAL_BUDGET_MS
  const done: string[] = []
  for (const saved of session.profiles) {
    if (!store.shared && session.format === 2) continue
    const resolved = store.shared?.resolveSaved(saved.name, saved.identity, session.format !== 2)
    const name = store.shared ? resolved?.name : saved.name
    if (!name) continue
    const p = { ...saved, name }
    if (clock() >= totalEnd) {
      logger.warn('restore: out of time, profile skipped')
      continue
    }
    const rec = store.get(p.name)
    if (!rec || !rec.enabled || rec.temporary) {
      logger.info('restore: profile skipped', {
        reason: !rec ? 'gone' : rec.temporary ? 'temporary' : 'disabled',
      })
      continue
    }
    try {
      let opened = 0
      tabs.watch(p.name, browser)
      const admission = {
        authorization: store.shared?.authorization(p.name),
        generation: undefined as number | undefined,
      }
      await browser.exclusive(p.name, async () => {
        const allowed = (): boolean => {
          const current = store.get(p.name)
          return (
            current !== undefined &&
            current.enabled &&
            !current.temporary &&
            (!store.shared || store.shared.identity(p.name) === resolved?.identity) &&
            store.shared?.authorization(p.name) === admission.authorization &&
            (admission.generation === undefined ||
              browser.state(p.name)?.generation === admission.generation)
          )
        }
        if (!allowed()) return
        const { generation } = await browser.ensure(p.name, 'visible')
        admission.generation = generation
        if (!allowed()) return
        const profileEnd = Math.min(totalEnd, clock() + RESTORE_PROFILE_BUDGET_MS)
        for (const url of p.urls) {
          if (store.shared && new URL(url).protocol === 'file:') continue
          if (!allowed()) break
          if (clock() >= profileEnd) {
            logger.warn('restore: out of time, remaining tabs dropped', {
              opened,
              wanted: p.urls.length,
            })
            break
          }
          const page = await browser.newPage(p.name, { newWindow: false })
          if (!allowed()) break
          tabs.add(p.name, generation, page)
          opened++
          void page
            .goto(url, {
              waitUntil: 'domcontentloaded',
              timeout: RESTORE_LOAD_TIMEOUT_MS,
            })
            .catch(() => undefined)
        }
      })
      if (opened === 0) continue
      watchWindow({ browser, logger }, p.name)
      done.push(p.name)
      logger.info('restore: profile restored', { pages: opened })
    } catch {
      logger.warn('restore: a profile could not be restored')
    }
  }
  return done
}
export const restoreFileOf = (home: string): string => path.join(home, RESTORE_FILE)
