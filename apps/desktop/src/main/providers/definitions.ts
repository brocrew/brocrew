import { workspaceInstructionFile as claudeWorkspaceFile } from './claude/layout.mjs'
import { workspaceInstructionFile as codexWorkspaceFile } from './codex/layout.mjs'
import type { Provider } from '@brobot2/shared'
import type { ProviderDefinition } from './transcript-policy'
import { transcripts as claudeTranscripts } from './claude/transcripts'
import { transcripts as codexTranscripts } from './codex/transcripts'
import { discovery as claudeDiscovery } from './claude/discovery'
import { discovery as codexDiscovery } from './codex/discovery'
export const providerDefinitions: Readonly<Record<Provider, ProviderDefinition>> = {
  claude: {
    transcripts: claudeTranscripts,
    discovery: claudeDiscovery,
    workspaceInstructionFile: claudeWorkspaceFile,
  },
  codex: {
    transcripts: codexTranscripts,
    discovery: codexDiscovery,
    workspaceInstructionFile: codexWorkspaceFile,
  },
}
export { importClaudeTranscript } from './claude/import-transcript'
export {
  importCodexRollout,
  messageText,
  readCodexRolloutMeta,
  type CodexImportOptions,
  type CodexRolloutMeta,
} from './codex/import-transcript'
export {
  REQUEST_MARKER,
  ENVIRONMENT_CLOSE,
  splitCodexMessage,
  savedMethodsLinesInLead,
  codexMessageAsKept,
  codexTextAsKept,
  type CodexMessageParts,
} from './codex/codex-injected'
export {
  discoverClaudeSessions,
  claudeHomeDescriptions,
  type ListClaudeSessions,
} from './claude/discovery'
export { discoverCodexSessions, codexDescent } from './codex/discovery'
export { newestReplyModel } from './claude/native-record'
export { newestStateDatabase } from './codex/native-record'
export { CLAUDE_JSONL } from './claude/transcripts'
export { CODEX_ROLLOUT_JSONL } from './codex/transcripts'

export { claudePartsAsTheModelGotThem } from './claude/turn-reading'

export {
  MAX_SIDECAR_BYTES,
  childWorkRoot,
  locateChildWork,
  claudeSidecarPath,
  parseClaudeSidecar,
  countThinkingBlocks,
  readChildWork,
  type ChildWorkLocation,
  type ChildWorkFile,
  type ChildSidecar,
} from './claude/child-work'

export { recordedScheduleReceiptProvider } from './claude/transcripts'

export {
  workspaceInstructionNames,
  CLAUDE_INSTRUCTIONS_FILE,
  CODEX_INSTRUCTIONS_FILE,
} from './workspace-layout.mjs'
