import { expect, it, vi } from 'vitest'
import { PluginPageTools } from '../src/main/plugins/ui/tool-rpc'
import { PLUGIN_PAGE_CHANNEL } from '../src/shared/plugin-page'

it('passes configuration calls and their arguments to the shared MCP boundary unchanged', async () => {
  const value = {
    status: 'result' as const,
    result: {
      content: [{ type: 'text', text: 'Saved' }],
      structuredContent: { revision: 2 },
      isError: false,
    },
  }
  const callTool = vi.fn(async () => value)
  const rpc = new PluginPageTools({ current: () => true, callTool })
  const args = { collection: 'fictional', customField: ['untouched'] }
  expect(
    await rpc.invoke({
      channel: PLUGIN_PAGE_CHANNEL,
      requestId: 'save',
      method: 'callTool',
      params: { tool: 'notes_save', arguments: args },
    }),
  ).toEqual(value)
  expect(callTool).toHaveBeenCalledWith('notes_save', args, 'save', expect.any(AbortSignal))
  rpc.close()
})
it('cancels page requests on close and never returns a late reply to an ended view', async () => {
  let finish!: (value: { status: 'result'; result: { content: [] } }) => void
  const cancelTool = vi.fn(async () => {})
  const rpc = new PluginPageTools({
    current: () => true,
    cancelTool,
    callTool: () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  })
  const pending = rpc.invoke({
    channel: PLUGIN_PAGE_CHANNEL,
    requestId: 'read',
    method: 'callTool',
    params: { tool: 'notes_read', arguments: {} },
  })
  rpc.close()
  expect(cancelTool).toHaveBeenCalledWith('read')
  finish({ status: 'result', result: { content: [] } })
  await expect(pending).rejects.toThrow('Plugin unavailable.')
})
