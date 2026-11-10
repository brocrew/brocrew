import { nodeFs, type RecoveryFs } from '../../../src/main/recovery/files'

// Simulated process stops cannot observe flushes to disk.
export const UNFLUSHED: RecoveryFs = {
  ...nodeFs,
  open: async (path, flags, mode) => {
    const handle = await nodeFs.open(path, flags, mode)
    return { ...handle, sync: () => Promise.resolve() }
  },
}

export function withFileChanges(
  real: RecoveryFs,
  change: <T>(operation: () => Promise<T>) => Promise<T>,
): RecoveryFs {
  return {
    ...real,
    copyFile: (from, to, mode) => change(() => real.copyFile(from, to, mode)),
    link: (existing, name) => change(() => real.link(existing, name)),
    unlink: (path) => change(() => real.unlink(path)),
    rm: (path, options) => change(() => real.rm(path, options)),
    mkdir: (path, options) => change(() => real.mkdir(path, options)),
    mkdtemp: (prefix) => change(() => real.mkdtemp(prefix)),
    writeFile: (path, data, options) => change(() => real.writeFile(path, data, options)),
    open: async (path, flags, mode) => {
      if (flags === 'r') return real.open(path, flags, mode)
      const handle = await change(() => real.open(path, flags, mode))
      return { ...handle, writeFile: (data) => change(() => handle.writeFile(data)) }
    },
  }
}
