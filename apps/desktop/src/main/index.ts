import type { HandedPath } from '../shared/attachment-contracts'
import { providerSetupServices } from './providers/program-compat'
import { setupProcesses } from './provider-setup/process'
import { registerProviderSetup } from './provider-setup/ipc'
import { providerKnowledge } from './providers/knowledge-definitions'
import { workspaceLaunchMessage } from './workspace-routing'
import { WorkspacePluginAttachments } from './plugins/attachments'
import { pluginWorkspaceIdentity } from './plugins/supervisor/client'
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
import { clearHttpCache, httpCacheFolder } from './storage/cache'
import { registerStorageIpc } from './storage/ipc'
import { StorageFailure } from './storage/engine'
import { registerVoiceIpc } from './voice/ipc'
import { VoiceService } from './voice/service'
import { runVoiceHelper } from './voice/engine'
import { backupsDir, databaseFile, recoveryDir, SIDECARS } from './recovery/layout'
import { profileSkillAccess, SharedSkillDiscovery } from './skills/shared-discovery'
import { convertSharedSkills } from './skills/shared-conversion'
import { SharedSkillLibrary } from './skills/shared-library'
import { providerProcessesAreInFlight } from './runtime/live-hosts'
import { RECOVERY_RETENTION_CHANNELS } from '../shared/recovery-retention'
import {
  prune,
  recordSuccessfulStart,
  retainedCopyInfo,
  deleteRetainedCopy,
} from './recovery/checkpoint'
import { TranscriptRetentionHost, transcriptStartupWasInterrupted } from './transcript-retention'
import {
  TRANSCRIPT_RETENTION_CHANNELS,
  isTranscriptRetention,
} from '../shared/transcript-retention'
import { ATTENTION_SIGNALS_CHANNEL, isAttentionSignal } from '../shared/attention-signals'
import { AttentionSignals } from './attention-signals'
import { attentionOverlay } from './attention-overlay'
import { installAppNavigation } from './app-navigation'
import { makeWorkerPieceFolder, WORKER_OUTPUT_DIRNAME } from './worker-piece-folder'
import { keptShippedSkills, prepareBuiltInSkills } from './skills/prepare-built-in-skills'
import { factoryTextOf, readTextPack } from './skills/text-pack'
import { aStartAttemptsLog } from './start-attempts-log'
import { broadcastRuntime } from './runtime/window-broadcast'
import { changeNotices } from './runtime/change-notices'
import { execFile, spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, writeSync } from 'node:fs'
import { inspect } from 'node:util'
import { join } from 'node:path'
import { totalmem } from 'node:os'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain as pluginIpcMain,
  Menu,
  nativeImage,
  powerMonitor,
  protocol,
  safeStorage,
  session,
  shell,
} from 'electron'
import type { NativeImage, OpenDialogOptions, WebContents } from 'electron'
import { providerRecord, SUPPORTED_PROVIDERS, appInfoSchema, type AppInfo } from '@brobot2/shared'
import { withDeadline } from '@brobot2/runtime'
import type { ChosenAttachment, ChosenCwd, DroppedPathVerdict } from '../shared/runtime-ipc'
import {
  APP_CLOSING_CHANNEL,
  BUNDLE_SUFFIX,
  NO_IMAGE_ON_CLIPBOARD,
  PROVIDERS_CHANGED_CHANNEL,
  RUNTIME_CHANGED_CHANNEL,
  RUNTIME_STATES_CHANNEL,
} from '../shared/runtime-ipc'
import { buildBranches, buildIdentity, shownVersion } from './build-identity'
import { LIMITS_DISPLAY_CHANGED_CHANNEL } from '../shared/limits-display'
import { LimitsReaderLifetime } from './db/limits-reader-lifetime'
import { limitsWriterSampler } from './db/fresh-limits-snapshot'
import { windowWriterSampler } from './db/window-writer-stamp'
import { startLimitsReader } from './db/start-limits-reader'
import { startWindowReader } from './db/start-window-reader'
import { startFilesLibrary } from './db/start-files-library'
import { FilesLibraryWindows } from './db/files-library-windows'
import { TeamProfileGraphWindows } from './db/team-profile-graph-windows'
import { startTeamProfileGraph } from './db/start-team-profile-graph'
import { startWorkSearch } from './db/start-work-search'
import { startPastWorkSearch } from './db/start-past-work-search'
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
import { aDiagnosticsSink, type DiagnosticsSink } from './diagnostics-sink'
import { aPageReceipt, pageHeardSays, type PageReceipt } from './runtime/page-performance'
import {
  MainThreadWork,
  startStallWatch,
  startWatchHealth,
  timedMethods,
  WhatTheAppWasDoing,
} from './stall-watch'
import {
  PS_ARGS,
  PS_MAX_BUFFER_BYTES,
  PS_READ_DEADLINE_MS,
  PS_TIMEOUT_MS,
  createSpawnedReader,
  psArgsFor,
  residentSizesIn,
  totalBytes,
} from './process-tree'
import { openDatabase, type AppDatabase } from './db/connection'
import { listProviderConnections, resolveProviderConnection } from './db/provider-connections'
import { newProviderSessionId } from './db/ids'
import { discoverSessionsIn } from './adopt/discover-sessions'
import {
  indexedHomeDescriptions,
  discoverUserHomeSessions,
  userProviderHomePath,
} from './adopt/user-homes'
import { aProtectedPlace, thePlacesOnThisComputer } from './protected-places'
import { workspaceListFile } from './workspaces'
import { samePath } from './same-folder'
import {
  carefulWorkspaceName,
  startDockLabel,
  startingColourFromList,
  type DockLabelHost,
} from './dock-label'
import { DOCK_LABEL_CHANNELS, isDockLabelChange } from '../shared/dock-label'
import { freeBytesOn, nativeTranscriptPath } from './archive/native-file'
import { createMemoryAmendmentObserver, createSessionStore } from './db/session-store'
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
import { compactWhenMuchIsFree } from './db/compact'
import { aCommandsKind, registerRuntimeIpc, webContentsSink } from './runtime/ipc'
import { sinkOwnerId } from './runtime/window-caller'
import { DEFAULT_SILENCE_WINDOW_MS } from './runtime/liveness'
import { readProviderConfig } from './runtime/provider-config'
import {
  listProfileIds,
  listProviderHomes,
  deriveProviderHome,
  homePathsForProvider,
  providerHomesRoot,
  savedMethodsFolder,
} from './runtime/provider-homes'
import {
  createProviderModules,
  desktopProviderInputs,
  providerAuthFromModules,
  providerVersionsFromModules,
} from './providers'
import {
  readSavedMethods,
  savedMethodsLinesOf,
  savedMethodsUseOf,
  withTheLinesSent,
} from './saved-methods'
import { createSavedMethodService } from './saved-method-service'
import { createMethodChangeStore } from './db/method-changes'
import {
  createMemoryService,
  stageKnowledgeFile,
  sweepKnowledgeStages,
} from './runtime/agent-memory'
import { ApiKeys, askTheProvider, safeStorageCipher } from './runtime/api-keys'
import { listProcesses, memoryOf } from './runtime/process-listing'
import { providerUsageFile, readKeptUsage, writeKeptUsage } from './provider-usage-file'
import { readKeptAttempts, scheduleAttemptsFile, writeKeptAttempts } from './schedule-attempts-file'
import {
  profileExecutionFile,
  readProfileExecution,
  writeProfileExecution,
} from './profile-execution-file'
import { readKeptCuts, turnsTheAppCutFile, writeKeptCuts } from './turns-the-app-cut-file'
import { providerAccountsFile, readKeptAccounts, writeKeptAccounts } from './provider-accounts-file'
import { readKeptRules, removeKeptRule, type WhereRulesAreKept } from './kept-rules'
import startTheLocator from './local-settings-locator.worker?nodeWorker'
import { settingsLocations } from './settings-locations'
import { snapshotFor } from './provider-snapshots'
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
import { RuntimeHost, type RuntimeHostDeps } from './runtime/runtime-host'
import { appMenuTemplate } from './app-menu'
import { registerWindowControls } from './window-controls'
import { checkSessionCwd, resolveSessionCwd } from './runtime/scratch-cwd'
import { captionHandedPaths, classifyDroppedPaths, classifyHandedPath } from './runtime/handed-path'
import {
  pastePicture,
  pastedImagesRoot,
  sweepPastedImages,
  tooManyPixels,
} from './runtime/pasted-image'
import {
  createDraftWriter,
  keepDraftedPastes,
  QUIT_SAVE_WITHIN_MS,
  readDraftsFile,
  type DraftWriter,
} from './drafts-file'
import { restoreSavedDrafts } from './saved-drafts'
import { LAST_DRAFT_SAVE_CHANNEL } from '../shared/saved-drafts'
import { keepTheSystemZone, readTheSystemZoneNow } from './system-zone'
import { LOCAL_ZONE_MOVED_CHANNEL, readLocalTimeFrom, type LocalZone } from '../shared/local-time'
import { resourcesRoot } from './resources/resources'
import { readSessionInstructions } from './runtime/instructions'
import { profileBundleSpans, thisConversationSpans } from './runtime/factory-text'
import { toolsToldInTextFor } from './runtime/agent-tools'
import { publishProfileBundle } from './runtime/profile-bundle'
import { brobotWorkspace, ensureWorkspace, workspaceOwnFilesIn } from './runtime/workspace'
import {
  installNavigationGuard,
  installSessionRelease,
  type AppDocument,
} from './window-navigation'
import { startUpdates } from './updates-in-the-app'
import { startWorkspaces } from './workspaces-in-the-app'
import { startProviderSnapshots } from './provider-snapshots'
import { signInChangesIn } from './sign-in-changes'
import { archivedConversationsIn } from './archived-file'
import {
  defaultDataFolder,
  nameTheAppToWindows,
  pinTheDataFolder,
  workspaceStartup,
  workspaceOf,
} from './data-folder'
import { WorkspaceUnavailable } from './workspace-startup'
import { nodeFs as recoveryFiles } from './recovery/files'

try {
  pinTheDataFolder(app)
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
  startRecoveryVerifier({
    workerData: request,
    resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 8 },
  }),
)
const recoveryWork = new Set<Promise<unknown>>()
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
    await recoveryCopyVerifier.stop()
    await Promise.allSettled([...recoveryWork])
  })()
  return stoppingRecoveryWork
}

let keepTheRecoveryWindowHidden: boolean | null = null
let theOneAppAnswer: HostGateVerdict = 'unknown'
let thisBuildsMigrations: readonly BuildMigration[] | null = null

let host: RuntimeHost | null = null
const pluginSupervisor = new PluginSupervisorAttachment()
let updates: ReturnType<typeof startUpdates> | null = null
let transcriptRetention: TranscriptRetentionHost | undefined
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

const draftReaders = new Set<number>()

async function theLastDraftSaves(): Promise<void> {
  const writer = draftWriter
  if (writer === null) return
  const windows = BrowserWindow.getAllWindows().filter(
    (window) =>
      !window.isDestroyed() &&
      !window.webContents.isDestroyed() &&
      draftReaders.has(window.webContents.id),
  )
  writer.expectQuitSaves(windows.length)
  for (const window of windows) {
    try {
      window.webContents.send(LAST_DRAFT_SAVE_CHANNEL)
    } catch {
      // Quit-save accounting below still decides whether every draft arrived.
    }
  }
  const outcome = await writer.quitSaves(QUIT_SAVE_WITHIN_MS)
  if (outcome === 'unanswered') {
    throw new Error(
      `a window did not hand over its unsent drafts within ${String(QUIT_SAVE_WITHIN_MS)}ms`,
    )
  }
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
  try {
    mainThreadWork.timed('database migrations before the window', () =>
      applyMigrations(database, migrationsFolder),
    )
  } catch (error) {
    try {
      database.close()
    } catch {
      // A close failure must not replace the migration failure.
    }
    throw new MigrationFailed(
      `BroCrew could not update this workspace's data: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
  try {
    const compaction = compactWhenMuchIsFree(database, freeBytesOn(app.getPath('userData')))
    if (compaction === 'compacted') console.info('BroCrew gave its free database space back')
    if (compaction === 'compacted-log-held') {
      console.info('BroCrew gave its free database space back; its log file shrinks later')
    }
    if (compaction === 'deferred-too-large') {
      console.info(
        'BroCrew kept its free database space: the file is too large to compact at launch',
      )
    }
    if (compaction === 'not-enough-disk') {
      console.warn('BroCrew kept its free database space: the disk has no room to compact it')
    }
  } catch (error) {
    console.warn('BroCrew could not give its free database space back:', error)
  }
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

function builtInSkillsResources(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'built-in-skills')
    : join(app.getAppPath(), 'resources', 'built-in-skills')
}

const pluginController = productionPluginController()

async function createRuntimeHost(database: AppDatabase): Promise<RuntimeHost> {
  const shippedSkills = keptShippedSkills(builtInSkillsResources())
  const shippedVersion = (): string | null => {
    try {
      return shippedSkills().catalogue.version
    } catch {
      return null
    }
  }
  const userData = app.getPath('userData')
  const sharedSkills = new SharedSkillLibrary(userData)
  const skillsReady = firstWindowLoad.then(() => convertSharedSkills(userData, database))
  void skillsReady.catch(() => console.warn('Skills could not be read.'))
  try {
    ensureWorkspace(userData)
  } catch (error) {
    console.warn(
      `the BroCrew workspace could not be prepared: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  keepDraftedPastes(userData, Date.now())
  void sweepPastedImages(pastedImagesRoot(userData), Date.now()).catch(() => 0)

  const store = timedMethods(
    createSessionStore(database, Date.now, mainThreadWork),
    'store',
    mainThreadWork,
  )
  const sharedDiscovery = new SharedSkillDiscovery(
    userData,
    skillsReady,
    shippedSkills,
    undefined,
    (profileId) => profileSkillAccess(store, profileId),
  )
  let wallsAheadFailed = false
  const readTheWallsAhead = (): void => {
    if (!database.open) return
    let whole = true
    try {
      whole = store.readAheadProviderWalls(Date.now(), 15)
    } catch (error) {
      if (!wallsAheadFailed)
        console.warn(
          `the provider limits could not be read ahead: ${error instanceof Error ? error.message : String(error)}`,
        )
      wallsAheadFailed = true
    }
    setTimeout(readTheWallsAhead, whole ? 5_000 : 0).unref()
  }
  setTimeout(readTheWallsAhead, 0).unref()
  const ruleFolders = (): string[] => {
    const records = store.recorded()
    return SUPPORTED_PROVIDERS.flatMap((provider) =>
      providerKnowledge[provider].keptRules.projectFolders(records),
    )
  }
  const locations = settingsLocations(locateOffTheMainThread)
  const whereRulesAreKept = (): WhereRulesAreKept => {
    const records = store.recorded()
    return {
      projectFiles: providerRecord((provider) =>
        locations.known(providerKnowledge[provider].keptRules.projectFolders(records)),
      ),
      homes: listProviderHomes(userData).map((home) => ({
        provider: home.provider,
        path: home.path,
      })),
      personsOwn: SUPPORTED_PROVIDERS.map((provider) => userProviderHomePath(provider)),
    }
  }
  const apiKeys = new ApiKeys(store, safeStorageCipher(safeStorage))
  const stopProviderServices = new AbortController()
  app.once('will-quit', () => stopProviderServices.abort())
  recordedConversation = (sessionId) => db === null || store.recordedOne(sessionId) !== null
  const retention = (transcriptRetention ??= new TranscriptRetentionHost(
    userData,
    providerProcessesAreInFlight,
    Date.now,
    transcriptStartupWasInterrupted(store),
  ))
  setImmediate(() => retention.start())
  let knowledgeChanged: (slug: string) => void = () => {}
  const methodKnowledge = await createSavedMethodService({
    homesRoot: providerHomesRoot(userData),
    folderOf: (slug) => savedMethodsFolder(userData, slug),
    identities: () => store.agentIdentities(),
    changes: createMethodChangeStore(database, Date.now),
    now: Date.now,
    stage: stageKnowledgeFile,
    sweep: sweepKnowledgeStages,
    changed: (slug) => knowledgeChanged(slug),
  })
  const providerHomePaths: Pick<RuntimeHostDeps, 'providerHomePath'> = {
    providerHomePath: (provider, profileId) =>
      deriveProviderHome(userData, { profileId, provider }),
  }
  const memoryKnowledge = await createMemoryService({
    store,
    inputsOf: (slug) => ({
      profileId: slug,
      homesRoot: providerHomesRoot(userData),
      homeOf: (provider) => providerHomePaths.providerHomePath(provider, slug),
    }),
    now: Date.now,
    reconcile: createMemoryAmendmentObserver(database, Date.now).reconcile,
    changed: (slug) => knowledgeChanged(slug),
  })
  const providerModules = createProviderModules(
    (provider) => homePathsForProvider(userData, provider),
    desktopProviderInputs({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      platform: process.platform,
      arch: process.arch,
      managedRoot: providerHomesRoot(userData),
      signal: stopProviderServices.signal,
      commandLine: app.commandLine,
      keys: {
        read: (provider) => apiKeys.read(provider),
        current: (provider) => apiKeys.current(provider),
        status: (provider) => apiKeys.status(provider),
      },
    }),
    (provider) => ({
      list: () => listProviderConnections(database, provider),
      resolve: (connectionId) => resolveProviderConnection(database, { provider, connectionId }),
      revision: () => apiKeys.revision(provider),
    }),
  )
  const providerAuth = providerAuthFromModules(providerModules)
  const runtimeHost = new RuntimeHost({
    plugins: pluginController,
    pluginAttachments: {
      agent: (occupied) =>
        new WorkspacePluginAttachments(
          pluginSupervisor,
          pluginWorkspaceIdentity(app.getPath('userData')),
        ).agent(occupied),
    },
    skillImports: (from, to) => sharedSkills.recentImports(from, to),
    sharedSkillsRoot: () => sharedDiscovery.root(),
    sharedSkillsGeneration: () => sharedDiscovery.changeMark(),
    prepareSharedSkills: () => sharedDiscovery.prepareLaunch(),
    beforeSkillDiscovery: () => sharedDiscovery.library.beforeOffer(),
    closeSharedSkills: () => sharedDiscovery.close(),
    skillsForAPerson: sharedDiscovery.window,
    savedMethods: methodKnowledge,
    memoryKnowledge,
    afterFirstWindowLoad: firstWindowLoad,
    transcriptsCleared: (from, to) => transcriptRetention?.recent(from, to) ?? Promise.resolve([]),
    workSearchReader: startWorkSearch(database.name),
    pastWorkSearchReader: startPastWorkSearch(),
    windowReader: startWindowReader(database.name),
    filesLibraries: new FilesLibraryWindows(() => startFilesLibrary(database.name)),
    filesLibraryRevision: () => {
      if (store.canReadFreshSnapshot?.() !== true) return null
      const stamp = database
        .prepare(
          'SELECT total_changes() AS writes, data_version AS version FROM pragma_data_version',
        )
        .get()
      return JSON.stringify(stamp)
    },
    teamProfileGraphs: new TeamProfileGraphWindows((admission, failure) =>
      startTeamProfileGraph(database.name, profileExecutionFile(userData), admission, failure),
    ),
    teamProfileGraphRevision: () => {
      if (store.canReadFreshSnapshot?.() !== true) return null
      return JSON.stringify(
        database
          .prepare(
            'SELECT total_changes() AS writes, data_version AS version FROM pragma_data_version',
          )
          .get(),
      )
    },
    themes: themes ?? undefined,
    mainThreadWork,
    store,
    limitsWriterStamp: limitsWriterSampler(database, () => store.canReadFreshSnapshot?.() === true),
    windowWriterStamp: windowWriterSampler(database, () => store.canReadFreshSnapshot?.() === true),
    limitsReader: new LimitsReaderLifetime(database.name, startLimitsReader, (message) =>
      broadcastRuntime(
        () => BrowserWindow.getAllWindows(),
        LIMITS_DISPLAY_CHANGED_CHANNEL,
        message,
        (error) =>
          console.error('BroCrew could not tell a window its limits reading changed:', error),
        mainThreadWork,
        'window provider broadcast',
      ),
    ),
    signInChanges: signInChangesIn(userData),
    archived: archivedConversationsIn(userData),
    protectedPlaceOf: (folder) => {
      const places = thePlacesOnThisComputer({
        userData,
        providerHomesRoot: providerHomesRoot(userData),
        workspaceList: workspaceListFile({
          appData: app.getPath('appData'),
          userData,
          hidden: presentation.hidden,
          packaged: app.isPackaged,
        }),
        workspaceOf: brobotWorkspace,
      })
      return aProtectedPlace(folder, places)
    },
    createRuntime: (provider, connectionId) =>
      providerModules[provider].createRuntime(connectionId),
    connectionFor: (provider, connectionId) => {
      const connections = providerModules[provider].connections
      if (!connections) throw new Error('Provider connection services were not bound')
      return connections.resolve(connectionId).id
    },
    connectionRevision: (provider) => apiKeys.revision(provider),
    listConnections: () =>
      Object.values(providerModules).flatMap((module) => module.connections?.list() ?? []),
    beforeProviderLaunch: async () => {
      transcriptRetention?.beforeLaunch()
    },
    prepareProviderHome: async (provider, profileId) => {
      transcriptRetention?.beforeLaunch()
      return providerModules[provider].home.prepare(profileId)
    },
    prepareBuiltInSkills: ({ pack, ...input }) =>
      prepareBuiltInSkills({
        ...input,
        managedRoot: providerHomesRoot(userData),
        shipped: shippedSkills,
        ...(pack?.kind === 'read' ? { skills: pack.pack.skills } : {}),
      }),
    readTextPack: () => readTextPack(process.env, app.isPackaged, shippedVersion),
    recordStartAttempt: aStartAttemptsLog(userData).write,
    ...providerHomePaths,
    listProfiles: (provider) => listProfileIds(userData, provider),
    providerAuth,
    apiKeys,
    loginRenewal: providerAuth.loginRenewal,
    programFound: providerRecord((provider) => providerModules[provider].program?.installedPath),
    askTheProvider: (provider, key) => askTheProvider(provider, key),
    providerVersions: providerVersionsFromModules(providerModules),
    keptRules: async () => {
      const folders = ruleFolders()
      await locations.refresh(folders)
      const unfound = locations.unfound(folders).length
      if (unfound > 0) {
        throw new Error(
          `where ${String(unfound)} folders keep their rules could not be found just now`,
        )
      }
      return readKeptRules(whereRulesAreKept())
    },
    removeKeptRule: (input) => removeKeptRule(whereRulesAreKept(), input),
    listProcesses,
    usageKept: {
      read: () => readKeptUsage(providerUsageFile(userData)),
      write: (usage) => writeKeptUsage(providerUsageFile(userData), usage),
    },
    profileExecution: {
      read: () => readProfileExecution(profileExecutionFile(userData)),
      write: (kept) => writeProfileExecution(profileExecutionFile(userData), kept),
      owned: soleAtThisLaunch,
    },
    scheduleAttempts: {
      read: () => readKeptAttempts(scheduleAttemptsFile(userData)),
      write: (kept) => writeKeptAttempts(scheduleAttemptsFile(userData), kept),
    },
    turnsTheAppCut: {
      read: () => readKeptCuts(turnsTheAppCutFile(userData)),
      write: (kept) => writeKeptCuts(turnsTheAppCutFile(userData), kept),
    },
    accountsKept: {
      read: () => readKeptAccounts(providerAccountsFile(userData)),
      write: (accounts) => writeKeptAccounts(providerAccountsFile(userData), accounts),
    },
    providersMoved: (message) =>
      broadcastRuntime(
        () => BrowserWindow.getAllWindows(),
        PROVIDERS_CHANGED_CHANNEL,
        message,
        (error) => console.error('BroCrew could not tell a window a provider fact moved:', error),
        mainThreadWork,
        'window provider broadcast',
      ),
    openExternal: async (url) => {
      await shell.openExternal(url)
    },
    revealPath: (path) => {
      shell.showItemInFolder(path)
    },
    openPath: (path) => shell.openPath(path),
    providerHomesRoot: () => providerHomesRoot(userData),
    resourcesRoot: () => resourcesRoot(userData),
    makeWorkerPieceFolder: (piece) => makeWorkerPieceFolder(userData, piece),
    whichBuild: () => ({ ...buildIdentity(), schema: migrationsAppliedOrNull() }),
    providerSnapshot: (provider, model) => snapshotFor(provider, model),
    resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
    readInstructions: (provider, cwd, providerHome, context, launchPack) => {
      const pack = launchPack ?? readTextPack(process.env, app.isPackaged, shippedVersion)
      const savedMethods =
        context.profileSlug === null
          ? undefined
          : readSavedMethods(savedMethodsFolder(userData, context.profileSlug), Date.now())
      const launchContext = savedMethods === undefined ? context : { ...context, savedMethods }
      const savedMethodsLines =
        savedMethods === undefined ? null : savedMethodsLinesOf(savedMethods)
      const composed = profileBundleSpans(
        pack.kind === 'read' ? { ...context, factoryText: factoryTextOf(pack.pack) } : context,
        provider,
      )
      const bundle = publishProfileBundle(provider, providerHome, composed.text)
      const read = readSessionInstructions({
        provider,
        identity: { profileSlug: context.profileSlug, displayName: context.displayName },
        cwd,
        providerHome,
        bundle,
        bundleComposed: composed,
        thisConversation: thisConversationSpans(
          launchContext,
          toolsToldInTextFor(provider),
          provider,
        ),
        workspaceFile: providerKnowledge[provider].instructions.workspaceFile?.(
          brobotWorkspace(userData),
        ),
        workspaceOwnFiles: workspaceOwnFilesIn(userData),
      })
      return {
        instructions: read.instructions,
        systemHint:
          read.systemHint === null
            ? undefined
            : withTheLinesSent(read.systemHint, savedMethodsLines),
        ...(read.firstTurnLead === null
          ? {}
          : { firstTurnLead: withTheLinesSent(read.firstTurnLead, savedMethodsLines) }),
        ...(savedMethodsLines === null ? {} : { savedMethodsLines }),
        memoryLoaded: read.memoryLoaded,
        profileFile: read.profileFile,
        ...(savedMethods === undefined ? {} : { savedMethods: savedMethodsUseOf(savedMethods) }),
        ...(pack.kind === 'none'
          ? {}
          : {
              textPack:
                pack.kind === 'read'
                  ? { folder: pack.pack.folder, refused: null }
                  : { folder: pack.folder, refused: pack.refusal },
            }),
        context,
      }
    },
    exportDirectory: () => join(userData, 'exports'),
    newSessionId: newProviderSessionId,
    nativeTranscriptPath,
    userHomeSessions: () => discoverUserHomeSessions(),
    indexedDescriptions: () => indexedHomeDescriptions(),
    discoverSessions: () =>
      listProviderHomes(userData)
        .map((home) => discoverSessionsIn(home.provider, home.path, home.profileId))
        .reduce(
          (all, part) => ({
            found: [...all.found, ...part.found],
            skipped: [...all.skipped, ...part.skipped],
          }),
          { found: [], skipped: [] },
        ),
    readProviderConfig,
    liveness: { windowMs: readSilenceWindowMs() },
    announce: (change) => windowChangeNotices.announce(change),
    statesMoved: (message) =>
      broadcastRuntime(
        () => BrowserWindow.getAllWindows(),
        RUNTIME_STATES_CHANNEL,
        message,
        (error) => console.error('BroCrew could not tell a window what moved:', error),
        mainThreadWork,
        'window state broadcast',
      ),
    readProcessMemory: (pids: readonly number[]) =>
      process.platform === 'win32'
        ? listProcesses().then((rows) => memoryOf(pids, rows))
        : withDeadline(
            new Promise<ReadonlyMap<number, number>>((resolve, reject) => {
              execFile(
                'ps',
                psArgsFor(pids),
                { encoding: 'utf8', timeout: PS_TIMEOUT_MS, killSignal: 'SIGKILL' },
                (error, listing) => {
                  const sizes = residentSizesIn(error, listing)
                  if (sizes === null) reject(error)
                  else resolve(sizes)
                },
              )
            }),
            PS_READ_DEADLINE_MS,
            'the process memory read',
          ),
  })
  knowledgeChanged = () => runtimeHost.agentKnowledgeChanged()
  runtimeHost.fillQuestionCopies()
  return runtimeHost
}

function readSilenceWindowMs(): number {
  const raw = Number(process.env['BROBOT_SILENCE_WINDOW_MS'])
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SILENCE_WINDOW_MS
}

const CHOOSE_CWD_OPTIONS: OpenDialogOptions = {
  title: 'Choose a folder for this conversation',
  buttonLabel: 'Use this folder',
  properties: ['openDirectory', 'createDirectory'],
}

const CHOOSE_BUNDLE_OPTIONS: OpenDialogOptions = {
  title: 'Choose a BroCrew session bundle',
  buttonLabel: 'Restore this conversation',
  filters: [
    { name: 'BroCrew session bundle', extensions: [BUNDLE_SUFFIX.split('.').pop() ?? 'json'] },
  ],
  properties: ['openFile'],
}

const CHOOSE_ATTACHMENT_OPTIONS: OpenDialogOptions = {
  title: 'Choose a file or folder to hand to the agent',
  buttonLabel: 'Attach',
  properties: ['openFile', 'openDirectory'],
}

const CHOOSE_WORKSPACE_OPTIONS: OpenDialogOptions = {
  title: 'Choose a workspace folder',
  buttonLabel: 'Choose',
  properties: ['openDirectory', 'createDirectory'],
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

function intoTheStallLog(line: string): void {
  theStallSink ??= aDiagnosticsSink({ logs: presentation.hidden ? null : app.getPath('logs') })
  theStallSink.accept(`${new Date().toISOString()} pid ${String(process.pid)}: ${line}`)
}

let theStallSink: DiagnosticsSink | null = null

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
    // An unavailable plugin root also remains unavailable to Storage.
  }
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
      startStorageWorker({
        workerData: { roots, request },
        resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 8 },
      }),
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
  ipcMain.handle(TRANSCRIPT_RETENTION_CHANNELS.read, () => transcriptRetention!.read())
  ipcMain.handle(TRANSCRIPT_RETENTION_CHANNELS.set, (_event, period: unknown) => {
    if (!isTranscriptRetention(period)) throw new Error('Invalid transcript retention.')
    return transcriptRetention!.set(period)
  })
  ipcMain.handle('app:info', () => readAppInfo())
  const attentionWindows = new WeakMap<BrowserWindow, AttentionSignals>()
  ipcMain.handle(ATTENTION_SIGNALS_CHANNEL, (event, signal: unknown) => {
    if (!isAttentionSignal(signal)) throw new Error('Invalid attention signal.')
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window === null || window.isDestroyed()) return
    let signals = attentionWindows.get(window)
    if (signals === undefined) {
      signals = new AttentionSignals({
        platform: process.platform,
        isFocused: () => window.isFocused(),
        badge: (count) => {
          if (process.platform === 'darwin') app.dock?.setBadge(count === 0 ? '' : String(count))
          else if (process.platform === 'linux') app.setBadgeCount(count)
        },
        bounce: (kind) => app.dock?.bounce(kind),
        cancelBounce: (id) => app.dock?.cancelBounce(id),
        flash: (active) => {
          if (!window.isDestroyed()) window.flashFrame(active)
        },
        overlay: (count) => {
          if (window.isDestroyed()) return
          const png = attentionOverlay(count)
          window.setOverlayIcon(
            png === null ? null : nativeImage.createFromBuffer(png),
            count === 0 ? '' : `${count} item${count === 1 ? '' : 's'} waiting on you`,
          )
        },
      })
      const owned = signals
      window.on('focus', () => owned.focused())
      window.once('closed', () => owned.clear())
      window.webContents.on('render-process-gone', () => owned.reloaded())
      window.webContents.on('did-navigate', () => owned.reloaded())
      attentionWindows.set(window, signals)
    }
    signals.update(signal)
  })
  registerWindowControls(ipcMain, (event) => BrowserWindow.fromWebContents(event.sender))
  const writer = createDraftWriter(app.getPath('userData'))
  draftWriter = writer
  ipcMain.handle('app:saved-drafts', async (event) => {
    await writer.settled()
    const file = await readDraftsFile(app.getPath('userData'))
    const reader = event.sender
    if (file.kind === 'unreadable') {
      draftReaders.delete(reader.id)
      console.warn(`the unsent drafts were not read, so none will be kept this run: ${file.why}`)
      return null
    }
    if (!draftReaders.has(reader.id)) {
      const forget = (): void => void draftReaders.delete(reader.id)
      reader.once('render-process-gone', forget)
      reader.once('destroyed', forget)
    }
    draftReaders.add(reader.id)
    return restoreSavedDrafts(file.kind === 'book' ? file.raw : null, {
      exists: (sessionId) => recordedConversation?.(sessionId) ?? true,
    })
  })
  ipcMain.handle('app:save-drafts', (_event, saved: unknown) => writer.write(saved))
  ipcMain.handle('app:local-zone', () => localZone())
  ipcMain.handle('app:choose-cwd', async (event): Promise<ChosenCwd> => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const result = await pick(owner, CHOOSE_CWD_OPTIONS)
    const picked = result.canceled ? undefined : result.filePaths[0]
    if (picked === undefined) return null
    const verdict = checkSessionCwd(picked)
    return verdict.ok ? { path: verdict.path } : { path: picked, refusal: verdict.reason }
  })
  ipcMain.handle('app:choose-bundle', async (event): Promise<string | null> => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options = {
      ...CHOOSE_BUNDLE_OPTIONS,
      defaultPath: join(app.getPath('userData'), 'exports'),
    }
    const result = await pick(owner, options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle(
    'app:choose-attachment',
    async (event, input: { cwd?: string } = {}): Promise<ChosenAttachment> => {
      const owner = BrowserWindow.fromWebContents(event.sender)
      const result = await pick(owner, CHOOSE_ATTACHMENT_OPTIONS)
      const picked = result.canceled ? undefined : result.filePaths[0]
      if (picked === undefined) return null
      const verdict = await classifyHandedPath(picked, input.cwd ?? '')
      return 'refusal' in verdict ? { refusal: verdict.refusal } : { handed: verdict.handed }
    },
  )

  ipcMain.handle(
    'app:classify-attachments',
    async (_event, input: { handed?: HandedPath[]; cwd?: string } = {}): Promise<HandedPath[]> =>
      await captionHandedPaths(Array.isArray(input.handed) ? input.handed : [], input.cwd ?? ''),
  )

  ipcMain.handle(
    'app:hand-dropped-paths',
    async (_event, input: { paths?: unknown; cwd?: string } = {}): Promise<DroppedPathVerdict[]> =>
      await classifyDroppedPaths(Array.isArray(input.paths) ? input.paths : [], input.cwd ?? ''),
  )

  ipcMain.handle(
    'app:paste-image',
    async (_event, input: { cwd?: string } = {}): Promise<DroppedPathVerdict> => {
      const image = clipboard.readImage()
      if (image.isEmpty()) return { refusal: NO_IMAGE_ON_CLIPBOARD }
      const size = image.getSize()
      const refusal = tooManyPixels(size.width, size.height)
      if (refusal !== null) return { refusal }
      const root = pastedImagesRoot(app.getPath('userData'))
      return await pastePicture(root, image.toPNG(), input.cwd ?? '', Date.now())
    },
  )
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
        ipcMain.handle(channel, (event, ...args) =>
          mainThreadWork.timed(`command ${aCommandsKind(args[0])}`, () => listener(event, ...args)),
        ),
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
    frame: false,
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
    await transcriptRetention?.stop()
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
  void publishWorkspacePresence(app.getPath('userData')).catch((error: unknown) =>
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
      const verdict = await theVerdictBeforeTheData(ownership)
      if (closedWhileCheckingSaid) return
      if (verdict.kind !== 'open') {
        endInRecovery(verdict)
        return
      }
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
            window.webContents.send(THEMES_CHANNELS.changed, change)
          } catch {
            // A closed window must not prevent the other windows receiving this change.
          }
        }
      })
      host = await createRuntimeHost(initDatabase())
      registerIpc(host, localZone)
      startTheDockLabel()
      updates = startUpdates({ app, host, hidden: presentation.hidden })
      startWorkspaces({
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
      try {
        const root = pluginSupervisorRoot({
          appData: app.getPath('appData'),
          workspaceRoot: app.getPath('userData'),
          hidden: presentation.hidden,
          scratchRoot: app.commandLine.getSwitchValue('plugin-global-root'),
        })
        if (root && ownership === 'sole') {
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
        }
      } catch {
        console.warn('[plugins] plugin-initialization-failed')
      }
      createWindow()
      handOverToTheAppWindow()

      startRederive(host)
      startTitlingTheOlderFiles(host)
      startRecordingWhatTheOlderOnesRan(host)

      let itself = whatTheAppItselfHolds([])
      const intoTheMemoryLog = (message: string): void => {
        console.warn(message)
        try {
          const logs = app.getPath('logs')
          mkdirSync(logs, { recursive: true })
          appendFileSync(join(logs, 'memory.log'), `${new Date().toISOString()} ${message}\n`)
        } catch {
          // The console already has this diagnostic if the log cannot be written.
        }
      }
      const unrefdInterval = (fn: () => void, ms: number): unknown => {
        const timer = setInterval(fn, ms)
        timer.unref()
        return timer
      }
      const stopInterval = (handle: unknown): void =>
        clearInterval(handle as ReturnType<typeof setInterval>)
      startMemoryWatch({
        sample: () => {
          spawnedReader.refresh()
          itself = whatTheAppItselfHolds(app.getAppMetrics())
          return itself.bytes
        },
        detail: () =>
          `[${itself.said}] ${whatItsAgentsHoldApart(
            !spawnedReader.everRead()
              ? 'not-read-yet'
              : spawnedReader.failed()
                ? 'unreadable'
                : spawnedReader.snapshot(),
          )}`,
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
      sayAtOnce(READY_LINE)
      void letGoOfOldCopies()
    })
    .catch((error: unknown) => {
      void endAFailedStart(error, ownership)
    })
}

const lifetime = createAppLifetime({
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
    void stopRecoveryWork()
    void stopProviderSetup?.()
    updates?.stop()
    void transcriptRetention?.stop()
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
    await stopRecoveryWork()
    await stopProviderSetup?.()
    await updates?.drain()
    await transcriptRetention?.stop()
    await (stoppingTheStart ?? host?.drainArchiveWork() ?? Promise.resolve())
    await themes?.close()
    await theStallSink?.close(500)
  },
  closeDatabase: () => {
    db?.close()
    db = null
  },
  quit: () => app.quit(),
  quitAfterShutdown: () => (theDataOpened && !startFailed ? app.quit() : app.exit(1)),
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

function locateOffTheMainThread(folders: readonly string[]): Promise<ReadonlyMap<string, string>> {
  return new Promise((resolve, reject) => {
    const worker = startTheLocator({})
    let settled = false
    const settle = (then: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void worker.terminate()
      then()
    }
    const timer = setTimeout(
      () => settle(() => reject(new Error('the search for kept rules did not answer in time'))),
      10_000 + 1_500 * folders.length,
    )
    worker.once('message', (pairs: [string, string][]) => settle(() => resolve(new Map(pairs))))
    worker.once('error', (error: Error) => settle(() => reject(error)))
    worker.once('exit', (code: number) =>
      settle(() => reject(new Error(`the search for kept rules stopped (exit ${String(code)})`))),
    )
    worker.postMessage(folders)
  })
}
