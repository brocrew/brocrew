export { SUPPORTED_PROVIDERS } from '@brobot2/shared'

export { isTheSamePath } from './built-in-skills'

export { theDefaultByName, type ModelByName } from './default-by-name'

export {
  sessionRefSchema,
  serializeSessionRef,
  parseSessionRef,
  type SessionRef,
} from './session-ref'

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
  ALWAYS_HONOURED,
  isAlwaysHonoured,
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

export { AnswerRefused, answerRefusalOf, type AnswerRefusal } from './answer-refused'

export { TurnInProgress, TURN_REFUSED } from './turn-in-progress'
export { RejectedSessionLaunch } from './rejected-session-launch'

export {
  CHANNEL_REFUSALS,
  CHANNEL_REFUSAL_SENTENCES,
  QUESTION_REQUEST_KEYS,
  askedOfTheChannel,
  type ChannelRefusal,
  type ChannelVerdict,
} from './question-channel'

export {
  runtimeEventSchema,
  toRuntimeEvent,
  unknownCategorySchema,
  wrapUnknown,
  boundRaw,
  MAX_UNKNOWN_RAW_BYTES,
  RUNTIME_EVENT_TYPES,
  degradeEvent,
  DEGRADED_LABEL_PREFIX,
  DEGRADED_UNNAMED,
  parseRuntimeEvent,
  type RuntimeEvent,
  type UnknownCategory,
  type DiscardedPayload,
  type ContextReading,
  type ContextReadingEvent,
  type CompactionEvent,
  type ConversationResetEvent,
  type FileChangeEvent,
  type WorkflowRunEvent,
  type MemoryRecallEvent,
  type ToolInventoryEvent,
  type ProviderRefusal,
  type ProviderUsageEvent,
  MAX_USAGE_WINDOWS,
  type TurnLimit,
  type ScheduleReceipt,
} from './events'

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

export { MAX_BACKGROUND_ID } from './background-work'
export type { BackgroundWork, BackgroundWorkEnding } from './background-work'

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

export type { NotStartedBecause, ScheduledJob, SchedulingTool } from './scheduled-work'
export { NOT_STARTED_BECAUSE, SCHEDULING_TOOLS } from './scheduled-work'

export type {
  ProviderCommand,
  ProviderCommandAnswer,
  ProviderCommandSet,
  ProviderSkill,
} from './provider-commands'

export { MAX_COMMAND_TEXT, PROVIDER_COMMAND_PREFIX } from './provider-commands'

export {
  boundInventory,
  parametersOf,
  qualifyWith,
  splitQualified,
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

export {
  CHILD_STATE_UNKNOWN,
  childInputRefusal,
  childStatusOf,
  type ChildInputOutcome,
  type ChildThreadState,
} from './child-conversation'

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

export { IMAGE_MEDIA_TYPES, imageMediaType } from './image-media-type'

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

export {
  ResumeError,
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

export type {
  AgentToolAnswer,
  AgentToolDefinition,
  AgentToolset,
  BeyondItsRails,
} from './agent-tools'

export {
  agentToolStringEnum,
  agentToolHandlerInput,
  toolArgumentsAtHandler,
  BEYOND_ITS_RAILS,
} from './agent-tools'

export {
  allProviderCapabilities,
  capabilitiesFor,
  isAvailable,
  type CapabilityState,
  type CapabilityStatus,
  type ProviderCapabilities,
} from './capabilities'

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
  reprovisionCodexAuth,
  codexAuthHealth,
  assertCodexSqliteHomeContained,
  personalCodexAuthPath,
  claudeKeychainTokenProvider,
  claudeKeychainTokenProviderAsync,
  claudeKeychainTokenProviderForALaunch,
  claudeAuthHealth,
  claudeAuthHealthAsync,
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

export type { SessionAccount } from './session-account'

export {
  CLAUDE_RENEWAL_ARGS,
  claudeLoginNeedsRenewal,
  claudeLoginRenewer,
  claudeRenewalEnv,
  renewClaudeCodeLogin,
  probeClaudeCodeLogin,
  type ClaudeLoginRenewal,
  type ARunEnded,
  type ClaudeRenewalSeams,
  type RunAProgram,
} from './internal/claude-login-renewal'

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
  FAKE_PROVIDER_COMMANDS,
  FakeLaunchGate,
  FakeProcessExit,
  FakeProviderSessions,
  FakeRuntime,
  FakeSessionHandle,
  type FakeRuntimeOptions,
} from './fake-runtime'

export type {
  ClaudeLaunchSettingKey,
  CodexLaunchSettingKey,
  LaunchSetting,
  LaunchSettingKey,
  LaunchSettingValue,
} from './launch-settings'

export { MAX_SETTINGS_BYTES } from './settings-limits'

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

export { SessionMachine, type SessionState, type TurnOutcome } from './internal/session-machine'

export { RequestBroker } from './internal/request-broker'

export { sessionStatusSchema, type SessionStatus } from '@brobot2/shared'

export {
  managedPluginHttpServers,
  withManagedPluginMcp,
  type ManagedPluginMcpServer,
} from './managed-plugin-mcp'

export {
  withManagedPluginAttachments,
  StoppedBeforeSend,
  type ManagedPluginAttachment,
  type ManagedPluginAttachmentSource,
} from './managed-plugin-session'
export { ManagedPluginFailure } from './managed-plugin-failure'

export type { ProviderConfigLayout, SdkOptionClaim } from './provider-configuration'
