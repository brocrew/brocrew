import type { PluginLifecycleController } from './controller'
import { bounded } from './plugin-work'
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
          if (!group) {
            const sinks = new Set([sink])
            const projection: WorkspaceProjection = {
              workspaceId: sink.workspaceId,
              async revoke(id, install) {
                return (await Promise.all([...sinks].map((one) => one.revoke(id, install)))).every(
                  (one) => one === true,
                )
              },
            }
            group = { sinks, ready: target.attach(projection) }
            groups.set(sink.workspaceId, group)
          } else group.sinks.add(sink)
          try {
            const handle = await group.ready
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
          const installs = target.consumerInstalls(client.actual)
          clients.delete(handle)
          // A notice to the leaving consumer, bounded; its answer never keeps it attached.
          await Promise.all(
            installs.map(async (one) => {
              try {
                if ((await bounded(() => client.sink.revoke(one.pluginId, one.installId))) !== true)
                  console.warn(
                    `[plugins] ${one.pluginId}: workspace ${client.sink.workspaceId} was still winding down at detach`,
                  )
              } catch (error) {
                console.warn(
                  `[plugins] ${one.pluginId}: workspace ${client.sink.workspaceId} did not answer its detach notice`,
                  error,
                )
              }
            }),
          )
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
