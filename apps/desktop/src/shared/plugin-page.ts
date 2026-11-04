export const PLUGIN_PAGE_CHANNEL = 'brocrew-plugin-tools:v1'
export interface PluginPageCall {
  channel: typeof PLUGIN_PAGE_CHANNEL
  requestId: string
  method: 'callTool'
  params: { tool: string; arguments: import('./plugin-contract').PluginJsonObject }
}
