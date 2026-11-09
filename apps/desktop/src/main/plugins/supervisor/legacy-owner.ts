import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

// Delete once upgrades from 0.2.14 and older no longer need supporting.
export async function stopLegacySupervisor(
  root: string,
  stillLegacy: () => boolean,
): Promise<void> {
  const launches = join(root, 'supervisor-launches')
  const receipts = await Promise.all(
    (await readdir(launches)).map(async (directory) => {
      try {
        const path = join(launches, directory, 'service.json')
        const service = JSON.parse(await readFile(path, 'utf8'))
        return service.format === 1 && service.ready === true
          ? { pid: service.pid as number, at: (await stat(path)).mtimeMs }
          : null
      } catch {
        return null
      }
    }),
  )
  const latest = receipts.filter((receipt) => receipt !== null).sort((a, b) => b.at - a.at)[0]
  if (latest && stillLegacy()) {
    try {
      process.kill(latest.pid)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
}
