import { fileURLToPath } from 'node:url'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { pinTheDataFolder, workspaceStartup, type PinnableApp } from '../src/main/data-folder'
import { PACKAGED_WORKSPACE_REFUSAL, workspaceLaunchMessage } from '../src/main/workspace-routing'
import { ExistingWorkspace, WorkspaceUnavailable } from '../src/main/workspace-startup'
import { createRecoveryService, inspect } from '../src/main/recovery/coordinator'
import { nodeFs as recoveryFiles } from '../src/main/recovery/files'
import { openDatabase } from '../src/main/db/connection'
import { themeRoots } from '../src/main/themes/state'
import { ThemeStore } from '../src/main/themes/store'
import {
  BUILT_IN_THEME_IDS,
  DEFAULT_THEME_ID,
  HIDDEN_BASE_THEME_IDS,
} from '../src/main/themes/defaults'

const hooks = vi.hoisted(() => ({
  afterStat: undefined as ((file: unknown) => void) | undefined,
  beforeMkdir: undefined as ((file: unknown) => void) | undefined,
}))
vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>()
  return {
    ...fs,
    mkdir: (...args: Parameters<typeof fs.mkdir>) => {
      hooks.beforeMkdir?.(args[0])
      return fs.mkdir(...args)
    },
  }
})
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>()
  return {
    ...fs,
    statSync: (...args: Parameters<typeof fs.statSync>) => {
      const result = fs.statSync(...args)
      hooks.afterStat?.(args[0])
      return result
    },
  }
})
let root: string, workspace: string, appData: string
const migrations = fileURLToPath(new URL('../src/main/db/migrations', import.meta.url))
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fictional-existing-workspace-'))
  workspace = join(root, 'copper')
  appData = join(root, 'app-data')
  const config = join(appData, '@brobot2')
  mkdirSync(config, { recursive: true })
  mkdirSync(workspace)
  writeFileSync(join(workspace, 'brobot2.sqlite'), '')
  writeFileSync(
    join(config, 'workspace-policy.json'),
    JSON.stringify({
      version: 1,
      firstWorkspace: workspace,
      packagedForbidden: [],
      developmentForbidden: [workspace],
    }),
  )
  writeFileSync(
    join(config, 'packaged-workspaces.json'),
    JSON.stringify({ version: 1, workspaces: [{ path: workspace, lastOpenedAt: 1 }] }),
  )
})
afterEach(() => {
  hooks.afterStat = undefined
  hooks.beforeMkdir = undefined
  rmSync(root, { recursive: true, force: true })
})
function app(): PinnableApp {
  let selected = workspace
  return {
    isPackaged: true,
    getPath: (name) => (name === 'appData' ? appData : selected),
    setPath: (_name, path) => {
      selected = path
    },
    commandLine: { hasSwitch: (name) => name === 'brobot-hidden' },
  }
}
const index = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
const parsed = ts.createSourceFile('index.ts', index, ts.ScriptTarget.ESNext, true)
function declaration(name: string): string {
  const node = parsed.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
  )
  if (!node) throw new Error('missing startup function')
  return node.getText(parsed)
}

/** Execute the real main-process startup block with real recovery and themes, without Electron. */
async function startup(fake: PinnableApp, beforeThemes?: () => void) {
  const lines: string[] = [],
    exits: number[] = [],
    stores: ThemeStore[] = []
  let databaseStarts = 0
  const begin = index.indexOf('      const verdict = await theVerdictBeforeTheData(ownership)')
  const endLine = '      host = createRuntimeHost(initDatabase())'
  const end = index.indexOf(endLine, begin) + endLine.length
  expect(begin).toBeGreaterThan(0)
  const context = {
    app: Object.assign(fake, {
      getVersion: () => '0.0.0',
      commandLine: { ...fake.commandLine, getSwitchValue: () => '' },
    }),
    workspaceStartup,
    pinTheDataFolder,
    WorkspaceUnavailable,
    workspaceLaunchMessage,
    recoveryFiles,
    RECOVERY_FAULT_SWITCH: 'fictional-no-fault',
    buildIdentity: () => ({ commit: '' }),
    resolveMigrationsFolder: () => migrations,
    ownershipFrom: () => ({ ask: async () => 'unknown' }),
    createRecoveryService,
    buildLineage: async () => [],
    recoveryService: null,
    theOneAppAnswer: null,
    checkingTheData: false,
    workingTimer: null,
    workingOnNow: null,
    thisBuildsMigrations: null,
    closedWhileCheckingSaid: false,
    startFailed: false,
    theDataOpened: false,
    recoveryCalls: null,
    sayWorkingIfItTakesLong: () => {},
    performance,
    clearTimeout,
    sayAtOnce: (line: string) => lines.push(line),
    endTheProcess: (code: number) => exits.push(code),
    endInRecovery: (verdict: { detail: string }) => {
      lines.push(verdict.detail)
      exits.push(1)
    },
    whatAFailedStartEndsOn: async (error: Error) => ({ kind: 'failed', detail: error.message }),
    stopWhatTheStartStarted: async () => {},
    presentation: { hidden: true },
    dialog: { showErrorBox: (_title: string, line: string) => lines.push(line) },
    console: { error: (line: string) => lines.push(line) },
    keepTheSystemZone: () => {
      beforeThemes?.()
      return {}
    },
    readLocalTimeFrom: () => {},
    BrowserWindow: { getAllWindows: () => [] },
    host: null,
    LOCAL_ZONE_MOVED_CHANNEL: '',
    themes: null,
    ThemeStore: class extends ThemeStore {
      constructor(options: ConstructorParameters<typeof ThemeStore>[0]) {
        super({ ...options, watch: () => () => {} })
        stores.push(this)
      }
    },
    themeRoots,
    DEFAULT_THEME_ID,
    BUILT_IN_THEME_IDS,
    HIDDEN_BASE_THEME_IDS,
    process: { resourcesPath: join(root, 'resources') },
    __dirname: root,
    join,
    themePictureSampler: () => () => null,
    nativeImage: {},
    themeProblem: () => 'fictional',
    shell: { trashItem: async () => {}, openPath: async () => '' },
    stopThemeIpc: null,
    registerThemeIpc: () => () => {},
    ipcMain: {},
    initDatabase: () => {
      databaseStarts++
      return {}
    },
    createRuntimeHost: () => ({}),
  }
  const prefixBegin = index.indexOf('try {\n  pinTheDataFolder(app)')
  const prefixEnd = index.indexOf('// Give Windows the app id', prefixBegin)
  Object.assign(context.app, { exit: (code: number) => exits.push(code) })
  runInNewContext(
    ts.transpileModule(index.slice(prefixBegin, prefixEnd), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText,
    context,
  )
  if (exits.length) return { lines, exits, databaseStarts, exists: existsSync(workspace) }
  const code =
    ['theRecoveryService', 'theVerdictBeforeTheData', 'endAFailedStart']
      .map(declaration)
      .join('\n') +
    `\n(async () => { const ownership = 'unknown'; try { ${index.slice(begin, end)} } catch(error) { await endAFailedStart(error, ownership) } })()`
  try {
    await runInNewContext(
      ts.transpileModule(code, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
      }).outputText,
      context,
    )
  } finally {
    for (const store of stores) await store.close()
  }
  return { lines, exits, databaseStarts, exists: existsSync(workspace) }
}

it('configured startup: removal after the pin stat exits before recovery, themes or database can recreate it', async () => {
  const fake = app()
  let removed = false
  hooks.afterStat = (file) => {
    if (file === workspace && !removed) {
      removed = true
      rmSync(workspace, { recursive: true })
    }
  }
  expect(await startup(fake)).toEqual({
    lines: [PACKAGED_WORKSPACE_REFUSAL],
    exits: [1],
    databaseStarts: 0,
    exists: false,
  })
  expect(removed).toBe(true)
})

it('configured startup: removal after recovery also refuses before themes can recreate the root', async () => {
  const fake = app()
  pinTheDataFolder(fake)
  expect(await startup(fake, () => rmSync(workspace, { recursive: true }))).toEqual({
    lines: [PACKAGED_WORKSPACE_REFUSAL],
    exits: [1],
    databaseStarts: 0,
    exists: false,
  })
})

it('configured startup: removal at the theme mkdir never recreates its parent', async () => {
  const fake = app()
  hooks.beforeMkdir = (file) => {
    if (file === join(workspace, 'themes')) rmSync(workspace, { recursive: true })
  }
  expect(await startup(fake)).toEqual({
    lines: [PACKAGED_WORKSPACE_REFUSAL],
    exits: [1],
    databaseStarts: 0,
    exists: false,
  })
})

it('configured startup refuses an absent database before creating the hidden theme library', async () => {
  rmSync(join(workspace, 'brobot2.sqlite'))
  expect(await startup(app())).toEqual({
    lines: [PACKAGED_WORKSPACE_REFUSAL],
    exits: [1],
    databaseStarts: 0,
    exists: true,
  })
  expect(existsSync(join(workspace, 'themes'))).toBe(false)
  expect(existsSync(join(workspace, 'brobot2.sqlite'))).toBe(false)
})

it('configured recovery refuses a missing database with the fixed line, ordinary new workspaces still open', async () => {
  rmSync(join(workspace, 'brobot2.sqlite'))
  const deps = {
    userData: workspace,
    buildMigrationsFolder: migrations,
    appVersion: '0.0.0',
    build: null,
    packaged: true,
    ownership: async () => 'unknown' as const,
  }
  expect(await inspect({ ...deps, requireExistingDatabase: true })).toMatchObject({
    kind: 'failed',
    detail: PACKAGED_WORKSPACE_REFUSAL,
    canRetry: false,
  })
  expect(await inspect(deps)).toMatchObject({ kind: 'open' })
  expect(existsSync(join(workspace, 'brobot2.sqlite'))).toBe(false)
})

it('recovery folder creation cannot recreate its workspace root, even with recursive requested', async () => {
  const existing = new ExistingWorkspace(workspace, statSync(workspace))
  await existing.mkdir(join(workspace, 'backups', 'fictional'), { recursive: true, mode: 0o700 })
  expect(existsSync(join(workspace, 'backups', 'fictional'))).toBe(true)
  await expect(existing.mkdir(join(workspace, 'backups', 'fictional'))).rejects.toMatchObject({
    code: 'EEXIST',
  })
  await expect(existing.mkdir(join(workspace, 'absent-parent', 'child'))).rejects.toMatchObject({
    code: 'ENOENT',
  })
  expect(existsSync(join(workspace, 'absent-parent'))).toBe(false)
  rmSync(workspace, { recursive: true })
  await expect(
    existing.mkdir(join(workspace, 'recovery', 'staged'), { recursive: true }),
  ).rejects.toThrow(PACKAGED_WORKSPACE_REFUSAL)
  expect(existsSync(workspace)).toBe(false)
})

it('the existing-database open cannot create an empty database after its last check', () => {
  rmSync(join(workspace, 'brobot2.sqlite'))
  expect(() => openDatabase(join(workspace, 'brobot2.sqlite'), { fileMustExist: true })).toThrow()
  expect(existsSync(join(workspace, 'brobot2.sqlite'))).toBe(false)
})

it('main passes the must-exist option into SQLite when the database disappears at open', () => {
  const fake = app()
  pinTheDataFolder(fake)
  const connections: ReturnType<typeof openDatabase>[] = []
  const context = {
    app: fake,
    workspaceStartup,
    join,
    resolveMigrationsFolder: () => migrations,
    openDatabase: (file: string, options?: { fileMustExist: boolean }) => {
      rmSync(file)
      const db = openDatabase(file, options)
      connections.push(db)
      return db
    },
    openOrRefuse: () => {},
    theBuildsMigrations: () => [],
    applyMigrations: () => {},
    compactWhenMuchIsFree: () => 'unchanged',
    freeBytesOn: () => null,
    db: null,
    presentation: { hidden: false },
  }
  try {
    expect(() =>
      runInNewContext(
        ts.transpileModule(`${declaration('initDatabase')}\ninitDatabase()`, {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
        }).outputText,
        context,
      ),
    ).toThrow(PACKAGED_WORKSPACE_REFUSAL)
    expect(existsSync(join(workspace, 'brobot2.sqlite'))).toBe(false)
  } finally {
    for (const db of connections) db.close()
  }
})

it('configured startup on existing data reaches the database without changing the approved refusal wording', async () => {
  const fake = app()
  pinTheDataFolder(fake)
  expect(await startup(fake)).toEqual({ lines: [], exits: [], databaseStarts: 1, exists: true })
})
