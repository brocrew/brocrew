import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'

const fault = vi.hoisted(() => ({ beforeWrite: null as null | ((path: string) => void) }))
// A marker is made by an open of its name, then written through the descriptor.
vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>()
  return {
    ...actual,
    openSync: (...args: Parameters<typeof actual.openSync>) => {
      fault.beforeWrite?.(String(args[0]))
      return actual.openSync(...args)
    },
  }
})
import {
  makeWorkerPieceFolder,
  WORKER_OUTPUT_DIRNAME,
  WORKER_OUTPUT_FAILURE,
} from '../src/main/worker-piece-folder'

// The real temporary directories are substituted at a failing write; no outside write is permitted.
describe('a failed worker folder create deletes no substituted empty directory', () => {
  let data: string
  const piece = 'work_11111111-1111-4111-8111-111111111111'
  beforeEach(() => {
    data = mkdtempSync(join(tmpdir(), 'brocrew-folder-cleanup-'))
    fault.beforeWrite = null
  })
  afterEach(() => {
    fault.beforeWrite = null
    rmSync(data, { recursive: true, force: true })
  })

  it('keeps a substituted empty root after its marker write fails', () => {
    const root = join(data, WORKER_OUTPUT_DIRNAME)
    const original = join(data, 'original-root')
    fault.beforeWrite = (path) => {
      if (basename(path) !== '.brocrew-worker-output') return
      renameSync(root, original)
      mkdirSync(root)
      throw new Error('fictional marker write failed')
    }
    expect(() => makeWorkerPieceFolder(data, piece)).toThrow(WORKER_OUTPUT_FAILURE)
    expect(existsSync(root)).toBe(true)
    expect(existsSync(original)).toBe(true)
    expect(existsSync(join(root, '.brocrew-worker-output'))).toBe(false)
  })

  it('keeps a substituted empty output after its piece-marker write fails', () => {
    const root = join(data, WORKER_OUTPUT_DIRNAME)
    const output = join(root, piece)
    const original = join(root, 'original-output')
    fault.beforeWrite = (path) => {
      if (basename(path) !== '.brocrew-piece') return
      renameSync(output, original)
      mkdirSync(output)
      throw new Error('fictional piece write failed')
    }
    expect(() => makeWorkerPieceFolder(data, piece)).toThrow(WORKER_OUTPUT_FAILURE)
    expect(existsSync(output)).toBe(true)
    expect(existsSync(original)).toBe(true)
    expect(existsSync(join(output, '.brocrew-piece'))).toBe(false)
    expect(existsSync(join(root, '.brocrew-worker-output'))).toBe(true)
  })
})
