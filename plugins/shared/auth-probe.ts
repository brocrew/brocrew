export async function probeAuth(
  port: number,
  host: string,
  routes: readonly (readonly [string, string])[],
  unavailable: () => Error,
): Promise<void> {
  for (const [method, path] of routes) {
    let status: number
    try {
      const res = await fetch(`http://${host}:${port}${path}`, {
        method,
        ...(method === 'POST'
          ? { headers: { 'content-type': 'application/json' }, body: '{}' }
          : {}),
        redirect: 'manual',
        // Before readiness there is no request or lifecycle signal for a listener that accepts
        // these self-checks without replying. Bound that startup failure and close the listener.
        signal: AbortSignal.timeout(5000),
      })
      status = res.status
      await res.body?.cancel()
    } catch {
      status = 0
    }
    if (status !== 401) throw unavailable()
  }
}

export const closeOnAuthFailure =
  (server: { close(): Promise<void> }) =>
  async (e: unknown): Promise<never> => {
    await server.close().catch(() => undefined)
    throw e
  }
