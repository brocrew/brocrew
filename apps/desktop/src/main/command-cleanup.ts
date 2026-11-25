import { execFile } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { isInside } from '@brobot2/shared/paths'
import { PS_ARGS, PS_MAX_BUFFER_BYTES, parseProcessTable } from './process-tree'
import { WORKER_OUTPUT_DIRNAME } from './storage/engine'

/** A worker end owns its one output directory, never the shared workspace or its peers. */
export function workerCommandFolder(userData: string, cwd: string): string | null {
  const root = join(realpathSync.native(userData), WORKER_OUTPUT_DIRNAME)
  const current = realpathSync.native(cwd)
  if (!isInside(root, current, { orSame: false })) return null
  const piece = relative(root, current).split(sep)[0]!
  if (piece === '..') return null
  return join(root, piece)
}

export async function stopWorkerCommands(
  userData: string,
  cwd: string,
  occupied: () => readonly string[] = () => [],
): Promise<void> {
  try {
    const folder = workerCommandFolder(userData, cwd)
    if (folder !== null) {
      await stopCommandsInFolders(
        [folder],
        () => !occupied().some((peer) => workerCommandFolder(userData, peer) === folder),
      )
    }
  } catch (error) {
    console.warn('Worker command cleanup could not inspect its folder:', error)
  }
}

export function stopOrphanedCommands(userData: string): Promise<void> {
  return stopCommandsInFolders([join(userData, WORKER_OUTPUT_DIRNAME)])
}

/**
 * ⚑ **Waits for the command to exit** (card 197): `lsof` took 21 s on a loaded Mac, and a fixed
 * limit there only made the sweep give up and leave the orphans running. Each caller runs once per
 * close or quit, so reads cannot pile up. A quit waits for it until it is pressed again, which
 * leaves after `IMPATIENT_EXIT_MS` (app-lifetime.ts).
 */
function listing(command: string, args: readonly string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(command, args, { maxBuffer: PS_MAX_BUFFER_BYTES }, (error, stdout) => {
      if (error && !(error.code === 1 && (command === 'lsof' || stdout === ''))) reject(error)
      else resolve(stdout)
    })
  })
}

interface Orphan {
  pid: number
  command: string
  cwd: string
}

async function commandsInFolders(folders: readonly string[]): Promise<Map<number, Orphan>> {
  const [directories, table] = await Promise.all([
    listing('lsof', ['-a', '-u', String(process.getuid!()), '-d', 'cwd', '-F0pn']),
    listing('ps', PS_ARGS),
  ])
  const orphans = new Map(
    parseProcessTable(table)
      .filter((row) => row.ppid === 1)
      .map((row) => [row.pid, row]),
  )
  const pids = new Map<number, Orphan>()
  let pid = 0
  for (const raw of directories.split('\0')) {
    const field = raw.replace(/^\n/, '')
    if (field.startsWith('p')) pid = Number(field.slice(1))
    if (
      field.startsWith('n') &&
      orphans.has(pid) &&
      pid !== process.pid &&
      folders.some((folder) => isInside(folder, field.slice(1)))
    )
      pids.set(pid, { pid, command: orphans.get(pid)!.name, cwd: field.slice(1) })
  }
  return pids
}

function signal(pid: number, value: NodeJS.Signals): void {
  try {
    process.kill(pid, value)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

/** One shutdown-only sweep for command children that escaped the provider's process group. */
export async function stopCommandsInFolders(
  folders: readonly string[],
  maySweep: () => boolean = () => true,
): Promise<void> {
  if (process.platform === 'win32' || folders.length === 0) return
  try {
    const canonical = folders.flatMap((folder) => {
      try {
        return [realpathSync.native(folder)]
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw error
      }
    })
    if (canonical.length === 0) return
    const seen = new Map<number, Orphan>()
    // Re-scan only during shutdown: ending a shell can orphan the command it was waiting for.
    for (let round = 0; round < 5; round++) {
      const current = await commandsInFolders(canonical)
      if (!maySweep()) return
      if (current.size === 0) return
      for (const [pid, orphan] of current) {
        const before = seen.get(pid)
        const action =
          before?.cwd === orphan.cwd && before.command === orphan.command ? 'SIGKILL' : 'SIGTERM'
        console.info('Ending orphaned agent command:', { ...orphan, signal: action })
        signal(pid, action)
        seen.set(pid, orphan)
      }
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
    const remaining = await commandsInFolders(canonical)
    if (remaining.size)
      console.warn('Orphaned agent commands remain after cleanup:', [...remaining.values()])
  } catch (error) {
    console.warn('Orphaned agent command cleanup failed:', error)
  }
}
