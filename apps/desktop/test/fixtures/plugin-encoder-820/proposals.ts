import { z } from 'zod'
import { ChromeProposal } from './chrome-apply'
import { WhatsAppProposal } from './whatsapp-apply'

/** What any hosted plugin's page may propose. Actions are distinct across plugins. */
export const PluginProposal = z.union([ChromeProposal, WhatsAppProposal])
export type PluginProposal = z.infer<typeof PluginProposal>
/** What each hosted plugin's page may propose. */
export const pluginProposals: Readonly<Record<string, z.ZodType<PluginProposal>>> = Object.freeze({
  chrome: ChromeProposal,
  whatsapp: WhatsAppProposal,
})

/** The reviewed proposal schema for one plugin, or undefined when the app hosts no such plugin. */
export function proposalFor(pluginId: string): z.ZodType<PluginProposal> | undefined {
  return Object.hasOwn(pluginProposals, pluginId) ? pluginProposals[pluginId] : undefined
}
