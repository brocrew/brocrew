import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { workspaceInstructionFiles, workspaceOwnFilesIn } from '../src/main/runtime/workspace'
import { codexConventionChain, readSessionInstructions } from '../src/main/runtime/instructions'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'

describe('the app publishes no workspace instructions', () => {
  let userData: string
  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-workspace-'))
  })
  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
  })

  it('has no generated instruction files of its own', () => {
    expect(workspaceInstructionFiles()).toEqual([])
    expect(workspaceOwnFilesIn(userData)).toEqual([])
  })

  it('keeps an explicit project folder and its own instruction files', () => {
    const cwd = join(userData, 'project')
    mkdirSync(cwd)
    writeFileSync(join(cwd, 'CLAUDE.md'), 'PROJECT_CLAUDE_RULE')
    writeFileSync(join(cwd, 'AGENTS.md'), 'PROJECT_AGENTS_RULE')
    expect(resolveSessionCwd(userData, 'sess_1', cwd)).toBe(cwd)
    for (const provider of ['claude', 'codex'] as const) {
      const read = readSessionInstructions({
        provider,
        cwd,
        providerHome: join(userData, 'fictional-home'),
        home: userData,
        workspaceOwnFiles: workspaceOwnFilesIn(userData),
      })
      if (provider === 'claude') {
        expect(read.instructions.composed).toContain('PROJECT_CLAUDE_RULE')
        expect(read.instructions.composed).toContain('PROJECT_AGENTS_RULE')
      } else {
        expect(read.instructions.injected).toEqual([])
        expect(codexConventionChain(cwd, userData)).toContain(cwd)
      }
      expect(read.instructions.injected.every((one) => one.kind !== 'workspace-instructions')).toBe(
        true,
      )
    }
    expect(readFileSync(join(cwd, 'CLAUDE.md'), 'utf8')).toBe('PROJECT_CLAUDE_RULE')
    expect(readFileSync(join(cwd, 'AGENTS.md'), 'utf8')).toBe('PROJECT_AGENTS_RULE')
  })
})
