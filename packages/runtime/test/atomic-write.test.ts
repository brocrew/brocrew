import {
  existsSync,
  fsyncSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { stageAtomicWriteSync, writeAtomically, writeAtomicallySync } from '../src/atomic-write'

vi.mock('node:fs', async (original) => {
  const real = await original<typeof import('node:fs')>()
  return {
    ...real,
    fsyncSync: vi.fn(real.fsyncSync),
    renameSync: vi.fn(real.renameSync),
  }
})

let folder: string
let path: string
beforeEach(() => {
  vi.mocked(fsyncSync).mockClear()
  vi.mocked(renameSync).mockClear()
  folder = mkdtempSync(join(tmpdir(), 'atomic-write-'))
  path = join(folder, 'settings.json')
  writeFileSync(path, 'previous')
})
afterEach(() => {
  vi.mocked(fsyncSync).mockReset()
  vi.mocked(renameSync).mockReset()
  rmSync(folder, { recursive: true, force: true })
})

it('publishes complete bytes after flushing, then flushes the published directory or Windows file', () => {
  vi.mocked(renameSync).mockImplementationOnce((from, to) => {
    expect(fsyncSync).toHaveBeenCalledTimes(1)
    expect(readFileSync(path, 'utf8')).toBe('previous')
    expect(readFileSync(from, 'utf8')).toBe('next')
    return realRename(from, to)
  })
  writeAtomicallySync(path, 'next', { mode: 0o640 })
  expect(readFileSync(path, 'utf8')).toBe('next')
  expect(fsyncSync).toHaveBeenCalledTimes(2)
  if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o640)
  expect(readdirSync(folder)).toEqual(['settings.json'])
})

const { renameSync: realRename, fsyncSync: realSync } =
  await vi.importActual<typeof import('node:fs')>('node:fs')

it('waits out a brief held-file error without exposing a partial replacement', () => {
  vi.mocked(renameSync)
    .mockImplementationOnce(() => {
      expect(readFileSync(path, 'utf8')).toBe('previous')
      throw Object.assign(new Error('held'), { code: 'EPERM' })
    })
    .mockImplementation(realRename)
  writeAtomicallySync(path, 'next')
  expect(renameSync).toHaveBeenCalledTimes(2)
  expect(readFileSync(path, 'utf8')).toBe('next')
  expect(readdirSync(folder)).toEqual(['settings.json'])
})

it('keeps the old file and removes the stage when flushing the new bytes fails', () => {
  vi.mocked(fsyncSync).mockImplementationOnce(() => {
    throw Object.assign(new Error('disk failure'), { code: 'EIO' })
  })
  expect(() => writeAtomicallySync(path, 'next')).toThrow('disk failure')
  expect(renameSync).not.toHaveBeenCalled()
  expect(readFileSync(path, 'utf8')).toBe('previous')
  expect(readdirSync(folder)).toEqual(['settings.json'])
})

it('reports a failed post-publication flush while retaining the complete new file', () => {
  vi.mocked(fsyncSync)
    .mockImplementationOnce(realSync)
    .mockImplementationOnce(() => {
      throw new Error('publication flush failed')
    })
  expect(() => writeAtomicallySync(path, 'next')).toThrow('publication flush failed')
  expect(readFileSync(path, 'utf8')).toBe('next')
  expect(readdirSync(folder)).toEqual(['settings.json'])
})

it('keeps a file that appeared before an exclusive install and cleans unused preparations', () => {
  const stage = stageAtomicWriteSync(path, 'next')
  expect(readFileSync(path, 'utf8')).toBe('previous')
  expect(() => stage.commit(true)).toThrow()
  stage.discard()
  stage.discard()
  expect(readFileSync(path, 'utf8')).toBe('previous')
  expect(readdirSync(folder)).toEqual(['settings.json'])
  const absent = join(folder, 'new.json')
  writeAtomicallySync(absent, 'first', { exclusive: true })
  expect(readFileSync(absent, 'utf8')).toBe('first')
})

it('streams complete exports and preserves the previous export if a later batch fails', async () => {
  await writeAtomically(path, async (append) => {
    await append('first\n')
    expect(readFileSync(path, 'utf8')).toBe('previous')
    await append('second\n')
  })
  expect(readFileSync(path, 'utf8')).toBe('first\nsecond\n')
  await expect(
    writeAtomically(path, async (append) => {
      await append('incomplete')
      throw new Error('could not read the next batch')
    }),
  ).rejects.toThrow('could not read the next batch')
  expect(readFileSync(path, 'utf8')).toBe('first\nsecond\n')
  expect(readdirSync(folder)).toEqual(['settings.json'])
})

it('retries an asynchronous held rename and leaves no stage after a permanent failure', async () => {
  const rename = vi
    .fn(fs.rename)
    .mockRejectedValueOnce(Object.assign(new Error('held'), { code: 'EBUSY' }))
  await writeAtomically(path, 'next', { ...fs, rename })
  expect(rename).toHaveBeenCalledTimes(2)
  const failed = vi.fn().mockRejectedValue(Object.assign(new Error('full'), { code: 'ENOSPC' }))
  await expect(writeAtomically(path, 'incomplete', { ...fs, rename: failed })).rejects.toThrow(
    'full',
  )
  expect(failed).toHaveBeenCalledTimes(1)
  expect(readFileSync(path, 'utf8')).toBe('next')
  expect(readdirSync(folder)).toEqual(['settings.json'])
})

it('does not remove an existing entry when exclusive staging creation fails', async () => {
  const occupied = join(folder, 'occupied')
  writeFileSync(occupied, 'keep')
  const rm = vi.fn(fs.rm)
  await expect(
    writeAtomically(path, 'next', {
      ...fs,
      open: () => fs.open(occupied, 'wx'),
      rm,
    }),
  ).rejects.toThrow()
  expect(rm).not.toHaveBeenCalled()
  expect(existsSync(occupied)).toBe(true)
})

it('publishes filenames near the filesystem limit without lengthening the destination name', async () => {
  const long = join(folder, `${'r'.repeat(242)}.md`)
  writeAtomicallySync(long, 'first')
  await writeAtomically(long, 'second')
  expect(readFileSync(long, 'utf8')).toBe('second')
  expect(readdirSync(folder).sort()).toEqual([`${'r'.repeat(242)}.md`, 'settings.json'])
})
