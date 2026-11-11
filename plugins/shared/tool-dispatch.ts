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
export async function dispatchTool<T extends { definition: { name: string } }, R>(
  tools: readonly T[],
  name: string,
  args: unknown,
  execute: (tool: T, args: Record<string, unknown>) => R,
) {
  const tool = tools.find((t) => t.definition.name === name)
  if (!tool) return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] }
  try {
    return await execute(tool, (args as Record<string, unknown>) ?? {})
  } catch (err: unknown) {
    return {
      content: [
        { type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` },
      ],
      ...(err instanceof PublicToolError ? {} : { isError: true }),
    }
  }
}
