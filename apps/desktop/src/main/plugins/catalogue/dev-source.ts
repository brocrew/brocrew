import { lstat, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { PluginSupervisorError } from '../supervisor/protocol'
import type { PluginRelease } from '../package-schema'
import { PLUGIN_LIMITS, verifyPluginDigest } from '../package-digests'
import { assertPluginArchiveUrl } from './download'
import { readLocalRelease } from './local'
import { isOwnerOnlyDirectory } from '../private-files'

export interface DevPluginSource {
  readonly isPackaged: boolean
  readonly appData: string
}

/** Missing input keeps the normal source; unsafe input never falls back to the network. */
export async function devPluginSource(options?: DevPluginSource): Promise<string | undefined> {
  if (!options || options.isPackaged !== false) return undefined
  const root = join(options.appData, '@brobot2', 'plugin-dev-source')
  const stat = await lstat(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (!stat) return undefined
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    !isOwnerOnlyDirectory(stat) ||
    (await realpath(root)) !== root
  )
    throw new PluginSupervisorError('unavailable')
  return root
}

export async function devPluginArchive(
  root: string,
  release: Readonly<PluginRelease>,
): Promise<Buffer> {
  assertPluginArchiveUrl(release.archive.url)
  const asset = decodeURIComponent(new URL(release.archive.url).pathname.split('/').at(-1)!)
  const bytes = await readLocalRelease(
    root,
    [asset],
    Math.min(release.archive.size, PLUGIN_LIMITS.archiveBytes),
    true,
  )
  verifyPluginDigest(bytes, release.archive, PLUGIN_LIMITS.archiveBytes)
  return bytes
}
