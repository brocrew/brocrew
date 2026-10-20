import type { ChildProcess } from 'node:child_process'
import { refuse } from '../../src/main/plugins/supervisor/protocol'
import type { OwnedPluginChild } from '../../src/main/plugins/supervisor/owner'

export { PluginSupervisor } from '../../src/main/plugins/supervisor/owner'

/**
 * A real POSIX process group as the owner's child witness, for tests that drain one. The product's
 * witness is the plugin host's own exit proof (`ownedPluginNodeProcess`). The child must have been
 * spawned detached, so it leads its own group.
 */
export function ownedProcessGroup(child: ChildProcess): OwnedPluginChild {
  if (!child.pid || process.platform === 'win32') refuse('unsupported')
  const pid = child.pid
  const exited =
    child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve()
      : new Promise<void>((resolve) => child.once('exit', () => resolve()))
  return {
    stop: () => {
      // Do not signal a possibly recycled PID/group after our direct child already exited.
      if (child.exitCode === null && child.signalCode === null) {
        try {
          process.kill(-pid, 'SIGTERM')
        } catch (error) {
          // ESRCH can precede Node's exit event. Ignore only the failed signal, not the
          // mandatory real exit witness and subsequent descendant proof.
          if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error
        }
      }
    },
    exited,
    descendantsGone: async () => {
      try {
        process.kill(-pid, 0)
        return false
      } catch (error) {
        return error instanceof Error && 'code' in error && error.code === 'ESRCH'
      }
    },
  }
}
