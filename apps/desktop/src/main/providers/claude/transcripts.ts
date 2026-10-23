import { scanRetention } from './retention'
import { filesOf, memoryNotesOf } from './conversation-files'
import { readChild } from './child-work'
import { readingClaude } from './turn-reading'
import { basename, dirname, join } from 'node:path'
import { importClaudeTranscript } from './import-transcript'
import { nativePath, ownsRecord, newestReplyModel } from './native-record'
import type { TranscriptPolicy } from '../transcript-policy'
export const CLAUDE_JSONL = 'claude-jsonl'
export const transcripts: TranscriptPolicy = {
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

/** The provider of the receipt rows written before the ledger carried a provider field. */
export const recordedScheduleReceiptProvider = 'claude'
