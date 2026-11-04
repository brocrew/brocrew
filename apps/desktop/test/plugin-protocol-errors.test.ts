import { describe, expect, it } from 'vitest'
import { McpError } from '@modelcontextprotocol/sdk/types.js'
import { PluginHost } from '../src/main/plugins/host-methods'
import { PluginPageTools } from '../src/main/plugins/ui/tool-rpc'
import { PLUGIN_PAGE_CHANNEL } from '../src/shared/plugin-page'

describe('generic host protocol failures', () => {
  it.each([-32000, -32001, -32602])(
    'preserves protocol code %s, message and data through the host callback wrapper',
    async (code) => {
      const data = { reason: 'Choose a fictional collection', choices: ['drafts', 'guides'] }
      const failure = new McpError(code, 'A fictional collection is required', data)
      const owner = { pluginId: 'fictional-notes', runId: 'fictional-run' }
      const host = new PluginHost({
        callTool: async () => {
          throw failure
        },
      })
      host.attach(owner)
      host.setEnabled('workshop', owner.pluginId, true)
      const registered = await host.request(owner, {
        api: 1,
        workspaceId: 'workshop',
        requestId: 'register',
        method: 'host.contributions.register',
        params: {
          contributionId: 'save',
          kind: 'ui.button',
          api: 1,
          definition: {
            slot: 'composer.accessory',
            view: { label: 'Save fictional note' },
            invoke: { tool: 'notes_save' },
          },
        },
      })
      const handle = (registered as { value: { handle: string } }).value.handle
      const answer = await host.activate('workshop', handle)
      expect(structuredClone(answer)).toEqual({
        error: {
          code: 'protocol-error',
          message: failure.message,
          protocol: { code, message: failure.message, data },
        },
      })
      expect(JSON.parse(JSON.stringify(answer))).toEqual(answer)
    },
  )

  it('keeps an ordinary local failure payload out of the page result', async () => {
    const page = new PluginPageTools({
      current: () => true,
      callTool: async () => {
        throw Object.assign(new Error('Fictional local path /fictional/private-notes'), {
          code: -32000,
        })
      },
    })
    const answer = await page.invoke({
      channel: PLUGIN_PAGE_CHANNEL,
      requestId: 'save',
      method: 'callTool',
      params: { tool: 'notes_save', arguments: {} },
    })
    expect(answer).toEqual({ status: 'transport-error', message: 'The plugin tool call failed.' })
    expect(JSON.stringify(answer)).not.toContain('/fictional/private-notes')
  })
})
