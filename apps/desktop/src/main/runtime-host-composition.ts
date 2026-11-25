import { providerKnowledge } from './providers/index'
import { WorkspacePluginAttachments } from './plugins/attachments'
import { pluginWorkspaceIdentity } from './plugins/supervisor/client'
import { productionPluginController } from './plugins/production'
import { PluginSupervisorAttachment } from './plugins/supervisor/client'
import { profileSkillAccess, SharedSkillDiscovery } from './skills/shared-discovery'
import { convertSharedSkills } from './skills/shared-conversion'
import { SharedSkillLibrary } from './skills/shared-library'
import { keepTranscriptsForever } from './transcript-retention'
import { stopWorkerCommands } from './command-cleanup'
import { keptShippedSkills, prepareBuiltInSkills } from './skills/prepare-built-in-skills'
import { factoryTextOf, readTextPack } from './skills/text-pack'
import { createDatabaseWriteLog, logInfo } from './logging/log'
import { broadcastRuntime } from './runtime/window-broadcast'
import { changeNotices } from './runtime/change-notices'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { providerRecord, SUPPORTED_PROVIDERS } from '@brobot2/shared'
import { withDeadline } from '@brobot2/runtime'
import { PROVIDERS_CHANGED_CHANNEL, RUNTIME_STATES_CHANNEL } from '../shared/runtime-ipc'
import { buildIdentity } from './build-identity'
import { LIMITS_DISPLAY_CHANGED_CHANNEL } from '../shared/limits-display'
import { LimitsReaderLifetime } from './db/limits-reader-lifetime'
import { limitsWriterSampler } from './db/fresh-limits-snapshot'
import { windowWriterSampler } from './db/window-writer-stamp'
import { startLimitsReader } from './db/start-limits-reader'
import { startWindowReader } from './db/start-window-reader'
import { startFilesLibrary } from './db/start-files-library'
import { FilesLibraryWindows, filesLibraryRevision } from './db/files-library-windows'
import { TeamProfileGraphWindows } from './db/team-profile-graph-windows'
import { startTeamProfileGraph } from './db/start-team-profile-graph'
import { startWorkSearch } from './db/start-work-search'
import { startPastWorkSearch } from './db/start-past-work-search'
import { MainThreadWork, timedMethods } from './stall-watch'
import { PS_READ_DEADLINE_MS, PS_TIMEOUT_MS, psArgsFor, residentSizesIn } from './process-tree'
import type { AppDatabase } from './db/connection'
import { listProviderConnections, resolveProviderConnection } from './connections/records'
import { newProviderSessionId } from './db/ids'
import { discoverSessionsIn } from './adopt/discover-sessions'
import {
  indexedHomeDescriptions,
  discoverUserHomeSessions,
  userProviderHomePath,
} from './adopt/user-homes'
import { aProtectedPlace, thePlacesOnThisComputer } from './protected-places'
import { workspaceListFile } from './workspaces'
import { nativeTranscriptPath } from './archive/native-file'
import { createMemoryAmendmentObserver, createSessionStore } from './db/session-store'
import { committedChangesOf } from './db/committed-changes'
import { DEFAULT_SILENCE_WINDOW_MS } from './runtime/liveness'
import { readProviderConfig } from './runtime/provider-config'
import {
  listProfileIds,
  listProviderHomes,
  deriveProviderHome,
  homePathsForProvider,
  providerHomesRoot,
  savedMethodsFolder,
} from './connections/homes'
import {
  createProviderModules,
  desktopProviderInputs,
  providerAuthFromModules,
  providerVersionsFromModules,
  providerProgramPathsFromModules,
} from './providers'
import { readSavedMethods } from './saved-methods'
import { createSavedMethodService } from './saved-method-service'
import { createMethodChangeStore } from './db/method-changes'
import {
  createMemoryService,
  stageKnowledgeFile,
  sweepKnowledgeStages,
} from './runtime/agent-memory'
import { ApiKeys, askTheProvider } from './runtime/api-keys'
import { listProcesses, memoryOf } from './runtime/process-listing'
import { usageKeptIn } from './provider-usage-file'
import { scheduleAttemptsIn } from './schedule-attempts-file'
import { readProfileExecutionIn, writeProfileExecution } from './profile-execution-file'
import { turnsTheAppCutIn } from './turns-the-app-cut-file'
import { providerAccountsFile, readKeptAccounts, writeKeptAccounts } from './provider-accounts-file'
import { readKeptRules, removeKeptRule, type WhereRulesAreKept } from './kept-rules'
import { startSettingsLocator } from './providers'
import { settingsLocations } from './settings-locations'
import { snapshotFor } from './provider-snapshots'
import { ThemeStore } from './themes/store'
import { RuntimeHost, type RuntimeHostDeps } from './runtime/runtime-host'
import { resolveSessionCwd } from './runtime/scratch-cwd'
import { pastedImagesRoot, sweepPastedImages } from './runtime/pasted-image'
import type { DraftStorage } from './database/drafts'
import { keepDraftedPastes } from './drafts-file'
import { resourcesRoot } from './resources/resources'
import { readSessionInstructions } from './runtime/instructions'
import { profileBundleSpans, thisConversationSpans } from './runtime/factory-text'
import { toolsToldInTextFor } from './runtime/agent-tools'
import { publishProfileBundle } from './runtime/profile-bundle'
import { brobotWorkspace, workspaceOwnFilesIn } from './runtime/workspace'
import { signInChangesIn } from './sign-in-changes'
import { archivedConversationsIn } from './archived-file'
import type { LaunchPresentation } from './launch-presentation'

/** What composeRuntimeHost reads from index.ts; getters for the bindings index.ts reassigns. */
export interface RuntimeHostWiring {
  drafts: Pick<DraftStorage, 'read'>
  firstWindowLoad: Promise<void>
  mainThreadWork: MainThreadWork
  pluginController: ReturnType<typeof productionPluginController>
  pluginSupervisor: PluginSupervisorAttachment
  presentation: LaunchPresentation
  windowChangeNotices: ReturnType<typeof changeNotices>
  migrationsAppliedOrNull: () => number | null
  themes: () => ThemeStore | null
  soleAtThisLaunch: () => boolean
  databaseClosed: () => boolean
  keepRecordedConversation: (recorded: (sessionId: string) => boolean) => void
}

function builtInSkillsResources(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'built-in-skills')
    : join(app.getAppPath(), 'resources', 'built-in-skills')
}

export async function composeRuntimeHost(
  database: AppDatabase,
  wiring: RuntimeHostWiring,
): Promise<RuntimeHost> {
  const {
    drafts,
    firstWindowLoad,
    mainThreadWork,
    pluginController,
    pluginSupervisor,
    presentation,
    windowChangeNotices,
    migrationsAppliedOrNull,
    themes,
    soleAtThisLaunch,
    databaseClosed,
    keepRecordedConversation,
  } = wiring
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
  keepDraftedPastes(drafts, userData, Date.now())
  void sweepPastedImages(pastedImagesRoot(userData), Date.now()).catch(() => 0)

  const originalStore = createSessionStore(database, Date.now, mainThreadWork)
  const committed = committedChangesOf(database)
  const writeLog = createDatabaseWriteLog()
  const stopWriteLog = committed.listen((change) => {
    if (!change.resync && change.write) writeLog.record(change.write, change.tables)
  })
  app.once('will-quit', () => {
    stopWriteLog()
    writeLog.stop()
  })
  const store = timedMethods(originalStore, 'store', mainThreadWork, (name, call) =>
    committed.withWriter(name, call),
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
  const apiKeys = await ApiKeys.open(userData, Date.now, store)
  const stopProviderServices = new AbortController()
  app.once('will-quit', () => stopProviderServices.abort())
  keepRecordedConversation((sessionId) => databaseClosed() || store.recordedOne(sessionId) !== null)
  void keepTranscriptsForever(userData).catch((error: unknown) =>
    console.warn('Transcripts could not be marked as kept for good.', error),
  )
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
      keptFilesRoot: resourcesRoot(userData),
      signal: stopProviderServices.signal,
      commandLine: app.commandLine,
      keys: {
        read: (provider) => apiKeys.read(provider),
        current: (provider) => apiKeys.current(provider),
        status: (provider) => apiKeys.status(provider),
      },
    }),
    (provider) => ({
      list: () => listProviderConnections(database, provider, apiKeys.status(provider).set),
      resolve: (connectionId) =>
        resolveProviderConnection(database, {
          provider,
          connectionId,
          keySaved: apiKeys.status(provider).set,
        }),
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
    readPromptSkills: () => sharedDiscovery.promptSkillsAtHand(),
    prepareSharedSkills: () => sharedDiscovery.prepareLaunch(),
    beforeSkillDiscovery: () => sharedDiscovery.library.beforeOffer(),
    closeSharedSkills: () => sharedDiscovery.close(),
    skillsForAPerson: sharedDiscovery.window,
    savedMethods: methodKnowledge,
    memoryKnowledge,
    readCurrentAgentRules: (profile) => store.readCurrentAgentRules(profile),
    writeDirectAgentRules: (...args) => store.writeDirectAgentRules(...args),
    afterFirstWindowLoad: firstWindowLoad,
    deferStartupUntilFirstList: true,
    workSearchReader: startWorkSearch(database.name),
    pastWorkSearchReader: startPastWorkSearch(),
    windowReader: startWindowReader(database.name),
    filesLibraries: new FilesLibraryWindows(() => startFilesLibrary(database.name)),
    filesLibraryRevision: filesLibraryRevision(
      database,
      () => store.canReadFreshSnapshot?.() === true,
    ),
    teamProfileGraphs: new TeamProfileGraphWindows((admission, failure) =>
      startTeamProfileGraph(database.name, admission, failure),
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
    themes: themes() ?? undefined,
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
    signInChanges: signInChangesIn(database),
    archived: archivedConversationsIn(database),
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
    createRuntime: (provider) => providerModules[provider].createRuntime(),
    prepareProviderLaunch: (provider, profileId, connection) => {
      return providerModules[provider].prepareLaunch(profileId, connection)
    },
    connectionFor: (provider, connectionId) => {
      const connections = providerModules[provider].connections
      if (!connections) throw new Error('Provider connection services were not bound')
      return connections.resolve(connectionId)
    },
    listConnections: () =>
      Object.values(providerModules).flatMap((module) => module.connections?.list() ?? []),
    prepareProviderHome: async (provider, profileId) => {
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
    recordStartAttempt: (line) => logInfo('launch', line.stage, { ...line }),
    ...providerHomePaths,
    listProfiles: (provider) => listProfileIds(userData, provider),
    providerAuth,
    apiKeys,
    loginRenewal: providerAuth.loginRenewal,
    programFound: providerProgramPathsFromModules(providerModules),
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
    usageKept: usageKeptIn(database),
    profileExecution: {
      read: () => readProfileExecutionIn(database, userData),
      write: (kept) => writeProfileExecution(database, kept),
      owned: soleAtThisLaunch(),
    },
    scheduleAttempts: scheduleAttemptsIn(database),
    turnsTheAppCut: turnsTheAppCutIn(database),
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
    openExternal: (url) => shell.openExternal(url),
    revealPath: (path) => shell.showItemInFolder(path),
    openPath: (path) => shell.openPath(path),
    providerHomesRoot: () => providerHomesRoot(userData),
    resourcesRoot: () => resourcesRoot(userData),
    stopWorkerCommands: (cwd, occupied) => stopWorkerCommands(userData, cwd, occupied),
    whichBuild: () => ({ ...buildIdentity(), schema: migrationsAppliedOrNull() }),
    providerSnapshot: (provider, model) => snapshotFor(provider, model),
    resolveCwd: (profileId, requested) => resolveSessionCwd(userData, profileId, requested),
    savedMethodsFolderFor: (profile) => savedMethodsFolder(userData, profile),
    readSavedMethodsFor: (profile, at) =>
      readSavedMethods(savedMethodsFolder(userData, profile), at),
    readInstructions: (provider, cwd, providerHome, context, launchPack) => {
      const pack = launchPack ?? readTextPack(process.env, app.isPackaged, shippedVersion)
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
        thisConversation: thisConversationSpans(context, toolsToldInTextFor(provider), provider),
        workspaceFile: providerKnowledge[provider].instructions.workspaceFile?.(
          brobotWorkspace(userData),
        ),
        workspaceOwnFiles: workspaceOwnFilesIn(userData),
      })
      return {
        instructions: read.instructions,
        systemHint: read.systemHint ?? undefined,
        ...(read.firstTurnLead === null ? {} : { firstTurnLead: read.firstTurnLead }),
        memoryLoaded: read.memoryLoaded,
        profileFile: read.profileFile,
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
  void runtimeHost.readForWindow(() => undefined, 'listing').catch(() => {})
  return runtimeHost
}

function readSilenceWindowMs(): number {
  const raw = Number(process.env['BROBOT_SILENCE_WINDOW_MS'])
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SILENCE_WINDOW_MS
}

async function locateOffTheMainThread(
  folders: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const worker = await startSettingsLocator()
  return new Promise((resolve, reject) => {
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
