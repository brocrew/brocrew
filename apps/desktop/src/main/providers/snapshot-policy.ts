import type { ProviderSnapshotFile } from '../../shared/provider-snapshots'

export interface SnapshotPolicy {
  fileFor(platform: NodeJS.Platform): ProviderSnapshotFile
}

/** Keep bundled capture text inert until requested, then reuse that platform's decoded capture. */
export function createSnapshotPolicy(
  linuxSource: () => string,
  macSource: () => string,
): SnapshotPolicy {
  const decodeOnce = (source: () => string): (() => ProviderSnapshotFile) => {
    let loaded = false
    let file: ProviderSnapshotFile
    return () => {
      if (!loaded) {
        file = JSON.parse(source()) as ProviderSnapshotFile
        loaded = true
      }
      return file
    }
  }
  const linux = decodeOnce(linuxSource)
  const mac = decodeOnce(macSource)
  return { fileFor: (platform) => (platform === 'linux' ? linux() : mac()) }
}
