import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from 'node:fs'
import { StringDecoder } from 'node:string_decoder'
import { basename, join } from 'node:path'
import { claudeProjectDirName } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { readProviderDatabase } from '../archive/native-file'

/**
 * Find conversations that exist in a provider home but that this app has never recorded —
 * started before persistence existed, by the provider's own CLI, or in a session we simply
 * never wrote down.
 *
 * This module only READS and reports. It manufactures nothing: every field of a discovered
 * session is taken from the provider's own files, and anything that cannot be read that way is
 * returned as skipped, with the reason, rather than adopted as a guess. A wrong pointer would be
 * worse than no pointer — it would offer a session that cannot resume and look like data loss.
 *
 * Read session metadata from the provider's files:
 * - Claude keeps `<home>/projects/<projectDir>/<session_id>.jsonl`. The filename is the id; read the cwd from the records because `projectDir` is a lossy encoding that cannot be inverted.
 * - Codex keeps the id, cwd, timestamps and `rollout_path` in the `threads` table of `<home>/state_<n>.sqlite`.
 */

/**
 * What a provider says about one of its own conversations, in its own words (047).
 *
 * Every field here is READ, never composed: an empty string means the provider has nothing to say,
 * which the library shows as nothing rather than as a title it invented. Measured on the real Codex
 * corpus (1,787 threads) before any of this was surfaced: `title` and `first_user_message` are
 * populated on every row with ~1,070 distinct values each, so both are worth showing — whereas
 * `name` is null on all 1,787 and `is_pinned` is the same value on all 1,787, so neither is.
 */
export interface ProviderDescription {
  /** A display title the provider keeps for itself. Empty when it has none. */
  title: string
  /** The first user message, as the provider recorded it. Empty when it has none. */
  preview: string
}

export interface DiscoveredSession {
  provider: Provider
  /** The provider's own id: Claude's `session_id`, Codex's `thread.id`. */
  sessionId: string
  /** Read from the provider's own record of the session — never derived from a path. */
  cwd: string
  /** The profile whose home it was found in; resume has to reopen in that same home. */
  profileId: string
  /** When the provider last touched it, in ms. */
  updatedAt: number
  /** When the conversation began, as the provider records it — not when we noticed it. */
  createdAt: number
  /** The file it came from, so an adopted row can be traced back to something real. */
  path: string
  /**
   * What the provider calls it, when the provider keeps that where discovery already looks (047).
   *
   * Present for Codex — its state database holds a title and the first user message in the same row
   * this reader already selects, so carrying them costs two more columns on a query that was
   * already running. ABSENT for Claude, deliberately: this reader stops at the first record naming a
   * cwd, and reading far enough to find a first prompt would mean parsing transcripts that reach a
   * gigabyte to learn one string. The SDK's own `listSessions()` already has it, indexed, so the
   * library asks that instead — see `session-library.ts`.
   */
  description?: ProviderDescription
  /**
   * That this session is another session's **child**, and what the provider says about the descent
   * (111). Absent means "not a child, as far as this provider can tell" — never "unknown".
   */
  child?: ChildDescent
}

/**
 * What a provider records about a session it spawned from another one (111).
 *
 * Only the fact that a session is a child is required. Provider records can omit the parent id, depth and other descent fields, as these observed shapes show:
 *
 * ```
 * 812  source = {"subagent":{"thread_spawn":{parent_thread_id, depth, agent_path, nickname, role}}}
 *   3  source = {"subagent":{"other":"guardian"}}      ← a child with NO parent id and NO depth
 * ```
 *
 * So three real rows know they are children and cannot say whose. `086`/`104`'s rule applies to a
 * parent id exactly as it does to a token count: an honest blank beats a fabricated one, and
 * inventing a parent would put a child under a conversation it never belonged to.
 */
export interface ChildDescent {
  /** The session that spawned this one, when the provider records it. */
  parentSessionId?: string
  /** How deep in the spawn tree — 1 is a child of a top-level conversation. */
  depth?: number
  /** The name the parent coined for this agent (`Turing`, `Plato`). */
  nickname?: string
  /** The role it was given (`worker`, `explorer`). Rare: 16 of 815 carry one. */
  role?: string
  /** The agent definition it was run from, when there is one. */
  agentPath?: string
}

/** Something that looks like a session but cannot be adopted, and why not. */
export interface SkippedSession {
  provider: Provider
  path: string
  reason: string
}

export interface Discovery {
  found: DiscoveredSession[]
  skipped: SkippedSession[]
}

const EMPTY: Discovery = { found: [], skipped: [] }

/**
 * For hosts that do not look at the disk at all — tests that are not about adoption. Explicit,
 * like {@link NULL_SESSION_STORE}, so "nothing is wired" never quietly reads as "the homes are
 * empty".
 */
export const NO_DISCOVERY = (): Discovery => EMPTY

function merge(...parts: Discovery[]): Discovery {
  return {
    found: parts.flatMap((part) => part.found),
    skipped: parts.flatMap((part) => part.skipped),
  }
}

/** Everything discoverable in one provider home. */
export function discoverSessionsIn(provider: Provider, home: string, profileId: string): Discovery {
  if (!existsSync(home)) return EMPTY
  return provider === 'claude'
    ? discoverClaudeSessions(home, profileId)
    : discoverCodexSessions(home, profileId)
}

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
