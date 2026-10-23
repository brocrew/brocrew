import type { BigIntStats } from 'node:fs'
import type { Provider } from '@brobot2/shared'
export interface Entry {
  readonly path: string
  readonly stat: BigIntStats
  readonly directory: boolean
}

export interface TranscriptToClear {
  readonly home: string
  readonly provider: Provider
  readonly session: string
  readonly file: string
  readonly directory: string | null
  readonly cutoff: number
  readonly entries: readonly Entry[]
}

export interface TranscriptClearList {
  readonly root: string
  readonly rootIdentity: BigIntStats | null
  readonly entries: readonly TranscriptToClear[]
}

export interface TranscriptClearBatch extends TranscriptClearList {
  /** The last examined name; a later start can resume after a completed batch. */
  readonly through: string
}

export type ProviderHomeInUse = (home: string, provider: Provider) => boolean
