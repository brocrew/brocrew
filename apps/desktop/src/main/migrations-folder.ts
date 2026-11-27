import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function resolveMigrationsFolder(): string {
  const candidates = [
    join(__dirname, 'migrations'),
    join(app.getAppPath(), 'out/main/migrations'),
    join(app.getAppPath(), 'src/main/db/migrations'),
  ]
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'meta', '_journal.json'))) return candidate
  }
  throw new Error(`Could not locate Drizzle migrations. Looked in:\n  ${candidates.join('\n  ')}`)
}
