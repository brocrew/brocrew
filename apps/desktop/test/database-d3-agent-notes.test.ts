import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentNotes } from '../src/main/database'
import { createSqliteAgentNotes } from '../src/main/database/sqlite/agents/own-notes'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
const agent = { who: 'an-agent', agent: 'notes-session' } as const
const person = { who: 'a-person' } as const

describe('agent notes through the async database interface', () => {
  let database: AppDatabase
  let notes: AgentNotes
  let store: SessionStore

  beforeEach(() => {
    database = openDatabase(':memory:')
    applyMigrations(database, migrations)
    store = createSessionStore(database)
    store.create({
      id: agent.agent,
      profileId: 'notes-agent',
      provider: 'codex',
      cwd: '/fictional/notes',
      approvalMode: 'ask',
    })
    notes = createSqliteAgentNotes(store)
  })

  afterEach(() => {
    if (database.open) database.close()
  })

  it('acknowledges one matching-baseline write and preserves exact text and author', async () => {
    const other = createSqliteAgentNotes(store)
    const [first, stale] = await Promise.all([
      notes.writeOwnNotes(
        'NOTES-AGENT',
        { expectedVersion: 0, text: ' First.\r\nSecond. ', why: 'Keep exact text.' },
        agent,
        100,
      ),
      other.writeOwnNotes(
        'notes-agent',
        { expectedVersion: 0, text: 'Lost update', why: 'A stale baseline.' },
        agent,
        101,
      ),
    ])
    expect(first).toMatchObject({
      version: 1,
      text: ' First.\r\nSecond. ',
      by: agent,
      author: { profile: 'notes-agent' },
      writtenAt: 100,
    })
    expect(stale).toBeNull()
    expect(await other.ownNotesOf('notes-agent')).toEqual({
      profile: 'notes-agent',
      versions: [first],
    })
    expect(database.open).toBe(true)
  })

  it('retains history, unread accounting and an atomic undo as a new version', async () => {
    for (const [version, text] of ['First', 'Second'].entries())
      await notes.writeOwnNotes(
        'notes-agent',
        { expectedVersion: version, text, why: 'Keep this version.' },
        agent,
        100 + version,
      )
    expect(await notes.ownNotesUnread('notes-agent')).toEqual({
      seenThrough: 0,
      newestAgentVersion: 2,
      unread: true,
    })
    expect(await notes.undoOwnNotes('notes-agent', { expectedVersion: 1 }, person, 102)).toBeNull()
    const restored = await notes.undoOwnNotes('notes-agent', { expectedVersion: 2 }, person, 103)
    expect(restored).toMatchObject({ version: 3, text: 'First', restoredFromVersion: 1 })
    expect(await notes.currentOwnNotesOf('notes-agent')).toEqual({
      profile: 'notes-agent',
      current: restored,
    })
    expect(await notes.ownNotesUnread('notes-agent')).toEqual({
      seenThrough: 3,
      newestAgentVersion: 2,
      unread: false,
    })
    expect(await notes.markOwnNotesSeen('notes-agent', 4, person)).toBe(false)
  })

  it('keeps an unknown identity absent and rejects native failure after close', async () => {
    expect(await notes.currentOwnNotesOf('missing')).toBeNull()
    expect(
      await notes.writeOwnNotes(
        'missing',
        { expectedVersion: 0, text: 'Unknown', why: 'Does not create an identity.' },
        person,
        100,
      ),
    ).toBeNull()
    database.close()
    await expect(notes.ownNotesOf('notes-agent')).rejects.toThrow()
    await expect(
      notes.writeOwnNotes(
        'notes-agent',
        { expectedVersion: 0, text: 'Closed', why: 'Must not report a commit.' },
        agent,
        101,
      ),
    ).rejects.toThrow()
  })
})
