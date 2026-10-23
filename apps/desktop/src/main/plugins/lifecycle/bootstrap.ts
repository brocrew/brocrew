import { loadRepoPluginList, parseRepoPluginList } from '../catalogue/repo-list'
import { localPluginArchive } from '../catalogue/local'
import { devPluginArchive } from '../catalogue/dev-source'
import { createPublicKey } from 'node:crypto'
import { join } from 'node:path'
import { lstat } from 'node:fs/promises'
import { GlobalPluginState } from '../state/store'
import { immutableFile, sourceBytes, verifyImmutableFile } from '../node-host-files'
import { PLUGIN_LIMITS, pluginSha256 } from '../package-digests'
import { thisMachine } from '../package-schema'
import { createRepoAwarePluginVerifier } from '../package-verifier'
import { createSupervisorLifecycle } from './supervisor'
import { requirePluginAdapter } from './adapters'
import type { PluginSupervisor } from '../supervisor/owner'
import type { createPluginNodeHost } from '../node-host'
import type { PluginLifecyclePlan } from '../supervisor/launch-format'

/** Trusted immutable app launch input. Repo-list production and legacy signed fixtures stay explicit. */
export async function bootstrapPluginLifecycle(options: {
  root: string
  workspaceRoots: readonly string[]
  owner: PluginSupervisor
  host: ReturnType<typeof createPluginNodeHost>
  plan: PluginLifecyclePlan
}) {
  const plan = options.plan
  const repo = 'source' in plan ? plan : null
  const legacy = 'publicKey' in plan ? plan : null
  const pinnedPublicKey = legacy
    ? createPublicKey({ key: Buffer.from(legacy.publicKey, 'base64'), format: 'der', type: 'spki' })
    : null
  const target = thisMachine()
  const catalogue = {
    bytes: await sourceBytes(plan.catalogue, PLUGIN_LIMITS.catalogueBytes),
    signature: legacy ? await sourceBytes(legacy.signature, 64) : Buffer.alloc(0),
  }
  // Empty authenticated catalogues still leave installed packages under their saved pins.
  createRepoAwarePluginVerifier({
    pinnedPublicKey,
    repoCatalogueSha256: repo?.catalogueSha256,
    target,
  }).verifyCatalogue(catalogue.bytes, catalogue.signature)
  let repoList: { bytes: Uint8Array; sha256: string; appVersion: string } | undefined
  if (repo?.repoList) {
    if (!repo.appVersion) throw new Error('unavailable')
    const bytes = await sourceBytes(repo.repoList.path, PLUGIN_LIMITS.catalogueBytes)
    await verifyImmutableFile(repo.repoList.path, bytes)
    if (
      pluginSha256(bytes) !== repo.repoList.sha256 ||
      parseRepoPluginList(bytes, target, repo.appVersion).sha256 !== repo.catalogueSha256 ||
      parseRepoPluginList(bytes, target, repo.appVersion).format !== (repo.sourceVersion ?? 1) ||
      (repo.sourceVersion === 2 && !repo.legacyRepoList)
    )
      throw new Error('unavailable')
    repoList = { bytes, sha256: repo.repoList.sha256, appVersion: repo.appVersion }
  }
  let legacyRepoList: typeof repoList
  if (repo?.legacyRepoList) {
    if (repo.sourceVersion !== 2 || !repo.appVersion) throw new Error('unavailable')
    const bytes = await sourceBytes(repo.legacyRepoList.path, PLUGIN_LIMITS.catalogueBytes)
    await verifyImmutableFile(repo.legacyRepoList.path, bytes)
    if (
      pluginSha256(bytes) !== repo.legacyRepoList.sha256 ||
      parseRepoPluginList(bytes, target, repo.appVersion).format !== 1
    )
      throw new Error('unavailable')
    legacyRepoList = { bytes, sha256: repo.legacyRepoList.sha256, appVersion: repo.appVersion }
  }
  const root = join(options.root, 'state')
  const exists = await lstat(root).then(
    () => true,
    (error) => {
      if (error.code === 'ENOENT') return false
      throw error
    },
  )
  if (!exists) {
    // A partial/removed guard is never silently initialized again. Birth is outside all restore sets.
    const marker = join(options.root, 'lifecycle-state-born')
    await lstat(marker).then(
      () => {
        throw new Error('unavailable')
      },
      (error) => {
        if (error.code !== 'ENOENT') throw error
      },
    )
    await immutableFile(marker, Buffer.from('1\n'))
  }
  const state = exists
    ? GlobalPluginState.open({ root, workspaceRoots: options.workspaceRoots })
    : GlobalPluginState.create({ root, workspaceRoots: options.workspaceRoots })
  try {
    const reads = new Map<string, Set<AbortController>>()
    const service = await createSupervisorLifecycle({
      owner: options.owner,
      host: options.host,
      personKey: plan.personKey,
      async read(id, connection) {
        const abort = new AbortController()
        const active = reads.get(id) ?? new Set<AbortController>()
        reads.set(id, active)
        active.add(abort)
        try {
          return await requirePluginAdapter(id).read(connection, abort.signal)
        } finally {
          active.delete(abort)
        }
      },
      lifecycle: {
        root: options.root,
        state,
        pinnedPublicKey,
        repoCatalogueSha256: repo?.catalogueSha256,
        repoList,
        legacyRepoList,
        target,
        catalogue,
        names: repo?.names ?? { chrome: 'Chrome' },
        refreshCatalogue: repo?.appVersion
          ? async () => {
              const list = await loadRepoPluginList({
                root: options.root,
                target,
                appVersion: repo.appVersion!,
                devSource: repo.devSource,
                fixtureSource: repo.fixtureSource,
                sourceVersion: repo.sourceVersion,
              })
              const frozen =
                repo.sourceVersion === 2
                  ? await loadRepoPluginList({
                      root: options.root,
                      target,
                      appVersion: repo.appVersion!,
                      fixtureSource: repo.fixtureSource,
                      devSource: repo.devSource,
                      sourceVersion: 1,
                    })
                  : undefined
              return {
                legacyRepoList: frozen
                  ? {
                      bytes: frozen.rawBytes,
                      sha256: frozen.repoList.sha256,
                      appVersion: repo.appVersion!,
                    }
                  : undefined,
                catalogue: { bytes: list.bytes, signature: Buffer.alloc(0) },
                repoCatalogueSha256: list.sha256,
                repoList: {
                  bytes: list.rawBytes,
                  sha256: list.repoList.sha256,
                  appVersion: repo.appVersion!,
                },
                names: Object.fromEntries(list.entries.map((entry) => [entry.id, entry.name])),
              }
            }
          : undefined,
        // This is the central lifecycle gate. Person/broker consumers must use controller.admitted;
        // an invalidated run can never grant calls merely because its host is still alive.
        deny: (id) => {
          for (const read of reads.get(id) ?? []) read.abort()
          reads.delete(id)
        },
        // The trusted launch plan binds one source for the complete install; no local network fallback.
        download: repo?.devSource
          ? async (release) => devPluginArchive(repo.devSource!, release)
          : repo?.fixtureSource || legacy?.localSource
            ? async (release) =>
                localPluginArchive((repo?.fixtureSource ?? legacy?.localSource)!, release)
            : legacy?.downloads
              ? async (release) => {
                  const file = legacy.downloads!.find(
                    (one) => one.id === release.id && one.version === release.version,
                  )
                  if (!file) throw new Error('unavailable')
                  return sourceBytes(file.archive, PLUGIN_LIMITS.archiveBytes)
                }
              : undefined,
      },
    })
    void options.owner.closed.finally(() => state.close())
    return service
  } catch (error) {
    state.close()
    throw error
  }
}
