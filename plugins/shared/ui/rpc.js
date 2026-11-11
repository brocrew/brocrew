window.createPluginUiRpc = (getRevision, isClosed) => {
  const channel = 'brocrew-plugin-ui:v1'
  const pending = new Map()
  let next = 0
  function rpc(method, payload) {
    if (pending.size >= 4 || isClosed()) return Promise.reject(new Error('busy'))
    const requestId = String(++next)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId)
        reject(new Error('timeout'))
      }, 10000)
      pending.set(requestId, { resolve, reject, timer })
      window.postMessage(
        { channel, requestId, method, payload, configRevision: getRevision() },
        location.origin,
      )
    })
  }
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return
    const packet = event.data
    if (!packet || packet.channel !== channel || typeof packet.ok !== 'boolean') return
    const request = pending.get(packet.requestId)
    if (!request) return
    clearTimeout(request.timer)
    pending.delete(packet.requestId)
    if (!packet.ok) request.reject(new Error('unavailable'))
    else request.resolve(packet.data)
  })
  return { rpc, pending }
}
