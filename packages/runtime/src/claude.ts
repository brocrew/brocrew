export { FileEdits } from './claude/file-edits'

export { ClaudeMemoryStore } from './claude/memory-store'

export { assistantErrorWords, isCredentialFailure } from './claude/assistant-error'

export { THE_CLIS_OWN_MODEL } from './claude/provider-refusal'

export { CLAUDE_CAPABILITIES } from './claude/capabilities'

export {
  AUTO_MEMORY_INDEX,
  claudeAutoMemoryDir,
  claudeAutoMemoryIndex,
  isClaudeMemoryTopic,
} from './claude/auto-memory'

export {
  ClaudeRuntime,
  ClaudeSessionHandle,
  claudeProjectDirName,
  claudeTranscriptPath,
  type ClaudeQuery,
  type QueryFactory,
} from './claude/claude-runtime'

export {
  ClaudeUnavailableError,
  claudeProgramWhereTheSdkLooks,
  claudeVersionTheSdkShips,
} from './claude/claude-binary'

export {
  spawnClaudeChild,
  watchClaudeChild,
  type ClaudeChildWitness,
  type SpawnChild,
} from './claude/claude-child'

export { persistedRulesFile } from './claude/persisted-rules'

export { projectLocalSettingsFile } from './claude/local-settings-location'

export { CLAUDE_SDK_OPTIONS, CLAUDE_CONFIG_LAYOUT } from './claude/configuration'

export { CLAUDE_TOOL_NAMING } from './claude/tool-naming'
