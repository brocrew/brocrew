import { expect, it, vi } from 'vitest'
import type { WindowStoreReader } from '../../src/main/db/window-read-protocol'
import type { TranscriptEvent } from '../../src/shared/conversation-events'
import type { ReconciliationReceipt } from '../../src/shared/reconciliation-contracts'
import { waitFor } from '../lib/f093-host'
import { deferred } from './quit-open-list-cases'
import type { WindowReadEngine } from '../../src/main/db/window-read-engine'
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

interface PersistedWaitContext {
  host(): RuntimeHost
  replaceHost(value: RuntimeHost): void
  freezeClock(): void
  create(): Promise<{ owner: string; work: { piece: string; label: string } }>
  waiting(owner: string, piece: string, on?: Record<string, unknown>): void
  store(): SessionStore
  build(reader?: WindowStoreReader): RuntimeHost
  openReconciliationReader(): WindowReadEngine
  holdStartup(): void
  now(): number
  advanceTo(at: number): void
  cycle(): Promise<void>
  notices(owner: string): readonly { event: TranscriptEvent }[]
  receipts(owner: string, piece: string): readonly ReconciliationReceipt[]
}

export function registerPersistedWaitCases({
  host,
  replaceHost,
  freezeClock,
  create,
  waiting,
  store,
  build,
  openReconciliationReader,
  holdStartup,
  now,
  advanceTo,
  cycle,
  notices,
  receipts,
}: PersistedWaitContext): void {
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

  it('a future time is untouched; the 60 s tick wakes a due root once and turn end lists it', async () => {
    const { owner, work } = await create()
    const at = now() + 3_600_000
    waiting(owner, work.piece, { kind: 'time', at })
    await cycle()
    expect(notices(owner)).toHaveLength(0)
    advanceTo(at)
    await cycle()
    await waitFor(
      () => receipts(owner, work.piece).some((one) => one.step === 'person'),
      'the reminded turn to finish',
    )
    expect(notices(owner)).toHaveLength(1)
    const queued = notices(owner)[0]!.event
    expect(queued).toMatchObject({
      text: `${work.label}: the time it was waiting for has come. Carry on with it, or say what it waits on now with update_work (on).`,
    })
    expect(host().workIncidentsForAPerson()).toMatchObject({
      walk: 'every-conversation-that-holds-work',
      rows: [
        { piece: work.piece, kind: 'wait-target-ended', told: { holder: expect.any(Number) } },
      ],
    })
    await cycle()
    expect(notices(owner)).toHaveLength(1)
  })

  it('reads the current wait once when a commit overtakes the worker reply', async () => {
    await host().closeAll()
    holdStartup()
    const engine = openReconciliationReader()
    const reply = deferred()
    const captured = deferred()
    const read = vi.fn<WindowStoreReader['read']>(async (query) => {
      const result = engine.read(query)
      captured.resolve()
      await reply.promise
      return result
    })
    replaceHost(build({ read, close: async () => engine.close() }))
    const reconciliation = host() as unknown as {
      reconcileWork(): void
      reconciliationPiecesForHolders(
        holders: ReadonlySet<string>,
        snapshot?: unknown,
      ): readonly ReconciliationPiece[]
      workReconciler: { run(holders: ReadonlySet<string>): Promise<void> }
    }
    vi.spyOn(reconciliation, 'reconcileWork').mockImplementation(() => {})
    const { owner, work } = await create()
    await settle()
    waiting(owner, work.piece, { kind: 'time', at: now() - 1 })
    const holders = new Set([owner])
    expect(reconciliation.reconciliationPiecesForHolders(holders)).toMatchObject([
      { piece: work.piece, issue: { kind: 'wait-target-ended' } },
    ])
    const pieces = vi.spyOn(reconciliation, 'reconciliationPiecesForHolders')
    const pass = reconciliation.workReconciler.run(holders)
    try {
      await Promise.race([captured.promise, pass])
      expect(read).toHaveBeenCalledExactlyOnceWith({
        kind: 'reconciliation-folds',
        holders: [owner],
      })
      waiting(owner, work.piece, { kind: 'time', at: now() + 3_600_000 })
    } finally {
      reply.resolve()
      await pass
    }
    expect(pieces).toHaveBeenCalledExactlyOnceWith(holders)
    expect(receipts(owner, work.piece)).toEqual([])
    expect(notices(owner)).toEqual([])
  })
}
