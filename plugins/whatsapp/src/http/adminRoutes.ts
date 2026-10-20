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
    res.status(status).json(body)
  }
  const invalid = (res: Response): void => send(res, 400, { error: 'invalid' })
  const bodyOf = (req: Request, allowed: readonly string[]): Record<string, unknown> | null => {
    const b = req.body === undefined || req.body === null ? {} : req.body
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
    req: Request,
    res: Response,
    change: (body: Record<string, unknown>) => void,
    allowed: readonly string[] = ['enabled'],
  ): void => {
    const body = bodyOf(req, allowed)
    if (!body || typeof body.enabled !== 'boolean') return invalid(res)
    try {
      change(body)
    } catch {
      return invalid(res)
    }
    send(res, 200, view())
  }

  app.get('/healthz', (_req, res) => send(res, 200, { ok: true, version: deps.version }))
  app.get('/v1/status', (_req, res) => send(res, 200, bridge.status()))
  app.get('/v1/settings', (_req, res) => send(res, 200, view()))
  app.post('/v1/refresh-groups', async (req, res) => {
    if (!bodyOf(req, [])) return invalid(res)
    try {
      await bridge.refreshGroups()
      send(res, 200, view())
    } catch {
      send(res, 503, { error: 'unavailable' })
    }
  })
  app.post('/v1/link', async (req, res) => {
    if (!bodyOf(req, [])) return invalid(res)
    if (!(await bridge.pair())) return send(res, 409, { error: 'state' })
    send(res, 200, bridge.status())
  })
  app.post('/v1/unlink', (req, res) => {
    if (!bodyOf(req, [])) return invalid(res)
    void bridge.unlink()
    send(res, 202, {})
  })
  // Before the app deletes the plugin: log out, phone side included, and wait until the data is gone.
  app.post('/v1/uninstall', async (req, res) => {
    if (!bodyOf(req, [])) return invalid(res)
    let timer: NodeJS.Timeout | undefined
    const done = await Promise.race([
      bridge.unlink().then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), UNINSTALL_MS)
      }),
    ])
    clearTimeout(timer)
    if (done) send(res, 200, {})
    else send(res, 504, { error: 'timeout' })
  })
  app.post('/v1/read', (req, res) =>
    switched(req, res, (body) => settings.setRead(body.enabled as boolean)),
  )
  app.post('/v1/prefix', (req, res) =>
    switched(req, res, (body) => settings.setPrefix(body.enabled as boolean)),
  )
  app.post('/v1/group-write', (req, res) =>
    switched(
      req,
      res,
      (body) => {
        const group = body.group
        if (
          typeof group !== 'string' ||
          !GROUP_ID.test(group) ||
          (body.enabled === true && !bridge.groups().some((one) => one.jid === group))
        )
          throw new Error('group')
        settings.setWritable(group, body.enabled as boolean)
      },
      ['group', 'enabled'],
    ),
  )
}
