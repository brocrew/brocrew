import { expect, it, vi } from 'vitest'
import type { AppDatabase } from '../../src/main/db/connection'
import type { SessionStore } from '../../src/main/db/session-store'
import type { RuntimeHost } from '../../src/main/runtime/runtime-host'
import type { ReconciliationPiece } from '../../src/main/runtime/work-reconciliation'

/** Count executed read statements, including those prepared before a control begins. */
export function countSqlReads(database: AppDatabase, read: (sql: string) => void): AppDatabase {
  return new Proxy(database, {
    get(target, property) {
      if (property === 'prepare')
        return (sql: string) => {
          const statement = target.prepare(sql)
          const wrapped: typeof statement = new Proxy(statement, {
            get(prepared, method) {
              const value = Reflect.get(prepared, method, prepared) as unknown
              if (typeof value !== 'function') return value
              return (...args: unknown[]) => {
                if (method === 'get' || method === 'all' || method === 'iterate') read(sql)
                const result = Reflect.apply(value, prepared, args)
                return result === prepared ? wrapped : result
              }
            },
          })
          return wrapped
        }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

/** Long enough for every pump and every flush a row arms to have run. */
export async function settle(): Promise<void> {
  for (let round = 0; round < 2; round++) {
    for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
}

interface WaitRevisionContext {
  host(): RuntimeHost
  replaceHost(value: RuntimeHost): void
  freezeClock(): void
  create(): Promise<{ owner: string; work: { piece: string } }>
  waiting(owner: string, piece: string, on?: Record<string, unknown>): void
  store(): SessionStore
  build(): RuntimeHost
}

export function registerPersistedWaitRevisionCase({
  host,
  replaceHost,
  freezeClock,
  create,
  waiting,
  store,
  build,
}: WaitRevisionContext): void {
  it('uses the persisted wait event revision across restart and distinguishes waits at the same time', async () => {
    type Reading = {
      reconcileWork(): void
      reconciliationReading(): { rows: ReconciliationPiece[] }
    }
    vi.spyOn(host() as unknown as Reading, 'reconcileWork').mockImplementation(() => {})
    const { owner, work } = await create()
    freezeClock()
    waiting(owner, work.piece, { kind: 'agent', piece: 'missing-first', label: 'W99.1' })
    const key = () =>
      (host() as unknown as Reading)
        .reconciliationReading()
        .rows.find((row) => row.piece === work.piece)?.issue?.waitKey
    const first = key()
    expect(first).toBe(
      `${owner}:${store().theActiveGeneration(owner)}:${store().rootLines(work.piece).statusLine!.revision}`,
    )
    await host().closeAll()
    replaceHost(build())
    vi.spyOn(host() as unknown as Reading, 'reconcileWork').mockImplementation(() => {})
    expect(key()).toBe(first)
    const at = store().rootLines(work.piece).statusLine!.at
    waiting(owner, work.piece, { kind: 'agent', piece: 'missing-second', label: 'W99.2' })
    expect(store().rootLines(work.piece).statusLine!.at).toBe(at)
    expect(key()).toBeDefined()
    expect(key()).not.toBe(first)
  })
}
