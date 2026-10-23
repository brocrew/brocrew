import { existsSync, readdirSync, realpathSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import { readProviderDatabase } from '../../archive/native-io'
import type { SessionRef } from '@brobot2/runtime'

/** The rollout Codex recorded for a thread, read from the newest state database in the home. */
function codexRolloutPath(providerHome: string, threadId: string): string | null {
  const state = newestStateDatabase(providerHome)
  if (state === null) return null
  return readProviderDatabase(state, (db) => {
    const row = db.prepare('SELECT rollout_path FROM threads WHERE id = ?').get(threadId) as
      { rollout_path: unknown } | undefined
    return typeof row?.rollout_path === 'string' ? row.rollout_path : null
  })
}

/**
 * The newest `state_<n>.sqlite` in a Codex home. The number is a schema version, so the highest
 * one is the live database — an older one names threads Codex has already moved past.
 */
export function newestStateDatabase(home: string): string | null {
  if (!existsSync(home)) return null
  const versions = readdirSync(home)
    .map((name) => ({ name, version: /^state_(\d+)\.sqlite$/.exec(name)?.[1] }))
    .filter((entry): entry is { name: string; version: string } => entry.version !== undefined)
    .sort((a, b) => Number(b.version) - Number(a.version))
  return versions[0] ? join(home, versions[0].name) : null
}

export function nativePath(home: string, ref: SessionRef): string | null {
  const found = codexRolloutPath(home, ref.sessionId)
  return found !== null && existsSync(found) ? found : null
}
export function ownsRecord(home: string, file: string): boolean {
  const real = (one: string): string => {
    try {
      return realpathSync.native(one)
    } catch {
      return resolve(one)
    }
  }
  const resolved = real(file)
  const under = (folder: string): boolean => resolved.startsWith(join(real(home), folder) + sep)
  return (
    (under('sessions') || under('archived_sessions')) &&
    /^rollout-.*\.jsonl$/.test(basename(resolved))
  )
}
