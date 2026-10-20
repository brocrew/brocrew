import { PLUGIN_LIMITS } from '../package-digests'
import type { PluginRelease } from '../package-schema'
import { PluginSupervisorError } from '../supervisor/protocol'
import { downloadPluginBytes } from '../catalogue/download'
/** Same bounded GitHub transport as catalogue/signature; downloaded digests checked before staging. */
export async function downloadPluginArchive(
  release: Readonly<PluginRelease>,
  signal: AbortSignal,
): Promise<Uint8Array> {
  try {
    return await downloadPluginBytes({
      url: release.archive.url,
      maximum: PLUGIN_LIMITS.archiveBytes,
      size: release.archive.size,
      sha256: release.archive.sha256,
      signal,
    })
  } catch {
    throw new PluginSupervisorError('unavailable')
  }
}
