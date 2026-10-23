import {
  CODEX_MEMORY_PIPELINE_FILES,
  CODEX_MEMORY_STORE_FILES,
  codexAdHocNotesDir,
  codexMemoryDir,
} from '@brobot2/runtime'
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
  // ⚠️ Hoisted: `realPath` walks the filesystem, and this was being recomputed once per note.
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
      // ⚠️ Availability, never comprehension: the note is in the store and the agent can search it.
      // Saying the model "has" it would be 305's defect with a friendlier face.
      reach: 'on-request' as const,
    })),
  ]

  const read = readMemoryStore(candidates)
  if (notes.refused !== null) read.refused.push(notes.refused)
  const listed = read.memory.filter((item) => item.kind === 'agent-memory-note').length
  return {
    ...read,
    // ⚠️ `existsSync` rather than "did we read anything": a store that exists and holds nothing we
    // show is still a store, and the sentence about it is still true. ⛔ It follows links, so a
    // `memories/` pointed at another disk is a store and a DANGLING one is not — which is the
    // answer that leaves the broken-link row to say what happened.
    dir: existsSync(dir) ? dir : null,
    notesFound: notes.names.length,
    notesListed: listed,
    // ⚑ **Whether the SUMMARY is really there**, so the sentence can say what is in the prompt
    // rather than what would be. ⚠️ Found reviewing this diff: a profile whose agent has written
    // only ad-hoc notes has no `memory_summary.md` yet, and a sentence stating that one file is in
    // front of the model sent the reader looking for a file that does not exist — 317's own defect
    // class, in the sentence 317 added.
    injects: read.memory.some((item) => item.reach === 'prompt'),
    pipeline: CODEX_MEMORY_PIPELINE_FILES.filter((name) => existsSync(join(dir, name))),
  }
}

export { newestMemoryNotes as adHocNotes } from '../instruction-io'

export const memory = createMemoryPolicy(readCodexAgentMemory, {
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
