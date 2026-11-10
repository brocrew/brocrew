import type { AgentToolset } from '@brobot2/runtime'
import type { ToolName } from '../../src/main/runtime/agent-tools'

/** Calls one tool from a toolset the host handed out and returns its structured answer. */
export async function callOn(
  toolset: AgentToolset,
  name: ToolName,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const tool = toolset.tools.find((one) => one.name === name)
  if (tool === undefined) throw new Error(`no such tool: ${name}`)
  return (await tool.call(args)).structured as Record<string, unknown>
}
