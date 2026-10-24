import { existsSync } from 'node:fs'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as themeDefaults from '../../src/main/themes/defaults'
import { BUILT_IN_THEME_IDS, HIDDEN_BASE_THEME_IDS } from '../../src/main/themes/defaults'
import { ThemeStore, type ThemeStoreOptions } from '../../src/main/themes/store'
import { ACTIVE_THEME_FILE, themeRoots, writeActiveTheme } from '../../src/main/themes/state'
import { themeProblem } from '../../src/main/themes/words'
import { putTheme } from './host-fixtures'
import { pngSamples } from './png-samples'

/**
 * Crew Night ships built in and is the look a new install starts in. A workspace that already holds
 * data from an earlier version and never chose a theme keeps classic, and that answer is written
 * down once so it never depends on the guess again. A choice a person made is never touched, a
 * theme of their own under the same id gives way to the built-in without being deleted, and a new
 * workspace added later starts in Crew Night too.
 */

/** The database file whose presence says a workspace already holds data. */
const DATABASE = 'brobot2.sqlite'

/** The store's defaults for a workspace, as the app gives them when it starts there. */
const themeDefaultsFor = (userData: string): Record<string, string> => {
  const app = themeDefaults as unknown as {
    themeDefaultsFor?: (userData: string) => Record<string, string>
    defaultThemeFor?: (userData: string) => string
  }
  return (
    app.themeDefaultsFor?.(userData) ?? {
      defaultTheme: app.defaultThemeFor?.(userData) ?? themeDefaults.DEFAULT_THEME_ID,
    }
  )
}

let root: string
let appData: string
const stores: ThemeStore[] = []

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'brobot-crew-night-default-')))
  appData = join(root, 'app-data')
  // The library folder's parent: the app's data folder, which exists before any theme is read.
  await mkdir(join(appData, '@brobot2'), { recursive: true })
})

afterEach(async () => {
  for (const store of stores.splice(0)) await store.close()
  await rm(root, { recursive: true, force: true })
})

/** A workspace folder: empty, or holding an earlier version's database. */
async function workspace(name: string, hasData: boolean): Promise<string> {
  const userData = join(root, name)
  await mkdir(userData, { recursive: true })
  if (hasData) await writeFile(join(userData, DATABASE), 'an earlier version’s data')
  return userData
}

/** The store as the app makes it for `userData`, over the built-ins as they ship. */
/** With `refusesWrites`, the system refuses every rename into the workspace: a full disk, say. */
function startedStore(userData: string, refusesWrites = false): ThemeStore {
  const roots = themeRoots({
    appData,
    userData,
    resources: join(__dirname, '../../resources'),
    hidden: false,
  })
  const store = new ThemeStore({
    ...roots,
    files: {
      rename: refusesWrites
        ? async () => {
            throw Object.assign(new Error('no space left'), { code: 'ENOSPC' })
          }
        : rename,
      readdir: (path: string) => readdir(path),
      lstat: (path: string) => lstat(path),
    },
    ...themeDefaultsFor(userData),
    writesItsDefault: true,
    builtInIds: BUILT_IN_THEME_IDS,
    hiddenBases: HIDDEN_BASE_THEME_IDS,
    loader: {
      sample: (bytes: Buffer, facts: { type: string }) =>
        facts.type === 'png' ? pngSamples(bytes) : null,
    },
    problem: themeProblem,
    trash: (path: string) => rm(path, { recursive: true, force: true }),
    openFolder: async () => undefined,
    watch: () => () => {},
  } as unknown as ThemeStoreOptions)
  stores.push(store)
  return store
}

const choiceOn = async (userData: string): Promise<string | null> => {
  const path = join(userData, ACTIVE_THEME_FILE)
  return existsSync(path) ? (await readFile(path, 'utf8')).trim() : null
}

describe('a new install starts in Crew Night, and an existing one keeps classic', () => {
  it('Crew Night ships as a built-in theme', async () => {
    const userData = await workspace('fresh', false)
    const snapshot = await startedStore(userData).start()
    expect(snapshot.themes).toContainEqual(
      expect.objectContaining({ id: 'crew-night', name: 'Crew Night', source: 'built-in' }),
    )
  })

  it('a fresh data folder starts in Crew Night, and keeps it once it holds data', async () => {
    const userData = await workspace('fresh', false)
    const first = await startedStore(userData).start()
    expect(first.active).toBe('crew-night')
    expect(first.reason).toBeUndefined()
    expect(await choiceOn(userData)).toBe('{"theme":"crew-night"}')
    // Its second start, now with data of its own, is still in Crew Night.
    await writeFile(join(userData, DATABASE), 'its own data')
    expect((await startedStore(userData).start()).active).toBe('crew-night')
  })

  it('a new install’s default look stays Crew Night on its later starts', async () => {
    const userData = await workspace('fresh', false)
    await startedStore(userData).start()
    // Its later starts, now with data of its own.
    await writeFile(join(userData, DATABASE), 'its own data')
    const later = startedStore(userData)
    expect((await later.start()).active).toBe('crew-night')
    // Asked for the default look, it is Crew Night, and that is written down.
    expect((await later.showDefault()).active).toBe('crew-night')
    expect(await choiceOn(userData)).toBe('{"theme":"crew-night"}')
  })

  it('a theme of their own that they chose and delete gives way to Crew Night on a later start', async () => {
    const userData = await workspace('fresh', false)
    await startedStore(userData).start()
    await writeFile(join(userData, DATABASE), 'its own data')
    const library = themeRoots({ appData, userData, resources: '', hidden: false }).library
    await mkdir(library, { recursive: true })
    await putTheme(library, 'harbour', {
      format: 1,
      id: 'harbour',
      name: 'Harbour',
      extends: 'defined',
    })
    await writeActiveTheme(userData, 'harbour')
    const later = startedStore(userData)
    expect((await later.start()).active).toBe('harbour')
    expect(await later.delete('harbour')).toMatchObject({ outcome: 'ok', active: 'crew-night' })
    expect(await choiceOn(userData)).toBe('{"theme":"crew-night"}')
  })

  it('a folder with an earlier version’s data and no choice keeps classic, written once', async () => {
    const userData = await workspace('earlier', true)
    const snapshot = await startedStore(userData).start()
    expect(snapshot.active).toBe('classic')
    expect(snapshot.reason).toBeUndefined()
    expect(await choiceOn(userData)).toBe('{"theme":"classic"}')
  })

  it('a folder with an earlier version’s data keeps classic when its choice can’t be written', async () => {
    const userData = await workspace('earlier', true)
    const store = startedStore(userData, true)
    expect((await store.start()).active).toBe('classic')
    expect(await choiceOn(userData)).toBeNull()
    // A later look at the same workspace, as the folder's watcher brings one, keeps it.
    expect((await store.refresh()).active).toBe('classic')
  })

  it('a choice a person made is untouched, in a new folder or an earlier one', async () => {
    for (const [name, hasData] of [
      ['chose-fresh', false],
      ['chose-earlier', true],
    ] as const) {
      const userData = await workspace(name, hasData)
      await writeActiveTheme(userData, 'synthwave')
      expect((await startedStore(userData).start()).active).toBe('synthwave')
      expect(await choiceOn(userData)).toBe('{"theme":"synthwave"}')
    }
  })

  it('a choice that cannot be read is never written over', async () => {
    const userData = await workspace('held', true)
    await writeActiveTheme(userData, 'synthwave')
    await chmod(join(userData, ACTIVE_THEME_FILE), 0o000)
    try {
      await startedStore(userData).start()
    } finally {
      await chmod(join(userData, ACTIVE_THEME_FILE), 0o600)
    }
    expect(await choiceOn(userData)).toBe('{"theme":"synthwave"}')
  })

  it('a theme of a person’s own with the id crew-night gives way to the built-in, and stays on disk', async () => {
    const userData = await workspace('earlier', true)
    const library = themeRoots({ appData, userData, resources: '', hidden: false }).library
    await mkdir(library, { recursive: true })
    const mine = await putTheme(library, 'crew-night', {
      format: 1,
      id: 'crew-night',
      name: 'My own Crew Night',
      extends: 'defined',
    })
    await writeActiveTheme(userData, 'crew-night')
    const snapshot = await startedStore(userData).start()
    expect(snapshot.active).toBe('crew-night')
    expect(snapshot.reason).toBeUndefined()
    const rows = snapshot.themes.filter((row) => row.id === 'crew-night')
    expect(rows).toEqual([expect.objectContaining({ name: 'Crew Night', source: 'built-in' })])
    expect(existsSync(join(mine, 'theme.json'))).toBe(true)
  })

  it('a new workspace added to an install that has data starts in Crew Night', async () => {
    const first = await workspace('first', true)
    expect((await startedStore(first).start()).active).toBe('classic')
    const added = await workspace('added-later', false)
    expect((await startedStore(added).start()).active).toBe('crew-night')
    expect(await choiceOn(added)).toBe('{"theme":"crew-night"}')
  })
})
