import { readSizedUtf8Sync } from '../sized-read'
import { closeSync, constants, fstatSync, openSync } from 'node:fs'
import { join } from 'node:path'
import { writeAtomicallySync } from '../atomic-write'

// Codex needs a server declaration beside its approval settings, so keep them outside config.toml.
export const KEPT_TOOL_APPROVALS = 'brobot-kept-tool-approvals.json'

const MAX_BYTES = 256 * 1024

export interface KeptToolApproval {
  readonly server: string
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
    const parsed: unknown = JSON.parse(readSizedUtf8Sync(fd, stat.size))
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

export function keptToolApprovals(providerHome: string): KeptToolApproval[] {
  const now = readKept(providerHome)
  return now.state === 'read' ? now.kept : []
}

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

function writeKept(file: string, kept: readonly KeptToolApproval[]): void {
  writeAtomicallySync(file, `${JSON.stringify({ always: kept }, null, 2)}\n`)
}
