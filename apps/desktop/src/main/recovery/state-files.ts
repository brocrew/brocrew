import { SKILL_CATALOGUE_TABLES } from '../db/skill-catalogue-tables'
import { PROVIDER_HOMES_DIRNAME } from '../runtime/provider-homes'
import type { RestoreRule } from './contract'
import { BACKUPS_DIRNAME, DATABASE_FILE, RECOVERY_DIRNAME, familyOf } from './layout'

/**
 * Every name the app writes directly in its data folder, sorted into the state a checkpoint copies
 * beside the database and everything else, each with the reason. A test reads the source for every
 * name joined to the data folder and fails on one in neither list, so a new state file needs a
 * decision here before it can ship.
 */

export interface AppStateFile {
  readonly name: string
  readonly kind?: 'tree'
  /**
   * `with-the-database`: a restore installs the checkpoint's copy with the database and sets the
   * live one aside with the newer database. `kept-current`: copied too, but a restore leaves the
   * live one as it is.
   */
  readonly restore: RestoreRule
  readonly why: string
}

export interface NotState {
  /** A top-level name; `*` stands for any run of characters. */
  readonly name: string
  readonly why: string
}

export const SKILL_CATALOGUE_RECOVERY = {
  tables: SKILL_CATALOGUE_TABLES,
  restore: 'with-the-database',
  why: 'Skill source versions, current pointers and agent choices restore together in SQLite; generated provider views are not backup state.',
} as const

export const APP_STATE_FILES: readonly AppStateFile[] = [
  {
    name: 'skills',
    kind: 'tree',
    restore: 'with-the-database',
    why: 'The shared writable skill folders, including their supporting files.',
  },
  {
    name: 'skills-off',
    kind: 'tree',
    restore: 'with-the-database',
    why: 'Shared skills turned off, kept whole so they can be turned on again.',
  },
  {
    name: 'skills-conversion.json',
    restore: 'with-the-database',
    why: 'Import receipts prevent later launches from overwriting edits or recreating deletions.',
  },
  {
    name: 'transcript-retention.json',
    restore: 'kept-current',
    why: 'The retention choice and record of files already cleared, which a database restore must not rewind.',
  },
  {
    name: 'active-theme.json',
    restore: 'kept-current',
    why: "The workspace's current theme, which a database restore must not rewind.",
  },
  {
    name: 'dock-label.json',
    restore: 'kept-current',
    why: "The workspace's name and colour on the Dock icon, a choice a database restore must not rewind.",
  },
  {
    name: 'drafts.json',
    restore: 'with-the-database',
    why: 'Its unsent drafts name conversations in the database.',
  },
  {
    name: 'archived.json',
    restore: 'with-the-database',
    why: 'The conversations a person archived, named by their rows in the database.',
  },
  {
    name: 'sign-in-changes.json',
    restore: 'kept-current',
    why:
      "When this computer's sign-ins last changed is a fact about now; an older copy would let " +
      'usage figures from an earlier account count as current.',
  },
  {
    name: 'provider-usage.json',
    restore: 'kept-current',
    why:
      "Each provider account's usage as last reported, read again at the next turn; an older " +
      'copy would show stale usage as current.',
  },
  {
    name: 'schedule-attempts.json',
    restore: 'kept-current',
    why:
      'The starts this app already made for scheduled jobs, and the notices it already handed ' +
      'over, are facts about what it did; an older copy would make a start, or tell a ' +
      'conversation, a second time.',
  },
  {
    name: 'profile-execution.json',
    restore: 'with-the-database',
    why:
      "Each profile's service conversation or normal worker pools, named by their rows in " +
      'the database.',
  },
  {
    name: 'workspace.json',
    restore: 'kept-current',
    why: "The workspace's name, which must stay the same as in this computer's list of workspaces.",
  },
  {
    name: 'update-settings.json',
    restore: 'kept-current',
    why: "A hidden launch's update settings, which belong to this app and not to the workspace's history.",
  },
  {
    name: 'workspaces.json',
    restore: 'kept-current',
    why: "A hidden launch's list of workspaces, which belongs to this app and not to the workspace's history.",
  },
]

export const NOT_STATE: readonly NotState[] = [
  {
    name: 'themes',
    why: "A hidden launch's themes library, which a database restore must not rewind.",
  },
  ...familyOf(DATABASE_FILE).map((name) => ({
    name,
    why: 'The database itself, which a checkpoint copies on its own.',
  })),
  {
    name: 'exports',
    why: "The person's own exported conversations, which a restore must not rewind.",
  },
  {
    name: 'brobot-workspace',
    why: "The agents' default working folder and the person's files in it, which a restore must not rewind.",
  },
  {
    name: 'worker-output',
    why: "A person's results written for parallel pieces, which a restore must not rewind.",
  },
  {
    name: 'resources',
    why:
      'Files kept for pieces of work, named by their content and never changed, so an older ' +
      'database still finds its bytes.',
  },
  {
    // The folder's name is spelled only in its own module.
    name: PROVIDER_HOMES_DIRNAME,
    why: "Each provider's own folders, which hold its sign-in and its own transcripts; never copied or restored.",
  },
  {
    name: 'provider-accounts.json',
    why:
      'The Claude account this computer was last signed in to, with its email, which is kept in ' +
      'this one file and never copied; the next Claude conversation names it again.',
  },
  {
    name: 'turns-the-app-cut.json',
    why:
      'The turns that were cut while they ran, and what the app did about each: about those runs, ' +
      'not the data; never copied or restored.',
  },
  {
    name: 'start-attempts*.jsonl',
    why:
      "Each launch's timing, kept for diagnosing a slow start: about those launches, not the " +
      'data; never copied or restored, and a reset may drop it.',
  },
  { name: 'updates', why: 'Downloaded updates and their private staging files, not state.' },
  { name: 'one-host.sock', why: 'The live socket that keeps one app on this folder.' },
  {
    name: '.oh-*',
    why: 'The private socket name used while claiming one-host.sock, removed at once.',
  },
  { name: BACKUPS_DIRNAME, why: "The workspace's own recovery copies." },
  {
    name: RECOVERY_DIRNAME,
    why: 'The records of a restore or a return, and the database a restore set aside.',
  },
]
