import { isAbsolute, join } from 'node:path'

/** Agent-owned state; sign-in and transcript paths belong to the provider home separately. */
export interface ClaudeAgentPaths {
  readonly home: string
  readonly memoryDirectory: string
  readonly memoryIndex: string
  readonly instructionsFile: string
  readonly permissionsFile: string
}

/** An omitted selector preserves the original home without moving or creating anything. */
export function claudeAgentPaths(providerHome: string, agentStateHome?: string): ClaudeAgentPaths {
  if (
    agentStateHome !== undefined &&
    (!isAbsolute(agentStateHome) || agentStateHome.includes('\0'))
  ) {
    throw new Error('Claude agent state needs an absolute directory without NUL')
  }
  const home = agentStateHome ?? providerHome
  const memoryDirectory = join(home, 'memory')
  return {
    home,
    memoryDirectory,
    memoryIndex: join(memoryDirectory, 'MEMORY.md'),
    instructionsFile: join(home, 'CLAUDE.md'),
    permissionsFile: join(home, 'settings.json'),
  }
}
