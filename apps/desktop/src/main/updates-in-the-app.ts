import { ipcMain } from './app-ipc'
import { mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { BrowserWindow, net, shell } from 'electron'
import type { App } from 'electron'
import type { AppUpdater, BaseUpdater } from 'electron-updater'
import { UPDATES_CHANNELS, type UpdateChannel } from '../shared/updates'
import { shownVersion } from './build-identity'
import { defaultDataFolder } from './data-folder'
import {
  clearUpdateStaging,
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
import {
  createUpdates,
  parseSettingsChange,
  theAutoUpdaterOf,
  type FoundUpdate,
  type Updates,
} from './updates'

/**
 * 🔴 **W4.109 · B1 — updates, wired to Electron**: electron-updater asks the release feed and
 * downloads the Windows installer; the Mac's disk image is downloaded and checked here
 * (`guided-update.ts`); the host says what a restart would stop. Every rule is `updates.ts`'s.
 *
 * ⚑ A development build never checks (`app.isPackaged`), and neither does a packaged one built
 * with no release feed (no `app-update.yml`: the hand-out builds of `windows.yml` and `macos.yml`).
 * ⚑ electron-updater is loaded only when a check is first made, so a build that never checks never
 * loads it.
 */

/**
 * ⚑ electron-updater sends every request a per-install id it keeps in the data folder
 * (`x-user-staging-id`, for staged rollouts, which BroBot's releases do not use). Replaced by this
 * one, the same on every computer, so a check says nothing about who asked.
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
  clearUpdateStaging(app.getPath('userData'))
  const feed = app.isPackaged ? feedOfTheApp(join(process.resourcesPath, 'app-update.yml')) : null
  const settings = updateSettingsOf({
    appData: app.getPath('appData'),
    userData: app.getPath('userData'),
    hidden: options.hidden,
  })

  let loaded: Promise<AppUpdater> | null = null
  /** The updater once loaded: an installer is started from a `quit` listener, which cannot wait. */
  let updater: AppUpdater | null = null
  const theUpdater = (): Promise<AppUpdater> => {
    loaded ??= import('electron-updater').then((exported) => {
      const autoUpdater = theAutoUpdaterOf(exported)
      // ⛔ Nothing downloads or installs unless the person chooses (`updates.ts`).
      autoUpdater.autoDownload = false
      autoUpdater.autoInstallOnAppQuit = false
      autoUpdater.allowDowngrade = false
      autoUpdater.requestHeaders = NOBODY_IN_PARTICULAR
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
   * 🔴 **The installer starts once this app has shut down, never before** (found in the second
   * review). Started first — `quitAndInstall` — it would find BroBot still closing its
   * conversations, wait a second, and stop every process under its folder, the providers' too.
   * So the restart is an ordinary quit (`app-lifetime.ts`: conversations closed, archive drained,
   * database closed), and the installer is started from `quit`, the last event there is — where
   * electron-updater's own install-on-quit starts it, synchronously.
   *
   * 🔴 **W4.128 — and BroBot comes back on the workspace it was running** (`reopen-after-update.ts`):
   * the default workspace as the installer starts it (`--force-run`); any other folder as the
   * installer starts it when BroBot names the folder (`build/installer.nsh`).
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
    // ⚑ Windows' updater is electron-updater's NSIS one, whose `install` starts the installer.
    const theInstallersWayBack = (): void => void (updater as BaseUpdater).install(true, true)
    if (wayBack.on === 'the-default-workspace' || installer === null) {
      theInstallersWayBack()
      return
    }
    console.info(
      `updates: installing ${installer}, then reopening BroCrew with --user-data-dir=${wayBack.folder}`,
    )
    // ⛔ An installer that cannot be started this way is no reason to leave the person with
    // nothing: electron-updater's own start, and its way back on the default workspace, is still a
    // BroBot that comes back.
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
  const updates = createUpdates({
    version: shownVersion(app.getVersion(), app.isPackaged),
    notHere: !app.isPackaged ? 'a-development-build' : feed === null ? 'no-release-feed' : null,
    installs: process.platform === 'darwin' ? 'guided' : 'on-restart',
    settings: {
      read: () => readUpdateSettings(settings.file, settings.defaults),
      write: (chosen) => writeUpdateSettings(settings.file, chosen),
    },
    check: async (channel: UpdateChannel): Promise<FoundUpdate | null> => {
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
      // ⚑ A hidden launch puts nothing in anybody's Downloads: its own data folder keeps it.
      const folder = options.hidden
        ? join(app.getPath('userData'), 'updates')
        : app.getPath('downloads')
      mkdirSync(folder, { recursive: true })
      const stagingFolder = join(app.getPath('userData'), 'updates', 'staging')
      mkdirSync(stagingFolder, { recursive: true, mode: 0o700 })
      const token = privateFeedToken(feed, process.env)
      const url =
        token === null || feed.provider !== 'github'
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
        // ⚑ Its own user agent: Electron's carries this BroCrew's version, and a download says no
        // more than a check does (electron-updater's say `electron-builder`).
        fetch: ((input: string, init?: RequestInit) =>
          net.fetch(input, { ...init, headers: { 'user-agent': 'BroCrew' } })) as typeof fetch,
      })
      pendingGuides.add(pending)
      let path: string
      try {
        path = await pending
      } finally {
        pendingGuides.delete(pending)
      }
      guidedDownloads.signal.throwIfAborted()
      // ⚑ A hidden launch opens nothing on anybody's screen.
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
    // ⚠️ Each send guarded on its own, as `index.ts` does: a window on its way out throws.
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

  // ⛔ Any quit ends the updates: a restart that waits is not installed by a look that answers
  // while the app is closing.
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
