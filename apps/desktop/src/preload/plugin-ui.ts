import { ipcRenderer } from 'electron'
import {
  boundedJson,
  exact,
  plain,
  pluginUiPacket,
  PLUGIN_UI_CHANNEL,
  PLUGIN_UI_EVENT,
  PLUGIN_UI_LIMITS,
  PLUGIN_UI_RPC,
  PLUGIN_UI_UNAVAILABLE,
} from '../shared/plugin-ui'

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
    if (event.source !== window || event.origin !== origin || !pluginUiPacket(event.data)) return
    const packet = event.data
    if (pending.has(packet.requestId) || pending.size >= PLUGIN_UI_LIMITS.pending) return
    pending.add(packet.requestId)
    try {
      const result: unknown = await ipcRenderer.invoke(PLUGIN_UI_RPC, { generation, packet })
      if (
        !plain(result) ||
        !(exact(result, ['ok', 'data']) || exact(result, ['ok', 'error'])) ||
        boundedJson(result, PLUGIN_UI_LIMITS.reply + 1024) === null
      )
        return
      window.postMessage(
        { channel: PLUGIN_UI_CHANNEL, requestId: packet.requestId, ...result },
        origin,
      )
    } catch {
      window.postMessage(
        {
          channel: PLUGIN_UI_CHANNEL,
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
  ipcRenderer.on(PLUGIN_UI_EVENT, (_event, version: unknown, snapshot: unknown) => {
    if (version !== generation || boundedJson(snapshot, PLUGIN_UI_LIMITS.reply + 1024) === null)
      return
    window.postMessage({ channel: PLUGIN_UI_CHANNEL, snapshot }, origin)
  })
}
