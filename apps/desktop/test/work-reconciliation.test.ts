import { describe, expect, it } from 'vitest'
import {
  WorkReconciler,
  unresolved,
  type ReconciliationPiece,
  type ReminderProgress,
} from '../src/main/runtime/work-reconciliation'
import type { ReconciliationReceipt } from '../src/shared/work-reconciliation'

function fixture() {
  let clock = 100
  let id = 0
  let writable = true
  const piece: ReconciliationPiece = {
    piece: 'piece-fictional',
    label: 'W1.1',
    holder: 'holder',
    giver: 'giver',
    disposition: 'unresolved',
    issue: { kind: 'wait-target-ended', since: 10 },
  }
  let pieces = [piece]
  const receipts: ReconciliationReceipt[] = []
  const deliveries: ReconciliationReceipt[] = []
  const progress = new Map<string, ReminderProgress>()
  const accepted = new Map<string, boolean>()
  let gate: Promise<void> | null = null
  const reads = {
    pieces: (holders?: ReadonlySet<string>) =>
      pieces.filter((one) => holders === undefined || holders.has(one.holder)),
    receipts: (key: string) => receipts.filter((one) => one.piece === key),
    keep: (_owner: string, row: Omit<ReconciliationReceipt, 'at'>) => {
      if (!writable) return false
      receipts.push({ ...row, at: clock++ })
      return true
    },
    progress: (row: ReconciliationReceipt) => progress.get(row.messageId!) ?? 'pending',
    deliver: async (_piece: ReconciliationPiece, row: ReconciliationReceipt) => {
      deliveries.push(row)
      if (row.target === 'holder' && gate !== null) await gate
      return accepted.get(row.target!) ?? true
    },
    id: () => `fictional-${++id}`,
    now: () => clock++,
  }
  return {
    reads,
    receipts,
    deliveries,
    progress,
    accepted,
    machine: () => new WorkReconciler(reads),
    piece: (edit: Partial<ReconciliationPiece>) => {
      pieces = [{ ...pieces[0]!, ...edit }]
    },
    pieces: (value: ReconciliationPiece[]) => {
      pieces = value
    },
    time: (value: number) => {
      clock = value
    },
    writable: (value: boolean) => {
      writable = value
    },
    gate: (value: Promise<void>) => {
      gate = value
    },
  }
}
async function flush(machine: WorkReconciler) {
  await machine.run()
  for (let at = 0; at < 4; at++) await new Promise((resolve) => setImmediate(resolve))
}

describe('the incident ladder follows observed outcomes', () => {
  it('ends with the holder when it records a valid disposition', async () => {
    const f = fixture()
    const machine = f.machine()
    await flush(machine)
    expect(f.deliveries.map((one) => one.target)).toEqual(['holder'])
    expect(f.receipts.map((one) => one.outcome)).toEqual(['planned', 'delivered'])
    f.piece({ disposition: 'waiting', issue: null })
    await flush(machine)
    expect(f.receipts.at(-1)?.step).toBe('resolved')
    expect(f.deliveries).toHaveLength(1)
  })

  it('ends with the giver when it settles what the reminded holder left unresolved', async () => {
    const f = fixture()
    const machine = f.machine()
    await flush(machine)
    f.progress.set(f.deliveries[0]!.messageId!, 'turn-ended')
    await flush(machine)
    expect(f.deliveries.map((one) => one.target)).toEqual(['holder', 'giver'])
    f.piece({ disposition: 'ended', issue: null })
    await flush(machine)
    expect(f.receipts.at(-1)?.step).toBe('giver')
    expect(f.receipts.some((one) => one.step === 'person')).toBe(false)
  })

  it('lists the person only after neither holder nor giver can act, once', async () => {
    const f = fixture()
    f.accepted.set('holder', false)
    f.accepted.set('giver', false)
    const machine = f.machine()
    await flush(machine)
    expect(f.deliveries.map((one) => one.target)).toEqual(['holder', 'giver'])
    expect(f.receipts.at(-1)).toMatchObject({ step: 'person', outcome: 'listed' })
    f.progress.set(f.deliveries.at(-1)!.messageId!, 'turn-ended')
    await flush(machine)
    await flush(f.machine())
    expect(f.deliveries).toHaveLength(2)
    expect(f.receipts.filter((one) => one.step === 'person')).toHaveLength(1)
  })

  it('waits for a reminded turn still running at later ticks, regardless of elapsed time', async () => {
    const f = fixture()
    const machine = f.machine()
    await flush(machine)
    f.progress.set(f.deliveries[0]!.messageId!, 'running')
    f.piece({ disposition: 'working', issue: null })
    f.time(10_000_000)
    await flush(machine)
    await flush(f.machine())
    expect(f.deliveries.map((one) => one.target)).toEqual(['holder'])
    expect(f.receipts).toHaveLength(2)
  })

  it('a restart and duplicate tick do not repeat a held reminder', async () => {
    const f = fixture()
    await flush(f.machine())
    await flush(f.machine())
    await flush(f.machine())
    expect(f.deliveries).toHaveLength(1)
    expect(f.receipts).toHaveLength(2)
  })

  it('does not repeat a claimed step whose delivery is absent after a restart', async () => {
    const f = fixture()
    await flush(f.machine())
    f.receipts.splice(1)
    f.progress.set(f.deliveries[0]!.messageId!, 'not-delivered')
    await flush(f.machine())
    expect(f.deliveries.map((one) => one.target)).toEqual(['holder', 'giver'])
  })

  it('a person Stop reaches the person directly, with no reminder or giver notice', async () => {
    const f = fixture()
    f.piece({ stoppedByPerson: true })
    await flush(f.machine())
    await flush(f.machine())
    expect(f.deliveries).toEqual([])
    expect(f.receipts).toMatchObject([{ step: 'person', outcome: 'listed' }])
    expect(f.receipts).toHaveLength(1)
  })

  it('a root has no giver step', async () => {
    const f = fixture()
    f.piece({ giver: null })
    f.accepted.set('holder', false)
    await flush(f.machine())
    expect(f.deliveries.map((one) => one.target)).toEqual(['holder'])
    expect(f.receipts.at(-1)?.step).toBe('person')
  })

  it('does nothing for a valid wait, or an unread disposition', async () => {
    const f = fixture()
    f.piece({ disposition: 'waiting', issue: null })
    await flush(f.machine())
    f.piece({ disposition: 'unknown' })
    await flush(f.machine())
    expect(f.receipts).toEqual([])
    expect(f.deliveries).toEqual([])
  })

  it('does not send unless the claim was written first', async () => {
    const f = fixture()
    f.writable(false)
    const machine = f.machine()
    const deliver = f.reads.deliver
    // An unexpected send stops the double so its assertion can run even with the guard broken.
    f.reads.deliver = async (piece, receipt) => {
      machine.close()
      return deliver(piece, receipt)
    }
    await flush(machine)
    expect(f.deliveries).toEqual([])
    expect(f.receipts).toEqual([])
  })

  it('one pending provider start does not block another incident or repeat itself', async () => {
    const f = fixture()
    let release = () => {}
    f.gate(
      new Promise<void>((resolve) => {
        release = resolve
      }),
    )
    f.pieces([
      f.reads.pieces()[0]!,
      { ...f.reads.pieces()[0]!, piece: 'other', holder: 'other-holder' },
    ])
    const machine = f.machine()
    await flush(machine)
    await flush(machine)
    expect(f.deliveries.map((one) => one.target)).toEqual(['holder', 'other-holder'])
    release()
    await flush(machine)
    expect(f.deliveries).toHaveLength(2)
  })

  it('unresolved is evidence, never a duration', () => {
    expect(unresolved('unresolved', 'turn-ended')).toBe(true)
    expect(unresolved('unresolved', 'not-delivered')).toBe(true)
    for (const pending of ['pending', 'running'] as const)
      expect(unresolved('unresolved', pending)).toBe(false)
    for (const disposed of ['waiting', 'ended', 'unknown'] as const)
      expect(unresolved(disposed, 'turn-ended')).toBe(false)
  })

  it('closing the reconciler prevents any new action', async () => {
    const f = fixture()
    const machine = f.machine()
    machine.close()
    await flush(machine)
    expect(f.receipts).toEqual([])
  })
  it('a late delivery completion cannot reopen a resolved episode', async () => {
    const f = fixture()
    let release = () => {}
    f.gate(
      new Promise<void>((resolve) => {
        release = resolve
      }),
    )
    const machine = f.machine()
    await flush(machine)
    f.piece({ disposition: 'waiting', issue: null })
    await flush(machine)
    expect(f.receipts.at(-1)?.step).toBe('resolved')
    const closedAt = f.receipts.length
    release()
    await flush(machine)
    expect(f.receipts.slice(closedAt)).toEqual([])
    expect(f.receipts.at(-1)?.step).toBe('resolved')
    expect(f.deliveries).toHaveLength(1)
  })

  it('a new recorded wait starts its own incident even if it expires between two scans', async () => {
    const f = fixture()
    const machine = f.machine()
    f.piece({ issue: { kind: 'wait-target-ended', since: 1, waitKey: 'a'.repeat(64) } })
    await flush(machine)
    const first = f.receipts[0]!.incident
    f.piece({ issue: { kind: 'wait-target-ended', since: 2, waitKey: 'b'.repeat(64) } })
    await flush(machine)
    expect(f.receipts.some((one) => one.incident === first && one.step === 'resolved')).toBe(true)
    expect(f.deliveries).toHaveLength(2)
    expect(f.deliveries[1]!.incident).not.toBe(first)
  })

  it('skips ended and unknown pieces before asking for any receipt', async () => {
    const f = fixture()
    f.pieces([
      { ...f.reads.pieces()[0]!, disposition: 'ended' },
      { ...f.reads.pieces()[0]!, piece: 'unread', disposition: 'unknown' },
    ])
    let queries = 0
    const readReceipts = f.reads.receipts
    f.reads.receipts = (key) => {
      queries++
      return readReceipts(key)
    }
    await flush(f.machine())
    expect(queries).toBe(0)
    expect(f.deliveries).toEqual([])
    expect(f.receipts).toEqual([])
  })

  it('a touched giver revisits only itself and the holder whose active step waits on it', async () => {
    const f = fixture()
    const machine = f.machine()
    await flush(machine)
    f.progress.set(f.deliveries[0]!.messageId!, 'turn-ended')
    await flush(machine)
    const giver = f.deliveries.at(-1)!
    expect(giver.target).toBe('giver')
    f.progress.set(giver.messageId!, 'turn-ended')
    const scopes: (readonly string[] | null)[] = []
    const read = f.reads.pieces
    f.reads.pieces = (holders) => {
      scopes.push(holders === undefined ? null : [...holders].sort())
      return read(holders)
    }
    await machine.run(new Set(['giver']))
    expect(scopes).toEqual([['giver', 'holder']])
    expect(f.receipts.at(-1)?.step).toBe('person')
  })

  it('a delivery rerun stays scoped to the affected holders', async () => {
    const f = fixture()
    const scopes: (readonly string[] | null)[] = []
    const read = f.reads.pieces
    f.reads.pieces = (holders) => {
      scopes.push(holders === undefined ? null : [...holders].sort())
      return read(holders)
    }
    const machine = f.machine()
    await machine.run(new Set(['holder']))
    for (let i = 0; i < 4; i++) await new Promise((resolve) => setImmediate(resolve))
    expect(scopes.length).toBeGreaterThan(1)
    expect(scopes.every((one) => one !== null && one.includes('holder'))).toBe(true)
  })

  it('a valid cross-holder wait is reconsidered when its target holder changes', async () => {
    const f = fixture()
    const machine = f.machine()
    const original = f.reads.pieces()[0]!
    f.pieces([{ ...original, holder: 'A', waitsFor: ['B'], disposition: 'waiting', issue: null }])
    await machine.run()
    expect(f.receipts).toEqual([])
    f.pieces([{ ...original, holder: 'A', waitsFor: ['B'] }])
    await machine.run(new Set(['B']))
    expect(f.receipts[0]).toMatchObject({ piece: original.piece, target: 'A', step: 'holder' })
  })
})
