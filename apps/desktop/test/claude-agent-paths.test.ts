import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readSessionInstructions } from '../src/main/providers/claude/instructions'
import type { InstructionInputs } from '../src/main/providers/instruction-types'
import { claudeAgentPaths } from '@brobot2/runtime'
import { memory } from '../src/main/providers/claude/memory'
import { keptRules } from '../src/main/providers/claude/kept-rules'

describe('the Claude instructions drawer reads the same agent paths as the launch', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'brocrew-agent-instructions-'))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  function state(name: string) {
    const home = join(root, name)
    mkdirSync(join(home, 'memory'), { recursive: true })
    writeFileSync(join(home, 'CLAUDE.md'), `${name} profile instructions`)
    writeFileSync(join(home, 'memory', 'MEMORY.md'), `${name} native memory`)
    return home
  }

  it('selects agent instructions and native memory without reading the shared home copies', () => {
    const providerHome = state('shared-provider')
    for (const name of ['birch', 'cedar']) {
      const agentStateHome = state(name)
      const inputs: InstructionInputs & { agentStateHome: string } = {
        provider: 'claude',
        providerHome,
        agentStateHome,
        cwd: root,
        home: root,
      }
      const read = readSessionInstructions(inputs)
      expect(read.instructions.injected.find((row) => row.kind === 'profile-memory')?.path).toBe(
        join(agentStateHome, 'CLAUDE.md'),
      )
      expect(read.instructions.agentMemory.map((row) => row.path)).toEqual([
        join(agentStateHome, 'memory', 'MEMORY.md'),
      ])
    }
  })

  it('uses the same canonical agent root for memory pages, selections and the saved-rule panel', () => {
    const providerHome = state('shared-provider')
    const agentStateHome = state('birch')
    writeFileSync(
      join(providerHome, 'settings.json'),
      JSON.stringify({ permissions: { allow: ['Bash(shared-command)'] } }),
    )
    writeFileSync(
      join(agentStateHome, 'settings.json'),
      JSON.stringify({ permissions: { allow: ['Bash(birch-command)'] } }),
    )
    const paths = claudeAgentPaths(providerHome, agentStateHome)
    expect(memory.counts(paths.home)).toEqual({ total: 1, listed: 0 })
    expect(memory.readPage(paths.home, 0, 10).memory.map((row) => row.path)).toEqual([
      paths.memoryIndex,
    ])
    expect(memory.select(paths.home, paths.memoryIndex)?.text).toBe('birch native memory')
    expect(keptRules.files([paths.home], [])).toEqual([
      {
        file: paths.permissionsFile,
        rules: [
          {
            kept: 'Bash(birch-command)',
            rule: { kind: 'tool', tool: 'Bash', content: 'birch-command' },
          },
        ],
      },
    ])
  })

  it('keeps the original profile instructions and memory when the selector is absent', () => {
    const providerHome = state('old-home')
    const read = readSessionInstructions({
      provider: 'claude',
      providerHome,
      cwd: root,
      home: root,
    })
    expect(read.instructions.injected.find((row) => row.kind === 'profile-memory')?.path).toBe(
      join(providerHome, 'CLAUDE.md'),
    )
    expect(read.instructions.agentMemory.map((row) => row.path)).toEqual([
      join(providerHome, 'memory', 'MEMORY.md'),
    ])
  })
})
