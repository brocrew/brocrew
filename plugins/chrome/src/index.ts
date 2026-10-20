import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { installShutdownSignals } from './shared/browser/shutdownSignals.js'
import type { BrowserChoice } from './shared/browser/launchConfig.js'
import { startAgentChrome } from './app.js'
import type { RunningAgentChrome } from './app.js'
import { ChromeBrowser } from './browser/chromeBrowser.js'
import type { ChromeBrowserOptions } from './browser/chromeBrowser.js'
import { ConfigError, loadConfig } from './config.js'
import type { AgentChromeConfig } from './config.js'
import { restoreFileOf, restoreVisibleSession, saveVisibleSession } from './restoreSession.js'
import { createLogger } from './logger.js'
import type { Logger } from './logger.js'
import { createProfileStore } from './profiles/store.js'
import type { ProfileStore } from './profiles/store.js'
export function createChromeBrowser(
  store: ProfileStore,
  logger: Logger,
  idleMs?: number,
  browser?: BrowserChoice,
  over: Partial<ChromeBrowserOptions> = {},
): ChromeBrowser {
  return new ChromeBrowser({
    dirOf: store.dirOf,
    logger,
    ...(idleMs !== undefined ? { idleMs } : {}),
    ...(browser ? { browser } : {}),
    extensionsFor: (name) => store.get(name)?.allowExtensions === true,
    syncFor: (name) => store.get(name)?.allowSync === true,
    keepRunningFor: (name) => {
      const r = store.get(name)
      return r?.keepRunning === true && !r.temporary
    },
    afterIdleClose: (name) => {
      if (store.get(name)?.temporary) {
        logger.info('admin action', {
          action: 'delete',
          profile: name,
          actor: 'idle-close',
          temporary: true,
        })
        store.remove(name)
      }
    },
    ...over,
  })
}
async function main(): Promise<void> {
  const logger = createLogger('agent-chrome')
  let running: RunningAgentChrome
  let browser: ChromeBrowser
  let config: AgentChromeConfig
  let store: ProfileStore
  try {
    config = loadConfig(process.env)
    store = createProfileStore({ home: config.home })
    browser = createChromeBrowser(store, logger, undefined, config.browser, {
      noSandbox: config.noSandbox,
      noTestType: config.noTestType,
      downloadsRoot: config.downloadsRoot,
    })
    running = await startAgentChrome(config, { browser, store, logger })
  } catch (e) {
    process.stderr.write(
      `agent-chrome: cannot start: ${e instanceof ConfigError ? e.message : e instanceof Error ? e.name : 'unknown error'}\n`,
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
  const restoreFile = restoreFileOf(config.home)
  installShutdownSignals({
    closeAll: async () => {
      saveVisibleSession(
        restoreFile,
        browser,
        (name) => {
          const r = store.get(name)
          return r !== undefined && r.enabled && !r.temporary
        },
        undefined,
        logger,
      )
      await browser.closeAll()
    },
  })
  void restoreVisibleSession({
    file: restoreFile,
    store,
    browser,
    tabs: running.tabs,
    logger,
  }).catch(() => logger.warn('restore: failed'))
  process.on('unhandledRejection', (e) =>
    logger.error('unhandled rejection', { errorName: e instanceof Error ? e.name : typeof e }),
  )
  void running
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main()

export { startAgentChrome } from './app.js'
export { loadConfig } from './config.js'
export { createProfileStore } from './profiles/store.js'
export { TabRegistry } from './tabs.js'
