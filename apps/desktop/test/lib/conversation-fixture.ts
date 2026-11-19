import type { AgentToolset } from '@brobot2/runtime'
import type { ToolName } from '../../src/main/runtime/agent-tools'

export function profileSeeder(
  open: (profileId: string) => Promise<string>,
  close: (sessionId: string) => Promise<void>,
): (profileId: string) => Promise<void> {
  return async (profileId) => {
    const sessionId = await open(profileId)
    await close(sessionId)
  }
}

export function fixtureToolCaller(toolsetFor: (sessionId: string) => AgentToolset) {
  return async (
    sessionId: string,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolsetFor(sessionId).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }
}

export function reviewLeadSession(cwd: string) {
  return { provider: 'claude', profileId: 'review-lead', cwd, approvalMode: 'auto' } as const
}

export async function waitForMessageFixture(
  ready: () => boolean,
  what: string,
  tries = 300,
): Promise<void> {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    if (ready()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}
