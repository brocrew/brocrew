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
  readonly fingerprint: string | null
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
  readonly indexFingerprint: string | null
  readonly malformedLines: number
  readonly readAt: number
}

export type MethodBody =
  | {
      readonly ok: true
      readonly key: string
      readonly text: string
      readonly bytes: number
      readonly fingerprint: string
    }
  | { readonly ok: false; readonly problem: MethodProblem }
