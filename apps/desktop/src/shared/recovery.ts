import type { TranscriptEvent, WorkAncestry } from './conversation-events'
import type { Provider } from '@brobot2/shared'
import type { LocalZone } from './local-time'
import type { MessagePath, MessagePathAsk, MessagePathTarget, RevealResult } from './runtime-ipc'

/** What the start-up check decided before the app opened its data. */
export type StartupVerdict =
  | { readonly kind: 'open'; readonly checkpoint: 'made' | 'not-needed' }
  | {
      readonly kind: 'newer'
      readonly workspace: string
      readonly newer: NewerFacts
      readonly offers: OfferedCheckpoint | null
    }
  | { readonly kind: 'history-only'; readonly gate: HistoryOnlyGate; readonly database: string }
  | { readonly kind: 'working'; readonly what: 'check' | 'checkpoint' | 'restore' | 'return' }
  | {
      readonly kind: 'failed'
      readonly reason: StartFailure
      readonly canRetry: boolean
      readonly ownership?: 'taken' | 'unknown'
      /** For `replaced-outside`: which record no longer matches the disk. */
      readonly where?: 'journal' | 'gate'
      /** For `replaced-outside` at the gate: when the restored copy was made (ISO). */
      readonly checkpointCreatedAt?: string
      /** Which journaled operation failed, when one did. */
      readonly during?: 'restore' | 'return'
      /** The check's own sentence, shown small so a person can quote it. */
      readonly detail?: string
    }

/** A checked copy this build can open. */
export interface OfferedCheckpoint {
  readonly id: string
  /** ISO; the window formats it in local time. */
  readonly createdAt: string
  readonly bytes: number
}

/** Why a newer database is refused. */
export interface NewerFacts {
  /** Migrations recorded in the database. */
  readonly inTheDatabase: number
  /** Migrations this build knows. */
  readonly inTheBuild: number
  /** The build that wrote the newest copy past this one's schema, when a manifest names it. */
  readonly madeBy?: { readonly appVersion: string } | null
}

export type StartFailure =
  | 'not-the-only-app-on-this-folder'
  | 'database-unreadable'
  | 'checkpoint-failed'
  | 'migration-failed'
  | 'replaced-outside'
  | 'recovery-unreadable'
  | 'restore-failed'
  /** The data opened, then something else in the start failed; `detail` says what. */
  | 'start-failed'

/** The history-only gate file (`recovery/history-only.json`), as main read it. */
export interface HistoryOnlyGate {
  readonly format: 'brobot-history-only'
  readonly version: 1
  readonly restoreId: string
  readonly checkpointId: string
  /** ISO. */
  readonly checkpointCreatedAt: string
  readonly installed: readonly InstalledFile[]
  /** The newer database set aside, relative to the data folder: `recovery/preserved/<restoreId>`. */
  readonly preserved: string
  readonly preservedFiles: readonly PreservedFile[]
}

/** A live file as a restore left it: there with these bytes, or not there. */
export type InstalledFile =
  | { readonly live: string; readonly present: true; readonly sha256: string }
  | { readonly live: string; readonly present: false }

/** A live file as a restore set it aside: there with these bytes, or not there. */
export type PreservedFile = InstalledFile

/** One conversation in the restored copy. */
export interface HistoryConversation {
  readonly id: string
  readonly title: string | null
  readonly agent: string | null
  readonly provider: Provider
  readonly createdAt: number
  readonly updatedAt: number
}

/** One stored event of a conversation, with when it was recorded (epoch ms). */
export interface HistoryEvent {
  readonly errorFacts?: import('./error-facts').ErrorFacts
  readonly workAncestry?: WorkAncestry
  readonly event: TranscriptEvent
  readonly at: number
}

/** Reads the restored copy through a read-only connection in main. */
export interface HistoryReader {
  /** Every conversation in the restored copy, newest activity first. */
  conversations(): Promise<readonly HistoryConversation[]>
  /** One conversation's stored events, in order. */
  transcript(id: string): Promise<readonly HistoryEvent[]>
}

export interface RecoveryBridge {
  verdict(): Promise<StartupVerdict>
  restore(checkpointId: string): Promise<StartupVerdict>
  returnToNewer(): Promise<StartupVerdict>
  retry(): Promise<StartupVerdict>
  /** Returns the function that stops listening. */
  onProgress(listener: (done: number, total: number) => void): () => void
  onVerdict(listener: (verdict: StartupVerdict) => void): () => void
  quit(): Promise<void>
  /** The computer's own time zone, as the main window's `localZone` reads it. */
  zone(): Promise<LocalZone | null>
  history: HistoryReader
  resolveMessagePaths(ask: MessagePathAsk): Promise<MessagePath[]>
  /** Shows a message's path in the file manager. */
  revealMessagePath(target: MessagePathTarget): Promise<RevealResult>
}

/** A progress report: `done` of `total` units of the running step. */
export type ProgressListener = (done: number, total: number) => void

/** The main-process service behind the recovery window's IPC. */
export interface RecoveryService {
  inspect(): Promise<StartupVerdict>
  restore(checkpointId: string, progress: ProgressListener): Promise<StartupVerdict>
  returnToNewer(progress: ProgressListener): Promise<StartupVerdict>
  /** After a `failed` verdict with `canRetry`. */
  retry(): Promise<StartupVerdict>
}

/** The main→renderer progress message on {@link RECOVERY_CHANNELS}`.progress`. */
export interface RecoveryProgress {
  readonly done: number
  readonly total: number
}

export const RECOVERY_CHANNELS = {
  verdict: 'recovery:verdict',
  restore: 'recovery:restore',
  return: 'recovery:return',
  retry: 'recovery:retry',
  quit: 'recovery:quit',
  zone: 'recovery:zone',
  conversations: 'recovery:conversations',
  transcript: 'recovery:transcript',
  messagePaths: 'recovery:message-paths',
  revealMessagePath: 'recovery:reveal-message-path',
  /** Main to the window: a {@link RecoveryProgress}. */
  progress: 'recovery:progress',
} as const

export type RecoveryChannel = (typeof RECOVERY_CHANNELS)[keyof typeof RECOVERY_CHANNELS]
