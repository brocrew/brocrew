import type { RuntimeEvent } from '../events'

// Only observed fields supply a summary; malformed frames retain the unknown-event path.
export function summaryEvents(message: { readonly subtype: string }): RuntimeEvent[] | null {
  const fields = message as Record<string, unknown>
  if (message.subtype === 'post_turn_summary') {
    const status = fields['status_category']
    const detail = fields['status_detail']
    const needsAction = fields['needs_action']
    if (
      typeof status !== 'string' ||
      status.trim() === '' ||
      typeof detail !== 'string' ||
      detail.trim() === '' ||
      typeof needsAction !== 'string'
    )
      return null
    return [
      {
        type: 'turn_summary',
        detail,
        needsAction,
        ...(['completed', 'review_ready', 'blocked'].includes(status) ? { status } : {}),
      },
    ]
  }
  if (message.subtype === 'task_summary') {
    const description = fields['detail']
    if (description === null) return []
    return typeof description === 'string' && description.trim() !== ''
      ? [{ type: 'command_summary', description }]
      : null
  }
  return null
}
