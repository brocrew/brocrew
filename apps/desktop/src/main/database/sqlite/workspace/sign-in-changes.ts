import type { Provider } from '@brobot2/shared'
import type { AppDatabase } from '../../../db/connection'

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
