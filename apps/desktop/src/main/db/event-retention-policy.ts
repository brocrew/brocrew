/**
 * The only event types history trimming ever removes; every other type is kept. Of `error`, only
 * the repeating warnings `repeatingWarning` names are ever removed, down to the newest of each.
 * Every `launched` row stays: the question fold reads a conversation's first launch to keep this
 * app's questions open across a stop.
 */
export const HISTORY_TYPES = [
  'provider_commands',
  'tool_inventory',
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
  'error',
] as const

/** Types kept to their newest row (and the rows readers anchor on), however recent the others. */
export const NEWEST_ONLY: ReadonlySet<string> = new Set(['provider_commands', 'tool_inventory'])

/** How many of a type's newest rows of one kind are always kept. */
export const keptNewest = (type: string): number =>
  NEWEST_ONLY.has(type) ? 1 : type === 'unknown' ? 100 : 1000

/**
 * Where the recovery of a refused first turn starts reading a conversation's active generation: its
 * newest input, or the newest give before it when that give is close enough to be read too. A
 * kind's own rule removes nothing from there on, so the stretch recovery reads stays unbroken.
 */
export const recoveryReadsFromSQL = `SELECT CASE
    WHEN given.o IS NOT NULL AND given.o < opened.o AND opened.o - given.o <= @window THEN given.o
    ELSE opened.o END
  FROM (SELECT coalesce(max(ordinal), -1) AS o FROM events INDEXED BY events_kind_owner_idx
      WHERE type='user_turn' AND session_id=@session AND generation=@generation) AS opened,
    (SELECT max(ordinal) AS o FROM events INDEXED BY events_kind_owner_idx
      WHERE type='work_given' AND session_id=@session AND generation=@generation) AS given`

/** A row's raw provider payload, read only for a kind whose rule looks inside it. */
export const rawPayloadSQL = `SELECT json_extract(payload,'$.raw') AS raw FROM events WHERE id=?`

/**
 * The conversation's stored input for one turn, which an echo must equal exactly to go: one seek on
 * the opening index, never a read of the turn's other rows.
 */
export const turnInputSQL = `SELECT json_extract(payload,'$.sent') AS sent, json_extract(payload,'$.text') AS text
  FROM events INDEXED BY events_turn_opening_idx
  WHERE session_id=@session AND generation=@generation AND turn_id=@turn AND type='user_turn'`

/** One conversation's active and building generation. */
export const conversationHeadSQL = `SELECT coalesce(d.active,0) AS active, d.building AS building
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
 * well-formed, or an `unknown` that carries a message; whether it is malformed (protected however
 * its kind is kept); its turn; and whether an inventory came from a resume.
 */
const ROW = `e.id AS id, e.generation AS g, e.ordinal AS o, e.created_at AS at, e.turn_id AS t,
    CASE WHEN e.type='unknown' AND json_valid(e.payload) THEN json_array(
      json_extract(e.payload,'$.provider'),json_extract(e.payload,'$.category'),
      coalesce(json_extract(e.payload,'$.label'),json_extract(e.payload,'$.raw.type'),'unlabelled')) ELSE '' END AS k,
    CASE WHEN e.type='unknown' AND json_valid(e.payload) THEN json_type(e.payload,'$.label')='text' ELSE 0 END AS labelled,
    CASE WHEN NOT json_valid(e.payload) THEN 1
      WHEN json_type(e.payload)!='object' OR json_extract(e.payload,'$.type') IS NOT e.type THEN 1
      WHEN e.type='unknown' AND (json_type(e.payload,'$.degradedFrom') IS NOT NULL
        OR coalesce(json_type(e.payload,'$.raw'),'missing')!='object') THEN 1
      ELSE 0 END AS malformed,
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
      THEN coalesce(json_extract(e.payload,'$.source'),'')='thread/resume' ELSE 0 END AS resumed,
    CASE WHEN e.type='error' AND json_valid(e.payload) THEN json_extract(e.payload,'$.message') END AS message,
    CASE WHEN e.type='error' AND json_valid(e.payload) THEN json_type(e.payload,'$.stall')='true' ELSE 0 END AS stall,
    CASE WHEN e.type='error' AND json_valid(e.payload) THEN coalesce(json_type(e.payload,'$.fatal'),'missing')!='false' ELSE 1 END AS fatal`

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
