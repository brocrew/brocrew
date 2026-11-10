import type { AgentToolset } from '@brobot2/runtime'
import type { ToolName } from '../../src/main/runtime/agent-tools'

export const callOn = async (
  toolset: AgentToolset,
  name: ToolName,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  const tool = toolset.tools.find((one) => one.name === name)
  if (tool === undefined) throw new Error(`no such tool: ${name}`)
  return (await tool.call(args)).structured as Record<string, unknown>
}
