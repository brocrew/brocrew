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
  return row?.event.type === 'tool_inventory' ? (row.event.declared?.instructions ?? null) : null
}
