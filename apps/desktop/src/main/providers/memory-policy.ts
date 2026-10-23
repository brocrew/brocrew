import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { InjectedInstruction, RefusedInstruction } from '../../shared/runtime-ipc'
import type {
  AgentMemoryPage,
  AgentMemoryStoreRead,
  MemoryCandidate,
  MemoryStoreLayout,
} from './instruction-types'
import {
  AGENT_MEMORY_NOTES_SHOWN,
  AGENT_MEMORY_TOTAL_CAP,
  MEMORY_PAGE_MOST,
} from './instruction-limits'
import { readMemoryStore, realPath, sizeOnDisk } from './instruction-io'

interface MemoryLayout {
  entryOrigin(
    kind: InjectedInstruction['kind'],
  ): import('../../shared/what-this-agent-was-given').GivenOrigin
  root(home: string): string
  fixed(home: string, realHome: string): MemoryCandidate[]
  notesFolder(home: string): string
  listNotes(folder: string): { names: string[]; refused: RefusedInstruction | null }
  readonly listedKind: 'agent-memory-topic' | 'agent-memory-note'
  acceptsNote(name: string): boolean
  noteDirectory(home: string): string | null
}
export interface MemoryPolicy {
  entryOrigin(
    kind: InjectedInstruction['kind'],
  ): import('../../shared/what-this-agent-was-given').GivenOrigin
  readonly readStore: (home: string) => AgentMemoryStoreRead
  readonly layout: MemoryStoreLayout
  counts(home: string): { readonly total: number; readonly listed: number }
  readPage(home: string, offset: number, limit: number): AgentMemoryPage
  select(home: string, entry: string): InjectedInstruction | undefined
  noteDirectory(home: string): string | null
}

/** Bounded paging and selection over the provider's own candidates, without reading at binding. */
export function createMemoryPolicy(
  readStore: MemoryPolicy['readStore'],
  source: MemoryLayout,
): MemoryPolicy {
  const layout: MemoryStoreLayout = {
    fixedFiles: (home) => source.fixed(home, home).map((file) => file.path),
    notesFolder: source.notesFolder,
    listNotes: source.listNotes,
    acceptsNote: source.acceptsNote,
  }
  const readPage = (providerHome: string, offset: number, limit: number): AgentMemoryPage => {
    const realHome = realPath(providerHome)
    const dir = source.root(providerHome)
    const fixed = source.fixed(providerHome, realHome)
    const listDir = source.notesFolder(providerHome)
    const realListDir = source.notesFolder(realHome)
    const listing = source.listNotes(listDir)
    const listedKind = source.listedKind
    const from = Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0
    const most = Number.isFinite(limit)
      ? Math.min(MEMORY_PAGE_MOST, Math.max(1, Math.floor(limit)))
      : AGENT_MEMORY_NOTES_SHOWN
    const onThePage = from === 0 ? fixed : []
    let budget =
      AGENT_MEMORY_TOTAL_CAP - onThePage.reduce((spent, file) => spent + sizeOnDisk(file.path), 0)
    const taken: string[] = []
    for (const name of listing.names.slice(from, from + most)) {
      const cost = sizeOnDisk(join(listDir, name))
      if (taken.length > 0 && cost > budget) break
      budget -= cost
      taken.push(name)
    }
    const read = readMemoryStore([
      ...onThePage,
      ...taken.map((name) => ({
        path: join(listDir, name),
        derived: join(realListDir, name),
        kind: listedKind,
        reach: 'on-request' as const,
      })),
    ])
    const listingRefused = listing.refused
    if (listingRefused !== null && !read.refused.some((row) => row.path === listingRefused.path))
      read.refused.push(listingRefused)
    const after = from + taken.length
    return {
      ...read,
      dir: existsSync(dir) ? dir : null,
      total: fixed.filter((file) => existsSync(file.path)).length + listing.names.length,
      nextOffset: after < listing.names.length ? after : null,
      listed: listing.names.length,
      firstListed: listing.names.slice(0, AGENT_MEMORY_NOTES_SHOWN),
    }
  }
  return {
    readStore,
    layout,
    readPage,
    noteDirectory: source.noteDirectory,
    entryOrigin: source.entryOrigin,
    counts(providerHome) {
      const fixed = layout.fixedFiles(providerHome)
      const listing = source.listNotes(source.notesFolder(providerHome))
      const listed = listing.names.length
      return { total: fixed.filter((path) => existsSync(path)).length + listed, listed }
    },
    select(providerHome, entry) {
      const fixed = layout.fixedFiles(providerHome)
      if (fixed.includes(entry))
        return readPage(providerHome, 0, 1).memory.find((item) => item.path === entry)
      const folder = layout.notesFolder(providerHome)
      const names = layout.listNotes(folder).names
      const offset = names.findIndex((name) => join(folder, name) === entry)
      if (offset < 0) return undefined
      return readPage(providerHome, offset, 1).memory.find((item) => item.path === entry)
    },
  }
}
