CREATE INDEX events_ancestry_tool_idx ON events (session_id, generation, CASE WHEN json_valid(payload) THEN json_extract(payload, '$.id') END, ordinal) WHERE type = 'tool_call';
--> statement-breakpoint
CREATE INDEX events_ancestry_agent_idx ON events (session_id, generation, CASE WHEN json_valid(payload) THEN json_extract(payload, '$.agentId') END, CASE WHEN CASE WHEN json_valid(payload) THEN json_extract(payload, '$.parentToolCallId') END IS NULL THEN 0 ELSE 1 END, ordinal) WHERE type = 'sub_agent';
--> statement-breakpoint
CREATE INDEX events_ancestry_dispatch_idx ON events (session_id, generation, CASE WHEN json_valid(payload) THEN json_extract(payload, '$.parentToolCallId') END, ordinal) WHERE type = 'sub_agent' AND CASE WHEN json_valid(payload) THEN json_extract(payload, '$.parentToolCallId') END IS NOT NULL;
