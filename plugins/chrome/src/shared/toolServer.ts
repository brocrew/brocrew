import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
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
  content: Array<{
    type: string
    text: string
  }>
}
export interface ToolHandler {
  definition: ToolDefinition
  execute(
    args: Record<string, unknown>,
    context: Record<string, unknown>,
  ): ToolResult | Promise<ToolResult>
}
export interface StaticResource {
  uri: string
  name: string
  description?: string
  mimeType?: string
  read(): string
}
export interface ToolServerOptions {
  name: string
  version: string
  tools: ToolHandler[]
  resources?: StaticResource[]
  context?: Record<string, unknown>
  customize?: (server: Server) => void
}
export function createToolServer(options: ToolServerOptions): Server {
  const { name, version, tools, resources = [], context = {} } = options
  const capabilities: Record<string, Record<string, never>> = { tools: {} }
  if (resources.length > 0) {
    capabilities.resources = {}
  }
  const server = new Server({ name, version }, { capabilities })
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
      return await tool.execute((args as Record<string, unknown>) ?? {}, context)
    } catch (err: unknown) {
      const msg =
        err instanceof PublicToolError
          ? err.message.slice(0, 2000)
          : 'Plugin unavailable. Try again.'
      return { content: [{ type: 'text', text: `Error: ${msg}` }] }
    }
  })
  if (resources.length > 0) {
    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: resources.map((r) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType ?? 'text/markdown',
      })),
    }))
    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params
      const resource = resources.find((r) => r.uri === uri)
      if (!resource) throw new Error(`Unknown resource: ${uri}`)
      return {
        contents: [
          {
            uri: resource.uri,
            mimeType: resource.mimeType ?? 'text/markdown',
            text: resource.read(),
          },
        ],
      }
    })
  }
  if (options.customize) {
    options.customize(server)
  }
  return server
}
