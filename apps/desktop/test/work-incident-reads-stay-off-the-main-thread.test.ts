import { aWorkWaitFixture } from './helpers/work-wait-fixture'
import { settle } from './helpers/persisted-wait-revision-cases'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../src/main/db/connection'
import { WindowReadEngine } from '../src/main/db/window-read-engine'
import { WindowWorkerReader } from '../src/main/db/window-worker-reader'
import {
  WINDOW_READ_BOUNDS,
  WindowReadUnavailable,
  type WindowStoreReader,
} from '../src/main/db/window-read-protocol'
import { bundleAWorker } from './helpers/bundle-a-worker'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import type { RuntimeHostDeps } from '../src/main/runtime/runtime-host'

describe('a work wait is reconciled without a window', () => {
  const f = aWorkWaitFixture()
  const { create, cycle, record, tick, waiting, window } = f

  it('reuses only incident dependencies until a write, with the same canonical answer', async () => {
    const { owner, work } = await create()
    waiting(owner, work.piece)
    await f.host.interrupt(owner, window)
    await cycle()
    const held = vi.spyOn(f.store, 'messagesWaitingIn')
    const stop = vi.spyOn(f.store, 'lastAskToStop')
    const slots = (f.host as unknown as { slots: Map<string, unknown> }).slots
    const adopted = new Map(slots)
    slots.clear()
    try {
      const first = f.host.workIncidentsForAPerson()
      expect(first.rows).toHaveLength(1)
      const calls = [held.mock.calls.length, stop.mock.calls.length]
      expect(calls.every((n) => n > 0)).toBe(true)
      expect(f.host.workIncidentsForAPerson()).toEqual(first)
      expect([held.mock.calls.length, stop.mock.calls.length]).toEqual(calls)
      record(owner, {
        type: 'message_queued',
        messageId: 'fictional-drive',
        text: 'Carry on.',
        kind: 'work',
      })
      const changed = f.host.workIncidentsForAPerson()
      expect(changed.rows).toEqual([])
      expect(held.mock.calls.length).toBeGreaterThan(calls[0]!)
      const after = [held.mock.calls.length, stop.mock.calls.length]
      expect(f.host.workIncidentsForAPerson()).toEqual(changed)
      expect([held.mock.calls.length, stop.mock.calls.length]).toEqual(after)
      f.stampsAvailable = false
      expect(f.host.workIncidentsForAPerson()).toEqual(changed)
      record(owner, {
        type: 'message_unqueued',
        messageId: 'fictional-drive',
        text: 'Carry on.',
        reason: 'sent',
      })
      const canonical = f.host.workIncidentsForAPerson()
      expect(canonical.rows).toHaveLength(1)
      f.stampsAvailable = true
      expect(f.host.workIncidentsForAPerson()).toEqual(canonical)
      const starts = (f.host as unknown as { startsInFlight: Map<string, Promise<string>> })
        .startsInFlight
      starts.set(owner, Promise.resolve(owner))
      try {
        expect(f.host.workIncidentsForAPerson().rows).toEqual([])
      } finally {
        starts.delete(owner)
      }
      expect(f.host.workIncidentsForAPerson()).toEqual(canonical)
      expect(() =>
        f.db.transaction(() => {
          record(owner, {
            type: 'message_queued',
            messageId: 'fictional-rolled-back',
            kind: 'work',
            text: 'Uncommitted words.',
          })
          expect(f.host.workIncidentsForAPerson().rows).toEqual([])
          throw new Error('fictional rollback')
        })(),
      ).toThrow('fictional rollback')
      expect(f.host.workIncidentsForAPerson()).toEqual(canonical)
      const beforeExternal = held.mock.calls.length
      const external = openDatabase(join(f.userData, 'brobot2.sqlite'))
      try {
        external
          .prepare(
            "UPDATE events SET payload = ? WHERE session_id = ? AND type = 'message_unqueued'",
          )
          .run(
            JSON.stringify({
              type: 'message_unqueued',
              messageId: 'fictional-drive',
              text: 'Changed externally.',
              reason: 'sent',
            }),
            owner,
          )
      } finally {
        external.close()
      }
      expect(f.host.workIncidentsForAPerson()).toEqual(canonical)
      expect(held.mock.calls.length).toBeGreaterThan(beforeExternal)
    } finally {
      for (const [id, slot] of adopted) slots.set(id, slot)
    }
  })

  it('reads incident facts off the writer and sees a just-written held message or ending', async () => {
    const { host, store, userData } = f
    const { owner, work } = await create()
    waiting(owner, work.piece)
    await host.interrupt(owner, window)
    await cycle()
    ;(host as unknown as { workReconciler: { close(): void } }).workReconciler.close()
    clearInterval(
      (host as unknown as { reconciliationTimer: ReturnType<typeof setInterval> })
        .reconciliationTimer,
    )
    const slots = (host as unknown as { slots: Map<string, unknown> }).slots
    const adopted = new Map(slots)
    slots.clear()
    const engine = new WindowReadEngine(join(userData, 'brobot2.sqlite'))
    const deps = (host as unknown as { deps: RuntimeHostDeps }).deps
    const nativeHeld = vi.spyOn(store, 'messagesWaitingIn').mockImplementation(() => {
      throw new Error('held messages folded on main')
    })
    const nativeStop = vi.spyOn(store, 'lastAskToStop').mockImplementation(() => {
      throw new Error('Stop folded on main')
    })
    const read = vi.fn<WindowStoreReader['read']>(async (query) => engine.read(query))
    deps.windowReader = { read, close: async () => {} }
    const look = () => executeRuntimeCommand(host, window, { kind: 'workIncidentsForAPerson' })
    try {
      expect(await look()).toMatchObject({ rows: [{ piece: work.piece }], rowsUnread: 0 })
      record(owner, {
        type: 'message_queued',
        messageId: 'fresh-held',
        text: 'Carry on.',
        kind: 'work',
      })
      expect(await look()).toMatchObject({ rows: [], rowsUnread: 0 })
      record(owner, {
        type: 'message_unqueued',
        messageId: 'fresh-held',
        text: 'Carry on.',
        reason: 'sent',
      })
      expect(await look()).toMatchObject({ rows: [{ piece: work.piece }], rowsUnread: 0 })
      record(owner, { type: 'status', state: 'working' })
      const stale = engine.read({ kind: 'incidents' })
      let release!: () => void
      read.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve(stale)
          }),
      )
      const pending = look()
      await expect(look()).rejects.toThrow(WindowReadUnavailable)
      record(owner, {
        type: 'message_queued',
        messageId: 'during-read',
        text: 'New words.',
        kind: 'work',
      })
      release()
      expect(await pending).toMatchObject({ rows: [], rowsUnread: 0 })
      expect(read).toHaveBeenCalledTimes(5)
      expect(read.mock.calls.every(([query]) => query.kind === 'incidents')).toBe(true)
      expect(await look()).toMatchObject({ rows: [], rowsUnread: 0 })
      expect(read).toHaveBeenCalledTimes(5)
      expect(nativeHeld).not.toHaveBeenCalled()
      expect(nativeStop).not.toHaveBeenCalled()
    } finally {
      delete deps.windowReader
      engine.close()
      for (const [id, slot] of adopted) slots.set(id, slot)
    }
  })

  async function incidentWindow() {
    const { owner, work } = await create()
    waiting(owner, work.piece)
    await f.host.interrupt(owner, window)
    await cycle()
    ;(f.host as unknown as { workReconciler: { close(): void } }).workReconciler.close()
    clearInterval(
      (f.host as unknown as { reconciliationTimer: ReturnType<typeof setInterval> })
        .reconciliationTimer,
    )
    const slots = (f.host as unknown as { slots: Map<string, unknown> }).slots
    const adopted = new Map(slots)
    slots.clear()
    const engine = new WindowReadEngine(join(f.userData, 'brobot2.sqlite'))
    const deps = (f.host as unknown as { deps: RuntimeHostDeps }).deps
    const read = vi.fn<WindowStoreReader['read']>(async (query) => engine.read(query))
    deps.windowReader = { read, close: async () => {} }
    const main = vi.spyOn(f.host, 'workIncidentsForAPerson')
    return {
      owner,
      work,
      engine,
      read,
      main,
      look: () => executeRuntimeCommand(f.host, window, { kind: 'workIncidentsForAPerson' }),
      close() {
        delete deps.windowReader
        engine.close()
        for (const [id, slot] of adopted) slots.set(id, slot)
      },
    }
  }

  it('an incident snapshot a writer overtook twice is shown, never read again on main', async () => {
    const fixture = await incidentWindow()
    fixture.read.mockImplementation(async (query) => {
      const result = fixture.engine.read(query)
      record(fixture.owner, { type: 'status', state: 'working' })
      return result
    })
    try {
      expect(await fixture.look()).toMatchObject({ rows: [{ piece: fixture.work.piece }] })
      expect(fixture.read).toHaveBeenCalledTimes(2)
      expect(fixture.main).not.toHaveBeenCalled()
    } finally {
      fixture.close()
    }
  })

  it.each(['failed', 'abandoned', 'unsampled'] as const)(
    'incident worker %s reports failure without repeating its work on main',
    async (failure) => {
      const fixture = await incidentWindow()
      let at = 1000
      vi.spyOn(performance, 'now').mockImplementation(() => at)
      if (failure === 'unsampled') f.stampsAvailable = false
      else
        fixture.read.mockRejectedValue(
          new WindowReadUnavailable(failure === 'failed' ? 'failed' : 'unavailable'),
        )
      try {
        for (at of [1000, 1001, 16000, 30999, 31000, 61000]) {
          await expect(fixture.look()).rejects.toThrow(WindowReadUnavailable)
          record(fixture.owner, {
            type: 'message_queued',
            messageId: `fresh-during-outage-${at}`,
            text: 'Fictional words.',
            kind: 'work',
          })
        }
        expect(fixture.main).not.toHaveBeenCalled()
      } finally {
        fixture.close()
      }
    },
  )

  it('incident worker busy never runs the main fallback', async () => {
    const fixture = await incidentWindow()
    try {
      fixture.read.mockRejectedValueOnce(new WindowReadUnavailable('busy'))
      await expect(fixture.look()).rejects.toThrow(WindowReadUnavailable)
      expect(fixture.main).not.toHaveBeenCalled()
      let release!: () => void
      fixture.read.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve(fixture.engine.read({ kind: 'incidents' }))
          }),
      )
      const first = fixture.look()
      await expect(fixture.look()).rejects.toThrow(WindowReadUnavailable)
      expect(fixture.main).not.toHaveBeenCalled()
      release()
      expect(await first).toMatchObject({ rows: [{ piece: fixture.work.piece }] })
      expect(fixture.main).not.toHaveBeenCalled()
      const admitted = f.host as unknown as { windowReadCallers: number }
      admitted.windowReadCallers = WINDOW_READ_BOUNDS.callers
      await expect(fixture.look()).rejects.toThrow(WindowReadUnavailable)
      expect(fixture.main).not.toHaveBeenCalled()
      admitted.windowReadCallers = 0
    } finally {
      fixture.close()
    }
  })

  it('incident worker quit refuses a late failure without a main fallback', async () => {
    const fixture = await incidentWindow()
    try {
      let reject!: (error: unknown) => void
      fixture.read.mockImplementationOnce(
        () =>
          new Promise((_resolve, fail) => {
            reject = fail
          }),
      )
      const pending = fixture.look()
      ;(f.host as unknown as { launches: { closeAdmission(): void } }).launches.closeAdmission()
      reject(new WindowReadUnavailable('failed'))
      await expect(pending).rejects.toThrow(WindowReadUnavailable)
      await expect(fixture.look()).rejects.toThrow(/shutting down/)
      delete (f.host as unknown as { deps: RuntimeHostDeps }).deps.windowReader
      await expect(f.host.workIncidentsForWindow()).rejects.toThrow(WindowReadUnavailable)
      expect(fixture.main).not.toHaveBeenCalled()
    } finally {
      fixture.close()
    }
  })

  it.runIf(process.env['W736_INCIDENT_BENCH'] !== undefined)(
    'measures main-thread incident reads by dependency on a large fictional ledger',
    async () => {
      const { db, store } = f
      const owners: Awaited<ReturnType<typeof create>>[] = []
      for (let i = 0; i < 8; i++) owners.push(await create())
      await settle()
      ;(f.host as unknown as { workReconciler: { close(): void } }).workReconciler.close()
      clearInterval(
        (f.host as unknown as { reconciliationTimer: ReturnType<typeof setInterval> })
          .reconciliationTimer,
      )
      const ordinals = new Map(owners.map(({ owner }) => [owner, store.nextOrdinal(owner)]))
      const append = (owner: string, event: TranscriptEvent) => {
        const n = ordinals.get(owner)!
        ordinals.set(owner, n + 1)
        store.append(owner, n, event, tick())
      }
      db.transaction(() => {
        for (const { owner } of owners) {
          append(owner, {
            type: 'question_asked',
            requestId: 'bench-request',
            prompt: 'Fictional question',
            questions: [{ id: 'part', prompt: 'Which option?', options: [] }],
          })
          append(owner, { type: 'request_routed', requestId: 'bench-request', to: 'a-person' })
          append(owner, { type: 'request_resolved', id: 'bench-request' })
          for (let i = 0; i < 4375; i++) append(owner, { type: 'status', state: 'working' })
        }
        for (let i = 1; i <= 5050; i++) {
          const { owner, work } = owners[i % owners.length]!
          const piece = `incident-bench-${i}`
          const n = ordinals.get(owner)!
          ordinals.set(owner, n + 1)
          store.recordGive(
            {
              piece,
              parent: work.piece,
              number: i,
              owner,
              givenBy: null,
              title: piece,
              brief: 'Fictional work.',
              folder: null,
              inputs: [],
            },
            n,
            {
              type: 'work_given',
              piece,
              label: `${work.label}.${i}`,
              parent: work.piece,
              givenBy: null,
              title: piece,
              brief: 'Fictional work.',
            },
            tick(),
          )
          append(
            owner,
            i <= 5000
              ? { type: 'work_replied', piece, outcome: 'done', summary: 'Checked.', resources: [] }
              : {
                  type: 'work_status_set',
                  piece,
                  line: 'Fictional waiting',
                  by: owner,
                  waiting: true,
                },
          )
          if (i <= 5000)
            for (let j = 0; j < 2; j++)
              append(owner, {
                type: 'work_reconciliation',
                piece,
                incident: piece,
                kind: 'wait-target-ended',
                since: f.clock,
                step: 'resolved',
                outcome: 'resolved',
              })
        }
        for (const { owner } of owners)
          for (let i = 0; i < 1000; i++) {
            const messageId = `fictional-held-${i}`
            const text = 'Fictional words. ' + 'x'.repeat(1000)
            append(owner, {
              type: 'message_queued',
              messageId,
              kind: 'work',
              text,
            })
            append(owner, { type: 'message_unqueued', messageId, text, reason: 'sent' })
          }
        const count = (db.prepare('SELECT count(*) AS n FROM events').get() as { n: number }).n
        for (let i = count; i < 100000; i++)
          append(owners[0]!.owner, {
            type: 'memory_note',
            notes: [{ path: '/fictional/notes/benchmark.md', bytes: 0 }],
          })
      })()
      const histogram = db
        .prepare('SELECT type, count(*) AS n FROM events GROUP BY type ORDER BY type')
        .all()
      expect((db.prepare('SELECT count(*) AS n FROM events').get() as { n: number }).n).toBe(100000)
      const classify = (name: string): string => {
        if (name === 'messagesWaitingIn') return 'held messages'
        if (/Receipts|Receipt|reconciliationDelivery/.test(name)) return 'receipts'
        if (/Recovery|DrivenByTurn|theNewestTurn/.test(name)) return 'recovery'
        if (/routedRequests|questionsRaised/.test(name)) return 'routes and questions'
        if (
          /reconciliation|Pieces|pieces|rootLines|RootLines|lastAskToStop|lastEndedTurn|workReportedTo/.test(
            name,
          )
        )
          return 'pieces and waits'
        return 'other'
      }
      let trace: Record<string, { calls: number; ms: number }> | undefined
      const scope = store as unknown as Record<string, (...args: unknown[]) => unknown>
      for (const name of Object.keys(scope)) {
        const original = scope[name]
        if (typeof original !== 'function') continue
        scope[name] = (...args) => {
          if (trace === undefined) return original.apply(store, args)
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
      const mode = process.env['W896_INCIDENT_MODE'] ?? 'main'
      let reader: WindowWorkerReader | undefined
      if (mode === 'worker') {
        const entry = await bundleAWorker(
          'src/main/window-reader.worker.ts',
          f.userData,
          'incident-worker.cjs',
        )
        reader = new WindowWorkerReader(
          new Worker(entry, { workerData: { file: join(f.userData, 'brobot2.sqlite') } }),
        )
        ;(f.host as unknown as { deps: RuntimeHostDeps }).deps.windowReader = reader
      }
      const measure = async (name: string) => {
        trace = {}
        const began = performance.now()
        const cpu = process.threadCpuUsage()
        const answer =
          mode === 'worker'
            ? await f.host.workIncidentsForWindow()
            : f.host.workIncidentsForAPerson()
        const used = process.threadCpuUsage(cpu)
        const mainThreadMs = (used.user + used.system) / 1000
        const ms = performance.now() - began
        const methods = trace
        trace = undefined
        const groups: Record<string, { calls: number; ms: number }> = {}
        for (const [method, value] of Object.entries(methods)) {
          const group = groups[classify(method)] ?? { calls: 0, ms: 0 }
          group.calls += value.calls
          group.ms += value.ms
          groups[classify(method)] = group
        }
        expect(answer.rowsUnread).toBe(0)
        return { name, ms, mainThreadMs, rows: answer.rows.length, groups, methods }
      }
      // Unadopted conversations read their held messages from the record, not a live mailbox.
      const slots = (f.host as unknown as { slots: Map<string, unknown> }).slots
      const adopted = new Map(slots)
      slots.clear()
      try {
        const cold = await measure('cold')
        const steady: Awaited<ReturnType<typeof measure>>[] = []
        for (let i = 0; i < 10; i++) steady.push(await measure('unchanged'))
        const writing: Awaited<ReturnType<typeof measure>>[] = []
        for (let i = 0; i < 10; i++) {
          append(owners[0]!.owner, { type: 'status', state: 'working' })
          writing.push(await measure('after working status'))
        }
        const result = {
          mode,
          source: process.env['W736_INCIDENT_BENCH'],
          adopted: false,
          owners: owners.length,
          ended: 5000,
          open: 50,
          routedStatuses: 35000,
          heldMessagePairs: 8000,
          historicalReceipts: 10000,
          eventsBeforeMeasurement: 100000,
          histogram,
          cold,
          steady,
          writing,
        }
        console.log('Main-thread incidents', JSON.stringify(result))
        if (process.env['W736_INCIDENT_OUTPUT'])
          writeFileSync(process.env['W736_INCIDENT_OUTPUT'], JSON.stringify(result, null, 2))
        if (mode === 'worker') {
          expect(writing.every((one) => one.mainThreadMs < 10)).toBe(true)
          expect(
            writing.every(
              (one) =>
                one.methods['messagesWaitingIn'] === undefined &&
                one.methods['lastAskToStop'] === undefined,
            ),
          ).toBe(true)
        }
      } finally {
        await reader?.close()
        for (const [id, slot] of adopted) slots.set(id, slot)
      }
    },
    120000,
  )
})
