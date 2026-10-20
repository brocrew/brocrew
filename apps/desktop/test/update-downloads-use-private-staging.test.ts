import { createHash } from 'node:crypto'
import {
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { downloadChecked, sha512Of } from '../src/main/guided-update'

const disk = vi.hoisted(() => ({
  downloads: '',
  note: '',
  stage: '',
  removed: [] as string[],
  crossVolume: false,
  attackOnRemove: false,
  movedNote: null as string | null,
  copies: new Set<number>(),
  copyFlags: [] as number[],
  copyWrites: 0,
  corruptCopy: false,
  refuseCopy: false,
  cancelCopy: null as AbortController | null,
}))

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>()
  const changed = {
    openSync: ((path, flags, mode) => {
      const fd = fs.openSync(path, flags, mode)
      if (
        typeof path === 'string' &&
        typeof flags === 'number' &&
        (flags & fs.constants.O_EXCL) !== 0
      ) {
        if (path.endsWith('.partial')) disk.stage = path
        else if (dirname(path) === disk.downloads) {
          disk.copies.add(fd)
          disk.copyFlags.push(flags)
        }
      }
      return fd
    }) as typeof fs.openSync,
    linkSync: ((from, to) => {
      if (disk.crossVolume)
        throw Object.assign(new Error('Fictional different volume'), { code: 'EXDEV' })
      fs.linkSync(from, to)
    }) as typeof fs.linkSync,
    write: ((fd, buffer, offset, length, position, done) => {
      if (!disk.copies.has(fd)) return fs.write(fd, buffer, offset, length, position, done)
      disk.copyWrites += 1
      if (disk.refuseCopy) {
        queueMicrotask(() =>
          done(Object.assign(new Error('Fictional copy failure'), { code: 'EIO' }), 0, buffer),
        )
        return
      }
      fs.write(fd, buffer, offset, Math.min(length ?? 2, 2), position, (error, count, written) => {
        if (error === null && disk.corruptCopy && disk.copyWrites === 1)
          fs.writeSync(fd, new Uint8Array([99]), 0, 1, 0)
        disk.cancelCopy?.abort()
        done(error, count, written)
      })
    }) as typeof fs.write,
    rmSync: ((path, options) => {
      disk.removed.push(String(path))
      if (
        disk.attackOnRemove &&
        dirname(String(path)) === disk.downloads &&
        fs.existsSync(disk.note)
      ) {
        fs.renameSync(path, `${String(path)}.moved`)
        fs.renameSync(disk.note, path)
        disk.movedNote = String(path)
      }
      fs.rmSync(path, options)
    }) as typeof fs.rmSync,
  }
  return { ...fs, ...changed, default: { ...fs, ...changed } }
})

const IMAGE = new Uint8Array([3, 1, 4, 1, 5, 9])
const SHA = createHash('sha512').update(IMAGE).digest('base64')
const NOTE = 'Brook’s fictional draft'
let root: string
let staging: string
let to: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'brocrew-private-update-'))
  disk.downloads = join(root, 'Downloads')
  staging = join(root, 'app-data', 'updates', 'staging')
  mkdirSync(disk.downloads, { recursive: true })
  mkdirSync(staging, { recursive: true, mode: 0o700 })
  disk.note = join(disk.downloads, 'Brook.txt')
  writeFileSync(disk.note, NOTE)
  to = join(disk.downloads, 'Fern.dmg')
  Object.assign(disk, {
    stage: '',
    crossVolume: false,
    attackOnRemove: false,
    movedNote: null,
    copyWrites: 0,
    corruptCopy: false,
    refuseCopy: false,
    cancelCopy: null,
  })
  disk.removed.length = 0
  disk.copyFlags.length = 0
  disk.copies.clear()
})

afterEach(async () => {
  const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
  fs.rmSync(root, { recursive: true, force: true })
})

const download = (extra: Partial<Parameters<typeof downloadChecked>[0]> = {}) =>
  downloadChecked({
    url: 'https://fictional.invalid/Fern.dmg',
    to,
    stagingFolder: staging,
    sha512: SHA,
    onPercent: () => {},
    fetch: async () => new Response(IMAGE, { headers: { 'content-length': String(IMAGE.length) } }),
    ...extra,
  })

it('stages and cleans only in private app data, then lands an ordinary checked download', async () => {
  expect(await download()).toBe(to)
  expect(dirname(disk.stage)).toBe(staging)
  expect(disk.removed.length).toBeGreaterThan(0)
  expect(disk.removed.every((name) => dirname(name) === staging)).toBe(true)
  expect(readdirSync(staging)).toEqual([])
  expect(await sha512Of(to)).toBe(SHA)
  expect(readFileSync(disk.note, 'utf8')).toBe(NOTE)
})

it('never deletes a Downloads name swapped after cleanup’s identity check', async () => {
  disk.attackOnRemove = true
  const cancel = new AbortController()
  await expect(
    download({
      signal: cancel.signal,
      onPercent: (percent) => {
        if (percent < 100) cancel.abort()
      },
    }),
  ).rejects.toMatchObject({ name: 'AbortError' })
  const keptAt = existsSync(disk.note) ? disk.note : disk.movedNote
  expect(keptAt !== null && existsSync(keptAt) && readFileSync(keptAt, 'utf8')).toBe(NOTE)
  expect(disk.removed.some((name) => dirname(name) === disk.downloads)).toBe(false)
  expect(readdirSync(staging)).toEqual([])
})

it('copies exclusively across volumes, handles short writes and checks the stored copy', async () => {
  disk.crossVolume = true
  writeFileSync(to, 'A fictional older download')
  const pending = download()
  await expect(pending).resolves.toBe(join(disk.downloads, 'Fern (1).dmg'))
  const landed = await pending
  expect(readFileSync(to, 'utf8')).toBe('A fictional older download')
  expect(disk.copyWrites).toBeGreaterThan(1)
  expect(disk.copyFlags).toHaveLength(1)
  expect(disk.copyFlags[0]! & (constants.O_CREAT | constants.O_EXCL)).toBe(
    constants.O_CREAT | constants.O_EXCL,
  )
  expect(disk.copyFlags[0]! & constants.O_TRUNC).toBe(0)
  expect(await sha512Of(landed)).toBe(SHA)
  expect(readdirSync(staging)).toEqual([])
  expect(disk.removed.every((name) => dirname(name) === staging)).toBe(true)
})

it('keeps a cross-volume copy whose stored bytes fail verification and explains that it was kept', async () => {
  disk.crossVolume = true
  disk.corruptCopy = true
  await expect(download()).rejects.toThrow(
    'the saved download did not pass its check. It was left in Downloads; you can delete it. Try the update again.',
  )
  expect(existsSync(to)).toBe(true)
  expect(await sha512Of(to)).not.toBe(SHA)
  expect(readdirSync(staging)).toEqual([])
  expect(disk.removed.every((name) => dirname(name) === staging)).toBe(true)
})

it('keeps a failed exclusive copy and removes only its private partial', async () => {
  disk.crossVolume = true
  disk.refuseCopy = true
  await expect(download()).rejects.toThrow(
    'the saved download did not pass its check. It was left in Downloads; you can delete it. Try the update again.',
  )
  expect(existsSync(to)).toBe(true)
  expect(readFileSync(to)).toHaveLength(0)
  expect(readdirSync(staging)).toEqual([])
  expect(disk.removed.every((name) => dirname(name) === staging)).toBe(true)
})

it('cancels an in-flight cross-volume copy, closes it and leaves the published name alone', async () => {
  disk.crossVolume = true
  const cancel = new AbortController()
  disk.cancelCopy = cancel
  await expect(download({ signal: cancel.signal })).rejects.toMatchObject({
    name: 'AbortError',
    message: expect.stringContaining(
      'the saved download did not pass its check. It was left in Downloads; you can delete it. Try the update again.',
    ),
  })
  expect(existsSync(to)).toBe(true)
  expect(readFileSync(to)).toHaveLength(2)
  expect(readdirSync(staging)).toEqual([])
  expect(disk.removed.every((name) => dirname(name) === staging)).toBe(true)
})
