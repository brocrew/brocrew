import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { claudeAutoMemoryIndex } from '@brobot2/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  AGENT_MEMORY_TOTAL_CAP,
  INSTRUCTION_FILE_CAP,
  readClaudeAgentMemory,
} from '../src/main/runtime/instructions'

let home: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'fern-memory-budget-'))
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

describe('the memory list keeps complete notes within its byte allowance', () => {
  it('ignores a folder named like a note without counting or refusing it as a document', () => {
    const index = claudeAutoMemoryIndex(home)
    const folder = dirname(index)
    mkdirSync(join(folder, 'archive.md'), { recursive: true })
    writeFileSync(index, 'Fern remembers one note.')
    writeFileSync(join(folder, 'role.md'), 'Fern reviews changes.')

    const result = readClaudeAgentMemory(home)
    expect(result.memory.map((entry) => basename(entry.path))).toEqual(['MEMORY.md', 'role.md'])
    expect(result.refused).toEqual([])
    expect(result.topicsFound).toBe(1)
    expect(result.topicsListed).toBe(1)
  })

  it('skips a note larger than the room left and still shows a later note that fits', () => {
    const index = claudeAutoMemoryIndex(home)
    const folder = dirname(index)
    mkdirSync(folder, { recursive: true })
    writeFileSync(index, 'i'.repeat(INSTRUCTION_FILE_CAP))
    writeFileSync(join(folder, 'a.md'), 'a'.repeat(INSTRUCTION_FILE_CAP))
    writeFileSync(join(folder, 'b.md'), 'b'.repeat(INSTRUCTION_FILE_CAP))
    writeFileSync(join(folder, 'c.md'), 'c'.repeat(INSTRUCTION_FILE_CAP - 8))
    writeFileSync(join(folder, 'd.md'), 'This note needs more room.')
    writeFileSync(join(folder, 'e.md'), 'Fern')

    const result = readClaudeAgentMemory(home)
    expect(result.refused).toEqual([])
    expect(result.memory.map((entry) => basename(entry.path))).toEqual([
      'MEMORY.md',
      'a.md',
      'b.md',
      'c.md',
      'e.md',
    ])
    expect(result.memory.at(-1)?.text).toBe('Fern')
    expect(result.memory.every((entry) => !entry.truncated)).toBe(true)
    expect(result.memory.reduce((bytes, entry) => bytes + entry.bytes, 0)).toBe(
      AGENT_MEMORY_TOTAL_CAP - 4,
    )
    expect(result.topicsFound).toBe(5)
    expect(result.topicsListed).toBe(4)
  })
})
