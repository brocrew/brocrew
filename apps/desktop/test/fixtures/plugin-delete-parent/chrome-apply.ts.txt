import { z } from 'zod'
import type { PluginNodeReady } from '../../../src/main/plugins/node-host'
import { PluginSupervisorError } from '../../../src/main/plugins/supervisor/protocol'

const profile = z.string().regex(/^[a-z0-9-]{1,32}$/)
export const ChromeProposal = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('create-profile'), profile }),
  z.strictObject({ action: z.literal('set-enabled'), profile, enabled: z.boolean() }),
  z.strictObject({ action: z.literal('open-window'), profile }),
])
export type ChromeProposal = z.infer<typeof ChromeProposal>
/** Fixed reviewed admin adapter. Neither routes, credentials nor arbitrary JSON come from the page. */
export async function applyChromeProfile(
  connection: PluginNodeReady,
  input: ChromeProposal,
  signal: AbortSignal,
): Promise<void> {
  const proposal = ChromeProposal.parse(input)
  const admin = connection.admin()
  let path: string, body: unknown
  switch (proposal.action) {
    case 'create-profile':
      path = '/profiles'
      body = { name: proposal.profile }
      break
    case 'set-enabled':
      path = '/profiles/' + proposal.profile + '/flags'
      body = { enabled: proposal.enabled }
      break
    case 'open-window':
      path = '/profiles/' + proposal.profile + '/open'
      body = {}
      break
  }
  const abort = new AbortController()
  try {
    const response = await fetch(admin.url + path, {
      method: 'POST',
      redirect: 'error',
      headers: { ...admin.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, abort.signal, AbortSignal.timeout(5000)]),
    })
    const expected =
      proposal.action === 'create-profile' ? 201 : proposal.action === 'open-window' ? 202 : 200
    if (response.status !== expected) throw new PluginSupervisorError('unavailable')
    // No returned admin bytes are page data. Cancel before releasing the request slot.
    void response.body?.cancel().catch(() => undefined)
  } catch {
    throw new PluginSupervisorError('unavailable')
  } finally {
    abort.abort()
  }
}
