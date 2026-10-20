import type { CodexTransport } from './codex-transport'

export const MANAGED_PLUGIN_READY_WITHIN_MS = 10_000
export type ManagedPluginReadiness = 'ready' | 'unavailable' | 'timeout' | 'cancelled'

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** Observe this thread's connections; a failed plugin never makes the turn fail. */
export function waitForManagedPluginTools(
  transport: Pick<CodexTransport, 'request'>,
  threadId: string,
  names: readonly string[],
  signal: AbortSignal,
): Promise<ManagedPluginReadiness> {
  if (signal.aborted) return Promise.resolve('cancelled')
  if (names.length === 0) return Promise.resolve('ready')
  return new Promise((resolve) => {
    let settled = false
    const pauses = new Set<() => void>()
    const finish = (outcome: ManagedPluginReadiness): void => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      signal.removeEventListener('abort', cancelled)
      for (const wake of pauses) wake()
      resolve(outcome)
    }
    const cancelled = (): void => finish('cancelled')
    const deadline = setTimeout(() => finish('timeout'), MANAGED_PLUGIN_READY_WITHIN_MS)
    deadline.unref?.()
    signal.addEventListener('abort', cancelled, { once: true })
    const pause = (): Promise<void> =>
      new Promise((wake) => {
        const done = (): void => {
          clearTimeout(timer)
          pauses.delete(done)
          wake()
        }
        const timer = setTimeout(done, 50)
        timer.unref?.()
        pauses.add(done)
      })
    void Promise.all(
      names.map(async (name): Promise<boolean> => {
        try {
          while (!settled) {
            const response = await transport.request('mcpServerStatus/list', {
              threadId,
              serverName: name,
              detail: 'toolsAndAuthOnly',
            })
            if (settled) return false
            const rows = record(response) && Array.isArray(response.data) ? response.data : []
            const server: unknown = rows.find((one: unknown) => record(one) && one.name === name)
            if (!record(server)) return false
            if (server.runtimeStatus === 'connected')
              return server.toolsError === null && record(server.tools)
            if (server.runtimeStatus !== 'starting' && server.runtimeStatus !== 'notStarted')
              return false
            await pause()
          }
        } catch {
          // Provider error text can contain addresses or authentication details.
        }
        return false
      }),
    ).then((ready) => finish(ready.every(Boolean) ? 'ready' : 'unavailable'))
  })
}
