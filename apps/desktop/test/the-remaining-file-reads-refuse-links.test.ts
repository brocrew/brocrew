import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readTextFile, realPathOf } from '../src/main/read-text-file'
import { readWorkflowOutput } from '../src/main/workflow-output'
import { readChildWork } from '../src/main/child-work'
import { readInstructionSource } from '../src/main/instruction-source'
import { readOfferedResource } from '../src/main/resources/resources'
import { brobotWorkspace, ensureWorkspace, WORKSPACE_CANARY } from '../src/main/runtime/workspace'

const windows = vi.hoisted(() => ({
  reads: 0,
  coarseTimes: false,
  beforeOpen: null as null | ((path: string) => void),
}))

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>()
  const constants = { ...fs.constants }
  Object.defineProperty(constants, 'O_NOFOLLOW', { value: undefined })
  const timestamp = <T extends { ctimeMs: number | bigint } | undefined>(stat: T): T =>
    windows.coarseTimes && stat !== undefined && typeof stat.ctimeMs === 'number'
      ? Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, {
          ctimeMs: 0,
        })
      : stat
  const changed = {
    constants,
    openSync: ((path, flags, mode) => {
      if (typeof path === 'string' && windows.beforeOpen !== null) {
        const before = windows.beforeOpen
        windows.beforeOpen = null
        before(path)
      }
      // Off Windows, omit the host's flag to exercise the Windows post-open check.
      const requested = typeof flags === 'number' ? flags & ~(fs.constants.O_NOFOLLOW ?? 0) : flags
      return fs.openSync(path, requested, mode)
    }) as typeof fs.openSync,
    lstatSync: ((...args: Parameters<typeof fs.lstatSync>) =>
      timestamp(fs.lstatSync(...args))) as typeof fs.lstatSync,
    fstatSync: ((...args: Parameters<typeof fs.fstatSync>) =>
      timestamp(fs.fstatSync(...args))) as typeof fs.fstatSync,
    readSync: ((...args: Parameters<typeof fs.readSync>) => {
      windows.reads += 1
      return fs.readSync(...args)
    }) as typeof fs.readSync,
  }
  return { ...fs, ...changed, default: { ...fs, ...changed } }
})

let root: string
let elsewhere: string
const BODY = '# Fictional report from Brook\n'

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'brocrew-file-reads-'))
  elsewhere = join(root, 'elsewhere.md')
  windows.reads = 0
  windows.coarseTimes = false
  windows.beforeOpen = null
})

afterEach(() => {
  windows.beforeOpen = null
  windows.coarseTimes = false
  rmSync(root, { recursive: true, force: true })
})

function resolveThenReplace(): string {
  const offered = join(root, 'offered.md')
  writeFileSync(offered, BODY)
  const real = realPathOf(offered)
  expect(real.ok).toBe(true)
  if (!real.ok) throw new Error('The fictional file did not resolve')
  renameSync(offered, elsewhere)
  symlinkSync(elsewhere, offered)
  return real.path
}

describe('the remaining file reads on Windows', () => {
  it.each([
    ['text', (path: string) => readTextFile(path, 1024), 'not-readable'],
    ['workflow output', readWorkflowOutput, 'not-readable'],
    [
      'instruction source',
      (path: string) => readInstructionSource([path], 0),
      { ok: false, reason: 'not-readable' },
    ],
  ] as const)('reports a directory as not readable in %s', (_name, read, expected) => {
    const path = join(root, 'report.md')
    mkdirSync(path)
    expect(read(path)).toEqual(expected)
    expect(windows.reads).toBe(0)
  })

  it('reports a directory wearing a transcript name as not readable', () => {
    const id = 'a5555555555555555'
    mkdirSync(join(root, 'subagents', `agent-${id}.jsonl`), { recursive: true })
    expect(readChildWork(root, id, 'transcript')).toBe('not-readable')
    expect(windows.reads).toBe(0)
  })

  it('keeps refusing a link to a directory planted after resolution', () => {
    const offered = join(root, 'offered.md')
    writeFileSync(offered, BODY)
    const real = realPathOf(offered)
    if (!real.ok) throw new Error('The fictional file did not resolve')
    renameSync(offered, elsewhere)
    const directory = join(root, 'folder')
    mkdirSync(directory)
    symlinkSync(directory, offered, 'junction')
    expect(readTextFile(real.path, 1024)).toBe('gone')
    expect(windows.reads).toBe(0)
    expect(lstatSync(offered).isSymbolicLink()).toBe(true)
    expect(lstatSync(directory).isDirectory()).toBe(true)
  })

  it('does not keep bytes through a link planted after the offered resource was resolved', () => {
    const read = readOfferedResource(resolveThenReplace())
    expect(read.ok ? null : read.refusal.rail).toBe('resource-unreadable')
    expect(windows.reads).toBe(0)
    expect(readFileSync(elsewhere, 'utf8')).toBe(BODY)
  })

  it('keeps the ordinary offered file', () => {
    const path = join(root, 'report.md')
    writeFileSync(path, BODY)
    const read = readOfferedResource(path)
    expect(read.ok).toBe(true)
    expect(windows.reads).toBeGreaterThan(0)
  })

  it('does not display bytes through a link planted after the text file was resolved', () => {
    expect(readTextFile(resolveThenReplace(), 1024)).toBe('gone')
    expect(windows.reads).toBe(0)
  })

  it('still displays the target of an intentionally offered link resolved by the caller', () => {
    writeFileSync(elsewhere, BODY)
    const offered = join(root, 'alias.md')
    symlinkSync(elsewhere, offered)
    const real = realPathOf(offered)
    expect(real.ok).toBe(true)
    if (!real.ok) throw new Error('The fictional alias did not resolve')
    expect(readTextFile(real.path, 1024)).toEqual({
      text: BODY,
      truncated: false,
      bytes: BODY.length,
    })
  })

  it('does not read a retirement marker through a link swapped in at open', () => {
    const workspace = brobotWorkspace(root)
    mkdirSync(workspace)
    const marker = join(workspace, 'CLAUDE.md')
    const body = [
      '<!-- Generated by BroBot. Rendered from one canonical source; edits here are overwritten. -->',
      '',
      '# Fictional former instructions',
      `Instruction marker: ${WORKSPACE_CANARY}`,
      '',
    ].join('\n')
    writeFileSync(marker, body)
    // A coarse timestamp can stay equal when the same file is moved and linked back.
    windows.coarseTimes = true
    windows.beforeOpen = (path) => {
      expect(path).toBe(marker)
      renameSync(marker, elsewhere)
      symlinkSync(elsewhere, marker)
    }
    expect(ensureWorkspace(root)).toBe(workspace)
    expect(windows.reads).toBe(0)
    expect(lstatSync(marker).isSymbolicLink()).toBe(true)
    expect(readFileSync(elsewhere, 'utf8')).toBe(body)
  })

  it('still retires an ordinary former instruction file', () => {
    const workspace = brobotWorkspace(root)
    mkdirSync(workspace)
    const marker = join(workspace, 'AGENTS.md')
    writeFileSync(
      marker,
      '<!-- Generated by BroBot. Rendered from one canonical source; edits here are overwritten. -->' +
        `\n\n# Former instructions\nInstruction marker: ${WORKSPACE_CANARY}\n`,
    )
    ensureWorkspace(root)
    expect(() => lstatSync(marker)).toThrow()
    expect(windows.reads).toBeGreaterThan(0)
  })
})
