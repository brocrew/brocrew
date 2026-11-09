import { join } from 'node:path'
import type { NotStartedBecause } from '@brobot2/runtime'
import type { WakeAttempt } from '../shared/schedule-wake-admission'
import type { AppDatabase } from './db/connection'
import { importSideFile, objectIn } from './db/side-file-import'

/**
 * What this app has already done about each stopped conversation's scheduled jobs, kept across a
 * restart: a start that was made is not made again because the app restarted. The host makes no
 * start of its own while this cannot be written.
 */

/** The most conversations kept; past it, the ones recorded longest ago go. */
export const MAX_ATTEMPT_CONVERSATIONS = 500
/**
 * The most attempt records and notices one conversation's record holds, the newest. The host
 * keeps only those about jobs its evidence still holds; this bounds the record whatever it holds.
 */
export const MAX_ATTEMPTS_A_CONVERSATION = 5_000

/** A notice already dealt with: handed to a start, or needing no word. */
export interface ToldNotice {
  /** The notice's own id. */
  readonly id: string
  /** The job the notice was about, by its making: its id and the call that made it. */
  readonly of: string
  /** Handed to a start (`true`), or settled because the conversation saw it for itself (`false`). */
  readonly said: boolean
}

/** The newest run of a repeating job that a start was made for. */
interface StartedFor {
  /** That run's minute, epoch ms. */
  readonly runAt: number
  /** When the start was made, epoch ms: a level its provider states after it answers that start. */
  readonly startedAt: number
  /**
   * How many starts this app made by itself for the job's runs, one after another, that its
   * provider has left unanswered — this one counted, if this app made it.
   */
  readonly unanswered: number
}

export interface ConversationAttempts {
  /** Each job, notice or shortfall a start was planned for, and whether that start was made. */
  readonly attempts: readonly WakeAttempt[]
  /** When the newest of those starts was made, epoch ms; `null` before any. */
  readonly admittedAt: number | null
  /** The notices already dealt with. */
  readonly told: readonly ToldNotice[]
  /** By the job's making: the newest run of a repeating job that a start was made for. */
  readonly runs: Readonly<Record<string, StartedFor>>
  /**
   * What the newest level in the conversation's ledger says this app does not start it for, by
   * job id: a level of this app's own is written, while it is stopped, only when that changes.
   */
  readonly notStartedSaid: Readonly<Record<string, NotStartedBecause>>
  /**
   * The newest moment its provider's conversation was reset where the row that marks the reset
   * could not be written: what a rebuilt plan reads in its place.
   */
  readonly resetUnmarkedAt?: number
  /** When this record last changed, epoch ms: what the cap drops by. */
  readonly at: number
}

export interface KeptAttempts {
  readonly conversations: Readonly<Record<string, ConversationAttempts>>
}

/** Nothing done yet. */
export const NO_ATTEMPTS_KEPT: KeptAttempts = { conversations: {} }

/** The file older builds kept these in, imported once into `schedule_attempt`. */
export const SCHEDULE_ATTEMPTS_FILE = 'schedule-attempts.json'

export interface AttemptsKept {
  read(): KeptAttempts
  write(kept: KeptAttempts): void
}

export function scheduleAttemptsIn(database: AppDatabase): AttemptsKept {
  const all = database.prepare('SELECT conversation_id AS id, record, at FROM schedule_attempt')
  return {
    read: () => ({
      conversations: Object.fromEntries(
        (all.all() as { id: string; record: string; at: number }[]).map(({ id, record, at }) => [
          id,
          { ...(JSON.parse(record) as Omit<ConversationAttempts, 'at'>), at },
        ]),
      ),
    }),
    write: database.transaction((kept: KeptAttempts) => replaceAttempts(database, kept)),
  }
}

function replaceAttempts(database: AppDatabase, kept: KeptAttempts): void {
  database.prepare('DELETE FROM schedule_attempt').run()
  const insert = database.prepare(
    'INSERT INTO schedule_attempt (conversation_id, record, at) VALUES (?, ?, ?)',
  )
  for (const [id, { at, ...record }] of Object.entries(kept.conversations))
    insert.run(id, JSON.stringify(record), at)
  database
    .prepare(
      `DELETE FROM schedule_attempt WHERE conversation_id NOT IN
       (SELECT conversation_id FROM schedule_attempt ORDER BY at DESC LIMIT ?)`,
    )
    .run(MAX_ATTEMPT_CONVERSATIONS)
}

/** Imports `schedule-attempts.json` from `userData` once, skipping each record it cannot use. */
export function importScheduleAttemptsFile(database: AppDatabase, userData: string): void {
  importSideFile(database, join(userData, SCHEDULE_ATTEMPTS_FILE), (said) => {
    const conversations: Record<string, ConversationAttempts> = {}
    for (const [id, row] of Object.entries(objectIn(objectIn(said)['conversations']))) {
      const record = objectIn(row)
      const list = (value: unknown) => (Array.isArray(value) ? value : [])
      if (typeof record['at'] !== 'number') continue
      conversations[id] = {
        attempts: list(record['attempts']),
        admittedAt: typeof record['admittedAt'] === 'number' ? record['admittedAt'] : null,
        told: list(record['told']),
        runs: objectIn(record['runs']) as ConversationAttempts['runs'],
        notStartedSaid: objectIn(
          record['notStartedSaid'],
        ) as ConversationAttempts['notStartedSaid'],
        ...(typeof record['resetUnmarkedAt'] === 'number'
          ? { resetUnmarkedAt: record['resetUnmarkedAt'] }
          : {}),
        at: record['at'],
      }
    }
    replaceAttempts(database, { conversations })
  })
}
