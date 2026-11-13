export function isTurnScopedContent(method: string): boolean {
  return TURN_SCOPED_METHODS.has(method)
}

// Stale content, plan snapshots and diff snapshots must match the current response-bound turn.
const TURN_SCOPED_METHODS = new Set([
  'item/agentMessage/delta',
  'item/started',
  'item/completed',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/summaryPartAdded',
  'turn/plan/updated',
  'item/commandExecution/outputDelta',
  'thread/tokenUsage/updated',
  'item/fileChange/patchUpdated',
  'turn/diff/updated',
])

// This frame names its child subject rather than the scope of parent content.
// Other foreign frames remain dropped as content even when they report on an existing child card.
const THREAD_SUBJECT_METHODS = new Set(['thread/status/changed'])

// A later tool use means the model moved on from prior commands; reasoning and messages do not.
export const TOOL_USES: ReadonlySet<string> = new Set([
  'commandExecution',
  'fileChange',
  'mcpToolCall',
  'dynamicToolCall',
  'collabAgentToolCall',
  'webSearch',
  'imageView',
  'imageGeneration',
])

// Only the model's own spawn or input acts mean it moved on from prior commands.
export const SUB_AGENT_USES: ReadonlySet<string> = new Set(['started', 'interacted'])

export function notificationScopeSummary(
  foreignThreadDrops: ReadonlyMap<string, number>,
  seen: number,
  adopted: number,
) {
  let dropped = 0
  const byMethod: Record<string, number> = {}
  for (const [method, count] of foreignThreadDrops) {
    dropped += count
    byMethod[method] = count
  }
  return { seen: seen, dropped, adopted: adopted, byMethod }
}

// Keep attribution bounded without losing the total for additional provider method names.
const MAX_ATTRIBUTED_DROP_METHODS = 32
const OTHER_DROP_METHODS = '(other)'

export function countForeignDrop(drops: Map<string, number>, method: string): void {
  const key =
    drops.has(method) || drops.size < MAX_ATTRIBUTED_DROP_METHODS ? method : OTHER_DROP_METHODS
  drops.set(key, (drops.get(key) ?? 0) + 1)
}

import type { SessionRef } from '../../session-ref'
import { readString } from './wire-values'

export function namesForeignThread(
  method: string,
  params: unknown,
  ref: SessionRef | null,
): boolean {
  if (THREAD_SUBJECT_METHODS.has(method)) return false
  if (!ref) return false
  const threadId = readString(params, 'threadId')
  return threadId !== '' && threadId !== ref.sessionId
}
