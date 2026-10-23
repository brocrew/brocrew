import type { TranscriptToClear } from '../transcript-retention-types'
import type { ProviderSessionOf } from '../db/conversation-tree'
import type { ProviderFile, MemoryNote } from '../conversation-file-io'
import type { ChildWorkPart } from '../child-work-file'
import type { ChildWorkResult } from '../../shared/runtime-ipc'
import type { TurnAsked, TurnReadingOptions, TurnReading } from '../archive/turn-reading'
import type { FileEdits, SessionRef } from '@brobot2/runtime'
import type { Discovery, ProviderDescription } from '../adopt/discovery-types'
import type { ImportedTranscript, ResolveImagePath } from '../archive/transcript-types'
export interface TranscriptPolicy {
  readEarlierModel?(home: string, file: string): string | null
  keepEarlierReportedEffort(): boolean
  whatDeletionLeaves(): string[]
  noModelMessageReason?(words: string): string | null
  imageResolver?(
    threadId: string,
    home: () => string | null,
    resolveAsset: (candidate: string) => string | null,
  ): ResolveImagePath
  scanRetention(
    input: RetentionScan,
  ): AsyncGenerator<{ path: string; candidate: TranscriptToClear | null }>
  filesOf(home: string, sessions: readonly ProviderSessionOf[]): ProviderFile[]
  memoryNotesOf(home: string, sessions: readonly ProviderSessionOf[]): MemoryNote[]
  readChild(request: ProviderChildWorkRequest): ChildWorkResult
  readTurn(asked: TurnAsked, options: TurnReadingOptions): TurnReading
  parse(
    frames: string[],
    fallbackAt: number,
    options?: { edits?: FileEdits | undefined; resolveImage?: ResolveImagePath | undefined },
  ): ImportedTranscript
  nativePath(home: string, ref: SessionRef): string | null
  ownsRecord(home: string, file: string): boolean
  exportPath(home: string, ref: SessionRef, startedAt: number, recordedAt: string): string
  exportSupport(): { format: string; resumable: boolean; note: string }
}
export interface DiscoveryPolicy {
  discover(home: string, profileId: string): Discovery
  userHome(env: NodeJS.ProcessEnv, userHome: string): string
  descriptions?(): Promise<Map<string, ProviderDescription>>
}
export interface ProviderDefinition {
  readonly transcripts: TranscriptPolicy
  readonly discovery: DiscoveryPolicy
}

export interface ProviderChildWorkRequest {
  readonly ref: SessionRef
  readonly updatedAt: number
  readonly part: ChildWorkPart
  readonly agents: readonly string[]
  readonly taskId: string | null
  home(): string
  pathForChild(home: string, ref: SessionRef): string | null
}

export interface RetentionScan {
  readonly home: string
  scanChildren(path: string): AsyncGenerator<string>
  plainDirectory(path: string): Promise<boolean>
  considered(path: string): boolean
  add(file: string, session: string, directory: string | null): Promise<TranscriptToClear | null>
}
