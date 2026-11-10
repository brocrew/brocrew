import type { PluginNodeReady } from '../../../src/main/plugins/node-host'
import { ChromeProposal, applyChromeProfile } from './chrome-apply'
import { readChromeConfiguration } from './chrome-read'
import { proposalFor, type PluginProposal } from './proposals'
import { applyWhatsAppSettings } from './whatsapp-apply'
import { logOutBeforeUninstall } from '../plugin-delete-parent/whatsapp-apply'
import { readWhatsAppConfiguration } from './whatsapp-read'

/** Package configuration adapters, until configuration forwarding replaces them. */
export interface PluginAdapter {
  read(connection: PluginNodeReady, signal: AbortSignal): Promise<unknown>
  apply(connection: PluginNodeReady, proposal: PluginProposal, signal: AbortSignal): Promise<void>
  uninstall?(connection: PluginNodeReady, signal: AbortSignal): Promise<'confirmed' | 'unconfirmed'>
}
const adapters: Readonly<Record<string, PluginAdapter>> = Object.freeze({
  chrome: {
    read: (connection, signal) => readChromeConfiguration('chrome', connection, signal),
    apply: (connection, proposal, signal) =>
      applyChromeProfile(connection, ChromeProposal.parse(proposal), signal),
  },
  whatsapp: {
    read: (connection, signal) => readWhatsAppConfiguration(connection, signal),
    uninstall: logOutBeforeUninstall,
    apply: (connection, proposal, signal) => applyWhatsAppSettings(connection, proposal, signal),
  },
})

/** The adapter for one plugin, or undefined when the app hosts no such plugin. */
export function pluginAdapter(pluginId: string): PluginAdapter | undefined {
  return Object.hasOwn(adapters, pluginId) && proposalFor(pluginId) ? adapters[pluginId] : undefined
}
