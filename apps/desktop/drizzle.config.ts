import { defineConfig } from 'drizzle-kit'

// Offline schema → migration generation. `pnpm run db:generate` writes committed SQL + metadata
// under src/main/db/migrations. The packaged app never runs drizzle-kit push (002
// recommendation); it applies committed SQL.
//
// ⛔ **`pnpm run db:generate` and not this package's script** — 522. drizzle-kit stamps the new
// journal entry `when: +new Date()`, this repository's stamps have been hand-spaced since `0019`
// and now run ahead of the wall clock, and `drizzle-orm` applies a file only while
// `lastDbMigration.created_at < when`. ⚠️ So the raw generator writes a migration that is skipped
// in silence on every already-migrated database. `scripts/db-generate.mjs` runs this config and
// then corrects that one number; the script here is deliberately named `db:generate:unstamped`
// because that is what it produces.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/main/db/schema.ts',
  out: './src/main/db/migrations',
})
