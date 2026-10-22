/**
 * `@brobot2/runtime` exports the provider-neutral `AgentRuntime` contract and the
 * Zod-validated `RuntimeEvent` vocabulary. Claude and Codex adapters implement the contract;
 * `FakeRuntime` exercises it and supplies a UI fixture.
 */

/** Providers this runtime layer targets. */
export { SUPPORTED_PROVIDERS } from '@brobot2/shared'

export { isTheSamePath } from './built-in-skills'

// Name a provider's default without requiring a model list.
export { theDefaultByName, type ModelByName } from './default-by-name'

// Session identity
export {
  sessionRefSchema,
  serializeSessionRef,
  parseSessionRef,
  type SessionRef,
} from './session-ref'

// Permission and user-input decisions, with a provider-neutral approval scope.
export {
  permissionDecisionSchema,
  permissionScopeSchema,
  permissionAmendmentSchema,
  permissionOutcomeSchema,
  userInputResponseSchema,
  userInputQuestionSchema,
  userInputOptionSchema,
  userInputPermissionSchema,
  PLAN_CONSENTS,
  // Export the adapters' scope floor so producers can apply the same minimum, including
  // `handleAgentToolCall`.
  ALWAYS_HONOURED,
  isAlwaysHonoured,
  // Apply the floor through `publishedOffer` so all producers agree, including those whose
  // offer is empty because the app withheld it.
  publishedOffer,
  answerToForward,
  duplicateAnswerKey,
  isOfferedLabel,
  storedQuestionsParsed,
  type AnswerToForward,
  type PermissionDecision,
  type PermissionScope,
  type PermissionAmendment,
  type NoPositiveBecause,
  type PermissionOutcome,
  type UserInputResponse,
  type UserInputQuestion,
  type UserInputOption,
  type UserInputPermission,
  type PlanConsent,
} from './permission'

// Export structured reasons for refused answers so the app can render its own words.
export { AnswerRefused, answerRefusalOf, type AnswerRefusal } from './answer-refused'

// Distinguish a held turn, which clears on its own, from a session that stopped accepting
// turns. The type carries the distinction for overlapping-send refusals.
export { TurnInProgress, TURN_REFUSED } from './turn-in-progress'

// Classify provider requests that a parent may answer and those reserved for a person.
// Keep this here because the adapters derive these shapes directly from their provider wires.
export {
  CHANNEL_REFUSALS,
  CHANNEL_REFUSAL_SENTENCES,
  QUESTION_REQUEST_KEYS,
  askedOfTheChannel,
  type ChannelRefusal,
  type ChannelVerdict,
} from './question-channel'

// Event taxonomy + boundary parser
export {
  runtimeEventSchema,
  toRuntimeEvent,
  unknownCategorySchema,
  wrapUnknown,
  boundRaw,
  MAX_UNKNOWN_RAW_BYTES,
  RUNTIME_EVENT_TYPES,
  // Export the marker for an app event that fails its own schema; the desktop wire boundary
  // can produce the same failure.
  degradeEvent,
  DEGRADED_LABEL_PREFIX,
  DEGRADED_UNNAMED,
  // Share the guarded parse at both boundaries. Zod's discriminator read may throw on a
  // hostile candidate; `toRuntimeEvent` must never throw.
  parseRuntimeEvent,
  type RuntimeEvent,
  type UnknownCategory,
  type DiscardedPayload,
  // Include the context meter's `unknown` initial state, which precedes provider readings
  // and has no event of its own.
  type ContextReading,
  type ContextReadingEvent,
  type CompactionEvent,
  type ConversationResetEvent,
  type FileChangeEvent,
  type WorkflowRunEvent,
  // Export memory-read event shapes so consumers do not widen the event union themselves.
  type MemoryRecallEvent,
  // Export tool-inventory event shapes so surfaces do not reconstruct them from the union.
  type ToolInventoryEvent,
  // Export adapter-recognised refusals as values a surface can explain and act on.
  type ProviderRefusal,
  // A provider's usage reading, which the host keeps for the Providers screen and never records.
  type ProviderUsageEvent,
  MAX_USAGE_WINDOWS,
  // Export the usage limit that ended a turn for the stall notice and the hold.
  type TurnLimit,
  // One scheduling call the provider ran, as a `scheduled_work` row carries it.
  type ScheduleReceipt,
} from './events'

/**
 * Export workflow row shapes. `mergeWorkflowAgents`, `mergeWorkflowPhases` and
 * `workflowPhaseState` belong in the renderer's `lib/workflow.ts`: adapters emit individual
 * frames, never merge them, and send no phase state. Runtime value imports would also pull
 * Node filesystem dependencies across the browser boundary.
 */
export {
  workflowAgentState,
  MAX_WORKFLOW_AGENTS,
  MAX_WORKFLOW_DESCRIPTION,
  MAX_WORKFLOW_TEXT,
  type WorkflowRun,
  type WorkflowPhase,
  type WorkflowAgent,
  type WorkflowAgentState,
} from './workflow-run'

/**
 * Export background-work row shapes for renderer registries and cards. Provider status
 * mapping through `backgroundOutcome` stays in the adapters so surfaces cannot reinterpret it.
 */
export { MAX_BACKGROUND_ID } from './background-work'
export type { BackgroundWork, BackgroundWorkEnding } from './background-work'

/**
 * Export command-output shapes and ceilings. `CommandTails` remains the adapter's private
 * buffer so there is one writer. External tests use the exported caps instead of restating them.
 */
export { MAX_COMMAND_TAIL, MAX_COMMAND_TAILS } from './command-output'
export type { CommandTail } from './command-output'
export {
  MAX_TOOL_ANSWER_PART,
  MAX_TOOL_ANSWER_PARTS,
  MAX_TOOL_ANSWERS,
  ToolAnswers,
} from './tool-answer'
export type { ToolAnswer, ToolAnswerPart } from './tool-answer'
export { isMessageAct } from './message-act'

/**
 * Export scheduled-work rows. No outcome mapper is available because no completion is
 * reported, and no id bound is needed because the id is not sent downstream. Host controls
 * cannot cancel cron jobs; see `scheduled-work.ts`.
 */
export type { NotStartedBecause, ScheduledJob, SchedulingTool } from './scheduled-work'
export { NOT_STARTED_BECAUSE, SCHEDULING_TOOLS } from './scheduled-work'

/**
 * Export provider-command shapes, including the set's display prefix. Surfaces use that
 * prefix as data instead of recognising the provider to choose a sigil.
 */
export type {
  ProviderCommand,
  ProviderCommandAnswer,
  ProviderCommandSet,
  ProviderSkill,
} from './provider-commands'
/**
 * Export each provider's prefix as a fallback before its command list is available.
 * See {@link PROVIDER_COMMAND_PREFIX}.
 */
export { MAX_COMMAND_TEXT, PROVIDER_COMMAND_PREFIX } from './provider-commands'

/**
 * Export tool rows with their bounds; an overlarge payload fails the schema and becomes
 * `unknown` at `toWireEvent`. {@link parametersOf} derives flattened parameters from the
 * JSON Schema handed to the child, keeping the inventory's required column aligned.
 *
 * {@link qualifyWith} and {@link splitQualified} use {@link ToolNaming} as data, without
 * recognising providers. The renderer cannot value-import this package: it brings Node
 * dependencies and substantial bundle size. Its `lib/tool-inventory.ts` carries identical
 * helpers, compared by `apps/desktop/test/tool-inventory.test.ts` against these exports.
 * These exports support runtime tests and main-process readers.
 */
export {
  boundInventory,
  parametersOf,
  qualifyWith,
  splitQualified,
  CLAUDE_TOOL_NAMING,
  CODEX_TOOL_NAMING,
  MAX_DECLARED_TOOLS,
  MAX_PUBLISHED_SERVERS,
  MAX_PUBLISHED_TOOLS,
  MAX_STATUS_WORD,
  MAX_TOOL_NAME,
  MAX_TOOL_PARAMETERS,
  MAX_TOOL_TEXT,
  type DeclaredTool,
  type DeclaredToolset,
  type PublishedInventory,
  type PublishedServer,
  type ToolInventoryPayload,
  type ToolNaming,
  type ToolParameter,
} from './tool-inventory'

/**
 * Export child-conversation shapes and predicates together. {@link childInputRefusal} is
 * the shared rule for whether a child accepts input, rechecked by the host at the boundary.
 * `childStatusOf` keeps status interpretation consistent too.
 */
export {
  CHILD_STATE_UNKNOWN,
  childInputRefusal,
  childStatusOf,
  type ChildInputOutcome,
  type ChildThreadState,
} from './child-conversation'

/**
 * Share diff parsing between live adapters and captured-payload tests so rename and
 * addition semantics cannot diverge.
 */
/**
 * Export `FileEdits` for `import-claude.ts`, which has its own archive normalizer and needs
 * the same stateful edit helper as the live path to populate adopted conversations' Changes.
 */
export { FileEdits } from './claude/file-edits'
export { ClaudeMemoryStore } from './claude/memory-store'

/**
 * Export assistant error interpretation for the archive importer so an archived `assistant`
 * record carrying an `error` word reaches readers with the same wording as a live record.
 */
export { assistantErrorWords, isCredentialFailure } from './claude/assistant-error'
// Export the provider-refusal authorship marker for the archive importer.
export { THE_CLIS_OWN_MODEL } from './claude/provider-refusal'

export {
  parseUnifiedDiff,
  foldChanges,
  isNetUnchanged,
  MAX_FILE_DIFF_BYTES,
  MAX_CHANGED_FILES,
  MAX_EVENT_DIFF_BYTES,
  type FileChange,
  type ParsedDiff,
} from './file-change'

/**
 * Export bounded memory recall so live adapters and imported bundles use the same ceilings.
 * The Codex wire-field reader remains private to `codex/normalize.ts`: a provider dialect
 * is not part of this neutral vocabulary.
 */
export {
  boundRecall,
  MAX_RECALL_ENTRIES,
  MAX_RECALL_NOTE,
  MAX_RECALL_PATH,
  MAX_RECALL_THREADS,
  MAX_THREAD_ID,
  type MemoryRecall,
  type MemoryRecallEntry,
} from './memory-recall'

/**
 * Export generated-image directory and media-type rules so main and the adapter agree.
 * Keep `resolveGeneratedImage` private: its fallback resolves against the launched home,
 * not an arbitrary path-checking context.
 */
export {
  GENERATED_IMAGES_DIRNAME,
  IMAGE_MEDIA_TYPES,
  imageMediaType,
} from './codex/generated-image'

// Export approval switching, settings applied at the next turn, and protections that persist
// beyond the working directory.
export {
  ApprovalModeSwitch,
  PROTECTIONS,
  whatTheChildWouldLack,
  WHAT_STANDS_PAST_ITS_FOLDER,
  type ApprovalModeState,
  type ApprovalPosture,
  type Protection,
} from './approval-mode'
export { NextTurnSetting } from './next-turn'

// The contract
export {
  ResumeError,
  // Export typed start refusals and other start failures.
  StartRefused,
  startRefusalOf,
  StartFailed,
  startFailureOf,
  TRANSIENT_SETUP_CODES,
  transientSetupFailureOf,
  spawnNoWaitClearsOf,
  FOLDER_CODES_A_PERSON_MUST_FIX,
  folderAPersonMustFixOf,
  type TransientSetupCode,
  isAutoApprove,
  resolveReasoningEffort,
  type AgentInfo,
  type AgentRuntime,
  type ApprovalMode,
  type EffortChoice,
  type ModelChoice,
  type ReasoningEffort,
  type SessionHandle,
  type SessionSettingsState,
  type StartOptions,
  type TurnProvenance,
  type ResumeOptions,
  type ProviderRuntimeContext,
  type StartPhase,
  type StartPhaseSink,
  type BuiltInSkillsContext,
} from './runtime'

/**
 * Export neutral definitions for tools that reach the hosting app. Adapters translate them
 * into provider formats; access policy stays at the tool-call boundary.
 */
export type {
  AgentToolAnswer,
  AgentToolDefinition,
  AgentToolset,
  BeyondItsRails,
} from './agent-tools'
/**
 * Export the closed classification vocabulary for agent-tool verbs (`BEYOND_ITS_RAILS`).
 */
export {
  agentToolStringEnum,
  agentToolHandlerInput,
  toolArgumentsAtHandler,
  BEYOND_ITS_RAILS,
} from './agent-tools'

// Adapters declare capabilities. Renderers ask what a session supports without recognising
// its provider.
export {
  allProviderCapabilities,
  capabilitiesFor,
  isAvailable,
  type CapabilityState,
  type CapabilityStatus,
  type ProviderCapabilities,
} from './capabilities'
export { CLAUDE_CAPABILITIES } from './claude/capabilities'
/**
 * Export profile-specific Claude memory locations and the provider default they replace,
 * so the desktop reader can show files without deriving a second path rule.
 */
export {
  AUTO_MEMORY_INDEX,
  claudeAutoMemoryDir,
  claudeAutoMemoryIndex,
  isClaudeMemoryTopic,
} from './claude/auto-memory'
export { CODEX_CAPABILITIES } from './codex/capabilities'

// The app provisions a provider home and passes it as launch context; adapters construct
// the sanitised child environment.
export { buildChildEnv } from './internal/child-env'
export {
  aStagingName,
  createFreshFile,
  isStillTheFileOpened,
  openNotThroughALink,
  provisionProviderHome,
  withProviderHomeLock,
  trustProviderHomeAncestry,
  isTheSameFile,
  type FileIdentity,
} from './internal/provider-home'

// The host wires authentication into profile homes: Codex copies `auth.json` once, while
// Claude transiently bridges the machine's Keychain token.
export {
  AuthUnavailableError,
  CodexSettingsUnusableError,
  NoCodexSignInOnThisComputerError,
  CodexRefusedItsSignInError,
  codexCopyIdentityIn,
  isTheSameCodexCopy,
  type CodexCopyIdentity,
  provisionCodexAuth,
  replaceARefusedCodexCopy,
  // Allow explicit user-initiated overwrite through `reprovisionCodexAuth` only.
  // `provisionCodexAuth` must never clobber an existing credential; read its contract before calling.
  reprovisionCodexAuth,
  codexAuthHealth,
  assertCodexSqliteHomeContained,
  personalCodexAuthPath,
  claudeKeychainTokenProvider,
  // Export the asynchronous credential reader used by the turn gate to avoid blocking its thread.
  claudeKeychainTokenProviderAsync,
  // The read a launch makes, off the calling thread, a machine that ran short still throwing.
  claudeKeychainTokenProviderForALaunch,
  claudeAuthHealth,
  claudeAuthHealthAsync,
  // The login a Providers check reports — its kind, plan and expiry. Never the token.
  claudeLoginState,
  claudeLoginStateWithAKey,
  // Export the one-way digest used to compare launch credentials without exposing the credential.
  credentialFingerprint,
  defaultKeychainReader,
  defaultKeychainReaderAsync,
  defaultKeychainReaderForALaunch,
  KEYCHAIN_READ_TIMEOUT_MS,
  parseClaudeOAuthToken,
  type AuthHealth,
  type ClaudeApiKeyProvider,
  type ClaudeApiKeyProviderAsync,
  type ClaudeAuthTokenProvider,
  whyNoClaudeLogin,
  claudeCredentialsFilePath,
  claudeCredentialsFileReader,
  claudeCredentialsFileReaderAsync,
  claudeSetup,
  // Claude Code as a person runs it in this computer's shell, by the path BroBot found.
  claudeCommandIn,
  claudeLoginNotRenewed,
  CLAUDE_LOGIN_RENEWED,
  type ProviderSetup,
  type ClaudeAuthTokenProviderAsync,
  type ClaudeOAuthToken,
  type KeychainReader,
  type KeychainReaderAsync,
  codexAccountIn,
  type ReprovisionOutcome,
  type CodexCopySource,
} from './internal/auth'
// Who a provider says a session is signed in as. Kept on this computer.
export type { SessionAccount } from './session-account'
// Renewing the person's own Claude Code login by running their own Claude Code.
export {
  CLAUDE_RENEWAL_ARGS,
  claudeLoginNeedsRenewal,
  claudeLoginRenewer,
  claudeRenewalEnv,
  renewClaudeCodeLogin,
  type ClaudeLoginRenewal,
  type ARunEnded,
  type ClaudeRenewalSeams,
  type RunAProgram,
} from './internal/claude-login-renewal'

// Ask the provider whether a profile credential can drive a turn; do not infer that state
// from its error prose.
export {
  blocksLaunch,
  isUsable,
  authStateReason,
  A_CHECK_NOT_ANSWERED_SAYS,
  signInNotCheckedInTime,
  type AuthState,
  type LoginAbsence,
} from './auth-state'
export {
  CODEX_UNAUTHORIZED,
  CODEX_SIGN_IN_REFUSED_AT_ROUTING,
  codexAuthStateFrom,
  isCodexUnauthorized,
  probeCodexAuth,
} from './codex/auth-probe'
export {
  changeCodexKeyInHome,
  CodexLogin,
  probeCodexAuthInHome,
  startCodexLogin,
  type CodexKeyChange,
  type CodexKeyOutcome,
  type CodexLoginOutcome,
  type CodexLoginStart,
} from './codex/codex-login'

// Reference implementation
export {
  FAKE_PROVIDER_COMMANDS,
  FakeLaunchGate,
  FakeProcessExit,
  FakeProviderSessions,
  FakeRuntime,
  FakeSessionHandle,
  type FakeRuntimeOptions,
} from './fake-runtime'

// Claude adapter.
export {
  ClaudeRuntime,
  ClaudeSessionHandle,
  claudeProjectDirName,
  // Share the Claude transcript location with archive, export and child-work readers rather
  // than deriving the folder independently from the cwd.
  claudeTranscriptPath,
  type ClaudeQuery,
  type QueryFactory,
} from './claude/claude-runtime'
// Export typed errors and helpers for locating a missing Claude program.
export {
  ClaudeUnavailableError,
  claudeProgramWhereTheSdkLooks,
  claudeVersionTheSdkShips,
} from './claude/claude-binary'
// Export the Claude CLI child spawn and ownership witness (`ClaudeChildWitness`).
export {
  spawnClaudeChild,
  watchClaudeChild,
  type ClaudeChildWitness,
  type SpawnChild,
} from './claude/claude-child'

// Codex adapter.
export {
  CodexRuntime,
  CodexSessionHandle,
  createSpawnTransportFactory,
  type TransportFactory,
  type CodexLaunchContext,
} from './codex/codex-runtime'
export { CODEX_TOOLS_DESCRIPTION } from './codex/agent-tools'
export type {
  ClaudeLaunchSettingKey,
  CodexLaunchSettingKey,
  LaunchSetting,
  LaunchSettingKey,
  LaunchSettingValue,
} from './launch-settings'
// Keep `SpawnCodexTransport` internal. `createSpawnTransportFactory` pins `CODEX_HOME` and
// `CODEX_SQLITE_HOME` to the managed profile home and supplies a sanitised child environment.
// Consumers can implement the public transport interface, but the raw spawning class is a
// lower-level operation whose caller would have to own those safeguards.
export type { CodexTransport, CodexIncoming } from './codex/codex-transport'

// Where each provider keeps what an *Always allow* kept, for the list a person removes rules from.
export { MAX_SETTINGS_BYTES, persistedRulesFile } from './claude/persisted-rules'
export { projectLocalSettingsFile } from './claude/local-settings-location'
export { CODEX_EXEC_POLICY_RULES } from './codex/codex-runtime'
export {
  forgetToolApproval,
  keptToolApprovals,
  keptToolApprovalsFile,
  type KeptToolApproval,
} from './codex/kept-tool-approvals'
// Export the protocol generation version so the bundled binary, vendored protocol and
// handshake use the same pin.
export { CODEX_PROTOCOL_VERSION } from './codex/protocol-version'
// Remove stale Codex permission configuration when any home is prepared, including homes
// used only for adoption or not relaunched recently. Launch-only cleanup cannot reach them.
export { removeStaleCodexPermissionConfig } from './codex/stale-permission-config'
// Export Codex memory configuration for `prepareProviderHome` and desktop disclosure.
// Both use `CODEX_MEMORY_SETTINGS` so the displayed explanation agrees with the written file.
export {
  CODEX_MEMORY_PROVENANCE,
  CODEX_MEMORY_SETTINGS,
  ensureCodexMemoryConfig,
  mergeCodexMemoryConfig,
  type CodexMemoryConfigOutcome,
  type CodexMemoryConfigResult,
  type CodexMemoryMerge,
  type CodexMemorySetting,
} from './codex/memory-config'
// Export Codex memory locations for the desktop reader without duplicating directory rules.
// `instructions.ts` separately chooses which files appear in the panel.
export {
  CODEX_AD_HOC_NOTES,
  CODEX_MEMORY_INDEX,
  CODEX_MEMORY_PIPELINE_FILES,
  CODEX_MEMORY_STORE_FILES,
  CODEX_MEMORY_SUMMARY,
  CODEX_RAW_MEMORIES,
  CODEX_ROLLOUT_SUMMARIES,
  codexAdHocNotesDir,
  codexMemoryDir,
  codexMemoryIndex,
  codexMemorySummary,
  type CodexMemoryReach,
  type CodexMemoryStoreFile,
} from './codex/memory-store'

// Export external MCP transport and adapter-facing shapes. Registration policy belongs in
// `apps/desktop/src/shared/external-mcp.ts`, alongside desktop-owned `AGENT_TOOL_SERVER`
// and `TOOL_NAMES`.
export {
  discoverExternalMcpTools,
  ExternalMcpDiscoveryError,
  EXTERNAL_MCP_DISCOVERY_MS,
  type ExternalMcpServer,
  type ExternalMcpReach,
} from './external-mcp'

// Export bounded waits so app-layer provider round trips have deadlines, as adapter waits do.
export { DidNotAnswerInTime, didNotAnswerInTime, withDeadline } from './internal/bounded'
export { isReasoning, stallNotice } from './internal/stall-watchdog'

// Shared session and turn state machine.
export { SessionMachine, type SessionState, type TurnOutcome } from './internal/session-machine'

// Shared permission and user-input request broker.
export { RequestBroker } from './internal/request-broker'

// Re-export the session-status contract from shared for convenience.
export { sessionStatusSchema, type SessionStatus } from '@brobot2/shared'

export {
  managedPluginHttpServers,
  withManagedPluginMcp,
  type ManagedPluginMcpServer,
} from './managed-plugin-mcp'

export {
  withManagedPluginAttachments,
  StoppedBeforeSend,
  type ManagedPluginAttachmentSource,
} from './managed-plugin-session'
