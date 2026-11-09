import { join } from 'node:path'
import { SUPPORTED_PROVIDERS, type Provider } from '@brobot2/shared'
import type { AppDatabase } from './db/connection'
import { importSideFile, objectIn } from './db/side-file-import'

/** The file older builds kept these moments in, imported once into `sign_in_change`. */
export const SIGN_IN_CHANGES_FILE = 'sign-in-changes.json'

/** When this app last saw each provider's sign-in change, epoch ms (`RuntimeHost.aSignInChanged`). */
export interface SignInChanges {
  /** Each provider's last noted change; empty when none was. */
  read(): ReadonlyMap<Provider, number>
  /** Keep these moments, whole. Throws when they cannot be written; the caller says so. */
  write(changed: ReadonlyMap<Provider, number>): void
}

const INSERT = 'INSERT OR REPLACE INTO sign_in_change (provider, changed_at) VALUES (?, ?)'

export function signInChangesIn(database: AppDatabase): SignInChanges {
  const all = database.prepare('SELECT provider, changed_at AS at FROM sign_in_change')
  const clear = database.prepare('DELETE FROM sign_in_change')
  const insert = database.prepare(INSERT)
  return {
    read: () =>
      new Map((all.all() as { provider: Provider; at: number }[]).map((r) => [r.provider, r.at])),
    write: database.transaction((changed: ReadonlyMap<Provider, number>) => {
      clear.run()
      for (const [provider, at] of changed) insert.run(provider, at)
    }),
  }
}

/** Imports `sign-in-changes.json` (`{version, changed: {provider: at}}`) from `userData`, once. */
export function importSignInChangesFile(database: AppDatabase, userData: string): void {
  importSideFile(database, join(userData, SIGN_IN_CHANGES_FILE), (said) => {
    const insert = database.prepare(INSERT)
    const changed = objectIn(objectIn(said)['changed'])
    for (const provider of SUPPORTED_PROVIDERS) {
      const at = changed[provider]
      if (typeof at === 'number' && Number.isFinite(at) && at > 0) insert.run(provider, at)
    }
  })
}
