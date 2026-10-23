import type { BigIntStats, Stats } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readThemeFile, THEME_READ_FILES, type ThemeReadFiles } from '../../src/main/themes/files'
import { childTheme, createHostFixture, putTheme, RED_PNG, type HostFixture } from './host-fixtures'

let fixture: HostFixture
beforeEach(async () => {
  fixture = await createHostFixture()
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fixture.cleanup()
})

const firstId = 9_007_199_254_740_992n
const secondId = firstId + 1n
const firstTime = 1_700_000_000_000_000_000n

// Keep the real descriptor, bytes, size and file kind. Model only the identity and time values
// that a filesystem can supply, returning exactly the representation the caller requested.
function metadata<T extends Stats | BigIntStats>(stats: T, ino: bigint, time = firstTime): T {
  const exact = typeof stats.ino === 'bigint'
  return new Proxy(stats, {
    get(target, field) {
      if (field === 'ino') return exact ? ino : Number(ino)
      if (field === 'mtimeMs' || field === 'ctimeMs')
        return exact ? time / 1_000_000n : Number(time) / 1_000_000
      if (field === 'mtimeNs' || field === 'ctimeNs') return time
      return Reflect.get(target, field, target)
    },
  })
}

async function asset() {
  const folder = await putTheme(fixture.library, 'mine', childTheme('mine'), {
    'assets/red.png': RED_PNG,
  })
  return { folder, leaf: join(folder, 'assets/red.png') }
}

describe('theme file identities retain filesystem precision', () => {
  it('refuses an aliased assets-folder identity at the first pin recheck before any open', async () => {
    const { folder, leaf } = await asset()
    const assets = join(folder, 'assets')
    const saved = join(fixture.outside, 'original-assets')
    let looks = 0
    let currentId = firstId
    let replaced = false
    const opening = vi.fn(THEME_READ_FILES.open)
    const files: ThemeReadFiles = {
      ...THEME_READ_FILES,
      lstat: async (path) => {
        if (path === assets && ++looks === 2) {
          await rename(assets, saved)
          await mkdir(assets)
          await writeFile(leaf, Buffer.alloc(RED_PNG.length, 0xfa))
          currentId = secondId
          replaced = true
        }
        const stats = await THEME_READ_FILES.lstat(path)
        return path === assets ? metadata(stats, currentId) : stats
      },
      open: opening,
    }
    expect(await readThemeFile(folder, 'assets/red.png', RED_PNG.length, files)).toEqual({
      ok: false,
      failure: 'link',
    })
    expect(replaced).toBe(true)
    expect(looks).toBe(2)
    expect(opening).not.toHaveBeenCalled()
    expect(await readFile(join(saved, 'red.png'))).toEqual(RED_PNG)
  })

  it.each([false, true])(
    'pairs an admitted file with a distinct identity before open, replaced=%s',
    async (replaced) => {
      expect(firstId).not.toBe(secondId)
      expect(Number(firstId)).toBe(Number(secondId))
      const { folder, leaf } = await asset()
      let currentId = firstId
      let reading: ReturnType<typeof vi.spyOn> | undefined
      const files: ThemeReadFiles = {
        ...THEME_READ_FILES,
        lstat: async (path) => {
          const stats = await THEME_READ_FILES.lstat(path)
          return path === leaf ? metadata(stats, currentId) : stats
        },
        open: async (path, flags) => {
          if (replaced) {
            await rename(leaf, join(fixture.outside, 'original.png'))
            await writeFile(leaf, Buffer.alloc(RED_PNG.length, 0xfa))
            currentId = secondId
          }
          const handle = await THEME_READ_FILES.open(path, flags)
          const stat = handle.stat.bind(handle)
          vi.spyOn(handle, 'stat').mockImplementation(async (...args) =>
            metadata(await Reflect.apply(stat, handle, args), currentId),
          )
          reading = vi.spyOn(handle, 'read')
          return handle
        },
      }
      const result = await readThemeFile(folder, 'assets/red.png', RED_PNG.length, files)
      if (replaced) {
        expect(result).toEqual({ ok: false, failure: 'changed' })
        expect(reading).not.toHaveBeenCalled()
      } else {
        expect(result).toEqual({ ok: true, bytes: RED_PNG })
        expect(reading).toHaveBeenCalled()
      }
    },
  )

  it.each([false, true])(
    'pairs the pinned final path with a distinct identity after reading, replaced=%s',
    async (replaced) => {
      const { folder, leaf } = await asset()
      let leafStats = 0
      let currentId = firstId
      let reading: ReturnType<typeof vi.spyOn> | undefined
      const files: ThemeReadFiles = {
        ...THEME_READ_FILES,
        lstat: async (path) => {
          if (path === leaf && ++leafStats === 2 && replaced) {
            await rename(leaf, join(fixture.outside, 'original.png'))
            await writeFile(leaf, Buffer.alloc(RED_PNG.length, 0xfa))
            currentId = secondId
          }
          const stats = await THEME_READ_FILES.lstat(path)
          return path === leaf ? metadata(stats, currentId) : stats
        },
        open: async (path, flags) => {
          const handle = await THEME_READ_FILES.open(path, flags)
          const stat = handle.stat.bind(handle)
          vi.spyOn(handle, 'stat').mockImplementation(async (...args) =>
            metadata(await Reflect.apply(stat, handle, args), firstId),
          )
          reading = vi.spyOn(handle, 'read')
          return handle
        },
      }
      expect(await readThemeFile(folder, 'assets/red.png', RED_PNG.length, files)).toEqual(
        replaced ? { ok: false, failure: 'changed' } : { ok: true, bytes: RED_PNG },
      )
      expect(leafStats).toBe(2)
      expect(reading).toHaveBeenCalled()
      const bytes: unknown = reading!.mock.calls[0]![0]
      if (!Buffer.isBuffer(bytes)) throw new Error('expected the original real read buffer')
      expect(bytes.subarray(0, RED_PNG.length)).toEqual(RED_PNG)
    },
  )

  it.each([false, true])(
    'pairs a stable file with sub-millisecond metadata changes, changed=%s',
    async (changed) => {
      const { folder, leaf } = await asset()
      const nextTime = changed ? firstTime + 100n : firstTime
      expect(Number(firstTime) / 1_000_000).toBe(Number(nextTime) / 1_000_000)
      let readsOfStat = 0
      const files: ThemeReadFiles = {
        ...THEME_READ_FILES,
        lstat: async (path) => {
          const stats = await THEME_READ_FILES.lstat(path)
          return path === leaf
            ? metadata(stats, firstId, readsOfStat > 1 ? nextTime : firstTime)
            : stats
        },
        open: async (path, flags) => {
          const handle = await THEME_READ_FILES.open(path, flags)
          const stat = handle.stat.bind(handle)
          vi.spyOn(handle, 'stat').mockImplementation(async (...args) =>
            metadata(
              await Reflect.apply(stat, handle, args),
              firstId,
              ++readsOfStat > 1 ? nextTime : firstTime,
            ),
          )
          return handle
        },
      }
      expect(await readThemeFile(folder, 'assets/red.png', RED_PNG.length, files)).toEqual(
        changed ? { ok: false, failure: 'changed' } : { ok: true, bytes: RED_PNG },
      )
    },
  )
})
