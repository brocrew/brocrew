/** Expressions shared by the migration's identity seeks and schema declarations. */
export const ANCESTRY_TOOL_ID =
  "CASE WHEN json_valid(payload) THEN json_extract(payload, '$.id') END"
export const ANCESTRY_AGENT_ID =
  "CASE WHEN json_valid(payload) THEN json_extract(payload, '$.agentId') END"
export const ANCESTRY_DISPATCH_ID =
  "CASE WHEN json_valid(payload) THEN json_extract(payload, '$.parentToolCallId') END"
export const ANCESTRY_AGENT_TERM = "type = 'sub_agent'"
export const ANCESTRY_HAS_DISPATCH = `CASE WHEN ${ANCESTRY_DISPATCH_ID} IS NULL THEN 0 ELSE 1 END`
export const ANCESTRY_TOOL_TERM = "type = 'tool_call'"

export const ANCESTRY_ACCESS = {
  tool: {
    index: 'events_ancestry_tool_idx',
    expression: ANCESTRY_TOOL_ID,
    term: ANCESTRY_TOOL_TERM,
  },
  agent: {
    index: 'events_ancestry_agent_idx',
    expression: ANCESTRY_AGENT_ID,
    term: ANCESTRY_AGENT_TERM,
  },
  dispatch: {
    index: 'events_ancestry_dispatch_idx',
    expression: ANCESTRY_DISPATCH_ID,
    term: `type = 'sub_agent' AND ${ANCESTRY_DISPATCH_ID} IS NOT NULL`,
  },
} as const
