import { PackageRefSchema } from '../../../shared/plugin-package'
import { PLUGIN_FRAMEWORK_FEATURES } from '../hooks/definitions'
import { createServer, createConnection, type Socket } from 'node:net'
import { join } from 'node:path'
import { localEndpoint } from '../local-endpoint'
import { z } from 'zod'
import { privateChild } from '../node-host-files'
import { PluginSupervisorError, Hex } from '../supervisor/protocol'
import { PersonChannel } from './transport'
import type { PluginLifecycleController } from './controller'
import type { LifecycleWorkspace } from './types'
import { ProjectionReceipt } from '../state/format'
import {
  PluginHostUiRequest,
  PluginTitlesInput,
  PluginPageCall,
  PluginPageCancel,
} from '../host-wire'

const id = z.string()
const Request = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('attach'),
    workspaceId: z.uuid(),
    catalogueDigest: Hex.optional(),
  }),
  z.strictObject({
    kind: z.literal('package-install'),
    action: z.enum(['install', 'update']),
    package: PackageRefSchema,
    operationId: z.uuid(),
  }),
  z.strictObject({ kind: z.literal('list') }),
  z.strictObject({ kind: z.literal('list-v2') }),
  z.strictObject({ kind: z.literal('list-tool-health') }),
  z.strictObject({ kind: z.literal('features') }),
  z.strictObject({ kind: z.literal('restart-plugin'), pluginId: id }),
  z.strictObject({ kind: z.literal('refresh'), catalogueDigest: Hex }),
  z.strictObject({ kind: z.literal('update'), pluginId: id, operationId: z.uuid() }),
  z.strictObject({ kind: z.literal('install'), pluginId: id, operationId: z.uuid() }),
  z.strictObject({ kind: z.literal('uninstall'), pluginId: id, operationId: z.uuid() }),
  z.strictObject({ kind: z.literal('screen'), pluginId: id }),
  z.strictObject({ kind: z.literal('host-snapshot') }),
  z.strictObject({ kind: z.literal('host-ui'), request: PluginHostUiRequest }),
  z.strictObject({ kind: z.literal('host-before-turn'), input: PluginTitlesInput }),
  z.strictObject({ kind: z.literal('host-screen'), pluginId: id, viewId: z.string().optional() }),
  z.strictObject({ kind: z.literal('page-tool'), input: PluginPageCall }),
  z.strictObject({ kind: z.literal('page-cancel'), input: PluginPageCancel }),
  z.strictObject({ kind: z.literal('detach') }),
])
export const ProjectionChange = z.strictObject({
  pluginId: id,
  before: ProjectionReceipt.nullable(),
  receipt: ProjectionReceipt.nullable(),
})
export const ConsumerCommand = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('host-changed') }),
  z.strictObject({
    kind: z.literal('host-settings-open'),
    viewId: z.string(),
    pluginId: id,
    handle: z.string(),
  }),
  z.strictObject({ kind: z.literal('revoke'), pluginId: id, installId: z.uuid() }),
  z.strictObject({ kind: z.literal('reconcile'), change: ProjectionChange }),
  z.strictObject({
    kind: z.literal('applied'),
    pluginId: id,
    receipt: ProjectionReceipt.nullable(),
  }),
])
/** Local settings methods served by the current supervisor instance. */
export async function servePersonPluginControl(options: {
  root: string
  key: string
  controller: PluginLifecycleController
  restartPlugin?: (pluginId: string) => Promise<void>
}) {
  const folder = await privateChild(options.root, 'person-control')
  const path = localEndpoint(join(folder, 'person.sock'), 'person', options.key)
  const channels = new Set<PersonChannel>(),
    sessions = new Set<{
      channel: PersonChannel
      handle?: LifecycleWorkspace
      attaching: boolean
      lost: boolean
      failed: boolean
      detaching?: Promise<void>
    }>()
  let closing = false
  // A detach refused while its channel is open is tried again once that channel has closed, when
  // every notice to its consumer holds.
  const detach = (session: {
    channel: PersonChannel
    handle?: LifecycleWorkspace
    failed: boolean
    detaching?: Promise<void>
  }): Promise<void> =>
    (session.detaching ??= (async () => {
      const handle = session.handle
      session.handle = undefined
      try {
        if (handle) await options.controller.detach(handle)
        session.failed = false
      } catch {
        session.failed = true
        session.handle = handle
        throw new PluginSupervisorError('cleanup-pending')
      }
    })().finally(() => {
      session.detaching = undefined
    }))
  const server = createServer((socket: Socket) => {
    if (closing) {
      socket.destroy()
      return
    }
    let negotiatedRefusals = false
    const channel = new PersonChannel(
      socket,
      options.key,
      '',
      'server',
      async (input) => {
        const request = Request.parse(input)
        if (closing) throw new PluginSupervisorError('unavailable')
        if (request.kind === 'attach') {
          if (session.handle || session.attaching || session.lost || session.failed)
            throw new PluginSupervisorError('unavailable')
          // Snapshot actual source provenance, never today's IDs or caller-supplied metadata.
          session.attaching = true
          // A closed channel was this consumer's only route to its plugins, so the consumer ended
          // with it: every notice to it holds, and a lost session detaches without its answer.
          const tell = async (command: z.infer<typeof ConsumerCommand>): Promise<unknown> => {
            if (!channel.open) return true
            try {
              return await channel.call(command)
            } catch (error) {
              if (!channel.open) return true
              throw error
            }
          }
          try {
            session.handle = await options.controller.attach({
              workspaceId: request.workspaceId,
              revoke: async (pluginId, installId) =>
                (await tell({ kind: 'revoke', pluginId, installId })) === true,
              applied: async (pluginId, receipt) => {
                await tell({ kind: 'applied', pluginId, receipt })
              },
              reconcile: async (change) => {
                await tell({
                  kind: 'reconcile',
                  change: {
                    pluginId: change.pluginId,
                    before: change.before,
                    receipt: change.receipt,
                  },
                })
              },
            })
          } catch (error) {
            session.attaching = false
            session.failed =
              error instanceof PluginSupervisorError && error.code === 'cleanup-pending'
            if (session.lost && !session.failed) sessions.delete(session)
            throw error
          }
          session.attaching = false
          if (session.lost || closing) {
            await detach(session)
            throw new PluginSupervisorError('unavailable')
          }
          return { personProtocol: 2 }
        }
        if (!session.handle || session.failed) throw new PluginSupervisorError('unavailable')
        const handle = session.handle
        switch (request.kind) {
          case 'host-snapshot':
            return options.controller.hostSnapshot(handle)
          case 'host-ui':
            return options.controller.hostUi(handle, request.request)
          case 'host-before-turn':
            return options.controller.hostBeforeTurn(handle, request.input)
          case 'host-screen':
            return options.controller.hostScreen(handle, request.pluginId, request.viewId)
          case 'page-tool':
            return options.controller.hostPageTool(handle, request.input)
          case 'page-cancel':
            return options.controller.hostPageCancel(handle, request.input)
          case 'package-install':
            negotiatedRefusals = true
            await options.controller.installPackage(
              handle,
              request.package,
              request.action,
              request.operationId,
            )
            return true
          case 'features':
            return {
              features: [
                ...PLUGIN_FRAMEWORK_FEATURES,
                'plugin-host-v1',
                'tool-health-v1',
                ...(options.restartPlugin ? ['plugin-restart-v1'] : []),
              ],
            }
          case 'list':
            return (await options.controller.status()).cards.map(
              ({ id, name, state, installed, priorityClamped }) => ({
                id,
                name,
                state,
                installed,
                ...(priorityClamped !== undefined ? { priorityClamped } : {}),
              }),
            )
          case 'list-v2':
            // Older clients strictly validate their reply. New health fields require negotiation.
            return (await options.controller.status()).cards.map((card) => {
              const legacy = { ...card }
              delete legacy.toolsUnavailable
              return legacy
            })
          case 'list-tool-health':
            return (await options.controller.status()).cards
          case 'restart-plugin':
            if (!options.restartPlugin) throw new PluginSupervisorError('incompatible')
            await options.restartPlugin(request.pluginId)
            return true
          case 'refresh':
            await options.controller.refreshCatalogue(request.catalogueDigest)
            return true
          case 'update':
          case 'install':
            if (request.kind === 'install')
              await options.controller.install(handle, request.pluginId, request.operationId)
            else await options.controller.update(handle, request.pluginId, request.operationId)
            return true
          case 'uninstall':
            return (
              (await options.controller.uninstall(handle, request.pluginId, request.operationId)) ??
              true
            )
          case 'screen': {
            const screen = options.controller.screen(handle, request.pluginId)
            return screen.installation
          }
          case 'detach':
            await detach(session)
            return true
        }
      },
      () => negotiatedRefusals,
    )
    type PersonSession = {
      channel: PersonChannel
      handle?: LifecycleWorkspace
      attaching: boolean
      lost: boolean
      failed: boolean
      detaching?: Promise<void>
    }

    const session: PersonSession = {
      channel,
      attaching: false,
      lost: false,
      failed: false,
    }
    const openedViews = new Set<string>()
    let hostNoticeQueued = false
    const stopHost = options.controller.onHostChanged((workspaceId) => {
      if (
        !session.handle ||
        !channel.open ||
        hostNoticeQueued ||
        options.controller.hostWorkspace(session.handle) !== workspaceId
      )
        return
      hostNoticeQueued = true
      queueMicrotask(() => {
        try {
          if (!session.handle || !channel.open) return
          const snapshot = options.controller.hostSnapshot(session.handle)
          void channel.call({ kind: 'host-changed' }).catch(() => {})
          for (const view of snapshot.settingsViews ?? [])
            if (!openedViews.has(view.viewId)) {
              openedViews.add(view.viewId)
              void channel.call({ kind: 'host-settings-open', ...view }).catch(() => {})
            }
          for (const id of openedViews)
            if (!snapshot.settingsViews?.some((view) => view.viewId === id)) openedViews.delete(id)
        } catch {
          /* The consumer can detach while its snapshot changes. */
        } finally {
          hostNoticeQueued = false
        }
      })
    })
    sessions.add(session)
    channels.add(channel)
    channel.onClose(() => {
      stopHost()
      session.lost = true
      channels.delete(channel)
      // Closed sessions detach independently; their callbacks cannot hold the service open.
      if (!session.attaching)
        void detach(session)
          .catch(() => detach(session)) // An attempt begun while it was open is made again.
          .then(
            () => sessions.delete(session),
            () => undefined,
          )
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    // Never remove a socket at startup: an incumbent/uncertain endpoint is a refusal.
    server.listen(path, () => {
      server.off('error', reject)
      resolve()
    })
  })
  server.on('error', () => {
    for (const channel of channels) channel.close()
  })
  const endConsumers = () => {
    closing = true
    for (const channel of channels) channel.close()
  }
  return {
    path,
    endConsumers,
    async close(_options: { endConsumers?: boolean } = {}): Promise<void> {
      void _options
      closing = true
      // Close channels first; UI work and detach acknowledgements never own a process.
      endConsumers()
      for (const session of sessions) void detach(session).catch(() => undefined)
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
export async function connectPersonPluginControl(options: {
  path: string
  key: string
  handle(input: unknown): Promise<unknown>
}): Promise<PersonChannel> {
  return new Promise((resolve, reject) => {
    const endpoint = localEndpoint(options.path, 'person', options.key)
    const socket = createConnection(endpoint)
    const timer = setTimeout(() => {
      socket.destroy()
      reject(
        new PluginSupervisorError('unavailable', {
          cause: new Error(`no connection to the plugin service at ${endpoint} within 2000 ms`),
        }),
      )
    }, 2000)
    const failed = (error: Error) => {
      clearTimeout(timer)
      socket.destroy()
      reject(
        new PluginSupervisorError('unavailable', {
          cause: new Error(`could not connect to the plugin service at ${endpoint}`, {
            cause: error,
          }),
        }),
      )
    }
    socket.once('error', failed)
    socket.once('connect', () => {
      socket.off('error', failed)
      clearTimeout(timer)
      resolve(new PersonChannel(socket, options.key, '', 'client', options.handle))
    })
  })
}
