import { basename } from 'node:path'
import { readChildFile, MAX_CHILD_WORK_BYTES } from '../../child-work-file'
import { importCodexRollout } from './import-transcript'
import type { ProviderChildWorkRequest } from '../transcript-policy'
import type { ChildWorkResult } from '../../../shared/runtime-ipc'
import { errorFactsForEvent } from '../error-diagnostic'
import { completeTranscriptLines } from '../complete-transcript-lines'
export function readChild(request: ProviderChildWorkRequest): ChildWorkResult {
  if (request.part !== 'transcript') return { ok: false, reason: 'unsupported' }
  const agentId = request.agents[0]!
  const home = request.home()
  // The provider's index locates the child's thread; do not reconstruct its rollout path.
  const path = request.pathForChild(home, {
    ...request.ref,
    sessionId: agentId,
  })
  if (path === null) return { ok: false, reason: 'gone' }
  const read = readChildFile(path, MAX_CHILD_WORK_BYTES)
  if (typeof read === 'string') return { ok: false, reason: read }
  const lines = completeTranscriptLines(read.text, read.truncated)
  const parsed = importCodexRollout(lines, request.updatedAt)
  return {
    ok: true,
    part: 'transcript',
    taskId: null,
    runId: null,
    name: basename(read.path),
    text: read.text,
    truncated: read.truncated,
    bytes: read.bytes,
    entries: parsed.entries.map((entry) => entry.event),
    errorFacts: parsed.entries.map((entry) => errorFactsForEvent(entry.event)),
    unreadable: parsed.unreadable,
  }
}
