import type { RefusedInstruction } from '../../../shared/instruction-contracts'
import {
  claudeAutoMemoryDir,
  claudeAutoMemoryIndex,
  isClaudeMemoryTopic,
} from '@brobot2/runtime/claude'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import type { AgentMemoryStoreRead } from '../instruction-types'
import { AGENT_MEMORY_NOTES_SHOWN } from '../instruction-limits'
import { readMemoryStore, realPath, memoryDirNames } from '../instruction-io'
import { createMemoryPolicy } from '../memory-policy'

export interface ClaudeMemoryRead extends AgentMemoryStoreRead {
  /** How many topic files are on disk, and how many of them the list above holds. */
  topicsFound: number
  topicsListed: number
  /** Whether anything in this store actually reaches the prompt — i.e. the index exists. */
  injects: boolean
  /**
   * When this app asked for all of the above (see {@link MemoryLoadedEvent.lookedAt}). Required
   * here; optional on the wire so rows written before it existed still parse.
   */
  lookedAt: number
}

export function readClaudeAgentMemory(providerHome: string): ClaudeMemoryRead {
  // Taken before any I/O (see {@link MemoryLoadedEvent.lookedAt}), so every fact returned is from
  // at or after it and the stamp can only under-claim. One stamp because the row is one row.
  const lookedAt = Date.now()
  // Derived from the same function that produced the path we read, never a second copy of the
  // provider's directory scheme. Only the home is real-pathed, so this asks "did the link move it"
  // rather than "is any component of this path a link".
  const dir = claudeAutoMemoryDir(providerHome)
  const realDir = claudeAutoMemoryDir(realPath(providerHome))
  const topics = claudeMemoryTopics(dir)
  const read = readMemoryStore([
    {
      path: claudeAutoMemoryIndex(providerHome),
      derived: claudeAutoMemoryIndex(realPath(providerHome)),
      kind: 'agent-memory',
      // The CLI loads this file into its own system prompt before this app is asked
      // anything: a real child answered from it with no tool call.
      reach: 'prompt',
    },
    // The index is first because `readMemoryStore` spends its budget in this order, so many topic
    // files can never evict the one file the model was actually given.
    ...topics.names.slice(0, AGENT_MEMORY_NOTES_SHOWN).map((name) => ({
      path: join(dir, name),
      derived: join(realDir, name),
      kind: 'agent-memory-topic' as const,
      // Availability, not comprehension: the file is in the store and the agent can open it, which
      // is not the same as the model having it.
      reach: 'on-request' as const,
    })),
  ])
  // De-duplicated: when `memory/` is a link to nothing, `readMemoryStore` already reports it (the
  // index read is `absent` and {@link brokenMemoryLink} walks up to the directory), and the listing
  // would name the same directory a second time. The leaf's row wins because it ran first.
  if (topics.refused !== null && !read.refused.some((row) => row.path === topics.refused?.path)) {
    read.refused.push(topics.refused)
  }
  return {
    ...read,
    // `existsSync` follows links: a `memory/` pointed at another disk is a store and a dangling one
    // is not, which leaves the broken-link row to say what happened.
    dir: existsSync(dir) ? dir : null,
    topicsFound: topics.names.length,
    topicsListed: read.memory.filter((item) => item.kind === 'agent-memory-topic').length,
    // Whether the index is really there: a profile with topic files but no index has nothing in the
    // prompt, and a sentence claiming otherwise would send the reader looking for it.
    injects: read.memory.some((item) => item.reach === 'prompt'),
    lookedAt,
  }
}

function claudeMemoryTopics(dir: string): {
  names: string[]
  refused: RefusedInstruction | null
} {
  const listed = memoryDirNames(dir)
  return { names: listed.names.filter(isClaudeMemoryTopic), refused: listed.refused }
}

export const memory = createMemoryPolicy(readClaudeAgentMemory, {
  editableFolders: (home) => [claudeAutoMemoryDir(home)],
  entryOrigin: () => 'an-agent',
  root: claudeAutoMemoryDir,
  fixed: (home, realHome) => [
    {
      path: claudeAutoMemoryIndex(home),
      derived: claudeAutoMemoryIndex(realHome),
      kind: 'agent-memory',
      reach: 'prompt',
    },
  ],
  notesFolder: claudeAutoMemoryDir,
  listNotes: claudeMemoryTopics,
  listedKind: 'agent-memory-topic',
  acceptsNote: isClaudeMemoryTopic,
  noteDirectory: () => null,
})
