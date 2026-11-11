import type { RuntimeEvent } from '../../../shared/runtime-ipc'

export function turnSummaryLine(
  summary: Omit<Extract<RuntimeEvent, { type: 'turn_summary' }>, 'type'>,
): string {
  return `${summary.status} · ${summary.detail}${summary.needsAction ? ' · Needs action' : ''}`
}
