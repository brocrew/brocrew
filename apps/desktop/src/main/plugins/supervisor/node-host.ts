import type { PluginNodeProcess, PluginNodeStart, createPluginNodeHost } from '../node-host'
import { PluginSupervisor, type OwnedPluginChild } from './owner'
import { PluginSupervisorError } from './protocol'
import { PluginHostError } from '../node-host-files'

/** Only the positive proof from this exact host handle establishes descendant exit. */
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
    // Register the asynchronous start before the host can create a guardian or browser.
    const child = await owner.startChild(async () => {
      process = await host.start(spec)
      return ownedPluginNodeProcess(process)
    })
    return Object.freeze({
      runId: process.runId,
      receiptPath: process.receiptPath,
      ready: () => process.ready(),
      exited: child.exited,
      async stop(): Promise<void> {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([
            Promise.all([
              Promise.resolve()
                .then(() => child.stop())
                .catch(() => undefined),
              child.exited,
              child.descendantsGone().then((gone) => {
                if (gone !== true) throw new PluginSupervisorError('cleanup-pending')
              }),
            ]),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new PluginSupervisorError('cleanup-pending')), 20000)
            }),
          ])
        } finally {
          clearTimeout(timer)
        }
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
