import { z } from 'zod'
import type { PluginNodeReady } from '../node-host'
import { readAdminJson } from './admin-read'
import { WHATSAPP_GROUP } from './whatsapp-apply'

const Status = z.object({
  state: z.enum(['starting', 'unlinked', 'pairing', 'connecting', 'linked', 'unavailable']),
  expired: z.boolean(),
  account: z.string().max(120),
  qr: z
    .object({
      size: z.number().int().min(21).max(177),
      bits: z
        .string()
        .max(177 * 177)
        .regex(/^[01]+$/),
      expiresAt: z.number().int(),
    })
    .nullable(),
  removeOnPhone: z.boolean().optional(),
})
const Settings = z.object({
  read: z.boolean(),
  prefix: z.boolean(),
  groups: z
    .array(
      z.object({
        jid: WHATSAPP_GROUP,
        name: z.string().max(120),
        canWrite: z.boolean(),
      }),
    )
    .max(1024),
})
/** The settings page's view: the link state with its QR pattern, and the person's switches. No message crosses. */
export async function readWhatsAppConfiguration(
  connection: PluginNodeReady,
  signal = new AbortController().signal,
): Promise<unknown> {
  const endpoint = connection.admin()
  const [status, settings] = await Promise.all([
    readAdminJson(endpoint.url + '/status', endpoint.headers, signal, 128 * 1024),
    readAdminJson(endpoint.url + '/settings', endpoint.headers, signal, 512 * 1024),
  ])
  return {
    configRevision: 0,
    status: Status.parse(status),
    ...Settings.parse(settings),
  }
}
