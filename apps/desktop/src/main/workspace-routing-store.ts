import { writeAtomicallySync } from '@brobot2/runtime/atomic-write'
import { isInside } from '@brobot2/shared/paths'
import { createHash } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

export const WORKSPACE_LIST_REFUSAL = "BroCrew couldn't read its list of workspaces."
export const WORKSPACE_POLICY_FILE = 'workspace-policy.json'
const MAX_BYTES = 1024 * 1024
const OWNERS = 'packaged-workspace-owners'
export type RoutingReason =
  | 'not-a-file'
  | 'file-too-large'
  | 'invalid-json'
  | 'file-read-failed'
  | 'malformed-policy'
  | 'missing-policy'
  | 'malformed-list'
  | 'list-seed-failed'
  | 'workspace-stat-failed'
  | 'forbidden-first-workspace'
  | 'malformed-bundle-metadata'
  | 'bundle-read-failed'
  | 'not-an-owners-directory'
  | 'owners-directory-failed'
  | 'malformed-owner'
  | 'owner-path-invalid'
  | 'owner-write-failed'
  | 'too-many-owners'
  | 'owners-read-failed'
export interface RoutingDiagnostic {
  reason: RoutingReason | 'forbidden-row' | 'forbidden-workspace-write'
  file: string
  path: string
}

export class WorkspaceRoutingError extends Error {
  readonly reason: RoutingReason
  readonly file: string
  readonly path: string
  constructor(reason: RoutingReason, file: string, path = file, cause?: unknown) {
    super(
      `${WORKSPACE_LIST_REFUSAL} ${file}${path === file ? '' : ` (${path})`}: ${cause instanceof Error ? cause.message : reason.replaceAll('-', ' ')}`,
      { cause },
    )
    this.name = 'WorkspaceRoutingError'
    this.reason = reason
    this.file = file
    this.path = path
  }
}

export function routingFailure(
  reason: RoutingReason,
  file: string,
  path = file,
  cause?: unknown,
): never {
  const error = new WorkspaceRoutingError(reason, file, path, cause)
  console.error(error.message)
  throw error
}

export function routingWarning(
  reason: 'forbidden-row' | 'forbidden-workspace-write',
  file: string,
  path: string,
  policyFile: string,
): RoutingDiagnostic {
  console.warn(
    `[workspace-routing:${reason}] ${file}: ${path} is reserved by ${policyFile} for development builds.`,
  )
  return { reason, file, path }
}

export function readRoutingFile(file: string): { text: string; value: unknown } | undefined {
  let fd: number | undefined
  try {
    fd = openSync(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0))
    const opened = fstatSync(fd)
    if (!opened.isFile()) return routingFailure('not-a-file', file)
    if (opened.size > MAX_BYTES) return routingFailure('file-too-large', file)
    const bytes = Buffer.alloc(MAX_BYTES + 1)
    let length = 0
    while (length < bytes.length) {
      const read = readSync(fd, bytes, length, bytes.length - length, null)
      if (read === 0) break
      length += read
    }
    if (length > MAX_BYTES) return routingFailure('file-too-large', file)
    const text = bytes.subarray(0, length).toString('utf8')
    try {
      return { text, value: JSON.parse(text) }
    } catch (error) {
      return routingFailure('invalid-json', file, file, error)
    }
  } catch (error) {
    if (error instanceof WorkspaceRoutingError) throw error
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    return routingFailure('file-read-failed', file, file, error)
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

export function routingPath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 4096 && isAbsolute(value)
}
export interface WorkspacePolicy {
  version: 1
  firstWorkspace: string
  packagedForbidden: string[]
  developmentForbidden: string[]
}

export function readWorkspacePolicy(
  appData: string,
  required = false,
): WorkspacePolicy | undefined {
  const file = join(appData, '@brobot2', WORKSPACE_POLICY_FILE)
  const policy = readRoutingFile(file)
  if (!policy) return required ? routingFailure('missing-policy', file) : undefined
  const value = policy.value
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return routingFailure('malformed-policy', file)
  const data = value as Record<string, unknown>
  if (
    data.version !== 1 ||
    !routingPath(data.firstWorkspace) ||
    !Array.isArray(data.packagedForbidden) ||
    !data.packagedForbidden.every(routingPath) ||
    !Array.isArray(data.developmentForbidden) ||
    !data.developmentForbidden.every(routingPath)
  )
    return routingFailure('malformed-policy', file)
  return data as unknown as WorkspacePolicy
}

export function canonicalWorkspacePath(folder: string): string {
  let here = resolve(folder)
  const tail: string[] = []
  for (;;) {
    try {
      return join(realpathSync.native(here), ...tail.reverse())
    } catch {
      const parent = dirname(here)
      if (parent === here) return resolve(folder)
      tail.push(basename(here))
      here = parent
    }
  }
}

export function withinWorkspace(folder: string, root: string): boolean {
  return (
    isInside(root, folder) || isInside(canonicalWorkspacePath(root), canonicalWorkspacePath(folder))
  )
}

export function packagedWorkspaceIsForbidden(appData: string, folder: string): boolean {
  return (
    readWorkspacePolicy(appData)?.packagedForbidden.some((root) => withinWorkspace(folder, root)) ??
    false
  )
}

function ownerKey(folder: string): string {
  return createHash('sha256')
    .update(process.platform === 'win32' ? folder.toLowerCase() : folder)
    .digest('hex')
}
function ownersRoot(appData: string, create: boolean): string | undefined {
  const root = join(appData, '@brobot2', OWNERS)
  try {
    if (create) mkdirSync(root, { recursive: true, mode: 0o700 })
    const seen = statSync(root)
    if (!seen.isDirectory()) return routingFailure('not-an-owners-directory', root)
    return root
  } catch (error) {
    if (error instanceof WorkspaceRoutingError) throw error
    if (!create && (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    return routingFailure('owners-directory-failed', root, root, error)
  }
}
function ownerPath(file: string): string {
  const value = readRoutingFile(file)?.value as { version?: unknown; path?: unknown } | undefined
  if (value?.version !== 1 || !routingPath(value.path))
    return routingFailure('malformed-owner', file)
  return value.path
}

/** Ownership entries are published once and are never replaced by recent-list writers. */
export function claimPackagedWorkspace(appData: string, folder: string): void {
  if (packagedWorkspaceIsForbidden(appData, folder)) {
    routingWarning(
      'forbidden-workspace-write',
      join(appData, '@brobot2', OWNERS),
      folder,
      join(appData, '@brobot2', WORKSPACE_POLICY_FILE),
    )
    return
  }
  const root = ownersRoot(appData, true)!
  const path = canonicalWorkspacePath(folder)
  if (!routingPath(path)) return routingFailure('owner-path-invalid', root, path)
  const file = join(root, `${ownerKey(path)}.json`)
  if (readRoutingFile(file)) return
  try {
    try {
      writeAtomicallySync(file, JSON.stringify({ version: 1, path }), { exclusive: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  } catch (error) {
    if (error instanceof WorkspaceRoutingError) throw error
    return routingFailure('owner-write-failed', file, path, error)
  }
}

export function packagedWorkspaceOwners(appData: string): string[] {
  const root = ownersRoot(appData, false)
  if (!root) return []
  try {
    const names = readdirSync(root).filter((name) => name.endsWith('.json'))
    if (names.length > 4096) return routingFailure('too-many-owners', root)
    return names.map((name) => ownerPath(join(root, name)))
  } catch (error) {
    if (error instanceof WorkspaceRoutingError) throw error
    return routingFailure('owners-read-failed', root, root, error)
  }
}
