import { STALE_KEY_NOTICE } from './error-words'
import { splitQualified } from '@brobot2/runtime'
import { CLAUDE_TOOL_NAMING, refusalForDisplay } from '@brobot2/runtime/claude'
import { scanRetention } from './retention'
import { signInObservation } from './sign-in-observation'
import { filesOf, memoryNotesOf } from './conversation-files'
import { readChild } from './child-work'
import { readingClaude } from './turn-reading'
import { basename, dirname, join } from 'node:path'
import { importClaudeTranscript } from './import-transcript'
import { nativePath, ownsRecord, newestReplyModel } from './native-record'
import type { TranscriptPolicy } from '../transcript-policy'
import type { TranscriptEvent } from '../../../shared/conversation-events'

/** Supply the same presentation for live events and older stored rows. */
export function eventForDisplay(event: TranscriptEvent): TranscriptEvent {
  const observed = signInObservation(event)
  if (observed.type !== 'error') return observed
  const message = refusalForDisplay(observed.refusal)
  if (message !== null)
    return {
      ...observed,
      presentation: {
        message,
        level: observed.fatal ? 'error' : 'warn',
        terminal: observed.fatal,
        repeat: 'each',
      },
    }
  if (
    observed.presentation === undefined &&
    observed.billingRefused !== true &&
    observed.cause === 'auth_stale' &&
    observed.onAKey === true
  )
    return {
      ...observed,
      presentation: {
        message: STALE_KEY_NOTICE,
        level: 'error',
        terminal: observed.fatal,
        repeat: 'each',
      },
    }
  return observed
}
export const CLAUDE_JSONL = 'claude-jsonl'
export const transcripts: TranscriptPolicy = {
  eventForDisplay,
  splitToolName: (name) => splitQualified(CLAUDE_TOOL_NAMING, name),
  readEarlierModel: (home, file) => (ownsRecord(home, file) ? newestReplyModel(file) : null),
  keepEarlierReportedEffort: () => true,
  whatDeletionLeaves: () => [
    'Claude Code’s prompt history in an agent’s folder, which every conversation of that agent ' +
      'shares, isn’t changed.',
  ],
  scanRetention,
  filesOf,
  memoryNotesOf,
  readChild,
  readTurn: readingClaude,
  parse: (frames, at, options) => importClaudeTranscript(frames, at, options?.edits),
  nativePath,
  ownsRecord,
  exportPath: (home, ref, _at, recordedAt) =>
    join(home, 'projects', basename(dirname(recordedAt)), ref.sessionId + '.jsonl'),
  exportSupport: () => ({
    format: CLAUDE_JSONL,
    resumable: true,
    note: 'Claude looks for a session in this folder first, then by its id — a home with this file in it can resume the conversation, from the same working directory.',
  }),
}

/** The provider of the scheduling receipt format read by this build. */
export const recordedScheduleReceiptProvider = 'claude'
