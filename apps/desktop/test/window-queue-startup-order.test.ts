import { afterEach, expect, it, vi } from 'vitest'
import { aLibraryHost, filesLibraryFixture } from './helpers/files-library-fixture'
import { WindowReadEngine } from '../src/main/db/window-read-engine'
import { windowWriterSampler } from '../src/main/db/window-writer-stamp'
import { limitsWriterSampler } from '../src/main/db/fresh-limits-snapshot'
import { WorkReconciler } from '../src/main/runtime/work-reconciliation'
import type { ReconciliationReceipt } from '../src/shared/reconciliation-contracts'
import { PERSONS_PARTS } from '../src/shared/persons-published'

afterEach(() => vi.restoreAllMocks())

it('reads after the initial sweep without waiting for paced delivery outcomes', async () => {
  const f = filesLibraryFixture()
  f.owner('holder')
  f.owner('giver')
  const root = f.store.ensurePersonalRoot('holder', 1)
  const engine = new WindowReadEngine(f.file)
  const read = vi.fn(async (query: Parameters<WindowReadEngine['read']>[0]) => {
    if (read.mock.calls.length === 1)
      expect(f.store.reconciliationReceipts('holder', root.piece).at(-1)).toMatchObject({
        step: 'holder',
        outcome: 'planned',
      })
    const answer = engine.read(query)
    await new Promise((resolve) => setImmediate(resolve))
    return answer
  })
  const host = aLibraryHost(f.directory, {
    store: f.store,
    windowReader: { read, close: async () => engine.close() },
    windowWriterStamp: windowWriterSampler(f.db, () => true),
    limitsWriterStamp: limitsWriterSampler(f.db, () => true),
  })
  const receipts: ReconciliationReceipt[] = []
  let entered!: () => void
  const delivering = new Promise<void>((resolve) => {
    entered = resolve
  })
  let release!: () => void
  const delivery = new Promise<void>((resolve) => {
    release = resolve
  })
  let listed!: () => void
  const outcomesKept = new Promise<void>((resolve) => {
    listed = resolve
  })
  let id = 0
  const machine = new WorkReconciler({
    holders: () => ['holder'],
    pieces: () => [
      {
        piece: root.piece,
        label: root.label,
        holder: 'holder',
        giver: 'giver',
        disposition: 'unresolved',
        issue: { kind: 'wait-target-ended', since: 1 },
      },
    ],
    receipts: () => receipts,
    keep: (owner, row) => {
      const at = Date.now()
      f.store.append(owner, f.store.nextOrdinal(owner), row, at)
      receipts.push({ ...row, at })
      if (row.step === 'person') listed()
      return true
    },
    progress: () => 'not-delivered',
    deliver: async (_piece, row) => {
      if (row.target === 'holder') {
        entered()
        await delivery
      }
      return false
    },
    id: () => `fictional-${++id}`,
    now: () => Date.now(),
  })
  // Keep the real serial ladder, with controlled delivery instead of a provider process.
  const control = host as unknown as { workReconciler: WorkReconciler }
  control.workReconciler.close()
  control.workReconciler = machine
  try {
    const answer = host.personsQueue()
    await delivering
    await new Promise((resolve) => setImmediate(resolve))
    expect(read).toHaveBeenCalledOnce()
    const queue = await answer
    if ('refused' in queue) throw new Error(queue.refused)
    expect(receipts.at(-1)).toMatchObject({ step: 'holder', outcome: 'planned' })
    expect(f.store.reconciliationReceipts('holder', root.piece)).toEqual(receipts)
    for (const part of PERSONS_PARTS) {
      expect(queue[part], part).not.toBeNull()
      expect(queue.published.covers[part].complete, part).toBe(true)
    }
    expect(read).toHaveBeenCalledOnce()
    release()
    await outcomesKept
    const updated = await host.personsQueue()
    if ('refused' in updated) throw new Error(updated.refused)
    expect(receipts.at(-1)).toMatchObject({ step: 'person', outcome: 'listed' })
    for (const part of PERSONS_PARTS)
      expect(updated.published.covers[part].complete, part).toBe(true)
    expect(read).toHaveBeenCalledTimes(2)
  } finally {
    release()
    await host.closeAll()
    f.close()
  }
})

it('does not wait for a first-window-load signal that has not happened', async () => {
  const f = filesLibraryFixture()
  const engine = new WindowReadEngine(f.file)
  const read = vi.fn(async (query: Parameters<WindowReadEngine['read']>[0]) => engine.read(query))
  const host = aLibraryHost(f.directory, {
    store: f.store,
    afterFirstWindowLoad: new Promise<void>(() => {}),
    windowReader: { read, close: async () => engine.close() },
    windowWriterStamp: windowWriterSampler(f.db, () => true),
    limitsWriterStamp: limitsWriterSampler(f.db, () => true),
  })
  try {
    const answer = await host.personsQueue()
    if ('refused' in answer) throw new Error(answer.refused)
    for (const part of PERSONS_PARTS) expect(answer.published.covers[part].complete).toBe(true)
    expect(read).toHaveBeenCalledOnce()
  } finally {
    await host.closeAll()
    f.close()
  }
})
