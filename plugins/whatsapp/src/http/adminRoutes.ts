import type { Express, Request, Response } from 'express'
import type { Bridge } from '../bridge.js'
import type { Logger } from '../logger.js'
import { GROUP_ID, type SettingsStore } from '../settings.js'

export interface AdminDeps {
  bridge: Bridge
  settings: SettingsStore
  logger: Logger
  version: string
}
export interface AdminSettings {
  read: boolean
  prefix: boolean
  groups: Array<{ jid: string; name: string; canWrite: boolean }>
}
/** Inside the app's 45 seconds for an uninstall's log out; the bridge itself takes at most about 35. */
const UNINSTALL_MS = 40_000
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const actorOf = (req: Request): 'panel' | 'direct-bearer' =>
  req.headers['x-brocrew-actor'] === 'panel' ? 'panel' : 'direct-bearer'

/** The settings page's routes. They carry the person's choices; agents never reach them. */
export function registerAdminRoutes(app: Express, deps: AdminDeps): void {
  const { bridge, settings } = deps
  app.use('/v1', (req, res, next) => {
    if (req.method === 'POST')
      res.on('finish', () =>
        deps.logger.info('admin action', {
          action: req.path.slice(1),
          actor: actorOf(req),
          status: res.statusCode,
        }),
      )
    next()
  })
  const send = (res: Response, status: number, body: unknown): void => {
    const applied = res.locals.configuration && status >= 200 && status < 300
    res.status(applied ? 200 : status).json(applied ? { applied: true } : body)
  }
  type AdminCommand = (body: unknown, res: Response) => void | Promise<void>
  const commands = new Map<string, AdminCommand>()
  const command = (action: string, path: string, handle: AdminCommand): void => {
    commands.set(action, handle)
    app.post('/v1' + path, (req, res) => handle(req.body, res))
  }
  const invalid = (res: Response): void => send(res, 400, { error: 'invalid' })
  const bodyOf = (input: unknown, allowed: readonly string[]): Record<string, unknown> | null => {
    const b = input === undefined || input === null ? {} : input
    return isRecord(b) && Object.keys(b).every((k) => allowed.includes(k)) ? b : null
  }
  const view = (): AdminSettings => {
    const current = settings.get()
    const writable = new Set(current.writable)
    return {
      read: current.read,
      prefix: current.prefix,
      groups: bridge
        .groups()
        .map((group) => ({ jid: group.jid, name: group.name, canWrite: writable.has(group.jid) })),
    }
  }
  const switched = (
    input: unknown,
    res: Response,
    change: (body: Record<string, unknown>) => void | false,
    allowed: readonly string[] = ['enabled'],
  ): void => {
    const body = bodyOf(input, allowed)
    if (!body || typeof body.enabled !== 'boolean') return invalid(res)
    try {
      if (change(body) === false) return invalid(res)
    } catch (error) {
      if (res.locals.configuration) throw error
      return invalid(res)
    }
    send(res, 200, view())
  }

  app.get('/healthz', (_req, res) => send(res, 200, { ok: true, version: deps.version }))
  app.get('/v1/status', (_req, res) => send(res, 200, bridge.status()))
  app.get('/v1/settings', (_req, res) => send(res, 200, view()))
  app.get('/v1/configuration', (_req, res) =>
    send(res, 200, { status: bridge.status(), ...view() }),
  )
  app.post('/v1/configuration', async (req, res) => {
    const { payload, configRevision } = req.body ?? {}
    if (!Number.isSafeInteger(configRevision) || configRevision < 0 || !isRecord(payload))
      return invalid(res)
    const { action, ...body } = payload
    const handle = typeof action === 'string' ? commands.get(action) : undefined
    if (!handle) return invalid(res)
    res.locals.configuration = true
    try {
      await handle(body, res)
    } catch (error) {
      send(res, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  })
  command('refresh-groups', '/refresh-groups', async (body, res) => {
    if (!bodyOf(body, [])) return invalid(res)
    try {
      await bridge.refreshGroups()
      send(res, 200, view())
    } catch (error) {
      if (res.locals.configuration) throw error
      send(res, 503, { error: 'unavailable' })
    }
  })
  command('link-phone', '/link', async (body, res) => {
    if (!bodyOf(body, [])) return invalid(res)
    if (!(await bridge.pair())) return send(res, 409, { error: 'state' })
    send(res, 200, bridge.status())
  })
  command('unlink-phone', '/unlink', (body, res) => {
    if (!bodyOf(body, [])) return invalid(res)
    const work = bridge.unlink()
    if (res.locals.configuration) return work.then(() => send(res, 200, {}))
    send(res, 202, {})
  })
  const beforeRemove = async (req: Request, res: Response): Promise<void> => {
    if (!bodyOf(req.body, [])) return invalid(res)
    const before = bridge.status()
    let timer: NodeJS.Timeout | undefined
    try {
      const done = await Promise.race([
        bridge.unlink().then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), UNINSTALL_MS)
        }),
      ])
      if (!done) return send(res, 504, { error: 'timeout' })
      const after = bridge.status()
      const confirmed =
        before.state === 'linked' &&
        before.removeOnPhone === false &&
        after.state === 'unlinked' &&
        after.removeOnPhone === false
      send(
        res,
        200,
        req.path === '/v1/uninstall'
          ? {}
          : {
              notice: confirmed
                ? 'WhatsApp’s device was logged out.'
                : 'Logout was not confirmed. Open Linked devices on your phone and remove this device if it is still listed.',
            },
      )
    } finally {
      clearTimeout(timer)
    }
  }
  app.post(['/v1/uninstall', '/v1/before-remove'], (req, res, next) => {
    void beforeRemove(req, res).catch(next)
  })
  command('set-read', '/read', (body, res) =>
    switched(body, res, (body) => {
      settings.setRead(body.enabled as boolean)
    }),
  )
  command('set-prefix', '/prefix', (body, res) =>
    switched(body, res, (body) => {
      settings.setPrefix(body.enabled as boolean)
    }),
  )
  command('set-group-write', '/group-write', (body, res) =>
    switched(
      body,
      res,
      (body) => {
        const group = body.group
        if (
          typeof group !== 'string' ||
          !GROUP_ID.test(group) ||
          (body.enabled === true && !bridge.groups().some((one) => one.jid === group))
        )
          return false
        settings.setWritable(group, body.enabled as boolean)
      },
      ['group', 'enabled'],
    ),
  )
}
