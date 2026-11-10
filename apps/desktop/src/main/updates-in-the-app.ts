import { ipcMain } from './app-ipc'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { BrowserWindow, net, shell } from 'electron'
import type { App } from 'electron'
import type { AppUpdater, BaseUpdater } from 'electron-updater'
import { UPDATES_CHANNELS, type UpdateChannel } from '../shared/updates'
import { shownVersion } from './build-identity'
import { defaultDataFolder } from './data-folder'
import {
  diskImageOf,
  downloadChecked,
  downloadUrlOf,
  feedOfTheApp,
  privateDownloadUrlOf,
  privateFeedToken,
} from './guided-update'
import { otherDataFolder } from './launch-presentation'
import { otherBroBotsRunning } from './other-brobots'
import { startTheInstaller, theWayBack } from './reopen-after-update'
import type { RuntimeHost } from './runtime/runtime-host'
import { readUpdateSettings, updateSettingsOf, writeUpdateSettings } from './update-settings'
import type { UpdateFeedRoute } from './update-feed'
import {
  createUpdates,
  parseSettingsChange,
  theAutoUpdaterOf,
  type FoundUpdate,
  type Updates,
} from './updates'

/**
 * Updates, wired to Electron: electron-updater checks the release feed and downloads the Windows
 * installer; the Mac's disk image is downloaded and checked in `guided-update.ts`. Every rule is
 * `updates.ts`'s. A development build, or a packaged one with no `app-update.yml`, never checks.
 */

/**
 * Other feeds replace the updater's per-install rollout ID with the same value on every computer.
 * The public website provider removes that header altogether.
 */
const NOBODY_IN_PARTICULAR = { 'x-user-staging-id': '00000000-0000-0000-0000-000000000000' }

export function startUpdates(options: {
  /**
   * Electron's `app`, handed in: only `index.ts` may hold it, because it pins the data folder before
   * anything reads it, and the modules it imports run first.
   */
  readonly app: App
  readonly host: RuntimeHost
  /** A hidden launch (every test and smoke): its own settings, and no Finder window. */
  readonly hidden: boolean
}): Updates & { drain(): Promise<void> } {
  const { app } = options
  rmSync(join(app.getPath('userData'), 'updates', 'staging'), { recursive: true, force: true })
  const feed = app.isPackaged ? feedOfTheApp(join(process.resourcesPath, 'app-update.yml')) : null
  const settings = updateSettingsOf({
    appData: app.getPath('appData'),
    userData: app.getPath('userData'),
    hidden: options.hidden,
  })

  let loaded: Promise<AppUpdater> | null = null
  let publicFeed: UpdateFeedRoute | null = null
  /** The updater once loaded: an installer is started from a `quit` listener, which cannot wait. */
  let updater: AppUpdater | null = null
  const theUpdater = (): Promise<AppUpdater> => {
    loaded ??= import('electron-updater').then(async (exported) => {
      const autoUpdater = theAutoUpdaterOf(exported)
      // Nothing downloads or installs unless the person chooses (`updates.ts`).
      autoUpdater.autoDownload = false
      autoUpdater.autoInstallOnAppQuit = false
      autoUpdater.allowDowngrade = false
      autoUpdater.requestHeaders = NOBODY_IN_PARTICULAR
      const { publicUpdateFeed, websiteUpdatesEnabled, UPDATE_REQUEST_HEADERS } =
        await import('./update-feed')
      publicFeed = publicUpdateFeed({
        feed,
        version: app.getVersion(),
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
      updater = autoUpdater
      return autoUpdater
    })
    return loaded
  }

  /**
   * The installer starts from `quit`, after the ordinary teardown, as electron-updater's own
   * install-on-quit does: started earlier, it would stop BroCrew's processes while they close. It
   * reopens BroCrew on the workspace it was running (`reopen-after-update.ts`).
   */
  let installOnTheWayOut = false
  /** The installer electron-updater downloaded and checked: what a waiting PowerShell runs. */
  let installer: string | null = null
  const userData = app.getPath('userData')
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
    // If this start fails, electron-updater's own start still brings BroCrew back.
    try {
      const pid = startTheInstaller({ installer, folder: wayBack.folder, env: process.env })
      if (pid === undefined) throw new Error('the installer did not start')
    } catch (error) {
      console.error(`updates: ${String(error)}; the installer starts BroCrew again instead`)
      theInstallersWayBack()
    }
  })

  const guidedDownloads = new AbortController()
  const pendingGuides = new Set<Promise<string>>()
  const openedThisRun = new Map<string, string>()
  const updates = createUpdates({
    version: shownVersion(app.getVersion(), app.isPackaged),
    notHere: !app.isPackaged ? 'a-development-build' : feed === null ? 'no-release-feed' : null,
    installs: process.platform === 'darwin' ? 'guided' : 'on-restart',
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
        const downloaded = await autoUpdater.downloadUpdate()
        installer =
          downloaded.find((file) => file.toLowerCase().endsWith('.exe')) ?? downloaded[0] ?? null
      } finally {
        autoUpdater.off('download-progress', progress)
      }
    },
    install: () => {
      installOnTheWayOut = true
      app.quit()
    },
    guide: async (found, onPercent) => {
      guidedDownloads.signal.throwIfAborted()
      if (feed === null) throw new Error('this build has no release feed')
      const image = diskImageOf(found)
      if (image === null) throw new Error(`release ${found.version} has no disk image for the Mac`)
      let path = openedThisRun.get(found.version)
      if (path === undefined || !existsSync(path)) {
        // A hidden launch puts nothing in anybody's Downloads: its own data folder keeps it.
        const folder = options.hidden
          ? join(app.getPath('userData'), 'updates')
          : app.getPath('downloads')
        mkdirSync(folder, { recursive: true })
        const stagingFolder = join(app.getPath('userData'), 'updates', 'staging')
        mkdirSync(stagingFolder, { recursive: true })
        const token = privateFeedToken(feed, process.env)
        const url =
          publicFeed !== null
            ? publicFeed.downloadUrl(found.version, image.url)
            : token === null || feed.provider !== 'github'
              ? downloadUrlOf(feed, found.version, image.url)
              : await privateDownloadUrlOf({ feed, version: found.version, file: image.url, token })
        guidedDownloads.signal.throwIfAborted()
        const pending = downloadChecked({
          url,
          sha512: image.sha512,
          signal: guidedDownloads.signal,
          to: join(folder, basename(image.url)),
          stagingFolder,
          onPercent,
          fetch: (address, init) => net.fetch(address, init),
        })
        pendingGuides.add(pending)
        try {
          path = await pending
        } finally {
          pendingGuides.delete(pending)
        }
        openedThisRun.set(found.version, path)
      }
      guidedDownloads.signal.throwIfAborted()
      // A hidden launch opens nothing on anybody's screen.
      if (!options.hidden) {
        const failure = await shell.openPath(path)
        if (failure !== '')
          throw new Error(`it was downloaded and checked, but did not open: ${failure}`)
      }
      return path
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
    // Each send guarded on its own: a window on its way out throws.
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

  // Any quit ends the updates, so a waiting restart is not installed while the app closes.
  const stop = (): void => {
    guidedDownloads.abort()
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
  ipcMain.handle(UPDATES_CHANNELS.cancelRestart, () => updates.cancelRestart())
  updates.start()
  return {
    ...updates,
    stop,
    drain: async () => {
      stop()
      await Promise.allSettled([...pendingGuides])
    },
  }
}
