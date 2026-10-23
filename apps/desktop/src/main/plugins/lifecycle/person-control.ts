import { PLUGIN_FRAMEWORK_FEATURES } from '../hooks/definitions'
import { PluginProposal } from './proposals'
import { createServer, createConnection, type Socket } from 'node:net'
import { chmod, lstat, unlink } from 'node:fs/promises'
import { randomBytes, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { isSocketFile, localEndpoint } from '../local-endpoint'
import { z } from 'zod'
import { privateChild } from '../node-host-files'
import { PluginSupervisorError, Hex } from '../supervisor/protocol'
import { PersonChannel } from './transport'
import type { PluginLifecycleController, PreparedPluginMutation } from './controller'
import type { LifecycleWorkspace } from './types'
import { ProjectionReceipt } from '../state/format'

const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)
const Request = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('attach'),
    workspaceId: z.uuid(),
    catalogueDigest: Hex.optional(),
  }),
  z.strictObject({ kind: z.literal('list') }),
  z.strictObject({ kind: z.literal('list-v2') }),
  z.strictObject({ kind: z.literal('features') }),
  z.strictObject({ kind: z.literal('mutation-policy'), catalogueDigest: Hex }),
  z.strictObject({ kind: z.literal('mutation-status'), catalogueDigest: Hex }),
  z.strictObject({
    kind: z.literal('prepare-mutation'),
    action: z.enum(['install', 'update']),
    pluginId: id,
    releaseDigest: Hex,
  }),
  z.strictObject({
    kind: z.literal('update-prepared'),
    pluginId: id,
    operationId: z.uuid(),
    releaseDigest: Hex,
    preparation: z.uuid(),
  }),
  z.strictObject({ kind: z.literal('configure-ledger'), format: z.literal(2) }),
  z.strictObject({ kind: z.literal('refresh'), catalogueDigest: Hex }),
  z.strictObject({ kind: z.literal('update'), pluginId: id, operationId: z.uuid() }),
  z.strictObject({ kind: z.literal('install'), pluginId: id, operationId: z.uuid() }),
  z.strictObject({
    kind: z.literal('install-prepared'),
    preparation: z.uuid(),
    pluginId: id,
    operationId: z.uuid(),
    releaseDigest: Hex,
  }),
  z.strictObject({ kind: z.literal('uninstall'), pluginId: id, operationId: z.uuid() }),
  z.strictObject({ kind: z.literal('screen'), pluginId: id }),
  z.strictObject({ kind: z.literal('read'), pluginId: id, installId: z.uuid() }),
  z.strictObject({
    kind: z.literal('apply'),
    pluginId: id,
    installId: z.uuid(),
    incarnation: z.uuid(),
    revision: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER - 1),
    proposal: PluginProposal,
  }),
  z.strictObject({ kind: z.literal('detach') }),
])
export const ProjectionChange = z.strictObject({
  pluginId: id,
  before: ProjectionReceipt.nullable(),
  receipt: ProjectionReceipt.nullable(),
})
export const ConsumerCommand = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('revoke'), pluginId: id, installId: z.uuid() }),
  z.strictObject({ kind: z.literal('reconcile'), change: ProjectionChange }),
  z.strictObject({
    kind: z.literal('applied'),
    pluginId: id,
    receipt: ProjectionReceipt.nullable(),
  }),
])
/** Started inside the exclusively owned supervisor, using a distinct app/person capability.
 * Neither the key nor a lifecycle command is accepted by the workspace lease/broker protocol.
 */
export async function servePersonPluginControl(options: {
  root: string
  key: string
  controller: PluginLifecycleController
  read(
    pluginId: string,
    connection: Awaited<ReturnType<PluginLifecycleController['screen']>['connection']>,
  ): Promise<unknown>
}) {
  if (!Hex.safeParse(options.key).success) throw new PluginSupervisorError('unavailable')
  const folder = await privateChild(options.root, 'person-control')
  const path = localEndpoint(join(folder, 'person.sock'), 'person', options.key)
  if (isSocketFile() && Buffer.byteLength(path) > 100)
    throw new PluginSupervisorError('unavailable')
  const channels = new Set<PersonChannel>(),
    sessions = new Set<{
      channel: PersonChannel
      handle?: LifecycleWorkspace
      attaching: boolean
      lost: boolean
      failed: boolean
      ledgerV2?: boolean
      mutationSource?: string
      preparations: Map<string, PreparedPluginMutation & { expiresAt: number }>
      legacyIds?: readonly string[]
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
      if (session.failed && session.channel.open) throw new PluginSupervisorError('cleanup-pending')
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
    if (closing || channels.size >= 64) {
      socket.destroy()
      return
    }
    const challenge = randomBytes(32).toString('hex')
    // Fresh challenge binds every MAC/counter stream; even a captured attach cannot be replayed.
    socket.write(challenge + '\n')
    let negotiatedRefusals = false
    const channel = new PersonChannel(
      socket,
      options.key,
      challenge,
      'server',
      async (input) => {
        const request = Request.parse(input)
        if (closing) throw new PluginSupervisorError('unavailable')
        if (request.kind === 'attach') {
          if (session.handle || session.attaching || session.lost || session.failed)
            throw new PluginSupervisorError('unavailable')
          // Snapshot actual source provenance, never today's IDs or caller-supplied metadata.
          session.legacyIds =
            request.catalogueDigest === undefined
              ? undefined
              : options.controller.legacyCatalogueIds(request.catalogueDigest)
          clearTimeout(authentication)
          session.attaching = true
          // A closed channel was this consumer's only route to its plugins, so the consumer ended
          // with it: every notice to it holds, and a lost session detaches without its answer.
          const tell = async (command: z.infer<typeof ConsumerCommand>): Promise<unknown> => {
            const id = command.kind === 'reconcile' ? command.change.pluginId : command.pluginId
            if (session.legacyIds && !session.legacyIds.includes(id)) return true
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
          clearTimeout(authentication)
          if (session.lost || closing) {
            await detach(session)
            throw new PluginSupervisorError('unavailable')
          }
          return { personProtocol: 2 }
        }
        if (!session.handle || session.failed) throw new PluginSupervisorError('unavailable')
        const handle = session.handle
        if (
          'pluginId' in request &&
          session.legacyIds &&
          !session.legacyIds.includes(request.pluginId)
        )
          throw new PluginSupervisorError('incompatible')
        const visible = (id: string) => !session.legacyIds || session.legacyIds.includes(id)
        switch (request.kind) {
          case 'mutation-status':
            options.controller.requireMutationSource(request.catalogueDigest)
            if (!session.mutationSource) throw new PluginSupervisorError('incompatible')
            return { format: 1, catalogueDigest: request.catalogueDigest }
          case 'mutation-policy':
            negotiatedRefusals = true
            session.preparations.clear()
            session.mutationSource = undefined
            options.controller.requireMutationSource(request.catalogueDigest)
            session.mutationSource = request.catalogueDigest
            return { format: 1, catalogueDigest: request.catalogueDigest }
          case 'prepare-mutation': {
            if (!session.mutationSource) throw new PluginSupervisorError('incompatible')
            options.controller.requireMutationSource(session.mutationSource)
            const value = await options.controller.prepareMutation(
              handle,
              request.action,
              request.pluginId,
              request.releaseDigest,
              session.mutationSource,
            )
            // Bounded, one outstanding consent per plugin and session; replacement revokes the old consent.
            for (const [key, old] of session.preparations)
              if (old.pluginId === request.pluginId) session.preparations.delete(key)
            if (session.preparations.size >= 200) throw new PluginSupervisorError('policy-refused')
            const preparation = randomUUID()
            session.preparations.set(preparation, { ...value, expiresAt: Date.now() + 5 * 60_000 })
            return { preparation }
          }
          case 'features':
            return {
              features: [
                ...PLUGIN_FRAMEWORK_FEATURES,
                ...(options.controller.preparedMutationFeature()
                  ? ['authors-v1', 'prepared-mutations-v1']
                  : []),
              ],
            }
          case 'list':
            if (!session.legacyIds) throw new PluginSupervisorError('incompatible')
            return (await options.controller.status()).cards
              .filter((card) => visible(card.id))
              .map(({ id, name, state, installed, priorityClamped }) => ({
                id,
                name,
                state,
                installed,
                ...(priorityClamped !== undefined ? { priorityClamped } : {}),
              }))
          case 'list-v2':
            return (await options.controller.status()).cards.filter((card) => visible(card.id))
          case 'refresh':
            for (const one of sessions) one.preparations.clear()
            await options.controller.refreshCatalogue(request.catalogueDigest)
            return true
          case 'update':
          case 'install':
            if (options.controller.requiresPreparedMutations())
              throw new PluginSupervisorError('incompatible')
            if (request.kind === 'install')
              await options.controller.install(handle, request.pluginId, request.operationId)
            else await options.controller.update(handle, request.pluginId, request.operationId)
            return true
          case 'install-prepared':
          case 'update-prepared': {
            if (!session.mutationSource) throw new PluginSupervisorError('incompatible')
            const prepared = session.preparations.get(request.preparation)
            session.preparations.delete(request.preparation) // Consume even a failed attempt; no replay.
            options.controller.requireMutationSource(session.mutationSource)
            const action = request.kind === 'install-prepared' ? 'install' : 'update'
            if (
              !prepared ||
              prepared.expiresAt < Date.now() ||
              prepared.action !== action ||
              prepared.pluginId !== request.pluginId ||
              prepared.releaseDigest !== request.releaseDigest
            )
              throw new PluginSupervisorError('policy-refused')
            if (action === 'install')
              await options.controller.installPrepared(
                handle,
                request.pluginId,
                prepared,
                request.operationId,
              )
            else
              await options.controller.updatePrepared(
                handle,
                request.pluginId,
                prepared,
                request.operationId,
              )
            return true
          }
          case 'uninstall':
            return (
              (await options.controller.uninstall(handle, request.pluginId, request.operationId)) ??
              true
            )
          case 'screen': {
            const screen = options.controller.screen(handle, request.pluginId)
            return screen.installation
          }
          case 'configure-ledger':
            session.ledgerV2 = true
            return { format: 2, maxRevision: Number.MAX_SAFE_INTEGER }
          case 'apply':
            if (!session.ledgerV2 && request.revision > 4095)
              throw new PluginSupervisorError('incompatible')
            await options.controller.applyProfile(handle, {
              ...request,
              ledgerFormat: session.ledgerV2 ? 2 : 1,
            })
            return true
          case 'read': {
            const screen = options.controller.screen(handle, request.pluginId)
            if (screen.installation.installId !== request.installId)
              throw new PluginSupervisorError('unavailable')
            const revision = await options.controller.profileRevision(
              handle,
              request.pluginId,
              request.installId,
              session.ledgerV2 === true,
            )
            const snapshot = await options.read(request.pluginId, await screen.connection)
            // Recheck after the asynchronous read so uninstall never publishes a stale snapshot.
            if (!options.controller.admitted(handle, request.pluginId, request.installId))
              throw new PluginSupervisorError('unavailable')
            if (
              revision !==
                (await options.controller.profileRevision(
                  handle,
                  request.pluginId,
                  request.installId,
                  session.ledgerV2 === true,
                )) ||
              !snapshot ||
              typeof snapshot !== 'object' ||
              Array.isArray(snapshot)
            )
              throw new PluginSupervisorError('unavailable')
            return { ...snapshot, configRevision: revision }
          }
          case 'detach':
            await detach(session)
            return true
        }
      },
      () => negotiatedRefusals,
    )
    const authentication = setTimeout(() => channel.close(), 2000)
    type PersonSession = {
      channel: PersonChannel
      handle?: LifecycleWorkspace
      attaching: boolean
      lost: boolean
      failed: boolean
      ledgerV2?: boolean
      mutationSource?: string
      preparations: Map<string, PreparedPluginMutation & { expiresAt: number }>
      legacyIds?: readonly string[]
      detaching?: Promise<void>
    }

    const session: PersonSession = {
      channel,
      preparations: new Map(),
      attaching: false,
      lost: false,
      failed: false,
    }
    sessions.add(session)
    channels.add(channel)
    channel.onClose(() => {
      clearTimeout(authentication)
      session.lost = true
      void channel.settled().then(() => channels.delete(channel))
      // Unproved disconnect cleanup stays a lifecycle obligation, never a success acknowledgment.
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
  if (isSocketFile()) await chmod(path, 0o600)
  const held = isSocketFile() ? await lstat(path, { bigint: true }) : null
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
    async close(options: { endConsumers?: boolean } = {}): Promise<void> {
      closing = true
      // Ending the only person route also ends its consumer's authority when grace expires.
      if (options.endConsumers) endConsumers()
      await Promise.allSettled([...sessions].map(detach))
      for (const channel of channels) channel.close()
      await Promise.all([...channels].map((channel) => channel.settled()))
      // A detach refused over an open channel, or still running, is settled once all are closed.
      const result = await Promise.allSettled(
        [...sessions]
          .filter((session) => session.failed || session.detaching)
          .map((session) => detach(session)),
      )
      await new Promise<void>((resolve) => server.close(() => resolve()))
      const now = held && (await lstat(path, { bigint: true }).catch(() => null))
      if (held && now && now.dev === held.dev && now.ino === held.ino) await unlink(path)
      if (result.some((one) => one.status !== 'fulfilled'))
        throw new PluginSupervisorError('cleanup-pending')
    },
  }
}
export async function connectPersonPluginControl(options: {
  path: string
  key: string
  handle(input: unknown): Promise<unknown>
}): Promise<PersonChannel> {
  if (!Hex.safeParse(options.key).success) throw new PluginSupervisorError('unavailable')
  return new Promise((resolve, reject) => {
    const socket = createConnection(localEndpoint(options.path, 'person', options.key))
    let input = ''
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new PluginSupervisorError('unavailable'))
    }, 2000)
    const failed = () => {
      clearTimeout(timer)
      socket.destroy()
      reject(new PluginSupervisorError('unavailable'))
    }
    socket.once('error', failed)
    const hello = (bytes: Buffer) => {
      input += bytes.toString('utf8')
      if (input.length > 65 || !input.endsWith('\n')) {
        if (input.length > 65) failed()
        return
      }
      const challenge = input.trimEnd()
      if (!Hex.safeParse(challenge).success) return failed()
      socket.off('data', hello)
      socket.off('error', failed)
      clearTimeout(timer)
      resolve(new PersonChannel(socket, options.key, challenge, 'client', options.handle))
    }
    socket.on('data', hello)
  })
}
