import Database from 'better-sqlite3'
import { expect, it } from 'vitest'
import { inspect, type CoordinatorDeps } from '../../../src/main/recovery/coordinator'
import { databaseFile } from '../../../src/main/recovery/layout'
import { BUILD_LINEAGE, THIS_BUILD, THIS_VERSION, type RecoveryFixtureOptions } from './recovery-fixture'

export function registerMigrationLineageCases({ aWorkspace, checkOf, treeOf }: {
  aWorkspace(options: RecoveryFixtureOptions): Promise<string>
  checkOf(userData: string, over?: Partial<CoordinatorDeps>): { readonly deps: CoordinatorDeps }
  treeOf(dir: string): Promise<Record<string, string>>
}): void {
  it.each(['time', 'hash'] as const)(
    'names the differing migration %s and available build without opening it',
    async (field) => {
      const userData = await aWorkspace({ migrations: THIS_BUILD, checkpoints: [] })
      const db = new Database(databaseFile(userData))
      if (field === 'time')
        db.prepare(
          'UPDATE __drizzle_migrations SET created_at = created_at - 1 WHERE created_at = (SELECT min(created_at) FROM __drizzle_migrations)',
        ).run()
      else
        db.prepare(
          'UPDATE __drizzle_migrations SET hash = ? WHERE created_at = (SELECT min(created_at) FROM __drizzle_migrations)',
        ).run('f'.repeat(64))
      const recorded = db
        .prepare('SELECT created_at, hash FROM __drizzle_migrations ORDER BY created_at LIMIT 1')
        .get() as { created_at: number; hash: string }
      db.close()
      const before = await treeOf(userData)
      const build = field === 'time' ? 'a'.repeat(40) : null
      const verdict = await inspect(checkOf(userData, { build }).deps)
      expect(verdict).toMatchObject({
        kind: 'failed',
        reason: 'database-unreadable',
        canRetry: false,
      })
      if (verdict.kind !== 'failed') throw new Error('expected incompatible lineage')
      expect(verdict.detail).toContain(databaseFile(userData))
      expect(verdict.detail).toContain(
        `migration 1 records time ${recorded.created_at} and hash ${recorded.hash}`,
      )
      expect(verdict.detail).toContain(`BroCrew ${THIS_VERSION}${build ? ` (${build})` : ''}`)
      expect(verdict.detail).toContain(`expects time ${BUILD_LINEAGE[0]}`)
      expect(verdict.detail).not.toContain('no version')
      expect(verdict.detail).not.toContain('foreign')
      expect(await treeOf(userData)).toEqual(before)
    },
  )

}
