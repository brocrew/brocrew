import { ipcMain } from './app-ipc'
import { join } from 'node:path'
import { autoUpdater as nativeUpdater, BrowserWindow, dialog } from 'electron'
import type { App } from 'electron'
import type { AppUpdater, BaseUpdater } from 'electron-updater'
import { UPDATES_CHANNELS, type UpdateChannel } from '../shared/updates'
import { shownVersion } from './build-identity'
import { defaultDataFolder, workspaceOf } from './data-folder'
import { feedOfTheApp } from './release-feed'
import { otherDataFolder } from './launch-presentation'
import { macAppProcesses, otherBroBotsRunning } from './other-brobots'
import { readWorkspaceForUpdate, requestWorkspaceUpdate } from './one-host-gate'
import { readWorkspaceList, workspaceListFile } from './workspaces'
import { packagedWorkspaceOwners } from './workspace-routing-store'
import { workspaceUpdate, type UpdateWorkspace } from './update-workspaces'
import { startTheInstaller, theWayBack } from './reopen-after-update'
import type { RuntimeHost } from './runtime/runtime-host'
import {
  readUpdateSettings,
  rememberUpdateWorkspaces,
  updateSettingsOf,
  writeUpdateSettings,
} from './update-settings'
import {
  createUpdates,
  parseSettingsChange,
  theAutoUpdaterOf,
  type FoundUpdate,
  type Updates,
} from './updates'

declare const __BROCREW_RELEASE_BUILD__: boolean | undefined

const NOBODY_IN_PARTICULAR = { 'x-user-staging-id': '00000000-0000-0000-0000-000000000000' }

export function startUpdates(options: {
  readonly app: App
  readonly host: RuntimeHost
  readonly hidden: boolean
  readonly prepareForQuit: () => Promise<void>
}): Updates & {
  drain(): Promise<void>
  workspaceUpdates: ReturnType<typeof workspaceUpdate>
  finishQuit(): boolean
} {
  const { app } = options
  const feed = app.isPackaged ? feedOfTheApp(join(process.resourcesPath, 'app-update.yml')) : null
  const settings = updateSettingsOf({
    appData: app.getPath('appData'),
    userData: app.getPath('userData'),
    hidden: options.hidden,
  })

  const nativeFailure = (error: Error): void => updates.restartFailed(error)
  let loaded: Promise<AppUpdater> | null = null
  let updater: AppUpdater | null = null
  const theUpdater = (): Promise<AppUpdater> => {
    loaded ??= import('electron-updater').then(async (exported) => {
      const autoUpdater = theAutoUpdaterOf(exported)
      autoUpdater.autoDownload = false
      autoUpdater.autoInstallOnAppQuit = false
      if (process.platform === 'darwin') autoUpdater.autoInstallOnAppQuit = true
      autoUpdater.allowDowngrade = false
      autoUpdater.requestHeaders = NOBODY_IN_PARTICULAR
      const { publicUpdateFeed, websiteUpdatesEnabled, UPDATE_REQUEST_HEADERS } =
        await import('./update-feed')
      const publicFeed = publicUpdateFeed({
        feed,
        version: app.getVersion(),
        qa:
          typeof __BROCREW_RELEASE_BUILD__ === 'undefined' ||
          !__BROCREW_RELEASE_BUILD__ ||
          process.env.GITHUB_ACTIONS === 'true' ||
          process.env.BROCREW_QA === '1',
        mayUseWebsite: () =>
          websiteUpdatesEnabled(readUpdateSettings(settings.file, settings.defaults)),
      })
      if (publicFeed !== null) {
        autoUpdater.setFeedURL(publicFeed.provider)
        autoUpdater.requestHeaders = UPDATE_REQUEST_HEADERS
      }
      autoUpdater.logger = {
        info: (message?: unknown) => console.info(`updater: ${String(message)}`),
        warn: (message?: unknown) => console.warn(`updater: ${String(message)}`),
        error: (message?: unknown) => console.error(`updater: ${String(message)}`),
      }
      if (process.platform === 'darwin') autoUpdater.on('error', nativeFailure)
      updater = autoUpdater
      return autoUpdater
    })
    return loaded
  }

  let installOnTheWayOut = false
  let installer: string | null = null
  let stopNativePreparation: (() => void) | undefined
  const userData = app.getPath('userData')
  let nativeInstallOnQuit = false
  let nativeInstalled = false
  const installNative = (): void => {
    if (nativeInstalled) return
    nativeInstalled = true
    updater!.quitAndInstall()
  }
  const workspaceUpdates: ReturnType<typeof workspaceUpdate> = workspaceUpdate({
    self: {
      folder: userData,
      pid: process.pid,
      startedAt: performance.timeOrigin,
      executable: process.execPath,
      name: workspaceOf(userData, userData === defaultDataFolder(app.getPath('appData'))).name,
    },
    ready: () => {
      const state = updates.snapshot().state
      return state.kind === 'ready' || state.kind === 'waiting-to-restart'
    },
    discover: async (): Promise<readonly UpdateWorkspace[]> => {
      const list = workspaceListFile({
        appData: app.getPath('appData'),
        userData,
        hidden: options.hidden,
        packaged: app.isPackaged,
      })
      const folders = new Set([
        userData,
        ...readWorkspaceList(list).map((row) => row.path),
        ...(options.hidden ? [] : packagedWorkspaceOwners(app.getPath('appData'))),
      ])
      const peers = (
        await Promise.all(
          [...folders].map((folder) =>
            folder === userData ? workspaceUpdates.details() : readWorkspaceForUpdate(folder),
          ),
        )
      ).filter(
        (peer): peer is UpdateWorkspace => peer !== null && peer.executable === process.execPath,
      )
      const pids = await macAppProcesses(process.execPath)
      if (
        pids.length !== peers.length ||
        pids.some((pid) => !peers.some((peer) => peer.pid === pid))
      ) {
        throw new Error('A running copy of BroCrew could not be matched to its workspace')
      }
      return peers
    },
    request: requestWorkspaceUpdate,
    prepare: options.prepareForQuit,
    remember: (version, folders) =>
      rememberUpdateWorkspaces(settings.file, { executable: process.execPath, version, folders }),
    report: (error) => console.error('BroCrew update could not confirm a workspace reply:', error),
    quit: () => app.quit(),
    install: installNative,
  })
  const wayBack = theWayBack(
    userData,
    otherDataFolder(userData, defaultDataFolder(app.getPath('appData'))) === null,
  )
  app.on('quit', () => {
    if (!installOnTheWayOut || updater === null) return
    const theInstallersWayBack = (): void => void (updater as BaseUpdater).install(true, true)
    if (wayBack.on === 'the-default-workspace' || installer === null) {
      theInstallersWayBack()
      return
    }
    console.info(
      `updates: installing ${installer}, then reopening BroCrew with --user-data-dir=${wayBack.folder}`,
    )
    try {
      const pid = startTheInstaller({ installer, folder: wayBack.folder, env: process.env })
      if (pid === undefined) throw new Error('the installer did not start')
    } catch (error) {
      console.error(`updates: ${String(error)}; the installer starts BroCrew again instead`)
      theInstallersWayBack()
    }
  })

  const updates = createUpdates({
    updateNow: process.platform === 'darwin',
    version: shownVersion(app.getVersion(), app.isPackaged),
    notHere: !app.isPackaged ? 'a-development-build' : feed === null ? 'no-release-feed' : null,
    settings: {
      read: () => readUpdateSettings(settings.file, settings.defaults),
      write: (chosen) => writeUpdateSettings(settings.file, chosen),
    },
    check: async (channel: UpdateChannel): Promise<FoundUpdate | null> => {
      if (process.env.BROCREW_SKIP_UPDATE_CHECK === '1') return null
      const autoUpdater = await theUpdater()
      autoUpdater.allowPrerelease = channel === 'beta'
      const result = await autoUpdater.checkForUpdates()
      if (result === null || !result.isUpdateAvailable) return null
      return {
        version: result.updateInfo.version,
        files: result.updateInfo.files.map((file) => ({
          url: file.url,
          sha512: file.sha512,
          ...(file.size === undefined ? {} : { size: file.size }),
        })),
      }
    },
    download: async (_found, onPercent) => {
      const autoUpdater = await theUpdater()
      const progress = (info: { percent: number }): void => onPercent(info.percent)
      autoUpdater.on('download-progress', progress)
      try {
        if (process.platform === 'darwin') {
          let ready!: () => void
          let failed!: (error: Error) => void
          const staged = new Promise<void>((resolve, reject) => {
            ready = resolve
            failed = reject
          })
          nativeUpdater.once('update-downloaded', ready)
          autoUpdater.once('error', failed)
          stopNativePreparation = () => failed(new Error('BroCrew is closing'))
          try {
            await Promise.all([autoUpdater.downloadUpdate(), staged])
          } finally {
            nativeUpdater.off('update-downloaded', ready)
            autoUpdater.off('error', failed)
            stopNativePreparation = undefined
          }
          return
        }
        const downloaded = await autoUpdater.downloadUpdate()
        installer =
          downloaded.find((file) => file.toLowerCase().endsWith('.exe')) ?? downloaded[0] ?? null
      } finally {
        autoUpdater.off('download-progress', progress)
      }
    },
    install: () => {
      if (process.platform === 'darwin') {
        nativeInstallOnQuit = true
        app.quit()
        return
      }
      installOnTheWayOut = true
      app.quit()
    },
    conversationsARestartWouldStop: () => options.host.whatARestartWouldStop(),
    otherWorkspacesRunning: () =>
      otherBroBotsRunning(
        process.execPath,
        new Set([process.pid, ...app.getAppMetrics().map((metric) => metric.pid)]),
      ),
    now: () => Date.now(),
    later: (run, ms) => {
      const timer = setTimeout(run, ms)
      timer.unref()
      return () => clearTimeout(timer)
    },
    publish: (snapshot) => {
      for (const window of BrowserWindow.getAllWindows()) {
        try {
          if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
            window.webContents.send(UPDATES_CHANNELS.changed, snapshot)
          }
        } catch (error) {
          console.error('BroCrew could not tell a window about updates:', error)
        }
      }
    },
    log: (line) => console.info(line),
  })

  const stop = (): void => {
    stopNativePreparation?.()
    if (process.platform === 'darwin') updater?.off('error', nativeFailure)
    updates.stop()
  }
  app.on('before-quit', stop)
  ipcMain.handle(UPDATES_CHANNELS.read, () => updates.snapshot())
  ipcMain.handle(UPDATES_CHANNELS.checkNow, () => updates.checkNow())
  ipcMain.handle(UPDATES_CHANNELS.set, (_event, change: unknown) =>
    updates.set(parseSettingsChange(change)),
  )
  ipcMain.handle(UPDATES_CHANNELS.download, () => updates.download())
  ipcMain.handle(UPDATES_CHANNELS.restartWhenQuiet, () => updates.restartWhenQuiet())
  ipcMain.handle(UPDATES_CHANNELS.restartPlan, async () =>
    (await workspaceUpdates.plan()).map(({ folder, name }) => ({ path: folder, name })),
  )
  ipcMain.handle(UPDATES_CHANNELS.restartNow, async () => {
    const state = updates.snapshot().state
    if (
      process.platform !== 'darwin' ||
      (state.kind !== 'ready' && state.kind !== 'waiting-to-restart')
    )
      return updates.snapshot()
    try {
      await workspaceUpdates.restart(state.version)
    } catch (error) {
      console.error('BroCrew could not update its workspaces:', error)
      if (!options.hidden)
        dialog.showErrorBox(
          'BroCrew could not update',
          error instanceof Error ? error.message : String(error),
        )
      throw error
    }
    return updates.snapshot()
  })
  ipcMain.handle(UPDATES_CHANNELS.cancelRestart, () => updates.cancelRestart())
  updates.start()
  return {
    ...updates,
    workspaceUpdates,
    finishQuit: () => {
      if (workspaceUpdates.finishQuit()) return true
      if (!nativeInstallOnQuit) return false
      installNative()
      return true
    },
    stop,
    drain: () => {
      stop()
      return Promise.resolve()
    },
  }
}
