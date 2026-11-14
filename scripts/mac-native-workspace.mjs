import { readFile, writeFile, lstat } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import * as macLineage from './lib/mac-candidate-lineage.mjs'
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
  VERSION_B as SAME_CODE_VERSION,
  verifyCheckpoint,
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

export async function checkFirstWorkspaceCopy(
  workspace,
  { needsCheckpoint, version, source, lineage, evidence },
) {
  const { data, baseline } = workspace
  const retained = await checkpointIds(data)
  const added = retained.filter((id) => !baseline.copiesBefore.includes(id))
  requireEvidence(
    needsCheckpoint
      ? added.length === 1 && retained.length === 1
      : added.length === 0 &&
          (baseline.retainedCheckpointId === null
            ? retained.length === 0
            : retained.length === 1 && retained[0] === baseline.retainedCheckpointId),
    'The candidate must keep one pre-migration checkpoint, replacing the previous generation only for a migration.',
  )
  if (needsCheckpoint && workspace.result.nativeStartup)
    requireEvidence(
      workspace.result.nativeStartup.completedCheckpointId === added[0],
      'The native first start did not record its recovery copy.',
    )
  if (!needsCheckpoint && baseline.retainedCheckpointId !== null) {
    const retainedFolder = join(data, 'backups', baseline.retainedCheckpointId)
    requireEvidence(
      isDeepStrictEqual(
        {
          database: await digest(join(retainedFolder, 'database.sqlite')),
          manifest: await digest(join(retainedFolder, 'manifest.json')),
          state: stateSummary(stateBytes(retainedFolder)),
        },
        baseline.retainedCheckpointContents,
      ),
      'The selected existing rollback checkpoint changed on a no-migration start.',
    )
  }
  let checked = null
  let checkpoint = null
  if (needsCheckpoint) {
    checkpoint = join(data, 'backups', added[0])
    const manifestText = await readFile(join(checkpoint, 'manifest.json'), 'utf8')
    await writeFile(join(evidence, 'b-checkpoint-manifest.json'), manifestText)
    const manifest = JSON.parse(manifestText)
    requireEvidence(
      manifest.madeBy?.appVersion === version && manifest.madeBy?.build === source,
      'The recovery copy was not made by the candidate.',
    )
    checked = verifyCheckpoint(
      { ...manifest, madeBy: { ...manifest.madeBy, appVersion: SAME_CODE_VERSION } },
      {
        ...stateBytes(checkpoint),
        'database.sqlite': await readFile(join(checkpoint, 'database.sqlite')),
      },
      {
        version,
        source,
        reason: macLineage.checkpointReason(lineage, baseline.before.migrations),
        id: added[0],
        workspaceId: (await readFile(join(data, 'backups', 'workspace-id'), 'utf8')).trim(),
        state: baseline.files,
        migrations: macLineage.checkpointMigrations(baseline.before.migrations),
      },
    )
  }
  return { checkpoint, checked }
}
