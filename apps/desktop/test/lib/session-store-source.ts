import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DB = join(dirname(fileURLToPath(import.meta.url)), '../../src/main/db')

/** The session store's source: session-store.ts and every file in session-store-parts/, joined. */
export function sessionStoreSource(): string {
  return [
    'session-store.ts',
    ...readdirSync(join(DB, 'session-store-parts')).map((file) => `session-store-parts/${file}`),
  ]
    .map((file) => readFileSync(join(DB, file), 'utf8'))
    .join('\n')
}
