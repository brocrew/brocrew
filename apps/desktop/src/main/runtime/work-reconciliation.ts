import type { WorkIncidentKind } from '../../shared/work-incidents'
import type { PieceRow, TaskStallCause } from '../../shared/tasks'
import type {
  ReconciliationReceipt,
  WorkReconciliationEvent,
} from '../../shared/work-reconciliation'

export const WORK_RECONCILIATION_MS = 60_000

export type ReminderProgress = 'pending' | 'running' | 'turn-ended' | 'not-delivered'
export type WorkDisposition = 'working' | 'waiting' | 'ended' | 'unresolved' | 'unknown'

export interface ReconciliationPiece {
  readonly piece: string
  readonly label: string
  readonly holder: string
  readonly waitsFor?: readonly string[]
  readonly giver: string | null
  readonly stalledBy?: PieceRow['stalledBy']
  readonly nameOf?: (conversation: string) => string
  readonly stoppedByPerson?: true
  readonly disposition: WorkDisposition
  readonly issue: {
    readonly kind: WorkIncidentKind
    readonly since: number
    readonly waitKey?: string
    readonly due?: true
    readonly cause?: TaskStallCause
  } | null
}

export interface ReconciliationReads {
  pieces(holders?: ReadonlySet<string>): readonly ReconciliationPiece[]
  receiptsFor?(
    pieces: readonly ReconciliationPiece[],
  ): ReadonlyMap<string, readonly ReconciliationReceipt[]>
  receipts(piece: string): readonly ReconciliationReceipt[]
  keep(owner: string, event: WorkReconciliationEvent): boolean
  progress(receipt: ReconciliationReceipt): ReminderProgress
  deliver(piece: ReconciliationPiece, receipt: ReconciliationReceipt): Promise<boolean>
  id(): string
  now(): number
}

/** A finished reminded turn with no valid disposition, or an observed failed delivery. */
export function unresolved(disposition: WorkDisposition, progress: ReminderProgress): boolean {
  return (
    disposition !== 'ended' &&
    disposition !== 'waiting' &&
    disposition !== 'unknown' &&
    (progress === 'not-delivered' || (disposition === 'unresolved' && progress === 'turn-ended'))
  )
}

export function currentIncident(
  receipts: readonly ReconciliationReceipt[],
): readonly ReconciliationReceipt[] {
  const latest = receipts.at(-1)
  if (latest === undefined || latest.step === 'resolved') return []
  return receipts.filter((one) => one.incident === latest.incident)
}

/** A serial ladder; neither a tick nor a restart supplies evidence that a turn has finished. */
export class WorkReconciler {
  private running: Promise<void> | null = null
  private pending: Set<string> | undefined | null = null
  private closed = false
  private readonly delivering = new Set<string>()
  private readonly watching = new Map<string, Set<string>>()

  constructor(private readonly reads: ReconciliationReads) {}

  close(): void {
    this.closed = true
  }

  run(holders?: ReadonlySet<string>): Promise<void> {
    if (this.closed || holders?.size === 0) return Promise.resolve()
    if (holders !== undefined) {
      const touched = new Set(holders)
      for (const holder of holders)
        for (const dependent of this.watching.get(holder) ?? []) touched.add(dependent)
      holders = touched
    }
    if (this.running !== null) {
      if (holders === undefined) this.pending = undefined
      else if (this.pending !== undefined) {
        this.pending ??= new Set()
        for (const holder of holders) this.pending.add(holder)
      }
      return this.running
    }
    const work = this.walk(holders)
    this.running = work.finally(() => {
      this.running = null
      const pending = this.pending
      this.pending = null
      if (pending !== null && !this.closed) void this.run(pending).catch(() => undefined)
    })
    return this.running
  }

  private async walk(holders?: ReadonlySet<string>): Promise<void> {
    if (holders === undefined) this.watching.clear()
    else
      for (const holder of holders) {
        for (const [target, owners] of this.watching) {
          owners.delete(holder)
          if (owners.size === 0) this.watching.delete(target)
        }
      }
    const pieces = this.reads
      .pieces(holders)
      .filter((one) => one.disposition !== 'ended' && one.disposition !== 'unknown')
    for (const piece of pieces)
      for (const target of piece.waitsFor ?? []) this.watch(piece.holder, target)
    if (pieces.length === 0) return
    const receipts = this.reads.receiptsFor?.(pieces)
    for (const piece of pieces) {
      if (this.closed) return
      let receipt: ReconciliationReceipt | undefined
      try {
        const rows =
          receipts === undefined ? this.reads.receipts(piece.piece) : receipts.get(piece.piece)
        if (rows === undefined) continue
        receipt = currentIncident(rows).at(-1)
      } catch {
        continue
      }
      if (piece.disposition === 'waiting') {
        if (receipt !== undefined)
          this.reads.keep(piece.holder, {
            ...receipt,
            step: 'resolved',
            outcome: 'resolved',
          })
        continue
      }
      if (
        receipt !== undefined &&
        piece.issue?.waitKey !== undefined &&
        receipt.waitKey !== piece.issue.waitKey
      ) {
        if (!this.reads.keep(piece.holder, { ...receipt, step: 'resolved', outcome: 'resolved' }))
          continue
        receipt = undefined
      }
      if (piece.stoppedByPerson === true) {
        if (receipt?.step !== 'person' && piece.issue !== null)
          this.reads.keep(piece.holder, {
            type: 'work_reconciliation',
            incident: receipt?.incident ?? this.reads.id(),
            piece: piece.piece,
            ...piece.issue,
            step: 'person',
            outcome: 'listed',
          })
        continue
      }
      if (receipt === undefined) {
        if (piece.issue === null || piece.disposition === 'working') continue
        receipt = {
          type: 'work_reconciliation',
          incident: this.reads.id(),
          piece: piece.piece,
          ...piece.issue,
          step: 'holder',
          outcome: 'planned',
          target: piece.holder,
          messageId: this.reads.id(),
          at: this.reads.now(),
        }
        if (!this.reads.keep(piece.holder, receipt)) continue
        this.dispatch(piece, receipt)
        continue
      }
      if (receipt.target !== undefined && receipt.step !== 'person')
        this.watch(piece.holder, receipt.target)
      if (receipt.step === 'person' || this.delivering.has(`${receipt.incident}:${receipt.step}`))
        continue
      const progress = receipt.outcome === 'failed' ? 'not-delivered' : this.reads.progress(receipt)
      if (!unresolved(piece.disposition, progress)) continue
      if (
        progress === 'not-delivered' &&
        receipt.kind !== 'stopped' &&
        !receipt.kind.startsWith('recovery-')
      )
        receipt = { ...receipt, kind: 'notice-not-delivered' }
      if (receipt.step === 'holder' && piece.giver !== null) {
        const next: ReconciliationReceipt = {
          ...receipt,
          step: 'giver',
          outcome: 'planned',
          target: piece.giver,
          messageId: this.reads.id(),
          at: this.reads.now(),
        }
        if (this.reads.keep(piece.holder, next)) this.dispatch(piece, next)
      } else {
        this.reads.keep(piece.holder, { ...receipt, step: 'person', outcome: 'listed' })
      }
    }
  }

  private watch(holder: string, target: string): void {
    const owners = this.watching.get(target) ?? new Set<string>()
    owners.add(holder)
    this.watching.set(target, owners)
  }

  private dispatch(piece: ReconciliationPiece, receipt: ReconciliationReceipt): void {
    const key = `${receipt.incident}:${receipt.step}`
    if (receipt.target !== undefined) this.watch(piece.holder, receipt.target)
    this.delivering.add(key)
    void this.deliver(piece, receipt)
      .catch(() => undefined)
      .finally(() => {
        this.delivering.delete(key)
        if (!this.closed)
          void this.run(
            new Set([piece.holder, ...(receipt.target === undefined ? [] : [receipt.target])]),
          ).catch(() => undefined)
      })
  }

  private async deliver(piece: ReconciliationPiece, receipt: ReconciliationReceipt): Promise<void> {
    let accepted = false
    try {
      accepted = await this.reads.deliver(piece, receipt)
    } catch {
      /* The failed step is recorded below. */
    }
    const latest = currentIncident(this.reads.receipts(piece.piece)).at(-1)
    if (latest?.incident === receipt.incident && latest.step === receipt.step)
      this.reads.keep(piece.holder, { ...receipt, outcome: accepted ? 'delivered' : 'failed' })
  }
}
