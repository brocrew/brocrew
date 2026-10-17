import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { join } from 'node:path'
import { aStagingName, createFreshFile } from '../internal/provider-home'

/**
 * 🔴 **736 · R95 — Codex's *Always allow* on an MCP tool, KEPT in the conversation's provider home.**
 *
 * ⚑ **What the Codex terminal does** (measured, `736`'s scratch of it, bundled 0.146.0): *Always
 * allow* writes `[mcp_servers.<server>.tools.<tool>] approval_mode = "approve"` into
 * `<CODEX_HOME>/config.toml`, and a new launch on that home runs the tool unasked.
 *
 * ⛔ **Why this app cannot write that table there** — measured through the product
 * (`probe:codex-mcp-tool-approval` and `736`'s scratch arms of it):
 *
 * | what | what Codex did |
 * |---|---|
 * | the product's answer `_meta.persist: 'always'`, its server declared per conversation (`605`) | kept NOTHING — `config.toml` unchanged, the next launch asked again |
 * | the same answer, the server declared in `config.toml` (as the terminal had it) | wrote the table; the next launch did not ask |
 * | the table in `config.toml`, the server declared per conversation | ran unasked |
 * | the table in `config.toml`, NO server declared | ⛔ `failed to load configuration … invalid transport` — the conversation could not start |
 * | `config/value/write` of the table | ⛔ refused, the same `invalid transport` |
 *
 * ⚠️ So a table written into `config.toml` would stop EVERY conversation of this home that is not
 * granted that server from starting. ⚑ **The approval is kept here instead, and put where Codex
 * reads it — the server's own table — in the per-conversation declaration of every launch that
 * declares that server** ({@link codexExternalMcpConfig}): measured, a declaration carrying
 * `tools.<tool>.approval_mode = "approve"` ran the tool unasked, and the same one without it asked.
 *
 * ⛔ **Bounded, and silent at a launch on a file it cannot read** — a home the workload can write
 * is not ours to trust, and a FIFO planted at the name must not hang the process that opens it
 * (`O_NONBLOCK`, then the regular-file check). ⚑ **But a KEEP says what it could not do**:
 * {@link keepToolApproval} throws — on a failed write, and on a file it could not read rather than
 * writing over the approvals already in it — so the card is not recorded as a grant that was
 * never kept.
 *
 * ⚑ **Keyed by the server's NAME and URL** (`736`'s review): a server removed and registered again
 * under the same name at another address is another program, and inherits nothing.
 */

/** The file, in the provider home. */
export const KEPT_TOOL_APPROVALS = 'brobot-kept-tool-approvals.json'

/** A file this large is not one this app wrote. */
const MAX_BYTES = 256 * 1024

export interface KeptToolApproval {
  readonly server: string
  /** The server's address when the approval was kept — part of its identity. */
  readonly url: string
  readonly tool: string
}

export function keptToolApprovalsFile(providerHome: string): string {
  return join(providerHome, KEPT_TOOL_APPROVALS)
}

type KeptRead =
  | { readonly state: 'absent' }
  | { readonly state: 'read'; readonly kept: KeptToolApproval[] }
  | { readonly state: 'unreadable'; readonly why: string }

function readKept(providerHome: string): KeptRead {
  let fd: number | null = null
  try {
    try {
      fd = openSync(keptToolApprovalsFile(providerHome), constants.O_RDONLY | constants.O_NONBLOCK)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'absent' }
      throw error
    }
    const stat = fstatSync(fd)
    if (!stat.isFile()) return { state: 'unreadable', why: 'not a regular file' }
    if (stat.size > MAX_BYTES) return { state: 'unreadable', why: `larger than ${MAX_BYTES} bytes` }
    const buffer = Buffer.alloc(stat.size)
    let read = 0
    while (read < stat.size) {
      const got = readSync(fd, buffer, read, stat.size - read, read)
      if (got === 0) break
      read += got
    }
    const parsed: unknown = JSON.parse(buffer.subarray(0, read).toString('utf8'))
    const list =
      typeof parsed === 'object' && parsed !== null ? (parsed as { always?: unknown }).always : null
    if (!Array.isArray(list)) return { state: 'unreadable', why: 'not a list this app wrote' }
    return {
      state: 'read',
      kept: list.flatMap((entry): KeptToolApproval[] => {
        if (typeof entry !== 'object' || entry === null) return []
        const { server, url, tool } = entry as { server?: unknown; url?: unknown; tool?: unknown }
        return typeof server === 'string' &&
          server !== '' &&
          typeof url === 'string' &&
          url !== '' &&
          typeof tool === 'string' &&
          tool !== ''
          ? [{ server, url, tool }]
          : []
      }),
    }
  } catch (error) {
    return { state: 'unreadable', why: error instanceof Error ? error.message : String(error) }
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

/** Every kept approval in this home, or none — a launch is never failed by this file. */
export function keptToolApprovals(providerHome: string): KeptToolApproval[] {
  const now = readKept(providerHome)
  return now.state === 'read' ? now.kept : []
}

/**
 * Keep one approval — idempotent. ⚠️ Staged under a fresh name nobody can know, created new
 * ({@link createFreshFile}: nothing planted at that name can redirect it), then renamed over the
 * file, so a reader never sees half of it; the stage is removed on any failure. Throws when it
 * cannot read what is there or cannot write.
 */
export function keepToolApproval(providerHome: string, approval: KeptToolApproval): void {
  const file = keptToolApprovalsFile(providerHome)
  const now = readKept(providerHome)
  if (now.state === 'unreadable') {
    throw new Error(`${file} could not be read (${now.why}), so it was not rewritten`)
  }
  const kept = now.state === 'read' ? now.kept : []
  const same = (one: KeptToolApproval): boolean =>
    one.server === approval.server && one.url === approval.url && one.tool === approval.tool
  if (kept.some(same)) return
  const next = { server: approval.server, url: approval.url, tool: approval.tool }
  writeKept(file, [...kept, next])
}

/**
 * Forget one kept approval, so the tool is asked about again from the next start. Throws when the
 * file keeps no such approval or cannot be read, and on a failed write.
 */
export function forgetToolApproval(providerHome: string, approval: KeptToolApproval): void {
  const file = keptToolApprovalsFile(providerHome)
  const read = readKept(providerHome)
  if (read.state !== 'read') {
    throw new Error(
      read.state === 'absent'
        ? `${file} keeps no approvals`
        : `${file} could not be read (${read.why}), so it was not rewritten`,
    )
  }
  const others = read.kept.filter(
    (one) =>
      one.server !== approval.server || one.url !== approval.url || one.tool !== approval.tool,
  )
  if (others.length === read.kept.length) throw new Error(`${file} does not keep that approval`)
  writeKept(file, others)
}

/** The whole list, staged and renamed over the file — see {@link keepToolApproval}. */
function writeKept(file: string, kept: readonly KeptToolApproval[]): void {
  const staged = aStagingName(file)
  const fd = createFreshFile(staged)
  try {
    try {
      writeSync(fd, `${JSON.stringify({ always: kept }, null, 2)}\n`)
    } finally {
      closeSync(fd)
    }
    renameSync(staged, file)
  } catch (error) {
    try {
      unlinkSync(staged)
    } catch {
      // best effort — the reason below is what matters
    }
    throw error
  }
}
