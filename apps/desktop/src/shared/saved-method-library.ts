/** The book reads independently of the smaller index sent at launch. */
export interface MethodReference {
  readonly title: string
  readonly when: string
  readonly verified: string
}

export type MethodProblem = 'missing' | 'link' | 'not-a-file' | 'too-large' | 'unreadable'

export interface MethodLibraryItem {
  /** An app-issued key resolved against a fresh directory listing, never a path argument. */
  readonly key: string
  readonly name: string
  readonly kind: 'index' | 'method' | 'missing-reference'
  readonly references: readonly MethodReference[]
  readonly bytes: number | null
  readonly canDelete: boolean
  readonly problem?: MethodProblem
}

export interface MethodLibrary {
  readonly state: 'missing' | 'read' | 'unavailable'
  readonly items: readonly MethodLibraryItem[]
  readonly total: number
  readonly offset: number
  readonly nextOffset: number | null
  readonly indexState: 'absent' | 'ok' | 'problem'
  readonly indexProblem?: MethodProblem
  readonly problem?: MethodProblem
  readonly truncated: boolean
  readonly malformedLines: number
  readonly readAt: number
}

export type MethodBody =
  | {
      readonly ok: true
      readonly key: string
      readonly text: string
      readonly bytes: number
    }
  | { readonly ok: false; readonly problem: MethodProblem }

/** The confirmed item and index state the window displayed; main resolves the key afresh. */
export interface MethodDeleteSelection {
  readonly confirmed: boolean
  readonly key: string
}

/** Receipts contain metadata; recovery bytes remain in main's ledger. */
export interface MethodChangeSummary {
  readonly id: string
  readonly sequence: number
  readonly operation: 'delete' | 'undo'
  readonly sourceId: string | null
  readonly target: string
  readonly outcome: 'pending' | 'done' | 'partial'
  readonly by: { readonly who: 'a-person' }
  readonly createdAt: number
  readonly settlement: {
    readonly by: { readonly who: 'a-person' } | { readonly who: 'the-app-itself' }
    readonly at: number
  } | null
  /** The settled observation matches every before-image; this attempt changed nothing. */
  readonly noEffect?: true
  readonly canUndo: boolean
}
export type MethodChangeResult =
  | { readonly ok: true; readonly change: MethodChangeSummary }
  | {
      readonly ok: false
      readonly reason: string
      readonly cause?: string
      readonly change?: MethodChangeSummary
    }
export type MethodHistoryResult =
  | { readonly ok: true; readonly changes: readonly MethodChangeSummary[] }
  | { readonly ok: false; readonly reason: string; readonly cause?: string }
