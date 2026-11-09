import type { CodexTransport } from './codex-transport'
import { observeManagedPlugins, type ManagedPluginObserver } from '../managed-plugin-observation'

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
  observer?: ManagedPluginObserver,
): Promise<ManagedPluginReadiness> {
  if (signal.aborted) return Promise.resolve('cancelled')
  if (names.length === 0) return Promise.resolve('ready')
  return new Promise((resolve) => {
    let settled = false
    const observed = new Set<string>()
    const observe: ManagedPluginObserver = (event) => {
      if (observed.has(event.server)) return
      observed.add(event.server)
      observeManagedPlugins(observer, event)
    }
    const pauses = new Set<() => void>()
    const finish = (outcome: ManagedPluginReadiness): void => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      signal.removeEventListener('abort', cancelled)
      for (const wake of pauses) wake()
      for (const name of names)
        if (!observed.has(name))
          observe({
            server: name,
            tools: [],
            outcome: outcome === 'timeout' || outcome === 'cancelled' ? outcome : 'unavailable',
          })
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
            if (!record(server)) {
              observe({ server: name, tools: [], outcome: 'unavailable' })
              return false
            }
            if (server.runtimeStatus === 'connected') {
              const ready = server.toolsError === null && record(server.tools)
              try {
                observe({
                  server: name,
                  tools: ready ? Object.keys(server.tools as Record<string, unknown>) : [],
                  outcome: ready ? 'discovered' : 'unavailable',
                })
              } catch {
                /* Inventory observation cannot change the existing readiness result. */
              }
              return ready
            }
            if (server.runtimeStatus !== 'starting' && server.runtimeStatus !== 'notStarted') {
              observe({ server: name, tools: [], outcome: 'unavailable' })
              return false
            }
            await pause()
          }
        } catch {
          // Provider error text can contain addresses or authentication details.
          observe({ server: name, tools: [], outcome: 'unavailable' })
        }
        return false
      }),
    ).then((ready) => finish(ready.every(Boolean) ? 'ready' : 'unavailable'))
  })
}

/** A fresh thread-scoped read, separate from the first-turn discovery deadline. */
export async function failedManagedPluginConnections(
  transport: Pick<CodexTransport, 'request'>,
  threadId: string,
  names: readonly string[],
): Promise<readonly string[] | undefined> {
  const failed: string[] = []
  let unknown = false
  for (const name of names) {
    try {
      const response = await transport.request('mcpServerStatus/list', {
        threadId,
        serverName: name,
        detail: 'toolsAndAuthOnly',
      })
      const rows = record(response) && Array.isArray(response.data) ? response.data : []
      const row: unknown = rows.find((one: unknown) => record(one) && one.name === name)
      if (record(row) && row.runtimeStatus === 'failed') failed.push(name)
      else if (
        !record(row) ||
        row.runtimeStatus !== 'connected' ||
        row.toolsError !== null ||
        !record(row.tools)
      )
        unknown = true
    } catch {
      unknown = true
    }
  }
  return failed.length || !unknown ? failed : undefined
}
