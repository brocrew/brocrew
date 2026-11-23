import type { TranscriptEvent } from '../src/shared/conversation-events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect } from 'vitest'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import type { PastWorkHit } from '../src/shared/past-work-search'

export const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

export function world() {
  const directory = mkdtempSync(join(tmpdir(), 'fictional-past-work-'))
  const file = join(directory, 'records.sqlite')
  const db = openDatabase(file)
  applyMigrations(db, join(import.meta.dirname, '../src/main/db/migrations'))
  const store = createSessionStore(db, () => 1_800_000_000_000)
  const ordinals = new Map<string, number>()
  cleanups.push(() => {
    store.closePastWorkSearch()
    db.close()
    rmSync(directory, { recursive: true, force: true })
  })
  const create = (id: string, profileId = 'fictional-reader') => {
    store.create({ id, provider: 'codex', profileId, cwd: directory, approvalMode: 'ask' })
    ordinals.set(id, 0)
    return store.rootOf(id)!
  }
  const append = (id: string, event: TranscriptEvent, at?: number) => {
    const ordinal = ordinals.get(id) ?? 0
    store.append(id, ordinal, event, at ?? 1_800_000_000_000 + ordinal)
    ordinals.set(id, ordinal + 1)
  }
  const find = (caller: string, words: string, profile?: string): readonly PastWorkHit[] => {
    const result = store.searchPastWork(caller, words, profile)
    expect(result.ok, JSON.stringify(result)).toBe(true)
    if (!result.ok) throw new Error('fictional search failed')
    return result.hits
  }
  return { db, directory, file, store, create, append, find }
}
