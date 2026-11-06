import type { ManagedPluginMcpServer } from '../managed-plugin-mcp'

/** The existing provider discovery budget, separate from the 1500 ms attachment read. */
export const CLAUDE_MANAGED_PLUGIN_READY_WITHIN_MS = 10_000
type Outcome = 'ready' | 'unavailable' | 'timeout' | 'cancelled'
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** One SDK status request at a time. No observation survives this turn's cancellation. */
export function waitForClaudeManagedPlugins(
  status: () => Promise<unknown>,
  servers: readonly ManagedPluginMcpServer[],
  signal: AbortSignal,
): Promise<Outcome> {
  if (signal.aborted) return Promise.resolve('cancelled')
  if (!servers.length) return Promise.resolve('ready')
  return new Promise((resolve) => {
    let settled = false
    let pause: ReturnType<typeof setTimeout> | undefined
    const finish = (result: Outcome): void => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      clearTimeout(pause)
      signal.removeEventListener('abort', cancel)
      resolve(result)
    }
    const cancel = (): void => finish('cancelled')
    const deadline = setTimeout(() => finish('timeout'), CLAUDE_MANAGED_PLUGIN_READY_WITHIN_MS)
    deadline.unref?.()
    signal.addEventListener('abort', cancel, { once: true })
    const observe = async (): Promise<void> => {
      try {
        const rows = await status()
        if (settled) return
        if (!Array.isArray(rows)) return finish('unavailable')
        let ready = true
        for (const server of servers) {
          const matches = rows.filter((row) => record(row) && row.name === server.name)
          if (matches.length > 1) return finish('unavailable')
          const row: unknown = matches[0]
          if (!record(row) || row.status === 'pending') {
            ready = false
            continue
          }
          if (row.status !== 'connected') return finish('unavailable')
          if (record(row.config) && 'url' in row.config && row.config.url !== server.url)
            return finish('unavailable')
          if (!Array.isArray(row.tools)) {
            ready = false
            continue
          }
          if (row.tools.some((tool) => !record(tool) || typeof tool.name !== 'string'))
            return finish('unavailable')
        }
        if (ready) return finish('ready')
        pause = setTimeout(() => void observe(), 50)
        pause.unref?.()
      } catch {
        // SDK errors can include addresses and credentials. Report only the known stage/outcome.
        finish('unavailable')
      }
    }
    void observe()
  })
}
