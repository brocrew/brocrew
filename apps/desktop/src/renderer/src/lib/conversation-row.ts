import type { Provider } from '@brobot2/shared'
import type { LibraryEntry } from '../../../shared/runtime-ipc'
import type { AgentFacets, Standing } from './agent-state'
import { basenameOf } from './paths'

export function libraryConversationTitle(entry: LibraryEntry): string {
  return entry.title || basenameOf(entry.cwd) || entry.cwd
}

/** A short mark beside a conversation's title, such as Archived or sub-agent. */
interface ConversationRowMark {
  readonly key: string
  readonly text: string
  /** A class the list styles the mark with, such as `archived` or `child`. */
  readonly tone?: string
  readonly hint?: string
  readonly cy?: string
}

/**
 * Everything one conversation row draws, in the words it draws them. Each list builds this from the
 * facts it holds; `ConversationRow` only draws it.
 *
 * - `head`: `brobot` rows say their address in the title; `worker` rows say the worker's name with
 *   its state word beside it.
 */
export interface ConversationRowView {
  readonly id: string
  /** The plate's facets, or null for a row with no live state (a library entry). */
  readonly facets: AgentFacets | null
  readonly plateLabel: string
  readonly head: 'brobot' | 'worker' | 'plain'
  /** The title is the recorded one (the conversation has an address). */
  readonly canonical?: boolean
  readonly title: string
  readonly titleHint?: string
  readonly marks?: readonly ConversationRowMark[]
  /** The worker's state word, drawn on the title line. */
  readonly topWord?: string
  readonly topWordHint?: string
  readonly status: {
    readonly profile?: string | null
    readonly provider?: Provider | null
    readonly word?: string | null
    readonly detail?: string
    readonly standing?: Standing
    readonly needing?: string | null
    readonly activityAt?: number
    readonly elsewhere?: string | null
    readonly place?: string | null
    /** The whole status as one line, for its hover, when it differs from the drawn parts. */
    readonly hint?: string
    /** Free words after the place, such as a size or how it ended, each with its own data-cy. */
    readonly tail?: readonly (string | ConversationRowTail)[]
  }
  /** The conversation's address, for the identity line. */
  readonly address?: string | null
  /** The provider, said on the identity line. */
  readonly addressProvider?: Provider | null
  readonly namedByYou?: boolean
  readonly pieces?: readonly {
    readonly key: string
    readonly text: string
    readonly lead?: string
    readonly cy?: string
  }[]
  readonly opening?: string | null
}

/** One word after the place that a list addresses on its own. */
interface ConversationRowTail {
  readonly text: string
  readonly cy?: string
  readonly hint?: string
}

/** The `data-cy` names a list keeps for the parts of its rows. */
export interface ConversationRowCy {
  readonly title?: string
  readonly topWord?: string
  readonly profile?: string
  readonly word?: string
  readonly place?: string
  readonly address?: string
  readonly opening?: string
  readonly provider?: string
  readonly tail?: string
  readonly elsewhere?: string
}
