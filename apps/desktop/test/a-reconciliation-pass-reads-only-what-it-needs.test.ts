import { aWorkWaitFixture } from './helpers/work-wait-fixture'
import { waitFor } from './lib/f093-host'
import { settle } from './helpers/persisted-wait-revision-cases'
import type {
  ReconciliationReceipt,
  WorkReconciliationEvent,
} from '../src/shared/reconciliation-contracts'
import { writeFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { ReconciliationPiece } from '../src/main/runtime/work-reconciliation'

describe('a work wait is reconciled without a window', () => {
  const f = aWorkWaitFixture()
  const { create, cycle, giveToNewWorker, receipts, record, tick, waiting, window } = f

  it('a quiet pass reads no names and several notices share one narrow names read', async () => {
    f.keepTurnsOpen = true
    const reading = f.host as unknown as {
      reconcileWork(): void
      reconciliationReading(): { rows: ReconciliationPiece[] }
      reconciliationWords(piece: ReconciliationPiece, receipt: ReconciliationReceipt): string
      workReconciler: { run(): Promise<void> }
      slots: Map<
        string,
        { session: { handle: { machine: { completeTurn(state: 'completed'): void } } } }
      >
    }
    vi.spyOn(reading, 'reconcileWork').mockImplementation(() => {})
    const { owner } = await create()
    const namesRead = vi.spyOn(f.store, 'reconciliationNames')
    f.sqlReads = []
    await reading.workReconciler.run()
    const quietReads = f.sqlReads
    f.sqlReads = null
    expect(namesRead).not.toHaveBeenCalled()
    expect(quietReads.filter((sql) => sql.includes('s.id AS conversation'))).toEqual([])

    const { sessionId: grace } = await f.host.createSession(
      { provider: 'claude', profileId: 'fictional-grace', approvalMode: 'auto', cwd: f.root },
      window,
    )
    expect(await f.host.setAgentDisplayName('fictional-grace', 'Grace')).not.toBeNull()
    await f.host.close(grace, window)
    const children: { holder: string; piece: string }[] = []
    for (let n = 0; n < 3; n++) {
      const result = (
        await giveToNewWorker(owner, {
          profile: `fictional-worker-${n}`,
          title: `Fictional piece ${n}`,
          brief: 'Produce a checked result.',
          definition_of_done: 'The result is checked.',
        })
      ).structured as { outcome: string; agent: string; piece: string }
      expect(result.outcome).toBe('ok')
      const holder = result.agent
      await waitFor(() => f.store.theOpenTurn(holder) !== null, 'the worker turn')
      const asker = n === 2 ? owner : grace
      record(holder, { type: 'work_interrupted', by: 'an-agent', agent: asker })
      reading.slots.get(holder)!.session.handle.machine.completeTurn('completed')
      children.push({ holder, piece: result.piece })
    }
    await waitFor(
      () =>
        children.every(({ holder, piece }) =>
          f.store
            .piecesOwnedBy(holder)
            .some((one) => one.piece === piece && one.stalledBecause === 'turn_ended'),
        ),
      'the completed turns and their existing asker folds',
    )
    const pieceIds = new Set(children.map((one) => one.piece))
    const pass = reading.reconciliationReading().rows.filter((row) => pieceIds.has(row.piece))
    expect(pass).toHaveLength(3)
    expect(namesRead).not.toHaveBeenCalled()
    const lines: string[] = []
    f.sqlReads = []
    for (const piece of pass) {
      for (const step of ['holder', 'giver'] as const) {
        lines.push(
          reading.reconciliationWords(piece, {
            type: 'work_reconciliation',
            incident: `fictional-${piece.piece}`,
            piece: piece.piece,
            kind: 'stopped',
            cause: 'turn_ended',
            since: tick(),
            at: tick(),
            step,
            outcome: 'planned',
            target: step === 'holder' ? piece.holder : owner,
            messageId: `fictional-${step}-${piece.piece}`,
          }),
        )
      }
    }
    const composedReads = f.sqlReads
    f.sqlReads = null
    expect(namesRead).toHaveBeenCalledTimes(1)
    expect(composedReads).toHaveLength(1)
    expect(composedReads[0]).toContain('s.id IN (SELECT value FROM json_each(?))')
    expect(new Set(namesRead.mock.calls[0]![0])).toEqual(
      new Set([owner, grace, ...children.map((one) => one.holder)]),
    )
    expect(lines).toHaveLength(6)
    expect(lines.filter((line) => line.includes('by Grace'))).toHaveLength(4)
    expect(lines.some((line) => line.includes('you asked it to stop'))).toBe(true)
    expect(lines.every((line) => !line.includes('(the owner of'))).toBe(true)

    expect(await f.host.setAgentDisplayName('fictional-grace', 'Gina')).not.toBeNull()
    const fresh = reading
      .reconciliationReading()
      .rows.find((row) => pieceIds.has(row.piece) && row.stalledBy?.asker === grace)!
    f.sqlReads = []
    const renamed = reading.reconciliationWords(fresh, {
      type: 'work_reconciliation',
      incident: 'fictional-renamed',
      piece: fresh.piece,
      kind: 'stopped',
      cause: 'turn_ended',
      since: tick(),
      at: tick(),
      step: 'giver',
      outcome: 'planned',
      target: owner,
      messageId: 'fictional-renamed-message',
    })
    expect(f.sqlReads).toHaveLength(1)
    f.sqlReads = null
    expect(renamed).toContain('by Gina')
    expect(renamed).not.toContain('Grace')
  })

  it('a working piece with a failed holder receipt names its holder in the giver notice', async () => {
    f.keepTurnsOpen = true
    const reading = f.host as unknown as {
      reconcileWork(): void
      reconciliationReading(): { rows: ReconciliationPiece[] }
      reconciliationWords(piece: ReconciliationPiece, receipt: ReconciliationReceipt): string
      deliverReconciliation(
        piece: ReconciliationPiece,
        receipt: ReconciliationReceipt,
      ): Promise<boolean>
      workReconciler: { run(holders?: ReadonlySet<string>): Promise<void> }
    }
    vi.spyOn(reading, 'reconcileWork').mockImplementation(() => {})
    const { owner } = await create()
    const given = (
      await giveToNewWorker(owner, {
        profile: 'fictional-known-holder',
        title: 'Fictional resumed work',
        brief: 'Check the result.',
        definition_of_done: 'A checked result.',
      })
    ).structured as { agent: string; piece: string }
    expect(await f.host.setAgentDisplayName('fictional-known-holder', 'Bob')).not.toBeNull()
    await waitFor(() => f.store.theOpenTurn(given.agent) !== null, 'the resumed holder turn')
    record(given.agent, {
      type: 'work_reconciliation',
      incident: 'fictional-existing-incident',
      piece: given.piece,
      kind: 'stopped',
      cause: 'turn_ended',
      since: tick(),
      step: 'holder',
      outcome: 'failed',
      target: given.agent,
      messageId: 'fictional-failed-reminder',
    })
    const namesRead = vi.spyOn(f.store, 'reconciliationNames')
    const row = reading.reconciliationReading().rows.find((one) => one.piece === given.piece)!
    expect(row).toMatchObject({ disposition: 'working', issue: null })
    expect(namesRead).not.toHaveBeenCalled()
    const lines: string[] = []
    const deliveries = vi
      .spyOn(reading, 'deliverReconciliation')
      .mockImplementation(async (piece, receipt) => {
        expect(receipt.step).toBe('giver')
        f.sqlReads = []
        lines.push(reading.reconciliationWords(piece, receipt))
        const compositionReads = f.sqlReads
        f.sqlReads = null
        expect(compositionReads).toHaveLength(1)
        expect(compositionReads[0]).toContain('s.id AS conversation')
        return true
      })
    await reading.workReconciler.run(new Set([given.agent]))
    await settle()
    expect(deliveries).toHaveBeenCalledTimes(1)
    expect(receipts(given.agent, given.piece)).toContainEqual(
      expect.objectContaining({
        step: 'giver',
        target: owner,
        outcome: 'delivered',
      }),
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain("Bob didn't settle it after a reminder")
    expect(lines[0]).not.toContain('an agent this app cannot name')
    expect(namesRead).toHaveBeenCalledTimes(1)
    expect(new Set(namesRead.mock.calls[0]![0])).toEqual(new Set([given.agent, owner]))
  })

  it('writes verify only the changed piece receipts and never reread the owner history', async () => {
    const { owner, work } = await create()
    await settle()
    const history = vi.spyOn(f.store, 'reconciliationReceiptsForOwner')
    const point = vi.spyOn(f.store, 'reconciliationReceipts')
    waiting(owner, work.piece)
    await cycle()
    expect(receipts(owner, work.piece).length).toBeGreaterThan(0)
    expect(history).not.toHaveBeenCalled()
    expect(
      point.mock.calls.every(([holder, piece]) => holder === owner && piece === work.piece),
    ).toBe(true)
  })

  it('indexed receipt reads keep generations and reject unread history', async () => {
    const { owner, work } = await create()
    const row: WorkReconciliationEvent = {
      type: 'work_reconciliation',
      incident: 'old',
      piece: work.piece,
      kind: 'wait-target-ended',
      since: f.clock,
      step: 'person',
      outcome: 'listed',
    }
    record(owner, row)
    record(owner, { ...row, incident: 'other', piece: 'another-piece' })
    expect(receipts(owner, work.piece).map((one) => one.incident)).toEqual(['old'])
    const insert = f.db.prepare(
      'INSERT INTO events (id,session_id,generation,ordinal,type,payload,created_at) VALUES (?,?,?,?,?,?,?)',
    )
    insert.run(
      'next-generation',
      owner,
      1,
      0,
      'work_reconciliation',
      JSON.stringify({ ...row, incident: 'next' }),
      tick(),
    )
    expect(receipts(owner, work.piece).map((one) => one.incident)).toEqual(['old', 'next'])
    insert.run(
      'torn-receipt',
      owner,
      0,
      f.store.nextOrdinal(owner),
      'work_reconciliation',
      '{',
      tick(),
    )
    expect(() => receipts(owner, work.piece)).toThrow('could not be read')
  })

  it('receipt reads use only the open pieces instead of the owner history', async () => {
    const { owner, work } = await create()
    await settle()
    waiting(owner, work.piece, { kind: 'time', at: f.clock + 3_600_000 })
    const point = vi.spyOn(f.store, 'reconciliationReceipts')
    const batch = vi.spyOn(f.store, 'reconciliationReceiptsForOwner')
    await (
      f.host as unknown as { workReconciler: { run(owners: ReadonlySet<string>): Promise<void> } }
    ).workReconciler.run(new Set([owner]))
    expect(point).toHaveBeenCalledTimes(1)
    expect(point).toHaveBeenCalledWith(owner, work.piece)
    expect(batch).not.toHaveBeenCalled()
  })

  it('a turn ending reconciles its touched holder without enumerating the whole roster', async () => {
    const { owner } = await create()
    await settle()
    const roster = vi.spyOn(f.store, 'reconciliationOwners')
    await f.host.send(owner, 'A fictional ordinary turn.', window)
    await settle()
    expect(roster).not.toHaveBeenCalled()
  })

  it.runIf(process.env['W671_RECONCILIATION_BENCH'] !== undefined)(
    'measures the same 5000-ended 50-open 100000-event ledger',
    async () => {
      const { db, store } = f
      const { owner, work } = await create()
      clearInterval(
        (f.host as unknown as { reconciliationTimer: ReturnType<typeof setInterval> })
          .reconciliationTimer,
      )
      let ordinal = store.nextOrdinal(owner)
      db.transaction(() => {
        for (let i = 1; i <= 5050; i++) {
          const piece = `bench-${i}`
          store.recordGive(
            {
              piece,
              parent: work.piece,
              number: i,
              owner,
              givenBy: null,
              title: piece,
              brief: 'Fictional performance work.',
              folder: null,
              inputs: [],
            },
            ordinal++,
            {
              type: 'work_given',
              piece,
              label: `${work.label}.${i}`,
              parent: work.piece,
              givenBy: null,
              title: piece,
              brief: 'Fictional performance work.',
            },
            tick(),
          )
          store.append(
            owner,
            ordinal++,
            i <= 5000
              ? {
                  type: 'work_replied',
                  piece,
                  outcome: 'done',
                  summary: 'Checked.',
                  resources: [],
                }
              : {
                  type: 'work_status_set',
                  piece,
                  line: 'Until tomorrow',
                  by: owner,
                  waiting: true,
                  on: { kind: 'time', at: f.clock + 86_400_000 },
                },
            tick(),
          )
        }
        const count = (db.prepare('SELECT count(*) AS n FROM events').get() as { n: number }).n
        for (let i = count; i < 100000; i++)
          store.append(
            owner,
            ordinal++,
            {
              type: 'memory_note',
              notes: [{ path: '/fictional/notes/benchmark.md', bytes: 0 }],
            },
            tick(),
          )
      })()
      const engine = (
        f.host as unknown as {
          workReconciler: { run(owners?: ReadonlySet<string>): Promise<void> }
        }
      ).workReconciler
      const trace: Record<string, { calls: number; ms: number }> = {}
      if (process.env['W671_PROFILE']) {
        const scope = store as unknown as Record<string, (...args: unknown[]) => unknown>
        for (const name of [
          'reconciliationWork',
          'openPiecesOf',
          'piecesOwnedBy',
          'turnBlockRootLines',
          'rootLines',
          'routedRequestsOf',
          'questionsRaisedIn',
          'piecesGivenBy',
          'messagesWaitingIn',
          'reconciliationRecovery',
          'reconciliationReceiptsForOwner',
        ]) {
          const original = scope[name]
          if (original === undefined) continue
          scope[name] = (...args) => {
            const began = performance.now()
            try {
              return original.apply(store, args)
            } finally {
              const entry = trace[name] ?? { calls: 0, ms: 0 }
              entry.calls++
              entry.ms += performance.now() - began
              trace[name] = entry
            }
          }
        }
      }
      const sample = async (owners?: ReadonlySet<string>) => {
        const began = performance.now()
        await engine.run(owners)
        return performance.now() - began
      }
      const cold = await sample()
      const full = []
      const touched = []
      for (let i = 0; i < (process.env['W671_RECONCILIATION_BENCH'] === 'before' ? 1 : 10); i++) {
        full.push(await sample())
        touched.push(await sample(new Set([owner])))
      }
      expect(store.openPiecesOf(owner)).toHaveLength(50)
      expect((db.prepare('SELECT count(*) AS n FROM events').get() as { n: number }).n).toBe(100000)
      const result = {
        source: process.env['W671_RECONCILIATION_BENCH'],
        cold,
        full,
        touched,
        ended: 5000,
        open: 50,
        events: 100000,
        trace,
      }
      console.log(
        'Reconciliation benchmark:',
        JSON.stringify(result),
        'trace',
        JSON.stringify(trace),
      )
      if (process.env['W671_BENCH_OUTPUT'])
        writeFileSync(process.env['W671_BENCH_OUTPUT'], JSON.stringify(result, null, 2))
      if (process.env['W671_RECONCILIATION_BENCH'] === 'after') {
        expect(Math.max(...full)).toBeLessThan(20)
        expect(Math.max(...touched)).toBeLessThan(2)
      }
    },
    360000,
  )

  it.runIf(process.env['W671_RECEIPT_BENCH'] !== undefined)(
    'measures a write-heavy touched pass beside 10000 historical receipts',
    async () => {
      const { db, store } = f
      const { owner, work } = await create()
      await settle()
      clearInterval(
        (f.host as unknown as { reconciliationTimer: ReturnType<typeof setInterval> })
          .reconciliationTimer,
      )
      await f.host.closeAll()
      let ordinal = store.nextOrdinal(owner)
      db.transaction(() => {
        for (let i = 1; i <= 2000; i++) {
          const piece = `past-${i}`
          store.recordGive(
            {
              piece,
              parent: work.piece,
              number: i,
              owner,
              givenBy: null,
              title: piece,
              brief: 'Fictional past work.',
              folder: null,
              inputs: [],
            },
            ordinal++,
            {
              type: 'work_given',
              piece,
              label: `${work.label}.${i}`,
              parent: work.piece,
              givenBy: null,
              title: piece,
              brief: 'Fictional past work.',
            },
            tick(),
          )
          store.append(
            owner,
            ordinal++,
            { type: 'work_replied', piece, outcome: 'done', summary: 'Checked.', resources: [] },
            tick(),
          )
          for (let j = 0; j < 5; j++)
            store.append(
              owner,
              ordinal++,
              {
                type: 'work_reconciliation',
                piece,
                incident: piece,
                kind: 'wait-target-ended',
                since: f.clock,
                step: j === 4 ? 'resolved' : 'holder',
                outcome: j === 4 ? 'resolved' : 'delivered',
                target: owner,
                messageId: `past-message-${i}-${j}`,
              },
              tick(),
            )
        }
      })()
      expect(store.reconciliationReceiptsForOwner(owner)).toHaveLength(10000)
      f.firstLoad = new Promise<void>(() => {})
      f.host = f.build()
      const engine = (
        f.host as unknown as {
          workReconciler: { run(owners?: ReadonlySet<string>): Promise<void> }
        }
      ).workReconciler
      const keep = vi.spyOn(
        f.host as unknown as {
          keepReconciliation(owner: string, event: WorkReconciliationEvent): boolean
        },
        'keepReconciliation',
      )
      // A stopped holder records the person step synchronously; no provider is timed here.
      record(owner, { type: 'work_interrupted', by: 'a-person' })
      const trace: Record<string, { calls: number; ms: number }> = {}
      if (process.env['W671_PROFILE']) {
        const scope = store as unknown as Record<string, (...args: unknown[]) => unknown>
        for (const name of [
          'reconciliationWork',
          'piecesOwnedBy',
          'turnBlockRootLines',
          'rootLines',
          'reconciliationReceipts',
          'reconciliationReceiptsForOwner',
          'append',
          'lastAskToStop',
          'routedRequestsOf',
          'messagesWaitingIn',
          'nextOrdinal',
        ]) {
          const original = scope[name]
          if (original === undefined) continue
          scope[name] = (...args) => {
            const began = performance.now()
            try {
              return original.apply(store, args)
            } finally {
              const entry = trace[name] ?? { calls: 0, ms: 0 }
              entry.calls++
              entry.ms += performance.now() - began
              trace[name] = entry
            }
          }
        }
      }
      const times: number[] = []
      for (let i = 0; i < 10; i++) {
        waiting(owner, work.piece, { kind: 'agent', piece: `missing-${i}`, label: 'W99.1' })
        // Warm the canonical work fold equally before each paired transition measurement.
        ;(f.host as unknown as { reconciliationReading(): unknown }).reconciliationReading()
        const began = performance.now()
        await engine.run(new Set([owner]))
        times.push(performance.now() - began)
      }
      const result = {
        source: process.env['W671_RECEIPT_BENCH'],
        times,
        max: Math.max(...times),
        history: 10000,
        historicalPieces: 2000,
        transitions: keep.mock.calls.length,
        trace,
      }
      console.log('Receipt benchmark:', JSON.stringify(result))
      if (process.env['W671_BENCH_OUTPUT'])
        writeFileSync(process.env['W671_BENCH_OUTPUT'], JSON.stringify(result, null, 2))
      expect(keep.mock.calls).toHaveLength(19)
      expect(keep.mock.results.every((one) => one.type === 'return' && one.value === true)).toBe(
        true,
      )
      expect(receipts(owner, work.piece)).toHaveLength(19)
      if (process.env['W671_RECEIPT_BENCH'] === 'after') expect(result.max).toBeLessThan(2)
    },
    120000,
  )
})
