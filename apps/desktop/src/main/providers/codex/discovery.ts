import { homedir } from 'node:os'
import type { ProtectedPlaceKind } from '../../../shared/work-folders'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readProviderDatabase } from '../../archive/native-io'
import { newestStateDatabase } from './native-record'
import {
  EMPTY,
  type Discovery,
  type DiscoveredSession,
  type SkippedSession,
  type ChildDescent,
} from '../../adopt/discovery-types'
export function discoverCodexSessions(home: string, profileId: string): Discovery {
  const state = newestStateDatabase(home)
  if (state === null) return EMPTY

  const read = readProviderDatabase(state, (db) => {
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
  if (read === null) {
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
    const child = codexDescent(row, edgeParents.get(row.id))
    found.push({
      provider: 'codex',
      sessionId: row.id,
      cwd: row.cwd,
      profileId,
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

const DESCRIPTION_COLUMNS = [
  'title',
  'first_user_message',
  'thread_source',
  'source',
  'agent_nickname',
  'agent_role',
  'agent_path',
] as const

/** Combine descent signals so missing or unreadable source JSON cannot hide a child. */
export function codexDescent(
  row: CodexThreadRow,
  edgeParent: string | undefined,
): ChildDescent | null {
  const spawn = parseSubagentSource(row.source)
  const marked = row.thread_source === 'subagent'
  if (!spawn && !marked && edgeParent === undefined) return null

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
  title?: unknown
  first_user_message?: unknown
  thread_source?: unknown
  source?: unknown
  agent_nickname?: unknown
  agent_role?: unknown
  agent_path?: unknown
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
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
