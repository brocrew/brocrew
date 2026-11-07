/** The reload gate's own command from its own window: only a known operation runs. */
export function authorizeReloadRequest(payload) {
  const op = payload && typeof payload === 'object' ? payload.op : undefined
  if (!['arm', 'status', 'releaseReload', 'releaseRetirement', 'receipt'].includes(op))
    throw new Error(`plugin-reload-main-app-gate-only: unknown operation ${JSON.stringify(op)}`)
  return { op }
}
