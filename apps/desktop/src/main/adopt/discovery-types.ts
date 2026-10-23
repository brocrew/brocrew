import type { Provider } from '@brobot2/shared'

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

export const EMPTY: Discovery = { found: [], skipped: [] }
export function merge(...parts: Discovery[]): Discovery {
  return {
    found: parts.flatMap((part) => part.found),
    skipped: parts.flatMap((part) => part.skipped),
  }
}
