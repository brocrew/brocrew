import { attachmentTraceId, createRouteAdmissionTrace } from './route-admission-trace'
import { randomUUID, createHash } from 'node:crypto'
import { z } from 'zod'
import type { ManagedPluginAttachment, ManagedPluginAttachmentSource } from '@brobot2/runtime'
import type { PluginSupervisorAttachment } from './supervisor/client'

const Route = {
  name: z.string().max(64),
  url: z.string().max(256),
  capability: z.string().regex(/^[a-f0-9]{64}$/),
}
const PluginId = z.string().min(1).max(128)
/** An owner that did not negotiate a named reply: every route it serves, and nothing else. */
const Routes = z.array(z.strictObject(Route)).max(32)
/** The named reply: served routes by plugin, plugins still starting, plugins off. */
const NamedRoutes = z
  .strictObject({
    format: z.literal(2),
    servers: z.array(z.strictObject({ ...Route, pluginId: PluginId })).max(32),
    pending: z.array(PluginId),
    none: z.array(PluginId),
    unknown: z.boolean(),
  })
  // Each plugin is named at most once: served, starting or off, never two of them.
  .refine((reply) => {
    const ids = [...reply.servers.map((one) => one.pluginId), ...reply.pending, ...reply.none]
    return new Set(ids).size === ids.length
  })

/** Reads a reply in the format the lease that carried the request negotiated. */
function parsed(reply: {
  readonly format: 1 | 2
  readonly value: unknown
}): Omit<ManagedPluginAttachment, 'revision'> {
  if (reply.format === 1) return { servers: Routes.parse(reply.value) }
  const named = NamedRoutes.parse(reply.value)
  return {
    servers: named.servers,
    plugins: { pending: named.pending, none: named.none, unknown: named.unknown },
  }
}

/** One fresh source per runtime incarnation. The supervisor owns all broker and private authority. */
export class WorkspacePluginAttachments {
  constructor(
    private readonly owner: Pick<PluginSupervisorAttachment, 'agentRoutes'> & Partial<Pick<PluginSupervisorAttachment, 'recordTrace'>>,
    private readonly workspaceId: string,
  ) {}
  agent(occupied: readonly string[]): ManagedPluginAttachmentSource {
    const incarnation = randomUUID()
    const incarnationId = attachmentTraceId(incarnation, 'incarnation', '')
    const trace = createRouteAdmissionTrace((event) => this.owner.recordTrace?.(event))({ incarnation: incarnationId })
    const id = (kind: 'route' | 'server' | 'tool' | 'plugin', value: string) => attachmentTraceId(incarnation, kind, value)
    const input = { workspaceId: this.workspaceId, incarnation, occupied: [...occupied] }
    let closed = false
    return {
      observe: (event) => {
        const detail = {
          launch: event.launch,
          stage: event.stage,
          outcome: event.outcome,
          provider: event.provider === 'claude' || event.provider === 'codex' ? event.provider : undefined,
          failureStage: event.failureStage,
        } as const
        if (event.discovery) {
          const server = event.servers.find((one) => one.name === event.discovery!.server)
          if (server) trace.emit('launch-discovery', {
            ...detail,
            server: id('server', server.name),
            attachmentRoute: id('route', server.url),
            discoveredTools: event.discovery.tools.map((tool) => id('tool', tool)).sort(),
            discoveredCount: event.discovery.tools.length,
          })
        } else {
          trace.emit('launch-attachment', {
            ...detail,
            serverCount: event.servers.length,
            pending: event.pending?.map((plugin) => id('plugin', plugin)),
            off: event.off?.map((plugin) => id('plugin', plugin)),
            unknown: event.unknown,
          })
          for (const server of event.servers) trace.emit('launch-attachment', {
            ...detail, server: id('server', server.name), attachmentRoute: id('route', server.url),
          })
        }
      },
      read: async () => {
        if (closed) throw new Error('Plugin unavailable. Try again.')
        const attachment = parsed(await this.owner.agentRoutes(input))
        if (closed) throw new Error('Plugin unavailable. Try again.')
        return {
          revision: createHash('sha256').update(JSON.stringify(attachment)).digest('hex'),
          ...attachment,
        }
      },
      close: async () => {
        if (!closed) {
          closed = true
          await this.owner.agentRoutes({ ...input, release: true })
        }
      },
    }
  }
}
