import type { PluginToolDiagnostic } from '../tool-diagnostics'
import type { BrokerInput } from '../tool-broker'
import { createPrivatePluginPort } from '../managed-transport'
import { logWarn } from '../../logging/log'
import { admittedPluginTools } from './broker-inventory'
import type { AgentAttachmentView, PluginBrokerBinding } from './contracts'

const refusalMessage = 'Some plugin tools were refused.'
export function pluginToolRefusalLog(): () => void {
  let recorded = false
  return () => {
    if (recorded) return
    recorded = true
    logWarn('plugin', refusalMessage)
  }
}
export async function pluginBrokerBinding(
  view: AgentAttachmentView,
  diagnostic?: PluginToolDiagnostic,
): Promise<PluginBrokerBinding> {
  if (!view.package.compatibility.tools) throw new Error('unavailable')
  const { endpoint, credential, admitted } = await admittedPluginTools(view, diagnostic)
  return {
    tools: admitted.map((tool) => ({
      ...tool,
      description: tool.description ?? tool.name,
      inputSchema: tool.inputSchema as BrokerInput,
    })),
    adminOperations: [],
    server: createPrivatePluginPort({ url: endpoint.url, credential, diagnostic }),
  }
}
