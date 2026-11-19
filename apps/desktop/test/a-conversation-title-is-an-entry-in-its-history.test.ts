import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deriveLedger } from '../src/main/archive/derive-ledger'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { HISTORY_TYPES } from '../src/main/db/event-retention-policy'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import {
  aConversationTitle,
  CONVERSATION_TITLE_CHARS,
  type ConversationTitledEvent,
} from '../src/shared/conversation-title'
import { linesOf } from './helpers/provider-lines'

/**
 * # A conversation's title is an entry in its own history
 *
 * The giver names a new conversation after its job; the holder, the giver or a person may rename it.
 * Each title is one `titled` row in that conversation's ledger, recording who set it, and the newest
 * stands. No column, no migration.
 *
 * | § | what it pins |
 * |---|---|
 * | 1 | no title reads as none; a title reads back with its author and time; the newest stands and every one is kept |
 * | 2 | a title that is not one line of 1 to 200 characters, or has no valid author, writes nothing |
 * | 3 | a title written inside a larger write rolls back with it |
 * | 4 | a stored row that is not a title reads as none; history trimming never removes a title |
 * | 5 | a rebuild of provider history keeps every title, in order, after the rebuilt rows |
 * | 6 | a conversation imported from its exported ledger keeps its titles |
 */

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
const AT = 1_700_000_000_000

const byAgent = (title: string, conversation = 'sess_giver'): ConversationTitledEvent => ({
  type: 'titled',
  title,
  author: { kind: 'agent', conversation },
})

const byPerson = (title: string): ConversationTitledEvent => ({
  type: 'titled',
  title,
  author: { kind: 'person' },
})

describe("a conversation's title", () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-conversation-title-'))
    db = openDatabase(join(dir, 'db.sqlite'))
    applyMigrations(db, migrations)
    store = createSessionStore(db)
    store.create({
      id: 'sess_job',
      provider: 'claude',
      cwd: '/work',
      approvalMode: 'ask',
      profileId: 'default',
    })
    store.append('sess_job', 0, { type: 'status', state: 'idle' }, AT)
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const titledRows = (): number =>
    (
      db
        .prepare(`SELECT count(*) AS n FROM events WHERE session_id = ? AND type = 'titled'`)
        .get('sess_job') as { n: number }
    ).n

  it('§1 none reads as none; a title reads back with who set it and when; the newest stands, every one kept', () => {
    expect(store.conversationTitle('sess_job')).toBeNull()

    store.titleConversation('sess_job', 1, byAgent('  Trip to Portugal  '), AT + 1)
    expect(store.conversationTitle('sess_job')).toEqual({
      title: 'Trip to Portugal',
      author: { kind: 'agent', conversation: 'sess_giver' },
      at: AT + 1,
    })

    store.titleConversation('sess_job', 2, byPerson('Trip to Portugal and Madrid'), AT + 2)
    expect(store.conversationTitle('sess_job')).toEqual({
      title: 'Trip to Portugal and Madrid',
      author: { kind: 'person' },
      at: AT + 2,
    })
    expect(titledRows()).toBe(2)
  })

  it('§2 a blank, too long or multi-line title, or one without a valid author, writes nothing', () => {
    const tooLong = 'x'.repeat(CONVERSATION_TITLE_CHARS + 1)
    for (const title of ['', '   ', tooLong, 'two\nlines', 'two\u2028lines']) {
      expect(() => store.titleConversation('sess_job', 1, byAgent(title), AT + 1)).toThrow()
    }
    expect(() => store.titleConversation('sess_job', 1, byAgent('DEV-1', ''), AT + 1)).toThrow()
    expect(() =>
      store.titleConversation(
        'sess_job',
        1,
        { type: 'titled', title: 'DEV-1', author: { kind: 'robot' } } as never,
        AT + 1,
      ),
    ).toThrow()
    expect(titledRows()).toBe(0)
    expect(store.conversationTitle('sess_job')).toBeNull()

    expect(aConversationTitle('x'.repeat(CONVERSATION_TITLE_CHARS))).toHaveLength(
      CONVERSATION_TITLE_CHARS,
    )
    expect(aConversationTitle(42)).toBeNull()
  })

  it('§3 a title written inside a larger write rolls back with it', () => {
    expect(() =>
      store.atomically(() => {
        store.titleConversation('sess_job', 1, byAgent('DEV-100012'), AT + 1)
        throw new Error('the rest of the give failed')
      }),
    ).toThrow('the rest of the give failed')
    expect(titledRows()).toBe(0)
    expect(store.conversationTitle('sess_job')).toBeNull()

    store.atomically(() => {
      store.titleConversation('sess_job', 1, byAgent('DEV-100012'), AT + 1)
    })
    expect(store.conversationTitle('sess_job')?.title).toBe('DEV-100012')
  })

  it('§4 a stored row that is not a title reads as none; trimming never removes a title', () => {
    store.titleConversation('sess_job', 1, byAgent('DEV-100012'), AT + 1)
    const torn = db
      .prepare(
        `UPDATE events SET payload = json_set(payload, '$.author', json('{"kind":"robot"}'))
          WHERE session_id = ? AND type = 'titled'`,
      )
      .run('sess_job')
    expect(torn.changes).toBe(1)
    expect(store.conversationTitle('sess_job')).toBeNull()

    expect(HISTORY_TYPES as readonly string[]).not.toContain('titled')
  })

  it('pages saved titles by ordinal across unread rows and later renames', () => {
    const session = 'sess_job'
    for (let ordinal = 1; ordinal <= 22; ordinal++) {
      const title = `Title ${ordinal}`
      store.titleConversation(session, ordinal, byPerson(title), AT + ordinal)
    }
    db.prepare('UPDATE events SET payload = ? WHERE session_id = ? AND ordinal = ?').run(
      'broken JSON',
      session,
      3,
    )

    const first = store.conversationTitleHistory(session)
    if (first.kind !== 'titles' || first.next === null) throw new Error('expected a continuation')
    expect(first.rowsUnread).toBe(1)
    expect(first.titles).toEqual(
      Array.from({ length: 19 }, (_, index) => {
        const ordinal = 22 - index
        return { ordinal, title: `Title ${ordinal}`, author: { kind: 'person' }, at: AT + ordinal }
      }),
    )
    expect(first.next.ordinal).toBe(3)

    store.titleConversation(session, 23, byAgent('New title'), AT + 23)
    expect(store.conversationTitleHistory(session, first.next)).toEqual({
      kind: 'titles',
      titles: [
        { ordinal: 2, title: 'Title 2', author: { kind: 'person' }, at: AT + 2 },
        { ordinal: 1, title: 'Title 1', author: { kind: 'person' }, at: AT + 1 },
      ],
      rowsUnread: 0,
      next: null,
    })

    const generation = store.beginGeneration(session)
    expect(
      store.promoteGeneration(session, generation, { normalizerVersion: 1, derivedThrough: 0 }),
    ).toBe(true)
    expect(store.conversationTitleHistory(session, first.next)).toEqual({
      kind: 'generation-changed',
    })
    expect(store.conversationTitleHistory(session)).toMatchObject({
      kind: 'titles',
      titles: expect.arrayContaining([
        expect.objectContaining({
          title: 'New title',
          author: { kind: 'agent', conversation: 'sess_giver' },
          at: AT + 23,
        }),
      ]),
    })
  })

  it('§5 a rebuild of provider history keeps every title, in order, with its author', async () => {
    store.adopt({
      id: 'sess_adopted',
      provider: 'claude',
      sessionId: 'thread-adopted',
      cwd: '/work',
      profileId: 'default',
      updatedAt: AT,
      createdAt: AT,
    })
    const frames = [0, 1, 2, 3].map((index) =>
      JSON.stringify({
        type: index % 2 === 0 ? 'user' : 'assistant',
        timestamp: new Date(AT + index * 1_000).toISOString(),
        message: { content: `line ${index}` },
      }),
    )
    const derive = (rebuild: boolean) =>
      deriveLedger(store, 'sess_adopted', 'claude', linesOf(frames), { fallbackAt: AT, rebuild })
    expect(await derive(false)).toBe('imported')

    const next = () => store.nextOrdinal('sess_adopted')
    store.titleConversation('sess_adopted', next(), byAgent('DEV-100012'), AT + 10)
    store.titleConversation('sess_adopted', next(), byPerson('DEV-100012 and DEV-100013'), AT + 11)

    expect(await derive(true)).toBe('imported')
    const afterFirstRebuild = store.events('sess_adopted')
    expect(await derive(true)).toBe('imported')
    expect(store.events('sess_adopted')).toEqual(afterFirstRebuild)
    expect(store.conversationTitle('sess_adopted')).toEqual({
      title: 'DEV-100012 and DEV-100013',
      author: { kind: 'person' },
      at: AT + 11,
    })
    const rows = db
      .prepare(
        `SELECT e.ordinal, json_extract(e.payload, '$.title') AS title,
                (SELECT max(o.ordinal) FROM events o
                  WHERE o.session_id = e.session_id AND o.generation = e.generation
                    AND o.type <> 'titled') AS last_provider_row
           FROM events e WHERE e.session_id = ? AND e.type = 'titled' ORDER BY e.ordinal`,
      )
      .all('sess_adopted') as { ordinal: number; title: string; last_provider_row: number }[]
    expect(rows.map((row) => row.title)).toEqual(['DEV-100012', 'DEV-100012 and DEV-100013'])
    for (const row of rows) expect(row.ordinal).toBeGreaterThan(row.last_provider_row)
  })

  it.each([1, 3])(
    'carries only the missing title rows after copying %d already recorded rows',
    (copied) => {
      const session = 'sess_job'
      store.titleConversation(session, 1, byAgent('Lisbon'), AT + 1)
      store.titleConversation(session, 2, byAgent('Lisbon'), AT + 1)
      store.titleConversation(session, 3, byPerson('Lisbon and Madrid'), AT + 2)
      const expected = store.events(session)
      const generation = store.beginGeneration(session)
      store.appendGeneration(session, generation, expected.slice(0, copied + 1))
      expect(
        store.promoteGeneration(session, generation, {
          normalizerVersion: 1,
          derivedThrough: 0,
        }),
      ).toBe(true)
      expect(store.events(session)).toEqual(expected)
      expect(store.nextOrdinal(session)).toBe(4)
      expect(store.conversationTitle(session)).toEqual({
        title: 'Lisbon and Madrid',
        author: { kind: 'person' },
        at: AT + 2,
      })
    },
  )

  it('§6 a conversation imported from its exported ledger keeps its titles', () => {
    store.titleConversation('sess_job', 1, byAgent('Lisbon trip, March'), AT + 1)
    store.titleConversation('sess_job', 2, byPerson('Lisbon trip, March and April'), AT + 2)
    const exported = store.eventsFrom('sess_job', 0, 1_000)

    store.importSnapshot({
      session: {
        id: 'sess_imported',
        provider: 'claude',
        sessionId: 'thread-imported',
        cwd: '/work',
        profileId: 'default',
        createdAt: AT,
        updatedAt: AT,
        rotation: 0,
      },
      derivedThrough: 0,
      ledger: exported.map((entry) => ({
        ordinal: entry.ordinal,
        event: entry.event,
        at: entry.at,
      })),
    })
    expect(store.conversationTitle('sess_imported')).toEqual({
      title: 'Lisbon trip, March and April',
      author: { kind: 'person' },
      at: AT + 2,
    })
  })
})
