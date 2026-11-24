import {
  CODEX_MEMORY_PIPELINE_FILES,
  CODEX_MEMORY_STORE_FILES,
  codexAdHocNotesDir,
  codexMemoryDir,
} from '@brobot2/runtime/codex'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import type { AgentMemoryStoreRead, MemoryCandidate } from '../instruction-types'
import { AGENT_MEMORY_NOTES_SHOWN } from '../instruction-limits'
import { readMemoryStore, realPath, newestMemoryNotes as adHocNotes } from '../instruction-io'
import { createMemoryPolicy } from '../memory-policy'

export interface CodexMemoryRead extends AgentMemoryStoreRead {
  /** How many ad-hoc notes are on disk, and how many of them the list above holds. */
  notesFound: number
  notesListed: number
  /** Whether anything in this store actually reaches the prompt — i.e. the summary exists. */
  injects: boolean
  /** Which of the pipeline's own files exist, so the sentence names only what is really there. */
  pipeline: string[]
}

export function readCodexAgentMemory(providerHome: string): CodexMemoryRead {
  const dir = codexMemoryDir(providerHome)
  const realDir = codexMemoryDir(realPath(providerHome))
  const notesDir = codexAdHocNotesDir(providerHome)
  // Hoisted: `realPath` walks the filesystem, so it is computed once rather than per note.
  const realNotesDir = codexAdHocNotesDir(realPath(providerHome))
  const notes = adHocNotes(notesDir)

  const candidates: MemoryCandidate[] = [
    ...CODEX_MEMORY_STORE_FILES.map((file) => ({
      path: join(dir, ...file.at),
      derived: join(realDir, ...file.at),
      kind: 'agent-memory' as const,
      reach: file.reach,
    })),
    ...notes.names.slice(0, AGENT_MEMORY_NOTES_SHOWN).map((name) => ({
      path: join(notesDir, name),
      derived: join(realNotesDir, name),
      kind: 'agent-memory-note' as const,
      // Availability, not comprehension: the note is in the store and the agent can search it.
      reach: 'on-request' as const,
    })),
  ]

  const read = readMemoryStore(candidates)
  if (notes.refused !== null) read.refused.push(notes.refused)
  const listed = read.memory.filter((item) => item.kind === 'agent-memory-note').length
  return {
    ...read,
    // `existsSync` follows links: a `memories/` pointed at another disk is a store and a dangling
    // one is not, which leaves the broken-link row to say what happened.
    dir: existsSync(dir) ? dir : null,
    notesFound: notes.names.length,
    notesListed: listed,
    // Whether the summary is really there: a profile with only ad-hoc notes has no
    // `memory_summary.md`, and a sentence stating it is in the prompt would be false.
    injects: read.memory.some((item) => item.reach === 'prompt'),
    pipeline: CODEX_MEMORY_PIPELINE_FILES.filter((name) => existsSync(join(dir, name))),
  }
}

export { newestMemoryNotes as adHocNotes } from '../instruction-io'

export const memory = createMemoryPolicy(readCodexAgentMemory, {
  editableFolders: (home) => [codexAdHocNotesDir(home)],
  entryOrigin: (kind) => (kind === 'agent-memory' ? 'the-provider' : 'an-agent'),
  root: codexMemoryDir,
  fixed: (home, realHome) =>
    CODEX_MEMORY_STORE_FILES.map((file) => ({
      path: join(codexMemoryDir(home), ...file.at),
      derived: join(codexMemoryDir(realHome), ...file.at),
      kind: 'agent-memory',
      reach: file.reach,
    })),
  notesFolder: codexAdHocNotesDir,
  listNotes: adHocNotes,
  listedKind: 'agent-memory-note',
  acceptsNote: () => true,
  noteDirectory: codexAdHocNotesDir,
})
