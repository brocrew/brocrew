import { homedir } from 'node:os'
import type { ProtectedPlaceKind } from '../../../shared/work-folders'
import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from 'node:fs'
import { StringDecoder } from 'node:string_decoder'
import { basename, join } from 'node:path'
import { claudeProjectDirName } from '@brobot2/runtime'
import {
  EMPTY,
  merge,
  type Discovery,
  type DiscoveredSession,
  type SkippedSession,
  type ProviderDescription,
} from '../../adopt/discovery-types'
/**
 * Claude: one `.jsonl` per session, filed under a directory named after its cwd.
 *
 * The cwd is read from INSIDE the file. The directory name cannot be trusted to give it back:
 * `claudeProjectDirName` maps every non-alphanumeric character to `-`, so many different cwds
 * collapse onto the same folder and the mapping has no inverse (086).
 *
 * It is still checked in the other direction, which does work: the cwd we read must encode back
 * to the folder the file is actually in. If it does not, resume would look somewhere else and
 * report the session missing — so that file is skipped rather than adopted into a dead end.
 */
export function discoverClaudeSessions(home: string, profileId: string): Discovery {
  const projects = join(home, 'projects')
  if (!existsSync(projects)) return EMPTY

  return merge(
    ...readdirSync(projects, { withFileTypes: true })
      .filter((entry) => isDirectory(join(projects, entry.name), entry))
      .map((entry) => discoverClaudeProject(join(projects, entry.name), entry.name, profileId)),
  )
}

function discoverClaudeProject(dir: string, dirName: string, profileId: string): Discovery {
  const found: DiscoveredSession[] = []
  const skipped: SkippedSession[] = []

  for (const file of readdirSync(dir).filter((name) => name.endsWith('.jsonl'))) {
    const path = join(dir, file)
    const sessionId = basename(file, '.jsonl')
    const skip = (reason: string): void => void skipped.push({ provider: 'claude', path, reason })

    let header: ClaudeHeader
    try {
      header = readClaudeHeader(path)
    } catch (cause) {
      skip(`could not be read: ${cause instanceof Error ? cause.message : String(cause)}`)
      continue
    }

    if (header.cwd === null) {
      skip('no record in it names a working directory, and resume needs one to find the session')
      continue
    }
    if (header.sessionId !== null && header.sessionId !== sessionId) {
      skip(`the file is named ${sessionId} but its records name ${header.sessionId}`)
      continue
    }
    if (claudeProjectDirName(header.cwd) !== dirName) {
      // The check that stops us adopting something that cannot be resumed: this is exactly the
      // path the resume preflight will probe.
      skip(
        `its working directory ${header.cwd} does not map to this folder, so resume would look elsewhere`,
      )
      continue
    }

    const stat = statSync(path)
    found.push({
      provider: 'claude',
      sessionId,
      cwd: header.cwd,
      profileId,
      updatedAt: stat.mtimeMs,
      // Claude keeps no start time in the file, so the file's own birth is the closest thing
      // to one that exists. Where the filesystem does not record it, it reads as the mtime.
      createdAt: stat.birthtimeMs || stat.mtimeMs,
      path,
    })
  }

  return { found, skipped }
}

/**
 * `Dirent.isDirectory()` describes the entry, not what it points at, so a project folder reached
 * through a symlink reads as "not a directory" and its sessions vanish without a word. Following
 * it costs one stat; a broken link is simply not a directory.
 */
function isDirectory(
  path: string,
  entry: { isDirectory(): boolean; isSymbolicLink(): boolean },
): boolean {
  if (entry.isDirectory()) return true
  if (!entry.isSymbolicLink()) return false
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

interface ClaudeHeader {
  cwd: string | null
  sessionId: string | null
}

/**
 * How far into a file we are willing to look for its working directory. In every real transcript
 * measured it is in the third record; a file that has not named one within this much is not a
 * transcript we can read, and reading it to the end would mean holding an arbitrarily large file
 * in memory to learn nothing.
 */
const HEADER_BUDGET_BYTES = 1024 * 1024

/**
 * Read only as far as the first record that names a working directory. Transcripts grow without
 * bound, and everything needed to adopt one is at the top, so this reads in chunks and stops —
 * rather than parsing a whole conversation to learn two strings.
 */
function readClaudeHeader(path: string): ClaudeHeader {
  const fd = openSync(path, 'r')
  try {
    const chunk = Buffer.alloc(64 * 1024)
    // A cwd can contain any character, and a multi-byte one straddling a chunk boundary would
    // decode to garbage — the decoder holds the partial sequence until the rest arrives.
    const decoder = new StringDecoder('utf8')
    let pending = ''
    let sessionId: string | null = null
    let consumed = 0

    for (;;) {
      const read = readSync(fd, chunk, 0, chunk.length, null)
      const end = read === 0 || consumed >= HEADER_BUDGET_BYTES
      consumed += read
      pending += end ? decoder.end() : decoder.write(chunk.subarray(0, read))

      const lines = pending.split('\n')
      // The trailing piece is only a whole line once the file has ended.
      pending = end ? '' : (lines.pop() ?? '')

      for (const line of lines) {
        if (line.trim() === '') continue
        let record: { cwd?: unknown; sessionId?: unknown }
        try {
          record = JSON.parse(line) as typeof record
        } catch {
          continue // one unreadable line is not a broken transcript
        }
        if (typeof record.sessionId === 'string' && sessionId === null) sessionId = record.sessionId
        if (typeof record.cwd === 'string' && record.cwd !== '') {
          return { cwd: record.cwd, sessionId: sessionId ?? null }
        }
      }

      if (end) return { cwd: null, sessionId }
    }
  } finally {
    closeSync(fd)
  }
}

/** The shape of the SDK call we use, named here so a test can stand in for it without the SDK. */
export type ListClaudeSessions = () => Promise<
  { sessionId: string; summary?: string; customTitle?: string; firstPrompt?: string }[]
>

/**
 * What Claude's own index says about the sessions in the user's home, keyed by session id (047).
 *
 * ## Why the SDK here, and the state database for Codex
 *
 * The two providers are read by different means, and the asymmetry is deliberate rather than
 * historical:
 *
 *  - **Claude** — `listSessions()` is the SDK's own indexed read and it is genuinely READ-ONLY.
 *    Measured against a synthetic home before this was written: it returned the planted session and
 *    changed not one byte in the directory it read. It is also the only cheap way to get a Claude
 *    title, because the transcripts themselves reach a gigabyte.
 *  - **Codex** — the equivalent call, `thread/list`, requires a running `codex app-server`, and a
 *    server can only be pointed at a home by running it THERE. Measured the same way: starting one
 *    against a home wrote **71 files** into it — four SQLite databases with their WALs, an
 *    `installation_id`, and the whole `skills/.system` tree — before any request was sent, and 77
 *    once `thread/list` was issued. `useStateDbOnly: true` does not prevent this; it only skips the
 *    rollout rescan, so the writes it avoids are not the ones that matter. Running that against
 *    `~/.codex` would break this app's one hard rule, so Codex is read from the same `threads` table
 *    `thread/list` itself reads, through a copy — see `discoverCodexSessions`.
 *
 * ## The home it reads
 *
 * `listSessions()` takes no home option and resolves `CLAUDE_CONFIG_DIR`, falling back to
 * `~/.claude` — which is exactly what {@link userProviderHomePath} computes. They therefore agree by
 * construction rather than by coincidence, and `user-homes.test.ts` pins that agreement by planting
 * a session in a temp home and pointing the variable at it. The consequence is the one 043 named: a
 * session of OURS, in an isolated per-profile home, can never appear here — and must not, because
 * ours are already in our database with lifecycle their provider file never held.
 *
 * Failure is empty, not fatal: a machine with no Claude home, or an SDK that cannot read one, costs
 * the captions on those rows and nothing else. The sessions themselves come from the filesystem
 * scan, which does not need this.
 */
export async function claudeHomeDescriptions(
  listSessions?: ListClaudeSessions,
): Promise<Map<string, ProviderDescription>> {
  const described = new Map<string, ProviderDescription>()
  try {
    // Imported HERE rather than at module load: the SDK is a megabyte of bundle, and the sweep —
    // which imports this module for the homes alone — has no use for it.
    const list = listSessions ?? (await import('@anthropic-ai/claude-agent-sdk')).listSessions
    for (const session of await list()) {
      described.set(session.sessionId, {
        // `customTitle` is what the user typed; `summary` is what the SDK derived. Preferring the
        // user's own words is the one ordering decision here, and neither is invented.
        title: session.customTitle ?? session.summary ?? '',
        preview: session.firstPrompt ?? '',
      })
    }
  } catch {
    return described
  }
  return described
}

export const discovery = {
  discover: discoverClaudeSessions,
  userHome,
  configHomes: (home: string, env: NodeJS.ProcessEnv): readonly string[] => [
    ...new Set([join(home, '.claude'), userHome(env, homedir)]),
  ],
  protectedPlaceKind: 'claude-config-home' as ProtectedPlaceKind,
  descriptions: claudeHomeDescriptions,
}

function userHome(env: NodeJS.ProcessEnv, defaultHome: () => string): string {
  const override = env['CLAUDE_CONFIG_DIR']
  return typeof override === 'string' && override !== '' ? override : join(defaultHome(), '.claude')
}
