import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startWhatsApp } from './app.js'
import type { RunningWhatsApp } from './app.js'
import { startBridge } from './bridge.js'
import type { Bridge } from './bridge.js'
import { ConfigError, loadConfig } from './config.js'
import { createLogger } from './logger.js'
import { createSettingsStore } from './settings.js'

/** The bridge program's SHA-256, written in when the package is built. */
declare const BROCREW_BRIDGE_SHA256: string

async function main(): Promise<void> {
  const logger = createLogger('whatsapp')
  let running: RunningWhatsApp
  let bridge: Bridge
  try {
    const config = loadConfig(process.env)
    const settings = createSettingsStore(config.home)
    bridge = startBridge({
      config,
      program: path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        'bin',
        process.platform === 'win32' ? 'whatsapp-bridge.exe' : 'whatsapp-bridge',
      ),
      sha256: BROCREW_BRIDGE_SHA256,
      logger,
      onUnlinked: () => settings.forgetGroups(),
    })
    running = await startWhatsApp(config, { bridge, settings, logger })
  } catch (e) {
    process.stderr.write(
      `whatsapp: cannot start: ${e instanceof ConfigError ? e.message : e instanceof Error ? e.name : 'unknown error'}\n`,
    )
    process.exit(1)
  }
  if (process.connected)
    process.send?.({
      channel: 'brocrew-plugin-node:v1',
      runId: process.env.BROCREW_PLUGIN_RUN_ID,
      type: 'listening',
      port: (running.httpServer.address() as { port: number }).port,
    })
  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    void Promise.allSettled([bridge.close(), running.close()]).then(() => process.exit(0))
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
  process.on('unhandledRejection', (e) =>
    logger.error('unhandled rejection', { errorName: e instanceof Error ? e.name : typeof e }),
  )
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main()

export { startWhatsApp } from './app.js'
export { loadConfig } from './config.js'
