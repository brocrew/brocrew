import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import {
  conversationTree,
  deleteTheTree,
  providerSessionsOf,
  whatTiesTheTreeOutside,
} from '../src/main/db/conversation-tree'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'

/**
 * A conversation's tree, what ties it to conversations outside, and its delete, on a real database
 * with every migration: the rows go together, below first, and nothing outside the tree changes.
 */

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
let folder: string
let db: AppDatabase
let store: SessionStore

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'brobot2-tree-'))
  db = openDatabase(join(folder, 'brobot2.sqlite'))
  applyMigrations(db, migrations)
  store = createSessionStore(db)
})

afterEach(() => {
  db.close()
  rmSync(folder, { recursive: true, force: true })
})

function aConversation(id: string, parent?: string): string {
  store.create({
    id,
    provider: 'claude',
    cwd: folder,
    approvalMode: 'auto',
    profileId: 'pm',
    ...(parent === undefined ? {} : { parentSessionId: parent }),
  })
  return id
}

/** A piece owned by `owner`, given by `giver`, below `parent`, with one kept file. */
function aPiece(
  id: string,
  owner: string,
  giver: string | null,
  parent: string | null,
  sha: string,
): void {
  db.prepare(
    `INSERT INTO work
       (id, parent_id, number, owner_session_id, given_by_session_id, title, brief, created_at)
     VALUES (?, ?, (SELECT coalesce(max(number), 0) + 1 FROM work WHERE parent_id IS ?), ?, ?,
             'a piece', 'its brief', 1)`,
  ).run(id, parent, parent, owner, giver)
  db.prepare(
    `INSERT INTO work_resource (id, work_id, role, sha256, name, bytes, added_by_session_id, created_at)
     VALUES (?, ?, 'input', ?, 'notes.md', 3, ?, 1)`,
  ).run(`res_${id}`, id, sha, owner)
}

const rootPieceOf = (conversation: string): string =>
  (
    db
      .prepare(`SELECT id FROM work WHERE owner_session_id = ? AND parent_id IS NULL`)
      .get(conversation) as {
      id: string
    }
  ).id

describe('a conversation tree', () => {
  it('is the conversation, then each below it', () => {
    aConversation('a')
    aConversation('b', 'a')
    aConversation('c', 'b')
    aConversation('z')
    expect(conversationTree(db, 'a')).toEqual(['a', 'b', 'c'])
    expect(conversationTree(db, 'b')).toEqual(['b', 'c'])
    expect(conversationTree(db, 'nobody')).toEqual([])
  })

  it('is deleted whole, below first, with its pieces and records, and nothing else', () => {
    aConversation('a')
    aConversation('b', 'a')
    aConversation('z')
    const shared = 'a'.repeat(64)
    const only = 'b'.repeat(64)
    aPiece('w_b', 'b', 'a', rootPieceOf('a'), only)
    aPiece('w_z', 'z', null, rootPieceOf('z'), shared)
    db.prepare(`UPDATE work_resource SET sha256 = ? WHERE id = 'res_w_b'`).run(shared)
    aPiece('w_b2', 'b', 'a', 'w_b', only)
    store.append('a', 0, { type: 'user_turn', text: 'mine' }, 1)
    store.append('z', 0, { type: 'user_turn', text: 'theirs' }, 1)

    const deleted = deleteTheTree(db, conversationTree(db, 'a'))

    // The file another conversation's piece still names stays; the one nothing names may go.
    expect(deleted.filesNoOneNames).toEqual([{ sha256: only, name: 'notes.md' }])
    expect(store.recordedOne('a')).toBeNull()
    expect(store.recordedOne('b')).toBeNull()
    const count = (sql: string): number => (db.prepare(sql).get() as { n: number }).n
    expect(count(`SELECT count(*) AS n FROM events WHERE session_id IN ('a', 'b')`)).toBe(0)
    expect(count(`SELECT count(*) AS n FROM work WHERE owner_session_id IN ('a', 'b')`)).toBe(0)
    expect(count(`SELECT count(*) AS n FROM work_resource WHERE work_id IN ('w_b', 'w_b2')`)).toBe(
      0,
    )
    // The conversation outside the tree is as it was.
    expect(store.recordedOne('z')).not.toBeNull()
    expect(store.events('z')).toHaveLength(1)
    expect(count(`SELECT count(*) AS n FROM work_resource WHERE work_id = 'w_z'`)).toBe(1)
  })
})

describe('what ties a tree to conversations outside it', () => {
  it('is nothing for a tree used only by itself, and words to the root are no tie', () => {
    aConversation('a')
    aConversation('b', 'a')
    aConversation('z')
    aPiece('w_b', 'b', 'a', rootPieceOf('a'), 'c'.repeat(64))
    store.append('a', 0, { type: 'user_turn', text: 'hi', relayedFrom: 'z' }, 1)
    expect(whatTiesTheTreeOutside(db, ['a', 'b'])).toEqual([])
  })

  it('names work given from outside, words and questions to a helper from outside', () => {
    aConversation('a')
    aConversation('b', 'a')
    aConversation('z')
    aPiece('w_b', 'b', 'z', rootPieceOf('z'), 'd'.repeat(64))
    store.append('b', 0, { type: 'user_turn', text: 'hi', relayedFrom: 'z' }, 1)
    store.append('z', 0, { type: 'request_routed', requestId: 'r', to: 'an-agent', parent: 'b' }, 1)
    expect(whatTiesTheTreeOutside(db, ['a', 'b'])).toEqual(
      expect.arrayContaining([
        { conversation: 'b', with: 'z', how: 'gave-it-work' },
        { conversation: 'b', with: 'z', how: 'wrote-to-it' },
        { conversation: 'b', with: 'z', how: 'asked-it' },
      ]),
    )
  })
})

describe('the provider sessions a conversation had', () => {
  it('are its own, its launch’s, each later life’s, and the threads it started', () => {
    aConversation('a')
    // A life a clear moved to; the row's reference then moves on to a later one.
    store.append(
      'a',
      0,
      {
        type: 'conversation_reset',
        ref: { provider: 'claude', sessionId: 'cleared', cwd: '/elsewhere', rotation: 1 },
      } as never,
      1,
    )
    db.prepare(`UPDATE provider_session SET external_ref = ?, launched_as = ? WHERE id = 'a'`).run(
      JSON.stringify({ provider: 'claude', sessionId: 'now', cwd: '/w', rotation: 2 }),
      'first',
    )
    store.append(
      'a',
      1,
      { type: 'sub_agent', agentId: 'thread-1', phase: 'started', idKind: 'thread' } as never,
      1,
    )
    expect(providerSessionsOf(db, 'a')).toEqual([
      { sessionId: 'now', cwd: '/w' },
      { sessionId: 'first', cwd: folder },
      { sessionId: 'cleared', cwd: '/elsewhere' },
      { sessionId: 'thread-1', cwd: folder },
    ])
  })
})
