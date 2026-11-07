import type { Migration } from '../recovery/contract'
import { lineageFit, migrationsRecordedIn, type BuildMigration } from '../recovery/database-facts'
import type { AppDatabase } from './connection'

/** Migrations, counted, with the latest one's time: a build's or a database's. */
export interface Migrations {
  readonly count: number
  /** The latest migration's `when` (journal) or `created_at` (record), epoch ms. */
  readonly latest: number
}

/** `migrations`, counted, with the latest one's time; a list with none is at time 0. */
export function counted(migrations: readonly Migration[]): Migrations {
  return { count: migrations.length, latest: migrations.at(-1)?.createdAt ?? 0 }
}

/** Whether this build may open the database: it fits, a newer build migrated it, or it cannot tell. */
export type DatabaseFit =
  | { readonly kind: 'fits' }
  | { readonly kind: 'newer'; readonly inTheDatabase: Migrations; readonly inTheBuild: Migrations }
  | { readonly kind: 'unreadable'; readonly detail: string }

const FITS: DatabaseFit = { kind: 'fits' }

/** How the database open on `database` fits `build`, this build's migrations, oldest first. */
export function howTheDatabaseFits(
  database: AppDatabase,
  build: readonly BuildMigration[],
): DatabaseFit {
  const record = migrationsRecordedIn(database)
  if (record.kind === 'unreadable') return { kind: 'unreadable', detail: record.detail }
  if (record.kind !== 'recorded') return FITS
  switch (lineageFit(record.migrations, build)) {
    case 'fits':
      return FITS
    case 'newer':
      return {
        kind: 'newer',
        inTheDatabase: counted(record.migrations),
        inTheBuild: counted(build),
      }
    case 'foreign':
      return {
        kind: 'unreadable',
        detail:
          'it records a migration this version of BroCrew does not carry, and none later than its own, so no ' +
          'version of BroCrew this one knows made it',
      }
  }
}

/** The facts alone: whose data, and how much newer. */
function whatIsNewer(folder: string, fit: Extract<DatabaseFit, { kind: 'newer' }>): string {
  const what =
    fit.inTheDatabase.count > fit.inTheBuild.count
      ? `to database version ${String(fit.inTheDatabase.count)}, and this version of BroCrew reads up to version ${String(fit.inTheBuild.count)}`
      : 'with a database change this version of BroCrew does not have'
  return `A newer version of BroCrew has updated this workspace's data (${folder}) ${what}.`
}

/** What a person reads when this build does not open their workspace. */
export function newerDatabaseSentence(
  folder: string,
  fit: Extract<DatabaseFit, { kind: 'newer' }>,
): string {
  return (
    `${whatIsNewer(folder, fit)} ` +
    'So this version of BroCrew did not open it, and nothing in it was changed. ' +
    'Open this workspace with the newer version of BroCrew, or update this one.'
  )
}

/** What a person reads when this build cannot tell which version their workspace's data is at. */
export function unreadableDatabaseSentence(folder: string, detail: string): string {
  return (
    `BroCrew could not read which version this workspace's data (${folder}) is at: ${detail}. ` +
    'So this version of BroCrew did not open it, and nothing in it was changed.'
  )
}

/** The refusal, carried out of the database's opening to the one place that tells the person. */
export class NewerDatabaseError extends Error {
  constructor(
    readonly folder: string,
    readonly fit: Extract<DatabaseFit, { kind: 'newer' }>,
  ) {
    super(newerDatabaseSentence(folder, fit))
    this.name = 'NewerDatabaseError'
  }
}

/** The refusal of a database whose migration record cannot be read, or that this build cannot lead to. */
export class UnreadableDatabaseError extends Error {
  constructor(
    readonly folder: string,
    readonly detail: string,
  ) {
    super(unreadableDatabaseSentence(folder, detail))
    this.name = 'UnreadableDatabaseError'
  }
}

export function openOrRefuse(
  database: AppDatabase,
  build: readonly BuildMigration[],
  where: { readonly folder: string },
): void {
  const fit = howTheDatabaseFits(database, build)
  if (fit.kind === 'fits') return
  database.close()
  throw fit.kind === 'newer'
    ? new NewerDatabaseError(where.folder, fit)
    : new UnreadableDatabaseError(where.folder, fit.detail)
}
