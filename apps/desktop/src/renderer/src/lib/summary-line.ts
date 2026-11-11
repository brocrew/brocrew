import type { RuntimeEvent } from '../../../shared/runtime-ipc'

export function turnSummaryLine(
  summary: Omit<Extract<RuntimeEvent, { type: 'turn_summary' }>, 'type'>,
): string {
  if (summary.status === undefined) return summary.detail
  return `${summary.status} · ${summary.detail}${summary.needsAction.trim() !== '' ? ` · ${summary.needsAction}` : ''}`
}
