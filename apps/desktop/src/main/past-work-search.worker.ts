import Database from 'better-sqlite3'
import { parentPort, workerData } from 'node:worker_threads'
import { z } from 'zod'
import { createSessionStore } from './db/session-store'
import { searchPastWork } from './db/past-work-search'

const request = z
  .object({
    id: z.number().int().positive(),
    caller: z.string().min(1).max(200),
    words: z.string().max(200),
    source: z
      .object({
        file: z.string().min(1),
        profile: z.string().min(1).max(200),
        externalVersion: z.number().int(),
        versions: z.array(z.tuple([z.string().max(200), z.number().int()])).max(10000),
      })
      .strict(),
  })
  .strict()

if (parentPort !== null) {
  const port = parentPort
  const file = z
    .object({ file: z.string().min(1) })
    .strict()
    .parse(workerData).file
  const db = new Database(file, { readonly: true, fileMustExist: true, timeout: 1000 })
  db.pragma('cache_size = -4096')
  const store = createSessionStore(db)
  port.on('message', (value: unknown) => {
    const parsed = request.safeParse(value)
    if (!parsed.success || parsed.data.source.file !== file) {
      port.postMessage({
        id: typeof value === 'object' && value !== null && 'id' in value ? value.id : null,
        result: { ok: false, reason: 'unavailable' },
      })
      return
    }
    const { id, source, caller, words } = parsed.data
    port.postMessage({ id, result: searchPastWork(db, store, caller, words, source) })
  })
  port.once('close', () => {
    store.closePastWorkSearch()
    db.close()
  })
}
