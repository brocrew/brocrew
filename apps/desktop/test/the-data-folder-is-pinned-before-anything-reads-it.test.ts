import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  APP_ID,
  nameTheAppToWindows,
  pinTheDataFolder,
  type PinnableApp,
} from '../src/main/data-folder'

/**
 * 🔴 **W4.90 — the pin, from the side `the-data-folder-is-pinned.test.ts` does not reach.**
 *
 *  - §1 · the pin's own order: the folder is there before Electron is told it (Electron's
 *    `setPath` throws on a folder that is not), a folder that cannot be made still gets pinned, and a
 *    launch with its own `--user-data-dir` makes and asks nothing of `appData`.
 *  - §2 · nothing reads the folder before the pin: it is the first statement of `index.ts` once its
 *    imports are in, and no module those imports evaluate first holds Electron's `app`.
 *  - §3 · `nameTheAppToWindows` with no platform named — the call `index.ts` makes — asks the
 *    process it runs in, and names only Windows.
 *
 * ⛔ No real Electron `app`: a stand-in records what the pin asked and set, over a temp `appData`.
 */

const here = dirname(fileURLToPath(import.meta.url))
const MAIN = join(here, '../src/main')
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'brobot-pin-order-'))
  roots.push(root)
  return root
}

/**
 * A stand-in for Electron's `app` that answers each path by its own name — so a pin that asked for
 * the wrong one lands somewhere else — and records, for each `setPath`, whether the folder existed.
 */
function anApp(appData: string, switches: readonly string[] = []) {
  const asked: string[] = []
  const switchesAsked: string[] = []
  const set: { name: string; path: string; existed: boolean }[] = []
  const app: PinnableApp = {
    getPath: (name) => {
      asked.push(name)
      return name === 'appData' ? appData : join(appData, 'not-appData', String(name))
    },
    setPath: (name, path) => {
      set.push({ name, path, existed: existsSync(path) })
    },
    commandLine: {
      hasSwitch: (name) => {
        switchesAsked.push(name)
        return switches.includes(name)
      },
    },
  }
  return { app, asked, switchesAsked, set }
}

describe('§1 · the pin’s own order', () => {
  it('🔴 the folder is made BEFORE Electron is told it — `setPath` throws on a folder that is not there', () => {
    const appData = scratch()
    const folder = join(appData, '@brobot2', 'desktop')
    const { app, set } = anApp(appData)
    expect(existsSync(folder), 'a first launch on a new machine has no folder yet').toBe(false)
    pinTheDataFolder(app)
    expect(set).toEqual([{ name: 'userData', path: folder, existed: true }])
  })

  it('⚑ a folder that cannot be made does not stop the launch — the pin still names it, and the database says what went wrong', () => {
    // ⚑ Its `appData` is a file, so `<appData>/@brobot2/desktop` can never be made.
    const appData = join(scratch(), 'appData-is-a-file')
    writeFileSync(appData, '')
    const folder = join(appData, '@brobot2', 'desktop')
    const { app, set } = anApp(appData)
    expect(() => pinTheDataFolder(app)).not.toThrow()
    expect(set).toEqual([{ name: 'userData', path: folder, existed: false }])
    // ⚑ One fact over: the same launch on a folder that can be made gets it made.
    const fine = anApp(scratch())
    pinTheDataFolder(fine.app)
    expect(fine.set.map((one) => one.existed)).toEqual([true])
  })

  it('⛔ a launch with its own --user-data-dir makes nothing in appData and asks nothing of it', () => {
    const appData = scratch()
    const own = anApp(appData, ['user-data-dir'])
    pinTheDataFolder(own.app)
    expect(own.set).toEqual([])
    expect(own.asked, 'a launch with its own folder has no use for appData').toEqual([])
    expect(readdirSync(appData), 'nothing made in the folder every build shares').toEqual([])
    // ⚑ One fact over: the launch that names no folder makes the shared one.
    const shared = anApp(appData)
    pinTheDataFolder(shared.app)
    expect(readdirSync(appData)).toEqual(['@brobot2'])
  })

  it('⚑ the folder is under appData — not home, not whatever userData already says — and a hidden launch is pinned all the same', () => {
    const appData = scratch()
    const { app, asked, switchesAsked, set } = anApp(appData, ['brobot-hidden'])
    pinTheDataFolder(app)
    expect(asked).toEqual(['appData'])
    expect(switchesAsked).toEqual(['user-data-dir'])
    expect(set.map((one) => one.path)).toEqual([join(appData, '@brobot2', 'desktop')])
    expect(relative(appData, set[0]?.path ?? '')).toBe(join('@brobot2', 'desktop'))
  })
})

/**
 * The first statement after a module's imports, past blank lines and comments — `''` when there is
 * none. ⚑ A module's imports are evaluated before its body, so "first after the imports" is
 * "first of the module's own code".
 */
function firstStatementAfterImports(source: string): string {
  const imports = [...source.matchAll(/^import\b[\s\S]*?\bfrom '[^']+'\n/gm)]
  const last = imports.at(-1)
  if (last?.index === undefined) return ''
  let rest = source.slice(last.index + last[0].length)
  for (;;) {
    rest = rest.replace(/^\s+/, '')
    if (rest.startsWith('//')) {
      const end = rest.indexOf('\n')
      if (end === -1) return ''
      rest = rest.slice(end + 1)
      continue
    }
    if (rest.startsWith('/*')) {
      const end = rest.indexOf('*/')
      if (end === -1) return ''
      rest = rest.slice(end + 2)
      continue
    }
    const end = rest.indexOf('\n')
    if (rest.startsWith('try {\n')) return rest.slice(0, rest.indexOf('\n', end + 1))
    return end === -1 ? rest : rest.slice(0, end)
  }
}

/** Whether a module takes Electron's `app` — or all of Electron — as a value. */
function takesElectronsApp(source: string): boolean {
  // ⚠️ The clause is matched by its shape — braces, `* as x`, a default — never by a lazy run, which
  // would start at an earlier import and swallow every line up to this one.
  const electronImport =
    /^import\s+(type\s+)?(\{[^}]*\}|\*\s+as\s+\w+|\w+(?:\s*,\s*\{[^}]*\})?)\s+from 'electron'/gm
  for (const found of source.matchAll(electronImport)) {
    if (found[1] !== undefined) continue
    const clause = found[2] ?? ''
    if (!clause.startsWith('{')) return true // a default or namespace import: all of Electron
    const names = clause
      .replace(/[{}]/g, '')
      .split(',')
      .map((one) => one.trim())
    if (names.some((one) => one === 'app' || one.startsWith('app as '))) return true
  }
  return /require\('electron'\)|import\('electron'\)/.test(source)
}

describe('§2 · nothing reads the folder before the pin', () => {
  it('🔴 the pin is the first thing index.ts does once its imports are in', () => {
    expect(firstStatementAfterImports(indexSource())).toBe('try {\n  pinTheDataFolder(app)')
    expect(indexSource()).toMatch(
      /try \{\n {2}pinTheDataFolder\(app\)\n {2}workspaceStartup\(app\)\?\.assertDatabase\(\)\n\} catch/,
    )
    // ⚑ One fact over: the same reading sees a module-scope read put in front of it.
    const early = [
      "import { app } from 'electron'",
      "import { pinTheDataFolder } from './data-folder'",
      '',
      '// a comment',
      '/** a docblock */',
      "const early = app.getPath('userData')",
      'pinTheDataFolder(app)',
      '',
    ].join('\n')
    expect(firstStatementAfterImports(early)).toBe("const early = app.getPath('userData')")
    expect(firstStatementAfterImports(early.replace(/^const early.*\n/m, ''))).toBe(
      'pinTheDataFolder(app)',
    )
  })

  it('⛔ …and no module it imports holds Electron’s app — imports are evaluated first, so one that did could read the folder before the pin', () => {
    const sources = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        return statSync(path).isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : []
      })
    const holders = sources(MAIN)
      .filter((path) => takesElectronsApp(readFileSync(path, 'utf8')))
      .map((path) => relative(MAIN, path))
    expect(holders, 'only index.ts may hold `app`, and it pins first').toEqual(['index.ts'])
    // ⚑ The reading itself, both ways: what holds `app`, and what does not.
    expect(takesElectronsApp("import { app } from 'electron'\n")).toBe(true)
    expect(takesElectronsApp("import {\n  BrowserWindow,\n  app,\n} from 'electron'\n")).toBe(true)
    expect(takesElectronsApp("import * as electron from 'electron'\n")).toBe(true)
    expect(takesElectronsApp("const { app } = require('electron')\n")).toBe(true)
    expect(takesElectronsApp("import type { App } from 'electron'\n")).toBe(false)
    expect(takesElectronsApp("import { shell } from 'electron'\n")).toBe(false)
    expect(takesElectronsApp("import { appendFileSync } from 'node:fs'\n")).toBe(false)
  })
})

describe('§3 · nameTheAppToWindows', () => {
  it('⚑ with no platform named — the call index.ts makes — it asks the process it runs in', () => {
    expect(indexSource()).toContain('\nnameTheAppToWindows(app)\n')
    const realPlatform = process.platform
    const named: string[] = []
    const app = { setAppUserModelId: (id: string) => named.push(id) }
    try {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
      nameTheAppToWindows(app)
      expect(named).toEqual([APP_ID])
      // ⚑ One fact over: the same call on a Mac names nothing.
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
      nameTheAppToWindows(app)
      expect(named).toEqual([APP_ID])
    } finally {
      Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true })
    }
  })

  it('⛔ only Windows: no other system is given the id', () => {
    const named: string[] = []
    const app = { setAppUserModelId: (id: string) => named.push(id) }
    for (const platform of ['linux', 'darwin', 'freebsd'] as const)
      nameTheAppToWindows(app, platform)
    expect(named).toEqual([])
    nameTheAppToWindows(app, 'win32')
    expect(named).toEqual(['com.brobot2.desktop'])
  })
})

function indexSource(): string {
  return readFileSync(join(MAIN, 'index.ts'), 'utf8')
}
