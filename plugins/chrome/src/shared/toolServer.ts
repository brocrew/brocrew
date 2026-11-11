import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { dispatchTool, type ToolDefinition } from '../../../shared/tool-dispatch.js'
export { PublicToolError } from '../../../shared/tool-dispatch.js'
export type { ToolDefinition } from '../../../shared/tool-dispatch.js'
export type ToolActivity =
  | 'browser-ready'
  | 'page-ready'
  | 'page-response'
  | 'page-loaded'
  | 'screenshot-captured'
  | 'download-received'
  | 'download-saved'
interface ToolContext extends Record<string, unknown> {
  signal?: AbortSignal
  activity?: (stage: ToolActivity) => void
}
export type ToolResult = {
  content: Array<{
    type: string
    text: string
  }>
}
export interface ToolHandler {
  definition: ToolDefinition
  execute(args: Record<string, unknown>, context: ToolContext): ToolResult | Promise<ToolResult>
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
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name: toolName, arguments: args } = request.params
    let active = true
    let progress = 0
    return dispatchTool(tools, toolName, args, async (tool, parsed) => {
      try {
        return await tool.execute(parsed, {
          ...context,
          signal: extra.signal,
          activity(stage) {
            const progressToken = request.params._meta?.progressToken
            if (active && !extra.signal.aborted && progressToken !== undefined)
              void extra
                .sendNotification({
                  method: 'notifications/progress',
                  params: { progressToken, progress: ++progress, message: stage },
                })
                .catch(() => undefined)
          },
        })
      } finally {
        active = false
      }
    })
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
