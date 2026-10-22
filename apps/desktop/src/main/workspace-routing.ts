import { randomUUID } from 'node:crypto'
import { linkSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { insideBySpelling, samePath } from './same-folder'
import {
  canonicalWorkspacePath,
  claimPackagedWorkspace,
  packagedWorkspaceOwners,
  readRoutingFile,
  WORKSPACE_LIST_REFUSAL,
} from './workspace-routing-store'
export { WORKSPACE_LIST_REFUSAL } from './workspace-routing-store'

export const WORKSPACE_POLICY_FILE = 'workspace-policy.json'
export const PACKAGED_WORKSPACE_LIST = 'packaged-workspaces.json'
export const OTHER_BUILD_REFUSAL = 'This workspace opens in the BroCrew app in Applications.'
export const PACKAGED_WORKSPACE_REFUSAL = "This workspace can't be opened in this app."
/** A folder the policy keeps for a development build of BroCrew, as the packaged app is told. */
export const DEVELOPMENT_BUILD_REFUSAL =
  'This workspace opens in a development build of BroCrew, not in this app. Open it from that build.'
export function workspaceLaunchMessage(error: unknown): string {
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
const unavailable = (): never => {
  throw new Error(WORKSPACE_LIST_REFUSAL)
}
interface Entry {
  path: string
  lastOpenedAt: number
}
interface Policy {
  version: 1
  firstWorkspace: string
  packagedForbidden: string[]
  developmentForbidden: string[]
}
function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : unavailable()
}
function path(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 4096 && isAbsolute(value)
}
function paths(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(path)
}
function entries(value: unknown): Entry[] {
  const data = object(value)
  if (data.version !== 1 || !Array.isArray(data.workspaces)) return unavailable()
  for (const row of data.workspaces) {
    const one = object(row)
    if (
      !path(one.path) ||
      typeof one.lastOpenedAt !== 'number' ||
      !Number.isFinite(one.lastOpenedAt)
    )
      return unavailable()
  }
  return data.workspaces as Entry[]
}
function within(folder: string, root: string): boolean {
  if (samePath(folder, root) || insideBySpelling(folder, root)) return true
  const one = canonicalWorkspacePath(folder),
    other = canonicalWorkspacePath(root)
  return samePath(one, other) || insideBySpelling(one, other)
}

function existingFolder(folder: string): boolean {
  try {
    return statSync(folder).isDirectory()
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return false
    return unavailable()
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
  const policyFile = readRoutingFile(join(root, WORKSPACE_POLICY_FILE))
  let policy: Policy | undefined
  if (policyFile) {
    const data = object(policyFile.value)
    if (
      data.version !== 1 ||
      !path(data.firstWorkspace) ||
      !paths(data.packagedForbidden) ||
      !paths(data.developmentForbidden)
    )
      return unavailable()
    policy = data as unknown as Policy
  } else if (required) return unavailable()
  const listFile = join(root, PACKAGED_WORKSPACE_LIST)
  let list = readRoutingFile(listFile)
  if (packaged && !options.readOnly && !list && !policy) {
    const legacy = readRoutingFile(join(root, 'workspaces.json'))
    if (legacy) {
      entries(legacy.value)
      mkdirSync(root, { recursive: true })
      const temporary = `${listFile}.${process.pid}.${randomUUID()}.seed`
      try {
        writeFileSync(temporary, legacy.text, { flag: 'wx', mode: 0o600 })
        try {
          linkSync(temporary, listFile)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        }
      } finally {
        rmSync(temporary, { force: true })
      }
      list = readRoutingFile(listFile)
    }
  }
  const rows = list ? entries(list.value) : []
  if ((required || (packaged && policy)) && rows.length === 0) return unavailable()
  if (packaged) {
    for (const row of rows) {
      if (policy?.packagedForbidden.some((root) => within(row.path, root))) return unavailable()
      if (!options.readOnly) claimPackagedWorkspace(appData, row.path)
    }
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
    policy || !packaged ? ordered[0] : ordered.find((row) => existingFolder(row.path))
  )?.path
  const first = latest ?? policy?.firstWorkspace
  if (first && packaged && refusal(first)) return unavailable()
  return { listFile, first, refusal, creationRefusal, known, configured: policy !== undefined }
}

/** Read immutable bundle metadata without importing Electron or changing its application name. */
export function requiresWorkspacePolicy(appPath: string): boolean {
  try {
    const data = object(JSON.parse(readFileSync(join(appPath, 'package.json'), 'utf8')))
    return data.requireWorkspacePolicy === true
  } catch {
    return unavailable()
  }
}
