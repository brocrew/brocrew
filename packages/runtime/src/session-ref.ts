import { z } from 'zod'
import { providerSchema } from '@brobot2/shared'

/**
 * A persistable handle to one provider conversation — the value orchestration
 * stores so it can later `resume` after full process death (001 §Q7 "storage
 * decision"; HO-001 §6 refinement 6).
 *
 * It is a plain, JSON-serializable object on purpose:
 *   - Claude → `sessionId` = the SDK `session_id` (from `system/init`) + `cwd`.
 *   - Codex  → `sessionId` = the app-server `thread.id`            + `cwd`.
 *   - `rotation` = which session this is within its agent profile's life.
 *
 * `cwd` is part of the identity because both providers require the same working
 * directory to resume the on-disk conversation (001 Claude §Q4 / Codex §Q4).
 */
export const sessionRefSchema = z.object({
  provider: providerSchema,
  /** Claude `session_id` or Codex `thread.id`. Known only after the session starts. */
  sessionId: z.string().min(1),
  /** Working directory the session was created in; must match to resume. */
  cwd: z.string().min(1),
  /** Rotation index within the agent profile (0 for the first session). */
  rotation: z.number().int().nonnegative(),
})

export type SessionRef = z.infer<typeof sessionRefSchema>

/** Serialize a ref for durable storage (e.g. a DB column). */
export function serializeSessionRef(ref: SessionRef): string {
  return JSON.stringify(sessionRefSchema.parse(ref))
}

/**
 * Parse a stored ref back into a validated `SessionRef`. Throws (zod) on a
 * malformed value — a corrupt ref must never be silently treated as resumable.
 */
export function parseSessionRef(serialized: string): SessionRef {
  return sessionRefSchema.parse(JSON.parse(serialized))
}
