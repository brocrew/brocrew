import { ipcRenderer } from 'electron'
import { PLUGIN_PAGE_CHANNEL } from '../shared/plugin-page'
import { exact, plain, PLUGIN_UI_RPC, PLUGIN_UI_UNAVAILABLE } from '../shared/plugin-ui'

// This preload is typechecked with the Node main project; name only the DOM subset it uses.
declare const window: {
  readonly location: { readonly origin: string; readonly protocol: string }
  readonly top: unknown
  addEventListener(
    type: 'message',
    listener: (event: { source: unknown; origin: string; data: unknown }) => void,
  ): void
  postMessage(data: unknown, origin: string): void
}

// Fixed host preload only: no contextBridge, global property, Electron event, or channel selector.
const generation = process.argv
  .find((arg) => arg.startsWith('--brocrew-plugin-generation='))
  ?.split('=')[1]
const origin = window.location.origin
if (
  process.isMainFrame &&
  window.top === window &&
  /^[a-f0-9-]{36}$/.test(generation ?? '') &&
  window.location.protocol === 'brocrew-plugin:'
) {
  const pending = new Set<string>()
  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.origin !== origin) return
    const data = event.data
    const generic =
      plain(data) &&
      exact(data, ['channel', 'requestId', 'method', 'params']) &&
      data.channel === PLUGIN_PAGE_CHANNEL &&
      data.method === 'callTool' &&
      typeof data.requestId === 'string' &&
      plain(data.params) &&
      exact(data.params, ['tool', 'arguments']) &&
      typeof data.params.tool === 'string' &&
      plain(data.params.arguments)
    if (!generic) return
    const packet = data as { requestId: string; channel: string }
    if (pending.has(packet.requestId)) return
    pending.add(packet.requestId)
    try {
      const result: unknown = await ipcRenderer.invoke(PLUGIN_UI_RPC, { generation, packet })
      if (!plain(result) || !(exact(result, ['ok', 'data']) || exact(result, ['ok', 'error'])))
        return
      window.postMessage(
        { channel: packet.channel, requestId: packet.requestId, ...result },
        origin,
      )
    } catch {
      window.postMessage(
        {
          channel: packet.channel,
          requestId: packet.requestId,
          ok: false,
          error: PLUGIN_UI_UNAVAILABLE,
        },
        origin,
      )
    } finally {
      pending.delete(packet.requestId)
    }
  })
}
