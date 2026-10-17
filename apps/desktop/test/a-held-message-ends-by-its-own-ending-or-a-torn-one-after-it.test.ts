import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'

/**
 * # Held messages read in one pass · which `message_queued` rows still wait
 *
 * `messagesWaitingIn` reads a conversation's held messages and their endings in one pass and
 * pairs them in code. A message is still held unless an ending names it, or an ending too torn to
 * name one comes after it.
 *
 * | § | what it pins | why the existing tests do not reach it |
 * |---|---|---|
 * | 1 | a message whose own ending was written is no longer held; one without stays | every existing reader of `messagesWaitingIn` looks at a message that has no ending |
 * | 2 | a torn ending hides only what was held before it | the launch sweep's own torn-ending rule is pinned for its SQL, not for this read |
 */

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
const AT = 1_700_000_000_000

describe('which held messages still wait', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-held-one-pass-'))
    db = openDatabase(join(dir, 'db.sqlite'))
    applyMigrations(db, migrations)
    store = createSessionStore(db)
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  /** A conversation with a ref, its row `idle`, and `rows` appended after its start. */
  function conversation(id: string, rows: Parameters<SessionStore['append']>[2][]): void {
    store.create({
      id,
      provider: 'claude',
      cwd: '/work',
      approvalMode: 'ask',
      profileId: 'default',
    })
    const all = [
      {
        type: 'session',
        state: 'started',
        ref: { provider: 'claude', sessionId: `p_${id}`, cwd: '/work', rotation: 0 },
      },
      { type: 'launched' },
      { type: 'status', state: 'idle' },
      ...rows,
    ] as Parameters<SessionStore['append']>[2][]
    all.forEach((event, ordinal) => store.append(id, ordinal, event, AT + ordinal))
  }

  const queued = (messageId: string) =>
    ({
      type: 'message_queued',
      messageId,
      kind: 'work',
      text: `the words ${messageId}`,
    }) as Parameters<SessionStore['append']>[2]

  const unqueued = (messageId: string) =>
    ({ type: 'message_unqueued', messageId, reason: 'sent' }) as Parameters<
      SessionStore['append']
    >[2]

  const waiting = (id: string): string[] => store.messagesWaitingIn(id).map((one) => one.messageId)

  it('⛔ a message with its own ending is no longer held; ⚑ the one held after it still is', () => {
    conversation('sess_one_sent', [queued('msg_a'), unqueued('msg_a'), queued('msg_b')])
    expect(waiting('sess_one_sent')).toEqual(['msg_b'])
  })

  it('⚑ an ending that names another message hides nothing; ⛔ torn, it hides what was held before it and only that', () => {
    conversation('sess_torn', [queued('msg_before'), unqueued('msg_other'), queued('msg_after')])
    expect(waiting('sess_torn')).toEqual(['msg_before', 'msg_after'])

    const torn = db
      .prepare(`UPDATE events SET payload = '{' WHERE session_id = ? AND type = 'message_unqueued'`)
      .run('sess_torn')
    expect(torn.changes).toBe(1)
    expect(waiting('sess_torn')).toEqual(['msg_after'])
  })
})
