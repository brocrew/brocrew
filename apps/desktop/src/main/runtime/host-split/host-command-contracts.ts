import type { ToolRefusal } from '../../../shared/refusals'
import type {
  ProfileReport,
  RulesOnARecord,
  ConversationOnARecord,
  PieceOnARecord,
} from '../agent-records'
import type { MadeByItsProfile, APieceItHolds, EndedPieceDetail } from '../work-records'
import type { AgentIdentity, IdentityCreator } from '../../../shared/runtime-ipc'
import type { OwnInstructionsVersion } from '../../../shared/own-instructions'
import type { AgentModelChoice } from '../../../shared/model-choice-contracts'
import type { McpServerRequestWho } from '../../../shared/mcp-server-requests'
import type { Told, NewBriefDelivery } from '../message-records'
import type { TaskOutcome } from '../../../shared/task-contracts'
import type { UnreadQuestion } from '../../../shared/questions'
import type { ResourceRefusal } from '../../resources/resources'
import type { ResourceRole } from '../../../shared/documents'

/** Exactly one field names what ends the wait. */
export interface WaitOnAsked {
  /** A piece label or id, or an agent question id. */
  readonly agent?: string
  /** The id of a question or to-do waiting on the person. */
  readonly person?: string
  /** The time at which the wait ends. */
  readonly time?: string
  /** A scheduled job or background task id. */
  readonly event?: string
}

export type TheCopiesRefusal = Extract<
  ToolRefusal,
  'a-conversation-with-its-questions-is-starting' | 'its-questions-could-not-all-be-read'
>

/** The recorded take-back and actual delivery outcome, even when its holder was not told. */
export type TakeBackOutcome =
  | ({
      readonly ok: true
      readonly piece: string

      readonly label: string

      readonly owner: string

      /** Whether a held brief or rebrief was actually removed with the piece. */
      readonly tookBackTheMessage: boolean

      /** Questions that actually ended with this take-back; zero is an ordinary result. */
      readonly endedQuestions: number

      /** Only a service's active piece can request a stop, while an agent may stop its turn. */
      readonly askedItsTurnToStop: boolean

      /** A service held it; after withdrawal its turn is no longer the caller's to stop. */
      readonly atAService: boolean
    } & Told)
  | { readonly ok: false; readonly refused: TakeBackRefused }

export type TakeBackRefused =
  | {
      readonly rail: Extract<ToolRefusal, 'not-a-piece-you-gave'>

      /** Present for the caller's own piece, absent for an unknown or unreadable record. */
      readonly itHoldsIt?: APieceItHolds
    }
  | {
      readonly rail: Extract<ToolRefusal, 'that-piece-was-already-answered'>
      readonly label: string

      readonly outcome: TaskOutcome | null

      /** Resource ids actually carried by the completed reply; empty when it carried none. */
      readonly resources: readonly string[]

      readonly endedAt: number | null
    }
  | {
      readonly rail: Extract<ToolRefusal, 'that-piece-was-already-taken-back'>
      readonly label: string
    }
  | {
      readonly rail: Extract<ToolRefusal, 'that-piece-was-already-closed'>
      readonly label: string
    }
  | {
      readonly rail: Extract<ToolRefusal, 'that-work-is-being-sent'>
      readonly label: string
    }
  | {
      readonly rail: TheCopiesRefusal
      readonly label: string
      readonly unreadQuestion?: UnreadQuestion
    }
  | {
      readonly rail: Extract<ToolRefusal, 'that-conversation-has-not-started'>
      readonly label: string
    }

/** Held words or a due job start it now; wakesAt is epoch milliseconds; null stays stopped. */
export type CarriesOn = 'starting' | { readonly wakesAt: number } | null

/** Actual restored conversations and how each carries on. */
export type RestoredByAnAgent =
  | {
      readonly is: 'restored'
      readonly conversations: readonly {
        readonly conversation: string
        readonly carriesOn: CarriesOn
      }[]

      /** Read time used to place each scheduled wake on a day. */
      readonly readAt: number
    }
  | { readonly is: 'no-such-agent' }
  | { readonly is: 'not-archived' }
  | { readonly is: 'being-set-aside'; readonly said: string }
  | { readonly is: 'could-not'; readonly said: string }

export type AgentRecordReading =
  | { readonly is: 'no-agent-by-that-name' }
  | { readonly is: 'a-record'; readonly record: AgentRecord }

/** One bounded record; omitted items and failed reads are counted separately. */
export interface AgentRecord {
  readonly agent: ProfileReport
  readonly rules: RulesOnARecord

  readonly conversations: readonly ConversationOnARecord[]

  /** Conversations omitted from this bounded record. */
  readonly conversationsNotListed: number

  readonly pieces: readonly PieceOnARecord[]

  /** Newest pieces whose ledgers could not be read, separate from older pieces not listed. */
  readonly piecesUnread: number

  /** Older pieces omitted from this bounded record. */
  readonly piecesNotListed: number

  readonly files: (MadeByItsProfile & { readonly is: 'listed' })['made']

  /** Files omitted from this bounded record. */
  readonly filesNotListed: number

  /** Individual rows that could not be read. */
  readonly rowsUnread: number

  /** Whole ledgers skipped because they were unavailable, rather than individual failed rows. */
  readonly ledgersSkipped?: number

  /** When the record was read, in epoch milliseconds. */
  readonly readAt: number
}

/**
 * Facts written and delivery observed by this update. A null delivery means nothing tells the owner;
 * a title, status line or files its owner made can change without a notice. Written facts stand
 * even when delivery fails.
 */
export type UpdateWorkOutcome =
  | ({
      readonly ok: true
      readonly piece: string
      readonly label: string

      readonly owner: string

      /** Title actually set by this call, or null. */
      readonly title: string | null

      /** Status actually set by this call, or null. */
      readonly status: string | null

      readonly rebriefed: boolean
      readonly definitionOfDone?: string | null

      /** Files actually kept, with their recorded roles; empty when none were kept. */
      readonly kept: readonly {
        readonly resource: string
        readonly name: string
        readonly role: ResourceRole
      }[]

      /** Actual close facts, or null when this call did not close the piece. */
      readonly closed: {
        readonly tookBackTheMessage: boolean
        readonly endedQuestions: number
      } | null

      /** Whether closing a service's active piece actually requested its turn to stop. */
      readonly askedItsTurnToStop: boolean

      /** A service holds it; after a close its turn is no longer the caller's to stop. */
      readonly atAService: boolean
    } & (Told<NewBriefDelivery> | { readonly delivery: null }))
  | {
      readonly ok: false
      readonly rail: Exclude<ToolRefusal, 'that-piece-has-ended' | TheCopiesRefusal>
      readonly detail: Readonly<Record<string, unknown>>
    }
  | {
      readonly ok: false
      readonly rail: TheCopiesRefusal
      readonly detail: {
        readonly piece: string
        readonly label: string
        readonly unreadQuestion?: UnreadQuestion
      }
    }
  | {
      readonly ok: false
      readonly rail: 'that-piece-has-ended'
      readonly detail: EndedPieceDetail

      readonly readAt: number
    }
  | { readonly ok: false; readonly resourceRefusal: ResourceRefusal }

export type TakeOnWorkOutcome =
  | {
      readonly ok: true
      readonly piece: string
      readonly label: string
      readonly title: string

      readonly root: string
      readonly notice: 'sent' | 'held' | 'not-delivered' | null
      readonly queued: boolean
    }
  | { readonly ok: false; readonly resourceRefusal: ResourceRefusal }
  | {
      readonly ok: false
      readonly rail: Extract<
        ToolRefusal,
        'malformed-request' | 'no-work-of-your-own' | 'work-record-unavailable'
      >
      readonly detail: Readonly<Record<string, unknown>>
    }

export type CreateAgentOutcome =
  | {
      readonly ok: true
      readonly identity: AgentIdentity

      /** The first rules version actually written, or null when none was written. */
      readonly rules: OwnInstructionsVersion | null

      /** Default model and effort read back after creation, or null when none was set. */
      readonly defaultModel: AgentModelChoice | null
    }
  | {
      readonly ok: false
      readonly rail: ToolRefusal
      readonly detail: Readonly<Record<string, unknown>>
    }

export type MayCreateAgents =
  | {
      readonly ok: true

      /** Creator read once and carried into identity provenance, rather than read again. */
      readonly creator: IdentityCreator
    }
  | {
      readonly ok: false
      readonly rail: ToolRefusal
      readonly detail: Readonly<Record<string, unknown>>
    }

/** The instruction request actually written, or the refusal that prevented it. */
export type ProposeRulesOutcome =
  | { readonly ok: true; readonly wrote: 'a-request'; readonly askId: string }
  | {
      readonly ok: false
      readonly rail: ToolRefusal
      readonly detail: Readonly<Record<string, unknown>>
    }

export type AgentOwnNotesOutcome<T> =
  | { readonly ok: true; readonly result: T }
  | {
      readonly ok: false
      readonly rail: ToolRefusal
      readonly detail: Readonly<Record<string, unknown>>
    }

export type AgentRulesOutcome<T> =
  | { readonly ok: true; readonly result: T }
  | {
      readonly ok: false
      readonly rail: ToolRefusal
      readonly detail: Readonly<Record<string, unknown>>
    }

/** The server request actually put before the person, or its refusal. */
export type McpServerRequestOutcome =
  | { readonly ok: true; readonly requestId: string }
  | {
      readonly ok: false
      readonly rail: ToolRefusal
      readonly detail: Readonly<Record<string, unknown>>
    }

/** Checked words of a server request, with its intended recipients and optional piece. */
export interface McpServerAsked {
  readonly name: string
  readonly url: string
  readonly reaches: string
  readonly whoGetsIt: McpServerRequestWho

  /** Profiles when whoGetsIt is only-these-agents; empty when it is everyone. */
  readonly agents: readonly string[]

  /** The caller's own piece, by label or id, or null when none was named. */
  readonly piece: string | null
}
