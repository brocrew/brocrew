import { imageResolver } from './images'
import { scanRetention } from './retention'
import { filesOf, memoryNotesOf } from './conversation-files'
import { readChild } from './child-work'
import { readingCodex } from './turn-reading'
import { join } from 'node:path'
import { localFields } from '../../../shared/local-time'
import { importCodexRollout } from './import-transcript'
import { nativePath, ownsRecord } from './native-record'
import type { TranscriptPolicy } from '../transcript-policy'
export const CODEX_ROLLOUT_JSONL = 'codex-rollout-jsonl'
export const transcripts: TranscriptPolicy = {
  imageResolver,
  keepEarlierReportedEffort: () => false,
  whatDeletionLeaves: () => [
    'Codex’s own list of conversations in an agent’s folder isn’t changed; it then names a ' +
      'transcript that’s gone.',
    'Codex keeps no memory note BroCrew can tie to one conversation, so none is listed.',
  ],
  noModelMessageReason: (words) =>
    words.trim() === '/compact'
      ? 'This was a command for Codex’s own compaction. No words reached the model.'
      : null,
  scanRetention,
  filesOf,
  memoryNotesOf,
  readChild,
  readTurn: readingCodex,
  parse: (frames, at, options) =>
    importCodexRollout(frames, at, { resolveImage: options?.resolveImage }),
  nativePath,
  ownsRecord,
  exportPath: (targetHome, ref, startedAt) => {
    const when = localFields(startedAt)
    const [year, month, day] = [
      String(when.year),
      String(when.month + 1).padStart(2, '0'),
      String(when.date).padStart(2, '0'),
    ]
    const stamp = `${year}-${month}-${day}T${String(when.hours).padStart(2, '0')}-${String(
      when.minutes,
    ).padStart(2, '0')}-${String(when.seconds).padStart(2, '0')}`
    return join(targetHome, 'sessions', year, month, day, `rollout-${stamp}-${ref.sessionId}.jsonl`)
  },
  exportSupport: () => ({
    format: CODEX_ROLLOUT_JSONL,
    resumable: true,
    note: 'Codex finds a thread by its id anywhere under sessions/ — a home with this file in it can resume the conversation, from the same working directory.',
  }),
}
