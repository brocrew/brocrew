import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import {
  importScheduleAttemptsFile,
  MAX_ATTEMPT_CONVERSATIONS,
  SCHEDULE_ATTEMPTS_FILE,
  scheduleAttemptsIn,
  type ConversationAttempts,
} from '../src/main/schedule-attempts-file'

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

describe('what was done about scheduled jobs is kept for the conversations recorded most recently', () => {
  it('⛔ of one more than the cap, the one recorded longest ago goes, and a read gives back what was written', () => {
    const dir = mkdtempSync(join(tmpdir(), 'brobot2-attempts-'))
    const db = openDatabase(join(dir, 'brobot2.sqlite'))
    try {
      applyMigrations(db, migrationsFolder)
      const done = (at: number): ConversationAttempts => ({
        attempts: [{ key: 'a job', revision: 'as it was', attempted: true }],
        admittedAt: at,
        told: [{ id: 'a notice', of: 'a making', said: true }],
        runs: { 'a making': { runAt: at, startedAt: at, unanswered: 2 } },
        notStartedSaid: { 'job-a': 'no-word-from-its-provider' },
        at,
      })
      scheduleAttemptsIn(db).write({
        conversations: Object.fromEntries(
          Array.from({ length: MAX_ATTEMPT_CONVERSATIONS + 1 }, (_, n) => [
            `sess_${String(n)}`,
            done(1_000 + n),
          ]),
        ),
      })
      const back = scheduleAttemptsIn(db).read().conversations
      expect(Object.keys(back)).toHaveLength(MAX_ATTEMPT_CONVERSATIONS)
      // ⚠️ The one dropped is read as nothing done: it costs one more start, and no more.
      expect(back['sess_0']).toBeUndefined()
      expect(back[`sess_${String(MAX_ATTEMPT_CONVERSATIONS)}`]).toEqual(
        done(1_000 + MAX_ATTEMPT_CONVERSATIONS),
      )

      // The old file is imported once; one that is not JSON is kept and imports nothing.
      const file = join(dir, SCHEDULE_ATTEMPTS_FILE)
      writeFileSync(file, '{ torn')
      importScheduleAttemptsFile(db, dir)
      expect(readFileSync(file, 'utf8')).toBe('{ torn')
      expect(Object.keys(scheduleAttemptsIn(db).read().conversations)).toHaveLength(
        MAX_ATTEMPT_CONVERSATIONS,
      )
      writeFileSync(
        file,
        JSON.stringify({ conversations: { sess_x: { at: 'yesterday' }, sess_y: done(7) } }),
      )
      importScheduleAttemptsFile(db, dir)
      expect(scheduleAttemptsIn(db).read().conversations).toEqual({ sess_y: done(7) })
      expect(existsSync(file)).toBe(false)
    } finally {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
