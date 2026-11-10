import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
export class PublicToolError extends Error {}
export interface ToolDefinition {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
    additionalProperties?: boolean
  }
}
export type ToolResult = {
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
    const tool = tools.find((t) => t.definition.name === toolName)
    if (!tool) {
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }] }
    }
    try {
      return await tool.execute((args as Record<string, unknown>) ?? {})
    } catch (err: unknown) {
      return {
        content: [
          { type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` },
        ],
        ...(err instanceof PublicToolError ? {} : { isError: true }),
      }
    }
  })
  return server
}
