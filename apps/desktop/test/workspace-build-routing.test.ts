import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { defaultDataFolder, pinTheDataFolder, type PinnableApp } from '../src/main/data-folder'
import {
  OTHER_BUILD_REFUSAL,
  PACKAGED_WORKSPACE_REFUSAL,
  WORKSPACE_LIST_REFUSAL,
  workspaceLaunchMessage,
  PACKAGED_WORKSPACE_LIST,
  workspaceRouting,
  WORKSPACE_POLICY_FILE,
} from '../src/main/workspace-routing'
import { rememberWorkspace, workspaceListFile } from '../src/main/workspaces'

let root: string, appData: string, config: string, first: string, second: string, third: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fictional-build-workspaces-'))
  appData = join(root, 'app-data')
  config = join(appData, '@brobot2')
  mkdirSync(config, { recursive: true })
  first = join(root, 'copper')
  second = join(root, 'fern')
  third = join(root, 'birch')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))
function list(file: string, rows: [string, number][]) {
  writeFileSync(
    join(config, file),
    JSON.stringify({
      version: 1,
      workspaces: rows.map(([path, lastOpenedAt]) => ({ path, lastOpenedAt })),
    }),
  )
}
function policy() {
  writeFileSync(
    join(config, WORKSPACE_POLICY_FILE),
    JSON.stringify({
      version: 1,
      firstWorkspace: first,
      packagedForbidden: [defaultDataFolder(appData)],
      developmentForbidden: [first, second, third],
    }),
  )
}
function app(packaged: boolean, explicit?: string, required = false) {
  const appPath = join(root, 'app')
  mkdirSync(appPath, { recursive: true })
  writeFileSync(join(appPath, 'package.json'), JSON.stringify({ requireWorkspacePolicy: required }))
  const set: string[] = []
  const fake: PinnableApp = {
    isPackaged: packaged,
    getAppPath: () => appPath,
    getPath: (name) => (name === 'appData' ? appData : (explicit ?? '/fictional-unused')),
    setPath: (_name, path) => set.push(path),
    commandLine: { hasSwitch: (name) => name === 'user-data-dir' && explicit !== undefined },
  }
  return { fake, set }
}
it('keeps packaged, development and hidden workspace lists separate', () => {
  const base = { appData, userData: first, hidden: false }
  expect(workspaceListFile({ ...base, packaged: true })).toBe(join(config, PACKAGED_WORKSPACE_LIST))
  expect(workspaceListFile({ ...base, packaged: false })).toBe(join(config, 'workspaces.json'))
  expect(workspaceListFile({ ...base, packaged: true, hidden: true })).toBe(
    join(first, 'workspaces.json'),
  )
})
it('Finder first open uses the installed list and never creates the main default', () => {
  policy()
  list(PACKAGED_WORKSPACE_LIST, [[first, 1]])
  mkdirSync(first, { recursive: true })
  const a = app(true, undefined, true)
  pinTheDataFolder(a.fake)
  expect(a.set).toEqual([first])
  expect(existsSync(first)).toBe(true)
  expect(existsSync(defaultDataFolder(appData))).toBe(false)
})
it('Finder reopening follows the latest successful workspace in its own list', () => {
  policy()
  for (const folder of [first, second, third]) mkdirSync(folder)
  list(PACKAGED_WORKSPACE_LIST, [
    [first, 1],
    [second, 3],
    [third, 2],
  ])
  mkdirSync(first, { recursive: true })
  const a = app(true, undefined, true)
  pinTheDataFolder(a.fake)
  expect(a.set).toEqual([second])
  rememberWorkspace(join(config, PACKAGED_WORKSPACE_LIST), third, 4)
  const b = app(true, undefined, true)
  pinTheDataFolder(b.fake)
  expect(b.set).toEqual([third])
  expect(existsSync(defaultDataFolder(appData))).toBe(false)
})
it('seeds a normal packaged upgrade once from the legacy list without losing fields', () => {
  const original = JSON.stringify({
    version: 1,
    note: 'fictional preserved field',
    workspaces: [
      { path: first, lastOpenedAt: 1, retained: true },
      { path: second, lastOpenedAt: 9 },
    ],
  })
  writeFileSync(join(config, 'workspaces.json'), original)
  mkdirSync(second)
  const a = app(true)
  pinTheDataFolder(a.fake)
  expect(a.set).toEqual([second])
  expect(readFileSync(join(config, PACKAGED_WORKSPACE_LIST), 'utf8')).toBe(original)
  list('workspaces.json', [[third, 20]])
  const b = app(true)
  pinTheDataFolder(b.fake)
  expect(b.set).toEqual([second])
})
it('a policy prevents copying the legacy main window into the packaged list', () => {
  policy()
  list('workspaces.json', [[defaultDataFolder(appData), 99]])
  list(PACKAGED_WORKSPACE_LIST, [[first, 1]])
  mkdirSync(first, { recursive: true })
  const a = app(true, undefined, true)
  pinTheDataFolder(a.fake)
  expect(a.set).toEqual([first])
  expect(
    JSON.parse(readFileSync(join(config, PACKAGED_WORKSPACE_LIST), 'utf8')).workspaces,
  ).toEqual([{ path: first, lastOpenedAt: 1 }])
})
it('an ordinary packaged first launch still uses the default when no policy/list exists', () => {
  const a = app(true)
  pinTheDataFolder(a.fake)
  expect(a.set).toEqual([defaultDataFolder(appData)])
})
it.each(['absent', 'invalid'] as const)(
  'required %s policy cannot fall back to the main folder',
  (kind) => {
    if (kind === 'invalid') writeFileSync(join(config, WORKSPACE_POLICY_FILE), '{}')
    const a = app(true, undefined, true)
    expect(() => pinTheDataFolder(a.fake)).toThrow("couldn't read its list of workspaces")
    expect(a.set).toEqual([])
    expect(existsSync(defaultDataFolder(appData))).toBe(false)
  },
)
it('a damaged packaged list cannot trigger a policy bypass or overwrite legacy state', () => {
  policy()
  writeFileSync(join(config, PACKAGED_WORKSPACE_LIST), '{')
  const a = app(true, undefined, true)
  expect(() => pinTheDataFolder(a.fake)).toThrow("couldn't read its list of workspaces")
  expect(a.set).toEqual([])
})
it('explicit packaged launches cannot open the main default either', () => {
  policy()
  list(PACKAGED_WORKSPACE_LIST, [[first, 1]])
  const a = app(true, defaultDataFolder(appData), true)
  expect(() => pinTheDataFolder(a.fake)).toThrow("can't be opened")
  expect(a.set).toEqual([])
  expect(existsSync(defaultDataFolder(appData))).toBe(false)
})
it.each([0, 1, 2])(
  'dev startup refuses reserved workspace %i before making or selecting it',
  (index) => {
    policy()
    const folder = [first, second, third][index]!
    const a = app(false, folder)
    expect(() => pinTheDataFolder(a.fake)).toThrow(OTHER_BUILD_REFUSAL)
    expect(a.set).toEqual([])
    expect(existsSync(folder)).toBe(false)
  },
)
it('dev startup preserves its main default while packaged ownership stays reserved', () => {
  policy()
  list(PACKAGED_WORKSPACE_LIST, [[first, 1]])
  const a = app(false)
  pinTheDataFolder(a.fake)
  expect(a.set).toEqual([defaultDataFolder(appData)])
})
it('new packaged workspaces are also fenced from dev without a special policy', () => {
  list(PACKAGED_WORKSPACE_LIST, [[third, 1]])
  expect(workspaceRouting(appData, false).refusal(third)).toBe(OTHER_BUILD_REFUSAL)
  expect(workspaceRouting(appData, true).refusal(third)).toBeNull()
})
it.skipIf(process.platform === 'win32')(
  'folder aliases and new children under an alias remain fenced',
  () => {
    policy()
    mkdirSync(first)
    const alias = join(root, 'alias')
    symlinkSync(first, alias)
    const routing = workspaceRouting(appData, false)
    expect(routing.refusal(alias)).toBe(OTHER_BUILD_REFUSAL)
    expect(routing.refusal(join(alias, 'new-child'))).toBe(OTHER_BUILD_REFUSAL)
  },
)
it.skipIf(process.platform === 'win32')(
  'linked settings are refused without reading their target',
  () => {
    const target = join(root, 'outside.json')
    writeFileSync(target, 'fictional text that is not JSON')
    symlinkSync(target, join(config, WORKSPACE_POLICY_FILE))
    expect(() => workspaceRouting(appData, false)).toThrow("couldn't read its list of workspaces")
  },
)

it('pins the approved refusal words without exposing an unknown error', () => {
  expect(OTHER_BUILD_REFUSAL).toBe('This workspace opens in the BroCrew app in Applications.')
  expect(PACKAGED_WORKSPACE_REFUSAL).toBe("This workspace can't be opened in this app.")
  expect(WORKSPACE_LIST_REFUSAL).toBe("BroCrew couldn't read its list of workspaces.")
  expect(workspaceLaunchMessage(new Error('fictional internal detail'))).toBe(
    WORKSPACE_LIST_REFUSAL,
  )
})
it.each([false, true])(
  'actual startup refusal shows the fixed line and exits before any continuation (dialog fails=%s)',
  (dialogFails) => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/main/index.ts', import.meta.url)),
      'utf8',
    )
    const start = source.indexOf('\ntry {\n  pinTheDataFolder(app)')
    const end = source.indexOf('\nnameTheAppToWindows(app)', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const a = app(true, undefined, true),
      events: unknown[] = []
    const exited = new Error('fictional exit witness')
    const context = {
      app: {
        ...a.fake,
        exit: (code: number) => {
          events.push(['exit', code])
          throw exited
        },
      },
      pinTheDataFolder,
      workspaceLaunchMessage,
      dialog: {
        showErrorBox: (title: string, line: string) => {
          events.push(['show', title, line])
          if (dialogFails) throw new Error('fictional unavailable dialog')
        },
      },
      continueStartup: () => events.push(['unexpected startup']),
    }
    expect(() =>
      runInNewContext(source.slice(start, end) + '\ncontinueStartup()', context),
    ).toThrow(exited)
    expect(events).toEqual([
      ['show', 'BroCrew', WORKSPACE_LIST_REFUSAL],
      ['exit', 1],
    ])
    expect(a.set).toEqual([])
    expect(existsSync(defaultDataFolder(appData))).toBe(false)
  },
)

it('a hidden startup refusal logs the same fixed line and exits without a native dialog', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../src/main/index.ts', import.meta.url)),
    'utf8',
  )
  const start = source.indexOf('\ntry {\n  pinTheDataFolder(app)')
  const end = source.indexOf('\nnameTheAppToWindows(app)', start)
  const events: unknown[] = [],
    exited = new Error('fictional exit')
  expect(() =>
    runInNewContext(source.slice(start, end), {
      app: {
        commandLine: { hasSwitch: () => true },
        exit: (code: number) => {
          events.push(['exit', code])
          throw exited
        },
      },
      pinTheDataFolder: () => {
        throw new Error(WORKSPACE_LIST_REFUSAL)
      },
      workspaceLaunchMessage,
      console: { error: (message: string) => events.push(['log', message]) },
      dialog: { showErrorBox: () => events.push(['unexpected dialog']) },
    }),
  ).toThrow(exited)
  expect(events).toEqual([
    ['log', WORKSPACE_LIST_REFUSAL],
    ['exit', 1],
  ])
})

it('a missing last workspace is refused rather than recreated empty', () => {
  policy()
  list(PACKAGED_WORKSPACE_LIST, [[second, 10]])
  const a = app(true, undefined, true)
  expect(() => pinTheDataFolder(a.fake)).toThrow(PACKAGED_WORKSPACE_REFUSAL)
  expect(a.set).toEqual([])
  expect(existsSync(second)).toBe(false)
  expect(existsSync(defaultDataFolder(appData))).toBe(false)
})
