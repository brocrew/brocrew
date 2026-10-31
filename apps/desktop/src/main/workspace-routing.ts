import { randomUUID } from 'node:crypto'
import { linkSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  claimPackagedWorkspace,
  packagedWorkspaceOwners,
  readRoutingFile,
  readWorkspacePolicy,
  routingFailure,
  routingPath,
  routingWarning,
  withinWorkspace as within,
  WorkspaceRoutingError,
  WORKSPACE_POLICY_FILE,
  PACKAGED_WORKSPACE_LIST,
  WORKSPACE_LIST_REFUSAL,
  type RoutingDiagnostic,
} from './workspace-routing-store'
export {
  WORKSPACE_LIST_REFUSAL,
  WORKSPACE_POLICY_FILE,
  PACKAGED_WORKSPACE_LIST,
} from './workspace-routing-store'

export const OTHER_BUILD_REFUSAL = 'This workspace opens in the BroCrew app in Applications.'
export const PACKAGED_WORKSPACE_REFUSAL = "This workspace can't be opened in this app."
/** A folder the policy keeps for a development build of BroCrew, as the packaged app is told. */
export const DEVELOPMENT_BUILD_REFUSAL =
  'This workspace opens in a development build of BroCrew, not in this app. Open it from that build.'
export function workspaceLaunchMessage(error: unknown): string {
  if (error instanceof WorkspaceRoutingError) return `${WORKSPACE_LIST_REFUSAL} (${error.reason})`
  return error instanceof Error &&
    [
      OTHER_BUILD_REFUSAL,
      DEVELOPMENT_BUILD_REFUSAL,
      PACKAGED_WORKSPACE_REFUSAL,
      WORKSPACE_LIST_REFUSAL,
    ].includes(error.message)
    ? error.message
    : WORKSPACE_LIST_REFUSAL
}
interface Entry {
  path: string
  lastOpenedAt: number
}
function entries(value: unknown, file: string): Entry[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return routingFailure('malformed-list', file)
  const data = value as Record<string, unknown>
  if (data.version !== 1 || !Array.isArray(data.workspaces))
    return routingFailure('malformed-list', file)
  for (const row of data.workspaces) {
    if (typeof row !== 'object' || row === null || Array.isArray(row))
      return routingFailure('malformed-list', file)
    const one = row as Record<string, unknown>
    if (
      !routingPath(one.path) ||
      typeof one.lastOpenedAt !== 'number' ||
      !Number.isFinite(one.lastOpenedAt)
    )
      return routingFailure('malformed-list', file, typeof one.path === 'string' ? one.path : file)
  }
  return data.workspaces as Entry[]
}

function existingFolder(folder: string, file: string): boolean {
  try {
    return statSync(folder).isDirectory()
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return false
    return routingFailure('workspace-stat-failed', file, folder)
  }
}

/** Missing lists are seeded once; a policy keeps configured builds off the legacy list. */
export function workspaceRouting(
  appData: string,
  packaged: boolean,
  required = false,
  options: { readOnly?: boolean } = {},
) {
  const root = join(appData, '@brobot2')
  const policyPath = join(root, WORKSPACE_POLICY_FILE)
  const policy = readWorkspacePolicy(appData, required)
  const listFile = join(root, PACKAGED_WORKSPACE_LIST)
  let list = readRoutingFile(listFile)
  if (packaged && !options.readOnly && !list && !policy) {
    const legacyPath = join(root, 'workspaces.json')
    const legacy = readRoutingFile(legacyPath)
    if (legacy) {
      entries(legacy.value, legacyPath)
      const temporary = `${listFile}.${process.pid}.${randomUUID()}.seed`
      try {
        mkdirSync(root, { recursive: true })
        writeFileSync(temporary, legacy.text, { flag: 'wx', mode: 0o600 })
        try {
          linkSync(temporary, listFile)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        }
      } catch {
        return routingFailure('list-seed-failed', listFile, legacyPath)
      } finally {
        rmSync(temporary, { force: true })
      }
      list = readRoutingFile(listFile)
    }
  }
  const diagnostics: RoutingDiagnostic[] = []
  const rows = (list ? entries(list.value, listFile) : []).filter((row) => {
    if (!policy?.packagedForbidden.some((root) => within(row.path, root))) return true
    diagnostics.push(routingWarning('forbidden-row', listFile, row.path, policyPath))
    return false
  })
  if (packaged && !options.readOnly) {
    for (const row of rows) claimPackagedWorkspace(appData, row.path)
  }
  const owners = packagedWorkspaceOwners(appData)
  const known = (folder: string): boolean =>
    [...rows.map((row) => row.path), ...owners].some((root) => within(folder, root))
  const forbidden = packaged
    ? (policy?.packagedForbidden ?? [])
    : [...(policy?.developmentForbidden ?? []), ...rows.map((row) => row.path), ...owners]
  const refusal = (folder: string): string | null =>
    forbidden.some((one) => within(folder, one))
      ? packaged
        ? DEVELOPMENT_BUILD_REFUSAL
        : OTHER_BUILD_REFUSAL
      : null
  const reserved = policy ? [policy.firstWorkspace, ...policy.developmentForbidden] : []
  const creationRefusal = (folder: string): string | null =>
    refusal(folder) ??
    (packaged && (known(folder) || reserved.some((root) => within(folder, root)))
      ? PACKAGED_WORKSPACE_REFUSAL
      : null)
  const ordered = [...rows].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  const latest = (
    policy || !packaged ? ordered[0] : ordered.find((row) => existingFolder(row.path, listFile))
  )?.path
  const first = latest ?? policy?.firstWorkspace
  if (first && packaged && refusal(first))
    return routingFailure('forbidden-first-workspace', policyPath, first)
  return {
    listFile,
    first,
    refusal,
    creationRefusal,
    known,
    configured: policy !== undefined,
    diagnostics,
  }
}

/** Read immutable bundle metadata without importing Electron or changing its application name. */
export function requiresWorkspacePolicy(appPath: string): boolean {
  const file = join(appPath, 'package.json')
  try {
    const data: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof data !== 'object' || data === null || Array.isArray(data))
      return routingFailure('malformed-bundle-metadata', file)
    return (data as Record<string, unknown>).requireWorkspacePolicy === true
  } catch (error) {
    if (error instanceof WorkspaceRoutingError) throw error
    return routingFailure(
      error instanceof SyntaxError ? 'malformed-bundle-metadata' : 'bundle-read-failed',
      file,
    )
  }
}
