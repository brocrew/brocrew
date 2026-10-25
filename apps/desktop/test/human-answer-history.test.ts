import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { HUMAN_FINAL_TERM, HUMAN_PROMPT_TERM } from '../src/main/db/human-answer-index'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import { acceptEvent, createSessionRecord, openWindow } from '../src/renderer/src/lib/session-record'
import { panelWords } from '../src/renderer/src/lib/latest-words'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
describe('indexed human answer history', () => {
  let directory: string
  let db: AppDatabase
  let store: SessionStore
  let ordinal: number
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'fictional-human-answer-'))
    db = openDatabase(join(directory, 'fictional.sqlite'))
    applyMigrations(db, migrations)
    store = createSessionStore(db)
    store.create({ id: 's', provider: 'codex', cwd: directory, approvalMode: 'ask', profileId: 'fictional' })
    ordinal = 0
  })
  afterEach(() => { db.close(); rmSync(directory, { recursive: true, force: true }) })
  function feed(...events: TranscriptEvent[]) {
    for (const event of events) { store.append('s', ordinal, event, 1000 + ordinal); ordinal++ }
  }
  function human(text: string) { feed({ type: 'user_turn', text, humanInitiated: true }) }
  function final(text: string) { feed({ type: 'assistant_message', text, phase: 'final' }, { type: 'turn', state: 'completed' }) }

  it('reloads a human final outside a page of later app turns without including their answers', () => {
    human('My **question**'); final('## My answer')
    for (let n = 0; n < 20; n++) {
      feed({ type: 'user_turn', text: `App ${n}`, attribution: 'app_authored' }); final(`App answer ${n}`)
    }
    const page = { ...store.turnWindow('s', { turns: 12, maxEvents: 2500 }), humanAnswers: store.latestHumanAnswers('s') }
    expect(page.entries.some((row) => row.ordinal === 0)).toBe(false)
    expect(page.humanAnswers.latest).toMatchObject({ prompt: 'My **question**', final: { text: '## My answer' } })
    const record = createSessionRecord('s')
    openWindow(record, page)
    page.entries.forEach((row) => acceptEvent(record, { ...row, sessionId: 's' }))
    expect(panelWords(record.control)?.text).toBe('My answer')
    human('New pending question')
    expect(store.latestHumanAnswers('s').latest).toMatchObject({ prompt: 'New pending question', final: null })
    feed({ type: 'turn', state: 'interrupted' }, { type: 'user_turn', text: 'App notice', attribution: 'app_authored' })
    final('New app response')
    expect(store.latestHumanAnswers('s').latest).toMatchObject({ prompt: 'New pending question', final: null })
  })

  it('keeps legacy authorship and missing finality uncertain and ignores child finals', () => {
    feed({ type: 'user_turn', text: 'Legacy' }); final('Old answer')
    expect(store.latestHumanAnswers('s').latest).toBeNull()
    human('Current')
    feed({ type: 'assistant_message', text: 'Complete block without final flag' },
      { type: 'assistant_message', text: 'Child final', phase: 'final', parentToolCallId: 'child' },
      { type: 'turn', state: 'completed' })
    expect(store.latestHumanAnswers('s').latest?.final).toBeNull()
  })

  it('a later uncertain prompt prevents selecting an older verified human final', () => {
    human('Known question'); final('Known answer')
    feed({ type: 'user_turn', text: 'Later legacy prompt' }); final('Legacy response')
    expect(store.latestHumanAnswers('s').latest).toBeNull()
  })

  it('uses index seeks without temporary sorts and tolerates malformed historical payloads', () => {
    for (const [name, term, extra, args] of [
      ['events_human_prompt_idx', HUMAN_PROMPT_TERM, '', ['s', 0]],
      ['events_human_final_idx', HUMAN_FINAL_TERM, ' AND turn_id = ? AND ordinal > ?', ['s', 0, 'fictional', 0]],
    ] as const) {
      const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT ordinal, payload FROM events WHERE session_id = ? AND generation = ? AND ${term}${extra} ORDER BY ordinal DESC LIMIT 1`).all(...args)
      const details = JSON.stringify(plan)
      expect(details).toContain(`USING INDEX ${name}`)
      expect(details).not.toContain('TEMP B-TREE')
      expect(details).not.toContain('SCAN events')
    }
    db.prepare('INSERT INTO events (id, session_id, ordinal, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)').run('bad', 's', 0, 'user_turn', '{', 1)
    expect(store.latestHumanAnswers('s').latest).toBeNull()
  })
})
