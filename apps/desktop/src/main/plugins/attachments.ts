import { randomUUID, createHash } from 'node:crypto'
import { z } from 'zod'
import type { ManagedPluginAttachmentSource } from '@brobot2/runtime'
import type { PluginSupervisorAttachment } from './supervisor/client'

const Routes = z
  .array(
    z.strictObject({
      name: z.string().max(64),
      url: z.string().max(256),
      capability: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  )
  .max(32)
/** One fresh source per runtime incarnation. The supervisor owns all broker and private authority. */
export class WorkspacePluginAttachments {
  constructor(
    private readonly owner: Pick<PluginSupervisorAttachment, 'agentRoutes'>,
    private readonly workspaceId: string,
  ) {}
  agent(occupied: readonly string[]): ManagedPluginAttachmentSource {
    const incarnation = randomUUID()
    const input = { workspaceId: this.workspaceId, incarnation, occupied: [...occupied] }
    let closed = false
    return {
      read: async () => {
        if (closed) throw new Error('Plugin unavailable. Try again.')
        const servers = Routes.parse(await this.owner.agentRoutes(input))
        if (closed) throw new Error('Plugin unavailable. Try again.')
        return {
          revision: createHash('sha256').update(JSON.stringify(servers)).digest('hex'),
          servers,
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
