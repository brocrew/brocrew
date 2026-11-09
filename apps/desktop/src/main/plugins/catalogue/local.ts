import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PluginSupervisorError } from '../supervisor/protocol'
import { verifyPluginDigest, PLUGIN_LIMITS } from '../package-digests'
import type { PluginRelease } from '../package-schema'
/** Callers verify the returned bytes by their expected digest. */
export async function readLocalRelease(
  root: string,
  parts: readonly string[],
  maximum: number,
): Promise<Buffer> {
  const bytes = await readFile(join(root, ...parts))
  if (!bytes.length || bytes.length > maximum) throw new PluginSupervisorError('unavailable')
  return bytes
}
export async function localPluginArchive(
  root: string,
  release: Readonly<PluginRelease>,
): Promise<Buffer> {
  const suffix = release.archive.compression === 'tar.gz' ? '.tar.gz' : '.tar'
  const bytes = await readLocalRelease(
    root,
    ['archives', release.archive.sha256 + suffix],
    Math.min(release.archive.size, PLUGIN_LIMITS.archiveBytes),
  )
  verifyPluginDigest(bytes, release.archive, PLUGIN_LIMITS.archiveBytes)
  return bytes
}
/** Allows only explicit appData-relative build inputs, never cwd/workspace/env selections. */
export function localReleaseRoot(appData: string): string {
  return join(appData, '@brobot2', 'plugin-release-input', 'v1')
}
