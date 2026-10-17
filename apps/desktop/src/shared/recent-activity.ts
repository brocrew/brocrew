import type { TranscriptsCleared } from './transcript-retention'
import type { DigestRead } from './digest'

export const RECENT_ACTIVITY_LINES = 200

export interface ActivityLine {
  readonly id: string
  readonly at: number
  readonly what: 'finished' | 'failed' | 'started' | 'stopped'
  readonly register: 'observed' | 'claimed'
  readonly piece: { readonly id: string; readonly label: string; readonly title: string | null }
  readonly agent: string
  readonly conversation: string | null
}

export interface RecentActivityReading {
  readonly transcriptsCleared?: readonly TranscriptsCleared[]
  readonly window: { readonly from: number; readonly to: number }
  readonly read: DigestRead
  readonly lines: readonly ActivityLine[]
  /** More matching lines exist in the bounded reading than are displayed. */
  readonly capped: boolean
}
