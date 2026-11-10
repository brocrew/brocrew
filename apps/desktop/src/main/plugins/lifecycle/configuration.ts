import type { PluginNodeReady } from '../node-host'
import { readAdminJson } from './admin-read'

export function readPluginConfiguration(connection: PluginNodeReady, signal: AbortSignal) {
  const admin = connection.admin()
  return readAdminJson(admin.url + '/configuration', admin.headers, signal, 512 * 1024)
}
export async function applyPluginConfiguration(
  connection: PluginNodeReady,
  payload: unknown,
  configRevision: number,
  signal: AbortSignal,
): Promise<void> {
  const admin = connection.admin()
  const response = await fetch(admin.url + '/configuration', {
    method: 'POST',
    redirect: 'error',
    headers: { ...admin.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload, configRevision }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
  })
  const reply = await response.json()
  if (!response.ok)
    throw new Error(reply.error ?? `Plugin configuration failed (${response.status}).`)
  if (reply.applied !== true) throw new Error('Plugin configuration was not applied.')
}
