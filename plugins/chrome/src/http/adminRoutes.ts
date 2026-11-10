import type { Express, Request, Response } from 'express'
import type { Logger } from '../logger.js'
import { BrowserNotFoundError, ProfileInUseError } from '../browser/profileBrowser.js'
import type { ProfileBrowser } from '../browser/profileBrowser.js'
import {
  DESCRIPTION_MAX,
  FLAG_NAMES,
  PROFILE_NAME,
  ProfileStoreError,
  RENAME_ERRORS,
  checkDescription,
  isProfileName,
} from '../profiles/store.js'
import { ProfileInUseElsewhereError } from '../profiles/sharedStore.js'
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
    'Give at least one of enabled, allowExtensions, allowSettings, allowSync, each true or false.',
  confirm: 'Type the profile name to confirm.',
  description: `The description must be plain text of at most ${DESCRIPTION_MAX} characters.`,
  temporary:
    'A temporary profile has no account: it cannot be opened for the user and cannot get extension, settings or sync access.',
  inUse: 'The profile is open in another Chrome.',
  deleteInUse: 'Turn this profile off and wait for agent work to finish, then try again.',
  noBrowser: 'Install Google Chrome, then try again.',
  helper: 'Enable this profile first, then turn the helper on.',
  failed: 'The request could not be completed.',
} as const
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
type AdminCommand = (
  input: { body: unknown; profile?: unknown },
  res: Response,
) => void | Promise<void>
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
    const applied = res.locals.configuration && status >= 200 && status < 300
    res.status(applied ? 200 : status).json(applied ? { applied: true } : body)
  }
  const commands = new Map<string, AdminCommand>()
  const command = (action: string, path: string, handle: AdminCommand): void => {
    commands.set(action, handle)
    app.post('/v1' + path, (req, res) => handle({ body: req.body, profile: req.params.name }, res))
  }
  const fail = (res: Response, status: number, error: string): void => send(res, status, { error })
  const view = (name: string): Record<string, unknown> | undefined => {
    const rec = store.get(name)
    if (!rec) return undefined
    const s = browser.state(name)
    return {
      ...rec,
      ...store.shared?.view(name),
      ...(rec.deleting ? { status: 'deleting' } : {}),
      open: s !== null,
      mode: s?.mode ?? null,
      helperOff: rec.helper === 'off',
    }
  }
  const bodyOf = (input: unknown, allowed: readonly string[]): Record<string, unknown> | null => {
    const b = input === undefined || input === null ? {} : input
    return isRecord(b) && Object.keys(b).every((k) => allowed.includes(k)) ? b : null
  }
  const named = (name: unknown, res: Response): string | null => {
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
  const tabs = async (): Promise<AdminTab[]> => {
    const tabs = deps.tabs.list((name) => browser.state(name)?.generation ?? null).slice(0, 200)
    return Promise.all(
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
  }
  app.get('/v1/tabs', async (_req, res) => send(res, 200, { tabs: await tabs() }))
  app.get('/v1/profiles', (_req, res) =>
    send(res, 200, { profiles: store.list().map((p) => view(p.name)) }),
  )
  app.get('/v1/configuration', async (_req, res) =>
    send(res, 200, { profiles: store.list().map((p) => view(p.name)), tabs: await tabs() }),
  )
  app.post('/v1/configuration', async (req, res) => {
    const { payload, configRevision } = req.body ?? {}
    if (!Number.isSafeInteger(configRevision) || configRevision < 0 || !isRecord(payload))
      return fail(res, 400, ADMIN_ERRORS.body)
    const { action, profile, ...body } = payload
    const handle = typeof action === 'string' ? commands.get(action) : undefined
    if (!handle) return fail(res, 400, ADMIN_ERRORS.body)
    res.locals.configuration = true
    try {
      await handle(
        { profile, body: action === 'create-profile' ? { ...body, name: profile } : body },
        res,
      )
    } catch (error) {
      fail(res, 500, error instanceof Error ? error.message : String(error))
    }
  })
  command('create-profile', '/profiles', ({ body: input }, res) => {
    const body = bodyOf(input, ['name', 'description'])
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
      if (res.locals.configuration && !(e instanceof ProfileStoreError)) throw e
      if (e instanceof ProfileStoreError && /description/.test(e.message))
        return fail(res, 400, ADMIN_ERRORS.description)
      return e instanceof ProfileStoreError && /already exists/.test(e.message)
        ? fail(res, 409, ADMIN_ERRORS.exists)
        : fail(res, 400, ADMIN_ERRORS.failed)
    }
    deps.logger.info('profile created', { by: 'panel' })
    send(res, 201, { profile: view(body.name) })
  })
  command('set-flags', '/profiles/:name/flags', async ({ profile, body: input }, res) => {
    const name = named(profile, res)
    if (!name) return
    const body = bodyOf(input, FLAG_NAMES)
    if (!body || Object.keys(body).length === 0) return fail(res, 400, ADMIN_ERRORS.flags)
    if (Object.values(body).some((v) => typeof v !== 'boolean'))
      return fail(res, 400, ADMIN_ERRORS.flags)
    const before = store.get(name)
    if (
      before?.temporary &&
      (body.allowExtensions === true || body.allowSettings === true || body.allowSync === true)
    )
      return fail(res, 400, ADMIN_ERRORS.temporary)
    store.setFlags(name, body as Partial<Record<(typeof FLAG_NAMES)[number], boolean>>)
    const extensionsChanged =
      body.allowExtensions !== undefined &&
      before !== undefined &&
      body.allowExtensions !== before.allowExtensions
    if (body.enabled === false || extensionsChanged)
      await browser
        .exclusive(name, () => browser.close(name))
        .catch((error) => {
          if (res.locals.configuration) throw error
        })
    deps.logger.info('profile flags changed', { flags: Object.keys(body) })
    send(res, 200, { profile: view(name) })
  })
  commands.set('set-enabled', commands.get('set-flags')!)
  command('helper-on', '/profiles/:name/helper', async ({ profile, body }, res) => {
    const name = named(profile, res)
    if (!name) return
    if (!bodyOf(body, [])) return fail(res, 400, ADMIN_ERRORS.body)
    if (store.get(name)?.enabled !== true) return fail(res, 409, ADMIN_ERRORS.helper)
    store.setHelper(name, 'turning-on')
    await browser.turnHelperOn(name).catch((error) => {
      if (res.locals.configuration) throw error
    })
    deps.logger.info('BroCrew helper turned on', { by: 'panel' })
    send(res, 200, { profile: view(name) })
  })
  command('open-window', '/profiles/:name/open', async ({ profile, body }, res) => {
    const name = named(profile, res)
    if (!name) return
    if (!bodyOf(body, [])) return fail(res, 400, ADMIN_ERRORS.body)
    if (store.get(name)?.temporary) return fail(res, 400, ADMIN_ERRORS.temporary)
    try {
      await deps.opener.open(name)
    } catch (e) {
      if (e instanceof ProfileInUseElsewhereError) return fail(res, 409, e.message)
      if (e instanceof ProfileInUseError) return fail(res, 409, ADMIN_ERRORS.inUse)
      if (e instanceof BrowserNotFoundError) return fail(res, 409, ADMIN_ERRORS.noBrowser)
      if (res.locals.configuration) throw e
      deps.logger.warn('open window failed to open')
      return fail(res, 409, ADMIN_ERRORS.failed)
    }
    send(res, 202, { profile: view(name) })
  })
  command('rename-profile', '/profiles/:name/rename', ({ profile, body: input }, res) => {
    const name = named(profile, res)
    if (!name) return
    const body = bodyOf(input, ['newName'])
    if (!body || typeof body.newName !== 'string') return fail(res, 400, ADMIN_ERRORS.body)
    try {
      store.rename(name, body.newName)
      send(res, 200, { profile: view(name) })
    } catch (error) {
      const message = error instanceof ProfileStoreError ? error.message : ''
      if (message === RENAME_ERRORS.invalid) return fail(res, 400, message)
      if (message === RENAME_ERRORS.duplicate || message === RENAME_ERRORS.deleting)
        return fail(res, 409, message)
      if (res.locals.configuration) throw error
      return fail(res, 409, ADMIN_ERRORS.failed)
    }
  })
  command('set-description', '/profiles/:name/description', ({ profile, body: input }, res) => {
    const name = named(profile, res)
    if (!name) return
    const body = bodyOf(input, ['description'])
    if (!body || typeof body.description !== 'string') return fail(res, 400, ADMIN_ERRORS.body)
    try {
      store.setDescription(name, body.description)
    } catch (e) {
      if (res.locals.configuration && !(e instanceof ProfileStoreError)) throw e
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
  command('delete-profile', '/profiles/:name/delete', async ({ profile, body: input }, res) => {
    const name = named(profile, res)
    if (!name) return
    const body = bodyOf(input, ['confirm', 'deleteConfirmation'])
    if (!body) return fail(res, 400, ADMIN_ERRORS.body)
    if (body.confirm !== name) return fail(res, 400, ADMIN_ERRORS.confirm)
    try {
      await browser.removeWhenIdle(name, () => {
        if (store.shared?.view(name).shared === true) {
          if (typeof body.deleteConfirmation !== 'string')
            throw new ProfileStoreError('Review the global deletion warning first.')
          store.shared.remove(name, body.deleteConfirmation)
        } else {
          store.setFlags(name, { enabled: false })
          store.remove(name)
        }
      })
    } catch (error) {
      if (error instanceof ProfileInUseElsewhereError) return fail(res, 409, error.message)
      if (error instanceof ProfileStoreError) return fail(res, 409, error.message)
      if (error instanceof ProfileInUseError) return fail(res, 409, ADMIN_ERRORS.deleteInUse)
      if (res.locals.configuration) throw error
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
