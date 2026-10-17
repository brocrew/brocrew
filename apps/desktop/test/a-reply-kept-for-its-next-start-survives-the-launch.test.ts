import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'

/**
 * **D-030 · a held message the launch sweep keeps, and the one it settles.**
 *
 * ⚑ A reply kept for its giver's next start was held while nothing ran in that conversation, so no
 * crash cut the life that held it: the launch must leave it waiting until a `launched` row follows
 * it. ⛔ A message a RUNNING life held is still abandoned when that life was cut by a crash — the
 * paired case, or the rule would be "never settle anything".
 */

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
const NOTHING_RUNNING: ReadonlySet<string> = new Set()
const AT = 1_700_000_000_000

describe('D-030 · the launch sweep and a message held for a next start', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-kept-'))
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

  const queued = (messageId: string, forItsNextStart: boolean) =>
    ({
      type: 'message_queued',
      messageId,
      kind: 'work',
      text: `the reply ${messageId}`,
      ...(forItsNextStart ? { forItsNextStart: true } : {}),
    }) as Parameters<SessionStore['append']>[2]

  const unqueuedOf = (id: string): string[] =>
    (
      db
        .prepare(
          `SELECT json_extract(payload, '$.messageId') AS m FROM events
          WHERE session_id = ? AND type = 'message_unqueued'`,
        )
        .all(id) as { m: string }[]
    ).map((row) => row.m)

  it('🔴 a message marked for its next start is left waiting — and still waits', () => {
    conversation('sess_giver', [queued('msg_kept', true)])
    expect(store.settleStrandedMessages(AT + 100, NOTHING_RUNNING)).toBe(0)
    expect(unqueuedOf('sess_giver')).toEqual([])
    expect(store.messagesWaitingIn('sess_giver').map((one) => one.messageId)).toEqual(['msg_kept'])
  })

  it('⛔ the same message, once a life has started after it, is the sweep’s again', () => {
    conversation('sess_giver', [queued('msg_kept', true), { type: 'launched' }])
    expect(store.settleStrandedMessages(AT + 100, NOTHING_RUNNING)).toBe(1)
    expect(unqueuedOf('sess_giver')).toEqual(['msg_kept'])
  })

  it('⚑ the paired case: a message an ordinary life held is settled as a crash leaves it', () => {
    conversation('sess_giver', [queued('msg_ordinary', false)])
    expect(store.settleStrandedMessages(AT + 100, NOTHING_RUNNING)).toBe(1)
    expect(unqueuedOf('sess_giver')).toEqual(['msg_ordinary'])
  })

  it('⚑ a conversation whose life ended keeps what it held, marked or not', () => {
    conversation('sess_over', [queued('msg_a', false), { type: 'status', state: 'ended' }])
    expect(store.settleStrandedMessages(AT + 100, NOTHING_RUNNING)).toBe(0)
    expect(store.messagesWaitingIn('sess_over').map((one) => one.messageId)).toEqual(['msg_a'])
  })
})
