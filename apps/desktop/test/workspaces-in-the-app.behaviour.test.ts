import { pinTheDataFolder, workspaceStartup } from '../src/main/data-folder'
import { whoIsOn } from '../src/main/one-host-gate'
import type { EventEmitter } from 'node:events'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { App } from 'electron'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WORKSPACES_CHANNELS, type WorkspaceRow } from '../src/shared/workspaces'
import { startWorkspaces } from '../src/main/workspaces-in-the-app'
import { claimPackagedWorkspace } from '../src/main/workspace-routing-store'
import * as themeDefaults from '../src/main/themes/defaults'
import { BUILT_IN_THEME_IDS, HIDDEN_BASE_THEME_IDS } from '../src/main/themes/defaults'
import { themeRoots } from '../src/main/themes/state'
import { ThemeStore, type ThemeStoreOptions } from '../src/main/themes/store'
import { pngSamples } from './themes/png-samples'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const fake = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  launches: [] as { command: string; args: string[] }[],
  failLaunch: false,
  onWrite: undefined as ((operation: string) => void) | undefined,
}))

vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>()
  return {
    ...fs,
    mkdirSync: (...args: Parameters<typeof fs.mkdirSync>) => {
      fake.onWrite?.('mkdir')
      return fs.mkdirSync(...args)
    },
    writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
      fake.onWrite?.('write')
      return fs.writeFileSync(...args)
    },
    renameSync: (...args: Parameters<typeof fs.renameSync>) => {
      fake.onWrite?.('rename')
      return fs.renameSync(...args)
    },
    linkSync: (...args: Parameters<typeof fs.linkSync>) => {
      fake.onWrite?.('link')
      return fs.linkSync(...args)
    },
    unlinkSync: (...args: Parameters<typeof fs.unlinkSync>) => {
      fake.onWrite?.('unlink')
      return fs.unlinkSync(...args)
    },
    openSync: (...args: Parameters<typeof fs.openSync>) => {
      const flags = args[1]
      if (
        typeof flags === 'string'
          ? /[wa+]/.test(flags)
          : (flags &
              (fs.constants.O_WRONLY |
                fs.constants.O_RDWR |
                fs.constants.O_CREAT |
                fs.constants.O_TRUNC)) !==
            0
      )
        fake.onWrite?.('open-for-write')
      return fs.openSync(...args)
    },
  }
})

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => fake.handlers.set(channel, handler) },
  shell: { trashItem: vi.fn(async () => undefined) },
}))
vi.mock('node:child_process', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    spawn: (command: string, args: string[]) => {
      fake.launches.push({ command, args })
      const child = new EventEmitter() as EventEmitter & { unref: () => void }
      child.unref = () => undefined
      queueMicrotask(() =>
        child.emit(fake.failLaunch ? 'error' : 'spawn', new Error('fictional launch failed')),
      )
      return child
    },
  }
})
vi.mock('../src/main/one-host-gate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/main/one-host-gate')>()),
  whoIsOn: vi.fn(async () => 'open'),
}))

let root: string
let userData: string
let appData: string

const ask = async <T = unknown>(channel: string, ...args: unknown[]): Promise<T> => {
  const handler = fake.handlers.get(channel)
  if (handler === undefined) throw new Error(`No workspace handler on ${channel}`)
  return handler({ sender: null }, ...args) as T
}

beforeEach(() => {
  fake.onWrite = undefined
  root = realpathSync(mkdtempSync(join(tmpdir(), 'brobot-workspace-wiring-')))
  userData = join(root, 'current')
  appData = join(root, 'app-data')
  mkdirSync(userData)
  mkdirSync(appData)
  fake.handlers.clear()
  fake.launches.length = 0
  fake.failLaunch = false
  const paths: Record<string, string> = { userData, appData, home: join(root, 'home') }
  const app = {
    isPackaged: false,
    getPath: (name: string) => paths[name],
    getAppPath: () => join(root, 'fictional-app'),
  } as unknown as App
  startWorkspaces({ app, hidden: true, pickFolder: async () => null })
})

afterEach(() => {
  fake.onWrite = undefined
  fake.handlers.clear()
  rmSync(root, { recursive: true, force: true })
})

it('lists the hidden launch itself and offers new workspaces beside its temporary data folder', async () => {
  const rows = await ask<WorkspaceRow[]>(WORKSPACES_CHANNELS.list)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ path: userData, isThisOne: true, state: 'open' })
  expect(await ask(WORKSPACES_CHANNELS.folderFor, 'Notes')).toBe(
    join(root, 'BroBot workspaces', 'Notes'),
  )
  expect(await ask(WORKSPACES_CHANNELS.chooseFolder)).toBeNull()
  expect(existsSync(join(userData, 'workspaces.json'))).toBe(false)
})

it('creates a named sibling, asks for a separate launch, and then lists it as open', async () => {
  const path = join(root, 'new-notes')
  expect(await ask(WORKSPACES_CHANNELS.create, { name: 'Notes', path })).toMatchObject({
    opened: true,
    path,
  })
  expect(fake.launches).toHaveLength(1)
  expect(fake.launches.at(0)?.args.join(' ')).toContain(path)
  expect(JSON.parse(readFileSync(join(path, 'workspace.json'), 'utf8'))).toMatchObject({
    name: 'Notes',
  })
  const rows = await ask<WorkspaceRow[]>(WORKSPACES_CHANNELS.list)
  expect(rows.find((row) => row.path === path)).toMatchObject({
    name: 'Notes',
    state: 'open',
    isThisOne: false,
  })
})

it('opens a listed sibling using its recorded spelling, then renames and forgets it', async () => {
  const path = join(root, 'archive')
  mkdirSync(path)
  writeFileSync(join(path, 'brobot2.sqlite'), '')
  expect(await ask(WORKSPACES_CHANNELS.open, path)).toMatchObject({ opened: true, path })
  expect(await ask(WORKSPACES_CHANNELS.rename, { path, name: 'Archive' })).toEqual({ done: true })
  expect(
    (await ask<WorkspaceRow[]>(WORKSPACES_CHANNELS.list)).find((row) => row.path === path),
  ).toMatchObject({ name: 'Archive' })
  expect(await ask(WORKSPACES_CHANNELS.remove, path)).toEqual({ done: true })
  expect((await ask<WorkspaceRow[]>(WORKSPACES_CHANNELS.list)).map((row) => row.path)).toEqual([
    userData,
  ])
  expect(existsSync(join(path, 'brobot2.sqlite'))).toBe(true)
})

it('refuses paths outside the hidden launch and malformed requests without starting anything', async () => {
  const outside = dirname(root)
  expect(await ask(WORKSPACES_CHANNELS.open, outside)).toMatchObject({ opened: false })
  expect(await ask(WORKSPACES_CHANNELS.create, { name: 'No', path: outside })).toMatchObject({
    opened: false,
  })
  expect(await ask(WORKSPACES_CHANNELS.open, 42)).toEqual({
    opened: false,
    refusal: 'A workspace is a folder’s path.',
  })
  expect(await ask(WORKSPACES_CHANNELS.create, { name: '' })).toEqual({
    opened: false,
    refusal: 'A new workspace needs a name.',
  })
  expect(await ask(WORKSPACES_CHANNELS.remove, userData)).toEqual({
    done: false,
    refusal: 'This is the workspace this window runs on.',
  })
  expect(fake.launches).toHaveLength(0)
})

it('reports a failed launch and leaves the new folder available to retry', async () => {
  fake.failLaunch = true
  const path = join(root, 'try-again')
  expect(await ask(WORKSPACES_CHANNELS.create, { name: 'Try again', path })).toMatchObject({
    opened: false,
    refusal: expect.stringContaining('fictional launch failed'),
  })
  expect(existsSync(join(path, 'workspace.json'))).toBe(true)
  expect((await ask<WorkspaceRow[]>(WORKSPACES_CHANNELS.list)).map((row) => row.path)).toEqual([
    userData,
  ])
  fake.failLaunch = false
  expect(await ask(WORKSPACES_CHANNELS.open, path)).toMatchObject({ opened: true, path })
})

it('a public dev window refuses packaged-owned folders before checks, reads or spawn', async () => {
  vi.mocked(whoIsOn).mockClear()
  const reserved = ['copper', 'fern', 'birch'].map((name) => join(root, name))
  mkdirSync(join(appData, '@brobot2'), { recursive: true })
  writeFileSync(
    join(appData, '@brobot2', 'packaged-workspaces.json'),
    JSON.stringify({
      version: 1,
      workspaces: reserved.map((path, lastOpenedAt) => ({ path, lastOpenedAt })),
    }),
  )
  // Stale legacy entries must disappear without asking those folders for their names or gates.
  writeFileSync(
    join(appData, '@brobot2', 'workspaces.json'),
    JSON.stringify({
      version: 1,
      workspaces: reserved.map((path, lastOpenedAt) => ({ path, lastOpenedAt })),
    }),
  )
  fake.handlers.clear()
  const paths: Record<string, string> = { userData, appData, home: join(root, 'home') }
  startWorkspaces({
    app: {
      isPackaged: false,
      getPath: (name: string) => paths[name],
      getAppPath: () => join(root, 'fictional-app'),
    } as unknown as App,
    hidden: false,
    pickFolder: async () => null,
  })
  for (const folder of reserved) {
    expect(await ask(WORKSPACES_CHANNELS.open, folder)).toEqual({
      opened: false,
      refusal: 'This workspace opens in the BroCrew app in Applications.',
    })
    expect(await ask(WORKSPACES_CHANNELS.checkFolder, folder, false)).toMatchObject({
      ok: false,
      refusal: 'This workspace opens in the BroCrew app in Applications.',
    })
    expect(await ask(WORKSPACES_CHANNELS.create, { path: folder, name: 'Copper' })).toMatchObject({
      opened: false,
    })
    expect(existsSync(folder)).toBe(false)
  }
  expect(fake.launches).toEqual([])
  const rows = await ask<WorkspaceRow[]>(WORKSPACES_CHANNELS.list)
  expect(rows.map((row) => row.path)).toEqual([userData])
  expect(vi.mocked(whoIsOn).mock.calls.filter(([folder]) => reserved.includes(folder))).toEqual([])
})

it('the one packaged executable opens another workspace and Finder subsequently reopens that one', async () => {
  const copper = join(root, 'copper'),
    fern = join(root, 'fern')
  for (const folder of [copper, fern]) {
    mkdirSync(folder)
    writeFileSync(join(folder, 'brobot2.sqlite'), '')
  }
  const config = join(appData, '@brobot2'),
    appPath = join(root, 'packaged')
  mkdirSync(config, { recursive: true })
  mkdirSync(appPath)
  writeFileSync(join(appPath, 'package.json'), JSON.stringify({ requireWorkspacePolicy: true }))
  writeFileSync(
    join(config, 'workspace-policy.json'),
    JSON.stringify({
      version: 1,
      firstWorkspace: copper,
      packagedForbidden: [join(config, 'desktop')],
      developmentForbidden: [copper, fern],
    }),
  )
  const set: string[] = []
  const paths: Record<string, string> = { userData: copper, appData, home: join(root, 'home') }
  const app = {
    isPackaged: true,
    getAppPath: () => appPath,
    getPath: (name: string) => paths[name]!,
    setPath: (_name: string, folder: string) => set.push(folder),
    commandLine: { hasSwitch: () => false },
  }
  fake.handlers.clear()
  startWorkspaces({ app: app as unknown as App, hidden: false, pickFolder: async () => null })
  expect(await ask(WORKSPACES_CHANNELS.open, fern)).toMatchObject({ opened: true, path: fern })
  expect(fake.launches).toEqual([
    process.platform === 'win32'
      ? { command: process.execPath, args: [`--user-data-dir=${fern}`] }
      : {
          command: '/bin/sh',
          args: [
            '-c',
            '"$0" "$@" </dev/null >/dev/null 2>&1 &',
            process.execPath,
            `--user-data-dir=${fern}`,
          ],
        },
  ])
  pinTheDataFolder(app)
  expect(set).toEqual([fern])
  rmSync(join(config, 'workspace-policy.json'))
  await expect(ask(WORKSPACES_CHANNELS.open, join(config, 'desktop'))).rejects.toThrow(
    "couldn't read its list of workspaces",
  )
  expect(fake.launches).toHaveLength(1)
})

it('explicit configured creation supplies its first database before requesting the separate launch', async () => {
  const config = join(appData, '@brobot2'),
    appPath = join(root, 'packaged'),
    target = join(root, 'birch')
  mkdirSync(config, { recursive: true })
  mkdirSync(appPath)
  writeFileSync(join(appPath, 'package.json'), JSON.stringify({ requireWorkspacePolicy: true }))
  writeFileSync(
    join(config, 'workspace-policy.json'),
    JSON.stringify({
      version: 1,
      firstWorkspace: userData,
      packagedForbidden: [],
      developmentForbidden: [],
    }),
  )
  writeFileSync(
    join(config, 'packaged-workspaces.json'),
    JSON.stringify({ version: 1, workspaces: [{ path: userData, lastOpenedAt: 1 }] }),
  )
  fake.handlers.clear()
  startWorkspaces({
    app: {
      isPackaged: true,
      getPath: (name: string) =>
        ({ userData, appData, home: root })[name as 'userData' | 'appData' | 'home'],
      getAppPath: () => appPath,
    } as unknown as App,
    hidden: true,
    pickFolder: async () => null,
  })
  expect(await ask(WORKSPACES_CHANNELS.create, { name: 'Birch', path: target })).toMatchObject({
    opened: true,
  })
  expect(readFileSync(join(target, 'brobot2.sqlite')).length).toBe(0)
  const child = {
    isPackaged: true,
    getPath: (name: 'appData' | 'userData') => (name === 'appData' ? appData : target),
    getAppPath: () => appPath,
    setPath: () => {},
    commandLine: { hasSwitch: (name: string) => ['brobot-hidden', 'user-data-dir'].includes(name) },
  }
  pinTheDataFolder(child)
  expect(() => workspaceStartup(child)?.assertDatabase()).not.toThrow()
  expect(fake.launches).toHaveLength(1)
})

it.each(['listed', 'owned', 'reserved'] as const)(
  'Create admission refuses missing %s targets before writing',
  async (kind) => {
    const config = join(appData, '@brobot2'),
      appPath = join(root, 'packaged')
    const target = join(root, 'copper'),
      firstReserved = join(root, 'reserved-first')
    mkdirSync(config, { recursive: true })
    mkdirSync(appPath)
    writeFileSync(join(appPath, 'package.json'), JSON.stringify({ requireWorkspacePolicy: true }))
    writeFileSync(
      join(config, 'workspace-policy.json'),
      JSON.stringify({
        version: 1,
        firstWorkspace: kind === 'reserved' ? firstReserved : userData,
        packagedForbidden: [],
        developmentForbidden: kind === 'reserved' ? [target] : [],
      }),
    )
    const rows = [{ path: userData, lastOpenedAt: 1 }]
    if (kind === 'listed') rows.push({ path: target, lastOpenedAt: 2 })
    writeFileSync(
      join(config, 'packaged-workspaces.json'),
      JSON.stringify({ version: 1, workspaces: rows }),
    )
    if (kind === 'owned') claimPackagedWorkspace(appData, target)
    fake.handlers.clear()
    startWorkspaces({
      app: {
        isPackaged: true,
        getPath: (name: string) =>
          ({ userData, appData, home: root })[name as 'userData' | 'appData' | 'home'],
        getAppPath: () => appPath,
      } as unknown as App,
      hidden: false,
      pickFolder: async () => null,
    })
    const writes: string[] = [],
      targets = kind === 'reserved' ? [target, firstReserved] : [target]
    fake.onWrite = (operation) => writes.push(operation)
    const observed = []
    for (const path of targets) {
      const preview = await ask<{ ok: boolean; refusal: string | null }>(
        WORKSPACES_CHANNELS.checkFolder,
        path,
        true,
      )
      const created = await ask(WORKSPACES_CHANNELS.create, { name: 'Copper', path })
      observed.push({
        preview: { ok: preview.ok, refusal: preview.refusal },
        created,
        exists: existsSync(path),
      })
    }
    fake.onWrite = undefined
    expect({ observed, writes, launches: fake.launches.length }).toEqual({
      observed: targets.map(() => ({
        preview: { ok: false, refusal: "This workspace can't be opened in this app." },
        created: { opened: false, refusal: "This workspace can't be opened in this app." },
        exists: false,
      })),
      writes: [],
      launches: 0,
    })
  },
)

it.each(['open', 'closed'] as const)(
  'the installed app says plainly that a development build keeps the default folder (that window %s)',
  async (state) => {
    const config = join(appData, '@brobot2'),
      appPath = join(root, 'packaged'),
      main = join(config, 'desktop'),
      copper = join(root, 'copper')
    for (const folder of [main, copper]) {
      mkdirSync(folder, { recursive: true })
      writeFileSync(join(folder, 'brobot2.sqlite'), '')
    }
    mkdirSync(appPath)
    writeFileSync(join(appPath, 'package.json'), '{}')
    writeFileSync(
      join(config, 'workspace-policy.json'),
      JSON.stringify({
        version: 1,
        firstWorkspace: copper,
        packagedForbidden: [main],
        developmentForbidden: [copper],
      }),
    )
    writeFileSync(
      join(config, 'packaged-workspaces.json'),
      JSON.stringify({ version: 1, workspaces: [{ path: copper, lastOpenedAt: 1 }] }),
    )
    vi.mocked(whoIsOn).mockImplementation(async (folder) => (folder === main ? state : 'closed'))
    fake.handlers.clear()
    startWorkspaces({
      app: {
        isPackaged: true,
        getPath: (name: string) =>
          ({ userData: copper, appData, home: root })[name as 'userData' | 'appData' | 'home'],
        getAppPath: () => appPath,
      } as unknown as App,
      hidden: false,
      pickFolder: async () => null,
    })
    const plainly =
      'This workspace opens in a development build of BroCrew, not in this app. Open it from that build.'
    expect(await ask(WORKSPACES_CHANNELS.open, main)).toEqual({ opened: false, refusal: plainly })
    expect(await ask(WORKSPACES_CHANNELS.checkFolder, main, false)).toMatchObject({
      ok: false,
      refusal: plainly,
    })
    expect(fake.launches).toEqual([])
    expect((await ask<WorkspaceRow[]>(WORKSPACES_CHANNELS.list)).map((row) => row.path)).toEqual([
      copper,
    ])
    vi.mocked(whoIsOn).mockImplementation(async () => 'open')
  },
)

/** The look `folder` starts in, read by the theme store as the app starts it there. */
async function theLookItStartsIn(folder: string): Promise<string> {
  const app = themeDefaults as unknown as {
    themeDefaultsFor?: (folder: string) => Record<string, string>
    defaultThemeFor?: (folder: string) => string
  }
  mkdirSync(join(appData, '@brobot2'), { recursive: true })
  const store = new ThemeStore({
    ...themeRoots({
      appData,
      userData: folder,
      resources: join(__dirname, '../resources'),
      hidden: false,
    }),
    ...(app.themeDefaultsFor?.(folder) ?? {
      defaultTheme: app.defaultThemeFor?.(folder) ?? themeDefaults.DEFAULT_THEME_ID,
    }),
    writesItsDefault: true,
    builtInIds: BUILT_IN_THEME_IDS,
    hiddenBases: HIDDEN_BASE_THEME_IDS,
    loader: {
      sample: (bytes: Buffer, facts: { type: string }) =>
        facts.type === 'png' ? pngSamples(bytes) : null,
    },
    problem: () => 'fictional',
    trash: async () => undefined,
    openFolder: async () => undefined,
    watch: () => () => {},
  } as unknown as ThemeStoreOptions)
  try {
    return (await store.start()).active
  } finally {
    await store.close()
  }
}

it('a workspace made here starts in Crew Night', async () => {
  const path = join(root, 'Notes')
  expect(await ask(WORKSPACES_CHANNELS.create, { name: 'Notes', path })).toMatchObject({
    opened: true,
  })
  expect(await theLookItStartsIn(path)).toBe('crew-night')
})

it('a workspace made here starts in Crew Night, though its first database is made before it opens', async () => {
  const config = join(appData, '@brobot2'),
    appPath = join(root, 'packaged'),
    target = join(root, 'birch')
  mkdirSync(config, { recursive: true })
  mkdirSync(appPath)
  writeFileSync(join(appPath, 'package.json'), JSON.stringify({ requireWorkspacePolicy: true }))
  writeFileSync(
    join(config, 'workspace-policy.json'),
    JSON.stringify({
      version: 1,
      firstWorkspace: userData,
      packagedForbidden: [],
      developmentForbidden: [],
    }),
  )
  writeFileSync(
    join(config, 'packaged-workspaces.json'),
    JSON.stringify({ version: 1, workspaces: [{ path: userData, lastOpenedAt: 1 }] }),
  )
  fake.handlers.clear()
  startWorkspaces({
    app: {
      isPackaged: true,
      getPath: (name: string) =>
        ({ userData, appData, home: root })[name as 'userData' | 'appData' | 'home'],
      getAppPath: () => appPath,
    } as unknown as App,
    hidden: true,
    pickFolder: async () => null,
  })
  expect(await ask(WORKSPACES_CHANNELS.create, { name: 'Birch', path: target })).toMatchObject({
    opened: true,
  })
  expect(existsSync(join(target, 'brobot2.sqlite'))).toBe(true)
  expect(await theLookItStartsIn(target)).toBe('crew-night')
})
