import type { PieceRow, TaskStallCause } from '../../shared/task-contracts'
import type {
  ReconciliationReceipt,
  WorkReconciliationEvent,
} from '../../shared/reconciliation-contracts'
import type { WorkIncidentKind } from '../../shared/work-incidents'

export const WORK_RECONCILIATION_MS = 60_000

/**
 * How many holders a whole sweep reads before it lets other work run. A sweep reads every
 * conversation that ever held work; the first one after a launch folds each ledger afresh, which
 * in one piece holds the main thread for seconds.
 */
const HOLDERS_READ_AT_ONCE = 100

export type ReminderProgress = 'pending' | 'running' | 'turn-ended' | 'not-delivered'
export type WorkDisposition = 'working' | 'waiting' | 'ended' | 'unresolved' | 'unknown'

export interface ReconciliationPiece {
  readonly piece: string
  readonly label: string
  readonly holder: string
  readonly waitsFor?: readonly string[]
  readonly giver: string | null
  readonly unhandedBrief?: string
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
  holders(): readonly string[]
  providerFailures?(holders: ReadonlySet<string>): void
  preparePieces?(
    holders: ReadonlySet<string>,
  ): Promise<(() => readonly ReconciliationPiece[] | undefined) | undefined>
  pieces(holders: ReadonlySet<string>): readonly ReconciliationPiece[]
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

  /** When this life began: a step planned before it was cut short by an earlier one. */
  private readonly began: number

  constructor(private readonly reads: ReconciliationReads) {
    this.began = reads.now()
  }

  close(): void {
    this.closed = true
  }

  /** The sweep already running, excluding future reruns and paced notice deliveries. */
  currentPass(): Promise<void> | null {
    return this.running
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
    if (holders === undefined) {
      this.watching.clear()
      const all = this.reads.holders()
      for (let at = 0; at < all.length; at += HOLDERS_READ_AT_ONCE) {
        if (at > 0) await new Promise((resolve) => setImmediate(resolve))
        if (this.closed) return
        await this.walkHolders(new Set(all.slice(at, at + HOLDERS_READ_AT_ONCE)))
      }
      return
    }
    for (const holder of holders) {
      for (const [target, owners] of this.watching) {
        owners.delete(holder)
        if (owners.size === 0) this.watching.delete(target)
      }
    }
    await this.walkHolders(holders)
  }

  private async walkHolders(holders: ReadonlySet<string>): Promise<void> {
    this.reads.providerFailures?.(holders)
    const prepared =
      this.reads.preparePieces === undefined ? undefined : await this.reads.preparePieces(holders)
    if (this.closed) return
    const pieces = (prepared?.() ?? this.reads.pieces(holders)).filter(
      (one) => one.disposition !== 'ended' && one.disposition !== 'unknown',
    )
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
      // A step an earlier life planned and never delivered, as a quit or a crash leaves it: its
      // words still wait in the ledger, so this life delivers them.
      if (receipt.outcome === 'planned' && progress === 'pending' && receipt.at < this.began) {
        this.dispatch(piece, receipt)
        continue
      }
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
    // A quit is not an answer: a delivery its owner's close cut short records no outcome, so the
    // next launch finds the step as it was left.
    if (this.closed) return
    const latest = currentIncident(this.reads.receipts(piece.piece)).at(-1)
    if (latest?.incident === receipt.incident && latest.step === receipt.step)
      this.reads.keep(piece.holder, { ...receipt, outcome: accepted ? 'delivered' : 'failed' })
  }
}
