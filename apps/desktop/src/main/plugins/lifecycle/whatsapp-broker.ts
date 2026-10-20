import type { BrokerInput, BrokerOptions } from '../tool-broker'
import { createPrivatePluginPort } from '../managed-transport'
import { admittedPluginTools } from './broker-inventory'
import type { PluginLifecycleController } from './controller'

export const whatsappBrokerToolNames = Object.freeze([
  'list_chats',
  'read_messages',
  'search_messages',
  'search_contacts',
  'get_media',
  'list_groups',
  'send_to_group',
])
const names = new Set(whatsappBrokerToolNames)
export const whatsappBrokerResourceId = 'whatsapp'
/**
 * The plugin itself checks the person's switches at every call, and answers a refused call with its
 * own fixed words; the binding only claims the account for reading or for sending.
 */
export async function whatsappBrokerBinding(
  view: ReturnType<PluginLifecycleController['agentAttachments']>[number],
  refused: () => void | Promise<void>,
) {
  if (view.installation.pluginId !== 'whatsapp' || !view.package.compatibility.tools)
    throw new Error('unavailable')
  const resources = view.package.manifest.permissions.resources
  const account = resources.find((one) => one.id === whatsappBrokerResourceId)
  if (!account) throw new Error('unavailable')
  const { endpoint, credential, adminCredential, admitted } = await admittedPluginTools(
    view,
    names,
    refused,
  )
  return {
    tools: admitted.map((tool) => ({
      name: tool.name,
      description: tool.description ?? tool.name,
      inputSchema: tool.inputSchema as BrokerInput,
      prepare(input: BrokerInput) {
        // Reviewed claims, never supplied by a model or plugin result.
        const sends = tool.name === 'send_to_group'
        return {
          input,
          resources: [
            {
              resource: whatsappBrokerResourceId,
              key: sends ? 'groups' : 'chats',
              mode: sends ? ('write' as const) : ('read' as const),
            },
          ],
        }
      },
    })),
    resources: resources.map((one) => ({
      id: one.id,
      read: one.read,
      write: one.write,
    })),
    adminOperations: [],
    isAllowed: (_who, use) => use.resource === whatsappBrokerResourceId && account[use.mode],
    server: createPrivatePluginPort({
      url: endpoint.url,
      credential,
      privateCredentials: [adminCredential],
    }),
  } satisfies Omit<
    BrokerOptions,
    | 'binding'
    | 'reservedNamespace'
    | 'hostToolNames'
    | 'occupiedNamespaces'
    | 'occupiedQualifiedNames'
  >
}
