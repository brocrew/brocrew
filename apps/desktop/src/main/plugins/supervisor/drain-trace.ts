import { closeSync, constants, fstatSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { createFreshFile, openNotThroughALink } from '@brobot2/runtime/provider-home'

export interface DrainTrace {
  stage: 'child-proofs' | 'server.close' | 'stopped-write' | 'closed'
  state: 'waiting' | 'complete' | 'failed'
  attempt?: number
  errno?: string
}
/** Closed stage names and errno only; no error messages, launch input or plugin output. */
export function recordDrainTrace(root: string, event: DrainTrace): void {
  let fd: number | undefined
  try {
    const path = join(root, 'plugin-drain.log')
    try {
      fd = openNotThroughALink(path, constants.O_WRONLY | constants.O_APPEND | constants.O_NONBLOCK)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      fd = createFreshFile(path, 0o600)
    }
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > 1024 * 1024) return
    writeSync(
      fd,
      `${new Date().toISOString()} [plugins] drain stage=${event.stage} state=${event.state}${event.attempt ? ` attempt=${event.attempt}` : ''}${event.errno ? ` errno=${event.errno}` : ''}\n`,
    )
  } catch {
    // A diagnostic cannot delay or change ownership.
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}
