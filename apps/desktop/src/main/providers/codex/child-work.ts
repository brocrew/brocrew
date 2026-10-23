import { basename } from 'node:path'
import { readChildFile, MAX_CHILD_WORK_BYTES } from '../../child-work-file'
import { importCodexRollout } from './import-transcript'
import type { ProviderChildWorkRequest } from '../transcript-policy'
import type { ChildWorkResult } from '../../../shared/runtime-ipc'
export function readChild(request: ProviderChildWorkRequest): ChildWorkResult {
  if (request.part !== 'transcript') return { ok: false, reason: 'unsupported' }
  const agentId = request.agents[0]!
  const home = request.home()
  // The parent's ref with the CHILD's id: for Codex the lookup is by thread id alone, and the
  // rollout's real location is whatever the provider recorded — never a path we built.
  const path = request.pathForChild(home, {
    ...request.ref,
    sessionId: agentId,
  })
  if (path === null) return { ok: false, reason: 'gone' }
  // ⚑ `726` · R92 — no root: the path the provider's own index names is read wherever it is
  // (`readChildFile`). Until `726` it had to be under the home's `sessions/` or
  // `archived_sessions/`.
  // 🔴 **731 · and no `.jsonl` allow-list.** From the 115 review until `731` the path, and since
  // `726`'s review where it LANDS, had to end `.jsonl` — a check that *"refuses nothing real"*
  // (2,012 of 2,012 measured rollouts end so) and existed to refuse `auth.json`. The PM, ruling on
  // `726` §9: *"A type allow-list whose purpose is keeping credentials out goes."* A binary is still
  // refused by `readTextFile`: it cannot be drawn as text.
  const read = readChildFile(path, MAX_CHILD_WORK_BYTES)
  if (typeof read === 'string') return { ok: false, reason: read }
  const lines = read.text.split('\n')
  const cutMidLine = read.truncated && !read.text.endsWith('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  if (cutMidLine) lines.pop()
  const parsed = importCodexRollout(lines, request.updatedAt)
  return {
    ok: true,
    part: 'transcript',
    // ⛔ No run, and no task: a thread belongs to neither, and `112`'s field says so rather than
    // borrowing the parent's id to fill the shape.
    taskId: null,
    runId: null,
    name: basename(read.path),
    text: read.text,
    truncated: read.truncated,
    bytes: read.bytes,
    entries: parsed.entries.map((entry) => entry.event),
    unreadable: parsed.unreadable,
    // ⛔ **No `thinkingBlocks`, and that is 109's asymmetry rule rather than an omission.**
    // `countThinkingBlocks` measures Claude's `message.content[].type === 'thinking'` records; a
    // rollout has no such shape, so running it here would return `0` — a number we never
    // measured, about a provider that does not report the thing at all. Absent means "not said",
    // which is the truth, and the viewer already draws nothing for it.
  }
}
