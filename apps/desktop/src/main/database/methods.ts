import type { ActedBy } from '../../shared/who-did-it'

export interface MethodFileImage {
  readonly base64: string
  readonly mode: number
}

export interface MethodFileChange {
  readonly name: string
  readonly before: MethodFileImage | null
  readonly afterBase64?: string | null
  /** Absent on legacy records whose planned permissions were not kept. */
  readonly afterMode?: number | null
}

export interface MethodFileState {
  readonly name: string
  readonly base64?: string | null
  readonly unreadable?: true
  readonly cause?: string
  /** Null means absent or unreadable; omitted means permissions were not recorded. */
  readonly mode?: number | null
}

export interface MethodChangeIntent {
  readonly operation: 'delete' | 'undo'
  readonly sourceId: string | null
  readonly target: string
  readonly files: readonly MethodFileChange[]
}

export interface MethodSettlement {
  readonly by: ActedBy
  readonly at: number
}

export interface MethodChangeRecord extends MethodChangeIntent {
  readonly id: string
  readonly sequence: number
  readonly by: ActedBy
  readonly outcome: 'pending' | 'done' | 'partial'
  readonly actual: readonly MethodFileState[] | null
  readonly createdAt: number
  readonly settlement: MethodSettlement | null
}

export interface AgentMethods {
  hasPendingMethodChange(profile: string): Promise<boolean>
  beginMethodChange(
    profile: string,
    said: MethodChangeIntent,
    by: ActedBy,
    at: number,
  ): Promise<MethodChangeRecord | null>
  settleMethodChange(
    profile: string,
    id: string,
    outcome: 'done' | 'partial',
    actual: readonly MethodFileState[],
    by: ActedBy,
  ): Promise<boolean>
  methodChange(profile: string, id: string): Promise<MethodChangeRecord | null>
  methodChanges(
    profile: string,
    offset?: number,
    limit?: number,
  ): Promise<readonly MethodChangeRecord[]>
}
