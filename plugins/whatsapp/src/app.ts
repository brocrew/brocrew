import type { AddressInfo } from 'node:net'
import { startHttpMcpServer } from './shared/httpMcpServer.js'
import type { RunningHttpMcpServer } from './shared/httpMcpServer.js'
import { createToolServer } from './shared/toolServer.js'
import type { Bridge } from './bridge.js'
import { ConfigError } from './config.js'
import type { WhatsAppConfig } from './config.js'
import { createAuthMiddleware } from './http/auth.js'
import { registerAdminRoutes } from './http/adminRoutes.js'
import { createLogger } from './logger.js'
import type { Logger } from './logger.js'
import { createSendPolicy } from './policy.js'
import { createRefusals } from './refusals.js'
import { createSettingsStore } from './settings.js'
import type { SettingsStore } from './settings.js'
import { createWhatsAppTools } from './tools/index.js'
import releaseMetadata from '../manifest-template.json' with { type: 'json' }
export const VERSION = releaseMetadata.version
export interface AppDeps {
  bridge: Bridge
  settings?: SettingsStore
  logger?: Logger
  now?: () => number
}
export interface RunningWhatsApp {
  httpServer: RunningHttpMcpServer['httpServer']
  settings: SettingsStore
  close(): Promise<void>
}
export async function startWhatsApp(
  config: WhatsAppConfig,
  deps: AppDeps,
): Promise<RunningWhatsApp> {
  const logger = deps.logger ?? createLogger('whatsapp')
  const settings = deps.settings ?? createSettingsStore(config.home)
  const tools = createWhatsAppTools({
    config,
    bridge: deps.bridge,
    settings,
    policy: createSendPolicy(deps.now),
    refusals: createRefusals(config.home, config.files),
  })
  const server = await startHttpMcpServer({
    port: config.port,
    middleware: [createAuthMiddleware(config.token, config.adminToken, logger)],
    createServer: () => createToolServer({ name: 'whatsapp', version: VERSION, tools }),
    setupRoutes: (app) =>
      registerAdminRoutes(app, { bridge: deps.bridge, settings, logger, version: VERSION }),
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
  return { httpServer: server.httpServer, settings, close: () => server.close() }
}
export async function assertAuthEnforced(port: number, host = '127.0.0.1'): Promise<void> {
  for (const [method, path] of [
    ['GET', '/healthz'],
    ['GET', '/v1/status'],
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
