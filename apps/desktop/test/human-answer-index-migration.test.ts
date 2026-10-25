import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

it('adds the human-answer indexes to a large fictional ledger without changing original events', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fictional-human-index-upgrade-'))
  const old = join(directory, 'old-migrations')
  mkdirSync(join(old, 'meta'), { recursive: true })
  const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8')) as {
    entries: { tag: string }[]
  }
  const prior = { ...journal, entries: journal.entries.filter((entry) => entry.tag !== '0020_human_answers') }
  for (const entry of prior.entries) copyFileSync(join(migrations, `${entry.tag}.sql`), join(old, `${entry.tag}.sql`))
  writeFileSync(join(old, 'meta/_journal.json'), JSON.stringify(prior))
  const db = openDatabase(join(directory, 'fictional.sqlite'))
  try {
    applyMigrations(db, old)
    createSessionStore(db).create({ id: 's', provider: 'codex', cwd: directory, approvalMode: 'ask', profileId: 'fictional' })
    const insert = db.prepare('INSERT INTO events (id,session_id,ordinal,type,payload,created_at,turn_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    const insertTurn = db.prepare('INSERT INTO turn (id,session_id,ordinal,prompt,opened_at,closed_at,end_reason) VALUES (?, ?, ?, ?, ?, ?, ?)')
    const rows = 100_000
    db.transaction(() => {
      for (let n = 0; n < rows; n++) {
        const turn = `fictional-turn-${Math.floor(n / 2000)}`
        if (n % 2000 === 0) insertTurn.run(turn, 's', Math.floor(n / 2000), 'Fictional question', n + 1, n + 2000, 'completed')
        const event = n % 2000 === 0 ? { type: 'user_turn', text: 'Fictional question', humanInitiated: true }
          : n % 2000 === 1999 ? { type: 'assistant_message', text: 'Fictional final answer', phase: 'final' }
            : { type: 'assistant_delta', text: 'Fictional progress only.' }
        insert.run(`fictional-${n}`, 's', n, event.type, JSON.stringify(event), n + 1, turn)
      }
    })()
    const before = db.prepare('SELECT count(*) AS n, sum(length(payload)) AS bytes, sum(ordinal) AS ordinals FROM events').get()
    const began = performance.now()
    applyMigrations(db, migrations)
    const indexMigrationMs = performance.now() - began
    expect(db.prepare('SELECT count(*) AS n, sum(length(payload)) AS bytes, sum(ordinal) AS ordinals FROM events').get()).toEqual(before)
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('events_human_prompt_idx','events_human_final_idx','events_turn_opening_idx')").all()).toHaveLength(3)
    const store = createSessionStore(db)
    const readAt = performance.now()
    expect(store.latestHumanAnswers('s').latest?.prompt).toBe('Fictional question')
    const boundedContextMs = performance.now() - readAt
    // A measurement receipt, not a machine-dependent timing assertion or an app-startup pass.
    console.info('fictional-human-answer-index-cost', JSON.stringify({ rows, indexMigrationMs, boundedContextMs }))
  } finally {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
