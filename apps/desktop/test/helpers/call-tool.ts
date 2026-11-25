import type { AgentToolset } from '@brobot2/runtime'
import { agentToolsFor, type AgentToolHost, type ToolName } from '../../src/main/runtime/agent-tools'

/** Calls one tool and returns its whole answer: the sentence and what it structures. */
export async function answerOn(
  toolset: AgentToolset,
  name: ToolName,
  args: Record<string, unknown> = {},
) {
  const tool = toolset.tools.find((one) => one.name === name)
  if (tool === undefined) throw new Error(`no such tool: ${name}`)
  return tool.call(args)
}

/** Calls one tool and returns the sentence it answered in. */
export async function textOf(
  toolset: AgentToolset,
  name: ToolName,
  args: Record<string, unknown> = {},
): Promise<string> {
  return (await answerOn(toolset, name, args)).text
}

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

/** Calls one tool as a conversation of a host and returns its structured answer. */
export async function callAs(
  host: AgentToolHost,
  caller: string,
  name: ToolName,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return callOn(agentToolsFor(host, caller), name, args)
}

export function lastToolset(toolsets: readonly AgentToolset[]): AgentToolset {
  const found = toolsets.at(-1)
  if (found === undefined) throw new Error('no toolset was handed to that launch')
  return found
}

export async function listedAgentIds(toolset: AgentToolset): Promise<string[]> {
  const listed = (await callOn(toolset, 'list_agents')) as { agents: { agent: string }[] }
  return listed.agents.map(({ agent }) => agent)
}
