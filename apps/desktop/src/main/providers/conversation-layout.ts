import { conversationDirectories as claudeDirectories } from './claude/layout.mjs'
import { conversationDirectories as codexDirectories } from './codex/layout.mjs'

/** Provider-owned transcript folders; the storage walker applies this layout uniformly. */
export const providerConversationDirectories: ReadonlyMap<string, readonly string[]> = new Map<
  string,
  readonly string[]
>([
  ['claude', claudeDirectories],
  ['codex', codexDirectories],
])
