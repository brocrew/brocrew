import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { dispatchTool, type ToolDefinition } from '../../../shared/tool-dispatch.js'
export { PublicToolError } from '../../../shared/tool-dispatch.js'
export type { ToolDefinition } from '../../../shared/tool-dispatch.js'
export type ToolResult = {
  isError?: boolean
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>
}
export interface ToolHandler {
  definition: ToolDefinition
  execute(args: Record<string, unknown>): ToolResult | Promise<ToolResult>
}
export interface ToolServerOptions {
  name: string
  version: string
  tools: ToolHandler[]
}
export function createToolServer(options: ToolServerOptions): Server {
  const { name, version, tools } = options
  const server = new Server({ name, version }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => t.definition),
  }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name: toolName, arguments: args } = request.params
    return dispatchTool(tools, toolName, args, (tool, parsed) => tool.execute(parsed))
  })
  return server
}
