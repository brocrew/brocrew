import type { RuntimeEvent } from '../events'

// These undocumented frames are optional. Only the reported fields supply a summary.
export function summaryEvents(message: { readonly subtype: string }): RuntimeEvent[] | null {
  const fields = message as Record<string, unknown>
  if (message.subtype === 'post_turn_summary') {
    const status = fields['status_category']
    const detail = fields['status_detail']
    const needsAction = fields['needs_action']
    return typeof status === 'string' && status.trim() !== '' &&
      typeof detail === 'string' && detail.trim() !== '' && typeof needsAction === 'boolean'
      ? [{ type: 'turn_summary', status, detail, needsAction }]
      : []
  }
  if (message.subtype === 'task_summary') {
    const description = fields['detail']
    return typeof description === 'string' && description.trim() !== ''
      ? [{ type: 'command_summary', description }]
      : []
  }
  return null
}
