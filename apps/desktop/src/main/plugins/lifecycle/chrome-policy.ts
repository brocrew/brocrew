import { z } from 'zod'
import type { PluginNodeReady } from '../node-host'
import type { BrokerServer, PluginExecution } from '../tool-broker'

const Profile = z.object({
  name: z.string(),
  enabled: z.boolean(),
  allowSettings: z.boolean().optional(),
  allowExtensions: z.boolean().optional(),
})
const Snapshot = z.object({
  profiles: z.array(Profile).max(128),
  tabs: z.array(z.object({ id: z.string(), profile: z.string() })).max(200),
})
export type ChromeAccessSnapshot = z.infer<typeof Snapshot>
/** All metadata streams settle before the resource check can release its broker slot. */
export async function chromeAccessSnapshot(
  connection: PluginNodeReady,
  signal: AbortSignal,
): Promise<ChromeAccessSnapshot> {
  const endpoint = connection.admin()
  const results = await Promise.allSettled(
    ['profiles', 'tabs'].map(async (path) => {
      const response = await fetch(endpoint.url + '/' + path, {
        headers: endpoint.headers,
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(1500)]),
      })
      if (!response.body) throw new Error('unavailable')
      const reader = response.body.getReader()
      const parts: Uint8Array[] = []
      let bytes = 0
      try {
        if (response.status !== 200) throw new Error('unavailable')
        for (;;) {
          const next = await reader.read()
          if (next.done) break
          bytes += next.value.byteLength
          if (bytes > 128 * 1024) throw new Error('unavailable')
          parts.push(next.value)
        }
        return JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown
      } finally {
        await reader.cancel().catch(() => undefined)
      }
    }),
  )
  if (results.some((one) => one.status !== 'fulfilled')) throw new Error('unavailable')
  const [profiles, tabs] = results.map((one) =>
    one.status === 'fulfilled' ? one.value : undefined,
  )
  return Snapshot.parse({
    profiles: z.object({ profiles: Snapshot.shape.profiles }).parse(profiles).profiles,
    tabs: z.object({ tabs: Snapshot.shape.tabs }).parse(tabs).tabs,
  })
}
const metadata = new Set([
  'list_browser_profiles',
  'create_browser_profile',
  'set_browser_profile_description',
  'delete_browser_profile',
  'list_tabs',
])
/** Recheck current profile choices at broker dispatch; Chrome also checks them in its own queue. */
export function withChromeResourcePolicy(
  port: BrokerServer,
  snapshot: (signal: AbortSignal) => Promise<ChromeAccessSnapshot>,
): BrokerServer {
  return {
    admin: (request, signal) => port.admin(request, signal),
    tool(request, signal) {
      const abort = new AbortController()
      const activeSignal = AbortSignal.any([signal, abort.signal])
      let execution: PluginExecution | undefined
      let settle!: () => void, fail!: () => void
      const quiescent = new Promise<void>((resolve, reject) => {
        settle = resolve
        fail = () => reject(new Error('unavailable'))
      })
      void quiescent.catch(() => undefined)
      const result = (async () => {
        try {
          if (!metadata.has(request.name)) {
            const value = await snapshot(activeSignal)
            const tabProfile = value.tabs.find((one) => one.id === request.input.tabId)?.profile
            if (
              request.input.tabId !== undefined &&
              (!tabProfile ||
                (request.input.profile !== undefined && request.input.profile !== tabProfile))
            ) {
              settle()
              return { ok: false as const }
            }
            const profile =
              typeof request.input.profile === 'string' ? request.input.profile : tabProfile
            const record = value.profiles.find((one) => one.name === profile)
            if (
              !record?.enabled ||
              (['get_settings', 'set_setting'].includes(request.name) && !record.allowSettings) ||
              (['install_extension', 'list_extensions', 'remove_extension'].includes(
                request.name,
              ) &&
                !record.allowExtensions)
            ) {
              settle()
              return { ok: false as const }
            }
          }
          if (activeSignal.aborted) {
            settle()
            return { ok: false as const }
          }
          execution = port.tool(request, activeSignal)
          void execution.quiescent.then(settle, fail)
          return await execution.result
        } catch {
          if (!execution) settle()
          return { ok: false as const }
        }
      })()
      return {
        result,
        quiescent,
        cancel() {
          abort.abort()
          void Promise.resolve(execution?.cancel()).catch(() => undefined)
        },
      }
    },
  }
}
