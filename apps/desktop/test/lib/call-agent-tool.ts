import type { AgentToolset } from '@brobot2/runtime'
import type { ToolName } from '../../src/main/runtime/tool-families/catalog'

export async function callAgentTool(
  set: AgentToolset,
  name: ToolName,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const tool = set.tools.find((one) => one.name === name)
  if (tool === undefined) throw new Error(`no such tool: ${name}`)
  const answered = await tool.call(args)
  return answered.structured as Record<string, unknown>
}
