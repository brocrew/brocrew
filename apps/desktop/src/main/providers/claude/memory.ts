import { claudeAutoMemoryDir, claudeAutoMemoryIndex, isClaudeMemoryTopic } from '@brobot2/runtime'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { RefusedInstruction } from '../../../shared/runtime-ipc'
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
   * ⛔ **When this app ASKED for all of the above** (604) — see
   * {@link MemoryLoadedEvent.lookedAt} for what the number is a time of and whose act that is.
   *
   * ⚠️ **Required here and optional on the wire**, which is the split `599` already uses: the
   * reader always takes one, and the event type has to keep describing rows written before it did.
   */
  lookedAt: number
}

export function readClaudeAgentMemory(providerHome: string): ClaudeMemoryRead {
  // 🔴 **604 · the moment we ASKED, above every syscall in this function** — see
  // {@link MemoryLoadedEvent.lookedAt} for what it is a time OF and why it is one number.
  //
  // ⛔ **The first line, not the last, and not one per read.** Everything below does real I/O — a
  // `realpath`, a listing, and one guarded read per file — so a stamp taken at the BOTTOM would
  // date the listing that produced `topicsFound` with the moment the last file finished, and *"we
  // saw N beside it then"* would be a claim about a directory read earlier than it says. ⚑ Taken
  // here, every fact this function returns is from at-or-after the number, which is the direction
  // that can only under-claim. ⚠️ **One number because the row is one row**: `599`'s field is per
  // file because its list is per file, and this one accompanies a single path and a single count.
  const lookedAt = Date.now()
  // ⚑ Derived once, from the SAME function that produced the path we read — never a second copy of
  // the provider's directory scheme (032). Only the home is real-pathed, which is what makes this
  // "did the link move it" rather than "is any component of this path a link".
  const dir = claudeAutoMemoryDir(providerHome)
  const realDir = claudeAutoMemoryDir(realPath(providerHome))
  const topics = claudeMemoryTopics(dir)
  const read = readMemoryStore([
    {
      path: claudeAutoMemoryIndex(providerHome),
      derived: claudeAutoMemoryIndex(realPath(providerHome)),
      kind: 'agent-memory',
      // ⚑ The CLI loads this file into its own system prompt before this app is asked
      // anything: a real child answered from it with no tool call.
      reach: 'prompt',
    },
    // ⛔ **The index is FIRST and that is a budget decision as well as an order** (187 §2). The
    // accumulator in `readMemoryStore` is spent in this order, so a store of twenty topic files can
    // never evict the one file the model was actually given. `instructions.test.ts` asserts it.
    ...topics.names.slice(0, AGENT_MEMORY_NOTES_SHOWN).map((name) => ({
      path: join(dir, name),
      derived: join(realDir, name),
      kind: 'agent-memory-topic' as const,
      // ⚠️ Availability, never comprehension — the same word Codex's notes get, for the same
      // reason: the file is in the store and the agent can open it. Saying the model "has" it
      // would be 305's defect with a friendlier face.
      reach: 'on-request' as const,
    })),
  ])
  // ⛔ **De-duplicated, and this is the case §3.4 asked about** (found writing this). When
  // `memory/` is a link that leads NOWHERE, `readMemoryStore` already reports it: the index read
  // comes back `absent` and {@link brokenMemoryLink} walks up to the directory. The listing sees the
  // same broken directory and would name it a second time — one fact, two rows, on the one panel
  // whose whole job is to be readable. The leaf's row wins because it is the one that ran first.
  if (topics.refused !== null && !read.refused.some((row) => row.path === topics.refused?.path)) {
    read.refused.push(topics.refused)
  }
  return {
    ...read,
    // ⚠️ `existsSync` rather than "did we read anything", and it FOLLOWS links: a `memory/`
    // pointed at another disk is a store, and a DANGLING one is not — which leaves the broken-link
    // row above to say what happened, instead of a sentence about a directory that is gone.
    dir: existsSync(dir) ? dir : null,
    topicsFound: topics.names.length,
    topicsListed: read.memory.filter((item) => item.kind === 'agent-memory-topic').length,
    // ⚑ **Whether the INDEX is really there** — 317 M25's lesson, on the other provider. A profile
    // whose agent has written topic files but no index yet has nothing in the prompt, and a
    // sentence claiming one file is in front of the model would send the reader looking for it.
    injects: read.memory.some((item) => item.reach === 'prompt'),
    lookedAt,
  }
}

export function claudeMemoryTopics(dir: string): {
  names: string[]
  refused: RefusedInstruction | null
} {
  const listed = memoryDirNames(dir, true)
  return { names: listed.names.filter(isClaudeMemoryTopic), refused: listed.refused }
}

export const memory = createMemoryPolicy(readClaudeAgentMemory, {
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
