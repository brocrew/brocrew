import { agentToolsFor, type AgentToolHost } from '../../src/main/runtime/agent-tools'
import type { AgentToolset } from '@brobot2/runtime'
import type { ToolName } from '../../src/main/runtime/tool-families/catalog'

export function namedAgentTool(set: AgentToolset, name: string): AgentToolset['tools'][number] {
  const tool = set.tools.find((one) => one.name === name)
  if (tool === undefined) throw new Error(`no such tool: ${name}`)
  return tool
}

export async function callAgentTool(
  set: AgentToolset,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const answered = await namedAgentTool(set, name).call(args)
  return answered.structured as Record<string, unknown>
}

export function structuredAgentToolsFor(host: AgentToolHost, sessionId: string) {
  const set = agentToolsFor(host, sessionId)
  const call = async (
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const answered = await namedAgentTool(set, name).call(args)
    return (answered.structured ?? {}) as Record<string, unknown>
  }
  return { set, call }
}
