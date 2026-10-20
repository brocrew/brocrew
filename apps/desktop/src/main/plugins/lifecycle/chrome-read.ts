import { z } from 'zod'
import type { PluginNodeReady } from '../node-host'
import { PluginSupervisorError } from '../supervisor/protocol'
import { readAdminJson } from './admin-read'

const Profile = z.object({
  name: z.string().regex(/^[a-z0-9-]{1,32}$/),
  enabled: z.boolean(),
  open: z.boolean(),
})
const Tab = z.object({
  id: z.string().max(128),
  profile: z.string().regex(/^[a-z0-9-]{1,32}$/),
  title: z.string().max(512),
  url: z.string().max(2048),
})
/** Public read surface only. Endpoints and admin credentials never cross the person-control socket. */
export async function readChromeConfiguration(
  pluginId: string,
  connection: PluginNodeReady,
  signal = new AbortController().signal,
): Promise<unknown> {
  if (pluginId !== 'chrome') throw new PluginSupervisorError('unavailable')
  const endpoint = connection.admin()
  const [profiles, tabs] = await Promise.all([
    readAdminJson(endpoint.url + '/profiles', endpoint.headers, signal, 128 * 1024),
    readAdminJson(endpoint.url + '/tabs', endpoint.headers, signal, 128 * 1024),
  ])
  return {
    configRevision: 0,
    profiles: z.object({ profiles: z.array(Profile).max(128) }).parse(profiles).profiles,
    tabs: z.object({ tabs: z.array(Tab).max(200) }).parse(tabs).tabs,
  }
}
