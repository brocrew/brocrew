import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { THEME_JSON_BYTES } from '../../src/main/themes/files'
import { THEME_FOLDER_LIMIT } from '../../src/main/themes/load'
import { themePictureSampler } from '../../src/main/themes/picture-samples'
import { themeProblem, themeFileSizeProblem, themeSizeProblem } from '../../src/main/themes/words'
import { LIMITS, sniffAsset } from '../../src/shared/themes/assets'
import {
  childTheme,
  createHostFixture,
  putTheme,
  RED_PNG,
  RED_SAMPLES,
  type HostFixture,
} from './host-fixtures'

let fixture: HostFixture
beforeEach(async () => {
  fixture = await createHostFixture()
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fixture.cleanup()
})

describe('theme intake limits and decoder formats', () => {
  it('keeps a breached cap visible and distinguishes known totals from unread tails', () => {
    expect(themeFileSizeProblem('assets/a.png', LIMITS.pictureBytes + 1, LIMITS.pictureBytes)).toBe(
      'assets/a.png is over 4 MB; it can be up to 4 MB.',
    )
    expect(themeFileSizeProblem('theme.json', THEME_JSON_BYTES + 1, THEME_JSON_BYTES)).toBe(
      'theme.json is over 256 KB; it can be up to 256 KB.',
    )
    expect(themeSizeProblem(LIMITS.themeBytes + 1, LIMITS.themeBytes)).toBe(
      'The theme is over 12 MB; it can be up to 12 MB.',
    )
    expect(
      themeFileSizeProblem('assets/a.png', Math.floor(5.29 * 1024 * 1024), LIMITS.pictureBytes),
    ).toBe('assets/a.png is 5.2 MB; it can be up to 4 MB.')
    expect(themeSizeProblem(Math.floor(12.49 * 1024 * 1024), LIMITS.themeBytes)).toBe(
      'The theme is 12.4 MB; it can be up to 12 MB.',
    )
    expect(themeSizeProblem(16 * 1024 * 1024, LIMITS.themeBytes, false)).toBe(
      'The theme is over 12 MB; it can be up to 12 MB.',
    )
  })
  it('names the supplied file and size limit without publishing its bytes', async () => {
    const path = join(fixture.source, 'big.png')
    await writeFile(path, Buffer.alloc(LIMITS.pictureBytes + 1))
    const store = fixture.store({ problem: themeProblem })
    await store.start()
    expect(
      await store.save({ theme: childTheme('big'), assets: [{ name: 'renamed.png', path }] }),
    ).toEqual({
      outcome: 'refused',
      rail: 'theme-too-large',
      problems: [{ at: 'assets[0]', says: `${path} is over 4 MB; it can be up to 4 MB.` }],
    })
    expect(await readdir(fixture.library)).toEqual([])
  })

  it('counts oversized canonical base64 before decoding and rejects malformed large input', async () => {
    const store = fixture.store({ problem: themeProblem })
    await store.start()
    const text = 'A'.repeat(Math.ceil(LIMITS.pictureBytes / 3) * 4 + 4)
    const decoded = vi.spyOn(Buffer, 'from')
    const result = await store.save({
      theme: childTheme('big'),
      assets: [{ name: 'big.png', base64: text }],
    })
    expect(result).toMatchObject({ outcome: 'refused', rail: 'theme-too-large' })
    expect(decoded).not.toHaveBeenCalledWith(text, 'base64')
    const invalid = await store.save({
      theme: childTheme('big'),
      assets: [{ name: 'big.png', base64: `${text.slice(0, -1)}!` }],
    })
    expect(invalid).toMatchObject({
      outcome: 'refused',
      rail: 'theme-invalid',
      problems: [{ says: 'The asset is not valid base64.' }],
    })
    decoded.mockRestore()
    expect(await readdir(fixture.library)).toEqual([])
  })

  it('reports count, font and pixel caps through the size rail', async () => {
    const store = fixture.store({ problem: themeProblem })
    await store.start()
    const files = await store.save({
      theme: childTheme('big'),
      assets: Array.from({ length: LIMITS.files + 1 }, (_, i) => ({
        name: `p${i}.png`,
        base64: RED_PNG.toString('base64'),
      })),
    })
    expect(files).toMatchObject({
      rail: 'theme-too-large',
      problems: [{ says: 'The theme has 65 files; it can have up to 64.' }],
    })
    const font = Buffer.alloc(LIMITS.fontBytes + 1)
    font.write('wOF2')
    expect(
      await store.save({
        theme: childTheme('big'),
        assets: [{ name: 'f.woff2', base64: font.toString('base64') }],
      }),
    ).toMatchObject({
      rail: 'theme-too-large',
      problems: [{ says: 'assets/f.woff2 is over 1 MB; it can be up to 1 MB.' }],
    })
    expect(
      await store.save({
        theme: childTheme('big'),
        assets: Array.from({ length: LIMITS.fonts + 1 }, (_, i) => ({
          name: `f${i}.woff2`,
          base64: Buffer.from('wOF2').toString('base64'),
        })),
      }),
    ).toMatchObject({
      rail: 'theme-too-large',
      problems: [{ says: 'The theme has 5 fonts; it can have up to 4.' }],
    })
    const wide = Buffer.from(RED_PNG)
    wide.writeUInt32BE(LIMITS.picturePixels + 1, 16)
    expect(
      await store.save({
        theme: childTheme('big'),
        assets: [{ name: 'wide.png', base64: wide.toString('base64') }],
      }),
    ).toMatchObject({
      rail: 'theme-too-large',
      problems: [
        { says: 'assets/wide.png is 4097×1 pixels; a picture can be up to 4096 pixels a side.' },
      ],
    })
    expect(await readdir(fixture.library)).toEqual([])
  })

  it('includes JSON in the aggregate budget and stops reading later offered files', async () => {
    const path = join(fixture.source, 'four.png')
    const bytes = Buffer.alloc(LIMITS.pictureBytes)
    RED_PNG.copy(bytes)
    await writeFile(path, bytes)
    const store = fixture.store({ problem: themeProblem })
    await store.start()
    const three = await store.save({
      theme: childTheme('big'),
      assets: Array.from({ length: 3 }, (_, i) => ({ name: `p${i}.png`, path })),
    })
    expect(three).toMatchObject({
      rail: 'theme-too-large',
      problems: [{ says: 'The theme is over 12 MB; it can be up to 12 MB.' }],
    })
    const five = await store.save({
      theme: childTheme('big'),
      assets: [
        ...Array.from({ length: 4 }, (_, i) => ({ name: `p${i}.png`, path })),
        { name: 'never.png', path: join(fixture.source, 'does-not-exist.png') },
      ],
    })
    expect(five).toMatchObject({
      rail: 'theme-too-large',
      problems: [{ says: 'The theme is over 12 MB; it can be up to 12 MB.' }],
    })
    expect(await readdir(fixture.library)).toEqual([])
    const json = await store.save({
      theme: { ...childTheme('big'), description: 'x'.repeat(THEME_JSON_BYTES) },
    })
    expect(json).toMatchObject({
      rail: 'theme-too-large',
      problems: [{ at: 'theme.json', says: 'theme.json is over 256 KB; it can be up to 256 KB.' }],
    })
  })

  it('refuses WebP before sampling, serving or publishing; PNG remains admitted', async () => {
    const bytes = Buffer.alloc(30)
    bytes.write('RIFF', 0)
    bytes.writeUInt32LE(22, 4)
    bytes.write('WEBPVP8X', 8)
    const sample = vi.fn(() => RED_SAMPLES)
    const store = fixture.store({ problem: themeProblem, loader: { sample } })
    await store.start()
    expect(
      await store.save({
        theme: childTheme('bad'),
        assets: [{ name: 'wrong.png', base64: bytes.toString('base64') }],
      }),
    ).toMatchObject({
      rail: 'theme-invalid',
      problems: [
        { at: 'assets/wrong.png', says: "WebP pictures aren't supported yet. Use PNG or JPEG" },
      ],
    })
    expect(sample).not.toHaveBeenCalled()
    expect(store.asset('bad', 'assets/wrong.png')).toBeNull()
    expect(await readdir(fixture.library)).toEqual([])
    const sniffed = sniffAsset(bytes)
    const images = {
      createFromBuffer: vi.fn(() => {
        throw new Error('decoder must not run')
      }),
    }
    if (sniffed.ok) expect(themePictureSampler(images)(bytes, sniffed.facts)).toBeNull()
    expect(images.createFromBuffer).not.toHaveBeenCalled()
    expect(
      await store.save({
        theme: childTheme('good'),
        assets: [{ name: 'good.png', base64: RED_PNG.toString('base64') }],
      }),
    ).toMatchObject({ outcome: 'ok' })
    expect(sample).toHaveBeenCalledTimes(2)
    for (const call of [1, 2])
      expect(sample).toHaveBeenNthCalledWith(
        call,
        RED_PNG,
        expect.objectContaining({ type: 'png', bytes: RED_PNG.length, width: 1, height: 1 }),
      )
  })

  it('admits 513 folders and stops the empty-folder walk before reading the next one', async () => {
    const folder = await putTheme(fixture.library, 'folders', childTheme('folders'))
    const assets = join(folder, 'assets')
    for (let parent = 0; parent < 64; parent++) {
      for (let child = 0; child < 7; child++)
        await mkdir(join(assets, `p${String(parent).padStart(2, '0')}`, `c${child}`), {
          recursive: true,
        })
    }
    const visited: string[] = []
    const store = fixture.store({
      problem: themeProblem,
      loader: {
        sample: () => RED_SAMPLES,
        readDirectory: async (path) => {
          if (path.startsWith(assets)) visited.push(path)
          return (await readdir(path, { withFileTypes: true })).sort((a, b) =>
            a.name.localeCompare(b.name),
          )
        },
      },
    })
    await store.start()
    expect(store.snapshot().themes.find((row) => row.id === 'folders')?.status).toBe('ok')
    expect(visited).toHaveLength(THEME_FOLDER_LIMIT)
    const excess = join(assets, 'p63', 'c7')
    await mkdir(excess)
    visited.length = 0
    await store.refresh()
    expect(store.snapshot().themes.find((row) => row.id === 'folders')).toMatchObject({
      status: 'refused',
      problems: [{ says: 'The theme has too many files or folders.' }],
    })
    expect(visited).toHaveLength(THEME_FOLDER_LIMIT)
    expect(visited).not.toContain(excess)
  })
})
