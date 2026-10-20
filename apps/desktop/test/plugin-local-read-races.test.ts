import { afterEach, describe, expect, it, vi } from 'vitest'
import * as files from 'node:fs/promises'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { readLocalRelease } from '../src/main/plugins/catalogue/local'

vi.mock('node:fs/promises', async (original) => ({ ...(await original<typeof files>()) }))
const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) await files.rm(root, { recursive: true, force: true })
})
async function fixture() {
  const parent = await files.realpath(await files.mkdtemp('/tmp/fictional-local-race-'))
  roots.push(parent)
  const root = join(parent, 'input'),
    outside = join(parent, 'outside')
  await files.mkdir(root, { mode: 0o700 })
  await files.mkdir(outside, { mode: 0o700 })
  await files.mkdir(join(root, 'archives'), { mode: 0o700 })
  await files.writeFile(join(root, 'archives', 'leaf'), 'trusted', { mode: 0o600 })
  await files.writeFile(join(outside, 'leaf'), 'foreign', { mode: 0o600 })
  return { parent, root, outside, leaf: join(root, 'archives', 'leaf') }
}
describe.skipIf(process.platform === 'win32')('local snapshot admission races', () => {
  it('a directory swapped to a symlink for the leaf open cannot redirect the read', async () => {
    const f = await fixture(),
      originalOpen = files.open
    let swapped = false
    vi.spyOn(files, 'open').mockImplementation(async (...args: Parameters<typeof files.open>) => {
      if (args[0] !== f.leaf) return originalOpen(...args)
      fs.renameSync(join(f.root, 'archives'), join(f.root, 'held'))
      fs.symlinkSync(f.outside, join(f.root, 'archives'))
      swapped = true
      try {
        return await originalOpen(...args)
      } finally {
        fs.unlinkSync(join(f.root, 'archives'))
        fs.renameSync(join(f.root, 'held'), join(f.root, 'archives'))
      }
    })
    await expect(readLocalRelease(f.root, ['archives', 'leaf'], 16)).rejects.toThrow()
    expect(swapped).toBe(true)
  })
  it('a leaf replaced by a FIFO after admission refuses without waiting for a writer', async () => {
    const f = await fixture(),
      originalOpen = files.open
    let opened = false
    vi.spyOn(files, 'open').mockImplementation(async (...args: Parameters<typeof files.open>) => {
      if (args[0] !== f.leaf) return originalOpen(...args)
      expect(Number(args[1]) & fs.constants.O_NONBLOCK).not.toBe(0)
      await files.unlink(f.leaf)
      execFileSync('/usr/bin/mkfifo', ['-m', '600', f.leaf])
      opened = true
      return originalOpen(...args)
    })
    await expect(readLocalRelease(f.root, ['archives', 'leaf'], 16)).rejects.toThrow()
    expect(opened).toBe(true)
  })
  it('growth after the admission stat cannot allocate or consume past maximum+1', async () => {
    const f = await fixture(),
      originalOpen = files.open
    const maximum = 8
    let grew = false,
      consumed = 0
    vi.spyOn(files, 'open').mockImplementation(async (...args: Parameters<typeof files.open>) => {
      const handle = await originalOpen(...args)
      if (args[0] !== f.leaf) return handle
      const stat = handle.stat.bind(handle),
        readFile = handle.readFile.bind(handle),
        read = handle.read.bind(handle)
      vi.spyOn(handle, 'stat').mockImplementation(async (...options) => {
        const before = await stat(...options)
        if (!grew) {
          await files.appendFile(f.leaf, Buffer.alloc(128 * 1024))
          grew = true
        }
        return before
      })
      vi.spyOn(handle, 'readFile').mockImplementation(async (...options) => {
        const bytes = await readFile(...options)
        consumed += bytes.length
        return bytes
      })
      vi.spyOn(handle, 'read').mockImplementation(async (...options) => {
        const result = await read(...options)
        consumed += result.bytesRead
        return result
      })
      return handle
    })
    await expect(readLocalRelease(f.root, ['archives', 'leaf'], maximum)).rejects.toThrow()
    expect(grew).toBe(true)
    expect(consumed).toBeLessThanOrEqual(maximum + 1)
  })
})
