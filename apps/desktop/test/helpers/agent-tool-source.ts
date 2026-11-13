import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function agentToolSourcePaths(runtimeRoot: string): string[] {
  const families = join(runtimeRoot, 'tool-families')
  return [
    join(runtimeRoot, 'agent-tools.ts'),
    ...readdirSync(families, { encoding: 'utf8', recursive: true })
      .filter((name) => name.endsWith('.ts'))
      .sort()
      .map((name) => join(families, name)),
  ]
}

export function agentToolCode(runtimeRoot: string): string {
  return agentToolSourcePaths(runtimeRoot)
    .map((path) =>
      readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .join('\n'),
    )
    .join('\n\n')
}
