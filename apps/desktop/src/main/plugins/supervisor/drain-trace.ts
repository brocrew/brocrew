import { closeSync, constants, fstatSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { createFreshFile, openNotThroughALink } from '@brobot2/runtime/provider-home'
import { isPrivateEntry } from '../private-files'
import { pluginStartupStderr } from '../startup-failure'
import type { StopReason } from './protocol'

export interface DrainTrace {
  stage:
    | 'drain'
    | 'invalidation'
    | 'child-stop'
    | 'child-exit'
    | 'descendants'
    | 'revoke'
    | 'stop-write'
    | 'child-start'
    | 'child-proofs'
    | 'server.close'
    | 'stopped-write'
    | 'blocked-write'
    | 'closed'
  state: 'waiting' | 'complete' | 'failed'
  epoch?: string
  reason?: StopReason
  cause?: string
  attempt?: number
  errno?: string
}
/** Private, bounded, sanitized local diagnostic text; no launch input or plugin output. */
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
    if (!stat.isFile() || stat.nlink !== 1 || !isPrivateEntry(stat) || stat.size > 1024 * 1024)
      return
    writeSync(
      fd,
      `${new Date().toISOString()} [plugins] drain stage=${event.stage} state=${event.state}${event.attempt ? ` attempt=${event.attempt}` : ''}${event.errno ? ` errno=${event.errno}` : ''}${event.epoch ? ` epoch=${event.epoch}` : ''}${event.reason ? ` reason=${event.reason}` : ''}${event.cause ? ` cause=${pluginStartupStderr(event.cause) ?? 'Unknown failure'}` : ''}\n`,
    )
  } catch {
    // A diagnostic cannot delay or change ownership.
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}
