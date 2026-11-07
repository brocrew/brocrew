import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { installShutdownSignals } from './shared/browser/shutdownSignals.js'
import type { BrowserChoice } from './shared/browser/launchConfig.js'
import { startAgentChrome } from './app.js'
import type { RunningAgentChrome } from './app.js'
import { ChromeBrowser } from './browser/chromeBrowser.js'
import type { ChromeBrowserOptions } from './browser/chromeBrowser.js'
import { loadConfig } from './config.js'
import type { AgentChromeConfig } from './config.js'
import { restoreFileOf, restoreVisibleSession, saveVisibleSession } from './restoreSession.js'
import { createLogger } from './logger.js'
import type { Logger } from './logger.js'
import { createProfileStore } from './profiles/store.js'
import { createSharedProfileStore } from './profiles/sharedStore.js'
import { sharedProfilesRelease, sharedProfilesReleased } from './sharedProfilesRelease.js'
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
    ...(store.shared
      ? { acquireLease: store.shared.acquire, authorization: store.shared.authorization }
      : {}),
    profileExists: (name) => store.get(name) !== undefined,
    logger,
    ...(idleMs !== undefined ? { idleMs } : {}),
    ...(browser ? { browser } : {}),
    extensionsFor: (name) => store.get(name)?.allowExtensions === true,
    syncFor: (name) => store.get(name)?.allowSync === true,
    helperFor: (name) => store.get(name)?.helper ?? 'on',
    rememberHelper: (name, helper) => {
      if (store.get(name) && store.get(name)?.helper !== helper) store.setHelper(name, helper)
    },
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
export function createConfiguredProfileStore(config: AgentChromeConfig): ProfileStore {
  return config.shared && sharedProfilesReleased(process.platform, sharedProfilesRelease)
    ? createSharedProfileStore({
        home: config.home,
        shared: config.shared.root,
        workspaceId: config.shared.workspaceId,
        workspaceLabel: config.shared.workspaceLabel,
        migrationApproved: true,
      })
    : createProfileStore({ home: config.home })
}
async function main(): Promise<void> {
  const logger = createLogger('agent-chrome')
  let running: RunningAgentChrome
  let browser: ChromeBrowser
  let config: AgentChromeConfig
  let store: ProfileStore
  try {
    config = loadConfig(process.env)
    store = createConfiguredProfileStore(config)
    browser = createChromeBrowser(store, logger, undefined, config.browser, {
      noSandbox: config.noSandbox,
      noTestType: config.noTestType,
      downloadsRoot: config.downloadsRoot,
      ...(config.shared ? { helperDir: () => path.join(config.shared!.root, 'helper') } : {}),
      // The package ships the helper beside server.mjs; the working folder never matters.
      helperSource: fileURLToPath(new URL('./helper/', import.meta.url)),
    })
    running = await startAgentChrome(config, { browser, store, logger })
  } catch (e) {
    process.stderr.write(
      `agent-chrome: cannot start: ${e instanceof Error ? e.message : 'unknown error'}\n`,
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
        store.shared ? (name) => store.shared!.identity(name) : undefined,
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
