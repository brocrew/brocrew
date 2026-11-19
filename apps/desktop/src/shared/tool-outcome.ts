import type { RefusalFacts } from './refusals'

export type Refusal = Omit<RefusalFacts, 'told'> & { readonly reason: string }

export type ToolOutcome<T, R extends Refusal = Refusal> =
  ({ readonly ok: true } & T) | { readonly ok: false; readonly refusal: R }

/** Why a conversation that was sent something cannot run now; what was recorded stays recorded. */
export type CannotRun = {
  readonly code: 'provider-file-missing' | 'could-not-start'
  readonly reason: string
}

export type SendRecipientState =
  | { readonly kind: 'started' }
  | { readonly kind: 'queued'; readonly behind: number }
  | { readonly kind: 'cannot-run'; readonly cause: CannotRun; readonly needsPerson?: true }

export interface SendReceipt {
  readonly recorded: {
    readonly kind: 'task'
    readonly id: string
    readonly taskLabel: string | null
  }
  readonly recipient: {
    readonly id: string
    readonly address: string
    readonly title: string
    readonly state: SendRecipientState
  }
  readonly attachments: readonly {
    readonly resource: string
    readonly name: string
    readonly overflowField?: string
  }[]
}

/** Refusals whose published text starts directly with the app's reason. */
export function hasDirectRefusalOpening(text: string): boolean {
  return text.startsWith('Not sent: ')
}
