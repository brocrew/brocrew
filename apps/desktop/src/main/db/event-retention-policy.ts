const HISTORY_TYPES = [
  'provider_commands',
  'tool_inventory',
  'launched',
  'unknown',
  'file_change',
  'thinking',
  'assistant_delta',
  'activity',
  'context_reading',
  'plan_update',
  'memory_recall',
  'memory_loaded',
  'turn_summary',
  'command_summary',
  'tool_refused',
  'instruction_changed',
  'work_sent',
  'work_reported',
  'project_proposed',
  'proposal_ended',
] as const

/** Existing event fields only; callers may select one conversation or an offline whole-copy measurement. */
export const eventRetentionRowsSQL = `WITH active AS MATERIALIZED (
    SELECT s.id, coalesce(d.active,0) AS generation
    FROM provider_session s LEFT JOIN derived_generation d ON d.session_id=s.id
    WHERE @session IS NULL OR s.id=@session
  ), epochs AS MATERIALIZED (
    SELECT active.*,
      coalesce((SELECT max(e.ordinal) FROM events e
        WHERE e.session_id=active.id AND e.generation=active.generation
          AND e.type IN ('compaction','conversation_reset')), -1) AS after,
      (SELECT e.id FROM events e WHERE e.session_id=active.id
        AND e.generation=active.generation AND e.type='provider_commands'
        AND CASE WHEN json_valid(e.payload) THEN json_type(e.payload)='object'
          AND json_extract(e.payload,'$.type')=e.type ELSE 0 END
        ORDER BY e.ordinal DESC LIMIT 1) AS command,
      (SELECT e.id FROM events e WHERE e.session_id=active.id
        AND e.generation=active.generation AND e.type='tool_inventory'
        AND CASE WHEN json_valid(e.payload) THEN json_type(e.payload)='object'
          AND json_extract(e.payload,'$.type')=e.type ELSE 0 END
        ORDER BY e.ordinal DESC LIMIT 1) AS inventory,
      (SELECT e.id FROM events e WHERE e.session_id=active.id
        AND e.generation=active.generation AND e.type='tool_inventory'
        AND CASE WHEN json_valid(e.payload) THEN json_type(e.payload)='object'
          AND json_extract(e.payload,'$.type')=e.type
          AND coalesce(json_extract(e.payload,'$.source'),'')!='thread/resume' ELSE 0 END
        ORDER BY e.ordinal DESC LIMIT 1) AS declaration
    FROM active
  ), slim AS MATERIALIZED (
    SELECT e.id, e.rowid AS r, e.session_id AS s, e.type AS t,
      e.created_at AS at, e.generation AS g, e.ordinal AS o,
      octet_length(e.payload) AS bytes,
      e.generation=epoch.generation AS isActive,
      CASE WHEN e.type='unknown' AND json_valid(e.payload) THEN json_array(
        json_extract(e.payload,'$.provider'),json_extract(e.payload,'$.category'),
        coalesce(json_extract(e.payload,'$.label'),json_extract(e.payload,'$.raw.type'),'unlabelled')) ELSE '' END AS k,
      CASE WHEN e.id IN (epoch.command,epoch.inventory,epoch.declaration)
        OR (e.type='launched' AND e.generation=epoch.generation AND e.ordinal>epoch.after)
        THEN 1 ELSE 0 END AS readerAnchor,
      CASE WHEN e.type NOT IN (${HISTORY_TYPES.map((x) => `'${x}'`).join(',')}) THEN 1
        WHEN NOT json_valid(e.payload) THEN 1
        WHEN json_type(e.payload)!='object' OR json_extract(e.payload,'$.type') IS NOT e.type THEN 1
        WHEN e.type='unknown' THEN
          CASE WHEN json_type(e.payload,'$.degradedFrom') IS NOT NULL
            OR coalesce(json_type(e.payload,'$.raw'),'missing')!='object'
            OR lower(coalesce(json_extract(e.payload,'$.label'),'')) LIKE '%message%'
            OR EXISTS(SELECT 1 FROM json_tree(e.payload,'$.raw')
              WHERE key IN ('text','content','questions','delivery')
                OR (key='role' AND value IN ('user','assistant'))
                OR (key='type' AND value IN ('user_message','userMessage','agent_message','agentMessage','message'))
                OR (key='phase' AND value='final')) THEN 1 ELSE 0 END
        ELSE 0 END AS protected
    FROM events e JOIN epochs epoch ON epoch.id=e.session_id
  ), ranked AS MATERIALIZED (
    SELECT *, row_number() OVER(PARTITION BY s,t,k
      ORDER BY isActive DESC,g DESC,o DESC,r DESC) AS nth
    FROM slim
  ), choices AS (
    SELECT *, CASE WHEN t IN ('provider_commands','tool_inventory','launched') THEN 1
      WHEN t='unknown' THEN 100 ELSE 1000 END AS cap,
      readerAnchor AS anchor
    FROM ranked
  )`
