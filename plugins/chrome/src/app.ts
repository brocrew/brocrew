import type { AddressInfo } from 'node:net'
import { startHttpMcpServer, resolveBindHost } from './shared/httpMcpServer.js'
import type { RunningHttpMcpServer } from './shared/httpMcpServer.js'
import { createToolServer } from './shared/toolServer.js'
import { ConfigError } from './config.js'
import type { AgentChromeConfig } from './config.js'
import { createAuthMiddleware } from './http/auth.js'
import { registerAdminRoutes } from './http/adminRoutes.js'
import type { LocalFileGuardConfig } from './localFileGuard.js'
import { createLogger } from './logger.js'
import type { Logger } from './logger.js'
import { createProfileStore } from './profiles/store.js'
import type { ProfileStore } from './profiles/store.js'
import type { ProfileBrowser } from './browser/profileBrowser.js'
import { createKeyedSerializer } from './shared/browser/browser-lease.js'
import type { KeyedSerializer } from './shared/browser/browser-lease.js'
import { createWindowTasks } from './windows.js'
import type { WindowTasks } from './windows.js'
import { TabRegistry } from './tabs.js'
import { createProfileOpener } from './openWindow.js'
import { createAgentChromeTools } from './tools/index.js'
import releaseMetadata from '../manifest-template.json' with { type: 'json' }
export const VERSION = releaseMetadata.version
const ALLOWED_HOSTS = ['localhost', '127.0.0.1', '[::1]']
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1'])
export interface AppDeps {
  browser: ProfileBrowser
  store?: ProfileStore
  serializer?: KeyedSerializer
  logger?: Logger
  guard?: () => LocalFileGuardConfig
  tabs?: TabRegistry
  windows?: WindowTasks
}
export interface RunningAgentChrome {
  httpServer: RunningHttpMcpServer['httpServer']
  store: ProfileStore
  tabs: TabRegistry
  windows: WindowTasks
  close(): Promise<void>
}
export async function startAgentChrome(
  config: AgentChromeConfig,
  deps: AppDeps,
): Promise<RunningAgentChrome> {
  const logger = deps.logger ?? createLogger('agent-chrome')
  if (!LOOPBACK.has(resolveBindHost('127.0.0.1')))
    throw new ConfigError('agent-chrome listens on loopback only; unset MCP_BIND_HOST')
  const store = deps.store ?? createProfileStore({ home: config.home })
  for (const p of store.list().filter((r) => r.temporary)) {
    await deps.browser
      .exclusive(p.name, async () => {
        await deps.browser.close(p.name).catch(() => undefined)
        store.remove(p.name)
      })
      .catch(() => logger.warn('temporary profile could not be removed at start'))
    logger.info('admin action', {
      action: 'delete',
      profile: p.name,
      actor: 'server-start-sweep',
      temporary: true,
    })
  }
  const tabs = deps.tabs ?? new TabRegistry()
  const windows: WindowTasks = deps.windows ?? createWindowTasks({ browser: deps.browser })
  const tools = createAgentChromeTools({
    store,
    browser: deps.browser,
    windows,
    tabs,
    serializer: deps.serializer ?? createKeyedSerializer(),
    guard:
      deps.guard ??
      (() => ({ roots: [config.workspace], hostHome: '', mount: '', maxBytes: 50 * 1024 * 1024 })),
    downloadsRoot: config.downloadsRoot,
    logger,
  })
  const server = await startHttpMcpServer({
    port: config.port,
    host: '127.0.0.1',
    allowedHosts: ALLOWED_HOSTS,
    middleware: [createAuthMiddleware(config.token, config.adminToken, logger)],
    createServer: () => createToolServer({ name: 'agent-chrome', version: VERSION, tools }),
    setupRoutes: (app) =>
      registerAdminRoutes(app, {
        store,
        browser: deps.browser,
        windows,
        tabs,
        opener: createProfileOpener({ browser: deps.browser, tabs, logger }),
        logger,
        version: VERSION,
      }),
  })
  try {
    await assertAuthEnforced((server.httpServer.address() as AddressInfo).port)
  } catch (e) {
    await server.close().catch(() => undefined)
    throw e
  }
  logger.info('listening', {
    host: '127.0.0.1',
    port: (server.httpServer.address() as AddressInfo).port,
  })
  return {
    httpServer: server.httpServer,
    store,
    tabs,
    windows,
    close: async () => {
      for (const p of store.list()) await deps.browser.close(p.name).catch(() => undefined)
      await server.close()
    },
  }
}
export async function assertAuthEnforced(port: number, host = '127.0.0.1'): Promise<void> {
  for (const [method, path] of [
    ['GET', '/healthz'],
    ['GET', '/v1/profiles'],
    ['POST', '/mcp'],
  ] as const) {
    let status: number
    try {
      const res = await fetch(`http://${host}:${port}${path}`, {
        method,
        ...(method === 'POST'
          ? { headers: { 'content-type': 'application/json' }, body: '{}' }
          : {}),
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
      })
      status = res.status
      await res.body?.cancel()
    } catch {
      status = 0
    }
    if (status !== 401) throw new ConfigError('Plugin unavailable. Try again.')
  }
}
