import type { Express, Request, Response } from 'express'
import type { Logger } from '../logger.js'
import { BrowserNotFoundError, ProfileInUseError } from '../browser/profileBrowser.js'
import type { ProfileBrowser } from '../browser/profileBrowser.js'
import {
  DESCRIPTION_MAX,
  FLAG_NAMES,
  PROFILE_NAME,
  ProfileStoreError,
  checkDescription,
  isProfileName,
} from '../profiles/store.js'
import type { ProfileStore } from '../profiles/store.js'
import type { WindowTasks } from '../windows.js'
import { bareUrl } from '../tabs.js'
import type { TabRegistry } from '../tabs.js'
import type { ProfileOpener } from '../openWindow.js'
export interface AdminDeps {
  store: ProfileStore
  browser: ProfileBrowser
  windows: WindowTasks
  opener: ProfileOpener
  logger: Logger
  version: string
  tabs: TabRegistry
}
export const ADMIN_ERRORS = {
  body: 'The request body must be a JSON object with only the allowed fields.',
  name: 'Profile names are 1-32 characters of a-z, 0-9 and dash.',
  unknown: 'There is no such profile.',
  exists: 'A profile with that name already exists.',
  flags:
    'Give at least one of enabled, allowExtensions, allowSettings, allowSync, keepRunning, each true or false.',
  confirm: 'Type the profile name to confirm.',
  description: `The description must be plain text of at most ${DESCRIPTION_MAX} characters.`,
  temporary:
    'A temporary profile has no account: it cannot be opened for the user and cannot get extension, settings, sync or keep-running access.',
  inUse: 'The profile is open in another Chrome.',
  noBrowser: 'Install Google Chrome, then try again.',
  failed: 'The request could not be completed.',
} as const
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
export const actorOf = (req: Request): 'panel' | 'direct-bearer' =>
  req.headers['x-brocrew-actor'] === 'panel' ? 'panel' : 'direct-bearer'
export function registerAdminRoutes(app: Express, deps: AdminDeps): void {
  const { store, browser } = deps
  app.use('/v1/profiles', (req, res, next) => {
    if (req.method === 'POST') {
      res.on('finish', () => {
        const parts = (req.originalUrl ?? req.url).split('?')[0].split('/').filter(Boolean).slice(2)
        const target =
          parts[0] && isProfileName(parts[0])
            ? parts[0]
            : parts.length === 0 && isRecord(req.body) && isProfileName(req.body.name)
              ? req.body.name
              : undefined
        deps.logger.info('admin action', {
          action: parts[1] ?? 'create',
          profile: target,
          actor: actorOf(req),
          origin: 'none',
          status: res.statusCode,
        })
      })
    }
    next()
  })
  const send = (res: Response, status: number, body: unknown): void => {
    res.status(status).json(body)
  }
  const fail = (res: Response, status: number, error: string): void => send(res, status, { error })
  const view = (name: string): Record<string, unknown> | undefined => {
    const rec = store.get(name)
    if (!rec) return undefined
    const s = browser.state(name)
    return {
      ...rec,
      open: s !== null,
      mode: s?.mode ?? null,
    }
  }
  const bodyOf = (req: Request, allowed: readonly string[]): Record<string, unknown> | null => {
    const b = req.body === undefined || req.body === null ? {} : req.body
    return isRecord(b) && Object.keys(b).every((k) => allowed.includes(k)) ? b : null
  }
  const named = (req: Request, res: Response): string | null => {
    const name = req.params.name
    if (!isProfileName(name)) {
      fail(res, 400, ADMIN_ERRORS.name)
      return null
    }
    if (!store.get(name)) {
      fail(res, 404, ADMIN_ERRORS.unknown)
      return null
    }
    return name
  }
  app.get('/healthz', (_req, res) => send(res, 200, { ok: true, version: deps.version }))
  app.get('/v1/tabs', async (_req, res) => {
    const tabs = deps.tabs.list((name) => browser.state(name)?.generation ?? null).slice(0, 200)
    const rows: AdminTab[] = await Promise.all(
      tabs.map(async (tab) => ({
        id: tab.id,
        profile: tab.profile,
        url: bareUrl(tab.page.url()).slice(0, 2048),
        title: await Promise.race([
          tab.page.title().catch(() => ''),
          new Promise<string>((resolve) => {
            const timer = setTimeout(() => resolve(''), 250)
            timer.unref()
          }),
        ]).then((v) => v.slice(0, 512)),
      })),
    )
    const reply: AdminTabList = { tabs: rows }
    send(res, 200, reply)
  })
  app.get('/v1/profiles', (_req, res) =>
    send(res, 200, { profiles: store.list().map((p) => view(p.name)) }),
  )
  app.post('/v1/profiles', (req, res) => {
    const body = bodyOf(req, ['name', 'description'])
    if (!body) return fail(res, 400, ADMIN_ERRORS.body)
    if (typeof body.name !== 'string' || !PROFILE_NAME.test(body.name))
      return fail(res, 400, ADMIN_ERRORS.name)
    try {
      store.create(
        body.name,
        'panel',
        body.description === undefined ? {} : { description: checkDescription(body.description) },
      )
    } catch (e) {
      if (e instanceof ProfileStoreError && /description/.test(e.message))
        return fail(res, 400, ADMIN_ERRORS.description)
      return e instanceof ProfileStoreError && /already exists/.test(e.message)
        ? fail(res, 409, ADMIN_ERRORS.exists)
        : fail(res, 400, ADMIN_ERRORS.failed)
    }
    deps.logger.info('profile created', { by: 'panel' })
    send(res, 201, { profile: view(body.name) })
  })
  app.post('/v1/profiles/:name/flags', async (req, res) => {
    const name = named(req, res)
    if (!name) return
    const body = bodyOf(req, FLAG_NAMES)
    if (!body || Object.keys(body).length === 0) return fail(res, 400, ADMIN_ERRORS.flags)
    if (Object.values(body).some((v) => typeof v !== 'boolean'))
      return fail(res, 400, ADMIN_ERRORS.flags)
    const before = store.get(name)
    if (
      before?.temporary &&
      (body.allowExtensions === true ||
        body.allowSettings === true ||
        body.allowSync === true ||
        body.keepRunning === true)
    )
      return fail(res, 400, ADMIN_ERRORS.temporary)
    store.setFlags(name, body as Partial<Record<(typeof FLAG_NAMES)[number], boolean>>)
    const extensionsChanged =
      body.allowExtensions !== undefined &&
      before !== undefined &&
      body.allowExtensions !== before.allowExtensions
    if (body.enabled === false || extensionsChanged)
      await browser.exclusive(name, () => browser.close(name)).catch(() => undefined)
    deps.logger.info('profile flags changed', { flags: Object.keys(body) })
    send(res, 200, { profile: view(name) })
  })
  app.post('/v1/profiles/:name/open', async (req, res) => {
    const name = named(req, res)
    if (!name) return
    if (!bodyOf(req, [])) return fail(res, 400, ADMIN_ERRORS.body)
    if (store.get(name)?.temporary) return fail(res, 400, ADMIN_ERRORS.temporary)
    try {
      await deps.opener.open(name)
    } catch (e) {
      if (e instanceof ProfileInUseError) return fail(res, 409, ADMIN_ERRORS.inUse)
      if (e instanceof BrowserNotFoundError) return fail(res, 409, ADMIN_ERRORS.noBrowser)
      deps.logger.warn('open window failed to open')
      return fail(res, 409, ADMIN_ERRORS.failed)
    }
    send(res, 202, { profile: view(name) })
  })
  app.post('/v1/profiles/:name/description', (req, res) => {
    const name = named(req, res)
    if (!name) return
    const body = bodyOf(req, ['description'])
    if (!body || typeof body.description !== 'string') return fail(res, 400, ADMIN_ERRORS.body)
    try {
      store.setDescription(name, body.description)
    } catch (e) {
      return fail(
        res,
        400,
        e instanceof ProfileStoreError && /description/.test(e.message)
          ? ADMIN_ERRORS.description
          : ADMIN_ERRORS.failed,
      )
    }
    send(res, 200, { profile: view(name) })
  })
  app.post('/v1/profiles/:name/delete', async (req, res) => {
    const name = named(req, res)
    if (!name) return
    const body = bodyOf(req, ['confirm'])
    if (!body) return fail(res, 400, ADMIN_ERRORS.body)
    if (body.confirm !== name) return fail(res, 400, ADMIN_ERRORS.confirm)
    try {
      await browser.exclusive(name, async () => {
        await browser.close(name)
        store.remove(name)
      })
    } catch {
      return fail(res, 409, ADMIN_ERRORS.failed)
    }
    deps.logger.info('profile deleted')
    send(res, 200, { deleted: name })
  })
}

export interface AdminTab {
  id: string
  profile: string
  url: string
  title: string
}
export interface AdminTabList {
  tabs: AdminTab[]
}
