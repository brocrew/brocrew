import { lstat, readdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { privateChild } from '../node-host-files'
import { isPrivateEntry, openFileNotThroughALink } from '../private-files'

const receipt = z.object({
  format: z.literal(1),
  runId: z.uuid(),
  pluginId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  releaseDigest: z.string().regex(/^[a-f0-9]{64}$/),
  guardianPid: z.number().int().min(2),
  groups: z.array(z.tuple([z.number().int().min(2), z.string().min(1).max(256)])).max(1024),
  exited: z.literal(true),
})
async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** Fenced append-only history: supported hosts create a run directory before every fork. */
export async function previousRunsProvenStopped(root: string): Promise<boolean> {
  try {
    const hostPath = join(root, 'host')
    if (!(await exists(hostPath))) return true
    const host = await privateChild(root, 'host', false)
    const runsPath = join(host, 'runs')
    if (!(await exists(runsPath))) return true
    const runs = await privateChild(host, 'runs', false)
    const entries = await readdir(runs, { withFileTypes: true })
    if (entries.length > 4096) return false
    for (const entry of entries) {
      if (!entry.isDirectory() || !z.uuid().safeParse(entry.name).success) return false
      const directory = await privateChild(runs, entry.name, false)
      const file = await openFileNotThroughALink(
        join(directory, 'exit.json'),
        constants.O_RDONLY | constants.O_NONBLOCK,
      )
      try {
        const stat = await file.stat()
        if (
          !stat.isFile() ||
          stat.nlink !== 1 ||
          !isPrivateEntry(stat) ||
          stat.size > 64 * 1024 ||
          stat.size === 0
        )
          return false
        const proof = receipt.parse(JSON.parse(await file.readFile('utf8')))
        if (proof.runId !== entry.name) return false
      } finally {
        await file.close()
      }
    }
    // Enumeration and reads never alter profile data, run receipts or the lifecycle journal.
    return true
  } catch {
    return false
  }
}
