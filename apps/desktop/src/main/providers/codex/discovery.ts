import { homedir } from 'node:os'
import type { ProtectedPlaceKind } from '../../../shared/work-folders'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { readProviderDatabase } from '../../archive/native-io'
import {
  EMPTY,
  type Discovery,
  type DiscoveredSession,
  type SkippedSession,
  type ChildDescent,
} from '../../adopt/discovery-types'
/**
 * Codex: `threads` in the home's state database says everything we need, so nothing is parsed
 * out of a transcript. The rows are still checked against the disk — a thread whose rollout file
 * has gone is a pointer to nothing.
 */
export function discoverCodexSessions(home: string, profileId: string): Discovery {
  const state = newestStateDatabase(home)
  if (state === null) return EMPTY

  // Through a COPY, never the file itself (046 review, P1): a `readonly: true` open of a WAL-mode
  // database whose `-shm` is missing CREATES that sidecar — measured — which is a write into
  // `~/.codex`. See `readProviderDatabase`.
  const read = readProviderDatabase(state, (db) => {
    // The descriptive columns arrived by ALTER TABLE — they sit after the original CREATE in the
    // schema of a current home — so an older state database genuinely does not have them. Naming
    // one unconditionally would throw, `readProviderDatabase` would return null, and EVERY Codex
    // session would vanish from adoption because we wanted a subtitle. So the columns are asked for
    // only where they exist, and their absence costs a caption rather than the whole home.
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
    // 111 — the third signal, and the only one that survives a `source` we cannot parse. Read as a
    // whole table rather than joined per row: 812 edges against 1,986 threads is one small query,
    // where a correlated subquery would be two thousand. Its own `try` because the table arrived by
    // migration like the columns did, and a home without it must still yield its sessions.
    let edges: { child_thread_id: string; parent_thread_id: string }[] = []
    try {
      edges = db
        .prepare('SELECT child_thread_id, parent_thread_id FROM thread_spawn_edges')
        .all() as typeof edges
    } catch {
      edges = [] // no such table on an older home — the other two signals still speak
    }
    return { rows, edges }
  })
  if (read === null) {
    // One reason covers both halves now — the copy and the query happen together, and neither can
    // be reported without guessing which failed. A home we cannot read has nothing to offer.
    return {
      found: [],
      skipped: [
        {
          provider: 'codex',
          path: state,
          reason: 'its state database could not be read',
        },
      ],
    }
  }

  const { rows, edges } = read
  const edgeParents = new Map(edges.map((edge) => [edge.child_thread_id, edge.parent_thread_id]))
  const found: DiscoveredSession[] = []
  const skipped: SkippedSession[] = []

  for (const row of rows) {
    // Typed as a string by the schema we read, but SQLite will hand back whatever is in the
    // column — and `existsSync(null)` throws, which would take the whole scan down with it.
    const path = typeof row.rollout_path === 'string' ? row.rollout_path : ''
    if (path === '') {
      skipped.push({
        provider: 'codex',
        path: `thread ${row.id}`,
        reason: 'the thread records no transcript path',
      })
      continue
    }
    if (row.archived) {
      skipped.push({ provider: 'codex', path, reason: 'archived in Codex' })
      continue
    }
    if (typeof row.cwd !== 'string' || row.cwd === '') {
      skipped.push({ provider: 'codex', path, reason: 'the thread names no working directory' })
      continue
    }
    if (!existsSync(path)) {
      skipped.push({ provider: 'codex', path, reason: 'its transcript is no longer on disk' })
      continue
    }
    // Mark children without filtering them out: they remain discoverable and adoptable, but are not presented as conversations the person started. The archive sweep also retains them.
    const child = codexDescent(row, edgeParents.get(row.id))
    found.push({
      provider: 'codex',
      sessionId: row.id,
      cwd: row.cwd,
      profileId,
      // Codex records seconds, and milliseconds separately when it has them.
      updatedAt: row.updated_at_ms ?? row.updated_at * 1000,
      createdAt: row.created_at_ms ?? row.created_at * 1000,
      path,
      description: {
        title: text(row.title),
        preview: text(row.first_user_message),
      },
      ...(child ? { child } : {}),
    })
  }

  return { found, skipped }
}

/** The descriptive columns, asked for only where the state database actually has them. */
const DESCRIPTION_COLUMNS = [
  'title',
  'first_user_message',
  // 111 — the descent. Same ALTER TABLE story as the two above, and the same treatment: a home too
  // old to have them loses the child marking, not the whole home.
  'thread_source',
  'source',
  'agent_nickname',
  'agent_role',
  'agent_path',
] as const

/**
 * Is this thread a **child** of another, and what does the provider say about the descent (111)?
 *
 * Read all three descent signals. Observed provider records include legacy rows without `thread_source` and children without a spawn edge:
 *
 * ```
 * union of all three .......... 815
 * thread_source = 'subagent' .. 806   misses 9 legacy rows written before the column existed
 * a spawn edge ................ 812   misses 3 whose descent is recorded only on the row
 * source = {"subagent":…} ..... 815   ← today a superset of the other two, by measurement
 * ```
 *
 * The JSON `source` covered all children in the observed sample. Still read `thread_source` and spawn edges so a changed or unreadable JSON shape does not misclassify a child as a conversation the person started.
 *
 * `edgeParent` comes from the caller's join over `thread_spawn_edges`; it is the only signal that
 * survives an unparseable `source`.
 */
export function codexDescent(
  row: CodexThreadRow,
  edgeParent: string | undefined,
): ChildDescent | null {
  const spawn = parseSubagentSource(row.source)
  const marked = row.thread_source === 'subagent'
  if (!spawn && !marked && edgeParent === undefined) return null

  // The row's own columns are preferred over the JSON: they are the provider's normalized copy, and
  // on this snapshot `agent_nickname` is populated on 812 of 815 while the JSON carries it on 812
  // too — identical, so this costs nothing and survives the JSON changing shape.
  const nickname = text(row.agent_nickname) || (spawn?.nickname ?? '')
  const role = text(row.agent_role) || (spawn?.role ?? '')
  const agentPath = text(row.agent_path) || (spawn?.agentPath ?? '')
  const parentSessionId = spawn?.parentSessionId ?? edgeParent ?? ''
  return {
    ...(parentSessionId ? { parentSessionId } : {}),
    ...(spawn?.depth !== undefined ? { depth: spawn.depth } : {}),
    ...(nickname ? { nickname } : {}),
    ...(role ? { role } : {}),
    ...(agentPath ? { agentPath } : {}),
  }
}

/**
 * The `{"subagent":{…}}` payload Codex writes into `threads.source`, or null when this is one of the
 * ordinary values (`vscode`, `cli`, `exec`) — or anything we cannot read.
 *
 * ⚠️ **A parse failure is "not a child", never a throw.** This runs once per row over up to two
 * thousand of them, and the whole home is behind it: 047's rule that a caption is not worth losing
 * every session applies with more force to a marker.
 */
function parseSubagentSource(source: unknown): {
  parentSessionId?: string
  depth?: number
  nickname?: string
  role?: string
  agentPath?: string
} | null {
  if (typeof source !== 'string' || !source.startsWith('{')) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    return null
  }
  const subagent = record(parsed)?.['subagent']
  if (subagent === undefined) return null
  // `{"subagent":{"other":"guardian"}}` — a child that names no parent. Three real rows. It returns
  // an EMPTY descriptor rather than null: the childhood is a fact even when the descent is not.
  const spawn = record(record(subagent)?.['thread_spawn'])
  if (!spawn) return {}
  const depth = spawn['depth']
  return {
    ...(typeof spawn['parent_thread_id'] === 'string'
      ? { parentSessionId: spawn['parent_thread_id'] }
      : {}),
    ...(typeof depth === 'number' && Number.isFinite(depth) ? { depth } : {}),
    ...(typeof spawn['agent_nickname'] === 'string' ? { nickname: spawn['agent_nickname'] } : {}),
    ...(typeof spawn['agent_role'] === 'string' ? { role: spawn['agent_role'] } : {}),
    ...(typeof spawn['agent_path'] === 'string' ? { agentPath: spawn['agent_path'] } : {}),
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

interface CodexThreadRow {
  id: string
  cwd: string
  rollout_path: string
  archived: number
  created_at: number
  created_at_ms: number | null
  updated_at: number
  updated_at_ms: number | null
  /** Absent on an older state database — see {@link DESCRIPTION_COLUMNS}. */
  title?: unknown
  first_user_message?: unknown
  /** 111 — the descent columns, equally absent on an older home. See {@link codexDescent}. */
  thread_source?: unknown
  source?: unknown
  agent_nickname?: unknown
  agent_role?: unknown
  agent_path?: unknown
}

/**
 * A column as a string, or empty. SQLite hands back whatever is in the cell regardless of the
 * declared type, and a caption is not worth a crash: anything that is not a string reads as nothing
 * to say, which is what an empty title means anyway.
 */
function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * The state file carries a schema version in its name (`state_5.sqlite` today). The newest one is
 * the live database; reading an older one would report threads Codex has already moved on from.
 */
function newestStateDatabase(home: string): string | null {
  if (!existsSync(home)) return null
  const versions = readdirSync(home)
    .map((name) => ({ name, version: /^state_(\d+)\.sqlite$/.exec(name)?.[1] }))
    .filter((entry): entry is { name: string; version: string } => entry.version !== undefined)
    .sort((a, b) => Number(b.version) - Number(a.version))
  return versions[0] ? join(home, versions[0].name) : null
}

export const discovery = {
  discover: discoverCodexSessions,
  userHome,
  configHomes: (home: string, env: NodeJS.ProcessEnv): readonly string[] => [
    ...new Set([join(home, '.codex'), userHome(env, homedir)]),
  ],
  protectedPlaceKind: 'codex-config-home' as ProtectedPlaceKind,
}

function userHome(env: NodeJS.ProcessEnv, defaultHome: () => string): string {
  const override = env['CODEX_HOME']
  return typeof override === 'string' && override !== '' ? override : join(defaultHome(), '.codex')
}
