import type Database from 'better-sqlite3'
import { expect } from 'vitest'

export function expectCapturedConversations(
  saved: Database.Database,
  live: Database.Database,
  historical: boolean,
): void {
  expect(saved.prepare('SELECT id FROM provider_session ORDER BY id').all()).toEqual(
    live.prepare('SELECT id FROM provider_session ORDER BY id').all(),
  )
  if (historical) {
    const columns = saved.pragma('table_info(provider_session)') as { name: string }[]
    expect(columns.map((column) => column.name)).not.toContain('source_session_ids')
    const turns = saved.prepare('SELECT * FROM turn ORDER BY id').all() as {
      id: string
      session_id: string
    }[]
    const sessions = saved.prepare('SELECT id, status FROM provider_session').all()
    expect(turns).toHaveLength(sessions.length)
    expect(turns.length).toBeGreaterThan(0)
    for (const turn of turns) {
      expect(turn).toMatchObject({
        ordinal: 0,
        generation: 0,
        closed_at: null,
        end_reason: null,
      })
      expect(sessions).toContainEqual({ id: turn.session_id, status: 'working' })
      expect(
        saved
          .prepare('SELECT ordinal, type FROM events WHERE turn_id = ? ORDER BY ordinal')
          .all(turn.id),
      ).toEqual([
        { ordinal: 0, type: 'user_turn' },
        { ordinal: 1, type: 'assistant_message' },
      ])
    }
    for (const table of ['provider_session', 'events', 'turn']) {
      expect(saved.prepare(`SELECT * FROM ${table} ORDER BY id`).all()).toEqual(
        live.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
      )
    }
  }
}
