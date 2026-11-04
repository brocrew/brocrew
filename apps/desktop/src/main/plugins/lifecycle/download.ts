import { verifyPluginDigest } from '../package-digests'
import type { PluginRelease } from '../package-schema'
import { PluginSupervisorError } from '../supervisor/protocol'
import { readPackageRef, releasePackageRef } from '../package-source'
/** Read the selected source; the installer checks its archive and manifest before staging. */
export async function downloadPluginArchive(
  release: Readonly<PluginRelease>,
  signal: AbortSignal,
): Promise<Uint8Array> {
  try {
    const { archive } = await readPackageRef(releasePackageRef(release), { signal })
    verifyPluginDigest(archive, release.archive, Number.MAX_SAFE_INTEGER)
    return archive
  } catch (error) {
    if (error instanceof Error) throw error
    throw new PluginSupervisorError('unavailable')
  }
}
