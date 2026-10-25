/** Shared with the schema so these bounded seeks imply their partial indexes exactly. */
export const HUMAN_PROMPT_TERM = "type = 'user_turn' AND CASE WHEN json_valid(payload) THEN json_extract(payload, '$.humanInitiated') = 1 OR (json_type(payload, '$.humanInitiated') IS NULL AND COALESCE(json_extract(payload, '$.attribution'), '') != 'app_authored') ELSE 0 END"
export const HUMAN_FINAL_TERM = "type = 'assistant_message' AND CASE WHEN json_valid(payload) THEN json_extract(payload, '$.phase') = 'final' AND json_type(payload, '$.parentToolCallId') IS NULL ELSE 0 END"
