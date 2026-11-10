import type { PluginNodeReady } from '../node-host'
import { PluginSupervisorError } from '../supervisor/protocol'
import { ChromeProposal, applyChromeProfile } from './chrome-apply'
import { readChromeConfiguration } from './chrome-read'
import { proposalFor, type PluginProposal } from './proposals'
import { applyWhatsAppSettings } from './whatsapp-apply'
import { readWhatsAppConfiguration } from './whatsapp-read'

/** Package configuration adapters, until configuration forwarding replaces them. */
export interface PluginAdapter {
  read(connection: PluginNodeReady, signal: AbortSignal): Promise<unknown>
  apply(connection: PluginNodeReady, proposal: PluginProposal, signal: AbortSignal): Promise<void>
}
const adapters: Readonly<Record<string, PluginAdapter>> = Object.freeze({
  chrome: {
    read: (connection, signal) => readChromeConfiguration('chrome', connection, signal),
    apply: (connection, proposal, signal) =>
      applyChromeProfile(connection, ChromeProposal.parse(proposal), signal),
  },
  whatsapp: {
    read: (connection, signal) => readWhatsAppConfiguration(connection, signal),
    apply: (connection, proposal, signal) => applyWhatsAppSettings(connection, proposal, signal),
  },
})

/** The adapter for one plugin, or undefined when the app hosts no such plugin. */
export function pluginAdapter(pluginId: string): PluginAdapter | undefined {
  return Object.hasOwn(adapters, pluginId) && proposalFor(pluginId) ? adapters[pluginId] : undefined
}

/** Refuses a plugin the app hosts no adapter for, in the supervisor's own words. */
export function requirePluginAdapter(pluginId: string): PluginAdapter {
  const adapter = pluginAdapter(pluginId)
  if (!adapter) throw new PluginSupervisorError('unavailable')
  return adapter
}
