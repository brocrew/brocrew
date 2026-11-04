import type { PluginNodeProcess, PluginNodeStart, createPluginNodeHost } from '../node-host'
import { PluginSupervisor, type OwnedPluginChild } from './owner'
import { PluginSupervisorError } from './protocol'
import { PluginHostError } from '../node-host-files'

/** Adapt the actual owned process result to the supervisor child interface. */
export function ownedPluginNodeProcess(process: PluginNodeProcess): OwnedPluginChild {
  const proof = process.exited.then(
    (result) => result.exited === true,
    () => false,
  )
  const exited = proof.then((gone) => {
    if (!gone) throw new PluginSupervisorError('cleanup-pending')
  })
  // A run can fail before the owner begins draining. Keep that rejection observed until then.
  void exited.catch(() => undefined)
  return Object.freeze({
    async stop() {
      if ((await process.stop()).exited !== true) throw new PluginSupervisorError('cleanup-pending')
    },
    exited,
    descendantsGone: () => proof.catch(() => false),
  })
}

/** Trusted controller seam, never exposed over the workspace lease socket. */
export function createSupervisedPluginHost(
  owner: PluginSupervisor,
  host: Pick<ReturnType<typeof createPluginNodeHost>, 'start'>,
) {
  async function prepare(spec: PluginNodeStart) {
    let process!: PluginNodeProcess
    // Register the asynchronous launch before it creates the package process.
    const child = await owner.startChild(async () => {
      process = await host.start(spec)
      return ownedPluginNodeProcess(process)
    })
    return Object.freeze({
      runId: process.runId,
      receiptPath: process.receiptPath,
      ready: () => process.ready(),
      exited: child.exited,
      stop: async () => {
        await child.stop()
      },
    })
  }
  return Object.freeze({
    prepare,
    async start(spec: PluginNodeStart) {
      const process = await prepare(spec)
      try {
        const connection = await process.ready()
        return Object.freeze({
          ...process,
          runId: process.runId,
          receiptPath: process.receiptPath,
          connection,
        })
      } catch (error) {
        // The registered run stays owned even when readiness or cleanup fails.
        await process.stop().catch(() => undefined)
        throw new PluginSupervisorError(
          error instanceof PluginHostError && error.code === 'unsupported'
            ? 'unsupported'
            : 'unavailable',
        )
      }
    },
  })
}
