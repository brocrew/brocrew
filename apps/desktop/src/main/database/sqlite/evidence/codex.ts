import { readProviderDatabase } from './provider-database'

export interface CodexThreadRow {
  id: string
  cwd: string
  rollout_path: string
  archived: number
  created_at: number
  created_at_ms: number | null
  updated_at: number
  updated_at_ms: number | null
  title?: unknown
  first_user_message?: unknown
  thread_source?: unknown
  source?: unknown
  agent_nickname?: unknown
  agent_role?: unknown
  agent_path?: unknown
}

const DESCRIPTION_COLUMNS = [
  'title',
  'first_user_message',
  'thread_source',
  'source',
  'agent_nickname',
  'agent_role',
  'agent_path',
] as const

export function readCodexDiscovery(state: string) {
  return readProviderDatabase(state, (db) => {
    const present = new Set(
      (db.pragma('table_info(threads)') as { name: string }[]).map((column) => column.name),
    )
    const described = DESCRIPTION_COLUMNS.filter((column) => present.has(column))
    const rows = db
      .prepare(
        `SELECT id, cwd, rollout_path, archived, created_at, created_at_ms, updated_at, updated_at_ms
                ${described.map((column) => `, ${column}`).join('')}
           FROM threads ORDER BY updated_at DESC`,
      )
      .all() as CodexThreadRow[]
    let edges: { child_thread_id: string; parent_thread_id: string }[] = []
    try {
      edges = db
        .prepare('SELECT child_thread_id, parent_thread_id FROM thread_spawn_edges')
        .all() as typeof edges
    } catch {
      edges = []
    }
    return { rows, edges }
  })
}

export function readCodexRolloutPath(state: string, threadId: string): string | null {
  return readProviderDatabase(state, (db) => {
    const row = db.prepare('SELECT rollout_path FROM threads WHERE id = ?').get(threadId) as
      { rollout_path: unknown } | undefined
    return typeof row?.rollout_path === 'string' ? row.rollout_path : null
  })
}

export function readCodexRolloutPaths(
  state: string,
  ids: readonly string[],
): Map<string, string> | null {
  return readProviderDatabase(state, (db) => {
    const select = db.prepare('SELECT rollout_path FROM threads WHERE id = ?')
    const found = new Map<string, string>()
    for (const id of ids) {
      const row = select.get(id) as { rollout_path: unknown } | undefined
      if (typeof row?.rollout_path === 'string') found.set(id, row.rollout_path)
    }
    return found
  })
}
