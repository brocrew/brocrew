import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { PluginDiskOptions } from './disk'
import { refuseState, stateFilesIn } from './format'
import { decodeStateFile } from './machine'

/**
 * The state the plugin service last wrote, for display only; it grants no mutation or admission
 * authority. One small file read, never long on the main thread. Before the service has written
 * the file there is nothing to show yet.
 */
async function readCommitted(options: PluginDiskOptions) {
  let tried: string | undefined
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = stateFilesIn(await readdir(options.root))[0]
    if (!current || current.name === tried) break
    tried = current.name
    try {
      return decodeStateFile(await readFile(join(options.root, current.name)))
    } catch (error) {
      // A newer write may have removed this one after it was listed: list again and read that.
      if (attempt === 2) throw error
    }
  }
  return refuseState('missing-guard')
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
