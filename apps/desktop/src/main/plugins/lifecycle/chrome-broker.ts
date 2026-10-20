import { chromeAccessSnapshot, withChromeResourcePolicy } from './chrome-policy'
import { admittedPluginTools } from './broker-inventory'
import type { BrokerInput, BrokerOptions } from '../tool-broker'
import { createPrivatePluginPort } from '../managed-transport'
import type { PluginLifecycleController } from './controller'
import { join } from 'node:path'
import { immutableFile } from '../node-host-files'

const refusalMessage = 'Some plugin tools were refused.'
/** A bounded, credential-free diagnostic survives detached supervisor stdio being ignored. */
export function pluginToolRefusalLog(root: string): () => Promise<void> {
  let recorded: Promise<void> | undefined
  return () =>
    (recorded ??= immutableFile(
      join(root, 'plugin-tool-refusals.log'),
      Buffer.from(refusalMessage + '\n'),
    ).catch(() => {
      // A failed diagnostic write cannot take reviewed tools away from an otherwise healthy agent.
      console.warn(refusalMessage)
    }))
}

export const chromeBrokerToolNames = Object.freeze([
  'list_browser_profiles',
  'create_browser_profile',
  'set_browser_profile_description',
  'delete_browser_profile',
  'open_tab',
  'list_tabs',
  'close_tab',
  'show_tab',
  'hide_tab',
  'navigate',
  'snapshot',
  'click',
  'fill',
  'type',
  'press_key',
  'select',
  'hover',
  'scroll',
  'screenshot',
  'evaluate',
  'wait_for',
  'handle_dialog',
  'upload_file',
  'download',
  'wait_for_download',
  'download_url',
  'mouse',
  'console',
  'network',
  'install_extension',
  'list_extensions',
  'remove_extension',
  'get_settings',
  'set_setting',
])
const names = new Set(chromeBrokerToolNames)
export const chromeBrokerResourceId = 'browser-profiles'
const metadata = new Set([
  'list_browser_profiles',
  'create_browser_profile',
  'set_browser_profile_description',
  'delete_browser_profile',
  'list_tabs',
])
const reads = new Set([
  'snapshot',
  'screenshot',
  'console',
  'network',
  'list_extensions',
  'get_settings',
  'wait_for',
])
/** The curated Chrome package owns live enabled-profile, tab and settings checks at execution. */
export async function chromeBrokerBinding(
  view: ReturnType<PluginLifecycleController['agentAttachments']>[number],
  refused: () => void | Promise<void> = () => console.warn(refusalMessage),
) {
  if (view.installation.pluginId !== 'chrome' || !view.package.compatibility.tools)
    throw new Error('unavailable')
  const resources = view.package.manifest.permissions.resources
  const profiles = resources.find((one) => one.id === chromeBrokerResourceId)
  if (!profiles) throw new Error('unavailable')
  const { connection, endpoint, credential, adminCredential, admitted } = await admittedPluginTools(
    view,
    names,
    refused,
  )
  return {
    tools: admitted.map((tool) => {
      return {
        name: tool.name,
        description: tool.description ?? tool.name,
        inputSchema: tool.inputSchema as BrokerInput,
        prepare(input: BrokerInput) {
          // These are reviewed resource claims, never supplied by a model or plugin result.
          // Chrome re-resolves tab ownership and enabled/settings permissions inside its queue.
          if (
            input.profile !== undefined &&
            (typeof input.profile !== 'string' || !/^[a-z0-9-]{1,32}$/.test(input.profile))
          )
            throw new Error('invalid')
          if (
            input.tabId !== undefined &&
            (typeof input.tabId !== 'string' || input.tabId.length > 128)
          )
            throw new Error('invalid')
          const key =
            typeof input.profile === 'string'
              ? input.profile
              : typeof input.tabId === 'string'
                ? input.tabId
                : '*'
          return {
            input,
            resources:
              metadata.has(tool.name) && tool.name.startsWith('list_')
                ? []
                : [
                    {
                      resource: chromeBrokerResourceId,
                      key,
                      mode: reads.has(tool.name) ? ('read' as const) : ('write' as const),
                    },
                  ],
          }
        },
      }
    }),
    resources: resources.map((one) => ({
      id: one.id,
      read: one.read,
      write: one.write,
    })),
    adminOperations: [],
    isAllowed: (_who, use) => use.resource === chromeBrokerResourceId && profiles[use.mode],
    server: withChromeResourcePolicy(
      createPrivatePluginPort({
        url: endpoint.url,
        credential,
        privateCredentials: [adminCredential],
      }),
      (signal) => chromeAccessSnapshot(connection, signal),
    ),
  } satisfies Omit<
    BrokerOptions,
    | 'binding'
    | 'reservedNamespace'
    | 'hostToolNames'
    | 'occupiedNamespaces'
    | 'occupiedQualifiedNames'
  >
}
