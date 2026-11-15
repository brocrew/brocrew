import { vi } from 'vitest'
import type { AppDatabase } from '../../src/main/db/connection'

const generationSql =
  'SELECT active, normalizer_version, derived_through, building, highest, failure FROM derived_generation WHERE session_id = ?'

export function observeGenerationReads(db: AppDatabase) {
  const generations: string[] = []
  const newest: string[] = []
  let failGeneration = false
  let failNewest = false
  const prepare = db.prepare.bind(db)
  vi.spyOn(db, 'prepare').mockImplementation((sql) => {
    const statement = prepare(sql)
    const generation = sql.replace(/\s+/g, ' ').trim() === generationSql
    const head = sql.includes('SELECT max(ordinal) AS through')
    if (!generation && !head) return statement
    return new Proxy(statement, {
      get(native, key) {
        if (key === 'get')
          return (...args: unknown[]) => {
            if (generation) {
              generations.push(String(args[0]))
              if (failGeneration) {
                failGeneration = false
                throw new Error('Fictional generation read failed')
              }
            } else {
              newest.push(String(args[0]))
              if (failNewest) {
                failNewest = false
                throw new Error('Fictional newest read failed')
              }
            }
            return native.get(...args)
          }
        const value: unknown = Reflect.get(native, key, native)
        return typeof value === 'function' ? value.bind(native) : value
      },
    })
  })
  return {
    generations,
    newest,
    failNextGeneration: () => {
      failGeneration = true
    },
    failNextNewest: () => {
      failNewest = true
    },
  }
}
