import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PluginDiskOptions } from './disk'
import { STATE_FILE } from './format'
import { decodeStateFile } from './machine'

/**
 * The state the plugin service last wrote, for display only; it grants no mutation or admission
 * authority. One small file read, never long on the main thread. Before the service has written
 * the file there is nothing to show yet.
 */
async function readCommitted(options: PluginDiskOptions) {
  return decodeStateFile(await readFile(join(options.root, STATE_FILE)))
}

/** Missing, partial or unreadable data is unknown (null), never an action state. */
export async function observeInstallations(options: PluginDiskOptions) {
  try {
    const state = await readCommitted(options)
    return {
      installed: [...state.admitted.keys()],
      pending: state.pending?.request.consent.pluginId ?? null,
    }
  } catch {
    return null
  }
}

/** The installed release of one plugin; unknown (null) while any operation is pending. */
export async function observeInstalledPackage(options: PluginDiskOptions, id: string) {
  try {
    const state = await readCommitted(options)
    if (state.pending !== null) return null
    const installed = state.admitted.get(id)
    if (!installed) return null
    return Object.freeze({
      version: installed.release.version,
      archiveSha256: installed.release.archiveSha256,
      manifestSha256: installed.release.manifestSha256,
    })
  } catch {
    return null
  }
}
