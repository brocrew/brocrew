import { readFile, writeFile, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  requireEvidence,
  exists,
  databaseSnapshot,
  stateBytes,
  nativeFiles,
  dataPreserved,
  statePreserved,
  checkNativePrefixes,
  digest,
  checkpointIds,
  stateSummary,
} from './lib/mac-update-test.mjs'
import { credentialPreserved, legacyCredentialsPreserved } from './mac-upgrade-credentials.mjs'
import { fixturePermissions } from './mac-signed-upgrade-contract.mjs'

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
    if (!candidate.checkpoint && workspace.baseline.workspaceId === null) {
      return { startup: null, completed: null }
    }
    const startup = await readReceipt(workspace.data, candidate.version)
    requireEvidence(
      workspace.baseline.workspaceId === null ||
        startup.workspaceId === workspace.baseline.workspaceId,
      'The native first-start receipt belongs to another workspace.',
    )
    if (!candidate.checkpoint) return { startup, completed: null }
    const completed = await completedCopy(workspace.data, new Set(workspace.baseline.copiesBefore))
    requireEvidence(
      completed?.manifest.workspaceId === startup.workspaceId &&
        startup.checkpointId === completed.manifest.id &&
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

export async function captureWorkspaceBaseline(
  workspace,
  registryBefore,
  settingsBefore,
  { nativeRoot, evidence },
) {
  const data = workspace.data
  const before = databaseSnapshot(join(data, 'brobot2.sqlite'), {
    credentials: true,
    movedState: true,
  })
  const files = stateBytes(data)
  const state = stateBytes(data, before),
    natives = await nativeFiles(nativeRoot, data)
  dataPreserved(workspace.beforeButtons, before, { allowAppended: true })
  statePreserved(workspace.stateBeforeButtons, state)
  legacyCredentialsPreserved(workspace.beforeButtons.provider_api_key, before.provider_api_key)
  const credential = workspace.credentialBeforeButtons
  workspace.result.settledCredential = credentialPreserved(
    credential,
    await readFile(join(data, 'api-keys.json'), 'utf8'),
  )
  await checkNativePrefixes(workspace.nativeBeforeButtons, data)
  workspace.result.baselineDatabase = {
    bytes: (await lstat(join(data, 'brobot2.sqlite'))).size,
    sha256: await digest(join(data, 'brobot2.sqlite')),
  }
  const copies = await Promise.all(
    (await checkpointIds(data)).map(async (id) => ({
      id,
      manifest: JSON.parse(await readFile(join(data, 'backups', id, 'manifest.json'), 'utf8')),
    })),
  )
  const beforeMigration = copies.filter(({ manifest }) => manifest.reason === 'before-migration')
  const selected = (beforeMigration.length > 0 ? beforeMigration : copies).sort(
    (a, b) => Date.parse(b.manifest.createdAt) - Date.parse(a.manifest.createdAt),
  )[0]
  const identityFile = join(data, 'backups', 'workspace-id')
  const workspaceId = (await exists(identityFile))
    ? (await readFile(identityFile, 'utf8')).trim()
    : null
  requireEvidence(
    copies.length === 0 || workspaceId !== null,
    'Existing recovery copies have no workspace identity.',
  )
  workspace.baseline = {
    credential,
    before,
    state,
    files,
    natives,
    settingsBefore,
    registryBefore,
    permissions: fixturePermissions(data, Object.keys(natives)),
    copiesBefore: copies.map(({ id }) => id),
    retainedCheckpointId: selected?.id ?? null,
    retainedCheckpointContents: selected
      ? {
          database: await digest(join(data, 'backups', selected.id, 'database.sqlite')),
          manifest: await digest(join(data, 'backups', selected.id, 'manifest.json')),
          state: stateSummary(stateBytes(join(data, 'backups', selected.id))),
        }
      : null,
    workspaceId,
  }
  await writeFile(
    join(evidence, 'a-settled-baseline.json'),
    JSON.stringify(
      {
        database: before,
        credential: workspace.result.settledCredential,
        state: stateSummary(state),
        native: natives,
        permissions: workspace.baseline.permissions,
        registry: registryBefore,
        workspaceId: workspace.baseline.workspaceId,
      },
      null,
      2,
    ),
  )
}
