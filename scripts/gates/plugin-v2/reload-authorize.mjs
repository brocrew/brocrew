export function authorizeReloadRequest(event, window, payload, nonce) {
  const fail = () => {
    throw new Error('plugin-reload-main-app-gate-only')
  }
  if (
    !window ||
    window.isDestroyed() ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  )
    fail()
  if (
    !payload ||
    typeof payload !== 'object' ||
    Object.keys(payload).sort().join(',') !== 'op,token'
  )
    fail()
  if (typeof nonce !== 'string' || !/^[a-f0-9]{64}$/.test(nonce) || payload.token !== nonce) fail()
  if (
    typeof payload.op !== 'string' ||
    !['arm', 'status', 'releaseReload', 'releaseRetirement', 'receipt'].includes(payload.op)
  )
    fail()
  return { op: payload.op }
}
