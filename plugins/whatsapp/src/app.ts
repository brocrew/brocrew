import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createToolServer } from './shared/toolServer.js'
import type { Bridge } from './bridge.js'
import type { WhatsAppConfig } from './config.js'
import type { Logger } from './logger.js'
import { createSendPolicy } from './policy.js'
import { createRefusals } from './refusals.js'
import { createSettingsStore } from './settings.js'
import type { SettingsStore } from './settings.js'
import { createWhatsAppTools } from './tools/index.js'
import { createConfigurationTools } from './tools/configuration.js'
import releaseMetadata from '../manifest-template.json' with { type: 'json' }
export const VERSION = releaseMetadata.version
export interface AppDeps {
  bridge: Bridge
  settings?: SettingsStore
  logger?: Logger
  now?: () => number
  transport?: Transport
}
export interface RunningWhatsApp {
  settings: SettingsStore
  close(): Promise<void>
}
export function whatsappTools(config: WhatsAppConfig, deps: AppDeps) {
  const settings = deps.settings ?? createSettingsStore(config.home)
  return [
    ...createWhatsAppTools({
      config,
      bridge: deps.bridge,
      settings,
      policy: createSendPolicy(deps.now),
      refusals: createRefusals(config.home, config.files),
    }),
    ...createConfigurationTools({ bridge: deps.bridge, settings }),
  ]
}
export async function startWhatsApp(
  config: WhatsAppConfig,
  deps: AppDeps,
): Promise<RunningWhatsApp> {
  const settings = deps.settings ?? createSettingsStore(config.home)
  const server = createToolServer({
    name: 'whatsapp',
    version: VERSION,
    tools: whatsappTools(config, { ...deps, settings }),
  })
  await server.connect(deps.transport ?? new StdioServerTransport())
  return { settings, close: () => server.close() }
}
