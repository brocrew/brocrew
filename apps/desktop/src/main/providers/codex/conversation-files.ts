import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { ownsRecord, newestStateDatabase } from './native-record'
import { readCodexRolloutPaths } from '../../database/codex-records'
import type { ProviderSessionOf } from '../../db/conversation-tree'
import {
  entryAt,
  isOneSegment,
  type ProviderFile,
  type MemoryNote,
} from '../../conversation-file-io'
/** The rollout Codex's thread index names for each of `ids`, read from one copy of the index. */
function codexRolloutsOf(home: string, ids: readonly string[]): Map<string, string> {
  const state = ids.length === 0 ? null : newestStateDatabase(home)
  if (state === null) return new Map()
  return readCodexRolloutPaths(state, ids) ?? new Map()
}
export function filesOf(home: string, sessions: readonly ProviderSessionOf[]): ProviderFile[] {
  const files = new Map<string, ProviderFile>()
  const add = (path: string | null): void => {
    if (path === null || files.has(path)) return
    const found = entryAt(home, path)
    if (found !== null) files.set(path, found)
  }
  const ids = sessions.map(({ sessionId }) => sessionId).filter(isOneSegment)
  const rollouts = codexRolloutsOf(home, ids)
  for (const { sessionId } of sessions) {
    if (!isOneSegment(sessionId)) continue
    const rollout = rollouts.get(sessionId) ?? null
    if (rollout !== null && existsSync(rollout) && ownsRecord(home, rollout)) {
      add(rollout)
    }
    add(join(home, 'generated_images', sessionId))
  }
  return [...files.values()]
}

export function memoryNotesOf(): MemoryNote[] {
  return []
}
