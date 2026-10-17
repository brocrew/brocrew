/**
 * Where each folder's Claude local settings are kept, as last found. Finding one runs git, so it is
 * found off the main thread (`local-settings-locator.worker.ts`) and kept here: a read of the kept
 * rules waits for a refresh without blocking the window, and a removal reads what is kept.
 */
export interface SettingsLocations {
  /** The files found so far for these folders, each once; a folder not found yet is left out. */
  known(folders: readonly string[]): string[]
  /** The folders among these whose file has never been found. */
  unfound(folders: readonly string[]): string[]
  /**
   * Find these folders' files again. One refresh runs at a time: a call for folders the running one
   * covers waits for it, and any other waits for it and then runs its own. A refresh that fails
   * keeps what was known.
   */
  refresh(folders: readonly string[]): Promise<void>
}

export function settingsLocations(
  locate: (folders: readonly string[]) => Promise<ReadonlyMap<string, string>>,
): SettingsLocations {
  const found = new Map<string, string>()
  let running: { readonly folders: ReadonlySet<string>; readonly done: Promise<void> } | null = null
  const start = (folders: readonly string[]): Promise<void> => {
    const done = locate(folders)
      .then((located) => {
        for (const [folder, file] of located) found.set(folder, file)
      })
      .catch((error: unknown) => {
        console.warn(
          `could not find where the kept rules are: ${error instanceof Error ? error.message : String(error)}`,
        )
      })
      .finally(() => {
        if (running?.done === done) running = null
      })
    running = { folders: new Set(folders), done }
    return done
  }
  const refresh = (folders: readonly string[]): Promise<void> => {
    const now = running
    if (now === null) return start(folders)
    if (folders.every((folder) => now.folders.has(folder))) return now.done
    return now.done.then(() => refresh(folders))
  }
  return {
    known: (folders) => [
      ...new Set(
        folders.flatMap((folder) => {
          const file = found.get(folder)
          return file === undefined ? [] : [file]
        }),
      ),
    ],
    unfound: (folders) => folders.filter((folder) => !found.has(folder)),
    refresh,
  }
}
