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

describe('theme reads follow the regular target that is opened', () => {
  it('reads a replacement assets folder installed before open', async () => {
    const { folder, leaf } = await asset()
    const assets = join(folder, 'assets')
    const saved = join(fixture.outside, 'original-assets')
    const replacement = Buffer.alloc(RED_PNG.length, 0xfa)
    let replaced = false
    const opening = vi.fn(async (path: string, flags: number) => {
      expect(path).toBe(leaf)
      await rename(assets, saved)
      await mkdir(assets)
      await writeFile(leaf, replacement)
      replaced = true
      return THEME_READ_FILES.open(path, flags)
    })
    const files: ThemeReadFiles = { ...THEME_READ_FILES, open: opening }
    expect(await readThemeFile(folder, 'assets/red.png', RED_PNG.length, files)).toEqual({
      ok: true,
      bytes: replacement,
    })
    expect(replaced).toBe(true)
    expect(opening).toHaveBeenCalledTimes(1)
    expect(await readFile(join(saved, 'red.png'))).toEqual(RED_PNG)
  })

  it.each([false, true])(
    'reads the regular file at open despite its identity, replaced=%s',
    async (replaced) => {
      expect(firstId).not.toBe(secondId)
      expect(Number(firstId)).toBe(Number(secondId))
      const { folder, leaf } = await asset()
      const replacement = Buffer.alloc(RED_PNG.length, 0xfa)
      let currentId = firstId
      let swapped = false
      let reading: ReturnType<typeof vi.spyOn> | undefined
      const files: ThemeReadFiles = {
        ...THEME_READ_FILES,
        open: async (path, flags) => {
          if (replaced) {
            await rename(leaf, join(fixture.outside, 'original.png'))
            await writeFile(leaf, replacement)
            currentId = secondId
            swapped = true
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
      expect(await readThemeFile(folder, 'assets/red.png', RED_PNG.length, files)).toEqual({
        ok: true,
        bytes: replaced ? replacement : RED_PNG,
      })
      expect(swapped).toBe(replaced)
      expect(reading).toHaveBeenCalled()
    },
  )

  it.each([false, true])(
    'keeps the opened bytes when the final pathname changes, replaced=%s',
    async (replaced) => {
      const { folder, leaf } = await asset()
      const replacement = Buffer.alloc(RED_PNG.length, 0xfa)
      let swapped = false
      let reading: ReturnType<typeof vi.spyOn> | undefined
      const files: ThemeReadFiles = {
        ...THEME_READ_FILES,
        open: async (path, flags) => {
          const handle = await THEME_READ_FILES.open(path, flags)
          reading = vi.spyOn(handle, 'read')
          if (replaced) {
            await rename(leaf, join(fixture.outside, 'original.png'))
            await writeFile(leaf, replacement)
            swapped = true
          }
          return handle
        },
      }
      expect(await readThemeFile(folder, 'assets/red.png', RED_PNG.length, files)).toEqual({
        ok: true,
        bytes: RED_PNG,
      })
      expect(swapped).toBe(replaced)
      expect(reading).toHaveBeenCalled()
      const bytes: unknown = reading!.mock.calls[0]![0]
      if (!Buffer.isBuffer(bytes)) throw new Error('expected the original real read buffer')
      expect(bytes.subarray(0, RED_PNG.length)).toEqual(RED_PNG)
      expect(await readFile(leaf)).toEqual(replaced ? replacement : RED_PNG)
    },
  )

  it.each([false, true])(
    'reads real bytes despite sub-millisecond metadata changes, changed=%s',
    async (changed) => {
      const { folder } = await asset()
      const nextTime = changed ? firstTime + 100n : firstTime
      expect(Number(firstTime) / 1_000_000).toBe(Number(nextTime) / 1_000_000)
      let readsOfStat = 0
      const files: ThemeReadFiles = {
        ...THEME_READ_FILES,
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
      expect(await readThemeFile(folder, 'assets/red.png', RED_PNG.length, files)).toEqual({
        ok: true,
        bytes: RED_PNG,
      })
      expect(readsOfStat).toBe(2)
    },
  )
})
