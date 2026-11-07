import { constants } from 'node:fs'
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
  type FileHandle,
} from 'node:fs/promises'
import * as themeFiles from '../../src/main/themes/files'
import { join } from 'node:path'
import type {
  IpcMain,
  IpcMainInvokeEvent,
  IpcRenderer,
  IpcRendererEvent,
  NativeImage,
  Protocol,
} from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installThemeProtocol,
  themeAssetResponse,
  THEME_SCHEME_PRIVILEGES,
} from '../../src/main/themes/asset-protocol'
import {
  readOfferedThemeAsset,
  readThemeFile,
  THEME_READ_FILES,
  type ThemeReadFiles,
} from '../../src/main/themes/files'
import { registerThemeIpc } from '../../src/main/themes/ipc'
import { themePictureSampler, type ThemeImages } from '../../src/main/themes/picture-samples'
import { themesBridge } from '../../src/preload/themes'
import { THEMES_CHANNELS, type ThemeChanged } from '../../src/shared/theme-library'
import { LIMITS, type AssetFacts } from '../../src/shared/themes/assets'
import { themeAssetUrl } from '../../src/shared/themes/css'
import { assetOwner } from '../../src/shared/themes/theme'
import {
  childTheme,
  createHostFixture,
  picturedBase,
  putTheme,
  RED_PNG,
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

describe('theme asset registry and scheme', () => {
  it('serves ordinary admitted bytes and inherited assets using the built-in owner', async () => {
    await putTheme(fixture.builtIns, 'defined', picturedBase, { 'assets/red.png': RED_PNG })
    await putTheme(fixture.library, 'mine', childTheme('mine'), { 'assets/own.jpg': RED_PNG })
    // Its base draws a picture with an effect, a setting the window doesn't paint yet.
    const store = fixture.store({ loader: { sample: () => true, readsHeld: true } })
    await store.start()
    const own = store.asset('mine', 'assets/own.jpg')
    expect(own).not.toBeNull()
    if (!own) throw new Error('expected fictional asset')
    const read = vi.fn(readThemeFile)
    expect(
      await themeAssetResponse(themeAssetUrl('mine', own.path, own.version), store, read),
    ).toEqual({ bytes: RED_PNG, contentType: 'image/png' })
    expect(read).toHaveBeenCalledWith(own.root, own.path, LIMITS.pictureBytes)
    const reading = store.reading('mine')
    if (!('theme' in reading)) throw new Error('expected fictional reading')
    const effect = reading.theme?.effects?.[0]
    if (!effect || !('image' in effect)) throw new Error('expected inherited image')
    const owner = assetOwner(effect.image, 'mine')
    expect(owner).toEqual({ id: 'defined', path: 'assets/red.png' })
    expect(
      await themeAssetResponse(
        themeAssetUrl(owner.id, owner.path, reading.assetVersions[owner.id]),
        store,
      ),
    ).toEqual({ bytes: RED_PNG, contentType: 'image/png' })
  })

  it('rejects unknown, malformed, traversal, nonmember and stale URLs before any read callback', async () => {
    await putTheme(fixture.library, 'mine', childTheme('mine'), { 'assets/red.png': RED_PNG })
    await putTheme(
      fixture.library,
      'refused',
      { id: 'refused', format: 99 },
      { 'assets/red.png': RED_PNG },
    )
    const store = fixture.store()
    await store.start()
    await writeFile(join(fixture.library, 'mine', 'assets/unlisted.png'), RED_PNG)
    const read = vi.fn(readThemeFile)
    const urls = [
      'brobot-theme://missing/assets/red.png',
      'brobot-theme://refused/assets/red.png',
      'brobot-theme://mine/assets/unlisted.png',
      'brobot-theme://mine/theme.json',
      'brobot-theme://mine/assets/../theme.json',
      'brobot-theme://mine/assets/%2e%2e/red.png',
      'brobot-theme://mine/assets/%00.png',
      'brobot-theme://mine/assets/%ZZ.png',
      'brobot-theme://mine/assets/%5cred.png',
      'brobot-theme://mine/assets/red.png#fragment',
      'brobot-theme://mine/assets/red.png?v=bad',
      `brobot-theme://mine/assets/red.png?v=${'0'.repeat(64)}&other=1`,
      'brobot-theme://mine:80/assets/red.png',
      'brobot-theme://other@mine/assets/red.png',
      'https://mine/assets/red.png',
      'brobot-theme://MINE/assets/red.png',
    ]
    const admitted = store.asset('mine', 'assets/red.png')!
    const stale = admitted.version === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64)
    urls.push(themeAssetUrl('mine', 'assets/red.png', stale))
    for (const url of urls) {
      expect(await themeAssetResponse(url, store, read), url).toBeNull()
      expect(read, url).not.toHaveBeenCalled()
    }
    expect(
      await themeAssetResponse(
        themeAssetUrl('mine', 'assets/red.png', admitted.version),
        store,
        read,
      ),
    ).not.toBeNull()
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('serves a valid edited picture with different content and length after admission', async () => {
    const folder = await putTheme(fixture.library, 'mine', childTheme('mine'), {
      'assets/red.png': RED_PNG,
    })
    const store = fixture.store()
    await store.start()
    const url = themeAssetUrl('mine', 'assets/red.png')
    expect(await themeAssetResponse(url, store)).toEqual({
      bytes: RED_PNG,
      contentType: 'image/png',
    })
    const changed = await readFile(
      new URL('../../resources/themes/crew-night/assets/logo.png', import.meta.url),
    )
    expect(changed).not.toEqual(RED_PNG)
    expect(changed.length).not.toBe(RED_PNG.length)
    await writeFile(join(folder, 'assets/red.png'), changed)
    expect(await themeAssetResponse(url, store)).toEqual({
      bytes: changed,
      contentType: 'image/png',
    })
  })

  it('loads and remixes a valid saved picture after its content and length change', async () => {
    const folder = await putTheme(fixture.library, 'mine', childTheme('mine'), {
      'assets/red.png': RED_PNG,
    })
    const store = fixture.store()
    await store.start()
    const changed = await readFile(
      new URL('../../resources/themes/crew-night/assets/logo.png', import.meta.url),
    )
    expect(changed.length).not.toBe(RED_PNG.length)
    await writeFile(join(folder, 'assets/red.png'), changed)
    const duplicated = await store.duplicate('mine', 'New picture')
    expect(duplicated).toMatchObject({ outcome: 'ok' })
    if (duplicated.outcome !== 'ok') throw new Error('remix failed')
    expect(await readFile(join(fixture.library, duplicated.id, 'assets/red.png'))).toEqual(changed)
  })

  it.each(['ENOENT', 'EACCES'])(
    'a remix reports the actual %s asset path and cause',
    async (code) => {
      const folder = await putTheme(fixture.library, 'mine', childTheme('mine'), {
        'assets/red.png': RED_PNG,
      })
      const store = fixture.store()
      await store.start()
      const path = join(folder, 'assets/red.png')
      vi.spyOn(store as unknown as { reload(): Promise<void> }, 'reload').mockResolvedValueOnce()
      if (code === 'ENOENT') await rm(path)
      else
        vi.spyOn(themeFiles, 'readThemeFile').mockResolvedValueOnce({
          ok: false,
          failure: 'unreadable',
          cause: Object.assign(new Error(`${code}: permission denied, open '${path}'`), { code }),
        })
      const reply = await store.duplicate('mine', 'Copy')
      expect(reply).toMatchObject({
        outcome: 'refused',
        problems: [expect.objectContaining({ at: path, says: expect.stringContaining(code) })],
      })
    },
  )

  it('names a missing or denied picture and preserves its system cause', async () => {
    const folder = await putTheme(fixture.library, 'mine', childTheme('mine'), {
      'assets/red.png': RED_PNG,
    })
    const store = fixture.store()
    await store.start()
    const path = join(folder, 'assets/red.png')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await rm(path)
    expect(await themeAssetResponse(themeAssetUrl('mine', 'assets/red.png'), store)).toBeNull()
    expect(warning).toHaveBeenLastCalledWith(
      expect.stringContaining(path),
      expect.objectContaining({ code: 'ENOENT' }),
    )
    await writeFile(path, RED_PNG)
    const denied = Object.assign(new Error(`EACCES: permission denied, open '${path}'`), {
      code: 'EACCES',
    })
    const read = (root: string, file: string, maximum: number) =>
      readThemeFile(root, file, maximum, {
        ...THEME_READ_FILES,
        open: async () => {
          throw denied
        },
      })
    expect(
      await themeAssetResponse(themeAssetUrl('mine', 'assets/red.png'), store, read),
    ).toBeNull()
    expect(warning).toHaveBeenLastCalledWith(expect.stringContaining(path), denied)
  })

  it('keeps genuine format and maximum-size bounds for edited pictures', async () => {
    const folder = await putTheme(fixture.library, 'mine', childTheme('mine'), {
      'assets/red.png': RED_PNG,
    })
    const store = fixture.store()
    await store.start()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await writeFile(join(folder, 'assets/red.png'), 'not a picture')
    expect(await themeAssetResponse(themeAssetUrl('mine', 'assets/red.png'), store)).toBeNull()
    await writeFile(join(folder, 'assets/red.png'), Buffer.alloc(LIMITS.pictureBytes + 1))
    expect(await themeAssetResponse(themeAssetUrl('mine', 'assets/red.png'), store)).toBeNull()
  })

  it('retains the unrelated theme leaf-link policy', async () => {
    const folder = await putTheme(fixture.library, 'mine', childTheme('mine'), {
      'assets/red.png': RED_PNG,
    })
    const store = fixture.store()
    await store.start()
    const outside = join(fixture.outside, 'red.png')
    await writeFile(outside, RED_PNG)
    await rm(join(folder, 'assets/red.png'))
    await symlink(outside, join(folder, 'assets/red.png'))
    expect(await themeAssetResponse(themeAssetUrl('mine', 'assets/red.png'), store)).toBeNull()
    expect(await readFile(outside)).toEqual(RED_PNG)
  })

  it('refuses a linked parent substituted after asset admission', async () => {
    const folder = await putTheme(fixture.library, 'mine', childTheme('mine'), {
      'assets/red.png': RED_PNG,
    })
    const store = fixture.store()
    await store.start()
    await rename(join(folder, 'assets'), join(fixture.outside, 'saved-assets'))
    await symlink(join(fixture.outside, 'saved-assets'), join(folder, 'assets'), 'dir')
    expect(await themeAssetResponse(themeAssetUrl('mine', 'assets/red.png'), store)).toBeNull()
  })

  it('registers secure privileges and sends validated MIME, length and nosniff for GET and HEAD', async () => {
    await putTheme(fixture.library, 'mine', childTheme('mine'), { 'assets/misnamed.jpg': RED_PNG })
    const store = fixture.store()
    await store.start()
    let handler: Parameters<Protocol['handle']>[1] | undefined
    const protocol: Pick<Protocol, 'handle'> = {
      handle: (_scheme, callback) => {
        expect(_scheme).toBe('brobot-theme')
        handler = callback
      },
    }
    installThemeProtocol(protocol, store)
    expect(THEME_SCHEME_PRIVILEGES).toEqual({
      scheme: 'brobot-theme',
      privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: false },
    })
    if (!handler) throw new Error('expected fictional protocol handler')
    const url = themeAssetUrl('mine', 'assets/misnamed.jpg')
    const get = await handler(new Request(url))
    expect(get.status).toBe(200)
    expect(get.headers.get('content-type')).toBe('image/png')
    expect(get.headers.get('content-length')).toBe(String(RED_PNG.length))
    expect(get.headers.get('x-content-type-options')).toBe('nosniff')
    expect(get.headers.get('cache-control')).toBe('no-store')
    expect(Buffer.from(await get.arrayBuffer())).toEqual(RED_PNG)
    const head = await handler(new Request(url, { method: 'HEAD' }))
    expect(head.status).toBe(200)
    expect(head.headers.get('content-type')).toBe('image/png')
    expect((await head.arrayBuffer()).byteLength).toBe(0)
    expect((await handler(new Request(url, { method: 'POST' }))).status).toBe(405)
    expect((await handler(new Request(themeAssetUrl('missing', 'assets/red.png')))).status).toBe(
      404,
    )
  })
})

describe('bounded real theme file reads', () => {
  it('pairs ordinary reads with traversal, root-prefix sibling, size and nonregular refusal', async () => {
    const folder = await putTheme(fixture.library, 'mine', childTheme('mine'), {
      'assets/red.png': RED_PNG,
    })
    await mkdir(join(fixture.library, 'mine-other'))
    await writeFile(join(fixture.library, 'mine-other', 'red.png'), RED_PNG)
    await writeFile(join(fixture.outside, 'red.png'), RED_PNG)
    expect(await readThemeFile(folder, 'assets/red.png', RED_PNG.length)).toEqual({
      ok: true,
      bytes: RED_PNG,
    })
    expect(await readThemeFile(folder, '../mine-other/red.png', 1024)).toEqual({
      ok: false,
      failure: 'outside',
    })
    expect(await readThemeFile(folder, join(fixture.outside, 'red.png'), 1024)).toEqual({
      ok: false,
      failure: 'outside',
    })
    expect(await readThemeFile(folder, 'assets/red.png', RED_PNG.length - 1)).toEqual({
      ok: false,
      failure: 'too-large',
      size: RED_PNG.length,
      maximum: RED_PNG.length - 1,
    })
    expect((await readThemeFile(folder, 'assets', 1024)).ok).toBe(false)
    expect(await readOfferedThemeAsset(join(folder, 'assets/red.png'), RED_PNG.length)).toEqual({
      ok: true,
      bytes: RED_PNG,
    })
    expect(await readOfferedThemeAsset('relative.png', 1024)).toEqual({
      ok: false,
      failure: 'outside',
    })
  })

  it('refuses linked roots, intermediate folders and leaves while leaving outside bytes intact', async () => {
    const folder = await putTheme(fixture.library, 'mine', childTheme('mine'), {
      'assets/red.png': RED_PNG,
    })
    const outside = join(fixture.outside, 'red.png')
    await writeFile(outside, RED_PNG)
    const linkedRoot = join(fixture.root, 'linked-root')
    await symlink(folder, linkedRoot, 'dir')
    expect((await readThemeFile(linkedRoot, 'assets/red.png', 1024)).ok).toBe(false)
    await symlink(fixture.outside, join(folder, 'assets/linked'), 'dir')
    expect((await readThemeFile(folder, 'assets/linked/red.png', 1024)).ok).toBe(false)
    await symlink(outside, join(folder, 'assets/leaf.png'))
    expect((await readThemeFile(folder, 'assets/leaf.png', 1024)).ok).toBe(false)
    expect(await readOfferedThemeAsset(join(folder, 'assets/leaf.png'), 1024)).toEqual({
      ok: false,
      failure: 'link',
    })
    expect(await readFile(outside)).toEqual(RED_PNG)
    await mkdir(join(folder, 'assets/directory.png'))
    expect((await readOfferedThemeAsset(join(folder, 'assets/directory.png'), 1024)).ok).toBe(false)
  })
})

function observeHandle(handle: FileHandle) {
  return { handle, read: vi.spyOn(handle, 'read'), close: vi.spyOn(handle, 'close') }
}

async function closedHandle(observation: ReturnType<typeof observeHandle>): Promise<void> {
  expect(observation.close).toHaveBeenCalledTimes(1)
  expect(observation.handle.fd).toBe(-1)
  await expect(observation.handle.stat()).rejects.toMatchObject({ code: 'EBADF' })
}

describe('theme file changes at real filesystem boundaries', () => {
  it.each(['theme', 'offered'] as const)(
    'pairs the %s read seam with an ordinary bounded read and closed real descriptor',
    async (entrypoint) => {
      const folder = await putTheme(fixture.library, 'mine', childTheme('mine'), {
        'assets/red.png': RED_PNG,
      })
      const observations: ReturnType<typeof observeHandle>[] = []
      const files: ThemeReadFiles = {
        ...THEME_READ_FILES,
        open: async (path, flags) => {
          expect(flags & (constants.O_NOFOLLOW ?? 0)).toBe(constants.O_NOFOLLOW ?? 0)
          const handle = await THEME_READ_FILES.open(path, flags)
          observations.push(observeHandle(handle))
          return handle
        },
      }
      const result =
        entrypoint === 'theme'
          ? await readThemeFile(folder, 'assets/red.png', RED_PNG.length, files)
          : await readOfferedThemeAsset(join(folder, 'assets/red.png'), RED_PNG.length, files)
      expect(result).toEqual({ ok: true, bytes: RED_PNG })
      expect(observations).toHaveLength(1)
      const observation = observations[0]!
      expect(observation.read).toHaveBeenCalled()
      for (const call of observation.read.mock.calls) {
        const buffer: unknown = call[0]
        expect(Buffer.isBuffer(buffer)).toBe(true)
        if (!Buffer.isBuffer(buffer)) throw new Error('expected real read buffer')
        expect(buffer.length).toBe(RED_PNG.length + 1)
      }
      await closedHandle(observation)
    },
  )

  it.each(['leaf', 'parent'] as const)(
    'rejects a %s inode swap immediately before open without reading the replacement',
    async (kind) => {
      const folder = await putTheme(fixture.library, 'mine', childTheme('mine'), {
        'assets/red.png': RED_PNG,
      })
      const leaf = join(folder, 'assets/red.png')
      const foreign = Buffer.alloc(RED_PNG.length, 0xfa)
      await writeFile(join(fixture.outside, 'red.png'), foreign)
      const observations: ReturnType<typeof observeHandle>[] = []
      let swapped = false
      const files: ThemeReadFiles = {
        ...THEME_READ_FILES,
        open: async (path, flags) => {
          expect(path).toBe(leaf)
          if (kind === 'leaf') {
            await rename(leaf, join(fixture.outside, 'original.png'))
            await writeFile(leaf, foreign)
          } else {
            await rename(join(folder, 'assets'), join(fixture.outside, 'original-assets'))
            await symlink(fixture.outside, join(folder, 'assets'), 'dir')
          }
          swapped = true
          const handle = await THEME_READ_FILES.open(path, flags)
          observations.push(observeHandle(handle))
          return handle
        },
      }
      expect(await readThemeFile(folder, 'assets/red.png', RED_PNG.length, files)).toEqual({
        ok: false,
        failure: 'changed',
      })
      expect(swapped).toBe(true)
      expect(observations).toHaveLength(1)
      expect(observations[0]!.read).not.toHaveBeenCalled()
      await closedHandle(observations[0]!)
      expect(await readFile(join(fixture.outside, 'red.png'))).toEqual(foreign)
    },
  )

  it('refuses a leaf symlink installed between lstat and no-follow open', async () => {
    const folder = await putTheme(fixture.library, 'mine', childTheme('mine'), {
      'assets/red.png': RED_PNG,
    })
    const leaf = join(folder, 'assets/red.png')
    const foreign = join(fixture.outside, 'foreign.png')
    await writeFile(foreign, Buffer.alloc(RED_PNG.length, 0xfa))
    const observations: ReturnType<typeof observeHandle>[] = []
    let attempted = false
    const files: ThemeReadFiles = {
      ...THEME_READ_FILES,
      open: async (path, flags) => {
        await rename(leaf, join(fixture.outside, 'original.png'))
        await symlink(foreign, leaf)
        attempted = true
        expect(flags & (constants.O_NOFOLLOW ?? 0)).toBe(constants.O_NOFOLLOW ?? 0)
        const handle = await THEME_READ_FILES.open(path, flags)
        observations.push(observeHandle(handle))
        return handle
      },
    }
    expect((await readThemeFile(folder, 'assets/red.png', RED_PNG.length, files)).ok).toBe(false)
    expect(attempted).toBe(true)
    // Windows has no O_NOFOLLOW; the opened target must still be refused before any read.
    expect(observations).toHaveLength(process.platform === 'win32' ? 1 : 0)
    for (const observed of observations) {
      expect(observed.read).not.toHaveBeenCalled()
      await closedHandle(observed)
    }
  })

  // Windows prevents renaming an ancestor of an open file.
  it.skipIf(process.platform === 'win32')(
    'rechecks pinned parent identity after opening the original descriptor, before reading',
    async () => {
      const folder = await putTheme(fixture.library, 'mine', childTheme('mine'), {
        'assets/red.png': RED_PNG,
      })
      const observations: ReturnType<typeof observeHandle>[] = []
      const files: ThemeReadFiles = {
        ...THEME_READ_FILES,
        open: async (path, flags) => {
          const handle = await THEME_READ_FILES.open(path, flags)
          observations.push(observeHandle(handle))
          await rename(join(folder, 'assets'), join(fixture.outside, 'original-assets'))
          await mkdir(join(folder, 'assets'))
          await writeFile(join(folder, 'assets/red.png'), Buffer.alloc(RED_PNG.length, 0xfa))
          return handle
        },
      }
      expect(await readThemeFile(folder, 'assets/red.png', RED_PNG.length, files)).toEqual({
        ok: false,
        failure: 'changed',
      })
      expect(observations).toHaveLength(1)
      expect(observations[0]!.read).not.toHaveBeenCalled()
      await closedHandle(observations[0]!)
    },
  )

  it('rejects a changed final pathname after reading only the pinned original bytes', async () => {
    const folder = await putTheme(fixture.library, 'mine', childTheme('mine'), {
      'assets/red.png': RED_PNG,
    })
    const leaf = join(folder, 'assets/red.png')
    const observations: ReturnType<typeof observeHandle>[] = []
    let leafStats = 0
    const files: ThemeReadFiles = {
      ...THEME_READ_FILES,
      lstat: async (path) => {
        if (path === leaf && ++leafStats === 2) {
          await rename(leaf, join(fixture.outside, 'original.png'))
          await writeFile(leaf, Buffer.alloc(RED_PNG.length, 0xfa))
        }
        return THEME_READ_FILES.lstat(path)
      },
      open: async (path, flags) => {
        const handle = await THEME_READ_FILES.open(path, flags)
        observations.push(observeHandle(handle))
        return handle
      },
    }
    expect(await readThemeFile(folder, 'assets/red.png', RED_PNG.length, files)).toEqual({
      ok: false,
      failure: 'changed',
    })
    expect(leafStats).toBe(2)
    const observation = observations[0]!
    expect(observation.read).toHaveBeenCalled()
    const buffer: unknown = observation.read.mock.calls[0]![0]
    if (!Buffer.isBuffer(buffer)) throw new Error('expected real read buffer')
    expect(buffer.subarray(0, RED_PNG.length)).toEqual(RED_PNG)
    await closedHandle(observation)
  })

  it('bounds growth after descriptor stat and refuses without returning partial bytes', async () => {
    const folder = await putTheme(fixture.library, 'mine', childTheme('mine'), {
      'assets/red.png': RED_PNG,
    })
    const observations: ReturnType<typeof observeHandle>[] = []
    let opened = false
    let grew = false
    const files: ThemeReadFiles = {
      ...THEME_READ_FILES,
      open: async (path, flags) => {
        const handle = await THEME_READ_FILES.open(path, flags)
        observations.push(observeHandle(handle))
        opened = true
        return handle
      },
      lstat: async (path) => {
        if (opened && !grew && path === join(folder, 'assets')) {
          await appendFile(join(folder, 'assets/red.png'), Buffer.alloc(1_024, 0xfa))
          grew = true
        }
        return THEME_READ_FILES.lstat(path)
      },
    }
    expect(await readThemeFile(folder, 'assets/red.png', RED_PNG.length, files)).toEqual({
      ok: false,
      failure: 'too-large',
      size: RED_PNG.length + 1_024,
      maximum: RED_PNG.length,
    })
    expect(grew).toBe(true)
    const observation = observations[0]!
    const buffer: unknown = observation.read.mock.calls[0]![0]
    if (!Buffer.isBuffer(buffer)) throw new Error('expected real read buffer')
    expect(buffer.length).toBe(RED_PNG.length + 1)
    await closedHandle(observation)
  })
})

type ThemeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

function fictionalIpc() {
  const handlers = new Map<string, ThemeHandler>()
  const listeners = new Set<(event: IpcRendererEvent, snapshot: ThemeChanged) => void>()
  const invocations: { channel: string; args: unknown[] }[] = []
  const removed: string[] = []
  const main: Pick<IpcMain, 'handle' | 'removeHandler' | 'on' | 'removeListener'> = {
    on: () => main as IpcMain,
    removeListener: () => main as IpcMain,
    handle: (channel, handler) => {
      handlers.set(channel, handler)
    },
    removeHandler: (channel) => {
      handlers.delete(channel)
      removed.push(channel)
    },
  }
  const renderer: Pick<IpcRenderer, 'invoke' | 'on' | 'off'> = {
    invoke: async (channel, ...args: unknown[]) => {
      invocations.push({ channel, args })
      const handler = handlers.get(channel)
      if (!handler) throw new Error('missing fictional IPC handler')
      return handler({} as IpcMainInvokeEvent, ...args)
    },
    on: (channel, listener) => {
      expect(channel).toBe(THEMES_CHANNELS.changed)
      listeners.add(listener)
      return renderer as IpcRenderer
    },
    off: (channel, listener) => {
      expect(channel).toBe(THEMES_CHANNELS.changed)
      listeners.delete(listener)
      return renderer as IpcRenderer
    },
  }
  const broadcast = vi.fn((snapshot: ThemeChanged) => {
    for (const listener of listeners) listener({} as IpcRendererEvent, snapshot)
  })
  return { main, renderer, handlers, listeners, invocations, removed, broadcast }
}

describe('theme IPC and preload facade', () => {
  it('invokes the actual handlers and frozen bridge, forwards changes and unsubscribes both sides', async () => {
    await putTheme(fixture.library, 'mine', childTheme('mine'))
    const opened: string[] = []
    const store = fixture.store({
      openFolder: async (path) => {
        opened.push(path)
      },
    })
    await store.start()
    const ipc = fictionalIpc()
    const dispose = registerThemeIpc(ipc.main, store, ipc.broadcast)
    const bridge = themesBridge(ipc.renderer)
    expect(Object.isFrozen(bridge)).toBe(true)
    const snapshot = await bridge.list()
    expect(structuredClone(snapshot)).toEqual(snapshot)
    expect(await bridge.read()).toMatchObject({ active: 'defined', theme: { id: 'defined' } })
    expect(await bridge.read('mine')).toMatchObject({ theme: { id: 'mine' } })
    const changed = vi.fn()
    const unsubscribe = bridge.onChanged(changed)
    try {
      expect(await bridge.set('mine')).toEqual({
        outcome: 'ok',
        active: 'mine',
        previous: 'defined',
      })
      expect(changed).toHaveBeenCalledWith(
        expect.objectContaining({ active: 'mine', previous: 'defined' }),
      )
      expect(await bridge.duplicate('mine', 'Copied')).toMatchObject({
        outcome: 'ok',
        id: 'copied',
      })
      expect(store.raw('copied')).not.toBeNull()
      expect(await bridge.delete('copied')).toMatchObject({ outcome: 'ok', id: 'copied' })
      expect(store.raw('copied')).toBeNull()
      expect(await bridge.openFolder()).toEqual({ outcome: 'ok' })
      expect(opened).toEqual([fixture.library])
      expect(ipc.invocations).toEqual([
        { channel: THEMES_CHANNELS.list, args: [] },
        { channel: THEMES_CHANNELS.read, args: [undefined] },
        { channel: THEMES_CHANNELS.read, args: ['mine'] },
        { channel: THEMES_CHANNELS.set, args: ['mine'] },
        { channel: THEMES_CHANNELS.duplicate, args: ['mine', 'Copied'] },
        { channel: THEMES_CHANNELS.delete, args: ['copied'] },
        { channel: THEMES_CHANNELS.openFolder, args: [] },
      ])
      const count = changed.mock.calls.length
      unsubscribe()
      expect(ipc.listeners.size).toBe(0)
      expect(await bridge.set('defined')).toMatchObject({ outcome: 'ok' })
      expect(changed).toHaveBeenCalledTimes(count)
    } finally {
      unsubscribe()
      dispose()
    }
    expect(ipc.handlers.size).toBe(0)
    expect(ipc.removed.sort()).toEqual(
      Object.values(THEMES_CHANNELS)
        .filter((channel) => channel !== THEMES_CHANNELS.changed)
        .sort(),
    )
    const broadcasts = ipc.broadcast.mock.calls.length
    expect(await store.set('mine')).toMatchObject({ outcome: 'ok' })
    expect(ipc.broadcast).toHaveBeenCalledTimes(broadcasts)
  })

  it('picker previews reuse the listed registry while ordinary reads still refresh it', async () => {
    await putTheme(fixture.library, 'mine', childTheme('mine', 'Before'))
    const store = fixture.store()
    await store.start()
    const refresh = vi.spyOn(store, 'refresh')
    const ipc = fictionalIpc()
    const dispose = registerThemeIpc(ipc.main, store, ipc.broadcast)
    const bridge = themesBridge(ipc.renderer)
    try {
      await bridge.list()
      expect(refresh).toHaveBeenCalledTimes(1)
      await putTheme(fixture.library, 'mine', childTheme('mine', 'After'))
      for (let i = 0; i < 5; i++) {
        expect(await bridge.read('mine', { refresh: false })).toMatchObject({
          theme: { name: 'Before' },
        })
      }
      expect(refresh).toHaveBeenCalledTimes(1)
      expect(await bridge.read('mine')).toMatchObject({ theme: { name: 'After' } })
      expect(refresh).toHaveBeenCalledTimes(2)
      for (const options of [null, false, [], {}, { refresh: true }, 'cached']) {
        expect(await ipc.renderer.invoke(THEMES_CHANNELS.read, 'mine', options)).toMatchObject({
          outcome: 'refused',
          rail: 'theme-invalid',
        })
      }
      expect(refresh).toHaveBeenCalledTimes(2)
    } finally {
      dispose()
    }
  })

  it('refuses invalid IPC ids and duplicate names before store actions', async () => {
    await putTheme(fixture.library, 'mine', childTheme('mine'))
    const store = fixture.store()
    await store.start()
    const set = vi.spyOn(store, 'set')
    const duplicate = vi.spyOn(store, 'duplicate')
    const remove = vi.spyOn(store, 'delete')
    const refresh = vi.spyOn(store, 'refresh')
    const ipc = fictionalIpc()
    const dispose = registerThemeIpc(ipc.main, store, ipc.broadcast)
    try {
      for (const id of ['../mine', '', 'MINE', null, 17, { id: 'mine' }]) {
        for (const channel of [
          THEMES_CHANNELS.read,
          THEMES_CHANNELS.set,
          THEMES_CHANNELS.delete,
          THEMES_CHANNELS.duplicate,
        ]) {
          expect(await ipc.renderer.invoke(channel, id, 'Copied')).toEqual({
            outcome: 'refused',
            rail: 'theme-invalid',
            problems: [],
          })
        }
      }
      expect(
        await ipc.renderer.invoke(THEMES_CHANNELS.duplicate, 'mine', { name: 'Copied' }),
      ).toMatchObject({ outcome: 'refused' })
      for (const action of [set, duplicate, remove, refresh]) expect(action).not.toHaveBeenCalled()
      expect(store.snapshot().active).toBe('defined')
      expect(store.raw('mine')).not.toBeNull()
    } finally {
      dispose()
    }
  })
})

function fakeImages(
  options: {
    width?: number
    height?: number
    empty?: boolean
  } = {},
) {
  const width = options.width ?? 1
  const height = options.height ?? 1
  const images: ThemeImages = {
    createFromBuffer: vi.fn(() => {
      return {
        isEmpty: () => options.empty === true,
        getSize: () => ({ width, height }),
      } as NativeImage
    }),
  }
  return { images }
}

const pngFacts = (width = 1, height = 1): AssetFacts => ({
  type: 'png',
  bytes: RED_PNG.length,
  width,
  height,
  animated: false,
})

describe('native picture validation', () => {
  it('decodes the offered bytes and checks their dimensions', () => {
    const fake = fakeImages({ width: 64, height: 32 })
    expect(themePictureSampler(fake.images)(RED_PNG, pngFacts(64, 32))).toBe(true)
    expect(fake.images.createFromBuffer).toHaveBeenCalledExactlyOnceWith(RED_PNG)
  })

  it('refuses when the image facade throws', () => {
    const images: ThemeImages = {
      createFromBuffer: () => {
        throw new Error('fictional image failure')
      },
    }
    expect(themePictureSampler(images)(RED_PNG, pngFacts())).toBe(false)
  })

  it.each(['empty', 'dimensions', 'pixels', 'bytes', 'font'] as const)('refuses %s', (kind) => {
    const fake = fakeImages(
      kind === 'empty' ? { empty: true } : kind === 'dimensions' ? { width: 2 } : {},
    )
    const sample = themePictureSampler(fake.images)
    const facts: AssetFacts =
      kind === 'pixels'
        ? pngFacts(LIMITS.picturePixels + 1, 1)
        : kind === 'font'
          ? { type: 'woff2', bytes: 4 }
          : pngFacts()
    const bytes = kind === 'bytes' ? Buffer.alloc(LIMITS.pictureBytes + 1) : RED_PNG
    expect(sample(bytes, facts)).toBe(false)
  })
})
