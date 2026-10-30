import {
  workspaceInstructionFile as claudeFile,
  conversationDirectories as claudeDirectories,
} from './claude/layout.mjs'
import {
  workspaceInstructionFile as codexFile,
  conversationDirectories as codexDirectories,
} from './codex/layout.mjs'

// Names retained by the old workspace-file format, in its original order.
export const workspaceInstructionNames = [claudeFile, codexFile]
/** Provider-owned transcript folders; the storage walker applies this layout uniformly. */
export const providerConversationDirectories = new Map([
  ['claude', claudeDirectories],
  ['codex', codexDirectories],
])
export { CLAUDE_INSTRUCTIONS_FILE } from './claude/layout.mjs'
export { CODEX_INSTRUCTIONS_FILE } from './codex/layout.mjs'
