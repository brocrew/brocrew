import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AppDatabase } from '../../../db/connection'

/** The JSON files builds before 0.2.18 kept beside the database; 0.2.18 moved each into it. */
export const SIDE_FILES_BEFORE_0_2_18 = [
  'archived.json',
  'sign-in-changes.json',
  'provider-usage.json',
  'schedule-attempts.json',
  'turns-the-app-cut.json',
  'drafts.json',
  'profile-execution.json',
] as const

export const OPEN_IN_0_2_18_FIRST = 'Open this workspace in BroCrew 0.2.18 first.'

/**
 * Stops a start, before any migration, on a workspace no 0.2.18 or later build has opened: its
 * database has no `imported_side_file` table yet and a side file is beside it. A build that has the
 * table already tried every file, so one left after it is a file 0.2.18 could not import either.
 */
export function refuseSideFilesBefore0218(database: AppDatabase, userData: string): void {
  const opened =
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'imported_side_file'")
      .get() !== undefined
  if (!opened && SIDE_FILES_BEFORE_0_2_18.some((name) => existsSync(join(userData, name)))) {
    database.close()
    throw new Error(OPEN_IN_0_2_18_FIRST)
  }
}

/** `value` as a plain object, or an empty one. */
export function objectIn(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
