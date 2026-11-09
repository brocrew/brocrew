import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import type { PluginRelease } from '../package-schema'
import { PLUGIN_LIMITS, verifyPluginDigest } from '../package-digests'
import { assertPluginArchiveUrl } from './download'
import { readLocalRelease } from './local'

export interface DevPluginSource {
  readonly isPackaged: boolean
  readonly appData: string
}

/** A missing dev folder keeps the normal source; a present one never falls back to the network. */
export async function devPluginSource(options?: DevPluginSource): Promise<string | undefined> {
  if (!options || options.isPackaged !== false) return undefined
  const root = join(options.appData, '@brobot2', 'plugin-dev-source')
  const stat = await lstat(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  return stat ? root : undefined
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
  )
  verifyPluginDigest(bytes, release.archive, PLUGIN_LIMITS.archiveBytes)
  return bytes
}
