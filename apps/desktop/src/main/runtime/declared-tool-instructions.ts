import { MAX_TOOL_TEXT } from '@brobot2/runtime'
import type { PersistedEvent } from '../db/ledger-row-types'

/** MCP refreshes on resume; legacy dynamic declarations retain their start's words. */
export function declaredToolInstructions(
  row: PersistedEvent | null,
  before: (ordinal: number) => PersistedEvent | null,
): string | null {
  while (
    row?.event.type === 'tool_inventory' &&
    row.event.source === 'thread/resume' &&
    row.event.naming.prefix !== 'mcp__'
  ) {
    row = before(row.ordinal)
  }
  const text = row?.event.type === 'tool_inventory' ? row.event.declared?.instructions : null
  // The inventory clips without a flag, so text at the cap cannot be shown as whole.
  return text != null && text.length < MAX_TOOL_TEXT ? text : null
}
