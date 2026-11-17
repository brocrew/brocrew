/** The only event types history trimming ever removes; every other type is kept. */
export const HISTORY_TYPES = [
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

/** Types kept to their newest row (and the rows readers anchor on), however recent the others. */
export const NEWEST_ONLY: ReadonlySet<string> = new Set([
  'provider_commands',
  'tool_inventory',
  'launched',
])

/** How many of a type's newest rows of one kind are always kept. */
export const keptNewest = (type: string): number =>
  NEWEST_ONLY.has(type) ? 1 : type === 'unknown' ? 100 : 1000

/** The last ordinal of one type in the active generation: one seek on the type index. */
const lastOrdinal = (type: string) => `coalesce((SELECT max(e.ordinal)
    FROM events e INDEXED BY events_kind_owner_idx
    WHERE e.type='${type}' AND e.session_id=s.id AND e.generation=coalesce(d.active,0)), -1)`

/** One conversation's active and building generation, and the last compaction or reset in the active one. */
export const conversationHeadSQL = `SELECT coalesce(d.active,0) AS active, d.building AS building,
    max(${lastOrdinal('compaction')}, ${lastOrdinal('conversation_reset')}) AS after
  FROM provider_session s LEFT JOIN derived_generation d ON d.session_id=s.id WHERE s.id=?`

/**
 * The readers start from the newest well-formed command list and inventory in the active
 * generation, and from the newest well-formed inventory that is not a resume (its declaration).
 */
export const ANCHORS: Readonly<Record<string, readonly string[]>> = {
  provider_commands: ['command'],
  tool_inventory: ['inventory', 'declaration'],
}

/**
 * What decides a row: its kind (only an `unknown` row has one); whether it is protected — not
 * well-formed, or an `unknown` that carries a message; and whether an inventory came from a resume.
 */
const ROW = `e.id AS id, e.generation AS g, e.ordinal AS o, e.created_at AS at,
    CASE WHEN e.type='unknown' AND json_valid(e.payload) THEN json_array(
      json_extract(e.payload,'$.provider'),json_extract(e.payload,'$.category'),
      coalesce(json_extract(e.payload,'$.label'),json_extract(e.payload,'$.raw.type'),'unlabelled')) ELSE '' END AS k,
    CASE WHEN NOT json_valid(e.payload) THEN 1
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
      ELSE 0 END AS protected,
    CASE WHEN e.type='tool_inventory' AND json_valid(e.payload)
      THEN coalesce(json_extract(e.payload,'$.source'),'')='thread/resume' ELSE 0 END AS resumed`

/**
 * One step through a conversation's rows of one type, newest first: the active generation, then
 * the newer generations, then the older ones. Each step is one range of the type index and reads
 * at most `@limit` rows. The older generations have the cursor as their only bound: their walk
 * starts at the active generation's lowest ordinal.
 */
export const historyStepsSQL = [
  `SELECT ${ROW} FROM events e INDEXED BY events_kind_owner_idx
    WHERE e.type=@type AND e.session_id=@session AND e.generation=@active AND e.ordinal<@ordinal
    ORDER BY e.ordinal DESC LIMIT @limit`,
  `SELECT ${ROW} FROM events e INDEXED BY events_kind_owner_idx
    WHERE e.type=@type AND e.session_id=@session AND e.generation>@active
      AND (e.generation,e.ordinal)<(@generation,@ordinal)
    ORDER BY e.generation DESC, e.ordinal DESC LIMIT @limit`,
  `SELECT ${ROW} FROM events e INDEXED BY events_kind_owner_idx
    WHERE e.type=@type AND e.session_id=@session AND (e.generation,e.ordinal)<(@generation,@ordinal)
    ORDER BY e.generation DESC, e.ordinal DESC LIMIT @limit`,
] as const
