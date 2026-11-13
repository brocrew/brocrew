import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { requireEvidence } from './lib/mac-update-test.mjs'

export function nativeWorkspaceFromRegistry(registry, workspaces) {
  const latest = [...registry.workspaces].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)[0]
  const workspace = workspaces.find((one) => one.data === latest?.path)
  requireEvidence(workspace, 'The native startup workspace is not one of the captured fixtures.')
  return workspace
}

export async function nativeWorkspaceReceipts(workspaces) {
  return await Promise.all(
    workspaces.map(async ({ name, data }) => {
      try {
        const receipt = JSON.parse(await readFile(join(data, 'backups', 'retention.json'), 'utf8'))
        const { appVersion, workspaceId, checkpointId, successfulStarts } = receipt
        return { name, path: data, appVersion, workspaceId, checkpointId, successfulStarts }
      } catch (error) {
        return { name, path: data, error: String(error) }
      }
    }),
  )
}

export async function nativeWorkspaceStartup(
  workspace,
  candidate,
  { readReceipt, completedCopy, workspaces, diagnostic },
) {
  try {
    const startup = await readReceipt(workspace.data, candidate.version)
    requireEvidence(
      startup.workspaceId === workspace.baseline.workspaceId,
      'The native first-start receipt belongs to another workspace.',
    )
    const completed = await completedCopy(workspace.data, new Set(workspace.baseline.copiesBefore))
    requireEvidence(
      completed?.manifest.workspaceId === workspace.baseline.workspaceId &&
        completed.manifest.madeBy?.appVersion === candidate.version &&
        completed.manifest.madeBy?.build === candidate.source,
      'The native first start did not finish its candidate recovery copy in this workspace.',
    )
    return { startup, completed }
  } catch (error) {
    diagnostic.receipts = await nativeWorkspaceReceipts(workspaces)
    throw error
  }
}
