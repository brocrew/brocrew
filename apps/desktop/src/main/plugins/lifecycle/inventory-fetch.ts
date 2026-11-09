// Local inventory is static, but a loaded host can answer slowly. Only 30 seconds without
// response headers or another byte is a stall; receiving bytes restarts the clock.
const INVENTORY_STALE_MS = 30_000

export function inventoryFetch(host: AbortSignal): typeof fetch {
  return async (url, init) => {
    const abort = new AbortController()
    const signal = AbortSignal.any([host, abort.signal, ...(init?.signal ? [init.signal] : [])])
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = () => clearTimeout(timer)
    const progress = () => {
      stop()
      timer = setTimeout(() => {
        abort.abort(Object.assign(new Error('Plugin inventory stalled'), { code: 'stalled' }))
      }, INVENTORY_STALE_MS)
      timer.unref?.()
    }
    signal.addEventListener('abort', stop, { once: true })
    const finish = () => {
      stop()
      signal.removeEventListener('abort', stop)
    }
    progress()
    try {
      signal.throwIfAborted()
      const response = await fetch(url, { ...init, redirect: 'error', signal })
      signal.throwIfAborted()
      if (!response.body) {
        finish()
        return response
      }
      progress()
      const reader = response.body.getReader()
      return new Response(
        new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const next = await reader.read()
              signal.throwIfAborted()
              if (next.done) {
                finish()
                controller.close()
              } else {
                if (next.value.byteLength) progress()
                controller.enqueue(next.value)
              }
            } catch (error) {
              finish()
              controller.error(signal.aborted ? signal.reason : error)
            }
          },
          async cancel() {
            finish()
            await reader.cancel()
          },
        }),
        { status: response.status, statusText: response.statusText, headers: response.headers },
      )
    } catch (error) {
      finish()
      throw signal.aborted ? signal.reason : error
    }
  }
}
