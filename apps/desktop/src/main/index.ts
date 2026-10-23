import { workspaceLaunchMessage } from './workspace-routing'
import { WorkspacePluginAttachments } from './plugins/attachments'
import { pluginWorkspaceIdentity } from './plugins/supervisor/client'
import { registerPluginSettings } from './plugins/settings'
import { productionPluginController } from './plugins/production'
import { PluginSupervisorAttachment, pluginSupervisorRoot } from './plugins/supervisor/client'
import { PLUGIN_SCHEME } from './plugins/ui/assets'
import { installPluginUiRpc } from './plugins/ui/host'
import { ipcMain } from './app-ipc'
import { SharedSkillDiscovery } from './skills/shared-discovery'
import { convertSharedSkills } from './skills/shared-conversion'
import { SharedSkillLibrary } from './skills/shared-library'
import { providerProcessesAreInFlight } from './runtime/live-hosts'
import { TranscriptRetentionHost, transcriptStartupWasInterrupted } from './transcript-retention'
import {
  TRANSCRIPT_RETENTION_CHANNELS,
  isTranscriptRetention,
} from '../shared/transcript-retention'
import { ATTENTION_SIGNALS_CHANNEL, isAttentionSignal } from '../shared/attention-signals'
import { AttentionSignals } from './attention-signals'
import { attentionOverlay } from './attention-overlay'
import { installAppNavigation } from './app-navigation'
import { makeWorkerPieceFolder } from './worker-piece-folder'
import { keptShippedSkills, prepareBuiltInSkills } from './skills/prepare-built-in-skills'
import { factoryTextOf, readTextPack } from './skills/text-pack'
import { aStartAttemptsLog } from './start-attempts-log'
import { broadcastRuntime } from './runtime/window-broadcast'
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
import type { NativeImage, OpenDialogOptions } from 'electron'
import { providerValue, appInfoSchema, type AppInfo } from '@brobot2/shared'
import {
  changeCodexKeyInHome,
  claudeLoginRenewer,
  createSpawnTransportFactory,
  defaultKeychainReaderAsync,
  withDeadline,
} from '@brobot2/runtime'
import type {
  ChosenAttachment,
  ChosenCwd,
  DroppedPathVerdict,
  HandedPath,
} from '../shared/runtime-ipc'
import {
  APP_CLOSING_CHANNEL,
  BUNDLE_SUFFIX,
  NO_IMAGE_ON_CLIPBOARD,
  PROVIDERS_CHANGED_CHANNEL,
  RUNTIME_CHANGED_CHANNEL,
  RUNTIME_STATES_CHANNEL,
  type RuntimeChangeSubject,
} from '../shared/runtime-ipc'
import { buildBranches, buildIdentity, shownVersion } from './build-identity'
import { LIMITS_DISPLAY_CHANGED_CHANNEL } from '../shared/limits-display'
import { LimitsReaderLifetime } from './db/limits-reader-lifetime'
import { limitsWriterSampler } from './db/fresh-limits-snapshot'
import { windowWriterSampler } from './db/window-writer-stamp'
import { startLimitsReader } from './db/start-limits-reader'
import { startWindowReader } from './db/start-window-reader'
import { startWorkSearch } from './db/start-work-search'
import { startPastWorkSearch } from './db/start-past-work-search'
import { createAppLifetime } from './app-lifetime'
import { armLastResortExit } from './last-resort-exit'
import { ownershipFrom, runAsSoleInstance, type OwnershipAsked } from './single-instance'
import {
  KEPT_OUT_OF_SIGHT,
  keepOutOfSight,
  launchPresentation,
  otherDataFolder,
  PERSONS_TITLE,
  windowTitleFor,
} from './launch-presentation'
import { claimSoleHost, type HostGateVerdict } from './one-host-gate'
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
import { aStallLog } from './stall-log'
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
import { newProviderSessionId } from './db/ids'
import { discoverSessionsIn } from './adopt/discover-sessions'
import {
  claudeHomeDescriptions,
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
  pruneTheCopies,
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
  CLAUDE_CODE_SWITCH,
  LOOK_FOR_THE_INSTALLED_ONE,
  findClaudeProgramHere,
  type ClaudeProgram,
} from './runtime/claude-program'
import { resolveCodexProgram, type CodexProgram } from './runtime/codex-binary'
import {
  listProfileIds,
  listProviderHomes,
  deriveProviderHome,
  homePathsForProvider,
  providerHomesRoot,
  savedMethodsFolder,
  type CodexKeySeam,
} from './runtime/provider-homes'
import { createProviderModules, providerAuthFromModules } from './providers'
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
import { providerVersionsReader } from './runtime/provider-versions'
import { readKeptRules, removeKeptRule, type WhereRulesAreKept } from './kept-rules'
import startTheLocator from './local-settings-locator.worker?nodeWorker'
import { settingsLocations } from './settings-locations'
import { snapshotFor } from './provider-snapshots'
import type { Provider } from '@brobot2/shared'
import { ASSET_SCHEME_PRIVILEGES, installAssetProtocol } from './asset-protocol'
import { THEME_SCHEME_PRIVILEGES, installThemeProtocol } from './themes/asset-protocol'
import {
  DEFAULT_THEME_ID,
  DEFAULT_THEME_BACKGROUND,
  BUILT_IN_THEME_IDS,
  HIDDEN_BASE_THEME_IDS,
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
import {
  brobotWorkspace,
  CLAUDE_INSTRUCTIONS_FILE,
  ensureWorkspace,
  workspaceOwnFilesIn,
} from './runtime/workspace'
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
import { whoMayReadTheDataFolder } from './data-folder-privacy'
import { WorkspaceUnavailable } from './workspace-startup'
import { nodeFs as recoveryFiles } from './recovery/files'

// Pin the data folder before `ready` and the single-instance lock read it.
// OS display names must not move existing data; see `data-folder.ts`.
// A workspace that cannot open stops the launch with a message.
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
// Give Windows the app id used by its shortcuts.
nameTheAppToWindows(app)

/**
 * Write shutdown notices to stderr with {@link writeSync}; asynchronous logging can lose
 * queued bytes when the event loop stops. See {@link createAppLifetime}.
 */
const STDERR_FD = 2

/**
 * Declare asset-scheme privileges synchronously at module scope, before Electron's `ready`.
 * Registering them after `ready` throws and prevents startup. See `asset-protocol.ts`.
 *
 * The host gate waits for a local connection callback on this thread; Chromium startup can
 * hold that callback until after `ready`. Calling this from `start()`, even before its own
 * `whenReady()`, would therefore be too late. A gate that fails open on an overlong socket
 * path can mask the problem, so a live window check must also verify that the gate ran.
 *
 * This entry point is built as CommonJS, where top-level `await` is unavailable. Module
 * evaluation keeps the registration synchronous. A refused second launch only changes its
 * own process registry: the protocol handler, database and window are still created by `start()`.
 */
protocol.registerSchemesAsPrivileged([
  ASSET_SCHEME_PRIVILEGES,
  THEME_SCHEME_PRIVILEGES,
  PLUGIN_SCHEME,
])

/**
 * Cache the memory of spawned processes that Chromium's metrics exclude. A synchronous
 * `ps` can block the main thread for over a second under load, delaying IPC and window events.
 *
 * Refresh off-thread and report the previous sample. The agents' share of the app's log can
 * be one tick (30 s) old; the separate agents' line reads after a short delay to use this tick's
 * sample. An exited agent can consequently appear once in the app's breakdown without being
 * counted in Chromium's own figure. This lag is suitable for diagnostics, not decision making.
 * Before the first sample lands, `everRead` distinguishes an unread listing from an empty one.
 */
const spawnedReader = createSpawnedReader({
  now: () => Date.now(),
  rootPid: process.pid,
  // Read at the START of each go, so the pids we exclude belong with the listing about to be taken.
  // They can still disagree — a Chromium process that starts during the read is in the listing but
  // not in this set, and is counted as if we had spawned it. One transient utility, once.
  chromiumPids: () => new Set(app.getAppMetrics().map((metric) => metric.pid)),
  read: (done) =>
    void execFile(
      'ps',
      [...PS_ARGS],
      {
        encoding: 'utf8',
        timeout: PS_TIMEOUT_MS,
        maxBuffer: PS_MAX_BUFFER_BYTES,
        // SIGKILL rather than the default SIGTERM: `ps` has nothing to clean up, and SIGTERM is
        // exactly the signal a wedged process does not act on.
        killSignal: 'SIGKILL',
      },
      (error, stdout) => done(error, stdout),
    ),
})

let db: AppDatabase | null = null
/**
 * This launch's start failed with nobody to show it to (a hidden launch, or a recovery window that
 * could not open): it opens no window, for anyone, and exits 1.
 */
let startFailed = false

/** The start-up check, and the service the recovery window's calls go to. */
let recoveryService: RecoveryService | null = null
/**
 * Whether this start opened its data: the app's own window is then the one to show, and a quit
 * exits 0. Cleared by a start that fails after all.
 */
let theDataOpened = false
/** The recovery window's calls, once a start ends there or a long copy at start is shown. */
let recoveryCalls: RecoveryCalls | null = null
let recoveryWindow: BrowserWindow | null = null
/** What the start-up check is working on, while it says so. */
let workingOnNow: WorkingOn | null = null
let workingTimer: ReturnType<typeof setTimeout> | null = null
/** What the recovery window says the check is working on, while that is what it shows. */
let workingShown: WorkingOn | null = null
/** Whether the start-up check is running: a quit now ends a start that never opened its data. */
let checkingTheData = false
/** Whether this start has said it was closed while it checked its data, which it says once. */
let closedWhileCheckingSaid = false
/** Whether this start has said it did not start, and why, which it says once. */
let saidItDidNotStart = false
/** Whether a hidden launch has said it opened only its recovery window. */
let saidOpenedForRecovery = false
/** A failed start's stop of what it started, once begun; a quit's teardown waits for it. */
let stoppingTheStart: Promise<void> | null = null
/** A test's hidden launch keeps its recovery window instead of exiting (unpackaged builds only). */
let keepTheRecoveryWindowHidden: boolean | null = null
/** The one-app check's answer, asked again on a retry while it is still `unknown`. */
let theOneAppAnswer: OwnershipAsked | null = null
/** This build's migrations, read by the start-up check of a start that opens its data. */
let thisBuildsMigrations: readonly BuildMigration[] | null = null

/**
 * The long-lived runner: provider sessions live here in the main process, not in
 * the renderer. Created once the app is ready (it needs `userData`), torn down
 * before the app quits so no provider child outlives the window.
 */
let host: RuntimeHost | null = null
const pluginSupervisor = new PluginSupervisorAttachment()
let updates: ReturnType<typeof startUpdates> | null = null
let transcriptRetention: TranscriptRetentionHost | undefined
let signalFirstWindowLoad!: () => void
const firstWindowLoad = new Promise<void>((resolve) => {
  signalFirstWindowLoad = resolve
})
let themes: ThemeStore | null = null
let stopThemeIpc: (() => void) | undefined
let dockLabel: Promise<DockLabelHost> | undefined

/** Whether the one-host gate said `sole` at this launch: only then are services changed. */
let soleAtThisLaunch = false

/**
 * Whether a saved draft's conversation still exists. Set from the store in
 * {@link createRuntimeHost}; `restoreSavedDrafts` drops drafts of removed conversations.
 */
let recordedConversation: ((sessionId: string) => boolean) | null = null

/**
 * The draft writer, created by {@link registerIpc}; shutdown waits within a bound
 * for each participating window's last save.
 */
let draftWriter: DraftWriter | null = null

/**
 * Track draft readers by `webContents` id. Only windows that received drafts keep a book
 * and can answer a final-save request; asking other windows would consume the quit timeout.
 */
const draftReaders = new Set<number>()

/**
 * Request each draft reader's final book after conversations close. Closing refuses sends
 * and starts in flight, returning their words to drafts before this request. IPC from each
 * window arrives in order, and the writer coalesces earlier saves to the newest book.
 *
 * A command whose path check or launch outlives the close bound may still return its words
 * after the app exits; this function does not track those commands.
 *
 * Wait at most `QUIT_SAVE_WITHIN_MS`. An unanswered or failed save throws so shutdown reports
 * it through the synchronous logger.
 */
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
      // A window already on its way out has handed over what it had, on `pagehide`.
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

/**
 * Find the committed Drizzle migrations folder. `copyMigrations()` in
 * electron.vite.config.ts places a copy next to the built main bundle; the
 * source path is the dev fallback.
 */
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

/**
 * A migration that failed. The migrator rolled it back and the database was closed, so the data is
 * as it was and the copy made before it stays; the recovery window says so and can try again.
 */
class MigrationFailed extends Error {}

/** Open the DB under Electron userData and migrate BEFORE any window opens. */
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
      throw error
    }
  })()
  // Never run on a database a newer build migrated, one whose migration record cannot be read, or
  // one this build's migrations do not lead to (`db/newer-database.ts`): the start-up check refused
  // these before, and this refuses one that changed since. Asked before any migration, so a refusal
  // leaves the data exactly as it was.
  openOrRefuse(database, theBuildsMigrations(), {
    folder: app.getPath('userData'),
  })
  try {
    applyMigrations(database, migrationsFolder)
  } catch (error) {
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
  try {
    const compaction = compactWhenMuchIsFree(database, freeBytesOn(app.getPath('userData')))
    if (compaction === 'compacted') console.info('BroCrew gave its free database space back')
    if (compaction === 'compacted-log-held') {
      console.info('BroCrew gave its free database space back; its log file shrinks later')
    }
    if (compaction === 'not-enough-disk') {
      console.warn('BroCrew kept its free database space: the disk has no room to compact it')
    }
  } catch (error) {
    // The space stays free for new rows; a launch is not stopped for it.
    console.warn('BroCrew could not give its free database space back:', error)
  }
  db = database
  // Only once the open and every migration have passed, so a start refused or failed there never
  // says it opened normally.
  if (presentation.hidden) sayAtOnce(OPENED_NORMALLY_LINE)
  return database
}

/** This build's migrations as the start-up check read them; only a start it let open has them. */
function theBuildsMigrations(): readonly BuildMigration[] {
  if (thisBuildsMigrations === null) {
    throw new Error("the start-up check never read this build's migrations")
  }
  return thisBuildsMigrations
}

/**
 * How many database migrations have been applied, or `null` when that cannot be read —
 * `__drizzle_migrations` is a Drizzle internal; a future rename is tolerated, never thrown.
 */
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
  // Display an unreadable migration count as 0.
  const migrationsApplied = migrationsAppliedOrNull() ?? 0
  const sessions = db.prepare('SELECT count(*) AS c FROM provider_session').get() as { c: number }
  // Show the data folder when it differs from the default pinned at launch for both development
  // and packaged builds (`data-folder.ts`).
  const dataFolder = otherDataFolder(
    app.getPath('userData'),
    defaultDataFolder(app.getPath('appData')),
  )
  return appInfoSchema.parse({
    name: 'BroCrew',
    // Use the window bar's title: `BroBot2 — test` for a hidden launch, or a folder-qualified title
    // when a person's launch uses a nondefault data folder.
    windowTitle: windowTitleFor(presentation, dataFolder),
    // Name the workspace in the rail footer without including a person's name.
    workspace: workspaceOf(app.getPath('userData'), dataFolder === null),
    version: shownVersion(app.getVersion(), app.isPackaged),
    step: 'Step 0',
    // Use the commit and branch identities baked into the build. A packaged app has no repository,
    // and runtime git reads could describe a different checkout from the running code.
    // `buildIdentity()` has no I/O and cannot throw or suppress the migration count.
    build: { ...buildIdentity(), branches: buildBranches() },
    db: { migrationsApplied, providerSessionCount: sessions.c },
  })
}

/**
 * The runtime host, wired to the real adapters and to app-owned paths under
 * `userData`: one provider home per profile and provider, under the one `default` folder
 * (`provider-homes/default/<profile>/<provider>`), and the durable BroBot workspace unless the
 * caller names a cwd.
 */
/** The shipped skills' folder: beside a packaged app, or in the source tree a dev build runs from. */
function builtInSkillsResources(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'built-in-skills')
    : join(app.getAppPath(), 'resources', 'built-in-skills')
}

const pluginController = productionPluginController()

async function createRuntimeHost(database: AppDatabase): Promise<RuntimeHost> {
  // The shipped skills this run offers, read once as it starts, before any launch; a text pack
  // stands in under their version.
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
  const sharedDiscovery = new SharedSkillDiscovery(userData, skillsReady, shippedSkills)
  // Refresh generated workspace instructions on launch and recreate a deleted workspace.
  // Unchanged files are left alone. A symlink or file at `brobot-workspace` is refused without
  // blocking the app's window; `resolveSessionCwd` retries for sessions using the default cwd
  // and reports the refusal where the person can act on it.
  try {
    ensureWorkspace(userData)
  } catch (error) {
    console.warn(
      `the BroCrew workspace could not be prepared: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  // Touch images referenced by saved drafts synchronously before starting the asynchronous sweep,
  // so restored drafts keep their pictures. Sweep before a window opens, never on a timer that
  // could remove a picture while someone is composing. Removal failures do not block startup.
  keepDraftedPastes(userData, Date.now())
  void sweepPastedImages(pastedImagesRoot(userData), Date.now()).catch(() => 0)

  const store = timedMethods(
    createSessionStore(database, Date.now, mainThreadWork),
    'store',
    mainThreadWork,
  )
  // The provider walls are read ahead in short steps, after launch and again after a change only
  // a whole read can follow, so the first hold after either does not read a month of them at once.
  let wallsAheadFailed = false
  const readTheWallsAhead = (): void => {
    if (!database.open) return
    let whole = true
    try {
      whole = store.readAheadProviderWalls(Date.now(), 15)
    } catch (error) {
      // Each hold still reads them itself meanwhile.
      if (!wallsAheadFailed)
        console.warn(
          `the provider limits could not be read ahead: ${error instanceof Error ? error.message : String(error)}`,
        )
      wallsAheadFailed = true
    }
    setTimeout(readTheWallsAhead, whole ? 5_000 : 0).unref()
  }
  setTimeout(readTheWallsAhead, 0).unref()
  // ⚑ Where each Claude folder's local settings are kept: found off the main thread, since finding
  // one runs git, and kept between reads (`settings-locations.ts`).
  const claudeFolders = (): string[] => [
    ...new Set(
      store
        .recorded()
        .filter((one) => providerValue(one.provider, { claude: true, codex: false }))
        .map((one) => one.cwd),
    ),
  ]
  const locations = settingsLocations(locateOffTheMainThread)
  const whereRulesAreKept = (): WhereRulesAreKept => ({
    claudeProjectFiles: locations.known(claudeFolders()),
    homes: listProviderHomes(userData).map((home) => ({
      provider: home.provider,
      path: home.path,
    })),
    // ⛔ The person's own provider folders: listed from, never written to.
    personsOwn: [userProviderHomePath('claude'), userProviderHomePath('codex')],
  })
  // 🔒 **The API keys a person enters, sealed by `safeStorage`** — read on every launch, so a key
  // set, replaced or removed applies to the next one (`api-keys.ts`).
  const apiKeys = new ApiKeys(store, safeStorageCipher(safeStorage))
  const apiKey = (provider: Provider): Promise<string | null> => apiKeys.read(provider)
  // The Codex program a launch runs — the copy this app carries — looked up at every launch, key
  // change, sign-in and version read. One lookup, as Claude's below, so the Providers screen and a
  // conversation always mean the same program.
  const codexProgram = (): CodexProgram =>
    resolveCodexProgram({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      platform: process.platform,
      arch: process.arch,
    })
  // 🔒 **The Codex key, and Codex's own login with it** — on the app's own bundled binary, the one
  // every Codex conversation runs on, resolved at the moment a home is logged in or out.
  const codexKey: CodexKeySeam = {
    current: () => apiKeys.current('codex'),
    isSaved: () => apiKeys.status('codex').set,
    change: (home, change) =>
      changeCodexKeyInHome(createSpawnTransportFactory(codexProgram().path), home, change),
  }
  // One renewal of the person's Claude Code login at a time, for every start and reopen that needs
  // it, run with their own Claude Code and never a bundled copy.
  // A quit stops a run under way rather than leave it behind.
  const stopRenewing = new AbortController()
  app.once('will-quit', () => stopRenewing.abort())
  // The person's own Claude Code, never a copy this checkout carries: what renews their login, and
  // what a sentence tells them to run. A launch given a Claude Code by its path names that one.
  const claudeProgramFound = (): string | null => {
    const given = app.commandLine.getSwitchValue(CLAUDE_CODE_SWITCH)
    try {
      return findClaudeProgramHere({
        isPackaged: true,
        given: given === '' ? LOOK_FOR_THE_INSTALLED_ONE : given,
      }).path
    } catch {
      return null
    }
  }
  const renewClaudeLogin = claudeLoginRenewer({
    readLogin: defaultKeychainReaderAsync,
    signal: stopRenewing.signal,
    findProgram: claudeProgramFound,
  })
  // ⚠️ After the database is closed (a window reloading during a quit) nothing is dropped for want
  // of an answer — the same rule as having no store yet.
  recordedConversation = (sessionId) => db === null || store.recordedOne(sessionId) !== null
  // The person's own Claude Code, looked up at every launch and every version read. One lookup, so
  // the Providers screen and a conversation always mean the same program.
  // ⚑ A launch stops at the first copy it finds; the Providers page reads every copy, so a person
  // sees why updating another changed nothing.
  const claudeProgram = (everyCopy = false): ClaudeProgram =>
    findClaudeProgramHere({
      isPackaged: app.isPackaged,
      given: app.commandLine.hasSwitch(CLAUDE_CODE_SWITCH)
        ? app.commandLine.getSwitchValue(CLAUDE_CODE_SWITCH)
        : undefined,
      everyCopy,
    })
  const retention = (transcriptRetention ??= new TranscriptRetentionHost(
    userData,
    providerProcessesAreInFlight,
    Date.now,
    transcriptStartupWasInterrupted(store),
  ))
  retention.start()
  // Recovery observes interrupted operations before any host door can remove their identity.
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
    {
      claude: {
        runtime: {
          program: () => claudeProgram().path,
          programFound: claudeProgramFound,
          managedRoot: providerHomesRoot(userData),
          key: () => apiKey('claude'),
        },
        home: { key: () => apiKey('claude'), programFound: claudeProgramFound },
        auth: {
          key: () => apiKey('claude'),
          keyStatus: () => apiKeys.status('claude'),
          programFound: claudeProgramFound,
        },
      },
      codex: {
        runtime: { command: () => codexProgram().path },
        home: { key: codexKey },
        auth: { key: codexKey, command: () => codexProgram().path },
      },
    },
  )
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
    themes: themes ?? undefined,
    mainThreadWork,
    // Sessions and their events are recorded here, so they outlive this process.
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
    // Keep provider sign-in change times across restarts.
    signInChanges: signInChangesIn(userData),
    archived: archivedConversationsIn(userData),
    // When a give names a folder, describe where it meets provider folders, managed homes, this
    // data folder or other listed workspaces' data, excluding each workspace's own workspace folder.
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
    // Resolve the bundled Codex by absolute path, independent of PATH and the user's installed
    // version. Resolve per launch so a missing binary is reported on the command that needs it.
    createRuntime: (provider) => providerModules[provider].createRuntime(),
    // Derive the profile from the session; keep its provider home under `HOME_FOLDER`.
    beforeProviderLaunch: async () => {
      await transcriptRetention?.beforeLaunch()
    },
    prepareProviderHome: async (provider, profileId) => {
      await transcriptRetention?.beforeLaunch()
      return providerModules[provider].home.prepare(profileId)
    },
    prepareBuiltInSkills: ({ pack, ...input }) =>
      prepareBuiltInSkills({
        ...input,
        allShipped: true,
        managedRoot: providerHomesRoot(userData),
        shipped: shippedSkills,
        ...(pack?.kind === 'read' ? { skills: pack.pack.skills } : {}),
      }),
    // A text pack, read once for each launch; a packaged build never reads one.
    readTextPack: () => readTextPack(process.env, app.isPackaged, shippedVersion),
    // Each launch's timing, by name and number only, written later and kept to two files of at
    // most 2 MB.
    recordStartAttempt: aStartAttemptsLog(userData).write,
    // Share the same non-provisioning path derivation with memory recovery.
    ...providerHomePaths,
    // List profiles from directories under the managed root, without a separate registry.
    // `listProfileIds` includes `DEFAULT_PROFILE_ID` even before its directory exists.
    listProfiles: () => listProfileIds(userData),
    // Run credential operations on the bundled binary used by sessions, so a probe measures
    // the app's Codex rather than an unrelated executable on PATH.
    providerAuth: providerAuthFromModules(providerModules),
    apiKeys,
    renewClaudeLogin,
    claudeProgramFound,
    // 🔒 A key check asks the provider itself — only when a person presses it.
    askTheProvider: (provider, key) => askTheProvider(provider, key),
    // What the Providers screen reads: each program's version (Codex's once per run, Claude Code's
    // whenever the program changed), one process listing when it asks what the agents use, and the
    // windows told when a provider fact moved.
    providerVersions: providerVersionsReader(codexProgram, () => claudeProgram(true)),
    // What an *Always allow* kept — read where each provider keeps it, for the folders this app's
    // Claude conversations worked in and every agent's home — and a person's Remove.
    keptRules: async () => {
      const folders = claudeFolders()
      await locations.refresh(folders)
      // ⚑ A list missing folders it never found would read as rules that are not there.
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
    // Keep each provider's latest usage readings in this data folder across restarts.
    usageKept: {
      read: () => readKeptUsage(providerUsageFile(userData)),
      write: (usage) => writeKeptUsage(providerUsageFile(userData), usage),
    },
    // How each profile runs its work: which are services, and each service's one conversation.
    profileExecution: {
      read: () => readProfileExecution(profileExecutionFile(userData)),
      write: (kept) => writeProfileExecution(profileExecutionFile(userData), kept),
      owned: soleAtThisLaunch,
    },
    // What this app already did about each stopped conversation's scheduled jobs, kept across a
    // restart in this data folder.
    scheduleAttempts: {
      read: () => readKeptAttempts(scheduleAttemptsFile(userData)),
      write: (kept) => writeKeptAttempts(scheduleAttemptsFile(userData), kept),
    },
    // The turns this app's quit, or a crash, cut, with what it did about each: a cut turn is
    // continued once, at the next launch, on the account it ran on.
    turnsTheAppCut: {
      read: () => readKeptCuts(turnsTheAppCutFile(userData)),
      write: (kept) => writeKeptCuts(turnsTheAppCutFile(userData), kept),
    },
    // The Claude account those readings were read on, and the one copy of its email.
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
    // Open sign-in URLs through `shell.openExternal`, as with other external links; the renderer
    // cannot choose the browser mechanism.
    openExternal: async (url) => {
      await shell.openExternal(url)
    },
    // Reveal the file in Finder with `showItemInFolder`; it launches no file content. The Info
    // panel reads configuration onto the app's paper through `readConfigFile`.
    // This host-resolved path bypasses `externalTarget`, whose `file:` refusal protects links
    // inside documents rather than paths looked up by the host.
    revealPath: (path) => {
      shell.showItemInFolder(path)
    },
    // A document a message named, on the allowlist only (`message-paths.ts`): '' or the error.
    openPath: (path) => shell.openPath(path),
    // The provider-home root for containing agent-memory reads.
    providerHomesRoot: () => providerHomesRoot(userData),
    // Provider tool calls use the person's `ask` or `auto` approval mode without a separate
    // protected-root restriction.
    //
    // Resources are kept inside `userData` and read by id. Agents use `read_document` with
    // `RESOURCE_RAILS`; a person's `readResource` needs no capability. Both call `resourceBytes`
    // to contain the recorded file within the root and recheck its hash. `keepResource` renames
    // into the destination only after checking that the directory is app-owned.
    resourcesRoot: () => resourcesRoot(userData),
    makeWorkerPieceFolder: (piece) => makeWorkerPieceFolder(userData, piece),
    // Read the running build identity for each launch, as the window's chip does.
    whichBuild: () => ({ ...buildIdentity(), schema: migrationsAppliedOrNull() }),
    // Expose the build's snapshots of provider-supplied model instructions to the agent-input popup.
    providerSnapshot: (provider, model) => snapshotFor(provider, model),
    resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
    // Read instructions by walking the cwd chain, including the generated workspace file through
    // the same path as other projects. `workspaceFile` labels app-authored text for provenance.
    readInstructions: (provider, cwd, providerHome, context, launchPack) => {
      // Compile and publish both provider leaves from one profile bundle before reading launch
      // instructions. This layer owns provider-home filesystem writes; the host supplies the
      // launch context without taking on filesystem effects.
      //
      // A conflicting user override is an answer from `publishProfileBundle`, not a failed launch;
      // the reader shows that answer in the drawer. Keep provenance spans from the same walk as
      // the text so the sheet can group factory and configured instructions without reparsing.
      //
      // Compose conversation-specific facts separately and never publish them to the shared profile
      // leaf, which sibling launches rewrite. Claude receives them after the files in its system
      // prompt; Codex receives them before this life's first message (`SessionLaunchRead.firstTurnLead`).
      const pack = launchPack ?? readTextPack(process.env, app.isPackaged, shippedVersion)
      // The profile's saved methods as they are now, read at every start and cold reopen; a
      // conversation this app cannot place under a profile is given none.
      const savedMethods =
        context.profileSlug === null
          ? undefined
          : readSavedMethods(savedMethodsFolder(userData, context.profileSlug), Date.now())
      const launchContext = savedMethods === undefined ? context : { ...context, savedMethods }
      // The text is composed as every record keeps it; only the model is sent the index's lines.
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
        // Put tool-use instructions in Codex's first-turn lead: its namespace description is capped
        // by the app-server. Re-send the lead after compaction or a turn the provider never began
        // (`HostedSession.firstTurnLead`). Claude receives these with its tool catalogue through
        // the in-process server's `instructions`.
        thisConversation: thisConversationSpans(launchContext, toolsToldInTextFor(provider)),
        workspaceFile: join(brobotWorkspace(userData), CLAUDE_INSTRUCTIONS_FILE),
        // Pass the workspace file paths and canonical content from the function that writes both
        // `CLAUDE.md` and `AGENTS.md`. The Claude reader recognises that body, appends it once and
        // labels it as BroBot's. A path alone cannot prove authorship: the agent can edit its cwd.
        // See `InstructionInputs.workspaceOwnFiles`.
        workspaceOwnFiles: workspaceOwnFilesIn(userData),
      })
      return {
        instructions: read.instructions,
        // Use the reader's composed text, shared with the panel, instead of composing it again.
        // The reader selects its channel: Claude's system prompt or Codex's first-message lead.
        systemHint:
          read.systemHint === null
            ? undefined
            : withTheLinesSent(read.systemHint, savedMethodsLines),
        ...(read.firstTurnLead === null
          ? {}
          : { firstTurnLead: withTheLinesSent(read.firstTurnLead, savedMethodsLines) }),
        ...(savedMethodsLines === null ? {} : { savedMethodsLines }),
        // Carry the launch row from the same read. The host publishes `MemoryLoadedEvent` only for
        // a create; retaining the same shape on resume does not publish another row.
        memoryLoaded: read.memoryLoaded,
        // Keep the profile file and its composition context in the launch record, including on Codex,
        // where the provider reads the file itself.
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
    // Write exports to one app-owned location so sessions can be found without a file dialog.
    exportDirectory: () => join(userData, 'exports'),
    // Use the same session id shape as the persisted row.
    newSessionId: newProviderSessionId,
    // WHERE the provider keeps this session's file. Nothing is read here: the host pulls the lines
    // in windows, so this seam is a lookup with no size to it.
    nativeTranscriptPath,
    // The user's OWN homes, which nothing else here reads (046). Kept separate from
    // `discoverSessions` on purpose — that one looks only where the app provisions, and conflating
    // the two would let a pointer into someone's real history reach the resume path.
    //
    // ONE seam for both readers of these directories (047): the import takes the path, the library
    // also takes what each provider calls the conversation. Two calls would be two
    // readings of the same directory, free to disagree.
    userHomeSessions: () => discoverUserHomeSessions(),
    claudeDescriptions: () => claudeHomeDescriptions(),
    // Adoption looks in every home this app owns, so the profile a session is recorded under is
    // the one whose directory it was found in — read from the path rather than asked for.
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
    // The default silence window is two minutes, which no smoke can sit through; the
    // override lets a test drive the same code path in seconds. Never set in normal use.
    liveness: { windowMs: readSilenceWindowMs() },
    // 🔴 **534 · tell every window that a population it LISTS has moved.**
    //
    // ⛔ **Here because this is the only place that can be.** `RuntimeHost` imports no Electron and
    // holds no registry of windows; it knows about SINKS, and a sink belongs to one conversation —
    // which is precisely the scope that cannot carry this, because the conversations it is about
    // have no sink at all. `448` §A.1 priced this line before anything needed it.
    //
    // ⚑ Sent by {@link sayWhatMovedToTheWindows}, one message per subject per turn of the loop: a
    // burst of wakes moves the same lists many times, and each message makes every window read them
    // again.
    announce: (change) => {
      if (movedSubjects.size === 0) setImmediate(sayWhatMovedToTheWindows)
      movedSubjects.add(change.what)
    },
    // 🔴 **D-019 · tell every window what the agents whose state moved are doing now, and which
    // files were kept** (D-026) — see `RUNTIME_STATES_CHANNEL`. ⚑ {@link sayWhatMovedToTheWindows}'s
    // loop, for its reasons: every window, each send guarded on its own, and both objects asked.
    statesMoved: (message) =>
      broadcastRuntime(
        () => BrowserWindow.getAllWindows(),
        RUNTIME_STATES_CHANNEL,
        message,
        (error) => console.error('BroCrew could not tell a window what moved:', error),
        mainThreadWork,
        'window state broadcast',
      ),
    // Read memory for the conversations' provider pids with `psArgsFor`, rather than the whole
    // table. Apply `PS_READ_DEADLINE_MS`: the host shares this read, so a missing callback must
    // not hold all subsequent callers. Use the same `execFile` safeguards as `spawnedReader`.
    // ⚑ On Windows, which has no `ps`, from the one CIM listing of the table (`listProcesses`).
    readProcessMemory: (pids: readonly number[]) =>
      process.platform === 'win32'
        ? listProcesses().then((rows) => memoryOf(pids, rows))
        : withDeadline(
            new Promise<ReadonlyMap<number, number>>((resolve, reject) => {
              execFile(
                'ps',
                psArgsFor(pids),
                // SIGKILL for the watchdog's reason: `ps` has nothing to clean up.
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
  return runtimeHost
}

/** The silence window, overridable for tests; anything unparseable falls back to the default. */
function readSilenceWindowMs(): number {
  const raw = Number(process.env['BROBOT_SILENCE_WINDOW_MS'])
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SILENCE_WINDOW_MS
}

/**
 * Share folder-picker options between window-parented and standalone dialogs. `openDirectory`
 * prevents selecting a file that launch would refuse; `createDirectory` lets a conversation
 * start in a fresh folder without leaving the app.
 */
const CHOOSE_CWD_OPTIONS: OpenDialogOptions = {
  title: 'Choose a folder for this conversation',
  buttonLabel: 'Use this folder',
  properties: ['openDirectory', 'createDirectory'],
}

/**
 * Offer files with the export suffix and `json`. Shared files can be renamed to a plain
 * `.json`; hiding them would force a typed path. `readBundleFile` alone decides whether the
 * contents form a bundle.
 */
const CHOOSE_BUNDLE_OPTIONS: OpenDialogOptions = {
  title: 'Choose a BroCrew session bundle',
  buttonLabel: 'Restore this conversation',
  // Derive the extension from `BUNDLE_SUFFIX` to keep the picker aligned with exports.
  // Also offer `json` so renamed bundles remain visible.
  filters: [
    { name: 'BroCrew session bundle', extensions: [BUNDLE_SUFFIX.split('.').pop() ?? 'json'] },
  ],
  properties: ['openFile'],
}

/**
 * Offer one file or folder at a time; macOS supports both kinds in one dialog.
 * `classifyHandedPath` decides the returned kind. `MAX_HANDED_PATHS` caps accumulated
 * attachments without turning the picker into a multi-select control.
 */
const CHOOSE_ATTACHMENT_OPTIONS: OpenDialogOptions = {
  title: 'Choose a file or folder to hand to the agent',
  buttonLabel: 'Attach',
  properties: ['openFile', 'openDirectory'],
}

/**
 * Pick one workspace folder, with the option to create it.
 */
const CHOOSE_WORKSPACE_OPTIONS: OpenDialogOptions = {
  title: 'Choose a workspace folder',
  buttonLabel: 'Choose',
  properties: ['openDirectory', 'createDirectory'],
}

/**
 * Read launch visibility once from the command line. See `launch-presentation.ts` for why
 * the switch is not an environment variable.
 */
const presentation = launchPresentation((name) => app.commandLine.hasSwitch(name))

/** What moved since the windows were last told; told once the loop has finished its turn. */
const movedSubjects = new Set<RuntimeChangeSubject>()

/**
 * Tells every window what moved: every window rather than the focused one, each send guarded on its
 * own so a destroyed window cannot take the notice from the windows after it, and both objects
 * asked because a live `BrowserWindow` can hold a dead `webContents`.
 */
function sayWhatMovedToTheWindows(): void {
  const moved = [...movedSubjects]
  movedSubjects.clear()
  for (const what of moved)
    broadcastRuntime(
      () => BrowserWindow.getAllWindows(),
      RUNTIME_CHANGED_CHANNEL,
      { what },
      (error) => console.error('BroCrew could not tell a window that something moved:', error),
      mainThreadWork,
      'window change broadcast',
    )
}

/** The main thread's work, timed as it runs, for the stall watch to name. */
const mainThreadWork = new MainThreadWork()

/**
 * The computer's sleep and the window's sight, for the stall watch. The start counts as in sight:
 * its waits hold back the window the person is waiting for.
 */
const whatTheAppWasDoing = new WhatTheAppWasDoing(true)

/** Whether the page last said it is visible: a window covered by others is out of sight too. */
let thePageIsVisible = true

/** Whether the screen is locked. */
let theScreenIsLocked = false

/** Reads the window's sight again; set once the window exists. */
let lookAtTheWindow: () => void = () => {}

/** The page's own freeze reports; set once the commands are registered. */
let thePageReceipt: PageReceipt | null = null

/**
 * A stall's line, to the console and to `stalls.log` beside `memory.log`. A hidden launch (a test
 * or a smoke, loading the machine on purpose) writes to its console only.
 */
function intoTheStallLog(line: string): void {
  const said = `pid ${String(process.pid)}: ${line}`
  console.warn(said)
  if (presentation.hidden) return
  try {
    theStallLog ??= aStallLog(app.getPath('logs'))
    theStallLog(`${new Date().toISOString()} ${said}`)
  } catch {
    // Diagnostics only: the console line stands.
  }
}

let theStallLog: ((line: string) => void) | null = null

/**
 * Suppress Electron's error modal on hidden launches by adding an `uncaughtException`
 * listener that logs to the app output. Electron only shows that modal when its handler is
 * the sole listener; its existing handler still keeps the process alive. Visible launches
 * retain the framework's error handling.
 */
if (presentation.hidden) {
  process.on('uncaughtException', (error) => {
    console.error(`${KEPT_OUT_OF_SIGHT} an uncaught exception`, error)
  })
}

/**
 * Share the native picker path. Hidden launches log and return cancellation instead of
 * opening a dialog. Visible launches parent the dialog to the requesting window when one
 * exists, or open it standalone otherwise.
 */
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
  installPluginUiRpc(pluginIpcMain)
  registerPluginSettings(
    ipcMain,
    (event) => BrowserWindow.fromWebContents(event.sender),
    pluginController,
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
  /**
   * Register the three controls for the frameless window. Resolve the window from the IPC
   * sender; see `window-controls.ts` for the Electron actions and the product's labels.
   */
  registerWindowControls(ipcMain, (event) => BrowserWindow.fromWebContents(event.sender))
  /**
   * Restore unsent drafts before the renderer draws, then save the complete book after changes
   * and at shutdown. `drafts-file.ts` persists it; `saved-drafts.ts` determines its contents.
   * These handlers send no text to a conversation or provider: restoration checks conversation
   * existence and path metadata, while saving writes `<userData>/drafts.json`.
   */
  const writer = createDraftWriter(app.getPath('userData'))
  draftWriter = writer
  ipcMain.handle('app:saved-drafts', async (event) => {
    // ⚑ After any save in flight — a reloading window hands its book over and then asks for it back.
    await writer.settled()
    const file = await readDraftsFile(app.getPath('userData'))
    const reader = event.sender
    if (file.kind === 'unreadable') {
      draftReaders.delete(reader.id)
      // ⛔ Answered, not thrown — a rejected handle prints a stack on every launch — and `null`
      // means the window keeps nothing this run, so nothing is written over the file it could not see.
      console.warn(`the unsent drafts were not read, so none will be kept this run: ${file.why}`)
      return null
    }
    // ⚑ Counted until its renderer is gone — a crashed one answers nothing, and a reload reads again.
    if (!draftReaders.has(reader.id)) {
      const forget = (): void => void draftReaders.delete(reader.id)
      reader.once('render-process-gone', forget)
      reader.once('destroyed', forget)
    }
    draftReaders.add(reader.id)
    return restoreSavedDrafts(file.kind === 'book' ? file.raw : null, {
      // ⚠️ No store yet means no answer — so nothing is dropped for want of one.
      exists: (sessionId) => recordedConversation?.(sessionId) ?? true,
    })
  })
  ipcMain.handle('app:save-drafts', (_event, saved: unknown) => writer.write(saved))
  /**
   * Return the held system time zone without waiting for a file. `start()` reads it from the
   * system clock's data; when unavailable, return `null` so the window uses its own zone data.
   */
  ipcMain.handle('app:local-zone', () => localZone())
  /**
   * Check the chosen cwd immediately with the same `checkSessionCwd` rule used at launch:
   * it must exist, be a directory and be enterable; its location adds no restriction.
   * Return the refusal verbatim so the picker and launch agree. Cancellation returns `null`,
   * which the UI must distinguish from a refusal reason.
   */
  ipcMain.handle('app:choose-cwd', async (event): Promise<ChosenCwd> => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const result = await pick(owner, CHOOSE_CWD_OPTIONS)
    const picked = result.canceled ? undefined : result.filePaths[0]
    if (picked === undefined) return null
    const verdict = checkSessionCwd(picked)
    return verdict.ok ? { path: verdict.path } : { path: picked, refusal: verdict.reason }
  })
  /**
   * Pick a bundle path; cancellation returns `null`, distinct from an error. Unlike cwd
   * validation, bundle validation depends on file contents. Leave that read and its one
   * verdict to `importBundleFile` rather than reading and validating twice.
   */
  ipcMain.handle('app:choose-bundle', async (event): Promise<string | null> => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    // Where our own exports land, so the file you just wrote is the first thing the dialog shows.
    const options = {
      ...CHOOSE_BUNDLE_OPTIONS,
      defaultPath: join(app.getPath('userData'), 'exports'),
    }
    const result = await pick(owner, options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  /**
   * Classify a selected attachment before returning from the picker so a missing path is
   * reported at the gesture that chose it. `cwd` only captions whether it is outside the
   * working directory; send reclassifies against the session's actual cwd.
   * Read filesystem metadata, not file bytes (`handed-path.ts`). Cancellation returns `null`,
   * distinct from a refusal, as in the cwd and bundle pickers.
   */
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

  /**
   * Recompute attachment captions when the launcher's chosen cwd changes; an existing session's
   * cwd is fixed. Share `classifyHandedPath` with the picker and the host's send-time recheck.
   * Read metadata, not bytes; `no-byte-authority.test.ts` covers this route.
   * Drop vanished paths from this caption pass without showing a new error. If still sent,
   * `recheckHandedPaths` refuses them at the send gesture.
   */
  ipcMain.handle(
    'app:classify-attachments',
    async (_event, input: { handed?: HandedPath[]; cwd?: string } = {}): Promise<HandedPath[]> =>
      await captionHandedPaths(Array.isArray(input.handed) ? input.handed : [], input.cwd ?? ''),
  )

  /**
   * Classify dropped paths with the attachment picker's rule. Renderer paths are untrusted:
   * `classifyHandedPath` rejects relative or missing paths and derives kind and `outsideCwd`
   * from the filesystem. Send rechecks them through `recheckHandedPaths`.
   * Read metadata, not bytes; `no-byte-authority.test.ts` covers this route.
   */
  ipcMain.handle(
    'app:hand-dropped-paths',
    async (_event, input: { paths?: unknown; cwd?: string } = {}): Promise<DroppedPathVerdict[]> =>
      await classifyDroppedPaths(Array.isArray(input.paths) ? input.paths : [], input.cwd ?? ''),
  )

  /**
   * Read the clipboard image in main, then stage it as a path. The renderer reports the paste
   * without acquiring file bytes; main reads what the OS clipboard actually holds instead of
   * trusting a renderer-supplied buffer. The handler reads no file, and the staging module
   * writes without reading (`no-byte-authority.test.ts`).
   *
   * Electron's `readImage()` and `toPNG()` are synchronous and have no asynchronous equivalent.
   * Their CPU work occurs only for a paste gesture and is capped by the pixel check below;
   * all subsequent staging in {@link pastePicture} is asynchronous.
   */
  ipcMain.handle(
    'app:paste-image',
    async (_event, input: { cwd?: string } = {}): Promise<DroppedPathVerdict> => {
      const image = clipboard.readImage()
      if (image.isEmpty()) return { refusal: NO_IMAGE_ON_CLIPBOARD }
      // Check pixel dimensions before `toPNG()`: an encoded-byte limit bounds the disk write but
      // cannot prevent a huge canvas from exhausting memory during encoding. `getSize()` matches
      // `toPNG()` at its default scale factor of 1.0; multiplying by display scale would reject
      // pictures using dimensions absent from the file. This reading only sets the ceiling;
      // the displayed dimensions come from the PNG header through `pngSize`.
      const size = image.getSize()
      const refusal = tooManyPixels(size.width, size.height)
      if (refusal !== null) return { refusal }
      const root = pastedImagesRoot(app.getPath('userData'))
      // Sweep before each paste as well as at startup, since closing all windows need not quit
      // the app. Sweep and write take one turn of the root queue in `pastePicture` (`onTheRoot`).
      // Separate calls could let the startup sweep stat an old digest path and unlink a fresh
      // replacement after this write. Queueing both operations together prevents that race.
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
  registerRuntimeIpc({
    // Each command's synchronous part is timed under its kind, for the stall watch.
    ipc: {
      handle: (channel, listener) =>
        ipcMain.handle(channel, (event, ...args) =>
          mainThreadWork.timed(`command ${aCommandsKind(args[0])}`, () => listener(event, ...args)),
        ),
    },
    host: runtimeHost,
    // Events go back to the renderer that asked for the session, and only there.
    sinkFor: (event) => webContentsSink(event.sender, mainThreadWork),
    pageReceipt: thePageReceipt,
  })
}

function createWindow(): void {
  // Allow windows to be dragged, tiled or zoomed below the CSS frame width. A native `minWidth`
  // would block tiling and small displays without preventing zoom from shrinking the CSS
  // viewport. `#app` in `base.css` supplies horizontal scrolling so every control remains
  // reachable, including when the viewport is narrower than the frame.
  const window = new BrowserWindow({
    width: 1200,
    height: 840,
    /**
     * Use the app's title bar as the sole frame and route its real buttons through
     * `window-controls.ts`. Removing the OS bar gives its height to the renderer instead of
     * stacking two title bars. Edge and corner resizing, title-bar double-click and native
     * fullscreen remain available. macOS's green-button hover menu is lost with the native
     * traffic lights; `hiddenInset` would preserve that menu with OS-positioned buttons.
     */
    frame: false,
    show: false,
    title: 'BroCrew',
    // Paint the active theme's opaque background before the renderer's first frame.
    backgroundColor: themes?.background() ?? DEFAULT_THEME_BACKGROUND,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // Keep a hidden launch's window out of sight (`launch-presentation.ts`). Both paths use
  // the same window options; visibility is applied here.
  if (presentation.hidden) keepOutOfSight(window)
  window.webContents.once('did-finish-load', () => signalFirstWindowLoad())
  window.on('ready-to-show', () => {
    if (!presentation.hidden) window.show()
  })
  // Whether the window can be seen, for the stall watch: a timer late while it cannot was paused by
  // the system, and nobody saw a wheel.
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
  // A page that stops answering is logged with the main thread's stalls: the two read together.
  logWhenThePageStopsAnswering(window, intoTheStallLog)

  // Keep the window on its resolved app document and refuse new windows. Any navigated page
  // would inherit the preload bridge, including `window.api.runtime`; context isolation and
  // sandboxing do not remove an intentionally exposed API.
  // Resolve the document once and share it with the loader and `window-navigation.ts` guard,
  // so an environment change cannot make them disagree. A `file://` scheme alone is too broad.
  const entry = appDocument()
  installNavigationGuard(window.webContents, entry, (url) => void shell.openExternal(url))

  // Close a window's sessions when it closes, crashes or reloads into a renderer that no longer
  // knows them. The close barrier rejects pending permissions so no provider child lacks a
  // recipient able to answer it. Reattachment would require persisted session references.
  // `window-navigation.ts` selects release events, including `render-process-gone`; a loading
  // event alone is insufficient because it can precede a navigation the guard vetoes.
  const ownerId = sinkOwnerId(window.webContents)
  const releaseSessions = (): void => {
    void host?.closeSessionsForOwner(ownerId)
  }
  installSessionRelease(window.webContents, releaseSessions)

  // electron-vite injects the renderer dev-server URL in development; a renderer
  // reload reloads only the window and never restarts the main process.
  if (entry.devServerUrl !== undefined) {
    void window.loadURL(entry.devServerUrl)
  } else {
    void window.loadFile(entry.indexHtml)
  }
}

/**
 * Resolve the document shared by the loader and {@link installNavigationGuard}.
 * An empty `ELECTRON_RENDERER_URL` means no dev server; treating it as present would try
 * to load an empty URL and give the origin guard an unparseable document.
 */
function appDocument(): AppDocument {
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  return {
    indexHtml: join(__dirname, '../renderer/index.html'),
    ...(devServerUrl ? { devServerUrl } : {}),
  }
}

/**
 * Derive dev-server presence through {@link appDocument} rather than rereading the
 * environment, so the policy and loaded document agree, including for an empty URL.
 */
function isDevServer(): boolean {
  return appDocument().devServerUrl !== undefined
}

/** How long a check at start may run before the recovery window opens to say it is working. */
const SAY_WORKING_AFTER_MS = 2000

/**
 * Writes a line to stderr at once. A start that ends here may exit right after, and a line queued
 * for the event loop would be lost.
 */
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

/**
 * The start-up check and the recovery window's service, over this launch's data folder. A build
 * that is not packaged may be asked for a fault on its command line, so a test can stop a copy, a
 * restore or a return of the real app at a chosen point; a packaged build takes none. The fault is
 * said on the console, so it is never silent.
 */
function theRecoveryService(launchOwnership: HostGateVerdict): RecoveryService {
  const existing = workspaceStartup(app)
  existing?.assertDatabase()
  const { commit } = buildIdentity()
  const userData = app.getPath('userData')
  const asker = ownershipFrom(launchOwnership, () => claimSoleHost(userData))
  theOneAppAnswer = asker
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
    ownership: asker.ask,
    log: sayAtOnce,
    working: (what) => sayWorkingIfItTakesLong(what),
    progress: (done, total) => recoveryCalls?.progress(done, total),
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

/**
 * Decides, before anything opens the workspace's data, whether this start may open it
 * (`recovery/coordinator.ts`). A check that runs long, such as a copy of a large database, opens
 * the recovery window to say so.
 */
async function theVerdictBeforeTheData(launchOwnership: HostGateVerdict): Promise<StartupVerdict> {
  const service = theRecoveryService(launchOwnership)
  recoveryService = service
  checkingTheData = true
  try {
    const verdict = await service.inspect()
    workspaceStartup(app)?.assertDatabase()
    // The open reads the database against the same migrations, to refuse one that changed since.
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
    // A window already saying the check is working says what it works on now.
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

/**
 * A start that may not open its data, or that failed: the fail line and the reason, then the
 * recovery window alone. A hidden launch has nobody to show it to: it exits 1, at once when it
 * opened nothing (saying which way its start went), else through the teardown that closes what it
 * opened. A start a quit ended during its check has said so already, and ends as that quit ends it.
 */
function endInRecovery(verdict: StartupVerdict): void {
  if (closedWhileCheckingSaid) return
  // Once: a recovery window that failed to open ends here a second time, as a failed start.
  if (!saidItDidNotStart) {
    saidItDidNotStart = true
    sayAtOnce(FAIL_LINE)
    sayAtOnce(whyItDidNotStart(verdict))
  }
  // The app's own window is not this start's, and a quit from here exits 1.
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

/**
 * A start that failed once its check let it open the data ends like one the check refused, on
 * what the failure means ({@link whatAFailedStartEndsOn}), which says the error first. What it
 * started is stopped beside that, so nothing runs on behind the recovery window; the window does
 * not wait for the stop, and a retry and a quit's teardown do. Never throws: when even that fails,
 * the process says why and ends.
 */
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
  // The app's own window is not this start's from here, so a quit, even during the stop, exits 1.
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

/**
 * A failed migration changed nothing, and the copy made before it stays: it may be tried again. A
 * database the open refused changed after the check let it open, so the check is asked again and
 * its verdict stands: a newer database with any copy to restore, or the reason it cannot be read.
 * When the check cannot say, the open's own refusal stands, with no copy offered. Any other error
 * is said in full on the log and in its own words as the reason, and may be tried again.
 */
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

/**
 * Stops what a failed start started, in a quit's order and each step on its own: its archive work,
 * its conversations and wake-ups, then the archive work closing them made. Once, and it never
 * rejects. A quit's teardown waits for it instead of doing it again. The database stays open and
 * idle; that teardown closes it.
 */
function stopWhatTheStartStarted(): Promise<void> {
  stoppingTheStart ??= (async () => {
    await transcriptRetention?.stop()
    // A retry keeps the stopped startup attempt; clearing cannot reopen in this app session.
    stopThemeIpc?.()
    stopThemeIpc = undefined
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

/** A start closed while it checked its data says so, once, as a start that did not start. */
function sayClosedWhileChecking(): void {
  if (closedWhileCheckingSaid) return
  closedWhileCheckingSaid = true
  sayAtOnce(FAIL_LINE)
  sayAtOnce(CLOSED_WHILE_CHECKING)
}

/** Opens the recovery window on `verdict`, or tells the open one. Its calls are registered once. */
function showRecovery(verdict: StartupVerdict): void {
  workingShown = verdict.kind === 'working' ? verdict.what : null
  if (recoveryCalls !== null) {
    recoveryCalls.settle(verdict)
  } else {
    if (recoveryService === null) throw new Error('the start-up check never ran')
    const service = recoveryService
    recoveryCalls = createRecoveryCalls({
      // A retry reads the data only once a failed start has stopped writing it.
      service: {
        inspect: () => service.inspect(),
        restore: (checkpointId, progress) => service.restore(checkpointId, progress),
        returnToNewer: (progress) => service.returnToNewer(progress),
        retry: async () => {
          await stoppingTheStart
          return service.retry()
        },
      },
      verdict,
      openReader: (database) => createHistoryReader(database),
      // Read when asked, with nothing watched: an open path that failed may already watch it.
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

/** Opens the recovery window. Closing it quits, unless it was handed over to the app's own. */
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

/**
 * Quitting from the recovery window: this start did not open its data for work, so it exits
 * non-zero. One closed while the start-up check still runs says so first.
 */
function quitFromRecovery(): void {
  if (checkingTheData) sayClosedWhileChecking()
  recoveryCalls?.close()
  endTheProcess(1)
}

/** The data opens now: a new process makes the ordinary start, which this one did not finish. */
function relaunchIntoANormalStart(): void {
  recoveryCalls?.close()
  app.relaunch()
  endTheProcess(0)
}

/**
 * The app's own window is up: a recovery window that said a copy was being made closes, and is no
 * longer this start's, so its closing quits nothing.
 */
function handOverToTheAppWindow(): void {
  const handed = recoveryWindow
  if (handed === null) return
  recoveryWindow = null
  recoveryCalls?.close()
  handed.close()
}

/**
 * A window asked for while none is open: the app's own once its data opened, else the recovery
 * window once it exists. A check still running shows nothing sooner than its own timer would, so
 * a quick check never flashes the recovery window.
 */
function showThisStartsWindow(): void {
  if (startFailed) return
  if (theDataOpened) createWindow()
  else if (recoveryCalls !== null) openTheRecoveryWindow()
}

/** Lets go of the recovery copies no longer kept, once the start has said it is ready. */
async function letGoOfOldCopies(): Promise<void> {
  try {
    const removed = await pruneTheCopies(
      app.getPath('userData'),
      resolveMigrationsFolder(),
      theOneAppAnswer?.held() ?? 'unknown',
      (line) => console.warn(line),
    )
    if (removed.length > 0) {
      console.info(`BroCrew let go of ${String(removed.length)} old recovery copies`)
    }
  } catch (error) {
    console.warn('BroCrew could not let go of its old recovery copies:', error)
  }
}

/**
 * Ends this process: at once with `code` when the start opened nothing, else through the ordinary
 * teardown, which closes the host and the database in their order, and whose last step exits with
 * code 1 for a start that did not finish.
 */
function endTheProcess(code: number): void {
  if (host === null && db === null) {
    app.exit(code)
    return
  }
  app.quit()
}

/**
 * Record models for older Claude conversations once from their transcripts
 * (`recordWhatTheOlderOnesRan`), after the window opens. Subsequent launches reread only
 * conversations whose transcript is absent or names no model.
 */
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
      // Catch-up work must never stop the app from starting.
      console.warn('recording what the older conversations ran failed:', error)
    })
}

/**
 * Title older kept files after the window opens (`titleTheOlderFiles`), yielding before
 * the first read. Scan once when none need titles; reread files an older reader may have
 * titled on each launch and replace only titles that reader supplied.
 */
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
      // Catch-up work must never stop the app from starting.
      console.warn('titling the files kept before titles were taken failed:', error)
    })
}

/**
 * Rebuild one conversation's transcript from its provider's file, on request:
 *
 *     BROBOT_REDERIVE=sess_0193…
 *
 * Accept one session id, without lists or wildcards, to avoid a costly corpus-wide rebuild
 * at launch. The library button uses the same {@link RuntimeHost.rebuildLedger} operation.
 */
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
      // Catch-up work must never stop the app from starting.
      console.warn('re-derive failed:', error)
    })
}

/**
 * Set the Dock and About icon for launches from source; packaged apps carry it in their
 * bundle (`mac.icon` in `electron-builder.yml`). `build/` is beside `out/` in source launches.
 * Pass a `nativeImage` to the Dock and log an empty image if the file cannot be read,
 * so a missing icon does not prevent the window from opening.
 */
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

/**
 * The Dock label (`dock-label.ts`): this workspace's short name on a band across the app's icon,
 * kept in its own data folder and set in Settings → General. A launch kept out of the Dock keeps
 * the setting and paints nothing. Turned off, the Dock gets the app's own icon back: the bundle's
 * when packaged (`setIcon(null)`, checked on Electron 43.2), the logo above when run from source.
 */
function startTheDockLabel(): void {
  const userData = app.getPath('userData')
  const dock = app.dock
  const defaultFolder = defaultDataFolder(app.getPath('appData'))
  // Every known workspace shares out the starting colours, so a person's don't repeat. The list and
  // each workspace's name are read carefully, and the whole answer gives up after two seconds (a
  // folder on a share that's gone); the plain hash of the name then stands.
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
  // The host starts at once; the workspace's name is read inside it, carefully and within two
  // seconds, and a label already saved never waits for it.
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

/**
 * Start the sole host for this `userData` after {@link runAsSoleInstance} acquires the gate.
 * A refused launch opens no database, creates no host and shows no window; only the process-local
 * asset privilege declaration has run at module scope. Ready-dependent work waits explicitly.
 * `ownership` allows the startup check to change data only when this launch is the sole owner.
 */
function start(ownership: HostGateVerdict): void {
  // Only the one app on this data may change which agents are services.
  soleAtThisLaunch = ownership === 'sole'

  // The teardown's two entrances. Registered here rather than at module scope so that a second
  // launch — which has nothing to tear down and no database to close — never gets a `before-quit`
  // handler that would defer its own exit through a shutdown that has nothing to do.
  // A quit while the start-up check runs ends a start that never opened its data: it says so, and
  // the lifetime's last step exits with code 1.
  app.on('before-quit', () => {
    if (checkingTheData) sayClosedWhileChecking()
  })
  app.on('before-quit', (event) => lifetime.beforeQuit(event))
  app.on('window-all-closed', () => lifetime.windowAllClosed(process.platform))
  // Stamp Electron's late quit phases alongside the app's shutdown report to distinguish
  // ordered teardown time from the engine's exit delay.
  app.on('will-quit', () => lifetime.noteQuitPhase('will-quit'))
  app.on('quit', () => lifetime.noteQuitPhase('quit'))

  app
    .whenReady()
    .then(async () => {
      // Set the icon before the hidden launch's `hide()`, so hiding remains the final Dock action.
      if (!app.isPackaged) showTheLogoInTheDock()
      // Hide test launches from the Dock and application switcher too; an unshown window alone
      // can still make Electron a foreground app. `app.dock` is macOS-only.
      if (presentation.hidden) app.dock?.hide()
      // Install the document's policy before loading it. Vite's HTTP responses pass through here;
      // packaged `file://` loads may not, so the built HTML also carries a policy `<meta>`.
      // Both derive the same value from `rendererCsp` (`electron.vite.config.ts`). Installed before
      // the start-up check, so the recovery window's document is held to it too.
      installCspHeaders(session.defaultSession.webRequest, rendererCsp(isDevServer()))
      // Install the app menu before any ordinary or recovery window. Electron's default Reload
      // navigates and releases conversations, so `app-menu.ts` removes it. Set the displayed
      // BroBot labels without changing `app.getName()`, which also determines the data folder.
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
      // Silent while the main thread keeps up; a stall of half a second or more is logged with
      // the work that ran in it (`stall-watch.ts`). Started before the database opens, and the
      // start below is timed as one piece of work, so a slow start is logged under its own name.
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
      // Nothing opens the workspace's data before the start-up check has said it may: an
      // unfinished restore is settled, a restored copy stays read-only, a newer or unreadable
      // database is refused, and a checked copy is made before the data changes. A start it
      // refuses ends in the recovery window, and none of what follows runs.
      const verdict = await theVerdictBeforeTheData(ownership)
      // A quit asked during the check has ended this start already, and its data never opens.
      if (closedWhileCheckingSaid) return
      if (verdict.kind !== 'open') {
        endInRecovery(verdict)
        return
      }
      const startBegan = performance.now()
      // Read and watch the system time zone before reporting times (`system-zone.ts`). Notify
      // every live window when it changes, with each send guarded independently, and reschedule
      // waiting jobs in the new zone.
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
        defaultTheme: DEFAULT_THEME_ID,
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
            // A closed window does not stop the other windows from receiving the change.
          }
        }
      })
      host = await createRuntimeHost(initDatabase())
      registerIpc(host, localZone)
      startTheDockLabel()
      // Start updates for packaged builds with a release feed: check at launch and once daily
      // when enabled, with the window reading and controlling `updates-in-the-app.ts`.
      updates = startUpdates({ app, host, hidden: presentation.hidden })
      // List, open and create workspaces through `workspaces-in-the-app.ts`. A visible launch
      // adds its folder to the list. Its actual data folder was already chosen by
      // `pinTheDataFolder` or `--user-data-dir`; listing workspaces does not choose it.
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
      // Load snapshots of each bundled provider's own model instructions from this build's files,
      // without querying a provider (`provider-snapshots.ts`).
      startProviderSnapshots()
      // Install per-session image serving before the window can request it. Any existing image
      // file is served by type, without a root restriction (`asset-protocol.ts`).
      installAssetProtocol(session.defaultSession.protocol)
      installThemeProtocol(session.defaultSession.protocol, themes)
      theDataOpened = true
      // The workspace is open; plugin startup must not block the rest of the app.
      // Hidden starts require an explicit scratch root and never fall back to the live one.
      try {
        const root = pluginSupervisorRoot({
          appData: app.getPath('appData'),
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
            resourcesRoot: app.isPackaged
              ? process.resourcesPath
              : join(__dirname, '../../resources'),
            build: buildIdentity().id,
            appVersion: app.getVersion(),
            supervisor: pluginSupervisor,
          })
        }
      } catch {
        // Plugin unavailability cannot prevent agents or the rest of the app from starting.
        console.warn('[plugins] plugin-initialization-failed')
      }
      createWindow()
      handOverToTheAppWindow()

      startRederive(host)
      startTitlingTheOlderFiles(host)
      startRecordingWhatTheOlderOnesRan(host)
      // Said once in the log when anyone else may read the data folder; Settings shows it too.
      void whoMayReadTheDataFolder(app.getPath('userData'))

      // Log only when app memory grows or agents exceed runaway floors (`memory-watch.ts`).
      // Write to a file as well as the console: packaged stderr may have no recipient, and a
      // terminal log may be lost after the process is killed. Keep `sample`'s last app reading
      // for the same breakdown the line reports.
      let itself = whatTheAppItselfHolds([])
      // ⚑ **Where both lines go, and the timers both run on** — the same for the app's own line and
      // the agents' own.
      const intoTheMemoryLog = (message: string): void => {
        console.warn(message)
        try {
          const logs = app.getPath('logs')
          mkdirSync(logs, { recursive: true })
          appendFileSync(join(logs, 'memory.log'), `${new Date().toISOString()} ${message}\n`)
        } catch {
          // A log that cannot be written must not take the app down — the console line above is
          // still the fallback, and this whole mechanism is diagnostics, not function.
        }
      }
      const unrefdInterval = (fn: () => void, ms: number): unknown => {
        const timer = setInterval(fn, ms)
        // Diagnostics must never be the reason the process stays alive; Electron's own message
        // loop keeps it running, so an unref'd timer still fires for as long as the app exists.
        timer.unref()
        return timer
      }
      const stopInterval = (handle: unknown): void =>
        clearInterval(handle as ReturnType<typeof setInterval>)
      startMemoryWatch({
        // ⚑ **The app ITSELF — the Chromium half, main, its window, the GPU and the utilities — and
        // its agents apart** (`memory-watch.ts` says why: the agents held 63–95% of every total the
        // watchdog called *far above normal*). `getAppMetrics()` lists Chromium's processes and none
        // this app spawned; `workingSetSize` is in KILOBYTES (Electron's unit).
        sample: () => {
          // Kick the next reading of the agents off, for the line's other half; never wait for `ps`.
          spawnedReader.refresh()
          itself = whatTheAppItselfHolds(app.getAppMetrics())
          return itself.bytes
        },
        // ⚑ **The app's own processes, each by a plain name, then what its agents hold apart** — read
        // from the last listing of what it spawned, up to one tick old (`createSpawnedReader`).
        // ⚠️ A listing not read yet, an unreadable `ps` and an app with no agents would all be an
        // empty list; saying which is the difference between "nothing was running" and "we could not
        // see what was running".
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
      // ⚑ **The agents' own line** — what they and the commands they run hold together, past a floor
      // only a runaway reaches (`agentsMemoryFloorFor`), naming the agents holding the most, and
      // begun again once an episode ends. ⛔ **No listing of its own**: it reads the one the app's
      // line starts each tick (`spawnedReader`), looking `AGENTS_LINE_LAG_MS` after it so that tick's
      // listing has landed, and names the agents only when it writes.
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

      // Register quit-signal handlers from `whenReady`, after Chromium installs its own handlers.
      // Module-scope listeners can be overwritten. This placement lets repeated signals reach
      // the app's ordered teardown rather than bypassing JavaScript; see `AppLifetime.quitSignal`.
      for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
        process.on(signal, () => lifetime.quitSignal(signal))
      }

      mainThreadWork.add('the start', performance.now() - startBegan)
      // Once, last, when every step of the start has run; something watching the start matches the
      // line. Only then may old recovery copies go.
      sayAtOnce(READY_LINE)
      void letGoOfOldCopies()
    })
    .catch((error: unknown) => {
      // A person's launch ends in the recovery window, never in a bare error box or in silence; a
      // hidden one says the fail line and the reason, and exits 1.
      void endAFailedStart(error, ownership)
    })
}

/**
 * Wire shutdown ordering through `app-lifetime.ts`, which owns the policy in a module
 * that can be loaded independently for tests.
 */
const lifetime = createAppLifetime({
  // Announce closing to every window. Guard sends individually so one destroyed `webContents`
  // does not suppress notices to later windows. Check both objects: a live `BrowserWindow`
  // can still have destroyed contents.
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
  // Save windows' final drafts after conversations close, as a separately timed shutdown step.
  // See {@link theLastDraftSaves}.
  keepUnsentDrafts: () => theLastDraftSaves(),
  // An import or rebuild is catch-up work, not something to hold a quit open for — but it must STOP
  // (046 review, P2): a pass still running when the connection closes would throw against it. It
  // ends at the next boundary.
  stopArchiveWork: () => {
    updates?.stop()
    void transcriptRetention?.stop()
    host?.stopSweeping()
    stopThemeIpc?.()
    stopThemeIpc = undefined
    void dockLabel?.then((label) => label.stop())
    void themes?.close().catch(() => undefined)
  },
  // …and then WAIT for the work already admitted, so the database closes under nobody (062).
  drainArchiveWork: async () => {
    await updates?.drain()
    await transcriptRetention?.stop()
    await (stoppingTheStart ?? host?.drainArchiveWork() ?? Promise.resolve())
    await themes?.close()
  },
  closeDatabase: () => {
    db?.close()
    db = null
  },
  // A start that never opened its data, or failed, ends with code 1 once the teardown is done.
  quit: () => (theDataOpened && !startFailed ? app.quit() : app.exit(1)),
  // Force `exit` on a repeated quit signal without raising another `before-quit` or waiting
  // for the teardown the person has already asked to stop.
  exit: (code) => app.exit(code),
  // Give the last-resort deadline to a separate process (`last-resort-exit.ts`). Once Electron
  // has begun quitting, `app.exit` and this event loop cannot reliably enforce the bound.
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
  // Write shutdown notices synchronously: pipe-backed `console.error` queues bytes that can
  // be lost when the event loop stops, including the report and Electron's final quit stamps.
  // Fall back to asynchronous logging if a nonblocking pipe refuses with `EAGAIN`.
  // Use separate logger arities so notices without an error do not print a trailing `undefined`.
  log: (message, error) => {
    const line = error === undefined ? message : `${message} ${inspect(error)}`
    try {
      // Loop over short writes from a nonblocking stderr pipe so the full shutdown report reaches
      // `app-closes-check.mjs`. Advance by bytes, not characters, to avoid splitting UTF-8 text.
      const bytes = Buffer.from(`${line}\n`, 'utf8')
      for (let written = 0; written < bytes.length;) {
        written += writeSync(STDERR_FD, bytes, written, bytes.length - written)
      }
    } catch {
      // A saturated pipe may return `EAGAIN`; asynchronous fallback may still lose the line
      // at exit, but preserves the ordinary logging path when synchronous writing fails.
      console.error(line)
    }
  },
  // Inject the shutdown clock so tests can assert report timing without sleeping.
  now: () => Date.now(),
})

/**
 * Take the single-instance lock for this `userData` during synchronous module evaluation,
 * before the database, provider homes or archive gate are opened.
 * Ignore the second launch's argv and cwd: this app does not open command-line documents.
 */
void runAsSoleInstance({
  requestLock: () => app.requestSingleInstanceLock(),
  // Use the same `userData` directory for the cross-process backstop and Chromium's lock.
  // The backstop fails open if it cannot establish its verdict; see `one-host-gate.ts`.
  claimGate: () => claimSoleHost(app.getPath('userData')),
  onSecondLaunch: (handler) => app.on('second-instance', () => handler()),
  focusExisting: () => {
    // Do not create a window after startup failed; the error may still be on screen.
    if (startFailed) return
    const [existing] = BrowserWindow.getAllWindows()
    // A live macOS app can have no window. A second launch shows this start's ordinary or
    // recovery window, as activation does, so the launch visibly responds.
    if (existing === undefined) {
      showThisStartsWindow()
      return
    }
    // Do not raise hidden launches on a second-instance request. The contender still exits;
    // log the declined focus request for the instrument.
    if (presentation.hidden) {
      console.info(`${KEPT_OUT_OF_SIGHT} a second launch asked this app to come forward`)
      return
    }
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    // The window is ours to raise; the APPLICATION is not, and on macOS raising a window of an
    // unfocused app leaves it behind whatever the user is looking at. `steal` is right here and
    // nowhere else: the user has just asked for this app by launching it.
    app.focus({ steal: true })
  },
  announce: (message) => {
    if (startFailed) return
    // A dialog is visible too; suppress it for hidden launches.
    if (presentation.hidden) {
      console.info(`${KEPT_OUT_OF_SIGHT} ${message}`)
      return
    }
    const [existing] = BrowserWindow.getAllWindows()
    // A sheet on the window when there is one, so it arrives attached to the thing that was just
    // brought forward rather than floating over the desktop. Not awaited — the app has nothing to
    // do with the answer, and blocking the main thread on a dialog is how a focus request turns
    // into a freeze.
    void (existing === undefined
      ? dialog.showMessageBox({ type: 'info', message })
      : dialog.showMessageBox(existing, { type: 'info', message }))
  },
  // Stand down with `exit` so a refused second launch does not enter ordinary quit handling.
  // See `SoleInstanceDeps.standDown`.
  // Code 0: the app the person launched is the one already running.
  standDown: () => app.exit(0),
  start,
  // At once, on stderr: the exit that follows would lose a line queued for the event loop.
  log: sayAtOnce,
})

/**
 * Each folder's Claude local settings file, found in a worker thread: finding one runs git, which
 * must never make the window wait. The worker answers once and ends; one that stops without an
 * answer, or takes longer than git's own timeout for every folder, is a failed refresh.
 */
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
