export const PLUGIN_UI_CHANNEL = 'brocrew-plugin-ui:v1'
export const PLUGIN_UI_RPC = 'plugin-ui:rpc'
export const PLUGIN_UI_EVENT = 'plugin-ui:snapshot'
export const PLUGIN_UI_METHODS = ['read', 'subscribe', 'unsubscribe', 'proposeConfig'] as const
export type PluginUiMethod = (typeof PLUGIN_UI_METHODS)[number]
export interface PluginUiPacket {
  channel: typeof PLUGIN_UI_CHANNEL
  requestId: string
  method: PluginUiMethod
  payload: unknown
  configRevision: number
}
export const PLUGIN_UI_LIMITS = {
  request: 64 * 1024,
  reply: 1024 * 1024,
  pending: 4,
  subscriptions: 2,
  timeout: 10_000,
} as const
export const PLUGIN_UI_UNAVAILABLE = 'Plugin unavailable. Try again.'
export const PLUGIN_UI_BUSY = 'Plugin busy. Try again.'
export function plain(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  )
}
export function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}
export function boundedJson(value: unknown, maximum: number): string | null {
  let nodes = 0,
    remaining = maximum
  const charge = (bytes: number) => (remaining -= bytes) >= 0
  const scalar = (item: string | number | boolean | null) =>
    charge(new TextEncoder().encode(JSON.stringify(item)).byteLength)
  const seen = new Set<unknown>()
  function safe(item: unknown, depth: number): boolean {
    if (++nodes > 20_000 || depth > 32) return false
    if (item === null || typeof item === 'boolean') return scalar(item)
    if (typeof item === 'number') return Number.isFinite(item) && scalar(item)
    if (typeof item === 'string') return item.length <= maximum && scalar(item)
    if (typeof item !== 'object' || seen.has(item)) return false
    seen.add(item)
    const valid = Array.isArray(item)
      ? item.length <= 4096 &&
        Object.keys(item).length === item.length &&
        charge(2 + Math.max(0, item.length - 1)) &&
        item.every((child) => safe(child, depth + 1))
      : plain(item) &&
        Object.keys(item).length <= 1024 &&
        charge(2 + Math.max(0, Object.keys(item).length - 1)) &&
        Object.entries(item).every(
          ([key, child]) =>
            key.length <= 1024 && scalar(key) && charge(1) && safe(child, depth + 1),
        )
    seen.delete(item)
    return valid
  }
  try {
    if (!safe(value, 0)) return null
    const json = JSON.stringify(value)
    return new TextEncoder().encode(json).byteLength <= maximum ? json : null
  } catch {
    return null
  }
}
export function pluginUiPacket(value: unknown): value is PluginUiPacket {
  return (
    plain(value) &&
    exact(value, ['channel', 'requestId', 'method', 'payload', 'configRevision']) &&
    value.channel === PLUGIN_UI_CHANNEL &&
    typeof value.requestId === 'string' &&
    /^[A-Za-z0-9_-]{1,64}$/.test(value.requestId) &&
    PLUGIN_UI_METHODS.some((method) => method === value.method) &&
    Number.isSafeInteger(value.configRevision) &&
    Number(value.configRevision) >= 0 &&
    boundedJson(value, PLUGIN_UI_LIMITS.request) !== null
  )
}
