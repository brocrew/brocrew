import { workspaceInstructionFile as claudeFile } from './claude/layout.mjs'
import { workspaceInstructionFile as codexFile } from './codex/layout.mjs'

// Names retained by the old workspace-file format, in its original order.
export const workspaceInstructionNames = [claudeFile, codexFile]
export { CLAUDE_INSTRUCTIONS_FILE } from './claude/layout.mjs'
export { CODEX_INSTRUCTIONS_FILE } from './codex/layout.mjs'
