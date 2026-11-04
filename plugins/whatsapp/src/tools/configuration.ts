import type { Bridge } from '../bridge.js'
import { GROUP_ID, type SettingsStore } from '../settings.js'
import { PublicToolError, type ToolHandler } from '../shared/toolServer.js'

/** The Configure page, agents and explicit removal all use these ordinary MCP bindings. */
export function createConfigurationTools(deps: {
  bridge: Bridge
  settings: SettingsStore
}): ToolHandler[] {
  const { bridge, settings } = deps
  const view = () => {
    const current = settings.get()
    const writable = new Set(current.writable)
    return {
      status: bridge.status(),
      read: current.read,
      prefix: current.prefix,
      groups: bridge.groups().map((group) => ({ ...group, canWrite: writable.has(group.jid) })),
    }
  }
  const tool = (
    name: string,
    description: string,
    properties: Record<string, unknown>,
    run: (args: Record<string, unknown>) => unknown | Promise<unknown>,
  ): ToolHandler => ({
    definition: {
      name,
      description,
      inputSchema: {
        type: 'object',
        properties,
        required: Object.keys(properties),
        additionalProperties: false,
      },
    },
    async execute(args, context) {
      const meta = context?.metadata
      const origin = name === 'whatsapp_before_remove' ? 'lifecycle.beforeRemove' : 'settings.page'
      if (
        meta?.origin !== origin ||
        typeof meta.workspaceId !== 'string' ||
        !meta.workspaceId ||
        !(
          (typeof meta.requestId === 'string' && meta.requestId.length > 0) ||
          (typeof meta.requestId === 'number' && Number.isFinite(meta.requestId))
        )
      )
        throw new PublicToolError(
          'Plugin settings or explicit removal is required for this action.',
        )

      if (Object.keys(args).some((key) => !(key in properties)))
        throw new PublicToolError('Invalid configuration arguments.')
      for (const [key, schema] of Object.entries(properties)) {
        if (typeof args[key] !== (schema as { type: string }).type)
          throw new PublicToolError('Invalid configuration arguments.')
      }
      const value = await run(args)
      if (name === 'whatsapp_before_remove') {
        const outcome = value as { status: 'complete' | 'warning'; message: string }
        return { content: [{ type: 'text', text: outcome.message }], structuredContent: outcome }
      }
      return { content: [{ type: 'text', text: JSON.stringify(value) }] }
    },
  })
  const enabled = { enabled: { type: 'boolean' } }
  const unlink = async () => {
    await bridge.unlink()
    return bridge.status()
  }
  return [
    tool('whatsapp_status', 'Current WhatsApp link state and pairing code.', {}, () =>
      bridge.status(),
    ),
    tool('whatsapp_settings', 'Read WhatsApp settings and available groups.', {}, view),
    tool('whatsapp_link', 'Explicitly begin linking a phone to WhatsApp.', {}, async () => {
      if (!(await bridge.pair())) throw new PublicToolError('Cannot link in the current state.')
      return bridge.status()
    }),
    tool(
      'whatsapp_unlink',
      'Explicitly log out and remove local WhatsApp account/history data.',
      {},
      unlink,
    ),
    tool(
      'whatsapp_refresh_groups',
      'Refresh WhatsApp groups, preserving writing choices.',
      {},
      async () => {
        await bridge.refreshGroups()
        return view()
      },
    ),
    tool(
      'whatsapp_set_read',
      'Choose whether agents can read WhatsApp conversations.',
      enabled,
      (args) => {
        settings.setRead(args.enabled as boolean)
        return view()
      },
    ),
    tool(
      'whatsapp_set_prefix',
      'Choose whether agent messages begin with the robot prefix.',
      enabled,
      (args) => {
        settings.setPrefix(args.enabled as boolean)
        return view()
      },
    ),
    tool(
      'whatsapp_set_group_write',
      'Choose whether agents can send to a WhatsApp group.',
      { group: { type: 'string', pattern: GROUP_ID.source }, ...enabled },
      (args) => {
        const group = args.group as string
        if (
          !GROUP_ID.test(group) ||
          (args.enabled && !bridge.groups().some((one) => one.jid === group))
        )
          throw new PublicToolError('Unknown WhatsApp group.')
        settings.setWritable(group, args.enabled as boolean)
        return view()
      },
    ),
    tool(
      'whatsapp_before_remove',
      'Explicit package removal: log out before local data removal.',
      {},
      async () => {
        const status = await unlink()
        return {
          status: status.removeOnPhone ? 'warning' : 'complete',
          message: status.removeOnPhone
            ? 'Logged out here. Also remove this device on your phone: WhatsApp → Linked devices.'
            : 'Logged out of WhatsApp.',
        }
      },
    ),
  ]
}
