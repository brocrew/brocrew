import { withWorkerMemory } from './worker-memory'
import { closeDatabase } from './db/close-database'
import electronLog from 'electron-log/main'
import { pluginStartupTrace } from './plugins/startup-failure'
import { providerSetupServices } from './providers/index'
import { setupProcesses } from './provider-setup/process'
import { registerProviderSetup } from './provider-setup/ipc'
import { workspaceLaunchMessage } from './workspace-routing'
import { registerPluginSettings } from './plugins/settings'
import { productionPluginController } from './plugins/production'
import { PluginSupervisorAttachment, pluginSupervisorRoot } from './plugins/supervisor/client'
import { sharedDataOwner } from './plugins/shared-data'
import { PLUGIN_SCHEME } from './plugins/ui/assets'
import { installPluginUiRpc } from './plugins/ui/host'
import { ipcMain } from './app-ipc'
import startStorageWorker from './storage.worker?nodeWorker'
import startRecoveryVerifier from './recovery-verify.worker?nodeWorker'
import { verifyInAWorker } from './recovery/copy-check'
import { StorageService } from './storage/service'
import { startEventRetention } from './storage/event-retention'
import { workspaceCompaction } from './storage/workspace-compaction'
import { clearHttpCache, httpCacheFolder } from './storage/cache'
import { registerStorageIpc } from './storage/ipc'
import { StorageFailure } from './storage/engine'
import { registerVoiceIpc } from './voice/ipc'
import { VoiceService } from './voice/service'
import { runVoiceHelper } from './voice/engine'
import { backupsDir, databaseFile, recoveryDir, SIDECARS } from './recovery/layout'
import { RECOVERY_RETENTION_CHANNELS } from '../shared/recovery-retention'
import type { ListingAnswer } from '../shared/listing-published'
import {
  prune,
  recordSuccessfulStart,
  retainedCopyInfo,
  deleteRetainedCopy,
} from './recovery/checkpoint'
import { installAppNavigation } from './app-navigation'
import { WORKER_OUTPUT_DIRNAME } from './worker-piece-folder'
import { stopOrphanedCommands } from './command-cleanup'
import {
  appLogFile,
  debugIsOn,
  logWarn,
  openLog,
  readDebugChoice,
  saveDebugChoice,
  serviceLogFile,
  setDebug,
} from './logging/log'
import { LOGGING_CHANNELS } from '../shared/logging'
import { broadcastRuntime } from './runtime/window-broadcast'
import { changeNotices } from './runtime/change-notices'
import { execFile, spawn } from 'node:child_process'
import { existsSync, writeSync } from 'node:fs'
import { inspect } from 'node:util'
import { join } from 'node:path'
import { totalmem } from 'node:os'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain as pluginIpcMain,
  Menu,
  nativeImage,
  powerMonitor,
  protocol,
  session,
  shell,
} from 'electron'
import type { NativeImage, OpenDialogOptions, WebContents } from 'electron'
import { appInfoSchema, type AppInfo } from '@brobot2/shared'
import { APP_CLOSING_CHANNEL, RUNTIME_CHANGED_CHANNEL } from '../shared/runtime-ipc'
import { buildBranches, buildIdentity, shownVersion } from './build-identity'
import { createAppLifetime } from './app-lifetime'
import { armLastResortExit } from './last-resort-exit'
import { runAsSoleInstance } from './single-instance'
import {
  KEPT_OUT_OF_SIGHT,
  keepOutOfSight,
  launchPresentation,
  otherDataFolder,
  PERSONS_TITLE,
  windowTitleFor,
} from './launch-presentation'
import { publishWorkspacePresence, type HostGateVerdict } from './one-host-gate'
import {
  AGENTS_LINE_LAG_MS,
  AGENTS_MEMORY_STEP_BYTES,
  agentsMemoryFloorFor,
  startMemoryWatch,
  theAgentsDetail,
  theAgentsHeadline,
  whatItsAgentsHoldApart,
  whatTheAppItselfHolds,
} from './memory-watch'
import { logWhenThePageStopsAnswering } from './page-answers'
import { aPageReceipt, pageHeardSays, type PageReceipt } from './runtime/page-performance'
import {
  MainThreadWork,
  startStallWatch,
  startWatchHealth,
  WhatTheAppWasDoing,
} from './stall-watch'
import {
  PS_ARGS,
  PS_MAX_BUFFER_BYTES,
  PS_TIMEOUT_MS,
  createSpawnedReader,
  totalBytes,
} from './process-tree'
import { openDatabase, type AppDatabase } from './db/connection'
import { workspaceListFile } from './workspaces'
import { samePath } from './same-folder'
import {
  carefulWorkspaceName,
  startDockLabel,
  startingColourFromList,
  type DockLabelHost,
} from './dock-label'
import { DOCK_LABEL_CHANNELS, isDockLabelChange } from '../shared/dock-label'
import { applyMigrations } from './db/migrate'
import { NewerDatabaseError, openOrRefuse, UnreadableDatabaseError } from './db/newer-database'
import type { RecoveryService, StartupVerdict } from '../shared/recovery'
import {
  createRecoveryService,
  createRecoveryServiceForTests,
  faultsFromSwitch,
  KEEP_RECOVERY_WINDOW_SWITCH,
  RECOVERY_FAULT_SWITCH,
  keepsTheRecoveryWindow,
  whyItDidNotStart,
  type CoordinatorDeps,
  type WorkingOn,
} from './recovery/coordinator'
import { buildLineage, type BuildMigration } from './recovery/database-facts'
import { createHistoryReader } from './recovery/history-reader'
import {
  CLOSED_WHILE_CHECKING,
  FAIL_LINE,
  OPENED_FOR_RECOVERY_LINE,
  OPENED_NORMALLY_LINE,
  READY_LINE,
} from './recovery/log-lines'
import { createRecoveryCalls, type RecoveryCalls } from './recovery/window-calls'
import { openRecoveryWindow, registerRecoveryIpc, tellTheWindow } from './recovery-window'
import { aCommandsKind, registerRuntimeIpc, webContentsSink } from './runtime/ipc'
import { sinkOwnerId } from './runtime/window-caller'
import { providerHomesRoot } from './connections/homes'
import { importProviderUsageFile } from './provider-usage-file'
import { importScheduleAttemptsFile } from './schedule-attempts-file'
import { importProfileExecutionFile } from './profile-execution-file'
import { importTurnsTheAppCutFile } from './turns-the-app-cut-file'
import { ASSET_SCHEME_PRIVILEGES, installAssetProtocol } from './asset-protocol'
import { THEME_SCHEME_PRIVILEGES, installThemeProtocol } from './themes/asset-protocol'
import {
  DEFAULT_THEME_BACKGROUND,
  BUILT_IN_THEME_IDS,
  HIDDEN_BASE_THEME_IDS,
  themeDefaultsFor,
} from './themes/defaults'
import { registerThemeIpc } from './themes/ipc'
import { themePictureSampler } from './themes/picture-samples'
import { themeRoots } from './themes/state'
import { ThemeStore } from './themes/store'
import { themeProblem } from './themes/words'
import { THEMES_CHANNELS } from '../shared/theme-library'
import { installCspHeaders, rendererCsp } from '../shared/content-security-policy'
import { RuntimeHost } from './runtime/runtime-host'
import { appMenuTemplate } from './app-menu'
import { nativeTitleBarOptions, updateNativeTitleBar } from './native-title-bar'
import {
  createDraftWriter,
  importDraftsFile,
  requestLastDraftSaves,
  savedDraftsBook,
  type DraftWriter,
} from './drafts-file'
import { restoreSavedDrafts } from './saved-drafts'
import { LAST_DRAFT_SAVE_CHANNEL } from '../shared/saved-drafts'
import { keepTheSystemZone, readTheSystemZoneNow } from './system-zone'
import { LOCAL_ZONE_MOVED_CHANNEL, readLocalTimeFrom, type LocalZone } from '../shared/local-time'
import { resourcesRoot } from './resources/resources'
import { brobotWorkspace } from './runtime/workspace'
import {
  installNavigationGuard,
  installSessionRelease,
  type AppDocument,
} from './window-navigation'
import { startUpdates } from './updates-in-the-app'
import { startWorkspaces } from './workspaces-in-the-app'
import { takeUpdateWorkspaces, updateSettingsOf, updateWorkspacesToReopen } from './update-settings'
import { startProviderSnapshots } from './provider-snapshots'
import { importSignInChangesFile } from './sign-in-changes'
import { importArchivedFile } from './archived-file'
import {
  defaultDataFolder,
  nameTheAppToWindows,
  pinTheDataFolder,
  workspaceStartup,
  workspaceOf,
} from './data-folder'
import { WorkspaceUnavailable } from './workspace-startup'
import { nodeFs as recoveryFiles } from './recovery/files'
import { prepareCheckpointReplacement, captureAfterCompaction } from './recovery/replace-checkpoint'
import { composeRuntimeHost } from './runtime-host-composition'
import { CHOOSE_WORKSPACE_OPTIONS, registerPickerIpc } from './desktop-pickers'
import { registerAttentionSignalsIpc } from './attention-signals-ipc'

const updateReopenAtLaunch =
  app.isPackaged && !app.commandLine.hasSwitch('brobot-hidden')
    ? updateWorkspacesToReopen(
        updateSettingsOf({
          appData: app.getPath('appData'),
          userData: app.getPath('userData'),
          hidden: false,
        }).file,
        process.execPath,
        app.getVersion(),
      )
    : null

try {
  pinTheDataFolder(app, updateReopenAtLaunch?.folders[0])
  workspaceStartup(app)?.assertDatabase()
} catch (error) {
  try {
    const message = workspaceLaunchMessage(error)
    if (app.commandLine.hasSwitch('brobot-hidden')) console.error(message)
    else dialog.showErrorBox('BroCrew', message)
  } finally {
    app.exit(1)
  }
}
nameTheAppToWindows(app)

const STDERR_FD = 2

protocol.registerSchemesAsPrivileged([
  ASSET_SCHEME_PRIVILEGES,
  THEME_SCHEME_PRIVILEGES,
  PLUGIN_SCHEME,
])

const spawnedReader = createSpawnedReader({
  now: () => Date.now(),
  rootPid: process.pid,
  chromiumPids: () => new Set(app.getAppMetrics().map((metric) => metric.pid)),
  read: (done) =>
    void execFile(
      'ps',
      [...PS_ARGS],
      {
        encoding: 'utf8',
        timeout: PS_TIMEOUT_MS,
        maxBuffer: PS_MAX_BUFFER_BYTES,
        killSignal: 'SIGKILL',
      },
      (error, stdout) => done(error, stdout),
    ),
})

let db: AppDatabase | null = null
let startFailed = false

let recoveryService: RecoveryService | null = null
let theDataOpened = false
let recoveryCalls: RecoveryCalls | null = null
let recoveryWindow: BrowserWindow | null = null
let workingOnNow: WorkingOn | null = null
let workingTimer: ReturnType<typeof setTimeout> | null = null
let workingShown: WorkingOn | null = null
let checkingTheData = false
let closedWhileCheckingSaid = false
let saidItDidNotStart = false
let saidOpenedForRecovery = false
let stoppingTheStart: Promise<void> | null = null
const recoveryCopyVerifier = verifyInAWorker((request) =>
  withWorkerMemory('recovery-verify', () =>
    startRecoveryVerifier({
      workerData: request,
      resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 8 },
    }),
  ),
)
const recoveryWork = new Set<Promise<unknown>>()
const recoveryCaptureAbort = new AbortController()
const launchCompaction = workspaceCompaction((maintenance) =>
  withWorkerMemory('storage', () =>
    startStorageWorker({
      workerData: { maintenance },
      resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 8 },
    }),
  ),
)
const recoveryCopyHasher = verifyInAWorker((request) =>
  withWorkerMemory('recovery-verify', () =>
    startRecoveryVerifier({
      workerData: { ...request, hashOnly: true },
      resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 8 },
    }),
  ),
)

let stoppingRecoveryWork: Promise<void> | null = null

function withRecoveryWork<T>(work: () => Promise<T>): Promise<T> {
  if (stoppingRecoveryWork !== null) {
    return Promise.reject(new Error('BroCrew is closing, so recovery work cannot start'))
  }
  const admitted = Promise.resolve().then(work)
  recoveryWork.add(admitted)
  const finished = () => {
    recoveryWork.delete(admitted)
  }
  void admitted.then(finished, finished)
  return admitted
}

function stopRecoveryWork(): Promise<void> {
  stoppingRecoveryWork ??= (async () => {
    recoveryCaptureAbort.abort()
    await Promise.all([
      launchCompaction.stop(),
      recoveryCopyHasher.stop(),
      recoveryCopyVerifier.stop(),
    ])
    await Promise.allSettled([...recoveryWork])
  })()
  return stoppingRecoveryWork
}

let keepTheRecoveryWindowHidden: boolean | null = null
let theOneAppAnswer: HostGateVerdict = 'unknown'
let thisBuildsMigrations: readonly BuildMigration[] | null = null

/**
 * Provider sessions live in the main process. Create the host after `ready` for `userData`;
 * tear it down before quit so no provider child outlives the window.
 */
let host: RuntimeHost | null = null
const pluginSupervisor = new PluginSupervisorAttachment()
let updates: ReturnType<typeof startUpdates> | null = null
let eventRetention: ReturnType<typeof startEventRetention> | undefined
let firstListAcceptedAt: number | undefined
let recoveryMaintenance: Promise<unknown> = Promise.resolve()
let recoveryStartSucceeded = false
let recoveryStartRecorded: Promise<void> | undefined
function withRecoveryCopies<T>(work: () => Promise<T>): Promise<T> {
  const next = recoveryMaintenance.then(work)
  recoveryMaintenance = next.catch(() => undefined)
  return next
}

let signalFirstWindowLoad!: () => void
const firstWindowLoad = new Promise<void>((resolve) => {
  signalFirstWindowLoad = resolve
})
let themes: ThemeStore | null = null
let stopThemeIpc: (() => void) | undefined
let stopProviderSetup: (() => Promise<void>) | undefined
const appSetupWindows = new WeakSet<WebContents>()
let stopStorageIpc: (() => void) | undefined
let stopVoiceIpc: (() => void) | undefined
const storageAppWindows = new WeakSet<WebContents>()
let dockLabel: Promise<DockLabelHost> | undefined

let soleAtThisLaunch = false

let recordedConversation: ((sessionId: string) => boolean) | null = null

let draftWriter: DraftWriter | null = null

const draftReaders = new Map<number, string>()

async function theLastDraftSaves(): Promise<void> {
  const writer = draftWriter
  if (writer === null) return
  const readers = BrowserWindow.getAllWindows().flatMap((window) => {
    if (window.isDestroyed()) return []
    const contents = window.webContents
    const token = draftReaders.get(contents.id)
    return token === undefined ? [] : [{ contents, token }]
  })
  const outcome = await requestLastDraftSaves(writer, readers, LAST_DRAFT_SAVE_CHANNEL)
  if (outcome === 'failed') throw new Error('the last unsent drafts could not be written to disk')
}

function resolveMigrationsFolder(): string {
  const candidates = [
    join(__dirname, 'migrations'),
    join(app.getAppPath(), 'out/main/migrations'),
    join(app.getAppPath(), 'src/main/db/migrations'),
  ]
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'meta', '_journal.json'))) return candidate
  }
  throw new Error(`Could not locate Drizzle migrations. Looked in:\n  ${candidates.join('\n  ')}`)
}

class MigrationFailed extends Error {}

function initDatabase(): AppDatabase {
  const existing = workspaceStartup(app)
  existing?.assertDatabase()
  const dbPath = join(app.getPath('userData'), 'brobot2.sqlite')
  const migrationsFolder = resolveMigrationsFolder()
  const database = (() => {
    try {
      return openDatabase(dbPath, existing ? { fileMustExist: true } : undefined)
    } catch (error) {
      existing?.assertDatabase()
      if (existing) throw new WorkspaceUnavailable(dbPath, error)
      throw error
    }
  })()
  openOrRefuse(database, theBuildsMigrations(), {
    folder: app.getPath('userData'),
  })
  const finishMigration = pluginStartupTrace.begin('database-migration', 'startup')
  try {
    mainThreadWork.timed('database migrations before the window', () =>
      applyMigrations(database, migrationsFolder),
    )
    finishMigration()
  } catch (error) {
    finishMigration(error)
    try {
      database.close()
    } catch {
      // Closed as the process ends.
    }
    throw new MigrationFailed(
      `BroCrew could not update this workspace's data: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
  importArchivedFile(database, app.getPath('userData'))
  importSignInChangesFile(database, app.getPath('userData'))
  importProviderUsageFile(database, app.getPath('userData'))
  importScheduleAttemptsFile(database, app.getPath('userData'))
  importTurnsTheAppCutFile(database, app.getPath('userData'))
  importDraftsFile(database, app.getPath('userData'))
  importProfileExecutionFile(database, app.getPath('userData'))
  db = database
  recoveryStartRecorded = withRecoveryCopies(() =>
    recordSuccessfulStart(app.getPath('userData'), theBuildsMigrations(), {
      ownership: theOneAppAnswer,
      currentAppVersion: app.getVersion(),
    }),
  )
  void recoveryStartRecorded.catch((error) =>
    console.warn('BroCrew could not record its successful start:', error),
  )
  if (presentation.hidden) sayAtOnce(OPENED_NORMALLY_LINE)
  return database
}

function theBuildsMigrations(): readonly BuildMigration[] {
  if (thisBuildsMigrations === null) {
    throw new Error("the start-up check never read this build's migrations")
  }
  return thisBuildsMigrations
}

function migrationsAppliedOrNull(): number | null {
  if (!db) return null
  try {
    const row = db.prepare('SELECT count(*) AS c FROM __drizzle_migrations').get() as
      { c: number } | undefined
    return row?.c ?? null
  } catch {
    return null
  }
}

function readAppInfo(): AppInfo {
  if (!db) throw new Error('Database not initialised')
  const migrationsApplied = migrationsAppliedOrNull() ?? 0
  const sessions = db.prepare('SELECT count(*) AS c FROM provider_session').get() as { c: number }
  const dataFolder = otherDataFolder(
    app.getPath('userData'),
    defaultDataFolder(app.getPath('appData')),
  )
  return appInfoSchema.parse({
    name: 'BroCrew',
    windowTitle: windowTitleFor(presentation, dataFolder),
    workspace: workspaceOf(app.getPath('userData'), dataFolder === null),
    version: shownVersion(app.getVersion(), app.isPackaged),
    step: 'Step 0',
    build: { ...buildIdentity(), branches: buildBranches() },
    db: { migrationsApplied, providerSessionCount: sessions.c },
  })
}

const pluginController = productionPluginController()

function createRuntimeHost(database: AppDatabase): Promise<RuntimeHost> {
  return composeRuntimeHost(database, {
    firstWindowLoad,
    mainThreadWork,
    pluginController,
    pluginSupervisor,
    presentation,
    windowChangeNotices,
    migrationsAppliedOrNull,
    themes: () => themes,
    soleAtThisLaunch: () => soleAtThisLaunch,
    databaseClosed: () => db === null,
    keepRecordedConversation: (recorded) => {
      recordedConversation = recorded
    },
  })
}

const presentation = launchPresentation((name) => app.commandLine.hasSwitch(name))

const windowChangeNotices = changeNotices(
  (message) =>
    broadcastRuntime(
      () => BrowserWindow.getAllWindows(),
      RUNTIME_CHANGED_CHANNEL,
      message,
      (error) => console.error('BroCrew could not tell a window that something moved:', error),
      mainThreadWork,
      'window change broadcast',
    ),
  (flush) => setImmediate(flush),
)

const mainThreadWork = new MainThreadWork()

const whatTheAppWasDoing = new WhatTheAppWasDoing(true)

let thePageIsVisible = true

let theScreenIsLocked = false

let lookAtTheWindow: () => void = () => {}

let thePageReceipt: PageReceipt | null = null
let debugChoiceRead: Promise<void> = Promise.resolve()

function intoTheStallLog(line: string): void {
  logWarn('stall', line)
}

if (presentation.hidden) {
  process.on('uncaughtException', (error) => {
    console.error(`${KEPT_OUT_OF_SIGHT} an uncaught exception`, error)
  })
}

async function pick(
  owner: BrowserWindow | null,
  options: OpenDialogOptions,
): Promise<{ canceled: boolean; filePaths: string[] }> {
  if (presentation.hidden) {
    console.info(`${KEPT_OUT_OF_SIGHT} a picker was asked for and answered cancelled`)
    return { canceled: true, filePaths: [] }
  }
  return owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options)
}

function registerIpc(runtimeHost: RuntimeHost, localZone: () => LocalZone | null): void {
  stopProviderSetup = registerProviderSetup(
    ipcMain,
    providerSetupServices({
      platform: process.platform,
      systemRoot: process.env.SystemRoot,
      ...setupProcesses(process.platform, process.env.SystemRoot),
    }),
    (event) =>
      !event.sender.isDestroyed() &&
      appSetupWindows.has(event.sender) &&
      event.senderFrame === event.sender.mainFrame,
    (provider, kind) => runtimeHost.providerSetupCompleted(provider, kind),
  )
  const storageData = app.getPath('userData')
  let storagePlugins: string | null = null
  try {
    storagePlugins = pluginSupervisorRoot({
      appData: app.getPath('appData'),
      workspaceRoot: storageData,
      hidden: presentation.hidden,
      scratchRoot: app.commandLine.getSwitchValue('plugin-global-root'),
    })
  } catch {
    // An unavailable plugin root remains unavailable in Storage too.
  }
  const loggingState = async () => {
    await debugChoiceRead
    return {
      debug: debugIsOn(),
      path: appLogFile(storageData),
      servicePath: storagePlugins ? serviceLogFile(storagePlugins) : null,
    }
  }
  ipcMain.handle(LOGGING_CHANNELS.get, loggingState)
  ipcMain.handle(LOGGING_CHANNELS.setDebug, async (_event, debug: unknown) => {
    if (typeof debug !== 'boolean') throw new Error('Invalid debug choice.')
    await saveDebugChoice(storageData, debug)
    setDebug(debug)
    return loggingState()
  })
  const storage = new StorageService(
    {
      data: storageData,
      workspace: brobotWorkspace(storageData),
      providers: providerHomesRoot(storageData),
      output: join(storageData, WORKER_OUTPUT_DIRNAME),
      database: [
        databaseFile(storageData),
        ...SIDECARS.map((suffix) => databaseFile(storageData) + suffix),
      ],
      backups: [backupsDir(storageData), recoveryDir(storageData)],
      recovery: recoveryDir(storageData),
      plugins: storagePlugins,
      sharedPlugins:
        !presentation.hidden && storagePlugins
          ? join(app.getPath('appData'), '@brobot2', 'shared')
          : null,
      cache: httpCacheFolder(session.defaultSession.storagePath),
      resources: resourcesRoot(storageData),
    },
    (roots, request) =>
      withWorkerMemory('storage', () =>
        startStorageWorker({
          workerData: { roots, request },
          resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 8 },
        }),
      ),
  )
  stopStorageIpc = registerStorageIpc(ipcMain, storage, {
    reveal: (path) => shell.showItemInFolder(path),
    clearCache: () => clearHttpCache(storage, () => session.defaultSession.clearCache()),
    pruneBackups: () =>
      withRecoveryCopies(async () => {
        if (!recoveryStartSucceeded || theOneAppAnswer !== 'sole')
          throw new StorageFailure('unavailable')
        let failed = false
        await prune(app.getPath('userData'), theBuildsMigrations(), {
          ownership: 'sole',
          currentAppVersion: app.getVersion(),
          warn: (line) => {
            failed = true
            console.warn(line)
          },
        })
        if (failed) throw new StorageFailure('unavailable')
      }),
    isAppWindow: (event) =>
      storageAppWindows.has(event.sender) &&
      !event.sender.isDestroyed() &&
      event.senderFrame === event.sender.mainFrame,
  })
  stopVoiceIpc = registerVoiceIpc(
    ipcMain,
    new VoiceService((state) => {
      if (process.platform !== 'darwin') throw new Error('Voice input requires macOS')
      const binary = app.isPackaged
        ? join(process.resourcesPath, '..', 'Helpers', 'brocrew-voice')
        : join(app.getAppPath(), 'resources', 'voice', process.arch, 'brocrew-voice')
      return runVoiceHelper(binary, state)
    }),
    (event) =>
      storageAppWindows.has(event.sender) &&
      !event.sender.isDestroyed() &&
      event.senderFrame === event.sender.mainFrame,
    (url) => shell.openExternal(url),
  )
  installPluginUiRpc(pluginIpcMain)
  registerPluginSettings(
    ipcMain,
    (event) => BrowserWindow.fromWebContents(event.sender),
    pluginController,
  )
  ipcMain.handle(RECOVERY_RETENTION_CHANNELS.read, () =>
    withRecoveryCopies(() =>
      retainedCopyInfo(app.getPath('userData'), theBuildsMigrations(), {
        ownership: theOneAppAnswer,
        currentAppVersion: app.getVersion(),
      }),
    ),
  )
  ipcMain.handle(RECOVERY_RETENTION_CHANNELS.delete, (_event, id: unknown) =>
    withRecoveryCopies(async () => {
      if (
        !recoveryStartSucceeded ||
        typeof id !== 'string' ||
        !(await deleteRetainedCopy(app.getPath('userData'), theBuildsMigrations(), id, {
          ownership: theOneAppAnswer,
          currentAppVersion: app.getVersion(),
        }))
      )
        throw new Error('The recovery copy could not be deleted.')
    }),
  )
  ipcMain.handle('app:info', () => readAppInfo())
  registerAttentionSignalsIpc()
  const database = db
  if (database === null) throw new Error('Database not initialised')
  const writer = createDraftWriter(database)
  draftWriter = writer
  ipcMain.handle('app:saved-drafts', (event) => {
    const reader = event.sender
    const frame = event.senderFrame
    if (frame && !frame.isDestroyed() && !frame.detached && frame === reader.mainFrame) {
      if (!draftReaders.has(reader.id)) {
        const forget = (): void => {
          draftReaders.delete(reader.id)
          reader.removeListener('render-process-gone', forget)
          reader.removeListener('destroyed', forget)
          reader.removeListener('did-navigate', forget)
        }
        reader.once('render-process-gone', forget)
        reader.once('destroyed', forget)
        reader.once('did-navigate', forget)
      }
      draftReaders.set(reader.id, frame.frameToken)
    }
    return restoreSavedDrafts(savedDraftsBook(database), {
      exists: (sessionId) => recordedConversation?.(sessionId) ?? true,
    })
  })
  ipcMain.handle('app:save-drafts', (event, saved: unknown) => {
    const frame = event.senderFrame
    return writer.write(saved, frame && !frame.isDestroyed() ? frame.frameToken : undefined)
  })
  ipcMain.handle('app:local-zone', () => localZone())
  registerPickerIpc(pick)
  thePageReceipt = aPageReceipt({
    closing: () => runtimeHost.closing,
    log: intoTheStallLog,
    visibility: (visible) => {
      thePageIsVisible = visible
      lookAtTheWindow()
    },
  })
  const libraryWindows = new WeakSet<Electron.WebContents>()
  registerRuntimeIpc({
    ipc: {
      handle: (channel, listener) =>
        ipcMain.handle(channel, async (event, ...args) => {
          const kind = aCommandsKind(args[0])
          const finishFirstList =
            kind === 'listConversations' && firstListAcceptedAt === undefined
              ? pluginStartupTrace.begin('first-list', 'startup')
              : undefined
          try {
            const answer = await mainThreadWork.timed(`command ${kind}`, () =>
              listener(event, ...args),
            )
            if (kind === 'listConversations') {
              const refused = 'refused' in (answer as ListingAnswer)
              if (!refused) {
                firstListAcceptedAt ??= performance.now()
                eventRetention?.firstListAccepted(firstListAcceptedAt)
              }
              finishFirstList?.(refused ? 'refused' : undefined)
            }
            return answer
          } catch (error) {
            finishFirstList?.(error)
            throw error
          }
        }),
    },
    host: runtimeHost,
    sinkFor: (event) => {
      const sink = webContentsSink(event.sender, mainThreadWork)
      if (!libraryWindows.has(event.sender)) {
        libraryWindows.add(event.sender)
        const closeLibrary = () => {
          void runtimeHost.closeFilesLibraryWindow(sink.ownerId)
          void runtimeHost.closeTeamProfileGraphWindow(sink.ownerId)
        }
        event.sender.on('render-process-gone', closeLibrary)
        event.sender.once('destroyed', closeLibrary)
      }
      return sink
    },
    pageReceipt: thePageReceipt,
  })
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1200,
    height: 840,
    ...nativeTitleBarOptions(process.platform, themes?.titleBar()),
    show: false,
    title: 'BroCrew',
    backgroundColor: themes?.background() ?? DEFAULT_THEME_BACKGROUND,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  appSetupWindows.add(window.webContents)
  storageAppWindows.add(window.webContents)
  if (presentation.hidden) keepOutOfSight(window)
  window.webContents.once('did-finish-load', () => signalFirstWindowLoad())
  window.on('ready-to-show', () => {
    if (!presentation.hidden) window.show()
  })
  thePageIsVisible = true
  const sight = (): void => {
    if (window.isDestroyed()) return
    const inUse =
      window.isVisible() &&
      !window.isMinimized() &&
      window.isFocused() &&
      thePageIsVisible &&
      !theScreenIsLocked
    if (inUse) whatTheAppWasDoing.inSight()
    else whatTheAppWasDoing.outOfSight()
  }
  lookAtTheWindow = sight
  window.on('show', sight)
  window.on('hide', sight)
  window.on('minimize', sight)
  window.on('restore', sight)
  window.on('focus', sight)
  window.on('blur', sight)
  window.on('closed', () => whatTheAppWasDoing.outOfSight())
  installAppNavigation(window)
  logWhenThePageStopsAnswering(window, intoTheStallLog)

  const entry = appDocument()
  installNavigationGuard(window.webContents, entry, (url) => void shell.openExternal(url))

  const ownerId = sinkOwnerId(window.webContents)
  const releaseSessions = (): void => {
    void host?.closeSessionsForOwner(ownerId)
  }
  installSessionRelease(window.webContents, releaseSessions)

  if (entry.devServerUrl !== undefined) {
    void window.loadURL(entry.devServerUrl)
  } else {
    void window.loadFile(entry.indexHtml)
  }
}

function appDocument(): AppDocument {
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  return {
    indexHtml: join(__dirname, '../renderer/index.html'),
    ...(devServerUrl ? { devServerUrl } : {}),
  }
}

function isDevServer(): boolean {
  return appDocument().devServerUrl !== undefined
}

const SAY_WORKING_AFTER_MS = 2000

function sayAtOnce(line: string): void {
  const bytes = Buffer.from(`${line}\n`, 'utf8')
  try {
    for (let written = 0; written < bytes.length;) {
      written += writeSync(STDERR_FD, bytes, written, bytes.length - written)
    }
  } catch {
    console.error(line)
  }
}

function theRecoveryService(launchOwnership: HostGateVerdict): RecoveryService {
  const existing = workspaceStartup(app)
  existing?.assertDatabase()
  const { commit } = buildIdentity()
  const userData = app.getPath('userData')
  theOneAppAnswer = launchOwnership
  const deps: CoordinatorDeps = {
    userData,
    buildMigrationsFolder: resolveMigrationsFolder(),
    appVersion: app.getVersion(),
    build: commit === '' ? null : commit,
    packaged: app.isPackaged,
    ...(existing
      ? {
          requireExistingDatabase: true,
          fs: { ...recoveryFiles, mkdir: existing.mkdir.bind(existing) },
        }
      : {}),
    ownership: () => Promise.resolve(launchOwnership),
    log: sayAtOnce,
    working: (what) => sayWorkingIfItTakesLong(what),
    progress: (done, total) => recoveryCalls?.progress(done, total),
    verifyCopy: recoveryCopyVerifier.verify,
    hashCopy: recoveryCopyHasher.verify,
    signal: recoveryCaptureAbort.signal,
  }
  const asked = app.commandLine.getSwitchValue(RECOVERY_FAULT_SWITCH)
  if (asked === '') return createRecoveryService(deps)
  if (app.isPackaged) {
    console.warn(`BroCrew ignored --${RECOVERY_FAULT_SWITCH}: a packaged build takes no test fault`)
    return createRecoveryService(deps)
  }
  const faults = faultsFromSwitch(asked)
  if (faults === null) {
    console.warn(`BroCrew ignored --${RECOVERY_FAULT_SWITCH}=${asked}: it names no step it knows`)
    return createRecoveryService(deps)
  }
  console.warn(
    `BroCrew runs with a test fault in its recovery steps: --${RECOVERY_FAULT_SWITCH}=${asked}`,
  )
  const { buildMigrationsFolder, ...rest } = deps
  return createRecoveryServiceForTests({ ...rest, migrationsFolder: buildMigrationsFolder, faults })
}

async function theVerdictBeforeTheData(launchOwnership: HostGateVerdict): Promise<StartupVerdict> {
  const service = theRecoveryService(launchOwnership)
  recoveryService = service
  checkingTheData = true
  try {
    const verdict = await withRecoveryWork(() => service.inspect())
    workspaceStartup(app)?.assertDatabase()
    if (verdict.kind === 'open') {
      thisBuildsMigrations = await buildLineage(resolveMigrationsFolder())
    }
    return verdict
  } finally {
    checkingTheData = false
    if (workingTimer !== null) clearTimeout(workingTimer)
    workingTimer = null
    workingOnNow = null
  }
}

async function compactDataBeforeOpen(): Promise<void> {
  const userData = app.getPath('userData')
  const existing = workspaceStartup(app)
  existing?.assertDatabase()
  const { commit } = buildIdentity()
  const options = {
    userData,
    ownership: theOneAppAnswer,
    appVersion: app.getVersion(),
    signal: recoveryCaptureAbort.signal,
    ...(existing ? { fs: { ...recoveryFiles, mkdir: existing.mkdir.bind(existing) } } : {}),
  }
  checkingTheData = true
  const finishCompaction = pluginStartupTrace.begin('workspace-compaction', 'startup')
  try {
    await withRecoveryWork(() =>
      withRecoveryCopies(() =>
        launchCompaction.run(
          databaseFile(userData),
          (needed) => prepareCheckpointReplacement(options, theBuildsMigrations(), needed),
          () => {
            sayWorkingIfItTakesLong('checkpoint')
            return captureAfterCompaction({
              ...options,
              build: commit === '' ? null : commit,
              verifyCopy: recoveryCopyVerifier.verify,
              hashCopy: recoveryCopyHasher.verify,
              progress: (done, total) => recoveryCalls?.progress(done, total),
            })
          },
          (done, total) => {
            sayWorkingIfItTakesLong('compact')
            recoveryCalls?.progress(done, total)
          },
        ),
      ),
    )
    finishCompaction()
  } catch (error) {
    finishCompaction(error)
    if (recoveryCaptureAbort.signal.aborted) throw error
    console.warn('BroCrew could not make its workspace smaller at this launch:', error)
  } finally {
    checkingTheData = false
    if (workingTimer !== null) clearTimeout(workingTimer)
    workingTimer = null
    workingOnNow = null
  }
  existing?.assertDatabase()
}

function sayWorkingIfItTakesLong(what: WorkingOn): void {
  if (recoveryCalls !== null) {
    if (workingShown !== null && workingShown !== what) showRecovery({ kind: 'working', what })
    return
  }
  workingOnNow = what
  if (presentation.hidden || workingTimer !== null) return
  workingTimer = setTimeout(() => {
    workingTimer = null
    if (workingOnNow !== null && recoveryCalls === null) {
      showRecovery({ kind: 'working', what: workingOnNow })
    }
  }, SAY_WORKING_AFTER_MS)
}

function endInRecovery(verdict: StartupVerdict): void {
  if (closedWhileCheckingSaid) return
  if (!saidItDidNotStart) {
    saidItDidNotStart = true
    sayAtOnce(FAIL_LINE)
    sayAtOnce(whyItDidNotStart(verdict))
  }
  theDataOpened = false
  if (presentation.hidden) {
    if (host === null && db === null && !saidOpenedForRecovery) {
      saidOpenedForRecovery = true
      sayAtOnce(OPENED_FOR_RECOVERY_LINE)
    }
    keepTheRecoveryWindowHidden ??= keepsTheRecoveryWindow(
      app.commandLine.hasSwitch(KEEP_RECOVERY_WINDOW_SWITCH),
      app.isPackaged,
      sayAtOnce,
    )
    if (!keepTheRecoveryWindowHidden) {
      startFailed = true
      endTheProcess(1)
      return
    }
  }
  showRecovery(verdict)
  for (const window of BrowserWindow.getAllWindows()) {
    if (window !== recoveryWindow) window.destroy()
  }
}

async function endAFailedStart(error: unknown, ownership: HostGateVerdict): Promise<void> {
  if (closedWhileCheckingSaid) return
  try {
    workspaceStartup(app)?.assertDatabase()
  } catch (refusal) {
    error = refusal
  }
  if (error instanceof WorkspaceUnavailable) {
    try {
      const message = workspaceLaunchMessage(error)
      if (presentation.hidden) sayAtOnce(message)
      else dialog.showErrorBox('BroCrew', message)
    } finally {
      startFailed = true
      endTheProcess(1)
    }
    return
  }
  theDataOpened = false
  try {
    const endsOn = whatAFailedStartEndsOn(error, ownership)
    void stopWhatTheStartStarted()
    endInRecovery(await endsOn)
  } catch (failure) {
    sayAtOnce(`BroCrew could not end its failed start in the recovery window: ${inspect(failure)}`)
    startFailed = true
    endTheProcess(1)
  }
}

async function whatAFailedStartEndsOn(
  error: unknown,
  ownership: HostGateVerdict,
): Promise<StartupVerdict> {
  if (error instanceof MigrationFailed) {
    return { kind: 'failed', reason: 'migration-failed', canRetry: true, detail: error.message }
  }
  if (error instanceof NewerDatabaseError || error instanceof UnreadableDatabaseError) {
    const again = await theVerdictBeforeTheData(ownership).catch(() => null)
    if (again !== null && again.kind !== 'open' && again.kind !== 'working') return again
    if (error instanceof NewerDatabaseError) {
      const { inTheDatabase, inTheBuild } = error.fit
      return {
        kind: 'newer',
        workspace: error.folder,
        newer: { inTheDatabase: inTheDatabase.count, inTheBuild: inTheBuild.count, madeBy: null },
        offers: null,
      }
    }
    return { kind: 'failed', reason: 'database-unreadable', canRetry: true, detail: error.message }
  }
  sayAtOnce(`BroCrew failed to start: ${inspect(error)}`)
  return {
    kind: 'failed',
    reason: 'start-failed',
    canRetry: true,
    detail: error instanceof Error ? error.message : String(error),
  }
}

function stopWhatTheStartStarted(): Promise<void> {
  stoppingTheStart ??= (async () => {
    await stopProviderSetup?.()
    stopThemeIpc?.()
    stopThemeIpc = undefined
    stopStorageIpc?.()
    stopStorageIpc = undefined
    stopVoiceIpc?.()
    stopVoiceIpc = undefined
    void dockLabel?.then((label) => label.stop())
    await themes?.close().catch(() => undefined)
    const started = host
    if (started === null) {
      await pluginController.close()
      await pluginSupervisor.quit()
      return
    }
    for (const [what, step] of [
      ['stop its archive work', () => started.stopSweeping()],
      ['close its conversations', () => started.closeAll()],
      ['drain its archive work', () => started.drainArchiveWork()],
    ] as const) {
      try {
        await step()
      } catch (error) {
        sayAtOnce(`BroCrew failed to ${what} after its failed start: ${inspect(error)}`)
      }
    }
    await pluginController.close()
    await pluginSupervisor.quit()
  })()
  return stoppingTheStart
}

function sayClosedWhileChecking(): void {
  if (closedWhileCheckingSaid) return
  closedWhileCheckingSaid = true
  sayAtOnce(FAIL_LINE)
  sayAtOnce(CLOSED_WHILE_CHECKING)
}

function showRecovery(verdict: StartupVerdict): void {
  workingShown = verdict.kind === 'working' ? verdict.what : null
  if (recoveryCalls !== null) {
    recoveryCalls.settle(verdict)
  } else {
    if (recoveryService === null) throw new Error('the start-up check never ran')
    const service = recoveryService
    recoveryCalls = createRecoveryCalls({
      service: {
        inspect: () => withRecoveryWork(() => service.inspect()),
        restore: (checkpointId, progress) =>
          withRecoveryWork(() => service.restore(checkpointId, progress)),
        returnToNewer: (progress) => withRecoveryWork(() => service.returnToNewer(progress)),
        retry: () =>
          withRecoveryWork(async () => {
            await stoppingTheStart
            return service.retry()
          }),
      },
      verdict,
      openReader: (database) => createHistoryReader(database),
      zone: () => readTheSystemZoneNow(),
      sendVerdict: (settled) => tellTheWindow(recoveryWindow, { verdict: settled }),
      sendProgress: (done, total) => tellTheWindow(recoveryWindow, { done, total }),
      quit: () => quitFromRecovery(),
      relaunch: () => relaunchIntoANormalStart(),
      reveal: (path) => shell.showItemInFolder(path),
    })
    registerRecoveryIpc(ipcMain, () => recoveryWindow, recoveryCalls)
  }
  openTheRecoveryWindow()
}

function openTheRecoveryWindow(): void {
  if (recoveryWindow !== null) return
  const opened = openRecoveryWindow({
    hidden: presentation.hidden,
    openExternal: (url) => void shell.openExternal(url),
    release: () => recoveryCalls?.close(),
    onClosed: () => {
      if (recoveryWindow !== opened) return
      recoveryWindow = null
      quitFromRecovery()
    },
  })
  recoveryWindow = opened
}

function quitFromRecovery(): void {
  if (checkingTheData) sayClosedWhileChecking()
  recoveryCalls?.close()
  endTheProcess(1)
}

function relaunchIntoANormalStart(): void {
  recoveryCalls?.close()
  app.relaunch()
  endTheProcess(0)
}

function handOverToTheAppWindow(): void {
  const handed = recoveryWindow
  if (handed === null) return
  recoveryWindow = null
  recoveryCalls?.close()
  handed.close()
}

function showThisStartsWindow(): void {
  if (startFailed) return
  if (theDataOpened) createWindow()
  else if (recoveryCalls !== null) openTheRecoveryWindow()
}

async function letGoOfOldCopies(): Promise<void> {
  return withRecoveryCopies(async () => {
    try {
      await recoveryStartRecorded
      const removed = await prune(app.getPath('userData'), theBuildsMigrations(), {
        ownership: theOneAppAnswer,
        currentAppVersion: app.getVersion(),
      })
      if (removed.length > 0) {
        console.info(`BroCrew let go of ${String(removed.length)} old recovery copies`)
      }
    } catch (error) {
      console.warn('BroCrew could not let go of its old recovery copies:', error)
    }
  })
}

function endTheProcess(code: number): void {
  if (host === null && db === null) {
    void stopRecoveryWork()
      .then(() => app.exit(code))
      .catch((error: unknown) => {
        sayAtOnce(`BroCrew could not finish its recovery work before closing: ${inspect(error)}`)
      })
    return
  }
  app.quit()
}

function startRecordingWhatTheOlderOnesRan(runtimeHost: RuntimeHost): void {
  void runtimeHost
    .recordWhatTheOlderOnesRan()
    .then(({ recorded, noRecordLeft }) => {
      if (recorded > 0) console.info(`recorded the model of ${recorded} older conversation(s)`)
      if (noRecordLeft > 0) {
        console.info(
          `${noRecordLeft} older conversation(s) have no transcript left that names a model`,
        )
      }
    })
    .catch((error: unknown) => {
      console.warn('recording what the older conversations ran failed:', error)
    })
}

function startTitlingTheOlderFiles(runtimeHost: RuntimeHost): void {
  void runtimeHost
    .titleTheOlderFiles()
    .then(({ titled, retitled }) => {
      if (titled > 0) console.info(`titled ${titled} file(s) kept before titles were taken`)
      if (retitled > 0) {
        console.info(`titled again ${retitled} file(s) an older reader had titled`)
      }
    })
    .catch((error: unknown) => {
      console.warn('titling the files kept before titles were taken failed:', error)
    })
}

function startRederive(runtimeHost: RuntimeHost): void {
  const sessionId = process.env['BROBOT_REDERIVE']
  if (sessionId === undefined || sessionId === '') return
  void runtimeHost
    .rebuildLedger(sessionId)
    .then((result) => {
      console.info(
        `re-derive ${sessionId}: ${result.outcome}` +
          (result.status ? ` (now ${result.status.derived ?? 'not derived'})` : ''),
      )
    })
    .catch((error: unknown) => {
      console.warn('re-derive failed:', error)
    })
}

function showTheLogoInTheDock(): void {
  if (!app.dock) return
  const logo = join(__dirname, '../../build/icon-1024.png')
  const image = nativeImage.createFromPath(logo)
  if (image.isEmpty()) {
    console.error(`BroCrew could not read its logo at ${logo}, so the Dock shows Electron's icon`)
    return
  }
  app.dock.setIcon(image)
}

function startTheDockLabel(): void {
  const userData = app.getPath('userData')
  const dock = app.dock
  const defaultFolder = defaultDataFolder(app.getPath('appData'))
  const startingColour = startingColourFromList({
    here: userData,
    listFile: workspaceListFile({
      appData: app.getPath('appData'),
      userData,
      hidden: presentation.hidden,
      packaged: app.isPackaged,
    }),
    defaultFolder,
  })
  dockLabel = Promise.resolve(
    startDockLabel({
      folder: userData,
      workspaceName: () => carefulWorkspaceName(userData, samePath(userData, defaultFolder)),
      startingColour,
      iconPath: app.isPackaged
        ? join(process.resourcesPath, 'icon-1024.png')
        : join(__dirname, '../../build/icon-1024.png'),
      images: nativeImage,
      ...(dock && !presentation.hidden
        ? {
            dock: {
              show: (image: NativeImage) => dock.setIcon(image),
              restore: () =>
                app.isPackaged
                  ? dock.setIcon(null as unknown as NativeImage)
                  : showTheLogoInTheDock(),
            },
          }
        : {}),
    }),
  )
  ipcMain.handle(DOCK_LABEL_CHANNELS.read, async () => (await dockLabel!).read())
  ipcMain.handle(DOCK_LABEL_CHANNELS.set, async (_event, change: unknown) => {
    if (!isDockLabelChange(change)) throw new Error('Invalid Dock label change.')
    return (await dockLabel!).set(change)
  })
}

function start(ownership: HostGateVerdict): void {
  soleAtThisLaunch = ownership === 'sole'
  openLog(appLogFile(app.getPath('userData')))
  electronLog.initialize()
  debugChoiceRead = readDebugChoice(app.getPath('userData')).then(setDebug)
  void publishWorkspacePresence(
    app.getPath('userData'),
    process.platform,
    {},
    {
      details: () =>
        updates?.workspaceUpdates.details() ?? {
          folder: app.getPath('userData'),
          pid: process.pid,
          executable: process.execPath,
          startedAt: performance.timeOrigin,
          name: workspaceOf(app.getPath('userData'), false).name,
          ready: false,
          owner: null,
        },
      receive: async (request) => {
        if (updates === null) throw new Error('BroCrew is still starting this workspace')
        await updates.workspaceUpdates.receive(request)
      },
    },
  ).catch((error: unknown) =>
    console.warn('BroCrew could not announce this open workspace:', error),
  )

  app.on('before-quit', () => {
    if (checkingTheData) sayClosedWhileChecking()
  })
  app.on('before-quit', (event) => lifetime.beforeQuit(event))
  app.on('window-all-closed', () => lifetime.windowAllClosed(process.platform))
  app.on('will-quit', () => lifetime.noteQuitPhase('will-quit'))
  app.on('quit', () => lifetime.noteQuitPhase('quit'))

  app
    .whenReady()
    .then(async () => {
      if (!app.isPackaged) showTheLogoInTheDock()
      if (presentation.hidden) app.dock?.hide()
      installCspHeaders(session.defaultSession.webRequest, rendererCsp(isDevServer()))
      app.setAboutPanelOptions({
        applicationName: PERSONS_TITLE,
        applicationVersion: shownVersion(app.getVersion(), app.isPackaged),
      })
      Menu.setApplicationMenu(
        Menu.buildFromTemplate(
          appMenuTemplate({
            appName: PERSONS_TITLE,
            devTools: !app.isPackaged,
            defaultLook: () => {
              void themes?.showDefault().catch(() => undefined)
            },
          }),
        ),
      )
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) showThisStartsWindow()
      })
      try {
        const watch = startStallWatch({
          work: mainThreadWork,
          log: intoTheStallLog,
          lifecycle: whatTheAppWasDoing,
        })
        startWatchHealth({
          watch,
          log: intoTheStallLog,
          andAlso: () =>
            thePageReceipt === null
              ? null
              : pageHeardSays(thePageReceipt.takeHeard(), performance.now()),
        })
        powerMonitor.on('lock-screen', () => {
          theScreenIsLocked = true
          lookAtTheWindow()
        })
        powerMonitor.on('unlock-screen', () => {
          theScreenIsLocked = false
          lookAtTheWindow()
        })
        powerMonitor.on('suspend', () => whatTheAppWasDoing.asleep())
        powerMonitor.on('resume', () => whatTheAppWasDoing.awake())
      } catch (error) {
        console.warn('the stall watch could not start:', error)
      }
      let finishStartupPhase = pluginStartupTrace.begin('workspace-recovery', 'startup')
      const verdict = await theVerdictBeforeTheData(ownership)
      finishStartupPhase(verdict.kind === 'open' ? undefined : verdict.kind)
      if (closedWhileCheckingSaid) return
      if (verdict.kind !== 'open') {
        endInRecovery(verdict)
        return
      }
      await compactDataBeforeOpen()
      if (closedWhileCheckingSaid || recoveryCaptureAbort.signal.aborted) return
      const startBegan = performance.now()
      const localZone = keepTheSystemZone((moved) => {
        for (const window of BrowserWindow.getAllWindows()) {
          try {
            if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
              window.webContents.send(LOCAL_ZONE_MOVED_CHANNEL, moved)
            }
          } catch (error) {
            console.error('BroCrew could not tell a window that the time zone moved:', error)
          }
        }
        host?.placeTheWakeUpsAgain()
      })
      readLocalTimeFrom(localZone)
      finishStartupPhase = pluginStartupTrace.begin('themes-database-runtime-host')
      themes = new ThemeStore({
        assertWorkspace: () => workspaceStartup(app)?.assertDatabase(),
        ...themeRoots({
          appData: app.getPath('appData'),
          userData: app.getPath('userData'),
          resources: app.isPackaged ? process.resourcesPath : join(__dirname, '../../resources'),
          hidden: presentation.hidden,
        }),
        ...themeDefaultsFor(app.getPath('userData')),
        writesItsDefault: true,
        warn: (line) => console.warn(line),
        builtInIds: BUILT_IN_THEME_IDS,
        hiddenBases: HIDDEN_BASE_THEME_IDS,
        forceDefault: app.commandLine.hasSwitch('default-theme'),
        loader: { sample: themePictureSampler(nativeImage) },
        problem: themeProblem,
        trash: (path) => shell.trashItem(path),
        openFolder: async (path) => {
          if (await shell.openPath(path)) throw new Error('themes folder could not be opened')
        },
      })
      await themes.start()
      workspaceStartup(app)?.assertDatabase()
      stopThemeIpc = registerThemeIpc(ipcMain, themes, (change) => {
        for (const window of BrowserWindow.getAllWindows()) {
          if (window.isDestroyed() || window.webContents.isDestroyed()) continue
          try {
            window.setBackgroundColor(themes?.background() ?? DEFAULT_THEME_BACKGROUND)
            if (appSetupWindows.has(window.webContents))
              updateNativeTitleBar(window, process.platform, themes?.titleBar())
            window.webContents.send(THEMES_CHANNELS.changed, change)
          } catch {
            // A closed window does not stop the other windows from receiving the change.
          }
        }
      })
      host = await createRuntimeHost(initDatabase())
      finishStartupPhase()
      registerIpc(host, localZone)
      startTheDockLabel()
      updates = startUpdates({
        app,
        host,
        hidden: presentation.hidden,
        prepareForQuit: () => lifetime.prepareForQuit(),
        quitting: () => lifetime.shuttingDown !== null,
      })
      const openWorkspace = startWorkspaces({
        app,
        hidden: presentation.hidden,
        pickFolder: async (event) => {
          const picked = await pick(
            BrowserWindow.fromWebContents(event.sender),
            CHOOSE_WORKSPACE_OPTIONS,
          )
          return picked.canceled ? null : (picked.filePaths[0] ?? null)
        },
      })
      startProviderSnapshots()
      installAssetProtocol(session.defaultSession.protocol)
      installThemeProtocol(session.defaultSession.protocol, themes)
      theDataOpened = true
      if (updateReopenAtLaunch !== null) {
        const file = updateSettingsOf({
          appData: app.getPath('appData'),
          userData: app.getPath('userData'),
          hidden: false,
        }).file
        const folders = takeUpdateWorkspaces(
          file,
          process.execPath,
          app.getVersion(),
          app.getPath('userData'),
        )
        for (const folder of folders) {
          if (folder === app.getPath('userData')) continue
          const failure = await openWorkspace(folder)
          if (failure !== null)
            console.error(`BroCrew could not reopen ${folder} after updating: ${failure}`)
        }
      }
      try {
        const root = pluginSupervisorRoot({
          appData: app.getPath('appData'),
          workspaceRoot: app.getPath('userData'),
          hidden: presentation.hidden,
          scratchRoot: app.commandLine.getSwitchValue('plugin-global-root'),
        })
        if (root && ownership === 'sole') {
          finishStartupPhase = pluginStartupTrace.begin('workspace-admission')
          pluginController.start({
            devSource: !app.isPackaged
              ? { isPackaged: app.isPackaged, appData: app.getPath('appData') }
              : undefined,
            root,
            workspaceRoot: app.getPath('userData'),
            sharedDataOwner: sharedDataOwner({
              appData: app.getPath('appData'),
              root,
              workspaceRoot: app.getPath('userData'),
              hidden: presentation.hidden,
              label: !presentation.hidden
                ? await carefulWorkspaceName(
                    app.getPath('userData'),
                    samePath(app.getPath('userData'), defaultDataFolder(app.getPath('appData'))),
                  ).catch(() => undefined)
                : undefined,
            }),
            resourcesRoot: app.isPackaged
              ? process.resourcesPath
              : join(__dirname, '../../resources'),
            build: buildIdentity().id,
            appVersion: app.getVersion(),
            supervisor: pluginSupervisor,
          })
          finishStartupPhase()
        }
      } catch (error) {
        pluginStartupTrace.failure('workspace-admission', error)
        console.warn('[plugins] plugin-initialization-failed')
      }
      createWindow()
      handOverToTheAppWindow()

      startRederive(host)
      startTitlingTheOlderFiles(host)
      startRecordingWhatTheOlderOnesRan(host)
      let itself = whatTheAppItselfHolds([])
      let appMetrics: ReturnType<typeof app.getAppMetrics> = []
      let agentsApart = ''
      const intoTheMemoryLog = (message: string): void => logWarn('memory', message)
      const unrefdInterval = (fn: () => void, ms: number): unknown => {
        const timer = setInterval(fn, ms)
        timer.unref()
        return timer
      }
      const stopInterval = (handle: unknown): void =>
        clearInterval(handle as ReturnType<typeof setInterval>)
      startMemoryWatch({
        footprintCounts: () => host?.heldRootCounts(),
        sample: () => {
          spawnedReader.refresh()
          appMetrics = app.getAppMetrics()
          itself = whatTheAppItselfHolds(appMetrics)
          return itself.bytes
        },
        detail: () => {
          agentsApart = whatItsAgentsHoldApart(
            !spawnedReader.everRead()
              ? 'not-read-yet'
              : spawnedReader.failed()
                ? 'unreadable'
                : spawnedReader.snapshot(),
          )
          return `[${itself.said}] ${agentsApart}`
        },
        ...(process.platform === 'darwin'
          ? {
              confirm: async () => {
                const captured = appMetrics
                const companions = agentsApart
                if (
                  captured.length === 0 ||
                  new Set(captured.map(({ pid }) => pid)).size !== captured.length
                )
                  return null
                const output = await new Promise<string>((resolve, reject) => {
                  execFile(
                    '/usr/bin/footprint',
                    [
                      '--noCategories',
                      '--format',
                      'bytes',
                      ...captured.flatMap(({ pid }) => ['--pid', String(pid)]),
                    ],
                    { timeout: 5_000, encoding: 'utf8' },
                    (error, stdout) => (error ? reject(error) : resolve(stdout)),
                  )
                })
                const current = new Map(
                  app.getAppMetrics().map(({ pid, creationTime }) => [pid, creationTime]),
                )
                if (
                  current.size !== captured.length ||
                  captured.some(({ pid, creationTime }) => current.get(pid) !== creationTime)
                )
                  return null
                const total = whatTheAppItselfHolds(captured, output)
                return total === null
                  ? null
                  : { bytes: total.bytes, detail: `[${total.said}] ${companions}` }
              },
            }
          : {}),
        log: intoTheMemoryLog,
        setInterval: unrefdInterval,
        clearInterval: stopInterval,
      })
      const agentsFloor = agentsMemoryFloorFor(totalmem())
      setTimeout(() => {
        startMemoryWatch({
          floorBytes: agentsFloor,
          stepBytes: AGENTS_MEMORY_STEP_BYTES,
          rearmBelowBytes: agentsFloor - AGENTS_MEMORY_STEP_BYTES,
          headline: theAgentsHeadline,
          sample: () =>
            spawnedReader.everRead() && !spawnedReader.failed()
              ? totalBytes(spawnedReader.snapshot())
              : 0,
          detail: () =>
            theAgentsDetail(
              spawnedReader.snapshot(),
              (heads) => host?.whoseAgentsAre(heads) ?? new Map<number, string>(),
              itself.bytes,
            ),
          log: intoTheMemoryLog,
          setInterval: unrefdInterval,
          clearInterval: stopInterval,
        })
      }, AGENTS_LINE_LAG_MS).unref()

      for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
        process.on(signal, () => lifetime.quitSignal(signal))
      }

      mainThreadWork.add('the start', performance.now() - startBegan)
      recoveryStartSucceeded = true
      void letGoOfOldCopies()
      sayAtOnce(READY_LINE)
      eventRetention = startEventRetention(
        db!,
        () =>
          withWorkerMemory('storage', () =>
            startStorageWorker({
              workerData: {
                maintenance: { kind: 'trim', file: databaseFile(app.getPath('userData')) },
              },
              resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 8 },
            }),
          ),
        async () => {},
        (error) => console.warn('BroCrew could not trim old event history:', error),
      )
      if (firstListAcceptedAt !== undefined) eventRetention.firstListAccepted(firstListAcceptedAt)
    })
    .catch((error: unknown) => {
      pluginStartupTrace.failure('app-startup', error, 'all')
      void endAFailedStart(error, ownership)
    })
}

const lifetime = createAppLifetime({
  holdQuit: () => updates?.workspaceUpdates.holdQuit() ?? false,
  recordOpenSessions: () => host?.recordOpenForQuit(),
  announceClosing: () => {
    for (const window of BrowserWindow.getAllWindows()) {
      try {
        if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
          window.webContents.send(APP_CLOSING_CHANNEL)
        }
      } catch (error) {
        console.error('BroCrew could not tell a window it is closing:', error)
      }
    }
  },
  closeAllSessions: async () => {
    try {
      await (stoppingTheStart ?? host?.closeAll() ?? Promise.resolve())
    } finally {
      await pluginController.close()
      await pluginSupervisor.quit()
    }
  },
  keepUnsentDrafts: () => theLastDraftSaves(),
  stopArchiveWork: () => {
    void eventRetention?.stop()
    void stopRecoveryWork()
    void stopProviderSetup?.()
    updates?.stop()
    host?.stopSweeping()
    stopThemeIpc?.()
    stopThemeIpc = undefined
    stopStorageIpc?.()
    stopStorageIpc = undefined
    stopVoiceIpc?.()
    stopVoiceIpc = undefined
    void dockLabel?.then((label) => label.stop())
    void themes?.close().catch(() => undefined)
  },
  drainArchiveWork: async () => {
    await eventRetention?.stop()
    await stopRecoveryWork()
    await stopProviderSetup?.()
    await updates?.drain()
    await (stoppingTheStart ?? host?.drainArchiveWork() ?? Promise.resolve())
    await themes?.close()
  },
  closeDatabase: () => {
    if (db !== null) closeDatabase(db)
    db = null
  },
  stopCommands: () => stopOrphanedCommands(app.getPath('userData')),
  quit: () => app.quit(),
  quitAfterShutdown: () => {
    if (!theDataOpened || startFailed) {
      app.exit(1)
      return
    }
    if (!updates?.finishQuit()) app.quit()
  },
  exit: (code) => app.exit(code),
  armLastResort: (withinMs) =>
    armLastResortExit(
      {
        spawn,
        now: () => Date.now(),
        execPath: process.execPath,
        pid: process.pid,
        env: process.env,
      },
      withinMs,
    ),
  log: (message, error) => {
    const line = error === undefined ? message : `${message} ${inspect(error)}`
    try {
      const bytes = Buffer.from(`${line}\n`, 'utf8')
      for (let written = 0; written < bytes.length;) {
        written += writeSync(STDERR_FD, bytes, written, bytes.length - written)
      }
    } catch {
      console.error(line)
    }
  },
  now: () => Date.now(),
})

void runAsSoleInstance({
  requestLock: () => app.requestSingleInstanceLock(),
  onSecondLaunch: (handler) => app.on('second-instance', () => handler()),
  focusExisting: () => {
    if (startFailed) return
    const [existing] = BrowserWindow.getAllWindows()
    if (existing === undefined) {
      showThisStartsWindow()
      return
    }
    if (presentation.hidden) {
      console.info(`${KEPT_OUT_OF_SIGHT} a second launch asked this app to come forward`)
      return
    }
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    app.focus({ steal: true })
  },
  announce: (message) => {
    if (startFailed) return
    if (presentation.hidden) {
      console.info(`${KEPT_OUT_OF_SIGHT} ${message}`)
      return
    }
    const [existing] = BrowserWindow.getAllWindows()
    void (existing === undefined
      ? dialog.showMessageBox({ type: 'info', message })
      : dialog.showMessageBox(existing, { type: 'info', message }))
  },
  standDown: () => app.exit(0),
  start,
  log: sayAtOnce,
})
