import type { PersistedEventInfo } from './conversation-events'

/** Recorded provider work relationships, in first-observed order. */
export interface WorkAncestryFacts {
  /** Native ordinal of the reset beginning this provider life; -1 precedes its first life. */
  readonly after?: number
  /** Recorded display facts needed by this receiver before the referenced work arrives. */
  readonly baseline?: readonly PersistedEventInfo[]
  readonly agents: readonly {
    readonly agentId: string
    readonly dispatch?: string
    /** Immediate parent supplied by core; the complete chain consists of these canonical links. */
    readonly parentAgentId?: string
    readonly complete: boolean
  }[]
  readonly tools: readonly {
    readonly callId: string
    /** Absent until a recorded dispatch identifies the agent that made this call. */
    readonly agentId?: string
  }[]
  readonly dispatches: readonly {
    readonly callId: string
    readonly agentIds: readonly string[]
  }[]
}

export interface WorkAncestryContext {
  readonly missing: readonly { readonly kind: 'agent' | 'tool' | 'dispatch'; readonly id: string }[]
  readonly truncated: boolean
}

export type WorkAncestry =
  | (WorkAncestryFacts & WorkAncestryContext & { readonly update?: false; readonly reset?: true })
  | (WorkAncestryFacts &
      Partial<WorkAncestryContext> & { readonly update: true; readonly reset?: true })
