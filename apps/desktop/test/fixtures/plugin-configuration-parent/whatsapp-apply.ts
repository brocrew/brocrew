import { z } from 'zod'
import type { PluginNodeReady } from '../../../src/main/plugins/node-host'
import { PluginSupervisorError } from '../../../src/main/plugins/supervisor/protocol'

export const WHATSAPP_GROUP = z.string().regex(/^[0-9]{5,40}(?:-[0-9]{1,20})?@g\.us$/)
export const WhatsAppProposal = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('link-phone') }),
  z.strictObject({ action: z.literal('unlink-phone') }),
  z.strictObject({ action: z.literal('refresh-groups') }),
  z.strictObject({ action: z.literal('set-read'), enabled: z.boolean() }),
  z.strictObject({ action: z.literal('set-prefix'), enabled: z.boolean() }),
  z.strictObject({
    action: z.literal('set-group-write'),
    group: WHATSAPP_GROUP,
    enabled: z.boolean(),
  }),
])
export type WhatsAppProposal = z.infer<typeof WhatsAppProposal>
/** Fixed reviewed admin adapter. Neither routes, credentials nor arbitrary JSON come from the page. */
export async function applyWhatsAppSettings(
  connection: PluginNodeReady,
  input: unknown,
  signal: AbortSignal,
): Promise<void> {
  const proposal = WhatsAppProposal.parse(input)
  const admin = connection.admin()
  const [path, body, expected]: [string, unknown, number] =
    proposal.action === 'link-phone'
      ? ['/link', {}, 200]
      : proposal.action === 'unlink-phone'
        ? ['/unlink', {}, 202]
        : proposal.action === 'refresh-groups'
          ? ['/refresh-groups', {}, 200]
          : proposal.action === 'set-read'
            ? ['/read', { enabled: proposal.enabled }, 200]
            : proposal.action === 'set-prefix'
              ? ['/prefix', { enabled: proposal.enabled }, 200]
              : ['/group-write', { group: proposal.group, enabled: proposal.enabled }, 200]
  const abort = new AbortController()
  try {
    const response = await fetch(admin.url + path, {
      method: 'POST',
      redirect: 'error',
      headers: { ...admin.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, abort.signal, AbortSignal.timeout(5000)]),
    })
    if (response.status !== expected) throw new PluginSupervisorError('unavailable')
    // No returned admin bytes are page data. Cancel before releasing the request slot.
    void response.body?.cancel().catch(() => undefined)
  } catch {
    throw new PluginSupervisorError('unavailable')
  } finally {
    abort.abort()
  }
}
