import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  mkdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  makeWorkerPieceFolder,
  WORKER_OUTPUT_DIRNAME,
  WORKER_OUTPUT_FAILURE,
} from '../src/main/worker-piece-folder'

describe('a parallel piece output folder', () => {
  let data: string
  const first = 'work_11111111-1111-4111-8111-111111111111'
  const second = 'work_22222222-2222-4222-8222-222222222222'
  beforeEach(() => {
    data = mkdtempSync(join(tmpdir(), 'fictional-worker-output-'))
  })
  afterEach(() => {
    rmSync(data, { recursive: true, force: true })
  })
  it('makes a distinct marked directory per piece and preserves the earlier piece output', () => {
    const one = makeWorkerPieceFolder(data, first)
    writeFileSync(join(one, 'draft.md'), 'Fictional draft')
    let two: string | null = null
    expect(() => {
      two = makeWorkerPieceFolder(data, second)
    }).not.toThrow()
    expect(two).not.toBeNull()
    if (two === null) throw new Error('second folder was not returned')
    expect(one).not.toBe(two)
    expect(readFileSync(join(one, '.brocrew-piece'), 'utf8')).toBe(`${first}\n`)
    expect(readFileSync(join(two, '.brocrew-piece'), 'utf8')).toBe(`${second}\n`)
    expect(readFileSync(join(one, 'draft.md'), 'utf8')).toBe('Fictional draft')
    expect(readdirSync(join(data, WORKER_OUTPUT_DIRNAME))).toEqual(
      expect.arrayContaining([first, second]),
    )
  })
  it('never overwrites a directory already standing at the piece name', () => {
    const folder = makeWorkerPieceFolder(data, first)
    writeFileSync(join(folder, 'draft.md'), 'Fictional draft')
    expect(() => makeWorkerPieceFolder(data, first)).toThrow(WORKER_OUTPUT_FAILURE)
    expect(readFileSync(join(folder, 'draft.md'), 'utf8')).toBe('Fictional draft')
  })
  it('refuses an unmarked existing root without writing inside it', () => {
    const root = join(data, WORKER_OUTPUT_DIRNAME)
    mkdirSync(root)
    writeFileSync(join(root, 'personal-note.md'), 'Unowned fictional file')
    expect(() => makeWorkerPieceFolder(data, first)).toThrow(WORKER_OUTPUT_FAILURE)
    expect(readdirSync(root)).toEqual(['personal-note.md'])
  })
  it('refuses root and piece symlinks without writing into their targets', () => {
    const target = join(data, 'elsewhere')
    mkdirSync(target)
    const root = join(data, WORKER_OUTPUT_DIRNAME)
    symlinkSync(target, root, 'dir')
    expect(() => makeWorkerPieceFolder(data, first)).toThrow(WORKER_OUTPUT_FAILURE)
    expect(readdirSync(target)).toEqual([])
    unlinkSync(root)
    makeWorkerPieceFolder(data, first)
    symlinkSync(target, join(root, second), 'dir')
    expect(() => makeWorkerPieceFolder(data, second)).toThrow(WORKER_OUTPUT_FAILURE)
    expect(readdirSync(target)).toEqual([])
  })
  it('requires the unchanged bounded ownership marker, including refusing a marker symlink', () => {
    makeWorkerPieceFolder(data, first)
    const marker = join(data, WORKER_OUTPUT_DIRNAME, '.brocrew-worker-output')
    writeFileSync(marker, 'X'.repeat(Buffer.byteLength('BroCrew parallel piece output folders\n')))
    expect(() => makeWorkerPieceFolder(data, second)).toThrow(WORKER_OUTPUT_FAILURE)
    rmSync(marker)
    const target = join(data, 'pretend-marker')
    writeFileSync(target, 'BroCrew parallel piece output folders\n')
    symlinkSync(target, marker)
    expect(() => makeWorkerPieceFolder(data, second)).toThrow(WORKER_OUTPUT_FAILURE)
    expect(readdirSync(join(data, WORKER_OUTPUT_DIRNAME))).not.toContain(second)
  })
  it('refuses traversal and malformed ids before making any folder', () => {
    for (const piece of ['../other', 'work_../other', '', 'work_' + 'a'.repeat(200)]) {
      expect(() => makeWorkerPieceFolder(data, piece)).toThrow(WORKER_OUTPUT_FAILURE)
    }
    expect(readdirSync(data)).toEqual([])
  })
})
