import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ThemeStore, type ThemeStoreOptions } from '../../src/main/themes/store'
import { themeRoots } from '../../src/main/themes/state'
import type { PictureSamples } from '../../src/shared/themes/contrast'
import type { Theme } from '../../src/shared/themes/theme'
import { DEFINED } from './fixtures'

export const RED_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cfc0f01f00050001ff89993d1d0000000049454e44ae426082',
  'hex',
)

// Store tests inject samples; they do not exercise a native decoder.
export const RED_SAMPLES: PictureSamples = {
  darkest: { r: 255, g: 0, b: 0, a: 1 },
  lightest: { r: 255, g: 0, b: 0, a: 1 },
  seeThrough: false,
}

export const childTheme = (id: string, name = id): Theme => ({
  format: 1,
  id,
  name,
  extends: 'defined',
})

export const picturedBase: Theme = {
  ...DEFINED,
  effects: [
    {
      type: 'drift',
      zone: 'rail',
      image: 'assets/red.png',
      direction: 'down',
      period: 14,
      size: 120,
    },
  ],
}

export async function putTheme(
  library: string,
  id: string,
  theme: unknown,
  assets: Readonly<Record<string, Buffer>> = {},
): Promise<string> {
  const folder = join(library, id)
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, 'theme.json'), `${JSON.stringify(theme)}\n`)
  for (const [path, bytes] of Object.entries(assets)) {
    await mkdir(dirname(join(folder, path)), { recursive: true })
    await writeFile(join(folder, path), bytes)
  }
  return folder
}

export async function createHostFixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'brobot-theme-host-')))
  const appData = join(root, 'app-data')
  const userData = join(root, 'workspace-one')
  const otherUserData = join(root, 'workspace-two')
  const resources = join(root, 'resources')
  const source = join(root, 'source')
  const outside = join(root, 'outside')
  const roots = themeRoots({ appData, userData, resources, hidden: false })
  const stores: ThemeStore[] = []
  const watches: { path: string; recursive: boolean; changed: () => void; closed: boolean }[] = []
  for (const path of [
    appData,
    userData,
    otherUserData,
    resources,
    roots.library,
    source,
    outside,
  ]) {
    await mkdir(path, { recursive: true })
  }
  await putTheme(roots.builtIns, 'defined', DEFINED)
  return {
    root,
    appData,
    otherUserData,
    resources,
    source,
    outside,
    ...roots,
    watches,
    store(overrides: Partial<ThemeStoreOptions> = {}): ThemeStore {
      const store = new ThemeStore({
        ...roots,
        defaultTheme: 'defined',
        builtInIds: ['defined'],
        loader: { sample: () => RED_SAMPLES },
        problem: (kind) => `fictional:${kind}`,
        trash: (path) => rm(path, { recursive: true }),
        openFolder: async () => undefined,
        watch: (path, recursive, changed) => {
          const observation = { path, recursive, changed, closed: false }
          watches.push(observation)
          return () => {
            observation.closed = true
          }
        },
        ...overrides,
      })
      stores.push(store)
      return store
    },
    async cleanup(): Promise<void> {
      try {
        for (const store of stores) await store.close()
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
  }
}

export type HostFixture = Awaited<ReturnType<typeof createHostFixture>>
