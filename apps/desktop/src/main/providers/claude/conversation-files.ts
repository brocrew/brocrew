import { readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { claudeAutoMemoryDir, claudeTranscriptPath } from '@brobot2/runtime'
import { ownsRecord } from './native-record'

import type { ProviderSessionOf } from '../../db/conversation-tree'
import {
  entryAt,
  isOneSegment,
  frontMatterOf,
  type ProviderFile,
  type MemoryNote,
} from '../../conversation-file-io'
export function filesOf(home: string, sessions: readonly ProviderSessionOf[]): ProviderFile[] {
  const files = new Map<string, ProviderFile>()
  const add = (path: string | null): void => {
    if (path === null || files.has(path)) return
    const found = entryAt(home, path)
    if (found !== null) files.set(path, found)
  }

  for (const { sessionId, cwd } of sessions) {
    if (!isOneSegment(sessionId)) continue
    const transcript = claudeTranscriptPath(sessionId, cwd, home)
    if (transcript !== null && ownsRecord(home, transcript)) {
      add(transcript)
      add(join(dirname(transcript), sessionId))
    }
    add(join(home, 'file-history', sessionId))
    add(join(home, 'tasks', sessionId))
    add(join(home, 'session-env', sessionId))
    add(join(home, 'debug', `${sessionId}.txt`))
  }
  return [...files.values()]
}

/**
 * The memory notes in a Claude agent's memory folder that one of `sessions` created: Claude Code
 * stamps a note it writes with the session that first wrote it (`originSessionId`, in its
 * front-matter's `metadata`), and keeps that stamp when the note is edited later. The folder's
 * index (`MEMORY.md`) is never one of them; Codex keeps no note tied to one conversation.
 */
export function memoryNotesOf(home: string, sessions: readonly ProviderSessionOf[]): MemoryNote[] {
  const ids = new Set(sessions.map(({ sessionId }) => sessionId))
  const folder = claudeAutoMemoryDir(home)
  let names: string[]
  try {
    names = readdirSync(folder)
  } catch {
    return []
  }
  const notes: MemoryNote[] = []
  for (const name of names.sort()) {
    if (!name.endsWith('.md') || name === 'MEMORY.md') continue
    const path = join(folder, name)
    const found = entryAt(home, path)
    if (found?.kind !== 'file') continue
    let text: string
    try {
      text = readFileSync(path, 'utf8')
    } catch {
      continue
    }
    const said = frontMatterOf(text)
    if (said.originSessionId === null || !ids.has(said.originSessionId)) continue
    notes.push({
      path,
      name: said.name ?? basename(name, '.md'),
      description: said.description,
      bytes: found.bytes,
    })
  }
  return notes
}
