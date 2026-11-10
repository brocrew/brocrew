import { z } from 'zod'
import type { PluginNodeReady } from '../../../src/main/plugins/node-host'
import { PluginSupervisorError } from '../../../src/main/plugins/supervisor/protocol'
import { readAdminJson } from '../../../src/main/plugins/lifecycle/admin-read'

const Profile = z.object({
  name: z.string().regex(/^[a-z0-9-]{1,32}$/),
  displayName: z.string().max(120).optional(),
  enabled: z.boolean(),
  open: z.boolean(),
  /** The person turned the BroCrew helper off; earlier plugin versions leave it out. */
  helperOff: z.boolean().optional(),
  shared: z.boolean().optional(),
  profileId: z.uuid().optional(),
  globalRevision: z.number().int().nonnegative().safe().optional(),
  onIn: z.array(z.string().max(320)).max(256).optional(),
  inUseIn: z.string().max(320).optional(),
  status: z.enum(['ready', 'moving', 'deleting']).optional(),
  migratedFrom: z.string().max(128).optional(),
  appliesAtNextLaunch: z.boolean().optional(),
  deleteConfirmation: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  migration: z.string().max(160).optional(),
  allowSync: z.boolean().optional(),
  allowExtensions: z.boolean().optional(),
  allowSettings: z.boolean().optional(),
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
