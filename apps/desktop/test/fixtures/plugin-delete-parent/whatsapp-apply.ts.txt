import { z } from 'zod'
import type { PluginRemovalOutcome } from '../../../src/shared/plugin-settings'
import { readAdminJson } from '../../../src/main/plugins/lifecycle/admin-read'
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

/** How long uninstalling waits for the plugin's log out; the plugin gives up after 40 seconds. */
export const WHATSAPP_UNINSTALL_MS = 45_000
/** Wait for the local wipe, then read whether WhatsApp confirmed removing the device. */
export async function logOutBeforeUninstall(
  connection: PluginNodeReady,
  signal: AbortSignal,
): Promise<PluginRemovalOutcome['logout']> {
  const admin = connection.admin()
  const Status = z.object({ state: z.string(), removeOnPhone: z.boolean().optional() })
  // A repeated logout with no session cannot confirm removal of an older linked device.
  const before = await readAdminJson(admin.url + '/status', admin.headers, signal, 128 * 1024)
    .then((value) => Status.parse(value))
    .catch(() => null)
  const response = await fetch(admin.url + '/uninstall', {
    method: 'POST',
    redirect: 'error',
    headers: { ...admin.headers, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.any([signal, AbortSignal.timeout(WHATSAPP_UNINSTALL_MS)]),
  })
  void response.body?.cancel().catch(() => undefined)
  if (response.status !== 200) throw new PluginSupervisorError('unavailable')
  const status = Status.parse(
    await readAdminJson(admin.url + '/status', admin.headers, signal, 128 * 1024),
  )
  return before?.state === 'linked' &&
    before.removeOnPhone === false &&
    status.state === 'unlinked' &&
    status.removeOnPhone === false
    ? 'confirmed'
    : 'unconfirmed'
}
