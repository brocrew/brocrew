import { lstat, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { THEME_JSON_BYTES } from '../../src/main/themes/files'
import { CLASSIC_THEME } from '../../src/main/themes/defaults'
import {
  ACTIVE_THEME_FILE,
  themeRoots,
  themeWriteLock,
  writeActiveTheme,
} from '../../src/main/themes/state'
import { LIMITS } from '../../src/shared/themes/assets'
import type { ThemeSaveInput } from '../../src/shared/theme-library'
import { DEFINED } from './fixtures'
import {
  childTheme,
  createHostFixture,
  picturedBase,
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
  vi.useRealTimers()
  vi.restoreAllMocks()
  await fixture.cleanup()
})

async function cleanLibrary(): Promise<void> {
  expect((await readdir(fixture.library)).filter((name) => name.startsWith('.theme-'))).toEqual([])
}

describe('theme registry and workspace choices', () => {
  it('admits valid themes, preserves built-in asset ownership and reports refused folders', async () => {
    await putTheme(fixture.builtIns, 'defined', picturedBase, { 'assets/red.png': RED_PNG })
    await putTheme(fixture.library, 'mine', childTheme('mine'))
    await putTheme(fixture.library, 'broken', { format: 1, id: 'wrong', name: 'Broken' })
    await putTheme(fixture.library, 'defined', { format: 1, id: 'defined', name: 'Shadow' })
    // Its base draws a picture with an effect, a setting the window doesn't paint yet.
    const store = fixture.store({ loader: { sample: () => RED_SAMPLES, readsHeld: true } })
    const snapshot = await store.start()
    expect(snapshot.themes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'defined',
          source: 'built-in',
          status: 'ok',
          name: 'Defined',
        }),
        expect.objectContaining({ id: 'mine', source: 'mine', status: 'ok' }),
        expect.objectContaining({
          id: 'broken',
          status: 'refused',
          problems: [{ at: 'id', says: 'fictional:id' }],
        }),
      ]),
    )
    expect(snapshot.themes.filter((row) => row.id === 'defined')).toHaveLength(1)
    const reading = store.reading('mine')
    expect(reading).toMatchObject({ theme: { id: 'mine', frame: DEFINED.frame } })
    if (!('theme' in reading)) throw new Error('expected fictional reading')
    const effect = reading.theme?.effects?.[0]
    expect(effect && 'image' in effect ? effect.image : null).toBe('@defined/assets/red.png')
    expect(store.asset('defined', 'assets/red.png')).not.toBeNull()
    expect(store.asset('mine', 'assets/red.png')).toBeNull()
    expect(store.reading('broken')).toMatchObject({ outcome: 'refused', rail: 'theme-unknown' })
  })

  it('uses the injected default and problem callback for an unavailable requested theme', async () => {
    await putTheme(fixture.builtIns, 'fixture-base', { ...DEFINED, id: 'fixture-base' })
    await writeFile(join(fixture.userData, ACTIVE_THEME_FILE), '{"theme":"missing"}\n')
    const store = fixture.store({
      defaultTheme: 'fixture-base',
      builtInIds: ['defined', 'fixture-base'],
    })
    expect(await store.start()).toMatchObject({
      active: 'fixture-base',
      requested: 'missing',
      reason: 'fictional:fallback',
    })
    expect(store.background()).toBe(DEFINED.frame?.paper)
    await writeFile(join(fixture.userData, ACTIVE_THEME_FILE), 'not json')
    expect(await store.refresh()).toMatchObject({ active: 'fixture-base', requested: null })
  })

  it('shares simultaneous startup and installs one pair of canonical watchers', async () => {
    const store = fixture.store()
    const first = store.start()
    const second = store.start()
    expect(first).toBe(second)
    await Promise.all([first, second])
    await store.start()
    expect(fixture.watches.map(({ path, recursive }) => [path, recursive])).toEqual([
      [fixture.library, true],
      [fixture.userData, false],
    ])
  })

  it.each(['refresh', 'folder'] as const)(
    'does not install watchers when close drains startup held at %s',
    async (at) => {
      const store = fixture.store()
      let entered!: () => void
      const waiting = new Promise<void>((resolve) => {
        entered = resolve
      })
      let release!: () => void
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      if (at === 'refresh') {
        const refresh = store.refresh.bind(store)
        vi.spyOn(store, 'refresh').mockImplementationOnce(async () => {
          const snapshot = await refresh()
          entered()
          await held
          return snapshot
        })
      } else {
        const state = await import('../../src/main/themes/state')
        const directory = state.themeDirectory
        vi.spyOn(state, 'themeDirectory').mockImplementation(async (path) => {
          const root = await directory(path)
          if (path === fixture.userData) {
            entered()
            await held
          }
          return root
        })
      }
      const starting = store.start()
      expect(store.start()).toBe(starting)
      await waiting
      expect(fixture.watches).toHaveLength(0)
      let closed = false
      const closing = store.close().then(() => {
        closed = true
      })
      let closedBeforeRelease: boolean
      try {
        await Promise.resolve()
        await Promise.resolve()
        closedBeforeRelease = closed
      } finally {
        release()
      }
      await Promise.all([starting, closing])
      expect({ closedBeforeRelease, installed: fixture.watches.length }).toEqual({
        closedBeforeRelease: false,
        installed: 0,
      })
      expect(closed).toBe(true)
      await expect(store.refresh()).rejects.toThrow('theme store is closed')
      await store.close()
      expect(fixture.watches).toHaveLength(0)
    },
  )

  it('close drains startup failure without hiding it from the start caller', async () => {
    const store = fixture.store()
    const starting = store.start()
    const refused = expect(starting).rejects.toThrow('theme store is closed')
    await expect(store.close()).resolves.toBeUndefined()
    await refused
    expect(fixture.watches).toHaveLength(0)
    await store.close()
    expect(fixture.watches).toHaveLength(0)
  })

  it('shares a library while keeping workspace activation separate', async () => {
    const first = fixture.store()
    const second = fixture.store({ userData: fixture.otherUserData })
    await first.start()
    await second.start()
    expect(await first.save({ theme: childTheme('shared'), activate: true })).toMatchObject({
      outcome: 'ok',
      active: 'shared',
    })
    expect(await second.refresh()).toMatchObject({ active: 'defined', requested: null })
    expect(second.raw('shared')).toMatchObject({ id: 'shared' })
    expect(JSON.parse(await readFile(join(fixture.userData, ACTIVE_THEME_FILE), 'utf8'))).toEqual({
      theme: 'shared',
    })
    await expect(lstat(join(fixture.otherUserData, ACTIVE_THEME_FILE))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    expect(await second.set('shared')).toEqual({
      outcome: 'ok',
      active: 'shared',
      previous: 'defined',
    })
    expect(await first.set('defined')).toMatchObject({ outcome: 'ok' })
    expect((await second.refresh()).active).toBe('shared')
  })

  it('maps hidden libraries under only their fictional workspace root', async () => {
    const hidden = themeRoots({
      appData: fixture.appData,
      userData: fixture.otherUserData,
      resources: fixture.resources,
      hidden: true,
    })
    expect(hidden.library).toBe(join(fixture.otherUserData, 'themes'))
    expect(fixture.library).toBe(join(fixture.appData, '@brobot2', 'themes'))
    const shared = await putTheme(fixture.library, 'shared-only', childTheme('shared-only'))
    const before = await readFile(join(shared, 'theme.json'))
    const store = fixture.store(hidden)
    await store.start()
    expect(store.raw('shared-only')).toBeNull()
    expect(await store.save({ theme: childTheme('hidden-only') })).toMatchObject({ outcome: 'ok' })
    expect(await readdir(hidden.library)).toEqual(['hidden-only'])
    expect(await readdir(fixture.library)).toEqual(['shared-only'])
    expect(await readFile(join(shared, 'theme.json'))).toEqual(before)
  })
})

describe('virtual classic', () => {
  it('is available without a theme folder and reads as an unstyled selection', async () => {
    await rm(fixture.builtIns, { recursive: true })
    const store = fixture.store({ defaultTheme: 'classic', builtInIds: [] })
    const snapshot = await store.start()
    expect(snapshot).toEqual({
      active: 'classic',
      requested: null,
      themes: [{ id: 'classic', name: CLASSIC_THEME.name, source: 'built-in', status: 'ok' }],
    })
    expect(store.reading()).toEqual({
      active: 'classic',
      theme: null,
      version: null,
      assetVersions: {},
    })
    expect(store.reading('classic')).toEqual(store.reading())
    expect(store.raw('classic')).toEqual({ format: 1, id: 'classic', name: CLASSIC_THEME.name })
    expect(store.asset('classic', 'assets/red.png')).toBeNull()
    expect(store.background()).toBe('#182135')
    expect(await readdir(fixture.library)).toEqual([])
    expect(await readdir(fixture.userData)).toEqual([])
    await expect(lstat(fixture.builtIns)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([
    { kind: 'invalid JSON', document: 'not json' },
    { kind: 'wrong type', document: '{"theme":17}' },
    { kind: 'invalid id', document: '{"theme":"../classic"}' },
    { kind: 'oversized record', document: 'x'.repeat(1_025) },
  ])('uses classic without a fallback reason for $kind', async ({ document }) => {
    await writeFile(join(fixture.userData, ACTIVE_THEME_FILE), document)
    const store = fixture.store({ defaultTheme: 'classic' })
    const snapshot = await store.start()
    expect(snapshot).toMatchObject({ active: 'classic', requested: null })
    expect(snapshot).not.toHaveProperty('reason')
    expect(store.reading('classic')).toMatchObject({ theme: null, version: null })
    expect(store.reading('classic')).not.toHaveProperty('reason')
    expect(await readFile(join(fixture.userData, ACTIVE_THEME_FILE), 'utf8')).toBe(document)
  })

  it('distinguishes an unknown requested id from a malformed record and refuses an unknown set', async () => {
    await writeActiveTheme(fixture.userData, 'missing')
    const store = fixture.store({ defaultTheme: 'classic' })
    expect(await store.start()).toMatchObject({
      active: 'classic',
      requested: 'missing',
      reason: 'fictional:fallback',
    })
    expect(store.reading('classic')).toMatchObject({
      active: 'classic',
      theme: null,
      version: null,
      reason: 'fictional:fallback',
    })
    expect(store.reading('missing')).toMatchObject({ outcome: 'refused', rail: 'theme-unknown' })
    const changes = vi.fn()
    store.onChanged(changes)
    expect(await store.set('missing', 'fictional-actor')).toMatchObject({
      outcome: 'refused',
      rail: 'theme-unknown',
    })
    expect(store.snapshot()).toMatchObject({ active: 'classic', requested: 'missing' })
    expect(await readFile(join(fixture.userData, ACTIVE_THEME_FILE), 'utf8')).toBe(
      '{"theme":"missing"}\n',
    )
    expect(changes).not.toHaveBeenCalled()
  })

  it('keeps classic reserved and ignores physical built-in and custom shadows', async () => {
    const shadow = { format: 1, id: 'classic', name: 'Fictional shadow' }
    const builtin = await putTheme(fixture.builtIns, 'classic', shadow, {
      'assets/red.png': RED_PNG,
    })
    const custom = await putTheme(fixture.library, 'classic', shadow, { 'assets/red.png': RED_PNG })
    const builtinBefore = await readFile(join(builtin, 'theme.json'))
    const customBefore = await readFile(join(custom, 'theme.json'))
    const store = fixture.store({ defaultTheme: 'classic', builtInIds: [] })
    await store.start()
    expect(store.snapshot().themes.filter((row) => row.id === 'classic')).toEqual([
      { id: 'classic', name: CLASSIC_THEME.name, source: 'built-in', status: 'ok' },
    ])
    expect(store.raw('classic')).toEqual({ format: 1, id: 'classic', name: CLASSIC_THEME.name })
    expect(store.asset('classic', 'assets/red.png')).toBeNull()
    expect(await store.save({ theme: shadow, replace: true })).toMatchObject({
      outcome: 'refused',
      rail: 'theme-is-built-in',
    })
    expect(await store.delete('classic')).toMatchObject({
      outcome: 'refused',
      rail: 'theme-is-built-in',
    })
    expect(await readFile(join(builtin, 'theme.json'))).toEqual(builtinBefore)
    expect(await readFile(join(custom, 'theme.json'))).toEqual(customBefore)
    await cleanLibrary()
  })

  it('can read classic while another theme is active and persist a real switch to it', async () => {
    const store = fixture.store()
    await store.start()
    const reading = store.reading('classic')
    expect(reading).toMatchObject({ active: 'defined', theme: null, version: null })
    if (!('assetVersions' in reading)) throw new Error('expected fictional reading')
    expect(reading.assetVersions).not.toHaveProperty('classic')
    const changes = vi.fn()
    store.onChanged(changes)
    expect(await store.set('classic', 'fictional-actor')).toEqual({
      outcome: 'ok',
      active: 'classic',
      previous: 'defined',
    })
    expect(changes).toHaveBeenCalledTimes(1)
    expect(changes).toHaveBeenCalledWith(
      expect.objectContaining({
        active: 'classic',
        requested: 'classic',
        previous: 'defined',
        actor: 'fictional-actor',
      }),
    )
    expect(JSON.parse(await readFile(join(fixture.userData, ACTIVE_THEME_FILE), 'utf8'))).toEqual({
      theme: 'classic',
    })
    expect(store.reading()).toMatchObject({ active: 'classic', theme: null, version: null })
    expect(await readdir(fixture.library)).toEqual([])
    expect(await readdir(fixture.builtIns)).toEqual(['defined'])
  })

  it('admits a child extending the virtual base and refuses an unavailable base without publication', async () => {
    await rm(fixture.builtIns, { recursive: true })
    const store = fixture.store({ defaultTheme: 'classic', builtInIds: [] })
    await store.start()
    const theme = { format: 1, id: 'classic-child', name: 'Fictional child', extends: 'classic' }
    expect(await store.save({ theme, activate: true })).toMatchObject({
      outcome: 'ok',
      id: 'classic-child',
      active: 'classic-child',
      warnings: [],
    })
    expect(store.raw('classic-child')).toEqual(theme)
    const reading = store.reading()
    expect(reading).toMatchObject({ theme, version: expect.stringMatching(/^[a-f0-9]{64}$/) })
    if (!('assetVersions' in reading)) throw new Error('expected fictional reading')
    expect(reading.assetVersions).not.toHaveProperty('classic')
    expect(store.background()).toBe('#182135')
    expect(
      await store.save({ theme: { ...theme, id: 'invalid-child', extends: 'missing' } }),
    ).toMatchObject({ outcome: 'refused', rail: 'theme-invalid' })
    expect(await readdir(fixture.library)).toEqual(['classic-child'])
    expect(store.snapshot().active).toBe('classic-child')
    await cleanLibrary()
  })

  it('duplicates classic as a standalone minimal document and chooses a free id on repetition', async () => {
    await rm(fixture.builtIns, { recursive: true })
    const store = fixture.store({ defaultTheme: 'classic', builtInIds: [] })
    await store.start()
    expect(await store.duplicate('classic', 'Fictional Copy')).toMatchObject({
      outcome: 'ok',
      id: 'fictional-copy',
      active: 'classic',
      warnings: [],
    })
    const document = JSON.parse(
      await readFile(join(fixture.library, 'fictional-copy', 'theme.json'), 'utf8'),
    )
    expect(document).toEqual({ format: 1, id: 'fictional-copy', name: 'Fictional Copy' })
    expect(document).not.toHaveProperty('extends')
    expect(await readdir(join(fixture.library, 'fictional-copy'))).toEqual(['theme.json'])
    expect(await store.duplicate('classic', 'Fictional Copy')).toMatchObject({
      outcome: 'ok',
      id: 'fictional-copy-2',
    })
    expect(store.raw('fictional-copy-2')).toEqual({
      format: 1,
      id: 'fictional-copy-2',
      name: 'Fictional Copy',
    })
    expect(await readdir(fixture.library)).toEqual(['fictional-copy', 'fictional-copy-2'])
    expect(await readdir(fixture.userData)).toEqual([])
    await cleanLibrary()
  })

  it.each([
    { paper: '#182135', canonical: '#182135', expected: '#182135' },
    { paper: 'rgb(0 0 0 / 50%)', canonical: '#00000080', expected: '#0c101a' },
    { paper: '#00000080', canonical: '#00000080', expected: '#0c101a' },
    { paper: 'transparent', canonical: '#00000000', expected: '#182135' },
  ])(
    'composites admitted frame paper $paper into an opaque window background',
    async ({ paper, canonical, expected }) => {
      const store = fixture.store({ defaultTheme: 'classic' })
      await store.start()
      const theme = {
        ...DEFINED,
        id: 'paper',
        name: 'Fictional paper',
        frame: { ...DEFINED.frame, paper },
      }
      expect(await store.save({ theme, activate: true })).toMatchObject({
        outcome: 'ok',
        active: 'paper',
      })
      expect(theme.frame.paper).toBe(paper)
      expect(store.raw('paper')?.frame?.paper).toBe(canonical)
      const saved: unknown = JSON.parse(
        await readFile(join(fixture.library, 'paper', 'theme.json'), 'utf8'),
      )
      expect(saved).toMatchObject({ frame: { paper: canonical } })
      expect(store.background()).toBe(expected)
      expect(store.background()).toMatch(/^#[a-f0-9]{6}$/)
      await writeFile(
        join(fixture.library, 'paper', 'theme.json'),
        JSON.stringify({ ...theme, frame: { paper: 'invalid colour' } }),
      )
      expect(await store.refresh()).toMatchObject({
        active: 'classic',
        requested: 'paper',
        reason: 'fictional:fallback',
      })
      expect(store.background()).toBe('#182135')
    },
  )
})

describe('theme intake and publication', () => {
  it('copies absolute source paths and accepts asset names relative to assets with sniffed types', async () => {
    const source = join(fixture.source, 'offered.bin')
    await writeFile(source, RED_PNG)
    const store = fixture.store()
    await store.start()
    expect(
      await store.save({
        theme: childTheme('from-path'),
        assets: [{ name: 'red.jpg', path: source }],
      }),
    ).toMatchObject({ outcome: 'ok' })
    await writeFile(source, 'source changed')
    expect(await readFile(join(fixture.library, 'from-path', 'assets/red.jpg'))).toEqual(RED_PNG)
    expect(store.asset('from-path', 'assets/red.jpg')?.facts.type).toBe('png')
    expect(
      await store.save({
        theme: childTheme('from-base64'),
        assets: [{ name: 'assets/red.png', base64: RED_PNG.toString('base64') }],
      }),
    ).toMatchObject({ outcome: 'ok' })
    expect(await readFile(join(fixture.library, 'from-base64', 'assets/red.png'))).toEqual(RED_PNG)
    const document = await readFile(join(fixture.library, 'from-base64', 'theme.json'), 'utf8')
    expect(JSON.parse(document)).toEqual(childTheme('from-base64'))
    expect(document).toBe(`${JSON.stringify(childTheme('from-base64'), null, 2)}\n`)
    await cleanLibrary()
  })

  it.each([
    'relative',
    'link',
    'directory',
    'both',
    'neither',
    'duplicate',
    'prefix',
    'base64',
    'unused-invalid',
    'decode',
  ] as const)('refuses %s intake without publishing any files', async (kind) => {
    const source = join(fixture.source, 'red.png')
    await writeFile(source, RED_PNG)
    const link = join(fixture.source, 'link.png')
    if (kind === 'link') await symlink(source, link)
    const assets: NonNullable<ThemeSaveInput['assets']> =
      kind === 'relative'
        ? [{ name: 'red.png', path: 'relative.png' }]
        : kind === 'link'
          ? [{ name: 'red.png', path: link }]
          : kind === 'directory'
            ? [{ name: 'red.png', path: fixture.source }]
            : kind === 'both'
              ? [{ name: 'red.png', path: source, base64: RED_PNG.toString('base64') }]
              : kind === 'neither'
                ? [{ name: 'red.png' }]
                : kind === 'duplicate'
                  ? [
                      { name: 'red.png', path: source },
                      { name: 'assets/RED.png', path: source },
                    ]
                  : kind === 'prefix'
                    ? [
                        { name: 'red.png', path: source },
                        { name: 'red.png/child.png', path: source },
                      ]
                    : kind === 'base64'
                      ? [{ name: 'red.png', base64: 'AB==' }]
                      : kind === 'unused-invalid'
                        ? [
                            {
                              name: 'unused.png',
                              base64: Buffer.from('not an image').toString('base64'),
                            },
                          ]
                        : [{ name: 'red.png', path: source }]
    const store = fixture.store(kind === 'decode' ? { loader: { sample: () => null } } : {})
    await store.start()
    expect(await store.save({ theme: childTheme('rejected'), assets })).toMatchObject({
      outcome: 'refused',
      rail: 'theme-invalid',
    })
    expect(await readdir(fixture.library)).toEqual([])
    expect(store.raw('rejected')).toBeNull()
  })

  it.each([
    'json',
    'files',
    'base64-bytes',
    'path-bytes',
    'font-bytes',
    'font-count',
    'pixels',
    'aggregate',
  ] as const)('bounds %s before publication, including unused assets', async (kind) => {
    let theme: unknown = childTheme('bounded')
    let assets: NonNullable<ThemeSaveInput['assets']> = []
    if (kind === 'json')
      theme = { ...childTheme('bounded'), description: 'x'.repeat(THEME_JSON_BYTES) }
    if (kind === 'files')
      assets = Array.from({ length: LIMITS.files + 1 }, (_, i) => ({
        name: `p${i}.png`,
        base64: RED_PNG.toString('base64'),
      }))
    if (kind === 'base64-bytes')
      assets = [
        { name: 'large.png', base64: 'A'.repeat(Math.ceil(LIMITS.pictureBytes / 3) * 4 + 4) },
      ]
    if (kind === 'path-bytes') {
      const source = join(fixture.source, 'large.png')
      await writeFile(source, Buffer.alloc(LIMITS.pictureBytes + 1))
      assets = [{ name: 'large.png', path: source }]
    }
    if (kind === 'font-bytes' || kind === 'font-count') {
      const font = Buffer.alloc(kind === 'font-bytes' ? LIMITS.fontBytes + 1 : 4)
      font.write('wOF2')
      assets = Array.from({ length: kind === 'font-count' ? LIMITS.fonts + 1 : 1 }, (_, i) => ({
        name: `f${i}.woff2`,
        base64: font.toString('base64'),
      }))
    }
    if (kind === 'pixels') {
      const picture = Buffer.from(RED_PNG)
      picture.writeUInt32BE(LIMITS.picturePixels + 1, 16)
      assets = [{ name: 'wide.png', base64: picture.toString('base64') }]
    }
    if (kind === 'aggregate') {
      const source = join(fixture.source, 'large.png')
      const picture = Buffer.alloc(LIMITS.pictureBytes)
      RED_PNG.copy(picture)
      await writeFile(source, picture)
      assets = Array.from({ length: 4 }, (_, i) => ({ name: `p${i}.png`, path: source }))
    }
    const store = fixture.store()
    await store.start()
    const result = await store.save({ theme, assets })
    expect(result.outcome).toBe('refused')
    expect(await readdir(fixture.library)).toEqual([])
  })

  it('refuses invalid unused files and linked folders during library loading', async () => {
    await putTheme(fixture.library, 'unused-invalid', childTheme('unused-invalid'), {
      'assets/unused.png': Buffer.from('invalid'),
    })
    const outside = await putTheme(fixture.outside, 'linked', childTheme('linked'))
    await symlink(outside, join(fixture.library, 'linked'), 'dir')
    const store = fixture.store()
    const snapshot = await store.start()
    expect(snapshot.themes.filter((row) => row.source === 'mine').map((row) => row.status)).toEqual(
      ['refused', 'refused'],
    )
    expect(store.raw('unused-invalid')).toBeNull()
    expect(store.raw('linked')).toBeNull()
  })

  it('refuses a linked JSON leaf and linked asset parent during registry loading', async () => {
    const outside = await putTheme(fixture.outside, 'linked-json', childTheme('linked-json'))
    const jsonFolder = await putTheme(fixture.library, 'linked-json', childTheme('linked-json'))
    await rm(join(jsonFolder, 'theme.json'))
    await symlink(join(outside, 'theme.json'), join(jsonFolder, 'theme.json'))
    const assetsFolder = await putTheme(
      fixture.library,
      'linked-assets',
      childTheme('linked-assets'),
    )
    await writeFile(join(fixture.outside, 'red.png'), RED_PNG)
    await symlink(fixture.outside, join(assetsFolder, 'assets'), 'dir')
    const store = fixture.store()
    await store.start()
    for (const id of ['linked-json', 'linked-assets']) {
      expect(store.snapshot().themes.find((row) => row.id === id)?.status).toBe('refused')
      expect(store.raw(id)).toBeNull()
    }
  })

  it('keeps an existing theme unless replacement is explicit and forbids built-in replacement', async () => {
    const store = fixture.store()
    await store.start()
    expect(await store.save({ theme: childTheme('mine', 'Original') })).toMatchObject({
      outcome: 'ok',
    })
    const old = await readFile(join(fixture.library, 'mine', 'theme.json'))
    expect(await store.save({ theme: childTheme('mine', 'Changed') })).toMatchObject({
      outcome: 'refused',
      rail: 'theme-exists',
    })
    expect(
      await store.save({ theme: { ...DEFINED, name: 'Changed' }, replace: true }),
    ).toMatchObject({ outcome: 'refused', rail: 'theme-is-built-in' })
    expect(await readFile(join(fixture.library, 'mine', 'theme.json'))).toEqual(old)
    expect(store.raw('defined')?.name).toBe('Defined')
    await cleanLibrary()
  })

  it.each(['create', 'replace'] as const)(
    'admits depth-eight assets for %s and reloads the published theme',
    async (operation) => {
      const store = fixture.store()
      await store.start()
      if (operation === 'replace') await store.save({ theme: childTheme('topology', 'Original') })
      const path = 'assets/a/b/c/d/e/f/g/h/red.png'
      const result = await store.save({
        theme: childTheme('topology', 'Depth eight'),
        assets: [{ name: path, base64: RED_PNG.toString('base64') }],
        replace: operation === 'replace',
        activate: true,
      })
      expect(result).toMatchObject({ outcome: 'ok', active: 'topology', warnings: [] })
      expect(store.snapshot().themes.find((row) => row.id === 'topology')).toMatchObject({
        status: 'ok',
        version: 'version' in result ? result.version : undefined,
      })
      expect(store.asset('topology', path)).not.toBeNull()
      await store.refresh()
      expect(store.raw('topology')?.name).toBe('Depth eight')
      expect(store.snapshot().active).toBe('topology')
      expect(await readFile(join(fixture.library, 'topology', path))).toEqual(RED_PNG)
      await cleanLibrary()
    },
  )

  it.each(['create', 'replace'] as const)(
    'refuses depth-nine assets for %s before publication and preserves the prior choice',
    async (operation) => {
      const sample = vi.fn(() => ({
        darkest: { r: 255, g: 0, b: 0, a: 1 },
        lightest: { r: 255, g: 0, b: 0, a: 1 },
        seeThrough: false,
      }))
      const store = fixture.store({ loader: { sample } })
      await store.start()
      if (operation === 'replace') {
        await store.save({
          theme: childTheme('topology', 'Original'),
          assets: [{ name: 'assets/red.png', base64: RED_PNG.toString('base64') }],
          activate: true,
        })
      } else await store.set('defined')
      const choice = await readFile(join(fixture.userData, ACTIVE_THEME_FILE))
      const before = store.snapshot()
      const document =
        operation === 'replace'
          ? await readFile(join(fixture.library, 'topology', 'theme.json'))
          : null
      const sampled = sample.mock.calls.length
      const changes = vi.fn()
      store.onChanged(changes)
      const result = await store.save({
        theme: childTheme('topology', 'Depth nine'),
        assets: [{ name: 'assets/a/b/c/d/e/f/g/h/i/red.png', base64: RED_PNG.toString('base64') }],
        replace: operation === 'replace',
        activate: true,
      })
      expect(result).toEqual({
        outcome: 'refused',
        rail: 'theme-invalid',
        problems: [{ at: 'assets[0]', says: 'fictional:files' }],
      })
      expect(sample).toHaveBeenCalledTimes(sampled + (operation === 'replace' ? 1 : 0))
      expect(store.snapshot()).toEqual(before)
      expect(changes).not.toHaveBeenCalled()
      expect(await readFile(join(fixture.userData, ACTIVE_THEME_FILE))).toEqual(choice)
      if (operation === 'replace') {
        expect(await readFile(join(fixture.library, 'topology', 'theme.json'))).toEqual(document)
        expect(await readFile(join(fixture.library, 'topology', 'assets/red.png'))).toEqual(RED_PNG)
        expect(await readdir(join(fixture.library, 'topology'))).toEqual(['assets', 'theme.json'])
      } else expect(await readdir(fixture.library)).toEqual([])
      await cleanLibrary()
    },
  )

  it('retains exactly the ten latest prior documents even when every save has the same clock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_000)
    const store = fixture.store()
    await store.start()
    for (let i = 0; i <= 11; i++) {
      expect(
        await store.save({ theme: childTheme('history', `Version ${i}`), replace: i > 0 }),
      ).toMatchObject({ outcome: 'ok' })
    }
    const folder = join(fixture.library, 'history', '.history')
    const names = (await readdir(folder)).sort(
      (a, b) => Number(a.split('-')[0]) - Number(b.split('-')[0]),
    )
    expect(names).toHaveLength(10)
    const documents = await Promise.all(
      names.map(
        async (name) => JSON.parse(await readFile(join(folder, name), 'utf8')) as { name: string },
      ),
    )
    expect(documents.map((document) => document.name)).toEqual(
      Array.from({ length: 10 }, (_, i) => `Version ${i + 1}`),
    )
    expect(new Set(names.map((name) => name.split('-')[0])).size).toBe(10)
    expect(store.raw('history')?.name).toBe('Version 11')
    await cleanLibrary()
  })

  it('rolls back the real previous directory when the staged replacement rename fails', async () => {
    const store = fixture.store()
    await store.start()
    expect(
      await store.save({
        theme: childTheme('mine', 'Original'),
        assets: [{ name: 'red.png', base64: RED_PNG.toString('base64') }],
        activate: true,
      }),
    ).toMatchObject({ outcome: 'ok' })
    const original = await readFile(join(fixture.library, 'mine', 'theme.json'))
    const active = await readFile(join(fixture.userData, ACTIVE_THEME_FILE))
    const calls: [string, string][] = []
    const failing = fixture.store({
      files: {
        rename: async (from, to) => {
          calls.push([String(from), String(to)])
          if (
            basename(String(from)).startsWith('.theme-mine-') &&
            String(to) === join(fixture.library, 'mine')
          )
            throw Object.assign(new Error('fictional rename failure'), { code: 'EIO' })
          await rename(from, to)
        },
      },
    })
    await failing.start()
    const changes = vi.fn()
    failing.onChanged(changes)
    expect(
      await failing.save({ theme: childTheme('mine', 'Replacement'), replace: true }),
    ).toMatchObject({ outcome: 'refused' })
    expect(calls).toHaveLength(3)
    expect(await readFile(join(fixture.library, 'mine', 'theme.json'))).toEqual(original)
    expect(await readFile(join(fixture.library, 'mine', 'assets/red.png'))).toEqual(RED_PNG)
    expect(await readFile(join(fixture.userData, ACTIVE_THEME_FILE))).toEqual(active)
    expect((await failing.refresh()).active).toBe('mine')
    expect(changes).not.toHaveBeenCalled()
    await cleanLibrary()
  })

  it('retains a successful library save and reports a warning if activation rename fails', async () => {
    await writeActiveTheme(fixture.userData, 'defined')
    const store = fixture.store({
      files: {
        rename: async (from, to) => {
          if (String(to) === join(fixture.userData, ACTIVE_THEME_FILE))
            throw new Error('fictional choice failure')
          await rename(from, to)
        },
      },
    })
    await store.start()
    const failedListener = vi.fn(() => {
      throw new Error('fictional listener failure')
    })
    const changes = vi.fn()
    store.onChanged(failedListener)
    store.onChanged(changes)
    expect(
      await store.save({ theme: childTheme('saved'), activate: true }, 'fictional-actor'),
    ).toMatchObject({
      outcome: 'ok',
      id: 'saved',
      active: 'defined',
      warnings: ['fictional:choice'],
    })
    expect(failedListener).toHaveBeenCalledTimes(1)
    expect(changes).toHaveBeenCalledTimes(1)
    const change: unknown = changes.mock.calls[0]![0]
    expect(change).toMatchObject({
      active: 'defined',
      requested: 'defined',
      themes: expect.arrayContaining([expect.objectContaining({ id: 'saved', status: 'ok' })]),
    })
    expect(change).not.toHaveProperty('actor')
    expect(change).not.toHaveProperty('previous')
    expect(store.raw('saved')).toMatchObject({ id: 'saved' })
    expect(JSON.parse(await readFile(join(fixture.userData, ACTIVE_THEME_FILE), 'utf8'))).toEqual({
      theme: 'defined',
    })
    expect(await readdir(fixture.userData)).toEqual([ACTIVE_THEME_FILE])
    await cleanLibrary()
  })

  it('announces a successful save and activation once with real previous and actor despite listener failure', async () => {
    const store = fixture.store({ defaultTheme: 'classic' })
    await store.start()
    const failedListener = vi.fn(() => {
      throw new Error('fictional listener failure')
    })
    const changes = vi.fn()
    store.onChanged(failedListener)
    store.onChanged(changes)
    expect(
      await store.save({ theme: childTheme('selected'), activate: true }, 'fictional-actor'),
    ).toMatchObject({ outcome: 'ok', active: 'selected', warnings: [] })
    expect(failedListener).toHaveBeenCalledTimes(1)
    expect(changes).toHaveBeenCalledTimes(1)
    expect(changes).toHaveBeenCalledWith(
      expect.objectContaining({
        active: 'selected',
        requested: 'selected',
        previous: 'classic',
        actor: 'fictional-actor',
        themes: expect.arrayContaining([expect.objectContaining({ id: 'selected', status: 'ok' })]),
      }),
    )
    expect(JSON.parse(await readFile(join(fixture.userData, ACTIVE_THEME_FILE), 'utf8'))).toEqual({
      theme: 'selected',
    })
    expect(store.raw('selected')).not.toBeNull()
    await cleanLibrary()
  })

  it('announces an unactivated library save without inventing a selection change', async () => {
    const store = fixture.store({ defaultTheme: 'classic' })
    await store.start()
    const changes = vi.fn()
    store.onChanged(changes)
    expect(await store.save({ theme: childTheme('unselected') }, 'fictional-actor')).toMatchObject({
      outcome: 'ok',
      active: 'classic',
      warnings: [],
    })
    expect(changes).toHaveBeenCalledTimes(1)
    const change: unknown = changes.mock.calls[0]![0]
    expect(change).toMatchObject({
      active: 'classic',
      requested: null,
      themes: expect.arrayContaining([expect.objectContaining({ id: 'unselected', status: 'ok' })]),
    })
    expect(change).not.toHaveProperty('previous')
    expect(change).not.toHaveProperty('actor')
    expect(await readdir(fixture.userData)).toEqual([])
  })

  it('refuses a second writer holding the same id lock and succeeds after release', async () => {
    const first = fixture.store()
    const second = fixture.store({ userData: fixture.otherUserData })
    await first.start()
    await second.start()
    const release = await themeWriteLock(fixture.library, 'locked')
    expect(release).not.toBeNull()
    if (!release) throw new Error('expected fictional lock')
    try {
      expect(await second.save({ theme: childTheme('locked') })).toMatchObject({
        outcome: 'refused',
        problems: [{ at: 'theme.json', says: 'fictional:busy' }],
      })
      expect(await readdir(fixture.library)).toEqual(['.theme-locked.lock'])
    } finally {
      await release()
    }
    expect(await first.save({ theme: childTheme('locked') })).toMatchObject({ outcome: 'ok' })
    expect((await second.refresh()).themes).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'locked', status: 'ok' })]),
    )
    await cleanLibrary()
  })
})

describe('active selection and watched changes', () => {
  it.each(['set', 'save', 'delete', 'duplicate', 'open-folder'] as const)(
    'announces external changes when %s refuses before a pending watch refresh',
    async (operation) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const store = fixture.store({
        defaultTheme: 'classic',
        openFolder: async () => {
          throw new Error('fictional open failure')
        },
      })
      await store.start()
      await store.save({ theme: childTheme('selected'), activate: true })
      const changes = vi.fn()
      store.onChanged(changes)
      const refresh = store.refresh.bind(store)
      const pending: Promise<unknown>[] = []
      vi.spyOn(store, 'refresh').mockImplementation(() => {
        const job = refresh()
        pending.push(job)
        return job
      })
      await rm(join(fixture.library, 'selected'), { recursive: true })
      await putTheme(fixture.library, 'external', childTheme('external'))
      fixture.watches[0]!.changed()
      const request = () => {
        switch (operation) {
          case 'set':
            return store.set('missing', 'failed-actor')
          case 'save':
            return store.save({ theme: DEFINED, activate: true }, 'failed-actor')
          case 'delete':
            return store.delete('missing')
          case 'duplicate':
            return store.duplicate('missing', 'Copy')
          case 'open-folder':
            return store.openFolder()
        }
      }
      expect(await request()).toMatchObject({
        outcome: 'refused',
        rail:
          operation === 'save'
            ? 'theme-is-built-in'
            : operation === 'open-folder'
              ? 'theme-invalid'
              : 'theme-unknown',
      })
      expect(changes).toHaveBeenCalledTimes(1)
      const change: unknown = changes.mock.calls[0]![0]
      expect(change).toMatchObject({
        active: 'classic',
        requested: 'selected',
        reason: 'fictional:fallback',
        themes: expect.arrayContaining([expect.objectContaining({ id: 'external', status: 'ok' })]),
      })
      expect(change).not.toHaveProperty('previous')
      expect(change).not.toHaveProperty('actor')
      expect(store.snapshot().themes.some((row) => row.id === 'selected')).toBe(false)
      await vi.advanceTimersByTimeAsync(300)
      await Promise.all(pending.splice(0))
      expect(changes).toHaveBeenCalledTimes(1)
      expect(await request()).toMatchObject({ outcome: 'refused' })
      expect(changes).toHaveBeenCalledTimes(1)
    },
  )

  it('coalesces an external reload and successful selection into one truthful change', async () => {
    const store = fixture.store({ defaultTheme: 'classic' })
    await store.start()
    await store.save({ theme: childTheme('selected'), activate: true })
    const changes = vi.fn()
    store.onChanged(changes)
    await rm(join(fixture.library, 'selected'), { recursive: true })
    await putTheme(fixture.library, 'external', childTheme('external'))
    expect(await store.set('external', 'choosing-actor')).toEqual({
      outcome: 'ok',
      active: 'external',
      previous: 'classic',
    })
    expect(changes).toHaveBeenCalledTimes(1)
    expect(changes.mock.calls[0]![0]).toMatchObject({
      active: 'external',
      requested: 'external',
      previous: 'classic',
      actor: 'choosing-actor',
    })
    await store.refresh()
    expect(changes).toHaveBeenCalledTimes(1)
  })

  it('writes a complete exclusive private temporary record before renaming it', async () => {
    await writeActiveTheme(fixture.userData, 'defined')
    let inspected = false
    await writeActiveTheme(fixture.userData, 'next', {
      rename: async (from, to) => {
        expect(String(from)).toMatch(/active-theme\.json\.[0-9]+\.[a-f0-9-]+\.tmp$/)
        expect(String(to)).toBe(join(fixture.userData, ACTIVE_THEME_FILE))
        expect(JSON.parse(await readFile(from, 'utf8'))).toEqual({ theme: 'next' })
        expect(JSON.parse(await readFile(to, 'utf8'))).toEqual({ theme: 'defined' })
        if (process.platform !== 'win32') expect((await lstat(from)).mode & 0o777).toBe(0o600)
        await expect(writeFile(from, 'collision', { flag: 'wx' })).rejects.toMatchObject({
          code: 'EEXIST',
        })
        inspected = true
        await rename(from, to)
      },
    })
    expect(inspected).toBe(true)
    expect(JSON.parse(await readFile(join(fixture.userData, ACTIVE_THEME_FILE), 'utf8'))).toEqual({
      theme: 'next',
    })
    expect(await readdir(fixture.userData)).toEqual([ACTIVE_THEME_FILE])
  })

  it.each(['next', 'classic'])(
    'leaves the previous selection when an active rename for %s fails',
    async (id) => {
      await putTheme(fixture.library, 'next', childTheme('next'))
      await writeActiveTheme(fixture.userData, 'defined')
      const store = fixture.store({
        files: {
          rename: async () => {
            throw new Error('fictional rename failure')
          },
        },
      })
      await store.start()
      const changes = vi.fn()
      store.onChanged(changes)
      expect(await store.set(id)).toMatchObject({
        outcome: 'refused',
        problems: [{ at: ACTIVE_THEME_FILE, says: 'fictional:choice' }],
      })
      expect(store.snapshot().active).toBe('defined')
      expect(await readFile(join(fixture.userData, ACTIVE_THEME_FILE), 'utf8')).toBe(
        '{"theme":"defined"}\n',
      )
      expect(await readdir(fixture.userData)).toEqual([ACTIVE_THEME_FILE])
      expect(changes).not.toHaveBeenCalled()
    },
  )

  it('coalesces watcher bursts for 300 ms, reloads invalid/deleted choices and stays silent after close', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const store = fixture.store()
    await store.start()
    const changes = vi.fn()
    store.onChanged(changes)
    const refresh = store.refresh.bind(store)
    const pending: Promise<unknown>[] = []
    const observed = vi.spyOn(store, 'refresh').mockImplementation(() => {
      const job = refresh()
      pending.push(job)
      return job
    })
    const settle = async (): Promise<void> => {
      await vi.advanceTimersByTimeAsync(300)
      await Promise.all(pending.splice(0))
    }
    expect(fixture.watches.map(({ path, recursive }) => [path, recursive])).toEqual([
      [fixture.library, true],
      [fixture.userData, false],
    ])
    await putTheme(fixture.library, 'watched', childTheme('watched'))
    const libraryWatch = fixture.watches[0]!
    libraryWatch.changed()
    await vi.advanceTimersByTimeAsync(200)
    libraryWatch.changed()
    fixture.watches[1]!.changed()
    await vi.advanceTimersByTimeAsync(299)
    expect(observed).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await Promise.all(pending.splice(0))
    expect(observed).toHaveBeenCalledTimes(1)
    expect(changes).toHaveBeenCalledTimes(1)
    expect(store.raw('watched')).not.toBeNull()
    await writeActiveTheme(fixture.userData, 'watched')
    fixture.watches[1]!.changed()
    await settle()
    expect(store.snapshot().active).toBe('watched')
    await writeFile(join(fixture.library, 'watched', 'next.json'), 'invalid')
    await rename(
      join(fixture.library, 'watched', 'next.json'),
      join(fixture.library, 'watched', 'theme.json'),
    )
    libraryWatch.changed()
    await settle()
    expect(store.snapshot()).toMatchObject({
      active: 'defined',
      requested: 'watched',
      reason: 'fictional:fallback',
    })
    expect(store.snapshot().themes.find((row) => row.id === 'watched')?.status).toBe('refused')
    await putTheme(fixture.library, 'watched', childTheme('watched'))
    libraryWatch.changed()
    await settle()
    expect(store.snapshot().active).toBe('watched')
    await rm(join(fixture.library, 'watched'), { recursive: true })
    libraryWatch.changed()
    await settle()
    expect(store.snapshot().themes.some((row) => row.id === 'watched')).toBe(false)
    const calls = observed.mock.calls.length
    const announcements = changes.mock.calls.length
    libraryWatch.changed()
    await store.close()
    expect(fixture.watches.every((watch) => watch.closed)).toBe(true)
    libraryWatch.changed()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(observed).toHaveBeenCalledTimes(calls)
    expect(changes).toHaveBeenCalledTimes(announcements)
  })
})
