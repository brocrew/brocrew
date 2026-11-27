import { importArchivedFile } from '../archived-file'
import { importDraftsFile } from '../database/sqlite/workspace/drafts'
import { importProfileExecutionFile } from '../profile-execution-file'
import { importProviderUsageFile } from '../provider-usage-file'
import type { BuildMigration } from '../recovery/database-facts'
import { importScheduleAttemptsFile } from '../schedule-attempts-file'
import { importSignInChangesFile } from '../sign-in-changes'
import { importTurnsTheAppCutFile } from '../turns-the-app-cut-file'
import { WorkspaceUnavailable } from '../workspace-startup'
import { openDatabase, type AppDatabase } from './connection'
import { applyMigrations } from './migrate'
import { NewerDatabaseError, openOrRefuse, UnreadableDatabaseError } from './newer-database'

export class MigrationFailed extends Error {}

export interface WorkspaceDatabaseOpening {
  /** The workspace database file. */
  readonly file: string
  /** The workspace's data folder: where its side files are and what a refusal names. */
  readonly folder: string
  /** A workspace that already exists is opened, never created. */
  readonly existing: boolean
  readonly migrationsFolder: string
  readonly build: readonly BuildMigration[]
  /** Called when the open fails, before its error is said; it may throw its own. */
  readonly openFailed?: () => void
  /** Runs the migrations, so the caller can trace and time them. */
  readonly migrate?: (apply: () => void) => void
}

/**
 * The workspace database as a start opens it, in order: open (with the WAL cut), refuse a database
 * a newer build migrated, apply this build's migrations, then import the old side files once. A
 * failed migration closes the database and says so.
 */
export function openWorkspaceDatabase(opening: WorkspaceDatabaseOpening): AppDatabase {
  const database = (() => {
    try {
      return openDatabase(opening.file, opening.existing ? { fileMustExist: true } : undefined)
    } catch (error) {
      opening.openFailed?.()
      if (opening.existing) throw new WorkspaceUnavailable(opening.file, error)
      throw error
    }
  })()
  openOrRefuse(database, opening.build, { folder: opening.folder })
  const apply = () => applyMigrations(database, opening.migrationsFolder)
  try {
    if (opening.migrate === undefined) apply()
    else opening.migrate(apply)
  } catch (error) {
    try {
      database.close()
    } catch {
      // Closed as the process ends.
    }
    throw new MigrationFailed(
      `BroCrew could not update this workspace's data: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
  importArchivedFile(database, opening.folder)
  importSignInChangesFile(database, opening.folder)
  importProviderUsageFile(database, opening.folder)
  importScheduleAttemptsFile(database, opening.folder)
  importTurnsTheAppCutFile(database, opening.folder)
  importDraftsFile(database, opening.folder)
  importProfileExecutionFile(database, opening.folder)
  return database
}

/** A failed open as it crosses from the worker that opened it: plain data, kind first. */
export type OpenFailure =
  | { readonly kind: 'migration'; readonly message: string; readonly cause: string }
  | { readonly kind: 'newer'; readonly folder: string; readonly fit: NewerDatabaseError['fit'] }
  | { readonly kind: 'unreadable'; readonly folder: string; readonly detail: string }
  | { readonly kind: 'unavailable'; readonly file: string; readonly cause: string }
  | { readonly kind: 'other'; readonly message: string }

export function describeOpenFailure(error: unknown, file: string): OpenFailure {
  const said = (value: unknown) => (value instanceof Error ? value.message : String(value))
  if (error instanceof MigrationFailed)
    return { kind: 'migration', message: error.message, cause: said(error.cause) }
  if (error instanceof NewerDatabaseError)
    return { kind: 'newer', folder: error.folder, fit: error.fit }
  if (error instanceof UnreadableDatabaseError)
    return { kind: 'unreadable', folder: error.folder, detail: error.detail }
  if (error instanceof WorkspaceUnavailable)
    return { kind: 'unavailable', file, cause: said(error.cause) }
  return { kind: 'other', message: said(error) }
}

/** The same error the open would have thrown on main. */
export function openFailureFrom(failure: OpenFailure): Error {
  switch (failure.kind) {
    case 'migration':
      return new MigrationFailed(failure.message, { cause: new Error(failure.cause) })
    case 'newer':
      return new NewerDatabaseError(failure.folder, failure.fit)
    case 'unreadable':
      return new UnreadableDatabaseError(failure.folder, failure.detail)
    case 'unavailable':
      return new WorkspaceUnavailable(failure.file, new Error(failure.cause))
    case 'other':
      return new Error(failure.message)
  }
}
