import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { downloadChecked } from '../src/main/guided-update'

const disk = vi.hoisted(() => ({
  plantLinkTo: null as string | null,
  stage: null as string | null,
  flags: 0,
  mode: undefined as unknown,
  failWrite: false,
  failPlacement: false,
  placements: 0,
  holdClose: false,
  releaseClose: null as (() => void) | null,
}))

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>()
  const changed = {
    openSync: ((path, flags, mode) => {
      if (
        typeof path === 'string' &&
        path.endsWith('.partial') &&
        typeof flags === 'number' &&
        (flags & fs.constants.O_EXCL) !== 0
      ) {
        disk.stage = path
        disk.flags = typeof flags === 'number' ? flags : 0
        disk.mode = mode
        if (disk.plantLinkTo !== null) {
          const target = disk.plantLinkTo
          disk.plantLinkTo = null
          fs.symlinkSync(target, path)
        }
      }
      return fs.openSync(path, flags, mode)
    }) as typeof fs.openSync,
    createWriteStream: ((path, options) => {
      const stream = fs.createWriteStream(path, {
        ...(typeof options === 'string' ? { encoding: options } : options),
        ...(disk.holdClose
          ? {
              fs: {
                open: fs.open,
                write: fs.write,
                close: (fd: number, done: (error: NodeJS.ErrnoException | null) => void) => {
                  disk.releaseClose = () => fs.close(fd, done)
                },
              },
            }
          : {}),
      })
      if (disk.failWrite) {
        queueMicrotask(() =>
          stream.destroy(Object.assign(new Error('Fictional disk failure'), { code: 'EIO' })),
        )
      }
      return stream
    }) as typeof fs.createWriteStream,
    linkSync: ((source, destination) => {
      disk.placements += 1
      if (disk.failPlacement)
        throw Object.assign(new Error('Fictional placement refusal'), { code: 'EACCES' })
      fs.linkSync(source, destination)
    }) as typeof fs.linkSync,
  }
  return { ...fs, ...changed, default: { ...fs, ...changed } }
})

let staging: string
let root: string
let to: string
const IMAGE = new Uint8Array([3, 1, 4, 1, 5, 9])
const SHA = createHash('sha512').update(IMAGE).digest('base64')

beforeEach(() => {
  staging = mkdtempSync(join(tmpdir(), 'brocrew-private-stage-'))
  root = mkdtempSync(join(tmpdir(), 'brocrew-owned-download-'))
  to = join(root, 'Fern.dmg')
  Object.assign(disk, {
    plantLinkTo: null,
    stage: null,
    flags: 0,
    mode: undefined,
    failWrite: false,
    failPlacement: false,
    placements: 0,
    holdClose: false,
    releaseClose: null,
  })
})

afterEach(() => {
  rmSync(root, { force: true, recursive: true })
  rmSync(staging, { force: true, recursive: true })
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

it('refuses a link planted at even the fresh stage name without writing or removing it', async () => {
  const other = join(root, 'Brook.txt')
  writeFileSync(other, 'A fictional draft')
  disk.plantLinkTo = other
  await expect(download()).rejects.toMatchObject({ code: expect.stringMatching(/EEXIST|ELOOP/) })
  expect(disk.stage).not.toBeNull()
  expect(lstatSync(disk.stage!).isSymbolicLink()).toBe(true)
  expect(readFileSync(other, 'utf8')).toBe('A fictional draft')
  expect(disk.placements).toBe(0)
})

it('creates a new owner-only stage with an unpredictable name and exclusive flags', async () => {
  await download()
  expect(disk.stage).toMatch(/\.brobot-[a-f0-9]{24}\.partial$/)
  const { constants } = await import('node:fs')
  expect(disk.flags & constants.O_CREAT).toBe(constants.O_CREAT)
  expect(disk.flags & constants.O_EXCL).toBe(constants.O_EXCL)
  if (constants.O_NOFOLLOW !== undefined)
    expect(disk.flags & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW)
  expect(disk.mode).toBe(0o600)
  expect(readdirSync(root)).toEqual(['Fern.dmg'])
})

it('notices a write failure while the response is still waiting, then closes and removes its stage', async () => {
  disk.failWrite = true
  let cancelled = false
  await expect(
    download({
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(IMAGE)
            },
            cancel() {
              cancelled = true
            },
          }),
        ),
    }),
  ).rejects.toMatchObject({ code: 'EIO' })
  expect(cancelled).toBe(true)
  expect(readdirSync(root)).toEqual([])
})

it('cleans its partial file when final placement is refused', async () => {
  disk.failPlacement = true
  await expect(download()).rejects.toMatchObject({ code: 'EACCES' })
  expect(readdirSync(root)).toEqual([])
})

it('does not attempt final placement before the checksum matches', async () => {
  disk.failPlacement = true
  await expect(download({ sha512: 'fictional wrong checksum' })).rejects.toThrow(
    'the download did not match the sha512 its release published',
  )
  expect(disk.placements).toBe(0)
  expect(readdirSync(root)).toEqual([])
})

it('makes no request or stage for an already cancelled download', async () => {
  const cancel = new AbortController()
  cancel.abort()
  const fetch = vi.fn(async () => new Response(IMAGE))
  await expect(download({ signal: cancel.signal, fetch })).rejects.toMatchObject({
    name: 'AbortError',
  })
  expect(fetch).not.toHaveBeenCalled()
  expect(disk.stage).toBeNull()
  expect(readdirSync(root)).toEqual([])
})

it('waits for an aborted writer to close before removing its partial and settling', async () => {
  disk.holdClose = true
  const cancel = new AbortController()
  let settled = false
  const pending = download({
    signal: cancel.signal,
    onPercent: (percent) => {
      if (percent < 100) cancel.abort()
    },
  })
  const observed = pending.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )
  try {
    await vi.waitFor(() => expect(disk.releaseClose).not.toBeNull())
    expect(settled).toBe(false)
    expect(lstatSync(disk.stage!).isFile()).toBe(true)
  } finally {
    disk.releaseClose?.()
  }
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  await observed
  expect(readdirSync(root)).toEqual([])
})
