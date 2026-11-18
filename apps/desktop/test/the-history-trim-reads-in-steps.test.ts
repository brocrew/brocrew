import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, expect, it, vi } from 'vitest'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { eventTrimWriter, trimOldEvents } from '../src/main/db/event-retention'
import { conversationHeadSQL, historyStepsSQL } from '../src/main/db/event-retention-policy'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
const folder = mkdtempSync(join(tmpdir(), 'fictional-history-trim-'))
afterAll(() => rmSync(folder, { recursive: true, force: true }))

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 17)
const OLD = NOW - 10 * DAY
const NEW = NOW - DAY

/**
 * The keep rules as the trim applied them in one window query per conversation, before it read in
 * steps. Kept here, unchanged, as what the stepped reads must agree with row for row.
 */
const KEPT_BY_ONE_QUERY = `WITH active AS MATERIALIZED (
    SELECT s.id, coalesce(d.active,0) AS generation
    FROM provider_session s LEFT JOIN derived_generation d ON d.session_id=s.id
    WHERE s.id=@session
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
      e.generation=epoch.generation AS isActive,
      CASE WHEN e.type='unknown' AND json_valid(e.payload) THEN json_array(
        json_extract(e.payload,'$.provider'),json_extract(e.payload,'$.category'),
        coalesce(json_extract(e.payload,'$.label'),json_extract(e.payload,'$.raw.type'),'unlabelled')) ELSE '' END AS k,
      CASE WHEN e.id IN (epoch.command,epoch.inventory,epoch.declaration)
        OR (e.type='launched' AND e.generation=epoch.generation AND e.ordinal>epoch.after)
        THEN 1 ELSE 0 END AS anchor,
      CASE WHEN e.type NOT IN ('provider_commands','tool_inventory','launched','unknown',
          'file_change','thinking','assistant_delta','activity','context_reading','plan_update',
          'memory_recall','memory_loaded','turn_summary','command_summary','tool_refused',
          'instruction_changed','work_sent','work_reported','project_proposed','proposal_ended') THEN 1
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
    SELECT *, row_number() OVER(PARTITION BY s,t,k ORDER BY isActive DESC,g DESC,o DESC,r DESC) AS nth
    FROM slim
  )
  SELECT id FROM ranked
  WHERE protected=0 AND anchor=0
    AND nth > CASE WHEN t IN ('provider_commands','tool_inventory','launched') THEN 1
      WHEN t='unknown' THEN 100 ELSE 1000 END
    AND (at<@cutoff OR t IN ('provider_commands','tool_inventory','launched'))`

type Row = readonly [type: string, payload: string, at: number]

/** `count` rows of one kind, every `fresh`th one too new to trim. */
const rows = (type: string, count: number, payload: object | string, fresh = 0): Row[] =>
  Array.from({ length: count }, (_, n) => [
    type,
    typeof payload === 'string' ? payload : JSON.stringify({ type, ...payload }),
    fresh > 0 && n % fresh === 0 ? NEW : OLD,
  ])

const unknown = (label: string | null, raw: object | null, extra: object = {}): object => ({
  provider: 'codex',
  category: 'item',
  ...(label === null ? {} : { label }),
  ...(raw === null ? {} : { raw }),
  ...extra,
})

/** One generation's rows at consecutive ordinals, oldest first, shuffled the same way every run. */
function aGeneration(session: string, generation: number, all: Row[], shuffled = true) {
  let seed = 7 + generation
  const order = all.map((row, n) => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648
    return { row, key: shuffled ? seed : n }
  })
  order.sort((a, b) => a.key - b.key)
  return order.map(({ row: [type, payload, at] }, ordinal) => ({
    id: `${session}-${generation}-${ordinal}`,
    session,
    generation,
    ordinal,
    type,
    payload,
    at,
  }))
}

function aWorkspace(file: string) {
  const db = openDatabase(file)
  applyMigrations(db, migrations)
  const conversation = db.prepare(`INSERT INTO provider_session
    (id, provider, cwd, status, created_at, updated_at) VALUES (?, 'claude', '/', 'idle', 0, 0)`)
  const generation = db.prepare(`INSERT INTO derived_generation
    (session_id, active, building, normalizer_version, derived_through, highest, updated_at)
    VALUES (?, ?, ?, 1, 0, 1, 0)`)
  const event = db.prepare(`INSERT INTO events
    (id, session_id, generation, ordinal, type, payload, created_at)
    VALUES (@id, @session, @generation, @ordinal, @type, @payload, @at)`)
  const history: Record<string, Row[][]> = {
    // Its active generation is 1, so 1 ranks first, then 2 and 0, newest first in each.
    rebuilt: [
      [
        ...rows('thinking', 500, {}, 9),
        ...rows('thinking', 20, '{bad'),
        ...rows('thinking', 10, { type: 'activity' }),
        ...rows('thinking', 5, '[1,2]'),
        ...rows('unknown', 150, unknown('Probe', { type: 'probe' })),
        ...rows('unknown', 60, unknown(null, { type: 'other' })),
        ...rows('unknown', 5, unknown('A user message', { type: 'x' })),
        ...rows('provider_commands', 2, {}),
        ...rows('tool_inventory', 2, {}),
        ...rows('launched', 3, {}),
        ...rows('activity', 30, {}),
      ],
      [
        ...rows('thinking', 700, {}, 5),
        ...rows('unknown', 130, unknown('Probe', { type: 'probe' })),
        ...rows('unknown', 70, unknown(null, { type: 'other' })),
        ...rows('unknown', 110, unknown(null, null, {}), 4),
        ...rows('unknown', 8, unknown('Item', { item: { text: 'hello' } })),
        ...rows('unknown', 8, unknown('Item', { role: 'assistant' })),
        ...rows('unknown', 8, unknown('Item', { type: 'agentMessage' })),
        ...rows('unknown', 8, unknown('Item', { phase: 'final' })),
        ...rows('unknown', 8, unknown('Item', { type: 'item' }, { degradedFrom: 'x' })),
        ...rows('unknown', 8, unknown('Item', [1])),
        ...rows('unknown', 4, '{bad'),
        ...rows('provider_commands', 4, {}, 2),
        ...rows('provider_commands', 2, '{bad'),
        ...rows('tool_inventory', 3, {}),
        ...rows('tool_inventory', 3, { source: 'thread/resume' }),
        ...rows('launched', 6, {}),
        ...rows('compaction', 1, {}),
        ...rows('conversation_reset', 1, {}),
        ...rows('assistant_delta', 1_200, {}, 3),
        ...rows('user_turn', 50, {}),
        ...rows('assistant_message', 50, {}),
        ...rows('status', 20, {}),
      ],
      [...rows('thinking', 200, {}), ...rows('unknown', 40, unknown('Probe', { type: 'probe' }))],
    ],
    // No generation row: generation 0 is the active one.
    plain: [
      [
        ...rows('thinking', 1_100, {}),
        ...rows('unknown', 120, unknown('Probe', { type: 'probe' })),
        ...rows('launched', 3, {}),
        ...rows('provider_commands', 3, {}),
        ...rows('file_change', 1_050, {}, 2),
      ],
    ],
    // In this order: the newest command lists are malformed and the newest inventories are
    // resumes, so the readers' anchors are older rows.
    anchors: [
      [
        ...rows('provider_commands', 3, {}),
        ...rows('provider_commands', 2, '{bad'),
        ...rows('tool_inventory', 2, {}),
        ...rows('tool_inventory', 2, { source: 'thread/resume' }),
      ],
    ],
    // A rebuild is under way, so nothing in it is trimmed this sweep.
    rebuilding: [[...rows('thinking', 1_500, {})]],
    quiet: [],
  }
  const inserted = new Map<string, string>()
  db.transaction(() => {
    for (const [session, generations] of Object.entries(history)) {
      conversation.run(session)
      generations.forEach((all, n) => {
        for (const one of aGeneration(session, n, all, session !== 'anchors')) {
          event.run(one)
          inserted.set(one.id, one.type)
        }
      })
    }
    generation.run('rebuilt', 1, null)
    generation.run('rebuilding', 0, 1)
  })()
  return { db, typeOf: (id: string) => inserted.get(id)! }
}

it('reads each conversation in steps and selects exactly the rows the one query did', async () => {
  const file = join(folder, 'workspace.sqlite')
  const { db, typeOf } = aWorkspace(file)
  try {
    const oneQuery = db.prepare(KEPT_BY_ONE_QUERY)
    const expected = ['anchors', 'plain', 'quiet', 'rebuilt']
      .flatMap((session) =>
        (oneQuery.all({ session, cutoff: NOW - 3 * DAY }) as { id: string }[]).map((r) => r.id),
      )
      .sort()
    const selected: string[] = []
    const result = await trimOldEvents(
      file,
      () => false,
      async (batch) => {
        selected.push(...batch.ids)
        return { changed: batch.ids.length, durationMs: 0, checkpointMs: 0 }
      },
      NOW,
    )
    expect(selected.sort()).toEqual(expected)
    // The newest well-formed command list and inventory, and the newest non-resume inventory, stay.
    expect(expected.filter((id) => id.startsWith('anchors-'))).toEqual([
      'anchors-0-0',
      'anchors-0-1',
      'anchors-0-5',
      'anchors-0-7',
    ])
    expect(result.removed).toBe(expected.length)
    expect(result.removedByType).toEqual({})
    expect(result.unattributedRemoved).toBe(expected.length)
    expect(result.deferredConversations).toBe(1)
    const byType = new Map<string, number>()
    for (const id of expected) byType.set(typeOf(id), (byType.get(typeOf(id)) ?? 0) + 1)
    for (const type of ['thinking', 'unknown', 'provider_commands', 'tool_inventory', 'launched'])
      expect(byType.get(type), type).toBeGreaterThan(0)
    expect([...byType.keys()].sort()).toEqual([
      'assistant_delta',
      'file_change',
      'launched',
      'provider_commands',
      'thinking',
      'tool_inventory',
      'unknown',
    ])
  } finally {
    db.close()
  }
})

it('reads each step as one range of the type index, and finds a conversation by seeks alone', () => {
  const db = openDatabase(join(folder, 'plans.sqlite'))
  applyMigrations(db, migrations)
  try {
    const plan = (sql: string, ...params: unknown[]) =>
      (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[]).map(
        (row) => row.detail,
      )
    const step = { type: 'thinking', session: 's', active: 1, generation: 0, ordinal: 0, limit: 1 }
    const range = (bounds: string) =>
      `SEARCH e USING INDEX events_kind_owner_idx (type=? AND session_id=? AND ${bounds})`
    expect(historyStepsSQL.map((sql) => plan(sql, step)[0])).toEqual([
      range('generation=? AND ordinal<?'),
      range('generation>? AND (generation,ordinal)<(?,?)'),
      range('(generation,ordinal)<(?,?)'),
    ])
    expect(plan(conversationHeadSQL, 's').filter((line) => !line.startsWith('SEARCH'))).toEqual([
      'CORRELATED SCALAR SUBQUERY 1',
      'CORRELATED SCALAR SUBQUERY 2',
    ])
  } finally {
    db.close()
  }
})

it('deletes a batch by seeking each id, without reading the rest of its conversation', () => {
  const db = openDatabase(join(folder, 'delete-plan.sqlite'))
  applyMigrations(db, migrations)
  try {
    const prepared = vi.spyOn(db, 'prepare')
    eventTrimWriter(db)
    const deletes = prepared.mock.calls
      .map(([sql]) => sql)
      .filter((sql) => sql.trimStart().startsWith('DELETE'))
    expect(deletes).toHaveLength(1)
    const batch = { session: 's', ids: '["a","b"]', before: NOW }
    const plan = (
      db.prepare(`EXPLAIN QUERY PLAN ${deletes[0]}`).all(batch) as { detail: string }[]
    ).map((row) => row.detail)
    expect(plan[0]).toBe('SEARCH events USING INDEX sqlite_autoindex_events_1 (id=?)')
  } finally {
    db.close()
  }
})
