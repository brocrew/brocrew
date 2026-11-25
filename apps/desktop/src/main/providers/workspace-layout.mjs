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
const providerConversationDirectories = new Map([
  ['claude', claudeDirectories],
  ['codex', codexDirectories],
])

// Paths below provider-homes are given as their parts. A folder rule says whether a walk goes in;
// a file rule says whether a file there counts.

/** Whether the parts stay inside the one folder that holds the profiles' homes. */
function inTheHomes(parts) {
  return parts.length === 0 || parts[0] === 'default'
}

/** A folder that may hold provider history. */
export function mayHoldProviderHistory(parts) {
  if (!inTheHomes(parts)) return false
  if (parts.length < 3) return true
  const directories = providerConversationDirectories.get(parts[2])
  return directories !== undefined && (parts.length < 4 || directories.includes(parts[3]))
}

/** A file that is provider history: inside one of a provider home's conversation folders. */
export function isProviderHistory(parts) {
  return parts.length >= 4 && mayHoldProviderHistory(parts)
}

/** A folder that may hold a profile's own work. */
export function mayHoldAProfilesWork(parts) {
  return inTheHomes(parts) && (parts.length < 3 || !providerConversationDirectories.has(parts[2]))
}

/** A file that is a profile's own work: inside its home and outside its provider homes. */
export function isAProfilesWork(parts) {
  return parts.length >= 3 && mayHoldAProfilesWork(parts)
}
