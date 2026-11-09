import type { WorkspacePluginAttachments } from '../plugins/attachments'
import type { FilesLibraryWindows } from '../db/files-library-windows'
import type { TeamProfileGraphWindows } from '../db/team-profile-graph-windows'
import type { PluginInstructionSource } from '../plugins/instructions'
import type { SkillsWindow } from '../../shared/skills-window'
import type { PastWorkSearchReader } from '../db/past-work-search-reader'
import type { TranscriptsCleared } from '../../shared/transcript-retention'
import type { SkillImportNotice } from '../../shared/recent-activity'
import type { StartAttemptLine } from '../start-attempts-log'
import type { ThemeStore } from '../themes/store'
import type { MainThreadWork } from '../stall-watch'
import type { SkillLaunchSelection } from '../skills/launch-selection'
import type { SkillGrants } from '../../shared/skills-catalogue'
import type { PreparedBuiltInSkills } from '../skills/prepare-built-in-skills'
import type { SavedMethodsUse } from '../../shared/saved-methods'
import type { SavedMethodsLines } from '../saved-methods'
import type { TextPackUse } from '../../shared/text-pack'
import type { TextPackRead } from '../skills/text-pack'
import type { AgentRuntime, SessionRef } from '@brobot2/runtime'
import type { Provider, ProviderConnection } from '@brobot2/shared'
import type { ArchivedConversations } from '../archived-file'
import type { InstructionContext, TheBuildRunning } from './factory-text'
import type { MessagePathPlace } from '../message-paths'
import type { LoginRenewalOperations } from '../providers/auth-types'
import type { ProviderAuthOps } from '../providers/auth-operations'
import type { ApiKeys } from './api-keys'
import type { ProtectedPlaceNotice } from '../../shared/work-folders'
import type { SignInChanges } from '../sign-in-changes'
import type { ListedProcess } from './process-listing'
import type {
  RuntimeChangeMessage,
  RuntimeStatesMessage,
  ApiKeyCheck,
  KeptRuleRemoved,
  KeptRules,
  ProviderConfigInfo,
  ProviderVersion,
  ProvidersChangedMessage,
} from '../../shared/runtime-ipc'
import type { MemoryLoadedEvent } from '../../shared/conversation-events'
import type { SessionInstructions } from '../../shared/instruction-contracts'
import type { Discovery, ProviderDescription } from '../adopt/discover-sessions'
import type { UserHomeDiscovery } from '../adopt/user-homes'
import type { SessionStore } from '../db/session-store'
import type { LimitsReaderLifetime } from '../db/limits-reader-lifetime'
import type { WorkSearchReader } from '../db/work-search-reader'
import type { LimitsWriterStamp } from '../db/fresh-limits-snapshot'
import type { WindowWriterStamp } from '../db/window-writer-stamp'
import type { WindowReadQuery, WindowStoreReader } from '../db/window-read-protocol'
import type { SavedMethodService } from '../saved-method-service'
import type { MemoryService } from './agent-memory'
import type { LaunchProfileFile } from './what-this-agent-was-given'
import type { SnapshotAnswer } from '../../shared/provider-snapshots'
import type { KeptUsage } from '../provider-usage-file'
import type { KeptAccounts } from '../provider-accounts-file'
import type { LivenessOptions } from './liveness'
import type { KeptAttempts } from '../schedule-attempts-file'
import type { KeptProfileExecution, ProfileExecutionRead } from '../profile-execution-file'
import type { KeptCuts } from '../turns-the-app-cut-file'

/** The seams the host is built on — all injected, so the whole host runs against `FakeRuntime`. */
export interface RuntimeHostDeps {
  prepareSharedSkills?: () => Promise<void>
  beforeSkillDiscovery?: () => Promise<void>
  sharedSkillsRoot?: () => Promise<string>
  closeSharedSkills?: () => void
  skillsForAPerson?: SkillsWindow
  savedMethods?: SavedMethodService
  transcriptsCleared?: (from: number, to: number) => Promise<readonly TranscriptsCleared[]>
  skillImports?: (from: number, to: number) => Promise<readonly SkillImportNotice[]>

  readonly themes?: Pick<ThemeStore, 'refresh' | 'snapshot' | 'raw' | 'save' | 'set'>
  /** Records synchronous work without timing provider waits. */
  mainThreadWork?: Pick<MainThreadWork, 'start' | 'timed'>
  /** The adapter for a provider, already wired with its auth seam. */
  createRuntime(provider: Provider, connectionId?: string): AgentRuntime
  /** Resolve metadata before home/provider work; absence preserves legacy test/runtime wiring. */
  connectionFor?(provider: Provider, recordedConnection?: string | null): string
  listConnections?(): readonly ProviderConnection[]
  /**
   * Provision the app-owned home for a provider IN A GIVEN PROFILE and return its path.
   * The profile is passed rather than pinned because it decides what the provider remembers:
   * two sessions in one profile share a home, two in different profiles share nothing.
   *
   * ⛔ **The profile is the caller's own exact spelling, verbatim** — a launch's, or the one a
   * resumed conversation recorded — for `schema.ts`'s stated reason: a locator that could override
   * it is 149's failure shape. ⚑ Every home lives under the one folder `provider-homes.ts` names
   * (`HOME_FOLDER`, D-016), so the profile and the provider are the whole address.
   *
   * ⚠️ **A UNION since 243, and widened rather than narrowed on purpose.** The real implementation
   * became promise-returning when the provisioning lock's wait stopped blocking the thread. Every
   * caller here `await`s, which is correct for both arms — and a double that hands back a path
   * outright is still telling the truth about where the home is, so declaring `Promise<string>`
   * would have turned dozens of honest stubs into compile errors for nothing.
   */
  prepareProviderHome(provider: Provider, profileId: string): string | Promise<string>
  /** Wait for transcript clearing before a provider process can start. */
  beforeProviderLaunch?: () => Promise<void>
  readSelectedSkills?: (profileId: string | null, grants: SkillGrants) => SkillLaunchSelection
  prepareBuiltInSkills?: (input: {
    provider: Provider
    providerHome: string
    canCreateAgents: boolean
    isCoordinator: boolean
    isCurrent: () => boolean
    inUseUntil?: Promise<void>
    selection?: Pick<SkillLaunchSelection, 'revision' | 'skills'>
    /** The launch's one reading of a text pack ({@link RuntimeHostDeps.readTextPack}). */
    pack?: TextPackRead
  }) => Promise<PreparedBuiltInSkills>
  /**
   * A build run from its source reads a text pack once per launch, and hands that one reading to the
   * skills and the instructions alike, so a pack that changes during the launch cannot give it the
   * skills of one reading and the core of another. Absent: no pack.
   */
  readTextPack?: () => TextPackRead
  /**
   * Has the person's own Claude Code renew their login when it needs renewing, so a conversation that
   * stopped on an expired login can reopen on the renewed one. Absent: nothing is renewed here.
   */
  loginRenewal?: (provider: Provider) => LoginRenewalOperations | undefined
  /**
   * The person's own Claude Code by its full path, or `null` when none is installed: what the setup
   * steps and a refused start tell them to run. Asked when it is said. Absent: `null`.
   */
  programFound?: Readonly<Partial<Record<Provider, () => string | null>>>
  /**
   * Where a profile's provider home WOULD be — the path, and nothing else (112, review HIGH).
   *
   * ⛔ **{@link prepareProviderHome} is the LAUNCH call and must not be used to answer a question.**
   * It provisions the directory, it copies Codex's credential, and for Claude it probes the machine
   * Keychain and **throws `AuthUnavailableError` when the login is unhealthy**. Reading a finished
   * sub-agent's transcript through it therefore wrote to disk on every open, and on a machine whose
   * token had been revoked it threw out of a read — the exact shape 098's review found twice in
   * `provider-homes.ts` (*"merely ASKING a question wrote a credential to disk"*). This is
   * `deriveProviderHome` on its own: containment-checked, pure, and it touches nothing.
   */
  providerHomePath(provider: Provider, profileId: string): string
  /**
   * **Which profiles exist** (167) — the ids, {@link DEFAULT_PROFILE_ID} first.
   *
   * A seam for the same reason {@link prepareProviderHome} is one: the layout under `userData` is
   * the app layer's business, not the host's, and this host must not learn to spell
   * `provider-homes/default/<profile>/<provider>` in order to answer a question about it. `provider-homes.ts`
   * owns the rule (`listProfileIds`) and this is where its answer crosses.
   *
   * Optional, and its absence is an honest answer rather than a broken host: a host wired without
   * it reports the default profile alone, which is exactly what an app with no homes on disk has.
   * A provider filter counts only homes on that provider, so reading a model menu cannot create
   * the identity's first home on another provider.
   */
  listProfiles?(provider?: Provider): string[]
  /**
   * The app-managed root every provider home lives under — `<userData>/provider-homes` (065).
   *
   * Optional, and its absence is a real answer rather than a broken host: without it no memory
   * entry is amendable ({@link RuntimeHost.agentMemory}), and that is preferable to guessing a
   * root — the root is the anchor the memory containment check hangs off, and a wrong one would
   * make every claim pass. (`726` · R92: an imported image no longer asks it; the asset door has
   * no root.)
   */
  providerHomesRoot?(): string
  /** Awaited before the host is constructed; owns memory operations and their shutdown. */
  memoryKnowledge?: MemoryService
  /**
   * The credential gestures a person can make about a profile home (098) — check, re-copy, sign in.
   *
   * Optional, and its absence is the honest answer for a host wired without one: the commands
   * refuse by saying so, rather than silently reporting a healthy credential. Every test host in
   * this repo is such a host, which is also why nothing here reaches a real `~/.codex`.
   */
  providerAuth?: ProviderAuthOps
  /**
   * 🔒 **The API keys a person enters** (`api-keys.ts`). Optional: a host without them runs every
   * provider on its machine login, and refuses to keep a key, saying so.
   */
  apiKeys?: Pick<ApiKeys, 'status' | 'remove'> & {
    revision?(provider: Provider): number
    set(provider: Provider, key: string): string | null | Promise<string | null>
    read(provider: Provider): string | null | Promise<string | null>
  }
  /**
   * 🔒 Asks a provider whether it accepts a key (`api-keys.ts`' `askTheProvider`). Optional: a host
   * without it checks nothing, and says so.
   */
  askTheProvider?(provider: Provider, key: string): Promise<ApiKeyCheck>
  /**
   * Each provider's program as this computer runs it (`provider-versions.ts`): the bundled Codex
   * read once per run, the person's Claude Code whenever it changed. Optional: without it each
   * says it cannot be told.
   */
  providerVersions?(): Promise<Readonly<Record<Provider, ProviderVersion>>>
  /**
   * The rules an *Always allow* kept beyond its conversation, and the one way to remove one
   * (`kept-rules.ts`). Optional: without them the list is empty and nothing can be removed.
   * ⚑ The list is read off the main thread's way: finding where a folder's rules are kept runs git.
   */
  keptRules?(): Promise<KeptRules>
  removeKeptRule?(input: { provider: Provider; file: string; kept: string }): KeptRuleRemoved
  /**
   * ⚑ **One listing of this Mac's processes** (`process-listing.ts`): each one's pid, parent, memory
   * and recent CPU. ⚑ What {@link RuntimeHost.providerResources} measures the processes this app
   * started from — at most once per {@link RESOURCE_SAMPLE_MS}, and only when asked. Optional:
   * without it nothing is measured, and the answer says so.
   */
  listProcesses?(): Promise<readonly ListedProcess[]>
  /**
   * 🔴 **F096 — where each provider's newest usage readings are kept across a restart**
   * (`provider-usage-file.ts`): read once as the host starts, written when a number moves or the
   * readings are forgotten. Optional: without it the readings live for this run only, as before.
   */
  usageKept?: {
    read(): KeptUsage
    write(usage: KeptUsage): void
  }
  /**
   * Where what this app has done about each stopped conversation's scheduled jobs is kept across a
   * restart (`schedule-attempts-file.ts`): read once as the host starts, written when a start for
   * a job is made or a notice is handed over. Optional: without it that is remembered for this run
   * only, and each job this app cannot time costs one start a run.
   */
  scheduleAttempts?: {
    read(): KeptAttempts
    write(kept: KeptAttempts): void
  }
  /**
   * How each profile runs its work: normal, or a service with one conversation
   * (`profile-execution-file.ts`). Read and settled against the database as the host starts.
   * Optional: without it every profile is normal.
   */
  profileExecution?: {
    read(): ProfileExecutionRead
    write(kept: KeptProfileExecution): void
    /**
     * ⛔ Whether this app is the only one running on this data: the one-host gate's `sole`. Only
     * then is the file written; otherwise what it holds is read and nothing about it changes.
     */
    readonly owned: boolean
  }
  /**
   * Where the turns cut while they ran — by this app's quit, a crash, the provider's program
   * stopping or a usage limit — are kept, with what was done about each
   * (`turns-the-app-cut-file.ts`): read once as the host starts, written before each step taken
   * about a cut. Optional: without it no cut turn is continued.
   */
  turnsTheAppCut?: {
    read(): KeptCuts
    write(kept: KeptCuts): void
  }
  /** How long a woken life's account is waited for before its continuation is not sent. */
  accountWaitMs?: number
  /**
   * Where the Claude account its usage readings were read on is kept (`provider-accounts-file.ts`),
   * with the only copy of its email. Optional: without it the account is known for this run only.
   */
  accountsKept?: {
    read(): KeptAccounts
    write(accounts: KeptAccounts): void
  }
  /**
   * ⚑ **Tell every window a provider fact moved** ({@link ProvidersChangedMessage}) — its login or
   * a new usage reading. Optional: a host nobody listens to tells nobody.
   */
  providersMoved?(message: ProvidersChangedMessage): void
  /**
   * Open a URL in the user's browser (098). Injected for the same reason 095's navigation guard
   * routes external links through one function: nothing in the renderer decides what gets opened,
   * and a test host opens nothing at all.
   */
  openExternal?(url: string): Promise<void>
  /**
   * Show a path in the file manager.
   *
   * ⚑ **Finder: `showItemInFolder` raises a window with the file selected and starts nothing.**
   * The panel's *Open* is a different act — {@link RuntimeHost.readConfigFile} reads a file onto
   * the app's own paper. 🔴 **`733` · this said *"Reveal, never open, and the difference is a
   * credential"*** — the panel names an `auth.json` — and the PM ruled the difference away (`731`
   * F-2, R92): the file opens on the app's paper like any other. ⚑ Injected for `openExternal`'s
   * reason — nothing in the renderer decides what is handed to the OS — and optional for the same
   * one: every test host reveals nothing at all, which is what lets the commands below be driven
   * without a desktop.
   */
  revealPath?(path: string): void
  /**
   * Opens a file in its default app, answering `''` or the computer's error. Only a document a
   * message named, on the allowlist, is ever handed to it (`message-paths.ts`).
   */
  openPath?(path: string): Promise<string>
  /** Where a message's paths are read from; this computer when absent. */
  messagePathPlace?: MessagePathPlace
  /**
   * 🔴 **Where this app keeps a piece's resources** (D-016) — `resourcesRoot(userData)`.
   *
   * ⛔ **Optional and defaulting to nothing**: a host wired without it keeps no resource and reads
   * none, which is what a test host or an embedder with no data directory of ours should get.
   * ⚠️ A host that cannot say where resources go REFUSES to keep one
   * (`resource-store-unavailable`); it does not pick a directory.
   *
   * ⚑ **It is inside `userData`**, and read by doors that all take an id and never a path —
   * {@link RuntimeHost.readResource}, an AGENT's, under `RESOURCE_RAILS`, and a PERSON's window's,
   * which ask no capability at all (HO-005, *"the human is unrestricted"*):
   * {@link RuntimeHost.readResourceForAPerson}, and since D-032 {@link RuntimeHost.drawResourceForAPerson}
   * and {@link RuntimeHost.revealResource}. ⛔ All read through `resourceBytes`, which holds the
   * row's file inside this root and re-checks its hash; the writer, `keepResource`, renames into it
   * only through a folder it has checked is its own.
   */
  resourcesRoot?(): string
  /** Makes an exclusive piece directory under the app-owned output root, after admission. */
  makeWorkerPieceFolder?(piece: string): string
  /**
   * ⚑ **F006 — which build of this app is running** ({@link TheBuildRunning}), told to each
   * conversation as it launches. ⛔ Optional: a host wired without it tells nobody, and a read that
   * throws costs the line, never the launch.
   */
  whichBuild?(): TheBuildRunning
  /** The directory the session runs in; the BroBot workspace when the caller asked for none. */
  resolveCwd(sessionId: string, requested: string | undefined): string
  /**
   * Where exported files are written (089). App-owned, like every other path here: a renderer
   * cannot be trusted with a destination, and a file dialog is a UI slice of its own.
   */
  exportDirectory(): string
  /** Host-owned session id (not the provider ref — Claude has none until its first turn). */
  newSessionId(): string
  /**
   * Look through the app-owned provider homes for conversations this app has never recorded
   * (087). Injected like every other filesystem seam: the host does the DB half of adoption and
   * knows nothing about where a provider keeps its files.
   */
  discoverSessions(): Discovery
  /**
   * WHERE the provider keeps its own file for a session — what imports, rebuilds, exports and
   * "what the model got" read. Injected like every other filesystem seam. Returns null when there is
   * nothing to read, which is a normal answer: a session can be recorded before its provider has
   * written anything, and a provider's file can be deleted.
   *
   * ⚠️ **A path, not the lines.** Every reader pulls the file in windows ({@link readLines}), so no
   * caller holds a whole transcript.
   */
  nativeTranscriptPath(provider: Provider, providerHome: string, ref: SessionRef): string | null
  /**
   * What is in the user's own provider homes right now, with everything the library shows (047) —
   * sizes, and whatever the provider calls each conversation. The Library's import reads its file
   * from here too, so the list and the import never look at two readings of the same directory.
   */
  userHomeSessions?: () => UserHomeDiscovery
  /**
   * What Claude's own index says about the sessions in its home (047), keyed by session id.
   * Optional and failure-tolerant: without it the Claude rows are listed with no caption, which is
   * the same thing the SDK returning nothing would produce.
   */
  indexedDescriptions?: () => Promise<Map<string, ProviderDescription>>
  /** Read what is really in a provider home — the sandboxed renderer cannot look for itself. */
  readProviderConfig(provider: Provider, providerHome: string): ProviderConfigInfo
  /**
   * Where sessions and their events are recorded, so a session can outlive the
   * process that ran it. Required rather than optional: a host that quietly stopped
   * recording would look exactly like one that never could, and the first sign would
   * be a session that will not come back. Tests that are not about persistence pass
   * {@link NULL_SESSION_STORE}.
   */
  store: SessionStore
  /** The window's display reads use their own read-only connection. */
  limitsReader?: LimitsReaderLifetime
  afterFirstWindowLoad?: Promise<void>
  windowReader?: WindowStoreReader
  filesLibraries?: FilesLibraryWindows
  filesLibraryRevision?: () => string | null
  teamProfileGraphs?: TeamProfileGraphWindows
  teamProfileGraphRevision?: () => string | null
  windowWriterStamp?: (query: WindowReadQuery) => WindowWriterStamp | null
  workSearchReader?: WorkSearchReader
  pastWorkSearchReader?: Pick<PastWorkSearchReader, 'read' | 'close'>
  limitsWriterStamp?: () => LimitsWriterStamp | null
  /** The same real controller that makes Settings → Plugins available. */
  plugins?: PluginInstructionSource
  pluginAttachments?: Pick<WorkspacePluginAttachments, 'agent'>
  /**
   * **The instruction files this launch will append, read now** (158) — the profile's own memory,
   * the cwd chain, and the app's own workspace file, each with the text that goes to the model.
   *
   * ⚑ **Called on start AND on resume**, and by design it re-READS rather than replaying: 158 §2
   * ruled the live-profile semantic, because a profile is an identity the user edits. The host
   * passes the composed text to the adapter and hands the ITEMS to the renderer, so what the user
   * is shown and what the model was told come from one read.
   *
   * Optional like its predecessor (`workspaceSystemHint`, 006, which this replaces): a host without
   * it appends nothing, which is what every test that is not about instructions wants.
   */
  readInstructions?: (
    provider: Provider,
    cwd: string,
    providerHome: string,
    /**
     * 🔴 **What this launch is, as data** (377) — the dynamic layer's whole input.
     *
     * ⛔ **The argument `370` measured missing.** *"Fresh start and cold resume call the same reader
     * seam, `readInstructions(provider, cwd, providerHome)`, with none of these values… Its
     * declaration has no dynamic context argument."* ⚑ Adding it here rather than letting the
     * composition root reach into the database is what keeps that root the security boundary it is
     * documented as: it reads files and publishes them, and the host is what knows who is launching.
     *
     * ⚠️ **Built by {@link RuntimeHost.instructionContext} on BOTH paths**, so a fresh child and a
     * cold-resumed one are told the same things about themselves — which is the property `362` §1.3
     * measured on a live child and the one `373` made true of the parent relationship.
     */
    context: InstructionContext,
    /** The launch's one reading of a text pack; absent for a composition made only to be read. */
    pack?: TextPackRead,
  ) => {
    instructions: SessionInstructions
    systemHint: string | undefined
    /**
     * 🔴 **The one row a launch is worth, or `null`** (332) — see {@link MemoryLoadedEvent}.
     *
     * ⚠️ **Optional on this type, not on the reader.** Every host test that stubs `readInstructions`
     * predates 332 and is about something else; a required field would have made forty of them
     * declare a launch fact they have no opinion about, which is how a default becomes an assertion.
     * ⛔ Absent is *"this host has nothing to say"*, exactly as a missing `readInstructions` is.
     */
    memoryLoaded?: MemoryLoadedEvent | null
    /**
     * 🔴 **D-024 · R1 — what this life's first turn carries in front of its words**, or absent:
     * nothing is owed — see `SessionLaunchRead.firstTurnLead` and
     * {@link HostedSession.firstTurnLead}. ⚠️ Optional on this type for {@link memoryLoaded}'s
     * reason.
     */
    firstTurnLead?: string
    /**
     * 🔴 **F093 · R2 — BroBot's profile file for this launch**: its text, its sections, where it was
     * published and whether it was refused — kept on the `launched` row, on Codex too, where the
     * provider reads the file itself. ⚠️ Optional for {@link memoryLoaded}'s reason.
     */
    profileFile?: LaunchProfileFile | null
    /** The text pack a build run from its source read for this launch, or could not use. */
    textPack?: TextPackUse
    /** What this launch was given from its profile's saved methods, by count and size. */
    savedMethods?: SavedMethodsUse
    /** The saved-methods index's lines as sent, and what this life's records keep in their place. */
    savedMethodsLines?: SavedMethodsLines
    /**
     * ⚑ **F093 · R2 — the context the instructions were composed from**, handed back so the
     * launch's record names the grants and the own-instructions version its text was rendered from.
     * ⚠️ Optional for {@link memoryLoaded}'s reason: without it the host builds the context again.
     */
    context?: InstructionContext
  }
  /**
   * 🔴 **F093 · R3 — what the bundled provider puts in front of a model on its own**, as this build
   * captured it (`provider-snapshots.ts`): by the model a conversation names, or `null` for the
   * provider's default. ⚠️ Optional: a host without it leaves the popup's slot empty and says why.
   */
  providerSnapshot?(provider: Provider, model: string | null): SnapshotAnswer
  /**
   * The host's clock, injected so a test can pin the exact moment an event is recorded — which is
   * the only way to assert that what the renderer was told and what the ledger holds are the same
   * value rather than two readings taken a millisecond apart.
   */
  now?: () => number
  /** How long `close()` waits for the event stream to drain before giving up on it. */
  closeDrainTimeoutMs?: number
  /**
   * How long an agent's interrupt, interrupt-and-send (709), a person's Stop (720) and, since `742`,
   * a person's answer to a provider's card wait on the provider — see
   * {@link DEFAULT_INTERRUPT_WAIT_MS}.
   */
  interruptWaitMs?: number
  /** How long a launch may go unanswered; also overrides the resume limit unless given separately. */
  launchTimeoutMs?: number
  /** Per-provider resume limits, before the shared launch limit or provider default. */
  resumeTimeouts?: Partial<Record<Provider, number>>
  /**
   * How long a reopened Codex thread's leads read may still take once its provider has answered;
   * past it the whole text is owed. {@link DEFAULT_REOPEN_LEADS_GRACE_MS} when not given.
   */
  reopenLeadsGraceMs?: number
  /**
   * Takes each launch's timing line, by name and number only, without waiting for the disk
   * (`aStartAttemptsLog`); nothing is recorded when not given.
   */
  recordStartAttempt?: (line: StartAttemptLine) => void
  /** A clock that only moves forward, for a launch's phases; `performance.now` when not given. */
  monotonicNow?: () => number
  /**
   * How long a message waits for work already on its way to the same conversation before it
   * decides anyway — see {@link DEFAULT_DELIVERY_WAIT_MS} (657).
   */
  deliveryWaitMs?: number
  /**
   * How long a piece's ending waits, at most, for each start under way of a conversation holding a
   * copy passed up of a question about it — {@link A_DECISION_WAITS_FOR_A_START_MS} when not given.
   */
  endingWaitMs?: number
  /**
   * 🔴 **708 · how long a person's command waits for the provider to say which commands it has** —
   * see {@link DEFAULT_COMMAND_LIST_WAIT_MS}.
   */
  commandListWaitMs?: number
  /**
   * ⚑ **F074 · how long after a provider's stated reset what waited for it goes** — see
   * {@link AFTER_THE_RESET_MS}.
   */
  afterALimitResetsMs?: number
  /**
   * ⚑ **F074 · how often what waits for a usage limit is looked at again**, at most — see
   * {@link LOOK_AT_THE_LIMIT_AGAIN_MS}. A seam for tests.
   */
  lookAtTheLimitAgainMs?: number
  /**
   * 🔴 **W4.172 · F095 — where the moments each provider's sign-in changed are kept across a
   * restart** (`main/sign-in-changes.ts`) — see {@link RuntimeHost.aSignInChanged}. ⚠️ Absent: this
   * run's memory only.
   */
  signInChanges?: SignInChanges
  /**
   * The conversations a person archived (`archived-file.ts`): left out of the rail, Team and the
   * person's queue, and kept stopped. A host given none keeps an empty set nowhere.
   */
  archived?: ArchivedConversations
  /**
   * 🔴 **W4.189 · D — the place this app names that a folder meets, or `null`** — asked when a give
   * names a folder ({@link RuntimeHost.aProtectedPlaceFor}); `main/protected-places.ts` against the
   * places as this run knows them. ⚑ Handed in rather than imported, so the identity check and the
   * reset guard's library stay out of the host's own graph. Optional: a host given none names none —
   * and a test hands in synthetic places, never this computer's.
   */
  protectedPlaceOf?: (folder: string) => ProtectedPlaceNotice | null
  /**
   * ⚑ **D-018 · how long a running conversation stays idle before its process is stopped** — see
   * {@link DEFAULT_IDLE_STOP_AFTER_MS}.
   */
  idleStopAfterMs?: number
  /**
   * How long this app waits between two starts it makes by itself — after a restart, and for
   * scheduled jobs — see {@link RESTART_WAKE_GAP_MS}.
   */
  startGapMs?: number
  /**
   * How long after a conversation's program stopped mid-turn it is started again — see
   * {@link A_PROGRAM_IS_STARTED_AGAIN_AFTER_MS}.
   */
  aProgramStartsAgainAfterMs?: number
  /** How far apart a provider's limit continuations go — see {@link LIMIT_WAKES_APART_MS}. */
  limitWakesApartMs?: number
  /**
   * Silence window / clock / timers for liveness — injected so tests drive it without sleeping.
   *
   * ⚠️ **A DISPLAY window and nothing more, again** (400). `398` made it the deadline for a second
   * clock as well; HO-018 §2.2 withdrew that criterion — *"an idle timeout on a working child is the
   * guess"* — so nothing durable is written against this number any more. ⛔ It is back to what `353`
   * measured it for: how long the header waits before it says a conversation has gone quiet.
   */
  liveness?: LivenessOptions
  /**
   * ⛔ **616 + 612 · BOTH injectable windows stood here and NEITHER is left** — `HO-093` §2 and
   * `HO-088` §3.1, landing in the same integration.
   *
   * | ⚑ what it was | ⛔ what took it |
   * |---|---|
   * | `askBoundMs` — how long `ask_parent` held a worker's turn | `608`, once `deliverAnswer` put every answer on a message (HO-084 §4) |
   * | `escalationWindowMs` — how long a routed question could go unanswered before a person was told | `612` — *no clock decides a parent failed* (HO-088 §3.1) |
   * | `proposalBoundMs` — how long `create_project` parked on a person's decision | `616` — *a proposal ends when it is decided or withdrawn, never on a clock* (HO-093 §2) |
   *
   * 🔴 **One sentence is true of all three and it is the one to keep**: ⛔ **nothing on this class
   * parks a tool call on a person, and no clock on this class decides that anybody failed.**
   *
   * ⚠️ **Each of the three was described as *the last of its kind* by the dispatch before the one
   * that removed it**, which is why this note names them together rather than one at a time: the
   * shape that kept being wrong was counting what was left rather than saying what a wait was FOR.
   *
   * ⛔ **None of the three numbers is restated here as *measured***, and `612` is why that matters
   * beyond tidiness: `ASK_BOUND_MS` was ten escalation windows, and there are no escalation
   * windows left to have been ten of — so a derivation nobody can re-make must not be written
   * down as though somebody could (`a-number-can-survive-the-death-of-its-derivation`).
   */
  /**
   * 🔴 **Say that a population a window LISTS has moved** (534) — see {@link RUNTIME_CHANGED_CHANNEL}.
   *
   * ## ⛔ Why it is a dep and not something this class does for itself
   *
   * ⚠️ **This host imports no Electron and holds no registry of windows.** It knows about SINKS,
   * and a sink is one conversation's — which is exactly the scope that cannot carry this, because
   * the conversations this is about have no sink at all. ⛔ `448` §A.1 priced the shape and named
   * this line: *"a callback in `RuntimeHostDeps`, because `RuntimeHost` imports no Electron and
   * holds no registry of sinks or windows"*. The composition root in `main/index.ts` is the only
   * place that can loop over `BrowserWindow.getAllWindows()`.
   *
   * ## ⚑ Optional, and absent is a real answer
   *
   * ⛔ Absent is *"nobody is listening for this"*, exactly as a missing `listProfiles` is — every
   * test host in this repo is such a host, and none of them has a window. ⚠️ **The host calls it
   * through {@link RuntimeHost.theWorldMoved}, which swallows a throw**: this is announced from
   * inside a teardown and from inside a claim, and a renderer that has gone must not be able to
   * strand a session.
   *
   * ## 🔴 It is called AFTER the write it is about, always
   *
   * ⛔ **An announcement that arrives before the row is written is worse than none**: the window
   * re-reads, gets the old world, and has nothing left to provoke it. ⚠️ Every call site below sits
   * after the write in the same synchronous block, and `a-conversation-born-while-he-watches.test.ts`
   * §2 asserts the ORDER rather than the fact, by reading the host's own answer at the instant the
   * announcement lands.
   */
  announce?: (change: RuntimeChangeMessage) => void
  /**
   * 🔴 **D-019 · tell every window what the conversations whose state moved are doing now** — and,
   * D-026, the files kept, the moment their rows are down — see `RUNTIME_STATES_CHANNEL`. A dep for
   * {@link announce}'s reason: this host holds no windows. ⚠️ Named for its first half: it is called
   * with files alone too, `moved` empty.
   *
   * ⚑ **Optional, and absent is a real answer** — nobody is listening, so no mark is kept and
   * nothing is derived. ⚠️ Called from {@link RuntimeHost.sayWhatMoved} only, which swallows a throw.
   * ⚑ **D-018 · and a host nobody is listening to counts no idle minutes**
   * ({@link RuntimeHost.stateMayHaveMoved}): it stops no process on its own.
   */
  statesMoved?: (message: RuntimeStatesMessage) => void
  /**
   * 🔴 **D-018 · the resident size of each of these processes, in bytes** — the provider
   * processes this app started for its conversations ({@link SessionHandle.providerPid}), read by
   * pid and never by a pattern; a pid that has gone is absent from the answer. A dep for
   * {@link announce}'s reason: the composition root owns the `ps` it runs.
   *
   * ⚑ **Optional, and absent is a real answer** — this host reads no process (every test host), and
   * {@link RuntimeHost.processMemory} answers none.
   */
  readProcessMemory?: (pids: readonly number[]) => Promise<ReadonlyMap<number, number>>
}
