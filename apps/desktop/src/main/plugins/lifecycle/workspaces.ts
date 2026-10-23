import type { PluginLifecycleController } from './controller'
import type { LifecycleWorkspace, WorkspaceProjection } from './types'

/** Person UI and agent consumers share one lifecycle projection, with independent lifetimes. */
export function sharedLifecycleWorkspaces(
  controller: PluginLifecycleController,
): PluginLifecycleController {
  const groups = new Map<
    string,
    { sinks: Set<WorkspaceProjection>; ready: Promise<LifecycleWorkspace> }
  >()
  const clients = new Map<
    LifecycleWorkspace,
    { sink: WorkspaceProjection; actual: LifecycleWorkspace }
  >()
  const actual = (handle: LifecycleWorkspace) => {
    const client = clients.get(handle)
    if (!client) throw new Error('unavailable')
    return client.actual
  }
  return new Proxy(controller, {
    get(target, key) {
      if (key === 'attach')
        return async (sink: WorkspaceProjection) => {
          let group = groups.get(sink.workspaceId)
          const existing = group !== undefined
          if (!group) {
            const sinks = new Set([sink])
            const projection: WorkspaceProjection = {
              workspaceId: sink.workspaceId,
              async revoke(id, install) {
                return (await Promise.all([...sinks].map((one) => one.revoke(id, install)))).every(
                  (one) => one === true,
                )
              },
              async applied(id, receipt) {
                await Promise.all([...sinks].map((one) => one.applied(id, receipt)))
              },
              async reconcile(change) {
                await Promise.all([...sinks].map((one) => one.reconcile(change)))
              },
            }
            group = { sinks, ready: target.attach(projection) }
            groups.set(sink.workspaceId, group)
          } else group.sinks.add(sink)
          try {
            const handle = await group.ready
            if (existing) await target.reconcileConsumer(handle, sink)
            const token = Object.freeze({}) as LifecycleWorkspace
            clients.set(token, { sink, actual: handle })
            return token
          } catch (error) {
            group.sinks.delete(sink)
            if (!group.sinks.size) groups.delete(sink.workspaceId)
            throw error
          }
        }
      if (key === 'detach')
        return async (handle: LifecycleWorkspace) => {
          const client = clients.get(handle)
          if (!client) return
          const receipts = target.consumerReceipts(client.actual)
          clients.delete(handle)
          const proofs = await Promise.allSettled(
            receipts.map((receipt) => client.sink.revoke(receipt.pluginId, receipt.installId)),
          )
          if (proofs.some((one) => one.status !== 'fulfilled' || one.value !== true)) {
            clients.set(handle, client) // Its consumer may detach again, as when its channel closes.
            throw new Error('unavailable')
          }
          const group = groups.get(client.sink.workspaceId)
          group?.sinks.delete(client.sink)
          if (group && group.sinks.size === 0) {
            groups.delete(client.sink.workspaceId)
            await target.detach(client.actual)
          }
        }
      if (key === 'contributions')
        return (handle: LifecycleWorkspace, id: string, revision?: number) => {
          const entry = target.contributions(actual(handle), id, revision)
          return Object.freeze({ ...entry, current: () => clients.has(handle) && entry.current() })
        }
      const value = Reflect.get(target, key, target)
      if (typeof value !== 'function') return value
      if (
        [
          'screen',
          'admitted',
          'install',
          'prepareMutation',
          'installPrepared',
          'updatePrepared',
          'update',
          'uninstall',
          'profileRevision',
          'applyProfile',
        ].includes(String(key))
      )
        return (handle: LifecycleWorkspace, ...args: unknown[]) =>
          value.call(target, actual(handle), ...args)
      return value.bind(target)
    },
  })
}
