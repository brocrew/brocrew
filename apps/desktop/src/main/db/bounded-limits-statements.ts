import type { AppDatabase, AppStatement } from './connection'
import { LIMITS_READ_BOUNDS, LimitsReadUnavailable } from './limits-read-protocol'

export interface LimitsReadBounds {
  readonly rows: number
  readonly bytes: number
  readonly cellBytes: number
}

/** Counts every returned row before it can enter a canonical reader's array. */
export class LimitsMaterialization {
  private failed = false
  private rows = 0
  private bytes = 0
  private statements = 0

  constructor(readonly bounds: LimitsReadBounds = LIMITS_READ_BOUNDS) {
    for (const value of Object.values(bounds)) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError('Invalid reading bound')
    }
  }

  assert(): void {
    if (this.failed) throw new LimitsReadUnavailable('overflow')
  }

  overflow(): never {
    this.failed = true
    throw new LimitsReadUnavailable('overflow')
  }

  measured() {
    return { rows: this.rows, bytes: this.bytes, statements: this.statements }
  }

  database(db: AppDatabase): AppDatabase {
    return new Proxy(db, {
      get: (target, property) => {
        if (property === 'prepare') return (sql: string) => this.statement(db, sql)
        const value = Reflect.get(target, property, target) as unknown
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  }

  private statement(db: AppDatabase, sql: string): AppStatement {
    const original = db.prepare(sql)
    let guarded: AppStatement | undefined
    const rows = (args: unknown[]): Iterable<Record<string, unknown>> => {
      this.assert()
      if (!original.reader) throw new LimitsReadUnavailable('failed')
      if (guarded === undefined) {
        const names = original.columns().map((column) => column.name)
        if (new Set(names).size !== names.length || names.includes('__limits_wide'))
          throw new LimitsReadUnavailable('failed')
        const quote = (name: string) => `"${name.replaceAll('"', '""')}"`
        const wide = (name: string) =>
          `(typeof(_limits.${quote(name)}) IN ('text', 'blob') AND octet_length(_limits.${quote(name)}) > ${this.bounds.cellBytes})`
        const select = names.map(
          (name) =>
            `CASE WHEN ${wide(name)} THEN NULL ELSE _limits.${quote(name)} END AS ${quote(name)}`,
        )
        guarded = db.prepare(
          `SELECT ${select.join(', ')}, (${names.map(wide).join(' OR ') || '0'}) AS __limits_wide FROM (${sql.trim().replace(/;$/, '')}) _limits`,
        )
      }
      this.statements++
      const iterator = guarded.iterate(...args) as Iterable<Record<string, unknown>>
      return this.countRows(iterator)
    }
    return new Proxy(original, {
      get(target, property) {
        if (property === 'all') return (...args: unknown[]) => Array.from(rows(args))
        if (property === 'iterate') return (...args: unknown[]) => rows(args)
        if (property === 'get')
          return (...args: unknown[]) => {
            for (const row of rows(args)) return row
            return undefined
          }
        if (property === 'run')
          return () => {
            throw new LimitsReadUnavailable('failed')
          }
        const value = Reflect.get(target, property, target) as unknown
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  }

  private *countRows(iterator: Iterable<Record<string, unknown>>) {
    for (const row of iterator) {
      if (row.__limits_wide) this.overflow()
      delete row.__limits_wide
      this.rows++
      for (const [key, value] of Object.entries(row)) {
        this.bytes += Buffer.byteLength(key, 'utf8') + 16
        if (typeof value === 'string') this.bytes += Buffer.byteLength(value, 'utf8')
        else if (value instanceof Uint8Array) this.bytes += value.byteLength
      }
      if (this.rows > this.bounds.rows || this.bytes > this.bounds.bytes) this.overflow()
      yield row
    }
  }
}
