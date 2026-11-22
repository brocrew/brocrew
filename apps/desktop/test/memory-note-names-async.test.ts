import {
  mkdirSync,
  mkdtempSync,
  promises as fsAsync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { noteNamesIn, noteNamesInAsync } from '../src/main/runtime/memory-notes'

describe('asynchronous memory-note names', () => {
  let root: string
  let notes: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'brocrew-note-names-'))
    notes = join(root, 'notes')
    mkdirSync(notes)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(root, { recursive: true, force: true })
  })

  it('keeps the existing filename order and excludes directories and non-note files', async () => {
    writeFileSync(join(notes, 'first.md'), 'first')
    writeFileSync(join(notes, 'second.md'), 'second')
    writeFileSync(join(notes, 'other.txt'), 'not a note')
    mkdirSync(join(notes, 'directory.md'))

    const expected = noteNamesIn(notes)
    expect(expected).not.toBeNull()
    expect([...(expected ?? [])]).toEqual(['second.md', 'first.md'])
    expect([...(await noteNamesInAsync(notes))!]).toEqual([...(expected ?? [])])
  })

  it('keeps an absent or unwatched store empty', async () => {
    expect(await noteNamesInAsync(null)).toEqual(noteNamesIn(null))
    const missing = join(root, 'missing')
    expect(await noteNamesInAsync(missing)).toEqual(noteNamesIn(missing))
  })

  it('uses only enumeration when a directory can be read', async () => {
    const lstat = vi.spyOn(fsAsync, 'lstat')
    const stat = vi.spyOn(fsAsync, 'stat')
    expect(await noteNamesInAsync(notes)).toEqual(new Set())
    expect(lstat).not.toHaveBeenCalled()
    expect(stat).not.toHaveBeenCalled()
  })

  it('follows a working directory link', async () => {
    writeFileSync(join(notes, 'kept.md'), 'kept')
    const linked = join(root, 'linked')
    symlinkSync(notes, linked, 'junction')
    expect(await noteNamesInAsync(linked)).toEqual(noteNamesIn(linked))
    expect([...(await noteNamesInAsync(linked))!]).toEqual(['kept.md'])
  })

  it('does not mistake a broken directory link or a file for an empty store', async () => {
    const linked = join(root, 'broken')
    symlinkSync(join(root, 'missing'), linked, 'junction')
    const file = join(root, 'file')
    writeFileSync(file, 'not a directory')
    expect(await noteNamesInAsync(linked)).toBeNull()
    expect(noteNamesIn(linked)).toBeNull()
    expect(await noteNamesInAsync(file)).toBeNull()
    expect(noteNamesIn(file)).toBeNull()
  })

  it('returns an unobserved result if directory enumeration fails', async () => {
    vi.spyOn(fsAsync, 'readdir').mockRejectedValueOnce(new Error('fixture read failed'))
    expect(await noteNamesInAsync(notes)).toBeNull()
  })

  it('yields while directory enumeration is pending', async () => {
    writeFileSync(join(notes, 'kept.md'), 'kept')
    const read = fsAsync.readdir.bind(fsAsync)
    let entered!: () => void
    let release!: () => void
    const reading = new Promise<void>((resolve) => {
      entered = resolve
    })
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(fsAsync, 'readdir').mockImplementationOnce(async (...args) => {
      entered()
      await blocked
      return read(...args)
    })
    let finished = false
    const listing = noteNamesInAsync(notes).then((names) => {
      finished = true
      return names
    })
    await reading
    try {
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(finished).toBe(false)
    } finally {
      release()
    }
    expect([...(await listing)!]).toEqual(['kept.md'])
  })
})
