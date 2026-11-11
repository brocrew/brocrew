export function mcpSessions<T extends { close(): Promise<void> }>() {
  const transports: Record<string, T> = {}
  const pendingRequests = new Map<string, number>()
  const closedSessions = new Set<string>()
  return {
    transports,
    closed(sid: string | undefined) {
      if (!sid) return
      if (pendingRequests.get(sid)) closedSessions.add(sid)
      else delete transports[sid]
    },
    async request(sid: string, handle: () => Promise<void>) {
      pendingRequests.set(sid, (pendingRequests.get(sid) ?? 0) + 1)
      try {
        await handle()
      } finally {
        const count = (pendingRequests.get(sid) ?? 1) - 1
        if (count <= 0) {
          pendingRequests.delete(sid)
          if (closedSessions.has(sid)) {
            closedSessions.delete(sid)
            delete transports[sid]
          }
        } else pendingRequests.set(sid, count)
      }
    },
    async close() {
      for (const sid of Object.keys(transports)) {
        try {
          await transports[sid].close()
          delete transports[sid]
        } catch {
          /* Continue without this optional result. */
        }
      }
    },
  }
}
