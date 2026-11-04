import type { PluginToolDiagnostic } from '../tool-diagnostics'
import type { PluginRemovalOutcome } from '../../../shared/plugin-settings'
import type { PluginNodeReady } from '../node-host'
import { PluginSupervisorError } from '../supervisor/protocol'
import { ChromeProposal, applyChromeProfile } from './chrome-apply'
import { chromeBrokerBinding } from './chrome-broker'
import { readChromeConfiguration } from './chrome-read'
import type { PluginLifecycleController } from './controller'
import { proposalFor, type PluginProposal } from './proposals'
import { applyWhatsAppSettings, logOutBeforeUninstall } from './whatsapp-apply'
import { whatsappBrokerBinding } from './whatsapp-broker'
import { readWhatsAppConfiguration } from './whatsapp-read'

type AgentView = ReturnType<PluginLifecycleController['agentAttachments']>[number]
type Binding = ReturnType<typeof chromeBrokerBinding>

/** One reviewed adapter per hosted plugin: its page's read and apply, and its tools' binding. */
export interface PluginAdapter {
  read(connection: PluginNodeReady, signal: AbortSignal): Promise<unknown>
  apply(connection: PluginNodeReady, proposal: PluginProposal, signal: AbortSignal): Promise<void>
  broker(
    view: AgentView,
    refused: () => void | Promise<void>,
    diagnostic?: PluginToolDiagnostic,
  ): Binding
  /**
   * The plugin's own clean-up while it still runs, before it is uninstalled. A plugin that has one also has
   * its private data folder deleted with it.
   */
  uninstall?(
    connection: PluginNodeReady,
    signal: AbortSignal,
  ): Promise<PluginRemovalOutcome['logout']>
}
const adapters: Readonly<Record<string, PluginAdapter>> = Object.freeze({
  chrome: {
    read: (connection, signal) => readChromeConfiguration('chrome', connection, signal),
    apply: (connection, proposal, signal) =>
      applyChromeProfile(connection, ChromeProposal.parse(proposal), signal),
    broker: (view, refused, diagnostic) => chromeBrokerBinding(view, refused, diagnostic),
  },
  whatsapp: {
    read: (connection, signal) => readWhatsAppConfiguration(connection, signal),
    apply: (connection, proposal, signal) => applyWhatsAppSettings(connection, proposal, signal),
    broker: (view, refused, diagnostic) => whatsappBrokerBinding(view, refused, diagnostic),
    uninstall: (connection, signal) => logOutBeforeUninstall(connection, signal),
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
