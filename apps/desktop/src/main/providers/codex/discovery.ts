import { homedir } from 'node:os'
import type { ProtectedPlaceKind } from '../../../shared/work-folders'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readCodexDiscovery, type CodexThreadRow } from '../../database/codex-records'
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

  const read = readCodexDiscovery(state)
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
