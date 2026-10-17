import { spawn } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { NESTED_USERDATA_SIGNS } from '../../../scripts/lib/clean-base.mjs'
import { pinTheDataFolder, workspaceOf, type PinnableApp } from '../src/main/data-folder'
import { claimSoleHost, hostGatePath, whoIsOn } from '../src/main/one-host-gate'
import {
  argumentsToOpen,
  asStartedOn,
  aWorkspaceName,
  BROBOT_FOLDER_SIGNS,
  checkWorkspaceFolder,
  folderForANewWorkspace,
  forgetWorkspace,
  howToStart,
  isWithin,
  makeWorkspaceFolder,
  nameWorkspace,
  readWorkspaceList,
  rememberWorkspace,
  workspaceListFile,
  workspaceRows,
} from '../src/main/workspaces'
import { sameFolder, samePath } from '../src/main/same-folder'

/**
 * 🔴 **W4.131 · A2 — the workspaces a person has opened, and opening another** (`workspaces.ts`).
 *
 *  - §1 · the list: beside every workspace, written whole, a person's launch first.
 *  - §2 · no launch reads the workspace list to choose its folder: with no list, a broken one, or
 *    one whose folders are all gone, a launch opens straight into its own folder.
 *  - §3 · what may be a workspace: empty or BroBot's, never inside another, never on a network
 *    share; a long path and a cloud-synced one warned.
 *  - §4 · a new workspace's name and folder.
 *  - §5 · the arguments that open one: built, never copied; and started as nobody's child.
 *  - §6 · the chooser's rows.
 *  - §7 · whether one runs now: its gate, asked.
 */

const here = dirname(fileURLToPath(import.meta.url))
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
/** A throwaway folder, by its real path (macOS's /tmp is a link). */
const aFolder = (): string => {
  const made = realpathSync(mkdtempSync(join(tmpdir(), 'brobot-ws-')))
  roots.push(made)
  return made
}
/** A folder that is a BroBot workspace: it holds a database. */
const aWorkspace = (parent: string, name: string): string => {
  const folder = join(parent, name)
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'brobot2.sqlite'), '')
  return folder
}

describe('§1 · the list', () => {
  it('🔴 beside every workspace for a person’s launch; a hidden launch keeps its own', () => {
    const where = { appData: '/A', userData: '/A/@brobot2/desktop' }
    expect(workspaceListFile({ ...where, hidden: false })).toBe(
      join('/A', '@brobot2', 'workspaces.json'),
    )
    expect(workspaceListFile({ ...where, hidden: true })).toBe(
      join('/A/@brobot2/desktop', 'workspaces.json'),
    )
  })

  it('🔴 a launch puts its own folder first, with when; once, however it is spelled', () => {
    const root = aFolder()
    const file = join(root, 'workspaces.json')
    const one = aWorkspace(root, 'one')
    const two = aWorkspace(root, 'two')
    rememberWorkspace(file, one, 1_000)
    rememberWorkspace(file, two, 2_000)
    rememberWorkspace(file, join(root, 'two', '..', 'one'), 3_000)
    expect(readWorkspaceList(file)).toEqual([
      { path: join(root, 'two', '..', 'one'), lastOpenedAt: 3_000 },
      { path: two, lastOpenedAt: 2_000 },
    ])
    expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(1)
    // ⚑ Written whole: nothing is left beside it.
    expect(readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('⚑ a symlinked spelling is the same folder; a folder that is not there, by its spelling', () => {
    const root = aFolder()
    const one = aWorkspace(root, 'one')
    symlinkSync(one, join(root, 'link'))
    expect(sameFolder(join(root, 'link'), one)).toBe(true)
    expect(sameFolder(join(root, 'gone'), join(root, 'x', '..', 'gone'))).toBe(true)
    expect(sameFolder(join(root, 'gone'), join(root, 'one'))).toBe(false)
  })

  it('⚑ by spelling: resolved, and case-blind where the system’s disks usually are', () => {
    expect(samePath('/a/B', '/a/x/../b', 'darwin')).toBe(true)
    expect(samePath('/a/B', '/a/b', 'win32')).toBe(true)
    expect(samePath('/a/B', '/a/b', 'linux')).toBe(false)
    expect(samePath('/a/b', '/a/b/', 'linux')).toBe(true)
  })

  it('⛔ a launch reads no other listed folder: its own is matched by spelling alone', () => {
    // ⚑ A listed folder on a share that is gone would hold a launch up for as long as it is asked.
    const core = readFileSync(join(here, '../src/main/workspaces.ts'), 'utf8')
    const remember = core.slice(
      core.indexOf('export function rememberWorkspace('),
      core.indexOf('/** Take `path` off the list.'),
    )
    expect(remember).toContain('!samePath(one.path, path)')
    expect(remember).not.toMatch(/sameFolder|statSync|existsSync|realpath/)
  })

  it('⚑ taken off the list, its folder left as it is', () => {
    const root = aFolder()
    const file = join(root, 'workspaces.json')
    const one = aWorkspace(root, 'one')
    rememberWorkspace(file, one, 1)
    forgetWorkspace(file, one, 2)
    expect(readWorkspaceList(file)).toEqual([])
    expect(existsSync(join(one, 'brobot2.sqlite'))).toBe(true)
  })

  it('⚑ a list that is not JSON is no list; a launch replaces it with its own folder', () => {
    const root = aFolder()
    const file = join(root, 'workspaces.json')
    for (const text of ['{', '[]', '{"workspaces": "x"}', '{"workspaces": [{"path": 3}]}']) {
      writeFileSync(file, text)
      expect(readWorkspaceList(file), text).toEqual([])
    }
    rememberWorkspace(file, root, 5)
    expect(readWorkspaceList(file)).toEqual([{ path: root, lastOpenedAt: 5 }])
  })

  it('⛔ a list it cannot read now, or a newer one, is never written over with one row', () => {
    const root = aFolder()
    const newer = join(root, 'newer.json')
    const said = JSON.stringify({ version: 2, workspaces: [{ path: '/w', lastOpenedAt: 1 }] })
    writeFileSync(newer, said)
    expect(() => rememberWorkspace(newer, root, 5)).toThrow(/newer/)
    expect(() => forgetWorkspace(newer, '/w', 5)).toThrow(/newer/)
    expect(readFileSync(newer, 'utf8')).toBe(said)
    // ⚑ Not "not there": a list that is, but cannot be read (here, a folder in its place).
    const unreadable = join(root, 'unreadable.json')
    mkdirSync(unreadable)
    expect(() => rememberWorkspace(unreadable, root, 5)).toThrow()
    expect(statSync(unreadable).isDirectory()).toBe(true)
  })

  it('⚑ what a row says that this build does not know is kept', () => {
    const root = aFolder()
    const file = join(root, 'workspaces.json')
    writeFileSync(
      file,
      JSON.stringify({ version: 1, workspaces: [{ path: '/w', lastOpenedAt: 1, colour: 'blue' }] }),
    )
    rememberWorkspace(file, root, 5)
    expect(JSON.parse(readFileSync(file, 'utf8')).workspaces).toEqual([
      { path: root, lastOpenedAt: 5 },
      { path: '/w', lastOpenedAt: 1, colour: 'blue' },
    ])
  })

  it('⚑ a temporary file a killed write left is taken away by a later one, a fresh one is not', () => {
    const root = aFolder()
    const file = join(root, 'workspaces.json')
    const stale = `${file}.111.tmp`
    const fresh = `${file}.222.tmp`
    writeFileSync(stale, '{')
    writeFileSync(fresh, '{')
    const now = Date.now()
    utimesSync(stale, new Date(now - 120_000), new Date(now - 120_000))
    rememberWorkspace(file, root, now)
    expect(existsSync(stale)).toBe(false)
    expect(existsSync(fresh)).toBe(true)
  })
})

describe('§2 · ⛔ no launch reads the list to choose its folder', () => {
  /** Electron's `app`, as the pin sees it: what it set. */
  function anApp(appData: string, switches: readonly string[] = []) {
    const set: [string, string][] = []
    const app: PinnableApp = {
      getPath: () => appData,
      setPath: (name, path) => {
        set.push([name, path])
      },
      commandLine: { hasSwitch: (name) => switches.includes(name) },
    }
    return { app, set }
  }

  it('🔴 with no list, a broken one, or one whose folders are all gone: straight into its own folder', () => {
    for (const list of [
      null,
      '{ not json',
      JSON.stringify({
        version: 1,
        workspaces: [
          { path: '/gone/one', lastOpenedAt: 9 },
          { path: '/gone/two', lastOpenedAt: 8 },
        ],
      }),
    ]) {
      const appData = aFolder()
      mkdirSync(join(appData, '@brobot2'), { recursive: true })
      if (list !== null) writeFileSync(join(appData, '@brobot2', 'workspaces.json'), list)
      const { app, set } = anApp(appData)
      pinTheDataFolder(app)
      expect(set, String(list)).toEqual([['userData', join(appData, '@brobot2', 'desktop')]])
      // ⚑ …and one that names its own folder keeps it, list or none.
      const named = anApp(appData, ['user-data-dir'])
      pinTheDataFolder(named.app)
      expect(named.set, String(list)).toEqual([])
    }
  })

  it('⛔ the code that decides a launch’s folder never names the list', () => {
    const dataFolder = readFileSync(join(here, '../src/main/data-folder.ts'), 'utf8')
    expect(dataFolder).not.toMatch(/workspaces\.json|readWorkspaceList|workspaceRows/)
    const index = readFileSync(join(here, '../src/main/index.ts'), 'utf8')
    expect(index).not.toMatch(/readWorkspaceList|workspaceRows|workspaces\.json/)
    // ⚑ The list is touched only once the app runs, from `start()`'s `whenReady`.
    const ready = index.indexOf('    .whenReady()')
    const started = index.indexOf('      startWorkspaces({')
    expect(ready).toBeGreaterThan(-1)
    expect(started).toBeGreaterThan(ready)
    expect(index.indexOf('pinTheDataFolder(app)')).toBeLessThan(ready)
  })

  it('⚑ a person’s launch adds itself, never waits on it, and a list it cannot write changes nothing', () => {
    const wired = readFileSync(join(here, '../src/main/workspaces-in-the-app.ts'), 'utf8')
    expect(wired).toContain(
      '  if (!options.hidden) {\n    try {\n      rememberWorkspace(listFile, userData, Date.now())\n    } catch (error) {',
    )
    // ⚑ What it would throw on: a list whose folder is a file.
    const root = aFolder()
    writeFileSync(join(root, 'file'), '')
    expect(() => rememberWorkspace(join(root, 'file', 'workspaces.json'), root, 1)).toThrow()
  })
})

describe('§3 · what may be a workspace', () => {
  const as = (toMake: boolean, listed: readonly string[] = []) => ({
    toMake,
    listed,
    platform: 'darwin' as const,
  })

  it('🔴 an empty folder, or a BroBot workspace — never a folder of somebody’s files', () => {
    const root = aFolder()
    const empty = join(root, 'empty')
    mkdirSync(empty)
    writeFileSync(join(empty, '.DS_Store'), '')
    expect(checkWorkspaceFolder(empty, as(false))).toMatchObject({ ok: true, isBroBots: false })
    // ⚑ A workspace made and never started holds its name only: it can be opened.
    nameWorkspace(empty, 'Research')
    expect(checkWorkspaceFolder(empty, as(false))).toMatchObject({ ok: true, isBroBots: false })
    const brobots = aWorkspace(root, 'brobots')
    writeFileSync(join(brobots, 'notes.txt'), 'x')
    expect(checkWorkspaceFolder(brobots, as(false))).toMatchObject({ ok: true, isBroBots: true })
    const documents = join(root, 'documents')
    mkdirSync(documents)
    writeFileSync(join(documents, 'letter.txt'), 'x')
    expect(checkWorkspaceFolder(documents, as(false)).refusal).toMatch(/has files in it/)
    expect(checkWorkspaceFolder(join(documents, 'letter.txt'), as(false)).refusal).toMatch(
      /a file, not a folder/,
    )
  })

  it('⚑ a missing folder is not found — unless it is one to make', () => {
    const root = aFolder()
    const missing = join(root, 'missing')
    expect(checkWorkspaceFolder(missing, as(false))).toMatchObject({
      ok: false,
      refusal: `Not found — ${missing}`,
      exists: false,
    })
    expect(checkWorkspaceFolder(missing, as(true))).toMatchObject({ ok: true, exists: false })
  })

  it('⛔ never inside another workspace, nor inside a listed one', () => {
    const root = aFolder()
    const outer = aWorkspace(root, 'outer')
    const nested = join(outer, 'deeper', 'inner')
    expect(checkWorkspaceFolder(nested, as(true)).refusal).toBe(
      `This folder is inside the workspace ${outer}.`,
    )
    const listed = join(root, 'listed')
    mkdirSync(listed)
    expect(checkWorkspaceFolder(join(listed, 'x'), as(true, [listed])).refusal).toBe(
      `This folder is inside the workspace ${listed}.`,
    )
    // ⚑ The listed folder itself is not inside itself.
    expect(checkWorkspaceFolder(listed, as(false, [listed])).ok).toBe(true)
  })

  it('⛔ read on the disk: a link into a workspace, and a link into a listed folder', () => {
    const root = aFolder()
    const outer = aWorkspace(root, 'outer')
    mkdirSync(join(outer, 'deeper'))
    symlinkSync(join(outer, 'deeper'), join(root, 'into'))
    expect(checkWorkspaceFolder(join(root, 'into', 'inner'), as(true)).refusal).toBe(
      `This folder is inside the workspace ${outer}.`,
    )
    const listed = join(root, 'listed')
    mkdirSync(listed)
    symlinkSync(listed, join(root, 'listed-link'))
    expect(checkWorkspaceFolder(join(root, 'listed-link', 'x'), as(true, [listed])).refusal).toBe(
      `This folder is inside the workspace ${listed}.`,
    )
    // ⚑ …and by its spelling as asked, case-blind on macOS.
    expect(checkWorkspaceFolder(join(root, 'LISTED', 'x'), as(true, [listed])).refusal).toBe(
      `This folder is inside the workspace ${listed}.`,
    )
  })

  it('⛔ no listed folder is read: one on a share that is gone cannot hold the window up', () => {
    const core = readFileSync(join(here, '../src/main/workspaces.ts'), 'utf8')
    const checking = core.slice(
      core.indexOf('export function checkWorkspaceFolder('),
      core.indexOf('/** A name as a person typed it'),
    )
    expect(checking).toContain('insideBySpelling(spelling, one, options.platform)')
    expect(checking).not.toContain('sameFolder')
    const wired = readFileSync(join(here, '../src/main/workspaces-in-the-app.ts'), 'utf8')
    expect(wired).toContain(
      'listed().find((one) => samePath(one, folder) || samePath(one, started)) ?? null',
    )
  })

  it('⚑ a folder it cannot read is refused, never a throw', () => {
    if (process.platform === 'win32' || process.getuid?.() === 0) return
    const root = aFolder()
    const locked = join(root, 'locked')
    mkdirSync(locked)
    chmodSync(locked, 0o000)
    try {
      expect(checkWorkspaceFolder(locked, as(false)).refusal).toMatch(/cannot read this folder/)
    } finally {
      chmodSync(locked, 0o700)
    }
  })

  it('⛔ never a network share on Windows', () => {
    expect(
      checkWorkspaceFolder('\\\\server\\share\\w', { toMake: true, listed: [], platform: 'win32' })
        .refusal,
    ).toMatch(/network share/)
  })

  it('⚑ a folder a cloud service syncs is warned, not refused', () => {
    const root = aFolder()
    for (const synced of [
      join(root, 'Library', 'CloudStorage', 'Dropbox-x', 'w'),
      join(root, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'w'),
      join(root, 'OneDrive', 'w'),
      join(root, 'OneDrive - Contoso', 'w'),
      join(root, 'Dropbox (Team)', 'w'),
    ]) {
      const verdict = checkWorkspaceFolder(synced, as(true))
      expect(verdict.ok, synced).toBe(true)
      expect(verdict.warning, synced).toMatch(/cloud service syncs/)
    }
  })

  it('⚑ a path too long for the gate’s socket keeps its gate outside it, and is not warned', () => {
    const root = aFolder()
    const long = join(root, 'a'.repeat(110))
    expect(checkWorkspaceFolder(long, as(true))).toMatchObject({ ok: true, warning: null })
    expect(checkWorkspaceFolder(join(root, 'short'), as(true)).warning).toBeNull()
    expect(
      checkWorkspaceFolder(long, { toMake: true, listed: [], platform: 'win32' }).warning,
    ).toBeNull()
  })

  it('⚑ …whatever TMPDIR says, since the gate outside is in a fixed folder of this user’s', () => {
    const root = aFolder()
    const long = join(root, 'a'.repeat(110))
    const temporary = process.env['TMPDIR']
    process.env['TMPDIR'] = join('/', 't'.repeat(120))
    try {
      expect(checkWorkspaceFolder(long, as(true))).toMatchObject({ ok: true, warning: null })
    } finally {
      if (temporary === undefined) delete process.env['TMPDIR']
      else process.env['TMPDIR'] = temporary
    }
  })

  it('⚑ the warning is the gate’s own length rule, which holds the longer of its two names', () => {
    const source = readFileSync(join(here, '../src/main/workspaces.ts'), 'utf8')
    expect(source).toContain('!gateFits(real, options.platform)')
    expect(source).not.toMatch(/hostGatePath|socketPathMax/)
  })

  it('⚑ the signs of a workspace are the ones a reset reads a nested data folder by', () => {
    expect([...BROBOT_FOLDER_SIGNS]).toEqual([...NESTED_USERDATA_SIGNS])
  })
})

describe('§4 · a new workspace’s name and folder', () => {
  it('⚑ a name as typed, made one that may be shown; nothing left is no name', () => {
    expect(aWorkspaceName('  Research  ')).toBe('Research')
    expect(aWorkspaceName('Re\u0007se‎arch')).toBe('Research')
    expect(aWorkspaceName('   ')).toBeNull()
    expect(aWorkspaceName('x'.repeat(100))).toHaveLength(64)
  })

  it('🔴 ~/BroBot workspaces/<name>, made safe for a file system, and the next free one when taken', () => {
    const home = aFolder()
    expect(folderForANewWorkspace(home, 'Research')).toBe(
      join(home, 'BroBot workspaces', 'Research'),
    )
    expect(folderForANewWorkspace(home, 'a/b: c?.')).toBe(join(home, 'BroBot workspaces', 'a b c'))
    aWorkspace(join(home, 'BroBot workspaces'), 'Research')
    expect(folderForANewWorkspace(home, 'Research')).toBe(
      join(home, 'BroBot workspaces', 'Research 2'),
    )
    // ⚑ An empty folder of that name is offered as it is.
    mkdirSync(join(home, 'BroBot workspaces', 'Empty'))
    expect(folderForANewWorkspace(home, 'Empty')).toBe(join(home, 'BroBot workspaces', 'Empty'))
    // ⚑ Never a name Windows keeps for a device — which it reads before the first dot.
    for (const [name, folder] of [
      ['con', 'Workspace con'],
      ['LPT1.', 'Workspace LPT1'],
      ['nul.txt', 'Workspace nul.txt'],
      ['aux .tar.gz', 'Workspace aux .tar.gz'],
      ['console', 'console'],
    ] as const) {
      expect(folderForANewWorkspace(home, name), name).toBe(join(home, 'BroBot workspaces', folder))
    }
  })

  it('⚑ a new workspace’s folder is this account’s only, as the default one is', async () => {
    const home = aFolder()
    const folder = join(home, 'BroBot workspaces', 'Research')
    expect(await makeWorkspaceFolder(folder, 'Research')).toBeNull()
    expect(workspaceOf(folder, false).name).toBe('Research')
    if (process.platform !== 'win32') {
      expect(statSync(folder).mode & 0o777).toBe(0o700)
      expect(statSync(dirname(folder)).mode & 0o777).toBe(0o700)
    }
  })

  it('🔴 its name is kept in its folder, and read back as the workspace’s', () => {
    const folder = aWorkspace(aFolder(), 'w')
    nameWorkspace(folder, 'Research')
    expect(workspaceOf(folder, false).name).toBe('Research')
    expect(readdirSync(folder).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
})

describe('§5 · the arguments that open a workspace: built, never copied', () => {
  it('🔴 the folder, and nothing of this launch’s own', () => {
    expect(
      argumentsToOpen('/w/Research', { packaged: true, appPath: '/app', hidden: false }),
    ).toEqual(['--user-data-dir=/w/Research'])
    // ⚑ A development build is `electron <app> …`.
    expect(
      argumentsToOpen('/w/R', { packaged: false, appPath: '/dev/app', hidden: false }),
    ).toEqual(['/dev/app', '--user-data-dir=/w/R'])
    // ⚑ A hidden launch — a test — opens it hidden too: no test puts a window on a person's screen.
    expect(argumentsToOpen('/w/R', { packaged: true, appPath: '/app', hidden: true })).toEqual([
      '--user-data-dir=/w/R',
      '--brobot-hidden',
    ])
    const wired = readFileSync(join(here, '../src/main/workspaces-in-the-app.ts'), 'utf8')
    expect(wired).not.toMatch(/process\.argv|remote-debugging/)
    // ⛔ A hidden launch never offers a new workspace in a person's home.
    expect(wired).toContain("  const home = app.getPath('home')")
    expect(wired).toContain('const newWorkspacesHome = options.hidden ? dirname(userData) : home')
    expect(wired.match(/getPath\('home'\)/g)).toHaveLength(1)
    // ⚑ Its environment is built too; a development build keeps its renderer's address.
    expect(wired).toContain(
      "env: builtEnvironment(process.env, app.isPackaged ? [] : ['ELECTRON_RENDERER_URL']),",
    )
    expect(wired).toContain('const start = howToStart(')
  })

  it('⛔ a hidden launch starts, makes and renames only folders beside its own', () => {
    const wired = readFileSync(join(here, '../src/main/workspaces-in-the-app.ts'), 'utf8')
    expect(wired).toContain(
      'options.hidden && (sameFolder(folder, defaultFolder) || !isWithin(folder, dirname(userData)))',
    )
    // ⚑ Asked before every open, make and rename.
    expect(wired.match(/outOfReach\(/g)).toHaveLength(3)
    const root = aFolder()
    mkdirSync(join(root, 'ab'))
    symlinkSync(join(root, 'ab'), join(root, 'link'))
    expect(isWithin(join(root, 'a', 'w'), join(root, 'a'))).toBe(true)
    expect(isWithin(join(root, 'a'), join(root, 'a'))).toBe(true)
    expect(isWithin(join(root, 'ab'), join(root, 'a'))).toBe(false)
    expect(isWithin(join(root, 'a', '..', 'x'), join(root, 'a'))).toBe(false)
    expect(isWithin(join(root, 'link', 'w'), join(root, 'ab'))).toBe(true)
  })

  it('🔴 listed as the BroBot it starts will spell it: links resolved, except on Windows', () => {
    const root = aFolder()
    mkdirSync(join(root, 'real'))
    symlinkSync(join(root, 'real'), join(root, 'link'))
    expect(asStartedOn(join(root, 'link'), 'darwin')).toBe(join(root, 'real'))
    expect(asStartedOn(join(root, 'link'), 'win32')).toBe(join(root, 'link'))
    expect(asStartedOn(join(root, 'gone'), 'linux')).toBe(join(root, 'gone'))
    const wired = readFileSync(join(here, '../src/main/workspaces-in-the-app.ts'), 'utf8')
    expect(wired).toContain('const as = listedAs(verdict.path) ?? asStartedOn(verdict.path)')
    expect(wired).toContain(
      'const as = asStartedOn(verdict.path)\n      const refusal = await openOn(as)',
    )
  })

  it('🔴 started as nobody’s child on macOS and Linux; directly on Windows', () => {
    expect(howToStart('C:\\B\\BroBot.exe', ['--user-data-dir=C:\\w'], 'win32')).toEqual({
      command: 'C:\\B\\BroBot.exe',
      args: ['--user-data-dir=C:\\w'],
    })
    expect(howToStart('/B/BroBot', ['--user-data-dir=/w'], 'darwin')).toEqual({
      command: '/bin/sh',
      args: ['-c', '"$0" "$@" </dev/null >/dev/null 2>&1 &', '/B/BroBot', '--user-data-dir=/w'],
    })
  })

  it.skipIf(process.platform === 'win32')(
    '⛔ through the shell, a folder’s name is an argument and never run',
    async () => {
      const root = aFolder()
      const said = join(root, 'said.json')
      const ran = join(root, 'ran')
      const folder = `${root}/it's "a" $(touch ${ran}); \`x\` & name`
      // ⚑ The child waits for the shell to leave, then says its arguments and who its parent is.
      const child = `setTimeout(() => require('fs').writeFileSync(process.argv[1], JSON.stringify({ args: process.argv.slice(2), ppid: process.ppid })), 400)`
      const start = howToStart(
        process.execPath,
        ['-e', child, said, `--user-data-dir=${folder}`],
        process.platform,
      )
      const shell = spawn(start.command, start.args, {
        stdio: 'ignore',
        env: { PATH: process.env.PATH ?? '' },
      })
      const shellPid = shell.pid
      const shellCode = await new Promise<number | null>((done) => shell.once('exit', done))
      // ⚑ The shell has left before the child has said anything: the child is not under it, or us.
      expect(shellCode).toBe(0)
      for (let waited = 0; !existsSync(said) && waited < 5000; waited += 100) {
        await new Promise((done) => setTimeout(done, 100))
      }
      const { args, ppid } = JSON.parse(readFileSync(said, 'utf8')) as {
        args: string[]
        ppid: number
      }
      expect(args).toEqual([`--user-data-dir=${folder}`])
      expect(existsSync(ran)).toBe(false)
      expect(ppid).not.toBe(process.pid)
      expect(ppid).not.toBe(shellPid)
    },
  )
})

describe('§6 · the chooser’s rows', () => {
  it('🔴 most recently opened first, this one even unlisted, each with its name and whether it runs', async () => {
    const root = aFolder()
    const thisOne = aWorkspace(root, 'this')
    const closed = aWorkspace(root, 'closed')
    nameWorkspace(closed, 'Research')
    const running = aWorkspace(root, 'running')
    const gone = join(root, 'gone')
    const asked: string[] = []
    const rows = await workspaceRows({
      listed: [
        { path: closed, lastOpenedAt: 1 },
        { path: gone, lastOpenedAt: 3 },
        { path: running, lastOpenedAt: 2 },
      ],
      thisOne,
      defaultFolder: join(root, 'default'),
      ask: async (folder) => {
        asked.push(folder)
        return folder === running ? 'open' : 'closed'
      },
      readersOfThisOne: () => Promise.resolve('Other users of this computer can read it.'),
    })
    expect(rows.map((row) => [row.name, row.state, row.isThisOne, row.readers])).toEqual([
      ['this', 'open', true, 'Other users of this computer can read it.'],
      ['gone', 'missing', false, null],
      ['running', 'open', false, null],
      ['Research', 'closed', false, null],
    ])
    // ⚑ This one, and a folder that is gone, are not asked.
    expect(asked.sort()).toEqual([closed, running].sort())
  })

  it('⚑ the default folder reads Default', async () => {
    const root = aFolder()
    const theDefault = aWorkspace(root, 'desktop')
    const rows = await workspaceRows({
      listed: [{ path: theDefault, lastOpenedAt: 1 }],
      thisOne: theDefault,
      defaultFolder: theDefault,
      ask: async () => 'closed',
    })
    expect(rows).toEqual([
      {
        path: theDefault,
        name: 'Default',
        isDefault: true,
        isThisOne: true,
        state: 'open',
        lastOpenedAt: 1,
        readers: null,
      },
    ])
  })
})

describe('§7 · whether a workspace runs now: its gate, asked', () => {
  it('🔴 open while a BroBot holds it, closed when nothing does, a long path asked where its gate is', async () => {
    const folder = aFolder()
    expect(await whoIsOn(folder)).toBe('closed')
    expect(await claimSoleHost(folder)).toBe('sole')
    expect(await whoIsOn(folder)).toBe('open')
    // A folder too long for a socket inside it has its gate in a folder outside it, and is asked
    // there; here one the test owns, never the home's.
    const long = join(folder, 'a'.repeat(120))
    mkdirSync(long)
    const seams = { folder: join(folder, 'g') }
    try {
      expect(await whoIsOn(long, process.platform, seams)).toBe('closed')
      expect(await claimSoleHost(long, process.platform, seams)).toBe('sole')
      expect(await whoIsOn(long, process.platform, seams)).toBe('open')
    } finally {
      rmSync(hostGatePath(long, process.platform, seams), { force: true })
    }
  })
})
