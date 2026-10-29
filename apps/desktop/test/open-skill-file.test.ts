import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { constants } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { flushSkillTree } from '../src/main/skills/flush-skill-tree'
import { openWritableSkillFile } from '../src/main/skills/open-skill-file'
import { nodeFs } from '../src/main/recovery/files'
let root: string
let path: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'fictional-skill-handle-'))
  path = join(root, 'skills/recipe-check/SKILL.md')
  await mkdir(join(root, 'skills/recipe-check'), { recursive: true })
  await writeFile(path, 'A fictional recipe.')
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})

it.each([9007199254740993n, 18446744073709551615n])(
  'normalizes the injected native write-handle stat for exact identity %s',
  async (identity) => {
    const originalLstat = nodeFs.lstat
    vi.spyOn(nodeFs, 'lstat').mockImplementation(async (name) => {
      const stats = await originalLstat(name)
      return name === path
        ? {
            ...stats,
            dev: identity.toString(),
            ino: identity.toString(),
            mtimeMs: 1790000000123.456,
          }
        : stats
    })
    const requested: (boolean | undefined)[] = []
    const file = await openWritableSkillFile(root, path, nodeFs, async (name, flags, mode) => {
      const handle = await open(name, flags, mode)
      const originalStat = handle.stat.bind(handle)
      vi.spyOn(handle, 'stat').mockImplementation(async (options) => {
        requested.push(options?.bigint)
        const stats = await originalStat(options)
        return Object.assign(Object.create(Object.getPrototypeOf(stats)), stats, {
          dev: options?.bigint ? identity : Number(identity),
          ino: options?.bigint ? identity : Number(identity),
          mtimeNs: 1790000000123456000n,
          mtimeMs: options?.bigint ? 1790000000123n : 1790000000123.456,
        })
      })
      return handle
    })
    try {
      expect(requested).toEqual([true])
      await file.writeFile('Written through the injected native handle.')
      await file.sync()
    } finally {
      await file.close()
    }
    expect(await readFile(path, 'utf8')).toBe('Written through the injected native handle.')
  },
)

it('passes writable no-follow numeric flags to the OS and obtains actual write/flush access', async () => {
  const seen: (number | string | undefined)[] = []
  const file = await openWritableSkillFile(root, path, nodeFs, async (name, flags, mode) => {
    seen.push(flags)
    return open(name, flags, mode)
  })
  try {
    expect(seen).toHaveLength(1)
    const flags = seen[0] as number
    expect(typeof flags).toBe('number')
    expect(flags & constants.O_RDWR).toBe(constants.O_RDWR)
    if (constants.O_NOFOLLOW) expect(flags & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW)
    await file.writeFile('Another fictional recipe.')
    await expect(file.sync()).resolves.toBeUndefined()
  } finally {
    await file.close()
  }
  expect(await readFile(path, 'utf8')).toBe('Another fictional recipe.')
})
it('refuses a changed descriptor identity before writing or flushing it', async () => {
  const other = join(root, 'other.txt')
  await writeFile(other, 'Different fictional bytes.')
  await expect(
    openWritableSkillFile(root, path, nodeFs, async () => open(other, 'r+')),
  ).rejects.toThrow('Skills could not be read.')
  expect(await readFile(other, 'utf8')).toBe('Different fictional bytes.')
})
it.skipIf(process.platform === 'win32')(
  'rejects a linked file before invoking the OS opener',
  async () => {
    await rm(path)
    const other = join(root, 'other.txt')
    await writeFile(other, 'Fictional outside bytes.')
    await symlink(other, path)
    let opened = false
    await expect(
      openWritableSkillFile(root, path, nodeFs, async (...args) => {
        opened = true
        return open(...args)
      }),
    ).rejects.toThrow()
    expect(opened).toBe(false)
    expect((await lstat(path)).isSymbolicLink()).toBe(true)
  },
)

it('flushes production Windows file handles without using recovery’s read-only no-follow translation', async () => {
  await expect(flushSkillTree(dirname(path), nodeFs, 'win32', root)).resolves.toBeTypeOf('boolean')
  expect(await readFile(path, 'utf8')).toBe('A fictional recipe.')
})
